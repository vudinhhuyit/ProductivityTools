// ---------- Chọn ticket & thao tác hàng loạt: comment, chuyển trạng thái, assign ----------
// Dùng chung state / runInJira / render / load / setMsg / esc từ popup.js.

// Chạy BÊN TRONG tab Jira (dùng phiên đăng nhập). Hàm phải tự chứa mọi thứ nó cần.
async function bulkInJira(base, op) {
  const H = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' };
  const enc = encodeURIComponent;
  const call = async (method, path, body) => {
    const r = await fetch(base + path, {
      method, credentials: 'include', headers: H, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const txt = await r.text();
    let data = null; try { data = txt ? JSON.parse(txt) : null; } catch {}
    if (r.status === 401) { const e = new Error('Chưa đăng nhập Jira. Hãy đăng nhập trong tab Jira rồi thử lại.'); e.auth = true; throw e; }
    if (!r.ok) {
      const t = data ? [...(data.errorMessages || []), ...Object.values(data.errors || {})].join('; ') : '';
      throw new Error(`HTTP ${r.status}${t ? ': ' + t : ''}`);
    }
    return data;
  };

  try {
    if (op.type === 'transitions') {
      const out = {};
      for (const k of op.keys) {
        try {
          const d = await call('GET', `/rest/api/2/issue/${enc(k)}/transitions`);
          out[k] = (d.transitions || []).map((t) => ({ id: t.id, name: t.name, to: (t.to && t.to.name) || t.name }));
        } catch (e) { if (e.auth) throw e; out[k] = []; }
      }
      return { transitions: out };
    }

    if (op.type === 'users') {
      const q = `/rest/api/2/user/assignable/search?issueKey=${enc(op.issueKey)}&maxResults=20`;
      let list;
      try { list = await call('GET', `${q}&query=${enc(op.q)}`); }         // Jira Cloud
      catch (e) { if (e.auth) throw e; list = await call('GET', `${q}&username=${enc(op.q)}`); } // Server / DC
      return { users: (list || []).map((u) => ({ accountId: u.accountId, name: u.name, displayName: u.displayName, email: u.emailAddress || '' })) };
    }

    let me = null;
    if (op.type === 'assign') me = await call('GET', '/rest/api/2/myself');
    const cloud = !!(me && me.accountId);
    const who = (u) => (u ? (u.accountId ? { accountId: u.accountId } : { name: u.name }) : (cloud ? { accountId: null } : { name: null }));

    const results = [];
    for (const it of op.items) {
      try {
        if (op.type === 'comment') {
          await call('POST', `/rest/api/2/issue/${enc(it.key)}/comment`, { body: op.text });
        } else if (op.type === 'transition') {
          await call('POST', `/rest/api/2/issue/${enc(it.key)}/transitions`, { transition: { id: it.transitionId } });
        } else if (op.type === 'assign') {
          const user = it.me ? me : it.user;
          await call('PUT', `/rest/api/2/issue/${enc(it.key)}/assignee`, who(user));
        }
        results.push({ key: it.key, status: 'ok' });
      } catch (e) {
        if (e.auth) throw e;
        results.push({ key: it.key, status: 'err', error: e.message });
      }
    }
    return { results };
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

const bulk = { trans: {}, transFor: '', users: new Map(), busy: false };
const selectedKeys = () => [...state.sel];

function setBulkMsg(html, err) { $('bulkMsg').innerHTML = html; $('bulkMsg').className = err ? 'bad' : ''; }

// ---------- Chọn ticket ----------
document.getElementById('tbody').addEventListener('change', (e) => {
  const cb = e.target.closest('input[type=checkbox][data-k]');
  if (!cb) return;
  if (cb.checked) state.sel.add(cb.dataset.k); else state.sel.delete(cb.dataset.k);
  render();
});
$('selAll').addEventListener('change', () => {
  const rows = visible();
  if ($('selAll').checked) rows.forEach((i) => state.sel.add(i.key));
  else rows.forEach((i) => state.sel.delete(i.key));
  render();
});
$('selClear').onclick = () => { state.sel.clear(); render(); };
$('statusF').onchange = () => { state.statusF = $('statusF').value; render(); };

let transTimer = null;
function onSelectionChanged() {
  const n = state.sel.size;
  $('bulk').hidden = n === 0;
  $('selCount').textContent = n;
  if (!n) return;
  // tải lại danh sách bước chuyển khi tập ticket đã chọn thay đổi
  const sig = selectedKeys().sort().join(',');
  if (sig !== bulk.transFor) {
    clearTimeout(transTimer);
    transTimer = setTimeout(loadTransitions, 400);
  }
}

// ---------- Chuyển trạng thái ----------
async function loadTransitions() {
  const keys = selectedKeys();
  const sig = keys.slice().sort().join(',');
  if (!keys.length || sig === bulk.transFor) return;
  const need = keys.filter((k) => !bulk.trans[k]);
  $('bTrans').innerHTML = '<option value="">Đang tải danh sách trạng thái…</option>';
  try {
    if (need.length) {
      const { r } = await runInJira(bulkInJira, [{ type: 'transitions', keys: need }]);
      Object.assign(bulk.trans, r.transitions);
    }
    if (selectedKeys().slice().sort().join(',') !== sig) return; // lựa chọn đã đổi trong lúc tải
    bulk.transFor = sig;
    const count = {};
    keys.forEach((k) => new Set((bulk.trans[k] || []).map((t) => t.to)).forEach((to) => { count[to] = (count[to] || 0) + 1; }));
    const opts = Object.keys(count).sort((a, b) => count[b] - count[a] || a.localeCompare(b, 'vi'));
    $('bTrans').innerHTML = opts.length
      ? '<option value="">Chọn trạng thái đích…</option>' + opts.map((to) =>
        `<option value="${esc(to)}">${esc(to)}${count[to] < keys.length ? ` (${count[to]}/${keys.length} ticket)` : ''}</option>`).join('')
      : '<option value="">Không có bước chuyển nào khả dụng</option>';
  } catch (e) {
    $('bTrans').innerHTML = '<option value="">Không tải được danh sách trạng thái</option>';
    setBulkMsg(esc(e.message || String(e)), true);
  }
}

// ---------- Assign ----------
$('bAssignMode').onchange = () => {
  const user = $('bAssignMode').value === 'user';
  $('bUser').hidden = !user;
  if (user) $('bUser').focus();
};
const userLabel = (u) => `${u.displayName}${u.email ? ` <${u.email}>` : u.name ? ` (${u.name})` : ''}`;
let userTimer = null;
$('bUser').addEventListener('input', () => {
  clearTimeout(userTimer);
  const q = $('bUser').value.trim();
  if (q.length < 2 || bulk.users.has(q)) return;
  userTimer = setTimeout(async () => {
    try {
      const { r } = await runInJira(bulkInJira, [{ type: 'users', q, issueKey: selectedKeys()[0] }]);
      r.users.forEach((u) => bulk.users.set(userLabel(u), u));
      $('bUserList').innerHTML = r.users.map((u) => `<option value="${esc(userLabel(u))}"></option>`).join('');
      if (!r.users.length) setBulkMsg(`Không tìm thấy người có thể assign khớp "${esc(q)}".`, true);
      else setBulkMsg('');
    } catch (e) { setBulkMsg(esc(e.message || String(e)), true); }
  }, 300);
});

// ---------- Chạy thao tác ----------
async function runBulk(label, op, items) {
  if (bulk.busy) return;
  if (!items.length) return setBulkMsg('Không có ticket nào phù hợp để thực hiện.', true);
  if (!confirm(`${label} cho ${items.length} ticket?\n\n${items.map((i) => i.key).join(', ')}`)) return;
  bulk.busy = true;
  document.querySelectorAll('#bulk button').forEach((b) => (b.disabled = true));
  setBulkMsg(`Đang ${label.toLowerCase()} ${items.length} ticket…`);
  try {
    const { r } = await runInJira(bulkInJira, [{ ...op, items }]);
    const ok = r.results.filter((x) => x.status === 'ok');
    const bad = r.results.filter((x) => x.status !== 'ok');
    setBulkMsg(`<span class="ok">✓ ${label}: ${ok.length}/${items.length} ticket thành công.</span>` +
      (bad.length ? `<ul class="bad">${bad.map((x) => `<li><b>${esc(x.key)}</b>: ${esc(x.error)}</li>`).join('')}</ul>` : ''), false);
    return ok.length;
  } catch (e) {
    setBulkMsg(esc(e.message || String(e)), true);
    return 0;
  } finally {
    bulk.busy = false;
    document.querySelectorAll('#bulk button').forEach((b) => (b.disabled = false));
  }
}

$('bCommentGo').onclick = async () => {
  const text = $('bComment').value.trim();
  if (!text) return setBulkMsg('Hãy nhập nội dung comment.', true);
  const n = await runBulk('Comment', { type: 'comment', text }, selectedKeys().map((key) => ({ key })));
  if (n) $('bComment').value = '';
};

$('bTransGo').onclick = async () => {
  const to = $('bTrans').value;
  if (!to) return setBulkMsg('Hãy chọn trạng thái đích.', true);
  const keys = selectedKeys();
  const items = [], skipped = [];
  keys.forEach((key) => {
    const t = (bulk.trans[key] || []).find((x) => x.to === to);
    if (t) items.push({ key, transitionId: t.id }); else skipped.push(key);
  });
  const n = await runBulk(`Chuyển sang "${to}"`, { type: 'transition' }, items);
  if (skipped.length) $('bulkMsg').insertAdjacentHTML('beforeend',
    `<div class="muted">Bỏ qua ${skipped.length} ticket không có bước chuyển sang "${esc(to)}": ${skipped.map(esc).join(', ')}</div>`);
  if (n) { items.forEach((i) => delete bulk.trans[i.key]); bulk.transFor = ''; load(); }
};

$('bAssignGo').onclick = async () => {
  const mode = $('bAssignMode').value;
  const byKey = Object.fromEntries(state.issues.map((i) => [i.key, i]));
  const keys = selectedKeys();
  let items = [], label, skipped = [];
  if (mode === 'reporter') {
    keys.forEach((key) => { const rep = byKey[key] && byKey[key].reporter; if (rep) items.push({ key, user: rep }); else skipped.push(key); });
    label = 'Assign cho reporter';
  } else if (mode === 'me') {
    items = keys.map((key) => ({ key, me: true })); label = 'Assign cho tôi';
  } else if (mode === 'none') {
    items = keys.map((key) => ({ key, user: null })); label = 'Bỏ assign';
  } else {
    const u = bulk.users.get($('bUser').value.trim());
    if (!u) return setBulkMsg('Hãy gõ tên rồi chọn một người trong danh sách gợi ý.', true);
    items = keys.map((key) => ({ key, user: u })); label = `Assign cho ${u.displayName}`;
  }
  const n = await runBulk(label, { type: 'assign' }, items);
  if (skipped.length) $('bulkMsg').insertAdjacentHTML('beforeend',
    `<div class="muted">Bỏ qua ${skipped.length} ticket không có reporter: ${skipped.map(esc).join(', ')}</div>`);
  if (n) load();
};

onSelectionChanged();

// ---------- Logwork nhiều ngày: mỗi ngày 8h chia đều cho các ticket đã chọn ----------
// Dùng lại todayWorklogs (parse.js): bội số 0,25h, phần dư cộng vào task đầu, nối tiếp từ 08:00.
const lwDays = new Set(); // 'YYYY-MM-DD'
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const dayOf = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

function renderDays() {
  const days = [...lwDays].sort();
  $('bDates').innerHTML = days.map((s) => {
    const d = dayOf(s), we = d.getDay() === 0 || d.getDay() === 6;
    return `<span class="dchip${we ? ' we' : ''}">${WD[d.getDay()]} ${fmtDate(d)}<button data-d="${s}" title="Bỏ ngày này">×</button></span>`;
  }).join('');
  updateLwHint();
}

function multiDayEntries() {
  const keys = selectedKeys();
  const days = [...lwDays].sort();
  const entries = [];
  let errors = [];
  days.forEach((s) => {
    const r = todayWorklogs(keys.join(','), dayOf(s));
    entries.push(...r.entries);
    errors = r.errors;
  });
  entries.forEach((e, i) => { e.line = i + 1; });
  return { entries, errors, days, keys };
}

function updateLwHint() {
  const { entries, days, keys } = multiDayEntries();
  if (!days.length) { $('bLwHint').textContent = 'Chọn ngày ở ô bên trái (chọn nhiều lần để thêm nhiều ngày).'; return; }
  const perDay = entries.filter((e) => toInputDate(e.date) === days[0]);
  const sizes = [...new Set(perDay.map((e) => fmtHours(e.seconds)))].join(' / ');
  const total = entries.reduce((n, e) => n + e.seconds, 0);
  $('bLwHint').textContent = `${days.length} ngày × ${keys.length} ticket = ${entries.length} worklog · mỗi ticket ${sizes}/ngày · tổng ${fmtHours(total)}` +
    (keys.length > 32 ? ' · quá 32 ticket nên mỗi ngày vượt 8h' : '');
}

$('bDate').addEventListener('change', () => {
  if ($('bDate').value) { lwDays.add($('bDate').value); renderDays(); }
  $('bDate').value = '';
});
$('bDates').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-d]');
  if (b) { lwDays.delete(b.dataset.d); renderDays(); }
});
$('bDateClear').onclick = () => { lwDays.clear(); renderDays(); };
$('bDateRange').onclick = () => {
  const { from, to } = getRange();
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0 && d.getDay() !== 6) lwDays.add(toInputDate(d));
  }
  renderDays();
};

$('bLwGo').onclick = () => {
  const { entries, errors, days, keys } = multiDayEntries();
  if (!days.length) return setBulkMsg('Hãy chọn ít nhất một ngày để log work.', true);
  if (!entries.length) return setBulkMsg('Không có ticket hợp lệ để log work.', true);
  showPreview(`Logwork ${days.length} ngày × ${keys.length} ticket`, entries, errors);
  setBulkMsg('Kiểm tra bảng xem trước ở dưới rồi bấm <b>Xác nhận log</b>.');
  $('lw').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// cập nhật gợi ý khi đổi lựa chọn ticket
const _onSel = onSelectionChanged;
onSelectionChanged = function () { _onSel(); if (lwDays.size) updateLwHint(); };
