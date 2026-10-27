(function () {
  'use strict';
  const C = window.TRW_CONFIG || {};
  const APP = document.getElementById('app');
  const STORE = { token: 'trw_token_v1', user: 'trw_user_v1', openAttendance: 'trw_open_attendance_v1' };
  const DB_NAME = 'trw_field_db_v1';
  const DB_VERSION = 1;
  const QUEUE_MAX_ITEMS = 150;
  const QUEUE_MAX_BYTES = 64 * 1024 * 1024;
  const QUEUEABLE = new Set(['checkin','checkout','saveVisit','uploadEvidence','saveQualification','savePosm','saveEducation','saveSurvey','saveSpgSurvey','saveCompetitor','saveSpgActivation','saveInteraction','saveIssue']);
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const state = {
    token: localStorage.getItem(STORE.token) || '',
    user: readJson(localStorage.getItem(STORE.user), null),
    page: 'home',
    inputType: '',
    selectedOutlet: null,
    outletList: [],
    dashboard: null,
    reports: null,
    users: [],
    beatPlan: [],
    issues: [],
    attendance: null,
    openAttendance: readJson(localStorage.getItem(STORE.openAttendance), null),
    photos: {},
    signatureData: '',
    signatureDrawn: false,
    signatureCapturedAt: '',
    visitFlow: null,
    activationFlow: null,
    interactionFlowId: '',
    spgSurveyFlowId: '',
    issueFlowId: '',
    lastActivationId: '',
    outletQuery: '',
    outletFilter: 'all',
    reportTab: 'visits',
    periodTab: 'daily',
    loading: false,
    queueCount: 0,
    queueBytes: 0,
    syncing: false,
    online: navigator.onLine,
    message: ''
  };
  let dbPromise = null;
  const postWaiters = new Map();

  function readJson(text, fallback) { try { return text ? JSON.parse(text) : fallback; } catch (_) { return fallback; } }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch])); }
  function uid(prefix) { return (prefix || 'ID') + '-' + (window.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g,'').slice(0,18).toUpperCase() : (Date.now().toString(36) + Math.random().toString(36).slice(2,10)).toUpperCase()); }
  function fmtDate(value) { if (!value) return '—'; const date = new Date(value); if (isNaN(date.getTime())) return String(value); return new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Jakarta'}).format(date); }
  function fmtDateTime(value) { if (!value) return '—'; const date = new Date(value); if (isNaN(date.getTime())) return String(value); return new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jakarta'}).format(date); }
  function fmtNum(value) { return new Intl.NumberFormat('id-ID').format(Number(value || 0)); }
  function localDate() { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); return parts; }
  function pct(value, target) { return target ? Math.min(100, Math.round(Number(value || 0) / Number(target) * 100)) : 0; }
  function roleName(role) { return ({ADMIN:'Administrator', PM:'Project Manager', TL:'Talent Coordinator / Team Leader', FM:'Field Merchandiser', SPG:'Mobile SPG', CLIENT:'Client / TRW (read-only)'})[role] || role || 'User'; }
  function toast(message, type) {
    const region = $('#toast-region'); if (!region) return;
    region.innerHTML = '<div class="toast ' + (type || '') + '" role="status">' + esc(message) + '</div>';
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { region.innerHTML = ''; }, 4500);
  }
  function showError(error) { toast(error && error.message ? error.message : String(error || 'Terjadi kesalahan.'), 'bad'); }
  function setBusy(form, busy, label) {
    if (!form) return;
    form.dataset.busy = busy ? '1' : '0';
    $$('button[type="submit"]', form).forEach((button) => { if (busy) { button.dataset.oldText = button.textContent; button.textContent = label || 'Menyimpan…'; } else { button.textContent = button.dataset.oldText || button.textContent; delete button.dataset.oldText; } button.disabled = busy; });
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('Browser tidak mendukung penyimpanan offline.')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('queue')) { const store = db.createObjectStore('queue', { keyPath: 'request_id' }); store.createIndex('created_at', 'created_at', { unique: false }); }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Penyimpanan lokal tidak tersedia.'));
    });
    return dbPromise;
  }
  async function dbRequest(storeName, mode, operation) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode); const store = tx.objectStore(storeName);
      let req;
      try { req = operation(store); } catch (error) { reject(error); return; }
      if (req) { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }
      else { tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error); }
    });
  }
  async function queueAll() { return (await dbRequest('queue', 'readonly', (store) => store.getAll())).sort((a,b) => String(a.created_at).localeCompare(String(b.created_at)) || Number(a.sequence || 0) - Number(b.sequence || 0)); }
  async function queuePut(item) { await dbRequest('queue', 'readwrite', (store) => store.put(item)); await updateQueueState(); }
  async function queueDelete(requestId) { await dbRequest('queue', 'readwrite', (store) => store.delete(requestId)); await updateQueueState(); }
  async function metaPut(key, value) { await dbRequest('meta', 'readwrite', (store) => store.put({ key, value })); }
  async function metaGet(key) { const record = await dbRequest('meta', 'readonly', (store) => store.get(key)); return record ? record.value : null; }
  async function metaDelete(key) { await dbRequest('meta', 'readwrite', (store) => store.delete(key)); }
  async function updateQueueState() {
    try { const items = await queueAll(); state.queueCount = items.length; state.queueBytes = items.reduce((n, item) => n + Number(item.bytes || 0), 0); }
    catch (_) { state.queueCount = 0; state.queueBytes = 0; }
    updateNetworkBadge();
  }
  function updateNetworkBadge() {
    const el = $('#network-badge');
    if (el) { el.className = 'status-pill ' + (navigator.onLine ? 'online' : 'offline'); el.textContent = navigator.onLine ? 'Online' : 'Offline'; }
    const q = $('#queue-badge'); if (q) { q.textContent = state.queueCount ? String(state.queueCount) : ''; q.classList.toggle('hidden', !state.queueCount); }
    const banner = $('#sync-banner'); if (banner) { banner.classList.toggle('hidden', !state.queueCount); const label = $('#sync-count'); if (label) label.textContent = state.queueCount + ' kiriman menunggu sinkronisasi'; }
  }
  function hasAPI() { return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/.test(String(C.API_URL || '')); }
  function endpointWith(params) {
    const base = String(C.API_URL || '').trim();
    const query = new URLSearchParams(params).toString();
    return base + (base.indexOf('?') >= 0 ? '&' : '?') + query;
  }
  function apiGet(action, params = {}, options = {}) {
    return new Promise((resolve, reject) => {
      if (!hasAPI()) { reject(new Error('URL Apps Script belum dipasang. Isi frontend/config.js dengan URL /exec hasil deployment.')); return; }
      const callbackName = '__trw_cb_' + uid('cb').replace(/[^A-Za-z0-9_]/g, '');
      const script = document.createElement('script'); script.referrerPolicy = 'no-referrer'; let settled = false;
      const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; } if (script.parentNode) script.parentNode.removeChild(script); fn(value); };
      window[callbackName] = (data) => {
        if (data && data.ok === false) finish(reject, new Error(data.error || 'Permintaan gagal.'));
        else finish(resolve, data || {});
      };
      script.onerror = () => finish(reject, new Error('API belum dapat dijangkau. Periksa URL deployment dan koneksi internet.'));
      const timer = setTimeout(() => finish(reject, new Error('API terlalu lama merespons. Coba lagi.')), Number(options.timeout) || 25000);
      const query = Object.assign({}, params, { action: action, token: state.token, callback: callbackName, _: Date.now() });
      script.src = endpointWith(query); script.async = true; document.head.appendChild(script);
    });
  }
  function makeBridgeProof() {
    if (!window.crypto || !window.crypto.getRandomValues) throw new Error('Browser tidak menyediakan generator aman. Buka aplikasi di Chrome/Safari terbaru melalui HTTPS.');
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  function bridgePost(payload) {
    return new Promise((resolve, reject) => {
      if (!hasAPI()) { const err = new Error('URL Apps Script belum dipasang. Isi frontend/config.js dengan URL /exec hasil deployment.'); err.transport = false; reject(err); return; }
      const rid = String(payload.request_id || uid('REQ'));
      let proof;
      try { proof = makeBridgeProof(); } catch (error) { error.transport = false; reject(error); return; }
      const iframe = document.createElement('iframe'); iframe.name = 'trw_bridge_' + rid.replace(/[^A-Za-z0-9_]/g, ''); iframe.setAttribute('aria-hidden', 'true'); iframe.style.cssText = 'position:absolute;width:1px;height:1px;left:-10000px;top:-10000px;border:0';
      const form = document.createElement('form'); form.method = 'POST'; form.target = iframe.name; form.action = endpointWith({ bridge: '1', rid: rid, proof: proof }); form.style.display = 'none'; form.acceptCharset = 'UTF-8';
      const input = document.createElement('input'); input.type = 'hidden'; input.name = 'payload'; input.value = JSON.stringify(payload); form.appendChild(input);
      let complete = false; let pollTimer = null; let pollInFlight = false; let pollDelay = 500;
      const cleanup = () => { clearTimeout(timer); clearTimeout(pollTimer); postWaiters.delete(rid); setTimeout(() => { iframe.remove(); form.remove(); }, 50); };
      const finish = (data) => { if (complete) return; complete = true; cleanup(); if (data && data.ok === false) { const err = new Error(data.error || 'Permintaan ditolak.'); err.transport = false; reject(err); } else resolve(data || { ok: true }); };
      const timer = setTimeout(() => { if (complete) return; complete = true; cleanup(); const err = new Error('Belum ada konfirmasi dari Apps Script. Buka Apps Script → Executions untuk memeriksa kiriman sebelum mencoba ulang.'); err.transport = true; reject(err); }, 35000);
      const waiter = (data) => finish(data);
      waiter.source = iframe.contentWindow;
      postWaiters.set(rid, waiter);
      async function pollStatus() {
        if (complete || pollInFlight) return;
        pollInFlight = true;
        try {
          const status = await apiGet('bridgeStatus', { rid: rid, proof: proof }, { timeout: 7000 });
          if (status && status.ready && Object.prototype.hasOwnProperty.call(status, 'result')) { finish(status.result); return; }
        } catch (_) { /* The postMessage bridge or next poll may still succeed. */ }
        finally { pollInFlight = false; }
        if (!complete) { pollTimer = setTimeout(pollStatus, pollDelay); pollDelay = Math.min(Math.round(pollDelay * 1.6), 4000); }
      }
      document.body.appendChild(iframe); document.body.appendChild(form);
      waiter.source = iframe.contentWindow;
      try { form.submit(); pollTimer = setTimeout(pollStatus, 350); }
      catch (error) { if (!complete) { complete = true; cleanup(); error.transport = true; reject(error); } }
    });
  }
  window.addEventListener('message', (event) => {
    const data = event && event.data;
    if (!data || data.type !== 'TRW_API_RESULT' || !data.rid) return;
    const waiter = postWaiters.get(String(data.rid)); if (waiter && event.source === waiter.source) waiter(data.data);
  });
  async function apiPost(action, data = {}, options = {}) {
    const payload = Object.assign({}, data, { action: action, token: action === 'login' ? '' : state.token, request_id: data.request_id || uid('REQ') });
    const allowQueue = options.allowQueue !== false && QUEUEABLE.has(action);
    if (!navigator.onLine) {
      if (allowQueue) return enqueuePayload(payload);
      const error = new Error('Aksi ini membutuhkan koneksi internet.'); error.transport = false; throw error;
    }
    try {
      const result = await bridgePost(payload);
      return result;
    } catch (error) {
      if (allowQueue && error.transport) return enqueuePayload(payload);
      throw error;
    }
  }
  async function enqueuePayload(payload) {
    const items = await queueAll();
    const size = JSON.stringify(payload).length * 2;
    const total = items.reduce((sum, item) => sum + Number(item.bytes || 0), 0);
    if (items.length >= QUEUE_MAX_ITEMS || total + size > QUEUE_MAX_BYTES) throw new Error('Antrean offline hampir penuh. Sambungkan internet dan sinkronkan data dahulu.');
    const existing = items.find((item) => item.request_id === payload.request_id);
    if (!existing) await queuePut({ request_id: payload.request_id, action: payload.action, payload: payload, owner_user_id: state.user && state.user.user_id, created_at: new Date().toISOString(), sequence: items.reduce((max, item) => Math.max(max, Number(item.sequence) || 0), 0) + 1, bytes: size });
    toast('Tersimpan di perangkat. Data akan dikirim saat online.', 'ok');
    return { ok: true, queued: true, request_id: payload.request_id, message: 'Menunggu sinkronisasi.' };
  }
  async function syncQueue() {
    if (state.syncing) return;
    if (!navigator.onLine) { toast('Perangkat masih offline. Antrean tetap aman di perangkat.'); return; }
    if (!state.token || !state.user) { toast('Login kembali sebelum sinkronisasi.'); return; }
    state.syncing = true; render();
    try {
      const items = await queueAll();
      if (!items.length) { toast('Tidak ada antrean. Semua data sudah tersinkron.', 'ok'); return; }
      let sent = 0;
      for (const item of items) {
        if (item.owner_user_id && item.owner_user_id !== state.user.user_id) throw new Error('Antrean berasal dari akun lain. Login menggunakan akun asal agar data tidak tercampur.');
        const payload = Object.assign({}, item.payload, { token: state.token });
        const result = await bridgePost(payload);
        if (!result || result.ok === false) throw new Error(result && result.error ? result.error : 'Sinkronisasi ditolak server.');
        await queueDelete(item.request_id); sent++;
      }
      toast(sent + ' data berhasil disinkronkan.', 'ok');
      await refreshAll(false);
    } catch (error) { showError(error); }
    finally { state.syncing = false; render(); }
  }

  function getGeo() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('Browser tidak mendukung GPS. Gunakan Chrome/Safari terbaru di ponsel.')); return; }
      if (!window.isSecureContext) { reject(new Error('GPS dan kamera memerlukan HTTPS. Buka aplikasi melalui GitHub Pages, bukan file lokal.')); return; }
      navigator.geolocation.getCurrentPosition((position) => {
        const coords = position.coords;
        if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude) || !Number.isFinite(coords.accuracy)) { reject(new Error('GPS belum memberikan lokasi valid.')); return; }
        if (coords.accuracy > 150) { reject(new Error('Akurasi GPS ' + Math.round(coords.accuracy) + ' m. Tunggu sebentar atau pindah ke area lebih terbuka, lalu coba lagi.')); return; }
        resolve({ lat: Number(coords.latitude), lng: Number(coords.longitude), accuracy: Math.round(coords.accuracy * 10) / 10 });
      }, (error) => {
        const notes = { 1: 'Izin lokasi ditolak. Aktifkan izin lokasi untuk browser.', 2: 'Lokasi belum tersedia. Periksa GPS perangkat.', 3: 'GPS terlalu lama merespons. Coba kembali.' };
        reject(new Error(notes[error.code] || 'Tidak dapat membaca GPS.'));
      }, { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 });
    });
  }
  function capturePhoto() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment'; input.style.display = 'none';
      input.addEventListener('change', async () => {
        try { if (!input.files || !input.files[0]) throw new Error('Pengambilan foto dibatalkan.'); resolve(await compressPhoto(input.files[0])); }
        catch (error) { reject(error); }
        finally { input.remove(); }
      }, { once: true });
      input.addEventListener('cancel', () => { input.remove(); reject(new Error('Pengambilan foto dibatalkan.')); }, { once: true });
      document.body.appendChild(input); input.click();
    });
  }
  function compressPhoto(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//i.test(file.type)) { reject(new Error('File bukan gambar.')); return; }
      const objectUrl = URL.createObjectURL(file); const img = new Image();
      img.onload = () => {
        try {
          let max = 1280; let scale = Math.min(1, max / Math.max(img.width, img.height));
          let canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale));
          let ctx = canvas.getContext('2d', { alpha: false }); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          let dataUrl = canvas.toDataURL('image/jpeg', 0.68);
          if (dataUrl.length * 0.75 > 600000) { max = 1024; scale = Math.min(1, max / Math.max(img.width, img.height)); canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale)); ctx = canvas.getContext('2d', { alpha: false }); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); dataUrl = canvas.toDataURL('image/jpeg', 0.56); }
          if (dataUrl.length * 0.75 > 640000) throw new Error('Ukuran foto masih terlalu besar. Coba foto ulang dengan pencahayaan lebih baik.');
          resolve({ dataUrl: dataUrl, mimeType: 'image/jpeg', capturedAt: new Date().toISOString(), fileName: file.name || 'field-photo.jpg' });
        } catch (error) { reject(error); }
        finally { URL.revokeObjectURL(objectUrl); }
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Foto tidak dapat dibaca. Coba gunakan JPG/PNG dari kamera.')); };
      img.src = objectUrl;
    });
  }

  function field(name, label, type, options = {}) {
    const cls = options.full ? 'field field-full' : 'field'; const required = options.required ? ' required' : '';
    const hint = options.hint ? '<div class="hint">' + esc(options.hint) + '</div>' : '';
    let control = '';
    if (type === 'select') {
      control = '<select name="' + esc(name) + '"' + required + '>' + (options.blank ? '<option value="">' + esc(options.blank) + '</option>' : '') + (options.options || []).map((option) => { const value = typeof option === 'string' ? option : option.value; const title = typeof option === 'string' ? option : option.label; return '<option value="' + esc(value) + '"' + (options.value === value ? ' selected' : '') + '>' + esc(title) + '</option>'; }).join('') + '</select>';
    } else if (type === 'textarea') {
      control = '<textarea name="' + esc(name) + '" placeholder="' + esc(options.placeholder || '') + '"' + required + '>' + esc(options.value || '') + '</textarea>';
    } else if (type === 'checkbox') {
      return '<label class="checkrow field-full"><input type="checkbox" name="' + esc(name) + '" value="yes"' + (options.checked ? ' checked' : '') + '><span><strong>' + esc(label) + '</strong>' + hint + '</span></label>';
    } else {
      control = '<input name="' + esc(name) + '" type="' + esc(type || 'text') + '"' + (options.placeholder ? ' placeholder="' + esc(options.placeholder) + '"' : '') + (options.min !== undefined ? ' min="' + esc(options.min) + '"' : '') + (options.max !== undefined ? ' max="' + esc(options.max) + '"' : '') + (options.step !== undefined ? ' step="' + esc(options.step) + '"' : '') + (options.value !== undefined ? ' value="' + esc(options.value) + '"' : '') + required + '>';
    }
    return '<div class="' + cls + '"><label>' + esc(label) + (options.required ? ' <span aria-hidden="true">*</span>' : '') + '</label>' + control + hint + '</div>';
  }
  function photoField(key, label, hint, required = false) {
    return '<div class="field ' + (required ? 'field-full' : '') + '"><label>' + esc(label) + (required ? ' <span aria-hidden="true">*</span>' : '') + '</label><input class="photo-input" type="file" name="photo_' + esc(key) + '" data-photo="' + esc(key) + '" accept="image/*" capture="environment"' + (required ? ' required' : '') + '><div class="form-note">' + esc(hint || 'Foto dikompres otomatis sebelum disimpan.') + '</div><div data-preview-for="' + esc(key) + '"></div></div>';
  }
  function signatureField() {
    return '<div class="field field-full signature-field"><label>Tanda tangan pemilik / PIC outlet</label><p class="form-note">Digambar langsung pada layar. Wajib jika outlet dinyatakan qualified. Bila pemilik tidak tersedia, pilih Tidak qualified dan jelaskan alasannya.</p><canvas id="owner-signature" class="signature-canvas" width=720 height=300 aria-label="Area tanda tangan pemilik outlet"></canvas><div class="signature-toolbar"><span id="signature-status" class="photo-meta">' + (state.signatureDrawn ? 'Tanda tangan siap.' : 'Belum ditandatangani.') + '</span><button type="button" class="btn btn-small btn-plain" data-act="clear-signature">Hapus tanda tangan</button></div></div>';
  }
  function setupSignatureCanvas() {
    const canvas = $('#owner-signature'); if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#111111'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (state.signatureDrawn && state.signatureData) { const img = new Image(); img.onload = () => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); }; img.src = state.signatureData; }
    let drawing = false;
    const point = (event) => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }; };
    const updateStatus = (text) => { const status = $('#signature-status'); if (status) status.textContent = text; };
    const finish = () => { if (!drawing) return; drawing = false; state.signatureCapturedAt = new Date().toISOString(); state.signatureData = canvas.toDataURL('image/jpeg', 0.88); state.signatureDrawn = true; updateStatus('Tanda tangan siap.'); };
    canvas.addEventListener('pointerdown', (event) => { event.preventDefault(); drawing = true; try { canvas.setPointerCapture(event.pointerId); } catch (_) {} const p = point(event); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.2, p.y + 0.2); ctx.stroke(); state.signatureDrawn = true; state.signatureCapturedAt = new Date().toISOString(); updateStatus('Sedang menandatangani…'); });
    canvas.addEventListener('pointermove', (event) => { if (!drawing) return; event.preventDefault(); const p = point(event); ctx.lineTo(p.x, p.y); ctx.stroke(); });
    canvas.addEventListener('pointerup', finish); canvas.addEventListener('pointercancel', finish); canvas.addEventListener('lostpointercapture', finish);
  }
  function section(number, title, content, note) { return '<section class="form-section"><h3><span class="section-number">' + esc(number) + '</span>' + esc(title) + '</h3>' + (note ? '<p class="form-note">' + esc(note) + '</p>' : '') + content + '</section>'; }
  function pageHead(eyebrow, title, subtitle, right = '') { return '<div class="page-head"><div><div class="eyebrow">' + esc(eyebrow) + '</div><h1>' + esc(title) + '</h1><p>' + esc(subtitle) + '</p></div>' + right + '</div>'; }
  function metricCard(label, value, target, note) {
    const amount = Number(value || 0); const percent = target ? pct(amount, target) : 0;
    return '<div class="stat-card"><div class="stat-label">' + esc(label) + '</div><div class="stat-value">' + fmtNum(amount) + '</div><div class="stat-foot">' + esc(note || (target ? 'Target ' + fmtNum(target) : 'Total tercatat')) + '</div>' + (target ? '<div class="progress"><span style="width:' + percent + '%"></span></div>' : '') + '</div>';
  }
  function syncBanner() {
    return '<div id="sync-banner" class="sync-banner ' + (state.queueCount ? '' : 'hidden') + '"><div><strong id="sync-count">' + state.queueCount + ' kiriman menunggu sinkronisasi</strong><span class="muted">Data tetap tersimpan di perangkat hingga terkirim.</span></div><button class="btn btn-small btn-yellow" data-act="sync" ' + (state.online ? '' : 'disabled') + '>' + (state.syncing ? 'Menyinkronkan…' : 'Sinkronkan') + '</button></div>';
  }
  function navButton(key, label, page) {
    const active = state.page === page || (page === 'more' && ['more','users','beatplan','createOutlet'].includes(state.page));
    return '<button class="nav-btn ' + (active ? 'active' : '') + '" data-act="nav" data-page="' + page + '"><span class="nav-dot"></span><span>' + esc(label) + '</span></button>';
  }
  function loginPage() {
    return '<div class="login-wrap"><div class="login-card"><div class="brand-line"><div class="brand-square">TRW</div><div><div class="brand-title">Direct-to-Retailer</div><div class="eyebrow">Field Execution System</div></div></div><h1>Selamat datang.</h1><p class="subhead">Masuk untuk mencatat aktivitas lapangan, evidence, dan laporan TRW.</p><form data-form="login" autocomplete="on">' + field('username','Username','text',{required:true,placeholder:'Masukkan username',full:true}) + field('password','Password','password',{required:true,placeholder:'Masukkan password',full:true}) + '<button class="btn btn-primary btn-block" type="submit">Masuk ke aplikasi</button></form><div class="divider"></div><div class="small muted">Gunakan akun yang diberikan Admin. Login tidak sama dengan Check In kehadiran.</div><div class="footer-note">TRW Direct-to-Retailer · ARAIA Group</div></div></div>';
  }
  function shell(content) {
    return '<header class="topbar"><div class="topbar-inner"><div class="brand-mini"><div class="brand-square">TRW</div><div>TRW FIELD<small>DIRECT-TO-RETAILER</small></div></div><div class="top-actions"><span id="network-badge" class="status-pill ' + (navigator.onLine ? 'online' : 'offline') + '">' + (navigator.onLine ? 'Online' : 'Offline') + '</span><span id="queue-badge" class="pill-count ' + (state.queueCount ? '' : 'hidden') + '">' + state.queueCount + '</span><button class="btn btn-small btn-plain" data-act="refresh" aria-label="Muat ulang data">Refresh</button></div></div></header>' + content + '<nav class="bottom-nav" aria-label="Navigasi utama">' + navButton('home','Beranda','home') + navButton('outlets','Outlet','outlets') + navButton('input','Input','input') + navButton('reports','Laporan','reports') + navButton('more','Menu','more') + '</nav>';
  }
  function render() {
    updateQueueState();
    if (!state.token || !state.user) { APP.innerHTML = loginPage(); return; }
    let page = '';
    switch (state.page) {
      case 'outlets': page = outletsPage(); break;
      case 'input': page = inputPage(); break;
      case 'reports': page = reportsPage(); break;
      case 'users': page = usersPage(); break;
      case 'beatplan': page = beatPlanPage(); break;
      case 'createOutlet': page = createOutletPage(); break;
      case 'more': page = morePage(); break;
      default: page = homePage();
    }
    APP.innerHTML = shell(syncBanner() + '<div class="wrap">' + page + '<div class="footer-note">TRW Field · Versi ' + esc(C.BUILD || '1.0.0') + '<br>Foto dan lokasi hanya dikirim saat Anda mengirim laporan atau Check In/Out.</div></div>');
    updateNetworkBadge();
    setupSignatureCanvas();
  }

  function homePage() {
    const m = (state.dashboard && state.dashboard.metrics) || {};
    const targets = (state.dashboard && state.dashboard.targets) || { prospects:250, uniqueOutlets:180, fmVisits:360, spgDays:72, interactions:1080 };
    const isClient = state.user.role === 'CLIENT';
    const open = state.openAttendance;
    const attendance = isClient
      ? '<div class="card"><div class="eyebrow">Akses client</div><h2>Dashboard read-only</h2><p class="muted small">Akun client dapat melihat progress, outlet, dan laporan. Pencatatan kehadiran serta input lapangan hanya untuk tim operasional.</p><button class="btn btn-primary btn-block" data-act="nav" data-page="reports">Buka laporan</button></div>'
      : '<div class="card attendance-card"><div class="card-head"><div><div class="eyebrow">Kehadiran lapangan</div><h2>' + (open ? 'Anda sedang Check In' : 'Mulai hari kerja') + '</h2><p class="muted small">Login/Logout hanya membuka sesi aplikasi. Check In/Out mencatat waktu, foto, dan lokasi.</p></div><span class="tag ' + (open ? 'green' : 'gray') + '">' + (open ? 'AKTIF' : 'BELUM CHECK IN') + '</span></div>' + (open ? '<div class="notice success"><strong>Check In:</strong> ' + esc(fmtDateTime(open.checkin_at || open.at)) + '<br><span class="small">ID: ' + esc(open.attendance_id) + '</span></div><button class="btn btn-primary btn-block" data-act="checkout">Check Out dengan Foto + GPS</button>' : '<button class="btn btn-yellow btn-block" data-act="checkin">Check In dengan Foto + GPS</button>') + '<div class="form-note">Akurasi GPS harus 150 meter atau lebih baik. Ambil foto baru saat Check In dan Check Out.</div></div>';
    let actions = '<button class="action-tile primary-tile" data-act="nav" data-page="outlets"><strong>Lihat outlet</strong><small>Temukan outlet sasaran dan status qualification.</small></button>';
    if (!isClient) actions += '<button class="action-tile" data-act="start-input"><strong>Isi laporan FM</strong><small>Visit, qualification, POSM, edukasi, dan survey.</small></button>';
    actions += '<button class="action-tile" data-act="nav" data-page="reports"><strong>Lihat laporan</strong><small>Rekap dan aktivitas terakhir.</small></button>';
    if (state.user.role === 'SPG') actions += '<button class="action-tile" data-act="select-form" data-form-type="activation"><strong>SPG activation</strong><small>Hanya di outlet qualified.</small></button><button class="action-tile" data-act="select-form" data-form-type="interaction"><strong>End-user interaction</strong><small>Catat interaksi, intent dan lead.</small></button>';
    const quick = '<div class="card"><div class="card-head"><div><h2>' + (isClient ? 'Menu utama' : 'Aksi cepat') + '</h2><p class="muted small">' + (isClient ? 'Akses pantau tanpa mengubah data operasional.' : 'Pilih langkah berikutnya.') + '</p></div></div><div class="action-grid">' + actions + '</div></div>';
    const kpis = '<div class="card"><div class="card-head"><div><h2>Progress program</h2><p class="muted small">Target kerja terpisah sesuai SOW dan revised execution plan.</p></div><span class="tag yellow">PROGRAM KPI</span></div><div class="grid grid-3">' + metricCard('Prospect',m.prospectCount,targets.prospects,'Target database awal') + metricCard('Outlet qualified',m.qualifiedUnique,targets.uniqueOutlets,'Outlet lolos qualification') + metricCard('FM visits',m.fmVisits,targets.fmVisits,'Kunjungan, bukan outlet unik') + metricCard('SPG activation days',m.spgDays,targets.spgDays,'Jumlah hari aktivasi') + metricCard('End-user interactions',m.interactions,targets.interactions,'Interaksi, bukan transaksi') + metricCard('Open issues',m.openIssues,null,'Perlu tindak lanjut') + '</div><div class="form-note">Target: 250 prospect · 180 outlet unik · 360 FM visits · 72 SPG-days · 1.080 end-user interactions. Angka aktual ditampilkan apa adanya, bukan data dummy.</div></div>';
    const notes = '<div class="card"><h3>Standar program</h3><div class="report-row"><strong>1. Evidence dahulu</strong><p>Foto dan lokasi wajib untuk Check In/Out serta evidence outlet sebelum qualification.</p></div><div class="report-row"><strong>2. SPG setelah qualification</strong><p>Aktivasi SPG hanya dapat disimpan untuk outlet yang sudah qualified dan memiliki evidence.</p></div><div class="report-row"><strong>3. Cut-off 20:00 WIB</strong><p>Pastikan laporan tersinkron sebelum batas waktu harian.</p></div></div>';
    return pageHead('BERANDA', 'Halo, ' + (state.user.full_name || state.user.username).split(' ')[0] + '.', roleName(state.user.role) + ' · ' + fmtDate(new Date().toISOString())) + '<div class="home-layout"><div>' + attendance + quick + '</div><div>' + kpis + notes + '</div></div>';
  }

  function outletsPage() {
    const items = filteredOutlets();
    const controls = '<div class="card"><div class="search-row"><input id="outlet-search" value="' + esc(state.outletQuery) + '" type="search" placeholder="Cari nama, area, atau alamat" aria-label="Cari outlet"><button class="btn btn-primary" data-act="search-outlets">Cari</button></div><div class="filter-row" style="margin-top:10px">' + [['all','Semua'],['qualified','Qualified'],['prospect','Prospect'],['P1','Prioritas P1']].map(([id,label]) => '<button class="filter-chip ' + (state.outletFilter === id ? 'active' : '') + '" data-act="outlet-filter" data-filter="' + id + '">' + label + '</button>').join('') + '</div><div class="form-note">Daftar prospect tetap berstatus belum terverifikasi sampai ada hasil field survey.</div></div>';
    let list = '';
    if (!items.length) list = '<div class="card empty-state"><strong>Outlet tidak ditemukan</strong>Coba kata kunci lain atau refresh data ketika online.</div>';
    else list = '<div class="card"><div class="card-head"><div><h2>Daftar outlet</h2><p class="muted small">' + fmtNum(items.length) + ' hasil ditampilkan</p></div>' + (['ADMIN','PM','TL'].includes(state.user.role) ? '<button class="btn btn-small btn-yellow" data-act="nav" data-page="createOutlet">Tambah outlet</button>' : '') + '</div>' + items.map((o) => outletItem(o)).join('') + '</div>';
    return pageHead('COVERAGE', 'Outlet & prospect', 'Cari outlet sasaran, lihat status, lalu mulai aktivitas lapangan.') + controls + list;
  }
  function filteredOutlets() {
    let list = state.outletList.slice(); const q = state.outletQuery.toLowerCase().trim();
    if (q) list = list.filter((o) => [o.outlet_name,o.city,o.area,o.address,o.segment_final,o.segment_indicative,o.priority].join(' ').toLowerCase().includes(q));
    if (state.outletFilter === 'qualified') list = list.filter((o) => o.is_qualified || String(o.status).toUpperCase() === 'QUALIFIED');
    if (state.outletFilter === 'prospect') list = list.filter((o) => o.is_prospect || String(o.status).toUpperCase().includes('UNVERIFIED') || String(o.status).toUpperCase().includes('BELUM'));
    if (state.outletFilter === 'P1') list = list.filter((o) => String(o.priority).toUpperCase() === 'P1');
    return list;
  }
  function outletItem(o) {
    const qual = o.is_qualified || String(o.status).toUpperCase() === 'QUALIFIED';
    const isProspect = o.is_prospect || !o.segment_final;
    const segment = o.segment_final || o.segment_indicative || 'Belum diklasifikasi';
    const status = qual ? '<span class="tag green">QUALIFIED</span>' : isProspect ? '<span class="tag yellow">PROSPECT</span>' : '<span class="tag gray">' + esc(o.status || 'BELUM VERIFIKASI') + '</span>';
    const actions = (state.user.role === 'CLIENT' ? '<span class="tag gray">View only</span>' : '<button class="btn btn-small btn-primary" data-act="choose-outlet" data-id="' + esc(o.outlet_id) + '">Pilih outlet</button>') + (o.maps_link ? '<a class="maps-link" href="' + esc(o.maps_link) + '" target="_blank" rel="noopener">Buka Maps</a>' : '');
    return '<div class="outlet-item"><div class="outlet-info"><strong>' + esc(o.outlet_name) + '</strong><p>' + esc(o.city || 'Area belum diisi') + (o.area ? ' · ' + esc(o.area) : '') + '</p><p>' + esc(segment) + ' · ' + esc(o.priority || 'Tanpa prioritas') + '</p><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px">' + status + (o.is_prospect ? '<span class="tag gray">BELUM VERIFIKASI FISIK</span>' : '') + '</div>' + (o.address ? '<p style="margin-top:7px">' + esc(o.address) + '</p>' : '') + '</div><div class="outlet-actions">' + actions + '</div></div>';
  }

  function inputPage() {
    if (state.user.role === 'CLIENT') return pageHead('AKSES CLIENT','Mode hanya-baca','Akun client tidak dapat mengirim atau mengubah data operasional.') + '<div class="card"><div class="notice">Gunakan Dashboard, Outlet, dan Laporan untuk memantau program.</div><button class="btn btn-primary btn-block" data-act="nav" data-page="reports">Buka laporan</button></div>';
    if (state.inputType === 'visit') return visitFormPage();
    if (state.inputType === 'activation') return activationFormPage();
    if (state.inputType === 'interaction') return interactionFormPage();
    if (state.inputType === 'issue') return issueFormPage();
    const isSpg = state.user.role === 'SPG';
    const tiles = isSpg ? [
      ['activation','SPG Activation','Aktivasi produk dan edukasi di outlet qualified.'],
      ['interaction','End-user interaction','Jumlah interaksi, purchase intent dan lead.'],
      ['issue','Catat kendala','Kirim issue untuk ditindaklanjuti.']
    ] : [
      ['visit','FM Visit + Qualification','Kunjungan, klasifikasi outlet, POSM, edukasi dan TRW survey dalam satu alur.'],
      ['issue','Catat kendala','Issue lapangan, tindakan, PIC dan deadline.']
    ];
    return pageHead('INPUT LAPANGAN','Pilih jenis laporan','Form dibuat berurutan agar tidak perlu mengisi data yang sama berulang kali.') + '<div class="card"><div class="notice ' + (state.openAttendance ? 'success' : 'warning') + '">' + (state.openAttendance ? '<strong>Check In aktif.</strong> Anda dapat melanjutkan laporan lapangan.' : '<strong>Anda belum Check In.</strong> Check In dengan foto dan GPS harus dilakukan sebelum menyimpan laporan.') + '</div><div class="action-grid">' + tiles.map(([key,title,desc]) => '<button class="action-tile" data-act="select-form" data-form-type="' + key + '"><strong>' + esc(title) + '</strong><small>' + esc(desc) + '</small></button>').join('') + '</div></div>' + (state.selectedOutlet ? '<div class="card"><div class="eyebrow">Outlet terpilih</div><h3>' + esc(state.selectedOutlet.outlet_name) + '</h3><p class="muted small">' + esc(state.selectedOutlet.city || '') + ' · ' + esc(state.selectedOutlet.outlet_id) + '</p><button class="btn btn-small btn-plain" data-act="clear-outlet">Ganti outlet</button></div>' : '<div class="card"><h3>Belum memilih outlet</h3><p class="muted small">Pilih outlet melalui menu Outlet sebelum membuka laporan kunjungan/aktivasi.</p><button class="btn btn-primary" data-act="nav" data-page="outlets">Cari outlet</button></div>');
  }
  function selectedOutletBlock() {
    if (!state.selectedOutlet) return '<div class="notice warning">Pilih outlet terlebih dahulu. <button type="button" class="link-btn" data-act="nav" data-page="outlets">Buka daftar outlet</button></div>';
    return '<div class="notice success"><strong>' + esc(state.selectedOutlet.outlet_name) + '</strong><br><span class="small">' + esc(state.selectedOutlet.city || '') + ' · ' + esc(state.selectedOutlet.outlet_id) + '</span><br><button type="button" class="link-btn" data-act="clear-outlet">Ganti outlet</button></div>';
  }
  function visitFormPage() {
    if (!state.selectedOutlet) return pageHead('LAPORAN FM','Kunjungan outlet','Pilih outlet terlebih dahulu.') + selectedOutletBlock();
    if (state.user.role === 'SPG') return pageHead('AKSES','Form FM Visit','Modul ini hanya untuk FM, TL, PM, atau Admin.') + '<div class="card">Silakan pilih modul SPG Activation atau Interaction.</div>';
    const visitSection = field('visit_type','Tipe kunjungan','select',{required:true,blank:'Pilih tipe kunjungan',options:['Existing','New / Prospect']}) + field('visit_notes','Catatan kunjungan','textarea',{full:true,placeholder:'Kondisi outlet, kebutuhan, follow-up…'}) + field('visit_contact','Nama owner / PIC','text',{placeholder:'Nama pemilik atau kepala mekanik'}) + field('visit_phone','No. telepon PIC','tel',{placeholder:'Opsional'}) + field('b2b_sales','Estimasi turnover / B2B sales','text',{placeholder:'Nominal atau catatan estimasi'}) + photoField('outlet','Foto outlet / tampak depan','Wajib untuk bukti visit dan qualification.',true) + signatureField();
    const qualSection = field('outlet_type','Tipe outlet','select',{required:true,blank:'Pilih tipe outlet',options:['Toko sparepart','Distributor','Bengkel','Workshop','Toko sparepart dan bengkel','Lainnya']}) + field('active_bays','Jumlah active bay (bengkel/workshop)','number',{min:0,placeholder:'Minimal 3 bila outlet dikualifikasikan sebagai bengkel/workshop'}) + field('brake_steering_stock_confirmed','Stok aktif brake/steering/suspension terverifikasi?','select',{required:true,blank:'Verifikasi stok aktif',options:['Ya','Tidak','Belum diketahui']}) + field('segment_final','Klasifikasi SOW final','select',{required:true,blank:'Pilih klasifikasi setelah verifikasi',hint:'Validasi akhir mengikuti kriteria SOW. Brand count 20–29 belum memiliki aturan eksplisit pada dokumen sumber—klarifikasi dengan TRW.',options:['Grosir','Semi Grosir','Retail','Belum diklasifikasi']}) + field('brand_count','Jumlah brand yang dijual','number',{min:0,placeholder:'Contoh: 32'}) + field('sku_count','Jumlah SKU relevan yang tersedia','number',{min:0,placeholder:'Jumlah SKU rem / steering / suspensi yang terverifikasi'}) + field('purchase_history_signal','Pembelian kategori brake/steering dalam 6 bulan','select',{required:true,blank:'Pilih status riwayat pembelian',options:[{value:'Ya',label:'Ya, ada riwayat'},{value:'Tidak',label:'Tidak ada'},{value:'Belum diketahui',label:'Belum diketahui'}]}) + field('owner_engagement','Owner / kepala mekanik bersedia ikut edukasi?','select',{required:true,blank:'Pilih status owner',options:['Ya','Tidak','Perlu follow-up']}) + field('sku_range','Range SKU / produk relevan','text',{placeholder:'Contoh: brake pad, steering, suspension'}) + field('purchase_frequency','Frekuensi restock / pembelian','select',{options:['Mingguan','2 mingguan','Bulanan','Tidak rutin','Belum diketahui']}) + field('trw_shelf_presence','TRW tersedia di rak / stok?','select',{required:true,blank:'Pilih status stok/display',options:['Ya','Tidak','Belum diketahui']}) + field('eligible','Outlet layak masuk program?','select',{required:true,blank:'Pilih hasil qualification',options:[{value:'Ya',label:'Ya — qualified'},{value:'Tidak',label:'Tidak qualified'}]}) + field('qualification_reason','Alasan / kebutuhan follow-up','textarea',{full:true,placeholder:'Jelaskan alasan bila tidak qualified, atau kebutuhan bila qualified.'});
    const posmSection = field('posm_type','Jenis POSM','select',{required:true,options:['Tidak ada','Spanduk','Poster','Banner','Sticker','Lainnya']}) + field('condition_before','Kondisi POSM sebelum','select',{options:['Tidak ada','Baik','Rusak','Kotor','Tidak terlihat','Tidak sesuai standar','Lainnya']}) + field('posm_action','Tindakan POSM','select',{required:true,blank:'Pilih tindakan POSM',options:['Tidak ada perubahan','Pasang','Replace','Repair']}) + field('condition_after','Kondisi POSM setelah','select',{options:['Baik dan terlihat','Terpasang baru','Perlu follow-up','Tidak ada perubahan']}) + photoField('posm_before','Foto POSM Before','Wajib bila POSM dipasang, diganti, atau diperbaiki.') + photoField('posm_after','Foto POSM After','Wajib bila POSM dipasang, diganti, atau diperbaiki.') + field('owner_approval','Persetujuan owner untuk POSM','select',{options:['Ya','Tidak','Tidak diperlukan']}) + field('posm_owner_name','Nama owner / PIC approval','text',{placeholder:'Nama pemberi persetujuan'}) + field('posm_notes','Catatan POSM','textarea',{full:true,placeholder:'Lokasi pasang, ukuran, kondisi…'});
    const eduSection = field('education_done','Edukasi produk diberikan?','select',{required:true,blank:'Pilih status edukasi',options:[{value:'Ya',label:'Ya'},{value:'Tidak',label:'Tidak'}]}) + field('education_type','Materi edukasi','select',{options:['Product knowledge','Program promo','Product knowledge + promo','Demo komponen rem / steering','Tidak dilakukan']}) + field('product_knowledge','Materi / poin produk','textarea',{placeholder:'Fitur atau materi sesuai script TRW.'}) + field('promotion_explained','Program promosi dijelaskan?','select',{options:['Ya','Tidak','Tidak ada program aktif']}) + field('education_owner','Nama owner / PIC','text',{placeholder:'Penerima edukasi'}) + field('education_verified','Verifikasi owner','select',{options:['Ya','Tidak','Tidak tersedia']});
    const surveySection = field('survey_done','Survey TRW dilakukan?','select',{required:true,blank:'Pilih status survey',options:[{value:'Ya',label:'Ya'},{value:'Tidak',label:'Tidak'}]}) + field('current_brand','Brand kompetitor yang digunakan','text',{placeholder:'Contoh: Brand yang ditemukan'}) + field('current_volume','Volume stok / penjualan saat ini','text',{placeholder:'Estimasi unit / periode'}) + field('trw_stock','Stok TRW tersedia?','select',{options:['Ya','Tidak','Belum diketahui']}) + field('trw_price','Harga TRW (Rp)','number',{min:0,placeholder:'Opsional'}) + field('competitor_brand','Brand pembanding utama','text',{placeholder:'Nama brand kompetitor'}) + field('competitor_price','Harga kompetitor (Rp)','number',{min:0,placeholder:'Opsional'}) + field('purchase_intent','Purchase intent (1–5)','select',{options:[{value:'',label:'Pilih skor'},{value:'1',label:'1 — sangat rendah'},{value:'2',label:'2 — rendah'},{value:'3',label:'3 — sedang'},{value:'4',label:'4 — tinggi'},{value:'5',label:'5 — sangat tinggi'}]}) + field('barrier_switching','Hambatan berpindah brand','select',{options:['Harga','Ketersediaan stok','Kepercayaan / brand preference','Kualitas / performa','Belum ada kebutuhan','Lainnya','Tidak diketahui']}) + field('restock_frequency','Frekuensi restock','select',{options:['Mingguan','2 mingguan','Bulanan','Tidak rutin','Belum diketahui']}) + field('preferred_sku','SKU / kategori pilihan','text',{placeholder:'SKU atau kategori yang dicari'}) + field('brand_awareness','Awareness TRW','select',{options:['Tinggi','Sedang','Rendah','Belum tahu TRW']}) + field('quality_perception','Persepsi kualitas','select',{options:['Baik','Netral','Kurang','Belum pernah menggunakan']}) + field('price_perception','Persepsi harga','select',{options:['Kompetitif','Sesuai pasar','Terlalu tinggi','Belum diketahui']}) + field('unmet_demand','Kebutuhan yang belum terpenuhi','textarea',{full:true,placeholder:'SKU / stok / edukasi / program yang dibutuhkan'}) + field('market_insight','Insight dan rekomendasi','textarea',{full:true,placeholder:'Temuan lapangan dan follow-up yang disarankan'});
    return pageHead('LAPORAN FM','Kunjungan & qualification','Satu alur untuk field visit, klasifikasi outlet, POSM, edukasi, dan survey TRW.') + selectedOutletBlock() + (state.openAttendance ? '' : '<div class="notice warning">Lakukan Check In dengan foto + GPS sebelum mengirim laporan.</div>') + '<form data-form="visit" class="card"><div class="eyebrow">Outlet ID: ' + esc(state.selectedOutlet.outlet_id) + '</div>' + section('1','Kunjungan',visitSection,'Foto tampak depan menjadi evidence utama untuk visit.') + section('2','Qualification outlet',qualSection,'Prospect belum menjadi outlet aktif sampai hasil verifikasi disimpan. Segmentasi SOW tetap Grosir, Semi Grosir, atau Retail; tipe bengkel dicatat terpisah.') + section('3','Audit & POSM',posmSection,'Before/After diperlukan untuk pemasangan, penggantian, atau perbaikan POSM.') + section('4','Product education',eduSection,'Gunakan materi dan klaim produk yang telah disetujui TRW.') + section('5','Survey TRW & market insight',surveySection,'Pisahkan temuan stok, harga, kompetitor, persepsi, dan unmet demand.') + '<div class="notice warning small">Dengan menekan Simpan, aplikasi merekam koordinat perangkat dan waktu pengiriman. Data yang tersimpan offline akan disinkronkan kemudian dengan timestamp lapangan yang dicatat perangkat.</div><div class="form-actions"><button type="button" class="btn btn-plain" data-act="nav" data-page="outlets">Batal</button><button type="submit" class="btn btn-yellow">Simpan laporan</button></div></form>';
  }
  function activationFormPage() {
    if (state.user.role !== 'SPG' && !['ADMIN','PM','TL'].includes(state.user.role)) return '<div class="card">Akses tidak diizinkan.</div>';
    if (!state.selectedOutlet) return pageHead('SPG','Aktivasi outlet','Pilih outlet qualified terlebih dahulu.') + '<div class="card"><button class="btn btn-primary" data-act="nav" data-page="outlets">Cari outlet qualified</button></div>';
    const o = state.selectedOutlet; const qualified = o.is_qualified || String(o.status).toUpperCase() === 'QUALIFIED';
    const qualification = qualified ? '<div class="notice success">Outlet qualified. Aktivasi dapat dilaporkan.</div>' : '<div class="notice warning">Outlet ini belum berstatus qualified. Aktivasi SPG belum dapat disimpan. Pilih outlet berstatus QUALIFIED atau minta FM menyelesaikan qualification.</div>';
    const formContent = field('activation_attendance_count','Jumlah peserta / mekanik yang hadir','number',{min:0,value:'0'}) + field('activation_education','Edukasi TRW dilakukan?','select',{required:true,blank:'Pilih ya / tidak',options:['Ya','Tidak']}) + field('activation_demo','Demo produk dilakukan?','select',{required:true,blank:'Pilih ya / tidak',options:['Ya','Tidak']}) + field('activation_catalogue','Katalog ditinggalkan?','select',{required:true,blank:'Pilih ya / tidak',options:['Ya','Tidak']}) + field('activation_owner','Nama owner / PIC','text',{placeholder:'Pemilik toko / kepala mekanik'}) + field('activation_verified','Owner melakukan verifikasi?','select',{required:true,blank:'Pilih ya / tidak',options:['Ya','Tidak']}) + field('activation_notes','Catatan aktivasi','textarea',{full:true,placeholder:'Materi, pertanyaan, kebutuhan follow-up…'}) + photoField('activation','Foto aktivitas SPG','Wajib untuk evidence activation.',true);
    return pageHead('SPG ACTIVATION','Edukasi & demo TRW','Log activation hanya untuk outlet yang telah qualified.') + selectedOutletBlock() + qualification + '<form data-form="activation" class="card"><div class="eyebrow">' + esc(o.outlet_id) + '</div>' + section('1','Aktivasi',formContent,'Catat kehadiran sesi, edukasi, demo, dan bukti foto.') + '<div class="form-actions"><button type="button" class="btn btn-plain" data-act="nav" data-page="outlets">Ganti outlet</button><button type="submit" class="btn btn-yellow" ' + (qualified ? '' : 'disabled') + '>Simpan aktivasi</button></div></form>';
  }
  function interactionFormPage() {
    const acts = ((state.reports && state.reports.activations) || []).filter((x) => ['ADMIN','PM','TL'].includes(state.user.role) || !x.user_id || x.user_id === state.user.user_id).filter((x) => !state.selectedOutlet || String(x.outlet_id) === String(state.selectedOutlet.outlet_id));
    const options = acts.map((a) => ({ value: a.activation_id, label: fmtDate(a.activation_date) + ' · ' + (outletName(a.outlet_id) || a.outlet_id) + ' · ' + a.activation_id.slice(-6) }));
    const selectedActivation = state.lastActivationId || (options[0] && options[0].value) || '';
    const activationField = field('activation_id','Sesi activation','select',{required:true,blank:'Pilih sesi activation',value:selectedActivation,options:options});
    const content = activationField + field('interaction_count','Jumlah end-user yang berinteraksi','number',{required:true,min:0,value:'1'}) + field('interaction_intent','Purchase intent (1–5)','select',{options:[{value:'',label:'Belum dinilai'},{value:'1',label:'1 — sangat rendah'},{value:'2',label:'2 — rendah'},{value:'3',label:'3 — sedang'},{value:'4',label:'4 — tinggi'},{value:'5',label:'5 — sangat tinggi'}]}) + field('interaction_brand_used','Brand yang digunakan saat ini','text',{placeholder:'Brand existing'}) + field('interaction_brand_considered','Brand yang dipertimbangkan','text',{placeholder:'TRW / kompetitor / belum tahu'}) + field('interaction_requested','Informasi yang diminta','select',{options:['Harga','Ketersediaan SKU','Product knowledge','Lokasi pembelian','Promo','Tidak ada','Lainnya']}) + field('interaction_lead','Ada potential lead?','select',{required:true,options:[{value:'Tidak',label:'Tidak'},{value:'Ya',label:'Ya — perlu follow-up'}]}) + field('interaction_notes','Catatan','textarea',{full:true,placeholder:'Catatan singkat, jangan masukkan data pribadi konsumen yang tidak diperlukan.'});
    const marketInsight = field('spg_current_brand','Brand yang ditemukan','text',{placeholder:'Brand yang saat ini dijual/digunakan'}) + field('spg_current_volume','Volume / frekuensi penjualan','text',{placeholder:'Estimasi dan periode'}) + field('spg_trw_stock','Stok TRW tersedia?','select',{options:['Ya','Tidak','Belum diketahui']}) + field('spg_trw_price','Harga TRW (Rp)','number',{min:0}) + field('spg_competitor_brand','Brand kompetitor utama','text') + field('spg_competitor_price','Harga kompetitor (Rp)','number',{min:0}) + field('spg_barrier_switching','Hambatan berpindah brand','select',{options:['Harga','Ketersediaan stok','Brand preference','Kualitas / performa','Belum ada kebutuhan','Lainnya','Tidak diketahui']}) + field('spg_restock_frequency','Frekuensi restock','select',{options:['Mingguan','2 mingguan','Bulanan','Tidak rutin','Belum diketahui']}) + field('spg_preferred_sku','SKU / kategori pilihan','text') + field('spg_brand_awareness','Awareness TRW','select',{options:['Tinggi','Sedang','Rendah','Belum tahu TRW']}) + field('spg_quality_perception','Persepsi kualitas','select',{options:['Baik','Netral','Kurang','Belum pernah menggunakan']}) + field('spg_price_perception','Persepsi harga','select',{options:['Kompetitif','Sesuai pasar','Terlalu tinggi','Belum diketahui']}) + field('spg_unmet_demand','Kebutuhan yang belum terpenuhi','textarea',{full:true}) + field('spg_market_insight','Insight dan rekomendasi','textarea',{full:true,placeholder:'Temuan atau follow-up yang disarankan.'});
    const insightBlock = '<details class="optional-block"><summary>Tambah market insight pelanggan (opsional)</summary><p class="muted small">Isi bila ada informasi relevan dari percakapan pelanggan atau mekanik.</p><div class="field-grid">' + marketInsight + '</div></details>';
    return pageHead('SPG REPORT','End-user interaction','Bedakan jumlah interaksi, purchase intent, lead, dan sales. Interaksi bukan konversi penjualan.') + '<form data-form="interaction" class="card">' + section('1','Interaksi konsumen',content,'Gunakan hitungan agregat. Hindari menyimpan data pribadi yang tidak diperlukan.') + section('2','Market insight',insightBlock,'Opsional; cukup isi informasi yang berhasil diverifikasi.') + '<div class="form-actions"><button type="button" class="btn btn-plain" data-act="nav" data-page="input">Kembali</button><button type="submit" class="btn btn-yellow">Simpan interaksi</button></div></form>';
  }
  function issueFormPage() {
    const content = field('issue_title','Kendala / issue','text',{required:true,placeholder:'Contoh: stok banner habis'}) + field('issue_action','Tindakan yang dibutuhkan','textarea',{full:true,placeholder:'Apa langkah penyelesaiannya?'}) + field('issue_owner','PIC tindak lanjut','text',{placeholder:'Nama atau role'}) + field('issue_deadline','Target penyelesaian','date',{}) + field('issue_priority','Prioritas','select',{options:['Normal','Tinggi','Kritis']}) + field('issue_notes','Catatan tambahan','textarea',{full:true,placeholder:'Detail yang membantu penyelesaian.'});
    return pageHead('ISSUE TRACKING','Catat kendala lapangan','Setiap kendala memiliki action, PIC, deadline dan status.') + selectedOutletBlock() + '<form data-form="issue" class="card">' + section('1','Kendala dan tindak lanjut',content) + '<div class="form-actions"><button type="button" class="btn btn-plain" data-act="nav" data-page="input">Kembali</button><button type="submit" class="btn btn-yellow">Simpan issue</button></div></form>';
  }

  function reportsPage() {
    const m = (state.dashboard && state.dashboard.metrics) || {};
    const periods = (state.reports && state.reports.periods) || {};
    const current = periods[state.periodTab] || {};
    const tabs = [['daily','Harian'],['weekly','Mingguan'],['monthly','Bulanan']].map(([key,label]) => '<button class="filter-chip ' + (state.periodTab === key ? 'active' : '') + '" data-act="report-tab" data-tab="' + key + '">' + label + '</button>').join('');
    const periodCards = '<div class="card"><div class="card-head"><div><h2>Ringkasan ' + ({daily:'harian',weekly:'mingguan',monthly:'bulanan'}[state.periodTab]) + '</h2><p class="muted small">' + esc(current.range || 'Muat data laporan untuk menghitung periode.') + '</p></div><button class="btn btn-small btn-plain" data-act="refresh-reports">Refresh</button></div><div class="grid grid-3">' + metricCard('FM visits',current.visits, null,'Visit tersimpan') + metricCard('POSM reports',current.posm,null,'Audit / tindakan POSM') + metricCard('Edukasi',current.education,null,'Log edukasi') + metricCard('Outlet qualification',current.qualifications,null,'Hasil verifikasi outlet') + metricCard('TRW surveys',current.surveys,null,'Survey FM') + metricCard('Competitor records',current.competitors,null,'Observasi kompetitor terstruktur') + metricCard('SPG market insight',current.spgSurveys,null,'Survey pada sesi activation') + metricCard('SPG activation days',current.activations,null,'Hari aktivasi') + metricCard('End-user interactions',current.interactions,null,'Interaksi agregat') + '</div><div class="divider"></div><div class="row"><button class="btn btn-plain" data-act="export-summary" data-period="' + state.periodTab + '">Unduh ringkasan CSV</button><button class="btn btn-primary" data-act="export-records">Unduh data lengkap</button></div></div>';
    const tabsHead = '<div class="filter-row">' + tabs + '</div>';
    const table = reportListSection();
    return pageHead('REPORTING','Laporan & evidence','Monitor kualitas eksekusi, bukan hanya jumlah input.') + '<div class="grid grid-3">' + metricCard('Unique outlets',m.uniqueVisited,180,'Outlet unik yang pernah dikunjungi') + metricCard('Evidence records',m.evidence,null,'Foto dan geo records') + metricCard('Open issues',m.openIssues,null,'Belum closed') + '</div>' + tabsHead + periodCards + '<div class="card"><div class="card-head"><div><h2>Aktivitas terbaru</h2><p class="muted small">Pilih kategori untuk melihat detail dan ekspor.</p></div></div><div class="filter-row">' + [['visits','FM Visit'],['attendance','Check In/Out'],['qualifications','Qualification'],['posm','POSM'],['education','Edukasi'],['surveys','Survey FM'],['competitors','Kompetitor'],['spgSurveys','Survey SPG'],['activations','SPG'],['interactions','Interaksi'],['issues','Issues'],['evidence','Evidence']].map(([key,label]) => '<button class="filter-chip ' + (state.reportTab === key ? 'active' : '') + '" data-act="report-list-tab" data-tab="' + key + '">' + label + '</button>').join('') + '</div>' + table + '</div>';
  }
  function reportListSection() {
    const r = state.reports || {};
    const key = ['visits','attendance','qualifications','posm','education','surveys','competitors','spgSurveys','activations','interactions','issues','evidence'].includes(state.reportTab) ? state.reportTab : 'visits';
    const rows = r[key] || [];
    if (!rows.length) return '<div class="empty-state"><strong>Belum ada data untuk kategori ini</strong>Setelah aktivitas tersimpan dan tersinkron, data akan muncul di sini.</div>';
    const names = {visits:'FM Visit',attendance:'Check In/Out',qualifications:'Qualification',posm:'POSM',education:'Edukasi',surveys:'Survey FM',competitors:'Competitor',spgSurveys:'Survey SPG',activations:'SPG Activation',interactions:'Interaction',issues:'Issue',evidence:'Evidence'};
    return '<div class="table-wrap"><table><thead><tr><th>Waktu / Tanggal</th><th>Outlet / Record</th><th>Status / Detail</th></tr></thead><tbody>' + rows.slice(0,30).map((row) => {
      const time = row.visit_date || row.work_date || row.activation_date || row.date || row.created_at || row.checkin_at;
      const outlet = outletName(row.outlet_id) || row.outlet_id || row.attendance_id || row.visit_id || row.issue_id || row.activation_id || row.interaction_id || '—';
      const detail = row.status || row.action || row.kind || row.issue || row.notes || row.count || names[key];
      return '<tr><td>' + esc(fmtDateTime(time)) + '</td><td><strong>' + esc(outlet) + '</strong><div class="tiny muted">' + esc(row.user_name || userName(row.user_id) || row.user_id || '') + '</div></td><td>' + esc(detail) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  function morePage() {
    const role = state.user.role;
    const cards = [
      '<button class="action-tile" data-act="sync"><strong>Sinkronisasi data</strong><small>' + (state.queueCount ? state.queueCount + ' data menunggu' : 'Antrean offline dan status koneksi') + '</small></button>',
      '<button class="action-tile" data-act="change-password"><strong>Ganti password</strong><small>Gunakan password unik minimal 12 karakter.</small></button>',
      '<button class="action-tile" data-act="nav" data-page="reports"><strong>Laporan</strong><small>Rekap periode dan unduh CSV.</small></button>'
    ];
    if (['ADMIN','PM','TL'].includes(role)) cards.push('<button class="action-tile" data-act="nav" data-page="beatplan"><strong>Beat plan</strong><small>Jadwal kunjungan, FM, outlet dan status.</small></button>');
    if (role === 'ADMIN') cards.push('<button class="action-tile" data-act="nav" data-page="users"><strong>Manajemen user</strong><small>Buat akun FM, SPG, TL, PM, Admin, atau Client read-only.</small></button>');
    if (['ADMIN','PM','TL'].includes(role)) cards.push('<button class="action-tile" data-act="nav" data-page="createOutlet"><strong>Tambah outlet</strong><small>Daftarkan outlet aktif baru.</small></button>');
    cards.push('<button class="action-tile" data-act="logout"><strong>Logout aplikasi</strong><small>Ini tidak mengakhiri Check In yang masih aktif.</small></button>');
    return pageHead('MENU','Pengaturan & alat','Akun, sinkronisasi, serta pengelolaan sistem.') + '<div class="card"><div class="user-panel"><div class="avatar">' + esc((state.user.full_name || state.user.username).slice(0,1).toUpperCase()) + '</div><div class="user-copy"><strong>' + esc(state.user.full_name || state.user.username) + '</strong><small>' + esc(state.user.username) + ' · ' + esc(roleName(role)) + '</small><small>User ID: ' + esc(state.user.user_id) + '</small></div></div><div class="divider"></div><div class="grid">' + cards.join('') + '</div></div><div class="card"><h3>Catatan penggunaan</h3><p class="muted small">Aplikasi membutuhkan HTTPS untuk akses kamera dan GPS. Ketika offline, kiriman yang didukung disimpan di perangkat dan ditandai menunggu sinkronisasi. Jangan menghapus data browser sebelum antrean terkirim.</p><p class="muted small">Login/Logout mengatur sesi aplikasi. Check In/Check Out merekam kehadiran lapangan dengan foto dan GPS; keduanya tidak otomatis saling mengakhiri.</p></div>';
  }

  function usersPage() {
    if (state.user.role !== 'ADMIN') return '<div class="card">Akses hanya untuk Admin.</div>';
    const form = field('user_full_name','Nama lengkap','text',{required:true}) + field('user_username','Username','text',{required:true,placeholder:'Contoh: fm.jakarta01'}) + field('user_role','Role','select',{required:true,options:['FM','SPG','TL','PM','ADMIN','CLIENT']}) + field('user_phone','Nomor telepon','tel',{placeholder:'Opsional'}) + field('user_password','Password awal','password',{required:true,hint:'Minimal 12 karakter. Berikan melalui kanal yang aman.'});
    const list = state.users.length ? '<div class="table-wrap"><table><thead><tr><th>Nama / Username</th><th>Role</th><th>Status</th><th>Aksi</th></tr></thead><tbody>' + state.users.map((u) => '<tr><td><strong>' + esc(u.full_name) + '</strong><div class="tiny muted">' + esc(u.username) + '</div><div class="tiny muted">Last login: ' + esc(fmtDateTime(u.last_login)) + '</div></td><td>' + esc(u.role) + '</td><td>' + (u.active ? '<span class="tag green">Aktif</span>' : '<span class="tag red">Nonaktif</span>') + '</td><td><button class="btn btn-small btn-plain" data-act="toggle-user" data-id="' + esc(u.user_id) + '" data-active="' + (u.active ? 'false' : 'true') + '">' + (u.active ? 'Nonaktifkan' : 'Aktifkan') + '</button><button class="btn btn-small btn-soft" data-act="reset-password" data-id="' + esc(u.user_id) + '">Reset password</button></td></tr>').join('') + '</tbody></table></div>' : '<div class="empty-state">Belum ada user.</div>';
    return pageHead('ADMIN','Manajemen user','Buat akun dengan role yang tepat dan nonaktifkan akun yang sudah tidak digunakan.') + '<div class="card"><h2>Buat user baru</h2><form data-form="createUser"><div class="field-grid">' + form + '</div><button type="submit" class="btn btn-yellow btn-block">Buat akun</button></form></div><div class="card"><div class="card-head"><div><h2>Daftar user</h2><p class="muted small">Password dan hash tidak pernah ditampilkan.</p></div><button class="btn btn-small btn-plain" data-act="refresh-users">Refresh</button></div>' + list + '</div>';
  }

  function createOutletPage() {
    if (!['ADMIN','PM','TL'].includes(state.user.role)) return '<div class="card">Akses tidak diizinkan.</div>';
    const content = field('new_outlet_name','Nama outlet','text',{required:true}) + field('new_outlet_city','Kota','select',{required:true,options:['Jakarta Pusat','Jakarta Utara','Jakarta Barat','Jakarta Selatan','Jakarta Timur','Bogor','Depok','Tangerang','Tangerang Selatan','Bekasi','Lainnya']}) + field('new_outlet_area','Area / kecamatan','text',{placeholder:'Area cluster'}) + field('new_outlet_address','Alamat','textarea',{full:true}) + field('new_outlet_type','Tipe outlet','select',{options:['Toko sparepart','Distributor','Bengkel','Workshop','Toko sparepart dan bengkel','Lainnya']}) + field('new_outlet_segment','Klasifikasi SOW','select',{required:true,options:['Grosir','Semi Grosir','Retail','Belum diklasifikasi']}) + field('new_outlet_priority','Prioritas','select',{options:['P1','P2','P3']}) + field('new_outlet_contact','Nama PIC','text') + field('new_outlet_phone','Telepon PIC','tel');
    return pageHead('MASTER DATA','Tambah outlet','Data baru dicatat sebagai outlet aktif; prospect hasil riset tetap dikelola di Prospects.') + '<form data-form="createOutlet" class="card"><div class="field-grid">' + content + '</div><div class="form-actions"><button type="button" class="btn btn-plain" data-act="nav" data-page="outlets">Batal</button><button type="submit" class="btn btn-yellow">Simpan outlet</button></div></form>';
  }

  function beatPlanPage() {
    if (!['ADMIN','PM','TL'].includes(state.user.role)) return '<div class="card">Akses tidak diizinkan.</div>';
    const userOptions = state.users.filter((u) => u.active).map((u) => ({value:u.user_id,label:u.full_name + ' · ' + u.role}));
    const outletOptions = state.outletList.map((o) => ({value:o.outlet_id,label:o.outlet_name + ' · ' + o.city}));
    const content = field('beat_date','Tanggal','date',{required:true,value:localDate()}) + field('beat_week','Minggu program','text',{placeholder:'Contoh: Week 03'}) + field('beat_user','Petugas','select',{required:true,blank:'Pilih petugas',options:userOptions}) + field('beat_outlet','Outlet','select',{required:true,blank:'Pilih outlet',options:outletOptions}) + field('beat_sequence','Urutan kunjungan','number',{required:true,min:1,value:'1'}) + field('beat_notes','Catatan rute','textarea',{full:true,placeholder:'Cluster / arahan / jadwal kunjungan'});
    const list = state.beatPlan.length ? '<div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Petugas</th><th>Outlet</th><th>Status</th></tr></thead><tbody>' + state.beatPlan.map((b) => '<tr><td>' + esc(fmtDate(b.date)) + '<div class="tiny muted">' + esc(b.week || '') + '</div></td><td>' + esc(userName(b.user_id) || b.user_id) + '</td><td>' + esc(outletName(b.outlet_id) || b.outlet_id) + '</td><td>' + esc(b.status || 'PLANNED') + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="empty-state">Belum ada beat plan.</div>';
    return pageHead('OPERASIONAL','Beat plan','Assign petugas, outlet, tanggal, dan urutan. Hindari duplikasi outlet antar-teritori.') + '<div class="card"><form data-form="beatPlan"><div class="field-grid">' + content + '</div><button type="submit" class="btn btn-yellow btn-block">Simpan beat plan</button></form></div><div class="card"><div class="card-head"><div><h2>Jadwal terbaru</h2><p class="muted small">Maksimal 100 item ditampilkan.</p></div><button class="btn btn-small btn-plain" data-act="refresh-beats">Refresh</button></div>' + list + '</div>';
  }

  function outletName(id) { const outlet = state.outletList.find((o) => String(o.outlet_id) === String(id)); return outlet ? outlet.outlet_name : ''; }
  function userName(id) { const user = state.users.find((u) => String(u.user_id) === String(id)); return user ? user.full_name : ''; }
  function fieldVal(form, name) { const node = form.elements.namedItem(name); if (!node) return ''; if (node.type === 'checkbox') return node.checked ? 'Ya' : 'Tidak'; return String(node.value == null ? '' : node.value).trim(); }
  function formPhoto(key) { return state.photos[key] || null; }
  async function uploadEvidenceFor(formPhotoData, kind, recordId, outletId, geo, stableEvidenceId) {
    if (!formPhotoData) return '';
    const evidenceId = stableEvidenceId || uid('EVD');
    const result = await apiPost('uploadEvidence', { evidence_id: evidenceId, module: 'FIELD_REPORT', record_id: recordId, outlet_id: outletId || '', kind: kind, photo: {dataUrl:formPhotoData.dataUrl,mimeType:'image/jpeg'}, lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy, at: formPhotoData.capturedAt || new Date().toISOString() });
    return result.id || evidenceId;
  }

  async function submitVisitForm(form) {
    if (!state.openAttendance || !state.openAttendance.attendance_id) throw new Error('Lakukan Check In dengan foto dan GPS sebelum menyimpan visit.');
    if (!state.selectedOutlet) throw new Error('Pilih outlet terlebih dahulu.');
    const visitPhoto = formPhoto('outlet');
    if (!visitPhoto) throw new Error('Foto outlet / tampak depan wajib diambil.');
    const eligible = fieldVal(form,'eligible') === 'Ya';
    if (eligible && !state.signatureDrawn) throw new Error('Tanda tangan pemilik/PIC wajib untuk outlet qualified.');
    if (eligible && !fieldVal(form,'visit_contact')) throw new Error('Isi nama pemilik / PIC sebelum outlet dinyatakan qualified.');
    if (eligible && (!Number.isInteger(Number(fieldVal(form,'sku_count'))) || Number(fieldVal(form,'sku_count')) < 1)) throw new Error('Jumlah SKU harus angka bulat minimal 1.');
    if (eligible && !['Grosir','Semi Grosir','Retail'].includes(fieldVal(form,'segment_final'))) throw new Error('Pilih klasifikasi final Grosir, Semi Grosir, atau Retail.');
    if (eligible && fieldVal(form,'purchase_history_signal') !== 'Ya') throw new Error('Qualification memerlukan bukti sinyal pembelian dalam 6 bulan terakhir.');
    if (eligible && fieldVal(form,'owner_engagement') !== 'Ya') throw new Error('Owner/kepala mekanik harus bersedia menerima edukasi.');
    const selectedOutletType = fieldVal(form,'outlet_type');
    if (eligible && /bengkel|workshop/i.test(selectedOutletType) && Number(fieldVal(form,'active_bays')) < 3) throw new Error('Bengkel/workshop harus memiliki minimal 3 active bay.');
    if (eligible && !/bengkel|workshop/i.test(selectedOutletType) && fieldVal(form,'brake_steering_stock_confirmed') !== 'Ya') throw new Error('Stok aktif brake/steering/suspension harus terverifikasi.');
    if (eligible && !fieldVal(form,'sku_range')) throw new Error('Isi range SKU/produk yang relevan.');
    if (!eligible && !fieldVal(form,'qualification_reason')) throw new Error('Jelaskan alasan outlet tidak qualified atau belum siap.');
    const posmAction = fieldVal(form, 'posm_action') || 'Tidak ada perubahan';
    const beforePhoto = formPhoto('posm_before'); const afterPhoto = formPhoto('posm_after');
    if (posmAction !== 'Tidak ada perubahan' && (!beforePhoto || !afterPhoto)) throw new Error('Ambil foto POSM Before dan After.');
    const geo = await getGeo(); const outlet = state.selectedOutlet;
    if (!state.visitFlow) state.visitFlow = { visitId: uid('VIS'), qualificationId: uid('QLF'), posmId: uid('POS'), educationId: uid('EDU'), surveyId: uid('SRV'), competitorId: uid('CMP'), outletEvidenceId: uid('EVD'), signatureEvidenceId: uid('EVD'), posmBeforeEvidenceId: uid('EVD'), posmAfterEvidenceId: uid('EVD') };
    const ids = state.visitFlow;
    toast('Menyimpan laporan…');
    const visit = await apiPost('saveVisit', { visit_id: ids.visitId, outlet_id: outlet.outlet_id, visit_type: fieldVal(form,'visit_type'), attendance_id: state.openAttendance.attendance_id, visit_at: new Date().toISOString(), lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy, notes: fieldVal(form,'visit_notes'), status:'SUBMITTED' });
    const visitEvidence = await uploadEvidenceFor(visitPhoto, 'OUTLET_FRONT', ids.visitId, outlet.outlet_id, geo, ids.outletEvidenceId);
    const signatureEvidence = state.signatureDrawn ? await uploadEvidenceFor({dataUrl:state.signatureData,mimeType:'image/jpeg',capturedAt:state.signatureCapturedAt || new Date().toISOString(),fileName:'owner-signature.jpg'}, 'OWNER_SIGNATURE', ids.visitId, outlet.outlet_id, geo, ids.signatureEvidenceId) : '';
    await apiPost('saveQualification', { qualification_id: ids.qualificationId, visit_id: ids.visitId, outlet_id: outlet.outlet_id, outlet_type: fieldVal(form,'outlet_type'), active_bays: fieldVal(form,'active_bays'), brake_steering_stock_confirmed: fieldVal(form,'brake_steering_stock_confirmed'), segment_final: fieldVal(form,'segment_final'), brand_count: fieldVal(form,'brand_count'), sku_count: fieldVal(form,'sku_count'), signature_evidence_id: signatureEvidence, purchase_history_signal: fieldVal(form,'purchase_history_signal'), owner_engagement: fieldVal(form,'owner_engagement'), sku_range: fieldVal(form,'sku_range'), purchase_frequency: fieldVal(form,'purchase_frequency'), trw_shelf_presence: fieldVal(form,'trw_shelf_presence'), eligible: eligible, reason: fieldVal(form,'qualification_reason'), evidence_ok: !!visitEvidence, evidence_id: visitEvidence, contact_name: fieldVal(form,'visit_contact'), contact_phone: fieldVal(form,'visit_phone'), b2b_sales: fieldVal(form,'b2b_sales'), segment_indicative: outlet.segment_indicative || '' });
    let beforeId = ''; let afterId = '';
    if (beforePhoto) beforeId = await uploadEvidenceFor(beforePhoto, 'POSM_BEFORE', ids.posmId, outlet.outlet_id, geo, ids.posmBeforeEvidenceId);
    if (afterPhoto) afterId = await uploadEvidenceFor(afterPhoto, 'POSM_AFTER', ids.posmId, outlet.outlet_id, geo, ids.posmAfterEvidenceId);
    await apiPost('savePosm', { posm_id: ids.posmId, visit_id: ids.visitId, outlet_id: outlet.outlet_id, posm_type: fieldVal(form,'posm_type'), condition_before: fieldVal(form,'condition_before'), action: posmAction, condition_after: fieldVal(form,'condition_after'), before_evidence_id: beforeId, after_evidence_id: afterId, owner_approval: fieldVal(form,'owner_approval') === 'Ya', owner_name: fieldVal(form,'posm_owner_name'), notes: fieldVal(form,'posm_notes') });
    await apiPost('saveEducation', { education_id: ids.educationId, visit_id: ids.visitId, outlet_id: outlet.outlet_id, education_done: fieldVal(form,'education_done') === 'Ya', education_type: fieldVal(form,'education_type'), product_knowledge: fieldVal(form,'product_knowledge'), promotion_explained: fieldVal(form,'promotion_explained'), owner_name: fieldVal(form,'education_owner'), verified: fieldVal(form,'education_verified') === 'Ya', evidence_id: visitEvidence, notes: '' });
    if (fieldVal(form,'survey_done') === 'Ya') {
      await apiPost('saveSurvey', { survey_id: ids.surveyId, visit_id: ids.visitId, outlet_id: outlet.outlet_id, purchase_intent: fieldVal(form,'purchase_intent'), current_brand: fieldVal(form,'current_brand'), current_volume: fieldVal(form,'current_volume'), trw_stock: fieldVal(form,'trw_stock'), trw_price: fieldVal(form,'trw_price'), competitor_brand: fieldVal(form,'competitor_brand'), competitor_price: fieldVal(form,'competitor_price'), barrier_switching: fieldVal(form,'barrier_switching'), restock_frequency: fieldVal(form,'restock_frequency'), preferred_sku: fieldVal(form,'preferred_sku'), brand_awareness: fieldVal(form,'brand_awareness'), quality_perception: fieldVal(form,'quality_perception'), price_perception: fieldVal(form,'price_perception'), unmet_demand: fieldVal(form,'unmet_demand'), insight: fieldVal(form,'market_insight') });
      if (fieldVal(form,'competitor_brand')) await apiPost('saveCompetitor', { competitor_id: ids.competitorId, survey_id: ids.surveyId, outlet_id: outlet.outlet_id, brand: fieldVal(form,'competitor_brand'), category: fieldVal(form,'outlet_type'), sku: fieldVal(form,'preferred_sku'), price: fieldVal(form,'competitor_price'), availability: fieldVal(form,'trw_stock'), display: '', notes: fieldVal(form,'market_insight') });
    }
    state.visitFlow = null; state.photos = {}; state.signatureData = ''; state.signatureDrawn = false; state.signatureCapturedAt = ''; state.inputType = ''; state.page = 'home';
    await refreshAll(false);
    toast(visit.queued ? 'Laporan masuk antrean offline.' : 'Laporan kunjungan berhasil disimpan.', 'ok'); render();
  }

  async function submitActivationForm(form) {
    if (!state.openAttendance) throw new Error('Lakukan Check In dengan foto dan GPS sebelum aktivasi.');
    if (!state.selectedOutlet) throw new Error('Pilih outlet terlebih dahulu.');
    const outlet = state.selectedOutlet;
    if (!(outlet.is_qualified || String(outlet.status).toUpperCase() === 'QUALIFIED')) throw new Error('Pilih outlet yang sudah qualified.');
    const photo = formPhoto('activation'); if (!photo) throw new Error('Foto aktivitas SPG wajib diambil.');
    const geo = await getGeo();
    if (!state.activationFlow) state.activationFlow = { activationId: uid('ACT'), evidenceId: uid('EVD') };
    const activationId = state.activationFlow.activationId;
    const evidenceId = await uploadEvidenceFor(photo, 'SPG_ACTIVATION', activationId, outlet.outlet_id, geo, state.activationFlow.evidenceId);
    const result = await apiPost('saveSpgActivation', { activation_id: activationId, activation_date: localDate(), outlet_id: outlet.outlet_id, qualified_visit_id: outlet.latest_qualified_visit_id || outlet.outlet_id, attendance_id: state.openAttendance.attendance_id, start_at: new Date().toISOString(), attendance_count: fieldVal(form,'activation_attendance_count'), education_done: fieldVal(form,'activation_education') === 'Ya', demo_done: fieldVal(form,'activation_demo') === 'Ya', catalogue_left: fieldVal(form,'activation_catalogue') === 'Ya', owner_name: fieldVal(form,'activation_owner'), owner_verified: fieldVal(form,'activation_verified') === 'Ya', evidence_id: evidenceId, notes: fieldVal(form,'activation_notes') });
    state.lastActivationId = result.id || activationId; state.activationFlow = null; state.photos = {}; state.inputType = 'interaction'; state.page = 'input'; await refreshAll(false); toast(result.queued ? 'Aktivasi menunggu sinkronisasi.' : 'Aktivasi tersimpan. Lanjutkan input interaksi.', 'ok'); render();
  }

  async function submitInteractionForm(form) {
    if (!state.openAttendance || !state.openAttendance.attendance_id) throw new Error('Lakukan Check In dengan foto dan GPS sebelum mencatat interaksi.');
    if (!state.selectedOutlet) throw new Error('Pilih outlet aktivasi di menu Outlet sebelum input interaksi.');
    const activation = fieldVal(form,'activation_id') || state.lastActivationId;
    if (!activation) throw new Error('Pilih sesi activation. Buat activation terlebih dahulu.');
    const result = await apiPost('saveInteraction', { interaction_id: (state.interactionFlowId || (state.interactionFlowId = uid('INT'))), activation_id: activation, outlet_id: state.selectedOutlet.outlet_id, attendance_id: state.openAttendance ? state.openAttendance.attendance_id : '', count: fieldVal(form,'interaction_count'), purchase_intent_1_5: fieldVal(form,'interaction_intent'), brand_used: fieldVal(form,'interaction_brand_used'), brand_considered: fieldVal(form,'interaction_brand_considered'), information_requested: fieldVal(form,'interaction_requested'), potential_lead: fieldVal(form,'interaction_lead') === 'Ya', notes: fieldVal(form,'interaction_notes') });
    const surveyFields = ['spg_current_brand','spg_current_volume','spg_trw_stock','spg_trw_price','spg_competitor_brand','spg_competitor_price','spg_barrier_switching','spg_restock_frequency','spg_preferred_sku','spg_brand_awareness','spg_quality_perception','spg_price_perception','spg_unmet_demand','spg_market_insight'];
    const hasInsight = surveyFields.some((name) => !!fieldVal(form,name)) || !!fieldVal(form,'interaction_intent');
    if (hasInsight) {
      const spgSurveyId = state.spgSurveyFlowId || (state.spgSurveyFlowId = uid('SPS'));
      await apiPost('saveSpgSurvey', { spg_survey_id: spgSurveyId, activation_id: activation, outlet_id: state.selectedOutlet.outlet_id, attendance_id: state.openAttendance ? state.openAttendance.attendance_id : '', purchase_intent: fieldVal(form,'interaction_intent'), current_brand: fieldVal(form,'spg_current_brand'), current_volume: fieldVal(form,'spg_current_volume'), trw_stock: fieldVal(form,'spg_trw_stock'), trw_price: fieldVal(form,'spg_trw_price'), competitor_brand: fieldVal(form,'spg_competitor_brand'), competitor_price: fieldVal(form,'spg_competitor_price'), barrier_switching: fieldVal(form,'spg_barrier_switching'), restock_frequency: fieldVal(form,'spg_restock_frequency'), preferred_sku: fieldVal(form,'spg_preferred_sku'), brand_awareness: fieldVal(form,'spg_brand_awareness'), quality_perception: fieldVal(form,'spg_quality_perception'), price_perception: fieldVal(form,'spg_price_perception'), unmet_demand: fieldVal(form,'spg_unmet_demand'), insight: fieldVal(form,'spg_market_insight') });
    }
    state.interactionFlowId = ''; state.spgSurveyFlowId = ''; state.inputType = ''; state.page = 'home'; await refreshAll(false); toast(result.queued ? 'Interaksi masuk antrean.' : 'Interaksi berhasil disimpan.', 'ok'); render();
  }

  async function submitIssueForm(form) {
    if (!state.openAttendance || !state.openAttendance.attendance_id) throw new Error('Lakukan Check In dengan foto dan GPS sebelum menyimpan issue lapangan.');
    const result = await apiPost('saveIssue', { attendance_id: state.openAttendance.attendance_id, issue_id: (state.issueFlowId || (state.issueFlowId = uid('ISS'))), date: localDate(), outlet_id: state.selectedOutlet ? state.selectedOutlet.outlet_id : '', issue: fieldVal(form,'issue_title'), action: fieldVal(form,'issue_action'), owner: fieldVal(form,'issue_owner'), deadline: fieldVal(form,'issue_deadline'), status: 'OPEN', notes: 'Priority: ' + (fieldVal(form,'issue_priority') || 'Normal') + (fieldVal(form,'issue_notes') ? ' | ' + fieldVal(form,'issue_notes') : '') });
    state.issueFlowId = ''; state.inputType = ''; state.page = 'reports'; await refreshAll(false); toast(result.queued ? 'Issue masuk antrean offline.' : 'Issue tersimpan.', 'ok'); render();
  }

  async function attendanceAction(kind) {
    try {
      if (kind === 'checkout' && !state.openAttendance) throw new Error('Tidak ada Check In aktif.');
      if (kind === 'checkin' && state.openAttendance) throw new Error('Anda sudah Check In. Lakukan Check Out sebelum Check In berikutnya.');
      toast(kind === 'checkin' ? 'Mengambil foto Check In…' : 'Mengambil foto Check Out…');
      const photo = await capturePhoto();
      toast('Membaca GPS…'); const geo = await getGeo();
      const at = new Date().toISOString(); const attendanceId = kind === 'checkin' ? uid('ATT') : state.openAttendance.attendance_id; const evidenceId = uid('EVD');
      const payload = { attendance_id: attendanceId, evidence_id: evidenceId, outlet_id: state.selectedOutlet ? state.selectedOutlet.outlet_id : '', lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy, at: at, photo: { dataUrl: photo.dataUrl, mimeType: 'image/jpeg' } };
      const result = await apiPost(kind, payload);
      if (kind === 'checkin') {
        state.openAttendance = { attendance_id: attendanceId, checkin_at: at, status: 'OPEN', user_id: state.user.user_id, pending: !!result.queued };
        await metaPut('openAttendance', state.openAttendance); localStorage.setItem(STORE.openAttendance, JSON.stringify(state.openAttendance));
        toast(result.queued ? 'Check In disimpan di perangkat, menunggu sinkronisasi.' : 'Check In berhasil. Foto dan GPS tercatat.', 'ok');
      } else {
        state.openAttendance = null; await metaDelete('openAttendance'); localStorage.removeItem(STORE.openAttendance);
        toast(result.queued ? 'Check Out disimpan di perangkat, menunggu sinkronisasi.' : 'Check Out berhasil. Foto dan GPS tercatat.', 'ok');
      }
      await refreshAll(false); render();
    } catch (error) { showError(error); }
  }

  async function refreshAll(showToast = true) {
    if (!state.token || !state.user) return;
    try {
      if (!navigator.onLine) {
        state.dashboard = await metaGet('dashboard') || state.dashboard;
        state.outletList = await metaGet('outlets') || state.outletList;
        state.reports = await metaGet('reports') || state.reports;
        state.attendance = await metaGet('attendance') || state.attendance;
        await updateQueueState();
        render();
        return;
      }
      const [dashboard, outlets, reports, attendance] = await Promise.all([
        apiGet('dashboard'), apiGet('outlets', { limit: 500 }), apiGet('reports', { limit: 100 }), apiGet('attendance')
      ]);
      await Promise.all([metaPut('dashboard', dashboard), metaPut('outlets', outlets.items || []), metaPut('reports', reports), metaPut('attendance', attendance)]);
      state.dashboard = dashboard; state.outletList = outlets.items || []; state.reports = reports; state.attendance = attendance;
      const queue = await queueAll();
      const pendingCheckouts = new Set(queue.filter((i) => i.action === 'checkout').map((i) => i.payload.attendance_id));
      const pendingCheckins = queue.filter((i) => i.action === 'checkin').slice(-1)[0];
      let open = attendance.openAttendance || null;
      if (open && pendingCheckouts.has(open.attendance_id)) open = null;
      if (!open && pendingCheckins && !pendingCheckouts.has(pendingCheckins.payload.attendance_id)) open = { attendance_id: pendingCheckins.payload.attendance_id, checkin_at: pendingCheckins.payload.at, status: 'OPEN', user_id: state.user.user_id, pending: true };
      if (!open) {
        const localOpen = readJson(localStorage.getItem(STORE.openAttendance), null);
        if (localOpen && localOpen.user_id === state.user.user_id && !pendingCheckouts.has(localOpen.attendance_id)) open = localOpen;
      }
      state.openAttendance = open;
      if (open) { localStorage.setItem(STORE.openAttendance, JSON.stringify(open)); await metaPut('openAttendance', open); }
      else { localStorage.removeItem(STORE.openAttendance); await metaDelete('openAttendance'); }
      if (['ADMIN','PM','TL'].includes(state.user.role)) { try { const users = await apiGet(state.user.role === 'ADMIN' ? 'users' : 'team'); state.users = users.items || []; await metaPut('users', state.users); } catch (_) {} }
      if (['ADMIN','PM','TL'].includes(state.user.role)) { try { const beats = await apiGet('beatPlan'); state.beatPlan = beats.items || []; await metaPut('beatPlan', state.beatPlan); } catch (_) {} }
      if (showToast) toast('Data terbaru berhasil dimuat.', 'ok');
      render();
    } catch (error) {
      if (/Sesi berakhir|Sesi tidak ditemukan|Akun tidak aktif/i.test(error.message || '')) { signOutLocal(); toast('Sesi berakhir. Login kembali.', 'bad'); }
      else if (showToast) showError(error);
      render();
    }
  }

  function signOutLocal() { state.token = ''; state.user = null; localStorage.removeItem(STORE.token); localStorage.removeItem(STORE.user); state.page = 'home'; state.openAttendance = readJson(localStorage.getItem(STORE.openAttendance), null); render(); }
  async function loginSubmit(form) {
    const result = await apiPost('login', { username: fieldVal(form,'username'), password: fieldVal(form,'password') }, { allowQueue: false });
    if (!result || !result.token || !result.user) throw new Error('Respons login tidak valid.');
    state.token = result.token; state.user = result.user; state.page = 'home';
    localStorage.setItem(STORE.token, state.token); localStorage.setItem(STORE.user, JSON.stringify(state.user));
    await updateQueueState(); await refreshAll(false); toast('Login berhasil. Selamat bekerja.', 'ok');
  }

  function downloadCSV(filename, headers, rows) {
    const lines = [headers].concat(rows).map((row) => row.map((value) => {
      let text = value == null ? '' : String(value);
      if (/^[=+@\-]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g,'""') + '"';
    }).join(','));
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], {type:'text/csv;charset=utf-8;'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportSummary(period) {
    const summary = (state.reports && state.reports.periods && state.reports.periods[period]) || {};
    const data = Object.keys(summary).filter((key) => key !== 'range').map((key) => [key, summary[key]]);
    data.unshift(['Period', period], ['Range', summary.range || '']);
    downloadCSV('TRW_' + period + '_summary_' + new Date().toISOString().slice(0,10) + '.csv', ['Metric','Value'], data);
  }
  async function exportRecords() {
    const dataset = ['visits','attendance','qualifications','posm','education','surveys','competitors','spgSurveys','activations','interactions','issues','evidence'].includes(state.reportTab) ? state.reportTab : 'visits';
    const result = await apiGet('exportData', { dataset: dataset, period: state.periodTab });
    const rows = result.items || [];
    if (!rows.length) { toast('Tidak ada data pada periode yang dipilih.'); return; }
    const headers = Array.from(rows.reduce((set, row) => { Object.keys(row).forEach((key) => set.add(key)); return set; }, new Set()));
    downloadCSV('TRW_' + dataset + '_' + state.periodTab + '_' + new Date().toISOString().slice(0,10) + '.csv', headers, rows.map((row) => headers.map((key) => row[key] == null ? '' : row[key])));
    if (result.truncated) toast('Ekspor dibatasi ke 5.000 baris terakhir.');
    else toast(rows.length + ' baris berhasil diekspor.', 'ok');
  }

  async function handleSubmit(event) {
    const form = event.target.closest('form[data-form]'); if (!form) return;
    event.preventDefault(); if (form.dataset.busy === '1') return;
    setBusy(form, true);
    try {
      const type = form.dataset.form;
      if (type === 'login') await loginSubmit(form);
      else if (type === 'visit') await submitVisitForm(form);
      else if (type === 'activation') await submitActivationForm(form);
      else if (type === 'interaction') await submitInteractionForm(form);
      else if (type === 'issue') await submitIssueForm(form);
      else if (type === 'createUser') {
        await apiPost('createUser',{full_name:fieldVal(form,'user_full_name'),username:fieldVal(form,'user_username'),role:fieldVal(form,'user_role'),phone:fieldVal(form,'user_phone'),password:fieldVal(form,'user_password'),user_id:uid('USR')},{allowQueue:false});
        form.reset(); await loadUsers(); toast('Akun baru berhasil dibuat. Berikan password awal melalui kanal aman.','ok'); render();
      } else if (type === 'createOutlet') {
        await apiPost('createOutlet',{outlet_id:uid('OUT'),outlet_name:fieldVal(form,'new_outlet_name'),city:fieldVal(form,'new_outlet_city'),area:fieldVal(form,'new_outlet_area'),address:fieldVal(form,'new_outlet_address'),type:fieldVal(form,'new_outlet_type'),segment_final:fieldVal(form,'new_outlet_segment'),priority:fieldVal(form,'new_outlet_priority'),contact_name:fieldVal(form,'new_outlet_contact'),contact_phone:fieldVal(form,'new_outlet_phone')},{allowQueue:false});
        await refreshAll(false); state.page='outlets'; toast('Outlet berhasil ditambahkan.','ok'); render();
      } else if (type === 'beatPlan') {
        await apiPost('saveBeatPlan',{beat_id:uid('BEAT'),date:fieldVal(form,'beat_date'),week:fieldVal(form,'beat_week'),user_id:fieldVal(form,'beat_user'),outlet_id:fieldVal(form,'beat_outlet'),sequence:fieldVal(form,'beat_sequence'),notes:fieldVal(form,'beat_notes'),status:'PLANNED',planned:true},{allowQueue:false});
        form.reset(); await loadBeatPlan(); toast('Beat plan tersimpan.','ok'); render();
      }
    } catch (error) { showError(error); }
    finally { setBusy(form, false); }
  }

  async function loadOutlets() {
    if (navigator.onLine) {
      const result = await apiGet('outlets', { limit: 500 }); state.outletList = result.items || []; await metaPut('outlets', state.outletList); return;
    }
    const cached = await metaGet('outlets'); if (cached) state.outletList = cached;
  }
  async function loadReports() { if (!navigator.onLine) { state.reports = await metaGet('reports') || state.reports; return; } const result = await apiGet('reports',{limit:100}); state.reports = result; await metaPut('reports', result); }
  async function loadUsers() { if (!navigator.onLine) { state.users = await metaGet('users') || state.users; return; } const result = await apiGet(state.user.role === 'ADMIN' ? 'users' : 'team'); state.users = result.items || []; await metaPut('users', state.users); }
  async function loadBeatPlan() { if (!navigator.onLine) { state.beatPlan = await metaGet('beatPlan') || state.beatPlan; return; } const result = await apiGet('beatPlan'); state.beatPlan = result.items || []; await metaPut('beatPlan', state.beatPlan); }
  function selectOutlet(id) {
    const item = state.outletList.find((o) => String(o.outlet_id) === String(id));
    if (!item) { toast('Outlet tidak ditemukan. Refresh daftar outlet.', 'bad'); return; }
    state.selectedOutlet = item;
    state.visitFlow = null; state.activationFlow = null; state.photos = {}; state.signatureData = ''; state.signatureDrawn = false; state.signatureCapturedAt = '';
    state.lastActivationId = '';
    state.inputType = state.user.role === 'SPG' ? (item.is_qualified || String(item.status).toUpperCase() === 'QUALIFIED' ? 'activation' : '') : 'visit';
    state.page = 'input';
    if (state.user.role === 'SPG' && !state.inputType) toast('Outlet belum qualified. SPG hanya dapat aktivasi di outlet qualified.', 'bad');
    render();
  }
  async function changePasswordPrompt() {
    const old = prompt('Masukkan password saat ini:'); if (old === null) return;
    const next = prompt('Masukkan password baru (minimal 12 karakter):'); if (next === null) return;
    const confirm = prompt('Ulangi password baru:'); if (confirm === null) return;
    if (next !== confirm) { toast('Konfirmasi password tidak sama.', 'bad'); return; }
    try { await apiPost('changePassword',{current_password:old,new_password:next},{allowQueue:false}); toast('Password berhasil diganti.','ok'); }
    catch (error) { showError(error); }
  }
  async function loadCurrentPageData() {
    try {
      if (state.page === 'outlets') await loadOutlets();
      if (state.page === 'reports') { await loadReports(); }
      if (state.page === 'users') await loadUsers();
      if (state.page === 'beatplan') { await Promise.all([loadBeatPlan(), loadUsers(), loadOutlets()]); }
      if (state.page === 'createOutlet') await loadOutlets();
    } catch (error) { if (navigator.onLine) toast(error.message || 'Data tidak berhasil dimuat.', 'bad'); }
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-act]'); if (!button) return;
    const act = button.dataset.act;
    try {
      if (act === 'nav') { state.page = button.dataset.page || 'home'; if (state.page === 'input') state.inputType=''; await loadCurrentPageData(); render(); }
      else if (act === 'refresh') await refreshAll(true);
      else if (act === 'refresh-reports') { await loadReports(); render(); toast('Laporan diperbarui.','ok'); }
      else if (act === 'refresh-users') { await loadUsers(); render(); }
      else if (act === 'refresh-beats') { await loadBeatPlan(); render(); }
      else if (act === 'checkin') await attendanceAction('checkin');
      else if (act === 'checkout') await attendanceAction('checkout');
      else if (act === 'sync') await syncQueue();
      else if (act === 'logout') {
        const open = state.openAttendance;
        if (open && !confirm('Anda masih Check In. Logout tidak melakukan Check Out. Tetap logout?')) return;
        try { await apiPost('logout',{}, {allowQueue:false}); } catch (_) {}
        signOutLocal(); toast('Logout aplikasi berhasil.','ok');
      }
      else if (act === 'search-outlets') { state.outletQuery = $('#outlet-search') ? $('#outlet-search').value : ''; if (navigator.onLine) await loadOutlets(); render(); }
      else if (act === 'outlet-filter') { state.outletFilter = button.dataset.filter || 'all'; render(); }
      else if (act === 'choose-outlet') selectOutlet(button.dataset.id);
      else if (act === 'clear-signature') { state.signatureData=''; state.signatureDrawn=false; state.signatureCapturedAt=''; const canvas=$('#owner-signature'); if(canvas){const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);} const status=$('#signature-status'); if(status) status.textContent='Belum ditandatangani.'; }
      else if (act === 'clear-outlet') { state.selectedOutlet=null; state.inputType=''; state.visitFlow=null; state.activationFlow=null; state.photos={}; state.signatureData=''; state.signatureDrawn=false; state.signatureCapturedAt=''; state.lastActivationId=''; state.page='outlets'; render(); }
      else if (act === 'start-input') { state.inputType = state.user.role === 'SPG' ? 'activation' : 'visit'; state.page='input'; render(); }
      else if (act === 'select-form') { state.inputType = button.dataset.formType || ''; state.page='input'; render(); }
      else if (act === 'report-tab') { state.periodTab=button.dataset.tab; render(); }
      else if (act === 'report-list-tab') { state.reportTab=button.dataset.tab; render(); }
      else if (act === 'export-summary') exportSummary(button.dataset.period || 'daily');
      else if (act === 'export-records') await exportRecords();
      else if (act === 'change-password') await changePasswordPrompt();
      else if (act === 'toggle-user') { const active = button.dataset.active === 'true'; if (!confirm((active ? 'Aktifkan' : 'Nonaktifkan') + ' akun ini?')) return; await apiPost('setUserActive',{user_id:button.dataset.id,active:active},{allowQueue:false}); await loadUsers(); render(); toast('Status akun diperbarui.','ok'); }
      else if (act === 'reset-password') { const password = prompt('Password baru (minimal 12 karakter):'); if (password === null) return; if (password.length < 12) throw new Error('Password minimal 12 karakter.'); await apiPost('resetUserPassword',{user_id:button.dataset.id,new_password:password},{allowQueue:false}); toast('Password direset. Berikan melalui kanal aman.','ok'); }
    } catch (error) { showError(error); }
  });

  document.addEventListener('submit', handleSubmit);
  document.addEventListener('change', async (event) => {
    const input = event.target;
    if (input && input.dataset && input.dataset.photo) {
      const key = input.dataset.photo; const preview = $('[data-preview-for="' + key + '"]');
      try {
        if (!input.files || !input.files[0]) { delete state.photos[key]; if (preview) preview.innerHTML=''; return; }
        if (preview) preview.innerHTML = '<div class="photo-meta">Mengompres foto…</div>';
        const photo = await compressPhoto(input.files[0]); state.photos[key] = photo;
        if (preview) preview.innerHTML = '<img class="photo-preview" alt="Pratinjau ' + esc(key) + '" src="' + photo.dataUrl + '"><div class="photo-meta">Foto siap · ' + Math.round(photo.dataUrl.length * .75 / 1024) + ' KB</div>';
      } catch (error) { delete state.photos[key]; if (preview) preview.innerHTML=''; showError(error); }
    }
  });
  window.addEventListener('online', async () => { state.online = true; updateNetworkBadge(); if (state.token) { await updateQueueState(); if (state.queueCount) { toast('Koneksi kembali. Sinkronisasi antrean dimulai…', 'ok'); await syncQueue(); } else toast('Koneksi kembali. Semua data sudah tersinkron.', 'ok'); } });
  window.addEventListener('offline', () => { state.online = false; updateNetworkBadge(); toast('Offline. Data lapangan yang didukung akan disimpan di perangkat.'); });

  async function init() {
    if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./sw.js').catch(() => {});
    try { await updateQueueState(); } catch (_) {}
    if (state.token && state.user) {
      try { await refreshAll(false); }
      catch (_) { render(); }
    } else render();
  }
  init();
})();
