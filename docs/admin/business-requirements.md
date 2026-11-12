# Yêu Cầu Nghiệp Vụ Quản Trị Chuẩn Doanh Nghiệp (Admin Business Requirements)

> **Bản đặc tả nghiệp vụ quản trị chuẩn mực dành cho nền tảng CovAI**  
> Quản trị người dùng, điều phối chi phí AI, kiểm soát hàng đợi tác vụ nền, giám sát hạ tầng và tuân thủ an toàn thông tin.

---

## 1. Quản Trị Người Dùng & Quyền Hạn (User & Identity Governance)

Hệ thống quản lý người dùng của CovAI phục vụ hàng trăm lập trình viên và nhóm phát triển phần mềm, do đó phân hệ Admin cung cấp các luồng nghiệp vụ quản trị toàn diện:

### 1.1. Vòng Đời Tài Khoản (Account Lifecycle Management)
- **Trạng thái tài khoản**: `ACTIVE` (hoạt động bình thường), `SUSPENDED` (tạm khóa vì vi phạm điều khoản hoặc nghi ngờ bị hack), `BANNED` (cấm vĩnh viễn).
- **Hành động Khóa / Mở khóa tài khoản**:
  - Khi khóa tài khoản (`isSuspended: true`), hệ thống đồng thời:
    1. Đánh dấu cờ trong database.
    2. Thu hồi `refreshToken` trong bảng `User`.
    3. Xóa toàn bộ token session của người dùng đó khỏi Redis cache.
    4. Ngắt kết nối các Socket.IO connection đang mở của người dùng đó.
  - Mọi thao tác khóa đều bắt buộc nhập trường `reason` (lý do) để lưu vào `AdminAuditLog`.

### 1.2. Chế Độ Kiểm Tra Lỗi Người Dùng An Toàn (Read-Only Impersonation)
- Cho phép `SUPERADMIN` kích hoạt chế độ "Xem dưới góc nhìn người dùng" (Impersonate View) để tái hiện lỗi người dùng báo cáo.
- **Ranh giới an toàn**:
  - Token sinh ra cho phiên impersonation được gắn cờ `impersonatedBy: adminId` và có hiệu lực tối đa 30 phút.
  - Tuyệt đối chỉ cấp quyền **Đọc (Read-Only)**, mọi thao tác ghi/sửa/xóa của admin dưới danh nghĩa user sẽ bị middleware từ chối và cảnh báo.

### 1.3. Cấp Phát & Điều Chỉnh Hạn Mức Sử Dụng (Quota Overrides)
- Mặc định mỗi người dùng có hạn mức số lượt gọi AI hàng ngày (`aiUsageCount`) và số lượng token tích lũy (`aiTokenUsage`).
- Admin có thể:
  - Cấp thêm hạn mức token dự phòng cho các đợt chạy test lớn.
  - Reset lại bộ đếm ngày nếu người dùng gặp sự cố kỹ thuật từ phía máy chủ.
  - Thiết lập danh sách người dùng đặc quyền (Whitelisted / VIP) không bị giới hạn token.

---

## 2. Giám Sát Chi Phí & Hạn Mức Gemini AI (AI & LLM Governance)

CovAI sử dụng mô hình ngôn ngữ lớn (Gemini 1.5 Pro, Gemini 1.5 Flash, Gemini Code Assist) để tự sinh test, phân tích lỗi và đề xuất sửa mã nguồn. Đây là trung tâm phát sinh chi phí lớn nhất của hệ thống:

```
[Gemini API Calls] ──► [Token Metering Service] ──► [AiQuotaReservation Table]
                                │                                │
                                ▼                                ▼
                   [Admin Real-Time Dashboard]     [Spike & Anomaly Detection]
                   - Total Tokens (Prompt/Comp)    - Alert if user > 100k/hr
                   - Cache Hit Savings             - Auto-throttle abusive keys
```

### 2.1. Đo Lường & Phân Bổ Token (Token Metering & Telemetry)
- Theo dõi theo thời gian thực:
  - **Prompt Tokens**: Số lượng token gửi đi (kèm theo context mã nguồn, AST).
  - **Completion Tokens**: Số lượng token AI sinh ra (mã unit test, phân tích CFG).
  - **Cached Tokens**: Số lượng token tái sử dụng từ bộ nhớ đệm Gemini Context Caching (`AiContextCache`).
- Tính toán ước tính chi phí USD dựa trên biểu giá hiện hành của Google Cloud Gemini API.

### 2.2. Kiểm Soát Bộ Nhớ Ngữ Cảnh (Context Cache Optimization)
- Bảng `AiContextCache` lưu trữ các context template được nạp sẵn vào LLM.
- Admin theo dõi:
  - Tỷ lệ Cache Hit Rate (mục tiêu tối ưu > 60%).
  - Dung lượng token tiết kiệm được nhờ cơ chế cache.
  - Nút dọn dẹp các cache key đã hết hạn (`TTL expired`).

