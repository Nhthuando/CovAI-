process.env.PROJECT_STORAGE_DRIVER = "local";

const {
  isProcessIdentifierValid,
  isProcessEnvNode,
  isEnvObjectOrAlias,
  unwrapTsAndParens,
  unwrapTsAndLogical,
  extractPropertyName,
  extractDefaultValueFromNode,
  getTerminalRightNode,
  isProcessEnvReference,
  findLogicalFallbackNode,
  hasFallbackExpression,
  detectMissingEnvCondition,
  findEnclosingIfGuard,
  isExitOrAbortCall,
  isThrowOrExitStatement,
  isTargetMatchingVar,
  analyzeReferenceFallbackAndGuard,
  extractEnvReferencesFromAst,
  mergeVariableReferences,
  detectProjectEnvironment,
  parseEnv,
  serializeEnv,
  inferMockValue,
  generateHermeticMockEnvironment,
} = await import("./src/services/environmentDetection.service.js");
const { parseJavaScriptCode } = await import("./src/services/babelParser.service.js");

const results = [];
let passCount = 0;
let failCount = 0;

function runTest(id, name, fn) {
  try {
    fn();
    passCount++;
    console.log(`[PASS] ${id}: ${name}`);
    results.push({ id, name, passed: true });
  } catch (err) {
    failCount++;
    console.error(`[FAIL] ${id}: ${name}\n       ERROR: ${err.message}`);
    results.push({ id, name, passed: false, error: err.message });
  }
}

function parse(code) {
  const res = parseJavaScriptCode(code, { filename: "test.ts" });
  return res.ast;
}

console.log("=======================================================");
console.log("     EMPIRICAL STRESS TEST SUITE (ADVERSARIAL)");
console.log("=======================================================\n");

// --- SUITE 1: SCOPE SHADOWING STRESS ---

runTest("STRESS-1.1", "Nested inner shadow with outer legitimate access", () => {
  const code = `
    const outerA = process.env.REAL_OUTER_1;
    function worker(process) {
      const innerA = process.env.SHADOWED_INNER;
      return innerA;
    }
    const outerB = process.env.REAL_OUTER_2;
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const names = refs.map((r) => r.name);
  if (!names.includes("REAL_OUTER_1") || !names.includes("REAL_OUTER_2")) {
    throw new Error(`Expected real outer vars to be detected: ${JSON.stringify(names)}`);
  }
  if (names.includes("SHADOWED_INNER")) {
    throw new Error(`Shadowed inner var was incorrectly detected: ${JSON.stringify(names)}`);
  }
});

runTest("STRESS-1.2", "Block scope let/const shadowing process", () => {
  const code = `
    {
      const process = { env: { BLOCK_VAR: "hidden" } };
      console.log(process.env.BLOCK_VAR);
    }
    console.log(process.env.AFTER_BLOCK);
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const names = refs.map((r) => r.name);
  if (names.includes("BLOCK_VAR")) {
    throw new Error("Block-shadowed process var was detected");
  }
  if (!names.includes("AFTER_BLOCK")) {
    throw new Error("Global process var after block was not detected");
  }
});

runTest("STRESS-1.3", "For-of loop variable shadowing process", () => {
  const code = `
    for (const process of processes) {
      console.log(process.env.LOOP_VAR);
    }
    console.log(process.env.GLOBAL_AFTER_LOOP);
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const names = refs.map((r) => r.name);
  if (names.includes("LOOP_VAR")) {
    throw new Error("Loop-shadowed process var was detected");
  }
  if (!names.includes("GLOBAL_AFTER_LOOP")) {
    throw new Error("Global process var after loop was not detected");
  }
});

runTest("STRESS-1.4", "Arrow function parameter shadowing process", () => {
  const code = `
    const fn = (process) => process.env.ARROW_SHADOW;
    const direct = process.env.DIRECT_GLOBAL;
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const names = refs.map((r) => r.name);
  if (names.includes("ARROW_SHADOW")) {
    throw new Error("Arrow parameter-shadowed process var was detected");
  }
  if (!names.includes("DIRECT_GLOBAL")) {
    throw new Error("Direct global was not detected");
  }
});

