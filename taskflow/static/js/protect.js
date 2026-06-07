/* TaskFlow Frontend Protection — loaded first */
(function () {
  'use strict';

  // ── 1. Block DevTools keyboard shortcuts ─────────────
  document.addEventListener('keydown', function (e) {
    var k = e.key ? e.key.toUpperCase() : '';
    var blocked =
      e.key === 'F12' ||
      (e.ctrlKey && e.shiftKey && (k === 'I' || k === 'J' || k === 'C' || k === 'K' || k === 'E')) ||
      (e.ctrlKey && !e.shiftKey && (k === 'U' || k === 'S'));
    if (blocked) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return false;
    }
  }, true);

  // ── 2. Disable right-click (except form fields) ──────
  document.addEventListener('contextmenu', function (e) {
    var tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : '';
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
      e.preventDefault();
    }
  });

  // ── 3. Override console output ───────────────────────
  var _noop = function () {};
  ['log', 'debug', 'info', 'warn', 'error', 'dir', 'table', 'trace', 'group', 'groupEnd'].forEach(function (m) {
    try {
      Object.defineProperty(console, m, {
        get: function () { return _noop; },
        set: function () {},
        configurable: true,
      });
    } catch (_) {
      try { console[m] = _noop; } catch (__) {}
    }
  });
  // Xóa console định kỳ để ẩn output từ Network tab logs
  setInterval(function () {
    try { console.clear(); } catch (_) {}
  }, 1000);

  // ── 4. DevTools detection via window dimensions ──────
  // DevTools dock bên/dưới chiếm >160px so với inner window
  var _devOpen = false;
  var _overlay = null;

  function _makeOverlay() {
    var el = document.createElement('div');
    el.id = '_tfProt';
    el.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
      'z-index:2147483647', 'display:flex', 'align-items:center',
      'justify-content:center', 'background:rgba(10,14,22,.96)',
      'color:#fff', 'font-family:system-ui,sans-serif',
      'text-align:center',
    ].join(';');
    el.innerHTML =
      '<div>' +
      '<div style="font-size:52px;margin-bottom:18px">&#128274;</div>' +
      '<h2 style="margin:0 0 10px;font-size:20px;font-weight:600">Truy cập bị từ chối</h2>' +
      '<p style="margin:0;color:#6b7280;font-size:14px">Đóng Developer Tools để tiếp tục.</p>' +
      '</div>';
    return el;
  }

  function _onDevOpen() {
    document.body.style.filter = 'blur(8px)';
    document.body.style.pointerEvents = 'none';
    document.body.style.userSelect = 'none';
    if (!document.getElementById('_tfProt')) {
      _overlay = _makeOverlay();
      document.documentElement.appendChild(_overlay);
    }
  }

  function _onDevClose() {
    document.body.style.filter = '';
    document.body.style.pointerEvents = '';
    document.body.style.userSelect = '';
    var ov = document.getElementById('_tfProt');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    _overlay = null;
  }

  function _checkDevTools() {
    var isOpen =
      window.outerWidth - window.innerWidth > 160 ||
      window.outerHeight - window.innerHeight > 160;
    if (isOpen === _devOpen) return;
    _devOpen = isOpen;
    if (isOpen) _onDevOpen();
    else _onDevClose();
  }

  setInterval(_checkDevTools, 500);

  // ── 5. Debugger trap — pauses JS debugger khi DevTools đang mở ──
  // Tạo hàm chứa debugger statement, gọi định kỳ
  // Khi DevTools mở và ở tab Sources, JS sẽ bị pause liên tục
  var _trap = new Function('debugger');
  setInterval(_trap, 300);

  // ── 6. Detect devtools via toString override (Chrome) ──
  var _dtRe = /./;
  _dtRe.toString = function () { _checkDevTools(); return ''; };
  setInterval(function () { console.log('%c', _dtRe); }, 1000);

})();
