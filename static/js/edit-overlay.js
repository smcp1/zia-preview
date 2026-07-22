// edit-overlay.js — P3-e "홈페이지 보며 수정" 수정 모드 오버레이 (FRONTEND_CONTRACT.md v1.2 §8)
//
// 활성 조건: URL 에 ?edit=1 (또는 &edit=1) 있을 때만. 없으면 첫 줄에서 즉시 종료 —
// 일반 방문자에게는 코드 0 실행 (DOM 접근·스타일 주입·리스너 등록 일체 없음).
//
// 매핑: window.ZIA_INJECT_MAP (cms-inject.js 레지스트리) 소비만 한다 — 자체 매핑 정의 금지.
// 배지 클릭: iframe(관리자 #/live) 안이면 parent.postMessage({type:'zia-edit-nav', hash}) /
//            단독 창이면 {BASE}/admin/index.html{hash} 이동 (스테이징 서브패스 BASE 전치 규약).
// focus 딥링크: ?edit=1&focus=지점ID → 해당 요소 스크롤 + 펄스 하이라이트 3회.
//
// [XSS] 배지 라벨·안내문 = 레지스트리/코드 상수만. 데이터 문자열 DOM 결합 금지
//       (전부 createElement + textContent — innerHTML 미사용).
// [회귀 0] 사이트 요소에는 class 1개(zia-edit-target) + CSS 변수만 부가 (outline 은
//          레이아웃 불변). 수정 모드 종료(파라미터 제거) 시 흔적 0.
(function () {
    'use strict';
    if (!/[?&]edit=1(&|$)/.test(window.location.search)) { return; } // 일반 방문 — 완전 무동작

    var path = window.location.pathname;
    var BASE = path.replace(/\/[^\/]*$/, ''); // cms-inject.js BASE 전치 규약 답습 (스테이징 /zia-preview 대응)
    var mFocus = /[?&]focus=([A-Za-z0-9_]+)(&|$)/.exec(window.location.search);
    var FOCUS_ID = mFocus ? mFocus[1] : null;
    var IN_IFRAME = (function () {
        try { return !!(window.parent && window.parent !== window); } catch (e) { return true; }
    })();

    // 편집 화면별 색 (표시 전용 — 지점→화면 매핑 자체는 ZIA_INJECT_MAP 소비)
    var SCREEN_COLORS = {
        '#/settings': '#1a7a5e', // 병원 정보 — 초록
        '#/zones':    '#22344c', // 진료 분야 — 남색
        '#/home':     '#7c3aad', // 홈 화면 관리 — 보라
        '#/posts':    '#0e7490', // 글 관리 — 청록
        '#/faqs':     '#2563b0', // 자주 묻는 질문 — 파랑
        '#/reviews':  '#c2620a'  // 후기 관리 — 주황
    };
    var FONT = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", "Noto Sans KR", "Malgun Gothic", sans-serif';
    var CSS = '' +
        '.zia-edit-bar{position:fixed;top:0;left:0;right:0;z-index:2147483200;display:flex;align-items:center;' +
        'justify-content:center;gap:12px;flex-wrap:wrap;min-height:48px;padding:6px 12px;background:#22344c;color:#fff;' +
        'font-family:' + FONT + ';font-size:15px;font-weight:700;line-height:1.3;text-align:center;' +
        'box-shadow:0 2px 10px rgba(0,0,0,.28);}' +
        '.zia-edit-bar button{min-height:40px;padding:0 16px;border-radius:8px;border:1px solid rgba(255,255,255,.55);' +
        'background:rgba(255,255,255,.12);color:#fff;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer;}' +
        '.zia-edit-bar button:hover{background:rgba(255,255,255,.25);}' +
        '.zia-edit-layer{position:absolute;top:0;left:0;width:100%;height:0;z-index:2147483100;pointer-events:none;}' +
        '.zia-edit-badge{position:absolute;display:inline-flex;align-items:center;gap:6px;min-height:40px;' +
        'padding:6px 14px;border-radius:999px;background:#fff;border:2px solid currentColor;' +
        'font-family:' + FONT + ';font-size:14px;font-weight:800;line-height:1.2;white-space:nowrap;' +
        'cursor:pointer;pointer-events:auto;box-shadow:0 3px 10px rgba(0,0,0,.22);}' +
        '.zia-edit-badge:hover{transform:translateY(-1px);box-shadow:0 5px 14px rgba(0,0,0,.3);}' +
        '.zia-edit-target{outline:2px dashed var(--zia-edit-color,#1a7a5e) !important;outline-offset:3px;}' +
        '@keyframes zia-edit-pulse{0%,100%{box-shadow:0 0 0 0 rgba(26,122,94,0);}' +
        '50%{box-shadow:0 0 0 12px rgba(26,122,94,.4);}}' +
        '.zia-edit-focus{animation:zia-edit-pulse 1s ease-in-out 3;}';

    var layer = null;          // 배지 컨테이너 (body 직속, 문서 좌표 absolute)
    var decorated = [];        // 테두리 부가한 사이트 요소 (재렌더 시 원복)
    var renderGuardUntil = 0;  // 자기 유발 mutation 무시 시간창
    var scheduleTimer = null;
    var focusApplied = false;

    function qsa(sel, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(sel));
    }

    /* ── 관리자 이동 (배지 클릭) ───────────────────────────────────── */
    function goAdmin(hash) {
        if (IN_IFRAME) {
            try {
                window.parent.postMessage({ type: 'zia-edit-nav', hash: hash }, window.location.origin);
                return;
            } catch (e) { /* 부모 접근 불가 — 단독 창 폴백 */ }
        }
        window.location.href = BASE + '/admin/index.html' + hash;
    }

    /* ── 수정 모드 끄기 — edit/focus 파라미터만 제거한 동일 페이지 ── */
    function stripEditUrl() {
        var kept = window.location.search.replace(/^\?/, '').split('&').filter(function (kv) {
            return kv && !/^edit=/.test(kv) && !/^focus=/.test(kv);
        });
        return path + (kept.length ? '?' + kept.join('&') : '') + window.location.hash;
    }

    /* ── 상단 고정 안내 바 ─────────────────────────────────────────── */
    function buildBar() {
        var bar = document.createElement('div');
        bar.className = 'zia-edit-bar';
        var msg = document.createElement('span');
        msg.textContent = '✏️ 수정 모드 — 배지를 누르면 편집 화면으로 이동합니다';
        var off = document.createElement('button');
        off.type = 'button';
        off.textContent = '수정 모드 끄기';
        off.addEventListener('click', function () { window.location.href = stripEditUrl(); });
        bar.appendChild(msg);
        bar.appendChild(off);
        document.body.appendChild(bar);
    }

    /* ── 가시성 판정 (숨은 메뉴·비활성 히어로 슬라이드 배지 차단) ──── */
    function isVisible(el) {
        var rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) { return false; }
        var st = window.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') { return false; }
        if (!el.offsetParent && st.position !== 'fixed') { return false; } // 조상 display:none (GNB 드로어)
        // header 내부 한정 조상 opacity:0 숨김 판정 (PC 메가메뉴 .depth_box — 실측: display 아닌
        // opacity 로 숨김). 본문 섹션은 scroll-reveal(page_obj_show_motion)이 opacity 0 을 쓰므로
        // 전역 적용 금지 — 본문은 스크롤 시 재렌더로 자연 정합.
        if (el.closest && el.closest('header')) {
            for (var n = el; n && n.tagName !== 'HEADER'; n = n.parentElement) {
                if (window.getComputedStyle(n).opacity === '0') { return false; }
            }
        }
        // 히어로 스와이퍼의 비활성 슬라이드 내부 (slide1/slide2 로테이션)
        var slide = el.closest ? el.closest('.swiper-slide') : null;
        if (slide && slide.closest('.main-visual-swiper') && !slide.classList.contains('swiper-slide-active')) {
            return false;
        }
        return true;
    }

    /* ── 배지 렌더 (전량 재생성 — DOM 교체·탭 전환·리사이즈에 안전) ── */
    function renderBadges() {
        if (!layer) { return; }
        renderGuardUntil = Date.now() + 120; // 자기 유발 mutation 무시
        decorated.forEach(function (el) {
            el.classList.remove('zia-edit-target');
            el.style.removeProperty('--zia-edit-color');
        });
        decorated = [];
        while (layer.firstChild) { layer.removeChild(layer.firstChild); }

        var map = window.ZIA_INJECT_MAP || {};
        var seen = [];   // element 중복 배지 방지 (I14=R1 겸용 등)
        var placed = []; // 배지 rect (겹침 시 세로 오프셋)
        var viewportW = document.documentElement.clientWidth;

        Object.keys(map).forEach(function (id) {
            var pt = map[id];
            if (!pt || !pt.selector || !pt.adminHash || !pt.label) { return; } // 관리 화면 부재 지점 skip
            var el = document.querySelector(pt.selector);
            if (!el || seen.indexOf(el) !== -1 || !isVisible(el)) { return; }
            seen.push(el);

            var color = SCREEN_COLORS[pt.adminHash] || '#1a7a5e';
            el.classList.add('zia-edit-target');
            el.style.setProperty('--zia-edit-color', color);
            decorated.push(el);

            var badge = document.createElement('button');
            badge.type = 'button';
            badge.className = 'zia-edit-badge';
            badge.style.color = color;
            badge.textContent = '✏️ ' + pt.label; // 레지스트리 코드 상수만 (XSS 원칙)
            badge.setAttribute('data-zia-point', id);
            badge.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                goAdmin(pt.adminHash);
            });
            layer.appendChild(badge);

            var rect = el.getBoundingClientRect();
            var top = rect.top + window.pageYOffset - 14; // 요소 상단에 살짝 겹침
            var left = rect.left + window.pageXOffset + 8;
            var bw = badge.offsetWidth;
            var bh = badge.offsetHeight;
            if (left + bw > viewportW - 8) { left = Math.max(8, viewportW - bw - 8); }
            if (top < 54) { top = 54; } // 상단 안내 바(48px)와 충돌 방지
            // 겹침 해소: 이미 놓인 배지와 교차하면 그 아래로 세로 오프셋
            var moved = true;
            while (moved) {
                moved = false;
                for (var i = 0; i < placed.length; i++) {
                    var p = placed[i];
                    if (left < p.left + p.width + 6 && p.left < left + bw + 6 &&
                        top < p.top + p.height + 6 && p.top < top + bh + 6) {
                        top = p.top + p.height + 6;
                        moved = true;
                    }
                }
            }
            badge.style.top = top + 'px';
            badge.style.left = left + 'px';
            placed.push({ top: top, left: left, width: bw, height: bh });
        });
    }

    /* ── focus 딥링크 — 저장 직후 "방금 바꾼 자리" 확인 (1회) ─────── */
    function applyFocus() {
        if (focusApplied || !FOCUS_ID) { return; }
        var map = window.ZIA_INJECT_MAP || {};
        var pt = map[FOCUS_ID];
        if (!pt || !pt.selector) { return; }
        var el = document.querySelector(pt.selector);
        if (!el) { return; }
        focusApplied = true;
        function inView() {
            var r = el.getBoundingClientRect();
            return r.top < window.innerHeight * 0.8 && r.bottom > window.innerHeight * 0.2;
        }
        // 로드 직후 smooth 스크롤은 인라인 init·이미지 리플로우에 취소될 수 있어 (실기기 실측)
        // 지연 시작 + 도착 실패 시 즉시 스크롤 폴백 2단.
        setTimeout(function () {
            try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
            catch (e) { el.scrollIntoView(); }
            setTimeout(function () {
                if (!inView()) {
                    try { el.scrollIntoView({ behavior: 'auto', block: 'center' }); }
                    catch (e2) { el.scrollIntoView(); }
                }
                el.classList.add('zia-edit-focus'); // 펄스 3회 (CSS animation iteration 3)
                setTimeout(function () { el.classList.remove('zia-edit-focus'); }, 3400);
            }, 1400);
        }, 500);
    }

    /* ── 사이트 내부 링크 이동 시 수정 모드 유지 (?edit=1 전파) ────── */
    function keepEditOnLinks() {
        document.addEventListener('click', function (e) {
            var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
            if (!a) { return; }
            var href = a.getAttribute('href');
            if (!href || /^(#|https?:|mailto:|tel:|javascript:)/.test(href)) { return; }
            if (a.getAttribute('target') === '_blank') { return; }
            if (!/\.html(\?|#|$)/.test(href)) { return; }
            if (/[?&]edit=1/.test(href)) { return; }
            a.setAttribute('href', href + (href.indexOf('?') === -1 ? '?' : '&') + 'edit=1');
        }, true); // capture — 이동 확정 전에 href 보정
    }

    /* ── 재배치 스케줄 (mutation·resize·scroll-end·load 디바운스) ─── */
    function schedule() {
        clearTimeout(scheduleTimer);
        scheduleTimer = setTimeout(function () {
            renderBadges();
            applyFocus();
        }, 300);
    }

    function start() {
        // 스타일 주입 (코드 상수만)
        var style = document.createElement('style');
        style.appendChild(document.createTextNode(CSS));
        document.head.appendChild(style);

        layer = document.createElement('div');
        layer.className = 'zia-edit-layer';
        document.body.appendChild(layer);

        buildBar();
        keepEditOnLinks();
        renderBadges();
        applyFocus();

        // 주입·탭 전환·스와이퍼 재구성 등 DOM 변화 추적 → 배지 재배치
        if (window.MutationObserver) {
            var mo = new MutationObserver(function (records) {
                if (Date.now() < renderGuardUntil) { return; } // 자기 유발 무시
                for (var i = 0; i < records.length; i++) {
                    var t = records[i].target;
                    if (layer && (t === layer || (layer.contains && layer.contains(t)))) { continue; }
                    schedule();
                    return;
                }
            });
            mo.observe(document.body, {
                childList: true, subtree: true,
                attributes: true, attributeFilter: ['class']
            });
        }
        window.addEventListener('resize', schedule);
        window.addEventListener('scroll', schedule, { passive: true }); // 고정 요소(#quick) 배지 추종
        window.addEventListener('load', schedule);
    }

    /* ── 기동: DOMContentLoaded + cms-inject 주입 완료 이후 ─────────── */
    function whenDomReady(cb) {
        if (document.readyState === 'complete' || document.readyState === 'interactive') { cb(); return; }
        document.addEventListener('DOMContentLoaded', cb);
    }
    function whenInjected(cb) {
        if (window.ZIA_INJECT_DONE) { cb(); return; }
        var fired = false;
        function go() { if (!fired) { fired = true; cb(); } }
        document.addEventListener('zia:inject-done', go);
        setTimeout(go, 4000); // cms-inject 부재·이상 시 안전망 (fetch 3s 타임아웃 + 여유)
    }
    whenDomReady(function () {
        whenInjected(start);
    });
})();