runTest("STRESS-1.5", "Legitimate node:process CJS require vs local shadow", () => {
  const code = `
    const process = require("node:process");
    const valid = process.env.LEGIT_CJS_VAR;
    function shadow(process) {
      return process.env.PARAM_SHADOW_CJS;
    }
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const names = refs.map((r) => r.name);
  if (!names.includes("LEGIT_CJS_VAR")) {
    throw new Error("Legitimate node:process require was not detected");
  }
  if (names.includes("PARAM_SHADOW_CJS")) {
    throw new Error("Param shadow inside node:process file was incorrectly detected");
  }
});

// --- SUITE 2: DEEPLY NESTED & COMPLEX DESTRUCTURING ---

runTest("STRESS-2.1", "3-level deep object destructuring with intermediate and leaf defaults", () => {
  const code = `
    const {
      infra: {
        network: {
          PORT = 9000,
          HOST = "0.0.0.0",
          TLS_CERT
        } = {}
      } = {}
    } = process.env;
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const names = refs.map((r) => r.name);
  if (names.includes("infra") || names.includes("network")) {
    throw new Error(`Intermediate pattern keys were captured as variables: ${JSON.stringify(names)}`);
  }
  const portRef = refs.find((r) => r.name === "PORT");
  const hostRef = refs.find((r) => r.name === "HOST");
  const certRef = refs.find((r) => r.name === "TLS_CERT");
  if (!portRef || portRef.defaultValue !== "9000" || !portRef.hasDefault) {
    throw new Error(`PORT default invalid: ${JSON.stringify(portRef)}`);
  }
  if (!hostRef || hostRef.defaultValue !== "0.0.0.0" || !hostRef.hasDefault) {
    throw new Error(`HOST default invalid: ${JSON.stringify(hostRef)}`);
  }
  if (!certRef || certRef.hasDefault) {
    throw new Error(`TLS_CERT should not have default: ${JSON.stringify(certRef)}`);
  }
});

runTest("STRESS-2.2", "Renamed nested destructuring", () => {
  const code = `
    const {
      database: {
        DATABASE_URL: connectionString,
        POOL_SIZE: maxPool = 25
      }
    } = process.env;
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const dbUrlRef = refs.find((r) => r.name === "DATABASE_URL");
  const poolRef = refs.find((r) => r.name === "POOL_SIZE");
  if (!dbUrlRef || dbUrlRef.hasDefault) {
    throw new Error(`DATABASE_URL should be detected without default: ${JSON.stringify(dbUrlRef)}`);
  }
  if (!poolRef || poolRef.defaultValue !== "25" || !poolRef.hasDefault) {
    throw new Error(`POOL_SIZE should be detected with default: ${JSON.stringify(poolRef)}`);
  }
});

runTest("STRESS-2.3", "Direct process destructuring with nested pattern and defaults", () => {
  const code = `
    const {
      env: {
        services: {
          AUTH_URL = "http://auth.local",
          API_KEY
        } = {}
      } = {}
    } = process;
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const authRef = refs.find((r) => r.name === "AUTH_URL");
  const keyRef = refs.find((r) => r.name === "API_KEY");
  if (!authRef || authRef.defaultValue !== "http://auth.local") {
    throw new Error(`AUTH_URL not detected: ${JSON.stringify(authRef)}`);
  }
  if (!keyRef || keyRef.hasDefault) {
    throw new Error(`API_KEY not detected: ${JSON.stringify(keyRef)}`);
  }
});

runTest("STRESS-2.4", "Destructuring in assignment expression", () => {
  const code = `
    let PORT, HOST;
    ({ PORT = 4000, HOST } = process.env);
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const portRef = refs.find((r) => r.name === "PORT");
  const hostRef = refs.find((r) => r.name === "HOST");
  if (!portRef || portRef.defaultValue !== "4000") {
    throw new Error(`PORT default invalid in assignment: ${JSON.stringify(portRef)}`);
  }
  if (!hostRef || hostRef.hasDefault) {
    throw new Error(`HOST invalid in assignment: ${JSON.stringify(hostRef)}`);
  }
});

runTest("STRESS-2.5", "Function parameter destructuring with default", () => {
  const code = `
    function startServer({ PORT = 8000, LOG_LEVEL = "info" } = process.env) {
      return PORT;
    }
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const portRef = refs.find((r) => r.name === "PORT");
  const logRef = refs.find((r) => r.name === "LOG_LEVEL");
  if (!portRef || portRef.defaultValue !== "8000") {
    throw new Error(`PORT parameter default invalid: ${JSON.stringify(portRef)}`);
  }
  if (!logRef || logRef.defaultValue !== "info") {
    throw new Error(`LOG_LEVEL parameter default invalid: ${JSON.stringify(logRef)}`);
  }
});

