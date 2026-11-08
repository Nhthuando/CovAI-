# System Test: rà soát và cải thiện ngày 07/11/2026

## Kết quả và phạm vi

Đã sửa luồng chạy tự động, cấu hình env, discovery, chuẩn bị runtime, thu hồi tiến trình và một số điểm giới hạn tài nguyên. **Chưa có cơ sở cam kết chạy mọi dự án JavaScript hoặc đạt high availability nhiều máy.** Chạy được test, đo được source coverage và xác minh được yêu cầu nghiệp vụ là ba khả năng riêng biệt.

[Inventory source hiện hành](system-test-scalability-inventory-2026-11-07.json) ghi đường dẫn, số dòng, loại file và SHA-256. Bản đồ xuất phát từ UI/API/System Test, mở rộng theo import cục bộ và lập danh mục test liên quan; không sử dụng bản sao trong `temp` làm source. Có thể tái tạo bằng `node tools/audit-system-test-inventory.mjs`.

Đọc sâu các điểm quyết định hành vi trong dashboard/workflow/setup dialog, controller/admission, job, runner, startup, dependency preparation, environment, resource provisioning, lease, workspace, instrumentation/collector, scenario catalog/verdict và persistence/report projection. Các dependency ngoài luồng chính được truy vết qua import và tìm điểm sử dụng. Inventory không đồng nghĩa mọi dòng trong dependency graph đã được review độc lập hoặc kiểm chứng động; không tuyên bố một cuộc audit toàn repo không bỏ sót lỗi.

## Luồng hiện tại sau thay đổi

1. Người dùng chọn Run. UI giữ khóa yêu cầu ngay khi click, tránh gửi hai job trong lúc preflight đang chạy.
2. Preflight nhận diện topology và các biến bắt buộc của startup thực sự được chọn. Các biến auth nội bộ, cổng, URL và database/cache do CovAI quản lý không yêu cầu người dùng tự điền.
3. Nếu thiếu credential bắt buộc, UI mở dialog và cho nhập giá trị sandbox dưới dạng password. Lưu thành công sẽ kiểm tra lại và tiếp tục lần Run đang chờ đúng một lần. Biến tùy chọn không chặn Run.
4. Lỗi Docker, topology không rõ hoặc adapter không hỗ trợ được hiển thị như lỗi setup/runtime. Không tự mở modal yêu cầu env cho những lỗi này. Người dùng vẫn có thể mở Check setup để xem chi tiết.
5. Với lựa chọn scenario cụ thể, UI gửi `reviewMode: execution`; vẫn kiểm tra file/hash/selection/assertion và từ chối API mock trong Full Stack. Không tự xác nhận Expected.
6. Khi không có lựa chọn cụ thể, UI gửi assessment tự discovery. Worker tự chuẩn bị startup và test. Nếu chưa có test tương thích, chỉ sinh test khi `allowGenerate: true` và người gọi có quyền AI.
7. Test tự sinh được verify trước, sau đó assessment chạy hai lần trong các workspace độc lập. Job chạy với `publish: false`: source, test, setup và catalog của dự án gốc không tự bị Apply. Code test sinh cho run được giữ trong report để không mất ngữ cảnh sau khi workspace tạm bị xóa.
8. Report ghi kết quả thực thi, evidence và trạng thái coverage. Run tự động dùng scenario DRAFT; không biến thành xác nhận nghiệp vụ, không tự tính quality score khi thiếu điều kiện review.

Các cờ `SYSTEM_ASSESSMENT_ENABLED` và `SYSTEM_MEASURED_COVERAGE_ENABLED` vẫn phải được bật trên server để dùng pipeline assessment mới. Không tự thay cấu hình triển khai của người dùng.

## Vấn đề tìm được và đã sửa

