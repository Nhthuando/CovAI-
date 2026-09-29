import {
  detectLanguageFromPaths,
  detectLanguageFromDirectory,
} from "../utils/languageDetector.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("languageDetector", () => {
  describe("detectLanguageFromPaths", () => {
    it("should accept a standard JavaScript project", () => {
      const paths = [
        "package.json",
        "src/index.js",
        "src/utils.js",
        "src/components/App.jsx",
      ];
      const result = detectLanguageFromPaths(paths);
      expect(result.isSupported).toBe(true);
      expect(result.primaryLanguage).toBe("JavaScript");
    });

    it("should accept a TypeScript project", () => {
      const paths = [
        "package.json",
        "tsconfig.json",
        "src/index.ts",
        "src/types.ts",
        "src/App.tsx",
      ];
      const result = detectLanguageFromPaths(paths);
      expect(result.isSupported).toBe(true);
      expect(result.primaryLanguage).toBe("TypeScript");
    });

    it("should reject a pure Python project", () => {
      const paths = [
        "requirements.txt",
        "app.py",
        "models/user.py",
        "views/auth.py",
      ];
      const result = detectLanguageFromPaths(paths);
      expect(result.isSupported).toBe(false);
      expect(result.primaryLanguage).toBe("Python");
      expect(result.reason).toContain(
        "CovAI chỉ hỗ trợ các dự án có ngôn ngữ chính là JavaScript hoặc TypeScript",
      );
    });

    it("should reject a pure Java project", () => {
      const paths = [
        "pom.xml",
        "src/main/java/com/example/App.java",
        "src/main/java/com/example/Controller.java",
      ];
      const result = detectLanguageFromPaths(paths);
      expect(result.isSupported).toBe(false);
      expect(result.primaryLanguage).toBe("Java");
      expect(result.reason).toContain(
        "CovAI chỉ hỗ trợ các dự án có ngôn ngữ chính là JavaScript hoặc TypeScript",
      );
    });

    it("should reject a project where Python dominates without package.json", () => {
      const paths = [
        "main.py",
        "api/endpoints.py",
        "services/db.py",
        "static/helper.js", // 1 incidental script
      ];
      const result = detectLanguageFromPaths(paths);
      expect(result.isSupported).toBe(false);
      expect(result.primaryLanguage).toBe("Python");
    });

    it("should reject empty project with no code files", () => {
      const paths = ["README.md", "LICENSE", "notes.txt"];
      const result = detectLanguageFromPaths(paths);
      expect(result.isSupported).toBe(false);
    });

    it("should ignore files inside node_modules and .git", () => {
      const paths = [
        "node_modules/express/index.js",
        ".git/hooks/pre-commit.sh",
        "app.py",
      ];
      const result = detectLanguageFromPaths(paths);
      expect(result.isSupported).toBe(false);
      expect(result.primaryLanguage).toBe("Python");
    });
  });

  describe("detectLanguageFromDirectory", () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-lang-test-"));
    });

    afterEach(() => {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("should detect JS project from disk directory", () => {
      fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
      fs.writeFileSync(path.join(tmpDir, "index.js"), "console.log('hello');");

      const result = detectLanguageFromDirectory(tmpDir);
      expect(result.isSupported).toBe(true);
      expect(result.primaryLanguage).toBe("JavaScript");
    });

    it("should reject Python project from disk directory", () => {
      fs.writeFileSync(path.join(tmpDir, "main.py"), "print('hello')");
      fs.writeFileSync(path.join(tmpDir, "utils.py"), "def foo(): pass");

      const result = detectLanguageFromDirectory(tmpDir);
      expect(result.isSupported).toBe(false);
      expect(result.primaryLanguage).toBe("Python");
    });
  });
});
