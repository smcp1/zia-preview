// site-config.js — 지아한의원 전역 설정 (CTA 연결값 중앙 관리)
// URL 수령 시 이 파일만 수정하면 6페이지 전체에 반영된다 (channel.js가 참조).
// 빈 값("")이면 channel.js는 해당 CTA의 기존 href를 유지한다 (파괴 금지).
window.ZIA_CONFIG = {
    kakaoUrl: "",        // 카카오톡 채널 URL (수령 대기 — 예: https://pf.kakao.com/_xxxxxx)
    naverBookingUrl: "", // 네이버 예약 URL (수령 대기 — 예: https://booking.naver.com/booking/13/bizes/xxxxxx)
    phone: "02-2693-1055",
    // CMS 주입(cms-inject.js) 연결값 — admin/config.js 와 동일 값 유지.
    // supabaseKey = publishable(anon) 키: 공개 가능, 보안 경계는 RLS (rls.sql 원칙).
    // 빈 값이면 cms-inject.js 는 전체 no-op (정적 사이트로만 동작).
    supabaseUrl: "https://gefghbwtdkgguptzxyja.supabase.co",
    supabaseKey: "sb_publishable_qu_xpE_MA4i1Fyzl7iBprA_FsA8hq9U"
};
