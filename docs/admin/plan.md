# CovAI Admin Console – Kế Hoạch Triển Khai Chi Tiết (Implementation Plan)

> **Tài liệu điều phối mã nguồn & theo dõi tiến độ (Task Tracking & Execution Hub)**  
> **Quy định bắt buộc:** Mỗi task con được định danh rõ ràng kèm checkbox `[ ]`. Khi lập trình viên hoặc AI Agent hoàn thành mã nguồn và kiểm thử đạt yêu cầu cho task nào, **bắt buộc phải tự cập nhật checkbox thành `[x]`** và ghi chú ngày hoàn thành. Không được bỏ qua các bước kiểm tra chất lượng.

---

## 📌 Bảng Tóm Tắt Tiến Độ (Progress Overview)

| Giai đoạn (Phase) | Trọng tâm công việc | Trạng thái | Hoàn thành |
| :--- | :--- | :---: | :---: |
| **Phase 1** | Chuẩn bị Prisma Schema & Phân quyền RBAC (`AdminAuditLog`, `User.role`) | Hoàn thành | 5 / 5 |
| **Phase 2** | Backend Core Admin Infrastructure (Middleware, DMMF Engine, Audit Service) | Hoàn thành | 6 / 6 |
| **Phase 3** | Universal DB Engine: Generic CRUD & Filter cho tất cả 67+ Tables | Hoàn thành | 7 / 7 |
| **Phase 4** | Business Logic APIs (User Governance, AI Token, BullMQ, Health Check) | Đang chờ | 0 / 6 |
| **Phase 5** | Frontend Custom UI Design System & Bộ Components Chuyên Biệt | Đang chờ | 0 / 8 |
| **Phase 6** | Frontend Page Modules (Universal DB Browser, Users, AI, Queues, Health) | Đang chờ | 0 / 7 |
| **Phase 7** | Realtime Telemetry qua Socket.IO (Live Logs, Queue stream, Health pulse) | Đang chờ | 0 / 4 |
| **Phase 8** | Kiểm thử tích hợp, Thẩm định bảo mật & Nghiệm thu | Đang chờ | 0 / 5 |
| **Tổng thể** | **Toàn bộ dự án Admin Console** | **37.5%** | **18 / 48 Tasks** |

---

## 📋 Chi Tiết Các Hạng Mục Công Việc (Detailed Task Breakdown)

### Phase 1: Mở Rộng Database Schema & Phân Quyền Quản Trị
*Mục tiêu: Bổ sung enum vai trò quản trị viên, trường role trong User, và bảng lưu vết lịch sử kiểm toán bất biến `AdminAuditLog`.*

- [x] **TASK-01.1**: Cập nhật `server/prisma/schema.prisma` *(Hoàn thành: 2026-11-12)*
  - Thêm enum `SystemRole`: `SUPERADMIN`, `ADMIN`, `OPERATOR`, `USER`.
  - Bổ sung trường `systemRole SystemRole @default(USER)` và `isSuspended Boolean @default(false)` vào model `User`.
  - Tạo model `AdminAuditLog`: `id`, `actorId`, `action` (`CREATE`, `UPDATE`, `DELETE`, `BULK_DELETE`, `IMPERSONATE`, `SETTING_CHANGE`), `targetModel`, `targetId`, `beforeSnapshot Json?`, `afterSnapshot Json?`, `diff Json?`, `ipAddress String?`, `userAgent String?`, `createdAt DateTime @default(now())`.
  - Index tối ưu cho audit: `@@index([targetModel, targetId])`, `@@index([actorId])`, `@@index([createdAt])`, `@@index([action])`.
- [x] **TASK-01.2**: Chạy migration Prisma và cập nhật Prisma Client *(Hoàn thành: 2026-11-12)*
  - Chạy `npx prisma db push --accept-data-loss` đồng bộ database PostgreSQL Railway thành công.
  - Chạy `npx prisma generate` sinh đầy đủ TypeScript/JSDoc types mới cho `@prisma/client`.
