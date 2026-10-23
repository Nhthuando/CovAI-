# Kế Hoạch Xây Dựng Cơ Chế Đo Lường & Bóc Tách Dòng Mã Thực Thi Đồng Nhất (Unified Code Coverage & Execution Line Tracing Engine) — CovAI

> **Tài liệu đặc tả kiến trúc độc lập (Master Architectural Specification)**  
> **Mục tiêu áp dụng:** Dùng chung làm chuẩn cốt lõi cho cả **3 loại kiểm thử** trong CovAI:  
> 1. **Unit Testing** (Jest / Vitest)  
> 2. **Integration Testing** (Supertest / Playwright API Testing)  
> 3. **System Testing** (Playwright / Cypress E2E)  
> **Trạng thái:** 🟢 Hoàn thành 100% (Core Architecture Implemented & Verified with Automated Test Suite)

---

## 📌 1. Bài Toán & Mục Đích Cốt Lõi (Core Objective)

Trong kiểm thử phần mềm, một bài toán tối quan trọng là: **Làm sao biết chính xác từng dòng mã (Line), câu lệnh (Statement), nhánh rẽ (Branch), và hàm (Function) trong source code đã thực sự được chạy qua (Hit) hay chưa hề được kiểm thử (Unhit)?**

Hệ thống CovAI cần một **cơ chế đo lường & bóc tách dòng thực thi đồng nhất (Unified Execution Line Tracing Engine)** hoạt động độc lập với framework kiểm thử, có khả năng:
1. Gắn cờ (Flags / Counters) vào từng vị trí mã nguồn trước khi chạy.
2. Tự động chuyển đổi trạng thái cờ khi luồng điều khiển của test case đi qua dòng lệnh tương ứng.
3. Thu thập và tổng hợp thành bản đồ thực thi chi tiết (`statementMap`, `s`, `branchMap`, `b`, `fnMap`, `f`).
4. **Ánh xạ ngược (Reverse Traceability Mapping)** từ các dòng mã đã chạy / chưa chạy về các đối tượng nghiệp vụ tương ứng:
   - Trong **Unit Test**: Ánh xạ về từng Function, Class, Method.
   - Trong **Integration Test**: Ánh xạ về từng API Endpoint, Route Handler, Middleware, Controller.
   - Trong **System Test**: Ánh xạ về từng Page URL Route, UI Component, DOM Interaction Step.
5. **Định vị điểm dừng lỗi (Failure Pinpoint Tracing)**: Xác định dòng code cuối cùng thực thi thành công trước khi hệ thống bị gãy hoặc throw exception.

---

## 🔬 2. Cơ Chế Hoạt Động Chi Tiết (Technical Mechanism & Lifecycle)

Cơ chế bóc tách dòng mã thực thi của CovAI tuân theo quy trình 4 giai đoạn khép kín:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Giai đoạn 1: Instrumentation (AST Flag Injection - Gắn Cờ Trước Khi Chạy)│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Giai đoạn 2: Runtime Execution (Flag State Mutation - Chuyển Đổi Trạng Thái)│
│  - Khi test gọi request/hàm: Dòng nào chạy qua -> Counter tăng từ 0 -> N │
│  - Dòng nào không chạy qua -> Counter giữ nguyên = 0                     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Giai đoạn 3: Coverage Extraction (Bóc Tách Artifacts & Dữ Liệu Bộ Nhớ)  │
│  - Bóc tách __coverage__ / coverage-final.json                         │
│  - Bóc tách statementMap, hit counters s[], branchMap b[], fnMap f[]   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Giai đoạn 4: Reverse Traceability Mapping (Ánh Xạ Ngược Nghiệp Vụ)     │
│  ├─► Unit Test: Function Coverage, Uncovered Lines trong File Nguồn    │
│  ├─► Integration Test: Covered vs Uncovered API Endpoints & Broken Layer│
│  └─► System Test: Covered vs Uncovered Frontend Routes & Components    │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.1. Giai Đoạn 1: Instrumentation & Gắn Cờ (Flag Injection)
Trước khi runner kích hoạt, mã nguồn ứng dụng (Backend hoặc Frontend) được phân tích qua cây cú pháp trừu tượng (Babel AST) bởi engine instrumentation (`babel-plugin-istanbul` hoặc V8 native code coverage):
- Mỗi câu lệnh (Statement), nhánh rẽ (`if/else`, ternary, switch), và hàm (Function declaration) được đánh số index duy nhất.
- Một mảng bộ đếm (counter array) lưu trong biến toàn cục `__coverage__` được chèn vào trước mỗi dòng lệnh.

