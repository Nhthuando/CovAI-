# Kế hoạch đưa đánh giá chatbot trong dự án import vào sử dụng

Ngày: 02/11/2026. Trạng thái: đề xuất triển khai; tài liệu này không khởi tạo môi trường, tải model hoặc thay đổi code.

## 1. Hướng sản phẩm

Người dùng import dự án, chọn **Đánh giá chatbot** và theo dõi ba bước:

1. **Kiểm tra chạy:** tìm chatbot, chọn adapter, chuẩn bị môi trường và gửi một lượt hỏi thật.
2. **Phân tích và đánh giá:** xác định nghiệp vụ, tạo benchmark do COVAI quản lý, chạy các case và chấm bằng chứng.
3. **Kết quả:** hiển thị điểm, mức đầy đủ, câu trả lời, nguyên nhân lỗi và phạm vi kết luận.

Không yêu cầu người dùng đăng ký một chatbot bên ngoài hoặc tự viết benchmark. Khi source chưa đủ để chạy, COVAI hướng dẫn bổ sung đúng phần còn thiếu. Không thể cam kết mọi repository được import đều tự động chạy: ứng dụng có thể thiếu source, cần model riêng, dịch vụ ngoài hoặc giao thức chưa hỗ trợ.

Giữ luồng giao diện này; bổ sung năng lực bên dưới thay vì thêm một hệ thống cấu hình khác.

## 2. Hiện trạng đã đối chiếu code

| Thành phần | Đã có | Phần cần làm tiếp |
|---|---|---|
| `projectDiscovery.service.js` | Phát hiện ứng dụng và chatbot từ source | Tạo execution plan có bằng chứng; phân biệt route chat với contact/init/history |
| `projectAdapterRegistry.service.js` | Adapter HTTP JSON/SSE/NDJSON và Chainlit | Capability/session contract thống nhất; thêm giao thức theo thứ tự ưu tiên |
| `projectSandbox.service.js` | Docker cô lập, giới hạn tài nguyên, cleanup | Runtime profile, dependency/model cache và dịch vụ kiểm thử tùy nhu cầu |
| `pythonRuntime.service.js` | Chọn Python, nhận diện một số lỗi dependency | Preflight tương thích rộng hơn, chẩn đoán theo từng giai đoạn |
| `projectSettings.service.js` | Lưu cấu hình mã hóa theo project | Chỉ hỏi các biến cần cho chatbot; làm rõ trạng thái cấu hình |
| `platformBenchmark.service.js` | Case nền tảng, FAQ/policy/guide có nguồn | Knowledge manifest, benchmark nghiệp vụ rộng hơn và kiểm tra chất lượng case |
| `projectEvaluation.service.js` | Queue, readiness, benchmark và report | Tích hợp preparation plan, capability gates và recovery tương ứng |
| `ProjectChatbotWorkspace.jsx` | Ba bước, lịch sử, cấu hình và kết quả | Hiển thị blocker cụ thể và hành động khắc phục tại đúng bước |

Không viết lại runner, scoring hoặc persistence đã có nếu có thể mở rộng bằng contract rõ ràng. Các bộ test hiện có cần được chạy lại để xác nhận baseline trước khi triển khai; tài liệu cũ ghi đã kiểm thử không thay thế việc kiểm tra code hiện tại.

## 3. Phạm vi phiên bản đầu dùng được

### Được hỗ trợ trước

- Node HTTP và Python Flask/FastAPI có route JSON nhận câu hỏi/trả câu trả lời.
- Streaming theo các định dạng adapter hiện đã hiểu; Chainlit trong phạm vi transport hiện có.
- Chatbot gọi provider bằng key của dự án, hoặc dùng model cục bộ tương thích tài nguyên worker.
- Không có database, hoặc một MySQL kiểm thử với schema/fixture rõ ràng.
- Đánh giá câu trả lời, nghiệp vụ có bằng chứng, consistency, context khi session được chứng minh, clarification, privacy và latency.

### Để sau phiên bản đầu

