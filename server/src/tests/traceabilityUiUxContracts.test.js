
import { describe, it, expect } from "@jest/globals";

import {
    resolveSmartBadgeState,
    generateLinkedTestTabs,
    resolveSuggestionStatusBadge
} from "../utils/traceabilityUiHelpers.js";

describe("Section 5: UI/UX Transformation Logic & State Machine Verification", () => {
    describe("5.2 Smart Linked Badge State Machine", () => {
        it("Resolves MULTI_LINKED state with selectable options when N >= 2", () => {
            const files = [
                { filePath: "tests/unit/handlers/create-account.handlers.test.ts", fileName: "create-account.handlers.test.ts", relationType: "DIRECT_IMPORT", found: true },
                { filePath: "tests/integration/quickbooks-api.integration.test.ts", fileName: "quickbooks-api.integration.test.ts", relationType: "EXECUTION_TRACE", found: true }
            ];

            const badge = resolveSmartBadgeState(files, { statements: { covered: 29, pct: 78.37 } });

            expect(badge.type).toBe("MULTI_LINKED");
            expect(badge.count).toBe(2);
            expect(badge.options).toHaveLength(2);
            expect(badge.options[0].label).toContain("(Import)");
            expect(badge.options[1].label).toContain("(Linked)");
        });

        it("Resolves SINGLE_LINKED state when N = 1", () => {
            const files = [
                { filePath: "tests/unit/auth.test.ts", fileName: "auth.test.ts", relationType: "DIRECT_IMPORT", found: true }
            ];

            const badge = resolveSmartBadgeState(files, { statements: { covered: 10, pct: 100 } });

            expect(badge.type).toBe("SINGLE_LINKED");
            expect(badge.label).toBe("Test: auth.test.ts");
            expect(badge.relation).toBe("DIRECT_IMPORT");
        });

        it("Resolves INTEGRATION_COVERED state when N = 0 but statements covered > 0", () => {
            const badge = resolveSmartBadgeState([], { statements: { covered: 15, pct: 54.2 } });

            expect(badge.type).toBe("INTEGRATION_COVERED");
            expect(badge.label).toContain("Covered via integration suite");
        });

        it("Resolves GREENFIELD_UNTESTED state when N = 0 and statements covered == 0", () => {
            const badge = resolveSmartBadgeState([], { statements: { covered: 0, pct: 0 } });

            expect(badge.type).toBe("GREENFIELD_UNTESTED");
            expect(badge.label).toContain("No linked test file");
            expect(badge.readyForAi).toBe(true);
        });
    });

    describe("5.3 Linked Tests Tabs Bar Logic", () => {
        const mockFiles = [
            { filePath: "tests/unit/user.test.ts", fileName: "user.test.ts", relationType: "DIRECT_IMPORT", framework: "jest" },
            { filePath: "tests/e2e/user-flow.spec.ts", fileName: "user-flow.spec.ts", relationType: "EXECUTION_TRACE", framework: "vitest" }
        ];

        it("Hides tabs bar when only 1 or 0 test files exist", () => {
            const res0 = generateLinkedTestTabs([]);
            const res1 = generateLinkedTestTabs([mockFiles[0]]);

            expect(res0.showTabsBar).toBe(false);
            expect(res1.showTabsBar).toBe(false);
        });

        it("Shows tabs bar and correctly marks selected tab when N >= 2", () => {
            const res = generateLinkedTestTabs(mockFiles, "tests/e2e/user-flow.spec.ts");

            expect(res.showTabsBar).toBe(true);
            expect(res.tabs).toHaveLength(2);

            // Tab 1: user.test.ts
            expect(res.tabs[0].fileName).toBe("user.test.ts");
            expect(res.tabs[0].isSelected).toBe(false);
            expect(res.tabs[0].badgeText).toBe("Import");
            expect(res.tabs[0].framework).toBe("JEST");

            // Tab 2: user-flow.spec.ts (Selected)
            expect(res.tabs[1].fileName).toBe("user-flow.spec.ts");
            expect(res.tabs[1].isSelected).toBe(true);
            expect(res.tabs[1].badgeText).toBe("Trace");
            expect(res.tabs[1].framework).toBe("VITEST");
        });
    });

    describe("5.4 Suggestion Status Badge Lifecycle", () => {
        it("Maps all lifecycle states deterministically", () => {
            expect(resolveSuggestionStatusBadge("READY").label).toBe("Ready to Apply");
            expect(resolveSuggestionStatusBadge("APPLYING").spin).toBe(true);
            expect(resolveSuggestionStatusBadge("PASSED").color).toBe("green");
            expect(resolveSuggestionStatusBadge("FAILED").color).toBe("red");
            expect(resolveSuggestionStatusBadge("EDITED").color).toBe("purple");
            expect(resolveSuggestionStatusBadge("REJECTED").color).toBe("gray");
        });
    });
});
