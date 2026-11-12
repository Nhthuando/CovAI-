# CovAI – Kim Chỉ Nam Kiến Trúc Dự Án & Quy Chuẩn Lập Trình (`project-architecture.md`)

> **Cấp độ áp dụng:** Bắt buộc tuân thủ 100% đối với toàn bộ kỹ sư phần mềm và AI Agent khi đọc, tạo mới, chỉnh sửa hoặc refactor mã nguồn trong dự án **CovAI**.  
> **Tài liệu tham chiếu tối cao:** Được đúc kết và chuẩn hóa từ `AGENTS.md`, `client/AGENTS.md`, `server/AGENTS.md` và mã nguồn thực tế của hệ thống.

---

## 1. Cấu Trúc Monorepo & Khóa Cứng Root (Strict Root Whitelist)

Dự án CovAI áp dụng cơ chế khóa cứng thư mục gốc (Root Whitelist Lockdown):

### 1.1. Danh Sách Whitelist Tuyệt Đối Tại Root
- **Chỉ DUY NHẤT 5 thư mục sau được phép tồn tại ở root**:
  - `/.agents/`: Quy tắc, skills và hướng dẫn vận hành chuyên biệt cho AI Agent.
  - `/client/`: Ứng dụng Frontend (React 19, Vite, Tailwind CSS v4, Monaco Editor, React Query, Yjs).
  - `/docs/`: Toàn bộ tài liệu kiến trúc, specs, plans, admin và runbooks.
  - `/server/`: Ứng dụng Backend (Node.js ESM, Express v5, Prisma ORM, PostgreSQL, Redis, BullMQ, Babel AST, Socket.IO).
  - `/shared/`: Thư viện dùng chung (Single Source of Truth) giữa Client và Server.
- **Chỉ DUY NHẤT 7 file sau được phép tồn tại ở root**:
  - `.gitignore`
  - `AGENTS.md`
  - `api.http`
  - `docker-compose.yml`
  - `package.json`
  - `package-lock.json`
  - `README.md`
- 🚫 **CẤM TỰ Ý TẠO THÊM FILE HOẶC FOLDER Ở ROOT**: Mọi file tạm, script test phải đặt trong `server/scripts/` hoặc `scratch/` và tự động dọn dẹp sau khi dùng.

---

## 2. Chi Tiết Kiến Trúc Thư Mục (Directory Structure Breakdown)

### 2.1. Phân Hệ Frontend (`client/`)

```text
client/
├── src/
│   ├── assets/            # Hình ảnh tĩnh, icons SVG, logos
│   ├── components/        # UI Components phân theo domain chức năng
│   │   ├── auth/          # Component xác thực: Form đăng nhập, đăng ký, OAuth callback
│   │   ├── common/        # Component tái sử dụng: Modal, Tooltip, GlobalErrorBoundary, ProcessIndicator
│   │   ├── dashboard/     # Giao diện Workspace, Quản lý Project, File Tree, Test Runner, Reports
│   │   └── editor/        # Monaco Editor, Code Lens, Tab Manager, Realtime Collaborative Cursor
│   ├── contexts/          # React Contexts toàn cục (ThemeContext, NotificationContext, RunningProcessContext)
│   ├── hooks/             # Custom React Hooks (useAuth, useSocket, useProjectAccess, useUnifiedDashboard...)
│   ├── lib/               # Thư viện khởi tạo bên thứ 3 (axios instance, query client)
│   ├── pages/             # Các trang định tuyến cấp cao (LandingPage, LoginPage, DashboardPage, ProjectSelectionPage...)
│   ├── services/          # Tầng gọi API qua HTTP (auth.service, project.service, job.service, report.service...)
│   ├── shared/            # Bản sao đồng bộ từ root `shared/` phục vụ bundling Vite
│   ├── styles/            # Theme CSS mở rộng và cấu hình biến giao diện
│   ├── utils/             # Hàm tiện ích thuần túy (date formatting, text truncate, classNames helper)
│   ├── App.jsx            # Router trung tâm (`react-router-dom`) và Provider Wrappers
│   ├── index.css          # Tailwind CSS v4 root stylesheet & CSS Design Tokens
│   └── main.jsx           # Entry point của React 19
├── vite.config.js         # Cấu hình Vite, alias `@shared`, proxy `/api` sang backend
└── package.json           # Dependencies Frontend
```

