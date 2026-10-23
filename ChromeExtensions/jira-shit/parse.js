// Các hàm đọc giá trị Logwork / Thời gian từ file Excel và định dạng giờ.

// 14400 -> "4h", 9000 -> "2,5h"
function fmtHours(sec) {
  if (!sec) return '0h';
  return String(Number((sec / 3600).toFixed(2))).replace('.', ',') + 'h';
}

// "2h", "2,5h", "2.5", 2, "30m", "1h30m", "1h30", "2 giờ", "45 phút" -> số giây
function parseDuration(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v > 0 ? Math.round(v * 3600) : null;
  let s = String(v).toLowerCase().replace(/\s+/g, '').replace(',', '.')
    .replace(/giờ|gio/g, 'h').replace(/phút|phut|p/g, 'm');
  if (/^\d+(\.\d+)?$/.test(s)) s += 'h';
  s = s.replace(/^(\d+)h(\d+)$/, '$1h$2m');
  const m = s.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?$/);
  if (!m || (!m[1] && !m[2])) return null;
  const sec = Math.round(parseFloat(m[1] || 0) * 3600 + parseFloat(m[2] || 0) * 60);
  return sec >= 60 ? sec : null;
}

// "hh:mm dd/MM/yyyy" với giá trị mặc định:
//   thiếu yyyy -> năm hiện tại, thiếu MM -> tháng hiện tại, thiếu hh:mm -> 08:00.
//   thiếu mm -> 00: "9 9" -> 09:00 ngày 9 tháng này.
//   "9" -> 08:00 ngày 9 tháng này. Cũng nhận "14h30 9/10", "9/10 14:00", hoặc ô ngày của Excel.
function parseStart(v, now = new Date()) {
  if (v === null || v === undefined || v === '') return null;
  let y = now.getFullYear(), mo = now.getMonth() + 1, d = null, hh = 8, mm = 0;

  if (typeof v === 'number') {
    if (Number.isInteger(v) && v >= 1 && v <= 31) d = v;          // chỉ ghi ngày
    else if (v > 31) {                                             // ô kiểu ngày của Excel
      const t = new Date(Math.round((v - 25569) * 86400000));
      y = t.getUTCFullYear(); mo = t.getUTCMonth() + 1; d = t.getUTCDate();
      const frac = v % 1;
      if (frac > 1e-6) { const mins = Math.round(frac * 1440); hh = Math.floor(mins / 60); mm = mins % 60; }
    } else return null;
  } else {
    const tokens = String(v).trim().replace(/\s+/g, ' ').split(' ');
    if (tokens.length > 2) return null;
    // Xác định ô nào là giờ: có ":" hoặc "h" thì là giờ; nếu 2 ô đều là số trơn ("9 9")
    // thì ô đầu là giờ (theo định dạng hh:mm dd/MM/yyyy), trừ khi ô đầu là ngày dạng "9/10".
    let timeIdx = tokens.findIndex((t) => /[:hH]/.test(t));
    if (tokens.length === 2 && timeIdx < 0) timeIdx = /[\/\-.]/.test(tokens[0]) ? 1 : 0;
    const dateTokens = tokens.filter((_, i) => i !== timeIdx);
    if (dateTokens.length !== 1) return null; // không có ngày (vd chỉ "14:00")

    if (timeIdx >= 0) {
      const m = tokens[timeIdx].match(/^(\d{1,2})(?:[:hH](\d{2})?)?$/);
      if (!m) return null;
      hh = +m[1]; mm = m[2] ? +m[2] : 0;
    }
    const m = dateTokens[0].match(/^(\d{1,2})(?:[\/\-.](\d{1,2})(?:[\/\-.](\d{4}|\d{2}))?)?$/);
    if (!m) return null;
    d = +m[1];
    if (m[2]) mo = +m[2];
    if (m[3]) y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  }

  if (hh > 23 || mm > 59) return null;
  const dt = new Date(y, mo - 1, d, hh, mm);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

// Date -> "2026-10-09T08:00:00.000+0700" (định dạng Jira yêu cầu)
function jiraDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset(), a = Math.abs(off);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00.000` +
    `${off >= 0 ? '+' : '-'}${p(Math.floor(a / 60))}${p(a % 60)}`;
}

// Bỏ dấu tiếng Việt, chữ thường – dùng để nhận diện tiêu đề cột
const normHeader = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim();

// rows: mảng 2 chiều từ sheet -> { entries, errors }
function extractWorklogs(rows, now = new Date()) {
  let col = null;
  for (let r = 0; r < Math.min(rows.length, 15) && !col; r++) {
    const h = (rows[r] || []).map(normHeader);
    const key = h.findIndex((x) => ['ma', 'key', 'issue key', 'ma task'].includes(x));
    const lw = h.findIndex((x) => ['logwork', 'log work'].includes(x));
    const tg = h.findIndex((x) => ['thoi gian', 'time', 'started'].includes(x));
    if (key >= 0 && lw >= 0 && tg >= 0) col = { r, key, lw, tg };
  }
  if (!col) return { fatal: 'Không tìm thấy các cột "Mã", "Logwork", "Thời gian" trong sheet đầu tiên.' };

  const entries = [], errors = [];
  for (let r = col.r + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const lwRaw = row[col.lw], tgRaw = row[col.tg];
    const empty = (x) => x === undefined || x === null || String(x).trim() === '';
    if (empty(lwRaw) && empty(tgRaw)) continue;
    const line = r + 1;
    const key = String(row[col.key] ?? '').trim().toUpperCase();
    const fail = (reason) => errors.push({ line, key, logwork: String(lwRaw ?? ''), time: String(tgRaw ?? ''), reason });
    if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(key)) { fail('Mã task không hợp lệ'); continue; }
    if (empty(lwRaw)) { fail('Thiếu Logwork'); continue; }
    if (empty(tgRaw)) { fail('Thiếu Thời gian'); continue; }
    const seconds = parseDuration(lwRaw);
    if (!seconds) { fail('Logwork không đọc được (vd: 2h, 2,5h, 30m)'); continue; }
    const dt = parseStart(tgRaw, now);
    if (!dt) { fail('Thời gian không đọc được (vd: 9, 14:00 9/10, 08:00 09/10/2026)'); continue; }
    entries.push({ line, key, seconds, started: jiraDate(dt), startMs: dt.getTime(), date: dt });
  }
  return { entries, errors };
}

// "ABC-1, abc-2 ABC-3" -> worklog hôm nay, tổng 8h chia đều, nối tiếp nhau từ 08:00.
// Mỗi task là bội số của 0.25h (15 phút), nhỏ nhất 0.25h. Phần dư 0.25h cộng dần vào các task đầu
// để tổng đúng 8h (vd 3 task: 2.75h + 2.75h + 2.5h). Nếu hơn 32 task thì mỗi task 0.25h (tổng > 8h).
function todayWorklogs(text, now = new Date(), totalHours = 8, step = 0.25) {
  const keys = [...new Set(String(text).toUpperCase().split(/[\s,;]+/).filter(Boolean))];
  const valid = keys.filter((k) => /^[A-Z][A-Z0-9_]+-\d+$/.test(k));
  const bad = keys.filter((k) => !valid.includes(k));
  const n = valid.length;
  const units = Math.round(totalHours / step), unitMin = step * 60;
  const base = n ? Math.floor(units / n) : 0, rem = n ? units % n : 0;
  let t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0);
  const entries = valid.map((key, i) => {
    const mins = Math.max(1, base + (i < rem ? 1 : 0)) * unitMin;
    const dt = t;
    t = new Date(t.getTime() + mins * 60000);
    return { line: i + 1, key, seconds: mins * 60, started: jiraDate(dt), startMs: dt.getTime(), date: dt };
  });
  const errors = bad.map((k, j) => ({ line: n + j + 1, key: k, logwork: '', time: '', reason: 'Mã task không hợp lệ' }));
  return { entries, errors };
}

if (typeof module !== 'undefined') module.exports = { fmtHours, parseDuration, parseStart, jiraDate, extractWorklogs, todayWorklogs };
