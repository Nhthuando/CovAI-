process.env.PROJECT_STORAGE_DRIVER = "local";

const {
  extractEnvReferencesFromAst,
  mergeVariableReferences,
  inferMockValue,
} = await import("./src/services/environmentDetection.service.js");

const { parseJavaScriptCode } = await import("./src/services/babelParser.service.js");

const testCases = [
  // =========================================================================
  // CATEGORY 1: Shadowed process Identifiers
  // =========================================================================
  {
    id: "CHALLENGE-1.1",
    category: "1. Shadowed process Identifiers",
    description: "Local const process = { env: { LOCAL_SHADOW: 'val' } }",
    code: `
      function test() {
        const process = { env: { LOCAL_SHADOW: "val" } };
        return process.env.LOCAL_SHADOW;
      }
    `,
    verify: (refs, merged) => {
      // If process is shadowed locally, LOCAL_SHADOW must NOT be reported as a system process.env variable.
      const found = refs.some((r) => r.name === "LOCAL_SHADOW");
      return {
        passed: !found,
        details: found
          ? `FAILED: Identified shadowed variable 'LOCAL_SHADOW' as system env var`
          : `PASSED: Correctly ignored shadowed process identifier`,
      };
    },
  },
  {
    id: "CHALLENGE-1.2",
    category: "1. Shadowed process Identifiers",
    description: "Function parameter shadowing process",
    code: `
      function processFile(process) {
        return process.env.PARAM_SHADOW;
      }
    `,
    verify: (refs, merged) => {
      const found = refs.some((r) => r.name === "PARAM_SHADOW");
      return {
        passed: !found,
        details: found
          ? `FAILED: Identified parameter-shadowed variable 'PARAM_SHADOW' as system env var`
          : `PASSED: Correctly ignored shadowed parameter process`,
      };
    },
  },
  {
    id: "CHALLENGE-1.3",
    category: "1. Shadowed process Identifiers",
    description: "Class method parameter shadowing process",
    code: `
      class Worker {
        run(process) {
          console.log(process.env.CLASS_SHADOW);
        }
      }
    `,
    verify: (refs, merged) => {
      const found = refs.some((r) => r.name === "CLASS_SHADOW");
      return {
        passed: !found,
        details: found
          ? `FAILED: Identified method parameter-shadowed variable 'CLASS_SHADOW'`
          : `PASSED: Correctly ignored method parameter process`,
      };
    },
  },
  {
    id: "CHALLENGE-1.4",
    category: "1. Shadowed process Identifiers",
    description: "Catch clause parameter shadowing process",
    code: `
      try {
        doSomething();
      } catch (process) {
        console.log(process.env.CATCH_SHADOW);
      }
    `,
    verify: (refs, merged) => {
      const found = refs.some((r) => r.name === "CATCH_SHADOW");
      return {
        passed: !found,
        details: found
          ? `FAILED: Identified catch parameter-shadowed variable 'CATCH_SHADOW'`
          : `PASSED: Correctly ignored catch parameter process`,
      };
    },
  },

  // =========================================================================
  // CATEGORY 2: Nested Object Pattern Destructuring with Mixed Defaults
  // =========================================================================
  {
    id: "CHALLENGE-2.1",
    category: "2. Nested Object Pattern Destructuring",
    description: "Nested object destructuring with defaults: const { server: { port = 3000 } = {} } = process.env",
    code: `
      const {
        server: { port = 3000, host = "localhost" } = {},
        database: { url } = {}
      } = process.env;
    `,
    verify: (refs, merged) => {
      // If nested destructuring is present, either nested properties ('port', 'host', 'url') should be detected,
      // OR intermediate container object names ('server', 'database') should NOT be falsely registered as env variables with mock '{}'.
      const hasBogusServer = refs.some((r) => r.name === "server" && r.defaultValue === "{}");
      const hasBogusDb = refs.some((r) => r.name === "database" && r.defaultValue === "{}");
      const detectedPort = refs.some((r) => r.name === "port");
      return {
        passed: !hasBogusServer && !hasBogusDb && detectedPort,
        details: `hasBogusServer: ${hasBogusServer}, hasBogusDb: ${hasBogusDb}, detectedNestedPort: ${detectedPort}. Detected refs: ${JSON.stringify(
          refs.map((r) => ({ name: r.name, defaultValue: r.defaultValue }))
        )}`,
      };
    },
  },
  {
    id: "CHALLENGE-2.2",
    category: "2. Nested Object Pattern Destructuring",
    description: "Destructuring process directly: const { env: { PORT = 3000, SECRET } } = process",
    code: `
      const {
        env: { PORT = 3000, SECRET }
      } = process;
    `,
    verify: (refs, merged) => {
      const hasPort = refs.some((r) => r.name === "PORT");
      const hasSecret = refs.some((r) => r.name === "SECRET");
      return {
        passed: hasPort && hasSecret,
        details: `hasPort: ${hasPort}, hasSecret: ${hasSecret}. Refs: ${JSON.stringify(refs.map((r) => r.name))}`,
      };
    },
  },
  {
    id: "CHALLENGE-2.3",
    category: "2. Nested Object Pattern Destructuring",
    description: "Renamed destructuring: const { PORT: serverPort = 8080, DB_URL: dbUrl } = process.env",
    code: `
      const { PORT: serverPort = 8080, DB_URL: dbUrl } = process.env;
    `,
    verify: (refs, merged) => {
      const portRef = refs.find((r) => r.name === "PORT");
      const dbRef = refs.find((r) => r.name === "DB_URL");
      const passed = portRef && portRef.defaultValue === "8080" && dbRef && !dbRef.hasDefault;
      return {
        passed: Boolean(passed),
        details: `portRef: ${JSON.stringify(portRef)}, dbRef: ${JSON.stringify(dbRef)}`,
      };
    },
  },

  // =========================================================================
  // CATEGORY 3: Complex Chained Logical Expressions
  // =========================================================================
  {
    id: "CHALLENGE-3.1",
    category: "3. Complex Chained Logical Expressions",
    description: "Chained fallback with final literal default: process.env.A || process.env.B || 'default'",
    code: `
      const val = process.env.VAR_A || process.env.VAR_B || "default_val";
    `,
    verify: (refs, merged) => {
      const a = refs.find((r) => r.name === "VAR_A");
      const b = refs.find((r) => r.name === "VAR_B");
      const passed = a?.hasDefault && a?.defaultValue === "default_val" && b?.hasDefault && b?.defaultValue === "default_val";
      return {
        passed: Boolean(passed),
        details: `VAR_A default: ${a?.defaultValue}, VAR_B default: ${b?.defaultValue}`,
      };
    },
  },
  {
    id: "CHALLENGE-3.2",
    category: "3. Complex Chained Logical Expressions",
    description: "Chained fallback WITHOUT literal default: process.env.AUTH_TOKEN || process.env.API_KEY",
    code: `
      const token = process.env.AUTH_TOKEN || process.env.API_KEY;
    `,
    verify: (refs, merged) => {
      // In process.env.AUTH_TOKEN || process.env.API_KEY, neither variable has a literal default value.
      // AUTH_TOKEN must NOT be assigned defaultValue='process.env.API_KEY', and must NOT be marked hasDefault: true.
      const a = refs.find((r) => r.name === "AUTH_TOKEN");
      const aMerged = merged.find((m) => m.name === "AUTH_TOKEN");
      const flawed = a?.defaultValue === "process.env.API_KEY" || aMerged?.inferredMock === "process.env.API_KEY";
      return {
        passed: !flawed && !a?.hasDefault,
        details: `AUTH_TOKEN hasDefault: ${a?.hasDefault}, defaultValue: ${JSON.stringify(a?.defaultValue)}, inferredMock: ${JSON.stringify(
          aMerged?.inferredMock
        )}`,
      };
    },
  },
  {
    id: "CHALLENGE-3.3",
    category: "3. Complex Chained Logical Expressions",
    description: "Nullish coalescing chain: process.env.TIMEOUT_MS ?? process.env.DEFAULT_TIMEOUT ?? 5000",
    code: `
      const timeout = process.env.TIMEOUT_MS ?? process.env.DEFAULT_TIMEOUT ?? 5000;
    `,
    verify: (refs, merged) => {
      const a = refs.find((r) => r.name === "TIMEOUT_MS");
      const b = refs.find((r) => r.name === "DEFAULT_TIMEOUT");
      const passed = a?.hasDefault && a?.defaultValue === "5000" && b?.hasDefault && b?.defaultValue === "5000";
      return {
        passed: Boolean(passed),
        details: `TIMEOUT_MS default: ${a?.defaultValue}, DEFAULT_TIMEOUT default: ${b?.defaultValue}`,
      };
    },
  },
  {
    id: "CHALLENGE-3.4",
    category: "3. Complex Chained Logical Expressions",
    description: "Logical AND expression: process.env.FLAG && process.env.SECRET",
    code: `
      const active = process.env.FLAG && process.env.SECRET;
    `,
    verify: (refs, merged) => {
      const a = refs.find((r) => r.name === "FLAG");
      const b = refs.find((r) => r.name === "SECRET");
      const passed = !a?.hasDefault && !b?.hasDefault;
      return {
        passed: Boolean(passed),
        details: `FLAG hasDefault: ${a?.hasDefault}, SECRET hasDefault: ${b?.hasDefault}`,
      };
    },
  },

  // =========================================================================
  // CATEGORY 4: TypeScript Type Casts
  // =========================================================================
  {
    id: "CHALLENGE-4.1",
    category: "4. TypeScript Type Casts",
    description: "TS as casting with fallback: (process.env.PORT as unknown as number) || 3000",
    code: `
      const port = (process.env.PORT as unknown as number) || 3000;
    `,
    verify: (refs, merged) => {
      const port = refs.find((r) => r.name === "PORT");
      const passed = port && port.hasDefault && port.defaultValue === "3000";
      return {
        passed: Boolean(passed),
        details: `PORT ref: ${JSON.stringify(port)}`,
      };
    },
  },
  {
    id: "CHALLENGE-4.2",
    category: "4. TypeScript Type Casts",
    description: "TS non-null assertion: process.env.JWT_SECRET!",
    code: `
      const secret = process.env.JWT_SECRET!;
    `,
    verify: (refs, merged) => {
      const secret = refs.find((r) => r.name === "JWT_SECRET");
      const secretMerged = merged.find((m) => m.name === "JWT_SECRET");
      const passed = secret && secretMerged?.required === true;
      return {
        passed: Boolean(passed),
        details: `JWT_SECRET ref: ${JSON.stringify(secret)}, merged: ${JSON.stringify(secretMerged)}`,
      };
    },
  },
  {
    id: "CHALLENGE-4.3",
    category: "4. TypeScript Type Casts",
    description: "TS satisfies operator: (process.env.PORT satisfies string) || '3000'",
    code: `
      const port = (process.env.PORT satisfies string) || "3000";
    `,
    verify: (refs, merged) => {
      const port = refs.find((r) => r.name === "PORT");
      const passed = port && port.hasDefault && port.defaultValue === "3000";
      return {
        passed: Boolean(passed),
        details: `PORT ref: ${JSON.stringify(port)}`,
      };
    },
  },
  {
    id: "CHALLENGE-4.4",
    category: "4. TypeScript Type Casts",
    description: "TS cast on destructuring: const { PORT = 3000, DB_URL } = (process.env as any)",
    code: `
      const { PORT = 3000, DB_URL } = (process.env as any);
    `,
    verify: (refs, merged) => {
      const port = refs.find((r) => r.name === "PORT");
      const db = refs.find((r) => r.name === "DB_URL");
      const passed = port && db;
      return {
        passed: Boolean(passed),
        details: `PORT detected: ${Boolean(port)}, DB_URL detected: ${Boolean(db)}. Refs: ${JSON.stringify(refs)}`,
      };
    },
  },
  {
    id: "CHALLENGE-4.5",
    category: "4. TypeScript Type Casts",
    description: "TS type assertion in if guard: if (!(process.env.API_KEY as string)) throw new Error()",
    code: `
      if (!(process.env.API_KEY as string)) {
        throw new Error("Missing API_KEY");
      }
    `,
    verify: (refs, merged) => {
      const apiKey = refs.find((r) => r.name === "API_KEY");
      const passed = apiKey && apiKey.required === true && apiKey.guardType === "guard_throw_mandatory";
      return {
        passed: Boolean(passed),
        details: `API_KEY ref: ${JSON.stringify(apiKey)}`,
      };
    },
  },

  // =========================================================================
  // CATEGORY 5: Guard Clauses Combined with Early Returns or Throws
  // =========================================================================
  {
    id: "CHALLENGE-5.1",
    category: "5. Guard Clauses Combined with Early Returns or Throws",
    description: "Guard clause with early return: if (!process.env.OPTIONAL_FLAG) return;",
    code: `
      function run() {
        if (!process.env.OPTIONAL_FLAG) {
          return;
        }
        doWork();
      }
    `,
    verify: (refs, merged) => {
      const flag = merged.find((m) => m.name === "OPTIONAL_FLAG");
      const passed = flag && flag.required === false;
      return {
        passed: Boolean(passed),
        details: `OPTIONAL_FLAG required: ${flag?.required}`,
      };
    },
  },
  {
    id: "CHALLENGE-5.2",
    category: "5. Guard Clauses Combined with Early Returns or Throws",
    description: "Guard clause with return process.exit(1)",
    code: `
      if (!process.env.REQUIRED_EXIT) {
        console.error("Missing REQUIRED_EXIT");
        return process.exit(1);
      }
    `,
    verify: (refs, merged) => {
      const exitVar = refs.find((r) => r.name === "REQUIRED_EXIT");
      const mergedVar = merged.find((m) => m.name === "REQUIRED_EXIT");
      const passed = exitVar?.guardType === "guard_throw_mandatory" && mergedVar?.required === true;
      return {
        passed: Boolean(passed),
        details: `REQUIRED_EXIT guardType: ${exitVar?.guardType}, required: ${mergedVar?.required}`,
      };
    },
  },
  {
    id: "CHALLENGE-5.3",
    category: "5. Guard Clauses Combined with Early Returns or Throws",
    description: "Guard clause with logical OR: if (!process.env.DB_USER || !process.env.DB_PASS) throw new Error()",
    code: `
      if (!process.env.DB_USER || !process.env.DB_PASS) {
        throw new Error("Missing database credentials");
      }
    `,
    verify: (refs, merged) => {
      const u = refs.find((r) => r.name === "DB_USER");
      const p = refs.find((r) => r.name === "DB_PASS");
      const uMerged = merged.find((m) => m.name === "DB_USER");
      const pMerged = merged.find((m) => m.name === "DB_PASS");
      const passed = u?.guardType === "guard_throw_mandatory" && p?.guardType === "guard_throw_mandatory" && uMerged?.required && pMerged?.required;
      return {
        passed: Boolean(passed),
        details: `DB_USER guardType: ${u?.guardType}, required: ${uMerged?.required}; DB_PASS guardType: ${p?.guardType}, required: ${pMerged?.required}`,
      };
    },
  },
  {
    id: "CHALLENGE-5.4",
    category: "5. Guard Clauses Combined with Early Returns or Throws",
    description: "Unrelated assignment in guard: if (!process.env.API_KEY) { status = 'failed'; }",
    code: `
      if (!process.env.API_KEY) {
        status = "failed";
      }
    `,
    verify: (refs, merged) => {
      const apiKey = refs.find((r) => r.name === "API_KEY");
      // Status = 'failed' should NOT be attributed to API_KEY as its default value!
      const passed = apiKey && apiKey.defaultValue !== "failed" && apiKey.guardType !== "guard_assign_fallback";
      return {
        passed: Boolean(passed),
        details: `API_KEY guardType: ${apiKey?.guardType}, defaultValue: ${apiKey?.defaultValue}`,
      };
    },
  },
  {
    id: "CHALLENGE-5.5",
    category: "5. Guard Clauses Combined with Early Returns or Throws",
    description: "Inverted equality guard: if (undefined === process.env.MANDATORY_KEY) throw ...",
    code: `
      if (undefined === process.env.MANDATORY_KEY) {
        throw new Error("MANDATORY_KEY required");
      }
    `,
    verify: (refs, merged) => {
      const k = refs.find((r) => r.name === "MANDATORY_KEY");
      const m = merged.find((r) => r.name === "MANDATORY_KEY");
      const passed = k?.guardType === "guard_throw_mandatory" && m?.required === true;
      return {
        passed: Boolean(passed),
        details: `MANDATORY_KEY guardType: ${k?.guardType}, required: ${m?.required}`,
      };
    },
  },
  {
    id: "CHALLENGE-5.6",
    category: "5. Guard Clauses Combined with Early Returns or Throws",
    description: "Typeof guard check: if (typeof process.env.SECRET_KEY === 'undefined') throw ...",
    code: `
      if (typeof process.env.SECRET_KEY === "undefined") {
        throw new Error("SECRET_KEY required");
      }
    `,
    verify: (refs, merged) => {
      const k = refs.find((r) => r.name === "SECRET_KEY");
      const m = merged.find((r) => r.name === "SECRET_KEY");
      const passed = k?.guardType === "guard_throw_mandatory" && m?.required === true;
      return {
        passed: Boolean(passed),
        details: `SECRET_KEY guardType: ${k?.guardType}, required: ${m?.required}`,
      };
    },
  },
];

