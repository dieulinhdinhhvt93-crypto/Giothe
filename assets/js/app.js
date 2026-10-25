'use strict';
/* ================= Giơ Thẻ — trả lời bằng thẻ giơ tay, quét bằng camera ================= */
const CODES = AR.DICTIONARIES.GIOTHE_16.codeList;   // mã 4x4 cho thẻ số 1..64
const MAXCARD = CODES.length;
const LET = ['A', 'B', 'C', 'D'];
const IN_FRAME = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
const STORE_KEY = 'giothe.v1';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = n => String(n).padStart(2, '0');
/** chữ thường + công thức LaTeX giữa $…$, $$…$$, \(…\), \[…\] (KaTeX, có \ce{} cho hóa học) */
const MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$((?:\\\$|[^$\n])+?)\$/g;
const hasMath = s => /\$|\\\(|\\\[/.test(String(s || ''));
function mathHTML(src, big) {
  const s = String(src ?? '');
  if (!window.katex || !hasMath(s)) return esc(s);
  let out = '', i = 0, m; MATH_RE.lastIndex = 0;
  while ((m = MATH_RE.exec(s))) {
    out += esc(s.slice(i, m.index));
    const display = m[1] != null || m[2] != null, tex = m[1] ?? m[2] ?? m[3] ?? m[4];
    try { out += window.katex.renderToString(big && !display ? '\\displaystyle ' + tex : tex, { throwOnError: false, displayMode: display, strict: 'ignore', output: 'html' }); }
    catch (e) { out += esc(m[0]); }
    i = MATH_RE.lastIndex;
  }
  return out + esc(s.slice(i));
}

/* ---------------- dữ liệu ---------------- */
function defaultSettings() {
  return { skin: 'tim', geminiKey: '', geminiModel: '', autoNext: true, autoSummary: true, timeDef: 30, timeAuto: true, timeTick: true, timeEndSound: true, timeStopScan: true, timeReveal: false, camId: '', procWidth: 1280, confirm: 2, sound: true, showLetters: false, mirror: false, tileLetters: true };
}
function sampleData() {
  const names = ['Nguyễn Minh An', 'Trần Bảo Anh', 'Lê Gia Bảo', 'Phạm Ngọc Châu', 'Hoàng Đức Dũng', 'Vũ Thùy Dương', 'Đặng Hải Đăng', 'Bùi Thu Hà',
    'Đỗ Quang Huy', 'Ngô Khánh Linh', 'Dương Tuấn Minh', 'Lý Thảo My', 'Phan Gia Nam', 'Trịnh Bảo Ngọc', 'Mai Anh Quân', 'Hồ Phương Thảo'];
  const cls = { id: uid(), name: 'Lớp mẫu 7A', sample: true, students: names.map((n, i) => ({ card: i + 1, name: n })) };
  const q = (text, choices, correct) => ({ id: uid(), text, choices, correct });
  const set = {
    id: uid(), name: 'Bộ mẫu: Khởi động', sample: true, questions: [
      q('Thủ đô của Việt Nam là thành phố nào?', ['Huế', 'Hà Nội', 'Đà Nẵng', 'TP. Hồ Chí Minh'], [1]),
      q('Số nào sau đây là số nguyên tố?', ['9', '15', '17', '21'], [2]),
      q('Ở áp suất thường, nước sôi ở bao nhiêu độ C?', ['90 °C', '100 °C', '110 °C', '120 °C'], [1]),
      q('Trái Đất quay quanh Mặt Trời.', ['Đúng', 'Sai'], [0]),
      q('Em thấy bài học hôm nay thế nào?', ['Rất dễ hiểu', 'Dễ hiểu', 'Hơi khó', 'Khó, cần giảng lại'], [])
    ]
  };
  return normalize({ classes: [cls], sets: [set], results: {}, live: { classId: cls.id, setId: set.id, qIndex: 0 } });
}
/** đáp án đúng: nhận 1 | "B" | [0,2] | ["A","C"] | "A,C" → mảng chỉ số */
function toIdx(c, n) {
  if (c == null || c === '') return [];
  let arr = Array.isArray(c) ? c : (typeof c === 'string' ? c.split(/[\s,;\/]+/) : [c]);
  const out = [];
  arr.forEach(x => { let i = typeof x === 'number' ? x : (/^\d+$/.test(String(x).trim()) ? +x : LET.indexOf(String(x).trim().toUpperCase().charAt(0))); if (/^(đ|đúng|true)$/i.test(String(x).trim())) i = 0; if (/^(s|sai|false)$/i.test(String(x).trim())) i = 1; if (Number.isInteger(i) && i >= 0 && i < n && !out.includes(i)) out.push(i); });
  return out.sort();
}
/** đọc JSON bộ câu hỏi (file mẫu, file tải từ bản trên Claude, bản sao lưu, hoặc JSON do AI viết) */
function parseSetJSON(text) {
  let t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.search(/[\[{]/), b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']')); if (a > 0 || b < t.length - 1) t = t.slice(a, b + 1);
  // AI hay viết \frac thay vì \\frac trong JSON → sửa trước khi đọc
  t = t.replace(/(^|[^\\])\\(?!u[0-9a-fA-F]{4})(?=[a-zA-Z]{2,})/g, '$1\\\\').replace(/(^|[^\\])\\(?=[{}()\[\]%#&_,;: ^])/g, '$1\\\\');
  const j = JSON.parse(t);
  let sets = Array.isArray(j) ? [{ name: 'Bộ câu hỏi nhập', questions: j }] : Array.isArray(j.sets) ? j.sets : (j.data && Array.isArray(j.data.sets)) ? j.data.sets : Array.isArray(j.questions) ? [j] : null;
  if (!sets || !sets.length) throw new Error('fmt');
  const fresh = normalize({ sets: JSON.parse(JSON.stringify(sets)) }).sets.filter(st => st.questions.length);
  if (!fresh.length) throw new Error('empty');
  fresh.forEach(st => st.questions.forEach(q => { ['text', 'explain'].forEach(k => q[k] = String(q[k] || '').replace(/\x0c/g, '\\f').replace(/\x08/g, '\\b')); q.choices = q.choices.map(c => c.replace(/\x0c/g, '\\f').replace(/\x08/g, '\\b')); }));
  return fresh;
}
function addImportedSets(fresh) {
  fresh.forEach(st => { st.id = uid(); delete st.sample; st.questions.forEach(q => q.id = uid()); if (S.sets.some(x => x.name === st.name)) st.name += ' (nhập)'; });
  S.sets.push(...fresh); S.ui.setId = fresh[0].id; save(); show('sets');
  toast(`Đã nhập ${fresh.length} bộ, ${fresh.reduce((a, st) => a + st.questions.length, 0)} câu hỏi.`);
}
function normalize(d) {
  d.classes = Array.isArray(d.classes) ? d.classes : [];
  d.sets = Array.isArray(d.sets) ? d.sets : [];
  d.results = d.results && typeof d.results === 'object' ? d.results : {};
  d.settings = Object.assign(defaultSettings(), d.settings || {});
  d.live = d.live || {};
  d.ui = d.ui || {};
  d.classes.forEach(c => { c.students = (c.students || []).filter(s => s && s.card); });
  d.sets.forEach(s => { s.name = String(s.name || s.title || 'Bộ câu hỏi'); s.questions = (s.questions || []).filter(q => q && (q.text || q.question)).map(q => { const ch = (q.choices || q.options || ['', '']).map(c => String(c ?? '').replace(/^\s*[A-Da-d]\s*[\.\):]\s+/, '')).slice(0, 4); return { q, ch }; }).map(({ q, ch }) => ({ id: q.id || uid(), text: String(q.text || q.question || ''), choices: ch, correct: toIdx(q.correct ?? q.answer, ch.length), img: q.img || '', explain: q.explain || '', level: q.level || '', check: !!q.check, time: (q.time === 0 || q.time > 0) ? +q.time : null })); });
  return d;
}
function load() {
  try { const t = localStorage.getItem(STORE_KEY); if (!t) return null; return normalize(JSON.parse(t)); } catch (e) { return null; }
}
let S = load() || sampleData();
let saveTimer = null;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 250); }
function saveNow() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
  catch (e) { toast('Không lưu được vào trình duyệt (bộ nhớ đầy hoặc bị chặn). Hãy vào Cài đặt → Xuất bản sao lưu.', 'bad'); }
}
window.addEventListener('beforeunload', saveNow);

const getClass = id => S.classes.find(c => c.id === id);
const getSet = id => S.sets.find(s => s.id === id);
function liveCtx() {
  const cls = getClass(S.live.classId) || S.classes[0] || null;
  const set = getSet(S.live.setId) || S.sets[0] || null;
  S.live.classId = cls ? cls.id : null; S.live.setId = set ? set.id : null;
  const qs = set ? set.questions : [];
  const qi = Math.min(Math.max(0, S.live.qIndex | 0), Math.max(0, qs.length - 1));
  S.live.qIndex = qi;
  return { cls, set, qs, qi, q: qs[qi] || null };
}
function resultOf(clsId, qid, create) {
  if (!clsId || !qid) return null;
  let r = S.results[clsId];
  if (!r) { if (!create) return null; r = S.results[clsId] = {}; }
  if (!r[qid] && create) r[qid] = { resp: {}, at: Date.now(), revealed: false };
  return r[qid] || null;
}
const sortedStudents = cls => [...(cls ? cls.students : [])].sort((a, b) => a.card - b.card);
const isGraded = q => q && q.correct.length > 0;
function qKind(q) {
  if (!isGraded(q)) return 'Khảo sát ý kiến';
  if (q.choices.length === 2 && /^đúng$/i.test(q.choices[0].trim()) && /^sai$/i.test(q.choices[1].trim())) return 'Đúng / Sai';
  return q.correct.length > 1 ? 'Trắc nghiệm · nhiều đáp án đúng' : 'Trắc nghiệm';
}
function givenName(full) { const w = String(full).trim().split(/\s+/); return w[w.length - 1] || ''; }
function shortNames(students) {
  const count = {};
  students.forEach(s => { const g = givenName(s.name).toLowerCase(); count[g] = (count[g] || 0) + 1; });
  const out = {};
  students.forEach(s => {
    const w = String(s.name).trim().split(/\s+/);
    out[s.card] = count[givenName(s.name).toLowerCase()] > 1 && w.length > 1 ? w.slice(-2).join(' ') : (w[w.length - 1] || '—');
  });
  return out;
}

/* ---------------- tiện ích giao diện ---------------- */
let toastTimer;
function toast(msg, kind) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.className = 'toast' + (kind === 'bad' ? ' bad' : ''); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'bad' ? 6000 : 3200);
}
function openModal(html) {
  closeModal();
  const back = document.createElement('div'); back.className = 'modal-back'; back.id = 'modalBack';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  back.addEventListener('mousedown', e => { if (e.target === back) closeModal(); });
  document.body.appendChild(back);
  const f = back.querySelector('textarea,input,select'); if (f) f.focus();
  return back;
}
function closeModal() { const m = $('#modalBack'); if (m) m.remove(); }
/** nút cần bấm 2 lần để xác nhận (vì hộp thoại confirm() có thể bị chặn) */
function armed(btn, fn, label = 'Bấm lần nữa để xác nhận') {
  if (btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.classList.remove('armed'); btn.innerHTML = btn.dataset.orig; fn(); return; }
  btn.dataset.orig = btn.innerHTML; btn.dataset.armed = '1'; btn.classList.add('armed'); btn.textContent = label;
  setTimeout(() => { if (btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.classList.remove('armed'); btn.innerHTML = btn.dataset.orig; } }, 3500);
}
function emptyState(title, text, act, label) {
  return `<div class="empty-state"><h3>${esc(title)}</h3><p style="margin:0;max-width:52ch">${text}</p>${act ? `<button class="btn primary" data-act="${act}">${esc(label)}</button>` : ''}</div>`;
}
async function saveFile(filename, mime, content) {
  filename = filename.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-');
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  if (IN_FRAME && window.claude && typeof window.claude.use === 'function') {
    try {
      const dl = await window.claude.use('downloads');
      if (dl) { await dl.save({ filename, data: blob }); return; }
    } catch (e) { if (e && e.code === 'declined') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
let audioCtx = null;
function beep(freq = 880) {
  if (!S.settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = freq; o.type = 'sine'; g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, audioCtx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.09);
    o.connect(g).connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.1);
  } catch (e) { }
}

/* ================= NHẬN DIỆN THẺ ================= */
let detector = null;
function getDetector() { return detector || (detector = new AR.Detector({ dictionaryName: 'GIOTHE_16', maxHammingDistance: 2 })); }
/** cạnh nào của thẻ đang hướng lên trên → chữ cái đó là câu trả lời. corners[0]→[1] là cạnh A (trên), rồi B (phải), C (dưới), D (trái) */
function upwardSide(c) {
  const cx = (c[0].x + c[1].x + c[2].x + c[3].x) / 4, cy = (c[0].y + c[1].y + c[2].y + c[3].y) / 4;
  let best = 0, bestDot = -Infinity;
  for (let k = 0; k < 4; k++) {
    const a = c[k], b = c[(k + 1) % 4];
    const mx = (a.x + b.x) / 2 - cx, my = (a.y + b.y) / 2 - cy;
    const dot = -my / (Math.hypot(mx, my) || 1);
    if (dot > bestDot) { bestDot = dot; best = k; }
  }
  return best;
}
function detectIn(imageData) {
  const raw = getDetector().detect(imageData);
  const out = [];
  for (const m of raw) {
    if (m.id < 0 || m.id >= MAXCARD) continue;
    const ai = upwardSide(m.corners);
    out.push({ card: m.id + 1, ai, letter: LET[ai], corners: m.corners.map(p => ({ x: p.x, y: p.y })), dist: m.hammingDistance });
  }
  return out;
}
/** quét nhiều tỉ lệ cho ảnh tĩnh, gộp theo số thẻ */
function detectMultiScale(source, w, h) {
  const found = new Map();
  for (const sc of [1, 0.5]) {
    const cw = Math.round(w * sc), ch = Math.round(h * sc);
    if (cw < 200) continue;
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(source, 0, 0, cw, ch);
    for (const m of detectIn(cx.getImageData(0, 0, cw, ch))) {
      m.corners = m.corners.map(p => ({ x: p.x / sc, y: p.y / sc }));
      const prev = found.get(m.card);
      if (!prev || m.dist < prev.dist) found.set(m.card, m);
    }
  }
  return [...found.values()];
}

/* ================= CAMERA ================= */
const cam = { stream: null, scanning: false, timer: 0, fps: 0, seen: new Map(), boxes: [], media: null, error: '' };
const video = $('#video'), overlay = $('#overlay'), camPhoto = $('#camPhoto');
const proc = document.createElement('canvas'); const pctx = proc.getContext('2d', { willReadFrequently: true });

async function startCamera() {
  if (cam.stream) return true;
  cam.error = '';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    cam.error = IN_FRAME ? 'Trang đang mở trong khung xem của Claude nên không dùng được camera.' : 'Trình duyệt này không cho dùng camera.';
    updateCamUI(); return false;
  }
  const base = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  const tries = [];
  if (S.settings.camId) tries.push({ ...base, deviceId: { exact: S.settings.camId } });
  tries.push({ ...base, facingMode: { ideal: 'environment' } });
  tries.push(true);
  for (const v of tries) {
    try { cam.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: v }); break; }
    catch (e) { cam.error = e && e.name === 'NotAllowedError' ? 'Chưa được cấp quyền camera.' : (e && e.name === 'NotFoundError' ? 'Không tìm thấy camera nào.' : 'Không mở được camera (' + (e && e.name || 'lỗi') + ').'); }
  }
  if (!cam.stream) {
    if (IN_FRAME) cam.error = 'Khung xem của Claude không cho dùng camera.';
    updateCamUI(); return false;
  }
  video.srcObject = cam.stream;
  try { await video.play(); } catch (e) { }
  camPhoto.hidden = true; cam.media = null; cam.boxes = []; cam.error = '';
  cam.stream.getVideoTracks()[0].addEventListener('ended', () => { stopCamera(); toast('Camera đã bị ngắt.', 'bad'); });
  updateCamUI(); refreshCameraList();
  return true;
}
function stopCamera() {
  pauseScan(true);
  if (cam.stream) cam.stream.getTracks().forEach(t => t.stop());
  cam.stream = null; video.srcObject = null; cam.boxes = []; drawOverlay(); updateCamUI();
}
async function startScan() {
  const { cls, q } = liveCtx();
  if (!cls || !q) { toast('Chọn lớp và bộ câu hỏi có câu hỏi trước đã.'); return; }
  if (!cls.students.length) { toast('Lớp này chưa có học sinh. Vào “Lớp học” để thêm.'); return; }
  if (!await startCamera()) { toast(cam.error || 'Không mở được camera.', 'bad'); return; }
  camPhoto.hidden = true; cam.media = null;
  cam.scanning = true; cam.seen.clear(); updateCamUI(); scanLoop();
  if (S.settings.timeAuto && TIMER.total && !TIMER.running && !TIMER.ended) startTimer();
}
function pauseScan(silent) {
  cam.scanning = false; clearTimeout(cam.timer); clearTimeout(cam.resumeT);
  if (!cam.media) { cam.boxes = []; drawOverlay(); }
  updateCamUI();
}
function scanLoop() {
  if (!cam.scanning) return;
  const t0 = performance.now();
  if (video.readyState >= 2 && video.videoWidth) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const w = Math.min(vw, S.settings.procWidth | 0 || 1280), sc = w / vw, h = Math.round(vh * sc);
    if (proc.width !== w || proc.height !== h) { proc.width = w; proc.height = h; }
    pctx.drawImage(video, 0, 0, w, h);
    let marks = [];
    try { marks = detectIn(pctx.getImageData(0, 0, w, h)); } catch (e) { console.error(e); }
    marks.forEach(m => { m.corners = m.corners.map(p => ({ x: p.x / sc, y: p.y / sc })); });
    handleMarks(marks, false);
    cam.boxes = marks; cam.boxW = vw; cam.boxH = vh; drawOverlay();
  }
  const dt = performance.now() - t0;
  cam.fps = cam.fps ? cam.fps * 0.85 + 0.15 * (1000 / Math.max(dt, 33)) : 1000 / Math.max(dt, 33);
  updateFps();
  cam.timer = setTimeout(scanLoop, Math.max(5, 66 - dt));
}
/** xử lý danh sách thẻ nhận được (từ camera hoặc ảnh) */
function handleMarks(marks, instant) {
  const { cls, q } = liveCtx();
  if (!cls || !q) return 0;
  const roster = new Set(cls.students.map(s => s.card));
  const now = performance.now(); let n = 0;
  const need = Math.max(1, S.settings.confirm | 0);
  for (const m of marks) {
    if (!roster.has(m.card)) { m.state = 'unknown'; continue; }
    if (m.ai >= q.choices.length) { m.state = 'invalid'; continue; }
    if (instant) { if (commit(m.card, m.letter)) n++; m.state = 'ok'; continue; }
    let s = cam.seen.get(m.card);
    if (s && s.letter === m.letter && now - s.t < 1500) { s.n++; s.t = now; }
    else { s = { letter: m.letter, n: 1, t: now }; cam.seen.set(m.card, s); }
    if (s.n >= need) { if (commit(m.card, m.letter)) n++; m.state = 'ok'; } else m.state = 'pending';
  }
  return n;
}
function commit(card, letter) {
  const { cls, q } = liveCtx();
  const r = resultOf(cls.id, q.id, true);
  const prev = r.resp[card];
  if (prev === letter) return false;
  r.resp[card] = letter; r.at = Date.now(); (r.ts || (r.ts = {}))[card] = r.at; save();
  if (!prev) beep(); else beep(660);
  flashTile(card); scheduleDyn();
  return true;
}
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; }
function drawOverlay() {
  const frame = $('#camFrame');
  const W = frame.clientWidth, H = frame.clientHeight, dpr = window.devicePixelRatio || 1;
  if (!W || !H) return;
  if (overlay.width !== Math.round(W * dpr) || overlay.height !== Math.round(H * dpr)) { overlay.width = Math.round(W * dpr); overlay.height = Math.round(H * dpr); }
  const g = overlay.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const iw = cam.boxW, ih = cam.boxH;
  if (!cam.boxes.length || !iw) return;
  const s = Math.min(W / iw, H / ih), ox = (W - iw * s) / 2, oy = (H - ih * s) / 2;
  const mirror = !!S.settings.mirror && !cam.media;
  const tx = p => ({ x: mirror ? W - (ox + p.x * s) : ox + p.x * s, y: oy + p.y * s });
  const col = { ok: cssVar('--ok'), pending: cssVar('--chalk'), unknown: '#9aa5a0', invalid: cssVar('--bad') };
  const { q } = liveCtx(); const revealed = q && (resultOf(S.live.classId, q.id) || {}).revealed;
  g.lineJoin = 'round';
  for (const m of cam.boxes) {
    const P = m.corners.map(tx); const c = col[m.state] || col.unknown;
    g.beginPath(); P.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath();
    g.lineWidth = 3; g.strokeStyle = c; g.stroke();
    g.globalAlpha = .18; g.fillStyle = c; g.fill(); g.globalAlpha = 1;
    const showL = S.settings.showLetters || revealed;
    const label = (m.state === 'unknown' ? '?' : '') + m.card + (showL && m.state !== 'unknown' ? ' · ' + m.letter : '');
    const cx = P.reduce((a, p) => a + p.x, 0) / 4, top = Math.min(...P.map(p => p.y));
    g.font = '700 13px ' + cssVar('--f-mono');
    const tw = g.measureText(label).width + 12;
    g.fillStyle = c; g.beginPath(); g.roundRect ? g.roundRect(cx - tw / 2, top - 24, tw, 20, 5) : g.rect(cx - tw / 2, top - 24, tw, 20); g.fill();
    g.fillStyle = m.state === 'pending' ? '#2a2104' : '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, cx, top - 14);
  }
}
let fpsTick = 0;
function updateFps() { const t = performance.now(); if (t - fpsTick < 700) return; fpsTick = t; const el = $('#fps'); if (el) el.textContent = Math.round(cam.fps) + ' khung/giây'; }
function updateCamUI() {
  const st = $('#camStatus'), empty = $('#camEmpty'), btn = $('#btnScan');
  $('#camFrame').classList.toggle('mirror', !!S.settings.mirror);
  const hasMedia = !!cam.stream || !!cam.media;
  empty.hidden = hasMedia;
  if (!hasMedia) {
    empty.innerHTML = cam.error
      ? `<b>Không dùng được camera</b><span>${esc(cam.error)}</span><span>${IN_FRAME ? 'Hãy mở file <b>GioThe.html</b> trên máy tính bằng Chrome hoặc Edge để quét trực tiếp. Ở đây vẫn dùng được “Quét từ ảnh chụp”.' : 'Kiểm tra quyền camera ở biểu tượng ổ khóa trên thanh địa chỉ, hoặc dùng “Quét từ ảnh chụp”.'}</span>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="4"/></svg><b>Camera đang tắt</b><span>Bấm “Bắt đầu quét” rồi lia camera chậm qua cả lớp.</span>`;
  }
  st.classList.toggle('on', cam.scanning);
  if (cam.scanning) st.innerHTML = `<span class="live-dot"></span><b>Đang quét</b><span id="fps">…</span><span class="grow"></span><button data-act="cam-off">Tắt camera</button>`;
  else if (cam.stream) st.innerHTML = `<span class="live-dot"></span>Camera bật · tạm dừng nhận thẻ<span class="grow"></span><button data-act="cam-off">Tắt camera</button>`;
  else if (cam.media) st.innerHTML = `<span class="live-dot"></span>Ảnh chụp: nhận ${cam.boxes.filter(b => b.state === 'ok').length} thẻ của lớp<span class="grow"></span><button data-act="photo-clear">Bỏ ảnh</button>`;
  else st.innerHTML = `<span class="live-dot"></span>Camera tắt<span class="grow"></span>${cam.error ? '' : '<span>Phím tắt: Space quét · R đáp án · ←/→ chuyển câu</span>'}`;
  btn.className = 'btn ' + (cam.scanning ? 'stop' : 'primary');
  btn.innerHTML = (cam.scanning ? 'Dừng quét' : 'Bắt đầu quét') + ' <span class="kbd">Space</span>';
}
async function refreshCameraList() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    cam.devices = devs;
    const sel = $('#setCam'); if (sel) fillCamSelect(sel);
  } catch (e) { }
}
function fillCamSelect(sel) {
  const devs = cam.devices || [];
  sel.innerHTML = `<option value="">Tự chọn (ưu tiên camera sau)</option>` + devs.map((d, i) => `<option value="${esc(d.deviceId)}" ${d.deviceId === S.settings.camId ? 'selected' : ''}>${esc(d.label || 'Camera ' + (i + 1))}</option>`).join('');
}
async function scanPhoto(file) {
  const { cls, q } = liveCtx();
  if (!cls || !q) { toast('Chọn lớp và câu hỏi trước đã.'); return; }
  let src, w, h;
  try {
    if (window.createImageBitmap) { src = await createImageBitmap(file); w = src.width; h = src.height; }
    else throw 0;
  } catch (e) {
    src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); });
    w = src.naturalWidth; h = src.naturalHeight;
  }
  const maxW = 2400, sc = Math.min(1, maxW / Math.max(w, h));
  const cw = Math.round(w * sc), ch = Math.round(h * sc);
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; cv.getContext('2d').drawImage(src, 0, 0, cw, ch);
  toast('Đang tìm thẻ trong ảnh…');
  await new Promise(r => setTimeout(r, 30));
  const marks = detectMultiScale(cv, cw, ch);
  if (cam.scanning) pauseScan(true);
  const added = handleMarks(marks, true);
  camPhoto.src = cv.toDataURL('image/jpeg', 0.85); camPhoto.hidden = false;
  cam.media = { w: cw, h: ch }; cam.boxes = marks; cam.boxW = cw; cam.boxH = ch;
  if (cam.stream) { cam.stream.getTracks().forEach(t => t.stop()); cam.stream = null; video.srcObject = null; }
  updateCamUI(); setTimeout(drawOverlay, 30);
  const okN = marks.filter(m => m.state === 'ok').length, unk = marks.filter(m => m.state === 'unknown').length, inv = marks.filter(m => m.state === 'invalid').length;
  toast(okN ? `Nhận ${okN} thẻ (${added} thay đổi)${unk ? ` · ${unk} thẻ không thuộc lớp` : ''}${inv ? ` · ${inv} thẻ chọn chữ không có trong câu` : ''}.` : 'Không thấy thẻ nào. Chụp gần hơn, đủ sáng, thẻ không bị che.', okN ? '' : 'bad');
}
window.addEventListener('resize', () => drawOverlay());

