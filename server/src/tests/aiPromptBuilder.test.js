import { describe, expect, it } from "@jest/globals";
import { buildFinalPrompt, includeTestingInstructions } from "../services/aiPromptBuilder.service.js";

describe("aiPromptBuilder framework selection", () => {
    it("honors an explicit Jest selection over the existing Vitest fallback", () => {
        expect(includeTestingInstructions("FULL", [], { hasJest: true, hasVitest: true, selectedFramework: "jest" }))
            .toContain("using the **Jest** framework");
    });

    it("keeps the existing Vitest fallback when no selection exists", () => {
        expect(includeTestingInstructions("FULL", [], { hasJest: true, hasVitest: true }))
            .toContain("using the **Vitest** framework");
    });

    it("honors a valid selection carried by the AI context payload", () => {
        const prompt = buildFinalPrompt({ sourceCode: [], coverage: {}, complexity: [], cfg: [], testFiles: [], selectedTestingFramework: "vitest" }, { hasJest: true });
        expect(prompt).toContain("using the **Vitest** framework");
    });

    it("ignores invalid persisted values", () => {
        expect(includeTestingInstructions("FULL", [], { hasJest: false, hasVitest: true, selectedFramework: "cypress" }))
            .toContain("using the **Vitest** framework");
    });
});