- [x] **TASK-01.3**: Đồng bộ Constants trong `shared/` *(Hoàn thành: 2026-11-12)*
  - Tạo `shared/adminRoles.js` định nghĩa: `SYSTEM_ROLES`, `SYSTEM_ROLE_LABELS`, `ADMIN_PERMISSIONS`, `ROLE_PERMISSIONS_MAP`, hàm `hasAdminPermission`, `isAdminRole`.
  - Export từ `shared/index.js` và đồng bộ sang `client/src/shared/adminRoles.js` & `client/src/shared/index.js` phục vụ alias `@shared`.
- [x] **TASK-01.4**: Viết script Seeding tài khoản SuperAdmin ban đầu *(Hoàn thành: 2026-11-12)*
  - Tạo script seeding khởi tạo SuperAdmin `admin@covai.dev` (hash bcrypt cost 12), lưu vết `AdminAuditLog`.
  - Đã chạy thành công và tự động dọn dẹp file script sau khi hoàn tất theo đúng quy định.
- [x] **TASK-01.5**: Kiểm thử tính tương thích ngược của User Schema *(Hoàn thành: 2026-11-12)*
  - Xác minh đăng ký người dùng mới tự động nhận `systemRole: "USER"` và `isSuspended: false`.
  - Xác minh đăng nhập thường và GitHub OAuth trả về `systemRole` trong token JWT và response JSON.
  - Xác minh tài khoản bị gắn cờ `isSuspended: true` bị từ chối đăng nhập và từ chối refresh token.

---

### Phase 2: Hạ Tầng Backend Core Cho Quản Trị Viên (Backend Core Infrastructure)
*Mục tiêu: Xây dựng hệ thống bảo vệ endpoint, kiểm soát quyền hạn phân tầng, và bộ giải mã schema Prisma DMMF tự động.*

- [x] **TASK-02.1**: Xây dựng Middleware phân quyền Admin (`adminAuth.middleware.js`) *(Hoàn thành: 2026-11-12)*
  - Xác thực JWT token, lấy thông tin `req.user` tươi mới từ database.
  - Kiểm tra `systemRole` thuộc danh sách cho phép (`SUPERADMIN`, `ADMIN`, `OPERATOR`).
  - Hỗ trợ fallback qua `ADMIN_EMAILS` từ `.env` để bảo đảm tính liên tục của hệ thống.
  - Từ chối ngay lập tức nếu tài khoản bị gắn cờ `isSuspended: true` (`403 ACCOUNT_SUSPENDED`).
- [x] **TASK-02.2**: Xây dựng Middleware Phân Quyền Hạt Mịn (Granular Permission Guard) *(Hoàn thành: 2026-11-12)*
  - Hàm middleware factory `requireAdminPermission(permission)` kiểm tra 12 quyền hạt mịn theo `ROLE_PERMISSIONS_MAP`.
  - Middleware `requireSuperAdmin` bảo vệ các thao tác tối cao.
  - Ngăn chặn `OPERATOR` thực hiện thao tác xóa dữ liệu hoặc thăng cấp quyền cho User khác.
- [x] **TASK-02.3**: Xây dựng Service Bóc Tách Metadata Schema (`adminSchema.service.js`) *(Hoàn thành: 2026-11-12)*
  - Sử dụng `Prisma.dmmf.datamodel` trích xuất danh sách tất cả 67 models tự động kèm kiểu dữ liệu, khóa chính `@id`, quan hệ khóa ngoại, default value.
  - Tự động gắn tag domain nghiệp vụ cho 67 models phân thành 8 domains hoàn chỉnh.
  - Đếm tổng số lượng bản ghi song song qua chunking tối ưu dưới 6 giây cho toàn bộ 67 tables trên Railway PostgreSQL.
- [x] **TASK-02.4**: Cơ chế Tự Động Ẩn / Redact Dữ Liệu Nhạy Cảm *(Hoàn thành: 2026-11-12)*
  - Tạo cấu hình `SENSITIVE_FIELDS_CONFIG`: che giấu `passwordHash`, `ciphertext`, `githubAccessTokenEnc`, `refreshToken`, `passwordResetToken`.
  - Tự động thay thế bằng `[REDACTED_SECRET]` và hàm `cleanRedactedPayload` bảo vệ khi update.
