import fs from "fs";
import path from "path";

/**
 * Parses a Prisma schema file and extracts required scalar fields, relations,
 * unique constraints, and types per model.
 * 
 * @param {string} schemaContent 
 * @returns {Record<string, any>} Map of model definitions and metadata
 */
export const parsePrismaSchemaModels = (schemaContent) => {
    if (!schemaContent || typeof schemaContent !== "string") return {};
    const models = {};
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
        const optionalFields = [];
        const defaultFields = [];
        const uniqueFields = [];
        const relations = {};
        let idField = "id";

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue;
            const tokens = trimmed.split(/\s+/);
            if (tokens.length >= 2) {
                const fieldName = tokens[0];
                const rawType = tokens[1];
                const isOptional = rawType.endsWith("?");
                const isList = rawType.endsWith("[]");
                const baseType = rawType.replace("?", "").replace("[]", "");
                const isId = trimmed.includes("@id");
                const isUnique = trimmed.includes("@unique");
                const hasDefault = trimmed.includes("@default");
                const isScalar = /^(String|Int|Float|Boolean|DateTime|Json|Decimal|BigInt|Bytes)/.test(baseType);

                if (isId) {
                    idField = fieldName;
                    uniqueFields.push(fieldName);
                }
                if (isUnique) {
                    uniqueFields.push(fieldName);
                }

                if (isScalar) {
                    fieldTypes[fieldName] = baseType;
                    if (isId || hasDefault) {
                        defaultFields.push(fieldName);
                    } else if (isOptional) {
                        optionalFields.push(fieldName);
                    } else {
                        requiredFields.push(fieldName);
                    }
                } else if (declaredModels.has(baseType)) {
                    relations[fieldName] = {
                        targetModel: baseType,
                        targetModelLower: baseType.toLowerCase(),
                        isList
                    };
                }
            }
        }
        models[modelName] = requiredFields;
        models['__meta_' + modelName] = {
            canonicalName: rawModelName,
            idField,
            uniqueFields,
            required: requiredFields,
            types: fieldTypes,
            optional: optionalFields,
            defaults: defaultFields,
            relations
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
    const modelKeys = Object.keys(schemaModels).filter(k => !k.startsWith("__meta_"));
    
    // First pass: generate baseline rows for each model
    for (const modelKey of modelKeys) {
        const meta = schemaModels["__meta_" + modelKey];
        if (!meta) continue;
        const idField = meta.idField || "id";
        const rows = [];
        const count = 4;
        const isClassModel = /lop|class/i.test(modelKey);
        const isStudentModel = /sinhvien|student/i.test(modelKey);

        for (let i = 0; i < count; i++) {
            const row = { [idField]: i + 1, id: i + 1 };
            for (const [fName, type] of Object.entries(meta.types || {})) {
                if (fName === idField || fName === "id") continue;
                const lower = fName.toLowerCase();
                if (type === "String") {
                    if (isClassModel && /malop|code|id/i.test(lower)) {
                        row[fName] = ["CNTT01", "CNTT02", "KTPM01", "KHMT01"][i];
                    } else if (isClassModel && /tenlop|name|title/i.test(lower)) {
                        row[fName] = ["Công nghệ thông tin 01", "Công nghệ thông tin 02", "Kỹ thuật phần mềm 01", "Khoa học máy tính 01"][i];
                    } else if (isStudentModel && /hoten|fullname|name/i.test(lower)) {
                        row[fName] = ["Nguyễn Văn An", "Trần Thị Bình", "Lê Hoàng Cường", "Phạm Minh Đức"][i];
                    } else if (isStudentModel && /malop|class/i.test(lower)) {
                        row[fName] = ["CNTT01", "CNTT01", "CNTT02", "KTPM01"][i];
                    } else if (/hoten|fullname|author/.test(lower)) {
                        row[fName] = ["Nguyễn Văn An", "Trần Thị Bình", "Lê Hoàng Cường", "Phạm Minh Đức"][i];
                    } else if (/ma|code|sku/.test(lower)) {
                        row[fName] = "CODE0" + (i + 1);
                    } else if (/ten|name|title/.test(lower)) {
                        row[fName] = (meta.canonicalName || modelKey) + " " + (i + 1);
                    } else if (/email/.test(lower)) {
                        row[fName] = "user" + (i + 1) + "@example.com";
                    } else if (/phone|tel/.test(lower)) {
                        row[fName] = "090123456" + i;
                    } else if (/gioitinh|gender/.test(lower)) {
                        row[fName] = i % 2 === 0 ? "Nam" : "Nữ";
                    } else {
                        row[fName] = fName + "_" + (i + 1);
                    }
                } else if (type === "Int" || type === "Float") {
                    if (/diem|score|rating|grade/.test(lower)) {
                        row[fName] = [8.5, 9.2, 6.8, 4.5][i];
                    } else if (/gia|price|amount|cost/.test(lower)) {
                        row[fName] = (i + 1) * 50000;
                    } else if (/soluong|quantity|stock|count|age/.test(lower)) {
                        row[fName] = [10, 25, 50, 100][i];
                    } else {
                        row[fName] = i + 1;
                    }
                } else if (type === "DateTime") {
                    row[fName] = new Date("2003-0" + (i + 1) + "-15T00:00:00.000Z").toISOString();
                } else if (type === "Boolean") {
                    row[fName] = i % 2 === 0;
                }
            }
            rows.push(row);
        }
        seeds[modelKey] = rows;
    }

    // Second pass: link foreign keys to parents if matching
    for (const modelKey of modelKeys) {
        const meta = schemaModels["__meta_" + modelKey];
        if (!meta || !meta.relations) continue;
        for (const [relName, rel] of Object.entries(meta.relations)) {
            if (!rel.isList && seeds[rel.targetModelLower]) {
                const parentSeeds = seeds[rel.targetModelLower];
                const parentMeta = schemaModels["__meta_" + rel.targetModelLower];
                if (parentMeta?.uniqueFields) {
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
 * Detects database frameworks in the target project by inspecting package.json
 * in the root directory and common candidate subdirectories (server, backend, api, app).
 * 
 * @param {string} rootDir 
 * @returns {{ hasPrisma: boolean, hasMongoose: boolean, hasSequelize: boolean, hasSql: boolean, primaryType: string, prismaModels?: Record<string, any>, prismaSeeds?: Record<string, Array<object>> }}
 */
export const detectProjectDatabase = (rootDir) => {
    const result = {
        hasPrisma: false,
        hasMongoose: false,
        hasSequelize: false,
        hasSql: false,
        primaryType: "NONE",
        prismaModels: {},
        prismaSeeds: {},
    };

    if (!rootDir || typeof rootDir !== "string" || !fs.existsSync(rootDir)) {
        return result;
    }

    const candidateDirs = ["", "server", "backend", "api", "app", "src"];
    const allDependencies = new Set();

    for (const cand of candidateDirs) {
        const pkgPath = cand ? path.join(rootDir, cand, "package.json") : path.join(rootDir, "package.json");
        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
                const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
                Object.keys(deps).forEach((d) => allDependencies.add(d.toLowerCase()));
            } catch (_) {}
        }
    }

    // Check for schema files as secondary signal
    const schemaCandidates = [
        path.join(rootDir, "prisma", "schema.prisma"),
        path.join(rootDir, "server", "prisma", "schema.prisma"),
        path.join(rootDir, "backend", "prisma", "schema.prisma")
    ];
    let foundSchemaPath = null;
    for (const p of schemaCandidates) {
        if (fs.existsSync(p)) {
            foundSchemaPath = p;
            break;
        }
    }

    result.hasPrisma = allDependencies.has("@prisma/client") || allDependencies.has("prisma") || !!foundSchemaPath;
    if (foundSchemaPath) {
        try {
            const schemaContent = fs.readFileSync(foundSchemaPath, "utf8");
            result.prismaModels = parsePrismaSchemaModels(schemaContent);
            result.prismaSeeds = generatePrismaSeeds(result.prismaModels);
        } catch (_) {}
    }

    result.hasMongoose = allDependencies.has("mongoose");
    result.hasSequelize = allDependencies.has("sequelize");
    result.hasSql = allDependencies.has("pg") || allDependencies.has("mysql") || allDependencies.has("mysql2") || allDependencies.has("sqlite3");

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
 * Builds the code for covai.supertest.setup.js that configures environment variables,
 * suppresses teardown errors, and provides in-memory mock proxies for Prisma and Mongoose.
 * 
 * @param {{ hasPrisma?: boolean, hasMongoose?: boolean, prismaModels?: object, prismaSeeds?: object }} dbInfo
 * @returns {string} Setup script content
 */
export const generateSupertestSetupScript = (dbInfo = {}) => {
    return `// ====================================================================
// [CovAI Automated Supertest Setup & Database Mock Environment]
// This file is auto-injected by CovAI to ensure integration tests run
// reliably in isolation without requiring live database services.
// ====================================================================

// 1. Establish deterministic test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = process.env.PORT || '0';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'covai-test-jwt-secret-secure-key-123456789';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://covai:covai@localhost:5432/covai_test_db';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/covai_mock_db';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_covai_mock_stripe_key_123456789';
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

// Mock Stripe library if required by payment routes
try {
  jest.mock('stripe', () => {
    return jest.fn().mockImplementation(() => ({
      checkout: {
        sessions: {
          create: jest.fn().mockResolvedValue({ id: 'cs_test_mock', url: 'https://checkout.stripe.com/mock' })
        }
      },
      paymentIntents: {
        create: jest.fn().mockImplementation(async (params) => {
          if (params && (isNaN(params.amount) || params.amount < 0)) {
            const err = new Error("Stripe API error: Invalid amount");
            err.type = "StripeInvalidRequestError";
            throw err;
          }
          return { id: 'pi_test_mock', client_secret: 'pi_test_secret_mock' };
        })
      }
    }));
  });
} catch (_) {}

// 3. Schema-Aware In-Memory Prisma Client Mock
${dbInfo.hasPrisma !== false ? `
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
        const idVal = s[idField] !== undefined ? Number(s[idField]) : autoIncId;
        storeMap.set(idVal, { ...s });
        if (idVal >= autoIncId) autoIncId = idVal + 1;
      }
      modelStores.set(lower, { map: storeMap, autoIncId, meta, modelName });
    }
    return modelStores.get(lower);
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
    const storeObj = getStore(modelName);
    const meta = storeObj.meta;
    const idField = meta.idField || 'id';
    const requiredFields = schemaModels[modelName.toLowerCase()] || [];

    return {
      findMany: jest.fn(async (params = {}) => {
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
        const idVal = data[idField] !== undefined ? Number(data[idField]) : storeObj.autoIncId++;
        const record = { [idField]: idVal, id: idVal, ...data };
        storeObj.map.set(idVal, record);
        return applyIncludeAndSelect(record, params, modelName);
      }),

      createMany: jest.fn(async (params = {}) => {
        const dataList = Array.isArray(params.data) ? params.data : [];
        dataList.forEach(data => {
          const idVal = data[idField] !== undefined ? Number(data[idField]) : storeObj.autoIncId++;
          storeObj.map.set(idVal, { [idField]: idVal, id: idVal, ...data });
        });
        return { count: dataList.length };
      }),

      update: jest.fn(async (params = {}) => {
        const where = params.where || {};
        let targetId = null;
        for (const [id, it] of storeObj.map.entries()) {
          if (matchesWhere(it, where, idField)) {
            targetId = id;
            break;
          }
        }
        if (targetId === null) {
          throw new Error('Record to update not found (id: ' + JSON.stringify(where) + ')');
        }
        const existing = storeObj.map.get(targetId);
        const updated = { ...existing, ...(params.data || {}) };
        storeObj.map.set(targetId, updated);
        return applyIncludeAndSelect(updated, params, modelName);
      }),

      updateMany: jest.fn(async (params = {}) => {
        return { count: 1 };
      }),

      delete: jest.fn(async (params = {}) => {
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
          throw new Error('Record to delete does not exist (id: ' + JSON.stringify(where) + ')');
        }
        storeObj.map.delete(targetId);
        return targetRecord;
      }),

      deleteMany: jest.fn(async (params = {}) => {
        const count = storeObj.map.size;
        storeObj.map.clear();
        return { count };
      }),

      count: jest.fn(async (params = {}) => {
        if (!params.where) return storeObj.map.size || 1;
        return Array.from(storeObj.map.values()).filter(it => matchesWhere(it, params.where, idField)).length;
      }),

      aggregate: jest.fn(async (params = {}) => {
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
    const handler = {
      get(target, prop) {
        if (prop === '$connect') return jest.fn().mockResolvedValue(true);
        if (prop === '$disconnect') return jest.fn().mockResolvedValue(true);
        if (prop === '$transaction') return jest.fn(async (arg) => {
          if (typeof arg === 'function') return arg(target);
          if (Array.isArray(arg)) return Promise.all(arg);
          return arg;
        });
        if (prop === '$executeRaw' || prop === '$queryRaw') return jest.fn().mockResolvedValue([]);
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
    return new Proxy({}, handler);
  };

  jest.mock('@prisma/client', () => {
    return {
      PrismaClient: jest.fn().mockImplementation(() => createPrismaClientMock())
    };
  }, { virtual: true });
} catch (e) {
  // Prisma mock registration warning (non-fatal)
}
` : ''}

// 4. In-memory Mongoose Mock
${dbInfo.hasMongoose !== false ? `
try {
  const createQueryChain = (result) => {
    const query = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(result),
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      catch: (reject) => Promise.resolve(result).catch(reject),
    };
    return query;
  };

  const createMongooseMock = () => {
    const models = new Map();

    const mockModel = (name) => {
      const Model = jest.fn().mockImplementation((data) => ({
        ...data,
        _id: '507f191e810c19729de860ea',
        save: jest.fn().mockResolvedValue({ _id: '507f191e810c19729de860ea', ...data }),
      }));

      Model.find = jest.fn(() => createQueryChain([{ _id: '507f191e810c19729de860ea', name: 'Sample ' + name }]));
      Model.findOne = jest.fn(() => createQueryChain({ _id: '507f191e810c19729de860ea', name: 'Sample ' + name }));
      Model.findById = jest.fn(() => createQueryChain({ _id: '507f191e810c19729de860ea', name: 'Sample ' + name }));
      Model.findByIdAndUpdate = jest.fn((id, data) => createQueryChain({ _id: id, ...data }));
      Model.findByIdAndDelete = jest.fn((id) => createQueryChain({ _id: id }));
      Model.create = jest.fn(async (data) => ({ _id: '507f191e810c19729de860ea', ...data }));
      Model.countDocuments = jest.fn(() => createQueryChain(1));
      Model.aggregate = jest.fn().mockResolvedValue([]);
      return Model;
    };

    return {
      connect: jest.fn().mockResolvedValue(true),
      disconnect: jest.fn().mockResolvedValue(true),
      connection: {
        readyState: 1,
        on: jest.fn(),
        once: jest.fn(),
        close: jest.fn().mockResolvedValue(true),
      },
      Schema: jest.fn().mockImplementation(() => ({
        pre: jest.fn().mockReturnThis(),
        post: jest.fn().mockReturnThis(),
        plugin: jest.fn().mockReturnThis(),
        methods: {},
        statics: {},
      })),
      model: jest.fn((name) => {
        if (!models.has(name)) models.set(name, mockModel(name));
        return models.get(name);
      }),
    };
  };

  jest.mock('mongoose', () => createMongooseMock(), { virtual: true });
} catch (e) {
  // Mongoose mock registration warning (non-fatal)
}
` : ''}
`;
};

/**
 * Ensures that the covai.supertest.setup.js file exists in the target project root,
 * creating it inside <rootDir>/.covai-temp/covai.supertest.setup.js.
 * 
 * @param {string} rootDir Project root directory
 * @returns {{ absolutePath: string, relativePath: string, dbInfo: object }}
 */
export const ensureSupertestDatabaseSetupFile = (rootDir) => {
    if (!rootDir || typeof rootDir !== "string" || !fs.existsSync(rootDir)) {
        throw new Error("Invalid root directory provided for Supertest setup file generation.");
    }

    const dbInfo = detectProjectDatabase(rootDir);
    const tempDir = path.join(rootDir, ".covai-temp");
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const setupFilePath = path.join(tempDir, "covai.supertest.setup.js");
    const scriptContent = generateSupertestSetupScript(dbInfo);
    fs.writeFileSync(setupFilePath, scriptContent, "utf8");

    const relativePath = path.relative(rootDir, setupFilePath).replace(/\\/g, "/");
    return {
        absolutePath: setupFilePath,
        relativePath,
        dbInfo,
    };
};
