# CovAI Documentation Index

Tài liệu dự án CovAI được tổ chức theo các danh mục chuẩn kỹ thuật dưới đây:

## 📁 Cấu Trúc Thư Mục Tài Liệu

```text
docs/
├── admin/                        # Hệ thống Quản trị Trung tâm (Admin Console, 67 DB Tables, Plan, Specs)
├── architecture/                 # Kiến trúc tổng thể hệ thống, sơ đồ C4, ERD, PlantUML
├── assets/                       # Ảnh tư liệu, tài nguyên biểu đồ
├── plans/                        # Kế hoạch triển khai, Roadmap, Task tracking của các tính năng
├── specs/                        # Đặc tả kỹ thuật (API Specifications, Design Docs, Data Contracts)
├── rules/                        # Quy chuẩn phát triển (UI/UX agent rules, Coding standards)
├── unit-testing/                 # Tài liệu chuyên sâu về Unit Test & Coverage tracing
├── system-testing/               # Tài liệu về E2E / System Testing (Playwright, Cypress)
├── ai-trustworthiness-evaluation/# Đánh giá độ tin cậy AI Chatbot
├── ui-design/                    # Phân tích thiết kế giao diện người dùng
├── research/                     # Nghiên cứu giải pháp kỹ thuật
├── runbooks/                     # Hướng dẫn vận hành, triển khai
└── superpowers/                  # Kế hoạch & đặc tả nâng cấp mở rộng
```

---

## 📌 Chi Tiết Danh Mục

### 1. `admin/` (Hệ Thống Quản Trị Trung Tâm - CovAI Admin Console)
Trung tâm điều phối, giám sát hạ tầng và quản lý toàn bộ 67+ Tables trong cơ sở dữ liệu:
- `README.md`: Tổng quan hệ thống và bản đồ tài liệu Admin.
- `plan.md`: Kế hoạch triển khai chi tiết chia thành 48 subtasks có checkbox `[ ]` theo dõi tiến độ.
- `architecture.md`: Kiến trúc bảo mật, Admin RBAC, Universal Prisma DMMF Engine và Audit Log.
- `database-management.md`: Quản trị phổ quát 67 tables phân bổ theo 8 domains, bộ lọc động và quan hệ FK.
- `business-requirements.md`: Nghiệp vụ chuẩn mực: User governance, AI/Gemini tokens, BullMQ queue, hạ tầng.
- `ui-design.md`: Thiết kế giao diện tùy biến (Custom UI) phong cách "Tactile Obsidian & Cyber Emerald".
- `api-spec.md`: Đặc tả đầy đủ REST API và sự kiện WebSocket realtime.

### 2. `plans/` (Kế Hoạch & Tiến Độ)
Chứa toàn bộ các kế hoạch thực hiện tính năng, checklist và task tracking:
- `plan_unified_dashboard.md`: Kế hoạch tổng thể Unified Testing & Quality Dashboard.
- `plan_unified_dashboard_fe_polish.md`: Tinh chỉnh và hoàn thiện giao diện Unified Dashboard.
- `plan_projects_portfolio_dashboard.md`: Thiết kế Multi-Project Portfolio Dashboard.
- `plan_portfolio_dashboard_ux_refinement.md`: Tinh chỉnh UX/UI Portfolio.
- `planintegrationtest.md`: Kế hoạch triển khai tính năng Integration Testing.
- `plancoverageengine.md`: Kiến trúc cơ chế đo lường độ bao phủ & bóc tách dòng mã thực thi.
- `task.systemtest.md`: Tiến độ triển khai System Testing.
- `system-test-execution-implementation-plan.md`: Kế hoạch thực thi System Test.
- `system-test-implementation-plan.md`: Kế hoạch tích hợp System Test.
- `function-coverage-cfg-code-navigation-plan.md`: Kế hoạch điều hướng mã nguồn qua CFG.
- `integrationtestpromp.md`: Yêu cầu đặc tả gốc của tính năng Integration Test.

### 2. `specs/` (Đặc Tả Kỹ Thuật & API)
- `unified_dashboard_backend_spec.md`: Đặc tả API Backend cho Unified Dashboard.
- `project-analysis-export-api.md`: Đặc tả API xuất báo cáo phân tích dự án.
- `ai-context-configuration-api.md` & `ai-context-configuration-design.md`: Cấu hình và API của AI Context.
- `project-structure-analyzer-api.md`: API phân tích cấu trúc dự án.
- `system-test-auto-setup-design.md`: Thiết kế tự động cấu hình System Test.
- `system-test-evidence-assessment.md`: Cơ chế đánh giá bằng chứng kiểm thử hệ thống.

### 3. `rules/` (Quy Chuẩn Code & Agent Rules)
- `COVAI_FRONTEND_AGENT_RULES.md`: Bộ quy tắc phát triển giao diện UI/UX Frontend dành cho lập trình viên và AI Agent.

### 4. `system-testing/` (Kiểm Thử Hệ Thống & E2E)
- `full-system-testing.md`: Hướng dẫn toàn diện về kiểm thử hệ thống.
- `atomic-system-test-generation.md`: Cơ chế sinh test case hệ thống dạng atomic.
- `system-test-manual-acceptance.md`: Tiêu chí nghiệm thu thủ công System Test.
- `system-test-review-*.md`: Đánh giá và kiểm toán các đợt chạy System Test.
- `system-test-workflow-runbook.md`: Quy trình chạy kiểm thử hệ thống.

### 5. `unit-testing/` (Kiểm Thử Đơn Vị)
- `ai-unit-test-coverage-pipeline.md`: Pipeline đo độ bao phủ Unit Test bằng AI.
- `KIEN_TRUC_VA_NGUYEN_LY_TINH_NANG_UNIT_TEST.md`: Kiến trúc cốt lõi tính năng Unit Test.
- `quy-trinh-ai-suggest-testcase.md`: Luồng đề xuất test case bằng AI.
- `business-logic-to-test-traceability-plan.md`: Cơ chế truy vết code nghiệp vụ tới test.

### 6. `ai-trustworthiness-evaluation/` (Đánh Giá AI Chatbot)
- `ai-trustworthiness-implementation-plan.md`: Kế hoạch đánh giá chatbot.
- `chatbot-trustworthiness-plan.md`: Bộ tiêu chuẩn đánh giá độ tin cậy của chatbot.

### 7. `architecture/` (Kiến Trúc)
- Sơ đồ kiến trúc tổng thể, mô hình dữ liệu (ERD) và các biểu đồ PlantUML.
