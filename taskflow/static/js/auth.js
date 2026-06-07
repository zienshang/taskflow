// ── Login / Logout ──────────────────────────────────
async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.style.display = 'none';
  const btn = document.getElementById('loginBtn');
  btn.textContent = 'Đang đăng nhập...'; btn.disabled = true;
  try {
    const data = await api('POST', '/api/auth/login', {username, password});
    token = data.access_token;
    currentUser = data.user;
    localStorage.setItem('tf_token', token);
    localStorage.setItem('tf_user', JSON.stringify(currentUser));
    showApp();
  } catch(e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  } finally {
    btn.textContent = 'Đăng nhập'; btn.disabled = false;
  }
}

function doLogout() {
  stopHeartbeat();
  token = null; currentUser = null;
  localStorage.removeItem('tf_token');
  localStorage.removeItem('tf_user');
  showLogin();
}

// ── Change Password ─────────────────────────────────
function openChangePassword() {
  document.getElementById('cp-old').value = '';
  document.getElementById('cp-new').value = '';
  openModal('modalChangePw');
}

async function doChangePassword() {
  const old_password = document.getElementById('cp-old').value;
  const new_password = document.getElementById('cp-new').value;
  if (!old_password || !new_password) return toast('Vui lòng điền đầy đủ', 'error');
  try {
    await api('POST', '/api/auth/change-password', {old_password, new_password});
    currentUser.must_change_password = false;
    localStorage.setItem('tf_user', JSON.stringify(currentUser));
    document.getElementById('mustChangePwBanner').style.display = 'none';
    closeModal('modalChangePw');
    toast('Đổi mật khẩu thành công!', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

async function changePasswordSettings() {
  const oldPw = document.getElementById('s-old-pw').value;
  const newPw = document.getElementById('s-new-pw').value;
  if (!oldPw || !newPw) return toast('Vui lòng nhập mật khẩu cũ và mới', 'error');
  if (newPw.length < 6) return toast('Mật khẩu mới tối thiểu 6 ký tự', 'error');
  const btn = document.getElementById('s-change-pw-btn');
  btn.textContent = 'Đang xử lý...'; btn.disabled = true;
  try {
    await api('POST', '/api/auth/change-password', {old_password: oldPw, new_password: newPw});
    document.getElementById('s-old-pw').value = '';
    document.getElementById('s-new-pw').value = '';
    toast('Đổi mật khẩu thành công!', 'success');
  } catch(e) { toast(e.message, 'error'); }
  finally { btn.textContent = 'Đổi mật khẩu'; btn.disabled = false; }
}
