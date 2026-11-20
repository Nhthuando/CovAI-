# Chuyển sang đánh giá chatbot trong dự án import

Yêu cầu được cập nhật: không yêu cầu người dùng đăng ký endpoint hoặc tự tạo benchmark. Giao diện chính gồm **Kiểm tra chạy → Phân tích → Kết quả**. Benchmark do COVAI quản lý. Luồng HTTPS target trước đây không còn là luồng chính của tính năng này.

## Tiêu chí hoàn tất

- Chọn snapshot thuộc dự án; tự phát hiện chatbot và cấu hình chạy từ source.
- Kiểm tra bằng request thật tới chatbot đã khởi động trong môi trường cô lập. Phát hiện source không được trình bày là đã chạy thành công.
- Không thực thi source người dùng trong process backend hoặc dùng host-shell fallback. Không cấp filesystem, database, Redis hay credentials của COVAI cho ứng dụng được kiểm tra.
- Nếu thiếu key/cấu hình hoặc không nhận diện được contract, trả nguyên nhân ở bước kiểm tra; không giả lập thành một chatbot đang hoạt động.
- Benchmark nền tảng có version, nguồn gốc chính sách điểm rõ ràng. Các FAQ nghiệp vụ được trích từ tài liệu có tham chiếu nguồn; không tự lấy output của chatbot làm oracle.
- Chấm những tình huống đã thực thi thật, lưu evidence, giữ missing/error riêng với failed. Semantic evaluation chỉ gửi dữ liệu khi được cho phép.
- Chỉ một nút bắt đầu trong luồng chính; không bắt người dùng nhập URL chatbot hoặc duyệt thủ công một benchmark.
- Có tiến độ, hủy, lịch sử, kết quả từng tiêu chí, báo cáo; quyền owner, snapshot scoping, cleanup và restart recovery.
- Kiểm thử bằng fixture dự án thật chạy trong sandbox, integration API và trình duyệt ba bước; triển khai và smoke test trên Docker hiện tại.

## Đã triển khai trong đợt chuyển đổi

- `projectDiscovery.service.js`: quét source có giới hạn, nhận diện route Express/Next/Python, package start script, tên biến môi trường và tài liệu. Không đọc `.env` hoặc thực thi source. Các candidate còn mơ hồ được ghi rõ.
- `platformBenchmark.service.js`: catalog COVAI có version, tình huống kiểm tra chung và FAQ có provenance. Policy hiện tại là chính sách sản phẩm COVAI v1 (ngưỡng 80), không phải yêu cầu được suy ra từ Proposal. Thiếu judge hoặc ground truth không được chuyển thành điểm đạt.
- Tests riêng cho discovery và benchmark.
- `projectSandbox.service.js`: Docker-only, filesystem gốc chỉ đọc, source truyền vào tmpfs; không mount host hoặc socket vào ứng dụng. Sidecar egress chỉ cho registry và provider đã liệt kê. Script probe đóng gói trong image tin cậy, tách khỏi source dự án.
- `projectAdapter.service.js`: kiểm tra request/response thật trong sandbox trước khi đánh giá; không xem health page là chatbot sẵn sàng.
- Fixture Express và FastAPI đã cài dependency, khởi động và trả lời thành công trong Docker thật, gồm cả gọi Docker từ backend container.
- Migration `20261031120000_imported_chatbot_evaluation` bổ sung `AiEvaluationProjectRun` đã được áp dụng lên database đang chạy; lưu tiến độ, lease, cấu hình đã mã hóa và liên kết báo cáo.
- `projectEvaluation.service.js` nối snapshot, source discovery, sandbox, catalog benchmark, durable queue và scoring/report hiện có. Worker bị gián đoạn được ghi `INDETERMINATE`, không gửi lại request một cách mù quáng.
- `ProjectChatbotWorkspace.jsx` là workspace chính: ba bước, cấu hình runtime khi thiếu, tiến độ, hủy, lịch sử, kết quả từng case, tải JSON/PDF và xóa lần đánh giá.
- Secret dùng kiểm thử được che khỏi readiness, target manifest và conversation evidence. Việc chatbot trả lại nguyên văn credential đã cấp được ghi thành vi phạm chặn kết luận đạt; che secret không biến vi phạm thành đạt.
- Cleanup có thể retry khi Docker lỗi; bộ reconciliation dọn container/network của các workflow đã kết thúc theo owner label và namespace. Không dọn sandbox đang thuộc một run hoạt động.

## Sử dụng

