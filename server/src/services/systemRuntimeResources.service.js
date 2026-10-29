import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ServiceError} from '../utils/serviceError.js';
import {operationAbortReason} from './systemOperationError.service.js';
const exec=promisify(execFile);

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
    const start=async({kind,port,image,env=[],command=[],probe,initialize})=>{
        check();
        const name=`covai-system-${kind}-${crypto.randomUUID()}`;
        owned.push(name);
        try{await docker(['run','-d','--name',name,'--label','covai.system-test=true','-p',`127.0.0.1::${port}`,...env,image,...command],{signal});}
        catch(cause){check();const error=new ServiceError(`Could not start the isolated ${kind} service.`,503);error.code='SYSTEM_RUNTIME_SERVICE_START_FAILED';error.details={service:kind,output:redact(cause.stderr || cause.message)};throw error;}
        const mapped=await docker(['port',name,`${port}/tcp`],{signal});
        const hostPort=Number(mapped.stdout.trim().split(':').at(-1));
        if(!Number.isInteger(hostPort)||hostPort<1)throw new ServiceError('Could not resolve owned test-service port',500);
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
        if(initialize)await docker(initialize(name),{timeout:15000});
        return {name,port:hostPort};
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
        }
        if(engine==='mysql' || engine==='postgres') {
            const password=crypto.randomBytes(24).toString('hex');
            secrets.push(password);
            const mysql=engine==='mysql';
            const result=await start({kind:engine,port:mysql?3306:5432,image:mysql?'mysql:8.4':'postgres:17',
                env:mysql?['-e',`MYSQL_ROOT_PASSWORD=${password}`,'-e','MYSQL_DATABASE=covai_test','-e','MYSQL_USER=covai','-e',`MYSQL_PASSWORD=${password}`]:['-e','POSTGRES_DB=covai_test','-e','POSTGRES_USER=covai','-e',`POSTGRES_PASSWORD=${password}`],
                probe:name=>mysql?['exec','-e',`MYSQL_PWD=${password}`,name,'mysql','-h127.0.0.1','-ucovai','covai_test','-e','SELECT 1']:['exec',name,'pg_isready','-h','127.0.0.1','-U','covai','-d','covai_test']});
            sqlContainer=result.name;
            Object.assign(environment,{DATABASE_URL:`${mysql?'mysql':'postgresql'}://covai:${password}@127.0.0.1:${result.port}/covai_test`,DB_HOST:'127.0.0.1',DB_PORT:String(result.port),DB_USER:'covai',DB_PASSWORD:password,DB_NAME:'covai_test',PGHOST:'127.0.0.1',PGPORT:String(result.port),PGUSER:'covai',PGPASSWORD:password,PGDATABASE:'covai_test'});
        } else if(engine==='mongodb') {
            const result=await start({kind:'mongodb',port:27017,image:'mongo:7',command:['--replSet','covai_test','--bind_ip_all'],
                probe:name=>['exec',name,'mongosh','--quiet','--eval','if(!db.adminCommand({ping:1}).ok)quit(1)'],
                initialize:name=>['exec',name,'mongosh','--quiet','--eval','rs.initiate({_id:"covai_test",members:[{_id:0,host:"127.0.0.1:27017"}]});while(!db.hello().isWritablePrimary){sleep(100)}']});
            const url=`mongodb://127.0.0.1:${result.port}/covai_test?directConnection=true`;
            Object.assign(environment,{DATABASE_URL:url,MONGO_URL:url,MONGO_URI:url,MONGODB_URI:url,MONGODB_URL:url});
        } else if(engine==='sqlite') {
            const directory=path.join(rootDir,'.covai-system-test','database',crypto.randomUUID());fs.mkdirSync(directory,{recursive:true});sqliteDirectory=directory;
            const file=path.join(directory,'covai_test.db').replaceAll('\\','/');
            // Some Windows Prisma engines cannot create a missing SQLite file;
            // provision it explicitly instead of treating that as project ENV.
            fs.closeSync(fs.openSync(file,'wx'));
            Object.assign(environment,{DATABASE_URL:'file:'+file,SQLITE_DB_PATH:file,DB_FILE:file,DB_PATH:file,SQLITE_PATH:file,SQLITE_FILE:file});
        } else if(engine)throw new ServiceError(`No isolated runtime adapter exists for database engine ${engine}`,422);
        if(services?.redis) {
            const result=await start({kind:'redis',port:6379,image:'redis:7',command:['redis-server','--save','','--appendonly','no'],probe:name=>['exec',name,'redis-cli','ping']});
            Object.assign(environment,{REDIS_URL:`redis://127.0.0.1:${result.port}`,REDIS_HOST:'127.0.0.1',REDIS_PORT:String(result.port)});
        }
        return {environment,sqlContainer,engine,cleanup};
    } catch(error){await cleanup().catch(()=>{});throw error;}
};
