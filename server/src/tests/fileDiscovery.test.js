import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "@jest/globals";
import { discoverSnapshotSourceFiles, discoverSourceFiles } from "../services/fileDiscovery.service.js";
import { ServiceError } from "../utils/serviceError.js";

const roots = [];
const fixture = (files) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-discovery-"));
  roots.push(rootDir);
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return rootDir;
};

afterEach(() => roots.splice(0).forEach((rootDir) => fs.rmSync(rootDir, { recursive: true, force: true })));

describe("snapshot source discovery", () => {
  it("rejects absent and non-existent roots", () => {
    expect(() => discoverSourceFiles(null)).toThrow(ServiceError);
    expect(() => discoverSourceFiles(path.join(os.tmpdir(), "missing-covai-root"))).toThrow(/Root directory does not exist/);
  });

  it("returns only supported files and ignores generated/vendor folders", () => {
    const rootDir = fixture({
      "src/main.js": "export {};",
      "src/view.tsx": "export default null;",
      "node_modules/pkg/index.js": "ignored",
      "dist/bundle.js": "ignored",
      ".git/config.js": "ignored",
      "notes.txt": "ignored",
    });
    const result = discoverSnapshotSourceFiles(rootDir);
    expect(result.files.map((file) => file.relativePath)).toEqual(["src/main.js", "src/view.tsx"]);
    expect(result.files.every((file) => !path.isAbsolute(file.relativePath))).toBe(true);
  });

  it("supports CommonJS and ESM extension variants", () => {
    const rootDir = fixture({ "a.mjs": "", "b.cjs": "", "c.jsx": "", "d.ts": "" });
    expect(discoverSourceFiles(rootDir).map((file) => path.extname(file)).sort()).toEqual([".cjs", ".jsx", ".mjs", ".ts"]);
  });
});
