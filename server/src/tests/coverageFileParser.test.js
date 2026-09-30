import { describe, it, expect } from "@jest/globals";
import { parseCoverageFilesForSnapshot } from "../services/coverageFileParser.service.js";

describe("coverageFileParser.service", () => {
    it("throws if required fields are missing", async () => {
        await expect(parseCoverageFilesForSnapshot({})).rejects.toThrow();
    });
});

