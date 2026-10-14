# System test evidence assessment — runbook

Ngày cập nhật: 13/10/2026. Người dùng: developer/QA vận hành CovAI. Tài liệu này hướng dẫn bật và kiểm chứng tính năng; [plan](superpowers/plans/2026-10-13-system-test-evidence-assessment.md) ghi thiết kế và tiêu chí nghiệm thu.

## Trạng thái môi trường hiện tại

Đã áp dụng migration `20261013090000_system_assessment_evidence` vào database đang cấu hình ngày 13/10/2026; Prisma validate/generate thành công. Đã bật assessment, measured coverage và AI improvement trong `server/.env`. Mutation vẫn tắt. Container `covai_redis` đã khởi động và trả PONG; backend kết nối queue thành công. Frontend `http://localhost:5173` trả HTTP 200; endpoint evidence không có token trả HTTP 401. Chưa chạy live Gemini hoặc assessment trên project của người dùng trong bước kích hoạt này.

## Luồng bấm nút kiểm tra end-to-end

**Cập nhật 14/10/2026:** Mỗi gap có nút mở đúng file/dòng trong Explorer. Người dùng đã yêu cầu luồng AI tự động: nút **AI improve tests** gửi `autoApply:true`; server giữ nguyên test cũ, chạy baseline/candidate, chỉ lưu candidate khi cả hai lần verification đạt, không regression và comparison cùng scope/runtime. Có thể không tăng coverage; không biến pass thành correctness. Sau khi lưu và job kết thúc, UI tự gọi Run để cập nhật assessment và báo thành công. Provider unavailable có thông báo dễ hiểu và **Try again**, không báo thành công hoặc thay file. Các API khách không chọn autoApply vẫn giữ bước apply riêng. Nếu đóng tab trước callback chạy lại, bản test đã lưu vẫn được giữ và người dùng có thể bấm Run khi quay lại.

**Cập nhật luồng chính:** Người dùng chỉ bấm **Run** trên dashboard System Test. Với Playwright và measurement enabled, ứng dụng tự quét file test, nhận diện source root, chạy hai independent runs và hiển thị **Coverage & test quality**. Không nhập file path, source root hay Requirement JSON. Nút **AI improve tests** tự chọn tối đa 20 gap có bằng chứng; nếu suite nhiều file thì chọn file từ dropdown, không nhập đường dẫn. Proposal vẫn cần review diff và apply. Các bước nhập/review requirement bên dưới là workflow chuyên sâu trước đây, hiện chỉ còn các API hỗ trợ và không hiển thị trong luồng chính.

Auto-discovery chọn package frontend từ cấu hình Full Stack hoặc package client/frontend/web duy nhất, fallback package root cho single app. Source scope dùng src khi hiện hữu, nếu không dùng package root; loại tests/fixtures/mocks/config/dependencies/generated theo policy. Ambiguous package hoặc suite >20 file bị từ chối rõ ràng, không âm thầm đo một phần và gọi đó là toàn suite. Full Stack vẫn cần cấu hình startup/database sẵn có của runner. Cypress chạy theo runner cũ và chưa có measured coverage adapter.

1. Mở `http://localhost:5173`, đăng nhập, mở project trong Projects rồi mở tab **System Test** ở workspace.
2. Chọn **Playwright**, chọn **Full Stack (AUT + API)** nếu kiểm tra frontend/backend thật. Snapshot cần `.covai/system-test.json` hợp lệ và Docker hoạt động. Suite mock API chọn **Frontend Dev Server**, không dùng nó để kết luận backend đã được kiểm tra.
3. Trong **System test evidence assessment**, chọn **Test file**, điền **Frontend source root** và **Backend source root** đúng với snapshot (mặc định `client`, `server`; scope là root/src).
4. Bấm **Assess file with two independent runs**; chờ COMPLETED. Kiểm tra counters/status từng tier và hai independent runs. **Assess displayed suite** đo tập file đang hiển thị, tối đa 20 file.
5. Mở **Requirements and assertion review**, nhập JSON yêu cầu thực có `criteria` gồm `id`, `description`, `expectedOutcome`, `references`. Bấm **Create draft revision**, đọc từng expected outcome rồi **I reviewed and confirm these expected outcomes**.
6. Chọn **Criterion** → **Inspect assertions in selected file** → chọn assertion thật kiểm tra expected outcome → **Create binding for review** → đọc lại code/mapping → **I reviewed that this assertion checks the criterion**. Lặp lại cho các criterion cần kiểm chứng.
7. Bấm **Assess file with two independent runs** lần nữa. Requirement chỉ được verified khi assertion đã review thực sự đạt trong các run yêu cầu; criterion chưa có bằng chứng vẫn chưa verified.
8. Chọn các checkbox gap có bằng chứng rồi bấm **AI generate and verify tests for selected gaps**. Chờ baseline/candidate chạy xong; đọc diff, comparison và trạng thái. Lỗi provider, test fail hoặc không tăng số đo phải giữ nguyên kết luận đó.
9. Nếu đồng ý với candidate đã được kiểm chứng, bấm **Apply exact execution-verified proposal**. Chạy assessment lại sau apply. Assertion mới cần review/binding nếu muốn tính requirement verification.