| Vấn đề | Hành vi sau sửa | Kiểm chứng |
|---|---|---|
| Package cha nhận nhầm HTTP import hoặc Prisma schema của package con | Phân chia source theo ranh giới package, dùng chung giữa plan/preflight/runtime | Plan, discovery và preflight regression |
| Source budget cạn trước khi đến `package.json` cuối repository | Quét metadata package riêng khỏi context budget; báo `sourceInspection.truncated` | Fixture source lớn vẫn phát hiện frontend |
| Discovery chỉ suy luận backend từ tên `server/backend/api` trước khi có setup | Dùng plan từ source khi setup chưa được lưu, hỗ trợ thư mục workspace tùy ý khi topology rõ | Fixture `apps/shop` và `apps/orders` |
| Preflight kiểm tra script `start`, nhưng unified/frontend lại chạy `dev` | Env analysis theo cùng thứ tự chọn script với launcher | Fixture credential khác nhau giữa dev/start |
| Barrel export che mất module khởi tạo SDK cần credential | Lần theo `export ... from` và `export * from` trong startup graph | OpenAI qua module re-export |
| Runtime kiểm tra env trước khi có URL/cổng tự quản lý | Tạo URL/cổng rồi kiểm tra; kiểm tra cả frontend trước khi provision database | Lifecycle regression |
| Một package công cụ không được chạy vẫn gây blocker env | Chỉ credential bắt buộc của package được chọn mới chặn startup | Unused tool package fixture |
| Dialog chỉ tải template, chưa nhập được env | Thêm API lưu env có kiểm tra quyền, allowlist và input password; tự tiếp tục Run | Service authorization tests và browser test |
| Run ép review Expected hoặc dừng tại empty state | Thêm execution-only và automatic assessment trong job nền; giữ nguyên review state nghiệp vụ | Admission/preparation/catalog và browser tests |
| Request assessment bỏ qua flush/checkpoint editor | Thêm assessments vào client editor flush và server checkpoint boundary | Lint/build và regression policy |
| Docker lỗi thì âm thầm đổi MySQL/PostgreSQL sang SQLite, giả lập transaction | Bỏ fallback và driver shim; giữ engine thật, trả lỗi hạ tầng | Lifecycle test kiểm tra không provision lần hai |
| Route readiness được phát hiện có thể cần đăng nhập | Route thông thường dùng HTTP handshake, chấp nhận 401/403; endpoint health rõ ràng vẫn phải thành công. 408/429 tiếp tục retry, 5xx không được coi là sẵn sàng | HTTP server fixture thật |
| Mỗi thao tác headless bị chậm mặc định 120 ms | Headless mặc định `slowMo: 0`; chế độ cửa sổ demo vẫn giữ delay | Generated config + runner regression |
| Bước cài Playwright browser không nhận tín hiệu hủy | Truyền signal từ observation và runner vào browser installer; truyền cả ở nhánh Cypress | Runner regression |
| Caller trước thất bại làm caller chờ cùng install root thất bại theo | Caller sau đợi kết thúc rồi tự thử chuẩn bị bằng signal/env của nó | Concurrent dependency regression |
| Tiến trình import thừa hưởng toàn bộ credential của CovAI; runner còn tự đọc `.env` | Tách môi trường tiến trình cho install/build/seed/AUT/test/browser CLI. Chỉ giữ biến OS cần thiết và env được truyền rõ ràng; isolated runner không tự đọc production `.env` | Subprocess fixture thật |
| stdout/stderr subprocess giữ trong RAM không có giới hạn | Giữ phần cuối tối đa 2 Mi ký tự mỗi stream và pending buffer; trả `outputTruncated` | Fixture phát hơn 3 Mi ký tự |
| Hủy tiến trình Windows dùng `spawnSync(taskkill)` | Dùng taskkill bất đồng bộ có deadline/fallback, không khóa event loop trong khi đợi | Test hủy tiến trình thật ngoài sandbox |
| Worker chỉ có concurrency mặc định của BullMQ | Cho cấu hình concurrency 1–32 và tắt consumer trên API instance; giữ mặc định 1 | Worker config + queue regression |

AST env được cache bằng WeakMap trong cùng tập source object để tránh parse lặp. Không cache credential hoặc giữ source của request vô hạn. Docker preflight dùng server-version probe thay cho `docker info`.

Report cũng ghi rõ khi SQL schema được suy ra từ query. Chạy trên schema suy luận không chứng minh tính đúng của constraint, index hoặc migration production.

## API và cấu hình thêm

### Chạy kỹ thuật tự động

```http
POST /api/coverage/:snapshotId/system/assessments
Content-Type: application/json

{
  "autoDiscover": true,
  "runner": "playwright",
  "executionMode": "full",
  "allowGenerate": true,
  "headed": false
}
```

