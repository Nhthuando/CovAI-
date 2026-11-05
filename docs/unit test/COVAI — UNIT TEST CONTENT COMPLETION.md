# COVAI — UNIT TEST CONTENT COMPLETION
## Gemini Task Decomposition, Root-Cause Analysis & End-to-End Implementation

### 1. Vai trò

Bạn là Senior Software Architect, Backend Engineer, Frontend Engineer và QA Automation Engineer, chịu trách nhiệm hoàn thiện chức năng **Unit Test Content** trong dự án CovAI.

Bạn phải làm việc trực tiếp trên repository hiện tại, đọc mã nguồn thực tế, phân tích nguyên nhân gốc, chia công việc thành các task nhỏ có thứ tự phụ thuộc, sau đó thực hiện từng task cho đến khi luồng nghiệp vụ hoạt động đúng.

**Không chỉ đưa ra kế hoạch. Phải triển khai sửa lỗi, viết test, chạy test và xác minh kết quả thực tế.**

Không được đoán nguyên nhân chỉ dựa vào console log. Không được coi việc UI không còn báo lỗi là bằng chứng chức năng đã đúng.

---

### 2. Bối cảnh và các lỗi hiện tại

#### Lỗi A — Coverage API trả HTTP 500

Request thất bại:

```text
/api/coverage/cmvhxwejv000hr0o1sykm9qjv/integration/workspace
500 Internal Server Error
```

Request này xuất hiện nhiều lần khi giao diện Unit Test Content tải dữ liệu.

Cần xác định:

- Route/controller nào xử lý endpoint.
- Service nào được gọi.
- Endpoint yêu cầu dữ liệu nào và trả về response schema nào.
- Lỗi xảy ra trong truy vấn DB, phân tích source code, đọc coverage artifact, xử lý project path hay bước tổng hợp kết quả.
- Vì sao cùng request liên tục trả 500.
- Có retry hoặc React effect nào đang tạo request lặp không.
- Response lỗi có làm frontend tiếp tục sử dụng dữ liệu không hợp lệ không.

Không được chỉ thêm `try/catch` rồi trả dữ liệu rỗng để che lỗi. Phải tìm và sửa nguyên nhân gốc.

#### Lỗi B — Frontend không xử lý đúng `discoveredEndpoints`

Console báo:

```text
Failed to check hasAnalysis for AIPanel:
Error: discoveredEndpoints.map is not a function
    at handleResponse (coverage.service.js:29:15)
```

Cần kiểm tra trực tiếp:

- `coverage.service.js`, đặc biệt dòng 29 và hàm `handleResponse`.
- Nơi khai báo và sử dụng `discoveredEndpoints`.
- Backend trả về `discoveredEndpoints` dưới dạng array, object, string, `null` hay response envelope khác.
- API client có bóc đúng `response.data` không.
- Có trường hợp backend trả `{ data: ... }`, `{ success: true, data: ... }`, error object hoặc schema khác không.
- Type/interface hiện tại có khớp dữ liệu runtime không.

Không được sửa bằng cách tùy tiện dùng `Object.values()`, ép kiểu hoặc biến mọi dữ liệu không hợp lệ thành `[]` mà không hiểu schema.

Phải xác định một response contract rõ ràng giữa backend và frontend. Với response không hợp lệ, cần xử lý an toàn, có log và thông báo lỗi phù hợp.

#### Lỗi C — Suggest Test hoạt động nhưng Apply bị lỗi

Giao diện hiển thị luồng:

1. AI Suggestion.
2. Viewing / Ready to Suggest.
3. Review & Apply.
4. Merged.
5. Continuous Loop — chạy lại test và kiểm tra coverage.

Tính năng Suggest có thể tạo gợi ý, nhưng khi Apply thì gặp lỗi hoặc kết quả không đúng.

Cần truy vết toàn bộ pipeline:

```text
AST / CFG / Coverage Analysis
          ↓
Missing Test Suggestion
          ↓
Suggestion Normalization
          ↓
Review & Apply
          ↓
Target File Resolution
          ↓
Merge / Patch Validation
          ↓
Write Test File
          ↓
Run Test Suite
          ↓
Collect Coverage
          ↓
Verify Result
```

