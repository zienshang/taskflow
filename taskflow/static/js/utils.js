// ── Date / Time helpers ─────────────────────────────
function parseUTC(iso) {
  if (!iso) return null;
  const s = /Z$|[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + 'Z';
  return new Date(s);
}

function fmtTime(iso) {
  if (!iso) return '-';
  const d = parseUTC(iso);
  if (!d || isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('vi-VN') + ' ' + d.toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'});
}

function fmtLastSeen(iso) {
  if (!iso) return 'Chưa đăng nhập';
  const d = parseUTC(iso);
  if (!d || isNaN(d.getTime())) return 'Chưa đăng nhập';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'Vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Hôm qua ' + d.toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'});
  if (days < 7)  return `${days} ngày trước`;
  return `${d.toLocaleDateString('vi-VN')} (${days} ngày trước)`;
}

function fmtCountdown(ms) {
  if (ms <= 0) return '0 ngày 0h 0p 0s';
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${d} ngày ${h}h ${m}p ${s}s`;
}

// ── XSS prevention ─────────────────────────────────
/**
 * Escape HTML special chars — dùng khi inject user-controlled text vào innerHTML.
 * Đặt tên ngắn `esc` vì dùng rất nhiều nơi trong template literals.
 *
 * KHÔNG dùng cho task description (intentional HTML — đã sanitize server-side bằng nh3).
 *
 * Tại sao cần: nếu HR nhập candidate_name = "<img src=x onerror=alert(1)>"
 * và admin xem activity log, đoạn đó sẽ được render vào innerHTML → XSS.
 */
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ── Currency ────────────────────────────────────────
function fmtCurrencyInput(el) {
  const raw = el.value.replace(/[^\d]/g, '');
  if (!raw) { el.value = ''; return; }
  const cursorFromEnd = el.value.length - el.selectionEnd;
  el.value = Number(raw).toLocaleString('vi-VN');
  const newPos = Math.max(0, el.value.length - cursorFromEnd);
  el.setSelectionRange(newPos, newPos);
}
