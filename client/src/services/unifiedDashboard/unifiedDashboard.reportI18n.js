/**
 * Bilingual EN / VI dictionary, NFC normalization, and Testing Layer guides
 * for CovAI Overview Quality Reports (`build-report` compliant).
 */

export const VALID_REPORT_LANGUAGES = ["bilingual", "en", "vi"];

/**
 * Normalize any text value to Unicode NFC so Vietnamese diacritics render cleanly.
 */
export function nfc(value) {
  if (value === null || value === undefined) return "";
  return String(value).normalize("NFC");
}

/**
 * Normalize language selector value ("bilingual" | "en" | "vi").
 */
export function normalizeReportLanguage(language) {
  const raw = String(language || "bilingual").trim().toLowerCase();
  if (raw === "en" || raw === "english") return "en";
  if (raw === "vi" || raw === "vn" || raw === "vietnamese") return "vi";
  return "bilingual";
}

/**
 * Format a timestamp into human-readable copy (no raw ISO dates in visible prose).
 */
export function formatHumanDate(dateInput = new Date(), language = "bilingual") {
  const d =
    dateInput instanceof Date
      ? dateInput
      : new Date(dateInput || Date.now());
  const validDate = Number.isNaN(d.getTime()) ? new Date() : d;

  const enStr = validDate.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const viStr = validDate.toLocaleString("vi-VN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const lang = normalizeReportLanguage(language);
  if (lang === "en") return nfc(enStr);
  if (lang === "vi") return nfc(viStr);
  return nfc(`${enStr} (${viStr})`);
}

/**
 * Resolve localized text based on selected language mode.
 */
export function pickText(enText, viText, language = "bilingual", separator = " / ") {
  const lang = normalizeReportLanguage(language);
  const en = nfc(enText);
  const vi = nfc(viText);
  if (lang === "en") return en;
  if (lang === "vi") return vi;
  if (en === vi) return en;
  return nfc(`${en}${separator}${vi}`);
}

export function translateGateStatus(status, label) {
  const s = String(status || "").toUpperCase();
  if (s === "PASSED") {
    return {
      en: "READY TO RELEASE",
      vi: nfc("Sẵn sàng phát hành (Đạt cổng chất lượng)"),
      tone: "pass",
    };
  }
  if (s === "FAILED") {
    return {
      en: "BLOCKED",
      vi: nfc("Bị chặn (Không đạt cổng chất lượng)"),
      tone: "fail",
    };
  }
  if (s === "WARNING") {
    return {
      en: "AT RISK",
      vi: nfc("Có rủi ro (Cần khắc phục trước khi phát hành)"),
      tone: "warn",
    };
  }
  return {
    en: label || "UNVERIFIED • NOT RUN",
    vi: nfc("Chưa xác minh • Chưa chạy kiểm thử"),
    tone: "neutral",
  };
}

export function translatePyramidShape(shape, badgeTitle, warning) {
  const map = {
    pyramid: {
      enTitle: "Balanced Testing Pyramid",
      viTitle: nfc("Kim tự tháp Kiểm thử Cân bằng"),
      enExplain:
        "Unit tests form a wide, fast base; Integration tests validate API contracts in the middle; System (E2E) tests stay focused at the top.",
      viExplain: nfc(
        "Kiểm thử Đơn vị tạo nền tảng rộng và nhanh ở đáy; Kiểm thử Tích hợp xác minh hợp đồng API ở tầng giữa; Kiểm thử Hệ thống (E2E) tập trung gọn vào các luồng cốt lõi ở đỉnh."
      ),
    },
    "missing-unit": {
      enTitle: "Unbalanced Pyramid — Missing Unit Test Foundation",
      viTitle: nfc("Kim tự tháp Mất cân đối — Thiếu nền tảng Kiểm thử Đơn vị"),
      enExplain:
        "Integration or System tests ran without any Unit test base. Defects are caught late, slowly, and without function-level isolation.",
      viExplain: nfc(
        "Đã chạy Kiểm thử Tích hợp hoặc Hệ thống nhưng chưa có Kiểm thử Đơn vị làm nền. Lỗi bị phát hiện muộn, chậm và khó khoanh vùng tới từng hàm."
      ),
    },
    "ice-cream-cone": {
      enTitle: "Inverted Pyramid (Ice-Cream Cone Anti-Pattern)",
      viTitle: nfc("Kim tự tháp Đảo ngược (Phản mẫu Kem ốc quế)"),
      enExplain:
        "System (E2E) tests outnumber Unit tests, making the suite slow, brittle to UI changes, and expensive to diagnose.",
      viExplain: nfc(
        "Số lượng kiểm thử Hệ thống (E2E) nhiều hơn Kiểm thử Đơn vị, khiến bộ kiểm thử chậm, dễ gãy khi đổi giao diện và tốn công gỡ lỗi."
      ),
    },
    hourglass: {
      enTitle: "Hourglass Distribution (Weak Integration Layer)",
      viTitle: nfc("Phân bố Đồng hồ cát (Tầng Tích hợp mỏng)"),
      enExplain:
        "Unit and System tests exist, but Integration coverage between them is thin, leaving API, auth middleware, and database contracts exposed.",
      viExplain: nfc(
        "Có Kiểm thử Đơn vị và E2E nhưng tầng Tích hợp ở giữa quá mỏng, dễ bỏ sót lỗi hợp đồng API, phân quyền và cơ sở dữ liệu."
      ),
    },
    "unit-only": {
      enTitle: "Unit-Only Foundation (Missing Integration & E2E)",
      viTitle: nfc("Chỉ có Kiểm thử Đơn vị (Thiếu Tích hợp & E2E)"),
      enExplain:
        "Only isolated Unit tests ran. Service wiring, HTTP routes, database queries, and end-to-end user journeys remain unverified.",
      viExplain: nfc(
        "Mới chỉ chạy Kiểm thử Đơn vị cô lập. Kết nối API, truy vấn cơ sở dữ liệu và luồng thao tác người dùng thực tế chưa được kiểm chứng."
      ),
    },
    partial: {
      enTitle: "Partial Pyramid (Missing System E2E Layer)",
      viTitle: nfc("Kim tự tháp Chưa đầy đủ (Thiếu Kiểm thử Hệ thống E2E)"),
      enExplain:
        "Unit and Integration suites ran, but no System (E2E) journeys ran to verify real browser/UI flows end-to-end.",
      viExplain: nfc(
        "Đã chạy Kiểm thử Đơn vị và Tích hợp, nhưng chưa có kịch bản E2E để xác minh trải nghiệm người dùng đầu-cuối trên giao diện thực."
      ),
    },
    unbalanced: {
      enTitle: "Unbalanced Pyramid — Top/Middle Heavy",
      viTitle: nfc("Kim tự tháp Lệch tầng — Nặng phần giữa/trên"),
      enExplain:
        "Integration tests equal or outnumber Unit tests. Expanding Unit tests speeds up feedback and lowers maintenance overhead.",
      viExplain: nfc(
        "Số lượng kiểm thử Tích hợp ngang hoặc nhiều hơn Kiểm thử Đơn vị. Cần bổ sung Kiểm thử Đơn vị để rút ngắn thời gian phản hồi."
      ),
    },
    insufficient: {
      enTitle: "No Tests Executed — Run Suites to Establish Baseline",
      viTitle: nfc("Chưa có Kiểm thử nào được chạy — Cần chạy để lập mốc chuẩn"),
      enExplain:
        "Zero automated tests have executed on this snapshot across Unit, Integration, and System layers. Unrun metrics do not indicate 0% test failure.",
      viExplain: nfc(
        "Chưa có bài kiểm thử tự động nào chạy trên snapshot này ở cả 3 tầng. Trạng thái Chưa chạy nghĩa là chưa xác minh rủi ro, không phải tỷ lệ trượt 0%."
      ),
    },
  };

  const entry = map[shape] || {
    enTitle: badgeTitle || "Testing Pyramid Assessment",
    viTitle: nfc(badgeTitle || "Đánh giá Kim tự tháp Kiểm thử"),
    enExplain: warning || "Distribution across Unit, Integration, and System layers.",
    viExplain: nfc(warning || "Phân bố số lượng bài kiểm thử qua 3 tầng Đơn vị, Tích hợp và Hệ thống."),
  };

  return {
    enTitle: nfc(entry.enTitle),
    viTitle: nfc(entry.viTitle),
    enExplain: nfc(entry.enExplain),
    viExplain: nfc(entry.viExplain),
  };
}

export const STANDARD_PYRAMID_BADGE_TITLES = new Set([
  "Balanced Pyramid",
  "Balanced Testing Pyramid",
  "Unbalanced Pyramid — Missing Unit Test Foundation",
  "Inverted Pyramid (Ice-Cream Cone Anti-Pattern)",
  "Hourglass Distribution (Weak Integration Layer)",
  "Unit-Only Foundation (Missing Integration & E2E)",
  "Partial Pyramid (Missing E2E Tests)",
  "Partial Pyramid (Missing System E2E Layer)",
  "Unbalanced Pyramid — Top/Middle Heavy",
  "No Tests Executed — Run suites to establish baseline",
  "No Tests Executed — Run Suites to Establish Baseline",
  "No Tests Executed",
  "Pyramid Assessment",
]);

export function translateChecklistItem(chk = {}, language = "bilingual") {
  const lang = normalizeReportLanguage(language);
  const id = String(chk?.id || "");
  const rawLabel = nfc(chk?.label || "");
  const rawVal = nfc(chk?.currentValue ?? "—");

  const labelById = {
    "chk-unit-branch": {
      en: "Unit Branch Coverage >= 75%",
      vi: nfc("Độ phủ Nhánh Đơn vị >= 75%"),
    },
    "chk-api-endpoint": {
      en: "API Endpoint Coverage >= 80%",
      vi: nfc("Độ phủ Điểm cuối API >= 80%"),
    },
    "chk-e2e-passing": {
      en: "Critical E2E Journeys Passing = 100%",
      vi: nfc("Kịch bản E2E trọng yếu Đạt = 100%"),
    },
    "chk-zero-defects": {
      en: "Zero High-Severity Cross-Layer Defects",
      vi: nfc("Không có Lỗi Nghiêm trọng Đa tầng"),
    },
  };

  let label = rawLabel;
  const matched = labelById[id];
  if (matched) {
    label = lang === "vi" ? matched.vi : lang === "en" ? matched.en : rawLabel || matched.en;
  } else if (lang === "vi") {
    label = rawLabel
      .replace(/Unit Branch Coverage/gi, "Độ phủ Nhánh Đơn vị")
      .replace(/API Endpoint Coverage/gi, "Độ phủ Điểm cuối API")
      .replace(/Critical E2E Journeys Passing/gi, "Kịch bản E2E trọng yếu Đạt")
      .replace(/Zero High-Severity Cross-Layer Defects/gi, "Không có Lỗi Nghiêm trọng Đa tầng");
  }

  let currentValue = rawVal;
  if (lang === "vi") {
    currentValue = rawVal
      .replace(/\bUnverified\b/gi, "Chưa xác minh")
      .replace(/\bJourneys\b/gi, "Luồng")
      .replace(/\bJourney\b/gi, "Luồng")
      .replace(/\bdefects\b/gi, "lỗi")
      .replace(/\bdefect\b/gi, "lỗi");
  }

  return {
    label: nfc(label),
    currentValue: nfc(currentValue),
  };
}

export function translateSuspectLayer(layer, language = "bilingual") {
  const lang = normalizeReportLanguage(language);
  const raw = String(layer || "none").trim();
  const key = raw.toLowerCase();
  if (lang !== "vi") return nfc(raw || "none");
  if (key === "unit") return nfc("Đơn vị");
  if (key === "integration") return nfc("Tích hợp");
  if (key === "system") return nfc("Hệ thống (E2E)");
  if (key === "none" || !key) return nfc("không có");
  return nfc(raw);
}

export function translateMatrixCellLabel(label, status, language = "bilingual") {
  const lang = normalizeReportLanguage(language);
  const raw = nfc(label || "");
  if (lang !== "vi") {
    return raw || String(status || "N/A").toUpperCase();
  }
  if (!raw) {
    const s = String(status || "").toLowerCase();
    if (s === "pass" || s === "passed") return nfc("Đạt");
    if (s === "fail" || s === "failed") return nfc("Trượt");
    if (s === "warn" || s === "warning") return nfc("Cảnh báo");
    return nfc("Chưa chạy");
  }
  return nfc(
    raw
      .replace(/\(Not run\)/gi, "(Chưa chạy)")
      .replace(/\bNot run\b/gi, "Chưa chạy")
      .replace(/\bcovered\b/gi, "đã phủ")
      .replace(/\bjourneys\b/gi, "luồng")
      .replace(/\bAPIs\b/g, "API")
      .replace(/\bcov\b/gi, "phủ")
  );
}

export function translateHistoryStatus(status, language = "bilingual") {
  const lang = normalizeReportLanguage(language);
  const s = String(status || "").toUpperCase();
  if (lang !== "vi") return s || "N/A";
  if (s === "PASS" || s === "PASSED") return nfc("ĐẠT");
  if (s === "FAIL" || s === "FAILED") return nfc("TRƯỢT");
  if (s === "COMPLETED") return nfc("HOÀN TẤT");
  if (s === "WARN" || s === "WARNING") return nfc("CẢNH BÁO");
  if (s === "RUNNING") return nfc("ĐANG CHẠY");
  return nfc(s || "CHƯA RÕ");
}

export const LAYER_GUIDES = {
  unit: {
    id: "unit",
    weightPct: 50,
    en: {
      name: "Unit Tests",
      roleTag: "Foundation Layer • 50% Weight",
      whatItVerifies:
        "Validates individual functions, pure business logic, edge cases, and conditional branches in isolation with dependencies mocked or stubbed.",
      scopeAndSpeed:
        "Fastest feedback loop (milliseconds per test); pinpoints the exact file and branch where logic regresses.",
      metricsMeaning:
        "Line Coverage measures executed code lines (target >= 70%); Branch Coverage measures tested if/else/ternary decision paths (Quality Gate >= 75%).",
      gapInterpretation:
        "Low Unit coverage or failing Unit tests mean core business rules can fail silently or propagate defects upward into Integration and E2E suites.",
      notRunGuidance:
        "When totalTests = 0 (NOT_RUN), code logic correctness is unverified for this snapshot even if static file inventory lists uncovered files.",
    },
    vi: {
      name: nfc("Kiểm thử Đơn vị (Unit Test)"),
      roleTag: nfc("Tầng nền tảng • Trọng số 50%"),
      whatItVerifies: nfc(
        "Kiểm tra từng hàm, logic nghiệp vụ thuần túy, các trường hợp biên và nhánh điều kiện trong trạng thái cô lập (dùng mock/stub cho phần phụ thuộc)."
      ),
      scopeAndSpeed: nfc(
        "Phản hồi nhanh nhất (tính bằng mili-giây); khoanh vùng chính xác đến từng tệp và từng nhánh mã bị lỗi."
      ),
      metricsMeaning: nfc(
        "Độ phủ Dòng (Line Coverage, mục tiêu >= 70%) đo tỷ lệ dòng lệnh đã chạy; Độ phủ Nhánh (Branch Coverage, cổng >= 75%) đo tỷ lệ nhánh rẽ if/else đã kiểm chứng."
      ),
      gapInterpretation: nfc(
        "Độ phủ Đơn vị thấp hoặc có test trượt cho thấy logic cốt lõi có nguy cơ sai sót ngầm và có thể kéo theo lỗi dây chuyền ở tầng Tích hợp và E2E."
      ),
      notRunGuidance: nfc(
        "Khi totalTests = 0 (Chưa chạy), tính đúng đắn của logic chưa được xác minh trên snapshot này, kể cả khi phân tích tĩnh liệt kê các tệp chưa phủ."
      ),
    },
  },
  integration: {
    id: "integration",
    weightPct: 30,
    en: {
      name: "Integration Tests",
      roleTag: "Contract Layer • 30% Weight",
      whatItVerifies:
        "Verifies how modules work together across HTTP routes, authentication middleware, request validation, controllers, and database queries.",
      scopeAndSpeed:
        "Moderate speed (tens to hundreds of ms per test); catches contract mismatches, auth bypasses, and SQL/ORM errors that mocked Unit tests miss.",
      metricsMeaning:
        "API Endpoint Coverage = Covered AST Endpoints / Total Discovered Endpoints (Quality Gate >= 80%). Untested AST endpoints are tracked separately as Uncovered APIs—never counted as test failures.",
      gapInterpretation:
        "If Unit tests pass while Integration fails, the defect usually lies in route wiring, auth/RBAC middleware, payload serialization, or database constraints.",
      notRunGuidance:
        "When totalTests = 0 (NOT_RUN), AST-discovered endpoints remain in Uncovered APIs (unverified), while executed failure counts remain 0.",
    },
    vi: {
      name: nfc("Kiểm thử Tích hợp (Integration Test)"),
      roleTag: nfc("Tầng hợp đồng API • Trọng số 30%"),
      whatItVerifies: nfc(
        "Xác minh sự phối hợp giữa các mô-đun qua tuyến HTTP (route), lớp xác thực/phân quyền (middleware), kiểm tra dữ liệu đầu vào, controller và truy vấn cơ sở dữ liệu."
      ),
      scopeAndSpeed: nfc(
        "Tốc độ trung bình; phát hiện lệch hợp đồng dữ liệu, lỗi phân quyền và lỗi DB mà kiểm thử Đơn vị (vốn dùng mock) không thấy được."
      ),
      metricsMeaning: nfc(
        "Độ phủ API = Số API được kiểm thử / Tổng số API phát hiện qua AST (Cổng >= 80%). Các API chưa có test được tách riêng thành 'API chưa phủ', KHÔNG tính là bài test trượt."
      ),
      gapInterpretation: nfc(
        "Nếu Đơn vị đạt nhưng Tích hợp trượt, nguyên nhân thường nằm ở định tuyến API, middleware xác thực, controller hoặc ràng buộc dữ liệu."
      ),
      notRunGuidance: nfc(
        "Khi totalTests = 0 (Chưa chạy), các endpoint phát hiện từ AST nằm ở mục 'API chưa phủ' (chưa xác minh), không bị tính thành lỗi test thất bại."
      ),
    },
  },
  system: {
    id: "system",
    weightPct: 20,
    en: {
      name: "System Tests (E2E)",
      roleTag: "User Journey Layer • 20% Weight",
      whatItVerifies:
        "Exercises complete end-to-end user journeys through the rendered frontend UI, network calls, backend APIs, and persistence layer.",
      scopeAndSpeed:
        "Slowest and most realistic layer (seconds per journey); validates critical flows, UI rendering, navigation, and real environment stability.",
      metricsMeaning:
        "User Flow Coverage measures verified end-to-end journey/UI coverage (warning < 50%, target 80%), while the Quality Gate requires 100% of executed E2E journeys passing with 0 flaky tests.",
      gapInterpretation:
        "If Unit and Integration pass while System E2E fails, the root cause typically involves UI selectors, client state synchronization, timeouts, or environment wiring.",
      notRunGuidance:
        "When totalTests = 0 (NOT_RUN), end-to-end user experience and browser integration remain unverified for this release candidate.",
    },
    vi: {
      name: nfc("Kiểm thử Hệ thống (System / E2E)"),
      roleTag: nfc("Tầng hành trình người dùng • Trọng số 20%"),
      whatItVerifies: nfc(
        "Kiểm tra toàn bộ hành trình người dùng đầu-cuối (end-to-end) từ giao diện trình duyệt, gọi mạng, xử lý API backend tới lưu trữ dữ liệu thực tế."
      ),
      scopeAndSpeed: nfc(
        "Chạy chậm nhất nhưng sát thực tế nhất (tính bằng giây); bảo chứng các luồng nghiệp vụ trọng yếu và độ ổn định giao diện."
      ),
      metricsMeaning: nfc(
        "Độ phủ Luồng Người dùng (cảnh báo < 50%, mục tiêu 80%) đo mức độ bao phủ kịch bản E2E; Cổng Chất lượng yêu cầu 100% kịch bản E2E đã chạy phải đạt và không có test chập chờn (flaky)."
      ),
      gapInterpretation: nfc(
        "Nếu Đơn vị và Tích hợp đều đạt nhưng E2E trượt, lỗi thường đến từ bộ chọn giao diện (selector), đồng bộ trạng thái frontend, timeout mạng hoặc cấu hình môi trường."
      ),
      notRunGuidance: nfc(
        "Khi totalTests = 0 (Chưa chạy), trải nghiệm người dùng đầu-cuối trên giao diện thực vẫn chưa được xác minh cho bản phát hành này."
      ),
    },
  },
};

export const CROSS_LAYER_DIAGNOSIS_GUIDE = [
  {
    patternEn: "Unit PASS · Integration PASS · System PASS",
    patternVi: nfc("Đơn vị Đạt · Tích hợp Đạt · Hệ thống Đạt"),
    meaningEn: "Full-stack confidence: business logic, API contracts, and user journeys align.",
    meaningVi: nfc("Độ tin cậy toàn diện: logic, hợp đồng API và luồng người dùng đều đồng nhất."),
  },
  {
    patternEn: "Unit FAIL · Integration/System FAIL",
    patternVi: nfc("Đơn vị Trượt · Tích hợp/Hệ thống Trượt"),
    meaningEn: "Bottom-up logic defect: fix the Unit layer first before debugging higher layers.",
    meaningVi: nfc("Lỗi logic từ tầng đáy: cần sửa Kiểm thử Đơn vị trước khi gỡ lỗi ở các tầng trên."),
  },
  {
    patternEn: "Unit PASS · Integration FAIL",
    patternVi: nfc("Đơn vị Đạt · Tích hợp Trượt"),
    meaningEn: "Boundary/contract defect in routing, auth middleware, controller mapping, or database.",
    meaningVi: nfc("Lỗi giao tiếp/hợp đồng tại route, middleware xác thực, controller hoặc cơ sở dữ liệu."),
  },
  {
    patternEn: "Unit PASS · Integration PASS · System FAIL",
    patternVi: nfc("Đơn vị Đạt · Tích hợp Đạt · Hệ thống Trượt"),
    meaningEn: "Frontend/E2E issue: broken UI selector, client state bug, CORS, or network timeout.",
    meaningVi: nfc("Lỗi ở giao diện/E2E: sai selector, lỗi trạng thái frontend, CORS hoặc quá thời gian phản hồi."),
  },
  {
    patternEn: "Any Layer NOT_RUN (0 tests)",
    patternVi: nfc("Bất kỳ tầng nào Chưa chạy (0 test)"),
    meaningEn: "Unverified blind spot: contributes 0 to the 50/30/20 weighted index until executed.",
    meaningVi: nfc("Điểm mù chưa xác minh: tầng này đóng góp 0 vào chỉ số trọng số 50/30/20 cho tới khi được chạy."),
  },
];

export const METHODOLOGY_ITEMS = [
  {
    enTitle: "Pass Rate Denominator",
    viTitle: nfc("Công thức Tỷ lệ Đạt (Pass Rate)"),
    enBody: "Pass Rate = Passed / (Passed + Failed). Skipped tests are reported separately and do not inflate or penalize pass rate.",
    viBody: nfc("Tỷ lệ Đạt = Đạt / (Đạt + Trượt). Các bài test bị bỏ qua (Skipped) được thống kê riêng, không làm sai lệch tỷ lệ đạt."),
  },
  {
    enTitle: "50 / 30 / 20 Weighted Coverage & Health Model",
    viTitle: nfc("Mô hình Trọng số 50 / 30 / 20"),
    enBody: "Overall Coverage = 50% Unit Lines + 30% Integration API Endpoints + 20% System Flows. Health Score blends 50% pass rate and 50% coverage per layer using the same 50/30/20 weights, minus up to 15 pts for failing tests.",
    viBody: nfc("Độ phủ Tổng hợp = 50% Dòng Đơn vị + 30% API Tích hợp + 20% Luồng E2E. Điểm Sức khỏe kết hợp 50% tỷ lệ đạt + 50% độ phủ theo đúng trọng số 50/30/20, trừ tối đa 15 điểm nếu có test trượt."),
  },
  {
    enTitle: "NOT_RUN vs. 0% Execution Failure & Uncovered APIs",
    viTitle: nfc("Phân biệt Chưa chạy (NOT_RUN) với Lỗi 0% & API chưa phủ"),
    enBody: "A layer with 0 executed tests is marked NOT_RUN (unverified), contributing 0 to the weighted index without inflating executed failures. AST-discovered endpoints lacking integration tests are counted under Uncovered APIs, never as failed tests.",
    viBody: nfc("Tầng có 0 bài test được gắn nhãn Chưa chạy (chưa xác minh), đóng góp 0 vào chỉ số tổng hợp và không tính là thất bại. Các API chưa có test (Uncovered APIs) được tách riêng khỏi số lượng bài test trượt."),
  },
  {
    enTitle: "Snapshot & Print Caveat",
    viTitle: nfc("Lưu ý Dữ liệu Snapshot"),
    enBody: "All metrics reflect the selected CovAI snapshot state at export time. Partial or unrun suites require running the missing layers to unlock full Quality Gate verification.",
    viBody: nfc("Toàn bộ số liệu phản ánh đúng trạng thái snapshot tại thời điểm xuất báo cáo. Khi có tầng chưa chạy, cần chạy bổ sung tầng còn thiếu để đánh giá đầy đủ Cổng Chất lượng."),
  },
];

export const FAILURE_CATEGORY_LABELS = {
  unitFailed: { en: "Unit Failures", vi: nfc("Lỗi Đơn vị") },
  route: { en: "Route Wiring", vi: nfc("Định tuyến Route") },
  middlewareAuth: { en: "Auth Middleware", vi: nfc("Xác thực Middleware") },
  controller: { en: "Controller Logic", vi: nfc("Xử lý Controller") },
  database: { en: "Database / ORM", vi: nfc("Cơ sở dữ liệu") },
  selectorNotFound: { en: "E2E Selector", vi: nfc("Bộ chọn UI") },
  networkTimeout: { en: "Network Timeout", vi: nfc("Quá thời gian") },
  assertion: { en: "E2E Assertion", vi: nfc("Khẳng định E2E") },
  flaky: { en: "Flaky Tests", vi: nfc("Test Chập chờn") },
};

export const ACTION_PRIORITY_LABELS = {
  CRITICAL: { en: "CRITICAL", vi: nfc("NGHIÊM TRỌNG") },
  HIGH: { en: "HIGH", vi: nfc("CAO") },
  MEDIUM: { en: "MEDIUM", vi: nfc("TRUNG BÌNH") },
  LOW: { en: "LOW", vi: nfc("THẤP") },
};

export const REPORT_COPY = {
  brand: {
    en: "CovAI Quality Analytics",
    vi: nfc("Phân tích Chất lượng CovAI"),
  },
  titlePrefix: {
    en: "Testing Quality & Coverage Report",
    vi: nfc("Báo cáo Chất lượng & Độ phủ Kiểm thử"),
  },
  metaLabels: {
    branch: { en: "Branch", vi: nfc("Nhánh") },
    snapshot: { en: "Snapshot", vi: nfc("Snapshot") },
    generated: { en: "Generated", vi: nfc("Thời điểm xuất") },
    qualityGate: { en: "Quality Gate", vi: nfc("Cổng Chất lượng") },
    healthScore: { en: "Health Score", vi: nfc("Điểm Sức khỏe") },
    grade: { en: "Grade", vi: nfc("Hạng") },
    scale: { en: "Scale 0–100", vi: nfc("Thang 0–100") },
    notRun: { en: "Not Run", vi: nfc("Chưa chạy") },
    unverified: { en: "Unverified", vi: nfc("Chưa xác minh") },
  },
  sectionTitles: {
    executiveSummary: {
      en: "Executive Summary",
      vi: nfc("Tóm tắt Điều hành"),
    },
    kpiStrip: {
      en: "Headline Quality Indicators",
      vi: nfc("Chỉ số Chất lượng Trọng tâm"),
    },
    overviewCharts: {
      en: "3-Tier Statistical Overview",
      vi: nfc("Tổng quan Thống kê 3 Tầng"),
    },
    overviewChartsSubtitle: {
      en: "Unit, Integration, and System metrics across coverage, outcomes, trajectory, and module risk.",
      vi: nfc("Số liệu Đơn vị, Tích hợp và Hệ thống về độ phủ, kết quả, xu hướng và rủi ro mô-đun."),
    },
    keyFindings: {
      en: "Key Findings & 3-Tier Metrics",
      vi: nfc("Phát hiện Chính & Chỉ số 3 Tầng"),
    },
    criticalGaps: {
      en: "Critical Gaps & Failures",
      vi: nfc("Khoảng trống Trọng yếu & Lỗi"),
    },
    layerGuide: {
      en: "Understanding Unit, Integration, and System (E2E) Testing",
      vi: nfc("Giải thích 3 tầng Kiểm thử: Đơn vị, Tích hợp và Hệ thống (E2E)"),
    },
    diagram1: {
      en: "Multi-Layer Coverage & Pass Rate vs. Quality Targets",
      vi: nfc("Độ phủ & Tỷ lệ Đạt Đa tầng so với Ngưỡng Mục tiêu"),
    },
    diagramUnitDimensions: {
      en: "Unit & Integration 4-Metric Code Coverage Breakdown",
      vi: nfc("Độ phủ Mã nguồn 4 Chiều (Đơn vị & Tích hợp)"),
    },
    diagram2: {
      en: "Testing Pyramid Balance & Execution Outcome Distribution",
      vi: nfc("Cân bằng Kim tự tháp Kiểm thử & Phân bố Kết quả Thực thi"),
    },
    diagramDurationVolume: {
      en: "Per-Layer Execution Volume & Duration Latency",
      vi: nfc("Khối lượng Thực thi & Thời lượng theo Tầng"),
    },
    diagramFailureActions: {
      en: "Failure Root-Cause Distribution & Action Priority Backlog",
      vi: nfc("Phân bố Nguyên nhân Lỗi & Tồn đọng Hành động Ưu tiên"),
    },
    diagram3Trend: {
      en: "Coverage & Pass-Rate Trend",
      vi: nfc("Xu hướng Độ phủ & Tỷ lệ Đạt"),
    },
    diagram3Variance: {
      en: "Gate Baseline & 50/30/20 Weighting",
      vi: nfc("Mốc Chuẩn Cổng & Trọng số 50/30/20"),
    },
    diagramApiHotspots: {
      en: "Low-Coverage File Hotspots & AST API Endpoint Coverage",
      vi: nfc("Điểm nóng Tệp Độ phủ thấp & Phân rã Độ phủ API (AST)"),
    },
    diagram4Matrix: {
      en: "Module × 3-Tier Test Health Matrix",
      vi: nfc("Ma trận Sức khỏe Mô-đun × 3 Tầng"),
    },
    diagram4Hotspots: {
      en: "3-Tier Verification Readiness Matrix",
      vi: nfc("Ma trận Sẵn sàng Xác minh 3 Tầng"),
    },
    actions: {
      en: "Prioritized Next Steps",
      vi: nfc("Các Bước Tiếp theo Ưu tiên"),
    },
    history: {
      en: "Recent Execution Runs",
      vi: nfc("Lịch sử Thực thi Gần đây"),
    },
    caveats: {
      en: "Caveats & Open Questions",
      vi: nfc("Lưu ý & Câu hỏi Mở"),
    },
    methodology: {
      en: "Methodology, Metric Definitions & Caveats",
      vi: nfc("Phương pháp tính, Định nghĩa Chỉ số & Lưu ý"),
    },
  },
  charts: {
    tierBar: {
      enTitle: "Tier Pass, Fail & Coverage vs. Gate",
      viTitle: nfc("Đạt, Trượt & Độ phủ 3 Tầng so với Ngưỡng"),
      enSubtitle: "0%–100% scale · Tier coverage (top) & pass/fail share (bottom) vs. dashed gate",
      viSubtitle: nfc("Thang 0%–100% · Độ phủ tầng (trên) & tỷ lệ đạt/trượt (dưới) so với ngưỡng"),
    },
    outcomeDonut: {
      enTitle: "Execution Outcomes & Tier Share",
      viTitle: nfc("Kết quả Thực thi & Tỷ trọng 3 Tầng"),
      enSubtitle: "Pass / Fail / Skip distribution of executed tests and 3-tier volume share",
      viSubtitle: nfc("Phân bố Đạt / Trượt / Bỏ qua trên tổng bài kiểm thử và tỷ trọng 3 tầng"),
    },
    trendLine: {
      enTitle: "Coverage & Pass-Rate Trend",
      viTitle: nfc("Xu hướng Độ phủ & Tỷ lệ Đạt"),
      enSubtitle: "Coverage % and Pass Rate % across recent runs vs. 80% gate baseline",
      viSubtitle: nfc("Tỷ lệ Độ phủ (%) và Tỷ lệ Đạt (%) qua các lần chạy so với mốc 80%"),
      enBaselineSubtitle: "Single-run snapshot baseline (< 2 recorded runs) vs. 80% gate",
      viBaselineSubtitle: nfc("Mốc chuẩn 1 lần chạy (< 2 lần chạy) so với ngưỡng cổng 80%"),
    },
    moduleHeatmap: {
      enTitle: "Module × 3-Tier Health Heatmap",
      viTitle: nfc("Bản đồ nhiệt Mô-đun × 3 Tầng"),
      enSubtitle: "Module pass ratio and health state across Unit, Integration, and System",
      viSubtitle: nfc("Tỷ lệ đạt và trạng thái sức khỏe mô-đun qua Đơn vị, Tích hợp và Hệ thống"),
      enEmptySubtitle: "3-tier readiness summary (no module matrix rows in this snapshot)",
      viEmptySubtitle: nfc("Tóm tắt sẵn sàng 3 tầng (snapshot chưa có dữ liệu ma trận mô-đun)"),
    },
  },
};