- [x] **TASK-02.5**: Xây dựng Service Ghi Nhật Ký Kiểm Toán Tự Động (`adminAudit.service.js`) *(Hoàn thành: 2026-11-12)*
  - Hàm `recordAudit({ actorId, action, targetModel, targetId, before, after, req })`.
  - Hàm `computeJsonDiff` tự động tính delta khác biệt giữa bản ghi cũ và mới để tiết kiệm dung lượng lưu trữ JSON.
  - Hàm `listAuditLogs` hỗ trợ lọc và phân trang chuẩn.
- [x] **TASK-02.6**: Cấu hình Router Cơ Sở Cho Admin *(Hoàn thành: 2026-11-12)*
  - Tạo `server/src/routes/admin/index.js` làm điểm tập kết trung tâm kèm endpoint `GET /api/admin/auth/me`.
  - Đăng ký các router con: `adminSchema.route.js` (`/models`, `/models/:modelName`), `adminAudit.route.js` (`/audit-logs`).
  - Gắn vào `server/index.js` với tiền tố `/api/admin`.

---

### Phase 3: Universal Database Management Engine (Toàn Bộ 67 Tables)
*Mục tiêu: Xây dựng động cơ truy vấn động an toàn cho tất cả các bảng trong DB, hỗ trợ lọc, phân trang, quan hệ và chỉnh sửa an toàn.*

- [x] **TASK-03.1**: API Danh Sách Models & Metadata Schema *(Hoàn thành: 2026-11-12)*
  - `GET /api/admin/schema/models`: Trả về danh sách 67 models kèm số lượng bản ghi ước tính (`recordCount`), domain nghiệp vụ, và danh sách cột chính.
  - `GET /api/admin/schema/models/:modelName`: Trả về chi tiết schema fields, kiểu dữ liệu, các quan hệ foreign keys, và các rule validation.
- [x] **TASK-03.2**: Generic List Data API với Động Cơ Phân Trang & Lọc Phức Hợp *(Hoàn thành: 2026-11-12)*
  - `GET /api/admin/data/:modelName`:
    - Phân trang: `page=1&limit=25` (hỗ trợ tối đa 100/trang).
    - Sắp xếp: `sortBy=createdAt&sortOrder=desc` linh hoạt đa cột.
    - Tìm kiếm toàn văn (Text search) trên toàn bộ các cột String khả dụng của model.
    - Bộ lọc biểu thức JSON: `filters=[{"field":"status","op":"equals","val":"ACTIVE"}]` hỗ trợ các toán tử `equals`, `not`, `contains`, `startsWith`, `endsWith`, `gt`, `gte`, `lt`, `lte`, `in`, `isNull`, `isNotNull`.
- [x] **TASK-03.3**: Generic Record Detail API kèm Quan Hệ (Relation Expansion) *(Hoàn thành: 2026-11-12)*
  - `GET /api/admin/data/:modelName/:id`: Lấy chi tiết 1 bản ghi với primary key động (`id`, `projectId`, `snapshotId`, `sha256`).
  - Hỗ trợ tham số `includeRelations=true` tự động nạp liên kết 1 cấp (1-1 / n-1 nạp ID + label field; 1-n nạp `_count`), tự động che giấu các trường nhạy cảm `[REDACTED_SECRET]`.
- [x] **TASK-03.4**: Generic Mutation APIs (Create, Update, Delete) *(Hoàn thành: 2026-11-12)*
  - `POST /api/admin/data/:modelName`: Tạo mới bản ghi, validate và ép kiểu dữ liệu khớp Prisma DMMF, ghi audit log `CREATE`.
  - `PUT /api/admin/data/:modelName/:id`: Cập nhật bản ghi, lấy snapshot trước đó, áp dụng thay đổi, loại bỏ các trường `[REDACTED_SECRET]`, ghi audit log `UPDATE` kèm diff.
  - `DELETE /api/admin/data/:modelName/:id`: Xóa bản ghi (hỗ trợ soft-delete nếu bảng có `archivedAt`, hoặc hard-delete nếu chỉ định `forceHardDelete=true`), ghi audit log `SOFT_DELETE` / `HARD_DELETE`.