/* ================= TRÌNH CHIẾU ================= */
function renderLive() {
  const { cls, set, qs, qi } = liveCtx();
  $('#liveClass').innerHTML = S.classes.length ? S.classes.map(c => `<option value="${c.id}" ${cls && c.id === cls.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('') : '<option value="">Chưa có lớp</option>';
  $('#liveSet').innerHTML = S.sets.length ? S.sets.map(s => `<option value="${s.id}" ${set && s.id === set.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('') : '<option value="">Chưa có bộ câu hỏi</option>';
  $('#qdots').innerHTML = qs.map((qq, i) => {
    const r = cls && resultOf(cls.id, qq.id); const n = r ? Object.keys(r.resp).length : 0;
    return `<button class="dot ${i === qi ? 'cur' : ''} ${n ? 'done' : ''}" data-act="goto" data-i="${i}" title="Câu ${i + 1}${n ? ' · ' + n + ' em đã trả lời' : ''}">${i + 1}</button>`;
  }).join('');
  renderQuestion(); renderRoster(); updateDynamic(); updateCamUI(); syncTimer();
  applyCamSize();
}
function renderQuestion() {
  const { cls, set, qs, qi, q } = liveCtx();
  const el = $('#qcard');
  if (!cls) { el.className = 'qcard'; el.innerHTML = emptyState('Chưa có lớp học', 'Tạo lớp, dán danh sách học sinh. Mỗi em sẽ nhận một số thẻ cố định.', 'go-classes', 'Tạo lớp học'); return; }
  if (!set) { el.className = 'qcard'; el.innerHTML = emptyState('Chưa có bộ câu hỏi', 'Soạn câu hỏi trắc nghiệm A–D, Đúng/Sai hoặc khảo sát ý kiến — hoặc để Claude tạo tự động từ tài liệu bài học.', 'go-sets', 'Soạn câu hỏi'); return; }
  if (!q) { el.className = 'qcard'; el.innerHTML = emptyState('Bộ câu hỏi này đang trống', 'Thêm câu hỏi hoặc dán nguyên đề bằng “Nhập nhanh từ văn bản”.', 'go-sets', 'Thêm câu hỏi'); return; }
  el.className = 'qcard';
  el.innerHTML = `<div class="qfit">
    <div class="qmeta"><span class="qnum">Câu ${qi + 1}/${qs.length}</span><span class="qtype">${esc(qKind(q))}</span>${q.level ? `<span class="qtype">${esc(q.level)}</span>` : ''}<span class="grow"></span><button class="timer" id="timer" data-act="timer-toggle" title="Bấm để bắt đầu / tạm dừng đếm ngược (phím T)" hidden><svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="19" class="tr"/><circle cx="22" cy="22" r="19" class="fg" id="timerArc"/></svg><b id="timerNum">0</b></button></div>
    <div class="qbody ${q.img ? 'has-img' : ''}">
      <div style="display:grid;gap:22px;min-width:0">
        <h2 class="qtext">${mathHTML(q.text, true) || '<span style="color:var(--muted)">(Chưa có nội dung câu hỏi)</span>'}</h2>
        <ol class="choices ${q.choices.length === 2 ? 'two' : ''}">${q.choices.map((c, i) => `<li class="choice ${q.correct.includes(i) ? 'correct' : ''}" data-ci="${i}"><span class="bar"></span><span class="letter l${i}">${LET[i]}</span><span class="ctext">${mathHTML(c, true)}</span><span class="tick">✓ Đáp án</span><span class="cstat">0</span></li>`).join('')}</ol>
      </div>
      ${q.img ? `<img class="qimg" src="${q.img}" alt="Hình minh họa câu ${qi + 1}">` : ''}
    </div>
    ${q.explain ? `<div class="explain"><b>Giải thích</b>${mathHTML(q.explain, true)}</div>` : ''}</div>`;
  requestAnimationFrame(fitQuestion);
}
let rosterNames = {};
function renderRoster() {
  const { cls } = liveCtx();
  const studs = sortedStudents(cls);
  rosterNames = shortNames(studs);
  $('#roster').innerHTML = studs.map(s => `<button class="tile" data-card="${s.card}" title="${esc(s.name)} · thẻ ${s.card} (bấm để nhập tay)"><span class="tn">${pad2(s.card)}</span><span class="tname">${esc(rosterNames[s.card])}</span><span class="tans"></span></button>`).join('')
    || '<p class="hint" style="grid-column:1/-1">Lớp chưa có học sinh.</p>';
  $('#cntTot').textContent = studs.length;
  requestAnimationFrame(fitRoster);
}
let dynQueued = false;
function scheduleDyn() { if (dynQueued) return; dynQueued = true; requestAnimationFrame(() => { dynQueued = false; updateDynamic(); }); }
function updateDynamic() {
  const { cls, q, qi, qs } = liveCtx();
  const card = $('#qcard');
  const r = cls && q ? resultOf(cls.id, q.id) : null;
  const resp = r ? r.resp : {};
  const roster = new Set((cls ? cls.students : []).map(s => s.card));
  const counts = [0, 0, 0, 0]; let answered = 0;
  for (const k in resp) { if (!roster.has(+k)) continue; const i = LET.indexOf(resp[k]); if (q && i >= 0 && i < q.choices.length) { counts[i]++; answered++; } }
  $('#cntNum').textContent = answered;
  const tot = cls ? cls.students.length : 0;
  $('#meterFill').style.width = (tot ? Math.min(100, answered * 100 / tot) : 0) + '%';
  $('#meter').classList.toggle('full', tot > 0 && answered >= tot);
  const revealed = !!(r && r.revealed);
  if (q) {
    const was = card.classList.contains('revealed');
    card.className = 'qcard' + (revealed ? ' revealed' : '') + (isGraded(q) ? ' graded' : '');
    if (was !== revealed) requestAnimationFrame(fitQuestion);
    $$('.choice', card).forEach(li => {
      const i = +li.dataset.ci; const pct = answered ? Math.round(counts[i] * 100 / answered) : 0;
      li.style.setProperty('--pct', pct + '%'); li.querySelector('.cstat').textContent = `${counts[i]} em · ${pct}%`;
    });
  }
  $$('#roster .tile').forEach(t => {
    const c = +t.dataset.card; const a = resp[c];
    const valid = a && q && LET.indexOf(a) < q.choices.length;
    let cls2 = 'tile';
    if (valid) {
      if (revealed && isGraded(q)) cls2 += q.correct.includes(LET.indexOf(a)) ? ' ok' : ' bad';
      else cls2 += ' answered';
    }
    if (t.classList.contains('flash')) cls2 += ' flash';
    t.className = cls2;
    t.querySelector('.tans').textContent = valid && revealed && S.settings.tileLetters ? a : (valid && !revealed ? '✓' : '');
  });
  const rb = $('#btnReveal');
  rb.innerHTML = (revealed ? 'Ẩn đáp án' : (isGraded(q) ? 'Hiện đáp án' : 'Hiện kết quả')) + ' <span class="kbd">R</span>';
  rb.disabled = !q;
  $('#btnPrev').disabled = qi <= 0; $('#btnNext').disabled = !qs.length;
  const lastQ = qs.length && qi >= qs.length - 1;
  $('#btnNext').innerHTML = lastQ ? 'Kết quả cả lớp →' : 'Câu sau →';
  $('#btnNext').classList.toggle('primary', !!lastQ);
  const dot = $(`#qdots .dot[data-i="${qi}"]`); if (dot) dot.classList.toggle('done', answered > 0);
  linkPublish();
  if (cam.boxes.length) drawOverlay();
}
function flashTile(card) {
  const t = $(`#roster .tile[data-card="${card}"]`); if (!t) return;
  t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash');
  setTimeout(() => t.classList.remove('flash'), 520);
}
function gotoQ(i) {
  const { qs } = liveCtx(); if (!qs.length) return;
  i = Math.max(0, Math.min(qs.length - 1, i));
  if (i === S.live.qIndex) return;
  const wasScanning = cam.scanning, resume = S.settings.autoNext !== false && !!cam.stream;
  if (cam.scanning) pauseScan();
  clearTimeout(cam.resumeT);
  clearPhoto();
  S.live.qIndex = i; save(); renderLive();
  if (resume) {
    toast(`Câu ${i + 1}: tự quét tiếp sau 2 giây (học sinh hạ thẻ cũ, giơ đáp án mới)`);
    cam.resumeT = setTimeout(() => { if (S.live.qIndex === i && S.ui.view === 'live' && cam.stream && !cam.scanning) startScan(); }, 2000);
  } else if (wasScanning) toast('Đã dừng quét khi chuyển câu. Bấm “Bắt đầu quét” khi lớp sẵn sàng.');
}
/* ---------- câu hỏi vừa khít một màn hình ---------- */
function fitQuestion() {
  const card = $('#qcard'), fit = card && card.querySelector('.qfit'); if (!fit) return;
  fit.style.zoom = 1;
  if (window.innerWidth <= 980 || card.offsetParent === null) return;
  const cs = getComputedStyle(card);
  const avail = card.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 4;
  if (avail <= 0 || fit.getBoundingClientRect().height <= avail) return;
  let lo = 0.45, hi = 1;
  for (let k = 0; k < 7; k++) { const mid = (lo + hi) / 2; fit.style.zoom = mid; if (fit.getBoundingClientRect().height <= avail) lo = mid; else hi = mid; }
  fit.style.zoom = lo;
}
if (window.ResizeObserver) new ResizeObserver(() => requestAnimationFrame(fitQuestion)).observe($('#qcard'));
/* ---------- đồng hồ đếm ngược ---------- */
const TIMER = { key: '', total: 0, left: 0, running: false, endAt: 0, iv: 0, lastSec: -1 };
const qTime = q => !q ? 0 : (q.time === 0 ? 0 : (q.time > 0 ? q.time : (+S.settings.timeDef || 0)));
function syncTimer(force) {
  const { cls, q } = liveCtx(); const key = cls && q ? cls.id + '|' + q.id : '';
  const want = qTime(q);
  if (force || key !== TIMER.key || (!TIMER.running && !TIMER.ended && TIMER.left === TIMER.total && want !== TIMER.total)) { stopTimerRun(); TIMER.key = key; TIMER.total = want; TIMER.left = want; TIMER.ended = false; }
  paintTimer();
}
function stopTimerRun() { clearInterval(TIMER.iv); TIMER.iv = 0; TIMER.running = false; }
function startTimer() {
  if (!TIMER.total) return;
  if (TIMER.left <= 0) { TIMER.left = TIMER.total; TIMER.ended = false; }
  TIMER.running = true; TIMER.endAt = performance.now() + TIMER.left * 1000; TIMER.lastSec = Math.ceil(TIMER.left);
  clearInterval(TIMER.iv); TIMER.iv = setInterval(tickTimer, 100); paintTimer();
}
function pauseTimer() { if (!TIMER.running) return; TIMER.left = Math.max(0, (TIMER.endAt - performance.now()) / 1000); stopTimerRun(); paintTimer(); }
function toggleTimer() { TIMER.running ? pauseTimer() : startTimer(); }
function addTime(sec) { if (!TIMER.total) return; if (TIMER.running) TIMER.endAt += sec * 1000; else TIMER.left += sec; TIMER.total = Math.max(TIMER.total, Math.ceil(TIMER.running ? (TIMER.endAt - performance.now()) / 1000 : TIMER.left)); TIMER.ended = false; paintTimer(); }
function tickTimer() {
  const left = Math.max(0, (TIMER.endAt - performance.now()) / 1000); TIMER.left = left;
  const sec = Math.ceil(left);
  if (sec !== TIMER.lastSec) {
    TIMER.lastSec = sec;
    if (sec > 0 && S.settings.timeTick) sec <= 5 ? tone(1046, 0.09, 0.22, 'square') : tone(1500, 0.025, 0.07, 'square');
  }
  if (left <= 0) { stopTimerRun(); TIMER.ended = true; onTimeUp(); }
  paintTimer();
}
function onTimeUp() {
  if (S.settings.timeEndSound) { tone(784, 0.18, 0.3, 'triangle', 0); tone(988, 0.18, 0.3, 'triangle', 0.2); tone(1319, 0.5, 0.35, 'triangle', 0.4); }
  if (S.settings.timeStopScan && cam.scanning) pauseScan();
  toast('Hết giờ!');
  if (S.settings.timeReveal) { const { cls, q } = liveCtx(); const r = cls && q ? resultOf(cls.id, q.id) : null; if (!(r && r.revealed)) setTimeout(toggleReveal, 900); }
}
function paintTimer() {
  const el = $('#timer'), bt = $('#btnTimer');
  const on = TIMER.total > 0;
  if (bt) { bt.disabled = !on; bt.innerHTML = !on ? 'Không đếm giờ' : (TIMER.running ? 'Tạm dừng giờ' : (TIMER.ended ? 'Đếm lại' : (TIMER.left < TIMER.total ? 'Tiếp tục đếm' : `Đếm ngược ${TIMER.total}s`))) + ' <span class="kbd">T</span>'; }
  if (!el) return;
  el.hidden = !on; if (!on) return;
  const sec = Math.ceil(TIMER.left);
  $('#timerNum').textContent = sec >= 60 ? Math.floor(sec / 60) + ':' + pad2(sec % 60) : sec;
  const C = 2 * Math.PI * 19, frac = TIMER.total ? Math.max(0, Math.min(1, TIMER.left / TIMER.total)) : 0;
  const arc = $('#timerArc'); arc.style.strokeDasharray = C; arc.style.strokeDashoffset = C * (1 - frac);
  el.className = 'timer' + (TIMER.running ? ' run' : '') + (sec <= 5 && TIMER.running ? ' crit' : sec <= 10 ? ' warn' : '') + (TIMER.ended ? ' end' : '');
}
function tone(freq, dur, vol, type = 'sine', delay = 0) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime + delay, o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(audioCtx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  } catch (e) { }
}
function toggleReveal() {
  const { cls, q } = liveCtx(); if (!cls || !q) return;
  const r = resultOf(cls.id, q.id, true); r.revealed = !r.revealed; save(); updateDynamic();
  if (r.revealed && TIMER.running) pauseTimer();
  clearTimeout(cam.sumT);
  const { qi, qs, set } = liveCtx();
  if (r.revealed && S.settings.autoSummary !== false && qs.length && qi === qs.length - 1) {
    toast('Câu cuối! Hiện kết quả cả lớp sau 3 giây…');
    cam.sumT = setTimeout(() => { const c = liveCtx(); const rr = c.cls && c.q ? resultOf(c.cls.id, c.q.id) : null; if (S.ui.view === 'live' && c.qi === qi && rr && rr.revealed && !$('#modalBack')) openSummary(c.cls, c.set); }, 3000);
  }
  if (r.revealed && cam.scanning) pauseScan();
}
function clearPhoto() { if (cam.media) { cam.media = null; camPhoto.hidden = true; cam.boxes = []; drawOverlay(); updateCamUI(); } }
function simulate() {
  const { cls, q } = liveCtx(); if (!cls || !q) return;
  const studs = sortedStudents(cls); let d = 0;
  studs.forEach(s => {
    if (Math.random() < 0.12) return;
    let i = Math.floor(Math.random() * q.choices.length);
    if (isGraded(q) && Math.random() < 0.55) i = q.correct[Math.floor(Math.random() * q.correct.length)];
    d += 60 + Math.random() * 140;
    setTimeout(() => { if (liveCtx().q === q) commit(s.card, LET[i]); }, d);
  });
  toast('Đang mô phỏng câu trả lời ngẫu nhiên (chỉ để thử, có thể bấm “Làm lại câu này” để xóa).');
}
function tilePopover(tile) {
  closePop();
  const { cls, q } = liveCtx(); if (!cls || !q) return;
  const card = +tile.dataset.card; const st = cls.students.find(s => s.card === card);
  const r = resultOf(cls.id, q.id); const cur = r && r.resp[card];
  const pop = document.createElement('div'); pop.className = 'pop'; pop.id = 'pop';
  pop.innerHTML = `<div style="font-weight:700">${esc(st ? st.name : '')} <span class="hint">· thẻ ${card}</span></div>
    <div class="row">${q.choices.map((c, i) => `<button class="letter l${i}" data-pick="${LET[i]}" style="${cur === LET[i] ? 'box-shadow:0 0 0 3px var(--ink)' : ''}">${LET[i]}</button>`).join('')}</div>
    <button class="btn small" data-pick="">Xóa câu trả lời</button>`;
  document.body.appendChild(pop);
  const b = tile.getBoundingClientRect(); const pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(window.innerWidth - pw - 8, b.left + b.width / 2 - pw / 2)) + 'px';
  pop.style.top = (b.top - ph - 8 > 8 ? b.top - ph - 8 : b.bottom + 8) + 'px';
  pop.addEventListener('click', e => {
    const p = e.target.closest('[data-pick]'); if (!p) return;
    const v = p.dataset.pick;
    if (v) commit(card, v); else { const rr = resultOf(cls.id, q.id); if (rr) { delete rr.resp[card]; save(); updateDynamic(); } }
    closePop();
  });
}
function closePop() { const p = $('#pop'); if (p) p.remove(); }
document.addEventListener('mousedown', e => { if (!e.target.closest('#pop') && !e.target.closest('.tile')) closePop(); });

$('#liveClass').addEventListener('change', e => { pauseScan(); clearPhoto(); S.live.classId = e.target.value; save(); renderLive(); });
$('#liveSet').addEventListener('change', e => { pauseScan(); clearPhoto(); S.live.setId = e.target.value; S.live.qIndex = 0; save(); renderLive(); });
$('#btnScan').addEventListener('click', () => cam.scanning ? pauseScan() : startScan());
$('#btnReveal').addEventListener('click', toggleReveal);
$('#btnPrev').addEventListener('click', () => gotoQ(S.live.qIndex - 1));
function nextOrSummary() { const { cls, set, qi, qs } = liveCtx(); if (!qs.length) return; if (qi >= qs.length - 1) { if (cls && set) openSummary(cls, set); } else gotoQ(qi + 1); }
$('#btnNext').addEventListener('click', nextOrSummary);
$('#btnPhoto').addEventListener('click', () => $('#photoInput').click());
$('#btnTimer').addEventListener('click', () => toggleTimer());
$('#photoInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) scanPhoto(f).catch(err => { console.error(err); toast('Không đọc được ảnh này.', 'bad'); }); });
$('#btnDemo').addEventListener('click', simulate);
$('#btnRedo').addEventListener('click', e => armed(e.currentTarget, () => {
  const { cls, q } = liveCtx(); if (!cls || !q) return;
  if (S.results[cls.id]) delete S.results[cls.id][q.id];
  linkResetResp(cls.id, q.id);
  cam.seen.clear(); save(); renderLive(); toast('Đã xóa câu trả lời của câu này.');
}, 'Bấm lần nữa để xóa'));
function applyCamSize() {
  const v = S.ui.camSize || 'sm';
  const side = $('#side'); side.classList.remove('cam-sm', 'cam-lg', 'cam-off'); side.classList.add('cam-' + v);
  $$('.cam-size button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cam === v)));
  requestAnimationFrame(() => { fitRoster(); drawOverlay(); });
}
$$('.cam-size button').forEach(b => b.addEventListener('click', () => { S.ui.camSize = b.dataset.cam; save(); applyCamSize(); }));
/** chia ô tên để cả lớp vừa khung, không phải cuộn */
function fitRoster() {
  const el = $('#roster'); if (!el) return;
  const n = el.querySelectorAll('.tile').length;
  if (!n || window.innerWidth <= 980) { el.style.gridTemplateColumns = ''; el.style.gridAutoRows = ''; el.dataset.size = ''; return; }
  const W = el.clientWidth, H = el.clientHeight, gap = 6; if (!W || !H) return;
  let best = null;
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c), tw = (W - gap * (c - 1)) / c, th = (H - gap * (r - 1)) / r;
    if (tw < 64) break;
    const hh = Math.min(th, tw * 0.6, 70);
    if (!best || hh > best.h + 0.5) best = { c, h: hh };
  }
  if (!best) return;
  const hh = Math.max(24, Math.floor(best.h));
  el.style.gridTemplateColumns = `repeat(${best.c},minmax(0,1fr))`; el.style.gridAutoRows = hh + 'px';
  el.dataset.size = hh < 44 ? 'xs' : hh < 54 ? 'sm' : hh >= 62 ? 'lg' : 'md';
}
if (window.ResizeObserver) {
  new ResizeObserver(() => fitRoster()).observe($('#roster'));
  new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', $('.top').offsetHeight + 'px')).observe($('.top'));
}
window.addEventListener('resize', () => fitRoster());
$('#roster').addEventListener('click', e => { const t = e.target.closest('.tile'); if (t) tilePopover(t); });
$('#btnFull').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => document.body.classList.toggle('fs'));
  else document.body.classList.toggle('fs');
});
document.addEventListener('fullscreenchange', () => { document.body.classList.toggle('fs', !!document.fullscreenElement); setTimeout(drawOverlay, 60); });
document.addEventListener('keydown', e => {
  if (S.ui.view !== 'live' || $('#modalBack')) return;
  if (e.target.closest('input,textarea,select,[contenteditable]')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); cam.scanning ? pauseScan() : startScan(); }
  else if (k === 'r' || k === 'R') toggleReveal();
  else if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); nextOrSummary(); }
  else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); gotoQ(S.live.qIndex - 1); }
  else if (k === 'f' || k === 'F') $('#btnFull').click();
  else if (k === 'p' || k === 'P') $('#btnPhoto').click();
  else if (k === 't' || k === 'T') toggleTimer();
  else if (k === 'Escape') { closePop(); document.body.classList.remove('fs'); }
});

