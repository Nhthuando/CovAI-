import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { startAutServer, stopAutServer, resolveAvailableAutPort } from './autLifecycle.service.js';
import { ServiceError } from '../utils/serviceError.js';

const exec = promisify(execFile);
const docker = (args, options = {}) => exec('docker', args, {timeout: 120000, windowsHide:true, maxBuffer: 2 * 1024 * 1024, ...options});
export const containedPath = (root, relative) => {
  const resolved = path.resolve(root, relative || '.');
  const rel = path.relative(path.resolve(root), resolved);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new ServiceError('System configuration path must remain inside the snapshot', 422);
  let ancestor=resolved;
  while (!fs.existsSync(ancestor) && ancestor !== path.dirname(ancestor)) ancestor=path.dirname(ancestor);
  if (fs.existsSync(ancestor)) {
    const real = fs.realpathSync(ancestor);
    const realRel = path.relative(fs.realpathSync(root), real);
    if (realRel === '..' || realRel.startsWith(`..${path.sep}`) || path.isAbsolute(realRel)) throw new ServiceError('System configuration symlink escapes the snapshot', 422);
  }
  return resolved;
};

export const readFullSystemConfig = (rootDir) => {
  const file = containedPath(rootDir, '.covai/system-test.json');
  if (!fs.existsSync(file)) throw new ServiceError('Full system requires .covai/system-test.json with frontend, backend, database and schema configuration. No mock fallback was used.', 422);
  let config;
  try { config = JSON.parse(fs.readFileSync(file,'utf8')); } catch { throw new ServiceError('Invalid .covai/system-test.json',422); }
  if(!config || typeof config !== 'object' || Array.isArray(config)) throw new ServiceError('System test configuration must be a JSON object.',422);
  if (!['mysql','postgres'].includes(config.database?.engine) || ![config.database?.initSql,config.backend?.directory,config.backend?.healthPath,config.frontend?.directory].every(value=>typeof value==='string' && value.trim())) {
    throw new ServiceError('Full system requires a database engine/initSql, backend directory/healthPath, and frontend directory',422);
  }
  for (const item of [config.frontend.directory, config.backend.directory, config.database.initSql]) containedPath(rootDir,item);
  if (!config.backend.healthPath.startsWith('/') || config.backend.healthPath.startsWith('//')) throw new ServiceError('Backend healthPath must be a local path',422);
  return config;
};

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

export const startFullSystem = async ({rootDir,jobId}) => {
  const config = readFullSystemConfig(rootDir);
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
  } catch (error) {await cleanup();throw new ServiceError(`Full system setup failed: ${error.message.replaceAll(password,'[redacted]')}`,error.statusCode || 422);}
};
