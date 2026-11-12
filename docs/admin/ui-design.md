# Thiết Kế Giao Diện Tùy Biến (Custom UI/UX Design System)

> **Ngôn ngữ thị giác độc lập dành riêng cho CovAI Admin Console**  
> Ứng dụng nguyên lý thiết kế từ `frontend-design` và `covai-ui-components` kết hợp kiến trúc components tùy biến độc lập (Custom Components), mang phong cách "Tactile Obsidian & Cyber Emerald".

---

## 1. Định Hướng Thẩm Mỹ & Trải Nghiệm (Aesthetic Direction)

Giao diện trang chính của CovAI tập trung vào trải nghiệm viết mã và biên tập test case với phong cách IDE. Ngược lại, **Admin Console là Trung tâm Tác chiến (Mission Control)** của toàn bộ hệ sinh thái CovAI:

- **Mật độ thông tin cực cao (High Information Density)**: Tối ưu từng pixel hiển thị, hạn chế khoảng trắng lãng phí, giúp kỹ sư vận hành có thể quét qua hàng chục hàng dữ liệu và chỉ số hệ thống mà không cần cuộn trang liên tục.
- **Phong cách Tactical Slate & Cyber Emerald**: Không sử dụng gradient rực rỡ hay hiệu ứng hào nhoáng lãng phí tài nguyên GPU. Thay vào đó là bảng màu tối thẳm (Deep Dark Space), các đường viền sắc nét 1px chuẩn công nghiệp, và màu xanh lục điện tử (Cyber Emerald `#00E599`) báo hiệu hệ thống vận hành hoàn hảo.
- **Typography Monospace Chuẩn Xác**: Mọi số liệu đo lường, thời gian thực thi mili-giây, commit hash, UUID và token usage đều sử dụng font Monospace kèm thuộc tính `font-variant-numeric: tabular-nums` để số liệu không bị nhảy lệch khi cập nhật realtime.

---

## 2. Bảng Màu Thiết Kế Độc Lập (Admin Design Tokens)

Hệ thống màu sắc được tách biệt hoàn toàn thông qua tiền tố CSS variables `--admin-*`:

| Tên Token | Mã Hex | Vai trò trong giao diện |
| :--- | :--- | :--- |
| `--admin-bg-void` | `#080B10` | Nền sâu thẳm toàn màn hình, tạo độ tương phản tối đa. |
| `--admin-surface-base` | `#0D1117` | Bề mặt nền DataGrid và vùng nội dung chính. |
| `--admin-surface-raised` | `#161B22` | Bề mặt Sidebar, Topbar, Cards và Inspector Drawer. |
| `--admin-surface-overlay` | `#21262D` | Bề mặt Popover, Dropdown Menu, Modal và Tooltip. |
| `--admin-border-subtle` | `#21262D` | Đường viền ngăn cách nhẹ giữa các cột và hàng. |
| `--admin-border-strong` | `#30363D` | Đường viền phân cách các phân vùng lớn hoặc trạng thái focus. |
| `--admin-accent-primary` | `#00E599` | Xanh ngọc lục bảo chiến thuật (Tactical Emerald): Nút hành động chính, trạng thái active, kết nối thành công. |
| `--admin-accent-telemetry` | `#38BDF8` | Xanh Cyan: Dữ liệu mạng, truy vấn SQL, khóa ngoại FK, badge thông số. |
| `--admin-status-warning` | `#F59E0B` | Vàng hổ phách (Amber): Cảnh báo hàng đợi, job bị delay, chạm 80% quota. |
| `--admin-status-danger` | `#EF4444` | Đỏ thẫm (Crimson): Job thất bại, lỗi hệ thống, nút xóa vĩnh viễn. |
| `--admin-text-high` | `#F0F6FC` | Văn bản chính, tiêu đề bảng, số liệu lớn. |
| `--admin-text-medium` | `#8B949E` | Nhãn cột, mô tả ngắn, metadata phụ trợ. |
| `--admin-text-low` | `#484F58` | Văn bản mờ, placeholder, timestamp cũ. |

---

## 3. Khung Bố Cục Tác Chiến (Admin Layout Architecture)

