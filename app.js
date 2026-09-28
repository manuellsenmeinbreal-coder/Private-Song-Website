'use strict';
/* ---------- Datenbank (IndexedDB) ---------- */
const idb = new Promise((res, rej) => {
  const r = indexedDB.open('glassbox', 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('songs', {keyPath:'id'}); r.result.createObjectStore('lists', {keyPath:'id'}); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const tx = (s, m, f) => idb.then(d => new Promise((res, rej) => {
  const t = d.transaction(s, m), q = f(t.objectStore(s));
  t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error);
}));
const dbAll = s => tx(s, 'readonly', o => o.getAll());
const dbPut = (s, v) => tx(s, 'readwrite', o => o.put(v));
const dbDel = (s, k) => tx(s, 'readwrite', o => o.delete(k));

/* ---------- Hilfsfunktionen ---------- */
const $ = s => document.querySelector(s);
const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const P = {
  play:'M8 5v14l11-7z', pause:'M6 5h4v14H6zM14 5h4v14h-4z',
  prev:'M6 6h2v12H6zM9.5 12l8.5 6V6z', next:'M16 6h2v12h-2zM6 18l8.5-6L6 6z',
  plus:'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  close:'M6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z',
  trash:'M9 4h6l1 1h4v2H4V5h4zM6 9h12l-1 11H7z',
  edit:'M4 17.3V20h2.7L17.8 8.9l-2.7-2.7zM19.7 7l-1.4 1.4-2.7-2.7L17 4.3a1 1 0 011.4 0l1.3 1.3a1 1 0 010 1.4z',
  upload:'M11 16V7.8L8.4 10.4 7 9l5-5 5 5-1.4 1.4L13 7.8V16zM5 18h14v2H5z',
  image:'M4 4h16v16H4zM6 6v12h12V6zM8 16l3-4 2 2.5 1.5-2L17 16zM9 8.2a1.3 1.3 0 100 2.6 1.3 1.3 0 000-2.6z',
  shuffle:'M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z'
};
const icon = n => { const s = document.createElementNS('http://www.w3.org/2000/svg','svg'); s.setAttribute('viewBox','0 0 24 24'); const p = document.createElementNS(s.namespaceURI,'path'); p.setAttribute('d', P[n]); p.setAttribute('fill-rule', 'evenodd'); s.append(p); return s; };
const setIcon = (el, n) => el.replaceChildren(icon(n));
const fmt = s => { if (!isFinite(s)) return '0:00'; s = Math.floor(s); return Math.floor(s/60) + ':' + String(s%60).padStart(2,'0'); };
const fill = el => el.style.setProperty('--p', (el.value / el.max * 100) + '%');

/* ---------- Zustand ---------- */
let songs = [], lists = [], view = 'lib', cur = null, queue = [], url = null, seeking = false;
let autoplay = localStorage.getItem('gb-autoplay') !== '0';
const audio = new Audio();
const listOf = id => lists.find(l => l.id === id);
const viewIds = () => view === 'lib' ? songs.map(s => s.id) : (listOf(view)?.ids || []).filter(id => songs.some(s => s.id === id));
const song = id => songs.find(s => s.id === id);

/* ---------- Rendering ---------- */
let lastView = null, query = '';
const retrigger = (el, c) => { el.classList.remove(c); void el.offsetWidth; el.classList.add(c); };
const num = (i, playing) => {
  const s = h('span', 'n');
  if (playing) { const q = h('span', 'eq'); q.append(h('i'), h('i'), h('i')); s.append(q); } else s.textContent = i + 1;
  return s;
};
function render() {
  $('#libBtn').classList.toggle('on', view === 'lib');
  $('#libCount').textContent = songs.length;
  const L = $('#lists'); L.replaceChildren();
  lists.forEach(l => {
    const b = h('button', 'item' + (view === l.id ? ' on' : ''));
    b.append(h('span', '', l.name), h('small', '', l.ids.filter(id => song(id)).length));
    b.onclick = () => { view = l.id; render(); };
    L.append(b);
  });

  const all = viewIds(), ids = query ? all.filter(id => song(id).name.toLowerCase().includes(query)) : all, list = view === 'lib' ? null : listOf(view);
  $('#title').textContent = list ? list.name : 'Bibliothek';
  const mins = Math.round(ids.reduce((a, id) => a + (song(id).duration || 0), 0) / 60);
  $('#sub').textContent = ids.length + (ids.length === 1 ? ' Song' : ' Songs') + (ids.length ? ', ' + mins + ' Min.' : '');
  const A = $('#actions'); A.replaceChildren();
  const up = h('button', 'pill' + (list ? '' : ' main-cta')); up.append(icon('upload'), 'Songs hochladen'); up.onclick = () => $('#file').click(); A.append(up);
  if (list) {
    const rn = h('button', 'pill'); rn.append(icon('edit'), 'Umbenennen'); rn.onclick = renameList;
    const dl = h('button', 'pill'); dl.append(icon('trash'), 'Löschen'); dl.onclick = deleteList;
    A.prepend(dl); A.prepend(rn);
  }

  const S = $('#songs'); S.replaceChildren();
  S.classList.toggle('enter', view !== lastView); lastView = view;
  if (!ids.length) {
    const e = h('div', 'empty', query ? 'Kein Song passt zur Suche.' : list
      ? 'Diese Playlist ist leer. Füge Songs aus der Bibliothek über das Plus-Symbol hinzu.'
      : 'Noch keine Songs. Ziehe Audiodateien in dieses Fenster oder wähle sie über „Songs hochladen“ aus.');
    S.append(e); return;
  }
  ids.forEach((id, i) => {
    const s = song(id), r = h('div', 'row' + (id === cur ? ' on' : ''));
    const t = h('button', 't'), th = h('span', 'th'), cu = coverUrl(s);
    if (cu) th.style.background = 'url("' + cu + '") center/cover';
    t.append(num(i, id === cur && !audio.paused), th, h('b', '', s.name));
    t.onclick = () => id === cur ? toggle() : play(id, true);
    const add = h('button', 'ib'); add.dataset.add = 1; add.title = 'Zu Playlist hinzufügen'; add.setAttribute('aria-label','Zu Playlist hinzufügen'); add.append(icon('plus'));
    add.onclick = () => openMenu(add, id);
    const rm = h('button', 'ib'); rm.append(icon(list ? 'close' : 'trash'));
    rm.title = rm.ariaLabel = list ? 'Aus Playlist entfernen' : 'Song löschen';
    rm.onclick = () => list ? removeFromList(list, id) : deleteSong(id);
    const im = h('button', 'ib'); im.dataset.add = 1; im.title = im.ariaLabel = 'Cover ändern'; im.append(icon('image'));
    im.onclick = () => coverMenu(im, id);
    r.dataset.id = id; r.style.setProperty('--i', Math.min(i, 12));
    r.append(t, h('span', 'd', fmt(s.duration)), im, add, rm);
    S.append(r);
  });
}

/* ---------- Player ---------- */
function play(id, setQueue) {
  const s = song(id); if (!s) return;
  if (setQueue) queue = viewIds();
  if (url) URL.revokeObjectURL(url);
  url = URL.createObjectURL(s.blob); audio.src = url; cur = id;
  audio.play().catch(() => {});
  $('#curTitle').textContent = s.name; $('#curSub').textContent = fmt(s.duration) + ' Min.'; document.title = s.name + ' – Glassbox';
  retrigger($('#curTitle'), 'swap'); retrigger($('.player'), 'sheen'); showCurrent();
  render();
}
function toggle() {
  if (!cur) { const ids = viewIds(); if (ids.length) play(ids[0], true); return; }
  audio.paused ? audio.play() : audio.pause();
}
function step(dir, auto) {
  if (!queue.length) return;
  if (shuffle && dir > 0 && queue.length > 1) { let r; do r = queue[Math.floor(Math.random() * queue.length)]; while (r === cur); return play(r); }
  const i = queue.indexOf(cur), n = i + dir;
  if (auto && n >= queue.length) { return; }
  play(queue[(n + queue.length) % queue.length]);
}
const prev = () => audio.currentTime > 3 ? (audio.currentTime = 0) : step(-1);
audio.addEventListener('play', () => { document.body.classList.add('playing'); setIcon($('#pp'), 'pause'); $('#pp').title = 'Pause'; render(); });
audio.addEventListener('pause', () => { document.body.classList.remove('playing'); setIcon($('#pp'), 'play'); $('#pp').title = 'Abspielen'; render(); });
audio.addEventListener('loadedmetadata', () => $('#dt').textContent = fmt(audio.duration));
audio.addEventListener('timeupdate', () => {
  $('#ct').textContent = fmt(audio.currentTime);
  if (!seeking && audio.duration) { $('#seek').value = audio.currentTime / audio.duration * 1000; fill($('#seek')); }
});
audio.addEventListener('ended', () => { if (autoplay) step(1, true); });
$('#pp').onclick = toggle; $('#prev').onclick = prev; $('#next').onclick = () => step(1);
const seek = $('#seek');
seek.oninput = () => { seeking = true; fill(seek); if (audio.duration) audio.currentTime = seek.value / 1000 * audio.duration; };
seek.onchange = () => seeking = false;
const vol = $('#vol');
vol.value = localStorage.getItem('gb-vol') ?? 80;
vol.oninput = () => { audio.volume = vol.value / 100; fill(vol); localStorage.setItem('gb-vol', vol.value); };
vol.oninput();
const ap = $('#ap');
const setAp = () => ap.setAttribute('aria-checked', autoplay);
ap.onclick = () => { autoplay = !autoplay; localStorage.setItem('gb-autoplay', autoplay ? '1' : '0'); setAp(); };
setAp();
let shuffle = localStorage.getItem('gb-shuffle') === '1';
const shuf = $('#shuf');
setIcon(shuf, 'shuffle'); shuf.setAttribute('aria-pressed', shuffle);
shuf.onclick = () => { shuffle = !shuffle; localStorage.setItem('gb-shuffle', shuffle ? '1' : '0'); shuf.setAttribute('aria-pressed', shuffle); };
$('#search').oninput = e => { query = e.target.value.trim().toLowerCase(); render(); };

/* ---------- Songs ---------- */
function readDuration(file) {
  return new Promise(res => {
    const a = new Audio(), u = URL.createObjectURL(file);
    a.preload = 'metadata'; a.src = u;
    a.onloadedmetadata = () => { res(a.duration); URL.revokeObjectURL(u); };
    a.onerror = () => { res(NaN); URL.revokeObjectURL(u); };
  });
}
async function addFiles(files) {
  const ok = [...files].filter(f => f.type.startsWith('audio/') || /\.(mp3|m4a|wav|ogg|flac|aac)$/i.test(f.name));
  for (const f of ok) {
    const raw = await id3Cover(f), cover = raw && await shrink(raw);
    const s = { id: crypto.randomUUID(), name: f.name.replace(/\.[^.]+$/, ''), blob: f, duration: await readDuration(f), added: Date.now(), cover: cover || null };
    await dbPut('songs', s); songs.push(s);
  }
  render();
}
async function deleteSong(id) {
  const s = song(id); if (!confirm('„' + s.name + '“ endgültig aus der Bibliothek löschen?')) return;
  if (cur === id) { audio.pause(); audio.removeAttribute('src'); cur = null; $('#curTitle').textContent = 'Keine Wiedergabe'; $('#curSub').textContent = 'Wähle einen Song'; showCurrent(); }
  queue = queue.filter(x => x !== id);
  if (covers.has(id)) { URL.revokeObjectURL(covers.get(id)); covers.delete(id); }
  songs = songs.filter(x => x.id !== id); await dbDel('songs', id);
  for (const l of lists) if (l.ids.includes(id)) { l.ids = l.ids.filter(x => x !== id); await dbPut('lists', l); }
  render();
}
$('#file').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
$('#libBtn').onclick = () => { view = 'lib'; render(); };

/* ---------- Cover ---------- */
const covers = new Map(); let coverTarget = null;
const coverUrl = s => { if (!s.cover) return null; let u = covers.get(s.id); if (!u) covers.set(s.id, u = URL.createObjectURL(s.cover)); return u; };
async function shrink(file) {            // Bild quadratisch zuschneiden, auf max. 600 px verkleinern
  try {
    const bmp = await createImageBitmap(file), z = Math.min(bmp.width, bmp.height), c = document.createElement('canvas');
    c.width = c.height = Math.min(z, 600);
    c.getContext('2d').drawImage(bmp, (bmp.width - z) / 2, (bmp.height - z) / 2, z, z, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(r, 'image/jpeg', .88));
  } catch { return null; }
}
async function id3Cover(file) {          // eingebettetes Albumcover aus MP3 (ID3v2.3/2.4) lesen
  try {
    const hd = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (String.fromCharCode(hd[0], hd[1], hd[2]) !== 'ID3' || hd[3] < 3) return null;
    const ver = hd[3], size = (hd[6] << 21) | (hd[7] << 14) | (hd[8] << 7) | hd[9];
    const b = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
    for (let p = 0; p + 10 < b.length;) {
      const id = String.fromCharCode(b[p], b[p+1], b[p+2], b[p+3]); if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const len = ver === 4 ? (b[p+4] << 21) | (b[p+5] << 14) | (b[p+6] << 7) | b[p+7] : ((b[p+4] << 24) | (b[p+5] << 16) | (b[p+6] << 8) | b[p+7]) >>> 0;
      if (id === 'APIC') {
        const d = b.subarray(p + 10, p + 10 + len), enc = d[0]; let i = 1;
        while (d[i]) i++; i += 2;         // MIME-Typ + Bildtyp
        if (enc === 0 || enc === 3) { while (d[i]) i++; i++; } else { while (d[i] || d[i+1]) i += 2; i += 2; }
        return new Blob([d.subarray(i)]);
      }
      p += 10 + len;
    }
  } catch {}
  return null;
}
async function setCover(id, file) {
  const s = song(id), blob = s && file && await shrink(file); if (!blob) return;
  if (covers.has(id)) { URL.revokeObjectURL(covers.get(id)); covers.delete(id); }
  s.cover = blob; await dbPut('songs', s); render(); if (id === cur) showCurrent();
}
async function removeCover(id) {
  const s = song(id); if (covers.has(id)) { URL.revokeObjectURL(covers.get(id)); covers.delete(id); }
  s.cover = null; await dbPut('songs', s); render(); if (id === cur) showCurrent();
}
function showCurrent() {                 // Cover im Player, auf der Plattenmitte und in den Mediensteuerungen des Systems
  const s = song(cur), u = s && coverUrl(s);
  $('#art').style.background = u ? 'url("' + u + '") center/cover' : '';
  const dk = $('.disc'); if (u) dk.style.setProperty('--label', 'url("' + u + '")'); else dk.style.removeProperty('--label');
  if ('mediaSession' in navigator && s) navigator.mediaSession.metadata = new MediaMetadata({ title: s.name, artist: 'Glassbox', artwork: u ? [{ src: u, sizes: '600x600', type: 'image/jpeg' }] : [] });
}
const coverMenu = (btn, id) => popMenu(btn, [
  { label: 'Bild auswählen …', fn: () => { coverTarget = id; $('#img').click(); } },
  { label: 'Cover entfernen', off: !song(id).cover, fn: () => removeCover(id) }
]);
$('#img').onchange = e => { if (e.target.files[0]) setCover(coverTarget, e.target.files[0]); e.target.value = ''; };

/* ---------- Playlists ---------- */
setIcon($('#newBtn'), 'plus');
$('#newForm').onsubmit = async e => {
  e.preventDefault();
  const name = $('#newName').value.trim(); if (!name) return;
  const l = { id: crypto.randomUUID(), name, ids: [] };
  lists.push(l); await dbPut('lists', l); $('#newName').value = ''; view = l.id; render();
};
async function renameList() {
  const l = listOf(view), n = prompt('Neuer Name der Playlist:', l.name);
  if (n && n.trim()) { l.name = n.trim().slice(0, 40); await dbPut('lists', l); render(); }
}
async function deleteList() {
  const l = listOf(view); if (!confirm('Playlist „' + l.name + '“ löschen? Die Songs bleiben in der Bibliothek.')) return;
  lists = lists.filter(x => x.id !== l.id); await dbDel('lists', l.id); view = 'lib'; render();
}
async function removeFromList(l, id) { l.ids = l.ids.filter(x => x !== id); await dbPut('lists', l); render(); }

function closeMenu() { $('#menu')?.remove(); }
function popMenu(btn, items, empty) {
  closeMenu();
  const m = h('div', 'menu'); m.id = 'menu';
  if (!items.length) m.append(h('p', '', empty));
  items.forEach(it => { const b = h('button', '', it.label); b.disabled = !!it.off; b.onclick = async () => { closeMenu(); await it.fn(); }; m.append(b); });
  document.body.append(m);
  const r = btn.getBoundingClientRect(), mh = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(r.right - 210, innerWidth - 218)) + 'px';
  m.style.top = (r.bottom + 6 + mh > innerHeight ? r.top - mh - 6 : r.bottom + 6) + 'px';
}
const openMenu = (btn, id) => popMenu(btn, lists.map(l => ({ label: l.name + (l.ids.includes(id) ? '  ✓' : ''), off: l.ids.includes(id), fn: async () => { l.ids.push(id); await dbPut('lists', l); render(); } })), 'Lege zuerst links eine Playlist an.');
document.addEventListener('click', e => { if (!e.target.closest('#menu') && !e.target.closest('[data-add]')) closeMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

/* ---------- Drag & Drop ---------- */
let dragDepth = 0;
const drop = $('#drop');
addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; drop.classList.add('show'); } });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; drop.classList.remove('show'); } });
addEventListener('dragover', e => { e.preventDefault(); document.querySelectorAll('.row.over').forEach(r => r.classList.remove('over')); e.target.closest?.('.row')?.classList.add('over'); });
addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; drop.classList.remove('show');
  const row = e.target.closest?.('.row'); document.querySelectorAll('.row.over').forEach(r => r.classList.remove('over'));
  const files = [...e.dataTransfer.files], img = files.find(f => f.type.startsWith('image/'));
  if (img && row) setCover(row.dataset.id, img);
  addFiles(files.filter(f => !f.type.startsWith('image/')));
});

