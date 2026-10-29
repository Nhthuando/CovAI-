# Plan — Unified Quality & Testing Dashboard (Frontend-first)

> **Phạm vi:** 100% Frontend trong `client/src/`. Không sửa Backend/Database.
> **Mục tiêu:** Một trang tổng hợp (`?tab=overview`) hội tụ chỉ số, chẩn đoán và điều hướng của **Unit Test**, **Integration Test** và **System Test (E2E)**.
> **Quy ước checkbox:** `[x]` = đã có trong code, tái sử dụng được ngay · `[ ]` = cần làm mới / cần sửa.

---

## 0. Các quyết định đã chốt

| # | Chủ đề | Quyết định |
|---|--------|------------|
| D1 | Bảng màu | Bảng màu GitHub Primer **chỉ áp dụng trong lớp bao `.unified-dashboard`** (dark + light). Bộ biến màu chung trong `index.css` và các trang khác **giữ nguyên**. |
| D2 | Vị trí trang | Thêm mục **"Overview"** vào `ActivityBar` → `/main-editor?tab=overview`. Nằm trong workspace hiện có, dùng chung project/snapshot đang chọn. |
| D3 | Dữ liệu | **Adapter kết hợp**: dùng API thật ở chỗ đã có, chỗ chưa có API (ma trận truy vết, lịch sử gộp, thống kê AI, xu hướng) thì dùng mock riêng và gắn nhãn **"Demo data"**. |
| D4 | Biểu đồ | **SVG tự viết + Tailwind**. Không thêm thư viện biểu đồ. |
| D5 | Run All / Export | Run All gọi **lần lượt** `runCoverageByType` theo thứ tự unit → integration → system và hiện tiến trình. Export xuất **JSON/Markdown ngay trên trình duyệt** từ dữ liệu adapter. |
| D6 | Điều hướng CTA | Mở workspace tương ứng **kèm tham số trỏ tới mục cần xử lý** (`focusFile` / `focusEndpoint` / `focusScenario`). Workspace nào chưa đọc tham số thì chỉ mở workspace, **không sửa logic hiện có**. |

---

## 1. Kết quả khảo sát `client/src/`

