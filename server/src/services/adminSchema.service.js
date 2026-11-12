import { Prisma } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCHEMA_PATH = path.resolve(__dirname, "../../prisma/schema.prisma");

/**
 * Domain Taxonomy Configuration for all 67+ CovAI Database Models
 */
export const DOMAINS = Object.freeze([
  {
    id: "AUTH_ACCOUNTS",
    name: "Auth, Identity & Accounts",
    icon: "Shield",
    description: "User authentication, identity providers, system roles and security audit trails.",
    models: ["User", "Notification", "AdminAuditLog"],
  },
  {
    id: "PROJECTS_WORKSPACE",
    name: "Projects & Workspace",
    icon: "FolderGit2",
    description: "Project management, members, collaboration invites, and file version history.",
    models: [
      "Project",
      "ProjectSnapshot",
      "ProjectStructureAnalysis",
      "ProjectMember",
      "ProjectInvitation",
      "InvitationDelivery",
      "ProjectFileVersion",
      "ProjectMemory",
    ],
  },
  {
    id: "AI_TRUST_EVALUATION",
    name: "AI Trustworthiness & Evaluation",
    icon: "BrainCircuit",
    description: "LLM evaluation targets, credentials, test cases, and human reviews.",
    models: [
      "AiEvaluationTarget",
      "AiEvaluationCredential",
      "AiEvaluationTargetVersion",
      "AiEvaluationKnowledgeSource",
      "AiEvaluationProfile",
      "AiEvaluationProfileVersion",
      "AiEvaluationTestCase",
      "AiEvaluationRun",
      "AiEvaluationCaseResult",
      "AiEvaluationAttempt",
      "AiEvaluationToolCall",
      "AiEvaluationConfirmationGrant",
      "AiEvaluationCriterionResult",
      "AiEvaluationEvidence",
      "AiEvaluationHumanReview",
    ],
  },
  {
    id: "TESTING_QUALITY",
    name: "Testing, Scenarios & Quality",
    icon: "FlaskConical",
    description: "Quality reports, test scenarios, system requirements, and vulnerability tracking.",
    models: [
      "QualityReport",
      "TestRun",
      "TestScenario",
      "SystemTestFile",
      "Vulnerability",
      "PerformanceMetric",
      "SystemRequirementRevision",
      "SystemAssertionBinding",
      "SystemTestAssessment",
      "SystemScenario",
      "SystemRunEvent",
      "SystemRunArtifact",
      "SystemTestProposal",
    ],
  },
  {
    id: "COVERAGE_AST",
    name: "Coverage Engine & AST Analysis",
    icon: "Binary",
    description: "Code coverage data (Line/Branch/Function), AST graphs, and cyclomatic complexity.",
    models: [
      "CoverageSummary",
      "CoverageFile",
      "CoverageFunction",
      "Cfg",
      "Cyclomatic",
    ],
  },
  {
    id: "BACKGROUND_JOBS",
    name: "Background Jobs & Execution",
    icon: "Cpu",
    description: "Background workers, BullMQ job execution logs, and output streams.",
    models: ["Job", "JobLog", "JobOutput"],
  },
  {
    id: "COLLAB_REALTIME",
    name: "Real-Time Collab & Mutations",
    icon: "Zap",
    description: "Real-time editor documents (Yjs), project mutations, and AI chat sessions.",
    models: [
      "ProjectEditorDocument",
      "ProjectEditorUpdate",
      "ProjectCodeChange",
      "ProjectEvent",
      "ProjectMutation",
      "ProjectOperation",
      "ProjectOperationRequest",
      "ChatRequest",
      "ChatSession",
      "ChatMessage",
      "AiContextSettings",
      "SystemSuiteState",
      "SystemSuiteVersion",
      "SystemTestBlob",
    ],
  },
  {
    id: "AI_MUTATORS_QUOTA",
    name: "AI Quota & System Mutators",
    icon: "Sparkles",
    description: "AI context cache tokens, quota reservations, code suggestions, and mutation tests.",
    models: [
      "AiContextCache",
      "AiSuggestion",
      "AiTest",
      "AiTestResult",
      "AiQuotaReservation",
      "SystemMutationRun",
    ],
  },
]);

