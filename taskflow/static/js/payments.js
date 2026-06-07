// ── Shared payment state ─────────────────────────────
let _requestTaskId    = null;
let _completedTaskId  = null;
let _trialExpiredTaskId = null;
let _confirmPaymentId = null;
let _pendingBlockTaskId = null;
let _approvePaymentId = null;
let _rejectPaymentId  = null;

// ── HR: Chip note ────────────────────────────────────
function setReqNote(btn, text) {
  document.getElementById('req-note').value = text;
  document.querySelectorAll('.req-chip').forEach(b => {
    b.classList.remove('btn-primary');
    b.style.fontWeight = '';
  });
  btn.classList.add('btn-primary');
}

// ── HR: Mở modal yêu cầu thanh toán ─────────────────
function openRequestCompletion(taskId) {
  _requestTaskId = taskId;
  document.getElementById('req-note').value = '';
  document.querySelectorAll('.req-chip').forEach(b => b.classList.remove('btn-primary'));
  const cvInfo = document.getElementById('req-cv-info');
  if (cvInfo) cvInfo.textContent = '';
  _baseOpenModal('modalRequestCompletion');
}

async function submitCompletionRequest() {
  const note = document.getElementById('req-note').value.trim();
  try {
    await api('POST', '/api/payments/request', {task_id: _requestTaskId, note});
    closeModal('modalRequestCompletion');
    toast('✅ Đã gửi yêu cầu thanh toán đến Admin!', 'success');
    loadMyTasks();
    loadNotifications();
  } catch(e) { toast(e.message, 'error'); }
}

// ── HR: Xác nhận đã nhận tiền ────────────────────────
async function confirmFromBlockModal() {
  closeModal('modalPendingPayment');
  if (_pendingBlockTaskId) await openConfirmPayment(_pendingBlockTaskId);
}

