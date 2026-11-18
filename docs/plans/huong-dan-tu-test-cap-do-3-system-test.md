# Kế hoạch & Hướng dẫn tự kiểm tra Cấp độ 3 (Màn hình `System Test`)

> **Mục đích tài liệu:** Giải thích bằng tiếng Việt đời thường cách tính năng kiểm tra toàn bộ trang web từ đầu đến cuối (trên màn hình **`System Test`**) đang hoạt động như thế nào, giúp bạn tự kiểm tra đúng luồng thực tế.

---

## 1. Tính năng này dùng để làm gì?

Nếu Cấp độ 1 kiểm tra từng bộ phận lẻ, Cấp độ 2 kiểm tra các đầu mối nhận/trả dữ liệu, thì Cấp độ 3 đóng vai **một người dùng thật mở trình duyệt lên bấm từng nút trên trang web của bạn** (từ lúc gõ ô nhập, bấm nút Lưu, gọi qua máy chủ thật, lưu vào kho dữ liệu thật, cho tới lúc hiện kết quả lên màn hình).

Tính năng này giúp bạn làm 5 việc:
1. **Kiểm tra xem app của bạn có tự bật chạy được không (`Check setup`):** Tự rà xem máy tính/máy chủ có thiếu gói gì không, cổng mạng, phần giao diện và phần máy chủ có khởi động lên được cùng lúc không.
2. **Tạo và duyệt kịch bản kiểm tra (`Scenarios`):** Nếu dự án chưa có kịch bản bấm thử, AI sẽ tự đọc các trang/luồng trong dự án để viết sẵn kịch bản; sau đó cho bạn xem lại **kết quả mong đợi** của từng kịch bản trước khi chạy.
3. **Xem trình duyệt chạy trực tiếp (`Live run`):** Khi bấm chạy, bạn xem được luồng từng bước đang bấm gì, hình chụp từng chặng và nhật ký chữ chạy trực tiếp.
4. **Đo kết quả tổng thể (`Results`):** Không chỉ xem đậu hay rớt, hệ thống còn chạy lặp lại để xem bài kiểm tra có ổn định hay bị lúc đậu lúc rớt, đo xem lúc bấm trên trình duyệt thì code giao diện & máy chủ được đi qua bao nhiêu %, và chấm điểm chất lượng.
5. **Lưu lịch sử phiên bản & Xuất báo cáo:** Có thể xem lại các bản test cũ (`Version history`), so sánh hoặc khôi phục bộ test, nhờ AI cải thiện chỗ còn thiếu, và xuất báo cáo (`Export report`).

---

## 2. Luồng hoạt động hiện tại (từng bước hệ thống đang làm)

### Bước 1: Kiểm tra ban đầu khi vừa vào màn hình `System Test`
- Nếu dự án đang trong quá trình giải nén/chuẩn bị file, màn hình hiện thông báo chờ chuẩn bị xong sẽ tự vào.
- Nếu dự án **chưa có file kịch bản kiểm tra nào**, màn hình hiện khung gọn ở giữa mời bạn bấm **`Generate tests`** để tạo bộ kiểm tra đầu tiên (hoặc bấm **`Check project setup`** / **`Run automatically`**).
- Nếu đã có file kiểm tra rồi, màn hình hiện đầy đủ thanh công cụ, 4 ô số liệu tóm tắt và 3 thẻ con: **`Scenarios`**, **`Live run`**, **`Results`**.

### Bước 2: Rà cấu hình bật ứng dụng (`Check setup`)
- Khi bấm **`Check setup`**:
  - Hệ thống tự dò cấu trúc dự án (dùng cổng nào, lệnh nào để bật phần giao diện, lệnh nào bật phần máy chủ, có cần biến môi trường hay kho dữ liệu gì không).
  - Nếu thiếu thông số (ví dụ mật khẩu mẫu hoặc lệnh khởi động), bạn điền hoặc lưu ngay trong bảng này. Nếu trạng thái báo đã sẵn sàng (`Ready`), bước chạy thật mới ổn định.

