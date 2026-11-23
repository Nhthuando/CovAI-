> COVAI đã có [adapter Chainlit native](./chainlit-native-adapter.md). Hướng dẫn HTTP bridge dưới đây là phương án tích hợp tùy chọn; không bắt buộc để đánh giá Chainlit native.

# Thêm cầu nối Chainlit → HTTP JSON cho COVAI

Hướng dẫn dành cho source `cookbook/custom-frontend` đã được kiểm tra. Thực hiện trong bản source gốc của ứng dụng rồi import snapshot mới vào COVAI. Đây là cầu nối dùng chung logic chatbot, không phải adapter WebSocket Chainlit tổng quát và không kiểm thử giao diện Chainlit.

Backend hiện có FastAPI trong `backend/app.py`, mount Chainlit tại `/chainlit`; phần gọi OpenAI nằm trong `backend/cl_app.py`. Chainlit hỗ trợ mount cùng FastAPI: [tài liệu chính thức](https://docs.chainlit.io/integrations/fastapi). Do vậy có thể thêm một route HTTP cạnh ứng dụng Chainlit.

Luồng sau khi nối:

```text
Chainlit UI → cl_app.py → chat_service.stream_answer()
COVAI → POST /covai/chat → chat_service.stream_answer() → { answer }
```

Cả hai dùng cùng model, tham số, system prompt và logic nghiệp vụ. Không viết một chatbot mới chỉ để trả lời benchmark, không trả chuỗi mẫu và không gọi trực tiếp callback phụ thuộc `cl.user_session` từ HTTP.

## 1. Tách phần gọi model dùng chung

Tạo `backend/chat_service.py`. **Chuyển nguyên** các import `os`/`AsyncOpenAI`, biến `client` và dict `settings` đang có trong `cl_app.py` sang đầu file mới. Giữ nguyên model/tham số đã được xác nhận chạy được của ứng dụng. Sau đó thêm:

```python
SYSTEM_PROMPT = "You are a helpful assistant."

async def stream_answer(messages):
    stream = await client.chat.completions.create(
        messages=messages,
        stream=True,
        **settings,
    )
    async for part in stream:
        if part.choices:
            token = part.choices[0].delta.content
            if token:
                yield token
```

`SYSTEM_PROMPT` trên trùng với prompt hiện có của source được kiểm tra. Nếu ứng dụng đã đổi prompt, RAG hoặc tool thì chuyển đúng logic hiện tại vào service chung, không dùng prompt mẫu thay thế. SDK trả các chunk khi stream; route HTTP sẽ gom chúng thành câu trả lời cuối. [OpenAI API reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

## 2. Cho Chainlit gọi service chung

Trong `backend/cl_app.py`, dùng phần sau sau khi đã chuyển `client/settings` sang service:

```python
import chainlit as cl
from chat_service import stream_answer, SYSTEM_PROMPT

@cl.on_chat_start
async def on_chat_start():
    cl.user_session.set("message_history", [
        {"role": "system", "content": SYSTEM_PROMPT}
    ])
    await cl.Message(content="Connected to Chainlit!").send()

@cl.on_message
async def on_message(message: cl.Message):
    history = cl.user_session.get("message_history")
    history.append({"role": "user", "content": message.content})
    reply = cl.Message(content="")
    await reply.send()
    async for token in stream_answer(history):
        await reply.stream_token(token)
    history.append({"role": "assistant", "content": reply.content})
    await reply.update()
```

Đây là phần tương ứng với callback hiện có của ví dụ này. Các callback/nghiệp vụ khác của ứng dụng thực tế phải được giữ và đưa vào service chung nếu chúng ảnh hưởng câu trả lời.

## 3. Thêm endpoint HTTP để COVAI gọi

Trong `backend/app.py`, giữ phần cấu hình FastAPI/Chainlit hiện có. Thêm các import và đoạn sau **sau `app = FastAPI()` và trước `mount_chainlit(...)`**:

```python
import os
from typing import Literal
from pydantic import BaseModel
from fastapi import HTTPException
from chat_service import stream_answer, SYSTEM_PROMPT

class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str

class ChatRequest(BaseModel):
    messages: list[Turn]

if os.getenv("COVAI_EVALUATION_MODE") == "1":
    @app.post("/covai/chat")
    async def covai_chat(body: ChatRequest):
        if not body.messages or len(body.messages) > 20:
            raise HTTPException(422, "Expected 1 to 20 messages")
        if any(len(turn.content) > 20000 for turn in body.messages):
            raise HTTPException(422, "Message exceeds the test limit")

        history = [{"role": "system", "content": SYSTEM_PROMPT}]
        history.extend(
            {"role": turn.role, "content": turn.content}
            for turn in body.messages
        )
        parts = []
        async for token in stream_answer(history):
            parts.append(token)
        answer = "".join(parts)
        if not answer.strip():
            raise HTTPException(502, "Chatbot returned an empty answer")
        return {"answer": answer}
```

Chỉ bật route này trong môi trường kiểm thử. Mỗi request mang toàn bộ lịch sử của case, nên không dùng chung một session toàn cục giữa những người dùng/case. System prompt thuộc backend, không nhận system prompt tùy ý từ client. Lỗi gọi model phải thành lỗi thực thi; không đổi thành câu trả lời mẫu để chạy qua benchmark.

## 4. Ghi dependency và kiểm tra local

COVAI cần `backend/requirements.txt`. Ghi các phiên bản đã kiểm chứng của `chainlit`, `fastapi`, `uvicorn`, `openai` và `python-dotenv` cùng dependency trực tiếp khác của backend. Có thể xem phiên bản môi trường đang chạy tốt bằng:

```powershell
python -m pip show chainlit fastapi uvicorn openai python-dotenv
```

Pin các phiên bản đó trong requirements; không nâng đồng loạt lên latest. Ví dụ này đang dùng `_authenticate_user`, một API nội bộ của Chainlit, nên phiên bản không tương thích có thể làm app lỗi trước khi endpoint được gọi.

Trong file `.env` của bản local, đặt `OPENAI_API_KEY` là key kiểm thử và `COVAI_EVALUATION_MODE=1`. Không commit file chứa key. Từ thư mục `backend`, chạy:

```powershell
python -m pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8000 --env-file .env
```

Ở terminal khác:

```powershell
$payload = @{
    messages = @(@{ role = "user"; content = "Xin chào, bạn hỗ trợ việc gì?" })
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post `
    -Uri "http://127.0.0.1:8000/covai/chat" `
    -ContentType "application/json; charset=utf-8" `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($payload))
```

Kết quả phải có `answer` không rỗng, được tạo từ chatbot thật. Kiểm tra thêm một request có nhiều lượt user/assistant để xác nhận lịch sử được sử dụng. Lời gọi này có sử dụng model/provider và có thể phát sinh phí theo tài khoản của bạn.

## 5. Import và đánh giá trong COVAI

1. Import bản source đã bổ sung cả backend/frontend; chọn snapshot mới trên màn hình đánh giá.
2. Trong cấu hình dự án COVAI, lưu `OPENAI_API_KEY` và `COVAI_EVALUATION_MODE=1`. Nếu backend có biến bắt buộc khác, cung cấp giá trị kiểm thử tương ứng.
3. Đây là key của **chatbot được kiểm tra**. Bốn key Gemini cấu hình cho các tính năng COVAI không tự thay thế OpenAI key trong ứng dụng này.
4. Bấm đánh giá. Discovery hiện có nhận route `@app.post("/covai/chat")`, chạy FastAPI trong sandbox, gửi JSON có `messages` và đọc `answer`; không cần sửa adapter HTTP JSON của COVAI cho cầu nối này.
5. Kiểm tra readiness, transcript, kết quả và độ đầy đủ. Thiếu tài liệu/ground truth hoặc chưa bật semantic evaluator vẫn có thể cho kết luận `INCOMPLETE` dù endpoint đã chạy.

Phạm vi kết quả là logic trả lời dùng chung và phản hồi qua HTTP bridge. Chất lượng render UI, tốc độ stream token, handshake WebSocket, cookie/session/auth riêng của Chainlit cần bài kiểm thử riêng hoặc adapter Chainlit native trong COVAI. Hướng dẫn này chưa chứng minh các phần đó đã hoạt động và chưa tự thay đổi source của ứng dụng import.