```
+--------------------------------------------------------------------------------------------------+
| Topbar (48px) : [CovAI ADMIN] [Env: Production] [⌘K Search Everything...]   [Pulse: ● 4ms] [User] |
+-----------------------+--------------------------------------------------------------------------+
| Sidebar (240px)       | Main Canvas (Flexible Edge-to-Edge)                                      |
|                       |                                                                          |
| ⚡ SYSTEM OVERVIEW    | [DataGrid Toolbar: Model: Job (1,420 records)] [Filter] [Columns] [Export] |
| - Dashboard           | +----------------------------------------------------------------------+ |
| - Health & Metrics    | | [ ] ID     | Status   | Type        | User     | Started At  | Actions | |
|                       | +----------------------------------------------------------------------+ |
| 🗄️ DATABASE (67)      | | [ ] #jb_91 | COMPLETED| AST_PARSER  | @alice   | 2m ago      | [...]   | |
| ▼ Auth & Accounts (3) | | [ ] #jb_92 | FAILED   | DOCKER_TEST | @bob     | 1m ago      | [...]   | |
|   - User              | | [ ] #jb_93 | ACTIVE   | AI_GENERATE | @carol   | Just now    | [...]   | |
|   - Notification      | +----------------------------------------------------------------------+ |
|   - AdminAuditLog     |                                                                          |
| ▶ Projects (8)        |                                                    +-------------------+ |
| ▶ AI Trust (15)       |                                                    | Record Inspector  | |
| ▶ Testing (13)        |                                                    | Drawer (Slide-in) | |
| ▶ Coverage (5)        |                                                    | - Form Inspector  | |
| ▶ BullMQ Queues (3)   |                                                    | - JSON Monaco Tree| |
| ▶ Collab Yjs (14)     |                                                    | - FK Relations    | |
| ▶ AI Mutators (6)     |                                                    +-------------------+ |
+-----------------------+--------------------------------------------------------------------------+
```

### 3.1. Topbar Tác Chiến (Mission Bar)
- Chiều cao cố định 48px, viền dưới 1px viền `#21262D`.
- **Live System Pulse**: Hiển thị chấm tín hiệu nhấp nháy xanh lục (`#00E599`) kèm độ trễ phản hồi WebSocket (ví dụ: `4ms`).
- **Command Palette Trigger**: Ô tìm kiếm trung tâm hiển thị shortcut `⌘K` (hoặc `Ctrl+K`), cho phép nhảy nhanh tới bất kỳ trang nào.
- **Tenant & Environment Indicator**: Nhãn nổi bật hiển thị môi trường hiện tại (`PROD` đỏ cam hoặc `DEV` xanh lam) để tránh thao tác nhầm lẫn trên dữ liệu thật.

### 3.2. Sidebar Nhóm Domain Động (Collapsible Domain Tree)
- Liệt kê trực quan 8 Domain nhóm bảng dữ liệu kèm số lượng records trong từng bảng.
- Hỗ trợ thu gọn/mở rộng từng nhóm cây thư mục.
- Ô tìm kiếm nhanh bảng (Table Filter Input) trên đầu sidebar giúp lọc ngay bảng cần tìm trong tích tắc.

---

## 4. Thư Viện Custom Components Chuyên Biệt (Bespoke Admin UI)

Thay vì dùng các thư viện UI đại trà, hệ thống xây dựng bộ component riêng biệt phục vụ chuẩn mực cao nhất của công cụ quản trị kỹ thuật:

