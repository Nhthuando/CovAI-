import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { getJobById, addJobLog } from "./job.service.js";
import { updateJobStatus } from "./jobUpdate.service.js";
import { scanLocalVulnerabilities, scanAiVulnerabilities } from "./securityScanner.service.js";
import fs from "fs";
import path from "path";

// Đọc source code từ thư mục
const loadSourceFiles = (rootDir) => {
    if (!rootDir || !fs.existsSync(rootDir)) return [];
    const results = [];
    
    const walkSync = (dir) => {
        if (results.length >= 20) return; // Limit files
        const files = fs.readdirSync(dir);
        for (const file of files) {
            if (file === "node_modules" || file === ".git") continue;
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
                walkSync(fullPath);
            } else if (['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go'].includes(path.extname(file))) {
                results.push({
                    path: fullPath.replace(rootDir + path.sep, ''), // Relative path
                    content: fs.readFileSync(fullPath, "utf-8")
                });
            }
        }
    };
    walkSync(rootDir);
    return results;
};

export const processSecurityAnalysisJob = async (jobId) => {
    try {
        await updateJobStatus({ jobId, status: "RUNNING", progress: 10 });
        const job = await getJobById(jobId);
        
        await addJobLog(jobId, "INFO", "Đang nạp mã nguồn từ Snapshot...");
        const snapshot = await prisma.projectSnapshot.findUnique({ where: { id: job.snapshotId } });
        const sourceFiles = loadSourceFiles(snapshot?.rootDir);
        
        await updateJobStatus({ jobId, progress: 30 });
        
        // 1. Quét Local
        await addJobLog(jobId, "INFO", "Đang quét Secrets và Dangerous APIs (Local Regex)...");
        const localFindings = scanLocalVulnerabilities(sourceFiles);
        
        await updateJobStatus({ jobId, progress: 50 });
        
        // 2. Quét AI
        await addJobLog(jobId, "INFO", "Đang phân tích các lỗ hổng logic bằng AI (Insecure Patterns)...");
        const aiFindings = await scanAiVulnerabilities(sourceFiles);
        
        await updateJobStatus({ jobId, progress: 80 });
        
        // 3. Gộp & Lưu vào Database
        const allFindings = [...localFindings, ...aiFindings];
        
        // Xóa dữ liệu cũ nếu có
        await prisma.vulnerability.deleteMany({ where: { snapshotId: job.snapshotId } });
        
        if (allFindings.length > 0) {
            await prisma.vulnerability.createMany({
                data: allFindings.map(f => ({
                    snapshotId: job.snapshotId,
                    type: f.type || "UNKNOWN",
                    severity: f.severity || "MEDIUM",
                    file: f.file || "unknown",
                    line: f.line || null,
                    description: f.description || ""
                }))
            });
            await addJobLog(jobId, "INFO", `Đã lưu ${allFindings.length} lỗ hổng bảo mật.`);
        } else {
            await addJobLog(jobId, "INFO", "Xin chúc mừng! Không phát hiện lỗ hổng bảo mật nào.");
        }

        await updateJobStatus({ jobId, status: "SUCCESS", progress: 100 });
    } catch (error) {
        await addJobLog(jobId, "ERROR", `Quá trình quét thất bại: ${error.message}`);
        await updateJobStatus({ jobId, status: "FAILED", errorMessage: error.message }).catch(() => {});
    }
};