/* ================= CÂU HỎI ================= */
function renderSets() {
  const sel = getSet(S.ui.setId) || S.sets[0] || null; S.ui.setId = sel ? sel.id : null;
  $('#v-sets').innerHTML = `<div class="split">
    <aside class="list">
      <button class="btn magic" data-act="gen-open">${SPARK}Tạo câu hỏi từ tài liệu</button>
      <div class="list-head"><h2>Bộ câu hỏi</h2><button class="btn small" data-act="set-add">+ Bộ mới</button></div>
      <button class="btn small ghost" data-act="set-importfile" style="justify-self:start">Nhập bộ từ file (.json)</button>
      <ul>${S.sets.map(s => `<li><button class="li ${sel && s.id === sel.id ? 'cur' : ''}" data-act="set-pick" data-id="${s.id}"><span>${esc(s.name)}</span><small>${s.questions.length} câu</small></button></li>`).join('') || '<li class="hint">Chưa có bộ nào.</li>'}</ul>
    </aside>
    <div class="editor">${aiCard()}${sel ? setEditor(sel) : emptyState('Chưa có bộ câu hỏi', 'Mỗi bộ là một bài ôn tập hoặc kiểm tra nhanh. Có thể dán nguyên đề từ Word, hoặc bấm “Tạo câu hỏi từ tài liệu”.', 'set-add', 'Tạo bộ câu hỏi')}</div>
  </div>`;
}
function setEditor(s) {
  return `<div class="ed-head"><label class="name-field"><span>Tên bộ câu hỏi · bấm vào để sửa</span><span class="name-wrap"><input class="title-in" id="setName" data-in="set-name" value="${esc(s.name)}" placeholder="Ví dụ: Ôn tập Bài 3"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></span></label>
      <div class="ed-tools"><button class="btn" data-act="import-open">Nhập nhanh từ văn bản</button><button class="btn primary" data-act="set-play">Trình chiếu bộ này</button><button class="btn small ghost" data-act="set-export">Tải bộ (.json)</button><button class="btn small ghost" data-act="set-copy">Sao chép dạng chữ</button><button class="btn small ghost" data-act="set-dup">Nhân bản</button><button class="btn small danger-ghost" data-act="set-del">Xóa bộ</button></div></div>
    <div class="qlist">${s.questions.map((q, i) => qEditor(q, i, s.questions.length)).join('') || '<p class="empty">Bộ này chưa có câu hỏi. Thêm câu bên dưới hoặc dán cả đề bằng “Nhập nhanh từ văn bản”.</p>'}</div>
    <div class="add-row"><button class="btn primary" data-act="q-add">+ Câu trắc nghiệm A–D</button><button class="btn" data-act="q-add-tf">+ Câu Đúng/Sai</button><button class="btn" data-act="q-add-sv">+ Câu khảo sát</button></div>`;
}
function qEditor(q, i, n) {
  return `<div class="qedit" data-qid="${q.id}">
    <div class="qe-head"><span class="qe-n">Câu ${i + 1}</span><span class="qe-kind">${esc(qKind(q))}</span>${q.level ? `<span class="qe-kind">${esc(q.level)}</span>` : ''}${q.check ? `<button class="badge warn" data-act="q-checked" title="AI tự giải câu này — xem lại rồi bấm để bỏ nhãn">Cần kiểm tra · bấm khi đã xem</button>` : ''}
      <div class="qe-tools"><button class="icon" data-act="q-up" ${i === 0 ? 'disabled' : ''} aria-label="Đưa lên">↑</button><button class="icon" data-act="q-down" ${i === n - 1 ? 'disabled' : ''} aria-label="Đưa xuống">↓</button>
      <button class="btn small" data-act="q-math" title="Chèn công thức LaTeX vào ô đang gõ">∑ Công thức</button><button class="btn small" data-act="q-img">${q.img ? 'Đổi ảnh' : 'Thêm ảnh'}</button><button class="btn small" data-act="q-dup">Nhân bản</button><button class="btn small" data-act="q-play">Chiếu câu này</button><button class="btn small danger-ghost" data-act="q-del">Xóa</button></div></div>
    <textarea data-in="q-text" rows="2" placeholder="Nội dung câu hỏi" aria-label="Nội dung câu ${i + 1}">${esc(q.text)}</textarea>
    ${q.img ? `<div class="qe-img"><img src="${q.img}" alt="Ảnh câu ${i + 1}"><button class="btn small" data-act="q-img-del">Bỏ ảnh</button></div>` : ''}
    <div class="qe-choices">${q.choices.map((c, ci) => `<div class="qe-ch ${q.correct.includes(ci) ? 'is-correct' : ''}">
      <button class="letter l${ci}" data-act="q-correct" data-ci="${ci}" aria-pressed="${q.correct.includes(ci)}" title="Bấm để đánh dấu/bỏ đáp án đúng">${LET[ci]}</button>
      <input data-in="q-choice" data-ci="${ci}" value="${esc(c)}" placeholder="Lựa chọn ${LET[ci]}" aria-label="Lựa chọn ${LET[ci]}">
      ${q.choices.length > 2 ? `<button class="icon" data-act="q-ch-del" data-ci="${ci}" aria-label="Bỏ lựa chọn ${LET[ci]}">×</button>` : ''}</div>`).join('')}</div>
    <div class="qe-time"><label class="hint" for="qt-${q.id}">Thời gian trả lời</label><select id="qt-${q.id}" data-chg="q-time">${[['', `Mặc định (${+S.settings.timeDef ? S.settings.timeDef + ' giây' : 'không đếm'})`], ['0', 'Không đếm giờ'], ...[10, 15, 20, 30, 45, 60, 90, 120, 180].map(n => [String(n), n + ' giây'])].map(([v, l]) => `<option value="${v}" ${(q.time == null ? '' : String(q.time)) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <input class="qe-ex" data-in="q-explain" value="${esc(q.explain || '')}" placeholder="Giải thích ngắn (không bắt buộc) — hiện trên bảng khi công bố đáp án" aria-label="Giải thích câu ${i + 1}">
    <div class="qe-prev" data-prev ${qHasMath(q) ? '' : 'hidden'}>${qHasMath(q) ? qPreview(q) : ''}</div>
    <div class="qe-foot">${q.choices.length < 4 ? '<button class="btn small" data-act="q-ch-add">+ Thêm lựa chọn</button>' : ''}<span class="hint">Bấm vào chữ cái để đánh dấu đáp án đúng. Không đánh dấu chữ nào thì câu được tính là khảo sát ý kiến.</span><span class="hint math-hint">Công thức viết giữa hai dấu $: <code>$\\frac{1}{2}$</code> <code>$x^2-4=0$</code> <code>$\\sqrt{3}$</code> <code>$90^\\circ$</code> <code>$\\ce{H2SO4}$</code></span></div>
  </div>`;
}
const curSet = () => getSet(S.ui.setId);
const qHasMath = q => hasMath(q.text) || q.choices.some(hasMath) || hasMath(q.explain);
function qPreview(q) {
  return `<span class="lbl">Xem trước công thức</span><div class="t">${mathHTML(q.text)}</div><ol>${q.choices.map((c, ci) => `<li><span class="letter l${ci}">${LET[ci]}</span><span>${mathHTML(c)}</span></li>`).join('')}</ol>${q.explain ? `<div class="hint">Giải thích: ${mathHTML(q.explain)}</div>` : ''}`;
}
let prevTimer = null;
function refreshPrev(el) {
  const box = el.closest('.qedit'); if (!box) return;
  clearTimeout(prevTimer);
  prevTimer = setTimeout(() => { const q = qOf(box); const p = box.querySelector('[data-prev]'); if (!q || !p) return; const on = qHasMath(q); p.hidden = !on; p.innerHTML = on ? qPreview(q) : ''; }, 250);
}
let lastField = null;
document.addEventListener('focusin', e => { const f = e.target.closest('.qedit textarea, .qedit input[data-in]'); if (f) lastField = f; });
const qOf = el => { const s = curSet(); const id = el.closest('.qedit')?.dataset.qid; return s && s.questions.find(q => q.id === id); };
function parseQuestions(text) {
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const out = [];
  const optRe = /^\s*(\*?)\s*([A-Da-d])\s*[\.\)\:\-]\s*(.*?)\s*(\*?)\s*$/;
  for (const b of blocks) {
    const lines = b.split('\n').map(l => l.replace(/\*\*|__/g, '').replace(/^#+\s*/, '').trim()).filter(Boolean);
    const qLines = [], choices = [], correct = []; let ans = null, explain = '', level = '', check = false, time = null;
    for (const l of lines) {
      if (/^cần kiểm tra\s*[:\-–]\s*(có|yes|true|x)/i.test(l)) { check = true; continue; }
      const tm = l.match(/^thời gian\s*[:\-–]\s*(\d+)/i);
      if (tm) { time = +tm[1]; continue; }
      const lvm = l.match(/^mức độ\s*[:\-–]\s*(.+)$/i);
      if (lvm) { level = lvm[1].replace(/[\.\s]+$/, '').trim(); continue; }
      const ex = l.match(/^(?:giải thích|gt)\s*[:\-–]\s*(.+)$/i);
      if (ex) { explain = ex[1].trim(); continue; }
      const am = l.match(/^(?:đáp án|đ\/a|answer)\s*(?:[:\-–]\s*|\s+)(.+)$/i);
      if (am) { ans = am[1].replace(/[\.\s]+$/, '').trim(); continue; }
      const m = choices.length < 4 ? l.match(optRe) : null;
      if (m && (choices.length || qLines.length) && m[2].toUpperCase() === LET[choices.length]) {
        if (m[1] || m[4]) correct.push(choices.length);
        choices.push(m[3]); continue;
      }
      if (choices.length) { choices[choices.length - 1] += ' ' + l; continue; }
      qLines.push(l);
    }
    let qt = qLines.join('\n').replace(/^(câu\s*\d+\s*[\.\:\)]?|\d+\s*[\.\)])\s*/i, '').trim();
    if (!qt) continue;
    let ch = choices;
    if (ch.length < 2) {
      const tf = /\((đ\s*\/\s*s|đúng\s*\/\s*sai)\)\s*$/i;
      if (tf.test(qt) || (ans && /^(đ|đúng|s|sai)$/i.test(ans))) { qt = qt.replace(tf, '').trim(); ch = ['Đúng', 'Sai']; }
      else continue;
    }
    if (ans) {
      const a = ans.toUpperCase();
      if (ch.length === 2 && ch[0] === 'Đúng' && /^(Đ|ĐÚNG|S|SAI)$/.test(a)) correct.push(/^Đ/.test(a) ? 0 : 1);
      else a.split(/[\s,;]+/).forEach(x => { const i = LET.indexOf(x); if (i >= 0 && i < ch.length && !correct.includes(i)) correct.push(i); });
    }
    out.push({ id: uid(), text: qt, choices: ch, correct: correct.sort(), img: '', explain, level, check, time });
  }
  return out;
}
function openImport() {
  const back = openModal(`<h2>Nhập nhanh câu hỏi</h2>
    <p class="hint" style="margin:0">Dán đề vào ô dưới (hoặc dán nguyên đoạn JSON theo file mẫu). Mỗi câu cách nhau một dòng trống. Đánh dấu đáp án đúng bằng dấu <b>*</b> ở đầu lựa chọn, hoặc thêm dòng “Đáp án: B”.</p>
    <pre>Câu 1. Thủ đô của Việt Nam là?
A. Huế
*B. Hà Nội
C. Đà Nẵng
D. Cần Thơ

Câu 2. Nước đá nổi trên mặt nước. (Đ/S)
Đáp án: Đ

Câu 3. Em thích học nhóm hay học một mình?
A. Học nhóm
B. Học một mình</pre>
    <textarea id="importText" rows="10" placeholder="Dán câu hỏi vào đây…"></textarea>
    <div id="importPrev" class="hint">Chưa nhận ra câu nào.</div>
    <div class="add-row"><button class="btn primary" id="importGo" disabled>Thêm vào bộ</button><button class="btn" data-act="modal-close">Hủy</button></div>`);
  const ta = $('#importText', back), pv = $('#importPrev', back), go = $('#importGo', back);
  let parsed = [];
  ta.addEventListener('input', () => {
    const raw = ta.value.trim();
    if (/^(```|\{|\[)/.test(raw)) { try { const sets = parseSetJSON(raw); parsed = sets.flatMap(st => st.questions); } catch (e) { parsed = []; } }
    else parsed = parseQuestions(ta.value);
    const noAns = parsed.filter(q => !q.correct.length).length;
    pv.innerHTML = parsed.length ? `Nhận ra <b>${parsed.length}</b> câu${noAns ? ` (trong đó ${noAns} câu chưa có đáp án, sẽ tính là khảo sát)` : ''}: ` + parsed.slice(0, 6).map((q, i) => `<br>${i + 1}. ${esc(q.text.slice(0, 70))} <span style="font-family:var(--f-mono)">[${q.choices.length} lựa chọn${q.correct.length ? ', đúng: ' + q.correct.map(c => LET[c]).join(',') : ''}]</span>`).join('') + (parsed.length > 6 ? '<br>…' : '') : 'Chưa nhận ra câu nào.';
    go.disabled = !parsed.length; go.textContent = parsed.length ? `Thêm ${parsed.length} câu vào bộ` : 'Thêm vào bộ';
  });
  go.addEventListener('click', () => { const s = curSet(); if (!s) return; s.questions.push(...parsed); save(); closeModal(); renderSets(); toast(`Đã thêm ${parsed.length} câu.`); });
}
function resizeImage(file, maxSide = 900) {
  return new Promise((res, rej) => {
    const im = new Image(); im.onload = () => {
      const sc = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * sc); c.height = Math.round(im.naturalHeight * sc);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(im.src); res(c.toDataURL('image/jpeg', 0.78));
    }; im.onerror = rej; im.src = URL.createObjectURL(file);
  });
}
let imgTargetQ = null;
$('#imgInput').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f || !imgTargetQ) return;
  try { imgTargetQ.img = await resizeImage(f); save(); renderSets(); } catch (err) { toast('Không đọc được ảnh.', 'bad'); }
});

/* ================= TẠO CÂU HỎI TỪ TÀI LIỆU ================= */
const SPARK = '<svg class="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9z"/><path d="M19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z" opacity=".7"/></svg>';
const PDFJS_BASE = window.GT_PDFJS || 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const DOC_MAX = 100000;
let sampleFn;            // undefined: chưa biết · null: không có · function: gọi được Claude
async function getSample() {
  if (sampleFn !== undefined) return sampleFn;
  if (!(window.claude && typeof window.claude.use === 'function')) { sampleFn = null; return null; }
  try { sampleFn = (await window.claude.use('sample')) || null; } catch (e) { sampleFn = null; }
  return sampleFn;
}
function aiCard() {
  return `<div class="ai-card"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9z"/><path d="M19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z" opacity=".7"/></svg>
    <div class="txt"><b>Tạo câu hỏi tự động từ tài liệu</b><span>Tải lên giáo án, bài giảng (Word, PowerPoint, PDF) hoặc dán nội dung — chọn số câu, mức độ, rồi để AI soạn sẵn đáp án và giải thích.</span></div>
    <button class="btn chalk" data-act="gen-open">${SPARK}Bắt đầu tạo</button></div>`;
}
function copyText(text, okMsg) {
  const fallback = () => {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { }
    ta.remove(); toast(ok ? okMsg : 'Trình duyệt chặn sao chép. Hãy chọn và sao chép thủ công.', ok ? '' : 'bad');
  };
  try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(() => toast(okMsg), fallback); return; } } catch (e) { }
  fallback();
}
function setToText(set) {
  return set.questions.map((q, i) => {
    let t = `Câu ${i + 1}. ${q.text.replace(/\n+/g, ' ')}\n` + q.choices.map((c, ci) => `${q.correct.includes(ci) ? '*' : ''}${LET[ci]}. ${c}`).join('\n');
    if (q.explain) t += `\nGiải thích: ${q.explain}`;
    if (q.time != null) t += `\nThời gian: ${q.time}`;
    return t;
  }).join('\n\n');
}

/* --- đọc file --- */
async function zipEntries(buf) {
  const dv = new DataView(buf); let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Không phải file Office hợp lệ.');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder(); const list = [];
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    list.push({ name: dec.decode(new Uint8Array(buf, p + 46, nlen)), method, csize, lho });
    p += 46 + nlen + xlen + clen;
  }
  const read = async e => {
    const ln = dv.getUint16(e.lho + 26, true), lx = dv.getUint16(e.lho + 28, true);
    const data = new Uint8Array(buf, e.lho + 30 + ln + lx, e.csize);
    if (e.method === 0) return dec.decode(data);
    if (typeof DecompressionStream === 'undefined') throw new Error('Trình duyệt quá cũ để đọc file này. Hãy cập nhật Chrome/Edge.');
    return await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  };
  return { list, read };
}
function xmlParas(xml, ns, pTag, tTag) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml'); const out = [];
  for (const p of doc.getElementsByTagNameNS(ns, pTag)) {
    let t = '';
    for (const n of p.getElementsByTagNameNS(ns, '*')) { if (n.localName === tTag) t += n.textContent; else if (n.localName === 'tab') t += '\t'; else if (n.localName === 'br') t += '\n'; }
    if (t.trim()) out.push(t.trim());
  }
  return out;
}
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Không tải được bộ đọc PDF (cần kết nối mạng).')); document.head.appendChild(s); }); }
async function ensurePdf() {
  const inline = id => { const src = document.getElementById(id); if (!src) return false; const sc = document.createElement('script'); sc.textContent = src.textContent; document.head.appendChild(sc); return true; };
  if (!window.pdfjsLib && !inline('src-pdfjs')) await loadScript(PDFJS_BASE + 'pdf.min.js');
  if (!window.pdfjsWorker && !inline('src-pdfworker')) await loadScript(PDFJS_BASE + 'pdf.worker.min.js');
}
async function pdfImages(buf, max = 5) {
  await ensurePdf();
  const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  const out = [];
  for (let i = 1; i <= Math.min(pdf.numPages, max); i++) {
    const pg = await pdf.getPage(i); const v0 = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale: Math.min(2.2, 1600 / Math.max(v0.width, v0.height)) });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: cx, viewport: vp }).promise;
    out.push(await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85)));
  }
  return out;
}
async function pdfText(buf) {
  await ensurePdf();
  const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    pages.push(tc.items.map(it => (it.str || '') + (it.hasEOL ? '\n' : '')).join('').replace(/[ \t]+\n/g, '\n').trim());
    if (pages.join('\n').length > DOC_MAX * 1.2) break;
  }
  return pages.join('\n\n');
}
async function readDoc(file) {
  const name = file.name || 'tài liệu'; const ext = (name.split('.').pop() || '').toLowerCase();
  if (/^image\//.test(file.type) || ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return { kind: 'image', name };
  if (ext === 'doc' || ext === 'ppt') throw new Error(`File .${ext} kiểu cũ: mở bằng Office rồi “Lưu thành” .${ext}x, hoặc dán nội dung vào ô bên dưới.`);
  if (['txt', 'md', 'csv'].includes(ext) || file.type.startsWith('text/')) return { kind: 'text', name, text: await file.text() };
  const buf = await file.arrayBuffer();
  if (ext === 'pdf') {
    const t = await pdfText(buf.slice(0));
    if (t.replace(/\s/g, '').length < 40) return { kind: 'pdfscan', name, buf };
    return { kind: 'text', name, text: t };
  }
  if (ext === 'docx') {
    const z = await zipEntries(buf); const e = z.list.find(x => x.name === 'word/document.xml'); if (!e) throw new Error('Không tìm thấy nội dung trong file Word.');
    return { kind: 'text', name, text: xmlParas(await z.read(e), 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'p', 't').join('\n') };
  }
  if (ext === 'pptx') {
    const z = await zipEntries(buf);
    const slides = z.list.filter(x => /^ppt\/slides\/slide\d+\.xml$/.test(x.name)).sort((a, b) => parseInt(a.name.match(/\d+/)[0]) - parseInt(b.name.match(/\d+/)[0]));
    const parts = [];
    for (const [i, sl] of slides.entries()) { const ps = xmlParas(await z.read(sl), 'http://schemas.openxmlformats.org/drawingml/2006/main', 'p', 't'); if (ps.length) parts.push(`[Trang chiếu ${i + 1}]\n` + ps.join('\n')); }
    return { kind: 'text', name, text: parts.join('\n\n') };
  }
  throw new Error('Chưa hỗ trợ loại file này. Dùng .docx, .pptx, .pdf, .txt hoặc dán nội dung.');
}
function shrinkImage(file, maxSide = 1600) {
  return new Promise((res, rej) => {
    const im = new Image(); im.onload = () => {
      const sc = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * sc); c.height = Math.round(im.naturalHeight * sc);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(im.src);
      c.toBlob(b => b ? res(b) : rej(new Error('ảnh')), 'image/jpeg', 0.85);
    }; im.onerror = rej; im.src = URL.createObjectURL(file);
  });
}

/* --- lệnh cho Claude --- */
const GEN = { docName: '', images: [], results: [], busy: false, ctl: null, opts: { mode: 'new', count: 10, types: 'mc', levels: ['Nhận biết', 'Thông hiểu'], grade: '', extra: '' }, target: '' };
function genPrompt(mode, text) {
  const o = GEN.opts;
  const typeTxt = { mc: 'Tất cả là câu trắc nghiệm có đúng 4 lựa chọn A, B, C, D và chỉ 1 đáp án đúng.', tf: 'Tất cả là câu Đúng/Sai (một nhận định, 2 lựa chọn: Đúng, Sai).', mix: 'Khoảng 3/4 là câu trắc nghiệm 4 lựa chọn A, B, C, D (1 đáp án đúng), còn lại là câu Đúng/Sai.' }[o.types];
  const lv = o.levels.length ? o.levels.join(', ') : 'Nhận biết, Thông hiểu';
  const rules = `Bạn là giáo viên giỏi ở Việt Nam, đang soạn câu hỏi kiểm tra nhanh trên lớp. Học sinh trả lời bằng cách giơ thẻ, chỉ chọn được A, B, C hoặc D.
${o.mode === 'extract'
  ? `NHIỆM VỤ: Lấy các câu hỏi, bài tập CÓ SẴN trong tài liệu${GEN.images.length ? ' (và ảnh đính kèm)' : ''} (tối đa ${o.count} câu, theo thứ tự trong tài liệu) và chuyển thành câu hỏi chọn A, B, C, D. Giữ nguyên ý, số liệu và các phương án của đề gốc, chỉ sửa lỗi chính tả do trích xuất. Câu tự luận ngắn có đáp số rõ ràng thì chuyển thành trắc nghiệm 4 phương án (phương án nhiễu là các lỗi sai thường gặp); câu nhận định thì chuyển thành Đúng/Sai. Bỏ qua câu cần hình vẽ mà không mô tả được bằng lời. Nếu tài liệu có đáp án thì dùng đáp án đó; nếu KHÔNG có, tự giải thật cẩn thận và thêm dòng "Cần kiểm tra: có" vào câu đó.`
  : `NHIỆM VỤ: Dựa CHỈ vào tài liệu bên dưới${GEN.images.length ? ' (và ảnh đính kèm)' : ''}, hãy soạn đúng ${o.count} câu hỏi MỚI, bám sát nội dung tài liệu. Câu nào bạn chưa chắc chắn về đáp án thì thêm dòng "Cần kiểm tra: có".`}
Yêu cầu:
- Viết bằng tiếng Việt chuẩn, ngắn gọn, rõ ràng${o.grade ? `, phù hợp học sinh ${o.grade}` : ''}.
- ${o.mode === 'extract' ? 'Ưu tiên giữ dạng câu của đề gốc. ' : ''}${typeTxt}
- Mức độ nhận thức: ${lv} (phân bố đều giữa các mức đã chọn).
- Câu hỏi tối đa khoảng 200 ký tự, mỗi lựa chọn tối đa khoảng 80 ký tự để chiếu rõ trên màn hình.
- Phương án nhiễu hợp lý, cùng kiểu và độ dài gần bằng đáp án đúng; không dùng “Tất cả các đáp án trên”/“Cả A và B”.
- Vị trí đáp án đúng phân bố đều giữa A, B, C, D; không lặp lại câu; không hỏi nội dung ngoài tài liệu.
- Mỗi câu có một câu giải thích ngắn (dưới 160 ký tự) vì sao đáp án đúng.
- CÔNG THỨC: mọi công thức, biểu thức, phân số, lũy thừa, căn, góc, đơn vị có chỉ số… viết bằng LaTeX chuẩn đặt giữa hai dấu $ (cả trong câu hỏi, lựa chọn và giải thích). Ví dụ: $\\frac{3}{4}$, $x^2 - 5x + 6 = 0$, $\\sqrt{2}$, $\\widehat{ABC} = 90^\\circ$, $v = \\frac{s}{t}$, $10\\ \\text{m/s}^2$, $\\Delta ABC \\sim \\Delta DEF$. Công thức và phương trình hóa học dùng $\\ce{...}$, ví dụ $\\ce{H2SO4}$, $\\ce{2H2 + O2 -> 2H2O}$. Không dùng $$, không viết công thức bằng ký tự thường như x^2 hay sqrt(2) bên ngoài dấu $; số đơn giản và chữ thường thì không cần dấu $.${o.extra ? `\n- Yêu cầu thêm của giáo viên: ${o.extra}` : ''}`;
  const fmt = mode === 'json'
    ? `Chỉ trả về một mảng JSON, mỗi phần tử có dạng:
{"text": "nội dung câu hỏi", "choices": ["lựa chọn A", "lựa chọn B", "lựa chọn C", "lựa chọn D"], "correct": 1, "level": "Thông hiểu", "explain": "giải thích ngắn"}
Trong đó "correct" là số thứ tự đáp án đúng (0 = A, 1 = B, 2 = C, 3 = D). Câu Đúng/Sai dùng "choices": ["Đúng", "Sai"]. Không ghi chữ cái A./B. ở đầu lựa chọn.`
    : `Trả về đúng theo mẫu dưới đây, mỗi câu cách nhau một dòng trống, không thêm lời dẫn hay lời kết, không in đậm. Đánh dấu * ở đầu lựa chọn đúng:

Câu 1. Nghiệm của phương trình $2x - 6 = 0$ là
A. $x = -3$
*B. $x = 3$
C. $x = 6$
D. $x = \\frac{1}{3}$
Mức độ: Nhận biết
Giải thích: $2x = 6$ nên $x = 3$.
Cần kiểm tra: có   ← (chỉ ghi dòng này khi bạn tự giải vì tài liệu không có đáp án, hoặc chưa chắc chắn)

Câu 2. Một nhận định cần xét đúng hay sai. (Đ/S)
Đáp án: Đ
Mức độ: Thông hiểu
Giải thích: Một câu ngắn.

(Hai câu trên chỉ là mẫu định dạng; hãy soạn câu hỏi từ tài liệu bên dưới.)`;
  return `${rules}\n\n${fmt}\n\nTÀI LIỆU${GEN.docName ? ` (${GEN.docName})` : ''}:\n<<<\n${text.slice(0, DOC_MAX)}\n>>>`;
}
function cleanGen(arr) {
  const list = Array.isArray(arr) ? arr : (arr && (arr.questions || arr.items)) || [];
  return list.map(x => {
    if (!x || !x.text) return null;
    let ch = (x.choices || x.options || []).map(c => String(c).replace(/^\s*[A-Da-d]\s*[\.\):]\s+/, '').trim()).filter(Boolean).slice(0, 4);
    if (ch.length < 2) return null;
    let c = x.correct ?? x.answer;
    if (Array.isArray(c)) c = c[0];
    if (typeof c === 'string') c = /^\d+$/.test(c.trim()) ? +c : LET.indexOf(c.trim().toUpperCase().charAt(0));
    c = Number.isInteger(c) && c >= 0 && c < ch.length ? [c] : [];
    return { id: uid(), text: String(x.text).trim(), choices: ch, correct: c, img: '', explain: x.explain ? String(x.explain).trim() : '', level: x.level ? String(x.level).trim() : '' };
  }).filter(Boolean);
}

