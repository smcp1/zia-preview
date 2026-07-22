$(function() {
    
    // '파일 첨부' 또는 '파일 재첨부' input 변경 이벤트
    $(document).on('change', '.file-box input[type="file"]', function(e) {
        const $box = $(this).closest('.file-box');
        const $ul = $box.find('ul');
        const selectedFiles = e.target.files; // 선택된 모든 파일을 가져옵니다.

        if (selectedFiles.length > 0) {
            // 기존에 "업로드된 파일이 없습니다" 메시지가 있었다면 제거합니다.
            $ul.find('.no-file-message').remove();

            // 선택된 모든 파일을 순회하면서 목록에 추가합니다.
            for (const file of selectedFiles) {
                const fileName = file.name;
                const fileLiHtml = `
                    <li class="file_name">
                        <span class="name">${fileName}</span>
                        <button type="button" class="delete-btn">
                            <div class="icon-svg">
                                <svg class="icon-close">
                                    <use xlink:href="../../../resources/static/images/common/icons.svg#icon-close"></use>
                                </svg>
                            </div>
                        </button>
                    </li>`;
                
                // .html() 대신 .append()를 사용하여 기존 목록에 추가합니다.
                $ul.append(fileLiHtml);
            }
            
            // 파일 목록 UI를 활성화합니다.
            $box.find('.def').removeClass('hide');
            if (!$box.hasClass('reattachment')) {
                $box.find('.btns').addClass('hide');
            }
        }
        
        // input의 값을 초기화하여 동일한 파일을 다시 선택할 수 있도록 합니다.
        this.value = '';
    });

    // 파일 '삭제' 버튼 클릭 이벤트
    $(document).on('click', '.file-box .delete-btn', function() {
        const $box = $(this).closest('.file-box');
        const $ul = $box.find('ul');
        
        // 1. 클릭된 버튼이 속한 li만 삭제합니다.
        $(this).closest('li.file_name').remove();

        // ▼▼▼ [최종 수정] 내부에 삭제 버튼이 있는 li만 세도록 조건 변경 ▼▼▼
        // 2. 삭제 후 내부에 '.delete-btn'을 포함한 li가 하나도 없는지 확인합니다.
        if ($ul.children('li.file_name:has(button.delete-btn)').length === 0) {
        // ▲▲▲ [최종 수정] 끝 ▲▲▲
            
            // 목록이 비면 .def 컨테이너를 숨깁니다.
            const $defContainer = $ul.closest('.def');
            if ($defContainer.length > 0) {
                $defContainer.addClass('hide');
            }
            
            // 신규 첨부 타입인 경우에만 초기 버튼(.btns)을 다시 보여줍니다.
            if (!$box.hasClass('reattachment')) {
                $box.find('.btns').removeClass('hide');
            }
        }
    });
});