import fs from 'node:fs';
import path from 'node:path';
import { ServiceError } from '../utils/serviceError.js';
import {isWorkspaceMember} from '../utils/projectWorkspace.js';

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

export const readFullSystemConfig = (rootDir, {allowMissing = false} = {}) => {
  rootDir = resolveSystemRepositoryRoot(rootDir);
  const file = containedPath(rootDir, '.covai/system-test.json');
  if (!fs.existsSync(file) && allowMissing) return null;
  if (!fs.existsSync(file)) throw new ServiceError('Full Stack is not configured. Add .covai/system-test.json with frontend, backend, database and schema configuration. Choose Frontend Dev Server to run browser tests without this setup.', 422);
  let config;
  try { config = JSON.parse(fs.readFileSync(file,'utf8')); } catch { throw new ServiceError('Invalid .covai/system-test.json',422); }
  if(!config || typeof config !== 'object' || Array.isArray(config)) throw new ServiceError('System test configuration must be a JSON object.',422);
  for(const flag of ['unified','frontendOnly','backendOnly'])if(config[flag]!==undefined && typeof config[flag]!=='boolean')throw new ServiceError('Application topology flags must be boolean',422);
  if(config.unified && config.frontend?.directory!==config.backend?.directory)throw new ServiceError('A unified application must use the same frontend and backend directory',422);
  if(config.backend?.readiness!==undefined && config.backend.readiness!=='http')throw new ServiceError('Unsupported application readiness policy',422);
  if(config.services && (typeof config.services!=='object' || Array.isArray(config.services) || Object.keys(config.services).some(key=>key!=='redis') || config.services.redis!==undefined && typeof config.services.redis!=='boolean'))throw new ServiceError('Unsupported local test-service configuration',422);
  if(config.database===null) {
    if(![config.frontend?.directory,config.backend?.directory,config.backend?.healthPath].every(value=>typeof value==='string' && value.trim()))throw new ServiceError('Automatic system configuration requires application directories and readiness path',422);
    for(const item of [config.frontend.directory,config.backend.directory])containedPath(rootDir,item);
    if(!config.backend.healthPath.startsWith('/') || config.backend.healthPath.startsWith('//'))throw new ServiceError('Backend healthPath must be a local path',422);
    return config;
  }
  if(['mongodb','sqlite'].includes(config.database?.engine) && !config.database.prismaSchema) {
    if(![config.frontend?.directory,config.backend?.directory,config.backend?.healthPath].every(value=>typeof value==='string' && value.trim()))throw new ServiceError('MongoDB system configuration requires application directories and readiness path',422);
    for(const item of [config.frontend.directory,config.backend.directory])containedPath(rootDir,item);
    if(config.database.initSql)containedPath(rootDir,config.database.initSql);
    if(!config.backend.healthPath.startsWith('/') || config.backend.healthPath.startsWith('//'))throw new ServiceError('Backend healthPath must be a local path',422);
    return config;
  }
  const schemaPath=config.database?.prismaSchema ?? config.database?.initSql;
  if (!['mysql','postgres','sqlite','mongodb'].includes(config.database?.engine) || ![schemaPath,config.backend?.directory,config.backend?.healthPath,config.frontend?.directory].every(value=>typeof value==='string' && value.trim())) {
    throw new ServiceError('Full system requires a database engine/initSql, backend directory/healthPath, and frontend directory',422);
  }
  for (const item of [config.frontend.directory, config.backend.directory, schemaPath]) containedPath(rootDir,item);
  if(config.database.prismaSchema && !/\.prisma$/.test(config.database.prismaSchema))throw new ServiceError('Prisma schema path must reference a .prisma file inside the snapshot',422);
  if(config.database.schemaStrategy && !['push','migrate'].includes(config.database.schemaStrategy))throw new ServiceError('Unsupported database schema strategy',422);
  if (!config.backend.healthPath.startsWith('/') || config.backend.healthPath.startsWith('//')) throw new ServiceError('Backend healthPath must be a local path',422);
  return config;
};

export const resolveSystemRepositoryRoot = rootDir => {
 const root = fs.realpathSync(rootDir);
 if (fs.existsSync(path.join(root, '.covai/system-test.json'))) return root;
 // An ingestion/analysis step may select a deeply nested workspace package.
 // A containing workspace must explicitly claim it before we widen the scope.
 for(let ancestor=path.dirname(root),depth=0;ancestor!==path.dirname(ancestor)&&depth<8;ancestor=path.dirname(ancestor),depth++) {
   const file=path.join(ancestor,'package.json');
   if(!fs.existsSync(file))continue;
   let pkg;try{pkg=JSON.parse(fs.readFileSync(file,'utf8'));}catch{continue;}
   if(isWorkspaceMember(ancestor,pkg,path.relative(ancestor,root).replaceAll('\\','/')))return fs.realpathSync(ancestor);
 }
 const parent = path.dirname(root);
 const hasFrontendSibling = ['client','frontend','web'].some(name => fs.existsSync(path.join(parent,name,'package.json')));
 if (/^(server|backend|api)$/i.test(path.basename(root)) && (fs.existsSync(path.join(parent, '.git')) || hasFrontendSibling)) {
   const relative = path.relative(fs.realpathSync(parent), root);
   if (relative.startsWith('..') || path.isAbsolute(relative)) throw new ServiceError('Repository root escapes the snapshot',422);
   return fs.realpathSync(parent);
 }
 return root;
};
