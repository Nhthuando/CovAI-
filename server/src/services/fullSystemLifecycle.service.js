import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareFullSystemPackage, readApplicationEnvironment, readAssessmentTestEnvironment } from './fullSystemRuntime.service.js';
import { spawn } from 'node:child_process';
import { startAutServer, stopAutServer, runSeedDataIfPresent } from './autLifecycle.service.js';
import { ServiceError } from '../utils/serviceError.js';

import { containedPath } from './fullSystemConfig.service.js';
import { ensureFullSystemSetup, inspectSystemSetupSource } from './fullSystemSetup.service.js';
import { validateStartupEnvironment, buildAutomaticTestEnvironment, managedEnvironmentNames } from './fullSystemEnvironment.service.js';
import {provisionSystemResources} from './systemRuntimeResources.service.js';
import {reserveSystemPorts} from './systemRuntimePorts.service.js';
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

export const startFullSystem = async ({rootDir,jobId,onProgress,measurementPreparation,signal,environmentRoot}) => {
  const setup=await ensureFullSystemSetup({rootDir,onProgress});
  rootDir=setup.rootDir;
  const config=setup.config;
  const original=environmentRoot || measurementPreparation?.workspace?.originalRoot;
  const environment=directory=>original ? readAssessmentTestEnvironment(containedPath(original,directory)) : readApplicationEnvironment(containedPath(rootDir,directory));
  const backendDir=containedPath(rootDir,config.backend.directory),frontendDir=containedPath(rootDir,config.frontend.directory);
  const source=inspectSystemSetupSource(backendDir);
  const preliminary=buildAutomaticTestEnvironment({files:source.files,env:environment(config.backend.directory),port:4500});
  validateStartupEnvironment({files:source.files,env:preliminary,directory:config.backend.directory,scripts:source.packages.find(pkg=>pkg.directory==='.')?.scripts,managedVariables:managedEnvironmentNames(source.files,config)});
  const ports=await reserveSystemPorts(config.unified?1:2);
  const backendPort=ports[0].port,frontendPort=config.unified?backendPort:ports[1].port;
  const backendUrl=`http://127.0.0.1:${backendPort}`,frontendUrl=`http://127.0.0.1:${frontendPort}`;
  const handles=[];
  let resources;
  const cleanup=async()=>{
    const failures=[];
    for(const handle of handles.splice(0).reverse())try{await stopAutServer(handle.pid,handle.port,jobId);}catch(error){failures.push(error.message);}
    try{await resources?.cleanup();}catch(error){failures.push(error.message);}
    await Promise.all(ports.map(lease=>lease.release()));
    if(failures.length)throw new ServiceError(failures.join('; '),500);
  };
  try {
    await onProgress?.(26,'Preparing isolated application services and automatic test environment');
    resources=await provisionSystemResources({rootDir,database:config.database,services:config.services,signal});
    const backendEnv=buildAutomaticTestEnvironment({files:source.files,env:preliminary,resources:resources.environment,port:backendPort,backendUrl,frontendUrl});
    const metadata=JSON.parse(fs.readFileSync(path.join(backendDir,'package.json'),'utf8'));
    const usesPrisma=Boolean(metadata.dependencies?.['@prisma/client'] || metadata.devDependencies?.['@prisma/client']);
    if(config.database?.prismaSchema && !usesPrisma)throw new ServiceError('Configured Prisma schema requires @prisma/client in the selected backend package',422);
    if(config.database?.initSql && !usesPrisma) {
      const sql=fs.readFileSync(containedPath(rootDir,config.database.initSql),'utf8');
      if(config.database.engine==='sqlite') {
        if(/\b(?:ATTACH|DETACH|VACUUM|load_extension)\b/i.test(sql))throw new ServiceError('SQLite initialization cannot access files outside its owned test database',422);
        const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(backendEnv.SQLITE_DB_PATH);try{db.exec(sql);}finally{db.close();}
      } else await writeSql(resources.sqlContainer,config.database.engine,backendEnv.DB_PASSWORD,sql);
    }
    await onProgress?.(28,'Installing application dependencies and preparing the isolated schema');
    await prepareFullSystemPackage({directory:backendDir,repositoryRoot:rootDir,env:backendEnv,jobId,database:Boolean(config.database),signal,schemaStrategy:config.database?.schemaStrategy,prismaSchema:config.database?.prismaSchema?containedPath(rootDir,config.database.prismaSchema):undefined});
    if(config.database)await runSeedDataIfPresent({snapshotDir:backendDir,repositoryRoot:rootDir,jobId,signal,env:backendEnv,isolatedDatabase:true});
    const preload=fileURLToPath(new URL('../utils/autPortOverride.cjs',import.meta.url)).replaceAll('\\','/');
    backendEnv.COVAI_AUT_PORT=String(backendPort);
    backendEnv.NODE_OPTIONS=`--require="${preload}"`;
    if(measurementPreparation?.backendPreload)backendEnv.NODE_OPTIONS+=` --require="${measurementPreparation.backendPreload.replaceAll('\\','/')}"`;
    await ports[0].release();
    const backend=await startAutServer({snapshotDir:backendDir,repositoryRoot:rootDir,port:backendPort,jobId,healthPath:config.backend.healthPath,allowHttpNotFound:config.backend.readiness==='http',requireHealthy:true,env:backendEnv,preferStart:!config.unified,signal});
    if(!backend.started)throw new ServiceError('No application start script found',422);
    handles.push(backend);
    if(!config.unified) {
      const frontendSource=inspectSystemSetupSource(frontendDir);
      const frontendEnv=buildAutomaticTestEnvironment({files:frontendSource.files,env:environment(config.frontend.directory),port:frontendPort,backendUrl,frontendUrl});
      await prepareFullSystemPackage({directory:frontendDir,repositoryRoot:rootDir,env:frontendEnv,jobId,signal});
      await ports[1].release();
      const frontend=await startAutServer({snapshotDir:frontendDir,repositoryRoot:rootDir,port:frontendPort,jobId,requireHealthy:true,env:frontendEnv,signal});
      if(!frontend.started)throw new ServiceError('No frontend start script found',422);
      handles.push(frontend);
    }
    return {frontendPort,backendUrl,cleanup};
  } catch(error){await cleanup().catch(()=>{});let message=error.message;for(const [key,value] of Object.entries(resources?.environment || {}))if(value && /PASSWORD|SECRET|TOKEN|KEY|URL/.test(key))message=message.replaceAll(value,'[redacted]');const failure=new ServiceError(`Full system setup failed: ${message}`,error.statusCode || 422);failure.code=error.code || 'SYSTEM_RUNTIME_START_FAILED';failure.details=error.details;throw failure;}
};