async function openConfirmPayment(taskId) {
  const payment = _paymentsCache.find(p => p.task_id === taskId && p.status === 'paid');
  if (!payment) return toast('Không tìm thấy thông tin chuyển khoản', 'error');
  _confirmPaymentId = payment._id;
  clearHRConfirmImage();

  document.getElementById('cpay-body').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      ${payment.amount ? `<div style="text-align:center;padding:12px;background:var(--c-green-bg);border-radius:var(--radius)">
        <div style="font-size:11px;color:var(--c-green);font-weight:600;margin-bottom:4px">SỐ TIỀN HOA HỒNG</div>
        <div style="font-size:24px;font-weight:700;color:var(--c-green)">${payment.amount}</div>
      </div>` : ''}
      <div style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--radius);padding:14px;display:flex;flex-direction:column;gap:12px">
        <div style="font-size:11px;font-weight:600;color:var(--c-muted);text-transform:uppercase;letter-spacing:.4px">Thông tin nhận tiền của Admin</div>
        ${payment.admin_full_name    ? `<div style="font-size:13px;font-weight:600">${payment.admin_full_name}</div>` : ''}
        ${payment.admin_bank_name   ? `<div><div style="font-size:10px;color:var(--c-muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">Ngân hàng</div><div style="font-size:14px;font-weight:600">${payment.admin_bank_name}</div></div>` : ''}
        ${payment.admin_bank_account ? `<div><div style="font-size:10px;color:var(--c-muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">Số tài khoản</div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:16px;font-weight:700;font-family:monospace;letter-spacing:1.5px">${payment.admin_bank_account}</span>
            <button class="btn" style="font-size:11px;padding:2px 8px"
              onclick="navigator.clipboard.writeText('${payment.admin_bank_account}').then(()=>toast('Đã sao chép!','success'))">Sao chép</button>
          </div></div>` : ''}
        ${payment.admin_bank_holder ? `<div><div style="font-size:10px;color:var(--c-muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">Chủ tài khoản</div><div style="font-size:14px;font-weight:600;text-transform:uppercase">${payment.admin_bank_holder}</div></div>` : ''}
        ${payment.admin_bank_qr     ? `<div><div style="font-size:10px;color:var(--c-muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Mã QR</div>
          <img src="${payment.admin_bank_qr}" style="width:100%;max-width:160px;border-radius:8px;border:1px solid var(--c-border)"></div>` : ''}
        ${!payment.admin_bank_name && !payment.admin_bank_account
          ? `<div style="font-size:12px;color:var(--c-muted);text-align:center;padding:8px 0">Admin chưa cập nhật thông tin ngân hàng</div>` : ''}
      </div>
      <p style="font-size:12px;color:var(--c-muted)">Sau khi xác nhận hoàn tất, giao dịch sẽ chuyển vào Lịch sử.</p>
    </div>`;

  const adminImgEl = document.getElementById('cpay-admin-image');
  if (payment.transfer_image_url) {
    adminImgEl.innerHTML = `<span style="color:var(--c-muted);font-size:12px">Đang tải ảnh...</span>`;
    loadSecureImg(payment.transfer_image_url, adminImgEl, { linkable: true });
  } else {
    adminImgEl.innerHTML = `<span style="color:var(--c-muted);font-size:12px">Admin chưa đính kèm ảnh</span>`;
  }
  _baseOpenModal('modalPaymentDetail');
}

function previewHRConfirmImage(input) {
  const file = input.files[0];
  if (!file) return;
  const img = document.getElementById('cpay-image-preview-img');
  img.src = URL.createObjectURL(file);
  document.getElementById('cpay-drop-placeholder').style.display = 'none';
  document.getElementById('cpay-image-container').style.display = 'block';
  const zone = document.getElementById('cpay-drop-zone');
  zone.style.borderColor = 'var(--c-green)';
  zone.style.borderStyle = 'solid';
  zone.style.background = '';
  const btn = document.getElementById('cpay-confirm-btn');
  if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
}

function handleHRConfirmDrop(event) {
  event.preventDefault();
  const zone = document.getElementById('cpay-drop-zone');
  zone.style.borderColor = 'var(--c-border-md)';
  zone.style.background = '';
  const file = event.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return toast('Vui lòng chọn file ảnh', 'error');
  const input = document.getElementById('cpay-image');
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  previewHRConfirmImage(input);
}

function clearHRConfirmImage() {
  document.getElementById('cpay-image').value = '';
  document.getElementById('cpay-image-preview-img').src = '';
  document.getElementById('cpay-drop-placeholder').style.display = 'flex';
  document.getElementById('cpay-image-container').style.display = 'none';
  const zone = document.getElementById('cpay-drop-zone');
  zone.style.borderColor = 'var(--c-border-md)';
  zone.style.borderStyle = 'dashed';
  const btn = document.getElementById('cpay-confirm-btn');
  if (btn) { btn.disabled = true; btn.style.opacity = '.5'; btn.style.cursor = 'not-allowed'; }
}

async function confirmPaymentReceipt() {
  if (!_confirmPaymentId) return;
  const imageFile = document.getElementById('cpay-image').files[0];
  if (!imageFile) return toast('Vui lòng tải ảnh xác nhận nhận tiền', 'error');
  const fd = new FormData();
  fd.append('confirmation_image', imageFile);
  try {
    await apiFormData('POST', `/api/payments/${_confirmPaymentId}/confirm`, fd);
    closeModal('modalPaymentDetail');
    toast('✅ Đã xác nhận! Task chuyển vào Lịch sử.', 'success');
    showView('history');
    loadMyTasks();
    loadNotifications();
  } catch(e) { toast(e.message, 'error'); }
}

// ── Admin: Approve payment ───────────────────────────
function previewTransferImage(input) {
  const file = input.files[0];
  if (!file) return;
  const img = document.getElementById('apay-image-preview-img');
  img.src = URL.createObjectURL(file);
  document.getElementById('apay-drop-placeholder').style.display = 'none';
  document.getElementById('apay-image-container').style.display = 'block';
  const zone = document.getElementById('apay-drop-zone');
  zone.style.borderColor = 'var(--c-green)';
  zone.style.borderStyle = 'solid';
  zone.style.background = '';
}

function handleTransferDrop(event) {
  event.preventDefault();
  const zone = document.getElementById('apay-drop-zone');
  zone.style.borderColor = 'var(--c-border-md)';
  zone.style.background = '';
  const file = event.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return toast('Vui lòng chọn file ảnh', 'error');
  const input = document.getElementById('apay-image');
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  previewTransferImage(input);
}

function clearTransferImage() {
  document.getElementById('apay-image').value = '';
  document.getElementById('apay-image-preview-img').src = '';
  document.getElementById('apay-drop-placeholder').style.display = 'flex';
  document.getElementById('apay-image-container').style.display = 'none';
  const zone = document.getElementById('apay-drop-zone');
  zone.style.borderColor = 'var(--c-border-md)';
  zone.style.borderStyle = 'dashed';
}

function openApprovePayment(paymentId, hrUsername) {
  _approvePaymentId = paymentId;
  const payment = _paymentsCache.find(p => p._id === paymentId);
  const hr = (_cachedStats?.hr_list || []).find(h => h.username === hrUsername);

  document.getElementById('apay-subtitle').textContent = payment
    ? `${payment.hr_full_name} — ${payment.task_code ? '[' + payment.task_code + '] ' : ''}${payment.task_title}`
    : '';

  const noteEl = document.getElementById('apay-hr-note');
  if (payment?.completion_note) {
    noteEl.style.display = 'block';
    noteEl.innerHTML = `💬 Ghi chú của HR: <em>${esc(payment.completion_note)}</em>`;
  } else {
    noteEl.style.display = 'none';
  }

  const bankEl = document.getElementById('apay-hr-bank');
  if (hr && (hr.bank_name || hr.bank_account || hr.bank_holder || hr.bank_qr)) {
    bankEl.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px">
      ${hr.bank_name ? `<div>
        <div style="font-size:10px;color:var(--c-muted);font-weight:600;margin-bottom:2px">Ngân hàng</div>
        <div style="font-size:13px;font-weight:700">${esc(hr.bank_name)}</div>
      </div>` : ''}
      ${hr.bank_account ? `<div>
        <div style="font-size:10px;color:var(--c-muted);font-weight:600;margin-bottom:2px">Số tài khoản</div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:14px;font-weight:700;font-family:monospace;letter-spacing:1px">${esc(hr.bank_account)}</span>
          <button class="btn" style="font-size:10px;padding:1px 7px"
            onclick="navigator.clipboard.writeText(this.dataset.acc).then(()=>toast('Đã sao chép!','success'))"
            data-acc="${esc(hr.bank_account)}">Copy</button>
        </div>
      </div>` : ''}
      ${hr.bank_holder ? `<div>
        <div style="font-size:10px;color:var(--c-muted);font-weight:600;margin-bottom:2px">Chủ tài khoản</div>
        <div style="font-size:12px;font-weight:600;text-transform:uppercase">${esc(hr.bank_holder)}</div>
      </div>` : ''}
      ${hr.bank_qr ? `<div>
        <div style="font-size:10px;color:var(--c-muted);font-weight:600;margin-bottom:6px">Mã QR</div>
        <a href="${hr.bank_qr}" target="_blank">
          <img src="${hr.bank_qr}" style="width:100%;border-radius:8px;border:1px solid var(--c-border);cursor:zoom-in">
        </a>
      </div>` : ''}
    </div>`;
  } else {
    bankEl.innerHTML = `<div style="text-align:center;color:var(--c-muted);font-size:12px;padding:12px 0">HR chưa cập nhật<br>thông tin ngân hàng</div>`;
  }

  const rawCommission = payment?.commission_preset || '';
  const digits = rawCommission.replace(/[^\d]/g, '');
  document.getElementById('apay-amount').value   = digits ? Number(digits).toLocaleString('vi-VN') : '';
  document.getElementById('apay-bank').value     = hr?.bank_name    || '';
  document.getElementById('apay-account').value  = hr?.bank_account || '';
  document.getElementById('apay-holder').value   = hr?.bank_holder  || '';
  const taskCode = payment?.task_code || '';
  document.getElementById('apay-content').value  = taskCode ? `Hoa hong tuyen dung Task ${taskCode}` : '';
  document.getElementById('apay-note').value     = '';
  clearTransferImage();
  _baseOpenModal('modalApprovePayment');
}

