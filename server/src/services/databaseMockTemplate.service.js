import fs from "fs";
import path from "path";

/**
 * Detects database frameworks in the target project by inspecting package.json
 * in the root directory and common candidate subdirectories (server, backend, api, app).
 * 
 * @param {string} rootDir 
 * @returns {{ hasPrisma: boolean, hasMongoose: boolean, hasSequelize: boolean, hasSql: boolean, primaryType: string }}
 */
/**
 * Parses a Prisma schema file and extracts required scalar fields per model.
 * A field is required if it is scalar, non-optional (no ?), has no @default, and is not @id.
 * 
 * @param {string} schemaContent 
 * @returns {Record<string, string[]>} Map of lowercase model name to required field names
 */
export const parsePrismaSchemaModels = (schemaContent) => {
    if (!schemaContent || typeof schemaContent !== "string") return {};
    const models = {};
    const modelBlocks = schemaContent.match(/model\s+(\w+)\s*\{([^}]+)\}/g) || [];
    for (const block of modelBlocks) {
        const match = block.match(/model\s+(\w+)\s*\{([^}]+)\}/);
        if (!match) continue;
        const modelName = match[1].toLowerCase();
        const body = match[2];
        const lines = body.split("\n");
        const requiredFields = [];
        const fieldTypes = {};
        const optionalFields = [];
        const defaultFields = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue;
            const tokens = trimmed.split(/\s+/);
            if (tokens.length >= 2) {
                const fieldName = tokens[0];
                const rawType = tokens[1];
                const isOptional = rawType.endsWith("?");
                const baseType = rawType.replace("?", "");
                const isId = trimmed.includes("@id");
                const hasDefault = trimmed.includes("@default");
                const isScalar = /^(String|Int|Float|Boolean|DateTime|Json|Decimal|BigInt|Bytes)/.test(baseType);

                if (isScalar) {
                    fieldTypes[fieldName] = baseType;
                    if (isId || hasDefault) {
                        defaultFields.push(fieldName);
                    } else if (isOptional) {
                        optionalFields.push(fieldName);
                    } else {
                        requiredFields.push(fieldName);
                    }
                }
            }
        }
        models[modelName] = requiredFields;
        models[`__meta_${modelName}`] = {
            required: requiredFields,
            types: fieldTypes,
            optional: optionalFields,
            defaults: defaultFields
        };
    }
    return models;
};

/**
 * Detects database frameworks in the target project by inspecting package.json
 * in the root directory and common candidate subdirectories (server, backend, api, app).
 * 
 * @param {string} rootDir 
 * @returns {{ hasPrisma: boolean, hasMongoose: boolean, hasSequelize: boolean, hasSql: boolean, primaryType: string, prismaModels?: Record<string, string[]> }}
 */
export const detectProjectDatabase = (rootDir) => {
    const result = {
        hasPrisma: false,
        hasMongoose: false,
        hasSequelize: false,
        hasSql: false,
        primaryType: "NONE",
        prismaModels: {},
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
 * @param {{ hasPrisma?: boolean, hasMongoose?: boolean }} dbInfo
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

// 3. In-memory Prisma Client Mock
${dbInfo.hasPrisma !== false ? `
try {
  const schemaModels = ${JSON.stringify(dbInfo.prismaModels || {})};

  const createModelStore = (modelName) => {
    const requiredFields = schemaModels[modelName.toLowerCase()] || [];
    const store = new Map([
      [1, { id: 1, name: 'Sample ' + modelName, price: 50000, rating: 4.5, image: 'sample.jpg', isAvailable: true }]
    ]);
    let autoIncId = 2;

    const matchesWhere = (item, where) => {
      if (!where || typeof where !== 'object') return true;
      for (const [key, val] of Object.entries(where)) {
        if (key === 'mode') continue;
        if (val !== undefined && val !== null && typeof val === 'object') {
          if (val.contains !== undefined) {
            const itemVal = String(item[key] || '');
            if (!itemVal.toLowerCase().includes(String(val.contains).toLowerCase())) return false;
            continue;
          }
        }
        if (item[key] !== undefined && item[key] != val) {
          return false;
        }
      }
      return true;
    };

    return {
      findMany: jest.fn(async (params = {}) => {
        let items = Array.from(store.values());
        if (params.where) {
          items = items.filter(it => matchesWhere(it, params.where));
        }
        const skip = params.skip || 0;
        const take = params.take !== undefined ? params.take : items.length;
        return items.slice(skip, skip + take);
      }),

      findUnique: jest.fn(async (params = {}) => {
        const where = params.where || {};
        if (where.id !== undefined && store.has(Number(where.id))) {
          return store.get(Number(where.id));
        }
        for (const it of store.values()) {
          if (matchesWhere(it, where)) return it;
        }
        return null;
      }),

      findFirst: jest.fn(async (params = {}) => {
        for (const it of store.values()) {
          if (matchesWhere(it, params.where)) return it;
        }
        return Array.from(store.values())[0] || null;
      }),

      create: jest.fn(async (params = {}) => {
        const data = params.data || {};
        const meta = schemaModels['__meta_' + modelName.toLowerCase()] || {};
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
        const id = data.id !== undefined ? Number(data.id) : autoIncId++;
        const record = { id, ...data };
        store.set(id, record);
        return record;
      }),

      createMany: jest.fn(async (params = {}) => {
        const dataList = Array.isArray(params.data) ? params.data : [];
        dataList.forEach(data => {
          const id = data.id !== undefined ? Number(data.id) : autoIncId++;
          store.set(id, { id, ...data });
        });
        return { count: dataList.length };
      }),

      update: jest.fn(async (params = {}) => {
        const where = params.where || {};
        const id = where.id !== undefined ? Number(where.id) : 1;
        if (!store.has(id)) {
          throw new Error('Record to update not found (id: ' + where.id + ')');
        }
        const existing = store.get(id);
        const updated = { ...existing, ...(params.data || {}) };
        store.set(id, updated);
        return updated;
      }),

      updateMany: jest.fn(async (params = {}) => {
        return { count: 1 };
      }),

      delete: jest.fn(async (params = {}) => {
        const where = params.where || {};
        const id = where.id !== undefined ? Number(where.id) : 1;
        if (!store.has(id)) {
          throw new Error('Record to delete does not exist (id: ' + where.id + ')');
        }
        const existing = store.get(id);
        store.delete(id);
        return existing;
      }),

      deleteMany: jest.fn(async (params = {}) => {
        const count = store.size;
        store.clear();
        return { count };
      }),

      count: jest.fn(async (params = {}) => {
        if (!params.where) return store.size || 1;
        return Array.from(store.values()).filter(it => matchesWhere(it, params.where)).length || 1;
      }),

      upsert: jest.fn(async (params = {}) => {
        const where = params.where || {};
        const id = where.id !== undefined ? Number(where.id) : autoIncId++;
        const record = { id, ...(params.update || params.create || {}) };
        store.set(id, record);
        return record;
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
