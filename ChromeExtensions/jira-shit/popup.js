const $ = (id) => document.getElementById(id);
const IS_TAB = new URLSearchParams(location.search).has('tab');
document.documentElement.classList.toggle('tab', IS_TAB);

let state = { origin: '', issues: [], filter: 'all', sort: { by: 'date', dir: -1 }, jqlEdited: false, pending: [] };

// ---------- Phân tích link ----------
function parseUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const s = u.pathname + u.search;
  const m =
    s.match(/\/browse\/([A-Z][A-Z0-9_]+)-\d+/i) ||
    s.match(/\/projects\/([A-Z][A-Z0-9_]+)/i) ||
    s.match(/[?&]project(?:Key)?=([A-Z][A-Z0-9_]+)/i);
  // Jira Server/DC có thể chạy dưới context path, vd https://host/jira/browse/...
  const ctx = u.pathname.match(/^(.*?)\/(browse|projects|jira\/software|secure|issues|plugins)\b/);
  let base = u.origin + (ctx && ctx[1] && !ctx[1].startsWith('/jira/software') ? ctx[1] : '');
  if (u.hostname.endsWith('atlassian.net')) base = u.origin;
  return { origin: u.origin, base, project: m ? m[1].toUpperCase() : null };
}

// ---------- Khoảng ngày (mặc định: ngày 01 tháng này → hôm nay) ----------
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseYmd(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function getRange() {
  const now = new Date();
  let from = parseYmd($('rangeFrom').value) || new Date(now.getFullYear(), now.getMonth(), 1);
  let to = parseYmd($('rangeTo').value) || now;
  if (from > to) [from, to] = [to, from];
  const toNext = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
  return { from, to, toNext };
}
{
  const now = new Date();
  $('rangeFrom').value = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  $('rangeTo').value = ymd(now);
}

function buildJql() {
  const p = parseUrl($('url').value);
  const scope = $('scope').value;
  const { from, to, toNext } = getRange();
  // Worklogged: mọi task tôi đã log work trong khoảng ngày (không lọc trạng thái)
  const parts = scope === 'logged'
    ? ['worklogAuthor = currentUser()', `worklogDate >= "${ymd(from)}"`, `worklogDate <= "${ymd(to)}"`]
    : ['statusCategory in ("In Progress", Done)', `updated >= "${ymd(from)}"`, `updated < "${ymd(toNext)}"`];
  if (scope === 'mine') parts.push('assignee = currentUser()');
  // WAS: task hiện đang hoặc đã từng giao cho tôi
  if (scope === 'was') parts.push('assignee WAS currentUser()');
  if (p && p.project && $('useProj').checked) parts.push(`project = "${p.project}"`);
  return parts.join(' AND ') + ' ORDER BY updated DESC';
}

function refreshOptions() {
  const p = parseUrl($('url').value);
  $('projWrap').hidden = !(p && p.project);
  if (p && p.project) $('projKey').textContent = p.project;
  if (!state.jqlEdited) $('jql').value = buildJql();
}

// ---------- Chạy BÊN TRONG tab Jira (dùng cookie đăng nhập của bạn) ----------
async function fetchInJira(base, jql) {
  const fields = 'summary,status,updated,resolutiondate,timespent,assignee,issuetype';
  const out = [];
  const get = (path) => fetch(base + path, { headers: { Accept: 'application/json' }, credentials: 'include' });
  const fail = async (r) => {
    if (r.status === 401 || r.status === 403) return { error: 'Chưa đăng nhập Jira (hoặc không có quyền). Hãy đăng nhập trong tab Jira rồi thử lại.' };
    let t = ''; try { const j = await r.json(); t = (j.errorMessages || []).join('; ') || JSON.stringify(j.errors || ''); } catch {}
    return { error: `Jira trả lỗi HTTP ${r.status}. ${t}` };
  };

  // 1) Jira Cloud: /rest/api/3/search/jql (phân trang bằng nextPageToken)
  let useV2 = false, token = null;
  try {
    do {
      const q = new URLSearchParams({ jql, fields, maxResults: '100' });
      if (token) q.set('nextPageToken', token);
      const r = await get('/rest/api/3/search/jql?' + q);
      if (!r.ok) {
        if (out.length === 0 && [404, 405, 410].includes(r.status)) { useV2 = true; break; }
        return await fail(r);
      }
      const d = await r.json();
      out.push(...(d.issues || []));
      token = d.isLast === false || (d.nextPageToken && d.isLast !== true) ? d.nextPageToken : null;
    } while (token && out.length < 3000);
  } catch (e) { if (out.length === 0) useV2 = true; else return { error: String(e) }; }

  // 2) Jira Server / Data Center: /rest/api/2/search (phân trang bằng startAt)
  if (useV2) {
    let startAt = 0, total = 0;
    do {
      const q = new URLSearchParams({ jql, fields, maxResults: '100', startAt: String(startAt) });
      const r = await get('/rest/api/2/search?' + q);
      if (!r.ok) return await fail(r);
      const d = await r.json();
      out.push(...(d.issues || []));
      total = d.total || 0;
      startAt += (d.issues || []).length;
      if (!(d.issues || []).length) break;
    } while (startAt < total && out.length < 3000);
  }

  return {
    issues: out.map((i) => {
      const f = i.fields || {};
      const cat = (f.status && f.status.statusCategory && f.status.statusCategory.key) || '';
      return {
        key: i.key,
        summary: f.summary || '',
        status: (f.status && f.status.name) || '',
        cat,
        date: (cat === 'done' && f.resolutiondate) ? f.resolutiondate : f.updated,
        spent: f.timespent || 0,
        assignee: (f.assignee && f.assignee.displayName) || 'Chưa giao',
        type: (f.issuetype && f.issuetype.name) || '',
      };
    }),
  };
}

// Log work lên Jira; tự bỏ qua worklog đã có (cùng người log, cùng thời điểm, cùng số giờ)
async function postWorklogsInJira(base, entries) {
  const H = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' };
  const toMs = (s) => Date.parse(String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  let me = null;
  try {
    const r = await fetch(base + '/rest/api/2/myself', { credentials: 'include', headers: H });
    if (r.status === 401) return { error: 'Chưa đăng nhập Jira. Hãy đăng nhập trong tab Jira rồi thử lại.' };
    if (r.ok) me = await r.json();
  } catch {}
  const myIds = me ? [me.accountId, me.key, me.name].filter(Boolean) : [];
  const cache = {};
  const existing = async (key) => {
    if (!cache[key]) {
      try {
        const r = await fetch(`${base}/rest/api/2/issue/${encodeURIComponent(key)}/worklog?maxResults=5000`, { credentials: 'include', headers: H });
        cache[key] = r.ok ? ((await r.json()).worklogs || []) : [];
      } catch { cache[key] = []; }
    }
    return cache[key];
  };

  const results = [];
  for (const e of entries) {
    try {
      const list = await existing(e.key);
      const dup = list.some((w) => {
        const a = w.author || {};
        const mine = !myIds.length || [a.accountId, a.key, a.name].some((x) => x && myIds.includes(x));
        return mine && Math.abs(toMs(w.started) - e.startMs) < 60000 && w.timeSpentSeconds === e.seconds;
      });
      if (dup) { results.push({ status: 'dup' }); continue; }

      const r = await fetch(`${base}/rest/api/2/issue/${encodeURIComponent(e.key)}/worklog`, {
        method: 'POST', credentials: 'include', headers: H,
        body: JSON.stringify({ started: e.started, timeSpentSeconds: e.seconds }),
      });
      if (r.ok) {
        list.push(await r.json().catch(() => ({ author: me || {}, started: e.started, timeSpentSeconds: e.seconds })));
        results.push({ status: 'ok' });
      } else {
        let t = '';
        try { const j = await r.json(); t = [...(j.errorMessages || []), ...Object.values(j.errors || {})].join('; '); } catch {}
        results.push({ status: 'err', error: `HTTP ${r.status}${t ? ': ' + t : ''}` });
      }
    } catch (err) {
      results.push({ status: 'err', error: String(err) });
    }
  }
  return { results };
}

// ---------- Tìm / mở tab Jira rồi chạy script ----------
function waitComplete(tabId) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(l); clearTimeout(t); resolve(); };
    const l = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const t = setTimeout(done, 20000);
    chrome.tabs.onUpdated.addListener(l);
    chrome.tabs.get(tabId, (tab) => { if (tab && tab.status === 'complete') done(); });
  });
}