Để thử nhánh lỗi: sửa test sau khi tạo proposal rồi thử apply; hệ thống phải từ chối hash cũ. Không có measurement hợp lệ thì phải hiển thị NOT_MEASURED/INVALID/UNSUPPORTED, không tự sinh phần trăm. Luồng mutation không nằm trong môi trường đã bật hiện tại.

## Các số liệu có nghĩa gì

| Bằng chứng | Cách xác lập | Giới hạn |
|---|---|---|
| Source coverage | Istanbul instrument source trong AUT copy; thu runtime counters; kiểm tra inventory/maps/run identity | Chỉ chứng minh source được thực thi, bao gồm startup; không chứng minh assertion đúng |
| Requirement design | Criterion từ revision đã owner xác nhận, có binding được review và khớp test hash/site | Source/AI draft không tự trở thành yêu cầu nghiệp vụ |
| Requirement verified | Mọi binding bắt buộc của criterion có managed assertion event đạt và scenario pass trong mỗi independent run | Đạt theo expected outcome đã review, không phải correctness tuyệt đối |
| Repeat evidence | Số independent run pass/tổng run; fresh disposable database, retries=0 | Không dùng pass rate của một run làm stability score |
| Fault detection | Mutation được thực thi, assertion đã review liên quan thất bại | Tỷ lệ chỉ áp dụng tập fault đã đánh giá; crash/timeout/infra/unrelated failure không tính detected |

Counters chứa `covered`, `total`, `pct`. Mẫu số 0 → `pct:null`. Không có artifact phù hợp → NOT_MEASURED. Legacy numeric fields không có provenance → LEGACY_UNVERIFIED và không xuất thành phần trăm đo thực. Không chia contribution từ suite tổng cho scenario/file.

Frontend/backend độc lập. Scope là mọi eligible JS/JSX/TS/TSX application file dưới root/sourceDirectory đã chọn (backend direct JS only); tests, dependencies, declaration files và generated outputs bị loại theo policy rõ ràng. Module chưa load vẫn có zero coverage map và nằm trong mẫu số.

PARTIAL chỉ có thể mô tả measured subset; không coi tỷ lệ subset là tỷ lệ toàn source scope. INVALID không có % thay thế. UI không có accuracy %, AI confidence % hoặc quality score tự đặt.

## Điều kiện chạy

- Schema mới và Prisma client đã đồng bộ. Migration mới: `20261013090000_system_assessment_evidence`.
- Redis hoạt động để queue và lease dùng cùng trạng thái. Evidence operation không cung cấp distributed safety bằng một in-memory fallback.
- Snapshot source hiện hữu; file được chọn là repository-relative `.spec/.test` JS/TS; không source symlink hoặc credential file.
- Full Stack Playwright có `.covai/system-test.json` hợp lệ, Docker chạy được, PostgreSQL/MySQL test schema và startup command hoạt động.
- AUT/build/runner phụ thuộc vào host hiện tại. Database là disposable container; frontend/backend/test process vẫn chạy host. Mutation chỉ dành cho trusted local environment được cấu hình rõ ràng, không bật cho AUT không tin cậy trong dịch vụ nhiều người dùng.

## Migration và bật tính năng

Migration additive đã được xác minh trên database dùng một lần và đã áp dụng vào DATABASE_URL hiện tại theo yêu cầu người dùng. Các bước dưới đây dành cho môi trường khác; review deployment và backup theo chính sách của môi trường trước khi áp dụng vào production.

```powershell
# Trong server/ sau khi review SQL và chọn đúng database đích:
npx.cmd --no-install prisma migrate deploy
npx.cmd --no-install prisma generate
npx.cmd --no-install prisma validate
```

Lịch sử migration hiện có của repository thiếu initial baseline đầy đủ: fresh `migrate deploy` lỗi ở `20260822090000_add_system_test_analysis` vì `TestType` chưa tồn tại. Verification tool dựng schema trước thay đổi rồi áp dụng riêng migration mới để kiểm chứng nó. Không chạy `migrate reset`, không sửa migration đã áp dụng, không tự `migrate resolve` trên database đang dùng để che lỗi lịch sử. Với DB hiện hữu phải kiểm tra schema/migration status trước deploy; initial-baseline reconciliation là công việc riêng.

