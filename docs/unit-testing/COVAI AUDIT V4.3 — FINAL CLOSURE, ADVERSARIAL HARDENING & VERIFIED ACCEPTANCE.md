# COVAI AUDIT V4.3 — FINAL CLOSURE, ADVERSARIAL HARDENING & VERIFIED ACCEPTANCE

## 1. VAI TRÒ VÀ MỤC TIÊU

Bạn là Senior Software Engineer, Application Security Engineer và Reliability Engineer chịu trách nhiệm hoàn tất kiểm toán hệ thống CovAI sau Audit V4.2.

Audit V4.2 báo cáo đã sửa 8/8 findings, 118 tests passed và client production build thành công. Tuy nhiên, các kết quả này phải được xác minh trực tiếp từ repository và môi trường thực thi, không được mặc định là đúng chỉ vì có trong báo cáo.

**Mục tiêu duy nhất: hoàn thành các phần kiểm toán còn thiếu, sửa các lỗi thực tế được xác nhận, chạy kiểm thử hồi quy và tạo bộ bằng chứng nghiệm thu cuối cùng có thể kiểm tra lại.**

Không dừng ở việc lập kế hoạch, đề xuất lý thuyết hoặc viết báo cáo. Hãy thực sự đọc code, sửa code khi cần, thêm test, chạy lệnh kiểm chứng và kiểm tra hậu điều kiện. Nếu môi trường không cho phép thực hiện một bước, hãy ghi rõ giới hạn, không giả lập kết quả.

Repository hiện có của CovAI là nguồn sự thật duy nhất. Không tự tạo nội dung source, test log, commit, hash hoặc kết quả thực thi để làm đẹp báo cáo.

## 2. QUY TẮC KHÔNG ĐƯỢC VI PHẠM

1. Không sửa, xóa, di chuyển hoặc định dạng lại mã nguồn dự án người dùng trong `server/storage/projects/`.
2. Không sửa test để che lỗi, không bỏ qua test, không giảm assertion, không nới lỏng điều kiện bảo mật để khiến test pass.
3. Không đánh dấu finding FIXED nếu chưa có bằng chứng từ source code sau sửa và test tương ứng.
4. Không tuyên bố đã chạy lệnh nếu chưa thực sự chạy và thu được exit code.
5. Không xóa journal, backup hoặc bản quarantine khi trạng thái giao dịch chưa được xác minh an toàn.
6. Không rollback hoặc roll-forward dựa trên trạng thái DB không xác định.
7. Không thay đổi Git commit SHA thật để lưu transaction ID.
8. Không thay đổi schema hoặc migration nếu chưa chứng minh cần thiết, kiểm tra toàn bộ call site và đánh giá khả năng tương thích dữ liệu cũ.
9. Không thực hiện destructive test trên project người dùng. Mọi fault injection phải chạy trong sandbox hoặc fixture riêng biệt.
10. Không refactor diện rộng. Ưu tiên bản sửa nhỏ, có mục tiêu, có test hồi quy.
11. Không coi mutex trong process, PID hoặc hostname là distributed lock có fencing đầy đủ.
12. Nếu phát hiện lỗi ngoài phạm vi ban đầu có ảnh hưởng nghiêm trọng đến tính toàn vẹn dữ liệu, hãy mở finding mới và xử lý trước khi nghiệm thu.

## 3. GIAI ĐOẠN 1 — KIỂM TRA TRẠNG THÁI REPOSITORY THỰC TẾ

Trước khi chỉnh sửa:

- Xác định repository root, cấu trúc backend/frontend, package manager, Docker Compose hoặc cấu hình container đang sử dụng.
- Kiểm tra Git status và diff hiện tại để phân biệt thay đổi có sẵn của người dùng với thay đổi do audit tạo ra.
- Đọc `package.json`, lockfile, cấu hình test, cấu hình Docker và Prisma schema có liên quan.
- Kiểm tra source code thực tế của:
  - `server/src/services/durableJournal.service.js`
  - `server/src/services/applyTestSuggestion.service.js`
  - `server/src/services/vitestRunner.service.js`
  - `server/src/services/runTestsJob.service.js`
  - Các runner Jest, parser coverage, cache invalidation và các service gọi tới chúng.
  - Prisma models và toàn bộ call site sử dụng `ProjectSnapshot.commitSha`, `testingFrameworksJson` và `lastAppliedTxId`.
  - Các suite audit, unit test, security test và integration test hiện có.
