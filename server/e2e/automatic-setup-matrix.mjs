import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {startFullSystem} from '../src/services/fullSystemLifecycle.service.js';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= fileURLToPath(new URL('../.covai-temp/playwright-browsers',import.meta.url));
const {chromium}=await import('playwright');
const write=(root,name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
const cases=['no-database-jwt','fastify-no-health','unified-node-app','frontend-only','postgres-schema','mysql-schema','prisma-sqlite','prisma-sqlite-seed','node-sqlite','mongodb','mongodb-seed','redis','required-external-env','optional-external-env'].filter(name=>!process.env.COVAI_SETUP_CASES || process.env.COVAI_SETUP_CASES.split(',').includes(name));
const browser=await chromium.launch({headless:true});
const results=[];
try {
 for(const name of cases) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-auto-setup-'));let stack,page;const started=Date.now();
  try {
   const unified=name==='unified-node-app',frontOnly=name==='frontend-only';
   const backend=unified?'.':'services/catalog';
   if(!unified)write(root,'package.json',{private:true,name:'root'});
   if(!unified) {
    write(root,'apps/store/package.json',{name:'store',private:true,type:'module',scripts:{dev:'vite'},devDependencies:{vite:'^7.2.2'}});
    write(root,'apps/store/index.html','<h1>Automatic setup</h1><output>Loading</output><script type="module" src="/main.js"></script>');
    write(root,'apps/store/main.js',frontOnly?'document.querySelector("output").textContent="ready";':'fetch(import.meta.env.VITE_API_URL+"/api/status").then(response=>{if(!response.ok)throw Error(response.status);return response.json();}).then(data=>document.querySelector("output").textContent=data.value);');
   }
   if(!frontOnly) {
    const dependencies={express:'^5.1.0'};let setup='',read='"ready"';
    if(name==='no-database-jwt')setup='if(!process.env.JWT_SECRET)throw Error("JWT_SECRET required");if(process.env.JWT_SECRET.length<32)throw Error("weak secret");';
    if(name==='required-external-env')setup='if(!process.env.PAYMENT_PROVIDER_TOKEN)throw Error("External credential required");';
    if(name==='optional-external-env') {dependencies.stripe='^19.3.1';setup='const Stripe=require("stripe");if(process.env.STRIPE_SECRET_KEY){const stripe=Stripe(process.env.STRIPE_SECRET_KEY);}';}
    if(name==='postgres-schema') {dependencies.pg='^8.16.0';setup='const pool=new (require("pg").Pool)({connectionString:process.env.DATABASE_URL});await pool.query("INSERT INTO state(value) VALUES($1)",["ready"]);';read='(await pool.query("SELECT value FROM state LIMIT 1")).rows[0].value';write(root,backend+'/schema.sql','CREATE TABLE state(value TEXT NOT NULL);');}
    if(name==='mysql-schema') {dependencies.mysql2='^3.15.3';setup='const pool=require("mysql2/promise").createPool(process.env.DATABASE_URL);await pool.query("INSERT INTO state(value) VALUES(?)",["ready"]);';read='(await pool.query("SELECT value FROM state LIMIT 1"))[0][0].value';write(root,backend+'/schema.sql','CREATE TABLE state(value VARCHAR(255) NOT NULL);');}
    if(name.startsWith('prisma-sqlite')) {dependencies['@prisma/client']='6.19.0';dependencies.prisma='6.19.0';setup='const prisma=new (require("@prisma/client").PrismaClient)();'+(name.endsWith('-seed')?'':'await prisma.state.create({data:{value:"ready"}});');read='(await prisma.state.findFirst()).value';write(root,backend+'/prisma/schema.prisma','generator client {\n provider = "prisma-client-js"\n}\ndatasource db {\n provider = "sqlite"\n url = env("DATABASE_URL")\n}\nmodel State {\n id Int @id @default(autoincrement())\n value String\n}');}
    if(name.startsWith('mongodb')) {dependencies.mongoose='^8.19.0';setup='const mongoose=require("mongoose");await mongoose.connect(process.env.MONGO_URI);const State=mongoose.model("State",new mongoose.Schema({value:String}));'+(name.endsWith('-seed')?'':'await State.create({value:"ready"});');read='(await State.findOne()).value';}
    if(name==='redis') {dependencies.ioredis='^5.8.0';setup='const redis=new (require("ioredis"))(process.env.REDIS_URL);await redis.set("value","ready");';read='await redis.get("value")';}
    if(name==='node-sqlite') {setup='const db=new (require("node:sqlite").DatabaseSync)(process.env.DB_PATH);db.exec("CREATE TABLE state(value TEXT NOT NULL);INSERT INTO state VALUES(\'ready\');");';read='db.prepare("SELECT value FROM state").get().value';}
    if(name==='fastify-no-health') {delete dependencies.express;dependencies.fastify='^5.6.0';write(root,backend+'/index.js','const app=require("fastify")();app.get("/api/status",async(req,reply)=>{reply.header("Access-Control-Allow-Origin","*");return {value:"ready"};});app.listen({port:Number(process.env.PORT),host:"127.0.0.1"});');}
    else write(root,backend+'/index.js',`const express=require('express');const app=express();app.use(require('cors')());(async()=>{${setup} app.get('/api/status',async(req,res)=>{try{res.json({value:${read}});}catch(error){res.status(500).json({error:error.message});}});${unified?`app.get('/',(req,res)=>res.send('<h1>Automatic setup</h1><output>ready</output>'));`:''}app.listen(Number(process.env.PORT),'127.0.0.1');})().catch(error=>{console.error(error);process.exitCode=1;});`);
    dependencies.cors='^2.8.5';
    const scripts={start:'node index.js'};
    if(name==='mongodb-seed'){scripts.seed='node seed.js';write(root,backend+'/seed.js','const mongoose=require("mongoose");(async()=>{await mongoose.connect(process.env.MONGO_URI);const State=mongoose.model("State",new mongoose.Schema({value:String}));await State.create({value:"ready"});await mongoose.disconnect();})().catch(error=>{console.error(error);process.exitCode=1;});');}
    if(name==='prisma-sqlite-seed')write(root,backend+'/seed.js','const prisma=new (require("@prisma/client").PrismaClient)();prisma.state.create({data:{value:"ready"}}).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>prisma.$disconnect());');
    write(root,backend+'/package.json',{name:'catalog',private:true,scripts,dependencies,...(name==='prisma-sqlite-seed'?{prisma:{seed:'node seed.js'}}:{})});
   }
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),600000);timer.unref();
   try{stack=await startFullSystem({rootDir:root,signal:controller.signal,onProgress:async(progress,message)=>console.log('SETUP_STAGE',name,progress,message)});}finally{clearTimeout(timer);}
   if(name==='required-external-env')throw Error('Expected mandatory external environment rejection');
   if(!frontOnly){const response=await fetch(stack.backendUrl+'/api/status');assert.equal(response.status,200);assert.equal((await response.json()).value,'ready');}
   page=await browser.newPage();await page.goto(`http://127.0.0.1:${stack.frontendPort}/`);
   await page.getByRole('heading',{name:'Automatic setup',exact:true}).waitFor();await page.locator('output').filter({hasText:'ready'}).waitFor();
   results.push({name,passed:true,durationMs:Date.now()-started});console.log('SETUP_CASE_PASS',name);
  } catch(error) {
   if(name==='required-external-env' && error.code==='SYSTEM_TEST_ENVIRONMENT_REQUIRED' && /PAYMENT_PROVIDER_TOKEN/.test(error.message)){results.push({name,passed:true,expectedBlocker:true});console.log('SETUP_CASE_PASS',name);}
   else {results.push({name,passed:false,error:error.message});console.error('SETUP_CASE_FAIL',name,error.message);}
  } finally {
   await page?.close();await stack?.cleanup();
   const real=fs.realpathSync(root),parent=fs.realpathSync(os.tmpdir());assert.equal(path.dirname(real),parent);assert.ok(path.basename(real).startsWith('covai-auto-setup-'));fs.rmSync(real,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
 }
} finally{await browser.close();}
console.log('AUTOMATIC_SETUP_MATRIX_RESULT',JSON.stringify({passed:results.filter(result=>result.passed).length,total:results.length,results}));
if(results.some(result=>!result.passed))process.exitCode=1;
