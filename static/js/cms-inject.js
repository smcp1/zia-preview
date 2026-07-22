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
        // index.html — 홈 누적 블록 (P3-g, 런타임 생성 DOM. 활성 탭 패널 안에만 존재)
        I15: { selector: '.section-05 .tab-panel.active .zone-recent',    screen: 'posts' },
        // autonomic.html (ZONE 상세)
        A1:  { selector: '.section-clinic-cases .tag-list',               screen: null },
        A2:  { selector: '.section-clinic-cases .case-swiper',            screen: 'posts' },
        // zone.html (분야 글 아카이브 — P3-g)
        Z1:  { selector: '.zone-page .section-visual',                    screen: 'zones' },
        Z2:  { selector: '.zone-page .tag-list',                          screen: null },  // 태그 마스터 관리 화면 미구축 (I6/A1 답습)
        Z3:  { selector: '.zone-page .clinic-case-area .case-swiper',     screen: 'posts' },
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
        P1:  { selector: '#post-article',                                 screen: 'posts' },
        // P3-f — 수정 모드 전용 "링크 주소" 칩 묶음 (아래 injectLinkChips 가 생성).
        // screen: null = 배지 미표시. 등록 목적은 **자유 편집(L3) 제외**다 —
        // 오버레이는 ZIA_INJECT_MAP selector 하위를 오버라이드 대상에서 뺀다(계약 §4).
        LINKS: { selector: '#zia-link-edit',                              screen: null }
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

    // ════════════════════════════════════════════════════════════════════
    // P3-f — 필드 단위 편집 지도 (window.ZIA_FIELD_MAP)  [EDIT_PROTOCOL.md v2 §5]
    // ------------------------------------------------------------------------
    // 소비처 2곳 (본 파일은 정의만 — 읽기·쓰기 동작은 전부 소비처 소관):
    //   1) site/static/js/edit-overlay.js — ?edit=1 에서 이 지도를 읽어 각 요소에
    //      "그 자리에서 고치기" 핸들(L1)을 붙인다. 지도에 없는 요소는 관리 화면 안내(LN)
    //      또는 자유 편집(L3 page_overrides)으로 떨어진다.
    //   2) admin/js/app.js — zia-edit-save 수신 후 이 지도의 source 로 저장처를 정한다.
    //      · source.table === 'site_settings' → { key, value } UPSERT (key/value 표)
    //      · 그 외 (posts/reviews/faqs/zones — 쓰기 허용 표 화이트리스트) →
    //        update <table> set <column> = value where id = <rowId>.
    //        rowId 는 미리보기가 DOM 에 심어 둔 행 번호(source.rowFrom 속성)에서 읽는다.
    //
    // [엔트리 형태]
    //   key(필드 ID) : { selector, kind, source, label, adminHash }
    //   · selector — 편집 "대상 요소" (배지 컨테이너가 아니라 값이 들어 있는 요소).
    //     행 기반 엔티티는 `[data-…-id]` 를 selector 에 포함해 **주입 성공분만** 잡는다
    //     (정적 데모 카드는 행 번호가 없어 저장 불가 → 애초에 편집 핸들을 붙이지 않는다).
    //   · kind — 'text'(글자) / 'html'(서식 글) / 'image'(사진) / 'link'(링크 주소).
    //     오버레이는 text/html/image 만 구분하고 그 외는 글자 편집으로 다룬다 —
    //     'link' 는 저장 값이 URL 이라 아래 "링크 주소" 칩(수정 모드 전용 DOM)을 대상으로
    //     삼는다. 칩의 글자가 곧 URL 이므로 글자 편집 경로에서도 값이 정확하다.
    //   · label — 원장(비개발자)에게 그대로 보이는 한국어 문구. 전문용어 금지.
    //
    // [등록 원칙 — 계약 §2] 정본(L1)이 있는 값은 전부 여기 등록한다. 누락하면 자유 편집이
    //   그 자리를 L3 오버라이드로 덮어 정본을 우회한다. 반대로 **정본과 화면 문자열이
    //   다른 자리는 등록하지 않는다** (저장 시 정본이 오염되므로):
    //   · I11 홈 §8 진료일정 — 주입이 '평일 ' 접두를 합성 (정본 = 접두 없는 값) → 제외.
    //     footer C8·병원 정보 화면이 같은 값의 정본 편집 경로다.
    //   · L2 location.html 진료일정 — 주입 자체가 보류 (계약 §6 미결 #4) → 제외.
    //   · FAQ 답변 — 줄바꿈(\n)을 <br> 로 렌더하므로 글자 편집이 줄바꿈을 잃는다 → 제외
    //     (자주 묻는 질문 화면의 여러 줄 입력이 정본 경로. 아코디언은 주입 컨테이너라
    //      자유 편집 대상에서도 제외되어 정본 우회가 발생하지 않는다).
    //
    // [L2 슬롯 — 홈 첫 화면 칸 배치] 계약 §5 kind:'slot'.
    //   일반 엔트리(L1)의 쓰기는 `set <칼럼> = <값> where id = <DOM 행 번호>` 인데,
    //   홈 칸 배치에 필요한 쓰기는 `set home_slot = <칸 번호> where id = <고른 글 id>`
    //   (+ 그 칸에 있던 글 비우기)라 값·조건이 뒤집혀 있다. 그래서 부모(admin/js/app.js)에
    //   **슬롯 전용 저장 분기**(saveSlotTarget)를 따로 두고, 여기서는 그 분기가 필요한
    //   두 값만 넘긴다:
    //     · 몇 번 칸인가 → source.slot (엔트리마다 1~6 고정)
    //     · 어느 분야인가 → source.rowFrom = 'data-zone-id' (탭 패널에 심어 둔 분야 번호)
    //   고른 글 번호는 저장 값(value)으로 온다. value '0' = 그 칸 비우기.
    //   빈 칸은 홈페이지 DOM 에 없으므로 **수정 모드에서만** 칸 자리를 만들어 준다
    //   (아래 rebuildCaseSwiper 의 slotZone 경로 — 일반 방문자에겐 생성 0).
    // ════════════════════════════════════════════════════════════════════
    var HOME_SLOT_COUNT = 6;   // 홈 §5 캐러셀 칸 수 (admin/js/app.js HOME_SLOT_COUNT 와 동일)
    var H_SET = '#/settings', H_ZONES = '#/zones', H_POSTS = '#/posts',
        H_FAQS = '#/faqs', H_REVIEWS = '#/reviews';
    // site_settings (key/value) 정본
    function fSet(selector, key, label, kind) {
        return { selector: selector, kind: kind || 'text', label: label,
            source: { table: 'site_settings', key: key }, adminHash: H_SET };
    }
    // 행 기반 엔티티 정본 (rowFrom = 주입 시 심어 둔 행 번호 속성 — 아래 stampRow 참조)
    function fRow(selector, table, column, rowFrom, label, kind, hash) {
        return { selector: selector, kind: kind || 'text', label: label,
            source: { table: table, column: column, rowFrom: rowFrom }, adminHash: hash };
    }
    function fPost(selector, column, label, kind) {
        return fRow(selector, 'posts', column, 'data-post-id', label, kind, H_POSTS);
    }
    function fZone(selector, column, label, kind) {
        return fRow(selector, 'zones', column, 'data-zone-id', label, kind, H_ZONES);
    }
    // 홈 첫 화면 진료 소개 칸 (I7) — "이 자리에 어떤 글을 띄울지" (L2)
    function fHomeSlot(n) {
        return {
            selector: '.section-05 .tab-panel[data-zone-id] .clinic-case-area .zia-slot[data-zia-slot="' + n + '"]',
            kind: 'slot',
            accept: 'post',
            label: '홈 첫 화면 ' + n + '번 칸',
            source: { table: 'posts', column: 'home_slot', slot: n, rowFrom: 'data-zone-id' },
            adminHash: '#/home'
        };
    }
    var FIELD_MAP = {
        /* ── 병원 정보 (site_settings) — 원장이 가장 자주 고치는 값 ─────────── */
        // footer (7페이지 공통, C6~C9)
        'settings.phone.footer':        fSet('footer .cs-info .tel', 'phone', '대표 전화번호'),
        'settings.hours_note.footer':   fSet('footer .cs-info .biz-time', 'hours_note', '진료시간 아래 안내 문구'),
        'settings.hours_weekday.footer': fSet('footer .clinic-hours ul li:nth-of-type(1) p', 'hours_weekday', '평일 진료시간'),
        'settings.hours_weekend.footer': fSet('footer .clinic-hours ul li:nth-of-type(2) p', 'hours_weekend', '주말·공휴일 진료시간'),
        'settings.hours_lunch.footer':  fSet('footer .clinic-hours ul li:nth-of-type(3) p', 'hours_lunch', '점심시간'),
        'settings.representative':      fSet('footer .company-info ul li:nth-of-type(1) span', 'representative', '대표자 이름'),
        'settings.biz_reg_no':          fSet('footer .company-info ul li:nth-of-type(2) span', 'biz_reg_no', '사업자등록번호'),
        'settings.address.footer':      fSet('footer .company-info ul li:nth-of-type(3) span', 'address', '병원 주소'),
        // index.html §8 찾아오시는 길 (I10 / I12)
        'settings.phone.home':          fSet('.section-08 .info-list .contact dd strong', 'phone', '대표 전화번호'),
        'settings.address.home':        fSet('.section-08 .address .addr-main strong', 'address', '병원 주소'),
        'settings.address_sub.home':    fSet('.section-08 .address .addr-sub', 'address_sub', '주소 아래 오시는 길 안내'),
        // location.html (L1 / L3)
        'settings.phone.location':      fSet('.section-location .contact-box .tel', 'phone', '대표 전화번호'),
        'settings.address.location':    fSet('.address-banner .addr-text strong', 'address', '병원 주소'),
        'settings.address_sub.location': fSet('.address-banner .addr-text span', 'address_sub', '주소 아래 오시는 길 안내'),
        // 링크 주소 (C3/C4/C5/I2/I3/I13/I14/L4) — 수정 모드 전용 "링크 주소" 칩이 대상.
        // 버튼 글자(예: "빠른 진료예약")를 고치는 것과 헷갈리지 않도록 자리를 분리했다.
        'settings.link_reserve':        fSet('#zia-link-edit [data-zia-link="link_reserve"]', 'link_reserve', '진료예약 링크 주소', 'link'),
        'settings.link_tel':            fSet('#zia-link-edit [data-zia-link="link_tel"]', 'link_tel', '전화 걸기 링크 주소', 'link'),
        'settings.link_kakao':          fSet('#zia-link-edit [data-zia-link="link_kakao"]', 'link_kakao', '카카오톡 상담 링크 주소', 'link'),
        'settings.link_naver_booking':  fSet('#zia-link-edit [data-zia-link="link_naver_booking"]', 'link_naver_booking', '네이버 예약 링크 주소', 'link'),
        'settings.naver_map_url':       fSet('#zia-link-edit [data-zia-link="naver_map_url"]', 'naver_map_url', '네이버 길찾기 링크 주소', 'link'),
        'settings.naver_place_review_url': fSet('#zia-link-edit [data-zia-link="naver_place_review_url"]', 'naver_place_review_url', '네이버 플레이스 후기 링크 주소', 'link'),

        /* ── 진료 분야 (zones) ──────────────────────────────────────────── */
        // 홈 §5 진료소개 탭 (I4 / I5)
        'zone.tab_label.home':      fZone('.section-05 .tab-container .tab-btn[data-zone-id]', 'tab_label', '홈 진료탭에 보이는 분야 이름'),
        'zone.name.home':           fZone('.section-05 .tab-panel[data-zone-id] .panel-visual .text h3', 'name', '진료 분야 이름'),
        'zone.description.home':    fZone('.section-05 .tab-panel[data-zone-id] .panel-visual .text p', 'description', '진료 분야 소개 글'),
        'zone.english_label.home':  fZone('.section-05 .tab-panel[data-zone-id] .panel-visual .text span', 'english_label', '분야 영문 표기'),
        'zone.hero_image.home':     fZone('.section-05 .tab-panel[data-zone-id] .panel-visual .img-row img', 'hero_image_path', '분야 대표 사진', 'image'),
        // GNB (C1 모바일 / C2 PC — 메뉴를 연 상태에서만 보인다)
        'zone.name.gnb_mobile':     fZone('.gnb-row .gnb .depth_box .depth2 li[data-zone-id] a', 'name', '메뉴에 보이는 분야 이름'),
        'zone.name.gnb_pc':         fZone('.pc-gnb-row .mega-list .depth2 li[data-zone-id] a span', 'name', '메뉴에 보이는 분야 이름'),
        // FAQ 묶음 이름 (I8 홈 / F1 자주 묻는 질문 페이지)
        'zone.faq_label.home':      fZone('.section-07 .faq-category a[data-zone-id]', 'faq_label', '질문 묶음 이름'),
        'zone.faq_label.faqpage':   fZone('.faq-tab-area .tab-btn[data-zone-id]', 'faq_label', '질문 묶음 이름'),
        // zone.html 분야 글 아카이브 히어로 (Z1)
        'zone.name.archive':        fZone('#zone-title', 'name', '진료 분야 이름'),
        'zone.description.archive': fZone('#zone-desc', 'description', '진료 분야 소개 글'),
        'zone.english_label.archive': fZone('#zone-eng', 'english_label', '분야 영문 표기'),

        /* ── 글 (posts) ────────────────────────────────────────────────── */
        // 카드 (I7 홈 캐러셀 / A2 ZONE 상세 / Z3 아카이브 그리드 — 같은 마크업)
        'post.title.card':      fPost('.case-card[data-post-id] .info-overlay .title', 'title', '글 제목'),
        'post.badge.card':      fPost('.case-card[data-post-id] .info-overlay .badge', 'badge', '글 꼬리표'),
        'post.thumbnail.card':  fPost('.case-card[data-post-id] .img-bg img', 'thumbnail_path', '글 대표 사진', 'image'),
        // I15 홈 "이 분야 최근 글" 목록
        'post.title.recent':    fPost('.zone-recent-list li[data-post-id] .title', 'title', '글 제목'),
        // P1 글 상세 (post.html)
        'post.title.detail':    fPost('#post-title', 'title', '글 제목'),
        'post.badge.detail':    fPost('#post-badge', 'badge', '글 꼬리표'),
        'post.body.detail':     fPost('#post-body', 'body_html', '글 본문', 'html'),

        /* ── 후기 (reviews) ────────────────────────────────────────────── */
        'review.body.card':      fRow('.review-card[data-review-id] .txt', 'reviews', 'body', 'data-review-id', '후기 내용', 'text', H_REVIEWS),
        'review.title.grid':     fRow('.review-item[data-review-id] .info-box .title', 'reviews', 'title', 'data-review-id', '후기 제목', 'text', H_REVIEWS),
        'review.thumbnail.grid': fRow('.review-item[data-review-id] .img-box img', 'reviews', 'thumbnail_path', 'data-review-id', '후기 사진', 'image', H_REVIEWS),

        /* ── 자주 묻는 질문 (faqs) — 질문만 (답변은 줄바꿈 보존 위해 제외) ──── */
        'faq.question.home': fRow('.section-07 #faq-list-container li[data-faq-id] .faq-q strong', 'faqs', 'question', 'data-faq-id', '질문', 'text', H_FAQS),
        'faq.question.list': fRow('.section-faq-list .faq-accordion li[data-faq-id] .faq-q strong', 'faqs', 'question', 'data-faq-id', '질문', 'text', H_FAQS)
    };
    /* ── 홈 첫 화면 칸 1~6 (L2 배치) — 분야(탭)마다 같은 6칸 ─────────────── */
    for (var slotN = 1; slotN <= HOME_SLOT_COUNT; slotN++) {
        FIELD_MAP['home.slot.' + slotN] = fHomeSlot(slotN);
    }
    // config 부재(정적 사이트) 상태에서도 노출 — 레지스트리는 주입과 독립 (additive).
    window.ZIA_FIELD_MAP = FIELD_MAP;

    // 주입 시 각 행에 심는 행 번호 (편집기가 source.rowFrom 으로 읽어 저장 대상을 특정한다)
    function stampRow(el, attr, id) {
        if (el && id != null && id !== '') { el.setAttribute(attr, String(id)); }
    }

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
        // 단 post.html(P3-d)·zone.html(P3-g) 은 정적 폴백 콘텐츠가 없는 동적 페이지 —
        // "불러오는 중" 고착 방지 위해 notfound 상태로 전환 후 종료.
        var dynamicPages = [
            { re: /\/post\.html$/, loading: 'post-loading', notfound: 'post-notfound' },
            { re: /\/zone\.html$/, loading: 'zone-loading', notfound: 'zone-notfound' }
        ];
        dynamicPages.forEach(function (pg) {
            if (!pg.re.test(window.location.pathname)) { return; }
            document.addEventListener('DOMContentLoaded', function () {
                var loading = document.getElementById(pg.loading);
                var notfound = document.getElementById(pg.notfound);
                if (loading) { loading.style.display = 'none'; }
                if (notfound) { notfound.style.display = ''; }
            });
        });
        markInjectDone(); // P3-e — config 부재 no-op 경로도 완료 신호 (오버레이 대기 해제)
        return;
    }

    var FETCH_TIMEOUT_MS = 3000;

    // 스테이징 서브패스(/zia-preview/) 대응: 현 문서 경로에서 베이스 경로 산출.
    // deploy_staging.sh 는 *.html 의 ="/… 만 재작성하고 JS 파일은 손대지 않으므로
    // JS가 생성하는 절대경로는 런타임에 BASE를 전치해야 한다.
    var path = window.location.pathname;
    var BASE = path.replace(/\/[^\/]*$/, '');

    // ZONE 전용 상세 페이지 실존 파일 목록. zones 데이터에 "페이지 구축 여부" 판정 필드가
    // 없어(v_public_zones는 page_path만 제공) 실존 파일 상수로 유지한다.
    // 전용 페이지를 추가 구축하면 이 목록에 경로를 추가할 것.
    var BUILT_ZONE_PAGES = ['/autonomic.html'];
    // 범용 분야 아카이브 (P3-g) — 전용 페이지가 없는 ZONE 의 목적지. 실존 파일이므로 404 0.
    var ZONE_ARCHIVE_PAGE = '/zone.html';
    var ZONE_PAGE_SIZE = 12; // "더 보기" 1회 로드 건수 (누적 무제한)

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
        if (pathEnds(ZONE_ARCHIVE_PAGE)) { return 'zonearchive'; } // 분야 글 아카이브 (P3-g)
        return 'zone'; // ZONE 상세 후보 — zones.page_path 매칭으로 확정 (향후 구축 페이지 자동 커버)
    }
    var KIND = detectKind();

    // 글 상세 대상 id (?id= 숫자만 허용 — 쿼리 문자열 직결 주입 차단)
    var POST_ID = null;
    if (KIND === 'post') {
        var mPostId = /[?&]id=(\d+)(&|$)/.exec(window.location.search);
        POST_ID = mPostId ? mPostId[1] : null;
    }

    // 분야 아카이브 대상 slug (?zone= — zones.slug 문법만 허용, schema check 와 동일 규칙)
    var ZONE_SLUG = null;
    if (KIND === 'zonearchive') {
        var mZone = /[?&]zone=([^&]*)/.exec(window.location.search);
        if (mZone) {
            var rawSlug = '';
            try { rawSlug = decodeURIComponent(mZone[1]); } catch (e) { rawSlug = ''; }
            if (/^[a-z0-9_-]+$/.test(rawSlug)) { ZONE_SLUG = rawSlug; }
        }
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
        post:     ['zones', 'settings'], // 상세 본문은 별도 fetch (postDetail — 오케스트레이션 참조)
        // 분야 아카이브(P3-g): 글은 페이지 단위로 별도 fetch (offset/limit — 전건 로드 금지)
        zonearchive: ['zones', 'tags', 'settings']
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
    // 분야 아카이브 URL (P3-g) — slug = 안정 식별자 (라벨 아님, 원칙 6)
    function zoneArchiveHref(slug) {
        return resolvePage(ZONE_ARCHIVE_PAGE) + '?zone=' + encodeURIComponent(slug);
    }
    // GNB·"목록으로" 공통 목적지 사다리 (P3-g 재설계):
    //   1) page_path 가 실존 전용 페이지(BUILT_ZONE_PAGES) → 전용 페이지
    //   2) 그 외 → zone.html?zone=<slug> 범용 아카이브 (실존 파일 — 404 0)
    //   3) slug 조차 없는 비정상 행 → 비링크 (href 미부여)
    // ⚠ page_path 값이 있어도 파일이 없으면 404 이므로 BUILT 목록 통과분만 신뢰한다.
    function zoneHref(z) {
        if (z.page_path && BUILT_ZONE_PAGES.indexOf(z.page_path) !== -1) {
            return resolvePage(z.page_path);
        }
        if (z.slug) { return zoneArchiveHref(z.slug); }
        return '';
    }
    // C1 — GNB 모바일 진료 ZONE 서브메뉴
    function injectGnbMobile(zones) {
        var ul = qs('.gnb-row .gnb .depth_box .depth2');
        if (!ul || !zones.length) { return; }
        clearEl(ul);
        zones.forEach(function (z) {
            var li = document.createElement('li');
            stampRow(li, 'data-zone-id', z.id); // 편집기 행 특정 (ZIA_FIELD_MAP zone.name.gnb_mobile)
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
            stampRow(li, 'data-zone-id', z.id); // 편집기 행 특정 (zone.name.gnb_pc)
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
            stampRow(p, 'data-zone-id', z.id); // 편집기 행 특정 (zone.name/description/… .home)
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
            stampRow(btn, 'data-zone-id', z.id); // 편집기 행 특정 (zone.tab_label.home)
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
        // I15 (P3-g) — 캐러셀 아래 "이 분야 최근 글" 누적 블록 (런타임 DOM 생성).
        //   패널마다 자기 ZONE 글만 담으므로 탭 전환 = 자동 갱신.
        //   글 0건인 ZONE 패널에는 생성되지 않는다 (원칙 1).
        tabZones.forEach(function (z, i) {
            safe(function () { injectHomeRecent(panels[i], z, posts); });
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
        // P3-f L2 — 수정 모드의 홈 캐러셀만 "1~6번 칸" 형태로 그린다 (빈 칸도 눌러서 채우도록).
        //           일반 방문자·ZONE 상세(A2)·아카이브(Z3) 는 slotZone = null → 종전 그대로.
        var slotZone = (homeOnly && EDIT_MODE) ? zone : null;
        // I7/A2 — 해당 ZONE 소속 글만 자동 호출 (§7.1). 0건 → 정적 데모 카드 유지.
        //         (수정 모드 홈은 0건이어도 빈 칸 6개를 그려야 채워 넣을 수 있다)
        if (zonePosts.length || slotZone) { rebuildCaseSwiper(area, zonePosts, slotZone); }
        // I6/A1 — 태그 주입 성공 시 정적 alert() 핸들러는 DOM 교체로 소멸 → 실 필터로 대체.
        //         태그 주입 실패(0건·fetch 실패) 시 정적 태그·alert 핸들러 불변 (계약 폴백 원칙).
        if (zoneTags.length) { rebuildTagList(area, zoneTags, zonePosts, slotZone); }
    }
    // 글 클릭 타깃 사다리 (계약 v1.1 §7.4): external_url(새 탭) > has_body → 온사이트 상세 > 비링크
    // 카드(I7/A2/Z3)와 홈 누적 목록(I15)이 같은 사다리를 쓴다 (단일 정의).
    function applyPostHref(a, p) {
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
    }
    // 카드 1장 (<a class="case-card">) — 캐러셀 슬라이드(I7/A2)와 아카이브 그리드(Z3) 공용.
    function caseCard(p) {
        var a = document.createElement('a');
        a.className = 'case-card';
        stampRow(a, 'data-post-id', p.id); // 편집기 행 특정 (post.title/badge/thumbnail .card)
        applyPostHref(a, p);
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
        return a;
    }
    // ── P3-f L2 — 홈 첫 화면 "칸" 표시 (수정 모드 전용 DOM) ────────────────
    // 왜 필요한가: 빈 칸은 홈페이지에 아무 요소도 없다. 그래서 "빈 칸을 눌러 글을 고른다"가
    //   성립하지 않는다. 링크 주소 칩(injectLinkChips)과 같은 방식으로 **수정 모드에서만**
    //   칸 자리를 만들고, ZIA_FIELD_MAP 이 그 자리를 가리킨다.
    // 채워진 칸은 카드 위에 작은 딱지를 얹는다 — 카드 글자·사진(L1)은 그대로 그 자리에서
    //   고칠 수 있어야 하므로, 칸 자체를 고르는 자리를 분리해 둔다.
    function ensureSlotStyles() {
        if (document.getElementById('zia-slot-style')) { return; }
        var css = [
            '.zia-slot-host{position:relative;}',
            '.zia-slot{box-sizing:border-box;cursor:pointer;font-family:inherit;}',
            '.zia-slot-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;',
            'gap:6px;width:100%;height:220px;border:2px dashed #7c3aad;border-radius:12px;',
            'background:#faf7ff;color:#5b2f96;text-align:center;padding:12px;}',
            '@media screen and (min-width:1200px){.zia-slot-empty{height:240px;}}',
            '.zia-slot-empty .zia-slot-no{font-size:18px;font-weight:800;}',
            '.zia-slot-empty .zia-slot-hint{font-size:14px;font-weight:600;opacity:.85;}',
            // 오른쪽 위 — 카드 왼쪽 위의 꼬리표(badge)를 가리지 않게
            '.zia-slot-chip{position:absolute;right:10px;top:10px;z-index:6;display:inline-flex;',
            'align-items:center;gap:6px;min-height:40px;padding:8px 12px;border-radius:999px;',
            'background:rgba(124,58,173,.94);color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.25);}',
            '.zia-slot-chip .zia-slot-no{font-size:14px;font-weight:800;}',
            '.zia-slot-chip .zia-slot-hint{font-size:13px;font-weight:600;opacity:.9;}'
        ].join('');
        var st = document.createElement('style');
        st.id = 'zia-slot-style';
        st.appendChild(document.createTextNode(css));
        (document.head || document.body).appendChild(st);
    }
    function slotBox(n, filled) {
        var box = document.createElement('div');
        box.className = 'zia-slot ' + (filled ? 'zia-slot-chip' : 'zia-slot-empty');
        box.setAttribute('data-zia-slot', String(n));
        var no = document.createElement('span');
        no.className = 'zia-slot-no';
        no.textContent = n + '번 칸';
        box.appendChild(no);
        var hint = document.createElement('span');
        hint.className = 'zia-slot-hint';
        hint.textContent = filled ? '눌러서 다른 글로 바꾸기' : '눌러서 띄울 글 고르기';
        box.appendChild(hint);
        return box;
    }
    function caseSlide(p, slotNo) {
        var slide = document.createElement('div');
        slide.className = 'swiper-slide';
        slide.appendChild(caseCard(p));
        if (slotNo) {           // 수정 모드 — 카드 위에 "N번 칸" 딱지 (누르면 다른 글로 교체)
            slide.className += ' zia-slot-host';
            slide.appendChild(slotBox(slotNo, true));
        }
        return slide;
    }
    // 수정 모드 전용 — 아직 아무 글도 없는 칸 (일반 방문자 화면엔 생성되지 않는다)
    function emptySlotSlide(n) {
        var slide = document.createElement('div');
        slide.className = 'swiper-slide zia-slot-host';
        slide.appendChild(slotBox(n, false));
        return slide;
    }
    function rebuildCaseSwiper(area, list, slotZone) {
        if (!window.Swiper) { return; }
        var swiperEl = area.querySelector('.case-swiper');
        var wrap = swiperEl ? swiperEl.querySelector('.swiper-wrapper') : null;
        if (!wrap) { return; }
        destroySwiperOn(swiperEl); // 원칙 3
        clearEl(wrap);
        if (slotZone) {
            // 수정 모드 홈 — 1~6번 칸을 항상 같은 자리에 그린다 (빈 칸 포함).
            ensureSlotStyles();
            var bySlot = {};
            list.forEach(function (p) { if (p.home_slot != null) { bySlot[p.home_slot] = p; } });
            for (var n = 1; n <= HOME_SLOT_COUNT; n++) {
                wrap.appendChild(bySlot[n] ? caseSlide(bySlot[n], n) : emptySlotSlide(n));
            }
        } else {
            list.forEach(function (p) { wrap.appendChild(caseSlide(p)); });
        }
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
    function rebuildTagList(area, zoneTags, zonePosts, slotZone) {
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
                // (수정 모드 홈은 글 0건이어도 빈 칸 6개를 다시 그려야 한다)
                if (!zonePosts.length && !slotZone) { return; }
                var filtered = item.tag
                    ? zonePosts.filter(function (p) {
                        return (p.tag_names || []).indexOf(item.tag.name) !== -1;
                    })
                    : zonePosts;
                rebuildCaseSwiper(area, filtered, slotZone);
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
        stampRow(qs('.section-clinic-cases'), 'data-zone-id', zone.id); // 편집기 행 특정
        setupCaseArea(area, zone, tags, posts);
    }

    // ========================================================================
    // I15 (P3-g) — 홈 §5 진료탭 "이 분야 최근 글" 누적 블록
    // ------------------------------------------------------------------------
    // 요구: 홈 캐러셀(I7)은 관리자 슬롯 픽커 6칸 고정이라 글이 누적되지 않는다.
    //       캐러셀은 그대로 두고 그 "아래"에 발행일 역순 자동 목록 + 전체 보기 링크를 덧붙인다.
    // ⚠ index.html 정적 마크업은 수정 금지(원스 마크업 무손상) → 본 블록은 전적으로
    //   런타임 DOM 생성이다. posts 0건·fetch 실패·zones 실패 시 아예 생성되지 않으므로
    //   홈은 현재 정적 모습과 100% 동일하게 남는다 (원칙 1 Graceful degradation).
    // ⚠ 탭 전환: 블록을 탭 패널 내부에 만들기 때문에 패널 active 토글이 곧 갱신이다
    //   (탭 클릭 핸들러 추가 훅 불요 — 패널당 자기 ZONE 글만 보유).
    // ========================================================================
    var HOME_RECENT_LIMIT = 8;
    function byPublishedDesc(a, b) {
        var ax = a.published_at || '', bx = b.published_at || '';
        if (ax !== bx) { return ax < bx ? 1 : -1; } // 빈 값(미상)은 뒤로
        return (b.id || 0) - (a.id || 0);
    }
    // 누적 블록 전용 CSS — 코드 상수만 (데이터 문자열 결합 없음). 1회만 주입.
    // 새 CSS 파일·정적 HTML 수정 없이 동작해야 하므로 style 요소를 런타임 생성한다.
    function ensureRecentStyles() {
        if (document.getElementById('zia-zone-recent-style')) { return; }
        var css = [
            '.zone-recent{margin:32px auto 0;max-width:1200px;padding:0 20px;box-sizing:border-box;text-align:left;}',
            '.zone-recent .zone-recent-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px;}',
            '.zone-recent .zone-recent-title{font-size:16px;font-weight:700;color:#2E3F66;}',
            '.zone-recent .zone-recent-all{font-size:14px;font-weight:600;color:#B79A78;text-decoration:underline;}',
            '.zone-recent .zone-recent-list{border-top:1px solid #E4E0DA;}',
            '.zone-recent .zone-recent-list li{border-bottom:1px solid #E4E0DA;}',
            '.zone-recent .zone-recent-list li a{display:flex;align-items:center;gap:10px;min-height:52px;padding:12px 0;color:#3A3733;}',
            '.zone-recent .zone-recent-list .badge{flex:none;font-size:12px;font-weight:600;color:#fff;background:#2E3F66;border-radius:34px;padding:4px 12px;}',
            '.zone-recent .zone-recent-list .title{flex:1 1 auto;font-size:15px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
            '.zone-recent .zone-recent-list .date{flex:none;font-size:13px;color:#989490;}',
            '@media screen and (min-width:1200px){.zone-recent{padding:0;margin-top:48px;}.zone-recent .zone-recent-title{font-size:18px;}.zone-recent .zone-recent-list .title{font-size:16px;}}'
        ].join('\n');
        var st = document.createElement('style');
        st.id = 'zia-zone-recent-style';
        st.appendChild(document.createTextNode(css));
        (document.head || document.body).appendChild(st);
    }
    function injectHomeRecent(panel, zone, posts) {
        if (!panel || !zone) { return; }
        var list = (posts || []).filter(function (p) { return p.zone_slug === zone.slug; });
        if (!list.length) { return; } // 0건 → 블록 미생성 (홈 정적 모습 유지)
        list = list.slice().sort(byPublishedDesc).slice(0, HOME_RECENT_LIMIT);

        var old = panel.querySelector('.zone-recent'); // 재주입 안전 (중복 방지)
        if (old && old.parentNode) { old.parentNode.removeChild(old); }
        ensureRecentStyles();

        var box = document.createElement('div');
        box.className = 'zone-recent';
        var head = document.createElement('div');
        head.className = 'zone-recent-head';
        var h = document.createElement('strong');
        h.className = 'zone-recent-title';
        h.textContent = '이 분야 최근 글';
        var all = document.createElement('a');
        all.className = 'zone-recent-all';
        // 전체 보기는 항상 아카이브(zone.html) — 전용 페이지는 소개용이라 누적 목록이 없다.
        all.setAttribute('href', zoneArchiveHref(zone.slug));
        all.textContent = '이 분야 글 전체 보기';
        head.appendChild(h);
        head.appendChild(all);
        box.appendChild(head);

        var ul = document.createElement('ul');
        ul.className = 'zone-recent-list';
        list.forEach(function (p) {
            var li = document.createElement('li');
            stampRow(li, 'data-post-id', p.id); // 편집기 행 특정 (post.title.recent)
            var a = document.createElement('a');
            applyPostHref(a, p);
            if (p.badge) {
                var badge = document.createElement('span');
                badge.className = 'badge';
                badge.textContent = p.badge;
                a.appendChild(badge);
            }
            var title = document.createElement('span');
            title.className = 'title';
            title.textContent = p.title || '';
            a.appendChild(title);
            var date = fmtDate(p.published_at);
            if (date) {
                var d = document.createElement('span');
                d.className = 'date';
                d.textContent = date;
                a.appendChild(d);
            }
            li.appendChild(a);
            ul.appendChild(li);
        });
        box.appendChild(ul);
        panel.appendChild(box);
    }

    // ========================================================================
    // zone.html — Z1/Z2/Z3 분야 글 아카이브 (P3-g)
    // ------------------------------------------------------------------------
    // URL 규약: zone.html?zone=<zones.slug> (slug = 안정 식별자, 라벨 금지 — 원칙 6).
    // 정적 폴백 콘텐츠가 없는 동적 페이지 (post.html 패턴 답습):
    //   ?zone 부재·문법 위반·미존재 slug·zones fetch 실패 → "진료 분야를 찾을 수 없습니다".
    // 글은 전건 로드하지 않고 offset/limit 페이지네이션 (누적 무제한 대비).
    // "더 있음" 판별은 limit+1 건 요청으로 (Content-Range 헤더 노출 의존 X).
    // ========================================================================
    function zoneShow(which) { // 'loading' | 'notfound' | 'main'
        var ids = { loading: 'zone-loading', notfound: 'zone-notfound', main: 'zone-main' };
        Object.keys(ids).forEach(function (k) {
            var el = document.getElementById(ids[k]);
            if (el) { el.style.display = (k === which) ? '' : 'none'; }
        });
    }
    function fetchZonePosts(slug, tagName, offset) {
        var q = 'v_public_posts?select=*&zone_slug=eq.' + encodeURIComponent(slug) +
            '&order=published_at.desc.nullslast,sort_order.asc,id.desc' +
            '&offset=' + offset + '&limit=' + (ZONE_PAGE_SIZE + 1);
        if (tagName) {
            // text[] 배열 contains 필터. 태그명은 zone 내 unique(zone_id,name) 이고
            // 필터 목록·글 배열이 같은 라이브 데이터에서 오므로 이름 변경 드리프트가 없다.
            q += '&tag_names=cs.' + encodeURIComponent('{' + JSON.stringify(String(tagName)) + '}');
        }
        return fetchRows(q);
    }
    function injectZoneArchive(zones, tags) {
        if (!document.getElementById('zone-main')) { return; } // zone.html 골격 아님 → no-op
        var zone = null;
        (zones || []).forEach(function (z) { if (!zone && z.slug === ZONE_SLUG) { zone = z; } });
        if (!ZONE_SLUG || !zone) { zoneShow('notfound'); return; }

        // Z1 — 분야 히어로 (name / description / english_label)
        stampRow(document.getElementById('zone-main'), 'data-zone-id', zone.id); // 편집기 행 특정
        setText(qs('#zone-title'), zone.name);
        setText(qs('#zone-desc'), zone.description);
        setText(qs('#zone-eng'), zone.english_label);
        setText(qs('#zone-subtxt'), zone.name + ' 관련 글');
        if (zone.name) { document.title = zone.name + ' 글 모아보기 — 지아한의원'; }
        // 전용 소개 페이지가 실존하면 링크 노출 (없으면 숨김 유지 — 404 차단)
        var introLink = document.getElementById('zone-intro-link');
        if (introLink && zone.page_path && BUILT_ZONE_PAGES.indexOf(zone.page_path) !== -1) {
            introLink.setAttribute('href', resolvePage(zone.page_path));
            introLink.textContent = zone.name + ' 소개 페이지 보기';
            introLink.style.display = '';
        }
        zoneShow('main');

        var grid = document.getElementById('zone-grid');
        var empty = document.getElementById('zone-empty');
        var moreArea = document.getElementById('zone-more-area');
        var moreBtn = document.getElementById('zone-more');
        if (!grid) { return; }
        var state = { tag: null, offset: 0, loading: false };

        function setEmpty(msg) {
            if (!empty) { return; }
            empty.textContent = msg;
            empty.style.display = msg ? '' : 'none';
        }
        function load(append) {
            if (state.loading) { return; }
            state.loading = true;
            if (moreBtn && append) { moreBtn.disabled = true; moreBtn.textContent = '불러오는 중…'; }
            fetchZonePosts(ZONE_SLUG, state.tag, state.offset).then(function (rows) {
                state.loading = false;
                if (moreBtn) { moreBtn.disabled = false; moreBtn.textContent = '더 보기'; }
                if (rows === null) { // fetch 실패·타임아웃 (3s)
                    if (moreArea) { moreArea.style.display = 'none'; }
                    if (!append) {
                        clearEl(grid);
                        setEmpty('글을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
                    }
                    return;
                }
                var hasMore = rows.length > ZONE_PAGE_SIZE;
                var page = hasMore ? rows.slice(0, ZONE_PAGE_SIZE) : rows;
                if (!append) { clearEl(grid); }
                page.forEach(function (p) { grid.appendChild(caseCard(p)); });
                state.offset += page.length;
                setEmpty(grid.children.length ? '' : '아직 등록된 글이 없어요.');
                if (moreArea) { moreArea.style.display = hasMore ? '' : 'none'; }
            });
        }
        if (moreBtn) {
            moreBtn.addEventListener('click', function () { load(true); });
        }

        // Z2 — 태그 필터 ('전체' + 해당 ZONE 하위 태그). 태그 0건이면 헤더 미노출.
        var tagListEl = document.getElementById('zone-tags');
        var zoneTags = (tags || []).filter(function (t) { return t.zone_slug === zone.slug; });
        if (tagListEl && zoneTags.length) {
            var items = [{ label: '전체', tag: null }].concat(zoneTags.map(function (t) {
                return { label: '#' + t.name, tag: t }; // name 은 '#' 미포함 저장 (schema 주석)
            }));
            items.forEach(function (item, i) {
                var li = document.createElement('li');
                if (i === 0) { li.className = 'active'; }
                var a = document.createElement('a');
                a.setAttribute('href', '#none');
                if (item.tag) { a.setAttribute('data-tag-id', String(item.tag.id)); }
                a.textContent = item.label;
                a.addEventListener('click', function (e) {
                    e.preventDefault();
                    if (state.loading) { return; }
                    qsa('li', tagListEl).forEach(function (x) { x.classList.remove('active'); });
                    li.classList.add('active');
                    state.tag = item.tag ? item.tag.name : null;
                    state.offset = 0;
                    load(false); // 서버 필터 + 페이지네이션 리셋
                });
                li.appendChild(a);
                tagListEl.appendChild(li);
            });
        }

        load(false); // 첫 페이지
    }

    // ========================================================================
    // index — I8/I9 홈 FAQ
    // ========================================================================
    function renderHomeFaqList(listEl, items) {
        clearEl(listEl);
        items.forEach(function (f, i) {
            var li = document.createElement('li');
            if (i === 0) { li.className = 'active'; } // 정적 원본: 첫 항목 열림
            stampRow(li, 'data-faq-id', f.id); // 편집기 행 특정 (faq.question.home)
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
                stampRow(a, 'data-zone-id', z.id); // 편집기 행 특정 (zone.faq_label.home)
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
            stampRow(li, 'data-faq-id', f.id); // 편집기 행 특정 (faq.question.list)
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
            var defs = [{ slug: 'all', label: '전체', id: null }].concat(primaries.map(function (z) {
                return { slug: z.slug, label: z.faq_label, id: z.id };
            }));
            var buttons = [];
            defs.forEach(function (d, i) {
                var slide = document.createElement('div');
                slide.className = 'swiper-slide';
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'tab-btn' + (i === 0 ? ' active' : '');
                btn.setAttribute('data-target', d.slug);
                stampRow(btn, 'data-zone-id', d.id); // '전체' 탭은 행이 없어 미각인
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
        stampRow(a, 'data-review-id', r.id); // 편집기 행 특정 (review.body.card)
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
        stampRow(a, 'data-review-id', r.id); // 편집기 행 특정 (review.title/thumbnail .grid)
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
    // P3-f — "링크 주소" 칩 (수정 모드 전용 DOM)
    // ------------------------------------------------------------------------
    // 왜 별도 자리인가:
    //   예약·전화·카톡 버튼의 정본은 **버튼 글자가 아니라 href 에 들어가는 주소**다.
    //   그런데 편집기(edit-overlay.js)는 글자/사진/서식 세 가지만 다루므로, 버튼 자체를
    //   편집 대상으로 등록하면 "빠른 진료예약" 같은 버튼 글자를 읽어 site_settings 의
    //   링크 값에 저장해 버린다(정본 오염). 그래서 주소를 **글자로 보여 주는 칩**을
    //   수정 모드에서만 만들고, ZIA_FIELD_MAP 은 그 칩을 가리킨다 — 읽는 값도 저장하는
    //   값도 정확히 URL 이 된다.
    // 회귀 안전:
    //   ?edit=1 이 없는 일반 방문자에게는 이 함수가 아무것도 만들지 않는다 (계약 §9).
    //   생성 DOM 은 footer 끝에 붙는 블록 1개뿐이며 기존 마크업을 수정하지 않는다.
    // ========================================================================
    var EDIT_MODE = /[?&]edit=1(&|$)/.test(window.location.search);
    var LINK_LABELS = {
        link_reserve: '진료예약 링크 주소',
        link_tel: '전화 걸기 링크 주소',
        link_kakao: '카카오톡 상담 링크 주소',
        link_naver_booking: '네이버 예약 링크 주소',
        naver_map_url: '네이버 길찾기 링크 주소',
        naver_place_review_url: '네이버 플레이스 후기 링크 주소'
    };
    // 페이지가 실제로 소비하는 링크만 노출 (계약 §2 C3~C5 는 전 페이지 공통)
    var LINK_KEYS_COMMON = ['link_reserve', 'link_tel', 'link_kakao', 'link_naver_booking'];
    var LINK_KEYS_BY_KIND = {
        index: LINK_KEYS_COMMON.concat(['naver_map_url', 'naver_place_review_url']),
        location: LINK_KEYS_COMMON.concat(['naver_map_url']),
        reviews: LINK_KEYS_COMMON.concat(['naver_place_review_url'])
    };
    function ensureLinkChipStyles() {
        if (document.getElementById('zia-link-edit-style')) { return; }
        var css = [
            '#zia-link-edit{margin:24px auto 0;max-width:1200px;padding:14px 16px;box-sizing:border-box;',
            'border:2px dashed #7c3aad;border-radius:12px;background:#faf7ff;color:#3a2a55;text-align:left;',
            'font-size:14px;line-height:1.6;}',
            '#zia-link-edit .zia-link-head{margin:0 0 8px;font-size:14px;font-weight:800;color:#5b2f96;}',
            '#zia-link-edit ul{margin:0;padding:0;list-style:none;}',
            '#zia-link-edit li{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 0;',
            'border-top:1px solid #e6dcf5;}',
            '#zia-link-edit li:first-child{border-top:0;}',
            '#zia-link-edit b{flex:none;min-width:190px;font-weight:700;color:#3a2a55;}',
            '#zia-link-edit .zia-link-val{flex:1 1 220px;min-height:24px;padding:2px 6px;border-radius:6px;',
            'background:#fff;border:1px solid #ded2f0;word-break:break-all;color:#1d2733;}'
        ].join('');
        var st = document.createElement('style');
        st.id = 'zia-link-edit-style';
        st.appendChild(document.createTextNode(css));
        (document.head || document.body).appendChild(st);
    }
    function injectLinkChips(S) {
        if (!EDIT_MODE) { return; }                              // 일반 방문자 → 무동작
        if (document.getElementById('zia-link-edit')) { return; } // 재주입 중복 방지
        var keys = LINK_KEYS_BY_KIND[KIND] || LINK_KEYS_COMMON;
        var host = qs('footer') || document.body;
        if (!host) { return; }
        ensureLinkChipStyles();
        var box = document.createElement('div');
        box.id = 'zia-link-edit';
        var head = document.createElement('p');
        head.className = 'zia-link-head';
        head.textContent = '🔗 링크 주소 — 수정 모드에서만 보여요. 주소를 누르면 바꿀 수 있어요.';
        box.appendChild(head);
        var ul = document.createElement('ul');
        keys.forEach(function (key) {
            var li = document.createElement('li');
            var b = document.createElement('b');
            b.textContent = LINK_LABELS[key] || key;
            var val = document.createElement('span');
            val.className = 'zia-link-val';
            val.setAttribute('data-zia-link', key);
            val.textContent = S(key) || '(아직 없어요)';
            li.appendChild(b);
            li.appendChild(val);
            ul.appendChild(li);
        });
        box.appendChild(ul);
        host.appendChild(box);
    }

    // ========================================================================
    // P3-f — 자유 편집 결과(page_overrides) 읽어 화면에 반영  [계약 §3 · §9]
    // ------------------------------------------------------------------------
    // · 대상: v_public_page_overrides (anon SELECT 공개 뷰) 의 **현재 페이지 파일명**분만.
    //   페이지 키는 편집기(edit-overlay.js PAGE)와 동일 산출식 — 경로 마지막 조각,
    //   비면 'index.html' (스테이징 서브패스에서도 동일 값).
    // · 순서: 반드시 **모든 주입이 끝난 뒤 마지막**. 주입이 오버라이드를 덮으면 저장한
    //   내용이 사라지기 때문이다. 완료 신호(zia:inject-done)는 이 적용까지 끝난 뒤 쏜다
    //   (수정 모드 오버레이가 최종 화면 상태에서 편집 지점을 수집하도록).
    // · 방문자 공통: ?edit=1 여부와 무관하게 적용한다 — 원장이 저장한 내용은 실제
    //   홈페이지에 보여야 한다.
    // · 실패 처리(회귀 금지선): fetch 실패·타임아웃(3s)·0건 → 아무것도 하지 않는다.
    //   selector 가 안 맞으면(마크업 드리프트) 그 줄만 조용히 건너뛴다 — 예외 금지.
    // · html 은 zia-sanitize.js 로 sanitize 한 산출물만 innerHTML 에 넣는다(원문 결합 금지).
    //   sanitizer 가 없는 페이지면 필요할 때만 끌어오고, 못 끌어오면 그 줄을 건너뛴다.
    // ========================================================================
    var PAGE_FILE = path.split('/').pop() || 'index.html';
    function overrideNodes(selector) {
        try { return qsa(selector); } catch (e) { return []; } // 잘못된 선택자 → 건너뜀
    }
    function loadSanitizer(cb) {
        if (window.ZiaSanitize) { cb(); return; }
        var fired = false;
        function finish() { if (fired) { return; } fired = true; cb(); }
        var timer = setTimeout(finish, 2000); // 로드 지연 안전망
        var s = document.createElement('script');
        s.src = BASE + '/static/js/zia-sanitize.js';
        s.onload = function () { clearTimeout(timer); finish(); };
        s.onerror = function () { clearTimeout(timer); finish(); };
        (document.head || document.body).appendChild(s);
    }
    function applyOverrideRow(row) {
        var nodes = overrideNodes(row.selector);
        if (!nodes.length) { return; } // 마크업이 바뀌어 자리를 못 찾음 → 조용히 건너뜀
        var value = String(row.value);
        nodes.forEach(function (el) {
            if (row.kind === 'text') {
                el.textContent = value;
            } else if (row.kind === 'html') {
                if (!window.ZiaSanitize || !window.ZiaSanitize.sanitize) { return; }
                el.innerHTML = window.ZiaSanitize.sanitize(value); // sanitize 산출물만 진입
            } else if (row.kind === 'image') {
                var img = (el.tagName === 'IMG') ? el : el.querySelector('img');
                if (img) { img.setAttribute('src', resolveAsset(value)); } // 경로 규약 재사용
            }
        });
    }
    function applyOverrides(rows, done) {
        var list = (rows || []).filter(function (r) {
            return r && r.selector && r.kind && r.value != null;
        });
        if (!list.length) { done(); return; } // 실패(null)·0건 → 정적/주입 상태 그대로
        var needsSanitizer = false;
        list.forEach(function (r) { if (r.kind === 'html') { needsSanitizer = true; } });
        function run() {
            list.forEach(function (r) { safe(function () { applyOverrideRow(r); }); });
            done();
        }
        if (needsSanitizer) { loadSanitizer(run); } else { run(); }
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

        // 편집기 행 특정 (post.title/badge/body .detail — #post-article 하위 전체가 이 행)
        stampRow(document.getElementById('post-article'), 'data-post-id', row.id);

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
        // 목록으로 — 소속 ZONE 의 글 아카이브로 (P3-g: 전용 페이지 유무와 무관하게 zone.html
        // 이 "목록"의 정확한 대응. 전용 페이지는 소개용이라 글 목록이 아니다).
        // zone_slug 가 없으면 정적 href('/') 유지.
        var back = document.getElementById('post-back');
        if (back && row.zone_slug) {
            back.setAttribute('href', zoneArchiveHref(row.zone_slug));
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
        } else if (KIND === 'zonearchive') {
            safe(function () { injectZoneArchive(zones, d.tags || []); }); // Z1/Z2/Z3 (P3-g)
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

        // P3-f — 수정 모드 전용 "링크 주소" 칩 (일반 방문자에겐 생성 0)
        safe(function () { injectLinkChips(S); });
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

    // 자유 편집 결과(P3-f) — 다른 소스와 **병렬** 시작 (지연 추가 0). 실패 시 null.
    var overridesPromise = fetchRows(
        'v_public_page_overrides?select=selector,kind,value&page=eq.' + encodeURIComponent(PAGE_FILE)
    );

    // 주입 완료 신호는 1회만 (오버라이드 적용까지 끝난 뒤). 예외·지연이 있어도 반드시 발화.
    var injectSignalled = false;
    function finishInject() {
        if (injectSignalled) { return; }
        injectSignalled = true;
        markInjectDone(); // P3-e — 주입 완료 신호 (성공·부분 실패 폴백 모두 이 시점 확정)
    }

    Promise.all([domReady, settleAll(keys.map(function (k) { return fetchRows(SOURCES[k]); })),
        detailPromise, overridesPromise])
        .then(function (out) {
            var results = out[1];
            var data = {};
            keys.forEach(function (k, i) {
                var r = results[i];
                data[k] = (r && r.status === 'fulfilled') ? r.value : null;
            });
            data.postDetail = out[2];
            safe(function () { apply(data); });
            // P3-f — 주입이 전부 끝난 **뒤** 자유 편집 결과 적용 (주입이 덮으면 안 됨)
            safe(function () { applyOverrides(out[3], finishInject); });
            setTimeout(finishInject, 2500); // 안전망 (sanitizer 지연·예외에도 신호 보장)
        });
})();
