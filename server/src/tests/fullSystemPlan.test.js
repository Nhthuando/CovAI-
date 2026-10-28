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
