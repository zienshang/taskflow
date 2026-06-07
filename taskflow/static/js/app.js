// ── App-level state ───────────────────────────────────
let _cachedStats         = null;
let _paymentsCache       = [];
let _onlineUsers         = new Set();
let _heartbeatInterval   = null;
let _onlinePollInterval  = null;
let _notifInterval       = null;
let _ticketBadgeInterval = null;
let _notificationsCache  = [];
let _visibilityListenerAdded = false;

// ── Heartbeat ─────────────────────────────────────────
async function startHeartbeat() {
  await api('POST', '/api/users/heartbeat').catch(() => {});
  _heartbeatInterval = setInterval(async () => {
    await api('POST', '/api/users/heartbeat').catch(() => {});
  }, 60000);
}

function stopHeartbeat() {
  if (_heartbeatInterval)   { clearInterval(_heartbeatInterval);   _heartbeatInterval   = null; }
  if (_onlinePollInterval)  { clearInterval(_onlinePollInterval);  _onlinePollInterval  = null; }
  if (_notifInterval)       { clearInterval(_notifInterval);       _notifInterval       = null; }
  if (_ticketBadgeInterval) { clearInterval(_ticketBadgeInterval); _ticketBadgeInterval = null; }
}

function resumePolling() {
  if (!currentUser) return;
  stopHeartbeat();
  startHeartbeat();
  loadNotifications();
  _notifInterval = setInterval(loadNotifications, 30000);
  if (isAdminLike()) {
    pollOnlineStatus();
    _onlinePollInterval = setInterval(pollOnlineStatus, 30000);
    pollTicketBadge();
    _ticketBadgeInterval = setInterval(pollTicketBadge, 30000);
  }
}

async function pollOnlineStatus() {
  if (!currentUser || !isAdminLike()) return;
  try {
    const data = await api('GET', '/api/users/online');
    _onlineUsers = new Set(data.online_usernames);
    const av = getActiveView();
    if (av === 'dashboard' && _cachedStats) renderSidebarHR(_cachedStats.hr_list || []);
    if (av === 'users') loadUsers();
  } catch(e) {}
}

// ── Notifications ─────────────────────────────────────
async function loadNotifications() {
  try {
    _notificationsCache = await api('GET', '/api/notifications/');
    renderNotifications();
  } catch(e) {}
}

function renderNotifications() {
  const unread = _notificationsCache.filter(n => !n.read);
  const badge  = document.getElementById('notifBadge');
  if (badge) { badge.textContent = unread.length; badge.style.display = unread.length > 0 ? 'flex' : 'none'; }
  const list = document.getElementById('notifList');
  if (!list) return;
  if (!_notificationsCache.length) { list.innerHTML = '<div class="notif-empty">Không có thông báo</div>'; return; }
  list.innerHTML = _notificationsCache.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}" onclick="handleNotifClick('${n.task_id||''}','${n.ticket_id||''}')">
      <div class="notif-dot"></div>
      <div>
        <div style="font-size:13px;line-height:1.4">${esc(n.text)}</div>
        <div style="font-size:11px;color:var(--c-muted);margin-top:2px">${fmtTime(n.created_at)}</div>
      </div>
    </div>`).join('');
}

function toggleNotifDropdown() {
  const dd = document.getElementById('notifDropdown');
  const wasOpen = dd.classList.contains('open');
  dd.classList.toggle('open');
  if (!wasOpen) markAllRead();
}

async function markAllRead() {
  try {
    await api('POST', '/api/notifications/read-all');
    _notificationsCache.forEach(n => n.read = true);
    renderNotifications();
  } catch(e) {}
}

function handleNotifClick(taskId, ticketId) {
  document.getElementById('notifDropdown').classList.remove('open');
  if (ticketId) {
    showView(isAdminLike() ? 'tickets' : 'mytickets');
    openTicketDetail(ticketId);
  } else if (taskId) {
    viewTaskDetail(taskId);
  }
}

// ── App shell ─────────────────────────────────────────
function showLogin() {
  document.getElementById('loginPage').style.display  = 'flex';
  document.getElementById('appShell').style.display   = 'none';
}

function showApp() {
  document.getElementById('loginPage').style.display  = 'none';
  document.getElementById('appShell').style.display   = 'flex';
  renderTopbar();
  renderNav();
  if (currentUser.must_change_password)
    document.getElementById('mustChangePwBanner').style.display = 'flex';
  const adminLike = isAdminLike();
  document.getElementById('activitySidebar').style.display = adminLike ? 'flex' : 'none';
  document.querySelector('.main').style.paddingLeft = adminLike ? '236px' : '20px';
  refreshAll();
  if (adminLike) {
    pollOnlineStatus();
    _onlinePollInterval = setInterval(pollOnlineStatus, 30000);
  }
  startHeartbeat();
  loadNotifications();
  _notifInterval = setInterval(loadNotifications, 30000);

  // Ticket badge polling (chỉ manager)
  if (isAdminLike()) {
    pollTicketBadge();
    _ticketBadgeInterval = setInterval(pollTicketBadge, 30000);
  }

  // Dừng polling khi tab bị ẩn, tiếp tục khi user quay lại
  if (!_visibilityListenerAdded) {
    _visibilityListenerAdded = true;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopHeartbeat();
      } else {
        resumePolling();
      }
    });
  }

  document.addEventListener('click', e => {
    const notifDd = document.getElementById('notifDropdown');
    const bell    = document.getElementById('notifBell');
    if (notifDd && bell && !notifDd.contains(e.target) && !bell.contains(e.target))
      notifDd.classList.remove('open');
    const bankDd   = document.getElementById('bankPickerDropdown');
    const bankWrap = document.getElementById('bankPickerWrap');
    if (bankDd && bankWrap && !bankWrap.contains(e.target))
      bankDd.style.display = 'none';
  });
}

function renderTopbar() {
  const el = document.getElementById('topAvatar');
  el.className = 'avatar ' + (isAdminLike() ? 'av-admin' : 'av-hr');
  if (currentUser.avatar_url) {
    el.innerHTML = `<img src="${currentUser.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    el.textContent = currentUser.full_name.slice(0, 2).toUpperCase();
  }
  document.getElementById('topName').textContent = currentUser.full_name;
  document.getElementById('topRole').textContent =
    currentUser.role === 'admin'     ? 'Quản trị viên'
    : currentUser.role === 'hr_leader' ? 'HR Leader'
    :                                    'Nhân viên HR';
}

