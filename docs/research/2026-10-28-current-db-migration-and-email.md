# CovAI — database hiện tại và email mời thành viên

## Kết quả

Đã áp dụng hai migration cộng tác vào **database được cấu hình trong `server/.env`**, không chỉ database test:

- `20261028090000_project_collaboration`
- `20261028163000_operation_request_aliases`

Hai migration đã được ghi nhận trong `_prisma_migrations`. Truy vấn quyền Owner cho cả 6 project hiện có thành công. Cấu hình Gmail dùng cho quên mật khẩu được sử dụng lại nguyên credentials; kết nối SMTP/AUTH đã xác thực thành công, không gửi email thử đến người dùng thật.

## Bảo toàn dữ liệu

Database PostgreSQL 18.6. Trước khi thay đổi đã tạo bản sao lưu đầy đủ bằng `pg_dump` 18, kiểm tra checksum và khôi phục thử vào container PostgreSQL 18 riêng, không có network và không mở port. Chạy hai migration trên bản sao này thành công; container thử nghiệm được xóa sau kiểm tra.

Số lượng trước/sau transaction migration trên database hiện tại:

| Dữ liệu | Trước | Sau |
|---|---:|---:|
| User | 52 | 52 |
| Project | 6 | 6 |
| Snapshot | 6 | 6 |
| Job | 11 | 11 |
| ChatSession / ChatMessage / ProjectMemory | 0 / 0 / 0 | 0 / 0 / 0 |

Có đủ 10 bảng mới của tính năng cộng tác. Không reset database hoặc chạy test cleanup trên database này. Backup và bằng chứng riêng nằm trong `tmp/current-db-backup/`; đây là dữ liệu riêng được Git bỏ qua, không đưa vào commit/chia sẻ công khai.

### Lịch sử migration cũ

Trước thay đổi, database đã có schema và dữ liệu nhưng chỉ ghi nhận migration `20261021090000_system_test_workflow`. Vì vậy chạy `migrate deploy` toàn bộ sẽ cố tạo lại các bảng cũ.

Đã thực thi **đúng hai SQL đã review** trong transaction, rồi dùng `prisma migrate resolve --applied` cho hai tên tương ứng. Không ghi giả rằng các migration cũ đã chạy. Các bản ghi lịch sử cũ được giữ nguyên; việc chuẩn hóa lịch sử cũ vẫn là công việc riêng trước khi dùng deploy migration toàn bộ trong tương lai.

Read-only diff còn cho thấy enum/index và các cột TestScenario cũ khác Prisma schema. Không áp dụng SQL diff đó vì nó đề xuất xóa cột/giá trị enum ngoài phạm vi. Hai partial unique index bảo vệ lời mời pending và operation active đã được khai báo bổ sung vào Prisma schema, khớp index thực tế được migration tạo; không phát sinh DDL bổ sung.

## Email

`sendEmail` vẫn là bộ gửi chung cho quên mật khẩu và lời mời. Nếu đã có `EMAIL_USERNAME`/`EMAIL_APP_PASSWORD`, dùng Gmail hiện có; không cần thêm bộ SMTP khác. Giữ khả năng override `SMTP_*` và `EMAIL_FROM`; tên gửi mặc định là CovAI với địa chỉ đã xác thực. Có timeout kết nối/greeting/socket và hàm kiểm tra transport không gửi thư.

Mẫu mời mới có:

- Nhận diện CovAI và màu tím đồng bộ ứng dụng.
- Tên người mời, project, vai trò Editor/Viewer và mô tả quyền tương ứng.
- Nút Accept invitation, địa chỉ email phải đăng nhập, thời hạn chính xác UTC và link dự phòng.
- Thông báo chat/bộ nhớ AI dùng chung; bản text thuần đi kèm HTML.
- HTML escaping cho nội dung người dùng; không tải font/ảnh bên ngoài, không có tracking pixel. Bố cục table/inline CSS và giao diện mobile.

Nguồn: `server/src/utils/projectInvitationEmail.js`; worker `invitationDelivery.service.js` sử dụng template này. Không thay template quên mật khẩu.

Preview dùng dữ liệu mẫu, không phải token/lời mời thật: `tmp/collaboration-evidence/invitation-email-preview.html`, `invitation-email-desktop.png`, `invitation-email-mobile.png`. Đã render và xem trực tiếp ở desktop 960px và mobile 390px: không tràn ngang, CTA và fallback link đọc được. Chưa kiểm chứng render trong mọi phiên bản Outlook/Gmail thực tế.

## Kiểm tra

| Kiểm tra | Kết quả |
|---|---|
| Khôi phục backup + chạy migration trên bản sao thật | PASS |
| Transaction migration database hiện tại + Owner access | PASS |
| Prisma validate / generate | PASS |
| Gmail transport verify, không gửi thư | PASS |
| Template/transport/outbox tests | 3 suites / 13 tests PASS |
| Full backend regression trên DB test guard | 198 suites / 1.506 tests PASS; 52 skipped; exit 0 |
| Browser E2E sau đổi email, SMTP Mailpit thật | 5/5 PASS, 1,7 phút |

Bằng chứng: `backend-after-email.json`, `backend-after-email.log`, `invitation-email-tests.log`, `browser-after-email.log`, `browser-results.json` trong `tmp/collaboration-evidence/`. Jest vẫn dùng `--forceExit` vì handle queue/runtime cũ, không coi đó là chứng minh teardown sạch.

## Chạy bình thường

Frontend development đã kiểm tra trỏ API/socket `http://localhost:5000`, `CLIENT_URL` là `http://localhost:5173`; Redis hiện tại trả PONG. Compose đặt tên container là **`covai_redis`**.

Từ root:

```powershell
docker compose up -d redis
npm run dev
```

Mở `http://localhost:5173`, đăng nhập tài khoản thật, vào project → Settings → Project → Members & access. Lời mời ở chế độ này sử dụng Gmail đã cấu hình; profile test ở cổng 55173 vẫn dùng Mailpit riêng.
