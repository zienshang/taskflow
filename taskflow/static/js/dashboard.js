// ── Dashboard ─────────────────────────────────────────
async function loadDashboard() {
  try {
    const [stats, acts, payments, tktStats] = await Promise.all([
      api('GET', '/api/tasks/stats/overview'),
      api('GET', '/api/activities/?limit=6'),
      api('GET', '/api/payments/').catch(() => []),
      fetch('/api/tickets/stats', {headers:{'Authorization':'Bearer '+token}})
        .then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    _cachedStats   = stats;
    _paymentsCache = payments;
    renderStats(stats);
    renderTicketMiniPanel(tktStats);
    renderAdminTasks(stats);
    renderSidebarHR(stats.hr_list || []);
    renderActivities(acts);

    // Kiểm tra task thử việc đã hết hạn
    const TRIAL_MS = 60 * 24 * 60 * 60 * 1000;
    const allTasks = (stats.hr_list || []).flatMap(hr => (hr.tasks || []).map(t => ({...t, hr_full_name: hr.full_name})));
    const expiredTrial = allTasks.find(t =>
      t.candidate_status === 'trial' && t.trial_started_at &&
      Date.now() > parseUTC(t.trial_started_at).getTime() + TRIAL_MS
    );
    if (expiredTrial) {
      _trialExpiredTaskId = expiredTrial._id;
      const pc = expiredTrial.task_code ? `[${expiredTrial.task_code}] ` : '';
      document.getElementById('trial-task-name').textContent = `${pc}${expiredTrial.title}`;
      document.getElementById('trial-task-hr').textContent   = `HR: ${expiredTrial.hr_full_name || expiredTrial.assigned_to}`;
      _baseOpenModal('modalTrialExpired');
    }
  } catch(e) { toast(e.message, 'error'); }
}

// ── All Tasks (Admin tab) ─────────────────────────────
let _allTasksCache   = [];
let _allPaymentsCache = [];

async function loadAllTasks() {
  try {
    const [stats, payments] = await Promise.all([
      api('GET', '/api/tasks/stats/overview'),
      api('GET', '/api/payments/').catch(() => []),
    ]);
    _allTasksCache    = (stats.hr_list || []).flatMap(hr => (hr.tasks || []).map(t => ({...t, hr_full_name: hr.full_name})));
    _allPaymentsCache = payments;
    renderAllTasksTable();
  } catch(e) { toast(e.message, 'error'); }
}

function renderAllTasksTable() {
  const filter   = document.getElementById('alltasks-filter')?.value || '';
  const payByTask = {};
  (_allPaymentsCache || []).forEach(p => { payByTask[p.task_id] = p; });
  let tasks = _allTasksCache;
  if (filter) tasks = tasks.filter(t => t.status === filter);

  const el = document.getElementById('allTasksList');
  if (!tasks.length) {
    el.innerHTML = '<div style="padding:30px;text-align:center;color:var(--c-muted);font-size:13px">Không có task nào.</div>';
    return;
  }
  const psLabel = { none:'—', requested:'⏳ Chờ duyệt', rejected:'❌ Từ chối', paid:'💸 Đã CK', confirmed:'✅ Hoàn tất' };
  const psBadge = { none:'',  requested:'b-amber',       rejected:'b-red',      paid:'b-blue',  confirmed:'b-green' };

  el.innerHTML = `<table style="width:100%;table-layout:auto"><thead><tr>
    <th>Task</th><th>HR</th><th>Hoa hồng</th><th>TTUV</th><th>Trạng thái</th><th>Thanh toán</th><th>Ngày tạo</th>
  </tr></thead><tbody>` +
  tasks.map(t => {
    const ps = t.payment_status || 'none';
    const codeHtml = t.task_code
      ? `<span style="font-family:monospace;font-size:11px;background:var(--c-gray-bg);padding:1px 6px;border-radius:4px;color:var(--c-muted);margin-right:6px">${esc(t.task_code)}</span>`
      : '';
    const statusBadgeHtml = t.status === 'completed'
      ? `<span class="badge b-green" style="font-size:10px">✅ Hoàn tất</span>`
      : `<span class="badge b-amber" style="font-size:10px">🔄 Đang thực hiện</span>`;
    return `<tr style="cursor:pointer" onclick="viewTaskDetail('${t._id}')">
      <td><div style="font-weight:500;font-size:13px">${codeHtml}${esc(t.title)}</div></td>
      <td style="font-size:12px">${esc(t.hr_full_name || t.assigned_to)}</td>
      <td style="font-size:12px;font-weight:600;color:var(--c-green)">${t.commission || '—'}</td>
      <td><span class="badge ${statusBadge[t.candidate_status||'pending']}">${statusMap[t.candidate_status||'pending']}</span></td>
      <td>${statusBadgeHtml}</td>
      <td><span class="badge ${psBadge[ps]||''}" style="font-size:10px">${psLabel[ps]||ps}</span></td>
      <td style="font-size:11px;color:var(--c-muted);white-space:nowrap">${fmtTime(t.created_at)}</td>
    </tr>`;
  }).join('') + '</tbody></table>';
}

// ── Ticket mini-panel ─────────────────────────────────
function renderTicketMiniPanel(s) {
  const el = document.getElementById('dashboardTicketPanel');
  if (!el || !s) return;
  const urgent = s.open + s.in_progress;
  el.innerHTML = `
    <div style="background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--radius-lg);padding:14px 18px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <div style="font-size:13px;font-weight:600;color:var(--c-text);flex:1">🎫 Ticket hỗ trợ</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div style="text-align:center">
          <div style="font-size:20px;font-weight:700;color:var(--c-blue)">${s.open}</div>
          <div style="font-size:11px;color:var(--c-muted)">Mở</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:20px;font-weight:700;color:var(--c-amber)">${s.in_progress}</div>
          <div style="font-size:11px;color:var(--c-muted)">Đang xử lý</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:20px;font-weight:700;color:var(--c-green)">${s.resolved}</div>
          <div style="font-size:11px;color:var(--c-muted)">Đã giải quyết</div>
        </div>
        ${s.unassigned > 0 ? `<div style="text-align:center">
          <div style="font-size:20px;font-weight:700;color:var(--c-red)">${s.unassigned}</div>
          <div style="font-size:11px;color:var(--c-muted)">Chưa gán</div>
        </div>` : ''}
      </div>
      <button class="btn btn-primary" style="font-size:12px;padding:5px 14px;flex-shrink:0" onclick="showView('tickets')">Xem tất cả →</button>
    </div>`;
}

// ── Stats cards ───────────────────────────────────────
function renderStats(s) {
  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card"><div class="stat-label">Tổng task</div><div class="stat-val blue">${s.total_tasks}</div></div>
    <div class="stat-card"><div class="stat-label">Đang thực hiện</div><div class="stat-val amber">${s.active_tasks}</div></div>
    <div class="stat-card"><div class="stat-label">Tổng CV nhận được</div><div class="stat-val green">${s.total_cvs}</div></div>
    <div class="stat-card"><div class="stat-label">HR online</div><div class="stat-val green">${_onlineUsers.size} <span style="font-size:11px;color:var(--c-muted)">/ ${s.total_hr}</span></div></div>`;
}

// ── Activities ────────────────────────────────────────
function renderActivities(acts) {
  const el = document.getElementById('actList');
  if (!acts || !acts.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--c-muted);font-size:13px;padding:10px">Chưa có hoạt động</div>';
    return;
  }
  el.innerHTML = acts.map(a => `
    <div class="act-item"><div class="act-dot"></div>
      <div><div class="act-text">${logTaskBadge(a)}${esc(a.text)}</div><div class="act-time">${fmtTime(a.created_at)}</div></div>
    </div>`).join('') +
    `<div style="text-align:center;padding:10px 0">
      <button class="btn" style="font-size:12px;padding:4px 14px" onclick="showView('logs')">Xem tất cả →</button>
     </div>`;
}

// ── Admin task table ──────────────────────────────────
function adminPayCell(ps, payment, t) {
  if (ps === 'none')      return '<span style="font-size:11px;color:var(--c-hint)">—</span>';
  if (ps === 'requested') return `<div style="display:flex;flex-direction:column;gap:4px">
    <span class="badge b-amber" style="font-size:10px">⏳ Chờ duyệt</span>
    <div style="display:flex;gap:4px">
      <button class="btn btn-primary" style="font-size:10px;padding:2px 7px"
        onclick="openApprovePayment('${payment?._id}','${t.assigned_to}')">✅ Duyệt</button>
      <button class="btn btn-danger" style="font-size:10px;padding:2px 7px"
        onclick="openRejectPayment('${payment?._id}')">❌</button>
    </div></div>`;
  if (ps === 'rejected')  return `<span class="badge b-red" style="font-size:10px">❌ Đã từ chối</span>`;
  if (ps === 'paid')      return `<span class="badge b-blue" style="font-size:10px">💸 Đã CK — chờ HR</span>`;
  if (ps === 'confirmed') return `<span class="badge b-green" style="font-size:10px">✅ Hoàn tất</span>`;
  return '—';
}

function renderAdminTasks(stats) {
  const _csOrder = {completed:0, trial:1, contacted:2, pending:3};
  const tasks = (stats.hr_list || [])
    .flatMap(hr => hr.tasks || [])
    .filter(t => t.status !== 'completed' && t.payment_status !== 'confirmed')
    .sort((a, b) => {
      const ao = _csOrder[a.candidate_status || 'pending'] ?? 3;
      const bo = _csOrder[b.candidate_status || 'pending'] ?? 3;
      return ao - bo;
    });

  const el = document.getElementById('adminTaskList');
  if (!tasks.length) {
    el.innerHTML = '<div style="padding:30px;text-align:center;color:var(--c-muted);font-size:13px">Chưa có task nào. Nhấn "+ Giao task" để bắt đầu.</div>';
    return;
  }
  const payByTask = {};
  (_paymentsCache || []).forEach(p => { payByTask[p.task_id] = p; });

  el.innerHTML = `<table style="width:100%;table-layout:auto"><thead><tr>
    <th style="min-width:220px">Task</th>
    <th style="min-width:110px;white-space:nowrap">HR phụ trách</th>
    <th style="width:80px;white-space:nowrap">Nhận</th>
    <th style="width:60px">CV</th>
    <th style="width:130px;white-space:nowrap">Hoa hồng</th>
    <th style="width:110px;white-space:nowrap">TTUV</th>
    <th style="min-width:160px;white-space:nowrap">Thanh toán</th>
  </tr></thead><tbody>` +
    tasks.map(t => {
      const cs      = t.candidate_status || 'pending';
      const ps      = t.payment_status   || 'none';
      const payment = payByTask[t._id];
      const codeHtml  = t.task_code
        ? `<span style="font-family:monospace;font-size:11px;background:var(--c-gray-bg);padding:1px 6px;border-radius:4px;color:var(--c-muted);margin-right:6px">${t.task_code}</span>`
        : '';
      const fileHtml  = t.file_name
        ? `<div style="font-size:11px;margin-top:2px"><a href="/api/tasks/${t._id}/file" target="_blank" style="color:var(--c-blue);text-decoration:underline">📎 ${t.file_name}</a></div>`
        : '';
      const acceptBadge = t.accepted
        ? `<span class="badge b-green" style="font-size:10px">✅ Đã nhận</span>`
        : `<span class="badge" style="background:var(--c-gray-bg);color:var(--c-muted);font-size:10px">⏳ Chờ</span>`;

      return `<tr style="cursor:pointer" onclick="viewTaskDetail('${t._id}')">
        <td><div style="font-weight:500;font-size:13px">${codeHtml}${esc(t.title)}</div>${fileHtml}</td>
        <td style="font-size:12px">
          <span style="cursor:pointer;color:var(--c-blue);border-bottom:1px dotted currentColor"
            onclick="showHRPayment(event,'${esc(t.assigned_to)}')">${esc(t.assigned_to_name||t.assigned_to)}</span>
        </td>
        <td style="font-size:12px">${acceptBadge}</td>
        <td style="font-size:12px"><span class="badge b-amber">${t.cv_count||0} CV</span></td>
        <td style="font-size:12px;font-weight:600;color:var(--c-green)">${t.commission||'—'}</td>
        <td><span class="badge ${statusBadge[cs]}">${statusMap[cs]}</span></td>
        <td onclick="event.stopPropagation()">${adminPayCell(ps, payment, t)}</td>
      </tr>`;
    }).join('') + '</tbody></table>';
}

// ── HR sidebar ────────────────────────────────────────
function renderSidebarHR(hrList) {
  const el  = document.getElementById('hrSidebarList');
  const hrs = hrList.filter(hr => hr.role === 'hr' || hr.role === 'hr_leader');
  if (!hrs.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--c-muted);font-size:12px;padding:20px 0">Chưa có HR</div>';
    return;
  }
  el.innerHTML = hrs.map(hr => {
    const tasks    = (hr.tasks || []).filter(t => t.status !== 'completed' && t.payment_status !== 'confirmed');
    const isOnline = _onlineUsers.has(hr.username);
    const dotColor = isOnline ? '#10b981' : 'var(--c-border-md)';
    const taskRows = tasks.map(t => {
      const code  = t.task_code
        ? `<span style="font-family:monospace;font-size:9px;background:var(--c-gray-bg);padding:0 4px;border-radius:3px;color:var(--c-muted);margin-right:3px;flex-shrink:0">${t.task_code}</span>`
        : '';
      const title = t.title.length > 16 ? t.title.slice(0,16) + '…' : t.title;
      return `<div style="display:flex;align-items:center;gap:4px;margin-bottom:3px">
        ${code}
        <span style="font-size:11px;color:var(--c-muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title)}</span>
        <span class="badge b-amber" style="font-size:9px;padding:1px 5px;flex-shrink:0">${t.cv_count||0}</span>
      </div>`;
    }).join('');

    return `<div style="padding:10px 0;border-bottom:1px solid var(--c-border)">
      <div style="display:flex;align-items:center;gap:6px;min-width:0">
        <div style="position:relative;flex-shrink:0">
          <div class="avatar ${hr.role === 'hr_leader' ? 'av-admin' : 'av-hr'}" style="width:26px;height:26px;font-size:10px">${hr.full_name.slice(0,2).toUpperCase()}</div>
          <span style="position:absolute;bottom:-1px;right:-1px;width:9px;height:9px;border-radius:50%;border:2px solid var(--c-surface);background:${dotColor}"></span>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(hr.full_name)}">${esc(hr.full_name)}</div>
          <div style="font-size:10px;margin-top:1px;${isOnline?'color:#10b981;font-weight:500':'color:var(--c-muted)'}">
            ${isOnline ? '● Online' : fmtLastSeen(hr.last_seen)}
          </div>
        </div>
        <span class="badge b-blue" style="font-size:9px;padding:1px 5px;flex-shrink:0">${hr.cv_count||0} CV</span>
        <button class="btn btn-primary" style="font-size:11px;padding:1px 6px;flex-shrink:0;line-height:1.4"
          onclick="openModal_task('${hr.username}')" title="Giao task">+</button>
      </div>
      <div style="margin-top:${tasks.length?'6px':'0'};padding-left:32px">
        ${tasks.length ? taskRows : '<span style="font-size:11px;color:var(--c-hint)">Chưa có task</span>'}
      </div>
    </div>`;
  }).join('');
}
