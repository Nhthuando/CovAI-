# Ghi chú triển khai Unit Test v2

Ngày: 06/11/2026. Tham chiếu: [kế hoạch đã thống nhất](ke-hoach-unit-test-v2.md).

## Hành vi đã triển khai

| Luồng | Thay đổi |
| --- | --- |
| Analysis | Dùng bộ phân giải dependency có giới hạn; khôi phục cả khi đã có partial coverage. Phân biệt import nội bộ/alias/workspace package với gói registry. Cài đặt trong operation workspace, không ghi xuyên junction vào `node_modules` của bản gốc. |
| Dependency | Tôn trọng package manager và lockfile của dependency đã khai báo; ghép coverage provider với phiên bản Vitest đã cài. Không mặc định biến lỗi cài đặt/import thành RAM mock thành công. |
| Suggest | Chạy kiểm chứng bản nháp trong workspace riêng; trả trạng thái validation, coverage đo được và mức tăng so với baseline. Dùng gap còn thiếu để sinh bổ sung, tối đa 5 vòng, có ngân sách thời gian và dừng khi không tăng coverage. Không tự chứng nhận 100% dựa vào phần trăm lưu cũ hay phân loại infeasible. |
| Apply Full | Frontend gửi một batch thay vì lần lượt apply từng file. Chạy cả regression trong scope unit test; tách Jest/Vitest theo file. Đối chiếu đường dẫn đầy đủ, từ chối missing suite, zero tests, partial pass, skip mới, coverage không hợp lệ/thiếu và coverage giảm. |
| Env | Thiếu cấu hình bắt buộc trả `WAITING_FOR_ENV`; hộp thoại hỗ trợ Apply Full, apply theo file và apply một gợi ý. Resume giữ request/operation, không tạo thêm version. Bản nháp chờ env có thể khôi phục sau refresh. Giá trị nhập cho apply chỉ dùng trong operation; không đưa vào input manifest hay trả lại từ API env. |
| Version | Chỉ tạo một batch version sau kiểm chứng đầy đủ. Manifest và file test đi qua publisher/journal hiện có; coverage DB được stage tới transaction xuất bản. Request trùng và nội dung không đổi không tăng version. Đọc Active đi qua project guard và recovery trước khi mở manifest. |
| Chuyển version | Với lịch sử v2, phục hồi toàn bộ tập file của batch trong workspace nháp, chạy lại rồi mới đổi Active. Không xuất bản nếu test hoặc kiểm tra bất biến nguồn thất bại. Lịch sử cũ vẫn đọc được và được gắn nhãn chưa xác minh theo cơ chế batch. |
| Studio | Mặc định Test trái, Code phải; có vị trí liên kết Test → Code, highlight hiện tại và tích lũy, lời giải thích tiếng Việt, tua bước/reset, tự cuộn, chỉnh tỷ lệ hai khung và chi tiết kỹ thuật thu gọn. Layout dọc trên màn hình nhỏ. |
| Runtime replay | Ghi một ca hoặc cả suite trên Jest/Vitest; chèn sự kiện tại counter Istanbul trong bản sao, giữ vị trí nguồn JS/TS. Đối chiếu hit với coverage và report cùng lần capture; dùng tên test chuẩn hóa cho suite lồng nhau. Tách coverage ca hiện tại khỏi cộng dồn suite và tiến độ playback. |
| Tính trung thực | API lỗi không còn tự dựng source/test rồi báo pass. AST chỉ là `ILLUSTRATIVE`; bản ghi thật là `RECORDED`, có cờ đầy đủ/chưa đầy đủ. Cache bị vô hiệu khi source/test/import/config/revision thay đổi. Workspace ghi trace được dọn sau khi lưu artifact. |

Không tự thay đổi assertion, helper hoặc trạng thái skip của test cũ để ép pass. Không hạ coverage threshold của Vitest xuống 0. API lưu version thủ công trả `VERIFIED_BATCH_REQUIRED` thay vì cho client tự khai `APPLIED`.

## Các điểm tích hợp chính