Đây là sơ đồ cần kiểm chứng với implementation thực tế, không được mặc định mọi stage đã tồn tại hoặc hoạt động như mô tả.

Xác định chính xác stage gây lỗi, dữ liệu vào/ra, schema và các điều kiện khiến Apply thất bại.

#### Lỗi D — Bộ lọc business logic chọn file không chính xác

Danh sách file được đưa vào phân tích hoặc chọn làm target cho test không đúng với nghiệp vụ mong muốn.

Cần xác minh:

- File nào được xem là source file có thể kiểm thử.
- File nào là test file.
- File nào bị loại trừ.
- Cách phát hiện file có thể export function/class.
- Cách ánh xạ test file với source file.
- Cách xử lý file có nhiều function, class, route hoặc module.
- Cách xử lý file TypeScript/JavaScript, ESM/CommonJS, index/barrel files và generated files nếu được hỗ trợ.
- Cách xử lý source file không có test tương ứng.
- Cách phân biệt source code của project với mã trong thư mục `node_modules`, build output, cache và thư mục nội bộ của CovAI.
- Cách lọc theo project root, snapshot và file extension.
- Có nhầm lẫn giữa coverage path, source path và test path không.
- Bộ lọc đang dựa trên tên file, regex, AST metadata, import graph hay heuristic nào.

Không được chỉ sửa một regex hoặc thêm vài điều kiện loại trừ tùy tiện. Phải xác định quy tắc nghiệp vụ, viết test cho quy tắc đó và đảm bảo mọi stage sử dụng cùng một cách xác định target file.

---

### 3. Nguyên tắc triển khai

1. Đọc repository và xác định chính xác frontend, backend, DB schema, test runner và các service liên quan.
2. Kiểm tra Git status trước khi sửa; giữ nguyên thay đổi hiện có của người dùng.
3. Không xóa hoặc sửa source code của project được import chỉ để làm test pass.
4. Không bỏ test, không dùng `.skip`, không xóa assertion và không giảm tiêu chuẩn kiểm thử.
5. Không giả lập response thành công để che API 500.
6. Không tạo test content giả hoặc báo coverage tăng nếu chưa chạy test thực.
7. Không ghi đè test file có sẵn khi chưa kiểm tra nội dung, framework và quy ước của project.
8. Mọi thao tác Apply phải có kiểm tra target path, kiểm tra patch, bảo toàn nội dung hiện có và xử lý lỗi an toàn.
9. Ưu tiên tái sử dụng service, parser, AST analyzer và coverage pipeline hiện có.
10. Không thêm thư viện mới nếu chưa chứng minh thư viện hiện tại không đáp ứng được yêu cầu.
11. Phân biệt rõ lỗi chức năng, lỗi dữ liệu, lỗi môi trường và lỗi hạ tầng.
12. Không tuyên bố hoàn thành nếu mới chỉ viết code mà chưa kiểm tra luồng end-to-end.

---

### 4. Phase 1 — Khảo sát repository và lập dependency map

Trước tiên, tìm các file thực tế liên quan đến:

- Unit Test Content page/component.
- AIPanel và logic kiểm tra `hasAnalysis`.
- `coverage.service.js`.
- Backend coverage routes/controllers/services.
- Endpoint `/api/coverage/:projectId/integration/workspace`.
- AST/CFG/complexity analyzer.
- Business logic chọn source file và target test file.
- Suggestion generation và normalization.
- Review & Apply service.
- Test file merge/patch implementation.
- Jest/Vitest runner.
- Coverage parser, artifact store và source-to-test mapping.
- Prisma models và các trường liên quan đến project, snapshot, analysis, suggestion, test run.
- Các unit/integration tests hiện có.

Sau đó tạo dependency map:

| Component | Input | Output | Owner | Tests hiện có | Vấn đề |
|---|---|---|---|---|---|
| Coverage API | | | | | |
| Coverage service frontend | | | | | |
| Business file filter | | | | | |
| AST/CFG analyzer | | | | | |
| Suggestion generation | | | | | |
| Apply/merge service | | | | | |
| Test runner | | | | | |
| Coverage verification | | | | | |

