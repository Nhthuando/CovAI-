# CovAI – Developer & AI Agent Working Guidelines (`AGENTS.md`)

> **Mục đích:** Tài liệu này là kim chỉ nam bắt buộc cho tất cả các AI Agent và lập trình viên khi đọc, tạo mới, chỉnh sửa hoặc refactor mã nguồn trong dự án **CovAI**.

---

## 1. Kiến Trúc Dự Án (Monorepo Architecture)

Dự án CovAI được tổ chức theo mô hình Monorepo tinh gọn:
- [`client/`](file:///e:/Express/CovAI-/client): Ứng dụng Frontend (React 19, Vite, Tailwind CSS v4, Monaco Editor, React Query, Yjs client).
- [`server/`](file:///e:/Express/CovAI-/server): Ứng dụng Backend (Node.js ES Modules, Express v5, Prisma ORM, PostgreSQL, Redis + BullMQ, Babel AST/Esprima, Socket.IO).
- [`shared/`](file:///e:/Express/CovAI-/shared): Module chia sẻ dùng chung giữa Client và Server (Roles, Permissions, AI Models, Socket Protocol).
- [`docs/`](file:///e:/Express/CovAI-/docs): Toàn bộ tài liệu kiến trúc, API specs, plans và nghiệm thu (tham khảo [`docs/README.md`](file:///e:/Express/CovAI-/docs/README.md)).

### ⛔ Quy tắc ranh giới tuyệt đối (Boundaries)
1. **Khóa cứng thư mục Root (Strict Root Whitelist)**:
   - Thư mục root áp dụng cơ chế Whitelist tuyệt đối (`/*` và `!`).
   - Chỉ duy nhất các thư mục sau được tồn tại ở root: `.agents/`, `client/`, `docs/`, `server/`, `shared/`.
   - Chỉ duy nhất các file sau được tồn tại ở root: `.gitignore`, `AGENTS.md`, `api.http`, `docker-compose.yml`, `package.json`, `package-lock.json`, `README.md`.
   - **CẤM TỰ Ý TẠO FILE/FOLDER MỚI Ở ROOT**: Mọi tài liệu mới phải đưa vào `docs/`, file tạm phải dọn dẹp, script test đưa vào `server/scripts/` hoặc `tests/`. Git sẽ tự động chặn mọi file ngoài danh sách trên.
2. **Không import chéo**: `server/` tuyệt đối KHÔNG import file từ `client/` và ngược lại.
3. **Dùng module `shared/`**: Các hằng số, enum (vai trò `OWNER/EDITOR/VIEWER`, danh sách AI models, kích thước gói tin realtime) phải lấy từ `shared/`. Không định nghĩa lại cục bộ gây lệch pha.
4. **Bảo toàn Comment & Docstring**: Giữ nguyên toàn bộ comment logic, license và chú thích hiện có. Không tự ý xóa code hoặc comment không thuộc phạm vi công việc.

---

## 2. Tiêu Chuẩn Frontend UI/UX (Strict Developer Tool Style)

Giao diện CovAI là một **công cụ kỹ thuật cho kỹ sư phần mềm (Developer Tool / Engineering Platform)**, lấy cảm hứng từ GitHub Primer, Linear và shadcn/ui.

### 🚫 Điều cấm kỵ (Strictly Forbidden)
- **CẤM GRADIENT**: Tuyệt đối không dùng `linear-gradient`, `radial-gradient` cho background, button, card, border hoặc text.
- **CẤM HIỆU ỨNG MÀU MÈ**: Không dùng neon glow, glassmorphism, blur mờ mịt, bóng đổ quá đậm, hay các hình khối trôi nổi (floating blobs).
- **CẤM BO GÓC QUÁ ĐÀ**: Không dùng `rounded-full` cho button/card chính (chỉ dùng `rounded-md` hoặc `rounded-lg`).
- **CẤM TỰ Ý CÀI THƯ VIỆN UI MỚI**: Không tự tiện `npm install` thêm Ant Design, MUI, Bootstrap... Dự án đã có sẵn Tailwind CSS v4 và Lucide icons.

### 🎨 Hệ thống màu & Design Tokens
Tất cả màu sắc phải tuân thủ biến CSS định nghĩa trong hệ thống (xem chi tiết tại [`docs/rules/COVAI_FRONTEND_AGENT_RULES.md`](file:///e:/Express/CovAI-/docs/rules/COVAI_FRONTEND_AGENT_RULES.md)):

```css
/* Dark Mode (Mặc định cho môi trường kỹ thuật) */
--color-bg: #0B0F14;
--color-surface: #11161D;
--color-surface-secondary: #171D25;
--color-border: #29313D;
--color-text: #F8FAFC;
--color-text-secondary: #CBD5E1;
--color-text-muted: #94A3B8;

/* Brand & Interactive */
--color-primary: #8B7CFD;
--color-primary-hover: #9D91FE;
--color-focus: #6D5DFB;

/* Semantic */
--color-success: #22C55E;
--color-warning: #F59E0B;
--color-danger: #EF4444;
--color-info: #0284C7;
```

### 🧩 Chuẩn Component:
- **Button**: Phẳng (flat solid) hoặc outline viền mỏng 1px, hiệu ứng hover nhẹ nhàng (`transition-colors duration-150`).
- **Card / Panel**: Nền `--color-surface`, viền 1px `--color-border`, padding đều đặn.
- **Icon**: Đồng nhất dùng `lucide-react`, kích thước chuẩn `w-4 h-4` (inline) hoặc `w-5 h-5` (tiêu đề).
- **Typography & Số liệu**: Hiển thị số liệu, metrics, code, hash luôn dùng lớp font monospace và `tabular-nums` để thẳng cột.

---

## 3. Tiêu Chuẩn Backend & Database

1. **Chuẩn ES Modules**: Toàn bộ server dùng `import / export` (ESM), không dùng `require()` (trừ các trường hợp bắt buộc trong CJS sandbox).
2. **Prisma ORM**:
   - Sử dụng client Prisma qua [`server/src/config/prisma.js`](file:///e:/Express/CovAI-/server/src/config/prisma.js).
   - Truy vấn luôn chọn lọc fields (`select`) đối với các bảng lớn, tránh query dư thừa dữ liệu snapshot nặng.
3. **Background Jobs & Tracing**:
   - Các tác vụ nặng (chạy test suite, phân tích AST, gọi LLM Gemini sinh test) phải đẩy qua hàng đợi BullMQ / Redis.
   - Luôn emit event qua Socket.IO để cập nhật tiến độ theo thời gian thực tới frontend.
4. **Xử lý File & Snapshot**:
   - File tạm của runner luôn đặt trong `server/.covai-temp/` và phải dọn dẹp sạch sẽ sau khi thực thi.

---

## 4. Tài Liệu Hướng Dẫn Kỹ Thuật (Documentation Map)

Mọi chi tiết kiến trúc và kế hoạch đã được quy hoạch trong [`docs/`](file:///e:/Express/CovAI-/docs):
- Kế hoạch tính năng: [`docs/plans/`](file:///e:/Express/CovAI-/docs/plans)
- Đặc tả API & Hệ thống: [`docs/specs/`](file:///e:/Express/CovAI-/docs/specs)
- Quy chuẩn chi tiết UI/UX: [`docs/rules/COVAI_FRONTEND_AGENT_RULES.md`](file:///e:/Express/CovAI-/docs/rules/COVAI_FRONTEND_AGENT_RULES.md)
- Kỹ thuật System / E2E Test: [`docs/system-testing/`](file:///e:/Express/CovAI-/docs/system-testing)
- Kỹ thuật Unit Test: [`docs/unit-testing/`](file:///e:/Express/CovAI-/docs/unit-testing)
