import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {startFullSystem} from '../src/services/fullSystemLifecycle.service.js';
const roots=[],stacks=[];
try {
 const results=await Promise.allSettled(Array.from({length:4},async(_,index)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-parallel-setup-'));roots.push(root);
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'parallel-'+index,scripts:{start:'node index.js'}}));
  fs.writeFileSync(path.join(root,'index.js'),`const http=require('node:http');if(!process.env.JWT_SECRET)throw Error('JWT secret required');http.createServer((req,res)=>res.end('project-${index}')).listen(3000,'127.0.0.1');`);
  const stack=await startFullSystem({rootDir:root});stacks.push(stack);
  assert.equal(await (await fetch(stack.backendUrl+'/')).text(),'project-'+index);
  return stack.frontendPort;
 }));
 for(const result of results)if(result.status==='rejected')throw result.reason;
 assert.equal(new Set(results.map(result=>result.value)).size,4);
 console.log('CONCURRENT_SETUP_RESULT',JSON.stringify({projects:4,passed:4,distinctPorts:4}));
}catch(error){console.error('CONCURRENT_SETUP_FAILED',error.message);process.exitCode=1;}
finally {
 await Promise.all(stacks.map(stack=>stack.cleanup()));
 for(const root of roots){assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(root).startsWith('covai-parallel-setup-'));fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