- Tìm mọi nơi gọi các hàm `initDurableTransaction`, `stageDurableFile`, `commitDurableTransaction`, `finalizeDurableTransaction`, `rollbackDurableTransaction`, `recoverPendingApplyTransactions` và `cleanupDurableTransaction`.
- Xác định trạng thái thực tế của 8 finding V4.2: FIXED, PARTIALLY FIXED, NOT FIXED hoặc NOT VERIFIABLE.

Tạo baseline trước khi thay đổi:

- Git diff hiện tại.
- Danh sách file sẽ chỉnh sửa.
- SHA-256 manifest của `server/storage/projects/`, bao gồm đường dẫn tương đối và hash từng file.
- Số lượng file, file không đọc được và các trường hợp symlink nếu có.
- Kết quả test baseline nếu môi trường cho phép.

Không ghi đè hoặc tự động reset các thay đổi người dùng chưa commit.

## 4. P0 — SYMLINK, PATH CONTAINMENT VÀ TOCTOU

Kiểm tra các đường dẫn do request, job hoặc service cung cấp, đặc biệt `options.coverageDir`, file đầu ra, file nguồn, backup và journal.

### 4.1. Path containment

Xác minh rằng:

- Tất cả đường dẫn được resolve từ root được tin cậy.
- Đường dẫn tuyệt đối không được chấp nhận nếu API chỉ cho phép đường dẫn tương đối.
- Không chấp nhận đường dẫn vượt ra ngoài thư mục được phép.
- Kiểm tra path separator trên Windows và POSIX.
- Không dựa vào `startsWith(rootDir)` để xác nhận containment vì có thể nhầm các thư mục có chung prefix.
- Không chỉ kiểm tra lexical path bằng `path.resolve()` rồi mặc định đường dẫn filesystem thực cũng an toàn.

### 4.2. Symlink và TOCTOU

Bổ sung kiểm thử cho:

- Symlink nằm bên trong project nhưng trỏ ra ngoài project.
- Symlink trung gian trong chuỗi thư mục.
- Symlink trỏ tới file nguồn hoặc backup.
- Symlink được thay thế sau bước validate nhưng trước bước ghi.
- Đường dẫn cha bị đổi trong lúc job đang chạy.
- Đường dẫn coverage đã tồn tại nhưng là file thường, symlink hoặc loại filesystem không mong đợi.
- Hai job cùng tác động đến đường dẫn được kiểm tra.

Thiết kế biện pháp chống race phù hợp với nền tảng thực tế. Ưu tiên thao tác filesystem có bảo đảm an toàn tại thời điểm mở/ghi file, giới hạn quyền truy cập, kiểm tra đối tượng thực tế và ngăn việc thay thế đường dẫn trung gian.

`realpath()` hoặc `lstat()` riêng lẻ không đủ để tuyên bố đã loại bỏ TOCTOU nếu filesystem có thể bị thay đổi sau khi kiểm tra.

Nếu Node.js và nền tảng hiện tại không hỗ trợ bảo đảm chống race tuyệt đối bằng API đang dùng, hãy nêu rõ giới hạn, thu hẹp bề mặt tấn công và không tuyên bố bảo đảm mạnh hơn thực tế.

### 4.3. Test bắt buộc

Thêm hoặc mở rộng test:

- A13: Symlink escape qua coverage directory.
- A14: Symlink escape qua thư mục backup hoặc journal.
- A15: Thay đổi symlink sau bước validation.
- A16: Path traversal qua đường dẫn có dấu phân cách khác hệ điều hành.
- A17: Không được ghi file ngoài vùng cho phép khi validation thất bại.

Hậu điều kiện: không có file ngoài sandbox bị tạo, sửa hoặc xóa; job thất bại rõ ràng; journal và backup không bị hỏng.

## 5. P0 — DURABLE JOURNAL VÀ KHẢ NĂNG PHỤC HỒI SAU CRASH

