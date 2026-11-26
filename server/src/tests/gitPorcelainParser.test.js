import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectRepoOperationState,
  parseGitLogRecords,
  parsePorcelainV2Z,
  parseUnifiedDiffHunks,
} from "../services/gitPorcelainParser.service.js";
import { applyHunkAction, buildSingleHunkPatch } from "../services/gitHunkPatch.service.js";
import { execGit } from "../services/gitCredentialHelper.service.js";
import { GIT_REPO_OPERATION_STATE } from "../../../shared/gitProtocol.js";

describe("gitPorcelainParser & gitHunkPatch", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-git-parse-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("parses NUL-delimited porcelain=v2 including spaces, Unicode, renames, conflicts, detached, unborn", () => {
    const tokens = [
      "# branch.oid 0123456789abcdef0123456789abcdef01234567",
      "# branch.head feat/vcs-ui",
      "# branch.upstream origin/feat/vcs-ui",
      "# branch.ab +2 -1",
      "1 .M N... 100644 100644 100644 111 111 src/file with spaces.js",
      "1 A. N... 000000 100644 100644 000 222 docs/tệp mới.md",
      "2 R. N... 100644 100644 100644 333 333 R100 src/newName.js",
      "src/oldName.js",
      "u UU N... 100644 100644 100644 100644 444 555 666 src/conflicted.js",
      "? temp/untracked note.txt",
      "",
    ];

    const parsed = parsePorcelainV2Z(tokens.join("\0"));
    expect(parsed.branch).toBe("feat/vcs-ui");
    expect(parsed.headOid).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(parsed.tracking).toBe("origin/feat/vcs-ui");
    expect(parsed.ahead).toBe(2);
    expect(parsed.behind).toBe(1);
    expect(parsed.detached).toBe(false);
    expect(parsed.clean).toBe(false);

    expect(parsed.unstaged).toEqual([
      { path: "src/file with spaces.js", status: "M", statusText: "Modified" },
    ]);
    expect(parsed.staged).toEqual([
      { path: "docs/tệp mới.md", status: "A", statusText: "Added" },
      {
        path: "src/newName.js",
        origPath: "src/oldName.js",
        status: "R",
        statusText: "Renamed",
      },
    ]);
    expect(parsed.conflicts).toEqual([
      {
        path: "src/conflicted.js",
        xy: "UU",
        status: "!",
        statusText: "Both Modified",
      },
    ]);
    expect(parsed.untracked).toEqual([
      { path: "temp/untracked note.txt", status: "U", statusText: "Untracked" },
    ]);

    const unborn = parsePorcelainV2Z(
      ["# branch.oid (initial)", "# branch.head main", "? init.js", ""].join("\0"),
    );
    expect(unborn.isUnborn).toBe(true);
    expect(unborn.branch).toBe("main");

    const detached = parsePorcelainV2Z(
      ["# branch.oid abcdef123456", "# branch.head (detached)", ""].join("\0"),
    );
    expect(detached.detached).toBe(true);
    expect(detached.branch).toBe("abcdef1");
  });

  it("parses commit logs safely even with pipes and multiline bodies", () => {
    const raw =
      "\x1eaaa111\x1faaa1\x1fp1 p2\x1fAlice\x1falice@dev.io\x1f2026-11-26T10:00:00Z\x1f2 minutes ago\x1fHEAD -> main, origin/main\x1ffeat: add a | b\x1fline 1\nline 2";
    const parsed = parseGitLogRecords(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      hash: "aaa111",
      shortHash: "aaa1",
      parents: ["p1", "p2"],
      author: "Alice",
      email: "alice@dev.io",
      refs: ["HEAD -> main", "origin/main"],
      subject: "feat: add a | b",
      body: "line 1\nline 2",
    });
  });

  it("detects repo operation state from .git markers", () => {
    fs.mkdirSync(path.join(tempDir, ".git"), { recursive: true });
    expect(detectRepoOperationState(tempDir)).toBe(GIT_REPO_OPERATION_STATE.IDLE);
    fs.writeFileSync(path.join(tempDir, ".git", "MERGE_HEAD"), "abc\n");
    expect(detectRepoOperationState(tempDir)).toBe(GIT_REPO_OPERATION_STATE.MERGING);
  });

  it("parses hunks and stages/unstages/reverts single hunks cleanly on a real Git repo", async () => {
    await execGit(tempDir, ["init", "-b", "main"]);
    const initialLines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const filePath = path.join(tempDir, "multi.js");
    fs.writeFileSync(filePath, initialLines.join("\n") + "\n", "utf8");
    await execGit(tempDir, ["add", "multi.js"]);
    await execGit(tempDir, ["commit", "-m", "initial"], {
      author: { name: "Dev", email: "dev@covai.test" },
    });

    const modifiedLines = [...initialLines];
    modifiedLines[2] = "line 3 UPDATED";
    modifiedLines[25] = "line 26 UPDATED";
    fs.writeFileSync(filePath, modifiedLines.join("\n") + "\n", "utf8");

    const { stdout: rawDiff } = await execGit(
      tempDir,
      ["diff", "--no-color", "-U3", "--", "multi.js"],
      { rawOutput: true },
    );
    const parsed = parseUnifiedDiffHunks(rawDiff);
    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.insertions).toBe(2);
    expect(parsed.deletions).toBe(2);
    expect(() => buildSingleHunkPatch(rawDiff, 9)).toThrow();

    // Stage only hunk 0
    await applyHunkAction(tempDir, {
      filePath: "multi.js",
      hunkIndex: 0,
      action: "stage",
    });
    const { stdout: stagedDiff } = await execGit(tempDir, ["diff", "--cached"]);
    expect(stagedDiff).toContain("line 3 UPDATED");
    expect(stagedDiff).not.toContain("line 26 UPDATED");

    // Unstage hunk 0 back
    await applyHunkAction(tempDir, {
      filePath: "multi.js",
      hunkIndex: 0,
      action: "unstage",
    });
    const { stdout: cachedAfterUnstage } = await execGit(tempDir, ["diff", "--cached"]);
    expect(cachedAfterUnstage).toBe("");

    // Revert hunk 1 in working tree
    await applyHunkAction(tempDir, {
      filePath: "multi.js",
      hunkIndex: 1,
      action: "revert",
    });
    const diskText = fs.readFileSync(filePath, "utf8");
    expect(diskText).toContain("line 3 UPDATED");
    expect(diskText).not.toContain("line 26 UPDATED");
  });
});
