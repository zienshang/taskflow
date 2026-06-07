// ── Ticket state ──────────────────────────────────────
let _ticketsCache      = [];
let _ticketDetailId    = null;
let _myTicketFilter    = '';
let _ticketOpenCount   = 0;    // badge trên nav tab

// ── Label maps ────────────────────────────────────────
const TKT_STATUS = {
  open:        { label: 'Mở',              badge: 'b-blue'  },
  in_progress: { label: 'Đang xử lý',      badge: 'b-amber' },
  resolved:    { label: 'Đã giải quyết',   badge: 'b-green' },
  closed:      { label: 'Đã đóng',         badge: 'b-gray'  },
};
const TKT_PRIORITY = {
  low:    { label: 'Thấp',         badge: 'b-gray'   },
  normal: { label: 'Bình thường',  badge: 'b-blue'   },
  high:   { label: 'Cao',          badge: 'b-high'   },
  urgent: { label: 'Khẩn cấp',    badge: 'b-urgent' },
};
const TKT_CATEGORY = {
  technical:    'Hỗ trợ kỹ thuật',
  issue:        'Báo cáo vấn đề',
  info_request: 'Yêu cầu thông tin',
  feedback:     'Phản hồi / Góp ý',
};

function tktStatusBadge(s) {
  const m = TKT_STATUS[s] || {label: s, badge: 'b-gray'};
  return `<span class="badge ${m.badge}" style="font-size:10px">${m.label}</span>`;
}
function tktPriorityBadge(p) {
  const m = TKT_PRIORITY[p] || {label: p, badge: 'b-gray'};
  return `<span class="badge ${m.badge}" style="font-size:10px">${m.label}</span>`;
}

// ── API helper (giữ header X-Total-Count) ────────────
async function apiTickets(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Authorization': 'Bearer ' + token, ...(opts.headers || {}) },
    ...opts,
  });
  if (res.status === 401) { doLogout(); return null; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'Lỗi server');
  res._data = data;
  return res;
}

// ── LOAD TICKETS (admin/leader) ───────────────────────
async function loadTickets() {
  try {
    await _loadTicketStats();
    await _populateUserFilter();
    const status   = document.getElementById('tkt-filter-status')?.value   || '';
    const category = document.getElementById('tkt-filter-category')?.value || '';
    const priority = document.getElementById('tkt-filter-priority')?.value || '';
    const user     = document.getElementById('tkt-filter-user')?.value     || '';
    const overdue  = document.getElementById('tkt-filter-overdue')?.checked || false;
    const params   = new URLSearchParams({limit: 100});
    if (status)   params.set('status',   status);
    if (category) params.set('category', category);
    if (priority) params.set('priority', priority);
    if (user)     params.set('created_by', user);
    if (overdue)  params.set('overdue', 'true');

    const res = await apiTickets(`/api/tickets/?${params}`);
    if (!res) return;
    _ticketsCache = res._data;
    _renderTicketsTable(_ticketsCache);
  } catch(e) { toast(e.message, 'error'); }
}

async function _loadTicketStats() {
  try {
    const res = await apiTickets('/api/tickets/stats');
    if (!res) return;
    const s   = res._data;
    const bar = document.getElementById('ticketStatsBar');
    if (!bar) return;
    bar.innerHTML = [
      {key:'',     label:`Tất cả (${s.total})`,          active: true},
      {key:'open', label:`🔵 Mở (${s.open})`},
      {key:'in_progress', label:`🟡 Đang xử lý (${s.in_progress})`},
      {key:'resolved',    label:`🟢 Đã giải quyết (${s.resolved})`},
      {key:'closed',      label:`⚫ Đã đóng (${s.closed})`},
    ].map(c => `<button class="ticket-stat-chip ${c.active?'active':''}"
      onclick="document.getElementById('tkt-filter-status').value='${c.key}';loadTickets();
               document.querySelectorAll('.ticket-stat-chip').forEach(b=>b.classList.remove('active'));
               this.classList.add('active')">${c.label}</button>`).join('');
  } catch(e) {}
}

