import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect } from "@jest/globals";
import { parseCoverageFilesForSnapshot, extractFilePath } from "../services/coverageFileParser.service.js";

describe("coverageFileParser.service", () => {
    it("throws if required fields are missing", async () => {
        await expect(parseCoverageFilesForSnapshot({})).rejects.toThrow();
    });

    it("canonicalizes subproject coverage paths relative to rootDir via extractFilePath", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-covparser-test-"));
        try {
            const serverSource = path.join(tempDir, "server", "src", "controllers", "chatController.js");
            fs.mkdirSync(path.dirname(serverSource), { recursive: true });
            fs.writeFileSync(serverSource, "export const chat = {};");

            const entry = { path: "src/controllers/chatController.js" };
            const resolved = extractFilePath(entry, "src/controllers/chatController.js", tempDir);

            expect(resolved).toBe("server/src/controllers/chatController.js");
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