/* --- Gemini (khóa API miễn phí của Google) --- */
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
function gemErr(status, j) {
  const msg = (j && j.error && j.error.message) || '';
  const e = new Error(status === 400 && /api key/i.test(msg) ? 'Khóa Gemini không đúng. Kiểm tra lại khóa trong Cài đặt.'
    : status === 403 ? 'Khóa Gemini chưa được phép dùng (403). Tạo khóa mới tại aistudio.google.com/apikey.'
    : status === 429 ? 'Gemini báo đã dùng hết lượt miễn phí tạm thời (429). Đợi 1–2 phút rồi bấm lại; nếu vẫn lỗi thì thử lại vào ngày mai.'
    : status === 404 ? 'Mô hình Gemini không còn dùng được.' : ('Gemini báo lỗi ' + status + (msg ? ': ' + msg : '')));
  e.status = status; return e;
}
async function geminiModels(key) {
  let r; try { r = await fetch(`${GEMINI}/models?pageSize=200&key=${encodeURIComponent(key)}`); } catch (e) { throw new Error('Không kết nối được Gemini. Kiểm tra mạng Internet.'); }
  const j = await r.json().catch(() => ({})); if (!r.ok) throw gemErr(r.status, j);
  return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''));
}
/** chọn mô hình Flash mới nhất (ưu tiên bản ổn định, không phải lite) */
function pickGemini(list) {
  const score = id => { const m = id.match(/^gemini-(\d+(?:\.\d+)?)-flash(-lite)?(-preview[\w.-]*|-\d{3}|-latest)?$/); if (!m) return -1; return parseFloat(m[1]) * 10 - (m[2] ? 4 : 0) - (m[3] && /preview/.test(m[3]) ? 0.5 : 0); };
  let best = null, bs = -1; list.forEach(id => { const s = score(id); if (s > bs) { bs = s; best = id; } });
  return best || (list.includes('gemini-flash-latest') ? 'gemini-flash-latest' : list.find(x => /flash/.test(x)) || list[0] || null);
}
async function blobB64(b) { const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
async function geminiGenerate(prompt, images, { signal, onText } = {}) {
  const key = (S.settings.geminiKey || '').trim(); if (!key) throw new Error('Chưa có khóa Gemini. Vào Cài đặt → Trợ lý AI để dán khóa.');
  let model = S.settings.geminiModel;
  if (!model) { model = pickGemini(await geminiModels(key)); if (!model) throw new Error('Khóa này chưa dùng được mô hình Gemini nào.'); S.settings.geminiModel = model; save(); }
  const parts = [{ text: prompt }];
  for (const b of images || []) parts.push({ inline_data: { mime_type: b.type || 'image/jpeg', data: await blobB64(b) } });
  const body = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.5 } });
  const call = async m => {
    let r;
    try { r = await fetch(`${GEMINI}/models/${encodeURIComponent(m)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal }); }
    catch (e) { if (e && e.name === 'AbortError') throw e; throw new Error('Không kết nối được Gemini. Kiểm tra mạng Internet.'); }
    if (!r.ok) { let j = {}; try { j = await r.json(); } catch (e) { } throw gemErr(r.status, j); }
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '', text = '', block = '';
    for (;;) {
      const { done, value } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        let j; try { j = JSON.parse(line.slice(5)); } catch (e) { continue; }
        if (j.promptFeedback && j.promptFeedback.blockReason) block = j.promptFeedback.blockReason;
        const ps = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
        for (const x of ps) if (x.text && !x.thought) text += x.text;
        if (onText) onText({ text });
      }
    }
    if (!text && block) throw new Error('Gemini từ chối xử lý nội dung này (' + block + ').');
    return text;
  };
  try { return await call(model); }
  catch (e) {
    if (e.status === 404) { const m2 = pickGemini((await geminiModels(key)).filter(x => x !== model)); if (!m2) throw e; S.settings.geminiModel = m2; save(); return await call(m2); }
    throw e;
  }
}

/* --- giao diện --- */
async function openGen() {
  const sample = (window.claude && typeof window.claude.use === 'function') ? await getSample() : null;
  let gem = !sample && !!(S.settings.geminiKey || '').trim();
  let canImg = gem;
  if (sample && sample.limits) { try { canImg = !!(await sample.limits()).images; } catch (e) { } }
  GEN.results = []; GEN.images = []; GEN.docName = '';
  const cur = curSet();
  const o = GEN.opts;
  const chips = (key, items, multi) => `<div class="chips" data-gkey="${key}" ${multi ? 'data-multi="1"' : ''}>${items.map(([v, l]) => `<button class="chip" data-v="${v}" aria-pressed="${multi ? o[key].includes(v) : String(o[key]) === String(v)}">${l}</button>`).join('')}</div>`;
  const back = openModal(`<div class="modal-head">${SPARK.replace('class="ico"', 'class="ico" style="width:28px;height:28px;color:var(--b)"')}<h2>Tạo câu hỏi từ tài liệu</h2><button class="icon" data-act="modal-close" aria-label="Đóng">×</button></div>
    <div class="gen-grid">
      <div style="display:grid;gap:10px;align-content:start;min-width:0">
        <div class="eyebrow">1 · Tài liệu bài học</div>
        <div class="drop" id="genDrop" tabindex="0" role="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 17v-6M9 14l3-3 3 3"/></svg>
          <b>Chọn file hoặc kéo thả vào đây</b><span class="hint">Word (.docx) · PowerPoint (.pptx) · PDF · .txt${canImg ? ' · ảnh chụp trang sách' : ''}</span></div>
        <div id="genDoc"></div>
        <label class="field">Nội dung sẽ dùng để tạo câu hỏi (có thể dán hoặc sửa trực tiếp)<textarea id="genText" rows="9" placeholder="Dán nội dung bài học, giáo án, đoạn văn bản… vào đây"></textarea></label>
      </div>
      <div style="display:grid;gap:14px;align-content:start;min-width:0">
        <div class="eyebrow">2 · Yêu cầu</div>
        <div class="field" style="display:grid;gap:6px"><span>Cách tạo</span>${chips('mode', [['new', 'Soạn câu mới từ nội dung'], ['extract', 'Lấy câu hỏi có sẵn trong tệp']])}</div>
        <div class="field" style="display:grid;gap:6px"><span>Số câu (tối đa)</span>${chips('count', [[5, '5 câu'], [10, '10 câu'], [15, '15 câu'], [20, '20 câu']])}</div>
        <div class="field" style="display:grid;gap:6px"><span>Loại câu</span>${chips('types', [['mc', 'Trắc nghiệm A–D'], ['tf', 'Đúng / Sai'], ['mix', 'Trộn cả hai']])}</div>
        <div class="field" style="display:grid;gap:6px"><span>Mức độ (chọn được nhiều)</span>${chips('levels', [['Nhận biết', 'Nhận biết'], ['Thông hiểu', 'Thông hiểu'], ['Vận dụng', 'Vận dụng']], true)}</div>
        <div class="opt-grid">
          <label class="field">Khối lớp<input id="genGrade" value="${esc(o.grade)}" placeholder="VD: lớp 7"></label>
          <label class="field">Thêm vào<select id="genTarget">${S.sets.map(s => `<option value="${s.id}" ${cur && s.id === cur.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}<option value="__new" ${cur ? '' : 'selected'}>+ Bộ câu hỏi mới</option></select></label>
        </div>
        <label class="field">Yêu cầu thêm (không bắt buộc)<input id="genExtra" value="${esc(o.extra)}" placeholder="VD: tập trung phần 2, có câu tính toán"></label>
      </div>
    </div>
    <div id="genAction"></div>
    <div id="genOut" style="display:grid;gap:12px"></div>`);
  back.querySelector('.modal').classList.add('wide');
  const ta = $('#genText', back), docBox = $('#genDoc', back), drop = $('#genDrop', back);
  // chips
  back.addEventListener('click', e => {
    const ch = e.target.closest('.chip'); if (!ch) return;
    const box = ch.parentElement, key = box.dataset.gkey;
    if (box.dataset.multi) { const v = ch.dataset.v; o[key] = o[key].includes(v) ? o[key].filter(x => x !== v) : [...o[key], v]; ch.setAttribute('aria-pressed', String(o[key].includes(v))); }
    else { o[key] = key === 'count' ? +ch.dataset.v : ch.dataset.v; $$('.chip', box).forEach(b => b.setAttribute('aria-pressed', String(b === ch))); }
    save();
  });
  $('#genGrade', back).addEventListener('input', e => { o.grade = e.target.value; save(); });
  $('#genExtra', back).addEventListener('input', e => { o.extra = e.target.value; save(); });
  // file
  const takeFile = async f => {
    if (!f) return;
    docBox.innerHTML = `<div class="gen-status"><span class="spinner"></span>Đang đọc “${esc(f.name)}”…</div>`;
    try {
      const d = await readDoc(f);
      if (d.kind === 'image') {
        if (!canImg) throw new Error('Ảnh chỉ dùng được ở bản mở trên Claude. Ở đây hãy dùng file Word/PDF hoặc dán nội dung.');
        if (GEN.images.length >= 5) throw new Error('Tối đa 5 ảnh.');
        GEN.images.push(await shrinkImage(f)); GEN.docName = GEN.docName || f.name;
        docBox.innerHTML = `<div class="docinfo">✓ Đã thêm ${GEN.images.length} ảnh — Claude sẽ đọc chữ trong ảnh. Có thể thêm ảnh khác.</div>`;
        return;
      }
      if (d.kind === 'pdfscan') {
        if (!canImg) throw new Error('PDF này là bản scan (ảnh) nên không có chữ để đọc. Mở bản Giơ Thẻ trên Claude để AI đọc trực tiếp từ ảnh, hoặc dán nội dung vào ô bên dưới.');
        docBox.innerHTML = `<div class="gen-status"><span class="spinner"></span>PDF là bản scan — đang chuyển các trang thành ảnh cho AI đọc…</div>`;
        const imgs = await pdfImages(d.buf, 5);
        GEN.images = imgs; GEN.docName = d.name;
        docBox.innerHTML = `<div class="docinfo">✓ “${esc(d.name)}” là bản scan · AI sẽ đọc trực tiếp ${imgs.length} trang đầu</div>`;
        updateGenAction(); return;
      }
      const text = d.text.trim();
      if (!text) throw new Error('File không có chữ để đọc.');
      GEN.docName = d.name; ta.value = text;
      docBox.innerHTML = `<div class="docinfo">✓ Đã đọc “${esc(d.name)}” · ${text.length.toLocaleString('vi-VN')} ký tự${text.length > DOC_MAX ? ` — chỉ dùng ${DOC_MAX.toLocaleString('vi-VN')} ký tự đầu` : ''}</div>`;
      updateGenAction();
    } catch (err) { docBox.innerHTML = `<div class="docinfo err">${esc(err.message || String(err))}</div>`; }
  };
  drop.addEventListener('click', () => $('#docInput').click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#docInput').click(); } });
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); takeFile(e.dataTransfer.files[0]); });
  $('#docInput').onchange = e => { const f = e.target.files[0]; e.target.value = ''; takeFile(f); };
  ta.addEventListener('input', () => updateGenAction());

  function updateGenAction() {
    const box = $('#genAction', back); if (!box) return;
    if (sample || gem) {
      if (!box.dataset.ready) {
        box.dataset.ready = '1';
        box.innerHTML = `<div class="add-row" style="align-items:center"><button class="btn magic" id="genGo" style="padding:12px 20px;font-size:16px">${SPARK}Tạo câu hỏi bằng ${sample ? 'Claude' : 'Gemini'}</button><button class="btn" id="genStop" hidden>Dừng</button><span class="hint">${sample ? 'Dùng lượt Claude trong tài khoản của bạn. Lần đầu sẽ được hỏi cho phép.' : 'Dùng khóa Gemini trong Cài đặt' + (S.settings.geminiModel ? ' · ' + esc(S.settings.geminiModel) : '') + '. Nội dung tài liệu được gửi tới Google để soạn câu hỏi.'}</span></div>`;
        $('#genGo', back).addEventListener('click', runGen);
        $('#genStop', back).addEventListener('click', () => GEN.ctl && GEN.ctl.abort());
      }
      return;
    }
    if (!box.dataset.ready) {
      box.dataset.ready = '1';
      box.innerHTML = `<div class="gem-setup">
        <div style="display:flex;gap:10px;align-items:center"><svg viewBox="0 0 24 24" width="26" height="26" fill="var(--brand)" aria-hidden="true"><path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9z"/></svg><b style="font-size:16px">Để AI tự soạn câu hỏi ngay tại đây: kết nối Gemini (miễn phí)</b></div>
        <ol class="steps" style="padding-left:20px"><li>Mở <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener"><b>aistudio.google.com/apikey</b></a>, đăng nhập Google, bấm <b>“Create API key”</b> (Tạo khóa API).</li><li>Sao chép khóa (dạng <code>AIza…</code>) và dán vào ô dưới, bấm <b>Lưu khóa</b>. Chỉ cần làm một lần.</li></ol>
        <div class="add-row"><input id="gemKeyIn" type="password" placeholder="Dán khóa Gemini (AIza…)" style="flex:1;min-width:220px" autocomplete="off"><button class="btn primary" id="gemKeySave">Lưu khóa</button></div>
        <span class="hint">Khóa chỉ lưu trong trình duyệt của máy này. Khi tạo câu hỏi, nội dung tài liệu được gửi tới Google Gemini.</span>
      </div>
      <details class="alt-steps"><summary>Hoặc không dùng khóa: sao chép lệnh sang Claude / AI khác</summary>
      <div class="steps-box">
        <div><span class="n">1</span><b>Sao chép lệnh</b> — gồm yêu cầu và nội dung tài liệu. <button class="btn magic small" id="genCopy" style="margin-left:6px">${SPARK}Sao chép lệnh</button></div>
        <div><span class="n">2</span>Mở <a href="https://claude.ai/new" target="_blank" rel="noopener">Claude</a> (hoặc trợ lý AI khác), dán lệnh và gửi.</div>
        <div><span class="n">3</span>Sao chép toàn bộ câu trả lời và dán vào ô dưới — câu hỏi sẽ hiện ra để chọn.</div>
        <textarea id="genPaste" rows="5" placeholder="Dán câu trả lời của AI vào đây…"></textarea>
</div></details>`;
      $('#gemKeySave', back).addEventListener('click', async () => {
        const k = $('#gemKeyIn', back).value.trim(); if (!k) { toast('Hãy dán khóa Gemini.', 'bad'); return; }
        const btn = $('#gemKeySave', back); btn.disabled = true; btn.textContent = 'Đang kiểm tra…';
        try { const list = await geminiModels(k); const m = pickGemini(list); if (!m) throw new Error('Khóa này chưa dùng được mô hình Gemini nào.'); S.settings.geminiKey = k; S.settings.geminiModel = m; save(); toast('Đã kết nối Gemini (' + m + ').'); gem = true; canImg = true; box.dataset.ready = ''; updateGenAction(); }
        catch (e) { toast(e.message, 'bad'); btn.disabled = false; btn.textContent = 'Lưu khóa'; }
      });
      $('#genCopy', back).addEventListener('click', () => {
        const t = ta.value.trim(); if (t.length < 80) { toast('Hãy chọn file hoặc dán nội dung bài học trước (ít nhất vài câu).', 'bad'); return; }
        copyText(genPrompt('text', t), 'Đã sao chép lệnh. Giờ dán vào Claude và gửi.');
      });
      $('#genPaste', back).addEventListener('input', e => { GEN.results = parseQuestions(e.target.value); renderGenOut(); });
    }
  }
  async function runGen() {
    const t = ta.value.trim();
    if (t.length < 80 && !GEN.images.length) { toast('Hãy chọn file hoặc dán nội dung bài học trước (ít nhất vài câu).', 'bad'); return; }
    if (!o.levels.length) o.levels = ['Nhận biết', 'Thông hiểu'];
    const go = $('#genGo', back), stop = $('#genStop', back), out = $('#genOut', back);
    GEN.ctl = new AbortController(); go.disabled = true; stop.hidden = false;
    out.innerHTML = `<div class="gen-status"><span class="spinner"></span><span id="genProg">${sample ? 'Claude' : 'Gemini'} đang đọc tài liệu và soạn câu hỏi… (thường mất 20–60 giây)</span></div>`;
    try {
      const opts = { signal: GEN.ctl.signal, modelTier: 'default', cache: false, onText: ({ text }) => { const n = (text.match(/^\s*\**\s*câu\s*\d+/gim) || []).length; const p = $('#genProg', back); if (p) p.textContent = `Đang soạn… đã có ${Math.min(n, o.count)}/${o.count} câu`; } };
      if (GEN.images.length) opts.images = GEN.images;
      const prompt = genPrompt('text', t || '(Xem nội dung trong ảnh đính kèm.)');
      let text = '';
      if (sample) text = (await sample(prompt, opts)).text || '';
      else text = await geminiGenerate(prompt, GEN.images, { signal: GEN.ctl.signal, onText: opts.onText });
      GEN.results = parseQuestions(text);
      if (!GEN.results.length) throw { code: 'empty' };
      renderGenOut();
    } catch (e) {
      if (e && e.name === 'AbortError') e = { code: 'cancelled' };
      const msg = { not_granted: 'Trang chưa được phép dùng Claude. Hãy cho phép khi được hỏi, hoặc dùng cách sao chép lệnh.', rate_limited: 'Claude đang bận. Đợi một lát rồi bấm lại.', cancelled: 'Đã dừng.', invalid_json: 'Câu trả lời chưa đúng định dạng. Bấm “Tạo câu hỏi” lần nữa.', empty: 'Không nhận được câu hỏi nào. Thử lại hoặc bổ sung nội dung tài liệu.', images_unavailable: 'Không gửi được ảnh. Hãy dùng file chữ hoặc dán nội dung.' }[e && e.code] || ('Không tạo được câu hỏi: ' + ((e && e.message) || 'lỗi không rõ'));
      out.innerHTML = `<div class="docinfo err">${esc(msg)}</div>`;
    } finally { go.disabled = false; stop.hidden = true; GEN.ctl = null; }
  }
  function renderGenOut() {
    const out = $('#genOut', back); if (!out) return;
    const R = GEN.results;
    if (!R.length) { out.innerHTML = sample ? '' : ($('#genPaste', back) && $('#genPaste', back).value.trim() ? '<div class="docinfo err">Chưa nhận ra câu hỏi nào. Kiểm tra lại câu trả lời đã dán (mỗi câu có A., B., … và dấu * ở đáp án đúng).</div>' : ''); return; }
    out.innerHTML = `<div class="eyebrow">3 · Chọn câu muốn dùng</div>
      <div class="note-ai">AI tạo được <b>${R.length}</b> câu${R.filter(q => q.check).length ? `, trong đó <b>${R.filter(q => q.check).length}</b> câu AI tự giải (nhãn “Cần kiểm tra”)` : ''}. Đọc kĩ từng câu: bỏ chọn câu chưa đạt; đáp án sai thì bấm vào chữ cái đúng để sửa.</div>
      <div class="gen-list">${R.map((q, i) => `<div class="gq" data-i="${i}"><input type="checkbox" checked data-gi="${i}" aria-label="Giữ câu ${i + 1}"><div style="min-width:0"><div class="gtext">${i + 1}. ${mathHTML(q.text)} ${q.level ? `<span class="badge">${esc(q.level)}</span>` : ''}${q.check ? '<span class="badge warn">Cần kiểm tra</span>' : ''}</div>
        <ol>${q.choices.map((c, ci) => `<li class="${q.correct.includes(ci) ? 'ok' : ''}"><button class="letter l${ci}" data-fix="${i}:${ci}" title="Đặt ${LET[ci]} là đáp án đúng">${LET[ci]}</button><span>${mathHTML(c)}</span></li>`).join('')}</ol>
        ${q.explain ? `<div class="gex">Giải thích: ${mathHTML(q.explain)}</div>` : ''}${q.correct.length ? '' : '<div class="gex" style="color:var(--bad)">Chưa có đáp án — bấm vào chữ cái đúng, nếu không sẽ tính là câu khảo sát.</div>'}</div></div>`).join('')}</div>
      <div class="add-row" style="align-items:center"><button class="btn primary" id="genAdd" style="padding:12px 20px">Thêm ${R.length} câu đã chọn</button><span class="hint">Câu hỏi được thêm vào cuối bộ; có thể sửa từng câu sau đó.</span></div>`;
    const btn = $('#genAdd', out);
    out.onclick = e => {
      const f = e.target.closest('[data-fix]'); if (!f) return;
      const [qi, ci] = f.dataset.fix.split(':').map(Number); const q = GEN.results[qi];
      q.correct = [ci]; q.check = false;
      const card = f.closest('.gq'); $$('li', card).forEach((li, k) => li.classList.toggle('ok', k === ci));
      const w = card.querySelector('.badge.warn'); if (w) w.remove();
    };
    const count = () => $$('input[data-gi]', out).filter(c => c.checked).length;
    out.addEventListener('change', e => { const c = e.target.closest('input[data-gi]'); if (!c) return; c.closest('.gq').classList.toggle('off', !c.checked); const n = count(); btn.textContent = `Thêm ${n} câu đã chọn`; btn.disabled = !n; });
    btn.addEventListener('click', () => {
      const picked = $$('input[data-gi]', out).filter(c => c.checked).map(c => GEN.results[+c.dataset.gi]);
      let tg = $('#genTarget', back).value, set = getSet(tg);
      if (!set) { set = { id: uid(), name: GEN.docName ? 'Câu hỏi: ' + GEN.docName.replace(/\.[^.]+$/, '') : 'Bộ câu hỏi mới', questions: [] }; S.sets.push(set); }
      set.questions.push(...picked.map(q => ({ ...q, id: uid() })));
      S.ui.setId = set.id; save(); closeModal(); show('sets');
      toast(`Đã thêm ${picked.length} câu vào “${set.name}”. Xem lại rồi bấm “Trình chiếu bộ này”.`);
    });
  }
  updateGenAction();
}
getSample();


/* ================= LỚP HỌC ================= */
function renderClasses() {
  const sel = getClass(S.ui.classId) || S.classes[0] || null; S.ui.classId = sel ? sel.id : null;
  $('#v-classes').innerHTML = `<div class="split">
    <aside class="list">
      <div class="list-head"><h2>Lớp học</h2><button class="btn small" data-act="cls-add">+ Lớp mới</button></div>
      <ul>${S.classes.map(c => `<li><button class="li ${sel && c.id === sel.id ? 'cur' : ''}" data-act="cls-pick" data-id="${c.id}"><span>${esc(c.name)}</span><small>${c.students.length} HS</small></button></li>`).join('') || '<li class="hint">Chưa có lớp nào.</li>'}</ul>
    </aside>
    <div class="editor">${sel ? classEditor(sel) : emptyState('Chưa có lớp học', 'Tạo lớp rồi dán danh sách tên từ Excel hoặc Word — mỗi dòng một em.', 'cls-add', 'Tạo lớp học')}</div>
  </div>`;
}
function classEditor(c) {
  const counts = {}; c.students.forEach(s => counts[s.card] = (counts[s.card] || 0) + 1);
  const dups = Object.keys(counts).filter(k => counts[k] > 1);
  const bad = c.students.filter(s => s.card < 1 || s.card > MAXCARD);
  return `<div class="ed-head"><label class="name-field"><span>Tên lớp · bấm vào để sửa</span><span class="name-wrap"><input class="title-in" id="clsName" data-in="cls-name" value="${esc(c.name)}" placeholder="Ví dụ: 7A1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></span></label>
      <div class="ed-tools"><button class="btn" data-act="paste-open">Dán danh sách</button><button class="btn" data-act="cls-print">In thẻ cho lớp này</button><button class="btn small danger-ghost" data-act="cls-del">Xóa lớp</button></div></div>
    <p class="hint" style="margin:0">Mỗi học sinh giữ cố định một thẻ số (1–${MAXCARD}). Phát đúng thẻ theo cột “Thẻ số”.</p>
    ${dups.length ? `<p class="warn" style="margin:0">Trùng số thẻ: ${dups.join(', ')}. Mỗi số chỉ dùng cho một em.</p>` : ''}
    ${bad.length ? `<p class="warn" style="margin:0">Số thẻ phải từ 1 đến ${MAXCARD}.</p>` : ''}
    <div class="tablewrap"><table class="roster-t"><thead><tr><th>Thẻ số</th><th>Họ và tên</th><th></th></tr></thead><tbody>
      ${c.students.map((s, i) => `<tr class="${counts[s.card] > 1 || s.card < 1 || s.card > MAXCARD ? 'dup' : ''}"><td><input type="number" min="1" max="${MAXCARD}" data-chg="st-card" data-i="${i}" value="${s.card}" aria-label="Số thẻ"></td><td><input data-in="st-name" data-i="${i}" value="${esc(s.name)}" aria-label="Họ tên"></td><td style="width:44px"><button class="icon" data-act="st-del" data-i="${i}" aria-label="Xóa học sinh">×</button></td></tr>`).join('')
        || '<tr><td colspan="3" class="hint">Chưa có học sinh. Bấm “Dán danh sách” để thêm nhanh cả lớp.</td></tr>'}
    </tbody></table></div>
    <div class="add-row"><button class="btn" data-act="st-add">+ Thêm một học sinh</button><button class="btn" data-act="st-sort">Xếp theo tên (A→Z) và đánh lại số thẻ</button></div>`;
}
const curClass = () => getClass(S.ui.classId);
const nextFreeCard = c => { const used = new Set(c.students.map(s => s.card)); for (let i = 1; i <= MAXCARD; i++) if (!used.has(i)) return i; return MAXCARD + 1; };
function viSortStudents(list) {
  const col = new Intl.Collator('vi', { sensitivity: 'base' });
  return list.sort((a, b) => col.compare(givenName(a.name), givenName(b.name)) || col.compare(a.name, b.name));
}
function openPaste() {
  const back = openModal(`<h2>Dán danh sách học sinh</h2>
    <p class="hint" style="margin:0">Mỗi dòng một học sinh. Có thể dán thẳng cột họ tên từ Excel; số thứ tự ở đầu dòng sẽ được bỏ đi. Thẻ được đánh số tiếp theo những số còn trống.</p>
    <textarea id="pasteText" rows="12" placeholder="Nguyễn Văn An&#10;Trần Thị Bình&#10;…"></textarea>
    <div id="pastePrev" class="hint">0 học sinh</div>
    <div class="add-row"><button class="btn primary" id="pasteAdd" disabled>Thêm vào lớp</button><button class="btn" id="pasteReplace" disabled>Thay cả danh sách</button><button class="btn" data-act="modal-close">Hủy</button></div>`);
  const ta = $('#pasteText', back); let names = [];
  ta.addEventListener('input', () => {
    names = ta.value.replace(/\r/g, '').split('\n').map(l => l.replace(/^\s*\d+\s*[\.\)\t,;-]?\s*/, '').split('\t')[0].trim()).filter(n => n && !/^(họ\s*(và)?\s*tên|họ tên học sinh|tên học sinh|stt|số thứ tự|danh sách.*)$/i.test(n));
    $('#pastePrev', back).textContent = names.length + ' học sinh' + (names.length > MAXCARD ? ` — tối đa ${MAXCARD} thẻ` : '');
    $('#pasteAdd', back).disabled = $('#pasteReplace', back).disabled = !names.length;
  });
  const apply = replace => {
    const c = curClass(); if (!c) return;
    if (replace) c.students = [];
    let added = 0;
    for (const n of names) { const k = nextFreeCard(c); if (k > MAXCARD) break; c.students.push({ card: k, name: n }); added++; }
    save(); closeModal(); renderClasses(); toast(`Đã thêm ${added} học sinh${added < names.length ? ` (hết thẻ, còn ${names.length - added} em chưa thêm)` : ''}.`);
  };
  $('#pasteAdd', back).addEventListener('click', () => apply(false));
  $('#pasteReplace', back).addEventListener('click', () => apply(true));
}

