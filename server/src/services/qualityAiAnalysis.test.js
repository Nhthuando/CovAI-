import { parseQualityAiResponse, buildQualityPrompt } from "./qualityAiAnalysis.service.js";

describe("qualityAiAnalysis", () => {
    describe("buildQualityPrompt", () => {
        test("generates prompt with coverage and complexity metrics", () => {
            const prompt = buildQualityPrompt({
                coverageSummary: { linesPct: 85, branchesPct: 70, funcsPct: 90, stmtsPct: 82 },
                cyclomatics: [{ value: 12, functionName: "heavyFn", filePath: "server.js" }],
                coverageFunctions: [{ functionName: "uncoveredFn", filePath: "server.js", hit: 0 }],
                structureResult: { graph: { externalDependencies: [{ name: "express", isDev: false }] } },
                sourceFiles: [{ path: "server.js", content: "const express = require('express');" }],
            });

            expect(prompt).toContain("85%");
            expect(prompt).toContain("heavyFn");
            expect(prompt).toContain("uncoveredFn");
            expect(prompt).toContain("express");
            expect(prompt).toContain("Required JSON Response Format");
        });
    });

    describe("parseQualityAiResponse", () => {
        test("parses structured JSON with security and debug report", () => {
            const jsonText = JSON.stringify({
                securityScore: 88,
                securityFindings: [
                    {
                        severity: "Warning",
                        title: "Potential ReDoS",
                        description: "Complex regex pattern",
                        filePath: "src/utils.js",
                        line: 42,
                    },
                ],
                debugEntries: [
                    {
                        severity: "Critical",
                        functionName: "processData",
                        filePath: "src/data.js",
                        reason: "High CC without tests",
                        cc: 15,
                        coveragePct: 0,
                    },
                ],
                recommendations: [
                    {
                        title: "Refactor processData",
                        description: "Break into smaller sub-functions",
                        impact: "high",
                        relatedFiles: ["src/data.js"],
                    },
                ],
            });

            const parsed = parseQualityAiResponse(jsonText);

            expect(parsed.securityScore).toBe(88);
            expect(parsed.securityDetails.findings).toHaveLength(1);
            expect(parsed.securityDetails.warningCount).toBe(1);
            expect(parsed.debugReport.entries).toHaveLength(1);
            expect(parsed.debugReport.criticalCount).toBe(1);
            expect(parsed.recommendations).toHaveLength(1);
            expect(parsed.recommendations[0].impact).toBe("high");
        });

        test("gracefully handles corrupted or missing fields in AI response", () => {
            const parsed = parseQualityAiResponse("{}");

            expect(parsed.securityScore).toBe(50);
            expect(parsed.securityDetails.findings).toEqual([]);
            expect(parsed.debugReport.entries).toEqual([]);
            expect(parsed.recommendations).toEqual([]);
        });
    });
});
