// cms-inject.js — Supabase CMS 콘텐츠 주입 (admin/FRONTEND_CONTRACT.md v1.1 구현, P3-c + P3-d)
//
// [P3-d 확장 — 계약 v1.1]
// - post.html (글 상세): ?id= → v_public_post_detail 조회 → body_html 을
//   window.ZiaSanitize (화이트리스트 파서 sanitize, admin 에디터와 동일 규칙)로
//   재-sanitize 후 주입 (이중 방어). 실패·0건·sanitizer 부재 → "글을 찾을 수 없습니다".
// - I7 홈 캐러셀: home_slot 지정 글만 home_slot 순 (관리자 "홈 화면 관리" 슬롯 픽커).
//   A2 ZONE 상세 캐러셀: 해당 ZONE 발행 글 전체 (기존 유지).
// - 카드 클릭: external_url(새 탭) > has_body → post.html?id= > 비링크.
//
// 로드 위치: 각 페이지 </body> 직전, site-config.js → channel.js 다음 (동기 스크립트).
//
// [타이밍 논리 — channel.js 주석 답습]
// 본 스크립트는 </body> 직전 동기 실행이므로 fetch는 DOM 파싱 완료 직후 즉시 시작한다.
// 실제 DOM 주입은 (a) fetch 완료 AND (b) DOMContentLoaded 이후에만 수행한다 —
// 인라인 swiper init 들이 전부 DOMContentLoaded 콜백에 있으므로, 주입 시점에는
// 항상 "init 이후"가 보장된다 (Swiper 교체는 destroy(true,true) 후 재생성 — 원칙 3).
//
// [주입 원칙 — FRONTEND_CONTRACT.md §1, 위반 금지]
// 1. Graceful degradation: fetch 성공 AND rows>0 일 때만 DOM 교체.
//    실패·타임아웃(3s AbortController)·0건 → 정적 HTML 그대로 유지.
// 2. anon key + v_public_* 뷰(및 RLS 필터된 site_settings SELECT)만 사용.
// 3. Swiper 슬라이드 교체 시 기존 인스턴스 destroy(true,true) 후 재생성.
// 4. FAQ 렌더 후 아코디언 리바인딩 + faq.html 필터 재적용.
//    (⚠ 퍼블 원본의 bindAccordionEvents()는 인라인 스크립트 closure 내부 정의라
//     전역 접근 불가 — 동일 동작의 자체 바인더(bindAccordion)로 재구현. 원본과 같이
//     onclick 프로퍼티 대입 방식이라 중복 바인딩이 발생하지 않는다.)
// 5. 경로 규약: '/static/…'은 정적 자산(스테이징 서브패스 BASE 전치),
//    그 외는 Supabase Storage zia-media public URL로 해석.
// 6. data-* 속성·필터 키 = slug/id(안정 식별자), 화면 표시 = name/tab_label/faq_label.
//
// [XSS] CMS 편집 데이터는 전부 textContent/createElement 로만 DOM에 넣는다.
// innerHTML에 데이터 문자열 결합 금지. answer의 \n 은 text node + <br> 생성으로 처리.
//
// [보류] L2 (location.html 진료일정) — 정적 포맷('09:00 - 20:00')이 footer 문구
// 포맷('오전 9시 ~ 오후 8시')과 상이해 동일 값 이중 포맷 주입은 드리프트 위험.
// FRONTEND_CONTRACT.md §6 미결 #4 확정 전까지 정적 유지 (injectLocation 내 주석 참조).
//
// [N-A] I1 (히어로 slide2 CRM 개인화 문구) — P2 channel.js 소관 (토큰 치환 구현 완료).
// 본 스크립트는 I2(slide2 예약 카드 href)만 담당한다.
//
// [P3-e] 주입 지점 레지스트리(window.ZIA_INJECT_MAP) + 주입 완료 신호(zia:inject-done)를
// edit-overlay.js(수정 모드)에 제공한다 — 계약 v1.2 §8. 레지스트리는 additive 노출이며
// 주입 함수 동작과 완전 독립 (주입 로직 회귀 0 원칙).
(function () {
    'use strict';

    // ════════════════════════════════════════════════════════════════════
    // P3-e — 주입 지점 레지스트리 (window.ZIA_INJECT_MAP)
    // 소비처: edit-overlay.js (?edit=1 수정 모드 배지·focus 딥링크).
    // selector = 오버레이 배지/테두리 target (가시 컨테이너 기준 — 주입 함수의
    //   내부 셀렉터와 granularity 가 다를 수 있다. 계약 §2~§3 selector 와 짝 관리).
    // label / adminHash = 관리자 "편집 화면 단위"로 통일 (비개발자 라벨).
    // adminHash null = 대응 관리 화면 부재 지점 (배지 미표시 — dead-end 차단).
    //   - I6/A1(태그 필터): 태그 마스터 관리 화면 미구축.
    //   - C7 은 C6(.cs-info 컨테이너) 배지에 포함, L2 는 주입 보류라 레지스트리 제외.
    // config 부재 시에도 노출 (오버레이는 정적 사이트에서도 위치 안내 가능).
    // ════════════════════════════════════════════════════════════════════
    var EDIT_SCREENS = {
        settings: { hash: '#/settings', label: '병원 정보에서 수정' },
        zones:    { hash: '#/zones',    label: '진료 분야 관리에서 수정' },
        home:     { hash: '#/home',     label: '홈 화면 관리에서 수정' },
        posts:    { hash: '#/posts',    label: '글 관리에서 수정' },
        faqs:     { hash: '#/faqs',     label: '자주 묻는 질문에서 수정' },
        reviews:  { hash: '#/reviews',  label: '후기 관리에서 수정' }
    };
    var INJECT_POINTS = {
        // 공통 (7페이지)
        C1:  { selector: '.gnb-row .gnb .depth_box .depth2',              screen: 'zones' },    // 모바일 GNB (드로어 열림 시만 가시)
        C2:  { selector: '.pc-gnb-row .mega-list .depth2',                screen: 'zones' },    // PC 메가메뉴 (hover 시만 가시)
        C3:  { selector: 'header .btn.appointment',                       screen: 'settings' },
        C4:  { selector: '#quick ul',                                     screen: 'settings' },
        C5:  { selector: '.bottom-banner .btn-area',                      screen: 'settings' },
        C6:  { selector: 'footer .cs-info',                               screen: 'settings' }, // C7(biz-time) 포함 컨테이너
        C8:  { selector: 'footer .clinic-hours',                          screen: 'settings' },
        C9:  { selector: 'footer .company-info',                          screen: 'settings' },
        // index.html
        I2:  { selector: '.main-visual-swiper .slide2 .appointment-grid', screen: 'settings' },
        I3:  { selector: '.main-visual-swiper .slide1 .appointment-row',  screen: 'settings' },
        I4:  { selector: '.section-05 .tab-container',                    screen: 'zones' },
        I5:  { selector: '#contents-group-line .tab-panel.active .panel-visual', screen: 'zones' },
        I6:  { selector: '.section-05 .clinic-case-area .tag-list',       screen: null },
        I7:  { selector: '.section-05 .clinic-case-area .case-swiper',    screen: 'home' },
        I8:  { selector: '.section-07 .faq-category',                     screen: 'faqs' },
        I9:  { selector: '.section-07 #faq-list-container',               screen: 'faqs' }, // section-07 스코프 필수 — autonomic.html 이 동일 id 를 정적 재사용 (주입 무관 블록)
        I10: { selector: '.section-08 .info-list .contact',               screen: 'settings' },
        I11: { selector: '.section-08 .info-list .time',                  screen: 'settings' },
        I12: { selector: '.section-08 .address',                          screen: 'settings' },
        I13: { selector: '.section-08 .btn-group',                        screen: 'settings' },
        I14: { selector: '.real-stories .review-swiper',                  screen: 'reviews' }, // reviews.html R1 겸용 (동일 selector)
        // autonomic.html (ZONE 상세)
        A1:  { selector: '.section-clinic-cases .tag-list',               screen: null },
        A2:  { selector: '.section-clinic-cases .case-swiper',            screen: 'posts' },
        // faq.html
        F1:  { selector: '.faq-tab-area.tab-container',                   screen: 'zones' },
        F2:  { selector: '.section-faq-list .faq-accordion',              screen: 'faqs' },
        // reviews.html (R1 = I14 겸용)
        R2:  { selector: '.section-review-list .review-grid',             screen: 'reviews' },
        // location.html (L2 보류 — 주입 미구현이라 제외)
        L1:  { selector: '.section-location .contact-box',                screen: 'settings' },
        L3:  { selector: '.address-banner .addr-text',                    screen: 'settings' },
        L4:  { selector: '.address-banner .btn-group',                    screen: 'settings' },
        // post.html
        P1:  { selector: '#post-article',                                 screen: 'posts' }
    };
    window.ZIA_INJECT_MAP = (function () {
        var map = {};
        Object.keys(INJECT_POINTS).forEach(function (id) {
            var pt = INJECT_POINTS[id];
            var scr = pt.screen ? EDIT_SCREENS[pt.screen] : null;
            map[id] = {
                selector: pt.selector,
                label: scr ? scr.label : null,
                adminHash: scr ? scr.hash : null
            };
        });
        return map;
    })();

    // P3-e — 주입 완료 신호 (오버레이는 flag 선확인 후 이벤트 대기 — 레이스 무해)
    function markInjectDone() {
        window.ZIA_INJECT_DONE = true;
        try {
            document.dispatchEvent(new CustomEvent('zia:inject-done'));
        } catch (e) { /* CustomEvent 미지원 구형 — flag 로 충분 */ }
    }

    var CONFIG = window.ZIA_CONFIG || {};
    var SUPA_URL = (CONFIG.supabaseUrl || '').trim().replace(/\/+$/, '');
    var SUPA_KEY = (CONFIG.supabaseKey || '').trim();
    if (!SUPA_URL || !SUPA_KEY) {
        // config 부재/빈 값 → 전체 no-op (조용히 종료).
        // 단 post.html 은 정적 폴백 콘텐츠가 없는 동적 페이지 — "불러오는 중" 고착 방지 위해
        // notfound 상태로 전환 후 종료 (P3-d).
        if (/\/post\.html$/.test(window.location.pathname)) {
            document.addEventListener('DOMContentLoaded', function () {
                var loading = document.getElementById('post-loading');
                var notfound = document.getElementById('post-notfound');
                if (loading) { loading.style.display = 'none'; }
                if (notfound) { notfound.style.display = ''; }
            });
        }
        markInjectDone(); // P3-e — config 부재 no-op 경로도 완료 신호 (오버레이 대기 해제)
        return;
    }

    var FETCH_TIMEOUT_MS = 3000;

    // 스테이징 서브패스(/zia-preview/) 대응: 현 문서 경로에서 베이스 경로 산출.
    // deploy_staging.sh 는 *.html 의 ="/… 만 재작성하고 JS 파일은 손대지 않으므로
    // JS가 생성하는 절대경로는 런타임에 BASE를 전치해야 한다.
    var path = window.location.pathname;
    var BASE = path.replace(/\/[^\/]*$/, '');

    // 상세 페이지 실존 파일 목록 — 미구축 ZONE GNB 비링크 처리(404 차단, sprint 결정 trace).
    // zones 데이터에 "페이지 구축 여부" 판정 필드가 없어(v_public_zones는 page_path만 제공)
    // 실존 파일 상수로 유지한다. ZONE 상세 페이지 추가 구축 시 이 목록에 경로를 추가할 것.
    var BUILT_ZONE_PAGES = ['/autonomic.html'];

    // faq.html 뱃지 색상 클래스 — 정적 마크업 실측 매핑 (여성질환=bg-navy /
    // 다이어트·미용=bg-beige / 자율신경=bg-brown). 미지정 zone 은 bg-navy.
    var FAQ_BADGE_CLASS = { women_senior: 'bg-navy', diet: 'bg-beige', autonomic: 'bg-brown' };

    var SVG_NS = 'http://www.w3.org/2000/svg';
    var XLINK_NS = 'http://www.w3.org/1999/xlink';

    // ---------- 페이지 판별 (location.pathname 기반 — 스테이징 서브패스에서도 동작) ----------
    function pathEnds(suffix) {
        return path.length >= suffix.length &&
            path.lastIndexOf(suffix) === path.length - suffix.length;
    }
    function detectKind() {
        if (path === '' || pathEnds('/') || pathEnds('/index.html')) { return 'index'; }
        if (pathEnds('/faq.html')) { return 'faq'; }
        if (pathEnds('/reviews.html')) { return 'reviews'; }
        if (pathEnds('/location.html')) { return 'location'; }
        if (pathEnds('/about.html')) { return 'about'; }
        if (pathEnds('/post.html')) { return 'post'; } // 글 상세 (P3-d)
        return 'zone'; // ZONE 상세 후보 — zones.page_path 매칭으로 확정 (향후 구축 페이지 자동 커버)
    }
    var KIND = detectKind();

    // 글 상세 대상 id (?id= 숫자만 허용 — 쿼리 문자열 직결 주입 차단)
    var POST_ID = null;
    if (KIND === 'post') {
        var mPostId = /[?&]id=(\d+)(&|$)/.exec(window.location.search);
        POST_ID = mPostId ? mPostId[1] : null;
    }

    // ---------- 소스 정의 (페이지당 필요한 것만 fetch) ----------
    var SOURCES = {
        zones:    'v_public_zones?select=*&order=sort_order.asc,id.asc',
        tags:     'v_public_tags?select=*&order=sort_order.asc,id.asc',
        posts:    'v_public_posts?select=*&order=sort_order.asc,published_at.desc.nullslast,id.desc',
        reviews:  'v_public_reviews?select=*&order=sort_order.asc,id.asc',
        faqs:     'v_public_faqs?select=*&order=sort_order.asc,id.asc',
        settings: 'site_settings?select=key,value&order=key.asc'
    };
    // zones 는 전 페이지 공통 (C1/C2 GNB가 zones 소비 — 계약 §2), settings 도 공통 (C3~C9).
    var WANT = {
        index:    ['zones', 'tags', 'posts', 'reviews', 'faqs', 'settings'],
        zone:     ['zones', 'tags', 'posts', 'settings'],
        faq:      ['zones', 'faqs', 'settings'],
        reviews:  ['zones', 'reviews', 'settings'],
        location: ['zones', 'settings'],
        about:    ['zones', 'settings'],
        post:     ['zones', 'settings'] // 상세 본문은 별도 fetch (postDetail — 오케스트레이션 참조)
    };

    // ---------- 유틸 ----------
    function qs(sel, root) { return (root || document).querySelector(sel); }
    function qsa(sel, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(sel));
    }
    function clearEl(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }
    function safe(fn) {
        try { fn(); } catch (e) {
            if (window.console && window.console.warn) { window.console.warn('[cms-inject]', e); }
        }
    }
    // 값이 있을 때만 textContent 교체 (빈 값 → 정적 유지, 원칙 1)
    function setText(el, value) {
        if (el && value) { el.textContent = value; }
    }
    // 값이 있을 때만 href 교체 (channel.js 4-1 패턴 답습)
    function setHref(a, url) {
        if (!a || !url) { return; }
        a.setAttribute('href', url);
        if (/^https?:/.test(url)) {
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener');
        }
    }
    // 경로 규약 (원칙 5)
    function resolveAsset(p) {
        if (!p) { return ''; }
        if (/^https?:/.test(p)) { return p; }
        if (p.indexOf('/static/') === 0) { return BASE + p; }
        return SUPA_URL + '/storage/v1/object/public/zia-media/' + encodeURI(p.replace(/^\/+/, ''));
    }
    function resolvePage(p) { return BASE + p; }
    // 아이콘 스켈레톤 (정적 마크업 답습 — 데이터 미포함이지만 createElement 일관 유지)
    function svgIcon(svgClass, symbolId) {
        var i = document.createElement('i');
        i.className = 'icon-svg';
        var svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', svgClass);
        var use = document.createElementNS(SVG_NS, 'use');
        use.setAttributeNS(XLINK_NS, 'xlink:href',
            resolveAsset('/static/images/common/icons.svg') + '#' + symbolId);
        svg.appendChild(use);
        i.appendChild(svg);
        return i;
    }
    // \n → text node + <br> (innerHTML 미사용 — XSS 차단)
    function appendMultiline(parent, text) {
        var parts = String(text == null ? '' : text).split('\n');
        for (var i = 0; i < parts.length; i++) {
            if (i > 0) { parent.appendChild(document.createElement('br')); }
            parent.appendChild(document.createTextNode(parts[i]));
        }
    }
    function ellipsis(s, n) {
        s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
        return s.length > n ? s.slice(0, n) + '…' : s;
    }
    function makeSettings(rows) {
        var map = {};
        (rows || []).forEach(function (r) {
            if (r && r.key) { map[r.key] = (r.value == null ? '' : String(r.value)).trim(); }
        });
        return function (key) {
            return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : '';
        };
    }
    function destroySwiperOn(el) {
        if (el && el.swiper) {
            try { el.swiper.destroy(true, true); } catch (e) { /* 이미 파괴된 경우 등 */ }
        }
    }
    function updateProgress(sw, progressEl) {
        if (!progressEl) { return; }
        var total = sw.slides.length - sw.params.slidesPerView + 1;
        if (!(total > 0)) { progressEl.style.width = '0%'; return; }
        var cur = sw.activeIndex + 1;
        if (cur > total) { cur = total; }
        progressEl.style.width = ((cur / total) * 100) + '%';
    }
    function bindButtonNav(btn, url) {
        url = (url || '').trim();
        if (!btn || !url) { return; }
        btn.addEventListener('click', function () {
            if (/^https?:/.test(url)) { window.open(url, '_blank', 'noopener'); }
            else { window.location.href = url; }
        });
    }
    // 아코디언 바인딩 (원칙 4 — 렌더 후 재호출용 자체 구현. onclick 프로퍼티 = 퍼블 원본 방식)
    function bindAccordion(listEl, animate) {
        qsa('.faq-q', listEl).forEach(function (btn) {
            btn.onclick = function (e) {
                e.preventDefault();
                var item = btn.closest('li');
                var ans = item ? item.querySelector('.faq-a') : null;
                var wasActive = !!(item && item.classList.contains('active'));
                qsa('li', listEl).forEach(function (other) {
                    if (other.classList.contains('active')) {
                        other.classList.remove('active');
                        toggleAnswer(other.querySelector('.faq-a'), false, animate);
                    }
                });
                if (item && !wasActive) {
                    item.classList.add('active');
                    toggleAnswer(ans, true, animate);
                }
            };
        });
    }
    function toggleAnswer(el, show, animate) {
        if (!el) { return; }
        if (animate && window.jQuery) {
            // 홈(index §7) 퍼블 원본이 jQuery slide 애니메이션 사용 — 로드돼 있으면 동일 UX.
            // 없으면 즉시 토글 폴백 (jQuery "의존"이 아닌 선택적 활용)
            window.jQuery(el).stop()[show ? 'slideDown' : 'slideUp'](300);
        } else {
            el.style.display = show ? 'block' : 'none';
        }
    }

    // ---------- fetch (3s AbortController, 실패는 null resolve — reject 없음) ----------
    function fetchRows(resourceQuery) {
        return new Promise(function (resolve) {
            var ctrl = window.AbortController ? new AbortController() : null;
            var timer = setTimeout(function () { if (ctrl) { ctrl.abort(); } }, FETCH_TIMEOUT_MS);
            fetch(SUPA_URL + '/rest/v1/' + resourceQuery, {
                headers: {
                    apikey: SUPA_KEY,
                    Authorization: 'Bearer ' + SUPA_KEY,
                    Accept: 'application/json'
                },
                signal: ctrl ? ctrl.signal : undefined
            }).then(function (res) {
                if (!res.ok) { throw new Error('HTTP ' + res.status); }
                return res.json();
            }).then(function (rows) {
                clearTimeout(timer);
                resolve(Array.isArray(rows) ? rows : null);
            })['catch'](function () {
                clearTimeout(timer);
                resolve(null); // 실패·타임아웃 → null (정적 유지 폴백, 원칙 1)
            });
        });
    }

    // ========================================================================
    // 공통 주입 C1~C9 (6페이지 전부)
    // ========================================================================
    function zoneHref(z) {
        // 상세 페이지 보유 zone 만 링크, 미보유는 라벨만 (비링크·404 차단)
        if (z.page_path && BUILT_ZONE_PAGES.indexOf(z.page_path) !== -1) {
            return resolvePage(z.page_path);
        }
        return '';
    }
    // C1 — GNB 모바일 진료 ZONE 서브메뉴
    function injectGnbMobile(zones) {
        var ul = qs('.gnb-row .gnb .depth_box .depth2');
        if (!ul || !zones.length) { return; }
        clearEl(ul);
        zones.forEach(function (z) {
            var li = document.createElement('li');
            var a = document.createElement('a'); // href 없는 <a> = 비링크 (스타일 유지 + 404 차단)
            var href = zoneHref(z);
            if (href) { a.setAttribute('href', href); }
            a.textContent = z.name;
            li.appendChild(a);
            ul.appendChild(li);
        });
    }
    // C2 — GNB PC 메가메뉴
    function injectGnbPc(zones) {
        var ul = qs('.pc-gnb-row .mega-list .depth2');
        if (!ul || !zones.length) { return; }
        clearEl(ul);
        zones.forEach(function (z) {
            var li = document.createElement('li');
            var a = document.createElement('a');
            var href = zoneHref(z);
            if (href) { a.setAttribute('href', href); }
            var span = document.createElement('span');
            span.textContent = z.name;
            a.appendChild(span);
            a.appendChild(svgIcon('icon-top', 'icon-top'));
            li.appendChild(a);
            ul.appendChild(li);
        });
    }
    function injectCommon(zones, S) {
        injectGnbMobile(zones);                                             // C1
        injectGnbPc(zones);                                                 // C2
        setHref(qs('header .btn.appointment'), S('link_reserve'));          // C3
        var quick = qsa('#quick ul li a');                                  // C4 (4번째 li 는 top 버튼 — 제외)
        setHref(quick[0], S('link_tel'));
        setHref(quick[1], S('link_kakao'));
        setHref(quick[2], S('link_naver_booking'));
        setHref(qs('.bottom-banner .btn-area a'), S('link_reserve'));       // C5 (location.html 은 배너 부재 → null skip)
        setText(qs('footer .cs-info .tel'), S('phone'));                    // C6
        setText(qs('footer .cs-info .biz-time'), S('hours_note'));          // C7
        var hours = qsa('footer .clinic-hours ul li p');                    // C8 (순서: 평일/주말/점심)
        setText(hours[0], S('hours_weekday'));
        setText(hours[1], S('hours_weekend'));
        setText(hours[2], S('hours_lunch'));
        var comp = qsa('footer .company-info ul li span');                  // C9 (순서: 대표자/사업자번호/주소)
        setText(comp[0], S('representative'));
        setText(comp[1], S('biz_reg_no'));
        setText(comp[2], S('address'));
    }

    // ========================================================================
    // index — I2/I3/I10~I13 (site_settings 직결 지점)
    // ========================================================================
    function injectIndexSettings(S) {
        // I2 — slide2 예약 카드 3종 (순서: 카카오/전화/네이버).
        //      channel.js 가 비 CRM 채널에서 slide2 를 제거한 경우 셀렉터 0건 → 자연 skip.
        var cards = qsa('.slide2 .appointment-grid .appoint-card');
        setHref(cards[0], S('link_kakao'));
        setHref(cards[1], S('link_tel'));
        setHref(cards[2], S('link_naver_booking'));

        // I3 — slide1 CTA 2버튼 (button 요소 → click 배선 방식 채택. P3-c 결정:
        //      a 치환은 마크업 구조 변경이라 배제).
        //      ⚠ 중복 배선 방지: channel.js 가 이미 배선한 버튼(해당 ZIA_CONFIG 값 존재)은
        //      건드리지 않는다 — 이중 addEventListener 시 창 2회 오픈.
        var btns = qsa('.slide1 .appointment-row button');
        var cfgPhone = CONFIG.phone ? String(CONFIG.phone).trim() : '';
        var cfgNaver = (CONFIG.naverBookingUrl || '').trim();
        if (btns[0] && !cfgPhone) { bindButtonNav(btns[0], S('link_tel')); }
        if (btns[1] && !cfgNaver) { bindButtonNav(btns[1], S('link_reserve')); }

        // I10 — §8 문의전화
        setText(qs('.section-08 .info-list .contact dd strong'), S('phone'));
        // I11 — §8 진료일정 (정적 문구가 '평일 …' 접두 포함 구성이라 접두 합성 주입)
        var tp = qsa('.section-08 .info-list .time dd p strong');
        if (S('hours_weekday')) { setText(tp[0], '평일 ' + S('hours_weekday')); }
        if (S('hours_weekend')) { setText(tp[1], '주말·공휴일 ' + S('hours_weekend')); }
        if (S('hours_lunch')) {
            setText(qs('.section-08 .info-list .time dd .notice'), '*점심시간 ' + S('hours_lunch'));
        }
        // I12 — §8 주소
        setText(qs('.section-08 .address .addr-main strong'), S('address'));
        setText(qs('.section-08 .address .addr-sub'), S('address_sub'));
        // I13 — §8 버튼 2종
        setHref(qs('.section-08 .btn-group .btn-naver'), S('naver_map_url'));
        setHref(qs('.section-08 .btn-group .btn-reserve'), S('link_reserve'));
    }

    // ========================================================================
    // index — I4/I5/I6/I7 진료소개 탭 시스템
    // ========================================================================
    function byHomeTabOrder(a, b) {
        var ao = (a.home_tab_order == null) ? 9999 : a.home_tab_order;
        var bo = (b.home_tab_order == null) ? 9999 : b.home_tab_order;
        return (ao - bo) || (a.sort_order - b.sort_order) || (a.id - b.id);
    }
    function injectHomeTabs(zones, tags, posts) {
        if (!window.Swiper) { return; }
        var container = qs('.section-05 .tab-container');
        var group = document.getElementById('contents-group-line');
        if (!container || !group) { return; }
        var swiperEl = container.querySelector('.swiper');
        var wrap = swiperEl ? swiperEl.querySelector('.swiper-wrapper') : null;
        if (!wrap) { return; }
        var tabZones = zones.filter(function (z) { return z.show_in_home_tabs; });
        if (!tabZones.length) { return; } // 0건 → 정적 5탭 유지 (원칙 1)
        tabZones.sort(byHomeTabOrder);

        // I4-1. 패널 배정 — 정적 패널(#line-1~5)을 순서대로 재사용하고 id를 slug 기반 재생성.
        //       zone 수 > 정적 패널 수 → placeholder 패널 신규 생성 (정적 탭2~5 와 동일한 텍스트 패널).
        //       zone 수 < 정적 패널 수 → 잔여 정적 패널 제거 (주입 성공 상태 — zones 가 단일 소스).
        var staticPanels = qsa('.tab-panel', group);
        var panels = [];
        tabZones.forEach(function (z, i) {
            var p = staticPanels[i];
            if (!p) {
                p = document.createElement('div');
                p.className = 'tab-panel';
                p.textContent = z.tab_label;
                group.appendChild(p);
            }
            p.id = 'zone-' + z.slug; // data-target 은 slug 기반 재생성 (계약 I4, 원칙 6)
            p.classList[i === 0 ? 'add' : 'remove']('active');
            panels.push(p);
        });
        for (var k = tabZones.length; k < staticPanels.length; k++) {
            group.removeChild(staticPanels[k]);
        }

        // I4-2. 탭 버튼 재렌더 — Swiper destroy 후 재생성 (원칙 3)
        destroySwiperOn(swiperEl);
        clearEl(wrap);
        var buttons = [];
        tabZones.forEach(function (z, i) {
            var slide = document.createElement('div');
            slide.className = 'swiper-slide';
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tab-btn' + (i === 0 ? ' active' : '');
            btn.setAttribute('data-target', '#zone-' + z.slug);
            btn.textContent = z.tab_label; // 뷰가 coalesce(tab_label, name) 반환
            slide.appendChild(btn);
            wrap.appendChild(slide);
            buttons.push(btn);
        });
        // 인라인 initTabMenus() 와 동일 파라미터
        var tabSwiper = new window.Swiper(swiperEl, {
            slidesPerView: 2.8,
            spaceBetween: 0,
            freeMode: true,
            observer: true,
            observeParents: true,
            resizeObserver: true,
            breakpoints: {
                768: { slidesPerView: 3.5, spaceBetween: 12 },
                1024: { slidesPerView: 5, spaceBetween: 0 }
            }
        });
        // 탭 클릭 리바인딩 (인라인 원본 동작 재현 — DOM 교체로 원본 핸들러는 소멸)
        buttons.forEach(function (btn, idx) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                buttons.forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                tabSwiper.slideTo(idx, 300, true);
                qsa('.tab-panel', group).forEach(function (p) { p.classList.remove('active'); });
                var target = document.getElementById('zone-' + tabZones[idx].slug);
                if (target) { target.classList.add('active'); }
            });
        });

        // I5 — 패널 헤더 (english_label/name/description/hero_image_path)
        tabZones.forEach(function (z, i) { fillPanelVisual(panels[i], z); });
        // I6/I7 — 케이스 영역 보유 패널에 태그·글 주입 (정적으론 패널1=자율신경계만 보유).
        //         홈 캐러셀은 home_slot 지정 글만 (계약 v1.1 — homeOnly).
        tabZones.forEach(function (z, i) {
            var area = panels[i].querySelector('.clinic-case-area');
            if (area) { setupCaseArea(area, z, tags, posts, true); }
        });
    }
    function fillPanelVisual(panel, z) {
        var vis = panel.querySelector('.panel-visual');
        var hasData = !!(z.english_label || z.description || z.hero_image_path);
        if (!vis) {
            if (!hasData) { return; } // 데이터 없으면 placeholder 텍스트 패널 유지 (계약 I5 fallback)
            // placeholder 패널 → 정적 패널1과 동일 구조 생성 (내용물 교체 범위)
            clearEl(panel);
            vis = document.createElement('div');
            vis.className = 'panel-visual';
            var text = document.createElement('div');
            text.className = 'text';
            text.appendChild(document.createElement('span'));
            text.appendChild(document.createElement('h3'));
            text.appendChild(document.createElement('p'));
            var imgRow = document.createElement('div');
            imgRow.className = 'img-row';
            imgRow.appendChild(document.createElement('img'));
            vis.appendChild(text);
            vis.appendChild(imgRow);
            panel.appendChild(vis);
        }
        setText(vis.querySelector('.text span'), z.english_label);
        setText(vis.querySelector('.text h3'), z.name);
        setText(vis.querySelector('.text p'), z.description);
        var img = vis.querySelector('.img-row img');
        if (img && z.hero_image_path) {
            img.setAttribute('src', resolveAsset(z.hero_image_path));
            img.setAttribute('alt', z.name);
        }
    }

    // ========================================================================
    // I6/I7 · A1/A2 — ZONE 태그 필터 + 연계 캐러셀 (index 탭 패널 / ZONE 상세 공용)
    // ========================================================================
    function setupCaseArea(area, zone, tags, posts, homeOnly) {
        var zoneTags = (tags || []).filter(function (t) { return t.zone_slug === zone.slug; });
        var zonePosts = (posts || []).filter(function (p) { return p.zone_slug === zone.slug; });
        if (homeOnly) {
            // I7 (v1.1) — 홈 캐러셀 = home_slot 지정 글만 home_slot 순 (슬롯 픽커 소관).
            //             0건 → 정적 데모 카드 유지 (원칙 1).
            zonePosts = zonePosts.filter(function (p) { return p.home_slot != null; });
            zonePosts.sort(function (a, b) { return a.home_slot - b.home_slot; });
        }
        // I7/A2 — 해당 ZONE 소속 글만 자동 호출 (§7.1). 0건 → 정적 데모 카드 유지.
        if (zonePosts.length) { rebuildCaseSwiper(area, zonePosts); }
        // I6/A1 — 태그 주입 성공 시 정적 alert() 핸들러는 DOM 교체로 소멸 → 실 필터로 대체.
        //         태그 주입 실패(0건·fetch 실패) 시 정적 태그·alert 핸들러 불변 (계약 폴백 원칙).
        if (zoneTags.length) { rebuildTagList(area, zoneTags, zonePosts); }
    }
    function caseSlide(p) {
        var slide = document.createElement('div');
        slide.className = 'swiper-slide';
        var a = document.createElement('a');
        a.className = 'case-card';
        // 클릭 타깃 사다리 (계약 v1.1): external_url(새 탭) > has_body → 온사이트 상세 > 비링크
        var url = (p.external_url || '').trim();
        if (/^https?:/.test(url)) {
            a.setAttribute('href', url);
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener');
        } else if (p.has_body) {
            a.setAttribute('href', BASE + '/post.html?id=' + p.id); // 서브패스 BASE 전치 (원칙 5)
        } else {
            a.setAttribute('href', '#none');
        }
        var imgBg = document.createElement('div');
        imgBg.className = 'img-bg';
        if (p.thumbnail_path) {
            var img = document.createElement('img');
            img.setAttribute('src', resolveAsset(p.thumbnail_path));
            img.setAttribute('alt', p.title || '');
            imgBg.appendChild(img);
        }
        a.appendChild(imgBg);
        var overlay = document.createElement('div');
        overlay.className = 'info-overlay';
        if (p.badge) {
            var badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = p.badge;
            overlay.appendChild(badge);
        }
        var title = document.createElement('p');
        title.className = 'title';
        title.textContent = p.title || '';
        overlay.appendChild(title);
        a.appendChild(overlay);
        slide.appendChild(a);
        return slide;
    }
    function rebuildCaseSwiper(area, list) {
        if (!window.Swiper) { return; }
        var swiperEl = area.querySelector('.case-swiper');
        var wrap = swiperEl ? swiperEl.querySelector('.swiper-wrapper') : null;
        if (!wrap) { return; }
        destroySwiperOn(swiperEl); // 원칙 3
        clearEl(wrap);
        list.forEach(function (p) { wrap.appendChild(caseSlide(p)); });
        var progress = area.querySelector('.progress-fill');
        // 인라인 초기화(index initClinicCases / autonomic initSubClinicCases)와 동일 파라미터
        new window.Swiper(swiperEl, {
            slidesPerView: 1.2,
            spaceBetween: 20,
            observer: true,
            observeParents: true,
            resizeObserver: true,
            navigation: {
                nextEl: area.querySelector('.swiper-button-next'),
                prevEl: area.querySelector('.swiper-button-prev')
            },
            breakpoints: {
                768: { slidesPerView: 2.2, spaceBetween: 30 },
                1200: { slidesPerView: 3, spaceBetween: 40 }
            },
            on: {
                init: function () { updateProgress(this, progress); },
                slideChange: function () { updateProgress(this, progress); }
            }
        });
    }
    function rebuildTagList(area, zoneTags, zonePosts) {
        var listEl = area.querySelector('.tag-list');
        if (!listEl) { return; }
        clearEl(listEl);
        var items = [{ label: '전체', tag: null }].concat(zoneTags.map(function (t) {
            return { label: '#' + t.name, tag: t }; // name 은 '#' 미포함 저장 — 표시 시 접두 (schema 주석)
        }));
        items.forEach(function (item, i) {
            var li = document.createElement('li');
            if (i === 0) { li.className = 'active'; }
            var a = document.createElement('a');
            a.setAttribute('href', '#none');
            if (item.tag) { a.setAttribute('data-tag-id', String(item.tag.id)); } // 계약 I6: data-* 에 tag id
            a.textContent = item.label;
            a.addEventListener('click', function (e) {
                e.preventDefault();
                qsa('li', listEl).forEach(function (x) { x.classList.remove('active'); });
                li.classList.add('active');
                // 실 필터: 글 데이터가 있을 때만 캐러셀 재구성.
                // (태그만 주입되고 발행 글 0건이면 active 토글만 — 정적 캐러셀 유지, 원칙 1)
                if (!zonePosts.length) { return; }
                var filtered = item.tag
                    ? zonePosts.filter(function (p) {
                        return (p.tag_names || []).indexOf(item.tag.name) !== -1;
                    })
                    : zonePosts;
                rebuildCaseSwiper(area, filtered);
            });
            li.appendChild(a);
            listEl.appendChild(li);
        });
    }
    // A1/A2 — ZONE 상세 (autonomic.html + 향후 구축 페이지). 페이지 → zone 매칭은
    // zones.page_path suffix 비교 (계약 A1 의 <body data-zone> 권장안은 마크업 수정이
    // 필요해 배제 — 마크업 무손상 원칙 우선. page_path 가 동일 판별을 데이터로 제공).
    function injectZoneDetail(zones, tags, posts) {
        var area = qs('.section-clinic-cases .clinic-case-area');
        if (!area) { return; }
        var zone = null;
        zones.forEach(function (z) {
            if (!zone && z.page_path && pathEnds(z.page_path)) { zone = z; }
        });
        if (!zone) { return; } // 매칭 실패 → 정적 유지
        setupCaseArea(area, zone, tags, posts);
    }

    // ========================================================================
    // index — I8/I9 홈 FAQ
    // ========================================================================
    function renderHomeFaqList(listEl, items) {
        clearEl(listEl);
        items.forEach(function (f, i) {
            var li = document.createElement('li');
            if (i === 0) { li.className = 'active'; } // 정적 원본: 첫 항목 열림
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'faq-q';
            var strong = document.createElement('strong');
            strong.textContent = f.question;
            btn.appendChild(strong);
            btn.appendChild(svgIcon('icon-arrow-def', 'icon-arrow-def'));
            var ans = document.createElement('div');
            ans.className = 'faq-a';
            ans.style.display = (i === 0) ? 'block' : 'none';
            var p = document.createElement('p');
            appendMultiline(p, f.answer);
            ans.appendChild(p);
            li.appendChild(btn);
            li.appendChild(ans);
            listEl.appendChild(li);
        });
        bindAccordion(listEl, true); // 렌더 후 아코디언 리바인딩 (원칙 4, 퍼블 계약)
    }
    function injectHomeFaq(zones, faqs) {
        var listEl = document.getElementById('faq-list-container');
        var primaries = zones.filter(function (z) { return z.is_primary; });
        var rows = faqs || [];

        // I9 — 초기: show_on_home=true (limit 4). 0건 → 정적 4건 유지.
        var initial = rows.filter(function (f) { return f.show_on_home; }).slice(0, 4);
        if (listEl && initial.length) { renderHomeFaqList(listEl, initial); }

        // I8 — 카테고리: is_primary zone 의 faq_label, data-category = slug (원칙 6).
        //      초기 active 는 초기 리스트(zone_slug)와 정합시킴.
        var catList = qs('.section-07 .faq-category');
        if (catList && primaries.length) {
            var activeSlug = initial.length ? initial[0].zone_slug : primaries[0].slug;
            clearEl(catList);
            primaries.forEach(function (z) {
                var li = document.createElement('li');
                if (z.slug === activeSlug) { li.className = 'active'; }
                var a = document.createElement('a');
                a.setAttribute('href', '#none');
                a.setAttribute('data-category', z.slug);
                a.textContent = z.faq_label; // 뷰가 coalesce(faq_label, name) 반환
                a.addEventListener('click', function (e) {
                    e.preventDefault();
                    qsa('li', catList).forEach(function (x) { x.classList.remove('active'); });
                    li.classList.add('active');
                    if (!listEl || !rows.length) { return; } // FAQ 데이터 없으면 정적 리스트 유지
                    var filtered = rows.filter(function (f) { return f.zone_slug === z.slug; }).slice(0, 4);
                    if (!filtered.length) { return; } // 0건 → 기존 리스트 유지 (원칙 1)
                    renderHomeFaqList(listEl, filtered);
                });
                li.appendChild(a);
                catList.appendChild(li);
            });
            if (!qs('li.active', catList)) { catList.firstChild.className = 'active'; }
        }
    }

    // ========================================================================
    // faq.html — F1/F2/F3
    // ========================================================================
    function injectFaqPage(zones, faqs) {
        if (!window.Swiper) { return; }
        var tabArea = qs('.faq-tab-area.tab-container');
        var listEl = qs('.section-faq-list .faq-accordion');
        if (!tabArea || !listEl) { return; }
        var primaries = zones.filter(function (z) { return z.is_primary; });
        var rows = faqs || [];
        // F1+F2 는 동시 성공일 때만 주입 — 정적 필터 핸들러는 DOMContentLoaded 시점의
        // li 참조를 closure 로 캡처하므로, 리스트만 교체하면 탭 필터가 소멸 DOM 을 조작해
        // 무동작이 된다 (원칙 4 "필터 재적용" 정합 확보를 위한 결합). 둘 중 하나라도
        // 0건/실패 → 페이지 전체 정적 유지.
        if (!primaries.length || !rows.length) { return; }

        // F2 — 전 건 렌더 (li[data-category]=zone_slug, 뱃지=category_label)
        clearEl(listEl);
        rows.forEach(function (f, i) {
            var li = document.createElement('li');
            if (i === 0) { li.className = 'active'; } // 정적 원본: 첫 항목 열림
            li.setAttribute('data-category', f.zone_slug);
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'faq-q';
            var qwrap = document.createElement('div');
            qwrap.className = 'q-wrap';
            var badge = document.createElement('span');
            badge.className = 'badge ' + (FAQ_BADGE_CLASS[f.zone_slug] || 'bg-navy');
            badge.textContent = f.category_label;
            var strong = document.createElement('strong');
            strong.textContent = f.question;
            qwrap.appendChild(badge);
            qwrap.appendChild(strong);
            btn.appendChild(qwrap);
            btn.appendChild(svgIcon('icon-arrow-def', 'icon-arrow-def'));
            var ans = document.createElement('div');
            ans.className = 'faq-a';
            ans.style.display = (i === 0) ? 'block' : 'none';
            var p = document.createElement('p');
            appendMultiline(p, f.answer);
            ans.appendChild(p);
            li.appendChild(btn);
            li.appendChild(ans);
            listEl.appendChild(li);
        });
        bindAccordion(listEl, false); // 서브 페이지 원본은 display 토글 (애니메이션 없음)

        // F1 — 카테고리 탭: '전체' 고정 + is_primary faq_label. data-target=slug
        //      (정적 'women/diet/nerve' 커스텀 키 → slug 대체, 계약 F1)
        var swiperEl = tabArea.querySelector('.swiper');
        var wrap = swiperEl ? swiperEl.querySelector('.swiper-wrapper') : null;
        if (wrap) {
            destroySwiperOn(swiperEl); // 원칙 3
            clearEl(wrap);
            var defs = [{ slug: 'all', label: '전체' }].concat(primaries.map(function (z) {
                return { slug: z.slug, label: z.faq_label };
            }));
            var buttons = [];
            defs.forEach(function (d, i) {
                var slide = document.createElement('div');
                slide.className = 'swiper-slide';
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'tab-btn' + (i === 0 ? ' active' : '');
                btn.setAttribute('data-target', d.slug);
                btn.textContent = d.label;
                slide.appendChild(btn);
                wrap.appendChild(slide);
                buttons.push(btn);
            });
            // 인라인 initFaqTabSwiper() 와 동일 파라미터
            var tabSwiper = new window.Swiper(swiperEl, {
                slidesPerView: 2.3,
                spaceBetween: 0,
                freeMode: true,
                observer: true,
                observeParents: true,
                resizeObserver: true,
                breakpoints: {
                    768: { slidesPerView: 3.5 },
                    1200: { slidesPerView: 4, freeMode: false, allowTouchMove: false }
                }
            });
            // 필터 재적용 (인라인 원본 동작 재현 — 새로 렌더한 li 대상)
            buttons.forEach(function (btn, idx) {
                btn.addEventListener('click', function (e) {
                    e.preventDefault();
                    buttons.forEach(function (b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    tabSwiper.slideTo(idx, 300, true);
                    var target = defs[idx].slug;
                    qsa('li', listEl).forEach(function (item) {
                        item.classList.remove('active');
                        var ansEl = item.querySelector('.faq-a');
                        if (ansEl) { ansEl.style.display = 'none'; }
                        item.style.display =
                            (target === 'all' || item.getAttribute('data-category') === target)
                                ? 'block' : 'none';
                    });
                });
            });
        }

        // F3 — 전 건 로드 → 페이지네이션 숨김 (계약 MVP 허용안)
        var pag = qs('.section-faq-list .pagination-container');
        if (pag) { pag.style.display = 'none'; }
    }

    // ========================================================================
    // I14 / R1 — 후기 스와이퍼 (index §6 / reviews.html 상단 — 마크업 동일 구조)
    // ========================================================================
    function reviewTextSlide(r, S) {
        var slide = document.createElement('div');
        slide.className = 'swiper-slide card-text';
        var a = document.createElement('a');
        a.className = 'review-card';
        var url = (r.more_url || '').trim() || S('naver_place_review_url'); // 빈 값 → 플레이스 폴백 (계약 I14)
        setHref(a, url);
        if (!url) { a.setAttribute('href', '#none'); }
        var txt = document.createElement('p');
        txt.className = 'txt';
        txt.textContent = r.body || '';
        a.appendChild(txt);
        var more = document.createElement('strong');
        more.className = 'btn-more';
        var span = document.createElement('span');
        span.textContent = '더보기';
        more.appendChild(span);
        more.appendChild(svgIcon('icon-top', 'icon-top'));
        a.appendChild(more);
        slide.appendChild(a);
        return slide;
    }
    function injectReviewSwiper(reviews, S) {
        if (!window.Swiper) { return; }
        var highlights = reviews.filter(function (r) { return r.is_highlight; });
        if (!highlights.length) { return; } // 시드 후기 draft 상태 → 발행 전까지 자연 폴백 (계약 I14)
        var swiperEl = qs('.real-stories .review-swiper'); // index §6(.section-06.real-stories)·reviews.html 공용
        var wrap = swiperEl ? swiperEl.querySelector('.swiper-wrapper') : null;
        if (!wrap) { return; }
        destroySwiperOn(swiperEl); // 원칙 3 (loop 모드 — 재생성 없이는 깨짐)
        // 텍스트 카드만 후기 데이터로 교체, 이미지 장식 슬라이드(card-img)는 위치 그대로 유지
        var j = 0;
        qsa('.swiper-slide', wrap).forEach(function (s) {
            if (!s.classList.contains('card-text')) { return; }
            if (j < highlights.length) {
                wrap.replaceChild(reviewTextSlide(highlights[j], S), s);
                j++;
            } else {
                wrap.removeChild(s); // 후기 수 < 정적 카드 수 → 잔여 텍스트 카드 제거
            }
        });
        for (; j < highlights.length; j++) {
            wrap.appendChild(reviewTextSlide(highlights[j], S)); // 후기 수 > 정적 카드 수 → 뒤에 추가
        }
        // 인라인 초기화와 동일 파라미터 (index §6 = reviews.html 동일 값 실측)
        new window.Swiper(swiperEl, {
            slidesPerView: 'auto',
            spaceBetween: 20,
            loop: true,
            speed: 600,
            autoplay: { delay: 300000, disableOnInteraction: false },
            breakpoints: { 1200: { spaceBetween: 30 } }
        });
    }

    // ========================================================================
    // reviews.html — R2/R3
    // ========================================================================
    function reviewGridItem(r, S) {
        var a = document.createElement('a');
        a.className = 'review-item';
        var url = (r.more_url || '').trim() || S('naver_place_review_url');
        setHref(a, url);
        if (!url) { a.setAttribute('href', '#none'); }
        var imgBox = document.createElement('div');
        imgBox.className = 'img-box';
        if (r.thumbnail_path) {
            var img = document.createElement('img');
            img.setAttribute('src', resolveAsset(r.thumbnail_path));
            img.setAttribute('alt', r.title || '치료후기 이미지');
            imgBox.appendChild(img);
        }
        a.appendChild(imgBox);
        var info = document.createElement('div');
        info.className = 'info-box';
        var tags = document.createElement('div');
        tags.className = 'tags';
        // 뱃지 최대 2개 (계약 R2). 색상 클래스는 정적 실측 순서(bg-navy → bg-brown) 답습.
        (r.labels || []).slice(0, 2).forEach(function (label, i) {
            var badge = document.createElement('span');
            badge.className = 'badge ' + (i === 0 ? 'bg-navy' : 'bg-brown');
            badge.textContent = label;
            tags.appendChild(badge);
        });
        info.appendChild(tags);
        var title = document.createElement('p');
        title.className = 'title';
        title.textContent = r.title || ellipsis(r.body, 24); // title 없으면 body 앞부분 말줄임 (계약 R2)
        info.appendChild(title);
        a.appendChild(info);
        return a;
    }
    function injectReviewGrid(reviews, S) {
        var grid = qs('.section-review-list .review-grid');
        if (!grid || !reviews.length) { return; } // 0건 → 정적 9카드 유지
        clearEl(grid);
        reviews.forEach(function (r) { grid.appendChild(reviewGridItem(r, S)); });
        // R3 — 전 건 로드 → 페이지네이션 숨김 (계약 MVP 허용안)
        var pag = qs('.section-review-list .pagination-container');
        if (pag) { pag.style.display = 'none'; }
    }

    // ========================================================================
    // location.html — L1/L3/L4 (L2 보류)
    // ========================================================================
    function injectLocation(S) {
        // L1 — 문의전화
        setText(qs('.section-location .contact-box .tel'), S('phone'));
        // L2 — 진료일정: ⚠ 보류 (구현하지 않음).
        //      정적 포맷('09:00 - 20:00' / '*점심시간 오후 2시 - 3시')이 footer·site_settings
        //      문구 포맷('오전 9시 ~ 오후 8시')과 상이하다. 동일 값 이중 포맷 주입은
        //      드리프트 위험 → FRONTEND_CONTRACT.md §6 미결 #4 (포맷 통일 vs 파생 포맷
        //      규칙) 확정 전까지 정적 유지. 확정 시 .section-location .time-list li +
        //      .notice span 주입을 이 자리에서 활성화한다.
        // L3 — 주소 배너
        setText(qs('.address-banner .addr-text strong'), S('address'));
        setText(qs('.address-banner .addr-text span'), S('address_sub'));
        // L4 — 버튼 2종 (순서: 네이버 길찾기 / 진료예약)
        var btns = qsa('.address-banner .btn-group a');
        setHref(btns[0], S('naver_map_url'));
        setHref(btns[1], S('link_reserve'));
    }

    // ========================================================================
    // post.html — P1 글 상세 (계약 v1.1, P3-d)
    // ========================================================================
    function fmtDate(iso) {
        if (!iso) { return ''; }
        var d = new Date(iso);
        if (isNaN(d.getTime())) { return ''; }
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
    }
    function postShow(which) { // 'loading' | 'notfound' | 'article'
        var ids = { loading: 'post-loading', notfound: 'post-notfound', article: 'post-article' };
        Object.keys(ids).forEach(function (k) {
            var el = document.getElementById(ids[k]);
            if (el) { el.style.display = (k === which) ? '' : 'none'; }
        });
    }
    function injectPostDetail(rows, zones) {
        if (!document.getElementById('post-article')) { return; } // post.html 골격 아님 → no-op
        var row = rows && rows.length ? rows[0] : null;
        var sanitizer = window.ZiaSanitize;
        // fetch 실패·0건·id 부재·sanitizer 부재 → "글을 찾을 수 없습니다"
        // (본 페이지는 정적 폴백 콘텐츠가 없는 동적 페이지 — notfound 가 곧 폴백 상태)
        if (!row || !sanitizer) { postShow('notfound'); return; }

        var badge = document.getElementById('post-badge');
        if (badge && row.badge) {
            badge.textContent = row.badge;
            badge.style.display = '';
        }
        var titleEl = document.getElementById('post-title');
        if (titleEl) { titleEl.textContent = row.title || ''; }
        if (row.title) { document.title = row.title + ' — 지아한의원'; }
        setText(qs('#post-zone'), row.zone_name);
        setText(qs('#post-date'), fmtDate(row.published_at));

        // 본문 — 렌더 직전 admin 과 동일 화이트리스트로 재-sanitize (이중 방어).
        // sanitize 산출물만 innerHTML 진입 (원문 결합 금지).
        var bodyEl = document.getElementById('post-body');
        if (bodyEl) { bodyEl.innerHTML = sanitizer.sanitize(row.body_html || ''); }

        // 블로그 원문 보기 (http/https 만)
        var ext = document.getElementById('post-external');
        var extUrl = (row.external_url || '').trim();
        if (ext && /^https?:/.test(extUrl)) {
            ext.setAttribute('href', extUrl);
            ext.style.display = '';
        }
        // 목록으로 — 소속 ZONE 상세 페이지가 구축돼 있으면 그리로, 아니면 홈 유지
        var back = document.getElementById('post-back');
        if (back && zones) {
            var zone = null;
            zones.forEach(function (z) { if (!zone && z.slug === row.zone_slug) { zone = z; } });
            if (zone && zone.page_path && BUILT_ZONE_PAGES.indexOf(zone.page_path) !== -1) {
                back.setAttribute('href', resolvePage(zone.page_path));
            }
        }
        postShow('article');
    }

    // ========================================================================
    // 오케스트레이션 — fetch 병렬 시작 → DOMContentLoaded 이후 주입
    // ========================================================================
    function apply(d) {
        var zones = d.zones || [];
        var S = makeSettings(d.settings);
        safe(function () { injectCommon(zones, S); });
        if (KIND === 'index') {
            safe(function () { injectIndexSettings(S); });
            safe(function () { injectHomeTabs(zones, d.tags || [], d.posts || []); });
            safe(function () { injectHomeFaq(zones, d.faqs || []); });
            safe(function () { injectReviewSwiper(d.reviews || [], S); });
        } else if (KIND === 'zone') {
            safe(function () { injectZoneDetail(zones, d.tags || [], d.posts || []); });
        } else if (KIND === 'faq') {
            safe(function () { injectFaqPage(zones, d.faqs || []); });
        } else if (KIND === 'reviews') {
            safe(function () { injectReviewSwiper(d.reviews || [], S); });
            safe(function () { injectReviewGrid(d.reviews || [], S); });
        } else if (KIND === 'location') {
            safe(function () { injectLocation(S); });
        } else if (KIND === 'post') {
            safe(function () { injectPostDetail(d.postDetail, zones); });
        }
        // about: 공통(C1~C9)만 — 본문 편집은 계약 v1.0 스코프 제외 (계약 §3 about)
    }

    // DOMContentLoaded 대기 — 본 스크립트는 </body> 직전 동기 실행이라 이 시점의
    // readyState 는 'interactive' (이벤트 발화 전). 여기서 등록하는 리스너는 위쪽
    // 인라인 init 리스너들보다 늦게 등록되어 항상 init "이후"에 실행된다 (channel.js 답습).
    var domReady = new Promise(function (resolve) {
        if (document.readyState === 'complete') { resolve(); return; }
        document.addEventListener('DOMContentLoaded', resolve);
        window.addEventListener('load', resolve); // 방어적 이중 안전망 (중복 resolve 무해)
    });

    var keys = WANT[KIND] || ['zones', 'settings'];
    // Promise.allSettled 병렬 — fetchRows 는 실패 시 null resolve 이므로 각 소스 독립 폴백
    var settleAll = window.Promise.allSettled
        ? window.Promise.allSettled.bind(window.Promise)
        : function (ps) { // 구형 브라우저 폴백 (fetchRows 는 reject 하지 않으므로 동등)
            return Promise.all(ps.map(function (p) {
                return p.then(
                    function (v) { return { status: 'fulfilled', value: v }; },
                    function (e) { return { status: 'rejected', reason: e }; }
                );
            }));
        };

    // 글 상세 fetch (post.html 전용) — id 없으면 즉시 null (notfound 경로)
    var detailPromise = (KIND === 'post' && POST_ID)
        ? fetchRows('v_public_post_detail?select=*&id=eq.' + POST_ID + '&limit=1')
        : Promise.resolve(null);

    Promise.all([domReady, settleAll(keys.map(function (k) { return fetchRows(SOURCES[k]); })), detailPromise])
        .then(function (out) {
            var results = out[1];
            var data = {};
            keys.forEach(function (k, i) {
                var r = results[i];
                data[k] = (r && r.status === 'fulfilled') ? r.value : null;
            });
            data.postDetail = out[2];
            safe(function () { apply(data); });
            markInjectDone(); // P3-e — 주입 완료 신호 (성공·부분 실패 폴백 모두 이 시점 확정)
        });
})();