Đọc toàn bộ state machine và đối chiếu trạng thái trong manifest với trạng thái filesystem và database.

### 5.1. Kiểm tra state machine

Xác minh các trạng thái hiện có, bao gồm nhưng không giới hạn:

`INITIALIZING → STAGING → COMMITTING → VERIFYING → COMMITTED → CLEANED_UP`

và các trạng thái rollback/recovery nếu được triển khai.

Với mỗi transition, ghi rõ:

- Điều kiện cho phép chuyển trạng thái.
- Dữ liệu đã được ghi bền vững tại thời điểm đó.
- File backup còn tồn tại hay không.
- DB đã commit hay chưa.
- Hành vi khi tiến trình bị kill ngay trước hoặc sau transition.
- Khả năng chạy recovery lại sau khi recovery trước đó bị gián đoạn.

Không ép state machine vào đúng tên gọi trên nếu source hiện tại có thiết kế khác. Hãy chứng minh invariant của state machine thực tế.

### 5.2. Atomic manifest write

Kiểm tra `atomicWriteJsonSync` và các helper liên quan:

- Ghi file tạm đầy đủ.
- Xử lý short write và lỗi ghi.
- `fsync` file theo khả năng nền tảng.
- Đóng file descriptor đúng cách.
- Rename manifest nguyên tử theo filesystem đang sử dụng.
- Đồng bộ thư mục cha khi nền tảng hỗ trợ.
- Xử lý lỗi rename trên Windows mà không xóa bản manifest cuối cùng trước khi có bản thay thế an toàn.
- Không nuốt lỗi `fsync`, rename hoặc đồng bộ thư mục rồi trả về thành công.

Nếu cần fallback cho Windows, hãy thiết kế và test rõ các crash window. Không coi cơ chế unlink rồi rename là an toàn chỉ vì có file tạm.

### 5.3. Recovery từ temporary manifest

Bổ sung A18:

- Manifest chính không tồn tại.
- Chỉ có một temporary manifest hợp lệ.
- Có nhiều temporary manifest hợp lệ với `txId` khác nhau.
- Temporary manifest bị cắt cụt hoặc JSON lỗi.
- Temporary manifest có checksum hoặc trạng thái không hợp lệ.
- Manifest chính hợp lệ nhưng file tạm cũ còn tồn tại.
- Process chết trong khi đang phục hồi manifest tạm.

Quy tắc bắt buộc:

- Chỉ phục hồi từ candidate được xác minh đầy đủ.
- Không chọn tùy tiện file đầu tiên hoặc file mới nhất.
- Không tự suy diễn trạng thái commit từ timestamp.
- Nếu có nhiều candidate mâu thuẫn, giữ nguyên chứng cứ, không xóa backup và chặn Apply mới cho đến khi có thể phục hồi an toàn.
- Xác minh `txId`, trạng thái, danh sách file, checksum và quan hệ với backup trước khi dùng candidate.
- Không tạo ra manifest hợp lệ giả bằng cách chỉ parse được JSON.

### 5.4. Backup integrity và rollback

Bổ sung A19:

- Backup bị thiếu.
- Backup checksum sai.
- Backup bị thay thế bằng symlink.
- File đích đã được sửa bởi tác nhân khác sau khi transaction bắt đầu.
- Rollback thành công một phần rồi gặp lỗi.
- `fsync` hoặc rename thất bại trong rollback.
- Process bị kill giữa hai file phục hồi.
- Cleanup được gọi nhiều lần.
- Journal bị thiếu nhưng backup vẫn còn.

Đối với mỗi file, xác minh checksum backup trước khi ghi đè. Sau phục hồi, xác minh checksum của file đích so với trạng thái gốc đã lưu trong manifest.

Nếu backup hỏng hoặc không đủ dữ liệu phục hồi:

- Không ghi đè file nguồn bằng dữ liệu không xác minh.
- Không tuyên bố rollback thành công.
- Không xóa bản backup cuối cùng.
- Giữ nguyên journal và báo lỗi rõ ràng.
- Chặn transaction mới có khả năng ghi đè lên vùng dữ liệu đang cần recovery.

