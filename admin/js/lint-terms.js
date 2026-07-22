/* ============================================================================
 * lint-terms.js — 의료광고법 금지어 실시간 검사 (지아한의원 admin SPA)
 * ============================================================================
 * 포팅 원본: prub-sys/modules/medical-law/config/banned_terms.json
 *   version 1.0.0 / lastVerified 2026-05-17 / jurisdiction KR
 *   법적 근거: 의료법 §27(환자 유인 금지) · §56(의료광고 금지·제한)
 *             · 보건복지부 의료광고 사전심의 가이드라인 (2023.7 개정)
 * 포팅 방식: JSON 데이터를 JS 배열로 수동 변환 (생성 스크립트 없음).
 *   원본의 카테고리·대체어·context 한정을 그대로 유지. 어휘 추가/제거 시
 *   반드시 원본 JSON을 먼저 갱신하고 이 파일을 동기화한다 (단일 소스 = JSON).
 * 브라우저: window.LintTerms / Node(테스트): module.exports
 * ============================================================================
 * 판정 레벨:
 *   error = 발행 차단 (하드 게이트 — zia-cms-sprint.md 결정 trace 2026-07-22)
 *   warn  = 문맥 한정 어휘가 해당 문맥 근처 미검출 시 → 발행 가능, 주의 표시
 *           (원본 JSON의 "context" 필드 어휘: 문맥 검출 시 error로 승격)
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LintTerms = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "1.0.0"; // 원본 banned_terms.json version과 동기
  var SOURCE = "banned_terms.json v1.0.0 (2026-05-17)";

  // 카테고리 한국어 라벨 (원본 categories 키 → 원장 화면 표시용)
  var CATEGORY_LABELS = {
    "단정형_효능_결과": "치료 효과 단정",
    "비교_최상급_단정": "최고·1위 표현",
    "안전성_단정": "안전 보장 표현",
    "근본_원인_표현_제한": "근본·완벽 표현",
    "환자_유인_단정": "결과 보장 표현",
    "비공인_표현_전문병원": "비공인 명칭",
    "비용_유인_§27": "비용 미끼 표현",
    "타기관_비방": "타 병원 비교",
    "질환_검사_명칭": "비공인 질환·검사 명칭",
    "휴리스틱": "후기체 표현"
  };

  // 문맥 한정("context") 어휘의 근접 문맥 판별 규칙.
  //   null = 문맥 판별 불가 → 항상 error (보수적).
  //   RegExp = 매칭 위치 앞뒤 CONTEXT_WINDOW자 안에서 검출 시 error, 아니면 warn.
  var CONTEXT_RULES = {
    "치료 단정 맥락 한정": /치료|증상|통증|질환|병|진료|클리닉|디스크|비염|불면|난임|아토피/,
    "치료법 맥락 한정": /치료|한약|침|처방|시술|요법/,
    "병변·증상 맥락 한정": /증상|통증|병변|염증|지방|독소|노폐물|질환|혹|종양/,
    "단독 사용 시": null,
    "처방 맥락 한정": /처방|한약|약|탕|치료/,
    "병원 자칭 한정": /한의원|병원|의원|클리닉|본원|저희/,
    "진료비 맥락 한정": /진료|치료|시술|비용|가격|검사|상담|한약|첩약|약침/,
    "진료 유인 맥락 한정": /진료|치료|예약|상담|검진|할인|시술/,
    "교통사고 맥락 한정": null
  };
  var CONTEXT_WINDOW = 25; // 매칭 어휘 앞뒤로 살피는 글자 수

  /* --------------------------------------------------------------------------
   * 금지어 사전 — 원본 JSON categories 순서·내용 그대로 (총 68어휘 / 9 카테고리)
   * 10번째 카테고리 "허위_사실"은 어휘가 아닌 rules(방송출연·유명인 방문·미보유
   * 장비 창작 금지)라 어휘 검사 대상 아님 → 작성 가이드 문구로만 노출.
   * ------------------------------------------------------------------------ */
  var TERMS = [
    // ── 단정형_효능_결과: 치료 효과·결과 단정형 표현 (§56-1) — 13어휘 ──
    { term: "완치", category: "단정형_효능_결과", alternates: ["호전", "관리", "개선", "완화", "긍정적 변화"] },
    { term: "100%완치", category: "단정형_효능_결과", alternates: ["충분히 호전", "체계적 관리"] },
    { term: "100%", category: "단정형_효능_결과", alternates: ["충분히", "체계적으로"] },
    { term: "확실한 효과", category: "단정형_효능_결과", alternates: ["기대 효과", "관찰된 변화"] },
    { term: "절대 효과", category: "단정형_효능_결과", alternates: ["관찰된 효과"] },
    { term: "기적의", category: "단정형_효능_결과", alternates: ["주목할 만한"] },
    { term: "기적의 효과", category: "단정형_효능_결과", alternates: ["주목할 만한 변화"] },
    { term: "한 번에 해결", category: "단정형_효능_결과", alternates: ["단계적 접근"] },
    { term: "단 한 번에", category: "단정형_효능_결과", alternates: ["체계적 단계로"] },
    { term: "해결", category: "단정형_효능_결과", context: "치료 단정 맥락 한정", alternates: ["개선", "관리"] },
    { term: "탈출", category: "단정형_효능_결과", alternates: ["완화", "벗어남"] },
    { term: "졸업", category: "단정형_효능_결과", alternates: ["치료 완료", "관리 종료"] },
    { term: "정답", category: "단정형_효능_결과", context: "치료법 맥락 한정", alternates: ["꾸준한 치료"] },

    // ── 비교_최상급_단정: 비교·최상급 단정 표현 (§56-1) — 12어휘 ──
    { term: "1위", category: "비교_최상급_단정", alternates: ["숙련된", "앞서가는"] },
    { term: "No.1", category: "비교_최상급_단정", alternates: ["숙련된"] },
    { term: "최고", category: "비교_최상급_단정", alternates: ["숙련된"] },
    { term: "최고의", category: "비교_최상급_단정", alternates: ["숙련된"] },
    { term: "최상", category: "비교_최상급_단정", alternates: ["우수한 수준의"] },
    { term: "세계최초", category: "비교_최상급_단정", alternates: ["국내 도입"] },
    { term: "국내최초", category: "비교_최상급_단정", alternates: ["국내 도입"] },
    { term: "국내유일", category: "비교_최상급_단정", alternates: ["보기 드문"] },
    { term: "유일한", category: "비교_최상급_단정", alternates: ["특화된"] },
    { term: "유일한 치료", category: "비교_최상급_단정", alternates: ["특화된 치료"] },
    { term: "명가", category: "비교_최상급_단정", alternates: ["숙련된 의료진"] },
    { term: "명의", category: "비교_최상급_단정", alternates: ["숙련된 의료진", "전문 의료진"] },

    // ── 안전성_단정: 부작용 없음 / 안전 보장 표현 금지 (§56-1) — 5어휘 ──
    { term: "부작용없음", category: "안전성_단정", alternates: ["일반적으로 안정성 있음", "부작용 가능성 낮음"] },
    { term: "부작용 없음", category: "안전성_단정", alternates: ["일반적으로 안정성 있음"] },
    { term: "안전 보장", category: "안전성_단정", alternates: ["안전성 검토 완료"] },
    { term: "100% 안전", category: "안전성_단정", alternates: ["일반적으로 안전한 수준"] },
    { term: "무부작용", category: "안전성_단정", alternates: ["부작용 가능성 낮음"] },

    // ── 근본_원인_표현_제한: 근본·뿌리 등 과장 표현 (보건복지부 가이드) — 9어휘 ──
    { term: "근본 치료", category: "근본_원인_표현_제한", alternates: ["원인별 치료", "맞춤 치료"] },
    { term: "근본치료", category: "근본_원인_표현_제한", alternates: ["원인별 치료"] },
    { term: "근본", category: "근본_원인_표현_제한", alternates: ["신체 내부 원인", "주요 원인"] },
    { term: "뿌리", category: "근본_원인_표현_제한", alternates: ["깊은 원인"] },
    { term: "근원", category: "근본_원인_표현_제한", alternates: ["주요 원인"] },
    { term: "완벽한 치료", category: "근본_원인_표현_제한", alternates: ["체계적 치료"] },
    { term: "제거", category: "근본_원인_표현_제한", context: "병변·증상 맥락 한정", alternates: ["배출", "덜어냄"] },
    { term: "박멸", category: "근본_원인_표현_제한", alternates: ["배출"] },
    { term: "원인치료", category: "근본_원인_표현_제한", context: "단독 사용 시", alternates: ["원인별 치료", "맞춤 치료"] },

    // ── 환자_유인_단정: 치료 결과 보장 단정 표현 (§56-1) — 4어휘 ──
    { term: "보장합니다", category: "환자_유인_단정", alternates: ["기대됩니다", "관찰됩니다"] },
    { term: "확실히 낫습니다", category: "환자_유인_단정", alternates: ["호전이 기대됩니다"] },
    { term: "꼭 낫습니다", category: "환자_유인_단정", alternates: ["호전이 기대됩니다"] },
    { term: "무조건", category: "환자_유인_단정", alternates: ["일반적으로"] },

    // ── 비공인_표현_전문병원: 전문병원·주치의 등 미공인 표현 (의료법 §3-5) — 7어휘 ──
    { term: "한방의 비방", category: "비공인_표현_전문병원", alternates: ["전통 처방", "고전 처방"] },
    { term: "비방", category: "비공인_표현_전문병원", context: "처방 맥락 한정", alternates: ["전통 처방"] },
    { term: "전수받은 비법", category: "비공인_표현_전문병원", alternates: ["전승된 처방"] },
    { term: "전문병원", category: "비공인_표현_전문병원", alternates: ["집중진료", "주요진료"] },
    { term: "특화", category: "비공인_표현_전문병원", context: "병원 자칭 한정", alternates: ["집중진료"] },
    { term: "주치의", category: "비공인_표현_전문병원", alternates: ["전담 의료진"] },
    { term: "난치성", category: "비공인_표현_전문병원", alternates: ["만성", "잘 낫지 않는"] },

    // ── 비용_유인_§27: 환자 유인 행위 금지 (의료법 §27-3) — 11어휘 ──
    { term: "무료 진료", category: "비용_유인_§27", alternates: ["건강보험 적용", "비용 부담 완화"] },
    { term: "공짜 진료", category: "비용_유인_§27", alternates: ["건강보험 적용"] },
    { term: "무료", category: "비용_유인_§27", context: "진료비 맥락 한정", alternates: ["건강보험 적용"] },
    { term: "공짜", category: "비용_유인_§27", context: "진료비 맥락 한정", alternates: ["건강보험 적용"] },
    { term: "할인", category: "비용_유인_§27", context: "진료비 맥락 한정", alternates: ["비용 부담 완화"] },
    { term: "할인 이벤트", category: "비용_유인_§27", alternates: ["비용 부담 완화 안내"] },
    { term: "이벤트", category: "비용_유인_§27", context: "진료 유인 맥락 한정", alternates: ["안내"] },
    { term: "반값", category: "비용_유인_§27", alternates: ["비용 부담 완화"] },
    { term: "최저가", category: "비용_유인_§27", alternates: ["합리적인 비용"] },
    { term: "본인부담금 0원", category: "비용_유인_§27", alternates: ["자동차보험 적용"] },
    { term: "자부담 없음", category: "비용_유인_§27", context: "교통사고 맥락 한정", alternates: ["자동차보험 적용"] },

    // ── 타기관_비방: 타 의료기관 비교·비방 금지 (§56-1) — 3어휘 ──
    { term: "수술 없이", category: "타기관_비방", alternates: ["비수술적 요법", "보존적 치료"] },
    { term: "수술 안 하고", category: "타기관_비방", alternates: ["비수술적 요법"] },
    { term: "필승", category: "타기관_비방", alternates: ["기대되는 효과"] },

    // ── 질환_검사_명칭: 비공인 질환·검사 명칭 (보건복지부 표준 용어 권장) — 4어휘 ──
    { term: "키성장", category: "질환_검사_명칭", alternates: ["성장장애", "성장부진"] },
    { term: "디톡스", category: "질환_검사_명칭", alternates: ["노폐물 배출", "순환 개선"] },
    { term: "해독", category: "질환_검사_명칭", context: "치료 단정 맥락 한정", alternates: ["노폐물 배출"] },
    { term: "재발 방지", category: "질환_검사_명칭", alternates: ["재발 예방"] }
  ];

  // "허위_사실" 카테고리 rules — 어휘 자동 검사 불가, 작성 가이드에 노출 (§56-2)
  var FACT_RULES = [
    "방송 출연·언론 보도는 사실이 아닌 내용을 만들어 쓰면 안 돼요",
    "연예인·유명인 방문은 사실이 아닌 내용을 만들어 쓰면 안 돼요",
    "실제로 없는 장비·인증은 표시하면 안 돼요"
  ];

  /* --------------------------------------------------------------------------
   * 휴리스틱 — 후기(치료경험담) 패턴. 사양: zia-cms-sprint.md 결정 trace
   *   (banned_terms 어휘 검사 + 1인칭 후기체 휴리스틱)
   * ------------------------------------------------------------------------ */
  // H1. 수치+단위+결과: "13kg 뺐어요", "3개월 만에 성공" 류
  var NUM_RESULT_RE = /\d+(?:[.,]\d+)?\s*(?:kg|킬로(?:그램)?|일|주|개월|달|년|회|cm)\s*(?:만에|뺐|감량|성공|빠졌|줄었)[가-힣]*/g;
  // H2. 한글 기간+만에: "일주일만에", "한 달 만에" 류 (숫자 없는 기간 강조)
  var KO_NUM_RESULT_RE = /(?:하루|이틀|사흘|나흘|일주일|보름|(?:한|두|세|네)\s?(?:달|주|번|차례|개월))\s*만에[가-힣]*/g;
  // H3. 1인칭 경험담 어미 (치료·효과 문맥과 함께 쓰일 때만 error)
  var EXPERIENCE_ENDING_RE = /(?:했어요|했습니다|됐어요|됐습니다|되었어요|되었습니다|느껴져요|느껴졌어요|느껴집니다|나았어요|나았습니다|좋아졌어요|좋아졌습니다|빠졌어요|빠졌습니다|뺐어요|뺐습니다|줄었어요|줄었습니다|없어졌어요|없어졌습니다|성공했어요|성공했습니다|되찾았어요|되찾았습니다)/g;
  var TREATMENT_CONTEXT_RE = /치료|효과|증상|통증|질환|진료|한약|침|약침|추나|시술|다이어트|감량|임신|난임|피부|불면|두통|소화|호전|회복|원장|한의원|스트레스/;

  var HEURISTIC_MESSAGES = {
    num_result: "숫자(기간·감량 수치)와 결과를 함께 쓰면 치료 효과를 단정하는 표현이 돼요. 수치 없는 프로그램 안내 문장으로 바꿔 주세요.",
    ko_num_result: "'~만에'처럼 짧은 기간을 강조하는 표현은 치료 효과 단정으로 봐요. 기간 표현을 빼 주세요.",
    first_person: "환자가 겪은 일처럼 쓰는 문장(치료경험담)은 의료광고에 쓸 수 없어요. '~안내', '~프로그램'처럼 소개하는 문장으로 바꿔 주세요."
  };

  /* ======================================================================== */

  function isBlank(s) {
    return !s || !String(s).replace(/\s/g, "");
  }

  // 이미 검출된 구간과 겹치는지
  function overlaps(claims, start, len) {
    for (var i = 0; i < claims.length; i++) {
      var c = claims[i];
      if (start < c[1] && c[0] < start + len) return true;
    }
    return false;
  }

  // context 한정 어휘 → error/warn 판정
  function levelForTerm(entry, text, index) {
    if (!entry.context) return "error";
    var rule = CONTEXT_RULES[entry.context];
    if (!rule) return "error"; // 판별 불가 문맥 → 보수적으로 차단
    var from = Math.max(0, index - CONTEXT_WINDOW);
    var to = Math.min(text.length, index + entry.term.length + CONTEXT_WINDOW);
    // 어휘 자신을 제외한 주변 문맥만 검사
    var around = text.slice(from, index) + " " + text.slice(index + entry.term.length, to);
    return rule.test(around) ? "error" : "warn";
  }

  /**
   * 단일 텍스트 검사.
   * @returns {Array} issues — { term, index, length, level, category,
   *                            categoryLabel, message, alternates, kind }
   */
  function checkText(text) {
    var issues = [];
    if (isBlank(text)) return issues;
    text = String(text);
    var lower = text.toLowerCase();
    var claims = []; // [start, end) — 긴 어휘 우선 점유로 중복 검출 방지

    // 1) 금지어 사전 — 긴 어휘 우선 (예: "100%완치"가 "100%"+"완치" 중복 검출 방지)
    var sorted = TERMS.slice().sort(function (a, b) { return b.term.length - a.term.length; });
    sorted.forEach(function (entry) {
      var needle = entry.term.toLowerCase();
      var from = 0, idx;
      while ((idx = lower.indexOf(needle, from)) !== -1) {
        from = idx + 1;
        if (overlaps(claims, idx, needle.length)) continue;
        var level = levelForTerm(entry, text, idx);
        claims.push([idx, idx + needle.length]);
        issues.push({
          kind: "term",
          term: text.substr(idx, needle.length),
          index: idx,
          length: needle.length,
          level: level,
          category: entry.category,
          categoryLabel: CATEGORY_LABELS[entry.category] || entry.category,
          message: level === "error"
            ? "이 표현은 의료광고법 위반 소지가 있어요"
            : "문맥에 따라 의료광고법 위반 소지가 있어요. 치료·비용 얘기와 함께라면 꼭 바꿔 주세요",
          alternates: entry.alternates || []
        });
      }
    });

    // 2) 휴리스틱 (금지어와 겹치는 구간은 생략 — 이중 경고 방지)
    function runHeuristic(re, id) {
      re.lastIndex = 0;
      var m;
      while ((m = re.exec(text)) !== null) {
        if (m.index === re.lastIndex) re.lastIndex++; // 무한루프 가드
        if (overlaps(claims, m.index, m[0].length)) continue;
        claims.push([m.index, m.index + m[0].length]);
        issues.push({
          kind: "heuristic",
          heuristic: id,
          term: m[0],
          index: m.index,
          length: m[0].length,
          level: "error",
          category: "휴리스틱",
          categoryLabel: CATEGORY_LABELS["휴리스틱"],
          message: HEURISTIC_MESSAGES[id],
          alternates: []
        });
      }
    }
    runHeuristic(NUM_RESULT_RE, "num_result");
    runHeuristic(KO_NUM_RESULT_RE, "ko_num_result");
    // H3: 경험담 어미 — 치료·효과 문맥이 같은 텍스트에 있을 때만
    if (TREATMENT_CONTEXT_RE.test(text)) {
      runHeuristic(EXPERIENCE_ENDING_RE, "first_person");
    }

    issues.sort(function (a, b) { return a.index - b.index; });
    return issues;
  }

  /**
   * 여러 필드 일괄 검사 (후기: 제목 + 내용 + 라벨).
   * @param {Array} fields — [{ field, label, text }]
   * @returns { passed, errorCount, warnCount, issues }
   *   passed = error 0건 (warn만 있으면 발행 가능 — 하드 게이트 기준)
   */
  function lintFields(fields) {
    var all = [];
    (fields || []).forEach(function (f) {
      checkText(f.text).forEach(function (issue) {
        issue.field = f.field;
        issue.fieldLabel = f.label;
        all.push(issue);
      });
    });
    var errors = all.filter(function (i) { return i.level === "error"; });
    var warns = all.filter(function (i) { return i.level === "warn"; });
    return {
      passed: errors.length === 0,
      errorCount: errors.length,
      warnCount: warns.length,
      issues: all
    };
  }

  /** lint_notes 컬럼 기록용 요약 문자열 */
  function buildNotes(result) {
    var head = "자동검사(admin lint-terms " + VERSION + ", 원본 " + SOURCE + "): "
      + "오류 " + result.errorCount + "건, 주의 " + result.warnCount + "건";
    if (!result.issues.length) return head + " — 통과";
    var parts = result.issues.map(function (i) {
      return "[" + (i.level === "error" ? "오류" : "주의") + "] "
        + (i.fieldLabel ? i.fieldLabel + " " : "") + "'" + i.term + "' (" + i.categoryLabel + ")";
    });
    return head + " — " + parts.join(" / ");
  }

  return {
    VERSION: VERSION,
    SOURCE: SOURCE,
    TERMS: TERMS,
    FACT_RULES: FACT_RULES,
    CATEGORY_LABELS: CATEGORY_LABELS,
    termCount: TERMS.length,
    categoryCount: Object.keys(TERMS.reduce(function (acc, t) { acc[t.category] = 1; return acc; }, {})).length,
    checkText: checkText,
    lintFields: lintFields,
    buildNotes: buildNotes
  };
});
