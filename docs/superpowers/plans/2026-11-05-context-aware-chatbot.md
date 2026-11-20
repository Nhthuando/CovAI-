# Kế hoạch AI Chatbot theo ngữ cảnh cho CovAI

Ngày: 05/11/2026. Trạng thái: đã triển khai luồng chatbot theo ngữ cảnh. Cấu hình, kiểm thử và giới hạn dữ liệu từng màn hình được ghi trong `docs/context-aware-chatbot.md`; chưa xác minh bằng request Gemini thật.

## 1. Mục tiêu và hành vi

- Một trợ lý COV dùng xuyên suốt dự án, có khả năng hỗ trợ mã nguồn, kiến trúc, unit test, integration test, system test, coverage và các chức năng CovAI.
- Mỗi lần mở hoặc chuyển dự án, chatbot mặc định thu gọn. Chỉ hiển thị khi người dùng nhấn nút `AI Chatbot` trên thanh công cụ; nhấn lại hoặc nút đóng để thu gọn.
- Desktop: panel bên phải, có khung, chiều rộng giới hạn và thanh kéo kích thước. Mobile: drawer có nút đóng rõ ràng. Có trạng thái focus, nhãn truy cập và hỗ trợ bàn phím.
- Đóng/mở lại trong cùng dự án giữ hội thoại và bản nháp. Chuyển dự án phải tách session, bản nháp, context và request đang xử lý.
- Không gọi Gemini để tạo lời chào hoặc chỉ vì mở/đóng panel, chuyển tab, đổi file.
- Khi chuyển màn hình trong lúc chat, cập nhật nhãn ngữ cảnh ngay; không chèn lời chào liên tục vào lịch sử.

Lời chào hiển thị bằng UI khi chưa có trao đổi; với hội thoại cũ, hiển thị một dòng gợi ý theo màn hình thay vì sửa tin nhắn cũ:

| Ngữ cảnh | Nội dung |
| --- | --- |
| Explorer đang mở `package.json` | Bạn muốn tôi giúp gì với file `package.json`? |
| Explorer chưa chọn file | Bạn muốn tôi giúp gì với mã nguồn dự án? |
| Unit Test | Bạn muốn tôi giúp gì với Unit Test? |
| Integration Test | Bạn muốn tôi giúp gì với Integration Test? |
| System Test | Bạn muốn tôi giúp gì với System Test? |
| Overview | Bạn muốn tôi giúp gì với tổng quan chất lượng dự án? |
| Các màn hình còn lại | Bạn muốn tôi giúp gì với [tên màn hình]? |

## 2. Hiện trạng đã kiểm tra

- `client/src/components/dashboard/Layout.jsx`: đã có `aiPanelOpen=false`, nút toggle, panel có resize và `screenContext` chứa activity/testType/filePath. Cần kiểm tra và bảo đảm reset khi projectId đổi, không chỉ khi component mount.
- `client/src/components/dashboard/AIPanel.jsx`: đã có hội thoại, đính kèm, chọn model, lịch sử, bộ nhớ và review thay đổi; lời chào hiện là hằng tiếng Anh. Panel hiện render có điều kiện nên cần chủ động giữ state khi thu gọn.
- `server/src/services/chat.service.js`: đã ghép màn hình hiện tại, lịch sử, memory, snapshot, coverage và attachments vào prompt; có quota, chống gửi trùng và project guard.
- `server/src/services/chatContext.service.js`: đã lấy kết quả test theo loại màn hình nhưng hiện thiên về lần chạy mới nhất, chưa đủ context cho entity đang được chọn hoặc dữ liệu toàn hệ thống.
- Biết `filePath` chưa có nghĩa là đã đọc file: nội dung source hiện được lấy khi đính kèm `project_file`.
- `server/src/validators/aiContext.validation.js`: schema strict chỉ chấp nhận activity/testType/filePath; testType chỉ có unit/integration/system. Frontend đang tạo thêm unifiedSummary và overview; cần chuẩn hóa trước khi mở rộng.
- `server/src/services/geminiRouting.service.js`: có feature key riêng cho các luồng test/evaluation, chưa có chatbox. Chat và tác vụ bảo trì memory hiện cần được đưa vào scope chatbox.
- `ProjectSelectionPage.jsx` cũng dùng AIPanel cho portfolio; không được làm hỏng luồng không có projectId khi thay đổi component chung.

## 3. Kiến trúc đề xuất

Luồng: state màn hình → ScreenContext chuẩn hóa → context resolver backend → prompt có nguồn dữ liệu → Gemini → hội thoại hiện có.

