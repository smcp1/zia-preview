$(function() {
    // =========================================================================
    // [1] 싱글 드롭다운 (Single Dropdown)
    // =========================================================================

    // 1-1. 드롭다운 초기화 함수
    window.dropdownReset = function(dropdown, placeholderText) {
        dropdown.addClass("placeholder");
        dropdown.removeClass("open");
        dropdown.find("> input").val(""); // 값 초기화
        dropdown.find("> button").text(placeholderText).prop('disabled', false);
        dropdown.find(".dropdown-list button").removeClass("selected");
    };

    // 1-2. 드롭다운 리렌더링 (동적 리스트 생성)
    window.dropdownRerender = function(dropdown, placeholderText, list) {
        dropdown.addClass("placeholder");
        dropdown.removeClass("open error-row");
        dropdown.find("> input").val("");
        dropdown.find("> button").text(placeholderText);
        dropdown.find(".dropdown-list button").removeClass("selected");
        dropdown.find(".dropdown-list li").remove();

        let listHtml = ""; // [중요] 빈 문자열 초기화 (undefined 방지)

        for (var i = 0; i < list.length; i++) {
            // 값이나 라벨이 없는 경우 방지
            const val = list[i].value !== undefined ? list[i].value : "";
            const lab = list[i].label !== undefined ? list[i].label : val;

            listHtml += `
            <li>
                <button type="button" data-value="${val}">
                    ${lab}
                </button>
            </li>`;
        }
        dropdown.find(".dropdown-list ul").html(listHtml);
    };

    // 1-3. 이벤트: 드롭다운 열기/닫기
    $(document).on("click", ".dropdown-box > button", function(e) {
        const box = $(this).closest(".dropdown-box");
        const list = box.find(".dropdown-list");
        const parentRow = box.closest(".form-row"); // Z-index 제어용 부모

        // 다른 열린 드롭다운 닫기
        const otherBoxes = $(".dropdown-box.open, .multi-dropdown-box.open").not(box);
        if (otherBoxes.length > 0) {
            otherBoxes.find(".dropdown-list").slideUp(200);
            otherBoxes.removeClass("open");
            otherBoxes.closest(".form-row").css("z-index", ""); // Z-index 초기화
        }

        // 토글
        list.slideToggle(200);
        box.toggleClass("open");

        // [Z-index] 열릴 때 부모를 위로 올림
        if (box.hasClass("open")) {
            parentRow.css("z-index", 11);
        } else {
            parentRow.css("z-index", "");
        }
    });

    // 1-4. 이벤트: 항목 선택
    $(document).on("click", ".dropdown-list button", function(e) {
        const btn = $(this);
        const box = btn.closest(".dropdown-box");
        const parentRow = box.closest(".form-row");
        const list = box.find(".dropdown-list");
        const label = btn.text();
        const value = btn.attr("data-value");

        // 플레이스홀더 스타일 제거
        if (box.hasClass("placeholder")) box.removeClass("placeholder");

        // 값 반영 및 이벤트 트리거
        box.find("> input").val(value).trigger("change");
        box.find("> button").text(label);

        // 선택 스타일 변경
        list.find("button").removeClass("selected");
        btn.addClass("selected");

        // 에러 상태 제거 로직
        parentRow.removeClass("error-row");
        const inputName = box.find("> input").attr("name");
        if (inputName) {
            $(`#${inputName}-error`).remove();
            box.find("> input").removeClass("error").removeAttr("aria-describedby");
        }

        // 닫기
        list.slideUp(200);
        box.removeClass("open");
        parentRow.css("z-index", ""); // Z-index 초기화
    });


    // =========================================================================
    // [2] 멀티(검색형) 드롭다운 (Multi/Searchable Dropdown)
    // =========================================================================

    // 2-1. 멀티 드롭다운 닫기 & 초기화 함수
    window.hideResetMultiDropdown = function(selector) {
        selector.find(".dropdown-list").slideUp(200);
        selector.removeClass("open");
        selector.closest(".form-row").css("z-index", ""); // Z-index 초기화

        // 애니메이션 후 내부 검색 상태 초기화
        setTimeout(function() {
            selector.find(".list-search input").val(""); // 검색어 초기화
            selector.find(".dropdown-list li").show();   // 리스트 전체 보이기
            selector.find(".dropdown-list li.empty").remove(); // '결과 없음' 제거
            selector.find(".dropdown-list li p").each(function() {
                $(this).html($(this).text()); // 하이라이팅 제거
            });
        }, 200);
    };

    // 2-2. 이벤트: 열기/닫기
    $(document).on("click", ".multi-dropdown-box > button", function(e) {
        const box = $(this).closest(".multi-dropdown-box");
        const list = box.find(".dropdown-list");
        const parentRow = box.closest(".form-row");

        // 다른 열린 드롭다운(싱글/멀티 모두) 닫기
        const otherSingle = $(".dropdown-box.open");
        if (otherSingle.length > 0) {
            otherSingle.find(".dropdown-list").slideUp(200);
            otherSingle.removeClass("open");
            otherSingle.closest(".form-row").css("z-index", "");
        }

        const otherMulti = $(".multi-dropdown-box.open").not(box);
        if (otherMulti.length > 0) {
            hideResetMultiDropdown(otherMulti);
        }

        // 토글
        list.slideToggle(200);
        box.toggleClass("open");

        if (box.hasClass("open")) {
            parentRow.css("z-index", 11);
            // 열릴 때 검색창에 포커스 (선택사항)
            // setTimeout(() => box.find(".list-search input").focus(), 200);
        } else {
            parentRow.css("z-index", "");
        }
    });

    // 2-3. 검색 기능 (특수문자 오류 해결 포함)
    function executeSearch(searchInput) {
        const box = searchInput.closest(".multi-dropdown-box");
        const list = box.find(".dropdown-list li");
        const keyword = searchInput.val().trim();

        // [중요] 정규식 특수문자 이스케이프 함수
        function escapeRegExp(string) {
            return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        list.filter(".empty").remove();
        let visibleCount = 0;

        if (keyword) {
            const regex = new RegExp(escapeRegExp(keyword), "gi");
            list.not(".empty").each(function() {
                const $p = $(this).find("p");
                const originalText = $p.text();

                if (originalText.match(regex)) {
                    $p.html(originalText.replace(regex, "<span>$&</span>")); // 하이라이팅
                    $(this).show();
                    visibleCount++;
                } else {
                    $(this).hide();
                }
            });
        } else {
            // 검색어 없음 -> 전체 표시
            list.not(".empty").each(function() {
                const $p = $(this).find("p");
                $p.html($p.text());
                $(this).show();
                visibleCount++;
            });
        }

        // 결과 없음 표시
        if (visibleCount === 0 && keyword) {
            if (box.find(".dropdown-list li.empty").length === 0) {
                box.find(".dropdown-list ul").append("<li class='empty'>검색 결과가 없습니다.</li>");
            }
        }
    }

    // 검색 이벤트 바인딩
    $(document).on("click", ".multi-dropdown-box .list-search a", function(e) {
        e.preventDefault();
        executeSearch($(this).prev("input"));
    });

    $(document).on("keydown", ".multi-dropdown-box .list-search input", function(e) {
        if (e.keyCode === 13) { // Enter Key
            e.preventDefault();
            executeSearch($(this));
        }
    });

    // 2-4. 항목 선택 (Radio 방식 - 단일 선택)
    $(document).on("change", ".multi-dropdown-item", function() {
        const box = $(this).closest(".multi-dropdown-box");
        const row = box.closest(".form-row");
        const checkValues = [];

        box.find(".multi-dropdown-item:checked").each(function() {
            checkValues.push({
                label: $(this).next("p").text(),
                value: $(this).val()
            });
        });

        // 라벨 업데이트
        if (checkValues.length === 0) {
            box.addClass("placeholder");
            box.find("> button").text(box.find("> button").data("placeholder"));
        } else {
            row.removeClass("error-row");
            box.removeClass("placeholder");
            box.find("> button").text(checkValues.map(item => item.label).join(", "));
        }

        // Hidden Input 값 업데이트
        box.find("> input").val(checkValues.map(item => item.value).join(",")).trigger("change");

        // 닫기
        hideResetMultiDropdown(box);
    });


    // =========================================================================
    // [3] 공통: 외부 클릭 및 ESC 닫기
    // =========================================================================
    
    // ESC 키
    $(window).keyup(function(e) {
        if (e.key === "Escape") {
            // 싱글 닫기
            if ($(".dropdown-box.open").length > 0) {
                const openBox = $(".dropdown-box.open");
                openBox.closest(".form-row").css("z-index", "");
                openBox.find(".dropdown-list").slideUp(200);
                openBox.removeClass("open");
            }
            // 멀티 닫기
            if ($(".multi-dropdown-box.open").length > 0) {
                hideResetMultiDropdown($(".multi-dropdown-box.open"));
            }
        }
    });

    // 외부 클릭
    $(document).click(function(e) {
        // 싱글 드롭다운 외부 클릭
        if (!$(e.target).closest(".dropdown-box").length) {
            const openBox = $(".dropdown-box.open");
            if (openBox.length > 0) {
                openBox.closest(".form-row").css("z-index", "");
                openBox.find(".dropdown-list").slideUp(200);
                openBox.removeClass("open");
            }
        }
        // 멀티 드롭다운 외부 클릭
        if (!$(e.target).closest(".multi-dropdown-box").length) {
            const openMulti = $(".multi-dropdown-box.open");
            if (openMulti.length > 0) {
                hideResetMultiDropdown(openMulti);
            }
        }
    });

});