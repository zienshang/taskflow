// ── Role helpers ─────────────────────────────────────
// Trả về true cho Admin và HR Leader (có quyền quản lý)
function isAdminLike() {
  return currentUser && (currentUser.role === 'admin' || currentUser.role === 'hr_leader');
}

// ── Global state ────────────────────────────────────
const API = '';
let token = localStorage.getItem('tf_token');
let currentUser = (() => { try { return JSON.parse(localStorage.getItem('tf_user') || 'null'); } catch { return null; } })();
let resetPwUsername = '';

// ── API helpers ─────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? {'Authorization': 'Bearer ' + token} : {}),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/auth/login') { doLogout(); }
    throw new Error(data.detail || 'Lỗi server');
  }
  return data;
}

async function apiFormData(method, path, formData) {
  const opts = {
    method,
    headers: {...(token ? {'Authorization': 'Bearer ' + token} : {})},
    body: formData,
  };
  const res = await fetch(API + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/auth/login') { doLogout(); }
    throw new Error(data.detail || 'Lỗi server');
  }
  return data;
}

// ── Secure image loader ─────────────────────────────
// Dùng cho ảnh yêu cầu JWT (/api/uploads/...) — <img src> không gửi được header
// containerEl: element sẽ chứa <img> sau khi load xong
// opts.linkable: có wrap <a> để mở fullsize không (mặc định true)
// opts.imgStyle: CSS bổ sung cho <img>
async function loadSecureImg(url, containerEl, opts = {}) {
  if (!url || !containerEl) return;
  const { linkable = true, imgStyle = '' } = opts;
  try {
    const resp = await fetch(url, {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
    if (!resp.ok) throw new Error('fetch failed');
    const blob = await resp.blob();
    const objUrl = URL.createObjectURL(blob);
    const imgTag = `<img src="${objUrl}" style="width:100%;height:100%;object-fit:contain;display:block;${imgStyle}">`;
    containerEl.innerHTML = linkable
      ? `<a href="${objUrl}" target="_blank" style="display:block;width:100%;height:100%;cursor:zoom-in">${imgTag}</a>`
      : imgTag;
  } catch (_) {
    containerEl.innerHTML = `<span style="color:var(--c-muted);font-size:12px">Không tải được ảnh</span>`;
  }
}

// ── Toast ───────────────────────────────────────────
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── Modal (base) ────────────────────────────────────
function _baseOpenModal(id)  { document.getElementById(id).classList.add('open'); }
function _baseCloseModal(id) { document.getElementById(id).classList.remove('open'); }

// openModal / closeModal are overridden in app.js after all modules load
let openModal  = _baseOpenModal;
let closeModal = _baseCloseModal;
