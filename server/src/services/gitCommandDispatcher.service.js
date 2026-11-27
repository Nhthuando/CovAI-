import { editorEnabled } from "../../../shared/editorProtocol.js";
import { validateGitBranchName } from "../../../shared/gitProtocol.js";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { resolveProjectAccess } from "./projectAccess.service.js";
import { assertEditorSnapshotChangeAllowed } from "./projectEditorBridge.service.js";
import { GitService } from "./git.service.js";
import {
  redactGitOutput,
  sanitizeGitFilePath,
  sanitizeGitRef,
} from "./gitCredentialHelper.service.js";

const BLOCKED_GLOBAL_FLAGS = new Set([
  "-c",
  "--config",
  "--exec",
  "--exec-path",
  "--git-dir",
  "--work-tree",
  "--upload-pack",
  "--receive-pack",
  "--output",
  "--ext-diff",
  "--textconv",
  "--no-index",
  "--paginate",
  "--pager",
  "-p_pager",
  "-P",
]);

const BLOCKED_CONFIG_KEYS_RE =
  /(?:core\.sshCommand|core\.hooksPath|credential\.helper|protocol\.file\.allow|ext-diff|textconv)/i;

const BLOCKED_SUBCOMMANDS = new Set([
  "config",
  "clean",
  "gc",
  "filter-branch",
  "filter-repo",
  "submodule",
  "worktree",
  "daemon",
  "fast-import",
  "fsck",
  "prune",
  "repack",
  "reflog",
  "bisect",
  "rebase",
  "merge",
  "cherry-pick",
  "revert",
  "am",
  "apply",
  "rm",
  "mv",
  "clone",
  "init",
]);

const STATUS_SAFE_FLAGS = new Set([
  "-s",
  "--short",
  "-b",
  "--branch",
  "-u",
  "-uno",
  "-unormal",
  "-uall",
  "--porcelain",
  "--ignored",
  "--long",
  "-v",
  "--verbose",
]);

const LOG_SAFE_FLAGS = new Set([
  "--oneline",
  "--stat",
  "--graph",
  "--decorate",
  "--all",
  "--no-merges",
  "--first-parent",
  "--abbrev-commit",
  "--reverse",
  "--no-color",
]);

const DIFF_SAFE_FLAGS = new Set([
  "--staged",
  "--cached",
  "--stat",
  "--numstat",
  "--shortstat",
  "--name-only",
  "--name-status",
  "--summary",
  "-w",
  "--ignore-all-space",
  "-b",
  "--no-color",
]);

const SHOW_SAFE_FLAGS = new Set([
  "--stat",
  "--name-only",
  "--name-status",
  "--oneline",
  "-s",
  "--no-patch",
  "--no-color",
]);

const BRANCH_READ_FLAGS = new Set([
  "--show-current",
  "--list",
  "-a",
  "--all",
  "-r",
  "--remotes",
  "-v",
  "-vv",
  "--verbose",
  "--no-color",
  "--merged",
  "--no-merged",
]);

function quoteToken(tok) {
  if (/[\s"'\\]/.test(tok)) {
    return `"${tok.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return tok;
}

function isBlockedGlobalFlag(token) {
  const lower = token.toLowerCase();
  if (BLOCKED_GLOBAL_FLAGS.has(token) || BLOCKED_GLOBAL_FLAGS.has(lower)) {
    return true;
  }
  if (
    /^(?:-c|--config|--exec|--exec-path|--git-dir|--work-tree|--upload-pack|--receive-pack|--output|--ext-diff|--textconv)=/i.test(
      token,
    )
  ) {
    return true;
  }
  if (BLOCKED_CONFIG_KEYS_RE.test(token)) {
    return true;
  }
  return false;
}

/**
 * Splits a CLI command string safely without shell interpolation,
 * rejecting control characters, command substitution, and unquoted shell operators.
 */
export function tokenizeGitCli(rawInput) {
  if (typeof rawInput !== "string") {
    throw new ServiceError("Git command input must be a string", 400, "INVALID_GIT_COMMAND");
  }
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new ServiceError("Enter a Git command to execute", 400, "INVALID_GIT_COMMAND");
  }
  if (trimmed.length > 1000) {
    throw new ServiceError("Git command exceeds 1000 character limit", 400, "INVALID_GIT_COMMAND");
  }
  if (/[\0\r\n`]/.test(trimmed) || trimmed.includes("$(") || trimmed.includes("${")) {
    throw new ServiceError(
      "Shell control characters and command substitution are blocked for security.",
      403,
      "GIT_COMMAND_BLOCKED",
    );
  }

  const tokens = [];
  let current = "";
  let quote = null;
  let started = false;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "\\" && quote === '"' && i + 1 < trimmed.length && ['"', "\\"].includes(trimmed[i + 1])) {
      current += trimmed[i + 1];
      i += 1;
      started = true;
    } else if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
        started = true;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (";|&><".includes(ch)) {
      throw new ServiceError(
        `Shell operator '${ch}' is not allowed in Git Output Console.`,
        403,
        "GIT_COMMAND_BLOCKED",
      );
    } else if (/\s/.test(ch)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
    } else {
      current += ch;
      started = true;
    }
  }

  if (quote) {
    throw new ServiceError("Unterminated quote in Git command", 400, "INVALID_GIT_COMMAND");
  }
  if (started) {
    tokens.push(current);
  }

  if (tokens[0] && tokens[0].toLowerCase() === "git") {
    tokens.shift();
  }
  if (tokens.length === 0) {
    throw new ServiceError("Missing Git subcommand (e.g. git status, git pull)", 400, "INVALID_GIT_COMMAND");
  }

  for (const tok of tokens) {
    if (isBlockedGlobalFlag(tok)) {
      throw new ServiceError(
        `Blocked unsafe Git flag or option '${tok}'.`,
        403,
        "GIT_COMMAND_BLOCKED",
      );
    }
  }

  return tokens;
}

