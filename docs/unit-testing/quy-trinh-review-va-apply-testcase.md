# PROMPT GEMINI — AUDIT & FIX COVAI TESTCASE REVIEW/APPLY PIPELINE

Bạn là Senior Software Engineer kiêm Software Architect, chuyên về Node.js, React, Jest/Vitest, Istanbul/nyc, AST, BullMQ, Docker sandbox, Prisma và hệ thống tự động sinh unit test.

## 1. Mục tiêu

Làm việc trực tiếp trên codebase hiện có của **CovAI** để:

1. Kiểm tra kiến trúc và implementation hiện tại.
2. Đối chiếu từng yêu cầu trong SOP **“Quy Trình Review & Apply Testcase Trong CovAI”** với code thực tế.
3. Xác định các lỗi, lỗ hổng an toàn, sai lệch logic và các trường hợp chưa được xử lý.
4. Sửa trực tiếp những vấn đề có mức độ ưu tiên **P0 và P1**.
5. Bổ sung hoặc cập nhật unit test, integration test và regression test phù hợp.
6. Chạy các kiểm tra có thể thực hiện được và xác minh kết quả sau khi sửa.
7. Báo cáo chính xác file đã thay đổi, nguyên nhân, giải pháp, kết quả test và các vấn đề còn tồn tại.

**Không chỉ phân tích hoặc đưa ra kế hoạch. Hãy thực hiện các thay đổi cần thiết trực tiếp trên codebase nếu môi trường cho phép.**

## 2. Nguyên tắc bắt buộc

### 2.1. Kiểm tra trước khi sửa

- Đọc cấu trúc repository, `package.json`, scripts, cấu hình test, cấu hình coverage và các service liên quan.
- Tìm implementation hiện có của từng chức năng trong SOP.
- Truy vết luồng dữ liệu từ UI → API/service → queue/worker → test runner → coverage artifact → database → UI.
- Kiểm tra các service, utility, schema và test hiện có trước khi tạo file mới.
- Ưu tiên mở rộng hoặc sửa implementation hiện tại; không tạo thêm service trùng chức năng.
- Không giả định rằng chức năng đã tồn tại chỉ vì SOP mô tả nó.
- Không viết lại toàn bộ pipeline nếu chỉ cần sửa một phần.
- Trước khi chỉnh sửa, kiểm tra `git status` và diff hiện có. Giữ nguyên mọi thay đổi chưa commit của người dùng; không reset, checkout đè, xóa hoặc ghi đè công việc có sẵn.

### 2.2. Bảo vệ source code

Thư mục `storage/` chứa source code dự án được import và phải được bảo vệ.

- Không sửa, format, rename, xóa hoặc ghi đè source code nghiệp vụ trong `storage/` khi review, apply test, sanitize test hoặc chạy coverage.
- Chỉ được thay đổi test files, cấu hình hoặc các file do CovAI quản lý khi thao tác đó được cho phép và có căn cứ rõ ràng.
- Không được xem mọi file trong `storage/` là file test chỉ vì tên hoặc nội dung có vẻ giống test.
- Xác minh canonical path sau khi resolve symlink; chặn path traversal, path tuyệt đối ngoài workspace và đường dẫn ghi vượt phạm vi cho phép.
- Nếu source code đã thay đổi kể từ lúc sinh suggestion, phải phát hiện xung đột bằng hash/version hoặc cơ chế tương đương. Không áp dụng âm thầm lên phiên bản khác.
- Nếu cần kiểm chứng tính bất biến, tạo test xác minh hash của các source files không đổi trước và sau thao tác.

Nếu implementation hiện tại không thể bảo đảm các quy tắc trên, ưu tiên sửa trước khi cho phép apply.

### 2.3. Không giả định thành công

- Không khẳng định coverage đạt 100% khi chưa chạy test và đọc artifact coverage thực tế.
- Không tuyên bố test đã pass nếu chưa có kết quả thực thi.
- Không đánh dấu suggestion là đã xác minh chỉ vì patch đã được ghi xuống file.
- Không bỏ qua test thất bại, lỗi import, lỗi cú pháp hoặc lỗi môi trường.
- Không làm suy yếu assertion, xóa test thất bại hoặc thay đổi source code nghiệp vụ để đạt coverage.
- Nếu thiếu dependency, môi trường Docker hoặc quyền thực thi, ghi rõ giới hạn và những kiểm tra chưa thể chạy.

