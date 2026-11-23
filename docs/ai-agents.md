# Bốn agent chuyên trách của COVAI

COVAI dùng bốn vai trò AI với **benchmark và ví dụ chuẩn riêng** để hướng dẫn Gemini. Đây là cấu hình prompt/few-shot, không phải huấn luyện lại trọng số mô hình. Các agent tiếp tục sử dụng model, quota, cơ chế duyệt/apply và runner của từng tính năng hiện có.

| Agent | File benchmark cần sửa | Nhiệm vụ |
| --- | --- | --- |
| Unit Test | [unit-test/benchmark.json](../server/src/agents/unit-test/benchmark.json) | Phân tích function, guard/branch, happy path, boundary, exception; mock dependency và giữ source bất biến. |
| Integration Test | [integration-test/benchmark.json](../server/src/agents/integration-test/benchmark.json) | Theo router mount, middleware, request/response contract; kiểm tra wiring và dữ liệu độc lập. |
| System Test | [system-test/benchmark.json](../server/src/agents/system-test/benchmark.json) | Hành trình người dùng trên UI/runtime thật, precondition độc lập và business-outcome assertions. |
| Chatbot Trustworthiness | [chatbot-trustworthiness/benchmark.json](../server/src/agents/chatbot-trustworthiness/benchmark.json) | Dùng ground truth, rubric và evidence để đề xuất/chấm tình huống chatbot; giữ thiếu bằng chứng riêng với sai. |

## Cấu trúc một benchmark

- `id`, `benchmarkId`, `version`: nhận diện vai trò và phiên bản chuẩn.
- `scope`, `instructions`: phạm vi và nguyên tắc riêng của agent.
- `criteria`: tiêu chí chất lượng, trọng số hướng dẫn, điều kiện chặn và bằng chứng cần có.
- `examples`: ví dụ giả lập gồm input, cách làm đúng, anti-pattern và lý do. Ví dụ không phải dữ kiện của dự án import; Gemini không được sao chép route, giá trị hoặc evidence ID mẫu vào dự án thực.

Ví dụ Unit Test phân biệt input bị chặn ở guard trước với input thật sự tới nhánh evaluator; Integration phân biệt public route với route có authorization; System không xem body/toast hiện ra là đủ chứng minh nghiệp vụ; Trustworthiness phân biệt câu trả lời tương đương “một tuần” với câu trả lời sai “30 ngày” khi ground truth là 7 ngày.

`server/src/agents/registry.js` kiểm tra schema, giữ cấu hình của nền tảng, dựng hướng dẫn và tính SHA-256 cho toàn bộ profile. Không cho repository import thay thế benchmark của COVAI. Getter trả bản sao để caller không thay đổi cấu hình đang dùng.

## Các điểm đã nối vào Gemini

| Luồng | Điểm tích hợp |
| --- | --- |
| Unit generation/suggestion | `unitTestGenerator.service.js`, `aiPromptBuilder.service.js`, `fullTestPromptBuilder.service.js` |
| Unit input repair | `generatedTestInputRepair.service.js` |
| Integration generation/repair | `supertestPromptBuilder.service.js`, `integrationAiTestGenerator.service.js`, `scenarioManager.service.js` |
| System generation | `aiPromptBuilder.service.js`, `cypressPromptBuilder.service.js`, `verifiedSystemGeneration.service.js` (full-stack và cold-start) |
| System optimization/startup | `systemTestPromptBudget.service.js`, `fullSystemSetup.service.js` |
| Chatbot proposal/judging | `aiEvaluation/judge.service.js` |

Agent context nằm trước project data hoặc trong payload có budget; các output schema của pipeline được giữ nguyên. Source, log và câu trả lời target luôn là dữ liệu không đáng tin cậy. Benchmark không được dùng để bịa ra contract, ép test xanh hoặc tự sửa source cho qua kiểm thử.

Với System booster, context agent được tính vào giới hạn ký tự prompt. Với chatbot judge, hướng dẫn vai trò được đưa vào `systemInstruction` của Gemini. Consent và kiểm tra score/evidence IDs hiện có vẫn được thi hành. API không tự phát sinh lời gọi Gemini khi đọc cấu hình.

## Lưu vết và quyền truy cập

- `GET /api/ai-agents`: danh sách bốn agent và manifest, cần JWT.
- `GET /api/ai-agents/:id`: benchmark và ví dụ chuẩn của agent, cần JWT. ID lạ trả 404.
- Manifest có `version`, `benchmarkId`, `benchmarkHash`, `promptVersion`, `strategy: BENCHMARK_FEW_SHOT`.
- Run đánh giá chatbot lưu manifest của agent và mỗi semantic judgment lưu metadata agent thực tế. Đổi benchmark khi run đang chờ làm run dừng với `AGENT_BENCHMARK_CHANGED` trước khi gọi target/judge; người dùng tạo run mới.
- So sánh run xét cả benchmark hash của agent. Không xếp hạng trực tiếp như cùng chuẩn khi profile agent khác nhau.

Các trọng số trong benchmark agent hướng dẫn chất lượng đề xuất. Chúng không thay thế công thức coverage/quality của Unit/Integration/System, hoặc scoring policy đã đóng băng của run chatbot. Quyết định đạt cần bằng chứng từ validator/runner tương ứng; nội dung Gemini tự tuyên bố không phải chứng nhận đã chạy.

## Cập nhật chuẩn và kiểm chứng

1. Sửa đúng `benchmark.json` của agent; mỗi thay đổi chuẩn/ví dụ cần tăng `version`.
2. Giữ ví dụ có oracle rõ ràng, tình huống sai điển hình và cách nhận diện thiếu bằng chứng. Không lấy output AI chưa được duyệt làm chuẩn.
3. Chạy `npm run test:agents` trong `server`. Bộ test kiểm tra routing tới đúng agent, role context ở các prompt builder thật, budget, API auth và cơ chế pin benchmark của chatbot.
4. Để kết luận thay đổi làm Gemini chính xác hơn, dùng tập dự án/case có nhãn chuyên gia độc lập với các ví dụ trong prompt; so sánh cùng model/config và ghi agreement, false-pass ở tình huống nghiêm trọng, lỗi format và tỷ lệ thiếu bằng chứng. Không coi test mock/provider fixture là bằng chứng cải thiện độ chính xác của Gemini live.

Không cần migration cho lớp agent này. Giao diện các tính năng hiện có và luồng chatbot ba bước tiếp tục sử dụng các pipeline đã được gắn agent.
