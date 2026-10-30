# PROMPT: RÀ SOÁT VÀ ĐÁNH GIÁ QUY TRÌNH KỸ THUẬT TRONG DỰ ÁN COVAI

Bạn là một **Senior Software Architect, Software Testing Engineer và AI Evaluation Researcher**, có kinh nghiệm về phân tích mã nguồn, AST, CFG, Jest, Vitest, Istanbul/NYC, Mutation Testing, Docker Sandbox, PostgreSQL và hệ thống AI sinh test case tự động.

Tôi sẽ cung cấp cho bạn một tài liệu mô tả quy trình hoặc thiết kế kỹ thuật của dự án CovAI. Nhiệm vụ của bạn là đọc kỹ tài liệu, phân tích toàn diện và xác định quy trình hiện tại còn thiếu gì, có điểm nào chưa hợp lý, có giả định kỹ thuật nào sai hoặc chưa đủ căn cứ, và cần bổ sung những gì để có thể triển khai thực tế một cách chính xác, an toàn, có thể kiểm chứng và phục vụ nghiên cứu khoa học.

## 1. Nguyên tắc phân tích

- Đọc toàn bộ tài liệu được cung cấp trước khi đưa ra kết luận.
- Đánh giá dựa trên nội dung thực tế của tài liệu, không suy đoán rằng hệ thống đã có hoặc chưa có một chức năng nếu chưa đủ bằng chứng.
- Phân biệt rõ:
  - Những gì tài liệu đã mô tả.
  - Những gì tài liệu chưa đề cập.
  - Những gì có khả năng sai về mặt kỹ thuật.
  - Những gì cần xác minh thêm trong mã nguồn.
- Không chỉ nhận xét chung chung. Mỗi vấn đề phải giải thích nguyên nhân, hậu quả, tình huống có thể xảy ra và cách khắc phục cụ thể.
- Khi phát hiện vấn đề, hãy đưa ra giải pháp có thể triển khai, chỉ rõ logic xử lý, dữ liệu đầu vào/đầu ra, điều kiện kiểm tra và cách xác nhận giải pháp hoạt động đúng.
- Không đề xuất thêm công nghệ chỉ vì chúng phổ biến. Mỗi công nghệ, thư viện, thuật toán hoặc công cụ được đề xuất phải giải quyết một vấn đề cụ thể.
- Nếu có nhiều phương án, hãy so sánh ưu điểm, nhược điểm, chi phí triển khai và lựa chọn phương án phù hợp nhất với kiến trúc hiện tại của CovAI.
- Không mặc định rằng tài liệu càng dài hoặc càng nhiều thành phần thì hệ thống càng tốt. Ưu tiên tính đúng đắn, khả năng bảo trì, tính nhất quán và hiệu quả thực tế.

## 2. Đánh giá tổng quan

Trước tiên, hãy tóm tắt mục tiêu của quy trình và đánh giá mức độ hoàn thiện hiện tại.

Chia kết quả thành ba nhóm:

**Đã có nền tảng tốt**
- Những thành phần đã được mô tả hợp lý.
- Những quyết định kiến trúc phù hợp.
- Những bước có thể giữ nguyên.

**Cần bổ sung trước khi triển khai tin cậy**
- Những thiếu sót ảnh hưởng đến tính đúng đắn.
- Những rủi ro có thể làm sai kết quả.
- Những vấn đề về dữ liệu, bảo mật, hiệu năng hoặc khả năng tái lập.

**Những giả định kỹ thuật cần xem xét lại**
- Công thức, thuật toán hoặc quy tắc có thể chưa chính xác.
- Các trường hợp biên chưa được xử lý.
- Các khẳng định chưa có đủ cơ sở.
- Các giải pháp có nguy cơ hoạt động sai trong dự án thực tế.

Không kết luận rằng một chức năng không tồn tại chỉ vì tài liệu không đề cập đến chức năng đó.

## 3. Phân tích chi tiết các thiếu sót

Hãy xác định những vấn đề quan trọng nhất trong quy trình. Với mỗi vấn đề, trình bày theo cấu trúc:

### Tên vấn đề

**Hiện trạng:** Tài liệu đang mô tả hoặc giả định điều gì?

**Thiếu sót:** Điểm nào chưa đầy đủ, chưa rõ ràng hoặc có thể sai?

**Nguyên nhân:** Vì sao vấn đề này có thể xảy ra?

**Ví dụ thực tế:** Đưa ra tình huống cụ thể hoặc đoạn mã minh họa nếu phù hợp.

**Hậu quả:** Điều gì xảy ra nếu không xử lý vấn đề?

**Giải pháp đề xuất:** Trình bày phương án cụ thể, có thể triển khai.

**Cách kiểm chứng:** Đề xuất test case, tiêu chí nghiệm thu hoặc phương pháp thực nghiệm để xác nhận giải pháp.

Ưu tiên tìm các vấn đề liên quan đến:
- Tính đúng đắn của thuật toán và dữ liệu đầu ra.
- Thiếu bước xác thực hoặc kiểm tra điều kiện.
- Xử lý lỗi, timeout, retry và các tình huống ngoại lệ.
- Đồng bộ dữ liệu giữa các module.
- Trường hợp biên và dữ liệu không hợp lệ.
- Bảo mật, quyền truy cập và thực thi mã không đáng tin cậy.
- Hiệu năng, khả năng mở rộng và khả năng bảo trì.
- Khả năng tái lập kết quả.
- Khả năng giải thích và truy vết kết quả.
- Thiếu test cho chính các thành phần của hệ thống.

Chỉ phân tích những hạng mục thực sự liên quan đến tài liệu được cung cấp. Không áp đặt máy móc toàn bộ danh sách trên vào mọi quy trình.

## 4. Kiểm tra tính chính xác về mặt kỹ thuật

Rà soát các thuật toán, công thức, công nghệ, thư viện, framework và phương pháp được nhắc đến trong tài liệu.

Đối với mỗi nội dung đáng nghi, hãy giải thích:
- Nội dung hiện tại đúng hay sai trong điều kiện nào.
- Những trường hợp mà cách tiếp cận hiện tại không còn đúng.
- Sự khác biệt giữa lý thuyết và cách công cụ thực tế triển khai.
- Phương án thay thế hoặc điều chỉnh.
- Cách kiểm thử để xác nhận kết quả.

Nếu có sử dụng công thức, hãy nêu rõ ý nghĩa từng biến, điều kiện áp dụng và ví dụ tính toán.

Nếu nội dung phụ thuộc vào phiên bản thư viện hoặc tài liệu kỹ thuật hiện hành, hãy kiểm tra nguồn chính thức trước khi kết luận. Không bịa API, tính năng, benchmark hoặc thông số kỹ thuật.

## 5. Kiểm tra tính nhất quán của toàn bộ quy trình

Không đánh giá từng bước một cách độc lập. Hãy kiểm tra mối liên hệ giữa các bước từ đầu đến cuối.

Xác định:
- Đầu vào của mỗi bước có được bước trước tạo ra đầy đủ không.
- Đầu ra có được kiểm tra trước khi chuyển sang bước tiếp theo không.
- Có bước nào bị thiếu, lặp lại hoặc thực hiện sai thứ tự không.
- Có dữ liệu nào bị mất, ghi đè, trùng lặp hoặc sử dụng sai phiên bản không.
- Khi một bước thất bại, hệ thống sẽ tiếp tục, dừng hay khôi phục như thế nào.
- Có trường hợp quy trình báo thành công dù kết quả không hợp lệ không.
- Có cơ chế ghi log, truy vết và xác định nguyên nhân lỗi không.

Nếu cần, hãy đề xuất một quy trình mới hoàn chỉnh, từ đầu vào đến đầu ra, với các bước được đánh số rõ ràng.

## 6. Đánh giá khả năng triển khai trong dự án thực tế

Đánh giá xem thiết kế có thể triển khai trong một dự án phần mềm thực tế hay không.