---

## 3. Đối chiếu SOP với codebase

Kiểm tra tất cả các hạng mục dưới đây. Với mỗi hạng mục, xác định implementation thực tế, bằng chứng trong code và trạng thái.

### A. Project ingestion và bảo vệ workspace

- Xác minh cách import project từ ZIP hoặc Git repository.
- Xác minh nơi lưu source code, test files và generated artifacts.
- Kiểm tra quyền đọc/ghi, path traversal, symlink và cách xác định workspace root.
- Xác minh source code nghiệp vụ trong `storage/` không bị sửa bởi quá trình review/apply/sanitize.
- Kiểm tra cách phát hiện source files đã thay đổi kể từ lúc sinh test suggestion.

### B. Diff review UI

Kiểm tra `DiffReviewModal.jsx` hoặc component tương đương:

- Hiển thị diff trước khi apply.
- Review/apply/revert từng file.
- Bulk apply/revert.
- Trạng thái loading, lỗi, xung đột và kết quả.
- Tránh người dùng apply nhiều lần do double-click hoặc request trùng.
- Không báo thành công trước khi backend xác nhận.
- Nếu UI đang hiển thị diff cũ, phải phát hiện file đã thay đổi và yêu cầu refresh/review lại.

### C. Apply test suggestion service

Kiểm tra `applyTestSuggestion.service.js` hoặc service tương đương:

- Merge test code an toàn.
- Xử lý import/require, export, mock và thứ tự khởi tạo.
- Loại bỏ declaration hoặc import trùng mà không làm thay đổi semantics.
- Tránh append test trùng khi apply nhiều lần.
- Kiểm tra test file tồn tại và hợp lệ trước khi ghi.
- Kiểm tra atomicity của bulk apply, backup và rollback.
- Phân biệt trạng thái đã ghi file và trạng thái test đã được chạy xác minh.

**Yêu cầu quan trọng:**

- Không tự động bỏ `skip`, `only` hoặc các trạng thái tương tự của test cũ nếu chưa có sự cho phép rõ ràng.
- Nếu cần hỗ trợ unskip, hãy để thành thao tác riêng có opt-in, hiển thị rõ trong diff và có test kiểm chứng.
- Không làm mất các test hiện có.
- Không ghi đè thay đổi mới của người dùng.
- Không dùng regex đơn thuần để xử lý mọi tình huống import/export nếu AST hoặc parser phù hợp đã có trong dự án.

### D. Test sanitizer

Kiểm tra `testSanitizer.service.js` hoặc implementation tương đương:

- Syntax validation và parse lại sau khi sửa.
- Xử lý dấu ngoặc, string, template literal, regex literal và comments.
- Phát hiện self-assignment, temporal dead zone (TDZ), identifier chưa khai báo và import sai.
- Dọn token thừa mà không xóa nhầm mã hợp lệ.
- Xử lý async/await, mock, exception và assertion.
- Giới hạn số lần sửa để tránh vòng lặp không kết thúc.

Quy tắc:

- Ưu tiên AST/parser có sẵn trong repository.
- Không dùng scanner đơn giản hoặc regex để giả định có thể phân tích chính xác mọi JavaScript/TypeScript syntax.
- Chỉ tự động sửa lỗi có quy tắc rõ ràng và kiểm chứng được.
- Không thay đổi source code nghiệp vụ để làm test chạy được.
- Không tự ý xóa assertion, biến test thất bại thành test pass hoặc thay đổi ý nghĩa test.
- Lưu được thông tin về thay đổi do sanitizer thực hiện để phục vụ debug/review.
- Nếu không thể sửa an toàn, trả về lỗi có giải thích thay vì tiếp tục sửa đoán.

### E. Adaptive test generation loop

Kiểm tra vòng lặp sinh test theo coverage:

- Đọc coverage hiện tại làm baseline.
- Sinh test bổ sung dựa trên coverage gap thực tế.
- Chạy lại test sau mỗi pass.
- Đọc artifact coverage mới sau khi chạy thành công.
- Tính delta coverage giữa các pass.
- Dừng khi đạt mục tiêu, không còn tiến triển, hết số pass, hết thời gian hoặc vượt budget.
- Phân biệt code không thể cover, test chưa đủ tốt, test lỗi và lỗi môi trường.
- Không tiếp tục sinh cùng một test không tạo ra giá trị mới.