async function submitApprovePayment() {
  const rawAmount   = document.getElementById('apay-amount').value.trim();
  const digits      = rawAmount.replace(/[^\d]/g, '');
  const amount      = digits ? Number(digits).toLocaleString('vi-VN') + ' VND' : rawAmount;
  const bank_name   = document.getElementById('apay-bank').value.trim();
  const bank_account= document.getElementById('apay-account').value.trim();
  const bank_holder = document.getElementById('apay-holder').value.trim();
  const transfer_content = document.getElementById('apay-content').value.trim();
  const admin_note  = document.getElementById('apay-note').value.trim();
  const imageFile   = document.getElementById('apay-image').files[0];
  if (!amount || !bank_name || !bank_account || !bank_holder)
    return toast('Vui lòng điền đầy đủ thông tin chuyển khoản', 'error');
  if (!imageFile)
    return toast('Vui lòng đính kèm ảnh chuyển khoản từ ngân hàng', 'error');
  const fd = new FormData();
  fd.append('amount', amount);
  fd.append('bank_name', bank_name);
  fd.append('bank_account', bank_account);
  fd.append('bank_holder', bank_holder);
  fd.append('transfer_content', transfer_content);
  fd.append('admin_note', admin_note);
  fd.append('transfer_image', imageFile);
  try {
    await apiFormData('POST', `/api/payments/${_approvePaymentId}/approve`, fd);
    closeModal('modalApprovePayment');
    toast('💸 Đã xác nhận chuyển khoản, HR sẽ nhận thông báo!', 'success');
    loadDashboard();
    loadNotifications();
  } catch(e) { toast(e.message, 'error'); }
}

// ── Admin: Reject payment ────────────────────────────
function openRejectPayment(paymentId) {
  _rejectPaymentId = paymentId;
  document.getElementById('rej-reason').value = '';
  _baseOpenModal('modalRejectPayment');
}

async function submitRejectPayment() {
  const reason = document.getElementById('rej-reason').value.trim();
  if (!reason) return toast('Vui lòng nhập lý do từ chối', 'error');
  try {
    await api('POST', `/api/payments/${_rejectPaymentId}/reject`, {reason});
    closeModal('modalRejectPayment');
    toast('Đã từ chối yêu cầu', 'success');
    loadDashboard();
    loadNotifications();
  } catch(e) { toast(e.message, 'error'); }
}
