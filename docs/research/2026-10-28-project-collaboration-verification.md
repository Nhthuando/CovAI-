# CovAI — xác minh cộng tác trong project

Ngày chạy: 2026-10-28, Windows/PowerShell. Báo cáo ghi kết quả thực chạy; checklist/Figma không thay thế bằng chứng chức năng.

Cập nhật tiếp theo: hai migration đã áp dụng vào database CovAI trong `server/.env`, Gmail quên mật khẩu đã xác thực và template lời mời đã được nâng cấp. Chi tiết backup, lịch sử migration cũ và cách chạy `npm run dev`: [báo cáo database/email](2026-10-28-current-db-migration-and-email.md).

## Kết quả sản phẩm

Giữ shell CovAI và thêm **Settings → Project → Members & access** với Members/Pending invitations. Owner quản lý thành viên và thao tác quan trọng; Editor sửa file, chạy test, dùng AI; Viewer xem và xuất báo cáo. Backend xác định quyền từ project của tài nguyên, không tin role/userId do client gửi.

Lời mời gắn email người nhận, hết hạn/thu hồi được, resend đổi token và accept idempotent. Chat/bộ nhớ AI dùng chung theo project; tin nhắn có người gửi, quota tính theo người gọi. Khi đổi tài khoản hoặc bị xóa khỏi project, client xóa dữ liệu và hủy đăng ký sự kiện tương ứng.

Lưu file yêu cầu snapshot và phiên bản đã đọc: hai người sửa cùng bản chỉ một lần ghi thành công, lần sau giữ draft và báo xung đột. Công việc dài chạy trong workspace riêng, kiểm tra lại quyền/trạng thái/revision trước khi xuất bản. Git source và metadata được xuất bản cùng nhau; journal hỗ trợ khôi phục lần ghi bị gián đoạn.

Scenario integration cũng có phiên bản artifact cho sửa/thêm/xóa/bật tắt/tạo lại. Regeneration đi qua job có actor và admission; source + metadata xuất bản cùng nhau. Mỗi người có request key được lưu bền vững riêng khi chia sẻ cùng job, nên retry sau hoàn tất không tạo lại tác vụ. Chuỗi RUN_TESTS → CFG → performance chỉ tạo công việc tiếp theo sau khi kết quả trước đã commit.

## Môi trường

Node 24.12.0, Docker Engine 29.6.2, Prisma 7.8. Compose project riêng `covai-collaboration-test` chạy PostgreSQL 16, Redis 7, Mailpit và chỉ mở cổng loopback. Image digest lưu trong `tmp/collaboration-evidence/docker-images.json`.

Frontend: `http://127.0.0.1:55173`; API/socket: `http://127.0.0.1:55000`; Mailpit: `http://127.0.0.1:58025`. DB guard chỉ cho loopback, cổng 55432, tên `covai_collaboration_test`, từ chối query/fragment có thể chuyển host/port kết nối. Cách khởi động và tài khoản demo: [runbook](../runbooks/project-collaboration-localhost.md).

## Kiểm tra

Các gate chức năng localhost bên dưới đã qua. AI/cloud provider live và các lỗi cũ được ghi riêng, không được tính là đã kiểm chứng.

| Hạng mục | Kết quả đã ghi nhận | Bằng chứng trong `tmp/collaboration-evidence/` |
|---|---|---|
| Frontend production build | PASS, exit 0 | `frontend-final-build.log` |
| Prisma validate | PASS, exit 0 | runner `prisma validate` |
| Jest backend với DB guard/offline, sau cập nhật email | PASS: 198 suites, 1.506 tests; 52 skipped, 147,343 giây, exit 0 | `backend-after-email.json`, `.log` |
| System Test chạy Node AUT + browser thật | PASS: 3 tests, 65,69 giây | `real-system-workflow.log` |
| PostgreSQL/filesystem tích hợp cuối | PASS: 9 suites, 47 tests, 50,601 giây, exit 0 | `collaboration-db-final.json`, `.log` |
| Chặn admission sửa canonical ngoài guard | PASS: 3 suites, 25 tests | `admission-no-canonical-writes.log` |
| ESLint toàn frontend | Chưa sạch: 271 lỗi / 38 cảnh báo; baseline 274 / 38, exit 1 | `frontend-lint-final.json` |
| Browser E2E tích hợp sau cập nhật email | PASS: 5/5, 1,7 phút, exit 0 | `browser-results.json`, `browser-after-email.log` |
| Supertest thật qua API/Redis/worker | PASS: 1/1, 48,593 giây, exit 0 | `supertest-real.log` |