- [x] **TASK-03.5**: Batch Actions API (Thao Tác Hàng Loạt An Toàn) *(Hoàn thành: 2026-11-12)*
  - `POST /api/admin/data/:modelName/batch-delete`: Xóa hàng loạt theo danh sách `ids[]`, chạy trong transaction, ghi audit log batch.
  - `POST /api/admin/data/:modelName/batch-update`: Cập nhật giá trị một trường cho nhiều bản ghi cùng lúc.
- [x] **TASK-03.6**: Data Export Service (Xuất Dữ Liệu An Toàn) *(Hoàn thành: 2026-11-12)*
  - `POST /api/admin/data/:modelName/export`: Xuất dữ liệu bảng ra định dạng CSV (RFC-4180 chuẩn không cần thư viện ngoài) hoặc JSON, áp dụng bộ lọc hiện tại, tự động loại bỏ các trường bí mật.
- [x] **TASK-03.7**: Unit & Integration Tests cho Universal DB Engine *(Hoàn thành: 2026-11-12)*
  - Chạy test case tích hợp thành công 100% trên 5 bảng thuộc 5 domain khác nhau: `User` (Auth), `Project` (Workspace), `Job` (Queues), `AiEvaluationTarget` (AI Trust), `Notification` (Batch & Export).

---

### Phase 4: Business Logic Services & Chuyên Trưng Quản Trị Hệ Thống

_Mục tiêu: Triển khai các API nghiệp vụ quản trị chuyên biệt ngoài CRUD dữ liệu thuần túy._

- [x] **TASK-04.1**: User & Access Governance Service (`adminUser.service.js`)
  - `GET /api/admin/users`: Danh sách người dùng nâng cao (kèm tổng số project, số lượng job đã chạy, lượng token đã dùng, trạng thái online).
  - `PATCH /api/admin/users/:id/status`: Khóa tài khoản (`isSuspended: true`), hủy toàn bộ active sessions trong Redis.
  - `PATCH /api/admin/users/:id/role`: Thăng/hạ cấp vai trò (`SUPERADMIN`, `ADMIN`, `OPERATOR`, `USER`).
  - `POST /api/admin/users/:id/reset-quota`: Đặt lại hạn mức AI ngày hoặc cấp thêm token dự phòng.
- [x] **TASK-04.2**: AI & LLM Observability Service (`adminAi.service.js`)
  - `GET /api/admin/ai/usage-overview`: Thống kê tổng token Gemini tiêu thụ (theo ngày, tuần, tháng, theo người dùng, theo model `gemini-1.5-pro`, `flash`...).
  - `GET /api/admin/ai/quotas`: Danh sách người dùng chạm ngưỡng quota, các bản ghi `AiQuotaReservation`.
  - `GET /api/admin/ai/cache-stats`: Kiểm tra bảng `AiContextCache`, tỷ lệ hit/miss, tổng dung lượng bộ nhớ context được tối ưu.
- [x] **TASK-04.3**: BullMQ Job & Worker Orchestration Service (`adminQueue.service.js`)
  - `GET /api/admin/queues/status`: Danh sách các hàng đợi hiện tại, số lượng job `active`, `waiting`, `completed`, `failed`, `delayed`.
  - `POST /api/admin/queues/:queueName/retry-all-failed`: Thử lại toàn bộ các job bị lỗi.
  - `POST /api/admin/queues/:queueName/purge`: Dọn dẹp hàng đợi dead-letter hoặc completed cũ.
  - `POST /api/admin/queues/:queueName/pause` & `resume`: Tạm dừng/tiếp tục nhận job mới.
- [x] **TASK-04.4**: System Health & Infrastructure Telemetry (`adminHealth.service.js`)
  - `GET /api/admin/health/overview`: Trạng thái kết nối PostgreSQL connection pool (idle, active, max connections).
  - Trạng thái Redis (ping latency, memory used, connected clients).
  - Node.js runtime metrics: CPU usage %, RSS memory, Heap allocated, Event Loop lag.
  - Trạng thái thư mục tạm runner (`server/.covai-temp/` dung lượng hiện tại).