Nếu file đích đã bị bên ngoài thay đổi, không âm thầm ghi đè mà không kiểm tra precondition hoặc áp dụng chính sách recovery đã được định nghĩa rõ.

## 6. P0 — DATABASE / FILESYSTEM CONSISTENCY

### 6.1. Bảo toàn Git SHA

Xác minh:

- `ProjectSnapshot.commitSha` vẫn lưu Git commit SHA thật.
- Không có code nào ghi `appliedTx:<txId>` vào trường Git SHA.
- Các webhook, Git service, controller, API và UI vẫn hiểu đúng trường này.
- `testingFrameworksJson.lastAppliedTxId` được đọc/ghi an toàn nếu đó là nơi lưu transaction identity hiện tại.
- Các cập nhật metadata không ghi đè dữ liệu framework khác.
- Tương thích với dữ liệu cũ và dữ liệu JSON không hợp lệ.

Không tự ý thay đổi schema DB nếu metadata hiện tại có thể đáp ứng yêu cầu một cách an toàn.

### 6.2. Xác minh trạng thái DB trong recovery

Kiểm tra luồng thực tế sau `prisma.$transaction()` và `finalizeDurableTransaction()`.

Bổ sung A20:

1. DB commit thành công, process chết trước finalize.
2. DB transaction rollback, process chết trước filesystem rollback.
3. DB không truy cập được khi recovery.
4. DB trả về timeout trong khi transaction commit có thể đã thành công.
5. `lastAppliedTxId` không khớp.
6. `lastAppliedTxId` khớp nhưng metadata hoặc snapshot liên quan không còn nhất quán.
7. Hai transaction cạnh tranh cập nhật cùng snapshot.
8. DB đã commit nhưng cleanup hoặc cache invalidation thất bại.
9. Transaction cũ được recovery sau khi một transaction mới đã được thực hiện.
10. Database connection phục hồi sau nhiều lần recovery thất bại.

Yêu cầu:

- Không coi lỗi kết nối DB là bằng chứng transaction chưa commit.
- Không suy luận `isDbCommitted = false` chỉ vì truy vấn DB thất bại.
- Nếu trạng thái DB không xác định, giữ nguyên journal/backup và fail-closed.
- Xác minh đúng project, snapshot, transaction ID và trạng thái DB.
- Không cho phép transaction mới phá hủy dữ liệu mà recovery cũ vẫn cần.
- Roll-forward chỉ khi có bằng chứng DB đủ tin cậy rằng chính transaction đó đã commit.
- Rollback chỉ khi có thể chứng minh transaction chưa commit và có đủ backup hợp lệ.
- Xem xét optimistic concurrency/version checks hoặc cơ chế tương đương nếu nhiều cập nhật có thể cạnh tranh.
- Không giả định một marker metadata duy nhất là đủ nếu nó có thể bị transaction khác ghi đè.

Nếu kiến trúc hiện tại không thể phân biệt an toàn các trường hợp trên, hãy sửa bằng thay đổi tối thiểu nhưng đúng về mặt consistency; nếu cần schema hoặc migration, giải thích rõ và kiểm tra khả năng tương thích.

### 6.3. Giới hạn của mô hình giao dịch

Không gọi quy trình này là distributed two-phase commit theo nghĩa đầy đủ nếu hệ thống không có protocol phối hợp transaction giữa DB và filesystem.

Hãy mô tả chính xác đây là journaled filesystem transaction kết hợp DB commit marker và crash recovery, hoặc thuật ngữ tương đương phù hợp với implementation thực tế.

## 7. P0 — CONCURRENCY, LOCK OWNERSHIP VÀ STALE TRANSACTION

Kiểm tra việc sử dụng PID, hostname, lock file, manifest và các transaction đồng thời.

Bổ sung A21:

- Hai process cùng hostname và cùng PID được mô phỏng.
- Hai container khác hostname nhưng cùng PID.
- Process cũ chết nhưng journal còn lại.
- PID được tái sử dụng.
- Container được tạo lại với hostname mới.
- Hai Apply cùng workspace.
- Hai Apply khác workspace.
- Recovery chạy đồng thời với Apply.
- Hai worker cùng cố khởi tạo transaction.
- Lỗi xảy ra sau khi lock được tạo nhưng trước khi manifest hoàn tất.
- Process chết khi đang giải phóng lock.

