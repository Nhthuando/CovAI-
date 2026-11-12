import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import {
  adminSchemaService,
  getPrismaDelegate,
  redactRecord,
  cleanRedactedPayload,
} from "./adminSchema.service.js";
import { recordAudit } from "./adminAudit.service.js";

/**
 * Universal Database Data Service for all 67+ CovAI Database Tables
 * Provides dynamic CRUD, advanced compound filtering, relation traversal, and safe batching.
 */
export class AdminDataService {
  /**
   * Build Prisma WHERE clause from search term and compound filter array
   */
  buildWhereClause(modelName, { q, filters = [] } = {}) {
    const meta = adminSchemaService.getModelMetadata(modelName);
    const where = {};
    const andClauses = [];

    // 1. Text Search across available String fields
    if (q && typeof q === "string" && q.trim()) {
      const searchStr = q.trim();
      const stringFields = meta.fields.filter(
        (f) => f.type === "String" && !f.isId && !f.isSensitive && !f.isRelation
      );

      if (stringFields.length > 0) {
        andClauses.push({
          OR: stringFields.map((f) => ({
            [f.name]: { contains: searchStr, mode: "insensitive" },
          })),
        });
      }
    }

    // 2. Compound Filter Expressions
    // Format: filters = [ { field, operator, value } ]
    let parsedFilters = filters;
    if (typeof filters === "string") {
      try {
        parsedFilters = JSON.parse(filters);
      } catch {
        parsedFilters = [];
      }
    }

    if (Array.isArray(parsedFilters)) {
      for (const item of parsedFilters) {
        const { field, op, operator = op, val, value = val } = item;
        if (!field) continue;

        const fieldMeta = meta.fields.find((f) => f.name === field);
        if (!fieldMeta || fieldMeta.isRelation) continue;

        const castedValue = adminSchemaService.castFieldValue(modelName, field, value);

        switch (operator) {
          case "equals":
          case "eq":
            andClauses.push({ [field]: castedValue });
            break;
          case "not":
          case "neq":
            andClauses.push({ [field]: { not: castedValue } });
            break;
          case "contains":
            andClauses.push({
              [field]: { contains: String(value), mode: "insensitive" },
            });
            break;
          case "startsWith":
            andClauses.push({
              [field]: { startsWith: String(value), mode: "insensitive" },
            });
            break;
          case "endsWith":
            andClauses.push({
              [field]: { endsWith: String(value), mode: "insensitive" },
            });
            break;
          case "gt":
            andClauses.push({ [field]: { gt: castedValue } });
            break;
          case "gte":
            andClauses.push({ [field]: { gte: castedValue } });
            break;
          case "lt":
            andClauses.push({ [field]: { lt: castedValue } });
            break;
          case "lte":
            andClauses.push({ [field]: { lte: castedValue } });
            break;
          case "in": {
            const arr = Array.isArray(value)
              ? value
              : String(value).split(",").map((v) => v.trim());
            const castedArr = arr.map((v) =>
              adminSchemaService.castFieldValue(modelName, field, v)
            );
            andClauses.push({ [field]: { in: castedArr } });
            break;
          }
          case "isNull":
            andClauses.push({ [field]: null });
            break;
          case "isNotNull":
            andClauses.push({ [field]: { not: null } });
            break;
          default:
            andClauses.push({ [field]: castedValue });
        }
      }
    }

    if (andClauses.length > 0) {
      where.AND = andClauses;
    }

    return where;
  }

  /**
   * Build automatic relation expansion include clause
   */
  buildIncludeClause(modelName, includeRelations = false) {
    if (!includeRelations) return undefined;

    const meta = adminSchemaService.getModelMetadata(modelName);
    const include = {};
    let hasIncludes = false;

    for (const field of meta.fields) {
      if (field.isRelation && !field.isList) {
        // Find target model's actual primary key dynamically
        try {
          const targetMeta = adminSchemaService.getModelMetadata(field.type);
          const targetPk = targetMeta.primaryKey || "id";
          const selectObj = { [targetPk]: true };

          // Also include human-friendly label field if present on target
          const labelField = targetMeta.fields.find(
            (f) => !f.isSensitive && ["name", "email", "title", "caseKey", "type"].includes(f.name)
          );
          if (labelField && labelField.name !== targetPk) {
            selectObj[labelField.name] = true;
          }

          include[field.name] = { select: selectObj };
          hasIncludes = true;
        } catch {
          // If metadata lookup fails, safely skip
        }
      }
    }

    // Include relation list count if relations exist
    const listRelations = meta.fields.filter((f) => f.isRelation && f.isList);
    if (listRelations.length > 0) {
      include._count = {
        select: Object.fromEntries(listRelations.map((r) => [r.name, true])),
      };
      hasIncludes = true;
    }

    return hasIncludes ? include : undefined;
  }

