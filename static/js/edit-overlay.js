// edit-overlay.js — P3-f "홈페이지 보며 수정" 인-플레이스(그 자리) 편집 오버레이
// 계약: admin/EDIT_PROTOCOL.md v2 (§2 편집 3계층 / §4 선택자 규칙 / §5 ZIA_FIELD_MAP /
//       §6 postMessage v2 / §7 자식 UI 규약 / §9 회귀 금지선)
//
// [무엇이 바뀌었나 — v1.2 → v2]
//   v1.2: 배지 클릭 → 관리 화면으로 "이동"(zia-edit-nav). 미리보기를 떠났다.
//   v2  : 요소를 클릭하면 "그 자리에" 팝오버가 뜨고 거기서 고친다. 페이지 이동 없음.
//         이동(zia-edit-nav)은 인-플레이스로 못 고치는 것(발행·순서변경 등)의 폴백으로
//         팝오버 안 [자세히 관리] 버튼에 남는다 (회귀 금지선 §9).
//
// [활성 조건] ① URL 에 ?edit=1 (또는 &edit=1) 이 있고, ② 관리자 화면(같은 주소의 부모 창)
//   안에서 열렸을 때만. 둘 중 하나라도 아니면 즉시 종료 — 일반 방문자에게는 DOM 접근·
//   스타일 주입·리스너 등록이 일체 없다 (계약 §9). 부모 없이 단독 점검할 때는 ?free=1 을 함께.
//   (관리자 주소가 유출돼 방문자가 ?edit=1 을 눌러도 편집 껍데기를 보지 않게 하기 위함 — E-4)
//
// [쓰기 금지] 자식(site)은 anon 읽기 전용이다 (계약 §1-2). 이 파일에는 저장 경로가 없다.
//   저장은 전부 postMessage(zia-edit-save) 로 부모(admin 인증 세션)에게 요청하고
//   zia-edit-saved 회신을 기다린다. Supabase 쓰기 호출·service key 일절 없음.
//
// [매핑 소비만] window.ZIA_FIELD_MAP / window.ZIA_INJECT_MAP (cms-inject.js 레지스트리) 를
//   읽기만 한다. 자체 매핑 정의 금지. 두 레지스트리 중 무엇이 없어도 죽지 않는다.
//   ZIA_FIELD_MAP 이 아직 없으면 → 그 자리 편집은 비활성, 목록 관리 안내(zia-edit-nav)와
//   자유 편집(L3)만으로 동작한다. 레지스트리는 수집할 때마다 다시 읽으므로 나중에 생겨도 반영된다.
//
// [주고받는 신호]
//   올림: zia-edit-ready / zia-edit-save / zia-edit-pick / zia-edit-nav   (계약 §6)
//         + zia-edit-revert {reqId, target:{override:{page,selector}}} — 자유 편집 되돌리기 (E-1)
//   받음: zia-edit-saved / zia-edit-picked / zia-edit-refresh / zia-edit-mode (계약 §6)
//         + zia-edit-reverted {reqId, ok, message} — 되돌리기 결과 (E-1)
//         + zia-edit-place / zia-edit-place-cancel (계약 §7 "상시 모드" — 부모가 이미 보내고 있어
//           자식에서 받을 자리 표시·배치까지 구현. 계약 §6 표에는 아직 없는 확장 신호)
//
// [XSS] 화면 문구·라벨은 코드 상수 + 레지스트리 라벨만 사용하고 전부 textContent 로 넣는다.
//   사용자가 입력한 서식(kind=html)은 저장·적용 직전 zia-sanitize.js 로 sanitize 한다.
//
// [비개발자 원칙] 전 문구 한국어. "선택자/오버라이드/필드/DOM" 같은 말은 화면에 노출하지 않는다.
//   클릭 타깃 ≥40px. 파괴적 동작(내용 비우기)은 confirm.
(function () {
    'use strict';
    if (!/[?&]edit=1(&|$)/.test(window.location.search)) { return; } // 일반 방문 — 완전 무동작

    /* ══════════════════════════════════════════════════════════════════
     * §0. 환경 상수
     * ════════════════════════════════════════════════════════════════ */
    var PATH = window.location.pathname;
    var BASE = PATH.replace(/\/[^\/]*$/, '');            // 스테이징 서브패스(/zia-preview) 대응
    var PAGE = PATH.split('/').pop() || 'index.html';    // 저장 키에 쓰는 페이지 파일명
    var CONFIG = window.ZIA_CONFIG || {};
    var SUPA_URL = (CONFIG.supabaseUrl || '').trim().replace(/\/+$/, '');
    // 공개 키(anon). 쓰기에는 쓰지 않는다 — "지금 고쳐 놓은 자리" 목록을 읽는 GET 전용
    // (계약 §1-2 자식 읽기 전용. 저장·삭제는 전부 부모에게 요청한다).
    var SUPA_KEY = (CONFIG.supabaseKey || '').trim();

    var mFocus = /[?&]focus=([A-Za-z0-9_]+)(&|$)/.exec(window.location.search);
    var FOCUS_ID = mFocus ? mFocus[1] : null;

    // ── [E-4] 편집 UI 노출 조건 ───────────────────────────────────────
    // ?edit=1 만으로는 켜지 않는다. 관리자 화면(같은 주소의 부모 창) 안에서 열렸을 때만 켠다.
    // 관리자 주소가 밖으로 새어 방문자가 눌러도 "수정 모드" 껍데기를 보지 않게 하기 위함.
    // (저장은 원래도 부모 인증 세션에서만 되므로 보안이 아니라 "미완성 화면 노출" 방지다.)
    // 단독 점검용 스위치 = ?free=1 (기존 수동 스위치 계승). 이때도 저장 경로는 없다.
    var STANDALONE = /[?&]free=1(&|$)/.test(window.location.search);
    var PARENT_ADMIN = (function () {
        try {
            if (!window.parent || window.parent === window) { return false; }
            return window.parent.location.origin === window.location.origin; // 다른 주소면 접근 자체가 막힌다
        } catch (e) { return false; }
    })();
    if (!PARENT_ADMIN && !STANDALONE) {
        hideAdminOnlyUi();
        return;                                     // 그 밖에는 완전 무동작
    }
    // 관리 전용 표시 중 이 파일이 만들지 않은 것들 — 주입 코드가 ?edit=1 만 보고 만든다.
    // 그 파일은 지금 손댈 수 없으므로, 관리자 화면 밖에서는 여기서 가려 준다 (E-4).
    //   · "링크 주소" 묶음 = footer 끝 블록 1개 → 통째로 걷어낸다.
    //   · 홈 칸 딱지("N번 칸") = 캐러셀 칸 위에 얹힌 딱지 → 숨기기만 한다.
    //     칸 자체를 지우면 캐러셀이 칸 수를 잘못 세어 넘김이 어긋난다 (구조 무변경 원칙).
    function hideAdminOnlyUi() {
        var st = document.createElement('style');
        st.appendChild(document.createTextNode('.zia-slot{display:none !important;}'));
        (document.head || document.documentElement).appendChild(st);
        function drop() {
            ['zia-link-edit', 'zia-link-edit-style'].forEach(function (id) {
                var n = document.getElementById(id);
                if (n && n.parentNode) { n.parentNode.removeChild(n); }
            });
        }
        drop();
        document.addEventListener('zia:inject-done', drop);   // 주입이 끝난 뒤 한 번 더
        setTimeout(drop, 5000);                               // 완료 신호가 안 오는 경우 안전망
    }

    // 자유 편집(L3) 기본 OFF. 부모의 zia-edit-mode 로 켜진다.
    // 단독 점검(?free=1)일 때는 처음부터 켜 둔다 (부모 신호가 항상 우선).
    var freeEdit = STANDALONE;

    var SAVE_TIMEOUT_MS = 15000;   // 여기까지 회신이 없으면 "아직 확인 중" 안내 (실패 단정 X — E-2)
    var SAVE_GIVEUP_MS = 120000;   // 여기까지도 회신이 없으면 "확인하지 못했어요" (화면 값은 유지)
    var PICK_TIMEOUT_MS = 120000;  // 사람이 고르는 시간 — 넉넉히
    var MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
    // [E-5] 붙여넣기 사고 방어 상한. 부모에는 상한이 없으므로 자식이 더 엄격한 쪽 = 충돌 없음.
    var MAX_TEXT_LEN = 2000;       // 글자 수(꾸밈 태그 제외)
    var MAX_RICH_LEN = 20000;      // 꾸밈 포함 원문 길이 — 태그 폭탄 방어

    // 관리 화면별 색 (표시 전용)
    var SCREEN_COLORS = {
        '#/settings': '#1a7a5e',
        '#/zones':    '#22344c',
        '#/home':     '#7c3aad',
        '#/posts':    '#0e7490',
        '#/faqs':     '#2563b0',
        '#/reviews':  '#c2620a'
    };
    var COLOR_EDIT = '#1a7a5e';  // 그 자리에서 고칠 수 있는 곳
    var COLOR_FREE = '#8a5a1a';  // 자유 편집으로 열린 곳

    var FONT = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", "Noto Sans KR", "Malgun Gothic", sans-serif';

    /* ══════════════════════════════════════════════════════════════════
     * §1. 스타일 (JS 주입 — 사이트 CSS 파일 무수정 원칙)
     * ════════════════════════════════════════════════════════════════ */
    var CSS = '' +
        /* 안내 바 — 화면 왼쪽 아래 구석에 작게 띄운다 (E-6).
           위쪽에 가로로 깔면 사이트 고정 헤더(로고·메뉴·예약 버튼)를 덮어 정작 헤더를
           고칠 수 없다. 사이트가 쓰는 자리는 위(header, 고정)와 오른쪽 아래(#quick, 고정)
           뿐이므로 왼쪽 아래로 피하고, 한 번 눌러 접을 수 있게 한다.
           문서 흐름을 건드리지 않으므로 100vh 히어로·고정 헤더 레이아웃은 그대로다. */
        '.zia-ov-bar{position:fixed;left:12px;bottom:12px;z-index:2147483200;display:flex;align-items:flex-end;' +
        'gap:8px;max-width:calc(100vw - 24px);font-family:' + FONT + ';}' +
        /* 좁은 화면: 사이트 하단 고정 메뉴(#quick) 위로 올린다 */
        '@media (max-width:1199px){.zia-ov-bar{bottom:calc(21.4vw + 12px);}}' +
        '@media (min-width:768px) and (max-width:1199px){.zia-ov-bar{bottom:94px;}}' +
        '.zia-ov-bar-panel{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:44px;' +
        'padding:6px 12px;border-radius:12px;background:#22344c;color:#fff;font-size:14px;font-weight:700;' +
        'line-height:1.3;box-shadow:0 4px 14px rgba(0,0,0,.32);}' +
        '.zia-ov-bar.mini .zia-ov-bar-panel{display:none;}' +
        '.zia-ov-bar .zia-ov-state{font-size:13px;font-weight:600;opacity:.85;}' +
        '.zia-ov-bar button{min-height:40px;padding:0 14px;border-radius:8px;border:1px solid rgba(255,255,255,.55);' +
        'background:rgba(255,255,255,.12);color:#fff;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer;}' +
        '.zia-ov-bar button:hover{background:rgba(255,255,255,.25);}' +
        '.zia-ov-bar-toggle{width:48px;height:48px;flex:none;padding:0;border-radius:50%;background:#22344c;' +
        'border:2px solid #fff;font-size:20px;box-shadow:0 4px 14px rgba(0,0,0,.32);}' +
        /* 편집 가능 표시 (outline 은 레이아웃 불변) */
        '.zia-ov-mark{outline:2px dashed var(--zia-ov-color,' + COLOR_EDIT + ') !important;outline-offset:3px;}' +
        '.zia-ov-hot{outline:3px solid var(--zia-ov-color,' + COLOR_EDIT + ') !important;outline-offset:3px;' +
        'cursor:pointer;}' +
        /* 모음에서 집은 항목을 받을 수 있는 자리 */
        '.zia-ov-drop-ok{outline:4px solid #7c3aad !important;outline-offset:4px;' +
        'box-shadow:0 0 0 9999px rgba(124,58,173,.06);cursor:copy;}' +
        /* hover 핸들 */
        '.zia-ov-handle{position:fixed;z-index:2147483300;display:inline-flex;align-items:center;gap:6px;' +
        'min-height:40px;padding:6px 14px;border-radius:999px;background:#fff;border:2px solid currentColor;' +
        'font-family:' + FONT + ';font-size:14px;font-weight:800;line-height:1.2;white-space:nowrap;cursor:pointer;' +
        'box-shadow:0 3px 10px rgba(0,0,0,.22);}' +
        '.zia-ov-handle:hover{transform:translateY(-1px);box-shadow:0 5px 14px rgba(0,0,0,.3);}' +
        /* 팝오버 */
        '.zia-ov-pop{position:fixed;z-index:2147483400;width:340px;max-width:calc(100vw - 16px);' +
        'background:#fff;border:2px solid #22344c;border-radius:14px;box-shadow:0 10px 34px rgba(0,0,0,.32);' +
        'font-family:' + FONT + ';color:#1d2733;overflow:hidden;}' +
        '.zia-ov-pop-head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#22344c;color:#fff;}' +
        '.zia-ov-pop-title{flex:1;font-size:15px;font-weight:800;line-height:1.3;}' +
        '.zia-ov-pop-x{width:40px;height:40px;flex:none;border:0;border-radius:8px;background:rgba(255,255,255,.14);' +
        'color:#fff;font-size:18px;font-weight:800;cursor:pointer;}' +
        '.zia-ov-pop-x:hover{background:rgba(255,255,255,.3);}' +
        '.zia-ov-pop-body{padding:12px;display:flex;flex-direction:column;gap:8px;max-height:52vh;overflow:auto;}' +
        '.zia-ov-hint{font-size:13px;line-height:1.5;color:#4a5766;}' +
        '.zia-ov-pop input[type=text],.zia-ov-pop textarea{width:100%;box-sizing:border-box;min-height:44px;' +
        'padding:10px;border:1px solid #b6c0cc;border-radius:8px;font-family:inherit;font-size:15px;line-height:1.5;' +
        'color:#1d2733;background:#fff;}' +
        '.zia-ov-pop textarea{min-height:110px;resize:vertical;}' +
        '.zia-ov-rich{min-height:110px;max-height:220px;overflow:auto;padding:10px;border:1px solid #b6c0cc;' +
        'border-radius:8px;font-size:15px;line-height:1.6;background:#fff;}' +
        '.zia-ov-rich:focus{outline:2px solid #1a7a5e;}' +
        '.zia-ov-tools{display:flex;flex-wrap:wrap;gap:6px;}' +
        '.zia-ov-tools button{min-height:40px;padding:0 12px;border:1px solid #b6c0cc;border-radius:8px;' +
        'background:#f4f7fa;font-family:inherit;font-size:14px;font-weight:700;color:#1d2733;cursor:pointer;}' +
        '.zia-ov-tools button:hover{background:#e6edf4;}' +
        '.zia-ov-thumb{display:block;width:100%;max-height:150px;object-fit:contain;background:#f1f4f8;' +
        'border:1px solid #dde3ea;border-radius:8px;}' +
        '.zia-ov-drop{display:flex;align-items:center;justify-content:center;min-height:64px;padding:10px;' +
        'border:2px dashed #b6c0cc;border-radius:10px;background:#f8fafc;font-size:13px;color:#5a6675;text-align:center;}' +
        '.zia-ov-drop.on{border-color:#1a7a5e;background:#eaf5f1;color:#1a7a5e;}' +
        '.zia-ov-msg{font-size:13px;line-height:1.5;padding:0 12px 4px;color:#4a5766;}' +
        '.zia-ov-msg.err{color:#b3261e;font-weight:700;}' +
        '.zia-ov-msg.ok{color:#1a7a5e;font-weight:700;}' +
        '.zia-ov-foot{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;border-top:1px solid #e6ebf0;background:#fbfcfd;}' +
        '.zia-ov-btn{min-height:40px;padding:0 14px;border-radius:8px;border:1px solid #b6c0cc;background:#fff;' +
        'font-family:inherit;font-size:14px;font-weight:700;color:#1d2733;cursor:pointer;}' +
        '.zia-ov-btn:hover{background:#eef2f6;}' +
        '.zia-ov-btn[disabled]{opacity:.5;cursor:default;}' +
        '.zia-ov-btn.pri{flex:1;background:#1a7a5e;border-color:#1a7a5e;color:#fff;}' +
        '.zia-ov-btn.pri:hover{background:#166b53;}' +
        /* 스피너 */
        '.zia-ov-spin{display:inline-block;width:14px;height:14px;margin-right:6px;vertical-align:-2px;' +
        'border:2px solid rgba(255,255,255,.45);border-top-color:#fff;border-radius:50%;' +
        'animation:zia-ov-rot .7s linear infinite;}' +
        '@keyframes zia-ov-rot{to{transform:rotate(360deg);}}' +
        /* 토스트 */
        '.zia-ov-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483500;' +
        'max-width:calc(100vw - 32px);padding:12px 18px;border-radius:10px;background:#1d2733;color:#fff;' +
        'font-family:' + FONT + ';font-size:14px;font-weight:700;line-height:1.4;text-align:center;' +
        'box-shadow:0 6px 20px rgba(0,0,0,.35);}' +
        '.zia-ov-toast.err{background:#b3261e;}' +
        /* focus 펄스 (v1.2 계승) */
        '@keyframes zia-ov-pulse{0%,100%{box-shadow:0 0 0 0 rgba(26,122,94,0);}' +
        '50%{box-shadow:0 0 0 12px rgba(26,122,94,.4);}}' +
        '.zia-ov-focus{animation:zia-ov-pulse 1s ease-in-out 3;}';

    /* ══════════════════════════════════════════════════════════════════
     * §2. 잡 유틸
     * ════════════════════════════════════════════════════════════════ */
    function qsa(sel, root) {
        try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
        catch (e) { return []; }
    }
    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) { n.className = cls; }
        if (text != null) { n.textContent = text; }
        return n;
    }
    function closestSafe(node, sel) {
        try { return node && node.closest ? node.closest(sel) : null; } catch (e) { return null; }
    }
    // 원본 내용 해시 (드리프트 감지용 — 차단용 아님). djb2 → base36.
    function simpleHash(str) {
        str = String(str == null ? '' : str);
        var h = 5381, i;
        for (i = 0; i < str.length; i++) { h = ((h << 5) + h + str.charCodeAt(i)) | 0; }
        return (h >>> 0).toString(36);
    }
    // 이미지 경로 해석 (cms-inject 경로 규약 답습)
    // ⚠ [E-3] 여기 들어오는 값은 두 종류다.
    //   (가) 저장소에 올린 사진의 보관 경로 ('2026/07/foo.jpg') — 저장소 공개 주소로 바꾼다.
    //   (나) 지금 화면에 걸려 있는 주소 (readValue 가 img 의 src 를 그대로 읽어 온 값).
    //        하위 경로 배포(/zia-preview/…)에서는 이미 '/zia-preview/static/…' 형태다.
    //   예전에는 (나)가 '/static/' 으로 시작하지 않는다는 이유로 (가)로 오인돼 없는 주소를
    //   만들었고, 팝오버의 "지금 보이는 사진"이 깨졌다. 아래 3·4번 규칙이 그 갈림길이다.
    function mediaUrl(p) {
        p = String(p == null ? '' : p).trim();
        if (!p) { return ''; }
        if (/^(https?:)?\/\//i.test(p) || /^data:/i.test(p)) { return p; }   // 절대 주소·프로토콜 생략 주소
        if (p.indexOf('/static/') === 0) { return BASE + p; }                // 사이트 기본 사진 (운영 도메인 기준 표기)
        if (p.charAt(0) === '/' && p.indexOf('/static/') > 0) { return p; }  // 이미 하위 경로가 붙은 주소 → 그대로
        if (/^\.{0,2}\/?static\//.test(p)) {                                 // 상대 표기 ('static/…', './static/…')
            return BASE + '/' + p.replace(/^[.\/]+/, '');
        }
        if (SUPA_URL) { return SUPA_URL + '/storage/v1/object/public/zia-media/' + encodeURI(p.replace(/^\/+/, '')); }
        return p;
    }

    /* 가시성 판정 (v1.2 계승 — 숨은 메뉴·비활성 슬라이드 제외) */
    function isVisible(node) {
        if (!node || !node.getBoundingClientRect) { return false; }
        var rect = node.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) { return false; }
        var st = window.getComputedStyle(node);
        if (st.display === 'none' || st.visibility === 'hidden') { return false; }
        if (!node.offsetParent && st.position !== 'fixed') { return false; }
        if (closestSafe(node, 'header')) {
            for (var n = node; n && n.tagName !== 'HEADER'; n = n.parentElement) {
                if (window.getComputedStyle(n).opacity === '0') { return false; }
            }
        }
        var slide = closestSafe(node, '.swiper-slide');
        if (slide && closestSafe(slide, '.main-visual-swiper') &&
            !slide.classList.contains('swiper-slide-active')) { return false; }
        return true;
    }

    /* ══════════════════════════════════════════════════════════════════
     * §3. postMessage 프로토콜 v2 (계약 §6)
     *   자식→부모: zia-edit-ready / zia-edit-save / zia-edit-pick / zia-edit-nav
     *   부모→자식: zia-edit-saved / zia-edit-picked / zia-edit-refresh / zia-edit-mode
     * ════════════════════════════════════════════════════════════════ */
    var reqSeq = 0;
    var pending = {};   // reqId → { done, timer, giveUp, waiting }

    function sendToParent(msg) {
        if (!PARENT_ADMIN) { return false; }
        try {
            window.parent.postMessage(msg, window.location.origin);
            return true;
        } catch (e) { return false; }
    }
    // 응답을 기다리는 요청. done(res, late) 는 성공/실패 공통 1회 호출.
    //
    // [E-2] 오래 걸린다 ≠ 실패다.
    //   부모의 실제 저장 요청에는 중단이 없어서, 자식이 15초에 "실패"로 단정하면
    //   20초 뒤 진짜로 저장돼 사이트가 바뀌는데 원장은 실패로 안다 — 정반대의 오해.
    //   그래서 waitOpts.onWait 를 준 요청은 timeoutMs 에 **끝내지 않고** "아직 확인 중"만
    //   알린 뒤 계속 기다린다. 늦게 도착한 회신도 정상 처리된다(late=true 로 표시).
    //   waitOpts 가 없는 요청(사람이 고르는 흐름 등)은 종전대로 timeoutMs 에 종료한다.
    function request(msg, timeoutMs, done, waitOpts) {
        var id = ++reqSeq;
        msg.reqId = id;
        if (!sendToParent(msg)) {
            done({ ok: false, message: '지금은 저장할 수 없어요. 관리자 화면에서 홈페이지를 열어 주세요.' }, false);
            return id;
        }
        var p = { done: done, waiting: false };
        p.timer = setTimeout(function () {
            if (pending[id] !== p) { return; }
            if (!waitOpts || !waitOpts.onWait) {
                delete pending[id];
                p.done({ ok: false, message: '응답이 없어요. 잠시 후 다시 시도해 주세요.' }, false);
                return;
            }
            p.waiting = true;
            try { waitOpts.onWait(); } catch (e) { /* 안내 실패는 무해 */ }
            p.giveUp = setTimeout(function () {
                if (pending[id] !== p) { return; }
                delete pending[id];
                // 실패가 아니라 "모른다". 화면 값을 되돌리지 않는다 (오도 금지).
                p.done({ ok: false, unknown: true }, true);
            }, waitOpts.giveUpMs || SAVE_GIVEUP_MS);
        }, timeoutMs);
        pending[id] = p;
        return id;
    }
    function resolveRequest(res) {
        var p = pending[res.reqId];
        if (!p) { return; }
        clearTimeout(p.timer);
        clearTimeout(p.giveUp);
        delete pending[res.reqId];
        p.done(res, !!p.waiting);
    }
    window.addEventListener('message', function (e) {
        if (e.origin !== window.location.origin) { return; }   // origin 검증 (계약 §1-4)
        var d = e.data;
        if (!d || typeof d !== 'object' || typeof d.type !== 'string') { return; }
        if (d.type === 'zia-edit-saved' || d.type === 'zia-edit-picked' || d.type === 'zia-edit-reverted') {
            resolveRequest(d);
        } else if (d.type === 'zia-edit-refresh') {
            // 부모가 목록 화면에서 데이터를 바꿨다 → 주입을 처음부터 다시 (edit 파라미터 유지)
            window.location.reload();
        } else if (d.type === 'zia-edit-mode') {
            setFreeEdit(!!d.freeEdit);
        } else if (d.type === 'zia-edit-place') {
            // 부모 모음에서 항목을 집었다 → "넣을 자리"를 고르는 상태로 전환
            setPlacing({ accept: d.accept || 'photo', item: d.item || null });
        } else if (d.type === 'zia-edit-place-cancel') {
            setPlacing(null);
        }
    });

    // 관리 화면 이동 (v1.2 계승 — 인-플레이스로 못 고치는 것의 폴백)
    function goAdmin(hash) {
        if (sendToParent({ type: 'zia-edit-nav', hash: hash })) { return; }
        window.location.href = BASE + '/admin/index.html' + hash;
    }

    /* ══════════════════════════════════════════════════════════════════
     * §3-2. "지금 고쳐 놓은 자리" 목록 — [원래대로] 버튼의 판정 근거 (E-1)
     * ------------------------------------------------------------------
     * 자유 편집으로 바꾼 자리는 화면에 아무 흔적이 남지 않는다. cms-inject 는 저장된
     * 값을 textContent/innerHTML/src 로 조용히 갈아끼울 뿐 표시를 남기지 않고,
     * 그 파일도 부모 파일도 여기서 고칠 수 없다. 그래서 판정 근거를 셋 둔다:
     *
     *   (a) 공개 목록 읽기 — v_public_page_overrides 를 이 페이지 몫만 GET 한다.
     *       cms-inject 가 화면에 적용할 때 쓰는 바로 그 공개 뷰라 값이 어긋날 수 없고,
     *       새로고침·다음 날 접속에도 유효하다. **읽기 전용 GET** 이므로 계약 §1-2
     *       (자식은 anon 읽기 전용, 모든 쓰기는 부모) 를 위반하지 않는다.
     *   (b) 이번에 저장에 성공한 자리 기억 — (a)를 다시 읽기 전에도 버튼이 뜬다.
     *   (c) 되돌리기 성공분 제거 — 지운 자리에 [원래대로]가 남지 않게.
     *
     * (a)가 실패하면(설정 없음·차단·타임아웃) (b)만으로 동작한다. 그때는 방금 고친
     * 자리에만 버튼이 뜨고, 예전에 고친 자리는 안 뜬다 — 조용한 축소이지 오작동은 아니다.
     * 되돌리기 요청에는 **저장에 쓰인 그 자리 값**을 그대로 실어 보낸다 (새로 계산하면
     * 부모가 지울 행을 못 찾을 수 있다).
     * ════════════════════════════════════════════════════════════════ */
    var overrideRows = [];    // [{ selector, kind }] — 공개 목록에서 읽은 것
    var localOverrides = [];  // [{ node, selector, kind }] — 이번 화면에서 저장한 것

    function loadOverrideList() {
        if (!SUPA_URL || !SUPA_KEY || !window.fetch) { return; }
        var url = SUPA_URL + '/rest/v1/v_public_page_overrides?select=selector,kind&page=eq.' +
            encodeURIComponent(PAGE);
        var ctrl = window.AbortController ? new AbortController() : null;
        var timer = setTimeout(function () { if (ctrl) { try { ctrl.abort(); } catch (e) { /* noop */ } } }, 4000);
        fetch(url, {
            headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY, Accept: 'application/json' },
            signal: ctrl ? ctrl.signal : undefined
        }).then(function (res) {
            if (!res.ok) { throw new Error('HTTP ' + res.status); }
            return res.json();
        }).then(function (rows) {
            clearTimeout(timer);
            if (Array.isArray(rows)) {
                overrideRows = rows.filter(function (r) { return r && r.selector; });
            }
        })['catch'](function () { clearTimeout(timer); });   // 실패 → (b)만으로 동작
    }
    function rememberOverride(info, selector) {
        if (!selector) { return; }
        for (var i = 0; i < localOverrides.length; i++) {
            if (localOverrides[i].node === info.node) { localOverrides[i].selector = selector; return; }
        }
        localOverrides.push({ node: info.node, selector: selector, kind: info.kind });
    }
    function forgetOverride(selector) {
        localOverrides = localOverrides.filter(function (o) { return o.selector !== selector; });
        overrideRows = overrideRows.filter(function (r) { return r.selector !== selector; });
    }
    // 이 요소가 지금 자유 편집으로 바뀐 상태인가? → { selector, kind } 또는 null
    function findOverride(node) {
        var i, j, nodes;
        for (i = 0; i < localOverrides.length; i++) {
            if (localOverrides[i].node === node) { return localOverrides[i]; }
        }
        for (i = 0; i < overrideRows.length; i++) {
            nodes = qsa(overrideRows[i].selector);
            for (j = 0; j < nodes.length; j++) {
                // 사진은 저장한 자리가 사진을 감싼 요소일 수도 있다 (cms-inject 적용 규칙과 동일)
                if (nodes[j] === node ||
                    (node.tagName === 'IMG' && nodes[j].querySelector && nodes[j].querySelector('img') === node)) {
                    return overrideRows[i];
                }
            }
        }
        return null;
    }

    /* ══════════════════════════════════════════════════════════════════
     * §4. 편집 3계층 판정 (계약 §2)
     *   L1 정본 필드   : ZIA_FIELD_MAP 엔트리 (kind text/html/image)
     *   L2 슬롯 배치   : ZIA_FIELD_MAP 엔트리 중 kind==='slot'
     *   LN 관리화면 안내: ZIA_INJECT_MAP 지점 (인-플레이스 불가 → [자세히 관리] 폴백)
     *   L3 자유 오버라이드: 위 어디에도 없는 임의 텍스트/이미지 (자유 편집 ON 일 때만)
     * ════════════════════════════════════════════════════════════════ */
    var marks = [];      // { node, info } — 표시(outline)한 요소들
    var injectSelectors = [];  // 주입 컨테이너 selector 목록 (L3 제외 판정용)

    function refreshInjectSelectors() {
        var imap = window.ZIA_INJECT_MAP || {};
        injectSelectors = Object.keys(imap).map(function (id) {
            return imap[id] && imap[id].selector;
        }).filter(Boolean);
    }
    // 주입이 덮어쓰는 영역인가? (L3 오버라이드가 무효가 되므로 제외 — 계약 §4)
    function insideInjected(node) {
        for (var i = 0; i < injectSelectors.length; i++) {
            if (closestSafe(node, injectSelectors[i])) { return true; }
        }
        return false;
    }
    function findMark(node) {
        for (var i = 0; i < marks.length; i++) {
            if (marks[i].node === node) { return marks[i].info; }
        }
        return null;
    }
    function addMark(node, info) {
        if (findMark(node)) { return; }   // 먼저 등록된 계층이 우선 (L1 > L2 > LN)
        info.node = node;
        marks.push({ node: node, info: info });
        node.classList.add('zia-ov-mark');
        node.style.setProperty('--zia-ov-color', info.color);
    }
    function clearMarks() {
        marks.forEach(function (m) {
            m.node.classList.remove('zia-ov-mark', 'zia-ov-hot', 'zia-ov-drop-ok');
            m.node.style.removeProperty('--zia-ov-color');
        });
        marks = [];
    }

    // 행 기반 엔티티(posts/reviews/faqs)의 row id 를 DOM data 속성에서 읽는다 (계약 §5).
    function readRowId(node, attr) {
        if (!attr) { return null; }
        var holder = closestSafe(node, '[' + attr + ']');
        return holder ? holder.getAttribute(attr) : null;
    }

    // 레지스트리 → 편집 지점 수집
    function collectMarks() {
        clearMarks();
        refreshInjectSelectors();

        // ── L1 / L2 : ZIA_FIELD_MAP (없으면 이 블록만 건너뛴다 — 오버레이는 계속 동작)
        var fmap = window.ZIA_FIELD_MAP || {};
        Object.keys(fmap).forEach(function (fieldId) {
            var f = fmap[fieldId];
            if (!f || !f.selector) { return; }
            var kind = f.kind || 'text';
            var isSlot = (kind === 'slot');
            qsa(f.selector).forEach(function (node) {
                if (!isVisible(node)) { return; }
                addMark(node, {
                    tier: isSlot ? 'L2' : 'L1',
                    fieldId: fieldId,
                    kind: isSlot ? 'slot' : kind,
                    accept: f.accept || (f.source && f.source.accept) || 'photo',
                    label: f.label || '내용',
                    longText: !!f.longText,   // 길이 안내를 붙일 자리인가 (긴 글만)
                    source: f.source || null,
                    adminHash: f.adminHash || null,
                    color: isSlot ? SCREEN_COLORS['#/home'] : COLOR_EDIT
                });
            });
        });

        // ── LN : ZIA_INJECT_MAP (관리 화면이 있는 지점만 — dead-end 차단)
        var imap = window.ZIA_INJECT_MAP || {};
        var seen = [];
        Object.keys(imap).forEach(function (pointId) {
            var pt = imap[pointId];
            if (!pt || !pt.selector || !pt.adminHash || !pt.label) { return; }
            var node = document.querySelector(pt.selector);
            if (!node || seen.indexOf(node) !== -1 || !isVisible(node)) { return; }
            seen.push(node);
            addMark(node, {
                tier: 'LN',
                pointId: pointId,
                label: pt.label,
                adminHash: pt.adminHash,
                color: SCREEN_COLORS[pt.adminHash] || COLOR_EDIT
            });
        });

        if (placing) { setPlacing(placing); }   // 재수집 후에도 "받을 자리" 표시 유지
    }

    /* ── L3 후보 판정 (자유 편집 ON 일 때만) ─────────────────────────── */
    var TEXT_TAGS = { H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, P: 1, SPAN: 1, STRONG: 1, EM: 1, B: 1,
        I: 1, LI: 1, DT: 1, DD: 1, TD: 1, TH: 1, A: 1, BUTTON: 1, FIGCAPTION: 1, LABEL: 1, SMALL: 1, DIV: 1 };
    var BLOCK_TEXT = { P: 1, DIV: 1, LI: 1, DD: 1, BLOCKQUOTE: 1 };

    function ownText(node) {
        var buf = '', c;
        for (c = node.firstChild; c; c = c.nextSibling) {
            if (c.nodeType === 3) { buf += c.nodeValue; }
        }
        return buf.trim();
    }
    // 자식 요소가 서식 태그(br/strong/em/b/i/a/span)뿐인가 → 통째 편집 가능
    var INLINE_OK = { BR: 1, STRONG: 1, EM: 1, B: 1, I: 1, A: 1, SPAN: 1, SMALL: 1 };
    function onlyInlineChildren(node) {
        var kids = node.children, i;
        for (i = 0; i < kids.length; i++) {
            if (!INLINE_OK[kids[i].tagName]) { return false; }
        }
        return true;
    }
    function freeTargetFor(node) {
        if (!freeEdit || !node || node.nodeType !== 1) { return null; }
        // 캐러셀이 실행 중 복제한 슬라이드는 원본이 아니다 (고쳐도 새로고침하면 사라진다) → 제외
        if (closestSafe(node, '.swiper-slide-duplicate')) { return null; }
        var n = node, depth = 0;
        while (n && n !== document.body && depth < 8) {
            if (n.tagName === 'IMG') {
                if (!insideInjected(n)) {
                    return { tier: 'L3', kind: 'image', label: '이 사진', color: COLOR_FREE, node: n };
                }
                return null;
            }
            if (TEXT_TAGS[n.tagName] && ownText(n) && onlyInlineChildren(n) && isVisible(n)) {
                if (insideInjected(n)) { return null; }   // 주입 영역 제외 (계약 §4)
                return {
                    tier: 'L3',
                    kind: (n.children.length && n.tagName !== 'A') || BLOCK_TEXT[n.tagName] ? 'html' : 'text',
                    label: '이 글',
                    color: COLOR_FREE,
                    node: n
                };
            }
            n = n.parentElement;
            depth++;
        }
        return null;
    }
    // 이벤트 좌표의 요소 → 편집 대상 정보 (레지스트리 우선, 없으면 자유 편집 후보)
    function resolveTarget(node) {
        var n = node, depth = 0;
        while (n && n !== document.body && depth < 10) {
            var info = findMark(n);
            if (info) { return info; }
            n = n.parentElement;
            depth++;
        }
        return freeTargetFor(node);
    }

    /* ══════════════════════════════════════════════════════════════════
     * §5. 선택자 생성 (계약 §4 — 결정적이어야 함)
     *   가장 가까운 기준점(id / section-* 안정 class / header·footer·main) 아래를
     *   tag:nth-of-type(n) 체인으로 잇는다. 유일하지 않으면 body 부터 전체 체인으로 폴백.
     * ════════════════════════════════════════════════════════════════ */
    var SAFE_IDENT = /^[A-Za-z][A-Za-z0-9_-]*$/;
    // 실행 중 자동 생성돼 새로고침마다 바뀌는 id (Swiper 가 wrapper 에 심는 난수 id 등).
    // 이런 id 를 기준점으로 쓰면 다음 방문에 못 찾는다 — 실측으로 확인해 배제한다.
    var UNSTABLE_ID = /^(swiper-|ui-id|jquery|ember|react-)|[0-9a-f]{8,}/i;
    var STABLE_CLASS = /^(section-[A-Za-z0-9_-]+|main-visual-swiper|real-stories|address-banner|bottom-banner)$/;

    function anchorOf(node) {
        if (node.id && SAFE_IDENT.test(node.id) && !UNSTABLE_ID.test(node.id)) { return '#' + node.id; }
        var cls = node.className && node.className.split ? node.className.split(/\s+/) : [];
        for (var i = 0; i < cls.length; i++) {
            if (STABLE_CLASS.test(cls[i])) { return '.' + cls[i]; }
        }
        var tag = node.tagName.toLowerCase();
        if (tag === 'header' || tag === 'footer' || tag === 'main' || tag === 'body') { return tag; }
        return null;
    }
    function nthOfType(node) {
        var i = 1, sib = node.previousElementSibling;
        while (sib) {
            if (sib.tagName === node.tagName) { i++; }
            sib = sib.previousElementSibling;
        }
        return node.tagName.toLowerCase() + ':nth-of-type(' + i + ')';
    }
    function isUnique(sel, node) {
        var found = qsa(sel);
        return found.length === 1 && found[0] === node;
    }
    function buildSelector(node) {
        // 1차: 가까운 기준점 + 하위 체인
        var chain = [], n = node, base = null, guard = 0;
        while (n && n !== document.documentElement && guard < 30) {
            var a = anchorOf(n);
            if (a) { base = a; break; }
            chain.unshift(nthOfType(n));
            n = n.parentElement;
            guard++;
        }
        if (base) {
            var sel = base + (chain.length ? ' > ' + chain.join(' > ') : '');
            if (isUnique(sel, node)) { return sel; }
        }
        // 2차 폴백: body 부터 전체 체인 (항상 결정적)
        var full = [], m = node, g2 = 0;
        while (m && m !== document.body && g2 < 30) {
            full.unshift(nthOfType(m));
            m = m.parentElement;
            g2++;
        }
        return 'body' + (full.length ? ' > ' + full.join(' > ') : '');
    }

    /* ══════════════════════════════════════════════════════════════════
     * §6. 값 읽기 / 적용
     * ════════════════════════════════════════════════════════════════ */
    function imgOf(node) {
        return node.tagName === 'IMG' ? node : node.querySelector('img');
    }
    function readValue(info) {
        var node = info.node;
        if (info.kind === 'image') {
            var im = imgOf(node);
            return im ? (im.getAttribute('src') || '') : '';
        }
        if (info.kind === 'html') { return node.innerHTML; }
        return (node.textContent || '').replace(/\s+/g, ' ').trim();
    }
    function applyValue(info, value) {
        var node = info.node;
        if (info.kind === 'image') {
            var im = imgOf(node);
            if (im) { im.setAttribute('src', mediaUrl(value)); }
            return;
        }
        if (info.kind === 'html') {
            node.innerHTML = sanitizeHtml(value);   // 적용 직전 재-sanitize (이중 방어)
            return;
        }
        node.textContent = value;
    }

    /* zia-sanitize.js — post.html 외의 페이지에는 로드돼 있지 않아 필요할 때 끌어온다.
       실패하면 서식 편집을 글자만 고치기로 자동 강등한다 (안전 우선). */
    var sanitizerState = 'idle'; // idle | loading | ready | fail
    function ensureSanitizer(cb) {
        if (window.ZiaSanitize) { sanitizerState = 'ready'; cb(true); return; }
        if (sanitizerState === 'fail') { cb(false); return; }
        sanitizerState = 'loading';
        var s = document.createElement('script');
        s.src = BASE + '/static/js/zia-sanitize.js';
        s.onload = function () {
            sanitizerState = window.ZiaSanitize ? 'ready' : 'fail';
            cb(sanitizerState === 'ready');
        };
        s.onerror = function () { sanitizerState = 'fail'; cb(false); };
        document.head.appendChild(s);
    }
    function sanitizeHtml(html) {
        if (window.ZiaSanitize && window.ZiaSanitize.sanitize) {
            try { return window.ZiaSanitize.sanitize(html); } catch (e) { /* 아래 폴백 */ }
        }
        // sanitizer 부재 폴백: 태그를 전부 버리고 글자만 남긴다 (절대 원문 결합 금지)
        var box = document.createElement('div');
        box.innerHTML = '';
        box.textContent = String(html == null ? '' : html).replace(/<[^>]*>/g, '');
        return box.innerHTML;
    }

    /* ══════════════════════════════════════════════════════════════════
     * §7. 오버레이 UI — 안내 바 / 토스트 / 핸들 / 팝오버
     * ════════════════════════════════════════════════════════════════ */
    var bar = null, stateLabel = null, handle = null, pop = null, popFor = null, toastTimer = null;
    // 핸들·팝오버가 넘어가면 안 되는 화면 위쪽 여백.
    // 예전엔 상단 안내 바(48px)를 피하느라 56 이었다. 바를 왼쪽 아래로 옮긴 뒤(E-6)
    // 화면 맨 위까지 쓸 수 있게 됐다 — 사이트 헤더 위에도 핸들이 정상적으로 뜬다.
    var TOP_SAFE = 8;

    function stripEditUrl() {
        var kept = window.location.search.replace(/^\?/, '').split('&').filter(function (kv) {
            return kv && !/^edit=/.test(kv) && !/^focus=/.test(kv) && !/^free=/.test(kv);
        });
        return PATH + (kept.length ? '?' + kept.join('&') : '') + window.location.hash;
    }
    // 안내 바 — 왼쪽 아래 구석 (E-6). ✏️ 단추로 접었다 폈다 한다.
    // 접어도 ✏️ 단추는 남으므로 "수정 모드 끄기"에 언제나 두 번 안에 닿는다.
    function buildBar() {
        bar = el('div', 'zia-ov-bar zia-ov');
        var toggle = el('button', 'zia-ov-bar-toggle', '✏️');
        toggle.type = 'button';
        toggle.title = '수정 모드 안내 접기/펴기';
        toggle.setAttribute('aria-label', '수정 모드 안내 접기/펴기');
        toggle.addEventListener('click', function () { bar.classList.toggle('mini'); });
        bar.appendChild(toggle);

        var panel = el('div', 'zia-ov-bar-panel');
        panel.appendChild(el('span', null, '수정 모드 — 고칠 곳을 누르세요'));
        stateLabel = el('span', 'zia-ov-state', '');
        panel.appendChild(stateLabel);
        var off = el('button', null, '수정 모드 끄기');
        off.type = 'button';
        off.addEventListener('click', function () { window.location.href = stripEditUrl(); });
        panel.appendChild(off);
        bar.appendChild(panel);

        document.body.appendChild(bar);
        renderState();
    }
    function expandBar() { if (bar) { bar.classList.remove('mini'); } }
    function renderState() {
        if (!stateLabel) { return; }
        stateLabel.textContent = freeEdit ? '아무 곳이나 고치기: 켜짐' : '아무 곳이나 고치기: 꺼짐';
    }
    function setFreeEdit(on) {
        if (freeEdit === on) { return; }
        freeEdit = on;
        renderState();
        hideHandle();
        toast(on ? '이제 아무 글이나 사진도 누르면 고칠 수 있어요' : '표시된 곳만 고칠 수 있어요');
    }
    var toastNode = null;
    function toast(text, isErr) {
        clearTimeout(toastTimer);
        if (toastNode && toastNode.parentNode) { toastNode.parentNode.removeChild(toastNode); }
        toastNode = el('div', 'zia-ov-toast zia-ov' + (isErr ? ' err' : ''), text);
        document.body.appendChild(toastNode);
        var mine = toastNode;
        toastTimer = setTimeout(function () {
            if (mine.parentNode) { mine.parentNode.removeChild(mine); }
            if (toastNode === mine) { toastNode = null; }
        }, isErr ? 5200 : 2600);
    }

    /* ── hover 핸들 ─────────────────────────────────────────────────── */
    var handleInfo = null, handleHideTimer = null;
    function showHandle(info) {
        if (pop) { return; }               // 팝오버 열려 있으면 핸들 숨김
        clearTimeout(handleHideTimer);
        if (handleInfo && handleInfo.node !== info.node) { handleInfo.node.classList.remove('zia-ov-hot'); }
        handleInfo = info;
        info.node.classList.add('zia-ov-hot');
        if (!handle) {
            handle = el('button', 'zia-ov-handle zia-ov');
            handle.type = 'button';
            handle.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (handleInfo) { openPopover(handleInfo); }
            });
            handle.addEventListener('mouseenter', function () { clearTimeout(handleHideTimer); });
            handle.addEventListener('mouseleave', function () { hideHandleSoon(); });
            document.body.appendChild(handle);
        }
        handle.style.color = info.color;
        handle.textContent = info.tier === 'LN' ? '✏️ 여기 관리하기' : '✏️ 여기 고치기';
        handle.style.display = '';
        positionHandle();
    }
    function positionHandle() {
        if (!handle || !handleInfo) { return; }
        var r = handleInfo.node.getBoundingClientRect();
        var w = handle.offsetWidth || 120;
        var h = handle.offsetHeight || 40;
        var top = r.top - h - 4;
        if (top < TOP_SAFE) { top = Math.min(r.top + 4, window.innerHeight - h - 8); }
        var left = r.left + 6;
        if (left + w > window.innerWidth - 8) { left = Math.max(8, window.innerWidth - w - 8); }
        if (left < 8) { left = 8; }
        handle.style.top = Math.max(TOP_SAFE, top) + 'px';
        handle.style.left = left + 'px';
    }
    function hideHandleSoon() {
        clearTimeout(handleHideTimer);
        handleHideTimer = setTimeout(hideHandle, 220);
    }
    function hideHandle() {
        clearTimeout(handleHideTimer);
        if (handleInfo) { handleInfo.node.classList.remove('zia-ov-hot'); }
        handleInfo = null;
        if (handle) { handle.style.display = 'none'; }
    }

    /* ── 팝오버 ─────────────────────────────────────────────────────── */
    function closePopover() {
        if (pop && pop.parentNode) { pop.parentNode.removeChild(pop); }
        pop = null;
        popFor = null;
    }
    function positionPopover() {
        if (!pop || !popFor) { return; }
        var r = popFor.node.getBoundingClientRect();
        var w = pop.offsetWidth || 340;
        var h = pop.offsetHeight || 220;
        var left = r.left;
        if (left + w > window.innerWidth - 8) { left = window.innerWidth - w - 8; }
        if (left < 8) { left = 8; }
        var top = r.bottom + 8;                     // 기본 = 요소 아래
        if (top + h > window.innerHeight - 8) {
            top = r.top - h - 8;                    // 아래가 좁으면 위로
        }
        if (top < TOP_SAFE) {                       // 위도 좁으면 화면 안으로 클램프
            top = Math.min(TOP_SAFE, window.innerHeight - h - 8);
            if (top < TOP_SAFE) { top = TOP_SAFE; }
        }
        if (top + h > window.innerHeight - 8) { top = Math.max(TOP_SAFE, window.innerHeight - h - 8); }
        pop.style.left = left + 'px';
        pop.style.top = top + 'px';
    }

    // 팝오버 뼈대 — head / body / msg / foot
    function popShell(title) {
        var box = el('div', 'zia-ov-pop zia-ov');
        box.setAttribute('role', 'dialog');
        var head = el('div', 'zia-ov-pop-head');
        head.appendChild(el('span', 'zia-ov-pop-title', title));
        var x = el('button', 'zia-ov-pop-x', '✕');
        x.type = 'button';
        x.setAttribute('aria-label', '닫기');
        x.addEventListener('click', closePopover);
        head.appendChild(x);
        box.appendChild(head);
        box.body = el('div', 'zia-ov-pop-body');
        box.appendChild(box.body);
        box.msg = el('div', 'zia-ov-msg');
        box.appendChild(box.msg);
        box.foot = el('div', 'zia-ov-foot');
        box.appendChild(box.foot);
        box.addEventListener('click', function (e) { e.stopPropagation(); });
        box.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        return box;
    }
    function setMsg(box, text, cls) {
        box.msg.className = 'zia-ov-msg' + (cls ? ' ' + cls : '');
        box.msg.textContent = text || '';
    }
    function addBtn(box, text, cls, fn) {
        var b = el('button', 'zia-ov-btn' + (cls ? ' ' + cls : ''), text);
        b.type = 'button';
        b.addEventListener('click', fn);
        box.foot.appendChild(b);
        return b;
    }

    function openPopover(info) {
        closePopover();
        hideHandle();
        popFor = info;
        if (info.tier === 'LN') { pop = buildNavPopover(info); }
        else if (info.tier === 'L2') { pop = buildSlotPopover(info); }
        else if (info.kind === 'image') { pop = buildImagePopover(info); }
        else if (info.kind === 'html') { pop = buildRichPopover(info); }
        else { pop = buildTextPopover(info); }
        document.body.appendChild(pop);
        positionPopover();
        var first = pop.querySelector('input,textarea,.zia-ov-rich,button');
        if (first && first.focus) { try { first.focus(); } catch (e) { /* noop */ } }
    }

    // LN — 인-플레이스로는 못 고치는 자리 (목록·발행·순서 등). v1.2 이동 경로 보존.
    function buildNavPopover(info) {
        var box = popShell('여기는 목록에서 관리해요');
        box.body.appendChild(el('p', 'zia-ov-hint',
            '이 자리에 나오는 내용은 "' + info.label.replace(/에서 수정$/, '') + '" 목록에서 고르고 정리합니다. ' +
            '아래 버튼을 누르면 그 목록으로 갑니다.'));
        addBtn(box, '자세히 관리', 'pri', function () { goAdmin(info.adminHash); });
        addBtn(box, '닫기', null, closePopover);
        return box;
    }

    // 길이 안내는 길이가 실제 쟁점인 자리에만 붙인다.
    // 전화번호 칸에 "최대 2,000자까지" 라고 적으면 도움이 아니라 소음이다
    // (넘치게 붙여넣는 사고 방어는 maxLength·저장 검사가 그대로 맡는다 — 안내만 뺀다).
    function lenHint(info, original) {
        var long = (info && info.longText) || (info && info.kind === 'html') ||
            String(original || '').length >= 300;
        return long ? ' 최대 ' + comma(MAX_TEXT_LEN) + '자까지 넣을 수 있어요.' : '';
    }

    // L1 text — 한 줄 입력 / 여러 줄이면 textarea
    function buildTextPopover(info) {
        var original = readValue(info);
        var box = popShell(info.label + ' 고치기');
        var multi = original.length > 40 || /\n/.test(original);
        var input = multi ? el('textarea') : el('input');
        if (!multi) { input.type = 'text'; }
        input.value = original;
        input.maxLength = MAX_TEXT_LEN;   // [E-5] 붙여넣기 사고 방어 — 넘치면 잘려 들어온다
        box.body.appendChild(input);
        box.body.appendChild(el('p', 'zia-ov-hint',
            (multi ? '고친 뒤 [저장]을 누르세요. Esc를 누르면 취소돼요.'
                   : 'Enter를 누르면 저장, Esc를 누르면 취소돼요.') +
            lenHint(info, original)));
        var save = addBtn(box, '저장', 'pri', function () { doSave(box, info, input.value, original); });
        addBtn(box, '취소', null, closePopover);
        addRevertBtn(box, info);
        if (info.adminHash) { addBtn(box, '자세히 관리', null, function () { goAdmin(info.adminHash); }); }
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); closePopover(); }
            else if (e.key === 'Enter' && !multi) { e.preventDefault(); save.click(); }
        });
        return box;
    }

    // L1/L3 html — 굵게·링크·문단 정도의 최소 서식
    function buildRichPopover(info) {
        var original = readValue(info);
        var box = popShell(info.label + ' 고치기');
        var tools = el('div', 'zia-ov-tools');
        var rich = el('div', 'zia-ov-rich');
        rich.setAttribute('contenteditable', 'true');
        rich.innerHTML = sanitizeHtml(original);

        function cmd(name, arg) {
            rich.focus();
            try { document.execCommand(name, false, arg || null); } catch (e) { /* noop */ }
        }
        [['굵게', function () { cmd('bold'); }],
         ['문단 나누기', function () { cmd('formatBlock', '<p>'); }],
         ['링크 걸기', function () {
             var url = window.prompt('연결할 주소를 붙여넣으세요 (http로 시작)', 'https://');
             if (url && /^https?:\/\//i.test(url)) { cmd('createLink', url); }
             else if (url) { toast('http:// 또는 https:// 로 시작하는 주소만 넣을 수 있어요', true); }
         }],
         ['서식 지우기', function () { cmd('removeFormat'); }]
        ].forEach(function (pair) {
            var b = el('button', null, pair[0]);
            b.type = 'button';
            b.addEventListener('click', pair[1]);
            tools.appendChild(b);
        });

        box.body.appendChild(tools);
        box.body.appendChild(rich);
        box.body.appendChild(el('p', 'zia-ov-hint',
            '글자를 끌어서 고른 뒤 위 버튼을 누르면 꾸밀 수 있어요. Esc는 취소.' +
            lenHint(info, original)));
        addBtn(box, '저장', 'pri', function () { doSave(box, info, sanitizeHtml(rich.innerHTML), original); });
        addBtn(box, '취소', null, closePopover);
        addRevertBtn(box, info);
        if (info.adminHash) { addBtn(box, '자세히 관리', null, function () { goAdmin(info.adminHash); }); }
        rich.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); closePopover(); }
        });
        // [E-5] 붙여넣기로 길이가 넘치면 저장 전에 미리 알려 준다 (저장 단계에서 한 번 더 막는다)
        var lenWarned = false;
        rich.addEventListener('input', function () {
            var over = tooLong('html', rich.innerHTML);
            if (over) { lenWarned = true; setMsg(box, over, 'err'); }
            else if (lenWarned) { lenWarned = false; setMsg(box, '', null); }
        });
        // 서식 편집은 sanitizer 가 있어야 안전 — 없으면 알려주고 글자만 고치기로 강등
        ensureSanitizer(function (ok) {
            if (!ok) {
                setMsg(box, '지금은 꾸미기 없이 글자만 고칠 수 있어요.', 'err');
                tools.style.display = 'none';
            }
        });
        return box;
    }

    // L1/L3 image — 현재 사진 + [사진 고르기] + 드래그해서 올리기
    function buildImagePopover(info) {
        var original = readValue(info);
        var box = popShell((info.label || '사진') + ' 바꾸기');
        var thumb = el('img', 'zia-ov-thumb');
        thumb.alt = '지금 보이는 사진';
        if (original) { thumb.src = mediaUrl(original); }
        box.body.appendChild(thumb);
        var drop = el('div', 'zia-ov-drop', '여기로 사진을 끌어다 놓아도 돼요');
        box.body.appendChild(drop);
        box.body.appendChild(el('p', 'zia-ov-hint', '사진을 고르면 바로 홈페이지에 반영돼요.'));

        function useUpload(file) {
            if (!file) { return; }
            if (!/^image\//.test(file.type)) { toast('사진 파일만 올릴 수 있어요', true); return; }
            if (file.size > MAX_UPLOAD_BYTES) { toast('사진이 너무 커요 (8MB까지)', true); return; }
            var fr = new FileReader();
            fr.onload = function () {
                setMsg(box, '사진을 올리는 중이에요…', null);
                request({
                    type: 'zia-edit-pick',
                    accept: 'photo',
                    slot: info.fieldId || info.label || '사진',
                    upload: { name: file.name, type: file.type, size: file.size, dataUrl: String(fr.result) }
                }, PICK_TIMEOUT_MS, function (res) {
                    if (!res.ok || !res.item) {
                        setMsg(box, res.message || '사진을 올리지 못했어요.', 'err');
                        return;
                    }
                    var p = res.item.path || res.item.url || res.item;
                    thumb.src = mediaUrl(p);
                    doSave(box, info, p, original);
                });
            };
            fr.onerror = function () { setMsg(box, '사진을 읽지 못했어요.', 'err'); };
            fr.readAsDataURL(file);
        }
        drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('on'); });
        drop.addEventListener('dragleave', function () { drop.classList.remove('on'); });
        drop.addEventListener('drop', function (e) {
            e.preventDefault();
            drop.classList.remove('on');
            var f = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null;
            useUpload(f);
        });

        addBtn(box, '사진 고르기', 'pri', function () {
            setMsg(box, '오른쪽 사진 모음에서 골라 주세요…', null);
            request({ type: 'zia-edit-pick', accept: 'photo', slot: info.fieldId || info.label || '사진' },
                PICK_TIMEOUT_MS, function (res) {
                    if (!res.ok || !res.item) {
                        setMsg(box, res.message || '사진을 고르지 못했어요.', 'err');
                        return;
                    }
                    var p = res.item.path || res.item.url || res.item;
                    thumb.src = mediaUrl(p);
                    doSave(box, info, p, original);
                });
        });
        addBtn(box, '닫기', null, closePopover);
        addRevertBtn(box, info);
        if (info.adminHash) { addBtn(box, '자세히 관리', null, function () { goAdmin(info.adminHash); }); }
        return box;
    }

    // L2 슬롯 — "이 자리에 무엇을 띄울지" 고르기
    function buildSlotPopover(info) {
        var accept = info.accept || 'photo';
        var w = whatWord(accept);
        var what = w.name;
        var box = popShell('이 자리에 띄울 ' + what + ' 고르기');
        box.body.appendChild(el('p', 'zia-ov-hint',
            '[' + what + ' 고르기]를 누르면 오른쪽 모음이 열려요. 거기서 원하는 ' + w.obj + ' 누르면 이 자리에 들어갑니다.'));
        addBtn(box, what + ' 고르기', 'pri', function () {
            setMsg(box, '모음에서 골라 주세요…', null);
            request({ type: 'zia-edit-pick', accept: accept, slot: info.fieldId || info.label },
                PICK_TIMEOUT_MS, function (res) {
                    if (!res.ok || !res.item) {
                        setMsg(box, res.message || '고르지 못했어요.', 'err');
                        return;
                    }
                    var item = res.item;
                    var value = (item.id != null ? String(item.id) : (item.path || item.url || String(item)));
                    doSave(box, info, value, null, item);
                });
        });
        addBtn(box, '닫기', null, closePopover);
        if (info.adminHash) { addBtn(box, '자세히 관리', null, function () { goAdmin(info.adminHash); }); }
        return box;
    }

    /* ══════════════════════════════════════════════════════════════════
     * §8. 저장 — 자식은 요청만, 실제 쓰기는 부모(인증 세션)가 한다 (계약 §1-2)
     * ════════════════════════════════════════════════════════════════ */
    function buildTarget(info, original) {
        if (info.tier === 'L1' || info.tier === 'L2') {
            var t = { fieldId: info.fieldId };
            // 행 기반 엔티티는 화면에 심어둔 행 번호를 같이 올린다 (계약 §5 rowFrom)
            var rowAttr = info.source && info.source.rowFrom;
            if (rowAttr) {
                var rid = readRowId(info.node, rowAttr);
                if (rid != null) { t.rowId = rid; }
            }
            return t;
        }
        // 이미 고쳐 놓은 자리를 또 고치는 경우, 그때 쓴 자리 값을 그대로 다시 쓴다.
        // 새로 계산한 값이 조금이라도 다르면 같은 자리에 두 벌이 쌓이고, [원래대로]로 한 벌만
        // 지워지면 나머지가 남아 "되돌렸는데 그대로"가 된다. 그 자리 하나만 정확히 가리킬 때만 재사용.
        var sel = null, prev = findOverride(info.node);
        if (prev && prev.selector) {
            var m = qsa(prev.selector);
            if (m.length === 1 && m[0] === info.node) { sel = prev.selector; }
        }
        return {
            override: {
                page: PAGE,
                selector: sel || buildSelector(info.node),
                anchorHash: simpleHash(original == null ? readValue(info) : original)
            }
        };
    }

    /* [E-5] 길이 상한 검사. 넘치면 사람 말로 된 안내 문구를, 아니면 null 을 돌려준다. */
    function comma(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
    function tooLong(kind, value) {
        if (kind !== 'text' && kind !== 'html') { return null; }
        var raw = String(value == null ? '' : value);
        var textLen = raw.replace(/<[^>]*>/g, '').length;
        if (textLen > MAX_TEXT_LEN) {
            return '내용이 너무 길어요. ' + comma(MAX_TEXT_LEN) + '자 안으로 줄여 주세요. (지금 ' +
                comma(textLen) + '자)';
        }
        if (raw.length > MAX_RICH_LEN) {
            return '꾸밈이 너무 많아요. 글을 조금 나누거나 [서식 지우기]를 눌러 주세요.';
        }
        return null;
    }

    function doSave(box, info, value, original, pickedItem) {
        if (original == null) { original = readValue(info); }
        var over = tooLong(info.kind, value);
        if (over) { setMsg(box, over, 'err'); return; }
        if (info.kind !== 'slot' && info.kind !== 'image' &&
            String(value).replace(/<[^>]*>/g, '').trim() === '' &&
            String(original).replace(/<[^>]*>/g, '').trim() !== '') {
            if (!window.confirm('내용을 비우시겠어요? 홈페이지에서 이 글이 사라집니다.')) { return; }
        }
        if (info.kind !== 'slot' && String(value) === String(original)) {
            setMsg(box, '바뀐 내용이 없어요.', null);
            return;
        }

        // 진행 표시 — 버튼 잠금 + 스피너
        var btns = qsa('.zia-ov-btn', box);
        btns.forEach(function (b) { b.disabled = true; });
        var pri = box.querySelector('.zia-ov-btn.pri');
        var priText = pri ? pri.textContent : '';
        if (pri) {
            pri.textContent = '';
            pri.appendChild(el('span', 'zia-ov-spin'));
            pri.appendChild(document.createTextNode('저장 중…'));
        }
        setMsg(box, '', null);

        // 즉시 반영(낙관적) — 실패하면 원래대로 되돌린다
        var applied = false;
        if (info.kind !== 'slot') {
            try { applyValue(info, value); applied = true; } catch (e) { /* 적용 실패는 무시 */ }
        }

        var target = buildTarget(info, original);
        function mine() { return pop === box; }            // 그 사이 팝오버가 닫혔는지
        function say(text, cls) {
            if (mine()) { setMsg(box, text, cls); } else { toast(text, cls === 'err'); }
        }

        request({
            type: 'zia-edit-save',
            target: target,
            kind: info.kind,
            value: value,
            item: pickedItem || null
        }, SAVE_TIMEOUT_MS, function (res, late) {
            btns.forEach(function (b) { b.disabled = false; });
            if (pri) { pri.textContent = priText; }
            if (res && res.ok) {
                if (res.value != null && info.kind !== 'slot') {
                    try { applyValue(info, res.value); } catch (e) { /* noop */ }
                }
                // 자유 편집분은 "지금 고쳐 놓은 자리"로 기억해 둔다 → [원래대로] 가 뜬다 (E-1)
                if (info.tier === 'L3' && target.override) { rememberOverride(info, target.override.selector); }
                if (mine()) { closePopover(); }
                toast(late ? '조금 늦었지만 저장됐어요' : (res.message || '저장했어요'));
                if (info.kind === 'slot') { window.setTimeout(function () { window.location.reload(); }, 900); }
            } else if (res && res.unknown) {
                // [E-2] 오래 걸려서 결과를 모르는 상태. 실패라고 말하지 않고, 화면 값도
                // 되돌리지 않는다 (되돌리면 실제로는 저장됐는데 안 된 것처럼 보인다).
                say('저장됐는지 아직 확인하지 못했어요. 화면을 새로 불러와 확인해 주세요.', 'err');
            } else {
                if (applied) { try { applyValue(info, original); } catch (e) { /* noop */ } }
                say((res && res.message) || '저장하지 못했어요. 잠시 후 다시 해 주세요.', 'err');
            }
        }, {
            // 15초가 지나도 회신이 없을 때 — "실패"가 아니라 "아직 확인 중"이라고 말한다.
            onWait: function () {
                if (pri) {
                    pri.textContent = '';
                    pri.appendChild(el('span', 'zia-ov-spin'));
                    pri.appendChild(document.createTextNode('확인 중…'));
                }
                say('저장 요청을 보냈어요. 결과를 확인하는 중이에요 — 조금만 기다려 주세요.', null);
            },
            giveUpMs: SAVE_GIVEUP_MS
        });
    }

    /* ── [원래대로] — 자유 편집으로 바꾼 자리를 처음 문구로 되돌린다 (E-1) ──────
       자식은 지우지 않는다. 부모에게 zia-edit-revert 로 요청하고 zia-edit-reverted 를 기다린다.
       성공하면 화면을 새로 불러온다 — 처음 문구는 저장된 값에 덮여 화면에 남아 있지 않으므로
       다시 불러오는 것이 가장 확실하다. */
    function addRevertBtn(box, info) {
        if (info.tier !== 'L3') { return; }        // 정본 항목은 원래 값 폴백이 따로 있다
        var ov = findOverride(info.node);
        if (!ov) { return; }
        box.body.appendChild(el('p', 'zia-ov-hint',
            '이 자리는 지금 고쳐 놓은 상태예요. [원래대로]를 누르면 처음 문구로 돌아갑니다.'));
        addBtn(box, '원래대로', null, function () { doRevert(box, info, ov); });
    }
    function doRevert(box, info, ov) {
        if (!window.confirm('이 자리를 처음 문구로 되돌릴까요?\n지금 고쳐 놓은 내용은 사라집니다.')) { return; }
        var btns = qsa('.zia-ov-btn', box);
        btns.forEach(function (b) { b.disabled = true; });
        function mine() { return pop === box; }
        function say(text, cls) {
            if (mine()) { setMsg(box, text, cls); } else { toast(text, cls === 'err'); }
        }
        say('처음 문구로 되돌리는 중이에요…', null);
        request({
            type: 'zia-edit-revert',
            target: { override: { page: PAGE, selector: ov.selector } }
        }, SAVE_TIMEOUT_MS, function (res, late) {
            btns.forEach(function (b) { b.disabled = false; });
            if (res && res.ok) {
                forgetOverride(ov.selector);
                if (mine()) { closePopover(); }
                toast(res.message || (late ? '조금 늦었지만 되돌렸어요' : '처음 문구로 되돌렸어요'));
                window.setTimeout(function () { window.location.reload(); }, 800);
            } else if (res && res.unknown) {
                say('되돌렸는지 아직 확인하지 못했어요. 화면을 새로 불러와 확인해 주세요.', 'err');
            } else {
                say((res && res.message) || '되돌리지 못했어요. 잠시 후 다시 해 주세요.', 'err');
            }
        }, {
            onWait: function () { say('되돌리는 중이에요. 결과를 확인하고 있어요 — 조금만 기다려 주세요.', null); },
            giveUpMs: SAVE_GIVEUP_MS
        });
    }

    /* ══════════════════════════════════════════════════════════════════
     * §8-2. "모음에서 집어 자리에 놓기" (부모의 zia-edit-place / -cancel)
     *   부모가 사진·글·후기 카드를 집으면(클릭 또는 드래그 시작) 미리보기는
     *   받을 수 있는 자리만 밝게 표시하고, 그 자리를 누르거나 그 위에 떨구면 저장 요청한다.
     * ════════════════════════════════════════════════════════════════ */
    var placing = null;   // { accept, item }

    // 고를 대상의 우리말 이름 + 목적격 조사까지 붙인 형태 ("사진을" / "글을" / "후기를")
    function whatWord(accept) {
        if (accept === 'post') { return { name: '글', obj: '글을' }; }
        if (accept === 'review') { return { name: '후기', obj: '후기를' }; }
        return { name: '사진', obj: '사진을' };
    }
    function acceptsItem(info, accept) {
        if (!info) { return false; }
        if (accept === 'photo') { return info.kind === 'image' || (info.tier === 'L2' && info.accept === 'photo'); }
        return info.tier === 'L2' && info.accept === accept;
    }
    function setPlacing(p) {
        placing = p;
        marks.forEach(function (m) { m.node.classList.remove('zia-ov-drop-ok'); });
        if (!p) { renderState(); return; }
        expandBar();   // 안내 문구가 접혀 있으면 펴 준다 (E-6)
        var n = 0;
        marks.forEach(function (m) {
            if (acceptsItem(m.info, p.accept)) { m.node.classList.add('zia-ov-drop-ok'); n++; }
        });
        var what = whatWord(p.accept);
        if (stateLabel) {
            stateLabel.textContent = n ? ('밝게 표시된 자리를 눌러 ' + what.obj + ' 넣으세요')
                                       : ('이 화면에는 ' + what.obj + ' 넣을 자리가 없어요');
        }
    }
    function placeInto(info) {
        var item = placing ? placing.item : null;
        if (!item) { setPlacing(null); return; }
        var value = (info.kind === 'image')
            ? (item.path || item.url || '')
            : (item.id != null ? String(item.id) : (item.path || ''));
        var accept = placing.accept;
        setPlacing(null);
        openPopover(info);
        if (pop) {
            var thumb = pop.querySelector('.zia-ov-thumb');
            if (thumb && info.kind === 'image') { thumb.src = mediaUrl(value); }
            doSave(pop, info, value, null, item);
        }
        return accept;
    }

    /* ══════════════════════════════════════════════════════════════════
     * §9. 이벤트 배선
     * ════════════════════════════════════════════════════════════════ */
    function isOverlayNode(node) {
        return !!closestSafe(node, '.zia-ov');
    }
    function bindPointer() {
        document.addEventListener('mouseover', function (e) {
            var t = e.target;
            if (!t || t.nodeType !== 1 || isOverlayNode(t)) { return; }
            if (pop) { return; }
            var info = resolveTarget(t);
            if (info) { showHandle(info); }
            else { hideHandleSoon(); }
        }, true);

        // 클릭 가로채기 — L1/L2/L3 은 그 자리에서 편집.
        // LN(목록 관리 지점)은 가로채지 않는다 → 탭 전환·캐러셀 조작이 계속 되고,
        // 관리 화면 이동은 hover 핸들로 연다 (v1.2 배지 경로 보존).
        document.addEventListener('click', function (e) {
            var t = e.target;
            if (!t || t.nodeType !== 1 || isOverlayNode(t)) { return; }
            var info = resolveTarget(t);
            if (placing) {   // 모음에서 집은 항목을 놓는 중 — 자리 고르기가 우선
                e.preventDefault();
                e.stopPropagation();
                if (acceptsItem(info, placing.accept)) { placeInto(info); }
                else { toast('여기에는 넣을 수 없어요. 밝게 표시된 자리를 눌러 주세요', true); }
                return;
            }
            if (!info || info.tier === 'LN') { return; }
            e.preventDefault();
            e.stopPropagation();
            openPopover(info);
        }, true);

        // 부모 패널에서 끌어다 놓기 (드롭 지점의 자리에 배치)
        document.addEventListener('dragover', function (e) {
            if (placing) { e.preventDefault(); }
        });
        document.addEventListener('drop', function (e) {
            if (!placing || isOverlayNode(e.target)) { return; }
            e.preventDefault();
            var info = resolveTarget(e.target);
            if (acceptsItem(info, placing.accept)) { placeInto(info); }
            else { toast('여기에는 넣을 수 없어요. 밝게 표시된 자리에 놓아 주세요', true); }
        });

        // 바깥 클릭 / Esc → 팝오버 닫기
        document.addEventListener('mousedown', function (e) {
            if (pop && !isOverlayNode(e.target)) { closePopover(); }
        }, true);
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') { return; }
            if (pop) { closePopover(); }
            else if (placing) { setPlacing(null); }
        });
    }

    // 사이트 내부 링크 이동 시 수정 모드 유지 (v1.2 계승)
    function keepEditOnLinks() {
        document.addEventListener('click', function (e) {
            var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
            if (!a || isOverlayNode(a)) { return; }
            var href = a.getAttribute('href');
            if (!href || /^(#|https?:|mailto:|tel:|javascript:)/.test(href)) { return; }
            if (a.getAttribute('target') === '_blank') { return; }
            if (!/\.html(\?|#|$)/.test(href)) { return; }
            if (/[?&]edit=1/.test(href)) { return; }
            a.setAttribute('href', href + (href.indexOf('?') === -1 ? '?' : '&') + 'edit=1');
        }, true);
    }

    /* focus 딥링크 (v1.2 계승 — 부모가 "방금 바꾼 자리" 확인 요청) */
    var focusApplied = false;
    function applyFocus() {
        if (focusApplied || !FOCUS_ID) { return; }
        var map = window.ZIA_INJECT_MAP || {};
        var pt = map[FOCUS_ID];
        var node = pt && pt.selector ? document.querySelector(pt.selector) : null;
        if (!node) { return; }
        focusApplied = true;
        function inView() {
            var r = node.getBoundingClientRect();
            return r.top < window.innerHeight * 0.8 && r.bottom > window.innerHeight * 0.2;
        }
        setTimeout(function () {
            try { node.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
            catch (e) { node.scrollIntoView(); }
            setTimeout(function () {
                if (!inView()) {
                    try { node.scrollIntoView({ behavior: 'auto', block: 'center' }); }
                    catch (e2) { node.scrollIntoView(); }
                }
                node.classList.add('zia-ov-focus');
                setTimeout(function () { node.classList.remove('zia-ov-focus'); }, 3400);
            }, 1400);
        }, 500);
    }

    /* 재수집 스케줄 (주입·탭 전환·스와이퍼 재구성 대응) */
    var scheduleTimer = null, guardUntil = 0;
    function schedule() {
        clearTimeout(scheduleTimer);
        scheduleTimer = setTimeout(function () {
            guardUntil = Date.now() + 150;   // 자기 유발 mutation 무시
            collectMarks();
            applyFocus();
        }, 300);
    }
    // 스크롤·리사이즈 시 핸들·팝오버가 요소를 따라가게 (rAF 스로틀)
    var followRaf = 0;
    function followNow() {
        followRaf = 0;
        positionHandle();
        positionPopover();
    }
    function follow() {
        if (followRaf) { return; }
        if (window.requestAnimationFrame) { followRaf = window.requestAnimationFrame(followNow); }
        else { followRaf = setTimeout(followNow, 16); }
    }

    /* ══════════════════════════════════════════════════════════════════
     * §10. 기동
     * ════════════════════════════════════════════════════════════════ */
    function start() {
        var style = el('style');
        style.appendChild(document.createTextNode(CSS));
        document.head.appendChild(style);

        buildBar();
        collectMarks();
        loadOverrideList();   // "지금 고쳐 놓은 자리" 목록 (읽기 전용 GET — E-1 판정 근거)
        bindPointer();
        keepEditOnLinks();
        applyFocus();

        if (window.MutationObserver) {
            var mo = new MutationObserver(function (records) {
                if (Date.now() < guardUntil) { return; }
                for (var i = 0; i < records.length; i++) {
                    if (isOverlayNode(records[i].target)) { continue; }
                    schedule();
                    return;
                }
            });
            mo.observe(document.body, {
                childList: true, subtree: true,
                attributes: true, attributeFilter: ['class']
            });
        }
        window.addEventListener('resize', function () { schedule(); follow(); });
        window.addEventListener('scroll', follow, { passive: true });
        window.addEventListener('load', schedule);

        // 부모에게 기동 완료 통지 (툴바 상태 동기화)
        sendToParent({ type: 'zia-edit-ready', page: PAGE });
    }

    function whenDomReady(cb) {
        if (document.readyState === 'complete' || document.readyState === 'interactive') { cb(); return; }
        document.addEventListener('DOMContentLoaded', cb);
    }
    function whenInjected(cb) {
        if (window.ZIA_INJECT_DONE) { cb(); return; }
        var fired = false;
        function go() { if (!fired) { fired = true; cb(); } }
        document.addEventListener('zia:inject-done', go);
        setTimeout(go, 4000);   // cms-inject 부재·이상 시 안전망
    }
    whenDomReady(function () { whenInjected(start); });
})();