function validateDiffOrLogRefToken(tok) {
  if (tok.includes("...")) {
    const parts = tok.split("...");
    if (parts.length !== 2) throw new ServiceError(`Invalid git ref '${tok}'`, 400, "INVALID_GIT_REF");
    if (parts[0]) sanitizeGitRef(parts[0], "git reference");
    if (parts[1]) sanitizeGitRef(parts[1], "git reference");
    return tok;
  }
  if (tok.includes("..")) {
    const parts = tok.split("..");
    if (parts.length !== 2) throw new ServiceError(`Invalid git ref '${tok}'`, 400, "INVALID_GIT_REF");
    if (parts[0]) sanitizeGitRef(parts[0], "git reference");
    if (parts[1]) sanitizeGitRef(parts[1], "git reference");
    return tok;
  }
  return sanitizeGitRef(tok, "git reference");
}

function parseStashIndex(arg) {
  if (arg === undefined) return 0;
  const trimmed = String(arg).trim();
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  const match = trimmed.match(/^stash@\{(\d+)\}$/);
  if (match) return Number.parseInt(match[1], 10);
  throw new ServiceError(`Invalid stash reference '${trimmed}'`, 400, "INVALID_GIT_COMMAND");
}

function assertOriginOnlyOrBranch(arg, existingRemote) {
  const clean = String(arg || "").trim();
  if (/^(?:https?:|ssh:|git:|file:|git@|\/|\.)/i.test(clean) || clean.includes("://")) {
    throw new ServiceError(
      "Arbitrary remote URLs are blocked in the console. Configure origin via Link Remote instead.",
      403,
      "GIT_COMMAND_BLOCKED",
    );
  }
  if (!existingRemote && clean === "origin") {
    return { type: "remote", value: "origin" };
  }
  return { type: "branch", value: clean };
}

/**
 * Parses and classifies a raw CLI command into either a validated read `execGit`
 * action or a routed `GitService` mutation with explicit RBAC capabilities.
 */