**Ví dụ minh họa cơ chế gắn cờ:**
```javascript
// Mã nguồn gốc của Controller:
export const createOrder = async (req, res) => {
    const { items, total } = req.body;
    if (!items || items.length === 0) {
        return res.status(400).json({ error: "Cart is empty" });
    }
    const order = await db.orders.create({ data: { items, total } });
    return res.status(201).json(order);
};

// Mã nguồn sau khi được Engine gắn cờ (Instrumented Code):
function cov_1a2b3c() {
    // Trả về đối tượng lưu trữ trạng thái cờ của file controller này
    return global.__coverage__["src/controllers/order.controller.js"];
}

export const createOrder = async (req, res) => {
    cov_1a2b3c().f[0]++; // Đánh dấu Function 0 bắt đầu chạy
    cov_1a2b3c().s[0]++; // Đánh dấu Statement 0 (const { items, total } = req.body) chạy

    const { items, total } = req.body;
    cov_1a2b3c().s[1]++; // Đánh dấu Statement 1 (if check) chạy

    if ((cov_1a2b3c().b[0][0]++, (!items || items.length === 0))) {
        cov_1a2b3c().b[0][1]++; // Đánh dấu Nhánh IF (Validation Error) chạy
        cov_1a2b3c().s[2]++;    // Đánh dấu Statement 2 (return res.status(400)) chạy
        return res.status(400).json({ error: "Cart is empty" });
    } else {
        cov_1a2b3c().b[0][2]++; // Đánh dấu Nhánh ELSE (Dữ liệu hợp lệ) chạy
    }

    cov_1a2b3c().s[3]++; // Đánh dấu Statement 3 (Gọi DB tạo đơn) chạy
    const order = await db.orders.create({ data: { items, total } });

    cov_1a2b3c().s[4]++; // Đánh dấu Statement 4 (return res.status(201)) chạy
    return res.status(201).json(order);
};
```

### 2.2. Giai Đoạn 2: Runtime Execution (Chuyển Đổi Trạng Thái Cờ)
Khi runner thực thi các test case:
- **Trường hợp Test Case 1 (Gọi POST /api/orders với giỏ hàng rỗng `{ items: [] }`)**:
  - Luồng code đi qua `s[0]`, `s[1]`, nhánh `b[0][1]`, và `s[2]`.
  - Bộ đếm tương ứng: `s[0]=1`, `s[1]=1`, `s[2]=1`.
  - Các dòng `s[3]` (gọi DB) và `s[4]` (trả về 201) **không bao giờ được chạm tới**, giá trị counter giữ nguyên `= 0`.
- **Trường hợp Test Case 2 (Gọi POST /api/orders với giỏ hàng hợp lệ `{ items: [...] }`)**:
  - Luồng code đi qua nhánh `b[0][2]`, gọi DB `s[3]`, và trả về 201 `s[4]`.
  - Bộ đếm của `s[3]` và `s[4]` tăng từ `0` lên `1`.