console.log("\n=======================================================");
console.log("     EMPIRICAL CHALLENGER TEST RESULTS MATRIX");
console.log("=======================================================\n");

let passedCount = 0;
let failedCount = 0;
const failureReport = [];

for (const tc of testCases) {
  const parsed = parseJavaScriptCode(tc.code, { filePath: "test.ts" });
  if (!parsed?.ast) {
    console.log(`[FAIL] ${tc.id}: ${tc.description}`);
    console.log(`       Details: PARSE ERROR\n`);
    failedCount++;
    failureReport.push({ id: tc.id, description: tc.description, reason: "PARSE ERROR" });
    continue;
  }

  const refs = extractEnvReferencesFromAst(parsed.ast, "test.ts");
  const grouped = {};
  for (const r of refs) {
    if (!grouped[r.name]) grouped[r.name] = [];
    grouped[r.name].push(r);
  }

  const merged = [];
  for (const [k, v] of Object.entries(grouped)) {
    merged.push(mergeVariableReferences(k, v, {}, inferMockValue));
  }

  const result = tc.verify(refs, merged);
  if (result.passed) {
    console.log(`[PASS] ${tc.id}: ${tc.description}`);
    console.log(`       ${result.details}\n`);
    passedCount++;
  } else {
    console.log(`[FAIL] ${tc.id}: ${tc.description}`);
    console.log(`       ${result.details}\n`);
    failedCount++;
    failureReport.push({ id: tc.id, description: tc.description, reason: result.details });
  }
}

console.log("=======================================================");
console.log(`TOTAL: ${testCases.length} | PASSED: ${passedCount} | FAILED: ${failedCount}`);
console.log("=======================================================\n");

if (failedCount > 0) {
  console.log("FAILURES REQUIRING REMEDIATION OR ARCHITECTURAL REVIEW:");
  for (const f of failureReport) {
    console.log(`- ${f.id} (${f.description}):\n  ${f.reason}`);
  }
}