Không được giả định pass thứ hai hoặc thứ ba thành công chỉ vì đã đi hết vòng lặp. Mỗi pass phải dựa trên kết quả chạy thực tế.

### F. Coverage measurement

Kiểm tra cách dùng Istanbul/nyc hoặc coverage provider hiện có:

- Xác định đúng coverage artifact của lần chạy hiện tại.
- Xử lý `coverage-final.json` thiếu, rỗng, sai định dạng hoặc cũ.
- Phân biệt line, statement, function và branch coverage.
- Hiển thị cả covered/total và tỷ lệ phần trăm.
- Tính branch coverage theo các branch/arm thực tế, không chỉ theo số dòng.
- Xác minh mẫu số và cách xử lý file không có executable code.
- Không dùng coverage cache hoặc artifact từ job khác.
- Không cập nhật coverage thành 100% khi artifact thiếu hoặc không hợp lệ.

Phải kiểm tra đúng cách Istanbul biểu diễn các counter, map và branch metadata trong phiên bản dependency thực tế của dự án.

### G. BullMQ, worker và Docker sandbox

Kiểm tra pipeline chạy test:

- Job có trạng thái và kết quả rõ ràng.
- Có idempotency hoặc deduplication phù hợp.
- Retry có giới hạn, có phân biệt lỗi có thể retry và lỗi không thể retry.
- Có timeout và xử lý job bị treo.
- Có kiểm soát concurrency để các job không ghi đè hoặc đọc nhầm workspace/coverage của nhau.
- Có cô lập giữa project, workspace, job và snapshot.
- Không tin cậy artifact từ job cũ hoặc job khác.
- Docker sandbox được cấu hình phù hợp với mô hình đe dọa; kiểm tra quyền, mount, network, resource limit và timeout.
- Nếu một bulk operation thất bại giữa chừng, hệ thống phải có trạng thái rõ ràng và cơ chế khôi phục phù hợp.

Không tuyên bố Docker sandbox an toàn tuyệt đối chỉ vì test chạy trong container.

### H. Prisma, coverage persistence và cache

Kiểm tra `CoverageFile`, `CoverageSummary` hoặc schema/model tương ứng:

- Chỉ persist kết quả coverage sau khi test runner hoàn tất và artifact được xác minh.
- Liên kết kết quả với đúng project, job, snapshot hoặc version nếu hệ thống hỗ trợ.
- Không để job thất bại ghi đè kết quả coverage hợp lệ gần nhất bằng dữ liệu rỗng hoặc cũ.
- Xử lý lỗi database và tình huống retry.
- Xác minh thứ tự persist và cache invalidation.
- Chỉ invalidate cache sau khi dữ liệu mới được lưu thành công.
- Xem xét mọi cache liên quan tới file tree, coverage summary, test status và API response.

Không giả định transaction của database có thể rollback những thay đổi đã ghi trên filesystem.

### I. UI polling và trạng thái

Kiểm tra cách UI nhận kết quả từ backend:

- Queued, running, passed, failed, cancelled và timeout.
- Có loading/error/empty state.
- Polling dừng đúng lúc, xử lý component unmount và tránh request trùng.
- Không yêu cầu reload toàn trang nếu kiến trúc hiện tại cho phép cập nhật trạng thái tại chỗ.
- UI hiển thị đúng coverage của lần chạy mới nhất đã xác minh.
- Không hiển thị trạng thái verified khi test chưa chạy xong.
- Thông báo lỗi đủ thông tin để debug, nhưng không làm lộ secrets hoặc thông tin nhạy cảm.

### J. Trạng thái workflow

Nếu implementation hiện tại đang gộp mọi thứ vào một trạng thái, hãy tách hoặc chuẩn hóa trạng thái tương ứng với kiến trúc hiện có:

- `SUGGESTED`: đã sinh suggestion.
- `REVIEWED`: đã được người dùng review.
- `APPLIED`: patch đã được ghi thành công.
- `QUEUED` / `RUNNING`: đang chờ hoặc thực thi test.
- `VERIFIED`: test đã chạy và kết quả đã được kiểm chứng.
- `FAILED`: thao tác hoặc test thất bại.
- `NEEDS_REVIEW`: có xung đột hoặc thay đổi cần người dùng quyết định.

