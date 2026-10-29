# CovAI: hỗ trợ nhiều người trong một project

Ngày khảo sát: 27/10/2026. Trạng thái: báo cáo nghiên cứu và thiết kế đề xuất để review; chưa triển khai ứng dụng hay migration.

## 1. Kết luận dễ hiểu

CovAI hiện tổ chức theo mô hình **một project thuộc một người**. Muốn thêm thành viên đúng cách phải thay đổi cách xác định quyền trên toàn bộ dữ liệu project, chứ không chỉ thêm một danh sách email.

Phương án phù hợp nhất là giữ nguyên project/workspace, thêm thành viên và lời mời theo project. Source code, kết quả test, các cuộc chat và bộ nhớ AI trở thành tài nguyên chung; mỗi hành động vẫn biết người thực hiện. Khi hai người sửa cùng file, người lưu sau phải được báo xung đột và giữ bản nháp.

Không cần thay thuật toán tính coverage, CFG hay Cyclomatic Complexity chỉ vì có nhiều thành viên. Phần cần bổ sung nằm ở **phân quyền, điều phối tác vụ, kiểm soát phiên bản và đồng bộ giao diện**.

## 2. Những lựa chọn đã được bạn chốt

| Nội dung | Quyết định trong cuộc trao đổi |
|---|---|
| Mức cộng tác | Cùng xem, chạy test, dùng AI, sửa file; chống ghi đè |
| Vai trò | Owner / Editor / Viewer |
| Owner | Quản lý thành viên và thao tác quan trọng |
| Editor | Sửa file, chạy test, dùng AI |
| Viewer | Xem và xuất báo cáo |
| Cách tổ chức | Thành viên thuộc từng project; chưa thêm Team/Organization |
| Mời tham gia | Qua email, có màn hình nhận lời mời |
| Giao diện | Tận dụng workspace đang có; thiết kế trực tiếp trong Figma đã cung cấp |
| Chat và bộ nhớ AI | **Dùng chung toàn bộ cho thành viên project** |
| Cùng gõ theo thời gian thực | Ngoài phạm vi phiên bản này |

Các chi tiết như thời hạn lời mời 7 ngày, người trả quota, quyền hủy job và phạm vi thao tác Git dưới đây là **đề xuất mặc định**, chưa phải yêu cầu bạn đã duyệt riêng.

## 3. Phạm vi đọc và mức độ chắc chắn

Đã lập inventory cho **745 file văn bản, 141.807 dòng** trong `client/src`, `server/src`, `server/prisma`, `shared`, `docs`, loại trừ font, ảnh, PDF, SVG, draw.io và chính thư mục báo cáo nghiên cứu. Mỗi dòng inventory có SHA-256 để đối chiếu đúng trạng thái working tree lúc khảo sát.

| Khu vực | File | Dòng |
|---|---:|---:|
| Client | 145 | 55.109 |
| Server, tests, Prisma | 534 | 78.808 |
| Shared | 3 | 38 |
| Tài liệu văn bản | 63 | 7.852 |

**Inventory là quét cấu trúc toàn bộ, không phải bằng chứng đã đọc sâu từng dòng của 745 file.** Việc đọc sâu trong phiên này tập trung ở schema, entrypoint, API project/file/job, project scope, editor/layout, AI context/chat/memory, queue, snapshot lease, proposal apply, export, socket và một số test phân quyền. Một số file lớn được đọc từng phần và đối chiếu bằng tìm kiếm. Những file ngoài các đường này chưa được chứng nhận review từng dòng. Không tuyên bố đã hoàn thành yêu cầu tuyệt đối “không bỏ sót chi tiết nào”.

Đã đọc Git status và 5 commit gần nhất. Working tree có nhiều chỉnh sửa và file mới từ trước, đặc biệt system test. Kết luận dựa trên cả phần chưa commit hiện hữu; không reset, sửa hoặc đưa những thay đổi đó vào commit. Không đọc nội dung `.env` hay thông tin xác thực.

Inventory: `2026-10-27-project-collaboration-file-inventory.csv`. Cột `Level=structural-scan` thể hiện đúng mức chứng cứ của inventory; các cờ chỉ là kết quả tìm mẫu, không khẳng định có lỗi.

## 4. CovAI đang vận hành như thế nào

### 4.1. Cấu trúc sản phẩm và dữ liệu