Thêm flags vào cấu hình môi trường rồi restart server:

```dotenv
SYSTEM_ASSESSMENT_ENABLED=true
SYSTEM_MEASURED_COVERAGE_ENABLED=true
SYSTEM_AI_IMPROVEMENT_ENABLED=true
SYSTEM_MUTATION_ENABLED=false
SYSTEM_MUTATION_TRUSTED_LOCAL=false
```

Mặc định các flags không bật. Chỉ bật mutation sau kiểm chứng trong trusted local setup:

```dotenv
SYSTEM_MUTATION_ENABLED=true
SYSTEM_MUTATION_TRUSTED_LOCAL=true
```

Không có flag nào biến một adapter unsupported thành measured. API `GET /api/coverage/:snapshotId/system/capabilities` trả trạng thái enable và support riêng.

## Workflow

1. Mở System Test, chọn runner/mode, điền file test và frontend/backend source root. Scope hiện rõ root/src. Bấm “Assess with two independent runs”. Queue acceptance chưa phải test pass.
2. Xem coverage counters từng tier, run results và gaps. Legacy/chưa chạy/instrumentation mất dữ liệu sẽ không có phần trăm giả.
3. Mở Requirements and assertion review. Tạo draft JSON gồm `criteria` với `id`, `description`, `expectedOutcome`, `references`; review và confirm expected outcomes. Revision đã confirm được giữ bất biến.
4. Chọn criterion, inspect assertion của file test, tạo binding. Đọc code assertion và expected outcome, rồi approve binding. Tên test có criterion ID hoặc attachment do test tự tạo không đủ.
5. Chạy lại assessment để managed fixture thu assertion event khớp binding/hash/run. Thay đổi test hoặc requirements làm evidence cũ stale; không tự xác nhận mapping mới.
6. Chọn gap có nguồn: measured uncovered line, confirmed criterion chưa verified hoặc AST finding. Bấm AI generate and verify. Provider unavailable/invalid candidate là error riêng; không inject body-visible fallback.
7. Proposal phải giữ imports/helpers/hooks và test cũ; expected values/matchers không được giảm. Baseline và candidate chạy cùng source/scope/runtime policy, candidate chạy hai lần. Diff read-only và comparison hiển thị số đo thực.
8. Apply chỉ exact verified candidate với source/test/revision hashes hiện tại. NO_MEASURED_IMPROVEMENT có thể execution-valid, nhưng không được nói tăng coverage. Assertion cho criterion mới vẫn cần owner review.
9. Trong trusted local mutation, chọn ≤10 source targets và approved assertion liên quan từng target. Ba clean baseline runs là precondition. KILLED_ASSERTION/SURVIVED/NOT_EXERCISED và unresolved states hiển thị riêng.

## Runtime và lưu bằng chứng

- Jobs mới: SYSTEM_TEST_ASSESSMENT, SYSTEM_TEST_IMPROVEMENT, SYSTEM_TEST_MUTATION.
- Redis lease theo snapshot: TTL 60s, renew 15s, release phải đúng token. Hạn operation 20 phút; cancellation kiểm tra qua heartbeat và AbortSignal cho owned test/dependency process. Existing system editor và project file editor phối hợp lease khi tính năng bật.
- Workspace là copy riêng trong OS temp, không copy `.env`/credential files. Source/test hashes kiểm tra trước/sau. Cleanup xác minh realpath thuộc workspace namespace.
- Managed backend có measurement nonce header để phân biệt instance đang phục vụ API. Một response từ AUT khác làm assessment invalid, không dùng kết quả đó xác minh requirement.
- Browser coverage được chụp trước direct navigation/reload/close và archive same-origin document qua pagehide. Collector kiểm tra navigation archive thất bại, maps và integer counters.
- Raw evidence dưới snapshot `.covai-system-test/assessment/<measurementId>/`: reporter JSON và measurement/map/events. Giữ metadata trong DB; purge artifact folders quá 14 ngày khi nhận operation mới dưới lease. Không dọn proposal recovery journals bằng policy này.
- Coverage artifacts tổng ≤50 MiB/run; assertion payload từng event <64 KiB. Selected tests ≤20, mỗi test ≤256 KiB; source file inventory hiện giới hạn 5 MiB/file. Giới hạn resource không phải quality threshold.
- Apply có recovery journal, temp write/atomic rename và phục hồi original nếu metadata update thất bại. RECOVERY_REQUIRED phải được xử lý trước apply tiếp theo. Các client ghi ngoài endpoint phối hợp lease vẫn phải được xem là external edits và được kiểm tra bằng source/test hash; lease không khóa editor trên hệ điều hành.