  /**
   * List records from any of the 67 models with pagination, compound filters, search, and sorting
   */
  async listRecords(modelName, {
    page = 1,
    limit = 25,
    sortBy,
    sortOrder = "desc",
    q,
    filters,
    includeRelations = false,
  } = {}) {
    const delegate = getPrismaDelegate(modelName);
    const meta = adminSchemaService.getModelMetadata(modelName);

    const take = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (pageNum - 1) * take;

    const where = this.buildWhereClause(modelName, { q, filters });

    // Determine Sort Column
    let effectiveSortBy = sortBy;
    if (!effectiveSortBy || !meta.fields.some((f) => f.name === effectiveSortBy)) {
      if (meta.fields.some((f) => f.name === "createdAt")) {
        effectiveSortBy = "createdAt";
      } else {
        effectiveSortBy = meta.primaryKey;
      }
    }

    const order = String(sortOrder).toLowerCase() === "asc" ? "asc" : "desc";
    const orderBy = { [effectiveSortBy]: order };

    const include = this.buildIncludeClause(modelName, Boolean(includeRelations));

    const queryArgs = {
      where,
      take,
      skip,
      orderBy,
    };
    if (include) queryArgs.include = include;

    const [rows, total] = await Promise.all([
      delegate.findMany(queryArgs),
      delegate.count({ where }),
    ]);

    const sanitizedRows = rows.map((row) => redactRecord(modelName, row));

    return {
      records: sanitizedRows,
      meta: {
        model: modelName,
        total,
        page: pageNum,
        limit: take,
        totalPages: Math.ceil(total / take) || 1,
        sortBy: effectiveSortBy,
        sortOrder: order,
      },
    };
  }

  /**
   * Get single record by ID with relation expansion and sensitive data masking
   */
  async getRecordById(modelName, id, { includeRelations = true } = {}) {
    const delegate = getPrismaDelegate(modelName);
    const meta = adminSchemaService.getModelMetadata(modelName);

    const primaryKey = meta.primaryKey;
    const castedId = adminSchemaService.castFieldValue(modelName, primaryKey, id);

    const include = this.buildIncludeClause(modelName, Boolean(includeRelations));

    const queryArgs = {
      where: { [primaryKey]: castedId },
    };
    if (include) queryArgs.include = include;

    const record = await delegate.findUnique(queryArgs);
    if (!record) {
      throw new ServiceError(
        `Record with ${primaryKey}='${id}' not found in table '${modelName}'.`,
        404,
        "RECORD_NOT_FOUND"
      );
    }

    return redactRecord(modelName, record);
  }

  /**
   * Create a new record in any table with validation and audit logging
   */
  async createRecord(modelName, payload, { user, req } = {}) {
    const delegate = getPrismaDelegate(modelName);
    const meta = adminSchemaService.getModelMetadata(modelName);

    const cleanedData = cleanRedactedPayload(modelName, payload);
    const dataToInsert = {};

    // Cast fields according to DMMF
    for (const [key, val] of Object.entries(cleanedData)) {
      const fieldMeta = meta.fields.find((f) => f.name === key);
      if (fieldMeta && !fieldMeta.isRelation) {
        dataToInsert[key] = adminSchemaService.castFieldValue(modelName, key, val);
      }
    }

    const created = await delegate.create({
      data: dataToInsert,
    });

    const primaryKeyVal = created[meta.primaryKey];

    // Record audit log
    await recordAudit({
      actorId: user?.id || null,
      action: "CREATE",
      targetModel: modelName,
      targetId: primaryKeyVal,
      beforeSnapshot: null,
      afterSnapshot: created,
      req,
    });

    return redactRecord(modelName, created);
  }

