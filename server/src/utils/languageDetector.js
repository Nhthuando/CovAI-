import fs from "fs";
import path from "path";
import unzipper from "unzipper";
import {
  createExtractorFromData,
  createExtractorFromFile,
} from "node-unrar-js";
import { ServiceError } from "./serviceError.js";

// Extensions mapped to language names
const LANGUAGE_EXTENSIONS = {
  // JavaScript
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",

  // TypeScript
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",

  // Python
  ".py": "Python",
  ".pyw": "Python",
  ".ipynb": "Python",

  // Java & JVM
  ".java": "Java",
  ".kt": "Kotlin",
  ".kts": "Kotlin",

  // C / C++
  ".c": "C",
  ".cpp": "C++",
  ".cc": "C++",
  ".cxx": "C++",
  ".h": "C/C++ Header",
  ".hpp": "C++ Header",

  // C#
  ".cs": "C#",

  // Go
  ".go": "Go",

  // Rust
  ".rs": "Rust",

  // PHP
  ".php": "PHP",

  // Ruby
  ".rb": "Ruby",

  // Swift
  ".swift": "Swift",

  // Dart
  ".dart": "Dart",
};

// Folders to completely ignore during language scanning
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".github",
  ".vscode",
  ".idea",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "coverage",
  ".cache",
  "vendor",
  "venv",
  ".venv",
  "env",
  ".env",
  "__pycache__",
  "bin",
  "obj",
  "target",
]);

/**
 * Normalizes file path to forward slashes.
 */
function normalizePath(p = "") {
  return p.replace(/\\/g, "/");
}

/**
 * Checks if a relative path contains any ignored directory segments.
 */
function isIgnoredPath(normPath = "") {
  const segments = normPath.split("/");
  return segments.some((seg) => IGNORED_DIRS.has(seg.toLowerCase()));
}

/**
 * Core function: Inspects an array of relative file paths and determines the primary language.
 *
 * @param {string[]} filePaths - Array of normalized file paths inside project
 * @returns {{ isSupported: boolean, primaryLanguage: string, reason: string, stats: Object }}
 */
export function detectLanguageFromPaths(filePaths = []) {
  let jsCount = 0;
  let tsCount = 0;
  let hasPackageJson = false;

  const countsByLang = {};

  for (const rawPath of filePaths) {
    const norm = normalizePath(rawPath);
    if (isIgnoredPath(norm)) continue;

    const baseName = path.basename(norm).toLowerCase();
    if (baseName === "package.json") {
      hasPackageJson = true;
    }

    const ext = path.extname(norm).toLowerCase();
    const lang = LANGUAGE_EXTENSIONS[ext];

    if (lang) {
      if (lang === "JavaScript") {
        jsCount++;
      } else if (lang === "TypeScript") {
        tsCount++;
      }

      countsByLang[lang] = (countsByLang[lang] || 0) + 1;
    }
  }

  const jsTsCount = jsCount + tsCount;

  // Find dominant language among all detected languages
  let dominantLanguage = null;
  let maxCount = 0;

  for (const [lang, count] of Object.entries(countsByLang)) {
    if (count > maxCount) {
      maxCount = count;
      dominantLanguage = lang;
    }
  }

  // 1. If no code files found at all
  if (jsTsCount === 0 && (!dominantLanguage || maxCount === 0)) {
    if (hasPackageJson) {
      return {
        isSupported: true,
        primaryLanguage: "JavaScript",
        reason: "Detected package.json in workspace.",
        stats: { jsCount, tsCount, hasPackageJson, countsByLang },
      };
    }
    return {
      isSupported: false,
      primaryLanguage: "Unknown",
      reason:
        "Unsupported project. No valid JavaScript/TypeScript source code or package.json found.",
      stats: { jsCount, tsCount, hasPackageJson, countsByLang },
    };
  }

  // 2. If 0 JS/TS files, but other languages exist (e.g. Python, Java, C#, Go...)
  if (jsTsCount === 0) {
    return {
      isSupported: false,
      primaryLanguage: dominantLanguage || "Other",
      reason: `Unsupported project. CovAI only supports projects whose primary language is JavaScript or TypeScript (detected language: ${dominantLanguage || "Other"}).`,
      stats: { jsCount, tsCount, hasPackageJson, countsByLang },
    };
  }

  // 3. Both JS/TS and other languages exist:
  // If another language strictly dominates JS/TS and there's no package.json
  const otherLanguagesCount = Object.entries(countsByLang)
    .filter(([lang]) => lang !== "JavaScript" && lang !== "TypeScript")
    .reduce((acc, [_, count]) => acc + count, 0);

  if (!hasPackageJson && otherLanguagesCount > jsTsCount * 2) {
    return {
      isSupported: false,
      primaryLanguage: dominantLanguage || "Other",
      reason: `Unsupported project. The primary language of this project is ${dominantLanguage} (${maxCount} files vs ${jsTsCount} JS/TS files). CovAI only supports JavaScript/TypeScript.`,
      stats: { jsCount, tsCount, hasPackageJson, countsByLang },
    };
  }

  // 4. Valid JS/TS project
  const primaryLanguage = tsCount > jsCount ? "TypeScript" : "JavaScript";
  return {
    isSupported: true,
    primaryLanguage,
    reason: `Valid language detected: ${primaryLanguage} (${jsTsCount} source files).`,
    stats: { jsCount, tsCount, hasPackageJson, countsByLang },
  };
}