Điền bằng thông tin đọc từ source code, không được tự bịa tên file hoặc hàm.

---

### 5. Phase 2 — Chia thành các task có dependency

Tạo danh sách task theo thứ tự ưu tiên. Mỗi task phải có:

- ID.
- Mục tiêu.
- File hoặc module liên quan.
- Root cause cần xác minh.
- Các bước sửa.
- Unit tests cần bổ sung.
- Integration tests cần bổ sung.
- Dependency với task khác.
- Tiêu chí acceptance.
- Kết quả thực tế sau khi hoàn thành.

Dùng các nhóm sau, nhưng điều chỉnh theo kiến trúc thực tế.

#### Task 1 — Reproduce lỗi và thiết lập baseline

- Chạy lại lỗi API 500.
- Lấy backend stack trace đầy đủ.
- Ghi lại request, response và status code.
- Xác định bước phát sinh lỗi.
- Ghi nhận baseline test và coverage.
- Tạo regression test tái hiện lỗi.

**Acceptance:** Có test tái hiện được lỗi hoặc có bằng chứng rõ ràng về điều kiện môi trường khiến không thể tái hiện.

#### Task 2 — Chuẩn hóa Coverage API contract

- Xác định response schema chuẩn.
- Kiểm tra controller/service/repository.
- Sửa nguyên nhân gây HTTP 500.
- Xử lý trường hợp project/snapshot/analysis chưa tồn tại.
- Phân biệt dữ liệu rỗng hợp lệ với lỗi thực sự.
- Chuẩn hóa error response.
- Thêm tests cho success, empty state, invalid ID, missing analysis và internal error.

**Acceptance:** Endpoint trả đúng schema trong mọi trường hợp đã định nghĩa; lỗi nội bộ không bị che giấu thành success.

#### Task 3 — Sửa `discoveredEndpoints` contract

- Xác định nguồn tạo `discoveredEndpoints`.
- Chuẩn hóa backend response và frontend type.
- Sửa `handleResponse` để xử lý đúng envelope và schema.
- Bổ sung runtime validation tại ranh giới API khi cần.
- Hiển thị trạng thái loading, empty và error phù hợp.
- Ngăn request lỗi gây crash AIPanel.

**Acceptance:** Không còn lỗi `.map is not a function`; dữ liệu sai schema được xử lý an toàn và có thể chẩn đoán.

#### Task 4 — Sửa business logic lọc source file và target file

- Viết tài liệu ngắn mô tả quy tắc file được phép phân tích.
- Phân biệt source file, test file, generated file, dependency và file nội bộ.
- Kiểm tra canonical path và giới hạn trong project root.
- Xử lý extension, test naming convention và mapping source-to-test.
- Xác minh cách lọc file có coverage và file không có coverage.
- Không loại bỏ file chỉ vì heuristic tên file nếu không có căn cứ.
- Không đưa test file hoặc dependency vào danh sách source targets.
- Không dùng kết quả phân tích của snapshot cũ cho snapshot mới.

**Acceptance:** Unit tests bao phủ các nhóm file hợp lệ/không hợp lệ, và kết quả thực tế phù hợp với source tree của project test fixture.

#### Task 5 — Sửa AST/CFG analysis và xác định coverage gap

- Kiểm tra parser thực tế và ngôn ngữ được hỗ trợ.
- Xác minh function, branch, condition và error path được nhận diện đúng.
- Kiểm tra source location, function identity và branch identity.
- Phân biệt branch chưa được cover với branch không thể thực thi hoặc không được hỗ trợ.
- Không sinh gợi ý dựa trên dữ liệu AST/coverage không đồng nhất.
- Xử lý file parse lỗi mà không làm hỏng toàn bộ workspace.

**Acceptance:** Test fixture có nhánh đã biết và kết quả analysis khớp expected output.

#### Task 6 — Sửa Suggestion generation và normalization

- Kiểm tra prompt/context gửi AI.
- Kiểm tra output schema.
- Validate test framework, import path, symbol name và assertion.
- Loại bỏ suggestion trùng lặp.
- Không sinh test dựa trên function không tồn tại.
- Đảm bảo test phù hợp API/contract của source.
- Đánh dấu suggestion không hợp lệ với lý do rõ ràng.

