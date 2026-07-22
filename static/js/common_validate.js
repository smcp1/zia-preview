$(document).ready(function() {
    // 유효성 검사 공통 함수
    //jQuery Validate 플러그인이 로드되었는지 확인!
    if ($.fn.validate) {
        // --- 유효성 검사 관련 설정 시작
        $.validator.setDefaults({
            ignore: [],
            errorElement: "div",
            errorClass: "error",
            validClass: "valid",
            errorPlacement: function(error, element) {
                error.insertAfter(element); 
            }
        });

        // 이메일
        $.validator.addMethod("formatEmail", function(value, element) {
            return this.optional(element) || /^[\w._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/.test(value);
        }, "유효한 이메일 주소를 입력해주세요.");

        // 비밀번호
        $.validator.addMethod("formatPw", function(value, element) {
            return this.optional(element) || /^(?=.*[a-zA-Z])(?=.*[0-9])(?=.*[!@#$%^&*?_]).{8,20}$/.test(value);
        }, "비밀번호는 영문, 숫자, 특수문자를 포함하여 8~20자리여야 합니다.");

        // 휴대폰
        $.validator.addMethod("phoneKR", function(value, element) {
            return this.optional(element) || /^010-?([0-9]{4})-?([0-9]{4})$/.test(value);
        }, "올바른 휴대폰 번호 형식이 아닙니다.");

        // 아이디 영문과 숫자만 허용하는 규칙 (alphanumeric)
        $.validator.addMethod("alphanumeric", function(value, element) {
            return this.optional(element) || /^[a-zA-Z0-9]+$/.test(value);
        }, "아이디는 영문과 숫자만 사용 가능합니다.");        
        // --- 유효성 검사 관련 설정 끝 ---
    }   
});