/**
 * Scans a directory recursively on disk and checks its language.
 *
 * @param {string} dirPath - Absolute or relative directory path on disk
 * @returns {{ isSupported: boolean, primaryLanguage: string, reason: string, stats: Object }}
 */
export function detectLanguageFromDirectory(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) {
    return {
      isSupported: false,
      primaryLanguage: "Unknown",
      reason: "Project directory does not exist.",
      stats: {},
    };
  }

  const collectedPaths = [];

  function walk(currentDir) {
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(dirPath, fullPath).replace(/\\/g, "/");

      if (isIgnoredPath(relPath)) continue;

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        collectedPaths.push(relPath);
      }
    }
  }

  walk(dirPath);
  return detectLanguageFromPaths(collectedPaths);
}

/**
 * Inspects a compressed archive buffer or file (.zip or .rar) without extracting to disk.
 * Throws ServiceError(400) if project's primary language is not JavaScript or TypeScript.
 *
 * @param {Buffer|string} source - Buffer or file path of archive
 * @param {string} filename - Archive original name (e.g. project.zip)
 * @returns {Promise<{ isSupported: boolean, primaryLanguage: string, reason: string }>}
 */
export async function validateArchiveLanguage(source, filename) {
  const ext = path.extname(filename).toLowerCase();
  const isFilePath = typeof source === "string";
  const filePaths = [];

  if (ext === ".zip") {
    const directory = isFilePath
      ? await unzipper.Open.file(source)
      : await unzipper.Open.buffer(source);

    for (const file of directory.files) {
      if (file.type === "File") {
        filePaths.push(file.path);
      }
    }
  } else if (ext === ".rar") {
    const extractor = isFilePath
      ? await createExtractorFromFile({ filepath: source })
      : await createExtractorFromData({ data: new Uint8Array(source) });

    const list = extractor.getFileList();
    for (const header of list.fileHeaders) {
      if (!header.flags || !header.flags.directory) {
        filePaths.push(header.name || "");
      }
    }
  } else {
    throw new ServiceError(
      "Unsupported file format. Only .zip and .rar archives are accepted.",
      400,
    );
  }

  const result = detectLanguageFromPaths(filePaths);

  if (!result.isSupported) {
    throw new ServiceError(result.reason, 400);
  }

  return result;
}
