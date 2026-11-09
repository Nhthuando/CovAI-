import {discoverReadinessPaths} from './fullSystemReadiness.service.js';

const frontendTools=['vite','next','nuxt','astro','react-scripts','@vue/cli-service','@sveltejs/kit','@angular/core','parcel','@remix-run/dev','@react-router/dev','webpack-dev-server','@rsbuild/core','@rspack/cli'];
const backendTools=['express','fastify','koa','@hapi/hapi','@nestjs/core','hono','@adonisjs/core','restify','polka','micro'];
const sqlTools=['mysql','mysql2','pg','postgres','sequelize','knex','typeorm','drizzle-orm','@prisma/client','better-sqlite3','sqlite3','mongodb','mongoose'];
const deps=pkg=>pkg.dependencies || {};
// Package boundaries matter even when the repository root is itself runnable.
// A root task orchestrator must not inherit a child application's HTTP imports,
// schema, credentials or database driver usage.
export const systemPackageFiles = (source, pkg) => {
    const prefix=pkg.directory==='.'?'':pkg.directory+'/';
    const nested=source.packages.filter(other=>other!==pkg && other.directory!==pkg.directory && other.directory.startsWith(prefix)).map(other=>other.directory+'/');
    return source.files.filter(file=>file.path.startsWith(prefix) && !nested.some(directory=>file.path.startsWith(directory)));
};
const dropOrchestratorRoot = (source, candidates) => {
    if (candidates.length <= 1 || !candidates.some(pkg => pkg.directory !== '.')) return candidates;
    return candidates.filter(pkg => pkg.directory !== '.' || systemPackageFiles(source, pkg).some(file => !file.path.endsWith('package.json')));
};
export const inferFullSystemPlan = (source,{allowSchemaDraft=false}={}) => {
    const runnable=source.packages.filter(pkg=>['dev','start','serve','preview'].some(key=>typeof pkg.scripts?.[key]==='string'));
    const fronts=dropOrchestratorRoot(source, runnable.filter(pkg=>frontendTools.some(name=>deps(pkg)[name]) || /\b(?:vite|next|nuxt|astro|react-scripts|ng serve|parcel|webpack)\b/.test(Object.values(pkg.scripts).join(' '))));
    const backs=dropOrchestratorRoot(source, runnable.filter(pkg=>backendTools.some(name=>deps(pkg)[name]) || systemPackageFiles(source,pkg).some(file=>/(?:from\s*|require\s*\()\s*['"](?:node:)?(?:http|https)['"]/.test(file.content))));
    if(fronts.length>1 || backs.length>1 || (!fronts.length&&!backs.length))return null;
    const frontend=fronts[0] || backs[0],backend=backs[0] || (fronts.length===1?fronts[0]:null);
    const prefix=backend.directory==='.'?'':backend.directory+'/';
    const files=systemPackageFiles(source,backend);
    const dependencies=deps(backend);
    const schemas=files.filter(file=>[prefix+'prisma/schema.prisma',prefix+'schema.prisma'].includes(file.path));
    let database=null;
    if(dependencies['@prisma/client']) {
        if(schemas.length!==1)return null;
        const provider=schemas[0].content.match(/datasource\s+\w+\s*\{[^}]*\bprovider\s*=\s*"(mysql|postgresql|sqlite|mongodb)"/)?.[1];
        if(!provider)return null;
        database={engine:provider==='postgresql'?'postgres':provider,prismaSchema:schemas[0].path,schemaStrategy:'push'};
    } else if(dependencies.mongoose || dependencies.mongodb)database={engine:'mongodb'};
    else if(dependencies['better-sqlite3'] || dependencies.sqlite3 || files.some(file=>/['"]node:sqlite['"]/.test(file.content))) {
        const sql=files.filter(file=>/\/(?:init|schema)\.sql$|^(?:init|schema)\.sql$/.test(file.path));
        if(sql.length>1)return null;
        database={engine:'sqlite',...(sql.length?{initSql:sql[0].path}:{})};
    }
    else if(sqlTools.some(name=>dependencies[name])) {
        const mysql=Boolean(dependencies.mysql || dependencies.mysql2),postgres=Boolean(dependencies.pg || dependencies.postgres);
        const sql=files.filter(file=>/\/(?:init|schema)\.sql$|^(?:init|schema)\.sql$/.test(file.path));
        if(mysql===postgres || sql.length>1)return null;
        if(!sql.length && (!allowSchemaDraft || !files.some(file=>/\b(?:SELECT\b[\s\S]+?\bFROM|INSERT\s+INTO|UPDATE\s+["`\w]+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|sequelize\.define\b|createTable\s*\(|(?:pg|mysql)Table\s*\()\b/i.test(file.content))))return null;
        database={engine:mysql?'mysql':'postgres',initSql:sql[0]?.path || '.covai/generated-schema.sql'};
    }
    const readiness=discoverReadinessPaths(files);
    const explicitHealth=readiness.find(value=>/\/(?:health|healthz|ready|readyz)$/.test(value));
    const config={frontend:{directory:frontend.directory},backend:{directory:backend.directory,healthPath:explicitHealth || readiness[0] || '/',...(!explicitHealth?{readiness:'http'}:{})},database};
    if(!fronts.length)config.backendOnly=true;
    if(!backs.length)config.frontendOnly=true;
    if(frontend===backend)config.unified=true;
    if(['redis','ioredis','bullmq','bull'].some(name=>dependencies[name]))config.services={redis:true};
    return config;
};
