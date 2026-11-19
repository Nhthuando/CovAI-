import { describe, it, expect } from "@jest/globals";
import {
  parseEnv,
  serializeEnv,
  inferMockValue,
  generateHermeticMockEnvironment,
  loadWorkspaceEnv,
} from "../services/environmentDetection.service.js";

describe("Milestone 1 Step d (Challenger 2): Additional .env Permutations & Deep Stress Suite", () => {
  // =========================================================================
  // PERMUTATION SUITE 1: CRLF vs LF Line Endings & Whitespace Handling
  // =========================================================================
  describe("CRLF & Line Ending Invariants", () => {
    it("STRESS-1.1: Correctly parses CRLF line endings without trailing \\r on unquoted, single-quoted, and double-quoted values", () => {
      const crlfEnv = [
        "DB_HOST=127.0.0.1\r",
        "DB_PASS='secret\\r\\nvalue'\r",
        'DB_NAME="production_db"\r',
        "PORT=5432\r",
        "EMPTY_VAL=\r",
      ].join("\n");

      const parsed = parseEnv(crlfEnv);
      expect(parsed.variables.DB_HOST).toBe("127.0.0.1");
      expect(parsed.variables.DB_PASS).toBe("secret\\r\\nvalue");
      expect(parsed.variables.DB_NAME).toBe("production_db");
      expect(parsed.variables.PORT).toBe("5432");
      expect(parsed.variables.EMPTY_VAL).toBe("");

      // Verify no dangling \r
      for (const [key, val] of Object.entries(parsed.variables)) {
        expect(val.endsWith("\r")).toBe(false);
      }
    });

    it("STRESS-1.2: Preserves entries with trailing empty lines or files with only comments and empty lines", () => {
      const commentsOnly = "# Header comment\r\n\r\n# Another comment\r\n";
      const parsed = parseEnv(commentsOnly);
      expect(Object.keys(parsed.variables)).toHaveLength(0);
      expect(parsed.entries).toHaveLength(4);

      const serialized = serializeEnv(commentsOnly, {});
      expect(serialized).toBe(commentsOnly.replace(/\r/g, ""));
    });
  });

  // =========================================================================
  // PERMUTATION SUITE 2: Single-Quoted Multiline & Complex Delimiters
  // =========================================================================
  describe("Single-Quoted & Nested Delimiter Multilines", () => {
    it("STRESS-2.1: Correctly preserves single-quoted multiline strings across serializeEnv", () => {
      const rawSingleMultiline = [
        "CERT='-----BEGIN CERTIFICATE-----",
        "MIIEowIBAAKCAQEA0Y1l...",
        "-----END CERTIFICATE-----'",
        "PORT=8080",
      ].join("\n");

      const parsed = parseEnv(rawSingleMultiline);
      expect(parsed.variables.CERT).toBe("-----BEGIN CERTIFICATE-----\nMIIEowIBAAKCAQEA0Y1l...\n-----END CERTIFICATE-----");
      expect(parsed.variables.PORT).toBe("8080");

      const serialized = serializeEnv(rawSingleMultiline, {});
      expect(serialized).toBe(rawSingleMultiline);
    });

    it("STRESS-2.2: Updating a single-line variable while preserving adjacent single-quoted and double-quoted multiline variables", () => {
      const original = [
        "# Certificate block",
        "CERT='-----BEGIN CERTIFICATE-----",
        "MIICxjCCAe+gAwIBAgIBADANBgkqhkiG9w0BAQsFADAN",
        "-----END CERTIFICATE-----'",
        "",
        "# RSA Key block",
        'RSA_KEY="-----BEGIN RSA PRIVATE KEY-----',
        "MIIEowIBAAKCAQEA0Y1l...",
        '-----END RSA PRIVATE KEY-----"',
        "",
        "APP_PORT=3000",
      ].join("\n");

      const serialized = serializeEnv(original, { APP_PORT: "4000" });
      const parsedAgain = parseEnv(serialized);

      expect(parsedAgain.variables.APP_PORT).toBe("4000");
      expect(parsedAgain.variables.CERT).toBe("-----BEGIN CERTIFICATE-----\nMIICxjCCAe+gAwIBAgIBADANBgkqhkiG9w0BAQsFADAN\n-----END CERTIFICATE-----");
      expect(parsedAgain.variables.RSA_KEY).toBe("-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Y1l...\n-----END RSA PRIVATE KEY-----");
    });
  });

  // =========================================================================
  // PERMUTATION SUITE 3: Equal Signs & Special Characters in Values
  // =========================================================================
  describe("Equal Signs, URLs with Queries, and Special Characters", () => {
    it("STRESS-3.1: Handles multiple '=' characters in unquoted and quoted values", () => {
      const envWithEquals = [
        "QUERY_STRING=param1=value1&param2=value2==&key=val",
        'AUTH_HEADER="Bearer token=abc==&scope=read:all"',
        "BASE64_KEY=aGVsbG8gd29ybGQ==",
        "FORMULA=a=b+c=d",
      ].join("\n");

      const parsed = parseEnv(envWithEquals);
      expect(parsed.variables.QUERY_STRING).toBe("param1=value1&param2=value2==&key=val");
      expect(parsed.variables.AUTH_HEADER).toBe("Bearer token=abc==&scope=read:all");
      expect(parsed.variables.BASE64_KEY).toBe("aGVsbG8gd29ybGQ==");
      expect(parsed.variables.FORMULA).toBe("a=b+c=d");

      // Verify idempotency
      const serialized = serializeEnv(envWithEquals, {});
      const parsedAgain = parseEnv(serialized);
      expect(parsedAgain.variables).toEqual(parsed.variables);
    });

    it("STRESS-3.2: Special shell and regex characters preserved without mangling", () => {
      const specialEnv = [
        'REGEX_PATTERN="^[a-zA-Z0-9_.-]+@[a-zA-Z0-9-]+(\\.[a-zA-Z0-9-]+)+$"',
        'SHELL_CMD="echo \\$FOO && ls -la | grep \\"test\\""',
        "JSON_STRING={\"name\":\"Alice\",\"age\":30,\"tags\":[\"admin\",\"user\"]}",
      ].join("\n");

      const parsed = parseEnv(specialEnv);
      const serialized = serializeEnv(specialEnv, {});
      const parsed2 = parseEnv(serialized);

      expect(parsed2.variables.REGEX_PATTERN).toBe(parsed.variables.REGEX_PATTERN);
      expect(parsed2.variables.SHELL_CMD).toBe(parsed.variables.SHELL_CMD);
      expect(parsed2.variables.JSON_STRING).toBe(parsed.variables.JSON_STRING);
    });
  });

  // =========================================================================
  // PERMUTATION SUITE 4: Updating Multiline with Single-Line & Vice-Versa
  // =========================================================================
  describe("Cross-Dimensional Value Type Mutations", () => {
    it("STRESS-4.1: Replaces a physical multiline variable with a single-line value cleanly", () => {
      const original = [
        "HEADER=START",
        'PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----',
        "line1",
        "line2",
        '-----END RSA PRIVATE KEY-----"',
        "FOOTER=END",
      ].join("\n");

      const updated = serializeEnv(original, { PRIVATE_KEY: "simple_mock_key" });
      const parsed = parseEnv(updated);

      expect(parsed.variables.HEADER).toBe("START");
      expect(parsed.variables.PRIVATE_KEY).toBe("simple_mock_key");
      expect(parsed.variables.FOOTER).toBe("END");

      // Verify the old lines from the multiline key are NOT leaked into the file
      expect(updated).not.toContain("line1");
      expect(updated).not.toContain("line2");
      expect(updated).not.toContain("BEGIN RSA PRIVATE KEY");
    });

    it("STRESS-4.2: Replaces a single-line variable with a multiline value cleanly", () => {
      const original = [
        "HEADER=START",
        "PRIVATE_KEY=mock_key",
        "FOOTER=END",
      ].join("\n");

      const newKey = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Y1l...\n-----END RSA PRIVATE KEY-----";
      const updated = serializeEnv(original, { PRIVATE_KEY: newKey });
      const parsed = parseEnv(updated);

      expect(parsed.variables.HEADER).toBe("START");
      expect(parsed.variables.PRIVATE_KEY).toBe(newKey);
      expect(parsed.variables.FOOTER).toBe("END");
    });
  });

  // =========================================================================
  // PERMUTATION SUITE 5: Port Name Discrimination & False Positive Prevention
  // =========================================================================
  describe("Port Inference Discrimination & Guard Against False Positives", () => {
    it("STRESS-5.1: Non-delimited and delimited ports correctly return integer port strings", () => {
      const validPorts = [
        { name: "PORT", expected: "3000" },
        { name: "PGPORT", expected: "5432" },
        { name: "DBPORT", expected: "5432" },
        { name: "DB_PORT", expected: "5432" },
        { name: "POSTGRES_PORT", expected: "5432" },
        { name: "MYSQLPORT", expected: "3306" },
        { name: "MYSQL_PORT", expected: "3306" },
        { name: "REDISPORT", expected: "6379" },
        { name: "REDIS_PORT", expected: "6379" },
        { name: "MONGOPORT", expected: "27017" },
        { name: "MONGO_PORT", expected: "27017" },
        { name: "SERVERPORT", expected: "3000" },
        { name: "SERVER_PORT", expected: "3000" },
        { name: "HTTPPORT", expected: "3000" },
        { name: "HTTP_PORT", expected: "3000" },
        { name: "HTTPSPORT", expected: "3000" },
        { name: "HTTPS_PORT", expected: "3000" },
        { name: "APIPORT", expected: "3000" },
        { name: "API_PORT", expected: "3000" },
        { name: "APPPORT", expected: "3000" },
        { name: "APP_PORT", expected: "3000" },
        { name: "CLIENTPORT", expected: "5173" },
        { name: "CLIENT_PORT", expected: "5173" },
        { name: "FRONTEND_PORT", expected: "5173" },
      ];

      for (const { name, expected } of validPorts) {
        const val = inferMockValue(name);
        expect(val).toBe(expected);
        const parsed = parseInt(val, 10);
        expect(Number.isInteger(parsed)).toBe(true);
        expect(parsed).toBeGreaterThanOrEqual(1);
        expect(parsed).toBeLessThanOrEqual(65535);
      }
    });

    it("STRESS-5.2: English words ending in 'PORT' must NOT be misclassified as ports", () => {
      const nonPorts = [
        "REPORT",
        "REPORT_URL",
        "ANNUAL_REPORT",
        "PASSPORT",
        "PASSPORT_SECRET",
        "TRANSPORT",
        "TRANSPORT_MODE",
        "AIRPORT",
        "AIRPORT_CODE",
        "EXPORT_PATH",
        "IMPORT_LIMIT",
        "PORTAL_USER",
      ];

      for (const name of nonPorts) {
        const val = inferMockValue(name);
        // None of these should be "3000" (the port mock)
        expect(val).not.toBe("3000");
        expect(val).not.toBe("5432");

        if (name === "REPORT") {
          expect(val).toBe("mock_report");
        } else if (name === "PASSPORT") {
          // Matches PASS category (Secrets/Auth/Tokens)
          expect(val).toBe("covai_mock_secret_key_32chars_test");
        } else if (name === "TRANSPORT") {
          expect(val).toBe("mock_transport");
        } else if (name === "AIRPORT") {
          expect(val).toBe("mock_airport");
        }
      }
    });
  });

  // =========================================================================
  // PERMUTATION SUITE 6: Database Mock Permutations & Dialects
  // =========================================================================
  describe("Database Mock Permutations & Dialects", () => {
    it("STRESS-6.1: Validates all database URI formats", () => {
      const dbVars = [
        { name: "DATABASE_URL", expectedProtocol: "postgresql:" },
        { name: "DB_CONNECTION", expectedProtocol: "postgresql:" },
        { name: "POSTGRES_URL", expectedProtocol: "postgresql:" },
        { name: "PG_URL", expectedProtocol: "postgresql:" },
        { name: "MONGO_URL", expectedProtocol: "mongodb:" },
        { name: "MONGODB_URI", expectedProtocol: "mongodb:" },
        { name: "MYSQL_URL", expectedProtocol: "mysql:" },
        { name: "REDIS_URL", expectedProtocol: "redis:" },
        { name: "SQLITE_URL", expected: "sqlite://mock.db" },
        { name: "SQLITE_CONNECTION", expected: "sqlite://mock.db" },
        { name: "AMQP_URL", expectedProtocol: "amqp:" },
        { name: "RABBITMQ_URL", expectedProtocol: "amqp:" },
      ];

      for (const { name, expected, expectedProtocol } of dbVars) {
        const val = inferMockValue(name);
        if (expected) {
          expect(val).toBe(expected);
        } else if (expectedProtocol) {
          expect(val.startsWith(expectedProtocol)).toBe(true);
        }
      }
    });
  });

  // =========================================================================
  // PERMUTATION SUITE 7: 100-Cycle Randomized Mutation Stress Invariant
  // =========================================================================
  describe("High-Frequency Randomized Stress Invariant", () => {
    it("STRESS-7.1: 100 random mutation cycles preserve all unmodified variables and idempotency", () => {
      let currentContent = [
        "# Initial production configuration",
        "APP_NAME=CovAI",
        "APP_ENV=production",
        'APP_SECRET="s3cr3t_v@lu3_w!th_symb0ls_#123"',
        "DATABASE_URL=postgresql://usr:pwd@db.internal:5432/covai",
        "REDIS_PORT=6379",
        'MULTILINE_CERT="-----BEGIN CERTIFICATE-----\\nMIICxjCCAe+g...\\n-----END CERTIFICATE-----"',
        "",
        "# Feature flags",
        "ENABLE_AI=true",
        "DEBUG_LOGS=false",
      ].join("\n");

      const dynamicKeys = ["DYNAMIC_KEY_A", "DYNAMIC_KEY_B", "DYNAMIC_KEY_C", "APP_ENV", "ENABLE_AI"];

      for (let cycle = 0; cycle < 100; cycle++) {
        const randomKey = dynamicKeys[cycle % dynamicKeys.length];
        const randomValue = `val_cycle_${cycle}_${Math.random().toString(36).slice(2)}`;

        const updated = serializeEnv(currentContent, { [randomKey]: randomValue });

        // Verify the updated variable has the expected value
        const parsed = parseEnv(updated);
        expect(parsed.variables[randomKey]).toBe(randomValue);

        // Verify core stable invariants remain uncorrupted
        expect(parsed.variables.APP_NAME).toBe("CovAI");
        expect(parsed.variables.DATABASE_URL).toBe("postgresql://usr:pwd@db.internal:5432/covai");
        expect(parsed.variables.REDIS_PORT).toBe("6379");
        expect(parsed.variables.APP_SECRET).toBe("s3cr3t_v@lu3_w!th_symb0ls_#123");

        // Mathematical idempotency test on each cycle:
        // serializeEnv(updated, {}) === updated
        const reSerialized = serializeEnv(updated, {});
        expect(reSerialized).toBe(updated);

        currentContent = updated;
      }
    });
  });
});
