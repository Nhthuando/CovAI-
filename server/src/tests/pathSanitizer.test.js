import fs from "fs";
import os from "os";
import path from "path";
import { cleanStoragePath, cleanStorageText, canonicalizeFilePath } from "../utils/pathSanitizer.js";

describe("pathSanitizer", () => {
    describe("cleanStoragePath", () => {
        test("strips Docker container storage path to repo-relative path", () => {
            const dockerPath = "/app/storage/projects/cmutlynx100002ht4munumvfk/github/1791105489282/repo/tests/unit/handlers/create-account.handlers.test.ts";
            expect(cleanStoragePath(dockerPath)).toBe("tests/unit/handlers/create-account.handlers.test.ts");
        });

        test("strips Windows storage path to repo-relative path", () => {
            const winPath = "D:\\NCKH\\CovAI-\\server\\storage\\projects\\cmutlynx100002ht4munumvfk\\github\\1791105489282\\repo\\tests\\unit\\foo.test.ts";
            expect(cleanStoragePath(winPath)).toBe("tests/unit/foo.test.ts");
        });

        test("returns empty string if given repo root path", () => {
            const root = "/app/storage/projects/cmutlynx100002ht4munumvfk/github/1791105489282/repo";
            expect(cleanStoragePath(root)).toBe("");
        });

        test("preserves already-relative paths", () => {
            const rel = "tests/unit/handlers/create-account.handlers.test.ts";
            expect(cleanStoragePath(rel)).toBe("tests/unit/handlers/create-account.handlers.test.ts");
        });

        test("handles null or undefined safely", () => {
            expect(cleanStoragePath(null)).toBe("");
            expect(cleanStoragePath(undefined)).toBe("");
            expect(cleanStoragePath("")).toBe("");
        });
    });

    describe("cleanStorageText", () => {
        test("strips Docker container storage path from error message", () => {
            const errorMsg = "Cannot find module '@/handlers' from '/app/storage/projects/cmutlynx100002ht4munumvfk/github/1791105489282/repo/tests/unit/handlers/create-account.handlers.test.ts'";
            expect(cleanStorageText(errorMsg)).toBe("Cannot find module '@/handlers' from 'tests/unit/handlers/create-account.handlers.test.ts'");
        });

        test("strips Windows path from stack trace", () => {
            const trace = "at Object.<anonymous> (D:\\NCKH\\CovAI-\\server\\storage\\projects\\cmutlynx100002ht4munumvfk\\github\\1791105489282\\repo\\tests\\unit\\handlers\\create-account.handlers.test.ts:18:67)";
            expect(cleanStorageText(trace)).toBe("at Object.<anonymous> (tests\\unit\\handlers\\create-account.handlers.test.ts:18:67)");
        });

        test("handles null or undefined safely", () => {
            expect(cleanStorageText(null)).toBe(null);
            expect(cleanStorageText("")).toBe("");
        });
    });

    describe("canonicalizeFilePath", () => {
        let tempDir;

        beforeEach(() => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-path-test-"));
        });

        afterEach(() => {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) {}
        });

        test("strips project root basename if present in clean path", () => {
            const rootBasename = path.basename(tempDir);
            const subFile = path.join(tempDir, "server", "src", "index.js");
            fs.mkdirSync(path.dirname(subFile), { recursive: true });
            fs.writeFileSync(subFile, "console.log('hi');");

            const inputPath = `${rootBasename}/server/src/index.js`;
            const result = canonicalizeFilePath(inputPath, tempDir);
            expect(result).toBe("server/src/index.js");
        });

        test("maps subproject relative path to project-relative path (e.g. src/... to server/src/...)", () => {
            const serverSource = path.join(tempDir, "server", "src", "controllers", "chatController.js");
            fs.mkdirSync(path.dirname(serverSource), { recursive: true });
            fs.writeFileSync(serverSource, "export const chat = {};");

            const result = canonicalizeFilePath("src/controllers/chatController.js", tempDir);
            expect(result).toBe("server/src/controllers/chatController.js");
        });

        test("preserves direct file path when it exists at project root", () => {
            const directSource = path.join(tempDir, "src", "app.js");
            fs.mkdirSync(path.dirname(directSource), { recursive: true });
            fs.writeFileSync(directSource, "export default {};");

            const result = canonicalizeFilePath("src/app.js", tempDir);
            expect(result).toBe("src/app.js");
        });

        test("preserves already canonical subproject paths", () => {
            const serverSource = path.join(tempDir, "server", "src", "index.js");
            fs.mkdirSync(path.dirname(serverSource), { recursive: true });
            fs.writeFileSync(serverSource, "export const foo = 1;");

            const result = canonicalizeFilePath("server/src/index.js", tempDir);
            expect(result).toBe("server/src/index.js");
        });

        test("canonicalizes wrapper + subproject paths under /repo/<wrapper>/server to server/...", () => {
            const subprojectRoot = "/app/storage/projects/cmut123/github/999/repo/gemini_chatbox/server";
            expect(canonicalizeFilePath("server/src/config/env.js", subprojectRoot)).toBe("server/src/config/env.js");
            expect(canonicalizeFilePath("gemini_chatbox/server/src/config/env.js", subprojectRoot)).toBe("server/src/config/env.js");
            expect(canonicalizeFilePath("src/config/env.js", subprojectRoot)).toBe("server/src/config/env.js");
        });

        test("canonicalizes subproject paths under /uploads/snapshots/<id>/<wrapper>/server to server/...", () => {
            const snapshotSubRoot = "/app/uploads/snapshots/snap123/gemini_chatbox/server";
            expect(canonicalizeFilePath("server/src/config/env.js", snapshotSubRoot)).toBe("server/src/config/env.js");
            expect(canonicalizeFilePath("src/config/env.js", snapshotSubRoot)).toBe("server/src/config/env.js");
        });
    });
});
