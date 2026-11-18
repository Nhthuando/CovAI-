# Kế hoạch & Hướng dẫn tự kiểm tra Cấp độ 1 (Màn hình `Unit Test`)

> **Mục đích tài liệu:** Giải thích bằng tiếng Việt đời thường cách tính năng kiểm tra từng hàm nhỏ (trên màn hình **`Unit Test`**) đang hoạt động từ lúc mở trang cho tới khi chạy xong, kèm danh sách các bước để bạn tự bấm thử và kiểm tra.

---

## 1. Tính năng này dùng để làm gì?

Hãy tưởng tượng dự án phần mềm của bạn là một chiếc xe máy, bên trong có rất nhiều bộ phận nhỏ (từng hàm xử lý như: tính tiền, kiểm tra mật khẩu, lọc danh sách...).

Tính năng cấp độ 1 này giúp bạn làm 4 việc chính:
1. **Đếm và đo:** Chạy toàn bộ các bài kiểm tra nhỏ sẵn có trong dự án, xem những hàm nào và dòng code nào đã được kiểm tra thử, chỗ nào còn bỏ sót chưa chạy tới lần nào.
2. **Chỉ ra chỗ hổng:** Liệt kê rõ từng file code, từng hàm đang bị thiếu kiểm tra, hoặc chỗ nào có điều kiện `nếu đúng / nếu sai` mà mới thử được một nửa.
3. **Nhờ AI viết bổ sung bài kiểm tra:** Khi thấy hàm nào còn thiếu, bạn có thể bấm nhờ AI viết thêm bài kiểm tra cho file đó.
4. **Xem trước rồi mới lưu:** Cho bạn xem phần code mới AI viết khác gì so với file cũ; nếu ưng ý mới bấm áp dụng vào file thật rồi chạy đo lại điểm.

---

## 2. Luồng hoạt động hiện tại (từng bước hệ thống đang làm)

### Bước 1: Mở màn hình & nhận diện công cụ của dự án
- Khi bạn chọn tab **`Unit Test`** ở thanh trên cùng, màn hình sẽ hỏi máy chủ xem dự án này đã có kết quả chạy kiểm tra trước đó chưa và đang dùng công cụ kiểm tra nào.
- Nếu dự án dùng công cụ phổ biến thứ nhất hoặc thứ hai (ví dụ hai bộ công cụ kiểm tra hàm lẻ thường gặp trên màn hình), hệ thống sẽ tự ghi nhận. Nếu dự án có thư viện chưa cài, hệ thống hiện thông báo gợi ý cài bổ sung.

### Bước 2: Chạy đo toàn bộ các hàm hiện có
- Khi bạn bấm nút chạy kiểm tra (nút **`Run`** / chạy kiểm tra ở góc trên hoặc ở bước 1 trong khung hướng dẫn 4 bước):
  1. Máy chủ đưa yêu cầu vào **hàng đợi chạy ngầm** để tránh làm đơ trang web.
  2. Hệ thống kiểm tra xem thư viện của dự án đã cài đủ chưa; nếu thiếu sẽ cài giúp.
  3. Hệ thống chạy toàn bộ các file kiểm tra nhỏ trong một thư mục tạm tách riêng, thu lại nhật ký quá trình chạy và đếm xem mỗi dòng code, mỗi nhánh đúng/sai, mỗi hàm được đi qua bao nhiêu lần.
  4. Tiến độ phần trăm được gửi liên tục về màn hình để bạn thấy thanh chạy nhảy số theo thời gian thực.
  5. Chạy xong, kết quả được lưu lại vào kho lưu trữ để lần sau mở lại vẫn còn.

### Bước 3: Xem kết quả đo trên 4 chỉ số & bảng truy vết
Sau khi chạy xong, màn hình hiển thị:
- **4 con số tổng quan:**
  1. Tỷ lệ **câu lệnh** đã chạy qua.
  2. Tỷ lệ **nhánh rẽ** (ví dụ câu điều kiện đúng/sai đã thử đủ cả 2 hướng chưa).
  3. Tỷ lệ **hàm** đã được gọi tới.
  4. Tỷ lệ **dòng** có thể chạy đã đi qua.
- **4 thẻ xem chi tiết bên dưới:**
  - Thẻ 1 (`Logic & Test Traceability`): Cho bạn mở từng file code ➔ mở từng hàm ➔ xem rõ hàm đó đã có bài kiểm tra nào chạy qua chưa, công thức tính % cụ thể ra sao, hay đang hổng ở dòng nào.
  - Thẻ 2 (`Function coverage`): Lọc danh sách các hàm (đã đủ 100%, mới một phần, hoặc chưa đụng tới).
  - Thẻ 3 (`Test Suites & Specs`): Danh sách các file kiểm tra đang có, file nào đậu, file nào rớt.
  - Thẻ 4 (`Execution Terminal & Logs`): Xem lại nhật ký chữ thô quá trình chạy kiểm tra trên máy chủ.

