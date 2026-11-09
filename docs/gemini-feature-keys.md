# Gemini cho các tính năng COVAI

| Luồng | Biến secret phía backend | Model mặc định riêng | Hướng dẫn và benchmark |
| --- | --- | --- | --- |
| AI Chatbot COV (hội thoại và bảo trì memory) | `GEMINI_CHATBOX_API_KEY` | `GEMINI_CHATBOX_MODEL` | Product guide và context resolver trong `server/src/services/chatWorkspaceContext.service.js` |
| Unit Test | `GEMINI_UNIT_TEST_API_KEY` | `GEMINI_UNIT_TEST_MODEL` | `server/src/agents/unit-test/benchmark.json` |
| Integration Test | `GEMINI_INTEGRATION_TEST_API_KEY` | `GEMINI_INTEGRATION_TEST_MODEL` | `server/src/agents/integration-test/benchmark.json` |
| System Test | `GEMINI_SYSTEM_TEST_API_KEY` | `GEMINI_SYSTEM_TEST_MODEL` | `server/src/agents/system-test/benchmark.json` |
| Đánh giá chatbot | `GEMINI_TRUSTWORTHINESS_API_KEY` | `AI_EVALUATION_JUDGE_MODEL` | `server/src/agents/chatbot-trustworthiness/benchmark.json` |

Copy cấu hình từ `server/config-examples/gemini-features.env.example` vào `server/.env`, điền các key thật trên máy, rồi bật `GEMINI_REQUIRE_DEDICATED_KEYS=true`. Riêng AI Chatbot luôn yêu cầu `GEMINI_CHATBOX_API_KEY`, kể cả khi strict mode chưa bật; không mượn key chung hay key sinh test. Không nhập secret vào frontend, URL hoặc chat và không commit `.env` đã điền. Nếu chạy Compose, recreate backend và worker để các biến `env_file` được nạp lại. Không recreate khi đang có job xử lý.

Trong giai đoạn chuyển đổi, `GEMINI_REQUIRE_DEDICATED_KEYS=false` cho phép các luồng test/evaluation dùng `GEMINI_API_KEY`/`GOOGLE_API_KEY` khi một key chuyên biệt còn thiếu. Chatbox không tham gia fallback này. Khi strict=true, thiếu key của luồng nào thì luồng đó báo `AI_KEY_NOT_CONFIGURED`; không mượn key của tính năng khác. Các chức năng chung như phân tích architecture vẫn dùng key chung hiện có. Key chuyên biệt luôn được ưu tiên, không fallback khi key đã cấu hình bị lỗi hoặc hết quota.

Routing dùng context tách biệt theo async request, do code chọn tính năng; không đọc tên agent từ prompt/source người dùng để chọn key. Unit generation/repair/suggestion, Supertest/integration repair, Playwright/Cypress/system setup/assessment/repair và semantic judge/proposal được nối với nhóm tương ứng. Model do người dùng chọn cho generation vẫn được tôn trọng; nếu không chọn thì dùng model riêng của nhóm. Judge tiếp tục pin model trong profile/run, không đổi model ngầm.

Mỗi request generation được cấp system instruction của specialist. Các benchmark versioned đã có gồm rubric, ràng buộc bằng chứng và ví dụ few-shot. Đây là prompt engineering và context specialization, **không phải fine-tuning hoặc training trọng số Gemini**. Thêm key không làm chất lượng tự tăng; cần bổ sung ví dụ lỗi thực tế đã được duyệt, giữ bộ kiểm thử độc lập và so kết quả trước/sau khi đổi benchmark. Không dùng test do AI sinh hoặc output target làm đáp án chuẩn để tự chứng nhận chất lượng.

Trạng thái quota phía ứng dụng được tách theo credential và model. Rate limit thật của Gemini áp dụng theo Google project, không theo từng API key: bốn key cùng một project vẫn dùng chung quota project. Nếu cần quản lý ngân sách/quota riêng, cấu hình các project Google theo nhu cầu vận hành; không xoay key để vượt giới hạn. Tham khảo [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

Không log giá trị key. Log generation chỉ chứa feature, tên biến cấu hình và model; evidence của evaluator lưu credential scope/source, không lưu secret. Consent, ground truth, validation và execution proof vẫn bắt buộc theo logic hiện có. Key evaluator của COVAI không được chuyển vào chatbot import đang được đánh giá.

## Kiểm chứng

`geminiRouting.service.test.js` kiểm tra song song năm scope, không đổi credential theo prompt, strict mode, chatbox không fallback, cách ly trạng thái quota và key/provenance của semantic evaluator. Lần triển khai chatbot ngày 05/11/2026 đã chạy 74 kiểm thử backend thuộc tám suite chat/context/memory/authorization/Gemini; thêm hai kiểm thử helper frontend, một browser test desktop/mobile và build frontend đều đạt. Provider được mock, không gọi Gemini live. Các tệp JSX lớn vẫn có lỗi lint đã tồn tại trước thay đổi; các helper mới và AIContextDialog vượt lint.

Các kiểm thử trên không xác minh giá trị credential trong `server/.env` và không chứng minh quota hay chất lượng trả lời của provider thật. Cấu hình key trên backend/worker rồi kiểm tra generation/judging thực tế bằng dữ liệu được phép chia sẻ. Xem `docs/context-aware-chatbot.md` để biết context và giới hạn từng màn hình.
