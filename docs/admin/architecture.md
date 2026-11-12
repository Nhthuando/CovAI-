# Kiến Trúc Hệ Thống CovAI Admin Console (System Architecture)

> **Tài liệu đặc tả kiến trúc kỹ thuật cấp cao (High-Level Technical Architecture)**  
> Thiết kế module, luồng dữ liệu, ranh giới an toàn và cơ chế vận hành của phân hệ Quản trị CovAI.

---

## 1. Sơ Đồ Kiến Trúc Tổng Thể (High-Level Architecture)

Hệ thống CovAI Admin Console được thiết kế theo mô hình **Độc lập Tương hỗ (Decoupled Co-existence)**, dùng chung cơ sở hạ tầng cơ sở dữ liệu và hàng đợi của CovAI nhưng vận hành trên ranh giới bảo mật và tuyến giao diện (Admin UI/Route) hoàn toàn tách biệt:

```
+-----------------------------------------------------------------------------------+
|                           CovAI Admin Control Plane                               |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |             Admin Web Client (Tactical Obsidian & Cyber Emerald)            |  |
|  |  [Dashboard] [67 Tables DB Explorer] [Users] [AI Token] [BullMQ] [Audit]    |  |
|  |  - High-Density DataGrid        - Filter Expression Builder                 |  |
|  |  - Record Inspector Drawer      - Command Palette (⌘K)                      |  |
|  +-----------------------------------------------------------------------------+  |
|                                     │                                             |
|                   REST API (HTTPS)  │  WebSocket (Telemetry Stream)              |
|                                     ▼                                             |
|  +-----------------------------------------------------------------------------+  |
|  |                        Express Backend (Admin Subsystem)                    |  |
|  |                                                                             |  |
|  |  [Admin Auth & RBAC Middleware] ───► [Rate Limiter & Audit Logger]          |  |
|  |                                                                             |  |
|  |  [Universal DB Engine]               [Domain Services]                      |  |
|  |   - Prisma DMMF Schema Extractor      - Admin User & Org Governance         |  |
|  |   - Dynamic Query & Filter Builder    - Gemini AI Quota & Telemetry         |  |
|  |   - Relation Traversal & Eager Load   - BullMQ Queue Controller             |  |
|  |   - Sensitive Data Masking Layer      - System Health Monitor               |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
                                      │
            ┌─────────────────────────┼─────────────────────────┐
            ▼                         ▼                         ▼
  +--------------------+    +--------------------+    +--------------------+
  |    PostgreSQL      |    |       Redis        |    |   Docker Runner    |
  |  (67 Prisma Tables |    | (BullMQ Queues &   |    |    Environment     |
  |  + AdminAuditLog)  |    | Live Socket State) |    |  (Worker Spawner)  |
  +--------------------+    +--------------------+    +--------------------+
```

---

## 2. Hệ Thống Phân Quyền Vai Trò (Admin RBAC Model)

Hệ thống bổ sung trường `systemRole` ở cấp tài khoản người dùng (`User.systemRole`), tách biệt với vai trò theo từng project (`OWNER`, `EDITOR`, `VIEWER`):

| Cấp bậc Vai trò | Mô tả phạm vi quyền hạn | Quyền Thao Tác (Permissions) |
| :--- | :--- | :--- |
| **`SUPERADMIN`** | Quản trị viên tối cao của hệ thống CovAI | - Toàn quyền truy cập và thao tác trên tất cả 67 tables.<br>- Thao tác xóa vĩnh viễn (Hard Delete) hoặc xóa hàng loạt (Bulk Delete).<br>- Thăng cấp hoặc hạ cấp vai trò của người dùng khác.<br>- Purge hàng đợi BullMQ và thay đổi cấu hình lõi hệ thống.<br>- Đặt lại hạn mức AI cho bất kỳ tài khoản nào. |
| **`ADMIN`** | Quản trị viên vận hành hệ thống | - Xem, lọc, tìm kiếm và xuất dữ liệu trên tất cả 67 tables.<br>- Chỉnh sửa (Update) hoặc tạo mới (Create) bản ghi an toàn.<br>- Khóa/Mở khóa tài khoản người dùng vi phạm.<br>- Xem chi tiết hàng đợi BullMQ, Retry các job bị lỗi.<br>- Không được phép xóa bảng hệ thống hoặc thăng cấp quyền lên SuperAdmin. |
| **`OPERATOR`** | Kiểm toán viên & Điều phối viên hỗ trợ | - Quyền **Chỉ Đọc (Read-Only)** trên toàn bộ 67 tables và logs.<br>- Xem bảng theo dõi token AI và tiến độ công việc.<br>- Không có quyền chỉnh sửa dữ liệu hoặc thay đổi cấu hình. |
| **`USER`** | Người dùng thông thường | - Bị chặn 100% tại cổng vào (`403 Forbidden`) đối với tất cả các route `/api/admin/*` và trang Admin Console. |

