# CovAI Client – Frontend Developer & AI Agent Guidelines (`client/AGENTS.md`)

> **Áp dụng:** Cho tất cả mã nguồn bên trong thư mục [`client/`](file:///e:/Express/CovAI-/client).

---

## 1. Nguyên Tắc Thiết Kế UI/UX (Strict Developer Tool Style)

Giao diện CovAI là **công cụ kỹ thuật chuyên sâu cho kỹ sư phần mềm**, lấy cảm hứng từ GitHub Primer, Linear và shadcn/ui.

### 🚫 Điều Cấm Kỵ Tuyệt Đối
1. **CẤM GRADIENT**: Không dùng `linear-gradient` hay `radial-gradient` cho nền, nút bấm, card hay viền.
2. **CẤM NEON / GLOW / BLUR**: Không dùng neon glow, glassmorphism mờ mịt, hình khối trôi nổi (blobs).
3. **CẤM BO GÓC QUÁ ĐÀ**: Nút và thẻ chỉ dùng `rounded-md` hoặc `rounded-lg`. Không dùng `rounded-full` cho các container chính.
4. **CẤM CÀI THƯ VIỆN UI MỚI**: Không tự tiện cài thêm Ant Design, Material-UI, Bootstrap... Toàn bộ UI xây dựng trên Tailwind CSS v4 và Lucide icons có sẵn.

---

## 2. Hệ Thống Màu & Design Tokens

Tất cả màu sắc phải dùng biến CSS từ `client/src/index.css`:
- **Nền trang chính**: `var(--color-bg)` (`#0B0F14` Dark / `#FFFFFF` Light)
- **Nền Card / Panel**: `var(--color-surface)` (`#11161D` Dark / `#F8FAFC` Light)
- **Nền Cấp 2 / Input**: `var(--color-surface-secondary)` (`#171D25` Dark / `#F1F5F9` Light)
- **Viền 1px**: `var(--color-border)` (`#29313D` Dark / `#E2E8F0` Light)
- **Màu Chủ Đạo (Brand)**: `var(--color-primary)` (`#8B7CFD` Dark / `#6D5DFB` Light)
- **Semantic Status**:
  - Thành công (Pass): `var(--color-success)` (`#22C55E`)
  - Cảnh báo (Warn): `var(--color-warning)` (`#F59E0B`)
  - Lỗi (Fail): `var(--color-danger)` (`#EF4444`)

---

## 3. Quy Ước Code React 19 & Tailwind v4

1. **Hiển thị số liệu & Code**: Luôn dùng lớp font `font-mono` và `tabular-nums` cho số %, dòng code, mã commit để các số thẳng hàng khi cập nhật.
2. **Icon**: Đồng nhất dùng thư viện `lucide-react`, kích thước chuẩn `w-4 h-4` (inline) hoặc `w-5 h-5` (tiêu đề).
3. **Quản lý Server State**: Sử dụng `@tanstack/react-query` qua `client/src/lib/queryClient.js`. Hạn chế tự viết `useEffect` fetch dữ liệu thủ công.
4. **Loading States**: Luôn cung cấp trạng thái Skeleton loading (`client/src/components/common/Skeleton.jsx`) thay vì để màn hình trắng hoặc giật layout.

---

## 4. Ranh Giới Module
- **Tuyệt đối không import từ `server/`**.
- Hằng số dùng chung (AI Models, Roles, Socket protocol) phải lấy từ thư mục [`shared/`](file:///e:/Express/CovAI-/shared).
- Tham khảo mẫu component chuẩn tại [`.agents/skills/covai-ui-components/SKILL.md`](../.agents/skills/covai-ui-components/SKILL.md).
