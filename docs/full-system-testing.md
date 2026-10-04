# Chạy System test với backend và database thật

Chọn **Toàn hệ thống · API + DB thật** tại System Test. CovAI tạo database Docker riêng, khởi tạo schema, mở backend/frontend ở cổng riêng, chạy Playwright và dọn các tiến trình/container do lần chạy tạo ra. Test có API mock sẽ bị từ chối; không tự chuyển sang chế độ giao diện.

Snapshot cần `.covai/system-test.json`:

```json
{
  "database": {"engine": "mysql", "initSql": ".covai/system-test.sql"},
  "backend": {"directory": "server", "healthPath": "/api/todos"},
  "frontend": {"directory": "client"}
}
```

Hỗ trợ Node/npm, Playwright ESM, MySQL 8.4 và PostgreSQL 17. Backend nhận `DATABASE_URL` và `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` của database test. SQL chỉ chạy trên database mới. Các thư mục và SQL phải nằm trong snapshot. Backend cần script `dev` hoặc `start`; frontend Vite cần script `dev`. Chưa hỗ trợ tự suy đoán migration hoặc database của mọi framework.

System Test chỉ có chế độ toàn hệ thống và dùng Playwright. Tests nằm trong `tests/system`; các kết quả frontend/mock cũ vẫn được giữ như lịch sử. API `/api/**` trong browser được chuyển tới backend test thật để tránh cổng backend cố định trong repo. API ngoài prefix này cần frontend dùng `VITE_API_URL` hoặc `VITE_API_BASE_URL`.

Gemini đọc source mới từ snapshot, gồm component, route/controller, package script và schema (không dùng context cache cũ hay cắt 200 dòng đầu). Ngữ cảnh có giới hạn 320.000 ký tự, bỏ dependency/artifact, symlink và file `.env`; file bị bỏ vì giới hạn được ghi vào metadata. Browser quan sát title, cấu trúc accessibility, control và API path/status khi hệ thống thật chạy. Gemini trả JSON theo schema; test phải có assertion, không mock, skip/fixme/only hoặc assertion hằng số.

Sau lỗi chạy, Gemini được tối đa hai lần repair bằng các đoạn thay thế chính xác; không được thay import, declaration scenario hoặc assertion. Mỗi lần verify có database mới. Code phải PASS thêm một lần trên database mới thứ hai trước khi lưu VERIFIED. Source được đọc và so sánh hash sau verify; nếu snapshot thay đổi giữa chừng phải generate lại. Test không đạt không ghi vào suite và không xóa generation đã đạt trước đó. Không cho lưu thủ công candidate lỗi thành VERIFIED. PASS chỉ xác nhận các scenario/assertion được chạy, không chứng minh mọi nghiệp vụ đã được bao phủ hay mọi repo đều được hỗ trợ.

Mỗi scenario Playwright lưu screenshot khi chạy xong (kể cả thất bại), dùng ảnh lần thử cuối; test có thể attach PNG tên `evidence` để chọn trạng thái quan trọng trước khi dọn dữ liệu. Kết quả lưu chế độ chạy và ảnh theo từng scenario. Web tải ảnh qua endpoint có xác thực và kiểm tra chủ snapshot; bấm ảnh để mở lớn, Escape để đóng. Các kết quả cũ không có ảnh vẫn xem được.

Ảnh và artifact được lưu trong snapshot `.covai-system-test/`; chưa có chính sách tự xóa theo thời gian. Trace chỉ giữ khi test thất bại. System Test không cho chọn Cypress/frontend/mock qua API công khai.

Tham khảo: [Playwright screenshots](https://playwright.dev/docs/test-use-options), [attachments](https://playwright.dev/docs/api/class-testinfo#test-info-attach).

## Kiểm chứng todoapp ngày 04/10/2026

Browser đã chạy chế độ `full` trên snapshot `cmutfh1uo0001co7k8lgrfm6y`: 2/2 scenario PASS, 0 flaky. Scenario thứ nhất đọc trạng thái rỗng từ MySQL mới; scenario thứ hai thêm, sửa, hoàn thành và xóa task, tải lại trang sau các thay đổi để xác nhận persistence. Hai ảnh đã tải qua endpoint xác thực; ảnh CRUD chụp task hoàn thành trước khi xóa. Kết quả/ảnh vẫn xem được sau reload, modal mở/đóng bằng Escape hoạt động. Không còn container có label `covai.system-test=true` sau lượt chạy.

Sau cải tiến generation/repair, Gemini đã tự sinh scenario CRUD, tự sửa hai lần theo lỗi locator, vượt hai lần xác minh độc lập và được lưu tự động vào `tests/system/ai-generated.spec.js`, không chỉnh tay code sinh ra. Browser tự chạy suite gồm test sinh mới và hai regression scenario: **3/3 PASS, 0 flaky**, ba ảnh tải được. UI System Tests, tên regression scenario, toolbar và Evidence đều bằng tiếng Anh, không còn mode selector. Modal dùng native showModal, giữ focus, Escape đóng và trả focus về nút ảnh. Request frontend-only bị API từ chối với 400. Không còn container test sau kết thúc. Ảnh kiểm chứng mới: `temp/system-test-english-results.png` và `temp/system-test-english-1280.png`.