/* ---------- Visualizer: Frequenzring um die Schallplatte ---------- */
const cv = $('#viz'), g = cv.getContext('2d'), disc = $('.disc');
let actx, an, bins, raf = 0;
function initAudio() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    an = actx.createAnalyser(); an.fftSize = 256; an.smoothingTimeConstant = .8;
    actx.createMediaElementSource(audio).connect(an); an.connect(actx.destination);
    bins = new Uint8Array(an.frequencyBinCount);
  }
  if (actx.state === 'suspended') actx.resume();
}
function idle() {                        // ruhender Ring, damit er auch bei Pause sichtbar bleibt
  g.clearRect(0, 0, 1000, 1000); g.lineWidth = 6; g.lineCap = 'round'; g.strokeStyle = 'rgba(233,184,114,.25)';
  for (let i = 0; i < 72; i++) {
    const a = -Math.PI / 2 + i / 72 * Math.PI * 2;
    g.beginPath(); g.moveTo(500 + Math.cos(a) * 392, 500 + Math.sin(a) * 392); g.lineTo(500 + Math.cos(a) * 400, 500 + Math.sin(a) * 400); g.stroke();
  }
}
function frame() {
  an.getByteFrequencyData(bins);
  g.clearRect(0, 0, 1000, 1000);
  const N = 72, half = N / 2, R = 392, top = Math.floor(bins.length * .7);
  let sum = 0, bass = 0;
  for (let i = 0; i < bins.length; i++) sum += bins[i];
  for (let i = 0; i < 6; i++) bass += bins[i];
  g.lineWidth = 6; g.lineCap = 'round';
  for (let i = 0; i < N; i++) {
    const k = i < half ? i : N - 1 - i, v = bins[Math.floor(k * top / half)] / 255;
    const len = 8 + Math.pow(v, 1.4) * 100, a = -Math.PI / 2 + i / N * Math.PI * 2;
    g.strokeStyle = 'rgba(233,184,114,' + (.25 + v * .65) + ')';
    g.beginPath();
    g.moveTo(500 + Math.cos(a) * R, 500 + Math.sin(a) * R);
    g.lineTo(500 + Math.cos(a) * (R + len), 500 + Math.sin(a) * (R + len));
    g.stroke();
  }
  disc.style.setProperty('--bass', (bass / 6 / 255).toFixed(3));
  if (!audio.paused || sum > 40) raf = requestAnimationFrame(frame);
  else { raf = 0; idle(); disc.style.setProperty('--bass', 0); }
}
audio.addEventListener('play', () => { try { initAudio(); if (!raf) raf = requestAnimationFrame(frame); } catch (e) {} });

/* ---------- Tastatur & Mediensteuerung ---------- */
addEventListener('keydown', e => {
  if (e.target.closest('button,input,textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  else if (e.code === 'ArrowRight') e.shiftKey ? step(1) : (audio.currentTime += 5);
  else if (e.code === 'ArrowLeft') e.shiftKey ? prev() : (audio.currentTime -= 5);
});
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  try { ms.setActionHandler('play', toggle); ms.setActionHandler('pause', toggle); ms.setActionHandler('previoustrack', prev); ms.setActionHandler('nexttrack', () => step(1)); } catch {}
}

/* ---------- Start ---------- */
setIcon($('#prev'), 'prev'); setIcon($('#next'), 'next'); setIcon($('#pp'), 'play');
(async () => {
  songs = (await dbAll('songs')).sort((a, b) => a.added - b.added);
  lists = await dbAll('lists');
  render();
  idle();
  navigator.storage?.persist?.();
})();