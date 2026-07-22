/* ============================================================================
 * ui.js — 공용 UI 헬퍼 (토스트 · confirm 모달 · HTML 이스케이프)
 * ========================================================================== */
(function () {
  "use strict";

  /** DB 값 → HTML 삽입 전 이스케이프 (모든 동적 값에 필수 적용) */
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* ── 토스트 ──
   * holdMs (선택, P3-e): 표시 유지 시간 재정의 — 액션 버튼("홈페이지에서 확인하기")을
   * 담을 때 누를 시간을 확보. 미지정 시 기존 동작 그대로 (회귀 0).
   */
  var toastTimer = null;
  function toast(message, type, holdMs) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message;
    el.className = type === "error" ? "toast-error show" : "show";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ""; }, holdMs || (type === "error" ? 4200 : 2600));
  }

  /* ── confirm 모달 (파괴적 액션 전용) ──
   * confirmModal({ title, body, confirmLabel, cancelLabel, danger }) → Promise<boolean>
   */
  function confirmModal(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var root = document.getElementById("modal-root");
      var overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true">' +
        "<h2>" + esc(opts.title || "확인해 주세요") + "</h2>" +
        "<p>" + esc(opts.body || "") + "</p>" +
        '<div class="modal-actions">' +
        '<button type="button" class="btn-ghost" data-act="cancel">' + esc(opts.cancelLabel || "취소") + "</button>" +
        '<button type="button" class="' + (opts.danger ? "btn-danger-solid" : "btn-primary") + '" data-act="ok">' +
        esc(opts.confirmLabel || "확인") + "</button>" +
        "</div></div>";
      function close(result) {
        overlay.remove();
        document.removeEventListener("keydown", onKey);
        resolve(result);
      }
      function onKey(e) { if (e.key === "Escape") close(false); }
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) close(false);
        var act = e.target.getAttribute && e.target.getAttribute("data-act");
        if (act === "ok") close(true);
        if (act === "cancel") close(false);
      });
      document.addEventListener("keydown", onKey);
      root.appendChild(overlay);
      var okBtn = overlay.querySelector('[data-act="ok"]');
      if (okBtn) okBtn.focus();
    });
  }

  /** 버튼 작업 중 상태 (이중 클릭 방지) */
  function busy(btn, on, busyLabel) {
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.textContent;
      btn.textContent = busyLabel || "잠시만요…";
      btn.disabled = true;
    } else {
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
      btn.disabled = false;
    }
  }

  window.UI = { esc: esc, toast: toast, confirmModal: confirmModal, busy: busy };
})();
