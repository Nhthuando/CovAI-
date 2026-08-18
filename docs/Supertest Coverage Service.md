# Supertest Coverage Service

## 1. Purpose
Tính năng này thực hiện toàn bộ pipeline cho Supertest Coverage, bao gồm:
- Chạy Supertest integration tests.
- Thu thập và phân tích coverage.
- Lưu trữ kết quả coverage vào database và storage.

## 2. Workflow
Supertest Coverage Job
→ `processSupertestCoverageJob(jobId)`
→ `detectSupertest` (Xác định file test)
→ `runSupertest` (Thực thi test)
→ `parseCoverageSummary` / `parseJestResults` (Phân tích kết quả)
→ `storeCoverageOutputs` (Lưu trữ)
→ `markJobSuccess` (Hoàn thành Job)

## 3. Logic
- Validate Job và Snapshot (đảm bảo `rootDir` tồn tại).
- Gọi `detectSupertest` để xác định các file test Supertest.
- Gọi `runSupertest` (từ `Supertest Runner Service`) để thực thi test và thu thập coverage.
- Lưu output (stdout/stderr) của quá trình chạy test.
- Parse coverage summary (`coverage-summary.json`) và coverage final (`coverage-final.json`).
- Parse kết quả test (`parseJestResults`) và lưu vào bảng `TestRun` (SCRUM-141).
- Parse chi tiết coverage file và function (`coverageFileParser`, `coverageFunctionParser`).
- Lưu trữ artifacts coverage vào storage thông qua `storeCoverageOutputs`.
- Cập nhật tiến độ Job (`updateJobProgress`) và mark Job SUCCESS.
- Xử lý lỗi: Nếu test thất bại hoặc thiếu file coverage, throw `ServiceError` và mark Job FAILED.

## 4. Input API nhận gì?
Đây là internal service, không nhận HTTP request trực tiếp.
Tham số của function `processSupertestCoverageJob(jobId)`:
- `jobId` (string): ID của Job cần thực hiện Supertest Coverage.

Thông tin được lấy từ database thông qua `jobId`:
- `snapshotId`, `projectId`, `userId`, `rootDir`, `jestConfigPath`.

## 5. Output API trả về gì?
Service không trả HTTP response trực tiếp. Kết quả được lưu vào database thông qua `markJobSuccess`:

```json
{
  "coverage": {
    "lines": 80,
    "branches": 70,
    "functions": 75,
    "statements": 80
  },
  "supertest": {
    "version": "7.x",
    "testFileCount": 2,
    "configFile": "jest.config.js",
    "exitCode": 0
  },
  "storageBasePath": "..."
}
```

## 6. Related
- `supertestDetection.service.js`: Xác định các file test cần chạy.
- `supertestRunner.service.js`: Thực thi Supertest/Jest và trả execution result.
- `coverageSummaryParser.service.js`: Đọc và phân tích coverage summary.
- `coverageFileParser.service.js`: Phân tích coverage theo file.
- `coverageFunctionParser.service.js`: Phân tích coverage theo function.
- `coverageStorage.service.js`: Lưu trữ coverage artifacts.
- `job.service.js`: Quản lý trạng thái và progress của Job.
- `testResultParser.service.js`: Phân tích kết quả test (Jest).
- `Prisma`: Lưu trữ kết quả `TestRun`.

## 7. Notes
- Phải có Supertest test files trước khi chạy coverage.
- Coverage output phải được tạo đúng thư mục (`coverage/`).
- Phải kiểm tra sự tồn tại của `coverage-summary.json` và `coverage-final.json` trước khi parse.
- stdout/stderr được lưu để phục vụ debugging.
- Phải xử lý test failure và coverage parsing failure.
- Phải update Job progress đúng lifecycle (10%, 50%, 80%).
- Phải mark Job FAILED khi pipeline gặp lỗi.