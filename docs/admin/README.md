# CovAI Admin Console – Technical Documentation & Implementation Hub

> **Hệ thống Quản trị Trung tâm (Admin Console) dành riêng cho Quản trị viên CovAI**  
> Bản đặc tả kiến trúc, thiết kế giao diện tùy biến (Custom UI), nghiệp vụ chuyên sâu và kế hoạch triển khai (Implementation Plan) cho toàn bộ hệ thống cơ sở dữ liệu và hạ tầng CovAI.

---

## 1. Tổng Quan Mục Tiêu (Mission Statement)

Hệ thống **CovAI Admin Console** được xây dựng để trở thành "Trung tâm Điều khiển Tác chiến" (Mission Control) độc lập, cung cấp khả năng quan sát (observability), quản trị dữ liệu toàn diện (Universal Database Table Management) và giám sát hạ tầng thời gian thực:

1. **Quản lý toàn bộ 67+ Tables trong Database**: Tự động nhận diện schema thông qua Prisma DMMF (Data Model Meta Format), cung cấp giao diện CRUD phổ quát, tìm kiếm/lọc nâng cao, duyệt quan hệ cha-con (foreign key traversal), sửa đổi JSON payload và xuất dữ liệu an toàn.
2. **Nghiệp vụ Quản trị Chuẩn Mực (Enterprise Business Standards)**:
   - **User & Access Governance**: Khóa/mở khóa tài khoản, phân quyền RBAC (`SUPERADMIN`, `ADMIN`, `AUDITOR`), thu hồi token, điều chỉnh hạn mức AI.
   - **AI & LLM Telemetry**: Theo dõi việc tiêu thụ token Gemini, tỷ lệ cache hit, kiểm tra quota reservations và chi phí vận hành.
   - **Job Queue Orchestration**: Giám sát hàng đợi BullMQ/Redis (active, waiting, failed, delayed), retry/hủy job hàng loạt, theo dõi Docker test runners.
   - **Audit Logs & Security**: Nhật ký kiểm toán bất biến (Immutable Audit Trail) ghi lại mọi thao tác chỉnh sửa dữ liệu, actor, IP và diff chi tiết trước/sau khi đổi.
3. **Phong cách Giao diện Độc lập & Đẳng cấp (Distinctive Industrial Palette)**:
   - Không bị trùng lặp hay hòa tan với giao diện Dashboard/Editor người dùng thông thường.
   - Sử dụng ngôn ngữ thị giác **"Tactile Obsidian & Cyber Emerald"** với mật độ thông tin cao (High Information Density), tối ưu cho kỹ sư hệ thống và quản trị viên vận hành nhanh chóng.

---

## 2. Bản Đồ Thư Mục Tài Liệu (`docs/admin/`)

Tất cả tài liệu thiết kế và triển khai tính năng Admin được lưu trữ tập trung tại đây:

| Tài liệu | Mô tả & Nội dung cốt lõi |
| :--- | :--- |
| 📋 [**`plan.md`**](file:///e:/Express/CovAI-/docs/admin/plan.md) | **Kế hoạch triển khai mã nguồn (Execution Plan)** chia nhỏ thành các task con, kèm theo checkbox `[ ]` và quy định tự động đánh dấu `[x]` khi hoàn thành từng hạng mục. |
| 🏛️ [**`architecture.md`**](file:///e:/Express/CovAI-/docs/admin/architecture.md) | **Kiến trúc hệ thống tổng thể**: Phân tầng bảo mật, Admin RBAC, cơ chế Universal Prisma DMMF Parser, cơ chế Audit Logging, tích hợp WebSocket realtime telemetry. |
| 🗄️ [**`database-management.md`**](file:///e:/Express/CovAI-/docs/admin/database-management.md) | **Đặc tả Quản trị Toàn Bộ Database (All 67 Tables)**: Phân loại 8 nhóm nghiệp vụ, bộ lọc động (Dynamic Query Engine), quan hệ foreign-key, bảo vệ trường nhạy cảm, JSON AST editor. |
| 💼 [**`business-requirements.md`**](file:///e:/Express/CovAI-/docs/admin/business-requirements.md) | **Nghiệp vụ Quản trị Chuẩn Hóa**: Quản lý tài khoản, kiểm soát chi phí & quota Gemini AI, quản lý worker BullMQ, giám sát tài nguyên (PostgreSQL pool, Redis, Event Loop). |
| 🎨 [**`ui-design.md`**](file:///e:/Express/CovAI-/docs/admin/ui-design.md) | **Hệ thống Thiết kế Giao diện Tùy Biến (Custom UI/UX)**: Tone màu độc lập, bảng Design Tokens, thư viện Custom Components (DataGrid ảo hóa, Filter Builder, Inspector Drawer, Command Palette `⌘K`). |
| 🔌 [**`api-spec.md`**](file:///e:/Express/CovAI-/docs/admin/api-spec.md) | **Đặc tả REST & WebSocket API**: Danh sách toàn bộ endpoints dành riêng cho Admin (`/api/admin/*`), request/response payload, mã lỗi và sự kiện socket realtime. |

---

## 3. Nguyên Tắc An Toàn & Bảo Mật Tuyệt Đối (Safety Guardrails)

- **Nguyên tắc "Do No Harm" với Database**: Các thao tác xóa hàng loạt hoặc xóa vĩnh viễn (Hard Delete) yêu cầu cơ chế gõ xác nhận 2 bước (`Type-to-Confirm`), có preview số lượng bản ghi bị ảnh hưởng và tự động tạo snapshot trước khi mutation.
- **Bảo mật dữ liệu nhạy cảm**: Tuyệt đối không bao giờ trả về password hash, Google/GitHub access tokens hoặc ciphertext bí mật (`AiEvaluationCredential.ciphertext`, `githubAccessTokenEnc`, `refreshToken`). Các trường này được che dấu tự động (`[REDACTED_SECRET]`) ở tầng Data Access Layer của Admin.
- **Audit Mọi Hành Động**: 100% các request `POST`, `PUT`, `PATCH`, `DELETE` trên bảng dữ liệu hoặc cấu hình hệ thống đều được lưu vết vào bảng `AdminAuditLog` kèm snapshot trước/sau và diff tự động.

---

## 4. Hướng Dẫn Vận Hành & Tài Khoản Mặc Định (Operational Guide)

### 4.1. Tài khoản Quản trị Tối cao (Initial SuperAdmin)
- **Email:** `admin@covai.dev`
- **Mật khẩu khởi tạo:** `CovAI@Admin2026!`
- **Vai trò hệ thống:** `SUPERADMIN`

### 4.2. Khởi Chạy Giao Diện Quản Trị
- Đăng nhập tại `http://localhost:5173/login` với tài khoản SuperAdmin trên.
- Truy cập trực tiếp tại đường dẫn: `http://localhost:5173/admin`
- Hoặc sử dụng phím tắt toàn cục: **`⌘K` / `Ctrl+K`** để tìm kiếm và nhảy nhanh đến 67 Tables, Quotas, BullMQ Queues, Health hoặc Audit Trail.

### 4.3. Báo Cáo Nghiệm Thu & Kiểm Thử Toàn Diện (Phase 8 Passed)
- **Bảo mật RBAC:** 100% các role `USER` bị chặn hoàn toàn khỏi `/api/admin/*` (403 Forbidden). `OPERATOR` bị chặn khỏi hành động xóa và nâng cấp quyền.
- **Bảo vệ dữ liệu nhạy cảm:** Mọi trường `passwordHash`, `refreshToken`, `githubAccessTokenEnc` được che dấu thành `[REDACTED_SECRET]`.
- **Hiệu năng & Tải cao:** Truy vấn dữ liệu có phân trang, sắp xếp và lọc trên các bảng lớn (`User`, `Project`, `Job`, `Notification`) phản hồi dưới 350ms.
- **Toàn vẹn Audit Trail:** 100% các đột biến dữ liệu đều được lưu vết vào bảng `AdminAuditLog` với đầy đủ diff trước/sau.
