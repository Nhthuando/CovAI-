import {it,expect} from '@jest/globals';
import {discoverReadinessPaths} from '../services/fullSystemReadiness.service.js';
const file=(path,content)=>({path,content});
it('resolves CommonJS routers by require bindings rather than variable/filename similarity',()=>{
    const routes=discoverReadinessPaths([
        file('server/index.js',`const express=require('express');const app=express();const foodRoutes=require('./routes/productRoutes');app.use('/api/food-items',foodRoutes);app.get('/',(req,res)=>res.send('ready'));`),
        file('server/routes/productRoutes.js',`const express=require('express');const router=express.Router();router.get('/',list);router.get('/get/:id',get);module.exports=router;`),
    ]);
    expect(routes).toEqual(['/','/api/food-items']);
    expect(routes).not.toContain('/api/product');
});
it('resolves nested ESM routers, multiple mounts and explicit health-route priority',()=>{
    const routes=discoverReadinessPaths([
        file('src/main.ts',`import express from 'express';import api from './api';const app=express();app.use('/v1',api);app.use('/v2',api);app.get('/',home);`),
        file('src/api/index.ts',`import {Router} from 'express';import status from '../status';const api=Router();api.use('/status',status);export default api;`),
        file('src/status.ts',`import {Router} from 'express';const status=Router();status.get('/health',check);export default status;`),
    ]);
    expect(routes).toEqual(['/v1/status/health','/v2/status/health','/']);
});
it('does not treat an unmounted router, HTTP client or test mock as application readiness',()=>{
    expect(discoverReadinessPaths([
        file('routes/unmounted.js',`const express=require('express');const router=express.Router();router.get('/health',handler);module.exports=router;`),
        file('client.js',`axios.get('/health',options);const app=cache();app.get('/health',handler);`),
        file('__tests__/fake.js',`const express=require('express');const app=express();app.get('/health',handler);`),
    ])).toEqual([]);
});
it('bounds cycles and ignores dynamic or protocol-relative paths',()=>{
    expect(discoverReadinessPaths([file('app.js',`const express=require('express');const app=express();const router=express.Router();router.use('/loop',router);router.get('/ready',handler);app.use('/api',router);app.get('/items/:id',handler);app.get('//outside',handler);app.get(prefix,handler);`)])).toEqual(['/api/ready']);
});