- React SPA điều hướng từ `ProjectSelectionPage` vào `Layout` bằng `projectId` trong URL. Studio có activity bar, cây file, Monaco editor, dashboard và AI panel.
- Prisma `Project.ownerId` xác định chủ sở hữu. Chưa có bảng thành viên hoặc lời mời trong schema đã đọc.
- Project có nhiều snapshot; coverage, CFG, cyclomatic, test run, system assessment và AI test gắn với snapshot/project.
- `Job.userId` ghi người khởi tạo nhưng một số endpoint cũng dùng trường này làm quyền xem. Hai ý nghĩa này phải tách khi cộng tác.
- `ChatSession` hiện lọc theo `projectId + userId`. `ChatMessage` chưa có tác giả người dùng riêng; trước đây chủ session đủ đại diện cho người gửi.
- `AiContextSettings` đã có một bản ghi mỗi project, nhưng logic cập nhật lại ràng buộc `userId`. `ProjectMemory` lọc theo người dùng và unique theo `projectId + userId + fingerprint`.

### 4.2. Pipeline đang có

Luồng điển hình: tạo project → upload archive/import GitHub → snapshot → ingest và phát hiện framework → chuẩn bị dependencies/runtime → chạy test → parse kết quả/coverage → lưu dữ liệu phân tích → giao diện đọc kết quả.

Các luồng phân tích kiến trúc, CFG/CC, AI test và system assessment có orchestration riêng. Không coi mọi route tên “pipeline” đều chạy cùng một đường; phải bám route đang mount và service thực tế được gọi.

System assessment đã có workspace tách riêng, source/test/config hash, lease trên snapshot, kiểm tra proposal trước apply và event sequence để replay. Đây là các nền tảng có thể dùng lại, nhưng chưa bao phủ mọi tác vụ ghi của CovAI.

### 4.3. Giao diện có thể tái sử dụng

Giữ nguyên `ProjectSelectionPage`, `Layout`, `Sidebar`, `Editor`, `AIPanel`, `AIContextDialog`, `JobQueue`, `NotificationCenter`, bộ `Button/Badge/Card/ConfirmDialog` và dịch vụ frontend hiện tại.

Nguồn style: `client/src/index.css`: Inter cho UI, JetBrains Mono cho code, tím chính `#6d5dfb`, surface `#f8fafc`, border `#e2e8f0`, radius 4/6/8/12px. Bản Figma dùng lại các đặc trưng này; không thêm một hệ thống giao diện xa lạ.

## 5. Các điểm ảnh hưởng đã xác minh trong code

| Điểm | Bằng chứng | Tác động đối với cộng tác |
|---|---|---|
| Chỉ lấy project của owner | `project.service.js:156–183`, `projectScope.service.js` | Thành viên chưa thấy hoặc mở được project |
| Chi tiết project thiếu scope người gọi | `project.controller.js` gọi `getProjectById(id)`; service tại `project.service.js:185` chỉ tìm theo ID | Cần đưa về kiểm tra quyền project; đăng nhập không đồng nghĩa được xem mọi project |
| Có API file cũ dùng đường dẫn trực tiếp | `fileManager.controller.js`, mount tại `server/index.js` | Đường read/save/delete chưa buộc vào project của người gọi; phải loại bỏ hoặc chuyển qua cùng lớp scope |
| Lưu file chưa có phiên bản nền | `Editor.jsx:739`, `project.service.js:1097` | Hai bản nháp khác nhau có thể ghi đè tuần tự dù ghi được khóa |
| Khóa ghi chưa bao phủ mọi mutation | `project.service.js`: save dùng lease khi bật feature flag; create/rename/delete có đường riêng | Không thể hứa chống xung đột chỉ bằng cách dùng lại một lock hiện hữu |
| Quyền xem/hủy/stream job theo người chạy | `job.controller.js:119`, `:311`, `:344`; route đang import controller này | Thành viên khác không theo dõi được cùng một job nếu chỉ sửa list project |
| Có controller job khác | `jobSafe.controller.js` tồn tại nhưng `job.route.js` import `job.controller.js` | Phải sửa đúng đường đang chạy; không đánh giá an toàn từ file tên “safe” |
| Event system run gửi cho một người | `systemLiveEvent.service.js`, `notification.service.js`, `socketSubscription.js` | Chưa có cơ chế cập nhật chung cho cả project |
| Cache ít tự làm mới | `queryClient.js` tắt refetch focus/reconnect, staleTime 10 phút; nhiều query key chưa chứa user | Có thể thấy dữ liệu cũ sau thay đổi từ thành viên khác hoặc đổi tài khoản |
| Snapshot chọn bằng latest/localStorage | `Layout.jsx`, `project.service.js` | Người dùng đang sửa snapshot cũ có thể vô tình ghi vào snapshot mới nhất |
| Chat/memory đang riêng | `chatContext.service.js`, `projectMemory.service.js`, `chat.service.js` | Phải thiết kế lại scope và tác giả; không đơn thuần bỏ một điều kiện lọc |
| Quota AI cập nhật kiểu đọc rồi ghi | `aiQuota.service.js` | Hai yêu cầu đồng thời có thể vượt/ghi thiếu lượt; cần giữ chỗ quota nguyên tử |
| Git dùng workspace chung, author theo owner | `git.service.js` | Commit/checkout/pull/stage có thể ảnh hưởng công việc của cả nhóm |
| Git có thao tác đổi origin chứa token | `git.service.js` | Không thể cấp Editor rồi mặc nhiên dùng credential owner; cần policy tích hợp riêng |
| Queue chống trùng theo job ID | `queue.service.js:321` trở đi | Hai yêu cầu tạo hai job ID cho cùng một việc vẫn là hai việc khác nhau |
| Constraint chống trùng hiện có phạm vi hẹp | `schema.prisma` Job active singleton cho ANALYSIS/SUPERTEST_COVERAGE | Không suy rộng thành tất cả loại test/AI đều chống trùng |
| Có fallback chạy in-memory khi Redis lỗi | `queue.service.js` | Không được cho shared workspace mutation bỏ qua khóa vì Redis mất kết nối |