/**
 * Strict Sensitive Fields Redaction Configuration
 * Fields listed here are never leaked in plain text to the admin client.
 */
export const SENSITIVE_FIELDS_CONFIG = Object.freeze({
  User: [
    "passwordHash",
    "refreshToken",
    "passwordResetToken",
    "githubAccessTokenEnc",
  ],
  AiEvaluationCredential: [
    "ciphertext",
  ],
});

export const REDACTED_SECRET_PLACEHOLDER = "[REDACTED_SECRET]";

/**
 * Find Domain descriptor for a given Model Name
 */
export function getDomainForModel(modelName) {
  for (const domain of DOMAINS) {
    if (domain.models.includes(modelName)) {
      return { id: domain.id, name: domain.name, icon: domain.icon };
    }
  }
  return { id: "OTHER", name: "Other Models", icon: "Database" };
}

/**
 * Convert Model name to Prisma Client delegate property name
 * (e.g. "User" -> "user", "AiEvaluationTarget" -> "aiEvaluationTarget")
 */
export function getPrismaDelegateName(modelName) {
  if (!modelName) return "";
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

/**
 * Get active Prisma Delegate for a given Model name
 */
export function getPrismaDelegate(modelName) {
  const delegateName = getPrismaDelegateName(modelName);
  const delegate = prisma[delegateName];
  if (!delegate) {
    throw new ServiceError(
      `Database model '${modelName}' is not recognized or has no active Prisma delegate.`,
      404,
      "MODEL_NOT_FOUND"
    );
  }
  return delegate;
}

/**
 * Redact sensitive fields from a record or array of records
 */
export function redactRecord(modelName, record) {
  if (!record || typeof record !== "object") return record;

  const sensitiveFields = SENSITIVE_FIELDS_CONFIG[modelName] || [];

  if (Array.isArray(record)) {
    return record.map((item) => redactRecord(modelName, item));
  }

  const sanitized = { ...record };
  for (const field of sensitiveFields) {
    if (field in sanitized && sanitized[field] !== null && sanitized[field] !== undefined) {
      sanitized[field] = REDACTED_SECRET_PLACEHOLDER;
    }
  }
  return sanitized;
}

/**
 * Check if a field value in mutation payload is the redacted placeholder.
 * If so, remove it from data payload to prevent overwriting with placeholder.
 */
export function cleanRedactedPayload(modelName, payload) {
  if (!payload || typeof payload !== "object") return payload;
  const sensitiveFields = SENSITIVE_FIELDS_CONFIG[modelName] || [];
  const cleaned = { ...payload };

  for (const field of sensitiveFields) {
    if (cleaned[field] === REDACTED_SECRET_PLACEHOLDER) {
      delete cleaned[field];
    }
  }
  return cleaned;
}

/**
 * Extract parsed DMMF metadata for all models
 */
export class AdminSchemaService {
  constructor() {
    this.dmmf = Prisma.dmmf;
    this.modelsMap = new Map();
    this.schemaAstMap = this.parsePrismaSchemaFile();

    if (this.dmmf?.datamodel?.models) {
      for (const model of this.dmmf.datamodel.models) {
        this.modelsMap.set(model.name, model);
      }
    }
  }

  /**
   * Parse schema.prisma for primary keys and list relation precision
   */
  parsePrismaSchemaFile() {
    const metaMap = new Map();
    try {
      if (!fs.existsSync(SCHEMA_PATH)) return metaMap;
      const content = fs.readFileSync(SCHEMA_PATH, "utf-8");
      const modelBlocks = content.match(/model\s+(\w+)\s+\{[\s\S]*?\n\}/g) || [];

      for (const block of modelBlocks) {
        const match = block.match(/model\s+(\w+)\s+\{([\s\S]*?)\n\}/);
        if (!match) continue;
        const modelName = match[1];
        const body = match[2];

        let primaryKey = "id";
        const fields = new Map();

        for (const rawLine of body.split("\n")) {
          const line = rawLine.trim();
          if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
          const parts = line.split(/\s+/);
          if (parts.length < 2) continue;
          const fieldName = parts[0];
          const rawType = parts[1];

          const isList = rawType.endsWith("[]");
          const isId = line.includes("@id");
          if (isId) {
            primaryKey = fieldName;
          }

          fields.set(fieldName, {
            name: fieldName,
            isList,
            isId,
            isOptional: rawType.endsWith("?"),
            isUnique: line.includes("@unique"),
          });
        }

        metaMap.set(modelName, { primaryKey, fields });
      }
    } catch (err) {
      console.warn("[AdminSchemaService] Failed to parse schema.prisma:", err.message);
    }
    return metaMap;
  }

  /**
   * Return schema details of all 67 models grouped by domain
   */
  async getAllModelsSummary() {
    const rawModels = this.dmmf?.datamodel?.models || [];
    const domainBuckets = DOMAINS.map((domain) => ({
      id: domain.id,
      name: domain.name,
      icon: domain.icon,
      description: domain.description,
      models: [],
    }));
    const otherBucket = {
      id: "OTHER",
      name: "Other Models",
      icon: "Database",
      description: "Uncategorized models",
      models: [],
    };

    // Fetch counts in parallel chunks of 10 to minimize latency without overloading DB pool
    const modelCounts = new Map();
    const chunkSize = 15;
    for (let i = 0; i < rawModels.length; i += chunkSize) {
      const chunk = rawModels.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (rawModel) => {
          try {
            const delegate = prisma[getPrismaDelegateName(rawModel.name)];
            if (delegate && typeof delegate.count === "function") {
              const count = await delegate.count();
              modelCounts.set(rawModel.name, count);
            }
          } catch {
            modelCounts.set(rawModel.name, 0);
          }
        })
      );
    }

    let totalRecordCount = 0;

    for (const rawModel of rawModels) {
      const modelName = rawModel.name;
      const idField = rawModel.fields.find((f) => f.isId) || rawModel.fields[0];
      const sensitiveFields = SENSITIVE_FIELDS_CONFIG[modelName] || [];
      const recordCount = modelCounts.get(modelName) || 0;
      totalRecordCount += recordCount;

      const modelMeta = {
        name: modelName,
        dbName: rawModel.dbName || modelName,
        primaryKey: idField ? idField.name : "id",
        fieldsCount: rawModel.fields.length,
        recordCount,
        hasArchivedAt: rawModel.fields.some((f) => f.name === "archivedAt"),
        sensitiveFields,
        searchableFields: rawModel.fields
          .filter((f) => f.type === "String" && !f.isId && !sensitiveFields.includes(f.name))
          .map((f) => f.name),
      };

      let placed = false;
      for (const bucket of domainBuckets) {
        const domainDef = DOMAINS.find((d) => d.id === bucket.id);
        if (domainDef && domainDef.models.includes(modelName)) {
          bucket.models.push(modelMeta);
          placed = true;
          break;
        }
      }
      if (!placed) {
        otherBucket.models.push(modelMeta);
      }
    }

    const domainsResult = domainBuckets.filter((b) => b.models.length > 0);
    if (otherBucket.models.length > 0) {
      domainsResult.push(otherBucket);
    }

    // Build domainGroups dictionary for Sidebar Accordion in AdminLayout
    const domainGroups = {};
    for (const bucket of domainsResult) {
      domainGroups[bucket.name] = bucket.models.map((m) => ({
        name: m.name,
        count: m.recordCount,
        primaryKey: m.primaryKey,
        domain: bucket.name,
      }));
    }

    // Populate all models with fields metadata for AdminDatabaseExplorer
    const allModelsWithFields = rawModels.map((rm) => {
      try {
        const meta = this.getModelMetadata(rm.name);
        return {
          ...meta,
          domain: typeof meta.domain === "object" ? meta.domain?.name : (meta.domain || "General"),
          recordCount: modelCounts.get(rm.name) || 0,
        };
      } catch {
        return { name: rm.name, domain: "General", primaryKey: "id", fields: [] };
      }
    });

    return {
      domains: domainsResult,
      domainGroups,
      models: allModelsWithFields,
      totalTables: rawModels.length,
      totalModels: rawModels.length,
      totalRecords: totalRecordCount,
    };
  }

  /**
   * Return exhaustive Schema Metadata for a single model
   */
  getModelMetadata(modelName) {
    const rawModel = this.modelsMap.get(modelName);
    if (!rawModel) {
      throw new ServiceError(
        `Database model '${modelName}' not found in Prisma DMMF schema.`,
        404,
        "MODEL_NOT_FOUND"
      );
    }

    const domain = getDomainForModel(modelName);
    const sensitiveFields = SENSITIVE_FIELDS_CONFIG[modelName] || [];
    const parsedModel = this.schemaAstMap?.get(modelName);
    const primaryKey = parsedModel?.primaryKey || rawModel.primaryKey?.name || rawModel.fields.find((f) => f.isId)?.name || "id";

    const fields = rawModel.fields.map((field) => {
      const isSensitive = sensitiveFields.includes(field.name);
      const parsedField = parsedModel?.fields.get(field.name);
      const isList = parsedField?.isList ?? Boolean(field.isList);
      const isId = parsedField?.isId ?? (field.name === primaryKey);

      return {
        name: field.name,
        type: field.type,
        kind: field.kind, // "scalar", "object", "enum"
        isId,
        isRequired: Boolean(field.isRequired),
        isList,
        isUnique: Boolean(field.isUnique || parsedField?.isUnique),
        isUpdatedAt: Boolean(field.isUpdatedAt),
        hasDefaultValue: Boolean(field.hasDefaultValue),
        default: field.default !== undefined ? field.default : null,
        isSensitive,
        isRelation: field.kind === "object",
        relationName: field.relationName || null,
        relationToFields: field.relationToFields || [],
        relationFromFields: field.relationFromFields || [],
        isForeignKey: Boolean(field.relationFromFields && field.relationFromFields.length > 0),
      };
    });

    return {
      name: rawModel.name,
      dbName: rawModel.dbName || rawModel.name,
      domain: domain?.name || "General",
      domainMeta: domain,
      primaryKey,
      uniqueFields: rawModel.uniqueFields || [],
      hasArchivedAt: rawModel.fields.some((f) => f.name === "archivedAt"),
      fields,
      sensitiveFields,
    };
  }

  /**
   * Cast input values to matching Prisma scalar types
   */
  castFieldValue(modelName, fieldName, rawValue) {
    if (rawValue === null || rawValue === undefined) return null;
    const rawModel = this.modelsMap.get(modelName);
    if (!rawModel) return rawValue;

    const field = rawModel.fields.find((f) => f.name === fieldName);
    if (!field) return rawValue;

    if (field.type === "Int") {
      const parsed = parseInt(rawValue, 10);
      return isNaN(parsed) ? rawValue : parsed;
    }
    if (field.type === "Float") {
      const parsed = parseFloat(rawValue);
      return isNaN(parsed) ? rawValue : parsed;
    }
    if (field.type === "Boolean") {
      if (typeof rawValue === "boolean") return rawValue;
      if (rawValue === "true" || rawValue === "1") return true;
      if (rawValue === "false" || rawValue === "0") return false;
      return Boolean(rawValue);
    }
    if (field.type === "DateTime") {
      if (rawValue instanceof Date) return rawValue;
      const d = new Date(rawValue);
      return isNaN(d.getTime()) ? rawValue : d;
    }
    if (field.type === "Json") {
      if (typeof rawValue === "object") return rawValue;
      try {
        return JSON.parse(rawValue);
      } catch {
        return rawValue;
      }
    }
    return rawValue;
  }
}

export const adminSchemaService = new AdminSchemaService();
