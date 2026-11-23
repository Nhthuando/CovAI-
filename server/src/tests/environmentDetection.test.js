process.env.PROJECT_STORAGE_DRIVER = "local";

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  parseEnv,
  serializeEnv,
  inferMockValue,
  generateHermeticMockEnvironment,
  loadWorkspaceEnv,
  saveWorkspaceEnv,
  detectProjectEnvironment,
  isProcessEnvNode,
  isEnvObjectOrAlias,
  extractPropertyName,
  getEffectiveParentPath,
  extractDefaultValueFromNode,
  isCriticalEnvironmentVariable,
  analyzeReferenceFallbackAndGuard,
  extractEnvReferencesFromAst,
  mergeVariableReferences,
  isProcessIdentifierValid,
  unwrapTsAndParens,
  unwrapTsAndLogical,
  isProcessNode,
  getTerminalRightNode,
  isProcessEnvReference,
  detectMissingEnvCondition,
  findEnclosingIfGuard,
  isExitOrAbortCall,
  isThrowOrExitStatement,
  isTargetMatchingVar,
} from "../services/environmentDetection.service.js";
import { parseJavaScriptCode } from "../services/babelParser.service.js";

describe("Environment Detection Service Test Suite", () => {
  let tempDirs = [];

  const createTempWorkspace = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-env-test-"));
    tempDirs.push(dir);
    return dir;
  };

  afterEach(async () => {
    for (const dir of tempDirs) {
      try {
        await fsp.rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    tempDirs = [];
  });

  // ================================================================================================
  // SUITE 1: parseEnv (Lossless .env AST Tokenizer)
  // ================================================================================================
  describe("SUITE 1: parseEnv", () => {
    describe("Category A: Happy Path", () => {
      test("T1.1: Basic key-value pairs parsed into variables dictionary and pair entries", () => {
        const content = "PORT=3000\nHOST=localhost";
        const result = parseEnv(content);
        expect(result.variables).toEqual({ PORT: "3000", HOST: "localhost" });
        expect(result.entries).toHaveLength(2);
        expect(result.entries[0]).toMatchObject({ type: "pair", key: "PORT", value: "3000" });
        expect(result.entries[1]).toMatchObject({ type: "pair", key: "HOST", value: "localhost" });
      });

      test("T1.2: Double-quoted and single-quoted values have outer quotes stripped in variables", () => {
        const content = 'KEY="hello world"\nSECRET=\'test_secret\'';
        const result = parseEnv(content);
        expect(result.variables.KEY).toBe("hello world");
        expect(result.variables.SECRET).toBe("test_secret");
        expect(result.entries[0].quote).toBe('"');
        expect(result.entries[1].quote).toBe("'");
      });

      test("T1.3: Value containing '=' characters parsed correctly without truncation", () => {
        const content = "DATABASE_URL=postgres://user:pass@host:5432/db?ssl=true&retry=1";
        const result = parseEnv(content);
        expect(result.variables.DATABASE_URL).toBe("postgres://user:pass@host:5432/db?ssl=true&retry=1");
      });

      test("T1.4: Lines with 'export ' prefix stripped for key and marked exportPrefix: true", () => {
        const content = "export PORT=3000\nexport API_KEY=secret_key";
        const result = parseEnv(content);
        expect(result.variables.PORT).toBe("3000");
        expect(result.variables.API_KEY).toBe("secret_key");
        expect(result.entries[0].exportPrefix).toBe(true);
        expect(result.entries[1].exportPrefix).toBe(true);
      });

      test("T1.5: Full-line comments and empty lines preserved in entries list", () => {
        const content = "# Application Configuration\n\nPORT=3000\n# End of config";
        const result = parseEnv(content);
        expect(result.variables).toEqual({ PORT: "3000" });
        expect(result.entries).toHaveLength(4);
        expect(result.entries[0]).toEqual({ type: "comment", raw: "# Application Configuration" });
        expect(result.entries[1]).toEqual({ type: "empty", raw: "" });
        expect(result.entries[2].type).toBe("pair");
        expect(result.entries[3]).toEqual({ type: "comment", raw: "# End of config" });
      });

      test("T1.6: Inline comments parsed accurately and separated from value", () => {
        const content = "PORT=3000 # default local port\nDEBUG=true # enable verbose logs";
        const result = parseEnv(content);
        expect(result.variables.PORT).toBe("3000");
        expect(result.variables.DEBUG).toBe("true");
        expect(result.entries[0].inlineComment).toBe(" # default local port");
        expect(result.entries[1].inlineComment).toBe(" # enable verbose logs");
      });
    });

    describe("Category B: Boundary Values", () => {
      test("T1.7: Empty string input returns empty entries array and empty variables dictionary", () => {
        const result = parseEnv("");
        expect(result).toEqual({ entries: [], variables: {} });
      });

      test("T1.8: File containing only comments and whitespace returns empty variables dictionary", () => {
        const content = "# Comment 1\n   \n# Comment 2\n\n";
        const result = parseEnv(content);
        expect(result.variables).toEqual({});
        expect(result.entries.length).toBeGreaterThan(0);
      });

      test("T1.9: Key with empty value returns empty string in variables dictionary", () => {
        const content = "EMPTY_KEY=\nANOTHER_EMPTY=";
        const result = parseEnv(content);
        expect(result.variables.EMPTY_KEY).toBe("");
        expect(result.variables.ANOTHER_EMPTY).toBe("");
      });

      test("T1.10: Value containing '#' without preceding space retains '#' in value, not comment", () => {
        const content = "HEX_COLOR=#FF0000\nCSS_SELECTOR=div#main";
        const result = parseEnv(content);
        expect(result.variables.HEX_COLOR).toBe("#FF0000");
        expect(result.variables.CSS_SELECTOR).toBe("div#main");
        expect(result.entries[0].inlineComment).toBeNull();
      });

      test("T1.11: Escaped newlines in double quotes unescaped in value", () => {
        const content = 'KEY="line1\\nline2\\nline3"';
        const result = parseEnv(content);
        expect(result.variables.KEY).toBe("line1\nline2\nline3");
      });
    });

    describe("Category C: Branch Toggling", () => {
      test("T1.12: Quoted vs unquoted quote property accurately set to '\"', \"'\", or null", () => {
        const content = 'A="double"\nB=\'single\'\nC=unquoted';
        const result = parseEnv(content);
        expect(result.entries[0].quote).toBe('"');
        expect(result.entries[1].quote).toBe("'");
        expect(result.entries[2].quote).toBeNull();
      });

      test("T1.13: CRLF (\\r\\n) and LF (\\n) line endings handled identically", () => {
        const contentCRLF = "PORT=3000\r\nHOST=localhost\r\n# Comment\r\n";
        const contentLF = "PORT=3000\nHOST=localhost\n# Comment\n";
        const resCRLF = parseEnv(contentCRLF);
        const resLF = parseEnv(contentLF);
        expect(resCRLF.variables).toEqual(resLF.variables);
        expect(resCRLF.entries).toHaveLength(resLF.entries.length);
      });
    });

    describe("Category D: Error & Exception Handling", () => {
      test("T1.14: Malformed lines without '=' stored as raw type without throwing", () => {
        const content = "MALFORMED_LINE_WITHOUT_EQUALS\nVALID=1";
        const result = parseEnv(content);
        expect(result.variables).toEqual({ VALID: "1" });
        expect(result.entries[0]).toEqual({ type: "raw", raw: "MALFORMED_LINE_WITHOUT_EQUALS" });
      });

      test("T1.15: Non-string inputs (null, undefined, number, object) return empty result safely", () => {
        expect(parseEnv(null)).toEqual({ entries: [], variables: {} });
        expect(parseEnv(undefined)).toEqual({ entries: [], variables: {} });
        expect(parseEnv(12345)).toEqual({ entries: [], variables: {} });
        expect(parseEnv({})).toEqual({ entries: [], variables: {} });
      });
    });
  });

  // ================================================================================================
  // SUITE 2: serializeEnv (Comment-Preserving Serializer)
  // ================================================================================================
  describe("SUITE 2: serializeEnv", () => {
    describe("Category A: Happy Path", () => {
      test("T2.1: Updates existing variable in-place; surrounding comments and blank lines unchanged", () => {
        const input = "# Application Settings\nPORT=3000\n\n# Database Settings\nDB_PORT=5432";
        const output = serializeEnv(input, { PORT: "8080" });
        expect(output).toBe("# Application Settings\nPORT=8080\n\n# Database Settings\nDB_PORT=5432");
      });

      test("T2.2: Updates existing variable with inline comment; inline comment preserved", () => {
        const input = "PORT=3000 # default local port\nDEBUG=false";
        const output = serializeEnv(input, { PORT: "8080" });
        expect(output).toBe("PORT=8080 # default local port\nDEBUG=false");
      });

      test("T2.3: Appends new variable to end of file when not in existing entries", () => {
        const input = "PORT=3000";
        const output = serializeEnv(input, { NEW_KEY: "new_value" });
        expect(output).toBe("PORT=3000\n\nNEW_KEY=new_value");
      });

      test("T2.4: Preserves original key ordering across all existing pairs", () => {
        const input = "BRAVO=2\nALPHA=1\nCHARLIE=3";
        const output = serializeEnv(input, { ALPHA: "100", BRAVO: "200" });
        const lines = output.split("\n");
        expect(lines[0]).toBe("BRAVO=200");
        expect(lines[1]).toBe("ALPHA=100");
        expect(lines[2]).toBe("CHARLIE=3");
      });

      test("T2.5: Serializes clean output when starting from empty content or new file", () => {
        const output = serializeEnv("", { PORT: "3000", HOST: "localhost" });
        expect(output).toBe("PORT=3000\nHOST=localhost");
      });
    });

    describe("Category B: Boundary Values", () => {
      test("T2.6: Empty updatedVariables {} leaves content exactly identical to input", () => {
        const input = "# Comment\nPORT=3000\n";
        const output = serializeEnv(input, {});
        expect(output).toBe(input);
      });

      test("T2.7: Updating variable to empty string serializes as KEY=\"\"", () => {
        const input = "KEY=old_value";
        const output = serializeEnv(input, { KEY: "" });
        expect(output).toBe('KEY=""');
      });

      test("T2.8: Value with spaces or quotes automatically quoted with double quotes and escaped", () => {
        const input = "MSG=hi";
        const output = serializeEnv(input, {
          MSG: "hello world",
          QUOTED: 'say "hi"',
          MULTILINE: "line1\nline2",
        });
        expect(output).toContain('MSG="hello world"');
        expect(output).toContain('QUOTED="say \\"hi\\""');
        expect(output).toContain('MULTILINE="line1\\nline2"');
      });

      test("T2.9: File lacking trailing newline gets newline added before appending new entries", () => {
        const input = "PORT=3000";
        const output = serializeEnv(input, { HOST: "localhost" });
        expect(output).toBe("PORT=3000\n\nHOST=localhost");
      });
    });

    describe("Category C: Branch Toggling", () => {
      test("T2.10: Line with 'export KEY=old' preserves 'export ' prefix upon update: 'export KEY=new'", () => {
        const input = "export PORT=3000";
        const output = serializeEnv(input, { PORT: "8080" });
        expect(output).toBe("export PORT=8080");
      });

      test("T2.11: Single quotes preserved if new value has no single quotes", () => {
        const input = "SECRET='initial_secret'";
        const output = serializeEnv(input, { SECRET: "updated_secret" });
        expect(output).toBe("SECRET='updated_secret'");
      });
    });

    describe("Category D: Error & Exception Handling", () => {
      test("T2.12: updatedVariables with numbers and booleans converted to strings accurately", () => {
        const output = serializeEnv("", { PORT: 3000, DEBUG: true, RATIO: 0.75 });
        expect(output).toBe("PORT=3000\nDEBUG=true\nRATIO=0.75");
      });

      test("T2.13: null or undefined input content handled gracefully without throwing", () => {
        expect(() => serializeEnv(null, { PORT: "3000" })).not.toThrow();
        expect(() => serializeEnv(undefined, { PORT: "3000" })).not.toThrow();
        expect(serializeEnv(null, { PORT: "3000" })).toBe("PORT=3000");
      });
    });
  });

  // ================================================================================================
  // SUITE 3: inferMockValue (Hermetic RAM Mock Data Generator)
  // ================================================================================================
  describe("SUITE 3: inferMockValue", () => {
    describe("Category A: Happy Path", () => {
      test("T3.1: Ports ('PORT', 'SERVER_PORT', 'HTTP_PORT') infer '3000'", () => {
        expect(inferMockValue("PORT")).toBe("3000");
        expect(inferMockValue("SERVER_PORT")).toBe("3000");
        expect(inferMockValue("HTTP_PORT")).toBe("3000");
        expect(inferMockValue("API_PORT")).toBe("3000");
      });

      test("T3.2: Generic URLs ('API_URL', 'BASE_URL', 'AUTH_ENDPOINT') infer 'http://localhost:3000'", () => {
        expect(inferMockValue("API_URL")).toBe("http://localhost:3000");
        expect(inferMockValue("BASE_URL")).toBe("http://localhost:3000");
        expect(inferMockValue("AUTH_ENDPOINT")).toBe("http://localhost:3000");
      });

      test("T3.3: Frontend URLs ('CLIENT_URL', 'FRONTEND_URL') infer 'http://localhost:5173'", () => {
        expect(inferMockValue("CLIENT_URL")).toBe("http://localhost:5173");
        expect(inferMockValue("FRONTEND_URL")).toBe("http://localhost:5173");
      });

      test("T3.4: Webhooks ('WEBHOOK_URL') infer 'http://mock-service.local/webhook'", () => {
        expect(inferMockValue("WEBHOOK_URL")).toBe("http://mock-service.local/webhook");
      });

      test("T3.5: Secrets ('JWT_SECRET', 'SESSION_KEY', 'API_KEY') infer 32+ char secret string", () => {
        const jwt = inferMockValue("JWT_SECRET");
        const session = inferMockValue("SESSION_KEY");
        const apiKey = inferMockValue("API_KEY");
        expect(jwt.length).toBeGreaterThanOrEqual(32);
        expect(session.length).toBeGreaterThanOrEqual(32);
        expect(apiKey.length).toBeGreaterThanOrEqual(32);
      });

      test("T3.6: Emails ('ADMIN_EMAIL', 'SUPPORT_MAIL') infer valid email address", () => {
        expect(inferMockValue("ADMIN_EMAIL")).toBe("mock_user@example.com");
        expect(inferMockValue("SUPPORT_MAIL")).toBe("mock_user@example.com");
      });

      test("T3.7: Postgres/generic DB ('DATABASE_URL', 'DB_CONNECTION') infer PostgreSQL connection string", () => {
        const dbUrl = inferMockValue("DATABASE_URL");
        expect(dbUrl).toContain("postgresql://");
        expect(dbUrl).toContain("5432");
      });

      test("T3.8: MongoDB ('MONGODB_URI', 'MONGO_URL') infer valid mongodb connection string", () => {
        expect(inferMockValue("MONGODB_URI")).toBe("mongodb://localhost:27017/mock_db");
        expect(inferMockValue("MONGO_URL")).toBe("mongodb://localhost:27017/mock_db");
      });

      test("T3.9: Redis ('REDIS_URL') infers valid redis connection string", () => {
        expect(inferMockValue("REDIS_URL")).toBe("redis://localhost:6379");
      });
    });

    describe("Category B: Boundary Values", () => {
      test("T3.10: Default fallback for unknown ('CUSTOM_NAME') infers 'mock_custom_name'", () => {
        expect(inferMockValue("CUSTOM_NAME")).toBe("mock_custom_name");
        expect(inferMockValue("MY_ARBITRARY_CONFIG")).toBe("mock_my_arbitrary_config");
      });

      test("T3.11: Case-insensitivity: 'jwt_secret', 'Jwt_Secret', 'JWT_SECRET' yield identical mocks", () => {
        const lower = inferMockValue("jwt_secret");
        const mixed = inferMockValue("Jwt_Secret");
        const upper = inferMockValue("JWT_SECRET");
        expect(lower).toBe(upper);
        expect(mixed).toBe(upper);
      });

      test("T3.12: 'NODE_ENV' infers 'test'", () => {
        expect(inferMockValue("NODE_ENV")).toBe("test");
      });
    });

    describe("Category C: Branch Toggling", () => {
      test("T3.13: Hex encryption keys ('ENCRYPTION_KEY') infer 64-character hex string", () => {
        const hex = inferMockValue("ENCRYPTION_KEY");
        expect(hex).toHaveLength(64);
        expect(/^[0-9a-f]{64}$/i.test(hex)).toBe(true);
      });

      test("T3.14: Boolean toggles ('ENABLE_METRICS', 'DEBUG', 'VERBOSE') infer 'false'", () => {
        expect(inferMockValue("ENABLE_METRICS")).toBe("false");
        expect(inferMockValue("DEBUG")).toBe("false");
        expect(inferMockValue("VERBOSE")).toBe("false");
      });

      test("T3.15: Timeouts ('TIMEOUT_MS') infer '5000', TTL ('CACHE_TTL') infers '3600'", () => {
        expect(inferMockValue("TIMEOUT_MS")).toBe("5000");
        expect(inferMockValue("CACHE_TTL")).toBe("3600");
      });
    });

    describe("Category D: Error & Exception Handling", () => {
      test("T3.16: Empty string or non-string input returns 'mock_value'", () => {
        expect(inferMockValue("")).toBe("mock_value");
        expect(inferMockValue("   ")).toBe("mock_value");
        expect(inferMockValue(null)).toBe("mock_value");
        expect(inferMockValue(undefined)).toBe("mock_value");
        expect(inferMockValue(12345)).toBe("mock_value");
      });
    });
  });

  // ================================================================================================
  // SUITE 4: generateHermeticMockEnvironment
  // ================================================================================================
  describe("SUITE 4: generateHermeticMockEnvironment", () => {
    describe("Category A: Happy Path", () => {
      test("T4.1: Populates all detected variables with inferred mocks when existingEnv is empty", () => {
        const detected = ["PORT", "JWT_SECRET", "DATABASE_URL"];
        const result = generateHermeticMockEnvironment(detected, {});
        expect(result.PORT).toBe("3000");
        expect(result.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
        expect(result.DATABASE_URL).toContain("postgresql://");
        expect(result.NODE_ENV).toBe("test");
      });

      test("T4.2: Retains existingEnv values without overwriting with mocks", () => {
        const detected = ["PORT", "DATABASE_URL"];
        const existing = { PORT: "9000", DATABASE_URL: "custom_connection_string" };
        const result = generateHermeticMockEnvironment(detected, existing);
        expect(result.PORT).toBe("9000");
        expect(result.DATABASE_URL).toBe("custom_connection_string");
        expect(result.NODE_ENV).toBe("test");
      });

      test("T4.3: Always guarantees NODE_ENV = 'test' unless specifically overridden", () => {
        const result = generateHermeticMockEnvironment([], {});
        expect(result.NODE_ENV).toBe("test");
        const overridden = generateHermeticMockEnvironment([], { NODE_ENV: "production" });
        expect(overridden.NODE_ENV).toBe("production");
      });
    });

    describe("Category B: Boundary Values", () => {
      test("T4.4: Empty detectedVariables array with empty existingEnv returns { NODE_ENV: 'test' }", () => {
        const result = generateHermeticMockEnvironment([], {});
        expect(result).toEqual({ NODE_ENV: "test" });
      });

      test("T4.5: Variables set to empty string in existingEnv are populated with inferred mocks", () => {
        const detected = ["PORT"];
        const existing = { PORT: "" };
        const result = generateHermeticMockEnvironment(detected, existing);
        expect(result.PORT).toBe("3000");
      });
    });

    describe("Category C: Branch Toggling", () => {
      test("T4.6: Accepts string array ['PORT'] and object array [{ name: 'PORT' }]", () => {
        const fromStrings = generateHermeticMockEnvironment(["PORT", "API_KEY"], {});
        const fromObjects = generateHermeticMockEnvironment([{ name: "PORT" }, { name: "API_KEY" }], {});
        expect(fromStrings.PORT).toBe(fromObjects.PORT);
        expect(fromStrings.API_KEY).toBe(fromObjects.API_KEY);
      });
    });

    describe("Category D: Error & Exception Handling", () => {
      test("T4.7: null / undefined inputs handled safely, returning { NODE_ENV: 'test' }", () => {
        expect(generateHermeticMockEnvironment(null, null)).toEqual({ NODE_ENV: "test" });
        expect(generateHermeticMockEnvironment(undefined, undefined)).toEqual({ NODE_ENV: "test" });
      });
    });
  });

  // ================================================================================================
  // SUITE 5: loadWorkspaceEnv
  // ================================================================================================
  describe("SUITE 5: loadWorkspaceEnv", () => {
    describe("Category A: Happy Path", () => {
      test("T5.1: Reads and parses existing .env at workspace root", async () => {
        const dir = createTempWorkspace();
        await fsp.writeFile(path.join(dir, ".env"), "PORT=4000\nHOST=127.0.0.1\n# Comment", "utf8");
        const result = await loadWorkspaceEnv(dir);
        expect(result.exists).toBe(true);
        expect(result.path).toBe(".env");
        expect(result.variables.PORT).toBe("4000");
        expect(result.variables.HOST).toBe("127.0.0.1");
        expect(result.entries.length).toBeGreaterThan(0);
      });
    });

    describe("Category B: Boundary Values", () => {
      test("T5.2: Returns exists: false and empty dictionary if .env is missing (ENOENT)", async () => {
        const dir = createTempWorkspace();
        const result = await loadWorkspaceEnv(dir);
        expect(result.exists).toBe(false);
        expect(result.path).toBe(".env");
        expect(result.variables).toEqual({});
        expect(result.rawContent).toBe("");
        expect(result.entries).toEqual([]);
      });
    });

    describe("Category C: Branch Toggling", () => {
      test("T5.3: Accepts snapshot object with rootDir or direct workspace root string", async () => {
        const dir = createTempWorkspace();
        await fsp.writeFile(path.join(dir, ".env"), "PORT=5000", "utf8");

        const fromString = await loadWorkspaceEnv(dir);
        const fromObject = await loadWorkspaceEnv({ rootDir: dir });
        expect(fromString.variables).toEqual(fromObject.variables);
        expect(fromString.exists).toBe(true);
        expect(fromObject.exists).toBe(true);
      });
    });

    describe("Category D: Error & Exception Handling", () => {
      test("T5.4: Non-existent or invalid directory path handled safely", async () => {
        const fakeDir = path.join(os.tmpdir(), "non_existent_covai_dir_" + Date.now());
        const result = await loadWorkspaceEnv(fakeDir);
        expect(result.exists).toBe(false);
        expect(result.variables).toEqual({});
      });
    });
  });

  // ================================================================================================
  // SUITE 6: detectProjectEnvironment (End-to-End AST & File Orchestration)
  // ================================================================================================
  describe("SUITE 6: detectProjectEnvironment", () => {
    describe("Category A: Happy Path", () => {
      test("T6.1: Missing required variables -> returns requiresPrompt: true, lists in missingRequired", async () => {
        const dir = createTempWorkspace();
        const srcDir = path.join(dir, "src");
        fs.mkdirSync(srcDir, { recursive: true });

        // Critical unadorned secret
        fs.writeFileSync(
          path.join(srcDir, "auth.js"),
          'const secret = process.env.JWT_SECRET;\nif (!secret) throw new Error("Missing JWT_SECRET");'
        );

        const result = await detectProjectEnvironment(dir, {
          files: [path.join(srcDir, "auth.js")],
        });

        expect(result.requiresPrompt).toBe(true);
        expect(result.missingRequired).toContain("JWT_SECRET");
        const jwtVar = result.detectedVariables.find((v) => v.name === "JWT_SECRET");
        expect(jwtVar).toBeDefined();
        expect(jwtVar.required).toBe(true);
        expect(jwtVar.isDefined).toBe(false);
      });

      test("T6.2: All required variables defined in .env -> returns requiresPrompt: false, missingRequired: []", async () => {
        const dir = createTempWorkspace();
        const srcDir = path.join(dir, "src");
        fs.mkdirSync(srcDir, { recursive: true });

        fs.writeFileSync(
          path.join(srcDir, "auth.js"),
          'const secret = process.env.JWT_SECRET;\nif (!secret) throw new Error("Missing JWT_SECRET");'
        );
        fs.writeFileSync(path.join(dir, ".env"), "JWT_SECRET=super_secret_real_key_12345");

        const result = await detectProjectEnvironment(dir, {
          files: [path.join(srcDir, "auth.js")],
        });

        expect(result.requiresPrompt).toBe(false);
        expect(result.missingRequired).toEqual([]);
        const jwtVar = result.detectedVariables.find((v) => v.name === "JWT_SECRET");
        expect(jwtVar.isDefined).toBe(true);
        expect(jwtVar.required).toBe(true);
      });

      test("T6.3: Variables with defaults (PORT || 3000) classified as required: false, requiresPrompt: false", async () => {
        const dir = createTempWorkspace();
        const srcDir = path.join(dir, "src");
        fs.mkdirSync(srcDir, { recursive: true });

        fs.writeFileSync(path.join(srcDir, "server.js"), "const port = process.env.PORT || 3000;");

        const result = await detectProjectEnvironment(dir, {
          files: [path.join(srcDir, "server.js")],
        });

        expect(result.requiresPrompt).toBe(false);
        expect(result.missingRequired).toEqual([]);
        const portVar = result.detectedVariables.find((v) => v.name === "PORT");
        expect(portVar).toBeDefined();
        expect(portVar.required).toBe(false);
        expect(portVar.hasDefault).toBe(true);
        expect(portVar.inferredMock).toBe("3000");
      });
    });

    describe("Category B: Boundary Values", () => {
      test("T6.4: Project with zero process.env calls -> returns requiresPrompt: false, detectedVariables: []", async () => {
        const dir = createTempWorkspace();
        const srcDir = path.join(dir, "src");
        fs.mkdirSync(srcDir, { recursive: true });

        fs.writeFileSync(path.join(srcDir, "math.js"), "export const add = (a, b) => a + b;");

        const result = await detectProjectEnvironment(dir, {
          files: [path.join(srcDir, "math.js")],
        });

        expect(result.requiresPrompt).toBe(false);
        expect(result.missingRequired).toEqual([]);
        expect(result.detectedVariables).toEqual([]);
      });
    });

    describe("Category C: Branch Toggling", () => {
      test("T6.5: Variable has default in File A but strict guard in File B -> merged as required: true", async () => {
        const dir = createTempWorkspace();
        const srcDir = path.join(dir, "src");
        fs.mkdirSync(srcDir, { recursive: true });

        // File A has default
        fs.writeFileSync(path.join(srcDir, "config.js"), 'export const secret = process.env.JWT_SECRET || "dev_secret";');
        // File B has mandatory throw guard
        fs.writeFileSync(
          path.join(srcDir, "auth.js"),
          'if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is strictly required");'
        );

        const result = await detectProjectEnvironment(dir, {
          files: [path.join(srcDir, "config.js"), path.join(srcDir, "auth.js")],
        });

        expect(result.requiresPrompt).toBe(true);
        expect(result.missingRequired).toContain("JWT_SECRET");
        const jwtVar = result.detectedVariables.find((v) => v.name === "JWT_SECRET");
        expect(jwtVar.required).toBe(true);
        expect(jwtVar.hasDefault).toBe(false);
        expect(jwtVar.inferredMock).toBe("dev_secret"); // Preserves suggested default from File A!
      });
    });

    describe("Category D: Error & Exception Handling", () => {
      test("T6.6: Files with JavaScript syntax errors skipped safely without failing entire scan", async () => {
        const dir = createTempWorkspace();
        const srcDir = path.join(dir, "src");
        fs.mkdirSync(srcDir, { recursive: true });

        // Valid file
        fs.writeFileSync(path.join(srcDir, "valid.js"), "const port = process.env.PORT || 3000;");
        // Corrupted file with syntax error
        fs.writeFileSync(path.join(srcDir, "broken.js"), "const x = ;;; invalid syntax @@@ !!!");

        const result = await detectProjectEnvironment(dir, {
          files: [path.join(srcDir, "valid.js"), path.join(srcDir, "broken.js")],
        });

        expect(result.requiresPrompt).toBe(false);
        expect(result.detectedVariables.some((v) => v.name === "PORT")).toBe(true);
      });
    });
  });

  // ================================================================================================
  // SUITE 7: saveWorkspaceEnv
  // ================================================================================================
  describe("SUITE 7: saveWorkspaceEnv", () => {
    const mockDb = {
      projectFileVersion: { findUnique: async () => null },
      project: { findUnique: async () => ({ workspaceRevision: 1 }) },
    };

    describe("Category A: Happy Path", () => {
      test("T7.1: Calls mutateWorkspaceFn with kind: 'CREATE_FILE' when .env does not exist", async () => {
        const dir = createTempWorkspace();
        let capturedMutation = null;
        const mockMutate = async (args) => {
          capturedMutation = args;
          return { workspaceRevision: 2 };
        };

        const snapshot = { id: "snap_1", projectId: "proj_1", rootDir: dir };
        const result = await saveWorkspaceEnv({
          snapshot,
          envVariables: { PORT: "3000", HOST: "localhost" },
          userId: "user_1",
          db: mockDb,
          mutateWorkspaceFn: mockMutate,
        });

        expect(capturedMutation).toBeDefined();
        expect(capturedMutation.kind).toBe("CREATE_FILE");
        expect(capturedMutation.path).toBe(".env");
        expect(capturedMutation.content).toContain("PORT=3000");
        expect(capturedMutation.content).toContain("HOST=localhost");
        expect(result.persisted).toBe(true);
        expect(result.workspaceRevision).toBe(2);
      });

      test("T7.2: Calls mutateWorkspaceFn with kind: 'WRITE_FILE' when .env exists, preserving comments", async () => {
        const dir = createTempWorkspace();
        await fsp.writeFile(path.join(dir, ".env"), "# Initial comment\nPORT=3000\n", "utf8");

        let capturedMutation = null;
        const mockMutate = async (args) => {
          capturedMutation = args;
          return { workspaceRevision: 3 };
        };

        const snapshot = { id: "snap_1", projectId: "proj_1", rootDir: dir };
        const result = await saveWorkspaceEnv({
          snapshot,
          envVariables: { PORT: "8080" },
          userId: "user_1",
          db: mockDb,
          mutateWorkspaceFn: mockMutate,
        });

        expect(capturedMutation).toBeDefined();
        expect(capturedMutation.kind).toBe("WRITE_FILE");
        expect(capturedMutation.content).toBe("# Initial comment\nPORT=8080\n");
        expect(result.persisted).toBe(true);
        expect(result.workspaceRevision).toBe(3);
      });
    });

    describe("Category B: Boundary Values", () => {
      test("T7.3: Persists multiple variables atomically in single mutation", async () => {
        const dir = createTempWorkspace();
        let capturedContent = null;
        const mockMutate = async (args) => {
          capturedContent = args.content;
          return { workspaceRevision: 4 };
        };

        const snapshot = { id: "snap_1", projectId: "proj_1", rootDir: dir };
        await saveWorkspaceEnv({
          snapshot,
          envVariables: {
            PORT: "3000",
            DATABASE_URL: "postgresql://localhost:5432/test",
            JWT_SECRET: "secret_123",
          },
          userId: "user_1",
          db: mockDb,
          mutateWorkspaceFn: mockMutate,
        });

        expect(capturedContent).toContain("PORT=3000");
        expect(capturedContent).toContain("DATABASE_URL=postgresql://localhost:5432/test");
        expect(capturedContent).toContain("JWT_SECRET=secret_123");
      });
    });

    describe("Category C: Branch Toggling", () => {
      test("T7.4: Direct directory fallback writes .env file to disk without mutateWorkspaceFn", async () => {
        const dir = createTempWorkspace();
        const result = await saveWorkspaceEnv({
          snapshot: dir,
          envVariables: { DIRECT_KEY: "direct_val" },
          userId: "user_1",
        });

        expect(result.persisted).toBe(true);
        const written = await fsp.readFile(path.join(dir, ".env"), "utf8");
        expect(written).toContain("DIRECT_KEY=direct_val");
      });
    });

    describe("Category D: Error & Exception Handling", () => {
      test("T7.5: Version mismatch or mutation error triggers error cleanly", async () => {
        const dir = createTempWorkspace();
        const failingMutate = async () => {
          const err = new Error("FILE_VERSION_CONFLICT");
          err.code = "FILE_VERSION_CONFLICT";
          throw err;
        };

        const snapshot = { id: "snap_1", projectId: "proj_1", rootDir: dir };
        await expect(
          saveWorkspaceEnv({
            snapshot,
            envVariables: { PORT: "3000" },
            userId: "user_1",
            db: mockDb,
            mutateWorkspaceFn: failingMutate,
          })
        ).rejects.toThrow("FILE_VERSION_CONFLICT");
      });
    });
  });

  // ================================================================================================
  // SUITE 8: AST Traversers & Node Identification Invariants
  // ================================================================================================
  describe("SUITE 8: AST Traversers & Node Identification", () => {
    test("T8.1: isProcessEnvNode matches direct, computed, and optional chaining syntax", () => {
      const code = `
        const a = process.env.PORT;
        const b = process['env'].PORT;
        const c = process?.env.PORT;
        const d = other.env.PORT;
        const e = process.other.PORT;
      `;
      const { ast } = parseJavaScriptCode(code);
      const statements = ast.program.body;
      expect(isProcessEnvNode(statements[0].declarations[0].init.object)).toBe(true);
      expect(isProcessEnvNode(statements[1].declarations[0].init.object)).toBe(true);
      expect(isProcessEnvNode(statements[2].declarations[0].init.object)).toBe(true);
      expect(isProcessEnvNode(statements[3].declarations[0].init.object)).toBe(false);
      expect(isProcessEnvNode(statements[4].declarations[0].init.object)).toBe(false);
    });

    test("T8.2: extractPropertyName extracts identifier, string literal, and template literal names", () => {
      const code = `
        const a = process.env.PORT;
        const b = process.env['HOST'];
        const c = process.env[\`DATABASE_URL\`];
      `;
      const { ast } = parseJavaScriptCode(code);
      const decls = ast.program.body.map((s) => s.declarations[0].init);
      expect(extractPropertyName(decls[0])).toBe("PORT");
      expect(extractPropertyName(decls[1])).toBe("HOST");
      expect(extractPropertyName(decls[2])).toBe("DATABASE_URL");
    });

    test("T8.3: getEffectiveParentPath unwraps TypeScript type assertions and non-null assertions", () => {
      const code = `
        const a = (process.env.PORT as string) || "3000";
        const b = process.env.HOST! ?? "localhost";
      `;
      const { ast } = parseJavaScriptCode(code, { filePath: "test.ts" });
      const decls = ast.program.body.map((s) => s.declarations[0].init);
      expect(decls[0].type).toBe("LogicalExpression");
      expect(decls[1].type).toBe("LogicalExpression");
    });

    test("T8.4: extractEnvReferencesFromAst extracts destructuring, aliases, and defaults", () => {
      const code = `
        const { PORT = 3000, JWT_SECRET } = process.env;
        const host = process.env.HOST || "localhost";
        function init({ env = process.env } = {}) {
          return env.INTERNAL_KEY;
        }
      `;
      const { ast } = parseJavaScriptCode(code);
      const refs = extractEnvReferencesFromAst(ast, "src/index.js");

      const portRef = refs.find((r) => r.name === "PORT");
      const jwtRef = refs.find((r) => r.name === "JWT_SECRET");
      const hostRef = refs.find((r) => r.name === "HOST");
      const internalRef = refs.find((r) => r.name === "INTERNAL_KEY");

      expect(portRef).toBeDefined();
      expect(portRef.hasDefault).toBe(true);
      expect(jwtRef).toBeDefined();
      expect(jwtRef.required).toBe(true); // Critical
      expect(hostRef).toBeDefined();
      expect(hostRef.hasDefault).toBe(true);
      expect(internalRef).toBeDefined(); // Alias resolved
    });
  });

  // ================================================================================================
  // SUITE 9: Iteration 2 Challenger Remediations & Invariants
  // ================================================================================================
  describe("SUITE 9: Iteration 2 Challenger Remediations & Invariants", () => {
    describe("Category A: Happy Path", () => {
      test("T9.1: Scope shadowing filters out local/param/catch process while allowing legitimate imports", () => {
        const shadowCode = `
          function testLocal() {
            const process = { env: { LOCAL_SHADOW: "val" } };
            return process.env.LOCAL_SHADOW;
          }
          function testParam(process) {
            return process.env.PARAM_SHADOW;
          }
          try {
            run();
          } catch (process) {
            console.log(process.env.CATCH_SHADOW);
          }
        `;
        const { ast: shadowAst } = parseJavaScriptCode(shadowCode);
        const shadowRefs = extractEnvReferencesFromAst(shadowAst, "shadow.js");
        expect(shadowRefs.some((r) => r.name === "LOCAL_SHADOW")).toBe(false);
        expect(shadowRefs.some((r) => r.name === "PARAM_SHADOW")).toBe(false);
        expect(shadowRefs.some((r) => r.name === "CATCH_SHADOW")).toBe(false);

        const legitimateCode = `
          import process from "node:process";
          const port = process.env.LEGIT_PORT || 3000;
        `;
        const { ast: legitAst } = parseJavaScriptCode(legitimateCode);
        const legitRefs = extractEnvReferencesFromAst(legitAst, "legit.js");
        expect(legitRefs.some((r) => r.name === "LEGIT_PORT")).toBe(true);
      });

      test("T9.2: TypeScript destructuring casts and satisfies unwrap cleanly and extract leaf environment variables", () => {
        const code = `
          const { PORT = 3000, DB_URL } = (process.env as any);
          const port = (process.env.APP_PORT satisfies string) || "8080";
        `;
        const { ast } = parseJavaScriptCode(code, { filePath: "cast.ts" });
        const refs = extractEnvReferencesFromAst(ast, "cast.ts");

        const portRef = refs.find((r) => r.name === "PORT");
        const dbRef = refs.find((r) => r.name === "DB_URL");
        const appPortRef = refs.find((r) => r.name === "APP_PORT");

        expect(portRef).toBeDefined();
        expect(portRef.hasDefault).toBe(true);
        expect(portRef.defaultValue).toBe("3000");

        expect(dbRef).toBeDefined();
        expect(dbRef.required).toBe(true);

        expect(appPortRef).toBeDefined();
        expect(appPortRef.hasDefault).toBe(true);
        expect(appPortRef.defaultValue).toBe("8080");
      });

      test("T9.3: Chained fallback expressions without literal defaults are not misclassified as having defaults", () => {
        const code = `
          const token = process.env.AUTH_TOKEN || process.env.API_KEY;
        `;
        const { ast } = parseJavaScriptCode(code);
        const refs = extractEnvReferencesFromAst(ast, "auth.js");
        const tokenRef = refs.find((r) => r.name === "AUTH_TOKEN");
        const keyRef = refs.find((r) => r.name === "API_KEY");

        expect(tokenRef).toBeDefined();
        expect(tokenRef.hasDefault).toBe(false);
        expect(tokenRef.defaultValue).toBeNull();

        expect(keyRef).toBeDefined();
        expect(keyRef.hasDefault).toBe(false);

        const merged = mergeVariableReferences("AUTH_TOKEN", [tokenRef], {});
        expect(merged.inferredMock).not.toBe("process.env.API_KEY");
      });

      test("T9.4: Recursive nested object pattern destructuring extracts leaf variables and discards intermediate containers", () => {
        const code = `
          const {
            server: { port = 3000, host = "localhost" } = {},
            database: { url } = {}
          } = process.env;
        `;
        const { ast } = parseJavaScriptCode(code);
        const refs = extractEnvReferencesFromAst(ast, "server.js");

        expect(refs.some((r) => r.name === "server")).toBe(false);
        expect(refs.some((r) => r.name === "database")).toBe(false);

        const portRef = refs.find((r) => r.name === "port");
        const hostRef = refs.find((r) => r.name === "host");
        const urlRef = refs.find((r) => r.name === "url");

        expect(portRef).toBeDefined();
        expect(portRef.defaultValue).toBe("3000");
        expect(hostRef).toBeDefined();
        expect(hostRef.defaultValue).toBe("localhost");
        expect(urlRef).toBeDefined();
      });

      test("T9.5: Direct process destructuring (const { env: { PORT } } = process) extracts variables cleanly", () => {
        const code = `
          const { env: { PORT = 3000, SECRET } } = process;
        `;
        const { ast } = parseJavaScriptCode(code);
        const refs = extractEnvReferencesFromAst(ast, "proc.js");

        const portRef = refs.find((r) => r.name === "PORT");
        const secretRef = refs.find((r) => r.name === "SECRET");

        expect(portRef).toBeDefined();
        expect(portRef.defaultValue).toBe("3000");
        expect(secretRef).toBeDefined();
      });

      test("T9.6: Guard clauses with return process.exit(1), compound ||, inverted Yoda, and typeof === 'undefined'", () => {
        const code = `
          if (!process.env.REQUIRED_EXIT) {
            console.error("Missing REQUIRED_EXIT");
            return process.exit(1);
          }
          if (!process.env.DB_USER || !process.env.DB_PASS) {
            throw new Error("Missing DB credentials");
          }
          if (undefined === process.env.MANDATORY_KEY) {
            throw new Error("Missing MANDATORY_KEY");
          }
          if (typeof process.env.SECRET_KEY === "undefined") {
            throw new Error("Missing SECRET_KEY");
          }
        `;
        const { ast } = parseJavaScriptCode(code);
        const refs = extractEnvReferencesFromAst(ast, "guards.js");

        const exitRef = refs.find((r) => r.name === "REQUIRED_EXIT");
        const userRef = refs.find((r) => r.name === "DB_USER");
        const passRef = refs.find((r) => r.name === "DB_PASS");
        const yodaRef = refs.find((r) => r.name === "MANDATORY_KEY");
        const typeofRef = refs.find((r) => r.name === "SECRET_KEY");

        expect(exitRef?.guardType).toBe("guard_throw_mandatory");
        expect(exitRef?.required).toBe(true);

        expect(userRef?.guardType).toBe("guard_throw_mandatory");
        expect(userRef?.required).toBe(true);

        expect(passRef?.guardType).toBe("guard_throw_mandatory");
        expect(passRef?.required).toBe(true);

        expect(yodaRef?.guardType).toBe("guard_throw_mandatory");
        expect(yodaRef?.required).toBe(true);

        expect(typeofRef?.guardType).toBe("guard_throw_mandatory");
        expect(typeofRef?.required).toBe(true);
      });
    });

    describe("Category B: Boundary Values", () => {
      test("T9.7: Physical multiline string spanning actual line breaks preserved in round-trip serialization", () => {
        const rawPhysicalMultiline = [
          'PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----',
          'MIIEowIBAAKCAQEA0Y1...',
          '-----END RSA PRIVATE KEY-----"',
          'PORT=3000',
        ].join("\n");

        const serialized = serializeEnv(rawPhysicalMultiline, {});
        expect(serialized).toBe(rawPhysicalMultiline);

        const parsed = parseEnv(rawPhysicalMultiline);
        expect(parsed.variables.PORT).toBe("3000");
        expect(parsed.variables.PRIVATE_KEY).toContain("BEGIN RSA PRIVATE KEY");
        expect(parsed.variables.PRIVATE_KEY).toContain("END RSA PRIVATE KEY");
      });

      test("T9.8: Idempotent backslash handling prevents exponential expansion on Windows filepaths", () => {
        const raw = 'STORAGE_PATH="C:\\\\Users\\\\Admin"';
        let current = raw;
        for (let i = 0; i < 10; i++) {
          const parsed = parseEnv(current);
          current = serializeEnv(parsed.entries, { OTHER_VAR: "true" });
        }
        const finalParsed = parseEnv(current);
        expect(finalParsed.variables.STORAGE_PATH).toBe("C:\\Users\\Admin");
      });

      test("T9.9: Non-delimited port variables (PGPORT, DBPORT, SERVERPORT, port) infer valid TCP integer ports [1, 65535]", () => {
        const portNames = ["PGPORT", "DBPORT", "SERVERPORT", "MYSQL_PORT", "CLIENT_PORT", "port", "Server_Port", "redis_port"];
        for (const name of portNames) {
          const mock = inferMockValue(name);
          const parsed = parseInt(mock, 10);
          expect(Number.isInteger(parsed)).toBe(true);
          expect(parsed).toBeGreaterThanOrEqual(1);
          expect(parsed).toBeLessThanOrEqual(65535);
          expect(String(parsed)).toBe(mock);
        }
        expect(inferMockValue("PGPORT")).toBe("5432");
        expect(inferMockValue("REDIS_PORT")).toBe("6379");
      });

      test("T9.10: SQLite connection strings infer sqlite://mock.db", () => {
        expect(inferMockValue("SQLITE_URL")).toBe("sqlite://mock.db");
        expect(inferMockValue("SQLITE_CONNECTION")).toBe("sqlite://mock.db");
        expect(inferMockValue("SQLITE_URI")).toBe("sqlite://mock.db");
      });
    });

    describe("Category C: Branch Toggling", () => {
      test("T9.11: Unrelated assignments in guard block (status = 'failed') do NOT assign default to env var", () => {
        const code = `
          if (!process.env.API_KEY) {
            status = "failed";
          }
        `;
        const { ast } = parseJavaScriptCode(code);
        const refs = extractEnvReferencesFromAst(ast, "status.js");
        const keyRef = refs.find((r) => r.name === "API_KEY");

        expect(keyRef).toBeDefined();
        expect(keyRef.defaultValue).toBeNull();
        expect(keyRef.guardType).not.toBe("guard_assign_fallback");
      });

      test("T9.12: Chained fallback with terminal literal default (A || B || 'default') assigns default to both", () => {
        const code = `
          const val = process.env.VAR_A || process.env.VAR_B || "default_val";
        `;
        const { ast } = parseJavaScriptCode(code);
        const refs = extractEnvReferencesFromAst(ast, "chain.js");
        const a = refs.find((r) => r.name === "VAR_A");
        const b = refs.find((r) => r.name === "VAR_B");

        expect(a?.hasDefault).toBe(true);
        expect(a?.defaultValue).toBe("default_val");
        expect(b?.hasDefault).toBe(true);
        expect(b?.defaultValue).toBe("default_val");
      });
    });

    describe("Category D: Error & Exception Handling", () => {
      test("T9.13: Non-port English words with suffix PORT (REPORT, TRANSPORT, AIRPORT, EXPORT) are not misclassified as ports", () => {
        const nonPorts = ["REPORT", "TRANSPORT", "AIRPORT", "SUPPORT", "EXPORT", "IMPORT"];
        for (const name of nonPorts) {
          const mock = inferMockValue(name);
          expect(mock).not.toBe("3000");
          expect(mock).not.toBe("5432");
          expect(mock).toBe(`mock_${name.toLowerCase()}`);
        }
        // PASSPORT contains PASS so it infers as secret/password, but critically not as a port
        expect(inferMockValue("PASSPORT")).not.toBe("3000");
        expect(inferMockValue("PASSPORT")).not.toBe("5432");
      });

      test("T9.14: AST helper edge cases (null inputs, empty scopes, non-matching statements) handle safely", () => {
        expect(isProcessIdentifierValid(null)).toBe(true);
        expect(isProcessIdentifierValid({})).toBe(true);
        expect(unwrapTsAndParens(null)).toBeNull();
        expect(unwrapTsAndLogical(null)).toBeNull();
        expect(isProcessNode(null)).toBe(false);
        expect(getTerminalRightNode(null)).toBeNull();
        expect(isProcessEnvReference(null)).toBe(false);
        expect(detectMissingEnvCondition(null)).toBeNull();
        expect(findEnclosingIfGuard(null)).toBeNull();
        expect(isExitOrAbortCall(null)).toBe(false);
        expect(isThrowOrExitStatement(null)).toBe(false);
        expect(isTargetMatchingVar(null, "VAR", null)).toBe(false);
      });
    });
  });
});