Không cộng các hàng vì có test chồng lặp. Jest còn dùng `--forceExit` vì handle queue/runtime cũ chưa đóng sạch; không coi đây là PASS teardown. Build còn cảnh báo chunk lớn/dynamic import.

Các spec browser dùng đăng nhập thật và context riêng, không mock fetch/JWT:

1. Owner mời qua UI → SMTP/Mailpit → Editor/Viewer đăng nhập/accept → thấy project và quyền tương ứng.
2. Monaco lưu cùng base version trả 200/409 và giữ draft. Viewer bị chặn nút/phím tắt/API; Outsider nhận 404.
3. Editor gửi COV; Owner/Viewer thấy cùng lịch sử/người gửi. Shared memory cập nhật không xóa draft đang soạn; Viewer chỉ đọc.
4. Editor chạy Jest của project ZIP; kiểm tra exit code 0, không có test thất bại, dedup job đồng thời/retry và Viewer xuất báo cáo.
5. Đổi role/xóa thành viên làm cửa sổ đang mở mất quyền. Resend xoay token, revoke vô hiệu link.
6. Đổi tài khoản qua hai tab không lộ dữ liệu cũ. Save Both giữ phần nguồn đã lưu và retry riêng phần test bị xung đột.
7. Modal scenario mở từ phiên bản cũ; người khác lưu trước; Save trả 409, giữ modal/draft và không thay đổi bản đang có. Bài này chỉ seed artifact AI đã sinh qua Prisma trên DB guard; đăng nhập, lời mời, upload, đọc, sửa và lưu đều đi qua ứng dụng/API thật.

Test PostgreSQL/filesystem riêng kiểm tra race invitation/revision, idempotency, delete/recreate, revoke/stale publication, Git/source atomicity, ZIP monorepo, mutation recovery, AI worker/cold-start canceled/failed và migration/backfill. Không mô tả service tests thành thao tác UI chưa thực hiện.

Screenshot thực: `members-desktop-real.png`, `pending-desktop-real.png`, `pending-light-real.png`, `pending-mobile-real.png`, `editor-conflict-real.png`; browser artifacts ở `browser/`. Đã xem Members desktop/Pending mobile và Members ba người trong lượt cuối, đối chiếu shell hiện có. Sửa nhỏ sau lượt E2E: tăng select role từ 72 lên 90px để chữ Viewer không bị cắt, build lại thành công; không thay hành vi. Không có pixel-diff tự động với Figma.

Kiểm tra trực quan sau sửa CSS bằng đăng nhập demo thật: select rộng 90px, Viewer đọc đầy đủ ở 1440px và 390px, shell/sidebars giữ nguyên, mobile xuống hàng đúng và không có page error. Screenshot cuối: `demo-members-final.png` và `demo-members-mobile-final.png`.

Đã chạy lại script tạo demo thành công sau các suite cuối; frontend và `/api/health` đều trả HTTP 200. Stack được giữ chạy để xem, project demo `cmvrwaik200d45o7kyj6ekmgb` có Owner/Editor/Viewer và project ZIP mẫu. Không lưu access token trong báo cáo.

Luồng chính còn kiểm tra CFG và performance tiếp tục thành công sau Jest, và endpoint coverage cũ thực thi một lượt Jest riêng với exit code 0. Supertest kiểm tra HTTP assertion thật, kết quả test trong DB, coverage file, quyền Viewer và giữ nguyên con trỏ storage nguồn của snapshot.

## Lệnh tái kiểm tra

Các lệnh chạy từ root; log/JSON ở thư mục bằng chứng nêu trên. Runner đặt profile và DB guard cho cả subprocess.