/* ================= IN THẺ ================= */
function cardGroup(card, name, x, y, S_) {
  const bits = CODES[card - 1].toString(2).padStart(16, '0');
  const M = S_ * 0.70, cell = M / 6, mx = x + (S_ - M) / 2, my = y + (S_ - M) / 2;
  const cx = x + S_ / 2, cy = y + S_ / 2, fs = S_ * 0.055, d = M / 2 + (S_ - M) / 4;
  const f = v => v.toFixed(2);
  let g = `<rect x="${f(x)}" y="${f(y)}" width="${f(S_)}" height="${f(S_)}" fill="#fff" stroke="#c4c4c4" stroke-width="0.3" stroke-dasharray="2 1.5"/>`;
  g += `<rect x="${f(mx)}" y="${f(my)}" width="${f(M)}" height="${f(M)}" fill="#000"/>`;
  for (let i = 0; i < 16; i++) if (bits[i] === '1') g += `<rect x="${f(mx + cell * (1 + i % 4) - 0.05)}" y="${f(my + cell * (1 + Math.floor(i / 4)) - 0.05)}" width="${f(cell + 0.1)}" height="${f(cell + 0.1)}" fill="#fff"/>`;
  const font = `font-family="Be Vietnam Pro, Arial, sans-serif" font-weight="700"`;
  const L = [[cx, cy - d, 0], [cx + d, cy, 90], [cx, cy + d, 180], [cx - d, cy, 270]];
  L.forEach(([lx, ly, r], i) => { g += `<text x="${f(lx)}" y="${f(ly)}" ${font} font-size="${f(fs)}" fill="#222" text-anchor="middle" dominant-baseline="central" transform="rotate(${r} ${f(lx)} ${f(ly)})">${LET[i]}</text>`; });
  const sm = S_ * 0.03, m = S_ * 0.04;
  g += `<text x="${f(x + m)}" y="${f(y + m + sm)}" font-family="JetBrains Mono, Consolas, monospace" font-weight="700" font-size="${f(sm * 1.25)}" fill="#222">${card}</text>`;
  if (name) g += `<text x="${f(x + S_ - m)}" y="${f(y + S_ - m)}" ${font} font-size="${f(sm)}" fill="#555" text-anchor="end" transform="rotate(180 ${f(x + S_ - m)} ${f(y + S_ - m - sm * 0.35)})">${esc(name.length > 28 ? name.slice(0, 27) + '…' : name)}</text>`;
  return g;
}
const LAYOUTS = {
  1: { S: 186, pos: [[12, 40]], note: 'Lớn nhất · xa khoảng 7–9 m' },
  2: { S: 136, pos: [[37, 9], [37, 152]], note: 'Vừa · xa khoảng 5–6 m' },
  4: { S: 98, pos: [[5, 46], [107, 46], [5, 150], [107, 150]], note: 'Nhỏ · xa khoảng 3–4 m' }
};
function pageSVGs(cards, per) {
  const L = LAYOUTS[per]; const pages = [];
  for (let i = 0; i < cards.length; i += per) {
    const chunk = cards.slice(i, i + per);
    let body = chunk.map((c, j) => cardGroup(c.card, c.name, L.pos[j][0], L.pos[j][1], L.S)).join('');
    if (per === 1) body += `<text x="105" y="250" font-family="Be Vietnam Pro, Arial, sans-serif" font-size="5" fill="#777" text-anchor="middle">Xoay thẻ cho chữ cái của đáp án nằm phía TRÊN rồi giơ cao. Không che ô đen.</text>`;
    pages.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297" width="210mm" height="297mm">${body}</svg>`);
  }
  return pages;
}
function printCards() {
  const p = S.ui.print;
  let cards = [];
  if (p.src === 'class') {
    const c = getClass(p.classId) || S.classes[0];
    cards = c ? sortedStudents(c).filter(s => s.card >= 1 && s.card <= MAXCARD).map(s => ({ card: s.card, name: p.names ? s.name : '' })) : [];
  } else {
    const a = Math.max(1, Math.min(MAXCARD, p.from | 0)), b = Math.max(a, Math.min(MAXCARD, p.to | 0));
    for (let i = a; i <= b; i++) cards.push({ card: i, name: '' });
  }
  return cards;
}
function renderPrint() {
  const p = S.ui.print = Object.assign({ src: 'class', classId: S.classes[0] && S.classes[0].id, from: 1, to: 40, per: 2, names: true }, S.ui.print || {});
  if (!S.classes.length) p.src = 'range';
  const cards = printCards(); const pages = pageSVGs(cards, p.per);
  $('#v-print').innerHTML = `<div class="print-grid">
    <div class="panel">
      <h2>In thẻ trả lời</h2>
      <div class="seg" role="group" aria-label="Nguồn">${S.classes.length ? `<button data-act="pr-src" data-v="class" aria-pressed="${p.src === 'class'}">Theo lớp</button>` : ''}<button data-act="pr-src" data-v="range" aria-pressed="${p.src === 'range'}">Theo dải số</button></div>
      ${p.src === 'class' ? `<label class="field">Lớp<select data-chg="pr-class">${S.classes.map(c => `<option value="${c.id}" ${c.id === p.classId ? 'selected' : ''}>${esc(c.name)} (${c.students.length} HS)</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" data-chg="pr-names" ${p.names ? 'checked' : ''}> In tên học sinh nhỏ ở góc thẻ</label>`
      : `<div class="row2"><label class="field">Từ số<input type="number" min="1" max="${MAXCARD}" data-chg="pr-from" value="${p.from}"></label><label class="field">Đến số<input type="number" min="1" max="${MAXCARD}" data-chg="pr-to" value="${p.to}"></label></div>`}
      <div class="field" style="display:grid;gap:6px"><span>Cỡ thẻ</span><div class="seg" role="group" aria-label="Số thẻ mỗi trang">${[1, 2, 4].map(n => `<button data-act="pr-per" data-v="${n}" aria-pressed="${p.per === n}">${n} thẻ/trang</button>`).join('')}</div><span class="hint">${LAYOUTS[p.per].note} (ước lượng, tùy camera)</span></div>
      <button class="btn primary" data-act="pr-go" ${cards.length ? '' : 'disabled'}>${IN_FRAME ? 'Tải trang in (.html)' : 'In'} ${cards.length} thẻ · ${pages.length} trang A4</button>
      <p class="hint" style="margin:0">In trên giấy trắng, mực đen, tỉ lệ 100% (không “vừa trang”). Giấy cứng (bìa 160–200 g/m²) giúp thẻ phẳng, quét nhạy hơn. Có thể ép plastic loại mờ, tránh loại bóng gây lóa.</p>
      ${IN_FRAME ? '<p class="hint" style="margin:0">Khung xem này không mở được hộp thoại in, nên nút trên sẽ tải về một trang in riêng. Mở trang đó rồi in.</p>' : ''}
      <div class="howto">${miniCard(2, 'A')}<span><b>Chọn A:</b> chữ A ở trên.</span>${miniCard(2, 'C')}<span><b>Chọn C:</b> xoay thẻ cho chữ C lên trên.</span></div>
    </div>
    <div style="display:grid;gap:12px;min-width:0"><div class="eyebrow">Xem trước · ${pages.length} trang</div><div class="pages">${pages.slice(0, 12).map(s => `<div class="page">${s}</div>`).join('')}</div>${pages.length > 12 ? `<p class="hint">…và ${pages.length - 12} trang nữa.</p>` : ''}</div>
  </div>`;
}
function miniCard(card, up) {
  const rot = { A: 0, B: -90, C: 180, D: 90 }[up];
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(${rot} 50 50)">${cardGroup(card, '', 0, 0, 100).replace('stroke-dasharray="2 1.5"', '')}</g></svg>`;
}
function doPrint() {
  const p = S.ui.print; const cards = printCards(); if (!cards.length) return;
  const pages = pageSVGs(cards, p.per);
  if (IN_FRAME) {
    const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Thẻ Giơ Thẻ</title><style>@page{size:A4;margin:0}body{margin:0;background:#fff}.ppage{width:210mm;height:297mm;page-break-after:always;break-after:page;overflow:hidden}svg{display:block;width:210mm;height:297mm}</style></head><body>${pages.map(s => `<div class="ppage">${s}</div>`).join('')}<script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>`;
    saveFile(`the-gio-the-${cards[0].card}-${cards[cards.length - 1].card}.html`, 'text/html', html);
    return;
  }
  $('#printArea').innerHTML = pages.map(s => `<div class="ppage">${s}</div>`).join('');
  setTimeout(() => window.print(), 50);
}

/* ================= BÁO CÁO ================= */
function reportData(cls, set) {
  const studs = sortedStudents(cls); const qs = set.questions;
  const res = S.results[cls.id] || {};
  const asked = qs.map(q => { const r = res[q.id]; return !!(r && Object.keys(r.resp).length); });
  const rows = studs.map(s => {
    let ok = 0, ans = 0, graded = 0, time = 0, timed = 0;
    const cells = qs.map((q, i) => {
      const r = res[q.id], a = r && r.resp[s.card];
      if (asked[i] && isGraded(q)) graded++;
      if (!a) return { t: '', k: '' };
      ans++;
      if (!isGraded(q)) return { t: a, k: 'sv' };
      const good = q.correct.includes(LET.indexOf(a)); if (good) ok++;
      if (good && r.ts && r.ts[s.card]) { const t0 = Math.min(...Object.values(r.ts)); time += (r.ts[s.card] - t0) / 1000; timed++; }
      return { t: a, k: good ? 'ok' : 'bad' };
    });
    return { s, cells, ok, ans, graded, pct: graded ? Math.round(ok * 100 / graded) : null, time: timed && timed === ok ? time : null };
  });
  const qstats = qs.map((q, i) => {
    if (!asked[i]) return null;
    let n = 0, good = 0; rows.forEach(r => { const c = r.cells[i]; if (c.t) { n++; if (c.k === 'ok') good++; } });
    return { n, pct: isGraded(q) && n ? Math.round(good * 100 / n) : null };
  });
  return { studs, qs, rows, asked, qstats };
}
function renderReport() {
  const el = $('#v-report');
  const cls = getClass(S.ui.repClass) || getClass(S.live.classId) || S.classes[0];
  const set = getSet(S.ui.repSet) || getSet(S.live.setId) || S.sets[0];
  if (!cls || !set) { el.innerHTML = emptyState('Chưa có dữ liệu', 'Cần ít nhất một lớp và một bộ câu hỏi đã trình chiếu.', 'go-live', 'Về Trình chiếu'); return; }
  S.ui.repClass = cls.id; S.ui.repSet = set.id;
  const D = reportData(cls, set);
  const askedN = D.asked.filter(Boolean).length;
  const part = D.rows.filter(r => r.ans).length;
  const pcts = D.rows.map(r => r.pct).filter(v => v != null);
  const avg = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
  el.innerHTML = `<div class="editor">
    <div class="ed-head"><h2 style="font-size:24px;flex:1">Báo cáo kết quả</h2>
      <label class="field">Lớp<select data-chg="rep-class">${S.classes.map(c => `<option value="${c.id}" ${c.id === cls.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label class="field">Bộ câu hỏi<select data-chg="rep-set">${S.sets.map(s => `<option value="${s.id}" ${s.id === set.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label></div>
    <div class="stats"><div class="stat"><b>${askedN}/${D.qs.length}</b><span>câu đã hỏi</span></div><div class="stat"><b>${part}/${D.studs.length}</b><span>học sinh tham gia</span></div><div class="stat hl"><b>${avg == null ? '—' : avg + '%'}</b><span>tỉ lệ đúng trung bình</span></div></div>
    ${askedN ? reportVisuals(D, cls, set) : ''}
    ${askedN ? `<div class="eyebrow" style="margin-top:4px">Bảng chi tiết</div><div class="tablewrap"><table class="rep"><thead><tr><th>Thẻ</th><th>Họ và tên</th>${D.qs.map((q, i) => `<th class="c" title="${esc(q.text)}">C${i + 1}</th>`).join('')}<th>Đúng</th><th>Tỉ lệ</th></tr></thead>
      <tbody>${D.rows.map(r => `<tr><td class="pct">${pad2(r.s.card)}</td><td style="white-space:nowrap">${esc(r.s.name)}</td>${r.cells.map((c, i) => `<td class="c ${c.k}">${c.t || (D.asked[i] ? '·' : '')}</td>`).join('')}<td class="pct">${r.ok}/${r.graded}</td><td class="pct">${r.pct == null ? '—' : r.pct + '%'}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td></td><td>% đúng mỗi câu</td>${D.qstats.map(s => `<td class="c pct">${s ? (s.pct == null ? 'KS' : s.pct + '%') : ''}</td>`).join('')}<td></td><td></td></tr></tfoot></table></div>
      <p class="hint" style="margin:0">Ô xanh: đúng · ô đỏ: sai · chữ xám: câu khảo sát (KS) · dấu “·”: không trả lời. Tỉ lệ tính trên các câu có đáp án đã hỏi.</p>
      <div class="add-row"><button class="btn primary" data-act="rep-csv">Xuất CSV (mở bằng Excel)</button><button class="btn danger-ghost" data-act="rep-clear">Xóa kết quả bộ này của lớp</button></div>`
      : emptyState('Chưa hỏi câu nào', 'Kết quả sẽ hiện ở đây sau khi quét thẻ trong phần Trình chiếu.', 'go-live', 'Về Trình chiếu')}
  </div>`;
}
/* ---------- vinh danh + biểu đồ ---------- */
function topStudents(D, n = 3) {
  const list = D.rows.filter(r => r.ans > 0 && r.pct != null && r.graded > 0)
    .sort((a, b) => b.pct - a.pct || b.ok - a.ok || (a.time ?? 1e9) - (b.time ?? 1e9) || b.ans - a.ans || a.s.card - b.s.card);
  let rank = 0, prev = null;
  list.forEach((r, i) => { const k = r.pct + '|' + r.ok + '|' + (r.time == null ? 'x' : r.time.toFixed(1)); if (k !== prev) { rank = i + 1; prev = k; } r.rank = rank; });
  return list.filter(r => r.rank <= n).slice(0, Math.max(n, list.filter(r => r.rank <= n).length > 5 ? 5 : list.filter(r => r.rank <= n).length));
}
function podiumHTML(D, big) {
  const top = topStudents(D);
  if (!top.length) return `<p class="hint" style="margin:0">Chưa có học sinh nào trả lời câu có đáp án.</p>`;
  const order = [top.find(r => r.rank === 2) || top[1], top[0], top.find(r => r.rank === 3 && r !== top[1]) || top[2]].filter(Boolean);
  const place = r => Math.min(3, r.rank);
  const medal = ['', 'gold', 'silver', 'bronze'];
  const initials = n => { const w = String(n).trim().split(/\s+/); return (w[w.length - 1] || '?').charAt(0).toUpperCase(); };
  const ties = top.length > 3 ? `<p class="hint" style="margin:8px 0 0;text-align:center">Đồng hạng: ${top.slice(3).map(r => esc(r.s.name)).join(', ')}</p>` : '';
  const note = top.some(r => r.time != null) ? `<p class="hint" style="margin:8px 0 0;text-align:center">Bằng điểm thì em giơ đúng đáp án sớm hơn xếp trên (giây = tổng thời gian chậm hơn bạn giơ thẻ đầu tiên ở mỗi câu).</p>` : '';
  return `<div class="podium ${big ? 'big' : ''}">${order.map(r => { const p = Math.min(3, place(r)); return `<div class="pod p${p}">
      <div class="pod-av ${medal[p]}">${esc(initials(r.s.name))}<span class="pod-medal">${r.rank}</span></div>
      <div class="pod-name">${esc(r.s.name)}</div>
      <div class="pod-score">${r.ok}/${r.graded} câu · ${r.pct}%${r.time != null ? ` · ${r.time.toFixed(1).replace('.', ',')} giây` : ''}</div>
      <div class="pod-block ${medal[p]}"><b>${r.rank}</b></div></div>`; }).join('')}</div>${ties}${big ? '' : note}`;
}
function barChartSVG(items, opts = {}) {
  // items: [{label, value(0..max)|null, text, cls}]
  const W = 520, H = 220, pl = 34, pr = 8, pt = 18, pb = 30, max = opts.max || 100;
  const n = items.length || 1, bw = (W - pl - pr) / n, gap = Math.min(14, bw * 0.28);
  const y = v => pt + (H - pt - pb) * (1 - v / max);
  const ticks = opts.ticks || [0, 25, 50, 75, 100];
  let g = ticks.map(t => `<line x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}" class="gl"/><text x="${pl - 6}" y="${y(t) + 4}" text-anchor="end" class="ax">${t}${opts.unit || ''}</text>`).join('');
  items.forEach((it, i) => {
    const x = pl + i * bw + gap / 2, w = bw - gap;
    if (it.value != null) {
      const top = y(it.value), h = Math.max(it.value > 0 ? 2 : 0, H - pb - top);
      g += `<rect x="${x.toFixed(1)}" y="${(H - pb - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="5" class="bar ${it.cls || ''}"><title>${esc(it.title || '')}</title></rect>`;
      g += `<text x="${(x + w / 2).toFixed(1)}" y="${(H - pb - h - 5).toFixed(1)}" text-anchor="middle" class="val">${esc(it.text)}</text>`;
    } else g += `<text x="${(x + w / 2).toFixed(1)}" y="${H - pb - 6}" text-anchor="middle" class="ax">${esc(it.text || '')}</text>`;
    g += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle" class="ax">${esc(it.label)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(opts.aria || '')}">${g}</svg>`;
}
function reportVisuals(D) {
  const qItems = D.qs.map((q, i) => {
    const st = D.qstats[i];
    if (!st) return { label: 'C' + (i + 1), value: null, text: '' };
    if (st.pct == null) return { label: 'C' + (i + 1), value: null, text: 'KS' };
    return { label: 'C' + (i + 1), value: st.pct, text: st.pct + '%', cls: st.pct >= 70 ? 'good' : st.pct >= 40 ? 'mid' : 'low', title: `Câu ${i + 1}: ${st.pct}% đúng (${st.n} em trả lời)` };
  });
  const gradedAsked = D.qs.filter((q, i) => D.asked[i] && isGraded(q)).length;
  let dist = [];
  const part = D.rows.filter(r => r.ans > 0 && r.graded > 0);
  if (gradedAsked && gradedAsked <= 10) {
    for (let k = 0; k <= gradedAsked; k++) { const c = part.filter(r => r.ok === k).length; dist.push({ label: k + ' câu', value: c, text: String(c), cls: k / gradedAsked >= 0.7 ? 'good' : k / gradedAsked >= 0.4 ? 'mid' : 'low', title: `${c} em đúng ${k} câu` }); }
  } else if (gradedAsked) {
    const bins = [[0, 20], [20, 40], [40, 60], [60, 80], [80, 101]];
    dist = bins.map(([a, b2]) => { const c = part.filter(r => r.pct >= a && r.pct < b2).length; return { label: `${a}–${Math.min(100, b2)}%`, value: c, text: String(c), cls: a >= 60 ? 'good' : a >= 40 ? 'mid' : 'low' }; });
  }
  const dmax = Math.max(1, ...dist.map(d => d.value));
  const step = Math.max(1, Math.ceil(dmax / 4)); const dticks = [0, step, step * 2, step * 3, step * 4];
  return `<div class="rep-vis">
    <section class="panel honor"><div class="honor-head"><h2>Bảng vinh danh</h2><button class="btn small chalk" data-act="rep-honor">Trình chiếu vinh danh</button></div>${podiumHTML(D)}</section>
    <section class="panel"><h2>Tỉ lệ đúng từng câu</h2>${barChartSVG(qItems, { aria: 'Tỉ lệ trả lời đúng của từng câu', unit: '%' })}<div class="legend"><span><i class="good"></i>từ 70%</span><span><i class="mid"></i>40–69%</span><span><i class="low"></i>dưới 40% — nên giảng lại</span></div></section>
    <section class="panel"><h2>Phân bố điểm của lớp</h2>${dist.length ? barChartSVG(dist, { max: step * 4, ticks: dticks, aria: 'Số học sinh theo số câu đúng' }) : '<p class="hint">Chưa có câu có đáp án.</p>'}<p class="hint" style="margin:0">Số học sinh theo ${gradedAsked <= 10 ? 'số câu trả lời đúng' : 'khoảng tỉ lệ đúng'} (trên ${gradedAsked} câu có đáp án đã hỏi).</p></section>
  </div>`;
}
function openSummary(cls, set) {
  if (cam.scanning) pauseScan(); pauseTimer(); clearTimeout(cam.sumT);
  const D = reportData(cls, set);
  const askedN = D.asked.filter(Boolean).length;
  if (!askedN) { toast('Chưa có câu nào được trả lời để tổng kết.'); return; }
  const part = D.rows.filter(r => r.ans).length;
  const pcts = D.rows.map(r => r.pct).filter(v => v != null);
  const avg = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
  const full = D.rows.filter(r => r.pct === 100 && r.graded > 0).length;
  const qItems = D.qs.map((q, i) => { const st = D.qstats[i]; if (!st) return { label: 'C' + (i + 1), value: null, text: '' }; if (st.pct == null) return { label: 'C' + (i + 1), value: null, text: 'KS' }; return { label: 'C' + (i + 1), value: st.pct, text: st.pct + '%', cls: st.pct >= 70 ? 'good' : st.pct >= 40 ? 'mid' : 'low' }; });
  S.ui.repClass = cls.id; S.ui.repSet = set.id; save();
  const back = openModal(`<div class="honor-show sum">
      <div class="hs-eyebrow">${esc(cls.name)} · ${esc(set.name)}</div>
      <h2 class="hs-title">Kết quả cả lớp</h2>
      <div class="sum-stats">
        <div class="sum-tile hl"><b>${avg == null ? '—' : avg + '%'}</b><span>tỉ lệ đúng trung bình</span></div>
        <div class="sum-tile"><b>${part}/${D.studs.length}</b><span>học sinh tham gia</span></div>
        <div class="sum-tile"><b>${askedN}/${D.qs.length}</b><span>câu đã hỏi</span></div>
        <div class="sum-tile"><b>${full}</b><span>em đúng tất cả</span></div>
      </div>
      <div class="sum-grid">
        <div class="sum-pod">${podiumHTML(D, true)}</div>
        <div class="sum-chart"><div class="eyebrow">Tỉ lệ đúng từng câu</div>${barChartSVG(qItems, { aria: 'Tỉ lệ đúng từng câu', unit: '%' })}</div>
      </div>
      <div class="add-row" style="justify-content:center"><button class="btn primary" data-act="sum-report">Xem báo cáo chi tiết</button><button class="btn" data-act="modal-close">Đóng</button></div>
    </div><canvas id="confetti"></canvas>`);
  back.querySelector('.modal').classList.add('honor-modal');
  try { if (back.requestFullscreen && window.innerWidth > 900) back.requestFullscreen().catch(() => { }); } catch (e) { }
  [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 0.28, 'triangle', i * 0.16)); tone(784, 0.25, 0.25, 'triangle', 0.8); tone(1047, 0.7, 0.32, 'triangle', 0.98);
  confetti($('#confetti', back));
  back.addEventListener('click', e => { if (e.target.closest('[data-act="modal-close"],[data-act="sum-report"]') && document.fullscreenElement) document.exitFullscreen().catch(() => { }); });
}
function openHonor() {
  const cls = getClass(S.ui.repClass), set = getSet(S.ui.repSet); if (!cls || !set) return;
  const D = reportData(cls, set);
  const back = openModal(`<div class="honor-show"><div class="hs-eyebrow">${esc(cls.name)} · ${esc(set.name)}</div><h2 class="hs-title">Vinh danh học sinh xuất sắc</h2>${podiumHTML(D, true)}<button class="btn" data-act="modal-close" style="justify-self:center">Đóng</button></div><canvas id="confetti"></canvas>`);
  back.querySelector('.modal').classList.add('honor-modal');
  try { if (back.requestFullscreen && window.innerWidth > 900) back.requestFullscreen().catch(() => { }); } catch (e) { }
  [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 0.28, 'triangle', i * 0.16)); tone(784, 0.25, 0.25, 'triangle', 0.8); tone(1047, 0.7, 0.32, 'triangle', 0.98);
  confetti($('#confetti', back));
  const close = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); };
  back.addEventListener('click', e => { if (e.target.closest('[data-act="modal-close"]')) close(); });
}
function confetti(cv) {
  if (!cv || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const g = cv.getContext('2d'); const cols = ['#FF5A5F', '#2C8CFF', '#FFB21E', '#1DB35A', '#9855D6', '#FFC93C'];
  const fit = () => { cv.width = cv.clientWidth * devicePixelRatio; cv.height = cv.clientHeight * devicePixelRatio; }; fit();
  const P = Array.from({ length: 180 }, () => ({ x: Math.random() * cv.width, y: -Math.random() * cv.height * 0.6, r: (4 + Math.random() * 6) * devicePixelRatio, c: cols[Math.floor(Math.random() * cols.length)], vy: (2 + Math.random() * 3) * devicePixelRatio, vx: (Math.random() - .5) * 2 * devicePixelRatio, a: Math.random() * 6, va: (Math.random() - .5) * .2 }));
  const t0 = performance.now();
  (function step(t) {
    if (!cv.isConnected) return;
    g.clearRect(0, 0, cv.width, cv.height);
    P.forEach(p => { p.y += p.vy; p.x += p.vx + Math.sin(p.a) * .6; p.a += p.va; g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.fillStyle = p.c; g.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); g.restore(); if (p.y > cv.height + 20 && t - t0 < 4000) { p.y = -20; p.x = Math.random() * cv.width; } });
    if (t - t0 < 7000) requestAnimationFrame(step); else g.clearRect(0, 0, cv.width, cv.height);
  })(t0);
}
function exportCSV() {
  const cls = getClass(S.ui.repClass), set = getSet(S.ui.repSet); if (!cls || !set) return;
  const D = reportData(cls, set);
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [['Thẻ', 'Họ và tên', ...D.qs.map((_, i) => 'Câu ' + (i + 1)), 'Số câu đúng', 'Số câu có đáp án đã hỏi', 'Tỉ lệ đúng (%)'].map(q).join(',')];
  D.rows.forEach(r => lines.push([r.s.card, r.s.name, ...r.cells.map(c => c.t), r.ok, r.graded, r.pct ?? ''].map(q).join(',')));
  lines.push(['', 'Đáp án đúng', ...D.qs.map(qq => isGraded(qq) ? qq.correct.map(c => LET[c]).join('/') : 'Khảo sát')].map(q).join(','));
  lines.push(['', '% đúng', ...D.qstats.map(s => s ? (s.pct ?? '') : '')].map(q).join(','));
  const safe = s => s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-');
  saveFile(`ket-qua-${safe(cls.name)}-${safe(set.name)}.csv`, 'text/csv', '﻿' + lines.join('\r\n'));
}

/* ================= CÀI ĐẶT ================= */
function renderSettings() {
  const st = S.settings;
  $('#v-settings').innerHTML = `<div class="set-grid">
    <div class="panel" style="grid-column:1/-1"><h2>Màu giao diện</h2>
      <div class="skins">${SKINS.map(([k, l, c]) => `<button class="skin" data-act="skin" data-v="${k}" aria-pressed="${(st.skin || 'tim') === k}"><i style="background:${c}"></i>${l}</button>`).join('')}</div>
      <span class="hint">Bốn màu đáp án A đỏ · B xanh dương · C vàng · D xanh lá luôn giữ nguyên để học sinh dễ nhận ra.</span>
    </div>
    ${IN_FRAME ? '' : `<div class="panel"><h2>Trợ lý AI (Gemini)</h2>
      <p class="hint" style="margin:0">Dùng để tự tạo câu hỏi từ tài liệu (tab Câu hỏi). Lấy khóa miễn phí tại <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> → “Create API key”.</p>
      <label class="field">Khóa Gemini<input id="setGemKey" type="password" value="${esc(st.geminiKey || '')}" placeholder="AIza…" autocomplete="off"></label>
      <div class="add-row"><button class="btn primary small" data-act="gem-save">Lưu và kiểm tra</button>${st.geminiKey ? '<button class="btn small ghost" data-act="gem-show">Hiện/ẩn khóa</button><button class="btn small danger-ghost" data-act="gem-del">Xóa khóa</button>' : ''}</div>
      <div id="gemInfo" class="hint">${st.geminiKey ? (st.geminiModel ? 'Đã kết nối · mô hình: <b>' + esc(st.geminiModel) + '</b>' : 'Đã lưu khóa, chưa kiểm tra.') : 'Chưa có khóa.'}</div>
      ${st.geminiModel ? `<label class="field">Mô hình<select data-chg="gem-model" id="gemModelSel"><option value="${esc(st.geminiModel)}">${esc(st.geminiModel)}</option></select></label><button class="btn small ghost" data-act="gem-list" style="justify-self:start">Tải danh sách mô hình</button>` : ''}
      <span class="hint">Khóa chỉ lưu trong trình duyệt của máy này. Khi tạo câu hỏi, nội dung tài liệu được gửi tới Google.</span>
    </div>`}
    <div class="panel"><h2>Đếm ngược mỗi câu</h2>
      <label class="field">Thời gian mặc định<select data-chg="set-tdef">${[[0, 'Không đếm ngược'], [10, '10 giây'], [15, '15 giây'], [20, '20 giây'], [30, '30 giây'], [45, '45 giây'], [60, '60 giây'], [90, '90 giây'], [120, '2 phút'], [180, '3 phút']].map(([v, l]) => `<option value="${v}" ${+st.timeDef === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <span class="hint" style="margin-top:-8px">Từng câu có thể đặt riêng ở tab Câu hỏi (ô “Thời gian trả lời”).</span>
      <label class="check"><input type="checkbox" data-chg="set-tauto" ${st.timeAuto ? 'checked' : ''}><span>Tự bắt đầu đếm khi bấm “Bắt đầu quét”</span></label>
      <label class="check"><input type="checkbox" data-chg="set-ttick" ${st.timeTick ? 'checked' : ''}><span>Tiếng tích tắc mỗi giây (5 giây cuối kêu to hơn)</span></label>
      <label class="check"><input type="checkbox" data-chg="set-tend" ${st.timeEndSound ? 'checked' : ''}><span>Chuông báo hết giờ</span></label>
      <label class="check"><input type="checkbox" data-chg="set-tstop" ${st.timeStopScan ? 'checked' : ''}><span>Hết giờ thì dừng nhận thẻ</span></label>
      <label class="check"><input type="checkbox" data-chg="set-trev" ${st.timeReveal ? 'checked' : ''}><span>Hết giờ thì tự hiện đáp án</span></label>
    </div>
    <div class="panel"><h2>Camera &amp; nhận thẻ</h2>
      <label class="field">Camera<select id="setCam" data-chg="set-cam"></select></label>
      <button class="btn small" data-act="cam-probe" style="justify-self:start">Tìm camera</button>
      <label class="field">Độ phân giải xử lý<select data-chg="set-proc">${[[960, '960 px · nhanh, lớp nhỏ'], [1280, '1280 px · cân bằng (khuyên dùng)'], [1920, '1920 px · nhìn xa hơn, máy cần mạnh']].map(([v, l]) => `<option value="${v}" ${st.procWidth == v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field">Xác nhận một thẻ khi thấy<select data-chg="set-confirm">${[[1, '1 khung hình · nhanh nhất'], [2, '2 khung hình · khuyên dùng'], [3, '3 khung hình · chắc chắn nhất']].map(([v, l]) => `<option value="${v}" ${st.confirm == v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" data-chg="set-autosum" ${st.autoSummary !== false ? 'checked' : ''}><span>Hiện đáp án câu cuối thì tự hiện kết quả cả lớp (sau 3 giây)</span></label>
      <label class="check"><input type="checkbox" data-chg="set-autonext" ${st.autoNext !== false ? 'checked' : ''}><span>Sang câu mới thì tự quét tiếp (sau 2 giây)<br><span class="hint">Tắt nếu muốn tự bấm “Bắt đầu quét” cho từng câu.</span></span></label>
      <label class="check"><input type="checkbox" data-chg="set-letters" ${st.showLetters ? 'checked' : ''}><span>Hiện chữ A/B/C/D trên khung camera ngay khi quét<br><span class="hint">Tắt để cả lớp không nhìn thấy đáp án của bạn trên máy chiếu.</span></span></label>
      <label class="check"><input type="checkbox" data-chg="set-tile" ${st.tileLetters ? 'checked' : ''}><span>Hiện chữ đã chọn trên ô tên khi công bố đáp án</span></label>
      <label class="check"><input type="checkbox" data-chg="set-mirror" ${st.mirror ? 'checked' : ''}><span>Lật ngang hình camera (gương)</span></label>
      <label class="check"><input type="checkbox" data-chg="set-sound" ${st.sound ? 'checked' : ''}><span>Tiếng “tít” khi nhận được thẻ</span></label>
    </div>
    <div class="panel"><h2>Dữ liệu</h2>
      <p class="hint" style="margin:0">Lớp, câu hỏi và kết quả được lưu ngay trong trình duyệt ${IN_FRAME ? 'này' : 'trên máy này'}. Nên xuất bản sao lưu sau mỗi buổi, và dùng nó để chuyển sang máy khác.</p>
      <div class="add-row"><button class="btn primary" data-act="bk-export">Xuất bản sao lưu (.json)</button><button class="btn" data-act="bk-import">Nhập bản sao lưu</button></div>
      <div class="add-row"><button class="btn small ghost" data-act="bk-sample">Thêm lại lớp mẫu &amp; bộ mẫu</button><button class="btn small danger-ghost" data-act="bk-reset">Xóa toàn bộ dữ liệu</button></div>
      <p class="hint" style="margin:0">${S.classes.length} lớp · ${S.sets.length} bộ câu hỏi · ${S.sets.reduce((a, s) => a + s.questions.length, 0)} câu.</p>
    </div>
    <div class="panel" style="grid-column:1/-1"><h2>Cách dùng trong tiết học</h2>
      <ol class="steps">
        <li><b>Lớp học:</b> tạo lớp, bấm “Dán danh sách”. Mỗi em nhận một số thẻ cố định (1–${MAXCARD}).</li>
        <li><b>In thẻ:</b> in theo lớp (có tên) hoặc theo dải số. Phát đúng thẻ theo số, dùng lại cho cả năm.</li>
        <li><b>Câu hỏi:</b> soạn từng câu, dán nguyên đề bằng “Nhập nhanh từ văn bản”, hoặc bấm <b>“Tạo câu hỏi từ tài liệu”</b>: chọn file giáo án/bài giảng (Word, PowerPoint, PDF), chọn số câu và mức độ để Claude soạn sẵn đáp án và giải thích. Ở bản trên máy, ứng dụng tạo sẵn lệnh để dán vào Claude rồi dán kết quả trở lại.</li>
        <li><b>Trình chiếu:</b> chọn lớp và bộ câu hỏi, chiếu lên máy chiếu. Học sinh <b>xoay thẻ cho chữ cái của đáp án nằm phía trên</b> rồi giơ cao, giữ thẳng.</li>
        <li>Bấm <b>Bắt đầu quét</b> (phím Space), lia camera chậm qua cả lớp. Ô tên của em nào chuyển màu là đã nhận. Em nào giơ lại thẻ khác thì máy lấy câu trả lời mới nhất.</li>
        <li>Bấm <b>Hiện đáp án</b> (phím R) để công bố biểu đồ và đáp án. Ô tên chuyển xanh (đúng) hoặc đỏ (sai). Bấm vào ô tên để sửa tay nếu cần.</li>
        <li>Sau buổi học, vào <b>Báo cáo</b> xem điểm từng em và xuất file CSV mở bằng Excel.</li>
      </ol>
      <p class="hint" style="margin:0;max-width:75ch"><b>Mẹo camera:</b> webcam trên màn hình laptop thường quay vào giáo viên. Nên dùng webcam rời (cắm USB, đặt trên bục giảng), hoặc dùng điện thoại làm webcam (trên Windows 11: Phone Link; hoặc ứng dụng như DroidCam, Camo). Chọn camera trong mục bên trên. Cần đủ ánh sáng. Thẻ để phẳng, không che ô đen, không bị lóa. Không có camera thì chụp ảnh cả lớp bằng điện thoại rồi dùng “Quét từ ảnh chụp”.</p>
      ${IN_FRAME ? `<p class="hint" style="margin:0;max-width:75ch"><b>Bản xem trên Claude</b> không dùng được camera và lưu dữ liệu riêng. Để quét trực tiếp trong lớp, hãy mở file <b>GioThe.html</b> trên máy tính bằng Chrome hoặc Edge.</p>` : ''}
    </div>
  </div>`;
  fillCamSelect($('#setCam'));
}

/* ================= ĐIỀU HƯỚNG & SỰ KIỆN CHUNG ================= */
const SKINS = [['tim', 'Tím nhạt', 'linear-gradient(135deg,#A68BF0,#7B5CD6)'], ['ma', 'Xanh lá mạ', 'linear-gradient(135deg,#B5DD6E,#5E9F2C)'], ['troi', 'Xanh trời', 'linear-gradient(135deg,#8CC4F7,#2F80D8)'], ['bacha', 'Bạc hà', 'linear-gradient(135deg,#7FDCC9,#169C86)']];
function applySkin() { document.documentElement.dataset.skin = S.settings.skin || 'tim'; }
const RENDER = { live: renderLive, sets: renderSets, classes: renderClasses, print: renderPrint, report: renderReport, settings: renderSettings };
function show(view) {
  if (!RENDER[view]) view = 'live';
  if (S.ui.view === 'live' && view !== 'live') { stopCamera(); pauseTimer(); }
  S.ui.view = view; closePop();
  $$('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === view)));
  $$('.view').forEach(v => { v.hidden = v.id !== 'v-' + view; });
  RENDER[view](); save();
  if (view === 'live') setTimeout(drawOverlay, 30);
}
$$('.tabs button').forEach(b => b.addEventListener('click', () => { if (b.dataset.view !== 'scan') S.ui.role = ''; show(b.dataset.view); }));

const ACTIONS = {
  'go-classes': () => show('classes'), 'go-sets': () => show('sets'), 'go-live': () => show('live'),
  'goto': el => gotoQ(+el.dataset.i),
  'timer-toggle': () => toggleTimer(),
  'cam-off': () => stopCamera(),
  'photo-clear': () => clearPhoto(),
  'modal-close': () => closeModal(),
  // bộ câu hỏi
  'set-add': () => { const s = { id: uid(), name: 'Bộ câu hỏi mới', questions: [] }; S.sets.push(s); S.ui.setId = s.id; save(); renderSets(); setTimeout(() => { const i = $('#setName'); if (i) { i.focus(); i.select(); } }, 20); },
  'set-pick': el => { S.ui.setId = el.dataset.id; save(); renderSets(); },
  'set-del': el => armed(el, () => { const s = curSet(); S.sets = S.sets.filter(x => x !== s); save(); renderSets(); toast('Đã xóa bộ câu hỏi.'); }, 'Bấm lần nữa để xóa bộ'),
  'set-dup': () => { const s = curSet(); if (!s) return; const c = JSON.parse(JSON.stringify(s)); c.id = uid(); c.name = s.name + ' (bản sao)'; c.questions.forEach(q => q.id = uid()); delete c.sample; S.sets.push(c); S.ui.setId = c.id; save(); renderSets(); },
  'set-play': () => { const s = curSet(); if (!s) return; S.live.setId = s.id; S.live.qIndex = 0; show('live'); },
  'import-open': () => openImport(),
  'gen-open': () => openGen(),
  'set-copy': () => { const s = curSet(); if (s) copyText(setToText(s), `Đã sao chép ${s.questions.length} câu. Dán vào “Nhập nhanh từ văn bản” ở máy khác.`); },
  'q-add': () => { curSet().questions.push({ id: uid(), text: '', choices: ['', '', '', ''], correct: [], img: '' }); save(); renderSets(); focusLastQ(); },
  'q-add-tf': () => { curSet().questions.push({ id: uid(), text: '', choices: ['Đúng', 'Sai'], correct: [0], img: '' }); save(); renderSets(); focusLastQ(); },
  'q-add-sv': () => { curSet().questions.push({ id: uid(), text: '', choices: ['', '', '', ''], correct: [], img: '' }); save(); renderSets(); focusLastQ(); },
  'q-del': el => armed(el, () => { const s = curSet(), q = qOf(el); s.questions = s.questions.filter(x => x !== q); save(); renderSets(); }, 'Xóa?'),
  'q-math': el => {
    const box = el.closest('.qedit');
    let f = lastField && box.contains(lastField) ? lastField : box.querySelector('textarea[data-in="q-text"]');
    const a = f.selectionStart ?? f.value.length, b = f.selectionEnd ?? a, sel = f.value.slice(a, b);
    const ins = '$' + (sel || '') + '$';
    f.value = f.value.slice(0, a) + ins + f.value.slice(b);
    f.focus(); const pos = a + 1 + sel.length; f.setSelectionRange(pos, pos);
    f.dispatchEvent(new Event('input', { bubbles: true }));
  },
  'q-checked': el => { qOf(el).check = false; save(); renderSets(); },
  'set-export': () => { const st = curSet(); if (!st) return; saveFile('bo-cau-hoi-' + st.name.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-').slice(0, 60) + '.json', 'application/json', JSON.stringify({ app: 'gio-the-set', version: 1, sets: [st] }, null, 1)); },
  'set-importfile': () => $('#setFileInput').click(),
  'q-dup': el => { const s = curSet(), q = qOf(el); const c = JSON.parse(JSON.stringify(q)); c.id = uid(); s.questions.splice(s.questions.indexOf(q) + 1, 0, c); save(); renderSets(); },
  'q-play': el => { const s = curSet(), q = qOf(el); S.live.setId = s.id; S.live.qIndex = s.questions.indexOf(q); show('live'); },
  'q-up': el => moveQ(el, -1), 'q-down': el => moveQ(el, 1),
  'q-correct': el => { const q = qOf(el), ci = +el.dataset.ci; q.correct = q.correct.includes(ci) ? q.correct.filter(x => x !== ci) : [...q.correct, ci].sort(); save(); renderSets(); },
  'q-ch-add': el => { const q = qOf(el); if (q.choices.length < 4) q.choices.push(''); save(); renderSets(); },
  'q-ch-del': el => { const q = qOf(el), ci = +el.dataset.ci; q.choices.splice(ci, 1); q.correct = q.correct.filter(x => x !== ci).map(x => x > ci ? x - 1 : x); save(); renderSets(); },
  'q-img': el => { imgTargetQ = qOf(el); $('#imgInput').click(); },
  'q-img-del': el => { qOf(el).img = ''; save(); renderSets(); },
  // lớp học
  'cls-add': () => { const c = { id: uid(), name: 'Lớp mới', students: [] }; S.classes.push(c); S.ui.classId = c.id; save(); renderClasses(); setTimeout(() => { const i = $('#clsName'); if (i) { i.focus(); i.select(); } }, 20); },
  'cls-pick': el => { S.ui.classId = el.dataset.id; save(); renderClasses(); },
  'cls-del': el => armed(el, () => { const c = curClass(); S.classes = S.classes.filter(x => x !== c); delete S.results[c.id]; save(); renderClasses(); toast('Đã xóa lớp.'); }, 'Bấm lần nữa để xóa lớp'),
  'cls-print': () => { S.ui.print = Object.assign(S.ui.print || {}, { src: 'class', classId: S.ui.classId }); show('print'); },
  'paste-open': () => openPaste(),
  'st-add': () => { const c = curClass(); c.students.push({ card: nextFreeCard(c), name: '' }); save(); renderClasses(); const ins = $$('#v-classes input[data-in="st-name"]'); if (ins.length) ins[ins.length - 1].focus(); },
  'st-del': el => { const c = curClass(); c.students.splice(+el.dataset.i, 1); save(); renderClasses(); },
  'st-sort': el => armed(el, () => { const c = curClass(); viSortStudents(c.students).forEach((s, i) => s.card = i + 1); save(); renderClasses(); toast('Đã xếp theo tên và đánh lại số thẻ 1, 2, 3… Nhớ phát lại thẻ cho đúng.'); }, 'Số thẻ sẽ thay đổi — bấm lần nữa'),
  // in
  'pr-src': el => { S.ui.print.src = el.dataset.v; save(); renderPrint(); },
  'pr-per': el => { S.ui.print.per = +el.dataset.v; save(); renderPrint(); },
  'pr-go': () => doPrint(),
  // báo cáo
  'rep-csv': () => exportCSV(),
  'rep-honor': () => openHonor(),
  'sum-report': () => { closeModal(); show('report'); },
  'rep-clear': el => armed(el, () => { const r = S.results[S.ui.repClass]; const set = getSet(S.ui.repSet); if (r && set) set.questions.forEach(q => delete r[q.id]); save(); renderReport(); }, 'Bấm lần nữa để xóa'),
  // cài đặt
  'skin': el => { S.settings.skin = el.dataset.v; applySkin(); save(); $$('.skin').forEach(b => b.setAttribute('aria-pressed', String(b === el))); },
  'gem-save': async el => {
    const k = $('#setGemKey').value.trim(); if (!k) { toast('Hãy dán khóa Gemini.', 'bad'); return; }
    el.disabled = true; el.textContent = 'Đang kiểm tra…';
    try { const m = pickGemini(await geminiModels(k)); if (!m) throw new Error('Khóa này chưa dùng được mô hình Gemini nào.'); S.settings.geminiKey = k; S.settings.geminiModel = m; save(); renderSettings(); toast('Đã kết nối Gemini (' + m + ').'); }
    catch (e) { el.disabled = false; el.textContent = 'Lưu và kiểm tra'; $('#gemInfo').textContent = e.message; toast(e.message, 'bad'); }
  },
  'gem-del': el => armed(el, () => { S.settings.geminiKey = ''; S.settings.geminiModel = ''; save(); renderSettings(); toast('Đã xóa khóa Gemini khỏi máy này.'); }, 'Bấm lần nữa để xóa'),
  'gem-show': () => { const i = $('#setGemKey'); i.type = i.type === 'password' ? 'text' : 'password'; },
  'gem-list': async el => {
    try { const list = (await geminiModels(S.settings.geminiKey)).filter(x => /gemini/.test(x) && !/(embedding|image|tts|audio|live|aqa)/.test(x)); const sel = $('#gemModelSel'); sel.innerHTML = list.map(x => `<option value="${esc(x)}" ${x === S.settings.geminiModel ? 'selected' : ''}>${esc(x)}${x === pickGemini(list) ? ' (gợi ý)' : ''}</option>`).join(''); toast(`Có ${list.length} mô hình.`); }
    catch (e) { toast(e.message, 'bad'); }
  },
  'cam-probe': async () => {
    try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); s.getTracks().forEach(t => t.stop()); await refreshCameraList(); toast(`Tìm thấy ${(cam.devices || []).length} camera.`); }
    catch (e) { toast(IN_FRAME ? 'Khung xem của Claude không cho dùng camera. Hãy mở file GioThe.html trên máy.' : 'Không truy cập được camera: ' + (e && e.name || ''), 'bad'); }
  },
  'bk-export': () => { const d = new Date(); saveFile(`gio-the-sao-luu-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}.json`, 'application/json', JSON.stringify({ app: 'gio-the', version: 1, savedAt: d.toISOString(), data: { classes: S.classes, sets: S.sets, results: S.results, settings: S.settings } }, null, 1)); },
  'bk-import': () => $('#jsonInput').click(),
  'bk-sample': () => { const smp = sampleData(); S.classes.push(...smp.classes); S.sets.push(...smp.sets); save(); renderSettings(); toast('Đã thêm lớp mẫu và bộ mẫu.'); },
  'bk-reset': el => armed(el, () => { S = normalize({ classes: [], sets: [], results: {}, settings: S.settings, ui: { view: 'settings' } }); saveNow(); renderSettings(); toast('Đã xóa toàn bộ dữ liệu.'); }, 'Không hoàn tác được — bấm lần nữa'),
};
function focusLastQ() { const t = $$('#v-sets textarea[data-in="q-text"]'); if (t.length) { t[t.length - 1].focus(); t[t.length - 1].scrollIntoView({ block: 'center', behavior: 'smooth' }); } }
function moveQ(el, d) { const s = curSet(), q = qOf(el); const i = s.questions.indexOf(q), j = i + d; if (j < 0 || j >= s.questions.length) return; [s.questions[i], s.questions[j]] = [s.questions[j], s.questions[i]]; save(); renderSets(); }

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const f = ACTIONS[el.dataset.act]; if (f) { e.preventDefault(); f(el, e); }
});
const INPUTS = {
  'set-name': el => { const s = curSet(); s.name = el.value; const li = $(`#v-sets .li[data-id="${s.id}"] span`); if (li) li.textContent = el.value; },
  'q-text': el => { qOf(el).text = el.value; refreshPrev(el); },
  'q-choice': el => { qOf(el).choices[+el.dataset.ci] = el.value; refreshPrev(el); },
  'q-explain': el => { qOf(el).explain = el.value; refreshPrev(el); },
  'cls-name': el => { const c = curClass(); c.name = el.value; const li = $(`#v-classes .li[data-id="${c.id}"] span`); if (li) li.textContent = el.value; },
  'st-name': el => { curClass().students[+el.dataset.i].name = el.value; },
};
document.addEventListener('input', e => { const el = e.target.closest('[data-in]'); if (!el) return; const f = INPUTS[el.dataset.in]; if (f) { f(el); save(); } });
const CHANGES = {
  'st-card': el => { const c = curClass(); c.students[+el.dataset.i].card = parseInt(el.value, 10) || 0; renderClasses(); },
  'pr-class': el => { S.ui.print.classId = el.value; renderPrint(); },
  'pr-names': el => { S.ui.print.names = el.checked; renderPrint(); },
  'pr-from': el => { S.ui.print.from = parseInt(el.value, 10) || 1; renderPrint(); },
  'pr-to': el => { S.ui.print.to = parseInt(el.value, 10) || 1; renderPrint(); },
  'rep-class': el => { S.ui.repClass = el.value; renderReport(); },
  'rep-set': el => { S.ui.repSet = el.value; renderReport(); },
  'set-cam': el => { S.settings.camId = el.value; if (cam.stream) { stopCamera(); } },
  'set-proc': el => { S.settings.procWidth = +el.value; },
  'set-confirm': el => { S.settings.confirm = +el.value; },
  'set-letters': el => { S.settings.showLetters = el.checked; },
  'set-tile': el => { S.settings.tileLetters = el.checked; },
  'set-mirror': el => { S.settings.mirror = el.checked; },
  'set-sound': el => { S.settings.sound = el.checked; if (el.checked) beep(); },
  'q-time': el => { const q = qOf(el); q.time = el.value === '' ? null : +el.value; },
  'set-autonext': el => { S.settings.autoNext = el.checked; },
  'gem-model': el => { S.settings.geminiModel = el.value; },
  'set-autosum': el => { S.settings.autoSummary = el.checked; },
  'set-tdef': el => { S.settings.timeDef = +el.value; },
  'set-tauto': el => { S.settings.timeAuto = el.checked; },
  'set-ttick': el => { S.settings.timeTick = el.checked; if (el.checked) { tone(1500, 0.025, 0.07, 'square'); tone(1046, 0.09, 0.22, 'square', 0.25); } },
  'set-tend': el => { S.settings.timeEndSound = el.checked; if (el.checked) { tone(784, 0.18, 0.3, 'triangle', 0); tone(988, 0.18, 0.3, 'triangle', 0.2); tone(1319, 0.5, 0.35, 'triangle', 0.4); } },
  'set-tstop': el => { S.settings.timeStopScan = el.checked; },
  'set-trev': el => { S.settings.timeReveal = el.checked; },
};
document.addEventListener('change', e => { const el = e.target.closest('[data-chg]'); if (!el) return; const f = CHANGES[el.dataset.chg]; if (f) { f(el); save(); } });
$('#setFileInput').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    addImportedSets(parseSetJSON(await f.text()));
  } catch (err) { console.warn(err); toast('File chưa đúng định dạng bộ câu hỏi Giơ Thẻ (xem file mẫu Mau-bo-cau-hoi-GioThe.json).', 'bad'); }
});
$('#jsonInput').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text()); const d = j && j.data ? j.data : j;
    if (!d || !Array.isArray(d.classes) || !Array.isArray(d.sets)) throw new Error('format');
    S = normalize({ ...d, live: {}, ui: { view: 'settings' } }); saveNow(); applySkin(); renderSettings();
    toast(`Đã nhập: ${S.classes.length} lớp, ${S.sets.length} bộ câu hỏi.`);
  } catch (err) { toast('File không đúng định dạng sao lưu của Giơ Thẻ.', 'bad'); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && cam.scanning) pauseScan(); });

/* ================= LIÊN KẾT ĐIỆN THOẠI ↔ MÁY CHIẾU (chỉ ở bản trên Claude) =================
   Laptop ghi "live" (lớp, câu đang chiếu); điện thoại ghi "resp" (kết quả quét) và "cmd" (điều khiển).
   Tất cả nằm trong vùng riêng của tài khoản: data/users/<id>/… */
const LINK = { db: null, uid: null, ready: false, unsub: [], lastLiveJSON: '', lastCmdSeq: null, phoneSeen: 0, ph: { live: null, key: '', acc: {}, marks: [], img: null, busy: false } };
function docWriter(ref) {
  let busy = false, pending = null;
  const run = async data => {
    busy = true;
    try { await ref.set(data); } catch (e) { if (e && e.code === 'unavailable') { await new Promise(r => setTimeout(r, 400 + Math.random() * 600)); try { await ref.set(data); } catch (e2) { } } else console.warn('db', e); }
    busy = false;
    if (pending) { const p = pending; pending = null; run(p); }
  };
  return data => { if (busy) pending = data; else run(data); };
}
async function initLink() {
  if (!(window.claude && typeof window.claude.use === 'function')) return;
  try {
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    if (!db || !user) return;
    const uid = await user.id(); if (!uid) return;
    LINK.db = db; LINK.uid = uid; LINK.ready = true;
    const base = 'data/users/' + uid + '/';
    LINK.liveRef = db.doc(base + 'live'); LINK.respRef = db.doc(base + 'resp'); LINK.cmdRef = db.doc(base + 'cmd');
    LINK.writeLive = docWriter(LINK.liveRef); LINK.writeResp = docWriter(LINK.respRef); LINK.writeCmd = docWriter(LINK.cmdRef);
    $('#tabScan').hidden = false; $('#btnLink').hidden = false;
    if (S.ui.link) startLaptopLink();
    if (S.ui.view === 'scan' || S.ui.role === 'phone') show('scan');
    updateLinkPill();
  } catch (e) { console.warn('link', e); }
}

/* ---------- phía laptop ---------- */
function startLaptopLink() {
  if (!LINK.ready || LINK.laptopOn) return;
  LINK.laptopOn = true; S.ui.link = true; save();
  LINK.unsub.push(LINK.respRef.onSnapshot(snap => {
    if (!snap.exists) return;
    const d = snap.data(); if (!d || !d.key || !d.resp) return;
    LINK.phoneSeen = Date.now(); updateLinkPill();
    const [clsId, qid] = d.key.split('|');
    const { cls, q } = liveCtx();
    if (cls && q && cls.id === clsId && q.id === qid) {
      for (const k in d.resp) commit(+k, d.resp[k]);
    } else if (getClass(clsId)) {
      const r = resultOf(clsId, qid, true); let ch = false;
      for (const k in d.resp) if (r.resp[k] !== d.resp[k]) { r.resp[k] = d.resp[k]; ch = true; }
      if (ch) save();
    }
  }, e => console.warn('resp', e)));
  LINK.unsub.push(LINK.cmdRef.onSnapshot(snap => {
    const d = snap.exists ? snap.data() : null;
    const seq = d && d.seq || 0;
    if (LINK.lastCmdSeq === null) { LINK.lastCmdSeq = seq; return; }   // bỏ qua lệnh cũ có sẵn
    if (seq <= LINK.lastCmdSeq) return;
    LINK.lastCmdSeq = seq; LINK.phoneSeen = Date.now(); updateLinkPill();
    if (Date.now() - (d.at || 0) > 120000) return;
    if (S.ui.view !== 'live') show('live');
    if (d.act === 'next') gotoQ(S.live.qIndex + 1);
    else if (d.act === 'prev') gotoQ(S.live.qIndex - 1);
    else if (d.act === 'reveal') toggleReveal();
    else if (d.act === 'redo') { const { cls, q } = liveCtx(); if (cls && q && S.results[cls.id]) { delete S.results[cls.id][q.id]; save(); renderLive(); } }
  }, e => console.warn('cmd', e)));
  LINK.lastLiveJSON = ''; linkPublish(); updateLinkPill();
}
function stopLaptopLink() {
  LINK.unsub.forEach(u => { try { u(); } catch (e) { } }); LINK.unsub = []; LINK.laptopOn = false; LINK.lastCmdSeq = null;
  S.ui.link = false; save();
  if (LINK.ready) LINK.writeLive({ on: false, at: Date.now() });
  updateLinkPill();
}
function linkPublish() {
  if (typeof plPublish === 'function') plPublish();
  if (!LINK.laptopOn) return;
  const { cls, set, q, qi, qs } = liveCtx();
  const r = cls && q ? resultOf(cls.id, q.id) : null;
  const live = cls && q ? {
    on: true, key: cls.id + '|' + q.id, clsName: cls.name, setName: set ? set.name : '',
    roster: sortedStudents(cls).map(s => [s.card, s.name]), qi, qn: qs.length, text: q.text, choices: q.choices,
    graded: isGraded(q), correct: q.correct, revealed: !!(r && r.revealed), explain: q.explain || ''
  } : { on: true, key: '', clsName: cls ? cls.name : '', setName: set ? set.name : '', roster: [], qi: 0, qn: 0 };
  const json = JSON.stringify(live);
  if (json === LINK.lastLiveJSON) return;
  LINK.lastLiveJSON = json; LINK.writeLive({ ...live, at: Date.now() });
}
function linkResetResp(clsId, qid) {
  if (!LINK.laptopOn) return;
  LINK.writeResp({ key: clsId + '|' + qid, resp: {}, at: Date.now() });
}
function updateLinkPill() {
  const b = $('#btnLink'); if (!b || b.hidden) return;
  const usePL = !IN_FRAME;
  const on = usePL ? PL.on : LINK.laptopOn, recent = usePL ? plPhoneOnline() : Date.now() - LINK.phoneSeen < 10 * 60 * 1000;
  b.className = 'btn small ' + (on ? 'linked' : '');
  b.innerHTML = `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>${on ? (recent ? 'Điện thoại: đã kết nối' : 'Điện thoại: chờ kết nối') : 'Liên kết điện thoại'}`;
}
setInterval(updateLinkPill, 30000);
function openLinkModal() {
  const back = openModal(`<div class="modal-head"><h2>Liên kết điện thoại với máy chiếu</h2><button class="icon" data-act="modal-close" aria-label="Đóng">×</button></div>
    <p style="margin:0">Điện thoại chụp ảnh lớp, kết quả hiện ngay trên màn hình này. Điện thoại cũng dùng để chuyển câu và công bố đáp án. Cả hai máy cần có mạng.</p>
    <div class="steps-box">
      <div><span class="n">1</span>Bật liên kết trên máy này: <button class="btn ${LINK.laptopOn ? '' : 'primary'} small" id="linkToggle">${LINK.laptopOn ? 'Tắt liên kết' : 'Bật liên kết'}</button></div>
      <div><span class="n">2</span>Trên điện thoại, mở <b>đúng link bản Giơ Thẻ này</b> (trong ứng dụng Claude hoặc trình duyệt), đăng nhập <b>cùng tài khoản Claude</b>.</div>
      <div><span class="n">3</span>Trên điện thoại chọn tab <b>“Quét bằng ĐT”</b>. Màn hình sẽ hiện đúng câu đang chiếu.</div>
      <div><span class="n">4</span>Học sinh giơ thẻ → bấm <b>“Chụp ảnh lớp”</b> trên điện thoại. Có thể chụp vài tấm từ các góc khác nhau, kết quả được cộng dồn.</div>
    </div>
    <p class="hint" style="margin:0">Lớp học và câu hỏi lấy từ máy chiếu này. Nếu đã soạn trong file GioThe.html trên máy, vào Cài đặt → “Xuất bản sao lưu” ở file đó rồi “Nhập bản sao lưu” ở đây.</p>`);
  $('#linkToggle', back).addEventListener('click', () => { LINK.laptopOn ? stopLaptopLink() : startLaptopLink(); closeModal(); toast(LINK.laptopOn ? 'Đã bật liên kết. Mở tab “Quét bằng ĐT” trên điện thoại.' : 'Đã tắt liên kết.'); });
}
$('#btnLink').addEventListener('click', () => IN_FRAME ? openLinkModal() : plOpenModal());

/* ---------- phía điện thoại ---------- */
function startPhone() {
  if (!LINK.ready || LINK.phoneOn) return;
  LINK.phoneOn = true;
  LINK.phoneUnsub = LINK.liveRef.onSnapshot(snap => {
    const d = snap.exists ? snap.data() : null;
    const ph = LINK.ph; const oldKey = ph.key;
    ph.live = d && d.on ? d : null;
    ph.key = ph.live ? ph.live.key : '';
    if (ph.key !== oldKey) { ph.acc = {}; ph.marks = []; ph.img = null; loadAcc(); }
    if (S.ui.view === 'scan') renderScan();
  }, e => { console.warn('live', e); });
}
async function loadAcc() {
  const ph = LINK.ph; const key = ph.key; if (!key) return;
  try { const s = await LINK.respRef.get(); const d = s.exists ? s.data() : null; if (d && d.key === key && ph.key === key) { ph.acc = { ...d.resp }; if (S.ui.view === 'scan') renderScan(); } } catch (e) { }
}
function sendCmd(act) { LINK.writeCmd({ act, seq: Date.now(), at: Date.now() }); toast({ next: 'Đã chuyển câu tiếp', prev: 'Đã lùi một câu', reveal: 'Đã gửi lệnh công bố / ẩn đáp án', redo: 'Đã xóa kết quả câu này' }[act] || 'Đã gửi'); }
function renderScan() {
  startPhone();
  S.ui.role = 'phone'; save();
  const el = $('#v-scan'); const ph = LINK.ph; const L = ph.live;
  if (!LINK.ready) { el.innerHTML = `<div class="scan-wrap">${emptyState('Chỉ dùng ở bản trên Claude', 'Chế độ này cần mở Giơ Thẻ qua link trên Claude.', '', '')}</div>`; return; }
  if (!L) {
    el.innerHTML = `<div class="scan-wrap"><div class="link-pill wait"><span class="dotl"></span>Đang chờ máy chiếu…</div>
      ${emptyState('Chưa thấy máy chiếu', 'Trên laptop: mở cùng link này, vào <b>Trình chiếu</b> → bấm <b>“Liên kết điện thoại”</b> → <b>Bật liên kết</b>. Màn hình này sẽ tự cập nhật.', '', '')}
      <button class="btn ghost" data-act="scan-leave">Dùng điện thoại như máy chiếu (thoát chế độ quét)</button></div>`;
    return;
  }
  if (!L.key) { el.innerHTML = `<div class="scan-wrap"><div class="link-pill"><span class="dotl"></span>Đã kết nối · ${esc(L.clsName)}</div>${emptyState('Máy chiếu chưa có câu hỏi', 'Chọn lớp và bộ câu hỏi trên laptop.', '', '')}</div>`; return; }
  const roster = L.roster || []; const nameOf = Object.fromEntries(roster);
  const got = roster.filter(([c]) => ph.acc[c]).length;
  const missing = roster.filter(([c]) => !ph.acc[c]);
  const counts = [0, 0, 0, 0]; Object.values(ph.acc).forEach(a => { const i = LET.indexOf(a); if (i >= 0) counts[i]++; });
  el.innerHTML = `<div class="scan-wrap">
    <div class="link-pill"><span class="dotl"></span>Đã kết nối máy chiếu · ${esc(L.clsName)}</div>
    <div class="scan-q"><div class="qmeta"><span class="qnum">Câu ${L.qi + 1}/${L.qn}</span>${L.revealed ? '<span class="qtype">Đang công bố đáp án</span>' : ''}</div>
      <div class="scan-text">${mathHTML(L.text)}</div>
      <ol class="scan-ch">${(L.choices || []).map((c, i) => `<li class="${L.revealed && (L.correct || []).includes(i) ? 'ok' : ''}"><span class="letter l${i}">${LET[i]}</span><span>${mathHTML(c)}</span>${L.revealed ? `<b class="pct">${counts[i]}</b>` : ''}</li>`).join('')}</ol></div>
    <button class="shot-btn" data-act="scan-shot" ${ph.busy ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="4"/></svg>${ph.busy ? 'Đang nhận thẻ…' : 'Chụp ảnh lớp'}</button>
    <div class="scan-count"><b>${got}</b>/${roster.length} em đã được nhận${ph.lastMsg ? ` · <span>${esc(ph.lastMsg)}</span>` : ''}</div>
    ${ph.img ? `<div class="scan-photo"><canvas id="scanCanvas"></canvas></div>` : '<p class="hint" style="margin:0;text-align:center">Đứng ở đầu lớp, chụp sao cho thấy rõ các thẻ. Thiếu em nào thì chụp thêm tấm nữa, kết quả được cộng dồn.</p>'}
    ${missing.length && got ? `<div class="miss"><span class="hint">Chưa nhận (${missing.length}):</span> ${missing.map(([c, n]) => `<span class="chip">${c} · ${esc(givenName(n))}</span>`).join('')}</div>` : ''}
    <div class="scan-ctrl"><button class="btn" data-act="scan-prev" ${L.qi <= 0 ? 'disabled' : ''}>← Câu trước</button><button class="btn chalk" data-act="scan-reveal">${L.revealed ? 'Ẩn đáp án' : 'Hiện đáp án'}</button><button class="btn" data-act="scan-next" ${L.qi >= L.qn - 1 ? 'disabled' : ''}>Câu sau →</button></div>
    <button class="btn small ghost" data-act="scan-redo" style="justify-self:center">Xóa kết quả câu này</button>
  </div>`;
  if (ph.img) drawScanPhoto();
}
function drawScanPhoto() {
  const ph = LINK.ph; const cv = $('#scanCanvas'); if (!cv || !ph.img) return;
  cv.width = ph.img.width; cv.height = ph.img.height;
  const g = cv.getContext('2d'); g.drawImage(ph.img, 0, 0);
  const lw = Math.max(3, cv.width / 300); g.lineWidth = lw; g.font = `700 ${Math.round(lw * 6)}px sans-serif`; g.textAlign = 'center';
  for (const m of ph.marks) {
    const col = m.state === 'ok' ? '#17A54C' : m.state === 'invalid' ? '#F04848' : '#9AA3C0';
    g.strokeStyle = col; g.beginPath(); m.corners.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); g.stroke();
    const cx = m.corners.reduce((a, p) => a + p.x, 0) / 4, top = Math.min(...m.corners.map(p => p.y));
    const t = (m.state === 'unknown' ? '?' : '') + m.card; const w = g.measureText(t).width + lw * 4;
    g.fillStyle = col; g.fillRect(cx - w / 2, top - lw * 9, w, lw * 7.5); g.fillStyle = '#fff'; g.fillText(t, cx, top - lw * 3);
  }
}
async function phoneShot(file) {
  const ph = LINK.ph; const L = ph.live; if (!L || !L.key) return;
  ph.busy = true; ph.lastMsg = ''; renderScan();
  try {
    let src, w, h;
    try { src = await createImageBitmap(file); w = src.width; h = src.height; }
    catch (e) { src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); }); w = src.naturalWidth; h = src.naturalHeight; }
    const sc = Math.min(1, 2400 / Math.max(w, h)); const cw = Math.round(w * sc), ch = Math.round(h * sc);
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; cv.getContext('2d').drawImage(src, 0, 0, cw, ch);
    await new Promise(r => setTimeout(r, 20));
    const marks = detectMultiScale(cv, cw, ch);
    const roster = new Set((L.roster || []).map(r => r[0])); const nch = (L.choices || []).length;
    let added = 0, changed = 0;
    for (const m of marks) {
      if (!roster.has(m.card)) { m.state = 'unknown'; continue; }
      if (m.ai >= nch) { m.state = 'invalid'; continue; }
      m.state = 'ok';
      if (!ph.acc[m.card]) added++; else if (ph.acc[m.card] !== m.letter) changed++;
      ph.acc[m.card] = m.letter;
    }
    ph.marks = marks; ph.img = cv;
    const okN = marks.filter(m => m.state === 'ok').length;
    ph.lastMsg = okN ? `ảnh này: ${okN} thẻ${added ? `, thêm ${added} em` : ''}${changed ? `, ${changed} em đổi đáp án` : ''}` : 'không thấy thẻ nào — chụp gần hơn, đủ sáng';
    if (okN) { LINK.writeResp({ key: L.key, resp: { ...ph.acc }, at: Date.now() }); beep(); }
  } catch (e) { console.error(e); ph.lastMsg = 'không đọc được ảnh'; }
  ph.busy = false; renderScan();
}
Object.assign(ACTIONS, {
  'scan-shot': () => $('#phoneShot').click(),
  'scan-next': () => sendCmd('next'), 'scan-prev': () => sendCmd('prev'), 'scan-reveal': () => sendCmd('reveal'),
  'scan-redo': el => armed(el, () => { const ph = LINK.ph; ph.acc = {}; ph.marks = []; ph.img = null; if (ph.key) LINK.writeResp({ key: ph.key, resp: {}, at: Date.now() }); sendCmd('redo'); renderScan(); }, 'Bấm lần nữa để xóa'),
  'scan-leave': () => { S.ui.role = ''; save(); show('live'); },
});
$('#phoneShot').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) phoneShot(f); });
RENDER.scan = renderScan;

