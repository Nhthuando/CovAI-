import fs from "fs";
import os from "os";
import path from "path";
import { detectCoverageFrameworks, selectCoverageFramework } from "../services/coverageFramework.service.js";

describe("coverage framework detection", () => {
  let rootDir;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-framework-"));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  test("classifies supported frameworks for each coverage type", () => {
    fs.writeFileSync(path.join(rootDir, "package.json"), JSON.stringify({
      devDependencies: { vitest: "latest", "@playwright/test": "latest", supertest: "latest", cypress: "latest" },
    }));

    const result = detectCoverageFrameworks(rootDir);
    expect(result.supported.unit).toEqual(["vitest"]);
    expect(result.supported.integration).toEqual(["playwright", "supertest"]);
    expect(result.supported.system).toEqual(["playwright", "cypress"]);
  });

  test("reports an unsupported uploaded framework", () => {
    fs.writeFileSync(path.join(rootDir, "package.json"), JSON.stringify({ devDependencies: { mocha: "latest" } }));
    const result = detectCoverageFrameworks(rootDir);

    expect(() => selectCoverageFramework(result, "unit")).toThrow(
      "Supported: jest, vitest. Detected: mocha",
    );
  });

  test("also detects a framework from its config file", () => {
    fs.writeFileSync(path.join(rootDir, "package.json"), "{}");
    fs.writeFileSync(path.join(rootDir, "jest.config.js"), "export default {};");
    expect(selectCoverageFramework(detectCoverageFrameworks(rootDir), "unit")).toBe("jest");
  });
});
