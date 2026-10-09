import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { createProjectArchive } from "../services/projectArchive.service.js";

let root;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "covai-export-test-")); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const file = async (name, content = "source") => {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), content);
};

describe("snapshot source ZIP", () => {
    it("includes source, tests, and templates while excluding dependencies, credentials, backups and metadata", async () => {
        const included = ["src/app.js", "tests/app.test.js", "README.md", ".env.example", "package-lock.json"];
        const excluded = [".env", ".env.production", ".env.local.bak", "server/prod.env", "secrets.json", "firebase-adminsdk.json", "service-account.json", "private.key", "cert.pem.bak", ".npmrc", ".git/config", "node_modules/a/index.js", ".aws/config", ".covai-checkpoint.json"];
        for (const name of [...included, ...excluded]) await file(name);
        const result = await createProjectArchive(root);
        const zip = new AdmZip(result.buffer);
        expect(zip.getEntries().map((entry) => entry.entryName).sort()).toEqual(included.sort());
        expect(zip.readAsText("src/app.js")).toBe("source");
        expect(result.fileCount).toBe(5);
        expect(result.excludedCount).toBeGreaterThan(0);
    });

    it("rejects missing or empty source with a recoverable error", async () => {
        await expect(createProjectArchive(null)).rejects.toMatchObject({ statusCode: 409 });
        await expect(createProjectArchive(path.join(root, "missing"))).rejects.toMatchObject({ statusCode: 409 });
        await file(".env", "private");
        await expect(createProjectArchive(root)).rejects.toMatchObject({ statusCode: 409 });
    });

    it("checks aggregate byte and file-count limits before assembling an archive", async () => {
        await file("a.js", "12345"); await file("b.js", "67890");
        await expect(createProjectArchive(root, { maxBytes: 9 })).rejects.toMatchObject({ statusCode: 413 });
        await expect(createProjectArchive(root, { maxFiles: 1 })).rejects.toMatchObject({ statusCode: 413 });
        const result = await createProjectArchive(root, { maxBytes: 10, maxFiles: 2 });
        expect(result.totalBytes).toBe(10);
    });

    it("skips a symlink/junction that points outside the selected snapshot", async () => {
        const external = await fs.mkdtemp(path.join(os.tmpdir(), "covai-export-outside-"));
        try {
            await fs.writeFile(path.join(external, "private.js"), "outside");
            await file("safe.js");
            await fs.symlink(external, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
            const result = await createProjectArchive(root);
            expect(new AdmZip(result.buffer).getEntries().map((entry) => entry.entryName)).toEqual(["safe.js"]);
            await expect(createProjectArchive(path.join(root, "linked"))).rejects.toMatchObject({ statusCode: 409 });
        } finally { await fs.rm(external, { recursive: true, force: true }); }
    });
});