**Acceptance:** Suggestion output có schema ổn định, ánh xạ được về source và có thể kiểm tra trước Apply.

#### Task 7 — Sửa Review & Apply

- Kiểm tra payload từ UI tới backend.
- Xác minh suggestion ID, source path, target test path và snapshot.
- Validate test code trước khi merge.
- Kiểm tra import, framework, duplicate test names và syntax.
- Xác định chiến lược merge với test file đã có.
- Không xóa hoặc ghi đè test cũ một cách âm thầm.
- Xử lý lỗi giữa lúc Apply và khôi phục trạng thái phù hợp.
- Trả về error code/message có thể chẩn đoán.
- Làm cho thao tác an toàn khi retry; tránh áp dụng cùng một suggestion hai lần.

**Acceptance:** Apply thành công trên fixture; Apply lỗi không làm hỏng test file; test hiện có vẫn được giữ nguyên.

#### Task 8 — Hoàn thiện test execution và coverage verification

- Chạy đúng test runner của project.
- Thu thập kết quả pass/fail và coverage.
- Gắn kết quả với đúng run, project, snapshot và source hash theo kiến trúc hiện có.
- Xử lý runner timeout, process error và malformed report.
- Không dùng coverage artifact cũ để báo kết quả mới.
- Xác minh coverage thực sự tăng sau khi Apply.

**Acceptance:** Hệ thống phân biệt rõ Apply thành công với test pass; coverage chỉ cập nhật từ run hợp lệ.

#### Task 9 — Frontend state và trải nghiệm lỗi

- Kiểm tra các stage AI Suggestion, Review & Apply, Merged và Continuous Loop.
- Đồng bộ loading/error/success state.
- Không cho phép Apply khi suggestion chưa hợp lệ hoặc dữ liệu đang stale.
- Ngăn request lặp không cần thiết.
- Tránh hiển thị “Merged” khi backend chưa xác nhận.
- Cung cấp thông báo lỗi hữu ích và cho phép retry an toàn.

**Acceptance:** UI phản ánh trạng thái backend thật, không hiển thị success giả.

#### Task 10 — End-to-end regression và nghiệm thu

- Chạy từ lúc mở Unit Test Content đến lúc Suggest, Review, Apply, chạy test và thu coverage.
- Kiểm tra source file selection.
- Kiểm tra test file merge.
- Kiểm tra lỗi API và phục hồi sau lỗi.
- Chạy toàn bộ test suites bị ảnh hưởng.
- Build frontend/backend.
- Cập nhật tài liệu và kết quả nghiệm thu.

**Acceptance:** Toàn bộ luồng hoạt động với fixture có kết quả mong đợi và không làm regression chức năng hiện có.

---

### 6. Quy tắc dependency giữa task

Không triển khai Apply bằng dữ liệu chưa được chuẩn hóa.

Thứ tự ưu tiên mặc định:

```text
T1 Baseline / Reproduction
        ↓
T2 Coverage API contract ── T3 Frontend response handling
        ↓
T4 Business file filtering
        ↓
T5 AST / CFG / Coverage gap analysis
        ↓
T6 Suggestion generation
        ↓
T7 Review & Apply
        ↓
T8 Test execution / Coverage verification
        ↓
T9 Frontend state integration
        ↓
T10 End-to-end acceptance
```

Có thể thực hiện song song các task độc lập sau khi đã xác định rõ interface. Không cho hai task sửa cùng một module đồng thời nếu chưa thống nhất trách nhiệm và tránh conflict.

Nếu phát hiện dependency khác với sơ đồ trên, hãy cập nhật dependency map dựa trên mã nguồn thực tế.

---

### 7. Chiến lược unit test bắt buộc

Viết test theo hành vi, không chỉ test gọi hàm.

#### Coverage API

- Project/snapshot hợp lệ.
- Project không tồn tại.
- Analysis chưa có.
- Không có discovered endpoints.
- Response có schema sai.
- Repository/DB phát sinh lỗi.
- Artifact không tồn tại hoặc bị hỏng.
- Path không hợp lệ.

