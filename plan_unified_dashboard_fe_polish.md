# Kế Hoạch Chi Tiết: Nâng Cấp & Hoàn Thiện Giao Diện Unified Quality & Testing Dashboard (Overview)

> **Mục tiêu:** Sửa triệt để 5 lỗi hiển thị / mâu thuẫn logic dữ liệu hiện tại (Split-Brain Data, Truncation, Pyramid Evaluation) và bổ sung 5 tính năng tương tác chiều sâu (100% ở mức Frontend) cho màn hình **Unified Quality & Testing Dashboard (`Overview`)** trước khi ghép nối dữ liệu Backend thật ở giai đoạn tiếp theo.
>
> **Nguyên tắc thiết kế & Hệ màu kỹ thuật (Strict Technical Palette):**
> - Tuân thủ nghiêm ngặt hệ màu kỹ thuật GitHub Primer hiện có: Nền chính `#0d1117` (`--ud-bg`), Bề mặt thẻ `#161b22` (`--ud-surface`), Bề mặt phụ `#1f242c` (`--ud-surface-2`), Viền `#30363d` (`--ud-border`).
> - Màu ngữ nghĩa: Pass `#3fb950` (`--ud-pass`), Warn `#d29922` (`--ud-warn`), Fail `#f85149` (`--ud-fail`), Unit `#58a6ff` (`--ud-unit`), Integration `#a371f7` (`--ud-integration`), System `#39c5cf` (`--ud-system`).
> - **Tuyệt đối không** sử dụng gradient lòe loẹt, màu neon hoặc hiệu ứng phát sáng gây nhiễu thị giác.

---

## PHASE 1: SỬA TRIỆT ĐỂ 5 LỖI HIỂN THỊ & MÂU THUẪN LOGIC DỮ LIỆU (BUG FIXES)

### Task 1.1: Sửa lỗi hiển thị `Current screen: undefined Test` ở AI Sidebar bên phải
- [x] **1.1.1.** Kiểm tra luồng truyền `screenContext` từ `client/src/components/dashboard/Layout.jsx` sang `AIPanel.jsx` và `AIContextDialog.jsx`.
- [x] **1.1.2.** Cập nhật hàm chuẩn hóa tên màn hình trong `client/src/components/dashboard/AIPanel.jsx` và `client/src/components/dashboard/AIContextDialog.jsx`:
  - Khi `screenContext?.activity === "overview"` hoặc `screenContext?.testType === "overview"`, hiển thị chính xác: `Current screen: Unified Quality Overview`.
  - Bổ sung fallback an toàn cho map `{ unit: "Unit Test", integration: "Integration Test", system: "System Test" }`, tuyệt đối không bao giờ ghép chuỗi `${undefined} Test`.

### Task 1.2: Sửa lỗi cắt chữ (Truncation `...`) trên Header của 3 thẻ Pillar (Zone 3)
- [x] **1.2.1.** Trong `client/src/components/dashboard/unified/pillars/PillarCardShell.jsx`:
  - Đặt `flex-shrink-0` (`shrink-0`) và `whitespace-nowrap` cho `PillarBadge` và nhãn framework (`Jest`, `Supertest`, `Playwright`), loại bỏ class `truncate` gây mất chữ `Su...` và `System (E2...`.
  - Hỗ trợ `flex-wrap` hợp lý với `gap-1.5` trên phần Header của thẻ Pillar để hiển thị trọn vẹn 100% nội dung trên mọi độ phân giải màn hình (kể cả khi mở đồng thời cả 2 thanh Sidebar trái/phải).
- [x] **1.2.2.** Rút gọn văn bản của badge trạng thái bên phải (`StatusPill`) trên cả 3 thẻ Pillar:
  - Thẻ **Unit** (`UnitPillarCard.jsx`): Hiển thị ngắn gọn `0/0 Tests` (khi chưa chạy) hoặc `142/144 Passed`.
  - Thẻ **Integration** (`IntegrationPillarCard.jsx`): Đổi `Passed (0/9 APIs)` thành `0/9 Covered` (với trạng thái cảnh báo vàng khi `Covered = 0, Uncovered > 0`) hoặc `23/27 Covered`.
  - Thẻ **System** (`SystemPillarCard.jsx`): Đổi `Untested (0/0 journeys)` thành `0/0 Journeys` hoặc `10/13 Journeys`.