### 2.3. Giai Đoạn 3: Coverage Extraction (Bóc Tách Dữ Liệu Thực Thi)
Sau khi test suite kết thúc, engine thu gom đối tượng `coverage-final.json` từ đĩa hoặc bộ nhớ:
```json
{
  "src/controllers/order.controller.js": {
    "path": "src/controllers/order.controller.js",
    "statementMap": {
      "0": { "start": { "line": 2, "column": 4 }, "end": { "line": 2, "column": 39 } },
      "1": { "start": { "line": 3, "column": 4 }, "end": { "line": 5, "column": 5 } },
      "2": { "start": { "line": 4, "column": 8 }, "end": { "line": 4, "column": 64 } },
      "3": { "start": { "line": 6, "column": 4 }, "end": { "line": 6, "column": 69 } },
      "4": { "start": { "line": 7, "column": 4 }, "end": { "line": 7, "column": 39 } }
    },
    "s": {
      "0": 1,
      "1": 1,
      "2": 1,
      "3": 0,
      "4": 0
    },
    "branchMap": {
      "0": {
        "loc": { "start": { "line": 3, "column": 4 }, "end": { "line": 5, "column": 5 } },
        "type": "if",
        "locations": [
          { "start": { "line": 4, "column": 8 }, "end": { "line": 4, "column": 64 } },
          { "start": { "line": 6, "column": 4 }, "end": { "line": 7, "column": 39 } }
        ]
      }
    },
    "b": {
      "0": [1, 0]
    }
  }
}
```
Từ kết quả này:
- **Dòng đã chạy (Covered Lines)**: Dòng 2, 3, 4 (`s[0]>0, s[1]>0, s[2]>0`).
- **Dòng chưa chạy (Uncovered Lines)**: Dòng 6, 7 (`s[3]=0, s[4]=0`).
- **Nhánh chưa chạy (Uncovered Branch)**: Nhánh ELSE (khi giỏ hàng hợp lệ).

---

## 🎯 3. Áp Dụng Đồng Nhất Cho 3 Loại Kiểm Thử (Cross-Domain Applications)

| Tiêu chí | 1. Unit Testing | 2. Integration Testing (API) | 3. System Testing (E2E) |
| :--- | :--- | :--- | :--- |
| **Thư viện Runner** | Jest, Vitest | Supertest, Playwright API | Playwright, Cypress |
| **Môi trường đo** | Isolated Node.js Process | AUT Backend Server Instance | Headless Browser (Chromium / CDP) & Node Backend |
| **Nguồn gắn cờ** | Babel-plugin-istanbul / Vitest v8 | Istanbul/V8 instrumented Express App | Chrome DevTools Protocol Coverage (`page.coverage`) & Istanbul |
| **Đối tượng ánh xạ** | Function, Class, Method trong file unit | Endpoint Route, Controller, Middleware, Database | Page Route (`/login`, `/cart`), Frontend Component, DOM UI Step |
| **Định nghĩa "Đã chạy"** | Function/Statement được gọi bởi unit test | Request HTTP đi qua Router & Controller tương ứng | User action click/type/navigate chạm tới DOM/Component |
| **Định nghĩa "Chưa chạy"** | Function không có test case nào gọi tới | API Endpoint không có request nào kích hoạt Controller handler | Trang web hoặc UI element chưa từng được mở hoặc tương tác |
| **Cơ chế bắt lỗi** | Assertion discrepancy hoặc Exception trong code unit | Lỗi kẹt tại Router, Middleware, Controller hoặc DB không trả data | Điểm dừng lỗi: Selector timeout, element detached, assertion fail |

### 3.1. Ứng Dụng Trong Integration Test (API Testing) — Chi Tiết
1. **Phát hiện API Đã Có Test vs Chưa Có Test**:
   - Hệ thống quét AST trích xuất danh sách tất cả các Route Handlers trong Express (vd: `app.post('/api/orders', orderController.createOrder)` &rarr; hàm `createOrder` bắt đầu tại dòng 1, kết thúc dòng 8 của `order.controller.js`).
   - Sau khi chạy test integration:
     - Nếu toàn bộ các statement `s` trong hàm `createOrder` đều có `hitCount = 0` &rarr; **API `POST /api/orders` CHƯA CÓ TEST (Uncovered API)**.
     - Nếu ít nhất 1 statement có `hitCount > 0` &rarr; **API `POST /api/orders` ĐÃ ĐƯỢC TEST (Covered API)**.
