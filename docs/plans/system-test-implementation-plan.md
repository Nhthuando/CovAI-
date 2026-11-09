# KẾ HOẠCH TRIỂN KHAI CHI TIẾT: TÍNH NĂNG SYSTEM TEST (E2E TESTING)
**Dự án:** CovAI (NCKH & Capstone Project)  
**Tác giả lập kế hoạch:** Tech Lead  
**Phiên bản:** v1.3 (CHÍNH THỨC - ĐÃ PHÊ DUYỆT 3 QUYẾT ĐỊNH KIẾN TRÚC)  
**Trạng thái:** Sẵn sàng triển khai Phase 1  
**Mục tiêu:** Xử lý triệt để bug rò rỉ dữ liệu (data leakage), hợp nhất 2 luồng Job backend thành một pipeline chuẩn mực, tự động hóa vòng đời ứng dụng cần test (AUT) trong phạm vi khả thi của Capstone, đo độ bao phủ linh hoạt (Dual-track Coverage) và tích hợp AI sinh E2E test có kiểm định thực tế.

---

## 1. TỔNG QUAN KIẾN TRÚC MỤC TIÊU (PRAGMATIC CHO CAPSTONE DEMO)

```
[Snapshot Ingestion]
       │
       ▼
[Phase 2: Detect E2E Framework]
       ├─────────────────────────────────┬─────────────────────────────────┐
       ▼ (Chưa có E2E Test)               ▼ (Đã có Playwright / Cypress)    │
[Phase 5: CTA "Generate AI Test"]        │                                 │
       │                                 │                                 │
       ├─► Gemini sinh Test kịch bản     │                                 │
       ├─► Babel AST kiểm tra cú pháp    │                                 │
       └─► Dry-run 1 lần (Pass -> Save)  │                                 │
                     │                   │                                 │
                     └───────────────────┼─────────────────────────────────┘
                                         ▼
                 [Phase 3: Chuẩn bị Môi trường & Start AUT]
                                         ├─► Quét .env.example tạo mock env tối thiểu
                                         ├─► Chạy seed script nếu có
                                         ├─► Bật AUT (npm run dev/start) trên host
                                         └─► Healthcheck 2 tầng: Port open + HTTP GET 200
                                         ▼
                 [Phase 4: Execution Engine & Dual-track Coverage]
                                         ├─► [ĐÃ CHỐT]: Playwright làm Golden Runner
                                         ├─► [ĐÃ CHỐT]: DISABLE_DOCKER_RUNNER=true
                                         │   (Chạy trực tiếp host headless, triệt tiêu lỗi network)
                                         ├─► Chạy Playwright (--retries=1)
                                         ├─► [ĐÃ CHỐT]: Phân loại & lưu TestRun.flakyTests
                                         ├─► Track 1: Istanbul (nếu có)
                                         ├─► Track 2: V8/CDP (nếu không có Istanbul)
                                         ├─► [ĐÃ CHỐT]: Fallback hiển thị bảng Kịch bản Test
                                         └─► [VERIFY ĐỢT 2 CỦA PHASE 1: POPULATE STATE]
                                         ▼
                 [Phase 1: Domain Isolation & Hiển thị UI]
                                         ├─► API riêng chỉ đọc TestRun (PLAYWRIGHT/CYPRESS)
                                         └─► UI sạch, không lẫn math.js của Unit test
```

---

## 2. KẾ HOẠCH CHI TIẾT TỪNG PHASE

---

