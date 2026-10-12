import fs from 'node:fs';
import path from 'node:path';
import { dockerRunner } from './dockerRunner.service.js';
import { ServiceError } from '../utils/serviceError.js';
import { parse } from 'dotenv';

export const readApplicationEnvironment = directory => {
    const env = {};
    for (const name of ['.env','.env.test']) {
        const file=path.join(directory,name);
        if (fs.existsSync(file)) Object.assign(env,parse(fs.readFileSync(file,'utf8')));
    }
    return env;
};

export const prepareFullSystemPackage = async ({directory, env, jobId, database = false}) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    const run = async (command, label) => {
        const result = await dockerRunner.run({snapshotPath:directory,command,jobId,forceHost:true,timeoutMs:600000,
            env:{...env,NODE_ENV:'development',PATH:process.env.PATH || '',NODE_PATH:''}});
        if (!result.success) {
            let detail = (result.stderr || result.stdout || '').replace(/\x1b\[[0-9;]*m/g,'').trim();
            for (const [key,value] of Object.entries(env)) if (value && /PASSWORD|SECRET|TOKEN|KEY|URL/.test(key)) detail=detail.replaceAll(value,'[redacted]');
            throw new ServiceError(`${label} failed. ${detail.slice(0,2000)}`,422);
        }
    };
    await run('npm install --include=dev --prefer-offline --legacy-peer-deps --no-audit --no-fund --progress=false','Application dependency installation');
    const deps={...pkg.dependencies,...pkg.devDependencies};
    if (!database || !deps['@prisma/client']) return;
    const schema = ['prisma/schema.prisma','schema.prisma'].map(file=>path.join(directory,file)).find(file=>fs.existsSync(file));
    if (!schema) throw new ServiceError('This backend uses Prisma but its schema.prisma is missing. Include the Prisma schema in the uploaded project.',422);
    const content=fs.readFileSync(schema,'utf8');
    const datasource=content.match(/datasource\s+\w+\s*\{([\s\S]*?)\}/)?.[1] || '';
    const variable=datasource.match(/\burl\s*=\s*env\("([A-Za-z_]\w*)"\)/)?.[1];
    if (!variable) throw new ServiceError('Automatic Prisma database setup requires the datasource URL to use an environment variable, such as env("DATABASE_URL"). Configure the schema for the isolated test database.',422);
    env[variable]=env.DATABASE_URL;
    const cli=path.join(directory,'node_modules/prisma/build/index.js');
    if (!fs.existsSync(cli)) throw new ServiceError('Prisma CLI is missing. Add prisma to the backend dependencies or devDependencies.',422);
    const command=`"${process.execPath}" "${cli}"`;
    await run(`${command} generate --schema "${schema}"`,'Prisma Client generation');
    const migrations=path.join(path.dirname(schema),'migrations');
    const hasMigrations=fs.existsSync(migrations) && fs.readdirSync(migrations,{withFileTypes:true}).some(item=>item.isDirectory() && fs.existsSync(path.join(migrations,item.name,'migration.sql')));
    await run(`${command} ${hasMigrations ? 'migrate deploy' : 'db push --accept-data-loss'} --schema "${schema}"`,'Isolated test database schema setup');
};
