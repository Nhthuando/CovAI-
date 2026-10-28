# CovAI collaboration — chạy và kiểm tra trên localhost

Tài liệu dành cho người phát triển CovAI. Trạng thái kiểm chứng cuối cùng được ghi riêng trong `docs/research/2026-10-28-project-collaboration-verification.md`; tài liệu này mô tả quy trình, không thay thế kết quả test.

## Chạy với database CovAI hiện tại

Ngày 2026-10-28 đã áp dụng hai migration cộng tác vào database trong `server/.env`, có backup và rehearsal, dùng lại Gmail quên mật khẩu. Xem `docs/research/2026-10-28-current-db-migration-and-email.md` để biết kết quả và giới hạn lịch sử migration cũ.

```powershell
docker compose up -d redis
npm run dev
```

Mở `http://localhost:5173`. Container Redis thực tế là `covai_redis`. API/socket development trỏ cổng 5000. Không cần chạy stack test bên dưới để dùng bản development bình thường; lời mời sẽ gửi bằng Gmail hiện có.

## Môi trường

Chạy từ thư mục gốc repository bằng PowerShell. Cần Node/dependency đã cài, Docker Desktop đang chạy và Google Chrome cho Playwright. PostgreSQL, Redis và SMTP capture được tách khỏi môi trường đang sử dụng:

| Thành phần | Địa chỉ |
|---|---|
| Frontend | http://127.0.0.1:55173 |
| API và Socket.IO | http://127.0.0.1:55000 |
| PostgreSQL test | 127.0.0.1:55432 / covai_collaboration_test |
| Redis test | 127.0.0.1:56379 |
| Hộp thư Mailpit | http://127.0.0.1:58025 |

Runner tạo JWT/encryption key riêng trong `tmp/collaboration-evidence/runtime-env.json`, một file bị Git bỏ qua. Runner không sửa `server/.env`. Không đưa file này hoặc browser trace chứa thông tin phiên đăng nhập vào commit.

## Khởi động

```powershell
node server/scripts/collaboration-local.mjs prepare
node server/scripts/collaboration-local.mjs build
node server/scripts/collaboration-local.mjs start --preview
```

Nếu hai tiến trình test đã chạy, dùng `restart --preview` thay cho `start`. Frontend preview được build với đúng API/socket test; chạy `npm run build` với cấu hình mặc định có thể tạo bản trỏ đến cổng 5000. Sau mỗi lần sửa frontend, chạy lại `build` rồi `restart --preview`.

Health check: `http://127.0.0.1:55000/api/health`. Kiểm tra `tmp/collaboration-evidence/server.log` và `client.log` nếu runner không báo sẵn sàng. Không đổi sang database mặc định để vượt lỗi startup.

Lịch sử migration cũ của repository không replay được từ database trống: `20260822090000_add_system_test_analysis` sử dụng enum `TestType` chưa được tạo. Với **database test trống**, có thể chạy quy trình nền đã lưu trước tính năng:

```powershell
node server/scripts/collaboration-local.mjs bootstrap-empty
node server/scripts/collaboration-local.mjs prepare
```

`bootstrap-empty` kiểm tra đúng host/port/tên DB và từ chối khi đã có User hoặc Project. Nó dựng schema nền, đánh dấu các migration lịch sử bằng Prisma resolve, rồi áp dụng migration cộng tác bình thường. Đây là cách khởi tạo môi trường test; không xác nhận lịch sử migration cũ đã được sửa và không phải hướng dẫn nâng cấp database chứa dữ liệu.

## Kiểm tra tự động

```powershell
node server/scripts/collaboration-local.mjs test
$env:COLLABORATION_INTEGRATION = 'true'
node server/scripts/collaboration-local.mjs exec --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --cacheDirectory=../tmp/jest-collaboration --runTestsByPath src/tests/projectMembers.integration.test.js src/tests/projectMutation.integration.test.js src/tests/projectCollaborationMigration.integration.test.js
Remove-Item Env:COLLABORATION_INTEGRATION
```

E2E dùng trang ứng dụng thật, đăng ký/đăng nhập thật, lời mời gửi qua SMTP/Mailpit, PostgreSQL, Redis/BullMQ và các browser context riêng. HTML minh họa Figma và mock `fetch` không được tính là E2E.

`exec` và `baseline` bỏ khóa Gemini/Google khỏi môi trường test và chặn HTTP ra ngoài localhost trong Jest. Các test SDK dùng mock. Server E2E dùng AI transport giả lập có nhãn `[LOCAL AI FIXTURE]`; kết quả này không chứng minh Gemini thật hoạt động. Firebase được thay bằng local storage chỉ trong profile test; dữ liệu vẫn đi qua backend thật.