### Phase 1: Cô Lập Dữ Liệu, Kiểm Tra Dữ Liệu Cũ & Sửa Bug Data Leakage Trên UI/API
- **Mục tiêu:** Loại bỏ hoàn toàn lỗi hiển thị dữ liệu Jest (`math.js 50%`) trên tab System Test khi chưa có test E2E nào; bảo toàn dữ liệu lịch sử bằng cách kiểm tra tương thích ngược `TestRun.type`; thiết lập endpoint API và phân tách giao diện chuẩn giữa 2 trạng thái: Empty State (chưa chạy) và Populated State (đã có kết quả E2E).
- **Input/Điều kiện tiên quyết:** Không có (Bắt đầu ngay, ưu tiên số 1 để tránh lỗi hiển thị khi demo).
- **Công việc cụ thể:**
  1. *Database - Kiểm tra tương thích ngược dữ liệu `TestRun.type`:*
     - Chạy script kiểm tra nhanh các giá trị thực tế đang có trong bảng `TestRun`:
       ```sql
       SELECT DISTINCT type FROM "TestRun";
       ```
     - Xác nhận nhánh cũ (`playwrightSystemCoverageJob` / `cypressSystemCoverageJob`) ghi giá trị gì:
       - Trong schema Prisma, enum `TestType` chuẩn là: `JEST`, `SUPERTEST`, `PLAYWRIGHT`, `CYPRESS`, `VITEST`.
       - Đảm bảo câu lệnh query ở controller hỗ trợ đầy đủ các bản ghi hợp lệ: `type IN ['PLAYWRIGHT', 'CYPRESS']`.
  2. *Backend - Sửa Controller [`server/src/controllers/coverage.controller.js`]:*
     - Viết hàm `getSystemTestSummary(req, res)`:
       - Query bảng `TestRun` lọc theo `snapshotId` VÀ `type IN ['PLAYWRIGHT', 'CYPRESS']`.
       - Lấy thông tin bản ghi `TestRun` gần nhất.
       - Nếu không có bản ghi nào: Trả về trạng thái rỗng chuẩn:
         ```json
         {
           "success": true,
           "data": {
             "hasRun": false,
             "e2eTests": 0,
             "passed": 0,
             "failed": 0,
             "flaky": 0,
             "coverageAvailable": false,
             "featureCoverage": null,
             "files": [],
             "testRuns": []
           }
         }
         ```
       - Nếu đã có bản ghi: Trả về số lượng `totalTests`, `passedTests`, `failedTests`, `flakyTests` và danh sách test cases/files thực tế của riêng E2E.
       - **Quy tắc bất biến:** Tuyệt đối không đọc bảng `CoverageSummary` hay `CoverageFile` của Unit Test (Jest/Vitest).
  3. *Backend - Định tuyến [`server/src/routes/coverage.route.js`]:*
     - Thêm route: `GET /:snapshotId/system/summary` trỏ vào controller trên.
  4. *Frontend - Cập nhật API Client [`client/src/services/coverage.service.js`]:*
     - Bổ sung hàm `getSystemCoverageSummary(snapshotId)`.
  5. *Frontend - Tách Biệt Render Cho System Test [`client/src/components/dashboard/CoverageTypeDashboard.jsx`]:*
     - Tại hàm `load()`, khi `type === "system"`:
       - Gọi riêng `getSystemCoverageSummary(snapshotId)`.
       - **Trạng thái A (Empty State - `hasRun === false`):**
         - Render giao diện sạch: Thẻ `E2E TESTS`, `PASSED`, `FAILED`, `FLAKY` đều là `0`. Thẻ `FEATURE COVERAGE` hiển thị `N/A`.
         - Bảng file hiển thị Empty State: *"Chưa có kịch bản E2E nào được thực thi trên snapshot này"*.
         - Hiện nút CTA: `⚡ Generate AI System Tests` hoặc `Run System Test`.
       - **Trạng thái B (Populated State - `hasRun === true`):**
         - Render số liệu thật từ E2E TestRun.
         - Nếu `coverageAvailable === false`: Render danh sách các **Kịch bản kiểm thử (Test Scenarios)** đã chạy (Tên test, thời gian ms, trạng thái Pass/Fail/Flaky), thẻ coverage hiện `N/A (Black-box)` kèm tooltip giải thích.
  6. *Frontend - Xóa bỏ Mock trong [`client/src/components/dashboard/CoverageDashboard.jsx`]:*
     - Xóa logic mock ném lỗi demo trong `handleRunSystemTest`.
- **DoD (Definition of Done) - Chia 2 phần rõ ràng:**
  - **DoD 1.1 (Verify Empty State - Thực hiện ngay tại Phase 1):**
    - Mở tab System Test trên UI khi vừa import snapshot: Bảng `Files exercised by E2E tests` trống rỗng 100% (không còn file `math.js`).
    - Thẻ `FEATURE COVERAGE` hiển thị `N/A`, các thẻ `E2E TESTS`, `PASSED`, `FAILED`, `FLAKY` đều là `0`.
    - Gọi API `GET /api/coverage/:snapshotId/system/summary` trả về `hasRun: false`, `e2eTests: 0`.
  - **DoD 1.2 (Verify Populated State - Dời sang cuối Phase 4 sau khi có test thật):**
    - Khi có bản ghi `TestRun` kiểu `PLAYWRIGHT` trong DB, API trả về đúng các con số thực tế. UI hiển thị chính xác số test passed/failed của riêng E2E, không rò rỉ bất kỳ số liệu nào của Unit Test.
- **Checkpoint để verify (Thủ công cho Phase 1):**
  - *Checkpoint 1 (Empty State):* Chạy `npm run dev`, mở tab System Test trên UI. Kiểm tra Network tab: xác nhận không còn dữ liệu `math.js`.
  - *Checkpoint 2 (Mock Data Populated State - Dùng Fixture):* Tạo 1 script tạm trong scratch insert 1 bản ghi `TestRun` mẫu (`type: "PLAYWRIGHT", totalTests: 2, passedTests: 2`) -> F5 lại giao diện System Test -> Xác nhận UI chuyển từ Empty State sang Populated State hiển thị 2 tests passed và `N/A` coverage.
- **Rủi ro/điểm dễ sai:**
  - Nhầm lẫn giữa state của component dùng chung `CoverageTypeDashboard.jsx` cho cả 3 tab (unit, integration, system). Cần đảm bảo thêm điều kiện rẽ nhánh theo `type === "system"` để không làm hỏng giao diện tab Unit Test đang chạy tốt.
- **Ước lượng thời gian:** 1.5 ngày làm việc.

---

