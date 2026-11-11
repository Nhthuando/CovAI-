# CovAI – Developer & AI Agent Working Guidelines (`AGENTS.md`)

> **Mục đích:** Tài liệu này là kim chỉ nam tối cao bắt buộc cho tất cả các AI Agent và lập trình viên khi đọc, tạo mới, chỉnh sửa hoặc refactor mã nguồn trong dự án **CovAI**. Mọi hành động sửa đổi code đều phải tuân thủ nghiêm ngặt các điều khoản dưới đây.

---

## 1. Kiến Trúc Monorepo & Khóa Cứng Root (Strict Root Whitelist)

Dự án CovAI được tổ chức theo mô hình Monorepo tinh gọn với ranh giới tách bạch:
- [`client/`](file:///e:/Express/CovAI-/client): Ứng dụng Frontend (React 19, Vite, Tailwind CSS v4, Monaco Editor, React Query, Yjs client).
- [`server/`](file:///e:/Express/CovAI-/server): Ứng dụng Backend (Node.js ES Modules, Express v5, Prisma ORM, PostgreSQL, Redis + BullMQ, Babel AST, Socket.IO).
- [`shared/`](file:///e:/Express/CovAI-/shared): Module chia sẻ dùng chung giữa Client và Server (Roles, Permissions, AI Models, Socket Protocol).
- [`docs/`](file:///e:/Express/CovAI-/docs): Toàn bộ tài liệu kiến trúc, API specs, plans và nghiệm thu (tham khảo [`docs/README.md`](file:///e:/Express/CovAI-/docs/README.md)).
- [`.agents/`](file:///e:/Express/CovAI-/.agents): Cấu hình chuyên biệt cho AI Agent (quy tắc styling, skills tạo component UI chuẩn).

### ⛔ Quy Tắc Khóa Cứng Root (Strict Whitelist Lockdown)
Thư mục root của dự án áp dụng cơ chế **Whitelist tuyệt đối** (`/*` và `!`). 
- **Chỉ DUY NHẤT 5 thư mục sau được phép tồn tại ở root**:
  `/.agents/`, `/client/`, `/docs/`, `/server/`, `/shared/`
- **Chỉ DUY NHẤT 7 file sau được phép tồn tại ở root**:
  `.gitignore`, `AGENTS.md`, `api.http`, `docker-compose.yml`, `package.json`, `package-lock.json`, `README.md`
- 🚫 **CẤM TỰ Ý TẠO FILE/FOLDER MỚI Ở ROOT**: 
  - Mọi tài liệu mới phải đưa vào đúng danh mục trong `docs/`.
  - Mọi script kiểm tra tạm thời phải đặt trong `server/scripts/` hoặc `scratch/` (và phải dọn dẹp sau khi dùng).
  - Git sẽ tự động chặn 100% mọi file hoặc thư mục nằm ngoài danh sách Whitelist trên.

---

## 2. Quy Tắc Ranh Giới Module & Giao Tiếp (Boundaries & Communication)

1. **Tuyệt Đối Không Import Chéo (No Cross-Imports)**:
   - `server/` tuyệt đối **KHÔNG ĐƯỢC** import file từ `client/` và ngược lại.
   - Client giao tiếp với Server duy nhất qua **HTTP REST API** và **Socket.IO WebSocket**.
2. **Bắt Buộc Sử Dụng Module `shared/` (Single Source of Truth)**:
   - Các định danh vai trò người dùng (`OWNER`, `EDITOR`, `VIEWER`), vai trò chuyên môn (`PM`, `DEVELOPER`, `TESTER`...), danh sách mô hình Gemini (`AI_MODELS`), giới hạn gói tin realtime (`EDITOR_LIMITS`) **bắt buộc phải lấy từ `shared/`**.
   - Tuyệt đối không định nghĩa lại các hằng số này cục bộ ở Client hoặc Server để tránh lệch pha dữ liệu.
3. **Bảo Toàn Comment & Docstring**:
   - Giữ nguyên toàn bộ chú thích logic, license, JSDoc hiện có trong mã nguồn. Không tự ý xóa code hoặc comment không thuộc phạm vi công việc được giao.
4. **Không Nuốt Lỗi Âm Thầm (No Silent Error Swallowing)**:
   - Mọi khối `try ... catch` phải có log lỗi chi tiết (`console.error` hoặc qua Logger) hoặc chuyển tiếp lỗi cho middleware xử lý trung tâm. Tuyệt đối không viết `catch (e) {}` rỗng.

---

## 3. Tiêu Chuẩn Frontend UI/UX: Đẳng Cấp Kỹ Thuật (Sleek Industrial)

Giao diện CovAI là một **công cụ kỹ thuật chuyên sâu cho kỹ sư phần mềm (Developer Tool)**, kết hợp tinh hoa thẩm mỹ của **GitHub Primer**, **Linear** và **shadcn/ui**.

### 🚫 Điều Cấm Kỵ
- **CẤM GRADIENT**: Không dùng gradient màu mè cho background, card, button hay text.
- **CẤM HIỆU ỨNG RẺ TIỀN**: Không dùng neon glow, glassmorphism mờ đục, hình khối trôi nổi (floating blobs).
- **CẤM BO TRÒN QUÁ ĐÀ**: Nút và thẻ chỉ dùng `rounded-md` (6px) hoặc `rounded-lg` (8px). Không dùng `rounded-full` cho container chính.
- **CẤM CÀI THƯ VIỆN UI MỚI**: Toàn bộ UI xây dựng trên Tailwind CSS v4 và Lucide icons có sẵn.

### 🎨 Thẩm Mỹ & Độ Hoàn Thiện
- **Dark Mode Hiện Đại**: Nền than chì sâu thẳm (`#0B0F14`), bề mặt panel (`#11161D`), viền sắc nét 1px (`#29313D`), chữ trắng sáng tương phản cao (`#F8FAFC`).
- **Tactile Feedback**: Mọi nút bấm và tương tác đều có chuyển động mượt trong 150ms (`transition-colors duration-150`, `active:scale-[0.98]`).
- **Typography Kỹ Thuật**: Số liệu %, code coverage, commit hashes luôn dùng font monospace kết hợp `tabular-nums` để số liệu thẳng hàng khi biến động.
- **Đèn Báo Trạng Thái Sống**: Các tác vụ chạy ngầm dùng chấm nhấp nháy (`animate-ping`) tinh tế.
- *(Chi tiết quy tắc xem tại [`client/AGENTS.md`](file:///e:/Express/CovAI-/client/AGENTS.md) và skill [`.agents/skills/covai-ui-components/SKILL.md`](file:///e:/Express/CovAI-/.agents/skills/covai-ui-components/SKILL.md))*.

---

## 4. Tiêu Chuẩn Backend, Database & Hàng Đợi (Enterprise Grade)

1. **Chuẩn ES Modules**: Toàn bộ Backend dùng `import / export` chuẩn (ESM), không dùng `require()`.
2. **Kiến Trúc 3 Tầng**: Phân tách rõ ràng Route (định tuyến) ➔ Controller (xử lý request/response) ➔ Service (chứa 100% logic nghiệp vụ).
3. **Prisma ORM & Hiệu Năng**:
   - Luôn sử dụng `select` để chọn lọc trường dữ liệu, tuyệt đối không query trần trụi các bảng snapshot/coverage nặng làm tràn bộ nhớ.
   - Các thao tác ghi đồng thời đa bảng phải bọc trong `prisma.$transaction(...)`.
4. **Hàng Đợi BullMQ & Redis**:
   - Mọi tác vụ nặng (chạy Docker runner, phân tích AST cả thư mục, gọi Gemini AI sinh test) **bắt buộc** phải đẩy vào BullMQ queue, không chặn Event Loop của Express.
   - Stream tiến độ công việc theo thời gian thực tới Frontend qua Socket.IO.
5. **Cách Ly & Dọn Dẹp File Tạm**:
   - File tạm của runner chỉ được phép tạo trong `server/.covai-temp/` và phải dọn dẹp sạch sẽ trong khối `finally`.
   - *(Chi tiết quy tắc xem tại [`server/AGENTS.md`](file:///e:/Express/CovAI-/server/AGENTS.md))*.

---

## 5. Quy Chuẩn Đóng Góp & Commit (Git Conventions)

Mọi commit của Agent và Developer nên tuân theo định dạng chuẩn Conventional Commits:
- `feat:` Thêm tính năng mới (vd: `feat(editor): add real-time collaborative code lens`)
- `fix:` Sửa lỗi (vd: `fix(coverage): resolve branch coverage calculation for arrow functions`)
- `refactor:` Tái cấu trúc mã nguồn mà không đổi logic (vd: `refactor(client): modularize dashboard tabs`)
- `docs:` Cập nhật tài liệu (vd: `docs: update system architecture and agent guidelines`)
- `perf:` Tối ưu hiệu năng truy vấn hoặc render

---

## 6. Bản Đồ Tài Liệu Kỹ Thuật (Documentation Map)

Mọi chi tiết kiến trúc và kế hoạch đã được quy hoạch trong [`docs/`](file:///e:/Express/CovAI-/docs):
- 📑 Mục lục tài liệu: [`docs/README.md`](file:///e:/Express/CovAI-/docs/README.md)
- 📋 Kế hoạch tính năng: [`docs/plans/`](file:///e:/Express/CovAI-/docs/plans)
- 📐 Đặc tả API & Hệ thống: [`docs/specs/`](file:///e:/Express/CovAI-/docs/specs)
- 🎨 Quy chuẩn UI/UX chi tiết: [`docs/rules/COVAI_FRONTEND_AGENT_RULES.md`](file:///e:/Express/CovAI-/docs/rules/COVAI_FRONTEND_AGENT_RULES.md)
- 🧪 Kỹ thuật System / E2E Test: [`docs/system-testing/`](file:///e:/Express/CovAI-/docs/system-testing)
- 🔬 Kỹ thuật Unit Test: [`docs/unit-testing/`](file:///e:/Express/CovAI-/docs/unit-testing)