/* ================= LIÊN KẾT ĐIỆN THOẠI KIỂU PLICKERS (MQTT qua Internet) =================
   Laptop (GioThe.html) hiện mã QR → điện thoại mở trang quét (#scan=MÃ) → camera điện thoại quét trực tiếp,
   gửi số thẻ + chữ cái về laptop ngay lập tức. Tên học sinh không rời khỏi laptop. */
const PL_BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081'];
const PL = { client: null, url: '', idx: -1, room: '', on: false, lastJSON: '', phoneSeen: 0, connecting: false };
const plRand = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
const plTopic = (room, t) => `giothe/v1/${room}/${t}`;
const PHONE_MODE = /^#scan=/.test(location.hash);
function plCustomBroker() { try { return new URLSearchParams(location.search).get('broker') || S.settings.brokerUrl || ''; } catch (e) { return ''; } }
function plConnectAny(urls, onMsg) {
  return new Promise(async (resolve, reject) => {
    for (let i = 0; i < urls.length; i++) {
      const c = await new Promise(res => {
        let done = false; const cl = window.mqtt.connect(urls[i], { reconnectPeriod: 2000, connectTimeout: 7000, clean: true, clientId: 'gt_' + plRand(10) });
        const t = setTimeout(() => { if (!done) { done = true; try { cl.end(true); } catch (e) { } res(null); } }, 8000);
        cl.once('connect', () => { if (done) return; done = true; clearTimeout(t); res(cl); });
        cl.once('error', () => { if (done) return; done = true; clearTimeout(t); try { cl.end(true); } catch (e) { } res(null); });
      });
      if (c) { if (onMsg) c.on('message', onMsg); return resolve({ client: c, idx: i, url: urls[i] }); }
    }
    reject(new Error('Không kết nối được máy chủ liên kết. Kiểm tra mạng Internet.'));
  });
}
function plWebBase() {
  if ((location.protocol === 'https:' || location.hostname === 'localhost') && !IN_FRAME) return location.href.split('#')[0];
  const u = (S.settings.webUrl || '').trim(); if (!u) return '';
  return /^https:\/\//i.test(u) ? u.split('#')[0] : '';
}