### Phase 2: Hợp Nhất Job Queue Backend Về `SYSTEM_TEST_ANALYSIS` & Cải Tiến Detection
- **Mục tiêu:** Xóa bỏ sự phân mảnh giữa nhánh cũ và nhánh mới; gom toàn bộ luồng chạy E2E về một Job duy nhất `SYSTEM_TEST_ANALYSIS` và làm cho bộ nhận diện framework (Detector) linh hoạt, không bắt buộc cứng script `test:e2e`.
- **Input/Điều kiện tiên quyết:** Hoàn thành Phase 1.
- **Công việc cụ thể:**
  1. *Hợp nhất Dispatcher [`server/src/controllers/coverage.controller.js`]:*
     - Trong hàm `runCoverageByType`:
       - Khi `coverageType === "system"`: Thay vì tạo các job cũ (`createPlaywrightSystemCoverageJob`, `createCypressSystemCoverageJob`), chuyển sang gọi hàm `createSystemTestAnalysisJob({ projectId, snapshotId, userId, runner })`.
       - Đưa job vào hàng đợi với type duy nhất: `addJobToQueue("SYSTEM_TEST_ANALYSIS", job.id)`.
  2. *Cập nhật Queue Worker [`server/src/services/queue.service.js`]:*
     - Bỏ nhánh xử lý `case 'PLAYWRIGHT_SYSTEM_COVERAGE'` và `case 'CYPRESS_SYSTEM_COVERAGE'`, hoặc chuyển tiếp (redirect) chúng gọi trực tiếp hàm `processSystemTestAnalysisJob(jobId)`.
  3. *Cải tiến Detector [`server/src/services/systemTestDetection.service.js`]:*
     - Nới lỏng điều kiện kiểm tra framework (Tập trung chính vào **Playwright**):
       - **Playwright:** Phát hiện nếu `dependencies` hoặc `devDependencies` có `@playwright/test` HOẶC có file config `playwright.config.*`.
         - Nếu `scripts` có `test:e2e` hoặc `test:e2e:playwright` -> Dùng script đó.
         - Nếu KHÔNG có script nào định nghĩa sẵn -> Fallback tự động dùng lệnh mặc định: `npx playwright test`.
       - **Cypress (Detection cơ bản):** Nếu có package `cypress` hoặc `cypress.config.*`:
         - Nếu không có script -> Fallback dùng lệnh mặc định: `npx cypress run`.
     - Nhận diện các thư mục test phổ biến: `e2e/`, `tests/e2e/`, `cypress/e2e/`, `tests/system/`.
  4. *Chuẩn hóa Job Service [`server/src/services/systemTestAnalysisJob.service.js`]:*
     - Đảm bảo job luôn hoàn thành với trạng thái `SUCCESS` nếu test suite chạy xong (dù test case pass hay fail thì kết quả test vẫn được ghi lại vào DB, chỉ fail job nếu có lỗi hạ tầng/crash process).
- **DoD (Definition of Done) - Đo Lường Chặt Chẽ:**
  - **Tiêu chuẩn đo 1:** Chạy lệnh grep trên terminal shell:
    ```bash
    git grep -n "createPlaywrightSystemCoverageJob" server/src/controllers
    git grep -n "createCypressSystemCoverageJob" server/src/controllers
    ```
    -> Kết quả phải là **0 match** (không còn controller nào gọi job cũ).
  - **Tiêu chuẩn đo 2:** Bấm nút "Run Analysis" ở tab System Test trên UI, BullMQ chỉ tạo ra đúng 1 Job duy nhất có type `SYSTEM_TEST_ANALYSIS`.
  - **Tiêu chuẩn đo 3:** Một project có Playwright nhưng trong `package.json` hoàn toàn không có script `test:e2e` thì detector vẫn nhận diện thành công và sinh lệnh thực thi `npx playwright test`.
- **Checkpoint để verify:**
  - Chạy lệnh shell kiểm tra:
    ```bash
    git grep -n "PLAYWRIGHT_SYSTEM_COVERAGE" server/src/controllers server/src/routes
    ```
  - Gọi curl:
    ```bash
    curl -X POST http://localhost:5000/api/coverage/{snapshotId}/system/run -H "Authorization: Bearer {token}"
    ```
    -> Kiểm tra bảng `Job` trong Postgres: chỉ có 1 job `SYSTEM_TEST_ANALYSIS` được tạo ở trạng thái `QUEUED`/`RUNNING`.
