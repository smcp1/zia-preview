// 드롭다운을 닫고 검색 상태를 초기화하는 함수
function hideResetMultiDropdown(selector) {
    selector.find(".dropdown-list").slideUp();
    selector.removeClass("open");
    setTimeout(function() {
        selector.find(".list-search input").val("");
        selector.find(".dropdown-list li").show();
        selector.find(".dropdown-list li.empty").remove();
        selector.find(".dropdown-list li p").each(function() {
            $(this).html($(this).text()); // 하이라이팅 제거
        });
    }, 200);
}

// (MultiDropdownRerender 함수는 기존과 동일하게 유지)
function MultiDropdownRerender(selector, list, radioName) {
    selector.addClass("placeholder");
    selector.removeClass("open error-row");
    selector.find("> button").text(selector.find("> button").data("placeholder"));
    selector.find("> input").val("");
    selector.find(".list-search input").val("");
    selector.find(".dropdown-list li").remove();
    selector.find(".dropdown-list").hide();

    let listHtml = '';
    //멀티선택
    /*for (var i = 0; i < list.length; i++) {
        listHtml += `
        <li>
        <label>
            <input type="checkbox"
            class="multi-dropdown-item"
            value="${list[i].value ? list[i].value : "list[i].value"}" 
            />
            <p>${list[i].label ? list[i].label : "list[i].label"}</p>
        </label>
        </li>
        `;
    }*/    
    for (var i = 0; i < list.length; i++) {
        listHtml += `
        <li>
            <label>
                <input type="radio"
                name="${radioName}"
                class="multi-dropdown-item"
                value="${list[i].value}" 
                />
                <p>${list[i].label}</p>
            </label>
        </li>
        `;
    }
    selector.find(".dropdown-list ul").html(listHtml);
}


$(function() {
    // 드롭다운 열기/닫기
    $(document).on("click", ".multi-dropdown-box > button", function(e) {
        const box = $(this).closest(".multi-dropdown-box"),
            list = box.find(".dropdown-list");

        if ($(".multi-dropdown-box.open").not(box).length > 0) {
            hideResetMultiDropdown($(".multi-dropdown-box.open").not(box));
        }
        list.slideToggle(200);
        box.toggleClass("open");
    });

    /**
     * 검색을 실행하고 결과를 표시하는 함수
     * @param {jQuery} searchInput - 검색창 input 요소
     */
    function executeSearch(searchInput) {
        const box = searchInput.closest(".multi-dropdown-box"),
            list = box.find(".dropdown-list li"),
            keyword = searchInput.val().trim(),
            regex = new RegExp(keyword, "gi");

        // 기존 '결과 없음' 메시지 제거
        list.filter(".empty").remove();
        let visibleCount = 0;

        list.not(".empty").each(function() {
            const $text = $(this).find("p");
            const originalText = $text.text();
            const match = originalText.match(regex) !== null;

            if (keyword && match) {
                // 검색어 하이라이팅
                $text.html(originalText.replace(regex, "<span>$&</span>"));
                $(this).show();
                visibleCount++;
            } else if (!keyword) {
                // 검색어가 없으면 모두 보여줌
                $text.html(originalText); // 하이라이팅 제거
                $(this).show();
                visibleCount++;
            } else {
                // 일치하지 않으면 숨김
                $(this).hide();
            }
        });

        // 보이는 항목이 없으면 '결과 없음' 메시지 표시
        if (visibleCount === 0 && keyword) {
            if (box.find(".dropdown-list li.empty").length === 0) {
                box.find(".dropdown-list ul").append("<li class='empty'>검색 결과가 없습니다.</li>");
            }
        }
    }

    // 검색 아이콘 클릭 시
    $(document).on("click", ".multi-dropdown-box .list-search a", function(e) {
        e.preventDefault();
        executeSearch($(this).prev("input"));
    });

    // 검색창에서 엔터 키 입력 시
    $(document).on("keydown", ".multi-dropdown-box .list-search input", function(e) {
        if (e.keyCode === 13) {
            e.preventDefault();
            executeSearch($(this));
        }
    });
    
    // 검색창에 입력할 때마다 실시간 검색 (선택사항, 원하시면 이 부분 주석 해제)
    /* 현재는 엔터 및 오른쪽 검색 버튼으로 검색
    $(document).on("keyup", ".multi-dropdown-box .list-search input", function(e) {
        executeSearch($(this));
    });
    */

    // 단일 선택
    $(document).on("change", ".multi-dropdown-item", function() {
        const row = $(this).closest(".input-row"),
            box = $(this).closest(".multi-dropdown-box"),
            checkValues = [];

        box.find(".multi-dropdown-item:checked").each(function() {
            checkValues.push({
                label: $(this).next("p").text(),
                value: $(this).val()
            });
        });

        if (checkValues.length === 0) {
            box.addClass("placeholder");
            box.find("> button").text(box.find("> button").data("placeholder"));
        } else {
            row.removeClass("error-row");
            box.removeClass("placeholder");
            box.find("> button").text(checkValues.map(item => item.label).join(", "));
        }

        box.find("> input").val(checkValues.map(item => item.value).join(",")).trigger("change");
        hideResetMultiDropdown(box);
    });

    //멀티선택
    /*$(document).on("change", ".multi-dropdown-item", function() {
        const row = $(this).closest(".input-row"),
            box = $(this).closest(".multi-dropdown-box"),
            checkValues = [];

        box.find(".multi-dropdown-item:checked").each(function() {
            checkValues.push({
                label:$(this).next("p").text(),
                value:$(this).val()
            });
        });
        
        if (checkValues.length === 0) {
            box.addClass("placeholder");
            box.find("> button").text(box.find("> button").data("placeholder"));
        } else {
            row.removeClass("error-row");
            box.removeClass("placeholder");
            box.find("> button").text(checkValues.map(item => item.label).join(", "));
        }

        box.find("> input").val(checkValues.map(item => item.value).join(",")).trigger("change");
    });*/

    
    // ESC 또는 외부 클릭 시 드롭다운 닫기
    $(window).keyup(function(e) {
        if (e.key === "Escape") {
            if ($(".multi-dropdown-box.open").length > 0) {
                e.stopImmediatePropagation();
                hideResetMultiDropdown($(".multi-dropdown-box.open"));
            }
        }
    });

    $(document).click(function(e) {
        if (!$(e.target).closest(".multi-dropdown-box").length) {
            hideResetMultiDropdown($(".multi-dropdown-box.open"));
        }
    });
});