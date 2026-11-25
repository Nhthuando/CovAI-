import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const SQL_KEYWORDS = new Set([
  "select",
  "from",
  "where",
  "order",
  "by",
  "group",
  "having",
  "limit",
  "offset",
  "insert",
  "into",
  "values",
  "update",
  "set",
  "delete",
  "and",
  "or",
  "not",
  "null",
  "true",
  "false",
  "asc",
  "desc",
  "join",
  "left",
  "right",
  "inner",
  "outer",
  "on",
  "as",
  "in",
  "like",
  "is",
  "between",
  "distinct",
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "default",
  "primary",
  "key",
  "table",
  "create",
  "if",
  "exists",
  "returning",
  "cascade",
  "restrict",
  "references",
  "foreign",
  "unique",
  "index",
  "constraint",
  "alter",
  "drop",
  "add",
  "column",
]);

/**
 * Parses a Prisma schema file and extracts required scalar fields, enums, relations,
 * unique constraints, and types per model.
 *
 * @param {string} schemaContent
 * @returns {Record<string, any>} Map of model definitions and metadata
 */
export const parsePrismaSchemaModels = (schemaContent) => {
  if (!schemaContent || typeof schemaContent !== "string") return {};
  const models = {};

  // Collect enum blocks so enum-typed fields are treated as scalars with valid enum options
  const declaredEnums = new Map();
  const enumBlocks = schemaContent.match(/enum\s+(\w+)\s*\{([^}]+)\}/g) || [];
  for (const block of enumBlocks) {
    const match = block.match(/enum\s+(\w+)\s*\{([^}]+)\}/);
    if (!match) continue;
    const enumName = match[1];
    const values = match[2]
      .split("\n")
      .map((l) => l.trim())
      .filter(
        (l) =>
          l &&
          !l.startsWith("//") &&
          !l.startsWith("@@") &&
          /^[A-Za-z_]\w*$/.test(l),
      );
    if (values.length > 0) {
      declaredEnums.set(enumName, values);
    }
  }

  const modelBlocks = schemaContent.match(/model\s+(\w+)\s*\{([^}]+)\}/g) || [];

  // First pass: collect model names
  const declaredModels = new Set();
  for (const block of modelBlocks) {
    const m = block.match(/model\s+(\w+)/);
    if (m) declaredModels.add(m[1]);
  }

  for (const block of modelBlocks) {
    const match = block.match(/model\s+(\w+)\s*\{([^}]+)\}/);
    if (!match) continue;
    const rawModelName = match[1];
    const modelName = rawModelName.toLowerCase();
    const body = match[2];
    const lines = body.split("\n");
    const requiredFields = [];
    const fieldTypes = {};
    const fieldEnums = {};
    const optionalFields = [];
    const defaultFields = [];
    const uniqueFields = [];
    const relations = {};
    let idField = "id";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@"))
        continue;
      const tokens = trimmed.split(/\s+/);
      if (tokens.length >= 2) {
        const fieldName = tokens[0];
        const rawType = tokens[1];
        const isOptional = rawType.endsWith("?");
        const isList = rawType.endsWith("[]");
        const baseType = rawType.replace("?", "").replace("[]", "");
        const isId = trimmed.includes("@id");
        const isUnique = trimmed.includes("@unique");
        const hasDefault =
          trimmed.includes("@default") || trimmed.includes("@updatedAt");
        const isBuiltinScalar =
          /^(String|Int|Float|Boolean|DateTime|Json|Decimal|BigInt|Bytes)/.test(
            baseType,
          );
        const isEnumScalar = declaredEnums.has(baseType);
        const isScalar = isBuiltinScalar || isEnumScalar;

        if (isId) {
          idField = fieldName;
          uniqueFields.push(fieldName);
        }
        if (isUnique && !uniqueFields.includes(fieldName)) {
          uniqueFields.push(fieldName);
        }

        if (isScalar) {
          fieldTypes[fieldName] = isEnumScalar ? "String" : baseType;
          if (isEnumScalar) {
            fieldEnums[fieldName] = declaredEnums.get(baseType);
          }
          if (isId || hasDefault) {
            defaultFields.push(fieldName);
          } else if (isOptional) {
            optionalFields.push(fieldName);
          } else {
            requiredFields.push(fieldName);
          }
        } else if (declaredModels.has(baseType)) {
          const fkMatch = trimmed.match(/fields:\s*\[([^\]]+)\]/);
          const refMatch = trimmed.match(/references:\s*\[([^\]]+)\]/);
          relations[fieldName] = {
            targetModel: baseType,
            targetModelLower: baseType.toLowerCase(),
            isList,
            foreignKey: fkMatch ? fkMatch[1].split(",")[0].trim() : null,
            referenceKey: refMatch ? refMatch[1].split(",")[0].trim() : "id",
          };
        }
      }
    }
    models[modelName] = requiredFields;
    models["__meta_" + modelName] = {
      canonicalName: rawModelName,
      idField,
      uniqueFields,
      required: requiredFields,
      types: fieldTypes,
      enums: fieldEnums,
      optional: optionalFields,
      defaults: defaultFields,
      relations,
    };
  }
  return models;
};

/**
 * Generates relational sample seed records tailored to parsed Prisma models.
 * Ensures related tables share valid foreign keys and realistic domain values.
 *
 * @param {Record<string, any>} schemaModels
 * @returns {Record<string, Array<object>>}
 */
export const generatePrismaSeeds = (schemaModels = {}) => {
  const seeds = {};
  const modelKeys = Object.keys(schemaModels).filter(
    (k) => !k.startsWith("__meta_"),
  );

  for (const modelKey of modelKeys) {
    const meta = schemaModels["__meta_" + modelKey];
    if (!meta) continue;
    const idField = meta.idField || "id";
    const idType = meta.types?.[idField] || "Int";
    const rows = [];
    const count = 4;
    const isClassModel = /lop|class/i.test(modelKey);
    const isStudentModel = /sinhvien|student/i.test(modelKey);

    for (let i = 0; i < count; i++) {
      const idVal = idType === "String" ? `${modelKey}-${i + 1}` : i + 1;
      const row = { [idField]: idVal, id: idVal };
      for (const [fName, type] of Object.entries(meta.types || {})) {
        if (fName === idField || fName === "id") continue;
        const lower = fName.toLowerCase();
        const enumVals = meta.enums?.[fName];
        if (Array.isArray(enumVals) && enumVals.length > 0) {
          row[fName] = enumVals[i % enumVals.length];
          continue;
        }
        if (type === "String") {
          if (isClassModel && /malop|code|id/i.test(lower)) {
            row[fName] = ["CNTT01", "CNTT02", "KTPM01", "KHMT01"][i];
          } else if (isClassModel && /tenlop|name|title/i.test(lower)) {
            row[fName] = [
              "Computer Science 01",
              "Computer Science 02",
              "Software Engineering 01",
              "Data Science 01",
            ][i];
          } else if (isStudentModel && /hoten|fullname|name/i.test(lower)) {
            row[fName] = [
              "Alice Smith",
              "Bob Jones",
              "Charlie Brown",
              "Diana Prince",
            ][i];
          } else if (isStudentModel && /malop|class/i.test(lower)) {
            row[fName] = ["CNTT01", "CNTT01", "CNTT02", "KTPM01"][i];
          } else if (/hoten|fullname|author|username/.test(lower)) {
            row[fName] = [
              "Alice Smith",
              "Bob Jones",
              "Charlie Brown",
              "Diana Prince",
            ][i];
          } else if (/ma|code|sku|slug/.test(lower)) {
            row[fName] = "CODE0" + (i + 1);
          } else if (/ten|name|title|subject/.test(lower)) {
            row[fName] = (meta.canonicalName || modelKey) + " " + (i + 1);
          } else if (/email/.test(lower)) {
            row[fName] = "user" + (i + 1) + "@example.com";
          } else if (/password|hash/.test(lower)) {
            row[fName] =
              "$2b$10$CwTycUXWue0Thq9StjUM0uJ8D0R/7F.b4m3/6p1l2n8e9k0a1b2c3";
          } else if (/role/.test(lower)) {
            row[fName] = i === 0 ? "ADMIN" : "USER";
          } else if (/status|state/.test(lower)) {
            row[fName] = "ACTIVE";
          } else if (/url|link|avatar|image/.test(lower)) {
            row[fName] = `https://example.com/${modelKey}/${i + 1}`;
          } else if (/phone|tel/.test(lower)) {
            row[fName] = "090123456" + i;
          } else if (/gioitinh|gender/.test(lower)) {
            row[fName] = i % 2 === 0 ? "Male" : "Female";
          } else {
            row[fName] = fName + "_" + (i + 1);
          }
        } else if (
          type === "Int" ||
          type === "Float" ||
          type === "Decimal" ||
          type === "BigInt"
        ) {
          if (/diem|score|rating|grade/.test(lower)) {
            row[fName] = [8.5, 9.2, 6.8, 4.5][i];
          } else if (/gia|price|amount|cost|total|salary/.test(lower)) {
            row[fName] = (i + 1) * 50000;
          } else if (/soluong|quantity|stock|count|age|views/.test(lower)) {
            row[fName] = [10, 25, 50, 100][i];
          } else {
            row[fName] = i + 1;
          }
        } else if (type === "DateTime") {
          row[fName] = new Date(
            "2025-0" + (i + 1) + "-15T00:00:00.000Z",
          ).toISOString();
        } else if (type === "Boolean") {
          row[fName] = i % 2 === 0;
        } else if (type === "Json") {
          row[fName] = {};
        }
      }
      rows.push(row);
    }
    seeds[modelKey] = rows;
  }

  // Second pass: link foreign keys to parents
  for (const modelKey of modelKeys) {
    const meta = schemaModels["__meta_" + modelKey];
    if (!meta || !meta.relations) continue;
    for (const [, rel] of Object.entries(meta.relations)) {
      if (!rel.isList && seeds[rel.targetModelLower]) {
        const parentSeeds = seeds[rel.targetModelLower];
        const parentMeta = schemaModels["__meta_" + rel.targetModelLower];
        if (rel.foreignKey && parentSeeds.length > 0) {
          const refKey = rel.referenceKey || parentMeta?.idField || "id";
          seeds[modelKey].forEach((row, idx) => {
            const parent = parentSeeds[idx % parentSeeds.length];
            if (parent && parent[refKey] !== undefined) {
              row[rel.foreignKey] = parent[refKey];
            }
          });
        } else if (parentMeta?.uniqueFields) {
          for (const uField of parentMeta.uniqueFields) {
            if (meta.types && meta.types[uField]) {
              seeds[modelKey].forEach((row, idx) => {
                const parent = parentSeeds[idx % parentSeeds.length];
                if (parent && parent[uField] !== undefined) {
                  row[uField] = parent[uField];
                }
              });
            }
          }
        }
      }
    }
  }

  return seeds;
};

/**
 * Walks candidate source files in a project root up to a bounded limit.
 */
const collectProjectSourceFiles = (rootDir, maxFiles = 200) => {
  if (!rootDir || !fs.existsSync(rootDir)) return [];
  const ignored = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    ".covai",
    ".covai-temp",
    ".covai-system-test",
    ".next",
  ]);
  const results = [];
  const walk = (dir, depth = 0) => {
    if (depth > 5 || results.length >= maxFiles) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      if (entry.isSymbolicLink() || ignored.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (
        entry.isFile() &&
        /\.(?:[cm]?js|ts|sql)$/i.test(entry.name) &&
        !/\.(?:test|spec)\./i.test(entry.name)
      ) {
        try {
          const stat = fs.statSync(full);
          if (stat.size <= 100000) {
            results.push({
              fullPath: full,
              relPath: path.relative(rootDir, full).replace(/\\/g, "/"),
              content: fs.readFileSync(full, "utf8"),
            });
          }
        } catch {}
      }
    }
  };
  walk(rootDir);
  return results;
};

/**
 * Extracts Mongoose model schemas and generates realistic seed documents from source files.
 */