- **Rủi ro/điểm dễ sai:**
  - Tham số truyền vào command giữa các hệ điều hành (Windows shell vs Linux container). Cần dùng dấu nháy chuẩn và format path chuẩn `/` thay vì `\`.
- **Ước lượng thời gian:** 2.0 ngày làm việc.

---

### Phase 3: Tự Động Khởi Động AUT (Application Under Test) & Giới Hạn Phạm Vi Mock DB
- **Mục tiêu:** Quản lý vòng đời web server của dự án cần test (bật lên trước khi test, tắt sạch khi test xong); healthcheck 2 tầng (port open + HTTP 200); thiết lập giới hạn thực tế cho việc mock môi trường trong phạm vi demo đồ án (không hứa suông mock được mọi loại RDBMS).
- **Input/Điều kiện tiên quyết:** Hoàn thành Phase 2.
- **Ranh Giới Kỹ Thuật Thực Tế Cho Capstone (Scope Boundary):**
  - *Không hứa suông mock toàn bộ PostgreSQL/MySQL qua SQLite* (vì Prisma schema dùng enum, jsonb, uuid của Postgres sẽ gãy ngay khi migrate SQLite).
  - *Phạm vi hỗ trợ AUT cho Capstone Demo được định nghĩa rõ ràng:*
    - **Trường hợp 1 (Tối ưu nhất cho Demo):** Dự án frontend thuần (React/Vite/Vue) hoặc mock service worker (MSW) -> Bật `npm run preview` hoặc `npm run dev` trên port động, chạy E2E UI mượt mà 100%.
    - **Trường hợp 2 (Fullstack có DB test sẵn):** Dự án có sẵn file cấu hình `.env.test` hoặc DB test cục bộ.
    - **Trường hợp 3 (Fullstack không có DB):** CovAI inject `.env` mock tối thiểu (`PORT={port}`, `NODE_ENV=test`, `JWT_SECRET=test`). Nếu backend crash vì thiếu DB thật, hệ thống ghi nhận log rõ ràng và ưu tiên kiểm thử các trang Public / Tĩnh, không để crash sập toàn bộ tiến trình CovAI.
- **Công việc cụ thể:**
  1. *Tự động chuẩn bị file cấu hình môi trường Mock (.env):*
     - Viết helper `prepareAutEnvironment(snapshotDir)` trong [`server/src/services/systemTestRunner.service.js`]:
       - Kiểm tra nếu thư mục snapshot chưa có `.env`:
         - Quét tìm `.env.example`, `.env.test`, `.env.sample`.
         - Đọc danh sách biến và gán giá trị mặc định an toàn:
           ```env
           PORT=4173
           NODE_ENV=test
           JWT_SECRET=covai_test_mock_jwt_secret
           ```
         - Ghi ra file `.env` tạm thời trong thư mục snapshot.
  2. *Quản lý Vòng đời Web Server (AUT Lifecycle) & Healthcheck 2 Tầng:*
     - **Playwright Golden Runner:**
       - Kiểm tra file `playwright.config.*`. Nếu chưa có cấu hình `webServer`, CovAI tự sinh hoặc inject cấu hình `webServer` tạm thời:
         ```javascript
         webServer: {
           command: 'npm run start || npm run dev',
           port: 4173,
           reuseExistingServer: false,
           timeout: 60 * 1000,
         }
         ```
     - **Healthcheck 2 Tầng chặt chẽ:**
       - *Tầng 1 (Socket check):* Kiểm tra cổng 4173 đã mở chưa (polling mỗi 500ms, timeout 45s).
       - *Tầng 2 (HTTP Verification):* Sau khi socket mở, gửi 1 request `GET http://localhost:4173/`:
         - Nếu phản hồi có HTTP Status Code nằm trong dải `200 - 399`: Đạt chuẩn, cho phép E2E Runner bắt đầu.
         - Nếu phản hồi trả về mã lỗi `500 - 504`: Ghi log cảnh báo `WARN: AUT server responded with HTTP 500. Backend dependencies or database might be uninitialized.` nhưng vẫn tiếp tục để E2E test kiểm tra giao diện lỗi của người dùng.
       - Trong khối `finally` của runner: Dùng `tree-kill` để tắt sạch toàn bộ cây tiến trình của web server, giải phóng cổng 4173.
  3. *Thực thi Seed Data tối thiểu:*
     - Nếu `package.json` có script `seed` hoặc `db:seed`: Chạy `npm run seed` trước khi bật web server.
     - Nếu không có: Bỏ qua an toàn.
- **DoD (Definition of Done) - Tiêu Chí Đo Lường Chặt Chẽ:**
  - Web server của snapshot tự động bật lên và vượt qua kiểm tra Healthcheck 2 tầng (Port mở + HTTP GET phản hồi status `< 500`).
  - Khi test E2E hoàn tất (dù test PASS hay FAIL hay TIMEOUT), tiến trình web server được tắt hoàn toàn. Kiểm tra `Get-NetTCPConnection -LocalPort 4173` (hoặc `netstat -ano`) không còn tiến trình nào chiếm giữ cổng.
  - Nếu route chính trả về 500 do thiếu DB, hệ thống bắt được lỗi này vào `JobLog`, không bị treo vô hạn (hang).
- **Checkpoint để verify:**
  - Chạy thử với 1 repo web mẫu:
    - Bật task manager hoặc gõ lệnh kiểm tra port: xác nhận cổng 4173 mở khi test bắt đầu và đóng ngay khi test kết thúc.
    - Xem bảng `JobLog`: Có dòng log `[AUT Healthcheck] Successfully connected to http://localhost:4173 with status 200`.
- **Rủi ro/điểm dễ sai:**
  - Việc tắt server dev trên Windows thường để lại tiến trình con `node.exe` mồ côi (orphan process). Cần dùng thư viện `tree-kill` thay vì `childProcess.kill()`.
