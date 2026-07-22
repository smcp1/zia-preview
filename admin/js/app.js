/* ============================================================================
 * app.js — 지아한의원 관리자 SPA
 *   원칙: 이용자 = 원장(비개발자). 전 화면 한국어 · 전문용어 0 · 실수 방지.
 *   기술: 순수 vanilla JS + supabase-js v2 (CDN) — 빌드 스텝 없음.
 *   보안: publishable 키 + RLS(rls.sql)가 경계. service_role 키 사용 금지.
 *   후기 발행 = 하드 게이트 (zia-cms-sprint.md 결정 trace 2026-07-22):
 *     lint-terms 오류 존재 시 발행 버튼 차단. 임시저장은 항상 허용.
 * ========================================================================== */
(function () {
  "use strict";

  var esc = UI.esc, toast = UI.toast, confirmModal = UI.confirmModal, busy = UI.busy;
  var cfg = window.ADMIN_CONFIG || {};
  var sb = null;
  var state = { session: null, zones: null, tags: null };

  function byId(id) { return document.getElementById(id); }
  function root() { return byId("view-root"); }
  function isBlank(s) { return !s || !String(s).replace(/\s/g, ""); }

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
    byId("btn-brand").addEventListener("click", function () { location.hash = "#/"; });
    window.addEventListener("hashchange", render);

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

  /* ════════════════════════ 라우터 ════════════════════════ */

  function render() {
    if (!state.session) return;
    var h = location.hash || "#/";
    var m;
    if (h === "#/" || h === "" || h === "#") viewDashboard();
    else if (h === "#/zones") viewZones();
    else if (h === "#/posts") viewPosts();
    else if (h === "#/posts/new") viewPostEdit(null);
    else if ((m = h.match(/^#\/posts\/(\d+)$/))) viewPostEdit(Number(m[1]));
    else if (h === "#/reviews") viewReviews();
    else if (h === "#/reviews/new") viewReviewEdit(null);
    else if ((m = h.match(/^#\/reviews\/(\d+)$/))) viewReviewEdit(Number(m[1]));
    else if (h === "#/settings") viewSettings();
    else if (h === "#/password") viewPassword();
    else viewDashboard();
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

  /* ════════════════════════ 홈 대시보드 ════════════════════════ */

  function viewDashboard() {
    root().innerHTML =
      '<h1 class="view-title">무엇을 할까요?</h1>' +
      '<p class="view-desc">바꾸고 싶은 항목을 눌러 주세요.</p>' +
      '<div class="dash-grid">' +
      dashCard("#/zones", "분", "진료 분야 관리", "홈페이지에 보여줄 진료 분야를 켜고 끕니다") +
      dashCard("#/posts", "글", "글 관리", "진료 사례와 소식 글을 쓰고 고칩니다") +
      dashCard("#/reviews", "후", "후기 관리", "후기 카드를 쓰고 발행합니다 (표현 자동 검사)") +
      dashCard("#/settings", "정", "병원 정보", "전화번호·진료시간·주소를 바꿉니다") +
      "</div>";
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

  /* ════════════════════════ 진료 분야(ZONE) 관리 ════════════════════════ */

  function viewZones() {
    loadingView();
    loadZones(true).then(renderZoneList).catch(loadFailView);
  }

  function renderZoneList(zones) {
    var html =
      backLink("#/", "처음으로") +
      '<h1 class="view-title">진료 분야 관리</h1>' +
      '<p class="view-desc">스위치를 누르면 바로 저장돼요.<br>' +
      "&middot; <b>홈페이지 노출</b>: 홈페이지 메뉴에 이 분야를 보여줘요<br>" +
      "&middot; <b>대표 분야</b>: 자주 묻는 질문(FAQ)의 대표 묶음이 돼요<br>" +
      "&middot; <b>홈 진료탭</b>: 홈 화면 진료 소개 탭에 나와요</p>";

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
        "</div>" + lockHint + "</div>";
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
      toast("저장되었습니다");
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
      backLink("#/", "처음으로") +
      '<h1 class="view-title">글 관리</h1>' +
      '<p class="view-desc">홈페이지 진료 소개에 나오는 글이에요. "발행 중"인 글만 홈페이지에 보여요.</p>' +
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
      '<div class="field"><label for="post-body">내용 <span style="font-weight:400;color:var(--muted)">(선택)</span></label>' +
      '<textarea id="post-body" placeholder="글 내용을 적어 주세요.">' + esc(isEdit ? post.body || "" : "") + "</textarea></div>" +
      '<div class="field"><label for="post-url">연결할 블로그 주소 <span style="font-weight:400;color:var(--muted)">(선택)</span></label>' +
      '<input type="url" id="post-url" value="' + esc(isEdit ? post.external_url || "" : "") + '" placeholder="https:// 로 시작하는 주소">' +
      '<p class="help">주소를 넣으면 홈페이지에서 이 카드를 눌렀을 때 해당 글로 이동해요.</p></div>' +
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
          body: "홈페이지에서 이 글이 안 보이게 돼요. 글 자체는 지워지지 않고 임시저장으로 남아요.",
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

  function savePost(existing, publish, btn) {
    showFormError("post-form-error", null);
    var title = byId("post-title").value.trim();
    var zoneId = Number(byId("post-zone").value) || null;
    if (!title) { showFormError("post-form-error", "제목을 입력해 주세요."); return; }
    if (!zoneId) { showFormError("post-form-error", "진료 분야를 골라 주세요."); return; }

    var tagIds = Array.prototype.map.call(
      byId("post-tags").querySelectorAll("input:checked"),
      function (i) { return Number(i.value); }
    );
    var payload = {
      zone_id: zoneId,
      title: title,
      badge: byId("post-badge").value.trim() || null,
      body: byId("post-body").value.trim() || null,
      external_url: byId("post-url").value.trim() || null,
      sort_order: Number(byId("post-order").value) || 0,
      published: publish,
      published_at: publish ? (existing && existing.published_at) || new Date().toISOString() : (existing && existing.published_at) || null
    };

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
      toast(publish ? "발행되었습니다. 홈페이지에 반영돼요." : "임시저장되었습니다. 홈페이지에는 아직 안 보여요.");
      location.hash = "#/posts";
    }).catch(function (err) {
      busy(btn, false);
      dbError(err);
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
      backLink("#/", "처음으로") +
      '<h1 class="view-title">후기 관리</h1>' +
      '<p class="view-desc">홈페이지 후기 카드예요. 의료광고법 때문에 치료 경험담이 아니라 ' +
      '<b>진료 프로그램을 소개하는 글</b>로 써야 해요. 발행 전에 자동으로 표현 검사를 해 드려요.</p>' +
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
        '<span class="pill ' + (r.lint_passed ? "pill-pass" : "pill-fail") + '">' + (r.lint_passed ? "검사 통과" : "검사 미통과") + "</span>" +
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
      '<div class="hl-wrap"><div class="hl-backdrop" id="rv-backdrop" aria-hidden="true"></div>' +
      '<textarea id="rv-body" placeholder="프로그램을 소개하는 문장으로 적어 주세요.">' + esc(isEdit ? review.body || "" : "") + "</textarea></div>" +
      '<p class="help">쓰면 안 되는 표현은 입력하는 동안 아래에 바로 알려 드려요.</p></div>' +
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
      '<div id="rv-lint-panel"></div>' +
      '<p class="field-error hidden" id="rv-form-error"></p>' +
      '<div class="form-actions" id="rv-actions"></div>' +
      "</div>";
    bindNav(root());

    var bodyEl = byId("rv-body");
    var titleEl = byId("rv-title");
    var labelsEl = byId("rv-labels");
    var backdrop = byId("rv-backdrop");
    var lintResult = { passed: true, errorCount: 0, warnCount: 0, issues: [] };
    var lintTimer = null;

    function parseLabels() {
      return labelsEl.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    }

    function runLint() {
      lintResult = LintTerms.lintFields([
        { field: "title", label: "제목", text: titleEl.value },
        { field: "body", label: "내용", text: bodyEl.value },
        { field: "labels", label: "라벨", text: parseLabels().join(", ") }
      ]);
      drawBackdrop();
      drawLintPanel();
      updateGate();
    }

    function scheduleLint() {
      clearTimeout(lintTimer);
      lintTimer = setTimeout(runLint, 200);
    }

    function drawBackdrop() {
      var text = bodyEl.value;
      var issues = lintResult.issues.filter(function (i) { return i.field === "body"; });
      var html = "";
      var last = 0;
      issues.forEach(function (i) {
        if (i.index < last) return;
        html += esc(text.slice(last, i.index));
        html += '<mark class="hl-' + i.level + '">' + esc(text.substr(i.index, i.length)) + "</mark>";
        last = i.index + i.length;
      });
      html += esc(text.slice(last));
      backdrop.innerHTML = html + "\n"; // 마지막 줄 스크롤 정합
      backdrop.scrollTop = bodyEl.scrollTop;
    }

    function drawLintPanel() {
      var panel = byId("rv-lint-panel");
      var issues = lintResult.issues;
      if (!issues.length) {
        panel.innerHTML = isBlank(bodyEl.value)
          ? ""
          : '<div class="lint-panel lint-ok"><h3>표현 검사 통과 &mdash; 발행할 수 있어요</h3></div>';
        return;
      }
      var errors = issues.filter(function (i) { return i.level === "error"; });
      var warns = issues.filter(function (i) { return i.level === "warn"; });
      var cls = errors.length ? "lint-bad" : "lint-warn-only";
      var head = errors.length
        ? "발행하려면 아래 표현을 고쳐 주세요 (" + errors.length + "곳)"
        : "발행은 가능하지만, 아래 표현을 한번 확인해 주세요";
      var html = '<div class="lint-panel ' + cls + '"><h3>' + head + "</h3>";
      errors.concat(warns).forEach(function (i) {
        html += '<div class="lint-issue' + (i.level === "warn" ? " warn" : "") + '">' +
          '<span class="where">' + esc(i.fieldLabel || "") + "</span>" +
          '<span class="term">&lsquo;' + esc(i.term) + "&rsquo;</span> &mdash; " + esc(i.message) +
          (i.alternates && i.alternates.length
            ? '<br><span class="alt">이렇게 바꿔 보세요: ' + esc(i.alternates.join(", ")) + "</span>"
            : "") +
          "</div>";
      });
      html += "</div>";
      panel.innerHTML = html;
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

    function updateGate() {
      var publishBtn = byId("rv-publish") || byId("rv-save-live");
      if (!publishBtn) return;
      var blocked = isBlank(bodyEl.value) || lintResult.errorCount > 0;
      publishBtn.disabled = blocked;
      var hint = byId("rv-gate-hint");
      if (hint) {
        if (isBlank(bodyEl.value)) hint.textContent = "내용을 입력하면 발행할 수 있어요.";
        else if (lintResult.errorCount > 0) hint.textContent = "위에 표시된 표현을 고치면 발행 버튼이 켜져요. 임시저장은 지금도 할 수 있어요.";
        else hint.textContent = "";
      }
    }

    [titleEl, bodyEl, labelsEl].forEach(function (el) {
      el.addEventListener("input", function () { labelsValid(); scheduleLint(); });
    });
    bodyEl.addEventListener("scroll", function () {
      backdrop.scrollTop = bodyEl.scrollTop;
      backdrop.scrollLeft = bodyEl.scrollLeft;
    });

    var actions = byId("rv-actions");
    if (isEdit && review.published) {
      actions.innerHTML =
        '<button type="button" class="btn-primary" id="rv-save-live">저장하기</button>' +
        '<button type="button" class="btn-ghost" id="rv-unpublish">발행 중지</button>' +
        '<p class="help" id="rv-gate-hint" style="width:100%"></p>';
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
        '<button type="button" class="btn-primary" id="rv-publish">발행하기</button>' +
        '<p class="help" id="rv-gate-hint" style="width:100%"></p>';
      byId("rv-draft").addEventListener("click", function () { saveReview(review, false, this); });
      byId("rv-publish").addEventListener("click", function () { saveReview(review, true, this); });
    }

    runLint(); // 초기 1회 (기존 내용 검사 + 게이트 상태 반영)

    function saveReview(existing, publish, btn) {
      showFormError("rv-form-error", null);
      if (!labelsValid()) return;
      var body = bodyEl.value.trim();
      if (!body) { showFormError("rv-form-error", "내용을 입력해 주세요."); return; }

      // 발행 직전 최종 검사 (하드 게이트 — 버튼 상태와 별개로 한 번 더 확인)
      runLint();
      if (publish && !lintResult.passed) {
        showFormError("rv-form-error", "쓰면 안 되는 표현이 남아 있어요. 위 안내를 보고 고친 뒤 발행해 주세요.");
        return;
      }

      var payload = {
        zone_id: Number(byId("rv-zone").value) || null,
        title: titleEl.value.trim() || null,
        body: body,
        labels: parseLabels(),
        more_url: byId("rv-url").value.trim() || null,
        is_highlight: byId("rv-highlight").checked,
        sort_order: Number(byId("rv-order").value) || 0,
        published: publish,
        lint_passed: lintResult.passed,
        lint_checked_at: new Date().toISOString(),
        lint_notes: LintTerms.buildNotes(lintResult)
      };

      busy(btn, true, "저장 중…");
      var q = existing
        ? sb.from("reviews").update(payload).eq("id", existing.id)
        : sb.from("reviews").insert(payload);
      q.then(function (res) {
        busy(btn, false);
        if (res.error) { dbError(res.error); return; }
        toast(publish ? "발행되었습니다. 홈페이지에 반영돼요." : "임시저장되었습니다. 홈페이지에는 아직 안 보여요.");
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
      backLink("#/", "처음으로") +
      '<h1 class="view-title">병원 정보</h1>' +
      '<p class="view-desc">홈페이지 곳곳(전화번호·진료시간·주소·예약 버튼)에 쓰이는 정보예요. ' +
      '바꾼 뒤 아래 <b>저장하기</b>를 꼭 눌러 주세요.</p>';

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
        toast("저장되었습니다 (" + changed.length + "개 항목)");
      }).catch(function (err) {
        busy(btn, false);
        dbError(err);
      });
    });
  }

  /* ════════════════════════ 비밀번호 변경 ════════════════════════ */

  function viewPassword() {
    root().innerHTML =
      backLink("#/", "처음으로") +
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
