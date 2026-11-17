# CovAI Client – Frontend Engineering & UI/UX Master Guidelines (`client/AGENTS.md`)

> **Phạm vi áp dụng:** Toàn bộ mã nguồn, component, styles, hooks và trang web bên trong thư mục [`client/`](file:///e:/Express/CovAI-/client).  
> **Mục tiêu tối thượng:** Xây dựng giao diện CovAI thành một **công cụ kỹ thuật đẳng cấp cao (World-Class Developer Tool)** cho kỹ sư phần mềm, kết hợp sự tối giản, chính xác của **GitHub Primer**, độ tinh tế, mượt mà của **Linear** và tính module hóa của **shadcn/ui**.

---

## 1. Triết Lý Thiết Kế Giao Diện (Design Philosophy: "Sleek Industrial")

Giao diện của CovAI không phải là một landing page quảng cáo bóng bẩy, mà là một **Engineering Workstation** (trạm làm việc kỹ thuật). Tiêu chuẩn cái "ĐẸP" ở đây được định nghĩa bởi:
- **Độ sắc nét & Tương phản chuẩn xác (Crisp Contrast)**: Tách bạch rõ ràng từng tầng giao diện bằng viền mỏng 1px và màu nền phân cấp, không dùng bóng đổ mờ mịt.
- **Mật độ thông tin tối ưu (High Data Density)**: Không lãng phí không gian hiển thị; code, bảng biểu, đồ thị và log phải dễ đọc, dễ quét mắt (scannable).
- **Phản hồi xúc giác tinh tế (Tactile Micro-interactions)**: Mọi thao tác hover, click, focus đều có chuyển động mượt mà trong 150ms (`transition-colors duration-150`, `active:scale-[0.98]`).
- **Thẩm mỹ Dark Mode hiện đại**: Nền xám đen sâu lắng, không đen tuyền 100%, kết hợp điểm nhấn tím nhạt (`#8B7CFD`) và xanh semantic trang nhã.

---

## 2. Những Điều Cấm Kỵ Tuyệt Đối (Strictly Forbidden Anti-Patterns)

1. **CẤM GRADIENT MÀU MÈ**:
   - Tuyệt đối KHÔNG dùng `linear-gradient`, `radial-gradient` cho background, button, text, border hay icon.
   - Mọi bề mặt phải là màu phẳng (flat solid) hoặc màu nền mờ đục có độ trong suốt đo lường được (translucent tint).
2. **CẤM NEON GLOW & GLASSMORPHISM RẺ TIỀN**:
   - Không dùng hiệu ứng phát sáng neon lòe loẹt, không dùng blur mờ đục kiểu kính mờ (frosted glass) che lấp chữ.
   - Không dùng các khối cầu trôi nổi (floating blobs) hay sóng lượn vô nghĩa thường thấy trên template AI.
3. **CẤM BO TRÒN QUÁ ĐÀ (OVER-ROUNDING)**:
   - Các nút bấm, card, modal, dropdown CHỈ ĐƯỢC dùng bo góc nhẹ: `rounded-md` (6px) hoặc `rounded-lg` (8px).
   - CẤM dùng `rounded-full` cho các nút bấm chính hoặc container (trừ avatar tròn hoặc dot chỉ báo trạng thái).
4. **CẤM TỰ TIỆN CÀI THƯ VIỆN UI MỚI**:
   - Tuyệt đối không tự ý `npm install` thêm Ant Design, MUI, Bootstrap, Chakra...
   - Toàn bộ giao diện được xây dựng từ **Tailwind CSS v4** và bộ icon **Lucide React** (`lucide-react`) có sẵn.

---

## 3. Hệ Thống Màu & Design Tokens Bắt Buộc

Tất cả màu sắc **BẮT BUỘC** sử dụng biến CSS định nghĩa trong [`client/src/index.css`](file:///e:/Express/CovAI-/client/src/index.css). Tuyệt đối không hardcode mã màu hex tùy tiện trong JSX.

### 🎨 Bảng Màu & Phân Cấp Bề Mặt (Surface Elevation)

| Biến CSS | Dark Mode (Mặc định) | Light Mode | Vị trí áp dụng |
| :--- | :--- | :--- | :--- |
| `--color-bg` | `#0B0F14` | `#FFFFFF` | Nền canvas ngoài cùng của trang web |
| `--color-surface` | `#11161D` | `#F8FAFC` | Nền Panel, Sidebar, Card chính, Header |
| `--color-surface-secondary` | `#171D25` | `#F1F5F9` | Nền ô Input, hàng chẵn Table, Dropdown menu, Code block |
| `--color-border` | `#29313D` | `#E2E8F0` | Đường kẻ viền mỏng 1px giữa các khối giao diện |
| `--color-text` | `#F8FAFC` | `#0F172A` | Tiêu đề, chữ chính (độ tương phản cao nhất) |
| `--color-text-secondary` | `#CBD5E1` | `#475569` | Nội dung phụ, nhãn mô tả, code comments |
| `--color-text-muted` | `#94A3B8` | `#64748B` | Timestamp, icon phụ, placeholder, phím tắt |
| `--color-primary` | `#8B7CFD` | `#6D5DFB` | Màu thương hiệu, nút hành động chính, tab đang chọn |
| `--color-primary-hover` | `#9D91FE` | `#5B4BE7` | Trạng thái hover của nút chính |
| `--color-focus` | `#6D5DFB` | `#6D5DFB` | Viền focus bàn phím (`ring-2 ring-[var(--color-focus)]/50`) |

### 🟢 Màu Trạng Thái Kỹ Thuật (Semantic Tints)
Không dùng màu quá rực. Luôn dùng công thức: **Nền trong suốt 10% + Chữ sáng màu + Viền trong suốt 20%**:
- **PASS (Thành công / 100% Coverage)**: 
  `bg-emerald-500/10 text-emerald-400 border border-emerald-500/20`
- **FAIL (Lỗi / Test trượt)**: 
  `bg-rose-500/10 text-rose-400 border border-rose-500/20`
- **WARN (Cảnh báo / Độ phủ thấp)**: 
  `bg-amber-500/10 text-amber-400 border border-amber-500/20`
- **INFO / RUNNING (Đang chạy test)**: 
  `bg-sky-500/10 text-sky-400 border border-sky-500/20`

---

## 4. Bí Quyết Xây Dựng Giao Diện ĐẸP & CHUYÊN NGHIỆP

Để giao diện CovAI toát lên vẻ cao cấp chuẩn Linear/GitHub, AI Agent cần áp dụng các kỹ thuật sau:

### 1. Phân Cấp Typography Chuẩn Xác
- **Tiêu đề trang**: `text-lg font-semibold tracking-tight text-[var(--color-text)]`
- **Tiêu đề phân mục**: `text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]`
- **Nội dung chung**: `text-sm text-[var(--color-text-secondary)]`
- **Số liệu, % Coverage, Hashes, Line numbers**: Bắt buộc thêm lớp `font-mono tabular-nums`. Thuộc tính `tabular-nums` giữ cho độ rộng của các chữ số bằng nhau, giúp các con số khi nhảy không bị giật layout.

### 2. Thiết Kế Nút Bấm & Tương Tác Xúc Giác (Tactile Buttons)
```jsx
// Nút bấm chuẩn kỹ thuật: Flat solid, hover sáng nhẹ, active lún nhẹ, focus viền tinh tế
<button className="inline-flex items-center justify-center gap-2 px-3.5 py-1.5 text-sm font-medium rounded-md transition-all duration-150 cursor-pointer bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-text-muted)] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus)]/40 disabled:opacity-50 disabled:cursor-not-allowed">
  <Play className="w-4 h-4 text-emerald-400 shrink-0" />
  <span>Run Test Suite</span>
</button>
```

### 3. Thẻ Card & Bảng Dữ Liệu (Developer Data Tables)
- **Card**: Bao bọc bằng đường viền 1px siêu mảnh: `bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5`.
- **Card Hover**: Thêm hiệu ứng highlight viền thanh lịch: `hover:border-[var(--color-primary)]/40 transition-colors duration-150`.
- **Table**: 
  - Header cố định, chữ nhỏ hoa: `text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-surface-secondary)]/50`.
  - Hàng dữ liệu: Padding compact `py-2.5 px-3`, phân cách bằng border 1px mỏng, hover nhẹ `hover:bg-[var(--color-surface-secondary)]/60`.

### 4. Đèn Chỉ Báo Trạng Thái Sống (Pulsing Live Dots)
Đối với các tác vụ đang chạy ngầm (chạy test suite, gọi Gemini sinh test case), hiển thị chấm trạng thái nhấp nháy:
```jsx
<span className="flex items-center gap-1.5 text-xs font-mono font-medium text-sky-400">
  <span className="relative flex h-2 w-2">
    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
    <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
  </span>
  Analyzing AST & Test Runner...
</span>
```

### 5. Skeleton Loaders & Trạng Thái Trống (Empty States)
- **Tuyệt đối không để màn hình trắng** trong lúc fetch dữ liệu. Luôn dùng component [`Skeleton.jsx`](file:///e:/Express/CovAI-/client/src/components/common/Skeleton.jsx) mô phỏng chính xác khung hình của Card/Table.
- **Empty State**: Khi một project chưa có test suite nào, không chỉ in ra dòng chữ đơn điệu. Hãy tạo một khung viền nét đứt (`border-dashed border-[var(--color-border)] rounded-lg p-8 text-center`), kèm icon Lucide mờ nhạt và 1 nút bấm kêu gọi hành động (Call To Action).

---

## 5. Tiêu Chuẩn Kỹ Thuật React 19 & Hiệu Năng

1. **Quản Lý Server State**:
   - Sử dụng `@tanstack/react-query` thông qua [`client/src/lib/queryClient.js`](file:///e:/Express/CovAI-/client/src/lib/queryClient.js).
   - Thiết lập `staleTime` hợp lý (ví dụ: 30s - 60s cho danh sách project) để tránh spam API liên tục khi chuyển tab.
2. **Tối Ưu Re-render**:
   - Với các cây thư mục file lớn (`fileTreeUtils.js`) hoặc danh sách hàng nghìn dòng code trong Monaco Editor: bắt buộc dùng `useMemo` và `useCallback`.
3. **Monaco Editor & Yjs Integration**:
   - Giao diện Editor phải luôn đồng bộ theme (`vs-dark` cho Dark mode và `vs` cho Light mode).
   - Sử dụng Code Lens và Gutter glyphs đúng theo palette của CovAI để hiển thị dòng đã test (xanh) và dòng thiếu test (đỏ).

---

## 6. Ranh Giới Kiến Trúc
- **Không import từ `server/`**: Cấm import file, hàm, class từ thư mục backend.
- **Dùng `shared/`**: Các enum `PROJECT_ROLES`, danh sách `AI_MODELS`, giới hạn gói tin `EDITOR_LIMITS` lấy trực tiếp từ [`shared/`](file:///e:/Express/CovAI-/shared).
- **Mẫu component có sẵn**: Xem chi tiết các component mẫu tại [`.agents/skills/covai-ui-components/SKILL.md`](../.agents/skills/covai-ui-components/SKILL.md).
