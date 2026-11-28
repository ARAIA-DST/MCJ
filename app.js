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
    fmRoute: null,
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
    clientExportRange: null,
    clientExporting: false,
    loading: false,
    queueCount: 0,
    queueBytes: 0,
    syncing: false,
    online: navigator.onLine,
    message: '',
    fmLocations: [],
    sidebarCollapsed: localStorage.getItem('trw_sidebar_collapsed') === '1',
    drawerOpen: false
  };
  const tabletNavigation = window.matchMedia('(min-width: 768px) and (max-width: 1199px)');
  let renderedView = '';
  let dbPromise = null;
  const postWaiters = new Map();

  
  let fmLocationInterval = null;
  function startFmLocationTracking() {
    if (!navigator.geolocation || !state.user || state.user.role !== 'FM') return;
    if (fmLocationInterval) return;

    const sendLocation = (pos) => {
      if (!pos || !pos.coords || !state.token) return;
      const lat = Number(pos.coords.latitude.toFixed(6));
      const lng = Number(pos.coords.longitude.toFixed(6));
      const accuracy = Number(pos.coords.accuracy || 0);
      const activeOutletId = (state.openAttendance && state.openAttendance.outlet_id) || '';
      const status = state.openAttendance ? 'CHECKED_IN' : 'ONLINE';
      
      apiPost('updateFmLocation', {
        lat: lat,
        lng: lng,
        accuracy: accuracy,
        active_outlet_id: activeOutletId,
        status: status
      }, { allowQueue: false }).catch(() => {});
    };

    navigator.geolocation.getCurrentPosition(sendLocation, () => {}, { enableHighAccuracy: true, timeout: 10000 });
    fmLocationInterval = setInterval(() => {
      if (!state.token || !state.user || state.user.role !== 'FM') {
        stopFmLocationTracking();
        return;
      }
      navigator.geolocation.getCurrentPosition(sendLocation, () => {}, { enableHighAccuracy: true, timeout: 10000 });
    }, 35000);
  }

  function stopFmLocationTracking() {
    if (fmLocationInterval) {
      clearInterval(fmLocationInterval);
      fmLocationInterval = null;
    }
  }

  function readJson(text, fallback) { try { return text ? JSON.parse(text) : fallback; } catch (_) { return fallback; } }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch])); }
  function uid(prefix) { return (prefix || 'ID') + '-' + (window.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g,'').slice(0,18).toUpperCase() : (Date.now().toString(36) + Math.random().toString(36).slice(2,10)).toUpperCase()); }
  function fmtDate(value) { if (!value) return '—'; const date = new Date(value); if (isNaN(date.getTime())) return String(value); return new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Jakarta'}).format(date); }
  function fmtDateTime(value) { if (!value) return '—'; const date = new Date(value); if (isNaN(date.getTime())) return String(value); return new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Jakarta'}).format(date); }
  function fmtNum(value) { return new Intl.NumberFormat('id-ID').format(Number(value || 0)); }
  function localDate() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date());
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return values.year + '-' + values.month + '-' + values.day;
  }
  function pct(value, target) { return target ? Math.min(100, Math.round(Number(value || 0) / Number(target) * 100)) : 0; }
  function roleName(role) { return ({ADMIN:'Administrator', PM:'Project Manager', TL:'Talent Coordinator / Team Leader', FM:'Field Merchandiser', SPG:'Mobile SPG', CLIENT:'Client / TRW (read-only)'})[role] || role || 'User'; }
  function toast(message, type) {
    const region = $('#toast-region'); if (!region) return;
    region.innerHTML = '<div class="toast ' + (type || '') + '">' + esc(message) + '</div>';
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { region.innerHTML = ''; }, 4500);
  }
  function showError(error) { toast(error && error.message ? error.message : String(error || 'Terjadi kesalahan.'), 'bad'); }
  function setBusy(form, busy, label) {
    if (!form) return;
    form.dataset.busy = busy ? '1' : '0';
    form.setAttribute('aria-busy', String(busy));
    if (busy) form.querySelector('.form-feedback')?.remove();
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
    const status = navigator.onLine ? 'Online' : 'Offline';
    if (el && el.textContent !== status) {
      el.className = 'status-pill ' + status.toLowerCase();
      el.textContent = status;
    }
    const q = $('#queue-badge'); if (q) { q.textContent = state.queueCount ? String(state.queueCount) : ''; q.classList.toggle('hidden', !state.queueCount); }
    const banner = $('#sync-banner');
    if (banner) {
      banner.classList.toggle('hidden', !state.queueCount);
      $('#sync-count', banner).textContent = state.queueCount + ' kiriman menunggu sinkronisasi';
      $('button', banner).disabled = !navigator.onLine || state.syncing;
    }
  }
  function hasAPI() { return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/.test(String(C.API_URL || '')); }
  function endpointWith(params) {
    const base = String(C.API_URL || '').trim();
    const query = new URLSearchParams(params).toString();
    return base + (base.indexOf('?') >= 0 ? '&' : '?') + query;
  }
  /**
   * apiGet — Dual-channel GET requests to Apps Script.
   * Channel 1: fetch() with credentials:'omit' (Google account cookies stripped, direct JSON).
   * Channel 2: JSONP fallback (<script>) if fetch is blocked or CORS fails.
   */
  async function apiGet(action, params, options) {
    params = params || {};
    options = options || {};
    if (!hasAPI()) throw new Error('URL Apps Script belum dipasang. Isi frontend/config.js dengan URL /exec hasil deployment.');
    const timeout = Number(options.timeout) || 25000;
    const query = Object.assign({}, params, { action: action, token: state.token, _: Date.now() });

    // Channel 1: fetch with credentials:'omit' (clean, anonymous, no Google multi-account cookie redirect)
    if (typeof fetch === 'function') {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timerId = controller ? setTimeout(function () { controller.abort(); }, timeout) : null;
      try {
        const url = endpointWith(query);
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'omit',
          redirect: 'follow',
          signal: controller ? controller.signal : undefined
        });
        const text = await response.text();
        let data = null;
        try { data = JSON.parse(text); } catch (_) {}
        if (data && typeof data === 'object') {
          if (data.ok === false) throw new Error(data.error || 'Permintaan gagal.');
          return data;
        }
      } catch (err) {
        if (err && err.name === 'AbortError') throw new Error('API terlalu lama merespons (' + Math.round(timeout / 1000) + ' dtk). Coba lagi.');
        if (err && /Username atau password salah|Terlalu banyak percobaan|Akun tidak aktif|Permintaan ditolak|Akses tidak diizinkan/i.test(err.message)) throw err;
        // Other fetch errors fall through to JSONP fallback
      } finally {
        if (timerId) clearTimeout(timerId);
      }
    }

    // Channel 2: JSONP fallback (<script src="...">)
    return new Promise((resolve, reject) => {
      const callbackName = '__trw_cb_' + uid('cb').replace(/[^A-Za-z0-9_]/g, '');
      const script = document.createElement('script');
      script.referrerPolicy = 'no-referrer';
      let settled = false;
      const timer = setTimeout(() => finish(reject, new Error('API terlalu lama merespons. Coba lagi.')), timeout);
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
        fn(value);
      };
      window[callbackName] = (data) => {
        if (data && data.ok === false) finish(reject, new Error(data.error || 'Permintaan gagal.'));
        else finish(resolve, data || {});
      };
      script.onerror = () => finish(reject, new Error('API belum dapat dijangkau. Periksa URL deployment dan koneksi internet.'));
      const jsonpQuery = Object.assign({}, query, { callback: callbackName });
      script.src = endpointWith(jsonpQuery);
      script.async = true;
      document.head.appendChild(script);
    });
  }

  function makeBridgeProof() {
    if (!window.crypto || !window.crypto.getRandomValues) throw new Error('Browser tidak menyediakan generator aman. Buka aplikasi di Chrome/Safari terbaru melalui HTTPS.');
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * bridgePost — ALL POST/write requests to Apps Script.
   * Step 1: Send POST via fetch() with credentials:'omit' + mode:'no-cors' (fire & forget, can't read response).
   * Step 2: Poll bridgeStatus via apiGet() (which also uses credentials:'omit') to retrieve the result.
   * No iframes, no form submissions, no postMessage — purely fetch-based.
   */
  function bridgePost(payload) {
    return new Promise((resolve, reject) => {
      if (!hasAPI()) { const err = new Error('URL Apps Script belum dipasang.'); err.transport = false; reject(err); return; }
      const rid = String(payload.request_id || uid('REQ'));
      let proof;
      try { proof = makeBridgeProof(); } catch (error) { error.transport = false; reject(error); return; }
      const targetUrl = endpointWith({ bridge: '1', rid: rid, proof: proof });

      let complete = false;
      let pollTimer = null;
      let pollInFlight = false;
      let pollDelay = 350;

      const finish = (data) => {
        if (complete) return;
        complete = true;
        clearTimeout(timer);
        clearTimeout(pollTimer);
        if (data && data.ok === false) {
          const err = new Error(data.error || 'Permintaan ditolak.');
          err.transport = false;
          reject(err);
        } else resolve(data || { ok: true });
      };

      const timer = setTimeout(() => {
        if (complete) return;
        complete = true;
        clearTimeout(pollTimer);
        const err = new Error('Server tidak merespons dalam 40 detik. Periksa koneksi internet dan coba lagi.');
        err.transport = true;
        reject(err);
      }, 40000);

      async function pollStatus() {
        if (complete || pollInFlight) return;
        pollInFlight = true;
        try {
          const status = await apiGet('bridgeStatus', { rid: rid, proof: proof }, { timeout: 7000 });
          if (status && status.ready && Object.prototype.hasOwnProperty.call(status, 'result')) {
            finish(status.result);
            return;
          }
        } catch (_) { /* next poll will retry */ }
        finally { pollInFlight = false; }
        if (!complete) {
          pollTimer = setTimeout(pollStatus, pollDelay);
          pollDelay = Math.min(Math.round(pollDelay * 1.4), 3000);
        }
      }

      // Send POST via fetch with credentials:'omit' — Google cookies stripped → no account chooser redirect
      fetch(targetUrl, {
        method: 'POST',
        mode: 'no-cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(payload)
      }).then(() => {
        if (!complete) pollTimer = setTimeout(pollStatus, 250);
      }).catch(() => {
        if (!complete) pollTimer = setTimeout(pollStatus, 400);
      });

      // Start polling immediately as well (the POST may already be processed)
      pollTimer = setTimeout(pollStatus, 500);
    });
  }
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
    const id = 'field-' + name;
    const attrs = ' id="' + esc(id) + '"' + (options.hint ? ' aria-describedby="' + esc(id) + '-hint"' : '');
    const hint = options.hint ? '<span class="hint" id="' + esc(id) + '-hint">' + esc(options.hint) + '</span>' : '';
    let control = '';
    if (type === 'select') {
      control = '<select name="' + esc(name) + '"' + attrs + required + '>' + (options.blank ? '<option value="">' + esc(options.blank) + '</option>' : '') + (options.options || []).map((option) => { const value = typeof option === 'string' ? option : option.value; const title = typeof option === 'string' ? option : option.label; return '<option value="' + esc(value) + '"' + (options.value === value ? ' selected' : '') + '>' + esc(title) + '</option>'; }).join('') + '</select>';
    } else if (type === 'textarea') {
      control = '<textarea name="' + esc(name) + '"' + attrs + ' placeholder="' + esc(options.placeholder || '') + '"' + required + '>' + esc(options.value || '') + '</textarea>';
    } else if (type === 'checkbox') {
      return '<label class="checkrow field-full"><input type="checkbox" name="' + esc(name) + '" value="yes"' + (options.checked ? ' checked' : '') + '><span><strong>' + esc(label) + '</strong>' + hint + '</span></label>';
    } else {
      control = '<input name="' + esc(name) + '"' + attrs + ' type="' + esc(type || 'text') + '"' + (options.autocomplete ? ' autocomplete="' + esc(options.autocomplete) + '"' : '') + (options.minLength ? ' minlength="' + esc(options.minLength) + '"' : '') + (options.placeholder ? ' placeholder="' + esc(options.placeholder) + '"' : '') + (options.min !== undefined ? ' min="' + esc(options.min) + '"' : '') + (options.max !== undefined ? ' max="' + esc(options.max) + '"' : '') + (options.step !== undefined ? ' step="' + esc(options.step) + '"' : '') + (options.value !== undefined ? ' value="' + esc(options.value) + '"' : '') + required + '>';
    }
    return '<div class="' + cls + '"><label for="' + esc(id) + '">' + esc(label) + (options.required ? ' <span aria-hidden="true">*</span>' : '') + '</label>' + control + hint + '</div>';
  }
  
  function multiSelectDropdownHtml(id, name, label, options, config = {}) {
    const required = config.required ? ' <span aria-hidden="true">*</span>' : '';
    const hint = config.hint ? '<p class="form-note">' + esc(config.hint) + '</p>' : '';
    const placeholder = esc(config.placeholder || 'Pilih opsi...');
    const hasSearch = config.searchable !== false;

    let itemsHtml = '';
    if (config.groups) {
      itemsHtml = config.groups.map((g) => {
        const groupHead = '<div class="ms-group-header">' + esc(g.group) + '</div>';
        const groupItems = g.items.map((item) => {
          const val = typeof item === 'string' ? item : item.value;
          const lbl = typeof item === 'string' ? item : item.label;
          return '<label class="ms-item-row" data-search="' + esc(lbl.toLowerCase()) + '">' +
            '<input type="checkbox" name="' + esc(name) + '" value="' + esc(val) + '" data-label="' + esc(lbl) + '" data-ms-target="' + esc(id) + '">' +
            '<span>' + esc(lbl) + '</span>' +
          '</label>';
        }).join('');
        return groupHead + groupItems;
      }).join('');
    } else {
      itemsHtml = (options || []).map((item) => {
        const val = typeof item === 'string' ? item : item.value;
        const lbl = typeof item === 'string' ? item : item.label;
        return '<label class="ms-item-row" data-search="' + esc(lbl.toLowerCase()) + '">' +
          '<input type="checkbox" name="' + esc(name) + '" value="' + esc(val) + '" data-label="' + esc(lbl) + '" data-ms-target="' + esc(id) + '">' +
          '<span>' + esc(lbl) + '</span>' +
        '</label>';
      }).join('');
    }

    return '<div class="field ' + (config.full ? 'field-full' : '') + ' ms-dropdown-container" id="container-' + esc(id) + '" data-ms-id="' + esc(id) + '">' +
      '<label id="title-' + esc(id) + '" for="trigger-' + esc(id) + '">' + esc(label) + required + '</label>' +
      hint +
      '<button type="button" class="ms-trigger" id="trigger-' + esc(id) + '" data-act="toggle-ms" data-target="' + esc(id) + '" aria-expanded="false" aria-controls="menu-' + esc(id) + '" aria-labelledby="title-' + esc(id) + ' label-' + esc(id) + '">' +
        '<span class="ms-trigger-text is-empty" id="label-' + esc(id) + '">' + placeholder + '</span>' +
        '<span class="ms-trigger-badge" id="badge-' + esc(id) + '" style="display:none;">0</span>' +
        '<span class="ms-arrow" aria-hidden="true"></span>' +
      '</button>' +
      '<div class="ms-menu" id="menu-' + esc(id) + '" style="display:none;">' +
        (hasSearch ? '<input type="search" class="ms-search-input" id="search-' + esc(id) + '" placeholder="Cari opsi" aria-label="Cari opsi" data-ms-search="' + esc(id) + '">' : '') +
        '<div class="ms-actions-bar">' +
          '<button type="button" class="ms-btn-link" data-act="ms-clear" data-target="' + esc(id) + '">Kosongkan</button>' +
          '<button type="button" class="ms-btn-link" data-act="ms-select-all" data-target="' + esc(id) + '">Pilih Semua</button>' +
        '</div>' +
        '<div class="ms-list" id="list-' + esc(id) + '">' +
          itemsHtml +
        '</div>' +
        '<div class="ms-footer">' +
          '<button type="button" class="btn btn-small btn-primary btn-block" data-act="close-ms" data-target="' + esc(id) + '">Selesai</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function photoField(key, label, hint, required = false) {
    return '<div class="field ' + (required ? 'field-full' : '') + '"><label for="photo-' + esc(key) + '">' + esc(label) + (required ? ' <span aria-hidden="true">*</span>' : '') + '</label><input class="photo-input" id="photo-' + esc(key) + '" aria-describedby="photo-hint-' + esc(key) + '" type="file" name="photo_' + esc(key) + '" data-photo="' + esc(key) + '" accept="image/*" capture="environment"' + (required ? ' required' : '') + '><div class="form-note" id="photo-hint-' + esc(key) + '">' + esc(hint || 'Foto dikompres otomatis sebelum disimpan.') + '</div><div data-preview-for="' + esc(key) + '"></div></div>';
  }
  function signatureField() {
    return '<div class="field field-full signature-field"><span class="field-label">Tanda tangan pemilik / PIC outlet</span><p class="form-note">Digambar langsung pada layar. Wajib jika outlet dinyatakan qualified. Bila pemilik tidak tersedia, pilih Tidak qualified dan jelaskan alasannya.</p><canvas id="owner-signature" class="signature-canvas" width=720 height=300 aria-label="Area tanda tangan pemilik outlet"></canvas><div class="signature-toolbar"><span id="signature-status" class="photo-meta">' + (state.signatureDrawn ? 'Tanda tangan siap.' : 'Belum ditandatangani.') + '</span><button type="button" class="btn btn-small btn-plain" data-act="clear-signature">Hapus tanda tangan</button></div></div>';
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
  function section(number, title, content, note) {
    return '<section class="form-section"><h2><span class="section-number">' + esc(number) + '</span>' + esc(title) + '</h2>' +
      (note ? '<p class="form-note">' + esc(note) + '</p>' : '') + '<div class="field-grid">' + content + '</div></section>';
  }
  function pageHead(title, subtitle, right = '') {
    return '<header class="page-head"><div><h1 tabindex="-1">' + esc(title) + '</h1>' +
      (subtitle ? '<p>' + esc(subtitle) + '</p>' : '') + '</div>' + right + '</header>';
  }
  function metricCard(label, value, target, note) {
    const amount = Number(value || 0);
    return '<div class="stat-card"><div class="stat-label">' + esc(label) + '</div><div class="stat-value">' + fmtNum(amount) + '</div>' +
      '<div class="stat-foot">' + esc(target ? 'Target ' + fmtNum(target) : note || 'Total tercatat') + '</div>' +
      (target ? '<div class="progress" role="progressbar" aria-label="' + esc(label) + '" aria-valuenow="' + pct(amount, target) +
        '" aria-valuetext="' + fmtNum(amount) + ' dari ' + fmtNum(target) + '"><span style="width:' + pct(amount, target) + '%"></span></div>' : '') + '</div>';
  }
  function filterButton(action, key, label, active, attribute = 'filter') {
    return '<button type="button" class="filter-chip' + (active ? ' active' : '') + '" data-act="' + esc(action) +
      '" data-' + attribute + '="' + esc(key) + '" aria-pressed="' + active + '">' + esc(label) + '</button>';
  }
  function tableMarkup(headers, rows, label) {
    return '<div class="table-wrap"><table aria-label="' + esc(label) + '" role="table"><thead role="rowgroup"><tr role="row">' +
      headers.map((header) => '<th scope="col" role="columnheader">' + esc(header) + '</th>').join('') +
      '</tr></thead><tbody role="rowgroup">' + rows.map((cells) => '<tr role="row">' + cells.map((cell, i) =>
        '<td role="cell"><span class="cell-label" aria-hidden="true">' + esc(headers[i]) + '</span><div class="cell-value">' + cell + '</div></td>'
      ).join('') + '</tr>').join('') + '</tbody></table></div>';
  }
  function syncBanner() {
    return '<div id="sync-banner" class="sync-banner ' + (state.queueCount ? '' : 'hidden') + '"><div><strong id="sync-count">' + state.queueCount + ' kiriman menunggu sinkronisasi</strong><span class="muted">Data tetap tersimpan di perangkat hingga terkirim.</span></div><button class="btn btn-small btn-primary" data-act="sync" ' + (state.online ? '' : 'disabled') + '>' + (state.syncing ? 'Menyinkronkan…' : 'Sinkronkan') + '</button></div>';
  }
  function navIcon(page) {
    const icons = {
      home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7"/><path d="M5 9.5V21h14V9.5M9 21v-7h6v7"/></svg>',
      outlets: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h18l-1.4-6H4.4L3 10Z"/><path d="M5 10v10h14V10M9 20v-6h6v6"/><path d="M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/></svg>',
      input: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h-3a2 2 0 0 0-2 2v14h18V6a2 2 0 0 0-2-2h-3"/><rect x="8" y="2" width="8" height="5" rx="1.5"/><path d="M8 12h8M8 16h5"/></svg>',
      reports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
      beatplan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>',
      users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      createOutlet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
      more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>'
    };
    return icons[page] || icons.more;
  }
  function navButton(page, label) {
    const active = state.page === page || (page === 'home' && ['input', 'nooForm'].includes(state.page)) || (page === 'more' && ['more','users','beatplan','createOutlet'].includes(state.page));
    return '<button class="nav-btn ' + (active ? 'active' : '') + '" data-act="nav" data-page="' + page + '" aria-current="' + (active ? 'page' : 'false') + '"><span class="nav-icon" aria-hidden="true">' + navIcon(page) + '</span><span class="nav-label">' + esc(label) + '</span></button>';
  }
  function sidebarLink(page, label, iconKey, matchPages) {
    const active = (matchPages || [page]).includes(state.page);
    return '<button class="sidebar-link ' + (active ? 'active' : '') + '" data-act="nav" data-page="' + page + '" title="' + esc(label) + '" aria-label="' + esc(label) + '" aria-current="' + (active ? 'page' : 'false') + '">' +
      '<span class="nav-icon" aria-hidden="true">' + navIcon(iconKey || page) + '</span>' +
      '<span class="sidebar-link-text">' + esc(label) + '</span>' +
    '</button>';
  }
  function loginPage() {
    return '<main class="login-wrap"><div class="login-card"><div class="brand-line">' +
      '<img src="icons/trw-logo.png" alt="TRW" class="brand-logo-img"><div><strong>TRW Field</strong><span>Direct-to-Retailer</span></div></div>' +
      '<h1>Masuk ke TRW Field</h1><p class="subhead">Gunakan akun yang diberikan administrator.</p>' +
      '<form data-form="login" autocomplete="on">' +
      field('username', 'Username', 'text', { required: true, autocomplete: 'username' }) +
      field('password', 'Password', 'password', { required: true, autocomplete: 'current-password' }) +
      '<button class="btn btn-primary btn-block" type="submit">Masuk</button></form>' +
      '<p class="login-note">Kehadiran dicatat secara terpisah melalui Check In.</p></div></main>';
  }
  function shell(content) {
    const user = state.user || {};
    const role = user.role || '';
    const navigation = navButton('home','Beranda') + navButton('outlets','Outlet') + navButton('reports','Laporan') + navButton('more','Menu');
    const shellClasses = 'app-shell' + (state.sidebarCollapsed ? ' sidebar-collapsed' : '');
    const initial = esc((user.full_name || user.username || 'U').trim().charAt(0).toUpperCase());

    let sidebarNav =
      sidebarLink('home', 'Beranda', 'home', ['home', 'nooForm', 'input']) +
      sidebarLink('outlets', 'Outlet & Prospect', 'outlets') +
      sidebarLink('reports', 'Laporan & Evidence', 'reports');

    if (['ADMIN', 'PM', 'TL'].includes(role)) {
      sidebarNav += '<div class="sidebar-section-label">Operasional</div>' +
        sidebarLink('beatplan', 'Rencana Kunjungan', 'beatplan') +
        sidebarLink('createOutlet', 'Tambah Outlet', 'createOutlet');
    }
    if (role === 'ADMIN') {
      sidebarNav += sidebarLink('users', 'Manajemen User', 'users');
    }
    sidebarNav += sidebarLink('more', 'Pengaturan & Alat', 'more');

    const collapseIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>';
    const hamburgerIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
    const logoutIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';

    const sidebarHtml = '<aside id="navigation-panel" class="app-sidebar" aria-label="Menu navigasi">' +
      '<div class="sidebar-header">' +
        '<div class="sidebar-brand"><img src="icons/trw-logo.png" alt="TRW Logo" class="brand-logo-mini"><div class="sidebar-brand-text"><strong>TRW Field</strong><small>Direct-to-Retailer</small></div></div>' +
        '<button type="button" class="sidebar-toggle-btn icon-btn" data-act="toggle-sidebar" aria-label="Ciutkan navigasi" aria-expanded="true" aria-controls="sidebar-nav">' + collapseIcon + '</button>' +
        '<button type="button" class="drawer-close btn btn-plain" data-act="close-drawer">Tutup</button>' +
      '</div>' +
      '<nav id="sidebar-nav" class="sidebar-nav" aria-label="Navigasi utama">' + sidebarNav + '</nav>' +
      '<div class="sidebar-footer">' +
        '<div class="sidebar-user"><div class="avatar">' + initial + '</div><div class="sidebar-user-meta"><strong>' + esc(user.full_name || user.username || 'User') + '</strong><small>' + esc(roleName(role)) + '</small></div></div>' +
        '<button type="button" class="sidebar-link" data-act="logout" title="Keluar dari aplikasi" aria-label="Keluar dari aplikasi"><span class="nav-icon" aria-hidden="true">' + logoutIcon + '</span><span class="sidebar-logout-label">Keluar</span></button>' +
      '</div>' +
    '</aside>';

    const topbarHtml = '<header class="topbar">' +
      '<div class="topbar-inner">' +
        '<div class="topbar-left">' +
          '<button type="button" class="hamburger-btn icon-btn" data-act="toggle-drawer" aria-label="Buka menu navigasi" aria-expanded="false" aria-controls="navigation-panel">' + hamburgerIcon + '</button>' +
          '<div class="brand-mini"><img src="icons/trw-logo.png" alt="TRW" class="brand-logo-mini"><strong>TRW Field</strong></div>' +
          '<span class="desktop-context">' + esc(roleName(role)) + '</span>' +
        '</div>' +
        '<div class="top-actions">' +
          '<span id="network-badge" role="status" class="status-pill ' + (navigator.onLine ? 'online' : 'offline') + '">' + (navigator.onLine ? 'Online' : 'Offline') + '</span>' +
          '<span id="queue-badge" class="pill-count ' + (state.queueCount ? '' : 'hidden') + '" aria-hidden="true">' + state.queueCount + '</span>' +
          '<button type="button" class="btn btn-small btn-plain" data-act="refresh" aria-label="Muat ulang data">Muat ulang</button>' +
        '</div>' +
      '</div>' +
    '</header>';

    return '<div class="' + shellClasses + '">' +
      '<div class="sidebar-backdrop" aria-hidden="true" data-act="close-drawer"></div>' +
      sidebarHtml +
      '<div class="app-workspace">' +
        topbarHtml +
        content +
      '</div>' +
      '<nav class="bottom-nav" aria-label="Navigasi utama">' + navigation + '</nav>' +
    '</div>';
  }
  function updateNavigation() {
    const shell = $('.app-shell');
    if (!shell) return;
    const drawerOpen = state.drawerOpen && tabletNavigation.matches;
    shell.classList.toggle('drawer-open', drawerOpen);
    shell.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
    $('.app-workspace', shell).inert = drawerOpen;
    $('.hamburger-btn', shell).setAttribute('aria-expanded', String(drawerOpen));
    const sidebarToggle = $('.sidebar-toggle-btn', shell);
    const sidebarLabel = state.sidebarCollapsed ? 'Perluas navigasi' : 'Ciutkan navigasi';
    sidebarToggle.title = sidebarLabel;
    sidebarToggle.setAttribute('aria-label', sidebarLabel);
    sidebarToggle.setAttribute('aria-expanded', String(!state.sidebarCollapsed));
  }

  function setDrawer(open) {
    state.drawerOpen = open;
    updateNavigation();
    $(open ? '.drawer-close' : '.hamburger-btn')?.focus();
  }

  tabletNavigation.addEventListener('change', () => {
    state.drawerOpen = false;
    updateNavigation();
  });

  function render() {
    updateQueueState();
    if (!state.token || !state.user) {
      renderedView = 'login';
      APP.innerHTML = loginPage();
      return;
    }
    const view = state.page + (state.page === 'input' ? ':' + state.inputType : '');
    const changed = view !== renderedView && renderedView !== '';
    const focusedControl = document.activeElement;
    const headingFocused = focusedControl === $('.wrap h1');
    if (changed) state.drawerOpen = false;
    renderedView = view;

    let page = '';
    switch (state.page) {
      case 'outlets': page = outletsPage(); break;
      case 'input': page = inputPage(); break;
      case 'reports': page = reportsPage(); break;
      case 'users': page = usersPage(); break;
      case 'beatplan': page = beatPlanPage(); break;
      case 'createOutlet': page = createOutletPage(); break;
      case 'nooForm': page = nooFormPage(); break;
      case 'more': page = morePage(); break;
      default: page = homePage();
    }
    APP.innerHTML = shell('<main class="wrap" id="main-content" data-page="' + esc(view) + '">' + syncBanner() + page + '</main>');
    updateNavigation();
    updateNetworkBadge();
    setupSignatureCanvas();
    setupVisitConditionals();
    setupBeatPlanner();
    initDashboardMap();
    if (changed) window.scrollTo(0, 0);
    if (changed || headingFocused) $('.wrap h1')?.focus({ preventScroll: true });
    else if (focusedControl.matches('.filter-chip')) {
      const { act, filter, tab } = focusedControl.dataset;
      $$('.filter-chip').find((chip) => chip.dataset.act === act && chip.dataset.filter === filter && chip.dataset.tab === tab)?.focus({ preventScroll: true });
    }
    if (state.drawerOpen && tabletNavigation.matches) $('.drawer-close')?.focus();
  }

  function setupVisitConditionals() {
    const f = document.querySelector('form[data-form="visit"]');
    if (!f || f.dataset.condBound === '1') return;
    f.dataset.condBound = '1';

    const updateMsLabels = () => {
      ['ms-stocked-brands', 'ms-sku-range', 'ms-posm-type', 'ms-comp-brands'].forEach((id) => {
        const container = document.getElementById('container-' + id);
        if (!container) return;
        const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]:checked'));
        const label = document.getElementById('label-' + id);
        const badge = document.getElementById('badge-' + id);
        const count = checkboxes.length;
        if (label) {
          if (count === 0) {
            label.textContent = id === 'ms-stocked-brands' ? 'Pilih ready stock merek...' : id === 'ms-sku-range' ? 'Pilih range SKU relevan...' : id === 'ms-posm-type' ? 'Pilih jenis POSM terpasang...' : 'Pilih merek kompetitor...';
            label.classList.add('is-empty');
          } else if (count === 1) {
            label.textContent = checkboxes[0].dataset.label || checkboxes[0].value;
            label.classList.remove('is-empty');
          } else if (count === 2) {
            label.textContent = checkboxes.map((c) => c.dataset.label || c.value).join(', ');
            label.classList.remove('is-empty');
          } else {
            label.textContent = checkboxes.slice(0, 2).map((c) => c.dataset.label || c.value).join(', ') + ' (+' + (count - 2) + ' lainnya)';
            label.classList.remove('is-empty');
          }
        }
        if (badge) {
          badge.textContent = String(count);
          badge.style.display = count > 0 ? 'inline-block' : 'none';
        }
        container.querySelectorAll('.ms-item-row').forEach((row) => {
          const cb = row.querySelector('input[type="checkbox"]');
          if (cb) row.classList.toggle('is-checked', cb.checked);
        });
      });
    };

    const bind = () => {
      updateMsLabels();
      const checkedBrands = Array.from(f.querySelectorAll('input[name="stocked_brand"]:checked')).map((c) => c.value);
      const brandVolMap = [
        { brand: 'TRW', key: 'vol_TRW' },
        { brand: 'Akebono', key: 'vol_Akebono' },
        { brand: 'Bendix', key: 'vol_Bendix' },
        { brand: 'Birkens', key: 'vol_Birkens' },
        { brand: 'MK KASHIYAMA', key: 'vol_MK_KASHIYAMA' },
        { brand: 'SANIKO', key: 'vol_SANIKO' },
        { brand: 'MONRO', key: 'vol_MONRO' }
      ];
      let anyBrandVol = false;
      brandVolMap.forEach((item) => {
        const active = checkedBrands.includes(item.brand);
        if (active) anyBrandVol = true;
        const w = document.getElementById('wrap-' + item.key);
        const inp = f.elements[item.key];
        if (w) w.style.display = active ? 'block' : 'none';
        if (inp) inp.required = active;
      });
      const outerVolWrap = document.getElementById('wrap-brand-monthly-volume');
      if (outerVolWrap) outerVolWrap.style.display = anyBrandVol ? 'block' : 'none';

      const pHist = f.elements['purchase_history_signal'];
      const bCat = document.getElementById('wrap-brake-cat');
      if (pHist && bCat) bCat.style.display = (pHist.value === 'Ya') ? 'block' : 'none';

      const checkedPosm = Array.from(f.querySelectorAll('input[name="posm_type"]:checked')).map((c) => c.value);
      const isNoPosm = checkedPosm.length === 0 || checkedPosm.includes('Tidak ada');
      const posmAllowWrap = document.getElementById('wrap-posm-allowed');
      const posmLoc = document.getElementById('wrap-posm-location');
      const posmBef = document.getElementById('wrap-posm-before');
      if (posmAllowWrap) posmAllowWrap.style.display = isNoPosm ? 'block' : 'none';
      if (posmLoc) posmLoc.style.display = (!isNoPosm || (f.elements['posm_allowed'] && f.elements['posm_allowed'].value === 'Ya')) ? 'block' : 'none';
      if (posmBef) posmBef.style.display = !isNoPosm ? 'block' : 'none';

      const eduDone = f.elements['education_done'];
      const eduWrap = document.getElementById('wrap-edu-details');
      if (eduDone && eduWrap) eduWrap.style.display = (eduDone.value === 'Ya') ? 'block' : 'none';

      const intent = f.elements['purchase_intent'];
      const barrierWrap = document.getElementById('wrap-barrier-switching');
      if (intent && barrierWrap) barrierWrap.style.display = (intent.value === '1' || intent.value === '2') ? 'block' : 'none';
    };

    f.addEventListener('change', (e) => {
      if (e.target && e.target.name === 'posm_type') {
        if (e.target.value === 'Tidak ada' && e.target.checked) {
          f.querySelectorAll('input[name="posm_type"]').forEach((c) => { if (c.value !== 'Tidak ada') c.checked = false; });
        } else if (e.target.value !== 'Tidak ada' && e.target.checked) {
          f.querySelectorAll('input[name="posm_type"]').forEach((c) => { if (c.value === 'Tidak ada') c.checked = false; });
        }
      }
      if (e.target && e.target.name === 'stocked_brand') {
        if (e.target.value === 'Belum diketahui' && e.target.checked) {
          f.querySelectorAll('input[name="stocked_brand"]').forEach((c) => { if (c.value !== 'Belum diketahui') c.checked = false; });
        } else if (e.target.value !== 'Belum diketahui' && e.target.checked) {
          f.querySelectorAll('input[name="stocked_brand"]').forEach((c) => { if (c.value === 'Belum diketahui') c.checked = false; });
        }
      }
      if (e.target && e.target.name === 'sku_range_item') {
        if (e.target.value === 'Tidak Pernah Menjual' && e.target.checked) {
          f.querySelectorAll('input[name="sku_range_item"]').forEach((c) => { if (c.value !== 'Tidak Pernah Menjual') c.checked = false; });
        } else if (e.target.value !== 'Tidak Pernah Menjual' && e.target.checked) {
          f.querySelectorAll('input[name="sku_range_item"]').forEach((c) => { if (c.value === 'Tidak Pernah Menjual') c.checked = false; });
        }
      }
      bind();
    });

    bind();
  }

  function setupBeatPlanner() {
    const root = document.querySelector('form[data-form="beatPlan"]');
    if (!root || root.dataset.beatBound === '1') return;
    root.dataset.beatBound = '1';
    const search = document.getElementById('beat-outlet-search');
    const citySel = document.getElementById('beat-city-filter');
    const badge = document.getElementById('beat-counter-tag');
    const rows = Array.from(root.querySelectorAll('.beat-outlet-row'));

    const updateCount = () => {
      const checked = root.querySelectorAll('input[name="beat_outlet_ids"]:checked');
      if (badge) {
        badge.textContent = checked.length + ' / 20 Outlet Terpilih';
        badge.className = 'tag ' + (checked.length > 20 ? 'red' : checked.length > 0 ? 'green' : 'yellow') + ' beat-counter-tag';
      }
    };

    const filterRows = () => {
      const q = search ? search.value.trim().toLowerCase() : '';
      const city = citySel ? citySel.value : '';
      rows.forEach((r) => {
        const matchesSearch = !q || r.dataset.search.includes(q);
        const matchesCity = !city || r.dataset.city.includes(city);
        r.style.display = (matchesSearch && matchesCity) ? 'flex' : 'none';
      });
    };

    if (search) search.addEventListener('input', filterRows);
    if (citySel) citySel.addEventListener('change', filterRows);

    root.addEventListener('change', (e) => {
      if (e.target && e.target.name === 'beat_outlet_ids') {
        const parentRow = e.target.closest('.beat-outlet-row');
        if (parentRow) parentRow.classList.toggle('is-selected', e.target.checked);
        const checked = root.querySelectorAll('input[name="beat_outlet_ids"]:checked');
        if (checked.length > 20) {
          e.target.checked = false;
          if (parentRow) parentRow.classList.remove('is-selected');
          toast('Maksimal penugasan sekaligus adalah 20 outlet.', 'bad');
        }
        updateCount();
      }
    });

    updateCount();
  }

  let currentLeafletMap = null;
  let currentMapFilter = 'all';

  function mapCardHtml(mapId = 'dashboard-map') {
    const outlets = state.outletList || [];
    const total = outlets.length;
    const qualCount = outlets.filter((o) => o.is_qualified || String(o.status).toUpperCase() === 'QUALIFIED').length;
    const srvVisits = (state.reports && state.reports.visits) || [];
    const srvCount = srvVisits.length;
    const prospectCount = outlets.filter((o) => o.is_prospect || !o.segment_final || String(o.status).toUpperCase().includes('UNVERIFIED') || String(o.status).toUpperCase().includes('BELUM')).length;
    const fmList = (state.dashboard && state.dashboard.fmLocations) || state.fmLocations || [];
    const fmCount = fmList.length;

    const filters = [
      ['all', 'Semua', total + fmCount], ['fm', 'Petugas FM', fmCount],
      ['qualified', 'Qualified', qualCount], ['surveyed', 'Survey selesai', srvCount], ['prospect', 'Prospect', prospectCount]
    ];
    return '<section class="card dashboard-map-card">' +
      '<div class="card-head"><div><h2>Peta outlet dan petugas FM</h2><p>Lokasi outlet, status survey, dan posisi terakhir petugas.</p></div>' +
      '<span class="status-pill ' + (fmCount ? 'online">Pelacakan aktif' : '">Belum ada posisi FM') + '</span></div>' +
      '<div class="filter-row" role="group" aria-label="Filter peta">' +
        filters.map(([id, label, count]) => filterButton('map-filter', id, label + ' (' + fmtNum(count) + ')', currentMapFilter === id)).join('') +
      '</div><div id="' + mapId + '" class="dashboard-map-container" role="region" aria-label="Peta outlet dan petugas FM"></div></section>';
  }

  function initDashboardMap(mapId) {
    const targetId = mapId || (state.user && state.user.role === 'CLIENT' ? 'dashboard-map-client' : 'dashboard-map');
    const container = document.getElementById(targetId);
    if (currentLeafletMap) {
      try { currentLeafletMap.remove(); } catch (_) {}
      currentLeafletMap = null;
    }
    if (!container || typeof L === 'undefined') return;

    const defaultCenter = [-6.2088, 106.8456];
    const map = L.map(container, { scrollWheelZoom: false }).setView(defaultCenter, 11);
    currentLeafletMap = map;

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    }).addTo(map);

    const outlets = state.outletList || [];
    const visits = (state.reports && state.reports.visits) || [];
    const visitMap = new Map();
    visits.forEach((v) => { if (v.outlet_id && !visitMap.has(String(v.outlet_id))) visitMap.set(String(v.outlet_id), v); });

    const cityCoords = {
      'jakarta pusat': [-6.1818, 106.8378],
      'jakarta barat': [-6.1674, 106.7637],
      'jakarta selatan': [-6.2615, 106.8106],
      'jakarta timur': [-6.2250, 106.9004],
      'jakarta utara': [-6.1384, 106.8640],
      'jakarta': [-6.2088, 106.8456],
      'tangerang selatan': [-6.2887, 106.7179],
      'tangerang': [-6.1783, 106.6319],
      'bekasi': [-6.2383, 106.9756],
      'depok': [-6.4025, 106.7942],
      'bogor': [-6.5971, 106.8060]
    };

    const bounds = [];

    if (currentMapFilter !== 'fm') { outlets.forEach((o, index) => {
      const isQual = o.is_qualified || String(o.status).toUpperCase() === 'QUALIFIED';
      const isProspect = o.is_prospect || !o.segment_final || String(o.status).toUpperCase().includes('UNVERIFIED') || String(o.status).toUpperCase().includes('BELUM');
      const hasVisit = visitMap.has(String(o.outlet_id));
      const visit = visitMap.get(String(o.outlet_id));

      if (currentMapFilter === 'qualified' && !isQual) return;
      if (currentMapFilter === 'surveyed' && !hasVisit) return;
      if (currentMapFilter === 'prospect' && !isProspect) return;

      let lat = Number(o.lat || (visit && visit.lat) || 0);
      let lng = Number(o.lng || (visit && visit.lng) || 0);

      if (!lat || !lng || isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) {
        const cityKey = String(o.city || '').toLowerCase();
        let foundCity = null;
        for (const k in cityCoords) {
          if (cityKey.includes(k)) { foundCity = cityCoords[k]; break; }
        }
        if (!foundCity) foundCity = defaultCenter;
        const jitterLat = (Math.sin((index + 1) * 17) * 0.04);
        const jitterLng = (Math.cos((index + 1) * 23) * 0.05);
        lat = foundCity[0] + jitterLat;
        lng = foundCity[1] + jitterLng;
      }

      let colorClass = 'pin-gray';
      let pinSymbol = 'O';
      let tagClass = 'gray';
      let statusLabel = o.status || 'PROSPECT';

      if (isQual) {
        colorClass = 'pin-green';
        pinSymbol = 'Q';
        tagClass = 'green';
        statusLabel = 'QUALIFIED';
      } else if (hasVisit) {
        colorClass = 'pin-yellow';
        pinSymbol = 'S';
        tagClass = 'yellow';
        statusLabel = 'SURVEY SELESAI';
      } else if (isProspect) {
        colorClass = 'pin-blue';
        pinSymbol = 'P';
        tagClass = 'blue';
        statusLabel = 'PROSPECT';
      }

      const icon = L.divIcon({
        className: 'map-custom-marker',
        html: '<div class="map-pin ' + colorClass + '"><div class="map-pin-inner">' + pinSymbol + '</div></div>',
        iconSize: [30, 30],
        iconAnchor: [15, 30],
        popupAnchor: [0, -28]
      });

      const segment = o.segment_final || o.segment_indicative || 'Belum diklasifikasi';
      const address = [o.address, o.area, o.city].filter(Boolean).join(', ') || 'Alamat dalam proses verifikasi';
      const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lat + ',' + lng);

      const popupHtml = '<div class="map-popup-content">' +
        '<div class="map-popup-tags"><span class="map-popup-tag ' + tagClass + '">' + esc(statusLabel) + '</span><span class="map-popup-tag gray">' + esc(segment) + '</span></div>' +
        '<div class="map-popup-title">' + esc(o.outlet_name || 'Outlet') + '</div>' +
        '<div class="map-popup-meta">' + esc(o.city || '') + (o.area ? ' · ' + esc(o.area) : '') + '</div>' +
        '<p class="map-popup-meta">' + esc(address) + '</p>' +
        (visit ? '<div class="map-popup-meta">Surveyor: ' + esc(visit.user_name || userName(visit.user_id) || 'FM') + ' (' + fmtDate(visit.visit_date || visit.created_at) + ')</div>' : '') +
        '<a href="' + mapsUrl + '" target="_blank" rel="noopener" class="map-popup-link">Buka di Google Maps</a>' +
      '</div>';

      L.marker([lat, lng], { icon: icon, title: o.outlet_name || 'Outlet', alt: statusLabel }).bindPopup(popupHtml).addTo(map);
      bounds.push([lat, lng]);
    }); }

    // Render FM Live Markers when filter is 'all' or 'fm'
    if (currentMapFilter === 'all' || currentMapFilter === 'fm') {
      const fmLocations = (state.dashboard && state.dashboard.fmLocations) || state.fmLocations || [];
      fmLocations.forEach((fm) => {
        const lat = Number(fm.lat || 0);
        const lng = Number(fm.lng || 0);
        if (!lat || !lng || isNaN(lat) || isNaN(lng)) return;

        const isCheckedIn = fm.status === 'CHECKED_IN';
        const initial = (fm.full_name || fm.username || 'FM').trim().charAt(0).toUpperCase();

        const fmIcon = L.divIcon({
          className: 'map-custom-marker',
          html: '<div class="fm-marker-avatar">' + esc(initial) + '</div>',
          iconSize: [34, 34],
          iconAnchor: [17, 34],
          popupAnchor: [0, -32]
        });

        const statusTag = isCheckedIn ? '<span class="map-popup-tag green">SEDANG KUNJUNGAN</span>' : '<span class="map-popup-tag live">ONLINE / DI JALAN</span>';
        const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lat + ',' + lng);

        const fmPopupHtml = '<div class="map-popup-content">' +
          '<div class="map-popup-tags"><span class="map-popup-tag live">Petugas FM</span>' + statusTag + '</div>' +
          '<div class="map-popup-title">' + esc(fm.full_name || fm.username) + '</div>' +
          '<div class="map-popup-meta">Role: ' + esc(roleName(fm.role || 'FM')) + '</div>' +
          (fm.active_outlet_name ? '<p class="map-popup-meta">Sedang di outlet: ' + esc(fm.active_outlet_name) + '</p>' : '') +
          '<div class="map-popup-meta">Pembaruan: ' + esc(fmtDateTime(fm.updated_at)) + (fm.accuracy ? ' (Akurasi: ±' + Math.round(fm.accuracy) + 'm)' : '') + '</div>' +
          '<a href="' + mapsUrl + '" target="_blank" rel="noopener" class="map-popup-link">Buka Lokasi di Google Maps</a>' +
        '</div>';

        L.marker([lat, lng], { icon: fmIcon, zIndexOffset: 1000, title: fm.full_name || fm.username || 'Petugas FM', alt: 'Petugas FM' }).bindPopup(fmPopupHtml).addTo(map);
        bounds.push([lat, lng]);
      });
    }

    if (bounds.length) {
      try { map.fitBounds(bounds, { padding: [35, 35], maxZoom: 14 }); } catch (_) {}
    }

    setTimeout(() => {
      try { map.invalidateSize(); } catch (_) {}
    }, 250);
  }

  function homePage() {
    if (state.user && state.user.role === 'CLIENT') return clientHomePage();
    if (state.user && state.user.role === 'FM') return fmHomePage();
    const m = (state.dashboard && state.dashboard.metrics) || {};
    const targets = (state.dashboard && state.dashboard.targets) || { prospects:250, uniqueOutlets:180, fmVisits:360, spgDays:72, interactions:1080 };
    const open = state.openAttendance;
    const attendance = '<section class="card attendance-card"><div class="card-head"><h2>Kehadiran</h2>' +
      '<span class="tag ' + (open ? 'green">Check In aktif' : 'gray">Belum Check In') + '</span></div>' +
      (open ? '<p class="attendance-time"><strong>' + esc(fmtDateTime(open.checkin_at || open.at)) + '</strong> <span class="muted">Waktu Check In</span></p>' +
        '<p class="small muted">ID ' + esc(open.attendance_id) + '</p><button class="btn btn-primary btn-block" data-act="checkout">Check Out dengan foto dan GPS</button>' :
        '<p class="small muted">Siapkan foto baru dan pastikan akurasi GPS 150 meter atau lebih baik.</p><button class="btn btn-primary btn-block" data-act="checkin">Check In dengan foto dan GPS</button>') +
      '</section>';
    let actions = '<button class="action-tile" data-act="nav" data-page="outlets"><strong>Lihat outlet</strong><small>Cari outlet dan periksa statusnya.</small></button>';
    if (state.user.role !== 'SPG') actions += '<button class="action-tile" data-act="start-input"><strong>Isi laporan FM</strong><small>Kunjungan, kualifikasi, POSM, edukasi, dan survey.</small></button>';
    actions += '<button class="action-tile" data-act="nav" data-page="reports"><strong>Lihat laporan</strong><small>Rekap periode dan aktivitas terbaru.</small></button>';
    if (state.user.role === 'SPG') actions += '<button class="action-tile" data-act="start-input"><strong>Aktivasi SPG</strong><small>Catat aktivasi di outlet qualified.</small></button><button class="action-tile" data-act="select-form" data-form-type="interaction"><strong>Interaksi konsumen</strong><small>Catat minat beli dan lead.</small></button>';
    const quick = '<section class="card"><h2>Aksi cepat</h2><div class="action-grid">' + actions + '</div></section>';
    const kpis = '<section class="card"><div class="card-head"><div><h2>Progres program</h2><p>Realisasi terhadap target program.</p></div></div><div class="grid grid-3 metric-grid">' +
      metricCard('Prospect', m.prospectCount, targets.prospects) + metricCard('Outlet qualified', m.qualifiedUnique, targets.uniqueOutlets) +
      metricCard('Kunjungan FM', m.fmVisits, targets.fmVisits) + metricCard('Hari aktivasi SPG', m.spgDays, targets.spgDays) +
      metricCard('Interaksi konsumen', m.interactions, targets.interactions) + metricCard('Kendala terbuka', m.openIssues, null, 'Perlu tindak lanjut') + '</div></section>';
    const notes = '<section class="card operating-notes"><h2>Standar program</h2>' +
      '<div class="report-row"><strong>Bukti kunjungan</strong><p>Sertakan foto dan lokasi saat Check In/Out. Lengkapi bukti outlet sebelum kualifikasi.</p></div>' +
      '<div class="report-row"><strong>Aktivasi SPG</strong><p>Aktivasi hanya dapat disimpan untuk outlet qualified yang memiliki bukti.</p></div>' +
      '<div class="report-row"><strong>Batas laporan 20.00 WIB</strong><p>Pastikan laporan tersinkron sebelum batas waktu harian.</p></div></section>';
    return pageHead('Halo, ' + (state.user.full_name || state.user.username).split(' ')[0], fmtDate(new Date().toISOString())) +
      '<div class="home-layout"><div class="home-side">' + attendance + quick + '</div><div class="home-main">' + kpis +
      mapCardHtml('dashboard-map') + '</div><div class="home-standards">' + notes + '</div></div>';
  }

  function fmHomePage() {
    const route = state.fmRoute;
    const items = route && Array.isArray(route.items) ? route.items : [];
    const stats = (route && route.stats) || {};
    const total = Number(stats.visits || items.length || 0);
    const completed = Number(stats.completed || items.filter((item) => item.status === 'COMPLETED').length || 0);
    const interactions = Number(stats.interactions || 0);
    const evidence = Number(stats.evidence || 0);
    const progress = total ? Math.min(100, Math.round(completed / total * 100)) : 0;
    const active = state.openAttendance || (route && route.openAttendance) || null;
    const activeItem = active ? items.find((item) => String(item.outlet_id) === String(active.outlet_id)) : null;
    const dateLabel = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'Asia/Jakarta' }).format(new Date());
    const greeting = (state.user.full_name || state.user.username || 'FM').trim().split(/\s+/)[0];
    const statsHtml = '<div class="fm-stat-grid">' +
      '<div class="fm-stat"><span>Kunjungan</span><strong>' + fmtNum(total) + '</strong></div>' +
      '<div class="fm-stat"><span>Selesai</span><strong>' + fmtNum(completed) + '</strong></div>' +
      '<div class="fm-stat"><span>Interaksi</span><strong>' + fmtNum(interactions) + '</strong></div>' +
      '<div class="fm-stat"><span>Evidence</span><strong>' + fmtNum(evidence) + '</strong></div>' +
    '</div>';
    const progressHtml = '<section class="card fm-progress-card"><div class="fm-progress-heading">' +
      '<div><h2>Progres hari ini</h2><p>' + fmtNum(completed) + ' dari ' + fmtNum(total) + ' kunjungan selesai</p></div><strong>' + progress + '%</strong></div>' +
      '<div class="fm-progress-track" role="progressbar" aria-label="Kunjungan selesai" aria-valuenow="' + progress + '"><span style="width:' + progress + '%"></span></div>' +
      statsHtml + '</section>';

    const nooAction = '<button type="button" class="btn btn-plain" data-act="start-noo">Daftarkan outlet baru (NOO)</button>';

    let routeContent = '';
    if (!route) {
      routeContent = '<div class="card fm-empty"><strong>Memuat rencana kunjungan…</strong><p>Rute hari ini sedang diambil dari sistem.</p></div>';
    } else if (!items.length) {
      routeContent = '<div class="card fm-empty"><strong>Belum ada penugasan rencana kunjungan hari ini</strong><p>TL atau Admin belum menetapkan rute. Gunakan pendaftaran outlet baru (NOO) untuk mencatat kunjungan mandiri.</p></div>';
    } else {
      const hasOtherOpen = Boolean(active);
      routeContent = '<div class="fm-route-list">' + items.map((item, index) => {
        const isActive = active && String(active.outlet_id || '') === String(item.outlet_id);
        const isCompleted = item.status === 'COMPLETED';
        const isPlanned = item.status === 'PLANNED';
        const firstPending = !hasOtherOpen && isPlanned && items.slice(0, index).every((prior) => prior.status !== 'PLANNED');
        const badge = isActive ? '<span class="fm-route-badge ongoing">Sedang dikunjungi</span>' : isCompleted ? '<span class="fm-route-badge completed">Selesai</span>' : firstPending ? '<span class="fm-route-badge next">Kunjungan berikutnya</span>' : '<span class="fm-route-badge planned">Terjadwal</span>';
        let action = '';
        if (isActive) {
          action = '<div class="fm-route-actions"><button class="btn btn-primary" data-act="fm-input" data-outlet="' + esc(item.outlet_id) + '">Buka form kunjungan</button>' +
            '<button class="btn btn-plain" data-act="fm-checkout" data-outlet="' + esc(item.outlet_id) + '">Check Out outlet</button></div>';
        } else if (isPlanned && !hasOtherOpen) {
          action = '<div class="fm-route-actions"><button class="btn btn-primary" data-act="fm-checkin" data-outlet="' + esc(item.outlet_id) + '">Mulai kunjungan</button></div>';
        } else if (isPlanned && hasOtherOpen) {
          action = '<p class="fm-route-notes">Tersedia setelah Check Out dari outlet aktif.</p>';
        } else {
          action = '<div class="fm-completed-note">Check In dan Check Out tercatat' + (item.checkout_at ? ' · ' + esc(fmtDateTime(item.checkout_at)) : '') + '</div>';
        }
        const tags = [item.type, item.segment_final, item.priority].filter(Boolean).map((value) => '<span class="fm-outlet-chip">' + esc(value) + '</span>').join('');
        const address = [item.address, item.area, item.city].filter(Boolean).join(', ');
        return '<article class="fm-route-card ' + (isActive ? 'is-active' : isCompleted ? 'is-completed' : '') + '">' +
          '<div class="fm-route-index ' + (isCompleted ? 'done' : isActive ? 'active' : '') + '">' + String(item.sequence || index + 1).padStart(2, '0') + '</div>' +
          '<div class="fm-route-main"><div class="fm-route-meta">' + badge + (item.visit_count ? '<span class="fm-visit-count">' + fmtNum(item.visit_count) + ' visit tersimpan</span>' : '') + '</div>' +
          '<h3>' + esc(item.outlet_name || 'Outlet') + '</h3>' +
          (address ? '<p class="fm-route-address">' + esc(address) + '</p>' : '<p class="fm-route-address">Alamat belum tersedia</p>') +
          (tags ? '<div class="fm-outlet-chips">' + tags + '</div>' : '') +
          (item.notes ? '<p class="fm-route-notes">' + esc(item.notes) + '</p>' : '') + action +
          (item.maps_link ? '<a class="fm-map-link" href="' + esc(item.maps_link) + '" target="_blank" rel="noopener">Buka peta outlet</a>' : '') +
          '</div></article>';
      }).join('') + '</div>';
    }

    let activeNotice = '';
    if (active && !activeItem) {
      const activeOutlet = state.outletList.find((outlet) => String(outlet.outlet_id) === String(active.outlet_id));
      activeNotice = '<div class="card fm-active-alert"><div><span class="eyebrow">Check In masih aktif</span><strong>' + esc(activeOutlet ? activeOutlet.outlet_name : (active.outlet_id || 'Outlet sebelumnya')) + '</strong><p>Check Out harus diselesaikan pada outlet yang sama sebelum memulai rute berikutnya.</p></div><button class="btn btn-primary" data-act="fm-checkout" data-outlet="' + esc(active.outlet_id || '') + '">Check Out sekarang</button></div>';
    }

    return pageHead('Halo, ' + greeting, dateLabel, nooAction) + '<div class="fm-layout"><div>' + progressHtml + activeNotice + '</div>' +
      '<section class="card fm-route-section"><div class="card-head"><div><h2>Rencana kunjungan</h2><p>' + fmtNum(total) + ' outlet ditugaskan</p></div></div>' +
      routeContent + '</section></div>';
  }

  function clientHomePage() {
    const dashboard = state.dashboard;
    const m = (dashboard && dashboard.metrics) || {};
    const targets = (dashboard && dashboard.targets) || { prospects: 250, uniqueOutlets: 180, fmVisits: 360, spgDays: 72, interactions: 1080 };
    const ready = Boolean(dashboard && dashboard.metrics);
    const updated = dashboard && dashboard.updatedAt ? fmtDateTime(dashboard.updatedAt) : 'Belum tersedia';
    const issueCount = Number(m.openIssues || 0);
    const scorecard = [
      ['Database prospect', m.prospectCount, targets.prospects, 'Basis outlet yang dihimpun'],
      ['Outlet unik dikunjungi', m.uniqueVisited, targets.uniqueOutlets, 'Cakupan outlet yang sudah dikunjungi'],
      ['FM visits', m.fmVisits, targets.fmVisits, 'Total kunjungan lapangan'],
      ['SPG activation days', m.spgDays, targets.spgDays, 'Hari aktivasi SPG'],
      ['End-user interactions', m.interactions, targets.interactions, 'Interaksi konsumen tercatat']
    ];
    const scorecardHtml = ready ? scorecard.map(([label, actual, target, note]) => {
      const value = Number(actual || 0);
      const goal = Number(target || 0);
      const progress = goal > 0 ? Math.round(value / goal * 100) : null;
      const width = progress === null ? 0 : Math.min(100, Math.max(0, progress));
      return '<div class="client-score-row"><div class="client-score-main"><div><strong>' + esc(label) + '</strong><small>' + esc(note) + '</small></div><div class="client-score-numbers"><strong>' + fmtNum(value) + '</strong><span> / ' + fmtNum(goal) + '</span></div></div><div class="client-score-track"><span style="width:' + width + '%"></span></div><div class="client-score-meta"><span>' + (progress === null ? 'Target belum dikonfigurasi' : progress + '% dari target') + '</span><span>' + (progress === null ? '—' : (value >= goal ? 'Target tercapai' : 'Dalam progress')) + '</span></div></div>';
    }).join('') : '<div class="client-data-state"><strong>Ringkasan belum tersedia</strong><p>Data KPI akan tampil setelah dashboard berhasil dimuat.</p></div>';

    const visits = ((state.reports && state.reports.visits) || []).slice(0, 5);
    const activityHtml = visits.length ? visits.map((row) => {
      const when = row.visit_date || row.work_date || row.date || row.created_at || row.checkin_at;
      const outlet = outletName(row.outlet_id) || row.outlet_name || row.outlet_id || 'Outlet';
      const person = row.user_name || userName(row.user_id) || 'Tim lapangan';
      const status = row.status || 'Tercatat';
      return '<div class="client-activity-row"><div class="client-activity-copy"><strong>' + esc(outlet) + '</strong><small>' + esc(person) + ' · ' + esc(fmtDateTime(when)) + '</small></div><span class="client-activity-status">' + esc(status) + '</span></div>';
    }).join('') : '<div class="client-data-state"><strong>Belum ada aktivitas untuk ditampilkan</strong><p>Aktivitas kunjungan terbaru akan muncul di bagian ini setelah tersimpan.</p></div>';

    const issuePanel = ready
      ? '<div class="notice ' + (issueCount ? 'warning' : 'success') + '"><strong>' +
        (issueCount ? fmtNum(issueCount) + ' kendala terbuka' : 'Tidak ada kendala terbuka') + '</strong></div>'
      : '<div class="empty-state compact">Status tindak lanjut belum tersedia.</div>';

    return pageHead('Ringkasan program', 'Capaian, lokasi, dan aktivitas tim lapangan.', '<span class="client-updated-label">Pembaruan data <strong>' + esc(updated) + '</strong></span>') +
      '<div class="client-dashboard-grid">' +
        '<section class="card client-scorecard"><h2>Pencapaian terhadap target</h2>' + scorecardHtml + '</section>' +
        '<aside class="client-side-column"><section class="card client-health-card"><h2>Tindak lanjut</h2>' + issuePanel +
        '<button class="btn btn-plain" data-act="nav" data-page="reports">Buka laporan program</button></section>' +
        '<section class="card client-activity-card"><h2>Aktivitas terbaru</h2>' + activityHtml +
        '<button class="link-btn" data-act="nav" data-page="reports">Lihat seluruh aktivitas</button></section></aside>' +
      '</div>' + mapCardHtml('dashboard-map-client') +
      '<div class="row client-detail-actions"><button class="btn btn-plain" data-act="nav" data-page="outlets">Lihat outlet</button><button class="btn btn-plain" data-act="nav" data-page="reports">Lihat laporan & evidence</button></div>';
  }

  function nooFormPage() {
    if (state.user.role !== 'FM' && !['ADMIN','PM','TL'].includes(state.user.role)) return '<div class="card">Akses tidak diizinkan.</div>';
    if (!state.openAttendance) {
      return pageHead('Check In Diperlukan', 'Lakukan Check In di lokasi outlet sebelum mendaftarkan outlet baru.') +
        '<div class="card"><div class="notice warning">Wajib Check In dengan foto dan GPS sebelum input data outlet baru.</div><button class="btn btn-primary btn-block" data-act="start-noo">Check In Sekarang</button></div>';
    }
    const cities = ['Jakarta Pusat','Jakarta Utara','Jakarta Barat','Jakarta Selatan','Jakarta Timur','Bogor','Depok','Tangerang','Tangerang Selatan','Bekasi','Lainnya'];
    const types = ['Toko sparepart','Distributor','Bengkel','Workshop','Toko sparepart dan bengkel','Lainnya'];
    const segments = ['Grosir','Semi Grosir','Retail','Belum diklasifikasi'];
    const priorities = ['P1','P2','P3'];

    const content = field('noo_outlet_name','Nama Outlet / Toko','text',{required:true,placeholder:'Contoh: Toko Maju Jaya Motor',full:true}) +
      field('noo_city','Kota / Wilayah','select',{required:true,options:cities}) +
      field('noo_area','Kecamatan / Area Cluster','text',{placeholder:'Contoh: Sawah Besar'}) +
      field('noo_address','Alamat Lengkap Toko','textarea',{required:true,full:true,placeholder:'Jalan, nomor, patokan lokasi'}) +
      field('noo_type','Tipe Outlet','select',{required:true,options:types}) +
      field('noo_segment','Klasifikasi SOW Awal','select',{required:true,options:segments}) +
      field('noo_priority','Prioritas Kunjungan','select',{options:priorities,value:'P1'}) +
      field('noo_contact','Nama Pemilik / PIC Toko','text',{required:true,placeholder:'Nama pemilik atau kepala toko'}) +
      field('noo_phone','Nomor Telepon PIC','tel',{required:true,placeholder:'Nomor WhatsApp / HP'});

    return pageHead('Daftarkan Outlet Baru', 'Setelah tersimpan, sistem akan langsung membuka Form Kunjungan & Survey Outlet.') +
      '<form data-form="nooOutlet" class="card">' +
        '<div class="notice success">' +
          '<strong>Check In Aktif:</strong> Lokasi GPS & foto kehadiran Anda sudah tercatat. Silakan lengkapi profil outlet di bawah ini.' +
        '</div>' +
        '<div class="field-grid">' + content + '</div>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn btn-plain" data-act="nav" data-page="home">Batal</button>' +
          '<button type="submit" class="btn btn-primary">Simpan outlet & lanjut survey</button>' +
        '</div>' +
      '</form>';
  }

  function outletsPage() {
    const items = filteredOutlets();
    const controls = '<div class="card outlet-controls"><form class="search-row" role="search"><input id="outlet-search" value="' + esc(state.outletQuery) + '" type="search" placeholder="Cari nama, area, atau alamat" aria-label="Cari outlet"><button class="btn btn-primary" type="submit" data-act="search-outlets">Cari</button></form><div class="filter-row" role="group" aria-label="Filter outlet">' + [['all','Semua'],['qualified','Qualified'],['prospect','Prospect'],['P1','Prioritas P1']].map(([id,label]) => filterButton('outlet-filter', id, label, state.outletFilter === id)).join('') + '</div><div class="form-note">Daftar prospect tetap berstatus belum terverifikasi sampai ada hasil field survey.</div></div>';
    let list = '';
    if (!items.length) list = '<div class="card empty-state"><strong>Outlet tidak ditemukan</strong>Coba kata kunci lain atau refresh data ketika online.</div>';
    else list = '<div class="card"><div class="card-head"><div><h2>Daftar outlet</h2><p class="muted small">' + fmtNum(items.length) + ' hasil ditampilkan</p></div>' + (['ADMIN','PM','TL'].includes(state.user.role) ? '<button class="btn btn-small btn-primary" data-act="nav" data-page="createOutlet">Tambah outlet</button>' : '') + '</div>' + items.map((o) => outletItem(o)).join('') + '</div>';
    return pageHead('Outlet & prospect', 'Daftar outlet sasaran dan status kualifikasi.') + controls + list;
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
    const isFM = state.user.role === 'FM';
    const fmCanSelect = isFM && state.openAttendance && String(state.openAttendance.outlet_id || '') === String(o.outlet_id);
    const actions = state.user.role === 'CLIENT' ? '<span class="tag gray">View only</span>' : isFM ? (fmCanSelect ? '<button class="btn btn-small btn-primary" data-act="choose-outlet" data-id="' + esc(o.outlet_id) + '">Buka input</button>' : '<span class="tag gray">Lihat Rencana Kunjungan</span>') : '<button class="btn btn-small btn-primary" data-act="choose-outlet" data-id="' + esc(o.outlet_id) + '">Pilih outlet</button>';
    const mapAction = o.maps_link ? '<a class="maps-link" href="' + esc(o.maps_link) + '" target="_blank" rel="noopener">Buka Maps</a>' : '';
    return '<div class="outlet-item"><div class="outlet-info"><strong>' + esc(o.outlet_name) + '</strong><p>' + esc(o.city || 'Area belum diisi') + (o.area ? ' · ' + esc(o.area) : '') + '</p><p>' + esc(segment) + ' · ' + esc(o.priority || 'Tanpa prioritas') + '</p><div class="outlet-tags">' + status + (o.is_prospect ? '<span class="tag gray">BELUM VERIFIKASI FISIK</span>' : '') + '</div>' + (o.address ? '<p class="outlet-address">' + esc(o.address) + '</p>' : '') + '</div><div class="outlet-actions">' + actions + mapAction + '</div></div>';
  }

  function inputPage() {
    if (state.user.role === 'CLIENT') return pageHead('Mode hanya-baca','Akun client tidak dapat mengirim atau mengubah data operasional.') + '<div class="card"><div class="notice">Gunakan Dashboard, Outlet, dan Laporan untuk memantau program.</div><button class="btn btn-primary btn-block" data-act="nav" data-page="reports">Buka laporan</button></div>';
    if (state.user.role === 'FM' && (!state.openAttendance || !state.openAttendance.outlet_id)) return pageHead('Check In diperlukan','Pilih outlet dari Rencana Kunjungan hari ini, lalu lakukan Check In dengan foto dan GPS.') + '<div class="card"><div class="notice warning">Input kunjungan hanya terbuka setelah Check In pada outlet yang ditugaskan TL/Admin.</div><button class="btn btn-primary btn-block" data-act="nav" data-page="home">Kembali ke Rencana Kunjungan</button></div>';
    if (state.user.role === 'FM' && state.openAttendance && (!state.selectedOutlet || String(state.selectedOutlet.outlet_id) !== String(state.openAttendance.outlet_id))) { state.selectedOutlet = state.outletList.find((outlet) => String(outlet.outlet_id) === String(state.openAttendance.outlet_id)) || state.selectedOutlet; }
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
    return pageHead('Pilih jenis laporan','Form dibuat berurutan agar tidak perlu mengisi data yang sama berulang kali.') + '<div class="card"><div class="notice ' + (state.openAttendance ? 'success' : 'warning') + '">' + (state.openAttendance ? '<strong>Check In aktif.</strong> Anda dapat melanjutkan laporan lapangan.' : '<strong>Anda belum Check In.</strong> Check In dengan foto dan GPS harus dilakukan sebelum menyimpan laporan.') + '</div><div class="action-grid">' + tiles.map(([key,title,desc]) => '<button class="action-tile" data-act="select-form" data-form-type="' + key + '"><strong>' + esc(title) + '</strong><small>' + esc(desc) + '</small></button>').join('') + '</div></div>' + (state.selectedOutlet ? '<div class="card"><div class="eyebrow">Outlet terpilih</div><h3>' + esc(state.selectedOutlet.outlet_name) + '</h3><p class="muted small">' + esc(state.selectedOutlet.city || '') + ' · ' + esc(state.selectedOutlet.outlet_id) + '</p><button class="btn btn-small btn-plain" data-act="clear-outlet">Ganti outlet</button></div>' : '<div class="card"><h3>Belum memilih outlet</h3><p class="muted small">Pilih outlet melalui menu Outlet sebelum membuka laporan kunjungan/aktivasi.</p><button class="btn btn-primary" data-act="nav" data-page="outlets">Cari outlet</button></div>');
  }
  function selectedOutletBlock() {
    if (!state.selectedOutlet) return '<div class="notice warning">Pilih outlet terlebih dahulu. <button type="button" class="link-btn" data-act="nav" data-page="outlets">Buka daftar outlet</button></div>';
    return '<div class="notice selected-outlet"><strong>' + esc(state.selectedOutlet.outlet_name) + '</strong><br><span class="small">' + esc(state.selectedOutlet.city || '') + ' · ' + esc(state.selectedOutlet.outlet_id) + '</span><br><button type="button" class="link-btn" data-act="clear-outlet">Ganti outlet</button></div>';
  }
    function visitFormPage() {
    if (!state.selectedOutlet) return pageHead('Kunjungan outlet','Pilih outlet terlebih dahulu.') + selectedOutletBlock();
    if (state.user.role === 'SPG') return pageHead('Form FM Visit','Modul ini hanya untuk FM, TL, PM, atau Admin.') + '<div class="card">Silakan pilih modul SPG Activation atau Interaction.</div>';
    
    // Section 1: Data Kunjungan (1.1 s/d 1.7)
    const visitSection = field('visit_type','1.1 Tipe Kunjungan','select',{required:true,blank:'Pilih tipe kunjungan',options:['Existing','New Prospect']}) +
      photoField('outlet','1.2 Foto Tampak Depan Toko','Wajib untuk bukti fisik dan seleksi toko.',true) +
      photoField('outlet_inside','1.3 Foto Tampak Dalam Toko','Wajib untuk melihat display dan stok toko.',true) +
      field('visit_contact','1.4 Nama Pemilik / PIC Toko','text',{required:true,placeholder:'Nama pemilik atau kepala toko'}) +
      field('visit_phone','1.5 Nomor Telepon PIC','tel',{required:true,placeholder:'Nomor telepon / WhatsApp PIC'}) +
      field('b2b_sales','1.6 Estimasi Turnover / B2B Sales','text',{placeholder:'Nominal omset / estimasi penjualan toko'}) +
      field('visit_notes','1.7 Catatan Kunjungan','textarea',{full:true,placeholder:'Kondisi outlet, kebutuhan, follow-up…'});

    // Section 2: Kualifikasi Outlet (2.1 s/d 2.17)
    const skuRangeOptions = ['Braking Component', 'Linkage', 'Suspension', 'Tidak Pernah Menjual'];
    const skuRangeDropdown = multiSelectDropdownHtml('ms-sku-range', 'sku_range_item', '2.14 Range SKU Relevan', skuRangeOptions, {
      required: true,
      full: true,
      placeholder: 'Pilih range SKU relevan...',
      hint: 'Pilih kategori komponen yang dijual.'
    });

    const stockBrandOptions = ['Belum diketahui', 'TRW', 'Akebono', 'Bendix', 'Birkens', 'MK KASHIYAMA', 'SANIKO', 'MONRO'];
    const stockedBrandsDropdown = multiSelectDropdownHtml('ms-stocked-brands', 'stocked_brand', '2.3 Stok Aktif Brake / Steering / Suspension?', stockBrandOptions, {
      required: true,
      full: true,
      placeholder: 'Pilih ready stock merek...',
      hint: 'Apakah toko rutin menyetok dan menjual komponen rem (kampas rem/cakram), minyak rem, atau kaki-kaki/steering?'
    });

    const stockVolumeBrands = [
      { brand: 'TRW', key: 'vol_TRW' },
      { brand: 'Akebono', key: 'vol_Akebono' },
      { brand: 'Bendix', key: 'vol_Bendix' },
      { brand: 'Birkens', key: 'vol_Birkens' },
      { brand: 'MK KASHIYAMA', key: 'vol_MK_KASHIYAMA' },
      { brand: 'SANIKO', key: 'vol_SANIKO' },
      { brand: 'MONRO', key: 'vol_MONRO' }
    ];
    const stockVolumeFieldsHtml = '<div id="wrap-brand-monthly-volume" class="conditional-block field-full" style="display:none;">' +
      '<div class="conditional-label">2.4 Estimasi Pengambilan per Bulan (Wajib Diisi)</div>' +
      '<p class="form-note">Kira-kira dalam sebulan biasanya ambil/kulakan berapa banyak untuk masing-masing merek tersebut? (Contoh pengisian: TRW 50 set/bln, Akebono 40 set/bln, Bendix 20 set/bln)</p>' +
      stockVolumeBrands.map((item) =>
        '<div id="wrap-' + esc(item.key) + '" class="field-full" style="display:none;">' +
          field(item.key, 'Estimasi Pengambilan per Bulan ' + item.brand, 'text', {
            required: true, placeholder: 'Contoh: ' + item.brand + ' 50 set/bln'
          }) +
        '</div>'
      ).join('') +
    '</div>';

    const qualSection = field('outlet_type','2.1 Tipe Outlet','select',{required:true,blank:'Pilih tipe outlet',options:['Toko sparepart','Distributor','Bengkel','Workshop','Toko sparepart dan bengkel','Lainnya']}) +
      field('active_bays','2.2 Jumlah Active Bay (Khusus bengkel / workshop)','number',{min:0,placeholder:'Minimal 3 bila dikualifikasikan sebagai bengkel/workshop'}) +
      stockedBrandsDropdown +
      stockVolumeFieldsHtml +
      field('segment_final','2.5 Klasifikasi Final SOW','select',{required:true,blank:'Pilih klasifikasi setelah verifikasi',options:['Grosir','Semi Grosir','Retail','Belum diklasifikasi']}) +
      field('brand_count','2.6 Jumlah Brand yang Dijual','number',{min:0,placeholder:'Contoh: 25'}) +
      field('fastest_moving_brand','2.7 Paling Fast Moving Merek Apa?','text',{placeholder:'Nama merek paling laris di outlet ini'}) +
      field('fastest_moving_pct','2.8 Berapa % Cakupan Brand Fast Moving?','text',{placeholder:'Contoh: 60% atau 75%'}) +
      field('purchase_history_signal','2.9 Riwayat Pembelian Brake / Steering 6 Bulan Terakhir?','select',{required:true,blank:'Pilih status riwayat pembelian',options:[{value:'Ya',label:'Ya, ada riwayat'},{value:'Tidak',label:'Tidak ada'},{value:'Belum diketahui',label:'Belum diketahui'}]}) +
      '<div id="wrap-brake-cat" class="conditional-block field-full">' + field('brake_categories','2.10 Kategori Produk yang Dibeli? (Jika ada riwayat)','select',{options:['Semua (Hydraulic, Friction, Shock Absorber)','Hydraulic & Friction','Hydraulic saja','Friction saja','Shock Absorber & Linkage','Belum diketahui']}) + '</div>' +
      field('trw_shelf_presence','2.11 Sudah Mengenal TRW?','select',{required:true,blank:'Pilih status pengenalan TRW',options:['Pernah menggunakan','Pernah tau','Belum pernah']}) +
      field('trw_in_stock','2.12 TRW Tersedia di Rak / Stok Toko?','select',{required:true,blank:'Pilih ketersediaan',options:['Ya','Tidak']}) +
      field('owner_engagement','2.13 Owner / Kepala Mekanik Bersedia Ikut Edukasi?','select',{required:true,blank:'Pilih kesediaan',options:['Ya','Tidak','Perlu follow-up']}) +
      skuRangeDropdown +
      field('purchase_frequency','2.15 Frekuensi Restock Toko','select',{required:true,blank:'Pilih frekuensi',options:['Mingguan','2 Mingguan','Bulanan','Tidak rutin','Belum diketahui']}) +
      field('eligible','2.16 Sales Follow Up / Hasil Kualifikasi','select',{required:true,blank:'Pilih hasil kualifikasi',options:[{value:'Ya',label:'Lolos Qualified otomatis / Ya — Qualified'},{value:'Tidak',label:'Tidak Qualified'}]}) +
      field('qualification_reason','2.17 Alasan Kualifikasi / Catatan Follow-up','textarea',{full:true,placeholder:'Wajib diisi bila tidak qualified, atau catatan kebutuhan bila qualified.'});

    // Section 3: Audit & POSM (3.1 s/d 3.8)
    const posmOptions = ['Tidak ada', 'Spanduk', 'Poster', 'Banner', 'Sticker', 'Lainnya'];
    const posmTypeDropdown = multiSelectDropdownHtml('ms-posm-type', 'posm_type', '3.1 Jenis POSM Terpasang', posmOptions, {
      required: true,
      full: true,
      placeholder: 'Pilih jenis POSM terpasang...',
      hint: 'Centang semua jenis POSM yang ditemukan terpasang di toko.'
    });

    const posmSection = posmTypeDropdown +
      '<div id="wrap-posm-allowed" class="conditional-block field-full">' + field('posm_allowed','3.2 Diperbolehkan Pasang POSM Baru? (Jika tidak ada POSM)','select',{options:['Ya','Tidak']}) + '</div>' +
      '<div id="wrap-posm-location" class="conditional-block field-full">' + field('posm_location_type','3.3 Titik / Lokasi POSM','select',{options:['Jalan Utama','Jalan Alternative','Lainnya / Dalam Toko']}) + '</div>' +
      '<div id="wrap-posm-before" class="conditional-block field-full">' + field('condition_before','3.4 Kondisi POSM Sebelum','select',{options:['Baik','Rusak','Kotor','Tidak terlihat','Tidak sesuai standar','Lainnya']}) + '</div>' +
      field('posm_action','3.5 Tindakan POSM','select',{required:true,options:['Tidak ada perubahan','Pasang baru','Replace (Ganti)','Repair (Perbaiki)']}) +
      field('condition_after','3.6 Kondisi POSM Setelah Tindakan','select',{options:['Baik dan terlihat','Terpasang baru','Perlu follow-up','Tidak ada perubahan']}) +
      photoField('posm_before','3.7a Foto POSM Before','Wajib bila tindakan Pasang Baru, Replace, atau Repair.') +
      photoField('posm_after','3.7b Foto POSM After','Wajib bila tindakan Pasang Baru, Replace, atau Repair.') +
      field('owner_approval','3.8 Persetujuan Owner untuk POSM','select',{options:['Ya','Tidak','Tidak diperlukan']}) +
      field('posm_notes','Catatan POSM','textarea',{full:true,placeholder:'Ukuran spanduk, posisi gantung, dll.'});

    // Section 4: Edukasi Produk (4.1 s/d 4.3)
    const eduSection = field('education_done','4.1 Edukasi Produk Diberikan?','select',{required:true,blank:'Pilih status edukasi',options:[{value:'Ya',label:'Ya'},{value:'Tidak',label:'Tidak'}]}) +
      '<div id="wrap-edu-details" class="conditional-block field-full">' +
        field('education_type','4.2 Materi Edukasi yang Diberikan','select',{options:['Product Knowledge','Program Promo','Product Knowledge + Promo','Demo Komponen Rem / Steering','Tidak dilakukan']}) +
        field('product_knowledge','4.3 Poin Edukasi / Catatan Penjelasan','textarea',{full:true,placeholder:'Catatan materi yang disampaikan sesuai script TRW'}) +
      '</div>';

    // Section 5: Survey TRW & Market Insight (5.1 s/d 5.13)
    const compGroups = [
      { group: 'Hydraulic', items: ['AISIN', 'SEIKEN', 'AKEBONO', 'ADVICS', 'MIYACO', 'MANDO', 'TBK', 'FIC/JKC'] },
      { group: 'Friction', items: ['AKEBONO', 'BENDIX', 'BOSCH', 'NISSHINBO', 'FBL', 'ATE', 'TEXTAR', 'PAGID', 'JFBK', 'NOZUMI'] },
      { group: 'Shock Absorber', items: ['KYB', 'MONROE', 'MANDO', 'TOKICO', 'MASUMA', 'KJ SHOCK'] },
      { group: 'Linkage', items: ['555 Sankei', 'AISIN', 'MASUMA', 'RBI', 'LKS', 'MANDO'] }
    ];

    const categorizedCompetitorHtml = multiSelectDropdownHtml('ms-comp-brands', 'comp_brand', '5.1 Brand Kompetitor yang Digunakan Toko', null, {
      groups: compGroups,
      full: true,
      placeholder: 'Pilih merek kompetitor yang digunakan/dijual toko...',
      hint: 'Centang semua merek kompetitor yang ditemukan dari kategori Hydraulic, Friction, Shock Absorber, dan Linkage.'
    }) + field('current_brand','Brand Kompetitor Lainnya (Teks Bebas)','text',{placeholder:'Ketik merek kompetitor lain jika ada (opsional)'});

    const surveySection = categorizedCompetitorHtml +
      field('current_volume','5.2 Volume Stok / Penjualan Saat Ini','text',{placeholder:'Estimasi unit / set per bulan'}) +
      field('trw_stock','5.3 Stok TRW Tersedia di Toko?','select',{required:true,blank:'Pilih status ketersediaan',options:['Ya','Tidak','Belum diketahui']}) +
      field('trw_price','5.4 Harga Jual TRW (Rp)','number',{min:0,placeholder:'Contoh: 250000'}) +
      field('trw_campaign_program','5.5 Campaign / Program TRW','textarea',{full:true,placeholder:'Cek program promo, program tour, cashback, atau bundling TRW'}) +
      field('trw_purchase_source','5.6 Pembelian Produk TRW Melalui','select',{options:['Sales TRW','Grossir','Distributor Resmi','Lainnya']}) +
      field('competitor_brand','5.7 Brand Pembanding Utama','text',{required:true,placeholder:'Contoh: Akebono / Bendix / KYB'}) +
      field('competitor_price','5.8 Harga Kompetitor Tersebut (Rp)','number',{min:0,placeholder:'Contoh: 230000'}) +
      field('competitor_net_program','5.9 Harga Netto & Program Kompetitor','textarea',{full:true,placeholder:'Cek harga modal bersih netto setelah diskon, program hadiah/tour/cashback dari kompetitor.'}) +
      field('purchase_intent','5.10 Minat Beli TRW? (Skala 1 s/d 5)','select',{required:true,blank:'Pilih skala minat',options:[{value:'1',label:'1 — Sangat Rendah'},{value:'2',label:'2 — Rendah'},{value:'3',label:'3 — Sedang'},{value:'4',label:'4 — Tinggi'},{value:'5',label:'5 — Sangat Tinggi'}]}) +
      '<div id="wrap-barrier-switching" class="conditional-block field-full">' + field('barrier_switching','5.11 Alasan Belum Berminat / Hambatan Berpindah','select',{options:['Harga','Stok tidak lancar','Brand preference','Kualitas / performa','Belum ada kebutuhan','Lainnya']}) + '</div>' +
      field('brand_awareness','5.12a Awareness TRW','select',{options:['Tinggi','Sedang','Rendah','Belum tahu TRW']}) +
      field('quality_perception','5.12b Persepsi Kualitas TRW','select',{options:['Baik','Netral','Kurang','Belum pernah menggunakan']}) +
      field('price_perception','5.12c Persepsi Harga TRW','select',{options:['Kompetitif','Sesuai pasar','Terlalu tinggi','Belum diketahui']}) +
      field('unmet_demand','5.13 Unmet Demand & Market Insight','textarea',{full:true,placeholder:'Kebutuhan SKU / ketersediaan barang / masukan toko yang belum terpenuhi…'});

    return pageHead('Kunjungan & Kualifikasi Toko','Sesuai standar kuesioner resmi TRW (5 Bagian).') +
      selectedOutletBlock() +
      (state.openAttendance ? '' : '<div class="notice warning">Wajib Check In dengan foto + GPS sebelum menyimpan kuesioner.</div>') +
      '<form data-form="visit" class="card">' +
        section('1','Data Kunjungan',visitSection,'Foto tampak depan & tampak dalam toko menjadi evidence utama.') +
        section('2','Kualifikasi Outlet',qualSection,'Pastikan verifikasi stok aktif, SOW final, dan brand fast moving.') +
        section('3','Audit & POSM',posmSection,'Pemasangan, penggantian atau perbaikan POSM wajib melampirkan foto Before & After.') +
        section('4','Edukasi Produk',eduSection,'Sampaikan product knowledge dan program promosi resmi TRW.') +
        section('5','Survey TRW & Market Insight',surveySection,'Petakan ketersediaan stok, harga, pembanding, persepsi dan unmet demand.') +
        '<div class="notice warning small">Penyimpanan kuesioner memerlukan koneksi internet. Aplikasi mencatat lokasi GPS dan waktu survey saat Anda menyimpan.</div>' +
        '<div class="form-actions"><button type="button" class="btn btn-plain" data-act="nav" data-page="home">Batal</button><button type="submit" class="btn btn-primary">Simpan Kuesioner Survey</button></div>' +
      '</form>' 
  }
  function activationFormPage() {
    if (state.user.role !== 'SPG' && !['ADMIN','PM','TL'].includes(state.user.role)) return '<div class="card">Akses tidak diizinkan.</div>';
    if (!state.selectedOutlet) return pageHead('Aktivasi outlet','Pilih outlet qualified terlebih dahulu.') + '<div class="card"><button class="btn btn-primary" data-act="nav" data-page="outlets">Cari outlet qualified</button></div>';
    const o = state.selectedOutlet; const qualified = o.is_qualified || String(o.status).toUpperCase() === 'QUALIFIED';
    const qualification = qualified ? '<div class="notice success">Outlet qualified. Aktivasi dapat dilaporkan.</div>' : '<div class="notice warning">Outlet ini belum berstatus qualified. Aktivasi SPG belum dapat disimpan. Pilih outlet berstatus QUALIFIED atau minta FM menyelesaikan qualification.</div>';
    const formContent = field('activation_attendance_count','Jumlah peserta / mekanik yang hadir','number',{min:0,value:'0'}) + field('activation_education','Edukasi TRW dilakukan?','select',{required:true,blank:'Pilih ya / tidak',options:['Ya','Tidak']}) + field('activation_demo','Demo produk dilakukan?','select',{required:true,blank:'Pilih ya / tidak',options:['Ya','Tidak']}) + field('activation_catalogue','Katalog ditinggalkan?','select',{required:true,blank:'Pilih ya / tidak',options:['Ya','Tidak']}) + field('activation_owner','Nama owner / PIC','text',{placeholder:'Pemilik toko / kepala mekanik'}) + field('activation_verified','Owner melakukan verifikasi?','select',{required:true,blank:'Pilih ya / tidak',options:['Ya','Tidak']}) + field('activation_notes','Catatan aktivasi','textarea',{full:true,placeholder:'Materi, pertanyaan, kebutuhan follow-up…'}) + photoField('activation','Foto aktivitas SPG','Wajib untuk evidence activation.',true);
    return pageHead('Edukasi & demo TRW','Log activation hanya untuk outlet yang telah qualified.') + selectedOutletBlock() + qualification + '<form data-form="activation" class="card">' + section('1','Aktivasi',formContent,'Catat kehadiran sesi, edukasi, demo, dan bukti foto.') + '<div class="form-actions"><button type="button" class="btn btn-plain" data-act="nav" data-page="outlets">Ganti outlet</button><button type="submit" class="btn btn-primary" ' + (qualified ? '' : 'disabled') + '>Simpan aktivasi</button></div></form>';
  }
  function interactionFormPage() {
    const acts = ((state.reports && state.reports.activations) || []).filter((x) => ['ADMIN','PM','TL'].includes(state.user.role) || !x.user_id || x.user_id === state.user.user_id).filter((x) => !state.selectedOutlet || String(x.outlet_id) === String(state.selectedOutlet.outlet_id));
    const options = acts.map((a) => ({ value: a.activation_id, label: fmtDate(a.activation_date) + ' · ' + (outletName(a.outlet_id) || a.outlet_id) + ' · ' + a.activation_id.slice(-6) }));
    const selectedActivation = state.lastActivationId || (options[0] && options[0].value) || '';
    const activationField = field('activation_id','Sesi activation','select',{required:true,blank:'Pilih sesi activation',value:selectedActivation,options:options});
    const content = activationField + field('interaction_count','Jumlah end-user yang berinteraksi','number',{required:true,min:0,value:'1'}) + field('interaction_intent','Purchase intent (1–5)','select',{options:[{value:'',label:'Belum dinilai'},{value:'1',label:'1 — sangat rendah'},{value:'2',label:'2 — rendah'},{value:'3',label:'3 — sedang'},{value:'4',label:'4 — tinggi'},{value:'5',label:'5 — sangat tinggi'}]}) + field('interaction_brand_used','Brand yang digunakan saat ini','text',{placeholder:'Brand existing'}) + field('interaction_brand_considered','Brand yang dipertimbangkan','text',{placeholder:'TRW / kompetitor / belum tahu'}) + field('interaction_requested','Informasi yang diminta','select',{options:['Harga','Ketersediaan SKU','Product knowledge','Lokasi pembelian','Promo','Tidak ada','Lainnya']}) + field('interaction_lead','Ada potential lead?','select',{required:true,options:[{value:'Tidak',label:'Tidak'},{value:'Ya',label:'Ya — perlu follow-up'}]}) + field('interaction_notes','Catatan','textarea',{full:true,placeholder:'Catatan singkat, jangan masukkan data pribadi konsumen yang tidak diperlukan.'});
    const marketInsight = field('spg_current_brand','Brand yang ditemukan','text',{placeholder:'Brand yang saat ini dijual/digunakan'}) + field('spg_current_volume','Volume / frekuensi penjualan','text',{placeholder:'Estimasi dan periode'}) + field('spg_trw_stock','Stok TRW tersedia?','select',{options:['Ya','Tidak','Belum diketahui']}) + field('spg_trw_price','Harga TRW (Rp)','number',{min:0}) + field('spg_competitor_brand','Brand kompetitor utama','text') + field('spg_competitor_price','Harga kompetitor (Rp)','number',{min:0}) + field('spg_barrier_switching','Hambatan berpindah brand','select',{options:['Harga','Ketersediaan stok','Brand preference','Kualitas / performa','Belum ada kebutuhan','Lainnya','Tidak diketahui']}) + field('spg_restock_frequency','Frekuensi restock','select',{options:['Mingguan','2 mingguan','Bulanan','Tidak rutin','Belum diketahui']}) + field('spg_preferred_sku','SKU / kategori pilihan','text') + field('spg_brand_awareness','Awareness TRW','select',{options:['Tinggi','Sedang','Rendah','Belum tahu TRW']}) + field('spg_quality_perception','Persepsi kualitas','select',{options:['Baik','Netral','Kurang','Belum pernah menggunakan']}) + field('spg_price_perception','Persepsi harga','select',{options:['Kompetitif','Sesuai pasar','Terlalu tinggi','Belum diketahui']}) + field('spg_unmet_demand','Kebutuhan yang belum terpenuhi','textarea',{full:true}) + field('spg_market_insight','Insight dan rekomendasi','textarea',{full:true,placeholder:'Temuan atau follow-up yang disarankan.'});
    const insightBlock = '<details class="optional-block field-full"><summary>Tambah market insight pelanggan (opsional)</summary><p class="muted small">Isi bila ada informasi relevan dari percakapan pelanggan atau mekanik.</p><div class="field-grid">' + marketInsight + '</div></details>';
    return pageHead('End-user interaction','Bedakan jumlah interaksi, purchase intent, lead, dan sales. Interaksi bukan konversi penjualan.') + '<form data-form="interaction" class="card">' + section('1','Interaksi konsumen',content,'Gunakan hitungan agregat. Hindari menyimpan data pribadi yang tidak diperlukan.') + section('2','Market insight',insightBlock,'Opsional; cukup isi informasi yang berhasil diverifikasi.') + '<div class="form-actions"><button type="button" class="btn btn-plain" data-act="nav" data-page="input">Kembali</button><button type="submit" class="btn btn-primary">Simpan interaksi</button></div></form>';
  }
  function issueFormPage() {
    const content = field('issue_title','Kendala / issue','text',{required:true,placeholder:'Contoh: stok banner habis'}) + field('issue_action','Tindakan yang dibutuhkan','textarea',{full:true,placeholder:'Apa langkah penyelesaiannya?'}) + field('issue_owner','PIC tindak lanjut','text',{placeholder:'Nama atau role'}) + field('issue_deadline','Target penyelesaian','date',{}) + field('issue_priority','Prioritas','select',{options:['Normal','Tinggi','Kritis']}) + field('issue_notes','Catatan tambahan','textarea',{full:true,placeholder:'Detail yang membantu penyelesaian.'});
    return pageHead('Catat kendala lapangan','Setiap kendala memiliki action, PIC, deadline dan status.') + selectedOutletBlock() + '<form data-form="issue" class="card">' + section('1','Kendala dan tindak lanjut',content) + '<div class="form-actions"><button type="button" class="btn btn-plain" data-act="nav" data-page="input">Kembali</button><button type="submit" class="btn btn-primary">Simpan issue</button></div></form>';
  }

  function clientExportCard() {
    const today = localDate();
    const range = state.clientExportRange || { from: today.slice(0, 8) + '01', to: today };
    return '<form data-form="exportClient" class="card client-export-card" aria-labelledby="client-export-title" aria-busy="' + state.clientExporting + '">' +
      '<h2 id="client-export-title">Unduh laporan survei FM</h2>' +
      '<p class="muted small">Excel memuat ringkasan, data outlet, bukti, dan hasil survei lengkap. Filter mengikuti tanggal kunjungan dalam WIB.</p>' +
      '<div class="field-grid">' +
      field('from', 'Tanggal mulai', 'date', { required: true, min: '1900-01-01', value: range.from }) +
      field('to', 'Tanggal akhir', 'date', { required: true, min: '1900-01-01', value: range.to }) +
      '</div><div class="form-actions"><button type="submit" class="btn btn-primary"' +
      (state.clientExporting ? ' disabled>Menyiapkan Excel…' : '>Unduh Excel (.xlsx)') + '</button></div></form>';
  }

  function reportsPage() {
    const isClient = state.user.role === 'CLIENT';
    const m = (state.dashboard && state.dashboard.metrics) || {};
    const periods = (state.reports && state.reports.periods) || {};
    const current = periods[state.periodTab] || {};
    const tabs = [['daily','Harian'],['weekly','Mingguan'],['monthly','Bulanan']].map(([key,label]) =>
      filterButton('report-tab', key, label, state.periodTab === key, 'tab')).join('');
    const csvActions = isClient ? '' : '<div class="divider"></div><div class="row"><button class="btn btn-plain" data-act="export-summary" data-period="' + state.periodTab + '">Unduh ringkasan CSV</button><button class="btn btn-primary" data-act="export-records">Unduh data lengkap</button></div>';
    const periodCards = '<div class="card"><div class="card-head"><div><h2>Ringkasan ' + ({daily:'harian',weekly:'mingguan',monthly:'bulanan'}[state.periodTab]) + '</h2><p class="muted small">' + esc(current.range || 'Muat data laporan untuk menghitung periode.') + '</p></div><button class="btn btn-small btn-plain" data-act="refresh-reports">Muat ulang</button></div><div class="grid grid-3 metric-grid">' + metricCard('FM visits',current.visits, null,'Visit tersimpan') + metricCard('POSM reports',current.posm,null,'Audit / tindakan POSM') + metricCard('Edukasi',current.education,null,'Log edukasi') + metricCard('Outlet qualification',current.qualifications,null,'Hasil verifikasi outlet') + metricCard('TRW surveys',current.surveys,null,'Survey FM') + metricCard('Competitor records',current.competitors,null,'Observasi kompetitor terstruktur') + metricCard('SPG market insight',current.spgSurveys,null,'Survey pada sesi activation') + metricCard('SPG activation days',current.activations,null,'Hari aktivasi') + metricCard('End-user interactions',current.interactions,null,'Interaksi agregat') + '</div>' + csvActions + '</div>';
    const tabsHead = '<div class="filter-row period-tabs" role="group" aria-label="Periode laporan">' + tabs + '</div>';
    const table = reportListSection();
    return pageHead('Laporan & evidence','Rekap periode, aktivitas lapangan, dan ekspor data.') + (isClient ? clientExportCard() : '') +
      '<div class="card metric-strip"><div class="grid grid-3 metric-grid">' + metricCard('Unique outlets',m.uniqueVisited,180,'Outlet unik yang pernah dikunjungi') + metricCard('Evidence records',m.evidence,null,'Foto dan geo records') + metricCard('Open issues',m.openIssues,null,'Belum closed') + '</div></div>' + tabsHead + periodCards + '<div class="card"><div class="card-head"><div><h2>Aktivitas terbaru</h2><p class="muted small">Pilih kategori untuk melihat detail.</p></div></div><div class="filter-row report-tabs" role="group" aria-label="Kategori aktivitas">' + [['visits','FM Visit'],['attendance','Check In/Out'],['qualifications','Qualification'],['posm','POSM'],['education','Edukasi'],['surveys','Survey FM'],['competitors','Kompetitor'],['spgSurveys','Survey SPG'],['activations','SPG'],['interactions','Interaksi'],['issues','Issues'],['evidence','Evidence']].map(([key,label]) => filterButton('report-list-tab', key, label, state.reportTab === key, 'tab')).join('') + '</div>' + table + '</div>';
  }
  function reportListSection() {
    const r = state.reports || {};
    const key = ['visits','attendance','qualifications','posm','education','surveys','competitors','spgSurveys','activations','interactions','issues','evidence'].includes(state.reportTab) ? state.reportTab : 'visits';
    const rows = r[key] || [];
    if (!rows.length) return '<div class="empty-state"><strong>Belum ada data untuk kategori ini</strong>Setelah aktivitas tersimpan dan tersinkron, data akan muncul di sini.</div>';
    const names = {visits:'FM Visit',attendance:'Check In/Out',qualifications:'Qualification',posm:'POSM',education:'Edukasi',surveys:'Survey FM',competitors:'Competitor',spgSurveys:'Survey SPG',activations:'SPG Activation',interactions:'Interaction',issues:'Issue',evidence:'Evidence'};
    const cells = rows.slice(0, 30).map((row) => {
      const time = row.visit_date || row.work_date || row.activation_date || row.date || row.created_at || row.checkin_at;
      const outlet = outletName(row.outlet_id) || row.outlet_id || row.attendance_id || row.visit_id || row.issue_id || row.activation_id || row.interaction_id || '—';
      const detail = row.status || row.action || row.kind || row.issue || row.notes || row.count || names[key];
      return [
        esc(fmtDateTime(time)),
        '<strong>' + esc(outlet) + '</strong><div class="tiny muted">' + esc(row.user_name || userName(row.user_id) || row.user_id || '') + '</div>',
        esc(detail)
      ];
    });
    return tableMarkup(['Waktu / tanggal', 'Outlet / record', 'Status / detail'], cells, names[key]);
  }

  function morePage() {
    const role = state.user.role;
    const cards = [];
    if (role !== 'CLIENT') cards.push('<button class="action-tile" data-act="sync"><strong>Sinkronisasi data</strong><small>' + (state.queueCount ? state.queueCount + ' data menunggu' : 'Antrean offline dan status koneksi') + '</small></button>');
    cards.push('<button class="action-tile" data-act="change-password"><strong>Ganti password</strong><small>Gunakan password unik minimal 8 karakter.</small></button>');
    cards.push('<button class="action-tile" data-act="nav" data-page="reports"><strong>Laporan</strong><small>Rekap periode dan unduh ' + (role === 'CLIENT' ? 'Excel' : 'CSV') + '.</small></button>');
    if (['ADMIN','PM','TL'].includes(role)) cards.push('<button class="action-tile" data-act="nav" data-page="beatplan"><strong>Rencana kunjungan</strong><small>Jadwal kunjungan, FM, outlet dan status.</small></button>');
    if (role === 'ADMIN') cards.push('<button class="action-tile" data-act="nav" data-page="users"><strong>Manajemen user</strong><small>Buat akun FM, SPG, TL, PM, Admin, atau Client read-only.</small></button>');
    if (['ADMIN','PM','TL'].includes(role)) cards.push('<button class="action-tile" data-act="nav" data-page="createOutlet"><strong>Tambah outlet</strong><small>Daftarkan outlet aktif baru.</small></button>');
    cards.push('<button class="action-tile" data-act="logout"><strong>Logout aplikasi</strong><small>' + (role === 'CLIENT' ? 'Keluar dari akun client.' : 'Ini tidak mengakhiri Check In yang masih aktif.') + '</small></button>');
    const note = role === 'CLIENT'
      ? '<div class="card"><h2>Akses hanya baca</h2><p class="muted small">Akun client dapat meninjau ringkasan program, outlet, laporan dan evidence yang tersedia. Data operasional tidak dapat ditambahkan atau diubah dari akun ini.</p></div>'
      : '<div class="card"><h2>Catatan penggunaan</h2><p class="muted small">Aplikasi membutuhkan HTTPS untuk akses kamera dan GPS. Ketika offline, kiriman yang didukung disimpan di perangkat dan ditandai menunggu sinkronisasi. Jangan menghapus data browser sebelum antrean terkirim.</p><p class="muted small">Login/Logout mengatur sesi aplikasi. Check In/Check Out merekam kehadiran lapangan dengan foto dan GPS; keduanya tidak otomatis saling mengakhiri.</p></div>';
    const locationNote = role === 'FM'
      ? '<p class="notice">Posisi petugas FM diperbarui berkala selama Anda masuk dan memberi izin lokasi.</p>'
      : '';
    return pageHead('Pengaturan & alat', role === 'CLIENT' ? 'Profil akun dan akses laporan program.' : 'Akun, sinkronisasi, serta pengelolaan sistem.') + '<div class="card"><div class="user-panel"><div class="avatar">' + esc((state.user.full_name || state.user.username).slice(0,1).toUpperCase()) + '</div><div class="user-copy"><strong>' + esc(state.user.full_name || state.user.username) + '</strong><small>' + esc(state.user.username) + ' · ' + esc(roleName(role)) + '</small><small>User ID: ' + esc(state.user.user_id) + '</small></div></div><div class="divider"></div><div class="grid">' + cards.join('') + '</div></div>' + note + locationNote + '<p class="version-note">TRW Field · Versi 1.6.6</p>';
  }

  function usersPage() {
    if (state.user.role !== 'ADMIN') return '<div class="card">Akses hanya untuk Admin.</div>';
    const form = field('user_full_name','Nama lengkap','text',{required:true}) + field('user_username','Username','text',{required:true,placeholder:'Contoh: fm.jakarta01'}) + field('user_role','Role','select',{required:true,options:['FM','SPG','TL','PM','ADMIN','CLIENT']}) + field('user_phone','Nomor telepon','tel',{placeholder:'Opsional'}) + field('user_password','Password awal','password',{required:true,hint:'Minimal 8 karakter. Berikan melalui kanal yang aman.'});
    const rows = state.users.map((u) => [
      '<strong>' + esc(u.full_name) + '</strong><div class="tiny muted">' + esc(u.username) + '</div><div class="tiny muted">Login terakhir: ' + esc(fmtDateTime(u.last_login)) + '</div>',
      esc(u.role),
      u.active ? '<span class="tag green">Aktif</span>' : '<span class="tag red">Nonaktif</span>',
      '<div class="table-actions"><button class="btn btn-small btn-plain" data-act="toggle-user" data-id="' + esc(u.user_id) + '" data-active="' + (u.active ? 'false' : 'true') + '">' + (u.active ? 'Nonaktifkan' : 'Aktifkan') + '</button><button class="btn btn-small btn-soft" data-act="reset-password" data-id="' + esc(u.user_id) + '">Reset password</button></div>'
    ]);
    const list = rows.length ? tableMarkup(['Nama / username', 'Role', 'Status', 'Aksi'], rows, 'Daftar user') :
      '<div class="empty-state">Belum ada user.</div>';
    return pageHead('Manajemen user','Buat akun dengan role yang tepat dan nonaktifkan akun yang sudah tidak digunakan.') + '<div class="card"><h2>Buat user baru</h2><form data-form="createUser"><div class="field-grid">' + form + '</div><div class="form-actions"><button type="submit" class="btn btn-primary">Buat akun</button></div></form></div><div class="card"><div class="card-head"><div><h2>Daftar user</h2><p class="muted small">Password dan hash tidak pernah ditampilkan.</p></div><button class="btn btn-small btn-plain" data-act="refresh-users">Muat ulang</button></div>' + list + '</div>';
  }

  function createOutletPage() {
    if (!['ADMIN','PM','TL'].includes(state.user.role)) return '<div class="card">Akses tidak diizinkan.</div>';
    const content = field('new_outlet_name','Nama outlet','text',{required:true}) + field('new_outlet_city','Kota','select',{required:true,options:['Jakarta Pusat','Jakarta Utara','Jakarta Barat','Jakarta Selatan','Jakarta Timur','Bogor','Depok','Tangerang','Tangerang Selatan','Bekasi','Lainnya']}) + field('new_outlet_area','Area / kecamatan','text',{placeholder:'Area cluster'}) + field('new_outlet_address','Alamat','textarea',{full:true}) + field('new_outlet_type','Tipe outlet','select',{options:['Toko sparepart','Distributor','Bengkel','Workshop','Toko sparepart dan bengkel','Lainnya']}) + field('new_outlet_segment','Klasifikasi SOW','select',{required:true,options:['Grosir','Semi Grosir','Retail','Belum diklasifikasi']}) + field('new_outlet_priority','Prioritas','select',{options:['P1','P2','P3']}) + field('new_outlet_contact','Nama PIC','text') + field('new_outlet_phone','Telepon PIC','tel');
    return pageHead('Tambah outlet','Data baru dicatat sebagai outlet aktif; prospect hasil riset tetap dikelola di Prospects.') + '<form data-form="createOutlet" class="card"><div class="field-grid">' + content + '</div><div class="form-actions"><button type="button" class="btn btn-plain" data-act="nav" data-page="outlets">Batal</button><button type="submit" class="btn btn-primary">Simpan outlet</button></div></form>';
  }

  function beatPlanPage() {
    if (!['ADMIN','PM','TL'].includes(state.user.role)) return '<div class="card">Akses tidak diizinkan.</div>';
    const canEdit = ['ADMIN','TL'].includes(state.user.role);
    const userOptions = state.users.filter((u) => u.active && u.role === 'FM').map((u) => ({value:u.user_id,label:u.full_name + ' · FM'}));
    const outlets = state.outletList || [];

    const baseFields = field('beat_date','Tanggal Rute','date',{required:true,value:localDate()}) +
      field('beat_week','Minggu Program','text',{placeholder:'Contoh: Week 03'}) +
      field('beat_user','Petugas FM','select',{required:true,blank:'Pilih Petugas FM',options:userOptions}) +
      field('beat_notes','Catatan Rute / Cluster','textarea',{full:true,placeholder:'Cluster / arahan / jadwal rute'});

    const outletChecklistHtml = outlets.map((o) => {
      const segment = o.segment_final || o.segment_indicative || 'Belum diklasifikasi';
      const city = o.city || 'Kota belum diisi';
      const area = o.area ? ' · ' + o.area : '';
      return '<label class="beat-outlet-row" data-outlet-id="' + esc(o.outlet_id) + '" data-search="' + esc((o.outlet_name + ' ' + city + ' ' + (o.area || '')).toLowerCase()) + '" data-city="' + esc(city.toLowerCase()) + '">' +
        '<input type="checkbox" name="beat_outlet_ids" value="' + esc(o.outlet_id) + '" class="beat-outlet-checkbox">' +
        '<div class="beat-outlet-info">' +
          '<div class="beat-outlet-name">' + esc(o.outlet_name) + '</div>' +
          '<div class="beat-outlet-sub">' + esc(city) + esc(area) + ' · <span class="tag gray tiny">' + esc(segment) + '</span> ' + (o.priority ? '<span class="tag yellow tiny">' + esc(o.priority) + '</span>' : '') + '</div>' +
        '</div>' +
      '</label>';
    }).join('');

    const cities = Array.from(new Set(outlets.map((o) => o.city).filter(Boolean))).sort();
    const cityFilterOptions = '<option value="">Semua Wilayah / Kota (' + outlets.length + ' Outlet)</option>' +
      cities.map((c) => '<option value="' + esc(c.toLowerCase()) + '">' + esc(c) + '</option>').join('');

    const batchSelectorHtml = '<div class="beat-outlet-selector field-full">' +
      '<div class="beat-selector-toolbar">' +
        '<div>' +
          '<strong>Pilih outlet untuk rute</strong>' +
          '<div class="form-note">Centang hingga 20 outlet yang akan ditugaskan ke FM pada tanggal ini.</div>' +
        '</div>' +
        '<div><span id="beat-counter-tag" class="tag yellow beat-counter-tag">0 / 20 Outlet Terpilih</span></div>' +
      '</div>' +
      '<div class="beat-selector-controls">' +
        '<input type="search" id="beat-outlet-search" placeholder="Cari nama toko atau area" aria-label="Cari outlet untuk rute">' +
        '<select id="beat-city-filter" aria-label="Filter kota">' + cityFilterOptions + '</select>' +
        '<button type="button" class="btn btn-small btn-primary" data-act="beat-select-20">Pilih 20 teratas</button>' +
        '<button type="button" class="btn btn-small btn-plain" data-act="beat-clear-selection">Kosongkan</button>' +
      '</div>' +
      '<div class="beat-outlets-scroll" id="beat-outlets-scroll">' +
        (outletChecklistHtml || '<div class="empty-state">Belum ada outlet terdaftar.</div>') +
      '</div>' +
    '</div>';

    const form = canEdit
      ? '<div class="card"><div class="card-head"><div><h2>Buat penugasan rute</h2><p class="muted small">Tentukan petugas FM, tanggal kerja, lalu centang hingga 20 outlet sekaligus.</p></div></div><form data-form="beatPlan"><div class="field-grid">' + baseFields + '</div>' + batchSelectorHtml + '<div class="form-actions"><button type="submit" class="btn btn-primary">Simpan rencana kunjungan</button></div></form></div>'
      : '<div class="card"><div class="notice">Akun PM dapat melihat jadwal, sedangkan pembuatan dan perubahan penugasan rute dilakukan oleh TL/Admin.</div></div>';

    const rows = state.beatPlan.map((b) => [
      esc(fmtDate(b.date)) + '<div class="tiny muted">' + esc(b.week || '') + '</div>',
      esc(userName(b.user_id) || b.user_id),
      esc(outletName(b.outlet_id) || b.outlet_id),
      esc(b.status || 'PLANNED')
    ]);
    const list = rows.length ? tableMarkup(['Tanggal', 'Petugas', 'Outlet', 'Status'], rows, 'Daftar rencana kunjungan') :
      '<div class="empty-state">Belum ada rencana kunjungan.</div>';
    return pageHead('Rencana kunjungan','TL/Admin menetapkan rencana kunjungan hingga 20 outlet sekaligus per FM.') + form + '<div class="card"><div class="card-head"><div><h2>Daftar rencana</h2><p class="muted small">Jadwal kunjungan yang sudah dibuat.</p></div><button class="btn btn-small btn-plain" data-act="refresh-beats">Muat ulang</button></div>' + list + '</div>';
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
    if (!state.openAttendance || !state.openAttendance.attendance_id) throw new Error('Lakukan Check In dengan foto dan GPS sebelum menyimpan survey.');
    if (!state.selectedOutlet) throw new Error('Pilih outlet terlebih dahulu.');

    const visitPhoto = formPhoto('outlet');
    if (!visitPhoto) throw new Error('1.2 Foto tampak depan toko wajib diambil.');
    const insidePhoto = formPhoto('outlet_inside');
    if (!insidePhoto) throw new Error('1.3 Foto tampak dalam toko wajib diambil.');
    if (!fieldVal(form, 'visit_contact')) throw new Error('1.4 Nama pemilik / PIC toko wajib diisi.');
    if (!fieldVal(form, 'visit_phone')) throw new Error('1.5 Nomor telepon PIC wajib diisi.');

    const eligible = fieldVal(form, 'eligible') === 'Ya';
    const selectedOutletType = fieldVal(form, 'outlet_type');
    if (!selectedOutletType) throw new Error('2.1 Tipe outlet wajib dipilih.');

    // Collect checked brands for 2.3 and conditional volumes for 2.4
    const checkedStockBrands = Array.from(form.querySelectorAll('input[name="stocked_brand"]:checked')).map((c) => c.value);
    if (!checkedStockBrands.length) throw new Error('2.3 Stok Aktif Brake/Steering/Suspension wajib dipilih.');
    const brakeBrandsStocked = checkedStockBrands.join(', ');

    const stockVolBrands = [
      { brand: 'TRW', key: 'vol_TRW' },
      { brand: 'Akebono', key: 'vol_Akebono' },
      { brand: 'Bendix', key: 'vol_Bendix' },
      { brand: 'Birkens', key: 'vol_Birkens' },
      { brand: 'MK KASHIYAMA', key: 'vol_MK_KASHIYAMA' },
      { brand: 'SANIKO', key: 'vol_SANIKO' },
      { brand: 'MONRO', key: 'vol_MONRO' }
    ];
    const brandMonthlyVolEntries = [];
    for (const item of stockVolBrands) {
      if (checkedStockBrands.includes(item.brand)) {
        const val = fieldVal(form, item.key);
        if (!val) throw new Error('2.4 Estimasi Pengambilan per Bulan ' + item.brand + ' wajib diisi.');
        brandMonthlyVolEntries.push(item.brand + ': ' + val);
      }
    }
    const brandMonthlyVolume = brandMonthlyVolEntries.join(', ');

    // Collect checked SKU range for 2.14
    const checkedSkuRange = Array.from(form.querySelectorAll('input[name="sku_range_item"]:checked')).map((c) => c.value);
    const skuRangeVal = checkedSkuRange.length ? checkedSkuRange.join(', ') : '';

    if (!fieldVal(form, 'segment_final')) throw new Error('2.5 Klasifikasi final SOW wajib dipilih.');
    if (!fieldVal(form, 'purchase_history_signal')) throw new Error('2.9 Riwayat pembelian brake/steering wajib dipilih.');
    if (!fieldVal(form, 'trw_shelf_presence')) throw new Error('2.11 Pengenalan TRW wajib dipilih.');
    if (!fieldVal(form, 'trw_in_stock')) throw new Error('2.12 Ketersediaan TRW di rak wajib dipilih.');
    if (!fieldVal(form, 'owner_engagement')) throw new Error('2.13 Kesediaan edukasi wajib dipilih.');
    if (!skuRangeVal) throw new Error('2.14 Range SKU relevan wajib dipilih minimal 1.');
    if (!fieldVal(form, 'purchase_frequency')) throw new Error('2.15 Frekuensi restock wajib dipilih.');
    if (!fieldVal(form, 'eligible')) throw new Error('2.16 Hasil kualifikasi wajib dipilih.');
    if (!eligible && !fieldVal(form, 'qualification_reason')) throw new Error('2.17 Alasan tidak qualified wajib diisi.');

    // POSM validations
    const posmAction = fieldVal(form, 'posm_action') || 'Tidak ada perubahan';
    const beforePhoto = formPhoto('posm_before');
    const afterPhoto = formPhoto('posm_after');
    if (posmAction !== 'Tidak ada perubahan' && (!beforePhoto || !afterPhoto)) {
      throw new Error('Ambil foto POSM Before dan After saat melakukan tindakan POSM.');
    }

    // Survey validations
    if (!fieldVal(form, 'trw_stock')) throw new Error('5.3 Ketersediaan stok TRW wajib dipilih.');
    if (!fieldVal(form, 'competitor_brand')) throw new Error('5.7 Brand pembanding utama wajib diisi.');
    if (!fieldVal(form, 'purchase_intent')) throw new Error('5.10 Minat beli TRW (skala 1-5) wajib dipilih.');

    // Collect competitor checked chips
    const checkedCompBrands = Array.from(form.querySelectorAll('input[name="comp_brand"]:checked')).map((c) => c.value);
    const freeCompBrand = fieldVal(form, 'current_brand');
    const allCompBrands = checkedCompBrands.concat(freeCompBrand ? [freeCompBrand] : []).join(', ');

    toast('Membaca lokasi GPS…');
    const geo = await getGeo();
    const outlet = state.selectedOutlet;

    if (!state.visitFlow) {
      state.visitFlow = {
        visitId: uid('VIS'),
        qualificationId: uid('QLF'),
        posmId: uid('POS'),
        educationId: uid('EDU'),
        surveyId: uid('SRV'),
        competitorId: uid('CMP'),
        outletEvidenceId: uid('EVD'),
        outletInsideEvidenceId: uid('EVD'),
        posmBeforeEvidenceId: uid('EVD'),
        posmAfterEvidenceId: uid('EVD')
      };
    }
    const ids = state.visitFlow;

    // POSM validations
    const checkedPosmTypes = Array.from(form.querySelectorAll('input[name="posm_type"]:checked')).map((c) => c.value);
    const posmTypeVal = checkedPosmTypes.length ? checkedPosmTypes.join(', ') : 'Tidak ada';

    const payload = {
      visit_id: ids.visitId,
      outlet_id: outlet.outlet_id,
      visit_type: fieldVal(form, 'visit_type') || 'Existing',
      attendance_id: state.openAttendance.attendance_id,
      visit_at: new Date().toISOString(),
      lat: geo.lat,
      lng: geo.lng,
      accuracy: geo.accuracy,
      notes: fieldVal(form, 'visit_notes'),
      status: 'SUBMITTED',
      outlet_photo: visitPhoto ? { dataUrl: visitPhoto.dataUrl, mimeType: 'image/jpeg' } : null,
      outlet_inside_photo: insidePhoto ? { dataUrl: insidePhoto.dataUrl, mimeType: 'image/jpeg' } : null,
      outlet_evidence_id: ids.outletEvidenceId,
      outlet_inside_evidence_id: ids.outletInsideEvidenceId,
      qualification: {
        qualification_id: ids.qualificationId,
        outlet_type: selectedOutletType,
        active_bays: fieldVal(form, 'active_bays'),
        brake_steering_stock_confirmed: fieldVal(form, 'trw_in_stock') === 'Ya' || checkedStockBrands.length > 0 ? 'Ya' : 'Belum diketahui',
        brake_brands_stocked: brakeBrandsStocked,
        brand_monthly_volume: brandMonthlyVolume,
        segment_final: fieldVal(form, 'segment_final'),
        brand_count: fieldVal(form, 'brand_count'),
        fastest_moving_brand: fieldVal(form, 'fastest_moving_brand'),
        fastest_moving_pct: fieldVal(form, 'fastest_moving_pct'),
        sku_count: checkedSkuRange.length || 1,
        purchase_history_signal: fieldVal(form, 'purchase_history_signal'),
        brake_categories: fieldVal(form, 'brake_categories') || 'Semua (Hydraulic, Friction, Shock Absorber)',
        owner_engagement: fieldVal(form, 'owner_engagement'),
        sku_range: skuRangeVal,
        purchase_frequency: fieldVal(form, 'purchase_frequency'),
        trw_shelf_presence: fieldVal(form, 'trw_shelf_presence'),
        trw_in_stock: fieldVal(form, 'trw_in_stock'),
        eligible: eligible,
        reason: fieldVal(form, 'qualification_reason'),
        contact_name: fieldVal(form, 'visit_contact'),
        contact_phone: fieldVal(form, 'visit_phone'),
        b2b_sales: fieldVal(form, 'b2b_sales'),
        segment_indicative: outlet.segment_indicative || ''
      },
      posm: {
        posm_id: ids.posmId,
        posm_type: posmTypeVal,
        posm_allowed: fieldVal(form, 'posm_allowed'),
        posm_location_type: fieldVal(form, 'posm_location_type'),
        condition_before: fieldVal(form, 'condition_before'),
        action: posmAction,
        condition_after: fieldVal(form, 'condition_after'),
        before_photo: beforePhoto ? { dataUrl: beforePhoto.dataUrl, mimeType: 'image/jpeg' } : null,
        after_photo: afterPhoto ? { dataUrl: afterPhoto.dataUrl, mimeType: 'image/jpeg' } : null,
        before_evidence_id: ids.posmBeforeEvidenceId,
        after_evidence_id: ids.posmAfterEvidenceId,
        owner_approval: fieldVal(form, 'owner_approval') === 'Ya',
        owner_name: fieldVal(form, 'posm_owner_name'),
        notes: fieldVal(form, 'posm_notes')
      },
      education: {
        education_id: ids.educationId,
        education_done: fieldVal(form, 'education_done') === 'Ya',
        education_type: fieldVal(form, 'education_type'),
        product_knowledge: fieldVal(form, 'product_knowledge'),
        promotion_explained: fieldVal(form, 'education_type') && fieldVal(form, 'education_type').includes('Promo') ? 'Ya' : 'Tidak',
        owner_name: fieldVal(form, 'education_owner'),
        verified: fieldVal(form, 'education_verified') === 'Ya'
      },
      survey: {
        survey_id: ids.surveyId,
        survey_done: true,
        purchase_intent: fieldVal(form, 'purchase_intent'),
        current_brand: allCompBrands || fieldVal(form, 'competitor_brand'),
        current_volume: fieldVal(form, 'current_volume'),
        trw_stock: fieldVal(form, 'trw_stock'),
        trw_price: fieldVal(form, 'trw_price'),
        trw_campaign_program: fieldVal(form, 'trw_campaign_program'),
        trw_purchase_source: fieldVal(form, 'trw_purchase_source'),
        competitor_brand: fieldVal(form, 'competitor_brand'),
        competitor_price: fieldVal(form, 'competitor_price'),
        competitor_net_program: fieldVal(form, 'competitor_net_program'),
        competitor_categories: allCompBrands,
        barrier_switching: fieldVal(form, 'barrier_switching'),
        barrier_reason: fieldVal(form, 'barrier_switching'),
        restock_frequency: fieldVal(form, 'purchase_frequency'),
        preferred_sku: skuRangeVal,
        brand_awareness: fieldVal(form, 'brand_awareness'),
        quality_perception: fieldVal(form, 'quality_perception'),
        price_perception: fieldVal(form, 'price_perception'),
        unmet_demand: fieldVal(form, 'unmet_demand'),
        insight: fieldVal(form, 'unmet_demand')
      },
      competitor: {
        competitor_id: ids.competitorId,
        category: selectedOutletType,
        sku: skuRangeVal
      }
    };

    await apiPost('saveFullVisit', payload);

    if (state.user.role === 'FM' && state.fmRoute) {
      const item = (state.fmRoute.items || []).find((i) => String(i.outlet_id) === String(outlet.outlet_id));
      if (item) {
        item.status = 'COMPLETED';
        item.visit_count = Number(item.visit_count || 0) + 1;
      }
      if (state.fmRoute.stats) {
        state.fmRoute.stats.completed = Number(state.fmRoute.stats.completed || 0) + 1;
        state.fmRoute.stats.evidence = Number(state.fmRoute.stats.evidence || 0) + 2;
      }
      metaPut('fmRoute', state.fmRoute);
    }

    state.visitFlow = null;
    state.photos = {};
    state.signatureData = '';
    state.signatureDrawn = false;
    state.signatureCapturedAt = '';
    state.inputType = '';
    state.page = 'home';
    render();
    toast('Kuesioner survey berhasil disimpan ke server.', 'ok');
    await refreshAll(false);
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

  async function attendanceAction(kind, options = {}) {
    try {
      if (kind === 'checkout' && !state.openAttendance) throw new Error('Tidak ada Check In aktif.');
      if (kind === 'checkin' && state.openAttendance) throw new Error('Anda sudah Check In. Lakukan Check Out sebelum Check In berikutnya.');
      toast(kind === 'checkin' ? 'Mengambil foto Check In…' : 'Mengambil foto Check Out…');
      const photo = await capturePhoto();
      toast('Membaca GPS…'); const geo = await getGeo();
      const at = new Date().toISOString(); const attendanceId = kind === 'checkin' ? uid('ATT') : state.openAttendance.attendance_id; const evidenceId = uid('EVD');
      const isNoo = Boolean(options && options.isNoo);
      const fmOutletId = isNoo ? 'NOO_PENDING' : (state.user.role === 'FM' ? (kind === 'checkout' ? (state.openAttendance.outlet_id || '') : (state.selectedOutlet && state.selectedOutlet.outlet_id)) : '');
      if (state.user.role === 'FM' && kind === 'checkin' && !fmOutletId && !isNoo) throw new Error('Pilih outlet dari Rencana Kunjungan atau gunakan menu NOO sebelum Check In.');
      const payload = { attendance_id: attendanceId, evidence_id: evidenceId, outlet_id: fmOutletId || (state.selectedOutlet ? state.selectedOutlet.outlet_id : ''), is_noo: isNoo, lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy, at: at, photo: { dataUrl: photo.dataUrl, mimeType: 'image/jpeg' } };
      const result = await apiPost(kind, payload);
      if (kind === 'checkin') {
        state.openAttendance = { attendance_id: attendanceId, outlet_id: payload.outlet_id || '', checkin_at: at, status: 'OPEN', user_id: state.user.user_id, pending: !!result.queued };
        await metaPut('openAttendance', state.openAttendance); localStorage.setItem(STORE.openAttendance, JSON.stringify(state.openAttendance));
        toast(result.queued ? 'Check In disimpan di perangkat, menunggu sinkronisasi.' : 'Check In berhasil. Foto dan GPS tercatat.', 'ok');
      } else {
        state.openAttendance = null; await metaDelete('openAttendance'); localStorage.removeItem(STORE.openAttendance);
        toast(result.queued ? 'Check Out disimpan di perangkat, menunggu sinkronisasi.' : 'Check Out berhasil. Foto dan GPS tercatat.', 'ok');
      }
      await refreshAll(false);
      if (state.user.role === 'FM' && result.queued) {
        const route = state.fmRoute || { date: localDate(), stats: { visits: 0, completed: 0, interactions: 0, evidence: 0 }, items: [] };
        const outletId = payload.outlet_id;
        const routeItem = (route.items || []).find((item) => String(item.outlet_id) === String(outletId));
        if (routeItem) {
          if (kind === 'checkin') { routeItem.status = 'IN_PROGRESS'; routeItem.attendance_id = attendanceId; routeItem.checkin_at = at; }
          else { routeItem.status = 'COMPLETED'; routeItem.checkout_at = at; if (!routeItem._localCompletionCounted) { route.stats.completed = Number(route.stats.completed || 0) + 1; routeItem._localCompletionCounted = true; } }
        }
        route.openAttendance = state.openAttendance;
        route.stats = route.stats || { visits: route.items.length, completed: 0, interactions: 0, evidence: 0 };
        route.stats.evidence = Number(route.stats.evidence || 0) + 1;
        state.fmRoute = route; await metaPut('fmRoute', route);
      }
      render();
    } catch (error) { showError(error); }
  }

  async function refreshAll(showToast = true) {
    if (!state.token || !state.user) return;
    try {
      if (!state.outletList || !state.outletList.length) {
        state.dashboard = await metaGet('dashboard') || state.dashboard;
        state.outletList = await metaGet('outlets') || state.outletList;
        state.reports = await metaGet('reports') || state.reports;
        state.attendance = await metaGet('attendance') || state.attendance;
        if (state.user.role === 'FM') state.fmRoute = await metaGet('fmRoute') || state.fmRoute;
        render();
      }

      if (!navigator.onLine) {
        await updateQueueState();
        render();
        return;
      }
      const requests = [apiGet('dashboard'), apiGet('outlets', { limit: 500 }), apiGet('reports', { limit: 100 }), apiGet('attendance')];
      if (state.user.role === 'FM') requests.push(apiGet('fmRoute'));
      if (['ADMIN','PM','TL'].includes(state.user.role)) {
        requests.push(apiGet(state.user.role === 'ADMIN' ? 'users' : 'team').catch(() => ({ items: [] })));
        requests.push(apiGet('beatPlan').catch(() => ({ items: [] })));
      }
      const results = await Promise.all(requests);
      const dashboard = results[0], outlets = results[1], reports = results[2], attendance = results[3];
      const fmRoute = state.user.role === 'FM' ? results[4] : null;

      if (['ADMIN','PM','TL'].includes(state.user.role)) {
        const uIdx = state.user.role === 'FM' ? 5 : 4;
        const bIdx = state.user.role === 'FM' ? 6 : 5;
        if (results[uIdx] && results[uIdx].items) { state.users = results[uIdx].items; await metaPut('users', state.users); }
        if (results[bIdx] && results[bIdx].items) { state.beatPlan = results[bIdx].items; await metaPut('beatPlan', state.beatPlan); }
      }

      await Promise.all([metaPut('dashboard', dashboard), metaPut('outlets', outlets.items || []), metaPut('reports', reports), metaPut('attendance', attendance)]);
      if (fmRoute) await metaPut('fmRoute', fmRoute);
      state.dashboard = dashboard; state.outletList = outlets.items || []; state.reports = reports; state.attendance = attendance;
      if (fmRoute) state.fmRoute = fmRoute;
      const queue = await queueAll();
      const pendingCheckouts = new Set(queue.filter((i) => i.action === 'checkout').map((i) => i.payload.attendance_id));
      const pendingCheckins = queue.filter((i) => i.action === 'checkin').slice(-1)[0];
      let open = attendance.openAttendance || null;
      if (open && pendingCheckouts.has(open.attendance_id)) open = null;
      if (!open && pendingCheckins && !pendingCheckouts.has(pendingCheckins.payload.attendance_id)) open = { attendance_id: pendingCheckins.payload.attendance_id, outlet_id: pendingCheckins.payload.outlet_id || '', checkin_at: pendingCheckins.payload.at, status: 'OPEN', user_id: state.user.user_id, pending: true };
      if (!open) {
        const localOpen = readJson(localStorage.getItem(STORE.openAttendance), null);
        if (localOpen && localOpen.user_id === state.user.user_id && !pendingCheckouts.has(localOpen.attendance_id)) open = localOpen;
      }
      state.openAttendance = open;
      if (open) { localStorage.setItem(STORE.openAttendance, JSON.stringify(open)); await metaPut('openAttendance', open); }
      else { localStorage.removeItem(STORE.openAttendance); await metaDelete('openAttendance'); }
      if (showToast) toast('Data terbaru berhasil dimuat.', 'ok');
      render();
    } catch (error) {
      if (/Sesi berakhir|Sesi tidak ditemukan|Akun tidak aktif/i.test(error.message || '')) { signOutLocal(); toast('Sesi berakhir. Login kembali.', 'bad'); }
      else if (showToast) showError(error);
      render();
    }
  }

  function signOutLocal() {
    state.clientExportRange = null;
    stopFmLocationTracking(); state.token = ''; state.user = null; localStorage.removeItem(STORE.token); localStorage.removeItem(STORE.user); state.page = 'home'; state.openAttendance = readJson(localStorage.getItem(STORE.openAttendance), null); render(); }
  async function loginSubmit(form) {
    const username = fieldVal(form, 'username');
    const password = fieldVal(form, 'password');

    // Login via GET + fetch(credentials:'omit'): fast, no cookies, works everywhere
    const result = await apiGet('login', { username: username, password: password }, { timeout: 15000 });

    if (!result || !result.token || !result.user) throw new Error('Respons login tidak valid. Pastikan Code.gs dan deployment sudah diperbarui.');
    state.token = result.token; state.user = result.user; state.page = 'home';
    localStorage.setItem(STORE.token, state.token); localStorage.setItem(STORE.user, JSON.stringify(state.user));
    toast('Login berhasil. Memuat data di latar belakang…', 'ok');
    if (state.user.role === 'FM') startFmLocationTracking();
    render();
    updateQueueState().catch(() => {});
    refreshAll(false).catch((error) => {
      console.warn('Background refresh failed:', error);
      toast('Anda sudah login. Sebagian data belum termuat; coba Muat Ulang Data.', 'bad');
    });
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadCSV(filename, headers, rows) {
    const lines = [headers].concat(rows).map((row) => row.map((value) => {
      let text = value == null ? '' : String(value);
      if (/^[=+@\-]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g,'""') + '"';
    }).join(','));
    downloadBlob(filename, new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
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

  async function exportClientReport(form) {
    if (state.user?.role !== 'CLIENT') throw new Error('Ekspor ini tersedia untuk akun Client.');
    const token = state.token;
    const from = fieldVal(form, 'from');
    const to = fieldVal(form, 'to');
    state.clientExportRange = { from, to };
    if (!from || !to) throw new Error('Isi tanggal mulai dan tanggal akhir.');
    if (from > to) throw new Error('Tanggal akhir harus sama dengan atau setelah tanggal mulai.');
    if (!navigator.onLine) throw new Error('Sambungkan ke internet untuk mengunduh laporan.');
    if (!window.TRWClientReport) throw new Error('Pembuat laporan belum dimuat. Muat ulang aplikasi.');
    const data = await apiGet('exportClientSurvey', { from, to }, { timeout: 45000 });
    if (state.token !== token) return;
    if (!data.visits.length) throw new Error('Tidak ada kunjungan FM pada rentang tanggal ini.');
    const workbook = await window.TRWClientReport.build(data);
    if (state.token !== token) return;
    downloadBlob('TRW_Laporan_Survei_FM_' + from + '_sd_' + to + '.xlsx', workbook);
    toast('Laporan Excel siap diunduh.', 'ok');
  }

  async function handleSubmit(event) {
    const form = event.target.closest('form[data-form]'); if (!form) return;
    event.preventDefault(); if (form.dataset.busy === '1') return;
    const type = form.dataset.form;
    const isClientExport = type === 'exportClient';
    if (isClientExport && state.clientExporting) return;
    if (isClientExport) state.clientExporting = true;
    setBusy(form, true, isClientExport ? 'Menyiapkan Excel…' : undefined);
    try {
      if (type === 'login') await loginSubmit(form);
      else if (isClientExport) await exportClientReport(form);
      else if (type === 'visit') await submitVisitForm(form);
      else if (type === 'activation') await submitActivationForm(form);
      else if (type === 'interaction') await submitInteractionForm(form);
      else if (type === 'issue') await submitIssueForm(form);
      else if (type === 'createUser') {
        await apiPost('createUser',{full_name:fieldVal(form,'user_full_name'),username:fieldVal(form,'user_username'),role:fieldVal(form,'user_role'),phone:fieldVal(form,'user_phone'),password:fieldVal(form,'user_password'),user_id:uid('USR')},{allowQueue:false});
        form.reset(); await loadUsers(); toast('Akun baru berhasil dibuat. Berikan password awal melalui kanal aman.','ok'); render();
      } else if (type === 'nooOutlet') {
        const outletId = uid('OUT');
        const newOutlet = {
          outlet_id: outletId,
          outlet_name: fieldVal(form, 'noo_outlet_name'),
          city: fieldVal(form, 'noo_city'),
          area: fieldVal(form, 'noo_area'),
          address: fieldVal(form, 'noo_address'),
          type: fieldVal(form, 'noo_type'),
          segment_final: fieldVal(form, 'noo_segment'),
          priority: fieldVal(form, 'noo_priority') || 'P1',
          contact_name: fieldVal(form, 'noo_contact'),
          contact_phone: fieldVal(form, 'noo_phone'),
          is_prospect: false,
          is_noo: true,
          status: 'PROSPECT'
        };

        if (!newOutlet.outlet_name || !newOutlet.city || !newOutlet.address || !newOutlet.contact_name) {
          throw new Error('Mohon lengkapi nama outlet, kota, alamat, dan nama PIC.');
        }

        await apiPost('createOutlet', Object.assign({}, newOutlet, { is_noo: true }), { allowQueue: false });
        state.outletList.unshift(newOutlet);
        await metaPut('outlets', state.outletList);

        if (state.openAttendance) {
          state.openAttendance.outlet_id = outletId;
          await metaPut('openAttendance', state.openAttendance);
          localStorage.setItem(STORE.openAttendance, JSON.stringify(state.openAttendance));
        }

        if (state.fmRoute) {
          state.fmRoute.items = state.fmRoute.items || [];
          state.fmRoute.items.unshift({
            outlet_id: outletId,
            outlet_name: newOutlet.outlet_name,
            city: newOutlet.city,
            area: newOutlet.area,
            address: newOutlet.address,
            type: newOutlet.type,
            segment_final: newOutlet.segment_final,
            priority: newOutlet.priority,
            status: 'IN_PROGRESS',
            sequence: 1,
            checkin_at: state.openAttendance ? state.openAttendance.checkin_at : new Date().toISOString()
          });
          state.fmRoute.stats = state.fmRoute.stats || { visits: 0, completed: 0, interactions: 0, evidence: 0 };
          state.fmRoute.stats.visits = state.fmRoute.items.length;
          await metaPut('fmRoute', state.fmRoute);
        }

        state.selectedOutlet = newOutlet;
        state.inputType = 'visit';
        state.page = 'input';
        toast('Outlet NOO ' + newOutlet.outlet_name + ' berhasil didaftarkan! Melanjutkan ke survey...', 'ok');
        render();
      } else if (type === 'createOutlet') {
        await apiPost('createOutlet',{outlet_id:uid('OUT'),outlet_name:fieldVal(form,'new_outlet_name'),city:fieldVal(form,'new_outlet_city'),area:fieldVal(form,'new_outlet_area'),address:fieldVal(form,'new_outlet_address'),type:fieldVal(form,'new_outlet_type'),segment_final:fieldVal(form,'new_outlet_segment'),priority:fieldVal(form,'new_outlet_priority'),contact_name:fieldVal(form,'new_outlet_contact'),contact_phone:fieldVal(form,'new_outlet_phone')},{allowQueue:false});
        await refreshAll(false); state.page='outlets'; toast('Outlet berhasil ditambahkan.','ok'); render();
      } else if (type === 'beatPlan') {
        const checked = Array.from(form.querySelectorAll('input[name="beat_outlet_ids"]:checked')).map((c) => c.value);
        if (!checked.length) throw new Error('Pilih minimal 1 outlet (maksimal 20 outlet sekaligus).');
        if (checked.length > 20) throw new Error('Maksimal 20 outlet per penugasan rute sekaligus. Anda memilih ' + checked.length + ' outlet.');
        
        await apiPost('saveBeatPlan', {
          date: fieldVal(form, 'beat_date'),
          week: fieldVal(form, 'beat_week'),
          user_id: fieldVal(form, 'beat_user'),
          outlet_ids: checked,
          sequence: 1,
          notes: fieldVal(form, 'beat_notes'),
          status: 'PLANNED',
          planned: true
        }, { allowQueue: false });
        
        form.reset();
        await loadBeatPlan();
        toast('Berhasil menetapkan ' + checked.length + ' outlet untuk rencana kunjungan FM!', 'ok');
        render();
      }
    } catch (error) {
      if (form.isConnected) {
        const feedback = document.createElement('p');
        feedback.className = 'form-feedback notice error';
        feedback.setAttribute('role', 'alert');
        feedback.textContent = error.message || 'Terjadi kesalahan.';
        const actions = form.querySelector('.form-actions');
        if (actions) actions.before(feedback);
        else form.append(feedback);
        if (type !== 'login' && !isClientExport) showError(error);
      } else showError(error);
    } finally {
      setBusy(form, false);
      if (isClientExport) {
        state.clientExporting = false;
        const current = $('form[data-form="exportClient"]');
        if (current && current !== form) {
          setBusy(current, false);
          $('button[type="submit"]', current).textContent = 'Unduh Excel (.xlsx)';
        }
      }
    }
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
    if (state.user.role === 'FM' && (!state.openAttendance || String(state.openAttendance.outlet_id || '') !== String(id))) { toast('FM hanya dapat membuka input pada outlet yang sedang di-Check In. Mulai dari Rencana Kunjungan.', 'bad'); return; }
    state.selectedOutlet = item;
    state.visitFlow = null; state.activationFlow = null; state.photos = {}; state.signatureData = ''; state.signatureDrawn = false; state.signatureCapturedAt = '';
    state.lastActivationId = '';
    state.inputType = state.user.role === 'SPG' ? (item.is_qualified || String(item.status).toUpperCase() === 'QUALIFIED' ? 'activation' : '') : 'visit';
    state.page = 'input';
    if (state.user.role === 'SPG' && !state.inputType) toast('Outlet belum qualified. SPG hanya dapat aktivasi di outlet qualified.', 'bad');
    render();
  }
  function showDialog(title, content, actionLabel) {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';
    dialog.setAttribute('aria-labelledby', 'dialog-title');
    dialog.innerHTML = '<h2 id="dialog-title">' + esc(title) + '</h2><form method="dialog">' + content +
      '<div class="form-actions"><button type="button" class="btn btn-plain" value="cancel">Batal</button>' +
      '<button type="submit" class="btn btn-primary" value="confirm">' + esc(actionLabel) + '</button></div></form>';
    const form = dialog.querySelector('form');
    const cancel = form.querySelector('[value="cancel"]');
    (form.querySelector('input') || cancel).autofocus = true;
    document.body.append(dialog);
    return new Promise((resolve) => {
      const finish = (result) => {
        dialog.close();
        dialog.remove();
        resolve(result);
      };
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        finish(new FormData(form));
      });
      cancel.addEventListener('click', () => finish(null));
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        finish(null);
      });
      dialog.showModal();
    });
  }

  async function changePasswordPrompt() {
    const result = await showDialog('Ganti password',
      field('current_password', 'Password saat ini', 'password', { required: true, autocomplete: 'current-password' }) +
      field('new_password', 'Password baru', 'password', { required: true, minLength: 8, autocomplete: 'new-password', hint: 'Minimal 8 karakter.' }) +
      field('confirm_password', 'Ulangi password baru', 'password', { required: true, autocomplete: 'new-password' }), 'Simpan password');
    if (!result) return;
    const next = result.get('new_password');
    if (next !== result.get('confirm_password')) {
      toast('Konfirmasi password tidak sama.', 'bad');
      return;
    }
    await apiPost('changePassword', { current_password: result.get('current_password'), new_password: next }, { allowQueue: false });
    toast('Password berhasil diganti.', 'ok');
  }

  function confirmAction(title, message, action) {
    return showDialog(title, '<p class="muted">' + esc(message) + '</p>', action);
  }

  function setMultiSelectOpen(trigger, open) {
    const menu = document.getElementById(trigger.getAttribute('aria-controls'));
    if (!menu) return;
    menu.style.display = open ? 'flex' : 'none';
    trigger.classList.toggle('is-active', open);
    trigger.setAttribute('aria-expanded', String(open));
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
      if (act === 'nav') {
        state.page = button.dataset.page || 'home';
        state.drawerOpen = false;
        if (state.page === 'input') state.inputType = '';
        // Navigation must never wait for the network. Paint the requested page first,
        // then refresh only the data that page needs in the background.
        render();
        const destination = state.page;
        if (destination === 'createOutlet') loadCurrentPageData();
        if (['outlets', 'reports', 'users', 'beatplan'].includes(destination)) {
          const currentView = $('.wrap');
          loadCurrentPageData().then(() => {
            if (state.page === destination && currentView?.isConnected &&
                (!currentView.contains(document.activeElement) || document.activeElement === $('h1', currentView)) &&
                !currentView.querySelector('form[data-edited]')) render();
          });
        }
      }
      else if (act === 'toggle-sidebar') {
        state.sidebarCollapsed = !state.sidebarCollapsed;
        localStorage.setItem('trw_sidebar_collapsed', state.sidebarCollapsed ? '1' : '0');
        updateNavigation();
        currentLeafletMap?.invalidateSize();
      }
      else if (act === 'toggle-drawer') {
        setDrawer(!state.drawerOpen);
      }
      else if (act === 'close-drawer') {
        setDrawer(false);
      }
      else if (act === 'refresh') await refreshAll(true);
      else if (act === 'refresh-reports') { await loadReports(); render(); toast('Laporan diperbarui.','ok'); }
      else if (act === 'refresh-users') { await loadUsers(); render(); }
      else if (act === 'toggle-ms') {
        const open = button.getAttribute('aria-expanded') !== 'true';
        $$('.ms-trigger[aria-expanded="true"]').forEach((trigger) => setMultiSelectOpen(trigger, false));
        if (open) {
          setMultiSelectOpen(button, true);
          if (event.detail === 0) $('#menu-' + button.dataset.target + ' input')?.focus();
        }
      }
      else if (act === 'close-ms') {
        const trigger = $('#trigger-' + button.dataset.target);
        if (trigger) {
          setMultiSelectOpen(trigger, false);
          trigger.focus();
        }
      }
      else if (act === 'ms-clear') {
        const targetId = button.dataset.target;
        const container = document.getElementById('container-' + targetId);
        if (!container) return;
        container.querySelectorAll('input[type="checkbox"]').forEach(c => { c.checked = false; });
        const form = container.closest('form');
        if (form) form.dispatchEvent(new Event('change', { bubbles: true }));
      }
      else if (act === 'ms-select-all') {
        const targetId = button.dataset.target;
        const container = document.getElementById('container-' + targetId);
        if (!container) return;
        container.querySelectorAll('.ms-item-row').forEach(row => {
          if (row.style.display !== 'none') {
            const cb = row.querySelector('input[type="checkbox"]');
            if (cb && cb.value !== 'Tidak ada' && cb.value !== 'Belum diketahui') cb.checked = true;
          }
        });
        const form = container.closest('form');
        if (form) form.dispatchEvent(new Event('change', { bubbles: true }));
      }
      else if (act === 'beat-select-20') {
        const form = document.querySelector('form[data-form="beatPlan"]');
        if (!form) return;
        const visibleRows = Array.from(form.querySelectorAll('.beat-outlet-row')).filter(r => r.style.display !== 'none');
        form.querySelectorAll('input[name="beat_outlet_ids"]').forEach(c => {
          c.checked = false;
          const r = c.closest('.beat-outlet-row');
          if (r) r.classList.remove('is-selected');
        });
        const toCheck = visibleRows.slice(0, 20);
        toCheck.forEach(r => {
          const cb = r.querySelector('input[name="beat_outlet_ids"]');
          if (cb) {
            cb.checked = true;
            r.classList.add('is-selected');
          }
        });
        const badge = document.getElementById('beat-counter-tag');
        if (badge) {
          badge.textContent = toCheck.length + ' / 20 Outlet Terpilih';
          badge.className = 'tag green beat-counter-tag';
        }
        toast(toCheck.length + ' outlet berhasil dipilih.', 'ok');
      }
      else if (act === 'beat-clear-selection') {
        const form = document.querySelector('form[data-form="beatPlan"]');
        if (!form) return;
        form.querySelectorAll('input[name="beat_outlet_ids"]').forEach(c => {
          c.checked = false;
          const r = c.closest('.beat-outlet-row');
          if (r) r.classList.remove('is-selected');
        });
        const badge = document.getElementById('beat-counter-tag');
        if (badge) {
          badge.textContent = '0 / 20 Outlet Terpilih';
          badge.className = 'tag yellow beat-counter-tag';
        }
        toast('Pilihan outlet dikosongkan.', 'ok');
      }
      else if (act === 'refresh-beats') { await loadBeatPlan(); render(); }
      else if (act === 'checkin') await attendanceAction('checkin');
      else if (act === 'checkout') await attendanceAction('checkout');
      else if (act === 'sync') await syncQueue();
      else if (act === 'logout') {
        const open = state.openAttendance;
        if (open && !await confirmAction('Keluar dari aplikasi?', 'Kehadiran Anda tetap aktif sampai Anda melakukan Check Out.', 'Keluar')) return;
        try { await apiGet('logout').catch(() => apiPost('logout',{}, {allowQueue:false})); } catch (_) {}
        signOutLocal(); toast('Logout aplikasi berhasil.','ok');
      }
      else if (act === 'search-outlets') {
        event.preventDefault();
        state.outletQuery = $('#outlet-search') ? $('#outlet-search').value : '';
        render();
        if (navigator.onLine) {
          loadOutlets().then(() => render()).catch((error) => { toast(error.message || 'Outlet gagal dimuat.', 'bad'); render(); });
        }
      }
      else if (act === 'outlet-filter') { state.outletFilter = button.dataset.filter || 'all'; render(); }
      else if (act === 'map-filter') {
        currentMapFilter = button.dataset.filter || 'all';
        initDashboardMap();
        const chips = document.querySelectorAll('[data-act="map-filter"]');
        chips.forEach((c) => {
          const active = c.dataset.filter === currentMapFilter;
          c.classList.toggle('active', active);
          c.setAttribute('aria-pressed', String(active));
        });
      }
      else if (act === 'choose-outlet') selectOutlet(button.dataset.id);
      else if (act === 'start-noo') {
        if (!state.openAttendance) {
          if (!await confirmAction('Check In di outlet baru', 'Pendaftaran outlet baru (NOO) membutuhkan foto dan GPS di lokasi outlet.', 'Lanjut Check In')) return;
          await attendanceAction('checkin', { isNoo: true });
          if (state.openAttendance) {
            state.page = 'nooForm';
            render();
          }
        } else {
          state.page = 'nooForm';
          render();
        }
      }
      else if (act === 'fm-checkin') {
        const id = button.dataset.outlet || '';
        const routeItem = (state.fmRoute && state.fmRoute.items || []).find((item) => String(item.outlet_id) === String(id));
        if (!routeItem) throw new Error('Outlet tidak ditemukan dalam rencana kunjungan hari ini.');
        if (state.openAttendance) throw new Error('Selesaikan Check Out outlet yang sedang aktif terlebih dahulu.');
        state.selectedOutlet = state.outletList.find((outlet) => String(outlet.outlet_id) === String(id)) || routeItem;
        state.visitFlow = null; state.photos = {}; state.signatureData = ''; state.signatureDrawn = false;
        await attendanceAction('checkin');
      }
      else if (act === 'fm-checkout') {
        const id = button.dataset.outlet || (state.openAttendance && state.openAttendance.outlet_id) || '';
        if (!state.openAttendance || String(state.openAttendance.outlet_id || '') !== String(id)) throw new Error('Check In aktif untuk outlet ini tidak ditemukan.');
        state.selectedOutlet = state.outletList.find((outlet) => String(outlet.outlet_id) === String(id)) || state.selectedOutlet;
        await attendanceAction('checkout');
      }
      else if (act === 'fm-input') {
        const id = button.dataset.outlet || '';
        if (!state.openAttendance || String(state.openAttendance.outlet_id || '') !== String(id)) throw new Error('Lakukan Check In pada outlet yang ditugaskan terlebih dahulu.');
        state.selectedOutlet = state.outletList.find((outlet) => String(outlet.outlet_id) === String(id)) || (state.fmRoute && state.fmRoute.items || []).find((item) => String(item.outlet_id) === String(id)) || null;
        state.page = 'input'; state.inputType = ''; render();
      }
      else if (act === 'clear-signature') { state.signatureData=''; state.signatureDrawn=false; state.signatureCapturedAt=''; const canvas=$('#owner-signature'); if(canvas){const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);} const status=$('#signature-status'); if(status) status.textContent='Belum ditandatangani.'; }
      else if (act === 'clear-outlet') { state.selectedOutlet=null; state.inputType=''; state.visitFlow=null; state.activationFlow=null; state.photos={}; state.signatureData=''; state.signatureDrawn=false; state.signatureCapturedAt=''; state.lastActivationId=''; state.page='outlets'; render(); }
      else if (act === 'start-input') { state.inputType = state.user.role === 'SPG' ? 'activation' : 'visit'; state.page='input'; render(); }
      else if (act === 'select-form') { state.inputType = button.dataset.formType || ''; state.page='input'; render(); }
      else if (act === 'report-tab') { state.periodTab=button.dataset.tab; render(); }
      else if (act === 'report-list-tab') { state.reportTab=button.dataset.tab; render(); }
      else if (act === 'export-summary') exportSummary(button.dataset.period || 'daily');
      else if (act === 'export-records') await exportRecords();
      else if (act === 'change-password') await changePasswordPrompt();
      else if (act === 'toggle-user') {
        const active = button.dataset.active === 'true';
        const action = active ? 'Aktifkan' : 'Nonaktifkan';
        if (!await confirmAction(action + ' akun ini?', button.closest('tr').querySelector('strong').textContent, action)) return;
        await apiPost('setUserActive', { user_id: button.dataset.id, active }, { allowQueue: false });
        await loadUsers();
        render();
        toast('Status akun diperbarui.', 'ok');
      }
      else if (act === 'reset-password') {
        const result = await showDialog('Reset password', field('reset_password', 'Password baru', 'password', {
          required: true, minLength: 8, autocomplete: 'new-password', hint: 'Minimal 8 karakter.'
        }), 'Reset password');
        if (!result) return;
        await apiPost('resetUserPassword', { user_id: button.dataset.id, new_password: result.get('reset_password') }, { allowQueue: false });
        toast('Password direset. Berikan melalui kanal aman.', 'ok');
      }
    } catch (error) { showError(error); }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.ms-dropdown-container')) {
      $$('.ms-trigger[aria-expanded="true"]').forEach((trigger) => setMultiSelectOpen(trigger, false));
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' && state.drawerOpen && tabletNavigation.matches && !$('.modal[open]')) {
      const buttons = $$('.app-sidebar button:not(:disabled)').filter((button) => button.getClientRects().length);
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    if (event.key !== 'Escape' || $('.modal[open]')) return;
    if (state.drawerOpen && tabletNavigation.matches) {
      setDrawer(false);
      return;
    }
    const trigger = $('.ms-trigger[aria-expanded="true"]');
    if (trigger) {
      setMultiSelectOpen(trigger, false);
      trigger.focus();
    }
  });

  // Filter multi-select search input
  document.addEventListener('input', (e) => {
    const form = e.target.closest('form[data-form]');
    if (form) {
      form.dataset.edited = 'true';
      form.querySelector('.form-feedback')?.remove();
      if (form.dataset.form === 'exportClient') {
        state.clientExportRange = { from: fieldVal(form, 'from'), to: fieldVal(form, 'to') };
      }
    }
    if (e.target && e.target.classList.contains('ms-search-input')) {
      const targetId = e.target.dataset.msSearch;
      const list = document.getElementById('list-' + targetId);
      if (!list) return;
      const q = e.target.value.trim().toLowerCase();
      const rows = list.querySelectorAll('.ms-item-row');
      rows.forEach(r => {
        const match = !q || (r.dataset.search && r.dataset.search.includes(q));
        r.style.display = match ? 'flex' : 'none';
      });
      // Handle group headers
      list.querySelectorAll('.ms-group-header').forEach(h => {
        let next = h.nextElementSibling;
        let anyVisible = false;
        while (next && next.classList.contains('ms-item-row')) {
          if (next.style.display !== 'none') { anyVisible = true; break; }
          next = next.nextElementSibling;
        }
        h.style.display = anyVisible ? 'block' : 'none';
      });
    }
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
      if (state.user.role === 'FM') startFmLocationTracking();
      try { await refreshAll(false); }
      catch (_) { render(); }
    } else render();
  }
  init();
})();
