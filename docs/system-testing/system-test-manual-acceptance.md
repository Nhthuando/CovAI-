# System Test — Handoff và kiểm tra E2E

Ngày: 2026-11-05. Thay đổi đang ở working tree, chưa commit/push.

## Chuẩn bị trước khi chạy

Schema có migration additive mới: `server/prisma/migrations/20261105120000_system_suite_versions/migration.sql`. Agent đã validate schema, generate Prisma Client và chạy SQL này trên PostgreSQL tạm bằng PGlite; **chưa áp dụng lên database thông thường của dự án**.

**Kết quả kiểm tra chỉ đọc ngày 2026-11-05:** database đang cấu hình chưa có `SystemSuiteVersion`, `SystemSuiteState`, `SystemTestBlob`. `prisma migrate status` báo 26 migration pending, gồm cả init cũ. Không chạy toàn bộ migration vào database này trước khi đối chiếu schema thực tế và baseline lịch sử migration. Cần xử lý riêng phần nâng cấp System Test để tránh áp lại schema cũ đang dùng. Agent chưa thay đổi database.

Từ `server/`, có thể kiểm tra:

```powershell
npx.cmd prisma migrate status
npx.cmd prisma validate
```

Sau khi nâng cấp schema đúng database, generate Prisma Client và khởi động lại API/worker. Version history hiện báo rõ storage chưa sẵn sàng, có Retry và không giữ loading vô hạn. Giữ các cấu hình PostgreSQL, Redis/BullMQ, Storage và Gemini hiện có. Các capability đo lường vẫn dùng feature flag hiện có: `SYSTEM_ASSESSMENT_ENABLED`, `SYSTEM_MEASURED_COVERAGE_ENABLED`, `SYSTEM_AI_IMPROVEMENT_ENABLED`. Không cần thư viện biểu đồ hoặc dependency runtime mới.

## Những thay đổi cần thấy

- Giao diện, thông báo và nội dung hệ thống sinh dùng tiếng Anh; requirement, nhãn ứng dụng và lỗi gốc được giữ nguyên.
- `Generate tests` tạo draft trong bản sao cô lập. Xem code, scenario và Expected trước `Apply`. Nếu sinh thêm cấu hình hoặc SQL Full Stack, phải review riêng các file đó.
- `Run selected` không tự sinh test, tự điền Expected hoặc tự xác nhận review. Không chọn scenario thì không chạy thay toàn bộ suite.
- Lượt sinh/chạy System Test mới chỉ dùng Full Stack. Không còn mode selector hoặc gợi ý chuyển sang Frontend. Report Frontend cũ được giữ nguyên.
- Ba tab chính: `Scenarios`, `Live run`, `Results`. Report HTML, JSON và PDF gắn với assessment được chọn.
- Version history chỉ quản lý file System Test và helper độc quyền của chúng. Shared setup, source ứng dụng, Unit và Integration không được restore theo test version.

## Checklist E2E