Đây là kết luận đọc code, chưa phải kết quả khai thác runtime. Không chạy request sửa/xóa file hoặc test trên database thật để chứng minh lỗi.

## 6. So sánh các phương án

| Phương án | Điểm tốt | Đánh đổi | Kết luận |
|---|---|---|---|
| Membership theo project | Bám mô hình hiện tại, giao diện nhỏ, quyền rõ | Cần rà tất cả đường truy cập tài nguyên | **Đã chọn** |
| Team/Organization + projects | Phù hợp nhiều nhóm và nhiều project | Thêm quản trị tổ chức, kế thừa quyền, điều hướng | Để giai đoạn khác |
| Link chia sẻ chung | Gửi nhanh | Dễ chuyển tiếp, khó quản lý người nhận và quyền | Không dùng làm quyền truy cập v1 |

Lời mời email vẫn chứa link token cá nhân; điều đó khác với một link chung mà ai có cũng vào project.

## 7. Thiết kế kỹ thuật đề xuất

### 7.1. Một lớp phân quyền dùng chung

Giữ `Project.ownerId` là nguồn sự thật duy nhất cho Owner. Thêm `ProjectMember` cho Editor/Viewer với unique `(projectId, userId)`, `role`, `createdAt`, người cấp quyền và phiên bản membership. Không lưu thêm một Owner trong bảng thành viên rồi phải đồng bộ hai nơi.

Lớp truy cập trả về `project + effectiveRole + capabilities`. Mỗi thao tác yêu cầu capability cụ thể như đọc source, sửa source, chạy test, xem chat, gửi chat, sửa memory, quản lý thành viên. Không phân quyền chỉ dựa trên HTTP method: một POST có thể chỉ đọc/preview.

Với ID con, tra ngược về project trước khi cho truy cập: snapshot → project, job → project, scenario/proposal → snapshot → project, message → session → project. Không tin `projectId`, `userId`, room hoặc role từ client.

Backend kiểm tra mỗi request; frontend dùng capabilities để trình bày hành động và giải thích quyền. JWT xác định danh tính, membership hiện thời xác định quyền. Không ghi role project lâu dài vào JWT rồi chờ token hết hạn mới thu hồi được quyền.

Nguyên tắc này dựa trên [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): mặc định từ chối và kiểm tra quyền trên mọi request.

### 7.2. Ma trận quyền dự kiến

| Hành động | Owner | Editor | Viewer |
|---|:---:|:---:|:---:|
| Xem source, dashboard, test, evidence, lịch sử | ✓ | ✓ | ✓ |
| Xuất báo cáo đã lọc dữ liệu nhạy cảm | ✓ | ✓ | ✓ |
| Đọc tất cả chat và AI memory của project | ✓ | ✓ | ✓ |
| Nhắn AI, thêm/sửa/forget memory | ✓ | ✓ | — |
| Sửa file và test; áp dụng AI khi hợp lệ | ✓ | ✓ | — |
| Chạy phân tích/test/AI generation | ✓ | ✓ | — |
| Mời, đổi role, xóa thành viên | ✓ | — | — |
| Xóa project, restore ảnh hưởng toàn workspace | ✓ | — | — |
| Quản lý GitHub/webhook; pull/checkout thay workspace | ✓ | — | — |
| Duyệt requirement/expected outcome chính thức | ✓ | — | — |
| Hủy job do chính mình chạy | ✓ | ✓ | — |
| Hủy job của người khác | ✓ | — | — |

