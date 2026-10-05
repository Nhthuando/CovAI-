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

describe("buildPlaywrightPrompt", () => {
    it('includes component controls and prohibits mocks in full system mode',async()=>{
        const {buildPlaywrightPrompt}=await import('../services/aiPromptBuilder.service.js');
        const prompt=buildPlaywrightPrompt({sourceCode:[{path:'src/components/TodoItem.jsx',content:'row editor controls'}]},{executionMode:'full'});
        expect(prompt).toContain('row editor controls');
        expect(prompt).toContain('NEVER mock APIs');
        expect(prompt).toContain('page.reload()');
        expect(prompt).not.toContain('mock them using');
    });
    it("constructs Playwright prompt with strict anti-flakiness and selector rules", async () => {
        const { buildPlaywrightPrompt } = await import("../services/aiPromptBuilder.service.js");
        const payload = {
            sourceCode: [
                { path: "src/App.jsx", content: "export default function App() { return <h1>Hello</h1>; }" },
                { path: "src/routes.js", content: "export const routes = ['/', '/about'];" },
            ],
        };
        const prompt = buildPlaywrightPrompt(payload);
        expect(prompt).toContain("Senior QA Automation Engineer");
        expect(prompt).toContain("Playwright");
        expect(prompt).toContain("src/App.jsx");
        expect(prompt).toContain("NEVER use `page.waitForTimeout()`");
        expect(prompt).toContain("http://localhost:4173");
        expect(prompt).toContain("tests/e2e/ai-generated.spec.js");
    });
});