| Tình huống và dữ liệu cần có | Kết quả mong đợi |
|---|---|
| Dự án chưa có System Test: Generate draft, đóng/mở modal, xem code rồi Apply | Draft có thể phục hồi từ server; file gốc không đổi trước Apply; Apply tạo version và scenario ở trạng thái cần review |
| Sinh Full Stack khi chưa có setup | Các file cấu hình/SQL mới hiển thị để review riêng; Apply đủ file; Run không thiếu schema đã được duyệt |
| Dự án không phải Todo, có nhiều route và validation | Không xuất hiện dữ liệu Todo mẫu; case dựa trên source/requirement thật, không đoán tài khoản hay API fixture |
| Sửa Expected rồi confirm, chọn một phần scenario để Run | Chỉ chạy selection hiện tại; Run không thực hiện mutation xác nhận ngầm |
| Tạo brief/criteria bằng form, confirm revision, review mapping assertion | Mapping bám đúng hash; sửa test/requirement làm review stale; criterion chỉ verified khi có evidence đúng |
| Dự án chưa có requirement được confirm | Có thể chạy scenario đã confirm Expected; requirement coverage là `Not measured` |
| Chạy hai lượt; quan sát thời điểm kết thúc run 1 | Live run tiếp tục cho run 2; terminal status theo job; hiển thị đúng run đang chạy |
| Reload/reconnect, đổi snapshot/mode giữa các run | Không lẫn frame, event hoặc report cũ; replay không bỏ mất event do socket đến sai thứ tự |
| Cuộn log lên đọc lỗi khi run tiếp tục | Không bị tự kéo xuống; cuộn về cuối sẽ tiếp tục theo dõi output mới |
| Stop bằng owner hoặc actor hợp lệ; thử tài khoản không đủ quyền | Stop đúng policy hiện có; mutation bị từ chối khi không có quyền |
| Thiếu instrumentation, thiếu ảnh, thiếu criterion hoặc chỉ có một repeat | Không có coverage 100%, điểm 95 mặc định hay khẳng định zero flakiness; trạng thái thiếu dữ liệu rõ ràng |
| Improvement tăng coverage; improvement tăng criterion đã review nhưng không tăng dòng code | Chỉ chấp nhận khi so sánh hợp lệ và không regression; candidate cần mapping mới được review rồi xác minh lại trước Apply |
| Candidate gặp lỗi ứng dụng hoặc lỗi setup | Giữ lỗi làm diagnostic; không bỏ assertion/đổi Expected để ép pass; không tự Apply |
| Apply, bấm lại Apply, mở `Version history` | Không tạo version trùng; xem được thời gian, actor, file/scenario diff và version hiện tại |
| `Check version` với version cũ | Chạy trong bản sao trên source hiện tại; file workspace không đổi; report ghi rõ giới hạn lịch sử |
| `Restore tests` sau khi xem diff | Tạo revision RESTORE mới; xử lý cả file thêm/xóa; source, Unit và Integration giữ nguyên; review hiện tại stale |
| Có test sửa tay, editor draft chưa lưu, job đang chạy hoặc source/config khác version đích | Restore bị chặn bằng thông báo xung đột; không ghi đè công việc hiện tại |
| Dùng project snapshot restore | Toàn workspace quay về snapshot, gồm source và ba level test; suite lineage thuộc snapshot mới, report lịch sử không đổi |
| Chọn assessment cũ rồi chạy assessment mới; export JSON/PDF từ assessment cũ | Mỗi export trùng assessment ID và số liệu đang xem; không âm thầm thay bằng latest |
| Xóa/đổi tên scenario hiện tại rồi mở evidence assessment cũ | Vẫn tra theo scenario snapshot và artifact của assessment cũ, nếu còn retention |
| Ảnh/trace còn hạn, đã hết hạn, bị sửa bytes hoặc thuộc project khác | Evidence hợp lệ tải được; hết hạn có trạng thái rõ; integrity/ownership sai bị từ chối |
| PDF export lỗi | Hiển thị lỗi và `Retry`; không tự mở print dialog; `Print view` là hành động riêng |
| Light/dark, viewport nhỏ, keyboard/Escape, reduced motion, title/error rất dài | Đọc được nội dung, focus hợp lý, bảng/diff cuộn trong vùng phù hợp, không tràn layout |

## Kiểm tra agent đã thực hiện

- 21 Jest suite liên quan: **149 test đạt**; các thay đổi logic nhỏ sau đợt tổng hợp được chạy lại với suite tương ứng.
- Hai test Node cho terminal state và replay cursor đạt.
- Client production build đạt; lint riêng dashboard, các component System Test và workspace hook đạt, không warning.
- Lint toàn client còn **512 errors và 60 warnings**, gồm nhiều phần ngoài System Test. Không mở rộng sửa lỗi toàn repo trong đợt này.
- Prisma validate/generate đạt. Migration thật được áp dụng trên PGlite tạm; kiểm tra Apply/version/report, draft không publish trước Apply, historical check trong bản sao, restore nhiều file, ownership, conflict, idempotency và rollback filesystem khi DB lỗi đều đạt.
- PDF fixture bình thường và fixture title/error dài đã render/kiểm tra bố cục; text extraction xác nhận ID, tổng scenario, unavailable labels và trang không rỗng. Đây là dữ liệu QA tổng hợp, không phải kết quả chạy ứng dụng.
- Không chạy browser E2E, không gọi AI thật, không khởi động AUT, không migrate database thông thường.

## Giới hạn cần biết

Historical measured check hiện hỗ trợ Playwright. Cypress giữ execution path hiện có, không được gắn nhãn có measurement/evidence adapter đầy đủ. Chất lượng prompt trên ứng dụng thật cần đánh giá bằng lượt AI/E2E của bạn.

Selecting a test version does not restore historical application source. Muốn tái hiện cả source cũ phải dùng đúng project snapshot. Restore trực tiếp bị chặn nếu source/shared setup không khớp.