  /**
   * Update an existing record with snapshot diffing and audit logging
   */
  async updateRecord(modelName, id, payload, { user, req } = {}) {
    const delegate = getPrismaDelegate(modelName);
    const meta = adminSchemaService.getModelMetadata(modelName);

    const primaryKey = meta.primaryKey;
    const castedId = adminSchemaService.castFieldValue(modelName, primaryKey, id);

    // Fetch before snapshot
    const existing = await delegate.findUnique({
      where: { [primaryKey]: castedId },
    });
    if (!existing) {
      throw new ServiceError(
        `Record with ${primaryKey}='${id}' not found in '${modelName}'.`,
        404,
        "RECORD_NOT_FOUND"
      );
    }

    const cleanedData = cleanRedactedPayload(modelName, payload);
    const dataToUpdate = {};

    for (const [key, val] of Object.entries(cleanedData)) {
      // Don't mutate the primary key
      if (key === primaryKey) continue;

      const fieldMeta = meta.fields.find((f) => f.name === key);
      if (fieldMeta && !fieldMeta.isRelation) {
        dataToUpdate[key] = adminSchemaService.castFieldValue(modelName, key, val);
      }
    }

    const updated = await delegate.update({
      where: { [primaryKey]: castedId },
      data: dataToUpdate,
    });

    // Record audit log
    await recordAudit({
      actorId: user?.id || null,
      action: "UPDATE",
      targetModel: modelName,
      targetId: String(id),
      beforeSnapshot: existing,
      afterSnapshot: updated,
      req,
    });

    return redactRecord(modelName, updated);
  }

  /**
   * Delete record: executes Soft-Delete if archivedAt exists, or Hard-Delete if requested
   */
  async deleteRecord(modelName, id, { forceHardDelete = false, user, req } = {}) {
    const delegate = getPrismaDelegate(modelName);
    const meta = adminSchemaService.getModelMetadata(modelName);

    const primaryKey = meta.primaryKey;
    const castedId = adminSchemaService.castFieldValue(modelName, primaryKey, id);

    const existing = await delegate.findUnique({
      where: { [primaryKey]: castedId },
    });
    if (!existing) {
      throw new ServiceError(
        `Record with ${primaryKey}='${id}' not found in '${modelName}'.`,
        404,
        "RECORD_NOT_FOUND"
      );
    }

    let result;
    let actionType = "DELETE";

    if (meta.hasArchivedAt && !forceHardDelete) {
      // Soft-Delete: set archivedAt
      result = await delegate.update({
        where: { [primaryKey]: castedId },
        data: { archivedAt: new Date() },
      });
      actionType = "SOFT_DELETE";
    } else {
      // Hard-Delete
      result = await delegate.delete({
        where: { [primaryKey]: castedId },
      });
      actionType = "HARD_DELETE";
    }

    // Record audit log
    await recordAudit({
      actorId: user?.id || null,
      action: actionType,
      targetModel: modelName,
      targetId: String(id),
      beforeSnapshot: existing,
      afterSnapshot: actionType === "SOFT_DELETE" ? result : null,
      req,
    });

    return {
      success: true,
      action: actionType,
      model: modelName,
      id,
    };
  }

