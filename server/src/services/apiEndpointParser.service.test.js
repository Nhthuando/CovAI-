import { extractValidEndpoints, findControllerLocation } from './apiEndpointParser.service.js';

describe('API Endpoint Parser & Controller Location Resolver', () => {
    it('1. Extracts direct route declarations from app.js', () => {
        const sourceCode = [
            {
                path: 'server/app.js',
                content: `
                    const express = require('express');
                    const app = express();
                    app.get('/api/users', (req, res) => res.send('OK'));
                    app.post('/api/users/:id', (req, res) => res.send('OK'));
                `
            }
        ];

        const endpoints = extractValidEndpoints(sourceCode);
        expect(endpoints).toHaveLength(2);
        expect(endpoints.find(e => e.method === 'GET' && e.fullPath === '/api/users')).toBeDefined();
        expect(endpoints.find(e => e.method === 'POST' && e.fullPath === '/api/users/:id')).toBeDefined();
        expect(endpoints[0].sourceFile).toBe('server/app.js');
        expect(endpoints[0].sourceLine).toBeGreaterThan(0);
    });

    it('2. Extracts router endpoints with controller file and line location', () => {
        const sourceCode = [
            {
                path: 'server/app.js',
                content: `
                    const express = require('express');
                    const app = express();
                    const authRoutes = require('./routes/auth.routes');
                    app.use('/api/auth', authRoutes);
                `
            },
            {
                path: 'server/routes/auth.routes.js',
                content: `
                    const express = require('express');
                    const router = express.Router();
                    const authController = require('../controllers/auth.controller');

                    router.post('/login', authController.login);
                    router.get('/profile', authController.getProfile);
                    module.exports = router;
                `
            },
            {
                path: 'server/controllers/auth.controller.js',
                content: `
                    // Controller implementation
                    const prisma = require('../prisma');

                    exports.login = async (req, res) => {
                        const { email, password } = req.body;
                        return res.json({ token: 'xyz' });
                    };

                    exports.getProfile = async (req, res) => {
                        return res.json({ user: 'test' });
                    };
                `
            }
        ];

        const endpoints = extractValidEndpoints(sourceCode);
        expect(endpoints).toHaveLength(2);

        const loginEp = endpoints.find(e => e.method === 'POST' && e.fullPath === '/api/auth/login');
        expect(loginEp).toBeDefined();
        expect(loginEp.sourceFile).toBe('server/routes/auth.routes.js');
        expect(loginEp.sourceLine).toBeGreaterThan(0);
        expect(loginEp.controllerFile).toBe('server/controllers/auth.controller.js');
        expect(loginEp.controllerLine).toBe(5); // line 5 in controller
        expect(loginEp.controllerMethod).toBe('authController.login');
        expect(loginEp.requestBodySchema).toEqual(expect.arrayContaining(['email', 'password']));

        const profileEp = endpoints.find(e => e.method === 'GET' && e.fullPath === '/api/auth/profile');
        expect(profileEp).toBeDefined();
        expect(profileEp.controllerFile).toBe('server/controllers/auth.controller.js');
        expect(profileEp.controllerLine).toBe(10); // line 10 in controller
    });

    it('3. Excludes HTTP clients like axios and supertest', () => {
        const sourceCode = [
            {
                path: 'server/routes/test.routes.js',
                content: `
                    const router = express.Router();
                    axios.get('/external/api');
                    supertest(app).post('/internal/test');
                    router.put('/valid/item', itemController.update);
                `
            },
            {
                path: 'server/controllers/item.controller.js',
                content: `
                    export const update = async (req, res) => {
                        res.send('updated');
                    };
                `
            }
        ];

        const endpoints = extractValidEndpoints(sourceCode);
        expect(endpoints).toHaveLength(1);
        expect(endpoints[0].method).toBe('PUT');
        expect(endpoints[0].fullPath).toBe('/valid/item');
        expect(endpoints[0].controllerFile).toBe('server/controllers/item.controller.js');
        expect(endpoints[0].controllerLine).toBe(2);
    });

    it('4. Resolves controller location when handler is ES6 export or arrow function', () => {
        const sourceCode = [
            {
                path: 'server/controllers/user.controller.js',
                content: `
// File header comments
import prisma from '../prisma';

export async function getUser(req, res) {
    res.json({});
}

export const deleteUser = async (req, res) => {
    res.json({});
};
                `
            }
        ];

        const getRes = findControllerLocation(sourceCode, 'userController', 'getUser', null);
        expect(getRes.controllerFile).toBe('server/controllers/user.controller.js');
        expect(getRes.controllerLine).toBe(5);

        const delRes = findControllerLocation(sourceCode, 'userController', 'deleteUser', null);
        expect(delRes.controllerFile).toBe('server/controllers/user.controller.js');
        expect(delRes.controllerLine).toBe(9);
    });

    it('5. Resolves controller location when controller is a class or object literal', () => {
        const sourceCode = [
            {
                path: 'server/controllers/product.controller.js',
                content: `
                    class ProductController {
                        async createProduct(req, res) {
                            res.send('ok');
                        }
                    }
                    module.exports = new ProductController();
                `
            },
            {
                path: 'server/controllers/order.controller.js',
                content: `
                    module.exports = {
                        listOrders: async (req, res) => {
                            res.send('orders');
                        }
                    };
                `
            }
        ];

        const classRes = findControllerLocation(sourceCode, 'productController', 'createProduct', null);
        expect(classRes.controllerFile).toBe('server/controllers/product.controller.js');
        expect(classRes.controllerLine).toBe(3);

        const objRes = findControllerLocation(sourceCode, 'orderController', 'listOrders', null);
        expect(objRes.controllerFile).toBe('server/controllers/order.controller.js');
        expect(objRes.controllerLine).toBe(3);
    });

    it('6. Gracefully handles endpoints with inline handlers and no external controller', () => {
        const sourceCode = [
            {
                path: 'server/routes/health.routes.js',
                content: `
                    const router = express.Router();
                    router.get('/health', (req, res) => res.json({ status: 'UP' }));
                `
            }
        ];

        const endpoints = extractValidEndpoints(sourceCode);
        expect(endpoints).toHaveLength(1);
        expect(endpoints[0].method).toBe('GET');
        expect(endpoints[0].fullPath).toBe('/health');
        expect(endpoints[0].sourceFile).toBe('server/routes/health.routes.js');
        expect(endpoints[0].sourceLine).toBe(3);
        expect(endpoints[0].controllerFile).toBeNull();
        expect(endpoints[0].controllerLine).toBeNull();
    });

    it('7. Correctly maps router mount paths when variable names differ from filenames', () => {
        const sourceCode = [
            {
                path: 'server/index.js',
                content: `
                    const express = require('express');
                    const app = express();
                    const foodRoutes = require('./routes/productRoutes');
                    const cardRoutes = require('./routes/cartRoutes');

                    app.use('/api/food-items', foodRoutes);
                    app.use('/api/cart', cardRoutes);
                `
            },
            {
                path: 'server/routes/productRoutes.js',
                content: `
                    const express = require('express');
                    const router = express.Router();
                    router.get('/', (req, res) => res.json([]));
                    router.post('/create', (req, res) => res.json({ ok: true }));
                    module.exports = router;
                `
            },
            {
                path: 'server/routes/cartRoutes.js',
                content: `
                    const express = require('express');
                    const router = express.Router();
                    router.post('/validate', (req, res) => res.json({ valid: true }));
                    module.exports = router;
                `
            }
        ];

        const endpoints = extractValidEndpoints(sourceCode);
        expect(endpoints).toHaveLength(3);
        expect(endpoints.find(e => e.method === 'GET' && e.fullPath === '/api/food-items')).toBeDefined();
        expect(endpoints.find(e => e.method === 'POST' && e.fullPath === '/api/food-items/create')).toBeDefined();
        expect(endpoints.find(e => e.method === 'POST' && e.fullPath === '/api/cart/validate')).toBeDefined();
    });
});