Không nhất thiết phải dùng nguyên văn các enum trên nếu dự án đã có state machine phù hợp. Hãy tránh tạo nhiều trạng thái trùng nghĩa hoặc phá vỡ API/DB tương thích ngược.

---

## 4. Phân loại và thứ tự sửa lỗi

### P0 — Bắt buộc xử lý trước

Ưu tiên các vấn đề có thể gây mất dữ liệu, sửa nhầm source code hoặc báo cáo sai:

1. Có thể ghi hoặc sửa source code nghiệp vụ trong `storage/`.
2. Có thể path traversal hoặc ghi file ra ngoài workspace.
3. Có thể mất dữ liệu khi apply/revert hoặc bulk apply thất bại giữa chừng.
4. Có thể ghi đè thay đổi của người dùng mà không phát hiện xung đột.
5. Có thể làm mất test cũ, tự động unskip hoặc làm yếu assertion ngoài ý muốn.
6. Có thể công bố coverage sai do dùng artifact cũ, artifact rỗng hoặc kết quả từ job khác.
7. Có thể đánh dấu verified khi test chưa thực sự chạy thành công.
8. Có lỗi nghiêm trọng về isolation giữa project/job hoặc thực thi test không đáng tin cậy.

Nếu phát hiện P0, hãy sửa trước khi tiếp tục những thay đổi ít rủi ro hơn.

### P1 — Độ tin cậy và tính đúng đắn

Sau P0, xử lý:

1. Merge import/export không an toàn.
2. Sanitizer làm biến đổi code không xác định hoặc không parse lại sau sửa.
3. Adaptive loop không chạy lại test, không đọc coverage mới hoặc không có stop condition.
4. Coverage calculation sai.
5. BullMQ retry, timeout, deduplication hoặc concurrency có vấn đề.
6. DB persistence và cache invalidation sai thứ tự.
7. UI polling hoặc workflow state không nhất quán.
8. Thiếu validation gate trước khi apply hoặc sau khi apply.
9. Thiếu regression test cho các lỗi trên.

**Không cố sửa mọi vấn đề trong một patch lớn.** Chia thành các thay đổi nhỏ, có thể review và kiểm chứng độc lập. Nếu một thay đổi có nguy cơ phá vỡ tương thích, hãy ghi rõ và chọn cách sửa ít rủi ro nhất.

---

## 5. Test phải bổ sung hoặc cập nhật

Trước khi tạo test mới, tìm test hiện có để tránh trùng lặp. Dùng framework và conventions của repository.

Bổ sung test tương ứng với các rủi ro thực tế, ưu tiên các trường hợp sau:

### File safety và apply/revert

- Source file hash không đổi sau review/apply/sanitize.
- Path traversal và đường dẫn ngoài workspace bị từ chối.
- Apply test hợp lệ thành công.
- Apply trùng lặp không tạo test trùng.
- File thay đổi sau khi sinh suggestion dẫn tới conflict.
- Bulk apply thất bại giữa chừng có rollback/partial-state behavior đúng như thiết kế.
- Revert không xóa các thay đổi người dùng thực hiện sau khi apply.

### Sanitizer và merge

- Syntax hợp lệ có string/template/regex/comments.
- Syntax lỗi được phát hiện chính xác.
- Không xóa assertion hoặc thay đổi ý nghĩa test.
- Import/require không bị trùng một cách gây sai semantics.
- Self-assignment/TDZ chỉ được xử lý khi quy tắc sửa an toàn đã được xác định.
- Sanitizer không chạy vô hạn và trả lỗi rõ ràng khi không thể sửa.

### Adaptive coverage loop

- Đạt target thực tế thì dừng.
- Coverage chưa đạt thì tiếp tục trong giới hạn.
- Không tiến triển thì dừng.
- Hết max passes, timeout hoặc budget thì dừng.
- Artifact rỗng, thiếu hoặc lỗi không bị hiểu là 100%.
- Không dùng coverage artifact từ job trước.

### Queue, persistence và UI