- **Ước lượng thời gian:** 3.5 - 4.0 ngày làm việc (Đã bao gồm 40% buffer rủi ro process killing).

---

### Phase 4: Quyết Định Network Engine Cho Demo, Retries & Đo Coverage Dual-Track
- **Mục tiêu:** Giải quyết dứt điểm vấn đề networking giữa AUT và Playwright; cấu hình môi trường thực thi an toàn và mượt mà cho demo; xử lý tính bất định của test (Flakiness) bằng cơ chế retry; áp dụng đo độ bao phủ kép (Istanbul + Native V8) với chính sách không bao giờ fail job vì thiếu coverage; hoàn thành nghiệm thu **DoD 1.2 của Phase 1** (Populated State).
- **Input/Điều kiện tiên quyết:** Hoàn thành Phase 3.
- **Quyết Định Kiến Trúc Về Network Cho Demo Capstone (Đã Duyệt):**
  - **Mặc định kích hoạt:** `DISABLE_DOCKER_RUNNER=true` trong `server/.env`.
  - Khi đó, Playwright chạy trực tiếp trên máy host ở chế độ **Headless Browser** (`npx playwright test`).
  - *Lợi thế tối thượng:* Cả AUT và Playwright đều nằm chung trên `localhost` của host machine. Triệt tiêu 100% rủi ro đụng độ mạng, lỗi Docker daemon, hoặc lỗi `net::ERR_CONNECTION_REFUSED` ngay trước ngày bảo vệ.
  - *Chế độ Docker Sandbox:* Được giữ lại dưới dạng cờ Opt-in (khi cần demo riêng phần bảo mật thì trỏ `PLAYWRIGHT_BASE_URL=http://host.docker.internal:4173`).
- **Công việc cụ thể:**
  1. *Cấu hình Runner Execution Engine [`server/src/services/dockerRunner.service.js`]:*
     - Khi `DISABLE_DOCKER_RUNNER=true`: Chạy trực tiếp `npx playwright test` thông qua Node.js `spawn` với shell headless.
     - Khi chạy Docker: Tự động inject `-e PLAYWRIGHT_BASE_URL=http://host.docker.internal:4173` và `--add-host=host.docker.internal:host-gateway` để hỗ trợ cả Linux/Windows.
     - Cấu hình cờ tài nguyên: `--memory=2g --cpus=1.5 --pids-limit=100`.
  2. *Cấu hình Retry & Schema Migration Cho Flaky Tests (Đã Duyệt):*
     - Cập nhật schema Prisma [`server/prisma/schema.prisma`]:
       - Thêm cột `flakyTests Int @default(0)` vào model `TestRun`.
       - Chạy `npx.cmd prisma generate` và tạo migration `npx.cmd prisma migrate dev --name add_flaky_tests_to_testrun`.
     - Thêm cờ `--retries=1` vào câu lệnh chạy Playwright.
     - Cập nhật [`server/src/services/systemTestResultParser.service.js`]:
       - Parse báo cáo JSON của Playwright:
         - `status === "passed"` -> Đếm vào `passedTests`.
         - `status === "flaky"` (fail lượt đầu, pass ở retry) -> Đếm vào `flakyTests`.
         - `status === "failed"` -> Đếm vào `failedTests`.
  3. *Cơ chế Đo Độ Bao Phủ Kép (Dual-Track Coverage):*
     - Cập nhật hàm `persistCoverageIfPresent` trong [`systemTestAnalysisJob.service.js`]:
       - **Track 1:** Kiểm tra thư mục `coverage/`. Nếu có `coverage-summary.json` (do dự án đã cấu hình Istanbul) -> Parse và lưu `CoverageSummary`, `CoverageFile`.
       - **Track 2:** Nếu thư mục `coverage/` không có -> Thu thập file coverage sinh ra từ Playwright V8 CDP (nếu có).
       - **Fallback an toàn:** Nếu cả 2 track đều không có file coverage -> Gán cờ `coverageAvailable: false`. Vẫn lưu bản ghi `TestRun` (Pass, Fail, Flaky) và đánh dấu Job là **SUCCESS 100%**. Tuyệt đối không ném lỗi 422 làm fail Job.
  4. *Nghiệm thu DoD 1.2 của Phase 1 (Populated State):*
     - Sau khi Phase 4 chạy xong và tạo bản ghi `TestRun` thật vào DB -> Gọi lại API Phase 1, xác nhận UI hiển thị chính xác số liệu test thật và hiển thị bảng **Kịch bản kiểm thử (Test Scenarios)**.
- **DoD (Definition of Done) - Tiêu Chí Đo Lường:**
  - Chạy một bài E2E test kết nối tới AUT thành công trên `localhost:4173` mà không gặp bất kỳ lỗi network cross-container nào.
  - Chạy một bài E2E test có 1 test case bị flaky (retry mới pass) -> Hệ thống ghi nhận kết quả test hoàn thành, đếm đúng `flakyTests = 1`, job đạt `SUCCESS`.
  - Chạy một bài test E2E bình thường KHÔNG có cấu hình Istanbul -> Job vẫn hoàn thành `SUCCESS`, UI hiển thị đúng số test Pass/Fail/Flaky và hiển thị bảng danh sách các Test Scenarios.
  - **Nghiệm thu hoàn tất DoD 1.2:** Tab System Test trên UI hiển thị chính xác số test cases của riêng Playwright, không còn dính bất kỳ số liệu nào từ Jest.