### Bước 3: Duyệt kịch bản & Xác nhận kết quả mong đợi ở thẻ `Scenarios`
- Trong thẻ **`Scenarios`**:
  - Hệ thống quét toàn bộ các file kịch bản có sẵn để lập danh sách các bước người dùng sẽ bấm.
  - Có bộ lọc **`All`** (tất cả), **`Needs Review`** (chưa duyệt), **`Expected confirmed`** (đã xác nhận kết quả mong đợi), ô tìm kiếm và lọc theo nhóm file.
  - **Điểm rất quan trọng của luồng này:** Bạn bấm mở hoặc chỉnh **kết quả mong đợi** của từng kịch bản (hoặc bấm **`Confirm`** / **`Confirm All`**) để xác nhận với hệ thống rằng *"Đúng, bấm xong bước này thì trên màn hình phải ra kết quả như vậy"*.
  - Sau khi tích chọn các kịch bản và điều kiện sẵn sàng hiện màu xanh chữ **`Ready`**, nút **`Run Selected`** (hoặc nút **`Run System Test`** ở góc trên) mới bấm chạy được.
- *(Lưu ý tốc độ hiện tại)*: Mỗi lần bạn bấm chuyển qua lại từ thẻ `Live run` hoặc `Results` quay về thẻ `Scenarios`, màn hình tự quét đồng bộ lại danh sách từ máy chủ nên có thể mất vài giây chờ tải lại.

### Bước 4: Chạy trình duyệt thật & xem trực tiếp ở thẻ `Live run`
- Khi bạn bấm **`Run System Test`** (hoặc **`Run Selected`**):
  1. Nếu bật công tắc **`Desktop window`** thành **On**, máy tính sẽ mở cửa sổ trình duyệt nhìn thấy tận mắt thao tác chuột/gõ chữ chậm hơn để dễ quan sát; để **Off** thì trình duyệt chạy ẩn cho nhanh.
  2. Máy chủ dựng bản sao tạm dự án, cài đặt và bật song song phần máy chủ + giao diện của dự án lên, chờ cả hai phản hồi khỏe mạnh rồi mới bắt đầu cho trình duyệt chạy các kịch bản.
  3. Tại thẻ **`Live run`**, màn hình bên trái hiển thị khung hình chụp trực tiếp từ trình duyệt, bên phải hiện dòng sự kiện theo thời gian thực (`Event Stream`), kèm nút **`Stop Run`** để dừng ngang nếu cần.

### Bước 5: Xem đánh giá chi tiết, khoảng trống & báo cáo (`Results` và `Export report`)
- Khi chạy xong, bạn mở thẻ **`Results`** để xem:
  - Tỷ lệ chạy lại lặp nhiều lần ổn định hay chập chờn.
  - Mức độ code giao diện và code máy chủ đã đi qua được khi trình duyệt bấm qua các kịch bản.
  - Thư viện kịch bản kèm ảnh chụp lúc lỗi và nguyên nhân bước nào bị kẹt (kèm nút **`Open test`**, **`Edit Test`**, **`Breakpoint`**).
  - Danh sách các dòng code còn hổng chưa được kịch bản bấm tới (`Gap Insights`) để bấm vào mở đúng dòng code đó.
  - Nút **`AI improve tests`** nhờ AI tự viết thêm bước kiểm tra lấp chỗ trống, chạy kiểm chứng lại rồi mới cho bạn duyệt áp dụng.
  - *(Lưu ý giao diện cần để ý khi tự test)*: Nếu chưa có đợt đánh giá hoàn chỉnh nào mà chỉ có kết quả chạy cũ, khi mở thẻ **`Results`** màn hình hiện tại có thể hiển thị cùng lúc cả phần khung đánh giá mới lẫn khung danh sách kết quả cũ bên dưới.
- Bấm **`Export report`** ở thanh công cụ để chuyển sang trang báo cáo in ấn, xem biểu đồ kết quả và tải **PDF** hoặc file dữ liệu về máy.

---

## 3. Kế hoạch để bạn tự test tính năng này