- Custom Socket.IO/WebSocket: thêm adapter chung với mapping event và session; không viết handler theo tên dự án.
- MongoDB/PostgreSQL và nhiều dịch vụ phụ thuộc: thêm khi có fixture và recovery tests tương ứng.
- Agent thực hiện hành động, thanh toán, gửi email hoặc ghi dữ liệu bên ngoài: cần gateway/mock và bộ tiêu chí riêng trước khi công bố hỗ trợ.
- GPU hoặc model vượt tài nguyên hiện có: báo không đáp ứng runtime, không âm thầm thay model nhỏ hơn.

## 4. Luồng xử lý đề xuất

### 4.1. Discovery và execution plan

Tạo `projectExecutionPlan.service.js`, dùng kết quả discovery hiện có:

- Xác định application root, entry point, start command, runtime và manifest/lockfile.
- Chọn candidate chatbot, request/response mapping, protocol và adapter version.
- Phân loại dependency: provider, database, model/retrieval, auth và dịch vụ phụ.
- Mỗi nhận định lưu file/vị trí nguồn, mức tin cậy và trạng thái đã/chưa kiểm chứng.
- Nhiều candidate tương đương thì hỏi người dùng chọn chatbot; không chọn ngẫu nhiên.
- Route động hoặc mapping chưa rõ thì báo cần bổ sung thông tin; không coi health response là câu trả lời chatbot.

Không dùng AI-generated shell command hoặc thực thi repository-supplied adapter plugin. Gemini có thể đề xuất phân loại từ source được phép chia sẻ, nhưng execution plan phải qua validation bằng các primitive COVAI hỗ trợ.

### 4.2. Preflight trước khi cài/chạy

Tạo `projectPreflight.service.js`:

- Kiểm tra manifest, start entry, local imports xác định được và tài nguyên worker.
- Phát hiện biến chắc chắn thiếu qua startup validation/config hoặc lỗi runtime đã quan sát. Static reference đơn lẻ chỉ là gợi ý.
- Kiểm tra nhu cầu schema, fixture và model artifact; không tải dữ liệu hoặc model không liên quan.
- Trả blocker có cấu trúc: `stage`, `code`, `summary`, `sourceRefs`, `remedy`, `retryable`.
- Nếu chưa xác định được, ghi chưa xác định; static analysis không chứng minh đầy đủ mọi dependency động.

Ví dụ: thiếu module nội bộ trả `PROJECT_SOURCE_INCOMPLETE`; chưa có DB fixture trả `TEST_DATABASE_REQUIRED`; thiếu model trả `MODEL_ARTIFACT_REQUIRED`. Đây là mã đề xuất mới, cần tích hợp DTO/UI và tests cùng lúc.

### 4.3. Chuẩn bị runtime dùng chung

Tạo `runtimeProfile.service.js` và `dependencyCache.service.js`, mở rộng sandbox hiện có:

- Profile ban đầu: Node web, Python web, Python ML CPU.
- Giữ dependency và model của target; không sửa requirements để làm test vượt qua.
- Khóa cache bằng runtime/platform, manifest/lockfile và dependency resolution thực tế. Lưu resolution manifest khi dự án không có lockfile.
- Cache build do worker quản lý; ứng dụng không được ghi vào cache dùng chung hoặc truy cập dữ liệu project khác.
- RAM/disk/timeout theo profile và quota. ML không dùng cùng mức tài nguyên với chatbot HTTP nhỏ.
- Model cache riêng: định danh model, revision/hash, kích thước và nguồn cho phép; artifact đã chuẩn bị được mount chỉ đọc.
- Tải model là một tác vụ chuẩn bị có tiến độ và giới hạn; không tải video/asset ngoài nhu cầu runtime đã xác định.

Lần trước đã undo môi trường GnG; kế hoạch này không tái tạo môi trường đó. Runtime profile mới phải được triển khai và kiểm thử trước khi áp dụng cho dự án thực tế.

### 4.4. Dịch vụ kiểm thử và cấu hình

Tạo `testDependency.service.js`, bắt đầu với MySQL:

- Một database/network riêng theo run; không kết nối database nội bộ COVAI.
- Tự tạo thông tin truy cập và inject vào target nếu mapping cấu hình được xác định.
- Chỉ nhận schema/seed từ snapshot hoặc fixture khai báo được validation. Không chạy shell script tùy ý trên host.
- SQL được thực thi bằng tài khoản giới hạn trong DB kiểm thử; tách tác vụ tạo schema khỏi quyền của ứng dụng.
- Không có seed: có thể tạo dữ liệu giả có nhãn để kiểm tra hoạt động nếu schema cho phép; không dùng dữ liệu giả làm sự thật nghiệp vụ production.
- Reset fixture giữa các case cần độc lập; lưu fixture hash và kiểm chứng isolation.
- Hủy/xóa/restart phải dọn đúng tài nguyên theo ownership labels; cleanup thất bại có retry/reconciliation.

Các biến được xử lý theo vai trò:

| Nhóm | Cách xử lý |
|---|---|
| Key provider của chatbot | Chỉ hỏi nếu chatbot thực sự cần và chưa có giá trị kiểm thử |
| Gemini dùng chấm điểm của COVAI | Cấu hình nền tảng riêng; không truyền key này vào source target |
| PORT/HOST | COVAI quản lý nếu runtime hỗ trợ |
| JWT/session secret | Có thể sinh secret kiểm thử khi cấu hình của target cho phép; không tự tạo token hoặc bỏ xác thực |
| DB credentials | COVAI cấp cho DB kiểm thử do mình tạo |
| Email/payment | Chặn tác động bên ngoài; nếu cần khởi động thì dùng mock được hỗ trợ hoặc báo blocker |

Key Gemini không thể thay MySQL, local model hoặc một module source bị thiếu.

### 4.5. Readiness thật

Sau khi process và dịch vụ phụ healthy:

1. Gửi câu hỏi smoke qua adapter đã chọn.
2. Xác nhận đúng response contract, câu trả lời kết thúc đầy đủ và không chỉ là health/error page.
3. Kiểm chứng session nếu muốn chấm nhiều lượt; session mới cho các lần lặp độc lập.
4. Lưu thời gian, protocol, adapter, response đã lọc secret và capability đã quan sát.

Chỉ sau khi bước này thành công mới chạy benchmark. Khởi động lỗi không tạo điểm chất lượng 0; ghi chưa đánh giá.

### 4.6. Benchmark và chấm điểm

Mở rộng `platformBenchmark.service.js`; thêm `projectKnowledge.service.js` và `benchmarkValidation.service.js`:

- Catalog nền tảng do COVAI sở hữu, có version và chính sách điểm được công bố.
- Trích nghiệp vụ từ FAQ, tài liệu sử dụng/chính sách, KB và fixture có nguồn rõ ràng. Code giúp tìm chức năng; không tự động trở thành đáp án đúng.
- Gemini có thể đề xuất câu hỏi, biến thể và expected facts từ nguồn được phép gửi. Validation loại case thiếu nguồn, mâu thuẫn nguồn hoặc đáp án không được nguồn hỗ trợ.
- Không yêu cầu người dùng tự lập benchmark. Khi không đủ nguồn, vẫn chạy catalog chung và báo thiếu bằng chứng nghiệp vụ.
- Đóng băng source hashes, fixture, model/runtime, adapter, benchmark/rubric và judge configuration trước khi chạy.
- Rule chấm latency, định dạng, expected facts xác định được; semantic judge chấm theo rubric và trích dẫn evidence.
- Không có consent/key judge hoặc judge lỗi: giữ trạng thái thiếu bằng chứng/lỗi; không tự động cho đạt.
- Điểm tổng đi kèm coverage/completeness và phạm vi đánh giá. Không có điểm hợp lệ thì `null`. Vi phạm nghiêm trọng chặn đạt.
- Ngưỡng 80 đang có trong catalog là chính sách sản phẩm COVAI, không trình bày như yêu cầu của Proposal hoặc kết luận khoa học về độ tin cậy.

## 5. Giao diện tối giản

Giữ một nút **Đánh giá chatbot** và ba bước hiện có.

- Bước 1 hiện tiến độ: nhận diện → kiểm tra điều kiện → chuẩn bị → khởi động → hỏi thử.
- Chỉ mở form cho blocker người dùng có thể sửa: thiếu key, thiếu source/fixture, chọn candidate hoặc model artifact.
- Không đổ toàn bộ env references thành danh sách bắt buộc.
- Bước 2 hiển thị số nguồn nghiệp vụ, số case, trạng thái đang chạy và hủy.
- Bước 3 ưu tiên kết luận, điểm có/không đầy đủ, tiêu chí chưa chấm, case lỗi và hướng cải thiện.
- Chi tiết kỹ thuật/log đã lọc đặt trong mục mở rộng; không trả secret, stack trace thô hoặc nội dung nhạy cảm vào notification.
- Giữ cấu hình theo project, giá trị masked, revision conflicts và lịch sử run hiện có.