Yêu cầu:

- Hostname/PID chỉ được dùng theo đúng ý nghĩa thực tế, không giả định chúng là fencing token toàn cục.
- Không để hai writer đồng thời sở hữu một journal hoặc cùng sửa một workspace.
- Lock phải có ownership rõ ràng và chỉ chủ sở hữu hợp lệ mới được giải phóng.
- Xử lý stale lock phải có kiểm chứng, không chỉ dựa vào PID chết.
- Không cho phép một process cũ tiếp tục ghi sau khi quyền sở hữu đã được chuyển giao.
- Kiểm tra tất cả transition liên quan đến lock có tính nguyên tử phù hợp.

Nếu deployment là single-active-instance, ghi rõ điều kiện triển khai đó và cách bảo vệ khi vi phạm điều kiện. Nếu cần multi-active container trên shared storage, hãy thiết kế yêu cầu distributed lock/fencing phù hợp; không triển khai Redis Redlock hoặc cơ chế distributed lock mới một cách máy móc khi chưa đánh giá failure model.

## 8. P1 — COVERAGE PROVENANCE VÀ CÔ LẬP TEST RUN

Kiểm tra toàn bộ luồng:

`Create run → Resolve root → Run Jest/Vitest → Generate artifacts → Parse artifacts → Calculate metrics → Persist results`

Mỗi run phải có thư mục riêng, và các artifact phải gắn đúng với:

- `projectId`
- `runId`
- `snapshotId` nếu hệ thống sử dụng snapshot
- Source hash hoặc revision tương ứng
- Runner và cấu hình chạy
- Thời gian bắt đầu/kết thúc
- Trạng thái hoàn tất/thất bại
- Đường dẫn artifact được phép đọc

Bổ sung A22:

- Hai Jest run đồng thời.
- Hai Vitest run đồng thời.
- Jest và Vitest chạy đồng thời.
- Runner lỗi giữa chừng nhưng để lại artifact cũ.
- Parser nhận `runId` không khớp.
- Parser nhận coverage artifact từ source revision khác.
- Thiếu artifact.
- Artifact JSON bị hỏng.
- Artifact nằm ngoài run directory.
- Job retry nhưng tái sử dụng artifact của lần chạy trước.
- Runner trả exit code thất bại nhưng parser vẫn tìm thấy coverage cũ.

Yêu cầu:

- Không fallback âm thầm sang thư mục `coverage/` dùng chung.
- Không sử dụng artifact cũ khi run hiện tại thất bại hoặc chưa hoàn tất.
- Không gắn coverage của snapshot này vào snapshot khác.
- Không coi số liệu coverage hợp lệ chỉ vì JSON parse thành công.
- Phân biệt rõ lỗi test runner, lỗi parser, coverage bằng 0 và artifact không tồn tại.
- Chỉ persist kết quả khi provenance đã được xác minh.

## 9. P1 — QUARANTINE, CLEANUP VÀ CACHE INVALIDATION

Kiểm tra các hàm quarantine, cleanup journal, xóa backup và invalidate cache.

Bổ sung A23:

- Quarantine rename thất bại.
- Copy fallback thất bại giữa chừng.
- Tên quarantine bị trùng.
- Disk full.
- `fsync` thất bại.
- Cleanup được gọi hai lần.
- Cleanup lỗi sau DB commit.
- Cache invalidation lỗi sau khi DB và filesystem đã commit.
- Process chết giữa finalize và cleanup.
- Manifest lỗi nhưng backup còn tồn tại.

Yêu cầu:

- Không dùng `catch {}` để che lỗi có ý nghĩa với tính toàn vẹn dữ liệu.
- Chỉ được bỏ qua lỗi khi có lý do rõ ràng, trạng thái an toàn được bảo toàn và lỗi vẫn có thể được chẩn đoán.
- Cleanup phải idempotent.
- Không xóa backup cuối cùng trước khi xác minh transaction đã kết thúc an toàn.
- Không báo rollback thất bại thành thành công hoặc commit thất bại thành chưa commit nếu trạng thái chưa xác định.
- Tách trạng thái transaction khỏi trạng thái cache; cache invalidation thất bại không được làm sai lệch sự thật DB/filesystem.
- Nếu cleanup thất bại sau commit, cần có cơ chế retry/reconciliation mà không rollback nhầm giao dịch đã commit.

