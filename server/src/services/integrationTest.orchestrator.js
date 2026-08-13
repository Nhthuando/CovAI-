import { detectFrameworks } from "./testDetection.service.js";
import { runPlaywrightTests } from "./playwrightRunner.service.js";
import { runSupertestTests } from "./supertestRunner.service.js";
import { ServiceError } from "./project.service.js";

/**
 * Orchestrator cho Integration Test Pipeline
 * Điều phối việc xác định framework và chạy runner tương ứng
 */
export const runIntegrationTestPipeline = async ({
  projectId,
  snapshotId,
  userId,
}) => {
  // 1. Detect các frameworks đang sử dụng
  const frameworks = await detectFrameworks(projectId);

  if (!frameworks || frameworks.length === 0) {
    throw new ServiceError(
      "Không tìm thấy framework hỗ trợ cho Integration Test.",
      404,
    );
  }

  const results = [];

  // 2. Chạy lần lượt các runner dựa trên kết quả detect
  for (const item of frameworks) {
    const fw = item.framework;
    try {
      let result = null;
      if (fw === "playwright") {
        result = await runPlaywrightTests({ projectId, snapshotId, userId });
      } else if (fw === "supertest") {
        result = await runSupertestTests({ projectId, snapshotId, userId });
      }

      if (result) {
        results.push({ framework: fw, status: "SUCCESS", data: result });
      }
    } catch (err) {
      console.error(`Lỗi khi chạy ${fw} runner:`, err);
      results.push({ framework: fw, status: "FAILED", error: err.message });
    }
  }

  // 3. Gom kết quả (Có thể mở rộng thêm logic lưu vào DB tại đây)
  return {
    success: true,
    results,
  };
};
