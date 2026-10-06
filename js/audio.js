// 소리: 효과음과 배경음을 Web Audio로 직접 합성한다 (음원 파일 없음 → 저작권 걱정 없음)
'use strict';

const Sound = (() => {
  let ac = null, master, sfxBus, bgmBus, musicGain, duck;
  let unlocked = false, want = null, theme = null, timer = 0, step = 0, nextT = 0;
  const lastPlay = {};
  const set = () => (typeof Game !== 'undefined' && Game.save && Game.save.settings) || {};
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function ctx() {
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
      master = ac.createGain(); master.connect(ac.destination);
      sfxBus = ac.createGain(); sfxBus.connect(master);
      duck = ac.createGain(); duck.connect(master);   // 짧은 곡(팡파르)이 나오는 동안 배경음을 줄인다
      bgmBus = ac.createGain(); bgmBus.connect(duck);
      musicGain = ac.createGain(); musicGain.connect(duck);
      refresh();
    }
    if (ac.state === 'suspended' && !document.hidden) ac.resume();
    return ac;
  }
  // 다른 앱이나 홈 화면으로 가서 창이 가려지면 소리를 멈추고, 돌아오면 다시 튼다 (휴대폰 브라우저)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (ac && ac.state === 'running') ac.suspend().catch(() => {});
      if (player && player.el && !player.el.paused) player.el.pause();
    } else {
      if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
      if (player && player.el && player.el.paused && unlocked && set().bgm !== false) player.el.play().catch(() => {});
    }
  });
  // 설정의 켜기/끄기와 음량을 반영
  function refresh() {
    const s = set();
    const mv = s.bgm === false ? 0 : (s.bgmVol ?? 40) / 100 * 0.8 * trackVol(fileKey);
    if (musicGain) musicGain.gain.value = mv;
    if (player && player.el) { player.el.volume = Math.min(1, mv); if (s.bgm === false) player.el.pause(); else if (unlocked && player.el.paused && !document.hidden) player.el.play().catch(() => {}); }
    if (s.bgm === false && player && player.src) stopFile(true);
    else if (s.bgm !== false && !player && fileUrl && unlocked) playFile(fileUrl, fileKey);
    if (ac) {
      sfxBus.gain.value = s.sfx === false ? 0 : (s.sfxVol ?? 60) / 100 * 0.5;
      bgmBus.gain.value = s.bgm === false ? 0 : (s.bgmVol ?? 40) / 100 * 0.22;
    }
    if (s.bgm === false) stopLoop(); else if (unlocked && want && !timer) startLoop();
  }

  // ── 합성 도구 ──
  function tone(freq, dur, o = {}) {
    const t = ac.currentTime + (o.at || 0);
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * o.slide), t + dur);
    const v = o.vol ?? 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + Math.min(0.01, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o.dest || sfxBus);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
  let noiseBuf = null;
  function noise(dur, o = {}) {
    if (!noiseBuf) {
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      let x = 12345;   // Math.random을 쓰지 않는다 (오늘의 도전 난수를 흐트러뜨리지 않게)
      for (let i = 0; i < d.length; i++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; d[i] = x / 2147483648 - 1; }
    }
    const t = ac.currentTime + (o.at || 0);
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noiseBuf;
    f.type = o.filter || 'lowpass'; f.frequency.setValueAtTime(o.freq || 2000, t);
    if (o.sweep) f.frequency.exponentialRampToValueAtTime(o.sweep, t + dur);
    g.gain.setValueAtTime(o.vol ?? 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.dest || sfxBus);
    src.start(t); src.stop(t + dur + 0.02);
  }
  const arp = (notes, gap, o = {}) => notes.forEach((m, i) => tone(mtof(m), o.len || gap * 1.4, { ...o, at: (o.at || 0) + i * gap }));

  const SFX = {
    hit()   { noise(0.09, { freq: 1800, vol: 0.35 }); tone(180, 0.08, { type: 'square', slide: 0.5, vol: 0.18 }); },
    weak()  { noise(0.07, { freq: 900, vol: 0.25 }); },
    super() { noise(0.14, { freq: 3000, vol: 0.4 }); tone(320, 0.14, { type: 'sawtooth', slide: 0.4, vol: 0.2 }); tone(640, 0.08, { vol: 0.12, at: 0.03 }); },
    crit()  { noise(0.16, { freq: 4000, vol: 0.4 }); tone(900, 0.1, { type: 'square', slide: 0.6, vol: 0.18 }); tone(1200, 0.12, { vol: 0.15, at: 0.06 }); },
    hurt()  { noise(0.12, { freq: 1200, vol: 0.35 }); tone(140, 0.14, { type: 'sawtooth', slide: 0.6, vol: 0.2 }); },
    miss()  { noise(0.15, { filter: 'highpass', freq: 3000, sweep: 800, vol: 0.12 }); },
    faint() { tone(440, 0.35, { type: 'triangle', slide: 0.25, vol: 0.25 }); },
    down()  { arp([67, 63, 60, 55], 0.16, { type: 'triangle', vol: 0.25, len: 0.3 }); },
    levelup() { arp([72, 76, 79, 84], 0.07, { type: 'square', vol: 0.14 }); tone(mtof(84), 0.35, { type: 'triangle', vol: 0.2, at: 0.28 }); },
    stairs() { arp([79, 76, 72, 67, 64], 0.06, { type: 'triangle', vol: 0.2 }); },
    pickup() { arp([84, 91], 0.05, { type: 'square', vol: 0.1 }); },
    money()  { tone(mtof(88), 0.06, { type: 'square', vol: 0.1 }); tone(mtof(95), 0.2, { type: 'square', vol: 0.1, at: 0.06 }); },
    heal()   { arp([72, 76, 79, 83, 88], 0.045, { type: 'sine', vol: 0.2 }); },
    item()   { tone(mtof(76), 0.08, { type: 'triangle', vol: 0.18 }); tone(mtof(81), 0.12, { type: 'triangle', vol: 0.18, at: 0.07 }); },
    up()     { tone(400, 0.18, { type: 'triangle', slide: 2, vol: 0.15 }); },
    down2()  { tone(500, 0.18, { type: 'triangle', slide: 0.5, vol: 0.15 }); },
    status() { tone(300, 0.08, { type: 'square', vol: 0.1 }); tone(250, 0.1, { type: 'square', vol: 0.1, at: 0.09 }); },
    trap()   { tone(220, 0.25, { type: 'sawtooth', slide: 0.5, vol: 0.18 }); noise(0.2, { freq: 900, vol: 0.2, at: 0.05 }); },
    shiny()  { arp([88, 91, 96, 100], 0.05, { type: 'sine', vol: 0.15 }); arp([96, 100], 0.08, { type: 'sine', vol: 0.1, at: 0.25 }); },
    boss()   { arp([45, 46, 45, 46], 0.12, { type: 'sawtooth', vol: 0.18, len: 0.12 }); tone(mtof(33), 0.6, { type: 'square', vol: 0.18, at: 0.5 }); },
    achieve() { arp([67, 72, 76, 79], 0.08, { type: 'square', vol: 0.13 }); arp([76, 79, 84], 0.0, { type: 'triangle', vol: 0.13, len: 0.5, at: 0.34 }); },
    menu()   { tone(mtof(84), 0.04, { type: 'square', vol: 0.06 }); },
    mission() { arp([76, 81, 85, 88], 0.07, { type: 'triangle', vol: 0.2 }); tone(mtof(93), 0.4, { type: 'sine', vol: 0.14, at: 0.3 }); },
    clear()  { arp([72, 72, 72, 76, 79, 84], 0.1, { type: 'square', vol: 0.13 }); tone(mtof(84), 0.6, { type: 'triangle', vol: 0.2, at: 0.6 }); },
    wind()   { noise(1.2, { filter: 'bandpass', freq: 400, sweep: 1500, vol: 0.3 }); },
  };

  // at: performance.now() 기준 시각 (던전 연출 타이밍에 맞춰 나중에 울림)
  function play(name, at) {
    if (set().sfx === false || !SFX[name]) return;
    const d = at ? at - performance.now() : 0;
    if (d > 20) { setTimeout(() => play(name), d); return; }
    if (!unlocked || !ctx()) return;
    const t = performance.now();
    if (t - (lastPlay[name] || 0) < 45) return;   // 같은 소리가 한꺼번에 겹치지 않게
    lastPlay[name] = t;
    SFX[name]();
  }

  // ── 배경음: 키(장소)마다 정해진 무작위 멜로디를 만들어 반복한다 ──
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11], phryg: [0, 1, 3, 5, 7, 8, 10] };
  const PROGS = [[0, 5, 3, 4], [0, 3, 4, 0], [0, 4, 5, 3], [5, 3, 0, 4], [0, 3, 0, 4], [0, 6, 5, 4]];

  function makeTheme(key, o = {}) {
    const r = rng(hash(key));
    const scale = SCALES[o.mode || 'major'];
    const root = o.root ?? 50 + Math.floor(r() * 8);
    const prog = o.prog || PROGS[Math.floor(r() * PROGS.length)];
    const deg = (d, oct = 0) => root + scale[((d % 7) + 7) % 7] + 12 * (Math.floor(d / 7) + oct);
    // 멜로디: 음계 위를 걸어다니는 64칸 (4마디)
    const mel = [];
    let cur = 7 + Math.floor(r() * 3);
    for (let i = 0; i < 64; i++) {
      const strong = i % 4 === 0, bar = Math.floor(i / 16);
      if (!strong && r() < (o.sparse ?? 0.55)) { mel.push(null); continue; }
      if (strong && r() < 0.5) cur = prog[bar] + 7 + [0, 2, 4][Math.floor(r() * 3)];   // 박자 첫머리는 화음 음으로
      else cur += [-2, -1, -1, 1, 1, 2, 0][Math.floor(r() * 7)];
      cur = clamp(cur, 4, 14);
      mel.push(i % 16 === 15 ? null : deg(cur, 1));
    }
    return { key, bpm: o.bpm || 92 + Math.floor(r() * 30), prog, deg, mel, wave: o.wave || 'square', bass: o.bass || 'triangle', drums: o.drums ?? true };
  }

  function scheduleStep(th, i, t) {
    const bar = Math.floor(i / 16) % 4, beat = i % 16, ch = th.prog[bar];
    const len = 60 / th.bpm / 4;
    const at = t - ac.currentTime;
    // 베이스
    if (beat % 4 === 0) tone(mtof(th.deg(ch, -1)), len * (beat % 8 === 0 ? 3.5 : 1.8), { type: th.bass, vol: 0.5, at, dest: bgmBus });
    // 화음 아르페지오 (작게)
    if (beat % 2 === 0) tone(mtof(th.deg(ch + [0, 2, 4, 2][(beat / 2) % 4])), len * 1.6, { type: 'triangle', vol: 0.13, at, dest: bgmBus });
    // 멜로디
    const m = th.mel[i % 64];
    if (m) tone(mtof(m), len * 1.8, { type: th.wave, vol: 0.14, at, dest: bgmBus });
    // 리듬
    if (th.drums) {
      if (beat % 8 === 4) noise(0.07, { freq: 1500, vol: 0.18, at, dest: bgmBus });
      if (beat % 2 === 0) noise(0.02, { filter: 'highpass', freq: 7000, vol: 0.05, at, dest: bgmBus });
    }
  }
  function tick() {
    if (!theme || !ac) return;
    while (nextT < ac.currentTime + 0.2) {
      scheduleStep(theme, step, nextT);
      nextT += 60 / theme.bpm / 4; step = (step + 1) % 64;
    }
  }
  function startLoop() {
    // 음악 파일을 틀고 있거나 불러오는 중이면 합성 배경음은 켜지 않는다 (둘이 겹쳐 들리지 않게)
    if (!want || fileUrl || !ctx() || set().bgm === false) return;
    if (!theme || theme.key !== want.key) { theme = makeTheme(want.key, want.o); step = 0; }
    nextT = ac.currentTime + 0.1;
    clearInterval(timer); timer = setInterval(tick, 40);
  }
  function stopLoop() { clearInterval(timer); timer = 0; }

  // ── 음악 파일: music/ 폴더의 파일이나 정보 탭에서 불러온 파일이 있으면 합성 배경음 대신 그 파일을 반복 재생 ──
  // 파일 이름: town, boss, dungeon(던전 공통), 던전 ID (예: music/forest.ogg). 확장자 ogg / mp3 / m4a / wav
  const EXTS = ['mp3', 'ogg', 'm4a', 'wav'];
  const found = {};          // 파일 키 → URL 또는 null (한 번 찾으면 기억)
  let uploadedKeys = new Set();
  let fileUrl = null, fileKey = null, player = null, seq = 0, previewing = false;
  let playTok = 0;   // 재생 요청 번호: 불러오는 사이에 새 요청이나 정지가 있으면 옛 요청은 소리를 내지 않는다
  // 불러온 파일은 용량이 커서 IndexedDB에 저장한다
  const IDB = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise(res => {
        try {
          const r = indexedDB.open('pmdweb_music', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('music');
          r.onsuccess = () => { this.db = r.result; res(this.db); };
          r.onerror = () => res(null);
        } catch (e) { res(null); }
      });
    },
    async op(mode, fn) {
      const db = await this.open(); if (!db) return null;
      return new Promise(res => { try { const tx = db.transaction('music', mode), st = tx.objectStore('music'), r = fn(st); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch (e) { res(null); } });
    },
    get(k) { return this.op('readonly', st => st.get(k)); },
    put(k, v) { return this.op('readwrite', st => st.put(v, k)); },
    del(k) { return this.op('readwrite', st => st.delete(k)); },
    keys() { return this.op('readonly', st => st.getAllKeys()); },
  };
  IDB.keys().then(k => { uploadedKeys = new Set(k || []); });
  // 소리가 날 수 있는 파일인지 확인
  function tryAudio(src) {
    return new Promise(res => {
      const a = new Audio(); let done = false;
      const end = ok => { if (done) return; done = true; a.removeAttribute('src'); res(ok); };
      a.preload = 'metadata';
      a.oncanplay = a.onloadedmetadata = () => end(true);
      a.onerror = () => end(false);
      setTimeout(() => end(false), 4000);
      a.src = src;
    });
  }
  // ── 루프 구간: 정보 탭 설정 > music/loops.js > 파일 안의 루프 정보(OGG LOOPSTART 태그, WAV smpl) 순으로 쓴다 ──
  const LOOP_KEY = 'pmdweb_loops';
  function userLoops() { try { return JSON.parse(localStorage.getItem(LOOP_KEY) || '{}'); } catch (e) { return {}; } }
  function setUserLoop(key, v) { const u = userLoops(); if (v) u[key] = v; else delete u[key]; try { localStorage.setItem(LOOP_KEY, JSON.stringify(u)); } catch (e) { /* 무시 */ } }
  // 파일 바이트에서 루프 정보 읽기 → { start, end } (초) 또는 null
  function parseLoopTags(ab) {
    const u8 = new Uint8Array(ab), dv = new DataView(ab);
    const str = (o, n) => String.fromCharCode(...u8.subarray(o, o + n));
    let rate = 0, start = null, end = null;
    try {
      if (str(0, 4) === 'RIFF' && str(8, 4) === 'WAVE') {
        for (let o = 12; o + 8 <= u8.length;) {
          const id = str(o, 4), len = dv.getUint32(o + 4, true), d = o + 8;
          if (id === 'fmt ') rate = dv.getUint32(d + 4, true);
          if (id === 'smpl' && dv.getUint32(d + 28, true) > 0) { start = dv.getUint32(d + 36 + 8, true); end = dv.getUint32(d + 36 + 12, true) + 1; }
          o = d + len + (len & 1);
        }
      } else {
        // OGG / MP3 등: 앞부분에서 태그 문자열을 찾는다
        const head = String.fromCharCode(...u8.subarray(0, Math.min(u8.length, 65536)).map(c => (c < 32 || c > 126 ? 32 : c)));
        const vi = head.indexOf('vorbis');
        if (str(0, 4) === 'OggS' && vi > 0) rate = dv.getUint32(vi + 6 + 5, true);
        const num = re => { const m = head.match(re); return m ? +m[1] : null; };
        start = num(/LOOPSTART[= ]+(\d+)/i);
        const len = num(/LOOPLENGTH[= ]+(\d+)/i), e = num(/LOOPEND[= ]+(\d+)/i);
        end = len != null && start != null ? start + len : e;
      }
    } catch (e) { return null; }
    if (start == null) return null;
    rate = rate || 44100;
    return { start: start / rate, end: end ? end / rate : 0 };
  }
  function loopFor(key, tags, dur) {
    const cfg = (window.MUSIC_LOOPS || {})[key];
    const u = userLoops()[key] || (cfg ? { start: cfg[0], end: cfg[1] } : null) || tags;
    if (!u) return null;
    const start = clamp(+u.start || 0, 0, dur), end = +u.end > start ? Math.min(+u.end, dur) : dur;
    return end - start > 0.2 ? { start, end } : null;
  }
  // 곡마다 음량 보정 (music/loops.js 의 MUSIC_VOLUME, 1 = 그대로)
  const trackVol = key => { const v = (window.MUSIC_VOLUME || {})[key]; return v > 0 ? Math.min(v, 2) : 1; };
  const canFetch = url => url.startsWith('blob:') || /^https?:/.test(location.protocol);
  const bufCache = new Map();   // url → { buf, tags } (용량이 커서 최근 2곡만)
  async function loadBuffer(url) {
    if (bufCache.has(url)) return bufCache.get(url);
    const ab = await (await fetch(url)).arrayBuffer();
    const tags = parseLoopTags(ab);
    const buf = await new Promise((res, rej) => ac.decodeAudioData(ab, res, rej));
    const entry = { buf, tags };
    bufCache.set(url, entry);
    while (bufCache.size > 2) bufCache.delete(bufCache.keys().next().value);
    return entry;
  }

  async function findFile(key) {
    if (key in found) return found[key];
    let url = null;
    if (uploadedKeys.has(key)) { const blob = await IDB.get(key); if (blob) url = URL.createObjectURL(blob); }
    for (const ext of EXTS) { if (url) break; if (await tryAudio(`${MUSIC_BASE}${key}.${ext}`)) url = `${MUSIC_BASE}${key}.${ext}`; }
    found[key] = url;
    if (url) urlKey[url] = key;
    return url;
  }
  const urlKey = {};
  const fileKeyOf = url => urlKey[url] || null;
  // keep: 곡 정보는 남겨 두고 소리만 멈춘다 (배경음을 끈 경우)
  function stopFile(keep) {
    playTok++;
    if (player) {
      if (player.src) { try { player.src.stop(); } catch (e) { /* 이미 멈춤 */ } }
      if (player.el) { player.el.pause(); clearInterval(player.timer); }
      player = null;
    }
    if (!keep) { fileUrl = null; fileKey = null; }
  }
  // 파일 재생: 가능하면 Web Audio로 정확히 루프, 안 되면(file:// 로 연 경우) audio 요소로 루프 지점에서 되감기
  async function playFile(url, key, offset = 0) {
    stopFile();
    fileUrl = url; fileKey = key;
    if (!unlocked || set().bgm === false || !ctx()) return;   // 나중에 unlock/refresh에서 다시 시작
    const my = seq, tok = ++playTok;
    if (canFetch(url)) {
      try {
        const { buf, tags } = await loadBuffer(url);
        if (my !== seq || tok !== playTok || fileUrl !== url) return;
        const L = loopFor(key, tags, buf.duration);
        const src = ac.createBufferSource();
        src.buffer = buf; src.loop = true;
        if (L) { src.loopStart = L.start; src.loopEnd = L.end; }
        src.connect(musicGain);
        player = { src, loop: L, dur: buf.duration, tags };
        refresh();
        src.start(0, Math.min(offset, buf.duration - 0.05));
        return;
      } catch (e) { /* 디코딩 실패 → audio 요소로 */ }
    }
    const el = new Audio(url);
    player = { el, loop: null };
    el.addEventListener('loadedmetadata', () => {
      const L = loopFor(key, null, el.duration);
      player && player.el === el && (player.loop = L, player.dur = el.duration);
      el.loop = !L;
      if (offset) el.currentTime = offset;
    }, { once: true });
    el.addEventListener('ended', () => { if (player && player.el === el && player.loop) { el.currentTime = player.loop.start; el.play().catch(() => {}); } });
    player.timer = setInterval(() => {
      const L = player && player.el === el && player.loop;
      if (L && el.currentTime >= L.end - 0.015) el.currentTime -= L.end - L.start;
    }, 10);
    refresh();
    el.play().catch(() => {});
  }

  // 장소별 배경음. 같은 곡이면 이어서 튼다. 음악 파일이 있으면 파일, 없으면 합성
  async function bgm(key, o = {}) {
    if (want && want.key === key) return;
    want = { key, o };
    const my = ++seq;
    stopLoop();
    let url = null;
    for (const f of o.files || []) { url = await findFile(f); if (url) break; }
    if (my !== seq) return;          // 그 사이에 다른 곡으로 바뀜
    if (url) { stopLoop(); playFile(url, fileKeyOf(url)); return; }
    stopFile();
    if (unlocked) startLoop();
  }
  async function importMusic(key, file) {
    if (!file || !/^audio\//.test(file.type) && !/\.(ogg|mp3|m4a|wav)$/i.test(file.name)) return false;
    const ok = await IDB.put(key, file);
    if (ok === null) return false;
    uploadedKeys.add(key); delete found[key];
    const w = want; want = null; if (w) bgm(w.key, w.o);   // 지금 곡에 바로 반영
    return true;
  }
  async function removeMusic(key) {
    await IDB.del(key); uploadedKeys.delete(key); delete found[key];
    const w = want; want = null; if (w) bgm(w.key, w.o);
  }
  // 정보 탭의 루프 설정용: 파일 정보(길이, 파일 안의 루프, 지금 쓰는 루프)
  async function loopInfo(key) {
    const url = await findFile(key);
    if (!url) return null;
    let tags = null, dur = 0;
    if (canFetch(url) && ctx()) { try { const e = await loadBuffer(url); tags = e.tags; dur = e.buf.duration; } catch (e) { /* 무시 */ } }
    if (!dur) dur = await new Promise(res => { const a = new Audio(); a.preload = 'metadata'; a.onloadedmetadata = () => res(a.duration); a.onerror = () => res(0); a.src = url; });
    const cfg = (window.MUSIC_LOOPS || {})[key];
    return { url, dur, tags, cfg: cfg ? { start: cfg[0], end: cfg[1] } : null, user: userLoops()[key] || null, use: loopFor(key, tags, dur), exact: canFetch(url) };
  }
  // 루프 연결 부분 미리 듣기 (끝나기 3초 전부터)
  async function previewLoop(key) {
    const url = await findFile(key); if (!url) return false;
    const info = await loopInfo(key); if (!info || !info.use) return false;
    previewing = true; ++seq; stopLoop();
    await playFile(url, key, Math.max(info.use.start, info.use.end - 3));
    return true;
  }
  function endPreview() { if (!previewing) return; previewing = false; stopFile(); const w = want; want = null; if (w) bgm(w.key, w.o); }
  function setLoop(key, v) { setUserLoop(key, v); if (fileKey === key && !previewing) { const w = want; want = null; if (w) bgm(w.key, w.o); } }

  const MOODS = { burned: 'phryg', whirl: 'dorian', seafloor: 'minor', ruins: 'phryg', shrine: 'minor', altar: 'lydian', coronet: 'dorian', spiral: 'minor', areazero: 'lydian', crystal: 'lydian', swamp: 'dorian', volcano: 'phryg', desert: 'phryg', frost: 'minor', storm: 'minor', dark: 'minor', mine: 'dorian',
    canyon: 'phryg', summit: 'lydian', trial: 'dorian', twilight: 'minor', mystery: 'dorian', eternal: 'phryg', daily: 'dorian' };
  const title = () => bgm('title', { mode: 'major', bpm: 96, root: 55, prog: [0, 3, 4, 0], wave: 'triangle', sparse: 0.6, files: ['title', 'town'] });
  const town = () => bgm('town', { mode: 'major', bpm: 96, root: 55, prog: [0, 3, 4, 0], wave: 'triangle', sparse: 0.6, files: ['town'] });
  // 오늘의 도전: 날짜로 정해지는 던전 하나의 곡 (날짜 순서대로 돌며 파일이 있는 첫 곡)
  const dailyFiles = seed => { const ids = DUNGEONS.filter(d => !d.daily).map(d => d.id), k = seed % ids.length; return [...ids.slice(k), ...ids.slice(0, k), 'dungeon']; };
  const dungeon = dg => bgm('dg:' + dg.id + (dg.daily ? dg.seed : ''), { mode: MOODS[dg.id] || 'major', files: dg.daily ? dailyFiles(dg.seed >>> 0) : [dg.id, ...((window.MUSIC_ALIAS || {})[dg.id] ? [window.MUSIC_ALIAS[dg.id]] : []), 'dungeon'] });
  // 특별한 순간의 곡 (수배범·도둑질·몬스터하우스·이야기): 파일이 있을 때만 틀고, 없으면 fallback (합성 배경음으로 바꾸지 않는다)
  async function special(key, fallback) {
    const url = await findFile(key);
    if (url) bgm('sp:' + key, { files: [key] }); else if (fallback) fallback();
  }
  // 이야기 장면 동안만 잠깐 다른 곡: 끝나면 원래 곡으로 (그 사이에 다른 곡으로 바뀌었으면 그대로 둔다)
  async function scene(key) {
    const prev = want, url = key && await findFile(key);
    if (!url || (want && want.key === 'sp:' + key)) return () => {};
    bgm('sp:' + key, { files: [key] });
    return () => { if (want && want.key === 'sp:' + key && prev) { want = null; bgm(prev.key, prev.o); } };
  }
  // 팡파르: 짧은 곡을 한 번 (승급·보상 등). 그동안 배경음을 줄였다가 끝나면 다시. 파일이 없거나 배경음을 껐으면 합성 효과음(sfx)
  const fanCache = new Map();
  let fan = null;
  async function fanfare(key, sfx) {
    const url = await findFile(key);
    if (!url || !unlocked || !ctx() || !canFetch(url) || set().bgm === false) { if (sfx) play(sfx); return; }
    try {
      if (!fanCache.has(url)) fanCache.set(url, await new Promise(async (res, rej) => ac.decodeAudioData(await (await fetch(url)).arrayBuffer(), res, rej)));
      const buf = fanCache.get(url);
      if (fan) { try { fan.src.stop(); } catch (e) { /* 이미 끝남 */ } }
      const src = ac.createBufferSource(), g = ac.createGain();
      g.gain.value = (set().bgmVol ?? 40) / 100 * 0.8 * trackVol(key);
      src.buffer = buf; src.connect(g); g.connect(master);
      const t = ac.currentTime, my = fan = { src };
      duck.gain.cancelScheduledValues(t); duck.gain.setValueAtTime(duck.gain.value, t); duck.gain.linearRampToValueAtTime(0, t + 0.15);
      src.onended = () => { if (fan !== my) return; fan = null; const t2 = ac.currentTime; duck.gain.cancelScheduledValues(t2); duck.gain.setValueAtTime(duck.gain.value, t2); duck.gain.linearRampToValueAtTime(1, t2 + 0.8); };
      src.start(t + 0.1);
    } catch (e) { if (sfx) play(sfx); }
  }
  const boss = () => bgm('boss', { mode: 'minor', bpm: 150, root: 45, prog: [0, 5, 6, 4], wave: 'sawtooth', sparse: 0.3, files: ['boss'] });

  // 브라우저는 사용자가 한 번 누르기 전에는 소리를 막는다
  function unlock() {
    if (unlocked) return;
    if (!ctx()) return;
    unlocked = true;
    refresh();
    if (fileUrl) playFile(fileUrl, fileKey);
    else if (want) startLoop();
  }
  ['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, unlock, { capture: true }));

  return { play, bgm, title, town, dungeon, boss, special, scene, fanfare, refresh, importMusic, removeMusic, loopInfo, previewLoop, endPreview, setLoop, get uploaded() { return uploadedKeys; }, get playingFile() { return fileUrl; }, get player() { return player; } };
})();