## 10. P1 — STORAGE IMMUTABILITY

Lặp lại kiểm định SHA-256 trước và sau toàn bộ test.

Phạm vi bắt buộc: `server/storage/projects/`.

Ghi nhận:

- Master hash baseline.
- Master hash sau audit.
- Tổng số file.
- File thêm, xóa, sửa đổi.
- File không đọc được.
- Symlink hoặc file đặc biệt trong phạm vi nếu có.
- Lệnh/script đã dùng để tạo manifest.
- Cách xử lý file thay đổi trong lúc đang tạo manifest.

Đảm bảo script hash không làm thay đổi nội dung project. Chạy test trong sandbox/fixture riêng. Không reset storage về baseline bằng cách ghi đè file người dùng.

Nếu hash thay đổi, xác định chính xác file nào thay đổi và nguyên nhân. Không tự động sửa lại để tạo kết quả hash giống nhau mà chưa hiểu nguyên nhân.

## 11. TEST STRATEGY — KHÔNG CHỈ DỰA VÀO HAPPY PATH

Đầu tiên, kiểm tra chất lượng các suite hiện có:

- `auditV4AdversarialVerification.test.js`
- `adversarialSecurityAndIntegrityAudit.test.js`
- `quantitativeDoDVerification.test.js`
- `projectRootResolver.test.js`
- `applyTestSuggestion.service.test.js`

Xác minh từng test có thực sự kiểm tra hành vi được mô tả không. Không chấp nhận test chỉ kiểm tra mock được gọi, không kiểm tra hậu điều kiện quan trọng, hoặc giả lập kết quả mong muốn mà không đi qua logic đang cần xác minh.

Bổ sung A13–A23 như các mục trên, có thể chia thành nhiều test case độc lập. Không ép phải dùng đúng mã A13–A23 nếu repository có quy ước đặt tên khác, nhưng phải có bảng ánh xạ rõ ràng.

Với từng test về durability/recovery, phải xác minh hậu điều kiện bằng dữ liệu thực:

- Nội dung file trước/sau.
- SHA-256 của file.
- Trạng thái manifest.
- Sự tồn tại và checksum của backup.
- Trạng thái DB hoặc kết quả query xác minh.
- Trạng thái lock.
- Artifact coverage đúng run.
- Khả năng recovery lần tiếp theo.

Fault injection phải mô phỏng đúng vị trí lỗi, không chỉ ném lỗi ở một vị trí không liên quan. Nếu không thể thực hiện `SIGKILL`, crash process hoặc filesystem fault thực sự, phải ghi rõ test đang mô phỏng ở mức nào.

Không dùng các test giả định có thể chứng minh những đặc tính mà môi trường test không thực sự kiểm tra được.

## 12. THỰC THI TRONG MÔI TRƯỜNG THỰC

Đọc script trong `package.json`, cấu hình Docker và lệnh test hiện có trước khi chạy.

Chạy các suite bắt buộc trong đúng môi trường của repository, ưu tiên Docker nếu dự án đang sử dụng Docker:

- `auditV4AdversarialVerification.test.js`
- `adversarialSecurityAndIntegrityAudit.test.js`
- `quantitativeDoDVerification.test.js`
- `projectRootResolver.test.js`
- `applyTestSuggestion.service.test.js`
- Tất cả test liên quan trực tiếp đến các file được sửa.
- Các test hồi quy phù hợp khác được phát hiện trong repository.
- Client production build.
- Lint/typecheck nếu dự án có cấu hình riêng.

Không sao chép nguyên xi một lệnh từ báo cáo cũ nếu script hoặc đường dẫn hiện tại khác. Kiểm tra lệnh thực tế và sử dụng đúng script của repository.

Với từng lệnh, lưu:

- Lệnh chính xác.
- Container hoặc môi trường thực thi.
- Exit code thực tế.
- Pass/fail/skipped.
- Thời gian thực thi nếu có.
- Log lỗi.
- Các hậu điều kiện quan trọng đã kiểm tra.

