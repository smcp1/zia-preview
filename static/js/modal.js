/* =================================================================
   [Config] Modal Configuration
   * 주의: 이 변수(modalMatch)는 프로젝트 전체에서 딱 한 번만 선언되어야 합니다.
   ================================================================= */
const modalMatch = {
    "login_modal": { // HTML data-modal="login_modal" 과 일치해야 함
        url: "../modal/loginModal.html",
        hasScroll: false,
        style: "max-width: 400px"
    },
    // 필요한 모달 계속 추가...
    "notice_modal": {
        url: "../modal/noticeModal.html",
        hasScroll: true,
        style: "max-width: 600px"
    }
};

// Z-Index 시작값
let baseZIndex = 2000;


/* =================================================================
   [Core] Modal Logic (Vanilla JS)
   ================================================================= */

// 1. 모달 열기 함수
async function openModal(modalId, data = {}) {
    // (1) 설정 확인
    const config = modalMatch[modalId];
    if (!config) {
        console.error(`[Modal] 설정을 찾을 수 없습니다: ${modalId}`);
        alert('모달 설정이 올바르지 않습니다.');
        return;
    }

    // (2) HTML 파일 불러오기 (Fetch API)
    try {
        const response = await fetch(config.url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const htmlContent = await response.text();

        // (3) DOM 생성
        const modal = document.createElement('div');
        modal.className = 'modal-dim'; // 배경 (SCSS .modal-dim 대응)
        modal.id = modalId;
        
        // Z-Index 자동 증가
        const currentOpenModals = document.querySelectorAll('.modal-dim.is-active').length;
        modal.style.zIndex = baseZIndex + currentOpenModals;

        // 모달 내부 구조 조립
        // config.style이 있으면 적용, 없으면 빈 문자열
        modal.innerHTML = `
            <div class="modal-layer" style="${config.style || ''}">
                ${htmlContent}
            </div>
        `;

        // (4) Body에 추가
        document.body.appendChild(modal);
        
        // (5) 스크롤 잠금
        document.body.classList.add('no-scroll');

        // (6) 등장 애니메이션
        requestAnimationFrame(() => {
            modal.classList.add('is-active');
        });

    } catch (error) {
        console.error('[Modal] 로딩 실패:', error);
        alert('모달을 불러오는 중 오류가 발생했습니다.\n경로를 확인해주세요: ' + config.url);
    }
}


// 2. 모달 닫기 함수
function closeModal(target) {
    const modalDim = target.closest('.modal-dim');
    if (!modalDim) return;

    // (1) 애니메이션 시작 (사라짐)
    modalDim.classList.remove('is-active');

    // (2) 트랜지션 후 제거
    setTimeout(() => {
        modalDim.remove();

        // (3) 남은 모달이 없으면 스크롤 잠금 해제
        const remainingModals = document.querySelectorAll('.modal-dim');
        if (remainingModals.length === 0) {
            document.body.classList.remove('no-scroll');
        }
    }, 300); 
}


/* =================================================================
   [Event] Global Event Listeners
   ================================================================= */
document.addEventListener('DOMContentLoaded', () => {

    // 1. 열기 버튼 클릭 (이벤트 위임)
    document.body.addEventListener('click', (e) => {
        // .btn-modal 클래스를 가진 버튼을 찾음
        const btn = e.target.closest('.btn-modal');
        if (btn) {
            // 버튼의 data-modal 값 가져오기 (예: login_modal)
            const modalId = btn.dataset.modal;
            if (modalId) {
                openModal(modalId);
            } else {
                console.warn('[Modal] data-modal 속성이 없습니다.');
            }
        }
    });

    // 2. 닫기 버튼 (X)
    document.body.addEventListener('click', (e) => {
        const closeBtn = e.target.closest('.btn-close-modal');
        if (closeBtn) {
            closeModal(closeBtn);
        }
    });

    // 3. 배경 클릭 닫기
    document.body.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-dim')) {
            closeModal(e.target);
        }
    });

    // 4. ESC 키 닫기
    window.addEventListener('keyup', (e) => {
        if (e.key === 'Escape') {
            const openModals = Array.from(document.querySelectorAll('.modal-dim.is-active'));
            if (openModals.length > 0) {
                // 가장 위에 있는(Z-Index 높은) 모달부터 닫기
                openModals.sort((a, b) => parseInt(b.style.zIndex) - parseInt(a.style.zIndex));
                closeModal(openModals[0]);
            }
        }
    });

});