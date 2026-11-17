# CovAI UI Styling Rules

> Được áp dụng tự động cho toàn bộ mã nguồn thuộc thư mục `client/src/`.

## 1. Nguyên Tắc Thiết Kế (Design Principles)
- **Cảm giác công cụ kỹ sư**: Gọn gàng, kỹ thuật, trực quan, phân cấp thông tin rõ ràng.
- **Không trang trí thừa**: Mỗi pixel, đường viền, icon đều phải có mục đích truyền tải thông tin.
- **Tập trung vào dữ liệu**: Code, logs, AST tree, metrics coverage là nhân vật chính. Giao diện nền phải hỗ trợ tối đa việc đọc và tập trung.

## 2. Bảng Lớp Giao Diện (Surface Hierarchy)
- **Lớp 0 (Nền trang - Base Background)**: `--color-bg` (`#0B0F14` Dark / `#FFFFFF` Light).
- **Lớp 1 (Panel / Card chính)**: `--color-surface` (`#11161D` Dark / `#F8FAFC` Light) + viền 1px `--color-border`.
- **Lớp 2 (Input / Dropdown / Bảng con)**: `--color-surface-secondary` (`#171D25` Dark / `#F1F5F9` Light).
- **Lớp 3 (Modal / Popover nổi)**: Đổ bóng nhẹ `shadow-lg`, nền `--color-surface` với viền rõ ràng.

## 3. Quy Ước Viết Code React / Tailwind
- Sử dụng function components với React 19 hooks chuẩn (`useState`, `useMemo`, `useCallback`).
- Quản lý trạng thái server bằng `@tanstack/react-query`.
- Đặt tên file theo chuẩn PascalCase cho Component (`Button.jsx`, `MetricCard.jsx`) và camelCase cho hooks/utils (`useTheme.js`).