Kết quả build/lint/test, browser trace và screenshot ở `tmp/collaboration-evidence/`. Lint phải đối chiếu với backlog có sẵn; không đổi lỗi cũ thành kết quả PASS. Toàn bộ bộ test server phải chạy với DB guard, kể cả các bài cũ có teardown.

Jest hiện cần `--forceExit` do một số handle queue/runtime của repository vẫn mở sau khi test xong. Không coi điều này là xác minh teardown sạch. Để chạy riêng Supertest qua API/Redis/worker thật khi stack đang chạy, đặt `COVAI_RUN_REAL_SUPERTEST=true` và chạy `src/tests/supertestCollaboration.integration.test.js` bằng cùng runner/Jest; bỏ biến sau khi xong. Test tạo project riêng và giữ lại log để điều tra.

## Kiểm tra bằng tay

Tạo bộ tài khoản/project demo qua API thật (lời mời đi qua Mailpit):

```powershell
node server/scripts/collaboration-local.mjs exec scripts/collaboration-demo.mjs
```

Email demo: `owner@covai.test`, `editor@covai.test`, `viewer@covai.test`, `outsider@covai.test`. Mật khẩu của các tài khoản dùng riêng cho stack test: `Collaboration-local-123!`. Script in link project để mở trực tiếp, không in JWT. Các tài khoản này không được tạo trên database mặc định.

Trong project: **Settings → Project → Members & access**. Owner mời Editor hoặc Viewer bằng email. Mở Mailpit để lấy link; đăng nhập bằng đúng email được mời, nhận lời mời và kiểm tra project xuất hiện.

- Owner: quản lý thành viên/lời mời và các thao tác quan trọng.
- Editor: sửa file, chạy test, dùng chat/AI và cập nhật bộ nhớ dùng chung.
- Viewer: xem project, kết quả, chat/bộ nhớ và xuất báo cáo; không được sửa hoặc chạy AI/test.

Để kiểm tra chống ghi đè, mở cùng file ở hai tài khoản, sửa cả hai trước khi lưu. Lần lưu sau phải báo xung đột và giữ bản nháp, không tự đọc phiên bản mới rồi ghi đè. Xóa thành viên ở cửa sổ Owner phải làm cửa sổ bị thu hồi quyền mất quyền xem/ghi; không được làm người đó đăng xuất khỏi các project khác.

## Dừng và tiếp tục

```powershell
node server/scripts/collaboration-local.mjs stop
```

Lệnh chỉ dừng tiến trình và Compose project test; volume test được giữ lại. Không chạy `docker compose down -v`, `prisma migrate reset` hoặc dọn toàn bộ dữ liệu để làm test xanh. Khi tiếp tục, dùng `prepare`, `build`, `start --preview`.

## Triển khai ngoài profile test

Tính năng cần migration schema trước khi chạy phiên bản ứng dụng mới. Review SQL/backfill và backup database đích trước khi nâng cấp. Runner trong tài liệu này chỉ quản lý database test riêng.

Các biến mới: `PROJECT_COLLABORATION_ENABLED`, `PROJECT_STORAGE_DRIVER`, `PROJECT_STORAGE_ROOT`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `EMAIL_FROM`, `COLLABORATION_E2E_ENABLED`, `AI_PROVIDER_MODE`, `VITE_PROXY_TARGET`. Profile E2E bị từ chối ngoài database localhost đúng tên/cổng và ngoài chế độ development/test. SMTP mặc định cũ và Firebase vẫn được giữ cho cấu hình thông thường.

Khi dùng môi trường phát triển thông thường, bật `PROJECT_COLLABORATION_ENABLED=true` sau khi áp dụng migration đã review vào đúng database đích. Không sao chép `COLLABORATION_E2E_ENABLED` hoặc `AI_PROVIDER_MODE=fixture` sang cấu hình chạy provider thật. Runner đã tự đặt các biến phù hợp cho stack test ở cổng 55173; không cần sửa `server/.env` để xem demo.

API lưu file nay yêu cầu `snapshotId`, `expectedVersion` và `requestId` lấy từ lần đọc/chỉnh sửa tương ứng. Các thao tác ghi workspace/proposal dùng revision đã chụp khi chuẩn bị. Client cũ bỏ qua các điều kiện này sẽ nhận lỗi precondition; không được khắc phục bằng cách đọc phiên bản mới rồi tự ghi đè nội dung cũ. Truy cập file bằng đường dẫn tuyệt đối ngoài project không còn được hỗ trợ.

Nếu cần tắt tính năng sau khi đã có dữ liệu chia sẻ, dùng phiên bản ứng dụng hiểu schema mới với chế độ hạn chế ghi; không tự downgrade schema hoặc chạy binary cũ. Giữ journal để điều tra các lần áp dụng file chưa xác định trạng thái.
