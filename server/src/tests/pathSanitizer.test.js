import { cleanStoragePath, cleanStorageText } from "../utils/pathSanitizer.js";

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
});