export function parseGitConsoleCommand(rawInput) {
  const tokens = tokenizeGitCli(rawInput);
  const sub = tokens[0].toLowerCase();
  const rest = tokens.slice(1);
  const normalizedCommand = `git ${tokens.map(quoteToken).join(" ")}`;

  if (BLOCKED_SUBCOMMANDS.has(sub)) {
    throw new ServiceError(
      `Command 'git ${sub}' is blocked in the console. Use dedicated CovAI UI controls where supported.`,
      403,
      "GIT_COMMAND_BLOCKED",
    );
  }

  // ---- READ COMMANDS ----
  if (sub === "status") {
    const args = [];
    let afterDashDash = false;
    for (const tok of rest) {
      if (tok === "--") {
        afterDashDash = true;
        args.push("--");
      } else if (!afterDashDash && tok.startsWith("-")) {
        if (
          STATUS_SAFE_FLAGS.has(tok) ||
          /^--untracked-files=(?:no|normal|all)$/.test(tok)
        ) {
          args.push(tok);
        } else {
          throw new ServiceError(`Unsupported flag '${tok}' for git status`, 400, "INVALID_GIT_COMMAND");
        }
      } else {
        args.push(sanitizeGitFilePath(tok));
      }
    }
    return {
      kind: "read",
      subcommand: "status",
      cliArgs: ["status", ...args],
      capability: "project.read",
      mutated: false,
      syncWorkspace: false,
      normalizedCommand,
    };
  }

  if (sub === "log") {
    const args = [];
    let afterDashDash = false;
    let hasLimit = false;
    for (let i = 0; i < rest.length; i += 1) {
      const tok = rest[i];
      if (tok === "--") {
        afterDashDash = true;
        args.push("--");
        continue;
      }
      if (!afterDashDash && tok.startsWith("-")) {
        if (tok === "-n") {
          const val = rest[i + 1];
          const num = Number.parseInt(val, 10);
          if (!Number.isInteger(num) || num < 1 || num > 200 || String(num) !== String(val)) {
            throw new ServiceError("git log -n requires an integer between 1 and 200", 400, "INVALID_GIT_COMMAND");
          }
          args.push(`-n${num}`);
          hasLimit = true;
          i += 1;
        } else if (/^-(?:n?)(\d{1,3})$/.test(tok)) {
          const num = Number.parseInt(tok.replace(/^-n?/, ""), 10);
          if (num < 1 || num > 200) {
            throw new ServiceError("git log limit must be between 1 and 200", 400, "INVALID_GIT_COMMAND");
          }
          args.push(`-n${num}`);
          hasLimit = true;
        } else if (/^--max-count=(\d{1,3})$/.test(tok)) {
          const num = Number.parseInt(tok.split("=")[1], 10);
          if (num < 1 || num > 200) {
            throw new ServiceError("git log limit must be between 1 and 200", 400, "INVALID_GIT_COMMAND");
          }
          args.push(tok);
          hasLimit = true;
        } else if (
          LOG_SAFE_FLAGS.has(tok) ||
          /^--(?:author|grep|since|until)=[^\0\r\n]{1,120}$/.test(tok) ||
          /^--pretty=(?:oneline|short|medium|full)$/.test(tok)
        ) {
          args.push(tok);
        } else {
          throw new ServiceError(`Unsupported flag '${tok}' for git log`, 400, "INVALID_GIT_COMMAND");
        }
      } else if (afterDashDash) {
        args.push(sanitizeGitFilePath(tok));
      } else {
        args.push(validateDiffOrLogRefToken(tok));
      }
    }
    if (!hasLimit) args.unshift("-n20");
    return {
      kind: "read",
      subcommand: "log",
      cliArgs: ["log", ...args],
      capability: "project.read",
      mutated: false,
      syncWorkspace: false,
      normalizedCommand,
    };
  }

  if (sub === "diff") {
    const args = [];
    let afterDashDash = false;
    for (const tok of rest) {
      if (tok === "--") {
        afterDashDash = true;
        args.push("--");
      } else if (!afterDashDash && tok.startsWith("-")) {
        if (
          DIFF_SAFE_FLAGS.has(tok) ||
          /^(?:-U|--unified=)(?:[0-9]|1[0-9]|20)$/.test(tok)
        ) {
          args.push(tok);
        } else {
          throw new ServiceError(`Unsupported flag '${tok}' for git diff`, 400, "INVALID_GIT_COMMAND");
        }
      } else if (afterDashDash) {
        args.push(sanitizeGitFilePath(tok));
      } else {
        try {
          args.push(validateDiffOrLogRefToken(tok));
        } catch {
          args.push(sanitizeGitFilePath(tok));
        }
      }
    }
    if (!args.includes("--no-color")) args.unshift("--no-color");
    return {
      kind: "read",
      subcommand: "diff",
      cliArgs: ["diff", ...args],
      capability: "project.read",
      mutated: false,
      syncWorkspace: false,
      normalizedCommand,
    };
  }

  if (sub === "show") {
    const args = [];
    let hasRef = false;
    let afterDashDash = false;
    for (const tok of rest) {
      if (tok === "--") {
        afterDashDash = true;
        args.push("--");
      } else if (!afterDashDash && tok.startsWith("-")) {
        if (SHOW_SAFE_FLAGS.has(tok)) args.push(tok);
        else throw new ServiceError(`Unsupported flag '${tok}' for git show`, 400, "INVALID_GIT_COMMAND");
      } else if (afterDashDash) {
        args.push(sanitizeGitFilePath(tok));
      } else if (!hasRef && tok.includes(":")) {
        const colonIdx = tok.indexOf(":");
        const refPart = tok.slice(0, colonIdx) || "HEAD";
        const filePart = tok.slice(colonIdx + 1);
        args.push(`${sanitizeGitRef(refPart, "git reference")}:${sanitizeGitFilePath(filePart)}`);
        hasRef = true;
      } else if (!hasRef) {
        args.push(sanitizeGitRef(tok, "commit or ref"));
        hasRef = true;
      } else {
        throw new ServiceError("Too many positional arguments for git show", 400, "INVALID_GIT_COMMAND");
      }
    }
    if (!hasRef) args.push("HEAD");
    if (!args.includes("--no-color")) args.unshift("--no-color");
    return {
      kind: "read",
      subcommand: "show",
      cliArgs: ["show", ...args],
      capability: "project.read",
      mutated: false,
      syncWorkspace: false,
      normalizedCommand,
    };
  }

  if (sub === "remote") {
    if (rest.length === 0 || (rest.length === 1 && ["-v", "--verbose"].includes(rest[0]))) {
      return {
        kind: "read",
        subcommand: "remote",
        cliArgs: ["remote", ...rest],
        capability: "project.read",
        mutated: false,
        syncWorkspace: false,
        normalizedCommand,
      };
    }
    throw new ServiceError(
      "Modifying remotes via console is blocked. Only 'git remote' and 'git remote -v' are allowed.",
      403,
      "GIT_COMMAND_BLOCKED",
    );
  }

  if (sub === "tag") {
    const isListInvocation =
      rest.length === 0 ||
      ((rest.includes("-l") || rest.includes("--list") || rest.includes("-n")) &&
        !rest.some((tok) =>
          ["-d", "-D", "-f", "--force", "--delete", "-a", "-s", "-m"].includes(tok),
        ) &&
        rest.every(
          (tok) =>
            ["-l", "--list", "-n"].includes(tok) ||
            /^[A-Za-z0-9._*?/-]{1,80}$/.test(tok),
        ));
    if (isListInvocation) {
      return {
        kind: "read",
        subcommand: "tag",
        cliArgs: ["tag", ...rest],
        capability: "project.read",
        mutated: false,
        syncWorkspace: false,
        normalizedCommand,
      };
    }
    throw new ServiceError(
      "Use 'git tag -l' to list tags or use the Tags tab to create, push, or delete tags.",
      400,
      "INVALID_GIT_COMMAND",
    );
  }

  if (sub === "branch") {
    if (rest.some((tok) => ["-d", "-D", "-f", "--force", "--delete", "-m", "-M"].includes(tok))) {
      throw new ServiceError(
        "Branch deletion/rename flags (-d/-D/-m/-M/-f) are blocked in console. Use the Branches panel instead.",
        403,
        "GIT_COMMAND_BLOCKED",
      );
    }
    if (rest.length === 0 || rest.every((tok) => BRANCH_READ_FLAGS.has(tok))) {
      return {
        kind: "read",
        subcommand: "branch",
        cliArgs: ["branch", ...rest],
        capability: "project.read",
        mutated: false,
        syncWorkspace: false,
        normalizedCommand,
      };
    }
    if (rest.some((tok) => tok.startsWith("-"))) {
      throw new ServiceError("Unsupported git branch flags", 400, "INVALID_GIT_COMMAND");
    }
    if (rest.length > 2) {
      throw new ServiceError("Usage: git branch <new-branch> [<base-ref>]", 400, "INVALID_GIT_COMMAND");
    }
    const [newBranch, fromRef] = rest;
    if (!validateGitBranchName(newBranch)) {
      throw new ServiceError("Invalid branch name", 400, "INVALID_BRANCH_NAME");
    }
    if (fromRef) sanitizeGitRef(fromRef, "base ref");
    return {
      kind: "action",
      subcommand: "branch_create",
      action: "createBranch",
      params: { branch: newBranch, ...(fromRef ? { fromRef } : {}) },
      capability: "integrations.write",
      mutated: true,
      syncWorkspace: false,
      normalizedCommand,
    };
  }

  // ---- STASH (read + write) ----
  if (sub === "stash") {
    const subAction = (rest[0] && !rest[0].startsWith("-") ? rest[0].toLowerCase() : null);
    if (subAction === "list") {
      if (rest.length > 1) {
        throw new ServiceError("Usage: git stash list", 400, "INVALID_GIT_COMMAND");
      }
      return {
        kind: "read",
        subcommand: "stash",
        cliArgs: ["stash", "list", "--date=relative"],
        capability: "project.read",
        mutated: false,
        syncWorkspace: false,
        normalizedCommand,
      };
    }
    if (subAction === "show") {
      if (rest.length > 2) {
        throw new ServiceError("Usage: git stash show [stash@{n}]", 400, "INVALID_GIT_COMMAND");
      }
      const idx = parseStashIndex(rest[1] ?? 0);
      return {
        kind: "read",
        subcommand: "stash",
        cliArgs: ["stash", "show", "--stat", `stash@{${idx}}`],
        capability: "project.read",
        mutated: false,
        syncWorkspace: false,
        normalizedCommand,
      };
    }
    if (subAction === "clear") {
      throw new ServiceError("git stash clear is blocked for data safety.", 403, "GIT_COMMAND_BLOCKED");
    }
    if (subAction === "pop" || subAction === "apply" || subAction === "drop") {
      if (rest.length > 2) {
        throw new ServiceError(`Usage: git stash ${subAction} [stash@{n}|n]`, 400, "INVALID_GIT_COMMAND");
      }
      const idx = parseStashIndex(rest[1] ?? 0);
      return {
        kind: "action",
        subcommand: `stash_${subAction}`,
        action:
          subAction === "pop"
            ? "stashPop"
            : subAction === "apply"
              ? "stashApply"
              : "stashDrop",
        params: { index: idx },
        capability: "vcs.local",
        mutated: true,
        syncWorkspace: subAction !== "drop",
        normalizedCommand,
      };
    }
    // stash or stash push
    const pushArgs = subAction === "push" ? rest.slice(1) : rest;
    let message;
    let includeUntracked = true;
    let stagedOnly = false;
    for (let i = 0; i < pushArgs.length; i += 1) {
      const tok = pushArgs[i];
      if (tok === "-m" || tok === "--message") {
        const val = pushArgs[i + 1];
        if (!val) throw new ServiceError("git stash push -m requires a message", 400, "INVALID_GIT_COMMAND");
        message = val;
        i += 1;
      } else if (tok === "-u" || tok === "--include-untracked") {
        includeUntracked = true;
      } else if (tok === "--staged" || tok === "-S") {
        stagedOnly = true;
      } else {
        throw new ServiceError(`Unsupported option '${tok}' for git stash`, 400, "INVALID_GIT_COMMAND");
      }
    }
    return {
      kind: "action",
      subcommand: "stash_push",
      action: "stashPush",
      params: { message, includeUntracked, stagedOnly },
      capability: "vcs.local",
      mutated: true,
      syncWorkspace: true,
      normalizedCommand,
    };
  }

  // ---- LOCAL WRITE COMMANDS ----
  if (sub === "add") {
    if (rest.length === 0) {
      throw new ServiceError("Specify files to stage (e.g. 'git add .' or 'git add src/app.js')", 400, "INVALID_GIT_COMMAND");
    }
    if (rest.length === 1 && [".", "-A", "--all"].includes(rest[0])) {
      return {
        kind: "action",
        subcommand: "add",
        action: "stageFiles",
        params: { files: "all" },
        capability: "vcs.local",
        mutated: true,
        syncWorkspace: false,
        normalizedCommand,
      };
    }
    const paths = [];
    for (const tok of rest) {
      if (tok === "--") continue;
      if (tok.startsWith("-")) {
        throw new ServiceError(`Unsupported flag '${tok}' for git add`, 400, "INVALID_GIT_COMMAND");
      }
      if (tok === ".") {
        return {
          kind: "action",
          subcommand: "add",
          action: "stageFiles",
          params: { files: "all" },
          capability: "vcs.local",
          mutated: true,
          syncWorkspace: false,
          normalizedCommand,
        };
      }
      paths.push(sanitizeGitFilePath(tok));
    }
    if (paths.length === 0) {
      throw new ServiceError("Specify valid file path(s) to stage", 400, "INVALID_GIT_COMMAND");
    }
    return {
      kind: "action",
      subcommand: "add",
      action: "stageFiles",
      params: { files: paths },
      capability: "vcs.local",
      mutated: true,
      syncWorkspace: false,
      normalizedCommand,
    };
  }

  if (sub === "reset") {
    if (rest.some((tok) => ["--hard", "--soft", "--merge", "--keep"].includes(tok))) {
      throw new ServiceError(
        "Destructive reset flags (--hard/--soft) are blocked in console. Only unstaging ('git reset [HEAD] [file]') is permitted.",
        403,
        "GIT_COMMAND_BLOCKED",
      );
    }
    const filtered = rest.filter((tok) => tok !== "--" && tok !== "HEAD");
    if (filtered.some((tok) => tok.startsWith("-"))) {
      throw new ServiceError("Unsupported flags for git reset", 400, "INVALID_GIT_COMMAND");
    }
    if (filtered.length === 0 || (filtered.length === 1 && filtered[0] === ".")) {
      return {
        kind: "action",
        subcommand: "reset_unstage",
        action: "unstageFiles",
        params: { files: "all" },
        capability: "vcs.local",
        mutated: true,
        syncWorkspace: false,
        normalizedCommand,
      };
    }
    const paths = filtered.map(sanitizeGitFilePath);
    return {
      kind: "action",
      subcommand: "reset_unstage",
      action: "unstageFiles",
      params: { files: paths },
      capability: "vcs.local",
      mutated: true,
      syncWorkspace: false,
      normalizedCommand,
    };
  }

  if (sub === "restore") {
    if (!rest.includes("--staged")) {
      throw new ServiceError(
        "Use 'git restore --staged <file>' to unstage, or Discard in the UI to revert worktree files.",
        400,
        "INVALID_GIT_COMMAND",
      );
    }
    const filtered = rest.filter((tok) => tok !== "--staged" && tok !== "--");
    if (filtered.some((tok) => tok.startsWith("-"))) {
      throw new ServiceError("Unsupported flags for git restore --staged", 400, "INVALID_GIT_COMMAND");
    }
    if (filtered.length === 0 || (filtered.length === 1 && filtered[0] === ".")) {
      return {
        kind: "action",
        subcommand: "restore_staged",
        action: "unstageFiles",
        params: { files: "all" },
        capability: "vcs.local",
        mutated: true,
        syncWorkspace: false,
        normalizedCommand,
      };
    }
    return {
      kind: "action",
      subcommand: "restore_staged",
      action: "unstageFiles",
      params: { files: filtered.map(sanitizeGitFilePath) },
      capability: "vcs.local",
      mutated: true,
      syncWorkspace: false,
      normalizedCommand,
    };
  }

  if (sub === "commit") {
    const messages = [];
    let stageAll = false;
    let amend = false;
    for (let i = 0; i < rest.length; i += 1) {
      const tok = rest[i];
      if (tok === "-m" || tok === "--message") {
        const val = rest[i + 1];
        if (!val) throw new ServiceError("git commit -m requires a message", 400, "INVALID_GIT_COMMAND");
        messages.push(val);
        i += 1;
      } else if (tok.startsWith("--message=")) {
        const val = tok.slice("--message=".length);
        if (!val) throw new ServiceError("git commit --message requires text", 400, "INVALID_GIT_COMMAND");
        messages.push(val);
      } else if (tok === "-a" || tok === "--all") {
        stageAll = true;
      } else if (tok === "-am" || tok === "-ma") {
        stageAll = true;
        const val = rest[i + 1];
        if (!val) throw new ServiceError(`git commit ${tok} requires a message`, 400, "INVALID_GIT_COMMAND");
        messages.push(val);
        i += 1;
      } else if (tok === "--amend") {
        amend = true;
      } else {
        throw new ServiceError(`Unsupported argument '${tok}' for git commit`, 400, "INVALID_GIT_COMMAND");
      }
    }
    if (messages.length === 0 || !messages[0].trim()) {
      throw new ServiceError('git commit requires -m "<message>"', 400, "INVALID_GIT_COMMAND");
    }
    return {
      kind: "action",
      subcommand: "commit",
      action: "commit",
      params: {
        message: messages[0].trim(),
        ...(messages.length > 1 ? { description: messages.slice(1).join("\n\n").trim() } : {}),
        stageAll,
        amend,
      },
      capability: "vcs.local",
      mutated: true,
      syncWorkspace: true,
      normalizedCommand,
    };
  }

  // ---- REMOTE & BRANCH WRITE COMMANDS (OWNER ONLY) ----
  if (sub === "fetch") {
    let prune = true;
    let tags = true;
    let seenOrigin = false;
    for (const tok of rest) {
      if (tok === "--prune" || tok === "-p") prune = true;
      else if (tok === "--no-prune") prune = false;
      else if (tok === "--tags" || tok === "-t") tags = true;
      else if (tok === "--no-tags") tags = false;
      else if (tok === "--all") {
        // origin-only workspace
      } else if (tok.startsWith("-")) {
        throw new ServiceError(`Unsupported flag '${tok}' for git fetch`, 400, "INVALID_GIT_COMMAND");
      } else {
        const checked = assertOriginOnlyOrBranch(tok, seenOrigin);
        if (checked.value !== "origin") {
          throw new ServiceError(
            "Only 'origin' remote is supported for git fetch.",
            403,
            "GIT_COMMAND_BLOCKED",
          );
        }
        seenOrigin = true;
      }
    }
    return {
      kind: "action",
      subcommand: "fetch",
      action: "fetch",
      params: { prune, tags },
      capability: "integrations.write",
      mutated: true,
      syncWorkspace: false,
      normalizedCommand,
    };
  }

  if (sub === "pull") {
    let rebase = false;
    let remote = null;
    let branch;
    for (const tok of rest) {
      if (tok === "--rebase" || tok === "-r") rebase = true;
      else if (tok === "--no-rebase") rebase = false;
      else if (tok.startsWith("-")) {
        throw new ServiceError(`Unsupported flag '${tok}' for git pull`, 400, "INVALID_GIT_COMMAND");
      } else {
        const checked = assertOriginOnlyOrBranch(tok, Boolean(remote));
        if (checked.type === "remote") {
          remote = checked.value;
        } else if (!branch) {
          if (!validateGitBranchName(checked.value)) {
            throw new ServiceError("Invalid branch name for git pull", 400, "INVALID_BRANCH_NAME");
          }
          branch = checked.value;
        } else {
          throw new ServiceError("Too many arguments for git pull", 400, "INVALID_GIT_COMMAND");
        }
      }
    }
    return {
      kind: "action",
      subcommand: "pull",
      action: "pull",
      params: { ...(branch ? { branch } : {}), rebase },
      capability: "integrations.write",
      mutated: true,
      syncWorkspace: true,
      normalizedCommand,
    };
  }

  if (sub === "push") {
    if (
      rest.some((tok) =>
        ["-f", "--force", "--force-with-lease", "--delete", "-d", "--mirror", "--all"].includes(
          tok,
        ),
      )
    ) {
      throw new ServiceError(
        "Force/delete push flags are blocked in the console. Use the UI prompt when force-with-lease is required.",
        403,
        "GIT_COMMAND_BLOCKED",
      );
    }
    let setUpstream = true;
    let tags = false;
    let remote = null;
    let branch;
    for (const tok of rest) {
      if (tok === "-u" || tok === "--set-upstream") setUpstream = true;
      else if (tok === "--tags") tags = true;
      else if (tok.startsWith("-")) {
        throw new ServiceError(`Unsupported flag '${tok}' for git push`, 400, "INVALID_GIT_COMMAND");
      } else {
        const checked = assertOriginOnlyOrBranch(tok, Boolean(remote));
        if (checked.type === "remote") {
          remote = checked.value;
        } else if (!branch) {
          if (!validateGitBranchName(checked.value)) {
            throw new ServiceError("Invalid branch name for git push", 400, "INVALID_BRANCH_NAME");
          }
          branch = checked.value;
        } else {
          throw new ServiceError("Too many arguments for git push", 400, "INVALID_GIT_COMMAND");
        }
      }
    }
    return {
      kind: "action",
      subcommand: "push",
      action: "push",
      params: { ...(branch ? { branch } : {}), setUpstream, tags },
      capability: "integrations.write",
      mutated: true,
      syncWorkspace: false,
      normalizedCommand,
    };
  }

  if (sub === "checkout" || sub === "switch") {
    if (
      rest.some((tok) =>
        ["-f", "--force", "--orphan", "-B", "-C", "--detach", "--"].includes(tok),
      )
    ) {
      throw new ServiceError(
        `Flag is blocked for 'git ${sub}' in the console.`,
        403,
        "GIT_COMMAND_BLOCKED",
      );
    }
    const createFlag = sub === "checkout" ? "-b" : "-c";
    let createNew = false;
    const positionals = [];
    for (const tok of rest) {
      if (tok === createFlag) {
        createNew = true;
      } else if (tok.startsWith("-")) {
        throw new ServiceError(`Unsupported flag '${tok}' for git ${sub}`, 400, "INVALID_GIT_COMMAND");
      } else {
        positionals.push(tok);
      }
    }
    if (positionals.length === 0 || positionals.length > (createNew ? 2 : 1)) {
      throw new ServiceError(
        `Usage: git ${sub} ${createNew ? `${createFlag} <new-branch> [<base-ref>]` : "<branch>"}`,
        400,
        "INVALID_GIT_COMMAND",
      );
    }
    const [targetBranch, fromRef] = positionals;
    if (!validateGitBranchName(targetBranch)) {
      throw new ServiceError("Invalid branch name", 400, "INVALID_BRANCH_NAME");
    }
    if (fromRef) sanitizeGitRef(fromRef, "base ref");
    return {
      kind: "action",
      subcommand: sub,
      action: "checkout",
      params: {
        branch: targetBranch,
        createNew,
        ...(fromRef ? { fromRef } : {}),
      },
      capability: "integrations.write",
      mutated: true,
      syncWorkspace: true,
      normalizedCommand,
    };
  }

  throw new ServiceError(
    `Unsupported Git command '${sub}'. Supported: status, log, diff, show, branch, remote -v, tag, stash, add, reset, restore --staged, commit, fetch, pull, push, checkout, switch.`,
    400,
    "UNSUPPORTED_GIT_COMMAND",
  );
}

