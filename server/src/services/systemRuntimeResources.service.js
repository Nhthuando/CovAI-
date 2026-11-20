import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ServiceError} from '../utils/serviceError.js';
import {operationAbortReason} from './systemOperationError.service.js';
import {ensureSystemDatabaseMockPreload} from './databaseMockTemplate.service.js';
const exec=promisify(execFile);

const CONTAINER_MEMORY_LIMIT = process.env.COVAI_EPHEMERAL_DB_MEMORY || '512m';
const CONTAINER_CPU_LIMIT = process.env.COVAI_EPHEMERAL_DB_CPUS || '1';
const CONTAINER_PIDS_LIMIT = process.env.COVAI_EPHEMERAL_DB_PIDS || '256';
const POSTGRES_TMPFS_SIZE = process.env.COVAI_EPHEMERAL_POSTGRES_TMPFS || '512m';

export const isOwnedIsolatedDatabaseHost = (hostname = '') =>
    ['127.0.0.1', 'localhost', '[::1]'].includes(hostname) ||
    /^covai-system-(?:postgres|mysql|mongodb)-[a-f0-9-]+$/i.test(String(hostname));

const resolveDockerNetworkMode = async (docker, dependencies = {}) => {
    if (typeof dependencies.networkMode === 'string') {
        const mode = dependencies.networkMode.trim();
        return mode && !['default', 'bridge', 'none', 'host'].includes(mode) && !mode.startsWith('container:') ? mode : null;
    }
    if (!fs.existsSync('/.dockerenv')) return null;
    try {
        const result = await docker(['inspect', '--format', '{{.HostConfig.NetworkMode}}', os.hostname()], { timeout: 5000 });
        const mode = String(result?.stdout || '').trim();
        if (mode && !['default', 'bridge', 'none', 'host'].includes(mode) && !mode.startsWith('container:')) {
            return mode;
        }
    } catch { }
    return null;
};