export const parseMongooseSchemaModels = (rootDir, preloadedFiles = null) => {
  const files = preloadedFiles || collectProjectSourceFiles(rootDir);
  const models = {};
  const seeds = {};

  const extractFieldsFromSchemaBody = (body = "") => {
    const fields = {};
    const required = [];
    // Match field: { type: String, ... } or field: String
    const propRegex =
      /(?:^|[,{]\s*)([A-Za-z_]\w*)\s*:\s*(\{[^}]*\}|\[[^\]]*\]|String|Number|Boolean|Date|ObjectId|mongoose\.Schema\.Types\.ObjectId|Schema\.Types\.ObjectId)/gm;
    let match;
    while ((match = propRegex.exec(body)) !== null) {
      const fieldName = match[1];
      const rhs = match[2];
      if (
        [
          "type",
          "required",
          "default",
          "enum",
          "ref",
          "unique",
          "trim",
          "lowercase",
          "timestamps",
        ].includes(fieldName)
      )
        continue;
      let type = "String";
      if (/Number/i.test(rhs)) type = "Number";
      else if (/Boolean/i.test(rhs)) type = "Boolean";
      else if (/Date/i.test(rhs)) type = "Date";
      else if (/ObjectId/i.test(rhs)) type = "ObjectId";
      else if (rhs.startsWith("[")) type = "Array";

      const enumMatch = rhs.match(/enum\s*:\s*\[([^\]]+)\]/);
      const enumValues = enumMatch
        ? enumMatch[1]
            .split(",")
            .map((s) => s.trim().replace(/^['"`]|['"`]$/g, ""))
            .filter(Boolean)
        : null;
      if (/required\s*:\s*(?:true|\[true)/i.test(rhs)) {
        required.push(fieldName);
      }
      fields[fieldName] = { type, enumValues };
    }
    return { fields, required };
  };

  for (const file of files) {
    if (!/mongoose|Schema/i.test(file.content)) continue;
    const schemaVars = new Map();
    const schemaDeclRegex =
      /(?:const|let|var)\s+(\w+)\s*=\s*new\s+(?:mongoose\.)?Schema\s*\(\s*\{([\s\S]*?)\}\s*(?:,|\))/g;
    let sMatch;
    while ((sMatch = schemaDeclRegex.exec(file.content)) !== null) {
      schemaVars.set(sMatch[1], extractFieldsFromSchemaBody(sMatch[2]));
    }

    const modelRegex =
      /mongoose\.model(?:<[^>]+>)?\s*\(\s*['"`](\w+)['"`]\s*(?:,\s*(\w+|new\s+(?:mongoose\.)?Schema\s*\(\s*\{[\s\S]*?\}\s*(?:,|\))))?/g;
    let mMatch;
    while ((mMatch = modelRegex.exec(file.content)) !== null) {
      const rawName = mMatch[1];
      const schemaArg = mMatch[2] || "";
      let parsed = schemaVars.get(schemaArg);
      if (!parsed && schemaArg.startsWith("new")) {
        const bodyMatch = schemaArg.match(/\{([\s\S]*)\}/);
        parsed = extractFieldsFromSchemaBody(bodyMatch ? bodyMatch[1] : "");
      }
      if (!parsed && schemaVars.size === 1) {
        parsed = [...schemaVars.values()][0];
      }
      parsed = parsed || {
        fields: { name: { type: "String" }, status: { type: "String" } },
        required: [],
      };
      models[rawName] = parsed;
    }
  }

  // Build 4 seed documents per Mongoose model
  const hexSuffixes = ["ea", "eb", "ec", "ed"];
  for (const [modelName, meta] of Object.entries(models)) {
    const docs = [];
    for (let i = 0; i < 4; i++) {
      const oid = `507f191e810c19729de860${hexSuffixes[i]}`;
      const doc = { _id: oid, id: oid };
      for (const [fName, fMeta] of Object.entries(meta.fields || {})) {
        if (fName === "_id" || fName === "id") continue;
        const lower = fName.toLowerCase();
        if (Array.isArray(fMeta.enumValues) && fMeta.enumValues.length > 0) {
          doc[fName] = fMeta.enumValues[i % fMeta.enumValues.length];
        } else if (fMeta.type === "Number") {
          doc[fName] = /price|amount|cost|total/.test(lower)
            ? (i + 1) * 100
            : i + 1;
        } else if (fMeta.type === "Boolean") {
          doc[fName] = i % 2 === 0;
        } else if (fMeta.type === "Date") {
          doc[fName] = new Date(
            `2025-0${i + 1}-15T00:00:00.000Z`,
          ).toISOString();
        } else if (fMeta.type === "ObjectId") {
          doc[fName] = `507f191e810c19729de860${hexSuffixes[0]}`;
        } else if (fMeta.type === "Array") {
          doc[fName] = [];
        } else if (/email/.test(lower)) {
          doc[fName] = `user${i + 1}@example.com`;
        } else if (/password|hash/.test(lower)) {
          doc[fName] =
            "$2b$10$CwTycUXWue0Thq9StjUM0uJ8D0R/7F.b4m3/6p1l2n8e9k0a1b2c3";
        } else if (/name|title|username/.test(lower)) {
          doc[fName] = `${modelName} ${i + 1}`;
        } else if (/role/.test(lower)) {
          doc[fName] = i === 0 ? "admin" : "user";
        } else if (/status/.test(lower)) {
          doc[fName] = "ACTIVE";
        } else if (/url|link|image/.test(lower)) {
          doc[fName] =
            `https://example.com/${modelName.toLowerCase()}/${i + 1}`;
        } else {
          doc[fName] = `${fName}_${i + 1}`;
        }
      }
      if (!doc.name && !doc.title && !doc.email) {
        doc.name = `Sample ${modelName} ${i + 1}`;
      }
      docs.push(doc);
    }
    seeds[modelName] = docs;
  }

  return { mongooseModels: models, mongooseSeeds: seeds };
};

/**
 * Extracts SQL tables & columns from .sql files or inline SQL/Sequelize/Drizzle definitions
 * and builds deterministic seed rows.
 */
export const parseSqlSchemaTables = (rootDir, preloadedFiles = null) => {
  const files = preloadedFiles || collectProjectSourceFiles(rootDir);
  const tables = {};
  const seeds = {};

  const ensureTable = (rawName) => {
    const name = String(rawName || "")
      .trim()
      .replace(/^["`]|["`]$/g, "")
      .toLowerCase();
    if (!name || !/^[a-z_]\w*$/i.test(name) || SQL_KEYWORDS.has(name))
      return null;
    if (!tables[name]) {
      tables[name] = { idField: "id", columns: { id: "INT" } };
    }
    return tables[name];
  };

  const addColumn = (tableName, rawCol, rawType = "VARCHAR") => {
    const tbl = ensureTable(tableName);
    const col = String(rawCol || "")
      .trim()
      .replace(/^["`]|["`]$/g, "");
    if (
      !tbl ||
      !col ||
      !/^[A-Za-z_]\w*$/.test(col) ||
      SQL_KEYWORDS.has(col.toLowerCase())
    )
      return;
    if (!tbl.columns[col]) {
      tbl.columns[col] = rawType.toUpperCase();
    }
  };

  const combined = files.map((f) => f.content).join("\n");

  // 1. Parse CREATE TABLE blocks
  const createRegex =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?\s*\(([\s\S]*?)\)\s*;/gi;
  let cMatch;
  while ((cMatch = createRegex.exec(combined)) !== null) {
    const tableName = cMatch[1];
    const body = cMatch[2];
    ensureTable(tableName);
    for (const line of body.split(",")) {
      const trimmed = line.trim();
      if (
        !trimmed ||
        /^(?:PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|INDEX|KEY|CHECK)\b/i.test(
          trimmed,
        )
      )
        continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        addColumn(tableName, parts[0], parts[1]);
      }
    }
  }

  // 2. Parse INSERT INTO, UPDATE, SELECT ... FROM, sequelize.define
  for (const match of combined.matchAll(
    /INSERT\s+INTO\s+["`]?(\w+)["`]?\s*\(([^)]+)\)/gi,
  )) {
    for (const col of match[2].split(",")) addColumn(match[1], col);
  }
  for (const match of combined.matchAll(
    /UPDATE\s+["`]?(\w+)["`]?\s+SET\s+([\s\S]+?)(?:\bWHERE\b|['"`]|;|$)/gi,
  )) {
    for (const assign of match[2].split(",")) {
      const col = assign.split("=")[0];
      if (col) addColumn(match[1], col);
    }
  }
  for (const match of combined.matchAll(
    /(?:SELECT\s+([\w\s,*`"']+)\s+FROM|DELETE\s+FROM)\s+["`]?(\w+)["`]?([^;'"`]*)/gi,
  )) {
    const selectList = match[1] || "";
    const table = match[2];
    const tail = match[3] || "";
    ensureTable(table);
    for (const part of selectList.split(",")) {
      const token = part.trim().split(/\s+/)[0];
      if (token && token !== "*") addColumn(table, token);
    }
    for (const whereCol of tail.matchAll(
      /\b([A-Za-z_]\w*)\s*(?:=|<|>|<=|>=|<>|!=|\bIN\b|\bLIKE\b)/gi,
    )) {
      addColumn(table, whereCol[1]);
    }
  }
  for (const match of combined.matchAll(
    /(?:createTable|(?:pg|mysql)Table|sequelize\.define)\s*\(\s*['"`](\w+)['"`]\s*,\s*([\s\S]*?)\)/gi,
  )) {
    const table = match[1];
    const body = match[2] || "";
    ensureTable(table);
    for (const prop of body.matchAll(
      /(?:^\s*|\btable\.\w+\s*\(\s*['"`])([A-Za-z_]\w*)(?:['"`]|\s*:)/gm,
    )) {
      addColumn(table, prop[1]);
    }
  }

  // Generate 4 seed rows per SQL table
  for (const [tableName, meta] of Object.entries(tables)) {
    const rows = [];
    for (let i = 0; i < 4; i++) {
      const row = { id: i + 1 };
      for (const [col, colType] of Object.entries(meta.columns)) {
        if (col === "id") continue;
        const lower = col.toLowerCase();
        if (
          /^(?:is_|has_|completed|done|active|enabled|published|verified)/i.test(
            lower,
          ) ||
          /BOOL/i.test(colType)
        ) {
          row[col] = i % 2 === 0;
        } else if (
          /(?:^|_)(?:at|date|time|timestamp)$/i.test(lower) ||
          /DATE|TIME/i.test(colType)
        ) {
          row[col] = new Date(`2025-0${i + 1}-15T00:00:00.000Z`).toISOString();
        } else if (
          /(?:_id$|^count$|^quantity$|^amount$|^total$|^score$|^price$|^cost$|^age$)/i.test(
            lower,
          ) ||
          /INT|DECIMAL|NUMERIC|FLOAT|DOUBLE|SERIAL/i.test(colType)
        ) {
          row[col] = /_id$/i.test(lower) ? 1 : (i + 1) * 10;
        } else if (/email/i.test(lower)) {
          row[col] = `user${i + 1}@example.com`;
        } else if (/name|title|username/i.test(lower)) {
          row[col] = `${tableName}_${i + 1}`;
        } else if (/status/i.test(lower)) {
          row[col] = "ACTIVE";
        } else {
          row[col] = `${col}_${i + 1}`;
        }
      }
      rows.push(row);
    }
    seeds[tableName] = rows;
  }

  return { sqlTables: tables, sqlSeeds: seeds };
};

/**
 * Detects database frameworks in the target project by inspecting package.json
 * in the root directory and common candidate subdirectories (server, backend, api, app).
 *
 * @param {string} rootDir
 * @returns {{ hasPrisma: boolean, hasMongoose: boolean, hasSequelize: boolean, hasSql: boolean, hasRedis: boolean, primaryType: string, prismaModels?: Record<string, any>, prismaSeeds?: Record<string, Array<object>>, mongooseModels?: Record<string, any>, mongooseSeeds?: Record<string, Array<object>>, sqlTables?: Record<string, any>, sqlSeeds?: Record<string, Array<object>> }}
 */
export const detectProjectDatabase = (rootDir) => {
  const result = {
    hasPrisma: false,
    hasMongoose: false,
    hasSequelize: false,
    hasSql: false,
    hasRedis: false,
    primaryType: "NONE",
    prismaModels: {},
    prismaSeeds: {},
    mongooseModels: {},
    mongooseSeeds: {},
    sqlTables: {},
    sqlSeeds: {},
  };

  if (!rootDir || typeof rootDir !== "string" || !fs.existsSync(rootDir)) {
    return result;
  }

  const candidateDirs = ["", "server", "backend", "api", "app", "src"];
  const allDependencies = new Set();

  for (const cand of candidateDirs) {
    const pkgPath = cand
      ? path.join(rootDir, cand, "package.json")
      : path.join(rootDir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        const deps = {
          ...(pkg.dependencies || {}),
          ...(pkg.devDependencies || {}),
        };
        Object.keys(deps).forEach((d) => allDependencies.add(d.toLowerCase()));
      } catch (_) {}
    }
  }

  const schemaCandidates = [
    path.join(rootDir, "prisma", "schema.prisma"),
    path.join(rootDir, "server", "prisma", "schema.prisma"),
    path.join(rootDir, "backend", "prisma", "schema.prisma"),
    path.join(rootDir, "schema.prisma"),
    path.join(rootDir, "server", "schema.prisma"),
  ];
  let foundSchemaPath = null;
  for (const p of schemaCandidates) {
    if (fs.existsSync(p)) {
      foundSchemaPath = p;
      break;
    }
  }

  result.hasPrisma =
    allDependencies.has("@prisma/client") ||
    allDependencies.has("prisma") ||
    !!foundSchemaPath;
  if (foundSchemaPath) {
    try {
      const schemaContent = fs.readFileSync(foundSchemaPath, "utf8");
      result.prismaModels = parsePrismaSchemaModels(schemaContent);
      result.prismaSeeds = generatePrismaSeeds(result.prismaModels);
    } catch (_) {}
  }

  result.hasMongoose =
    allDependencies.has("mongoose") || allDependencies.has("mongodb");
  result.hasSequelize = allDependencies.has("sequelize");
  result.hasSql =
    allDependencies.has("pg") ||
    allDependencies.has("postgres") ||
    allDependencies.has("mysql") ||
    allDependencies.has("mysql2") ||
    allDependencies.has("sqlite3") ||
    allDependencies.has("better-sqlite3") ||
    allDependencies.has("knex") ||
    allDependencies.has("typeorm") ||
    allDependencies.has("drizzle-orm");
  result.hasRedis =
    allDependencies.has("redis") ||
    allDependencies.has("ioredis") ||
    allDependencies.has("bull") ||
    allDependencies.has("bullmq");

  let sourceFiles = null;
  if (result.hasMongoose) {
    sourceFiles = sourceFiles || collectProjectSourceFiles(rootDir);
    const parsedMongoose = parseMongooseSchemaModels(rootDir, sourceFiles);
    result.mongooseModels = parsedMongoose.mongooseModels;
    result.mongooseSeeds = parsedMongoose.mongooseSeeds;
  }

  if (result.hasSql || result.hasSequelize) {
    sourceFiles = sourceFiles || collectProjectSourceFiles(rootDir);
    const parsedSql = parseSqlSchemaTables(rootDir, sourceFiles);
    result.sqlTables = parsedSql.sqlTables;
    result.sqlSeeds = parsedSql.sqlSeeds;
  }

  if (result.hasPrisma) {
    result.primaryType = "PRISMA";
  } else if (result.hasMongoose) {
    result.primaryType = "MONGOOSE";
  } else if (result.hasSequelize) {
    result.primaryType = "SEQUELIZE";
  } else if (result.hasSql) {
    result.primaryType = "SQL";
  }

  return result;
};

/**
 * Generates the shared JavaScript source code for the stateful SQL, Sequelize, and Redis mocks.
 */
const buildSqlAndRedisMockSection = (
  dbInfo = {},
  { useJestFn = true } = {},
) => {
  const wrapFn = useJestFn
    ? "(impl) => (typeof jest !== 'undefined' && jest.fn ? jest.fn(impl) : impl)"
    : "(impl) => impl";

  return `
// 5. Schema-Aware In-Memory SQL (pg / mysql2 / sqlite) & Sequelize & Redis Mock
try {
  const _wrap = ${wrapFn};
  const _sqlTables = ${JSON.stringify(dbInfo.sqlTables || {})};
  const _sqlSeeds = ${JSON.stringify(dbInfo.sqlSeeds || {})};
  const _sqlStores = new Map();

  const _initSqlStores = () => {
    _sqlStores.clear();
    for (const [tbl, rows] of Object.entries(_sqlSeeds)) {
      _sqlStores.set(tbl.toLowerCase(), rows.map(r => ({ ...r })));
    }
  };
  _initSqlStores();

  const _prevReset = global.__covai_reset_mock_db__;
  global.__covai_reset_mock_db__ = () => {
    if (typeof _prevReset === 'function') _prevReset();
    _initSqlStores();
  };

  const _getSqlTableRows = (tableName) => {
    const key = String(tableName || 'items').replace(/^["\`]|["\`]$/g, '').toLowerCase();
    if (!_sqlStores.has(key)) {
      _sqlStores.set(key, [
        { id: 1, name: 'Sample ' + key + ' 1', title: 'Sample ' + key + ' 1', status: 'ACTIVE', created_at: new Date().toISOString() },
        { id: 2, name: 'Sample ' + key + ' 2', title: 'Sample ' + key + ' 2', status: 'ACTIVE', created_at: new Date().toISOString() }
      ]);
    }
    return _sqlStores.get(key);
  };

  const _executeMockSql = (sqlText, params = []) => {
    const sql = String(sqlText || '').trim();
    if (!sql) return { rows: [], rowCount: 0, insertId: 1, affectedRows: 0 };

    const selectCount = sql.match(/^SELECT\\s+COUNT\\s*\\([^)]*\\)\\s*(?:AS\\s+["\`]?(\\w+)["\`]?)?\\s+FROM\\s+["\`]?(\\w+)["\`]?/i);
    if (selectCount) {
      const alias = selectCount[1] || 'count';
      const rows = _getSqlTableRows(selectCount[2]);
      return { rows: [{ [alias]: rows.length, count: rows.length }], rowCount: 1, affectedRows: 0 };
    }

    const selectMatch = sql.match(/^SELECT\\s+[\\s\\S]+?\\s+FROM\\s+["\`]?(\\w+)["\`]?/i);
    if (selectMatch) {
      let rows = [..._getSqlTableRows(selectMatch[1])];
      if (/\\bWHERE\\b/i.test(sql) && params.length > 0) {
        const firstParam = params[0];
        const filtered = rows.filter(r => Object.values(r).some(v => String(v) == String(firstParam)));
        if (filtered.length > 0) rows = filtered;
      }
      return { rows, rowCount: rows.length, affectedRows: 0 };
    }

    const insertMatch = sql.match(/^INSERT\\s+INTO\\s+["\`]?(\\w+)["\`]?\\s*(?:\\(([^)]+)\\))?/i);
    if (insertMatch) {
      const rows = _getSqlTableRows(insertMatch[1]);
      const cols = insertMatch[2] ? insertMatch[2].split(',').map(c => c.trim().replace(/^["\`]|["\`]$/g, '')) : [];
      const nextId = rows.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1;
      const newRow = { id: nextId };
      cols.forEach((c, idx) => {
        if (params[idx] !== undefined) newRow[c] = params[idx];
      });
      rows.push(newRow);
      return { rows: [newRow], rowCount: 1, insertId: nextId, affectedRows: 1 };
    }

    const updateMatch = sql.match(/^UPDATE\\s+["\`]?(\\w+)["\`]?\\s+SET/i);
    if (updateMatch) {
      const rows = _getSqlTableRows(updateMatch[1]);
      return { rows: rows.slice(0, 1), rowCount: 1, affectedRows: 1 };
    }

    const deleteMatch = sql.match(/^DELETE\\s+FROM\\s+["\`]?(\\w+)["\`]?/i);
    if (deleteMatch) {
      const rows = _getSqlTableRows(deleteMatch[1]);
      const deleted = rows.length > 0 ? [rows.pop()] : [];
      return { rows: deleted, rowCount: deleted.length, affectedRows: deleted.length };
    }

    return { rows: [], rowCount: 0, insertId: 1, affectedRows: 0 };
  };

  // pg mock
  const createPgClientMock = () => ({
    connect: _wrap(async () => true),
    query: _wrap(async (text, values, cb) => {
      const actualValues = Array.isArray(values) ? values : [];
      const actualCb = typeof values === 'function' ? values : cb;
      const res = _executeMockSql(typeof text === 'object' ? text.text : text, typeof text === 'object' ? text.values : actualValues);
      if (typeof actualCb === 'function') actualCb(null, res);
      return res;
    }),
    release: _wrap(() => {}),
    end: _wrap(async () => {}),
    on: _wrap(() => {}),
  });

  const pgMock = {
    Pool: _wrap(function() {
      const client = createPgClientMock();
      return { ...client, connect: _wrap(async () => client), totalCount: 1, idleCount: 1, waitingCount: 0 };
    }),
    Client: _wrap(function() { return createPgClientMock(); }),
  };

  // mysql2 mock
  const createMysqlConnMock = () => {
    const queryFn = _wrap(async (sql, values, cb) => {
      const actualValues = Array.isArray(values) ? values : [];
      const actualCb = typeof values === 'function' ? values : cb;
      const res = _executeMockSql(typeof sql === 'object' ? sql.sql : sql, actualValues);
      const out = /^SELECT/i.test(String(typeof sql === 'object' ? sql.sql : sql).trim())
        ? [res.rows, []]
        : [{ insertId: res.insertId, affectedRows: res.affectedRows, changedRows: res.affectedRows }, []];
      if (typeof actualCb === 'function') actualCb(null, out[0], out[1]);
      return out;
    });
    const conn = {
      query: queryFn,
      execute: queryFn,
      getConnection: _wrap(async (cb) => { if (typeof cb === 'function') cb(null, conn); return conn; }),
      release: _wrap(() => {}),
      end: _wrap(async (cb) => { if (typeof cb === 'function') cb(null); }),
      destroy: _wrap(() => {}),
      beginTransaction: _wrap(async (cb) => { if (typeof cb === 'function') cb(null); }),
      commit: _wrap(async (cb) => { if (typeof cb === 'function') cb(null); }),
      rollback: _wrap(async (cb) => { if (typeof cb === 'function') cb(null); }),
      on: _wrap(() => {}),
      promise: () => conn,
    };
    return conn;
  };
  const mysqlMock = {
    createPool: _wrap(() => createMysqlConnMock()),
    createConnection: _wrap(() => createMysqlConnMock()),
    createPoolCluster: _wrap(() => ({ add: _wrap(() => {}), of: _wrap(() => createMysqlConnMock()) })),
  };

  // Redis / ioredis in-memory mock
  const _redisKv = new Map();
  const createRedisClientMock = () => {
    const client = {
      status: 'ready',
      isOpen: true,
      isReady: true,
      connect: _wrap(async () => client),
      disconnect: _wrap(async () => {}),
      quit: _wrap(async () => 'OK'),
      ping: _wrap(async () => 'PONG'),
      get: _wrap(async (k) => (_redisKv.has(k) ? _redisKv.get(k) : null)),
      set: _wrap(async (k, v) => { _redisKv.set(k, String(v)); return 'OK'; }),
      setEx: _wrap(async (k, _ttl, v) => { _redisKv.set(k, String(v)); return 'OK'; }),
      setex: _wrap(async (k, _ttl, v) => { _redisKv.set(k, String(v)); return 'OK'; }),
      del: _wrap(async (k) => (_redisKv.delete(k) ? 1 : 0)),
      exists: _wrap(async (k) => (_redisKv.has(k) ? 1 : 0)),
      expire: _wrap(async () => 1),
      ttl: _wrap(async () => 3600),
      incr: _wrap(async (k) => { const n = (Number(_redisKv.get(k)) || 0) + 1; _redisKv.set(k, String(n)); return n; }),
      decr: _wrap(async (k) => { const n = (Number(_redisKv.get(k)) || 0) - 1; _redisKv.set(k, String(n)); return n; }),
      hget: _wrap(async (k, f) => { const h = _redisKv.get(k); return h && typeof h === 'object' ? (h[f] ?? null) : null; }),
      hGet: _wrap(async (k, f) => { const h = _redisKv.get(k); return h && typeof h === 'object' ? (h[f] ?? null) : null; }),
      hset: _wrap(async (k, f, v) => { const h = (typeof _redisKv.get(k) === 'object' && _redisKv.get(k)) || {}; h[f] = v; _redisKv.set(k, h); return 1; }),
      hSet: _wrap(async (k, f, v) => { const h = (typeof _redisKv.get(k) === 'object' && _redisKv.get(k)) || {}; h[f] = v; _redisKv.set(k, h); return 1; }),
      hgetall: _wrap(async (k) => (typeof _redisKv.get(k) === 'object' ? _redisKv.get(k) : {})),
      hGetAll: _wrap(async (k) => (typeof _redisKv.get(k) === 'object' ? _redisKv.get(k) : {})),
      keys: _wrap(async () => Array.from(_redisKv.keys())),
      flushall: _wrap(async () => { _redisKv.clear(); return 'OK'; }),
      flushAll: _wrap(async () => { _redisKv.clear(); return 'OK'; }),
      publish: _wrap(async () => 1),
      subscribe: _wrap(async () => {}),
      duplicate: _wrap(() => createRedisClientMock()),
      multi: _wrap(() => ({ exec: _wrap(async () => []) })),
      pipeline: _wrap(() => ({ exec: _wrap(async () => []) })),
      on: _wrap((ev, cb) => { if (ev === 'ready' || ev === 'connect') { try { setImmediate(cb); } catch (_) {} } return client; }),
      once: _wrap(() => client),
      off: _wrap(() => client),
    };
    return client;
  };

  global.__covai_pg_mock__ = { default: pgMock, ...pgMock };
  global.__covai_mysql_mock__ = { default: mysqlMock, ...mysqlMock };
  const IoRedisCtor = _wrap(function() { return createRedisClientMock(); });
  IoRedisCtor.createClient = _wrap(() => createRedisClientMock());
  IoRedisCtor.default = IoRedisCtor;
  global.__covai_redis_mock__ = IoRedisCtor;

  if (typeof jest !== 'undefined' && typeof jest.mock === 'function') {
    try { jest.mock('pg', () => global.__covai_pg_mock__, { virtual: true }); } catch (_) {}
    try { jest.mock('mysql2', () => global.__covai_mysql_mock__, { virtual: true }); } catch (_) {}
    try { jest.mock('mysql2/promise', () => global.__covai_mysql_mock__, { virtual: true }); } catch (_) {}
    try { jest.mock('mysql', () => global.__covai_mysql_mock__, { virtual: true }); } catch (_) {}
    try { jest.mock('ioredis', () => global.__covai_redis_mock__, { virtual: true }); } catch (_) {}
    try { jest.mock('redis', () => global.__covai_redis_mock__, { virtual: true }); } catch (_) {}
  }
} catch (_) {}
`;
};

/**
 * Builds the code for covai.supertest.setup.js that configures environment variables,
 * suppresses teardown errors, and provides stateful in-memory mock proxies for Prisma,
 * Mongoose, SQL (pg/mysql2), and Redis.
 *
 * @param {{ hasPrisma?: boolean, hasMongoose?: boolean, hasSql?: boolean, hasSequelize?: boolean, hasRedis?: boolean, prismaModels?: object, prismaSeeds?: object, mongooseModels?: object, mongooseSeeds?: object, sqlTables?: object, sqlSeeds?: object }} dbInfo
 * @param {{ disableDatabaseMock?: boolean }} [options]
 * @returns {string} Setup script content
 */
export const generateSupertestSetupScript = (dbInfo = {}, options = {}) => {
  const disableDatabaseMock = Boolean(options?.disableDatabaseMock);
  return `// ====================================================================
// [CovAI Automated Supertest Setup${disableDatabaseMock ? " (Live Ephemeral DB Mode)" : " & Database Mock Environment"}]
// This file is auto-injected by CovAI to ensure integration tests run
// reliably in isolation${disableDatabaseMock ? " against a provisioned ephemeral database" : " without requiring live database services"}.
// ====================================================================

// 1. Establish deterministic test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = process.env.PORT || '0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'covai-test-jwt-secret-secure-key-123456789';
${
  disableDatabaseMock
    ? ""
    : `process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://covai:covai@localhost:5432/covai_test_db';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/covai_mock_db';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
`
}process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_covai_mock_stripe_key_123456789';
process.env.STRIPE_API_KEY = process.env.STRIPE_API_KEY || 'sk_test_covai_mock_stripe_key_123456789';

// 2. Prevent unhandled rejections from terminating Jest runner during test teardown
process.on('unhandledRejection', (reason) => {
  // Gracefully log or suppress non-fatal connection drop warnings
});

// 2.5. Structured Runtime Evidence Interceptor for Supertest with Full Lifecycle Restoration
try {
  const fs = require('fs');
  const path = require('path');
  const supertest = require('supertest');

  const evidenceFile = path.resolve(process.cwd(), 'coverage', 'runtime-evidence.json');
  const tempEvidenceFile = path.resolve(process.cwd(), '.covai-temp', 'runtime-evidence.json');

  if (!global.__covai_runtime_evidences__) {
    global.__covai_runtime_evidences__ = [];
  }

  // 1. Pristine Reference Preservation (Guarantees original is never lost)
  if (!supertest.Test.prototype.__covai_pristine_end__) {
    supertest.Test.prototype.__covai_pristine_end__ = supertest.Test.prototype.end;
  }
  const pristineEnd = supertest.Test.prototype.__covai_pristine_end__;

  // 2. Prototype Restoration Function
  const restoreSupertestPrototype = () => {
    if (supertest && supertest.Test && supertest.Test.prototype && supertest.Test.prototype.__covai_pristine_end__) {
      supertest.Test.prototype.end = supertest.Test.prototype.__covai_pristine_end__;
      delete supertest.Test.prototype.__covai_pristine_end__;
      delete supertest.Test.prototype.__covai_patched__;
      return true;
    }
    return false;
  };
  global.__covai_restore_supertest__ = restoreSupertestPrototype;

  // 3. Automated Lifecycle Teardown Hooks
  if (typeof afterAll !== 'undefined') {
    afterAll(() => {
      try {
        restoreSupertestPrototype();
      } catch (_) {}
    });
  }
  if (typeof process !== 'undefined') {
    process.once('beforeExit', () => { try { restoreSupertestPrototype(); } catch (_) {} });
    process.once('exit', () => { try { restoreSupertestPrototype(); } catch (_) {} });
  }

  // 4. Idempotent Wrapper Installation
  if (!supertest.Test.prototype.__covai_patched__) {
    supertest.Test.prototype.__covai_patched__ = true;

    supertest.Test.prototype.end = function(fn) {
      const testState = (typeof expect !== 'undefined' && expect.getState) ? expect.getState() : {};
      const testTitle = testState.currentTestName || 'Unknown Test';
      const testFile = testState.testPath ? path.relative(process.cwd(), testState.testPath).split(path.sep).join('/') : null;
      const reqMethod = (this.method || 'GET').toUpperCase();

      let rawUrl = this.url || '';
      let resolvedUrl = rawUrl;
      try {
        if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
          const parsed = new URL(rawUrl);
          resolvedUrl = parsed.pathname + (parsed.search || '');
        }
      } catch (_) {}

      const reqStartTime = Date.now();

      return pristineEnd.call(this, function(err, res) {
        try {
          const actualStatus = res ? res.status : (err && err.status ? err.status : null);
          const finalResolvedUrl = (res && res.req && res.req.path) ? res.req.path : resolvedUrl;

          let serverErrorMessage = null;
          let responseBodyPreview = null;
          if (actualStatus >= 400 || err) {
            try {
              if (res && res.body !== undefined && res.body !== null && typeof res.body === 'object' && Object.keys(res.body).length > 0) {
                const candidate = res.body.error || res.body.message || res.body.details || res.body.msg || res.body.reason;
                if (typeof candidate === 'string' && candidate.trim()) {
                  serverErrorMessage = candidate.trim().slice(0, 400);
                } else if (candidate && typeof candidate === 'object') {
                  serverErrorMessage = JSON.stringify(candidate).slice(0, 400);
                }
                responseBodyPreview = JSON.stringify(res.body).slice(0, 500);
              }
            } catch (_) {}
            if (!serverErrorMessage && res && typeof res.text === 'string' && res.text.trim()) {
              const trimmedText = res.text.trim();
              serverErrorMessage = trimmedText.slice(0, 400);
              if (!responseBodyPreview) responseBodyPreview = trimmedText.slice(0, 500);
            }
            if (!serverErrorMessage && err && err.message) {
              serverErrorMessage = String(err.message).slice(0, 400);
            }
          }

          const evidenceRecord = {
            jobId: process.env.COVAI_JOB_ID || null,
            testRunId: process.env.COVAI_TEST_RUN_ID || null,
            scenarioId: null,
            testTitle,
            testFile,
            requestMethod: reqMethod,
            requestUrl: rawUrl,
            requestUrlTemplate: null,
            resolvedUrl: finalResolvedUrl,
            expectedStatus: null,
            actualStatusFromRuntime: actualStatus,
            statusAssertionResult: null,
            runnerVerdict: null,
            capturedAt: new Date().toISOString(),
            durationMs: Date.now() - reqStartTime,
            evidenceSource: 'TEST_SERVER_HTTP_RESPONSE',
            responseHeaders: res ? { 'content-type': res.headers && res.headers['content-type'] } : null,
            serverErrorMessage,
            responseBodyPreview,
            hasError: Boolean(err)
          };

          global.__covai_runtime_evidences__.push(evidenceRecord);

          const targetDirs = [path.dirname(evidenceFile), path.dirname(tempEvidenceFile)];
          targetDirs.forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

          let existing = [];
          try {
            if (fs.existsSync(evidenceFile)) {
              existing = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
            }
          } catch (_) {}

          existing.push(evidenceRecord);
          fs.writeFileSync(evidenceFile, JSON.stringify(existing, null, 2), 'utf8');
          try { fs.writeFileSync(tempEvidenceFile, JSON.stringify(existing, null, 2), 'utf8'); } catch (_) {}
        } catch (recordErr) {}

        if (fn) return fn(err, res);
      });
    };
  }
} catch (_) {}

// Mock Stripe library if required by payment routes (CommonJS & ESM compatible)
try {
  const buildStripeCtor = () => {
    const _fn = (impl) => (typeof jest !== 'undefined' && typeof jest.fn === 'function')
      ? jest.fn(impl)
      : (impl || (() => undefined));
    const createClient = () => ({
      checkout: {
        sessions: {
          create: _fn(async () => ({ id: 'cs_test_mock', url: 'https://checkout.stripe.com/mock' })),
          retrieve: _fn(async (id) => ({ id: id || 'cs_test_mock', payment_status: 'paid', status: 'complete' })),
        }
      },
      paymentIntents: {
        create: _fn(async (params) => {
          if (params && (isNaN(params.amount) || params.amount < 0)) {
            const err = new Error("Stripe API error: Invalid amount");
            err.type = "StripeInvalidRequestError";
            throw err;
          }
          return { id: 'pi_test_mock', client_secret: 'pi_test_secret_mock', status: 'succeeded' };
        }),
        retrieve: _fn(async (id) => ({ id: id || 'pi_test_mock', status: 'succeeded' })),
        confirm: _fn(async (id) => ({ id: id || 'pi_test_mock', status: 'succeeded' })),
      },
      customers: {
        create: _fn(async (params) => ({ id: 'cus_test_mock', ...(params || {}) })),
        retrieve: _fn(async (id) => ({ id: id || 'cus_test_mock' })),
      },
      refunds: {
        create: _fn(async () => ({ id: 're_test_mock', status: 'succeeded' })),
      },
      webhooks: {
        constructEvent: _fn((payload) => {
          if (typeof payload === 'string') {
            try { return JSON.parse(payload); } catch (_) { return { id: 'evt_test_mock', type: 'checkout.session.completed', data: { object: {} } }; }
          }
          return payload || { id: 'evt_test_mock', type: 'checkout.session.completed', data: { object: {} } };
        }),
      }
    });
    const StripeCtor = _fn(createClient);
    StripeCtor.default = StripeCtor;
    return StripeCtor;
  };

  global.__covai_stripe_mock__ = buildStripeCtor();

  if (typeof jest !== 'undefined') {
    if (typeof jest.mock === 'function') {
      try {
        jest.mock('stripe', () => global.__covai_stripe_mock__, { virtual: true });
      } catch (_) {}
    }
    if (typeof jest.unstable_mockModule === 'function') {
      try {
        jest.unstable_mockModule('stripe', () => ({
          __esModule: true,
          default: global.__covai_stripe_mock__,
          Stripe: global.__covai_stripe_mock__,
        }));
      } catch (_) {}
    }
  }
} catch (_) {}

// 3. Schema-Aware In-Memory Prisma Client Mock
${
  !disableDatabaseMock && dbInfo.hasPrisma !== false
    ? `
try {
  const schemaModels = ${JSON.stringify(dbInfo.prismaModels || {})};
  const modelSeeds = ${JSON.stringify(dbInfo.prismaSeeds || {})};

  const modelStores = new Map();

  const getStore = (modelName) => {
    const lower = modelName.toLowerCase();
    if (!modelStores.has(lower)) {
      const meta = schemaModels['__meta_' + lower] || {};
      const idField = meta.idField || 'id';
      const seeds = modelSeeds[lower] || [
        { [idField]: 1, id: 1, name: 'Sample ' + modelName, isAvailable: true }
      ];
      const storeMap = new Map();
      let autoIncId = 1;
      for (const s of seeds) {
        const rawId = s[idField] !== undefined ? s[idField] : autoIncId;
        const idVal = typeof rawId === 'string' && isNaN(Number(rawId)) ? rawId : Number(rawId);
        storeMap.set(idVal, { ...s });
        if (typeof idVal === 'number' && idVal >= autoIncId) autoIncId = idVal + 1;
      }
      modelStores.set(lower, { map: storeMap, autoIncId, meta, modelName });
    }
    return modelStores.get(lower);
  };

  const resetPrismaStores = () => {
    modelStores.clear();
  };
  const _prevPrismaReset = global.__covai_reset_mock_db__;
  global.__covai_reset_mock_db__ = () => {
    if (typeof _prevPrismaReset === 'function') _prevPrismaReset();
    resetPrismaStores();
  };

  const matchesWhere = (item, where, idField = 'id') => {
    if (!where || typeof where !== 'object') return true;

    if (where.AND && Array.isArray(where.AND)) {
      if (!where.AND.every(sub => matchesWhere(item, sub, idField))) return false;
    }
    if (where.OR && Array.isArray(where.OR)) {
      if (!where.OR.some(sub => matchesWhere(item, sub, idField))) return false;
    }
    if (where.NOT) {
      if (Array.isArray(where.NOT)) {
        if (where.NOT.some(sub => matchesWhere(item, sub, idField))) return false;
      } else if (matchesWhere(item, where.NOT, idField)) return false;
    }

    for (const [key, val] of Object.entries(where)) {
      if (key === 'mode' || key === 'AND' || key === 'OR' || key === 'NOT') continue;
      
      let itemVal = item[key];
      if (itemVal === undefined) {
        if (key.toLowerCase() === 'id' && item[idField] !== undefined) {
          itemVal = item[idField];
        } else if (key === idField && item.id !== undefined) {
          itemVal = item.id;
        }
      }

      if (val !== undefined && val !== null && typeof val === 'object' && !(val instanceof Date)) {
        if (val.equals !== undefined && itemVal != val.equals) return false;
        if (val.contains !== undefined) {
          const strVal = String(itemVal || '');
          if (!strVal.toLowerCase().includes(String(val.contains).toLowerCase())) return false;
        }
        if (val.startsWith !== undefined && !String(itemVal || '').startsWith(String(val.startsWith))) return false;
        if (val.endsWith !== undefined && !String(itemVal || '').endsWith(String(val.endsWith))) return false;
        if (val.gte !== undefined && Number(itemVal) < Number(val.gte)) return false;
        if (val.lte !== undefined && Number(itemVal) > Number(val.lte)) return false;
        if (val.gt !== undefined && Number(itemVal) <= Number(val.gt)) return false;
        if (val.lt !== undefined && Number(itemVal) >= Number(val.lt)) return false;
        if (val.in !== undefined && Array.isArray(val.in) && !val.in.includes(itemVal)) return false;
        if (val.notIn !== undefined && Array.isArray(val.notIn) && val.notIn.includes(itemVal)) return false;
        if (val.not !== undefined && itemVal == val.not) return false;
        continue;
      }

      if (itemVal !== undefined && itemVal != val) {
        return false;
      }
    }
    return true;
  };

  const applyIncludeAndSelect = (item, params = {}, modelName) => {
    if (!item) return null;
    const copy = JSON.parse(JSON.stringify(item));
    const meta = schemaModels['__meta_' + modelName.toLowerCase()] || {};
    const relations = meta.relations || {};

    if (params.include) {
      for (const [incKey, incVal] of Object.entries(params.include)) {
        if (!incVal) continue;
        if (incKey === '_count') {
          copy._count = copy._count || {};
          if (incVal.select && typeof incVal.select === 'object') {
            for (const relField of Object.keys(incVal.select)) {
              const rel = relations[relField];
              if (rel) {
                const targetStore = getStore(rel.targetModelLower);
                copy._count[relField] = targetStore.map.size || 2;
              } else {
                copy._count[relField] = 2;
              }
            }
          } else {
            copy._count = 2;
          }
          continue;
        }

        const rel = relations[incKey];
        if (rel) {
          const targetStore = getStore(rel.targetModelLower);
          const targetItems = Array.from(targetStore.map.values());
          
          if (rel.isList) {
            let matches = targetItems.filter(child => {
              for (const [k, v] of Object.entries(copy)) {
                if (k !== 'id' && k !== meta.idField && child[k] !== undefined && child[k] === v) {
                  return true;
                }
              }
              return false;
            });
            if (matches.length === 0) matches = targetItems.slice(0, 2);
            
            if (incVal.select && typeof incVal.select === 'object') {
              matches = matches.map(child => {
                const filtered = {};
                for (const sField of Object.keys(incVal.select)) {
                  if (child[sField] !== undefined) filtered[sField] = child[sField];
                }
                return filtered;
              });
            }
            copy[incKey] = matches;
          } else {
            let match = targetItems.find(parent => {
              for (const [k, v] of Object.entries(copy)) {
                if (k !== 'id' && parent[k] !== undefined && parent[k] === v) {
                  return true;
                }
              }
              return false;
            }) || targetItems[0] || null;

            if (match && incVal.select && typeof incVal.select === 'object') {
              const filtered = {};
              for (const sField of Object.keys(incVal.select)) {
                if (match[sField] !== undefined) filtered[sField] = match[sField];
              }
              match = filtered;
            }
            copy[incKey] = match;
          }
        }
      }
    }

    if (params.select && typeof params.select === 'object') {
      const selected = {};
      for (const [sKey, sVal] of Object.entries(params.select)) {
        if (sVal) selected[sKey] = copy[sKey];
      }
      return selected;
    }

    return copy;
  };

  const createModelStore = (modelName) => {
    const lowerModelName = modelName.toLowerCase();
    const requiredFields = schemaModels[lowerModelName] || [];

    return {
      findMany: jest.fn(async (params = {}) => {
        const storeObj = getStore(modelName);
        const idField = storeObj.meta.idField || 'id';
        let items = Array.from(storeObj.map.values());
        if (params.where) {
          items = items.filter(it => matchesWhere(it, params.where, idField));
        }
        if (params.orderBy) {
          const orderClauses = Array.isArray(params.orderBy) ? params.orderBy : [params.orderBy];
          items.sort((a, b) => {
            for (const clause of orderClauses) {
              for (const [col, dir] of Object.entries(clause)) {
                const dirMult = String(dir).toLowerCase() === 'desc' ? -1 : 1;
                if (a[col] < b[col]) return -1 * dirMult;
                if (a[col] > b[col]) return 1 * dirMult;
              }
            }
            return 0;
          });
        }
        const skip = params.skip || 0;
        const take = params.take !== undefined ? params.take : items.length;
        const sliced = items.slice(skip, skip + take);
        return sliced.map(it => applyIncludeAndSelect(it, params, modelName));
      }),

      findUnique: jest.fn(async (params = {}) => {
        const storeObj = getStore(modelName);
        const idField = storeObj.meta.idField || 'id';
        const where = params.where || {};
        let found = null;
        for (const it of storeObj.map.values()) {
          if (matchesWhere(it, where, idField)) {
            found = it;
            break;
          }
        }
        return found ? applyIncludeAndSelect(found, params, modelName) : null;
      }),

      findFirst: jest.fn(async (params = {}) => {
        const storeObj = getStore(modelName);
        const idField = storeObj.meta.idField || 'id';
        let items = Array.from(storeObj.map.values());
        if (params.where) {
          items = items.filter(it => matchesWhere(it, params.where, idField));
        }
        if (params.orderBy) {
          const orderClauses = Array.isArray(params.orderBy) ? params.orderBy : [params.orderBy];
          items.sort((a, b) => {
            for (const clause of orderClauses) {
              for (const [col, dir] of Object.entries(clause)) {
                const dirMult = String(dir).toLowerCase() === 'desc' ? -1 : 1;
                if (a[col] < b[col]) return -1 * dirMult;
                if (a[col] > b[col]) return 1 * dirMult;
              }
            }
            return 0;
          });
        }
        const found = items[0] || null;
        return found ? applyIncludeAndSelect(found, params, modelName) : null;
      }),

      create: jest.fn(async (params = {}) => {
        const storeObj = getStore(modelName);
        const meta = storeObj.meta;
        const idField = meta.idField || 'id';
        const data = params.data || {};
        if (requiredFields && requiredFields.length > 0) {
          const missing = requiredFields.filter(f => data[f] === undefined);
          if (missing.length > 0) {
            const err = new Error("PrismaClientValidationError: Argument '" + missing[0] + "' for data." + missing[0] + " is missing.");
            err.name = "PrismaClientValidationError";
            throw err;
          }
          const nullRequired = requiredFields.filter(f => data[f] === null);
          if (nullRequired.length > 0) {
            const err = new Error("PrismaClientValidationError: Argument '" + nullRequired[0] + "' for data." + nullRequired[0] + " cannot be null.");
            err.name = "PrismaClientValidationError";
            throw err;
          }
        }
        if (meta.types) {
          for (const [key, val] of Object.entries(data)) {
            if (val === undefined || val === null) continue;
            const expType = meta.types[key];
            if ((expType === 'Int' || expType === 'Float') && typeof val === 'string' && isNaN(Number(val))) {
              const err = new Error("PrismaClientValidationError: Argument '" + key + "': Invalid value provided. Expected " + expType + ", provided String.");
              err.name = "PrismaClientValidationError";
              throw err;
            }
          }
        }
        const idVal = data[idField] !== undefined
          ? (typeof data[idField] === 'string' && isNaN(Number(data[idField])) ? data[idField] : Number(data[idField]))
          : storeObj.autoIncId++;
        const record = { [idField]: idVal, id: idVal, ...data };
        storeObj.map.set(idVal, record);
        return applyIncludeAndSelect(record, params, modelName);
      }),

      createMany: jest.fn(async (params = {}) => {
        const storeObj = getStore(modelName);
        const idField = storeObj.meta.idField || 'id';
        const dataList = Array.isArray(params.data) ? params.data : [];
        dataList.forEach(data => {
          const idVal = data[idField] !== undefined ? Number(data[idField]) : storeObj.autoIncId++;
          storeObj.map.set(idVal, { [idField]: idVal, id: idVal, ...data });
        });
        return { count: dataList.length };
      }),

      update: jest.fn(async (params = {}) => {
        const storeObj = getStore(modelName);
        const idField = storeObj.meta.idField || 'id';
        const where = params.where || {};
        let targetId = null;
        for (const [id, it] of storeObj.map.entries()) {
          if (matchesWhere(it, where, idField)) {
            targetId = id;
            break;
          }
        }
        if (targetId === null) {
          const err = new Error('Record to update not found (id: ' + JSON.stringify(where) + ')');
          err.code = 'P2025';
          throw err;
        }
        const existing = storeObj.map.get(targetId);
        const updated = { ...existing, ...(params.data || {}) };
        storeObj.map.set(targetId, updated);
        return applyIncludeAndSelect(updated, params, modelName);
      }),

      updateMany: jest.fn(async (params = {}) => {
        const storeObj = getStore(modelName);
        const idField = storeObj.meta.idField || 'id';
        let count = 0;
        for (const [id, it] of storeObj.map.entries()) {
          if (!params.where || matchesWhere(it, params.where, idField)) {
            storeObj.map.set(id, { ...it, ...(params.data || {}) });
            count++;
          }
        }
        return { count: count || 1 };
      }),

      delete: jest.fn(async (params = {}) => {
        const storeObj = getStore(modelName);
        const idField = storeObj.meta.idField || 'id';
        const where = params.where || {};
        let targetId = null;
        let targetRecord = null;
        for (const [id, it] of storeObj.map.entries()) {
          if (matchesWhere(it, where, idField)) {
            targetId = id;
            targetRecord = it;
            break;
          }
        }
        if (targetId === null) {
          const err = new Error('Record to delete does not exist (id: ' + JSON.stringify(where) + ')');
          err.code = 'P2025';
          throw err;
        }
        storeObj.map.delete(targetId);
        return targetRecord;
      }),

      deleteMany: jest.fn(async (params = {}) => {
        const storeObj = getStore(modelName);
        const idField = storeObj.meta.idField || 'id';
        if (!params.where) {
          const count = storeObj.map.size;
          storeObj.map.clear();
          return { count };
        }
        let count = 0;
        for (const [id, it] of Array.from(storeObj.map.entries())) {
          if (matchesWhere(it, params.where, idField)) {
            storeObj.map.delete(id);
            count++;
          }
        }
        return { count };
      }),

      count: jest.fn(async (params = {}) => {
        const storeObj = getStore(modelName);
        const idField = storeObj.meta.idField || 'id';
        if (!params.where) return storeObj.map.size || 1;
        return Array.from(storeObj.map.values()).filter(it => matchesWhere(it, params.where, idField)).length;
      }),

      aggregate: jest.fn(async (params = {}) => {
        const storeObj = getStore(modelName);
        const idField = storeObj.meta.idField || 'id';
        let items = Array.from(storeObj.map.values());
        if (params.where) {
          items = items.filter(it => matchesWhere(it, params.where, idField));
        }
        const result = {};

        if (params._avg && typeof params._avg === 'object') {
          result._avg = {};
          for (const field of Object.keys(params._avg)) {
            const vals = items.map(it => Number(it[field])).filter(n => !isNaN(n));
            result._avg[field] = vals.length > 0 ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null;
          }
        }

        if (params._sum && typeof params._sum === 'object') {
          result._sum = {};
          for (const field of Object.keys(params._sum)) {
            const vals = items.map(it => Number(it[field])).filter(n => !isNaN(n));
            result._sum[field] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : null;
          }
        }

        if (params._count !== undefined) {
          if (params._count === true) {
            result._count = items.length;
          } else if (typeof params._count === 'object') {
            result._count = {};
            for (const field of Object.keys(params._count)) {
              result._count[field] = items.filter(it => it[field] !== null && it[field] !== undefined).length;
            }
          }
        }

        if (params._min && typeof params._min === 'object') {
          result._min = {};
          for (const field of Object.keys(params._min)) {
            const vals = items.map(it => it[field]).filter(v => v !== null && v !== undefined);
            result._min[field] = vals.length > 0 ? vals.sort()[0] : null;
          }
        }

        if (params._max && typeof params._max === 'object') {
          result._max = {};
          for (const field of Object.keys(params._max)) {
            const vals = items.map(it => it[field]).filter(v => v !== null && v !== undefined);
            result._max[field] = vals.length > 0 ? vals.sort().reverse()[0] : null;
          }
        }

        return result;
      }),

      groupBy: jest.fn(async (params = {}) => {
        const storeObj = getStore(modelName);
        const idField = storeObj.meta.idField || 'id';
        let items = Array.from(storeObj.map.values());
        if (params.where) {
          items = items.filter(it => matchesWhere(it, params.where, idField));
        }
        const byFields = Array.isArray(params.by) ? params.by : [params.by];
        const groups = new Map();
        for (const it of items) {
          const key = byFields.map(f => String(it[f])).join('::');
          if (!groups.has(key)) groups.set(key, { sample: it, items: [] });
          groups.get(key).items.push(it);
        }
        const result = [];
        for (const group of groups.values()) {
          const row = {};
          byFields.forEach(f => row[f] = group.sample[f]);
          if (params._count) row._count = group.items.length;
          result.push(row);
        }
        return result;
      }),

      upsert: jest.fn(async (params = {}) => {
        const storeObj = getStore(modelName);
        const idField = storeObj.meta.idField || 'id';
        const where = params.where || {};
        let existingId = null;
        for (const [id, it] of storeObj.map.entries()) {
          if (matchesWhere(it, where, idField)) {
            existingId = id;
            break;
          }
        }
        if (existingId !== null) {
          const existing = storeObj.map.get(existingId);
          const updated = { ...existing, ...(params.update || {}) };
          storeObj.map.set(existingId, updated);
          return applyIncludeAndSelect(updated, params, modelName);
        }
        const data = params.create || {};
        const idVal = data[idField] !== undefined ? Number(data[idField]) : storeObj.autoIncId++;
        const record = { [idField]: idVal, id: idVal, ...data };
        storeObj.map.set(idVal, record);
        return applyIncludeAndSelect(record, params, modelName);
      }),
    };
  };

  const createPrismaClientMock = () => {
    const models = new Map();
    const proxyRef = {};
    const handler = {
      get(target, prop) {
        if (prop === 'then' || prop === 'catch' || prop === 'finally' || typeof prop === 'symbol') return undefined;
        if (prop === '$connect') return jest.fn().mockResolvedValue(true);
        if (prop === '$disconnect') return jest.fn().mockResolvedValue(true);
        if (prop === '$extends') return jest.fn(() => proxy);
        if (prop === '$transaction') return jest.fn(async (arg) => {
          if (typeof arg === 'function') return arg(proxy);
          if (Array.isArray(arg)) return Promise.all(arg);
          return arg;
        });
        if (prop === '$executeRaw' || prop === '$queryRaw' || prop === '$executeRawUnsafe' || prop === '$queryRawUnsafe') {
          return jest.fn().mockResolvedValue([]);
        }
        if (typeof prop === 'string' && !prop.startsWith('$')) {
          const lowerName = prop.toLowerCase();
          if (!models.has(lowerName)) {
            models.set(lowerName, createModelStore(prop));
          }
          return models.get(lowerName);
        }
        return target[prop];
      }
    };
    const proxy = new Proxy(proxyRef, handler);
    return proxy;
  };

  global.__covai_prisma_mock__ = createPrismaClientMock();

  jest.mock('@prisma/client', () => {
    return {
      __esModule: true,
      PrismaClient: jest.fn().mockImplementation(() => global.__covai_prisma_mock__),
      Prisma: {
        PrismaClientKnownRequestError: class extends Error { constructor(m, opts) { super(m); this.code = opts?.code || 'P2000'; } },
        PrismaClientValidationError: class extends Error { constructor(m) { super(m); this.name = 'PrismaClientValidationError'; } },
        Decimal: Number,
      }
    };
  }, { virtual: true });

  const _relPrismaPaths = [
    '../lib/prisma', '../lib/prisma.js',
    '../../lib/prisma', '../../lib/prisma.js',
    '../src/lib/prisma', '../src/lib/prisma.js',
    '../../src/lib/prisma', '../../src/lib/prisma.js',
    '../config/prisma', '../config/prisma.js',
    '../../config/prisma', '../../config/prisma.js',
    '../src/config/prisma', '../src/config/prisma.js',
    '../../src/config/prisma', '../../src/config/prisma.js',
    '../db/prisma', '../db/prisma.js',
    '../src/db/prisma', '../src/db/prisma.js'
  ];
  for (const _rp of _relPrismaPaths) {
    try {
      jest.mock(_rp, () => {
        const client = global.__covai_prisma_mock__;
        return { __esModule: true, prisma: client, default: client };
      }, { virtual: true });
    } catch (_) {}
  }
} catch (e) {
  // Prisma mock registration warning (non-fatal)
}
`
    : ""
}

// 4. Stateful Schema-Aware In-memory Mongoose Mock
${
  !disableDatabaseMock && dbInfo.hasMongoose !== false
    ? `
try {
  const _mongooseSeeds = ${JSON.stringify(dbInfo.mongooseSeeds || {})};
  const _mongooseStores = new Map();

  const _getMongooseStore = (name) => {
    const key = String(name || 'Item');
    if (!_mongooseStores.has(key)) {
      const seeds = _mongooseSeeds[key] || [
        { _id: '507f191e810c19729de860ea', id: '507f191e810c19729de860ea', name: 'Sample ' + key, title: 'Sample ' + key, email: 'user1@example.com', status: 'ACTIVE' }
      ];
      _mongooseStores.set(key, seeds.map(s => ({ ...s })));
    }
    return _mongooseStores.get(key);
  };

  const _prevMongooseReset = global.__covai_reset_mock_db__;
  global.__covai_reset_mock_db__ = () => {
    if (typeof _prevMongooseReset === 'function') _prevMongooseReset();
    _mongooseStores.clear();
  };

  const _matchesMongoFilter = (doc, filter) => {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or' && Array.isArray(v)) {
        if (!v.some(sub => _matchesMongoFilter(doc, sub))) return false;
        continue;
      }
      if (k === '$and' && Array.isArray(v)) {
        if (!v.every(sub => _matchesMongoFilter(doc, sub))) return false;
        continue;
      }
      const docVal = k === '_id' ? (doc._id ?? doc.id) : (doc[k] ?? (k === 'id' ? doc._id : undefined));
      if (v && typeof v === 'object' && !(v instanceof RegExp)) {
        if (v.$in && Array.isArray(v.$in) && !v.$in.map(String).includes(String(docVal))) return false;
        if (v.$ne !== undefined && String(docVal) === String(v.$ne)) return false;
        if (v.$regex && !new RegExp(v.$regex, v.$options || 'i').test(String(docVal || ''))) return false;
        continue;
      }
      if (v instanceof RegExp) {
        if (!v.test(String(docVal || ''))) return false;
        continue;
      }
      if (docVal !== undefined && String(docVal) !== String(v)) return false;
    }
    return true;
  };

  const _wrapDoc = (doc, store) => {
    if (!doc || typeof doc !== 'object') return doc;
    const instance = {
      ...doc,
      _id: doc._id || '507f191e810c19729de860ea',
      id: String(doc._id || doc.id || '507f191e810c19729de860ea'),
    };
    Object.defineProperties(instance, {
      save: {
        value: jest.fn(async () => {
          const idx = store.findIndex(d => String(d._id) === String(instance._id));
          const plain = { ...instance };
          if (idx >= 0) store[idx] = plain;
          else store.push(plain);
          return instance;
        }),
        enumerable: false,
        writable: true,
      },
      toObject: { value: jest.fn(() => ({ ...instance })), enumerable: false, writable: true },
      toJSON: { value: jest.fn(() => ({ ...instance })), enumerable: false, writable: true },
      populate: { value: jest.fn(async () => instance), enumerable: false, writable: true },
    });
    return instance;
  };

  const createQueryChain = (result) => {
    const query = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(result),
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      catch: (reject) => Promise.resolve(result).catch(reject),
      finally: (cb) => Promise.resolve(result).finally(cb),
    };
    return query;
  };

  const createMongooseMock = () => {
    const models = new Map();

    const mockModel = (name) => {
      const Model = jest.fn().mockImplementation((data = {}) => {
        const store = _getMongooseStore(name);
        const newId = data._id || '507f191e810c19729de860' + Math.floor(10 + store.length).toString(16).slice(0, 2);
        return _wrapDoc({ ...data, _id: newId }, store);
      });

      Model.find = jest.fn((filter = {}) => {
        const store = _getMongooseStore(name);
        const matches = store.filter(d => _matchesMongoFilter(d, filter)).map(d => _wrapDoc(d, store));
        return createQueryChain(matches);
      });
      Model.findOne = jest.fn((filter = {}) => {
        const store = _getMongooseStore(name);
        const found = store.find(d => _matchesMongoFilter(d, filter)) || store[0] || null;
        return createQueryChain(found ? _wrapDoc(found, store) : null);
      });
      Model.findById = jest.fn((id) => {
        const store = _getMongooseStore(name);
        const found = store.find(d => String(d._id) === String(id)) || (store[0] ? { ...store[0], _id: id } : null);
        return createQueryChain(found ? _wrapDoc(found, store) : null);
      });
      Model.findByIdAndUpdate = jest.fn((id, update = {}) => {
        const store = _getMongooseStore(name);
        const patch = update.$set ? update.$set : update;
        const idx = store.findIndex(d => String(d._id) === String(id));
        if (idx >= 0) {
          store[idx] = { ...store[idx], ...patch, _id: id };
          return createQueryChain(_wrapDoc(store[idx], store));
        }
        const created = { ...(store[0] || {}), ...patch, _id: id };
        return createQueryChain(_wrapDoc(created, store));
      });
      Model.findOneAndUpdate = jest.fn((filter = {}, update = {}) => {
        const store = _getMongooseStore(name);
        const patch = update.$set ? update.$set : update;
        const found = store.find(d => _matchesMongoFilter(d, filter)) || store[0];
        if (found) {
          Object.assign(found, patch);
          return createQueryChain(_wrapDoc(found, store));
        }
        return createQueryChain(_wrapDoc({ _id: '507f191e810c19729de860ea', ...patch }, store));
      });
      Model.findByIdAndDelete = jest.fn((id) => {
        const store = _getMongooseStore(name);
        const idx = store.findIndex(d => String(d._id) === String(id));
        const removed = idx >= 0 ? store.splice(idx, 1)[0] : { _id: id };
        return createQueryChain(_wrapDoc(removed, store));
      });
      Model.findOneAndDelete = jest.fn((filter = {}) => {
        const store = _getMongooseStore(name);
        const idx = store.findIndex(d => _matchesMongoFilter(d, filter));
        const removed = idx >= 0 ? store.splice(idx, 1)[0] : (store[0] || { _id: '507f191e810c19729de860ea' });
        return createQueryChain(_wrapDoc(removed, store));
      });
      Model.create = jest.fn(async (data) => {
        const store = _getMongooseStore(name);
        if (Array.isArray(data)) {
          return data.map(item => {
            const doc = { _id: item._id || '507f191e810c19729de860ea', ...item };
            store.push(doc);
            return _wrapDoc(doc, store);
          });
        }
        const doc = { _id: (data && data._id) || '507f191e810c19729de860ea', ...(data || {}) };
        store.push(doc);
        return _wrapDoc(doc, store);
      });
      Model.insertMany = jest.fn(async (docs = []) => {
        const store = _getMongooseStore(name);
        const list = Array.isArray(docs) ? docs : [docs];
        return list.map(item => {
          const doc = { _id: item._id || '507f191e810c19729de860ea', ...item };
          store.push(doc);
          return _wrapDoc(doc, store);
        });
      });
      Model.updateOne = jest.fn(async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1 }));
      Model.updateMany = jest.fn(async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1 }));
      Model.deleteOne = jest.fn(async (filter = {}) => {
        const store = _getMongooseStore(name);
        const idx = store.findIndex(d => _matchesMongoFilter(d, filter));
        if (idx >= 0) store.splice(idx, 1);
        return { acknowledged: true, deletedCount: 1 };
      });
      Model.deleteMany = jest.fn(async () => {
        const store = _getMongooseStore(name);
        const count = store.length;
        store.length = 0;
        return { acknowledged: true, deletedCount: count || 1 };
      });
      Model.countDocuments = jest.fn((filter = {}) => {
        const store = _getMongooseStore(name);
        return createQueryChain(store.filter(d => _matchesMongoFilter(d, filter)).length || 1);
      });
      Model.exists = jest.fn(() => createQueryChain({ _id: '507f191e810c19729de860ea' }));
      Model.aggregate = jest.fn().mockResolvedValue([]);
      return Model;
    };

    const ObjectId = function(id) {
      this.id = id || '507f191e810c19729de860ea';
      this.toString = () => String(this.id);
      this.equals = (other) => String(this.id) === String(other);
    };
    ObjectId.isValid = () => true;

    const SchemaCtor = jest.fn().mockImplementation(function(def = {}) {
      this.obj = def;
      this.pre = jest.fn().mockReturnThis();
      this.post = jest.fn().mockReturnThis();
      this.plugin = jest.fn().mockReturnThis();
      this.index = jest.fn().mockReturnThis();
      this.virtual = jest.fn(() => ({ get: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis() }));
      this.set = jest.fn().mockReturnThis();
      this.methods = {};
      this.statics = {};
      return this;
    });
    SchemaCtor.Types = { ObjectId, Mixed: Object, String, Number, Boolean, Date, Array, Map };

    const mongooseObj = {
      connect: jest.fn().mockResolvedValue(true),
      disconnect: jest.fn().mockResolvedValue(true),
      set: jest.fn(),
      Types: { ObjectId },
      connection: {
        readyState: 1,
        on: jest.fn(),
        once: jest.fn(),
        close: jest.fn().mockResolvedValue(true),
        db: { admin: () => ({ ping: jest.fn().mockResolvedValue({ ok: 1 }) }) },
      },
      Schema: SchemaCtor,
      models: {},
      model: jest.fn((name) => {
        if (!models.has(name)) {
          const m = mockModel(name);
          models.set(name, m);
          mongooseObj.models[name] = m;
        }
        return models.get(name);
      }),
    };
    return { __esModule: true, default: mongooseObj, ...mongooseObj };
  };

  global.__covai_mongoose_mock__ = createMongooseMock();
  jest.mock('mongoose', () => global.__covai_mongoose_mock__, { virtual: true });
} catch (e) {
  // Mongoose mock registration warning (non-fatal)
}
`
    : ""
}

${!disableDatabaseMock ? buildSqlAndRedisMockSection(dbInfo, { useJestFn: true }) : ""}
${
  !disableDatabaseMock
    ? `
// Reset stateful in-memory mock database before each test case for deterministic isolation
if (
  typeof beforeEach === 'function' &&
  !(typeof expect !== 'undefined' && expect.getState && expect.getState().currentTestName)
) {
  try {
    beforeEach(() => {
      try {
        if (typeof global.__covai_reset_mock_db__ === 'function') {
          global.__covai_reset_mock_db__();
        }
      } catch (_) {}
    });
  } catch (_) {}
}
`
    : ""
}
`;
};

/**
 * Ensures that the covai.supertest.setup.js file exists in the target project root,
 * creating it inside <rootDir>/.covai-temp/covai.supertest.setup.js.
 *
 * @param {string} rootDir Project root directory
 * @param {{ disableDatabaseMock?: boolean }} [options]
 * @returns {{ absolutePath: string, relativePath: string, dbInfo: object }}
 */
export const ensureSupertestDatabaseSetupFile = (rootDir, options = {}) => {
  if (!rootDir || typeof rootDir !== "string" || !fs.existsSync(rootDir)) {
    throw new Error(
      "Invalid root directory provided for Supertest setup file generation.",
    );
  }

  const dbInfo = detectProjectDatabase(rootDir);
  const tempDir = path.join(rootDir, ".covai-temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  // Ensure setup script always executes as CommonJS even when rootDir has "type": "module"
  const tempPkgPath = path.join(tempDir, "package.json");
  if (!fs.existsSync(tempPkgPath)) {
    try {
      fs.writeFileSync(
        tempPkgPath,
        JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
        "utf8",
      );
    } catch (_) {}
  }

  const setupFilePath = path.join(tempDir, "covai.supertest.setup.js");
  const scriptContent = generateSupertestSetupScript(dbInfo, options);
  fs.writeFileSync(setupFilePath, scriptContent, "utf8");

  const relativePath = path
    .relative(rootDir, setupFilePath)
    .replace(/\\/g, "/");
  return {
    absolutePath: setupFilePath,
    relativePath,
    dbInfo,
  };
};

/**
 * Generates a standalone Node.js CJS preload script (`covai.runtime.mock.cjs`) and
 * ESM loader (`covai.runtime.loader.mjs`) backed by a persistent JSON state file on disk.
 * Used by Full Stack System Tests (and any child Node process) so real HTTP backend servers
 * and seed scripts execute against a stateful schema-derived mock database without Docker.
 *
 * @param {string} rootDir
 * @param {{ database?: object, services?: object, tempSubdir?: string }} [options]
 */
export const ensureSystemDatabaseMockPreload = (rootDir, options = {}) => {
  const dbInfo = detectProjectDatabase(rootDir);
  const tempDir = path.join(
    rootDir,
    options.tempSubdir || ".covai-system-test",
    "mock-db",
  );
  fs.mkdirSync(tempDir, { recursive: true });

  const stateFilePath = path
    .join(tempDir, "mock-db-state.json")
    .replace(/\\/g, "/");
  const preloadPath = path.join(tempDir, "covai.runtime.mock.cjs");
  const loaderPath = path.join(tempDir, "covai.runtime.loader.mjs");

  const initialState = {
    prisma: dbInfo.prismaSeeds || {},
    mongoose: dbInfo.mongooseSeeds || {},
    sql: dbInfo.sqlSeeds || {},
    redis: {},
  };
  fs.writeFileSync(
    stateFilePath,
    JSON.stringify(initialState, null, 2),
    "utf8",
  );

  const preloadScript = `// [CovAI System Runtime Schema-Aware Mock Preload]
'use strict';
const fs = require('fs');
const Module = require('module');

const STATE_FILE = ${JSON.stringify(stateFilePath)};
const SCHEMA_MODELS = ${JSON.stringify(dbInfo.prismaModels || {})};

const loadState = () => {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (_) {}
  return { prisma: {}, mongoose: {}, sql: {}, redis: {} };
};

const saveState = (state) => {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (_) {}
};

// 1. File-backed Prisma Mock
const createRuntimePrismaMock = () => {
  const getTable = (state, modelName) => {
    const key = String(modelName).toLowerCase();
    if (!Array.isArray(state.prisma[key])) {
      state.prisma[key] = [{ id: 1, name: 'Sample ' + modelName, status: 'ACTIVE', createdAt: new Date().toISOString() }];
    }
    return state.prisma[key];
  };

  const matches = (item, where, idField = 'id') => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === 'AND' && Array.isArray(v)) { if (!v.every(s => matches(item, s, idField))) return false; continue; }
      if (k === 'OR' && Array.isArray(v)) { if (!v.some(s => matches(item, s, idField))) return false; continue; }
      const itemVal = item[k] !== undefined ? item[k] : (k === 'id' ? item[idField] : undefined);
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if (v.equals !== undefined && itemVal != v.equals) return false;
        if (v.contains !== undefined && !String(itemVal || '').toLowerCase().includes(String(v.contains).toLowerCase())) return false;
        if (v.in && Array.isArray(v.in) && !v.in.includes(itemVal)) return false;
        continue;
      }
      if (itemVal !== undefined && itemVal != v) return false;
    }
    return true;
  };

  const makeModel = (modelName) => {
    const lower = String(modelName).toLowerCase();
    const meta = SCHEMA_MODELS['__meta_' + lower] || {};
    const idField = meta.idField || 'id';
    return {
      findMany: async (params = {}) => {
        const state = loadState();
        let rows = [...getTable(state, modelName)];
        if (params.where) rows = rows.filter(r => matches(r, params.where, idField));
        const skip = params.skip || 0;
        const take = params.take !== undefined ? params.take : rows.length;
        return rows.slice(skip, skip + take);
      },
      findUnique: async (params = {}) => {
        const state = loadState();
        const rows = getTable(state, modelName);
        return rows.find(r => matches(r, params.where || {}, idField)) || null;
      },
      findFirst: async (params = {}) => {
        const state = loadState();
        const rows = getTable(state, modelName);
        return rows.find(r => matches(r, params.where || {}, idField)) || null;
      },
      create: async (params = {}) => {
        const state = loadState();
        const rows = getTable(state, modelName);
        const data = params.data || {};
        const nextId = data[idField] !== undefined ? data[idField] : (rows.reduce((m, r) => Math.max(m, Number(r[idField] || r.id) || 0), 0) + 1);
        const rec = { [idField]: nextId, id: nextId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...data };
        rows.push(rec);
        saveState(state);
        return rec;
      },
      createMany: async (params = {}) => {
        const state = loadState();
        const rows = getTable(state, modelName);
        const list = Array.isArray(params.data) ? params.data : [];
        list.forEach(d => {
          const nextId = d[idField] !== undefined ? d[idField] : (rows.reduce((m, r) => Math.max(m, Number(r[idField] || r.id) || 0), 0) + 1);
          rows.push({ [idField]: nextId, id: nextId, ...d });
        });
        saveState(state);
        return { count: list.length };
      },
      update: async (params = {}) => {
        const state = loadState();
        const rows = getTable(state, modelName);
        const idx = rows.findIndex(r => matches(r, params.where || {}, idField));
        if (idx === -1) {
          const fallback = { [idField]: params.where?.[idField] || 1, ...(params.data || {}) };
          rows.push(fallback);
          saveState(state);
          return fallback;
        }
        rows[idx] = { ...rows[idx], ...(params.data || {}), updatedAt: new Date().toISOString() };
        saveState(state);
        return rows[idx];
      },
      updateMany: async (params = {}) => {
        const state = loadState();
        const rows = getTable(state, modelName);
        let count = 0;
        rows.forEach((r, i) => {
          if (!params.where || matches(r, params.where, idField)) {
            rows[i] = { ...r, ...(params.data || {}) };
            count++;
          }
        });
        saveState(state);
        return { count };
      },
       upsert: async (params = {}) => {
        const state = loadState();
        const rows = getTable(state, modelName);
        const idx = rows.findIndex(r => matches(r, params.where || {}, idField));
        if (idx >= 0) {
          rows[idx] = { ...rows[idx], ...(params.update || {}) };
          saveState(state);
          return rows[idx];
        }
        const nextId = rows.reduce((m, r) => Math.max(m, Number(r[idField] || r.id) || 0), 0) + 1;
        const created = { [idField]: nextId, id: nextId, ...(params.create || {}) };
        rows.push(created);
        saveState(state);
        return created;
      },
      delete: async (params = {}) => {
        const state = loadState();
        const rows = getTable(state, modelName);
        const idx = rows.findIndex(r => matches(r, params.where || {}, idField));
        const removed = idx >= 0 ? rows.splice(idx, 1)[0] : { id: 1 };
        saveState(state);
        return removed;
      },
      deleteMany: async (params = {}) => {
        const state = loadState();
        const rows = getTable(state, modelName);
        const before = rows.length;
        state.prisma[lower] = params.where ? rows.filter(r => !matches(r, params.where, idField)) : [];
        saveState(state);
        return { count: before - state.prisma[lower].length };
      },
      count: async (params = {}) => {
        const state = loadState();
        const rows = getTable(state, modelName);
        return params.where ? rows.filter(r => matches(r, params.where, idField)).length : rows.length;
      },
      aggregate: async () => ({ _count: 1, _sum: {}, _avg: {}, _min: {}, _max: {} }),
      groupBy: async () => [],
    };
  };

  const proxy = new Proxy({}, {
    get(target, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally' || typeof prop === 'symbol') return undefined;
      if (prop === '$connect' || prop === '$disconnect') return async () => true;
      if (prop === '$extends') return () => proxy;
      if (prop === '$transaction') return async (arg) => typeof arg === 'function' ? arg(proxy) : Promise.all(arg || []);
      if (typeof prop === 'string' && prop.startsWith('$')) return async () => [];
      if (typeof prop === 'string') return makeModel(prop);
      return target[prop];
    }
  });
  return proxy;
};

const prismaClientSingleton = createRuntimePrismaMock();
const prismaPkgMock = {
  __esModule: true,
  PrismaClient: function() { return prismaClientSingleton; },
  default: { PrismaClient: function() { return prismaClientSingleton; } },
  Prisma: {
    PrismaClientKnownRequestError: class extends Error {},
    PrismaClientValidationError: class extends Error {},
    Decimal: Number,
  }
};

// 2. File-backed SQL & Mongoose & Redis mocks
const executeFileBackedSql = (sqlText, params = []) => {
  const sql = String(sqlText || '').trim();
  const state = loadState();
  const getRows = (tbl) => {
    const k = String(tbl || 'items').replace(/^["\`]|["\`]$/g, '').toLowerCase();
    if (!Array.isArray(state.sql[k])) {
      state.sql[k] = [
        { id: 1, name: 'Sample ' + k + ' 1', title: 'Sample ' + k + ' 1', status: 'ACTIVE', created_at: new Date().toISOString() },
        { id: 2, name: 'Sample ' + k + ' 2', title: 'Sample ' + k + ' 2', status: 'ACTIVE', created_at: new Date().toISOString() }
      ];
    }
    return state.sql[k];
  };
  const selectCount = sql.match(/^SELECT\\s+COUNT\\s*\\([^)]*\\)\\s*(?:AS\\s+["\`]?(\\w+)["\`]?)?\\s+FROM\\s+["\`]?(\\w+)["\`]?/i);
  if (selectCount) {
    const alias = selectCount[1] || 'count';
    const rows = getRows(selectCount[2]);
    return { rows: [{ [alias]: rows.length, count: rows.length }], rowCount: 1, affectedRows: 0, insertId: 1 };
  }
  const selectMatch = sql.match(/^SELECT\\s+[\\s\\S]+?\\s+FROM\\s+["\`]?(\\w+)["\`]?/i);
  if (selectMatch) {
    const rows = getRows(selectMatch[1]);
    return { rows, rowCount: rows.length, affectedRows: 0, insertId: 1 };
  }
  const insertMatch = sql.match(/^INSERT\\s+INTO\\s+["\`]?(\\w+)["\`]?\\s*(?:\\(([^)]+)\\))?/i);
  if (insertMatch) {
    const rows = getRows(insertMatch[1]);
    const cols = insertMatch[2] ? insertMatch[2].split(',').map(c => c.trim().replace(/^["\`]|["\`]$/g, '')) : [];
    const nextId = rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
    const newRow = { id: nextId, created_at: new Date().toISOString() };
    cols.forEach((c, idx) => { if (params[idx] !== undefined) newRow[c] = params[idx]; });
    rows.push(newRow);
    saveState(state);
    return { rows: [newRow], rowCount: 1, insertId: nextId, affectedRows: 1 };
  }
  const updateMatch = sql.match(/^UPDATE\\s+["\`]?(\\w+)["\`]?\\s+SET/i);
  if (updateMatch) {
    const rows = getRows(updateMatch[1]);
    saveState(state);
    return { rows: rows.slice(0, 1), rowCount: 1, affectedRows: 1, insertId: 1 };
  }
  const deleteMatch = sql.match(/^DELETE\\s+FROM\\s+["\`]?(\\w+)["\`]?/i);
  if (deleteMatch) {
    const rows = getRows(deleteMatch[1]);
    const removed = rows.length > 0 ? [rows.pop()] : [];
    saveState(state);
    return { rows: removed, rowCount: removed.length, affectedRows: removed.length, insertId: 1 };
  }
  return { rows: [], rowCount: 0, affectedRows: 0, insertId: 1 };
};

const createPgClient = () => ({
  connect: async () => createPgClient(),
  query: async (text, values, cb) => {
    const actualValues = Array.isArray(values) ? values : [];
    const actualCb = typeof values === 'function' ? values : cb;
    const res = executeFileBackedSql(typeof text === 'object' ? text.text : text, typeof text === 'object' ? text.values : actualValues);
    if (typeof actualCb === 'function') actualCb(null, res);
    return res;
  },
  release: () => {},
  end: async () => {},
  on: () => {},
});
const pgPkgMock = { __esModule: true, Pool: function() { return createPgClient(); }, Client: function() { return createPgClient(); } };
pgPkgMock.default = pgPkgMock;

const createMysqlConn = () => {
  const q = async (sql, values, cb) => {
    const actualValues = Array.isArray(values) ? values : [];
    const actualCb = typeof values === 'function' ? values : cb;
    const rawSql = typeof sql === 'object' ? sql.sql : sql;
    const res = executeFileBackedSql(rawSql, actualValues);
    const out = /^SELECT/i.test(String(rawSql || '').trim())
      ? [res.rows, []]
      : [{ insertId: res.insertId, affectedRows: res.affectedRows, changedRows: res.affectedRows }, []];
    if (typeof actualCb === 'function') actualCb(null, out[0], out[1]);
    return out;
  };
  const conn = {
    query: q,
    execute: q,
    getConnection: async (cb) => { if (typeof cb === 'function') cb(null, conn); return conn; },
    release: () => {},
    end: async (cb) => { if (typeof cb === 'function') cb(null); },
    on: () => {},
    promise: () => conn,
  };
  return conn;
};
const mysqlPkgMock = { __esModule: true, createPool: () => createMysqlConn(), createConnection: () => createMysqlConn() };
mysqlPkgMock.default = mysqlPkgMock;

// Mongoose runtime mock
const createQueryChain = (res) => ({
  sort() { return this; }, limit() { return this; }, skip() { return this; },
  select() { return this; }, populate() { return this; }, lean() { return this; }, where() { return this; },
  exec: async () => res,
  then: (resolve, reject) => Promise.resolve(res).then(resolve, reject),
  catch: (reject) => Promise.resolve(res).catch(reject),
});
const mongooseModels = new Map();
const getMongoModel = (name) => {
  if (mongooseModels.has(name)) return mongooseModels.get(name);
  const getDocs = (state) => {
    if (!Array.isArray(state.mongoose[name])) {
      state.mongoose[name] = [{ _id: '507f191e810c19729de860ea', id: '507f191e810c19729de860ea', name: 'Sample ' + name, status: 'ACTIVE' }];
    }
    return state.mongoose[name];
  };
  const Model = function(data = {}) {
    const doc = { _id: data._id || '507f191e810c19729de860ea', ...data };
    doc.save = async () => { const s = loadState(); getDocs(s).push({ ...data, _id: doc._id }); saveState(s); return doc; };
    doc.toObject = () => ({ ...doc });
    doc.toJSON = () => ({ ...doc });
    return doc;
  };
  Model.find = () => { const s = loadState(); return createQueryChain(getDocs(s)); };
  Model.findOne = () => { const s = loadState(); return createQueryChain(getDocs(s)[0] || null); };
  Model.findById = (id) => { const s = loadState(); const docs = getDocs(s); return createQueryChain(docs.find(d => String(d._id) === String(id)) || docs[0] || null); };
  Model.create = async (data = {}) => { const s = loadState(); const doc = { _id: data._id || '507f191e810c19729de860ea', ...data }; getDocs(s).push(doc); saveState(s); return doc; };
  Model.findByIdAndUpdate = (id, u = {}) => { const s = loadState(); const docs = getDocs(s); const patch = u.$set || u; const found = docs.find(d => String(d._id) === String(id)) || docs[0] || {}; Object.assign(found, patch); saveState(s); return createQueryChain(found); };
  Model.findByIdAndDelete = (id) => { const s = loadState(); const docs = getDocs(s); const idx = docs.findIndex(d => String(d._id) === String(id)); const r = idx >= 0 ? docs.splice(idx, 1)[0] : { _id: id }; saveState(s); return createQueryChain(r); };
  Model.deleteOne = async () => ({ acknowledged: true, deletedCount: 1 });
  Model.deleteMany = async () => ({ acknowledged: true, deletedCount: 1 });
  Model.updateOne = async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1 });
  Model.countDocuments = () => { const s = loadState(); return createQueryChain(getDocs(s).length); };
  Model.aggregate = async () => [];
  mongooseModels.set(name, Model);
  return Model;
};
function MockObjectId(id) { this.id = id || '507f191e810c19729de860ea'; this.toString = () => String(this.id); }
MockObjectId.isValid = () => true;
function MockSchema(def = {}) {
  this.obj = def; this.methods = {}; this.statics = {};
  this.pre = () => this; this.post = () => this; this.plugin = () => this; this.index = () => this; this.set = () => this;
  this.virtual = () => ({ get: () => this, set: () => this });
}
MockSchema.Types = { ObjectId: MockObjectId, Mixed: Object, String, Number, Boolean, Date, Array };
const mongoosePkgMock = {
  __esModule: true,
  connect: async () => mongoosePkgMock,
  disconnect: async () => true,
  set: () => {},
  Schema: MockSchema,
  Types: { ObjectId: MockObjectId },
  connection: { readyState: 1, on: () => {}, once: () => {}, close: async () => true },
  models: {},
  model: (name) => getMongoModel(name),
};
mongoosePkgMock.default = mongoosePkgMock;

// Redis runtime mock
const redisMem = new Map();
const createRedisMock = () => {
  const c = {
    status: 'ready', isOpen: true, isReady: true,
    connect: async () => c, quit: async () => 'OK', disconnect: async () => {}, ping: async () => 'PONG',
    get: async (k) => redisMem.get(k) ?? null,
    set: async (k, v) => { redisMem.set(k, String(v)); return 'OK'; },
    setEx: async (k, _t, v) => { redisMem.set(k, String(v)); return 'OK'; },
    setex: async (k, _t, v) => { redisMem.set(k, String(v)); return 'OK'; },
    del: async (k) => (redisMem.delete(k) ? 1 : 0),
    expire: async () => 1, incr: async (k) => { const n = (Number(redisMem.get(k)) || 0) + 1; redisMem.set(k, String(n)); return n; },
    on: (ev, cb) => { if (ev === 'ready' || ev === 'connect') setImmediate(cb); return c; },
    once: () => c, off: () => c, duplicate: () => createRedisMock(),
  };
  return c;
};
function RedisCtor() { return createRedisMock(); }
RedisCtor.createClient = () => createRedisMock();
RedisCtor.default = RedisCtor;

global.__COVAI_RUNTIME_MOCKS__ = {
  '@prisma/client': prismaPkgMock,
  'mongoose': mongoosePkgMock,
  'pg': pgPkgMock,
  'mysql2': mysqlPkgMock,
  'mysql2/promise': mysqlPkgMock,
  'mysql': mysqlPkgMock,
  'ioredis': RedisCtor,
  'redis': RedisCtor,
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (global.__COVAI_RUNTIME_MOCKS__ && Object.prototype.hasOwnProperty.call(global.__COVAI_RUNTIME_MOCKS__, request)) {
    return global.__COVAI_RUNTIME_MOCKS__[request];
  }
  if (/\\.prisma[\\/\\\\]client/.test(request)) {
    return prismaPkgMock;
  }
  return originalLoad.apply(this, arguments);
};

try {
  if (typeof Module.register === 'function') {
    Module.register(${JSON.stringify(pathToFileURL(loaderPath).href)});
  }
} catch (_) {}
`;

  const esmLoaderScript = `// [CovAI System Runtime ESM Loader Hook]
const MOCKED_SPECIFIERS = new Set(['@prisma/client', 'mongoose', 'pg', 'mysql2', 'mysql2/promise', 'mysql', 'ioredis', 'redis']);

export async function resolve(specifier, context, nextResolve) {
  if (MOCKED_SPECIFIERS.has(specifier)) {
    return {
      shortCircuit: true,
      url: 'covai-mock:' + specifier,
    };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('covai-mock:')) {
    const pkg = url.slice('covai-mock:'.length);
    const source = [
      \`const m = globalThis.__COVAI_RUNTIME_MOCKS__[\${JSON.stringify(pkg)}];\`,
      \`export default (m.default || m);\`,
      pkg === '@prisma/client' ? \`export const PrismaClient = m.PrismaClient; export const Prisma = m.Prisma;\` : '',
      pkg === 'mongoose' ? \`export const Schema = m.Schema; export const model = m.model; export const connect = m.connect; export const disconnect = m.disconnect; export const Types = m.Types; export const connection = m.connection; export const models = m.models;\` : '',
      pkg === 'pg' ? \`export const Pool = m.Pool; export const Client = m.Client;\` : '',
      (pkg === 'mysql2' || pkg === 'mysql2/promise' || pkg === 'mysql') ? \`export const createPool = m.createPool; export const createConnection = m.createConnection;\` : '',
      (pkg === 'redis' || pkg === 'ioredis') ? \`export const createClient = m.createClient;\` : '',
    ].filter(Boolean).join('\\n');
    return {
      format: 'module',
      shortCircuit: true,
      source,
    };
  }
  return nextLoad(url, context);
}
`;

  fs.writeFileSync(preloadPath, preloadScript, "utf8");
  fs.writeFileSync(loaderPath, esmLoaderScript, "utf8");

  const normalizedPreload = preloadPath.replace(/\\/g, "/");
  const requireFlag = `--require "${normalizedPreload}"`;

  return {
    tempDir,
    preloadPath,
    loaderPath,
    stateFilePath,
    requireFlag,
    dbInfo,
    environment: {
      COVAI_MOCK_DB: "true",
      COVAI_MOCK_DB_STATE_FILE: stateFilePath,
      DATABASE_URL: "postgresql://covai:covai@127.0.0.1:5432/covai_test",
      MYSQL_URL: "mysql://covai:covai@127.0.0.1:3306/covai_test",
      POSTGRES_URL: "postgresql://covai:covai@127.0.0.1:5432/covai_test",
      MONGODB_URI: "mongodb://127.0.0.1:27017/covai_test",
      MONGO_URI: "mongodb://127.0.0.1:27017/covai_test",
      MONGO_URL: "mongodb://127.0.0.1:27017/covai_test",
      REDIS_URL: "redis://127.0.0.1:6379",
      REDIS_HOST: "127.0.0.1",
      REDIS_PORT: "6379",
      DB_HOST: "127.0.0.1",
      DB_PORT: dbInfo.primaryType === "SQL" ? "3306" : "5432",
      DB_USER: "covai",
      DB_USERNAME: "covai",
      DB_PASSWORD: "covai_mock_password",
      DB_PASS: "covai_mock_password",
      DB_NAME: "covai_test",
      DB_DATABASE: "covai_test",
      PGHOST: "127.0.0.1",
      PGPORT: "5432",
      PGUSER: "covai",
      PGPASSWORD: "covai_mock_password",
      PGDATABASE: "covai_test",
      MYSQL_HOST: "127.0.0.1",
      MYSQL_PORT: "3306",
      MYSQL_USER: "covai",
      MYSQL_PASSWORD: "covai_mock_password",
      MYSQL_DATABASE: "covai_test",
    },
    cleanup: async () => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (_) {}
    },
  };
};
