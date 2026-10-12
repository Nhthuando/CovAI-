import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {it,expect} from '@jest/globals';
const exec=promisify(execFile);
it('adapts a hard-coded HTTP listening port without changing imported source',async()=>{
    const probe=http.createServer();
    await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
    const port=probe.address().port;
    await new Promise(resolve=>probe.close(resolve));
    const preload=fileURLToPath(new URL('../utils/autPortOverride.cjs',import.meta.url));
    const code="const http=require('node:http');const server=http.createServer();server.listen(1,'127.0.0.1',()=>{console.log(server.address().port);server.close();});";
    const result=await exec(process.execPath,['--require',preload,'-e',code],{env:{...process.env,COVAI_AUT_PORT:String(port)},timeout:10000});
    expect(Number(result.stdout.trim())).toBe(port);
});
