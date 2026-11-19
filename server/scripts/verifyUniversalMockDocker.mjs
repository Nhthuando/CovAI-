import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateUniversalMocks } from "../src/services/universalMockEngine.service.js";
import { validateAndNormalizeMocks, validateMockContracts } from "../src/services/mockValidation.service.js";
import { runUnitTestBatch } from "../src/services/unitTestBatchRunner.service.js";

async function runFixtureSuite(framework) {
    const tempBase = path.join(process.cwd(), ".covai-temp");
    fs.mkdirSync(tempBase, { recursive: true });
    const tmpRoot = fs.mkdtempSync(path.join(tempBase, `ume-docker-${framework}-`));
    const coverageDir = path.join(tmpRoot, "coverage");
    fs.mkdirSync(coverageDir, { recursive: true });
    try {
        const appNodeModules = path.join(process.cwd(), "node_modules");
        if (fs.existsSync(appNodeModules)) {
            fs.symlinkSync(appNodeModules, path.join(tmpRoot, "node_modules"), "dir");
        }
        fs.mkdirSync(path.join(tmpRoot, "src", "services"), { recursive: true });
        fs.mkdirSync(path.join(tmpRoot, "src", "repos"), { recursive: true });
        fs.mkdirSync(path.join(tmpRoot, "tests"), { recursive: true });

        const pkgJson = {
            name: `ume-fixture-${framework}`,
            ...(framework === "vitest" ? { type: "module" } : {}),
            scripts: {
                test: framework === "vitest" ? "vitest run" : "jest",
            },
            dependencies: {},
            devDependencies: framework === "vitest" ? { vitest: "^2.0.0" } : { jest: "^29.0.0" },
        };
        fs.writeFileSync(path.join(tmpRoot, "package.json"), JSON.stringify(pkgJson, null, 2));
        if (framework === "jest") {
            fs.writeFileSync(
                path.join(tmpRoot, "babel.config.cjs"),
                `module.exports = { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] };\n`
            );
        }

        // 1. Prisma-style service
        const prismaSrc = `
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export async function listActiveAccounts() {
    const accounts = await prisma.account.findMany({ where: { active: true } });
    return accounts.map((a) => a.email);
}
`;
        // 2. Mongoose-style chained query service
        const mongooseSrc = `
import mongoose from 'mongoose';
const EntryModel = mongoose.model('Entry');
export async function getEntrySlug(id) {
    const entry = await EntryModel.findById(id).populate('author').lean().exec();
    if (!entry) return null;
    return entry.slug;
}
`;
        // 3. Sequelize-style service
        const sequelizeSrc = `
import { Sequelize } from 'sequelize';
const seq = new Sequelize();
const Invoice = seq.define('Invoice');
export async function getPositiveInvoices() {
    const rows = await Invoice.findAll();
    return rows.filter((r) => r.amount > 0);
}
`;
        // 4. TypeORM-style queryBuilder service
        const typeormSrc = `
import { getRepository } from 'typeorm';
export async function fetchPaidOrders() {
    const orders = await getRepository('Order').createQueryBuilder('o').where('o.paid = :p', { p: true }).getMany();
    return orders.map((o) => o.id);
}
`;
        // 5. Custom repository without ORM
        const customRepoImpl = `
export async function loadActiveItems() {
    throw new Error('Real DB should never be called in unit test');
}
`;
        const customRepoSrc = `
import { loadActiveItems } from '../repos/itemRepo.js';
export async function listItemCodes() {
    const items = await loadActiveItems();
    return items.map((item) => item.code);
}
`;

        fs.writeFileSync(path.join(tmpRoot, "src", "repos", "itemRepo.js"), customRepoImpl);
        fs.writeFileSync(path.join(tmpRoot, "src", "services", "prismaSvc.js"), prismaSrc);
        fs.writeFileSync(path.join(tmpRoot, "src", "services", "mongooseSvc.js"), mongooseSrc);
        fs.writeFileSync(path.join(tmpRoot, "src", "services", "sequelizeSvc.js"), sequelizeSrc);
        fs.writeFileSync(path.join(tmpRoot, "src", "services", "typeormSvc.js"), typeormSrc);
        fs.writeFileSync(path.join(tmpRoot, "src", "services", "customSvc.js"), customRepoSrc);

        const runnerHeader = framework === "vitest"
            ? `import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';`
            : `import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';`;

        const cases = [
            {
                name: "prisma",
                src: prismaSrc,
                srcFile: "src/services/prismaSvc.js",
                testFile: "tests/prismaSvc.test.js",
                body: `import { listActiveAccounts } from '../src/services/prismaSvc.js';\ndescribe('Prisma fixture', () => {\n  test('returns mapped emails', async () => {\n    const res = await listActiveAccounts();\n    expect(Array.isArray(res)).toBe(true);\n    expect(res.length).toBeGreaterThan(0);\n  });\n});`,
            },
            {
                name: "mongoose",
                src: mongooseSrc,
                srcFile: "src/services/mongooseSvc.js",
                testFile: "tests/mongooseSvc.test.js",
                body: `import { getEntrySlug } from '../src/services/mongooseSvc.js';\ndescribe('Mongoose fixture', () => {\n  test('resolves chained query slug', async () => {\n    const slug = await getEntrySlug('id-1');\n    expect(typeof slug).toBe('string');\n  });\n});`,
            },
            {
                name: "sequelize",
                src: sequelizeSrc,
                srcFile: "src/services/sequelizeSvc.js",
                testFile: "tests/sequelizeSvc.test.js",
                body: `import { getPositiveInvoices } from '../src/services/sequelizeSvc.js';\ndescribe('Sequelize fixture', () => {\n  test('filters positive invoices', async () => {\n    const res = await getPositiveInvoices();\n    expect(Array.isArray(res)).toBe(true);\n    expect(res.length).toBeGreaterThan(0);\n  });\n});`,
            },
            {
                name: "typeorm",
                src: typeormSrc,
                srcFile: "src/services/typeormSvc.js",
                testFile: "tests/typeormSvc.test.js",
                body: `import { fetchPaidOrders } from '../src/services/typeormSvc.js';\ndescribe('TypeORM fixture', () => {\n  test('returns order ids from queryBuilder', async () => {\n    const res = await fetchPaidOrders();\n    expect(Array.isArray(res)).toBe(true);\n    expect(res.length).toBeGreaterThan(0);\n  });\n});`,
            },
            {
                name: "custom-repo",
                src: customRepoSrc,
                srcFile: "src/services/customSvc.js",
                testFile: "tests/customSvc.test.js",
                body: `import { listItemCodes } from '../src/services/customSvc.js';\ndescribe('Custom repo fixture', () => {\n  test('maps item codes from custom repository', async () => {\n    const res = await listItemCodes();\n    expect(Array.isArray(res)).toBe(true);\n    expect(res.length).toBeGreaterThan(0);\n  });\n});`,
            },
        ];

        const testFiles = [];
        for (const c of cases) {
            const gen = generateUniversalMocks({
                rootDir: tmpRoot,
                sourceCode: c.src,
                sourceFile: c.srcFile,
                targetTestFile: c.testFile,
                framework,
            });
            const rawTest = `${runnerHeader}\n${gen.mockCode}\n\n${c.body}\n`;
            const norm = validateAndNormalizeMocks({
                code: rawTest,
                filePath: path.join(tmpRoot, c.testFile),
                sourceFile: path.join(tmpRoot, c.srcFile),
                rootDir: tmpRoot,
                framework,
            });
            const contractCheck = validateMockContracts({
                code: norm.code,
                contracts: gen.contractReport.contracts,
                framework,
            });
            if (!contractCheck.valid) {
                throw new Error(`Contract check failed for ${framework}/${c.name}: ${JSON.stringify(contractCheck.violations)}`);
            }
            fs.writeFileSync(path.join(tmpRoot, c.testFile), norm.code, "utf8");
            testFiles.push(c.testFile);
        }

        const batch = await runUnitTestBatch({ rootDir: tmpRoot, testFiles, coverageDir, requireDocker: true });
        const resultsJsonPath = path.join(coverageDir, "test-results.json");
        const parsedResults = fs.existsSync(resultsJsonPath)
            ? JSON.parse(fs.readFileSync(resultsJsonPath, "utf8"))
            : null;
        return {
            framework,
            exitCode: batch.exitCode,
            success: parsedResults?.success ?? (batch.exitCode === 0),
            numTestSuites: parsedResults?.testResults?.length ?? 0,
            numPassedTests: (parsedResults?.testResults || []).reduce(
                (n, s) => n + (s.assertionResults || []).filter((a) => a.status === "passed").length,
                0
            ),
            numFailedTests: parsedResults?.numFailedTestSuites ?? 0,
            failures: (parsedResults?.testResults || [])
                .filter((s) => s.status === "failed")
                .map((s) => ({
                    name: path.basename(s.name || ""),
                    message: s.message || (s.assertionResults || []).filter((a) => a.status === "failed").map((a) => a.failureMessages).flat().join("\n"),
                })),
            error: batch.stderr || null,
        };
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
}

const vitestResult = await runFixtureSuite("vitest");
const jestResult = await runFixtureSuite("jest");
console.log("DOCKER_UME_RESULTS:", JSON.stringify({ vitest: vitestResult, jest: jestResult }, null, 2));
if (vitestResult.exitCode !== 0 || jestResult.exitCode !== 0 || !vitestResult.success || !jestResult.success) {
    process.exit(1);
}
