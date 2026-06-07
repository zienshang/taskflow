// ── CV Admin ─────────────────────────────────────────
async function loadAllCVs() {
  try {
    const cvs = await api('GET', '/api/cvs/');
    const ratingMap = {
      good:      '<span class="badge b-green">Phù hợp tốt</span>',
      potential: '<span class="badge b-amber">Tiềm năng</span>',
      average:   '<span class="badge b-gray">Trung bình</span>',
      no:        '<span class="badge b-red">Không phù hợp</span>',
    };
    const cvStatusMap = {
      pending:   '<span class="badge b-amber">Chờ phản hồi</span>',
      contacted: '<span class="badge b-blue">Đã liên hệ</span>',
      good:      '<span class="badge b-green">Phù hợp</span>',
      no:        '<span class="badge b-red">Chưa phù hợp</span>',
      trial:     '<span class="badge b-amber">Đang thử việc</span>',
      signed:    '<span class="badge b-green">Đã ký hợp đồng</span>',
    };
    document.getElementById('cvTbody').innerHTML = cvs.map(c => {
      const fileLink = c.file_name
        ? `<a href="/api/cvs/${c._id}/file" target="_blank" style="font-size:11px;color:var(--c-blue);text-decoration:underline;margin-left:4px">📎 ${c.file_name}</a>`
        : '';
      return `<tr>
        <td style="font-weight:500">${esc(c.candidate_name)}${fileLink}</td>
        <td style="font-size:12px">${esc(c.position)}</td>
        <td style="font-size:12px">${esc(c.task_title)}</td>
        <td style="font-size:12px">${esc(c.submitted_by_name)}</td>
        <td>${ratingMap[c.rating] || esc(c.rating)}</td>
        <td style="font-size:11px">${cvStatusMap[c.cv_status] || cvStatusMap.pending}</td>
        <td style="font-size:12px;color:var(--c-muted);max-width:160px">${esc(c.note||'-')}</td>
        <td style="font-size:11px;color:var(--c-muted)">${fmtTime(c.submitted_at)}</td>
        <td><button class="btn btn-danger" style="font-size:11px;padding:3px 8px" onclick="deleteCV('${c._id}')">Xóa</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--c-muted);padding:24px">Chưa có CV nào</td></tr>';
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteCV(id) {
  if (!confirm('Xóa CV này?')) return;
  try {
    await api('DELETE', `/api/cvs/${id}`);
    toast('Đã xóa CV', 'success');
    loadAllCVs();
  } catch(e) { toast(e.message, 'error'); }
}

async function updateCVStatus(cvId, status) {
  try {
    await api('PUT', `/api/cvs/${cvId}/status`, {cv_status: status});
    toast('Cập nhật trạng thái CV thành công', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

// ── CV HR ────────────────────────────────────────────
async function openSubmitCVForTask(taskId) {
  const tasks = await api('GET', '/api/tasks/');
  const active = tasks.filter(t => t.status === 'active');
  if (!active.length) return toast('Không có task nào đang hoạt động', 'error');
  document.getElementById('cv-task').innerHTML = active.map(t =>
    `<option value="${t._id}" ${t._id === taskId ? 'selected' : ''}>${t.title}</option>`
  ).join('');
  ['cv-name','cv-pos','cv-note','cv-contact','cv-file'].forEach(id => document.getElementById(id).value = '');
  openModal('modalCV');
}

async function openSubmitCV() {
  const tasks = await api('GET', '/api/tasks/');
  const active = tasks.filter(t => t.status === 'active');
  if (!active.length) return toast('Không có task nào đang hoạt động', 'error');
  document.getElementById('cv-task').innerHTML = active.map(t =>
    `<option value="${t._id}">${t.title}</option>`
  ).join('');
  ['cv-name','cv-pos','cv-note','cv-contact','cv-file'].forEach(id => document.getElementById(id).value = '');
  openModal('modalCV');
}

async function submitCV() {
  const task_id        = document.getElementById('cv-task').value;
  const candidate_name = document.getElementById('cv-name').value.trim();
  const position       = document.getElementById('cv-pos').value.trim();
  const rating         = document.getElementById('cv-rating').value;
  const note           = document.getElementById('cv-note').value.trim();
  const contact        = document.getElementById('cv-contact').value.trim();
  const fileInput      = document.getElementById('cv-file');
  if (!candidate_name || !position) return toast('Vui lòng điền tên và vị trí ứng tuyển', 'error');
  const fd = new FormData();
  fd.append('task_id', task_id);
  fd.append('candidate_name', candidate_name);
  fd.append('position', position);
  fd.append('rating', rating);
  fd.append('note', note);
  fd.append('contact', contact);
  if (fileInput.files[0]) fd.append('file', fileInput.files[0]);
  try {
    await apiFormData('POST', '/api/cvs/', fd);
    closeModal('modalCV');
    toast('Nộp CV thành công!', 'success');
    loadMyTasks();
  } catch(e) { toast(e.message, 'error'); }
}

async function loadMyCVs() {
  try {
    const cvs = await api('GET', '/api/cvs/');
    const ratingMap = {
      good:      '<span class="badge b-green">Phù hợp tốt</span>',
      potential: '<span class="badge b-amber">Tiềm năng</span>',
      average:   '<span class="badge b-gray">Trung bình</span>',
      no:        '<span class="badge b-red">Không phù hợp</span>',
    };
    document.getElementById('myCVTbody').innerHTML = cvs.map(c => {
      const fileLink = c.file_name
        ? `<a href="/api/cvs/${c._id}/file" target="_blank" style="font-size:11px;color:var(--c-blue);text-decoration:underline;margin-left:4px">📎 ${c.file_name}</a>`
        : '';
      return `<tr>
        <td style="font-weight:500">${c.candidate_name}${fileLink}</td>
        <td style="font-size:12px">${c.position}</td>
        <td style="font-size:12px;font-weight:500;color:var(--c-blue)">${c.task_code||'—'}</td>
        <td style="font-size:12px">${c.task_title}</td>
        <td>${ratingMap[c.rating] || c.rating}</td>
        <td style="font-size:12px;color:var(--c-muted)">${c.note||'-'}</td>
        <td style="font-size:11px;color:var(--c-muted)">${fmtTime(c.submitted_at)}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--c-muted);padding:24px">Chưa có CV nào</td></tr>';
  } catch(e) { toast(e.message, 'error'); }
}
