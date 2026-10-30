import {
  extractMissingDependency,
  isValidNpmPackageName,
  findTargetPackageDir,
  inspectWorkspaceDependency,
  ensureWorkspaceNodeModulesLinked,
  cleanupWorkspaceNodeModulesLinks,
  NODE_BUILTINS,
} from "../services/dependencyResolution.service.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("dependencyResolution.service", () => {
  describe("isValidNpmPackageName", () => {
    test("accepts valid standard npm package names", () => {
      expect(isValidNpmPackageName("mathjs")).toBe(true);
      expect(isValidNpmPackageName("lodash")).toBe(true);
      expect(isValidNpmPackageName("axios")).toBe(true);
      expect(isValidNpmPackageName("express-validator")).toBe(true);
      expect(isValidNpmPackageName("uuid")).toBe(true);
    });

    test("accepts valid scoped package names", () => {
      expect(isValidNpmPackageName("@prisma/client")).toBe(true);
      expect(isValidNpmPackageName("@types/jest")).toBe(true);
      expect(isValidNpmPackageName("@nestjs/common")).toBe(true);
      expect(isValidNpmPackageName("@tanstack/react-query")).toBe(true);
    });

    test("rejects command injection attempts or illegal characters", () => {
      expect(isValidNpmPackageName("mathjs; rm -rf /")).toBe(false);
      expect(isValidNpmPackageName("mathjs && touch pwned")).toBe(false);
      expect(isValidNpmPackageName("mathjs | cat /etc/passwd")).toBe(false);
      expect(isValidNpmPackageName("mathjs`id`")).toBe(false);
      expect(isValidNpmPackageName("mathjs$(id)")).toBe(false);
      expect(isValidNpmPackageName("")).toBe(false);
      expect(isValidNpmPackageName(null)).toBe(false);
      expect(isValidNpmPackageName(undefined)).toBe(false);
      expect(isValidNpmPackageName("   ")).toBe(false);
    });
  });

  describe("extractMissingDependency", () => {
    test("extracts missing package from Node.js ESM error output (Cannot find package)", () => {
      const output = "Test Runner Error: Cannot find package 'mathjs' imported from '/app/.covai-temp/collaboration-operations/cmvtuw9880000fap9z44r3j6r/backend/src/utils/evaluator.ts'";
      const res = extractMissingDependency(output);
      expect(res).not.toBeNull();
      expect(res.packageName).toBe("mathjs");
      expect(res.rawSpecifier).toBe("mathjs");
      expect(res.importedFrom).toBe("/app/.covai-temp/collaboration-operations/cmvtuw9880000fap9z44r3j6r/backend/src/utils/evaluator.ts");
    });

    test("extracts missing package from Node.js ERR_MODULE_NOT_FOUND error", () => {
      const output = "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'lodash' imported from '/app/src/index.js'";
      const res = extractMissingDependency(output);
      expect(res).not.toBeNull();
      expect(res.packageName).toBe("lodash");
      expect(res.importedFrom).toBe("/app/src/index.js");
    });

    test("extracts missing module from Jest error output", () => {
      const output = `
Test Runner Error: ● Test suite failed to run
    Cannot find module 'mathjs' from 'src/utils/evaluator.ts'
    Require stack:
      src/utils/evaluator.ts
      src/controllers/calculation.controller.ts
      tests/controllers/calculation.controller.test.ts
    > 1 | import { create, all } from 'mathjs';
        | ^
      at Resolver._throwModNotFoundError (../../../../node_modules/jest-resolve/build/resolver.js:427:11)
      `;
      const res = extractMissingDependency(output);
      expect(res).not.toBeNull();
      expect(res.packageName).toBe("mathjs");
      expect(res.rawSpecifier).toBe("mathjs");
      expect(res.importedFrom).toBe("src/utils/evaluator.ts");
    });

    test("extracts missing scoped module from Vitest error output", () => {
      const output = `
[vite] Failed to resolve import "@prisma/client" from "server/controllers/cartController.js". Does the file exist?
      `;
      const res = extractMissingDependency(output);
      expect(res).not.toBeNull();
      expect(res.packageName).toBe("@prisma/client");
      expect(res.importedFrom).toBe("server/controllers/cartController.js");
    });

    test("extracts missing subpath module and normalizes to root package", () => {
      const output = `
Cannot find module 'lodash/debounce' from 'client/src/App.jsx'
      `;
      const res = extractMissingDependency(output);
      expect(res).not.toBeNull();
      expect(res.packageName).toBe("lodash");
      expect(res.rawSpecifier).toBe("lodash/debounce");
    });

    test("ignores relative file paths (not external npm packages)", () => {
      const output = `
Cannot find module './evaluator' from 'src/controllers/calculation.controller.ts'
      `;
      expect(extractMissingDependency(output)).toBeNull();

      const output2 = `
Cannot find module '../../services/productService.js' from 'server/controllers/productControllers.js'
      `;
      expect(extractMissingDependency(output2)).toBeNull();
    });

    test("ignores Node.js built-in modules", () => {
      const output = `
Cannot find module 'fs' from 'src/config.js'
      `;
      expect(extractMissingDependency(output)).toBeNull();

      const output2 = `
Cannot find module 'path' from 'src/index.js'
      `;
      expect(extractMissingDependency(output2)).toBeNull();
    });

    test("returns null when no module error is present", () => {
      const output = "PASS tests/controllers/calculation.controller.test.ts\nAll tests passed!";
      expect(extractMissingDependency(output)).toBeNull();
    });
  });

  describe("inspectWorkspaceDependency & monorepo subpackages", () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-dep-test-"));
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({
          name: "test-proj",
          dependencies: {
            express: "^4.18.2",
          },
        }, null, 2)
      );
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch { }
    });

    test("detects when dependency is not in package.json and not in node_modules", () => {
      const res = inspectWorkspaceDependency({
        rootDir: tmpDir,
        packageName: "mathjs",
        importedFrom: "src/utils/evaluator.ts",
      });
      expect(res.inPackageJson).toBe(false);
      expect(res.inNodeModules).toBe(false);
      expect(res.suggestedCommand).toBe("npm install mathjs");
    });

    test("detects when dependency is in package.json but not yet in node_modules", () => {
      const res = inspectWorkspaceDependency({
        rootDir: tmpDir,
        packageName: "express",
        importedFrom: "src/server.ts",
      });
      expect(res.inPackageJson).toBe(true);
      expect(res.inNodeModules).toBe(false);
    });

    test("recommends --save-dev for test files", () => {
      const res = inspectWorkspaceDependency({
        rootDir: tmpDir,
        packageName: "supertest",
        importedFrom: "tests/integration/api.test.ts",
      });
      expect(res.suggestedCommand).toBe("npm install --save-dev supertest");
    });

    test("resolves monorepo subpackage (e.g. backend/src/utils/evaluator.ts) when root has no dependencies", () => {
      const monoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "covai-mono-test-"));
      try {
        // Root package.json has 0 dependencies (like fullstack-calculator)
        fs.writeFileSync(
          path.join(monoRoot, "package.json"),
          JSON.stringify({ name: "fullstack-calculator", private: true }, null, 2)
        );
        const backendDir = path.join(monoRoot, "backend");
        const srcUtilsDir = path.join(backendDir, "src", "utils");
        fs.mkdirSync(srcUtilsDir, { recursive: true });
        fs.writeFileSync(
          path.join(backendDir, "package.json"),
          JSON.stringify({
            name: "calculator-backend",
            dependencies: { mathjs: "^12.4.3" },
          }, null, 2)
        );
        fs.writeFileSync(path.join(srcUtilsDir, "evaluator.ts"), "import { create, all } from 'mathjs';");

        const targetDir = findTargetPackageDir(monoRoot, "src/utils/evaluator.ts", "mathjs");
        expect(path.resolve(targetDir)).toBe(path.resolve(backendDir));

        // Test with container / temp workspace path
        const containerPath = "/app/.covai-temp/collaboration-operations/cmvtuw9880000fap9z44r3j6r/backend/src/utils/evaluator.ts";
        const targetDirFromContainer = findTargetPackageDir(monoRoot, containerPath, "mathjs");
        expect(path.resolve(targetDirFromContainer)).toBe(path.resolve(backendDir));

        const inspection = inspectWorkspaceDependency({
          rootDir: monoRoot,
          packageName: "mathjs",
          importedFrom: "src/utils/evaluator.ts",
        });
        expect(inspection.inPackageJson).toBe(true);
        expect(path.resolve(inspection.targetDir)).toBe(path.resolve(backendDir));
      } finally {
        fs.rmSync(monoRoot, { recursive: true, force: true });
      }
    });

    test("links and cleans up node_modules across monorepo subpackages into prepared workspace", () => {
      const origRoot = fs.mkdtempSync(path.join(os.tmpdir(), "covai-orig-"));
      const prepRoot = fs.mkdtempSync(path.join(os.tmpdir(), "covai-prep-"));
      try {
        fs.writeFileSync(path.join(origRoot, "package.json"), JSON.stringify({ name: "root" }));
        fs.writeFileSync(path.join(prepRoot, "package.json"), JSON.stringify({ name: "root" }));

        const origBackend = path.join(origRoot, "backend");
        const prepBackend = path.join(prepRoot, "backend");
        fs.mkdirSync(path.join(origBackend, "node_modules", "mathjs"), { recursive: true });
        fs.mkdirSync(prepBackend, { recursive: true });
        fs.writeFileSync(path.join(origBackend, "package.json"), JSON.stringify({ name: "backend" }));
        fs.writeFileSync(path.join(prepBackend, "package.json"), JSON.stringify({ name: "backend" }));

        const links = ensureWorkspaceNodeModulesLinked(origRoot, prepRoot);
        expect(links.length).toBe(1);
        expect(fs.existsSync(path.join(prepBackend, "node_modules", "mathjs"))).toBe(true);

        cleanupWorkspaceNodeModulesLinks(links);
        expect(fs.existsSync(path.join(prepBackend, "node_modules"))).toBe(false);
        // Original node_modules remains untouched
        expect(fs.existsSync(path.join(origBackend, "node_modules", "mathjs"))).toBe(true);
      } finally {
        fs.rmSync(origRoot, { recursive: true, force: true });
        fs.rmSync(prepRoot, { recursive: true, force: true });
      }
    });
  });
});
