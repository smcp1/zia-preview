/**
 * ==============================================================================
 * COMMON.JS
 * 프로젝트 전체에서 공통으로 사용되는 UI/UX 스크립트 모음
 * ==============================================================================
 */

$(document).ready(function(){
    // 2. 드롭다운 열린 상태에서 바탕화면(외부) 클릭 시 닫기
    $(document).on('click', function(e) {
        if (!$(e.target).closest('.lang-selector').length) {
            $('.lang-selector').removeClass('is-open');
            $('.lang-selector .btn-lang').attr('aria-expanded', 'false');
        }
    });
    /* ==========================================================================
       [1] 전역 유틸리티 함수
       ========================================================================== */
    
    /**
     * 화면 크기 체크 함수
     * @returns {boolean} 브라우저 가로폭이 1200px 미만(모바일/태블릿)이면 true 반환
     */
    function isMobile() {
        return window.innerWidth < 1200;
    }

    
    /* ==========================================================================
       [2] 헤더 & GNB (Global Navigation Bar) 제어 로직
       ========================================================================== */

    /**
     * 전체 메뉴(모바일 햄버거 / PC 전체메뉴) 열기/닫기 토글
     */
    function toggleMenu() {
        var mobile = isMobile();
        var $toggleBtn = $('#toggle-menu');

        $toggleBtn.toggleClass('menu-is-active').promise().done(function() {
            $("body").toggleClass('overflow'); // 스크롤 잠금/해제
            
            // 디바이스 상태에 따라 다른 클래스 부여
            if (mobile) {
                $("header").toggleClass('mobile-menu-open');
            } else {
                $("header").toggleClass('pc-menu-open');
            }

            // 닫힐 때 하위 메뉴(Depth2) 초기화
            if (!$toggleBtn.hasClass('menu-is-active')) {
                // CSS 트랜지션(약 0.3초) 종료 후 사용자 눈에 띄지 않게 슬라이드 초기화
                setTimeout(function() {
                    $('.gnb_list > li').removeClass('on');
                    $('.gnb_list .depth_box').css('display', ''); // jQuery slideDown 흔적 제거
                }, 300); 
            }
        });
    }
    
    // 전체메뉴 열기 버튼 클릭 이벤트
    $('#toggle-menu').click(function(e) {
        e.preventDefault();
        toggleMenu(); 
    });
    
   

    /**
     * 모바일 GNB 아코디언 메뉴 (1Depth 클릭 시 2Depth 슬라이드 토글)
     */
    $('.gnb_list > li > a').on('click', function(e) {
        if (!isMobile()) return; // PC 상태에서는 기본 링크 이동 허용

        var $depthBox = $(this).next('.depth_box');
        var $gnbItem = $(this).parent('li');
        
        // 2Depth(하위 메뉴)가 존재하는 경우에만 토글 작동
        if ($depthBox.find('.depth2').length > 0) {
            e.preventDefault(); // 링크 이동 방지
            
            if ($gnbItem.hasClass('on')) {
                // 이미 열려있는 메뉴 클릭 시 -> 닫기
                $depthBox.slideUp(200);
                $gnbItem.removeClass('on');
            } else {
                // 닫혀있는 메뉴 클릭 시 -> 다른 열린 메뉴 닫고 해당 메뉴 열기
                $('.gnb_list .depth_box').slideUp(200);
                $('.gnb_list > li').removeClass('on');
                
                $depthBox.slideDown(200);
                $gnbItem.addClass('on');
            }
        }
    });

    /**
     * 모바일 메뉴 내부 스크롤 시 헤더 디자인 변경 (그림자 등)
     */
    const $header = $('header');
    const $gnb = $('.gnb');
  
    const handleGnbScroll = () => {
        if ($gnb.scrollTop() > 50) {
            $header.addClass('scrolled');
        } else {
            $header.removeClass('scrolled');
        }
    };

    const checkDeviceAndApplyListener = () => {
        if (isMobile()) {
            $gnb.on('scroll', handleGnbScroll); // 모바일에서만 스크롤 감지 켬
        } else {
            $gnb.off('scroll', handleGnbScroll);
            $header.removeClass('scrolled');
        }
    };

    /**
     * 브라우저 리사이즈 시 GNB 초기화 (디바이스 전환 시 오류 방지)
     */
    function resetGnbOnResize() {
        $('#toggle-menu').removeClass('menu-is-active');
        $('body').removeClass('overflow');
        $('header').removeClass('mobile-menu-open pc-menu-open');
        
        $('.gnb_list > li').removeClass('on');
        $('.gnb_list .depth_box').css('display', '').removeClass('is-active'); 

        // PC 전용 클래스 부여 기준
        if (window.innerWidth >= 1000) {
            $('header').addClass('pc');
        } else {
            $('header').removeClass('pc');
        }
    }

    /* ==========================================================================
       [리사이즈 이벤트 최적화 (Debounce 적용)]
       ========================================================================== */
    let lastWindowWidth = $(window).width();
    let resizeTimer = null;

    // 기존 분산되어 있던 $(window).on('resize', ...) 이벤트들을 하나로 통합
    $(window).on('resize', function() {
        clearTimeout(resizeTimer);
        
        // 창 크기 조절이 멈추고 0.15초 뒤에 내부 로직을 딱 1번만 실행
        resizeTimer = setTimeout(function() {
            let currentWindowWidth = $(window).width();

            // 1. GNB 모바일/PC 레이아웃 분기점 교차 체크
            if (lastWindowWidth !== currentWindowWidth) {
                if ((lastWindowWidth < 1000 && currentWindowWidth >= 1000) || (lastWindowWidth >= 1000 && currentWindowWidth < 1000)) {
                     resetGnbOnResize();
                }
                checkDeviceAndApplyListener();
                lastWindowWidth = currentWindowWidth;
            }

            // 2. 퀵메뉴 및 스크롤 UI 재계산 (리플로우 방지)
            if (typeof getQuickBottom === 'function') {
                getQuickBottom(); 
            }
        }, 150); 
    });

    /**
     * PC GNB 마우스 오버(Hover) 메뉴 노출 로직
     */
    $('.pc-gnb-row .gnb_list > li').on('mouseenter', function() {
        if(isMobile()) return; // 모바일 햄버거 메뉴에서는 작동 금지

        // 다른 메뉴 닫기 후 현재 마우스가 올라간 메뉴만 열기
        $('.pc-gnb-row .gnb_list > li').removeClass('on'); 
        $('.pc-gnb-row .depth_box').removeClass('is-active'); 
        
        $(this).children('.pc-gnb-row .depth_box').addClass('is-active');
        $(this).addClass('on');

        $header.addClass('is-hovered');
    });

    $('.pc-gnb-row .gnb_list > li').on('mouseleave', function() {
        if(isMobile()) return;
        
        $(this).children('.pc-gnb-row .depth_box').removeClass('is-active');
        $(this).removeClass('on');

        $header.removeClass('is-hovered');
    });


    /* ==========================================================================
       [3] 스크롤 연동 UI 제어 (퀵메뉴 & 헤더 숨김 처리)
       ========================================================================== */

    // 퀵메뉴 'Top' 버튼 클릭 시 페이지 최상단으로 부드럽게 이동
    $('#quick li:last-child a').on('click', function(e) {
        e.preventDefault(); 
        $('html, body').animate({ scrollTop: 0 }, 400); 
    });

    var $window = $(window);
    var $quick = $('#quick');
    var $footer = $('footer');
    
    var defaultBottom = 0;
    var lastScrollTop = 0; 
    var delta = 5; 
    var headerHeight = $header.outerHeight(); 

    /**
     * 퀵메뉴의 기본 하단 여백(bottom) 값을 계산
     */
    function getQuickBottom() {
        if (window.innerWidth >= 1200) {
            $quick.css({ 'transition': 'none', 'bottom': '' }); 
            defaultBottom = parseInt($quick.css('bottom')) || 40; 
        } else {
            defaultBottom = 0; 
        }
        
        $quick[0].offsetHeight; 
        $quick.css('transition', ''); 
        
        updateScroll();
    }

    /**
     * 스크롤 시 헤더 및 퀵메뉴의 위치/노출 여부 계산
     */
    function updateScroll() {
        // (이하 기존 updateScroll 내용과 동일하게 유지)
        var currentScrollTop = $window.scrollTop();
        var scrollBottom = currentScrollTop + $window.height();
        var footerOffset = $footer.length > 0 ? $footer.offset().top : $(document).height(); 
        var isAtFooter = scrollBottom > footerOffset;
        var overlap = isAtFooter ? scrollBottom - footerOffset : 0;

        if (currentScrollTop > 0) {
            $('header').addClass('is-scrolled');
        } else {
            $('header').removeClass('is-scrolled');
        }

        if (window.innerWidth >= 1200) {
            if (isAtFooter) {
                $quick.css('bottom', (defaultBottom + overlap) + 'px');
            } else {
                $quick.css('bottom', '');
            }
        } else {
            if (isAtFooter) {
                $quick.css('bottom', overlap + 'px');
            } else {
                $quick.css('bottom', '0px');
            }
        }

        if (Math.abs(lastScrollTop - currentScrollTop) <= delta) {
            return; 
        }

        if (currentScrollTop > lastScrollTop && currentScrollTop > headerHeight) {
            $('header').addClass('hide');
            
            if (window.innerWidth >= 1200) {
                if (!isAtFooter) {
                    $quick.addClass('hide');
                } else {
                    $quick.removeClass('hide');
                }
            } else {
                $quick.removeClass('hide');
            }
        } else {
            if(currentScrollTop + $window.height() < $(document).height()) {
                $('header').removeClass('hide');
                $quick.removeClass('hide');
            }
        }

        lastScrollTop = currentScrollTop;
    }

    // 스크롤 이벤트 바인딩 유지
    $window.on('scroll', updateScroll);
    
    // 최초 1회 실행
    getQuickBottom();
});