- **Checkpoint để verify:**
  - Kiểm tra database: Bảng `TestRun` có bản ghi mới với `type: "PLAYWRIGHT"`, các cột `totalTests`, `passedTests`, `failedTests`, `flakyTests` có số liệu thực tế.
  - Không còn lỗi `ServiceError: Playwright tests completed but no coverage report was generated (422)`.
- **Rủi ro/điểm dễ sai:**
  - Máy host chưa cài binary trình duyệt của Playwright. Khắc phục: Trước khi chạy lần đầu, đảm bảo chạy `npx playwright install chromium` trên máy host.
- **Ước lượng thời gian:** 2.5 ngày làm việc.

---

### Phase 5: Tích Hợp AI Sinh Test E2E (Gemini) + Kiểm Định Cú Pháp (AST) & Dry-Run
- **Mục tiêu:** Xây dựng tính năng AI tự động phân tích routes/components để sinh test case Playwright hoàn chỉnh; có bước kiểm định cú pháp và chạy thử 1 lần (Dry-run) để đảm bảo test chạy được trước khi lưu; nếu lỗi báo cho người dùng, không tạo vòng lặp tự sửa phức tạp.
- **Input/Điều kiện tiên quyết:** Hoàn thành Phase 4.
- **Công việc cụ thể:**
  1. *Xây dựng Prompt Builder Cho E2E Test [`server/src/services/aiPromptBuilder.service.js`]:*
     - Viết hàm `buildPlaywrightPrompt(payload)`:
       - Đọc danh sách file trang (Pages/Routes: `App.jsx`, `routes.jsx`, Express route URLs).
       - Hướng dẫn Gemini sinh test Playwright hoàn chỉnh theo các tiêu chuẩn demo an toàn:
         - Không yêu cầu đăng nhập phức tạp (ưu tiên test trang chủ, thanh điều hướng, các form public, trang 404).
         - Cấm dùng `page.waitForTimeout()` (bắt buộc dùng locator auto-waiting như `expect(page.getByRole(...)).toBeVisible()`).
         - Cấu trúc file chuẩn ESM: `import { test, expect } from '@playwright/test';`.
  2. *Bộ Lọc Cú Pháp & Kiểm Tra Mã Độc Tĩnh (Babel AST Validation):*
     - Viết helper `validateGeneratedTestCode(code)`:
       - Dùng `@babel/parser` parse code sang AST: Nếu có lỗi cú pháp JS -> Reject ngay.
       - Quét cấm các lệnh nguy hiểm: `child_process`, `fs.rmSync`, `process.exit`, `eval`.
  3. *Bước Chạy Thử Nghiệm Cô Lập (Dry-Run Gate):*
     - Trong [`server/src/services/aiTestsJob.service.js`], khi mode là `PLAYWRIGHT_E2E`:
       - Nhận code từ Gemini -> Validate cú pháp AST.
       - Ghi tạm ra file `.covai-temp/dryrun.spec.js`.
       - Chạy thử 1 lần: `npx playwright test .covai-temp/dryrun.spec.js --timeout=15000`.
       - **Nếu Dry-run PASS:** Lưu chính thức vào thư mục `tests/e2e/ai-generated.spec.js`, tạo bản ghi trong bảng `AiTest` với `status: "VERIFIED"`.
       - **Nếu Dry-run FAIL:** Không lưu vào bộ test chính thức. Lưu bản ghi với `status: "FAILED"` kèm nội dung lỗi cụ thể để hiển thị thông báo cho người dùng tự bấm xem, **không cần vòng lặp AI tự sửa phức tạp**.
  4. *API Kích Hoạt Sinh Test E2E:*
     - Endpoint: `POST /api/projects/:id/ai-tests` với payload `{ mode: "PLAYWRIGHT_E2E" }`.
- **DoD (Definition of Done) - Tiêu Chí Đo Lường:**
  - Bấm nút "Generate AI System Tests" trên UI -> Gọi Gemini -> Sinh được file test Playwright hợp lệ.
  - File test vượt qua dry-run và được lưu vào thư mục `tests/e2e/` của snapshot.
  - Nếu Gemini sinh code sai cú pháp hoặc selector không tồn tại dẫn đến dry-run fail -> Hệ thống hiển thị thông báo lỗi rõ ràng trên UI kèm log, không làm hỏng các bài test hiện có và không lưu file rác vào thư mục test chính.
- **Checkpoint để verify:**
  - Dùng project demo (chưa có test E2E nào), bấm nút "Generate AI System Tests".
  - Kiểm tra tab Network và logs server: Thấy luồng sinh code -> Dry-run -> Thành công -> Bảng điều khiển System Test tự động refresh và nhận diện được file test vừa sinh.