### 2.2. Phân Hệ Backend (`server/`)

```text
server/
├── prisma/
│   ├── schema.prisma      # Khai báo 67+ Tables, Relations, Indexes, Enums
│   ├── seed.js            # Script seeding dữ liệu mẫu ban đầu
│   └── migrations/        # Lịch sử thay đổi lược đồ database PostgreSQL
├── src/
│   ├── config/            # Cấu hình kết nối (prisma.js singleton, firebase.js, localProjectStorage.js)
│   ├── constants/         # Các hằng số nội bộ của server
│   ├── controllers/       # Tầng tiếp nhận HTTP Request, validate và trả về Response JSON
│   ├── errors/            # Custom Error Classes (fallback.errors.js, serviceError.js)
│   ├── middlewares/       # Middleware bảo vệ (auth.middleware, rateLimit.middleware, upload.middleware)
│   ├── realtime/          # Socket.IO Gateways (projectEditor.gateway.js, portfolioSocket.emitter.js)
│   ├── routes/            # Khai báo URL endpoints và gắn Middleware (project.route.js, job.route.js...)
│   ├── services/          # Tầng 100% nghiệp vụ tính toán (AST parsing, BullMQ, Gemini AI, Prisma queries)
│   ├── utils/             # Tiện ích backend (crypto.js, pathSanitizer.js, jestDetector.js, serviceError.js)
│   └── validators/        # Schema Validation đầu vào bằng Zod (project.validation.js, auth.validation.js)
├── .covai-temp/           # Thư mục sandbox tạm cho Docker test runner & giải nén file (tự dọn dẹp)
├── index.js               # Entry point Express, Socket.IO server, DB connection & route registration
└── package.json           # Dependencies Backend (ES Modules)
```

### 2.3. Phân Hệ Dùng Chung (`shared/`)

`shared/` là **Nguồn Sự Thật Duy Nhất (Single Source of Truth)** cho cả Client và Server:
- `aiModels.js`: Danh sách các model AI được hỗ trợ (`gemini-2.5-flash`, `gemini-3.5-flash-lite`...) và token limit.
- `projectRoles.js`: Định nghĩa vai trò chuyên môn (`PM`, `DEVELOPER`, `TESTER`, `AI_ENGINEER`...).
- `projectAccess.js`: Vai trò dự án (`OWNER`, `EDITOR`, `VIEWER`) và ma trận năng lực (`PROJECT_CAPABILITIES`).
- `editorProtocol.js`: Giao thức gói tin Yjs và giới hạn payload cộng tác thời gian thực.
- `editorBatchQueue.js`: Cơ chế gom cụm cập nhật (batching) trong bộ soạn thảo.
- `systemExpectedOutcome.js`: Định nghĩa trạng thái kỳ vọng của hệ thống kiểm thử.

---

## 3. Ranh Giới Module & Quy Tắc Bất Di Bất Dịch (Module Boundaries)

1. **Tuyệt Đối Không Import Chéo (Zero Cross-Imports)**:
   - File trong `server/` **CẤM** import bất kỳ file nào từ `client/`.
   - File trong `client/` **CẤM** import bất kỳ file nào từ `server/`.
   - Giao tiếp giữa Client và Server **duy nhất** thông qua **HTTP REST API** và **Socket.IO WebSocket**.
2. **Quy Tắc Import từ `shared/`**:
   - Khi cần dùng vai trò (`OWNER`, `EDITOR`), quyền (`PROJECT_CAPABILITIES`) hay model AI: **BẮT BUỘC** lấy từ `shared/`. Cấm định nghĩa lại cục bộ.
3. **Bảo Toàn Comment & JSDoc**:
   - Giữ nguyên toàn bộ comment logic, license, JSDoc hiện có trong mã nguồn. Tuyệt đối không xóa bỏ comment ngoài phạm vi công việc.
