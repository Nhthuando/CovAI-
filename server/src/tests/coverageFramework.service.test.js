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
    expect(result.supported.integration).toEqual(["supertest"]);
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

  test("detects unit test support when test files exist in tests/ directory", () => {
    fs.writeFileSync(path.join(rootDir, "package.json"), "{}");
    fs.mkdirSync(path.join(rootDir, "tests", "unit", "controllers"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "tests", "unit", "controllers", "auth.controller.test.js"), "describe('auth', () => {});");

    const result = detectCoverageFrameworks(rootDir);
    expect(result.supported.unit.length).toBeGreaterThan(0);
  });

  test("detects nested package.json in backend subdirectory", () => {
    const backendDir = path.join(rootDir, "backend");
    fs.mkdirSync(backendDir, { recursive: true });
    fs.writeFileSync(path.join(backendDir, "package.json"), JSON.stringify({
      dependencies: { jest: "^29.0.0" }
    }));

    const result = detectCoverageFrameworks(rootDir);
    expect(result.supported.unit).toContain("jest");
  });

  test("defaults unit test coverage to jest when project has 0 tests", () => {
    fs.writeFileSync(path.join(rootDir, "package.json"), JSON.stringify({ name: "my-app" }));
    fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "src", "app.js"), "export const a = 1;");

    const result = detectCoverageFrameworks(rootDir);
    expect(result.supported.unit).toContain("jest");
    expect(selectCoverageFramework(result, "unit")).toBe("jest");
  });

  test("auto-creates minimal package.json if project has source code files", () => {
    fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "src", "calculator.js"), "function add(a, b) { return a + b; }");

    const result = detectCoverageFrameworks(rootDir);
    expect(result.supported.unit).toContain("jest");
    expect(fs.existsSync(path.join(rootDir, "package.json"))).toBe(true);
  });

  test("detects frameworks in monorepo subdirectories when root has no package.json", () => {
    const clientDir = path.join(rootDir, "client");
    const serverDir = path.join(rootDir, "server");
    fs.mkdirSync(clientDir, { recursive: true });
    fs.mkdirSync(serverDir, { recursive: true });

    fs.writeFileSync(path.join(clientDir, "package.json"), JSON.stringify({
      devDependencies: { "@playwright/test": "latest" },
    }));
    fs.writeFileSync(path.join(serverDir, "package.json"), JSON.stringify({
      devDependencies: { supertest: "latest", jest: "latest" },
    }));

    const result = detectCoverageFrameworks(rootDir);
    expect(result.supported.unit).toEqual(["jest"]);
    expect(result.supported.integration).toEqual(["supertest"]);
    expect(result.supported.system).toEqual(["playwright"]);
  });
});