### Task 1.3: Sửa lỗi cắt chữ trục X ở biểu đồ `Coverage & Quality Trends` (Zone 5)
- [x] **1.3.1.** Trong `client/src/components/dashboard/unified/charts/CoverageTrendChart.jsx`:
  - Tăng `padRight` trong vùng vẽ SVG của biểu đồ thêm `28px - 32px` (từ `20` lên `48`).
  - Căn chỉnh `textAnchor="end"` cho nhãn cuối cùng trên trục hoành (`#6 (Current)`) và `textAnchor="start"` cho nhãn đầu tiên để chữ `#6 (Current)` hiển thị đầy đủ 100%, không bị tràn lề phải SVG.

### Task 1.4: Sửa thuật toán đánh giá & hình vẽ của `Testing Pyramid` (Zone 3)
- [x] **1.4.1.** Cập nhật thuật toán `computePyramid(pillars)` trong `client/src/services/unifiedDashboard/unifiedDashboard.selectors.js`:
  - Trường hợp cả 3 tầng đều bằng `0` (`total === 0`): Trả về trạng thái trung tính `shape = "insufficient"`, tiêu đề `No Tests Executed — Run suites or enable Demo Mode`.
  - Trường hợp `unitTests === 0` nhưng `integrationTests > 0` hoặc `systemTests > 0`: Trả về trạng thái cảnh báo màu vàng (`#d29922`) `shape = "missing-unit"`, tiêu đề `Unbalanced Pyramid — Missing Unit Test Foundation`.
  - Trường hợp `systemTests > unitTests`: Trả về trạng thái cảnh báo đỏ/vàng `shape = "ice-cream-cone"`, tiêu đề `Inverted Pyramid (Ice-Cream Cone Anti-Pattern)`.
  - Trường hợp `unitTests > 0` nhưng `unitTests <= integrationTests` hoặc `hourglass`: Trả về cảnh báo màu vàng tương ứng (`Unbalanced Pyramid` / `Hourglass Distribution`).
  - Chỉ trả về `shape = "pyramid"` (màu xanh lá `#3fb950` — `Balanced Pyramid`) khi và chỉ khi `unitTests > integrationTests && integrationTests >= systemTests && unitTests > 0`.
- [x] **1.4.2.** Cập nhật hình vẽ SVG trong `client/src/components/dashboard/unified/charts/TestPyramidVisualizer.jsx`:
  - Phản ánh trực quan độ rộng (polygon width) và độ mờ (`fillOpacity`, `strokeOpacity`, `strokeDasharray`) của từng tầng: khi một tầng có `0 tests`, vẽ khối thu gọn với đường viền nét đứt (`strokeDasharray="4 3"`) và độ mờ thấp (`fillOpacity="0.04"`), không vẽ khối đáy Unit đầy đặn giả tạo khi `Unit = 0`.
  - Bổ sung khả năng click vào từng tầng của Kim tự tháp để kích hoạt lọc chéo (Cross-Filtering) xuống Zone 4.

### Task 1.5: Xử lý triệt để sự mâu thuẫn số liệu (Split-Brain Data) giữa các Zone
- [x] **1.5.1.** Tách biệt số lượng `Uncovered APIs` khỏi số lượng test đã thực thi trong `adaptIntegration` (`unifiedDashboard.adapter.js`) và `computeExecutionTotals` (`unifiedDashboard.selectors.js`):
  - Không gộp `endpoints.length` (số API phát hiện nhưng chưa có test) vào `totalTests` hoặc `failedTests` khi chưa chạy kịch bản test.
  - Hiển thị chỉ số `Uncovered APIs` thành một thông số/segment riêng biệt trong thẻ KPI `Total Test Execution` (Zone 2) để người dùng phân biệt rõ giữa `Failed Tests` và `Uncovered Endpoints`.
- [x] **1.5.2.** Sửa logic trạng thái badge trên thẻ `IntegrationPillarCard.jsx` (Zone 3):
  - Khi `Covered = 0` và `Uncovered = 9` (hoặc `> 0`), badge góc phải hiển thị màu vàng cảnh báo (`status="warn"`, `#d29922`) với nội dung `0/9 Covered`, tuyệt đối không hiện màu xanh lá `Passed`.
- [x] **1.5.3.** Đồng bộ hóa số liệu `FAILURE LAYER BREAKDOWN` và `FAILURE CLASSIFICATION BREAKDOWN`:
  - Ở chế độ `Live State`, nếu `failedTests === 0`, tất cả các mục `Route`, `Middleware/Auth`, `Controller`, `Database` (trên thẻ Integration) và `Selector Not Found`, `API/Net Timeout`, `Visual/Assertion` (trên thẻ System) phải bằng `0` (loại bỏ toán tử `|| MOCK_...` làm rơi vào dữ liệu giả khi giá trị thật là `0`).

---