4. **Không Nuốt Lỗi Âm Thầm (No Silent Error Swallowing)**:
   - CẤM khối `catch (e) {}` rỗng. Mọi lỗi phải được log qua `console.error` hoặc chuyển tiếp qua `next(error)` / `ServiceError`.

---

## 4. Luồng Đi Của Dữ Liệu (End-to-End Data Flow Patterns)

### 4.1. Luồng 1: Đồng Bộ HTTP REST API (Request-Response Flow)

```text
[User Interaction]
       │
       ▼
[React Component] ──► [Custom Hook (React Query)] ──► [Client Service (fetchWithAuth/axios)]
                                                                  │
                                                        HTTP Request (Bearer Token)
                                                                  │
                                                                  ▼
                                                      [Server Route & Middleware]
                                                      - auth.middleware (Verify JWT)
                                                      - rateLimit.middleware
                                                      - projectEndpointPolicy (Check RBAC)
                                                                  │
                                                                  ▼
                                                      [Controller (req, res)]
                                                      - Bóc tách params, query, body
                                                      - Validate Zod schema
                                                                  │
                                                                  ▼
                                                      [Service (Pure Logic)]
                                                      - Xử lý tính toán, thuật toán
                                                      - Prisma Client (có select projection)
                                                                  │
                                                                  ▼
                                                      [PostgreSQL Database]
                                                                  │
                                                        Prisma Entity Result
                                                                  │
                                                                  ▼
                                                      [Controller JSON Envelope]
                                                      - res.status(200).json({ success: true, data })
                                                                  │
                                                        HTTP Response (JSON)
                                                                  │
                                                                  ▼
[React Component Render] ◄── [React Query Cache Update] ◄── [Client Service Promise]
```

### 4.2. Luồng 2: Bất Đồng Bộ Hàng Đợi Nền (Asynchronous BullMQ & Worker Flow)

Áp dụng cho các tác vụ nặng: Chạy Docker test container, phân tích Babel AST toàn dự án, gọi Gemini AI:

```text
[Client Click "Run Tests"]
       │
       ▼
[Controller] ──► [Job Service] ──► [BullMQ Queue] ──► Trả về HTTP 202 { jobId, status: "QUEUED" }
                                         │                      │
                                         │ Redis Queue          ▼
                                         │            [Client hiển thị Progress Indicator]
                                         ▼
                                  [Worker Process]
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   ▼                                           ▼
          [Docker Sandbox / AST]                     [Socket.IO Broadcast]
          - Tạo thư mục .covai-temp/<jobId>/         - io.to(`project_${id}`).emit("job:progress")
          - Chạy Jest / Playwright runner                       │
          - Trích xuất lcov & console logs                      ▼
          - Luôn xóa .covai-temp/ trong finally      [Client cập nhật Live Terminal / Gauge]
                   │
                   ▼
          [Lưu DB qua Prisma]
          - Tạo JobLog, JobOutput, CoverageSummary
          - prisma.$transaction(...)
                   │
                   ▼
          [Socket.IO Event: "job:completed"] ──► [Client tự động Invalidate React Query Cache]
```

### 4.3. Luồng 3: Cộng Tác Soạn Thảo Thời Gian Thực (Real-Time Collab / Yjs Flow)

```text
[Monaco Editor Keystroke]
       │
       ▼
[Yjs Document Update (Binary)]
       │
       ▼
[WebSocket Gateway: projectEditor.gateway.js]
       │
       ├─────────────────────────────────────────┐
       ▼                                         ▼
[Broadcast Binary Diff tới các Peers]   [Throttled Batch Queue (editorBatchQueue.js)]
       │                                         │
       ▼                                         ▼
[Màn hình Peer cập nhật Cursor & Code]  [Prisma: Lưu ProjectEditorUpdate & ProjectFileVersion]
```

---

## 5. Quy Ước Đặt Tên Chuẩn Mực (Strict Naming Conventions)

### 5.1. Quy Ước Đặt Tên Tập Tin & Thư Mục (File & Folder Naming)