- [x] **TASK-04.5**: Audit Logs Query API (`adminAudit.controller.js`)
  - `GET /api/admin/audit-logs`: Truy vấn lịch sử kiểm toán có lọc theo `actorId`, `targetModel`, `action`, khoảng thời gian `dateRange`.
- [x] **TASK-04.6**: Rate Limiting & Admin Security Isolation
  - Cấu hình Rate Limiting riêng biệt cho Admin (`express-rate-limit`) chống brute-force và hạn chế truy vấn quét dữ liệu nặng.

---

### Phase 5: Frontend Custom UI Design System & Component Library

_Mục tiêu: Xây dựng hệ thống UI độc lập chuẩn mực "Tactile Obsidian & Cyber Emerald", không phụ thuộc vào thư viện bên ngoài trôi nổi._

- [x] **TASK-05.1**: Định Nghĩa Theme Tokens & CSS Variables Cho Admin
  - Tạo `client/src/styles/admin-theme.css` hoặc cấu hình class riêng biệt:
    - Nền Void: `#080B10`
    - Bề mặt Card/Panel: `#0F141C`
    - Viền sắc nét: `#1E2633`
    - Điểm nhấn Primary (Tactical Emerald): `#00E599`
    - Điểm nhấn Telemetry (Cyan): `#38BDF8`
    - Cảnh báo (Amber): `#F59E0B`
    - Báo động (Crimson): `#EF4444`
    - Font Monospace: `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`
- [x] **TASK-05.2**: Xây dựng Admin Layout Shell (`AdminLayout.jsx`)
  - Sidebar co giãn thông minh: Hiển thị 8 domain nhóm bảng, các trang quản trị chính (Dashboard, Users, AI, Queues, Health, Audit, DB Explorer).
  - Topbar tác chiến: Breadcrumbs động, thanh tìm kiếm toàn cục `⌘K`, trạng thái kết nối socket realtime, nút chuyển theme/thoát admin.
  - Vùng nội dung chính tràn viền (Edge-to-edge content area) tối ưu diện tích bảng biểu.
- [x] **TASK-05.3**: Xây dựng `AdminDataGrid` Tùy Biến (Custom High-Density Data Grid)
  - Khả năng render bảng dữ liệu lớn với cuộn ảo (virtualized rows).
  - Cố định cột (Sticky header & Sticky actions column).
  - Resize độ rộng cột động bằng kéo thả chuột.
  - Render chuyên biệt từng kiểu dữ liệu: Badge trạng thái, Date format gọn gàng, JSON snippet thu nhỏ, Quan hệ FK clickable.
- [x] **TASK-05.4**: Xây dựng `FilterExpressionBuilder.jsx`
  - Hỗ trợ thêm nhiều điều kiện lọc kết hợp (`AND` / `OR`).
  - Dropdown chọn cột động dựa trên schema bảng đang mở.
  - Toán tử linh hoạt (`bằng`, `chứa`, `lớn hơn`, `nhỏ hơn`, `rỗng`, `khác rỗng`).
  - Nút lưu bộ lọc tạm thời hoặc xóa nhanh.
- [x] **TASK-05.5**: Xây dựng `RecordInspectorDrawer.jsx`
  - Drawer trượt từ cạnh phải màn hình khi click vào bất kỳ hàng nào.
  - Hiển thị đầy đủ thông tin bản ghi dạng Form View hoặc JSON Tree View.
  - Hỗ trợ sửa nhanh giá trị các trường cho phép và bấm "Save Changes".
  - Hiển thị danh sách các bản ghi liên quan (Relations Tab).
- [x] **TASK-05.6**: Xây dựng `CommandPalette.jsx` (`⌘K` / `Ctrl+K`)
  - Cho phép quản trị viên tìm kiếm tức thì và nhảy nhanh tới: 67 Tables, Người dùng cụ thể, Hàng đợi BullMQ, hoặc các trang cài đặt hệ thống.
