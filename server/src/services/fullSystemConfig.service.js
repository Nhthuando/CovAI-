import fs from 'node:fs';
import path from 'node:path';
import { ServiceError } from '../utils/serviceError.js';

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
  if (!['mysql','postgres'].includes(config.database?.engine) || ![config.database?.initSql,config.backend?.directory,config.backend?.healthPath,config.frontend?.directory].every(value=>typeof value==='string' && value.trim())) {
    throw new ServiceError('Full system requires a database engine/initSql, backend directory/healthPath, and frontend directory',422);
  }
  for (const item of [config.frontend.directory, config.backend.directory, config.database.initSql]) containedPath(rootDir,item);
  if (!config.backend.healthPath.startsWith('/') || config.backend.healthPath.startsWith('//')) throw new ServiceError('Backend healthPath must be a local path',422);
  return config;
};

export const resolveSystemRepositoryRoot = rootDir => {
 const root = fs.realpathSync(rootDir);
 if (fs.existsSync(path.join(root, '.covai/system-test.json'))) return root;
 const parent = path.dirname(root);
 if (/^(server|backend|api)$/i.test(path.basename(root)) && fs.existsSync(path.join(parent, '.git'))) {
   const relative = path.relative(fs.realpathSync(parent), root);
   if (relative.startsWith('..') || path.isAbsolute(relative)) throw new ServiceError('Repository root escapes the snapshot',422);
   return fs.realpathSync(parent);
 }
 return root;
};
