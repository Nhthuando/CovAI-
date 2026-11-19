process.env.PROJECT_STORAGE_DRIVER = "local";

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  parseEnv,
  serializeEnv,
  inferMockValue,
  generateHermeticMockEnvironment,
  loadWorkspaceEnv,
} from "../services/environmentDetection.service.js";

describe("Milestone 1 Step d (Challenger 2): Adversarial Env & RAM Mock Challenge", () => {
  let tempDirs = [];

  const createTempWorkspace = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "covai-env-adversarial-"));
    tempDirs.push(dir);
    return dir;
  };

  afterEach(async () => {
    for (const dir of tempDirs) {
      try {
        await fsp.rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup
      }
    }
    tempDirs = [];
  });

  // ==============================================================================================
  // DIMENSION 1: Lossless .env Round-Trip Serialization on Complex Inputs
  // ==============================================================================================
  describe("DIMENSION 1: Lossless .env Round-Trip Serialization", () => {
    test("CHALLENGE-1.1: Complex file with multiline header comments, section blocks, empty lines", () => {
      const complexEnv = [
        "################################################################################",
        "# PRODUCTION CONFIGURATION TEMPLATE",
        "# Last updated: 2026-11-04 by SRE Team",
        "# Do not commit sensitive secrets directly to version control",
        "################################################################################",
        "",
        "# Core Server Networking",
        "PORT=3000",
        "HOST=0.0.0.0",
        "",
        "# Database Connection Pool",
        "DATABASE_URL=postgresql://app_user:s3cr3t_p@ss@db.internal:5432/app_db?ssl=true&pool=20",
        "DB_TIMEOUT_MS=5000",
        "",
        "# Authentication & Cryptography",
        "JWT_SECRET=production_super_secure_signing_secret_2026_key_512bits_padding",
        "",
        "################################################################################",
        "# END OF CONFIGURATION",
        "################################################################################",
      ].join("\n");

      // Round-trip with empty updates must be bit-for-bit identical
      const roundTripEmpty = serializeEnv(complexEnv, {});
      expect(roundTripEmpty).toBe(complexEnv);

      // Round-trip with in-place variable update must preserve ALL comments and structure
      const updated = serializeEnv(complexEnv, { PORT: "8080", HOST: "127.0.0.1" });
      const expectedUpdated = complexEnv
        .replace("PORT=3000", "PORT=8080")
        .replace("HOST=0.0.0.0", "HOST=127.0.0.1");
      expect(updated).toBe(expectedUpdated);

      // Verify variables parsed from updated content match expectations
      const parsed = parseEnv(updated);
      expect(parsed.variables.PORT).toBe("8080");
      expect(parsed.variables.HOST).toBe("127.0.0.1");
      expect(parsed.variables.DATABASE_URL).toBe(
        "postgresql://app_user:s3cr3t_p@ss@db.internal:5432/app_db?ssl=true&pool=20"
      );
      expect(parsed.variables.JWT_SECRET).toBe(
        "production_super_secure_signing_secret_2026_key_512bits_padding"
      );
    });

    test("CHALLENGE-1.2: Values containing '#' inside double quotes, single quotes, and unquoted strings", () => {
      const hashEnv = [
        'HASH_DOUBLE="my#secret#password#value"',
        "HASH_SINGLE='hex#color#code#3498db'",
        'LABEL_DOUBLE="Order #12345 (Pending Payment)"',
        "UNQUOTED_HEX=#FF5733",
        "UNQUOTED_WITH_INLINE=5000 # inline comment with # inside",
      ].join("\n");

      const parsed = parseEnv(hashEnv);
      expect(parsed.variables.HASH_DOUBLE).toBe("my#secret#password#value");
      expect(parsed.variables.HASH_SINGLE).toBe("hex#color#code#3498db");
      expect(parsed.variables.LABEL_DOUBLE).toBe("Order #12345 (Pending Payment)");
      expect(parsed.variables.UNQUOTED_HEX).toBe("#FF5733");
      expect(parsed.variables.UNQUOTED_WITH_INLINE).toBe("5000");

      // Verify inline comment was captured
      const inlineEntry = parsed.entries.find((e) => e.key === "UNQUOTED_WITH_INLINE");
      expect(inlineEntry.inlineComment).toBe(" # inline comment with # inside");

      // Round-trip serialize with updates preserving quotes and hash symbols
      const reserialized = serializeEnv(hashEnv, {
        HASH_DOUBLE: "new#double#secret",
        HASH_SINGLE: "new#single#color",
      });

      expect(reserialized).toContain('HASH_DOUBLE="new#double#secret"');
      expect(reserialized).toContain("HASH_SINGLE='new#single#color'");
      expect(reserialized).toContain("UNQUOTED_HEX=#FF5733");
      expect(reserialized).toContain("UNQUOTED_WITH_INLINE=5000 # inline comment with # inside");
    });

    test("CHALLENGE-1.3: Empty lines, leading spaces, mixed indentation, and comments", () => {
      const indentedEnv = [
        "",
        "   # Indented section header comment",
        "   PORT=3000",
        "  export API_HOST=api.example.com",
        "",
        "",
        "# Standard comment",
        "DEBUG=true",
        "",
      ].join("\n");

      const parsed = parseEnv(indentedEnv);
      expect(parsed.variables.PORT).toBe("3000");
      expect(parsed.variables.API_HOST).toBe("api.example.com");
      expect(parsed.variables.DEBUG).toBe("true");

      // Serialization should preserve raw format
      const serialized = serializeEnv(indentedEnv, {});
      expect(serialized).toBe(indentedEnv);
    });

    test("CHALLENGE-1.4: Multiline values with escaped newlines and embedded quotes", () => {
      const multilineEnv = [
        'CERTIFICATE="-----BEGIN CERTIFICATE-----\\nMIIB...sample...data\\n-----END CERTIFICATE-----"',
        'GREETING="Hello \\"World\\""',
        "ESCAPED_SLASH='C:\\\\path\\\\to\\\\dir'",
      ].join("\n");

      const parsed = parseEnv(multilineEnv);
      expect(parsed.variables.CERTIFICATE).toBe(
        "-----BEGIN CERTIFICATE-----\nMIIB...sample...data\n-----END CERTIFICATE-----"
      );
      expect(parsed.variables.GREETING).toBe('Hello "World"');

      // Round-trip serialize
      const serialized = serializeEnv(multilineEnv, {
        GREETING: 'Hello "Jest"',
      });
      expect(serialized).toContain('GREETING="Hello \\"Jest\\""');
      expect(serialized).toContain('CERTIFICATE="-----BEGIN CERTIFICATE-----\\nMIIB...sample...data\\n-----END CERTIFICATE-----"');
    });

    test("CHALLENGE-1.5: [DEFECT FOUND] Physical multiline string spanning actual line breaks in .env file", () => {
      const rawPhysicalMultiline = [
        'PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----',
        "MIIEowIBAAKCAQEA0Y1...",
        '-----END RSA PRIVATE KEY-----"',
        "PORT=3000",
      ].join("\n");

      const parsed = parseEnv(rawPhysicalMultiline);
      expect(parsed.variables.PRIVATE_KEY).toBe(
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Y1...\n-----END RSA PRIVATE KEY-----"
      );
      expect(parsed.variables.PORT).toBe("3000");

      // Invariant: Unmodified round-trip must NOT truncate the multiline string
      const serializedUnmodified = serializeEnv(rawPhysicalMultiline, {});
      expect(serializedUnmodified).toBe(rawPhysicalMultiline);
    });
  });

  // ==============================================================================================
  // DIMENSION 2: Mathematical Idempotency Invariants
  // ==============================================================================================
  describe("DIMENSION 2: Idempotency: serializeEnv(serializeEnv(content, updates), updates)", () => {
    test("CHALLENGE-2.1: Mathematical idempotency with existing variable updates", () => {
      const baseContent = [
        "# Server Config",
        "PORT=3000",
        "HOST=localhost # Local host",
        "",
        "# Database",
        "DB_PORT=5432",
      ].join("\n");

      const updates = { PORT: "8080", DB_PORT: "5433" };

      const cycle1 = serializeEnv(baseContent, updates);
      const cycle2 = serializeEnv(cycle1, updates);
      const cycle3 = serializeEnv(cycle2, updates);

      // Invariant: serializeEnv(serializeEnv(content, updates), updates) === serializeEnv(content, updates)
      expect(cycle2).toBe(cycle1);
      expect(cycle3).toBe(cycle1);
      expect(cycle1).toContain("PORT=8080");
      expect(cycle1).toContain("HOST=localhost # Local host");
      expect(cycle1).toContain("DB_PORT=5433");
    });

    test("CHALLENGE-2.2: Mathematical idempotency with newly appended variables", () => {
      const baseContent = "PORT=3000\nHOST=localhost";
      const updates = {
        NEW_VAR_A: "value_a",
        NEW_VAR_B: "value_b with spaces",
        NEW_VAR_C: "secret#value",
      };

      const cycle1 = serializeEnv(baseContent, updates);
      const cycle2 = serializeEnv(cycle1, updates);
      const cycle3 = serializeEnv(cycle2, updates);

      // Invariant: Subsequent cycles must NOT duplicate appended variables at the bottom
      expect(cycle2).toBe(cycle1);
      expect(cycle3).toBe(cycle1);

      // Check occurrences of appended keys - must appear exactly once
      const matchesA = cycle1.match(/^NEW_VAR_A=/gm);
      const matchesB = cycle1.match(/^NEW_VAR_B=/gm);
      const matchesC = cycle1.match(/^NEW_VAR_C=/gm);
      expect(matchesA).toHaveLength(1);
      expect(matchesB).toHaveLength(1);
      expect(matchesC).toHaveLength(1);
    });

    test("CHALLENGE-2.3: Multi-cycle stress loop (50 cycles) with mixed mutations", () => {
      let currentContent = [
        "# Stress Test Baseline",
        "APP_NAME=CovAI",
        "PORT=3000",
        "DEBUG=false # toggle verbose",
        "",
        "# Secret Store",
        "API_SECRET='super_initial_secret'",
      ].join("\n");

      const updates = {
        PORT: "4000",
        DEBUG: "true",
        API_SECRET: "updated_secret_value",
        DYNAMIC_KEY_1: "first_dynamic",
        DYNAMIC_KEY_2: "second_dynamic",
      };

      // Perform 50 cycles
      let firstPass = null;
      for (let i = 0; i < 50; i++) {
        currentContent = serializeEnv(currentContent, updates);
        if (i === 0) {
          firstPass = currentContent;
        } else {
          expect(currentContent).toBe(firstPass);
        }
      }

      // Verify final parsed structure
      const parsed = parseEnv(currentContent);
      expect(parsed.variables.APP_NAME).toBe("CovAI");
      expect(parsed.variables.PORT).toBe("4000");
      expect(parsed.variables.DEBUG).toBe("true");
      expect(parsed.variables.API_SECRET).toBe("updated_secret_value");
      expect(parsed.variables.DYNAMIC_KEY_1).toBe("first_dynamic");
      expect(parsed.variables.DYNAMIC_KEY_2).toBe("second_dynamic");
    });

    test("CHALLENGE-2.4: [DEFECT FOUND] Exponential backslash expansion on read-modify-write cycles", () => {
      // In .env, user stores a path with double backslashes in double-quotes
      const initialContent = 'STORAGE_PATH="C:\\\\Users\\\\Admin"';
      const parsed1 = parseEnv(initialContent);

      // The parsed variable should represent the actual unescaped path: C:\Users\Admin
      // However parseEnv line 659 does not unescape \\ to \
      // When serializeEnv saves it, line 747 doubles every backslash
      const serialized1 = serializeEnv(initialContent, { STORAGE_PATH: parsed1.variables.STORAGE_PATH });
      const parsed2 = parseEnv(serialized1);
      const serialized2 = serializeEnv(serialized1, { STORAGE_PATH: parsed2.variables.STORAGE_PATH });

      // Invariant: Repeated parse-and-serialize cycles must be idempotent and not multiply backslashes
      expect(serialized2).toBe(serialized1);
    });
  });

  // ==============================================================================================
  // DIMENSION 3: Hermetic Mock Generation Invariants
  // ==============================================================================================
  describe("DIMENSION 3: Hermetic Mock Data Generation", () => {
    test("CHALLENGE-3.1: All URL mocks can be parsed by new URL() without throwing", () => {
      const urlVarNames = [
        "DATABASE_URL",
        "DB_URL",
        "POSTGRES_URL",
        "POSTGRESQL_URL",
        "PG_URL",
        "MYSQL_URL",
        "MONGO_URL",
        "MONGODB_URI",
        "MONGODB_URL",
        "REDIS_URL",
        "AMQP_URL",
        "RABBITMQ_URI",
        "API_URL",
        "BASE_URL",
        "CLIENT_URL",
        "FRONTEND_URL",
        "WEBHOOK_URL",
        "SERVER_URL",
        "DOMAIN",
        "ORIGIN",
        "AUTH_ENDPOINT",
        "GRAPHQL_ENDPOINT",
        "NEXT_PUBLIC_API_URL",
        "VITE_CLIENT_URL",
        "REACT_APP_SERVER_URL",
        "OAUTH_CALLBACK_URL",
        // Case variations
        "database_url",
        "Frontend_Url",
        "Api_Url",
        "Webhook_Url",
      ];

      for (const varName of urlVarNames) {
        const mock = inferMockValue(varName);
        expect(typeof mock).toBe("string");
        expect(mock.length).toBeGreaterThan(0);

        // Invariant: MUST be parseable by new URL()
        let parsedUrl = null;
        expect(() => {
          parsedUrl = new URL(mock);
        }).not.toThrow();

        expect(parsedUrl).toBeDefined();
        expect(parsedUrl.protocol).toBeTruthy();
        expect(parsedUrl.hostname || parsedUrl.host).toBeTruthy();
      }
    });

    test("CHALLENGE-3.2: [DEFECT FOUND] All Port mocks can be parsed by parseInt(port, 10) in valid TCP range [1, 65535]", () => {
      const portVarNames = [
        "PORT",
        "SERVER_PORT",
        "HTTP_PORT",
        "HTTPS_PORT",
        "APP_PORT",
        "REDIS_PORT",
        "DB_PORT",
        "POSTGRES_PORT",
        "PGPORT", // Standard PostgreSQL client port variable (fails on non-delimited port regex)
        "MYSQL_PORT",
        "CLIENT_PORT",
        "FRONTEND_PORT",
        "DEV_PORT",
        "METRICS_PORT",
        "GRPC_PORT",
        // Case variations
        "port",
        "Server_Port",
        "redis_port",
      ];

      for (const varName of portVarNames) {
        const mock = inferMockValue(varName);
        expect(typeof mock).toBe("string");

        // Invariant: MUST be parseable by parseInt(port, 10)
        const parsedPort = parseInt(mock, 10);
        expect(Number.isInteger(parsedPort)).toBe(true);
        expect(parsedPort).toBeGreaterThanOrEqual(1);
        expect(parsedPort).toBeLessThanOrEqual(65535);

        // Must be clean decimal string (no garbage trailing characters)
        expect(String(parsedPort)).toBe(mock);
      }
    });

    test("CHALLENGE-3.3: All Secret, Key, Password, and Token mocks are >= 32 characters", () => {
      const secretVarNames = [
        "JWT_SECRET",
        "AUTH_SECRET",
        "SESSION_SECRET",
        "SECRET_KEY",
        "ENCRYPTION_KEY",
        "COOKIE_SECRET",
        "ACCESS_TOKEN_SECRET",
        "REFRESH_TOKEN_SECRET",
        "API_KEY",
        "PASSWORD",
        "DB_PASSWORD",
        "STRIPE_SECRET_KEY",
        "OPENAI_API_KEY",
        "AWS_SECRET_ACCESS_KEY",
        "SALT",
        "PEPPER",
        "PRIVATE_KEY",
        "OAUTH_CLIENT_SECRET",
        "WEBHOOK_SECRET",
        // Case variations
        "jwt_secret",
        "Session_Secret",
        "encryption_key",
      ];

      for (const varName of secretVarNames) {
        const mock = inferMockValue(varName);
        expect(typeof mock).toBe("string");

        // Invariant: Must be >= 32 characters for HMAC/crypto/JWT security
        expect(mock.length).toBeGreaterThanOrEqual(32);
      }
    });

    test("CHALLENGE-3.4: Complete Hermetic RAM Mock Environment synthesizes valid dictionary without disk I/O", () => {
      const detected = [
        { name: "DATABASE_URL" },
        { name: "PORT" },
        { name: "JWT_SECRET" },
        { name: "ENABLE_FEATURE_X" },
        { name: "TIMEOUT_MS" },
        { name: "ADMIN_EMAIL" },
        { name: "CUSTOM_UNKNOWN_CONFIG" },
      ];

      const existing = {
        DATABASE_URL: "postgresql://custom_real_user:pass@remote:5432/real_db",
      };

      const result = generateHermeticMockEnvironment(detected, existing);

      // Existing should be preserved
      expect(result.DATABASE_URL).toBe("postgresql://custom_real_user:pass@remote:5432/real_db");

      // Others synthesized
      expect(result.PORT).toBe("3000");
      expect(parseInt(result.PORT, 10)).toBe(3000);
      expect(result.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
      expect(result.ENABLE_FEATURE_X).toBe("false");
      expect(result.TIMEOUT_MS).toBe("5000");
      expect(result.ADMIN_EMAIL).toBe("mock_user@example.com");
      expect(result.CUSTOM_UNKNOWN_CONFIG).toBe("mock_custom_unknown_config");
      expect(result.NODE_ENV).toBe("test");
    });

    test("CHALLENGE-3.5: [DEFECT FOUND] SQLite mock value reachability and validity", () => {
      // In environmentDetection.service.js line 806:
      // if (/SQLITE/i.test(upper)) return "sqlite://mock.db";
      // But SQLITE is missing from line 799 outer regex alternation, so it can never be reached.
      const mockSqliteUrl = inferMockValue("SQLITE_URL");
      const mockSqliteConn = inferMockValue("SQLITE_CONNECTION");

      // Expected: SQLite connection strings should return sqlite:// URI
      expect(mockSqliteUrl).toBe("sqlite://mock.db");
      expect(mockSqliteConn).toBe("sqlite://mock.db");
    });
  });

  // ==============================================================================================
  // DIMENSION 4: Zero Disk Side Effects Verification
  // ==============================================================================================
  describe("DIMENSION 4: Zero Disk Side Effects Invariant", () => {
    test("CHALLENGE-4.1: generateHermeticMockEnvironment and inferMockValue produce zero disk side effects", async () => {
      const workspaceDir = createTempWorkspace();
      const testFile = path.join(workspaceDir, "test.txt");
      await fsp.writeFile(testFile, "initial content", "utf8");

      // Compute initial file tree fingerprint
      const getDirFingerprint = async (dir) => {
        const files = await fsp.readdir(dir);
        const entries = [];
        for (const file of files) {
          const filePath = path.join(dir, file);
          const stat = await fsp.stat(filePath);
          const content = await fsp.readFile(filePath);
          const hash = crypto.createHash("sha256").update(content).digest("hex");
          entries.push({ file, size: stat.size, hash });
        }
        return entries;
      };

      const beforeFingerprint = await getDirFingerprint(workspaceDir);

      // Run 500 cycles of mock generation
      for (let i = 0; i < 500; i++) {
        inferMockValue(`VAR_TEST_${i}`);
        inferMockValue("DATABASE_URL");
        inferMockValue("JWT_SECRET");
        inferMockValue("PORT");
        generateHermeticMockEnvironment(
          [`PORT_${i}`, `URL_${i}`, `SECRET_${i}`],
          { EXISTING: "1" }
        );
      }

      // Check directory after
      const afterFingerprint = await getDirFingerprint(workspaceDir);

      // Invariant: Fingerprints MUST be exactly identical (zero mutations, zero added files)
      expect(afterFingerprint).toEqual(beforeFingerprint);

      // Verify no .env was accidentally created in workspaceDir
      expect(fs.existsSync(path.join(workspaceDir, ".env"))).toBe(false);
    });

    test("CHALLENGE-4.2: loadWorkspaceEnv has zero disk side effects when .env is absent", async () => {
      const workspaceDir = createTempWorkspace();
      const filesBefore = await fsp.readdir(workspaceDir);
      expect(filesBefore).toHaveLength(0);

      // Call loadWorkspaceEnv on empty directory
      const loaded = await loadWorkspaceEnv(workspaceDir);
      expect(loaded.exists).toBe(false);

      // Verify directory remains completely empty (no file created by reading)
      const filesAfter = await fsp.readdir(workspaceDir);
      expect(filesAfter).toHaveLength(0);
      expect(fs.existsSync(path.join(workspaceDir, ".env"))).toBe(false);
    });
  });
});
