# Supertest Coverage Parser

## 1. Purpose
Tính năng này dùng để đọc các file coverage report (`coverage-summary.json`, `coverage-final.json`) được tạo sau khi Supertest/Jest chạy, phân tích dữ liệu coverage (line, branch, function, statement) và lưu trữ vào database để truy vấn.

## 2. Workflow
Supertest Coverage Service
→ Coverage Output (`coverage/`)
→ Coverage Summary Parser (`coverage-summary.json`) → `CoverageSummary` (DB)
→ Coverage File Parser (`coverage-final.json`) → `CoverageFile` (DB)
→ Coverage Function Parser (`coverage-final.json`) → `CoverageFunction` (DB)

## 3. Logic
- **Coverage Summary Parser**:
    - Đọc và validate `coverage-summary.json`.
    - Parse tổng hợp line, branch, function, statement coverage.
    - Lưu/Update `CoverageSummary` record vào DB.
- **Coverage File Parser**:
    - Đọc `coverage-final.json` (hoặc report object).
    - Tính toán phần trăm coverage cho từng file (line, branch, function, statement).
    - Xóa dữ liệu cũ và tạo mới `CoverageFile` records cho snapshot.
- **Coverage Function Parser**:
    - Đọc `coverage-final.json` (hoặc report object).
    - Trích xuất thông tin function (tên, vị trí dòng, số lần hit) từ `fnMap` (Istanbul) hoặc danh sách function.
    - Xóa dữ liệu cũ và tạo mới `CoverageFunction` records cho snapshot.
- **Xử lý lỗi**: Throw `ServiceError` nếu file không tồn tại, JSON không hợp lệ, hoặc không tìm thấy dữ liệu coverage.

## 4. Input API nhận gì?
Đây là các internal service, không nhận HTTP request trực tiếp.

- `parseCoverageSummary(coverageDir, snapshotId)`:
    - `coverageDir`: Thư mục chứa `coverage-summary.json`.
    - `snapshotId`: ID của snapshot.
- `parseCoverageFilesForSnapshot({ projectId, snapshotId, coverageReport, userId })`:
    - `projectId`, `snapshotId`, `userId`: Thông tin định danh và quyền.
    - `coverageReport`: Object chứa dữ liệu coverage (từ `coverage-final.json`).
- `parseCoverageFunctionsForSnapshot({ projectId, snapshotId, coverageReport, userId })`:
    - Tương tự như `parseCoverageFilesForSnapshot`.

## 5. Output API trả về gì?
Service không trả HTTP response trực tiếp.

- `parseCoverageSummary`: Trả về object chứa summary record và tổng hợp dữ liệu.
- `parseCoverageFilesForSnapshot`: Trả về danh sách file coverage đã parse.
- `parseCoverageFunctionsForSnapshot`: Trả về danh sách function coverage đã parse.
- Dữ liệu được lưu trực tiếp vào database thông qua Prisma.

## 6. Related
- `Supertest Coverage Service`: Điều phối pipeline và gọi các parser.
- `coverageSummaryParser.service.js`: Parse tổng quan coverage.
- `coverageFileParser.service.js`: Parse coverage theo file.
- `coverageFunctionParser.service.js`: Parse coverage theo function.
- `Prisma`: Lưu trữ dữ liệu vào DB (`CoverageSummary`, `CoverageFile`, `CoverageFunction`).
- `coverage-summary.json`, `coverage-final.json`: Các file input từ Jest.

## 7. Notes
- `coverage-summary.json` và `coverage-final.json` phải tồn tại trước khi parse.
- Dữ liệu coverage được mapping chính xác với `snapshotId`.
- Sử dụng Prisma transaction để đảm bảo tính toàn vẹn khi cập nhật `CoverageFile` và `CoverageFunction`.
- Hỗ trợ cả định dạng Istanbul/Jest mặc định.
- Không làm mất coverage data khi một parser riêng lẻ thất bại (do được gọi độc lập trong pipeline).