## PHASE 2: BỔ SUNG 5 TÍNH NĂNG TƯƠNG TÁC CHUYÊN SÂU CHO FRONTEND (UX ENHANCEMENTS)

### Task 2.1: Tạo bộ chuyển đổi `Data Mode Switcher` (`Live State` vs. `Demo Showcase`) đồng bộ toàn trang
- [x] **2.1.1.** Thiết kế bộ dữ liệu giả lập toàn diện (`getDemoShowcaseBySnapshot` trong `unifiedDashboard.mock.js` & `unifiedDashboard.adapter.js`) **thống nhất 100% về mặt toán học** xuyên suốt cả 5 Zone:
  - **Unit Pillar**: `144` total (`142` passed, `2` failed), coverage `83.4%` lines / `76.5%` branches, runtime `4.2s`.
  - **Integration Pillar**: `25` executed tests (`23` passed, `2` failed) + `2` uncovered APIs (`27` endpoints total, `85.2%` API coverage), runtime `14.5s`. Breakdown lỗi khớp chính xác `2` lỗi: `Controller: 1` (`PUT /api/users/profile`), `Database: 1` (`POST /api/orders/checkout`), `Route: 0`, `Middleware/Auth: 0`.
  - **System Pillar**: `13` journeys (`10` passed, `3` failed, `1` flaky), flow coverage `68.5%`, runtime `48.2s`. Breakdown lỗi khớp chính xác `3` lỗi + `1` flaky: `Selector Not Found: 1` (`#stripe-submit`), `API/Net Timeout: 1` (`Checkout step 3`), `Visual/Assertion: 1` (`Profile update`), `Flaky Scenario: 1`.
  - **Zone 2 Totals**: `182` total executed (`165` passed, `7` failed, `1` flaky, `90.7%` pass rate, `1m 7s` total runtime, `2` uncovered APIs).
  - **Zone 4 Traceability Matrix**: 6 Modules có tổng số bài test Pass/Fail ở từng cột Unit (`142/144`), Integration (`23/25` + `2` uncovered), System (`10/13`) khớp tuyệt đối 100% với Zone 2 và Zone 3.
  - **Zone 5 History & Trends**: Lịch sử chạy `run-9842` (System `10/3`), `run-9841` (Integration `23/2`), `run-9840` (Unit `142/2`) và điểm `#6 (Current)` trên biểu đồ Trend khớp tuyệt đối với các chỉ số ở Zone 2 & Zone 3.
- [x] **2.1.2.** Ở chế độ `Live State`, đảm bảo toàn bộ 5 Zone đều phản ánh đúng trạng thái thực tế của dự án (nếu chưa chạy test, hiện banner trạng thái rỗng rõ ràng kèm nút kêu gọi hành động `Run All Suites` hoặc chuyển sang `Demo Showcase`).
- [x] **2.1.3.** Tích hợp thanh chuyển đổi `Data Mode Switcher` (`Live State` / `Demo Showcase`) ngay trên `GlobalCommandHeader.jsx` (Zone 1).

### Task 2.2: Chi tiết hóa `Quality Gate Popover` & `Snapshot Selector` (Zone 1)
- [x] **2.2.1.** Nâng cấp `computeQualityGate` (`unifiedDashboard.selectors.js`) và `QualityGateBadge.jsx` để khi click vào badge (`AT RISK` / `READY TO RELEASE` / `BLOCKED`) sẽ mở Popover hiển thị bảng Checklist 4 điều kiện tiên quyết kèm giá trị hiện tại và Icon Pass/Fail:
  1. `Unit Branch Coverage >= 75%`
  2. `API Endpoint Coverage >= 80%`
  3. `Critical E2E Journeys Passing = 100%`
  4. `Zero High-Severity Cross-Layer Defects`
- [x] **2.2.2.** Chuyển dòng text tĩnh `Snapshot: ...` trên `GlobalCommandHeader.jsx` thành một Dropdown chọn phiên bản Snapshot (hỗ trợ chọn giữa các snapshot của dự án hoặc các snapshot mẫu trong chế độ Demo để xem sự thay đổi trạng thái `AT RISK` / `PASSED` / `BLOCKED` trực tiếp trên giao diện).