// --- SUITE 3: COMPOUND GUARDS & TERMINATION STATEMENTS ---

runTest("STRESS-3.1", "Compound 3-way OR guard with throw", () => {
  const code = `
    if (!process.env.VAR_A || !process.env.VAR_B || !process.env.VAR_C) {
      throw new Error("Missing required config");
    }
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  for (const varName of ["VAR_A", "VAR_B", "VAR_C"]) {
    const ref = refs.find((r) => r.name === varName);
    if (!ref || !ref.required || ref.guardType !== "guard_throw_mandatory") {
      throw new Error(`${varName} not recognized as mandatory throw guard: ${JSON.stringify(ref)}`);
    }
  }
});

runTest("STRESS-3.2", "Single-statement if guard without block braces", () => {
  const code = `
    if (!process.env.MANDATORY_NO_BLOCK) throw new Error("Missing");
    if (!process.env.EXIT_NO_BLOCK) process.exit(1);
    if (!process.env.RETURN_EXIT_NO_BLOCK) return process.exit(1);
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  for (const name of ["MANDATORY_NO_BLOCK", "EXIT_NO_BLOCK", "RETURN_EXIT_NO_BLOCK"]) {
    const ref = refs.find((r) => r.name === name);
    if (!ref || !ref.required || ref.guardType !== "guard_throw_mandatory") {
      throw new Error(`${name} not recognized without block braces: ${JSON.stringify(ref)}`);
    }
  }
});

runTest("STRESS-3.3", "Compound guard with process.abort() and process.exit()", () => {
  const code = `
    if (process.env.ABORT_VAR === undefined) {
      process.abort();
    }
    if (null == process.env.YODA_EXIT_VAR) {
      return process.abort();
    }
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const abortRef = refs.find((r) => r.name === "ABORT_VAR");
  const yodaRef = refs.find((r) => r.name === "YODA_EXIT_VAR");
  if (!abortRef || !abortRef.required) {
    throw new Error(`ABORT_VAR not required: ${JSON.stringify(abortRef)}`);
  }
  if (!yodaRef || !yodaRef.required) {
    throw new Error(`YODA_EXIT_VAR not required: ${JSON.stringify(yodaRef)}`);
  }
});

runTest("STRESS-3.4", "Guard assignment targeting the exact variable vs other variables", () => {
  const code = `
    if (!process.env.FALLBACK_TARGET) {
      process.env.FALLBACK_TARGET = "default_value";
    }
    if (!process.env.UNRELATED_TARGET) {
      otherObj.prop = "default_value";
    }
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const targetRef = refs.find((r) => r.name === "FALLBACK_TARGET");
  const unrelatedRef = refs.find((r) => r.name === "UNRELATED_TARGET");
  if (!targetRef || !targetRef.hasDefault || targetRef.defaultValue !== "default_value") {
    throw new Error(`FALLBACK_TARGET failed to capture fallback assignment: ${JSON.stringify(targetRef)}`);
  }
  if (!unrelatedRef || unrelatedRef.hasDefault) {
    throw new Error(`UNRELATED_TARGET should NOT have captured unrelated assignment: ${JSON.stringify(unrelatedRef)}`);
  }
});

// --- SUITE 4: CHAINED FALLBACKS & LOGICAL OPERATORS ---

