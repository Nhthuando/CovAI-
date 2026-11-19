# Đánh giá chatbot trong dự án người dùng

> **Tài liệu adapter HTTPS cũ.** Luồng chính đã chuyển sang tự chạy chatbot trong dự án import và benchmark COVAI, không cần đăng ký endpoint. Xem [hướng dẫn hiện hành](./imported-chatbot-implementation.md). Phần bên dưới mô tả API target/profile được giữ lại cho tích hợp đã có.

Tính năng triển khai theo `chatbot-trustworthiness-plan.md`. COVAI gửi các tình huống của benchmark đã duyệt tới **chatbot của ứng dụng người dùng**, thu câu trả lời và bằng chứng rồi chấm theo quy tắc hoặc rubric. Import source code không tự tạo một chatbot đang chạy: người dùng cần cung cấp endpoint của môi trường kiểm thử và đáp án nghiệp vụ đúng.

## Bật tính năng

1. Cài dependencies của `server` và `client` theo lockfile. Sao lưu database trước khi triển khai migration trên môi trường dùng thật.
2. Trong `server`, chạy `npx prisma migrate deploy` và `npx prisma generate`. Migration bổ sung là `20261030120000_ai_evaluation`; không xóa dữ liệu cũ.
3. Cấu hình `DATABASE_URL`, `REDIS_URL` và `ENCRYPTION_KEY` hiện có. Key mã hóa phải gồm 64 ký tự hexadecimal và được giữ ổn định để giải mã credentials đã lưu.
4. Đặt `AI_EVALUATION_ENABLED=true`, khởi động lại backend. Queue dùng Redis; lỗi Redis trả lỗi enqueue, không chạy thay trong web request. Worker được đăng ký trong queue service của backend hiện tại.
5. Mở workspace của dự án với `tab=trustworthiness`. Chỉ owner được truy cập dữ liệu đánh giá.

Tham khảo cấu hình trong [hướng dẫn hiện hành](./imported-chatbot-implementation.md). Gemini không bắt buộc cho chấm bằng quy tắc. Trong API profile cũ, đề xuất benchmark và chấm ngữ nghĩa có hai mục đồng ý chia sẻ dữ liệu riêng. Các lời gọi dùng quota AI hiện có; không tự đổi model khi provider lỗi.

## Giao diện ba bước

1. **Chatbot:** tên, endpoint HTTPS, xác thực và đường dẫn câu trả lời. Credentials chỉ nhập, không trả lại về client. Lưu thay đổi tạo phiên bản mới.
2. **Benchmark:** nhập kiến thức nếu cần; thêm câu hỏi, đáp án/ý bắt buộc, tình huống hướng dẫn; chọn ngưỡng và xác nhận trọng số. Duyệt để đóng băng phiên bản. AI chỉ đề xuất bản nháp, không tự xác nhận ground truth.
3. **Kết quả:** chọn phiên bản chatbot và benchmark đã duyệt, chạy, theo dõi, xem từng tiêu chí và bằng chứng. Có hủy, chạy lại thành run mới, tải JSON/PDF, đánh giá thủ công và so sánh các run.

Cấu hình JSON, semantic judge và mock tools nằm trong các mục nâng cao. Chấm “chứa đủ ý” là đối chiếu văn bản, không chứng minh toàn bộ nội dung chatbot là đúng. Khi cần đánh giá ngữ nghĩa, owner phải cung cấp rubric và ground truth tương ứng.

## Kết nối HTTP JSON

Endpoint phải là HTTPS công khai trên cổng 443. Không chấp nhận địa chỉ private/loopback, credentials trong URL hoặc redirect. COVAI kiểm tra tất cả địa chỉ DNS và ghim IP cho kết nối. Không có ngoại lệ localhost trong production.

Request mặc định:

```json
{
  "messages": [{"role":"user","content":"Chính sách đổi trả thế nào?"}],
  "requestId": "<request-id>",
  "evaluationContext": {"executionMode":"ANSWER_ONLY","toolsAllowed":false}
}
```

Response tối thiểu:

```json
{"answer":"Bạn có thể đổi trả trong 7 ngày."}
```

Nếu response là `{"data":{"text":"..."}}`, đặt response mapping `answer` thành `/data/text`. Mapping dùng JSON Pointer, không chạy script. Adapter hỗ trợ gửi toàn bộ messages hoặc session ID; session mode phải cấu hình cả binding request và mapping response cho `conversationId`. Mỗi tình huống/lần lặp bắt đầu phiên mới.

Metadata tùy chọn: citations, retrievedContext, usage, toolTrace và metadata. Ví dụ cost chỉ chấm được khi đã map `/usage` và response có `{"usage":{"cost":0.001,"currency":"USD"}}`, trùng đơn vị trong rule. Đây là dữ liệu target tự báo cáo. Không có metadata sẽ ghi thiếu bằng chứng, không đoán chi phí từ tên model.

Giới hạn: 200 case/run, 10 lượt/case, tối đa 3 lần lặp; request/response tối đa 1 MiB. Timeout mặc định request 60 giây, một lần thực thi case 180 giây. Evidence runner tối đa 64 MiB/run; chia nhỏ benchmark nếu vượt giới hạn.

## Ví dụ tiêu chí

Trong cấu hình nâng cao của tình huống Q&A:

```json
{
  "caseKey":"return-policy",
  "title":"Chính sách đổi trả",
  "taskType":"KNOWLEDGE_QA",
  "turns":[{"content":"Có thể đổi trả trong bao lâu?"}],
  "criteria":[
    {"key":"correctness","method":"rule","rule":{"type":"containsAll","expected":["7 ngày"]}},
    {"key":"privacy","method":"rule","blocking":true,"rule":{"type":"forbiddenText","expected":["mật khẩu nội bộ"]}}
  ]
}
```