### 2.3. Phát Hiện Bất Thường (Spike & Anomaly Detection)
- Tự động gắn cờ cảnh báo khi một người dùng hoặc một dự án:
  - Tiêu thụ vượt quá 150,000 tokens trong vòng 1 giờ.
  - Gặp tỷ lệ lỗi gọi AI > 20% liên tục trong 10 phút.

---

## 3. Điều Phối Hàng Đợi Tác Vụ Nền (BullMQ Worker Orchestration)

Toàn bộ các tác vụ tính toán nặng (chạy Docker test container, trích xuất AST của dự án, tính toán độ bao phủ mã nguồn) đều được xử lý qua BullMQ và Redis:

### 3.1. Các Hàng Đợi Chính (Queue Inventory)
1. `runner-queue`: Điều phối container Docker thực thi Jest/Mocha/Vitest.
2. `coverage-queue`: Phân tích file LCOV/Istanbul và bóc tách đồ thị CFG.
3. `ast-parser-queue`: Phân tích cây cú pháp trừu tượng qua Babel.
4. `ai-generation-queue`: Xếp hàng các prompt sinh test bằng Gemini.

### 3.2. Bảng Điều Khiển Tác Vụ (Queue Mission Control)
- **Chỉ số thời gian thực**:
  - `Active`: Số job đang chạy trong worker.
  - `Waiting`: Số job đang xếp hàng chờ tài nguyên.
  - `Completed`: Số job hoàn thành thành công trong 24h qua.
  - `Failed`: Số job bị crash hoặc timeout.
  - `Delayed`: Số job được lập lịch lùi thời gian.
- **Thao tác can thiệp khẩn cấp**:
  - **Retry All Failed**: Cho phép chạy lại hàng loạt tất cả các job bị lỗi do sự cố mạng tạm thời.
  - **Pause / Resume Queue**: Tạm dừng nhận job mới vào hàng đợi khi bảo trì máy chủ worker.
  - **Purge Dead Letters**: Dọn dẹp các job lỗi cũ để giải phóng bộ nhớ Redis.
  - **Job Inspector**: Xem trực tiếp Payload đầu vào, Stack trace báo lỗi và Thời gian thực thi chi tiết của từng job.

---

## 4. Giám Sát Sức Khỏe Hạ Tầng (Infrastructure & Telemetry)

Cung cấp cái nhìn toàn diện về tài nguyên máy chủ để bảo đảm độ sẵn sàng 99.9% cho hệ thống:

| Thành phần hạ tầng | Chỉ số theo dõi cốt lõi | Ngưỡng cảnh báo (Threshold) |
| :--- | :--- | :--- |
| **PostgreSQL Pool** | Active connections, Idle connections, Waiting clients | Active > 85% Pool Size |
| **Redis Cache** | Used memory, Memory peak, Fragmentation ratio, Ping latency | Latency > 15ms hoặc RAM > 80% |
| **Node.js Runtime** | Heap Used, Heap Total, RSS memory, Event Loop Lag | Event loop lag > 100ms liên tục |
| **Docker Test Runners** | Số container đang chạy, Zombie containers, CPU/Memory per runner | Container chạy quá 120s (Timeout) |
| **Thư mục tạm (`.covai-temp`)** | Tổng dung lượng ổ cứng bị chiếm dụng bởi workspace tạm thời | Dung lượng > 5GB hoặc file cũ > 6 giờ |

- **Cơ chế Dọn Rác Tự Động (Garbage Collection)**: Nút kích hoạt quét dọn các file tạm của Docker test runner bị sót lại khi tiến trình worker bị ngắt đột ngột.

---

## 5. Nhật Ký Kiểm Toán & Tuân Thủ (Audit Trail & Compliance)

Đáp ứng tiêu chuẩn an toàn thông tin doanh nghiệp (SOC2 / ISO 27001):

- **Nguyên tắc không thể chối bỏ (Non-repudiation)**:
  - Mọi bản ghi `AdminAuditLog` đều ghi nhận: `actorId`, `actorEmail`, `ipAddress`, `userAgent`, `action`, `targetModel`, `targetId`, thời điểm chính xác tính đến mili-giây.
- **Lưu trữ Diff chi tiết**:
  ```json
  {
    "field": "systemRole",
    "oldValue": "USER",
    "newValue": "ADMIN"
  }
  ```
- **Thời gian lưu trữ (Retention Policy)**: Dữ liệu audit được bảo lưu tối thiểu 12 tháng và được bảo vệ ở chế độ Append-Only.
