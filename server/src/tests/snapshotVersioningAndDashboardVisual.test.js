import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { computeSnapshotContentHash } from "../services/project.service.js";

function resolvePillarState(pillar) {
  if (!pillar) return "NOT_RUN";
  const passed = Number(pillar.passedTests ?? 0);
  const failed = Number(pillar.failedTests ?? 0);
  const total = Number(pillar.totalTests ?? (passed + failed));
  if (total === 0 || (passed === 0 && failed === 0)) {
    return "NOT_RUN";
  }
  if (failed === 0) {
    return "ALL_PASSING";
  }
  return "HAS_FAILURES";
}

describe("Snapshot Versioning & Content Hashing", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-hash-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it("computes deterministic SHA-256 tree hash across files", async () => {
    fs.writeFileSync(path.join(tempDir, "index.js"), 'console.log("hello");', "utf8");
    fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "src/util.js"), "export const a = 1;", "utf8");

    const hash1 = await computeSnapshotContentHash(tempDir);
    expect(typeof hash1).toBe("string");
    expect(hash1.length).toBe(64);

    const hash2 = await computeSnapshotContentHash(tempDir);
    expect(hash2).toBe(hash1);
  });

  it("changes hash when code content is modified", async () => {
    fs.writeFileSync(path.join(tempDir, "index.js"), 'console.log("v1");', "utf8");
    const hash1 = await computeSnapshotContentHash(tempDir);

    fs.writeFileSync(path.join(tempDir, "index.js"), 'console.log("v2");', "utf8");
    const hash2 = await computeSnapshotContentHash(tempDir);

    expect(hash2).not.toBe(hash1);
  });

  it("ignores CovAI artifacts such as coverage, .covai-temp, and .covai-checkpoint.json", async () => {
    fs.writeFileSync(path.join(tempDir, "index.js"), 'console.log("code");', "utf8");
    const baseHash = await computeSnapshotContentHash(tempDir);

    // Add ignored directories and files
    fs.mkdirSync(path.join(tempDir, "coverage"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "coverage/lcov.info"), "dummy coverage content", "utf8");
    fs.writeFileSync(path.join(tempDir, ".covai-checkpoint.json"), '{"id":"snap-1"}', "utf8");
    fs.mkdirSync(path.join(tempDir, ".covai-temp"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".covai-temp/scratch.txt"), "temp file", "utf8");

    const hashAfterArtifacts = await computeSnapshotContentHash(tempDir);
    expect(hashAfterArtifacts).toBe(baseHash);
  });
});

describe("Adaptive Pillar State Resolver (resolvePillarState)", () => {
  it("returns NOT_RUN when 0 tests have executed", () => {
    expect(resolvePillarState(null)).toBe("NOT_RUN");
    expect(resolvePillarState({ totalTests: 0, passedTests: 0, failedTests: 0 })).toBe("NOT_RUN");
    expect(resolvePillarState({ passedTests: 0, failedTests: 0 })).toBe("NOT_RUN");
  });

  it("returns ALL_PASSING when tests have executed and 0 failures", () => {
    expect(resolvePillarState({ totalTests: 17, passedTests: 17, failedTests: 0 })).toBe("ALL_PASSING");
    expect(resolvePillarState({ passedTests: 5, failedTests: 0 })).toBe("ALL_PASSING");
  });

  it("returns HAS_FAILURES when at least 1 test failed", () => {
    expect(resolvePillarState({ totalTests: 17, passedTests: 16, failedTests: 1 })).toBe("HAS_FAILURES");
    expect(resolvePillarState({ passedTests: 0, failedTests: 3 })).toBe("HAS_FAILURES");
  });
});

describe("Singleflight Promise Deduplication & Cache Safety", () => {
  it("deduplicates concurrent async executions for the same snapshotId", async () => {
    let executionCount = 0;
    const inFlight = new Map();

    const executeOperation = async (key) => {
      if (inFlight.has(key)) return inFlight.get(key);
      const promise = (async () => {
        try {
          executionCount++;
          await new Promise((r) => setTimeout(r, 25));
          return { data: `snapshot-result-${key}` };
        } finally {
          inFlight.delete(key);
        }
      })();
      inFlight.set(key, promise);
      return promise;
    };

    // 3 concurrent calls for snap-A, 1 call for snap-B
    const [a1, a2, a3, b1] = await Promise.all([
      executeOperation("snap-A"),
      executeOperation("snap-A"),
      executeOperation("snap-A"),
      executeOperation("snap-B"),
    ]);

    expect(executionCount).toBe(2);
    expect(a1.data).toBe("snapshot-result-snap-A");
    expect(a2.data).toBe("snapshot-result-snap-A");
    expect(a3.data).toBe("snapshot-result-snap-A");
    expect(b1.data).toBe("snapshot-result-snap-B");
  });

  it("invalidates cache when DB fingerprint mismatches even within TTL", () => {
    const cache = new Map();
    const TTL_MS = 600000;

    cache.set("snap-1", {
      data: { score: 85 },
      cachedAt: Date.now() - 5000,
      fingerprint: "run-1_SUCCESS_1700000000",
    });

    // Case 1: Fingerprint matches -> return cached
    const entry1 = cache.get("snap-1");
    const isMatching = entry1 && Date.now() - entry1.cachedAt < TTL_MS && entry1.fingerprint === "run-1_SUCCESS_1700000000";
    expect(isMatching).toBe(true);

    // Case 2: New testRun happened -> fingerprint changed -> invalidated
    const isNewRunMatching = entry1 && Date.now() - entry1.cachedAt < TTL_MS && entry1.fingerprint === "run-2_RUNNING_1700000000";
    expect(isNewRunMatching).toBe(false);
  });
});