---

## 3. Cơ Chế Bóc Tách Metadata Động (Universal Prisma DMMF Engine)

Để quản lý trọn vẹn **tất cả 67 bảng** mà không cần viết mã tĩnh lặp lại hàng trăm lần, Admin Console áp dụng kiến trúc **Metadata-Driven Data Engine**:

```
                       Prisma.dmmf.datamodel
                                 │
                                 ▼
                     [adminSchema.service.js]
                                 │
     ┌───────────────────────────┼───────────────────────────┐
     ▼                           ▼                           ▼
[Model Definitions]     [Relation Graph]             [Data Constraints]
- Tên model             - Khóa ngoại (FK)            - Trường bắt buộc (required)
- Kiểu dữ liệu cột      - Quan hệ 1-1, 1-n, n-n      - Khóa chính (@id)
- Cột mặc định/tự tăng  - Đường dẫn drill-down       - Unique constraints & indexes
```

1. **Schema Introspection**: Khi backend khởi động, service nạp mô hình dữ liệu trực tiếp từ `Prisma.dmmf.datamodel`.
2. **Auto-Typing & Validation**: Khi client gửi request tạo hoặc cập nhật bản ghi, backend tự động kiểm tra kiểu dữ liệu dựa trên metadata của model (chuyển đổi chuỗi ISO sang `DateTime`, ép kiểu số nguyên `Int`, chuẩn hóa `Json`, kiểm tra giá trị hợp lệ của `Enum`).
3. **Relation Exploration**: Tự động phát hiện các mối liên kết cha-con (ví dụ: `Project -> User (owner)`, `Job -> JobLog[]`) để cho phép Admin click nhảy trực tiếp giữa các bảng dữ liệu liên quan.

---

## 4. Cơ Chế Bảo Mật & Che Giấu Dữ Liệu Nhạy Cảm (Sensitive Field Masking)

An toàn thông tin là ưu tiên hàng đầu. Lớp Data Access Layer của Admin Console được tích hợp bộ lọc tự động:

- **Danh sách trường bị chặn hoàn toàn (Strict Masking)**:
  - `User.passwordHash`
  - `User.passwordResetToken`
  - `User.refreshToken`
  - `User.githubAccessTokenEnc`
  - `AiEvaluationCredential.ciphertext`
- **Quy tắc xử lý**:
  - Khi thực hiện truy vấn đọc dữ liệu, các trường trên sẽ được thay thế bằng chuỗi hash tượng trưng `[REDACTED_SECRET]` hoặc loại bỏ khỏi payload trả về.
  - Khi cập nhật bản ghi, nếu trường nhạy cảm mang giá trị `[REDACTED_SECRET]`, backend sẽ giữ nguyên giá trị cũ trong cơ sở dữ liệu và không ghi đè giá trị rỗng.

---

## 5. Kiến Trúc Nhật Ký Kiểm Toán Bất Biến (Immutable Audit Logging)

Mọi tác động thay đổi trạng thái trong hệ thống đều phải chịu trách nhiệm giải trình thông qua bảng `AdminAuditLog`:

```
Client Admin Action ──► Controller ──► Fetch Before State
                                             │
                                             ▼
                                     Execute Mutation (Prisma)
                                             │
                                             ▼
                                     Capture After State
                                             │
                                             ▼
                             [adminAudit.service.recordAudit()]
                                             │
                                             ▼
                             Persist to AdminAuditLog in PostgreSQL
                               (actorId, action, diff, IP, userAgent)
```

- **Diff Engine**: Tự động so sánh `beforeSnapshot` và `afterSnapshot` để trích xuất chỉ những trường có sự thay đổi, giảm thiểu tới 85% dung lượng lưu trữ JSON.
- **Tính Bất Biến**: Bảng `AdminAuditLog` không có endpoint cập nhật (`PUT`) hay xóa (`DELETE`), đảm bảo lịch sử kiểm toán không thể bị can thiệp bởi bất kỳ ai.

---

## 6. Luồng Truyền Dữ Liệu Thời Gian Thực (Real-Time Telemetry Pipeline)

Hệ thống kết nối trực tiếp với Socket.IO qua namespace riêng biệt `/socket.io/admin`:

1. **BullMQ Worker Queue Events**: Lắng nghe sự kiện từ Redis BullMQ và phát tín hiệu cho client:
   - `admin:queue:job-active`
   - `admin:queue:job-completed`
   - `admin:queue:job-failed`
2. **System Health Pulse**: Một timer định kỳ 5 giây thu thập thông số tài nguyên hệ thống (RAM RSS, Event Loop Delay, DB Pool Connections, Active Socket Count) và phát tới client qua sự kiện `admin:system:pulse`.
3. **Security Alarms**: Phát tín hiệu cảnh báo tức thì khi phát hiện đăng nhập trái phép hoặc tỷ lệ lỗi tăng đột biến.
