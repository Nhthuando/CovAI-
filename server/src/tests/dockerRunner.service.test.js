import { describe, test, expect } from "@jest/globals";
import { inspectDockerAvailability, DOCKER_STATUS_CODES, dockerRunner } from "../services/dockerRunner.service.js";
import { runUnitTestBatch } from "../services/unitTestBatchRunner.service.js";

describe("Docker Runner Availability & Diagnostics", () => {
    const okFs = {
        constants: { R_OK: 4, W_OK: 2 },
        existsSync: () => true,
        accessSync: () => {},
    };

    test("1. Docker daemon reachable returns RUNNER_AVAILABLE", () => {
        const result = inspectDockerAvailability({
            env: {},
            platform: "linux",
            fsImpl: okFs,
            spawnSyncImpl: (_cmd, args) => {
                if (args[0] === "--version") return { status: 0, stdout: "Docker version 27.5.1\n", stderr: "" };
                if (args[0] === "info") return { status: 0, stdout: "29.4.1\n", stderr: "" };
                return { status: 1 };
            },
        });
        expect(result.available).toBe(true);
        expect(result.code).toBe(DOCKER_STATUS_CODES.RUNNER_AVAILABLE);
        expect(result.details.serverVersion).toBe("29.4.1");
    });

    test("2. Docker daemon unavailable returns DOCKER_DAEMON_UNAVAILABLE", () => {
        const result = inspectDockerAvailability({
            env: {},
            platform: "linux",
            fsImpl: okFs,
            spawnSyncImpl: (_cmd, args) => {
                if (args[0] === "--version") return { status: 0, stdout: "Docker version 27.5.1\n", stderr: "" };
                return { status: 1, stdout: "", stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" };
            },
        });
        expect(result.available).toBe(false);
        expect(result.code).toBe(DOCKER_STATUS_CODES.DOCKER_DAEMON_UNAVAILABLE);
    });

    test("3. Missing socket returns DOCKER_SOCKET_MISSING", () => {
        const result = inspectDockerAvailability({
            env: {},
            platform: "linux",
            fsImpl: { ...okFs, existsSync: () => false },
            spawnSyncImpl: () => ({ status: 0 }),
        });
        expect(result.available).toBe(false);
        expect(result.code).toBe(DOCKER_STATUS_CODES.DOCKER_SOCKET_MISSING);
        expect(result.reason).toContain("/var/run/docker.sock");
    });

    test("4. Invalid socket permissions returns DOCKER_PERMISSION_DENIED", () => {
        const result = inspectDockerAvailability({
            env: {},
            platform: "linux",
            fsImpl: {
                ...okFs,
                accessSync: () => {
                    const err = new Error("EACCES: permission denied");
                    err.code = "EACCES";
                    throw err;
                },
            },
            spawnSyncImpl: () => ({ status: 0 }),
        });
        expect(result.available).toBe(false);
        expect(result.code).toBe(DOCKER_STATUS_CODES.DOCKER_PERMISSION_DENIED);
    });

    test("5. Runner disabled via DISABLE_DOCKER_RUNNER returns RUNNER_DISABLED", () => {
        const result = inspectDockerAvailability({
            env: { DISABLE_DOCKER_RUNNER: "true" },
            platform: "linux",
            fsImpl: okFs,
            spawnSyncImpl: () => ({ status: 0 }),
        });
        expect(result.available).toBe(false);
        expect(result.code).toBe(DOCKER_STATUS_CODES.RUNNER_DISABLED);
    });

    test("6. Docker API error returns DOCKER_API_ERROR and missing CLI returns DOCKER_CLI_MISSING", () => {
        const apiErr = inspectDockerAvailability({
            env: {},
            platform: "linux",
            fsImpl: okFs,
            spawnSyncImpl: (_cmd, args) => {
                if (args[0] === "--version") return { status: 0, stdout: "Docker version 27.5.1\n", stderr: "" };
                return { status: 1, stdout: "", stderr: "Error response from daemon: client version 1.54 is too new. Maximum supported API version is 1.44" };
            },
        });
        expect(apiErr.available).toBe(false);
        expect(apiErr.code).toBe(DOCKER_STATUS_CODES.DOCKER_API_ERROR);

        const cliMissing = inspectDockerAvailability({
            env: {},
            platform: "linux",
            fsImpl: okFs,
            spawnSyncImpl: () => ({ status: null, error: Object.assign(new Error("spawnSync docker ENOENT"), { code: "ENOENT" }) }),
        });
        expect(cliMissing.available).toBe(false);
        expect(cliMissing.code).toBe(DOCKER_STATUS_CODES.DOCKER_CLI_MISSING);
    });

    test("7. runUnitTestBatch surfaces specific diagnostic code when requireDocker is true and unavailable", async () => {
        const origCheck = dockerRunner.checkAvailability;
        const origEnabled = dockerRunner.containerEnabled;
        dockerRunner.containerEnabled = false;
        dockerRunner.checkAvailability = () => ({
            available: false,
            code: DOCKER_STATUS_CODES.DOCKER_SOCKET_MISSING,
            reason: "Docker socket not found at /var/run/docker.sock.",
        });
        try {
            await expect(
                runUnitTestBatch({
                    rootDir: "/tmp/nonexistent",
                    snapshot: {},
                    testFiles: [],
                    targetSourceFiles: [],
                    coverageDir: "/tmp/cov",
                    requireDocker: true,
                })
            ).rejects.toThrow(/DOCKER_SOCKET_MISSING/);
        } finally {
            dockerRunner.checkAvailability = origCheck;
            dockerRunner.containerEnabled = origEnabled;
        }
    });
});