#### Business file filtering

Tạo fixture chứa:

- Source file có function export.
- Source file không có test tương ứng.
- Unit test file.
- Integration test file.
- Generated/build file.
- Dependency trong `node_modules`.
- File nội bộ của CovAI.
- File ngoài project root.
- File có tên gần giống test naming convention.
- File có import/export nhiều tầng.
- File có coverage path khác source path.
- File parse lỗi.

Kiểm tra danh sách output và lý do include/exclude cho từng trường hợp.

#### Suggestion generation

- Function không có branch.
- Function có if/else.
- Nested conditions.
- Switch.
- Error handling.
- Boundary values.
- Function không export.
- Suggestion trùng lặp.
- AI trả JSON lỗi hoặc thiếu trường.
- AI trả import/symbol không tồn tại.

#### Review & Apply

- Apply một suggestion hợp lệ.
- Apply nhiều suggestion cùng file.
- File test đã tồn tại.
- Test name bị trùng.
- Import bị trùng.
- Syntax test code không hợp lệ.
- Source/snapshot đã thay đổi sau Suggest.
- Target path không hợp lệ.
- Ghi file thất bại.
- Retry cùng suggestion.
- Test runner thất bại sau Apply.

#### Coverage verification

- Coverage tăng thật.
- Coverage không đổi.
- Coverage giảm.
- Report lỗi.
- Report thiếu branch data.
- Report thuộc run khác.
- Source hash đã thay đổi.
- Hai run chạy song song.

Không mock phần logic đang được kiểm thử. Dùng mock ở ranh giới I/O khi phù hợp, và bổ sung integration tests cho DB, filesystem, test runner và API.

---

### 8. Điều kiện hoàn thành

Chỉ đánh dấu một task `DONE` khi:

- Đã sửa implementation.
- Có regression tests tương ứng.
- Tests đã được chạy thực tế.
- Không có assertion bị xóa hoặc nới lỏng để làm test pass.
- Không còn lỗi đã biết trong phạm vi task.
- Đã kiểm tra tác động tới task phụ thuộc.

Dùng các trạng thái:

- `TODO`
- `IN_PROGRESS`
- `BLOCKED`
- `DONE`
- `VERIFIED`

`DONE` nghĩa là đã triển khai; `VERIFIED` nghĩa là đã kiểm chứng bằng test và bằng chứng phù hợp.

Không đánh dấu toàn bộ dự án hoàn thành chỉ vì unit tests pass. Phải chạy end-to-end pipeline.

### 9. Báo cáo tiến độ và đầu ra cuối cùng

Tạo hoặc cập nhật tài liệu task trong thư mục docs phù hợp với quy ước hiện có của repository.

Báo cáo cần bao gồm:

1. Task breakdown và dependency.
2. Root cause từng lỗi.
3. Danh sách file đã sửa.
4. Các quyết định về business logic lọc file.
5. API contract trước và sau khi sửa.
6. Unit/integration/E2E tests đã thêm.
7. Command thực tế đã chạy và kết quả.
8. Build status.
9. Coverage trước và sau, nếu dữ liệu đo hợp lệ.
10. Các lỗi chưa giải quyết và lý do.
11. Hướng dẫn tái hiện và xác minh.

Không được tự điền số liệu coverage hoặc số lượng test nếu chưa chạy lệnh tương ứng.

### 10. Lệnh thực hiện ngay

Bắt đầu bằng việc khảo sát repository, tạo dependency map, tái hiện các lỗi và lập task list có acceptance criteria.

Sau đó **tiếp tục thực hiện task theo thứ tự ưu tiên**, không dừng lại sau khi xuất kế hoạch.

Nếu bị chặn bởi môi trường hoặc thiếu quyền truy cập, hãy hoàn thành phần có thể thực hiện, ghi rõ blocker và chỉ yêu cầu thông tin thực sự cần thiết.

Mục tiêu cuối cùng là hoàn thiện Unit Test Content để người dùng có thể chọn đúng source file, phân tích coverage gap, tạo suggestion, review/apply an toàn, chạy test và xác minh coverage bằng dữ liệu thực tế.