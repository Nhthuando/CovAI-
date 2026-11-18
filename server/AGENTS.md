# CovAI Server – Backend Engineering & Architecture Master Guidelines (`server/AGENTS.md`)

> **Phạm vi áp dụng:** Toàn bộ mã nguồn, API routes, controllers, services, database models và background jobs bên trong thư mục [`server/`](file:///e:/Express/CovAI-/server).  
> **Mục tiêu tối thượng:** Đảm bảo hệ thống Backend vận hành ổn định, bảo mật cao, không nghẽn luồng xử lý (Non-blocking Event Loop), xử lý tác vụ kiểm thử sandbox an toàn và tương thích tối đa với kiến trúc phân tán.

---

## 1. Kiến Trúc 3 Lớp Phân Tách (Route - Controller - Service Pattern)

Mọi tính năng trong Backend **BẮT BUỘC** tuân thủ nguyên tắc phân tầng độc lập:

```text
HTTP Request ──► [Route] ──► [Middleware] ──► [Controller] ──► [Service] ──► [Prisma / BullMQ / Gemini]
                      ▲                                              │
                      └───────────────── HTTP Response ──────────────┘
```

1. **Routes (`server/src/routes/`)**:
   - Chỉ làm nhiệm vụ ánh xạ HTTP Method & URL.
   - Gắn các middleware bảo vệ: `verifyToken`, `rateLimiter`, `upload.single(...)`, `authorizeProjectRole(...)`.
2. **Controllers (`server/src/controllers/`)**:
   - Chỉ làm nhiệm vụ giao tiếp HTTP: bóc tách `req.params`, `req.query`, `req.body`, `req.user`.
   - Gọi Schema Validator để kiểm tra tính hợp lệ của dữ liệu đầu vào.
   - Gọi Service tương ứng để xử lý nghiệp vụ và trả về kết quả qua `res.status(200).json({ success: true, data })`.
   - **CẤM**: Không viết câu truy vấn cơ sở dữ liệu (Prisma) hay thuật toán phân tích nặng trực tiếp trong Controller.
3. **Services (`server/src/services/`)**:
   - Chứa 100% logic nghiệp vụ tính toán, phân tích cú pháp AST, điều phối hàng đợi BullMQ, giao tiếp LLM Gemini.
   - **CẤM**: Service **tuyệt đối KHÔNG** nhận đối tượng `req` hoặc `res` của Express để đảm bảo tính độc lập và khả năng viết Unit Test 100%.

---

## 2. Tiêu Chuẩn Cơ Sở Dữ Liệu & Prisma ORM (Performance & Safety)

1. **Bắt Buộc Sử Dụng `select` Projection**:
   - Các bảng trong CovAI lưu trữ dữ liệu rất lớn: `ProjectSnapshot` (lưu cả cây file và code), `CoverageSummary`, `CoverageFile` (lưu hàng chục nghìn dòng code coverage), `JobOutput`.
   - **TUYỆT ĐỐI KHÔNG** dùng `findUnique()` hoặc `findMany()` trần trụi mà không có `select`.
   - *Ví dụ chuẩn:*
     ```javascript
     // CHUẨN: Chỉ lấy các trường cần thiết, tiết kiệm RAM và băng thông
     const snapshot = await prisma.projectSnapshot.findUnique({
       where: { id: snapshotId },
       select: { id: true, projectId: true, commitHash: true, createdAt: true }
     });
     ```
2. **Giao Dịch Đa Bảng Bắt Buộc (`prisma.$transaction`)**:
   - Khi một tác vụ yêu cầu tạo mới hoặc cập nhật từ 2 bảng trở lên (ví dụ: Tạo Job mới + Lưu JobLog ban đầu + Cập nhật trạng thái Project), bắt buộc phải bọc trong transaction để tránh lỗi dữ liệu mồ côi khi có sự cố.
3. **Singleton Client**: Luôn import Prisma Client từ [`server/src/config/prisma.js`](file:///e:/Express/CovAI-/server/src/config/prisma.js). Không tự ý `new PrismaClient()` ở từng file gây rò rỉ kết nối Database Connection Pool.

---

## 3. Kiến Trúc Hàng Đợi Tác Vụ Ngầm (BullMQ & Redis Workers)

1. **Nguyên Tắc Bất Di Bất Dịch: Không Chặn Event Loop**:
   - Các tác vụ sau đây **BẮT BUỘC** phải đẩy vào hàng đợi Redis qua [`queue.service.js`](file:///e:/Express/CovAI-/server/src/services/queue.service.js) và trả về `jobId` ngay lập tức cho client (HTTP 202 Accepted):
     - Chạy test suite (Jest, Vitest, Supertest, Playwright, Cypress).
     - Phân tích toàn bộ cây mã nguồn (AST parsing, CFG builder, Cyclomatic Complexity).
     - Gọi Google Gemini để sinh test suite lớn hoặc đánh giá chatbot trustworthiness.
2. **Phát Tín Hiệu Realtime (Socket.IO Streaming)**:
   - Worker trong quá trình chạy phải phát socket event định kỳ (`job:progress`, `job:log`, `job:completed`, `job:failed`) tới phòng của người dùng (`user_${userId}`) hoặc phòng dự án (`project_${projectId}`).
   - Tuyệt đối không để Frontend phải dùng kỹ thuật polling liên tục (long-polling) gây nghẽn server.

---

## 4. Xử Lý Phân Tích AST & Sandbox Runner An Toàn

1. **Phân Tích Cú Pháp AST Graceful Handling**:
   - Khi phân tích mã nguồn do người dùng tải lên bằng `@babel/parser` hoặc `esprima`, mã nguồn đó có thể bị lỗi cú pháp hoặc dùng cú pháp JSX/TypeScript đặc thù.
   - Luôn bọc việc parse file trong khối `try ... catch` có ghi log cảnh báo; không bao giờ để một file code lỗi làm sập toàn bộ tiến trình quét của dự án.
2. **Cách Ly Thư Mục Tạm (`server/.covai-temp/`)**:
   - Mọi hoạt động giải nén ZIP/RAR, tạo file cấu hình giả lập (playwright config, mock db) hay chạy runner bắt buộc diễn ra trong thư mục `server/.covai-temp/<jobId>/`.
   - **Bắt Buộc Dọn Dẹp**: Sử dụng cấu trúc `try ... finally` để luôn xóa thư mục tạm sau khi test runner kết thúc, bất kể thành công hay thất bại.
3. **Chống Lỗ Hổng Zip Slip & Directory Traversal**:
   - Mọi đường dẫn file giải nén phải đi qua bộ lọc [`server/src/utils/pathSanitizer.js`](file:///e:/Express/CovAI-/server/src/utils/pathSanitizer.js). Cấm giải nén file có đường dẫn chứa `../` hoặc trỏ ra ngoài thư mục sandbox.

---

## 5. Tích Hợp Google Gemini AI & Quản Lý Quota

1. **Mô Hình Hợp Lệ**:
   - Chỉ sử dụng các định danh mô hình được định nghĩa tập trung trong [`shared/aiModels.js`](file:///e:/Express/CovAI-/shared/aiModels.js) (`gemini-2.5-flash`, `gemini-3.5-flash-lite`...).
2. **Phân Tích Kết Quả JSON Tin Cậy (Structured Output Parsing)**:
   - Khi yêu cầu Gemini trả về JSON chứa test case hoặc kết quả đánh giá:
   - Bắt buộc làm sạch Markdown code fence (````json ... ````).
   - Sử dụng thư viện `jsonrepair` trước khi `JSON.parse` để tự động khắc phục các lỗi thiếu ngoặc, dấu phẩy thừa do LLM tạo ra.
   - Validate kết quả đầu ra bằng schema Zod trước khi lưu vào Database.

---

## 6. Bảo Mật & Xác Thực (Security & Auth)

1. **Bảo Vệ Bí Mật Người Dùng**:
   - Mọi Personal Access Token (GitHub Token) của người dùng phải được mã hóa bằng thuật toán **AES-256-GCM** (thông qua `server/src/utils/crypto.js`) trước khi lưu vào Database.
   - Mật khẩu người dùng luôn được băm bằng `bcryptjs` với salt rounds tối thiểu là 10.
2. **Phân Quyền Dự Án (RBAC)**:
   - Trước khi cho phép đọc/ghi dữ liệu của dự án, Controller hoặc Middleware phải kiểm tra quyền qua ma trận năng lực trong [`shared/projectAccess.js`](file:///e:/Express/CovAI-/shared/projectAccess.js) (`OWNER`, `EDITOR`, `VIEWER`).

---

## 7. Ranh Giới Module & Monorepo
- **Tuyệt đối không import từ `client/`**.
- Hằng số dùng chung (AI Models, Roles, Socket protocol) phải lấy từ thư mục [`shared/`](file:///e:/Express/CovAI-/shared).