2. **Xác Định Điểm Kẹt Lỗi Khi Test API Thất Bại (Failure Layer Diagnostics)**:
   - Khi kịch bản test API bị Fail (không trả về response đúng contract):
     - **Lỗi tại Route**: Không có bất kỳ controller statement nào được hit (`hitCount = 0`), response trả về 404 &rarr; *Bị kẹt tại Router mount path*.
     - **Lỗi tại Middleware**: Dòng code trong auth/cors middleware có `hit > 0`, nhưng controller handler có `hit = 0` &rarr; *Bị kẹt tại Middleware (Auth/Validation rejected)*.
     - **Lỗi tại Controller**: Controller chạy đến dòng 6 (`db.orders.create`) thì dừng lại, các dòng 7-8 có `hit = 0`, kèm error stack &rarr; *Bị kẹt tại Controller / Database Call*.
     - **Lỗi Assertion**: Toàn bộ luồng controller chạy trọn vẹn ra đến dòng 8 trả về status 201, nhưng test case lại expect status 200 &rarr; *Lỗi sai lệch Assertion*.

---

## 📋 4. Danh Sách Nhiệm Vụ Xây Dựng Engine Dùng Chung (Unified Tasks)

- [x] **Task CE-1: Xây Dựng Module Instrument & Thu Thập Cờ Cốt Lõi (`unifiedCoverageEngine.service.js`)**
  - [x] Chuẩn hóa hàm nạp và phân tích `coverage-final.json` sinh ra từ Jest, Vitest, Istanbul, hoặc V8 (`normalizeFilePath`, `normalizeFileCoverage`, `parseUnifiedCoverage`).
  - [x] Trích xuất mảng chỉ số chuẩn cho từng tệp nguồn:
    - `lines`: `{ total, covered, skipped, pct }` kèm danh sách `uncoveredLines: number[]`.
    - `statements`: `{ total, covered, skipped, pct }`.
    - `branches`: `{ total, covered, skipped, pct }` kèm danh sách `uncoveredBranches: Array<{ line, branchIndex, type }>`.
    - `functions`: `{ total, covered, skipped, pct }` kèm danh sách `uncoveredFunctions: string[]`.
  - [x] Cung cấp hàm tra cứu trạng thái dòng lệnh: `getLineExecutionStatus(filePath, lineNumber): "HIT" | "UNHIT" | "PARTIAL" | "IGNORED"`.

- [x] **Task CE-2: Module Ánh Xạ Ngược API & Điểm Dừng Lỗi Cho Integration Testing (`apiCoverageTracer.service.js`)**
  - [x] Nạp danh sách API Endpoints từ `apiEndpointParser.service.js`.
  - [x] Ánh xạ từng API Endpoint tới tọa độ mã nguồn Controller (`controllerFile`, `startLine`, `endLine`).
  - [x] Tính toán tỉ lệ bao phủ riêng cho từng Endpoint:
    - Endpoint Covered: Có `hitCount > 0` tại controller handler.
    - Endpoint Uncovered: Toàn bộ lines trong handler có `hitCount = 0`.
    - Endpoint Partially Covered: Chỉ chạy qua 1 số nhánh (ví dụ: chỉ chạy nhánh 400, chưa chạy nhánh 200).
  - [x] Trích xuất tầng bị kẹt lỗi (Failure Layer) dựa trên điểm gãy của dòng lệnh cờ cuối cùng (`ROUTER_NOT_FOUND`, `MIDDLEWARE_REJECTED`, `DATABASE_FAILURE`, `CONTROLLER_CRASH`, `ASSERTION_FAILED`).