- Backend: `unitTestPreflight.service.js`, `unitTestVerification.service.js`, `unitTestBatchRunner.service.js`, `unitTestDraftValidation.service.js`, `unitTestRuntimeTrace.service.js`, `unitTestVersionRollback.service.js` và các service/controller unit test hiện có.
- Frontend: `CoverageTypeDashboard.jsx`, `UnitTestEnvVarModal.jsx`, `InlineTestSuggestions.jsx`, `UnitTestBatchVersions.jsx`, `useUnitTestSimulation.js`, `UnitTestSimulationStudioModal.jsx`, `unitTestPlayback.js`.
- Operation/journal: tái sử dụng `withPreparedProjectWorkspace`, project publish guard và recovery; không thêm một hệ thống job song song.

## Kiểm chứng

Lượt regression chính: **15 suite, 240 test pass**. Các fixture runtime thực sự khởi chạy Jest/JavaScript, Vitest/JavaScript và Vitest/TypeScript. Bao gồm ca bình thường, throw được mong đợi, assertion thất bại, suite lồng nhau, coverage từng ca/cộng dồn, rewind và bất biến file nguồn.

Các kiểm tra lifecycle bổ sung xác nhận batch chỉ pass một phần không tạo version, file được phục hồi, thiếu env chưa tạo file/version, resume dùng lại operation, request trùng không xuất bản thêm và lỗi transaction kích hoạt recovery.

Lệnh chính chạy từ `server/`:

```powershell
node --experimental-vm-modules node_modules/jest/bin/jest.js src/tests/unitTestV2.test.js src/tests/unitTestPreparedPublication.test.js src/tests/unitTestVersionLifecycle.test.js src/tests/unitTestVersion.service.test.js src/tests/dependencyResolution.service.test.js src/tests/environmentEndpoints.test.js src/tests/simulationRoutes.test.js src/tests/unitTestSimulationEngine.test.js src/tests/unitTestSuggestion.service.test.js src/tests/unitTestGenerator.service.test.js src/tests/unitTestContextEngineering.service.test.js src/tests/unitTestWorkflow.e2e.test.js src/tests/e2eSimulationWorkflow.test.js src/tests/simulationFrontendContracts.test.js src/tests/simulationViewIntegrationContracts.test.js --runInBand --silent --forceExit
```

Client production build pass bằng `node node_modules/vite/bin/vite.js build` từ `client/`. Build còn cảnh báo bundle lớn/dynamic import đang có trong dự án. Lint toàn bộ các component đã sửa chưa sạch do các quy tắc/vi phạm cũ; kiểm tra không phát hiện biến chưa định nghĩa hoặc lỗi parse trong các file UI đã kiểm tra.

Đã kiểm tra Studio bằng Playwright + Edge headless với artifact thu từ fixture thật: hai Monaco editor render, cùng highlight trong bước gọi hàm, End đạt đúng tổng hit, Reset xóa coverage tương lai; kiểm tra cả viewport desktop và mobile. API trong preview được thay bằng artifact fixture, không phải nghiệm thu đăng nhập và DB thật.

## Giới hạn thực tế

- 100% là mục tiêu có số đếm kiểm chứng; không đảm bảo mọi dự án đều đạt. Nhánh bất khả thi vẫn nằm trong báo cáo gốc, không tự bỏ khỏi mẫu số.
- Recorder hiện theo dõi file nguồn được chọn và file test; dependency chạy theo cấu hình runner, nhưng chưa có điều hướng trace qua mọi file helper.
- Recorder hỗ trợ test tuần tự. `test.concurrent` bị từ chối rõ ràng để tránh gán nhầm hit giữa các test. Chưa khẳng định hỗ trợ đầy đủ mọi dạng test khai báo động/parameterized hoặc transformer đặc thù; thiếu bằng chứng sẽ hiện bản ghi chưa đầy đủ.
- Các event runtime hiện ghi vị trí/counter và trạng thái test; chưa thu tùy ý toàn bộ biến, input/return object hay từng matcher để tránh chạy lại biểu thức và lưu dữ liệu nhạy cảm.
- Pipeline apply vẫn dùng endpoint hiện có để chờ kết quả; operation/request đã có resume và idempotency. Chưa tách riêng một loại queue job mới cho Apply/Capture.
- Chưa chạy cài package qua registry thật hoặc kiểm thử transaction/crash với PostgreSQL thật trong lượt này. Dependency installer và transaction lifecycle được kiểm tra bằng test double; runner Jest/Vitest và playback dùng fixture thực.

Những giới hạn này không được UI chuyển thành kết quả pass/coverage đã xác minh.