Endpoint kiểm tra snapshot membership, quyền `tests.run`, quyền `ai.use` khi cho sinh test, operation đang hoạt động và lease. Trả `202` với `jobId`/`assessmentId`; không giữ HTTP request trong suốt quá trình AI/cài dependency/chạy test. Job vẫn giới hạn thời gian và số request AI.

### Lưu test environment

`POST /api/coverage/:snapshotId/system/setup/environment` nhận workspace revision và danh sách `{envFile, name, value}`. Cần `evidence.approve`, tức owner theo role hiện tại. Service kiểm tra quyền lại trong project guard, từ chối khi có job project đang chờ/chạy, chỉ chấp nhận credential bắt buộc đã phát hiện và đúng đường dẫn `.env.test` của package. Không cho ghi biến managed hoặc đường dẫn tùy ý. Giá trị mới thay thế theo file tạm/rename; giữ các biến test đã có. Response chỉ trả số biến đã lưu.

Env không được đưa vào payload operation, version file, report, audit inventory hoặc setup AI. `.env` production không bị ghi đè. File `.env.test` vẫn là credential lưu trên filesystem server; cần quản lý quyền lưu trữ và backup ở tầng triển khai như trước.

Không đổi Prisma schema/migration và không cài thêm dependency.

### Điều chỉnh consumer

```dotenv
COVAI_WORKER_ENABLED=true
COVAI_WORKER_CONCURRENCY=2
```

Mặc định vẫn bật worker, concurrency 1. Chỉ tăng theo RAM/CPU thực đo vì mỗi job có thể chạy browser, app, database và nhiều lượt verify. `COVAI_WORKER_ENABLED=false` cho API instance chỉ submit job. Những worker xử lý cùng queue phải nhìn thấy cùng workspace storage tại đường dẫn nhất quán; các biến này chưa tạo ra kiến trúc worker nhiều máy hoàn chỉnh.

## Giới hạn tương thích và availability còn lại

| Nhóm dự án | Khả năng hiện có / giới hạn |
|---|---|
| Vite với JS/JSX/TS/TSX | Có frontend instrumentation adapter; không khẳng định đã chạy mọi framework/plugin Vite thực tế |
| Node chạy trực tiếp JS ESM/CJS | Có backend instrumentation; source worker/subprocess hoặc phần bị loại phải trả trạng thái partial/unsupported |
| Backend TypeScript, build output hoặc runtime tùy biến | Có thể khởi động khi launcher/dependency phù hợp; backend source coverage hiện không hỗ trợ đầy đủ |
| Next/Nuxt/Astro/Angular/Parcel | Có nhận diện/startup cho một số cấu hình. Không có bảo đảm source coverage tương đương Vite; phải giữ `UNSUPPORTED` khi adapter không đáp ứng |
| Frontend-only / backend-only | Có topology một process, không dựng backend/frontend giả. Sinh test API-only vẫn có thể thất bại vì generator hiện ưu tiên quan sát UI |
| Library, CLI, project không có HTTP startup | Không phù hợp browser System Test hiện tại; cần adapter unit/API/CLI khác |
| Monorepo | Hỗ trợ cặp frontend/backend rõ ràng. Nhiều ứng dụng tương đương, nhiều microservice phụ thuộc nhau hoặc task orchestrator tùy biến chưa được giải quyết tổng quát |
| Package manager / Node version | Theo runtime plan và lockfile/engines đã có. Worker phải có Node và package manager/khả năng lấy CLI tương thích |
| External integration | Chỉ một số SDK, env reference và startup guard được phân tích. Dynamic config, schema validator env và credential chỉ cần trong workflow có thể chỉ lộ ra lúc chạy |

Giới hạn thực tế còn thấy trong source:

- Managed evidence chủ yếu hỗ trợ Playwright. Cypress chưa có adapter measured evidence được xác minh.
- Assessment giới hạn 20 file, lựa chọn tối đa 100 scenario; không thể gọi đây là hỗ trợ suite lớn tùy ý. Chưa có shard scheduler, quota theo tenant hoặc admission theo tổng RAM/CPU.
- Discovery source vẫn có budget; runtime plan vẫn có giới hạn số directory/depth. Metadata không còn bị mất do context source, nhưng env analysis chưa thể coi là đầy đủ cho repository bất kỳ.
- Workspace copy, hashing và instrumentation vẫn có nhiều filesystem call đồng bộ. Chưa load test concurrent tenants hoặc đo p95/p99, nên không đưa ra mức tăng throughput hay SLA.
- Report JSON còn được đọc nguyên file ở một số điểm. Giới hạn stdout/stderr không thay thế budget cho report/artifact trên disk; cần bổ sung trước khi mở suite và tenant không giới hạn.
- App/test của dự án import vẫn chạy trên host (`forceHost: true`). Tách env không sandbox filesystem/network và không tạo CPU/memory isolation cho ứng dụng import. Cần worker/container boundary trước khi chạy nguồn không tin cậy ở quy mô public.
- Live frame mới nhất còn nằm trong Map của process; Socket.IO chưa có adapter phân phối tương ứng. Event đã lưu có thể polling/replay, nhưng live frame và broadcast chưa đạt failover nhiều worker/API instance.
- Redis/PostgreSQL và workspace storage vẫn là dependency availability của pipeline. Chưa triển khai HA topology, durable artifact object storage, graceful worker drain toàn hệ thống hoặc khôi phục job đang chạy theo từng stage sau khi máy chết.

Do đó thông báo env chỉ bật tự động khi có bằng chứng thiếu env bắt buộc trong phạm vi phân tích; không thể hứa mọi lỗi setup của mọi dự án đều quy về env. Lỗi hạ tầng/adapter phải được giữ đúng loại lỗi.

## Kiểm chứng

- Regression System Test và các service liên quan: **598 tests passed, 77 suites passed; 4 tests trong 2 suites opt-in bị skip**. Report máy đọc: `temp/system-scalability-regression.json`. Các thay đổi readiness cuối cùng còn được chạy lại bằng bộ focused riêng.
- Browser: **4 tests passed**, render React production component bằng Vite và intercept HTTP deterministically. Kiểm tra empty import, duplicate click, required env/password/save/resume, Docker failure và selected imported draft. Không gọi AI, database, Redis hoặc gửi run vào dự án thật.
- [Ảnh UI env đã kiểm tra](assets/system-test-env-required-2026-11-07.png) được tạo bằng dữ liệu sandbox fixture; đã mở kiểm tra layout.
- Build frontend thành công. ESLint các file frontend thay đổi đạt; build còn cảnh báo bundle lớn/dynamic import của ứng dụng.
- Test hủy tiến trình không chạy được trong sandbox Windows; chạy ngoài sandbox qua approval của môi trường đạt, dừng fixture trong khoảng 771 ms ở lượt kiểm tra riêng. Đây là kết quả một fixture, không phải benchmark availability.
- Đã sửa fixture hai suite cũ: kỳ vọng mode Full Stack hiện hành; cung cấp mock discovery/scenario count và quyền auto-generation rõ ràng cho legacy job test. Không bỏ assertion để che lỗi sản phẩm.
- Chưa chạy full pipeline với Gemini thật, mọi loại database thật hoặc ma trận nhiều dự án/framework. Các suite tích hợp opt-in chưa bật không được tính là đã xác minh.

## Công việc tiếp theo để đạt mục tiêu rộng hơn

1. Tách executor thành worker/container theo job, giới hạn CPU/RAM/PID/disk/network và timeout cho cả lifecycle; thêm admission/quota theo tenant.
2. Chuyển live frame, transport và artifact sang storage/bus dùng chung; thêm graceful drain, reconciliation và recovery stage có idempotency.
3. Tách adapter detection/startup/env/readiness/coverage theo framework; thêm fixture thật cho từng runtime/package manager, API-only, workspace và database.
4. Bổ sung workflow fixture dữ liệu, auth và dependency service thay vì suy ra toàn bộ schema/credential từ source. Sinh test kỹ thuật không thay thế đặc tả nghiệp vụ được xác nhận.
5. Shard suite lớn, giới hạn job theo ngân sách, benchmark tải nhiều tenant và tối ưu filesystem work dựa trên số đo. Không tăng concurrency vô hạn chỉ để có nhiều job RUNNING.
