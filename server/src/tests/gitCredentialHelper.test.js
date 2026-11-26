import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jest } from "@jest/globals";
import { encrypt } from "../utils/crypto.js";
import { AUTH_ERROR_CODES } from "../../../shared/authValidation.js";

const mockUserFindUnique = jest.fn();
await jest.unstable_mockModule("../config/prisma.js", () => ({
  default: {
    user: {
      findUnique: mockUserFindUnique,
    },
  },
}));

const {
  ensureCovaiGitExcludes,
  execGit,
  normalizeCleanGithubUrl,
  redactGitOutput,
  resolveActingUserGithubToken,
  resolveGitAuthorIdentity,
  sanitizeGitFilePath,
  sanitizeGitRef,
} = await import("../services/gitCredentialHelper.service.js");
const { withProjectVcsLock } = await import("../services/vcsLock.service.js");

describe("gitCredentialHelper & vcsLock", () => {
  const origEncKey = process.env.ENCRYPTION_KEY;
  let tempDir;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = "0123456789abcdef".repeat(4);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-git-cred-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  afterAll(() => {
    if (origEncKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = origEncKey;
  });

  it("redacts tokens, basic auth headers, and embedded URL credentials", () => {
    const token = "gho_secretTokenValue123456";
    const b64 = Buffer.from(`x-access-token:${token}`).toString("base64");
    const raw = `fatal: https://x-access-token:${token}@github.com/org/repo.git AUTHORIZATION: basic ${b64} ghp_anotherSecret999 github_pat_11ABC`;

    const cleaned = redactGitOutput(raw, [token, b64]);
    expect(cleaned).not.toContain(token);
    expect(cleaned).not.toContain(b64);
    expect(cleaned).not.toContain("ghp_anotherSecret999");
    expect(cleaned).not.toContain("github_pat_11ABC");
    expect(cleaned).toContain("https://github.com/org/repo.git");
    expect(cleaned).toContain("AUTHORIZATION: basic [REDACTED]");
  });

  it("normalizes clean GitHub HTTPS URLs and rejects unsafe schemes", () => {
    expect(
      normalizeCleanGithubUrl("https://x-access-token:tok@github.com/octo/covai"),
    ).toEqual({
      owner: "octo",
      repo: "covai",
      cleanUrl: "https://github.com/octo/covai.git",
      webUrl: "https://github.com/octo/covai",
    });

    expect(() => normalizeCleanGithubUrl("file:///etc/passwd")).toThrow();
    expect(() => normalizeCleanGithubUrl("git@github.com:octo/covai.git")).toThrow();
    expect(() => normalizeCleanGithubUrl("https://github.com/octo/bad repo")).toThrow();
  });

  it("populates .git/info/exclude with CovAI ignores without modifying .gitignore", () => {
    fs.mkdirSync(path.join(tempDir, ".git"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, ".gitignore"), "custom-dir/\n", "utf8");

    expect(ensureCovaiGitExcludes(tempDir)).toBe(true);
    expect(ensureCovaiGitExcludes(tempDir)).toBe(false);

    const excludeText = fs.readFileSync(
      path.join(tempDir, ".git", "info", "exclude"),
      "utf8",
    );
    expect(excludeText).toContain("coverage/");
    expect(excludeText).toContain("playwright-report/");
    expect(excludeText).toContain("test-results/");
    expect(excludeText).toContain(".covai-temp/");
    expect(fs.readFileSync(path.join(tempDir, ".gitignore"), "utf8")).toBe(
      "custom-dir/\n",
    );
  });

  it("validates relative paths & git refs against traversal and flag injection", () => {
    expect(sanitizeGitFilePath("./src\\app.js")).toBe("src/app.js");
    expect(() => sanitizeGitFilePath("../secret.js")).toThrow();
    expect(() => sanitizeGitFilePath("C:\\Windows\\system.ini")).toThrow();
    expect(() => sanitizeGitFilePath(".git/hooks/pre-commit")).toThrow();
    expect(() => sanitizeGitFilePath("src/CON.js")).toThrow();

    expect(sanitizeGitRef("feat/vcs-1.0")).toBe("feat/vcs-1.0");
    expect(() => sanitizeGitRef("--upload-pack=evil")).toThrow();
    expect(() => sanitizeGitRef("-b")).toThrow();
    expect(() => sanitizeGitRef("main..other")).toThrow();
    expect(() => sanitizeGitRef("main@{0}")).toThrow();
  });

  it("isolates GitHub tokens strictly to the acting user and checks repo scope", async () => {
    const encrypted = encrypt("gho_acting_user_token_xyz");
    mockUserFindUnique.mockResolvedValueOnce({
      githubAccessTokenEnc: encrypted,
      githubOAuthScopes: "read:user,user:email",
      githubLogin: "editor-octo",
    });

    await expect(
      resolveActingUserGithubToken("editor-1", { requireRepoScope: true }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: AUTH_ERROR_CODES.GITHUB_REPO_SCOPE_REQUIRED,
    });
    expect(mockUserFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "editor-1" } }),
    );

    mockUserFindUnique.mockResolvedValueOnce({
      githubAccessTokenEnc: encrypted,
      githubOAuthScopes: "repo,read:user,user:email",
      githubLogin: "owner-octo",
    });
    const resolved = await resolveActingUserGithubToken("owner-1", {
      requireRepoScope: true,
    });
    expect(resolved).toEqual({
      token: "gho_acting_user_token_xyz",
      login: "owner-octo",
      scopes: ["repo", "read:user", "user:email"],
    });

    mockUserFindUnique.mockResolvedValueOnce({ githubAccessTokenEnc: null });
    await expect(resolveActingUserGithubToken("editor-2")).rejects.toMatchObject({
      statusCode: 401,
      code: AUTH_ERROR_CODES.GITHUB_TOKEN_REVOKED,
    });
  });

  it("resolves author identity with noreply fallback", async () => {
    mockUserFindUnique.mockResolvedValueOnce({
      id: "u1",
      name: "",
      email: "",
      githubLogin: "octo-dev",
    });
    const identity = await resolveGitAuthorIdentity("u1");
    expect(identity).toEqual({
      name: "octo-dev",
      email: "octo-dev@users.noreply.github.com",
    });
  });

  it("executes git safely on UTF-8 paths and serializes per-project locks", async () => {
    await execGit(tempDir, ["init", "-b", "main"]);
    fs.writeFileSync(path.join(tempDir, "tệp tin.js"), "export const x = 1;\n");
    const statusRes = await execGit(
      tempDir,
      ["status", "--porcelain=v2", "-uall", "-z"],
      { rawOutput: true },
    );
    expect(statusRes.stdout).toContain("tệp tin.js");
    expect(statusRes.stdout).not.toContain("\\303");

    const order = [];
    await Promise.all([
      withProjectVcsLock("proj-lock-1", async () => {
        order.push("start-1");
        await new Promise((r) => setTimeout(r, 30));
        order.push("end-1");
      }),
      withProjectVcsLock("proj-lock-1", async () => {
        order.push("start-2");
        order.push("end-2");
      }),
    ]);
    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2"]);
  });
});