async function getJiraTab(p, rawUrl) {
  const tabs = await chrome.tabs.query({ url: p.origin + '/*' });
  if (tabs.length) return tabs[0].id;
  const tab = await chrome.tabs.create({ url: rawUrl, active: false });
  await waitComplete(tab.id);
  return tab.id;
}

async function runInJira(func, args) {
  const raw = $('url').value.trim();
  const p = parseUrl(raw);
  if (!p) throw new Error('Hãy dán link Jira hợp lệ trước.');
  const tabId = await getJiraTab(p, raw);
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args: [p.base, ...args] });
  const r = res && res.result;
  if (!r) throw new Error('Không chạy được trong tab Jira.');
  if (r.error) throw new Error(r.error);
  return { r, p };
}

function saveSettings() {
  return chrome.storage.local.set({ url: $('url').value.trim(), scope: $('scope').value, useProj: $('useProj').checked });
}

// ---------- Tải danh sách task ----------
async function load() {
  if (!parseUrl($('url').value)) return setMsg('Link không hợp lệ.', true);
  saveSettings();
  $('load').disabled = true;
  setMsg('Đang tải…');
  try {
    const { r, p } = await runInJira(fetchInJira, [$('jql').value.trim() || buildJql()]);
    state.origin = p.base;
    state.issues = r.issues;
    const { from, to } = getRange();
    setMsg(`${r.issues.length} task từ ${fmtDate(from)} đến ${fmtDate(to)}.`);
    render();
  } catch (e) {
    setMsg(e.message || String(e), true);
  } finally {
    $('load').disabled = false;
  }
}

