import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
await jest.unstable_mockModule("../config/prisma.js", () => ({ default: {} }));
const { GitService, gitCommandArguments } = await import("../services/git.service.js");
beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());
it("keeps spaces, shell metacharacters and escaped quotes inside literal arguments", () => {
    expect(gitCommandArguments('git diff -- "src/a file;echo injected.js"')).toEqual(["diff", "--", "src/a file;echo injected.js"]);
    expect(gitCommandArguments('git commit -m "hello \\"world\\""')).toEqual(["commit", "-m", 'hello "world"']);
    expect(() => gitCommandArguments('cmd /c git status')).toThrow("Only Git");
    expect(() => gitCommandArguments('git diff "unfinished')).toThrow("Unterminated");
});
it("rejects unsupported arbitrary Git commands before repository setup", async () => {
    const setup = jest.spyOn(GitService, "ensureGitRepo");
    await expect(GitService.runGitCommand("project", "config", ["core.sshCommand", "bad"], "owner")).rejects.toMatchObject({ statusCode: 400 });
    await expect(GitService.runGitCommand("project", "diff", ["--ext-diff"], "owner")).rejects.toMatchObject({ statusCode: 400 });
    await expect(GitService.runGitCommand('project', 'branch', ['new-branch'], 'owner')).rejects.toMatchObject({ statusCode: 400 });
    await expect(GitService.runGitCommand('project', 'branch', ['-D', 'old-branch'], 'owner')).rejects.toMatchObject({ statusCode: 400 });
    expect(setup).not.toHaveBeenCalled();
});
it("rejects traversal and option-like branches before changing Git state", async () => {
    const setup = jest.spyOn(GitService, "ensureGitRepo");
    await expect(GitService.discardChanges("project", "owner", "../outside", true)).rejects.toMatchObject({ statusCode: 400 });
    await expect(GitService.checkout("project", "owner", "--orphan=evil")).rejects.toMatchObject({ statusCode: 400 });
    expect(setup).not.toHaveBeenCalled();
});
it("branch/log/diff reads never initialize or reconfigure the repository", async () => {
    jest.spyOn(GitService, "getRepoPath").mockResolvedValue({ rootDir: "test-repo" });
    const setup = jest.spyOn(GitService, "ensureGitRepo");
    const command = jest.spyOn(GitService, "runCommand").mockResolvedValue({ stdout: "", stderr: "" });
    await GitService.getBranches("project", "viewer");
    await GitService.getLog("project", "viewer", 10);
    await GitService.getDiff("project", "viewer", "src/a.js");
    expect(setup).not.toHaveBeenCalled();
    expect(command.mock.calls.every(call => /git (rev-parse|branch -a|log|diff)/.test(call[1]))).toBe(true);
});