runTest("STRESS-4.1", "3-level chained fallback with terminal literal default", () => {
  const code = `
    const port = process.env.PORT || process.env.HTTP_PORT || process.env.DEFAULT_PORT || 8080;
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const portRef = refs.find((r) => r.name === "PORT");
  const httpRef = refs.find((r) => r.name === "HTTP_PORT");
  const defRef = refs.find((r) => r.name === "DEFAULT_PORT");
  if (!portRef || portRef.defaultValue !== "8080" || !portRef.hasDefault) {
    throw new Error(`PORT default invalid in 3-level chain: ${JSON.stringify(portRef)}`);
  }
  if (!httpRef || httpRef.defaultValue !== "8080" || !httpRef.hasDefault) {
    throw new Error(`HTTP_PORT default invalid in 3-level chain: ${JSON.stringify(httpRef)}`);
  }
  if (!defRef || defRef.defaultValue !== "8080" || !defRef.hasDefault) {
    throw new Error(`DEFAULT_PORT default invalid in 3-level chain: ${JSON.stringify(defRef)}`);
  }
});

runTest("STRESS-4.2", "3-level chained fallback WITHOUT literal default", () => {
  const code = `
    const token = process.env.TOKEN_A || process.env.TOKEN_B || process.env.TOKEN_C;
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  for (const name of ["TOKEN_A", "TOKEN_B", "TOKEN_C"]) {
    const ref = refs.find((r) => r.name === name);
    if (!ref || ref.hasDefault) {
      throw new Error(`${name} incorrectly marked with hasDefault in chain without terminal default: ${JSON.stringify(ref)}`);
    }
  }
});

runTest("STRESS-4.3", "Logical assignment operators ||= and ??=", () => {
  const code = `
    process.env.APP_ENV ||= "development";
    process.env.PORT ??= 3000;
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const appRef = refs.find((r) => r.name === "APP_ENV");
  const portRef = refs.find((r) => r.name === "PORT");
  if (!appRef || appRef.defaultValue !== "development" || !appRef.hasDefault) {
    throw new Error(`APP_ENV ||= default invalid: ${JSON.stringify(appRef)}`);
  }
  if (!portRef || portRef.defaultValue !== "3000" || !portRef.hasDefault) {
    throw new Error(`PORT ??= default invalid: ${JSON.stringify(portRef)}`);
  }
});

// --- SUITE 5: TYPESCRIPT EXPRESSIONS & TYPE CASTS ---

runTest("STRESS-5.1", "TypeScript as with parentheses and fallback", () => {
  const code = `
    const port = ((process.env.PORT as any) as string) || "5000";
    const secret = (((process.env.JWT_SECRET!) as unknown) as string);
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const portRef = refs.find((r) => r.name === "PORT");
  const secretRef = refs.find((r) => r.name === "JWT_SECRET");
  if (!portRef || portRef.defaultValue !== "5000" || !portRef.hasDefault) {
    throw new Error(`PORT TS cast default invalid: ${JSON.stringify(portRef)}`);
  }
  if (!secretRef || secretRef.hasDefault || !secretRef.required) {
    throw new Error(`JWT_SECRET TS cast invalid: ${JSON.stringify(secretRef)}`);
  }
});

runTest("STRESS-5.2", "TypeScript satisfies with nullish coalescing", () => {
  const code = `
    const host = (process.env.HOST satisfies string | undefined) ?? "127.0.0.1";
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const hostRef = refs.find((r) => r.name === "HOST");
  if (!hostRef || hostRef.defaultValue !== "127.0.0.1" || !hostRef.hasDefault) {
    throw new Error(`HOST satisfies default invalid: ${JSON.stringify(hostRef)}`);
  }
});

// --- SUITE 6: DEFAULT VALUE TYPES (NEGATIVE NUMBERS, BOOLEANS, TEMPLATES) ---

runTest("STRESS-6.1", "Negative numbers, positive numbers, and booleans as defaults", () => {
  const code = `
    const {
      OFFSET = -1,
      LIMIT = +50,
      DEBUG = false,
      PROD = true,
      EMPTY_STR = ""
    } = process.env;
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const offsetRef = refs.find((r) => r.name === "OFFSET");
  const limitRef = refs.find((r) => r.name === "LIMIT");
  const debugRef = refs.find((r) => r.name === "DEBUG");
  const prodRef = refs.find((r) => r.name === "PROD");
  const emptyRef = refs.find((r) => r.name === "EMPTY_STR");

  if (!offsetRef || offsetRef.defaultValue !== "-1") {
    throw new Error(`OFFSET default invalid: ${JSON.stringify(offsetRef)}`);
  }
  if (!limitRef || limitRef.defaultValue !== "+50") {
    throw new Error(`LIMIT default invalid: ${JSON.stringify(limitRef)}`);
  }
  if (!debugRef || debugRef.defaultValue !== "false") {
    throw new Error(`DEBUG default invalid: ${JSON.stringify(debugRef)}`);
  }
  if (!prodRef || prodRef.defaultValue !== "true") {
    throw new Error(`PROD default invalid: ${JSON.stringify(prodRef)}`);
  }
  if (!emptyRef || emptyRef.defaultValue !== "") {
    throw new Error(`EMPTY_STR default invalid: ${JSON.stringify(emptyRef)}`);
  }
});