| Đối tượng | Quy tắc định dạng | Ví dụ chuẩn | Điều cấm |
| :--- | :--- | :--- | :--- |
| **React Component** | `PascalCase.jsx` | `UserProfile.jsx`, `IntegrationRouteMatrixTable.jsx` | `userProfile.jsx`, `user-profile.js` |
| **React Hook** | `camelCase.js` (tiền tố `use`) | `useAuth.js`, `useProjectsPortfolio.js` | `UseAuth.js`, `authHook.js` |
| **React Context** | `PascalCase.jsx` (hậu tố `Context`) | `NotificationContext.jsx`, `ThemeContext.jsx` | `notification-context.js` |
| **Server Route** | `camelCase.route.js` | `project.route.js`, `coverage.route.js` | `projectRoute.js`, `Project.js` |
| **Server Controller** | `camelCase.controller.js` | `project.controller.js`, `auth.controller.js` | `projectController.js` |
| **Server Service** | `camelCase.service.js` | `project.service.js`, `gemini.service.js` | `projectService.js`, `Project.service.js` |
| **Server Middleware** | `camelCase.middleware.js` | `auth.middleware.js`, `rateLimit.middleware.js` | `authMiddleware.js` |
| **Input Validator** | `camelCase.validation.js` | `project.validation.js`, `auth.validation.js` | `projectValidator.js` |
| **Shared Modules** | `camelCase.js` | `projectAccess.js`, `aiModels.js` | `ProjectAccess.js` |
| **Utility Files** | `camelCase.js` | `pathSanitizer.js`, `serviceError.js` | `PathSanitizer.js` |

### 5.2. Quy Ước Đặt Tên Hàm & Biến (Function & Variable Naming)

- **Controller Actions**: Dùng cụm `động từ + danh từ`:
  - `createProject(req, res)`
  - `getProjectById(req, res)`
  - `updateLifecycleStatus(req, res)`
  - `deleteProject(req, res)`
- **Service Functions**: Phản ánh chính xác hành động nghiệp vụ chuyên biệt:
  - `resolveProjectAccess({ projectId, userId, capability })`
  - `detectJestConfig(projectRoot)`
  - `createSnapshotIngestJob({ projectId, snapshotId })`
- **Biến Boolean**: Luôn bắt đầu bằng trợ động từ: `is*`, `has*`, `can*`, `should*`:
  - `isSuspended`, `hasAccess`, `canRunTest`, `shouldRetest`
- **React Event Handlers**: Bắt đầu bằng tiền tố `handle*`:
  - `handleFileSelect`, `handleSubmitForm`, `handleRunSuite`

---

## 6. Tiêu Chuẩn Trả Về API & Xử Lý Lỗi (API Response & Error Contract)

Toàn bộ các endpoint trong CovAI **BẮT BUỘC** đóng gói phản hồi theo cấu trúc Envelope chuẩn mực:

### 6.1. Cấu Trúc Thành Công (Success Envelope)

```json
{
  "success": true,
  "data": {
    "id": "cm3abc123",
    "name": "CovAI Core Backend",
    "createdAt": "2026-11-12T08:00:00.000Z"
  },
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 25,
    "totalPages": 4
  }
}
```
*(Ghi chú: Trường `meta` chỉ bắt buộc đối với các API trả về danh sách có phân trang).*

### 6.2. Cấu Trúc Lỗi Chuẩn (Error Envelope)

```json
{
  "success": false,
  "message": "Project not found or you do not have permission to access it.",
  "code": "PROJECT_NOT_FOUND",
  "details": {
    "projectId": "clx_9999"
  }
}
```

### 6.3. Xử Lý Lỗi Bằng `ServiceError` Trong Backend