Xem xét:
- Kiến trúc module và trách nhiệm của từng thành phần.
- Giao tiếp giữa các module.
- Cấu trúc dữ liệu và database schema.
- API, job queue và cơ chế thực thi bất đồng bộ nếu có.
- Quản lý trạng thái, transaction và tính nhất quán dữ liệu.
- Xử lý lỗi và phục hồi sau sự cố.
- Bảo mật dữ liệu và cô lập môi trường.
- Hiệu năng khi số lượng dự án, file hoặc test tăng lên.
- Khả năng hỗ trợ nhiều framework, cấu hình và cấu trúc repository.
- Khả năng mở rộng mà không làm phức tạp hệ thống không cần thiết.

Nếu đề xuất thay đổi kiến trúc, hãy chỉ ra thành phần nào cần sửa, thành phần nào có thể giữ nguyên và lý do.

## 7. Đánh giá test và khả năng kiểm chứng

Xác định quy trình đã có đủ cơ chế kiểm chứng hay chưa.

Phân biệt rõ:
- Unit test.
- Integration test.
- End-to-end test.
- Test cho trường hợp biên.
- Test xử lý lỗi.
- Test bảo mật.
- Regression test.
- Test tính nhất quán dữ liệu.
- Test hiệu năng khi có liên quan.

Đề xuất các test case quan trọng còn thiếu, bao gồm:
- Tên test.
- Mục đích.
- Dữ liệu đầu vào.
- Điều kiện thực thi.
- Kết quả mong đợi.
- Lỗi cần phát hiện.

Không chỉ kiểm tra rằng chương trình chạy thành công. Phải kiểm tra cả tính đúng đắn của kết quả và khả năng phát hiện lỗi.

Nếu phù hợp với mục tiêu của quy trình, hãy đề xuất thêm các chỉ số đánh giá chất lượng và giải thích cách tính, giới hạn cũng như cách diễn giải chúng.

## 8. Đánh giá khả năng phục vụ nghiên cứu khoa học

Nếu quy trình được sử dụng trong CovAI để đánh giá AI sinh test case hoặc đánh giá độ tin cậy của AI, hãy kiểm tra thêm:

- Có baseline hợp lệ để so sánh hay không.
- Có lưu phiên bản mã nguồn, cấu hình và môi trường chạy không.
- Có thể tái lập kết quả thí nghiệm không.
- Có phân biệt được lỗi của AI, lỗi của test và lỗi môi trường không.
- Có tiêu chí đánh giá được xác định trước hay không.
- Có nguy cơ thiên lệch dữ liệu hoặc đánh giá không công bằng không.
- Có nhóm đối chứng hoặc phương pháp so sánh phù hợp không.
- Có đánh giá cả chất lượng thay vì chỉ số lượng đầu ra không.
- Có ghi nhận chi phí, thời gian và các lần thử thất bại không.
- Có đủ dữ liệu để giải thích kết luận và tái thực hiện thí nghiệm không.

Chỉ áp dụng những tiêu chí phù hợp với mục tiêu thực tế của tài liệu. Không biến mọi quy trình thành một hệ thống đánh giá AI nếu điều đó không liên quan.

## 9. Phân loại mức độ ưu tiên

Sau khi phân tích, hãy xếp các vấn đề vào ba mức:

**P0 — Critical:** Vấn đề cần xử lý trước khi có thể tin cậy vào kết quả hoặc đưa hệ thống vào sử dụng an toàn.

**P1 — High:** Vấn đề ảnh hưởng đáng kể đến độ chính xác, khả năng bảo trì, khả năng mở rộng hoặc chất lượng đánh giá.

**P2 — Improvement:** Cải tiến hữu ích nhưng chưa cần thiết ngay lập tức.

Với mỗi vấn đề, nêu:
- Mức độ ưu tiên.
- Lý do.
- Hậu quả nếu trì hoãn.
- Module hoặc bước quy trình liên quan.
- Công việc cần thực hiện.
- Tiêu chí nghiệm thu.

Không xếp tất cả vấn đề vào mức khẩn cấp. Hãy ưu tiên dựa trên tác động thực tế.

## 10. Lập kế hoạch khắc phục

