import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

const bucket = { getFiles: jest.fn(), file: jest.fn() };
await jest.unstable_mockModule("../config/firebase.js", () => ({ getBucket: () => bucket }));
const { cleanupProjectStorageAsync } = await import("../services/projectStorageCleanup.service.js");

describe("project storage cleanup", () => {
    let baseDir;
    const projectId = "project-a";
    const exists = async relative => fs.access(path.join(baseDir, relative)).then(() => true, () => false);
    const write = async relative => {
        const file = path.join(baseDir, relative);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, "fixture");
    };
    const cleanup = snapshots => cleanupProjectStorageAsync(projectId, snapshots, { baseDir });
    beforeEach(async () => {
        baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "covai-delete-storage-"));
        jest.clearAllMocks();
        bucket.getFiles.mockResolvedValue([[]]);
        jest.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(async () => {
        jest.restoreAllMocks();
        await fs.rm(baseDir, { recursive: true, force: true });
    });

    it("removes complete ZIP workspaces, failed extractions and Git/checkpoint storage, preserving other projects", async () => {
        await Promise.all([
            "uploads/snapshots/snap-a/repo/backend/index.js",
            "uploads/snapshots/snap-a/repo/frontend/App.jsx",
            "uploads/snapshots/snap-a/README.md",
            "uploads/snapshots/snap-incomplete/partial.txt",
            "storage/projects/project-a/github/123/repo/backend/index.js",
            "storage/projects/project-a/github/123/repo/frontend/App.jsx",
            "storage/projects/project-a/snapshots/checkpoint/index.js",
            "storage/projects/project-ab/keep.txt",
            "uploads/snapshots/other-snapshot/keep.txt",
            "uploads/temp/unrelated.zip",
        ].map(write));
        const cloudFile = { name: "projects/project-a/archive.zip", delete: jest.fn().mockResolvedValue() };
        bucket.getFiles.mockResolvedValue([[cloudFile]]);
        await cleanup([
            { id: "snap-a", rootDir: "/app/uploads/snapshots/snap-a/repo/backend", storagePath: "projects/project-a/archive.zip" },
            { id: "snap-incomplete", rootDir: null },
            { id: "snap-github", rootDir: "/app/storage/projects/project-a/github/123/repo/backend", storagePath: "/app/storage/projects/project-a/github/123/repo" },
        ]);
        expect(await exists("uploads/snapshots/snap-a")).toBe(false);
        expect(await exists("uploads/snapshots/snap-incomplete")).toBe(false);
        expect(await exists("storage/projects/project-a")).toBe(false);
        expect(await exists("storage/projects/project-ab/keep.txt")).toBe(true);
        expect(await exists("uploads/snapshots/other-snapshot/keep.txt")).toBe(true);
        expect(await exists("uploads/temp/unrelated.zip")).toBe(true);
        expect(bucket.getFiles).toHaveBeenCalledWith({ prefix: "projects/project-a/" });
        expect(cloudFile.delete).toHaveBeenCalledWith({ ignoreNotFound: true });
        expect(bucket.file).not.toHaveBeenCalled();
    });

    it("never uses a rootDir pointing outside the project's managed directories", async () => {
        await write("private/keep.txt");
        await write("uploads/snapshots/snap-a/repo/index.js");
        await cleanup([{ id: "snap-a", rootDir: path.join(baseDir, "private"), storagePath: "projects/other/archive.zip" }]);
        expect(await exists("private/keep.txt")).toBe(true);
        expect(await exists("uploads/snapshots/snap-a")).toBe(false);
        expect(bucket.file).not.toHaveBeenCalled();
    });

    it.each(["../other", "..", "a/b", "a\\b", "", "C:\\private"])("rejects unsafe IDs before any deletion: %s", async id => {
        await write("storage/projects/project-a/keep.txt");
        await expect(cleanup([{ id }])).rejects.toMatchObject({ statusCode: 503, code: "PROJECT_CLEANUP_FAILED" });
        await expect(cleanupProjectStorageAsync(id, [], { baseDir })).rejects.toMatchObject({ statusCode: 503 });
        expect(await exists("storage/projects/project-a/keep.txt")).toBe(true);
        expect(bucket.getFiles).not.toHaveBeenCalled();
    });

    it.each(["storage/projects/project-a", "storage/projects"])("rejects symlinks or junctions at %s before deleting any data", async link => {
        await write("other-project/keep.txt");
        await write("uploads/snapshots/snap-a/keep.txt");
        await fs.mkdir(path.dirname(path.join(baseDir, link)), { recursive: true });
        await fs.symlink(path.join(baseDir, "other-project"), path.join(baseDir, link), process.platform === "win32" ? "junction" : "dir");
        await expect(cleanup([{ id: "snap-a" }])).rejects.toMatchObject({ statusCode: 503 });
        expect(await exists("other-project/keep.txt")).toBe(true);
        expect(await exists("uploads/snapshots/snap-a/keep.txt")).toBe(true);
        expect(bucket.getFiles).not.toHaveBeenCalled();
    });

    it("removes links within a snapshot without following them into another workspace", async () => {
        await write("other-project/keep.txt");
        await write("uploads/snapshots/snap-a/index.js");
        await fs.symlink(path.join(baseDir, "other-project"), path.join(baseDir, "uploads/snapshots/snap-a/linked"), process.platform === "win32" ? "junction" : "dir");
        await cleanup([{ id: "snap-a" }]);
        expect(await exists("uploads/snapshots/snap-a")).toBe(false);
        expect(await exists("other-project/keep.txt")).toBe(true);
    });

    it("reports local deletion failure and succeeds when retried after the lock is released", async () => {
        await write("uploads/snapshots/snap-a/index.js");
        const remove = fs.rm.bind(fs);
        const lockedTarget = path.join(baseDir, "uploads/snapshots/snap-a");
        const spy = jest.spyOn(fs, "rm").mockImplementation((target, options) => {
            if (target === lockedTarget) return Promise.reject(Object.assign(new Error("File is locked"), { code: "EPERM" }));
            return remove(target, options);
        });
        await expect(cleanup([{ id: "snap-a" }])).rejects.toMatchObject({ statusCode: 503 });
        expect(await exists("uploads/snapshots/snap-a/index.js")).toBe(true);
        expect(console.error).toHaveBeenCalled();
        spy.mockRestore();
        await cleanup([{ id: "snap-a" }]);
        expect(await exists("uploads/snapshots/snap-a")).toBe(false);
    });

    it("propagates cloud listing and deletion failures; tolerates already deleted files", async () => {
        bucket.getFiles.mockRejectedValueOnce(new Error("Storage unavailable"));
        await expect(cleanup([])).rejects.toMatchObject({ statusCode: 503 });
        const file = { name: "projects/project-a/archive.zip", delete: jest.fn().mockRejectedValue({ code: 403 }) };
        bucket.getFiles.mockResolvedValue([[file]]);
        await expect(cleanup([])).rejects.toMatchObject({ statusCode: 503 });
        file.delete.mockRejectedValue({ code: 404 });
        await expect(cleanup([])).resolves.toBeUndefined();
    });

    it("refuses cloud files outside the exact project prefix", async () => {
        const file = { name: "projects/project-ab/archive.zip", delete: jest.fn() };
        bucket.getFiles.mockResolvedValue([[file]]);
        await expect(cleanup([])).rejects.toMatchObject({ statusCode: 503 });
        expect(file.delete).not.toHaveBeenCalled();
    });

    it("does not report completion while a cloud deletion is pending", async () => {
        let finish;
        let started;
        const ready = new Promise(resolve => { started = resolve; });
        const file = { name: "projects/project-a/archive.zip", delete: jest.fn(() => {
            started();
            return new Promise(resolve => { finish = resolve; });
        }) };
        bucket.getFiles.mockResolvedValue([[file]]);
        let complete = false;
        const work = cleanup([]).then(() => { complete = true; });
        await ready;
        expect(complete).toBe(false);
        finish();
        await work;
        expect(complete).toBe(true);
    });
});