### Kịch bản 1: Thử từ dự án trắng chưa có kịch bản (hoặc xóa/tạo mới)
- **Thao tác:** Mở dự án chưa có bài kiểm tra toàn hệ thống ➔ vào **`System Test`** ➔ bấm **`Check setup`** kiểm tra trạng thái sẵn sàng ➔ bấm **`Generate tests`** ➔ chọn đường dẫn trang cần test ➔ bấm tạo ➔ xem bản nháp xong bấm áp dụng.
- **Cần kiểm tra thấy gì mới là đúng:**
  - [ ] **`Check setup`** chỉ ra rõ dự án có tự nhận được cách bật phần giao diện/máy chủ không; nếu báo thiếu thì hướng dẫn rõ chỗ nào cần sửa.
  - [ ] Sau khi tạo và áp dụng xong, bảng **`Scenarios`** tự hiện ra các kịch bản vừa tạo, không bị kẹt ở màn hình trống mãi.

### Kịch bản 2: Duyệt kết quả mong đợi & kiểm tra điều kiện chạy
- **Thao tác:** Ở thẻ **`Scenarios`**, thử bỏ chọn/tích chọn vài kịch bản ➔ sửa thử dòng **kết quả mong đợi** của một dòng ➔ bấm **`Confirm`** (hoặc **`Confirm All`**) ➔ bấm mũi tên mở rộng một dòng để xem các bước bấm và điều kiện kiểm tra.
- **Cần kiểm tra thấy gì mới là đúng:**
  - [ ] Nếu còn kịch bản thiếu/chưa hợp lệ để chạy chung, thanh công cụ cảnh báo rõ lý do tại sao nút chạy bị khóa.
  - [ ] Sửa xong và xác nhận xong thì chuyển sang trạng thái đã xác nhận và nút **`Run Selected`** sáng lên cho bấm.
  - [ ] Bấm mở rộng dòng hiển thị rõ từng bước thao tác số thứ tự 1, 2, 3 và dữ liệu nhập vào dễ đọc.

### Kịch bản 3: Chạy thật & theo dõi `Live run`
- **Thao tác:** Bấm **`Run System Test`** (thử một lần tắt **`Desktop window`** và nếu cần nhìn trực tiếp trên máy thì bật thử một lần) ➔ xem thẻ **`Live run`**.
- **Cần kiểm tra thấy gì mới là đúng:**
  - [ ] Thấy nhật ký quá trình chuẩn bị (bật máy chủ/giao diện) hiện dần lên, không bị màn hình đen im lặng lâu mà không báo gì.
  - [ ] Khi bắt đầu bấm kịch bản, khung trình duyệt hiện hình ảnh màn hình ứng dụng đang chạy, thanh **`Event Stream`** bên phải nhảy từng bước.
  - [ ] Thử bấm **`Stop Run`** giữa chừng xem có hủy được tiến trình đang chạy hay không.

### Kịch bản 4: Kiểm tra kết quả (`Results`), xem lỗi chụp màn hình & xuất báo cáo
- **Thao tác:** Chờ một lượt chạy xong hoàn chỉnh ➔ vào thẻ **`Results`** ➔ bấm vào một kịch bản (nhất là kịch bản rớt nếu có) để xem ảnh chụp màn hình / bước bị lỗi ➔ mở thử **`Version history`** ➔ bấm **`Export report`** và tải thử **PDF**.
- **Cần kiểm tra thấy gì mới là đúng:**
  - [ ] 4 ô số liệu trên cùng hiển thị khớp với số bài đậu/rớt/thời gian thực tế (không bị lặp 2 dải thẻ giống nhau gây rối mắt).
  - [ ] Nếu mở kịch bản rớt, xem được dòng báo lỗi và ảnh chụp màn hình ngay lúc bị kẹt.
  - [ ] Trang **`Export report`** có đầy đủ nút **`Back to tests`**, **`Download PDF`**, **`Export JSON`**, **`Print view`** bấm được, file PDF tải về mở lên xem rõ ràng.