1. Import dự án, mở **Đánh giá chatbot**, chọn snapshot hoặc giữ snapshot mới nhất.
2. Bấm **Đánh giá chatbot**. COVAI tìm route, cài dependency và khởi động chatbot trong Docker riêng, rồi gửi câu hỏi kiểm tra thật.
3. Nếu chatbot cần API key/model configuration, nhập giá trị kiểm thử trong phần cấu hình bổ sung và chạy lại. COVAI không lấy secret nền tảng của mình đưa vào ứng dụng được kiểm tra. Nếu có nhiều route, chọn chatbot đã được phát hiện.
4. Sau readiness, COVAI tự chạy benchmark có version. Không cần nhập URL chatbot, tự viết benchmark hay phê duyệt profile.
5. Xem kết luận, điểm và độ đầy đủ, câu trả lời đã quan sát, lý do từng tiêu chí; tải JSON/PDF khi kết thúc. Điểm thiếu bằng chứng luôn có nhãn tạm tính.

Catalog nằm trong `server/src/services/aiEvaluation/platformBenchmark.service.js`: latency, consistency, context retention khi contract hỗ trợ messages, clarification, privacy và câu hỏi nghiệp vụ trích từ FAQ trong Markdown/TXT. Ngưỡng 80 là chính sách COVAI v1. Các nguồn FAQ có tên file và content hash; chúng không được trình bày như ground truth đã được domain expert xác nhận. Không có FAQ thì project correctness là thiếu bằng chứng, không dùng chính câu trả lời của chatbot làm đáp án chuẩn.

Chấm ngữ nghĩa dùng Gemini khi owner bật đồng ý gửi câu trả lời và phần ground truth cần thiết cho evaluator. Chưa cấu hình evaluator hoặc chưa đồng ý thì vẫn chạy các kiểm tra xác định được, nhưng kết quả tổng có thể `INCOMPLETE`. Lỗi provider không được đổi model ngầm hoặc chuyển thành điểm đạt. CI sử dụng judge fixture, không coi live Gemini là điều kiện bắt buộc.

## Cấu hình vận hành

```dotenv
AI_EVALUATION_ENABLED=true
AI_EVALUATION_ACTION_ENABLED=false
AI_EVALUATION_ARTIFACT_DRIVER=local
AI_EVALUATION_JUDGE_MODEL=<pinned-gemini-model>
AI_EVALUATION_RUNTIME_NAMESPACE=covai
```

Backend dùng `REDIS_URL`, `DATABASE_URL`, `ENCRYPTION_KEY` và `GEMINI_API_KEY`/`GOOGLE_API_KEY` theo cấu hình hiện có. Redis không sẵn sàng thì enqueue trả 503; không có fallback thực thi source trong web process. Quota AI hiện có áp dụng cho evaluator.

Docker CLI và socket chỉ được cấp cho backend controller trong cấu hình Compose hiện tại. Ứng dụng được kiểm tra không có socket, host bind mount, public port hoặc credentials/database/Redis của COVAI. Production nên đặt controller trên worker chuyên biệt. Runtime dùng UID 1000, root filesystem chỉ đọc, capability bị bỏ, CPU/RAM/PID/time giới hạn. `/workspace` là tmpfs cho code và native dependencies; `/tmp` không cho thực thi. Source đi qua tar stream, không phụ thuộc host path của Docker daemon.

Sidecar chỉ cho HTTPS đến registry npm/PyPI và các model provider đã liệt kê trong `runtime/egressProxy.mjs`; DNS/IP private bị chặn. Các môi trường phải dùng namespace riêng để reconciliation không dọn tài nguyên của nhau. Test dùng namespace theo process.

## Giới hạn được báo rõ

Phạm vi chuẩn bị source bắt đầu từ package/ứng dụng đã chọn trong snapshot, không mặc định copy toàn bộ wrapper của archive. Nếu frontend có backend đi cùng trong thư mục ứng dụng, giữ cả cặp đó; workspace được khai báo rõ vẫn giữ các package cần cho workspace, nhưng không được vượt ra ngoài repository import. Ví dụ snapshot `cookbook/custom-frontend/frontend` dùng phạm vi `custom-frontend`, nên video trong `cookbook/extended-thinking-in-the-ui` không được copy. Asset nằm bên trong ứng dụng vẫn được giữ để không làm hỏng runtime. Báo cáo lưu `sourceScope` và lỗi giới hạn chỉ rõ file/giới hạn bị vượt.

