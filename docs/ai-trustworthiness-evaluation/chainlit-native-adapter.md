# Đánh giá chatbot Chainlit trong dự án import

COVAI nhận diện và khởi động `@cl.on_message` trực tiếp hoặc ứng dụng FastAPI dùng `mount_chainlit(..., target="...py", path="...")`. Adapter kết nối Socket.IO tới ứng dụng trong sandbox, tạo phiên riêng cho từng case/lần lặp, gửi các turn trong cùng phiên và thu câu trả lời streaming đến `task_end`.

Không cần sửa chatbot để thêm HTTP bridge hoặc `COVAI_EVALUATION_MODE`. COVAI không thay thế mô hình của chatbot bằng mô hình của mình. Nếu code của chatbot sử dụng OpenAI/Gemini hoặc dịch vụ khác thì cần cấu hình kiểm thử tương ứng; chatbot tự chạy mô hình không mặc nhiên cần những key này.

## Thực hiện trên giao diện

1. Chọn dự án và snapshot ở **Đánh giá chatbot**.
2. Trong **Cấu hình bổ sung nếu chatbot cần**, cung cấp biến mà backend thực sự yêu cầu. Bấm **Lưu cấu hình**; lần sau giá trị được giữ dưới dạng mã hóa.
3. Bấm **Đánh giá chatbot** để tạo lượt mới. Lượt cũ báo `CHATBOT_PROTOCOL_UNSUPPORTED` vẫn là lịch sử, không tự chạy lại.
4. COVAI kiểm tra ứng dụng khởi động và trả lời được, sau đó chạy benchmark và trả kết quả/bằng chứng. Việc khởi động được chưa chứng minh chatbot đáng tin cậy.

### Ví dụ Chainlit cookbook/custom-frontend

- Backend nằm ở `backend/app.py`, mount callback `backend/cl_app.py` tại `/chainlit`.
- Adapter dùng route `/custom-auth` đã có trong ứng dụng để lấy cookie phiên; không thêm hoặc vượt qua cơ chế xác thực của target.
- `cl_app.py` đọc `os.environ["OPENAI_API_KEY"]`: chính chatbot này cần OpenAI key kiểm thử của người dùng. Key Gemini dùng chấm ngữ nghĩa của COVAI là cấu hình riêng.
- Nếu chưa cấp secret ký phiên `CHAINLIT_AUTH_SECRET`, COVAI sinh secret tạm riêng cho sandbox. Người dùng không phải tự tạo cờ hoặc secret này để bật đánh giá.

## Dependency và phạm vi hỗ trợ

Ưu tiên cài `requirements.txt` thuộc ứng dụng. Nếu ứng dụng Chainlit không có file này, COVAI thử runtime tương thích được quản lý (`chainlit==2.9.4`, `openai==1.109.1`, client Socket.IO `5.13.0`). Không viết thêm manifest vào source người dùng. Báo cáo ghi profile đã dùng và tiêu chí bắt buộc `runtime-dependency-fidelity = INSUFFICIENT_EVIDENCE`, nên chưa kết luận toàn hệ thống đạt.

Runtime tương thích không bảo đảm chạy mọi dự án Chainlit. Import/dependency không tương thích, xác thực tùy chỉnh ngoài `/custom-auth`, giao diện hỏi đáp tương tác (`ask`/`call_fn`) và trả lời thiếu liên kết sự kiện sẽ báo lỗi/thiếu bằng chứng. Không tính lời chào lúc kết nối thành câu trả lời benchmark. Không kết nối lại hoặc gửi lại turn đã dispatch sau timeout/disconnect.

Adapter chứng minh câu trả lời và phiên hội thoại quan sát được. Nó chưa xác minh toàn bộ tool/action nội bộ của chatbot. Sandbox giữ giới hạn mạng hiện có; mô hình/dịch vụ riêng cần chính sách egress phù hợp, không tự mở mạng host.

## Kiểm thử

Trong thư mục `server`:

```powershell
npm run test:evaluation
$env:RUN_CHATBOT_SANDBOX_TEST = 'true'
npm run test:evaluation:docker
```

Các fixture Chainlit thật kiểm tra CLI, FastAPI mount có cookie, streaming, lưu ngữ cảnh giữa turn, tách phiên giữa case và lỗi runtime không bị chấm như câu trả lời thành công. Fixture dùng callback xác định, không gọi mô hình thật và không chứng minh chất lượng một LLM.