function _renderTicketsTable(items) {
  const el = document.getElementById('ticketsTableWrap');
  if (!el) return;
  if (!items.length) {
    el.innerHTML = '<div style="padding:30px;text-align:center;color:var(--c-muted);font-size:13px">Không có ticket nào.</div>';
    return;
  }
  el.innerHTML = `<table style="width:100%;table-layout:auto"><thead><tr>
    <th style="width:120px">Mã</th>
    <th>Tiêu đề</th>
    <th style="width:130px">Loại</th>
    <th style="width:90px">Ưu tiên</th>
    <th style="width:110px">Trạng thái</th>
    <th style="width:110px">Người tạo</th>
    <th style="width:80px;text-align:center">Phản hồi</th>
    <th style="width:90px">Hạn</th>
    <th style="width:110px">Cập nhật</th>
  </tr></thead><tbody>` +
  items.map(t => {
    const isOver   = t.due_date && new Date(t.due_date) < new Date() && !['resolved','closed'].includes(t.status);
    const dueHtml  = t.due_date
      ? `<span style="font-size:11px;${isOver?'color:var(--c-red);font-weight:600':''}">${isOver?'⚠️ ':''} ${new Date(t.due_date).toLocaleDateString('vi-VN')}</span>`
      : '<span style="color:var(--c-hint);font-size:11px">—</span>';
    return `<tr style="cursor:pointer${isOver?';background:#FFF5F5':''}" onclick="openTicketDetail('${t._id}')">
      <td><span style="font-family:monospace;font-size:11px;background:var(--c-gray-bg);padding:2px 7px;border-radius:4px">${esc(t.ticket_code)}</span></td>
      <td style="font-weight:500;font-size:13px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title)}</td>
      <td style="font-size:12px;color:var(--c-muted)">${esc(TKT_CATEGORY[t.category] || t.category)}</td>
      <td>${tktPriorityBadge(t.priority)}</td>
      <td>${tktStatusBadge(t.status)}</td>
      <td style="font-size:12px">${esc(t.created_by_name || t.created_by)}</td>
      <td style="text-align:center;font-size:12px;color:var(--c-muted)">${t.comment_count ?? 0}</td>
      <td>${dueHtml}</td>
      <td style="font-size:11px;color:var(--c-muted);white-space:nowrap">${fmtTime(t.updated_at || t.created_at)}</td>
    </tr>`;
  }).join('') + '</tbody></table>';
}

// ── LOAD MY TICKETS (HR) ──────────────────────────────
async function loadMyTickets() {
  try {
    const params = new URLSearchParams({ limit: 100 });
    if (_myTicketFilter) params.set('status', _myTicketFilter);
    const res = await apiTickets(`/api/tickets/?${params}`);
    if (!res) return;
    _ticketsCache = res._data;
    _renderMyTickets(_ticketsCache);
  } catch(e) { toast(e.message, 'error'); }
}

function filterMyTickets(status, btn) {
  _myTicketFilter = status;
  document.querySelectorAll('#myTicketTabs .ticket-stat-chip').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadMyTickets();
}

