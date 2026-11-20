# Đánh giá chatbot theo giao thức trong dự án import

## Luồng chung

1. Đóng băng source của ứng dụng trong snapshot, không chạy code khi phân tích.
2. Nhận diện entry point, framework, dấu hiệu SDK/giao thức và request shape.
3. Registry chọn adapter do COVAI quản lý; không dùng tên repository hoặc project ID để chọn logic.
4. Khởi động ứng dụng trong sandbox và kiểm tra câu trả lời thực tế. Dấu hiệu trong source chưa chứng minh ứng dụng chạy được.
5. Tạo benchmark COVAI với ca kiểm tra chung và ca nghiệp vụ có đáp án dựa trên tài liệu của chính dự án.
6. Thực thi benchmark, lưu bằng chứng/phiên bản và chấm điểm. Thiếu ground truth, consent hoặc evaluator thì ghi thiếu bằng chứng.

Không yêu cầu người dùng đăng ký endpoint bên ngoài hoặc tự viết benchmark. Biến môi trường bổ sung chỉ dành cho nhu cầu của target. Provider dùng chấm điểm của COVAI được cấu hình riêng.

Danh sách biến trong source là bằng chứng tham chiếu tĩnh, không phải yêu cầu nhập tất cả. Giao diện tách biến provider, biến xuất hiện trong dependency của chatbot và tham chiếu khác chưa xác định liên quan. `PORT`/`HOST`/`NODE_ENV` do runtime kiểm thử quản lý. Database/JWT/session chỉ cần khi target thực sự phụ thuộc; không tạo giá trị giả hoặc bỏ qua xác thực để làm bài kiểm thử đạt.

Chatbot Socket.IO tùy chỉnh được nhận diện từ module server, cặp sự kiện vào/ra và dependency SDK model. Khi chưa có adapter phù hợp, trả `CHATBOT_ADAPTER_REQUIRED` trước khi khởi động/chấm điểm; không báo nhầm `CHATBOT_NOT_FOUND` và không yêu cầu thêm provider key để sửa lỗi giao thức.

## Adapter hiện có

| Adapter | Giao thức quan sát | Phạm vi |
|---|---|---|
| `http-chat` v2 | HTTP JSON | Câu trả lời dạng text trong trường JSON được kiểm tra khi readiness; gồm response tương thích chat completions. |
| `http-chat` v2 | SSE | Deltas chat completions, AI SDK UI text, Anthropic text events, hoặc token/answer với sự kiện hoàn tất rõ ràng. |
| `http-chat` v2 | NDJSON | Các bản ghi assistant message/response và `done`, như hình dạng phản hồi Ollama. |
| `chainlit-socketio` v1 | Chainlit Socket.IO | CLI hoặc FastAPI mount literal; giữ phiên giữa turn và tách phiên giữa case. |

Framework khởi động hiện có: Node HTTP/Express, Next API, Python HTTP/FastAPI và Chainlit. Hỗ trợ định dạng Ollama/OpenAI không đồng nghĩa sandbox tự cài model server hoặc tải trọng số model. Chỉ có frontend kết nối tới backend vắng mặt vẫn chưa thể đánh giá.

HTTP adapter chọn định dạng từ Content-Type thực tế rồi đóng băng contract cho run. SSE/NDJSON lỗi, thiếu completion, thay đổi giao thức hoặc chỉ có reasoning/tool arguments sẽ không trở thành câu trả lời hợp lệ. Không tự reconnect/replay turn sau lỗi dispatch không xác định. Chỉ lỗi xác nhận chưa kết nối được (`LOCAL_CONNECTION_REFUSED`) mới được polling startup.

AI SDK UI request shape được nhận diện từ `convertToModelMessages`: messages được gửi dưới dạng text parts, giữ client conversation ID giữa turn. Không tự chọn tên model hoặc sửa logic target.

Chainlit dùng route GET trả `_authenticate_user` đã có trong source ứng dụng khi xác định duy nhất một route; không phụ thuộc tên `/custom-auth`. Nếu target yêu cầu xác thực tương tác hoặc giao thức khác chưa hỗ trợ, báo lỗi/thiếu adapter thay vì bỏ qua xác thực.

## Benchmark theo nghiệp vụ

Nguồn được sử dụng có giới hạn:

- FAQ rõ ràng trong Markdown/TXT.
- FAQ JSON có tên `faq`, `faqs`, `knowledge`, `knowledge-base`, `knowledge_base` hoặc `kb`: mảng `{ question, answer }` hoặc `{ faqs: [...] }`.
- Mục Markdown có nhãn business rules/policy/user guide hoặc chính sách/quy tắc nghiệp vụ/hướng dẫn sử dụng/quy trình sử dụng; hỗ trợ các mục con.

Không lấy code, cấu hình tùy ý hoặc nội dung code fence làm đáp án nghiệp vụ. Giới hạn 20 ca nghiệp vụ; đoạn quá dài hoặc chứa assignment secret bị bỏ. Mỗi ca có source hash và dòng hoặc JSON Pointer tương ứng. Đáp án là thông tin tài liệu của dự án, chưa phải kiểm chứng độc lập mọi nghiệp vụ.

Manifest lưu adapter/discovery version, source manifest, business analysis, benchmark v2 và evidence. Benchmark cũ vẫn giữ phiên bản cũ. Chấm ngữ nghĩa chỉ gọi Gemini khi có cấu hình và consent; thiếu tài liệu/evaluator không được tự coi correctness đạt.

## Mở rộng

Thêm adapter trong `projectAdapterRegistry.service.js` với `id`, `version`, `protocols`, `matches(candidate)`, `probe(runtime, candidate, options)` và `executor(runtime, contract)`. Executor có thể cung cấp `closeConversation(id)` cho giao thức có phiên.

Adapter phải có kiểm thử contract và fixture ứng dụng độc lập, kiểm tra lỗi/timeout/cancel, dữ liệu trả lời có provenance và không replay mù quáng. Tăng version khi contract thay đổi. Discovery thêm bằng chứng giao thức; orchestrator tiếp tục gọi cùng interface, không thêm nhánh theo repository hay project ID.

Chưa hỗ trợ tự động mọi dạng WebSocket/SSE tùy chỉnh, Gradio, Streamlit, LangGraph SDK streaming, OAuth tương tác hoặc mọi dịch vụ/model tự host. Các trường hợp này cần thêm adapter/runtime tương ứng. Evaluation hiện chấm câu trả lời quan sát được, không chứng nhận tool/action nội bộ.

## Kiểm tra

```powershell
cd server
npm run test:evaluation
$env:RUN_CHATBOT_SANDBOX_TEST = 'true'
npm run test:evaluation:docker
```

Fixture Docker bao gồm ứng dụng độc lập HTTP JSON Node/Python, Chainlit CLI/FastAPI với cookie path khác nhau, SSE Node và NDJSON Python. Không cần live Gemini/OpenAI để kiểm tra giao thức.

Định dạng tham chiếu: [SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events), [Ollama NDJSON](https://docs.ollama.com/api/streaming), [AI SDK stream protocols](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol).