/* ---------- phía laptop ---------- */
async function plStart() {
  if (PL.on || PL.connecting) return;
  if (!window.mqtt) { toast('Thiếu bộ kết nối. Hãy tải lại trang.', 'bad'); return; }
  PL.connecting = true; updateLinkPill(); plRenderModal();
  PL.room = S.ui.plRoom || (S.ui.plRoom = plRand(10)); save();
  const custom = plCustomBroker();
  try {
    const r = await plConnectAny(custom ? [custom] : PL_BROKERS, plOnMessage);
    PL.client = r.client; PL.idx = custom ? -1 : r.idx; PL.url = r.url; PL.on = true;
    PL.client.subscribe(plTopic(PL.room, 'up/#'));
    PL.client.on('connect', () => { PL.client.subscribe(plTopic(PL.room, 'up/#')); PL.lastJSON = ''; plPublish(); updateLinkPill(); plRenderModal(); });
    PL.client.on('offline', () => { updateLinkPill(); plRenderModal(); });
    PL.lastJSON = ''; plPublish();
  } catch (e) { toast(e.message, 'bad'); }
  PL.connecting = false; updateLinkPill(); plRenderModal();
}
function plStop() {
  if (PL.client) { try { PL.client.publish(plTopic(PL.room, 'state'), JSON.stringify({ off: true, t: Date.now() }), { retain: true }); PL.client.end(); } catch (e) { } }
  PL.client = null; PL.on = false; PL.phoneSeen = 0; updateLinkPill(); plRenderModal();
}
function plPublish() {
  if (!PL.on || !PL.client || !PL.client.connected) return;
  const { cls, set, q, qi, qs } = liveCtx();
  const r = cls && q ? resultOf(cls.id, q.id) : null;
  const roster = cls ? sortedStudents(cls).map(s => s.card) : [];
  const got = r ? Object.keys(r.resp).map(Number).filter(c => roster.includes(c) && LET.indexOf(r.resp[c]) < (q ? q.choices.length : 0)) : [];
  const st = cls && q ? { key: cls.id + '|' + q.id, cls: cls.name, qi, qn: qs.length, text: q.text, choices: q.choices, cards: roster, got, revealed: !!(r && r.revealed), correct: r && r.revealed ? q.correct : [] } : { key: '', cls: cls ? cls.name : '', qi: 0, qn: 0, cards: [], got: [] };
  const json = JSON.stringify(st); if (json === PL.lastJSON) return; PL.lastJSON = json;
  PL.client.publish(plTopic(PL.room, 'state'), JSON.stringify({ ...st, t: Date.now() }), { retain: true });
}
function plOnMessage(topic, buf) {
  let m; try { m = JSON.parse(buf.toString()); } catch (e) { return; }
  const kind = topic.split('/').pop();
  PL.phoneSeen = Date.now(); updateLinkPill(); if ($('#plStatus')) plRenderStatus();
  if (kind === 'ans' && Array.isArray(m.a)) {
    const { cls, q } = liveCtx(); if (!cls || !q) return;
    const roster = new Set(cls.students.map(s => s.card));
    if (m.key === cls.id + '|' + q.id) { for (const [c, l] of m.a) if (roster.has(+c) && LET.indexOf(l) >= 0 && LET.indexOf(l) < q.choices.length) commit(+c, l); }
  } else if (kind === 'cmd') {
    if (Date.now() - (m.t || 0) > 60000) return;
    if (S.ui.view !== 'live') show('live');
    closeModal();
    if (m.act === 'next') nextOrSummary(); else if (m.act === 'prev') gotoQ(S.live.qIndex - 1); else if (m.act === 'reveal') toggleReveal();
  }
}
function plPhoneOnline() { return PL.on && Date.now() - PL.phoneSeen < 15000; }
setInterval(() => { updateLinkPill(); if ($('#plStatus')) plRenderStatus(); }, 5000);