Các hàng cụ thể về restore, Git, duyệt requirement, hủy job là đề xuất thận trọng theo hành vi hiện tại. Cần bạn review trước khi coi là contract triển khai. Editor vẫn soạn scenario/binding; Owner duyệt những kỳ vọng chính thức mà hệ thống dùng để đánh giá. Member có thể rời project; Owner không tự rời hoặc bị hạ quyền trong v1. Chuyển ownership chưa đưa vào v1.

### 7.3. Pipeline mời thành viên

1. Owner nhập email, chọn Editor/Viewer, gửi lời mời. Không có lựa chọn cấp Owner.
2. Server xác minh quyền Owner, canonicalize email theo policy thống nhất với tài khoản, kiểm tra đã là thành viên/chưa có lời mời pending hợp lệ; không tự áp dụng quy tắc alias Gmail.
3. Tạo `ProjectInvitation`: project, email nhận, role, người mời, token hash, expiry, status, version. Sinh token ngẫu nhiên đủ mạnh; chỉ lưu hash. Đề xuất expiry 7 ngày.
4. Ghi invitation + sự kiện gửi email trong transaction. Worker gửi email sau commit; lỗi gửi hiển thị “pending, delivery failed” và cho retry. Không coi gửi email và ghi database là một transaction nguyên tử.
5. Link mở trang nhận lời mời. Người chưa đăng nhập được đăng nhập/đăng ký rồi quay lại; người sai tài khoản thấy trạng thái riêng.
6. Chấp nhận phải dùng tài khoản có email phù hợp từ database và có secret nhận qua mailbox được mời. Không dựa riêng vào chuỗi email tự khai khi đăng ký hoặc email trong payload client. Hiện code đăng ký chưa có bước xác minh mailbox, nên cần ràng buộc bằng token email/luồng xác minh tại bước này.
7. Trong transaction: kiểm tra invitation còn pending, chưa hết hạn/chưa thu hồi, project còn tồn tại, version/role hiện hành; tạo membership unique và consume token đúng một lần. Hai lần bấm Accept không tạo hai membership.
8. Sau commit phát membership event và đưa người nhận vào project. Resend làm token cũ hết hiệu lực. Revoke/accept/role-change đồng thời phải được serialize, không để token cũ cấp lại quyền đã thu hồi.

Mẫu lời mời dựa trên [GitHub Docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository). Cách dùng token một lần, có hạn, lưu an toàn được vận dụng từ [OWASP token guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html); đây là suy luận áp dụng cho invitation, không phải tài liệu OWASP chuyên về invitation.

### 7.4. Thuật toán chống ghi đè file

Không dùng last-write-wins. Đề xuất **optimistic concurrency**: lúc mở file, trả nội dung và `version/contentHash`; lúc lưu, gửi kèm phiên bản nền, project, snapshot cụ thể và relative path.

Server lấy lease phù hợp cho workspace mutation, kiểm tra lại quyền và snapshot, đọc phiên bản hiện tại, so sánh với phiên bản nền. Khớp thì ghi file tạm và thay file đích an toàn; tăng revision/ghi nhật ký, rồi phát event. Không khớp thì trả conflict có mã riêng, không ghi bất kỳ byte nào từ draft.

**So sánh hash rồi ghi không tự nó là nguyên tử.** Tất cả đường ghi, kể cả AI apply, create/rename/delete, Git và restore, phải tham gia cùng cơ chế điều phối hoặc chạy trên workspace cô lập và kiểm tra lại trước publish. Filesystem và PostgreSQL không có transaction chung: cần trạng thái mutation PREPARED/APPLIED/RECOVERY_REQUIRED hoặc cơ chế tương đương; nếu tiến trình chết giữa hai bước phải có reconciliation, không khẳng định chắc chắn đã lưu chỉ từ một nửa trạng thái.

Với file trên đĩa, cần chống symlink/traversal, không nhận host path, xử lý rename/delete và phiên bản file bị xóa/tạo lại. Chỉ thao tác trong snapshot đã được cấp quyền. Khi mất lease/Redis, từ chối mutation phụ thuộc khóa; không chuyển sang ghi không khóa.

Client giữ draft theo project + snapshot + file + tài khoản/tab. Nếu có remote event mà draft chưa sửa thì refresh; nếu draft bẩn thì báo “file changed”, không thay nội dung editor. Modal cho so sánh, tiếp tục sửa, copy/export draft và lấy bản mới; chưa tự merge ba chiều ở v1. Clipboard lỗi phải giữ draft và không reload. Dữ liệu đã tải xuống máy không thể bị thu hồi tuyệt đối sau khi rời project; server chỉ chặn truy cập tiếp theo và UI xóa cache dùng chung.