```powershell
node server/scripts/collaboration-local.mjs prepare
node server/scripts/collaboration-local.mjs build
node server/scripts/collaboration-local.mjs restart --preview
node server/scripts/collaboration-local.mjs prisma validate
node server/scripts/collaboration-local.mjs exec --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --cacheDirectory=../tmp/jest-final-current --json --outputFile=../tmp/collaboration-evidence/backend-final-pass.json
node server/scripts/collaboration-local.mjs test
$env:COLLABORATION_INTEGRATION='true'
node server/scripts/collaboration-local.mjs exec --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --cacheDirectory=../tmp/jest-final-db --json --outputFile=../tmp/collaboration-evidence/collaboration-db-final.json --runTestsByPath src/tests/projectMembers.integration.test.js src/tests/projectMutation.integration.test.js src/tests/projectCollaborationMigration.integration.test.js src/tests/gitPreparedPublication.integration.test.js src/tests/coldStartCollaboration.integration.test.js src/tests/projectWorkspacePublish.integration.test.js src/tests/projectOperationPublish.integration.test.js src/tests/scenarioCollaboration.integration.test.js src/tests/staticAnalysisCollaboration.integration.test.js
Remove-Item Env:COLLABORATION_INTEGRATION
$env:COVAI_RUN_REAL_SUPERTEST='true'
node server/scripts/collaboration-local.mjs exec --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --cacheDirectory=../tmp/jest-real-supertest --runTestsByPath src/tests/supertestCollaboration.integration.test.js
Remove-Item Env:COVAI_RUN_REAL_SUPERTEST
$env:COVAI_RUN_REAL_SYSTEM_FIXTURE='true'
node server/scripts/collaboration-local.mjs exec --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --runTestsByPath src/tests/systemWorkflowRun.integration.test.js
Remove-Item Env:COVAI_RUN_REAL_SYSTEM_FIXTURE
node server/scripts/collaboration-local.mjs exec scripts/collaboration-demo.mjs
```

Chạy lint từ `client/`: `node node_modules/eslint/bin/eslint.js . --format json --output-file ../tmp/collaboration-evidence/frontend-lint-final.json`. Exit 1 là backlog đã ghi trong bảng, không phải gate PASS. Chạy Jest regression và browser theo thứ tự, tránh để worker khởi tạo trong test backend cạnh tranh hàng đợi với bài E2E đang chạy.

## Migration và giới hạn

Migration mới đã áp dụng trên DB test. Rehearsal dựng schema nền trước tính năng trong schema PostgreSQL riêng, tạo chat/memory mẫu, chạy migration và kiểm tra giữ chat/sender, tombstone FORGOTTEN, remap tham chiếu và creator SetNull. Đây không phải nâng cấp bản sao production.

Hai migration của tính năng: `20261028090000_project_collaboration` và `20261028163000_operation_request_aliases`. Migration thứ hai thêm bảng ánh xạ request/actor sang operation, backfill key cũ và không xóa dữ liệu hiện có. Rehearsal có kiểm tra backfill này và cascade khi xóa creator mà vẫn giữ lịch sử operation.

Migration lịch sử `20260822090000_add_system_test_analysis` tham chiếu enum TestType chưa tạo, nên không replay từ DB trống được. Runner có `bootstrap-empty` chỉ cho database disposable trống; không dùng với DB chứa dữ liệu.

Trước profile cô lập đã xảy ra sự cố cleanup test làm mất dữ liệu project ở DB phát triển; đã thông báo và người dùng chấp nhận, yêu cầu tiếp tục. Các lượt xác minh tiếp theo dùng DB guard và cleanup theo ID; không phục hồi/reset DB mặc định.

| Dịch vụ | Phạm vi chứng minh |
|---|---|
| PostgreSQL/Redis/BullMQ/Socket.IO | Thật trên localhost |
| Email | SMTP thật tới Mailpit; Gmail quên mật khẩu xác thực SMTP/AUTH thành công, không gửi email Internet thử |
| AI | Backend thật, transport `[LOCAL AI FIXTURE]`; SDK tests dùng mock, chưa smoke Gemini live |
| Storage | Adapter local thật trong profile E2E; chưa smoke Firebase cloud |
| Git | Repository fixture thật; chưa GitHub remote/webhook live |
| System Test | Có AUT/browser thật; chưa có browser scenario riêng cho Viewer xem System run đang chạy |

Không khẳng định mọi chức năng cũ không thể có lỗi. Regression/runtime/browser nêu trên được chạy; live provider, backlog lint và migration lịch sử là giới hạn còn lại. Workspace có nhiều thay đổi từ trước, chưa stage/commit toàn bộ để tránh gom nhầm công việc khác.

Một lỗi runtime có sẵn được phát hiện khi rà soát: Code Hygiene vẫn tham chiếu model Prisma `codeHygieneIssue`/`codeHygieneSummary` không có trong schema hiện tại. Tính năng cộng tác chặn xuất bản không hợp lệ nhưng không tự tạo thêm schema ngoài phạm vi để che lỗi cũ này. Hủy/thu hồi quyền chặn ghi canonical ngay; tiến trình RUN_TESTS chạy host có thể tiếp tục trong bản sao riêng đến timeout, trong khi System worker có cooperative abort. Chưa có kiểm chứng failover nhiều server.
