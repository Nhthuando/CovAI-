import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "@jest/globals";
import { analyzeFrameworkRecommendation } from "../services/frameworkRecommendationAnalyzer.service.js";

const roots = [];
const fixture = (files) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "covai-framework-recommendation-"));
    roots.push(root);
    for (const [relative, content] of Object.entries(files)) {
        const target = path.join(root, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
    return root;
};

afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe("frameworkRecommendationAnalyzer", () => {
    it("recommends Vitest for a Vite React frontend", () => {
        const result = analyzeFrameworkRecommendation(fixture({
            "package.json": JSON.stringify({ dependencies: { react: "^19", vite: "^6" } }),
            "src/main.jsx": "import React from 'react'; import { defineConfig } from 'vite';",
        }));
        expect(result).toMatchObject({ projectType: "frontend", recommendedFramework: "vitest" });
        expect(result.candidates.find((item) => item.framework === "vitest").score)
            .toBeGreaterThan(result.candidates.find((item) => item.framework === "jest").score);
    });

    it("keeps existing Jest evidence ahead of generic Vite preferences", () => {
        const result = analyzeFrameworkRecommendation(fixture({
            "package.json": JSON.stringify({
                dependencies: { react: "^19", vite: "^6" },
                devDependencies: { jest: "^29" },
                scripts: { test: "jest" },
            }),
            "jest.config.js": "export default {};",
            "src/auth.test.js": "import { jest } from '@jest/globals'; test('x', () => {});",
        }));
        expect(result.recommendedFramework).toBe("jest");
        expect(result.explanation.join(" ")).toContain("Existing");
    });

    it("classifies projects with frontend and backend evidence as fullstack", () => {
        const result = analyzeFrameworkRecommendation(fixture({
            "package.json": JSON.stringify({ dependencies: { react: "^19", express: "^5" } }),
            "client/App.jsx": "import React from 'react';",
            "server/app.js": "import express from 'express';",
        }));
        expect(result.projectType).toBe("fullstack");
    });

    it("returns diagnostics rather than throwing for malformed package metadata", () => {
        const result = analyzeFrameworkRecommendation(fixture({ "package.json": "{" }));
        expect(result.diagnostics).toContain("Unable to parse package.json");
        expect(result.recommendedFramework).toBe("jest");
    });

    it("limits source scanning to the documented file and byte bounds", () => {
        const files = { "package.json": "{}" };
        for (let index = 0; index < 250; index += 1) files[`src/file-${index}.js`] = "export const value = 1;";
        const result = analyzeFrameworkRecommendation(fixture(files));
        expect(result.scan.filesScanned).toBeLessThanOrEqual(200);
        expect(result.scan.bytesScanned).toBeLessThanOrEqual(1024 * 1024);
    });
});