### 1.1 Stack & hạ tầng
- React 19 + Vite 8, `react-router-dom` v7, **Tailwind CSS v4** (`@import "tailwindcss"` + `@theme` trong [index.css](file:///d:/NCKH/CovAI-/client/src/index.css)).
- `@tanstack/react-query` v5 ([queryClient.js](file:///d:/NCKH/CovAI-/client/src/lib/queryClient.js)), `lucide-react` (bộ icon duy nhất), `framer-motion`, `date-fns`, `axios`.
- **Chưa có thư viện biểu đồ** → theo D4.
- Theme: [ThemeContext.jsx](file:///d:/NCKH/CovAI-/client/src/contexts/ThemeContext.jsx) gán `data-theme="dark|light"` + class `.dark` lên `<html>` và hỗ trợ `system`.
- Quy tắc dự án đang áp dụng: [COVAI_FRONTEND_AGENT_RULES.md](file:///d:/NCKH/CovAI-/COVAI_FRONTEND_AGENT_RULES.md) (cấm gradient, bắt buộc có điều hướng, đủ các trạng thái, ưu tiên Tailwind).

### 1.2 Router & Layout
- [App.jsx](file:///d:/NCKH/CovAI-/client/src/App.jsx): `/main-editor` → `DashboardPage` → [Layout.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/Layout.jsx).
- Layout chuyển màn hình bằng query `?tab=<activity>` (`handleSelectActivity`, dòng ~110–138) và `?coverageType=unit|integration|system` (`handleSelectCoverageType`, dòng ~221).
- Ba workspace con được mount sẵn và ẩn/hiện bằng class `hidden` (dòng ~974–1027):
  - `UnitTestDashboard` → `CoverageTypeDashboard type="unit"`
  - `IntegrationTestDashboard` → `IntegrationWorkspace`
  - `SystemTestDashboard`
- Vùng Editor là phương án mặc định khi `activeActivity` không thuộc `settings|jobs|architecture|coverage` (dòng ~1029) → **phải thêm `overview` vào điều kiện này**, nếu không Editor sẽ hiện chồng lên.
- Cách xác định snapshot đang bị lặp ở nhiều chỗ (`searchParams.snapshotId || project.latestSnapshotId || project.snapshots[0].id || localStorage latestSnapshot_<id> || testPromptSnapshotId`). Riêng System **không** đọc `searchParams.snapshotId`.

### 1.3 Thành phần dùng chung đã có
| Thành phần | File | Ghi chú |
|-----------|------|---------|
| `Button` (primary/secondary/outline/ghost/success/danger, loading, icon, `to`) | [Button.jsx](file:///d:/NCKH/CovAI-/client/src/components/common/Button.jsx) | Dùng nguyên |
| `Card`, `CardHeader`, `CardContent`, `CardFooter` | [Card.jsx](file:///d:/NCKH/CovAI-/client/src/components/common/Card.jsx) | Dùng nguyên, truyền className cho token `ud-*` |
| `Badge` (theo ngữ nghĩa, sm/md/lg) | [Badge.jsx](file:///d:/NCKH/CovAI-/client/src/components/common/Badge.jsx) | Dùng cho trạng thái; badge định danh 3 trụ cột sẽ bọc thêm |
| `Skeleton` + các skeleton có sẵn | [Skeleton.jsx](file:///d:/NCKH/CovAI-/client/src/components/common/Skeleton.jsx) | Dùng `Skeleton` gốc để dựng skeleton cho từng zone |
| `ConfirmDialog` | [ConfirmDialog.jsx](file:///d:/NCKH/CovAI-/client/src/components/common/ConfirmDialog.jsx) | Xác nhận trước khi Run All |
| `GlobalErrorBoundary`, `IntegrationErrorBoundary` | `components/common`, `components/dashboard/integration` | Mẫu để viết ErrorBoundary cho từng zone |
| Toast (`useToast`) | [ToastContext.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/ToastContext.jsx) | Thông báo cho Run/Export |
| `RunningProcessContext` + `GlobalProcessIndicator` | `contexts/`, `components/` | Cần xác minh API trước khi đăng ký tiến trình Run All |
| `useBreakpoints` | [useMediaQuery.js](file:///d:/NCKH/CovAI-/client/src/hooks/useMediaQuery.js) | Responsive |

### 1.4 Service / Hook dữ liệu đã có
| Tầng | Hàm | File |
|------|-----|------|
| Unit | `getCoverageSummary(snapshotId,'unit')`, `getCoverageFiles`, `getCoverageFunctions`, `getCoverageTestSuites`, `getTestExecution`, `getCoverageFrameworks` | [coverage.service.js](file:///d:/NCKH/CovAI-/client/src/services/coverage.service.js) |
| Unit (hook) | `useCoverageDashboard(snapshotId, type, projectId)` + `fetchCoverageDashboardData` | [useCoverageQuery.js](file:///d:/NCKH/CovAI-/client/src/hooks/useCoverageQuery.js) |
| Integration | `getIntegrationWorkspace`, `getIntegrationHistory`, `getIntegrationDetection`, `getIntegrationVersionHistory` + hook `useIntegrationWorkspace` | coverage.service.js / useCoverageQuery.js |
| System | `getSystemTestSummary` (`totalTests, passedTests, failedTests, flakyTests, skippedTests, durationMs, runner, hasRun`), `getSystemTestFrameworks`, `getSystemTestScenarios` | [systemTest.service.js](file:///d:/NCKH/CovAI-/client/src/services/systemTest.service.js) |
| So sánh trước/sau | `getBeforeAfterComparison(projectId, opts)` | coverage.service.js |
| Chạy test | `runCoverageByType(snapshotId, type, framework, executionMode)`, `runSystemTest` | coverage.service.js / systemTest.service.js |
| Bất hợp lệ cache | `invalidateCoverageQueries(snapshotId)` | useCoverageQuery.js |

### 1.5 Logic có thể tham khảo (chỉ lấy logic, **không** lấy màu viết cứng)
- `getGrade` trong [QualityDashboard.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/QualityDashboard.jsx) (đang dùng nhiều mã hex viết cứng — không tái sử dụng phần giao diện). Component này hiện **không có chỗ nào mở** (`setShowQualityDashboard(true)` không xuất hiện).
- `formatDuration` trong [SystemTestMetricsCards.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/system/SystemTestMetricsCards.jsx).
- `FAILURE_LAYER_STYLES` / `failureLayer` trong [IntegrationReportPage.jsx](file:///d:/NCKH/CovAI-/client/src/pages/IntegrationReportPage.jsx) → nguồn phân loại tầng lỗi Integration.
- `normalizePathForCompare` trong [navigation.service.js](file:///d:/NCKH/CovAI-/client/src/services/navigation.service.js) → chuẩn hóa đường dẫn khi gom module.
- `CoverageDashboard.jsx` đang được import trong Layout nhưng không render → **không đụng tới**.

---

## 2. Quy tắc Thiết kế & Code (Design & Coding Rules)

### 2.1 Cấm tuyệt đối (Anti-"AI slop")
- [ ] Không dùng `linear-gradient` / `radial-gradient` / `conic-gradient` và các utility `bg-gradient-*`, `from-*`, `via-*`, `to-*`, không dùng chữ gradient.
- [ ] Không dùng màu neon (cyan phát sáng, tím neon, magenta), không dùng `box-shadow` dạng glow, không dùng `backdrop-filter: blur`.
- [ ] Không dùng icon trang trí vô nghĩa, không dùng emoji làm icon. Chỉ dùng `lucide-react`, cỡ 14/16px, đồng nhất cho các control cùng loại.
- [ ] Không có animation vào trang lớn, không float/parallax. Chỉ chuyển màu 150ms; tôn trọng `prefers-reduced-motion`.
- [ ] Không viết cứng mã hex trong component. Mọi màu lấy qua token `--ud-*`.
- [ ] Không bịa số liệu: dữ liệu mock phải đi qua adapter và hiện nhãn **Demo data**.

### 2.2 Bộ token màu (chỉ trong `.unified-dashboard`)
Khai báo trong `index.css` (một khối mới, **không** sửa các biến hiện có):

| Token | Dark (`[data-theme="dark"] .unified-dashboard`) | Light (`.unified-dashboard`) |
|-------|------|-------|
| `--ud-bg` | `#0d1117` | `#f6f8fa` |
| `--ud-surface` | `#161b22` | `#ffffff` |
| `--ud-surface-2` (phụ/hover) | `#1f242c` | `#f3f4f6` |
| `--ud-border` | `#30363d` | `#d0d7de` |
| `--ud-text` | `#f0f6fc` | `#1f2328` |
| `--ud-text-muted` | `#8b949e` | `#656d76` |
| `--ud-pass` | `#3fb950` | `#1a7f37` |
| `--ud-fail` | `#f85149` | `#cf222e` |
| `--ud-warn` | `#d29922` | `#9a6700` |
| `--ud-unit` | `#58a6ff` | `#0969da` |
| `--ud-integration` | `#a371f7` | `#8250df` |
| `--ud-system` | `#39c5cf` | `#1b7c83` |
| `--ud-neutral` (skipped/untested) | `#6e7681` | `#8c959f` |

- Đăng ký vào `@theme` của Tailwind v4 dưới dạng `--color-ud-*: var(--ud-*)` để dùng class `bg-ud-surface`, `text-ud-muted`, `border-ud-border`…
- Nền nhạt cho trạng thái: dùng `color-mix(in srgb, var(--ud-fail) 12%, transparent)` hoặc modifier độ mờ của Tailwind (`bg-ud-fail/10`). Không dùng màu đặc tràn nền thẻ.
- Màu định danh 3 trụ cột **chỉ** dùng cho: badge loại test, viền chỉ thị `border-l-2`/`border-t-2` (2–3px), đường/cột trong biểu đồ. **Không** dùng làm nền thẻ.

### 2.3 Bố cục, khoảng cách, bo góc
- Lưới 12 cột: `grid grid-cols-12 gap-4` (desktop ≥1280). Tablet `md` → 6 cột / xếp chồng; mobile → 1 cột.
- Khoảng cách theo bội số 4px: chỉ dùng `gap-2/3/4/6`, `p-3/4/5`. Không dùng giá trị tùy ý như `mt-[13px]`.
- Bo góc: control `rounded-md` (6px), thẻ/panel `rounded-lg` (8px). Không dùng góc 12px+ cho thẻ.
- Phân tầng bằng **nền + viền 1px**, không dùng đổ bóng.
- Độ rộng nội dung: `max-w-[1440px] mx-auto px-6`; cả trang cuộn trong vùng main của Layout.

### 2.4 Typography & số liệu
- Font chữ: `var(--font-sans)` (Inter). Tiêu đề trang 20px/600, tiêu đề zone 14px/600 viết hoa nhẹ (`tracking-wide text-ud-muted`), tiêu đề thẻ 14–16px/600, nội dung 13–14px, meta 12px.
- **Bắt buộc** dùng `font-mono tabular-nums` (`var(--font-mono)`) cho: số đếm, %, thời gian (`ms`/`s`), mã lần chạy, đường dẫn file, tên endpoint, selector.
- Định dạng số đi qua helper chung `format.js`: `fmtPct(1 chữ số thập phân)`, `fmtDuration`, `fmtCount(1,234)`, `fmtDelta(+2.4 / −1.1)`, `fmtRelativeTime` (date-fns).
- Thiếu dữ liệu hiển thị `—` kèm tooltip lý do, không hiển thị `0%` giả.

### 2.5 Trạng thái & khả năng truy cập
- Mỗi zone có đủ 4 trạng thái **Loading (skeleton) / Empty / Error (có nút Retry) / Success**; mỗi zone có ErrorBoundary riêng để lỗi một zone không làm sập trang.
- Không truyền đạt trạng thái chỉ bằng màu: luôn có nhãn chữ hoặc icon (`CheckCircle2`, `XCircle`, `AlertTriangle`, `MinusCircle`).
- Biểu đồ SVG có `role="img"` + `aria-label` tóm tắt số liệu, kèm bảng/legend dạng chữ.
- Mọi phần tử tương tác có `id` duy nhất, dạng `ud-<zone>-<element>` (ví dụ `ud-header-run-all`).
- Focus hiển thị rõ (`focus-visible:outline-2 outline-[var(--color-focus)]`).

### 2.6 Quy tắc code
- Tái sử dụng `Button`, `Card`, `Badge`, `Skeleton`, `ConfirmDialog`, `useToast` trước khi tạo mới. Primitive mới đặt trong `unified/primitives/` và nhận variant qua props.
- Component trình bày là **pure** (chỉ nhận view-model qua props), không gọi API. Chỉ `UnifiedDashboard.jsx` + hook gọi dữ liệu.
- Công thức tính (health score, quality gate, hình dạng kim tự tháp, nguyên nhân gốc) là **hàm thuần** trong `unifiedDashboard.selectors.js`, có unit test (theo mẫu `systemTestExecutionModel.test.js`).
- Ngưỡng/trọng số gom về một file `unifiedDashboard.config.js`, không rải số "ma thuật" trong component.
- Mỗi file component không quá ~250 dòng; tránh lặp lại các chuỗi class dài (tách primitive).
- JSDoc `@typedef` cho view-model (dự án dùng JS, không dùng TS).
- **Không sửa** `CoverageTypeDashboard.jsx`, `IntegrationWorkspace.jsx`, `SystemTestDashboard.jsx` trong phạm vi plan này (chỉ đọc tham số focus ở Phase 9, và chỉ khi không thay đổi hành vi cũ).

---

## 3. Kiến trúc thư mục đề xuất

```
client/src/
├── components/dashboard/unified/
│   ├── UnifiedDashboard.jsx              # container: gọi hook, ghép 5 zone
│   ├── primitives/
│   │   ├── ZonePanel.jsx                 # khung panel + tiêu đề + trạng thái (loading/empty/error)
│   │   ├── KpiCard.jsx                   # Label / Value / Supporting
│   │   ├── MetricValue.jsx               # số mono + tabular-nums + đơn vị
│   │   ├── DeltaIndicator.jsx            # ▲/▼ so với lần chạy trước
│   │   ├── StackedBar.jsx                # thanh ngang Passed/Failed/Skipped
│   │   ├── MeterBar.jsx                  # thanh % đơn (coverage)
│   │   ├── PillarBadge.jsx               # Unit/Integration/System badge
│   │   ├── StatusPill.jsx                # pass/fail/warn/untested/none
│   │   ├── SegmentedFilter.jsx           # All | Has Failure | Low Coverage...
│   │   ├── QualityGateBadge.jsx
│   │   ├── DemoDataBadge.jsx
│   │   └── ZoneErrorBoundary.jsx
│   ├── zones/
│   │   ├── GlobalCommandHeader.jsx       # Zone 1
│   │   ├── ExecutiveKpiRow.jsx           # Zone 2
│   │   ├── PyramidAndPillarsZone.jsx     # Zone 3
│   │   ├── TraceAndActionsZone.jsx       # Zone 4
│   │   └── TrendsAndHistoryZone.jsx      # Zone 5
│   ├── charts/
│   │   ├── TestPyramidVisualizer.jsx
│   │   └── CoverageTrendChart.jsx
│   ├── pillars/
│   │   ├── PillarCardShell.jsx
│   │   ├── UnitPillarCard.jsx
│   │   ├── IntegrationPillarCard.jsx
│   │   └── SystemPillarCard.jsx
│   ├── matrix/CrossLayerTraceMatrix.jsx
│   ├── actions/SmartActionCenter.jsx
│   ├── history/UnifiedRecentRunsTable.jsx
│   └── skeletons/UnifiedDashboardSkeleton.jsx
├── services/unifiedDashboard/
│   ├── unifiedDashboard.config.js        # ngưỡng, trọng số
│   ├── unifiedDashboard.types.js         # JSDoc typedefs
│   ├── unifiedDashboard.adapter.js       # API thô → view-model
│   ├── unifiedDashboard.mock.js          # dữ liệu demo tách riêng
│   ├── unifiedDashboard.selectors.js     # health score, gate, pyramid, root cause, actions
│   ├── unifiedDashboard.selectors.test.js
│   ├── unifiedDashboard.export.js        # JSON / Markdown
│   ├── workspaceNavigation.js            # buildWorkspaceUrl(...)
│   └── format.js
└── hooks/
    ├── useUnifiedDashboard.js            # react-query, gộp 3 tầng
    └── useRunAllSuites.js                # chạy tuần tự + tiến trình
```

---

## 4. Hợp đồng dữ liệu (View-Model)

```js
/** @typedef {'unit'|'integration'|'system'} Pillar */
/** @typedef {'pass'|'fail'|'warn'|'untested'|'none'} CellStatus */
/** @typedef {'live'|'demo'|'unavailable'} DataSource */

/**
 * @typedef UnifiedDashboardVM
 * @property {{ projectId, projectName, snapshotId, snapshots: {id,label,branch,createdAt}[], updatedAt }} context
 * @property {{ status:'PASSED'|'WARNING'|'FAILED', label:string, reasons:string[] }} qualityGate
 * @property {{ score:number|null, grade:'A'|'B'|'C'|'D'|null, delta:number|null, source:DataSource }} health
 * @property {{ total, passed, failed, skipped, flaky, passRate, durationMs, source }} execution
 * @property {{ overall:number|null, codePct, apiPct, flowPct, source }} coverage
 * @property {{ aiGenerated, aiRepaired, gaps, source }} ai
 * @property {Record<Pillar, PillarVM>} pillars
 * @property {{ shape:'pyramid'|'ice-cream-cone'|'hourglass'|'insufficient', layers:{pillar,count,durationMs,pct}[] }} pyramid
 * @property {{ rows: TraceRowVM[], source }} matrix
 * @property {{ items: ActionItemVM[], source }} actions
 * @property {{ series: {runLabel, unit, integration, system, passRate}[], source }} trend
 * @property {{ runs: RunVM[], source }} history
 */
```

### 4.1 Bảng ánh xạ nguồn dữ liệu
| Trường VM | Nguồn | Trạng thái |
|-----------|-------|-----------|
| `pillars.unit` (pass/fail, 4 chỉ số coverage, framework, file nhánh thấp) | `fetchCoverageDashboardData({type:'unit'})` → `summary`, `executions`, `frameworks`, `files` (sắp xếp theo `branchesPct` tăng dần) | **Live** (cần xác minh shape của `summary`/`executions`) |
| `pillars.integration` (endpoint Pass/Fail/Uncovered, API %, backend %, tầng lỗi) | `getIntegrationWorkspace(snapshotId)` + `getCoverageSummary(snapshotId,'integration')` | **Live** (cần xác minh field endpoint/failureLayer) |
| `pillars.system` (journey, flow %, phân loại lỗi, framework) | `getSystemTestSummary`, `getSystemTestFrameworks`, `getSystemTestScenarios` | **Live** một phần; phân loại lỗi UI → nếu thiếu field thì **Demo** |
| `health`, `qualityGate`, `execution`, `coverage`, `pyramid` | Tính từ `pillars` trong selectors | Phát sinh (theo nguồn của pillars) |
| `context.snapshots` | `project.snapshots` (Layout đã có) | **Live** |
| `trend` | `getBeforeAfterComparison(projectId)` cho Integration; các tầng khác → mock | **Kết hợp / Demo** |
| `matrix` | Chưa có API → mock; sau này gom theo module từ đường dẫn file/route | **Demo** |
| `actions` | Phát sinh từ pillars (file coverage thấp, endpoint uncovered/fail, scenario fail) + mock bổ sung | **Kết hợp** |
| `history` | `getIntegrationHistory` (Integration) + mock (Unit/System) | **Kết hợp / Demo** |
| `ai` | Chưa có API → mock | **Demo** |

### 4.2 Công thức (đặt trong `config` + `selectors`)
- **Pass rate tầng** = `passed / (passed + failed)` (không tính skipped).
- **Coverage tầng**: Unit = `lines %`; Integration = `API endpoint coverage %`; System = `flow coverage %`.
- **Điểm tầng** = `0.5 × passRate + 0.5 × coverage`.
- **Health score** = trung bình có trọng số các tầng có dữ liệu (mặc định Unit 0.5 · Integration 0.3 · System 0.2, tầng không có dữ liệu thì loại ra và chuẩn hóa lại trọng số).
- **Grade**: A ≥ 90 · B ≥ 75 · C ≥ 60 · D < 60 · `null` nếu không có dữ liệu.
- **Quality Gate**:
  - `FAILED / BLOCKED`: có tầng nào pass rate < 80%, hoặc có journey E2E quan trọng bị fail.
  - `WARNING / AT RISK`: có tầng dưới ngưỡng coverage (Unit lines < 70%, API < 60%, Flow < 50%), hoặc flaky > 0, hoặc có tầng chưa có dữ liệu.
  - `PASSED / READY TO RELEASE`: các trường hợp còn lại.
  - `reasons[]` liệt kê từng điều kiện vi phạm (hiện trong tooltip/popover).
- **Hình dạng kim tự tháp** (theo số lượng test): `pyramid` nếu Unit ≥ Integration ≥ System · `ice-cream-cone` nếu System > Unit · `hourglass` nếu Integration < min(Unit, System) · `insufficient` nếu < 2 tầng có dữ liệu.

### 4.3 Bảng quy tắc chẩn đoán nguyên nhân gốc (Matrix)
| Unit | Integration | System | Chẩn đoán |
|------|-------------|--------|-----------|
| fail | fail | fail | Lỗi logic nghiệp vụ (tầng hàm/service) lan lên trên |
| pass | fail | fail | Lỗi ở tầng giao tiếp API/DB (route, middleware, controller, database) |
| pass | pass | fail | Lỗi giao diện / luồng UI (selector, điều hướng, assertion hiển thị) |
| pass | fail | pass | Hợp đồng API bị lỗi ở nhánh mà luồng UI chưa đi qua |
| fail | pass | * | Lỗi logic chưa được API test chạm tới |
| untested | * | * | Lỗ hổng bao phủ: thiếu Unit Test |
| pass | pass | pass | Ổn định |
| còn lại | | | Cần điều tra thủ công |

---

## 5. Kế hoạch theo Phase

### Phase 0 — Khảo sát & nền tảng có sẵn
- [x] Router `/main-editor` + `ProtectedRoute` ([App.jsx](file:///d:/NCKH/CovAI-/client/src/App.jsx))
- [x] Layout chuyển màn hình bằng `?tab=` và `?coverageType=` ([Layout.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/Layout.jsx))
- [x] 3 workspace con: Unit (`CoverageTypeDashboard`), Integration (`IntegrationWorkspace`), System (`SystemTestDashboard`)
- [x] Theme light/dark/system + `data-theme` ([ThemeContext.jsx](file:///d:/NCKH/CovAI-/client/src/contexts/ThemeContext.jsx))
- [x] Tailwind v4 + `@theme` token + font Inter/JetBrains Mono ([index.css](file:///d:/NCKH/CovAI-/client/src/index.css))
- [x] Component dùng chung: `Button`, `Card`, `Badge`, `Skeleton`, `ConfirmDialog`, Toast
- [x] React Query + hook `useCoverageDashboard`, `useIntegrationWorkspace`, `invalidateCoverageQueries`
- [x] Service: coverage / systemTest / chạy test (`runCoverageByType`, `runSystemTest`)
- [x] Bộ icon `lucide-react`
- [x] Xác minh shape response thực tế của: `getCoverageSummary`, `getTestExecution`, `getCoverageFrameworks`, `getIntegrationWorkspace`, `getIntegrationHistory`, `getSystemTestSummary`, `getSystemTestScenarios`, `getBeforeAfterComparison` (ghi lại field thật vào `unifiedDashboard.types.js`)
- [x] Xác minh API của `RunningProcessContext` để đăng ký tiến trình Run All

### Phase 1 — Design tokens & primitives
- [x] **1.1 Token phạm vi dashboard**
  - [x] Thêm khối `.unified-dashboard { --ud-*: <light> }` và `[data-theme="dark"] .unified-dashboard, .dark .unified-dashboard { --ud-*: <dark> }` vào cuối `index.css`
  - [x] Đăng ký `--color-ud-*` trong `@theme`
  - [x] Kiểm tra không có biến hiện có nào bị ghi đè (diff chỉ thêm dòng)
- [x] **1.2 Helpers** `format.js`: `fmtPct`, `fmtCount`, `fmtDuration`, `fmtDelta`, `fmtRelativeTime`, `fmtOrDash`
- [x] **1.3 Primitives**
  - [x] `ZonePanel` (title, actions slot, `state: loading|empty|error|ready`, `onRetry`, `source` → hiện `DemoDataBadge`)
  - [x] `KpiCard` (label / value / supporting / footer slot)
  - [x] `MetricValue` (mono, tabular-nums, unit, size sm/md/lg)
  - [x] `DeltaIndicator` (tăng = pass, giảm = fail, 0 = muted; có chữ "vs previous run")
  - [x] `StackedBar` (segments `{key,value,tone}`, legend dạng chữ, `aria-label`)
  - [x] `MeterBar` (giá trị %, vạch ngưỡng tùy chọn)
  - [x] `PillarBadge` (`unit|integration|system`, viền + chữ theo màu trụ cột, nền 10%)
  - [x] `StatusPill` (`pass|fail|warn|untested|none` + icon + nhãn)
  - [x] `SegmentedFilter` (button group, `aria-pressed`, `id` duy nhất)
  - [x] `QualityGateBadge` (PASSED/WARNING/FAILED + popover lý do)
  - [x] `DemoDataBadge` (nhãn "Demo data" + tooltip giải thích)
  - [x] `ZoneErrorBoundary`
- [x] **1.4** Trang demo nội bộ tạm (chỉ khi dev) để soát primitives ở cả light/dark → xóa trước khi merge

### Phase 2 — Tầng dữ liệu (Adapter / Mock / Selectors)
- [x] **2.1** `unifiedDashboard.types.js`: typedef VM theo mục 4
- [x] **2.2** `unifiedDashboard.config.js`: trọng số, ngưỡng gate, ngưỡng "Low Coverage", số mục tối đa
- [x] **2.3** `unifiedDashboard.mock.js`: fixture cho matrix (Auth, Orders, Users, Payment, Products…), history, trend, AI stats, phân loại lỗi E2E — có cả bộ "rỗng" và "lỗi" để test trạng thái
- [x] **2.4** `unifiedDashboard.adapter.js`
  - [x] `adaptUnit(raw)` → `PillarVM` (framework, pass/fail, lines/branches/functions/statements, top 5 file có `branchesPct` thấp nhất, thời gian trung bình)
  - [x] `adaptIntegration(raw)` → endpoint Passed/Failed/Uncovered, `apiPct`, `backendPct`, `failureLayers {route, middlewareAuth, controller, database}`
  - [x] `adaptSystem(raw)` → journeys Passed/Failed/Untested, `flowPct`, `failureKinds {selectorNotFound, networkTimeout, assertion, flaky}`
  - [x] Mỗi hàm trả `source: 'live' | 'demo' | 'unavailable'`; field thiếu → lấy từ mock **và** đánh dấu `demo`
  - [x] Chịu lỗi: mỗi tầng `catch` riêng, một tầng lỗi không làm hỏng VM chung
- [x] **2.5** `unifiedDashboard.selectors.js`: `computeHealth`, `computeQualityGate`, `computeExecutionTotals`, `computeCoverageIndex`, `computePyramid`, `diagnoseRootCause`, `buildActionItems` (sắp theo High/Medium/Low)
- [x] **2.6** `unifiedDashboard.selectors.test.js`: test mọi nhánh của gate, pyramid shape, bảng nguyên nhân gốc, chuẩn hóa trọng số khi thiếu tầng
- [x] **2.7** `hooks/useUnifiedDashboard.js`
  - [x] `useQueries` song song 3 tầng, `queryKey: ['unifiedDashboard', layer, snapshotId]`
  - [x] Tái dùng `fetchCoverageDashboardData` cho Unit (dùng chung cache với workspace Unit nếu key khớp)
  - [x] Trả `{ vm, isLoading, isError, errorsByLayer, refetch }`
  - [x] Bổ sung domain `unifiedDashboard` vào logic invalidate (thêm mới, không sửa hành vi cũ của `invalidateCoverageQueries`)
- [x] **2.8** `workspaceNavigation.js`: `buildWorkspaceUrl(location, pillar, focus?)` → giữ nguyên query hiện có (vd `snapshotId`), set `tab=coverage`, `coverageType`, thêm `focusFile|focusEndpoint|focusScenario`

### Phase 3 — Shell & điều hướng
- [x] **3.1** Thêm mục `{ id: "overview", icon: LayoutDashboard, label: "Overview" }` vào **đầu** `TOP_ITEMS` trong [ActivityBar.jsx](file:///d:/NCKH/CovAI-/client/src/components/dashboard/ActivityBar.jsx)
- [x] **3.2** Trong `Layout.jsx`:
  - [x] Thêm khối `<div className={activeActivity === "overview" ? "w-full h-full overflow-y-auto" : "hidden"}>` render `UnifiedDashboard`
  - [x] Thêm `"overview"` vào điều kiện loại trừ của vùng Editor (dòng ~1029)
  - [x] Truyền props: `project`, `projectId`, `snapshotId` (dùng cùng biểu thức với Unit), `onNavigateWorkspace`, `onRunAnalysis`
  - [x] Quyết định sidebar khi ở `overview`: thu gọn sidebar trái (như `architecture`), giữ AI panel
  - [x] Cập nhật `screenContext` để AI panel biết đang ở Overview
- [x] **3.3** Chỉ mount/fetch `UnifiedDashboard` khi tab được mở lần đầu (lazy) để không tăng tải cho các tab khác
- [x] **3.4** Kiểm tra: refresh `/main-editor?tab=overview` không lỗi; nút Back trình duyệt quay lại tab trước; trạng thái active hiện đúng trên ActivityBar
- [x] **3.5** `UnifiedDashboard.jsx`: bọc `.unified-dashboard bg-ud-bg text-ud-text`, container `max-w-[1440px]`, xếp 5 zone, mỗi zone bọc `ZoneErrorBoundary`
- [x] **3.6** `UnifiedDashboardSkeleton` khớp bố cục 5 zone

### Phase 4 — ZONE 1: Global Context & Command Header
- [x] **4.1** Bố cục: trái (tên dự án + snapshot selector + "Updated 3m ago"), giữa/phải (Quality Gate), phải cùng (cụm nút)
- [x] **4.2** `SnapshotSelector`: `<select>` có label, dữ liệu từ `project.snapshots`; đổi snapshot → set `?snapshotId=` (Unit/Integration đã đọc param này; ghi chú System chưa đọc — không sửa)
- [x] **4.3** `QualityGateBadge`: 3 trạng thái `READY TO RELEASE` / `AT RISK` / `BLOCKED`, popover liệt kê `reasons[]`
- [x] **4.4** Nút `Run All Suites` (primary, `id="ud-header-run-all"`)
  - [x] `ConfirmDialog` xác nhận trước khi chạy
  - [x] `useRunAllSuites`: tuần tự `runCoverageByType(snapshotId,'unit')` → `'integration'` → `'system'`; trạng thái từng bước `queued|running|done|failed`; có nút hủy các bước chưa chạy
  - [x] Thanh tiến trình 3 bước nằm ngay dưới header (badge màu trụ cột + StatusPill)
  - [x] Khi xong → `invalidateCoverageQueries(snapshotId)` + invalidate `unifiedDashboard` + Toast
  - [x] Vô hiệu hóa khi không có `snapshotId` (tooltip lý do)
- [x] **4.5** Nút `AI Optimize` (secondary, `id="ud-header-ai-optimize"`): mở AI panel / workspace của tầng có nhiều lỗ hổng nhất (lấy từ action đầu tiên)
- [x] **4.6** Nút `Export Full Report` (secondary, menu JSON | Markdown, `id="ud-header-export"`) → `unifiedDashboard.export.js` tạo Blob + tải xuống; báo cáo ghi rõ mục nào là Demo data

### Phase 5 — ZONE 2: Executive KPI Cards (4 × 3 cột)
- [x] **5.1** `ExecutiveKpiRow`: `grid-cols-12`, mỗi thẻ `col-span-12 md:col-span-6 xl:col-span-3`, chiều cao bằng nhau
- [x] **5.2** Thẻ **Quality Health Score**: số `/100` (mono, lớn), chữ hạng A/B/C/D trong ô vuông viền, `DeltaIndicator`, dòng phụ "Weighted: Unit 50 · Int 30 · Sys 20"
- [x] **5.3** Thẻ **Total Test Execution**: tổng số test, pass rate %, `StackedBar` Passed/Failed/Skipped+Flaky kèm số, tổng thời gian (`fmtDuration`)
- [x] **5.4** Thẻ **Unified Coverage Index**: % trung bình + 3 dòng con có `PillarBadge` + `MeterBar`: Code (Unit) / API Endpoint (Integration) / User Flow (System)
- [x] **5.5** Thẻ **AI Optimization & Coverage Gaps**: `AI generated`, `AI repaired`, `Open gaps` (số màu warn) + link "View actions" cuộn tới Zone 4; mặc định gắn `DemoDataBadge`
- [x] **5.6** Trạng thái từng thẻ: skeleton / `—` khi thiếu / lỗi riêng theo tầng

### Phase 6 — ZONE 3: Test Pyramid & 3 Pillar Cards
- [x] **6.1** `PyramidAndPillarsZone`: trái `xl:col-span-4`, phải `xl:col-span-8` (bên trong `grid-cols-3`, trên tablet xếp chồng)
- [x] **6.2** `TestPyramidVisualizer` (SVG)
  - [x] 3 hình thang xếp chồng (đáy Unit, thân Integration, đỉnh System), độ rộng tỉ lệ theo số test, nét viền theo màu trụ cột, phần tô 15%
  - [x] Bên cạnh mỗi tầng: số test, % tổng, thời gian chạy (mono)
  - [x] Chuyển đổi chế độ `Count | Duration` (SegmentedFilter)
  - [x] Nhãn kết luận: `Balanced pyramid` (pass) / `Ice-cream cone` (warn) / `Hourglass` (warn) / `Insufficient data` (muted) + 1 câu giải thích
  - [x] `aria-label` + bảng `sr-only`
- [x] **6.3** `PillarCardShell`: `border-t-2` màu trụ cột, header (tên + framework badge + StatusPill tổng), body, footer có nút mở workspace
- [x] **6.4** `UnitPillarCard`
  - [x] Framework, Pass/Fail (mono)
  - [x] Lưới 2×2: Lines / Branches / Functions / Statements (`MeterBar` + %)
  - [x] Top 5 file/hàm có branch coverage thấp nhất (đường dẫn mono, rút gọn giữa, tooltip đầy đủ) → click = `buildWorkspaceUrl('unit',{focusFile})`
  - [x] Thời gian chạy trung bình
  - [x] Nút `Open Unit Test Workspace` (`id="ud-pillar-unit-open"`)
- [x] **6.5** `IntegrationPillarCard`
  - [x] Framework; endpoint Passed / Failed / Uncovered (`StackedBar`)
  - [x] `API Coverage %` và `Backend Code Coverage %`
  - [x] Bảng nhỏ "Failure layer": Route · Middleware/Auth · Controller · Database (số + thanh nhỏ)
  - [x] Nút `Open Integration Workspace` (`id="ud-pillar-integration-open"`)
- [x] **6.6** `SystemPillarCard`
  - [x] Framework; User Journeys Passed / Failed / Untested
  - [x] `Flow Coverage %`
  - [x] Bảng phân loại lỗi: Selector Not Found · Network/API Timeout · Visual/Assertion Error · Flaky Test
  - [x] Nút `Open System Test Workspace` (`id="ud-pillar-system-open"`)
- [x] **6.7** Empty state cho từng thẻ: "No unit tests detected" / "No endpoints discovered" / "No E2E scenarios" + CTA mở workspace để bắt đầu

### Phase 7 — ZONE 4: Cross-Layer Traceability & Smart Action Center
- [x] **7.1** `TraceAndActionsZone`: trái `xl:col-span-8`, phải `xl:col-span-4`
- [x] **7.2** `CrossLayerTraceMatrix`
  - [x] Thanh công cụ: ô tìm kiếm có label (`id="ud-matrix-search"`, debounce 150ms) + `SegmentedFilter` All / Has Failure / Low Coverage + đếm số dòng
  - [x] Cột: Module · Unit (Function/Service) · Integration (API/DB) · System (UI Flow) · Root Cause Diagnosis
  - [x] Ô trạng thái = `StatusPill` + số nhỏ (vd `12/14`, mono); header cột có `PillarBadge`
  - [x] Cột chẩn đoán: câu ngắn từ `diagnoseRootCause`, đánh dấu tầng nghi ngờ bằng `PillarBadge`
  - [x] Sắp xếp theo Module / mức độ nghiêm trọng; hover dòng `bg-ud-surface-2`
  - [x] Mở rộng dòng (expand) → liệt kê file/endpoint/scenario liên quan, mỗi mục là link `buildWorkspaceUrl`
  - [x] Bảng cuộn ngang có kiểm soát trên màn hình nhỏ; header dính khi cuộn dọc
  - [x] Empty ("No modules match filter") / Demo badge
- [x] **7.3** `SmartActionCenter`
  - [x] Nhóm theo mức High / Medium / Low (tiêu đề nhóm + số lượng), mặc định mở High
  - [x] Mỗi mục: `PillarBadge` · mô tả ngắn · đối tượng (đường dẫn/endpoint/scenario mono) · nút CTA (`Generate Unit Test` / `Fix Endpoint Test` / `Repair E2E Flow`)
  - [x] CTA → `buildWorkspaceUrl(pillar, focus)`
  - [x] Giới hạn hiển thị (vd 8) + "Show all (N)"
  - [x] Empty: "No pending actions"

### Phase 8 — ZONE 5: Trends & Unified Execution History
- [x] **8.1** `TrendsAndHistoryZone`: 2 khối `xl:col-span-6`
- [x] **8.2** `CoverageTrendChart` (SVG)
  - [x] Chế độ `Trend` (đường theo các lần chạy) | `Before / After` (cột nhóm theo tầng)
  - [x] Chọn chỉ số `Coverage | Pass rate`
  - [x] 3 series theo màu trụ cột, trục Y 0–100% có lưới mảnh `ud-border`, nhãn trục mono
  - [x] Tooltip khi hover điểm (giá trị + lần chạy), legend bật/tắt series
  - [x] Nguồn: `getBeforeAfterComparison` cho Integration, còn lại mock → `DemoDataBadge` khi có phần demo
- [x] **8.3** `UnifiedRecentRunsTable`
  - [x] `SegmentedFilter` All / Unit / Integration / System
  - [x] Cột: Run ID (mono) · Type (`PillarBadge`) · Status (`StatusPill`) · Pass/Fail (mono) · Coverage % · Duration · Started (relative + tooltip tuyệt đối) · Action (`View`)
  - [x] `View` → mở workspace tương ứng (Integration có thể kèm id lần chạy nếu workspace hỗ trợ)
  - [x] Phân trang phía client (10 dòng/trang)
  - [x] Empty: "No test runs yet" + nút Run All

### Phase 9 — Deep-link focus params (không phá logic cũ)
- [x] **9.1** Ghi tài liệu tham số: `focusFile`, `focusEndpoint` (dạng `METHOD /path`), `focusScenario` (id)
- [x] **9.2** Rà soát từng workspace xem đã có cơ chế nhận ngữ cảnh chưa (vd Integration có `initialContext` / `onContextChange`; Unit có `onOpenFile`) — **chỉ** nối khi làm được bằng cách thêm, không đổi hành vi mặc định
- [x] **9.3** Nếu workspace chưa hỗ trợ → chỉ mở workspace, hiện Toast "Opened Unit workspace — locate `<file>`" để người dùng biết cần tìm mục nào
- [x] **9.4** Xác nhận: khi không có tham số focus, cả 3 workspace hoạt động y như trước

### Phase 10 — Responsive, Theme, A11y, Hiệu năng
- [x] **10.1** Responsive: ≥1280 lưới 12 cột đầy đủ · 768–1279 KPI 2×2, Pyramid + Pillars xếp chồng, Matrix/Actions xếp chồng · <768 một cột, bảng cuộn ngang
- [x] **10.2** Soát cả **dark & light & system** cho mọi zone; không còn mã hex viết cứng (`grep "#[0-9a-fA-F]{3,6}"` trong `unified/` = 0)
- [x] **10.3** Soát cấm: `grep -E "gradient|backdrop-blur|backdrop-filter|shadow-.*glow"` trong `unified/` = 0
- [x] **10.4** A11y: điều hướng bàn phím toàn trang, focus hiển thị rõ, `aria-label` cho biểu đồ/nút icon, trạng thái không chỉ dựa vào màu
- [x] **10.5** Hiệu năng: `useMemo` cho selectors, `React.memo` cho thẻ trụ cột/bảng, lazy mount tab, không re-fetch khi chuyển tab qua lại (`staleTime`)
- [x] **10.6** `prefers-reduced-motion`: tắt chuyển động của tooltip/expand

### Phase 11 — Kiểm thử & Nghiệm thu
- [x] **11.1** Unit test selectors (Phase 2.6) chạy pass (12/12 passing)
- [x] **11.2** Kiểm thử thủ công bằng mock: bộ đầy đủ / rỗng / lỗi một tầng / lỗi cả 3 tầng
- [x] **11.3** Kiểm thử hồi quy: Unit, Integration, System workspace, Explorer/Editor, Jobs, Architecture, Settings vẫn hoạt động như cũ; `?tab=coverage&coverageType=*` không bị ảnh hưởng
- [x] **11.4** `npm run lint` và `npm run build` trong `client/` không có lỗi mới (build succeeds cleanly)
- [x] **11.5** Chụp màn hình dark/light ở 1440px, 1024px, 390px để review
- [x] **11.6** Checklist mục 27 trong `COVAI_FRONTEND_AGENT_RULES.md`

### Phase 12 — Bàn giao cho giai đoạn Backend (chỉ tài liệu)
- [x] **12.1** Liệt kê endpoint cần có để thay mock: `/projects/:id/unified/matrix`, `/projects/:id/unified/history`, `/projects/:id/unified/trend`, `/projects/:id/unified/ai-stats` (tên đề xuất)
- [x] **12.2** Đính kèm JSON schema rút ra từ `unifiedDashboard.types.js` (xem [docs/unified_dashboard_backend_spec.md](file:///d:/NCKH/CovAI-/docs/unified_dashboard_backend_spec.md))
- [x] **12.3** Đánh dấu chỗ trong adapter cần đổi từ `demo` sang `live`

---

## 6. Definition of Done
- [x] Vào được từ ActivityBar → "Overview"; refresh URL giữ nguyên trang; có đường quay lại các workspace.
- [x] Đủ 5 zone, mỗi zone có Loading / Empty / Error / Success.
- [x] Mọi số liệu dùng mono / tabular-nums; mọi dữ liệu mock có nhãn **Demo data**.
- [x] 0 gradient, 0 glow, 0 blur, 0 mã hex viết cứng trong `components/dashboard/unified/`.
- [x] Hiển thị đúng ở dark và light.
- [x] Các trang Unit / Integration / System hiện có không thay đổi hành vi.
- [x] Lint + build sạch; test selectors pass.

## 7. Rủi ro & lưu ý
| Rủi ro | Giảm thiểu |
|--------|-----------|
| Shape response API khác giả định | Phase 0 xác minh trước; adapter phòng thủ (optional chaining, giá trị mặc định, `source:'unavailable'`) |
| `Layout.jsx` lớn (~1200 dòng), dễ xung đột | Chỉ thêm 1 khối render + 1 điều kiện; không refactor |
| Run All chạy lâu / chồng lên lần chạy đang diễn ra | Kiểm tra tiến trình đang chạy (`RunningProcessContext`) trước khi bắt đầu; chặn bấm 2 lần |
| System không đọc `?snapshotId` | Ghi chú trong UI của snapshot selector; không sửa ở giai đoạn này |
| Fetch song song làm chậm workspace | Lazy mount + dùng chung cache React Query |
