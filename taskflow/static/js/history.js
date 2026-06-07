// ── Logs pagination state ─────────────────────────────
const LOGS_PAGE_SIZE = 50;
let _logsSkip  = 0;
let _logsTotal = 0;

// ── Log helpers ───────────────────────────────────────
function logTaskBadge(a) {
  if (!a.task_id || !a.task_code) return '';
  return `<span class="badge b-blue" style="font-size:10px;cursor:pointer;margin-right:5px;vertical-align:middle"
    onclick="event.stopPropagation();viewTaskDetail('${a.task_id}')" title="Mở task ${a.task_code}">${a.task_code}</span>`;
}

const _logIcon = {
  task_created:     '📋', task_updated:   '✏️',  task_deleted:  '🗑️',  task_accepted:     '📥',
  candidate_status: '🔄', cv_submitted:   '📄',
  user_created:     '👤', password_reset: '🔑',  password_changed: '🔑', user_toggle:      '⚡',
  profile_updated:  '✏️',
  payment_requested:'💰', payment_sent:   '💸',  payment_rejected: '❌', payment_confirmed: '✅',
};

async function loadLogs(reset = true) {
  try {
    if (reset) _logsSkip = 0;

    // Dùng fetch trực tiếp để đọc X-Total-Count header
    const res = await fetch(
      `/api/activities/?limit=${LOGS_PAGE_SIZE}&skip=${_logsSkip}`,
      { headers: { 'Authorization': 'Bearer ' + token } }
    );
    if (res.status === 401) { doLogout(); return; }
    if (!res.ok) { toast('Lỗi tải logs', 'error'); return; }

    _logsTotal = parseInt(res.headers.get('X-Total-Count') || '0', 10);
    const acts = await res.json();

    const countEl = document.getElementById('logs-count');
    if (countEl) {
      const showing = Math.min(_logsSkip + acts.length, _logsTotal);
      countEl.textContent = `Hiển thị ${_logsSkip + 1}–${showing} / ${_logsTotal} bản ghi`;
    }

    const tb = document.getElementById('logsTbody');
    if (!acts.length && _logsSkip === 0) {
      tb.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--c-muted);padding:24px">Chưa có log nào</td></tr>';
    } else {
      if (reset) tb.innerHTML = '';
      tb.innerHTML += acts.map(a => `<tr>
        <td style="font-size:11px;color:var(--c-muted);white-space:nowrap">${fmtTime(a.created_at)}</td>
        <td style="font-size:13px">${_logIcon[a.type] || '•'} ${logTaskBadge(a)}${esc(a.text)}</td>
        <td style="font-size:12px;font-family:monospace;background:var(--c-gray-bg);padding:2px 6px;border-radius:4px;white-space:nowrap">${esc(a.actor)}</td>
      </tr>`).join('');
    }

    // Pagination controls
    _renderLogsPagination();
  } catch(e) { toast(e.message, 'error'); }
}

function _renderLogsPagination() {
  // Xóa controls cũ nếu có
  const old = document.getElementById('logs-pagination');
  if (old) old.remove();

  const hasMore = (_logsSkip + LOGS_PAGE_SIZE) < _logsTotal;
  const hasPrev = _logsSkip > 0;
  if (!hasMore && !hasPrev) return;

  const wrap = document.createElement('div');
  wrap.id = 'logs-pagination';
  wrap.style.cssText = 'display:flex;justify-content:center;gap:8px;padding:12px 0';

  if (hasPrev) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = '← Trang trước';
    btn.style.fontSize = '12px';
    btn.onclick = () => { _logsSkip = Math.max(0, _logsSkip - LOGS_PAGE_SIZE); loadLogs(true); };
    wrap.appendChild(btn);
  }
  if (hasMore) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = 'Trang tiếp →';
    btn.style.fontSize = '12px';
    btn.onclick = () => { _logsSkip += LOGS_PAGE_SIZE; loadLogs(false); };
    wrap.appendChild(btn);
  }

  // Thêm vào sau bảng logs
  const logsCard = document.querySelector('#v-logs .card');
  if (logsCard) logsCard.after(wrap);
}