// ---------- Hiển thị ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = (n) => String(n).padStart(2, '0');
const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const fmtDateTime = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())} ${fmtDate(d)}`;

function visible() {
  const { by, dir } = state.sort;
  return state.issues
    .filter((i) => state.filter === 'all' || i.cat === state.filter)
    .slice()
    .sort((a, b) => {
      if (by === 'date') return (new Date(a.date) - new Date(b.date)) * dir;
      if (by === 'spent') return (a.spent - b.spent) * dir;
      if (by === 'key') return a.key.localeCompare(b.key, undefined, { numeric: true }) * dir;
      return String(a[by]).localeCompare(String(b[by]), 'vi') * dir;
    });
}

function render() {
  const all = state.issues;
  $('cAll').textContent = all.length;
  $('cDone').textContent = all.filter((i) => i.cat === 'done').length;
  $('cProg').textContent = all.filter((i) => i.cat === 'indeterminate').length;
  const rows = visible();
  $('tbody').innerHTML = rows.map((i) => `
    <tr>
      <td class="key"><a href="${esc(state.origin)}/browse/${esc(i.key)}" target="_blank">${esc(i.key)}</a></td>
      <td class="nowrap"><span class="type ${/bug/i.test(i.type) ? 'bug' : ''}">${esc(i.type)}</span></td>
      <td>${esc(i.summary)}</td>
      <td class="nowrap">${fmtDate(i.date)}</td>
      <td><span class="st ${esc(i.cat)}">${esc(i.status)}</span></td>
      <td>${esc(i.assignee)}</td>
      <td class="nowrap">${fmtHours(i.spent)}</td>
    </tr>`).join('');
  $('copy').disabled = $('xlsx').disabled = rows.length === 0;
}

function setMsg(t, err) { $('msg').textContent = t; $('msg').className = err ? 'err' : ''; }

// ---------- Xuất ----------
const HEADER = ['Mã', 'Loại', 'Tiêu đề', 'Ngày', 'Trạng thái', 'Assignee', 'Worklogged', 'Logwork', 'Thời gian'];
const rowValues = (i) => [i.key, i.type, i.summary, fmtDate(i.date), i.status, i.assignee, fmtHours(i.spent), '', ''];
const COL_LOGWORK = HEADER.indexOf('Logwork'), COL_TIME = HEADER.indexOf('Thời gian');

$('copy').onclick = async () => {
  const clean = (v) => String(v).replace(/\t|\n/g, ' ');
  const text = [HEADER, ...visible().map(rowValues)].map((r) => r.map(clean).join('\t')).join('\n');
  await navigator.clipboard.writeText(text);
  setMsg('Đã copy — dán thẳng vào Excel / Google Sheets.');
};

$('xlsx').onclick = () => {
  const rows = visible();
  const ws = XLSX.utils.aoa_to_sheet([HEADER, ...rows.map(rowValues)]);
  rows.forEach((i, idx) => {
    const r = idx + 1;
    // Link mở task
    const keyCell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    keyCell.l = { Target: `${state.origin}/browse/${i.key}` };
    // Cột Logwork & Thời gian để định dạng Text, tránh Excel tự đổi "9/10" thành ngày
    for (const c of [COL_LOGWORK, COL_TIME]) ws[XLSX.utils.encode_cell({ r, c })] = { t: 's', v: '', z: '@' };
  });
  ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 60 }, { wch: 12 }, { wch: 16 }, { wch: 22 }, { wch: 12 }, { wch: 10 }, { wch: 18 }];
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: HEADER.length - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tasks');
  const d = new Date();
  const { from, to } = getRange();
  XLSX.writeFile(wb, `jira-tasks-${ymd(from)}_${ymd(to)}.xlsx`);
  setMsg('Đã xuất Excel. Điền cột Logwork (vd 2h, 2,5h) và Thời gian (vd 9, 14:00 9/10), rồi bấm "Nhập file Log work" để tải file lên.');
};

// ---------- Logwork từ file Excel ----------
$('logwork').onclick = async () => {
  if (!IS_TAB) {
    // Mở dạng tab để chọn file ổn định (hộp chọn file có thể làm popup tự đóng)
    await saveSettings();
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=1&lw=1') });
    window.close();
    return;
  }
  $('file').value = '';
  $('file').click();
};

$('file').onchange = async () => {
  const file = $('file').files[0];
  if (!file) return;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    const res = extractWorklogs(rows);
    if (res.fatal) return setMsg(res.fatal, true);
    showPreview(file.name, res.entries, res.errors);
  } catch (e) {
    setMsg('Không đọc được file: ' + (e.message || e), true);
  }
};

function showPreview(name, entries, errors) {
  state.pending = entries;
  const total = entries.reduce((s, e) => s + e.seconds, 0);
  $('lw').hidden = false;
  $('lwTitle').textContent = `${name}: ${entries.length} dòng sẽ log (${fmtHours(total)})` + (errors.length ? ` · ${errors.length} dòng lỗi` : '');
  $('lwNote').textContent = entries.length
    ? 'Kiểm tra lại rồi bấm "Xác nhận log". Dòng đã log trước đó (cùng mã, thời điểm, số giờ) sẽ tự bỏ qua.'
    : 'Không có dòng nào đủ Logwork và Thời gian hợp lệ.';
  $('lwGo').disabled = entries.length === 0;
  $('lwGo').textContent = `Xác nhận log ${entries.length} dòng`;

  const rows = [
    ...entries.map((e, idx) => ({ line: e.line, html: `
      <td>${e.line}</td><td><b>${esc(e.key)}</b></td><td>${fmtHours(e.seconds)}</td>
      <td class="nowrap">${fmtDateTime(e.date)}</td><td id="lwr${idx}" class="muted">Chờ</td>` })),
    ...errors.map((e) => ({ line: e.line, html: `
      <td>${e.line}</td><td>${esc(e.key)}</td><td>${esc(e.logwork)}</td><td>${esc(e.time)}</td>
      <td class="bad">${esc(e.reason)}</td>` })),
  ].sort((a, b) => a.line - b.line);
  $('lwBody').innerHTML = rows.map((r) => `<tr>${r.html}</tr>`).join('');
}

$('lwClose').onclick = () => { $('lw').hidden = true; state.pending = []; };

$('lwGo').onclick = () => submitPending();

async function submitPending() {
  const entries = state.pending;
  if (!entries.length) return false;
  $('lwGo').disabled = true;
  setMsg(`Đang log ${entries.length} dòng…`);
  entries.forEach((_, i) => { $('lwr' + i).textContent = 'Đang log…'; });
  try {
    const payload = entries.map(({ key, seconds, started, startMs }) => ({ key, seconds, started, startMs }));
    const { r } = await runInJira(postWorklogsInJira, [payload]);
    let ok = 0, dup = 0, err = 0;
    r.results.forEach((x, i) => {
      const cell = $('lwr' + i);
      if (x.status === 'ok') { ok++; cell.className = 'ok'; cell.textContent = '✓ Đã log'; }
      else if (x.status === 'dup') { dup++; cell.className = 'muted'; cell.textContent = 'Đã có, bỏ qua'; }
      else { err++; cell.className = 'bad'; cell.textContent = x.error; }
    });
    state.pending = [];
    $('lwGo').textContent = 'Xong';
    setMsg(`Log xong: ${ok} thành công, ${dup} bỏ qua (đã có), ${err} lỗi.`, err > 0);
    if (ok) load();
    return true;
  } catch (e) {
    setMsg(e.message || String(e), true);
    $('lwGo').disabled = false;
    return false;
  }
}

// ---------- Logwork hôm nay: 8h chia đều cho các task ----------
// Ngày được chọn ở ô ngày (mặc định hôm nay)
const toInputDate = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
function selectedDate() {
  const m = String($('logDate').value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
}
function dayLabel(d) {
  return toInputDate(d) === toInputDate(new Date()) ? 'hôm nay' : `ngày ${fmtDate(d)}`;
}
$('logDate').value = toInputDate(new Date());
$('logDate').addEventListener('change', () => {
  if (!$('logDate').value) $('logDate').value = toInputDate(new Date());
  updateTodayHint();
});

function updateTodayHint() {
  const day = selectedDate();
  const { entries, errors } = todayWorklogs($('todayKeys').value, day);
  if (!entries.length && !errors.length) { $('todayHint').textContent = ''; return; }
  const end = entries.length ? new Date(entries[entries.length - 1].startMs + entries[entries.length - 1].seconds * 1000) : null;
  const sizes = [...new Set(entries.map((e) => fmtHours(e.seconds)))].join(' / ');
  $('todayHint').textContent =
    (entries.length ? `${entries.length} task · mỗi task ${sizes} · 08:00–${p2(end.getHours())}:${p2(end.getMinutes())} ${dayLabel(day)}` : '') +
    (entries.length > 32 ? ` · quá 32 task nên tổng ${fmtHours(entries.length * 900)}` : '') +
    (errors.length ? `${entries.length ? ' · ' : ''}Mã không hợp lệ: ${errors.map((e) => e.key).join(', ')}` : '');
}

$('todayKeys').addEventListener('input', updateTodayHint);
$('todayKeys').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('todayGo').click(); });

$('todayGo').onclick = async () => {
  const day = selectedDate();
  const { entries, errors } = todayWorklogs($('todayKeys').value, day);
  if (!entries.length) return setMsg('Hãy dán ít nhất một mã task hợp lệ, vd: ABC-1, ABC-2', true);
  if (!parseUrl($('url').value)) return setMsg('Hãy dán link Jira ở ô trên trước.', true);
  saveSettings();
  $('todayGo').disabled = true;
  showPreview(`Logwork ${fmtDate(day)}`, entries, errors);
  const done = await submitPending();
  $('todayGo').disabled = false;
  if (done) { $('todayKeys').value = ''; updateTodayHint(); }
};

// ---------- Sự kiện ----------
document.querySelectorAll('.chips button').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('.chips button').forEach((x) => x.classList.remove('on'));
  b.classList.add('on');
  state.filter = b.dataset.f;
  render();
}));
document.querySelectorAll('th[data-s]').forEach((th) => (th.onclick = () => {
  const by = th.dataset.s;
  state.sort = { by, dir: state.sort.by === by ? -state.sort.dir : 1 };
  render();
}));
$('url').addEventListener('input', refreshOptions);
$('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
$('scope').onchange = $('useProj').onchange = $('rangeFrom').onchange = $('rangeTo').onchange =
  () => { state.jqlEdited = false; refreshOptions(); };
$('jql').addEventListener('input', () => (state.jqlEdited = true));
$('load').onclick = load;

// Khôi phục lần dùng trước, hoặc lấy link từ tab đang mở nếu là Jira
(async () => {
  const s = await chrome.storage.local.get(['url', 'scope', 'mine', 'useProj']);
  if (['mine', 'was', 'logged', 'all'].includes(s.scope)) $('scope').value = s.scope;
  else if (s.scope === 'worked') $('scope').value = 'logged'; // lựa chọn cũ đã bỏ
  else if (s.mine === false) $('scope').value = 'all'; // tương thích bản cũ
  if (typeof s.useProj === 'boolean') $('useProj').checked = s.useProj;
  let cur = '';
  if (!IS_TAB) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    cur = tab && tab.url && /atlassian\.net|\/browse\/|\/jira\//.test(tab.url) ? tab.url : '';
  }
  $('url').value = cur || s.url || '';
  refreshOptions();
  if (IS_TAB && new URLSearchParams(location.search).has('lw')) {
    $('lwHelp').hidden = false;
  }
})();