### 4.1. `AdminDataGrid` (Lưới Dữ Liệu Tối Cao)
- **Cuộn ảo (Virtual Scrolling)**: Sử dụng kỹ thuật ảo hóa DOM (chỉ render khoảng 30 hàng đang nằm trong khung nhìn) giúp duy trì tốc độ 60fps mượt mà kể cả khi danh sách có hàng ngàn bản ghi.
- **Sticky Column & Actions**: Cột Checkbox chọn hàng và cột Thao tác (Actions) luôn được cố định ở 2 mép màn hình khi cuộn ngang.
- **Kéo thả điều chỉnh độ rộng cột (Column Resizing)**: Người dùng có thể kéo mép tiêu đề cột để mở rộng hoặc thu nhỏ tùy ý.
- **Dynamic Cell Renderers**:
  - `StatusPill`: Render tự động các trạng thái (`SUCCESS`, `PENDING`, `FAILED`, `ARCHIVED`) với màu sắc và icon tương ứng.
  - `TimestampCell`: Hiển thị thời gian tương đối (`2 phút trước`) và hiển thị ISO timestamp đầy đủ khi hover chuột.
  - `ForeignKeyBadge`: Huy hiệu màu cyan clickable, bấm vào để mở bản ghi cha/con tương ứng.
  - `JsonPreviewCell`: Hiển thị số lượng keys và mở nhanh xem cấu trúc JSON.

### 4.2. `FilterExpressionBuilder` (Bộ Xây Dựng Biểu Thức Lọc)
- Cho phép người dùng kết hợp không giới hạn số lượng điều kiện lọc theo cấu trúc:
  `[Tên Cột] ──► [Toán Tử (Bằng/Chứa/Lớn hơn...)] ──► [Giá Trị Đầu Vào]`
- Tự động gợi ý danh sách các trường dựa trên schema DMMF của bảng đang mở.
- Nút "Apply Filters" và phím tắt `Enter` để kích hoạt truy vấn tức thì.

### 4.3. `RecordInspectorDrawer` (Ngăn Kéo Kiểm Tra & Biên Tập)
- Trượt êm ái từ mép phải màn hình (độ rộng 520px hoặc có thể phóng to toàn màn hình).
- **Tab 1: Form Inspector**: Xem và sửa các trường dữ liệu dưới dạng form nhập liệu sắc nét.
- **Tab 2: JSON Editor**: Trình biên tập Monaco Editor hỗ trợ format, kiểm tra lỗi cú pháp JSON và hiển thị màu syntax.
- **Tab 3: Relations Explorer**: Hiển thị danh sách các bản ghi liên quan (Foreign Keys) dưới dạng cây phân cấp.
- **Tab 4: Audit History**: Xem lịch sử các lần ai đã chỉnh sửa bản ghi này trong quá khứ.

### 4.4. `CommandPalette` (`⌘K` Quick Action Hub)
- Hộp thoại tìm kiếm toàn cục mở ra tức thời khi nhấn `⌘K` (Mac) hoặc `Ctrl+K` (Windows).
- Cho phép:
  - Gõ tên bất kỳ bảng nào trong 67 bảng để nhảy thẳng tới bảng đó.
  - Gõ email hoặc ID người dùng để mở trang hồ sơ và quota.
  - Gõ tên queue để mở console điều khiển BullMQ.
  - Chạy nhanh các lệnh tác vụ: "Retry all failed jobs", "Purge temp folder", "Check DB health".

### 4.5. `DangerousActionModal` (Bảo Vệ Thao Tác Nguy Hiểm 2 Bước)
- Áp dụng cho các thao tác: Xóa vĩnh viễn (Hard Delete), Xóa hàng loạt (Bulk Delete), Khóa tài khoản vĩnh viễn, hoặc Purge hàng đợi.
- Yêu cầu người dùng phải **gõ chính xác một chuỗi ký tự ngẫu nhiên hoặc tên bảng** (ví dụ: gõ `"DELETE Job"` hoặc `"CONFIRM"`) trước khi nút thực thi chuyển từ trạng thái Disable sang Enable.
- Hiển thị bảng tóm tắt số lượng bản ghi sẽ bị ảnh hưởng trực tiếp trước khi người dùng ra quyết định.

### 4.6. `LiveLogTerminal` (Màn Hình Log Dòng Lệnh Realtime)
- Thiết kế như giao diện dòng lệnh đen bóng (Terminal) để stream trực tiếp log đầu ra của các tiến trình Docker runner và BullMQ worker.
- Hỗ trợ: Tự động cuộn theo dòng mới (Auto-scroll), Nút tạm dừng (Pause stream), Tìm kiếm chuỗi log, và Nút sao chép toàn bộ log.
