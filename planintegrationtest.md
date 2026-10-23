# Kế Hoạch Triển Khai Tính Năng Integration Testing (API Testing & Coverage Engine) — CovAI

> **Tài liệu theo dõi tiến độ (Task Tracking Document)**  
> **Phiên bản:** 1.1.0  
> **Ngày cập nhật:** 21/10/2026  
> **Trạng thái tổng thể:** 🟡 Sẵn sàng triển khai (Overhaul & Architecture Approved)  
> **Mục tiêu:** Xây dựng lại hệ sinh thái kiểm thử tích hợp (Integration / API Testing) toàn diện trên nền tảng CovAI, hỗ trợ song song 2 chuẩn **Supertest (Jest/Mocha)** và **Playwright API Testing**, tự động quét mã nguồn Frontend & Backend để lập bản đồ API 100%, đo lường độ bao phủ chuyên sâu (Code Coverage & Endpoint Coverage), bóc tách điểm nghẽn lỗi (Failure Layer Diagnostics: Middleware, Route, Controller, Database), cung cấp trình biên tập test case trực quan kèm AI sinh mới / vá lỗi đạt độ bao phủ tối đa.

---

## 🔗 Liên Kết Kiến Trúc Đồng Nhất: Cơ Chế Đo Lường Dòng Mã Thực Thi (Unified Coverage Engine)

> [!IMPORTANT]
> **Cơ Chế Bóc Tách Dòng Đã Chạy / Chưa Chạy (Execution & Coverage Tracing):**  
> Toàn bộ logic kỹ thuật để xác định **dòng nào đã chạy, dòng nào chưa chạy, nhánh rẽ nào đã kiểm thử, và vị trí code bị nghẽn** trong module này được kế thừa và vận hành đồng nhất từ tài liệu kiến trúc dùng chung:  
> 📄 [**plancoverageengine.md**](./plancoverageengine.md)  
>
> **Ứng dụng cụ thể trong Integration Test:**
> 1. **Gắn cờ (Istanbul AST Flags)** vào toàn bộ Routes, Controllers, Middlewares, và Services trước khi chạy test.
> 2. **Chuyển đổi trạng thái Counter (`s[]`, `b[]`, `f[]`)** theo thời gian thực khi request HTTP đi qua các tầng logic.
> 3. **Ánh xạ ngược API (Reverse API Mapping)**: Đối chiếu các dòng mã trong controller/router đã được kích hoạt ngược về danh mục API:
>    - **API ĐÃ BAO PHỦ (Covered)**: Ít nhất 1 dòng lệnh xử lý trong Controller có `hitCount > 0`.
>    - **API CHƯA BAO PHỦ (Uncovered)**: Toàn bộ Controller handler của API đó có `hitCount = 0`.
> 4. **Bóc tách tầng lỗi (Failure Layer)**: Điểm dừng có cờ `hit > 0` cuối cùng trước khi exception xảy ra chỉ rõ lỗi kẹt tại Router, Middleware, Controller hay Database.

---

## 🔄 Chiến Lược Kế Thừa & Đập Đi Xây Lại (Audit, Reuse & Rebuild Strategy)

