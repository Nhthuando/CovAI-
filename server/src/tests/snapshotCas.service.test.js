import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { jest } from "@jest/globals";
import { createAuthTestDatabase } from "./helpers/authTestDatabase.js";

const testDb = await createAuthTestDatabase();

jest.unstable_mockModule("../config/prisma.js", () => ({
  default: testDb.db,
}));

let validateSafeId;
let validateSha256;
let sanitizeVcsRelativePath;
let getBlobDiskPath;
let writeCasBlob;
let readCasBlob;
let scanWorkingTree;
let computeManifestHash;
let syncWorkspaceFromManifest;
let runSnapshotCasGc;
let diffManifests;
let buildDiffPairResult;
let findLowestCommonAncestor;
let threeWayMergeText;
let projectStorageTargets;

try {
  ({
    validateSafeId,
    validateSha256,
    sanitizeVcsRelativePath,
    getBlobDiskPath,
    writeCasBlob,
    readCasBlob,
    scanWorkingTree,
    computeManifestHash,
    syncWorkspaceFromManifest,
    runSnapshotCasGc,
  } = await import("../services/snapshotCas.service.js"));

  ({
    diffManifests,
    buildDiffPairResult,
    findLowestCommonAncestor,
    threeWayMergeText,
  } = await import("../services/snapshotDiff3.service.js"));

  ({ projectStorageTargets } = await import(
    "../services/projectStorageCleanup.service.js"
  ));
} catch (error) {
  await testDb.close().catch(() => {});
  throw error;
}

