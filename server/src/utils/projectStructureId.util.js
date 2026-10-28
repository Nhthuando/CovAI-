import { createHash } from "crypto";

const stableHash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 20);
const normalized = (value) => String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");

export const createNodeId = (relativePath, kind = "file") =>
    `${kind}:${stableHash(`${kind}:${normalized(relativePath)}`)}`;

export const createEdgeId = (fromPath, toPath, type = "imports") =>
    `edge:${stableHash(`${normalized(fromPath)}:${normalized(toPath)}:${type}`)}`;

export const createFunctionId = (relativePath, startLine, endLine, construct = "function") =>
    `function:${stableHash(`${normalized(relativePath)}:${startLine}:${endLine}:${construct}`)}`;