function _renderMyTickets(items) {
  const el = document.getElementById('myTicketsWrap');
  if (!el) return;
  if (!items.length) {
    el.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;color:var(--c-muted);padding:30px">
      Chưa có ticket nào. <button class="btn btn-primary" style="font-size:12px;margin-left:8px" onclick="openCreateTicket()">Tạo ticket đầu tiên</button>
    </div></div>`;
    return;
  }
  el.innerHTML = items.map(t => `
    <div class="ticket-card" onclick="openTicketDetail('${t._id}')">
      <div class="ticket-card-header">
        <span class="ticket-card-title">${t.title}</span>
        <div style="display:flex;gap:6px;flex-shrink:0">
          ${tktPriorityBadge(t.priority)}
          ${tktStatusBadge(t.status)}
        </div>
      </div>
      <div class="ticket-card-meta">
        <span style="font-family:monospace;font-size:11px;background:var(--c-gray-bg);padding:1px 6px;border-radius:4px">${t.ticket_code}</span>
        <span>${TKT_CATEGORY[t.category] || t.category}</span>
        <span>💬 ${t.comment_count ?? 0} phản hồi</span>
        <span style="margin-left:auto">${fmtTime(t.updated_at || t.created_at)}</span>
      </div>
    </div>`).join('');
}

// ── CREATE ────────────────────────────────────────────
function openCreateTicket() {
  document.getElementById('tkt-title').value    = '';
  document.getElementById('tkt-desc').value     = '';
  document.getElementById('tkt-file').value     = '';
  document.getElementById('tkt-category').value = 'issue';
  document.getElementById('tkt-priority').value = 'normal';
  const dueDateEl = document.getElementById('tkt-due-date');
  if (dueDateEl) dueDateEl.value = '';
  _baseOpenModal('modalCreateTicket');
}

async function submitCreateTicket() {
  const title    = document.getElementById('tkt-title').value.trim();
  const desc     = document.getElementById('tkt-desc').value.trim();
  const category = document.getElementById('tkt-category').value;
  const priority = document.getElementById('tkt-priority').value;
  const dueDate  = document.getElementById('tkt-due-date')?.value || '';
  const fileEl   = document.getElementById('tkt-file');

  if (!title) return toast('Vui lòng nhập tiêu đề ticket', 'error');

  const fd = new FormData();
  fd.append('title',       title);
  fd.append('description', desc);
  fd.append('category',    category);
  fd.append('priority',    priority);
  if (dueDate) fd.append('due_date', dueDate);
  if (fileEl.files[0]) fd.append('file', fileEl.files[0]);

  try {
    const data = await apiFormData('POST', '/api/tickets/', fd);
    _baseCloseModal('modalCreateTicket');
    toast(`✅ Đã tạo ticket ${data.ticket_code}!`, 'success');
    if (isAdminLike()) loadTickets(); else loadMyTickets();
  } catch(e) { toast(e.message, 'error'); }
}

// ── DETAIL ────────────────────────────────────────────
async function openTicketDetail(ticketId) {
  _ticketDetailId = ticketId;
  try {
    const res  = await apiTickets(`/api/tickets/${ticketId}`);
    if (!res) return;
    const t    = res._data;
    _renderTicketDetail(t);
    _baseOpenModal('modalTicketDetail');
    // Scroll comment thread xuống cuối
    setTimeout(() => {
      const el = document.getElementById('tktd-comments');
      if (el) el.scrollTop = el.scrollHeight;
    }, 80);
  } catch(e) { toast(e.message, 'error'); }
}

function _renderTicketDetail(t) {
  // Header
  document.getElementById('tktd-title').innerHTML =
    `<span style="font-family:monospace;font-size:12px;color:var(--c-muted);margin-right:8px">${t.ticket_code}</span>${t.title}`;
  document.getElementById('tktd-meta').innerHTML =
    `${tktStatusBadge(t.status)} &nbsp; ${tktPriorityBadge(t.priority)} &nbsp;` +
    `<span style="font-size:11px;color:var(--c-muted)">Tạo ${fmtTime(t.created_at)}</span>`;

  // Info grid
  const fileHtml = t.file_name
    ? `<a href="/api/tickets/${t._id}/file" target="_blank" style="color:var(--c-blue);text-decoration:underline;font-size:12px">📎 ${t.file_name}</a>`
    : '<span style="color:var(--c-hint);font-size:12px">Không có</span>';
  // due_date + overdue warning
  let dueDateHtml = '<span style="color:var(--c-hint);font-size:12px">Không có</span>';
  if (t.due_date) {
    const due      = new Date(t.due_date);
    const isOver   = due < new Date() && !['resolved','closed'].includes(t.status);
    const dueStr   = due.toLocaleDateString('vi-VN');
    dueDateHtml    = isOver
      ? `<span style="color:var(--c-red);font-weight:600;font-size:12px">⚠️ ${dueStr} (Quá hạn!)</span>`
      : `<span style="font-size:12px">${dueStr}</span>`;
  }

  document.getElementById('tktd-info').innerHTML = `
    <div><div style="font-size:10px;color:var(--c-muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Người tạo</div><div style="font-size:13px;font-weight:500">${t.created_by_name}</div></div>
    <div><div style="font-size:10px;color:var(--c-muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Người xử lý</div><div style="font-size:13px">${t.assigned_to_name || '<span style="color:var(--c-hint)">Chưa gán</span>'}</div></div>
    <div><div style="font-size:10px;color:var(--c-muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Loại</div><div style="font-size:13px">${TKT_CATEGORY[t.category] || t.category}</div></div>
    <div><div style="font-size:10px;color:var(--c-muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Hạn xử lý</div>${dueDateHtml}</div>
    <div><div style="font-size:10px;color:var(--c-muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">File đính kèm</div>${fileHtml}</div>
    <div></div>`;

  // Mô tả
  document.getElementById('tktd-desc').textContent = t.description || '(Không có mô tả)';

  // Actions panel (chỉ manager)
  const actionsEl = document.getElementById('tktd-actions');
  if (isAdminLike()) {
    actionsEl.style.display = 'block';
    document.getElementById('tktd-new-status').value   = t.status;
    document.getElementById('tktd-new-priority').value = t.priority;
    // Điền due_date nếu có
    const dueDateInput = document.getElementById('tktd-new-due-date');
    if (dueDateInput) dueDateInput.value = t.due_date ? t.due_date.slice(0,10) : '';
    // Nút xóa chỉ cho admin
    const deleteBtn = document.getElementById('tktd-delete-btn');
    if (deleteBtn) deleteBtn.style.display = currentUser.role === 'admin' ? 'inline-flex' : 'none';
  } else {
    actionsEl.style.display = 'none';
  }

  // Comment input (ẩn nếu ticket đã đóng)
  const inputEl = document.getElementById('tktd-comment-input');
  if (t.status === 'closed') {
    inputEl.style.display = 'none';
  } else {
    inputEl.style.display = 'flex';
    document.getElementById('tktd-new-comment').value = '';
  }

  // Render comments
  _renderComments(t.comments || []);
}

function _renderComments(comments) {
  const el    = document.getElementById('tktd-comments');
  const count = document.getElementById('tktd-cmt-count');
  if (count) count.textContent = comments.length;
  if (!el) return;

  if (!comments.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--c-muted);font-size:12px;padding:20px 0">Chưa có phản hồi nào — hãy là người đầu tiên!</div>';
    return;
  }

  el.innerHTML = comments.map(c => {
    const isManager = c.author_role === 'admin' || c.author_role === 'hr_leader';
    const isSystem  = c.is_system;
    const cls       = isSystem ? 'comment-system' : (isManager ? 'comment-manager' : 'comment-hr');
    const roleLabel = c.author_role === 'admin' ? 'Admin'
                    : c.author_role === 'hr_leader' ? 'HR Leader' : 'HR';
    return `<div class="comment-item ${cls}">
      <div class="comment-meta">
        <span style="font-weight:600">${c.author_name}</span>
        <span class="badge ${isManager?'b-blue':'b-gray'}" style="font-size:9px;padding:1px 5px">${roleLabel}</span>
        ${c.is_internal ? '<span class="badge b-amber" style="font-size:9px;padding:1px 5px">Nội bộ</span>' : ''}
        <span style="margin-left:auto">${fmtTime(c.created_at)}</span>
      </div>
      <div style="white-space:pre-wrap">${esc(c.content).replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')}</div>
    </div>`;
  }).join('');
}

// ── SUBMIT COMMENT ────────────────────────────────────
async function submitComment() {
  const content = document.getElementById('tktd-new-comment').value.trim();
  if (!content) return toast('Vui lòng nhập nội dung phản hồi', 'error');
  if (!_ticketDetailId) return;

  const fd = new FormData();
  fd.append('content', content);

  try {
    await apiFormData('POST', `/api/tickets/${_ticketDetailId}/comments`, fd);
    document.getElementById('tktd-new-comment').value = '';
    toast('Đã gửi phản hồi', 'success');
    // Reload chi tiết để hiện comment mới
    await openTicketDetail(_ticketDetailId);
  } catch(e) { toast(e.message, 'error'); }
}

// ── CHANGE STATUS (confirm nếu close) ────────────────
async function applyTicketStatus() {
  const status = document.getElementById('tktd-new-status').value;
  if (!_ticketDetailId) return;

  // Confirm dialog trước khi đóng ticket
  if (status === 'closed') {
    if (!confirm('Bạn có chắc muốn ĐÓNG ticket này?\nTicket đóng sẽ không thể thêm phản hồi.')) return;
  }

  const fd = new FormData();
  fd.append('status', status);
  try {
    await apiFormData('POST', `/api/tickets/${_ticketDetailId}/status`, fd);
    toast('Đã cập nhật trạng thái!', 'success');
    await openTicketDetail(_ticketDetailId);
    if (isAdminLike()) loadTickets(); else loadMyTickets();
    pollTicketBadge(); // cập nhật badge
  } catch(e) { toast(e.message, 'error'); }
}

// ── CHANGE PRIORITY ───────────────────────────────────
async function applyTicketPriority() {
  const priority = document.getElementById('tktd-new-priority').value;
  if (!_ticketDetailId) return;
  const fd = new FormData();
  fd.append('priority', priority);
  try {
    await apiFormData('PUT', `/api/tickets/${_ticketDetailId}`, fd);
    toast('Đã cập nhật ưu tiên!', 'success');
    await openTicketDetail(_ticketDetailId);
    if (isAdminLike()) loadTickets(); else loadMyTickets();
  } catch(e) { toast(e.message, 'error'); }
}

// ── DELETE TICKET (Admin only) ────────────────────────
async function deleteTicket() {
  if (!_ticketDetailId) return;
  if (!confirm('Xóa ticket này?\nToàn bộ phản hồi cũng sẽ bị xóa vĩnh viễn.')) return;
  try {
    await api('DELETE', `/api/tickets/${_ticketDetailId}`);
    _baseCloseModal('modalTicketDetail');
    toast('Đã xóa ticket', 'success');
    loadTickets();
    pollTicketBadge();
  } catch(e) { toast(e.message, 'error'); }
}

// ── POLL BADGE COUNT ──────────────────────────────────
async function pollTicketBadge() {
  if (!currentUser) return;
  try {
    const res = await apiTickets('/api/tickets/stats');
    if (!res) return;
    const s = res._data;
    // Badge: open + in_progress (chưa xử lý xong)
    _ticketOpenCount = isAdminLike()
      ? (s.open || 0) + (s.in_progress || 0)
      : 0;   // HR không cần badge tổng
    _renderTicketNavBadge();
  } catch(e) {}
}

function _renderTicketNavBadge() {
  // Cập nhật badge trên nav tab "🎫 Tickets"
  document.querySelectorAll('.nav-tab').forEach(btn => {
    if (btn.textContent.includes('Tickets')) {
      const existing = btn.querySelector('.tkt-nav-badge');
      if (_ticketOpenCount > 0) {
        if (existing) {
          existing.textContent = _ticketOpenCount;
        } else {
          const span = document.createElement('span');
          span.className = 'tkt-nav-badge notif-badge';
          span.style.cssText = 'position:relative;top:0;right:0;margin-left:4px;min-width:16px;height:16px;font-size:9px;padding:0 4px';
          span.textContent = _ticketOpenCount;
          btn.appendChild(span);
        }
      } else if (existing) {
        existing.remove();
      }
    }
  });
}

// ── FILTER BY USER (admin view) ───────────────────────
async function _populateUserFilter() {
  const sel = document.getElementById('tkt-filter-user');
  if (!sel || sel.options.length > 1) return; // đã có options
  try {
    const users = await api('GET', '/api/users/');
    const hrUsers = users.filter(u => u.role !== 'admin' || true); // tất cả
    sel.innerHTML = '<option value="">Tất cả người tạo</option>' +
      hrUsers.map(u => `<option value="${u.username}">${u.full_name}</option>`).join('');
  } catch(e) {}
}

// ── UPDATE DUE DATE ───────────────────────────────────
async function applyTicketDueDate() {
  const dueDate = document.getElementById('tktd-new-due-date').value; // "" = xóa
  if (!_ticketDetailId) return;
  const fd = new FormData();
  fd.append('due_date', dueDate);
  try {
    await apiFormData('PUT', `/api/tickets/${_ticketDetailId}`, fd);
    toast('Đã cập nhật hạn xử lý!', 'success');
    await openTicketDetail(_ticketDetailId);
    if (isAdminLike()) loadTickets(); else loadMyTickets();
  } catch(e) { toast(e.message, 'error'); }
}
