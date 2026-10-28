import { describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { snapshotWorkspaceRoot, resolveSnapshotFile } from "../utils/snapshotWorkspace.js";

describe("Project Import and Workspace Tree Resolution", () => {
  it("resolves full workspace for GITHUB snapshot even after storagePath is overwritten by coverage", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "covai-gh-test-"));
    const repoDir = path.join(tmp, "storage", "projects", "proj1", "github", "123456", "repo");
    fs.mkdirSync(path.join(repoDir, "client"), { recursive: true });
    fs.mkdirSync(path.join(repoDir, "server"), { recursive: true });
    fs.mkdirSync(path.join(repoDir, ".git"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, "client", "App.jsx"), "export default function App() {}");
    fs.writeFileSync(path.join(repoDir, "server", "package.json"), "{}");
    fs.writeFileSync(path.join(repoDir, "README.md"), "# Project Readme");

    // storagePath was overwritten by coverage runner with cloud storage path
    const snapshot = {
      id: "snap-gh-1",
      source: "GITHUB",
      storagePath: "projects/proj1/snapshots/snap-gh-1/coverage",
      rootDir: path.join(repoDir, "server"),
    };

    const workspace = snapshotWorkspaceRoot(snapshot);
    expect(workspace).toBe(repoDir);

    const clientFile = resolveSnapshotFile(snapshot, "client/App.jsx");
    expect(fs.existsSync(clientFile)).toBe(true);

    const readmeFile = resolveSnapshotFile(snapshot, "README.md");
    expect(fs.existsSync(readmeFile)).toBe(true);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("resolves full workspace for ZIP snapshot with wrapper folder (monorepo structure)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "covai-zip-test-"));
    const snapDir = path.join(tmp, "uploads", "snapshots", "snap-zip-1");
    const wrapperDir = path.join(snapDir, "MyProject-main");
    fs.mkdirSync(path.join(wrapperDir, "client", "src"), { recursive: true });
    fs.mkdirSync(path.join(wrapperDir, "server", "src"), { recursive: true });
    fs.mkdirSync(path.join(wrapperDir, "empty-folder"), { recursive: true });
    fs.writeFileSync(path.join(wrapperDir, "client", "package.json"), "{}");
    fs.writeFileSync(path.join(wrapperDir, "server", "package.json"), "{}");
    fs.writeFileSync(path.join(wrapperDir, "docker-compose.yml"), "services:");

    const snapshot = {
      id: "snap-zip-1",
      source: "ZIP",
      storagePath: "projects/proj2/archive-unique.zip",
      rootDir: path.join(wrapperDir, "server"),
    };

    const workspace = snapshotWorkspaceRoot(snapshot);
    expect(workspace).toBe(wrapperDir);

    const clientPkg = resolveSnapshotFile(snapshot, "client/package.json");
    expect(fs.existsSync(clientPkg)).toBe(true);

    const composeFile = resolveSnapshotFile(snapshot, "docker-compose.yml");
    expect(fs.existsSync(composeFile)).toBe(true);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("resolves workspace for direct ZIP extraction (no wrapper folder)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "covai-zip-direct-"));
    const snapDir = path.join(tmp, "uploads", "snapshots", "snap-zip-2");
    fs.mkdirSync(path.join(snapDir, "client"), { recursive: true });
    fs.mkdirSync(path.join(snapDir, "server"), { recursive: true });
    fs.writeFileSync(path.join(snapDir, "README.md"), "# Direct Zip");

    const snapshot = {
      id: "snap-zip-2",
      source: "ZIP",
      storagePath: "projects/proj3/direct.zip",
      rootDir: path.join(snapDir, "server"),
    };

    const workspace = snapshotWorkspaceRoot(snapshot);
    expect(workspace).toBe(snapDir);

    const readme = resolveSnapshotFile(snapshot, "README.md");
    expect(fs.existsSync(readme)).toBe(true);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

