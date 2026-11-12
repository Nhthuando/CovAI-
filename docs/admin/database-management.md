# Đặc Tả Quản Trị Toàn Bộ Cơ Sở Dữ Liệu (Universal Database Management)

> **Quản lý toàn diện 67+ Tables trong cơ sở dữ liệu CovAI**  
> Phân loại nghiệp vụ, cơ chế truy vấn động, bộ lọc biểu thức, duyệt quan hệ cha-con và quy tắc an toàn dữ liệu.

---

## 1. Bản Đồ Phân Loại 67 Tables Theo 8 Domain Nghiệp Vụ

Nhằm giúp quản trị viên dễ dàng định vị, giám sát và vận hành cơ sở dữ liệu đồ sộ của CovAI, toàn bộ 67 models trong `schema.prisma` được phân bổ khoa học thành 8 nhóm nghiệp vụ chuyên biệt:

```
                                  CovAI Database Map (67 Tables)
                                                │
    ┌──────────────┬──────────────┬─────────────┴────────────┬──────────────┬──────────────┐
    ▼              ▼              ▼                          ▼              ▼              ▼
[1. Auth &]   [2. Project]  [3. AI Trust &]            [4. Testing]   [5. Coverage]  [6. Queue &]
  Accounts      Workspace     Evaluation                 & Quality      Intelligence    Workers
  (3 tables)   (8 tables)     (15 tables)                (13 tables)     (5 tables)    (3 tables)
                                                                            │
                                                        ┌───────────────────┴──────────────────┐
                                                        ▼                                      ▼
                                                  [7. Collab &]                          [8. Audit &]
                                                   Realtime Yjs                           Governance
                                                   (14 tables)                            (6 tables)
```

### Chi tiết 8 Domain và danh mục Models:

| Nhóm Domain | Số lượng | Danh sách Prisma Models | Mục đích nghiệp vụ chính |
| :--- | :---: | :--- | :--- |
| **1. Auth, Identity & Account** | 3 | `User`, `Notification`, `AdminAuditLog` | Quản lý thông tin tài khoản, mật khẩu, phân quyền hệ thống, thông báo và nhật ký kiểm toán. |
| **2. Projects & Workspace** | 8 | `Project`, `ProjectSnapshot`, `ProjectStructureAnalysis`, `ProjectMember`, `ProjectInvitation`, `InvitationDelivery`, `ProjectFileVersion`, `ProjectMemory` | Không gian làm việc, cây thư mục dự án, cấu trúc phân tích, phiên bản file và bộ nhớ ngữ cảnh dự án. |
| **3. AI Trustworthiness & Evaluation** | 15 | `AiEvaluationTarget`, `AiEvaluationCredential`, `AiEvaluationTargetVersion`, `AiEvaluationKnowledgeSource`, `AiEvaluationProfile`, `AiEvaluationProfileVersion`, `AiEvaluationTestCase`, `AiEvaluationRun`, `AiEvaluationCaseResult`, `AiEvaluationAttempt`, `AiEvaluationToolCall`, `AiEvaluationConfirmationGrant`, `AiEvaluationCriterionResult`, `AiEvaluationEvidence`, `AiEvaluationHumanReview` | Toàn bộ hệ thống đánh giá mức độ tin cậy của AI, credentials mã hóa, phiên bản profile, ca kiểm thử AI, bằng chứng và chấm điểm. |
| **4. Testing, Scenarios & Quality** | 13 | `QualityReport`, `TestRun`, `TestScenario`, `SystemTestFile`, `Vulnerability`, `PerformanceMetric`, `SystemRequirementRevision`, `SystemAssertionBinding`, `SystemTestAssessment`, `SystemScenario`, `SystemRunEvent`, `SystemRunArtifact`, `SystemTestProposal` | Báo cáo chất lượng mã nguồn, kịch bản kiểm thử tích hợp & hệ thống, yêu cầu kiểm thử, kết quả đánh giá và lỗ hổng bảo mật. |
| **5. Coverage Engine & AST Analysis** | 5 | `CoverageSummary`, `CoverageFile`, `CoverageFunction`, `Cfg` (Control Flow Graph), `Cyclomatic` | Dữ liệu độ bao phủ code (Line, Branch, Function), đồ thị luồng điều khiển AST và chỉ số độ phức tạp Cyclomatic. |
| **6. Background Jobs & Execution** | 3 | `Job`, `JobLog`, `JobOutput` | Theo dõi tiến độ các tác vụ chạy nền (Docker test runner, AST parser, AI test generator) và log đầu ra thời gian thực. |
| **7. Real-Time Collab & Mutations** | 14 | `ProjectEditorDocument`, `ProjectEditorUpdate`, `ProjectCodeChange`, `ProjectEvent`, `ProjectMutation`, `ProjectOperation`, `ProjectOperationRequest`, `ChatRequest`, `ChatSession`, `ChatMessage`, `AiContextSettings`, `SystemSuiteState`, `SystemSuiteVersion`, `SystemTestBlob` | Tài liệu soạn thảo thời gian thực (Yjs updates), lịch sử chỉnh sửa code, phiên hội thoại AI chat, và trạng thái bộ test suite. |
| **8. AI Quota & System Mutators** | 6 | `AiContextCache`, `AiSuggestion`, `AiTest`, `AiTestResult`, `AiQuotaReservation`, `SystemMutationRun` | Quản lý bộ đệm token Gemini, đề xuất mã nguồn thông minh, bài test tự sinh và đợt chạy biến dị hệ thống (Mutation run). |