// --- SUITE 7: .ENV PARSING & ROUND-TRIP FIDELITY ---

runTest("STRESS-7.1", "Complex characters and multiline round-trip fidelity", () => {
  const original = [
    "# App Config",
    "APP_NAME=\"CovAI-\"",
    "STORAGE_PATH=\"C:\\\\Users\\\\Admin\\\\Desktop\"",
    "PRIVATE_KEY=\"-----BEGIN RSA-----\\nMIIEowIBAAKCAQEA\\n-----END RSA-----\"",
    "",
    "# Endpoints",
    "API_URL=https://api.example.com/v1?query=1&foo=bar#section",
    "PORT=4000 # Server port",
  ].join("\n");

  const parsed = parseEnv(original);
  if (parsed.variables.APP_NAME !== "CovAI-") throw new Error("APP_NAME parsed incorrectly");
  if (parsed.variables.STORAGE_PATH !== "C:\\Users\\Admin\\Desktop") {
    throw new Error(`STORAGE_PATH unescape failed: ${parsed.variables.STORAGE_PATH}`);
  }
  if (!parsed.variables.PRIVATE_KEY.includes("MIIEowIBAAKCAQEA")) {
    throw new Error(`PRIVATE_KEY newline unescape failed: ${parsed.variables.PRIVATE_KEY}`);
  }

  const serialized = serializeEnv(original, { PORT: "4001" });
  const reParsed = parseEnv(serialized);
  if (reParsed.variables.PORT !== "4001") throw new Error("PORT update failed");
  if (reParsed.variables.STORAGE_PATH !== "C:\\Users\\Admin\\Desktop") {
    throw new Error(`STORAGE_PATH corrupted on round-trip: ${reParsed.variables.STORAGE_PATH}`);
  }
  if (reParsed.variables.APP_NAME !== "CovAI-") throw new Error("APP_NAME corrupted on round-trip");
});

runTest("STRESS-7.2", "Idempotence over 10 consecutive serialize/parse cycles", () => {
  let content = "KEY_A=\"value_a\"\nKEY_B=\"C:\\\\path\\\\to\\\\dir\"\n";
  for (let i = 0; i < 10; i++) {
    content = serializeEnv(content, { KEY_A: "value_a", KEY_B: "C:\\path\\to\\dir" });
  }
  const parsed = parseEnv(content);
  if (parsed.variables.KEY_B !== "C:\\path\\to\\dir") {
    throw new Error(`Path corrupted after 10 cycles: ${parsed.variables.KEY_B}`);
  }
});

// --- SUITE 8: ADVANCED REAL-WORLD EDGE CASES ---