### Bước 4: Nhờ AI viết thêm bài kiểm tra & áp dụng vào file thật
Khi thấy một file hoặc hàm chưa đạt 100%:
1. Bạn bấm **`Suggest tests`** (hoặc bấm nút đề xuất ở khung hướng dẫn 4 bước).
2. Máy chủ đọc nội dung file code đó, tìm các dòng/nhánh còn hổng rồi gửi cho AI viết thêm các tình huống kiểm tra mới. Kết quả vẫn chỉ là **bản nháp tạm**, chưa đụng vào code thật của bạn.
3. Bạn có thể bấm **`Review Diff`** để đối chiếu hai bên xem file cũ và phần AI mới thêm khác nhau chỗ nào.
4. Khi bấm **`Apply Tests`**:
   - Hệ thống ghi đoạn kiểm tra mới vào file kiểm tra tạm, chạy thử lại ngay lập tức để kiểm tra xem bài mới có chạy qua không.
   - Nếu chạy bị lỗi (ví dụ thiếu một gói thư viện ngoài), màn hình sẽ hiện nút **`Install ... & Retry`** để bạn bấm cài tự động và chạy lại.
   - Nếu chạy thành công, số % trên 4 ô tổng quan sẽ tăng lên.

---

## 3. Kế hoạch để bạn tự test tính năng này

Hãy làm lần lượt theo các bước sau trên giao diện và đối chiếu xem hệ thống có bị kẹt ở đâu không:

### Kịch bản 1: Chạy đo lần đầu với dự án có sẵn bài kiểm tra
- **Thao tác:** Mở dự án ➔ chọn tab **`Unit Test`** ➔ bấm nút chạy kiểm tra (hoặc nút ở bước 1 trong khung hướng dẫn).
- **Cần kiểm tra thấy gì mới là đúng:**
  - [ ] Thấy tiến trình chạy cập nhật dần (không đứng im 0% mãi).
  - [ ] Nếu chạy thử thất bại vì thiếu thư viện, có thông báo rõ tên gói thiếu và nút cài đặt.
  - [ ] Khi chạy xong, 4 ô tổng quan hiện số % cụ thể, không bị trống trơn hay báo lỗi bất thường.
  - [ ] Chuyển sang thẻ `Execution Terminal & Logs` thấy được nhật ký quá trình chạy.

### Kịch bản 2: Soi chi tiết từng file và từng hàm
- **Thao tác:** Vào thẻ `Logic & Test Traceability` ➔ bấm mở một file bất kỳ ➔ bấm mở một hàm bên trong ➔ bấm thêm nút **`4-Metric Proof`** hoặc **`Open file`**.
- **Cần kiểm tra thấy gì mới là đúng:**
  - [ ] Mở file ra thấy danh sách các hàm và số % riêng của file đó.
  - [ ] Bấm **`4-Metric Proof`** mở hộp thoại hiện đủ 4 mục và đóng/chuyển thẻ con mượt, không bị che mờ khó đọc.
  - [ ] Bấm **`View Code`** hoặc **`Open file`** nhảy đúng tới vị trí file/hàm đó ở trình soạn thảo.
  - [ ] Thử gõ tên hàm vào ô tìm kiếm và bấm các nút lọc phía trên (`Happy Path`, `Boundary Value`, `Branch Toggling`, `Error`) xem danh sách có lọc đúng không.

### Kịch bản 3: Nhờ AI gợi ý, xem khác biệt và áp dụng
- **Thao tác:** Chọn một file chưa đạt 100% ➔ bấm **`Suggest tests`** ➔ chờ AI trả về ➔ bấm **`Review Diff`** ➔ bấm **`Apply Tests`**.
- **Cần kiểm tra thấy gì mới là đúng:**
  - [ ] Lúc đang tạo gợi ý có trạng thái quay vòng chờ, không bị bấm đúp liên tục.
  - [ ] **`Review Diff`** mở ra thấy rõ phần thêm mới so với file cũ.
  - [ ] Bấm **`Apply Tests`** xong hệ thống tự chạy lại, bài mới chạy được và điểm số % cập nhật lại đúng (hoặc nếu báo lỗi thiếu thư viện thì nút cài & thử lại hoạt động được).

### Kịch bản 4: Trường hợp dự án có file xử lý đặt tên lạ (điểm dễ lỗi cần chú ý)
- **Thao tác:** Nếu dự án có file nghiệp vụ tên kiểu `*.step.js` (hoặc mới đổi cấu trúc thư mục), hãy thử bấm **`Refresh`** và kiểm tra danh sách file.
- **Dấu hiệu lỗi cần ghi nhận lại:** Nếu file code nghiệp vụ biến mất khỏi danh sách cần đo, hoặc bấm làm mới mà số liệu không đổi, hãy ghi lại tên file đó để xử lý sau.
