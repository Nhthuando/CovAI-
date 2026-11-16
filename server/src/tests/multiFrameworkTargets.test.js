import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { resolveMultiFrameworkTargets } from "../services/unitTestSuggestion.service.js";

const suggestions = [
    { framework: "jest", targetTestFile: "tests/basic.test.js" },
    { framework: "vitest", targetTestFile: "tests/basic.test.js" }
];

test("keeps the CommonJS Jest target and separates the Vitest target", () => {
    const result = resolveMultiFrameworkTargets(suggestions, "src/risk.js", {
        "tests/basic.test.js": "const risk = require('../src/risk');"
    });
    assert.deepEqual(result.map(s => s.targetTestFile), ["tests/basic.test.js", "tests/risk.vitest.test.js"]);
    assert.equal(suggestions[1].targetTestFile, "tests/basic.test.js");
});

test("leaves a single framework unchanged", () => {
    const single = [suggestions[1]];
    assert.equal(resolveMultiFrameworkTargets(single, "src/risk.js"), single);
});

test("recognizes Vitest imports before CommonJS source imports", () => {
    const result = resolveMultiFrameworkTargets(suggestions, "src/risk.js", {
        "tests/basic.test.js": "import { vi } from 'vitest'; const risk = require('../src/risk');"
    });
    assert.deepEqual(result.map(s => s.targetTestFile), ["tests/risk.jest.test.js", "tests/basic.test.js"]);
});

test("uses the primary framework for ambiguous content", () => {
    const result = resolveMultiFrameworkTargets(suggestions, "src/risk.js", {}, "vitest");
    assert.equal(result[1].targetTestFile, "tests/basic.test.js");
    assert.equal(result[0].targetTestFile, "tests/risk.jest.test.js");
});

test("materializes a Vitest include pattern", () => {
    const result = resolveMultiFrameworkTargets(suggestions, "src/risk.js", {}, "jest", ["tests/vitest/**/*.spec.{js,ts}"]);
    assert.equal(result[1].targetTestFile, "tests/vitest/risk.vitest.spec.js");
});