- Job retry không ghi đè kết quả mới hơn bằng kết quả cũ.
- Job trùng không tạo tác dụng phụ ngoài ý muốn.
- Timeout/cancel/failure được phản ánh đúng.
- DB lỗi không làm UI hiển thị verified sai.
- Cache chỉ được invalidate đúng thời điểm.
- UI polling dừng và hiển thị lỗi đúng.

Chỉ triển khai những test phù hợp với implementation và kiến trúc thực tế. Không viết test giả chỉ để làm cho báo cáo trông đầy đủ.

---

## 6. Validation gate

Kiểm tra và bổ sung gate ở các điểm phù hợp.

### Trước khi apply

- Test patch có thể parse/compile.
- File đích nằm trong phạm vi cho phép.
- Import/export path có thể xác minh.
- Không có thay đổi source code nghiệp vụ.
- Không có thay đổi test ngoài dự kiến.
- Assertion có ý nghĩa; không tự động bỏ assertion chỉ để test pass.
- Phát hiện duplicate hoặc conflict.
- Có diff để người dùng review.

### Sau khi apply

- Chạy test trong runner/sandbox đã cấu hình.
- Kiểm tra lỗi syntax, import, timeout và regression.
- Đọc coverage artifact mới của đúng job.
- Kiểm tra các metric và mẫu số.
- Persist kết quả đã xác minh.
- Cập nhật cache/UI theo đúng thứ tự.
- Nếu thất bại, giữ trạng thái thất bại và cung cấp thông tin debug; không giả vờ rằng thao tác thành công.

Không tự động apply các thay đổi nguy hiểm hoặc mơ hồ nếu cần người dùng phê duyệt.

---

## 7. Quy trình làm việc bắt buộc

Thực hiện theo thứ tự:

**Bước 1 — Khảo sát**

- Đọc cấu trúc repository và trạng thái Git.
- Xác định stack, test framework, coverage provider, queue, DB và các entry point.
- Tìm tất cả file liên quan đến SOP.
- Xác định cách chạy test và các dependency cần thiết.

**Bước 2 — Audit SOP**

Lập bảng đối chiếu với các cột:

| SOP item | File/function thực tế | Trạng thái | Bằng chứng | Mức độ | Hành động |
|---|---|---|---|---|---|

Dùng các trạng thái:
- `IMPLEMENTED`: đã triển khai và có bằng chứng.
- `PARTIAL`: có triển khai nhưng còn thiếu hoặc có rủi ro.
- `MISSING`: chưa có.
- `BUG`: có triển khai nhưng logic sai.
- `NOT_VERIFIED`: chưa đủ bằng chứng để kết luận.

Không đánh dấu `IMPLEMENTED` chỉ vì có file hoặc hàm mang tên tương tự.

**Bước 3 — Chọn phạm vi**

- Xếp hạng phát hiện theo P0/P1/P2.
- Ưu tiên sửa P0 trước, sau đó P1.
- Nêu ngắn gọn phạm vi sẽ sửa và các thay đổi có rủi ro tương thích.

**Bước 4 — Sửa code trực tiếp**

- Chỉnh sửa implementation hiện có.
- Tạo hoặc cập nhật test.
- Không tạo service trùng chức năng.
- Không sửa source code nghiệp vụ trong `storage/`.
- Không xóa hoặc ghi đè thay đổi có sẵn của người dùng.
- Giữ patch tập trung, có thể review.

**Bước 5 — Chạy validation**

Chạy các lệnh phù hợp với repository thực tế, ví dụ:

- Unit tests của các service bị ảnh hưởng.
- Integration tests của apply/queue/coverage nếu có.
- Regression tests.
- Lint và typecheck nếu dự án cấu hình.
- Coverage tests hoặc một lần chạy pipeline trong môi trường có thể thực thi.

Không đoán tên script. Hãy đọc `package.json` và cấu hình trước khi chạy.

Nếu test thất bại:
- Xác định lỗi do thay đổi mới, lỗi có sẵn hay môi trường.
- Sửa lỗi liên quan trong phạm vi an toàn.
- Chạy lại test liên quan.
- Ghi rõ những test chưa thể chạy và lý do.

**Bước 6 — Kiểm tra diff cuối**

