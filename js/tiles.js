// 던전 타일 렌더링
//  1) 기본: 코드로 그린 타일 (던전마다 장식이 다름) — 배포판에 원작 이미지가 들어가지 않는다
//  2) 선택: 사용자가 직접 구한 DTEF 형식 타일셋 PNG (게임 안에서 불러오거나 tiles/ 폴더에 넣기)
'use strict';

const Tiles = (() => {
  // 사용자 타일셋(DTEF) 기능 스위치. true로 바꾸면 정보 탭에 불러오기 설정이 다시 나타난다
  const CUSTOM_TILESETS = true;
  const KEY = 'pmdweb_tilesets';
  // 이웃 비트: 가운데 칸과 같은 지형이면 1
  const NW = 1, N = 2, NE = 4, E = 8, SE = 16, S = 32, SW = 64, W = 128;
  // DTEF 6×8 블록 배치 (행 우선, null은 빈 칸). 공개된 DTEF 형식 명세의 배치 규칙을 따른다.
  const LAYOUT = [
    E | S | SE, W | E | SW | S | SE, W | SW | S, E | S, W | E, W | S,
    N | NE | E | S | SE, 255, NW | N | W | SW | S, N | S, 0, N | W,
    N | NE | E, NW | N | NE | W | E, NW | N | W, N | E, S, null,
    NW | N | W | E | SW | S, N | NE | W | E | S | SE, W | E | S, E, N | W | E | S, W,
    N | W | E | SW | S | SE, NW | N | NE | W | E | S, N | W | E, N | E | S, N, N | W | S,
    NW | N | NE | W | E | SW | S, NW | N | NE | W | E | S | SE, N | NE | E | S, NW | N | W | S, W | E | SW | S, W | E | S | SE,
    NW | N | W | E | SW | S | SE, N | NE | W | E | SW | S | SE, N | E | S | SE, N | W | SW | S, NW | N | W | E, N | NE | W | E,
    N | W | E | S | SE, N | W | E | SW | S, N | NE | W | E | S, NW | N | W | E | S, N | NE | W | E | SW | S, NW | N | W | E | S | SE,
  ];
  const RULE_INDEX = {};
  LAYOUT.forEach((m, i) => { if (m != null) RULE_INDEX[m] = i; });
  // 모서리는 양옆 두 방향이 모두 같은 지형일 때만 의미가 있다
  function reduce(m) {
    if ((m & NW) && !((m & N) && (m & W))) m &= ~NW;
    if ((m & NE) && !((m & N) && (m & E))) m &= ~NE;
    if ((m & SW) && !((m & S) && (m & W))) m &= ~SW;
    if ((m & SE) && !((m & S) && (m & E))) m &= ~SE;
    return m;
  }
  const OFFS = [[-1, -1, NW], [0, -1, N], [1, -1, NE], [1, 0, E], [1, 1, SE], [0, 1, S], [-1, 1, SW], [-1, 0, W]];
  function maskAt(D, x, y, isWall) {
    let m = 0;
    for (const [dx, dy, bit] of OFFS) {
      const nx = x + dx, ny = y + dy;
      const nw = nx < 0 || ny < 0 || nx >= D.w || ny >= D.h || D.tiles[ny * D.w + nx] !== 1;
      if (nw === isWall) m |= bit;
    }
    return reduce(m);
  }

  // ── 사용자 타일셋 ──
  let uploaded = {};
  try { uploaded = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { uploaded = {}; }
  const imgs = {};   // src → { img, state: 'loading'|'ok'|'bad', empty: Set|null, waiters: [] }
  const validDtef = img => img.width > 0 && img.width % 18 === 0 && img.width / 18 === img.height / 8;
  // 변형 파일에서 완전히 투명한(비어 있는) 칸 찾기. 로컬 파일이라 픽셀을 못 읽으면 null (겹쳐 그리기로 대체)
  function findEmpty(img) {
    try {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, img.width, img.height).data, ts = img.width / 18, set = new Set();
      for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 18; tx++) {
        let any = false;
        for (let y = ty * ts; y < (ty + 1) * ts && !any; y++) for (let x = tx * ts; x < (tx + 1) * ts; x++) if (px[(y * img.width + x) * 4 + 3] > 8) { any = true; break; }
        if (!any) set.add(ty * 18 + tx);
      }
      return set;
    } catch (e) { return null; }
  }
  function load(src, cb) {
    let e = imgs[src];
    if (!e) {
      e = imgs[src] = { img: new Image(), state: 'loading', empty: null, waiters: [] };
      e.img.onload = () => { e.state = validDtef(e.img) ? 'ok' : 'bad'; if (e.state === 'ok') e.empty = findEmpty(e.img); e.waiters.splice(0).forEach(f => f()); };
      e.img.onerror = () => { e.state = 'bad'; e.waiters.splice(0).forEach(f => f()); };
      e.img.src = src;
    }
    if (e.state === 'loading' && cb) e.waiters.push(cb);
    return e;
  }
  const enabled = () => CUSTOM_TILESETS && (typeof Game !== 'undefined' && Game.save && Game.save.settings && Game.save.settings.useTileset === true);   // 기본은 쓰지 않음 (v0.85, 설정에서 켠 경우만)
  // 저장 형식: 예전에는 문자열 하나, 지금은 [기본, 변형1, 변형2]
  const setOf = v => (typeof v === 'string' ? [v] : v);
  // 원작 던전 그림 (v0.90): 레드 구조대·하늘의 탐험대 타일 시트를 DTEF로 바꾼 것 (tools/build_tilesets.py, 별도 에셋 저장소 sprites/tiles/)
  // 던전마다 분위기가 맞는 원작 던전을 고른다. 설정의 '원작 던전 그림'을 끄면 게임이 그린 타일
  const ORIG_TILES = {
    forest: 'tinywoods', beach: 'thunderwavecave', crystal: 'southerncavernb24fb50f', plains: 'lightningfield', swamp: 'poisonmaze', volcano: 'magmacavernb08fb17f',
    desert: 'desertregion', frost: 'vasticemountain', storm: 'waterfallpond', dark: 'murkyforest', mine: 'mtsteel01f05f', sky: 'skytower', canyon: 'greatcanyon',
    summit: 'darkicemountainpeak', trial: 'deepboulderquarry', twilight: 'darkwasteland', mystery: 'normalmaze', eternal: 'buriedrelicb51fb99f',
    burned: 'rescueteammaze', whirl: 'watermaze', seafloor: 'deeplimestonecavern', ruins: 'buriedrelicb1fb20f', shrine: 'murkycave', altar: 'joyoustower',
    coronet: 'spacialcliffs', spiral: 'buriedrelicb21fb50f', areazero: 'purityforest80f99f', skyplain: 'northwindfield20f30f', twofist: 'darknightrelic',
    crown: 'icicleforest', ultra: 'temporaltowerinthefutureofdarkness', meteor: 'meteorcave', zerodeep: 'southerncavernb01fb23f', watercity: 'wishcaveb01fb13f', genelab: 'electricmaze',
    kalos: 'purityforest61f79f', hero: 'howlingforest01f06f', flower: 'westerncaveb1fb27f', crescent: 'darkicemountain', crystaldeep: 'lapiscave',
    factory: 'mtsteel06f08f', seatemple: 'limestonecavern', magma: 'magmacavernb18fb23f', mega: 'temporalspireinthefutureofdarkness',
  };
  const ORIG_DEFAULT = 'normalmaze';
  const origOn = () => !(typeof Game !== 'undefined' && Game.save && Game.save.settings && Game.save.settings.origTiles === false);
  function candidates(dgId) {
    const list = [];
    if (enabled()) list.push(setOf(uploaded[dgId]), setOf(uploaded['*']),
      [`tiles/${dgId}.png`, `tiles/${dgId}_1.png`, `tiles/${dgId}_2.png`],
      ['tiles/default.png', 'tiles/default_1.png', 'tiles/default_2.png']);
    const o = ORIG_TILES[dgId] || ORIG_DEFAULT;
    if (origOn() && typeof GFX_BASE !== 'undefined') list.push([`${GFX_BASE}tiles/${o}.png`, `${GFX_BASE}tiles/${o}_1.png`, `${GFX_BASE}tiles/${o}_2.png`]);
    return list.filter(Boolean);
  }
  // 지금 쓸 수 있는 타일셋 { base, vars }. 로딩 중인 파일이 있으면 끝난 뒤 onReady로 다시 그리게 한다.
  function pick(dgId, onReady) {
    for (const set of candidates(dgId)) {
      const base = load(set[0], onReady);
      if (base.state === 'loading') return null;
      if (base.state !== 'ok') continue;
      const vars = [];
      for (const src of set.slice(1)) {
        if (!src) { vars.push(null); continue; }
        const v = load(src, onReady);
        vars.push(v.state === 'ok' && v.img.width === base.img.width ? v : null);
      }
      return { base, vars };
    }
    return null;
  }
  function status(dgId) {
    const u = setOf(uploaded[dgId]);
    if (u) return '불러옴' + (u.filter(Boolean).length > 1 ? ` +변형 ${u.filter(Boolean).length - 1}` : '');
    const e = imgs[`tiles/${dgId}.png`];
    if (e && e.state === 'ok') return '폴더';
    if (uploaded['*']) return '공통';
    const d = imgs['tiles/default.png'];
    if (d && d.state === 'ok') return '폴더(공통)';
    return '';
  }
  function setUploaded(key, set) {
    if (set) uploaded[key] = set; else delete uploaded[key];
    try { localStorage.setItem(KEY, JSON.stringify(uploaded)); return true; } catch (e) { return false; }
  }
  const readUrl = file => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(file); });
  const readImg = url => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
  // 파일 선택 → 검사 → 저장. tileset_0/1/2.png를 한꺼번에 고르면 변형까지 함께 저장한다.
  async function importFiles(key, files) {
    const slot = f => { const m = f.name.match(/[_-](\d)\.png$/i); const n = m ? +m[1] : 0; return n <= 2 ? n : 0; };
    const set = [];
    for (const f of [...files].sort((p, q) => slot(p) - slot(q))) {
      const url = await readUrl(f), img = url && await readImg(url);
      if (!img) return { ok: false, msg: `${f.name}: 이미지를 읽을 수 없습니다.` };
      if (!validDtef(img)) return { ok: false, msg: `${f.name}: DTEF 형식이 아닙니다. (${img.width}×${img.height}, 가로:세로가 18:8이어야 합니다. 예: 432×192)` };
      set[slot(f)] = url;
    }
    if (!set[0]) return { ok: false, msg: '기본 타일셋(tileset_0.png)이 필요합니다. 변형 파일만으로는 쓸 수 없습니다.' };
    const w0 = (await readImg(set[0])).width;
    for (const u of set.slice(1)) if (u && (await readImg(u)).width !== w0) return { ok: false, msg: '변형 파일의 크기가 기본 타일셋과 다릅니다.' };
    for (let i = 0; i < set.length; i++) if (!set[i]) set[i] = null;
    if (!setUploaded(key, set)) return { ok: false, msg: '브라우저 저장 공간이 부족합니다.' };
    return { ok: true, vars: set.filter(Boolean).length - 1 };
  }
  // 게임 시작 시 폴더의 타일셋을 미리 확인
  function probe() { DUNGEONS.forEach(d => load(`tiles/${d.id}.png`)); load('tiles/default.png'); }

  // ── 원작 형식 타일셋으로 그리기 ──
  const VAR_CHANCE = [0.7, 0.15, 0.15];   // 기본 / 변형1 / 변형2 가 나올 비율
  // 기본 타일셋에 없는 모양 칸 (원본 시트에 그 모양이 없음. 예: 쌍권의 탑·불탄 탑)은 가장 비슷한 모양으로 그린다 (v0.92)
  //  상하좌우가 같은 모양을 먼저, 그다음 모서리가 덜 다른 모양. 비어 있는 칸을 그리면 검게 보였다
  const bits = m => { let n = 0; for (; m; m &= m - 1) n++; return n; };
  const CARD = N | E | S | W;
  function filled(set, block, i) {
    const empty = set.base.empty;
    if (!empty || !empty.has(Math.floor(i / 6) * 18 + block * 6 + i % 6)) return i;
    const m = LAYOUT[i];
    let best = 7, cost = Infinity;
    LAYOUT.forEach((n, j) => {
      if (n == null || empty.has(Math.floor(j / 6) * 18 + block * 6 + j % 6)) return;
      const c = bits((m ^ n) & CARD) * 8 + bits((m ^ n) & ~CARD);
      if (c < cost) { cost = c; best = j; }
    });
    return best;
  }
  function drawDtef(g, set, D) {
    const img = set.base.img, ts = img.width / 18;
    for (let y = 0; y < D.h; y++) for (let x = 0; x < D.w; x++) {
      const isWall = D.tiles[y * D.w + x] !== 1;
      const block = isWall ? 0 : 2;   // 벽, (물), 바닥
      const i = filled(set, block, RULE_INDEX[maskAt(D, x, y, isWall)] ?? 7);
      const col = block * 6 + i % 6, row = Math.floor(i / 6);
      const sx = col * ts, sy = row * ts, dx = x * TILE, dy = y * TILE;
      g.drawImage(img, sx, sy, ts, ts, dx, dy, TILE, TILE);
      // 변형 고르기: 뽑힌 변형이 그 칸에 비어 있으면 기본 타일 그대로 둔다
      const r = hash(x, y, 90);
      const v = r < VAR_CHANCE[0] ? 0 : r < VAR_CHANCE[0] + VAR_CHANCE[1] ? 1 : 2;
      const ve = set.vars[v - 1];
      if (v > 0 && ve && !(ve.empty && ve.empty.has(row * 18 + col))) g.drawImage(ve.img, sx, sy, ts, ts, dx, dy, TILE, TILE);
    }
  }

  // ── 코드로 그리는 타일 ──
  // 칸마다 항상 같은 값이 나오는 난수 (다시 그려도 모양이 바뀌지 않게)
  function hash(x, y, k) {
    let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = v => clamp(Math.round(v + amt * 255), 0, 255);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }
  const DECO = {
    forest: 'grass', beach: 'shell', crystal: 'crystal', plains: 'flower', swamp: 'puddle', volcano: 'lava', desert: 'ripple',
    frost: 'snow', storm: 'wave', dark: 'root', mine: 'ore', sky: 'cloud', canyon: 'ember', summit: 'star', trial: 'pebble', twilight: 'rune', mystery: 'rune', eternal: 'star',
    burned: 'ember', whirl: 'wave', seafloor: 'shell', ruins: 'rune', shrine: 'root', altar: 'flower', coronet: 'crystal', spiral: 'ore', areazero: 'crystal',
  };
  function drawDeco(g, kind, px, py, r, r2, pal) {
    const cx = px + 4 + r * 14, cy = py + 5 + r2 * 13;
    switch (kind) {
      case 'grass': g.fillStyle = shade(pal[3], -0.18); for (let k = 0; k < 3; k++) g.fillRect(cx + k * 2, cy - k % 2 * 2, 1, 4 + k % 2 * 2); break;
      case 'flower': g.fillStyle = r > 0.5 ? '#fff4a0' : '#ffb3d0'; g.fillRect(cx, cy, 3, 3); g.fillStyle = '#e8a33a'; g.fillRect(cx + 1, cy + 1, 1, 1); break;
      case 'shell': g.fillStyle = '#f6e7d0'; g.beginPath(); g.arc(cx, cy, 2.5, Math.PI, 0); g.fill(); g.fillStyle = '#d8b99a'; g.fillRect(cx - 2, cy, 5, 1); break;
      case 'crystal': g.fillStyle = r > 0.5 ? '#d6c8ff' : '#a8f0ff'; g.beginPath(); g.moveTo(cx, cy - 5); g.lineTo(cx + 2, cy); g.lineTo(cx, cy + 2); g.lineTo(cx - 2, cy); g.fill(); break;
      case 'puddle': g.fillStyle = 'rgba(70,110,80,0.55)'; g.beginPath(); g.ellipse(cx, cy, 4, 2, 0, 0, 7); g.fill(); break;
      case 'lava': g.strokeStyle = '#ff7a2a'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx - 3, cy); g.lineTo(cx, cy + 2); g.lineTo(cx + 3, cy - 1); g.stroke(); break;
      case 'ripple': g.strokeStyle = shade(pal[2], -0.12); g.lineWidth = 1; g.beginPath(); g.arc(cx, cy + 4, 5, Math.PI * 1.2, Math.PI * 1.8); g.stroke(); break;
      case 'snow': g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(cx, cy, 3, 1.5, 0, 0, 7); g.fill(); break;
      case 'wave': g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx - 4, cy); g.quadraticCurveTo(cx - 2, cy - 2, cx, cy); g.quadraticCurveTo(cx + 2, cy + 2, cx + 4, cy); g.stroke(); break;
      case 'root': g.strokeStyle = shade(pal[3], -0.2); g.lineWidth = 1; g.beginPath(); g.moveTo(cx - 4, cy - 2); g.quadraticCurveTo(cx, cy + 3, cx + 4, cy); g.stroke(); break;
      case 'ore': g.fillStyle = r > 0.6 ? '#ffd966' : '#c9d4df'; g.fillRect(cx, cy, 2, 2); g.fillRect(cx + 3, cy + 1, 1, 1); break;
      case 'cloud': g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.arc(cx, cy, 2.5, 0, 7); g.arc(cx + 3, cy, 2, 0, 7); g.fill(); break;
      case 'ember': g.fillStyle = r > 0.5 ? '#ffb347' : '#ff6a3d'; g.fillRect(cx, cy, 1, 1); g.fillRect(cx + 2, cy - 2, 1, 1); break;
      case 'star': g.fillStyle = 'rgba(255,255,220,0.8)'; g.fillRect(cx, cy - 1, 1, 3); g.fillRect(cx - 1, cy, 3, 1); break;
      case 'pebble': g.fillStyle = shade(pal[3], -0.15); g.beginPath(); g.ellipse(cx, cy, 2, 1.5, 0, 0, 7); g.fill(); break;
      case 'rune': g.strokeStyle = 'rgba(255,220,255,0.35)'; g.lineWidth = 1; g.strokeRect(cx - 2, cy - 2, 4, 4); break;
    }
  }
  function drawProcedural(g, D) {
    const [wall, wallEdge, floorA, floorB] = D.dg.pal;
    const deco = DECO[D.dg.id] || 'pebble';
    const fl = (x, y) => x >= 0 && y >= 0 && x < D.w && y < D.h && D.tiles[y * D.w + x] === 1;
    // 바닥
    for (let y = 0; y < D.h; y++) for (let x = 0; x < D.w; x++) {
      if (!fl(x, y)) continue;
      const px = x * TILE, py = y * TILE;
      g.fillStyle = (x + y) % 2 ? floorA : floorB; g.fillRect(px, py, TILE, TILE);
      g.fillStyle = 'rgba(0,0,0,0.05)';
      for (let k = 0; k < 3; k++) g.fillRect(px + Math.floor(hash(x, y, k) * 22), py + Math.floor(hash(x, y, k + 9) * 22), 2, 2);
      // 벽 아래쪽 그림자
      if (!fl(x, y - 1)) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(px, py, TILE, 5); }
      if (!fl(x - 1, y)) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(px, py, 3, TILE); }
      if (hash(x, y, 31) < 0.14) drawDeco(g, deco, px, py, hash(x, y, 32), hash(x, y, 33), D.dg.pal);
    }
    // 벽: 바닥과 맞닿은 바깥 모서리는 둥글게
    const R = 7;
    for (let y = 0; y < D.h; y++) for (let x = 0; x < D.w; x++) {
      if (fl(x, y)) continue;
      const px = x * TILE, py = y * TILE;
      const n = fl(x, y - 1), s = fl(x, y + 1), w = fl(x - 1, y), e = fl(x + 1, y);
      const rTL = n && w ? R : 0, rTR = n && e ? R : 0, rBR = s && e ? R : 0, rBL = s && w ? R : 0;
      g.fillStyle = wall;
      g.beginPath();
      g.moveTo(px + rTL, py); g.lineTo(px + TILE - rTR, py); g.arcTo(px + TILE, py, px + TILE, py + rTR, rTR);
      g.lineTo(px + TILE, py + TILE - rBR); g.arcTo(px + TILE, py + TILE, px + TILE - rBR, py + TILE, rBR);
      g.lineTo(px + rBL, py + TILE); g.arcTo(px, py + TILE, px, py + TILE - rBL, rBL);
      g.lineTo(px, py + rTL); g.arcTo(px, py, px + rTL, py, rTL);
      g.closePath(); g.fill();
      // 바위 질감
      g.fillStyle = 'rgba(0,0,0,0.16)';
      for (let k = 0; k < 4; k++) { const a = hash(x, y, k + 40), b = hash(x, y, k + 50); if (!(n || s || w || e) || a > 0.2) g.fillRect(px + 3 + Math.floor(a * 16), py + 3 + Math.floor(b * 16), 3, 2); }
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(px + 2 + Math.floor(hash(x, y, 60) * 18), py + 2 + Math.floor(hash(x, y, 61) * 18), 2, 2);
      // 바닥 쪽으로 향한 테두리 (남쪽은 입체적인 벽면)
      g.fillStyle = wallEdge;
      if (s) { g.fillRect(px + rBL, py + TILE - 7, TILE - rBL - rBR, 7); g.fillStyle = shade(wallEdge, 0.12); g.fillRect(px + rBL, py + TILE - 7, TILE - rBL - rBR, 2); g.fillStyle = wallEdge; }
      if (n) g.fillRect(px + rTL, py, TILE - rTL - rTR, 3);
      if (w) g.fillRect(px, py + rTL, 3, TILE - rTL - rBL);
      if (e) g.fillRect(px + TILE - 3, py + rTR, 3, TILE - rTR - rBR);
      // 안쪽 모서리 (대각선만 바닥인 경우) 작은 틈
      g.fillStyle = shade(wall, -0.12);
      if (!n && !w && fl(x - 1, y - 1)) g.fillRect(px, py, 3, 3);
      if (!n && !e && fl(x + 1, y - 1)) g.fillRect(px + TILE - 3, py, 3, 3);
      // 던전별 벽 장식
      if (deco === 'snow' && s) { g.fillStyle = '#ffffff'; g.fillRect(px + rBL, py + TILE - 9, TILE - rBL - rBR, 2); }
      if (deco === 'crystal' && hash(x, y, 70) < 0.08) drawDeco(g, 'crystal', px, py, 0.5, 0.4, D.dg.pal);
      if (deco === 'ore' && hash(x, y, 71) < 0.1) drawDeco(g, 'ore', px, py, hash(x, y, 72), 0.5, D.dg.pal);
      if (deco === 'lava' && hash(x, y, 73) < 0.06) { g.fillStyle = '#ff7a2a'; g.fillRect(px + 8, py + 10, 6, 1); g.fillRect(px + 10, py + 11, 2, 2); }
    }
  }

  // 층의 지도 캔버스를 만든다. 타일셋 로딩이 끝나면 onReady로 다시 그리게 한다.
  function build(D, onReady) {
    const c = document.createElement('canvas');
    c.width = D.w * TILE; c.height = D.h * TILE;
    const g = c.getContext('2d');
    const set = pick(D.dg.id, onReady);
    if (set) drawDtef(g, set, D); else drawProcedural(g, D);
    return c;
  }

  return { build, probe, importFiles, setUploaded, status, LAYOUT, CUSTOM: CUSTOM_TILESETS, get uploaded() { return uploaded; } };
})();