Nếu một lệnh thất bại:

1. Phân tích nguyên nhân.
2. Sửa code hoặc test nếu lỗi thuộc phạm vi và có đủ căn cứ.
3. Chạy lại test liên quan.
4. Chạy lại regression suite cần thiết.
5. Không xóa log thất bại ban đầu khỏi bằng chứng audit.

Không cộng tổng test từ nhiều suite rồi gọi là số test độc nhất nếu chưa xác minh sự trùng lặp.

## 13. THỨ TỰ THỰC HIỆN

Thực hiện tuần tự:

### Phase 1 — Baseline

- Đọc source.
- Kiểm tra Git status.
- Xác minh 8 finding V4.2.
- Chạy các test baseline phù hợp.
- Lưu SHA-256 baseline của storage.

### Phase 2 — Targeted fixes

- Sửa các finding còn tồn tại.
- Sửa các lỗi mới được xác nhận trong A13–A23.
- Thêm test regression trước hoặc đồng thời với bản sửa.
- Không chỉnh sửa file ngoài phạm vi nếu không cần thiết.

### Phase 3 — Adversarial verification

- Chạy test mới.
- Chạy test cũ liên quan.
- Kiểm tra hậu điều kiện.
- Thử recovery lặp lại.
- Xác minh lỗi cleanup không phá hủy dữ liệu.
- Xác minh lock và DB state sau các crash window.

### Phase 4 — Full regression

- Chạy toàn bộ suite bắt buộc.
- Chạy build, lint và typecheck nếu được cấu hình.
- Ghi log và exit code thật.
- Xác minh các test không bị skip hoặc disable ngoài chủ đích.

### Phase 5 — Storage integrity và final diff

- Tạo lại SHA-256 manifest của `server/storage/projects/`.
- So sánh baseline và post-audit.
- Kiểm tra Git diff cuối.
- Xác minh không vô tình chỉnh sửa project người dùng.
- Xác minh không để lại file test tạm, fixture, journal thử nghiệm hoặc dữ liệu sandbox ngoài dự kiến.
- Không xóa dữ liệu recovery thật đang cần giữ lại.

### Phase 6 — Acceptance

Chỉ đưa ra PASS khi toàn bộ tiêu chí nghiệm thu bắt buộc có bằng chứng.

Nếu còn một điều kiện P0 chưa xác minh hoặc chưa đạt, kết luận phải là `NOT ACCEPTED` hoặc `BLOCKED`, không được kết luận PASS vô điều kiện.

## 14. FINAL ACCEPTANCE CRITERIA

### A. Transaction consistency

- [ ] Không làm mất Git commit SHA thật.
- [ ] Recovery xác minh đúng transaction identity.
- [ ] DB unavailable dẫn đến fail-closed.
- [ ] Không rollback nhầm transaction đã commit.
- [ ] Không roll-forward transaction chưa commit.
- [ ] Không cho transaction mới phá hủy recovery data cũ.
- [ ] Crash ở các điểm quan trọng có test và hậu điều kiện.

### B. Filesystem durability

- [ ] Manifest được ghi theo quy trình phù hợp với nền tảng.
- [ ] Không mất bản manifest cuối cùng khi atomic replacement thất bại.
- [ ] Recovery từ temp manifest xác minh tính hợp lệ và không chọn tùy tiện.
- [ ] Backup được kiểm tra SHA-256.
- [ ] Rollback một phần có thể recovery lại an toàn.
- [ ] Không xóa backup cuối cùng khi recovery chưa được xác minh.
- [ ] Lỗi `fsync`, rename, quarantine và cleanup được xử lý rõ ràng.

### C. Security and concurrency

- [ ] Chặn path traversal.
- [ ] Kiểm tra symlink escape.
- [ ] Có đánh giá và kiểm thử TOCTOU phù hợp.
- [ ] Không cho hai writer cùng sở hữu một transaction.
- [ ] Không dùng PID/hostname như bằng chứng fencing toàn cục.
- [ ] Stale lock và container restart có quy trình recovery an toàn.

### D. Coverage provenance

