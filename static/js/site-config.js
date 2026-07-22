// site-config.js — 지아한의원 전역 설정 (CTA 연결값 중앙 관리)
// URL 수령 시 이 파일만 수정하면 6페이지 전체에 반영된다 (channel.js가 참조).
// 빈 값("")이면 channel.js는 해당 CTA의 기존 href를 유지한다 (파괴 금지).
window.ZIA_CONFIG = {
    kakaoUrl: "",        // 카카오톡 채널 URL (수령 대기 — 예: https://pf.kakao.com/_xxxxxx)
    naverBookingUrl: "", // 네이버 예약 URL (수령 대기 — 예: https://booking.naver.com/booking/13/bizes/xxxxxx)
    phone: "02-2693-1055"
};
