import net from 'node:net';
// Hold kernel-assigned ports through dependency/service preparation so parallel
// projects cannot all choose the same free preferred port before binding.
export const reserveSystemPorts = async count => {
    const leases=[];
    try {
        for(let index=0;index<count;index++) {
            const server=net.createServer();
            await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({host:'127.0.0.1',port:0},resolve);});
            let released=false;
            leases.push({port:server.address().port,release:async()=>{if(released)return;released=true;await new Promise(resolve=>server.close(resolve));}});
        }
        return leases;
    }catch(error){await Promise.all(leases.map(lease=>lease.release()));throw error;}
};
