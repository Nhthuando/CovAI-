import {it,expect} from '@jest/globals';
import {inferFullSystemPlan} from '../services/fullSystemPlan.service.js';
const source=(dependencies={},files=[])=>({packages:[{directory:'apps/shop',scripts:{dev:'vite'},dependencies:{vite:'7'}},{directory:'services/orders',scripts:{start:'node index.js'},dependencies:{express:'5',...dependencies}}],files});
it('does not invent a database or require a custom health endpoint for an in-memory backend',()=>{
    expect(inferFullSystemPlan(source())).toMatchObject({database:null,backend:{directory:'services/orders',readiness:'http'}});
});
it.each([['sqlite','sqlite'],['mongodb','mongodb'],['mysql','mysql'],['postgresql','postgres']])('takes Prisma %s schema ownership from the source', (provider,engine)=>{
    const plan=inferFullSystemPlan(source({'@prisma/client':'6'},[{path:'services/orders/prisma/schema.prisma',content:`datasource db { provider = "${provider}" }`}]));
    expect(plan.database).toEqual({engine,prismaSchema:'services/orders/prisma/schema.prisma',schemaStrategy:'push'});
});
it('recognizes MongoDB and a Redis dependency independently',()=>{
    expect(inferFullSystemPlan(source({mongoose:'8',ioredis:'5'}))).toMatchObject({database:{engine:'mongodb'},services:{redis:true}});
});
it('uses a unique existing SQL schema without asking AI to recreate it',()=>{
    expect(inferFullSystemPlan(source({pg:'8'},[{path:'services/orders/schema.sql',content:'CREATE TABLE state(id INT);'}])).database).toEqual({engine:'postgres',initSql:'services/orders/schema.sql'});
});
it('does not guess among conflicting SQL drivers or multiple service candidates',()=>{
    expect(inferFullSystemPlan(source({pg:'8',mysql2:'3'}))).toBeNull();
    const ambiguous=source();ambiguous.packages.push({...ambiguous.packages[1],directory:'services/other'});
    expect(inferFullSystemPlan(ambiguous)).toBeNull();
});
it('represents single frontend/backend applications as one process with honest tier selection',()=>{
    const frontend=source();frontend.packages.splice(1);
    expect(inferFullSystemPlan(frontend)).toMatchObject({unified:true,frontendOnly:true,database:null});
    const backend=source();backend.packages.shift();
    expect(inferFullSystemPlan(backend)).toMatchObject({unified:true,backendOnly:true,database:null});
});
it('does not attribute a nested HTTP service to a runnable workspace orchestrator',()=>{
    const input=source({},[{path:'services/orders/index.js',content:"import http from 'node:http';"}]);
    input.packages.unshift({directory:'.',scripts:{dev:'turbo run dev'},dependencies:{}});
    expect(inferFullSystemPlan(input)).toMatchObject({frontend:{directory:'apps/shop'},backend:{directory:'services/orders'}});
});
it('does not use a nested package schema as a parent package database schema',()=>{
    const input=source({'@prisma/client':'6'},[{path:'services/orders/prisma/schema.prisma',content:'datasource db { provider = "sqlite" }'}]);
    input.packages.push({directory:'services/orders/prisma',scripts:{},dependencies:{}});
    expect(inferFullSystemPlan(input)).toBeNull();
});
it('infers a source-backed schema draft for API-only SQL projects without inventing a frontend',()=>{
    const input=source({pg:'8'},[{path:'services/orders/index.js',content:"db.query('SELECT id FROM orders')"}]);
    input.packages.shift();
    expect(inferFullSystemPlan(input,{allowSchemaDraft:true})).toMatchObject({backendOnly:true,unified:true,database:{engine:'postgres',initSql:'.covai/generated-schema.sql'}});
});
it('keeps explicit health probes strict and uses an HTTP handshake for ordinary protected routes',()=>{
    const ordinary=source({},[{path:'services/orders/index.js',content:"import express from 'express';const app=express();app.get('/orders',auth,handler);"}]);
    expect(inferFullSystemPlan(ordinary).backend).toMatchObject({healthPath:'/orders',readiness:'http'});
    ordinary.files[0].content+="app.get('/health',handler);";
    expect(inferFullSystemPlan(ordinary).backend).toEqual({directory:'services/orders',healthPath:'/health'});
});
it('ignores a root orchestrator script mentioning vite when a dedicated frontend package exists',()=>{
    const input=source({},[{path:'services/orders/index.js',content:"import express from 'express';"}]);
    input.packages.unshift({directory:'.',scripts:{dev:'concurrently "vite" "node services/orders/index.js"'},dependencies:{}});
    expect(inferFullSystemPlan(input)).toMatchObject({frontend:{directory:'apps/shop'},backend:{directory:'services/orders'}});
});