Không có số phần trăm API/route coverage khi chưa có inventory làm mẫu số; code path/DB change ở cấp scenario hiện hiển thị `Not captured`. Helper dùng chung với source hoặc level khác không thuộc phạm vi restore System Test.

Ảnh và trace có thể chứa dữ liệu ứng dụng; truy cập vẫn yêu cầu quyền project. Retention artifact là 14 ngày; suite blobs không bị xóa bởi cleanup artifact. Điểm chất lượng lưu lúc assessment không được tính lại chỉ vì artifact hết hạn sau này.

## Lệnh kiểm tra gọn khi cần chạy lại

```powershell
node --test client/src/components/dashboard/system/systemLiveRunModel.test.js
node tools/verify-system-suite-versions.mjs
npm.cmd run build --prefix client
# Từ client/:
npx.cmd eslint src/components/dashboard/SystemTestDashboard.jsx src/components/dashboard/system src/hooks/useSystemTestWorkspace.js
```

`tools/verify-system-suite-versions.mjs` dùng database trong bộ nhớ và workspace tạm; không dùng database cấu hình thông thường. `tools/preview-system-report.mjs` tạo hai PDF fixture trong `tmp/pdfs/` để kiểm tra layout. Không xem các fixture này là evidence sản phẩm.

## Luồng hiện tại sau follow-up

1. Mở project → khu vực Coverage/Test → sidebar `System Test`. Bộ chọn level không còn ở header.
2. Chưa có file test: chỉ hiện `No system tests yet` và `Generate tests`. Framework/config hoặc assessment cũ không làm mở dashboard nếu chưa có file test thực tế.
3. Generate → review code/Expected và shared setup → `Apply reviewed tests`. Sau Apply mới mở workspace Scenarios / Live run / Results.
4. Test cũ dùng API mocks vẫn chọn được để review, nhưng Run bị chặn và có lý do rõ ràng. Bấm `Generate Full Stack tests` để tạo suite riêng; không đổi nhãn test mock thành Full Stack.
5. `Sync Files` làm mới Expected quá mơ hồ từ assertion thật và yêu cầu confirm lại. Ví dụ: `Text "Keep Title" is visible.` và `Text "Changed Title" is not visible.`
6. Chọn scenario đã confirm → `Run Selected` → Live run → Results → Export report. `Ready` và nút Run chỉ bật khi readiness thuộc selection/hash hiện tại.
7. Version history cần hoàn tất nâng cấp schema như mục chuẩn bị. UI có thông báo migration cụ thể và Retry thay cho lỗi chung kèm loading.

Các dòng checklist Frontend/mode phía trên chỉ còn dùng để kiểm tra dữ liệu lịch sử; luồng mới không có lựa chọn Frontend.

Kiểm tra follow-up: lượt đầu 8 Jest suites / 78 tests đạt; sau chỉnh sửa tiếp theo, 7 suites / 37 tests liên quan đạt. Bốn Node model tests, lint System Test/CoveragePanel, client build, syntax check và PGlite integration đều đạt. `Layout.jsx` còn đúng 3 errors/2 warnings đã có ở HEAD; đã đối chiếu lint bản HEAD qua stdin để xác nhận không tăng lỗi. Chưa chạy browser E2E, AI thật hay AUT.
# Startup setup and external credentials

1. Open **System Test → Check setup**. With existing tests, **Run selected** also checks setup before creating a run.
2. For an unconfigured project, review the detected application directories, database and schema paths. Tick the review checkbox and choose **Apply startup setup**. This saves only `.covai/system-test.json`; it does not regenerate tests.
3. In **Test environment**, check variable names, service, status and target file. Add sandbox/test credentials to the listed `.env.test` in the imported workspace using project file management, or reimport a prepared project. Updating the original local folder does not update an imported snapshot.
4. Choose **Check again**. Required startup credentials block Run; **May be needed** variables remain warnings for particular workflows. **Present** means a value exists, not that the provider accepted it. No values should appear in this panel or downloaded variable template.
5. Start Docker Desktop on the CovAI server if the chosen database/Redis requires containers, then check again. UI-only/API-only/unified projects use their detected topology; unsupported languages/custom launchers require an appropriate runtime adapter or explicit configuration.
6. Return to scenarios and run. Manually verify successful startup, invalid-provider-key behavior, and the final report. Automated verification intentionally does not execute the application or contact Stripe/AI providers.