### 3.1. Context màn hình có một hợp đồng thống nhất

Tạo helper/context provider nhỏ dùng chung, tránh tiếp tục nhét mọi logic vào AIPanel. Payload gồm:

- `activity`: explorer, coverage, overview, architecture, jobs, settings, version-control, trustworthiness... theo danh sách màn hình thực tế.
- `testType`: unit/integration/system; Overview dùng activity=overview, không dùng testType=overview.
- `filePath`: đường dẫn tương đối trong dự án khi có file đang xem.
- Các ID được chọn khi có: testRunId, scenarioId, jobId; mở rộng schema theo nhu cầu từng màn hình.
- `contextVersion`: phiên bản contract; projectId từ route và snapshotId từ request được backend xác thực.
- Selection/vùng code và bản nháp chưa lưu: giai đoạn sau, có giới hạn dung lượng và nhãn rõ ràng.

Backend xác minh mọi ID thuộc project/snapshot được phép truy cập. Không coi summary hay số liệu do client gửi là bằng chứng; backend tự đọc dữ liệu lưu. UI có thể hiển thị preview local nhưng dữ liệu gửi model phải được kiểm chứng.

### 3.2. Hai lớp kiến thức cho “AI tổng”

1. Kiến thức sản phẩm CovAI: hướng dẫn có phiên bản về tính năng, thuật ngữ, luồng sử dụng và giới hạn, dựa trên chức năng thực tế. Đây là kiến thức dùng chung, không chứa dữ liệu riêng của các dự án.
2. Kiến thức dự án đang mở: metadata, snapshot/revision, manifest và cây thư mục có giới hạn, kiến trúc đã phân tích, coverage, test/job đang xem, source liên quan, lịch sử và memory của đúng dự án.

“Hiểu toàn hệ thống” được thực hiện bằng truy xuất đúng dữ liệu theo câu hỏi; không gửi toàn repository trong mỗi lượt và không hứa AI biết những dữ liệu chưa tải hoặc chưa phân tích.

### 3.3. Context resolver theo màn hình

- Explorer: tự đọc file đang mở từ backend bằng cơ chế kiểm tra đường dẫn/quyền hiện có, không yêu cầu đính kèm thủ công. Kèm path, snapshot/revision và trạng thái nội dung. File lớn dùng đoạn liên quan và thông báo phần bị cắt.
- Unit/Integration/System Test: ưu tiên run/scenario người dùng đang xem; nếu không có selection mới lấy run mới nhất của đúng snapshot và test type. Kèm trạng thái chạy, thời gian, failed cases, coverage và nguồn liên quan trong budget.
- Overview: tổng hợp dữ liệu hiện có phía server; phân biệt không có dữ liệu với coverage bằng 0.
- Architecture: lấy kết quả phân tích đã lưu và nguồn liên quan; chưa có thì báo chưa phân tích.
- Jobs/Version Control/Settings/Trustworthiness: context adapter riêng theo quyền truy cập, chỉ đọc trường phù hợp, loại credential.
- Resolver lấy thêm file/tài liệu liên quan theo câu hỏi bằng truy xuất có giới hạn. Giai đoạn đầu có thể dùng đường dẫn, symbol và kết quả phân tích sẵn có; chưa cần vector database.
- Mỗi lượt chụp một context tại lúc gửi, đưa vào input hash chống gửi trùng. Retry cùng request dùng đúng context đã chụp; không lặng lẽ đổi file/run/revision dưới cùng request ID.
- Reply gắn nhãn context đã sử dụng. Nếu người dùng đổi màn hình khi đang chờ, reply vẫn thuộc màn hình lúc gửi; lượt sau dùng context mới.
- Hiển thị chip `Đang xem: package.json` / `Unit Test`, cùng danh sách nguồn và cảnh báo context thiếu/cũ trong phần preview hiện có.

### 3.4. Gemini dùng key riêng

```dotenv
GEMINI_CHATBOX_API_KEY=<cấu hình riêng trên backend>
```

- Thêm feature `chatbox` vào Gemini routing hiện có. Riêng feature này bắt buộc key chuyên biệt, không fallback sang key chung hoặc key test ngay cả khi chế độ migration của các tính năng khác còn bật.
- Scope bao phủ cả chat trả lời và worker tóm tắt/trích xuất memory; async worker phải thiết lập lại scope khi nhận job.
- Có thể thêm `GEMINI_CHATBOX_MODEL` theo convention hiện có; nếu giữ chọn model trong UI thì chỉ nhận model backend cho phép. Không chốt model mới trong kế hoạch này.
- Kiểm tra profile/instruction loader khi thêm feature mới để tránh giả định mọi feature đều có agent profile.
- Thiếu key trả `AI_KEY_NOT_CONFIGURED`; hết quota/lỗi provider hiển thị lỗi có thể thử lại, giữ nội dung nhập và dùng cơ chế retry hiện có.
- Cập nhật env example và `docs/gemini-feature-keys.md`; không ghi key thật vào source, frontend hoặc log.

