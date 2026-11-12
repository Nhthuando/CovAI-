# Đặc Tả Kỹ Thuật API Quản Trị (Admin API & WebSocket Specification)

> **Tài liệu đặc tả các giao diện lập trình ứng dụng (REST Endpoints & WebSocket Events)**  
> Dành riêng cho phân hệ CovAI Admin Console. Mọi request đều yêu cầu xác thực JWT với vai trò hợp lệ (`SUPERADMIN`, `ADMIN`, `OPERATOR`).

---

## 1. Tiêu Chuẩn Chung (Global Conventions)

- **Base URL**: `/api/admin`
- **Authentication**: Header `Authorization: Bearer <ADMIN_JWT_TOKEN>`
- **Response Format**: Toàn bộ phản hồi tuân thủ cấu trúc chuẩn:
  ```json
  {
    "success": true,
    "data": { ... },
    "meta": { ... },
    "timestamp": "2026-11-12T08:00:00.000Z"
  }
  ```
- **Error Format**:
  ```json
  {
    "success": false,
    "error": {
      "code": "FORBIDDEN_ACTION",
      "message": "Only SUPERADMIN can perform hard deletion on this model."
    },
    "timestamp": "2026-11-12T08:00:00.000Z"
  }
  ```

---

## 2. Nhóm API Metadata Schema & Định Tuyến Bảng (`/api/admin/schema`)

### 2.1. Lấy danh sách toàn bộ 67 models
- **Endpoint**: `GET /api/admin/schema/models`
- **Mô tả**: Trả về danh sách tất cả các bảng trong DB, phân bổ theo 8 domains, kèm số lượng bản ghi ước tính.
- **Phản hồi mẫu**:
  ```json
  {
    "success": true,
    "data": {
      "domains": [
        {
          "id": "AUTH_ACCOUNTS",
          "name": "Auth, Identity & Account",
          "models": [
            { "name": "User", "recordCount": 128, "isAudited": true },
            { "name": "Notification", "recordCount": 4200, "isAudited": false },
            { "name": "AdminAuditLog", "recordCount": 1560, "isAudited": false }
          ]
        },
        {
          "id": "PROJECTS_WORKSPACE",
          "name": "Projects & Workspace",
          "models": [
            { "name": "Project", "recordCount": 85, "isAudited": true },
            { "name": "ProjectFileVersion", "recordCount": 14200, "isAudited": true }
          ]
        }
      ],
      "totalModels": 67,
      "totalRecords": 182400
    }
  }
  ```

### 2.2. Lấy chi tiết cấu trúc Schema của một Model
- **Endpoint**: `GET /api/admin/schema/models/:modelName`
- **Mô tả**: Trích xuất chi tiết các trường, kiểu dữ liệu, quan hệ khóa ngoại (foreign keys) từ Prisma DMMF.
- **Phản hồi mẫu**:
  ```json
  {
    "success": true,
    "data": {
      "modelName": "Project",
      "primaryKey": "id",
      "fields": [
        { "name": "id", "type": "String", "isRequired": true, "isId": true },
        { "name": "name", "type": "String", "isRequired": true, "isSearchable": true },
        { "name": "userId", "type": "String", "isForeignKey": true, "relationModel": "User" },
        { "name": "createdAt", "type": "DateTime", "isFilterable": true }
      ],
      "relations": [
        { "name": "user", "type": "User", "isList": false },
        { "name": "jobs", "type": "Job", "isList": true }
      ]
    }
  }
  ```

---

## 3. Nhóm API Truy Vấn & Đột Biến Dữ Liệu Phổ Quát (`/api/admin/data/:modelName`)

Áp dụng đồng nhất cho **tất cả 67 tables trong database**:

### 3.1. Truy vấn danh sách bản ghi (List & Query)
- **Endpoint**: `GET /api/admin/data/:modelName`
- **Query Parameters**:
  - `page`: Số trang (mặc định: `1`)
  - `limit`: Số bản ghi mỗi trang (mặc định: `25`, tối đa: `100`)
  - `sortBy`: Tên cột sắp xếp (mặc định: `id` hoặc `createdAt`)
  - `sortOrder`: `asc` | `desc`
  - `q`: Từ khóa tìm kiếm toàn văn
  - `filters`: Chuỗi JSON encode danh sách điều kiện lọc
