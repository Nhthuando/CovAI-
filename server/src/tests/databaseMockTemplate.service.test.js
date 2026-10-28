import { jest, describe, beforeEach, afterEach, test, expect } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    detectProjectDatabase,
    generateSupertestSetupScript,
    ensureSupertestDatabaseSetupFile
} from '../services/databaseMockTemplate.service.js';

describe('databaseMockTemplate.service', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-db-mock-test-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('detectProjectDatabase', () => {
        test('detects Prisma when @prisma/client is present in package.json', () => {
            fs.writeFileSync(
                path.join(tempDir, 'package.json'),
                JSON.stringify({ dependencies: { '@prisma/client': '^6.0.0' } })
            );

            const result = detectProjectDatabase(tempDir);
            expect(result.hasPrisma).toBe(true);
            expect(result.primaryType).toBe('PRISMA');
        });

        test('detects Prisma in a subfolder like server/package.json', () => {
            const serverDir = path.join(tempDir, 'server');
            fs.mkdirSync(serverDir, { recursive: true });
            fs.writeFileSync(
                path.join(serverDir, 'package.json'),
                JSON.stringify({ dependencies: { prisma: '^6.0.0' } })
            );

            const result = detectProjectDatabase(tempDir);
            expect(result.hasPrisma).toBe(true);
            expect(result.primaryType).toBe('PRISMA');
        });

        test('detects Mongoose when mongoose is in package.json', () => {
            fs.writeFileSync(
                path.join(tempDir, 'package.json'),
                JSON.stringify({ dependencies: { mongoose: '^8.0.0' } })
            );

            const result = detectProjectDatabase(tempDir);
            expect(result.hasMongoose).toBe(true);
            expect(result.primaryType).toBe('MONGOOSE');
        });

        test('detects Sequelize and SQL drivers', () => {
            fs.writeFileSync(
                path.join(tempDir, 'package.json'),
                JSON.stringify({ dependencies: { sequelize: '^6.0.0', mysql2: '^3.0.0' } })
            );

            const result = detectProjectDatabase(tempDir);
            expect(result.hasSequelize).toBe(true);
            expect(result.hasSql).toBe(true);
            expect(result.primaryType).toBe('SEQUELIZE');
        });

        test('returns NONE for projects without database dependencies', () => {
            fs.writeFileSync(
                path.join(tempDir, 'package.json'),
                JSON.stringify({ dependencies: { express: '^4.18.0' } })
            );

            const result = detectProjectDatabase(tempDir);
            expect(result.hasPrisma).toBe(false);
            expect(result.hasMongoose).toBe(false);
            expect(result.primaryType).toBe('NONE');
        });
    });

    describe('generateSupertestSetupScript', () => {
        test('contains environment variables and mock definitions', () => {
            const script = generateSupertestSetupScript({ hasPrisma: true, hasMongoose: true });

            expect(script).toContain("process.env.NODE_ENV = 'test'");
            expect(script).toContain("process.env.JWT_SECRET");
            expect(script).toContain("createPrismaClientMock");
            expect(script).toContain("createMongooseMock");
            expect(script).toContain("jest.mock('@prisma/client'");
            expect(script).toContain("jest.mock('mongoose'");
        });
    });

    describe('ensureSupertestDatabaseSetupFile', () => {
        test('writes covai.supertest.setup.js to .covai-temp directory', () => {
            fs.writeFileSync(
                path.join(tempDir, 'package.json'),
                JSON.stringify({ dependencies: { '@prisma/client': '^6.0.0' } })
            );

            const { absolutePath, relativePath, dbInfo } = ensureSupertestDatabaseSetupFile(tempDir);

            expect(fs.existsSync(absolutePath)).toBe(true);
            expect(relativePath).toBe('.covai-temp/covai.supertest.setup.js');
            expect(dbInfo.hasPrisma).toBe(true);

            const content = fs.readFileSync(absolutePath, 'utf8');
            expect(content).toContain('createPrismaClientMock');
        });
    });

    describe('parsePrismaSchemaModels & Prisma Constraint Mocking', () => {
        test('correctly parses required fields and ignores optional/default fields', async () => {
            const { parsePrismaSchemaModels } = await import('../services/databaseMockTemplate.service.js');
            const sampleSchema = `
model Food {
  id          Int      @id @default(autoincrement())
  name        String
  price       Float
  description String?
  isAvailable Boolean  @default(true)
}
            `;
            const models = parsePrismaSchemaModels(sampleSchema);
            expect(models.food).toBeDefined();
            expect(models.food).toContain('name');
            expect(models.food).toContain('price');
            expect(models.food).not.toContain('id');
            expect(models.food).not.toContain('description');
            expect(models.food).not.toContain('isAvailable');
        });

        test('detects schema.prisma and embeds required field validation in setup script', () => {
            const prismaDir = path.join(tempDir, 'server', 'prisma');
            fs.mkdirSync(prismaDir, { recursive: true });
            fs.writeFileSync(
                path.join(prismaDir, 'schema.prisma'),
                `model Food {\n  id Int @id @default(autoincrement())\n  name String\n  price Float\n}`
            );
            fs.writeFileSync(
                path.join(tempDir, 'package.json'),
                JSON.stringify({ dependencies: { '@prisma/client': '^6.0.0' } })
            );

            const dbInfo = detectProjectDatabase(tempDir);
            expect(dbInfo.hasPrisma).toBe(true);
            expect(dbInfo.prismaModels.food).toEqual(['name', 'price']);

            const script = generateSupertestSetupScript(dbInfo);
            expect(script).toContain('"food":["name","price"]');
            expect(script).toContain('PrismaClientValidationError');
        });

        test('extracts metadata distinguishing required, defaults, optionals, and field types', async () => {
            const { parsePrismaSchemaModels } = await import('../services/databaseMockTemplate.service.js');
            const complexSchema = `
model Product {
  id          Int      @id @default(autoincrement())
  title       String
  price       Float
  stock       Int      @default(0)
  description String?
  category    Category @relation(fields: [categoryId], references: [id])
  categoryId  Int
  createdAt   DateTime @default(now())
}
            `;
            const models = parsePrismaSchemaModels(complexSchema);
            expect(models.product).toEqual(['title', 'price', 'categoryId']);
            const meta = models.__meta_product;
            expect(meta).toBeDefined();
            expect(meta.required).toEqual(['title', 'price', 'categoryId']);
            expect(meta.types.title).toBe('String');
            expect(meta.types.price).toBe('Float');
            expect(meta.types.stock).toBe('Int');
            expect(meta.defaults).toContain('stock');
            expect(meta.defaults).toContain('id');
            expect(meta.defaults).toContain('createdAt');
            expect(meta.optional).toContain('description');
        });

        test('verifies mock create enforces missing fields, null values, and numeric type validation', async () => {
            const { parsePrismaSchemaModels } = await import('../services/databaseMockTemplate.service.js');
            const schema = `
model Food {
  id     Int    @id @default(autoincrement())
  name   String
  price  Float
  rating Float
  note   String?
}
            `;
            const models = parsePrismaSchemaModels(schema);
            const requiredFields = models.food;
            const meta = models.__meta_food;

            // Simulate create function from generateSupertestSetupScript
            const mockCreate = async ({ data }) => {
                if (requiredFields && requiredFields.length > 0) {
                    const missing = requiredFields.filter(f => data[f] === undefined);
                    if (missing.length > 0) {
                        const err = new Error("PrismaClientValidationError: Argument '" + missing[0] + "' for data." + missing[0] + " is missing.");
                        err.name = "PrismaClientValidationError";
                        throw err;
                    }
                    const nullRequired = requiredFields.filter(f => data[f] === null);
                    if (nullRequired.length > 0) {
                        const err = new Error("PrismaClientValidationError: Argument '" + nullRequired[0] + "' for data." + nullRequired[0] + " cannot be null.");
                        err.name = "PrismaClientValidationError";
                        throw err;
                    }
                }
                if (meta && meta.types) {
                    for (const [key, val] of Object.entries(data)) {
                        if (val === undefined || val === null) continue;
                        const expType = meta.types[key];
                        if ((expType === 'Int' || expType === 'Float') && typeof val === 'string' && isNaN(Number(val))) {
                            const err = new Error("PrismaClientValidationError: Argument '" + key + "': Invalid value provided. Expected " + expType + ", provided String.");
                            err.name = "PrismaClientValidationError";
                            throw err;
                        }
                    }
                }
                return { id: 1, ...data };
            };

            // 1. Missing required field -> throws PrismaClientValidationError
            await expect(mockCreate({ data: { price: 50000, rating: 4.5 } }))
                .rejects.toThrow("Argument 'name' for data.name is missing.");

            // 2. Null value for non-nullable required field -> throws PrismaClientValidationError
            await expect(mockCreate({ data: { name: null, price: 50000, rating: 4.5 } }))
                .rejects.toThrow("Argument 'name' for data.name cannot be null.");

            // 3. Optional field (note) missing or null -> succeeds
            const validWithNullNote = await mockCreate({ data: { name: 'Burger', price: 50000, rating: 4.5, note: null } });
            expect(validWithNullNote.id).toBe(1);
            expect(validWithNullNote.name).toBe('Burger');

            // 4. Invalid data type (string provided for Float) -> throws PrismaClientValidationError
            await expect(mockCreate({ data: { name: 'Burger', price: 'not-a-number', rating: 4.5 } }))
                .rejects.toThrow("Argument 'price': Invalid value provided. Expected Float, provided String.");

            // 5. Complete valid payload -> succeeds
            const validItem = await mockCreate({ data: { name: 'Burger', price: 50000, rating: 4.5 } });
            expect(validItem.id).toBe(1);
            expect(validItem.price).toBe(50000);
        });
    });
});