Đã xác minh copy trên snapshot cookbook thực tế không lấy video minh họa ngoài ứng dụng. Backend đi cùng được nhận diện là Chainlit WebSocket/streaming và chạy bằng [adapter Chainlit native](./chainlit-native-adapter.md), không yêu cầu thêm HTTP bridge hay cờ trong source. Các lượt cũ báo `CHATBOT_PROTOCOL_UNSUPPORTED` vẫn giữ nguyên lịch sử; tạo lượt mới để dùng adapter.

- Nhận diện các route Express, Next API, Python và Chainlit thông dụng. Chainlit hỗ trợ CLI hoặc FastAPI mount literal; cookie `/custom-auth` được dùng khi route này đã có trong target. Custom framework, mount động, websocket/SSE ngoài Chainlit, xác thực tùy chỉnh, database hay dịch vụ phụ thuộc ngoài allowlist cần adapter/runtime bổ sung; bước kiểm tra trả lỗi cụ thể thay vì giả lập thành công.
- Chainlit thiếu `requirements.txt` có thể chạy bằng runtime tương thích có phiên bản, nhưng bắt buộc ghi thiếu bằng chứng về dependency gốc; không được kết luận toàn hệ thống đạt.
- Next có `next start` và `dev` sẽ dùng dev để không đòi build artifact có sẵn. Khởi động thành công vẫn phải được chứng minh bằng response thật.
- Source freeze tối đa 15.000 entries/96 MiB, mỗi file 20 MiB, sâu 32 cấp; discovery có giới hạn riêng 2.500 files/12 MiB text/12 cấp. Secret files và symlink không được copy.
- Benchmark tự dùng FAQ rõ ràng; chưa tự chứng nhận toàn bộ nghiệp vụ từ source code hoặc tài liệu tùy ý. Không có ground truth thì báo thiếu bằng chứng.
- Luồng chính chấm câu trả lời. Không chứng nhận tool/action, retrieval, cost hoặc hành động ngoài quan sát khi không có trace tương ứng.
- Kết quả chỉ áp dụng cho source manifest, benchmark và các phản hồi đã quan sát. Không phải chứng nhận mọi chatbot/framework đều chạy được hoặc mọi hành vi của AI đều an toàn.

## Kiểm thử

Trong `server`: `npm run test:evaluation` kiểm tra persistence/authorization, discovery, catalog, mapping, scoring, confirmation, redaction, cancellation, recovery và cleanup. `npm run test:evaluation:ui` kiểm tra luồng ba bước qua API thật và trình duyệt. Đặt `RUN_CHATBOT_SANDBOX_TEST=true` để UI dùng Docker thật; `npm run test:evaluation:docker` với cùng biến kiểm tra Express và FastAPI. Edge cài sẵn có thể dùng `EVALUATION_BROWSER_CHANNEL=msedge`.

Kiểm thử workflow bao phủ cả kết luận thiếu bằng chứng, vi phạm credential chặn đạt, và bộ benchmark đầy đủ với judge fixture. Kiểm thử UI bao phủ refresh, download, xóa và responsive/dark theme. Các regression tests của queue, project access, project cleanup và scoring phải tiếp tục đạt.

## Kết quả kiểm chứng ngày 31/10/2026

- 34 evaluation tests và 54 regression tests của scoring, queue, project access/deletion/storage đạt.
- Hai fixture Docker thật Express/FastAPI đạt, bao gồm cài dependency, gọi route và không kết nối được cổng backend/Redis trên host trong môi trường Compose kiểm tra.
- Browser test dùng API và Docker thật đạt: một nút chạy, ba bước, refresh, JSON download, xóa, responsive và dark theme.
- Smoke test trên API/Redis/database đang triển khai đạt: tạo snapshot fixture, chạy bằng worker thật, kiểm tra kết quả `INCOMPLETE` đúng với việc thiếu judge/ground truth, tải JSON và PDF, xóa workflow và dọn dữ liệu fixture. Không gọi Gemini live trong bài smoke.
- Lint component/hook mới, frontend build, Prisma validate và kiểm tra diff đạt. Build vẫn có cảnh báo bundle lớn của ứng dụng hiện có.
- Đã xử lý mã serialization PostgreSQL `40001`/deadlock `40P01` ở cả metadata Prisma cũ và `driverAdapterError.cause.originalCode` của Prisma 7. Chỉ transaction database rollback được retry có giới hạn; không replay lời gọi chatbot/provider.

Chạy lại smoke trên backend đã khởi động và có database/Redis: `docker exec -e RUN_DEPLOYED_CHATBOT_SMOKE=true covai_server node scripts/smoke-imported-chatbot.mjs`. Script cần opt-in, chỉ tạo/xóa user/project fixture riêng và không in token. Không dùng live Gemini làm bằng chứng rằng evaluator đã được calibration độc lập.