- [ ] Mỗi run có output directory riêng.
- [ ] Parser chỉ đọc artifact của run đã xác minh.
- [ ] Không đọc coverage cũ sau khi runner thất bại.
- [ ] Run, project, snapshot và source revision được đối chiếu đúng.
- [ ] Test concurrent không gây cross-contamination.

### E. Integrity and evidence

- [ ] Storage SHA-256 không đổi hoặc mọi thay đổi được giải thích, phê duyệt rõ ràng.
- [ ] Tất cả test bắt buộc đã thực sự chạy.
- [ ] Không có test bị bỏ qua ngoài chủ đích.
- [ ] Build, lint và typecheck có kết quả thực tế nếu được cấu hình.
- [ ] Final diff đã được xem xét.
- [ ] Không còn P0 chưa xử lý hoặc chưa xác minh.
- [ ] Remaining risks được ghi đúng với mức bảo đảm thực tế.

## 15. ĐỊNH DẠNG BÁO CÁO CUỐI

Tạo báo cáo:

`COVAI_AUDIT_V4.3_FINAL_ACCEPTANCE.md`

Báo cáo phải có các mục:

1. Executive Summary.
2. Final Verdict: PASS / NOT ACCEPTED / BLOCKED.
3. Repository và môi trường thực thi.
4. Baseline và trạng thái ban đầu.
5. Finding Register: ID, severity, root cause, file/hàm, bằng chứng trước sửa, remediation, bằng chứng sau sửa, test ID, trạng thái.
6. Transaction consistency và crash-window matrix.
7. Symlink, path containment và TOCTOU.
8. Journal durability, backup integrity và recovery.
9. Concurrency, lock ownership và container restart.
10. Coverage provenance.
11. Test execution evidence: lệnh, exit code, pass/fail/skip, log tham chiếu.
12. Storage SHA-256 baseline/post-audit.
13. Changed Files: danh sách file và giải thích từng thay đổi.
14. Remaining Risks và giới hạn môi trường.
15. Final Acceptance Checklist.

Mỗi finding chỉ được đánh dấu:

- `FIXED & VERIFIED`: Source đã sửa và test đối chứng thực sự pass.
- `FIXED, NOT FULLY VERIFIED`: Có bản sửa nhưng chưa đủ bằng chứng.
- `PARTIALLY FIXED`: Một phần lỗi vẫn còn.
- `NOT FIXED`: Lỗi vẫn tồn tại.
- `NOT VERIFIABLE`: Thiếu source, môi trường hoặc quyền cần thiết.

Không sử dụng `PASS` nếu vẫn còn P0 ở các trạng thái khác `FIXED & VERIFIED`.

Nếu tất cả tiêu chí đã đạt, ghi rõ vì sao bằng chứng đủ mạnh để nghiệm thu. Nếu chưa đạt, liệt kê chính xác điều kiện còn thiếu và cách hoàn thành; không che giấu hạn chế.

## 16. YÊU CẦU CUỐI CÙNG

Bắt đầu bằng việc kiểm tra repository thực tế. Không yêu cầu người dùng xác nhận lại các bước đã được ủy quyền trong prompt này.

Hãy thực hiện công việc theo thứ tự: kiểm tra → xác minh → sửa lỗi có căn cứ → bổ sung test → chạy test → kiểm tra integrity → review diff → tạo báo cáo cuối.

Không chỉ trả lời bằng kế hoạch. Hãy thay đổi các file thực tế nếu môi trường cho phép chỉnh sửa.

Nếu không có quyền truy cập repository, không có Docker hoặc không thể chạy một số test, hãy hoàn thành mọi phần có thể thực hiện, đồng thời liệt kê chính xác phần chưa thực hiện và không giả lập kết quả.

**Định nghĩa hoàn thành:** CovAI có source code đã được rà soát, các lỗi được xác nhận đã được sửa, regression tests thực sự chạy, storage integrity được kiểm tra, diff được review và báo cáo nghiệm thu phản ánh đúng bằng chứng thực tế. Chỉ kết luận PASS khi các tiêu chí bắt buộc đều đạt; mục tiêu là độ tin cậy và khả năng phục hồi thực sự, không phải đạt một báo cáo đẹp.