### 3.5. Giới hạn và quyền hành động

- Giữ project guard, quota, session, lịch sử, memory, proposal và diff review hiện có; không tạo backend chat song song.
- Nội dung source, tài liệu, log và memory là dữ liệu, không được thay thế system instruction.
- Tự động loại file credential và che secret trong nội dung/log trước khi gửi hoặc lưu context; không chỉ dựa vào tên `.env`.
- Giới hạn tổng context theo model và request budget; ưu tiên câu hỏi hiện tại, file/run đang xem rồi dữ liệu liên quan. Công khai phần thiếu/cắt ngắn.
- Giai đoạn đầu trả lời và đề xuất; thao tác sửa file/chạy test phải đi qua luồng quyền và review hiện có.

## 4. Thứ tự triển khai

| Bước | Công việc | Điều kiện hoàn thành |
| --- | --- | --- |
| 1 | Chuẩn hóa schema/helper ScreenContext và chính sách reset theo project | Explorer, ba loại test, Overview gửi context hợp lệ; không rò context giữa dự án |
| 2 | Hoàn thiện nút AI Chatbot, khung panel, giữ state và lời chào | Mở dự án luôn đóng; người dùng bấm mới mở; đóng/mở không mất chat |
| 3 | Thêm feature/key chatbox và worker scope | Mọi model call thuộc chat và bảo trì memory dùng key chatbox; thiếu key báo đúng lỗi |
| 4 | Resolver tự đọc file, selected test run và preview nguồn | Hai ví dụ package.json/Unit Test hoạt động với dữ liệu thật |
| 5 | Mở rộng kiến thức sản phẩm và adapter các màn hình còn lại | Có bảng coverage màn hình; mỗi màn hình có context hoặc cảnh báo chưa hỗ trợ rõ ràng |
| 6 | Kiểm thử chấp nhận và hoàn thiện lỗi/mobile | Đạt các tình huống bên dưới, build/lint và kiểm thử liên quan thành công |

MVP gồm bước 1–4 và kiểm thử tương ứng; mục tiêu hoàn chỉnh bao gồm bước 5–6. Ước lượng sơ bộ: 5–8 ngày công, cần điều chỉnh sau khi kiểm tra chi tiết nguồn dữ liệu từng màn hình.

## 5. Kiểm thử và tiêu chí chấp nhận

1. Mở dự án, refresh, chuyển dự án: panel đóng, không có Gemini call tự phát.
2. Bấm AI Chatbot: mở đúng khung; đóng/mở giữ session và bản nháp cùng dự án.
3. Chọn package.json: lời chào đúng; hỏi “file này dùng để làm gì?” thì AI nhận được nội dung file thật và path đúng mà không attach thủ công.
4. Đổi file A sang B: lượt gửi mới dùng B; retry lượt A không biến thành context B.
5. Chuyển Unit Test: lời chào đúng; câu hỏi “test nào đang fail?” lấy đúng run đang xem. Không có run thì thông báo chưa có dữ liệu.
6. Integration/System/Overview đều vượt schema; số liệu AI dùng khớp nguồn backend.
7. Chuyển dự án lúc request đang chạy: phản hồi cũ không xuất hiện trong dự án mới; không đọc chéo file, run, memory hoặc session.
8. Chỉ cấu hình GEMINI_CHATBOX_API_KEY thì chat và worker memory hoạt động; key chung/key test không được dùng thay chatbox. Không gọi model thật trong test tự động.
9. Kiểm tra file quá lớn, file bị xóa, snapshot cũ, đường dẫn vượt root, credential trong file/log, mất mạng và hết quota.
10. Kiểm tra mobile, resize, focus/bàn phím và các luồng portfolio, attachment, review, shared chat hiện có.

Ưu tiên unit test cho contract/greeting/resolver/routing/input hash, integration test cho quyền và worker scope, UI/E2E cho hai ví dụ cốt lõi và đổi project giữa request. Chạy các bộ aiContext/sharedChatAuthorization/geminiRouting liên quan theo script hiện có; không cần chạy toàn bộ test của hệ thống cho thay đổi tài liệu kế hoạch.