function renderNav() {
  const tabs = isAdminLike()
    ? [{id:'dashboard',label:'Dashboard'},{id:'alltasks',label:'Tổng Task'},{id:'users',label:'Tài khoản'},{id:'cvs',label:'Tất cả CV'},{id:'tickets',label:'🎫 Tickets'},{id:'history',label:'Lịch sử'},{id:'logs',label:'Logs'}]
    : [{id:'mytasks',label:'Task của tôi'},{id:'mycvs',label:'CV đã nộp'},{id:'mytickets',label:'🎫 Tickets'},{id:'history',label:'Lịch sử'}];
  document.getElementById('navTabs').innerHTML = tabs.map(t =>
    `<button class="nav-tab ${t.id===getActiveView()?'active':''}" onclick="showView('${t.id}')">${t.label}</button>`
  ).join('');
  showView(tabs[0].id);
}

function getActiveView() {
  const v = document.querySelector('.view.active');
  return v ? v.id.replace('v-', '') : '';
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('v-' + id)?.classList.add('active');
  const labelMap = {
    dashboard:'Dashboard', alltasks:'Tổng Task', users:'Tài khoản', cvs:'Tất cả CV',
    tickets:'🎫 Tickets', mytasks:'Task của tôi', mycvs:'CV đã nộp',
    mytickets:'🎫 Tickets', history:'Lịch sử', logs:'Logs',
  };
  document.querySelectorAll('.nav-tab').forEach(t =>
    t.classList.toggle('active', t.textContent.trim() === labelMap[id])
  );
  loadView(id);
}

function loadView(id) {
  if (id === 'dashboard')  loadDashboard();
  else if (id === 'alltasks') loadAllTasks();
  else if (id === 'users')  { loadUsers(); if (_cachedStats) renderSidebarHR(_cachedStats.hr_list || []); }
  else if (id === 'cvs')    { loadAllCVs(); if (_cachedStats) renderSidebarHR(_cachedStats.hr_list || []); }
  else if (id === 'mytasks')  loadMyTasks();
  else if (id === 'mycvs')    loadMyCVs();
  else if (id === 'tickets')   loadTickets();
  else if (id === 'mytickets') loadMyTickets();
  else if (id === 'history')  loadHistory();
  else if (id === 'logs')     loadLogs();
  else if (id === 'settings') loadSettings();
}

async function refreshAll() {
  loadView(getActiveView() || (isAdminLike() ? 'dashboard' : 'mytasks'));
}

// ── Modal overrides ───────────────────────────────────
// openModal: intercept modalTask to populate HR list first
openModal = function(id) {
  if (id === 'modalTask') { openModal_task(); return; }
  _baseOpenModal(id);
};

// closeModal: stop trial timer when task detail closes
closeModal = function(id) {
  if (id === 'modalTaskDetail') {
    if (_trialTimer) { clearInterval(_trialTimer); _trialTimer = null; }
    _trialTaskId = null;
    document.querySelector('#modalTaskDetail > .modal').style.maxWidth = '1000px';
    const descEl = document.getElementById('td-desc');
    if (descEl && descEl.getAttribute('contenteditable')) {
      const parent = descEl.parentElement;
      if (parent && parent.tagName === 'DIV')
        parent.outerHTML = `<div id="td-desc" style="line-height:1.8">${fmtDescHtml(_editDescCancelText) || 'Không có mô tả'}</div>`;
    }
  }
  _baseCloseModal(id);
};

// ── Bootstrap ─────────────────────────────────────────
window.onload = () => {
  if (token && currentUser) showApp();
  else showLogin();
  document.getElementById('loginPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
};
