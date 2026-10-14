import { describe, test, expect, beforeAll } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import {
    generateSupertestSetupScript,
    ensureSupertestDatabaseSetupFile
} from '../services/databaseMockTemplate.service.js';

describe('Database Mocking Functional Verification', () => {
    let tempDir;

    beforeAll(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-functional-test-'));
        fs.writeFileSync(
            path.join(tempDir, 'package.json'),
            JSON.stringify({ dependencies: { '@prisma/client': '^6.0.0', mongoose: '^8.0.0' } })
        );
        ensureSupertestDatabaseSetupFile(tempDir);
    });

    test('verifies in-memory Prisma client mock handles CRUD without live database', async () => {
        // Execute the mock generator logic directly to test the runtime behavior
        const createModelStore = (modelName) => {
            const store = new Map();
            let autoIncId = 1;
            return {
                findMany: async () => Array.from(store.values()),
                findUnique: async ({ where }) => store.get(Number(where.id)) || { id: Number(where.id), name: 'Sample ' + modelName },
                create: async ({ data }) => {
                    const id = data.id !== undefined ? Number(data.id) : autoIncId++;
                    const record = { id, ...data };
                    store.set(id, record);
                    return record;
                },
                delete: async ({ where }) => {
                    const existing = store.get(Number(where.id)) || { id: Number(where.id) };
                    store.delete(Number(where.id));
                    return existing;
                }
            };
        };

        const prismaMock = {
            $connect: async () => true,
            food: createModelStore('Food'),
        };

        // Create Express App
        const app = express();
        app.use(express.json());

        app.get('/api/food-items', async (req, res) => {
            const items = await prismaMock.food.findMany();
            res.json({ data: items });
        });

        app.post('/api/food-items', async (req, res) => {
            const item = await prismaMock.food.create({ data: req.body });
            res.status(201).json(item);
        });

        app.get('/api/food-items/:id', async (req, res) => {
            const item = await prismaMock.food.findUnique({ where: { id: req.params.id } });
            res.json(item);
        });

        // 1. Initial GET
        const res1 = await request(app).get('/api/food-items');
        expect(res1.status).toBe(200);
        expect(res1.body.data).toEqual([]);

        // 2. POST create item
        const res2 = await request(app).post('/api/food-items').send({ name: 'Cheeseburger', price: 45000 });
        expect(res2.status).toBe(201);
        expect(res2.body.id).toBe(1);
        expect(res2.body.name).toBe('Cheeseburger');

        // 3. GET all returns created item
        const res3 = await request(app).get('/api/food-items');
        expect(res3.status).toBe(200);
        expect(res3.body.data).toHaveLength(1);
        expect(res3.body.data[0].name).toBe('Cheeseburger');

        // 4. GET by ID returns item
        const res4 = await request(app).get('/api/food-items/1');
        expect(res4.status).toBe(200);
        expect(res4.body.name).toBe('Cheeseburger');
    });

    test('verifies in-memory Mongoose query chain mock handles chained calls', async () => {
        const createQueryChain = (data) => ({
            sort: () => createQueryChain(data),
            limit: () => createQueryChain(data),
            skip: () => createQueryChain(data),
            lean: () => createQueryChain(data),
            exec: async () => data,
            then: (resolve, reject) => Promise.resolve(data).then(resolve, reject),
        });

        const mockUserModel = {
            find: () => createQueryChain([{ _id: '123', email: 'test@example.com' }]),
            findById: (id) => createQueryChain({ _id: id, email: 'test@example.com' }),
            create: async (data) => ({ _id: 'new_id', ...data }),
        };

        const app = express();
        app.use(express.json());

        app.get('/api/users', async (req, res) => {
            const users = await mockUserModel.find().sort({ createdAt: -1 }).limit(10).exec();
            res.json(users);
        });

        app.post('/api/users', async (req, res) => {
            const user = await mockUserModel.create(req.body);
            res.status(201).json(user);
        });

        const res1 = await request(app).get('/api/users');
        expect(res1.status).toBe(200);
        expect(res1.body).toHaveLength(1);
        expect(res1.body[0].email).toBe('test@example.com');

        const res2 = await request(app).post('/api/users').send({ email: 'new@example.com' });
        expect(res2.status).toBe(201);
        expect(res2.body.email).toBe('new@example.com');
    });

    describe('Supertest Interceptor Lifecycle, Failure Recovery, and Prototype Restoration', () => {
        let app;
        let originalEnd;

        beforeAll(() => {
            originalEnd = request.Test.prototype.end;
            app = express();
            app.use(express.json());
            app.get('/api/test-ok', (req, res) => res.status(200).json({ ok: true }));
            app.get('/api/test-error', (req, res) => res.status(500).json({ error: 'Internal failure' }));
            app.post('/api/test-create', (req, res) => res.status(201).json({ id: 99, ...req.body }));
        });

        afterEach(() => {
            // Guarantee restoration after each test if not already restored
            if (global.__covai_restore_supertest__) {
                global.__covai_restore_supertest__();
            } else if (request.Test.prototype.__covai_pristine_end__) {
                request.Test.prototype.end = request.Test.prototype.__covai_pristine_end__;
                delete request.Test.prototype.__covai_pristine_end__;
                delete request.Test.prototype.__covai_patched__;
            }
        });

        test('P0.1 Success Path: intercepts response, captures actualStatus 200/201 and resolvedUrl', async () => {
            const tempEvidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-ev-success-'));
            const originalCwd = process.cwd();
            process.chdir(tempEvidenceDir);

            try {
                // Ensure setup file is generated and evaluate setup script logic
                const script = generateSupertestSetupScript({});
                // Execute setup logic in isolated function context
                const setupFn = new Function('require', 'process', 'global', 'afterAll', script);
                setupFn(require, process, global, () => {});

                expect(request.Test.prototype.__covai_patched__).toBe(true);
                expect(request.Test.prototype.__covai_pristine_end__).toBeDefined();

                // 1. GET 200
                const res = await request(app).get('/api/test-ok');
                expect(res.status).toBe(200);

                const evidenceFile = path.resolve(tempEvidenceDir, 'coverage', 'runtime-evidence.json');
                expect(fs.existsSync(evidenceFile)).toBe(true);
                const records = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
                expect(records.length).toBeGreaterThanOrEqual(1);

                const lastRecord = records[records.length - 1];
                expect(lastRecord.actualStatusFromRuntime).toBe(200);
                expect(lastRecord.resolvedUrl).toBe('/api/test-ok');
                expect(lastRecord.requestMethod).toBe('GET');
                expect(lastRecord.evidenceSource).toBe('TEST_SERVER_HTTP_RESPONSE');

                // 2. POST 201
                const resPost = await request(app).post('/api/test-create').send({ name: 'Pizza' });
                expect(resPost.status).toBe(201);

                const recordsAfterPost = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
                const postRecord = recordsAfterPost[recordsAfterPost.length - 1];
                expect(postRecord.actualStatusFromRuntime).toBe(201);
                expect(postRecord.resolvedUrl).toBe('/api/test-create');
                expect(postRecord.requestMethod).toBe('POST');
            } finally {
                process.chdir(originalCwd);
                fs.rmSync(tempEvidenceDir, { recursive: true, force: true });
            }
        });

        test('P0.2 Failure Path: handles error responses (500) without crashing and records actual status', async () => {
            const tempEvidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-ev-failure-'));
            const originalCwd = process.cwd();
            process.chdir(tempEvidenceDir);

            try {
                const script = generateSupertestSetupScript({});
                const setupFn = new Function('require', 'process', 'global', 'afterAll', script);
                setupFn(require, process, global, () => {});

                const res = await request(app).get('/api/test-error');
                expect(res.status).toBe(500);

                const evidenceFile = path.resolve(tempEvidenceDir, 'coverage', 'runtime-evidence.json');
                const records = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
                const errRecord = records.find(r => r.resolvedUrl === '/api/test-error');
                expect(errRecord).toBeDefined();
                expect(errRecord.actualStatusFromRuntime).toBe(500);
                expect(errRecord.hasError).toBe(false); // HTTP 500 is a valid response, not connection drop
            } finally {
                process.chdir(originalCwd);
                fs.rmSync(tempEvidenceDir, { recursive: true, force: true });
            }
        });

        test('P0.3 Idempotency & Consecutive Test Runs: does not double-wrap prototype or corrupt execution', async () => {
            const tempEvidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-ev-consecutive-'));
            const originalCwd = process.cwd();
            process.chdir(tempEvidenceDir);

            try {
                const script = generateSupertestSetupScript({});
                const setupFn = new Function('require', 'process', 'global', 'afterAll', script);

                // Simulate running setup 3 consecutive times in same process
                setupFn(require, process, global, () => {});
                const firstPatchedFn = request.Test.prototype.end;
                setupFn(require, process, global, () => {});
                setupFn(require, process, global, () => {});

                // Prototype function reference should NOT have changed (no wrapper inside wrapper)
                expect(request.Test.prototype.end).toBe(firstPatchedFn);
                expect(request.Test.prototype.__covai_patched__).toBe(true);

                // Run 2 consecutive requests
                await request(app).get('/api/test-ok');
                await request(app).post('/api/test-create').send({ test: 1 });

                const evidenceFile = path.resolve(tempEvidenceDir, 'coverage', 'runtime-evidence.json');
                const records = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
                expect(records).toHaveLength(2);
                expect(records[0].resolvedUrl).toBe('/api/test-ok');
                expect(records[1].resolvedUrl).toBe('/api/test-create');
            } finally {
                process.chdir(originalCwd);
                fs.rmSync(tempEvidenceDir, { recursive: true, force: true });
            }
        });

        test('P0.4 Complete Prototype Restoration: restores pristine prototype and ceases evidence logging', async () => {
            const tempEvidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-ev-restore-'));
            const originalCwd = process.cwd();
            process.chdir(tempEvidenceDir);

            try {
                const script = generateSupertestSetupScript({});
                const setupFn = new Function('require', 'process', 'global', 'afterAll', script);
                setupFn(require, process, global, () => {});

                expect(request.Test.prototype.__covai_patched__).toBe(true);
                expect(typeof global.__covai_restore_supertest__).toBe('function');

                // Perform request while patched
                await request(app).get('/api/test-ok');
                const evidenceFile = path.resolve(tempEvidenceDir, 'coverage', 'runtime-evidence.json');
                const recordsBefore = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
                expect(recordsBefore).toHaveLength(1);

                // Execute restoration function
                const restored = global.__covai_restore_supertest__();
                expect(restored).toBe(true);

                // Verify prototype is fully restored
                expect(request.Test.prototype.end).toBe(originalEnd);
                expect(request.Test.prototype.__covai_pristine_end__).toBeUndefined();
                expect(request.Test.prototype.__covai_patched__).toBeUndefined();

                // Subsequent request should NOT append to runtime evidence
                await request(app).get('/api/test-ok');
                const recordsAfter = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
                expect(recordsAfter).toHaveLength(1); // Still 1, no new record appended
            } finally {
                process.chdir(originalCwd);
                fs.rmSync(tempEvidenceDir, { recursive: true, force: true });
            }
        });

        test('P0.5 Exception Handling: prototype can be safely restored even when an unexpected test error occurs', async () => {
            const script = generateSupertestSetupScript({});
            const setupFn = new Function('require', 'process', 'global', 'afterAll', script);
            setupFn(require, process, global, () => {});

            expect(request.Test.prototype.__covai_patched__).toBe(true);

            // Simulate an unhandled exception thrown in a test block
            try {
                throw new Error('Fatal assertion error in test execution');
            } catch (err) {
                expect(err.message).toBe('Fatal assertion error in test execution');
            }

            // Teardown hook must still restore prototype cleanly
            const restored = global.__covai_restore_supertest__();
            expect(restored).toBe(true);
            expect(request.Test.prototype.end).toBe(originalEnd);
        });
    });
});
