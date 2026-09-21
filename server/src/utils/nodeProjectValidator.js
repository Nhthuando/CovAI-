import fs from "fs";
import path from "path";
import unzipper from "unzipper";
import {
  createExtractorFromData,
  createExtractorFromFile,
} from "node-unrar-js";
import { ServiceError } from "./serviceError.js";
import { resolveProjectRoot } from "./projectRootResolver.js";
import { detectJest } from "./jestDetector.js";
import { detectSupertest } from "../services/supertestDetection.service.js";

const INVALID_PACKAGE_MESSAGE =
  "Invalid Node.js project: package.json was not found in the uploaded project.";

const collectArchiveEntries = async (source, filename) => {
  const ext = path.extname(filename || "").toLowerCase();
  const isFilePath = typeof source === "string";

  if (ext === ".rar") {
    const extractor = isFilePath
      ? await createExtractorFromFile({ filepath: source })
      : await createExtractorFromData({ data: new Uint8Array(source) });
    const list = extractor.getFileList();
    const fileHeaders = Array.from(list.fileHeaders || []);
    return fileHeaders
      .filter((header) => !header.flags?.directory)
      .map((header) => (header.name || "").replace(/\\/g, "/"));
  }

  const directory = isFilePath
    ? await unzipper.Open.file(source)
    : await unzipper.Open.buffer(source);
  return directory.files
    .filter((file) => file.type !== "Directory")
    .map((file) => (file.path || "").replace(/\\/g, "/"));
};

export const validateArchiveContainsPackageJson = async (source, filename) => {
  if (!source) {
    throw new ServiceError(INVALID_PACKAGE_MESSAGE, 422);
  }

  const archiveEntries = await collectArchiveEntries(source, filename);
  const hasPackageJson = archiveEntries.some(
    (entry) => entry.replace(/\\/g, "/").split("/").pop() === "package.json",
  );

  if (!hasPackageJson) {
    throw new ServiceError(INVALID_PACKAGE_MESSAGE, 422);
  }

  return true;
};

export const validateNodeProject = async (rootDir) => {
  if (!rootDir || typeof rootDir !== "string" || rootDir.trim().length === 0) {
    throw new ServiceError(
      "Invalid Node.js project: project root was not found.",
      422,
    );
  }

  const resolvedRootDir = resolveProjectRoot(rootDir);
  const packageJsonPath = path.join(resolvedRootDir, "package.json");
  const packageJsonExists =
    fs.existsSync(packageJsonPath) && fs.statSync(packageJsonPath).isFile();

  const jestInfo = detectJest(resolvedRootDir);
  const supertestInfo = await detectSupertest(resolvedRootDir);

  const result = {
    rootDir: resolvedRootDir,
    packageJsonPath: packageJsonExists ? packageJsonPath : null,
    packageJsonExists,
    hasJest: jestInfo.hasJest,
    hasSupertest: Boolean(
      supertestInfo.detected && supertestInfo.supertestFiles.length > 0,
    ),
    supertestFiles: supertestInfo.supertestFiles || [],
    jestConfigPath: jestInfo.configPath || null,
    jestInfo,
    supertestInfo,
  };

  if (!packageJsonExists) {
    throw new ServiceError(INVALID_PACKAGE_MESSAGE, 422);
  }

  return result;
};