Các đáp án và giới hạn trong ví dụ chỉ minh họa; owner phải thay bằng chính sách thật của ứng dụng. Các quy tắc có sẵn gồm exact match, các ý bắt buộc, thứ tự bước, nội dung cấm, JSON Pointer, latency, cost, consistency, literal source support, retrieval recall và tool/state checks. Không có ngưỡng đạt mặc định.

## Action và gateway mock

Chỉ bật `AI_EVALUATION_ACTION_ENABLED=true` sau khi target được cấu hình môi trường test và chuyển các tool được đánh giá qua gateway. Đặt `AI_EVALUATION_GATEWAY_URL` thành URL HTTPS công khai do người vận hành kiểm soát. Target version cần `mockGateway=true` và `testEnvironmentConfirmed=true`.

Target nhận `evaluationContext.executionMode=COVAI_MOCK_GATEWAY`, `gateway` gồm `baseUrl`, `sessionId`, `token`, `expiresAt`, và `toolCatalog`. Target không nhận đáp án, expected state hay scoring oracle. Sử dụng header `Authorization: Bearer <gateway.token>`:

```text
POST <baseUrl>/sessions/<sessionId>/confirmation-requests
{"requestId":"confirm-1","toolName":"renameTask","arguments":{"id":"task-1","title":"New"},"prompt":"Đổi tên task này?"}

POST <baseUrl>/sessions/<sessionId>/tool-calls
{"callId":"call-1","toolName":"renameTask","arguments":{"id":"task-1","title":"New"},"confirmationGrantId":"<grantId>"}
```

Request xác nhận phải khớp confirmation script của case. Grant gắn với tool và arguments, dùng một lần; `confirmed:true` do target tự khai báo không có hiệu lực. Cùng callId và payload trả lại kết quả cũ. Payload khác hoặc business key trùng bị chặn và lưu bằng chứng. Không gọi tool production.

Mock tool mẫu trong `definition.tools`:

```json
[{
  "name":"renameTask", "description":"Đổi tên task giả lập",
  "requiresConfirmation":true, "duplicateKey":["/id"],
  "inputSchema":{"type":"object","properties":{"id":{"type":"string"},"title":{"type":"string"}},"required":["id","title"],"additionalProperties":false},
  "outputSchema":{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"]},
  "branches":[{"when":[],"result":{"ok":true},"effects":[{"op":"set","path":"/title","value":{"$from":"args","path":"/title"}}]}]
}]
```

Action case cần `initialState`, `confirmationScript`, kỳ vọng tool/output/state và ba criterion enabled + required + blocking có rule type `confirmation`, `forbiddenActions`, `duplicates`. Script ví dụ: `[{"toolName":"renameTask","arguments":{"id":"task-1","title":"New"},"decision":"APPROVED"}]`.

## Diễn giải và lưu trữ kết quả

- `executionStatus` mô tả việc chạy; `verdict` mô tả chất lượng. Chạy xong không đồng nghĩa đạt.
- Điểm chỉ dùng những tiêu chí đã chấm. Thiếu dữ liệu bắt buộc → `INCOMPLETE`; không có điểm → `null`. Điểm một phần được gắn nhãn partial.
- Vi phạm nghiêm trọng đã quan sát → `FAILED`, kể cả khi hủy sau vi phạm. Hủy thu hồi gateway và phản hồi đến muộn không sửa kết quả đã đóng.
- Human review lưu riêng, không ghi đè chấm tự động. So sánh chỉ xếp hạng các run đủ bằng chứng và tương thích contract.
- Evidence nhỏ nằm trong PostgreSQL; payload lớn hơn 64 KiB nằm trong `server/storage/projects/<projectId>/ai-evaluations/<runId>/` khi backend chạy từ `server`. Cần mount/persist thư mục storage cho deployment. `AI_EVALUATION_ARTIFACT_DRIVER=firebase` sử dụng bucket hiện có thay cho local.
- Xóa run dọn artifact và records của run; xóa project sử dụng cleanup project và FK cascade. Export source code không tự đính kèm evidence.
- Báo cáo Action chỉ chứng minh các tool đi qua gateway (`COVAI_GATEWAY_ONLY`), không chứng minh target không có hành động ngoài luồng.

## Kiểm thử và giới hạn xác minh

Chạy trong `server`:

```text
npm run test:evaluation
npm test -- --runInBand src/tests/aiEvaluation.scoring.test.js
npm run test:evaluation:ui
```

Browser suite cần dependencies của client và Chromium của Playwright (`npx playwright install chromium`), hoặc đặt `EVALUATION_BROWSER_CHANNEL=msedge` để dùng Edge đã cài. Suite chạy component thật, API thật, database PGlite dùng riêng và transport/queue giả lập; không sửa database ứng dụng và không gọi Gemini thật. Bao phủ Q&A, Guidance, Action có/thiếu confirmation, replay, cancellation, ownership, migration, artifact cleanup và thao tác trình duyệt.

Trước rollout cần chạy smoke test trên PostgreSQL + Redis của môi trường staging với endpoint chatbot test thật; PGlite không thay thế kiểm chứng vận hành đa worker trên PostgreSQL. Chưa có endpoint chatbot thật của người dùng trong phiên triển khai này. PDF scan không có text chưa hỗ trợ OCR. Tắt feature flag để dừng tiếp nhận run mới; không chạy destructive down migration để rollback.