- **Phản hồi mẫu**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "cm3abc123",
        "name": "E-Commerce Core Service",
        "userId": "usr_9988",
        "createdAt": "2026-11-10T14:32:00.000Z",
        "_relations": {
          "user": { "id": "usr_9988", "name": "Alice Smith" }
        }
      }
    ],
    "meta": {
      "total": 85,
      "page": 1,
      "limit": 25,
      "totalPages": 4
    }
  }
  ```

### 3.2. Xem chi tiết một bản ghi kèm liên kết quan hệ
- **Endpoint**: `GET /api/admin/data/:modelName/:id`
- **Query Parameters**: `includeRelations=true` (tùy chọn)
- **Phản hồi**: Trả về toàn bộ dữ liệu của bản ghi (đã tự động che giấu các trường mật khẩu, access token nhạy cảm) kèm dữ liệu liên kết 1 cấp.

### 3.3. Tạo mới bản ghi
- **Endpoint**: `POST /api/admin/data/:modelName`
- **Body**: JSON chứa các trường dữ liệu cần tạo.
- **Xử lý**: Kiểm tra kiểu dữ liệu theo DMMF, thực hiện insert, tự động ghi vào `AdminAuditLog` với action `CREATE`.

### 3.4. Cập nhật bản ghi
- **Endpoint**: `PUT /api/admin/data/:modelName/:id`
- **Body**: JSON chứa các trường cần sửa.
- **Xử lý**: Lấy snapshot trước khi sửa, thực hiện update, ghi diff vào `AdminAuditLog` với action `UPDATE`.

### 3.5. Xóa bản ghi (Soft / Hard Delete)
- **Endpoint**: `DELETE /api/admin/data/:modelName/:id`
- **Query Parameters**: `forceHardDelete=true` (chỉ `SUPERADMIN` mới được kích hoạt)
- **Xử lý**: Nếu model có trường `archivedAt`, tự động chuyển thành soft-delete; nếu yêu cầu hard-delete, xóa vĩnh viễn và lưu vết audit log `DELETE`.

### 3.6. Xóa hàng loạt an toàn (Batch Delete)
- **Endpoint**: `POST /api/admin/data/:modelName/batch-delete`
- **Body**: `{ "ids": ["id1", "id2", "id3"], "confirmation": "CONFIRM_DELETE" }`
- **Xử lý**: Chạy trong `prisma.$transaction`, ghi nhận audit log chi tiết.

### 3.7. Xuất dữ liệu (Data Export)
- **Endpoint**: `POST /api/admin/data/:modelName/export`
- **Body**: `{ "format": "csv" | "json", "filters": [ ... ], "fields": [ "id", "name", ... ] }`
- **Phản hồi**: Trả về file tải xuống trực tiếp kèm tiêu đề `Content-Disposition`.

---

## 4. Nhóm API Quản Trị Người Dùng & Quyền Hạn (`/api/admin/users`)

- **`GET /api/admin/users`**: Danh sách người dùng nâng cao kèm các thông số tổng hợp (số lượng projects, số lần chạy job, tổng token AI đã dùng, vai trò `systemRole`, cờ `isSuspended`).
- **`PATCH /api/admin/users/:id/status`**:
  - Body: `{ "isSuspended": true, "reason": "Spam AI requests" }`
  - Hành động: Khóa tài khoản, thu hồi refresh token, hủy phiên Redis, ngắt socket.
- **`PATCH /api/admin/users/:id/role`**:
  - Body: `{ "systemRole": "ADMIN" }` (Chỉ `SUPERADMIN` được thực hiện).
- **`POST /api/admin/users/:id/reset-quota`**:
  - Body: `{ "extraTokens": 100000, "resetDailyCount": true }`

---

## 5. Nhóm API Điều Phối AI & Token Governance (`/api/admin/ai`)

- **`GET /api/admin/ai/usage-overview`**: Thống kê số lượng token theo mốc thời gian (24 giờ qua, 7 ngày qua, 30 ngày qua), phân bổ theo các model `gemini-1.5-pro`, `gemini-1.5-flash`.
- **`GET /api/admin/ai/quotas`**: Danh sách các tài khoản đang vượt hoặc chạm ngưỡng 80% quota trong ngày.
- **`GET /api/admin/ai/cache-stats`**: Tỷ lệ hit/miss bộ đệm `AiContextCache`, tổng lượng token tiết kiệm được và danh sách cache keys hoạt động.

---

## 6. Nhóm API Kiểm Soát Hàng Đợi BullMQ (`/api/admin/queues`)

- **`GET /api/admin/queues/status`**: Trạng thái tất cả các queue (`waiting`, `active`, `completed`, `failed`, `delayed`).
- **`POST /api/admin/queues/:queueName/retry-all-failed`**: Kích hoạt worker chạy lại tất cả các job lỗi trong queue được chỉ định.
- **`POST /api/admin/queues/:queueName/purge`**: Xóa sạch các job dead-letter hoặc completed cũ khỏi Redis.
- **`POST /api/admin/queues/:queueName/pause` & `resume`**: Tạm dừng hoặc tiếp tục nhận job.

---

## 7. Nhóm API Sức Khỏe Hệ Thống & Kiểm Toán (`/api/admin/health` & `/audit-logs`)

- **`GET /api/admin/health/overview`**: Trả về tình trạng kết nối DB pool, Redis latency, Event loop lag, Heap memory Node.js.
- **`POST /api/admin/health/cleanup-temp`**: Kích hoạt quét và dọn sạch các file rác trong `server/.covai-temp/`.
- **`GET /api/admin/audit-logs`**: Truy vấn lịch sử kiểm toán có lọc theo `actorId`, `targetModel`, `action`, `dateRange`.

---

## 8. Giao Thức WebSocket Realtime (`/socket.io/admin`)

- **Namespace**: `/socket.io/admin` (yêu cầu gửi kèm JWT token qua socket handshake auth).
- **Các sự kiện Server phát tới Client (Server-to-Client)**:
  - `admin:telemetry:pulse`: Nhịp tim hệ thống phát mỗi 5 giây (`cpuUsage`, `memoryRssMb`, `activeDbConnections`, `activeSocketUsers`).
  - `admin:queue:updated`: Cập nhật số lượng job trong hàng đợi mỗi khi có job mới được đưa vào hoặc hoàn tất.
  - `admin:alert:triggered`: Bắn cảnh báo sự cố khẩn cấp (ví dụ: DB connection spike, worker crash).
