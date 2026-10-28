// Loaded only for the isolated Full Stack backend. Preserve the imported source
// while adapting HTTP servers that hard-code their listening port.
const http = require('node:http');
const port = Number(process.env.COVAI_AUT_PORT);
if (Number.isInteger(port) && port > 0 && port <= 65535) {
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function (...args) {
        if (typeof args[0] === 'number' || (typeof args[0] === 'string' && /^\d+$/.test(args[0]))) args[0] = port;
        else if (args[0] && typeof args[0] === 'object' && 'port' in args[0]) args[0] = {...args[0],port};
        return listen.apply(this,args);
    };
}