describe("Snapshot CAS Storage, Diff, 3-Way Merge & GC Unit Tests", () => {
  let tempRoot;

  beforeEach(async () => {
    await testDb.resetAuthTables();
    tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "covai-cas-unit-"));
  });

  afterEach(async () => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      await fsp.rm(tempRoot, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("writes deduplicated atomic gzipped CAS blobs, reads them back, and rejects invalid/missing paths", () => {
    const baseDir = path.join(tempRoot, "store");
    const projectId = "proj_cas_1";
    const textBuf = Buffer.from("export const add = (a, b) => a + b;\n", "utf8");

    const firstWrite = writeCasBlob(projectId, textBuf, baseDir);
    expect(firstWrite.created).toBe(true);
    expect(firstWrite.compressed).toBe(true);
    expect(firstWrite.isBinary).toBe(false);
    expect(firstWrite.byteSize).toBe(textBuf.length);
    expect(firstWrite.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.existsSync(getBlobDiskPath(projectId, firstWrite.sha256, baseDir))).toBe(true);
    expect(firstWrite.path.endsWith(`${firstWrite.sha256}.gz`)).toBe(true);

    const secondWrite = writeCasBlob(projectId, textBuf, baseDir);
    expect(secondWrite.created).toBe(false);
    expect(secondWrite.sha256).toBe(firstWrite.sha256);

    const restored = readCasBlob(projectId, firstWrite.sha256, baseDir);
    expect(restored.equals(textBuf)).toBe(true);

    const binBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
    const binWrite = writeCasBlob(projectId, binBuf, baseDir);
    expect(binWrite.isBinary).toBe(true);
    expect(readCasBlob(projectId, binWrite.sha256, baseDir).equals(binBuf)).toBe(true);

    expect(() => readCasBlob(projectId, "a".repeat(64), baseDir)).toThrow(/missing/i);
    expect(() => validateSafeId("../bad", "projectId")).toThrow();
    expect(() => validateSha256("not-a-sha")).toThrow();

    expect(sanitizeVcsRelativePath(".\\src\\utils\\math.js")).toBe("src/utils/math.js");
    expect(() => sanitizeVcsRelativePath("../secret.txt")).toThrow();
    expect(() => sanitizeVcsRelativePath("C:\\Windows\\system32")).toThrow();
    expect(() => sanitizeVcsRelativePath("src/CON.js")).toThrow();
    expect(() => sanitizeVcsRelativePath(".git/config")).toThrow();
  });

  it("scans working trees excluding node_modules, coverage, artifacts, .git, secrets, and symlinks", async () => {
    const ws = path.join(tempRoot, "workspace");
    await fsp.mkdir(path.join(ws, "src"), { recursive: true });
    await fsp.mkdir(path.join(ws, "node_modules", "pkg"), { recursive: true });
    await fsp.mkdir(path.join(ws, ".git"), { recursive: true });
    await fsp.mkdir(path.join(ws, "coverage"), { recursive: true });
    await fsp.mkdir(path.join(ws, "test-results"), { recursive: true });
    await fsp.mkdir(path.join(ws, "playwright-report"), { recursive: true });
    await fsp.mkdir(path.join(ws, ".covai-temp"), { recursive: true });
    await fsp.mkdir(path.join(ws, "dist"), { recursive: true });

    await fsp.writeFile(path.join(ws, "src", "index.js"), "console.log('ok');\n");
    await fsp.writeFile(path.join(ws, "package.json"), '{"name":"demo"}\n');
    await fsp.writeFile(path.join(ws, ".env"), "SECRET=123\n");
    await fsp.writeFile(path.join(ws, "node_modules", "pkg", "index.js"), "ignored");
    await fsp.writeFile(path.join(ws, ".git", "HEAD"), "ref: refs/heads/main\n");
    await fsp.writeFile(path.join(ws, "coverage", "lcov.info"), "ignored");
    await fsp.writeFile(path.join(ws, "test-results", "junit.xml"), "ignored");
    await fsp.writeFile(path.join(ws, "playwright-report", "index.html"), "ignored");
    await fsp.writeFile(path.join(ws, ".covai-temp", "tmp.txt"), "ignored");
    await fsp.writeFile(path.join(ws, "dist", "bundle.js"), "ignored");

    try {
      await fsp.symlink(path.join(ws, "package.json"), path.join(ws, "src", "link.json"));
    } catch {
      // Symlinks may require elevated privileges on some Windows setups
    }

    const scanned = scanWorkingTree(ws);
    expect([...scanned.keys()].sort()).toEqual(["package.json", "src/index.js"]);

    const hash1 = computeManifestHash(scanned);
    const hash2 = computeManifestHash(
      [...scanned.entries()].map(([relativePath, v]) => ({
        relativePath,
        blobSha256: v.sha256,
      })),
    );
    expect(hash1).toBe(hash2);
  });

  it("syncs workspace from manifest while strictly preserving node_modules, coverage, and .env", async () => {
    const baseDir = path.join(tempRoot, "cas-sync");
    const ws = path.join(tempRoot, "live-ws");
    const projectId = "proj_sync_1";

    await fsp.mkdir(path.join(ws, "src"), { recursive: true });
    await fsp.mkdir(path.join(ws, "node_modules", "pkg"), { recursive: true });
    await fsp.mkdir(path.join(ws, "coverage"), { recursive: true });

    await fsp.writeFile(path.join(ws, "src", "app.js"), "v2");
    await fsp.writeFile(path.join(ws, "src", "obsolete.js"), "delete-me");
    await fsp.writeFile(path.join(ws, "node_modules", "pkg", "index.js"), "keep-dep");
    await fsp.writeFile(path.join(ws, "coverage", "lcov.info"), "keep-cov");
    await fsp.writeFile(path.join(ws, ".env"), "API_KEY=keep\n");

    const v1Blob = writeCasBlob(projectId, Buffer.from("v1-clean", "utf8"), baseDir);
    const newFileBlob = writeCasBlob(projectId, Buffer.from("new-file", "utf8"), baseDir);

    const syncRes = syncWorkspaceFromManifest({
      projectId,
      rootDir: ws,
      baseDir,
      targetEntries: [
        { relativePath: "src/app.js", blobSha256: v1Blob.sha256, isBinary: false },
        { relativePath: "src/added.js", blobSha256: newFileBlob.sha256, isBinary: false },
      ],
    });

    expect(syncRes.writtenCount).toBe(2);
    expect(syncRes.deletedCount).toBe(1);
    expect(await fsp.readFile(path.join(ws, "src", "app.js"), "utf8")).toBe("v1-clean");
    expect(await fsp.readFile(path.join(ws, "src", "added.js"), "utf8")).toBe("new-file");
    expect(fs.existsSync(path.join(ws, "src", "obsolete.js"))).toBe(false);

    // Ignored directories & secrets remain completely untouched
    expect(await fsp.readFile(path.join(ws, "node_modules", "pkg", "index.js"), "utf8")).toBe("keep-dep");
    expect(await fsp.readFile(path.join(ws, "coverage", "lcov.info"), "utf8")).toBe("keep-cov");
    expect(await fsp.readFile(path.join(ws, ".env"), "utf8")).toBe("API_KEY=keep\n");
  });

  it("detects Added, Modified, Deleted, Unchanged, and SHA-256 Renamed entries and guards large/binary diffs", () => {
    const base = new Map([
      ["a.js", { sha256: "1".repeat(64), byteSize: 10, isBinary: false }],
      ["old-name.js", { sha256: "2".repeat(64), byteSize: 20, isBinary: false }],
      ["gone.js", { sha256: "3".repeat(64), byteSize: 30, isBinary: false }],
      ["same.js", { sha256: "4".repeat(64), byteSize: 40, isBinary: false }],
    ]);
    const target = new Map([
      ["a.js", { sha256: "9".repeat(64), byteSize: 15, isBinary: false }],
      ["new-name.js", { sha256: "2".repeat(64), byteSize: 20, isBinary: false }],
      ["added.js", { sha256: "5".repeat(64), byteSize: 50, isBinary: false }],
      ["same.js", { sha256: "4".repeat(64), byteSize: 40, isBinary: false }],
    ]);

    const diff = diffManifests(base, target);
    expect(diff.stats).toEqual({
      added: 1,
      modified: 1,
      deleted: 1,
      renamed: 1,
      unchanged: 1,
    });
    expect(diff.unchangedPaths).toEqual(["same.js"]);
    expect(diff.changes.find((c) => c.path === "new-name.js")).toMatchObject({
      status: "R",
      origPath: "old-name.js",
    });

    const textPair = buildDiffPairResult({
      filePath: "a.js",
      originalBuf: Buffer.from("const x = 1;\n", "utf8"),
      modifiedBuf: Buffer.from("const x = 2;\n", "utf8"),
      originalLabel: "v1",
      modifiedLabel: "Working Tree",
    });
    expect(textPair.language).toBe("javascript");
    expect(textPair.isBinary).toBe(false);
    expect(textPair.isTooLarge).toBe(false);
    expect(textPair.stats).toEqual({ insertions: 1, deletions: 1 });
    expect(textPair.hunks.length).toBeGreaterThan(0);

    const largePair = buildDiffPairResult({
      filePath: "big.txt",
      originalBuf: Buffer.alloc(10),
      modifiedBuf: Buffer.alloc(1024 * 1024 + 50, "a"),
    });
    expect(largePair.isTooLarge).toBe(true);
    expect(largePair.modifiedContent).toBe("");
  });

  it("finds LCA and executes 3-way text merge (auto-merge + conflict markers)", () => {
    const map = new Map([
      ["s1", { id: "s1", parentSnapshotId: null }],
      ["s2", { id: "s2", parentSnapshotId: "s1" }],
      ["s3", { id: "s3", parentSnapshotId: "s2" }],
      ["s4", { id: "s4", parentSnapshotId: "s2" }],
    ]);
    expect(findLowestCommonAncestor(map, "s3", "s4")).toBe("s2");

    const baseText = ["line1", "line2", "line3", "line4", "line5"].join("\n");
    const oursNonOverlap = ["line1-ours", "line2", "line3", "line4", "line5"].join("\n");
    const theirsNonOverlap = ["line1", "line2", "line3", "line4", "line5-theirs"].join("\n");

    const cleanMerge = threeWayMergeText(baseText, oursNonOverlap, theirsNonOverlap);
    expect(cleanMerge.conflicted).toBe(false);
    expect(cleanMerge.mergedText).toBe(
      ["line1-ours", "line2", "line3", "line4", "line5-theirs"].join("\n"),
    );

    const identicalMerge = threeWayMergeText(baseText, oursNonOverlap, oursNonOverlap);
    expect(identicalMerge).toEqual({ conflicted: false, mergedText: oursNonOverlap });

    const theirsConflict = ["line1-theirs", "line2", "line3", "line4", "line5"].join("\n");
    const conflictMerge = threeWayMergeText(baseText, oursNonOverlap, theirsConflict, {
      oursLabel: "main",
      theirsLabel: "feat",
    });
    expect(conflictMerge.conflicted).toBe(true);
    expect(conflictMerge.mergedText).toContain("<<<<<<< main");
    expect(conflictMerge.mergedText).toContain("=======");
    expect(conflictMerge.mergedText).toContain(">>>>>>> feat");
  });

  it("includes CAS object storage under projectStorageTargets cleanup plan", () => {
    const targets = projectStorageTargets("proj_cleanup_1", [{ id: "snap_1" }], tempRoot);
    expect(targets).toContain(path.resolve(tempRoot, "storage", "projects", "proj_cleanup_1"));
    expect(targets).toContain(path.resolve(tempRoot, "uploads", "snapshots", "snap_1"));
  });

  it("garbage-collects only expired unreferenced blobs while preserving entry & staged refs", async () => {
    const baseDir = path.join(tempRoot, "gc-base");
    const ws = path.join(tempRoot, "gc-ws");
    await fsp.mkdir(ws, { recursive: true });

    const user = await testDb.db.user.create({
      data: {
        email: "gc-owner@covai.local",
        name: "GC Owner",
        passwordHash: "hash",
        lastAuthProvider: "email",
      },
    });
    const project = await testDb.db.project.create({
      data: { name: "GC Project", ownerId: user.id },
    });
    const snap = await testDb.db.projectSnapshot.create({
      data: {
        projectId: project.id,
        source: "ZIP",
        checksum: "chk_gc_1",
        storagePath: ws,
        rootDir: ws,
        casMaterialized: true,
      },
    });
    await testDb.db.project.update({
      where: { id: project.id },
      data: { activeSnapshotId: snap.id },
    });

    const referencedBlob = writeCasBlob(project.id, Buffer.from("referenced", "utf8"), baseDir);
    const stagedText = "staged-only-content";
    const stagedBlob = writeCasBlob(project.id, Buffer.from(stagedText, "utf8"), baseDir);
    await fsp.writeFile(path.join(ws, "staged.js"), stagedText, "utf8");
    const expiredOrphanBlob = writeCasBlob(project.id, Buffer.from("old-orphan", "utf8"), baseDir);
    const recentOrphanBlob = writeCasBlob(project.id, Buffer.from("fresh-orphan", "utf8"), baseDir);

    await testDb.db.snapshotVcsEntry.create({
      data: {
        snapshotId: snap.id,
        relativePath: "kept.js",
        blobSha256: referencedBlob.sha256,
        byteSize: referencedBlob.byteSize,
        isBinary: false,
      },
    });
    await testDb.db.snapshotVcsStaging.create({
      data: {
        projectId: project.id,
        userId: user.id,
        relativePath: "staged.js",
      },
    });

    const oldDate = new Date(Date.now() - 60 * 60 * 1000);
    await testDb.db.snapshotVcsBlobRef.createMany({
      data: [
        { projectId: project.id, sha256: referencedBlob.sha256, byteSize: referencedBlob.byteSize, createdAt: oldDate },
        { projectId: project.id, sha256: stagedBlob.sha256, byteSize: stagedBlob.byteSize, createdAt: oldDate },
        { projectId: project.id, sha256: expiredOrphanBlob.sha256, byteSize: expiredOrphanBlob.byteSize, createdAt: oldDate },
        { projectId: project.id, sha256: recentOrphanBlob.sha256, byteSize: recentOrphanBlob.byteSize, createdAt: new Date() },
      ],
    });

    const gcRes = await runSnapshotCasGc(project.id, {
      graceWindowMs: 10 * 60 * 1000,
      db: testDb.db,
      baseDir,
    });

    expect(gcRes.deletedCount).toBe(1);
    expect(gcRes.freedBytes).toBeGreaterThan(0);

    expect(fs.existsSync(getBlobDiskPath(project.id, referencedBlob.sha256, baseDir))).toBe(true);
    expect(fs.existsSync(getBlobDiskPath(project.id, stagedBlob.sha256, baseDir))).toBe(true);
    expect(fs.existsSync(getBlobDiskPath(project.id, recentOrphanBlob.sha256, baseDir))).toBe(true);
    expect(fs.existsSync(getBlobDiskPath(project.id, expiredOrphanBlob.sha256, baseDir))).toBe(false);
  });
});
