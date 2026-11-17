# Kế Hoạch Triển Khai Tính Năng System Testing (Playwright & Cypress) — CovAI

> **Tài liệu theo dõi tiến độ (Task Tracking Document)**  
> **Phiên bản:** 1.0.0  
> **Ngày khởi tạo:** 07/10/2026  
> **Trạng thái tổng thể:** 🟢 Đã hoàn thành toàn diện 7/7 Phase (Verified & Production Ready)  
> **Mục tiêu:** Xây dựng hệ thống kiểm thử tự động toàn diện (System / E2E Testing) với 2 framework Playwright & Cypress, tự động quét phát hiện mã nguồn, đo lường độ bao phủ chuyên sâu, phân tích điểm dừng lỗi (Failure Breakpoint), cung cấp trình chỉnh sửa test case kèm AI tối ưu độ bao phủ, và tự động sinh mới test case khi dự án chưa có file test.

---

## 📌 Tổng Quan Kiến Trúc & Luồng Nghiệp Vụ (Architecture & Workflow)

```
[Người dùng Upload ZIP / GitHub Repo]
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Scan & Detection Engine                                  │
│    - Quét dependencies: @playwright/test, cypress           │
│    - Quét config files: playwright.config.*, cypress.config.*│
│    - Quét file test: tests/**/*.spec.*, cypress/e2e/**/*.cy.*│
└──────────────────────────────┬──────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
   [ĐÃ CÓ FILE TEST]                     [CHƯA CÓ FILE TEST]
            │                                     │
            │                       ┌─────────────┴─────────────┐
            │                       │ 2. Cold-Start Generator   │
            │                       │ - AI phân tích Routes/UI  │
            │                       │ - Sinh Config + Test mẫu  │
            │                       │ - Lưu vào snapshot dự án  │
            │                       └─────────────┬─────────────┘
            │                                     │
            └──────────────────┬──────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Isolated Execution & Coverage Engine                     │
│    - Khởi động AUT (Application Under Test) an toàn         │
│    - Chạy Playwright / Cypress qua Runner                   │
│    - Đo Code Coverage (Line, Stmt, Branch, Func %)          │
│    - Phân tích Failure Breakpoint (bước lỗi, selector, DOM) │
│    - Thu thập Evidence: Screenshots, logs, execution time   │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Dashboard Report & Test Case Editor                      │
│    - Báo cáo trực quan (Pass/Fail/Flaky/Duration/Coverage)  │
│    - Hiển thị điểm dừng lỗi & bằng chứng screenshot        │
│    - In & Xuất báo cáo (HTML / PDF / JSON)                 │
│    - Web Code Editor: Xem & sửa test case trực tiếp         │
│    - AI Booster: Phân tích vùng thiếu test -> Tăng coverage │
│    - Re-run testcase đơn lẻ để xác nhận ngay kết quả mới    │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 Danh Sách Nhiệm Vụ Tuần Tự (Sequential Task Breakdown)

### Phase 1: Chuẩn Hóa Schema & Nâng Cấp Detection Engine (Backend & Discovery)

_Mục tiêu: Đảm bảo cơ sở dữ liệu lưu trữ đầy đủ thông số coverage, điểm dừng lỗi và cơ chế phát hiện chính xác framework/file test trong snapshot._

- [x] **Task 1.1: Mở rộng Prisma Schema & Database Models**
  - [x] Thêm các trường hỗ trợ Breakpoint và Coverage vào model `TestScenario` trong [schema.prisma](file:///e:/Express/CovAI-/server/prisma/schema.prisma):
    - `failureStep`: Bước hoặc action bị fail (vd: `click[data-testid="submit-btn"]`).
    - `failureCodeSnippet`: Dòng code test gây ra lỗi kèm ngữ cảnh xung quanh.
    - `failureCategory`: Loại lỗi (`TIMEOUT`, `SELECTOR_NOT_FOUND`, `ASSERTION_FAILED`, `NETWORK_ERROR`, `SERVER_CRASH`).
    - `domSnapshot`: DOM HTML tại thời điểm xảy ra lỗi (hoặc đường dẫn lưu trữ snapshot).
    - `coverageLinesPct`, `coverageBranchesPct`: Tỉ lệ bao phủ do kịch bản này đóng góp.
  - [x] Bổ sung model `SystemTestFile` (hoặc mở rộng `TestRun`) để liên kết danh sách các file test đã phát hiện/đã chạy cùng số lượng scenario trong từng file.
  - [x] Chạy migration / push schema Prisma (`npx prisma db push && npx prisma generate`).

- [x] **Task 1.2: Hoàn thiện Service Quét Phát Hiện Thư Viện & File Test**
  - [x] Nâng cấp [systemTestDetection.service.js](file:///e:/Express/CovAI-/server/src/services/systemTestDetection.service.js) & [systemTestFrameworkDetection.service.js](file:///e:/Express/CovAI-/server/src/services/systemTestFrameworkDetection.service.js):
    - Nhận diện đầy đủ cả 2 framework: Playwright (`@playwright/test`) và Cypress (`cypress`).
    - Quét đệ quy tìm tất cả file test theo quy ước chuẩn:
      - Playwright: `**/*.spec.{js,ts,mjs,cjs,jsx,tsx}`, `**/*.test.{js,ts,mjs,cjs,jsx,tsx}`, thư mục `e2e`, `tests`.
      - Cypress: `cypress/e2e/**/*.{cy,spec}.{js,ts,jsx,tsx}`.
    - Trích xuất thông tin sơ bộ của từng file: tên file, đường dẫn tương đối, số lượng suite (`describe`) và số lượng scenario (`test`/`it`).
    - Xác định cờ `hasTestFiles: boolean`: Nếu `false`, gắn cờ `isZeroTestProject = true`.
  - [x] Cập nhật endpoint `GET /api/projects/:id/system-test/frameworks` trả về chi tiết danh sách file test và trạng thái có/không có test.

---

### Phase 2: Cơ Chế Sinh Mới Test Case Khi Dự Án Chưa Có Test (Cold-Start AI Generator)

_Mục tiêu: Khi người dùng upload mã nguồn không có sẵn file test, CovAI tự động phân tích nghiệp vụ và sinh bộ kịch bản E2E hoàn chỉnh._

- [x] **Task 2.1: Phân Tích Ngữ Cảnh Ứng Dụng (Application Context Harvester)**
  - [x] Nâng cấp [systemGenerationContext.service.js](file:///e:/Express/CovAI-/server/src/services/systemGenerationContext.service.js):
    - Quét Router frontend (React Router, Vue Router, Next.js Pages/App router): xác định các route URL chính (`/`, `/login`, `/dashboard`, `/cart`, v.v.).
    - Quét Form & UI Actions: nhận diện các input, button, form submit chính từ các component Page.
    - Nhận diện API Endpoints mà frontend đang giao tiếp (thông qua fetch / axios).

- [x] **Task 2.2: AI Generation Service Cho Playwright & Cypress**
  - [x] Nâng cấp [verifiedSystemGeneration.service.js](file:///e:/Express/CovAI-/server/src/services/verifiedSystemGeneration.service.js):
    - Xây dựng prompt chuẩn cho Gemini AI tạo bộ test E2E:
      - Tự động sinh `playwright.config.js` hoặc `cypress.config.js` với `baseURL` và `webServer` chuẩn.
      - Sinh các kịch bản test thực tế: Smoke test (truy cập trang chủ, kiểm tra tiêu đề/navbar), Navigation test (chuyển trang), Action test (điền form, submit, xác thực thông báo).
    - Hỗ trợ tạo test định dạng Playwright (`import { test, expect } from '@playwright/test'`) và Cypress (`describe(...)`, `it(...)`, `cy.visit(...)`).
    - Đảm bảo tính độc lập: Test chạy độc lập, không phụ thuộc state chéo giữa các test.

- [x] **Task 2.3: Bộ Kiểm Duyệt AST (Safety & Syntax Validator) & Lưu File**
  - [x] Sử dụng Babel parser kiểm tra cú pháp file test vừa được AI sinh ra.
  - [x] Ghi file test mới vào thư mục snapshot trên đĩa (vd: `tests/e2e/covai-generated.spec.js` hoặc `cypress/e2e/covai-generated.cy.js`).
  - [x] Bổ sung API `POST /api/coverage/:snapshotId/system/generate-tests`:
    - Body: `{ framework: "playwright" | "cypress", targetRoutes?: string[] }`.
    - Trả về: danh sách các file test và test scenario vừa được khởi tạo thành công.

---

### Phase 3: Công Cụ Thực Thi & Đo Độ Bao Phủ Chuyên Sâu (Execution & Coverage Engine)

_Mục tiêu: Chạy test an toàn trong môi trường AUT, đo đạc tỉ lệ phần trăm code coverage và bóc tách điểm dừng lỗi khi kịch bản thất bại._

- [x] **Task 3.1: Nâng Cấp System Test Runner Cho Cả Playwright & Cypress**
  - [x] Cập nhật [systemTestRunner.service.js](file:///e:/Express/CovAI-/server/src/services/systemTestRunner.service.js):
    - Hỗ trợ đầy đủ luồng thực thi của **Cypress** song song với Playwright:
      - Tạo config tạm thời xuất report định dạng JSON (Mocha JSON reporter).
      - Chạy headless qua `npx cypress run --reporter json`.
    - Khởi động và giám sát ứng dụng cần test (AUT Server):
      - Tự động dò tìm cổng khả dụng (`detectAutPort`).
      - Chờ đợi server sẵn sàng (Health check ping trước khi runner kích hoạt).
      - Đảm bảo dừng AUT sạch sẽ trong khối `finally`.

- [x] **Task 3.2: Công Cụ Thu Thập & Tính Toán Độ Bao Phủ (System Code Coverage Engine)**
  - [x] Hiện thực cơ chế đo độ bao phủ mã nguồn cho System Test:
    - **Playwright CDP Coverage**: Kích hoạt Chrome DevTools Protocol Coverage (`page.coverage.startJSCoverage()` và `stopJSCoverage()`) trong script test để lấy chính xác các dòng/hàm frontend được thực thi.
    - **Cypress / Istanbul Coverage**: Tích hợp thu thập `window.__coverage__` nếu ứng dụng có cấu hình instrumentation hoặc phân tích qua V8.
    - **Route & Component Coverage**: Tính toán tỉ lệ % các Route / Trang và UI Component mà test case đã tương tác so với tổng số Route của hệ thống.
  - [x] Tính toán các chỉ số độ bao phủ:
    - `linesPct`: Phần trăm dòng mã nguồn được chạy qua.
    - `statementsPct`: Phần trăm câu lệnh được thực thi.
    - `branchesPct`: Phần trăm nhánh rẽ (if/else, switch) được kiểm thử.
    - `functionsPct`: Phần trăm hàm được gọi.
    - Ánh xạ độ bao phủ về từng file nguồn trong snapshot.

- [x] **Task 3.3: Failure Breakpoint Engine (Phân Tích Điểm Dừng Lỗi)**
  - [x] Xây dựng service phân tích lỗi chi tiết trong [systemTestResultParser.service.js](file:///e:/Express/CovAI-/server/src/services/systemTestResultParser.service.js):
    - Đọc error stack từ Playwright JSON report / Cypress report.
    - Xác định chính xác **Bước Dừng Lại (Failure Point)**:
      - Bước/Hành động đang thực hiện (vd: `await page.click('button#checkout')`).
      - Nguyên nhân dừng: `Timeout 30000ms exceeded`, `Element not visible or detached`, `Assertion expected 'Success' but received 'Error 500'`.
      - Trích xuất dòng code của file test gây lỗi và dòng code nguồn tương ứng (nếu có).
    - Lưu trữ bằng chứng lỗi:
      - File screenshot tại thời điểm dừng ([systemTestEvidence.service.js](file:///e:/Express/CovAI-/server/src/services/systemTestEvidence.service.js)).
      - Trích xuất snippet HTML / DOM snapshot tại element bị lỗi.

- [x] **Task 3.4: Bổ Sung Các Tiêu Chí Đánh Giá Bổ Trợ (Quality & Stability Metrics)**
  - [x] Nhận diện Flaky Test: Đánh dấu kịch bản chạy fail ở lần 1 nhưng pass ở lần retry (`flakyTests`).
  - [x] Đo lường thời gian thực thi (Latency / Duration) của từng scenario để phát hiện các bottleneck hiệu năng trong luồng E2E.
  - [x] Tính toán chỉ số ổn định tổng thể (Stability Score %): `(passedTests / totalTests) * 100`.

---

### Phase 4: API Endpoints & Real-time Job Processing

_Mục tiêu: Đóng gói toàn bộ luồng nghiệp vụ thành các REST API rõ ràng kết hợp truyền tải tiến độ chạy qua Socket.IO._

- [x] **Task 4.1: API Kích Hoạt & Giám Sát Tiến Trình Chạy Test**
  - [x] Nâng cấp endpoint `POST /api/coverage/:snapshotId/system/run` trong [coverage.route.js](file:///e:/Express/CovAI-/server/src/routes/coverage.route.js):
    - Nhận parameters: `runner` (`"playwright"` hoặc `"cypress"`), `executionMode` (`"frontend"` hoặc `"full"`), `testFile` (nếu muốn chạy riêng 1 file).
    - Đẩy job vào hàng đợi BullMQ / Redis với `JobType.SYSTEM_TEST_ANALYSIS` hoặc `PLAYWRIGHT_SYSTEM_TEST` / `CYPRESS_SYSTEM_TEST`.
  - [x] Cập nhật [systemTestAnalysisJob.service.js](file:///e:/Express/CovAI-/server/src/services/systemTestAnalysisJob.service.js):
    - Bắn Socket.IO event `job:progress` theo từng giai đoạn (Khởi động AUT -> Chạy kịch bản -> Phân tích kết quả -> Đo lường coverage -> Hoàn tất).

- [x] **Task 4.2: API Trích Xuất Báo Cáo & Danh Sách Kịch Bản**
  - [x] Nâng cấp `GET /api/coverage/:snapshotId/system/summary`:
    - Trả về tổng quan: `runner`, `status`, `totalTests`, `passedTests`, `failedTests`, `flakyTests`, `durationMs`, `coverageSummary` (lines, branches, funcs, stmts %).
  - [x] Nâng cấp `GET /api/coverage/:snapshotId/system/scenarios`:
    - Trả về danh sách kịch bản phân cấp theo test file.
    - Kèm thông tin failure breakpoint, error messages, screenshot URL, thời gian chạy, % coverage đóng góp.
  - [x] Endpoint `GET /api/coverage/:snapshotId/system/scenarios/:scenarioId/evidence`:
    - Trả về hình ảnh screenshot hoặc DOM snapshot bằng chứng.

---

### Phase 5: Trình Biên Tập Test Case & AI Tối Ưu Độ Bao Phủ (Test Editor & AI Booster)

_Mục tiêu: Cung cấp tính năng xem và chỉnh sửa trực tiếp file test trên web, tích hợp AI tự động sửa lỗi breakpoint và mở rộng kịch bản để đạt độ bao phủ cao hơn._

- [x] **Task 5.1: API Quản Lý & Chỉnh Sửa File Test**
  - [x] Bổ sung các endpoint trong [coverage.route.js](file:///e:/Express/CovAI-/server/src/routes/coverage.route.js) hoặc [file.routes.js](file:///e:/Express/CovAI-/server/src/routes/file.routes.js):
    - `GET /api/coverage/:snapshotId/system/tests/content?filePath=...`: Đọc nội dung file test.
    - `PUT /api/coverage/:snapshotId/system/tests/content`: Lưu nội dung file test đã chỉnh sửa.
    - `POST /api/coverage/:snapshotId/system/tests/run-single`: Chạy nhanh duy nhất 1 file test vừa sửa để kiểm tra kết quả ngay lập tức mà không cần chạy lại toàn bộ test suite.

- [x] **Task 5.2: AI Coverage Booster & Breakpoint Fixer Service**
  - [x] Xây dựng service AI hỗ trợ tối ưu hóa testcase:
    - **Tính năng 1 — "AI Boost Coverage"**:
      - Đọc danh sách các dòng lệnh, nhánh rẽ hoặc component chưa được bao phủ (uncovered paths).
      - Đề xuất bổ sung thêm các case kiểm thử mới vào file test hiện tại (vd: kiểm tra validation lỗi, kiểm tra trạng thái rỗng, kiểm tra quyền truy cập).
    - **Tính năng 2 — "AI Fix Breakpoint"**:
      - Đọc thông tin lỗi tại điểm dừng (selector bị timeout, locator sai sau khi đổi DOM).
      - Đề xuất sửa đổi locator / bước thực thi giúp test case vượt qua lỗi.
  - [x] API: `POST /api/coverage/:snapshotId/system/optimize-test`:
    - Body: `{ filePath, scenarioId, mode: "BOOST_COVERAGE" | "FIX_BREAKPOINT" }`.
    - Trả về: Code test đã được tối ưu / vá lỗi kèm giải thích ngắn gọn.

---

### Phase 6: Thiết Kế Giao Diện Frontend (System Test Dashboard, Editor & Report)

_Mục tiêu: Xây dựng UI chuyên nghiệp, hiện đại, tuân thủ nghiêm ngặt theo hướng dẫn thiết kế trong [COVAI_FRONTEND_AGENT_RULES.md](file:///e:/Express/CovAI-/COVAI_FRONTEND_AGENT_RULES.md)._

- [x] **Task 6.1: Giao Diện Dashboard Tổng Quan (System Test Overview Tab)**
  - [x] Thiết kế lại [SystemTestDashboard.jsx](file:///e:/Express/CovAI-/client/src/components/dashboard/SystemTestDashboard.jsx) thành một bảng điều khiển độc lập chuyên sâu:
    - **Top Action Bar**:
      - Framework Selector (Pills chuyển đổi Playwright / Cypress).
      - Nút **"Run System Tests"** với spinner trạng thái loading / tiến độ % thời gian thực.
      - Nút **"Export / Print Report"**.
    - **Thẻ Chỉ Số Tổng Quan (Metric Cards)**:
      - Test Pass Rate % (với color token: success nếu >= 90%, warning nếu >= 70%, danger nếu < 70%).
      - Overall Code Coverage % (Dòng, Nhánh, Hàm, Câu lệnh).
      - Tổng kịch bản: Passed / Failed / Flaky / Skipped.
      - Tổng thời gian thực thi (Duration).
    - **Khối Cảnh Báo "Zero Tests Detected" (Khi chưa có test)**:
      - Banner tinh gọn thông báo dự án chưa có file test.
      - Nút CTA nổi bật: **"✨ Auto-Generate System Tests with AI"**.
      - Modal tùy chọn sinh test (chọn Playwright / Cypress, chọn các route cần test).

- [x] **Task 6.2: Bảng Danh Sách Kịch Bản & Khối Điểm Dừng Lỗi (Breakpoint Explorer)**
  - [x] Bảng kịch bản test (Test Scenarios Table):
    - Gom nhóm theo từng file test (`auth.spec.js`, `cart.cy.js`).
    - Hiển thị từng scenario: Tên kịch bản, thời gian chạy, badge trạng thái (`PASSED`, `FAILED`, `FLAKY`).
    - Cột % Coverage đóng góp của kịch bản.
  - [x] **Failure Breakpoint Panel (Khi nhấn vào test case bị lỗi)**:
    - Box chi tiết điểm dừng:
      - Bước thất bại: Hiển thị câu lệnh test bị gãy kèm icon cảnh báo.
      - Dòng code lỗi: Code viewer với dòng lỗi được highlight màu đỏ.
      - Nguyên nhân lỗi: Thông báo lỗi rõ ràng từ runner.
      - Nút xem **Screenshot bằng chứng** (mở modal phóng to ảnh chụp màn hình lúc lỗi).
      - Nút **"Sửa kịch bản này"** -> Chuyển thẳng sang Test Case Editor.

- [x] **Task 6.3: Tích Hợp Trình Chỉnh Sửa Test Case (In-Browser Test Editor)**
  - [x] Xây dựng component `SystemTestEditorModal.jsx` hoặc tích hợp vào tab Editor chính:
    - Trình soạn thảo mã nguồn code test có highlight cú pháp.
    - Thanh công cụ AI thông minh:
      - Nút **"✨ AI Tăng độ bao phủ"**: Tự động gợi ý thêm test case cho các nhánh chưa chạm tới.
      - Nút **"🔧 AI Sửa điểm dừng lỗi"**: Tự động sửa locator / assertion lỗi.
      - Nút **"▶ Chạy lại test này"**: Gọi API `run-single` và cập nhật ngay kết quả bên cạnh.
    - Bảng so sánh Diff (trước và sau khi AI tối ưu) cho người dùng duyệt trước khi lưu.

- [x] **Task 6.4: Chế Độ Xem Báo Cáo & Xuất Báo Cáo (Report View & Printing)**
  - [x] Xây dựng component `SystemTestReportView.jsx`:
    - Định dạng trang báo cáo chuẩn cho in ấn (`@media print` CSS layout).
    - Tóm tắt kết quả kiểm thử, ma trận độ bao phủ các trang/tính năng, danh sách lỗi kèm screenshot bằng chứng.
    - Nút bấm **"In Báo Cáo / Xuất PDF"** (sử dụng `window.print()` với print styles tinh chỉnh sạch sẽ) và **"Xuất JSON Summary"**.

---

### Phase 7: Kiểm Thử Tích Hợp & Kiểm Tra Toàn Diện (Testing & Verification)

_Mục tiêu: Đảm bảo mọi luồng hoạt động mượt mà, ổn định trên cả môi trường Docker và môi trường cục bộ._

- [x] **Task 7.1: Unit & Integration Tests Cho Backend Services**
  - [x] Viết test cho `systemTestDetection.service.js` với các kịch bản: có Playwright, có Cypress, có cả 2, và không có framework nào.
  - [x] Viết test cho `systemTestResultParser.service.js`: kiểm tra độ chính xác khi bóc tách breakpoint lỗi và screenshot.
  - [x] Viết test cho API endpoints (`/system/run`, `/system/summary`, `/system/scenarios`, `/system/generate-tests`).

- [x] **Task 7.2: Kiểm Thử Luồng Thực Tế (E2E End-to-End Scenarios)**
  - [x] **Kịch bản A (Có sẵn test Playwright/Cypress)**:
    - Upload dự án mẫu có sẵn test -> Kiểm tra hệ thống phát hiện chính xác -> Chạy test -> Kiểm tra kết quả hiển thị độ bao phủ và các điểm dừng nếu cố tình tạo test lỗi.
  - [x] **Kịch bản B (Dự án không có test)**:
    - Upload dự án sạch không có test -> Kiểm tra giao diện hiển thị cảnh báo Zero Test -> Nhấn sinh test AI -> Hệ thống tạo file test -> Chạy test và ra report coverage đầu tiên.
  - [x] **Kịch bản C (Chỉnh sửa & Nâng cao độ bao phủ)**:
    - Mở Test Editor -> Sử dụng AI gợi ý thêm test case -> Lưu và chạy lại test đơn lẻ -> Xác nhận % coverage tăng lên.

---

## 🔄 Quy Ước Cập Nhật & Theo Dõi Tiến Độ (Workflow Convention)

> [!IMPORTANT]
> **Quy tắc bắt buộc đối với Developer và AI Agent khi làm việc trên dự án:**
>
> 1. **Cập nhật trạng thái từng bước**: Ngay khi hoàn thành bất kỳ task hoặc subtask nào trong file này, Agent phải đọc file `task.systemtest.md`, cập nhật dấu `[ ]` thành `[x]`, đồng thời ghi chú ngày hoàn thành hoặc commit/hash liên quan nếu cần.
> 2. **Đồng bộ với hiện trạng mã nguồn**: Nếu trong quá trình lập trình có phát sinh thay đổi kiến trúc hoặc cần bổ sung subtask mới, Agent phải cập nhật danh sách này ngay để đảm bảo file luôn phản ánh chính xác 100% tình trạng của dự án CovAI.
> 3. **Không đánh dấu hoàn thành giả định**: Chỉ đánh dấu `[x]` khi code đã được kiểm tra (tested) và hoạt động thực tế trên hệ thống.

---

## 📝 Nhật Ký Cập Nhật (Changelog)

| Ngày           | Người thực hiện | Nhiệm vụ hoàn thành                                                                                | Ghi chú                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| :------------- | :-------------- | :------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **07/10/2026** | Antigravity AI  | Khởi tạo tài liệu kế hoạch `task.systemtest.md` v1.0.0                                             | Phân rã 7 Phase và 19 subtasks chi tiết                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **07/10/2026** | Antigravity AI  | Hoàn thành **Task 1.1**: Mở rộng Prisma Schema & Database Models                                   | Mở rộng `TestScenario`, `TestRun`, thêm model `SystemTestFile`, bổ sung trường Cypress cho `Project` & `ProjectSnapshot`, đồng bộ Neon DB và tạo mới Prisma Client                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **07/10/2026** | Antigravity AI  | Hoàn thành **Task 1.2**: Hoàn thiện Service Quét Phát Hiện Thư Viện & File Test                    | Tạo `testFileParser.js`, nâng cấp `systemTestFrameworkDetection.service.js`, `cypressDetector.js`, `playwrightDetector.js`, hỗ trợ recursive file scan, trích xuất suites/scenarios, cờ `isZeroTestProject`, đồng bộ cờ snapshot DB, cập nhật endpoint `/system-test/frameworks` và viết unit test xác thực                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **07/10/2026** | Antigravity AI  | Hoàn thành **Phase 2**: Cơ Chế Sinh Mới Test Case Khi Dự Án Chưa Có Test (Cold-Start AI Generator) | Nâng cấp `systemGenerationContext.service.js` với `harvestFrontendContext` (quét routes, links, UI actions, API calls); nâng cấp `verifiedSystemGeneration.service.js` (`ensureSystemTestConfig`, `buildColdStartSystemPrompt`, `generateFallbackColdStartTest`, `generateColdStartSystemTests`); tích hợp AST safety & syntax validator; xây dựng controller & API `POST /api/coverage/:snapshotId/system/generate-tests`; đồng bộ `SystemTestFile` & `AiTest` vào DB; toàn bộ 8 unit tests passed                                                                                                                                                                                                                                                                          |
| **07/10/2026** | Antigravity AI  | Hoàn thành **Phase 3**: Công Cụ Thực Thi & Đo Độ Bao Phủ Chuyên Sâu (Execution & Coverage Engine)  | Nâng cấp `systemTestRunner.service.js` (hỗ trợ Cypress song song Playwright, `ensureCypressPrerequisites`, `resolveCypressCommand`, cả full & frontend mode); tạo `failureBreakpointAnalyzer.service.js` (phân loại failureCategory, bóc tách failureStep, trích xuất dòng code lỗi từ file nguồn, bóc tách DOM snapshot); tạo `systemCoverageEngine.service.js` (đo độ bao phủ qua Istanbul/CDP hoặc Route & Component coverage, tính lines/branches/statements/functions %, phân bổ độ bao phủ cho từng kịch bản và `SystemTestFile`); nâng cấp `systemTestResultParser.service.js` (tính stabilityScorePct, latency, flaky tests); tích hợp hoàn chỉnh vào `systemTestAnalysisJob.service.js` lưu DB và socket progress; 10/10 Phase 3 unit tests passed                  |
| **07/10/2026** | Antigravity AI  | Hoàn thành **Phase 4**: API Endpoints & Real-time Job Processing                                   | Nâng cấp `job.service.js` cho phép `frontend` và `full` mode, hỗ trợ cả `playwright` & `cypress` và tham số `testFile`; nâng cấp `systemTestAnalysisJob.service.js` phát Socket.IO `job:progress` 5 giai đoạn (Starting AUT, Executing tests, Parsing results, Measuring coverage, Completed); xây dựng API `POST /api/coverage/:snapshotId/system/run`; nâng cấp `GET /api/coverage/:snapshotId/system/summary` trả về `coverageSummary`, `stabilityScorePct`, `testFiles`; xây dựng API `GET /api/coverage/:snapshotId/system/scenarios` phân cấp theo file test kèm breakpoint diagnostics và coverage contributions; nâng cấp `GET /api/coverage/:snapshotId/system/scenarios/:scenarioId/evidence` phục vụ cả ảnh PNG lẫn DOM snapshot; 15/15 Phase 4 unit tests passed |
| **07/10/2026** | Antigravity AI  | Hoàn thành **Phase 5**: Trình Biên Tập Test Case & AI Tối Ưu Độ Bao Phủ (Test Editor & AI Booster) | Xây dựng service `systemTestBooster.service.js` hỗ trợ BOOST_COVERAGE và FIX_BREAKPOINT với AI và rule fallback; tạo các API GET/PUT `/system/tests/content`, POST `/system/tests/run-single`, POST `/system/optimize-test`; kiểm tra cú pháp AST an toàn; 12/12 unit tests passed, toàn bộ 48/48 test suites liên quan passed                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **07/10/2026** | Antigravity AI  | Hoàn thành **Phase 6**: Thiết Kế Giao Diện Frontend (System Test Dashboard, Editor & Report)       | Xây dựng bộ component React hoàn chỉnh: SystemTestDashboard, SystemTestMetricsCards, SystemTestZeroStateBanner, SystemTestGeneratorModal, SystemTestScenarioList, SystemTestBreakpointModal, SystemTestEditorModal (Monaco Editor, AI Boost Coverage, AI Fix Breakpoint, Run Single), SystemTestReportView (print stylesheet, JSON export); tích hợp Socket.IO progress; tuân thủ nghiêm ngặt COVAI_FRONTEND_AGENT_RULES (dark/light theme tokens, không gradient, không neon); client Vite build thành công không lỗi (2.8s)                                                                                                                                                                                                                                                |
| **07/10/2026** | Antigravity AI  | Hoàn thành **Phase 7**: Kiểm Thử Tích Hợp & Kiểm Tra Toàn Diện (Testing & Verification)             | Viết bộ test toàn diện `systemTestComprehensiveServices.test.js` (kiểm tra 4 kịch bản phát hiện Playwright/Cypress/Dual/None, trích xuất breakpoint lỗi, tính stability score) và `systemTestE2EFlows.test.js` (kiểm thử 3 luồng E2E thực tế: dự án có test, dự án sạch zero-test AI cold start, và luồng Test Editor AI Booster tăng coverage & sửa breakpoint); toàn bộ 11 test suites và 89/89 tests đã PASS 100% trong Docker. Hoàn thành trọn vẹn toàn bộ 7 Phase của kế hoạch tính năng System Test!                                                                                                                                                                                                                                              |
| **07/10/2026** | Antigravity AI  | **Rà Soát Toàn Diện & Chuẩn Hóa End-to-End** (Full Audit & Refinement)                            | Rà soát toàn bộ 7 Phase: chuẩn hóa tham số đầu vào backend API (`runner` / `framework`, `routes` / `targetRoutes`, `format` / `type` evidence query); sửa cảnh báo ESLint React ref cleanup trong `SystemTestEvidence.jsx`; chạy kiểm thử 11/11 test suites (89/89 tests passed trong Docker); build Vite production frontend thành công 0 lỗi; 0 cảnh báo ESLint. Toàn bộ tính năng hoạt động chuẩn xác theo tài liệu. |