export const provisionSystemResources = async ({rootDir,database,services,signal,dependencies={}}) => {
    const docker=dependencies.docker || ((args,options={})=>exec('docker',args,{timeout:120000,windowsHide:true,maxBuffer:2*1024*1024,...options}));
    const owned=[],environment={},secrets=[];
    const now=dependencies.now || Date.now;
    const wait=dependencies.wait || (ms=>new Promise(resolve=>setTimeout(resolve,ms)));
    const redact=value=>{
        let text=String(value || '').replace(/\x1b\[[0-9;]*m/g,'');
        for(const secret of secrets)text=text.replaceAll(secret,'[redacted]');
        return text.replace(/(?:mysql|postgres(?:ql)?|mongodb(?:\+srv)?):\/\/[^\s'"`]+/gi,'[redacted connection URL]').slice(-4000);
    };
    const engine=database?.engine;
    let sqlContainer=null;
    let sqliteDirectory;
    let resolvedNetworkMode=null;
    const cleanup=async()=>{
        const errors=[];
        for(const name of [...owned].reverse())try{await docker(['rm','-f','-v',name]);}catch{errors.push(name);}
        if(sqliteDirectory && fs.existsSync(sqliteDirectory)) {
            const real=fs.realpathSync(sqliteDirectory),base=fs.realpathSync(path.join(rootDir,'.covai-system-test','database'));
            if(path.dirname(real)!==base)throw new ServiceError('Invalid SQLite cleanup directory',500);
            fs.rmSync(real,{recursive:true,force:true,maxRetries:10,retryDelay:100});
        }
        if(errors.length)throw new ServiceError('Could not remove owned system-test resources',500);
        owned.length=0;
    };
    const check=()=>{if(signal?.aborted)throw operationAbortReason(signal);};
    const useLiveDockerDb = Boolean(dependencies.docker) || process.env.COVAI_USE_DOCKER_DB === 'true';
    if (!useLiveDockerDb && ((engine && engine !== 'sqlite') || services?.redis)) {
        check();
        let mockRoot = rootDir;
        let createdTempRoot = false;
        if (!mockRoot || !fs.existsSync(mockRoot)) {
            mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-sys-mock-'));
            createdTempRoot = true;
        }
        const mockSession = ensureSystemDatabaseMockPreload(mockRoot, {
            database,
            services,
            tempSubdir: path.join('.covai-system-test', 'mock-db-' + crypto.randomUUID()),
        });
        const existingNodeOptions = process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : '';
        const mockEnv = {
            ...mockSession.environment,
            NODE_OPTIONS: `${existingNodeOptions}${mockSession.requireFlag}`.trim(),
        };
        if (engine === 'mongodb') {
            mockEnv.DATABASE_URL = mockSession.environment.MONGODB_URI;
            mockEnv.DB_URI = mockSession.environment.MONGODB_URI;
            mockEnv.DB_URL = mockSession.environment.MONGODB_URI;
        } else if (engine === 'mysql') {
            mockEnv.DATABASE_URL = mockSession.environment.MYSQL_URL;
            mockEnv.DB_URI = mockSession.environment.MYSQL_URL;
            mockEnv.DB_URL = mockSession.environment.MYSQL_URL;
            mockEnv.DB_DIALECT = 'mysql';
            mockEnv.DB_CLIENT = 'mysql2';
        } else if (engine === 'postgres') {
            mockEnv.DATABASE_URL = mockSession.environment.POSTGRES_URL;
            mockEnv.DB_URI = mockSession.environment.POSTGRES_URL;
            mockEnv.DB_URL = mockSession.environment.POSTGRES_URL;
            mockEnv.DB_DIALECT = 'postgres';
            mockEnv.DB_CLIENT = 'pg';
        }
        return {
            mode: 'mock',
            environment: mockEnv,
            sqlContainer: null,
            engine: engine || null,
            cleanup: async () => {
                await mockSession.cleanup();
                if (createdTempRoot) {
                    try { fs.rmSync(mockRoot, { recursive: true, force: true }); } catch {}
                }
            },
        };
    }
    const start=async({kind,port,image,env=[],command=[],tmpfs=null,probe,initialize})=>{
        check();
        const name=`covai-system-${kind}-${crypto.randomUUID()}`;
        owned.push(name);
        const runArgs=[
            'run','-d',
            '--name',name,
            '--label','covai.system-test=true',
            '--memory',CONTAINER_MEMORY_LIMIT,
            '--cpus',CONTAINER_CPU_LIMIT,
            '--pids-limit',CONTAINER_PIDS_LIMIT,
            ...(tmpfs ? ['--tmpfs', tmpfs] : []),
            ...(resolvedNetworkMode ? ['--network', resolvedNetworkMode] : []),
            '-p',`127.0.0.1::${port}`,
            ...env,
            image,
            ...command,
        ];
        try{await docker(runArgs,{signal});}
        catch(cause){check();const error=new ServiceError(`Could not start the isolated ${kind} service.`,503);error.code='SYSTEM_RUNTIME_SERVICE_START_FAILED';error.details={service:kind,output:redact(cause.stderr || cause.message)};throw error;}
        let connectHost='127.0.0.1';
        let connectPort;
        if (resolvedNetworkMode) {
            connectHost=name;
            connectPort=port;
        } else {
            const mapped=await docker(['port',name,`${port}/tcp`],{signal});
            connectPort=Number(mapped.stdout.trim().split(':').at(-1));
            if(!Number.isInteger(connectPort)||connectPort<1)throw new ServiceError('Could not resolve owned test-service port',500);
        }
        const started=now(),readyBy=started+(dependencies.readinessMs ?? (kind==='mysql'?180000:90000));
        let ready=false,lastProbe='',state;
        while(now()<readyBy) {
            check();
            try{await docker(probe(name),{timeout:Math.max(1,Math.min(5000,readyBy-now())),signal});ready=true;break;}
            catch(cause){
                check();lastProbe=redact(cause.stderr || cause.message);
                try{const result=await docker(['inspect','--format','{{json .State}}',name],{timeout:5000,signal});state=JSON.parse(result.stdout);}
                catch(inspectError){
                    check();
                    // An unavailable engine cannot recover by repeating SQL probes.
                    if(/unable to start|cannot connect|daemon is not running|pipe.*not found|input\/output error/i.test(`${inspectError.stderr || ''} ${inspectError.message || ''}`)){
                        const error=new ServiceError('The test runtime became unavailable while preparing the database.',503);error.code='SYSTEM_RUNTIME_INFRASTRUCTURE_UNAVAILABLE';error.details={service:kind,output:redact(inspectError.stderr || inspectError.message)};throw error;
                    }
                }
                if(state && ['exited','dead','removing'].includes(state.Status))break;
                await wait(Math.min(1000,Math.max(0,readyBy-now())));
            }
        }
        if(!ready){
            let logs='';try{const result=await docker(['logs','--tail','40',name],{timeout:5000});logs=redact(`${result.stdout || ''}\n${result.stderr || ''}`);}catch{}
            const error=new ServiceError(state?.OOMKilled?`The isolated ${kind} service ran out of memory.`:state && ['exited','dead'].includes(state.Status)?`The isolated ${kind} service stopped during startup.`:`The isolated ${kind} service did not finish starting.`,503);
            error.code='SYSTEM_RUNTIME_SERVICE_NOT_READY';
            error.details={service:kind,waitedMs:now()-started,state:state?{status:state.Status,exitCode:state.ExitCode,oomKilled:Boolean(state.OOMKilled)}:null,probe:lastProbe,logs};throw error;
        }
        if(initialize)await docker(initialize(name, connectHost),{timeout:15000});
        return {name,host:connectHost,port:connectPort};
    };
    try {
        if((engine && engine!=='sqlite') || services?.redis) {
            // `docker info` collects subsystem diagnostics and can stall while
            // Desktop wakes up even when the engine already serves requests.
            // A server-version request checks the engine without that work.
            for(let attempt=0;attempt<2;attempt++) {
                check();
                try {await docker(['version','--format','{{.Server.Version}}'],{timeout:10000});break;}
                catch(cause) {
                    check();
                    if(attempt===0 && !['ENOENT','EACCES'].includes(cause.code)) {await new Promise(resolve=>setTimeout(resolve,500));continue;}
                    const error=new ServiceError('The CovAI worker cannot provision isolated test services because Docker is unavailable. This is execution infrastructure, not a missing project environment variable.',503);
                    error.code='SYSTEM_RUNTIME_INFRASTRUCTURE_UNAVAILABLE';throw error;
                }
            }
            resolvedNetworkMode=await resolveDockerNetworkMode(docker, dependencies);
        }
        if(engine==='mysql' || engine==='postgres') {
            const password=crypto.randomBytes(24).toString('hex');
            secrets.push(password);
            const mysql=engine==='mysql';
            const result=await start({kind:engine,port:mysql?3306:5432,image:mysql?'mysql:8.4':'postgres:17',
                tmpfs:mysql ? null : `/var/lib/postgresql/data:rw,noexec,nosuid,size=${POSTGRES_TMPFS_SIZE}`,
                env:mysql?['-e',`MYSQL_ROOT_PASSWORD=${password}`,'-e','MYSQL_DATABASE=covai_test','-e','MYSQL_USER=covai','-e',`MYSQL_PASSWORD=${password}`]:['-e','POSTGRES_DB=covai_test','-e','POSTGRES_USER=covai','-e',`POSTGRES_PASSWORD=${password}`],
                command:mysql?['--innodb-buffer-pool-size=32M','--performance-schema=OFF','--skip-log-bin','--max-connections=50']:[],
                probe:name=>mysql?['exec','-e',`MYSQL_PWD=${password}`,name,'mysql','-h127.0.0.1','-ucovai','covai_test','-e','SELECT 1']:['exec',name,'pg_isready','-h','127.0.0.1','-U','covai','-d','covai_test']});
            sqlContainer=result.name;
            const dbHost=result.host;
            const dbUrl=`${mysql?'mysql':'postgresql'}://covai:${password}@${dbHost}:${result.port}/covai_test`;
            const portStr=String(result.port);
            Object.assign(environment,{
                DATABASE_URL:dbUrl,DB_URI:dbUrl,DB_URL:dbUrl,DB_CONNECTION_STRING:dbUrl,
                DB_HOST:dbHost,DB_PORT:portStr,DB_USER:'covai',DB_USERNAME:'covai',DB_PASSWORD:password,DB_PASS:password,DB_PASSWD:password,DB_NAME:'covai_test',DB_DATABASE:'covai_test',DB_DIALECT:mysql?'mysql':'postgres',DB_CLIENT:mysql?'mysql2':'pg',
                MYSQL_HOST:dbHost,MYSQL_PORT:portStr,MYSQL_USER:'covai',MYSQL_USER_NAME:'covai',MYSQL_PASSWORD:password,MYSQL_PASS:password,MYSQL_ROOT_PASSWORD:password,MYSQL_DATABASE:'covai_test',MYSQL_DB:'covai_test',MYSQL_URL:dbUrl,MYSQL_URI:dbUrl,
                PGHOST:dbHost,PGPORT:portStr,PGUSER:'covai',PGPASSWORD:password,PGDATABASE:'covai_test',
                POSTGRES_HOST:dbHost,POSTGRES_PORT:portStr,POSTGRES_USER:'covai',POSTGRES_PASSWORD:password,POSTGRES_DB:'covai_test',POSTGRES_DATABASE:'covai_test',POSTGRES_URL:dbUrl,POSTGRES_URI:dbUrl,POSTGRESQL_URL:dbUrl,POSTGRESQL_URI:dbUrl,
                TYPEORM_CONNECTION:mysql?'mysql':'postgres',TYPEORM_HOST:dbHost,TYPEORM_PORT:portStr,TYPEORM_USERNAME:'covai',TYPEORM_PASSWORD:password,TYPEORM_DATABASE:'covai_test',
            });
        } else if(engine==='mongodb') {
            const result=await start({kind:'mongodb',port:27017,image:'mongo:7',command:['--replSet','covai_test','--bind_ip_all','--wiredTigerCacheSizeGB','0.25'],
                probe:name=>['exec',name,'mongosh','--quiet','--eval','if(!db.adminCommand({ping:1}).ok)quit(1)'],
                initialize:(name, connectHost)=>['exec',name,'mongosh','--quiet','--eval',`rs.initiate({_id:"covai_test",members:[{_id:0,host:"${connectHost}:27017"}]});while(!db.hello().isWritablePrimary){sleep(100)}`]});
            const url=`mongodb://${result.host}:${result.port}/covai_test?directConnection=true`;
            Object.assign(environment,{DATABASE_URL:url,DB_URI:url,DB_URL:url,MONGO_URL:url,MONGO_URI:url,MONGODB_URI:url,MONGODB_URL:url,MONGO_CONNECTION_STRING:url,MONGODB_CONNECTION_STRING:url,MONGO_HOST:result.host,MONGO_PORT:String(result.port),MONGO_DB:'covai_test',MONGO_DATABASE:'covai_test',MONGODB_DB:'covai_test',MONGODB_DATABASE:'covai_test',DB_NAME:'covai_test',DB_DATABASE:'covai_test'});
        } else if(engine==='sqlite') {
            const directory=path.join(rootDir,'.covai-system-test','database',crypto.randomUUID());fs.mkdirSync(directory,{recursive:true});sqliteDirectory=directory;
            const file=path.join(directory,'covai_test.db').replaceAll('\\','/');
            // Some Windows Prisma engines cannot create a missing SQLite file;
            // provision it explicitly instead of treating that as project ENV.
            fs.closeSync(fs.openSync(file,'wx'));
            Object.assign(environment,{DATABASE_URL:'file:'+file,SQLITE_DB_PATH:file,DB_FILE:file,DB_PATH:file,SQLITE_PATH:file,SQLITE_FILE:file,DATABASE_PATH:file,DATABASE_FILE:file,STORAGE_PATH:file,DB_STORAGE:file,DB_NAME:file,DB_DATABASE:file});
        } else if(engine)throw new ServiceError(`No isolated runtime adapter exists for database engine ${engine}`,422);
        if(services?.redis) {
            const result=await start({kind:'redis',port:6379,image:'redis:7',tmpfs:'/data:rw,noexec,nosuid,size=128m',command:['redis-server','--save','','--appendonly','no'],probe:name=>['exec',name,'redis-cli','ping']});
            const redisUrl=`redis://${result.host}:${result.port}`;
            Object.assign(environment,{REDIS_URL:redisUrl,REDIS_URI:redisUrl,CACHE_URL:redisUrl,REDIS_HOST:result.host,REDIS_PORT:String(result.port)});
        }
        return {environment,sqlContainer,engine,cleanup};
    } catch(error){await cleanup().catch(()=>{});throw error;}
};
