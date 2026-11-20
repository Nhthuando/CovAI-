# Kế hoạch & Hướng dẫn tự kiểm tra Cấp độ 2 (Màn hình `Integration Test`)

> **Mục đích tài liệu:** Giải thích bằng tiếng Việt đời thường cách tính năng kiểm tra sự kết nối giữa các phần (trên màn hình **`Integration Test`**) đang hoạt động như thế nào, để bạn tự bấm kiểm tra từ đầu đến cuối.

---

## 1. Tính năng này dùng để làm gì?

Nếu Cấp độ 1 chỉ kiểm tra từng bộ phận rời rạc, thì Cấp độ 2 kiểm tra xem **khi các bộ phận nối với nhau qua các đường dẫn xử lý yêu cầu (như thêm, sửa, xóa, lấy dữ liệu...)** chúng có nói chuyện khớp với nhau không.

Cụ thể, tính năng này giúp bạn:
1. **Tự quét dự án để tìm danh sách các đầu mối xử lý:** Xem phần máy chủ của dự án đang mở ra bao nhiêu chức năng (ví dụ: lấy danh sách học sinh, tạo lớp học, xóa tài khoản...).
2. **Kiểm tra xem đầu mối nào đã có bài kiểm tra, đầu mối nào chưa:** Chia rõ từng nhóm tình huống cho mỗi đầu mối (như chạy đúng, nhập sai dữ liệu, chưa đăng nhập/không đủ quyền, không tìm thấy dữ liệu...).
3. **Nhờ AI tự viết bộ kiểm tra kết nối:** AI viết sẵn các tình huống kiểm tra cho các đầu mối còn trống.
4. **Chạy thử toàn bộ hoặc chọn chạy lẻ từng đầu mối** và xem chi tiết nguyên nhân nếu rớt (rớt do sai đường dẫn, rớt do bị chặn quyền, hay rớt do lỗi xử lý bên trong).
5. **Xem báo cáo tổng hợp và tải về bản tài liệu gọn đẹp** (dạng PDF để đọc/nộp và file dữ liệu thô để lưu).

---

## 2. Luồng hoạt động hiện tại (từng bước hệ thống đang làm)

### Bước 1: Quét và gom dữ liệu hiển thị ở màn hình chính
- Khi bạn bấm vào tab **`Integration Test`**, hệ thống tải dữ liệu không gian làm việc của dự án:
  - Đọc mã nguồn phần máy chủ để liệt kê tất cả các đầu mối xử lý hiện có.
  - Quét các file kiểm tra kết nối sẵn có trong dự án (nếu có) rồi ghép xem bài kiểm tra nào đang kiểm tra đầu mối nào.
  - Tính ra 4 con số chính ở dải trên cùng:
    1. Tỷ lệ đầu mối đã được phủ kiểm tra.
    2. Số đầu mối đã phát hiện được (và bao nhiêu đầu mối còn trống).
    3. Số tình huống kiểm tra đã đậu / tổng số đã chạy.
    4. Tình trạng chung và thời gian chạy gần nhất.
- *(Lưu ý thực tế hiện tại)*: Hệ thống đang có bộ nhớ tạm giữ kết quả màn hình trong **15 giây**. Nếu vừa có thao tác thay đổi ở chỗ khác chưa kịp xóa bộ nhớ tạm này, mở lại ngay có thể thấy số liệu cũ trong tối đa 15 giây trước khi cập nhật mới.

### Bước 2: Dùng màn hình thiết lập thông minh (`Test Setup`) hoặc tự tạo bài kiểm tra (`AI Gen`)
- Nếu dự án chưa có bài kiểm tra kết nối nào (hoặc còn thiếu nhiều):
  - Bấm **`Test Setup`** để hệ thống kiểm tra thư viện cần thiết, gợi ý cài đặt nếu thiếu và sinh bộ kiểm tra bao phủ các đầu mối.
  - Hoặc tại từng dòng trong bảng **`Endpoints Matrix`**, bạn bấm nút **`AI Gen`** (hoặc nút thêm/tạo tình huống ở những đầu mối còn thiếu) để nhờ AI viết riêng cho đầu mối đó.
- Bài mới tạo ra được lưu ở trạng thái chờ duyệt/chờ áp dụng để bạn kiểm tra lại nội dung code trước khi đưa vào thư mục thật của dự án.

### Bước 3: Duyệt, chỉnh sửa và áp dụng bài kiểm tra vào dự án
- Khi có bài kiểm tra mới do AI tạo:
  - Bạn có thể mở trình xem/sửa để đổi nội dung từng tình huống nếu muốn.
  - Bấm áp dụng (`Apply`): hệ thống sẽ ghi file kiểm tra vào dự án (chỉ ghi nếu bạn chọn đồng ý), đồng thời có tùy chọn tự chạy lại ngay sau khi lưu.
  - *(Lưu ý nếu bạn mở trang quá 15 phút)*: Nút **`Approve`** (duyệt) trên màn hình này hiện đang gọi máy chủ theo cách cũ, chưa tự làm mới phiên đăng nhập khi hết hạn 15 phút, nên nếu để màn hình lâu không thao tác có thể bị báo lỗi chưa đăng nhập khi bấm duyệt.