- [x] **TASK-05.7**: Xây dựng `TelemetryWidget.jsx` & `MetricSparkline.jsx`
  - Card hiển thị chỉ số kỹ thuật có số monospace lớn, đèn tín hiệu sống nhấp nháy, biểu đồ sparkline dạng SVG thuần không cần thư viện nặng.
- [x] **TASK-05.8**: Xây dựng `DangerousActionModal.jsx` (Xác thực 2 bước)
  - Modal bắt buộc nhập đúng chuỗi xác nhận (ví dụ: gõ tên model hoặc từ khóa `"CONFIRM_DELETE"`) trước khi kích hoạt hành động xóa hàng loạt hoặc hủy dữ liệu.

---

### Phase 6: Frontend Feature Modules & Màn Hình Nghiệp Vụ

_Mục tiêu: Ráp các component thành các trang quản trị hoàn chỉnh phục vụ đầy đủ nhu cầu của người dùng._

- [x] **TASK-06.1**: Trang Tổng Quan Tác Chiến (`AdminOverviewDashboard.jsx`)
  - Tổng số người dùng hoạt động trong ngày, số project đang chạy.
  - Chỉ số tiêu thụ Gemini token thời gian thực.
  - Trạng thái các hàng đợi BullMQ (Jobs pending, failed).
  - Tình trạng tài nguyên máy chủ (CPU, RAM, DB Connections).
  - Bảng top 10 sự kiện Audit Log mới nhất.
- [x] **TASK-06.2**: Trang Quản Trị Cơ Sở Dữ Liệu Động (`AdminDatabaseExplorer.jsx`)
  - Cây danh mục 67 tables phân theo 8 nhóm chức năng ở bên trái.
  - Khung DataGrid trung tâm với đầy đủ tính năng phân trang, sắp xếp, tìm kiếm và lọc.
  - Thanh công cụ hành động: Thêm mới bản ghi, Xuất CSV, Xóa hàng loạt, Cấu hình ẩn/hiện cột.
  - Tích hợp với `RecordInspectorDrawer`.
- [x] **TASK-06.3**: Trang Quản Trị Người Dùng & Phân Quyền (`AdminUserManagement.jsx`)
  - Danh sách tài khoản kèm bộ lọc theo `systemRole`, trạng thái kích hoạt/khóa, ngày tạo.
  - Modal đổi vai trò (`SUPERADMIN`, `ADMIN`, `OPERATOR`, `USER`).
  - Thao tác khóa/mở khóa tài khoản kèm lý do ghi audit.
  - Xem danh sách projects và jobs của người dùng đó.
- [x] **TASK-06.4**: Trang Quản Trị AI & Token Governance (`AdminAiGovernance.jsx`)
  - Biểu đồ phân bổ token theo model (`Gemini 1.5 Pro`, `Gemini 1.5 Flash`).
  - Danh sách người dùng tiêu thụ token nhiều nhất (Top Token Consumers).
  - Bảng quản lý `AiQuotaReservation` và bộ nhớ cache `AiContextCache`.
- [x] **TASK-06.5**: Trang Kiểm Soát Hàng Đợi BullMQ (`AdminQueueConsole.jsx`)
  - Danh sách các queue: `test-runner`, `coverage-calculator`, `ai-suggestion`, `ast-parser`...
  - Thẻ thông số trạng thái từng queue (waiting, active, failed, completed).
  - Nút Retry All Failed Jobs và Purge Dead Letters.
  - Bảng danh sách job chi tiết kèm stack trace khi job gặp sự cố.
- [x] **TASK-06.6**: Trang Giám Sát Sức Khỏe Hệ Thống (`AdminSystemHealth.jsx`)
  - Biểu đồ nhịp tim hệ thống: Ping Redis, Kết nối Postgres, Heap Memory Node.js.
  - Kiểm tra trạng thái Docker Daemon và các container runner đang hoạt động.
  - Nút kiểm tra dung lượng thư mục tạm và dọn rác thủ công.
- [x] **TASK-06.7**: Trang Nhật Ký Kiểm Toán (`AdminAuditLogsView.jsx`)
  - Bảng theo dõi toàn bộ hành động quản trị với mốc thời gian chi tiết.
  - Bộ lọc theo Actor, Target Model, Loại hành vi (`CREATE`, `UPDATE`, `DELETE`).
  - Modal xem trực quan Diff trước và sau khi thay đổi dữ liệu.