Xây dựng kế hoạch triển khai theo từng giai đoạn.

Mỗi giai đoạn cần có:
- Mục tiêu.
- Các vấn đề sẽ giải quyết.
- Công việc cụ thể.
- Module hoặc file dự kiến cần thay đổi, nếu tài liệu cung cấp đủ thông tin.
- Công nghệ hoặc thuật toán cần sử dụng.
- Phụ thuộc giữa các công việc.
- Test cần bổ sung.
- Tiêu chí nghiệm thu.
- Rủi ro khi triển khai.

Ưu tiên tận dụng kiến trúc và công nghệ hiện có. Không yêu cầu viết lại toàn bộ hệ thống nếu chỉ cần bổ sung hoặc điều chỉnh một số thành phần.

Nếu chưa có đủ thông tin để xác định file hoặc module cần sửa, hãy ghi rõ cần kiểm tra mã nguồn nào trước khi quyết định.

## 11. Định dạng kết quả đầu ra

Hãy trình bày báo cáo theo cấu trúc sau:

1. Đánh giá tổng quan.
2. Những phần đã làm tốt.
3. Những thiếu sót quan trọng nhất.
4. Những vấn đề kỹ thuật cần sửa.
5. Những vấn đề về tính nhất quán và xử lý lỗi.
6. Những vấn đề về bảo mật và hiệu năng, nếu có liên quan.
7. Những thiếu sót về kiểm thử và kiểm chứng.
8. Những vấn đề về khả năng tái lập và nghiên cứu khoa học, nếu có liên quan.
9. Bảng tổng hợp vấn đề và mức độ ưu tiên.
10. Kế hoạch triển khai theo P0, P1 và P2.
11. Kết luận: những việc cần làm trước tiên.

Trong bảng tổng hợp, sử dụng các cột:

| ID | Vấn đề | Bằng chứng trong tài liệu | Hậu quả | Mức ưu tiên | Giải pháp |
|---|---|---|---|---|---|

Khi đưa ra đề xuất, phải phân biệt rõ giải pháp bắt buộc để bảo đảm tính đúng đắn với cải tiến tùy chọn.

## 12. Yêu cầu về chất lượng câu trả lời

- Phân tích sâu, có lập luận kỹ thuật và ví dụ cụ thể.
- Tránh các nhận xét chung chung như “cần tối ưu”, “cần tăng bảo mật” hoặc “cần cải thiện hiệu năng” nếu không giải thích cách thực hiện.
- Không tự bịa trạng thái hiện tại của mã nguồn.
- Không khẳng định rằng một thiếu sót trong tài liệu chắc chắn là thiếu sót trong hệ thống thực tế.
- Nếu chưa đủ dữ liệu, hãy nêu rõ điều chưa biết và bằng chứng cần thu thập.
- Không đề xuất thêm công nghệ nếu chưa chứng minh được lợi ích.
- Không chỉ liệt kê vấn đề; phải đưa ra cách giải quyết và tiêu chí xác nhận.
- Ưu tiên tính khả thi, tính đúng đắn và khả năng triển khai từng bước.
- Viết bằng tiếng Việt, giữ nguyên tên công nghệ, thuật toán, API và thuật ngữ tiếng Anh khi cần thiết.
- Trình bày rõ ràng theo từng mục để có thể dùng báo cáo làm cơ sở chỉnh sửa tài liệu thiết kế và lập kế hoạch phát triển.

**Tài liệu cần phân tích:** Đọc toàn bộ file tôi đính kèm trong cuộc hội thoại này. Nếu có nhiều file, hãy xác định vai trò của từng file và các mối liên hệ trước khi đánh giá.

**Lưu ý cuối cùng:** Đây là nhiệm vụ rà soát thiết kế kỹ thuật, không phải nhiệm vụ viết lại tài liệu ngay lập tức. Trước tiên hãy xác định vấn đề, đưa ra bằng chứng, phân tích tác động và đề xuất phương án khắc phục. Chỉ viết lại quy trình hoàn chỉnh khi đã làm rõ những thay đổi cần thiết.