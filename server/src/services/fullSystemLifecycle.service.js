import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { startAutServer, stopAutServer, resolveAvailableAutPort } from './autLifecycle.service.js';
import { ServiceError } from '../utils/serviceError.js';

const exec = promisify(execFile);
const docker = (args, options = {}) => exec('docker', args, {timeout: 120000, windowsHide:true, maxBuffer: 2 * 1024 * 1024, ...options});
import { containedPath } from './fullSystemConfig.service.js';
import { ensureFullSystemSetup } from './fullSystemSetup.service.js';
export { containedPath, readFullSystemConfig } from './fullSystemConfig.service.js';

const writeSql = (container, engine, password, sql) => new Promise((resolve,reject) => {
  const args = engine === 'mysql'
    ? ['exec','-i','-e',`MYSQL_PWD=${password}`,container,'mysql','-ucovai','covai_test']
    : ['exec','-i','-e',`PGPASSWORD=${password}`,container,'psql','-U','covai','-d','covai_test','-v','ON_ERROR_STOP=1'];
  const child = spawn('docker',args,{windowsHide:true,stdio:['pipe','ignore','pipe']});
  let error='';
  child.stderr.on('data',chunk => {error += chunk.toString();});
  child.once('error',reject);
  child.stdin.on('error',() => {});
  child.stdin.end(sql);
  const timer = setTimeout(() => {child.kill();reject(new ServiceError('Test database initialization timed out',408));},30000);
  child.once('close',code => {clearTimeout(timer);code === 0 ? resolve() : reject(new ServiceError(`Test database initialization failed: ${error.replaceAll(password,'[redacted]')}`,422));});
});

export const startFullSystem = async ({rootDir,jobId,onProgress}) => {
  const setup = await ensureFullSystemSetup({rootDir,onProgress});
  rootDir = setup.rootDir;
  const config = setup.config;
  try { await docker(['info'],{timeout:10000}); } catch { throw new ServiceError('Full Stack needs Docker running to create an isolated test database. Start Docker Desktop and retry.',422); }
  const engine = config.database.engine;
  const container = `covai-system-${crypto.randomUUID()}`;
  const password = crypto.randomBytes(24).toString('hex');
  const handles=[];
  let created=false;
  const cleanup = async () => {
    const failures=[];
    for (const handle of handles.reverse()) {
      try { await stopAutServer(handle.pid,handle.port,jobId); } catch (error) {failures.push(error.message);}
    }
    if (created) {try {await docker(['rm','-f',container]);} catch {failures.push('Could not remove owned test database container');}}
    if (failures.length) throw new ServiceError(failures.join('; '),500);
  };
  try {
    const port = engine === 'mysql' ? 3306 : 5432;
    const env = engine === 'mysql'
      ? ['-e',`MYSQL_ROOT_PASSWORD=${password}`,'-e','MYSQL_DATABASE=covai_test','-e','MYSQL_USER=covai','-e',`MYSQL_PASSWORD=${password}`]
      : ['-e','POSTGRES_DB=covai_test','-e','POSTGRES_USER=covai','-e',`POSTGRES_PASSWORD=${password}`];
    created=true;
    await docker(['run','-d','--name',container,'--label','covai.system-test=true','-p',`127.0.0.1::${port}`,...env,engine === 'mysql' ? 'mysql:8.4' : 'postgres:17']);
    const mapped = await docker(['port',container,`${port}/tcp`]);
    const databasePort=Number(mapped.stdout.trim().split(':').at(-1));
    let ready=false;
    for (let attempt=0;attempt<90;attempt++) {
      try {
        await docker(engine === 'mysql'
          ? ['exec','-e',`MYSQL_PWD=${password}`,container,'mysql','-ucovai','covai_test','-e','SELECT 1']
          : ['exec',container,'pg_isready','-U','covai','-d','covai_test'],{timeout:3000});
        ready=true;break;
      } catch {await new Promise(resolve => setTimeout(resolve,1000));}
    }
    if (!ready) throw new ServiceError('Disposable test database did not become ready',408);
    await writeSql(container,engine,password,fs.readFileSync(containedPath(rootDir,config.database.initSql),'utf8'));
    const backendDir=containedPath(rootDir,config.backend.directory);
    const backendPort=await resolveAvailableAutPort(backendDir,4500);
    const databaseUrl=`${engine === 'mysql' ? 'mysql' : 'postgresql'}://covai:${password}@127.0.0.1:${databasePort}/covai_test`;
    const backend=await startAutServer({snapshotDir:backendDir,port:backendPort,jobId,healthPath:config.backend.healthPath,requireHealthy:true,env:{DATABASE_URL:databaseUrl,DB_HOST:'127.0.0.1',DB_PORT:String(databasePort),DB_USER:'covai',DB_PASSWORD:password,DB_NAME:'covai_test'}});
    if (!backend.started) throw new ServiceError('No backend start script found',422);
    handles.push(backend);
    const frontendDir=containedPath(rootDir,config.frontend.directory);
    const frontendPort=await resolveAvailableAutPort(frontendDir,4173);
    const backendUrl=`http://127.0.0.1:${backendPort}`;
    const frontend=await startAutServer({snapshotDir:frontendDir,port:frontendPort,jobId,requireHealthy:true,env:{VITE_API_URL:backendUrl,VITE_API_BASE_URL:backendUrl}});
    if (!frontend.started) throw new ServiceError('No frontend start script found',422);
    handles.push(frontend);
    return {frontendPort,backendUrl,cleanup};
  } catch (error) {await cleanup().catch(() => {});throw new ServiceError(`Full system setup failed: ${error.message.replaceAll(password,'[redacted]')}`,error.statusCode || 422);}
};
