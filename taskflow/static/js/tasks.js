// ── Status maps ──────────────────────────────────────
const statusMap   = {pending:'Chờ nhận', contacted:'Đã liên hệ', trial:'Đang thử việc', completed:'Hoàn thành'};
const statusBadge = {pending:'b-gray',   contacted:'b-blue',      trial:'b-amber',        completed:'b-green'};

// ── Trial timer state ────────────────────────────────
let _trialTimer     = null;
let _trialTaskId    = null;
let _trialStartTime = 0;
let _trialEndTime   = 0;

// ── Task detail shared state ─────────────────────────
let _currentTaskId   = null;
let _currentTaskCvs  = [];
let _pendingStatus   = null;
let _selectedCvId    = null;
let _editDescCancelText = '';

const _cvStatusLabel = {pending:'Chờ phản hồi', contacted:'Đã liên hệ', good:'Phù hợp', no:'Chưa phù hợp', trial:'Đang thử việc', signed:'Đã ký hợp đồng'};
const _cvStatusBadge = {pending:'b-amber',       contacted:'b-blue',      good:'b-green',  no:'b-red',        trial:'b-amber',        signed:'b-green'};
const _ratingLabel   = {good:'Phù hợp tốt',      potential:'Tiềm năng',   average:'Trung bình', no:'Không phù hợp'};

// ── Open Create Task modal ───────────────────────────
async function openModal_task(selectedUsername) {
  const users   = await api('GET', '/api/users/');
  const hrUsers = users.filter(u => (u.role === 'hr' || u.role === 'hr_leader') && u.is_active);
  document.getElementById('t-assign').innerHTML = hrUsers.map(u =>
    `<option ${u.username === selectedUsername ? 'selected' : ''} value="${u.username}">${u.full_name}</option>`
  ).join('');
  document.getElementById('t-code').value  = '';
  document.getElementById('t-title').value = '';
  document.getElementById('t-desc').innerHTML = '';
  document.getElementById('t-file').value = '';
  _baseOpenModal('modalTask');
}

// ── Multi-range selection in rich editor ─────────────
let _selectedBlocks = new Set();

function getBlock(el) {
  const root = el?.closest('[contenteditable]');
  if (!root) return null;
  while (el && el !== root) {
    if (el.tagName === 'P' || el.tagName === 'LI' || el.tagName === 'DIV') return el;
    el = el.parentElement;
  }
  return null;
}

function toggleBlock(el) {
  if (!el) return;
  if (_selectedBlocks.has(el)) { _selectedBlocks.delete(el); el.classList.remove('multi-sel'); }
  else                         { _selectedBlocks.add(el);    el.classList.add('multi-sel'); }
}

function clearSelectedBlocks() {
  _selectedBlocks.forEach(el => el.classList.remove('multi-sel'));
  _selectedBlocks.clear();
}

function onContentMouseDown(e) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    toggleBlock(getBlock(document.elementFromPoint(e.clientX, e.clientY)));
  } else {
    clearSelectedBlocks();
  }
}

function applyFmtToSelected(cmd) {
  if (_selectedBlocks.size === 0) return;
  _selectedBlocks.forEach(block => {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(block);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand(cmd, false, null);
  });
  clearSelectedBlocks();
}

function cleanPaste(e) {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, text);
}

function execFmtCreate(cmd) {
  const el = document.getElementById('t-desc');
  if (!el) return;
  if (_selectedBlocks.size > 0) { applyFmtToSelected(cmd); return; }
  el.focus(); document.execCommand(cmd, false, null); el.focus();
}

function execFmt(cmd) {
  const el = document.getElementById('td-desc');
  if (!el) return;
  if (_selectedBlocks.size > 0) { applyFmtToSelected(cmd); return; }
  el.focus(); document.execCommand(cmd, false, null);
}

