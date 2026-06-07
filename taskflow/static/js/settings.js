// ── Bank list ────────────────────────────────────────
const BANK_LIST = [
  {g:'Ngân hàng lớn',        code:'VCB',   name:'Vietcombank',       label:'Vietcombank (VCB)'},
  {g:'Ngân hàng lớn',        code:'ICB',   name:'VietinBank',        label:'VietinBank (CTG)'},
  {g:'Ngân hàng lớn',        code:'BIDV',  name:'BIDV',              label:'BIDV'},
  {g:'Ngân hàng lớn',        code:'VBARD', name:'Agribank',          label:'Agribank'},
  {g:'Ngân hàng lớn',        code:'TCB',   name:'Techcombank',       label:'Techcombank (TCB)'},
  {g:'Ngân hàng lớn',        code:'MB',    name:'MB Bank',           label:'MB Bank'},
  {g:'Ngân hàng lớn',        code:'VPB',   name:'VPBank',            label:'VPBank'},
  {g:'Ngân hàng lớn',        code:'ACB',   name:'ACB',               label:'ACB'},
  {g:'Ngân hàng khác',       code:'STB',   name:'Sacombank',         label:'Sacombank'},
  {g:'Ngân hàng khác',       code:'TPB',   name:'TPBank',            label:'TPBank'},
  {g:'Ngân hàng khác',       code:'OCB',   name:'OCB',               label:'OCB'},
  {g:'Ngân hàng khác',       code:'SHB',   name:'SHB',               label:'SHB'},
  {g:'Ngân hàng khác',       code:'SEAB',  name:'SeABank',           label:'SeABank'},
  {g:'Ngân hàng khác',       code:'HDB',   name:'HDBank',            label:'HDBank'},
  {g:'Ngân hàng khác',       code:'VIB',   name:'VIB',               label:'VIB'},
  {g:'Ngân hàng khác',       code:'MSB',   name:'MSB',               label:'MSB'},
  {g:'Ngân hàng khác',       code:'LPB',   name:'LienVietPostBank',  label:'LienVietPostBank'},
  {g:'Ngân hàng khác',       code:'NAB',   name:'Nam A Bank',        label:'Nam A Bank'},
  {g:'Ngân hàng khác',       code:'EIB',   name:'Eximbank',          label:'Eximbank'},
  {g:'Ngân hàng khác',       code:'BVB',   name:'BaoViet Bank',      label:'BaoViet Bank'},
  {g:'Ngân hàng khác',       code:'PVCB',  name:'PVcomBank',         label:'PVcomBank'},
  {g:'Ngân hàng khác',       code:'KLB',   name:'KienlongBank',      label:'KienlongBank'},
  {g:'Ngân hàng nước ngoài', code:'SHBVN', name:'Shinhan Bank',      label:'Shinhan Bank'},
  {g:'Ngân hàng nước ngoài', code:'HSBC',  name:'HSBC',              label:'HSBC'},
  {g:'Ngân hàng nước ngoài', code:'SCVN',  name:'Standard Chartered',label:'Standard Chartered'},
];

function bankLogoUrl(code) {
  return `https://api.vietqr.io/img/${code}.png`;
}

function toggleBankPicker() {
  const dd = document.getElementById('bankPickerDropdown');
  if (!dd) return;
  if (dd.style.display !== 'none') { dd.style.display = 'none'; return; }
  const curVal = document.getElementById('s-bank-name').value;
  let html = '', lastGroup = '';
  for (const b of BANK_LIST) {
    if (b.g !== lastGroup) {
      lastGroup = b.g;
      html += `<div style="font-size:10px;font-weight:600;color:var(--c-muted);text-transform:uppercase;letter-spacing:.4px;padding:8px 12px 4px;background:var(--c-bg)">${b.g}</div>`;
    }
    const sel = curVal === b.name;
    html += `<div onclick="selectBank('${b.code}','${b.name}','${b.label}')"
      style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;transition:background .1s;${sel?'background:var(--c-blue-bg)':''}"
      onmouseover="if(this.style.background.indexOf('blue')===-1)this.style.background='var(--c-gray-bg)'"
      onmouseout="this.style.background='${sel?'var(--c-blue-bg)':''}'"
    >
      <img src="${bankLogoUrl(b.code)}" style="width:30px;height:30px;object-fit:contain;border-radius:6px;border:1px solid var(--c-border);flex-shrink:0;background:#fff;padding:2px"
        onerror="this.style.display='none'">
      <span style="font-size:13px;flex:1;${sel?'font-weight:600;color:var(--c-blue)':''}">${b.label}</span>
      ${sel ? '<span style="color:var(--c-blue);font-size:14px">✓</span>' : ''}
    </div>`;
  }
  dd.innerHTML = html;
  dd.style.display = 'block';
  setTimeout(() => {
    const active = dd.querySelector('[style*="blue-bg"]');
    if (active) active.scrollIntoView({block:'nearest'});
  }, 0);
}

