import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { detectProjectTechnologies } from "../services/projectTechnologyDetector.service.js";
import { analyzeDataAccessContracts } from "../services/dataAccessContractAnalyzer.service.js";
import {
    generateUniversalMocks,
    registerMockAdapter,
    unregisterMockAdapter,
    selectAdapter,
} from "../services/universalMockEngine.service.js";
import { validateMockContracts, validateAndNormalizeMocks, extractAssertionPropertyRequirements } from "../services/mockValidation.service.js";
import { buildOperationFixtures } from "../services/mockAdapters/fixtureBuilder.js";
import { verifyUnitTestBatch } from "../services/unitTestVerification.service.js";
import { cleanStoragePath } from "../utils/pathSanitizer.js";
import { normalizeTestFrameworkCode } from "../services/testFrameworkNormalization.service.js";
import { frameworkCompatibilityFindings } from "../services/testFrameworkCapabilities.service.js";
import { parseJavaScriptCode } from "../services/babelParser.service.js";
import { classifyTestFailure, FAILURE_CLASSIFICATIONS } from "../services/testFailureClassifier.service.js";
import { attemptControlledMockRepair } from "../services/controlledMockRepair.service.js";

describe("Universal Mock Generation Engine", () => {
    let tmpRoot;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "covai-ume-"));
    });

    afterEach(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    test("1. Technology detector does NOT assume package.json proves target source usage", () => {
        const sourceCode = `
            export function calculateDiscount(price, rate) {
                return price * (1 - rate);
            }
        `;
        const report = detectProjectTechnologies({
            rootDir: tmpRoot,
            sourceCode,
            packageJson: {
                dependencies: {
                    "@prisma/client": "^5.0.0",
                    mongoose: "^8.0.0",
                    sequelize: "^6.0.0",
                    axios: "^1.6.0",
                },
                devDependencies: {
                    vitest: "^2.0.0",
                },
            },
        });

        expect(report.framework).toBe("vitest");
        expect(report.declaredPackages).toContain("@prisma/client");
        expect(report.usedTechnologies).toEqual([]);
        expect(report.technologies.prisma.declaredInPackageJson).toBe(true);
        expect(report.technologies.prisma.detectedInSource).toBe(false);
    });

    test("2. Contract analyzer extracts return types, nullability, chains, and property accesses", () => {
        const sourceCode = `
            import prisma from '../db/prisma.js';
            import ArticleModel from '../models/article.js';

            export async function listPublishedTitles() {
                const rows = await prisma.article.findMany({ where: { published: true } });
                return rows.map((r) => r.title);
            }

            export async function getArticleOrThrow(id) {
                const doc = await ArticleModel.findById(id).populate('author').lean().exec();
                if (!doc) throw new Error('Not found');
                return doc.slug;
            }
        `;
        const { contracts } = analyzeDataAccessContracts({ sourceCode });

        const findManyContract = contracts.find((c) => c.method === "findMany");
        expect(findManyContract).toBeDefined();
        expect(findManyContract.expectedReturnType).toBe("array");
        expect(findManyContract.arrayOperations).toContain("map");
        expect(findManyContract.isAsync).toBe(true);

        const findByIdContract = contracts.find((c) => c.method === "findById");
        expect(findByIdContract).toBeDefined();
        expect(findByIdContract.expectedReturnType).toBe("object|null");
        expect(findByIdContract.nullable).toBe(true);
        expect(findByIdContract.chainedMethods).toEqual(["populate", "lean", "exec"]);
        expect(findByIdContract.propertyAccesses).toContain("slug");
    });

    test("3. Adapter selection covers Prisma, Mongoose, Sequelize, TypeORM, and Custom Repositories", () => {
        const prismaRes = generateUniversalMocks({
            framework: "jest",
            sourceCode: `
                import { PrismaClient } from '@prisma/client';
                const prisma = new PrismaClient();
                export async function getActive() {
                    const items = await prisma.account.findMany({ where: { active: true } });
                    return items.map((a) => a.email);
                }
            `,
        });
        expect(prismaRes.adapterSelections[0].adapter).toBe("prisma");
        expect(prismaRes.mockCode).toContain("jest.mock('@prisma/client'");
        expect(prismaRes.mockCode).toContain("jest.clearAllMocks()");

        const mongooseRes = generateUniversalMocks({
            framework: "vitest",
            sourceCode: `
                import mongoose from 'mongoose';
                const RecordModel = mongoose.model('Record');
                export async function loadRecord(id) {
                    const item = await RecordModel.findById(id).populate('owner').lean().exec();
                    return item?.label || null;
                }
            `,
        });
        expect(mongooseRes.adapterSelections[0].adapter).toBe("mongoose");
        expect(mongooseRes.mockCode).toContain("vi.mock('mongoose'");
        expect(mongooseRes.mockCode).toContain("createChainableQuery");

        const sequelizeRes = generateUniversalMocks({
            framework: "jest",
            sourceCode: `
                import { Sequelize } from 'sequelize';
                const seq = new Sequelize();
                const Ledger = seq.define('Ledger');
                export async function listEntries() {
                    const list = await Ledger.findAll();
                    return list.filter((x) => x.amount > 0);
                }
            `,
        });
        expect(sequelizeRes.adapterSelections[0].adapter).toBe("sequelize");
        expect(sequelizeRes.mockCode).toContain("jest.mock('sequelize'");

        const typeormRes = generateUniversalMocks({
            framework: "jest",
            sourceCode: `
                import { getRepository } from 'typeorm';
                export async function findInvoices() {
                    return await getRepository('Invoice').createQueryBuilder('inv').where('inv.paid = :p', { p: true }).getMany();
                }
            `,
        });
        expect(typeormRes.adapterSelections[0].adapter).toBe("typeorm");
        expect(typeormRes.mockCode).toContain("createQueryBuilderMock");

        const customRepoRes = generateUniversalMocks({
            framework: "vitest",
            sourceCode: `
                import { fetchActiveRecords } from '../repositories/dataRepo.js';
                export async function summarize() {
                    const rows = await fetchActiveRecords();
                    return rows.map((r) => r.code);
                }
            `,
        });
        expect(customRepoRes.adapterSelections[0].adapter).toBe("generic-repository");
        expect(customRepoRes.mockCode).toContain("vi.mock('../repositories/dataRepo.js'");
        expect(customRepoRes.mockCode).toContain("mockResolvedValue");
    });

    test("4. Unknown un-analyzable external dependency is marked UNSUPPORTED_DEPENDENCY instead of silent guessing", () => {
        const res = generateUniversalMocks({
            framework: "jest",
            sourceCode: `
                import proprietarySdk from 'acme-proprietary-sdk';
                export function ping() { return 'ok'; }
            `,
        });
        expect(res.unsupportedDependencies).toEqual([
            { source: "acme-proprietary-sdk", reason: "NO_MATCHING_ADAPTER" },
        ]);
        expect(res.diagnostics.some((d) => d.rule === "UNSUPPORTED_DEPENDENCY")).toBe(true);
    });

    test("5. Custom adapter registration is extensible", () => {
        registerMockAdapter({
            name: "custom-knex-ext",
            priority: 200,
            canHandle: ({ dependency }) => dependency.source === "knex",
            generateMock: ({ framework }) => ({
                status: "GENERATED",
                adapter: "custom-knex-ext",
                mockCode: `${framework === "vitest" ? "vi" : "jest"}.mock('knex', () => () => ({ select: () => [] }));`,
                fixtures: {},
                diagnostics: [],
            }),
        });
        try {
            const adapter = selectAdapter({
                dependency: { source: "knex", bindings: [] },
                contracts: [],
                technologyReport: {},
            });
            expect(adapter?.name).toBe("custom-knex-ext");
        } finally {
            unregisterMockAdapter("custom-knex-ext");
        }
    });

    test("6. Pre-Docker Mock Contract Validator catches return-type, chain, async, and property mismatches", () => {
        const { contracts } = analyzeDataAccessContracts({
            sourceCode: `
                import { loadItems, getConfig } from '../repos/store.js';
                export async function run() {
                    const items = await loadItems().populate('meta').exec();
                    const cfg = getConfig();
                    return items.map((i) => i.title + cfg.region);
                }
            `,
        });

        const badTestCode = `
            jest.mock('../repos/store.js', () => ({
                loadItems: jest.fn().mockReturnValue({ wrong: true }),
            }));
        `;
        const validation = validateMockContracts({ code: badTestCode, contracts, framework: "jest" });
        expect(validation.valid).toBe(false);
        const rules = validation.violations.map((v) => v.rule);
        expect(rules).toContain("MOCK_RETURN_TYPE_MISMATCH");
        expect(rules).toContain("MOCK_CHAIN_MISMATCH");
        expect(rules).toContain("MOCK_METHOD_MISSING");
    });

    test("7. Failure classifier distinguishes all structured failure categories", () => {
        expect(
            classifyTestFailure({ errorMessage: "TypeError: rows.map is not a function" }).classification
        ).toBe(FAILURE_CLASSIFICATIONS.INVALID_MOCK_CONTRACT);

        expect(
            classifyTestFailure({ errorMessage: "ReferenceError: Cannot access 'mockClient' before initialization" }).classification
        ).toBe(FAILURE_CLASSIFICATIONS.MOCK_INITIALIZATION_ERROR);

        expect(
            classifyTestFailure({ errorMessage: "Cast to ObjectId failed for value 'bad-id'" }).classification
        ).toBe(FAILURE_CLASSIFICATIONS.INVALID_FIXTURE);

        expect(
            classifyTestFailure({ errorMessage: "AssertionError: expected 10 to be 20\nExpected: 20\nReceived: 10" }).classification
        ).toBe(FAILURE_CLASSIFICATIONS.INCORRECT_EXPECTATION);

        expect(
            classifyTestFailure({ errorMessage: "Error: connect ECONNREFUSED 127.0.0.1:5432" }).classification
        ).toBe(FAILURE_CLASSIFICATIONS.ENVIRONMENT_ERROR);
    });

    test("8. Controlled mock repair fixes mock contract errors without touching assertions or exceeding maxAttempts", () => {
        const sourceCode = `
            import { listOrders } from '../repos/orderRepo.js';
            export async function getOrderTotals() {
                const orders = await listOrders();
                return orders.map((o) => o.total);
            }
        `;
        const brokenTest = `
jest.mock('../repos/orderRepo.js', () => ({
  listOrders: jest.fn().mockResolvedValue({ notAnArray: true }),
}));
import { getOrderTotals } from '../services/orderService.js';
test('returns totals', async () => {
  const res = await getOrderTotals();
  expect(res).toEqual([10]);
});
        `.trim();

        const repaired = attemptControlledMockRepair({
            testCode: brokenTest,
            sourceCode,
            framework: "jest",
            errorMessage: "TypeError: orders.map is not a function",
            attempt: 1,
            maxAttempts: 2,
        });

        expect(repaired.repaired).toBe(true);
        expect(repaired.classification.classification).toBe(FAILURE_CLASSIFICATIONS.INVALID_MOCK_CONTRACT);
        expect(repaired.code).toContain("expect(res).toEqual([10])");
        expect(repaired.postContractViolations.filter((v) => v.severity === "error")).toEqual([]);

        const stopped = attemptControlledMockRepair({
            testCode: brokenTest,
            sourceCode,
            framework: "jest",
            errorMessage: "TypeError: orders.map is not a function",
            attempt: 3,
            maxAttempts: 2,
        });
        expect(stopped.repaired).toBe(false);
        expect(stopped.stoppedReason).toBe("MAX_REPAIR_ATTEMPTS_EXCEEDED");
    });

    test("9. Empty mock objects ({}) are rejected when contract or assertions require fields, and allowed otherwise", () => {
        const sourceCode = `
            import prisma from '../db/prisma.js';
            export async function getRecord(id) {
                return prisma.record.findUnique({ where: { id } });
            }
            export async function createRecord(data) {
                return prisma.record.create({ data });
            }
        `;
        const { contracts } = analyzeDataAccessContracts({ sourceCode });

        const badEmptyMockTest = `
            vi.mock('../db/prisma.js', () => ({
                default: {
                    record: {
                        findUnique: vi.fn().mockResolvedValue({}),
                        create: vi.fn().mockResolvedValue({}),
                    }
                }
            }));
            test('has id', async () => {
                const item = await getRecord(1);
                expect(item).toHaveProperty('id');
            });
        `;
        const badResult = validateMockContracts({ code: badEmptyMockTest, contracts, framework: "vitest" });
        expect(badResult.valid).toBe(false);
        expect(badResult.violations.some((v) => v.rule === "EMPTY_MOCK_OBJECT_FOR_CONTRACT")).toBe(true);

        // When neither source contract nor assertions require any fields, {} is allowed
        const neutralSource = `
            import client from '../db/client.js';
            export async function pingRaw() {
                return client.execute();
            }
        `;
        const neutralContracts = analyzeDataAccessContracts({ sourceCode: neutralSource }).contracts;
        const allowedEmptyTest = `
            vi.mock('../db/client.js', () => ({
                default: { execute: vi.fn().mockResolvedValue({}) }
            }));
            test('returns object', async () => {
                const res = await pingRaw();
                expect(typeof res).toBe('object');
            });
        `;
        const okResult = validateMockContracts({ code: allowedEmptyTest, contracts: neutralContracts, framework: "vitest" });
        expect(okResult.violations.some((v) => v.rule === "EMPTY_MOCK_OBJECT_FOR_CONTRACT")).toBe(false);
    });

    test("10. Independent operation fixtures and lifecycle restoreAllMocks normalization", () => {
        const sourceCode = `
            import prisma from '../db/prisma.js';
            export async function loadSummary(id) {
                const row = await prisma.entry.findUnique({ where: { id }, select: { id: true, title: true } });
                return row.title;
            }
        `;
        const { contracts } = analyzeDataAccessContracts({ sourceCode });
        expect(contracts[0].querySelectedFields).toEqual(["id", "title"]);
        const opFixtures = buildOperationFixtures(contracts);
        expect(opFixtures.find).toHaveProperty("id");
        expect(opFixtures.find).toHaveProperty("title");
        expect(opFixtures.create).toHaveProperty("id");

        // Do not assume every returned object requires id when ungrounded
        const noIdContracts = analyzeDataAccessContracts({
            sourceCode: `
                import store from '../db/store.js';
                export async function readToken() {
                    const res = await store.fetchMeta();
                    return res.token;
                }
            `,
        }).contracts;
        const noIdFixtures = buildOperationFixtures(noIdContracts);
        expect(noIdFixtures.find).toHaveProperty("token");
        expect(noIdFixtures.find).not.toHaveProperty("id");

        // Lifecycle safety: restoreAllMocks without spyOn is converted to clearAllMocks
        const lifecycleCode = `
            vi.mock('../db/prisma.js', () => ({
                default: { entry: { findUnique: vi.fn().mockResolvedValue({ id: 1, title: 'A' }) } }
            }));
            afterEach(() => { vi.restoreAllMocks(); });
            test('ok', () => { expect(true).toBe(true); });
        `;
        const norm = validateAndNormalizeMocks({ code: lifecycleCode, framework: "vitest" });
        expect(norm.code).toContain("vi.clearAllMocks()");
        expect(norm.repairs.some((r) => r.rule === "MOCK_RESET_PRESERVED")).toBe(true);
    });

    test("11. Docker sibling container /workspace/ paths match rootDir during verifyUnitTestBatch and cleanStoragePath", () => {
        expect(cleanStoragePath("/workspace/tests/productService.coverage.test.js")).toBe("tests/productService.coverage.test.js");
        const verification = verifyUnitTestBatch({
            rootDir: "/app/.covai-temp/apply-tx-xyz",
            testFiles: ["tests/productService.coverage.test.js"],
            exitCode: 0,
            results: {
                success: true,
                testResults: [
                    {
                        name: "/workspace/tests/productService.coverage.test.js",
                        status: "passed",
                        assertionResults: [
                            { status: "passed", title: "listFoodItems", ancestorTitles: ["Product Service"] },
                        ],
                    },
                ],
            },
        });
        expect(verification.valid).toBe(true);
        expect(verification.reasons).toEqual([]);
        expect(verification.perFile[0].valid).toBe(true);
    });

    test("12. Symmetric framework normalization converts vi.* to jest.* when Jest is selected", () => {
        const vitestCode = `
            import { describe, test, expect, vi } from 'vitest';
            vi.mock('../models/User.js', () => ({ default: { findOne: vi.fn() } }));
            describe('auth', () => {
                test('calls fn', () => {
                    const spy = vi.fn();
                    spy();
                    expect(spy).toHaveBeenCalled();
                });
            });
        `;
        const normalized = normalizeTestFrameworkCode(vitestCode, { framework: "jest" });
        expect(normalized).not.toContain("vi.fn");
        expect(normalized).not.toContain("vi.mock");
        expect(normalized).toContain("jest.fn");
        expect(normalized).toContain("jest.mock");
        const parsed = parseJavaScriptCode(normalized);
        expect(frameworkCompatibilityFindings(parsed.ast, "jest")).toEqual([]);
    });
});