### Bước 4: Chạy kiểm tra kết nối (`Run Coverage`) & soi lỗi
- Khi bấm **`Run Coverage`** (hoặc bấm chạy riêng các dòng bạn tích chọn):
  1. Yêu cầu được đưa vào **`Job Queue`** (hàng đợi chạy ngầm), thanh tiến độ trực tiếp hiện lên để theo dõi từng giai đoạn.
  2. Máy chủ chạy các bài kiểm tra bằng công cụ kiểm tra máy chủ của dự án, ghi nhận kết quả đậu/rớt, thời gian phản hồi của từng đầu mối và thu lại mức độ đi qua từng dòng code.
  3. Nếu có bài rớt, hệ thống phân tích thông báo lỗi để gắn nhãn cho bạn biết lỗi nằm ở tầng nào (sai đường dẫn, bị chặn đăng nhập/quyền, lỗi dữ liệu đầu vào, hay lỗi sập bên trong hàm xử lý).

### Bước 5: Xem & tải báo cáo ở thẻ `Executive Report`
- Chuyển sang thẻ **`Executive Report`** để xem bảng tổng hợp mức độ kiểm tra từng đầu mối, các tình huống còn thiếu và nút bấm tạo nhanh tình huống bù đắp.
- Khi bấm xuất báo cáo (**PDF** hoặc tải file dữ liệu): máy chủ tạo file PDF có dàn trang bảng biểu chuẩn (không phải ảnh chụp màn hình) và file dữ liệu tổng hợp để tải về máy bạn.

---

## 3. Kế hoạch để bạn tự test tính năng này

### Kịch bản 1: Kiểm tra quét đầu mối & hiển thị danh sách
- **Thao tác:** Mở dự án có code máy chủ ➔ chọn tab **`Integration Test`** ➔ đợi tải xong thẻ **`Endpoints Matrix`**.
- **Cần kiểm tra thấy gì mới là đúng:**
  - [ ] Danh sách liệt kê đúng các đầu mối (ví dụ lấy danh sách, thêm, sửa, xóa...) kèm tên hàm xử lý và vị trí file/dòng tương ứng.
  - [ ] Thanh 4 ô phía trên hiển thị đúng số lượng tổng đầu mối và số đầu mối chưa được phủ.
  - [ ] Bấm mở rộng từng dòng đầu mối thấy được các bài kiểm tra gắn vào nó và các nhóm tình huống còn thiếu.

### Kịch bản 2: Tạo bài kiểm tra cho đầu mối còn thiếu & áp dụng
- **Thao tác:** Chọn một đầu mối còn thiếu (hoặc bấm **`Test Setup`** / **`AI Gen`**) ➔ xem lại đoạn code AI gợi ý ➔ bấm áp dụng vào dự án.
- **Cần kiểm tra thấy gì mới là đúng:**
  - [ ] AI sinh ra đủ tình huống tương ứng với phần còn thiếu của đầu mối đó.
  - [ ] Áp dụng xong kiểm tra thấy file kiểm tra xuất hiện đúng thư mục dự án, danh sách ở màn hình cập nhật lại trạng thái.
  - [ ] Trong quá trình làm mới không bị kẹt hiển thị số cũ quá lâu (nếu thấy bấm cập nhật mà giao diện không đổi trong 15 giây đầu, bấm tải lại trang lần nữa để kiểm chứng xem có dính bộ nhớ tạm 15 giây không).

### Kịch bản 3: Chạy kiểm tra & theo dõi tiến trình + xem lỗi
- **Thao tác:** Bấm **`Run Coverage`** (hoặc tích chọn vài đầu mối rồi bấm chạy nhóm) ➔ mở **`Job Queue`** xem tiến trình ➔ đợi chạy xong.
- **Cần kiểm tra thấy gì mới là đúng:**
  - [ ] Khi đang chạy, thấy tiến trình nhích % và bộ đếm thời gian chạy đều; giao diện không bị giật lag nặng khi gõ tìm kiếm hoặc cuộn bảng.
  - [ ] Chạy xong thấy trạng thái từng dòng đổi sang đậu (xanh dịu) hoặc rớt (đỏ dịu), kèm số lượng bài đậu/tổng và thời gian xử lý.
  - [ ] Nếu cố tình làm sai một bài test để cho rớt, kiểm tra xem ở báo cáo có phân loại được nguyên nhân rớt hợp lý không.

### Kịch bản 4: Kiểm tra thẻ `Executive Report` & xuất file PDF / dữ liệu
- **Thao tác:** Bấm qua thẻ **`Executive Report`** ➔ cuộn xem toàn bộ danh sách từng đầu mối ➔ bấm nút xuất báo cáo **PDF** và nút tải file dữ liệu (**`Export JSON`**).
- **Cần kiểm tra thấy gì mới là đúng:**
  - [ ] Bảng từng đầu mối hiển thị rõ bao nhiêu nhóm tình huống đã đạt / tổng nhóm cần có.
  - [ ] File PDF tải về mở lên chữ nét, không bị vỡ/cắt chữ, không phải ảnh chụp màn hình mờ, trình bày bảng biểu rõ ràng.
  - [ ] File dữ liệu tải về mở được bình thường, khớp số liệu đang thấy trên màn hình.
