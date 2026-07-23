/* ============================================================================
 * app.js — 지아한의원 관리자 SPA
 *   원칙: 이용자 = 원장(비개발자). 전 화면 한국어 · 전문용어 0 · 실수 방지.
 *   기술: 순수 vanilla JS + supabase-js v2 (CDN) — 빌드 스텝 없음.
 *   보안: publishable 키 + RLS(rls.sql)가 경계. service_role 키 사용 금지.
 *   후기 발행 = 자유 발행 (사용자 결단 2026-07-22 "lint 없애줘 전부" — 의료광고법
 *     lint 전면 제거. 광고법 검증·리스크 소유는 운영 주체로 이관, 글 편집기와 동일 정책).
 * ========================================================================== */
(function () {
  "use strict";

  var esc = UI.esc, toast = UI.toast, confirmModal = UI.confirmModal, busy = UI.busy;
  var cfg = window.ADMIN_CONFIG || {};
  var sb = null;
  var state = { session: null, zones: null, tags: null };

  /* site_settings 는 지금 PK 가 key 하나라 upsert 충돌키도 "key" 다.
   * 멀티테넌트 마이그레이션(010)이 PK 를 (clinic_id, key) 로 바꾸므로 그날 충돌키도
   * 함께 바뀌어야 한다 — 안 바꾸면 저장이 조용히 실패한다. 호출부가 여섯 군데라
   * 여기 한 곳으로 모아 두고, 그날 이 상수 한 줄만 고치면 되게 한다. */
  var SETTINGS_CONFLICT = "key";        // 멀티테넌트 적용 후 → "clinic_id,key"
  function settingsUpsert(rows) {
    return sb.from("site_settings").upsert(rows, { onConflict: SETTINGS_CONFLICT });
  }

  function byId(id) { return document.getElementById(id); }
  function root() { return byId("view-root"); }

  /* ════════════════════════ 초기화 · 인증 ════════════════════════ */

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    if (!window.supabase || !window.supabase.createClient || !cfg.supabaseUrl) {
      showLoginError("인터넷 연결을 확인한 뒤 새로고침해 주세요. (필수 프로그램을 불러오지 못했어요)");
      return;
    }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey);

    byId("login-form").addEventListener("submit", onLoginSubmit);
    byId("btn-logout").addEventListener("click", onLogout);
    byId("btn-password").addEventListener("click", function () { location.hash = "#/password"; });
    byId("btn-brand").addEventListener("click", function () { location.hash = "#/live"; });
    window.addEventListener("hashchange", render);
    // P3-e/P3-f: 미리보기(iframe) ↔ 관리자 메시지 창구 단일화. origin 검증은 핸들러 첫 줄.
    window.addEventListener("message", onFrameMessage);
    // 전폭 라이브 화면은 헤더 높이를 빼서 세로를 꽉 채운다 — 헤더가 줄바꿈되면 다시 잰다.
    window.addEventListener("resize", syncHeaderHeight);
    // 사진을 올리는 중에 창을 닫거나 새로고침하면 조용히 사라진다 → 나가기 전에 한 번 묻는다.
    window.addEventListener("beforeunload", onBeforeUnload);

    sb.auth.getSession().then(function (res) {
      state.session = res.data ? res.data.session : null;
      applyAuth();
    });
    sb.auth.onAuthStateChange(function (_event, session) {
      var had = !!state.session;
      state.session = session;
      if (had !== !!session) applyAuth();
    });
  }

  function applyAuth() {
    if (state.session) {
      byId("login-screen").classList.add("hidden");
      byId("app-screen").classList.remove("hidden");
      byId("head-email").textContent = state.session.user && state.session.user.email || "";
      render();
      // 로그인이 풀려 못 저장한 내용이 있으면 — 화면이 다 그려진 뒤 이어서 저장할지 묻는다 (F-4)
      if (pendingAfterLogin) setTimeout(resumePendingSave, 400);
    } else {
      byId("app-screen").classList.add("hidden");
      byId("login-screen").classList.remove("hidden");
      document.body.classList.remove("live-mode"); // 로그아웃 시 전폭 레이아웃 해제
      root().innerHTML = "";
      var pw = byId("login-password");
      if (pw) pw.value = "";
    }
  }

  function showLoginError(message) {
    var box = byId("login-error");
    if (!box) return;
    if (message) { box.textContent = message; box.classList.remove("hidden"); }
    else box.classList.add("hidden");
  }

  function friendlyAuthError(error) {
    var m = (error && error.message || "").toLowerCase();
    if (m.indexOf("invalid login credentials") !== -1) return "이메일 또는 비밀번호가 맞지 않아요. 다시 한번 확인해 주세요.";
    if (m.indexOf("email not confirmed") !== -1) return "아직 사용할 수 없는 계정이에요. 관리 담당자(GUAVA)에게 연락해 주세요.";
    if (m.indexOf("rate limit") !== -1 || m.indexOf("too many") !== -1) return "로그인 시도가 너무 많았어요. 1분 뒤에 다시 해 주세요.";
    if (m.indexOf("fetch") !== -1 || m.indexOf("network") !== -1) return "인터넷 연결을 확인해 주세요.";
    return "로그인하지 못했어요. 잠시 후 다시 시도해 주세요.";
  }

  function onLoginSubmit(e) {
    e.preventDefault();
    showLoginError(null);
    var email = byId("login-email").value.trim();
    var password = byId("login-password").value;
    if (!email || !password) { showLoginError("이메일과 비밀번호를 모두 입력해 주세요."); return; }
    var btn = byId("login-submit");
    busy(btn, true, "로그인 중…");
    sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
      busy(btn, false);
      if (res.error) { showLoginError(friendlyAuthError(res.error)); return; }
      location.hash = "#/";
    });
  }

  function onLogout() {
    confirmModal({ title: "로그아웃할까요?", body: "다시 들어오려면 이메일과 비밀번호로 로그인하면 돼요.", confirmLabel: "로그아웃" })
      .then(function (ok) { if (ok) sb.auth.signOut(); });
  }

  function dbError(error, what) {
    var m = (error && error.message || "").toLowerCase();
    var base = what || "저장하지 못했어요";
    if (isAuthExpiredError(error)) {
      // F-4: 로그인이 풀린 것을 일반 실패로 안내하면 원장이 같은 저장을 계속 되풀이한다.
      toast(AUTH_EXPIRED_MSG, "error");
      promptRelogin();
    } else if (m.indexOf("fetch") !== -1 || m.indexOf("network") !== -1) {
      toast(base + ". 인터넷 연결을 확인하고 다시 시도해 주세요.", "error");
    } else {
      toast(base + ". 다시 시도해 주세요. 계속 안 되면 관리 담당자(GUAVA)에게 알려 주세요.", "error");
    }
    if (error) console.error("[admin] DB error:", error);
  }

  /* ════════════════════════ 저장 신뢰성 공용 (F-1·F-3·F-4) ════════════════════════
   * 원칙 1 — 화면 안내와 실제 결과는 절대 어긋나지 않는다.
   *   미리보기 편집기(site/static/js/edit-overlay.js)는 15초 안에 답이 없으면
   *   "응답이 없어요"로 판정하고 화면 값을 되돌린다. 그러므로 부모(이 파일)는
   *   **반드시 그 안에 결론을 내고 한 번만 답한다.** 시간이 지나면 요청을 끊고
   *   (abort) 저장된 값을 **되읽어 실제 상태를 확인한 뒤** 사실대로 답한다.
   *   확인까지 실패하면 "저장됐는지 모른다"고 정직하게 알리고, 뒤에서 계속 확인해
   *   결론이 나면 그때 다시 알린다 (성공을 실패라 하지 않고, 실패를 성공이라 하지 않는다).
   * 원칙 2 — 남이 먼저 고친 값을 조용히 덮지 않는다 (F-3).
   * ══════════════════════════════════════════════════════════════════════════ */

  var SAVE_TOTAL_MS = 13000;    // 자식 15초 판정 안에서 결론 (여유 2초)
  var PRECHECK_MS = 2000;       // 저장 전 "지금 값" 확인
  var WRITE_MS = 6000;          // 저장 요청
  var VERIFY_MS = 3500;         // 저장 뒤 되읽기 확인
  var CONFLICT_SKEW_MS = 60000; // 컴퓨터·서버 시계 차이 여유

  var AUTH_EXPIRED_MSG = "로그인이 풀렸어요. 다시 로그인해 주세요. 고치던 내용은 기억해 뒀다가 로그인한 뒤에 저장할지 여쭤볼게요.";

  function newAbort() {
    try { return typeof AbortController === "function" ? new AbortController() : null; } catch (err) { return null; }
  }
  // 조회/저장 요청에 "끊기 스위치"를 달아 둔다 (supabase-js 미지원 버전에서도 무해)
  function withAbort(q, ctrl) {
    if (ctrl && q && typeof q.abortSignal === "function") {
      try { return q.abortSignal(ctrl.signal); } catch (err) { /* 무해 */ }
    }
    return q;
  }
  // 제한 시간 안에 끝내고, 넘으면 요청 자체를 끊는다 (늦게 도착한 응답이 화면을 흔들지 않게)
  function withDeadline(job, ms, ctrl) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        if (ctrl) { try { ctrl.abort(); } catch (err) { /* 무해 */ } }
        var e = new Error("zia-timeout");
        e.ziaTimeout = true;
        reject(e);
      }, ms);
      Promise.resolve(job).then(function (v) {
        if (settled) return;
        settled = true; clearTimeout(timer); resolve(v);
      }, function (err) {
        if (settled) return;
        settled = true; clearTimeout(timer); reject(err);
      });
    });
  }
  // "결과를 못 받은" 실패 = 저장됐는지 알 수 없는 실패 (되읽기 확인 대상)
  function isTimeoutError(err) {
    if (!err) return false;
    if (err.ziaTimeout) return true;
    var m = String((err.message || "") + " " + (err.name || "")).toLowerCase();
    return m.indexOf("abort") !== -1 || m.indexOf("timeout") !== -1 ||
      m.indexOf("failed to fetch") !== -1 || m.indexOf("networkerror") !== -1 ||
      m.indexOf("network request failed") !== -1 || m.indexOf("load failed") !== -1;
  }
  // 로그인 만료 (401 / PGRST301 / JWT expired) — 일반 실패와 구분해야 재로그인을 안내할 수 있다
  function isAuthExpiredError(err) {
    if (!err) return false;
    var code = String(err.code || "");
    var status = Number(err.status || err.statusCode || (err.originalError && err.originalError.status) || 0);
    var m = String(err.message || err.error_description || err.error || "").toLowerCase();
    if (code === "PGRST301" || code === "401") return true;
    if (status === 401) return true;
    return m.indexOf("jwt expired") !== -1 || m.indexOf("jwt is expired") !== -1 ||
      m.indexOf("token is expired") !== -1 || m.indexOf("token has expired") !== -1 ||
      m.indexOf("invalid claim") !== -1 || m.indexOf("session expired") !== -1 ||
      m.indexOf("session_not_found") !== -1 || m.indexOf("no api key") !== -1;
  }

  var pendingAfterLogin = null;   // 로그인이 풀렸을 때 고치던 내용 (다시 로그인하면 이어서 저장할지 묻는다)
  var reloginAsking = false;

  // 토큰만 만료된 경우가 대부분 → 조용히 되살려 본다 (성공하면 재로그인 안내 없이 이어서 진행)
  function tryRefreshSession() {
    if (!sb || !sb.auth || typeof sb.auth.refreshSession !== "function") return Promise.resolve(false);
    return sb.auth.refreshSession().then(function (res) {
      var s = res && res.data && res.data.session;
      if (s) { state.session = s; return true; }
      return false;
    }).catch(function () { return false; });
  }

  function promptRelogin() {
    if (reloginAsking || !state.session) return;
    reloginAsking = true;
    confirmModal({
      title: "로그인이 풀렸어요",
      body: "안전을 위해 한동안 쓰지 않으면 자동으로 로그아웃돼요. 다시 로그인하면 하시던 작업을 이어서 할 수 있어요." +
        (pendingAfterLogin ? " 방금 고치던 내용은 기억해 뒀다가 로그인한 뒤에 저장할지 여쭤볼게요." : ""),
      confirmLabel: "다시 로그인하기",
      cancelLabel: "나중에"
    }).then(function (ok) {
      reloginAsking = false;
      if (ok) sb.auth.signOut();
    });
  }

  // 로그인이 풀린 것으로 판정 → 먼저 조용히 되살려 보고, 안 되면 재로그인 안내
  function noteAuthExpired(pending) {
    if (pending) pendingAfterLogin = pending;
    tryRefreshSession().then(function (fresh) {
      if (fresh) {
        // 되살아났다 — 방금 저장은 실패로 안내했으므로 "다시 눌러 주세요"까지만 알린다
        toast("연결이 잠시 끊겼다가 되살아났어요. 방금 고친 내용을 한 번만 다시 저장해 주세요.", "error");
        pendingAfterLogin = null;
        return;
      }
      promptRelogin();
    });
  }

  // 다시 로그인한 뒤 — 끊기기 전에 고치던 내용을 이어서 저장할지 묻는다
  function resumePendingSave() {
    var p = pendingAfterLogin;
    if (!p) return;
    pendingAfterLogin = null;
    var preview = shortText(p.value, 40);
    confirmModal({
      title: "고치던 내용을 저장할까요?",
      body: "로그인이 풀리기 전에 고치던 내용이에요: “" + preview + "”",
      confirmLabel: "저장하기",
      cancelLabel: "그냥 두기"
    }).then(function (ok) {
      if (!ok) return;
      var plan = buildSavePlan(p.target || {}, p.kind, p.value);
      if (!plan || plan.guard) {
        toast("지금은 이어서 저장할 수 없어요. 화면에서 한 번 더 고쳐 주세요.", "error");
        return;
      }
      performSave(plan, p.value, { force: true }).then(function (r) {
        if (r.ok) {
          toast("고치던 내용을 저장했어요 · 홈페이지에 바로 반영됐어요");
          sendToFrame("zia-edit-refresh", {});
        } else {
          toast(r.message, "error");
        }
      });
    });
  }

  function shortText(s, n) {
    s = String(s == null ? "" : s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n) + "…" : s;
  }
  function fmtCount(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /* ════════════════════════ 데이터 로더 ════════════════════════ */

  function loadZones(force) {
    if (state.zones && !force) return Promise.resolve(state.zones);
    return sb.from("zones").select("*").order("sort_order").order("id").then(function (res) {
      if (res.error) throw res.error;
      state.zones = res.data || [];
      return state.zones;
    });
  }

  function loadTags(force) {
    if (state.tags && !force) return Promise.resolve(state.tags);
    return sb.from("tags").select("*").order("sort_order").order("id").then(function (res) {
      if (res.error) throw res.error;
      state.tags = res.data || [];
      return state.tags;
    });
  }

  function zoneName(zoneId) {
    var z = (state.zones || []).find(function (x) { return x.id === zoneId; });
    return z ? z.name : "";
  }

  /* ════════════════════════ P3-e 홈페이지 보며 수정 — 공용 상수·헬퍼 ════════════════════════ */

  // #/live 페이지 선택 목록 (site/*.html — post.html 은 ?id 필요라 제외)
  // key = select 값 겸 hash 의 page 파라미터(안정 식별자), file+query = 실제 주소.
  var LIVE_PAGES = [
    { key: "index.html",     file: "index.html",     label: "홈" },
    { key: "about.html",     file: "about.html",     label: "의원소개" },
    { key: "autonomic.html", file: "autonomic.html", label: "자율신경계" },
    { key: "reviews.html",   file: "reviews.html",   label: "치료후기" },
    { key: "faq.html",       file: "faq.html",       label: "자주 묻는 질문(FAQ)" },
    { key: "location.html",  file: "location.html",  label: "오시는길" }
  ];

  // 분야(ZONE) 아카이브 페이지 — site/zone.html?zone=<slug> (다른 담당자가 신설 중).
  // ⚠ 파일이 아직 없을 수 있다 → HEAD 로 한 번 확인해서 있을 때만 목록에 붙인다.
  //    없거나 확인 실패면 조용히 건너뛴다 (원장 화면에 오류를 띄우지 않는다).
  var liveZonePages = null;   // null = 아직 확인 전, [] = 없음/실패
  var liveZonePagesJob = null;

  function loadZonePages() {
    if (liveZonePages) return Promise.resolve(liveZonePages);
    if (liveZonePagesJob) return liveZonePagesJob;
    liveZonePagesJob = fetch("../zone.html", { method: "HEAD" })
      .then(function (res) {
        if (!res.ok) return [];
        return loadZones().then(function (zones) {
          return (zones || []).filter(function (z) { return z.is_visible && z.slug; }).map(function (z) {
            return {
              key: "zone.html?zone=" + z.slug,
              file: "zone.html",
              query: "zone=" + encodeURIComponent(z.slug),
              label: "분야 · " + (z.name || z.slug)
            };
          });
        });
      })
      .catch(function () { return []; })   // 파일 부재·네트워크 실패 → 조용히 없음 처리
      .then(function (list) { liveZonePages = list || []; return liveZonePages; });
    return liveZonePagesJob;
  }

  function livePages() {
    return LIVE_PAGES.concat(liveZonePages || []);
  }

  // page 파라미터 → 목록 항목. 목록에 아직 없어도 분야 페이지 형식이면 즉석 항목을 만든다
  // (딥링크가 목록 로딩보다 먼저 와도 동작하게).
  function livePageByKey(key) {
    var found = livePages().find(function (p) { return p.key === key; });
    if (found) return found;
    var m = /^zone\.html\?zone=([a-z0-9_-]{1,64})$/.exec(key || "");
    if (m) return { key: key, file: "zone.html", query: "zone=" + m[1], label: "분야 페이지" };
    return LIVE_PAGES[0];
  }

  function livePageSrc(page, focus) {
    // 사이트는 같은 오리진 한 단계 위 — 상대경로라 스테이징 서브패스·프로덕션 모두 동작
    return "../" + page.file + "?" + (page.query ? page.query + "&" : "") +
      "edit=1" + (focus ? "&focus=" + focus : "");
  }

  // 편집 화면 → 대표 focus 지점 (edit-overlay.js focus 딥링크 규약 — 계약 v1.2 §8.4)
  // note = 각 편집 화면 상단 "어디에 보이나요?" 1줄 안내.
  var LIVE_FOCUS = {
    zones:    { page: "index.html",     focus: "I4", note: "홈 화면 \"진료 소개\" 탭과 위쪽 메뉴(진료 분야 목록)에 나와요." },
    home:     { page: "index.html",     focus: "I7", note: "홈 화면 \"진료 소개\" 탭 아래 글 칸(캐러셀)에 나와요." },
    posts:    { page: "autonomic.html", focus: "A2", note: "발행한 글은 진료 분야 페이지의 글 목록에 나오고, \"홈 화면 관리\"에서 담으면 홈 첫 화면에도 나와요." },
    faqs:     { page: "faq.html",       focus: "F2", note: "\"자주 묻는 질문\" 페이지에 나오고, 홈 표시를 켠 질문은 홈 화면 아래쪽에도 나와요." },
    reviews:  { page: "reviews.html",   focus: "R2", note: "\"치료후기\" 페이지에 나오고, 홈 강조를 켠 카드는 홈 첫 화면에도 나와요." },
    settings: { page: "index.html",     focus: "C6", note: "홈페이지 맨 아래(모든 페이지 공통)와 홈 화면 아래 안내, \"오시는 길\" 페이지에 나와요." }
  };

  // 배지 postMessage hash 화이트리스트 (LIVE_FOCUS 키와 동일 화면 셋)
  var EDIT_NAV_HASHES = ["#/settings", "#/zones", "#/home", "#/posts", "#/faqs", "#/reviews"];

  // 미리보기(iframe) → 관리자 메시지 창구 (계약 v2 §6). origin 검증이 첫 줄 — 외부 메시지 차단.
  function onFrameMessage(e) {
    if (e.origin !== window.location.origin) return; // 같은 오리진 배포 전제
    var d = e.data;
    if (!d || typeof d.type !== "string") return;
    if (d.type === "zia-edit-nav") {
      if (typeof d.hash !== "string" || EDIT_NAV_HASHES.indexOf(d.hash) === -1) return;
      location.hash = d.hash;
      return;
    }
    if (!isLiveFrame(e.source)) return; // 나머지는 현재 띄운 미리보기에서 온 것만 처리
    if (d.type === "zia-edit-ready") onEditReady(d);
    else if (d.type === "zia-edit-save") onEditSave(d);
    else if (d.type === "zia-edit-pick") onEditPick(d);
    else if (d.type === "zia-edit-revert") onEditRevert(d);   // 자유 편집 "원래대로"
  }

  function liveFrame() { return byId("live-frame"); }

  function isLiveFrame(source) {
    var f = liveFrame();
    try { return !!(f && source && f.contentWindow === source); } catch (err) { return false; }
  }

  // 관리자 → 미리보기 (계약 v2 §6 부모→자식)
  function sendToFrame(type, payload) {
    var f = liveFrame();
    if (!f || !f.contentWindow) return;
    var msg = { type: type };
    Object.keys(payload || {}).forEach(function (k) { msg[k] = payload[k]; });
    try { f.contentWindow.postMessage(msg, window.location.origin); } catch (err) { /* 무해 */ }
  }

  function liveHash(screenKey) {
    var t = LIVE_FOCUS[screenKey];
    return t ? "#/live?page=" + t.page + "&focus=" + t.focus : "#/live";
  }

  // 목록 화면에서 내용을 바꾸면 표시해 두었다가, 미리보기로 돌아왔을 때 다시 불러오게 한다.
  var liveNeedsRefresh = false;
  function markDataChanged() {
    liveNeedsRefresh = true;
    if (typeof libCache !== "undefined") { libCache.photo = null; libCache.post = null; libCache.review = null; }
  }

  // 헤더 높이(줄바꿈 대응) → CSS 변수. 전폭 라이브 화면의 세로 높이 계산에 쓴다.
  function syncHeaderHeight() {
    var head = document.querySelector(".app-header");
    if (!head) return;
    document.documentElement.style.setProperty("--head-h", head.offsetHeight + "px");
  }

  // 각 편집 화면 상단 "어디에 보이나요?" 안내 줄 (+ 홈페이지에서 보기)
  function whereNote(screenKey) {
    var t = LIVE_FOCUS[screenKey];
    if (!t) return "";
    return '<div class="where-note"><span class="where-q">어디에 보이나요?</span> ' + esc(t.note) +
      ' <button type="button" class="btn-ghost btn-sm where-view" data-nav="' + esc(liveHash(screenKey)) + '">홈페이지에서 보기</button></div>';
  }

  // 저장 성공 토스트 + "홈페이지에서 확인하기" 버튼 → #/live (해당 페이지 + focus 지점)
  function toastView(message, screenKey) {
    markDataChanged(); // 저장 성공 시점 — 미리보기로 돌아가면 새로 불러온다
    toast(message, null, 6000); // 버튼 누를 시간 확보 (ui.js holdMs)
    var el = byId("toast");
    if (!el || !LIVE_FOCUS[screenKey]) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-view-btn";
    btn.textContent = "홈페이지에서 확인하기";
    btn.addEventListener("click", function () {
      el.className = "";
      location.hash = liveHash(screenKey);
    });
    el.appendChild(btn);
  }

  /* ════════════════════════ 이미지 업로드 공용 (P3-d) ════════════════════════ */

  var IMG_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "image/bmp": "bmp" };

  // 사진 1장 한도 — **모든 올리기 경로의 단일 정의** (F-5).
  // 미리보기 편집기(edit-overlay.js)의 한도와 같은 값이어야 한다. 여기 한 곳만 고치면
  // 미리보기 팝오버·사진 모음 패널·글 편집기·드래그 올리기가 전부 같이 따라간다.
  var MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
  var MAX_UPLOAD_LABEL = "8MB";
  function tooBigMessage(name) {
    return (name ? "“" + name + "”은(는) " : "사진이 ") + "너무 커요 (" + MAX_UPLOAD_LABEL + "까지). " +
      "사진 크기를 줄여서 올려 주세요.";
  }

  /* ── 올리는 중 이탈 보호 (F-6) ── */
  var activeUploads = 0;
  function onBeforeUnload(e) {
    if (activeUploads <= 0) return undefined;
    e.preventDefault();
    e.returnValue = "사진을 올리는 중이에요. 지금 나가면 사진이 저장되지 않아요.";
    return e.returnValue;
  }

  function storagePublicUrl(path) {
    return cfg.supabaseUrl + "/storage/v1/object/public/zia-media/" + encodeURI(path);
  }

  // 관리자 화면 미리보기 URL (/static → 사이트 상대경로 — 배포 배치상 관리자 = 사이트 하위 /admin/)
  function adminImageUrl(p) {
    if (!p) return "";
    if (/^https?:/.test(p)) return p;
    if (p.indexOf("/static/") === 0) return ".." + p;
    return storagePublicUrl(String(p).replace(/^\/+/, ""));
  }

  /* ── 원본 파일 이름 보존 (F-8) ──
   * 저장 경로는 겹치지 않게 시각+임의문자로 짓는데, 그러면 원장이 올린 사진이
   * 보관함에서 전부 "홈 사진 · 날짜"로만 보여 서로 구분이 안 된다.
   * → 경로 뒤에 원본 이름을 **되돌릴 수 있는 형태**(영문·숫자·-·_ 만 쓰는 표기)로 붙여
   *   두고, 보관함 라벨을 만들 때 다시 원래 이름으로 풀어서 보여 준다.
   *   (한글 이름을 경로에 그대로 넣으면 주소가 깨질 수 있어 그대로 쓰지 않는다.)
   */
  function b64urlEncode(s) {
    try {
      return btoa(unescape(encodeURIComponent(String(s))))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    } catch (err) { return ""; }
  }
  function b64urlDecode(s) {
    try {
      var t = String(s).replace(/-/g, "+").replace(/_/g, "/");
      while (t.length % 4) t += "=";
      return decodeURIComponent(escape(atob(t)));
    } catch (err) { return ""; }
  }
  function namePart(fileName) {
    var base = String(fileName || "").split(/[\\/]/).pop().replace(/\.[^.]+$/, "").trim();
    if (!base) return "";
    if (base.length > 40) base = base.slice(0, 40);
    var enc = b64urlEncode(base);
    return enc ? "--" + enc : "";
  }
  // 저장 경로 → 원본 파일 이름 (옛 경로·해독 실패는 "" — 라벨이 예전 모습으로 남을 뿐 무해)
  function originalName(path) {
    var file = String(path || "").split("/").pop();
    var m = /--([A-Za-z0-9_-]+)\.[^.]+$/.exec(file);
    return m ? b64urlDecode(m[1]) : "";
  }
  // 주소에서 파일 이름만 뽑기 (붙여넣은 바깥 사진의 이름 살리기용)
  function nameFromUrl(url) {
    var s = String(url || "").split("?")[0].split("#")[0].split("/").pop();
    return /^[^.]+\.[A-Za-z0-9]{2,5}$/.test(s) ? s : "";
  }

  // 파일/Blob → storage zia-media 업로드 → { path, url }.
  // 경로 = {folder}/{timestamp}-{rand}[--{원본이름}].{ext}
  // opts: { name: 원본 파일 이름, onProgress: function(퍼센트) }
  function uploadImage(blob, folder, opts) {
    opts = opts || {};
    var type = blob.type || "";
    var ext = IMG_EXT[type];
    if (!ext) return Promise.reject(new Error("unsupported image type: " + type));
    var name = opts.name || blob.name || "";
    if (blob.size > MAX_UPLOAD_BYTES) {   // 한도는 한 곳(MAX_UPLOAD_BYTES)에서만 정한다 (F-5)
      var big = new Error("zia-too-big");
      big.ziaMessage = tooBigMessage(name);
      return Promise.reject(big);
    }
    var path = folder + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + namePart(name) + "." + ext;
    var onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    activeUploads++;
    if (onProgress) onProgress(0);
    return uploadBlob(path, blob, type, onProgress).then(function () {
      activeUploads--;
      if (onProgress) onProgress(100);
      return { path: path, url: storagePublicUrl(path) };
    }, function (err) {
      activeUploads--;
      throw err;
    });
  }

  // 올리기 실행부 — 진행률을 알려면 XHR 이 필요하다(기본 방식은 진행 상황을 알려주지 않는다).
  // 토큰을 못 얻거나 XHR 이 실패하면 기존 방식으로 한 번 더 시도한다 (회귀 방지).
  function uploadBlob(path, blob, type, onProgress) {
    return sessionToken().then(function (token) {
      if (!token || typeof XMLHttpRequest !== "function") return storageUpload(path, blob, type);
      return xhrUpload(path, blob, type, token, onProgress).catch(function (err) {
        if (err && err.ziaStatus === 409) return null;   // 같은 경로가 이미 있음 = 방금 것이 올라간 것
        if (err && err.ziaAuth) throw err;
        console.warn("[admin] 진행률 올리기 실패 → 기본 방식으로 다시 시도:", err);
        return storageUpload(path, blob, type);
      });
    });
  }
  function sessionToken() {
    return sb.auth.getSession().then(function (res) {
      return (res && res.data && res.data.session && res.data.session.access_token) || null;
    }).catch(function () { return null; });
  }
  function storageUpload(path, blob, type) {
    return sb.storage.from("zia-media").upload(path, blob, { contentType: type, cacheControl: "3600" })
      .then(function (res) { if (res.error) throw res.error; return res.data; });
  }
  function xhrUpload(path, blob, type, token, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", cfg.supabaseUrl + "/storage/v1/object/zia-media/" + encodeURI(path));
      xhr.setRequestHeader("authorization", "Bearer " + token);
      xhr.setRequestHeader("apikey", cfg.publishableKey || "");
      xhr.setRequestHeader("x-upsert", "false");
      xhr.setRequestHeader("cache-control", "max-age=3600");
      if (type) xhr.setRequestHeader("content-type", type);
      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable && e.total) {
            onProgress(Math.max(1, Math.min(99, Math.round(e.loaded / e.total * 100))));
          }
        };
      }
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) { resolve(null); return; }
        var err = new Error("storage " + xhr.status + ": " + String(xhr.responseText || "").slice(0, 200));
        err.ziaStatus = xhr.status;
        err.status = xhr.status;
        if (xhr.status === 401) err.ziaAuth = true;
        reject(err);
      };
      xhr.onerror = function () { reject(new Error("network")); };
      xhr.onabort = function () { reject(new Error("abort")); };
      xhr.send(blob);
    });
  }

  // 올리기 실패 안내 (한도 초과·로그인 만료를 구분해 사실대로)
  function uploadErrorMessage(err) {
    if (err && err.ziaMessage) return err.ziaMessage;
    if (isAuthExpiredError(err)) return AUTH_EXPIRED_MSG;
    if (isTimeoutError(err)) return "사진을 올리지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.";
    return "사진을 올리지 못했어요. 다시 시도해 주세요.";
  }

  // 드래그&드롭 + 클릭 파일선택 공용 배선. onFiles = 이미지 파일 배열 콜백
  // ⚠ 크기 검사는 **여기 한 곳**에서 한다 — 어디에 놓든 같은 한도가 걸리게 (F-5).
  function bindDropUpload(dropEl, inputEl, onFiles) {
    function pick(list) {
      var all = Array.prototype.slice.call(list || []);
      var images = all.filter(function (f) { return IMG_EXT[f.type]; });
      if (!images.length) { toast("이미지 파일(jpg·png 등)만 넣을 수 있어요", "error"); return; }
      var fits = images.filter(function (f) { return !f.size || f.size <= MAX_UPLOAD_BYTES; });
      var big = images.filter(function (f) { return f.size > MAX_UPLOAD_BYTES; });
      if (big.length === 1) toast(tooBigMessage(big[0].name), "error");
      else if (big.length > 1) toast(big.length + "장은 너무 커서 뺐어요 (" + MAX_UPLOAD_LABEL + "까지). 사진 크기를 줄여서 올려 주세요.", "error");
      if (fits.length) onFiles(fits);
    }
    dropEl.addEventListener("click", function () { inputEl.click(); });
    inputEl.addEventListener("change", function () {
      if (inputEl.files.length) { pick(inputEl.files); inputEl.value = ""; }
    });
    ["dragenter", "dragover"].forEach(function (t) {
      dropEl.addEventListener(t, function (e) { e.preventDefault(); e.stopPropagation(); dropEl.classList.add("drag-on"); });
    });
    ["dragleave", "drop"].forEach(function (t) {
      dropEl.addEventListener(t, function (e) { e.preventDefault(); e.stopPropagation(); dropEl.classList.remove("drag-on"); });
    });
    dropEl.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) pick(e.dataTransfer.files);
    });
  }

  // 단일 이미지 드래그 존 (글 썸네일 · ZONE 대표 이미지 공용).
  // opts: { value, folder, emptyText, onChange(path|null) } — onChange는 업로드 완료/빼기 후 호출.
  function imageDropControl(container, opts) {
    var current = opts.value || null;
    function draw(uploading, pct) {
      container.innerHTML =
        '<div class="img-drop' + (current ? " has-img" : "") + (uploading ? " uploading" : "") + '">' +
        (current && !uploading
          ? '<img class="img-drop-preview" src="' + esc(adminImageUrl(current)) + '" alt="">'
          : "") +
        '<span class="img-drop-hint">' +
        (uploading ? esc(uploadingText(pct)) : current ? "사진을 끌어다 놓거나 눌러서 바꾸기" : esc(opts.emptyText || "사진을 끌어다 놓거나 눌러서 고르기")) +
        "</span>" +
        (uploading ? progressBarHtml(pct) : "") +
        "</div>" +
        (current && !uploading ? '<button type="button" class="btn-ghost btn-sm img-drop-clear">사진 빼기</button>' : "") +
        '<input type="file" accept="image/*" class="hidden">';
      var drop = container.querySelector(".img-drop");
      var input = container.querySelector("input[type=file]");
      bindDropUpload(drop, input, function (files) {
        draw(true, 0);
        uploadImage(files[0], opts.folder, {
          name: files[0].name,
          onProgress: function (p) { setDropProgress(container, p); }
        }).then(function (up) {
          current = up.path;
          draw(false);
          opts.onChange(current);
        }).catch(function (err) {
          console.error("[admin] upload error:", err);
          toast(uploadErrorMessage(err), "error");
          draw(false);
        });
      });
      var clearBtn = container.querySelector(".img-drop-clear");
      if (clearBtn) {
        clearBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          current = null;
          draw(false);
          opts.onChange(null);
        });
      }
    }
    draw(false);
    return { get: function () { return current; } };
  }

  /* ── 올리는 중 진행 표시 (F-6) ── 정적 문구만 두면 멈춘 줄 알고 창을 닫는다. */
  function uploadingText(pct) {
    if (pct == null || isNaN(pct)) return "사진 올리는 중…";
    if (pct >= 100) return "거의 다 됐어요…";   // 다 보낸 뒤 서버가 저장하는 동안
    return "사진 올리는 중… " + pct + "%";
  }
  function progressBarHtml(pct) {
    var v = Math.max(0, Math.min(100, Number(pct) || 0));
    return '<span class="up-bar" role="progressbar" aria-label="사진 올리는 중"><span class="up-bar-fill" style="width:' + v + '%"></span></span>';
  }
  function setDropProgress(container, pct) {
    if (!container) return;
    var hint = container.querySelector(".img-drop-hint");
    var fill = container.querySelector(".up-bar-fill");
    if (hint) hint.textContent = uploadingText(pct);
    if (fill) fill.style.width = Math.max(0, Math.min(100, Number(pct) || 0)) + "%";
  }

  /* ── 붙여넣기 에디터 헬퍼 (P3-d B1) ── */

  // plain text → <p> 단락 html (줄 단위, esc 필수)
  function textToHtmlParas(text) {
    return String(text || "").split(/\r?\n/).map(function (line) {
      line = line.trim();
      return line ? "<p>" + esc(line) + "</p>" : "";
    }).join("");
  }

  // sanitize 완료된 html만 진입 허용 (원문 결합 금지) — 캐럿 위치에 삽입
  function insertHtmlAtCaret(editor, html) {
    editor.focus();
    var sel = window.getSelection();
    var range;
    if (!sel.rangeCount || !editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    range = sel.getRangeAt(0);
    range.deleteContents();
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    var frag = document.createDocumentFragment();
    var lastNode = null;
    while (tmp.firstChild) lastNode = frag.appendChild(tmp.firstChild);
    range.insertNode(frag);
    if (lastNode) {
      range.setStartAfter(lastNode);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function dataUrlToBlob(dataUrl) {
    return fetch(dataUrl).then(function (r) { return r.blob(); });
  }

  /* ════════════════════════ 라우터 ════════════════════════ */

  function render() {
    if (!state.session) return;
    var h = location.hash || "#/";
    var m;
    // P3-f: 기본 진입 = "홈페이지 보며 수정". 메뉴판(대시보드)은 #/manage 로 내려간다.
    document.body.classList.remove("live-mode");
    if (h === "#/" || h === "" || h === "#") viewLive("");
    else if ((m = h.match(/^#\/live(?:\?(.*))?$/))) viewLive(m[1] || "");
    else if (h === "#/manage") viewDashboard();
    else if (h === "#/content") viewContent();
    else if (h === "#/design") viewDesign();
    else if (h === "#/notice") viewNotice();
    else if (h === "#/zones") viewZones();
    else if (h === "#/home") viewHome();
    else if (h === "#/posts") viewPosts();
    else if (h === "#/posts/new") viewPostEdit(null);
    else if ((m = h.match(/^#\/posts\/(\d+)$/))) viewPostEdit(Number(m[1]));
    else if (h === "#/faqs") viewFaqs();
    else if (h === "#/faqs/new") viewFaqEdit(null);
    else if ((m = h.match(/^#\/faqs\/(\d+)$/))) viewFaqEdit(Number(m[1]));
    else if (h === "#/reviews") viewReviews();
    else if (h === "#/reviews/new") viewReviewEdit(null);
    else if ((m = h.match(/^#\/reviews\/(\d+)$/))) viewReviewEdit(Number(m[1]));
    else if (h === "#/settings") viewSettings();
    else if (h === "#/password") viewPassword();
    else viewLive("");
    window.scrollTo(0, 0);
  }

  function loadingView() {
    root().innerHTML = '<p class="empty-note">불러오는 중이에요…</p>';
  }

  function loadFailView(err) {
    root().innerHTML =
      '<div class="notice-error">내용을 불러오지 못했어요. 인터넷 연결을 확인하고 아래 버튼을 눌러 주세요.</div>' +
      '<button type="button" class="btn-secondary" id="btn-retry">다시 불러오기</button>';
    byId("btn-retry").addEventListener("click", render);
    if (err) console.error("[admin] load error:", err);
  }

  function backLink(hash, label) {
    return '<button type="button" class="back-link" data-nav="' + esc(hash) + '">&larr; ' + esc(label) + "</button>";
  }
  function bindNav(container) {
    container.querySelectorAll("[data-nav]").forEach(function (el) {
      el.addEventListener("click", function () { location.hash = el.getAttribute("data-nav"); });
    });
  }

  /* ════════════════════════ 콘텐츠 모아보기 (#/content) ════════════════════════
   * 왜 필요한가 — "홈페이지 보며 수정"은 **자리가 있는 것**만 다룬다. 글·후기·질문·사진처럼
   * 쌓이는 것은 자리보다 "몇 개 있고 무엇이 아직 안 올라갔나"가 관리 단위다.
   * 실제로 지금 글 15건 중 발행된 것이 0건인데, 미리보기에는 발행분만 나오므로
   * 라이브 화면만으로는 그 15건을 **영영 만날 수 없다**. 이 화면이 그 사각지대를 없앤다.
   *
   * 기존 타입별 화면(#/posts·#/reviews·#/faqs)은 그대로 둔다 — 여기는 가로지르는 조회·일괄 처리용.
   * ========================================================================== */

  var HUB_TYPES = [
    { key: "all", label: "전체" },
    { key: "post", label: "글" },
    { key: "review", label: "후기" },
    { key: "faq", label: "질문" },
    { key: "photo", label: "사진" },
    { key: "zone", label: "진료분야" }
  ];
  var HUB_TYPE_LABEL = { post: "글", review: "후기", faq: "질문", photo: "사진", zone: "분야" };
  /* 새로 쓰는 길 — 지금까지 모아보기에는 목록이 **빌 때만** 나타나는 버튼밖에 없어서,
   * 글 19편이 쌓인 상태에서는 여기서 20번째 글을 시작할 방법이 없었다(실측 2026-07-23).
   * 사진·분야는 여기서 새로 만드는 것이 아니라 빼 둔다(사진은 글·후기를 쓸 때 올라온다). */
  var HUB_NEW = {
    all: { hash: "#/posts/new", label: "+ 새 글 쓰기" },
    post: { hash: "#/posts/new", label: "+ 새 글 쓰기" },
    review: { hash: "#/reviews/new", label: "+ 새 후기 카드 쓰기" },
    faq: { hash: "#/faqs/new", label: "+ 새 질문 쓰기" }
  };
  // 화면을 다시 그려도 보던 조건이 유지되게 — 목록 → 수정 → 뒤로 왕복이 잦다
  var hub = { q: "", type: "all", status: "all", zone: "", sel: {}, items: null };

  function viewContent() {
    loadingView();
    Promise.all([
      loadZones(true),
      hubRows("posts", "id, title, badge, zone_id, published, thumbnail_path, updated_at"),
      hubRows("reviews", "id, title, body, zone_id, published, is_highlight, thumbnail_path, updated_at"),
      hubRows("faqs", "id, question, answer, zone_id, published, show_on_home, updated_at"),
      // 사진은 없어도 나머지는 보여야 한다 — 보관함 조회 실패가 화면 전체를 막지 않게
      listStorageImages("", 1).catch(function () { return []; })
    ]).then(function (r) {
      hub.items = hubNormalize(r[1], r[2], r[3], r[4]);
      hub.sel = {};
      renderContentHub();
    }).catch(loadFailView);
  }

  function hubRows(table, cols) {
    return sb.from(table).select(cols).order("updated_at", { ascending: false }).then(function (res) {
      if (res.error) throw res.error;
      return res.data || [];
    });
  }

  // 종류가 다른 것들을 한 줄에 나란히 세우려면 공통 모양이 필요하다.
  function hubNormalize(posts, reviews, faqs, photos) {
    var out = [];
    (posts || []).forEach(function (p) {
      out.push({
        type: "post", id: p.id, title: p.title || "(제목 없음)",
        sub: p.badge || "", zoneId: p.zone_id, published: !!p.published,
        thumb: p.thumbnail_path, updated: p.updated_at,
        hash: "#/posts/" + p.id, table: "posts"
      });
    });
    (reviews || []).forEach(function (r) {
      out.push({
        type: "review", id: r.id, title: r.title || firstLine(r.body) || "(제목 없음)",
        sub: r.is_highlight ? "홈 화면 강조" : "", zoneId: r.zone_id, published: !!r.published,
        thumb: r.thumbnail_path, updated: r.updated_at,
        hash: "#/reviews/" + r.id, table: "reviews"
      });
    });
    (faqs || []).forEach(function (f) {
      out.push({
        type: "faq", id: f.id, title: f.question || "(질문 없음)",
        sub: f.show_on_home ? "홈에도 표시" : "", zoneId: f.zone_id, published: !!f.published,
        thumb: null, updated: f.updated_at, body: f.answer,
        hash: "#/faqs/" + f.id, table: "faqs"
      });
    });
    // 사진이 어디에 쓰이는지 — 이걸 안 보여주면 원장이 쓰이는 사진을 지워 놓고
    // 홈페이지가 왜 깨졌는지 알 수 없게 된다(Squarespace가 무경고 삭제로 겪는 실패).
    var usedBy = {};
    function markUse(path, where) {
      if (!path) return;
      var k = String(path).replace(/^\/+/, "");
      (usedBy[k] = usedBy[k] || []).push(where);
    }
    (posts || []).forEach(function (p) { markUse(p.thumbnail_path, "글 «" + (p.title || "") + "»"); });
    (reviews || []).forEach(function (r) { markUse(r.thumbnail_path, "후기 «" + (r.title || firstLine(r.body) || "") + "»"); });
    (state.zones || []).forEach(function (z) { markUse(z.hero_image_path, "분야 «" + (z.name || "") + "»"); });

    // ⚠ 사용처 계산은 DB 참조(글·후기·분야 썸네일)만 센다. CSS 배경으로 쓰이는 사진은
    //   여기서 알 수 없다 — 그래서 사이트 기본 사진에 "안 쓰는 사진"이라고 적으면 거짓말이 된다
    //   (실제로 홈 구역 배경으로 쓰이고 있다). 기본 사진은 사용처를 단정하지 않는다.
    function pushPhoto(path, label, group, canDelete) {
      var uses = usedBy[String(path).replace(/^\/+/, "")] || [];
      var note = canDelete
        ? (uses.length ? uses.length + "곳에서 쓰는 중" : "아직 안 쓰는 사진")
        : "홈페이지에 원래 있는 사진";
      out.push({
        type: "photo", id: path, title: label || path,
        sub: (group ? group + " · " : "") + note, useNote: note,
        uses: uses, zoneId: null, published: true, thumb: path,
        updated: null, hash: "", table: null, canDelete: !!canDelete
      });
    }
    // 진료분야는 "쌓이는 것"은 아니지만, 원장이 가장 자주 묻는 것이 여기다 —
    // 어느 분야에 글이 없고 어느 분야에 대표사진이 비어 있는지. 실측으로 4곳이 비어 있었다.
    (state.zones || []).forEach(function (z) {
      var n = (posts || []).filter(function (p) { return p.zone_id === z.id; }).length;
      var gaps = [];
      if (!z.hero_image_path) gaps.push("대표사진 없음");
      if (!n) gaps.push("글 없음");
      out.push({
        type: "zone", id: z.id, title: z.name,
        sub: (n + "개 글") + (gaps.length ? " · " + gaps.join(" · ") : ""),
        zoneId: z.id, published: !!z.is_visible, thumb: z.hero_image_path,
        updated: z.updated_at, hash: "#/zones", table: "zones", needsWork: gaps.length > 0
      });
    });

    (photos || []).forEach(function (ph) { pushPhoto(ph.path, ph.label, "올린 사진", true); });
    // 사이트에 원래 들어 있던 사진도 같이 보여 준다. 보관함만 보여 주면 처음 쓰는 원장에게는
    // "사진 0장"으로 보이는데, 실제로 홈페이지에는 사진이 가득 차 있다. (지우기는 불가 — 납품 자산)
    (window.ZIA_STOCK_IMAGES || []).forEach(function (s) { pushPhoto(s.path, s.label, s.group, false); });
    return out;
  }

  function firstLine(s) {
    if (!s) return "";
    var t = String(s).replace(/\s+/g, " ").trim();
    return t.length > 60 ? t.slice(0, 60) + "…" : t;
  }

  function hubFilter(items) {
    var q = hub.q.trim().toLowerCase();
    return items.filter(function (it) {
      if (hub.type !== "all" && it.type !== hub.type) return false;
      // 사진은 올리고 내리는 개념 자체가 없다. 상태를 고른 순간 사진은 답이 아니므로 빼야 한다
      // — 남겨 두면 "올라감"과 "안 올라감" 양쪽에 똑같이 세어져 숫자가 서로 안 맞는다.
      if (hub.status !== "all") {
        if (it.type === "photo" || it.type === "zone") return false;
        if (hub.status === "live" && !it.published) return false;
        if (hub.status === "draft" && it.published) return false;
      }
      if (hub.zone && String(it.zoneId) !== hub.zone) return false;
      if (q) {
        var hay = (it.title + " " + (it.sub || "") + " " + (it.body || "")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderContentHub() {
    var all = hub.items || [];
    var counts = { all: 0, post: 0, review: 0, faq: 0, photo: 0 };
    // 탭 숫자는 "탭을 눌렀을 때 실제로 보일 개수"여야 한다 — 종류만 빼고 같은 조건으로 센다
    var keepType = hub.type;
    HUB_TYPES.forEach(function (t) {
      hub.type = t.key;
      counts[t.key] = hubFilter(all).length;
    });
    hub.type = keepType;

    var draftCount = all.filter(function (i) { return i.type !== "photo" && !i.published; }).length;

    // 상태 버튼의 숫자도 같은 원리 — 상태만 빼고 지금 조건 그대로 센다
    var keepStatus = hub.status;
    var sCount = {};
    ["all", "live", "draft"].forEach(function (s) { hub.status = s; sCount[s] = hubFilter(all).length; });
    hub.status = keepStatus;
    var STATUS_LABEL = { all: "전체", live: "홈페이지에 올라감", draft: "아직 안 올라감" };
    var statusBtns = ["all", "live", "draft"].map(function (s) {
      return '<button type="button" class="hub-seg' + (hub.status === s ? " active" : "") +
        '" data-status="' + s + '">' + esc(STATUS_LABEL[s]) + ' <span class="hub-count">' + sCount[s] + "</span></button>";
    }).join("");

    var tabs = HUB_TYPES.map(function (t) {
      return '<button type="button" class="lib-tab hub-tab' + (hub.type === t.key ? " active" : "") +
        '" data-type="' + t.key + '">' + esc(t.label) + ' <span class="hub-count">' + counts[t.key] + "</span></button>";
    }).join("");

    var zoneOptions = '<option value="">모든 분야</option>' + (state.zones || []).map(function (z) {
      return '<option value="' + z.id + '"' + (String(z.id) === hub.zone ? " selected" : "") + ">" + esc(z.name) + "</option>";
    }).join("");

    root().innerHTML =
      backLink("#/live", "홈페이지 보며 수정으로") +
      '<h1 class="view-title">콘텐츠 모아보기</h1>' +
      '<p class="view-desc">글·후기·질문·사진을 한자리에서 찾고, 여러 개를 한 번에 올리거나 내릴 수 있어요.</p>' +
      (draftCount
        ? '<div class="notice-info hub-draft-note"><span>아직 홈페이지에 안 올라간 것이 <strong>' + draftCount +
          '건</strong> 있어요. 올리려면 골라서 "홈페이지에 올리기"를 눌러 주세요.</span>' +
          '<button type="button" class="btn-ghost btn-sm" id="hub-show-draft">안 올라간 것만 보기</button></div>'
        : "") +
      '<div class="hub-tabs lib-tabs">' + tabs + "</div>" +
      '<div class="topbar hub-bar">' +
      '<input type="search" id="hub-q" class="hub-search" placeholder="제목·내용으로 찾기" value="' + esc(hub.q) + '" aria-label="검색">' +
      '<select id="hub-zone" aria-label="분야">' + zoneOptions + "</select>" +
      (HUB_NEW[hub.type]
        ? '<button type="button" class="btn-primary hub-new" data-nav="' + esc(HUB_NEW[hub.type].hash) + '">' +
          esc(HUB_NEW[hub.type].label) + "</button>"
        : "") +
      "</div>" +
      // 사진만 보는 중이면 올림/내림 고르개는 뜻이 없다 — 숨긴다
      (hub.type === "photo" || hub.type === "zone" ? "" : '<div class="hub-seg-row" role="group" aria-label="올라간 상태">' + statusBtns + "</div>") +
      '<div id="hub-bulk" class="hub-bulk hidden"></div>' +
      '<div id="hub-list"></div>';

    var q = byId("hub-q");
    // 글자를 칠 때마다 다시 그리면 커서가 튄다 → 목록만 갈아끼운다
    q.addEventListener("input", function () { hub.q = this.value; drawHubRows(); });
    byId("hub-zone").addEventListener("change", function () { hub.zone = this.value; renderContentHub(); });
    root().querySelectorAll(".hub-seg").forEach(function (b) {
      b.addEventListener("click", function () { hub.status = b.getAttribute("data-status"); renderContentHub(); });
    });
    var draftBtn = byId("hub-show-draft");
    if (draftBtn) draftBtn.addEventListener("click", function () { hub.status = "draft"; hub.type = "all"; renderContentHub(); });
    root().querySelectorAll(".hub-tab").forEach(function (b) {
      b.addEventListener("click", function () { hub.type = b.getAttribute("data-type"); renderContentHub(); });
    });
    bindNav(root());
    drawHubRows();
  }

  function drawHubRows() {
    var list = byId("hub-list");
    if (!list) return;
    var rows = hubFilter(hub.items || []);
    if (!rows.length) {
      var e = hubEmptyState();
      list.innerHTML = '<div class="hub-empty"><p class="hub-empty-title">' + esc(e.title) + "</p>" +
        '<p class="empty-note">' + esc(e.body) + "</p>" +
        '<button type="button" class="btn-primary" id="hub-empty-cta">' + esc(e.cta) + "</button></div>";
      byId("hub-empty-cta").addEventListener("click", e.run);
      syncHubBulk();
      return;
    }
    // 사진은 목록 행으로 세우면 60장이 세로로 끝없이 늘어져 훑을 수가 없다.
    // 사진만 격자로 본다(WordPress 미디어 보관함이 격자를 기본으로 두는 이유와 같다).
    var grid = hub.type === "photo";
    list.className = grid ? "hub-photo-grid" : "";
    list.innerHTML = rows.map(grid ? hubPhotoCardHtml : hubRowHtml).join("");
    list.querySelectorAll(".item-row").forEach(function (row) {
      var key = row.getAttribute("data-key");
      var it = rows.find(function (x) { return hubKey(x) === key; });
      if (!it) return;
      var cb = row.querySelector(".hub-check");
      if (cb) cb.addEventListener("change", function () {
        if (this.checked) hub.sel[key] = it; else delete hub.sel[key];
        row.classList.toggle("is-sel", this.checked);
        syncHubBulk();
      });
      var edit = row.querySelector('[data-act="edit"]');
      if (edit) edit.addEventListener("click", function () { location.hash = it.hash; });
      var tog = row.querySelector('[data-act="toggle"]');
      if (tog) tog.addEventListener("click", function () { hubSetPublished([it], !it.published); });
      var copy = row.querySelector('[data-act="copy"]');
      if (copy) copy.addEventListener("click", function () { hubCopyPhoto(it); });
      var delp = row.querySelector('[data-act="delphoto"]');
      if (delp) delp.addEventListener("click", function () { hubDeletePhoto(it); });
    });
    syncHubBulk();
  }

  // 빈 화면은 "없다"로 끝내지 않는다 — 다음에 누를 것을 하나만 준다.
  function hubEmptyState() {
    var clear = function () { hub.q = ""; hub.status = "all"; hub.zone = ""; hub.type = "all"; renderContentHub(); };
    /* "아직 안 올라감"이 0건인 것은 문제가 아니라 **다 끝냈다는 좋은 소식**이다.
     * 여기에 "찾는 낱말을 바꿔 보라"는 안내가 뜨면(검색어를 친 적도 없는데) 원장은
     * 뭔가 잘못한 줄 안다 — 실측 2026-07-23, 글·후기·질문 43건이 전부 올라간 상태. */
    if (hub.status === "draft" && !hub.q && !hub.zone) {
      return {
        title: hub.type === "all" ? "홈페이지에 안 올라간 것이 없어요"
          : (HUB_TYPE_LABEL[hub.type] || "") + " 중에 안 올라간 것이 없어요",
        body: "만들어 둔 것이 모두 홈페이지에 올라가 있어요.",
        cta: "전체 보기", run: clear
      };
    }
    if (hub.q || hub.zone || hub.status !== "all") {
      return {
        title: hub.q ? "‘" + hub.q + "’로 찾은 것이 없어요" : "이 조건에 맞는 것이 없어요",
        body: "찾는 낱말을 바꾸거나, 조건을 풀고 전체를 볼 수 있어요.",
        cta: "조건 풀고 전체 보기", run: clear
      };
    }
    if (hub.type === "post") return { title: "첫 글을 올려 보세요", body: "블로그에 쓴 글을 그대로 붙여넣어 올릴 수 있어요.", cta: "새 글 쓰기", run: function () { location.hash = "#/posts/new"; } };
    if (hub.type === "review") return { title: "아직 후기가 없어요", body: "환자분께 받은 이야기를 후기 카드로 만들 수 있어요.", cta: "후기 쓰기", run: function () { location.hash = "#/reviews/new"; } };
    if (hub.type === "faq") return { title: "자주 묻는 질문을 채워 보세요", body: "전화로 자주 받는 질문부터 적으면 문의 전화가 줄어요.", cta: "질문 쓰기", run: function () { location.hash = "#/faqs/new"; } };
    if (hub.type === "zone") return { title: "진료 분야가 아직 없어요", body: "홈페이지에 보여줄 진료 분야를 먼저 정해 주세요.", cta: "분야 관리로", run: function () { location.hash = "#/zones"; } };
    if (hub.type === "photo") return { title: "올린 사진이 아직 없어요", body: "글이나 후기를 쓸 때 사진을 올리면 여기에 모여요.", cta: "새 글 쓰기", run: function () { location.hash = "#/posts/new"; } };
    return { title: "아직 만든 것이 없어요", body: "글부터 하나 올려 보면 홈페이지가 살아나요.", cta: "새 글 쓰기", run: function () { location.hash = "#/posts/new"; } };
  }

  function hubKey(it) { return it.type + ":" + it.id; }

  function hubRowHtml(it) {
    var key = hubKey(it);
    var checked = !!hub.sel[key];
    var thumb = it.thumb
      ? '<span class="hub-thumb"><img src="' + esc(adminImageUrl(it.thumb)) + '" alt=""></span>'
      : '<span class="hub-thumb hub-thumb-empty" aria-hidden="true">—</span>';

    var meta = '<span class="pill hub-kind">' + esc(HUB_TYPE_LABEL[it.type] || "") + "</span>";
    if (it.type !== "photo") {
      meta += '<span class="pill ' + (it.published ? "pill-live" : "pill-draft") + '">' +
        (it.type === "zone"
          ? (it.published ? "홈페이지에 보임" : "숨김")
          : (it.published ? "홈페이지에 올라감" : "아직 안 올라감")) + "</span>";
    }
    // 분야 행에서는 제목이 곧 분야 이름이라 또 적으면 같은 말이 두 번 나온다
    if (it.zoneId && it.type !== "zone") meta += "<span>" + esc(zoneName(it.zoneId)) + "</span>";
    if (it.sub) meta += "<span>" + esc(it.sub) + "</span>";
    if (it.updated) meta += '<span class="hub-when">' + esc(hubWhen(it.updated)) + "</span>";

    var actions = it.type === "photo"
      ? '<button type="button" class="btn-secondary btn-sm" data-act="copy">주소 복사</button>' +
        (it.canDelete ? '<button type="button" class="btn-ghost btn-sm" data-act="delphoto">삭제</button>' : "")
      : it.type === "zone"
        ? '<button type="button" class="btn-secondary btn-sm" data-act="edit">분야 관리로</button>'
        : '<button type="button" class="btn-secondary btn-sm" data-act="edit">수정</button>' +
          '<button type="button" class="btn-ghost btn-sm" data-act="toggle">' +
          (it.published ? "내리기" : "올리기") + "</button>";

    return '<div class="item-row hub-row' + (checked ? " is-sel" : "") + '" data-key="' + esc(key) + '">' +
      (it.type === "photo" ? '<span class="hub-check-slot"></span>'
        : '<label class="hub-check-slot"><input type="checkbox" class="hub-check"' + (checked ? " checked" : "") +
          ' aria-label="고르기"></label>') +
      thumb +
      '<div class="item-main"><div class="item-title">' + esc(it.title) + "</div>" +
      '<div class="item-meta">' + meta + "</div></div>" +
      '<div class="item-actions">' + actions + "</div></div>";
  }

  function hubPhotoCardHtml(it) {
    var uses = (it.uses || []).length;
    return '<div class="item-row hub-photo" data-key="' + esc(hubKey(it)) + '">' +
      '<span class="hub-photo-thumb"><img src="' + esc(adminImageUrl(it.thumb)) + '" alt="" loading="lazy"></span>' +
      '<div class="hub-photo-name">' + esc(it.title) + "</div>" +
      '<div class="hub-photo-use' + (uses ? " is-used" : "") + '">' + esc(it.useNote || "") + "</div>" +
      '<div class="item-actions">' +
      '<button type="button" class="btn-secondary btn-sm" data-act="copy">주소 복사</button>' +
      (it.canDelete ? '<button type="button" class="btn-ghost btn-sm" data-act="delphoto">삭제</button>' : "") +
      "</div></div>";
  }

  function hubWhen(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 3600) return "방금 전";
    if (diff < 86400) return Math.floor(diff / 3600) + "시간 전";
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + "일 전";
    return (d.getMonth() + 1) + "월 " + d.getDate() + "일";
  }

  function syncHubBulk() {
    var bar = byId("hub-bulk");
    if (!bar) return;
    var picked = Object.keys(hub.sel).map(function (k) { return hub.sel[k]; });
    if (!picked.length) { bar.classList.add("hidden"); bar.innerHTML = ""; return; }
    bar.classList.remove("hidden");
    bar.innerHTML = '<span class="hub-bulk-n"><strong>' + picked.length + "건</strong> 골랐어요</span>" +
      '<button type="button" class="btn-primary btn-sm" data-bulk="on">홈페이지에 올리기</button>' +
      '<button type="button" class="btn-secondary btn-sm" data-bulk="off">홈페이지에서 내리기</button>' +
      '<button type="button" class="btn-ghost btn-sm" data-bulk="clear">고른 것 지우기</button>';
    bar.querySelector('[data-bulk="on"]').addEventListener("click", function () { hubSetPublished(picked, true); });
    bar.querySelector('[data-bulk="off"]').addEventListener("click", function () { hubSetPublished(picked, false); });
    bar.querySelector('[data-bulk="clear"]').addEventListener("click", function () {
      hub.sel = {};
      root().querySelectorAll(".hub-check").forEach(function (c) { c.checked = false; });
      root().querySelectorAll(".hub-row").forEach(function (r) { r.classList.remove("is-sel"); });
      syncHubBulk();
    });
  }

  // 여러 건을 한 번에 올리고 내린다. 표가 달라도 컬럼 이름은 published 하나로 같다.
  function hubSetPublished(items, on) {
    var targets = items.filter(function (it) { return it.table && it.published !== on; });
    if (!targets.length) { toast(on ? "이미 다 올라가 있어요" : "이미 다 내려가 있어요"); return; }

    var run = function () {
      var byTable = {};
      targets.forEach(function (it) { (byTable[it.table] = byTable[it.table] || []).push(it.id); });
      var jobs = Object.keys(byTable).map(function (t) {
        return sb.from(t).update({ published: on }).in("id", byTable[t]);
      });
      Promise.all(jobs).then(function (res) {
        var bad = res.filter(function (r) { return r && r.error; });
        if (bad.length) { dbError(bad[0].error, on ? "올리지 못했어요" : "내리지 못했어요"); return; }
        markDataChanged();
        toast(targets.length + "건을 " + (on ? "홈페이지에 올렸어요" : "홈페이지에서 내렸어요"));
        viewContent();
      });
    };

    // 내리는 것은 방문자 화면에서 사라지는 일이라 되묻는다. 올리는 것은 되묻지 않는다.
    if (!on) {
      confirmModal({
        title: targets.length + "건을 홈페이지에서 내릴까요?",
        body: "내려도 내용은 그대로 보관돼요. 언제든 다시 올릴 수 있어요.",
        confirmLabel: "내리기"
      }).then(function (ok) { if (ok) run(); });
    } else run();
  }

  // 쓰고 있는 사진은 지우지 못하게 막는다. 지우고 나서 어디가 깨졌는지 찾는 것은
  // 원장이 할 수 있는 일이 아니다 — 막고, 어디서 쓰는지 알려 준다.
  function hubDeletePhoto(it) {
    var uses = it.uses || [];
    if (uses.length) {
      confirmModal({
        title: "이 사진은 지금 쓰는 중이라 지울 수 없어요",
        body: "먼저 아래에서 다른 사진으로 바꿔 주세요.\n\n" + uses.slice(0, 6).join("\n") +
          (uses.length > 6 ? "\n… 외 " + (uses.length - 6) + "곳" : ""),
        confirmLabel: "알겠어요"
      });
      return;
    }
    confirmModal({
      title: "이 사진을 지울까요?",
      body: "지금 홈페이지 어디에서도 쓰지 않는 사진이에요. 지우면 되돌릴 수 없어요.",
      confirmLabel: "삭제", danger: true
    }).then(function (ok) {
      if (!ok) return;
      sb.storage.from("zia-media").remove([it.id]).then(function (res) {
        if (res.error) { dbError(res.error, "사진을 지우지 못했어요"); return; }
        toast("사진을 지웠어요");
        viewContent();
      });
    });
  }

  function hubCopyPhoto(it) {
    var url = storagePublicUrl(String(it.thumb || "").replace(/^\/+/, ""));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { toast("사진 주소를 복사했어요"); },
        function () { toast("복사하지 못했어요", "error"); }
      );
    } else toast("이 브라우저에서는 복사가 안 돼요", "error");
  }

  /* ════════════════════════ 색·글씨 (#/design) ════════════════════════
   * 타 업체(아임웹 "공통 디자인 설정" · 식스샵 "스타일 편집")가 전부 갖춘 기능이고,
   * 없으면 색 하나 바꾸는 데도 업체에 의뢰해야 한다 — 원장 불만 1순위가 그 구조다.
   *
   * 안전장치: 원장이 자기 홈페이지를 못 읽게 만들 수 있는 조합은 저장 단계에서 막는다.
   * 색은 취향이지만 **읽히지 않는 것은 취향이 아니라 고장**이다(WCAG 1.4.3 = 4.5:1).
   * 실제로 이 사이트는 이미 브랜드 색 대비 미달이 12곳 지적된 상태다.
   * ========================================================================== */

  /* 기준을 용도별로 나눈 이유 —
   * 처음에 전부 4.5:1(본문 글씨 기준)로 막았더니 **지금 쓰는 브랜드 색(#B79A78)부터 불합격**이라
   * 원장이 아무것도 저장할 수 없었다. 브랜드 색은 주로 버튼·테두리·장식에 쓰이고 그 기준은
   * 4.5:1이 아니라 3:1(WCAG 1.4.11 비텍스트 대비)이다. 본문 글씨만 하드 차단하고
   * 나머지는 알려 주되 원장이 결정하게 둔다. 안 그러면 "안전장치"가 제품을 못 쓰게 만든다.
   * 또 원장이 손대지 않은 색은 원래 그랬던 것이므로 저장을 막지 않는다. */
  // 사이트 주입(재색상 엔진, cms-inject.js injectTheme)이 붙어 실제로 반영된다.
  // 검증: 3페이지에서 옛 브랜드 색 잔존 0, 악의적 값은 시트 미생성으로 전량 무시.
  var THEME_LIVE = true;
  var THEME_FIELDS = [
    { key: "theme_brand", label: "기본 색", help: "버튼·테두리·강조에 쓰여요.", fallback: "#B79A78", contrastOn: "#ffffff", min: 3, hard: false },
    { key: "theme_brand2", label: "보조 색", help: "제목과 짙은 배경에 쓰여요.", fallback: "#2E3F66", contrastOn: "#ffffff", min: 3, hard: false },
    { key: "theme_text", label: "본문 글씨 색", help: "긴 글의 글씨 색이에요.", fallback: "#22201E", contrastOn: "#ffffff", min: 4.5, hard: true }
  ];
  var FONT_SCALES = [
    { v: "0.95", label: "조금 작게" }, { v: "1", label: "기본" },
    { v: "1.1", label: "조금 크게" }, { v: "1.2", label: "크게" }
  ];

  function viewDesign() {
    loadingView();
    sb.from("site_settings").select("key, value").then(function (res) {
      if (res.error) { loadFailView(res.error); return; }
      var cur = {};
      (res.data || []).forEach(function (r) { cur[r.key] = r.value; });
      renderDesign(cur);
    });
  }

  function renderDesign(cur) {
    function val(f) { return isHexColor(cur[f.key]) ? cur[f.key] : f.fallback; }
    var scale = cur.theme_font_scale || "1";

    var colorRows = THEME_FIELDS.map(function (f) {
      var v = val(f);
      return '<div class="design-row" data-key="' + f.key + '">' +
        '<div class="design-label"><label for="c-' + f.key + '">' + esc(f.label) + "</label>" +
        '<p class="help">' + esc(f.help) + "</p></div>" +
        '<input type="color" id="c-' + f.key + '" value="' + esc(v) + '">' +
        '<input type="text" class="design-hex" value="' + esc(v) + '" maxlength="7" aria-label="' + esc(f.label) + ' 색상표 값">' +
        '<span class="design-verdict" aria-live="polite"></span>' +
        "</div>";
    }).join("");

    root().innerHTML =
      backLink("#/manage", "관리 목록으로") +
      '<h1 class="view-title">색·글씨</h1>' +
      '<p class="view-desc">홈페이지 전체의 색과 글씨 크기를 한 번에 바꿔요. 바꾼 색은 모든 페이지에 함께 적용돼요.</p>' +
      // 사이트 주입이 붙기 전에는 저장해도 화면이 안 바뀐다. 그 사실을 숨기면 원장은
      // "저장했는데 왜 그대로지?"로 시간을 버린다 — 붙는 날 THEME_LIVE 한 줄만 바꾼다.
      (THEME_LIVE ? "" : '<div class="notice-info">고른 색은 저장되지만 <strong>아직 홈페이지에 나타나지 않아요.</strong> ' +
        "홈페이지에 입히는 작업이 끝나면 저장해 두신 색이 그대로 적용돼요.</div>") +
      '<div class="card"><h2 class="settings-group">색</h2>' + colorRows +
      '<p class="help design-note">글씨가 배경과 충분히 구분돼야 어르신 환자분도 읽을 수 있어요. ' +
      "너무 옅은 색은 저장할 수 없게 막아 두었어요.</p></div>" +
      '<div class="card"><h2 class="settings-group">글씨 크기</h2>' +
      '<div class="design-scale">' + FONT_SCALES.map(function (s) {
        return '<button type="button" class="hub-seg' + (String(scale) === s.v ? " active" : "") +
          '" data-scale="' + s.v + '">' + esc(s.label) + "</button>";
      }).join("") + "</div>" +
      '<p class="help">본문 글씨만 커져요. 제목과 메뉴는 그대로예요.</p></div>' +
      '<div class="save-bar"><button type="button" class="btn-primary" id="design-save">저장하기</button>' +
      '<button type="button" class="btn-secondary" id="design-reset">처음 색으로 되돌리기</button></div>';
    // backLink 는 [data-nav] 버튼만 그린다 — 이 호출이 없으면 "관리 목록으로"가 눌리지 않는다.
    bindNav(root());

    var pending = { scale: String(scale) };
    THEME_FIELDS.forEach(function (f) { pending[f.key] = val(f); });

    var original = {};
    THEME_FIELDS.forEach(function (f) { original[f.key] = val(f); });

    function syncRow(f) {
      var row = root().querySelector('.design-row[data-key="' + f.key + '"]');
      var verdict = row.querySelector(".design-verdict");
      var ok = contrastRatio(pending[f.key], f.contrastOn) >= f.min;
      var changed = pending[f.key].toLowerCase() !== String(original[f.key]).toLowerCase();
      verdict.textContent = ok ? "잘 보여요" : "옅어요";
      verdict.className = "design-verdict " + (ok ? "is-ok" : "is-bad");
      row.classList.toggle("is-bad", !ok);
      // 막을 자격이 있는 것은 "본문 글씨가 안 보이게 되는 변경"뿐이다
      return ok || !f.hard || !changed;
    }

    THEME_FIELDS.forEach(function (f) {
      var row = root().querySelector('.design-row[data-key="' + f.key + '"]');
      var picker = row.querySelector('input[type="color"]');
      var hex = row.querySelector(".design-hex");
      picker.addEventListener("input", function () {
        pending[f.key] = this.value; hex.value = this.value; syncRow(f);
      });
      hex.addEventListener("input", function () {
        var v = this.value.trim();
        if (!isHexColor(v)) return;          // 타이핑 도중에는 나무라지 않는다
        pending[f.key] = v; picker.value = v; syncRow(f);
      });
      syncRow(f);
    });

    root().querySelectorAll("[data-scale]").forEach(function (b) {
      b.addEventListener("click", function () {
        pending.scale = b.getAttribute("data-scale");
        root().querySelectorAll("[data-scale]").forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
      });
    });

    byId("design-save").addEventListener("click", function () {
      var blocked = THEME_FIELDS.filter(function (f) { return !syncRow(f); });
      if (blocked.length) {
        toast("‘" + blocked[0].label + "’이 너무 옅어서 글씨가 안 보여요. 조금 더 진하게 골라 주세요.", "error");
        return;
      }
      var rows = THEME_FIELDS.map(function (f) { return { key: f.key, value: pending[f.key] }; });
      rows.push({ key: "theme_font_scale", value: pending.scale });
      var btn = this;
      busy(btn, true, "저장 중…");
      settingsUpsert(rows).then(function (res) {
        busy(btn, false);
        if (res.error) { dbError(res.error, "저장하지 못했어요"); return; }
        markDataChanged();
        toastView("색·글씨를 바꿨어요", "settings");
      });
    });

    byId("design-reset").addEventListener("click", function () {
      confirmModal({
        title: "처음 색으로 되돌릴까요?",
        body: "홈페이지를 만들 때 정한 색과 글씨 크기로 돌아가요.",
        confirmLabel: "되돌리기"
      }).then(function (ok) {
        if (!ok) return;
        // 값을 지우는 것이 곧 "원래대로"다 — 주입 쪽이 값이 없으면 아무것도 하지 않는다
        var rows = THEME_FIELDS.map(function (f) { return { key: f.key, value: "" }; });
        rows.push({ key: "theme_font_scale", value: "" });
        settingsUpsert(rows).then(function (res) {
          if (res.error) { dbError(res.error, "되돌리지 못했어요"); return; }
          markDataChanged();
          toast("처음 색으로 되돌렸어요");
          viewDesign();
        });
      });
    });
  }

  function isHexColor(v) { return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(v || "").trim()); }

  // WCAG 1.4.3 상대 명도 대비. 4.5:1 미만이면 본문 글씨로 쓰기에 부족하다.
  function contrastRatio(a, b) {
    var la = relLuminance(a), lb = relLuminance(b);
    if (la === null || lb === null) return 21;
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }
  function relLuminance(hex) {
    if (!isHexColor(hex)) return null;
    var h = String(hex).trim().slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var c = [0, 2, 4].map(function (i) {
      var v = parseInt(h.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  /* ════════════════════════ 휴진·공지 알림 (#/notice) ════════════════════════
   * 병의원 홈페이지에서 가장 자주 고치는 것이 휴진·공지다(업계 조사 일치).
   * 그런데 지금은 이걸 원장이 직접 올릴 수단이 아예 없어서, 설 연휴 휴진 한 줄을
   * 붙이려면 업체에 연락해야 한다. 그 구조가 원장 불만 1순위였다.
   *
   * 저장은 site_settings 의 notice_popup 키에 JSON 한 덩어리로 넣는다 —
   * 표를 새로 만들지 않아도 되고(마이그레이션 없이 오늘 쓸 수 있다),
   * 항목이 늘어도 스키마가 흔들리지 않는다.
   * ========================================================================== */

  var NOTICE_KEY = "notice_popup";
  // 사이트 표시(cms-inject.js injectNotice)가 붙어 실제로 뜬다.
  // 검증: 표시·ESC·"오늘 하루 안 보기" 지속·기간 만료 자동 해제·수정 모드 미표시·XSS 차단.
  var NOTICE_LIVE = true;

  function parseNotice(raw) {
    var d = {};
    try { d = JSON.parse(raw || "{}") || {}; } catch (e) { d = {}; }
    return {
      on: !!d.on,
      title: String(d.title || ""),
      body: String(d.body || ""),
      from: /^\d{4}-\d{2}-\d{2}$/.test(d.from || "") ? d.from : "",
      to: /^\d{4}-\d{2}-\d{2}$/.test(d.to || "") ? d.to : "",
      hideDays: [0, 1, 7].indexOf(Number(d.hideDays)) !== -1 ? Number(d.hideDays) : 1
    };
  }

  function viewNotice() {
    loadingView();
    sb.from("site_settings").select("key, value").eq("key", NOTICE_KEY).then(function (res) {
      if (res.error) { loadFailView(res.error); return; }
      renderNotice(parseNotice((res.data && res.data[0] || {}).value));
    });
  }

  function renderNotice(n) {
    root().innerHTML =
      backLink("#/manage", "관리 목록으로") +
      '<h1 class="view-title">휴진·공지 알림</h1>' +
      '<p class="view-desc">홈페이지에 들어온 분께 안내창을 띄워요. 연휴 휴진, 진료시간 변경 같은 것을 알릴 때 써요.</p>' +
      (NOTICE_LIVE ? "" : '<div class="notice-info">여기서 저장한 내용은 <strong>아직 홈페이지에 뜨지 않아요.</strong> ' +
        "홈페이지에 붙이는 작업이 끝나면 저장해 두신 내용이 그대로 나타나요.</div>") +
      '<div class="card">' +
      '<div class="field"><label class="switch"><input type="checkbox" id="n-on"' + (n.on ? " checked" : "") +
      '> <span>지금 안내창 띄우기</span></label>' +
      '<p class="help">꺼 두면 내용은 그대로 보관되고 홈페이지에는 안 나와요.</p></div>' +
      '<div class="field"><label for="n-title">제목</label>' +
      '<input type="text" id="n-title" maxlength="40" value="' + esc(n.title) + '" placeholder="예: 설 연휴 휴진 안내">' +
      '<p class="help">40자까지 쓸 수 있어요.</p></div>' +
      '<div class="field"><label for="n-body">내용</label>' +
      '<textarea id="n-body" rows="4" maxlength="300" placeholder="예: 2월 9일(월)부터 2월 11일(수)까지 휴진합니다. 2월 12일(목)부터 정상 진료합니다.">' +
      esc(n.body) + "</textarea>" +
      '<p class="help">300자까지 쓸 수 있어요. 줄을 바꿔 써도 그대로 나와요.</p></div>' +
      '<div class="field"><label>보여줄 기간</label>' +
      '<div class="notice-dates"><input type="date" id="n-from" value="' + esc(n.from) + '" aria-label="시작 날짜">' +
      '<span>부터</span><input type="date" id="n-to" value="' + esc(n.to) + '" aria-label="끝 날짜"><span>까지</span></div>' +
      '<p class="help">비워 두면 끌 때까지 계속 보여요. 끝나는 날이 지나면 저절로 사라져요.</p></div>' +
      '<div class="field"><label for="n-hide">닫은 뒤 다시 보이기</label>' +
      '<select id="n-hide">' +
      '<option value="0"' + (n.hideDays === 0 ? " selected" : "") + ">페이지를 옮길 때마다 다시 보이기</option>" +
      '<option value="1"' + (n.hideDays === 1 ? " selected" : "") + ">오늘 하루는 안 보이기</option>" +
      '<option value="7"' + (n.hideDays === 7 ? " selected" : "") + ">일주일 동안 안 보이기</option>" +
      "</select>" +
      '<p class="help">같은 분께 안내창이 계속 뜨면 불편해해요. 보통 "오늘 하루"를 씁니다.</p></div>' +
      "</div>" +
      '<div class="card"><h2 class="settings-group">이렇게 보여요</h2><div id="n-preview" class="notice-preview"></div></div>' +
      '<div class="save-bar"><button type="button" class="btn-primary" id="n-save">저장하기</button></div>';
    // backLink 는 [data-nav] 버튼만 그린다 — 이 호출이 없으면 "관리 목록으로"가 눌리지 않는다.
    bindNav(root());

    function draw() {
      var t = byId("n-title").value.trim(), b = byId("n-body").value.trim();
      byId("n-preview").innerHTML = (t || b)
        ? '<div class="notice-card"><div class="notice-card-title">' + esc(t || "(제목 없음)") + "</div>" +
          '<div class="notice-card-body">' + esc(b).replace(/\n/g, "<br>") + "</div>" +
          '<div class="notice-card-foot"><span>' + esc(byId("n-hide").value === "0" ? "닫기" : "오늘 하루 안 보기") +
          "</span><span>닫기</span></div></div>"
        : '<p class="empty-note">제목이나 내용을 쓰면 여기에 미리 보여요.</p>';
    }
    ["n-title", "n-body", "n-hide"].forEach(function (id) {
      byId(id).addEventListener("input", draw);
      byId(id).addEventListener("change", draw);
    });
    draw();

    byId("n-save").addEventListener("click", function () {
      var on = byId("n-on").checked;
      var title = byId("n-title").value.trim();
      var body = byId("n-body").value.trim();
      var from = byId("n-from").value, to = byId("n-to").value;
      if (on && !title && !body) { toast("띄우려면 제목이나 내용을 한 줄이라도 써 주세요.", "error"); return; }
      if (from && to && from > to) { toast("시작 날짜가 끝나는 날짜보다 늦어요. 날짜를 다시 봐 주세요.", "error"); return; }
      var payload = { on: on, title: title, body: body, from: from, to: to, hideDays: Number(byId("n-hide").value) };
      var btn = this;
      busy(btn, true, "저장 중…");
      settingsUpsert({ key: NOTICE_KEY, value: JSON.stringify(payload), label: "휴진·공지 알림", group_name: "general" })
        .then(function (res) {
          busy(btn, false);
          if (res.error) { dbError(res.error, "저장하지 못했어요"); return; }
          markDataChanged();
          toast(on ? "안내창을 저장했어요" : "안내창을 저장하고 꺼 두었어요");
        });
    });
  }

  /* ════════════════════════ 자세히 관리 (메뉴판 — #/manage) ════════════════════════ */

  /* P3-f: 첫 화면에서 내려온 메뉴판. 기능은 그대로 — 라이브 화면 툴바 "자세히 관리"로 들어온다.
   *
   * 카드를 9장 나란히 세우면 원장에게는 "고를 것이 아홉 개"로 보인다(원장 지시: 옵션 나열 금지).
   * 그렇다고 겹쳐 보이는 카드를 지우면 그 화면에만 있는 기능이 사라진다 —
   * 실측(2026-07-23): 모아보기에서 되는 것은 **찾기·수정·올리기/내리기**뿐이고,
   *   · 새로 쓰기 = 목록이 빌 때만 나타나는 버튼이라 지금(글 19·질문 19·후기 5)은 길이 없다
   *   · 삭제 = 모아보기에 아예 없다(글·질문·후기 모두 목록 화면에만 있음)
   *   · 질문 순서 ▲▼ = 질문 화면에만 있다
   * → 진입점을 지우는 대신 **묶는다**. 세 묶음으로 나누고, 겹쳐 보이던 카드의 설명은
   *   "여기서만 되는 것"으로 바꿔 왜 둘 다 있는지가 글자로 보이게 한다.
   */
  function viewDashboard() {
    root().innerHTML =
      backLink("#/live", "홈페이지 보며 수정으로") +
      '<h1 class="view-title">자세히 관리</h1>' +
      '<p class="view-desc">홈페이지에서 바로 고치기 어려운 것(새로 쓰기·순서·발행)은 여기서 해요.</p>' +
      dashSection("콘텐츠", "글·후기·질문·사진을 올리고 정리해요",
        dashCard("#/content", "모", "콘텐츠 모아보기", "글·후기·질문·사진을 한자리에서 찾고, 여러 개를 한 번에 올리고 내려요", true) +
        dashCard("#/posts", "글", "글 관리", "글을 새로 쓰거나 지워요") +
        dashCard("#/faqs", "질", "자주 묻는 질문", "질문을 새로 쓰고, 보이는 순서를 바꿔요") +
        dashCard("#/reviews", "후", "후기 관리", "후기 카드를 새로 쓰거나 지워요")) +
      dashSection("홈페이지 꾸미기", "어디에 무엇이 어떤 모습으로 보일지 정해요",
        dashCard("#/home", "홈", "홈 화면 관리", "홈 첫 화면 칸에 보여줄 글을 골라 담아요") +
        dashCard("#/zones", "분", "진료 분야 관리", "홈페이지에 보여줄 진료 분야를 켜고 꺼요") +
        dashCard("#/design", "색", "색·글씨", "홈페이지 전체의 색과 글씨 크기를 바꿔요")) +
      dashSection("병원 정보·알림", "손님에게 안내하는 내용이에요",
        dashCard("#/settings", "정", "병원 정보", "전화번호·진료시간·주소를 바꿔요") +
        dashCard("#/notice", "알", "휴진·공지 알림", "연휴 휴진·진료시간 변경을 안내창으로 띄워요"));
    bindNav(root());
    root().querySelectorAll(".dash-card").forEach(function (card) {
      card.addEventListener("click", function (e) {
        e.preventDefault();
        location.hash = card.getAttribute("data-nav");
      });
    });
  }

  function dashSection(title, desc, cards) {
    return '<section class="dash-section">' +
      '<h2 class="dash-section-title">' + esc(title) + "</h2>" +
      '<p class="dash-section-desc">' + esc(desc) + "</p>" +
      '<div class="dash-grid">' + cards + "</div></section>";
  }

  // lead = 그 묶음에서 먼저 눌러 볼 카드 (한 줄 전체를 차지해 눈에 먼저 들어온다)
  function dashCard(hash, icon, title, desc, lead) {
    var body = "<h2>" + esc(title) + "</h2><p>" + esc(desc) + "</p>";
    return '<a href="' + esc(hash) + '" class="dash-card' + (lead ? " dash-card-lead" : "") +
      '" data-nav="' + esc(hash) + '">' +
      '<div class="dash-icon">' + esc(icon) + "</div>" +
      (lead ? '<div class="lead-text">' + body + "</div>" : body) + "</a>";
  }

  /* ════════════════════════ 홈페이지 보며 수정 (#/live — P3-f 전폭 캔버스) ════════════════════════ */

  // 손님은 대부분 휴대폰으로 본다 → 원장이 처음 보는 화면도 휴대폰이어야 같은 것을 본다.
  var liveDevice = "mobile";    // PC/휴대폰 폭 토글 (세션 내 유지)
  var liveFreeEdit = false;     // "아무 곳이나 고치기" — 기본 꺼짐 (실수 방지, 계약 §7)
  var livePanelOpen = null;     // null = 아직 안 정함 → 넓은 화면이면 펼침

  // hash 예: #/live?page=faq.html&focus=F2 — focus 는 지점ID 형식만 허용
  function viewLive(query) {
    var params = {};
    (query || "").split("&").forEach(function (kv) {
      var i = kv.indexOf("=");
      if (i > 0) params[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    var page = livePageByKey(params.page);
    var focus = /^[A-Za-z0-9_]{1,24}$/.test(params.focus || "") ? params.focus : "";
    var src = livePageSrc(page, focus);
    // 새 창은 "손님이 보는 그대로" — 수정 표시 없이 연다 (새 창은 저장 창구가 없다)
    var plainSrc = "../" + page.file + (page.query ? "?" + page.query : "");
    if (livePanelOpen === null) livePanelOpen = window.innerWidth > 1024;

    document.body.classList.add("live-mode");
    syncHeaderHeight();

    root().innerHTML =
      '<div class="live-shell">' +
      '<div class="live-toolbar">' +
      '<select id="live-page" aria-label="보고 있는 홈페이지 화면">' + livePageOptions(page.key) + "</select>" +
      '<div class="live-device" role="group" aria-label="화면 폭">' +
      '<button type="button" id="live-pc" class="live-dev-btn' + (liveDevice === "pc" ? " active" : "") + '">PC 화면</button>' +
      '<button type="button" id="live-mobile" class="live-dev-btn' + (liveDevice === "mobile" ? " active" : "") + '">휴대폰 화면</button>' +
      "</div>" +
      '<label class="switch live-free" title="켜면 홈페이지의 아무 글자·사진이나 눌러서 고칠 수 있어요.">' +
      '<input type="checkbox" id="live-free"' + (liveFreeEdit ? " checked" : "") + ">" +
      '<span class="slider"></span><span class="switch-label">아무 곳이나 고치기</span></label>' +
      '<span class="live-status" id="live-status" role="status"></span>' +
      '<span class="live-spacer"></span>' +
      // 아직 홈페이지에 안 올라간 글·후기·질문 — 있을 때만 나타난다 (0건이면 소음이라 감춘다)
      '<button type="button" class="live-draft hidden" id="live-draft">' +
      '아직 안 올라간 것 <strong id="live-draft-n">0</strong></button>' +
      '<button type="button" class="btn-ghost btn-sm" id="live-open">새 창에서 열기</button>' +
      '<button type="button" class="btn-secondary btn-sm" id="live-manage">자세히 관리</button>' +
      '<button type="button" class="btn-secondary btn-sm" id="live-panel-btn">사진·글 모음</button>' +
      "</div>" +
      '<div class="live-body">' +
      '<div class="live-canvas">' +
      '<div id="live-wrap" class="live-frame-wrap' + (liveDevice === "mobile" ? " mobile" : "") + '">' +
      '<iframe id="live-frame" src="' + esc(src) + '" title="홈페이지 미리보기"></iframe></div>' +
      liveFailHtml() +
      "</div>" +
      libraryPanelHtml() +
      "</div></div>";
    bindNav(root());

    // 미리보기를 불러온 시각 — 이 시각 뒤에 바뀐 값 = 다른 창이 먼저 고친 것 (F-3)
    liveFrameLoadedAt = Date.now();
    var frameEl = byId("live-frame");
    if (frameEl) frameEl.addEventListener("load", function () {
      liveFrameLoadedAt = Date.now();
      checkFrameLoaded();
      syncLiveScale();
    });
    watchLiveScale();
    watchFrameLoad(plainSrc);
    refreshDraftBadge();

    byId("live-page").addEventListener("change", function () {
      location.hash = "#/live?page=" + encodeURIComponent(this.value); // 화면 전환 시 focus 해제
    });
    function setDevice(mode) {
      liveDevice = mode;
      byId("live-wrap").classList.toggle("mobile", mode === "mobile");
      byId("live-pc").classList.toggle("active", mode === "pc");
      byId("live-mobile").classList.toggle("active", mode === "mobile");
      syncLiveScale();
    }
    byId("live-pc").addEventListener("click", function () { setDevice("pc"); });
    byId("live-mobile").addEventListener("click", function () { setDevice("mobile"); });
    byId("live-open").addEventListener("click", function () {
      window.open(plainSrc, "_blank", "noopener"); // 상대경로 — 현 문서(admin/) 기준 해석
    });
    byId("live-manage").addEventListener("click", function () { location.hash = "#/manage"; });
    // 배지를 누르면 "안 올라간 것만" 걸러 놓은 모아보기로 바로 간다 (지금은 3번 눌러야 닿는다)
    byId("live-draft").addEventListener("click", function () {
      hub.q = ""; hub.type = "all"; hub.zone = ""; hub.status = "draft";
      location.hash = "#/content";
    });
    byId("live-panel-btn").addEventListener("click", function () { setPanelOpen(!livePanelOpen); });
    byId("live-free").addEventListener("change", function () {
      liveFreeEdit = this.checked;
      sendToFrame("zia-edit-mode", { freeEdit: liveFreeEdit });
      liveStatus(liveFreeEdit
        ? "이제 홈페이지의 아무 곳이나 눌러서 고칠 수 있어요"
        : "정해 둔 곳만 고칠 수 있어요");
    });

    bindLibraryPanel();
    setPanelOpen(livePanelOpen);

    // 분야(ZONE) 화면 목록은 늦게 도착할 수 있다 → 도착하면 선택 목록만 조용히 갱신
    loadZonePages().then(function () {
      var sel = byId("live-page");
      if (!sel) return;
      var keep = sel.value;
      sel.innerHTML = livePageOptions(keep);
    }).catch(function () { /* 조용히 무시 */ });
  }

  function livePageOptions(selectedKey) {
    return livePages().map(function (p) {
      return '<option value="' + esc(p.key) + '"' + (p.key === selectedKey ? " selected" : "") +
        ">" + esc(p.label) + "</option>";
    }).join("");
  }

  // 툴바 오른쪽 상태 문구 (전문용어 금지 — 원장이 읽는 말)
  var liveStatusTimer = null;
  function liveStatus(message, isError) {
    var el = byId("live-status");
    if (!el) return;
    el.textContent = message || "";
    el.className = "live-status" + (isError ? " live-status-error" : "");
    clearTimeout(liveStatusTimer);
    if (message) liveStatusTimer = setTimeout(function () {
      if (byId("live-status") === el) { el.textContent = ""; el.className = "live-status"; }
    }, 4000);
  }

  function setPanelOpen(open) {
    livePanelOpen = !!open;
    var panel = byId("live-panel");
    var btn = byId("live-panel-btn");
    if (panel) panel.classList.toggle("collapsed", !livePanelOpen);
    if (btn) btn.textContent = livePanelOpen ? "모음 접기" : "사진·글 모음";
    var shell = root().querySelector(".live-shell");
    if (shell) shell.classList.toggle("panel-open", livePanelOpen);
    // 모음을 여닫으면 미리보기 폭이 바뀐다 → 줄이는 비율을 다시 맞춘다
    // (0.15s 애니메이션이 끝난 뒤 값이 확정되므로 끝나고 한 번 더 맞춘다)
    syncLiveScale();
    setTimeout(syncLiveScale, 200);
  }

  /* ── 미리보기 폭 맞추기 (원장이 고른 "PC 화면"을 진짜 PC 폭으로 보여 준다) ──────
   * 왜: iframe 을 관리자 창 폭에 그대로 맞추면, 홈페이지는 그 좁은 폭을 "화면 폭"으로 읽어
   *   PC 화면을 골라도 휴대폰 모양으로 그려진다(실측 591px). 그래서 홈페이지에는 PC 폭
   *   1280 을 그대로 주고, 보이는 크기만 줄여서 끼워 넣는다. 홈페이지가 읽는 폭은 늘 1280.
   * 좌표(수정 표시·그 자리 팝오버)는 전부 미리보기 안에서 계산되므로 줄여도 어긋나지 않는다.
   */
  var LIVE_LOGICAL_W = { pc: 1280, mobile: 390 };
  var liveScaleObs = null;

  function syncLiveScale() {
    var wrap = byId("live-wrap"), frame = byId("live-frame");
    if (!wrap || !frame) return;
    var logical = LIVE_LOGICAL_W[liveDevice] || LIVE_LOGICAL_W.pc;
    var cw = wrap.clientWidth, ch = wrap.clientHeight;
    if (!cw || !ch) return;
    var k = Math.min(1, cw / logical);
    if (!(k > 0)) return;
    k = Math.round(k * 10000) / 10000;
    frame.style.width = logical + "px";
    frame.style.height = Math.round(ch / k) + "px";   // 줄인 뒤 세로가 딱 맞게
    frame.style.transform = "scale(" + k + ")";
    frame.style.marginLeft = k < 1 ? "0px" : Math.round((cw - logical) / 2) + "px";
  }

  function watchLiveScale() {
    if (liveScaleObs) { try { liveScaleObs.disconnect(); } catch (err) { /* 무해 */ } liveScaleObs = null; }
    var wrap = byId("live-wrap");
    if (!wrap) return;
    syncLiveScale();
    if (window.ResizeObserver) {
      liveScaleObs = new window.ResizeObserver(function () { syncLiveScale(); });
      liveScaleObs.observe(wrap);
    }
  }
  // ResizeObserver 가 없는 구형 브라우저 대비 (있어도 무해 — 같은 값이면 그대로)
  window.addEventListener("resize", function () { syncLiveScale(); });

  /* ── 미리보기를 못 불러왔을 때 (영문 오류 화면 대신 한국어 안내) ────────────────
   * 왜: 미리보기 자리에 브라우저 오류(Error code: 404 …)가 그대로 뜨면 원장은
   *   관리 화면 전체가 고장 난 줄 안다. 실제로는 관리 기능은 멀쩡하다.
   * 어떻게 알아채나: (1) 다 불러온 뒤 미리보기 안에 우리 홈페이지 표시가 있는지 확인,
   *   (2) 그래도 모르면 정해진 시간 안에 "준비됐어요" 신호가 오는지로 판정.
   */
  var LIVE_LOAD_TIMEOUT_MS = 15000;
  var liveLoadTimer = null;
  var liveFrameOk = false;
  var livePlainSrc = "";

  function liveFailHtml() {
    return '<div class="live-fail hidden" id="live-fail" role="alert">' +
      "<h2>홈페이지 미리보기를 불러오지 못했어요</h2>" +
      "<p>인터넷 연결이 잠시 끊겼거나, 홈페이지가 잠깐 응답하지 않는 상태예요.</p>" +
      "<p>관리 기능은 그대로 쓸 수 있어요. 위쪽 [자세히 관리]로 계속하셔도 됩니다.</p>" +
      '<div class="live-fail-btns">' +
      '<button type="button" class="btn-primary" id="live-retry">다시 불러오기</button>' +
      '<button type="button" class="btn-secondary" id="live-fail-open">새 창에서 열기</button>' +
      "</div></div>";
  }

  function watchFrameLoad(plainSrc) {
    livePlainSrc = plainSrc || livePlainSrc;
    liveFrameOk = false;
    clearTimeout(liveLoadTimer);
    liveLoadTimer = setTimeout(function () { if (!liveFrameOk) showLiveFail(); }, LIVE_LOAD_TIMEOUT_MS);
    var retry = byId("live-retry");
    if (retry) retry.addEventListener("click", reloadLiveFrame);
    var open = byId("live-fail-open");
    if (open) open.addEventListener("click", function () {
      if (livePlainSrc) window.open(livePlainSrc, "_blank", "noopener");
    });
  }

  // 다 불러온 뒤 판정 — 우리 홈페이지면 표시(수정 도우미 스크립트)가 들어 있다.
  function checkFrameLoaded() {
    var frame = liveFrame();
    if (!frame) return;
    var doc = null;
    try { doc = frame.contentDocument; } catch (err) { doc = null; }
    if (!doc) return;                       // 들여다볼 수 없으면 신호(준비됐어요)를 기다린다
    var here = doc.location && doc.location.href;
    if (!here || here === "about:blank") return;   // 다시 불러오는 중의 빈 화면 — 아직 판정하지 않는다
    if (doc.querySelector('script[src*="edit-overlay"]')) { markFrameOk(); return; }
    showLiveFail();                          // 우리 홈페이지가 아니다 = 주소를 못 찾은 화면
  }

  function markFrameOk() {
    liveFrameOk = true;
    clearTimeout(liveLoadTimer);
    var fail = byId("live-fail"), wrap = byId("live-wrap");
    if (fail) fail.classList.add("hidden");
    if (wrap) wrap.classList.remove("hidden");
    syncLiveScale();
  }

  function showLiveFail() {
    var fail = byId("live-fail"), wrap = byId("live-wrap");
    if (!fail || !wrap) return;
    clearTimeout(liveLoadTimer);
    wrap.classList.add("hidden");
    fail.classList.remove("hidden");
  }

  function reloadLiveFrame() {
    var frame = liveFrame(), fail = byId("live-fail"), wrap = byId("live-wrap");
    if (!frame) { render(); return; }
    if (fail) fail.classList.add("hidden");
    if (wrap) wrap.classList.remove("hidden");
    liveFrameOk = false;
    clearTimeout(liveLoadTimer);
    liveLoadTimer = setTimeout(function () { if (!liveFrameOk) showLiveFail(); }, LIVE_LOAD_TIMEOUT_MS);
    var keep = frame.getAttribute("src");
    frame.setAttribute("src", "about:blank");
    setTimeout(function () { frame.setAttribute("src", keep); syncLiveScale(); }, 30);
  }

  /* ── 아직 홈페이지에 안 올라간 것 알림 (콘텐츠 모아보기의 "아직 안 올라감"과 같은 셈법) ── */
  function refreshDraftBadge() {
    var btn = byId("live-draft");
    if (!btn || !sb) return;
    function countDraft(table) {
      return sb.from(table).select("id", { count: "exact", head: true }).eq("published", false)
        .then(function (res) { return res && !res.error && typeof res.count === "number" ? res.count : 0; })
        .catch(function () { return 0; });
    }
    Promise.all([countDraft("posts"), countDraft("reviews"), countDraft("faqs")]).then(function (r) {
      var n = r[0] + r[1] + r[2];
      var el = byId("live-draft"), num = byId("live-draft-n");
      if (!el || !num) return;
      num.textContent = String(n);
      el.classList.toggle("hidden", n === 0);
    }).catch(function () { /* 조용히 — 이 알림은 없어도 관리에는 지장이 없다 */ });
  }

  /* ── 미리보기가 보내는 신호 (계약 v2 §6 자식→부모) ── */

  function onEditReady() {
    markFrameOk();   // 미리보기가 살아 있다는 가장 확실한 신호
    sendToFrame("zia-edit-mode", { freeEdit: liveFreeEdit });
    if (liveNeedsRefresh) {
      liveNeedsRefresh = false;
      sendToFrame("zia-edit-refresh", {});
    }
  }

  /* ════════════════════════ 사진·글·후기 모음 패널 (P3-f) ════════════════════════ */

  var LIB_TABS = [
    { key: "photo",  label: "사진" },
    { key: "post",   label: "글" },
    { key: "review", label: "후기" }
  ];
  var libTab = "photo";
  var libCache = { photo: null, post: null, review: null };  // null = 아직 안 불러옴
  var libPick = null;      // 미리보기가 요청한 고르기 { reqId, accept, slot }
  var libPlacing = null;   // 상시 모드에서 고른 항목 (어디에 넣을지 기다리는 중)

  function libraryPanelHtml() {
    return '<aside class="live-panel' + (livePanelOpen ? "" : " collapsed") + '" id="live-panel" aria-label="사진·글·후기 모음">' +
      '<div class="live-panel-head">' +
      '<strong>사진 · 글 · 후기 모음</strong>' +
      '<button type="button" class="btn-ghost btn-sm live-panel-close" id="live-panel-close" aria-label="모음 닫기">닫기</button>' +
      "</div>" +
      '<div class="lib-note hidden" id="lib-note"></div>' +
      '<div class="lib-tabs" role="group" aria-label="모음 종류">' +
      LIB_TABS.map(function (t) {
        return '<button type="button" class="lib-tab' + (t.key === libTab ? " active" : "") +
          '" data-tab="' + t.key + '">' + esc(t.label) + "</button>";
      }).join("") + "</div>" +
      '<div class="lib-body" id="lib-body"></div>' +
      "</aside>";
  }

  function bindLibraryPanel() {
    var panel = byId("live-panel");
    if (!panel) return;
    byId("live-panel-close").addEventListener("click", function () {
      if (libPick) cancelPick();
      setPanelOpen(false);
    });
    panel.querySelectorAll(".lib-tab").forEach(function (btn) {
      btn.addEventListener("click", function () { setLibTab(btn.getAttribute("data-tab")); });
    });
    drawLibNote();
    drawLibBody();
  }

  function setLibTab(tab) {
    libTab = tab;
    var panel = byId("live-panel");
    if (panel) panel.querySelectorAll(".lib-tab").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === tab);
    });
    drawLibBody();
  }

  // 패널 위쪽 안내 줄 (고르기 요청 중 / 넣을 자리 기다리는 중)
  function drawLibNote() {
    var el = byId("lib-note");
    if (!el) return;
    if (libPick) {
      el.className = "lib-note lib-note-pick";
      el.innerHTML = '<span>' + esc(libPick.slotLabel || "넣을 것을 골라 주세요") + "</span>" +
        '<button type="button" class="btn-ghost btn-sm" id="lib-cancel">그만두기</button>';
      byId("lib-cancel").addEventListener("click", cancelPick);
    } else if (libPlacing) {
      el.className = "lib-note lib-note-place";
      el.innerHTML = '<span>어디에 넣을까요? 홈페이지에서 넣고 싶은 자리를 눌러 주세요.</span>' +
        '<button type="button" class="btn-ghost btn-sm" id="lib-cancel">그만두기</button>';
      byId("lib-cancel").addEventListener("click", cancelPlacing);
    } else {
      el.className = "lib-note hidden";
      el.innerHTML = "";
    }
  }

  function drawLibBody() {
    var box = byId("lib-body");
    if (!box) return;
    var cached = libCache[libTab];
    if (cached) { renderLibItems(box, cached); return; }
    box.innerHTML = '<p class="lib-empty">불러오는 중이에요…</p>';
    loadLibTab(libTab).then(function (items) {
      libCache[libTab] = items;
      if (libTab && byId("lib-body") === box) renderLibItems(box, items);
    }).catch(function (err) {
      console.error("[admin] 모음 불러오기 실패:", err);
      box.innerHTML = '<p class="lib-empty">목록을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</p>';
    });
  }

  function loadLibTab(tab) {
    if (tab === "photo") return loadPhotoLibrary();
    if (tab === "post") {
      return Promise.all([
        loadZones(),
        sb.from("posts").select("id, title, zone_id, thumbnail_path, published, home_slot, badge")
          .order("sort_order").order("id").then(function (res) {
            if (res.error) throw res.error;
            return res.data || [];
          })
      ]).then(function (r) { return r[1]; });
    }
    return sb.from("reviews").select("id, title, body, labels, thumbnail_path, published, is_highlight")
      .order("sort_order").order("id").then(function (res) {
        if (res.error) throw res.error;
        return res.data || [];
      });
  }

  /* ── 사진 모음 ── */

  var STORAGE_FOLDER_LABEL = { posts: "글 사진", zones: "분야 사진", reviews: "후기 사진", home: "홈 사진" };

  // zia-media 보관함 목록 (폴더 재귀 — 실제 폴더는 posts/zones/reviews 수준이라 2단이면 충분)
  function listStorageImages(prefix, depth) {
    return sb.storage.from("zia-media").list(prefix || "", { limit: 200, sortBy: { column: "created_at", order: "desc" } })
      .then(function (res) {
        if (res.error) throw res.error;
        var files = [];
        var jobs = [];
        (res.data || []).forEach(function (o) {
          if (!o || !o.name || o.name === ".emptyFolderPlaceholder") return;
          var full = prefix ? prefix + "/" + o.name : o.name;
          var isFolder = !o.id && !o.metadata;
          if (isFolder) {
            if (depth > 0) jobs.push(listStorageImages(full, depth - 1).catch(function () { return []; }));
          } else if (/\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(o.name)) {
            // 원본 파일 이름을 살려 라벨 맨 앞에 둔다 — 여러 장을 올려도 서로 구분되게 (F-8)
            var orig = originalName(full);
            files.push({
              type: "photo", path: full,
              label: (orig ? orig + " · " : "") + (STORAGE_FOLDER_LABEL[prefix] || "올린 사진") +
                (o.created_at ? " · " + shortDate(o.created_at) : ""),
              at: o.created_at || ""
            });
          }
        });
        return Promise.all(jobs).then(function (subs) {
          subs.forEach(function (s) { files = files.concat(s); });
          return files;
        });
      });
  }

  function shortDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.getFullYear() + "." + ("0" + (d.getMonth() + 1)).slice(-2) + "." + ("0" + d.getDate()).slice(-2);
  }

  function loadPhotoLibrary() {
    var stock = (window.ZIA_STOCK_IMAGES || []).map(function (s) {
      return { type: "photo", path: s.path, label: s.label, group: s.group, stock: true };
    });
    return listStorageImages("", 2)
      .catch(function (err) {
        console.warn("[admin] 올린 사진 목록을 불러오지 못했어요:", err);
        return null; // null = 보관함 조회 실패 (안내만 하고 기본 사진은 계속 보여준다)
      })
      .then(function (uploaded) {
        return { uploaded: uploaded, stock: stock };
      });
  }

  /* ── 카드 렌더 ── */

  // 홈 칸 고르기 중일 때만 보이는 "이 칸 비우기" (글 번호 0 = 비우기 약속)
  function clearCardHtml() {
    return '<button type="button" class="lib-card" data-type="post" data-key="__clear" title="이 칸 비우기">' +
      '<span class="lib-thumb lib-thumb-empty">비우기</span>' +
      '<span class="lib-label">이 칸 비우기</span>' +
      '<span class="lib-meta"><span class="pill">홈에서 빼요</span></span></button>';
  }

  function renderLibItems(box, items) {
    if (libTab === "photo") { renderPhotoTab(box, items); return; }
    var clearCard = (libTab === "post" && libPick && libPick.canClear) ? clearCardHtml() : "";
    if (!items || !items.length) {
      box.innerHTML = (clearCard ? '<div class="lib-grid">' + clearCard + "</div>" : "") +
        '<p class="lib-empty">' +
        (libTab === "post" ? "아직 글이 없어요. \"자세히 관리 → 글 관리\"에서 먼저 써 주세요."
                           : "아직 후기 카드가 없어요. \"자세히 관리 → 후기 관리\"에서 먼저 써 주세요.") + "</p>";
      if (clearCard) bindLibCards(box, []);
      return;
    }
    var html = '<div class="lib-grid">' + clearCard +
      items.map(libTab === "post" ? postCardHtml : reviewCardHtml).join("") + "</div>";
    box.innerHTML = html;
    bindLibCards(box, items);
  }

  function renderPhotoTab(box, data) {
    var uploaded = data && data.uploaded;
    var stock = (data && data.stock) || [];
    var html = '<div class="lib-drop" id="lib-drop"><span class="lib-drop-hint">사진을 여기에 끌어다 놓거나, 눌러서 골라 올리세요</span></div>' +
      '<input type="file" id="lib-drop-file" accept="image/*" multiple class="hidden">';

    html += '<h3 class="lib-sec">올린 사진</h3>';
    if (uploaded === null) {
      html += '<p class="lib-empty">올린 사진 목록을 지금은 볼 수 없어요. 아래 "홈페이지 기본 사진"은 그대로 쓸 수 있어요.</p>';
    } else if (!uploaded.length) {
      html += '<p class="lib-empty">아직 올린 사진이 없어요. 위쪽에 사진을 끌어다 놓아 보세요.</p>';
    } else {
      html += '<div class="lib-grid">' + uploaded.map(photoCardHtml).join("") + "</div>";
    }

    html += '<h3 class="lib-sec">홈페이지 기본 사진</h3>';
    var groups = [];
    stock.forEach(function (s) { if (groups.indexOf(s.group) === -1) groups.push(s.group); });
    groups.forEach(function (g) {
      html += '<div class="lib-subsec">' + esc(g) + "</div>" +
        '<div class="lib-grid">' + stock.filter(function (s) { return s.group === g; }).map(photoCardHtml).join("") + "</div>";
    });

    box.innerHTML = html;
    bindLibCards(box, (uploaded || []).concat(stock));

    // 드래그 업로드 (기존 공용 배선 재사용)
    var drop = byId("lib-drop");
    var input = byId("lib-drop-file");
    if (drop && input) {
      bindDropUpload(drop, input, function (files) {
        var hint = drop.querySelector(".lib-drop-hint");
        var pcts = files.map(function () { return 0; });
        var done = 0;
        drop.classList.add("uploading");
        if (!drop.querySelector(".up-bar")) drop.insertAdjacentHTML("beforeend", progressBarHtml(0));
        function paint() {
          var sum = pcts.reduce(function (a, b) { return a + b; }, 0);
          var avg = Math.round(sum / (pcts.length || 1));
          if (hint) {
            hint.textContent = files.length > 1
              ? "사진 올리는 중… " + files.length + "장 중 " + Math.min(done + 1, files.length) + "장째 · " + avg + "%"
              : uploadingText(avg);
          }
          var fill = drop.querySelector(".up-bar-fill");
          if (fill) fill.style.width = avg + "%";
        }
        function restHint() {
          drop.classList.remove("uploading");
          var bar = drop.querySelector(".up-bar");
          if (bar) bar.parentNode.removeChild(bar);
          if (hint) hint.textContent = "사진을 여기에 끌어다 놓거나, 눌러서 골라 올리세요";
        }
        paint();
        Promise.all(files.map(function (f, i) {
          return uploadImage(f, "home", {
            name: f.name,
            onProgress: function (p) { pcts[i] = p; paint(); }
          }).then(function (up) { done++; paint(); return up; });
        }))
          .then(function () {
            libCache.photo = null;   // 다시 불러오기
            toast(files.length > 1 ? "사진 " + files.length + "장을 올렸어요" : "사진을 올렸어요");
            restHint();
            if (libTab === "photo") drawLibBody();
          })
          .catch(function (err) {
            console.error("[admin] upload error:", err);
            toast(uploadErrorMessage(err), "error");
            restHint();
            libCache.photo = null;   // 일부만 올라갔을 수 있다 → 목록을 다시 불러와 사실대로 보여 준다
            if (libTab === "photo") drawLibBody();
          });
      });
    }
  }

  function photoCardHtml(item) {
    return '<button type="button" class="lib-card lib-card-photo" draggable="true"' +
      ' data-type="photo" data-key="' + esc(item.path) + '" title="' + esc(item.label) + '">' +
      '<img class="lib-thumb" src="' + esc(adminImageUrl(item.path)) + '" alt="" loading="lazy">' +
      '<span class="lib-label">' + esc(item.label) + "</span></button>";
  }

  function postCardHtml(p) {
    return '<button type="button" class="lib-card" draggable="true"' +
      ' data-type="post" data-key="' + p.id + '" title="' + esc(p.title || "") + '">' +
      (p.thumbnail_path
        ? '<img class="lib-thumb" src="' + esc(adminImageUrl(p.thumbnail_path)) + '" alt="" loading="lazy">'
        : '<span class="lib-thumb lib-thumb-empty">사진 없음</span>') +
      '<span class="lib-label">' + esc(p.title || "(제목 없음)") + "</span>" +
      '<span class="lib-meta">' +
      '<span class="pill ' + (p.published ? "pill-live" : "pill-draft") + '">' + (p.published ? "발행 중" : "임시저장") + "</span>" +
      (zoneName(p.zone_id) ? "<span>" + esc(zoneName(p.zone_id)) + "</span>" : "") +
      "</span></button>";
  }

  function reviewCardHtml(r) {
    var text = r.title || r.body || "";
    if (text.length > 34) text = text.slice(0, 34) + "…";
    return '<button type="button" class="lib-card" draggable="true"' +
      ' data-type="review" data-key="' + r.id + '" title="' + esc(r.title || r.body || "") + '">' +
      (r.thumbnail_path
        ? '<img class="lib-thumb" src="' + esc(adminImageUrl(r.thumbnail_path)) + '" alt="" loading="lazy">'
        : '<span class="lib-thumb lib-thumb-empty">사진 없음</span>') +
      '<span class="lib-label">' + esc(text) + "</span>" +
      '<span class="lib-meta">' +
      '<span class="pill ' + (r.published ? "pill-live" : "pill-draft") + '">' + (r.published ? "발행 중" : "임시저장") + "</span>" +
      (r.is_highlight ? '<span class="pill pill-star">홈 강조</span>' : "") +
      "</span></button>";
  }

  function bindLibCards(box, items) {
    box.querySelectorAll(".lib-card").forEach(function (card) {
      var type = card.getAttribute("data-type");
      var key = card.getAttribute("data-key");
      var item = findLibItem(type, key, items);
      card.addEventListener("click", function () { onLibItemChosen(type, item, card); });
      card.addEventListener("dragstart", function (e) {
        if (!e.dataTransfer) return;
        var payload = JSON.stringify({ type: type, item: item });
        try {
          e.dataTransfer.setData("application/x-zia-item", payload);
          e.dataTransfer.setData("text/plain", payload);
        } catch (err) { /* 일부 브라우저는 커스텀 타입 미지원 — text/plain 로 충분 */ }
        e.dataTransfer.effectAllowed = "copy";
        // 미리보기 쪽이 받을 자리를 표시할 수 있게 알려 준다 (모르는 신호는 무시되므로 무해)
        sendToFrame("zia-edit-place", { accept: type, item: item });
      });
      card.addEventListener("dragend", function () { sendToFrame("zia-edit-place-cancel", {}); });
    });
  }

  function findLibItem(type, key, items) {
    if (key === "__clear") return { id: 0, clear: true };   // "이 칸 비우기" 카드
    if (type === "photo") {
      var f = (items || []).find(function (x) { return x && x.path === key; });
      return f || { type: "photo", path: key, label: "" };
    }
    var id = Number(key);
    var row = (items || []).find(function (x) { return x && x.id === id; });
    return row || { id: id };
  }

  function onLibItemChosen(type, item, cardEl) {
    if (libPick) {
      if (libPick.accept && libPick.accept !== type) {
        toast(libPick.accept === "photo" ? "여기에는 사진을 넣을 수 있어요"
          : libPick.accept === "post" ? "여기에는 글을 넣을 수 있어요" : "여기에는 후기를 넣을 수 있어요", "error");
        return;
      }
      var reqId = libPick.reqId;
      libPick = null;
      drawLibNote();
      highlightLibCard(null);
      sendToFrame("zia-edit-picked", { reqId: reqId, ok: true, item: item });
      liveStatus("골랐어요");
      return;
    }
    // 상시 모드 — "어디에 넣을까요?" 안내 상태 (드래그로도 넣을 수 있다)
    libPlacing = { type: type, item: item };
    highlightLibCard(cardEl);
    drawLibNote();
    sendToFrame("zia-edit-place", { accept: type, item: item });
  }

  function highlightLibCard(cardEl) {
    var box = byId("lib-body");
    if (box) box.querySelectorAll(".lib-card.chosen").forEach(function (c) { c.classList.remove("chosen"); });
    if (cardEl) cardEl.classList.add("chosen");
  }

  function cancelPick() {
    if (!libPick) return;
    var reqId = libPick.reqId;
    libPick = null;
    drawLibNote();
    highlightLibCard(null);
    sendToFrame("zia-edit-picked", { reqId: reqId, ok: false, message: "고르기를 그만뒀어요." });
  }

  function cancelPlacing() {
    libPlacing = null;
    drawLibNote();
    highlightLibCard(null);
    sendToFrame("zia-edit-place-cancel", {});
  }

  // 미리보기가 "여기에 넣을 것을 골라 주세요"라고 요청 (계약 v2 §6 zia-edit-pick)
  var PICK_SLOT_LABEL = { photo: "넣을 사진을 골라 주세요", post: "넣을 글을 골라 주세요", review: "넣을 후기를 골라 주세요" };

  function onEditPick(d) {
    // 미리보기에 사진을 바로 끌어다 놓은 경우 — 모음을 열 필요 없이 부모가 올리고 회신한다
    if (d.upload && d.upload.dataUrl) { uploadForPick(d); return; }
    var accept = ["photo", "post", "review"].indexOf(d.accept) !== -1 ? d.accept : "photo";
    // 미리보기가 알려준 자리 이름은 내부 이름일 수 있다 → 지도의 한국어 라벨로 바꿔 보여 준다
    var def = typeof d.slot === "string" ? fieldDef(d.slot) : null;
    var where = (def && def.label) || (typeof d.slot === "string" && d.slot.indexOf(".") === -1 ? d.slot : "");
    libPlacing = null;
    libPick = {
      reqId: d.reqId,
      accept: accept,
      // 홈 칸(L2)일 때는 "이 칸 비우기"도 고를 수 있게 한다 (칸 픽커의 "홈에서 빼기"와 같은 동작)
      canClear: !!(def && def.kind === "slot"),
      slotLabel: (where ? where + " — " : "") + PICK_SLOT_LABEL[accept]
    };
    setPanelOpen(true);
    setLibTab(accept);
    drawLibNote();
    var panel = byId("live-panel");
    if (panel) {
      panel.classList.add("pick-on");
      setTimeout(function () { panel.classList.remove("pick-on"); }, 1200);
    }
  }

  // 미리보기에서 끌어다 놓은 사진 → 보관함에 올린 뒤 고른 결과로 회신
  function uploadForPick(d) {
    var up = d.upload || {};
    function fail(message) {
      liveStatus("사진을 올리지 못했어요", true);
      sendToFrame("zia-edit-picked", { reqId: d.reqId, ok: false, message: message });
    }
    if (up.size && up.size > MAX_UPLOAD_BYTES) { fail(tooBigMessage(up.name)); return; }
    liveStatus("사진 올리는 중…");
    dataUrlToBlob(up.dataUrl)
      .then(function (blob) {
        return uploadImage(blob, "home", {
          name: up.name,
          onProgress: function (p) { liveStatus(uploadingText(p)); }   // 큰 사진도 진행 상황이 계속 보이게 (F-6)
        });
      })
      .then(function (res) {
        libCache.photo = null;               // 모음 다시 불러오기
        if (libTab === "photo" && byId("lib-body")) drawLibBody();
        liveStatus("사진을 올렸어요");
        sendToFrame("zia-edit-picked", {
          reqId: d.reqId, ok: true,
          item: { type: "photo", path: res.path, url: res.url, label: up.name || "올린 사진" }
        });
      })
      .catch(function (err) {
        console.error("[admin] 사진 올리기 실패:", err);
        fail(err && err.ziaMessage ? err.ziaMessage : uploadErrorMessage(err));
      });
  }

  /* ════════════════════════ 그 자리에서 저장 (계약 v2 §6 — 부모가 유일한 쓰기 주체) ════════════════════════ */

  // 행 단위로 고칠 수 있는 표 (그 밖의 이름은 받지 않는다)
  var EDITABLE_ROW_TABLES = { posts: true, reviews: true, faqs: true, zones: true };

  // 미리보기가 노출한 필드 지도 (cms-inject.js 의 window.ZIA_FIELD_MAP — 같은 오리진이라 읽을 수 있다)
  function frameFieldMap() {
    var f = liveFrame();
    try { return (f && f.contentWindow && f.contentWindow.ZIA_FIELD_MAP) || null; } catch (err) { return null; }
  }

  function chkRes(res) { if (res && res.error) throw res.error; return res; }

  // 미리보기가 알려준 자리 이름 → 지도 엔트리
  function fieldDef(fieldId) {
    var map = frameFieldMap();
    return (map && fieldId && map[fieldId]) || null;
  }
  // 원장에게 그대로 보여 줄 안내가 있는 실패 (아래 editSaveErrorMessage 가 우선 사용)
  function ziaError(message) {
    var e = new Error("zia-blocked");
    e.ziaMessage = message;
    return e;
  }

  /* ── 저장 요청 처리 (F-1·F-2·F-3·F-4·F-7·G-1·G-5) ──
   * 흐름: 못 쓸 값 거르기 → 지금 값 확인(남이 먼저 고쳤나) → 저장 →
   *       (응답을 못 받으면) 되읽어 실제 상태 확인 → **한 번만** 사실대로 회신.
   */
  function onEditSave(d) {
    var reqId = d.reqId;
    var kind = ["text", "html", "image"].indexOf(d.kind) !== -1 ? d.kind : "text";
    var value = String(d.value == null ? "" : d.value);
    var target = d.target || {};
    var plan = buildSavePlan(target, kind, value);

    if (!plan) {
      replySaved(reqId, false, "이 부분은 아직 여기서 바로 고칠 수 없어요. 위쪽 \"자세히 관리\"에서 바꿔 주세요.");
      return;
    }
    if (plan.guard) {   // 비울 수 없는 자리·글자 수 초과 — 쓰기 전에 사실대로 막는다 (F-2·F-7)
      replySaved(reqId, false, plan.guard);
      return;
    }

    liveStatus("저장 중…");
    performSave(plan, value, {}).then(function (r) {
      replySaved(reqId, r.ok, r.message, value, r.unknown);
      if (r.authExpired) noteAuthExpired({ target: target, kind: kind, value: value });
      else if (r.conflict) askOverwrite(plan, value, r.conflict);
      else if (r.unknown) watchUnknownSave(plan, value);
      else if (r.ok && r.followUp) r.followUp();
    });
  }

  // 회신 창구 단일화 — 툴바 문구와 미리보기 회신이 **같은 결론**에서 나오게 (F-1 핵심).
  // 결론이 "모른다"면 툴바도 실패라 단정하지 않는다.
  function replySaved(reqId, ok, message, value, unknown) {
    liveStatus(ok ? message : (unknown ? "저장됐는지 확인 중이에요" : "저장하지 못했어요"), !ok);
    if (!ok) toast(message, "error");
    var msg = { reqId: reqId, ok: !!ok, message: message };
    if (ok) msg.value = value;
    if (unknown) msg.unknown = true;   // 미리보기도 "실패"가 아니라 "확인 중"으로 안내하게
    sendToFrame("zia-edit-saved", msg);
  }

  /* ── 저장 계획서 ── 저장 대상 1건을 "쓰기 · 지금 값 읽기 · 되읽어 확인"으로 다룬다. */
  function buildSavePlan(target, kind, value) {
    if (target && target.fieldId) {
      var def = fieldDef(target.fieldId);
      var src = def && def.source;
      if (!src || !src.table) return null;
      if (def.kind === "slot") return slotPlan(def, target, value);       // L2 홈 칸 배치
      if (src.table === "site_settings") return settingsPlan(def, src, kind, value);
      if (EDITABLE_ROW_TABLES[src.table] && src.column && /^[a-z_]+$/.test(src.column)) {
        return rowPlan(def, src, target, kind, value);
      }
      return null;
    }
    if (target && target.override) return overridePlan(target.override, kind, value);
    return null;
  }

  function snapshotOf(row, col) {
    return {
      value: row ? String(row[col] == null ? "" : row[col]) : "",
      updatedAt: row ? row.updated_at : null,
      missing: !row
    };
  }

  // L1 — 병원 정보(키·값 표)
  function settingsPlan(def, src, kind, value) {
    if (!src.key) return null;
    var isLink = def && def.kind === "link";
    function current(ctrl) {
      return withAbort(sb.from("site_settings").select("value, updated_at").eq("key", src.key).limit(1), ctrl)
        .then(chkRes).then(function (res) { return snapshotOf((res.data || [])[0], "value"); });
    }
    return {
      key: "settings:" + src.key,
      settingKey: src.key,
      guard: valueGuard(value, kind, isLink ? "link" : "settings"),
      write: function (ctrl) {
        return withAbort(settingsUpsert({ key: src.key, value: value }), ctrl)
          .then(chkRes).then(function () { return { message: SAVED_LIVE_MSG }; });
      },
      current: current,
      verify: function (ctrl) {
        return current(ctrl).then(function (cur) {
          return (!cur.missing && cur.value === String(value)) ? "saved" : "not-saved";
        });
      }
    };
  }

  // L1 — 행 기반 표(글·후기·질문·분야)
  function rowPlan(def, src, target, kind, value) {
    var rowId = target.rowId != null ? target.rowId : (target.row && target.row.id);
    if (rowId == null || isNaN(Number(rowId))) return null;
    rowId = Number(rowId);
    function current(ctrl) {
      return withAbort(sb.from(src.table).select(src.column + ", updated_at").eq("id", rowId).limit(1), ctrl)
        .then(chkRes).then(function (res) { return snapshotOf((res.data || [])[0], src.column); });
    }
    return {
      key: src.table + ":" + rowId + ":" + src.column,
      guard: valueGuard(value, kind, src.table === "zones" ? "zone" : "row"),
      write: function (ctrl) {
        var patch = {};
        patch[src.column] = value;
        return withAbort(sb.from(src.table).update(patch).eq("id", rowId), ctrl)
          .then(chkRes).then(function () { return { message: SAVED_LIVE_MSG }; });
      },
      current: current,
      verify: function (ctrl) {
        return current(ctrl).then(function (cur) {
          return (!cur.missing && cur.value === String(value)) ? "saved" : "not-saved";
        });
      }
    };
  }

  // L3 — 자유 편집 자리 (page_overrides)
  function overridePlan(ov, kind, value) {
    if (!ov || !ov.page || !ov.selector) return null;
    var page = String(ov.page), selector = String(ov.selector);
    function current(ctrl) {
      return withAbort(sb.from("page_overrides").select("value, updated_at").eq("page", page).eq("selector", selector).limit(1), ctrl)
        .then(chkRes).then(function (res) { return snapshotOf((res.data || [])[0], "value"); });
    }
    return {
      key: "override:" + page + "|" + selector,
      // 자유 편집 자리는 비우면 실제로 그 자리가 비워진다(안내와 결과가 어긋나지 않음) → 빈 값 허용
      guard: valueGuard(value, kind, "override"),
      write: function (ctrl) {
        return withAbort(sb.from("page_overrides").upsert({
          page: page, selector: selector, kind: kind, value: value, anchor_hash: ov.anchorHash || null
        }, { onConflict: "page,selector" }), ctrl)
          .then(chkRes).then(function () { return { message: SAVED_LIVE_MSG }; });
      },
      current: current,
      verify: function (ctrl) {
        return current(ctrl).then(function (cur) {
          return (!cur.missing && cur.value === String(value)) ? "saved" : "not-saved";
        });
      }
    };
  }

  // L2 — 홈 첫 화면 칸 배치 (쓰기는 아래 saveSlotTarget 이 정본)
  function slotPlan(def, target, value) {
    var src = (def && def.source) || {};
    var slotNo = Number(src.slot);
    var zoneId = Number(target.rowId != null ? target.rowId : (target.row && target.row.id));
    var postId = Number(value);
    if (!(slotNo >= 1 && slotNo <= HOME_SLOT_COUNT)) return null;
    if (!zoneId || isNaN(postId) || postId < 0) return null;
    return {
      key: "slot:" + zoneId + ":" + slotNo,
      guard: null,
      write: function (ctrl) { return saveSlotTarget(def, target, value, ctrl); },
      current: null,   // 칸 배치는 "값 대조" 대상이 아니다 (아래 verify 로 결과만 확인한다)
      verify: function (ctrl) {
        return withAbort(sb.from("posts").select("id").eq("zone_id", zoneId).eq("home_slot", slotNo).limit(1), ctrl)
          .then(chkRes).then(function (res) {
            var occ = (res.data || [])[0] || null;
            if (!postId) return occ ? "not-saved" : "saved";
            return (occ && Number(occ.id) === postId) ? "saved" : "not-saved";
          });
      }
    };
  }

  /* ── 값 검사 (F-2 빈 값 · F-7 글자 수) ──
   * 빈 값: 주입 코드는 **빈 값을 무시하고 정적 문구를 그대로 둔다**(사이트 안전을 위한 의도된 설계).
   *   그래서 병원 정보·분야 값은 비워 저장해 봐야 홈페이지에는 원래 문구가 그대로 보인다
   *   → 관리 화면과 홈페이지가 영영 어긋난다. 그래서 **비우기를 막고 사실대로 알린다**.
   *   자유 편집(L3) 자리만은 빈 값이 실제로 반영되므로 그대로 저장한다.
   */
  var VALUE_MAX = { text: 1000, link: 500, html: 20000, image: 500 };
  function valueGuard(value, kind, scope) {
    var v = String(value == null ? "" : value);
    var max = VALUE_MAX[scope === "link" ? "link" : kind] || VALUE_MAX.text;
    if (v.length > max) {
      return "글자가 너무 많아요 (" + fmtCount(v.length) + "자). 이 자리는 " + fmtCount(max) +
        "자까지 넣을 수 있어요. 긴 글은 위쪽 \"자세히 관리\"에서 써 주세요.";
    }
    var body = kind === "html" ? v.replace(/<[^>]*>/g, "") : v;
    if (body.trim() !== "") return null;
    if (kind === "image") return "사진은 비울 수 없어요. 다른 사진으로 바꾸거나 그대로 두세요.";
    if (scope === "link") return "링크 주소는 비울 수 없어요. 비워도 홈페이지에서는 원래 주소가 그대로 쓰여요. 주소를 적어 주세요.";
    if (scope === "settings" || scope === "zone") {
      return "이 내용은 비울 수 없어요. 비워도 홈페이지에는 원래 문구가 그대로 다시 보이거든요. 바꿀 내용을 적어 주세요.";
    }
    if (scope === "row") return "내용을 비운 채로는 저장할 수 없어요. 이 항목을 아예 없애려면 위쪽 \"자세히 관리\"에서 지워 주세요.";
    return null;   // 자유 편집 자리 — 비우면 홈페이지에서도 실제로 비워진다
  }

  /* ── 저장 실행 (F-1) ── 시간 안에 결론 내고, 결론은 실제 상태와 일치시킨다. */
  var editBaseline = {};       // 저장 대상 → 이 창이 마지막으로 저장한 값 (덮어쓰기 감지용)
  var liveFrameLoadedAt = 0;   // 미리보기를 불러온 시각

  function performSave(plan, value, opts) {
    opts = opts || {};
    var until = opts.until || (Date.now() + SAVE_TOTAL_MS);
    function budget(ms) { return Math.max(800, Math.min(ms, until - Date.now())); }

    var pc = newAbort();
    var pre = (opts.force || !plan.current)
      ? Promise.resolve(null)
      : withDeadline(plan.current(pc), budget(PRECHECK_MS), pc).catch(function () { return null; });

    return pre.then(function (cur) {
      var clash = opts.force ? null : detectOverwrite(plan, cur, value);
      if (clash) {
        return { ok: false, conflict: clash, message: conflictMessage(clash) };
      }
      var wc = newAbort();
      return withDeadline(plan.write(wc), budget(WRITE_MS), wc).then(function (out) {
        editBaseline[plan.key] = String(value);
        var message = (out && out.message) || SAVED_LIVE_MSG;
        // G-1 — 표시 전화번호를 바꿨으면 "전화 걸기" 주소도 같은 번호로 맞춘다
        return syncPairedLink(plan, cur, value, budget(2500)).then(function (extra) {
          return { ok: true, message: extra && extra.message ? message + " " + extra.message : message,
            followUp: extra && extra.followUp };
        });
      }, function (err) {
        console.error("[admin] 그 자리에서 저장 실패:", err);
        return afterWriteFailure(plan, value, err, until);
      });
    });
  }

  // 저장 요청의 결과를 못 받았다 = 저장됐는지 **모르는** 상태.
  // 여기서 화면에 "실패"라고 단정하면, 서버가 뒤늦게 반영한 경우 안내가 거짓이 된다.
  // → 실제 값을 되읽어 확인하고, 확인도 못 하면 "모른다"고 정직하게 알린다.
  function afterWriteFailure(plan, value, err, until) {
    if (isAuthExpiredError(err)) return Promise.resolve({ ok: false, authExpired: true, message: AUTH_EXPIRED_MSG });
    if (!isTimeoutError(err)) return Promise.resolve({ ok: false, message: editSaveErrorMessage(err) });
    var left = until - Date.now();
    if (left < 900) {
      return Promise.resolve({ ok: false, unknown: true, message: UNKNOWN_SAVE_MSG });
    }
    var vc = newAbort();
    return withDeadline(plan.verify(vc), Math.min(VERIFY_MS, left), vc).then(function (st) {
      if (st === "saved") {
        editBaseline[plan.key] = String(value);
        return { ok: true, message: "저장했어요 · 홈페이지에 바로 반영됐어요 (인터넷이 느려 조금 늦게 반영됐어요)" };
      }
      return { ok: false, message: "저장하지 못했어요. 인터넷 연결을 확인한 뒤 다시 해 주세요." };
    }, function (verr) {
      if (isAuthExpiredError(verr)) return { ok: false, authExpired: true, message: AUTH_EXPIRED_MSG };
      return { ok: false, unknown: true, message: UNKNOWN_SAVE_MSG };
    });
  }

  var SAVED_LIVE_MSG = "저장했어요 · 홈페이지에 바로 반영됐어요";   // G-5 — 즉시 공개임을 문구에 담는다
  var UNKNOWN_SAVE_MSG = "저장됐는지 아직 확인하지 못했어요. 확인되면 바로 알려 드릴게요. (잠시 뒤 홈페이지를 새로 불러와 확인해 주세요)";

  // "모르는" 상태로 끝난 저장은 뒤에서 계속 확인해서, 결론이 나면 그때 사실대로 알린다 (F-1)
  function watchUnknownSave(plan, value) {
    var tries = 0;
    (function again() {
      tries++;
      setTimeout(function () {
        var c = newAbort();
        withDeadline(plan.verify(c), VERIFY_MS, c).then(function (st) {
          if (st === "saved") {
            editBaseline[plan.key] = String(value);
            liveStatus("아까 고친 내용은 저장돼 있었어요");
            toast("아까 고친 내용은 홈페이지에 저장돼 있었어요. 화면을 새로 불러올게요.", null, 6000);
            sendToFrame("zia-edit-refresh", {});
          } else if (st === "not-saved") {
            liveStatus("아까 고친 내용은 저장되지 않았어요", true);
            toast("아까 고친 내용은 저장되지 않았어요. 한 번 더 고쳐 주세요.", "error");
          }
        }, function () {
          if (tries < 3) again();
        });
      }, tries * 4000);
    })();
  }

  /* ── 덮어쓰기 감지 (F-3) ──
   * 두 창(예: 진료실 PC + 휴대폰)에서 같은 자리를 고치면 나중 저장이 앞선 저장을 조용히 덮는다.
   * 저장 직전에 "지금 값"을 확인해서,
   *   · 이 창이 마지막으로 저장한 값과 다르거나
   *   · 미리보기를 불러온 뒤에 바뀐 흔적이 있으면
   * 덮어쓰지 않고 먼저 알린다 (원장이 고른 뒤에만 덮는다).
   */
  function detectOverwrite(plan, cur, value) {
    if (!cur || cur.value == null) return null;      // 확인 못 했으면 검사 생략
    var curVal = String(cur.value);
    if (curVal === String(value)) return null;       // 이미 같은 내용 — 덮을 것이 없다
    var base = editBaseline[plan.key];
    if (base != null) return curVal === base ? null : { current: curVal, mine: String(value) };
    if (cur.missing) return null;                    // 아직 없던 내용 — 덮을 것이 없다
    var t = Date.parse(cur.updatedAt || "");
    if (!t || !liveFrameLoadedAt) return null;
    if (t > liveFrameLoadedAt - CONFLICT_SKEW_MS) return { current: curVal, mine: String(value) };
    return null;
  }

  function conflictMessage(clash) {
    return "다른 창(또는 다른 기기)에서 이 자리를 먼저 고쳤어요. 지금 홈페이지에 있는 내용은 “" +
      shortText(clash.current, 30) + "”예요. 덮어쓸지는 관리자 화면에서 물어볼게요.";
  }

  function askOverwrite(plan, value, clash) {
    confirmModal({
      title: "다른 창에서 먼저 고쳤어요",
      body: "지금 홈페이지에 있는 내용은 “" + shortText(clash.current, 40) + "”이고, 방금 고치신 내용은 “" +
        shortText(value, 40) + "”이에요. 내 내용으로 바꾸면 먼저 저장된 내용은 사라져요.",
      confirmLabel: "그래도 내 내용으로 바꾸기",
      cancelLabel: "그만두기"
    }).then(function (ok) {
      if (!ok) {
        liveStatus("그대로 두었어요");
        sendToFrame("zia-edit-refresh", {});   // 화면을 지금 홈페이지 내용으로 되돌린다
        return;
      }
      liveStatus("저장 중…");
      performSave(plan, value, { force: true }).then(function (r) {
        liveStatus(r.ok ? r.message : "저장하지 못했어요", !r.ok);
        toast(r.ok ? "내 내용으로 바꿨어요 · 홈페이지에 바로 반영됐어요" : r.message, r.ok ? null : "error");
        if (r.ok) sendToFrame("zia-edit-refresh", {});
        else if (r.authExpired) noteAuthExpired(null);
        else if (r.unknown) watchUnknownSave(plan, value);
      });
    });
  }

  /* ── G-1 표시값과 링크값 짝 맞추기 ──
   * 화면에 보이는 전화번호(phone)를 바꿔도 "전화 걸기" 주소(link_tel)는 그대로라
   * 방문자가 **옛 번호로 전화를 걸게 된다**. 표시 번호를 바꾸면 거는 번호도 같이 맞춘다.
   *   · 거는 주소가 옛 번호 그대로였다 → 새 번호로 함께 바꾸고 안내 문구에 알린다
   *   · 거는 주소를 따로 정해 두었다   → 임의로 건드리지 않고, 저장 뒤 물어본다
   */
  function digitsOf(s) { return String(s == null ? "" : s).replace(/[^0-9]/g, ""); }

  function syncPairedLink(plan, cur, value, budgetMs) {
    if (plan.settingKey !== "phone") return Promise.resolve(null);
    var newDigits = digitsOf(value);
    if (!newDigits) return Promise.resolve(null);
    var oldDigits = cur && cur.value != null ? digitsOf(cur.value) : "";
    var c = newAbort();
    return withDeadline(
      withAbort(sb.from("site_settings").select("value").eq("key", "link_tel").limit(1), c).then(chkRes),
      Math.max(800, budgetMs), c
    ).then(function (res) {
      var row = (res.data || [])[0];
      var linkVal = row ? String(row.value == null ? "" : row.value) : "";
      var linkDigits = digitsOf(linkVal);
      if (linkDigits === newDigits) return null;                       // 이미 같은 번호
      var wasSameAsOld = oldDigits && linkDigits === oldDigits;
      var nextLink = "tel:" + value.trim();
      if (!row || !linkVal || wasSameAsOld) {
        var c2 = newAbort();
        return withDeadline(
          withAbort(settingsUpsert({ key: "link_tel", value: nextLink }), c2).then(chkRes),
          Math.max(800, budgetMs), c2
        ).then(function () {
          editBaseline["settings:link_tel"] = nextLink;
          return { message: "(전화 걸기 버튼도 새 번호로 함께 바꿨어요)" };
        }, function () {
          return { message: "(다만 전화 걸기 버튼은 아직 옛 번호예요 — \"자세히 관리 → 병원 정보\"에서 확인해 주세요)" };
        });
      }
      // 따로 정해 둔 주소 → 원장에게 물어본다 (회신을 보낸 뒤에 뜬다)
      return {
        followUp: function () { askTelLinkSync(linkVal, nextLink); }
      };
    }).catch(function () { return null; });   // 짝 맞추기 실패는 저장 결과를 뒤집지 않는다
  }

  function askTelLinkSync(currentLink, nextLink) {
    confirmModal({
      title: "전화 걸기 버튼도 바꿀까요?",
      body: "홈페이지의 \"전화 걸기\" 버튼은 지금 " + shortText(currentLink.replace(/^tel:/, ""), 30) +
        " 로 연결돼요. 방금 바꾼 번호로 함께 맞출까요?",
      confirmLabel: "함께 바꾸기",
      cancelLabel: "그대로 두기"
    }).then(function (ok) {
      if (!ok) return;
      settingsUpsert({ key: "link_tel", value: nextLink }).then(function (res) {
        if (res.error) { dbError(res.error); return; }
        editBaseline["settings:link_tel"] = nextLink;
        toast("전화 걸기 버튼도 새 번호로 바꿨어요");
        sendToFrame("zia-edit-refresh", {});
      });
    });
  }

  /* ── 자유 편집 되돌리기 (부모 처리) ──
   * 자식(편집기)이 "원래대로"를 누르면 zia-edit-revert 를 보낸다 →
   * 그 자리의 자유 편집 기록을 지워 원래(정적) 문구로 되돌리고 결과를 회신한다.
   */
  function onEditRevert(d) {
    var reqId = d.reqId;
    var ov = (d.target && d.target.override) || null;
    function reply(ok, message, unknown) {
      liveStatus(ok ? message : (unknown ? "되돌렸는지 확인 중이에요" : "되돌리지 못했어요"), !ok);
      if (!ok) toast(message, "error");
      var msg = { reqId: reqId, ok: !!ok, message: message };
      if (unknown) msg.unknown = true;
      sendToFrame("zia-edit-reverted", msg);
    }
    if (!ov || !ov.page || !ov.selector) {
      reply(false, "이 자리는 되돌릴 수 없어요. 위쪽 \"자세히 관리\"에서 바꿔 주세요.");
      return;
    }
    var page = String(ov.page), selector = String(ov.selector);
    var key = "override:" + page + "|" + selector;
    function exists(ctrl) {
      return withAbort(sb.from("page_overrides").select("id").eq("page", page).eq("selector", selector).limit(1), ctrl)
        .then(chkRes).then(function (res) { return (res.data || []).length > 0; });
    }
    function done(removed) {
      delete editBaseline[key];
      reply(true, removed ? "원래 문구로 되돌렸어요 · 홈페이지에 바로 반영됐어요" : "이미 원래대로예요. 여기서 고친 내용이 없어요.");
      if (removed) setTimeout(function () { sendToFrame("zia-edit-refresh", {}); }, 900);
    }

    liveStatus("되돌리는 중…");
    var until = Date.now() + SAVE_TOTAL_MS;
    var ctrl = newAbort();
    withDeadline(
      withAbort(sb.from("page_overrides").delete().eq("page", page).eq("selector", selector).select("id"), ctrl).then(chkRes),
      WRITE_MS, ctrl
    ).then(function (res) {
      done((res.data || []).length > 0);
    }, function (err) {
      console.error("[admin] 되돌리기 실패:", err);
      if (isAuthExpiredError(err)) { reply(false, AUTH_EXPIRED_MSG); noteAuthExpired(null); return; }
      if (!isTimeoutError(err)) { reply(false, editSaveErrorMessage(err)); return; }
      // 응답을 못 받았다 → 진짜 지워졌는지 되읽어 확인한다 (저장과 같은 규율, F-1)
      var vc = newAbort();
      withDeadline(exists(vc), Math.max(900, Math.min(VERIFY_MS, until - Date.now())), vc).then(function (still) {
        if (still) reply(false, "되돌리지 못했어요. 잠시 뒤 다시 눌러 주세요.");
        else done(true);
      }, function () {
        reply(false, "되돌렸는지 아직 확인하지 못했어요. 잠시 뒤 홈페이지를 새로 불러와 확인해 주세요.", true);
      });
    });
  }

  // L2 — 홈 첫 화면 "칸 배치" (계약 §2 L2). 쓰는 모양이 L1 과 정반대라 전용 경로다.
  //   L1 : update <표>  set <칼럼>    = <값>       where id = <미리보기가 알려준 행 번호>
  //   L2 : update posts set home_slot = <칸 번호>  where id = <고른 글 번호>
  // 규칙은 "홈 화면 관리" 칸 픽커(drawHomeSlots/openHomePicker/assignHomeSlot)가 정본이며
  // 여기서는 같은 규칙을 그대로 따른다 — 두 경로는 대체가 아니라 병행이다.
  //   · 고른 글을 그 분야·그 칸에 담는다
  //   · 그 칸에 있던 글은 비운다 (칸 하나에 글 하나)
  //   · 같은 글이 다른 칸에 있었으면 그 글의 칸 번호만 옮긴다 (한 줄 수정이라 중복이 안 생긴다)
  //   · 값 0 = 이 칸 비우기
  // 쓰기 순서: **먼저 비우고 나중에 채운다** — 한 분야 안에서 같은 칸 번호를 두 글이
  //   동시에 가질 수 없기 때문(uq_posts_zone_home_slot). 채우기가 실패하면 비워 둔 칸을
  //   되돌린다(되돌리기까지 실패하면 그 칸은 빈 상태로 남고, 화면에 그대로 안내된다).
  function saveSlotTarget(def, target, value, ctrl) {
    var src = (def && def.source) || {};
    var slotNo = Number(src.slot);
    var zoneId = Number(target.rowId != null ? target.rowId : (target.row && target.row.id));
    var postId = Number(value);   // 0 = 이 칸 비우기
    if (!(slotNo >= 1 && slotNo <= HOME_SLOT_COUNT)) return Promise.reject(new Error("zia-unknown-field"));
    if (!zoneId) return Promise.reject(new Error("zia-no-row"));
    if (isNaN(postId) || postId < 0) return Promise.reject(new Error("zia-unknown-field"));

    var COLS = "id, zone_id, home_slot, published, title";
    // 1) 지금 이 칸에 있는 글부터 확인 (같은 분야·같은 칸은 최대 한 줄)
    return withAbort(sb.from("posts").select(COLS).eq("zone_id", zoneId).eq("home_slot", slotNo).limit(1), ctrl)
      .then(chkRes)
      .then(function (res) {
        var occupant = (res.data || [])[0] || null;
        if (!postId) {   // 빼기
          if (!occupant) return { message: "이 칸은 이미 비어 있어요." };
          return withAbort(sb.from("posts").update({ home_slot: null }).eq("id", occupant.id), ctrl).then(chkRes)
            .then(function () { return { message: "홈 화면에서 뺐어요 · 홈페이지에 바로 반영됐어요. 글은 그대로 있어요." }; });
        }
        if (occupant && occupant.id === postId) return { message: "이미 이 칸에 있는 글이에요." };
        return withAbort(sb.from("posts").select(COLS).eq("id", postId).limit(1), ctrl).then(chkRes).then(function (r2) {
          var picked = (r2.data || [])[0] || null;
          if (!picked) throw ziaError("고른 글을 찾지 못했어요. 새로고침한 뒤 다시 해 주세요.");
          if (Number(picked.zone_id) !== zoneId) {
            throw ziaError("이 글은 다른 진료 분야의 글이에요. 이 자리에는 같은 분야의 글만 넣을 수 있어요.");
          }
          if (!picked.published) {
            throw ziaError("이 글은 아직 발행 전이에요. \"자세히 관리 → 글 관리\"에서 발행한 뒤에 홈 화면에 넣을 수 있어요.");
          }
          var clear = occupant
            ? withAbort(sb.from("posts").update({ home_slot: null }).eq("id", occupant.id), ctrl).then(chkRes)
            : Promise.resolve(null);
          return clear
            .then(function () {
              return withAbort(sb.from("posts").update({ home_slot: slotNo }).eq("id", postId), ctrl).then(chkRes);
            })
            .then(function () { return { message: "홈 화면에 담았어요 · 홈페이지에 바로 반영됐어요" }; })
            .catch(function (err) {
              if (!occupant) throw err;
              // 채우기 실패 → 비워 둔 칸 되돌리기 (성공하든 실패하든 원래 오류를 알린다)
              return sb.from("posts").update({ home_slot: slotNo }).eq("id", occupant.id)
                .then(function () { throw err; }, function () { throw err; });
            });
        });
      })
      .then(function (out) {
        libCache.post = null;   // 모음의 "N번 칸에 있음" 표시가 달라진다 → 다시 불러오기
        return out;
      });
  }

  // 오류 → 원장이 읽는 한국어 안내 (전문용어 노출 금지)
  function editSaveErrorMessage(err) {
    if (err && err.ziaMessage) return err.ziaMessage;   // 원장에게 그대로 보여 줄 안내
    if (isAuthExpiredError(err)) return AUTH_EXPIRED_MSG;   // F-4 — 로그인 만료는 따로 안내
    var msg = String((err && (err.message || err.details)) || "").toLowerCase();
    var code = String((err && err.code) || "");
    if (msg.indexOf("zia-unknown-field") !== -1 || msg.indexOf("zia-no-row") !== -1 || msg.indexOf("zia-no-target") !== -1) {
      return "이 부분은 아직 여기서 바로 고칠 수 없어요. 위쪽 \"자세히 관리\"에서 바꿔 주세요.";
    }
    if (code === "42P01" || msg.indexOf("does not exist") !== -1 || msg.indexOf("schema cache") !== -1 ||
        msg.indexOf("not find the table") !== -1) {
      return "이 자리를 바로 고치는 기능은 아직 준비 중이에요. 준비되면 알려 드릴게요.";
    }
    if (code === "23505" || msg.indexOf("uq_posts_zone_home_slot") !== -1 || msg.indexOf("duplicate key") !== -1) {
      return "이 칸에 다른 글이 먼저 들어갔어요. 화면을 새로 불러온 뒤 다시 해 주세요.";
    }
    if (code === "42501" || msg.indexOf("row-level security") !== -1 || msg.indexOf("permission") !== -1) {
      return "이 내용을 바꿀 수 있는 권한이 없어요. 관리 담당자(GUAVA)에게 알려 주세요.";
    }
    if (msg.indexOf("fetch") !== -1 || msg.indexOf("network") !== -1) {
      return "인터넷 연결을 확인하고 다시 시도해 주세요.";
    }
    return "저장하지 못했어요. 다시 시도해 주세요. 계속 안 되면 관리 담당자(GUAVA)에게 알려 주세요.";
  }

  /* ════════════════════════ 진료 분야(ZONE) 관리 ════════════════════════ */

  function viewZones() {
    loadingView();
    loadZones(true).then(renderZoneList).catch(loadFailView);
  }

  function renderZoneList(zones) {
    var html =
      backLink("#/manage", "관리 목록으로") +
      '<h1 class="view-title">진료 분야 관리</h1>' +
      '<p class="view-desc">스위치를 누르면 바로 저장돼요.<br>' +
      "&middot; <b>홈페이지 노출</b>: 홈페이지 메뉴에 이 분야를 보여줘요<br>" +
      "&middot; <b>대표 분야</b>: 자주 묻는 질문(FAQ)의 대표 묶음이 돼요<br>" +
      "&middot; <b>홈 진료탭</b>: 홈 화면 진료 소개 탭에 나와요</p>" +
      whereNote("zones");

    zones.forEach(function (z) {
      var lockHint = !z.is_visible
        ? '<p class="zone-hint">홈페이지에 노출해야 "대표 분야"와 "홈 진료탭"을 켤 수 있어요.</p>'
        : "";
      html +=
        '<div class="zone-row' + (z.is_visible ? "" : " zone-off") + '" data-id="' + z.id + '">' +
        '<div class="zone-name">' + esc(z.name) + "</div>" +
        (z.tab_label || z.faq_label
          ? '<div class="zone-sub">' +
            (z.tab_label ? "홈 탭 이름: " + esc(z.tab_label) + " " : "") +
            (z.faq_label ? "질문 묶음 이름: " + esc(z.faq_label) : "") + "</div>"
          : "") +
        '<div class="zone-toggles">' +
        zoneSwitch(z, "is_visible", "홈페이지 노출", false) +
        zoneSwitch(z, "is_primary", "대표 분야", !z.is_visible) +
        zoneSwitch(z, "show_in_home_tabs", "홈 진료탭", !z.is_visible) +
        "</div>" + lockHint +
        '<div class="zone-hero" data-role="hero"></div></div>';
    });

    root().innerHTML = html;
    bindNav(root());

    root().querySelectorAll(".zone-row").forEach(function (row) {
      var zone = state.zones.find(function (z) { return z.id === Number(row.getAttribute("data-id")); });
      row.querySelectorAll("input[data-field]").forEach(function (input) {
        input.addEventListener("change", function () {
          onZoneToggle(zone, input.getAttribute("data-field"), input.checked, input);
        });
      });
      // 대표 이미지 (홈 진료탭 패널) — 드래그/클릭 교체 (P3-d B4, 저장 즉시 반영)
      imageDropControl(row.querySelector('[data-role="hero"]'), {
        value: zone.hero_image_path,
        folder: "zones",
        emptyText: "대표 사진 넣기 (홈 진료탭 패널에 나와요)",
        onChange: function (path) { updateZone(zone, { hero_image_path: path }); }
      });
    });
  }

  function zoneSwitch(zone, field, label, disabled) {
    return '<label class="switch' + (disabled ? " disabled" : "") + '">' +
      '<input type="checkbox" data-field="' + field + '"' +
      (zone[field] ? " checked" : "") + (disabled ? " disabled" : "") + ">" +
      '<span class="slider"></span><span class="switch-label">' + esc(label) + "</span></label>";
  }

  function onZoneToggle(zone, field, checked, inputEl) {
    // §7 제약 선반영: 노출을 끄면 대표·홈탭도 함께 꺼야 함 (DB check와 정합)
    if (field === "is_visible" && !checked && (zone.is_primary || zone.show_in_home_tabs)) {
      confirmModal({
        title: "홈페이지에서 숨길까요?",
        body: '"' + zone.name + '" 분야를 숨기면 "대표 분야"와 "홈 진료탭" 설정도 함께 꺼져요.',
        confirmLabel: "숨기기"
      }).then(function (ok) {
        if (!ok) { inputEl.checked = true; return; }
        updateZone(zone, { is_visible: false, is_primary: false, show_in_home_tabs: false });
      });
      return;
    }
    var patch = {};
    patch[field] = checked;
    updateZone(zone, patch);
  }

  function updateZone(zone, patch) {
    sb.from("zones").update(patch).eq("id", zone.id).then(function (res) {
      if (res.error) { dbError(res.error); renderZoneList(state.zones); return; }
      Object.assign(zone, patch);
      toastView("저장했어요 · 홈페이지에 바로 반영됐어요", "zones");
      renderZoneList(state.zones);
    });
  }

  /* ════════════════════════ 글 관리 ════════════════════════ */

  var postsFilterZone = ""; // 목록 분야 필터 유지
  var POST_BODY_MAX = 40000;   // 글 본문 글자 수 상한 (F-7)

  function viewPosts() {
    loadingView();
    Promise.all([
      loadZones(true),
      sb.from("posts").select("*").order("sort_order").order("id").then(function (res) {
        if (res.error) throw res.error;
        return res.data || [];
      })
    ]).then(function (results) {
      renderPostList(results[1]);
    }).catch(loadFailView);
  }

  function renderPostList(posts) {
    var zoneOptions = '<option value="">모든 분야</option>' + state.zones.map(function (z) {
      return '<option value="' + z.id + '"' + (String(z.id) === postsFilterZone ? " selected" : "") + ">" + esc(z.name) + "</option>";
    }).join("");

    var html =
      backLink("#/manage", "관리 목록으로") +
      '<h1 class="view-title">글 관리</h1>' +
      '<p class="view-desc">홈페이지 진료 소개에 나오는 글이에요. "발행 중"인 글만 홈페이지에 보여요.</p>' +
      whereNote("posts") +
      '<div class="topbar">' +
      '<select id="posts-filter" style="max-width:220px" aria-label="분야 필터">' + zoneOptions + "</select>" +
      '<button type="button" class="btn-primary" data-nav="#/posts/new">+ 새 글 쓰기</button>' +
      "</div><div id=\"posts-list\"></div>";

    root().innerHTML = html;
    bindNav(root());
    byId("posts-filter").addEventListener("change", function () {
      postsFilterZone = this.value;
      drawPostRows(posts);
    });
    drawPostRows(posts);
  }

  function drawPostRows(posts) {
    var list = byId("posts-list");
    var rows = posts.filter(function (p) {
      return !postsFilterZone || String(p.zone_id) === postsFilterZone;
    });
    if (!rows.length) {
      list.innerHTML = '<p class="empty-note">아직 글이 없어요. "새 글 쓰기"를 눌러 시작해 보세요.</p>';
      return;
    }
    list.innerHTML = rows.map(function (p) {
      return '<div class="item-row" data-id="' + p.id + '">' +
        '<div class="item-main">' +
        '<div class="item-title">' + esc(p.title) + "</div>" +
        '<div class="item-meta">' +
        '<span class="pill ' + (p.published ? "pill-live" : "pill-draft") + '">' + (p.published ? "발행 중" : "임시저장") + "</span>" +
        "<span>" + esc(zoneName(p.zone_id)) + "</span>" +
        (p.badge ? "<span>라벨: " + esc(p.badge) + "</span>" : "") +
        "</div></div>" +
        '<div class="item-actions">' +
        '<button type="button" class="btn-secondary btn-sm" data-act="edit">수정</button>' +
        '<button type="button" class="btn-danger btn-sm" data-act="del">삭제</button>' +
        "</div></div>";
    }).join("");

    list.querySelectorAll(".item-row").forEach(function (row) {
      var id = Number(row.getAttribute("data-id"));
      var post = posts.find(function (p) { return p.id === id; });
      row.querySelector('[data-act="edit"]').addEventListener("click", function () { location.hash = "#/posts/" + id; });
      row.querySelector('[data-act="del"]').addEventListener("click", function () {
        confirmModal({
          title: "정말 삭제할까요?",
          body: '"' + (post.title || "") + '" 글이 완전히 지워져요. 되돌릴 수 없습니다.',
          confirmLabel: "삭제", danger: true
        }).then(function (ok) {
          if (!ok) return;
          sb.from("posts").delete().eq("id", id).then(function (res) {
            if (res.error) { dbError(res.error, "삭제하지 못했어요"); return; }
            toast("삭제되었습니다");
            viewPosts();
          });
        });
      });
    });
  }

  function viewPostEdit(id) {
    loadingView();
    var jobs = [loadZones(true), loadTags(true)];
    if (id) {
      jobs.push(sb.from("posts").select("*, post_tags(tag_id)").eq("id", id).single().then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      }));
    }
    Promise.all(jobs).then(function (results) {
      renderPostForm(results[2] || null);
    }).catch(loadFailView);
  }

  function renderPostForm(post) {
    var isEdit = !!post;
    var selectedTagIds = isEdit ? (post.post_tags || []).map(function (t) { return t.tag_id; }) : [];
    var zoneOptions = '<option value="">분야를 골라 주세요</option>' + state.zones.map(function (z) {
      return '<option value="' + z.id + '"' + (isEdit && post.zone_id === z.id ? " selected" : "") + ">" + esc(z.name) + "</option>";
    }).join("");

    root().innerHTML =
      backLink("#/posts", "글 목록으로") +
      '<h1 class="view-title">' + (isEdit ? "글 수정" : "새 글 쓰기") + "</h1>" +
      '<div class="card">' +
      '<div class="field"><label for="post-title">제목</label>' +
      '<input type="text" id="post-title" maxlength="120" value="' + esc(isEdit ? post.title : "") + '" placeholder="예: 반복되는 두근거림과 불안, 자율신경 불균형">' +
      '<p class="help">120자까지 쓸 수 있어요.</p></div>' +
      '<div class="field"><label for="post-zone">진료 분야</label>' +
      '<select id="post-zone">' + zoneOptions + "</select>" +
      '<p class="help">글 하나는 분야 하나에만 속해요. 분야를 바꾸면 아래 태그 선택이 초기화돼요.</p></div>' +
      '<div class="field"><label>태그</label><div id="post-tags" class="tag-checks"></div>' +
      '<p class="help">이 글과 관련 있는 태그에 표시해 주세요. 고른 분야의 태그만 나와요.</p></div>' +
      '<div class="field"><label for="post-badge">카드 라벨 <span style="font-weight:400;color:var(--muted)">(선택)</span></label>' +
      '<input type="text" id="post-badge" maxlength="40" value="' + esc(isEdit ? post.badge || "" : "") + '" placeholder="예: 공황장애 — 홈페이지 카드에 크게 표시되는 짧은 말"></div>' +
      '<div class="field"><label for="post-editor">내용 <span style="font-weight:400;color:var(--muted)">(선택)</span></label>' +
      '<div class="editor-bar">' +
      '<button type="button" class="btn-secondary btn-sm" id="post-img-btn">사진 넣기</button>' +
      '<button type="button" class="btn-ghost btn-sm" id="post-preview-btn">미리보기</button>' +
      '<span class="editor-status" id="post-editor-status"></span>' +
      "</div>" +
      '<div id="post-editor" class="rich-editor" contenteditable="true" data-placeholder="블로그 글을 복사해서 여기에 붙여넣으세요. 직접 써도 돼요."></div>' +
      '<div id="post-preview" class="post-preview hidden"></div>' +
      '<input type="file" id="post-img-file" accept="image/*" multiple class="hidden">' +
      '<p class="help">블로그 글을 그대로 붙여넣으면 제목·굵은 글씨·사진이 함께 들어와요. ' +
      "사진은 자동으로 홈페이지 저장소에 옮겨 드려요. 못 가져온 사진 자리는 \"사진 넣기\"로 다시 넣어 주세요.</p></div>" +
      '<div class="field"><label>목록 사진(썸네일) <span style="font-weight:400;color:var(--muted)">(선택)</span></label>' +
      '<div id="post-thumb"></div>' +
      '<p class="help">홈·목록 카드의 배경으로 쓰이는 대표 사진이에요.</p></div>' +
      '<div class="field"><label for="post-url">블로그 원문 링크 <span style="font-weight:400;color:var(--muted)">(선택)</span></label>' +
      '<input type="url" id="post-url" maxlength="500" value="' + esc(isEdit ? post.external_url || "" : "") + '" placeholder="https:// 로 시작하는 주소">' +
      '<p class="help">주소를 넣으면 홈페이지 카드를 눌렀을 때 블로그 원문이 새 창으로 열려요. 비워 두고 내용을 쓰면 홈페이지 안 글 페이지로 열려요.</p></div>' +
      '<div class="field"><label for="post-order">표시 순서 <span style="font-weight:400;color:var(--muted)">(선택)</span></label>' +
      '<input type="number" id="post-order" value="' + (isEdit ? post.sort_order : 0) + '" style="max-width:140px">' +
      '<p class="help">숫자가 작을수록 앞에 나와요. 잘 모르겠으면 그대로 두세요.</p></div>' +
      '<p class="field-error hidden" id="post-form-error"></p>' +
      '<div class="form-actions" id="post-actions"></div>' +
      "</div>";
    bindNav(root());

    var zoneSelect = byId("post-zone");
    renderPostTagChecks(Number(zoneSelect.value) || null, selectedTagIds);
    zoneSelect.addEventListener("change", function () {
      renderPostTagChecks(Number(this.value) || null, []); // 분야 변경 → 태그 초기화 (§7.1)
    });

    /* ── 본문 에디터 (P3-d B1: 붙여넣기 + sanitize + 이미지 사다리) ── */
    var editor = byId("post-editor");
    var statusEl = byId("post-editor-status");
    var pendingUploads = 0;
    try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (e) { /* 미지원 무해 */ }

    if (isEdit && post.body_html) {
      editor.innerHTML = ZiaSanitize.sanitize(post.body_html); // 표시 전 재-sanitize (이중 방어)
    } else if (isEdit && post.body) {
      editor.innerHTML = textToHtmlParas(post.body); // 텍스트 본문 구버전 호환
    }

    var uploadPct = null;   // 한 장씩 올릴 때의 진행률 (여러 장이면 장수만 알린다)
    function setUploadStatus() {
      if (pendingUploads <= 0) { statusEl.textContent = ""; uploadPct = null; return; }
      statusEl.textContent = pendingUploads > 1
        ? "사진 올리는 중… (" + pendingUploads + "장 남음)"
        : uploadingText(uploadPct);
    }

    // 못 가져온 이미지 → 안내 placeholder (텍스트라 저장 시 sanitize를 통과해 남음 — 의도)
    function replaceWithImgNote(img) {
      var p = document.createElement("p");
      p.className = "img-missing";
      p.textContent = "[사진을 가져오지 못했어요 — 이 자리는 '사진 넣기'로 다시 넣어 주세요]";
      if (img.parentNode) img.parentNode.replaceChild(p, img);
    }

    // 붙여넣은 이미지 사다리: ① data URL → Blob 업로드 ② 외부 http(s) → fetch(CORS 허용 시) 업로드
    // ③ 실패 → placeholder 안내. 저장소(supabase) URL은 그대로 둔다.
    function processEditorImages() {
      Array.prototype.slice.call(editor.querySelectorAll("img")).forEach(function (img) {
        var src = img.getAttribute("src") || "";
        if (src.indexOf(cfg.supabaseUrl) === 0 || img.getAttribute("data-busy")) return;
        var job;
        if (src.indexOf("data:image/") === 0) {
          job = dataUrlToBlob(src);
        } else if (/^https?:/.test(src)) {
          job = fetch(src, { mode: "cors" }).then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.blob();
          }).then(function (blob) {
            if (!IMG_EXT[blob.type]) throw new Error("not image: " + blob.type);
            return blob;
          });
        } else {
          replaceWithImgNote(img);
          return;
        }
        img.setAttribute("data-busy", "1");
        pendingUploads++;
        setUploadStatus();
        job.then(function (blob) { return uploadImage(blob, "posts", { name: nameFromUrl(src) }); })
          .then(function (up) {
            img.setAttribute("src", up.url);
            img.removeAttribute("data-busy");
          })
          .catch(function (err) {
            console.warn("[admin] 이미지 가져오기 실패:", err);
            replaceWithImgNote(img);
          })
          .then(function () { pendingUploads--; setUploadStatus(); });
      });
    }

    editor.addEventListener("paste", function (e) {
      e.preventDefault();
      var cd = e.clipboardData || window.clipboardData;
      if (!cd) return;
      var html = cd.getData ? cd.getData("text/html") : "";
      var clean = html
        ? ZiaSanitize.sanitize(html)
        : textToHtmlParas(cd.getData ? cd.getData("text/plain") : cd.getData("Text"));
      if (clean) insertHtmlAtCaret(editor, clean);
      // 클립보드에 파일로만 담긴 이미지 (화면 캡처 붙여넣기)
      if (cd.files && cd.files.length) {
        Array.prototype.slice.call(cd.files).filter(function (f) { return IMG_EXT[f.type]; }).forEach(insertImageFile);
      }
      processEditorImages();
    });
    editor.addEventListener("dragover", function (e) { e.preventDefault(); editor.classList.add("drag-on"); });
    editor.addEventListener("dragleave", function () { editor.classList.remove("drag-on"); });
    editor.addEventListener("drop", function (e) {
      e.preventDefault();
      editor.classList.remove("drag-on");
      var files = e.dataTransfer ? Array.prototype.slice.call(e.dataTransfer.files) : [];
      var imgs = files.filter(function (f) { return IMG_EXT[f.type]; });
      if (!imgs.length) { toast("이미지 파일(jpg·png 등)만 넣을 수 있어요", "error"); return; }
      imgs.forEach(insertImageFile);
    });

    function insertImageFile(file) {
      if (file.size > MAX_UPLOAD_BYTES) { toast(tooBigMessage(file.name), "error"); return; }   // F-5
      pendingUploads++;
      uploadPct = 0;
      setUploadStatus();
      uploadImage(file, "posts", {
        name: file.name,
        onProgress: function (p) { uploadPct = p; setUploadStatus(); }
      }).then(function (up) {
        insertHtmlAtCaret(editor, '<img src="' + esc(up.url) + '">');
      }).catch(function (err) {
        console.error("[admin] upload error:", err);
        toast(uploadErrorMessage(err), "error");
      }).then(function () { pendingUploads--; uploadPct = null; setUploadStatus(); });
    }
    byId("post-img-btn").addEventListener("click", function () { byId("post-img-file").click(); });
    byId("post-img-file").addEventListener("change", function () {
      Array.prototype.slice.call(this.files).filter(function (f) { return IMG_EXT[f.type]; }).forEach(insertImageFile);
      this.value = "";
    });

    // 미리보기 토글 (사이트 유사 타이포 — .post-preview)
    var previewOn = false;
    byId("post-preview-btn").addEventListener("click", function () {
      previewOn = !previewOn;
      var pv = byId("post-preview");
      if (previewOn) {
        pv.innerHTML = ZiaSanitize.sanitize(editor.innerHTML) || '<p class="help">아직 내용이 없어요.</p>';
        pv.classList.remove("hidden");
        editor.classList.add("hidden");
        this.textContent = "다시 쓰기";
      } else {
        pv.classList.add("hidden");
        editor.classList.remove("hidden");
        this.textContent = "미리보기";
      }
    });

    // 썸네일 드래그 존 (저장 버튼 시점에 payload 반영)
    var thumbCtl = imageDropControl(byId("post-thumb"), {
      value: isEdit ? post.thumbnail_path : null,
      folder: "posts",
      emptyText: "사진을 끌어다 놓거나 눌러서 고르기",
      onChange: function () { /* 폼 저장 시 반영 */ }
    });

    var actions = byId("post-actions");
    if (isEdit && post.published) {
      actions.innerHTML =
        '<button type="button" class="btn-primary" id="post-save">저장하기</button>' +
        '<button type="button" class="btn-ghost" id="post-unpublish">발행 중지</button>';
      byId("post-save").addEventListener("click", function () { savePost(post, true, this); });
      byId("post-unpublish").addEventListener("click", function () {
        var self = this;
        confirmModal({
          title: "발행을 중지할까요?",
          body: "홈페이지에서 이 글이 안 보이게 돼요. 홈 화면 칸에 담아 둔 경우 홈에서도 빠져요. 글 자체는 지워지지 않고 임시저장으로 남아요.",
          confirmLabel: "발행 중지"
        }).then(function (ok) { if (ok) savePost(post, false, self); });
      });
    } else {
      actions.innerHTML =
        '<button type="button" class="btn-secondary" id="post-draft">임시저장</button>' +
        '<button type="button" class="btn-primary" id="post-publish">발행하기</button>';
      byId("post-draft").addEventListener("click", function () { savePost(post, false, this); });
      byId("post-publish").addEventListener("click", function () { savePost(post, true, this); });
    }

    // 저장 (임시저장/발행 공용) — 본문은 sanitize된 HTML(body_html) + 텍스트 추출본(body) 동시 저장.
    // ⚠ 의료광고법 lint 미탑재 (사용자 결단 2026-07-22 "lint 없애줘 전부" — 후기 포함 CMS 전면
    //    제거. 광고법 검증·리스크 소유는 운영 주체로 이관).
    function savePost(existing, publish, btn) {
      showFormError("post-form-error", null);
      var title = byId("post-title").value.trim();
      var zoneId = Number(byId("post-zone").value) || null;
      if (!title) { showFormError("post-form-error", "제목을 입력해 주세요."); return; }
      if (!zoneId) { showFormError("post-form-error", "진료 분야를 골라 주세요."); return; }
      if (pendingUploads > 0) {
        showFormError("post-form-error", "사진을 올리는 중이에요. 위 안내가 사라진 뒤 다시 눌러 주세요.");
        return;
      }

      var bodyHtml = ZiaSanitize.sanitize(editor.innerHTML);
      var bodyText = ZiaSanitize.toText(bodyHtml);
      if (bodyText.length > POST_BODY_MAX) {   // F-7 — 붙여넣기 사고 방지 상한
        showFormError("post-form-error", "내용이 너무 길어요 (" + fmtCount(bodyText.length) + "자). " +
          fmtCount(POST_BODY_MAX) + "자까지 쓸 수 있어요. 글을 나눠서 올려 주세요.");
        return;
      }
      if (!bodyText && !/<img[\s>]/.test(bodyHtml)) bodyHtml = ""; // 글자·사진 모두 없음 → 빈 본문

      var tagIds = Array.prototype.map.call(
        byId("post-tags").querySelectorAll("input:checked"),
        function (i) { return Number(i.value); }
      );
      var payload = {
        zone_id: zoneId,
        title: title,
        badge: byId("post-badge").value.trim() || null,
        body: bodyText || null,
        body_html: bodyHtml || null,
        thumbnail_path: thumbCtl.get() || null,
        external_url: byId("post-url").value.trim() || null,
        sort_order: Number(byId("post-order").value) || 0,
        published: publish,
        published_at: publish ? (existing && existing.published_at) || new Date().toISOString() : (existing && existing.published_at) || null
      };
      if (!publish) payload.home_slot = null; // 발행 중지/임시저장 → 홈 캐러셀 칸에서 제외

      busy(btn, true, "저장 중…");
      var q = existing
        ? sb.from("posts").update(payload).eq("id", existing.id).select("id").single()
        : sb.from("posts").insert(payload).select("id").single();

      q.then(function (res) {
        if (res.error) throw res.error;
        var postId = res.data.id;
        // 태그 동기화: 기존 연결 삭제 후 재삽입 (§7.1 트리거가 분야 일치 검증)
        return sb.from("post_tags").delete().eq("post_id", postId).then(function (delRes) {
          if (delRes.error) throw delRes.error;
          if (!tagIds.length) return null;
          return sb.from("post_tags").insert(tagIds.map(function (tid) {
            return { post_id: postId, tag_id: tid };
          })).then(function (insRes) { if (insRes.error) throw insRes.error; });
        });
      }).then(function () {
        busy(btn, false);
        if (publish) toastView("발행되었습니다. 홈페이지에 반영돼요.", "posts");
        else toast("임시저장되었습니다. 홈페이지에는 아직 안 보여요.");
        location.hash = "#/posts";
      }).catch(function (err) {
        busy(btn, false);
        dbError(err);
      });
    }
  }

  function renderPostTagChecks(zoneId, selectedTagIds) {
    var box = byId("post-tags");
    if (!zoneId) {
      box.innerHTML = '<p class="help" style="margin:0">먼저 위에서 진료 분야를 골라 주세요.</p>';
      return;
    }
    var tags = (state.tags || []).filter(function (t) { return t.zone_id === zoneId; });
    if (!tags.length) {
      box.innerHTML = '<p class="help" style="margin:0">이 분야에는 아직 태그가 없어요. 태그 없이 저장해도 괜찮아요.</p>';
      return;
    }
    box.innerHTML = tags.map(function (t) {
      var on = selectedTagIds.indexOf(t.id) !== -1;
      return '<label class="tag-check' + (on ? " checked" : "") + '">' +
        '<input type="checkbox" value="' + t.id + '"' + (on ? " checked" : "") + ">#" + esc(t.name) + "</label>";
    }).join("");
    box.querySelectorAll("input").forEach(function (input) {
      input.addEventListener("change", function () {
        input.closest(".tag-check").classList.toggle("checked", input.checked);
      });
    });
  }

  function showFormError(id, message) {
    var el = byId(id);
    if (!el) return;
    if (message) { el.textContent = message; el.classList.remove("hidden"); }
    else el.classList.add("hidden");
  }

  /* ════════════════════════ 홈 화면 관리 (P3-d B2 — 슬롯 픽커) ════════════════════════ */

  var HOME_SLOT_COUNT = 6; // 홈 §5 캐러셀 정적 데모 카드 수와 동일
  var homeTabZoneId = null; // 탭 선택 유지

  // 홈 진료탭 정렬 — cms-inject.js byHomeTabOrder 와 동일 규칙
  function byHomeTabOrder(a, b) {
    var ao = (a.home_tab_order == null) ? 9999 : a.home_tab_order;
    var bo = (b.home_tab_order == null) ? 9999 : b.home_tab_order;
    return (ao - bo) || (a.sort_order - b.sort_order) || (a.id - b.id);
  }

  function viewHome() {
    loadingView();
    Promise.all([
      loadZones(true),
      sb.from("posts").select("*").order("sort_order").order("id").then(function (res) {
        if (res.error) throw res.error;
        return res.data || [];
      })
    ]).then(function (results) {
      renderHome(results[1]);
    }).catch(loadFailView);
  }

  function renderHome(posts) {
    var tabZones = state.zones.filter(function (z) { return z.show_in_home_tabs; }).sort(byHomeTabOrder);
    var html =
      backLink("#/manage", "관리 목록으로") +
      '<h1 class="view-title">홈 화면 관리</h1>' +
      '<p class="view-desc">홈 첫 화면 "진료 소개"에 나올 글을 정해요. 분야(탭)마다 <b>6칸</b>이 있어요.<br>' +
      "빈 칸을 누르면 글을 골라 담을 수 있고, 채워진 칸을 누르면 바꾸거나 뺄 수 있어요.</p>" +
      whereNote("home");

    if (!tabZones.length) {
      html += '<div class="notice-info">홈 진료탭에 켜진 분야가 없어요. 먼저 "진료 분야 관리"에서 <b>홈 진료탭</b> 스위치를 켜 주세요.</div>' +
        '<button type="button" class="btn-secondary" data-nav="#/zones">진료 분야 관리로 가기</button>';
      root().innerHTML = html;
      bindNav(root());
      return;
    }
    if (homeTabZoneId == null || !tabZones.some(function (z) { return z.id === homeTabZoneId; })) {
      homeTabZoneId = tabZones[0].id;
    }
    html += '<div class="home-tabs">' + tabZones.map(function (z) {
      return '<button type="button" class="home-tab' + (z.id === homeTabZoneId ? " active" : "") +
        '" data-zone="' + z.id + '">' + esc(z.tab_label || z.name) + "</button>";
    }).join("") + "</div>" +
      '<div id="home-slots" class="slot-grid"></div>';

    root().innerHTML = html;
    bindNav(root());
    root().querySelectorAll(".home-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        homeTabZoneId = Number(btn.getAttribute("data-zone"));
        renderHome(posts);
      });
    });
    drawHomeSlots(posts);
  }

  function drawHomeSlots(posts) {
    var zone = state.zones.find(function (z) { return z.id === homeTabZoneId; });
    var box = byId("home-slots");
    function slotPost(n) {
      return posts.find(function (x) { return x.zone_id === zone.id && x.home_slot === n; });
    }
    var html = "";
    for (var n = 1; n <= HOME_SLOT_COUNT; n++) {
      var p = slotPost(n);
      html += p
        ? '<button type="button" class="slot-card filled" data-slot="' + n + '">' +
          '<span class="slot-no">' + n + "번 칸</span>" +
          (p.thumbnail_path
            ? '<img class="slot-thumb" src="' + esc(adminImageUrl(p.thumbnail_path)) + '" alt="">'
            : '<span class="slot-thumb slot-thumb-empty"></span>') +
          '<span class="slot-title">' + esc(p.title) + "</span>" +
          (!p.published ? '<span class="pill pill-fail">발행 중지됨</span>' : "") +
          "</button>"
        : '<button type="button" class="slot-card slot-empty" data-slot="' + n + '">' +
          '<span class="slot-no">' + n + '번 칸</span><span class="slot-add">+ 글 선택</span></button>';
    }
    box.innerHTML = html;
    box.querySelectorAll(".slot-card").forEach(function (el) {
      var slotNo = Number(el.getAttribute("data-slot"));
      el.addEventListener("click", function () {
        var cur = slotPost(slotNo);
        if (cur) openSlotActions(zone, slotNo, cur, posts);
        else openHomePicker(zone, slotNo, null, posts);
      });
    });
  }

  // 슬롯에 담을 글 고르기 모달. replacing = 현재 슬롯 글 (교체 흐름이면 지정)
  function openHomePicker(zone, slotNo, replacing, posts) {
    var zonePosts = posts.filter(function (p) {
      return p.zone_id === zone.id && (!replacing || p.id !== replacing.id);
    });
    var listHtml;
    if (!zonePosts.length) {
      listHtml = '<p class="empty-note">이 분야에는 아직 글이 없어요.<br>"글 관리"에서 먼저 글을 써 주세요.</p>';
    } else {
      // 발행 글 = 선택 가능 / 미발행 글 = 흐리게 + 선택 불가 (먼저 발행 안내)
      listHtml = '<div class="pick-list">' + zonePosts.map(function (p) {
        var inSlot = p.home_slot != null
          ? '<span class="pill pill-star">' + p.home_slot + "번 칸에 있음</span>" : "";
        return p.published
          ? '<button type="button" class="pick-item" data-id="' + p.id + '">' +
            '<span class="pick-title">' + esc(p.title) + "</span>" +
            '<span class="pick-meta"><span class="pill pill-live">발행 중</span>' + inSlot + "</span></button>"
          : '<div class="pick-item disabled">' +
            '<span class="pick-title">' + esc(p.title) + "</span>" +
            '<span class="pick-meta"><span class="pill pill-draft">임시저장</span>' +
            '<span class="pick-note">먼저 발행해 주세요</span></span></div>';
      }).join("") + "</div>";
    }
    var overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      '<div class="modal modal-wide" role="dialog" aria-modal="true">' +
      "<h2>" + esc((zone.tab_label || zone.name) + " · " + slotNo + "번 칸에 담을 글") + "</h2>" +
      listHtml +
      '<div class="modal-actions"><button type="button" class="btn-ghost" data-act="cancel">닫기</button></div>' +
      "</div>";
    function close() { overlay.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) { close(); return; }
      var act = e.target.getAttribute && e.target.getAttribute("data-act");
      if (act === "cancel") { close(); return; }
      var item = e.target.closest ? e.target.closest(".pick-item") : null;
      if (!item || item.classList.contains("disabled")) return;
      var id = Number(item.getAttribute("data-id"));
      close();
      assignHomeSlot(slotNo, id, replacing);
    });
    document.addEventListener("keydown", onKey);
    byId("modal-root").appendChild(overlay);
  }

  function assignHomeSlot(slotNo, postId, replacing) {
    // 교체 흐름: 기존 글 칸 비우기 → 새 글 담기 (순차 — zone 내 칸 중복 금지 인덱스와 정합)
    var clear = replacing
      ? sb.from("posts").update({ home_slot: null }).eq("id", replacing.id).then(function (res) {
          if (res.error) throw res.error;
        })
      : Promise.resolve();
    clear.then(function () {
      return sb.from("posts").update({ home_slot: slotNo }).eq("id", postId).then(function (res) {
        if (res.error) throw res.error;
      });
    }).then(function () {
      toastView("홈 화면에 담았어요 · 홈페이지에 바로 반영됐어요", "home");
      viewHome();
    }).catch(function (err) {
      dbError(err);
      viewHome();
    });
  }

  // 채워진 슬롯: 다른 글로 바꾸기 / 홈에서 빼기 / 닫기
  function openSlotActions(zone, slotNo, post, posts) {
    var overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
      "<h2>" + slotNo + "번 칸: " + esc(post.title) + "</h2>" +
      "<p>이 칸을 어떻게 할까요?</p>" +
      '<div class="modal-actions modal-actions-col">' +
      '<button type="button" class="btn-primary" data-act="swap">다른 글로 바꾸기</button>' +
      '<button type="button" class="btn-danger" data-act="remove">홈에서 빼기</button>' +
      '<button type="button" class="btn-ghost" data-act="cancel">닫기</button>' +
      "</div></div>";
    function close() { overlay.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) { close(); return; }
      var act = e.target.getAttribute && e.target.getAttribute("data-act");
      if (act === "cancel") { close(); return; }
      if (act === "swap") { close(); openHomePicker(zone, slotNo, post, posts); return; }
      if (act === "remove") {
        close();
        sb.from("posts").update({ home_slot: null }).eq("id", post.id).then(function (res) {
          if (res.error) { dbError(res.error); viewHome(); return; }
          toastView("홈 화면에서 뺐어요 · 홈페이지에 바로 반영됐어요. 글 자체는 그대로 있어요.", "home");
          viewHome();
        });
      }
    });
    document.addEventListener("keydown", onKey);
    byId("modal-root").appendChild(overlay);
  }

  /* ════════════════════════ 자주 묻는 질문 관리 (P3-d B3) ════════════════════════ */

  var faqsFilterZone = ""; // 카테고리 필터 유지

  function faqZoneLabel(z) { return z.faq_label || z.name; }

  function viewFaqs() {
    loadingView();
    Promise.all([
      loadZones(true),
      sb.from("faqs").select("*").order("zone_id").order("sort_order").order("id").then(function (res) {
        if (res.error) throw res.error;
        return res.data || [];
      })
    ]).then(function (results) {
      renderFaqList(results[1]);
    }).catch(loadFailView);
  }

  function renderFaqList(faqs) {
    // 필터 탭: 전체 + (대표 zone ∪ 질문 보유 zone) — 대표(faq_label 보유) 우선
    var hasFaq = {};
    faqs.forEach(function (f) { hasFaq[f.zone_id] = true; });
    var tabZones = state.zones.filter(function (z) { return z.is_primary || hasFaq[z.id]; });
    tabZones.sort(function (a, b) {
      return ((b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0)) || (a.sort_order - b.sort_order) || (a.id - b.id);
    });
    if (faqsFilterZone && !tabZones.some(function (z) { return String(z.id) === faqsFilterZone; })) {
      faqsFilterZone = "";
    }

    var html =
      backLink("#/manage", "관리 목록으로") +
      '<h1 class="view-title">자주 묻는 질문 관리</h1>' +
      '<p class="view-desc">홈페이지 "자주 묻는 질문"에 나오는 내용이에요. ▲▼ 버튼으로 순서를 바꾸면 바로 저장돼요.</p>' +
      whereNote("faqs") +
      '<div class="home-tabs">' +
      '<button type="button" class="home-tab' + (faqsFilterZone === "" ? " active" : "") + '" data-zone="">전체</button>' +
      tabZones.map(function (z) {
        return '<button type="button" class="home-tab' + (String(z.id) === faqsFilterZone ? " active" : "") +
          '" data-zone="' + z.id + '">' + esc(faqZoneLabel(z)) + "</button>";
      }).join("") + "</div>" +
      '<div class="topbar"><span></span><button type="button" class="btn-primary" data-nav="#/faqs/new">+ 새 질문 쓰기</button></div>' +
      '<div id="faqs-list"></div>';
    root().innerHTML = html;
    bindNav(root());
    root().querySelectorAll(".home-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        faqsFilterZone = btn.getAttribute("data-zone");
        renderFaqList(faqs);
      });
    });
    drawFaqRows(faqs);
  }

  function drawFaqRows(faqs) {
    var list = byId("faqs-list");
    var zones = state.zones.filter(function (z) {
      return !faqsFilterZone || String(z.id) === faqsFilterZone;
    });
    var html = "";
    zones.forEach(function (z) {
      var rows = faqs.filter(function (f) { return f.zone_id === z.id; }); // 쿼리가 sort_order,id 정렬
      if (!rows.length) return;
      if (!faqsFilterZone) html += '<h2 class="faq-group-title">' + esc(faqZoneLabel(z)) + "</h2>";
      rows.forEach(function (f, i) {
        html +=
          '<div class="item-row" data-id="' + f.id + '">' +
          '<div class="faq-move">' +
          '<button type="button" class="btn-move" data-act="up"' + (i === 0 ? " disabled" : "") + ' aria-label="위로">▲</button>' +
          '<button type="button" class="btn-move" data-act="down"' + (i === rows.length - 1 ? " disabled" : "") + ' aria-label="아래로">▼</button>' +
          "</div>" +
          '<div class="item-main">' +
          '<div class="item-title">' + esc(f.question) + "</div>" +
          '<div class="item-meta">' +
          "<span>" + esc(faqZoneLabel(z)) + "</span>" +
          (f.show_on_home ? '<span class="pill pill-star">홈 화면에도 표시</span>' : "") +
          (!f.published ? '<span class="pill pill-draft">숨김</span>' : "") +
          "</div></div>" +
          '<div class="item-actions">' +
          '<button type="button" class="btn-secondary btn-sm" data-act="edit">수정</button>' +
          '<button type="button" class="btn-danger btn-sm" data-act="del">삭제</button>' +
          "</div></div>";
      });
    });
    list.innerHTML = html || '<p class="empty-note">아직 질문이 없어요. "새 질문 쓰기"를 눌러 시작해 보세요.</p>';

    list.querySelectorAll(".item-row").forEach(function (row) {
      var id = Number(row.getAttribute("data-id"));
      var faq = faqs.find(function (f) { return f.id === id; });
      row.querySelector('[data-act="edit"]').addEventListener("click", function () { location.hash = "#/faqs/" + id; });
      row.querySelector('[data-act="del"]').addEventListener("click", function () {
        confirmModal({
          title: "정말 삭제할까요?",
          body: '"' + (faq.question || "") + '" 질문이 완전히 지워져요. 되돌릴 수 없습니다.',
          confirmLabel: "삭제", danger: true
        }).then(function (ok) {
          if (!ok) return;
          sb.from("faqs").delete().eq("id", id).then(function (res) {
            if (res.error) { dbError(res.error, "삭제하지 못했어요"); return; }
            toast("삭제되었습니다");
            viewFaqs();
          });
        });
      });
      row.querySelectorAll(".btn-move").forEach(function (btn) {
        btn.addEventListener("click", function () {
          moveFaq(faqs, faq, btn.getAttribute("data-act") === "up" ? -1 : 1);
        });
      });
    });
  }

  // 묶음 안에서 앞뒤 자리 바꾸기 (G-3).
  // ⚠ 옛 방식은 그 묶음만 0,1,2,3… 으로 새로 번호를 매겼는데, 홈페이지의 "전체" 목록은
  //   묶음 구분 없이 순서 번호대로 나열한다 → 손대지 않은 다른 묶음 질문들의 노출 순서가
  //   통째로 밀렸다. 그래서 **그 묶음이 원래 쓰던 번호들을 그대로 다시 나눠 갖는 방식**으로
  //   바꾼다. 번호의 모음(집합)이 그대로라 다른 묶음과의 앞뒤 관계가 전혀 흔들리지 않는다.
  function moveFaq(faqs, faq, dir) {
    var rows = faqs.filter(function (f) { return f.zone_id === faq.zone_id; });
    var idx = rows.indexOf(faq);
    var to = idx + dir;
    if (idx === -1 || to < 0 || to >= rows.length) return;
    var tmp = rows[idx]; rows[idx] = rows[to]; rows[to] = tmp;
    // 이 묶음이 쓰던 번호들 (작은 것부터) — 같은 번호가 겹쳐 있으면 최소한으로만 벌린다
    var slots = rows.map(function (f) { return Number(f.sort_order) || 0; }).sort(function (a, b) { return a - b; });
    for (var s = 1; s < slots.length; s++) {
      if (slots[s] <= slots[s - 1]) slots[s] = slots[s - 1] + 1;
    }
    var changes = [];
    rows.forEach(function (f, i) {
      if (f.sort_order !== slots[i]) changes.push({ id: f.id, sort_order: slots[i] });
    });
    if (!changes.length) { toast("순서가 그대로예요"); return; }
    Promise.all(changes.map(function (c) {
      return sb.from("faqs").update({ sort_order: c.sort_order }).eq("id", c.id).then(function (res) {
        if (res.error) throw res.error;
      });
    })).then(function () {
      toastView("순서를 바꿨어요 · 홈페이지에 바로 반영됐어요", "faqs");
      viewFaqs(); // 재로드로 정합 보증
    }).catch(function (err) {
      dbError(err, "순서를 바꾸지 못했어요");
      viewFaqs();
    });
  }

  function viewFaqEdit(id) {
    loadingView();
    var jobs = [
      loadZones(true),
      // 카테고리 맨 뒤 순서 계산용 최소 조회
      sb.from("faqs").select("id, zone_id, sort_order").then(function (res) {
        if (res.error) throw res.error;
        return res.data || [];
      })
    ];
    if (id) {
      jobs.push(sb.from("faqs").select("*").eq("id", id).single().then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      }));
    }
    Promise.all(jobs).then(function (results) {
      renderFaqForm(results[2] || null, results[1]);
    }).catch(loadFailView);
  }

  function renderFaqForm(faq, allFaqs) {
    var isEdit = !!faq;
    // 카테고리 select — 대표(faq_label 보유) zone 우선 표시
    var primaries = state.zones.filter(function (z) { return z.is_primary; });
    var others = state.zones.filter(function (z) { return !z.is_primary; });
    function zoneOpt(z) {
      return '<option value="' + z.id + '"' + (isEdit && faq.zone_id === z.id ? " selected" : "") + ">" +
        esc(faqZoneLabel(z)) + "</option>";
    }
    var zoneOptions = '<option value="">카테고리를 골라 주세요</option>' +
      primaries.map(zoneOpt).join("") + others.map(zoneOpt).join("");

    root().innerHTML =
      backLink("#/faqs", "질문 목록으로") +
      '<h1 class="view-title">' + (isEdit ? "질문 수정" : "새 질문 쓰기") + "</h1>" +
      '<div class="card">' +
      '<div class="field"><label for="faq-q">질문</label>' +
      '<input type="text" id="faq-q" maxlength="200" value="' + esc(isEdit ? faq.question : "") + '" placeholder="예: 치료 기간은 얼마나 걸리나요?"></div>' +
      '<div class="field"><label for="faq-a">답변</label>' +
      '<textarea id="faq-a" maxlength="2000" placeholder="답변을 적어 주세요. 줄을 바꾸면 홈페이지에서도 줄이 바뀌어요.">' + esc(isEdit ? faq.answer : "") + '</textarea>' +
      '<p class="help">2,000자까지 쓸 수 있어요.</p></div>' +
      '<div class="field"><label for="faq-zone">카테고리</label>' +
      '<select id="faq-zone">' + zoneOptions + "</select>" +
      '<p class="help">자주 묻는 질문 페이지의 묶음이에요. 대표 분야가 위쪽에 나와요.</p></div>' +
      '<div class="field"><label class="switch"><input type="checkbox" id="faq-home"' +
      (isEdit && faq.show_on_home ? " checked" : "") + '><span class="slider"></span>' +
      '<span class="switch-label">홈 화면에도 보이기</span></label>' +
      '<p class="help">홈 첫 화면 "자주 묻는 질문"에도 나와요 (최대 4개).</p></div>' +
      '<p class="field-error hidden" id="faq-form-error"></p>' +
      '<div class="form-actions"><button type="button" class="btn-primary" id="faq-save">저장하기</button></div>' +
      "</div>";
    bindNav(root());

    byId("faq-save").addEventListener("click", function () {
      var btn = this;
      showFormError("faq-form-error", null);
      var q = byId("faq-q").value.trim();
      var a = byId("faq-a").value.trim();
      var zoneId = Number(byId("faq-zone").value) || null;
      if (!q) { showFormError("faq-form-error", "질문을 입력해 주세요."); return; }
      if (!a) { showFormError("faq-form-error", "답변을 입력해 주세요."); return; }
      if (!zoneId) { showFormError("faq-form-error", "카테고리를 골라 주세요."); return; }
      var payload = { zone_id: zoneId, question: q, answer: a, show_on_home: byId("faq-home").checked };
      // 새 질문·카테고리 이동 → 해당 카테고리 맨 뒤 순서
      if (!isEdit || faq.zone_id !== zoneId) {
        var max = -1;
        (allFaqs || []).forEach(function (f) {
          if (f.zone_id === zoneId && (!isEdit || f.id !== faq.id) && f.sort_order > max) max = f.sort_order;
        });
        payload.sort_order = max + 1;
      }
      busy(btn, true, "저장 중…");
      var qy = isEdit ? sb.from("faqs").update(payload).eq("id", faq.id) : sb.from("faqs").insert(payload);
      qy.then(function (res) {
        busy(btn, false);
        if (res.error) { dbError(res.error); return; }
        toastView("저장했어요 · 홈페이지에 바로 반영됐어요", "faqs");
        location.hash = "#/faqs";
      });
    });
  }

  /* ════════════════════════ 후기 관리 (§56 하드 게이트) ════════════════════════ */

  function viewReviews() {
    loadingView();
    Promise.all([
      loadZones(true),
      sb.from("reviews").select("*").order("sort_order").order("id").then(function (res) {
        if (res.error) throw res.error;
        return res.data || [];
      })
    ]).then(function (results) {
      renderReviewList(results[1]);
    }).catch(loadFailView);
  }

  function renderReviewList(reviews) {
    var html =
      backLink("#/manage", "관리 목록으로") +
      '<h1 class="view-title">후기 관리</h1>' +
      '<p class="view-desc">홈페이지 후기 카드예요. 의료광고법 때문에 치료 경험담이 아니라 ' +
      '<b>진료 프로그램을 소개하는 글</b>로 써 주세요.</p>' +
      whereNote("reviews") +
      '<div class="topbar"><span></span>' +
      '<button type="button" class="btn-primary" data-nav="#/reviews/new">+ 새 후기 카드 쓰기</button>' +
      "</div><div id=\"reviews-list\"></div>";
    root().innerHTML = html;
    bindNav(root());

    var list = byId("reviews-list");
    if (!reviews.length) {
      list.innerHTML = '<p class="empty-note">아직 후기 카드가 없어요.</p>';
      return;
    }
    list.innerHTML = reviews.map(function (r) {
      var text = r.title || r.body || "";
      if (text.length > 40) text = text.slice(0, 40) + "…";
      return '<div class="item-row" data-id="' + r.id + '">' +
        '<div class="item-main">' +
        '<div class="item-title">' + esc(text) + "</div>" +
        '<div class="item-meta">' +
        '<span class="pill ' + (r.published ? "pill-live" : "pill-draft") + '">' + (r.published ? "발행 중" : "임시저장") + "</span>" +
        (r.is_highlight ? '<span class="pill pill-star">홈 화면 강조</span>' : "") +
        (r.zone_id ? "<span>" + esc(zoneName(r.zone_id)) + "</span>" : "") +
        ((r.labels || []).length ? "<span>" + esc((r.labels || []).join(", ")) + "</span>" : "") +
        "</div></div>" +
        '<div class="item-actions">' +
        '<button type="button" class="btn-secondary btn-sm" data-act="edit">수정</button>' +
        '<button type="button" class="btn-danger btn-sm" data-act="del">삭제</button>' +
        "</div></div>";
    }).join("");

    list.querySelectorAll(".item-row").forEach(function (row) {
      var id = Number(row.getAttribute("data-id"));
      var review = reviews.find(function (r) { return r.id === id; });
      row.querySelector('[data-act="edit"]').addEventListener("click", function () { location.hash = "#/reviews/" + id; });
      row.querySelector('[data-act="del"]').addEventListener("click", function () {
        confirmModal({
          title: "정말 삭제할까요?",
          body: "이 후기 카드가 완전히 지워져요. 되돌릴 수 없습니다.",
          confirmLabel: "삭제", danger: true
        }).then(function (ok) {
          if (!ok) return;
          sb.from("reviews").delete().eq("id", id).then(function (res) {
            if (res.error) { dbError(res.error, "삭제하지 못했어요"); return; }
            toast("삭제되었습니다");
            viewReviews();
          });
        });
      });
    });
  }

  function viewReviewEdit(id) {
    loadingView();
    var jobs = [loadZones(true)];
    if (id) {
      jobs.push(sb.from("reviews").select("*").eq("id", id).single().then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      }));
    }
    Promise.all(jobs).then(function (results) {
      renderReviewForm(results[1] || null);
    }).catch(loadFailView);
  }

  function reviewGuideBox() {
    return '<div class="guide-box">' +
      '<div class="guide-head">후기 카드, 이렇게 써 주세요</div>' +
      '<div class="guide-cols">' +
      '<div class="guide-col guide-bad"><h3>이렇게 쓰면 안 돼요 (의료광고법 위반)</h3><ul>' +
      "<li>&ldquo;13kg 뺐어요&rdquo; &mdash; 수치로 효과 자랑</li>" +
      "<li>&ldquo;임신에 성공했습니다&rdquo; &mdash; 결과 단정</li>" +
      "<li>&ldquo;일주일만에 나았어요&rdquo; &mdash; 기간 강조</li>" +
      "<li>&ldquo;부작용 없이 완치&rdquo; &mdash; 안전·완치 보장</li>" +
      "</ul></div>" +
      '<div class="guide-col guide-good"><h3>이렇게 쓰세요 (프로그램 안내)</h3><ul>' +
      "<li>&ldquo;체질 맞춤 다이어트 프로그램 안내&rdquo;</li>" +
      "<li>&ldquo;난임 한방 진료 안내 &mdash; 부부 동반 상담 가능&rdquo;</li>" +
      "<li>&ldquo;통증 질환 한방 치료 안내 &mdash; 침·약침·추나 병행&rdquo;</li>" +
      "</ul></div></div>" +
      '<div class="guide-foot">방송 출연·유명인 방문·보유하지 않은 장비 이야기는 사실이 아니면 쓸 수 없어요. ' +
      "환자분의 생생한 원문 후기는 홈페이지 대신 네이버플레이스 링크(더보기)로 연결돼요.</div></div>";
  }

  function renderReviewForm(review) {
    var isEdit = !!review;
    var zoneOptions = '<option value="">고르지 않아도 돼요</option>' + state.zones.map(function (z) {
      return '<option value="' + z.id + '"' + (isEdit && review.zone_id === z.id ? " selected" : "") + ">" + esc(z.name) + "</option>";
    }).join("");

    root().innerHTML =
      backLink("#/reviews", "후기 목록으로") +
      '<h1 class="view-title">' + (isEdit ? "후기 카드 수정" : "새 후기 카드") + "</h1>" +
      reviewGuideBox() +
      '<div class="card">' +
      '<div class="field"><label for="rv-title">제목 <span style="font-weight:400;color:var(--muted)">(선택 — 카드 목록에 크게 표시)</span></label>' +
      '<input type="text" id="rv-title" maxlength="120" value="' + esc(isEdit ? review.title || "" : "") + '" placeholder="예: 체질 맞춤 다이어트 프로그램 안내"></div>' +
      '<div class="field"><label for="rv-body">내용</label>' +
      '<textarea id="rv-body" maxlength="2000" placeholder="프로그램을 소개하는 문장으로 적어 주세요.">' + esc(isEdit ? review.body || "" : "") + '</textarea>' +
      '<p class="help">2,000자까지 쓸 수 있어요.</p></div>' +
      '<div class="field"><label for="rv-labels">카드 라벨 <span style="font-weight:400;color:var(--muted)">(선택 — 쉼표로 구분, 최대 2개)</span></label>' +
      '<input type="text" id="rv-labels" maxlength="200" value="' + esc(isEdit ? (review.labels || []).join(", ") : "") + '" placeholder="예: 여성질환, 난임">' +
      '<p class="field-error hidden" id="rv-labels-error"></p></div>' +
      '<div class="field"><label for="rv-zone">진료 분야 <span style="font-weight:400;color:var(--muted)">(선택)</span></label>' +
      '<select id="rv-zone">' + zoneOptions + "</select></div>" +
      '<div class="field"><label for="rv-url">더보기 링크 <span style="font-weight:400;color:var(--muted)">(선택)</span></label>' +
      '<input type="url" id="rv-url" maxlength="500" value="' + esc(isEdit ? review.more_url || "" : "") + '" placeholder="https:// 로 시작하는 주소">' +
      '<p class="help">비워 두면 병원 정보에 저장된 네이버플레이스 후기 주소로 연결돼요.</p></div>' +
      '<div class="field"><label class="switch"><input type="checkbox" id="rv-highlight"' +
      (isEdit && review.is_highlight ? " checked" : "") + '><span class="slider"></span>' +
      '<span class="switch-label">홈 화면에도 크게 보여주기</span></label></div>' +
      '<div class="field"><label for="rv-order">표시 순서 <span style="font-weight:400;color:var(--muted)">(선택)</span></label>' +
      '<input type="number" id="rv-order" value="' + (isEdit ? review.sort_order : 0) + '" style="max-width:140px">' +
      '<p class="help">숫자가 작을수록 앞에 나와요.</p></div>' +
      '<p class="field-error hidden" id="rv-form-error"></p>' +
      '<div class="form-actions" id="rv-actions"></div>' +
      "</div>";
    bindNav(root());

    var bodyEl = byId("rv-body");
    var titleEl = byId("rv-title");
    var labelsEl = byId("rv-labels");

    function parseLabels() {
      return labelsEl.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    }

    function labelsValid() {
      var labels = parseLabels();
      if (labels.length > 2) {
        byId("rv-labels-error").textContent = "라벨은 최대 2개까지만 넣을 수 있어요. 쉼표 개수를 확인해 주세요.";
        byId("rv-labels-error").classList.remove("hidden");
        return false;
      }
      byId("rv-labels-error").classList.add("hidden");
      return true;
    }

    labelsEl.addEventListener("input", labelsValid);

    var actions = byId("rv-actions");
    if (isEdit && review.published) {
      actions.innerHTML =
        '<button type="button" class="btn-primary" id="rv-save-live">저장하기</button>' +
        '<button type="button" class="btn-ghost" id="rv-unpublish">발행 중지</button>';
      byId("rv-save-live").addEventListener("click", function () { saveReview(review, true, this); });
      byId("rv-unpublish").addEventListener("click", function () {
        var self = this;
        confirmModal({
          title: "발행을 중지할까요?",
          body: "홈페이지에서 이 후기 카드가 안 보이게 돼요. 카드는 지워지지 않고 임시저장으로 남아요.",
          confirmLabel: "발행 중지"
        }).then(function (ok) { if (ok) saveReview(review, false, self); });
      });
    } else {
      actions.innerHTML =
        '<button type="button" class="btn-secondary" id="rv-draft">임시저장</button>' +
        '<button type="button" class="btn-primary" id="rv-publish">발행하기</button>';
      byId("rv-draft").addEventListener("click", function () { saveReview(review, false, this); });
      byId("rv-publish").addEventListener("click", function () { saveReview(review, true, this); });
    }

    function saveReview(existing, publish, btn) {
      showFormError("rv-form-error", null);
      if (!labelsValid()) return;
      var body = bodyEl.value.trim();
      if (!body) { showFormError("rv-form-error", "내용을 입력해 주세요."); return; }

      // lint 필드(lint_passed 등)는 더 이상 기록하지 않음 — 기존 DB 값은 그대로 둠
      // (사용자 결단 2026-07-22 lint 전면 제거. 발행 조건 = 내용 비어있음 체크만)
      var payload = {
        zone_id: Number(byId("rv-zone").value) || null,
        title: titleEl.value.trim() || null,
        body: body,
        labels: parseLabels(),
        more_url: byId("rv-url").value.trim() || null,
        is_highlight: byId("rv-highlight").checked,
        sort_order: Number(byId("rv-order").value) || 0,
        published: publish
      };

      busy(btn, true, "저장 중…");
      var q = existing
        ? sb.from("reviews").update(payload).eq("id", existing.id)
        : sb.from("reviews").insert(payload);
      q.then(function (res) {
        busy(btn, false);
        if (res.error) { dbError(res.error); return; }
        if (publish) toastView("발행되었습니다. 홈페이지에 반영돼요.", "reviews");
        else toast("임시저장되었습니다. 홈페이지에는 아직 안 보여요.");
        location.hash = "#/reviews";
      });
    }
  }

  /* ════════════════════════ 병원 정보 (site_settings) ════════════════════════ */

  var SETTINGS_GROUPS = [
    { key: "contact", title: "연락처·주소" },
    { key: "hours", title: "진료시간" },
    { key: "links", title: "누르면 열리는 주소" },
    { key: "company", title: "사업자 정보" },
    { key: "general", title: "기본 정보" }
  ];

  /* G-2 — 화면에 보이는 이름은 원장이 쓰는 말로. (저장된 이름에는 "CTA"·"URL" 같은 말이 섞여
   * 있고, 같은 항목을 미리보기 편집기는 이미 친절한 이름으로 부른다 → 이름이 화면마다 달랐다.)
   * ⚠ 저장된 값은 건드리지 않고 **보여줄 때만** 바꾼다. 아래 이름은 미리보기 편집기(필드 지도)의
   *    이름과 글자까지 똑같아야 한다. 목록에 없는 항목은 저장된 이름을 그대로 쓴다. */
  var SETTINGS_LABELS = {
    clinic_name: "의원 이름",
    phone: "대표 전화번호",
    hours_weekday: "평일 진료시간",
    hours_weekend: "주말·공휴일 진료시간",
    hours_lunch: "점심시간",
    hours_note: "진료시간 아래 안내 문구",
    address: "병원 주소",
    address_sub: "주소 아래 오시는 길 안내",
    representative: "대표자 이름",
    biz_reg_no: "사업자등록번호",
    link_reserve: "진료예약 링크 주소",
    link_tel: "전화 걸기 링크 주소",
    link_kakao: "카카오톡 상담 링크 주소",
    link_naver_booking: "네이버 예약 링크 주소",
    naver_map_url: "네이버 길찾기 링크 주소",
    naver_place_review_url: "네이버 플레이스 후기 링크 주소"
  };
  // 항목마다 "어디에 쓰이나요?" 한 줄 (링크 항목은 헷갈리기 쉬워 특히 필요)
  var SETTINGS_HINTS = {
    link_reserve: "\"빠른 진료예약\" 버튼을 눌렀을 때 열리는 주소예요.",
    link_tel: "\"전화 걸기\" 버튼을 눌렀을 때 걸리는 번호예요. 대표 전화번호를 바꾸면 이 번호도 함께 맞춰 주세요.",
    link_kakao: "카카오톡 상담 버튼을 눌렀을 때 열리는 주소예요.",
    link_naver_booking: "네이버 예약 버튼을 눌렀을 때 열리는 주소예요.",
    naver_map_url: "길찾기 버튼을 눌렀을 때 열리는 지도 주소예요.",
    naver_place_review_url: "\"후기 더보기\"를 눌렀을 때 열리는 주소예요."
  };
  function settingLabel(row) {
    return SETTINGS_LABELS[row.key] || row.label || row.key;
  }

  function viewSettings() {
    loadingView();
    sb.from("site_settings").select("*").order("key").then(function (res) {
      if (res.error) throw res.error;
      renderSettings(res.data || []);
    }).catch(loadFailView);
  }

  var SETTINGS_VALUE_MAX = 300;   // F-7 — 붙여넣기 사고 대비 상한

  function renderSettings(rows) {
    var original = {};
    rows.forEach(function (r) { original[r.key] = r.value; });

    var html =
      backLink("#/manage", "관리 목록으로") +
      '<h1 class="view-title">병원 정보</h1>' +
      '<p class="view-desc">홈페이지 곳곳(전화번호·진료시간·주소·예약 버튼)에 쓰이는 정보예요. ' +
      '바꾼 뒤 아래 <b>저장하기</b>를 꼭 눌러 주세요.</p>' +
      whereNote("settings");

    SETTINGS_GROUPS.forEach(function (group) {
      var groupRows = rows.filter(function (r) { return r.group_name === group.key && !/^theme_/.test(r.key); });
      if (!groupRows.length) return;
      html += '<div class="settings-group"><h2>' + esc(group.title) + '</h2><div class="card">';
      groupRows.forEach(function (r) {
        if (/^theme_/.test(r.key)) return;   // 색·글씨는 전용 화면(#/design)에서 고른다 — 여기 원문 키 노출 금지
        var hint = SETTINGS_HINTS[r.key];
        html += '<div class="field"><label for="set-' + esc(r.key) + '">' + esc(settingLabel(r)) + "</label>" +
          '<input type="text" id="set-' + esc(r.key) + '" data-key="' + esc(r.key) + '" value="' + esc(r.value) + '"' +
          ' maxlength="' + SETTINGS_VALUE_MAX + '"' +
          (group.key === "links" ? ' placeholder="아직 없으면 비워 두세요"' : "") + ">" +
          (hint ? '<p class="help">' + esc(hint) + "</p>" : "") +
          "</div>";
      });
      html += "</div></div>";
    });

    html += '<div class="save-bar"><button type="button" class="btn-primary" id="settings-save">저장하기</button></div>';
    root().innerHTML = html;
    bindNav(root());

    byId("settings-save").addEventListener("click", function () {
      var btn = this;
      var changed = [];
      root().querySelectorAll("input[data-key]").forEach(function (input) {
        var key = input.getAttribute("data-key");
        if (input.value !== original[key]) changed.push({ key: key, value: input.value });
      });
      if (!changed.length) { toast("바뀐 내용이 없어요"); return; }
      busy(btn, true, "저장 중…");
      Promise.all(changed.map(function (c) {
        return sb.from("site_settings").update({ value: c.value }).eq("key", c.key).then(function (res) {
          if (res.error) throw res.error;
        });
      })).then(function () {
        busy(btn, false);
        var phoneChange = changed.filter(function (c) { return c.key === "phone"; })[0];
        var telChanged = changed.some(function (c) { return c.key === "link_tel"; });
        var oldPhone = phoneChange ? original.phone : "";
        changed.forEach(function (c) { original[c.key] = c.value; });
        toastView("저장했어요 · 홈페이지에 바로 반영됐어요 (" + changed.length + "개 항목)", "settings");
        // G-1 — 표시 번호를 바꿨으면 "전화 걸기" 번호도 어긋나지 않게 맞춘다
        if (phoneChange && !telChanged) syncTelLinkOnSettings(oldPhone, phoneChange.value, original);
      }).catch(function (err) {
        busy(btn, false);
        dbError(err);
      });
    });
  }

  // 병원 정보 화면에서 전화번호를 바꾼 뒤 — 거는 번호(전화 걸기 주소) 맞추기 (G-1)
  function syncTelLinkOnSettings(oldPhone, newPhone, original) {
    var link = byId("set-link_tel");
    var linkVal = link ? link.value : String(original.link_tel == null ? "" : original.link_tel);
    var newDigits = digitsOf(newPhone);
    if (!newDigits || digitsOf(linkVal) === newDigits) return;
    var nextLink = "tel:" + String(newPhone).trim();
    function apply(quiet) {
      settingsUpsert({ key: "link_tel", value: nextLink }).then(function (res) {
        if (res.error) { dbError(res.error); return; }
        original.link_tel = nextLink;
        if (link) link.value = nextLink;
        editBaseline["settings:link_tel"] = nextLink;
        toast(quiet ? "전화 걸기 버튼도 새 번호로 함께 바꿨어요" : "전화 걸기 버튼도 새 번호로 바꿨어요");
      });
    }
    // 거는 번호가 옛 번호 그대로였다면 그냥 함께 맞춘다 (따로 정해 둔 번호면 물어본다)
    if (!linkVal || (digitsOf(oldPhone) && digitsOf(linkVal) === digitsOf(oldPhone))) { apply(true); return; }
    confirmModal({
      title: "전화 걸기 버튼도 바꿀까요?",
      body: "홈페이지의 \"전화 걸기\" 버튼은 지금 " + shortText(linkVal.replace(/^tel:/, ""), 30) +
        " 로 연결돼요. 방금 바꾼 번호로 함께 맞출까요?",
      confirmLabel: "함께 바꾸기",
      cancelLabel: "그대로 두기"
    }).then(function (ok) { if (ok) apply(false); });
  }

  /* ════════════════════════ 비밀번호 변경 ════════════════════════ */

  function viewPassword() {
    root().innerHTML =
      backLink("#/live", "홈페이지 보며 수정으로") +
      '<h1 class="view-title">비밀번호 변경</h1>' +
      '<p class="view-desc">이 관리자 화면에 <b>로그인할 때 쓰는 비밀번호</b>를 바꿉니다.</p>' +
      '<div class="card" style="max-width:480px">' +
      '<div class="field"><label for="pw-new">새 비밀번호</label>' +
      '<input type="password" id="pw-new" autocomplete="new-password" placeholder="8자 이상">' +
      '<p class="help">다른 사람이 알기 어렵게 8자 이상으로 정해 주세요.</p></div>' +
      '<div class="field"><label for="pw-confirm">새 비밀번호 다시 입력</label>' +
      '<input type="password" id="pw-confirm" autocomplete="new-password" placeholder="위와 똑같이 입력">' +
      '<p class="field-error hidden" id="pw-error"></p></div>' +
      '<div class="form-actions"><button type="button" class="btn-primary" id="pw-save">비밀번호 바꾸기</button></div>' +
      "</div>";
    bindNav(root());

    byId("pw-save").addEventListener("click", function () {
      var btn = this;
      var pw1 = byId("pw-new").value;
      var pw2 = byId("pw-confirm").value;
      var errEl = byId("pw-error");
      errEl.classList.add("hidden");
      function fail(message) { errEl.textContent = message; errEl.classList.remove("hidden"); }
      if (pw1.length < 8) { fail("비밀번호는 8자 이상으로 정해 주세요."); return; }
      if (pw1 !== pw2) { fail("두 칸에 입력한 비밀번호가 서로 달라요. 똑같이 입력해 주세요."); return; }
      busy(btn, true, "바꾸는 중…");
      sb.auth.updateUser({ password: pw1 }).then(function (res) {
        busy(btn, false);
        if (res.error) {
          var m = (res.error.message || "").toLowerCase();
          if (m.indexOf("different from the old") !== -1 || m.indexOf("same password") !== -1) {
            fail("지금 쓰는 비밀번호와 같아요. 다른 비밀번호로 정해 주세요.");
          } else if (m.indexOf("at least") !== -1) {
            fail("비밀번호가 너무 짧아요. 더 길게 정해 주세요.");
          } else {
            fail("비밀번호를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.");
          }
          return;
        }
        toast("비밀번호가 바뀌었어요. 다음 로그인부터 새 비밀번호를 쓰세요.");
        location.hash = "#/";
      });
    });
  }
})();
