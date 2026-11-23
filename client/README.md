# CovAI Client — Frontend Web Application

Ứng dụng Frontend chính của nền tảng **CovAI**, được xây dựng trên nền tảng **React 19** và **Tailwind CSS v4** với giao diện kỹ thuật chuyên nghiệp (Developer Tool Style) lấy cảm hứng từ GitHub Primer, Linear và shadcn/ui.

---

## 🛠️ Công Nghệ & Thư Viện Cốt Lõi

- **Core Framework**: [React 19](https://react.dev/) + [Vite](https://vite.dev/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) (Hệ thống Design Token qua biến CSS trong `src/index.css`)
- **Code Editor & Collaboration**: [Monaco Editor](https://microsoft.github.io/monaco-editor/) + [Yjs](https://yjs.dev/) (CRDT realtime coding)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Data Fetching & State**: [@tanstack/react-query v5](https://tanstack.com/query) + [Axios](https://axios-http.com/)
- **Realtime**: [Socket.IO Client](https://socket.io/)
- **Routing**: [React Router v7](https://reactrouter.com/)

---

## 📁 Cấu Trúc Thư Mục (`client/src/`)

```text
client/src/
├── components/          # Toàn bộ UI components
│   ├── auth/            # Form đăng nhập, đăng ký, quên mật khẩu
│   ├── common/          # Button, Card, Badge, Modal, Popover dùng chung
│   ├── dashboard/       # 8 phân hệ chuyên sâu của CovAI:
│   │   ├── unified/     # Overview tổng hợp chất lượng, coverage và test pyramid
│   │   ├── editor/      # Collaborative IDE & Code Lens
│   │   ├── integration/ # API Integration Test (Supertest)
│   │   ├── system/      # System / E2E Test (Playwright, Cypress)
│   │   ├── trustworthiness/ # Đánh giá độ tin cậy AI Chatbot
│   │   ├── portfolio/   # Quản lý chất lượng đa dự án
│   │   ├── import/      # Tải lên ZIP & kết nối GitHub
│   │   └── settings/    # Phân quyền thành viên & hạn ngạch AI
│   └── (Landing)        # Hero, Navbar, Features, Workflow, Pricing, Footer
├── contexts/            # React Contexts (Notification, RunningProcess, Theme)
├── hooks/               # Custom React Hooks (useAuth, useSocket, useProjectAccess...)
├── lib/                 # Cấu hình Monaco Editor, QueryClient, Draft storage
├── pages/               # Các trang chính: LoginPage, DashboardPage, ProjectSelectionPage...
├── services/            # API services gọi Backend Express
├── utils/               # Tiện ích xử lý cây thư mục, tìm kiếm fuzzy
├── App.jsx              # Định tuyến ứng dụng (App Router)
├── main.jsx             # Entry point React DOM
└── index.css            # Toàn bộ CSS variables và cấu hình Tailwind v4
```

---

## 🚀 Khởi Chạy Local

### 1. Cài đặt Dependencies:
```bash
npm install
```

### 2. Cấu hình Biến Môi Trường:
Tạo file `.env` từ `.env.example`:
```env
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

### 3. Chạy Development Server:
```bash
npm run dev
```
Truy cập ứng dụng tại: `http://localhost:5173`.

### 4. Đóng Gói Production:
```bash
npm run build
npm run preview
```

---

## 📜 Quy Chuẩn Lập Trình Cho AI & Dev
Vui lòng tham khảo tài liệu hướng dẫn bắt buộc:
- [`client/AGENTS.md`](./AGENTS.md): Quy tắc chuyên biệt cho Frontend.
- [`.agents/skills/covai-ui-components/SKILL.md`](../.agents/skills/covai-ui-components/SKILL.md): Mẫu component chuẩn.
- [`docs/rules/COVAI_FRONTEND_AGENT_RULES.md`](../docs/rules/COVAI_FRONTEND_AGENT_RULES.md): Đặc tả màu sắc & Design Tokens.
