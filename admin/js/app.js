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
    if (m.indexOf("fetch") !== -1 || m.indexOf("network") !== -1) {
      toast(base + ". 인터넷 연결을 확인하고 다시 시도해 주세요.", "error");
    } else {
      toast(base + ". 다시 시도해 주세요. 계속 안 되면 관리 담당자(GUAVA)에게 알려 주세요.", "error");
    }
    if (error) console.error("[admin] DB error:", error);
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

  // 파일/Blob → storage zia-media 업로드 → { path, url }. 경로 = {folder}/{timestamp}-{rand}.{ext}
  function uploadImage(blob, folder) {
    var type = blob.type || "";
    var ext = IMG_EXT[type];
    if (!ext) return Promise.reject(new Error("unsupported image type: " + type));
    var path = folder + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
    return sb.storage.from("zia-media").upload(path, blob, { contentType: type, cacheControl: "3600" })
      .then(function (res) {
        if (res.error) throw res.error;
        return { path: path, url: storagePublicUrl(path) };
      });
  }

  // 드래그&드롭 + 클릭 파일선택 공용 배선. onFiles = 이미지 파일 배열 콜백
  function bindDropUpload(dropEl, inputEl, onFiles) {
    function pick(list) {
      var files = Array.prototype.filter.call(list || [], function (f) { return IMG_EXT[f.type]; });
      if (files.length) onFiles(files);
      else toast("이미지 파일(jpg·png 등)만 넣을 수 있어요", "error");
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
    function draw(uploading) {
      container.innerHTML =
        '<div class="img-drop' + (current ? " has-img" : "") + '">' +
        (current && !uploading
          ? '<img class="img-drop-preview" src="' + esc(adminImageUrl(current)) + '" alt="">'
          : "") +
        '<span class="img-drop-hint">' +
        (uploading ? "사진 올리는 중…" : current ? "사진을 끌어다 놓거나 눌러서 바꾸기" : esc(opts.emptyText || "사진을 끌어다 놓거나 눌러서 고르기")) +
        "</span></div>" +
        (current && !uploading ? '<button type="button" class="btn-ghost btn-sm img-drop-clear">사진 빼기</button>' : "") +
        '<input type="file" accept="image/*" class="hidden">';
      var drop = container.querySelector(".img-drop");
      var input = container.querySelector("input[type=file]");
      bindDropUpload(drop, input, function (files) {
        draw(true);
        uploadImage(files[0], opts.folder).then(function (up) {
          current = up.path;
          draw(false);
          opts.onChange(current);
        }).catch(function (err) {
          console.error("[admin] upload error:", err);
          toast("사진을 올리지 못했어요. 다시 시도해 주세요.", "error");
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

  /* ════════════════════════ 자세히 관리 (메뉴판 — #/manage) ════════════════════════ */

  // P3-f: 첫 화면에서 내려온 메뉴판. 기능은 그대로 — 라이브 화면 툴바 "자세히 관리"로 들어온다.
  function viewDashboard() {
    root().innerHTML =
      backLink("#/live", "홈페이지 보며 수정으로") +
      '<h1 class="view-title">자세히 관리</h1>' +
      '<p class="view-desc">홈페이지에서 바로 고치기 어려운 것(발행·순서·묶음 관리)은 여기서 해요.</p>' +
      '<div class="dash-grid">' +
      dashCard("#/zones", "분", "진료 분야 관리", "홈페이지에 보여줄 진료 분야를 켜고 끕니다") +
      dashCard("#/home", "홈", "홈 화면 관리", "홈 첫 화면 칸에 보여줄 글을 골라 담습니다") +
      dashCard("#/posts", "글", "글 관리", "블로그 글을 붙여넣어 올리고 고칩니다") +
      dashCard("#/faqs", "질", "자주 묻는 질문", "질문·답변을 쓰고 순서를 바꿉니다") +
      dashCard("#/reviews", "후", "후기 관리", "후기 카드를 쓰고 발행합니다") +
      dashCard("#/settings", "정", "병원 정보", "전화번호·진료시간·주소를 바꿉니다") +
      "</div>";
    bindNav(root());
    root().querySelectorAll(".dash-card").forEach(function (card) {
      card.addEventListener("click", function (e) {
        e.preventDefault();
        location.hash = card.getAttribute("data-nav");
      });
    });
  }

  function dashCard(hash, icon, title, desc) {
    return '<a href="' + esc(hash) + '" class="dash-card" data-nav="' + esc(hash) + '">' +
      '<div class="dash-icon">' + esc(icon) + "</div>" +
      "<h2>" + esc(title) + "</h2><p>" + esc(desc) + "</p></a>";
  }

  /* ════════════════════════ 홈페이지 보며 수정 (#/live — P3-f 전폭 캔버스) ════════════════════════ */

  var liveDevice = "pc";        // PC/휴대폰 폭 토글 (세션 내 유지)
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
      '<button type="button" class="btn-ghost btn-sm" id="live-open">새 창에서 열기</button>' +
      '<button type="button" class="btn-secondary btn-sm" id="live-manage">자세히 관리</button>' +
      '<button type="button" class="btn-secondary btn-sm" id="live-panel-btn">사진·글 모음</button>' +
      "</div>" +
      '<div class="live-body">' +
      '<div class="live-canvas">' +
      '<div id="live-wrap" class="live-frame-wrap' + (liveDevice === "mobile" ? " mobile" : "") + '">' +
      '<iframe id="live-frame" src="' + esc(src) + '" title="홈페이지 미리보기"></iframe></div>' +
      "</div>" +
      libraryPanelHtml() +
      "</div></div>";
    bindNav(root());

    byId("live-page").addEventListener("change", function () {
      location.hash = "#/live?page=" + encodeURIComponent(this.value); // 화면 전환 시 focus 해제
    });
    function setDevice(mode) {
      liveDevice = mode;
      byId("live-wrap").classList.toggle("mobile", mode === "mobile");
      byId("live-pc").classList.toggle("active", mode === "pc");
      byId("live-mobile").classList.toggle("active", mode === "mobile");
    }
    byId("live-pc").addEventListener("click", function () { setDevice("pc"); });
    byId("live-mobile").addEventListener("click", function () { setDevice("mobile"); });
    byId("live-open").addEventListener("click", function () {
      window.open(plainSrc, "_blank", "noopener"); // 상대경로 — 현 문서(admin/) 기준 해석
    });
    byId("live-manage").addEventListener("click", function () { location.hash = "#/manage"; });
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
  }

  /* ── 미리보기가 보내는 신호 (계약 v2 §6 자식→부모) ── */

  function onEditReady() {
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
            files.push({
              type: "photo", path: full,
              label: (STORAGE_FOLDER_LABEL[prefix] || "올린 사진") + (o.created_at ? " · " + shortDate(o.created_at) : ""),
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
        if (hint) hint.textContent = "사진 올리는 중… (" + files.length + "장)";
        Promise.all(files.map(function (f) { return uploadImage(f, "home"); }))
          .then(function () {
            libCache.photo = null;   // 다시 불러오기
            toast("사진을 올렸어요");
            if (libTab === "photo") drawLibBody();
          })
          .catch(function (err) {
            console.error("[admin] upload error:", err);
            toast("사진을 올리지 못했어요. 다시 시도해 주세요.", "error");
            if (hint) hint.textContent = "사진을 여기에 끌어다 놓거나, 눌러서 골라 올리세요";
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
  var MAX_UPLOAD_BYTES = 8 * 1024 * 1024;   // edit-overlay.js 와 같은 한도

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
    if (up.size && up.size > MAX_UPLOAD_BYTES) { fail("사진이 너무 커요. 8MB보다 작은 사진으로 올려 주세요."); return; }
    liveStatus("사진 올리는 중…");
    dataUrlToBlob(up.dataUrl)
      .then(function (blob) { return uploadImage(blob, "home"); })
      .then(function (res) {
        libCache.photo = null;               // 모음 다시 불러오기
        if (libTab === "photo" && byId("lib-body")) drawLibBody();
        liveStatus("사진을 올렸어요");
        sendToFrame("zia-edit-picked", {
          reqId: d.reqId, ok: true,
          item: { type: "photo", path: res.path, url: res.url, label: "올린 사진" }
        });
      })
      .catch(function (err) {
        console.error("[admin] 사진 올리기 실패:", err);
        fail("사진을 올리지 못했어요. jpg·png 사진으로 다시 시도해 주세요.");
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

  function onEditSave(d) {
    var reqId = d.reqId;
    var kind = ["text", "html", "image"].indexOf(d.kind) !== -1 ? d.kind : "text";
    var value = String(d.value == null ? "" : d.value);
    var target = d.target || {};
    var job, isSlot = false;
    if (target.fieldId) {
      // 홈 첫 화면 "칸 배치"(L2)는 쓰는 모양이 달라 전용 경로로 간다 (saveSlotTarget 주석)
      var def = fieldDef(target.fieldId);
      if (def && def.kind === "slot") { isSlot = true; job = saveSlotTarget(def, target, value); }
      else job = saveFieldTarget(target, value);
    }
    else if (target.override) job = saveOverrideTarget(target.override, kind, value);
    else job = Promise.reject(new Error("zia-no-target"));

    liveStatus("저장 중…");
    job.then(function (out) {
      var message = (isSlot && out && out.message) || "저장했어요";
      liveStatus(message);
      sendToFrame("zia-edit-saved", { reqId: reqId, ok: true, message: message, value: value });
    }).catch(function (err) {
      console.error("[admin] 그 자리에서 저장 실패:", err);
      var message = editSaveErrorMessage(err);
      liveStatus("저장하지 못했어요", true);
      toast(message, "error");
      sendToFrame("zia-edit-saved", { reqId: reqId, ok: false, message: message });
    });
  }

  // L1/L2 — 정본 표에 저장 (오버라이드로 정본을 덮지 않는다, 계약 §2)
  function saveFieldTarget(target, value) {
    var map = frameFieldMap();
    var def = map && map[target.fieldId];
    var src = def && def.source;
    if (!src || !src.table) return Promise.reject(new Error("zia-unknown-field"));

    if (src.table === "site_settings") {
      if (!src.key) return Promise.reject(new Error("zia-unknown-field"));
      return sb.from("site_settings").upsert({ key: src.key, value: value }, { onConflict: "key" }).then(chkRes);
    }
    if (!EDITABLE_ROW_TABLES[src.table] || !src.column) return Promise.reject(new Error("zia-unknown-field"));
    // 어느 줄인지는 미리보기가 알려 준다 (주입 시 심어 둔 값 — rowId / row.id 둘 다 받는다)
    var rowId = target.rowId != null ? target.rowId : (target.row && target.row.id);
    if (rowId == null || isNaN(Number(rowId))) return Promise.reject(new Error("zia-no-row"));
    var patch = {};
    patch[src.column] = value;
    return sb.from(src.table).update(patch).eq("id", Number(rowId)).then(chkRes);
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
  function saveSlotTarget(def, target, value) {
    var src = (def && def.source) || {};
    var slotNo = Number(src.slot);
    var zoneId = Number(target.rowId != null ? target.rowId : (target.row && target.row.id));
    var postId = Number(value);   // 0 = 이 칸 비우기
    if (!(slotNo >= 1 && slotNo <= HOME_SLOT_COUNT)) return Promise.reject(new Error("zia-unknown-field"));
    if (!zoneId) return Promise.reject(new Error("zia-no-row"));
    if (isNaN(postId) || postId < 0) return Promise.reject(new Error("zia-unknown-field"));

    var COLS = "id, zone_id, home_slot, published, title";
    // 1) 지금 이 칸에 있는 글부터 확인 (같은 분야·같은 칸은 최대 한 줄)
    return sb.from("posts").select(COLS).eq("zone_id", zoneId).eq("home_slot", slotNo).limit(1)
      .then(chkRes)
      .then(function (res) {
        var occupant = (res.data || [])[0] || null;
        if (!postId) {   // 빼기
          if (!occupant) return { message: "이 칸은 이미 비어 있어요." };
          return sb.from("posts").update({ home_slot: null }).eq("id", occupant.id).then(chkRes)
            .then(function () { return { message: "홈 화면에서 뺐어요. 글은 그대로 있어요." }; });
        }
        if (occupant && occupant.id === postId) return { message: "이미 이 칸에 있는 글이에요." };
        return sb.from("posts").select(COLS).eq("id", postId).limit(1).then(chkRes).then(function (r2) {
          var picked = (r2.data || [])[0] || null;
          if (!picked) throw ziaError("고른 글을 찾지 못했어요. 새로고침한 뒤 다시 해 주세요.");
          if (Number(picked.zone_id) !== zoneId) {
            throw ziaError("이 글은 다른 진료 분야의 글이에요. 이 자리에는 같은 분야의 글만 넣을 수 있어요.");
          }
          if (!picked.published) {
            throw ziaError("이 글은 아직 발행 전이에요. \"자세히 관리 → 글 관리\"에서 발행한 뒤에 홈 화면에 넣을 수 있어요.");
          }
          var clear = occupant
            ? sb.from("posts").update({ home_slot: null }).eq("id", occupant.id).then(chkRes)
            : Promise.resolve(null);
          return clear
            .then(function () {
              return sb.from("posts").update({ home_slot: slotNo }).eq("id", postId).then(chkRes);
            })
            .then(function () { return { message: "홈 화면에 담았어요. 바로 반영돼요." }; })
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

  // L3 — 어디에도 해당하지 않는 자리. page_overrides 표에 저장 (계약 §3)
  function saveOverrideTarget(ov, kind, value) {
    if (!ov || !ov.page || !ov.selector) return Promise.reject(new Error("zia-no-target"));
    return sb.from("page_overrides").upsert({
      page: String(ov.page),
      selector: String(ov.selector),
      kind: kind,
      value: value,
      anchor_hash: ov.anchorHash || null
    }, { onConflict: "page,selector" }).then(chkRes);
  }

  // 오류 → 원장이 읽는 한국어 안내 (전문용어 노출 금지)
  function editSaveErrorMessage(err) {
    if (err && err.ziaMessage) return err.ziaMessage;   // 원장에게 그대로 보여 줄 안내
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
      toastView("저장되었습니다", "zones");
      renderZoneList(state.zones);
    });
  }

  /* ════════════════════════ 글 관리 ════════════════════════ */

  var postsFilterZone = ""; // 목록 분야 필터 유지

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
      '<input type="text" id="post-title" value="' + esc(isEdit ? post.title : "") + '" placeholder="예: 반복되는 두근거림과 불안, 자율신경 불균형"></div>' +
      '<div class="field"><label for="post-zone">진료 분야</label>' +
      '<select id="post-zone">' + zoneOptions + "</select>" +
      '<p class="help">글 하나는 분야 하나에만 속해요. 분야를 바꾸면 아래 태그 선택이 초기화돼요.</p></div>' +
      '<div class="field"><label>태그</label><div id="post-tags" class="tag-checks"></div>' +
      '<p class="help">이 글과 관련 있는 태그에 표시해 주세요. 고른 분야의 태그만 나와요.</p></div>' +
      '<div class="field"><label for="post-badge">카드 라벨 <span style="font-weight:400;color:var(--muted)">(선택)</span></label>' +
      '<input type="text" id="post-badge" value="' + esc(isEdit ? post.badge || "" : "") + '" placeholder="예: 공황장애 — 홈페이지 카드에 크게 표시되는 짧은 말"></div>' +
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
      '<input type="url" id="post-url" value="' + esc(isEdit ? post.external_url || "" : "") + '" placeholder="https:// 로 시작하는 주소">' +
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

    function setUploadStatus() {
      statusEl.textContent = pendingUploads > 0 ? "사진 올리는 중… (" + pendingUploads + "장 남음)" : "";
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
        job.then(function (blob) { return uploadImage(blob, "posts"); })
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
      pendingUploads++;
      setUploadStatus();
      uploadImage(file, "posts").then(function (up) {
        insertHtmlAtCaret(editor, '<img src="' + esc(up.url) + '">');
      }).catch(function (err) {
        console.error("[admin] upload error:", err);
        toast("사진을 올리지 못했어요. 다시 시도해 주세요.", "error");
      }).then(function () { pendingUploads--; setUploadStatus(); });
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
      toastView("홈 화면에 담았어요. 바로 반영돼요.", "home");
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
          toastView("홈 화면에서 뺐어요. 글 자체는 그대로 있어요.", "home");
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

  // 카테고리 안 인접 순서 교환 → 위치 기준 sort_order 정규화 저장 (중복 sort_order 값에도 안전)
  function moveFaq(faqs, faq, dir) {
    var rows = faqs.filter(function (f) { return f.zone_id === faq.zone_id; });
    var idx = rows.indexOf(faq);
    var to = idx + dir;
    if (idx === -1 || to < 0 || to >= rows.length) return;
    var tmp = rows[idx]; rows[idx] = rows[to]; rows[to] = tmp;
    var changes = [];
    rows.forEach(function (f, i) {
      if (f.sort_order !== i) changes.push({ id: f.id, sort_order: i });
    });
    Promise.all(changes.map(function (c) {
      return sb.from("faqs").update({ sort_order: c.sort_order }).eq("id", c.id).then(function (res) {
        if (res.error) throw res.error;
      });
    })).then(function () {
      toastView("순서를 바꿨어요. 홈페이지에 바로 반영돼요.", "faqs");
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
      '<input type="text" id="faq-q" value="' + esc(isEdit ? faq.question : "") + '" placeholder="예: 치료 기간은 얼마나 걸리나요?"></div>' +
      '<div class="field"><label for="faq-a">답변</label>' +
      '<textarea id="faq-a" placeholder="답변을 적어 주세요. 줄을 바꾸면 홈페이지에서도 줄이 바뀌어요.">' + esc(isEdit ? faq.answer : "") + "</textarea></div>" +
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
        toastView("저장되었습니다. 홈페이지에 바로 반영돼요.", "faqs");
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
      '<input type="text" id="rv-title" value="' + esc(isEdit ? review.title || "" : "") + '" placeholder="예: 체질 맞춤 다이어트 프로그램 안내"></div>' +
      '<div class="field"><label for="rv-body">내용</label>' +
      '<textarea id="rv-body" placeholder="프로그램을 소개하는 문장으로 적어 주세요.">' + esc(isEdit ? review.body || "" : "") + "</textarea></div>" +
      '<div class="field"><label for="rv-labels">카드 라벨 <span style="font-weight:400;color:var(--muted)">(선택 — 쉼표로 구분, 최대 2개)</span></label>' +
      '<input type="text" id="rv-labels" value="' + esc(isEdit ? (review.labels || []).join(", ") : "") + '" placeholder="예: 여성질환, 난임">' +
      '<p class="field-error hidden" id="rv-labels-error"></p></div>' +
      '<div class="field"><label for="rv-zone">진료 분야 <span style="font-weight:400;color:var(--muted)">(선택)</span></label>' +
      '<select id="rv-zone">' + zoneOptions + "</select></div>" +
      '<div class="field"><label for="rv-url">더보기 링크 <span style="font-weight:400;color:var(--muted)">(선택)</span></label>' +
      '<input type="url" id="rv-url" value="' + esc(isEdit ? review.more_url || "" : "") + '" placeholder="https:// 로 시작하는 주소">' +
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
    { key: "links", title: "예약·상담 링크" },
    { key: "company", title: "사업자 정보" },
    { key: "general", title: "기본 정보" }
  ];

  function viewSettings() {
    loadingView();
    sb.from("site_settings").select("*").order("key").then(function (res) {
      if (res.error) throw res.error;
      renderSettings(res.data || []);
    }).catch(loadFailView);
  }

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
      var groupRows = rows.filter(function (r) { return r.group_name === group.key; });
      if (!groupRows.length) return;
      html += '<div class="settings-group"><h2>' + esc(group.title) + '</h2><div class="card">';
      groupRows.forEach(function (r) {
        html += '<div class="field"><label for="set-' + esc(r.key) + '">' + esc(r.label || r.key) + "</label>" +
          '<input type="text" id="set-' + esc(r.key) + '" data-key="' + esc(r.key) + '" value="' + esc(r.value) + '"' +
          (group.key === "links" ? ' placeholder="아직 없으면 비워 두세요"' : "") + ">" +
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
        changed.forEach(function (c) { original[c.key] = c.value; });
        toastView("저장되었습니다 (" + changed.length + "개 항목)", "settings");
      }).catch(function (err) {
        busy(btn, false);
        dbError(err);
      });
    });
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