// ── Create task ──────────────────────────────────────
async function createTask() {
  const title       = document.getElementById('t-title').value.trim();
  const assigned_to = document.getElementById('t-assign').value;
  const descEl      = document.getElementById('t-desc');
  const description = descEl.getAttribute('contenteditable') ? descEl.innerHTML.trim() : descEl.value.trim();
  const fileInput   = document.getElementById('t-file');
  const task_code   = document.getElementById('t-code').value.trim();
  const commissionCheck = document.getElementById('t-commission').value.trim();

  if (!task_code)        return toast('Vui lòng nhập mã task', 'error');
  if (!title)            return toast('Vui lòng nhập tiêu đề task', 'error');
  if (!assigned_to)      return toast('Vui lòng chọn HR phụ trách', 'error');
  if (!fileInput.files[0]) return toast('Vui lòng đính kèm file mô tả công việc', 'error');
  if (!commissionCheck)  return toast('Vui lòng nhập tiền hoa hồng', 'error');
  if (!descEl.textContent.trim()) return toast('Vui lòng nhập nội dung / yêu cầu', 'error');

  const fd = new FormData();
  fd.append('title', title);
  fd.append('description', description);
  fd.append('assigned_to', assigned_to);
  fd.append('task_code', task_code);
  fd.append('cv_target', '1');
  const d = new Date(); d.setDate(d.getDate() + 14);
  fd.append('deadline', d.toISOString().split('T')[0]);
  fd.append('priority', 'normal');
  if (fileInput.files[0]) fd.append('file', fileInput.files[0]);
  const commissionRaw = commissionCheck;
  const digits = commissionRaw.replace(/[^\d]/g, '');
  fd.append('commission', digits ? Number(digits).toLocaleString('vi-VN') + ' VND' : commissionRaw);

  try {
    await apiFormData('POST', '/api/tasks/', fd);
    closeModal('modalTask');
    ['t-title','t-commission','t-file'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('t-desc').innerHTML = '';
    toast('Giao task thành công!', 'success');
    loadDashboard();
  } catch(e) { toast(e.message, 'error'); }
}

// ── Accept task ──────────────────────────────────────
async function acceptTask(taskId, btnEl) {
  if (btnEl) { btnEl.textContent = 'Đang nhận...'; btnEl.disabled = true; }
  try {
    await api('POST', `/api/tasks/${taskId}/accept`);
    toast('Đã nhận task!', 'success');
    loadMyTasks();
  } catch(e) {
    toast(e.message, 'error');
    if (btnEl) { btnEl.textContent = 'Nhận task'; btnEl.disabled = false; }
  }
}

// ── Delete task ──────────────────────────────────────
async function deleteTask(taskId) {
  if (!confirm('Xóa task này?')) return;
  try {
    await api('DELETE', `/api/tasks/${taskId}`);
    toast('Đã xóa task', 'success');
    closeModal('modalTaskDetail');
    refreshAll();
  } catch(e) { toast(e.message, 'error'); }
}

// ── HR Pay banner ────────────────────────────────────
function hrPayBanner(ps, payment, t) {
  const isCompleted = t.candidate_status === 'completed';
  if (ps === 'none') {
    if (!isCompleted) return '';
    return `<div style="margin-top:10px" onclick="event.stopPropagation()">
      <button class="btn btn-success" style="font-size:12px" onclick="openRequestCompletion('${t._id}')">🏁 Yêu cầu thanh toán hoa hồng</button>
    </div>`;
  }
  if (ps === 'requested')
    return `<div class="pay-banner pay-requested" onclick="event.stopPropagation()">⏳ Đã gửi yêu cầu — Vui lòng chờ HR Leader xác nhận chuyển khoản !</div>`;
  if (ps === 'rejected') {
    const reason = payment?.reject_reason || '';
    return `<div class="pay-banner pay-rejected" onclick="event.stopPropagation()">
      <div style="flex:1">❌ Bị từ chối${reason ? `: <em>${reason}</em>` : ''}</div>
      ${isCompleted ? `<button class="btn" style="font-size:11px;padding:2px 8px;flex-shrink:0" onclick="openRequestCompletion('${t._id}')">Gửi lại</button>` : ''}
    </div>`;
  }
  if (ps === 'paid')
    return `<div class="pay-banner pay-paid" onclick="event.stopPropagation()">
      <span>💸 Admin đã chuyển khoản — kiểm tra tài khoản</span>
      <button class="btn btn-success" style="font-size:11px;padding:3px 10px;margin-left:auto;flex-shrink:0"
        onclick="openConfirmPayment('${t._id}')">✅ Xác nhận đã nhận tiền</button>
    </div>`;
  if (ps === 'confirmed')
    return `<div class="pay-banner pay-confirmed" onclick="event.stopPropagation()">✅ Đã xác nhận nhận hoa hồng — task chuyển vào Lịch sử</div>`;
  return '';
}

// ── Load My Tasks (HR view) ──────────────────────────
async function loadMyTasks() {
  try {
    const [tasks, payments] = await Promise.all([
      api('GET', '/api/tasks/'),
      api('GET', '/api/payments/').catch(() => []),
    ]);
    _paymentsCache = payments;
    const payByTask = {};
    payments.forEach(p => { payByTask[p.task_id] = p; });
    const el = document.getElementById('hrTaskCards');
    const activeTasks = tasks.filter(t => t.status !== 'completed');
    if (!activeTasks.length) {
      el.innerHTML = '<div class="card"><div class="card-body" style="text-align:center;color:var(--c-muted);padding:30px">Chưa có task nào đang thực hiện</div></div>';
      return;
    }

    const pendingPayTask = activeTasks.find(t => t.payment_status === 'paid');
    if (pendingPayTask) {
      const pc = pendingPayTask.task_code ? `[${pendingPayTask.task_code}] ` : '';
      document.getElementById('pendingPayTaskName').textContent = `${pc}${pendingPayTask.title}`;
      const pendingPayment = (_paymentsCache || []).find(p => p.task_id === pendingPayTask._id);
      const amountEl  = document.getElementById('pendingPayAmount');
      const amountBox = document.getElementById('pendingPayAmountBox');
      if (pendingPayment?.amount) { amountEl.textContent = pendingPayment.amount; amountBox.style.display = 'flex'; }
      else amountBox.style.display = 'none';
      _pendingBlockTaskId = pendingPayTask._id;
      _baseOpenModal('modalPendingPayment');
    }

    if (!pendingPayTask) {
      const newlyCompleted = activeTasks.find(t =>
        t.candidate_status === 'completed' && (!t.payment_status || t.payment_status === 'none')
      );
      if (newlyCompleted) {
        _completedTaskId = newlyCompleted._id;
        const pc = newlyCompleted.task_code ? `[${newlyCompleted.task_code}] ` : '';
        document.getElementById('ctask-name').textContent = `${pc}${newlyCompleted.title}`;
        const commBox = document.getElementById('ctask-commission-box');
        const commEl  = document.getElementById('ctask-commission');
        if (newlyCompleted.commission) { commEl.textContent = newlyCompleted.commission; commBox.style.display = 'flex'; }
        else commBox.style.display = 'none';
        _baseOpenModal('modalTaskCompleted');
      }
    }

    el.innerHTML = activeTasks.map(t => {
      const accepted = t.accepted;
      const cs = t.candidate_status || 'pending';
      const ps = t.payment_status   || 'none';
      const payment   = payByTask[t._id];
      const isBlocked = !!pendingPayTask && t._id !== pendingPayTask._id;
      const codeHtml  = t.task_code
        ? `<span style="font-family:monospace;font-size:11px;background:var(--c-gray-bg);padding:1px 6px;border-radius:4px;color:var(--c-muted);margin-right:6px">${t.task_code}</span>`
        : '';

      if (!accepted) return `<div class="card mb-16">
        <div class="card-header">
          <div><div class="card-title">${codeHtml}${t.title}</div></div>
          <span class="badge b-amber">Chờ nhận</span>
        </div>
        <div class="card-body" style="text-align:center;padding:16px">
          <button class="btn btn-primary" onclick="acceptTask('${t._id}', this)">📥 Nhận task</button>
        </div>
      </div>`;

      const fileCardHtml = t.file_name
        ? `<div style="margin-top:10px;padding:8px 10px;background:var(--c-blue-bg);border-radius:var(--radius);display:flex;align-items:center;gap:8px;font-size:12px">
            <span>📎 ${t.file_name}</span>
            <a href="/api/tasks/${t._id}/file" target="_blank" class="btn btn-primary" style="font-size:11px;padding:3px 10px;margin-left:auto">Tải xuống</a>
           </div>` : '';

      return `<div class="card mb-16" style="cursor:pointer" onclick="viewTaskDetail('${t._id}')">
        <div class="card-header">
          <div>
            <div class="card-title">${codeHtml}${t.title}</div>
            <div style="font-size:12px;color:var(--c-muted);margin-top:2px">${((t.description||'').replace(/<[^>]+>/g,'').slice(0,60)) + ((t.description||'').replace(/<[^>]+>/g,'').length>60?'…':'')}</div>
            ${fileCardHtml}
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="badge ${statusBadge[cs]}">${statusMap[cs]}</span>
            ${(ps === 'none' || ps === 'rejected')
              ? isBlocked
                ? `<button class="btn" style="font-size:11px;padding:3px 10px;opacity:.45;cursor:not-allowed" disabled>🔒 Nộp CV</button>`
                : `<button class="btn btn-primary" style="font-size:11px;padding:3px 10px"
                    onclick="event.stopPropagation();closeModal('modalTaskDetail');openSubmitCVForTask('${t._id}')">+ Nộp CV</button>`
              : ''}
          </div>
        </div>
        <div class="card-body">
          <div style="display:flex;gap:20px;font-size:12px;color:var(--c-muted)">
            <span>📊 Tiến độ: ${t.cv_count||0} CV Đã nộp</span>
            ${t.commission ? `<span style="font-weight:600;color:var(--c-green)">💰 Hoa hồng: ${t.commission}</span>` : ''}
          </div>
          ${hrPayBanner(ps, payment, t)}
        </div>
      </div>`;
    }).join('');
  } catch(e) { toast(e.message, 'error'); }
}

// ── Render CV list (in task detail) ─────────────────
function renderCVListHtml(cvs, isAdmin) {
  if (!cvs.length) return '<div style="color:var(--c-muted);font-size:13px;text-align:center;padding:30px">Chưa có CV nào</div>';
  const sorted = cvs.slice().sort((a,b) => {
    const o = {trial:0, good:1, pending:2, no:3};
    return (o[a.cv_status] ?? 2) - (o[b.cv_status] ?? 2);
  });
  return `<div class="card" style="margin-top:0;overflow:visible">
    <div class="card-header" style="padding:10px 14px"><span style="font-size:12px;font-weight:500">📋 CV đã nộp (${cvs.length})</span></div>
    <div style="padding:6px 14px 10px">
      ${sorted.map(c => {
        const fileLink = c.file_name ? `<a href="/api/cvs/${c._id}/file" target="_blank" style="font-size:12px;color:var(--c-blue);text-decoration:underline">📎 ${c.file_name}</a>` : '';
        const isTrial = c.cv_status === 'trial';
        const base  = 'padding:10px 12px;border:1px solid var(--c-border);border-radius:var(--radius);margin-bottom:8px';
        const style = isTrial ? base + ';box-shadow:0 0 12px 4px rgba(255,215,0,.5);border-color:rgba(255,215,0,.4)' : base;
        return `<div style="${style}">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <span style="font-weight:600;font-size:14px">${c.position}</span>
            <span class="badge ${_cvStatusBadge[c.cv_status]||'b-amber'}" style="font-size:10px">${_cvStatusLabel[c.cv_status]||'Chờ'}</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
            <span style="font-weight:500;font-size:13px">${c.candidate_name}</span>
            <span style="font-size:11px;color:var(--c-muted)">📞 ${c.contact||'—'}</span>
            <span style="font-size:11px;color:var(--c-hint);margin-left:auto">${_ratingLabel[c.rating]||c.rating}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${fileLink}
            ${isAdmin && c.submitted_by_name ? `<span style="font-size:11px;color:var(--c-hint);margin-left:auto">👤 ${c.submitted_by_name}</span>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

// ── CV status picker ─────────────────────────────────
const _pickerLabel = {
  contacted: '📞 Chọn CV đang được liên hệ',
  trial:     '🧪 Chọn CV bắt đầu thử việc',
  completed: '✅ Chọn CV đã hoàn thành tuyển dụng',
};

function initStatusChange(newStatus) {
  if (newStatus === 'pending') { updateCandidateStatus(_currentTaskId, newStatus); return; }
  _pendingStatus = newStatus;
  _selectedCvId  = null;
  const el   = document.getElementById('td-cv-area');
  if (!el) return;
  const sorted = _currentTaskCvs.slice().sort((a,b) => {
    const o = {trial:0, good:1, pending:2, no:3};
    return (o[a.cv_status] ?? 2) - (o[b.cv_status] ?? 2);
  });
  el.innerHTML = `
    <div style="background:var(--c-amber-bg);border:1px solid #F59E0B;border-radius:var(--radius);padding:10px 14px;margin-bottom:12px;font-size:13px;color:var(--c-amber);font-weight:500">
      ${_pickerLabel[newStatus] || 'Chọn CV liên quan'}
    </div>
    <div style="font-size:12px;color:var(--c-muted);margin-bottom:8px">Click vào CV bên dưới để chọn:</div>
    ${!_currentTaskCvs.length
      ? '<div style="color:var(--c-muted);font-size:13px;text-align:center;padding:20px">Chưa có CV nào</div>'
      : sorted.map(c => `
        <div id="cvpick-${c._id}" onclick="selectCVForStatus('${c._id}')"
          style="padding:10px 12px;border:2px solid var(--c-border);border-radius:var(--radius);margin-bottom:8px;cursor:pointer;transition:border-color .15s,background .15s">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <span style="font-weight:600;font-size:13px">${c.candidate_name}</span>
            <span class="badge ${_cvStatusBadge[c.cv_status]||'b-amber'}" style="font-size:10px">${_cvStatusLabel[c.cv_status]||'Chờ'}</span>
          </div>
          <div style="font-size:12px;color:var(--c-muted)">${c.position}${c.contact ? ` · 📞 ${c.contact}` : ''}</div>
        </div>`).join('')}
    <div style="display:flex;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--c-border)">
      <button class="btn" onclick="cancelStatusChange()">← Hủy</button>
      <button class="btn btn-primary" id="confirmStatusBtn" onclick="confirmStatusChange()" disabled style="margin-left:auto">Xác nhận</button>
    </div>`;
}

function selectCVForStatus(cvId) {
  _selectedCvId = cvId;
  document.querySelectorAll('[id^="cvpick-"]').forEach(el => {
    el.style.borderColor = 'var(--c-border)';
    el.style.background  = '';
  });
  const el = document.getElementById('cvpick-' + cvId);
  if (el) { el.style.borderColor = 'var(--c-blue)'; el.style.background = 'var(--c-blue-bg)'; }
  const btn = document.getElementById('confirmStatusBtn');
  if (btn) btn.disabled = false;
}

async function confirmStatusChange() {
  if (!_currentTaskId || !_pendingStatus || !_selectedCvId) return;
  try {
    await api('PUT', `/api/tasks/${_currentTaskId}/candidate-status`, {status: _pendingStatus, cv_id: _selectedCvId});
    toast('Cập nhật trạng thái thành công!', 'success');
    closeModal('modalTaskDetail');
    refreshAll();
  } catch(e) { toast(e.message, 'error'); }
}

function cancelStatusChange() {
  _pendingStatus = null; _selectedCvId = null;
  const el = document.getElementById('td-cv-area');
  if (el) el.innerHTML = renderCVListHtml(_currentTaskCvs, currentUser.role === 'admin');
}

async function updateCandidateStatus(taskId, status, silent) {
  try {
    await api('PUT', `/api/tasks/${taskId}/candidate-status`, {status});
    if (!silent) { toast('Cập nhật trạng thái thành công!', 'success'); closeModal('modalTaskDetail'); }
    else toast('✅ Đã hoàn thành thời gian thử việc!', 'success');
    refreshAll();
  } catch(e) { if (!silent) toast(e.message, 'error'); }
}

async function confirmTrialCompletion(taskId) {
  try {
    await api('POST', `/api/tasks/${taskId}/confirm-trial`);
    toast('✅ Đã xác nhận ký hợp đồng! Task chuyển sang Hoàn thành.', 'success');
    closeModal('modalTaskDetail');
    refreshAll();
  } catch(e) { toast(e.message, 'error'); }
}

// ── Trial countdown timer ────────────────────────────
function startTrialTimer() {
  if (_trialTimer) { clearInterval(_trialTimer); _trialTimer = null; }
  if (!_trialTaskId) return;
  const el = document.getElementById('trialCountdown');
  if (!el) return;
  _trialTimer = setInterval(async () => {
    const remaining = Math.max(0, _trialEndTime - Date.now());
    if (remaining <= 0) {
      clearInterval(_trialTimer); _trialTimer = null;
      await updateCandidateStatus(_trialTaskId, 'completed', true);
    } else {
      el.textContent = fmtCountdown(remaining);
    }
  }, 1000);
}

// ── Description helpers ──────────────────────────────
function fmtDescHtml(html) {
  if (!html || html === 'Không có mô tả') return 'Không có mô tả';
  if (!/<[^>]+>/.test(html)) return html.replace(/\n/g, '<br>');
  return html;
}

function updateCharCount() {
  const ed = document.getElementById('td-desc');
  const el = document.getElementById('descCharCount');
  if (ed && el) el.textContent = `${ed.textContent.length} ký tự`;
}

function cancelEditDesc(taskId) {
  document.querySelector('#modalTaskDetail > .modal').style.maxWidth = '1000px';
  const ed = document.getElementById('td-desc');
  if (ed) {
    const parent = ed.parentElement;
    if (parent && parent.tagName === 'DIV')
      parent.outerHTML = `<div id="td-desc" style="line-height:1.8">${fmtDescHtml(_editDescCancelText) || 'Không có mô tả'}</div>`;
  }
  document.getElementById('td-footer').innerHTML =
    `<button class="btn btn-danger" onclick="deleteTask('${taskId}')" style="margin-right:auto">🗑️ Xóa task</button>
     <button class="btn" onclick="editTaskDesc('${taskId}')">✏️ Sửa mô tả</button>`;
}

function editTaskDesc(taskId) {
  const descEl = document.getElementById('td-desc');
  if (descEl.getAttribute('contenteditable')) return;
  _editDescCancelText = descEl.innerHTML === 'Không có mô tả' ? '' : descEl.innerHTML;
  descEl.outerHTML = `
    <div style="border:1px solid var(--c-border-md);border-radius:var(--radius);overflow:hidden">
      <div style="display:flex;gap:2px;padding:6px 8px;border-bottom:1px solid var(--c-border);background:var(--c-gray-bg)">
        <button class="btn" style="font-size:12px;padding:2px 8px;font-weight:700" onclick="execFmt('bold')"><b>B</b></button>
        <button class="btn" style="font-size:12px;padding:2px 8px;font-style:italic" onclick="execFmt('italic')"><i>I</i></button>
        <button class="btn" style="font-size:12px;padding:2px 8px;text-decoration:underline" onclick="execFmt('underline')"><u>U</u></button>
        <span style="width:1px;height:18px;background:var(--c-border);margin:0 4px"></span>
        <button class="btn" style="font-size:12px;padding:2px 8px" onclick="execFmt('insertUnorderedList')">•</button>
        <button class="btn" style="font-size:12px;padding:2px 8px" onclick="execFmt('insertOrderedList')">1.</button>
      </div>
      <div id="td-desc" contenteditable="true" onpaste="cleanPaste(event)" onmousedown="onContentMouseDown(event)"
        style="min-height:200px;padding:12px 12px 12px 28px;line-height:1.8;outline:none;font-size:14px">${fmtDescHtml(_editDescCancelText)}</div>
    </div>`;
  const ed = document.getElementById('td-desc');
  ed.focus();
  const sel = window.getSelection(); const range = document.createRange();
  range.selectNodeContents(ed); range.collapse(false);
  sel.removeAllRanges(); sel.addRange(range);
  document.querySelector('#modalTaskDetail > .modal').style.maxWidth = '900px';
  document.getElementById('td-footer').innerHTML =
    `<span id="descCharCount" style="font-size:11px;color:var(--c-muted);margin-right:auto"></span>
     <button class="btn" onclick="cancelEditDesc('${taskId}')">Hủy</button>
     <button class="btn btn-primary" onclick="saveTaskDesc('${taskId}')">Lưu</button>`;
  ed.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveTaskDesc(taskId);
    if (e.key === 'Escape') cancelEditDesc(taskId);
  });
  ed.addEventListener('input', updateCharCount);
  updateCharCount();
}

async function saveTaskDesc(taskId) {
  const ed = document.getElementById('td-desc');
  if (!ed || !ed.getAttribute('contenteditable')) return;
  const newHtml  = ed.innerHTML.trim();
  const newPlain = ed.textContent.trim();
  const origPlain = _editDescCancelText ? new DOMParser().parseFromString(_editDescCancelText,'text/html').body.textContent.trim() : '';
  if (newPlain === origPlain) { cancelEditDesc(taskId); return; }
  const toSave = (newHtml === '<br>' || !newPlain) ? '' : newHtml;
  try {
    await api('PUT', `/api/tasks/${taskId}`, {description: toSave || 'Không có mô tả'});
    toast('Cập nhật mô tả thành công!', 'success');
    document.querySelector('#modalTaskDetail > .modal').style.maxWidth = '1000px';
    closeModal('modalTaskDetail');
    refreshAll();
  } catch(e) { toast(e.message, 'error'); }
}

// ── View task detail ─────────────────────────────────
async function viewTaskDetail(taskId) {
  try {
    const [tasks, taskCvs] = await Promise.all([
      api('GET', '/api/tasks/'),
      api('GET', '/api/cvs/?task_id=' + taskId).catch(() => []),
    ]);
    const t = tasks.find(x => x._id === taskId);
    if (!t) return toast('Không tìm thấy task', 'error');

    _currentTaskId  = t._id;
    _currentTaskCvs = taskCvs;

    const cs      = t.candidate_status || 'pending';
    const isAdmin = isAdminLike();
    const fileHtml = t.file_name
      ? `<div style="margin-top:14px;padding:12px;background:var(--c-blue-bg);border-radius:var(--radius);display:flex;align-items:center;gap:10px">
          <span style="font-size:13px">📎 ${t.file_name}</span>
          <a href="/api/tasks/${t._id}/file" target="_blank" class="btn btn-primary" style="font-size:12px;padding:5px 12px;margin-left:auto">Tải xuống</a>
         </div>` : '';

    let countdownHtml = '';
    if (cs === 'trial' && t.trial_started_at) {
      _trialStartTime = parseUTC(t.trial_started_at).getTime();
      _trialEndTime   = _trialStartTime + 60 * 24 * 60 * 60 * 1000;
      const remaining = Math.max(0, _trialEndTime - Date.now());
      if (remaining > 0) {
        _trialTaskId  = t._id;
        countdownHtml = `<div style="font-size:12px;color:var(--c-amber);font-weight:600;margin-top:6px">⏳ Còn lại: <span id="trialCountdown">${fmtCountdown(remaining)}</span></div>`;
      } else if (isAdmin) {
        countdownHtml = `<div style="margin-top:8px;background:var(--c-amber-bg);border:1px solid #F59E0B;border-radius:var(--radius);padding:10px 12px">
          <div style="font-size:12px;font-weight:600;color:#92400E;margin-bottom:8px">⏰ Thời gian thử việc đã kết thúc</div>
          <div style="font-size:11px;color:var(--c-muted);margin-bottom:10px">Ứng viên có thực sự đã ký hợp đồng không?</div>
          <button class="btn btn-success" style="font-size:12px;padding:5px 14px;width:100%"
            onclick="confirmTrialCompletion('${t._id}')">✅ Xác nhận đã ký hợp đồng</button>
        </div>`;
      } else {
        countdownHtml = `<div style="font-size:12px;color:var(--c-muted);font-weight:500;margin-top:6px">🕐 Chờ Admin xác nhận ký hợp đồng</div>`;
      }
    }

    const isCompleted = t.status === 'completed' && t.payment_status === 'confirmed';
    const statusBtns = isAdmin && !isCompleted ? `
      <div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--c-border)">
        <div style="font-size:12px;font-weight:500;color:var(--c-muted);margin-bottom:8px">Cập nhật trạng thái ứng viên</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${['pending','contacted','trial','completed'].map(s => `
            <button class="btn ${cs===s?'btn-primary':''}" style="font-size:11px;padding:4px 10px"
              onclick="initStatusChange('${s}')" ${cs===s?'disabled':''}>${statusMap[s]}</button>
          `).join('')}
        </div>
      </div>` : '';

    const trialBlock = cs === 'trial' && t.trial_started_at
      ? `<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--c-border)">
          <div style="font-size:11px;color:var(--c-muted);margin-bottom:4px">📅 Bắt đầu: ${fmtTime(t.trial_started_at)}</div>
          ${countdownHtml}
         </div>` : '';

    document.getElementById('td-title').innerHTML =
      `${t.task_code ? `[${t.task_code}] ` : ''}${t.title} <span class="badge ${statusBadge[cs]}">${statusMap[cs]}</span>`;

    if (!isAdmin && !t.accepted) {
      document.getElementById('td-body').innerHTML = `
        <div style="text-align:center;padding:30px 20px">
          <div style="font-size:40px;margin-bottom:12px">📥</div>
          <div style="font-size:15px;font-weight:500;margin-bottom:8px">Bạn chưa nhận task này</div>
          <div style="font-size:13px;color:var(--c-muted);margin-bottom:20px">Nhấn "Nhận task" để xem nội dung và file đính kèm</div>
          <button class="btn btn-primary" onclick="acceptTask('${t._id}', this);closeModal('modalTaskDetail')">📥 Nhận task</button>
        </div>`;
      document.getElementById('td-footer').innerHTML = `<button class="btn" onclick="closeModal('modalTaskDetail')">Đóng</button>`;
    } else {
      document.getElementById('td-body').innerHTML = `
        <div style="display:flex;gap:20px">
          <div style="flex:1;min-width:0;font-size:14px;line-height:1.8">
            ${statusBtns}${trialBlock}${fileHtml}
            ${t.commission ? `<div style="margin-bottom:12px;padding:8px 12px;background:var(--c-green-bg);border-radius:var(--radius);display:flex;align-items:center;gap:8px;font-size:13px"><span>💰</span><span style="font-weight:600">Hoa hồng: ${t.commission}</span></div>` : ''}
            <div style="display:flex;gap:20px;font-size:12px;color:var(--c-muted);margin-bottom:14px;padding:8px 10px;background:var(--c-bg);border-radius:var(--radius);flex-wrap:wrap">
              <span>📤 <b>Giao:</b> ${fmtTime(t.created_at)}</span>
              ${t.accepted_at ? `<span style="color:var(--c-green)">📥 <b>Nhận:</b> ${fmtTime(t.accepted_at)}</span>` : '<span>⏳ Chưa nhận</span>'}
            </div>
            <div style="color:var(--c-muted);font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">Mô tả</div>
            <div id="td-desc" style="line-height:1.8">${fmtDescHtml(t.description)}</div>
          </div>
          <div id="td-cv-area" style="flex:1;min-width:0;padding-left:20px;font-size:14px;line-height:1.8"></div>
        </div>`;
      document.getElementById('td-cv-area').innerHTML = renderCVListHtml(taskCvs, isAdmin);
      document.getElementById('td-footer').innerHTML = !isAdmin
        ? `<button class="btn" onclick="closeModal('modalTaskDetail')">Đóng</button>
           ${t.status==='active'?`<button class="btn btn-primary" onclick="closeModal('modalTaskDetail');openSubmitCVForTask('${t._id}')">Nộp CV</button>`:''}`
        : isCompleted
          ? `<button class="btn" onclick="closeModal('modalTaskDetail')">Đóng</button>`
          : `<button class="btn btn-danger" onclick="deleteTask('${t._id}')" style="margin-right:auto">🗑️ Xóa task</button>
             <button class="btn" onclick="editTaskDesc('${t._id}')">✏️ Sửa mô tả</button>`;
    }
    openModal('modalTaskDetail');
    startTrialTimer();
  } catch(e) { toast(e.message, 'error'); }
}