- [x] **Task CE-3: Module Ánh Xạ Ngược Cho System Testing & Unit Testing**
  - [x] Ánh xạ cho Unit Test: Phân loại hàm nào chưa có unit test dựa trên `fnMap` và `f` (`traceUnitCoverage`).
  - [x] Ánh xạ cho System Test: Phân bổ phần trăm đóng góp coverage của từng kịch bản E2E vào các route frontend và UI component (`traceSystemCoverage`).

- [x] **Task CE-4: Chuẩn Hóa Data Contract & API Tra Cứu Độ Bao Phủ Dòng Lệnh**
  - [x] Cung cấp format JSON thống nhất trả về cho Dashboard UI (`buildApiCoverageReport`):
    ```json
    {
      "summary": { "linesPct": 82.5, "branchesPct": 75.0, "functionsPct": 90.0, "statementsPct": 84.1 },
      "uncoveredLinesByFile": { "src/controllers/order.js": [6, 7] },
      "endpointsTraceability": [
        { "method": "POST", "path": "/api/orders", "status": "PARTIAL", "coveragePct": 60, "missingBranches": ["Happy Path 201"] }
      ]
    }
    ```
  - [x] Đảm bảo UI Monaco Code Editor có thể hiển thị thanh màu xanh (Hit) / đỏ (Unhit) / vàng (Partial Branch) ở lề trái (gutter) của file mã nguồn (`formatCoverageForGutter`).

---

## 🏆 5. Kết Quả Kiểm Thử Tự Động & Nghiệm Thu (Automated Verification)

- **Tệp kiểm thử:** [`server/src/tests/unifiedCoverageEngine.test.js`](./server/src/tests/unifiedCoverageEngine.test.js)
- **Môi trường chạy:** Docker container `covai_server` (Jest 29.7.0, Node.js ESM).
- **Kết quả:** 15/15 tests **PASSED** (100% Pass Rate).
  - ✅ `normalizeFilePath` chuẩn hóa path đa nền tảng (Windows drive letters, Docker mount paths, project repo roots).
  - ✅ `normalizeFileCoverage` phân tích chính xác line hits, statements, branch paths (uncovered branches), và function hits.
  - ✅ `parseUnifiedCoverage` tổng hợp summary metrics toàn diện cho toàn bộ workspace.
  - ✅ `getLineExecutionStatus` trả về trạng thái dòng `HIT`, `UNHIT`, `PARTIAL`, `IGNORED`.
  - ✅ `formatCoverageForGutter` trả về tokens CSS gutter cho Monaco Code Viewer (`cov-hit-line`, `cov-unhit-line`, `cov-partial-line`).
  - ✅ `traceUnitCoverage` ánh xạ tới các hàm Unit Test (Tested vs Untested functions).
  - ✅ `traceSystemCoverage` ánh xạ tới các route frontend và page components trong E2E System Test.
  - ✅ `traceApiEndpointCoverage` phân loại chính xác các trạng thái Endpoint `COVERED`, `PARTIAL`, `UNCOVERED`.
  - ✅ `findLastExecutedLine` định vị chuẩn xác dòng code cuối cùng trước khi xảy ra lỗi.
  - ✅ `diagnoseApiFailureLayer` phát hiện chuẩn xác cả 5 tầng lỗi:
    1. `ROUTER_NOT_FOUND` (404 / Không khớp mount path Express)
    2. `MIDDLEWARE_REJECTED` (401/403/Validation error trước khi vào controller)
    3. `DATABASE_FAILURE` (Lỗi Prisma/Mongoose/SQL exception)
    4. `CONTROLLER_CRASH` (500 Unhandled TypeError/ReferenceError trong controller)
    5. `ASSERTION_FAILED` (Response contract sai lệch so với test expectation)
  - ✅ `buildApiCoverageReport` tổng hợp báo cáo hoàn chỉnh cho Dashboard UI và AI Generator.


