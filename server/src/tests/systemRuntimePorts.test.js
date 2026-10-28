import net from 'node:net';
import {it,expect} from '@jest/globals';
import {reserveSystemPorts} from '../services/systemRuntimePorts.service.js';
it('reserves distinct ports for concurrent project preparation and releases them idempotently',async()=>{
    const groups=await Promise.all(Array.from({length:8},()=>reserveSystemPorts(2))),leases=groups.flat();
    try {
        expect(new Set(leases.map(lease=>lease.port)).size).toBe(16);
        await expect(new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen({host:'127.0.0.1',port:leases[0].port},()=>server.close(resolve));})).rejects.toMatchObject({code:'EADDRINUSE'});
    } finally{await Promise.all(leases.map(lease=>lease.release()));}
    await Promise.all(leases.map(lease=>lease.release()));
});
