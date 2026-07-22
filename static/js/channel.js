// channel.js — 유입경로(crm/ad/blog/default) 분기 + CTA 중앙 배선
//
// 로드 위치: 각 페이지 </body> 직전, site-config.js 다음 (동기 스크립트).
//
// [타이밍 근거 — 히어로 swiper init보다 먼저 실행됨]
// index.html의 메인 비주얼 swiper init(index.html 392~405행)은
// DOMContentLoaded 콜백 안에 있다. 본 스크립트는 </body> 직전의 동기 스크립트라
// "DOM 파싱 완료 후 ~ DOMContentLoaded 발화 전" 시점에 즉시 실행되므로,
// 아래의 slide2 제거/이동은 반드시 swiper init보다 먼저 끝난다.
// 반대로 본 파일 안에서 등록하는 DOMContentLoaded 리스너는 인라인 init 리스너보다
// 늦게 등록되어 init "이후"에 실행됨이 보장된다 (등록 순서 = 실행 순서).
//
// [채널 판별 규약]
// 1순위: ?ch=crm|ad|blog (재판별 우선, sessionStorage 갱신)
// 2순위: sessionStorage 유지값 (페이지 이동 간 유지)
// 3순위: document.referrer에 blog.naver.com 포함 → 'blog'
// 그 외: 'default' (저장하지 않음 — 이후 유입 시 재판별 여지 유지)
//
// [PII] CRM 이름은 query가 아닌 fragment(#n=)로 전달 — 서버 로그에 미잔존.
// 치환은 텍스트 노드(nodeValue)만 조작한다. innerHTML 사용 금지 (XSS 차단).
(function () {
    'use strict';

    var CONFIG = window.ZIA_CONFIG || {};
    var CH_KEY = 'zia.channel';
    var NAME_KEY = 'zia.name';
    var VALID = ['crm', 'ad', 'blog'];

    // ---------- 1. 채널 판별 ----------
    function paramChannel() {
        var m = /[?&]ch=([^&#]*)/.exec(window.location.search);
        if (!m) { return ''; }
        var v = '';
        try { v = decodeURIComponent(m[1]).toLowerCase(); } catch (e) { return ''; }
        return VALID.indexOf(v) !== -1 ? v : '';
    }
    function storedChannel() {
        try {
            var v = window.sessionStorage.getItem(CH_KEY);
            return VALID.indexOf(v) !== -1 ? v : '';
        } catch (e) { return ''; }
    }
    function store(key, val) {
        try { window.sessionStorage.setItem(key, val); } catch (e) { /* 시크릿 모드 등 */ }
    }

    var channel = paramChannel();
    if (channel) {
        store(CH_KEY, channel);
    } else {
        channel = storedChannel();
        if (!channel && document.referrer.indexOf('blog.naver.com') !== -1) {
            channel = 'blog';
            store(CH_KEY, channel);
        }
        if (!channel) { channel = 'default'; }
    }
    window.ZIA_CHANNEL = channel; // 디버그·후속 스크립트 참조용

    // ---------- 2. CRM 이름 (#n=<URI인코딩 이름>) ----------
    function hashName() {
        var m = /[#&]n=([^&]*)/.exec(window.location.hash);
        if (!m || !m[1]) { return ''; }
        var name = '';
        try { name = decodeURIComponent(m[1]); } catch (e) { return ''; }
        return name.replace(/\s+/g, ' ').trim().slice(0, 20);
    }

    // 텍스트 노드만 순회하며 치환 — 마크업(<br> 등) 보존, innerHTML 미사용
    function replaceTextNodes(root, from, to) {
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        var node;
        while ((node = walker.nextNode())) {
            if (node.nodeValue.indexOf(from) !== -1) {
                node.nodeValue = node.nodeValue.split(from).join(to);
            }
        }
    }

    // ---------- 3. 히어로 분기 (slide2가 있는 페이지 = index 한정) ----------
    var wrapper = document.querySelector('.main-visual-swiper .swiper-wrapper');
    var slide2 = wrapper ? wrapper.querySelector('.swiper-slide.slide2') : null;

    if (slide2) {
        if (channel === 'crm') {
            // slide2를 첫 슬라이드로 이동 → swiper init 시 index 0 = active
            if (wrapper.firstElementChild !== slide2) {
                wrapper.insertBefore(slide2, wrapper.firstElementChild);
            }
            var name = hashName();
            if (name) {
                store(NAME_KEY, name); // 탭 세션 한정 유지 (서버 미전송)
            } else {
                try { name = window.sessionStorage.getItem(NAME_KEY) || ''; } catch (e) { name = ''; }
            }
            if (name) {
                replaceTextNodes(slide2, '홍길동', name);
            } else {
                var h2 = slide2.querySelector('.visual-text h2');
                if (h2) { h2.textContent = '안녕하세요, 다시 찾아주셔서 감사합니다'; }
            }
        } else {
            // default / ad / blog: CRM 개인화 슬라이드 노출 차단 (swiper init 전 제거)
            wrapper.removeChild(slide2);
        }

        // init 이후 보정 (본 리스너는 인라인 init 리스너보다 늦게 실행됨 — 상단 주석 참조)
        document.addEventListener('DOMContentLoaded', function () {
            var el = document.querySelector('.main-visual-swiper');
            var sw = el && el.swiper;
            if (!sw || !sw.autoplay) { return; }
            if (channel === 'crm') {
                sw.autoplay.stop(); // CRM: 개인화 슬라이드 고정 (수동 스와이프는 허용)
            } else if (wrapper.querySelectorAll('.swiper-slide').length <= 1) {
                sw.autoplay.stop(); // 슬라이드 1장: 불필요한 autoplay 타이머 정지
            }
        });
    }

    // ---------- 4. CTA 중앙 배선 (6페이지 공통) ----------
    var telHref = CONFIG.phone ? 'tel:' + String(CONFIG.phone).trim() : '';
    var kakaoUrl = (CONFIG.kakaoUrl || '').trim();
    var naverUrl = (CONFIG.naverBookingUrl || '').trim();

    var TEL_TEXT = ['전화문의', '전화 문의'];
    var KAKAO_TEXT = ['카카오 상담', '카카오상담'];
    var NAVER_TEXT = ['네이버 예약', '네이버예약', '진료예약', '진료 예약하기'];

    function ctaTarget(el) {
        var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (el.querySelector('.icon-tel-cs') || TEL_TEXT.indexOf(t) !== -1) { return telHref; }
        if (el.querySelector('.icon-kakao-cs') || KAKAO_TEXT.indexOf(t) !== -1) { return kakaoUrl; }
        if (el.querySelector('.icon-naver-booking, .icon-naver-booking2') ||
            NAVER_TEXT.indexOf(t) !== -1) { return naverUrl; }
        return ''; // CTA 아님
    }

    // 4-1. placeholder 앵커(href="#"|"#none")만 배선 — 실 링크·비CTA(gnb, 필터, top버튼)는 불변.
    //      config 값이 비어 있으면("") 기존 href 유지 (파괴 금지).
    var anchors = document.querySelectorAll('a[href="#"], a[href="#none"]');
    Array.prototype.forEach.call(anchors, function (a) {
        var url = ctaTarget(a);
        if (!url) { return; }
        a.setAttribute('href', url);
        if (/^https?:/.test(url)) {
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener');
        }
    });

    // 4-2. <button> CTA (index 히어로 slide1 전화문의/진료예약) — click 배선
    var buttons = document.querySelectorAll('button.btn');
    Array.prototype.forEach.call(buttons, function (btn) {
        var url = ctaTarget(btn);
        if (!url) { return; }
        btn.addEventListener('click', function () {
            if (/^https?:/.test(url)) {
                window.open(url, '_blank', 'noopener');
            } else {
                window.location.href = url;
            }
        });
    });
})();