- **Rủi ro/điểm dễ sai:**
  - Gemini sinh selector quá mơ hồ (ví dụ: `page.click('button')` khi trang có 10 nút bấm). Khắc phục trong Prompt bằng cách yêu cầu ưu tiên `getByRole`, `getByText`, hoặc `page.locator('form button[type="submit"]')`.
- **Ước lượng thời gian:** 4.0 - 4.5 ngày làm việc (Đã bao gồm 35% buffer rủi ro AI hallucination & selector tuning).

---

### Phase 6: Hoàn Thiện Giao Diện UI & Trải Nghiệm Người Dùng (End-to-End Polish)
- **Mục tiêu:** Kết nối toàn bộ các mắt xích lên giao diện người dùng; hiển thị đầy đủ, chính xác các chỉ số E2E, nhãn cảnh báo Flaky, trạng thái chạy realtime và nút sinh test AI; hiển thị danh sách Test Scenarios sinh động theo Lựa chọn A đã duyệt.
- **Input/Điều kiện tiên quyết:** Hoàn thành các Phase 1, 2, 4, 5.
- **Công việc cụ thể:**
  1. *Cập nhật Metrics Cards Trên [`CoverageTypeDashboard.jsx`]:*
     - Với `type === "system"`:
       - Thẻ 1: **E2E TESTS** (Tổng số test cases).
       - Thẻ 2: **PASSED** (Số test pass màu xanh lá `#22c55e`).
       - Thẻ 3: **FAILED** (Số test fail màu đỏ `#f87171`).
       - Thẻ 4: **FLAKY / STABILITY** (Hiển thị số test flaky màu vàng cam `#fbbf24` kèm nhãn cảnh báo).
       - Thẻ 5: **COVERAGE**:
         - Nếu `coverageAvailable === true`: Hiện % Line coverage.
         - Nếu `coverageAvailable === false`: Hiện nhãn `"N/A (Black-box E2E)"` kèm tooltip: *"Kiểm thử E2E hộp đen theo kịch bản người dùng. Dự án chưa bật Istanbul instrumentation."*
  2. *Tích Hợp Nút Bấm Hành Động (Action Buttons):*
     - Nếu dự án chưa có test: Nút chính là **"Generate AI System Tests"** (Màu tím/cyan nổi bật).
     - Nếu dự án đã có test: Nút chính là **"Run Analysis"** (Màu hồng accent `#ec4899` của System Test).
     - Khi đang chạy: Hiển thị spinner và trạng thái realtime qua Socket.IO (`"Starting AUT server..."`, `"Executing Playwright tests..."`, `"Parsing results..."`).
  3. *Bảng Kịch Bản Kiểm Thử (E2E Test Scenarios Table - Lựa Chọn A Đã Duyệt):*
     - Nếu có coverage file: Render danh sách file có coverage.
     - Nếu không có coverage file (E2E hộp đen): Render danh sách các **Kịch bản kiểm thử (Test Scenarios)** đã chạy (Tên kịch bản test, thời gian thực thi ms, trạng thái Pass/Fail/Flaky) để giao diện nhìn phong phú, chuyên nghiệp khi demo.
- **DoD (Definition of Done):**
  - Giao diện System Test phản ánh đúng 100% dữ liệu thực tế, không còn bất kỳ chi tiết rò rỉ nào từ Unit Test.
  - Thao tác một vòng hoàn chỉnh mượt mà: Import repo -> Thấy chưa có test -> Bấm Generate AI -> Chờ sinh và dry-run -> Hiện test mới -> Bấm Run Analysis -> Thấy server bật -> Test chạy -> Dashboard cập nhật số Passed/Failed trực quan.
- **Checkpoint để verify:**
  - Thao tác từ đầu đến cuối trên trình duyệt web, không cần mở terminal, toàn bộ các thẻ metric và bảng kịch bản hiển thị đúng dữ liệu thực tế.
- **Rủi ro/điểm dễ sai:**
  - Xung đột CSS style giữa các card khi thêm trường Flaky. Cần giữ nguyên layout flexbox/grid có sẵn trong component.
- **Ước lượng thời gian:** 2.0 ngày làm việc.

---

### Phase 7: Dọn Dẹp Mã Nguồn Thừa (Cleanup, Deprecation & Regression Test)
- **Mục tiêu:** Xóa bỏ code cũ gây nhiễu, dọn dẹp các service trùng lặp, đảm bảo bộ test của server chạy thông suốt không có lỗi hồi quy (regression).
- **Input/Điều kiện tiên quyết:** Hoàn thành Phase 6.
- **Công việc cụ thể:**
  1. *Lưu trữ hoặc Xóa các Service cũ không còn sử dụng:*
     - Loại bỏ hoàn toàn các file legacy:
       - `server/src/services/playwrightSystemCoverageJob.service.js`
       - `server/src/services/cypressSystemCoverageJob.service.js`
       - `server/src/services/cypressSystemTestRunner.service.js`
  2. *Dọn dẹp Route & Controller:*
     - Bỏ các route rải rác: `/:id/playwright-test`, `/:id/cypress-system-test`, `/:id/cypress-coverage`, `/:id/playwright-coverage`.
     - Quy tụ toàn bộ về route chuẩn: `POST /api/coverage/:snapshotId/system/run`.
  3. *Kiểm tra Regression Suite:*
     - Chạy toàn bộ bộ test hiện có của server: `npm test --prefix server`.
     - Đảm bảo các tính năng Unit Test (Jest, Vitest), Integration Test (Supertest) và AI Suggestion vẫn hoạt động 100% bình thường.