Khi phát sinh lỗi nghiệp vụ ở Service, **BẮT BUỘC** ném ra `ServiceError` từ [`server/src/utils/serviceError.js`](file:///e:/Express/CovAI-/server/src/utils/serviceError.js):

```javascript
import { ServiceError } from "../utils/serviceError.js";

// Ném lỗi chuẩn trong Service
if (!project) {
  throw new ServiceError("Project not found", 404, "PROJECT_NOT_FOUND");
}

// Bắt lỗi chuẩn trong Controller
try {
  const result = await someServiceCall();
  return res.status(200).json({ success: true, data: result });
} catch (error) {
  if (error instanceof ServiceError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
      details: error.details,
    });
  }
  console.error("[Controller Error]:", error);
  return res.status(500).json({
    success: false,
    message: "Internal server error",
    code: "INTERNAL_SERVER_ERROR",
  });
}
```

### 6.4. Bảng Ánh Xạ Mã HTTP Status Chuẩn

| Mã HTTP | Ý nghĩa | Khi nào áp dụng |
| :--- | :--- | :--- |
| **`200 OK`** | Thành công | Truy vấn dữ liệu `GET`, cập nhật dữ liệu `PUT`/`PATCH`. |
| **`201 Created`** | Tạo mới thành công | Tạo bản ghi mới `POST` (Tạo User, Project, Checkpoint). |
| **`202 Accepted`** | Tiếp nhận tác vụ ngầm | Đẩy job vào BullMQ queue (chạy test, phân tích AST). |
| **`400 Bad Request`** | Dữ liệu đầu vào sai | Lỗi validate Zod schema, thiếu tham số bắt buộc. |
| **`401 Unauthorized`** | Chưa xác thực | Token JWT bị thiếu, sai hoặc đã hết hạn. |
| **`403 Forbidden`** | Không có quyền | User không có capability tương ứng trong dự án hoặc bị suspended. |
| **`404 Not Found`** | Không tìm thấy | Bản ghi không tồn tại trong database. |
| **`409 Conflict`** | Xung đột dữ liệu | Trùng Unique key (Email đã tồn tại, version conflict). |
| **`500 Internal Error`** | Lỗi máy chủ | Crash logic, lỗi kết nối DB, timeout không mong muốn. |

---

## 7. Tiêu Chuẩn Cơ Sở Dữ Liệu & Prisma ORM

1. **Bắt Buộc Sử Dụng `select` Projection**:
   - Tuyệt đối không gọi `findMany()` hoặc `findUnique()` không có `select` trên các bảng nặng (`ProjectSnapshot`, `CoverageFile`, `JobOutput`, `SystemRunEvent`).
2. **Atomic Transactions (`prisma.$transaction`)**:
   - Khi ghi dữ liệu đồng thời vào từ 2 bảng trở lên, bắt buộc bọc trong `prisma.$transaction([ ... ])` hoặc `prisma.$transaction(async (tx) => { ... })`.
3. **Singleton Pattern**:
   - Luôn sử dụng `import prisma from "../config/prisma.js"`. Cấm tự ý `new PrismaClient()`.
4. **Bảo Mật & Redaction Dữ Liệu Nhạy Cảm**:
   - Tuyệt đối không bao giờ `select` hoặc trả về `passwordHash`, `refreshToken`, `githubAccessTokenEnc` hoặc `ciphertext` ra response client.

---

## 8. Tiêu Chuẩn Giao Diện UI/UX Frontend (Sleek Industrial)

1. **Tuân Thủ Bảng Màu Dark Mode Token**:
   - Nền canvas ngoài cùng: `--color-bg` (`#0B0F14`)
   - Nền Panel/Thẻ: `--color-surface` (`#11161D`)
   - Nền Input/Bảng con: `--color-surface-secondary` (`#171D25`)
   - Đường viền 1px sắc nét: `--color-border` (`#29313D`)
   - Điểm nhấn Primary: `--color-primary` (`#8B7CFD`)
2. **Những Điều Cấm Kỵ Trong UI**:
   - 🚫 **CẤM GRADIENT**: Không dùng linear/radial gradient trên button, text, background.
   - 🚫 **CẤM NEON & GLASSMORPHISM**: Không dùng glow phát sáng hoặc kính mờ lấp chữ.
   - 🚫 **CẤM BO TRÒN QUÁ ĐÀ**: Chỉ dùng `rounded-md` (6px) hoặc `rounded-lg` (8px). Không dùng `rounded-full` cho container/card.
   - 🚫 **CẤM CÀI THƯ VIỆN UI MỚI**: Chỉ dùng Tailwind CSS v4 và `lucide-react`.
3. **Typography Kỹ Thuật**:
   - Mọi số liệu %, dòng code, commit hashes, latency mili-giây bắt buộc thêm class `font-mono tabular-nums`.
