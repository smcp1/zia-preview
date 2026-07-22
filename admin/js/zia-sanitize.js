/* ============================================================================
 * zia-sanitize.js — 글 본문 HTML 화이트리스트 sanitize (P3-d 콘텐츠 파이프라인)
 *
 * 사용처 (동일 파일 2본 유지 — 수정 시 반드시 두 곳 함께, diff로 정합 검증):
 *   1) admin/js/zia-sanitize.js        — 붙여넣기 에디터 (저장 전 sanitize)
 *   2) site/static/js/zia-sanitize.js  — post.html 렌더 전 재-sanitize (이중 방어)
 *
 * 원칙:
 *   - DOM 파서 기반 (createHTMLDocument 비활성 문서 — script 미실행·리소스 미로드).
 *     정규식 sanitize 금지. innerHTML에 원문 결합 금지 (출력은 새 DOM 조립 후 직렬화).
 *   - 허용 태그: p h2 h3 h4 img ul ol li strong b em i a br blockquote
 *   - 속성: 전면 제거. 예외 = img src(http/https/data:image)·alt, a href(http/https만).
 *   - 위험 계열 태그(script/style/iframe/on* 포함 여지)는 내용까지 통째 제거,
 *     그 외 비허용 태그(div/span/table 등)는 unwrap (자식만 승격).
 *   - UMD: 브라우저 = window.ZiaSanitize / node = module.exports (jsdom document
 *     주입으로 단위 검증 — 두 번째 인자 doc).
 * ========================================================================== */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(); }
    else { root.ZiaSanitize = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // 허용 태그 (본문 화이트리스트 — CLAUDE 사양 고정)
    var ALLOWED = {
        p: 1, h2: 1, h3: 1, h4: 1, img: 1, ul: 1, ol: 1, li: 1,
        strong: 1, b: 1, em: 1, i: 1, a: 1, br: 1, blockquote: 1
    };
    // 내용까지 통째로 버리는 태그 (실행·폼·외부 로드 위험 계열)
    var DROP = {
        script: 1, style: 1, iframe: 1, frame: 1, frameset: 1, object: 1,
        embed: 1, applet: 1, form: 1, input: 1, button: 1, textarea: 1,
        select: 1, option: 1, link: 1, meta: 1, base: 1, title: 1, head: 1,
        noscript: 1, template: 1, svg: 1, math: 1, audio: 1, video: 1,
        source: 1, track: 1, canvas: 1, dialog: 1, slot: 1
    };
    // 그 외 태그 (div/span/table/font/section …) = unwrap: 태그만 벗기고 자식 승격

    // img src 허용: http(s) + data:image(래스터만 — svg는 스크립트 내포 여지로 배제).
    // data:image는 붙여넣기 직후 임시 상태 — admin 업로드 사다리가 storage URL로 교체.
    function validImgSrc(src) {
        src = String(src == null ? '' : src).trim();
        if (/^https?:\/\//i.test(src)) { return src; }
        if (/^data:image\/(png|jpe?g|gif|webp|avif|bmp);/i.test(src)) { return src; }
        return '';
    }
    // a href 허용: http(s)만 (javascript: · data: · 상대경로 전부 차단)
    function validHref(href) {
        href = String(href == null ? '' : href).trim();
        return /^https?:\/\//i.test(href) ? href : '';
    }

    // src(원본 트리) 자식들을 화이트리스트 규칙으로 out(출력 트리)에 재조립
    function walk(node, out, doc) {
        var child = node.firstChild;
        while (child) {
            var next = child.nextSibling; // 순회 중 원본 불변 — 미리 확보
            if (child.nodeType === 3) { // Text
                out.appendChild(doc.createTextNode(child.nodeValue));
            } else if (child.nodeType === 1) { // Element
                var tag = child.tagName.toLowerCase();
                if (DROP[tag]) {
                    // 내용째 폐기
                } else if (ALLOWED[tag]) {
                    // 새 요소 생성 = 속성 0에서 시작 (style/class/on*·기타 전면 제거)
                    var el = doc.createElement(tag);
                    if (tag === 'img') {
                        var srcVal = validImgSrc(child.getAttribute('src'));
                        if (srcVal) {
                            el.setAttribute('src', srcVal);
                            var alt = child.getAttribute('alt');
                            if (alt) { el.setAttribute('alt', alt); }
                            out.appendChild(el);
                        }
                        // src 무효 → img 자체 제거
                    } else if (tag === 'br') {
                        out.appendChild(el);
                    } else {
                        if (tag === 'a') {
                            var hrefVal = validHref(child.getAttribute('href'));
                            if (hrefVal) { el.setAttribute('href', hrefVal); }
                        }
                        walk(child, el, doc);
                        out.appendChild(el);
                    }
                } else {
                    walk(child, out, doc); // unwrap — 자식만 승격
                }
            }
            // 그 외 노드(주석 등) 폐기
            child = next;
        }
    }

    // html 문자열 → sanitize된 html 문자열.
    // doc: DOM Document (브라우저 = 생략 시 window.document / node 검증 = jsdom document)
    function sanitize(html, doc) {
        doc = doc || (typeof document !== 'undefined' ? document : null);
        if (!doc || !doc.implementation) {
            throw new Error('ZiaSanitize: DOM document가 필요합니다');
        }
        // 비활성 문서에서 파싱 — script 미실행, img 등 리소스 미로드
        var work = doc.implementation.createHTMLDocument('');
        var src = work.createElement('div');
        src.innerHTML = String(html == null ? '' : html);
        var out = work.createElement('div');
        walk(src, out, work);
        return out.innerHTML; // 새 DOM 직렬화 — 텍스트·속성 자동 이스케이프
    }

    // 블록 경계에서 개행을 넣는 텍스트 추출 (목록 발췌·검색용 posts.body 저장분)
    var BLOCK_END = { p: 1, h2: 1, h3: 1, h4: 1, li: 1, blockquote: 1, ul: 1, ol: 1 };
    function collectText(node, buf) {
        var child = node.firstChild;
        while (child) {
            if (child.nodeType === 3) {
                buf.push(child.nodeValue);
            } else if (child.nodeType === 1) {
                var tag = child.tagName.toLowerCase();
                if (tag === 'br') { buf.push('\n'); }
                else {
                    collectText(child, buf);
                    if (BLOCK_END[tag]) { buf.push('\n'); }
                }
            }
            child = child.nextSibling;
        }
    }
    // sanitize 결과 html → plain text (이미지 제외, 블록 = 개행, 연속 개행 압축)
    function toText(html, doc) {
        doc = doc || (typeof document !== 'undefined' ? document : null);
        if (!doc || !doc.implementation) {
            throw new Error('ZiaSanitize: DOM document가 필요합니다');
        }
        var work = doc.implementation.createHTMLDocument('');
        var box = work.createElement('div');
        box.innerHTML = sanitize(html, doc); // 안전 보장 후 추출
        var buf = [];
        collectText(box, buf);
        return buf.join('')
            .replace(/[ \t ]+/g, ' ')
            .replace(/ ?\n ?/g, '\n')
            .replace(/\n{2,}/g, '\n')
            .trim();
    }

    return { sanitize: sanitize, toText: toText, ALLOWED: ALLOWED };
}));
