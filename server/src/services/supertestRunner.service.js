import { dockerRunner } from "./dockerRunner.service.js";
import { addJobLog } from "./job.service.js";
import path from "path";

const SUPERTEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 phút

/**
 * Chạy Supertest integration tests thông qua Jest.
 * Tái sử dụng hạ tầng Jest hiện có.
 */
export const runSupertest = async (jobId, rootDir, jestConfigPath, supertestFiles = []) => {
    // Lệnh chạy test cụ thể cho các file supertest (nếu cần tách biệt)
    // Hiện tại tái sử dụng Jest engine, chỉ cần đảm bảo testMatch khớp
    const quoteForShell = (value) => `'${value.replaceAll("'", "'\\''")}'`;
    const testArgs = supertestFiles
        .map((file) => path.relative(rootDir, file).replace(/\\/g, '/'))
        .filter((file) => file && !file.startsWith('../'))
        .map(quoteForShell)
        .join(' ');

    // API/database integration tests must use the test environment and run in
    // one process so shared database fixtures cannot race each other.
    let jestCmd = "NODE_ENV=test npx jest --runInBand --coverage --coverageReporters=json-summary --coverageReporters=json --coverageReporters=lcov --forceExit --testTimeout=30000";
    if (testArgs) jestCmd += ` ${testArgs}`;

    if (jestConfigPath) {
        const relativeConfig = path.relative(rootDir, jestConfigPath).replace(/\\/g, '/');
        jestCmd += ` --config=${relativeConfig}`;
    }

    await addJobLog(jobId, "INFO", "[SUPERTEST] Bắt đầu chạy integration tests...").catch(() => { });

    const result = await dockerRunner.run({
        snapshotPath: rootDir,
        command: jestCmd,
        timeoutMs: SUPERTEST_TIMEOUT_MS,
        jobId
    });

    if (!result.success && result.exitCode !== null && result.exitCode >= 2) {
        const msg = `[SUPERTEST] Integration tests thất bại với exit code ${result.exitCode}`;
        await addJobLog(jobId, "ERROR", msg).catch(() => { });
        throw new Error(msg);
    }

    await addJobLog(jobId, "INFO", `[SUPERTEST] Integration tests hoàn thành (exit ${result.exitCode}).`).catch(() => { });

    // Trả về đường dẫn coverage để pipeline coverage xử lý
    return {
        exitCode: result.exitCode,
        coverageDir: path.join(rootDir, "coverage")
    };
};