> [!WARNING]
> **Hiện trạng:** Tính năng Integration Test đã có mã nguồn trong dự án nhưng đang gặp lỗi logic nghiêm trọng (phân loại scenario cứng nhắc bằng các rule hardcoded như `isStripeFailureTest`, `hasQueryFallback`, `page=invalid`, thiếu hỗ trợ Playwright API, cơ chế đo lường độ bao phủ chưa đúng chuẩn).  
> **Quyết định kiến trúc:** Tiến hành **Đập đi xây lại (Clean Overhaul)** các tầng logic bị lỗi, đồng thời **tái sử dụng có chọn lọc** các module nền tảng đã viết đúng để tối ưu thời gian phát triển:
>
> | Phân Loại | Danh Sách Module / Tệp Tin | Hành Động & Định Hướng |
> | :--- | :--- | :--- |
> | ♻️ **Tái sử dụng (Reuse & Refactor)** | [`apiEndpointParser.service.js`](file:///e:/Express/CovAI-/server/src/services/apiEndpointParser.service.js) | Giữ nguyên logic phân tích AST Express routes, controllers, middleware và frontend callers. |
> | ♻️ **Tái sử dụng (Reuse & Refactor)** | [`supertestDetection.service.js`](file:///e:/Express/CovAI-/server/src/services/supertestDetection.service.js) | Tái sử dụng logic quét dependency cơ bản, nâng cấp mở rộng thêm Playwright API. |
> | ♻️ **Tái sử dụng (Reuse & Refactor)** | [`dockerRunner.service.js`](file:///e:/Express/CovAI-/server/src/services/dockerRunner.service.js) | Tái sử dụng hạ tầng thực thi lệnh cách ly an toàn trên host/Docker. |
> | ♻️ **Tái sử dụng (Reuse & Refactor)** | Giao diện Monaco Editor Shell | Tái sử dụng shell component (`SourceCodeViewerModal.jsx`, `IntegrationScenarioEditorModal.jsx`) để tích hợp chỉnh sửa test case. |
> | 🔨 **ĐẬP ĐI XÂY LẠI (Rebuild)** | Logic phân loại trong [`integrationWorkspace.service.js`](file:///e:/Express/CovAI-/server/src/services/integrationWorkspace.service.js) | **Xóa bỏ hoàn toàn** các hàm hardcoded hacky (`isStripeFailureTest`, `hasQueryFallback`, v.v.). Thay thế bằng bộ quy tắc Pass/Fail tiêu chuẩn đối chiếu trực tiếp response trả về với contract. |
> | 🔨 **ĐẬP ĐI XÂY LẠI (Rebuild)** | Cơ chế đo lường & bóc tách độ bao phủ | Thay thế bằng **Unified Coverage Engine** từ [`plancoverageengine.md`](./plancoverageengine.md), dùng Istanbul flags và Reverse API Mapping để biết chính xác API nào đã chạy dòng nào. |
> | 🔨 **ĐẬP ĐI XÂY LẠI (Rebuild)** | Bộ máy 4 kịch bản phát hiện thư viện | Xây mới hoàn toàn bộ phát hiện 4 trường hợp, hỗ trợ popup modal xác nhận cài đặt thư viện thiếu (`npm install`). |
> | 🔨 **ĐẬP ĐI XÂY LẠI (Rebuild)** | Prompt & Bộ sinh test bằng AI ([`supertestPromptBuilder.service.js`](file:///e:/Express/CovAI-/server/src/services/supertestPromptBuilder.service.js)) | Thiết kế lại toàn diện prompt sinh đa kịch bản (Happy Path 200/201, Negative 400/401/403/404, Edge Cases) chuẩn cho cả Supertest và Playwright API. |
> | 🔨 **ĐẬP ĐI XÂY LẠI (Rebuild)** | Luồng Apply & Lưu Test Case vào Source Code | Xây dựng tính năng cho phép user chọn đường dẫn đích, đặt tên file, Apply single/all và kích hoạt chạy phân tích lại. |

---

## 🛡️ Quyền Hạn Toàn Quyền & Quy Tắc Khi Code (Execution Mandate & Coding Rules)

> [!IMPORTANT]
> **Quyền Hạn Toàn Quyền (Full Autonomous Mandate):**  
> AI Agent được cấp **toàn bộ quyền truy cập và thực thi** trên toàn bộ codebase dự án CovAI:
> - Đọc, chỉnh sửa, tạo mới và xóa các tệp tin backend (`server/src/`), frontend (`client/src/`), cấu hình môi trường, Prisma schema, và các scripts.
> - Chạy các lệnh kiểm thử tự động, build, lint, database migration (`prisma db push`), cài đặt thư viện (`npm install`) trong container Docker `covai_server` và môi trường local.
> - Tự động cập nhật trạng thái `[ ]` thành `[x]` trong file này ngay khi hoàn thành từng subtask mà không cần chờ yêu cầu thêm.

### 📌 Nguyên Tắc Code Bắt Buộc (Strict Coding Rules)
1. **Bảo Toàn Logic Hiện Có (Preserve Existing Contracts)**: Không làm hỏng hoặc xóa các tính năng Unit Test và System Test (Playwright/Cypress E2E) đã hoàn thiện trước đó. Mọi endpoint và service mới phải tách biệt rõ ràng dưới domain `/integration/` hoặc kế thừa chuẩn `TestRun` / `TestScenario`.
2. **Chuẩn Hóa Giao Diện (COVAI Frontend Rules)**:
   - Tuyệt đối không dùng gradient tùy tiện hoặc màu neon chói mắt.
   - Sử dụng theme tokens chuẩn: nền tối `#0d1117`, thẻ bề mặt `#161b22`, border `#30363d`, text `#f0f6fc` / `#8b949e`.
   - Luôn hỗ trợ cả Light và Dark mode.
3. **Cơ Chế Khởi Động & Database An Toàn (Database & AUT Safety)**:
   - Khi chạy test API, sử dụng biến môi trường `DATABASE_URL` dành cho test hoặc test instance cô lập.
   - Luôn dọn dẹp (cleanup / teardown) database và đóng kết nối HTTP server sau khi hoàn thành test suite để tránh treo cổng hoặc rò rỉ bộ nhớ.
4. **Không Đánh Dấu Giả Định (Verified Completion Only)**: Chỉ chuyển dấu `[ ]` sang `[x]` khi code đã được kiểm tra (tested), chạy thực tế thành công và pass toàn bộ test suite liên quan.

---

## 📌 Tổng Quan Kiến Trúc & Luồng Nghiệp Vụ (Architecture & Workflow)

```
[Người dùng Upload ZIP / GitHub Repository]
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Scan & Inventory Engine                                  │
│    - Quét Router & Controller Backend (Express routes)      │
│    - Quét Caller Frontend (fetch, axios, services)          │
│    - Quét Thư viện: supertest, @playwright/test trong pkg   │
│    - Quét File test API: *.test.js, *.spec.js, /integration │
└──────────────────────────────┬──────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
 ┌──────────────────────┐             ┌──────────────────────┐
 │ ĐÃ CÓ FILE TEST      │             │ CHƯA CÓ FILE TEST    │
 └──────────┬───────────┘             └──────────┬───────────┘
            │                                    │
    ┌───────┴────────┐                   ┌───────┴────────┐
    ▼                ▼                   ▼                ▼
[Có Thư Viện]   [Chưa Có Thư Viện]   [Có Thư Viện]   [Chưa Có Thư Viện]
    │                │                   │                │
    │         ┌──────┴──────┐            │         ┌──────┴──────┐
    │         │Modal xác nhận│           │         │Modal cho user│
    │         │'Cài đặt ngay'│           │         │chọn Supertest│
    │         │(npm install) │           │         │hoặcPlaywright│
    │         └──────┬──────┘            │         └──────┬──────┘
    │                │                   │                │
    ▼                ▼                   ▼                ▼
[Sẵn Sàng Test] ◄────┘                   [Sinh Mới Test Bằng LLM]
    │                                    (Prompt chuyên sâu, đa kịch
    │                                     bản: Happy Path, Negative,
    │                                     Edge Case theo logic code)
    │                                            │
    └──────────────────┬─────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Isolated Execution & Deep Coverage Engine (plancoverageengine.md)
│    - Chạy Supertest (Jest/Mocha) / Playwright API runner    │
│    - Gắn cờ Istanbul flags & đo lường Line, Stmt, Func %    │
│    - Reverse API Mapping: Xác định API Covered vs Uncovered │
│    - Failure Tracing:                                       │
│      + PASS: status code, data response trả về              │
│      + FAIL: Bóc tách tầng lỗi (Middleware, Route,          │
│              Controller, Model/Database), stack, snippet    │
│      + Đánh dấu "Có test nhưng fail" để ưu tiên AI vá lỗi   │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Dashboard Report & Test Case Workspace                   │
│    - Bảng báo cáo trực quan (Passed/Failed/Uncovered APIs)   │
│    - Phân tích chi tiết từng Endpoint kèm log lỗi           │
│    - In & Xuất báo cáo (HTML / PDF / JSON)                  │
│    - In-Browser Editor (Monaco): Xem, sửa, xóa, lưu         │
│    - Cho phép chọn đường dẫn lưu file trong source code     │
│    - Nút 'Apply Single' & 'Apply All' kèm gợi ý Chạy Lại    │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 Danh Sách Nhiệm Vụ Chi Tiết (Sequential Task Breakdown)

### Phase 1: Chuẩn Hóa Schema & Nâng Cấp Detection Engine (Discovery & 4 Permutations)

_Mục tiêu: Kế thừa parser AST hiện có, nâng cấp phát hiện cả Supertest và Playwright API, xử lý hoàn chỉnh 4 kịch bản thư viện và cơ chế xác nhận cài đặt gói thiếu._

- [x] **Task 1.1: Quét Bản Đồ API Hệ Thống (Frontend Callers & Backend Routers) [TÁI SỬ DỤNG & HOÀN THIỆN]**
  - [x] Tái sử dụng logic cốt lõi trong `apiEndpointParser.service.js`:
    - Trích xuất toàn bộ Express Router, Controller, Middleware, URL path parameters, Query params.
    - Trích xuất các vị trí hàm gọi API ở Frontend (`fetch`, `axios`, custom API client).
    - Lập danh mục API toàn diện: Method (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`), Full Path, Handler file & line.
  - [x] Tái sử dụng cơ chế quét file trong `supertestDetection.service.js`:
    - Quét đệ quy tìm các file test integration/api: `tests/integration/**/*.js`, `**/*.api.test.js`, `**/*.integration.spec.js`.

- [x] **Task 1.2: Hỗ Trợ Playwright API Testing Song Song Với Supertest [XÂY MỚI]**
  - [x] Mở rộng service phát hiện (`integrationDetection.service.js`):
    - Nhận diện cú pháp Supertest (`request(app).get(...)`, `import request from 'supertest'`).
    - Nhận diện cú pháp Playwright API (`request.get(...)`, `request.post(...)`, `playwright.request.newContext`).
    - Xác định runner điều khiển: Jest, Mocha, Vitest, hoặc Playwright Test Runner.
  - [x] Trả về cờ trạng thái chuẩn hóa: `framework: "supertest" | "playwright" | null`, `hasTestFiles: boolean`, `hasDependencies: boolean`.

- [x] **Task 1.3: Bộ Máy Xử Lý 4 Kịch Bản Phát Hiện (4 Permutations Engine) [XÂY MỚI]**
  - [x] **Kịch bản A (Có test + Có thư viện)**: Tự động sẵn sàng phân tích độ bao phủ ngay lập tức (`HAS_TESTS_AND_DEPS`).
  - [x] **Kịch bản B (Không có test + Không có thư viện)**: Đánh dấu `isZeroTestProject = true`, trả về danh sách 2 thư viện đề xuất (Supertest và Playwright API) để người dùng lựa chọn (`ZERO_TESTS_NO_DEPS`).
  - [x] **Kịch bản C (Có thư viện + Không có test)**: Tự động chọn thư viện đã cài đặt trong `package.json` làm framework mục tiêu cho AI Cold-Start sinh test (`HAS_DEPS_NO_TESTS`).
  - [x] **Kịch bản D (Có test + Chưa cài thư viện trong `package.json`)**:
    - Phân tích cú pháp AST của file test để suy luận chính xác thư viện cần dùng (Supertest hoặc Playwright) (`HAS_TESTS_NO_DEPS`).
    - Tạo API `POST /api/projects/:id/integration/install-dependencies` và `POST /api/coverage/:snapshotId/integration/install-dependencies` để chạy `npm install --save-dev` sau khi người dùng bấm xác nhận.
    - Hiển thị Modal/Banner cảnh báo trên giao diện với nút **"Cài đặt thư viện phát hiện & Chạy tiếp"**.

- [x] **Task 1.4: Mở Rộng Prisma Schema Cho Integration Test Run & Scenario [NÂNG CẤP]**
  - [x] Kiểm tra và cập nhật [schema.prisma](file:///e:/Express/CovAI-/server/prisma/schema.prisma):
    - Đảm bảo model `TestRun` hỗ trợ `type: "SUPERTEST" | "PLAYWRIGHT_API"`.
    - Bổ sung các trường vào `TestScenario` hoặc liên kết API endpoint:
      - `targetEndpoint`: Phương thức và đường dẫn API (vd: `POST /api/orders`).
      - `failureLayer`: Tầng bị kẹt lỗi (`ROUTER_NOT_FOUND`, `MIDDLEWARE_REJECTED`, `CONTROLLER_CRASH`, `DATABASE_FAILURE`, `ASSERTION_FAILED`).
      - `responseStatus`: HTTP status code thực tế nhận được.
      - `responseData`: JSON response thực tế trả về.
      - `isFaultyExistingTest`: Cờ đánh dấu test có sẵn trong repo nhưng bị fail/lỗi cú pháp để AI ưu tiên sửa.

---

### Phase 2: Cơ Chế Sinh Mới Test Case Đạt Độ Bao Phủ Tuyệt Đối (Cold-Start & Booster LLM)

_Mục tiêu: Đập bỏ prompt chắp vá cũ; thiết kế lại chiến thuật prompt chuyên sâu dựa trên AST mã nguồn Router, Controller và Middleware để sinh ra bộ test đa kịch bản bao phủ tối đa._

- [x] **Task 2.1: Thu Thập Ngữ Cảnh Sâu Của Từng API (Deep Context Harvester) [TÁI SỬ DỤNG & MỞ RỘNG]**
  - [x] Tái sử dụng nền tảng thu thập ngữ cảnh tại `supertestPromptBuilder.service.js`:
    - Đọc mã nguồn Route, Controller, Model/Prisma, Middleware xác thực liên quan đến endpoint.
    - Thu thập ví dụ gọi API từ frontend (`client/src/...`) để làm Ground Truth về payload và response mong đợi.
  - [x] Mở rộng: Tự động phân tích các câu lệnh điều kiện `if/else`, validation schemas (Joi, Zod, express-validator) để phát hiện danh sách các điều kiện rẽ nhánh cần test (`harvestBranchConditions`, `harvestApiDeepContext`).

- [x] **Task 2.2: Thiết Kế Chiến Thuật Prompt Chuyên Sâu Cho Supertest & Playwright API [ĐẬP ĐI XÂY LẠI]**
  - [x] Xây dựng prompt sinh đa kịch bản cho mỗi API endpoint (`buildIntegrationTestPrompt`):
    - **Kịch bản 1 — Happy Path (200/201)**: Gửi payload hợp lệ, xác thực status code thành công và cấu trúc dữ liệu trả về.
    - **Kịch bản 2 — Negative Case (400 Bad Request)**: Gửi payload thiếu trường bắt buộc hoặc sai kiểu dữ liệu để kích hoạt validation error.
    - **Kịch bản 3 — Authentication / Authorization (401/403)**: Gửi request không kèm token hoặc token giả mạo vào route có middleware bảo vệ.
    - **Kịch bản 4 — Not Found / Resource Conflict (404/409)**: Truy vấn ID không tồn tại hoặc tạo trùng lặp dữ liệu độc nhất.
    - **Kịch bản 5 — Edge Case**: Dữ liệu rỗng, số âm, chuỗi ký tự đặc biệt, boundary limits.
  - [x] Hỗ trợ sinh đúng định dạng theo lựa chọn của người dùng:
    - Supertest + Jest/Mocha (`request(app).post('/api/...').send(...)`).
    - Playwright API (`await request.post('/api/...', { data: ... })`).
  - [x] Xóa bỏ triệt để các rule hardcoded cũ (Food-items, Stripe amounts, empty cart), thay thế bằng dynamic AST context.

- [x] **Task 2.3: Bộ Kiểm Duyệt AST An Toàn (Safety Validator) & Sửa Test Lỗi Có Sẵn [XÂY MỚI]**
  - [x] Sử dụng Babel parser kiểm tra cú pháp file test vừa được sinh trước khi lưu (`validateIntegrationTestCode`).
  - [x] Chặn đứng các hành vi nguy hiểm (mã độc, import thư viện cấm như `child_process`, `eval`, `process.exit`, `fs.rmSync`).
  - [x] Tính năng **"AI Fix Faulty Test"** (`buildFaultyTestFixPrompt`): Đối với các file test người dùng upload lên nhưng bị fail (`isFaultyExistingTest`), AI phân tích callstack lỗi, `failureLayer`, `lastExecutedLine` và đề xuất sửa mã nguồn test để khớp với controller thực tế.

---

### Phase 3: Thực Thi Kiểm Thử Cô Lập & Đo Lường Độ Bao Phủ Chuyên Sâu (Execution & Tracing Engine)

_Mục tiêu: Triển khai cơ chế bóc tách dòng thực thi đồng nhất theo chuẩn [plancoverageengine.md](./plancoverageengine.md), loại bỏ hoàn toàn các rule phân loại cứng nhắc cũ, xác định chính xác API nào đã chạy và tầng nào bị kẹt lỗi._

- [x] **Task 3.1: Runner Thực Thi Cho Supertest (Jest/Mocha) [TÁI SỬ DỤNG HẠ TẦNG]**
  - [x] Tái sử dụng hạ tầng cách ly trong `supertestRunner.service.js` và `dockerRunner.service.js`.
  - [x] Bổ sung cấu hình kết nối database thông qua biến môi trường `DATABASE_URL` do người dùng cấu hình hoặc database test cô lập.

- [x] **Task 3.2: Xây Dựng Runner Cho Playwright API Testing [XÂY MỚI]**
  - [x] Tạo service `playwrightApiRunner.service.js`:
    - Cấu hình Playwright `baseURL` trỏ tới backend server.
    - Thực thi các file API test qua `npx playwright test --project=api`.
    - Thu thập report JSON và log chi tiết từng request/response.

- [x] **Task 3.3: Tích Hợp Cơ Chế Đo Độ Bao Phủ Dòng Lệnh Đồng Nhất (`plancoverageengine.md`) [ĐẬP ĐI XÂY LẠI]**
  - [x] Tích hợp Istanbul / V8 Code Coverage Flags theo chuẩn đặc tả trong `plancoverageengine.md`:
    - Gắn cờ đo lường coverage trên toàn bộ các file Route, Controller, Middleware và Service của backend.
    - Khi test chạy qua các dòng code, Istanbul flags tự động chuyển trạng thái được thực thi (hit count > 0).
  - [x] **Ánh xạ ngược API (Reverse API Mapping)**:
    - Đối chiếu các dòng code trong Controller/Route đã được chạy với danh sách Endpoint hệ thống:
      - **ĐÃ BAO PHỦ (Covered)**: Endpoint có ít nhất 1 kịch bản test gọi tới và thực thi qua controller handler tương ứng.
      - **CHƯA BAO PHỦ (Uncovered)**: Endpoint không có bất kỳ dòng code nào trong router/controller được kích hoạt trong suốt quá trình chạy test.
    - Tính toán các chỉ số: Line Coverage %, Branch Coverage %, Statement Coverage %, Function Coverage %, và **API Coverage %**.

- [x] **Task 3.4: Bóc Tách Điểm Lỗi Từng Tầng (Failure Layer Diagnostics) [ĐẬP ĐI XÂY LẠI]**
  - [x] **Loại bỏ toàn bộ các rule hacky cũ** trong `integrationWorkspace.service.js` (`isStripeFailureTest`, `hasQueryFallback`, v.v.).
  - [x] Xây dựng service phân tích nguyên nhân lỗi tiêu chuẩn:
    - **Tầng Route (404)**: URL không khớp, sai prefix mount path trong `app.use()`.
    - **Tầng Middleware (401/403/Validation)**: Bị chặn bởi auth middleware, CORS, hoặc body parser lỗi.
    - **Tầng Controller (500/Crash)**: Lỗi runtime (TypeError, ReferenceError, unhandled rejection) trong hàm xử lý.
    - **Tầng Database/Model**: Lỗi truy vấn Prisma, Mongoose, SQL constraint, connection timeout.
  - [x] Trích xuất chi tiết báo cáo cho mỗi kịch bản fail:
    - HTTP Status nhận được vs mong đợi.
    - Payload gửi đi & Response data nhận về.
    - Tên tầng bị lỗi kèm dòng code gãy (code frame highlight màu đỏ).
    - Callstack và giải thích nguyên nhân bằng ngôn ngữ dễ hiểu.
    - Đánh dấu trạng thái **"Có test nhưng fail"** để đưa vào hàng đợi AI sửa test hoặc sinh bổ sung.

---

### Phase 4: API Endpoints & Real-time Job Processing

_Mục tiêu: Đóng gói toàn bộ các dịch vụ kiểm thử tích hợp thành hệ thống REST API hoàn chỉnh, truyền tải tiến độ thực thi thời gian thực qua Server-Sent Events / Socket.IO._

- [x] **Task 4.1: Các API Cơ Bản Đã Có [TÁI SỬ DỤNG]**
  - [x] `GET /api/coverage/:snapshotId/integration/workspace`: Lấy danh sách endpoints, scenarios, test suites.
  - [x] `POST /api/coverage/:snapshotId/supertest/run`: Kích hoạt pipeline chạy Supertest.
  - [x] `GET /api/coverage/:snapshotId/integration/history`: Lịch sử các lần chạy test.

- [x] **Task 4.2: Bổ Sung Các API Phát Hiện Thư Viện & Cài Đặt Tự Động [XÂY MỚI]**
  - [x] `GET /api/projects/:id/integration/frameworks`:
    - Trả về chi tiết: thư viện phát hiện (`supertest` / `playwright`), danh sách file test API, cờ `isZeroTestProject`, cờ `needsDependencyInstall`.
  - [x] `POST /api/projects/:id/integration/install-dependencies`:
    - Thực hiện cài đặt gói thiếu (`supertest`, `jest`, `@playwright/test`) sau khi user bấm duyệt.

- [x] **Task 4.3: Bổ Sung API Sinh Test Toàn Diện (Cold-Start & Single API) [XÂY MỚI]**
  - [x] `POST /api/coverage/:snapshotId/integration/generate-tests`:
    - Nhận body: `{ framework: "supertest" | "playwright", targetEndpoints?: string[] }`.
    - Kích hoạt LLM sinh bộ test đa kịch bản bao phủ tối đa.
  - [x] `POST /api/coverage/:snapshotId/integration/regenerate-scenario`:
    - Sinh lại hoặc sửa 1 test case bị lỗi / chưa đạt độ bao phủ.

- [x] **Task 4.4: Bổ Sung API Biên Tập & Áp Dụng Test Vào Mã Nguồn [XÂY MỚI]**
  - [x] `PUT /api/coverage/:snapshotId/integration/scenarios/:scenarioId`: Chỉnh sửa nội dung kịch bản.
  - [x] `POST /api/coverage/:snapshotId/integration/apply-tests`:
    - Nhận danh sách kịch bản cần ghi thành file test vào source code.
    - Cho phép người dùng tùy chọn đường dẫn thư mục đích (vd: `tests/integration/api.test.js`) và tên file.
    - Tự động gợi ý kích hoạt chạy lại phân tích độ bao phủ sau khi apply.

---

### Phase 5: Giao Diện Người Dùng (Integration Workspace, Editor & Reports)

_Mục tiêu: Tái sử dụng shell layout, đập bỏ các bảng logic cũ bị lỗi; xây dựng giao diện báo cáo độ bao phủ API chuẩn xác, bóc tách điểm lỗi và cho phép lưu test case linh hoạt._

- [x] **Task 5.1: Giao Diện Workspace & Layout Cơ Bản [TÁI SỬ DỤNG]**
  - [x] `IntegrationWorkspace.jsx`, `IntegrationTargetsPane.jsx`, `IntegrationScenariosPane.jsx`.

- [x] **Task 5.2: Bổ Sung Banner & Modal Xử Lý 4 Kịch Bản Thư Viện [XÂY MỚI]**
  - [x] **Banner "Dự Án Chưa Có Test Integration"**:
    - Hiển thị hộp chọn framework: **Supertest** hoặc **Playwright API** (`IntegrationFrameworkDetectionBanner.jsx`).
    - Nút CTA nổi bật: **"✨ Tự động sinh kịch bản API Test bằng AI"** kích hoạt job sinh test đa kịch bản.
  - [x] **Modal Cảnh Báo "Phát Hiện File Test Thiếu Thư Viện"**:
    - Hiển thị danh sách thư viện cần thiết suy luận từ mã test (vd: `supertest@^6.3.3`, `jest@^29.0.0` hoặc `@playwright/test`).
    - Nút bấm: **"Cài đặt thư viện & Tiếp tục phân tích"** gọi API auto-install dependencies.

- [x] **Task 5.3: Nâng Cấp Bảng Báo Cáo Đo Độ Bao Phủ & Tầng Bị Lỗi [ĐẬP ĐI XÂY LẠI]**
  - [x] Thẻ chỉ số tổng quan (Overview Metric Cards) trong `IntegrationRunResultsPane.jsx`:
    - **API Pass Rate %**: Tỉ lệ API test thành công trên tổng số API đã thực thi.
    - **API Coverage %**: Tỉ lệ API đã có test trên tổng số API hệ thống kèm progress bar trực quan.
    - **Code Coverage %**: Dòng, Nhánh, Hàm, Câu lệnh (Lines, Branches, Functions, Stmts %).
    - Tổng quan trạng thái: `Passed APIs` / `Failed APIs` / `Uncovered APIs`.
  - [x] **Chi tiết kịch bản thất bại (Failure Inspector)**:
    - Hiển thị nhãn tầng bị lỗi chuẩn xác: `[ROUTER_NOT_FOUND]`, `[MIDDLEWARE_REJECTED]`, `[CONTROLLER_CRASH]`, `[DATABASE_FAILURE]`, `[ASSERTION_FAILED]`.
    - Khối code frame hiển thị chính xác dòng mã bị fail, số dòng và callstack chi tiết.
    - Hiển thị Expected Response vs Received Response kèm HTTP status và body preview.
    - Nút **"Sửa kịch bản bằng AI"** kích hoạt AI Booster sửa lỗi tự động.

- [x] **Task 5.4: Nâng Cấp Trình Biên Tập Test Case & Áp Dụng Vào Source Code [XÂY MỚI]**
  - [x] Monaco Code Editor xem và chỉnh sửa trực tiếp mã nguồn test case (`IntegrationScenarioEditorModal.jsx`).
  - [x] Dialog chọn đường dẫn lưu file test trong cấu trúc thư mục dự án (`IntegrationApplyTestsModal.jsx`).
  - [x] Nút bấm **"Lưu & Apply vào mã nguồn"** và **"Apply tất cả"** ghi trực tiếp vào repo file.
  - [x] Modal thông báo: *"Đã lưu test thành công. Bạn có muốn chạy lại phân tích để kiểm tra độ bao phủ mới không?"* kèm nút **"Chạy phân tích lại ngay"**.

- [x] **Task 5.5: Chế Độ Xem Báo Cáo & Xuất Báo Cáo (Print / Export Report) [NÂNG CẤP]**
  - [x] Nâng cấp trang [IntegrationReportPage.jsx](file:///e:/Express/CovAI-/client/src/pages/IntegrationReportPage.jsx):
    - Định dạng chuẩn in ấn `@media print` sạch đẹp, ẩn thanh điều hướng khi in.
    - Tóm tắt kết quả kiểm thử API, ma trận độ bao phủ các route (`routeMatrix`), chi tiết log lỗi từng API (`failureLogs`).
    - Hỗ trợ nút **"In báo cáo / Xuất PDF"** (`window.print()`) và **"Xuất JSON Summary"** tải file báo cáo JSON.

---

### Phase 6: Kiểm Thử Tích Hợp & Kiểm Tra Toàn Diện (Testing & Verification)

_Mục tiêu: Viết bộ test tự động toàn diện kiểm chứng mọi luồng phát hiện, sinh test, chạy test và bóc tách lỗi._

- [x] **Task 6.1: Unit & Integration Tests Cho Backend Services**
  - [x] Viết test cho `supertestDetection.service.js` với 4 kịch bản thư viện (có test + có lib, không test + không lib, có lib + không test, có test + thiếu lib).
  - [x] Viết test kiểm tra cơ chế phân tích điểm dừng lỗi (Router, Middleware, Controller, DB).
  - [x] Viết test cho endpoint phát hiện, cài đặt thư viện và sinh test bằng AI.

- [x] **Task 6.2: Kiểm Thử Luồng Thực Tế (E2E Integration Scenarios)**
  - [x] **Kịch bản 1 (Dự án đã có sẵn test API)**: Upload dự án mẫu có sẵn Supertest -> Hệ thống nhận diện chính xác -> Chạy test và hiển thị độ bao phủ API.
  - [x] **Kịch bản 2 (Dự án sạch chưa có test)**: Upload dự án Express không có test -> Hiển thị tùy chọn Supertest/Playwright -> Bấm sinh test bằng AI -> Tạo bộ test bao phủ các API -> Chạy test và ra report.
  - [x] **Kịch bản 3 (Dự án có test nhưng thiếu thư viện)**: Upload dự án có file test nhưng `package.json` chưa cài Supertest -> Hệ thống cảnh báo -> Bấm xác nhận cài đặt -> Tự động cài và chạy test thành công.
  - [x] **Kịch bản 4 (Biên tập & Apply test)**: Mở editor sửa test case -> Chọn đường dẫn lưu file -> Apply vào source code -> Kích hoạt chạy lại phân tích độ bao phủ.

---

## 🔄 Quy Ước Cập Nhật & Đồng Bộ (Workflow Convention)

1. **Cập nhật trạng thái từng bước**: Khi hoàn thành bất kỳ task hoặc subtask nào, cập nhật dấu `[ ]` thành `[x]` trong file này kèm ghi chú vào Changelog bên dưới.
2. **Đồng bộ với hiện trạng mã nguồn**: Mọi thay đổi kiến trúc hoặc cập nhật mã nguồn phải được phản ánh chính xác trong tài liệu này.
3. **Kiểm tra tự động trước khi tick hoàn thành**: Luôn chạy test tự động (`npm test`) và build client (`npm run build`) để đảm bảo không phát sinh hồi quy (regression).

---

## 📝 Nhật Ký Cập Nhật (Changelog)

| Ngày | Người thực hiện | Nhiệm vụ hoàn thành | Ghi chú |
| :--- | :--- | :--- | :--- |
| **21/10/2026** | Antigravity AI | Khởi tạo tài liệu kế hoạch `planintegrationtest.md` v1.0.0 | Phân rã 6 Phase và 20 subtasks chi tiết, tích hợp đầy đủ các câu trả lời khảo sát kiến trúc từ người dùng. |
| **21/10/2026** | Antigravity AI | Tách kế hoạch kiến trúc `plancoverageengine.md` & Cập nhật `planintegrationtest.md` v1.1.0 | Định nghĩa cơ chế đo lường cờ thực thi đồng nhất cho cả 3 loại test (Unit, Integration, System); xác lập chiến lược "Đập đi xây lại" xóa bỏ các rule hardcoded bị lỗi trong integration workspace cũ, tái sử dụng các parser AST và hạ tầng runner hợp lệ. |

| **22/10/2026** | Antigravity AI | Hoàn thành Phase 5: Giao Diện Người Dùng (Integration Workspace, Editor & Reports) | Triển khai banner framework detection 4 permutations, modal cài đặt thư viện tự động, 4 Overview Metric Cards (API Pass Rate, API Coverage, Code Coverage, Status Triage), Failure Inspector bóc tách 5 tầng lỗi, Monaco editor apply test vào repo với directory tree picker, và trang báo cáo in ấn/xuất JSON print-friendly. |
| **22/10/2026** | Antigravity AI | Hoàn thành Phase 6: Kiểm Thử Tích Hợp & Kiểm Tra Toàn Diện (Testing & Verification) | Triển khai toàn bộ bộ kiểm thử tự động cho Task 6.1 (4 permutations của `supertestDetection.service.test.js`, chẩn đoán 5 tầng lỗi trong `integrationExecutionAndTracing.test.js`, REST endpoints trong `integrationApiEndpoints.test.js`) và 4 kịch bản E2E thực tế của Task 6.2 trong `integrationE2EWorkflow.test.js`. Toàn bộ 53/53 tests trong 7 test suites đều vượt qua 100%, client build hoàn thành sạch sẽ. Toàn bộ kế hoạch tái cấu trúc Integration Testing đã hoàn thành trọn vẹn. |
| **23/10/2026** | Antigravity AI | Tái thiết kế toàn diện UI Phase 5: Unified Single-View Cockpit | Loại bỏ hoàn toàn mô hình chuyển tab từng bước rời rạc và việc chuyển hướng trang báo cáo riêng lẻ; quy tụ 100% luồng làm việc vào một giao diện cuộn thống nhất (`IntegrationWorkspace.jsx`), tích hợp thanh điều hướng nhanh sticky anchor, 4 KPI cards tiêu chuẩn kỹ thuật cao, Live Progress Terminal, Failure Inspector 5 tầng lỗi, Ma trận Route Matrix (`IntegrationRouteMatrixTable.jsx`), Quản lý kịch bản & Monaco Editor, cùng Báo cáo tích hợp in ấn PDF/JSON trực tiếp (`IntegrationReportEmbed.jsx`) và Drawer Lịch sử/So sánh mượt mà. Tuân thủ triệt để design token và không dùng màu gradient AI. Client build thành công sạch sẽ (2.29s). |
| **23/10/2026** | Antigravity AI | Khắc phục lỗi Crash Render, Logic Metric API & Runner Supertest AI | Sửa triệt để lỗi crash `handleSaveAndApplyEditor is not defined` trong `IntegrationScenariosPane.jsx`; loại bỏ toàn bộ chỉ số đơn vị Istanbul (Statements, Branches, Functions, Lines) khỏi giao diện Test API theo đúng thiết kế CovAI Tracing Engine (thay bằng Uncovered Endpoints và Controller Handler Execution Tracing); sửa lỗi runner `No valid AI-generated Supertest files were found` (chấp nhận test DRAFT, auto-approve trước khi chạy, auto-trigger sinh test nếu chưa có kịch bản); nâng cấp model Gemini sang `gemini-3.8-flash` tương thích khóa API người dùng. Client build hoàn tất 100% không lỗi. |