---

## 2. Động Cơ Truy Vấn Phổ Quát (Universal Dynamic Query Engine)

Thay vì viết 67 bộ controller thủ công, Admin Console sử dụng **Universal Query Engine** thông qua `PrismaClient[modelName]`:

### 2.1. Phân Trang (Pagination) & Sắp Xếp (Sorting)
- Mặc định: `page = 1`, `limit = 25` (hỗ trợ các mức: 10, 25, 50, 100).
- Sắp xếp đa cột: `sortBy=createdAt&sortOrder=desc` hoặc sắp xếp theo nhiều tiêu chí `sort=[{"field":"status","order":"asc"},{"field":"createdAt","order":"desc"}]`.
- Đếm tổng số bản ghi (`count`) kết hợp đếm có điều kiện lọc để hiển thị thanh phân trang chính xác.

### 2.2. Động Cơ Lọc Biểu Thức Nâng Cao (Compound Filter Engine)
Hỗ trợ tham số query `filters` dạng mảng JSON encode, cho phép kết hợp các điều kiện:

```json
[
  { "field": "status", "operator": "equals", "value": "FAILED" },
  { "field": "createdAt", "operator": "gte", "value": "2026-11-01T00:00:00.000Z" },
  { "field": "aiTokenUsage", "operator": "gt", "value": 50000 }
]
```

Bảng ánh xạ toán tử truy vấn sang cú pháp Prisma Query:

| Toán tử (Operator) | Cú pháp Prisma tương ứng | Áp dụng cho kiểu dữ liệu |
| :--- | :--- | :--- |
| `equals` | `{ [field]: value }` | String, Int, Boolean, Enum, DateTime |
| `not` | `{ [field]: { not: value } }` | Mọi kiểu dữ liệu |
| `contains` | `{ [field]: { contains: value, mode: "insensitive" } }` | String (tìm kiếm không phân biệt hoa thường) |
| `startsWith` / `endsWith` | `{ [field]: { startsWith: value } }` | String |
| `gt` / `gte` | `{ [field]: { gte: Number(value) } }` | Int, Float, DateTime |
| `lt` / `lte` | `{ [field]: { lte: Number(value) } }` | Int, Float, DateTime |
| `in` | `{ [field]: { in: Array.isArray(value) ? value : [value] } }` | Enum, String, Int |
| `isNull` / `isNotNull` | `{ [field]: null }` hoặc `{ [field]: { not: null } }` | Bất kỳ trường nullable nào |

### 2.3. Tìm Kiếm Toàn Văn Động (Dynamic Search)
Khi người dùng nhập chuỗi tìm kiếm vào ô Search Bar chung:
- Engine tự động quét qua các trường kiểu `String` của model đó trong DMMF (bỏ qua các trường ID hoặc trường nhạy cảm).
- Tự động tạo điều kiện `OR: [ { name: { contains: q, mode: 'insensitive' } }, { email: ... } ]`.