## 6. Thứ tự triển khai và điều kiện hoàn tất

| Đợt | Công việc | Điều kiện hoàn tất |
|---|---|---|
| 0 | Chạy baseline, đối chiếu migrations/scripts/test files, cố định fixture | Xác định rõ test nào chạy được; không dùng kết quả cũ làm bằng chứng mới |
| 1 | Execution plan, preflight, lỗi có hướng xử lý và UI | Không gom mọi lỗi thành SANDBOX_START_FAILED; không yêu cầu env không liên quan |
| 2 | Runtime profiles, dependency cache, model artifact/cache | Node/Python fixture chạy; ML fixture dùng đúng model, không download lại mỗi run |
| 3 | MySQL fixture, credentials, reset/cleanup/recovery | Chatbot fixture đọc DB thật cô lập; case/run không làm bẩn nhau |
| 4 | Knowledge manifest, benchmark validation, semantic consent | Case nghiệp vụ có nguồn; thiếu nguồn/judge không thành đạt |
| 5 | Report, end-to-end UI và smoke trên dự án import | Import → chạy → benchmark → evidence → kết quả hoạt động, refresh/cancel/delete đúng |
| 6 | Custom Socket.IO và thêm dependency providers | Contract fixtures chứng minh hỗ trợ giao thức; không thêm nhánh theo tên project |

Ưu tiên đợt 1–3 trước khi mở rộng số tiêu chí. Chatbot chưa chạy thì thêm rubric không giải quyết được lỗi sử dụng.

## 7. Kiểm thử và nghiệm thu

- Fixture HTTP Node, Flask/FastAPI, SSE/NDJSON và Chainlit; response lỗi, streaming dở dang, timeout và session isolation.
- Fixture MySQL có schema/seed; fixture Python ML nhỏ với artifact revision cố định; tất cả chạy thật trong Docker.
- Negative cases: thiếu local module, sai Python/dependency, thiếu key, model quá lớn, thiếu fixture, unsupported protocol và auth chưa hỗ trợ.
- Benchmark tests: source provenance, case không có căn cứ bị loại, source mâu thuẫn, judge injection, missing evidence, serious violation và partial score.
- Integration: owner scoping, credentials không lộ, queue unavailable, worker restart, cancel, orphan cleanup và xóa project.
- Browser: luồng ba bước, cấu hình không mất, lỗi có hướng xử lý, refresh, evidence/report và retry bằng run mới.
- CI dùng target/judge fixtures; live Gemini và model lớn là smoke riêng, không bắt buộc cho mọi lần chạy test.

Một fixture chatbot đúng và một fixture cố ý trả sai phải được phân biệt bằng evidence và scoring. Không chỉ nghiệm thu việc tạo ra được báo cáo.

## 8. Áp dụng cho GnG_SmartStore sau khi nền tảng sẵn sàng

Theo chẩn đoán trước lần undo, dự án này cần Python tương thích dependency, MySQL và embedding model; còn thiếu module `telegram_integration` trong snapshot đã kiểm tra. Cần kiểm tra lại snapshot hiện hành trước khi hành động.

1. Preflight xác nhận source đủ; nếu còn thiếu module thì yêu cầu import bản đầy đủ, không tạo stub để che lỗi.
2. Chuẩn bị profile Python ML và đúng model revision theo cấu hình target.
3. Tạo MySQL kiểm thử từ schema, bổ sung fixture có nhãn; chưa có fixture phù hợp thì báo rõ.
4. Cấp key provider chỉ nếu đường chạy chatbot thực sự sử dụng provider đó.
5. Probe đúng route chat đã được xác định; không dùng init/contact route làm chatbot.
6. Tạo benchmark từ nguồn nghiệp vụ/fixture đã đóng băng, chạy và báo phạm vi kết quả.

Đây là trường hợp nghiệm thu của các module chung, không phải một nhánh xử lý riêng mang tên GnG.
