# Jest Unit Test

## Cơ chế hoạt động
1. **Test Runner**: Jest quét file có đuôi `.test.js` hoặc `.spec.js`.
2. **Test Suite**: `describe` nhóm các test case liên quan.
3. **Test Case**: `test` hoặc `it` chứa logic kiểm thử.
4. **Expectation**: `expect(value).toBe(expected)` so sánh kết quả thực tế với mong đợi.
5. **Mocking**: Jest giả lập module/hàm để cô lập code cần test.

## Cách kiểm tra Jest hoạt động
1. **Tạo file test**: Tạo file `[tên_file].test.js` chứa các test case.
2. **Chạy lệnh**: `npm test` trong thư mục `server`.
3. **Tương tác UI**:
   - Nhấn nút "Run Tests" trên thanh công cụ.
   - Nếu thiếu file test, hệ thống sẽ hiện popup "Missing Test Files".
   - Chọn "Generate Skeleton Tests" hoặc "Generate Full Tests" để AI tự tạo test.
4. **Quan sát kết quả**:
   - Terminal hiển thị danh sách test pass (xanh) hoặc fail (đỏ).
   - Nhấn "Analyze Coverage" để xem phần trăm code được bao phủ.
