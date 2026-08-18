# Supertest Runner Service

## 1. Purpose
Tính năng này dùng để thực thi các file Supertest/Integration Test của dự án trong một môi trường cô lập (Docker container) và trả về kết quả thực thi, bao gồm stdout, stderr, và đường dẫn đến thư mục coverage.

## 2. Workflow
Supertest Coverage Job
→ `runSupertest(jobId, rootDir, jestConfigPath, supertestFiles)`
→ `dockerRunner.run` (Thực thi trong Docker container)
→ Jest (Chạy test files)
→ Execution Result
→ Supertest Coverage Job

## 3. Logic
- Validate `rootDir` và đảm bảo là thư mục tồn tại.
- Kiểm tra và chuẩn hóa danh sách `supertestFiles`, đảm bảo các file nằm trong `rootDir` (ngăn chặn path traversal).
- Xác định Jest binary phù hợp (hỗ trợ ESM qua `--experimental-vm-modules` nếu cần).
- Tạo thư mục `coverage` nếu chưa tồn tại.
- Xây dựng command chạy Jest với các tham số: `--runInBand`, `--coverage`, `--json`, `--forceExit`, `--testTimeout=30000`.
- Thêm cấu hình Jest (`--config`) nếu được cung cấp.
- Gọi `dockerRunner.run` để thực thi command trong môi trường cô lập với timeout 5 phút.
- Ghi log quá trình thực thi thông qua `addJobLog`.
- Xử lý kết quả: nếu exit code khác 0, throw `ServiceError`.
- Trả về kết quả thực thi (exitCode, stdout, stderr, executionTimeMs, coverageDir).

## 4. Input API nhận gì?
Đây là internal service, không nhận HTTP request trực tiếp.
Tham số của function `runSupertest(jobId, rootDir, jestConfigPath, supertestFiles)`:
- `jobId` (string): ID của Job đang thực thi.
- `rootDir` (string): Đường dẫn tuyệt đối đến thư mục gốc của dự án.
- `jestConfigPath` (string|null): Đường dẫn đến file cấu hình Jest.
- `supertestFiles` (array): Danh sách các file test cần chạy.

## 5. Output API trả về gì?
Service không trả HTTP response trực tiếp. Service trả execution result cho service gọi nó:

```json
{
  "exitCode": 0,
  "stdout": "...",
  "stderr": "...",
  "executionTimeMs": 1234,
  "coverageDir": "/absolute/path/to/coverage"
}
```
- Nếu test thất bại hoặc Docker runner lỗi, service sẽ throw `ServiceError`.

## 6. Related
- `supertestDetection.service.js`: Xác định các file test cần chạy.
- `dockerRunner.service.js`: Thực thi command trong môi trường cô lập (delegated).
- `job.service.js`: Ghi log quá trình thực thi.
- `projectRootResolver.js`: Giải quyết đường dẫn gốc dự án.
- `Jest`: Framework thực thi test.

## 7. Notes
- `rootDir` phải tồn tại và là directory.
- Supertest files phải nằm bên trong project root (ngăn chặn path traversal).
- Sử dụng `dockerRunner` để cô lập môi trường thực thi.
- Timeout mặc định là 5 phút (`SUPERTEST_TIMEOUT_MS`).
- Capture stdout/stderr từ `dockerRunner` để phục vụ logging.
- Cleanup container được quản lý bởi `dockerRunner`.