runTest("STRESS-8.1", "Dynamic computed member expressions safely ignored", () => {
  const code = `
    const key = getKey();
    const val = process.env[key];
    const num = process.env[123];
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  if (refs.length !== 0) {
    throw new Error(`Expected dynamic lookups to be safely ignored, got: ${JSON.stringify(refs)}`);
  }
});

runTest("STRESS-8.2", "Template literal property name in process.env", () => {
  const code = `
    const secret = process.env[\`JWT_SECRET\`];
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const ref = refs.find((r) => r.name === "JWT_SECRET");
  if (!ref || !ref.required) {
    throw new Error(`JWT_SECRET template literal not detected or not critical: ${JSON.stringify(ref)}`);
  }
});

runTest("STRESS-8.3", "String literal bracket access with TS cast", () => {
  const code = `
    const dbUrl = (process.env["DATABASE_URL"] as string);
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const ref = refs.find((r) => r.name === "DATABASE_URL");
  if (!ref || !ref.required) {
    throw new Error(`DATABASE_URL bracket access with TS cast not detected: ${JSON.stringify(ref)}`);
  }
});

runTest("STRESS-8.4", "Rest element in destructuring ignored safely", () => {
  const code = `
    const { PORT = 3000, ...restOfEnv } = process.env;
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const portRef = refs.find((r) => r.name === "PORT");
  const restRef = refs.find((r) => r.name === "restOfEnv");
  if (!portRef || portRef.defaultValue !== "3000") {
    throw new Error(`PORT default invalid with rest element: ${JSON.stringify(portRef)}`);
  }
  if (restRef) {
    throw new Error(`Rest element was falsely detected as an env var: ${JSON.stringify(restRef)}`);
  }
});

runTest("STRESS-8.5", "Function parameter default referencing process.env", () => {
  const code = `
    function connect(url = process.env.DATABASE_URL || "postgres://localhost/db") {
      return url;
    }
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const ref = refs.find((r) => r.name === "DATABASE_URL");
  if (!ref || !ref.hasDefault || ref.defaultValue !== "postgres://localhost/db") {
    throw new Error(`DATABASE_URL in param default invalid: ${JSON.stringify(ref)}`);
  }
});

runTest("STRESS-8.6", "Nested logical expressions with parenthesized fallbacks", () => {
  const code = `
    const host = (process.env.APP_HOST || (process.env.HOST || "0.0.0.0"));
  `;
  const ast = parse(code);
  const refs = extractEnvReferencesFromAst(ast, "test.ts");
  const appHost = refs.find((r) => r.name === "APP_HOST");
  const host = refs.find((r) => r.name === "HOST");
  if (!appHost || appHost.defaultValue !== "0.0.0.0") {
    throw new Error(`APP_HOST default invalid: ${JSON.stringify(appHost)}`);
  }
  if (!host || host.defaultValue !== "0.0.0.0") {
    throw new Error(`HOST default invalid: ${JSON.stringify(host)}`);
  }
});

runTest("STRESS-8.7", "Strict guard in File B overrides optional fallback in File A", () => {
  const refA = {
    name: "REDIS_HOST",
    hasDefault: true,
    defaultValue: "localhost",
    required: false,
    guardType: "logical_fallback",
    file: "src/cache.js",
    line: 10,
  };
  const refB = {
    name: "REDIS_HOST",
    hasDefault: false,
    defaultValue: null,
    required: true,
    guardType: "guard_throw_mandatory",
    file: "src/cluster.js",
    line: 5,
  };

  const merged = mergeVariableReferences("REDIS_HOST", [refA, refB], {}, inferMockValue);
  if (!merged.required) {
    throw new Error(`Merged REDIS_HOST must be required: true due to guard in File B. Got: ${JSON.stringify(merged)}`);
  }
  if (merged.isDefined) {
    throw new Error(`REDIS_HOST should be isDefined: false`);
  }
});

runTest("STRESS-8.8", "Hermetic mock generation conforms to TCP port ranges and secret length", () => {
  const portMock = inferMockValue("PGPORT");
  const parsedPort = parseInt(portMock, 10);
  if (isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error(`PGPORT inferred invalid TCP port: ${portMock}`);
  }

  const jwtMock = inferMockValue("JWT_SECRET");
  if (jwtMock.length < 32) {
    throw new Error(`JWT_SECRET mock too short: ${jwtMock.length}`);
  }

  const emailMock = inferMockValue("ADMIN_EMAIL");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailMock)) {
    throw new Error(`ADMIN_EMAIL inferred invalid email: ${emailMock}`);
  }

  const sqliteMock = inferMockValue("SQLITE_URL");
  if (sqliteMock !== "sqlite://mock.db") {
    throw new Error(`SQLITE_URL inferred invalid mock: ${sqliteMock}`);
  }
});

console.log("\n=======================================================");
console.log(`TOTAL STRESS TESTS: ${results.length} | PASSED: ${passCount} | FAILED: ${failCount}`);
console.log("=======================================================");

if (failCount > 0) {
  process.exit(1);
}