// ── History tab ──────────────────────────────────────
async function loadHistory() {
  try {
    const payments = await api('GET', '/api/payments/');
    const confirmed = payments.filter(p => p.status === 'confirmed');
    const isAdmin = currentUser.role === 'admin';

    document.getElementById('historyThead').innerHTML = `<tr>
      <th>Task</th>
      ${isAdmin ? '<th>HR</th>' : ''}
      <th>Số tiền</th><th>Tài khoản ngân hàng</th>
      <th>Nội dung CK</th>
      <th style="width:80px;text-align:center">Ảnh CK Admin</th>
      <th style="width:80px;text-align:center">Ảnh XN HR</th>
      <th>Ngày chuyển</th><th>Xác nhận</th>
    </tr>`;

    const tb = document.getElementById('historyTbody');
    if (!confirmed.length) {
      tb.innerHTML = `<tr><td colspan="${isAdmin?9:8}" style="text-align:center;color:var(--c-muted);padding:30px">Chưa có lịch sử thanh toán</td></tr>`;
      return;
    }
    tb.innerHTML = confirmed.map(p => `<tr>
      <td>
        <div style="font-weight:500">${p.task_code
          ? `<span style="font-family:monospace;font-size:11px;background:var(--c-gray-bg);padding:1px 6px;border-radius:4px;color:var(--c-muted);margin-right:4px">${p.task_code}</span>`
          : ''}${p.task_title}</div>
        ${p.cv_count_snapshot ? `<div style="font-size:11px;color:var(--c-muted);margin-top:2px">${p.cv_count_snapshot} CV (${p.cv_good_count_snapshot} tốt)</div>` : ''}
      </td>
      ${isAdmin ? `<td style="font-size:12px">${p.hr_full_name}</td>` : ''}
      <td style="font-weight:600;color:var(--c-green)">${p.amount || '—'}</td>
      <td style="font-size:12px">
        ${p.bank_name ? `<div style="font-weight:500">${p.bank_name}</div>` : ''}
        <div style="font-family:monospace;color:var(--c-muted)">${p.bank_account || '—'}</div>
      </td>
      <td style="font-size:12px;max-width:140px;overflow:hidden;text-overflow:ellipsis">${p.transfer_content || '—'}</td>
      <td style="text-align:center;padding:4px">
        ${p.transfer_image_url
          ? `<div id="timg-${p._id}" style="width:56px;height:56px;border-radius:6px;border:1px solid var(--c-border);display:inline-flex;align-items:center;justify-content:center;overflow:hidden;background:var(--c-bg)"><span style="font-size:9px;color:var(--c-muted)">...</span></div>`
          : '<span style="color:var(--c-hint);font-size:11px">—</span>'}
      </td>
      <td style="text-align:center;padding:4px">
        ${p.confirmation_image_url
          ? `<div id="cimg-${p._id}" style="width:56px;height:56px;border-radius:6px;border:1px solid var(--c-border);display:inline-flex;align-items:center;justify-content:center;overflow:hidden;background:var(--c-bg)"><span style="font-size:9px;color:var(--c-muted)">...</span></div>`
          : '<span style="color:var(--c-hint);font-size:11px">—</span>'}
      </td>
      <td style="font-size:11px;color:var(--c-muted)">${fmtTime(p.paid_at)}</td>
      <td style="font-size:11px;color:var(--c-green)">${fmtTime(p.confirmed_at)}</td>
    </tr>`).join('');

    // Load ảnh CK và xác nhận qua endpoint có JWT auth (không dùng <img src> trực tiếp)
    confirmed.forEach(p => {
      if (p.transfer_image_url) {
        const el = document.getElementById(`timg-${p._id}`);
        if (el) loadSecureImg(p.transfer_image_url, el, { linkable: true, imgStyle: 'object-fit:cover' });
      }
      if (p.confirmation_image_url) {
        const el = document.getElementById(`cimg-${p._id}`);
        if (el) loadSecureImg(p.confirmation_image_url, el, { linkable: true, imgStyle: 'object-fit:cover' });
      }
    });
  } catch(e) { toast(e.message, 'error'); }
}

// ── HR Payment Info popup ────────────────────────────
function showHRPayment(e, username) {
  e.stopPropagation();
  const hr = (_cachedStats?.hr_list || []).find(h => h.username === username);
  if (!hr) return toast('Không tìm thấy thông tin HR', 'error');

  document.getElementById('hrpay-name').textContent = hr.full_name;
  document.getElementById('hrpay-username').textContent = '@' + hr.username;

  const hasBankInfo = hr.bank_name || hr.bank_account || hr.bank_holder || hr.bank_qr;
  if (!hasBankInfo) {
    document.getElementById('hrpay-body').innerHTML =
      '<div style="text-align:center;color:var(--c-muted);padding:24px;font-size:13px">⚠️ HR chưa cập nhật thông tin chuyển tiền</div>';
  } else {
    document.getElementById('hrpay-body').innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px">
        ${hr.bank_name ? `<div>
          <div style="font-size:11px;color:var(--c-muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Ngân hàng</div>
          <div style="font-size:15px;font-weight:600">${hr.bank_name}</div>
        </div>` : ''}
        ${hr.bank_account ? `<div>
          <div style="font-size:11px;color:var(--c-muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Số tài khoản</div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:17px;font-weight:700;font-family:monospace;letter-spacing:1.5px">${hr.bank_account}</span>
            <button class="btn" style="font-size:11px;padding:3px 9px"
              onclick="navigator.clipboard.writeText('${hr.bank_account}').then(()=>toast('Đã sao chép!','success'))">Sao chép</button>
          </div>
        </div>` : ''}
        ${hr.bank_holder ? `<div>
          <div style="font-size:11px;color:var(--c-muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Chủ tài khoản</div>
          <div style="font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:.5px">${hr.bank_holder}</div>
        </div>` : ''}
        ${hr.bank_qr ? `<div style="text-align:center;padding-top:4px">
          <div style="font-size:11px;color:var(--c-muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">Mã QR chuyển tiền</div>
          <img src="${hr.bank_qr}" style="max-width:200px;width:100%;border-radius:10px;border:1px solid var(--c-border);box-shadow:var(--shadow)">
        </div>` : ''}
      </div>`;
  }
  _baseOpenModal('modalHRPayment');
}