## Các trạng thái cần xử lý

| Trạng thái | Hành động |
|---|---|
| LEGACY_UNVERIFIED | Chạy assessment instrumented mới; không backfill bằng tên/scenario/pass rate |
| NOT_MEASURED | Kiểm tra capability, source root, artifact/session; chưa có run data thì chạy mới |
| UNSUPPORTED/PARTIAL | Xem omissions/reason codes; chỉ báo cáo subset và giới hạn, không tăng % bằng bỏ file |
| INVALID / AUT_IDENTITY_MISMATCH | Kiểm tra maps, run IDs và AUT instance/ports; run lại sau sửa nguyên nhân |
| STALE / hash conflict 409 | Reload file/revision và đánh giá lại; không overwrite bằng proposal cũ |
| FAILED_VERIFICATION | Giữ lỗi/assertion; phân biệt ứng dụng lỗi, test mechanics hay infra. Không relax expected outcome |
| PROVIDER_UNAVAILABLE | Kiểm tra provider/quota/config; không có fallback chứng minh improvement |
| Mutation baseline failed | Chưa đánh giá mutation; sửa hoặc phân loại baseline trước |
| TIMEOUT/INFRA_ERROR/AMBIGUOUS | Không tính detected fault; giữ bằng chứng và unresolved count |
| RECOVERY_REQUIRED | Dừng apply; đối chiếu journal và file hash để phục hồi bản phù hợp, giữ audit |

## Kiểm chứng

```powershell
# Repository root — cần quyền Docker và download dependencies/browser khi cache thiếu
node tools/verify-system-assessment.mjs
node tools/verify-system-assessment.mjs --improvement
node tools/verify-system-assessment.mjs --typescript-only
node tools/verify-system-assessment-migration.mjs
npm.cmd run build --prefix client

# Trong server/
npx.cmd --no-install prisma validate
npx.cmd --no-install prisma generate
```

Runtime fixture là Vite/React → Node HTTP → PostgreSQL thật, fresh DB mỗi run. Strong tests kiểm tra create/persistence/blank rejection; weak test thực hiện cùng blank action nhưng chỉ assert body. Fault marker chứng minh expression đã thực thi, không suy từ test title. `--improvement` dùng provider response kiểm soát, không gọi live Gemini, rồi chạy candidate thật và so source counters. TSX compatibility được kiểm tra riêng trước công bố capability.

Test Jest tập trung: `systemCoverageTruthfulness`, `systemCoverageCollector`, `systemAssessment.service`, `systemAssessment.route`, `systemAssessmentWorkspace`, `systemTestProposalApply`, `systemExecutionCancellation` và các existing system/fullSystem suites. Browser review của panel dùng recorded runtime fixture: desktop/mobile/light/dark, no horizontal overflow; axe-core scope main có 0 violations. Đây là UI rendering review, không thay test ownership/runner bằng mock response.

Kiểm tra toàn repo có failures baseline ngoài scope. Bảy suite đã được chạy lại trên source HEAD trước thay đổi, vẫn có 41 failures: coverage.route.auth, job.concurrency, supertestRunner, unitTestSuggestion, coverageFinalParser, integrationGuidance.service, apiEndpointParser.service. `phase4RefinementLoopAndVerification` còn timeout trong full run; không gọi full suite green.

## Giới hạn hỗ trợ

- Managed evidence runner: Playwright. Cypress execution cũ vẫn tồn tại, nhưng new assessment từ chối Cypress cho đến khi adapter đã runtime-verified.
- Backend instrumentation: direct Node JS ESM/CJS. Backend TS/transpiler/build-output runtime chưa được chấp nhận làm measured adapter.
- Source có Istanbul ignore directives, worker/service-worker hoặc child_process/worker_threads cần adapter riêng và được báo omissions/partial.
- Requirements: direct imported Playwright test/expect, static scenario identity và awaited reviewed assertion sites. Custom fixture/dynamic/helper/custom matcher links có thể unsupported; không tự grade.
- No per-scenario backend percentage under parallel execution. No all-browser/all-framework/full-project correctness guarantee.
- Mutation custom bounded AST operators, không gắn nhãn standard Stryker score. Trusted host execution không phải sandbox chống AUT độc hại.

## Rollback

Tắt flags, ngừng admission và cancel jobs đang owned. Giữ reports/revisions/proposals và migration additive. Không khôi phục synthetic coverage hoặc stability-from-pass-rate. Nếu database chưa migration, đừng bật new flags hoặc deploy generated Prisma/schema mới vào instance đó. Rollback schema/drop enum/models cần kế hoạch riêng, không chạy tự động.
