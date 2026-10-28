import { describe, test, expect } from '@jest/globals';
import { extractValidEndpoints } from './apiEndpointParser.service.js';

describe('API endpoint parser source-array contract', () => {
    test('extracts direct routes once, with AST provenance', () => {
        const endpoints = extractValidEndpoints([{ path: 'src/app.js', content: `
            app.get('/api/users', listUsers);
            app.post('/api/users/:id', authMiddleware, userController.save);
        ` }]);
        expect(endpoints).toHaveLength(2);
        expect(endpoints.find(row => row.method === 'POST')).toMatchObject({
            fullPath: '/api/users/:id', params: ['id'], middleware: ['authMiddleware'],
            controllerMethod: 'userController.save', provenance: { detectionType: 'AST', sourceLine: 3 },
        });
    });
    test('does not turn HTTP client requests into server routes', () => {
        const endpoints = extractValidEndpoints([{ path: 'src/routes/items.js', content: `
            axios.get('/remote', config);
            request.post('/remote', body);
            http.get('/remote', callback);
            router.delete('/items/:itemId', removeItem);
        ` }]);
        expect(endpoints.map(row => [row.method, row.fullPath])).toEqual([['DELETE', '/items/:itemId']]);
    });
    test('combines mount paths with router paths and records controller body/model hints', () => {
        const endpoints = extractValidEndpoints([
            { path: 'src/app.js', content: `app.use('/api/users', usersRoutes);` },
            { path: 'src/routes/users.route.js', content: `router.post('/', auth, userController.save);` },
            { path: 'src/controllers/user.controller.js', content: `function save(req) { const {name} = req.body; return prisma.user.create({data:{name}}); }` },
        ]);
        expect(endpoints).toHaveLength(1);
        expect(endpoints[0]).toMatchObject({ method: 'POST', fullPath: '/api/users', requestBodySchema: ['name'], databaseModels: ['user'] });
    });
    test('excludes test/mocks and ignores dynamic unknown routes', () => {
        const endpoints = extractValidEndpoints([
            { path: 'src/routes/items.spec.js', content: `router.get('/test-only', handler);` },
            { path: 'src/mock/routes.js', content: `router.get('/mock-only', handler);` },
            { path: 'src/routes/items.js', content: `router.get(pathVariable, handler); router.get('/real', handler);` },
        ]);
        expect(endpoints.map(row => row.fullPath)).toEqual(['/real']);
        expect(extractValidEndpoints([])).toEqual([]);
    });
});