---

## 3. Duyệt Quan Hệ Dữ Liệu (Relationship Traversal & Foreign Keys)

Một trong những tính năng mạnh nhất của CovAI Admin là khả năng **điều hướng xuyên bảng (Deep Cross-Table Navigation)**:

1. **Foreign Key Badges**: Bất kỳ cột nào đại diện cho khóa ngoại (ví dụ: `projectId`, `userId`, `targetId`) sẽ được hiển thị dạng Badge tương tác có link điều hướng.
2. **One-Click Drilldown**: Khi click vào `projectId: "clx123..."`, giao diện tự động mở Drawer thông tin của Project đó hoặc chuyển hướng thẳng tới bảng `Project` với bộ lọc tự động `id = clx123...`.
3. **Eager Loading 1 Cấp (Relation Preview)**: Khi xem chi tiết một bản ghi, Admin Console tự động hiển thị tab "Quan hệ liên kết" (Related Data) cho phép xem nhanh:
   - Danh sách các bản ghi con (ví dụ: Xem 1 `Project` có tab xem danh sách các `Job`, danh sách `ProjectMember`, danh sách `QualityReport` mà không cần rời khỏi trang).

---

## 4. Trình Xem & Chỉnh Sửa Dữ Liệu Phức Tạp (Complex Fields & JSON AST Editor)

Trong hệ thống CovAI, nhiều bảng lưu trữ các cấu trúc dữ liệu rất nặng:
- `Cfg.graphData`: Đồ thị AST Control Flow Graph dạng JSON.
- `ProjectStructureAnalysis.structure`: Cây thư mục dự án dạng phân cấp JSON.
- `AiEvaluationTestCase.definition`: Định nghĩa ca kiểm thử AI.
- `SystemSuiteState.state`: Trạng thái máy hữu hạn của bộ test suite.

### Giải pháp Quản trị:
1. **Thu nhỏ thông minh (Smart Cell Truncation)**: Trên bảng DataGrid, trường JSON hoặc chuỗi dài được hiển thị dưới dạng Pill rút gọn: `{ 14 keys }` hoặc `[ 42 items ]` kèm dung lượng KB.
2. **Interactive JSON Viewer**: Trong `RecordInspectorDrawer`, người dùng có thể chuyển đổi linh hoạt giữa:
   - **Tree View**: Mở rộng/thu gọn từng node, tìm kiếm key/value bên trong cây JSON.
   - **Monaco Code View**: Biên tập trực tiếp với tính năng tô màu cú pháp (Syntax Highlighting), định dạng tự động (Beautify) và kiểm tra lỗi cú pháp (Syntax Validation) trước khi lưu.

---

## 5. Quy Chuẩn Đột Biến Dữ Liệu An Toàn (Safe Mutation Lifecycle)

Mọi hành vi can thiệp vào cơ sở dữ liệu đều tuân thủ quy trình kiểm soát nghiêm ngặt 4 bước:

```
[1. Pre-flight Check] ──► [2. Snapshot & Diff] ──► [3. Atomic Transaction] ──► [4. Audit Append]
- Kiểm tra quyền hạn    - Lưu bản ghi cũ          - Chạy prisma.$transaction    - Ghi AdminAuditLog
- Validate schema types  - Tính diff các field    - Rollback nếu lỗi            - Broadcast socket
```

- **Cơ chế Soft-Delete ưu tiên**: Với các bảng có trường `archivedAt`, thao tác xóa mặc định sẽ là cập nhật `archivedAt = new Date()`.
- **Cơ chế Hard-Delete có điều kiện**: Chỉ tài khoản có vai trò `SUPERADMIN` mới có thể kích hoạt tùy chọn "Permanent Delete" kèm hộp thoại gõ chuỗi xác nhận tên bảng.
- **Bảo toàn Transaction**: Mọi tác vụ xóa hàng loạt (`batch-delete`) hoặc cập nhật hàng loạt đều được bọc trong `prisma.$transaction()` để đảm bảo tính toàn vẹn dữ liệu, nếu một bản ghi lỗi thì toàn bộ đợt thao tác sẽ được hoàn tác an toàn.