function selectBank(code, name, label) {
  document.getElementById('s-bank-name').value = name;
  document.getElementById('bankPickerText').textContent = label;
  document.getElementById('bankPickerText').style.color = 'var(--c-text)';
  const icon = document.getElementById('bankPickerIcon');
  icon.src = bankLogoUrl(code);
  icon.style.display = 'inline-block';
  icon.onerror = () => { icon.style.display = 'none'; };
  document.getElementById('bankPickerDropdown').style.display = 'none';
}

function setBankPicker(name) {
  const bank = BANK_LIST.find(b => b.name === name);
  if (bank) {
    selectBank(bank.code, bank.name, bank.label);
  } else if (name) {
    document.getElementById('s-bank-name').value = name;
    document.getElementById('bankPickerText').textContent = name;
    document.getElementById('bankPickerText').style.color = 'var(--c-text)';
    document.getElementById('bankPickerIcon').style.display = 'none';
  } else {
    document.getElementById('s-bank-name').value = '';
    document.getElementById('bankPickerText').textContent = '-- Chọn ngân hàng --';
    document.getElementById('bankPickerText').style.color = 'var(--c-muted)';
    document.getElementById('bankPickerIcon').style.display = 'none';
  }
}

// ── Profile / Settings ───────────────────────────────
async function refreshCurrentUser() {
  try {
    const me = await api('GET', '/api/auth/me');
    currentUser = { ...currentUser, ...me };
    localStorage.setItem('tf_user', JSON.stringify(currentUser));
    renderTopbar();
  } catch(e) {}
}

async function loadSettings() {
  try {
    const me = await api('GET', '/api/auth/me');
    const av = document.getElementById('settingsAvatar');
    if (me.avatar_url) {
      av.innerHTML = `<img src="${me.avatar_url}" style="width:100%;height:100%;object-fit:cover">`;
    } else {
      av.textContent = currentUser.full_name.slice(0, 2).toUpperCase();
    }
    setBankPicker(me.bank_name || '');
    document.getElementById('s-bank-account').value = me.bank_account || '';
    document.getElementById('s-bank-holder').value  = me.bank_holder  || '';
    const qrPreview = document.getElementById('s-bank-qr-preview');
    if (me.bank_qr) {
      qrPreview.innerHTML = `<img src="${me.bank_qr}" style="width:100%;height:100%;object-fit:cover">`;
    } else {
      qrPreview.innerHTML = 'Chưa có';
    }
  } catch(e) { toast(e.message, 'error'); }
}

async function saveSettings() {
  const payload = {
    bank_name:    document.getElementById('s-bank-name').value,
    bank_account: document.getElementById('s-bank-account').value.trim(),
    bank_holder:  document.getElementById('s-bank-holder').value.trim(),
  };
  try {
    await api('PUT', '/api/auth/profile', payload);
    await refreshCurrentUser();
    toast('Cập nhật thông tin thành công!', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

async function uploadAvatar(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return toast('Ảnh tối đa 2MB', 'error');
  const fd = new FormData();
  fd.append('avatar', file);
  try {
    await apiFormData('PUT', '/api/auth/avatar', fd);
    await refreshCurrentUser();
    toast('Cập nhật ảnh đại diện thành công!', 'success');
    loadSettings();
  } catch(e) { toast(e.message, 'error'); }
}

async function uploadBankQr(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return toast('Ảnh tối đa 2MB', 'error');
  const fd = new FormData();
  fd.append('qr', file);
  try {
    await apiFormData('PUT', '/api/auth/bank-qr', fd);
    await refreshCurrentUser();
    toast('Cập nhật mã QR thành công!', 'success');
    loadSettings();
  } catch(e) { toast(e.message, 'error'); }
}