function plOpenModal() {
  openModal(`<div class="modal-head"><h2>Liên kết điện thoại (quét trực tiếp)</h2><button class="icon" data-act="modal-close" aria-label="Đóng">×</button></div><div id="plBody"></div>`);
  if (!PL.on && plWebBase()) plStart();
  plRenderModal();
}
function plRenderStatus() {
  const el = $('#plStatus'); if (!el) return;
  const conn = PL.on && PL.client && PL.client.connected;
  el.className = 'pl-status ' + (plPhoneOnline() ? 'ok' : conn ? 'wait' : 'off');
  el.innerHTML = plPhoneOnline() ? '<span class="dotl"></span>Điện thoại đã kết nối — bắt đầu quét trên điện thoại' : conn ? '<span class="dotl"></span>Đang chờ điện thoại quét mã…' : (PL.connecting ? '<span class="spinner"></span>Đang kết nối máy chủ liên kết…' : '<span class="dotl"></span>Chưa bật liên kết');
}
function plRenderModal() {
  const box = $('#plBody'); if (!box) return;
  const base = plWebBase();
  if (!base) {
    box.innerHTML = `<p style="margin:0">Điện thoại chỉ được mở camera trên trang web có địa chỉ <b>https</b>. Cần đưa Giơ Thẻ lên mạng <b>một lần</b> (miễn phí), sau đó chỉ việc quét mã.</p>
      <div class="steps-box">
        <div><span class="n">1</span>Vào <a href="https://app.netlify.com/drop" target="_blank" rel="noopener"><b>app.netlify.com/drop</b></a>, đăng nhập bằng tài khoản Google (miễn phí).</div>
        <div><span class="n">2</span>Kéo thả thư mục <b>“Gio-The-web”</b> (trong thư mục Giơ Thẻ trên máy, có sẵn file index.html) vào khung trên trang.</div>
        <div><span class="n">3</span>Netlify cho một địa chỉ dạng <code>https://…netlify.app</code>. Sao chép địa chỉ đó, dán vào ô dưới.</div>
      </div>
      <label class="field">Địa chỉ trang Giơ Thẻ trên mạng<input id="plUrl" placeholder="https://ten-trang.netlify.app" value="${esc(S.settings.webUrl || '')}"></label>
      <div class="add-row"><button class="btn primary" id="plSave">Lưu và tạo mã QR</button></div>
      <p class="hint" style="margin:0">Mỗi lần mình cập nhật Giơ Thẻ, kéo thả lại thư mục mới vào trang quản lý của Netlify (mục Deploys) để điện thoại dùng bản mới.</p>`;
    $('#plSave').onclick = () => { const v = $('#plUrl').value.trim(); if (!/^https:\/\/[^\s]+\.[^\s]+/i.test(v)) { toast('Địa chỉ phải bắt đầu bằng https://', 'bad'); return; } S.settings.webUrl = v.replace(/#.*$/, ''); save(); plStart(); plRenderModal(); };
    return;
  }
  const custom = plCustomBroker();
  const link = `${base}#scan=${PL.room || S.ui.plRoom || ''}${PL.idx >= 0 ? '&b=' + PL.idx : ''}${custom ? '&bu=' + encodeURIComponent(custom) : ''}`;
  let qrSvg = '';
  if (PL.on && window.qrcode) { const qr = window.qrcode(0, 'M'); qr.addData(link); qr.make(); qrSvg = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); }
  box.innerHTML = `<div class="pl-grid">
      <div class="pl-qr">${qrSvg || '<div class="gen-status"><span class="spinner"></span>Đang tạo mã…</div>'}</div>
      <div style="display:grid;gap:12px;align-content:start;min-width:0">
        <div id="plStatus"></div>
        <ol class="steps" style="padding-left:18px">
          <li>Mở camera điện thoại (hoặc Zalo) <b>quét mã QR</b> bên trái, mở link bằng <b>Chrome / Safari</b>.</li>
          <li>Cho phép dùng camera, bấm <b>“Bắt đầu quét”</b> rồi lia qua cả lớp. Kết quả hiện ngay trên màn hình này.</li>
          <li>Trên điện thoại có nút <b>chuyển câu</b> và <b>hiện đáp án</b>.</li>
        </ol>
        <div class="pl-link"><code>${esc(link)}</code></div>
        <div class="add-row"><button class="btn small" id="plCopy">Sao chép link</button><button class="btn small" id="plNew">Đổi mã phòng</button>${location.protocol === 'https:' || location.hostname === 'localhost' ? '' : '<button class="btn small" id="plEditUrl">Sửa địa chỉ trang</button>'}${PL.on ? '<button class="btn small danger-ghost" id="plOff">Tắt liên kết</button>' : '<button class="btn small primary" id="plOnBtn">Bật liên kết</button>'}</div>
        <p class="hint" style="margin:0">Hai máy nối qua Internet bằng mã phòng ngẫu nhiên. Chỉ số thẻ, chữ cái đáp án và nội dung câu hỏi được gửi đi; <b>tên học sinh không rời khỏi máy này</b>.</p>
      </div></div>`;
  plRenderStatus();
  $('#plCopy').onclick = () => copyText(link, 'Đã sao chép link quét.');
  $('#plNew').onclick = () => { plStop(); S.ui.plRoom = plRand(10); save(); plStart(); };
  if ($('#plEditUrl')) $('#plEditUrl').onclick = () => { if (location.protocol === 'https:') { toast('Đang dùng chính trang này làm địa chỉ quét.'); return; } S.settings.webUrl = ''; save(); plStop(); plRenderModal(); };
  const off = $('#plOff'); if (off) off.onclick = () => plStop();
  const onb = $('#plOnBtn'); if (onb) onb.onclick = () => plStart();
}

/* ---------- phía điện thoại ---------- */
const PH = { client: null, room: '', st: null, sent: {}, seen: new Map(), scanning: false, stream: null, timer: 0, wake: null, lastKey: '', boxes: [] };
function phoneBoot() {
  document.body.classList.add('phone-mode');
  $('#app').hidden = true;
  const h = new URLSearchParams(location.hash.slice(1));
  PH.room = (h.get('scan') || '').replace(/[^a-z0-9]/g, '');
  const b = h.get('b'), bu = h.get('bu');
  const wrap = document.createElement('div'); wrap.id = 'phoneApp';
  wrap.innerHTML = `<div class="ph-top"><span class="ph-dot" id="phDot"></span><b id="phStatus">Đang kết nối…</b><span class="grow"></span><span class="ph-q" id="phQ"></span></div>
    <div class="ph-cam" id="phCam"><video id="pvideo" playsinline muted></video><canvas id="poverlay"></canvas><div class="ph-hint" id="phHint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="4"/></svg>Bấm “Bắt đầu quét” rồi lia chậm qua các thẻ</div></div>
    <div class="ph-text" id="phText"></div>
    <div class="ph-count"><b id="phGot">0</b><span>/<span id="phTot">0</span> thẻ đã nhận</span></div>
    <div class="ph-grid" id="phGrid"></div>
    <div class="ph-ctrl"><button class="btn" id="phPrev" aria-label="Câu trước">‹ Câu trước</button><button class="btn" id="phReveal">Đáp án</button><button class="btn" id="phNext" aria-label="Câu sau">Câu sau ›</button></div>
    <button class="ph-scan" id="phScan">Bắt đầu quét</button>`;
  document.body.appendChild(wrap);
  $('#phScan').onclick = () => PH.scanning ? phStop() : phStart();
  $('#phPrev').onclick = () => phCmd('prev'); $('#phNext').onclick = () => phCmd('next'); $('#phReveal').onclick = () => phCmd('reveal');
  if (!PH.room) { $('#phStatus').textContent = 'Link quét không hợp lệ. Hãy quét lại mã QR.'; return; }
  if (!window.mqtt) { $('#phStatus').textContent = 'Thiếu bộ kết nối. Tải lại trang.'; return; }
  const urls = bu ? [bu] : (b != null && PL_BROKERS[+b] ? [PL_BROKERS[+b]] : PL_BROKERS);
  plConnectAny(urls, phOnMessage).then(r => {
    PH.client = r.client;
    const sub = () => PH.client.subscribe(plTopic(PH.room, 'state'));
    sub(); PH.client.on('connect', () => { sub(); phStatus(); }); PH.client.on('offline', phStatus);
    phHello(); setInterval(phHello, 4000); phStatus();
  }).catch(e => { $('#phStatus').textContent = e.message; $('#phDot').className = 'ph-dot bad'; });
}
function phStatus() {
  const ok = PH.client && PH.client.connected, has = PH.st && !PH.st.off;
  $('#phDot').className = 'ph-dot ' + (ok && has ? 'ok' : ok ? 'wait' : 'bad');
  $('#phStatus').textContent = !ok ? 'Mất kết nối — đang thử lại…' : !has ? 'Đang chờ máy chiếu…' : (PH.st.cls || 'Đã kết nối');
}
function phHello() { if (PH.client && PH.client.connected) PH.client.publish(plTopic(PH.room, 'up/hi'), JSON.stringify({ t: Date.now(), scanning: PH.scanning })); }
function phCmd(act) { if (!PH.client || !PH.client.connected) return; PH.client.publish(plTopic(PH.room, 'up/cmd'), JSON.stringify({ act, t: Date.now() })); if (navigator.vibrate) navigator.vibrate(20); }
function phOnMessage(topic, buf) {
  let m; try { m = JSON.parse(buf.toString()); } catch (e) { return; }
  PH.st = m;
  if (m.key !== PH.lastKey) { const first = !PH.lastKey; PH.lastKey = m.key; PH.sent = {}; PH.seen.clear(); if (!first && PH.scanning) { PH.holdUntil = performance.now() + 2000; toast('Câu mới — chờ 2 giây cho học sinh giơ đáp án mới'); } }
  const got = new Set(m.got || []);
  for (const c in PH.sent) if (!got.has(+c)) delete PH.sent[c];   // GV xóa kết quả → cho phép gửi lại
  phRender(); phStatus();
}
function phRender() {
  const s = PH.st; if (!s || s.off) { $('#phQ').textContent = ''; $('#phText').innerHTML = ''; $('#phGrid').innerHTML = ''; return; }
  $('#phQ').textContent = s.key ? `Câu ${s.qi + 1}/${s.qn}` : '';
  $('#phText').innerHTML = s.key ? `${mathHTML(s.text)}${s.revealed ? `<div class="ph-ans">Đáp án: ${(s.correct || []).map(i => LET[i]).join(', ') || 'khảo sát'}</div>` : ''}` : 'Máy chiếu chưa chọn câu hỏi.';
  const got = new Set(s.got || []);
  $('#phGot').textContent = got.size; $('#phTot').textContent = (s.cards || []).length;
  $('#phGrid').innerHTML = (s.cards || []).map(c => `<span class="${got.has(c) ? 'on' : ''}">${c}</span>`).join('');
  $('#phReveal').textContent = s.revealed ? 'Ẩn đáp án' : 'Đáp án';
  $('#phNext').textContent = s.qn && s.qi >= s.qn - 1 ? 'Kết quả ›' : 'Câu sau ›';
  $('#phPrev').disabled = !s.qi;
}
async function phStart() {
  if (!PH.stream) {
    try { PH.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }); }
    catch (e) { toast('Không mở được camera: ' + (e && e.name === 'NotAllowedError' ? 'chưa cho phép. Bấm biểu tượng ổ khóa trên thanh địa chỉ để cho phép.' : (e && e.name || 'lỗi')), 'bad'); return; }
    const v = $('#pvideo'); v.srcObject = PH.stream; try { await v.play(); } catch (e) { }
  }
  PH.scanning = true; $('#phHint').hidden = true; $('#phScan').textContent = 'Dừng quét'; $('#phScan').classList.add('stop');
  try { PH.wake = await navigator.wakeLock.request('screen'); } catch (e) { }
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { }
  phHello(); phLoop();
}
function phStop() {
  PH.scanning = false; clearTimeout(PH.timer); $('#phScan').textContent = 'Bắt đầu quét'; $('#phScan').classList.remove('stop');
  try { PH.wake && PH.wake.release(); } catch (e) { } PH.boxes = []; phDraw(); phHello();
}
const phProc = document.createElement('canvas'); const phCtx = phProc.getContext('2d', { willReadFrequently: true });
function phLoop() {
  if (!PH.scanning) return;
  const v = $('#pvideo'), t0 = performance.now();
  if (v.readyState >= 2 && v.videoWidth) {
    const vw = v.videoWidth, vh = v.videoHeight, w = Math.min(vw, 960), sc = w / vw, h = Math.round(vh * sc);
    if (phProc.width !== w || phProc.height !== h) { phProc.width = w; phProc.height = h; }
    phCtx.drawImage(v, 0, 0, w, h);
    let marks = []; try { marks = detectIn(phCtx.getImageData(0, 0, w, h)); } catch (e) { }
    marks.forEach(m => m.corners = m.corners.map(p => ({ x: p.x / sc, y: p.y / sc })));
    const s = PH.st, cards = new Set(s && s.cards || []), nch = s && s.choices ? s.choices.length : 0, got = new Set(s && s.got || []);
    const now = performance.now(), out = [];
    for (const m of marks) {
      if (!s || !s.key || !cards.has(m.card)) { m.state = 'unknown'; continue; }
      if (m.ai >= nch) { m.state = 'invalid'; continue; }
      let e = PH.seen.get(m.card);
      if (e && e.l === m.letter && now - e.t < 1500) { e.n++; e.t = now; } else { e = { l: m.letter, n: 1, t: now }; PH.seen.set(m.card, e); }
      if (e.n >= 2 && now >= (PH.holdUntil || 0)) {
        m.state = got.has(m.card) && PH.sent[m.card] === m.letter ? 'ok' : 'pending';
        if (PH.sent[m.card] !== m.letter) { PH.sent[m.card] = m.letter; out.push([m.card, m.letter]); }
      } else m.state = 'pending';
    }
    if (out.length && PH.client && PH.client.connected) {
      PH.client.publish(plTopic(PH.room, 'up/ans'), JSON.stringify({ key: s.key, a: out, t: Date.now() }));
      tone(880, 0.07, 0.15); if (navigator.vibrate) navigator.vibrate(25);
    }
    PH.boxes = marks; PH.bw = vw; PH.bh = vh; phDraw();
  }
  PH.timer = setTimeout(phLoop, Math.max(5, 70 - (performance.now() - t0)));
}
function phDraw() {
  const cv = $('#poverlay'), box = $('#phCam'); if (!cv || !box) return;
  const W = box.clientWidth, H = box.clientHeight, dpr = devicePixelRatio || 1;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  if (!PH.boxes.length || !PH.bw) return;
  const s = Math.max(W / PH.bw, H / PH.bh), ox = (W - PH.bw * s) / 2, oy = (H - PH.bh * s) / 2;   // video object-fit: cover
  const col = { ok: '#17A54C', pending: '#FFC93C', unknown: '#9AA3C0', invalid: '#F04848' };
  for (const m of PH.boxes) {
    const P = m.corners.map(p => ({ x: ox + p.x * s, y: oy + p.y * s })), c = col[m.state] || col.unknown;
    g.beginPath(); P.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); g.lineWidth = 3; g.strokeStyle = c; g.stroke();
    const cx = P.reduce((a, p) => a + p.x, 0) / 4, top = Math.min(...P.map(p => p.y)), label = (m.state === 'unknown' ? '?' : '') + m.card;
    g.font = '700 13px sans-serif'; const tw = g.measureText(label).width + 10;
    g.fillStyle = c; g.fillRect(cx - tw / 2, top - 20, tw, 17); g.fillStyle = m.state === 'pending' ? '#2a2104' : '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, cx, top - 11.5);
  }
}
document.addEventListener('visibilitychange', () => { if (PHONE_MODE && !document.hidden && PH.scanning) { navigator.wakeLock && navigator.wakeLock.request('screen').then(w => PH.wake = w).catch(() => { }); } });

/* khởi động */
$('#where').textContent = IN_FRAME ? 'Bản xem · quét bằng ảnh chụp' : (location.protocol === 'https:' ? 'Bản web · dữ liệu lưu trong trình duyệt này' : 'Bản trên máy · dữ liệu lưu trong trình duyệt này');
applySkin();
if (PHONE_MODE) phoneBoot();
else {
  show(S.ui.view || 'live');
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) refreshCameraList();
  initLink();
  if (!IN_FRAME) { $('#btnLink').hidden = false; updateLinkPill(); }
}
if (!IN_FRAME && !PHONE_MODE && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && window.GT_SW) navigator.serviceWorker.register(window.GT_SW).catch(() => { });
window.GioThe = { detectIn, detectMultiScale, upwardSide, cardGroup, pageSVGs, parseQuestions, get state() { return S; } };
