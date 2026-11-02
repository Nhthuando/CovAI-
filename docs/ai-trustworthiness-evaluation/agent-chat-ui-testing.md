# Kiểm thử agent-chat-ui và lưu cấu hình trong COVAI

## Vì sao có khung chat nhưng COVAI chưa chấm được?

Source `agent-chat-ui` được kiểm tra là giao diện Next.js của LangGraph. `README.md` ghi rõ giao diện kết nối tới LangGraph server. `src/providers/Stream.tsx` dùng `useStream` của `@langchain/langgraph-sdk/react`; `src/app/api/[..._path]/route.ts` gọi `initApiPassthrough` để chuyển tiếp tới `LANGGRAPH_API_URL`. File proxy này không phải agent tạo câu trả lời.

  Vì vậy, một repo chỉ có giao diện này chưa đủ để chạy AI độc lập. `GEMINI_API_KEY` đơn lẻ không cung cấp LangGraph server, graph definition, model node hay Assistant/Graph ID. COVAI hiện nhận diện trường hợp này thành `CHATBOT_BACKEND_REQUIRED`, thay vì nói chung rằng không có chatbot. Các lần chạy cũ giữ nguyên evidence; bấm đánh giá mới để nhận kết quả discovery mới.

## Kiểm tra chatbot thủ công

1. Lấy **source backend/graph thực tế** của ứng dụng. Khởi động backend theo README của backend, xác định Deployment URL và Assistant/Graph ID mà nó cung cấp. Repo giao diện được import không chứa lệnh để khởi động backend đó.
2. Tại bản local của `agent-chat-ui`, chạy:

   ```powershell
   pnpm install
   pnpm dev
   ```

3. Mở `http://localhost:3000`. Trong màn hình thiết lập của giao diện, điền Deployment URL và Assistant/Graph ID đúng của backend. LangSmith API key chỉ cần khi deployment yêu cầu xác thực; dùng môi trường và tài khoản kiểm thử.
4. Ví dụ **chỉ khi backend thực tế đang nghe cổng 2024 và graph có tên `agent`**: Deployment URL là `http://localhost:2024`, Graph ID là `agent`. Đây là ví dụ, không phải giá trị COVAI đã phát hiện hay bảo đảm có sẵn.
5. Gửi một câu có đáp án đã biết, rồi kiểm tra hội thoại nhiều lượt và xử lý câu hỏi không đủ thông tin. Nếu UI báo lỗi kết nối/auth/graph, xử lý backend trước khi coi chatbot đã sẵn sàng.

README của dự án cũng cho phép cấu hình trước bằng `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_ASSISTANT_ID` và tùy chọn `NEXT_PUBLIC_AUTH_SCHEME`. Chế độ proxy server sử dụng thêm `LANGGRAPH_API_URL` và `LANGSMITH_API_KEY`; cần cấu hình đúng topology mà ứng dụng sử dụng, không điền tất cả giá trị theo phỏng đoán.

## Chấm tự động trong COVAI

COVAI hiện chạy backend HTTP JSON bên trong sandbox của dự án import. Để chấm chatbot thực tế của ứng dụng này, cần import cả backend và adapter gọi đúng graph của ứng dụng. Contract hiện được hỗ trợ:

```http
POST /chat
Content-Type: application/json

{"messages":[{"role":"user","content":"Câu hỏi kiểm thử"}]}
```

```json
{"answer":"Câu trả lời thật từ agent của ứng dụng"}
```

Backend phải thực sự gọi graph/model của ứng dụng; trả chuỗi mẫu hoặc echo không phải kiểm chứng agent thật. Với LangGraph streaming/SSE và API threads/runs, cần adapter giao thức riêng. Bản hiện tại chưa tự biến giao diện LangGraph thành backend HTTP JSON, chưa tự dựng một graph bị thiếu và chưa chấm trực tiếp giao thức streaming này.

`localhost` trong browser local và `localhost` trong sandbox COVAI là hai môi trường khác nhau. Đặt `NEXT_PUBLIC_API_URL=http://localhost:2024` trong COVAI không làm backend trên máy người dùng xuất hiện bên trong sandbox; egress hiện cũng không cho kết nối tùy ý tới dịch vụ private. Ưu tiên import backend trong cùng dự án và dùng adapter nội bộ đúng contract.

## Cấu hình được lưu thế nào?

Trong COVAI, mở **Cấu hình bổ sung nếu chatbot cần**, thêm tên/giá trị biến và bấm **Lưu cấu hình**, hoặc bấm **Đánh giá chatbot** để vừa lưu vừa chạy. Snapshot, chatbot đã chọn, lựa chọn chấm ngữ nghĩa và biến môi trường được giữ theo project.

Sau khi gửi hoặc refresh, tên biến vẫn hiện; ô giá trị ghi **Đã lưu — để trống để giữ nguyên**. Giá trị được mã hóa ở backend, không trả lại qua API và không lưu trong localStorage/query cache. Nhập giá trị mới để thay; dùng **Xóa biến** rồi lưu để bỏ khỏi cấu hình các lần chạy sau. Xóa một lần đánh giá không xóa cấu hình dùng lại; xóa project sẽ xóa cấu hình. Cấu hình dùng cho một run đã tạo được đóng băng riêng để thay đổi sau đó không sửa evidence của run cũ.

Sau migration, cấu hình lần gửi gần nhất được chuyển sang bảng settings mà không giải mã ciphertext. Nếu lần gửi gần nhất không có biến nào, cần nhập lại các giá trị bạn muốn dùng. Các tab chỉnh sửa đồng thời được kiểm tra revision và không ghi đè âm thầm.
