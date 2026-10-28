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
      expect(result.reason).toContain("JavaScript or TypeScript");
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
      expect(result.reason).toContain("JavaScript or TypeScript");
    });

    it("should accept a project that uses JavaScript even if another language has more files", () => {
      const paths = [
        "main.py",
        "api/endpoints.py",
        "services/db.py",
        "static/helper.js", // Uses JavaScript
      ];
      const result = detectLanguageFromPaths(paths);
      expect(result.isSupported).toBe(true);
      expect(result.primaryLanguage).toBe("JavaScript");
    });

    it("should accept an HTML project with JavaScript files", () => {
      const paths = [
        "index.html",
        "about.html",
        "menu.html",
        "contact.html",
        "js/main.js",
        "js/cart.js",
      ];
      const result = detectLanguageFromPaths(paths);
      expect(result.isSupported).toBe(true);
      expect(result.primaryLanguage).toBe("JavaScript");
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
