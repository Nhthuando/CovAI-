import { systemTestEnvironmentDirectory } from './systemTestEnvironmentRoot.service.js';
import { readSystemTestSecrets, redactSystemTestSecrets } from './systemTestSecrets.service.js';
import { containedPath } from './fullSystemConfig.service.js';
import fs from 'node:fs';
import path from 'node:path';
import { dockerRunner } from './dockerRunner.service.js';
import { ServiceError } from '../utils/serviceError.js';
import { parse } from 'dotenv';
import { prepareProjectDependencies } from './projectDependencies.service.js';
import {resolveProjectPrismaCli} from '../utils/projectPrismaCli.js';
import { isOwnedIsolatedDatabaseHost } from './systemRuntimeResources.service.js';

export const readApplicationEnvironment = directory => {
    const original=systemTestEnvironmentDirectory(directory);
    if(original!==directory)return readAssessmentTestEnvironment(directory);
    const env = {};
    for (const name of ['.env','.env.test']) {
        const file=path.join(directory,name);
        if (fs.existsSync(file)) Object.assign(env,parse(fs.readFileSync(file,'utf8')));
    }
    return env;
};

// Measurement copies exclude credential files. Read the explicitly configured
// test environment from the owned original snapshot into process memory only.
export const readAssessmentTestEnvironmentFile = directory => {
    const file = containedPath(systemTestEnvironmentDirectory(directory), '.env.test');
    if(!fs.existsSync(file))return {};
    if(!fs.statSync(file).isFile() || fs.statSync(file).size>64*1024)throw new ServiceError('The test environment file must be a text file up to 64 KiB.',422);
    return parse(fs.readFileSync(file,'utf8'));
};

export const readAssessmentTestEnvironment = directory => ({
    ...readAssessmentTestEnvironmentFile(directory),
    ...readSystemTestSecrets(directory),
});

export const prepareFullSystemPackage = async ({directory, repositoryRoot=directory, env={}, jobId, database = false, signal, schemaStrategy, prismaSchema}) => {
    const isMockDb = env.COVAI_MOCK_DB === 'true';
    if(database && schemaStrategy==='push' && !isMockDb) {
        let url;try{url=new URL(env.DATABASE_URL);}catch{}
        const sqlite=url?.protocol==='file:' && env.SQLITE_DB_PATH && env.DATABASE_URL==='file:'+env.SQLITE_DB_PATH.replaceAll('\\','/') && path.resolve(env.SQLITE_DB_PATH).startsWith(path.resolve(repositoryRoot)+path.sep) && path.basename(env.SQLITE_DB_PATH)==='covai_test.db';
        const mongo=url?.protocol==='mongodb:' && isOwnedIsolatedDatabaseHost(url.hostname) && url.pathname==='/covai_test';
        if(!sqlite && !mongo && (!url || !isOwnedIsolatedDatabaseHost(url.hostname) || url.pathname!=='/covai_test' || url.username!=='covai'))throw new ServiceError('Schema synchronization requires the owned isolated test database',422);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    const run = async (command, label) => {
        const cleanEnv = { ...env };
        delete cleanEnv.NODE_OPTIONS;
        const result = await dockerRunner.run({snapshotPath:directory,command,jobId,forceHost:true,isolatedEnv:true,timeoutMs:600000,signal,
            env:{...cleanEnv,NODE_ENV:'development',PATH:process.env.PATH || '',NODE_PATH:''}});
        if (!result.success) {
            let detail = redactSystemTestSecrets([result.stderr,result.stdout].filter(Boolean).join('\n').replace(/\x1b\[[0-9;]*m/g,'').trim());
            for (const [key,value] of Object.entries(env)) if (value && /PASSWORD|SECRET|TOKEN|KEY|URL/.test(key)) detail=detail.replaceAll(value,'[redacted]');
            throw new ServiceError(`${label} failed. ${detail.slice(0,2000)}`,422);
        }
    };
    const runtime=await prepareProjectDependencies({directory,repositoryRoot,env,jobId,signal});
    // npm can report success while dropping Rollup's optional Windows binary.
    // Reconcile that exact declared binary in the disposable workspace only.
    const rollupMetadata = path.join(directory, 'node_modules/rollup/package.json');
    if (process.platform === 'win32' && process.arch === 'x64' && fs.existsSync(rollupMetadata)) {
        const nativePackage = '@rollup/rollup-win32-x64-msvc';
        const rollup = JSON.parse(fs.readFileSync(rollupMetadata, 'utf8'));
        const nativeVersion = rollup.optionalDependencies?.[nativePackage];
        if (!fs.existsSync(path.join(directory, 'node_modules', nativePackage)) && /^\d+\.\d+\.\d+$/.test(nativeVersion || '')) {
            if(runtime.manager==='npm')await run(`${runtime.command} install --no-save --include=optional --no-audit --no-fund ${nativePackage}@${nativeVersion}`, 'Rollup Windows runtime installation');
        }
    }
    const deps={...pkg.dependencies,...pkg.devDependencies};
    if (!database || !deps['@prisma/client']) return;
    const schema = prismaSchema || ['prisma/schema.prisma','schema.prisma'].map(file=>path.join(directory,file)).find(file=>fs.existsSync(file));
    if (!schema) throw new ServiceError('This backend uses Prisma but its schema.prisma is missing. Include the Prisma schema in the uploaded project.',422);
    const content=fs.readFileSync(schema,'utf8');
    const datasource=content.match(/datasource\s+\w+\s*\{([\s\S]*?)\}/)?.[1] || '';
    const variable=datasource.match(/\burl\s*=\s*env\("([A-Za-z_]\w*)"\)/)?.[1];
    if (!variable && !isMockDb) throw new ServiceError('Automatic Prisma database setup requires the datasource URL to use an environment variable, such as env("DATABASE_URL"). Configure the schema for the isolated test database.',422);
    if (variable) env[variable]=env.DATABASE_URL;
    if (isMockDb) return;
    const cli=resolveProjectPrismaCli(directory,repositoryRoot);
    const command=`"${process.execPath}" "${cli}"`;
    await run(`${command} generate --schema "${schema}"`,'Prisma Client generation');
    const migrations=path.join(path.dirname(schema),'migrations');
    const hasMigrations=fs.existsSync(migrations) && fs.readdirSync(migrations,{withFileTypes:true}).some(item=>item.isDirectory() && fs.existsSync(path.join(migrations,item.name,'migration.sql')));
    await run(`${command} ${hasMigrations && schemaStrategy!=='push' ? 'migrate deploy' : 'db push --accept-data-loss'} --schema "${schema}"`,'Isolated test database schema setup');
};
