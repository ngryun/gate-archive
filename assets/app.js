(() => {
  'use strict';

  const C = window.GATE_CONFIG;
  const DEMO = !C.FIREBASE;
  const CACHE_KEY = DEMO ? 'gate-demo-cache-v3' : 'gate-items-v3';
  const ALL = '전체';

  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const split = (s) => String(s || '').split(',').map((t) => t.trim()).filter(Boolean);
  const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join('');
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
  const safeImg = (u) => (/^(data:image\/(png|jpe?g|webp);base64,|https:\/\/)/i.test(u || '') ? u : '');

  // 대표 이미지가 없으면 WordPress mShots(무료)로 웹앱 첫 화면을 찍어 씁니다.
  // 처음 요청하면 10~20초 동안 'Generating Preview' 대체 이미지(400×300)를 주므로, 진짜 화면(640×400)이 올 때까지 다시 불러옵니다.
  const AUTO_W = 640;
  const autoThumb = (url) => `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=${AUTO_W}&h=400&vpw=1280&vph=800`;
  const isAutoReady = (img) => img.naturalWidth >= AUTO_W;
  function retryAuto(img, onGiveUp) {
    const n = Number(img.dataset.tries || 0) + 1;
    if (n > 10) return onGiveUp();
    img.dataset.tries = n;
    setTimeout(() => { if (img.isConnected || img.dataset.offscreen) img.src = img.src.replace(/&n=\d+$/, '') + '&n=' + n; }, 4000);
  }
  const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 불가 환경 · 용량 초과 */ } },
  };

  // 비밀번호는 자료 ID와 섞어 해시로만 보냅니다. 원래 비밀번호는 어디에도 저장되지 않습니다.
  async function hashPassword(id, password) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`gate:${id}:${password}`));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /* ───────── 저장소 ─────────
   * Firestore 'items' 컬렉션에 웹앱 한 건이 문서 하나입니다.
   * 브라우저에 지난 목록을 저장해 두고, 다음 방문 때는 그 뒤에 바뀐 문서만 받아 옵니다(읽기 횟수 절약).
   * 그래서 삭제도 문서를 지우지 않고 deleted 표시만 남깁니다.
   */

  const FirebaseApi = {
    async init() {
      const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
      const [appMod, fs, au] = await Promise.all([
        import(SDK + 'firebase-app.js'), import(SDK + 'firebase-firestore.js'), import(SDK + 'firebase-auth.js'),
      ]);
      const app = appMod.initializeApp(C.FIREBASE);
      Object.assign(this, { fs, au, db: fs.getFirestore(app), auth: au.getAuth(app) });
    },

    async sync() {
      const { fs, db } = this;
      const cache = store.get(CACHE_KEY, null) || { since: 0, items: {} };
      const col = fs.collection(db, 'items');
      const q = cache.since ? fs.query(col, fs.where('updatedAt', '>', fs.Timestamp.fromMillis(cache.since))) : col;
      const snap = await fs.getDocs(q);
      snap.forEach((d) => {
        const x = d.data();
        const updatedAt = x.updatedAt?.toMillis() || 0;
        cache.since = Math.max(cache.since, updatedAt);
        if (x.deleted) delete cache.items[d.id];
        else cache.items[d.id] = { ...x, id: d.id, createdAt: x.createdAt?.toMillis() || 0, updatedAt };
      });
      store.set(CACHE_KEY, cache);
      return Object.values(cache.items);
    },

    onAuth(cb) {
      this.au.onAuthStateChanged(this.auth, async (user) => {
        if (!user) return cb(null);
        const { fs, db } = this;
        const ok = await fs.getDoc(fs.doc(db, 'admins', user.email)).then((d) => d.exists(), () => false);
        if (!ok) {
          await this.au.signOut(this.auth);
          return cb(null, `${user.email} 은(는) 등록된 관리자 계정이 아닙니다. 연구회 관리자에게 등록을 요청하세요.`);
        }
        cb({ name: user.displayName || user.email, email: user.email });
      });
    },

    async signIn() {
      try {
        await this.au.signInWithPopup(this.auth, new this.au.GoogleAuthProvider());
      } catch (ex) {
        if (/popup-closed|cancelled-popup/.test(ex.code)) return;
        if (ex.code === 'auth/popup-blocked') throw new Error('로그인 창(팝업)이 차단되었습니다. 주소창 오른쪽의 팝업 차단 표시에서 허용한 뒤 다시 눌러 주세요.');
        if (ex.code === 'auth/unauthorized-domain') throw new Error('이 사이트 주소가 Firebase 승인된 도메인에 없습니다.');
        throw ex;
      }
    },

    signOut() { return this.au.signOut(this.auth); },

    // 관리자는 비밀번호 없이, 일반 등록자는 비밀번호 해시를 함께 씁니다.
    async create(fields, password, admin, code) {
      const { fs, db } = this;
      const id = newId();
      const now = fs.serverTimestamp();
      const batch = fs.writeBatch(db);
      batch.set(fs.doc(db, 'items', id), { ...fields, createdAt: now, updatedAt: now, createdBy: admin ? admin.email : '', deleted: false });
      if (!admin) batch.set(fs.doc(db, 'secrets', id), { h: await hashPassword(id, password), t: now, code });
      await batch.commit();
    },

    async update(id, fields, password, admin) {
      const { fs, db } = this;
      const batch = await this.proofBatch(id, password, admin);
      batch.set(fs.doc(db, 'items', id), { ...fields, updatedAt: fs.serverTimestamp(), deleted: false }, { merge: true });
      await batch.commit();
    },

    async remove(id, password, admin) {
      const { fs, db } = this;
      const batch = await this.proofBatch(id, password, admin);
      batch.set(fs.doc(db, 'items', id), { deleted: true, updatedAt: fs.serverTimestamp() });
      await batch.commit();
    },

    async proofBatch(id, password, admin) {
      const { fs, db } = this;
      const batch = fs.writeBatch(db);
      if (!admin) batch.set(fs.doc(db, 'proofs', id), { h: await hashPassword(id, password), t: fs.serverTimestamp() });
      return batch;
    },
  };

  // FIREBASE 설정이 없을 때 쓰는 브라우저 안 가짜 저장소 (미리보기용). 보안 규칙과 같은 판단을 흉내 냅니다.
  const DemoApi = {
    sessionKey: 'gate-demo-session',
    secretKey: 'gate-demo-secrets',
    async init() {},
    async sync() {
      await wait(200);
      const cache = store.get(CACHE_KEY, null) || { items: Object.fromEntries(SAMPLE_ITEMS().map((x) => [x.id, x])) };
      store.set(CACHE_KEY, cache);
      return Object.values(cache.items);
    },
    onAuth(cb) { this.cb = cb; cb(store.get(this.sessionKey, null)); },
    async signIn() { const s = { name: '데모 관리자', email: 'demo@example.com' }; store.set(this.sessionKey, s); this.cb(s); },
    async signOut() { store.set(this.sessionKey, null); this.cb(null); },
    edit(fn) { const cache = store.get(CACHE_KEY, { items: {} }); fn(cache.items); store.set(CACHE_KEY, cache); },
    async check(id, password, admin) {
      await wait(200);
      const item = store.get(CACHE_KEY, { items: {} }).items[id];
      const secret = store.get(this.secretKey, {})[id];
      if (admin) return;
      if (!item || item.createdBy || !secret || secret !== await hashPassword(id, password)) throw Object.assign(new Error(), { code: 'permission-denied' });
    },
    async create(fields, password, admin, code) {
      await wait(200);
      if (!admin && code !== 'GATE') throw Object.assign(new Error(), { code: 'permission-denied' });
      const id = newId();
      const now = Date.now();
      if (!admin) store.set(this.secretKey, { ...store.get(this.secretKey, {}), [id]: await hashPassword(id, password) });
      this.edit((items) => { items[id] = { ...fields, id, createdAt: now, updatedAt: now, createdBy: admin ? admin.email : '', deleted: false }; });
    },
    async update(id, fields, password, admin) {
      await this.check(id, password, admin);
      this.edit((items) => { items[id] = { ...items[id], ...fields, updatedAt: Date.now() }; });
    },
    async remove(id, password, admin) {
      await this.check(id, password, admin);
      this.edit((items) => { delete items[id]; });
    },
  };

  const api = DEMO ? DemoApi : FirebaseApi;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ───────── 상태 ───────── */

  const state = { items: [], loaded: false, cat: ALL, target: ALL, q: '', session: null };
  const catOf = (key) => C.CATEGORIES.find((c) => c.key === key) || { key: key || '기타', color: '#6b6875' };
  const byNewest = (a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
  const canEdit = (item) => !!state.session || !item.createdBy;

  async function refresh() {
    state.items = (await api.sync()).sort(byNewest);
    state.loaded = true;
    render();
  }

  /* ───────── 그리기 ───────── */

  function matches(item, { cat = state.cat, target = state.target, q = state.q } = {}) {
    if (cat !== ALL && item.category !== cat) return false;
    if (target !== ALL && !split(item.target).includes(target)) return false;
    if (q) {
      const hay = [item.title, item.description, item.tags, item.author, item.category, item.target, item.prompt].join(' ').toLowerCase();
      return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
    }
    return true;
  }

  function renderChips() {
    const chip = (label, active, count, color, data) =>
      `<button type="button" class="chip" aria-pressed="${active}" ${color ? `style="--c:${color}"` : ''} ${data}>` +
      `${color ? '<span class="dot"></span>' : ''}${esc(label)}<span class="n">${count}</span></button>`;

    $('#categoryChips').innerHTML = [{ key: ALL }, ...C.CATEGORIES].map((c) => {
      const n = state.items.filter((it) => matches(it, { cat: c.key })).length;
      return chip(c.key, state.cat === c.key, n, c.color, `data-cat="${esc(c.key)}"`);
    }).join('');

    $('#targetChips').innerHTML = '<span class="chip-label">대상</span>' + [ALL, ...C.TARGETS].map((t) => {
      const n = state.items.filter((it) => matches(it, { target: t })).length;
      return chip(t, state.target === t, n, '', `data-target="${esc(t)}"`);
    }).join('');
  }

  function thumbHtml(item, label) {
    const own = safeImg(item.thumb);
    const url = safeUrl(item.url);
    const img = own || (url ? autoThumb(url) : '');
    return (img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"${own ? '' : ' data-auto="1"'}>` : '') +
      `<span class="ph"><span>${esc(label)}</span></span>`;
  }

  function card(item) {
    const cat = catOf(item.category);
    const url = safeUrl(item.url);
    const admin = state.session
      ? `<span class="admin-tools"><button class="btn btn-line btn-sm" data-edit="${esc(item.id)}">수정</button>` +
        `<button class="btn btn-line btn-sm btn-danger" data-del="${esc(item.id)}">삭제</button></span>`
      : '';
    return `<article class="card" style="--c:${cat.color}">
      <button class="thumb" type="button" data-open="${esc(item.id)}" aria-label="${esc(item.title)} 자세히 보기">
        <span class="badge">${esc(cat.key)}</span>${thumbHtml(item, item.title)}
      </button>
      <div class="card-body">
        <h3><a href="#${esc(item.id)}">${esc(item.title)}</a></h3>
        <dl class="meta">
          ${item.target ? `<dt>대상</dt><dd>${esc(split(item.target).join(', '))}</dd>` : ''}
          ${item.author ? `<dt>제작</dt><dd>${esc(item.author)}</dd>` : ''}
          ${item.duration ? `<dt>시간</dt><dd>${esc(item.duration)}</dd>` : ''}
        </dl>
        ${item.tags ? `<div class="tags">${split(item.tags).map((t) => `<span>#${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="card-foot">
        <a class="btn btn-line btn-sm" href="#${esc(item.id)}">자세히</a>
        ${item.prompt ? `<button class="btn btn-soft btn-sm" type="button" data-prompt="${esc(item.id)}">프롬프트</button>` : ''}
        ${url ? `<a class="btn btn-dark btn-sm" href="${esc(url)}" target="_blank" rel="noopener">열기 ↗</a>` : ''}
        ${admin}
      </div>
    </article>`;
  }

  function renderGrid() {
    const grid = $('#grid');
    if (!state.loaded) {
      grid.innerHTML = '<div class="skeleton"></div>'.repeat(4);
      $('#resultLine').textContent = '불러오는 중…';
      return;
    }
    const list = state.items.filter((it) => matches(it));
    $('#resultLine').textContent = state.q || state.cat !== ALL || state.target !== ALL
      ? `웹앱 ${list.length}개` + (state.q ? ` · “${state.q}” 검색 결과` : '')
      : `모든 웹앱 ${list.length}개 · 최근 등록 순`;
    grid.innerHTML = list.length
      ? list.map(card).join('')
      : `<div class="empty">${state.items.length ? '조건에 맞는 웹앱이 없습니다.' : '아직 등록된 웹앱이 없습니다. 첫 웹앱을 등록해 주세요!'}</div>`;
  }

  function render() { renderChips(); renderGrid(); }

  function renderSession() {
    $('#adminBar').hidden = !state.session;
    $('#adminName').textContent = state.session?.name || '';
    $('#loginOpenBtn').textContent = state.session ? '로그아웃' : '관리자 로그인';
  }

  /* ───────── 자세히 ───────── */

  function openDetail(id, focusPrompt) {
    const item = state.items.find((x) => x.id === id);
    if (!item) return;
    const cat = catOf(item.category);
    const url = safeUrl(item.url);
    $('#detailBody').innerHTML = `
      <div class="detail-thumb" style="--c:${cat.color}">${thumbHtml(item, cat.key)}</div>
      <div class="modal-head">
        <h2>${esc(item.title)}</h2>
        <button class="icon-btn" type="button" data-close aria-label="닫기">×</button>
      </div>
      <div class="detail-meta">
        <span><b>분류</b>${esc(cat.key)}</span>
        ${item.target ? `<span><b>대상</b>${esc(split(item.target).join(', '))}</span>` : ''}
        ${item.author ? `<span><b>제작</b>${esc(item.author)}</span>` : ''}
        ${item.duration ? `<span><b>시간</b>${esc(item.duration)}</span>` : ''}
        <span><b>등록</b>${fmtDate(item.createdAt)}</span>
      </div>
      ${item.description ? `<p class="detail-desc">${esc(item.description)}</p>` : ''}
      ${item.tags ? `<div class="tags" style="margin:-6px 0 18px">${split(item.tags).map((t) => `<span>#${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="detail-actions">
        ${url ? `<a class="btn btn-dark" href="${esc(url)}" target="_blank" rel="noopener">웹앱 열기 ↗</a>
          <button class="btn btn-line" type="button" data-qr="${esc(item.id)}">QR 코드</button>` : ''}
        <button class="btn btn-line" type="button" data-copy="${esc(item.id)}">이 자료 주소 복사</button>
        ${canEdit(item) ? `<button class="btn btn-line" type="button" data-edit="${esc(item.id)}">수정</button>
          <button class="btn btn-line btn-danger" type="button" data-del="${esc(item.id)}">삭제</button>` : ''}
      </div>
      ${item.prompt ? `<section class="prompt" id="promptSection">
        <div class="prompt-head"><h3>만든 과정 · 프롬프트</h3>
          <button class="btn btn-line btn-sm" type="button" data-copy-prompt="${esc(item.id)}">복사</button></div>
        <pre>${esc(item.prompt)}</pre></section>` : ''}`;
    const dlg = $('#detailDialog');
    if (!dlg.open) dlg.showModal();
    if (focusPrompt) $('#promptSection')?.scrollIntoView({ block: 'start' });
    else dlg.scrollTop = 0;
  }

  function syncHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id && state.items.some((x) => x.id === id)) openDetail(id);
    else if ($('#detailDialog').open) $('#detailDialog').close();
  }

  let qrLib;
  async function showQr(id) {
    const item = state.items.find((x) => x.id === id);
    const url = item && safeUrl(item.url);
    if (!url) return;
    qrLib ||= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
      s.onload = () => resolve(window.qrcode);
      s.onerror = () => { qrLib = null; reject(new Error('QR 코드를 만들지 못했습니다.')); };
      document.head.appendChild(s);
    });
    try {
      const qr = (await qrLib)(0, 'M');
      qr.addData(new URL(url).href);
      qr.make();
      $('#qrBox').innerHTML = qr.createSvgTag(8, 2);
      $('#qrTitle').textContent = item.title;
      $('#qrUrl').textContent = url;
      $('#qrDialog').showModal();
    } catch (ex) {
      toast(ex.message);
    }
  }

  /* ───────── 관리자 로그인 ───────── */

  async function signIn() {
    try {
      await api.signIn();
    } catch (ex) {
      toast(ex.message || '로그인하지 못했습니다.', 6000);
    }
  }

  function onSession(session, error) {
    const wasIn = !!state.session;
    state.session = session;
    renderSession();
    render();
    if (error) toast(error, 6000);
    else if (session && !wasIn && state.loaded) toast(`${session.name} 선생님, 반갑습니다.`);
  }

  /* ───────── 등록 · 수정 · 삭제 ───────── */

  const edit = { item: null, thumb: '' };

  function openEditor(id) {
    const item = id ? state.items.find((x) => x.id === id) : null;
    if (item && !canEdit(item)) return toast('관리자가 올린 웹앱은 관리자만 고칠 수 있습니다.');
    const form = $('#editForm');
    const f = form.elements;
    form.reset();
    $('#editError').hidden = true;
    $('#saveProgress').textContent = '';
    $('#editTitle').textContent = item ? '웹앱 수정' : '웹앱 등록';
    edit.item = item;
    edit.thumb = item?.thumb || '';
    for (const key of ['title', 'url', 'duration', 'tags', 'description', 'prompt']) f[key].value = item?.[key] || '';
    f.category.value = item?.category || (state.cat !== ALL ? state.cat : C.CATEGORIES[0].key);
    f.author.value = item ? item.author || '' : state.session?.name || '';
    const targets = split(item?.target);
    form.querySelectorAll('[name=target]').forEach((cb) => { cb.checked = targets.includes(cb.value); });

    // 관리자는 인증 코드와 비밀번호가 필요 없습니다. 인증 코드는 처음 등록할 때만 받습니다.
    const needPw = !state.session;
    $('#codeField').hidden = !needPw || !!item;
    f.code.required = needPw && !item;
    $('#pwField').hidden = !needPw;
    f.password.required = needPw;
    f.password.autocomplete = item ? 'current-password' : 'new-password';
    $('#pwLegend').innerHTML = (item ? '등록할 때 정한 비밀번호' : '수정·삭제용 비밀번호') + ' <em>*</em>';
    $('#pwHint').textContent = item ? '' : '나중에 이 웹앱을 고치거나 지울 때 씁니다. 4자 이상. 잊으면 연구회 관리자에게 문의하세요.';

    renderThumbPreview();
    $('#detailDialog').close();
    $('#editDialog').showModal();
  }

  function renderThumbPreview() {
    const own = safeImg(edit.thumb);
    const url = safeUrl($('#editForm').elements.url.value.trim());
    const box = $('#thumbPreview');
    $('#thumbClear').hidden = !own;
    $('#thumbNote').textContent = own ? '' : url ? '웹앱 화면을 자동으로 찍는 중… (처음엔 10~20초)' : '이미지를 고르지 않으면 웹앱 첫 화면을 자동으로 찍어 씁니다.';
    box.style.backgroundImage = own ? `url("${own}")` : '';
    if (own || !url) return;

    // 자동 화면은 준비될 때까지 화면 밖에서 불러 보고, 준비되면 미리보기에 띄웁니다.
    const probe = new Image();
    probe.dataset.offscreen = '1';
    const current = url;
    probe.onload = () => {
      if (safeUrl($('#editForm').elements.url.value.trim()) !== current || safeImg(edit.thumb)) return;
      if (!isAutoReady(probe)) return retryAuto(probe, () => { $('#thumbNote').textContent = '자동 화면을 찍지 못했습니다. 이미지를 직접 골라 주세요.'; });
      box.style.backgroundImage = `url("${probe.src}")`;
      $('#thumbNote').textContent = '자동으로 찍은 웹앱 화면입니다. 다른 이미지를 쓰려면 직접 고르세요.';
    };
    probe.src = autoThumb(url);
  }

  // 대표 이미지를 480×300 으로 잘라 줄입니다 (보통 20~40KB). 파일 저장소 없이 자료 문서에 같이 담습니다.
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const W = 480, H = 300;
        const scale = Math.max(W / img.width, H / img.height);
        const sw = W / scale, sh = H / scale;
        const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, W, H);
        URL.revokeObjectURL(img.src);
        const webp = canvas.toDataURL('image/webp', 0.75);
        resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.78));
      };
      img.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
      img.src = URL.createObjectURL(file);
    });
  }

  async function save(e) {
    e.preventDefault();
    const form = e.target;
    const f = form.elements;
    const btn = $('#saveBtn');
    const err = $('#editError');
    err.hidden = true;
    btn.disabled = true;
    $('#saveProgress').textContent = '저장하는 중…';
    try {
      const fields = {
        title: f.title.value.trim(),
        url: f.url.value.trim(),
        category: f.category.value,
        target: [...form.querySelectorAll('[name=target]:checked')].map((cb) => cb.value).join(', '),
        author: f.author.value.trim(),
        duration: f.duration.value.trim(),
        tags: split(f.tags.value).join(', '),
        description: f.description.value.trim(),
        prompt: f.prompt.value.trim(),
        thumb: edit.thumb,
      };
      if (!safeUrl(fields.url)) throw new Error('웹앱 주소는 http:// 또는 https:// 로 시작해야 합니다.');
      const password = f.password.value;
      if (!state.session && password.length < 4) throw new Error('비밀번호를 4자 이상 입력하세요.');
      if (edit.item) await api.update(edit.item.id, fields, password, state.session);
      else await api.create(fields, password, state.session, f.code.value.trim().toUpperCase());
      $('#editDialog').close();
      toast(edit.item ? '수정했습니다.' : '웹앱을 등록했습니다. 고마워요!');
      await refresh();
    } catch (ex) {
      err.textContent = ex?.code === 'permission-denied' && !edit.item && !state.session
        ? '회원 인증 코드가 맞지 않습니다.'
        : friendlyError(ex);
      err.hidden = false;
    } finally {
      btn.disabled = false;
      $('#saveProgress').textContent = '';
    }
  }

  let deleting = null;
  function askDelete(id) {
    const item = state.items.find((x) => x.id === id);
    if (!item || !canEdit(item)) return;
    if (state.session) {
      if (confirm(`‘${item.title}’ 을(를) 삭제할까요?`)) removeItem(item, '');
      return;
    }
    deleting = item;
    $('#pwForm').reset();
    $('#pwError').hidden = true;
    $('#pwTarget').textContent = item.title;
    $('#detailDialog').close();
    $('#pwDialog').showModal();
  }

  async function removeItem(item, password) {
    await api.remove(item.id, password, state.session);
    toast('삭제했습니다.');
    await refresh();
  }

  async function submitDelete(e) {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await removeItem(deleting, e.target.elements.password.value);
      $('#pwDialog').close();
    } catch (ex) {
      $('#pwError').textContent = friendlyError(ex);
      $('#pwError').hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  function friendlyError(ex) {
    if (ex?.code === 'permission-denied') {
      return state.session
        ? '관리자 권한이 없습니다. 다시 로그인하거나 연구회 관리자에게 문의하세요.'
        : '비밀번호가 맞지 않거나 입력 내용이 너무 깁니다.';
    }
    if (ex?.code === 'unavailable') return '인터넷 연결을 확인하세요.';
    return ex?.message || '저장하지 못했습니다.';
  }

  /* ───────── 보조 ───────── */

  function fmtDate(ms) {
    const d = new Date(Number(ms));
    return !ms || isNaN(d) ? '' : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  }
  function copy(text, label) {
    navigator.clipboard?.writeText(text).then(() => toast(`${label} 복사했습니다.`), () => prompt(label, text));
  }
  let toastTimer;
  function toast(msg, ms = 2600) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  /* ───────── 시작 ───────── */

  function bind() {
    document.addEventListener('click', (e) => {
      const t = e.target.closest('button, a');
      if (!t) return;
      const d = t.dataset;
      if (d.cat !== undefined) { state.cat = d.cat; render(); }
      else if (d.target !== undefined) { state.target = d.target; render(); }
      else if (d.open) location.hash = d.open;
      else if (d.prompt) { history.replaceState(null, '', '#' + d.prompt); openDetail(d.prompt, true); }
      else if (d.edit) openEditor(d.edit);
      else if (d.del) askDelete(d.del);
      else if (d.qr) showQr(d.qr);
      else if (d.close !== undefined) t.closest('dialog').close();
      else if (d.copy) copy(location.href.split('#')[0] + '#' + d.copy, '주소를');
      else if (d.copyPrompt) copy(state.items.find((x) => x.id === d.copyPrompt)?.prompt || '', '프롬프트를');
    });

    let qTimer;
    $('#searchInput').addEventListener('input', (e) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { state.q = e.target.value.trim(); render(); }, 150);
    });

    $('#loginOpenBtn').addEventListener('click', () => (state.session ? api.signOut() : signIn()));
    $('#logoutBtn').addEventListener('click', () => api.signOut().then(() => toast('로그아웃했습니다.')));
    $('#newItemBtn').addEventListener('click', () => openEditor(''));
    $('#editForm').addEventListener('submit', save);
    $('#pwForm').addEventListener('submit', submitDelete);

    // 자세히 창을 닫으면 주소의 #id 도 지움
    $('#detailDialog').addEventListener('close', () => {
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    });
    // 바깥(배경) 클릭으로 닫기 — 입력 창은 실수로 닫히지 않게 제외
    for (const id of ['detailDialog', 'qrDialog']) {
      $('#' + id).addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
    }
    window.addEventListener('hashchange', syncHash);

    $('#thumbInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        edit.thumb = await shrinkImage(file);
        renderThumbPreview();
      } catch (ex) {
        toast(ex.message);
      }
    });
    $('#thumbClear').addEventListener('click', () => { edit.thumb = ''; renderThumbPreview(); });
    let urlTimer;
    $('#editForm').elements.url.addEventListener('input', () => {
      clearTimeout(urlTimer);
      urlTimer = setTimeout(() => { if (!safeImg(edit.thumb)) renderThumbPreview(); }, 600);
    });

    // 카드·자세히의 자동 화면: 준비되면 보이고, 아직이면 색 그림을 둔 채 다시 불러옴
    document.addEventListener('load', (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.dataset.auto) return;
      if (isAutoReady(img)) img.classList.add('ready');
      else retryAuto(img, () => img.remove());
    }, true);
  }

  function fillStaticText() {
    document.title = `${C.SITE_TITLE} · ${C.ORG_NAME}`;
    $('#orgName').textContent = C.ORG_NAME;
    $('#siteTitleRest').textContent = C.SITE_TITLE.replace(/^GATE\s*/, '');
    $('#intro').textContent = C.INTRO;
    $('#footerOrg').textContent = C.ORG_NAME;
    $('#year').textContent = new Date().getFullYear();
    $('#categorySelect').innerHTML = C.CATEGORIES.map((c) => `<option>${esc(c.key)}</option>`).join('');
    $('#targetChecks').innerHTML = C.TARGETS.map((t) => `<label><input type="checkbox" name="target" value="${esc(t)}">${esc(t)}</label>`).join('');
    $('#demoBar').hidden = !DEMO;
  }

  async function init() {
    fillStaticText();
    bind();

    // 지난번 목록을 먼저 보여 주고, 바뀐 것을 받아 오면 다시 그립니다.
    const cached = store.get(CACHE_KEY, null);
    if (cached) { state.items = Object.values(cached.items).sort(byNewest); state.loaded = true; }
    render();
    syncHash();

    try {
      await api.init();
      api.onAuth(onSession);
      await refresh();
      syncHash();
    } catch (ex) {
      state.loaded = true;
      render();
      toast('목록을 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.', 5000);
      console.error(ex);
    }
  }

  /* ───────── 데모용 예시 ───────── */

  function SAMPLE_ITEMS() {
    const day = 86400000;
    const now = Date.now();
    const base = { url: 'https://example.com', thumb: '', createdBy: 'demo@example.com', deleted: false };
    return [
      { ...base, id: 'demo1', title: '색이 말을 건다 — 색채 감정 탐험', category: '감상', target: '중학교', duration: '15분', tags: '색채, 감정, 로스코', author: '예시 교사(춘천중)', description: '작품 속 색을 고르면 그 색이 주는 느낌을 학생이 말로 적고, 반 친구들의 답과 비교해 보는 웹앱입니다.', prompt: '도구: Claude\n\n1) 중학생이 마크 로스코 작품의 색을 보고 느낌을 적는 웹앱을 만들어 줘. 색 6개를 고를 수 있고, 고른 색마다 느낌 단어를 입력하게 해 줘.\n2) 입력한 단어를 워드클라우드로 보여 줘.', createdAt: now - day, updatedAt: now - day },
      { ...base, id: 'demo2', title: '명화 속 숨은 그림 찾기', category: '미술 게임', target: '초등학교, 중학교', duration: '10분', tags: '명화, 관찰, 게임', author: '예시 교사(원주초)', description: '명화의 일부분을 확대해 보여 주고 어느 작품인지 맞히는 관찰력 게임입니다.', prompt: '', createdAt: now - 4 * day, updatedAt: now - 4 * day },
      { ...base, id: 'demo3', title: '모둠 작품 동료 평가판', category: '평가·피드백', target: '중학교, 고등학교', duration: '1차시', tags: '동료 평가, 루브릭', author: '예시 교사(강릉고)', description: '모둠별 작품 사진을 올리고 루브릭 항목에 따라 서로 별점과 한 줄 피드백을 남깁니다.', prompt: '루브릭 항목 3개(아이디어, 표현, 협력)로 별점과 한 줄 피드백을 남기는 동료 평가 웹앱을 만들어 줘.', createdAt: now - 9 * day, updatedAt: now - 9 * day },
      { ...base, id: 'demo4', title: '한 획 드로잉 타이머', category: '수업 도구', target: '교사용', duration: '5분', tags: '드로잉, 타이머, 크로키', author: 'GATE 연수팀', description: '크로키·제스처 드로잉 수업용 타이머. 30초~5분 단위로 참고 사진이 바뀝니다.', prompt: '', createdAt: now - 20 * day, updatedAt: now - 20 * day },
      { ...base, id: 'demo5', title: '나만의 패턴 만들기', category: '표현', target: '초등학교', duration: '20분', tags: '패턴, 반복, 디자인', author: '예시 교사(속초초)', description: '도형을 골라 반복·대칭 규칙을 바꾸며 패턴을 만들고 이미지로 저장합니다.', prompt: '', createdAt: now - 30 * day, updatedAt: now - 30 * day },
    ];
  }

  init();
})();
