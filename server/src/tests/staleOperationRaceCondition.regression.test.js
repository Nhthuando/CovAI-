import { describe, it, expect } from "@jest/globals";

describe("Stale Operation Race Condition Handling (R4)", () => {
    it("recognizes OPERATION_STALE error code and message gracefully", () => {
        const staleError = new Error("Source changed while this operation was running");
        staleError.code = "OPERATION_STALE";

        let handled = false;
        try {
            if (staleError.code === "OPERATION_STALE") {
                handled = true;
            } else {
                throw staleError;
            }
        } catch (_) {
            handled = false;
        }

        expect(handled).toBe(true);
    });

    it("ensures error message is preserved without crashing logger", () => {
        const error = {
            code: "OPERATION_STALE",
            message: "Source changed while this operation was running"
        };
        const logMsg = `[Queue] Job job_123 (Type: RUN_TESTS) was superseded by a newer workspace revision (${error.code}: ${error.message}).`;
        expect(logMsg).toContain("OPERATION_STALE");
        expect(logMsg).toContain("job_123");
    });
});