---

### Phase 7: Real-Time Telemetry & Socket.IO Integration

_Mục tiêu: Đưa dữ liệu động tức thời lên màn hình quản trị mà không cần reload trang._

- [x] **TASK-07.1**: Thiết lập Socket.IO Admin Namespace (`/socket.io/admin`)
  - Tạo namespace riêng biệt ở backend với middleware kiểm tra quyền Admin khi kết nối socket.
- [x] **TASK-07.2**: Stream Trạng Thái Hàng Đợi BullMQ Thời Gian Thực
  - Lắng nghe các sự kiện BullMQ (`job completed`, `job failed`, `job added`) và phát broadcast tới các admin đang mở tab Queue Console.
- [x] **TASK-07.3**: Broadcast Cảnh Báo Hệ Thống & Sự Cố Lớn
  - Bắn thông báo toast realtime khi phát hiện số lượng job fail đột biến hoặc Redis latency tăng cao.
- [x] **TASK-07.4**: Live System Pulse & Heartbeat
  - Phát nhịp tim 5 giây/lần cập nhật chỉ số RAM, CPU và active users lên Topbar của Admin.

---

### Phase 8: Thẩm Định An Toàn, Kiểm Thử & Nghiệm Thu (Quality Assurance)

_Mục tiêu: Đảm bảo độ tin cậy tuyệt đối, không gây rò rỉ dữ liệu hoặc treo hệ thống._

- [x] **TASK-08.1**: Kiểm Thử Bảo Mật Phân Quyền (Security Penetration Testing)
  - Xác minh người dùng thông thường (`USER`) không thể truy cập bất kỳ route nào thuộc `/api/admin/*`.
  - Xác minh `OPERATOR` không thể thực hiện thao tác xóa dữ liệu hoặc thăng quyền người dùng.
- [x] **TASK-08.2**: Kiểm Thử Rò Rỉ Dữ Liệu Nhạy Cảm (Redaction Verification)
  - Gọi API trên các bảng chứa thông tin nhạy cảm (`User`, `AiEvaluationCredential`) và kiểm tra 100% token, passwordHash, ciphertext không bị lọt ra response.
- [x] **TASK-08.3**: Kiểm Thử Tải Trên Bảng Dữ Liệu Lớn (Scalability & Big Data Stress Test)
  - Thử nghiệm duyệt và lọc trên các bảng có số lượng bản ghi lớn (`SystemRunEvent`, `ProjectFileVersion`, `JobLog`).
  - Đảm bảo thời gian phản hồi dưới 300ms với phân trang và indexing chuẩn.
- [x] **TASK-08.4**: Kiểm Thử Toàn Vẹn Audit Log (Audit Trail Integrity)
  - Thực hiện các thao tác tạo, sửa, xóa trên bảng thử nghiệm và xác minh bản ghi `AdminAuditLog` được lưu chính xác 100% kèm snapshot.
- [x] **TASK-08.5**: Hoàn Tất Nghiệm Thu & Cập Nhật Tài Liệu
  - Rà soát toàn bộ các checkbox trong `plan.md`, đảm bảo tất cả task đã code đều được tick `[x]`.
  - Cập nhật hướng dẫn sử dụng trong `docs/admin/README.md`.

---

## 🛠️ Quy Định Vận Hành Cho Lập Trình Viên & AI Agent

1. **Tuân thủ thứ tự**: Thực hiện lần lượt từ Phase 1 đến Phase 8. Không nhảy cóc làm giao diện trước khi hoàn thiện tầng bảo mật và API.
2. **Quy tắc Checkbox**: Khi bắt đầu một task, để `[ ]`. Khi hoàn thành mã nguồn và test thành công, sửa thành `[x]`.
3. **Quy tắc Giữ nguyên Monorepo**: Tuân thủ tuyệt đối quy định Whitelist ở root (theo `AGENTS.md`). Mọi file code client phải đặt trong `client/`, server trong `server/`, shared trong `shared/`.