- Kiểm tra `git diff` và danh sách file thay đổi.
- Xác nhận không sửa source code nghiệp vụ trong `storage/`.
- Xác nhận không làm mất thay đổi có sẵn.
- Kiểm tra các test mới thực sự có assertion và có thể phát hiện lỗi.
- Kiểm tra không có secret, token hoặc dữ liệu nhạy cảm trong diff/log.
- Không tự commit hoặc push trừ khi được yêu cầu riêng.

**Bước 7 — Báo cáo**

Xuất báo cáo theo định dạng ở mục 8.

---

## 8. Định dạng báo cáo cuối cùng

### A. Tóm tắt

- Số hạng mục SOP đã kiểm tra.
- Số `IMPLEMENTED`, `PARTIAL`, `MISSING`, `BUG`, `NOT_VERIFIED`.
- Số lỗi P0/P1/P2 phát hiện.
- Số lỗi đã sửa và còn tồn tại.
- Kết luận ngắn gọn về độ tin cậy hiện tại của pipeline.

### B. Audit SOP

Cung cấp bảng đối chiếu đầy đủ. Mỗi kết luận quan trọng phải dẫn ra file, hàm hoặc test làm bằng chứng.

### C. File đã thay đổi

Với mỗi file, báo cáo:

- Đường dẫn file.
- Loại thay đổi: `MODIFIED`, `ADDED` hoặc `DELETED`.
- Lỗi hoặc yêu cầu được xử lý.
- Thay đổi kỹ thuật cụ thể.
- Test nào kiểm chứng thay đổi đó.

Phân biệt file production code, test file, migration và configuration. Không nói đã sửa file nếu thực tế không có thay đổi.

### D. Test và kết quả xác minh

| Kiểm tra | Lệnh thực tế | Kết quả | Ghi chú |
|---|---|---|---|

Phân biệt rõ:
- Passed.
- Failed.
- Skipped.
- Blocked/not run.

Nếu có coverage, báo cáo số liệu từ lần chạy đã xác minh và chỉ rõ artifact/snapshot tương ứng khi có thể. Không tự khẳng định 100%.

### E. Vấn đề còn tồn tại

Với mỗi vấn đề:

- Mức độ.
- Tác động.
- File/vị trí liên quan.
- Lý do chưa sửa.
- Bước tiếp theo được đề xuất.

### F. Checklist an toàn

- [ ] Source code nghiệp vụ trong `storage/` không bị sửa.
- [ ] Không ghi đè thay đổi có sẵn của người dùng.
- [ ] Không tự động unskip test hoặc làm yếu assertion ngoài ý muốn.
- [ ] Apply/revert và xử lý lỗi có hành vi được kiểm chứng.
- [ ] Coverage chỉ được công bố từ artifact hợp lệ của đúng lần chạy.
- [ ] Trạng thái `APPLIED` và `VERIFIED` không bị đánh đồng.
- [ ] Test liên quan đã chạy hoặc có lý do rõ ràng cho việc chưa chạy.
- [ ] Diff cuối đã được kiểm tra.

Chỉ đánh dấu các ô đã được xác minh thực tế.

## 9. Điều kiện hoàn thành

Công việc được coi là hoàn thành khi:

1. Đã khảo sát codebase và đối chiếu SOP với implementation thực tế.
2. Đã sửa các lỗi P0 có thể xử lý an toàn.
3. Đã sửa các lỗi P1 trong phạm vi hợp lý.
4. Đã bổ sung hoặc cập nhật regression tests cho các thay đổi quan trọng.
5. Đã chạy và báo cáo kết quả validation thực tế.
6. Đã kiểm tra diff và xác minh source code nghiệp vụ trong `storage/` không bị sửa.
7. Đã báo cáo chính xác những gì hoàn thành và những gì còn thiếu.

Nếu không thể xử lý hết P0/P1 trong một lượt, hãy hoàn thành các thay đổi an toàn có thể kiểm chứng, sau đó liệt kê phần chưa xử lý cùng lý do. Không được che giấu vấn đề hoặc tuyên bố hoàn thành khi chưa đủ bằng chứng.

**Bắt đầu bằng việc khảo sát repository và trạng thái Git. Sau đó thực hiện audit, sửa trực tiếp, bổ sung test, chạy validation và xuất báo cáo. Không dừng lại ở việc đưa ra kế hoạch.**