[Prisma OCC](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions#optimistic-concurrency-control) mô tả cách dùng version/concurrency token để nhận biết thay đổi. Với file, phải bổ sung điều phối ngoài database như trên. [Redis locking](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/) hỗ trợ lease có token sở hữu; lease hiện tại trong CovAI có nền tảng tương tự nhưng chưa đủ để tuyên bố bảo đảm toàn hệ thống hoặc môi trường failover.

### 7.5. Pipeline chạy test và AI cho nhiều người

`Yêu cầu → xác minh member/capability → cố định snapshot/config → tạo hoặc dùng lại operation → queue → worker kiểm tra lại → workspace cô lập → kết quả → publish nếu phiên bản và quyền còn hợp lệ → event cho project`.

Tách hai vấn đề:

- **Idempotency:** retry cùng request không tạo job mới. Request key gắn actor/project/action và payload chuẩn hóa.
- **Semantic deduplication:** hai người cùng yêu cầu một phép chạy với cùng snapshot/sourceHash/testHash/framework/mode/config được dùng chung job đang hoạt động. Hai cấu hình khác nhau không bị coi là trùng.

Giữ constraint/operation admission trong DB, bắt unique conflict để trả job đang chạy; không chỉ “find rồi create”. Có thể dùng thêm [BullMQ deduplication](https://docs.bullmq.io/guide/jobs/deduplication), nhưng queue không thay thế integrity trong DB và khóa workspace.

Kết quả xem theo project membership, `Job.userId` vẫn ghi initiator. UI hiển thị “Started by Linh”, “Already running — View run”. Những thao tác thực sự dùng chung workspace hoặc output path phải serialize; phép đọc/đo độc lập có workspace riêng mới được chạy đồng thời.

Khi member bị xóa/hạ quyền: job chưa chạy bị chặn tại worker; operation đang chạy nhận yêu cầu dừng và không publish/apply sau khi mất quyền. Nếu worker không dừng ngay, việc kiểm tra lại ngay trước mutation/commit là hàng rào bắt buộc. Không broadcast nhạy cảm cho actor đã bị thu hồi. Cần quy định điểm commit rõ ràng khi revoke và apply diễn ra cùng lúc.

Đề xuất quota AI tính cho **người chủ động yêu cầu**, không trừ owner vì người khác bấm. Dùng giữ chỗ quota nguyên tử; request dùng lại job không trừ lần nữa. Hết quota provider/app trả mã riêng, giữ nguyên draft. Chính sách hoàn quota phải phân biệt lỗi trước gọi provider với cuộc gọi đã tiêu thụ tài nguyên.

### 7.6. Chat và memory AI dùng chung

Đây là thay đổi phạm vi quan trọng nhất sau quyết định cuối của bạn:

- Session được truy cập theo project/capability, không theo `session.userId == người gọi`. Giữ người tạo làm attribution.
- `ChatMessage` bổ sung người gửi; assistant có `replyTo/requestId` để biết đang trả lời ai. Không gán mọi tin trong session cho chủ session.
- Viewer đọc được chat/memory; Owner/Editor được nhắn, tạo session và sửa memory. Đề xuất chỉ Owner xóa cả cuộc chat hoặc xóa toàn bộ memory để tránh xóa dữ liệu nhóm; quyền rename/session management cần biểu diễn thành capability.
- Một session chỉ có một lượt sinh AI đang hoạt động. Dùng token lease hiện có nhưng đổi scope sang session/project; thêm client request ID để retry không nhân đôi cặp tin nhắn. Trong lúc bận, composer của người khác vẫn giữ draft và server trả trạng thái busy, không âm thầm bỏ tin.
- Trước commit AI reply, kiểm tra lại session còn tồn tại, lease thuộc request, actor còn quyền; lưu cặp user/assistant và attribution nhất quán. Provider có thể đã được gọi dù commit thất bại; không hứa “exactly once” với dịch vụ ngoài.
- `AiContextSettings` một bản ghi mỗi project: thêm lastUpdatedBy, revision; không để người tạo settings chặn mọi Editor khác.
- Memory thành phạm vi project; fingerprint unique theo project thay vì theo từng người, có createdBy/updatedBy, revision và nguồn message. Giữ cơ chế generation/tombstone để maintenance đang chạy không làm sống lại memory vừa bị forget.
- Maintenance job không dùng `userId` như quyền sở hữu dữ liệu chung. Phải đọc quyền hiện tại, memoryGeneration và revision trước ghi; thao tác nhắc lại từ chat chung không ghi vào “memory riêng của người gửi”.
- Nhiều người sửa cùng note dùng revision conflict, giữ draft. Auto-extraction không tự ghi đè một note người khác vừa sửa hoặc ghi nhớ chưa được duyệt. Chia sẻ cùng project không làm nội dung AI đáng tin hơn; prompt vẫn phải coi code/attachment/chat là dữ liệu đầu vào.
- Migration: message cũ vai trò user có thể backfill tác giả từ owner của session cũ; assistant là AI. Không phát minh người gửi cho dữ liệu không xác định. Trước khi mời người đầu tiên, Owner cần thấy thông báo rõ **lịch sử chat, attachments và memory hiện hữu sẽ được chia sẻ**. Người mới không tự nhận credential GitHub hay secrets máy chủ.

CRDT như [Yjs](https://docs.yjs.dev/) phù hợp nếu sau này cần cùng gõ trong editor, có [Monaco binding](https://docs.yjs.dev/ecosystem/editor-bindings/monaco). Phạm vi đã chốt hiện tại chỉ cần message ordering, lease và version checking; thêm CRDT bây giờ sẽ kéo theo persistence, reconnect, undo, awareness và quyền trên từng update ngoài nhu cầu v1.

### 7.7. Đồng bộ và thu hồi quyền

Mở rộng Socket.IO bằng room project do server quyết định sau xác thực và kiểm tra membership. Room hiện tại `user:<id>` đã kiểm tra token khớp user yêu cầu; giữ cơ chế này cho thông báo cá nhân.

Event dự kiến: member changed/removed, file changed, snapshot changed, run changed, chat message committed, memory changed. Event chỉ mang ID/revision và thông tin đã lọc; client đọc lại qua API có kiểm tra quyền. Không đưa prompt, token, raw stdout, host path hoặc secret vào thông báo.

Sau reconnect phải lấy lại capabilities, snapshot, operation đang chạy và chat/memory revision. Không xem WebSocket là nguồn dữ liệu duy nhất; system event sequence/replay hiện có là mẫu có thể dùng lại. [Socket.IO rooms](https://socket.io/docs/v4/rooms/) là kênh broadcast, không tự cung cấp phân quyền ứng dụng.

Khi revoke: commit membership trước, đẩy socket của user ra room trên mọi instance, đóng SSE còn mở và ngăn resubscribe, hủy query đang pending, bỏ cache dùng chung theo project và xử lý draft riêng. Query key phải tách user/project/snapshot/session phù hợp; logout phải clear cache thay vì chỉ bỏ token.

## 8. Thiết kế Figma đã tạo

### Bản hiện hành sau phản hồi về độ giống frontend

Đã thay khung vẽ tay của màn Members/Pending bằng các component Figma tái dựng từ **bản render nguyên frontend React hiện tại**. Bản đối chiếu dùng dữ liệu minh họa trong `client/.evidence-review/collaboration-frontend-reference.html`, import `src/main.jsx` nguyên trạng, không khởi chạy backend và không sửa component sản phẩm.

- **Màn FE hiện tại để đối chiếu:** `28:576`, Settings → Profile.
- **Màn bổ sung Members:** `3:52`, Settings → Project → Members & access.
- **Màn Pending invitations:** `16:112`, cùng khung và thứ tự tab.
- **Bản đồ page/component:** `16:322`.
- Trang hiện hành chỉ giữ bốn frame trên. Các bản phác khác chuyển sang **Archive / Superseded explorations**; không dùng chúng làm chuẩn về giao diện FE.
- Header 44px, activity bar 60px, sidebar Settings 260px, nội dung 775px, panel COV 340px, status bar 24px tại viewport 1440×900. Header/activity/COV/status dùng chung đúng component Figma giữa baseline và đề xuất.
- Giữ theme tối mặc định trong `ThemeContext`, đúng Inter/JetBrains Mono, icon vector từ bản render Lucide, nhãn **COV**, Quick Capabilities, What AI knows, History, New, input chat và model selector hiện tại. Không vẽ lại các phần này theo một phong cách khác.
- Sidebar Settings chỉ thêm nhóm Project và Members & access; các mục Profile, Appearance, Security, Notifications, Billing và Log Out giữ nguyên. Nội dung Members/Pending dùng cùng nhịp padding, kích thước chữ, card, border và màu của Settings hiện tại.
- Toàn bộ UI là text/vector/layer sửa được, không có ảnh chụp phẳng làm nền. Capture thô đã xóa sau khi tách thành component và đối chiếu screenshot.
- Đã kiểm tra hình và bounds của hai màn hiện hành; không thấy tràn trong phần nội dung mới. Thông tin component, node và kiểm tra lưu ở `2026-10-27-collaboration-frontend-fidelity.json`.

Phần liệt kê 11 frame phía dưới ghi lại lịch sử thiết kế trước lần sửa này; tám màn phác không còn là chuẩn giao diện hiện hành.

[Mở file thiết kế](https://www.figma.com/design/90x2yOO5uDc5u9lTOpgWOY/Untitled?node-id=3-50).

File ban đầu trống. Đã tạo layer chỉnh sửa được bằng Figma MCP, không dùng screenshot phẳng làm giao diện. Có controls tái sử dụng, variable theo source token, 6 text styles và 11 frame. Bản sửa theo phản hồi của bạn đặt quản lý thành viên trong **Settings → Project → Members & access**, giữ các sidebar của Studio:

| Frame | Nội dung | Node |
|---|---|---|
| 01 | Danh sách project được chia sẻ, role và người sở hữu | `3:50` |
| 02 | Studio chung; activity bar đầy đủ, Settings ở dưới, Explorer và AI panel | `3:51` |
| 03 | Settings → Project → Members & access: Owner mời/đổi quyền trong vùng nội dung chính | `3:52` |
| 04 | Nhận lời mời, nhận biết project và role trước khi tham gia | `3:53` |
| 05 | So sánh file mới nhất với draft khi lưu xung đột | `3:54` |
| 06 | Viewer: code chỉ đọc, quyền được giải thích | `3:55` |
| 07 | Lời mời hết hạn, sai account, mất quyền, email lỗi, remove member, activity | `3:56` |
| 08 | Settings → Project → Members trên mobile | `3:57` |
| 09 | Các cuộc chat chung, tác giả, memory chung và composer đang chờ AI | `7:80` |
| 10 | Tab Pending invitations trong cùng trang Settings | `16:112` |
| 11 | Bản đồ page/tab/component: phần có sẵn và phần đề xuất bổ sung | `16:322` |

Bản nháp ban đầu có chat riêng; đã sửa sau khi bạn chọn chat/memory chung. Những hình riêng tư xuất hiện trước quyết định đó trong lịch sử chat không còn là thiết kế hiện hành.

Đã nối các bước prototype chính: mở project, chọn Settings ở activity bar để vào Members & access, chuyển Members/Pending invitations, nhận lời mời, trở về từ conflict và mở/đóng shared AI. Modal Members trong bản đầu đã được thay bằng trang Settings. Các nút còn lại là trạng thái thiết kế, không phải backend đang hoạt động. Tên, email, code và tiến độ trên Figma là dữ liệu minh họa. Bộ lọc, nền editor và panel là cách thể hiện đề xuất từ code, không phải ảnh chụp ứng dụng đang chạy.

UX quan trọng: điểm quản lý thành viên chính là Settings, không có tab Team riêng. Sidebar Settings giữ Profile, Appearance, Security, Notifications, Billing trong nhóm Account; thêm nhóm Project hiển thị project hiện tại và Members & access. Viewer biết vì sao không sửa được; pending tách active; xác nhận remove mô tả mất quyền; conflict không có nút overwrite vội vàng; mobile giữ điều hướng Settings và nội dung dọc. Header đã bổ sung lại Projects, Export và các điều khiển panel.

### Vị trí page, tab và component sau phản hồi

- **Có sẵn:** `DashboardPage.jsx` → `Layout.jsx` → `ActivityBar.jsx` (Settings ở dưới) → `settings/SettingsSidebar.jsx`.
- **State có sẵn được dùng lại:** `activeActivity = "settings"`; **state đề xuất mới:** `activeSetting = "members"`.
- **Component đề xuất mới:** `settings/ProjectMembersSettings.jsx`, ghép `InviteMemberForm`, `ProjectMemberList`, `ProjectInvitationList`. Các tên này là thiết kế cấu trúc, chưa có file implementation được tạo.
- **URL hiện có:** `/main-editor?projectId=…`; **deep link đề xuất:** `&tab=settings&setting=members`. Code hiện đọc `tab` nhưng chưa đọc `setting`; cần triển khai nếu chốt deep link này.
- **Sidebar khi mở Settings:** cây file nhường chỗ cho SettingsSidebar đúng cơ chế hiện có trong Layout; AIPanel bên phải vẫn có thể đóng/mở. Khi quay về Explorer, Sidebar cây file xuất hiện lại.
- **Chú thích kỹ thuật** nằm ở frame 11 và tên layer Figma, không đưa tên component/code vào giao diện sản phẩm.

Khi triển khai modal phải giữ focus, Escape/Close, trả focus về nút mở và label đúng như [W3C Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). Figma không kiểm chứng keyboard hoặc screen reader thực tế.

## 9. Thứ tự thực hiện đề xuất, chưa phải task plan triển khai

1. Chốt ma trận quyền và bổ sung tests chặn các đường truy cập ngoài scope; xử lý API file cũ và project detail trước khi mở quyền.
2. Thêm membership/invitation, giữ owner hiện hữu; tạo migration có backfill và kiểm tra cascade.
3. Chuyển tất cả đường đọc/ghi tài nguyên project sang capability chung, gồm export/evidence/SSE/legacy routes.
4. Hoàn thiện revision/CAS, snapshot chính xác và điều phối mọi workspace mutation.
5. Chuyển chat/memory sang shared scope, backfill attribution, lease/busy, quota, maintenance jobs.
6. Gắn Members/invitation/project filters vào UI hiện có; đồng bộ events, revoke và cache.
7. Chạy nghiệm thu với nhiều tài khoản, hai tab/máy và tình huống retry/reconnect.

Không thay đổi thuật toán coverage hay viết lại toàn bộ backend/frontend trong cùng tính năng.

## 10. Bộ tiêu chí nghiệm thu cần có

- A tạo project, B Editor vào từ lời mời, C Viewer chỉ đọc, D ngoài project không đọc được bằng ID đoán.
- Thử cùng quyền trên source, snapshot, job detail, SSE, export, screenshot/artifact, scenario/proposal, chat và memory; không chỉ test màn Projects.
- Hai Editor lưu cùng phiên bản: đúng một bản thành công, bản còn lại conflict và draft nguyên vẹn.
- File save song song với rename/delete/restore/AI apply không ghi nhầm snapshot hay làm mất dữ liệu.
- Hai người bấm cùng phép chạy: dùng lại đúng job; cấu hình khác không bị hợp nhất nhầm; quota không bị trừ hai lần khi retry.
- Revoke giữa queue/start/apply và trong lúc đang mở socket/SSE/chat không cho mutation trái quyền; cache bị xóa, bản nháp có lối phục hồi.
- Email lỗi có retry; invite trùng, expired, revoked, accept hai lần, role đổi đồng thời và sai account xử lý rõ.
- Shared chat hiển thị đúng người; Viewer không gọi AI qua API; gửi đồng thời giữ thứ tự hoặc trả busy có draft; retry không tạo hai cặp tin.
- Shared memory cập nhật đúng revision; hai người sửa/forget đồng thời không làm sống lại note; maintenance dùng scope project.
- Người mới thấy lịch sử được chia sẻ theo đúng thông báo; credentials và thông tin máy chủ không lọt vào export/chat/event.
- Existing owner-only projects và kết quả cũ vẫn truy cập được sau migration; không nhân đôi Owner hoặc mất attribution.
- API auth hiện có, build/lint frontend và Jest liên quan phải chạy ở giai đoạn triển khai. Test tích hợp dùng DB test riêng; không chạy bộ test có seed/delete vào DB chưa xác nhận.

## 11. Đã kiểm tra và giới hạn của phiên này

- Đã khảo sát source và tài liệu, nghiên cứu tài liệu chính thức, lập inventory có hash, dựng Figma và kiểm tra layer/bounds/screenshot.
- Đã xác minh những phát hiện trong bảng bằng đường import/mount và code liên quan; chưa chạy khai thác bảo mật hoặc kiểm chứng toàn bộ hệ thống đang vận hành.
- Chưa viết tính năng, thay schema, chạy migration, cài dependency, gửi email thật hoặc đổi membership ở một hệ thống đang hoạt động.
- Chưa chạy build/test ứng dụng vì đây là tác vụ nghiên cứu/thiết kế và working tree có nhiều công việc hiện hữu. Kiểm tra Figma không thay thế kiểm thử UI thực tế.
- Chưa thể chứng nhận review thủ công từng dòng của toàn bộ repo. Những phát hiện chưa nêu không có nghĩa các file còn lại đã được chứng minh không có vấn đề.
- Báo cáo này tách quyết định bạn đã chọn và default đề xuất. Bản specification triển khai cần được duyệt sau khi bạn review thiết kế và các quyền thao tác quan trọng.

### Kiểm tra tự rà soát báo cáo

- Quyết định shared chat/memory đã thay thế toàn bộ phương án private trong đề xuất hiện hành.
- Không đồng nhất người khởi tạo với người có quyền đọc kết quả.
- Không khẳng định DB transaction làm filesystem/email/provider AI nguyên tử.
- Không dùng job ID dedup thay thế semantic dedup hoặc lock workspace.
- Không dùng lock đơn thuần thay thế kiểm tra phiên bản.
- Không bổ sung Team/Organization hoặc live co-editing trái phạm vi đã chốt.
