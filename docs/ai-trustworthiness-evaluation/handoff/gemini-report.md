# Báo Cáo Nghiệm Thu Vòng Sửa Cuối Trước MVP-4 (Backend Only)

> **Phạm vi thực hiện:** Hoàn thiện toàn bộ Phần A (`sourceQuote` & ca chưa kiểm chứng), Phần B (chuẩn hóa so trùng model & tính lại `verdict` trong `report.service.js`), Phần C (chặn triệt để `.env` / `.env.*` / `.pem` / `.key` trong archive upload & GitHub clone), và Phần D (sửa false positives / false negatives của Lớp 1 `designAudit.service.js` trên 2 chatbot mẫu).
> **Ràng buộc tuân thủ:** Chỉ sửa backend, chưa làm UI MVP-4, chưa commit, không đọc `sample-chatbots/README.md`, giữ nguyên toàn bộ 35 test cũ và bổ sung 8 test mới (`40/40` trong `test:evaluation` + `3/3` trong `uploadArchiveSecurity.test.js`).

---

## 1. Danh Sách Các File Đã Sửa / Tạo Mới

### File Backend Đã Sửa (8 files)
1. `server/src/services/aiEvaluation/judge.service.js`
   - **A1:** Bổ sung hằng số `UNVERIFIED_REFERENCE_JUDGE_INSTRUCTION`. Khi `referenceUnverified === true`, `buildStandardCriteriaForScenario` và `judgeCaseCriteria` tuyệt đối không gửi `expectedFacts`, `expectedBehavior` hay `groundTruth` do Generator sinh sang Judge; thay bằng chỉ dẫn chỉ đối chiếu trực tiếp phần `sources` (TÀI LIỆU).
   - **A2:** Nâng ngưỡng kiểm chứng trích dẫn sau chuẩn hóa lên tối thiểu `>= 15` ký tự **và** `>= 3` từ (`MIN_VERIFIED_QUOTE_CHARS = 15`, `MIN_VERIFIED_QUOTE_WORDS = 3`).
   - **A3:** Mở rộng `normalizeForQuoteVerification` cho cả `sourceQuote` lẫn tài liệu nguồn: bỏ ký hiệu markdown (`*`, `_`, `#`, `>`, `` ` ``), đổi ngoặc kép/đơn cong sang thẳng (`"`, `'`), quy các loại gạch ngang (`–`, `—`, `−`, `‑`, `‒`, `―`) về `-`, đổi `…` thành `...`, gộp khoảng trắng và hạ chữ thường sau `NFC`.
2. `server/src/services/aiEvaluation/management.service.js`
   - **A1:** Hiển thị `referenceUnverified`, `unverifiedReferenceCount` và `unverifiedReferenceCaseKeys` thông qua `versionFor(...)` ở bước tạo đề / lưu nháp / duyệt đề. Bổ sung `reconcileCaseQuoteVerification(caseDef, readySources)` trong cả `saveProfile` và `approveProfile`: nếu người duyệt sửa `sourceQuote` và trích dẫn mới khớp tài liệu đã nạp thì tự động xóa cờ (`referenceUnverified: false`) và khôi phục `groundTruth`/`expectedFacts`.
3. `server/src/services/aiEvaluation/contracts.js`
   - **B1:** Thêm `normalizeModelComparisonKey` (`trim().toLowerCase().replace(/^models\//, '')`) dùng chung cho `assertDistinctGeneratorAndJudgeModels` và `definitionSchema.superRefine`, chặn biến thể hoa/thường hoặc tiền tố `models/` (ví dụ `"Gemini-3.8-Flash"` với `"models/gemini-3.8-flash"`).
4. `server/src/services/aiEvaluation/report.service.js`
   - **B2:** Nếu bản ghi đã lưu có `verdict === 'PASSED'` nhưng `errorCriteriaCount > 0`, gọi lại `aggregateTrustProfile(...)` để tính lại `report.verdict = 'INCOMPLETE'` (đồng bộ cả `report.summary.verdict`) thay vì chỉ gắn dòng lưu ý trong `limitations`.
5. `server/src/middlewares/upload.middleware.js`
   - **C:** Viết hàm dùng chung `isDisallowedSecretFile(rawPath)` dựa trên `path.posix.basename` (chuẩn hóa cả `\` và `/`): chặn `.env`, `.env.*` (`.env.local`, `.env.production`, ...), `.pem`, `.key`; cho phép `.env.example`, `.env.sample`, `.env.template`. Áp dụng cho cả nhánh `.zip` và `.rar` của `scanArchiveBomb`, đồng thời export `purgeDisallowedSecretFiles(targetDir)`.
6. `server/src/services/zipExtraction.service.js`
   - **C:** Tích hợp `isDisallowedSecretFile` vào `isExcludedEntry` và bộ lọc giải nén RAR để chặn lớp thứ hai khi ghi file ra đĩa.
7. `server/src/services/githubClone.service.js`
   - **C:** Gọi `purgeDisallowedSecretFiles(repoDir)` ngay sau `git clone` để xóa mọi file `.env` / `.env.*` / `.pem` / `.key` (giữ nguyên `.env.example` / `.env.sample` / `.env.template`) trước khi đóng gói snapshot.
8. `server/src/services/aiEvaluation/designAudit.service.js`
   - **D1:** Mở rộng AST detector `hasChatSendCall` nhận diện `chat.sendMessage` / `sendMessageStream` / `responses.create` bên trong `TryStatement`, triệt tiêu false positive `CB-REL-02` trên `shop-assistant-good`.
   - **D2:** Phân biệt rõ trường hợp truyền `history` không cắt giới hạn (`CB-ARCH-01`) với trường hợp `startChat({ history: [] })` / chỉ lấy `messages.at(-1)` làm mất ngữ cảnh hội thoại nhiều lượt (`CB-ARCH-02`: `"Conversation history not forwarded (multi-turn context lost)"`).
   - **D3:** Bổ sung `CB-SEC-04` (`HIGH`) phát hiện mật khẩu, mã nội bộ hoặc khóa nhạy cảm gán cứng trong `systemPrompt` / `systemInstruction`, đồng thời che giá trị nhạy cảm bằng `maskSecretsInSnippet` ở cả `findings` và `summary.systemPrompts`.
   - **D4:** Bổ sung `CB-REL-03` (`MEDIUM`) phát hiện trả chi tiết lỗi nội bộ thô (`err.message`, `err.stack`, `res.send(err)`) về HTTP client.
   - **D5:** Bổ sung `CB-CFG-01` (`LOW`, khuyến nghị) khi `temperature > 0.7` trên chatbot bám tài liệu.

### File Test & Fixture Tạo Mới (8 files)
1. `server/src/tests/aiEvaluation.preMvp4Review.test.js` (5 ca kiểm thử tích hợp cho A1, A2, A3, B1, B2, C, D1–D5; dùng fake Gemini ở tầng provider).
2. `server/src/tests/uploadArchiveSecurity.test.js` (3 ca kiểm thử chuyên biệt cho upload `.zip`, đường dẫn Windows `\` và thư mục clone GitHub).
3. `server/src/tests/fixtures/sample-chatbots/shop-assistant-good/server.js`
4. `server/src/tests/fixtures/sample-chatbots/shop-assistant-good/package.json`
5. `server/src/tests/fixtures/sample-chatbots/shop-assistant-good/knowledge/chinh-sach-cua-hang.md`
6. `server/src/tests/fixtures/sample-chatbots/shop-assistant-sloppy/server.js`
7. `server/src/tests/fixtures/sample-chatbots/shop-assistant-sloppy/package.json`
8. `server/src/tests/fixtures/sample-chatbots/shop-assistant-sloppy/knowledge/chinh-sach-cua-hang.md`

---

## 2. Đoạn Code Chính Của Sửa A1 và C

### 2.1. Đoạn code chính của A1 (`judge.service.js` & `management.service.js`)

**Không gửi `expectedFacts` / `expectedBehavior` / `groundTruth` chưa kiểm chứng sang Judge (`server/src/services/aiEvaluation/judge.service.js`):**

```js
export const UNVERIFIED_REFERENCE_JUDGE_INSTRUCTION =
    'Không có đáp án tham chiếu đã kiểm chứng; chỉ đánh giá độ chính xác dựa trên phần TÀI LIỆU được cung cấp';

// Trong judgeCaseCriteria(...):
const isUnverified = Boolean(testCase.referenceUnverified);
const payload = {
    caseKey: testCase.caseKey,
    taskType: testCase.taskType,
    turns: testCase.turns,
    referenceUnverified: isUnverified,
    ...(isUnverified
        ? {
            referenceInstruction: UNVERIFIED_REFERENCE_JUDGE_INSTRUCTION,
        }
        : {
            expectedBehavior: testCase.expectedBehavior,
            expectedFacts: testCase.expectedFacts || [],
            sourceQuote: testCase.sourceQuote || '',
        }),
    criteria: criteria.map(c => ({
        key: c.key,
        rubric: c.rubric,
        groundTruth: isUnverified
            ? UNVERIFIED_REFERENCE_JUDGE_INSTRUCTION
            : c.groundTruth,
        ...(isUnverified
            ? {}
            : {
                expectedFacts: c.expectedFacts || [],
                sourceQuote: c.sourceQuote || '',
            }),
    })),
    sources: sources.map(({ id, content }) => ({ id, content: String(content || '').slice(0, 25000) })),
    repetitions: observations.map((obs, index) => ({
        repetition: index,
        responses: obs.responses,
        latencyMs: obs.latencyMs,
    })),
    evidence: evidence.map(({ id, payload: evPayload }) => ({ id, payload: evPayload })),
};
```

**Hiển thị cờ `referenceUnverified` ở bước duyệt đề và tự động xóa cờ khi người duyệt sửa `sourceQuote` khớp tài liệu (`server/src/services/aiEvaluation/management.service.js`):**

```js
function reconcileCaseQuoteVerification(caseDef, readySources = []) {
    if (!caseDef?.referenceUnverified) {
        return caseDef;
    }
    const check = readySources.length > 0
        ? verifySourceQuoteAgainstSources(caseDef.sourceQuote, readySources)
        : { verified: false };
    if (check.verified) {
        const verifiedQuote = caseDef.sourceQuote.trim();
        const fallbackFactSummary = Array.isArray(caseDef.expectedFacts) && caseDef.expectedFacts.length > 0
            ? caseDef.expectedFacts.join('; ')
            : (caseDef.expectedBehavior || verifiedQuote);
        return {
            ...caseDef,
            sourceQuote: verifiedQuote,
            referenceUnverified: false,
            criteria: (caseDef.criteria || []).map(r => {
                if (r.method !== 'semantic') return r;
                const shouldRestoreGroundTruth = r.groundTruth === UNVERIFIED_REFERENCE_JUDGE_INSTRUCTION;
                return {
                    ...r,
                    groundTruth: shouldRestoreGroundTruth
                        ? (r.key === 'contextRetention' ? (caseDef.expectedBehavior || fallbackFactSummary) : fallbackFactSummary)
                        : r.groundTruth,
                    expectedFacts: Array.isArray(r.expectedFacts) && r.expectedFacts.length > 0
                        ? r.expectedFacts
                        : (caseDef.expectedFacts || []),
                    sourceQuote: verifiedQuote,
                };
            }),
        };
    }
    return {
        ...caseDef,
        sourceQuote: '',
        referenceUnverified: true,
        criteria: (caseDef.criteria || []).map(r => {
            if (r.method !== 'semantic') return r;
            const isFactBasedKey = ['faithfulness', 'completeness', 'contextRetention'].includes(r.key);
            return {
                ...r,
                groundTruth: isFactBasedKey ? UNVERIFIED_REFERENCE_JUDGE_INSTRUCTION : r.groundTruth,
                expectedFacts: [],
                sourceQuote: '',
            };
        }),
    };
}
```

### 2.2. Đoạn code chính của C (`server/src/middlewares/upload.middleware.js`)

```js
const ALLOWED_ENV_TEMPLATES = new Set([
  ".env.example",
  ".env.sample",
  ".env.template",
]);
const BLACKLIST_EXTENSIONS = new Set([".env", ".pem", ".key"]);

export const isDisallowedSecretFile = (rawPath = "") => {
  const normalized = String(rawPath || "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  if (!normalized) return false;
  const base = path.posix.basename(normalized).toLowerCase();
  if (!base) return false;
  if (ALLOWED_ENV_TEMPLATES.has(base)) {
    return false;
  }
  if (base === ".env" || base.startsWith(".env.")) {
    return true;
  }
  const ext = path.posix.extname(base);
  return BLACKLIST_EXTENSIONS.has(ext);
};
```

Hàm `isDisallowedSecretFile` được dùng thống nhất tại:
- `upload.middleware.js`: cả nhánh `.zip` và `.rar` trong `scanArchiveBomb` (từ chối HTTP `400` ngay trước khi lưu snapshot).
- `zipExtraction.service.js`: `isExcludedEntry` và nhánh lọc file RAR khi giải nén.
- `githubClone.service.js`: `purgeDisallowedSecretFiles(repoDir)` ngay sau `git clone` để loại bỏ `.env`, `.env.*`, `.pem`, `.key` trong repo tải từ GitHub nhưng vẫn giữ lại `.env.example`, `.env.sample`, `.env.template`.

---

## 3. Điểm Lớp 1 (`designAudit.service.js`) Trước và Sau Khi Sửa Trên 2 Fixture Mẫu

| Fixture mẫu | Điểm Lớp 1 TRƯỚC khi sửa | Các cảnh báo TRƯỚC khi sửa | Điểm Lớp 1 SAU khi sửa | Các cảnh báo SAU khi sửa |
| --- | :---: | --- | :---: | --- |
| **`shop-assistant-good`** | **80 / 100** | - `CB-REL-01` (`MEDIUM`, -10): thiếu middleware rate-limit (đúng thực tế vì code chỉ kiểm tra `MAX_MESSAGE_CHARS` & `MAX_HISTORY_TURNS`, chưa gắn `express-rate-limit`).<br>- ❌ **`CB-REL-02` (`MEDIUM`, -10 — FALSE POSITIVE D1):** báo thiếu `try/catch` quanh LLM dù `await chat.sendMessage(message)` đã bọc trong `try/catch` trả HTTP `502`. | **90 / 100** | - `CB-REL-01` (`MEDIUM`, -10): chỉ còn nhắc bổ sung rate-limiting middleware.<br>- ✅ Đã triệt tiêu hoàn toàn false positive `CB-REL-02` (D1). |
| **`shop-assistant-sloppy`** | **9 / 100** | - `CB-SEC-01` (`CRITICAL`, -30): hardcode API key.<br>- `CB-PRIV-01` (`HIGH`, -18): `console.log("Incoming chat:", req.body)`.<br>- `CB-SEC-02` (`HIGH`, -18): prompt thiếu ràng buộc bám tài liệu & từ chối ngoài phạm vi.<br>- `CB-REL-01` (`MEDIUM`, -10): thiếu giới hạn độ dài input & rate limit.<br>- ❌ **`CB-REL-02` (`MEDIUM`, -10 — FALSE POSITIVE):** báo thiếu `try/catch` dù có `try/catch`.<br>- ❌ **`CB-ARCH-01` (`LOW`, -5 — FALSE POSITIVE D2):** báo *"Unbounded multi-turn message history forwarded"* dù `history: []` và chỉ gửi `messages.at(-1)`.<br>- ❌ **Bỏ sót D3, D4, D5.** | **0 / 100** | - `CB-SEC-01` (`CRITICAL`, -30): hardcode API key (đã mask).<br>- ✅ **`CB-SEC-04` (`HIGH`, -18 — D3):** phát hiện mật khẩu quản trị & mã nội bộ trong `systemInstruction` và mask sạch cả `NV-HAIDANG-50` lẫn `haidang@2026` thành `[REDACTED]` ở cả `findings` và `summary.systemPrompts`.<br>- `CB-PRIV-01` (`HIGH`, -18): log nguyên `req.body`.<br>- `CB-SEC-02` (`HIGH`, -18): prompt thiếu ràng buộc bám tài liệu.<br>- `CB-REL-01` (`MEDIUM`, -10): thiếu giới hạn input & rate limit.<br>- ✅ **`CB-REL-03` (`MEDIUM`, -10 — D4):** phát hiện `res.status(500).json({ error: err.message })` làm lộ lỗi nội bộ thô.<br>- ✅ **`CB-ARCH-02` (`MEDIUM`, -10 — D2):** phát hiện *"Conversation history not forwarded (multi-turn context lost)"* (xóa bỏ false positive *"Unbounded history"*).<br>- ✅ **`CB-CFG-01` (`LOW`, -5 — D5):** khuyến nghị hạ `temperature: 1.0` xuống `<= 0.3` cho chatbot bám tài liệu. |

---

## 4. Kết Quả Chạy Thật `npm --prefix server run test:evaluation`

```text
> server@1.0.0 test:evaluation
> node --experimental-vm-modules node_modules/jest/bin/jest.js src/tests/aiEvaluation

(node:22896) ExperimentalWarning: VM Modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS src/tests/aiEvaluation.scoring.test.js
PASS src/tests/aiEvaluation.preMvp4Review.test.js (9.389 s)
PASS src/tests/aiEvaluation.mvp1.test.js (9.561 s)
PASS src/tests/aiEvaluation.integration.test.js (13.244 s)
PASS src/tests/aiEvaluation.mvp2.test.js (14.29 s)
PASS src/tests/aiEvaluation.mvp3.test.js (14.626 s)

Test Suites: 6 passed, 6 total
Tests:       40 passed, 40 total
Snapshots:   0 total
Time:        18.029 s
Ran all test suites matching /src\\tests\\aiEvaluation/i.
```

---

## 5. Kết Quả Chạy Thật Bộ Kiểm Thử Bảo Mật Upload / GitHub Import

```text
> server@1.0.0 test
> node --experimental-vm-modules node_modules/jest/bin/jest.js src/tests/uploadArchiveSecurity.test.js

(node:9644) ExperimentalWarning: VM Modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS src/tests/uploadArchiveSecurity.test.js
  Archive Upload & GitHub Import Secret File Blacklist (.env, .env.*, .pem, .key)
    √ blocks .env, sub/.env, .env.local, .env.production, .pem, and .key in ZIP archives (29 ms)
    √ allows .env.example, .env.sample, and .env.template at root and subdirectories (1 ms)
    √ applies identical basename rules to Windows backslash paths and cloned GitHub workspaces (12 ms)

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
Snapshots:   0 total
Time:        3.295 s, estimated 5 s
Ran all test suites matching /src\\tests\\uploadArchiveSecurity.test.js/i.
```