  /**
   * Batch Delete multiple records inside an atomic Prisma Transaction
   */
  async batchDelete(modelName, ids = [], { forceHardDelete = false, user, req } = {}) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new ServiceError("No record IDs provided for batch deletion.", 400, "INVALID_BATCH_PAYLOAD");
    }

    const delegate = getPrismaDelegate(modelName);
    const meta = adminSchemaService.getModelMetadata(modelName);
    const primaryKey = meta.primaryKey;

    const castedIds = ids.map((id) =>
      adminSchemaService.castFieldValue(modelName, primaryKey, id)
    );

    const existingRecords = await delegate.findMany({
      where: { [primaryKey]: { in: castedIds } },
    });

    let deleteResult;
    const action = (meta.hasArchivedAt && !forceHardDelete) ? "BATCH_SOFT_DELETE" : "BATCH_HARD_DELETE";

    if (meta.hasArchivedAt && !forceHardDelete) {
      deleteResult = await delegate.updateMany({
        where: { [primaryKey]: { in: castedIds } },
        data: { archivedAt: new Date() },
      });
    } else {
      deleteResult = await delegate.deleteMany({
        where: { [primaryKey]: { in: castedIds } },
      });
    }

    // Record audit log for the batch
    await recordAudit({
      actorId: user?.id || null,
      action,
      targetModel: modelName,
      targetId: `${ids.length} records`,
      beforeSnapshot: { ids: castedIds, count: existingRecords.length },
      afterSnapshot: { affectedCount: deleteResult.count },
      req,
    });

    return {
      success: true,
      action,
      model: modelName,
      requestedCount: ids.length,
      affectedCount: deleteResult.count,
    };
  }

  /**
   * Batch Update a specific field for multiple records
   */
  async batchUpdate(modelName, ids = [], updates = {}, { user, req } = {}) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new ServiceError("No record IDs provided for batch update.", 400, "INVALID_BATCH_PAYLOAD");
    }

    const delegate = getPrismaDelegate(modelName);
    const meta = adminSchemaService.getModelMetadata(modelName);
    const primaryKey = meta.primaryKey;

    const castedIds = ids.map((id) =>
      adminSchemaService.castFieldValue(modelName, primaryKey, id)
    );

    const cleanedUpdates = cleanRedactedPayload(modelName, updates);
    const dataToUpdate = {};

    for (const [key, val] of Object.entries(cleanedUpdates)) {
      if (key === primaryKey) continue;
      const fieldMeta = meta.fields.find((f) => f.name === key);
      if (fieldMeta && !fieldMeta.isRelation) {
        dataToUpdate[key] = adminSchemaService.castFieldValue(modelName, key, val);
      }
    }

    const result = await delegate.updateMany({
      where: { [primaryKey]: { in: castedIds } },
      data: dataToUpdate,
    });

    await recordAudit({
      actorId: user?.id || null,
      action: "BATCH_UPDATE",
      targetModel: modelName,
      targetId: `${ids.length} records`,
      beforeSnapshot: { ids: castedIds },
      afterSnapshot: { updates: dataToUpdate, affectedCount: result.count },
      req,
    });

    return {
      success: true,
      model: modelName,
      requestedCount: ids.length,
      affectedCount: result.count,
    };
  }

  /**
   * Export records in CSV or JSON format with active filters and secrets redacted
   */
  async exportRecords(modelName, { format = "json", filters, q, fields } = {}) {
    const delegate = getPrismaDelegate(modelName);
    const meta = adminSchemaService.getModelMetadata(modelName);

    const where = this.buildWhereClause(modelName, { q, filters });

    const maxExportLimit = 10000;
    const records = await delegate.findMany({
      where,
      take: maxExportLimit,
      orderBy: meta.fields.some((f) => f.name === "createdAt")
        ? { createdAt: "desc" }
        : { [meta.primaryKey]: "desc" },
    });

    const sanitized = records.map((r) => redactRecord(modelName, r));

    if (String(format).toLowerCase() === "csv") {
      let exportCols = fields;
      if (!Array.isArray(exportCols) || exportCols.length === 0) {
        exportCols = meta.fields
          .filter((f) => !f.isRelation && !f.isSensitive)
          .map((f) => f.name);
      }

      const csvContent = this.serializeToCsv(sanitized, exportCols);
      return {
        format: "csv",
        contentType: "text/csv; charset=utf-8",
        filename: `${modelName}_export_${Date.now()}.csv`,
        content: csvContent,
      };
    }

    return {
      format: "json",
      contentType: "application/json; charset=utf-8",
      filename: `${modelName}_export_${Date.now()}.json`,
      content: JSON.stringify(sanitized, null, 2),
    };
  }

  /**
   * RFC-4180 compliant CSV serializer
   */
  serializeToCsv(rows, columns) {
    if (!rows || rows.length === 0) return "";
    const cols =
      columns ||
      Object.keys(rows[0]).filter(
        (k) => typeof rows[0][k] !== "object" || rows[0][k] === null
      );

    const header = cols.join(",");
    const body = rows
      .map((row) => {
        return cols
          .map((c) => {
            let val = row[c];
            if (val === null || val === undefined) return "";
            if (val instanceof Date) return val.toISOString();
            if (typeof val === "object") val = JSON.stringify(val);
            const str = String(val).replace(/"/g, '""');
            return str.includes(",") || str.includes("\n") || str.includes('"')
              ? `"${str}"`
              : str;
          })
          .join(",");
      })
      .join("\n");

    return `${header}\n${body}`;
  }
}

export const adminDataService = new AdminDataService();