/**
 * Executes a parsed console command either as a safe read-only `execGit` call
 * or routed cleanly into the full RBAC + lock + Socket-synced `GitService` method.
 */
export async function dispatchGitConsoleCommand({
  projectId,
  userId,
  input,
  command,
  args = [],
}) {
  const rawCli =
    typeof input === "string" && input.trim()
      ? input
      : [command, ...(Array.isArray(args) ? args : [])]
          .filter(Boolean)
          .map(quoteToken)
          .join(" ");

  const parsed = parseGitConsoleCommand(rawCli);

  try {
    await resolveProjectAccess({
      projectId,
      userId,
      capability: parsed.capability,
    });
  } catch (err) {
    if (err instanceof ServiceError && err.code === "CAPABILITY_DENIED") {
      const requirement =
        parsed.capability === "integrations.write"
          ? "Requires Project OWNER role."
          : parsed.capability === "vcs.local"
            ? "Requires OWNER or EDITOR role."
            : "Requires project read access.";
      throw new ServiceError(
        `Permission denied for '${parsed.normalizedCommand}'. ${requirement}`,
        403,
        "CAPABILITY_DENIED",
      );
    }
    throw err;
  }

  if (parsed.syncWorkspace && editorEnabled()) {
    await assertEditorSnapshotChangeAllowed(prisma, projectId);
  }

  if (parsed.kind === "read") {
    const { rootDir } = await GitService.getRepoPath(projectId, userId);
    const { stdout, stderr } = await GitService.runCommand(rootDir, parsed.cliArgs, {
      rawOutput: true,
    });
    let output = redactGitOutput((stdout || stderr || "").trimEnd());
    let status = null;
    if (parsed.subcommand === "status") {
      status = await GitService.getStatus(projectId, userId).catch(() => null);
      if (status?.trackingMessage && !output.includes("Your branch")) {
        const lines = output.split(/\r?\n/);
        if (lines.length > 0 && /^On branch\s+/i.test(lines[0])) {
          lines.splice(1, 0, status.trackingMessage);
          output = lines.join("\n");
        } else {
          output = output ? `${output}\n${status.trackingMessage}` : status.trackingMessage;
        }
      }
    }
    return {
      command: parsed.normalizedCommand,
      output,
      mutated: false,
      syncWorkspace: false,
      workspaceChanged: false,
      updatedFiles: [],
      workspaceRevision: status?.workspaceRevision ?? null,
      trackingMessage: status?.trackingMessage || null,
      conflicted: false,
      conflicts: [],
      status,
      branches: null,
    };
  }

  let output = "";
  let status = null;
  let branches = null;
  let conflicted = false;
  let conflicts = [];
  let actionResult = null;

  switch (parsed.action) {
    case "stageFiles":
      status = await GitService.stageFiles(projectId, userId, parsed.params.files);
      output =
        parsed.params.files === "all"
          ? "Staged all changes."
          : `Staged ${parsed.params.files.join(", ")}.`;
      break;
    case "unstageFiles":
      status = await GitService.unstageFiles(projectId, userId, parsed.params.files);
      output =
        parsed.params.files === "all"
          ? "Unstaged all staged changes."
          : `Unstaged ${parsed.params.files.join(", ")}.`;
      break;
    case "commit": {
      const res = await GitService.commit(projectId, userId, parsed.params);
      actionResult = res;
      status = res.status || null;
      output = res.message || `Committed ${res.commitSha || ""}`.trim();
      break;
    }
    case "fetch": {
      const res = await GitService.fetch(projectId, userId, parsed.params);
      actionResult = res;
      status = res.status || null;
      const baseFetchOut = res.output || "Fetch completed.";
      output =
        status?.trackingMessage && !baseFetchOut.includes("Your branch")
          ? `${baseFetchOut}\n${status.trackingMessage}`
          : baseFetchOut;
      break;
    }
    case "pull": {
      const res = await GitService.pull(projectId, userId, parsed.params);
      actionResult = res;
      status = res.status || null;
      conflicted = Boolean(res.conflicted);
      conflicts = res.conflicts || [];
      output = res.output || (conflicted ? "Pull hit merge conflicts." : "Pull completed.");
      break;
    }
    case "push": {
      const res = await GitService.push(projectId, userId, parsed.params);
      actionResult = res;
      status = res.status || null;
      output = res.output || "Push completed.";
      break;
    }
    case "checkout": {
      const res = await GitService.checkout(projectId, userId, parsed.params);
      actionResult = res;
      status = res.status || null;
      branches = res;
      const switchedLine = parsed.params.createNew
        ? `Switched to a new branch '${status?.branch || parsed.params.branch}'`
        : `Switched to branch '${status?.branch || parsed.params.branch}'`;
      output = status?.trackingMessage
        ? `${switchedLine}\n${status.trackingMessage}`
        : `${switchedLine}.`;
      break;
    }
    case "createBranch": {
      const res = await GitService.createBranch(projectId, userId, parsed.params);
      actionResult = res;
      status = res.status || null;
      branches = res;
      output = `Created branch '${parsed.params.branch}'.`;
      break;
    }
    case "stashPush": {
      const res = await GitService.stashPush(projectId, userId, parsed.params);
      actionResult = res;
      status = res.status || null;
      output = res.output || "Saved working directory and index state.";
      break;
    }
    case "stashPop": {
      const res = await GitService.stashPop(projectId, userId, parsed.params.index);
      actionResult = res;
      status = res.status || null;
      output = `Popped stash@{${parsed.params.index}}.`;
      break;
    }
    case "stashApply": {
      const res = await GitService.stashApply(projectId, userId, parsed.params.index);
      actionResult = res;
      status = res.status || null;
      output = `Applied stash@{${parsed.params.index}}.`;
      break;
    }
    case "stashDrop": {
      const res = await GitService.stashDrop(projectId, userId, parsed.params.index);
      actionResult = res;
      status = res.status || null;
      output = `Dropped stash@{${parsed.params.index}}.`;
      break;
    }
    default:
      throw new ServiceError("Unsupported Git action", 400, "INVALID_GIT_COMMAND");
  }

  const workspaceChanged = Boolean(parsed.syncWorkspace || actionResult?.workspaceChanged);
  const updatedFiles = Array.isArray(actionResult?.updatedFiles)
    ? actionResult.updatedFiles
    : [];
  const workspaceRevision =
    actionResult?.workspaceRevision ?? status?.workspaceRevision ?? null;

  return {
    command: parsed.normalizedCommand,
    output: redactGitOutput(output),
    mutated: true,
    syncWorkspace: parsed.syncWorkspace,
    workspaceChanged,
    updatedFiles,
    workspaceRevision,
    trackingMessage: status?.trackingMessage || null,
    conflicted,
    conflicts,
    status,
    branches,
  };
}
