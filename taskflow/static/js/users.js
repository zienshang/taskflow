// ── Users (Admin) ────────────────────────────────────
async function loadUsers() {
  try {
    if (currentUser.role === 'admin') await pollOnlineStatus();
    const users = await api('GET', '/api/users/');
    const el = document.getElementById('userTbody');
    el.innerHTML = users.map(u => `<tr>
      <td>
        <div style="display:inline-flex;align-items:flex-start;gap:6px">
          <span style="width:8px;height:8px;border-radius:50%;background:${_onlineUsers.has(u.username)?'var(--c-green)':'var(--c-hint)'};display:inline-block;margin-top:4px;flex-shrink:0"></span>
          <div>
            <span style="font-family:monospace;font-size:12px;background:var(--c-gray-bg);padding:2px 6px;border-radius:4px">${u.username}</span>
            <div style="font-size:10px;margin-top:3px;${_onlineUsers.has(u.username)?'color:var(--c-green);font-weight:500':'color:var(--c-muted)'}">
              ${_onlineUsers.has(u.username) ? '● Đang online' : fmtLastSeen(u.last_seen)}
            </div>
          </div>
        </div>
      </td>
      <td style="font-weight:500">${u.full_name}</td>
      <td>${
        u.role === 'admin'     ? '<span class="badge b-blue">Admin</span>'
        : u.role === 'hr_leader' ? '<span class="badge b-amber">HR Leader</span>'
        :                          '<span class="badge b-green">HR</span>'
      }</td>
      <td style="font-size:12px;color:var(--c-muted)">${u.department||'-'}</td>
      <td><span class="badge b-amber">${u.cv_count||0} CV</span></td>
      <td style="font-size:12px">${u.active_tasks||0} task</td>
      <td>${u.is_active?'<span class="badge b-green">Đã kích hoạt</span>':'<span class="badge b-red">Đã vô hiệu</span>'}</td>
      <td><div style="display:flex;gap:6px;flex-wrap:wrap">
        ${!(currentUser.role === 'hr_leader' && u.role === 'admin')
          ? `<button class="btn" style="font-size:11px;padding:3px 8px" onclick="openResetPw('${u.username}')">Reset MK</button>`
          : ''}
        ${u.username !== currentUser.username && !(currentUser.role === 'hr_leader' && u.role === 'admin')
          ? `<button class="btn ${u.is_active?'btn-danger':'btn-success'}" style="font-size:11px;padding:3px 8px" onclick="toggleUser('${u.username}','${u.is_active}')">${u.is_active?'Tắt':'Bật'}</button>`
          : ''}
      </div></td>
    </tr>`).join('');
  } catch(e) { toast(e.message, 'error'); }
}

async function createUser() {
  const username   = document.getElementById('u-username').value.trim();
  const full_name  = document.getElementById('u-fullname').value.trim();
  const password   = document.getElementById('u-password').value;
  const role       = document.getElementById('u-role').value;
  const department = document.getElementById('u-dept').value.trim();
  const email      = document.getElementById('u-email').value.trim();
  if (!username || !full_name || !password) return toast('Vui lòng điền đủ thông tin bắt buộc', 'error');
  try {
    await api('POST', '/api/users/', {username, full_name, password, role, department, email});
    closeModal('modalUser');
    ['u-username','u-fullname','u-password'].forEach(id => document.getElementById(id).value = '');
    toast('Tạo tài khoản thành công!', 'success');
    loadUsers();
  } catch(e) { toast(e.message, 'error'); }
}

function openResetPw(username) {
  resetPwUsername = username;
  document.getElementById('resetPwTarget').textContent = username;
  document.getElementById('resetPwVal').value = '';
  openModal('modalResetPw');
}

async function confirmResetPw() {
  const new_password = document.getElementById('resetPwVal').value;
  if (!new_password || new_password.length < 6) return toast('Mật khẩu tối thiểu 6 ký tự', 'error');
  try {
    await api('POST', `/api/users/${resetPwUsername}/reset-password`, {new_password});
    closeModal('modalResetPw');
    toast(`Đã reset mật khẩu cho ${resetPwUsername}`, 'success');
    loadUsers();
  } catch(e) { toast(e.message, 'error'); }
}

// ── Role → dept auto-fill ─────────────────────────────
function onRoleChange(sel) {
  const dept = document.getElementById('u-dept');
  if (!dept) return;
  if (sel.value === 'hr_leader') dept.value = 'Management';
  else if (sel.value === 'hr')   dept.value = 'HR';
  else                           dept.value = 'Management';
}

async function toggleUser(username, isActive) {
  try {
    const res = await api('POST', `/api/users/${username}/toggle-active`);
    toast(res.message, 'success');
    loadUsers();
  } catch(e) { toast(e.message, 'error'); }
}
