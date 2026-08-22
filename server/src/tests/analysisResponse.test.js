import { describe, expect, it } from "@jest/globals";
import { snapshotResponse } from "../services/analysisResponse.service.js";

describe("snapshotResponse", () => {
    it("exposes persisted testing framework detection", () => {
        expect(snapshotResponse({
            id: "snapshot-1",
            testingFrameworksJson: JSON.stringify({ frameworkType: "multiple", detectedFrameworks: ["jest", "vitest"] }),
        })).toMatchObject({
            testingFrameworks: { frameworkType: "multiple", detectedFrameworks: ["jest", "vitest"] },
        });
    });

    it("handles snapshots created before the framework metadata column", () => {
        expect(snapshotResponse({ id: "snapshot-1", testingFrameworksJson: "invalid" }).testingFrameworks).toBeNull();
    });

    it("exposes a persisted framework recommendation and selection", () => {
        expect(snapshotResponse({
            id: "snapshot-1",
            frameworkRecommendationJson: JSON.stringify({ version: 1, recommendedFramework: "vitest" }),
            selectedTestingFramework: "vitest",
        })).toMatchObject({
            frameworkRecommendation: { version: 1, recommendedFramework: "vitest" },
            selectedTestingFramework: "vitest",
        });
    });
});