- **DoD (Definition of Done):**
  - Codebase gọn gàng, không còn file thừa không được import.
  - Lệnh `npm test --prefix server` vượt qua các test suite liên quan đến queue và coverage.
- **Checkpoint để verify:**
  - Chạy `git status` và `npm test --prefix server` xác nhận sạch sẽ.
- **Rủi ro/điểm dễ sai:**
  - Xóa nhầm file helper đang được unit test khác import chung. Cần grep kỹ tên hàm trước khi xóa.
- **Ước lượng thời gian:** 1.0 ngày làm việc.

---

## 3. BẢNG TỔNG HỢP TIẾN ĐỘ & QUẢN TRỊ RỦI RO (ĐÃ CỘNG BUFFER THỰC TẾ)

| Phase | Tên Phase | Số ngày ước tính | Phụ thuộc | Mức độ rủi ro | Trọng tâm cần lưu ý |
| :---: | :--- | :---: | :---: | :---: | :--- |
| **Phase 1** | Cô lập dữ liệu & Sửa bug Data Leakage UI/API | 1.5 ngày | Không | **Thấp** | Ưu tiên làm ngay; kiểm tra DB cũ; verify Empty state trước, Populated state dời sau Phase 4 |
| **Phase 2** | Hợp nhất Job về `SYSTEM_TEST_ANALYSIS` | 2.0 ngày | Phase 1 | **Trung bình** | Dùng `git grep` xác nhận không còn controller gọi job cũ; nới lỏng detector |
| **Phase 3** | Khởi động AUT & Giới hạn Scope Mock DB | 3.5 - 4.0 ngày | Phase 2 | **Cao** | Healthcheck 2 tầng (Port + HTTP status < 500); kill sạch tiến trình con bằng tree-kill |
| **Phase 4** | Quyết định Network Engine Demo & Coverage | 2.5 ngày | Phase 3 | **Trung bình** | Mặc định `DISABLE_DOCKER_RUNNER=true` để chạy host headless né lỗi network; thêm migration `flakyTests` |
| **Phase 5** | AI Sinh Test E2E + Validation AST & Dry-run | 4.0 - 4.5 ngày | Phase 4 | **Cao** | Hướng AI sinh test UI public không cần login; dry-run fail thì báo lỗi ngay |
| **Phase 6** | Hoàn thiện Giao diện UI & Trải nghiệm Demo | 2.0 ngày | Phase 5 | **Thấp** | Render bảng kịch bản test khi không có coverage (Lựa chọn A); hiện nhãn Flaky rõ ràng |
| **Phase 7** | Dọn dẹp Code thừa & Regression Testing | 1.0 ngày | Phase 6 | **Thấp** | Grep kỹ trước khi xóa các file service cũ |
| **TỔNG** | **Toàn bộ tính năng System Test** | **17.5 - 18.5 ngày** | — | — | **Tương đương 4 - 5 tuần part-time sinh viên (An toàn, không bị ép tiến độ)** |

---

## 4. BIÊN BẢN DUYỆT CÁC QUYẾT ĐỊNH KIẾN TRÚC (ARCHITECTURAL DECISIONS SIGN-OFF)

Toàn bộ 3 quyết định kỹ thuật quan trọng đã được phê duyệt chính thức bởi Product Owner / Sinh viên thực hiện đề tài:

1. ✅ **Quyết định 1: Playwright là Golden Runner nòng cốt.**
   - *Phê duyệt:* Tập trung 100% tài nguyên tối ưu và ổn định cho Playwright (Headless Chromium, tự động hóa `webServer`, V8 CDP coverage). Cypress chỉ duy trì ở mức nhận diện (detection) cơ bản.
2. ✅ **Quyết định 2: Hiển thị bảng Kịch bản Test (Lựa chọn A).**
   - *Phê duyệt:* Khi E2E chạy mà không có file Istanbul coverage, bảng dưới cùng sẽ hiển thị chi tiết danh sách các **Kịch bản kiểm thử (Test Scenarios)** với thời gian chạy và trạng thái Pass/Fail/Flaky, giúp giao diện trực quan, sống động và giàu thông tin khi báo cáo đồ án.
3. ✅ **Quyết định 3: Thêm cột `flakyTests` vào schema Prisma chính thức.**
   - *Phê duyệt:* Thực hiện migration chính thức thêm `flakyTests Int @default(0)` vào model `TestRun` trong `schema.prisma`. Giúp truy vấn dữ liệu nhanh, tường minh và bền vững.

---
*Tài liệu kế hoạch chính thức được lưu tại: [`docs/system-test-implementation-plan.md`](file:///d:/HuuThuan%20-%20Project/NCKH/CovAI/docs/system-test-implementation-plan.md).*
