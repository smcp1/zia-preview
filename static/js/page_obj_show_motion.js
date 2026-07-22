document.addEventListener('DOMContentLoaded', function() {
    // 관찰 대상을 섹션이 아니라, 모든 모션 대상 요소로 변경
    const motionEls = document.querySelectorAll('[class*="motion-"]');
    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry, idx) => {
            if (entry.isIntersecting) {
                // 순차적 딜레이 부여 (옵션)
                entry.target.style.transitionDelay = (idx * 0.15) + 's';
                entry.target.classList.add('active');
                observer.unobserve(entry.target);
            }
        });
    }, {
        root: null,
        rootMargin: '0px 0px -20% 0px', // 하단에서 20% 위에 도달 시
        threshold: 0
    });
    motionEls.forEach(el => observer.observe(el));
});