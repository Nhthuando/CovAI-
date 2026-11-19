# AI Chatbot COV theo ngữ cảnh

Public chatbot branding is **COV Assistant**. Interface labels, greetings, waiting states, errors and generated replies use English. Provider names and the model picker are not shown in the chatbot. Error codes remain available for diagnostics, while public messages omit model names and configuration keys. This presentation change does not replace the backend provider or fix a provider connection failure; `GEMINI_CHATBOX_API_KEY` remains a server/worker setting.

## Sử dụng

Trong dự án, nhấn **AI Chatbot** trên thanh công cụ để mở panel bên phải. Nút đóng hoặc Escape thu gọn panel. Mỗi lần mở/chuyển dự án panel mặc định đóng. Đóng/mở trong cùng dự án giữ hội thoại và bản nháp; refresh tải lại hội thoại đã lưu, không lưu bản nháp xuống localStorage.

COV chào bằng tiếng Việt theo file/màn hình đang xem. Chuyển file hoặc tab chỉ cập nhật ngữ cảnh UI, không gọi Gemini. Mỗi lần gửi chụp activity, snapshot và các ID đang được xem; reply hiển thị nguồn/context đã dùng. Retry từ tin nhắn trong phiên hiện tại giữ màn hình, snapshot, model và attachments của lượt cũ; nếu workspace đã đổi revision sau reply thì backend yêu cầu gửi câu hỏi mới. Retry một tin lịch sử tải lại dùng context hiện tại vì các tin cũ chưa lưu metadata màn hình.

## Context được cung cấp

| Màn hình | Dữ liệu |
| --- | --- |
| Mọi màn hình trong dự án | Product guide CovAI v1, project/snapshot, danh sách tối đa 80 entry ở thư mục gốc, package.json nếu có, saved coverage, lịch sử và memory theo cấu hình |
| Explorer | Nội dung đã lưu của file đang mở, path, hash, thời gian sửa; không yêu cầu attach thủ công |
| Unit/Integration/System Test | Run đang được UI hiển thị khi có ID, hoặc run mới nhất đúng snapshot/type; tối đa 8 failed scenario. Scenario đang inspect được dùng nếu thuộc execution run hiện tại |
| Overview | Các run mới nhất theo framework và phân tích kiến trúc đã lưu |
| Architecture | Phân tích kiến trúc đã lưu cho đúng snapshot |
| Jobs | Tối đa 8 job cùng snapshot; evaluation jobs chỉ dành cho owner |
| Settings | Metadata và cờ framework của dự án; không lấy account settings, credential hoặc form chưa lưu |
| Version Control | Tối đa 10 sự kiện thay đổi đã lưu; chưa lấy live Git status/diff |
| Trustworthiness | Owner nhận trạng thái tối đa 5 evaluation run; không gửi credential/environment hoặc chi tiết evidence |
| Logic Analysis | Tối đa 20 mục complexity đã lưu; chưa lấy graph selection |

Câu hỏi có đường dẫn file cụ thể cũng được truy xuất, tổng cộng tối đa 3 file/lượt, mỗi file tối đa 24 KB. Thiếu source, dữ liệu chưa phân tích hoặc phần bị cắt đều có cảnh báo. Nội dung chưa lưu trong editor không nằm trong context. Đây là truy xuất dữ liệu dự án theo câu hỏi, không phải huấn luyện Gemini để nhớ toàn repository.

Backend xác thực project/snapshot/run, kiểm tra đường dẫn trong workspace và loại credential/binary. Các token/secret theo mẫu phổ biến được che trong prompt, nội dung hội thoại và text attachment đã lưu; không coi đây là bảo đảm phát hiện mọi loại secret. Dữ liệu dự án và memory không được coi là system instruction.

## Cấu hình

Hội thoại tương tác dùng tối đa 1 lần gọi, timeout Gemini 20 giây (budget 22 giây), đầu ra tối đa 1.536 token; frontend ngừng chờ sau 35 giây nếu toàn bộ HTTP request bị kẹt. Không dùng chính sách retry tối đa 5 phút của tác vụ sinh mã. Tốc độ thực tế vẫn phụ thuộc model/provider và dữ liệu. Flash-Lite dùng thinking minimal, 3.8 Flash dùng low, 2.5 Flash dùng budget 0 theo [tài liệu thinking của Google](https://firebase.google.com/docs/ai-logic/thinking); không áp cấu hình này cho luồng sinh test.

Câu chào và câu hỏi cách sử dụng có context gọn; câu hỏi về code/kết quả vẫn lấy bằng chứng như bảng trên. Prompt yêu cầu trả lời trực tiếp bằng ngôn ngữ người dùng và giải thích thao tác thay vì lặp lời giới thiệu hay metadata. Gửi event realtime không chặn HTTP reply; enqueue memory chỉ được chờ tối đa 1 giây, sau đó tiếp tục nền. Lỗi timeout, model chưa khả dụng và lỗi quyền key được phân biệt.

Thêm vào môi trường **backend và worker**:

```dotenv
GEMINI_CHATBOX_API_KEY=<key riêng>
GEMINI_CHATBOX_MODEL=gemini-2.5-flash
```

Không commit key thật. Model được chọn trong UI được ưu tiên hơn model mặc định của feature. Thiếu key trả `AI_KEY_NOT_CONFIGURED`; chatbox không fallback sang key chung hoặc key test, kể cả khi `GEMINI_REQUIRE_DEDICATED_KEYS=false`. Tác vụ tóm tắt/trích xuất memory thiết lập lại scope chatbox trong worker. Không cần migration database.

## Kiểm thử

Từ thư mục `server`:

```powershell
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand src/tests/chatWorkspaceContext.test.js src/tests/chatContextPrompt.test.js src/tests/chatMemoryMaintenance.test.js src/tests/aiContext.test.js src/tests/sharedChatAuthorization.test.js src/tests/geminiRouting.service.test.js
node --test src/tests/contextChatbot.browser.test.mjs
```

Từ thư mục `client`:

```powershell
node --test src/services/chatScreenContext.test.js
node node_modules/vite/bin/vite.js build
```

Browser test dùng API và phản hồi AI giả lập, không gửi request Gemini thật. Trên Windows dùng Edge đã cài; các nền tảng khác dùng Chromium của Playwright. Browser test kiểm tra panel đóng mặc định, lời chào package.json/Unit Test, giữ bản nháp khi thu gọn và khi provider lỗi, payload có request ID/context version, Escape và mobile không tràn chiều ngang.
