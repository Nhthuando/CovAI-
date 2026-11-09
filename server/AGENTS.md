# CovAI Server – Backend Developer & AI Agent Guidelines (`server/AGENTS.md`)

> **Áp dụng:** Cho tất cả mã nguồn bên trong thư mục [`server/`](file:///e:/Express/CovAI-/server).

---

## 1. Kiến Trúc & Cấu Trúc Mã Nguồn (Controller - Service - Route)

Mọi tính năng mới trong Backend phải tuân thủ nghiêm ngặt mô hình 3 lớp phân tách:
1. **Routes (`server/src/routes/`)**: Định nghĩa đường dẫn API, gắn middleware xác thực (`authMiddleware`), rate limiting và gọi controller tương ứng.
2. **Controllers (`server/src/controllers/`)**: Tiếp nhận `req`, parse params/body, gọi Validator, gọi Service xử lý nghiệp vụ và trả về `res.json(...)`. Không viết trực tiếp logic nghiệp vụ phức tạp ở đây.
3. **Services (`server/src/services/`)**: Chứa 100% logic nghiệp vụ tính toán, xử lý AST, gọi Prisma, gọi BullMQ queue hoặc gọi LLM Gemini.

---

## 2. Tiêu Chuẩn Prisma ORM & Database

1. **Chọn lọc trường dữ liệu (`select`)**:
   - Đối với các bảng có dung lượng lớn (`ProjectSnapshot`, `CoverageSummary`, `JobOutput`, `CoverageFile`), **BẮT BUỘC** dùng `select` để chỉ lấy các trường cần thiết, tránh tải toàn bộ blob dữ liệu nặng làm nghẽn RAM và mạng.
2. **Giao dịch an toàn (`$transaction`)**:
   - Khi ghi dữ liệu liên quan đến nhiều bảng (ví dụ: tạo snapshot mới + lưu danh sách file + cập nhật trạng thái project), bắt buộc bọc trong `prisma.$transaction(...)`.
3. **Quản lý Client**: Luôn dùng instance singleton từ [`server/src/config/prisma.js`](file:///e:/Express/CovAI-/server/src/config/prisma.js).

---

## 3. Background Jobs & Hàng Đợi (BullMQ / Redis)

1. **Không chặn Event Loop**:
   - Tuyệt đối không chạy tác vụ nặng (chạy Docker test runner, phân tích AST cả thư mục, gọi Gemini AI sinh hàng chục test case) trực tiếp trong chu trình HTTP request.
   - Luôn đẩy tác vụ vào hàng đợi qua [`server/src/services/queue.service.js`](file:///e:/Express/CovAI-/server/src/services/queue.service.js).
2. **Realtime Progress Tracking**:
   - Trong quá trình worker xử lý job, luôn cập nhật tiến độ (progress %) và phát tín hiệu qua Socket.IO để Frontend hiển thị thanh tiến trình tức thì.

---

## 4. Xử Lý File Tạm & Sandbox An Toàn

1. **Vị trí file tạm**:
   - Toàn bộ file tạm sinh ra trong quá trình chạy test hoặc giải nén archive phải đặt trong `server/.covai-temp/`.
2. **Dọn dẹp bắt buộc**:
   - Sử dụng khối `try ... finally` để xóa sạch các thư mục tạm sau khi hoàn tất hoặc khi gặp lỗi, tránh làm phình ổ cứng server.
3. **Path Sanitization**:
   - Luôn sử dụng tiện ích trong [`server/src/utils/pathSanitizer.js`](file:///e:/Express/CovAI-/server/src/utils/pathSanitizer.js) để ngăn ngừa lỗ hổng Directory Traversal (Zip Slip) khi giải nén file người dùng tải lên.

---

## 5. Ranh Giới Module
- **Tuyệt đối không import từ `client/`**.
- Hằng số dùng chung (AI Models, Roles, Socket protocol) phải lấy từ thư mục [`shared/`](file:///e:/Express/CovAI-/shared).
