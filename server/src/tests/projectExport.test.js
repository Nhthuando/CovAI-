import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

const prismaMock = {
    project: { findFirst: jest.fn() }, projectSnapshot: { findFirst: jest.fn() },
};
const many = ["coverageFile", "coverageFunction", "cyclomatic", "testRun", "aiSuggestion", "cfg", "vulnerability", "job"];
const unique = ["coverageSummary", "projectStructureAnalysis", "qualityReport", "performanceMetric"];
for (const model of many) prismaMock[model] = { findMany: jest.fn() };
for (const model of unique) prismaMock[model] = { findUnique: jest.fn() };
jest.unstable_mockModule("../config/prisma.js", () => ({ default: prismaMock }));
// Isolate unrelated endpoints, while importing the production project router and real auth/export code.
jest.unstable_mockModule("../controllers/project.controller.js", () => ({ default: new Proxy({}, { get: () => jest.fn() }) }));
jest.unstable_mockModule("../controllers/quality.controller.js", () => ({ runQualityAnalysis: jest.fn(), fetchQualityReport: jest.fn() }));
const { default: projectRouter } = await import("../routes/project.route.js");
const { loadExportScope, sanitizeExportData } = await import("../services/projectExport.service.js");
const app = express(); app.use("/api/projects", projectRouter);
const token = () => jwt.sign({ userId: "owner-1" }, process.env.JWT_SECRET);
const get = (query = "type=analysis&format=json") => request(app).get(`/api/projects/project-1/export?${query}`).set("Authorization", `Bearer ${token()}`);

beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = "export-test-secret";
    prismaMock.project.findFirst.mockResolvedValue({ id: "project-1", name: "Dự án thử nghiệm", description: "Demo", repoUrl: "https://user:password@github.com/team/repo?token=secret", createdAt: new Date("2026-10-01") });
    prismaMock.projectSnapshot.findFirst.mockResolvedValue({ id: "snapshot-1", projectId: "project-1", source: "ZIP", createdAt: new Date("2026-10-02"), rootDir: "C:/private/workspace" });
    for (const model of many) prismaMock[model].findMany.mockResolvedValue([]);
    for (const model of unique) prismaMock[model].findUnique.mockResolvedValue(null);
});

