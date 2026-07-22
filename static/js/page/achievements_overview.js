document.addEventListener("DOMContentLoaded", function() {
    const counters = document.querySelectorAll('.count-num');

    counters.forEach(counter => {
        const target = +counter.getAttribute('data-target'); // 최종 숫자
        
        // 💡 1. 목표 숫자의 크기에 따라 애니메이션 진행 시간(Duration) 동적 할당
        // 숫자가 50 미만이면 1.2초, 그 이상이면 2초로 설정하여 끊기는 현상 방지
        const animationDuration = target < 50 ? 1200 : 2000; 

        const startTime = performance.now(); // 애니메이션 시작 시간

        const updateCount = (currentTime) => {
            const elapsedTime = currentTime - startTime;
            const progress = Math.min(elapsedTime / animationDuration, 1); // 0에서 1까지 증가

            // 💡 2. easeOutQuart 효과 적용 (작은 숫자에서도 끝부분이 덜 답답하게 부드러워짐)
            const easeProgress = 1 - Math.pow(1 - progress, 4);
            const currentNum = Math.ceil(target * easeProgress);

            counter.innerText = currentNum;

            if (progress < 1) {
                requestAnimationFrame(updateCount);
            } else {
                counter.innerText = target; // 마지막에 정확히 목표 숫자 맞춤
            }
        };

        requestAnimationFrame(updateCount);
    });
});