### Task 2.3: Mở rộng dòng chi tiết (Expandable Row Drill-Down) cho bảng `Cross-Layer Traceability Matrix` (Zone 4)
- [x] **2.3.1.** Bổ sung dữ liệu chi tiết 3 tầng (`layerDetails: { unit, integration, system }`) cho từng dòng Module trong `CrossLayerTraceMatrix`.
- [x] **2.3.2.** Cập nhật `CrossLayerTraceMatrix.jsx` để khi click vào bất kỳ dòng `Module / Feature` nào sẽ mở rộng (expand) một panel con hiển thị sơ đồ liên kết 3 tầng của đúng Module đó:
  - **Tầng Unit**: Tên file service/controller, tỷ lệ phủ nhánh (`branchCoveragePct`), tên hàm bị fail (nếu có).
  - **Tầng Integration**: Phương thức + Đường dẫn API (ví dụ `POST /api/orders/checkout`), mã HTTP trả về (`HTTP 500`, `HTTP 422`, `HTTP 200`), tầng bị kẹt lỗi (`Middleware`, `Controller`, `Database`, hoặc `None`).
  - **Tầng System (E2E)**: Tên luồng giao diện, bước bị dừng (`failedStep`), loại lỗi UI (`Selector Not Found`, `API/Net Timeout`, `Visual/Assertion`).
  - Cụm nút bấm nhanh để chuyển tới Workspace tương ứng hoặc gửi ngữ cảnh lỗi sang khung chat `COV AI Agent`.

### Task 2.4: Xây dựng Ngăn kéo Chẩn đoán & Xem chi tiết (`Slide-Over Inspector Drawer`) cho Zone 4 & Zone 5
- [x] **2.4.1.** Tạo component `client/src/components/dashboard/unified/inspector/SlideOverInspectorDrawer.jsx` theo đúng chuẩn màu kỹ thuật (`#0d1117`, `#161b22`, `#30363d`).
- [x] **2.4.2.** Kết nối sự kiện bấm nút `Diagnose ↗` (hoặc nút hành động) ở `SmartActionCenter.jsx` (Zone 4) và nút `View ↗` ở bảng `UnifiedRecentRunsTable.jsx` (Zone 5) để mở Drawer hiển thị:
  - Stack trace / Failure layer chi tiết.
  - Danh sách từng test case trong lần chạy (ví dụ `run-9842`) kèm trạng thái và thời gian chạy từng bước (`ms`).
- [x] **2.4.3.** Tích hợp nút `Ask COV AI to Diagnose` trong Drawer và Matrix:
  - Khi bấm, tự động mở thanh `COV AI Agent` bên phải (nếu đang đóng) và điền sẵn prompt ngữ cảnh lỗi chi tiết vào ô nhập liệu (`ChatInput` trong `AIPanel.jsx`) để người dùng trải nghiệm luồng trợ lý AI liền mạch.

### Task 2.5: Liên kết Lọc Chéo (Cross-Filtering) & Modal Xuất Báo Cáo (`Export Report Modal`)
- [x] **2.5.1.** Triển khai **Cross-Filtering** giữa Zone 3 và Zone 4:
  - Khi click vào một tầng trên `Testing Pyramid`, hoặc một dòng trong `FAILURE LAYER BREAKDOWN` (thẻ Integration), hoặc một dòng trong `FAILURE CLASSIFICATION BREAKDOWN` (thẻ System), tự động lọc và cuộn mượt xuống làm nổi bật các hạng mục tương ứng trong `Cross-Layer Traceability Matrix` và `Smart Action Center` (Zone 4), kèm thanh trạng thái bộ lọc có nút `Clear Filter`.
- [x] **2.5.2.** Xây dựng component `client/src/components/dashboard/unified/modals/ExportReportModal.jsx`:
  - Khi bấm nút `Export Report` trên Header (Zone 1), mở Modal cho phép chọn các phân vùng muốn xuất (Executive KPIs, Testing Pyramid & Pillars, Cross-Layer Matrix, Smart Action Center, Trends & Execution History).
  - Hiển thị bản xem trước (Preview) ngay trong Modal.
  - Hỗ trợ xuất ra file `.md`, `.json`, hoặc gọi chế độ in báo cáo sạch đẹp (`window.print()` kết hợp CSS `@media print` trong `client/src/index.css`).

---

## PHASE 3: KIỂM ĐỊNH CHẤT LƯỢNG, UNIT TESTS & BUILD VERIFICATION

- [x] **Task 3.1:** Cập nhật và chạy bộ unit test `client/src/services/unifiedDashboard/unifiedDashboard.selectors.test.js` kiểm tra thuật toán `computePyramid`, `computeQualityGate`, `computeExecutionTotals`, và tính toàn vẹn dữ liệu `Demo Showcase`.
- [x] **Task 3.2:** Chạy kiểm tra biên dịch Frontend (`npm run build` trong `client/`) đảm bảo không có lỗi cú pháp, lỗi import, hoặc cảnh báo console.
- [x] **Task 3.3:** Cập nhật trạng thái `[x]` cho toàn bộ các task trong file `plan_unified_dashboard_fe_polish.md`.