describe("authenticated project export route", () => {
    it("requires authentication on the real project router", async () => {
        const response = await request(app).get("/api/projects/project-1/export");
        expect(response.status).toBe(401);
        expect(prismaMock.project.findFirst).not.toHaveBeenCalled();
    });
    it("does not query a snapshot or analysis belonging to a foreign project", async () => {
        prismaMock.project.findFirst.mockResolvedValue(null);
        expect((await get()).status).toBe(404);
        expect(prismaMock.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "project-1", ownerId: "owner-1" } }));
        expect(prismaMock.projectSnapshot.findFirst).not.toHaveBeenCalled();
        expect(prismaMock.coverageFile.findMany).not.toHaveBeenCalled();
    });
    it("scopes an explicitly chosen snapshot to the owned project", async () => {
        prismaMock.projectSnapshot.findFirst.mockResolvedValue(null);
        expect((await get("type=analysis&format=json&snapshotId=foreign-snapshot")).status).toBe(404);
        expect(prismaMock.projectSnapshot.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "project-1", id: "foreign-snapshot" } }));
        expect(prismaMock.coverageSummary.findUnique).not.toHaveBeenCalled();
    });
    it("reports an import without a snapshot as not ready", async () => {
        prismaMock.projectSnapshot.findFirst.mockResolvedValue(null);
        expect((await get()).status).toBe(409);
    });
    it.each(["type=nope", "format=html", "snapshotId=../secret", "snapshotId=", "snapshotId=a&snapshotId=b", "type=project&format=json", "rootDir=/private", "userId=other"])("rejects invalid query %s", async (query) => {
        expect((await get(query)).status).toBe(400);
        expect(prismaMock.project.findFirst).not.toHaveBeenCalled();
    });
    it("exports snapshot-scoped safe JSON with nulls for missing analyses and download headers", async () => {
        prismaMock.coverageFile.findMany.mockResolvedValue([{ filePath: "C:/private/workspace/src/app.js", linesPct: 0 }]);
        const response = await get();
        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toContain("application/json");
        expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="covai-.*\.json"$/);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.body.schemaVersion).toBe(1);
        expect(response.body.project.name).toBe("Dự án thử nghiệm");
        expect(response.body.project.repoUrl).toBe("https://github.com/team/repo");
        expect(response.body.snapshot).not.toHaveProperty("rootDir");
        expect(response.body.analysis.coverage.summary).toBeNull();
        expect(response.body.analysis.coverage.files[0]).toEqual({ filePath: "src/app.js", linesPct: 0 });
        for (const model of [...many, ...unique]) {
            const method = many.includes(model) ? "findMany" : "findUnique";
            expect(prismaMock[model][method]).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ snapshotId: "snapshot-1" }) }));
        }
    });
    it("warns about in-progress and corrupt stored analysis instead of inventing data", async () => {
        prismaMock.job.findMany.mockResolvedValue([{ type: "ANALYSIS", status: "RUNNING" }]);
        prismaMock.projectStructureAnalysis.findUnique.mockResolvedValue({ resultJson: "broken-json" });
        const response = await get();
        expect(response.status).toBe(200);
        expect(response.body.warnings).toHaveLength(2);
        expect(response.body.analysis.structure).toBeNull();
    });
    it("defaults to a real PDF attachment with an embedded Unicode font", async () => {
        const response = await get("").buffer(true).parse((res, callback) => {
            const chunks = []; res.on("data", (chunk) => chunks.push(chunk)); res.on("end", () => callback(null, Buffer.concat(chunks)));
        });
        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toBe("application/pdf");
        expect(response.body.subarray(0, 5).toString()).toBe("%PDF-");
        expect(response.body.toString("latin1")).toContain("/FontFile2");
    });
    it("returns ZIP-not-ready when source is unavailable", async () => {
        prismaMock.projectSnapshot.findFirst.mockResolvedValue({ id: "snapshot-1", projectId: "project-1", rootDir: null });
        expect((await get("type=project")).status).toBe(409);
    });
    it("downloads an owned snapshot as a real ZIP attachment", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "covai-export-route-"));
        try {
            await fs.writeFile(path.join(root, "app.js"), "export const value = 1;");
            await fs.writeFile(path.join(root, ".env"), "PRIVATE=true");
            prismaMock.projectSnapshot.findFirst.mockResolvedValue({ id: "snapshot-1", rootDir: root });
            const response = await get("type=project").buffer(true).parse((res, callback) => {
                const chunks = []; res.on("data", (chunk) => chunks.push(chunk)); res.on("end", () => callback(null, Buffer.concat(chunks)));
            });
            expect(response.status).toBe(200);
            expect(response.headers["content-type"]).toBe("application/zip");
            expect(response.headers["content-disposition"]).toContain(".zip");
            expect(new AdmZip(response.body).getEntries().map((entry) => entry.entryName)).toEqual(["app.js"]);
        } finally { await fs.rm(root, { recursive: true, force: true }); }
    });
    it("exports both packages of a GitHub monorepo", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "covai-export-monorepo-"));
        try {
            await fs.mkdir(path.join(root, "client")); await fs.mkdir(path.join(root, "server"));
            await fs.writeFile(path.join(root, "client", "App.jsx"), "client");
            await fs.writeFile(path.join(root, "server", "index.js"), "server");
            prismaMock.projectSnapshot.findFirst.mockResolvedValue({ id: "snapshot-1", source: "GITHUB", storagePath: root, rootDir: path.join(root, "server") });
            const response = await get("type=project").buffer(true).parse((res, callback) => {
                const chunks = []; res.on("data", chunk => chunks.push(chunk)); res.on("end", () => callback(null, Buffer.concat(chunks)));
            });
            expect(response.status).toBe(200);
            expect(new AdmZip(response.body).getEntries().map(entry => entry.entryName)).toEqual(["client/App.jsx", "server/index.js"]);
            const json = await get();
            expect(json.body.snapshot).not.toHaveProperty("storagePath");
        } finally { await fs.rm(root, { recursive: true, force: true }); }
    });
    it("limits concurrent export preparation and releases capacity after completion", async () => {
        const pending = [];
        let ready;
        const started = new Promise((resolve) => { ready = resolve; });
        prismaMock.coverageSummary.findUnique.mockImplementation(() => new Promise((resolve) => {
            pending.push(resolve);
            if (pending.length === 2) ready();
        }));
        const first = get().then((response) => response.status);
        const second = get().then((response) => response.status);
        await started;
        const third = await get();
        expect(third.status).toBe(429);
        expect(third.headers["retry-after"]).toBe("10");
        pending.forEach((resolve) => resolve(null));
        expect(await first).toBe(200); expect(await second).toBe(200);
        prismaMock.coverageSummary.findUnique.mockResolvedValue(null);
        expect((await get()).status).toBe(200);
    });
    it("rejects identity-less auth before a Prisma owner filter can become undefined", async () => {
        await expect(loadExportScope({ projectId: "project-1", userId: undefined })).rejects.toMatchObject({ statusCode: 401 });
        expect(prismaMock.project.findFirst).not.toHaveBeenCalled();
    });
    it("removes private keys and host paths recursively", () => {
        expect(sanitizeExportData({ rootDir: "secret", nodes: [{ absolutePath: "/private", path: "C:\\root\\src\\a.js", graph: { token: "secret" } }], file: "/other/private/b.js" }, "C:/root"))
            .toEqual({ nodes: [{ path: "src/a.js", graph: {} }], file: "[external]/b.js" });
    });
    it("preserves escaped expressions and route strings in structured analysis", () => {
        const graph = { label: "value.match(/\\d+/)", route: "/api/projects", message: "check \\n handling" };
        expect(sanitizeExportData(graph, "C:/root")).toEqual(graph);
    });
});
