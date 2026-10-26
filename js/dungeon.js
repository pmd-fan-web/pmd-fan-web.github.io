// 던전: 맵 생성, 턴 진행, AI, 자동 탐색, 렌더링
'use strict';

const Dungeon = (() => {
  let D = null;       // 현재 층
  let run = null;     // 현재 탐험
  const T = { base: 0, cursor: 0, moveEnd: 0, busyUntil: 0 };
  const LOG = [];
  let canvas, ctx, mini, mctx, rafId = 0, logicTimer = 0, pendingKey = null;
  let hudCache = '', logCache = '', moveCache = '', quickCache = '';

  const now = () => performance.now();
  const spd = () => (Game.save.settings.fast ? 0.55 : 1);
  const busy = () => now() < T.busyUntil;
  const P = () => D.player;
  const idx = (x, y) => y * D.w + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < D.w && y < D.h;
  const floorAt = (x, y) => inb(x, y) && D.tiles[idx(x, y)] === 1;
  // 물·용암 (v0.100): openAt = 벽이 아님 (기술·시야·던지기는 웅덩이를 지나간다), passable = 이 포켓몬이 설 수 있는 칸
  const openAt = (x, y) => inb(x, y) && D.tiles[idx(x, y)] !== 0;
  const liquidAt = (x, y) => (inb(x, y) && LIQUIDS[D.tiles[idx(x, y)]] ? D.tiles[idx(x, y)] : 0);
  const passable = (c, x, y) => floorAt(x, y) || (!!liquidAt(x, y) && canCross(c, liquidAt(x, y)));
  // 탐험대(리더·동료)는 별명이 있으면 별명으로 (변신·일루전으로 겉모습이 바뀐 동안은 그 포켓몬 이름)
  const nickOf = c => (c && (c.player || c.ally) && !c.fsp && Game.save && Game.save.roster[c.rsp || c.sp]?.nick) || '';
  const nm = c => (c.outlaw ? '수배범 ' : '') + (nickOf(c) || spName(looksOf(c)));

  // cls: 로그 색 구분 (super 효과가 굉장함 / weak 효과가 별로)
  function log(text, at, cls) {
    LOG.push({ text, at: at ?? Math.max(T.cursor, now()), cls });
    if (LOG.length > 300) LOG.shift();
  }

  // ───────────────────────── 맵 생성 ─────────────────────────
  function genMap() {
    const W = 54, H = 32, cols = 4, rows = 3;
    const cw = Math.floor((W - 2) / cols), ch = Math.floor((H - 2) / rows);
    const tiles = new Uint8Array(W * H), room = new Int16Array(W * H).fill(-1);
    const cells = [], rooms = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      cells.push({ r, c, x0: 1 + c * cw, y0: 1 + r * ch, isRoom: Math.random() < 0.8 });
    }
    while (cells.filter(c => c.isRoom).length < 6) pick(cells.filter(c => !c.isRoom)).isRoom = true;
    for (const cell of cells) {
      if (cell.isRoom) {
        const rw = rint(4, cw - 3), rh = rint(3, ch - 3);
        const rx = cell.x0 + rint(1, cw - rw - 1), ry = cell.y0 + rint(1, ch - rh - 1);
        cell.room = rooms.length;
        rooms.push({ x: rx, y: ry, w: rw, h: rh });
        for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) { tiles[y * W + x] = 1; room[y * W + x] = cell.room; }
      } else {
        cell.px = cell.x0 + rint(2, cw - 3); cell.py = cell.y0 + rint(2, ch - 3);
        tiles[cell.py * W + cell.px] = 1;
      }
    }
    const at = (r, c) => cells[r * cols + c];
    const pt = cell => cell.isRoom
      ? { x: rint(rooms[cell.room].x, rooms[cell.room].x + rooms[cell.room].w - 1), y: rint(rooms[cell.room].y, rooms[cell.room].y + rooms[cell.room].h - 1) }
      : { x: cell.px, y: cell.py };
    const dig = (x, y) => { if (tiles[y * W + x] === 0) tiles[y * W + x] = 1; };
    function carve(a, b) {
      const pa = pt(a), pb = pt(b);
      if (a.r === b.r) {
        const mx = Math.floor((pa.x + pb.x) / 2);
        for (let x = Math.min(pa.x, mx); x <= Math.max(pa.x, mx); x++) dig(x, pa.y);
        for (let y = Math.min(pa.y, pb.y); y <= Math.max(pa.y, pb.y); y++) dig(mx, y);
        for (let x = Math.min(mx, pb.x); x <= Math.max(mx, pb.x); x++) dig(x, pb.y);
      } else {
        const my = Math.floor((pa.y + pb.y) / 2);
        for (let y = Math.min(pa.y, my); y <= Math.max(pa.y, my); y++) dig(pa.x, y);
        for (let x = Math.min(pa.x, pb.x); x <= Math.max(pa.x, pb.x); x++) dig(x, my);
        for (let y = Math.min(my, pb.y); y <= Math.max(my, pb.y); y++) dig(pb.x, y);
      }
    }
    // 신장 트리 + 추가 연결
    const seen = new Set();
    const stack = [cells[rand(cells.length)]];
    seen.add(stack[0]);
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const nb = [[0, 1], [1, 0], [0, -1], [-1, 0]].map(([dr, dc]) => at(cur.r + dr, cur.c + dc))
        .filter(n => n && n.r >= 0 && n.r < rows && n.c >= 0 && n.c < cols && !seen.has(n) && Math.abs(n.r - cur.r) + Math.abs(n.c - cur.c) === 1);
      if (!nb.length) { stack.pop(); continue; }
      const n = pick(nb); seen.add(n); carve(cur, n); stack.push(n);
    }
    for (let k = 0; k < 3; k++) {
      const a = pick(cells), horiz = Math.random() < 0.5;
      const b = horiz ? (a.c + 1 < cols ? at(a.r, a.c + 1) : null) : (a.r + 1 < rows ? at(a.r + 1, a.c) : null);
      if (b) carve(a, b);
    }
    return { w: W, h: H, tiles, room, rooms };
  }

  // 물·용암 웅덩이 (v0.100): 원작처럼 벽 자리를 대신한다 (바닥은 그대로라 길을 막지 않는다)
  //  방·복도 둘레의 벽에 듬성듬성 작은 웅덩이 여러 개 + 벽 속의 커다란 호수 (양은 던전 테마마다). 맵 가장자리 한 칸은 늘 벽
  function placeLiquid(dg) {
    const tile = liquidTileOf(dg), th = liquidTheme(dg);   // 던전 테마별 양 (js/defs.js LIQUID_THEMES)
    if (!tile || Math.random() >= th.chance) return;
    const inner = (x, y) => x >= 1 && y >= 1 && x < D.w - 1 && y < D.h - 1;
    const wallAt = (x, y) => inner(x, y) && D.tiles[idx(x, y)] === 0;
    const nearOpen = (x, y, r) => { for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) if (floorAt(xx, yy)) return true; return false; };
    const grow = (sx, sy, size) => {   // 벽 칸을 따라 번져 나가는 웅덩이 (모양이 너무 반듯하지 않게 이웃 칸을 무작위로)
      if (!wallAt(sx, sy)) return 0;
      const blob = [idx(sx, sy)]; D.tiles[blob[0]] = tile;
      for (let tries = 0; blob.length < size && tries < size * 10; tries++) {
        const b = pick(blob), [dx, dy] = DIRS[pick([0, 2, 4, 6])], x = b % D.w + dx, y = ((b / D.w) | 0) + dy;
        if (!wallAt(x, y)) continue;
        D.tiles[idx(x, y)] = tile; blob.push(idx(x, y));
      }
      return blob.length;
    };
    const walls = [];
    for (let y = 1; y < D.h - 1; y++) for (let x = 1; x < D.w - 1; x++) if (wallAt(x, y)) walls.push([x, y]);
    const edge = walls.filter(([x, y]) => nearOpen(x, y, 1));   // 방·복도에 붙은 벽
    // 작은 웅덩이: 방·복도 둘레에 듬성듬성
    for (let k = rint(th.small[0], th.small[1]); k > 0 && edge.length; k--) { const [x, y] = pick(edge); grow(x, y, rint(th.smallSize[0], th.smallSize[1])); }
    // 큰 호수: 벽 속 깊은 곳에서 시작해 방 가장자리까지 번진다
    for (let k = rint(th.lakes[0], th.lakes[1]); k > 0; k--) { const deep = walls.filter(([x, y]) => wallAt(x, y) && !nearOpen(x, y, 2)); if (!deep.length) break; const [x, y] = pick(deep); grow(x, y, rint(th.lakeSize[0], th.lakeSize[1])); }
  }
  // 복도(방이 아닌 바닥)가 r칸 안에 있는지: 방 입구 근처에는 함정을 만들지 않는다
  function nearCorridor(x, y, r) {
    for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) if (floorAt(xx, yy) && D.room[idx(xx, yy)] < 0) return true;
    return false;
  }
  // 바닥·적이 떨어뜨리는 것 하나: 메가스톤 → 드롭 표 (null이면 돈 무더기). 청정의 탑·오늘의 도전은 돈 대신 다시 뽑는다
  const FLASH_R = 10;   // 플래시로 밝히는 지도 범위 (칸)
  // 자연 회복 배율 (v0.102 보강): 특성과 지닌 물건(·증표)의 늘어나는 몫을 더한다. 예) 재생력 2배 + 먹다남은음식 2배 = 3배 (예전에는 곱해서 4배)
  const regenMul = (c, H) => 1 + Math.max(0, (abVal(c, 'regen') || 1) - 1) + Math.max(0, (H.regen || 1) - 1);
  // 이 층의 임무 대상 (v1.03 보강): 아직 끝나지 않았는데 층에 없으면 놓는다. 층을 만들 때와 몇 턴마다 다시 확인해서, 자리를 못 찾았거나 어떤 이유로 사라진 대상도 되살린다
  function ensureMissionTargets() {
    if (!D || !run || D.dg.mode !== 'normal' || run.hard) return;
    for (const ms of Game.save.missions.accepted) {
      if (ms.dungeon !== D.dg.id || ms.floor !== run.floor || run.done.includes(ms.id)) continue;
      if (ms.kind === 'find' ? D.items.some(it => it.mission === ms.id) || [P(), ...D.mons].some(c => c && c.item === 'quest') || (run.bag || []).some(b => b.mission === ms.id)
        : D.mons.some(m => m.mission === ms.id && m.hp > 0)) continue;
      if (ms.kind === 'outlaw' && D.corpses.some(m => m.mission === ms.id)) continue;   // 쓰러뜨렸으면 그걸로 끝 (missionDone)
      const t = randomRoomTile({ noItem: true, far: 4 }) || randomRoomTile({ noItem: true }) || randomRoomTile({});
      if (!t) continue;
      if (ms.kind === 'rescue' || ms.kind === 'sos') {
        const c = makeCreature(ms.client, ms.kind === 'sos' ? ms.lv : 5); c.npc = true; c.mission = ms.id; c.x = t.x; c.y = t.y;
        if (ms.kind === 'sos') { c.shiny = !!ms.shiny; c.friend = true; c.status = 'slp'; c.statusT = 99999; }
        Sprites.load(ms.client, c.shiny); D.mons.push(c);
      } else if (ms.kind === 'outlaw') {
        const c = spawnEnemy(t, ms.target, ms.lv); c.lv = ms.lv; c.hpMul = 1.6; recalc(c); c.hp = c.maxhp;
        c.outlaw = true; c.mission = ms.id;
      } else if (ms.kind === 'find') {
        D.items.push({ ...t, id: 'quest', n: 1, mission: ms.id });
      }
    }
  }
  function floorDrop(lvl) {
    for (let k = 0; k < 8; k++) { const id = rollMega('floor', lvl, D.dg) || pickDrop(D.dropLv, D.dg); if (id || !itemDg()) return id; }
    return 'oran';
  }
  const itemDg = () => !!(D.dg.pure || D.dg.daily);   // 돈 대신 아이템이 떨어지는 던전 (v1.02)
  function randomRoomTile(opts = {}) {
    for (let tries = 0; tries < 400; tries++) {
      const r = opts.room != null ? D.rooms[opts.room] : pick(D.rooms);
      const x = rint(r.x, r.x + r.w - 1), y = rint(r.y, r.y + r.h - 1);
      if (!floorAt(x, y) || creatureAt(x, y)) continue;
      if (opts.noItem && (itemAt(x, y) || (D.stairs && D.stairs.x === x && D.stairs.y === y) || trapAt(x, y) || (D.shop && D.shop.tiles.has(idx(x, y))))) continue;
      if (opts.hidden && D.visible[idx(x, y)]) continue;
      if (opts.far && D.player && Math.max(Math.abs(x - D.player.x), Math.abs(y - D.player.y)) < opts.far) continue;
      return { x, y };
    }
    return null;
  }

  // 층 적 구성
  // 그 층에 나올 수 있는 포켓몬 후보 (층마다 이 중 6종이 무작위로 뽑힌다)
  // ── 던전 컨셉 (js/concepts.js): 이름 → 진화 계열. 계열마다 그 층의 강함에 가장 가까운 모습이 나온다 ──
  const bstOf = id => DATA.species[id].b.reduce((a, b) => a + b, 0);
  const UB_IDS = new Set([793, 794, 795, 796, 797, 798, 799, 803, 804, 805, 806]);   // 울트라비스트: 울트라 차원의 틈 컨셉에서만
  let conceptCache = null;
  function concepts() {
    if (conceptCache) return conceptCache;
    const byName = {}, parent = {};
    for (const id of SPECIES_IDS) { byName[DATA.species[id].n] = +id; for (const v of DATA.species[id].v) parent[v[0]] = +id; }
    const family = id => {   // 전설·환상이 아니면 진화 계열 전체, 전설·환상은 그 포켓몬만
      if (DATA.species[id].lg) return [id];
      let root = id; while (parent[root]) root = parent[root];
      const out = [], q = [root];
      while (q.length) { const c = q.shift(); if (hasSprite(c) && !DATA.species[c].lg) out.push(c); for (const v of DATA.species[c].v) q.push(v[0]); }
      return out.length ? out : [id];
    };
    conceptCache = {};
    for (const [dg, names] of Object.entries(CONCEPT_NAMES)) conceptCache[dg] = [...new Set(names)].map(n => byName[n]).filter(Boolean).map(family);
    return conceptCache;
  }
  // 그 층에 나올 수 있는 포켓몬: concept(컨셉 계열마다 그 층에 맞는 모습) + cand(던전 타입에 맞는 나머지)
  const CAND_FALLBACK = 30;   // 강함이 맞는 후보가 8종도 안 될 때 고르는 가장 가까운 포켓몬 수
  function floorCandidates(dg, floor) {
    const prog = dg.floors > 1 ? (floor - 1) / (dg.floors - 1) : 0;
    const lvl = dg.endless ? endlessLv(floor) : Math.round(dg.lv[0] + (dg.lv[1] - dg.lv[0]) * prog);   // 끝없는 던전: 층마다 +1, Lv100까지
    const target = 230 + lvl * 6.5;
    const fams = concepts()[dg.id] || [];
    // 계열마다 강함이 가장 가까운 모습. 같은 강함의 갈래 진화(시라소몬·홍수몬·카포에라, 이브이의 진화형 등)는 모두 (v0.92)
    const concept = [...new Set(fams.flatMap(f => { const gap = id => Math.abs(bstOf(id) - target), m = Math.min(...f.map(gap)); return f.filter(id => gap(id) === m); }))]
      .sort((a, b) => Math.abs(bstOf(a) - target) - Math.abs(bstOf(b) - target));
    // 메가 진화의 탑: 메가진화하는 포켓몬(전설 제외)만
    if (dg.megaAll) return { lvl, target, concept: [], cand: megaBases().filter(id => hasSprite(id) && !DATA.species[id].lg).map(id => ({ id, s: DATA.species[id], bst: bstOf(id) })) };
    const all = SPECIES_IDS.map(id => ({ id: +id, s: DATA.species[id], bst: bstOf(id) }))
      .filter(o => !o.s.lg && !UB_IDS.has(o.id) && !concept.includes(o.id) && (!dg.types || o.s.t.some(t => dg.types.includes(t))));
    // 끝없는 던전 (v1.06): 강함으로 거르지 않고 그 층 타입의 포켓몬 모두. 50층부터는 더 진화하지 않는 포켓몬만
    if (dg.endless) {
      if (floor <= ENDLESS.maxFloor) return { lvl, target, concept: [], cand: all };
      // 51층부터: 최종 진화만 + 울트라비스트도 (패러독스는 makePool에서 드물게 하지 않는다)
      const ub = [...UB_IDS].filter(id => hasSprite(id) && !concept.includes(id) && (!dg.types || DATA.species[id].t.some(t => dg.types.includes(t)))).map(id => ({ id, s: DATA.species[id], bst: bstOf(id) }));
      return { lvl, target, concept: [], cand: [...all.filter(o => !o.s.v.length), ...ub] };
    }
    let cand = [];
    for (const w of [70, 110, 170, 260]) { cand = all.filter(o => Math.abs(o.bst - target) <= w); if (cand.length >= 8) break; }
    // 그래도 모자라면 (적 레벨이 아주 높은 층: 목표 강함보다 센 포켓몬이 거의 없다) 강함이 가장 가까운 CAND_FALLBACK종
    // (예전에는 모든 포켓몬이 후보가 되어 에리어 제로 최심부 14층부터 미진화체까지 나왔다)
    if (cand.length < 8) cand = all.slice().sort((a, b) => Math.abs(a.bst - target) - Math.abs(b.bst - target)).slice(0, CAND_FALLBACK);
    return { lvl, target, cand, concept };
  }
  // 아직 못 얻은 포켓몬이 더 잘 나온다: 영입하지 않은 포켓몬(영입한 포켓몬의 진화 전 모습은 영입한 것으로 본다),
  // 그 층에 그런 포켓몬이 없으면 이로치를 아직 못 얻은 포켓몬이 WANT_W배 잘 나온다 (이로치 확률은 그대로)
  const WANT_W = 2;
  function ownedSet() { const s = Game.save; return new Set(s ? Object.keys(s.roster).flatMap(k => [+k, ...preEvos(+k)]) : []); }
  const shinyMissing = id => !!DATA.species[id].sh && !Game.shinyOk(+id);
  function wantSet(ids) {
    if (run.daily || run.mode === 'rogue') return new Set();   // 오늘의 도전은 모두 같은 층이어야 하므로, 로그라이크는 영입·이로치와 상관없는 던전이라 그대로 (v0.102 보강)
    const own = ownedSet();
    const nw = ids.filter(id => !own.has(+id));
    return new Set(nw.length ? nw : ids.filter(shinyMissing));
  }
  // 목록에서 하나를 꺼낸다 (원하는 포켓몬은 WANT_W배)
  const takeWanted = (arr, want, key = x => x) => { const i = weighted(arr.map((x, j) => [j, want.has(+key(x)) ? WANT_W : 1])); return arr.splice(i, 1)[0]; };
  function makePool(dg, floor) {
    const { lvl, target, cand, concept } = floorCandidates(dg, floor);
    const want = wantSet([...concept, ...cand.map(o => o.id)]);
    const pool = [];
    // 컨셉 포켓몬을 먼저 (CONCEPT_SHARE종), 나머지는 던전 타입에서
    const cc = concept.slice();
    // 컨셉 목록의 전설(코스모그·타입:널: 진화형이 보스)은 드물게: 뽑혀도 LEGEND_CONCEPT_RATE 확률로만 남긴다
    while (pool.length < CONCEPT_SHARE && cc.length) { const id = takeWanted(cc, want); if (!DATA.species[id].lg || Math.random() < LEGEND_CONCEPT_RATE) pool.push(id); }
    // 패러독스 포켓몬은 테마 던전이 아니면 드물게: 뽑혀도 PARADOX_RATE 확률로만 남기고 아니면 다시 뽑는다
    const para = new Set(dg.extra || (dg.endless && floor > ENDLESS.maxFloor) ? [] : [...PARADOX_PAST, ...PARADOX_FUTURE]);   // 끝없는 던전 51층부터는 패러독스도 보통 확률
    const poolN = dg.endless ? ENDLESS.poolN : 6;   // 끝없는 던전은 층마다 12종
    while (pool.length < poolN && cand.length) {
      const id = takeWanted(cand, want, o => o.id).id;
      if (!para.has(id) || Math.random() < PARADOX_RATE) pool.push(id);
    }
    // 테마 던전: 시리즈 포켓몬을 일반 적으로 섞는다 (강함이 비슷한 쪽 우선)
    if (dg.extra) {
      const ex = extraPool(dg).filter(id => !pool.includes(id)).sort((a, b) => Math.abs(DATA.species[a].b.reduce((s, v) => s + v, 0) - target) - Math.abs(DATA.species[b].b.reduce((s, v) => s + v, 0) - target));
      for (const id of ex.slice(0, 6).sort(() => Math.random() - 0.5).slice(0, 3)) if (!DATA.species[id].lg || Math.random() < LEGEND_CONCEPT_RATE) pool.push(id);   // 전설(코스모그 등)은 드물게
    }
    D.want = wantSet(pool);
    return { pool, lvl };
  }
  // 전설 던전(별의 정상): 최종 보스는 전설 포켓몬 중 무작위 하나. 후보는 층마다 강함이 가까운 25종을 모은 것
  for (const dg of DUNGEONS) if (dg.legend && !dg.bosses) {
    const lg = SPECIES_IDS.filter(id => DATA.species[id].lg).map(id => ({ id: +id, bst: DATA.species[id].b.reduce((a, b) => a + b, 0) }));
    const set = new Set();
    for (let f = 1; f <= dg.floors; f++) {
      const { target } = floorCandidates(dg, f);
      lg.slice().sort((a, b) => Math.abs(a.bst - target) - Math.abs(b.bst - target)).slice(0, 25).forEach(o => set.add(o.id));
    }
    dg.bosses = [...set].sort((a, b) => a - b);
  }

  // 층에 처음 있는 적 중 이 확률로 잠들어 있다. 공격받거나, 탐험대가 옆에 오면 가끔 깬다
  const NAP_CHANCE = 0.2, NAP_WAKE = 0.3;
  function wakeNap(c, at, msg) {
    if (!c.napping) return;
    c.napping = false; if (c.status === 'slp') { c.status = null; c.statusT = 0; }
    if (msg && seen(c)) log(`${jo(nm(c), '이')} 눈을 떴다!`, at);
  }
  // ── 끝없는 던전 (v1.05) ──
  // 적: 규칙 '단단한 적'·'사나운 적' (보스는 보스 배율 위에 곱한다). Lv100 뒤로는 레벨 자체가 계속 오른다
  function endlessScale(c) {
    if (D.rule !== 'hp' && D.rule !== 'stat') return;
    if (D.rule === 'hp') c.hpMul = (c.hpMul || 1) * 1.5;
    if (D.rule === 'stat') c.statMul = (c.statMul || 1) * 1.2;
    recalc(c); c.hp = c.maxhp;
  }
  // 층마다 다른 던전 하나를 빌린다 (v1.05): 그 던전의 타일셋·적 타입·날씨·웅덩이. 바로 전 층과 같은 던전은 피한다
  let endlessLooks = null;
  function endlessFloorDg(dg) {
    if (!dg.endless) return dg;
    endlessLooks = endlessLooks || DUNGEONS.filter(d => d.mode === 'normal' && !d.endless && !d.daily && d.types && d.types.length);
    const td = pick(endlessLooks.filter(d => d.id !== run.eLook) );
    run.eLook = td.id;
    return { ...dg, look: td.id, lookN: td.n, types: td.types, pal: td.pal, wx: td.wx || [] };
  }
  // 레벨 한계: 끝없는 던전에서만 없다 (ENDLESS_MAX_LEVEL)
  const lvCap = () => (D && D.dg && D.dg.endless ? ENDLESS_MAX_LEVEL : MAX_LEVEL);
  // 보스: 전설·환상 중에서 (이번 탐험에서 아직 안 나온 쪽, 아직 영입하지 않은 쪽이 잘 나온다)
  let endlessBossCache = null;
  function endlessBosses() {
    endlessBossCache = endlessBossCache || SPECIES_IDS.map(Number).filter(id => DATA.species[id].lg && hasSprite(id) && !DATA.species[id].fc && !NO_RECRUIT.includes(id) && !UB_IDS.has(id));
    run.eBossUsed = run.eBossUsed || [];
    const left = endlessBossCache.filter(id => !run.eBossUsed.includes(id));
    return left.length ? left : endlessBossCache;
  }
  // 구미 (그 탐험 동안만): 하나에 +5 (HP +10), 능력치마다 +255 (HP +510)까지. 캐릭터 기록에는 남지 않는다
  function endlessGummy(c, it, at) {
    const key = c.rsp || c.sp; run.eb = run.eb || {};
    const eb = run.eb[key] = run.eb[key] || {};
    const up = it.gummy.filter(k => (eb[k] || 0) < endlessGummyCap(k));
    const got = up.map(k => { const v = Math.min(endlessGummyCap(k) - (eb[k] || 0), endlessGummyAmt(k)); eb[k] = (eb[k] || 0) + v; return `${STAT_KO[k]} +${v}`; });
    c.eBoost = eb; recalc(c);
    if (up.length) run.eGum = (run.eGum || 0) + 1;   // 랭킹 요약: 먹은 구미 수
    log(up.length ? `${nm(c)}의 ${got.join(', ')} (이번 탐험 동안)` : `${jo(nm(c), '은')} 더 이상 능력이 오르지 않는다. (능력치마다 +${ENDLESS.gummyCap}까지)`, at);
    if (up.length) Sound.play('levelup', at);
  }
  function spawnEnemy(pos, sp, lv) {
    if (D.thief) return spawnAngryKecleon(pos);
    // 이로치를 못 얻은 포켓몬은 WANT_W배, 리더 특성(타오르는불꽃·마중물·자력 등)의 타입은 LURE_W배
    const lure = leadField(run.p).lure;
    sp = sp || ((D.want && D.want.size) || lure ? weighted(D.pool.map(id => [id, (D.want && D.want.has(+id) ? WANT_W : 1) * (lure && DATA.species[id].t.includes(lure) ? LURE_W : 1)])) : pick(D.pool));
    const c = makeCreature(sp, run.hard ? run.hardLv : clamp((lv || D.lvl) + rint(-1, 1), 1, lvCap()));   // 하드모드: 레벨 고정
    c.enemy = true; c.x = pos.x; c.y = pos.y; c.dir = rand(8);
    c.shiny = !!DATA.species[sp].sh && shinyRand() < SHINY_CHANCE * (hasShinyCharm(Game.save) ? SHINY_CHARM_MUL : 1);   // 빛나는부적: 도감 완성 업적이 있으면 늘 2배
    Sprites.load(sp, c.shiny);
    rollEnemyForm(c);
    if (run.hard) { c.moves = hardMoves(c); c.hpMul = HARD_FOE.hp; c.statMul = HARD_FOE.stat; recalc(c); c.hp = c.maxhp; }
    else if (D.dg && D.dg.endless) c.moves = hardMoves(c);   // 끝없는 던전 (v1.06): 기술 구성은 하드모드처럼
    if (D.dg && D.dg.endless) endlessScale(c);
    if (D.dg && D.dg.megaAll) { const st = megaStoneOf(sp); if (st) c.held = st; }   // 메가 진화의 탑: 메가스톤을 지니고 나와서 바로 메가진화
    applyForecast(c);
    D.mons.push(c);
    updateForm(c);
    return c;
  }

  // ── 보스 층: 큰 방 하나, 보스와 부하 둘, 보스를 쓰러뜨리면 계단이 나타난다 ──
  function genBossMap() {
    const W = 48, H = 28, tiles = new Uint8Array(W * H), room = new Int16Array(W * H).fill(-1);
    const R = { x: 13, y: 7, w: 22, h: 14 };   // 보스방 바닥 (v0.90: 28×18 → 22×14)
    for (let y = R.y; y < R.y + R.h; y++) for (let x = R.x; x < R.x + R.w; x++) { tiles[y * W + x] = 1; room[y * W + x] = 0; }
    return { w: W, h: H, tiles, room, rooms: [R] };
  }
  // 보스 후보 중 하나: 아직 영입하지 않은 포켓몬이 WANT_W배 잘 나온다 (모두 영입했으면 이로치를 못 얻은 쪽, v0.93)
  //  리더 특성(마중물·피뢰침 등)의 타입도 LURE_W배 (v1.04 보강: 예전에는 일반 적에만 적용돼서 용의 나선탑 중간 보스 케르디오에는 마중물이 듣지 않았다)
  const pickBoss = list => {
    const want = wantSet(list), lure = run.mode === 'normal' ? leadField(run.p).lure : 0;
    return want.size || lure ? weighted(list.map(id => [id, (want.has(+id) ? WANT_W : 1) * (lure && DATA.species[id].t.includes(lure) ? LURE_W : 1)])) : pick(list);
  };
  function bossSpecies(dg) {
    if (dg.endless) { const id = pickBoss(endlessBosses()); run.eBossUsed.push(id); return id; }
    if (run.floor === dg.floors) {
      const list = bossPool(dg);
      if (list.length) return pickBoss(list);   // 테마 던전: 후보 중 하나
      const fixed = BOSSES[dg.id];
      if (fixed && DATA.species[fixed]) return fixed;
    } else if (dg.mid && dg.mid.floors.includes(run.floor)) {
      // 중간 보스: 이번 탐험에서 아직 안 나온 후보 중에서
      run.midUsed = run.midUsed || [];
      let list = midPool(dg).filter(id => !run.midUsed.includes(id));
      if (!list.length) list = midPool(dg);
      if (list.length) { const id = pickBoss(list); run.midUsed.push(id); return id; }
    }
    // 로그라이크 중간 보스: 이 층 후보 중 가장 강한 포켓몬
    return D.pool.slice().sort((a, b) => DATA.species[b].b.reduce((s, v) => s + v, 0) - DATA.species[a].b.reduce((s, v) => s + v, 0))[0];
  }
  function setupBossFloor(dg, p) {
    const R = D.rooms[0], cx = R.x + Math.floor(R.w / 2);
    p.x = cx; p.y = R.y + R.h - 2 - (run.hard ? HARD_BOSS_NEAR : 0);   // 하드: 보스와 2칸 더 가까이
    D.stairs = { x: cx, y: R.y + 1 }; D.stairsHidden = true; D.noSpawn = true;
    // 이 층에서 이미 정해진 보스가 있으면 (새로고침해서 이어 한 경우) 같은 보스로: 새로고침으로 이로치·전설 보스를 다시 뽑지 못하게 (v0.89)
    const keep = run.bossPick && run.bossPick.floor === run.floor && DATA.species[run.bossPick.sp] ? run.bossPick : null;
    const sp = keep ? keep.sp : bossSpecies(dg);
    const solo = !run.hard && BOSS_SOLO.has(dg.id);   // 작은 숲: 부하 없이, 레벨 보정 없이
    const blv = Math.min(lvCap(), (run.hard ? run.hardLv : D.lvl) + (solo ? 0 : 3));   // 보스는 +3 (최고 레벨은 넘지 않는다)
    const b = spawnEnemy({ x: cx, y: R.y + 3 }, sp, blv);
    if (keep) { b.shiny = !!keep.shiny && !!DATA.species[sp].sh; if (keep.ability != null && DATA.species[sp].ab.some(a => a[0] === keep.ability)) { b.ability = keep.ability; b.baseAbility = keep.ability; } }
    b.lv = blv; recalc(b);
    const hardBoss = run.hard || !!dg.endless;   // 끝없는 던전 (v1.06): 보스도 하드모드 배율
    b.boss = true; b.hpMul = hardBoss ? HARD_BOSS.hp : 3.5; b.statMul = hardBoss ? HARD_BOSS.stat : 1.1; recalc(b); b.hp = b.maxhp;
    if (dg.endless) endlessScale(b);   // 끝없는 던전: 보스 배율 위에 층 배율
    // 특별한 모습이 있는 보스는 원래 모습으로 나타났다가, 등장 알림 뒤에 눈앞에서 바뀐다
    bossForm(b, run.floor === dg.floors || !!dg.endless);
    if (keep) { if (keep.held !== undefined) b.held = keep.held; if (keep.selForm) b.selForm = keep.selForm; }
    run.bossPick = { floor: run.floor, sp, shiny: !!b.shiny, ability: b.baseAbility ?? b.ability, held: b.held || null, selForm: b.selForm || null };
    setForm(b, null); b.hp = b.maxhp;
    if (wantedForm(b)) { b.introForm = true; Sprites.load(wantedForm(b), b.shiny); }   // 바뀔 모습의 그림도 미리 받아 둔다
    b.dir = 0; b.target = { x: p.x, y: p.y };
    D.boss = b;
    if (!solo) for (const dx of [-3, 3]) { const m = spawnEnemy({ x: cx + dx, y: R.y + 4 }); m.dir = 0; }
    Sprites.load(sp);
  }
  // 보스의 모습: 모습을 바꾸는 도구(원시회귀 구슬·금강옥 등·가면·녹슨검/방패)를 지니고, 고르는 모습(테오키스·큐레무·쉐이미·후파)은 하나를 고른다.
  // 적 Lv BOSS_MEGA_LV 이상 던전의 최종 보스는 메가진화 (레쿠쟈는 화룡점정). 싸우는 도중 바뀌는 포켓몬(지가르데·메로엣타 등)은 그 규칙대로
  const BOSS_MEGA_LV = 60;
  const BOSS_NO_MEGA = new Set(['sky']);   // 메가진화하지 않는 보스 (하늘의 탑 레쿠쟈는 원래 모습으로, v0.86)
  function bossForm(b, final) {
    const sp = b.sp;
    if (BATTLE_FORMS[sp]) return;
    if (BOSS_NO_MEGA.has(D.dg.id)) {   // 화룡점정을 알면 메가진화하므로 다른 기술로 바꿔 둔다
      const mv = MEGA_NO_STONE[sp], i = mv ? b.moves.findIndex(m => m.id === mv) : -1;
      if (i >= 0) { const alt = [406, 242, 349, 245].find(id => !b.moves.some(m => m.id === id)); b.moves[i] = newMove(b, alt); }
      return;
    }
    const items = Object.keys(ITEMS).filter(k => ITEMS[k].formTo && DATA.species[ITEMS[k].formTo].f[0] === sp);
    const formItems = items.filter(k => !ITEMS[k].mega), megas = items.filter(k => ITEMS[k].mega);
    if (formItems.length) { b.held = pick(formItems); return; }
    if (final && D.dg.lv[1] >= BOSS_MEGA_LV) {
      if (megas.length) { b.held = pick(megas); return; }
      const mv = MEGA_NO_STONE[sp];
      if (mv && FORM_KINDS_MEGA(sp)) { if (!b.moves.some(m => m.id === mv)) b.moves[0] = newMove(b, mv); return; }
    }
    const sel = formsOfKind(sp, 'select');
    if (sel.length) { b.selForm = pick(sel); giveFormSig(b); }
  }
  const FORM_KINDS_MEGA = sp => formsOfKind(sp, 'mega').length > 0;
  function bossIntro() {
    const b = D.boss; if (!b) return;
    stopAuto();
    // 이야기 (js/scenes.js): 아직 클리어하지 않은 던전이면 보스가 나타날 때의 대사를 먼저
    const part = run.floor === D.dg.floors ? 'intro' : 'mid';
    if (!run.hard && Story.hasPart(D.dg.id, part)) { Story.inDungeon(D.dg.id, part).then(() => { if (D && D.boss === b) bossIntroWindow(b); }); return; }
    bossIntroWindow(b);
  }
  function bossIntroWindow(b) {
    Sound.play('boss');
    setFace('Determined', 3000);
    UI.open({
      title: run.floor === D.dg.floors || D.dg.endless ? '⚠ 보스 층' : '⚠ 중간 보스',
      html: `<div class="boss-intro">${portraitImg(looksOf(b), 'portrait big', 'Angry', b.shiny)}<div>
        <p><b>${esc(spName(looksOf(b)))}</b> Lv${b.lv}</p><p>${esc(jo(spName(b.sp), '이'))} 앞을 가로막고 있다!</p>
        <p class="dim">쓰러뜨리면 계단이 나타난다. 보스는 상태이상이 절반만 지속된다.</p></div></div>`,
      choices: [{ label: '싸운다!', fn: () => bossTransform(b) }], cancel: () => bossTransform(b),
    });
  }
  function bossTransform(b) {
    if (!b.introForm || b.hp <= 0) return;
    b.introForm = false;
    const full = b.hp >= b.maxhp;
    formCheck(b);
    const wx = abilityOf(b).setWeather; if (wx && EXTREME_WX.includes(wx)) setWeather(wx, b, now() + 300);   // 원시회귀한 보스: 전용 날씨
    for (const m of [P(), ...allies()]) if (abilityOf(m).imposter && !m.tf) transformInto(m, b, now() + 500);   // 괴짜: 변신한 보스로
    if (full) b.hp = b.maxhp;
    if (b.fsp) Sound.play('shiny', now());
  }
  function bossDefeated(b, at) {
    D.stairsHidden = false;
    run.bossDone = run.floor; Game.saveRunSnapshot(run);   // 쓰러뜨린 순간 저장: 새로고침해도 보스가 다시 나오지 않는다
    // 이야기: 최종 보스를 쓰러뜨린 직후의 대사 (계단·영입 창보다 먼저)
    if (run.floor === D.dg.floors && !run.hard && Story.hasPart(D.dg.id, 'won')) { const id = D.dg.id; D.prompts.unshift(() => { stopAuto(); Story.inDungeon(id, 'won'); }); }
    Progress.add('bosses'); checkLater();
    setTimeout(() => { if (D) Sound.dungeon(D.dg); }, Math.max(0, at - now()) + 800);
    D.explored[idx(D.stairs.x, D.stairs.y)] = 1;
    log(`${jo(spName(b.sp), '을')} 쓰러뜨렸다! 계단이 나타났다!`, at + 200);
    setFace('Joyous', 3500);
    const bonus = D.lvl * 15;
    Game.save.money += bonus; run.money += bonus;
    log(`보스 보상으로 ${bonus} 포켓을 받았다.`, at + 300);
    if (D.dg.endless) {   // 끝없는 던전: 티켓은 바로 받는다 (쓰러져도 남는다). 구미도 떨어뜨린다
      const t = Math.floor(run.floor / ENDLESS.bossEvery), S = Game.save;
      S.tickets = (S.tickets || 0) + t; S.best.endless = Math.max(S.best.endless || 0, run.floor); run.eTickets = (run.eTickets || 0) + t;
      run.eFt = [...(run.eFt || []), run.turns || 0].slice(0, 100);   // 랭킹 요약: 10층마다 그때까지의 턴
      log(`🎟 티켓 ${t}장을 받았다! 계단에서 마을로 돌아갈 수도 있다.`, at + 400);
      // 동료 합류: 20층 보스마다 동료 목록 순서대로 한 명씩, 리더와 같은 레벨로 (다음 층부터 함께)
      if (run.floor % ENDLESS.allyEvery === 0 && (run.party || []).length < ENDLESS.allyMax) {
        const a = Game.endlessAlly(run);
        if (a) { run.party = [...(run.party || []), a]; log(`🤝 ${jo(spName(a.sp), '이')} 탐험대에 합류했다! (Lv${a.lv}, 다음 층부터 함께 간다)`, at + 500); Sound.play('levelup', at + 500); }
      }
      const gs = ['rainbowgummy', ...Array.from({ length: 2 }, () => pick(Object.keys(GUMMIES).filter(id => id !== 'rainbowgummy')))];
      for (const gid of gs) for (const [dx, dy] of DIRS) { const x = b.x + dx, y = b.y + dy; if (floorAt(x, y) && !itemAt(x, y) && !(x === D.stairs.x && y === D.stairs.y)) { D.items.push({ x, y, id: gid, n: 1 }); break; } }
    }
    // 좋은 아이템 하나 (이상한사탕, 지닌 물건, 기술머신 중)
    // 전용 도구의 주인이 보스면 가끔 그 도구를 떨어뜨린다
    const sig = sigItemsFor([b.sp]);
    // 초반 보스는 조금 드문 아이템, 그 뒤로는 지닌 물건·기술머신·사탕 (층 레벨보다 한 등급 위까지)
    const id = sig.length && Math.random() < SIG_DROP.boss ? pick(sig) : (rollMega('boss', b.lv, D.dg) || weighted(rewardPool(D.dropLv + 10, D.dg)));
    for (const [dx, dy] of [[0, 0], ...DIRS]) {
      const x = b.x + dx, y = b.y + dy;
      if (floorAt(x, y) && !itemAt(x, y) && !(x === D.stairs.x && y === D.stairs.y)) { D.items.push({ x, y, id, n: 1 }); break; }
    }
    // 로그라이크 중간 보스: 큰사과·맥스엘릭서를 하나씩 꼭 떨어뜨린다 (v0.86)
    if (D.dg.mode === 'rogue' && run.floor !== D.dg.floors) {
      for (const fid of ['bigapple', 'elixir']) for (const [dx, dy] of [[0, 0], ...DIRS, [0, 2], [2, 0], [0, -2], [-2, 0]]) {
        const x = b.x + dx, y = b.y + dy;
        if (floorAt(x, y) && !itemAt(x, y) && !(x === D.stairs.x && y === D.stairs.y)) { D.items.push({ x, y, id: fid, n: 1 }); break; }
      }
      log('중간 보스가 큰사과와 맥스엘릭서를 떨어뜨렸다!', at + 400);
    }
  }

  // 업적 확인은 한 턴에 한 번만
  let checkPending = false;
  function checkLater() { if (checkPending) return; checkPending = true; setTimeout(() => { checkPending = false; Progress.check(); }, 300); }

  // ── 표정 초상화 ──
  let faceTemp = null, faceShown = '';
  function setFace(emotion, ms) { faceTemp = { emotion, until: now() + ms }; }
  function updateFace(t) {
    const p = P(); if (!p) return;
    let e = 'Normal';
    if (D.dead) e = 'Crying';
    else if (faceTemp && t < faceTemp.until) e = faceTemp.emotion;
    else if (p.hp <= p.maxhp * 0.25) e = 'Pain';
    else if (p.status === 'slp') e = 'Sad';
    else if (p.status) e = 'Dizzy';
    else if (p.belly <= 10) e = 'Worried';
    const src = Sprites.portrait(looksOf(p), e, p.shiny);
    if (src !== faceShown) {
      faceShown = src;
      const f = document.getElementById('face');
      f.onerror = () => { if (f.src.startsWith(SPRITE_BASE)) f.src = spriteFallback(f.src); };   // CDN이 안 되면 원래 주소
      f.src = src;
    }
  }

  // 이로치 판정 (v0.102 보강): 층마다 정해 둔 씨앗으로 n번째로 나오는 적의 이로치 여부가 정해진다.
  //  씨앗은 이어하기 기록(save.run)에 남아서, 새로고침해 층을 다시 시작해도 같은 순서의 적은 같은 결과 (보스방 등에서 새로고침으로 이로치를 다시 뽑지 못하게)
  function shinyRand() {
    const sd = run.shinySeed; if (!sd) return Math.random();
    let t = (sd.seed + 0x6D2B79F5 * (++run.shinyN)) | 0;
    t = Math.imul(t ^ t >>> 15, 1 | t); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  function newFloor() {
    if (!run.shinySeed || run.shinySeed.floor !== run.floor) run.shinySeed = { floor: run.floor, seed: (Math.random() * 4294967296) >>> 0 };
    run.shinyN = 0;
    run.p.partners = dungeonById(run.dungeon).pure ? -1 : (run.party || []).length;   // 혼자 탐험 보정 (afterPlayer와 같게). 청정의 탑은 보정 없음
    untransform(run.p); (run.party || []).forEach(untransform);   // 괴짜: 지난 층의 변신을 푼다 (이 층에서 처음 만나는 적으로 다시)
    const dg = endlessFloorDg(dungeonById(run.dungeon));   // 끝없는 던전: 층마다 다른 던전의 풍경·타입
    const bossFloor = isBossFloor(dg, run.floor) && run.bossDone !== run.floor;   // 이미 쓰러뜨린 보스 층을 이어서 하면 보스 없이 (새로고침으로 보스를 다시 잡지 못하게)
    if (bossFloor) Sound.boss(); else Sound.dungeon(dg);
    Progress.seedFloor(run);   // 오늘의 도전: 날짜+층으로 맵 고정
    const m = bossFloor ? genBossMap() : genMap();
    D = { ...m, explored: new Uint8Array(m.w * m.h), visible: new Uint8Array(m.w * m.h), items: [], mons: [], corpses: [], popups: [], fx: [],
      prompts: [], learnQueue: [], delayed: [], traps: [], shop: null, houses: [], seq: 0, turn: 0, spawnT: run.hard ? 20 : 40, auto: null, ignore: new Set(), regen: 0, dg };
    const { pool, lvl } = makePool(dg, run.floor);
    D.pool = pool; D.lvl = lvl + (run.hard ? HARD_DROP_LV : 0);   // 하드모드: 아이템·돈은 한 등급 위 (적 레벨은 run.hardLv)
    D.dropLv = dropLvFor(dg, run.floor, D.lvl);   // 아이템 단계를 정하는 레벨 (로그라이크는 층 진행으로)
    D.weather = rollWeather(dg); CUR_WEATHER = D.weather; D.baseWeather = D.weather; D.wxLock = null;
    D.rule = dg.endless ? endlessRule(run, run.floor) : null;   // 끝없는 던전: 10층마다 바뀌는 특수 규칙
    if (D.rule === 'storm') { D.weather = pick(['hsand', 'hail', 'hfog']); CUR_WEATHER = D.weather; D.baseWeather = D.weather; }   // 거친 날씨
    // 끝없는 던전: 영양제·구미로 올린 능력치는 레벨에 비례, 던전에서 먹은 구미는 그 탐험 동안만 (v1.05)
    for (const c of [run.p, ...(run.party || [])]) if (c) {
      if (dg.endless) { const k = c.rsp || c.sp, ch = Game.save.roster[k]; c.boost = (ch && ch.boost) || null; c.scaleBoost = true; c.eBoost = (run.eb && run.eb[k]) || null; recalc(c); }
      else if (c.eBoost || c.scaleBoost) { c.eBoost = null; c.scaleBoost = false; recalc(c); }
    }
    D.terrain = null; CUR_TERRAIN = null; D.terByParty = false;   // 필드는 층마다 처음엔 없다
    pool.forEach(id => Sprites.load(id));
    // 탐험대가 바뀔 수 있는 모습(메가진화·폼체인지)의 그림도 미리 받아 둔다
    for (const c of [run.p, ...(run.party || [])]) if (c && FORMS_OF[c.sp]) for (const f of FORMS_OF[c.sp]) if (!formsOfKind(c.sp, 'select').includes(f) || f === c.selForm) Sprites.load(f, c.shiny);
    // 플레이어
    const p = run.p;
    D.player = p;
    p.noSleep = false;   // 유루열매는 그 층에서만 (랑사열매는 100턴)
    if (bossFloor) {
      p.dir = 4; p.tween = null; p.act = null; p.stages = p.stages || {}; p.stageT = p.stageT || {};
      p.charging = null; p.rampage = null; p.recharge = false; p.boundT = 0; p.chain = null; p.struck = new Set(); p.lastActSeq = p.lastHurtSeq = 0;
      setupBossFloor(dg, p);
      computeVis();
    } else {
    const startRoom = rand(D.rooms.length);
    const sp = randomRoomTile({ room: startRoom });
    p.x = sp.x; p.y = sp.y; p.dir = 0; p.tween = null; p.act = null; p.stages = p.stages || {}; p.stageT = p.stageT || {};
    p.charging = null; p.rampage = null; p.recharge = false; p.boundT = 0; p.chain = null; p.struck = new Set(); p.lastActSeq = p.lastHurtSeq = 0;
    // 계단
    // 계단은 원작처럼 어느 방에나 (처음 들어선 방도, v0.102 보강: 예전에는 첫 방에는 절대 없었다). 발밑에는 두지 않는다
    const sroom = rand(D.rooms.length);
    for (let k = 0; k < 20; k++) { D.stairs = randomRoomTile({ room: sroom, noItem: true }); if (!(D.stairs.x === p.x && D.stairs.y === p.y)) break; }
    const freeRooms = D.rooms.map((_, i) => i).filter(i => i !== startRoom && i !== sroom);
    if (lvl >= FEATURE_LV.shop && Math.random() < SHOP_CHANCE) makeShop(freeRooms);
    // 몬스터하우스: 보통은 한 층에 하나까지. 하드모드는 2층부터 더 자주, 여러 개
    const houseN = () => {
      if (D.rule === 'house') return 1;   // 끝없는 던전 규칙: 몬스터하우스
      if (!run.hard) return lvl >= FEATURE_LV.house && Math.random() < HOUSE_CHANCE ? 1 : 0;
      if (run.floor < 2 || Math.random() >= HARD_HOUSE.first) return 0;
      let n = 1; while (n < HARD_HOUSE.max && Math.random() < HARD_HOUSE.more) n++;
      return n;
    };
    for (let h = houseN(); h > 0 && freeRooms.length; h--) {
      const room = freeRooms.splice(rand(freeRooms.length), 1)[0];
      D.houses.push({ room, triggered: false });
      for (let i = rint(3, 6); i > 0; i--) { const t = randomRoomTile({ room, noItem: true }); if (t) { const id = rollMega('floor', lvl, D.dg) || pickDrop(D.dropLv, D.dg); D.items.push(id ? { ...t, id, n: 1 } : { ...t, money: moneyPile(lvl) }); } }
    }
    if (lvl >= FEATURE_LV.trap) {
      const kinds = Object.keys(TRAPS);
      for (let i = (rint(2, 4) + Math.floor(lvl / 25)) * (D.rule === 'trap' ? 2 : 1); i > 0; i--) {   // 끝없는 던전 규칙 '함정 지대': 2배
        const t = randomRoomTile({ noItem: true, far: 3 });
        // 복도와 붙은 칸(방 출입구 옆)에는 만들지 않는다
        if (t && !nearCorridor(t.x, t.y, 2)) { const kind = weighted(kinds.map(k => [k, TRAP_W[k] || 1])); D.traps.push({ ...t, kind, seen: TRAP_VISIBLE.includes(kind) }); }
      }
    }
    if (Math.random() < RESET_EXTRA) {   // 능력 리셋 발판 하나 더 (떨어진 능력을 되돌리러 찾아갈 수 있게)
      const t = randomRoomTile({ noItem: true, far: 3 });
      if (t && !nearCorridor(t.x, t.y, 2)) D.traps.push({ ...t, kind: 'reset', seen: true });
    }
    // 아이템 / 돈
    // 청정의 탑·오늘의 도전 (v0.102 보강): 돈 무더기 대신 아이템 (아이템 2~4 + 돈 무더기 2~4 → 아이템 4~8), 돈으로 바뀌는 몫도 아이템으로
    const pureDg = itemDg(), nMoney = pureDg ? 0 : rint(2, 4);
    const nItems = rint(ITEMS_PER_FLOOR[0], ITEMS_PER_FLOOR[1]) + (pureDg ? rint(2, 4) : 0);
    for (let i = 0; i < nItems; i++) { const t = randomRoomTile({ noItem: true }); if (t) { const id = floorDrop(lvl); D.items.push(id ? { ...t, id, n: 1 } : { ...t, money: moneyPile(lvl) }); } }
    // 전용 도구: 그 주인이 이 층에 나오면 드물게 바닥에 하나
    const sig = sigItemsFor(pool);
    if (dg.endless) for (let i = D.rule === 'gummy' ? 3 : 1; i > 0; i--) { const t = randomRoomTile({ noItem: true }); if (t) D.items.push({ ...t, id: pick(Object.keys(GUMMIES).filter(id => id !== 'rainbowgummy')), n: 1 }); }   // 끝없는 던전: 층마다 구미 (규칙 '구미 풍년'이면 3개)
    if (sig.length && Math.random() < SIG_DROP.floor) { const t = randomRoomTile({ noItem: true }); if (t) D.items.push({ ...t, id: pick(sig), n: 1 }); }
    D.items.forEach(it => { if (it.id && ITEMS[it.id].stack) it.n = rint(3, 9); });
    for (let i = 0; i < nMoney; i++) { const t = randomRoomTile({ noItem: true }); if (t) D.items.push({ ...t, money: moneyPile(lvl) }); }
    // 적
    computeVis();
    const nEn = D.rule === 'many' ? Math.min(15, Math.round((rint(4, 6) + Math.floor(run.floor / 3)) * 1.5)) : Math.min(10, rint(4, 6) + Math.floor(run.floor / 3));   // 끝없는 던전 규칙: 적 1.5배
    for (let i = 0; i < nEn; i++) {
      const t = randomRoomTile({ far: 5 }); if (!t) continue;
      const e = spawnEnemy(t);
      if (Math.random() < NAP_CHANCE) { e.napping = true; e.status = 'slp'; e.statusT = 99999; }   // 가끔 제자리에서 자고 있다
    }
    }
    if (!bossFloor) placeLiquid(dg);
    placeAllies(p);
    // 임무 대상 (하드모드는 임무 없음)
    if (dg.mode === 'normal' && !run.hard) {
      ensureMissionTargets();
    }
    buildMapCanvas();
    computeVis();
    const fname = `${dg.n} ${run.floor}F`;
    log(`— ${fname} —`, now());
    const here = dg.mode === 'normal' && !run.hard ? Game.save.missions.accepted.filter(ms => ms.dungeon === dg.id && ms.floor === run.floor && !run.done.includes(ms.id)) : [];
    if (here.length) { log(`📜 이 층에 임무 대상이 있다! (${here.length}개, J로 확인)`, now()); Sound.play('mission', now() + 500); D.prompts.push(() => { stopAuto(); Game.missionAlert(here); }); }   // 메시지만으로는 놓치기 쉬워서 알림 창도 (v0.84)
    if (D.weather) log(`날씨: ${WEATHERS[D.weather].icon} ${WEATHERS[D.weather].n}`, now());   // 설명은 가이드·던전 정보에
    if (dg.look) log(`🗺 ${dg.lookN}`, now());
    if (D.rule) log(`♾ 규칙: ${ENDLESS_RULES[D.rule].icon} ${ENDLESS_RULES[D.rule].n}`, now());
    showFloorBanner(fname + (D.weather ? `\n${WEATHERS[D.weather].icon} ${WEATHERS[D.weather].n}` : '') + (D.rule ? `\n${ENDLESS_RULES[D.rule].icon} ${ENDLESS_RULES[D.rule].n}` : ''));
    run.turnsOnFloor = 0;
    floorStartAbility(p);
    // 동료도 층마다 전투 모습을 초기화하고, 돌핀맨은 계단을 내려간 뒤로 마이티폼
    for (const a of D.mons) if (a.ally && a.hp > 0) floorStartAbility(a);   // 동료도 날씨 특성·다운로드 등
    setFace('Determined', 1800);
    if (D.boss) D.prompts.push(bossIntro);
    Game.saveRunSnapshot(run);
    updateTacticBtn();
  }

  // 동료를 리더 근처 빈 칸에 세운다 (층에 들어설 때)
  function placeAllies(p) {
    for (const a of run.party || []) {
      if (a.fainted || a.hp <= 0) continue;
      const spot = bfs(p.x, p.y, (x, y) => (x !== p.x || y !== p.y) && !creatureAt(x, y), { max: 400 });
      if (!spot) continue;
      a.x = spot.x; a.y = spot.y; a.dir = p.dir; a.tween = null; a.act = null; a.dead = false;
      a.stages = a.stages || {}; a.stageT = a.stageT || {};
      a.charging = null; a.rampage = null; a.recharge = false; a.boundT = 0; a.struck = new Set(); a.target = null;
      D.mons.push(a); Sprites.load(looksOf(a), a.shiny);
    }
  }

  // ───────────────────────── 시야 ─────────────────────────
  function los(x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx - dy;
    let x = x0, y = y0;
    while (!(x === x1 && y === y1)) {
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
      if (x === x1 && y === y1) return true;
      if (!openAt(x, y)) return false;
    }
    return true;
  }
  // 시야: 리더와 동료가 보는 곳을 합친다 (있는 방 전체 + 주변 몇 칸)
  function computeVis() {
    D.visible.fill(0);
    const rs = new Set();
    const viewers = [P(), ...(D.mons || []).filter(m => m.ally && m.hp > 0)];
    for (const v of viewers) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!inb(v.x + dx, v.y + dy)) continue;
        const r = D.room[idx(v.x + dx, v.y + dy)];
        if (r >= 0 && (dx === 0 || dy === 0 || openAt(v.x + dx, v.y) || openAt(v.x, v.y + dy))) rs.add(r);
      }
      const vr = (abilityOf(v).illuminate ? 3 : 2) - (weatherNow() === 'fog' ? 1 : 0);
      for (let dy = -vr; dy <= vr; dy++) for (let dx = -vr; dx <= vr; dx++) {
        const x = v.x + dx, y = v.y + dy;
        if (inb(x, y) && los(v.x, v.y, x, y)) D.visible[idx(x, y)] = 1;
      }
    }
    for (const r of rs) {
      const R = D.rooms[r];
      for (let y = R.y - 1; y <= R.y + R.h; y++) for (let x = R.x - 1; x <= R.x + R.w; x++) if (inb(x, y)) D.visible[idx(x, y)] = 1;
    }
    for (let i = 0; i < D.visible.length; i++) if (D.visible[i]) D.explored[i] = 1;
    if (D.mons) intimidateCheck();
  }
  const seen = c => D.visible[idx(c.x, c.y)] === 1;

  // 매 턴 특성 처리 (슬로스타트, 변덕쟁이)
  function abilityTick(c) {
    const A = abilityOf(c);
    if (A.speedBoost) { c.sbT = (c.sbT || 0) + 1; if (c.sbT % 5 === 0 && (c.stages[6] || 0) < 6) statChange(c, 6, 1, Math.max(T.cursor, T.moveEnd), c); }
    if (A.slowStart && c.slowT > 0) c.slowT--;
    if (A.moody) {
      c.moodyT = (c.moodyT || 0) + 1;
      if (c.moodyT % 10 === 0) {
        const stats = [2, 3, 4, 5, 7, 8], up = pick(stats), down = pick(stats.filter(s => s !== up));
        const at = Math.max(T.cursor, T.moveEnd);
        statChange(c, up, 2, at, c); statChange(c, down, -1, at, c);
      }
    }
  }
  // 필드 깔기 (v0.100): 기술(그래스필드 등) 또는 메이커 특성. 그 층이 끝날 때까지
  function setTerrain(t, src, at, byMove) {
    if (D.terrain === t) { D.terrainT = TERRAIN_TURNS; return; }   // 같은 필드: 턴만 처음부터
    D.terrain = t; CUR_TERRAIN = t; D.terrainT = TERRAIN_TURNS; D.terrainParty = !!(src && party(src));
    const msg = `발밑이 ${TERRAINS[t].icon} ${jo(TERRAINS[t].n, '으로')} 바뀌었다!`;
    if (byMove) { if (src.player || seen(src)) log(msg, at); } else abLog(src, msg, at);
  }
  // 제로포밍 (v0.100): 날씨와 필드를 모두 없앤다 (전용 날씨도. 그 층의 원래 날씨도 없앤다)
  function clearField(src, at) {
    if (!D.weather && !D.terrain) return;
    D.weather = null; CUR_WEATHER = null; D.baseWeather = null; D.wxLock = null; D.terrain = null; CUR_TERRAIN = null;
    abLog(src, `${jo(nm(src), '은')} 날씨와 필드의 영향을 모두 없앴다!`, at);
    applyForecast(D.player); D.mons.forEach(applyForecast);
  }
  // byMove: 기술(비바라기 등)로 바꿨으면 특성 이름 없이 알린다
  function setWeather(w, src, at, byMove) {
    if (D.weather === w) return;
    // 전용 날씨(아주 강한 햇살 등)는 부른 포켓몬이 쓰러지기 전에는 보통 날씨로 바뀌지 않는다 (다른 전용 날씨로는 바뀜)
    const lock = D.wxLock;
    if (lock && lock.hp > 0 && !lock.dead && !EXTREME_WX.includes(w)) {
      if (byMove ? (src.player || seen(src)) : true) log(`그러나 ${WEATHERS[D.weather].n} 때문에 날씨가 바뀌지 않았다!`, at);
      return;
    }
    D.wxLock = EXTREME_WX.includes(w) ? src : null;
    D.weather = w; CUR_WEATHER = w;
    const msg = `날씨가 ${WEATHERS[w].icon} ${jo(WEATHERS[w].n, '으로')} 바뀌었다!`;
    if (byMove) { if (src.player || seen(src)) log(msg, at); } else abLog(src, msg, at);
    applyForecast(D.player); D.mons.forEach(applyForecast);
  }
  function applyForecast(c) {
    if (c.sp === 421) { if (D && D.player) formCheck(c); return; }   // 체리꼬: 쾌청이면 포지폼 (플라워기프트, v0.99)
    if (!abilityOf(c).forecast) return;
    c.types = [{ sun: 10, rain: 11, snow: 15 }[wxFor(c)] || 1];
    if (D && D.player) formCheck(c);
  }
  // 폼체인지·메가진화 (js/forms.js): 모습이 바뀌었으면 알림과 효과. quiet면 알림 없이 (모르페코처럼 자주 바뀌는 경우)
  const MORPEKO_TURNS = 5;   // 모르페코: 배부른 모양 ↔ 배고픈 모양 (v0.99: 매 턴 → 5턴마다)
  function formCheck(c, at, quiet) {
    if (abilityOf(c).forecast) c.types = [{ sun: 10, rain: 11, snow: 15 }[wxFor(c)] || 1];   // 캐스퐁: 날씨 고정 도구를 지니거나 뺄 때도
    const r = updateForm(c); if (!r) return;
    at = at || now();
    if (quiet || !(c.player || seen(c))) return;
    // "로토무 (워시로토무)" → "워시로토무"
    const who = spName(r.from), to = spName(r.to), fi = DATA.species[r.to]?.fi || '', short = (/\(([^)]+)\)/.exec(to) || [, to])[1];
    log(r.kind === 'back' ? `${jo(who, '은')} 원래 모습으로 돌아왔다!`
      : r.kind === 'mega' ? `${jo(who, '은')} ${jo(to, '으로')} 메가진화했다!`
      : fi.endsWith('-primal') ? `${jo(who, '은')} 원시회귀했다! ${to}!`
      : `${jo(who, '은')} ${jo(short, '으로')} 바뀌었다!`, at);
    D.fx.push({ kind: 'ring', x: c.x, y: c.y, at, dur: 700 * spd(), color: r.kind === 'mega' ? '#ff9cf0' : '#bfe8ff' });
    if (r.kind === 'mega' || fi.endsWith('-primal')) { Sound.play('shiny', at); if (c.player) setFace('Determined', 2000); }
  }
  // 층에 들어설 때 발동하는 특성 (리더와 동료. 줍기·꿀모으기는 리더만)
  // floorStart: [능력, 단계] 하나 또는 [[능력, 단계], …] 여럿 (편승: 공격·특수공격)
  const floorStats = f => (Array.isArray(f[0]) ? f : [f]);
  function floorStartAbility(p) {
    p.seeded = null; p.yawnT = 0; p.protecting = false;   // 지난 층의 씨앗(심은 적은 이 층에 없다)·하품
    resetBattleForm(p, D.weather);
    if (run.floor > 1 || run.sos) p.hero = true;   // 돌핀맨: 계단을 내려간 뒤로는 마이티폼
    if (run.floor === 1 && (p.player || p.ally)) { const sf = START_FORMS[p.sp], ch = Game.save.roster[p.rsp || p.sp]; if (sf && ch && ch.startForm) p[sf.flag] = true; }   // 시작 모습 (메로엣타 스텝폼 등)
    formCheck(p, now() + 500);
    const A = abilityOf(p), at = now() + 600;
    if (!p.player) {
      if (A.slowStart) p.slowT = 10;
      // 날씨 특성: 리더 → 동료 순서로 먼저 바꾼 쪽이 이긴다 (여럿이 서로 덮어쓰지 않게)
      // 단, 전용 날씨(원시회귀·델타스트림)는 보통 날씨보다 앞선다 (리더가 가뭄이어도 동료 원시가이오가의 강한 비)
      const extreme = EXTREME_WX.includes(A.setWeather) && !EXTREME_WX.includes(D.weather);
      if (A.setWeather && (!D.wxByParty || extreme)) { setWeather(A.setWeather, p, at); D.wxByParty = true; }
      if (A.setTerrain && !D.terByParty) { setTerrain(A.setTerrain, p, at); D.terByParty = true; }
      if (A.clearField) clearField(p, at);
      applyForecast(p);
      if (A.download) statChange(p, p.atk >= p.spa ? 2 : 4, 1, at, p);
      if (A.floorStart) floorStats(A.floorStart).forEach(([st, n], k) => statChange(p, st, n, at + k * 150, p));
      if (A.floorRandom) statChange(p, pick([2, 3, 4, 5, 7, 8]), 1, at, p);
      if (A.pickup && Math.random() < A.pickup) { const id = weighted(dropTable(D.dropLv, D.dg)); if (addToBag(id)) abLog(p, `${jo(nm(p), '이')} ${jo(ITEMS[id].n, '을')} 주워 왔다!`, at); }
      if (A.honey && Math.random() < 0.2 && addToBag('apple')) abLog(p, `${jo(nm(p), '이')} 사과를 발견했다!`, at);
      return;
    }
    if (A.slowStart) p.slowT = 10;
    if (A.setWeather) { setWeather(A.setWeather, p, at); D.wxByParty = true; }
    if (A.setTerrain) { setTerrain(A.setTerrain, p, at); D.terByParty = true; }
    if (A.clearField) clearField(p, at);
    applyForecast(p);
    if (A.download) statChange(p, p.atk >= p.spa ? 2 : 4, 1, at, p);
    if (A.floorStart) floorStats(A.floorStart).forEach(([st, n], k) => statChange(p, st, n, at + k * 150, p));
    if (A.floorRandom) statChange(p, pick([2, 3, 4, 5, 7, 8]), 1, at, p);
    if (A.pickup && Math.random() < A.pickup) { const id = weighted(dropTable(D.dropLv, D.dg)); if (addToBag(id)) abLog(p, `${jo(ITEMS[id].n, '을')} 주워 왔다!`, at); }
    if (A.honey && Math.random() < 0.2 && addToBag('apple')) abLog(p, '사과를 발견했다!', at);
  }
  // 층에 들어설 때 발동하는 특성을 같은 층에서 ABILITY_RENEW턴마다 다시 (v0.102 보강)
  //  날씨(가뭄·잔비 등)·필드(메이커)는 다른 날씨·필드로 바뀌어 있으면 다시 바꾸고, 탈은 다시 씌우고, 다운로드 등 능력 올리기는 다시 (주워 오기·꿀모으기는 층마다 한 번)
  const ABILITY_RENEW = 100;
  function renewAbilities() {
    const at = Math.max(T.cursor, T.moveEnd) + 200;
    const team = [P(), ...D.mons.filter(a => a.ally && a.hp > 0)], foes = D.mons.filter(e => e.hp > 0 && !e.ally && !e.npc && seen(e));
    for (const c of [...team, ...foes]) {
      const A = abilityOf(c), mine = c.player || c.ally;
      if (A.disguise && c.disguiseBroken) { c.disguiseBroken = false; formCheck(c, at); abLog(c, `${nm(c)}의 탈이 다시 원래대로 돌아왔다!`, at); }
      if (A.setWeather && weatherRaw() !== A.setWeather) setWeather(A.setWeather, c, at);
      if (A.setTerrain && CUR_TERRAIN !== A.setTerrain) setTerrain(A.setTerrain, c, at);
      if (!mine) continue;
      if (A.download) statChange(c, c.atk >= c.spa ? 2 : 4, 1, at, c);
      if (A.floorStart) floorStats(A.floorStart).forEach(([st, n], k) => statChange(c, st, n, at + k * 150, c));
      if (A.floorRandom) statChange(c, pick([2, 3, 4, 5, 7, 8]), 1, at, c);
    }
  }
  // ── 괴짜(메타몽): 처음 마주친 상대로 변신 ──
  // 모습·타입·능력치(내 레벨 기준, TF_STAT_MUL배)·능력 변화·특성·기술(PP TF_PP)을 따라 한다. HP는 그대로, 다음 층에 들어설 때 원래대로
  // 변신 기술(144)도 같은 방식 (앞에 있는 포켓몬으로)
  function transformInto(c, t, at, byMove) {
    if (!c || c.tf || !t || t.hp <= 0 || c.hp <= 0) return false;
    const look = looksOf(t), who = nm(c);
    c.tf = { moves: c.moves, types: c.types, ability: c.ability, fsp: c.fsp || null, stages: c.stages, stageT: c.stageT, stageS: c.stageS };
    if (c.baseAbility == null) c.baseAbility = c.ability;
    const hp = c.hp;
    c.fsp = look; recalc(c); c.hp = Math.min(hp, c.maxhp);
    c.types = t.types.slice(); c.ability = t.ability;
    c.stages = { ...(t.stages || {}) }; c.stageT = { ...(t.stageT || {}) }; c.stageS = JSON.parse(JSON.stringify(t.stageS || {}));
    c.moves = t.moves.map(m => ({ id: m.id, pp: TF_PP, max: TF_PP }));
    Sprites.load(look, c.shiny);
    if (c.player || seen(c)) {
      log(`${byMove ? '' : '[괴짜] '}${jo(who, '은')} ${jo(spName(look), '으로')} 변신했다!`, at);
      D.fx.push({ kind: 'ring', x: c.x, y: c.y, at, dur: 600 * spd(), color: '#d6a6ff' });
    }
    return true;
  }
  function untransform(c) {
    if (!c || !c.tf) return;
    const o = c.tf; c.tf = null;
    const hp = c.hp;
    c.moves = o.moves; c.types = o.types; c.ability = o.ability; c.fsp = o.fsp; c.stages = o.stages || {}; c.stageT = o.stageT || {}; c.stageS = o.stageS || {};
    recalc(c); c.hp = Math.min(hp, c.maxhp);
  }
  // 위협: 처음 마주쳤을 때
  // 탐험대: 리더·동료 중 위협(위압감)을 가진 포켓몬이 있으면 그 능력을 한 번만 낮춘다 (여럿이어도 겹치지 않음, 리더 우선)
  // 적의 위협은 리더와 동료 모두에게
  function intimidateCheck() {
    const p = P(), at = Math.max(T.cursor, T.moveEnd, now());
    const team = [p, ...allies()], byStat = new Map();
    for (const m of team) { const st = abilityOf(m).intimidate; if (st && !byStat.has(st)) byStat.set(st, m); }
    for (const e of D.mons) {
      if (e.npc || e.ally || e.metPlayer || !seen(e)) continue;
      e.metPlayer = true;
      Progress.seen(e.sp);
      if (e.outlaw) setTimeout(floorMusic, 0);   // 수배범을 발견하면 수배범 곡
      if (e.shiny) { Sound.play('shiny', at); log(`✨ 색이 다른 ${jo(spName(e.sp), '이')} 나타났다!`, at); setFace('Surprised', 2000); D.fx.push({ kind: 'ring', x: e.x, y: e.y, at, dur: 700, color: '#fff6a0' }); Game.noteShiny(e.sp); }
      for (const [st, m] of byStat) intimidate(m, e, st, at);
      const ea = abilityOf(e);
      // 괴짜: 이 층에서 처음 마주친 적으로. 등장 후 변신하는 보스가 있는 층에서는 보스가 변신할 때까지 기다렸다가 변신 후 모습으로 (bossTransform)
      const bossWait = D.boss && D.boss.introForm && D.boss.hp > 0;
      if (!bossWait) for (const m of team) if (abilityOf(m).imposter && !m.tf) transformInto(m, e, at);
      if (ea.imposter && !e.tf) transformInto(e, p, at);   // 적 메타몽: 리더로
      if (ea.intimidate) for (const m of team) intimidate(e, m, ea.intimidate, at);
      if (ea.setWeather) setWeather(ea.setWeather, e, at);
      if (ea.setTerrain) setTerrain(ea.setTerrain, e, at);
      if (ea.clearField) clearField(e, at);
    }
  }
  function intimidate(src, tgt, st, at) {
    if (defAbility(src, tgt).noIntimidate) { abLog(tgt, `${jo(nm(tgt), '은')} 위협에 넘어가지 않았다!`, at); return; }
    abLog(src, `${jo(nm(tgt), '을')} 위협했다!`, at);
    statChange(tgt, st, -1, at, src);
  }
  const hostilesVisible = () => D.mons.filter(m => !m.npc && !m.ally && seen(m));

  // ───────────────────────── 조회 ─────────────────────────
  function creatureAt(x, y) {
    if (D.player && D.player.x === x && D.player.y === y && D.player.hp > 0) return D.player;
    return D.mons.find(m => m.x === x && m.y === y);
  }
  const itemAt = (x, y) => D.items.find(i => i.x === x && i.y === y);
  function diagOK(x, y, dx, dy) { return !(dx && dy) || (openAt(x + dx, y) && openAt(x, y + dy)); }
  function canStep(c, dx, dy) {
    const x = c.x + dx, y = c.y + dy;
    if (c.boundT > 0) return false;   // 김밥말이·회오리불꽃 등에 갇혀 있으면 걷지 못한다 (공격은 된다)
    return passable(c, x, y) && diagOK(c.x, c.y, dx, dy) && !creatureAt(x, y);
  }
  // 편: 플레이어와 동료(ally)가 한 편, 나머지 적이 한 편
  const party = c => !!(c && (c.player || c.ally));
  const hostileTo = (a, b) => !!b && !b.npc && b !== a && party(a) !== party(b);
  const allies = () => D.mons.filter(m => m.ally && m.hp > 0);

  // BFS: 목표를 만족하는 가장 가까운 칸과 그 첫 걸음
  // 첫 걸음 순서: 기본은 DIRS 순서. straight: 길이가 같은 길이 여럿이면 지금 보는 방향 → 곧은 방향 → 대각선 순으로 고른다
  // (자동 탐색이 두 칸 너비 복도에서 대각선으로 지그재그 걷지 않게)
  const DIR_ORDER = [0, 1, 2, 3, 4, 5, 6, 7];
  const straightOrder = dir => [...new Set([...(dir % 2 === 0 ? [dir] : []), 0, 2, 4, 6, 1, 3, 5, 7])];
  function bfs(sx, sy, isGoal, opts = {}) {
    const N = D.w * D.h, prev = new Int32Array(N).fill(-1);
    const start = idx(sx, sy); prev[start] = start;
    const walker = opts.self && !opts.self.player ? opts.self : null;   // 적·동료는 자기가 들어갈 수 있는 웅덩이도 지나간다 (리더의 자동 이동은 바닥만)
    const q = [start];
    for (let qi = 0; qi < q.length; qi++) {
      const cur = q[qi], x = cur % D.w, y = (cur / D.w) | 0;
      if (cur !== start && isGoal(x, y)) {
        let s = cur, len = 0;
        while (prev[s] !== start) { s = prev[s]; len++; }
        return { x, y, fx: s % D.w, fy: (s / D.w) | 0, len: len + 1 };
      }
      if (opts.max && qi > opts.max) break;
      for (const d of cur === start && opts.straight ? straightOrder(opts.straight.dir) : DIR_ORDER) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
        if (walker ? !passable(walker, nx, ny) : !floorAt(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (prev[ni] !== -1) continue;
        if (opts.known && !D.explored[ni]) continue;
        if (!diagOK(x, y, DIRS[d][0], DIRS[d][1])) continue;
        if (opts.avoid && !isGoal(nx, ny) && opts.avoid(nx, ny)) continue;
        if (opts.avoidTraps && !isGoal(nx, ny) && D.traps.some(t => t.seen && t.x === nx && t.y === ny)) continue;
        if (opts.blockMons && !isGoal(nx, ny)) { const c = creatureAt(nx, ny); if (c && c !== opts.self && !(opts.passAllies && c.ally) && (opts.seenOnly ? seen(c) : true)) continue; }
        prev[ni] = cur; q.push(ni);
      }
    }
    return null;
  }

  // ───────────────────────── 연출 스케줄 ─────────────────────────
  function beginTurn() {
    const n = now();
    T.base = Math.max(n, T.busyUntil); T.cursor = T.base; T.moveEnd = T.base;
  }
  function endTurnTiming() { T.busyUntil = Math.max(T.cursor, T.moveEnd); }
  function schedMove(c, fx, fy) {
    const dur = (D.auto ? 70 : 125) * spd();
    c.tween = { fx, fy, start: T.base, dur };
    if (seen(c) || c.player) T.moveEnd = Math.max(T.moveEnd, T.base + dur);
  }
  function schedAction(c, name, dur) {
    const visible = c.player || seen(c);
    const start = Math.max(T.cursor, T.moveEnd);
    c.act = { name, start, dur };
    if (visible) T.cursor = start + dur;
    return start;
  }
  function popup(c, text, color, at, size) { D.popups.push({ x: c.x, y: c.y, text, color, at, size }); }
  // 체력바는 데미지 숫자가 뜨는 순간에 맞춰 줄인다 (v0.93): HP는 계산할 때 바로 바뀌지만, 연출은 차례로 나오므로
  //  바뀐 시각(at)과 바뀌기 전 HP를 남겨 두고, 아직 그 시각이 안 됐으면 바뀌기 전 HP를 보여 준다
  function noteHp(c, at, before) { if (at > now()) (c.hpq = c.hpq || []).push({ at, before }); }
  function shownHp(c, t = now()) {
    const q = c.hpq; if (!q || !q.length) return c.hp;
    let first = null;
    for (let i = q.length - 1; i >= 0; i--) { if (q[i].at <= t) q.splice(i, 1); else if (!first || q[i].at < first.at) first = q[i]; }
    return first ? Math.max(0, first.before) : Math.max(0, c.hp);
  }

  // ───────────────────────── 전투 ─────────────────────────
  // 숙련도 올리기: 탐험대의 기술이 적에게 맞았을 때 (자신에게 쓰는 기술은 쓸 때마다). 허공에 쓰면 오르지 않는다
  // 모으기 기술은 발사할 때, 난동은 처음 한 번만. 단계가 오르면 PP 최대치도 바로 늘어난다
  function addMastery(c, m) {
    const S = Game.save; S.mastery = S.mastery || {};
    const book = S.mastery[c.sp] = S.mastery[c.sp] || {};
    const before = masteryLevel(c.sp, m.id);
    book[m.id] = (book[m.id] || 0) + 1;
    const after = masteryLevel(c.sp, m.id);
    if (after > before) {
      const max = masteryMaxPP(c.sp, m.id);
      m.pp += max - m.max; m.max = max;
      log(`✨ ${nm(c)}의 ${DATA.moves[m.id].n} 숙련도가 ★${after}이 되었다! (PP 최대 ${max})`, T.base);
      Sound.play('up', T.base);
    }
  }
  // 유턴·볼트체인지·퀵턴 (v0.92): 맞힌 뒤 바로 뒤에 같은 편이 있으면 그 포켓몬과 자리를 바꾼다 (원작의 교체처럼 같은 편이 앞으로)
  //  뒤가 비었거나 적이면 공격만 한다 (물러나기·적과 자리 바꾸기는 너무 세서 넣지 않았다)
  // 들어갈 수 없는 물·용암 위에 갇힌 포켓몬 (자리 바꾸기·특성이 바뀜 등): 가장 가까운 설 수 있는 빈칸으로 옮긴다 (v0.101 안전망)
  function unstick(c) {
    const seen0 = new Set([c.x + ',' + c.y]), q = [[c.x, c.y]];
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
        if (seen0.has(k) || nx < 0 || ny < 0 || nx >= D.w || ny >= D.h || !openAt(nx, ny)) continue;
        seen0.add(k);
        if (passable(c, nx, ny) && !creatureAt(nx, ny)) {
          c.x = nx; c.y = ny; c.tween = null;
          if (c.player || seen(c)) log(`${jo(nm(c), '은')} 웅덩이에서 빠져나왔다.`, Math.max(T.cursor, T.moveEnd));
          return;
        }
        q.push([nx, ny]);
      }
    }
  }
  // 동료가 비켜 설 칸: 그 동료가 설 수 있는 빈칸 중 리더에게서 먼 쪽 (가까운 칸부터 3칸 안에서 찾는다)
  function allyStepAside(t, p) {
    const seen0 = new Set([t.x + ',' + t.y]); let q = [[t.x, t.y]];
    for (let d = 0; d < 3 && q.length; d++) {
      const next = [], found = [];
      for (const [x, y] of q) for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
        if (seen0.has(k) || !passable(t, nx, ny) || !diagOK(x, y, dx, dy)) continue;
        seen0.add(k);
        if (nx === p.x && ny === p.y) continue;
        if (!creatureAt(nx, ny)) found.push({ x: nx, y: ny });
        else if (creatureAt(nx, ny).ally) next.push([nx, ny]);   // 다른 동료 너머로도
      }
      if (found.length) return found.sort((a, b) => cheb(b, p) - cheb(a, p))[0];
      q = next.length ? next : q.flatMap(([x, y]) => DIRS.map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => passable(t, nx, ny)));
    }
    return null;
  }
  function pivotSwap(user, at) {
    const [dx, dy] = DIRS[(user.dir + 4) % 8], bx = user.x + dx, by = user.y + dy;
    const a = creatureAt(bx, by);
    if (!a || a === user || a.hp <= 0 || a.npc || hostileTo(user, a) || !diagOK(user.x, user.y, dx, dy)) return;
    if (!passable(a, user.x, user.y) || !passable(user, bx, by)) return;   // 물·용암에 들어갈 수 없는 쪽이 있으면 바꾸지 않는다
    const fx = user.x, fy = user.y, dur = 125 * spd();
    user.x = bx; user.y = by; a.x = fx; a.y = fy;
    user.tween = { fx, fy, start: at, dur }; a.tween = { fx: bx, fy: by, start: at, dur };
    a.swapped = D.turn;
    if (user.player || seen(user) || seen(a)) {
      T.cursor = Math.max(T.cursor, at + dur);
      log(`${jo(nm(user), '은')} ${jo(nm(a), '과')} 자리를 바꿨다!`, at);
    }
    if (user.player) { markMoved(user, fx, fy); onStep(); }
  }
  function useMove(user, slot, dir, opts = {}) {
    const mid = slot < 0 ? null : user.moves[slot].id;
    const R = (mid && MOVE_RULES[mid]) || {};
    const mastery = slot >= 0 && party(user) && (!opts.free || opts.release) && !run.hard && !user.tf;   // 이번 사용이 숙련도에 들어가나 (하드모드는 레벨처럼 성장 없음)
    let move = slot < 0 ? NORMAL_ATTACK : DATA.moves[mid];
    const wbT = { sun: 10, rain: 11, sand: 6, snow: 15 }[weatherNow()];
    if (R.weatherBall && wbT) move = { ...move, t: wbT, p: 100 };
    if (mid === EXPANDING_FORCE && CUR_TERRAIN === 'psychic' && grounded(user)) move = { ...move, r: 'r' };   // 와이드포스: 사이코필드에서는 주변(3칸 안)의 모든 상대에게 (위력 80 → 120은 powerMul)
    if (slot >= 0 && !opts.free) {
      if (party(user) && Math.random() < masteryFree(user.sp, mid)) log(`${jo(nm(user), '은')} PP를 쓰지 않았다! (숙련도)`, T.base);
      else if (party(user) && heldOf(user).ppFree && Math.random() < heldOf(user).ppFree) log(`${jo(nm(user), '은')} PP를 쓰지 않았다! (${ITEMS[badgeOf(user) || user.held].n} +${SIG_UP_TOP})`, T.base);   // 전용 도구 +4
      else user.moves[slot].pp--;
    }
    user.dir = dir;
    if (user.sp === 681) { user.blade = move.c !== 1; formCheck(user); }   // 킬가르도: 공격이면 블레이드폼, 변화 기술이면 실드폼
    if (user.sp === 648 && mid === 547) { user.pirouette = !user.pirouette; formCheck(user); }   // 메로엣타: 옛노래를 쓸 때마다
    if (!R.chain || !user.chain || user.chain.mid !== mid) user.chain = R.chain ? { mid, n: 0 } : null;
    // 조건 판정용: 지난 행동 이후 맞았는지
    const ctx = { hurtSince: (user.lastHurtSeq || 0) > (user.lastActSeq || 0), hurtBy: user.lastHurtBy, prevAct: user.lastActSeq || 0, lastMissed: !!user.lastMissed };
    user.lastActSeq = ++D.seq; user.lifeOrbHit = false;
    const visible = user.player || seen(user);
    const color = TYPE_COLORS[(move.t || 1) - 1];
    // 모으기 1턴째
    if (R.charge && !opts.release && !(R.sunNoCharge && (weatherNow() === 'sun' || abilityOf(user).megaSol)) && !(R.rainNoCharge && weatherNow() === 'rain')) {
      const t0 = schedAction(user, 'Shoot', 280 * spd());
      user.charging = { slot, invuln: !!R.invuln };
      if (visible) log(`${nm(user)}의 ${move.n}! ${jo(nm(user), '은')} ${R.charge}`, t0);
      D.fx.push({ kind: 'ring', x: user.x, y: user.y, at: t0, dur: 400 * spd(), color });
      if (R.chargeSc) for (const [st, ch] of R.chargeSc) statChange(user, st, ch, t0 + 150);
      return;
    }
    user.charging = null;
    const anim = slot < 0 || move.r === 'f' ? 'Attack' : 'Shoot';
    const dur = clamp(Sprites.animLength(looksOf(user), anim, user.shiny) * 0.75, 200, 460) * spd();
    const t0 = schedAction(user, anim, dur);
    const hitAt = t0 + dur * 0.55;
    if (slot >= 0 && visible) log(`${nm(user)}의 ${move.n}!`, t0);
    if (slot >= 0) user.lastUse = { id: mid, turn: D.turn };   // 연속으로 쓸 수 없는 기술 (repeatBlocked)
    const fail = msg => { log(msg || '그러나 실패했다!', hitAt); user.lastMissed = true; };
    const blk = WX_BLOCK[weatherRaw()];
    if (blk && move.c !== 1 && moveType(user, move) === blk) return fail(blk === 11 ? '아주 강한 햇살에 물 기술이 증발해 버렸다!' : '강한 비에 불꽃 기술이 꺼져 버렸다!');
    if (R.focus && ctx.hurtSince) return fail(`${jo(nm(user), '은')} 집중이 흐트러져서 기술을 쓸 수 없었다!`);
    if (R.needSleepSelf && user.status !== 'slp') return fail();
    if (R.hpCostPct) {
      const cost = Math.floor(user.maxhp * R.hpCostPct / 100);
      if (user.hp <= cost) return fail();
      noteHp(user, hitAt, user.hp); user.hp -= cost; popup(user, '-' + cost, '#ff8a8a', hitAt);
      log(`${jo(nm(user), '은')} HP를 깎아 힘을 끌어올렸다!`, hitAt);
    }
    let targets = [];
    const [dx, dy] = DIRS[dir];
    if (move.r === 'f' && R.wide) {   // 수평베기: 앞과 앞 양옆 대각선
      for (const k of [-1, 0, 1]) { const [ex, ey] = DIRS[(dir + k + 8) % 8], t = creatureAt(user.x + ex, user.y + ey); if (t && hostileTo(user, t) && diagOK(user.x, user.y, ex, ey)) targets.push(t); }
    } else if (move.r === 'f') {
      const t = creatureAt(user.x + dx, user.y + dy);
      if (t && hostileTo(user, t) && (diagOK(user.x, user.y, dx, dy) || R.reach >= 2)) targets = [t];   // 선공기: 원작처럼 벽 모서리 너머 바로 옆 대각선도 맞는다 (v0.102 보강)
      else if ((!t || (party(user) && party(t))) && R.reach >= 2 && openAt(user.x + dx, user.y + dy) && diagOK(user.x, user.y, dx, dy)) {   // 선공기: 바로 앞이 비었으면 한 칸 너머
        const t2 = creatureAt(user.x + 2 * dx, user.y + 2 * dy);
        if (t2 && hostileTo(user, t2) && diagOK(user.x + dx, user.y + dy, dx, dy)) targets = [t2];
      }
    } else if (move.r === 'p') {
      let x = user.x, y = user.y;
      for (let i = 0, n = PROJ_RANGE; i < n; i++) {   // 직선 기술은 대각선 벽 모서리를 스쳐 지나간다
        x += dx; y += dy;
        if (!openAt(x, y)) break;   // 웅덩이 위로는 날아간다 (벽에서만 멈춘다)
        const t = creatureAt(x, y);
        if (t && party(user) && party(t)) continue;   // 탐험대의 직선 기술은 동료를 지나간다
        if (t && R.pierce) { if (hostileTo(user, t)) targets.push(t); continue; }   // 관통: 사거리 안의 모든 적 (같은 편은 지나간다)
        if (t) { if (hostileTo(user, t)) targets = [t]; break; }
      }
      if (R.pierce && targets.length) { x = targets[targets.length - 1].x; y = targets[targets.length - 1].y; }
      D.fx.push({ kind: 'proj', x0: user.x, y0: user.y, x1: R.pierce ? x : targets[0]?.x ?? x, y1: R.pierce ? y : targets[0]?.y ?? y, at: t0 + dur * 0.3, dur: dur * 0.3, color });
    } else if (move.r === 'r') {
      const pool = [D.player, ...D.mons].filter(t => t && t.hp > 0);
      targets = pool.filter(t => hostileTo(user, t) && Math.max(Math.abs(t.x - user.x), Math.abs(t.y - user.y)) <= 3 && los(user.x, user.y, t.x, t.y));
      D.fx.push({ kind: 'ring', x: user.x, y: user.y, at: t0 + dur * 0.3, dur: 350 * spd(), color });
    }
    // 플래시 (v0.102 보강): 주변 FLASH_R칸 안의 지도를 밝힌다 (탐험대가 쓸 때만, 층마다 처음 한 번). 그다음 원래 효과(명중률 낮추기)
    if (R.mapAll && party(user) && !D.mapLit) { D.mapLit = true; for (let y = Math.max(0, user.y - FLASH_R); y <= Math.min(D.h - 1, user.y + FLASH_R); y++) for (let x = Math.max(0, user.x - FLASH_R); x <= Math.min(D.w - 1, user.x + FLASH_R); x++) D.explored[idx(x, y)] = 1; log(`번쩍! 주변이 밝아졌다! (주변 ${FLASH_R}칸의 지도를 밝혔다)`, hitAt); D.fx.push({ kind: 'ring', x: user.x, y: user.y, at: hitAt, dur: 600 * spd(), color: '#fff8c0' }); }
    // 맞은 자리 이펙트 (원작 이펙트가 있는 타입의 공격 기술)
    // 치유파동·플라워힐: 같은 편 하나를 회복
    if (R.allyHeal) {
      const front = creatureAt(user.x + dx, user.y + dy);
      const t = allyHealTarget(user, [D.player, ...D.mons], c => !c.npc && !hostileTo(user, c),
        c => Math.max(Math.abs(c.x - user.x), Math.abs(c.y - user.y)) <= TEAM_RANGE && los(user.x, user.y, c.x, c.y), front);
      if (!t) { fail('그러나 회복할 같은 편이 없었다!'); afterUse(); return; }
      const h = user.boss ? Math.min(move.h, BOSS_HEAL_MAX) : move.h;
      heal(t, Math.floor(t.maxhp * h / 100), hitAt);
      D.fx.push({ kind: 'ring', x: t.x, y: t.y, at: hitAt, dur: 300 * spd(), color: '#fff6a0' });
      if (mastery) addMastery(user, user.moves[slot]);
      afterUse(); return;
    }
    if (move.r === 's') { applySelf(user, move, hitAt, R); if (mastery) addMastery(user, user.moves[slot]); afterUse(); return; }
    if (!targets.length) {
      if (slot >= 0 && visible) log('그러나 아무도 맞지 않았다...', hitAt);
      user.lastMissed = true; afterUse(); return;
    }
    if (R.delay) {
      for (const t of targets) D.delayed.push({ at: D.turn + R.delay, user, t, move });
      log(`${jo(nm(user), '은')} 미래로 공격을 보냈다!`, hitAt);
      if (mastery) addMastery(user, user.moves[slot]);
      afterUse(); return;
    }
    user.lastMissed = false;
    user.landed = false;   // resolveHit에서 적에게 맞으면 true
    user.selfScDone = false;
    for (const t of targets) {
      const struck = user.struck && user.struck.has(t.id);
      if (R.first && struck) { fail(`${nm(t)}에게는 통하지 않았다! (첫 공격이 아니다)`); continue; }
      if (R.sucker && (t.status === 'slp' || t.status === 'frz' || (!t.player && !t.target))) { fail(); continue; }
      if (R.needSleepTarget && t.status !== 'slp') { fail(); continue; }
      const p = powerFor(user, t, move, R, ctx, struck);
      resolveHit(user, t, p === move.p ? move : { ...move, p }, hitAt, R);
      (user.struck = user.struck || new Set()).add(t.id);
    }
    if (R.pivot && user.landed && user.hp > 0) pivotSwap(user, hitAt + 150);
    if (mastery && user.landed) addMastery(user, user.moves[slot]);
    afterUse();

    function afterUse() {
      if (R.chain && user.chain) user.chain.n++;
      if (R.recharge) user.recharge = true;
      if (R.selfKO && user.hp > 1) {
        popup(user, '-' + (user.hp - 1), '#ff8a8a', hitAt + 100);
        noteHp(user, hitAt + 100, user.hp); user.hp = 1; user.hurtAt = hitAt + 100;
        log(`${jo(nm(user), '은')} 힘을 모두 써버려서 HP가 1만 남았다!`, hitAt + 100);
      }
      if (R.selfDmgPct) {
        const amt = Math.min(Math.floor(user.maxhp * R.selfDmgPct / 100), user.hp - 1);
        if (amt > 0) { noteHp(user, hitAt + 100, user.hp); user.hp -= amt; user.hurtAt = hitAt + 100; popup(user, '-' + amt, '#ff8a8a', hitAt + 100); log(`${jo(nm(user), '은')} 반동으로 데미지를 입었다.`, hitAt + 100); }
      }
      if (R.rampage) {
        if (!opts.free) user.rampage = { slot, id: mid, left: R.rampTurns || rint(1, 2), calm: !!R.noConfuse, uproar: !!R.uproar };
        else if (user.rampage && --user.rampage.left <= 0) {
          const calm = user.rampage.calm; user.rampage = null;
          if (calm) log(`${jo(nm(user), '은')} 소란을 멈췄다.`, hitAt + 150);   // 소란피기: 끝나도 혼란에 빠지지 않는다
          else { log(`${jo(nm(user), '은')} 난동을 부린 끝에 지쳐버렸다!`, hitAt + 150); inflict(user, 'cnf', hitAt + 150); }
        }
      }
    }
  }

  function powerFor(user, t, move, R, ctx, struck) {
    let p = move.p;
    switch (R.pow) {
      case 'guts': if (['psn', 'par', 'brn'].includes(user.status)) p *= 2; break;
      case 'venom': if (t.status === 'psn') p *= 2; break;
      case 'brine': if (t.hp * 2 <= t.maxhp) p *= 2; break;
      case 'eruption': p = Math.max(1, Math.floor(p * user.hp / user.maxhp)); break;
      case 'stored': p = 20 + 20 * Object.values(user.stages).reduce((s, v) => s + Math.max(0, v), 0); break;
      case 'revenge': if (ctx.hurtSince && ctx.hurtBy === t.id) p *= 2; break;
      case 'payback': if (ctx.hurtSince) p *= 2; break;
      case 'assurance': if ((t.lastHurtSeq || 0) > ctx.prevAct) p *= 2; break;
      case 'firstStrike': if (!struck) p *= 2; break;
      case 'stomp': if (ctx.lastMissed) p *= 2; break;
      case 'hex': if (t.status) p *= 2; break;
      case 'crush': p = Math.max(1, Math.floor(120 * t.hp / t.maxhp)); break;
    }
    if (R.chain && user.chain) {
      const n = Math.min(user.chain.n, R.chain);
      p = R.chainAdd ? p + 40 * n : p * Math.pow(2, n);
    }
    return p;
  }

  // 난동 중: 가까운 적을 자동으로 공격
  function rampageStep(c) {
    // 난동 중에 기술 칸을 바꿨으면 원래 기술을 따라가고, 잊었으면 난동을 멈춘다 (예전에는 바뀐 칸의 기술을 PP 없이 끝없이 썼다)
    const rid = c.rampage.id ?? c.moves[c.rampage.slot]?.id, rs = c.moves.findIndex(m => m && m.id === rid);
    if (rs < 0 || !MOVE_RULES[rid]?.rampage) { c.rampage = null; return false; }
    c.rampage.slot = rs;
    const foes = [D.player, ...D.mons].filter(m => hostileTo(c, m));
    const adj = foes.find(f => Math.max(Math.abs(f.x - c.x), Math.abs(f.y - c.y)) === 1 && diagOK(c.x, c.y, Math.sign(f.x - c.x), Math.sign(f.y - c.y)));
    let dir = adj ? dirIndex(adj.x - c.x, adj.y - c.y) : c.dir;
    if (!adj && DATA.moves[c.moves[c.rampage.slot]?.id]?.r === 'p') {   // 소란피기 같은 원거리 난동: 직선 위의 가장 가까운 적
      const al = foes.filter(f => { const dx = f.x - c.x, dy = f.y - c.y, d = Math.max(Math.abs(dx), Math.abs(dy)); return (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) && d <= PROJ_RANGE && lineClear(c, dirIndex(dx, dy), d); })
        .sort((a, b) => Math.max(Math.abs(a.x - c.x), Math.abs(a.y - c.y)) - Math.max(Math.abs(b.x - c.x), Math.abs(b.y - c.y)));
      if (al[0]) dir = dirIndex(al[0].x - c.x, al[0].y - c.y);
    }
    useMove(c, c.rampage.slot, confuse(c, dir), { free: true });
    return true;
  }

  const abLog = (c, text, at) => { if (c.player || seen(c)) log(`[${abilityName(c.ability)}] ${text}`, at); };

  function resolveHit(user, tgt, move, at, R = {}) {
    if (tgt.hp <= 0) return;
    if (tgt.protecting && tgt !== user) { log(`${jo(nm(tgt), '은')} 공격으로부터 몸을 지켰다!`, at); popup(tgt, '방어', '#9fd8ff', at); user.lastMissed = true; return; }
    if (tgt.charging && tgt.charging.invuln) { log(`${nm(tgt)}에게 공격이 닿지 않았다!`, at); user.lastMissed = true; return; }
    tgt.lastHitContact = isContact(move) && !abilityOf(user).longReach;   // 유폭: 마지막으로 맞은 기술이 접촉 기술인지
    if (terrainOn(tgt, 'psychic') && tgt !== user && hostileTo(user, tgt) && PRIORITY_MOVES.includes(move.id)) { log(`${jo(nm(tgt), '은')} 사이코필드에 지켜지고 있다!`, at); user.lastMissed = true; return; }   // 사이코필드: 선제기를 막는다
    const A = abilityOf(user), Dd = defAbility(user, tgt), mt = moveType(user, move);
    // 흡수·무효 특성
    if (Dd.absorb && Dd.absorb.t === mt && tgt !== user) {
      const ab = Dd.absorb;
      if (ab.heal) { abLog(tgt, `${jo(nm(tgt), '은')} 공격을 흡수했다!`, at); heal(tgt, Math.floor(tgt.maxhp * ab.heal / 100), at); }
      else if (ab.flash) { abLog(tgt, `${nm(tgt)}의 불꽃 위력이 올라갔다!`, at); tgt.flashFire = true; }
      else { abLog(tgt, `${jo(nm(tgt), '은')} 공격을 받아냈다!`, at); statChange(tgt, ab.st, ab.ch, at, tgt); }
      return;
    }
    if (move.c === 1 && Dd.magicBounce && (move.ail || (move.sc && move.sc.some(x => x[1] < 0)))) { abLog(tgt, `${jo(nm(tgt), '은')} 변화 기술을 튕겨냈다!`, at); return; }
    const r = calcHit(user, tgt, move);
    if (r.miss) { Sound.play('miss', at); popup(tgt, 'MISS', '#ddd', at); log(`${jo(nm(tgt), '은')} 공격을 피했다!`, at); user.lastMissed = true; return; }
    if (!(move.c !== 1 && r.eff === 0)) user.landed = true;   // 숙련도: 효과가 없는 상대에게 맞은 것은 빼고
    const serene = A.serene ? 2 : 1;
    const secondary = !(A.sheer && move.c !== 1) && !(Dd.shieldDust && move.c !== 1);
    if (move.c !== 1) {
      if (r.eff === 0) { log(`${nm(tgt)}에게는 효과가 없는 것 같다...`, at, 'weak'); return; }
      let hits = move.hits ? (A.skillLink ? move.hits[1] : rint(move.hits[0], move.hits[1])) : 1;
      if (R.popBomb && !A.skillLink) { hits = 1; while (hits < move.hits[1] && Math.random() < 0.9) hits++; }
      if (heldOf(user).loadedDice && move.hits && move.hits[1] > move.hits[0] && hits < 4) hits = Math.min(move.hits[1], move.hits[1] === 5 ? rint(4, 5) : 4);   // 속임수주사위: 4회 이상
      // 탈·아이스페이스는 첫 대만 막는다 (v0.93): 연속기는 남은 대가 그대로 들어간다 (원작처럼)
      let blocked = false;
      if (Dd.disguise && !tgt.disguiseBroken && r.dmg > 0) {   // 탈: 층마다 첫 공격을 탈이 대신 맞는다
        tgt.disguiseBroken = true; abLog(tgt, `${nm(tgt)}의 탈이 대신 공격을 받았다! 탈이 벗겨졌다!`, at); formCheck(tgt, at, true);
        damage(tgt, pctDmg(tgt, 1 / 8), null, at); blocked = true;
      } else if (move.c === 2 && tgt.sp === 875 && !tgt.noice && (tgt.baseAbility ?? tgt.ability) === 248 && !A.moldBreaker) {
        abLog(tgt, `${jo(nm(tgt), '은')} 얼음 얼굴로 공격을 막아냈다!`, at); tgt.noice = true; formCheck(tgt, at); blocked = true;
      }
      if (blocked && hits <= 1) return;
      const parts = blocked ? [] : [r.dmg];   // 연속기: 한 대씩 (맞을 때마다 숫자를 띄운다)
      for (let i = 1; i < hits; i++) parts.push(calcHit(user, tgt, { ...move, a: 0, p: R.escalate ? move.p * (i + 1) : move.p }).dmg || 0);
      let total = parts.reduce((a, b) => a + b, 0);
      if (R.falseSwipe) total = Math.max(0, Math.min(total, tgt.hp - 1));
      // 앙갚음: 지난 턴 이후 공격으로 받은 데미지의 1.5배 (받은 적이 없으면 실패)
      if (R.comeuppance) {
        if (!(user.lastHurt > 0 && user.lastHurtTurn >= D.turn - 1)) { log('그러나 갚아 줄 데미지가 없었다!', at); return; }
        total = Math.floor(user.lastHurt * 1.5);
      }
      if (r.crit) log('급소에 맞았다!', at, 'crit');
      // 급소는 분홍, 효과가 굉장하면 주황, 별로면 회청 (급소 + 굉장함은 둘 다 표시)
      const ec = r.crit ? (r.eff > 1 ? 'crit super' : 'crit') : r.eff > 1 ? 'super' : r.eff < 1 ? 'weak' : undefined;
      const et = effText(r.eff); if (et) log(et, at, r.eff > 1 ? 'super' : 'weak');
      log(`${jo(nm(tgt), '은')} ${total}의 데미지를 입었다.` + (hits - blocked > 1 ? ` (${hits - blocked}회)` : ''), at, ec);
      if (total > 0) Sound.play(tgt.player ? 'hurt' : r.crit ? 'crit' : r.eff > 1 ? 'super' : r.eff < 1 ? 'weak' : 'hit', at);
      const hpBefore = tgt.hp;
      const perHit = parts.length > 1 && !R.falseSwipe && !R.comeuppance;
      if (perHit) parts.forEach((d, i) => { if (i) Sound.play('hit', at + i * 140); popup(tgt, String(d), r.eff > 1 ? '#ffb02e' : r.eff < 1 ? '#8ea6c8' : tgt.player ? '#ff8a8a' : '#fff', at + i * 140, r.eff < 1 ? 'small' : undefined); });
      if (total > 0) damage(tgt, total, user, at, r.eff, r.crit, hits > 1, perHit);
      const dealt = Math.max(0, hpBefore - Math.max(0, tgt.hp));   // 실제로 깎인 HP
      if (move.dr && dealt > 0) {
        const amt = Math.max(1, Math.floor(dealt * (move.dr > 0 ? DRAIN_PCT : -move.dr * RECOIL_MUL) / 100));
        if (move.dr > 0) {
          if (abilityOf(tgt).liquidOoze) { abLog(tgt, `${jo(nm(user), '은')} 해감액을 흡수했다!`, at); damage(user, amt, tgt, at); }
          else heal(user, amt, at);
        } else if (!A.rockHead) { log(`${jo(nm(user), '은')} 반동으로 데미지를 입었다.`, at); damage(user, amt, null, at); }
      }
      if (tgt.hp > 0 && secondary) {
        if (move.ail && Math.random() * 100 < move.ac * serene) inflict(tgt, move.ailPick ? pick(move.ailPick) : AILMENT_MAP[move.ail], at, false, user);
        if (move.fl && Math.random() * 100 < move.fl * serene) setFlinch(tgt, at);
      }
      // 가두는 기술 (v0.102 보강): 4~5턴 동안 걷지 못하고 턴마다 최대 HP의 1/16 데미지 (보스는 절반 턴)
      if (tgt.hp > 0 && R.bind && !(tgt.boundT > 0)) {
        tgt.boundT = tgt.boss ? 2 : rint(4, 5); tgt.boundBy = user;
        if (tgt.player || seen(tgt)) log(`${jo(nm(tgt), '은')} ${move.n}에 갇혔다! (${tgt.boundT}턴)`, at);
      }
      if (tgt.hp > 0 && A.stench && Math.random() < 0.1 * serene) setFlinch(tgt, at);
      if (tgt.hp > 0 && A.poisonTouch && Math.random() < 0.3) inflict(tgt, 'psn', at, false, user);
      // 모래뿜기·넘치는씨 (v0.102 보강): 공격을 받으면 모래바람 / 그래스필드 (원작처럼)
      if (tgt !== user && r.dmg > 0) { const TA = abilityOf(tgt); if (TA.hitWeather && weatherRaw() !== TA.hitWeather) setWeather(TA.hitWeather, tgt, at + 100); if (TA.hitTerrain && CUR_TERRAIN !== TA.hitTerrain) setTerrain(TA.hitTerrain, tgt, at + 100); }
      if (tgt.hp > 0 && r.crit && abilityOf(tgt).angerPoint) { tgt.stages[2] = 6; stageTimer(tgt, 2); abLog(tgt, `${nm(tgt)}의 공격이 최대로 올라갔다!`, at); }
      if (tgt.hp > 0 && total > 0) onHitAbility(tgt, user, move, mt, at);
      if (total > 0 && user.hp > 0 && abilityOf(tgt).spicySpray && !user.status) { abLog(tgt, `${jo(nm(user), '은')} 하바네로분출에 데었다!`, at); inflict(user, 'brn', at, false, tgt); }
      if (isContact(move) && total > 0 && !A.noContact) contactAbility(user, tgt, at);
      const Hu = heldOf(user);
      // 울퉁불퉁멧은 접촉 반격 특성(까칠한피부 등)과 겹치지 않는다
      if (Hu.shellBell && total > 0 && user.hp > 0) heal(user, Math.max(1, Math.floor(total / Hu.shellBell)), at);
      if (Hu.lifeOrb && total > 0 && user.hp > 0 && !user.lifeOrbHit) { user.lifeOrbHit = true; log(`${jo(nm(user), '은')} 생명이 조금 깎였다!`, at); damage(user, pctDmg(user, 1 / 10), null, at); }
      if (heldOf(tgt).helmet && !abilityOf(tgt).contact?.dmg && isContact(move) && total > 0 && user.hp > 0) { log(`${jo(nm(user), '은')} ${jo(ITEMS[tgt.held].n, '으로')} 데미지를 입었다!`, at); damage(user, pctDmg(user, 1 / heldOf(tgt).helmet), tgt, at); }
      if (tgt.hp > 0 && total > 0 && abilityOf(tgt).colorChange && mt && !(tgt.types.length === 1 && tgt.types[0] === mt)) { tgt.types = [mt]; abLog(tgt, `${jo(nm(tgt), '은')} ${typeName(mt)} 타입이 되었다!`, at); }
    } else if (R.seed) {
      if (tgt.types.includes(12)) log(`${nm(tgt)}에게는 효과가 없는 것 같다...`, at, 'weak');
      else if (tgt.seeded) log('그러나 실패했다!', at);
      else { tgt.seeded = { by: user, t: SEED_TURNS, k: 0 }; log(`${nm(tgt)}에게 씨앗을 심었다!`, at); }
    } else if (R.transform) {
      if (!transformInto(user, tgt, at, true)) log('그러나 실패했다!', at);
    } else if (R.sketch) {
      sketchFrom(user, tgt, at);
    } else if (R.taunt) {
      if (tgt.tauntT) log('그러나 실패했다!', at);
      else { tgt.tauntT = TAUNT_TURNS; log(`${jo(nm(tgt), '은')} 도발에 넘어가 버렸다! (${TAUNT_TURNS}턴 동안 공격 기술만)`, at); }
    } else if (R.yawn) {
      if (tgt.status || tgt.yawnT) log('그러나 실패했다!', at);
      else { tgt.yawnT = 2; log(`${jo(nm(tgt), '은')} 졸음이 쏟아지기 시작했다...`, at); }
    } else if (move.ail) {
      if (Math.random() * 100 < (move.ac || 100)) inflict(tgt, AILMENT_MAP[move.ail], at, true, user);
    }
    if (move.sc && secondary && Math.random() * 100 < move.scc * serene) {
      // 자신의 능력 변화는 한 번 쓸 때 한 번만 (주변 기술로 여럿을 맞혀도 겹치지 않게)
      const selfOk = user.hp > 0 && !user.selfScDone;
      for (const [st, ch] of move.sc) {
        if (move.ss) { if (selfOk) statChange(user, st, ch, at, user); continue; }
        if (ch < 0 && tgt.hp > 0) statChange(tgt, st, ch, at, user);
        if (ch > 0 && selfOk) statChange(user, st, ch, at, user);
      }
      if (move.ss || move.sc.some(([, ch]) => ch > 0)) user.selfScDone = true;
    }
  }
  // 스케치 (v0.99): 리더는 상대 기술 중 골라서, 동료는 아무거나 하나. 적이 쓰면 아무 일도 없다
  function sketchFrom(user, tgt, at) {
    if (!(user.player || user.ally) || user.tf) { log('그러나 아무 일도 일어나지 않았다!', at); return; }
    const left = sketchLeft(user);
    if (left <= 0) { log('스케치할 수 있는 횟수를 다 썼다! (Lv11·21…91이 될 때마다 한 번씩 늘어난다)', at); return; }
    const have = new Set([...user.moves.map(m => m.id), ...(user.tms || [])]);
    const cands = [...new Set((tgt.moves || []).map(m => m.id))].filter(m => DATA.moves[m] && m !== SKETCH && m !== 165 && !have.has(m));
    if (!cands.length) { log(`${nm(tgt)}에게서 새로 배울 수 있는 기술이 없다!`, at); return; }
    if (!user.player) { learnSketch(user, pick(cands), at); return; }
    const mvLabel = m => { const d = DATA.moves[m]; return `${esc(d.n)} <span class="dim">${typeName(d.t)} · ${['', '변화', '물리', '특수'][d.c]}${d.p ? ' · 위력 ' + d.p : ''}</span>`; };
    D.prompts.push(() => UI.open({
      title: `✏️ 스케치 — ${esc(nm(tgt))}의 기술`,
      html: `<p>하나를 골라 영구히 배웁니다. 스케치 칸이 그 기술로 바뀌어요. <span class="dim">(남은 스케치 ${left}번)</span></p>`,
      choices: [...cands.map(m => ({ label: mvLabel(m), sub: DATA.moves[m].d || '', fn: () => learnSketch(user, m, now()) })), { label: '그만둔다 (횟수는 줄지 않는다)', fn: () => {} }],
      cancel: () => {},
    }));
  }
  function learnSketch(user, mid, at) {
    const S = Game.save, key = user.rsp || user.sp, i = user.moves.findIndex(m => m.id === SKETCH), mv = newMove(user, mid);
    if (i >= 0) user.moves[i] = mv; else if (user.moves.length < 4) user.moves.push(mv);
    user.tms = [...new Set([...(user.tms || []), mid])];
    S.sketched = S.sketched || {}; S.sketched[key] = [...(S.sketched[key] || []), mid];
    if (S.roster[key]) S.roster[key].tms = [...new Set([...(S.roster[key].tms || []), mid])];
    Sound.play('levelup', at);
    log(`✏️ ${jo(nm(user), '은')} ${jo(DATA.moves[mid].n, '을')} 스케치했다! (마을의 기술 설정에서도 언제든 넣을 수 있다)`, at);
    Game.persist();
  }
  function setFlinch(c, at) {
    if (abilityOf(c).noFlinch) { abLog(c, `${jo(nm(c), '은')} 풀죽지 않는다!`, at); return; }
    c.flinch = true;
  }
  // 맞았을 때 발동하는 특성 (주눅, 정의의마음, 지구력, 깨어진갑옷, 열교환)
  function onHitAbility(tgt, user, move, mt, at) {
    const o = abilityOf(tgt).onHitBy; if (!o) return;
    if (o.types && !o.types.includes(mt)) return;
    if (o.t && o.t !== mt) return;
    if (o.phys && move.c !== 2) return;
    statChange(tgt, o.st, o.ch, at, tgt);
    if (o.st2) statChange(tgt, o.st2, o.ch2, at, tgt);
  }
  // 접촉 공격에 반응하는 특성
  function contactAbility(user, tgt, at) {
    const D_ = abilityOf(tgt), A = abilityOf(user);
    const c = D_.contact;
    if (c && user.hp > 0) {
      if (c.ail && Math.random() * 100 < c.c) inflict(user, c.ail === 'spore' ? pick(['psn', 'par', 'slp']) : c.ail, at, false, tgt);
      if (c.dmg) { const amt = pctDmg(user, 1 / c.dmg); abLog(tgt, `${jo(nm(user), '은')} 상처를 입었다!`, at); damage(user, amt, tgt, at); }
      if (c.st) statChange(user, c.st, c.ch, at, tgt);
      if (c.flinch && Math.random() * 100 < c.flinch) setFlinch(user, at);
      if (c.item && tgt.player && Math.random() * 100 < c.item) { const id = weighted(dropTable(D.dropLv, D.dg)); if (addToBag(id)) abLog(tgt, `${jo(ITEMS[id].n, '을')} 빼앗았다!`, at); }
    }
    if (A.magician && party(user) && Math.random() < 0.1) { const id = weighted(dropTable(D.dropLv, D.dg)); if (addToBag(id)) abLog(user, `${jo(ITEMS[id].n, '을')} 손에 넣었다!`, at); }
  }
  function applySelf(user, move, at, R = {}) {
    if (R.setTerrain) {
      if (D.terrain === R.setTerrain && D.terrainT > TERRAIN_TURNS / 2) log(`그러나 이미 ${TERRAINS[R.setTerrain].n}이다!`, at);
      else setTerrain(R.setTerrain, user, at, true);   // 절반 넘게 지났으면 다시 깔아 턴을 늘린다
      return;
    }
    if (R.setWx) {
      if (weatherNow() === R.setWx) log(`그러나 날씨는 이미 ${WEATHERS[R.setWx].n}이다!`, at);
      else setWeather(R.setWx, user, at, true);
      return;
    }
    if (R.protect) {
      const chain = user.protectPrev ? (user.protectChain || 0) : 0;
      if (Math.random() < 1 / 2 ** chain) { user.protecting = true; user.protectChain = chain + 1; log(`${jo(nm(user), '은')} 방어 태세에 들어갔다!`, at); D.fx.push({ kind: 'ring', x: user.x, y: user.y, at, dur: 400 * spd(), color: '#9fd8ff' }); }
      else { user.protectChain = 0; log('그러나 실패했다! (연속으로 쓰면 실패하기 쉽다)', at); }
      return;
    }
    if (R.rest) {
      if (user.hp >= user.maxhp && !user.status) { log('그러나 실패했다!', at); return; }
      heal(user, user.maxhp, at);
      user.status = 'slp'; user.statusT = REST_TURNS; user.yawnT = 0;
      log(`${jo(nm(user), '은')} 잠들어서 건강해졌다!`, at);
      return;
    }
    // 날씨가 맞아야 하는 기술 (오로라베일: 설경일 때만)
    if (R.needWx && weatherNow() !== R.needWx) { log(`${WX_NEED_MSG[R.needWx] || '날씨가 맞지 않아서'} 실패했다!`, at); return; }
    // 같은 편 전체 기술(생명의물방울 등)은 주변의 같은 편에게도
    const who = R.team ? [D.player, ...D.mons].filter(t => t && t.hp > 0 && !t.npc && (t === user || (!hostileTo(user, t)
      && Math.max(Math.abs(t.x - user.x), Math.abs(t.y - user.y)) <= TEAM_RANGE && los(user.x, user.y, t.x, t.y)))) : [user];
    for (const t of who) {
      if (move.h > 0) {
        // 날씨에 따라 회복량이 바뀌는 기술 (js/moverules.js)
        const w = abilityOf(user).megaSol ? 'sun' : weatherNow();   // 메가솔라: 늘 쾌청처럼
        const mul = R.sunHeal ? (w === 'sun' ? WEATHER_HEAL_MUL : w ? WEATHER_HEAL_LOW : 1) : R.sandHeal && w === 'sand' ? WEATHER_HEAL_MUL : 1;
        const h = user.boss ? Math.min(move.h, BOSS_HEAL_MAX) : move.h;   // 보스는 회복량을 줄인다
        heal(t, Math.floor(t.maxhp * h * mul / 100), at);
      }
      const scMul = R.sunSc && (abilityOf(user).megaSol || weatherNow() === 'sun') ? 2 : 1;   // 성장: 쾌청이면 2랭크씩
      if (move.sc) for (const [st, ch] of move.sc) {
        if (ch > 0) statChange(t, st, ch * scMul, at, t);
        else if (move.ss && t === user) statChange(t, st, ch, at, t);   // 껍질깨기: 자신의 방어·특방도 떨어진다 (v0.98)
      }
      if (R.cure && t.status) { t.status = null; t.statusT = 0; log(`${nm(t)}의 상태 이상이 나았다!`, at); }
      if (R.screen) { screenKeys(R).forEach(k => { t[k] = SCREEN_TURNS; }); log(`${nm(t)}에게 ${jo(SCREEN_NAME[R.screen], '이')} 생겼다! (${SCREEN_TURNS}턴)`, at); }
      D.fx.push({ kind: 'ring', x: t.x, y: t.y, at, dur: 300 * spd(), color: '#fff6a0' });
    }
  }
  // 벽 기술이 거는 효과: phys 리플렉터 / spec 빛의장막 / both 오로라베일 (둘 다)
  const screenKeys = R => (R.screen === 'both' ? ['reflectT', 'screenT'] : [R.screen === 'phys' ? 'reflectT' : 'screenT']);
  const SCREEN_NAME = { phys: '리플렉터', spec: '빛의장막', both: '오로라베일' };
  const WX_NEED_MSG = { snow: '설경이 아니라서' };
  function heal(c, amt, at) {
    if (D.rule === 'heal' && party(c) && amt > 0) amt = Math.ceil(amt / 2);   // 끝없는 던전 규칙: 회복 절반
    const before = c.hp; c.hp = Math.min(c.maxhp, c.hp + amt);
    if (c.hp !== before) noteHp(c, at, before);
    if (party(c) && c.hp > before) runStat(c).heal += c.hp - before;
    if (c.hp > before) { if (c.player) Sound.play('heal', at); popup(c, '+' + (c.hp - before), '#7f7', at); log(`${jo(nm(c), '은')} HP를 ${c.hp - before} 회복했다.`, at); }
  }
  // src: 능력 변화를 일으킨 쪽 (상대가 떨어뜨렸는지 판정)
  function statChange(c, st, ch, at, src, turns) {
    const A = abilityOf(c), byFoe = src && src !== c;
    if (A.contrary) ch = -ch;
    if (A.simple) ch *= 2;
    if (ch < 0 && byFoe) {
      const nd = A.noDrop;
      if (nd && (nd === 'all' || nd.includes(st))) { abLog(c, `${nm(c)}의 ${jo(STAT_NAMES[st], '은')} 떨어지지 않는다!`, at); return; }
      if (heldOf(c).noDrop) { log(`${ITEMS[c.held].n}의 힘으로 ${nm(c)}의 ${jo(STAT_NAMES[st], '은')} 떨어지지 않았다!`, at); return; }
    }
    const cur = c.stages[st] || 0;
    let nv = clamp(cur + ch, -6, 6);
    if (ch < 0 && src === c && !turns) {   // 자기 기술의 반동: -2까지만
      nv = Math.max(nv, Math.min(cur, SELF_DROP_MIN));
      if (nv === cur) { log(`${nm(c)}의 ${jo(STAT_NAMES[st], '은')} 반동으로는 더 떨어지지 않는다. (${SELF_DROP_MIN}까지)`, at); return; }
    }
    if (nv === cur) {   // 이미 최대: 가장 적게 남은 랭크의 지속 시간을 새로 센다
      stageRefresh(c, st, Math.abs(ch), turns);
      log(`${nm(c)}의 ${jo(STAT_NAMES[st], '은')} 더 이상 ${ch > 0 ? '오르지' : '떨어지지'} 않는다! (지속 시간 갱신)`, at); return;
    }
    c.stages[st] = nv; stageTimer(c, st, turns);
    if (c.player || seen(c)) Sound.play(ch > 0 ? 'up' : 'down2', at);
    log(`${nm(c)}의 ${jo(STAT_NAMES[st], '이')}${Math.abs(ch) > 1 ? ' 크게' : ''} ${ch > 0 ? '올라갔다!' : '떨어졌다!'}`, at);
    if (ch < 0 && byFoe && A.defiant) { abLog(c, '능력이 떨어져서 오기가 생겼다!', at); statChange(c, A.defiant, 2, at, c); }
  }
  const STATUS_IMMUNE_TYPES = { psn: [4, 9], brn: [10], par: [13], frz: [15] };   // 그 상태 이상에 걸리지 않는 타입
  function inflict(c, kind, at, verbose, src) {
    if (c.status) { if (verbose) log(`${nm(c)}에게는 효과가 없었다.`, at); return; }
    const imm = STATUS_IMMUNE_TYPES[kind] || [];
    if (c.types.some(t => imm.includes(t)) && !(kind === 'psn' && src && abilityOf(src).corrosion)) { if (verbose) log(`${nm(c)}에게는 효과가 없었다.`, at); return; }
    const A = src && src !== c ? defAbility(src, c) : abilityOf(c);
    if (terrainOn(c, 'misty')) { if (verbose || c.player || seen(c)) log(`${jo(nm(c), '은')} 미스트필드에 지켜지고 있다!`, at); return; }   // 미스트필드: 상태이상·혼란을 막는다
    if (kind === 'slp' && terrainOn(c, 'electric')) { if (verbose || c.player || seen(c)) log(`${jo(nm(c), '은')} 일렉트릭필드 때문에 잠들지 않는다!`, at); return; }
    if (kind === 'slp' && [D.player, ...D.mons].some(x => x && x.hp > 0 && x.rampage && x.rampage.uproar)) { if (verbose || c.player || seen(c)) log(`소란 때문에 ${jo(nm(c), '은')} 잠들 수 없다!`, at); return; }   // 소란피기 중에는 아무도 잠들지 않는다
    if (kind === 'slp' && c.noSleep) { log(`${jo(nm(c), '은')} 유루열매 덕분에 잠들지 않았다!`, at); return; }
    if (heldOf(c).noStatus && heldOf(c).noStatus.includes(kind)) { log(`${jo(nm(c), '은')} ${ITEMS[c.held].n}의 힘으로 ${STATUS_NAMES[kind]} 상태를 막았다!`, at); return; }
    if (A.noStatus && A.noStatus.includes(kind)) { abLog(c, `${jo(nm(c), '은')} ${STATUS_NAMES[kind]} 상태가 되지 않는다!`, at); return; }
    // 스위트베일·아로마베일 (v0.90): 같은 층의 같은 편 모두를 지킨다 (공격한 쪽이 틀깨기 등이면 무시)
    const guard = !(src && src !== c && abilityOf(src).moldBreaker) && [D.player, ...D.mons].find(x => x && x !== c && x.hp > 0 && !x.npc && !x.dead && !!(x.player || x.ally) === !!(c.player || c.ally) && (abilityOf(x).veil || []).includes(kind));
    if (guard) { abLog(guard, `${jo(nm(guard), '의')} ${abilityName(guard.ability)} 덕분에 ${jo(nm(c), '은')} ${STATUS_NAMES[kind]} 상태가 되지 않는다!`, at); return; }
    const sr = Object.keys(A).length ? abVal(c, 'statusResist') : 0;
    if (kind === 'frz' && weatherNow() === 'sun') { if (verbose) log(`${nm(c)}에게는 효과가 없었다.`, at); return; }
    if (sr && Math.random() < sr) { abLog(c, `${jo(nm(c), '은')} 상태이상을 막아냈다!`, at); return; }
    c.status = kind;
    c.statusT = { slp: rint(3, 5), frz: rint(2, 4), par: 15, psn: 15, brn: 15, cnf: rint(4, 7) }[kind];
    if (c.boss) c.statusT = Math.max(1, Math.ceil(c.statusT / 2));
    if (heldOf(c).statusShort) c.statusT = Math.max(1, Math.ceil(c.statusT / 2));
    if ((A.earlyBird && kind === 'slp') || A.naturalCure) c.statusT = Math.max(1, Math.ceil(c.statusT / 2));
    const msg = { psn: '독에 걸렸다!', brn: '화상을 입었다!', par: '마비되었다!', slp: '잠들어 버렸다!', frz: '얼어붙었다!', cnf: '혼란에 빠졌다!' }[kind];
    log(`${jo(nm(c), '은')} ${msg}`, at, 'st-' + kind);
    popup(c, STATUS_NAMES[kind], STATUS_COLORS[kind], at + 120, 'small');
    if (c.player || seen(c)) Sound.play('status', at);
    if (abilityOf(c).synchronize && src && src !== c && ['psn', 'brn', 'par'].includes(kind) && !src.status) {
      abLog(c, '상태이상을 되돌려 보냈다!', at); inflict(src, kind, at, false, null);
    }
  }
  // eff: 타입 상성 배율 (데미지 숫자 색과 크기를 바꾼다)
  // 최대 HP에 비례하는 데미지 (독·화상·모래바람·까칠한피부·울퉁불퉁멧·함정 등): 보스는 HP가 많아서 절반만
  const BOSS_PCT_MUL = 0.5;
  const pctDmg = (c, frac) => Math.max(1, Math.floor(c.maxhp * frac * (c.boss ? BOSS_PCT_MUL : 1)));
  // multi: 연속기(2회 이상)로 한꺼번에 받은 데미지. 옹골참·기합의띠는 첫 대만 버티고 다음 대에 쓰러지므로 버티지 못한다 (원작과 같게, v0.91)
  function damage(c, amt, src, at, eff = 1, crit = false, multi = false, noPop = false) {
    if (c.hp <= 0) return;
    if (src && party(src) && !party(c)) { wakeNap(c, at, true); if (src.player) c.provoked = true; }
    if (src && !party(src) && party(c)) src.hitParty = D.turn;   // 탐험대를 공격한 적 (동료가 멀리서 쏘는 적도 상대하게, v1.02)
    if (src && src !== c) { c.lastHurt = amt; c.lastHurtTurn = D.turn; }   // 앙갚음용: 공격으로 받은 데미지   // 잠든 적은 맞으면 깬다 / 리더가 공격한 적 (먼저 공격하지마 작전)
    const A = abilityOf(c);
    if (!src && A.magicGuard) return;
    const brk = !!(src && src !== c && abilityOf(src).moldBreaker);   // 틀깨기·터보블레이즈·테라볼티지 등: 옹골참을 무시한다 (v0.100 수정)
    if (A.sturdy && !brk && !multi && c.hp >= c.maxhp && amt >= c.hp && c.maxhp > 1) { amt = c.hp - 1; abLog(c, `${jo(nm(c), '은')} 공격을 버텼다!`, at); }
    const H = heldOf(c);
    if (amt >= c.hp && c.hp > 1 && ((H.sash && !multi && c.hp >= c.maxhp) || (H.band && Math.random() < H.band))) {
      amt = c.hp - 1; log(`${jo(nm(c), '은')} ${jo(ITEMS[c.held].n, '으로')} 버텼다!`, at);
    }
    const wasAboveHalf = c.hp > c.maxhp / 2;
    // 탐험대 기록: 준 데미지·받은 데미지 (쓰러뜨릴 때 넘친 만큼은 빼고)
    const real = Math.max(0, Math.min(amt, c.hp));
    if (src && party(src) && !party(c)) runStat(src).dealt += real;
    if (party(c)) runStat(c).taken += real;
    noteHp(c, at, c.hp); c.hp -= amt; c.hurtAt = at;
    if (A.berserk && wasAboveHalf && c.hp > 0 && c.hp <= c.maxhp / 2 && !c.berserkUsed) { c.berserkUsed = true; abLog(c, `${jo(nm(c), '은')} 발끈했다!`, at); statChange(c, 4, 1, at, c); }
    if (c.player && amt >= c.maxhp * 0.2) setFace('Pain', 1200);
    c.lastHurtSeq = ++D.seq; c.lastHurtBy = src ? src.id : null;
    if (noPop) { if (crit) popup(c, '급소!', '#ff5ce1', at, 'small'); }   // 연속기: 한 대씩 따로 띄웠다
    else if (crit) popup(c, amt + (eff > 1 ? '!!' : '!'), '#ff5ce1', at, 'big');
    else if (eff > 1) popup(c, amt + '!', '#ffb02e', at, 'big');
    else if (eff < 1) popup(c, String(amt), '#8ea6c8', at, 'small');
    else popup(c, String(amt), c.player ? '#ff8a8a' : '#fff', at);
    if (c.status === 'frz' && src && amt > 0 && Math.random() < 0.3) { c.status = null; log(`${nm(c)}의 얼음이 녹았다!`, at); }
    if (c.hp <= 0) { if (src && party(src) && !party(c)) runStat(src).kills++; c.hp = 0; faint(c, src, at); }
  }
  // 리플렉터·빛의장막·도발·하품·씨뿌리기: 턴마다 줄어든다
  function effectTick(c) {
    if (c.hp <= 0) return;
    const at = Math.max(T.cursor, T.moveEnd), show = c.player || seen(c);
    if (c.reflectT && --c.reflectT <= 0) { c.reflectT = 0; if (show) log(`${nm(c)}의 리플렉터가 사라졌다.`, at); }
    if (c.screenT && --c.screenT <= 0) { c.screenT = 0; if (show) log(`${nm(c)}의 빛의장막이 사라졌다.`, at); }
    if (c.tauntT && --c.tauntT <= 0) { c.tauntT = 0; if (show) log(`${nm(c)}의 도발이 풀렸다.`, at); }
    if (c.boundT > 0) {   // 가두는 기술: 턴마다 1/16, 가둔 쪽이 쓰러지거나 멀어지면 풀린다
      const by = c.boundBy;
      if (!by || by.hp <= 0 || Math.max(Math.abs(by.x - c.x), Math.abs(by.y - c.y)) > 6) c.boundT = 0;
      else { damage(c, Math.max(1, Math.floor(c.maxhp / 16)), by, at); if (show) log(`${jo(nm(c), '은')} 갇혀서 데미지를 입고 있다.`, at); if (--c.boundT <= 0 && c.hp > 0 && show) log(`${jo(nm(c), '은')} 풀려났다!`, at); }
      if (c.boundT <= 0) c.boundBy = null;
    }
    if (c.yawnT && --c.yawnT <= 0) { c.yawnT = 0; if (!c.status) inflict(c, 'slp', at, true); }
    const sd = c.seeded;
    if (sd) {
      if (--sd.t <= 0) { c.seeded = null; if (show) log(`${nm(c)}의 씨앗이 시들었다.`, at); return; }
      if (++sd.k % 2) return;
      const amt = pctDmg(c, 1 / 12), by = sd.by;   // 보스는 최대 HP 비례 데미지 반감
      if (show) log(`씨앗이 ${nm(c)}의 체력을 빼앗는다!`, at);
      damage(c, amt, null, at);
      if (by && by.hp > 0 && (by.player || D.mons.includes(by))) heal(by, amt, at);
    }
  }

  // 하드모드 적의 기술: 배울 수 있는 기술(레벨업·진화 전·기술머신) 중 자속 강한 기술 → 다른 타입 견제기 → 쓸 만한 변화 기술
  const HARD_STATUS = [14, 417, 349, 97, 86, 261, 281, 73, 182, 115, 113, 269, 77, 79, 92];
  function hardMoves(c) {
    const s = DATA.species[looksOf(c)], phys = c.atk >= c.spa;
    // 레벨업(진화 전 포함)으로 배우는 기술이 중심. 기술머신은 다른 타입 견제기에만, 레벨에 맞는 위력까지 (위력 40 + 레벨×2)
    const lvPool = [...new Set([...learnableUpTo(c.sp, c.lv), ...preEvos(c.sp).flatMap(x => learnableUpTo(x, c.lv))])].filter(m => DATA.moves[m]);
    const tmPool = tmMovesOf(c.sp).filter(m => DATA.moves[m] && (DATA.moves[m].p || 0) <= 40 + c.lv * 2 && !lvPool.includes(m));
    const rate = m => {
      const mv = DATA.moves[m], R = MOVE_RULES[m] || {};
      // 쓰기 어려운 기술은 뺀다: 자폭·반동 휴식·모으기·미래예지·잠꼬대류·첫 공격 전용·기습·웨더볼·힘껏펀치
      if (!mv.p || mv.c === 1 || R.selfKO || R.recharge || R.charge || R.delay || R.needSleepSelf || R.needSleepTarget || R.first || R.sucker || R.weatherBall || R.focus) return 0;
      const hits = mv.hits ? Math.min(3, (mv.hits[0] + mv.hits[1]) / 2) : 1;   // 연속기는 3번까지만 쳐서 계산 (씨기관총이 너무 높게 나오지 않게)
      return mv.p * hits * ((mv.a || 100) / 100) * (s.t.includes(mv.t) ? 1.5 : 1) * ((mv.c === 2) === phys ? 1 : 0.6);
    };
    const best = list => list.filter(m => rate(m) > 0).sort((a, b) => rate(b) - rate(a));
    const lvDmg = best(lvPool), allDmg = best([...lvPool, ...tmPool]);
    if (!allDmg.length) return c.moves;   // 공격 기술이 하나도 없으면 원래 기술 그대로
    const picks = [], has = t => picks.some(x => DATA.moves[x].t === t);
    for (const t of s.t) { const m = lvDmg.find(x => DATA.moves[x].t === t) || allDmg.find(x => DATA.moves[x].t === t); if (m) picks.push(m); }   // 타입마다 자속 기술 (레벨업 우선)
    const cover = allDmg.find(x => !has(DATA.moves[x].t)); if (cover && picks.length < 3) picks.push(cover);   // 다른 타입 견제기 (기술머신 가능)
    const st = HARD_STATUS.find(m => lvPool.includes(m)); if (st) picks.push(st);   // 변화 기술은 레벨업으로 배우는 것만
    for (const m of [...lvDmg, ...allDmg]) { if (picks.length >= 4) break; if (!picks.includes(m)) picks.push(m); }
    return picks.slice(0, 4).map(m => newMove(c, m));
  }


  // 이번 탐험의 탐험대 기록 (포켓몬마다): run.stats[번호] = { dealt, taken, kills, heal }
  function runStat(c) {
    run.stats = run.stats || {};
    return run.stats[c.sp] = run.stats[c.sp] || { dealt: 0, taken: 0, kills: 0, heal: 0, leader: !!c.player };
  }
  // 전용 날씨를 부른 포켓몬이 쓰러지면: 층의 원래 날씨로
  function endExtremeWeather(at) {
    const old = D.weather; D.wxLock = null;
    D.weather = D.baseWeather || null; CUR_WEATHER = D.weather;
    log(`${WEATHERS[old].icon} ${jo(WEATHERS[old].n, '이')} 그쳤다.`, at);
    applyForecast(D.player); D.mons.forEach(applyForecast);
  }
  // 부활씨 (v0.102 보강): 되살아나면 PP도 모두 채운다 (변신 중이면 원래 기술도)
  function refillPP(c) { for (const m of [...(c.moves || []), ...((c.tf && c.tf.moves) || [])]) if (m && m.max) m.pp = m.max; }
  function faint(c, src, at) {
    if (c.player) {
      const bi = run.bag.findIndex(b => b.id === 'reviver');
      if (bi >= 0) {
        takeFromBag(bi);
        c.hp = c.maxhp; c.status = null; c.stages = {}; c.stageS = {}; c.stageT = {}; refillPP(c);
        log(`쓰러졌지만 부활씨의 힘으로 되살아났다! (PP도 모두 회복)`, at);
        popup(c, 'REVIVE', '#ffe066', at + 150);
        return;
      }
      log(`${jo(nm(c), '은')} 쓰러지고 말았다...`, at);
      Sound.play('down', at);
      D.dead = true;
      D.prompts = [faintReport];   // 같은 턴에 쌓인 계단·영입 창보다 먼저 (계단을 밟으며 쓰러져도 탐험이 끝나게)
      return;
    }
    if (D.wxLock === c) endExtremeWeather(at);
    if (c.ally) {   // 동료: 이번 탐험에서 빠진다 (마을로 돌아감)
      c.dead = true; c.deadAt = at; c.fainted = true;
      D.mons = D.mons.filter(m => m !== c); D.corpses.push(c);
      Sound.play('faint', at);
      log(`${jo(nm(c), '은')} 쓰러져서 탐험대에서 빠졌다...`, at);
      updateTacticBtn();
      return;
    }
    c.dead = true; c.deadAt = at;
    if (seen(c) || src === P()) Sound.play('faint', at);
    const byParty = !!(src && (src.player || src.ally));
    if (byParty) { Progress.add('kills'); Progress.beaten(c.sp); run.kills = (run.kills || 0) + 1; checkLater(); }
    D.mons = D.mons.filter(m => m !== c);
    D.corpses.push(c);
    if (c.item) { landItem(c.x, c.y, c.item, 1, at, false); c.item = null; }   // 쓰러진 적이 들고 있던 물건: 자동 탐색이 주우러 간다
    if (seen(c) || src === P()) log(`${jo(nm(c), '을')} 쓰러뜨렸다!`, at);
    if (src && src.hp > 0) {
      const sa = abilityOf(src);
      if (sa.onKO) statChange(src, sa.onKO === 'best' ? (src.atk >= src.spa ? 2 : 4) : sa.onKO === 'spa' ? 4 : 2, 1, at, src);
    }
    if (src && abilityOf(c).aftermath && src.hp > 0 && (abilityOf(c).aftermath !== 'contact' || c.lastHitContact)) { abLog(c, `${jo(nm(src), '은')} 폭발에 휘말렸다!`, at); damage(src, pctDmg(src, 1 / 4), c, at); }   // 유폭은 접촉 기술로 쓰러졌을 때만, 내용물분출은 어떤 공격이든 (v0.100)
    if (byParty) {
      const expOf = m => Math.floor(expGain(c, m.lv) * (c.outlaw || c.boss ? BOSS_EXP_MUL : 1) * (c.shiny ? 2 : 1) * (heldOf(m).expMul || 1) * (run.mode === 'rogue' && !D.dg.endless ? ROGUE_EXP_MUL : 1));   // 로그라이크(청정의 탑 포함) 경험치 보정
      gainExp(expOf(P()), at);
      for (const a of allies()) allyExp(a, expOf(a), at);   // 동료도 같은 방식으로 경험치를 받는다
      const free = floorAt(c.x, c.y) && !itemAt(c.x, c.y) && !(D.stairs.x === c.x && D.stairs.y === c.y);   // 웅덩이 위에서 쓰러지면 떨어뜨리지 않는다
      const sig = sigItemsFor([c.sp]);
      if (c.shiny && free) D.items.push({ x: c.x, y: c.y, id: rollMega('shiny', c.lv, D.dg) || weighted(rewardPool(D.dropLv + 10, D.dg)), n: 1 });   // 이로치: 보스 보상과 같은 등급
      else if (sig.length && !c.boss && free && Math.random() < SIG_DROP.defeat) D.items.push({ x: c.x, y: c.y, id: pick(sig), n: 1 });
      else if (Math.random() < ENEMY_DROP_CHANCE * (leadField(run.p).drop || 1) && free) { const id = floorDrop(c.lv); D.items.push(id ? { x: c.x, y: c.y, id, n: 1 } : { x: c.x, y: c.y, money: moneyPile(D.lvl) }); }
      if (c.shiny && Game.unlockShiny(c.sp)) log(Game.save.settings.autoShiny ? `✨ ${jo(spName(c.sp), '과')} 그 진화 계열의 이로치를 얻었다! 영입한 포켓몬은 다음 탐험부터 이로치 모습이 된다 (이로치 자동 적용)` : `✨ 이제 캐릭터 탭에서 ${jo(spName(c.sp), '과')} 그 진화 계열의 이로치 모습을 고를 수 있다!`, at + 300);
      if (run.mode === 'normal' && !c.outlaw && !NO_RECRUIT.includes(c.sp) && canRecruit(c.sp, Game.save.roster)) {   // 남은 진화가 없으면 진화 전 모습은 영입하지 않는다 (js/defs.js)
        const rate = recruitRateFor(P().lv, (Game.save.rank || {}).pts) * (DATA.species[c.sp].lg ? 0.5 : 1) * (heldOf(P()).recruitMul || 1);   // 등급 보너스 (v0.99)
        if (Math.random() < rate) D.prompts.push(() => recruitPrompt(c));
      }
    }
    if (c.boss) bossDefeated(c, at);
    if (c.outlaw) missionDone(c.mission, `수배범 ${jo(spName(c.sp), '을')} 붙잡았다!`);
    if (c.outlaw || c.house || c.thief) setTimeout(floorMusic, Math.max(0, at - now()) + 400);   // 다 쓰러뜨리면 원래 곡으로
  }
  // 층의 곡: 도둑질·수배범(발견)이 있으면 수배범 곡, 몬스터하우스가 남아 있으면 그 곡, 아니면 보스·던전 곡 (music/outlaw, music/monsterhouse 파일이 있을 때)
  function floorMusic() {
    if (!D) return;
    const base = () => { if (D) { if (D.boss && D.boss.hp > 0) Sound.boss(); else Sound.dungeon(D.dg); } };
    const alive = f => D.mons.some(m => m.hp > 0 && !m.dead && f(m));
    if (D.thief || alive(m => m.outlaw && m.metPlayer)) Sound.special('outlaw', base);
    else if (alive(m => m.house)) Sound.special('monsterhouse', base);
    else base();
  }
  // 동료의 경험치: 레벨이 오르면 새 기술은 빈 칸에만 (나머지는 마을의 기술 설정에서)
  function allyExp(a, amt, at, raw) {
    if (a.lv >= lvCap() || run.hard) return;   // 하드모드: 경험치 없음
    a.exp += raw ? amt : Math.max(1, Math.floor(amt / expDiv(a.sp)));   // raw: 이상한사탕
    while (a.lv < lvCap() && a.exp >= expFor(a.lv + 1)) {
      a.lv++; recalc(a);
      log(`${jo(nm(a), '은')} 레벨 ${jo(a.lv, '으로')} 올랐다!`, at);
      popup(a, 'LEVEL UP', '#ffe066', at + 200);
      for (const mid of learnedAtAll(a.sp, a.lv)) if (!a.moves.some(m => m.id === mid) && a.moves.length < 4) { a.moves.push(newMove(a, mid)); log(`${jo(nm(a), '은')} ${jo(DATA.moves[mid].n, '을')} 배웠다!`, at); }
    }
  }
  // raw: 이상한사탕처럼 정해진 만큼 (전설 보정 없이)
  function gainExp(amt, at, raw) {
    const p = P();
    if (p.lv >= lvCap() || run.hard) return;
    if (!raw) amt = Math.max(1, Math.floor(amt / expDiv(p.sp)));
    p.exp += amt;
    log(`경험치를 ${amt} 얻었다.`, at);
    while (p.lv < lvCap() && p.exp >= expFor(p.lv + 1)) {
      p.lv++; recalc(p);
      log(`${jo(nm(p), '은')} 레벨 ${jo(p.lv, '으로')} 올랐다!`, at);
      popup(p, 'LEVEL UP', '#ffe066', at + 200);
      Sound.play('levelup', at + 200); Progress.max('maxLv', p.lv); checkLater();
      setFace('Joyous', 2500);
      for (const mid of learnedAtAll(p.sp, p.lv)) {
        if (p.moves.some(m => m.id === mid)) continue;
        if (p.moves.length < 4) { p.moves.push(newMove(p, mid)); log(`${jo(DATA.moves[mid].n, '을')} 배웠다!`, at); }
        else D.learnQueue.push(mid);
      }
    }
  }

  function canAct(c) {
    if (c.recharge) { c.recharge = false; if (c.player || seen(c)) log(`${jo(nm(c), '은')} 반동으로 움직일 수 없다!`); return false; }
    if (c.flinch) {
      c.flinch = false; if (c.player || seen(c)) log(`${jo(nm(c), '은')} 풀이 죽어 움직일 수 없다!`);
      if (abilityOf(c).steadfast) statChange(c, 6, 1, now(), c);
      return false;
    }
    if (abilityOf(c).truant && Math.random() < abilityOf(c).truant) { abLog(c, `${jo(nm(c), '은')} 게으름을 피우고 있다...`); return false; }
    if (c.status === 'slp' || c.status === 'frz') { c.charging = null; c.rampage = null; }
    if (c.status === 'slp') { if (c.player) log(`${jo(nm(c), '은')} 잠들어 있다...`, undefined, 'st-slp'); return false; }
    if (c.status === 'frz') { if (c.player) log(`${jo(nm(c), '은')} 얼어서 움직일 수 없다!`, undefined, 'st-frz'); return false; }
    if (c.status === 'par' && Math.random() < 0.25) { if (c.player || seen(c)) log(`${jo(nm(c), '은')} 몸이 저려서 움직일 수 없다!`, undefined, 'st-par'); return false; }
    return true;
  }
  // 능력 변화(랭크 업·다운): 랭크 하나하나가 따로 STAGE_TURNS턴 동안 이어진다 (층을 넘어가도 유지, v0.68)
  //  예: 10턴에 +1, 30턴에 +1 → 110턴에 앞의 +1이 끝나 +1로, 130턴에 0으로
  //  c.stageS[st] = { s: 방향(+1/-1), t: [랭크마다 남은 턴] }, c.stages[st]는 지금 랭크 (= 방향 × 개수), c.stageT[st]는 가장 먼저 끝나는 랭크의 남은 턴 (표시용)
  //  반대 방향으로 바뀌면 가장 적게 남은 랭크부터 지우고, 0을 지나 방향이 바뀌면 새로 센다
  // 지속 시간 (v0.102 보강): 랭크 업 100턴, 랭크 다운 50턴, 랭크 업 아이템(플러스파워·스페셜업·열매 등) 300턴
  const STAGE_TURNS = 100, STAGE_DOWN_TURNS = 50, STAGE_ITEM_TURNS = 300;
  // 자기 기술의 반동으로 떨어지는 능력(아이스해머·인파이트·용성군 등)은 -2까지만 (v0.102 보강: 계속 쓰면 너무 약해졌다)
  const SELF_DROP_MIN = -2;
  function stageTimer(c, st, turns) {
    c.stageS = c.stageS || {}; c.stageT = c.stageT || {};
    const v = c.stages[st] || 0, n = Math.abs(v);
    let e = c.stageS[st];
    if (!e || e.s !== Math.sign(v)) e = { s: Math.sign(v), t: [] };
    e.t.sort((a, b) => b - a);
    while (e.t.length > n) e.t.pop();
    while (e.t.length < n) e.t.push(turns || (e.s > 0 ? STAGE_TURNS : STAGE_DOWN_TURNS));
    if (n) { c.stageS[st] = e; c.stageT[st] = Math.min(...e.t); }
    else { delete c.stageS[st]; delete c.stageT[st]; }
  }
  // 이미 최대(±6)인데 같은 쪽으로 또 바꾸면: 가장 적게 남은 랭크부터 k개를 새로 센다
  function stageRefresh(c, st, k, turns) {
    stageTimer(c, st);
    const e = c.stageS[st]; if (!e) return;
    e.t.sort((a, b) => a - b);
    for (let i = 0; i < Math.min(k, e.t.length); i++) e.t[i] = Math.max(e.t[i], turns || (e.s > 0 ? STAGE_TURNS : STAGE_DOWN_TURNS));
    c.stageT[st] = Math.min(...e.t);
  }
  function stageTick(c) {
    if (c.critT && --c.critT <= 0) { c.critT = 0; c.critBoost = 0; if (c.hp > 0 && (c.player || seen(c))) log(`${nm(c)}의 급소 집중이 풀렸다.`, Math.max(T.cursor, T.moveEnd)); }
    const keys = new Set([...Object.keys(c.stages || {}).filter(k => c.stages[k]), ...Object.keys(c.stageS || {})]);
    for (const k of keys) {
      stageTimer(c, k);   // 다른 곳에서 랭크를 직접 바꿨으면(회복·리셋 함정 등) 개수를 맞춘다
      const e = c.stageS[k]; if (!e) continue;
      e.t = e.t.map(x => x - 1);
      const left = e.t.filter(x => x > 0);
      if (left.length === e.t.length) { c.stageT[k] = Math.min(...e.t); continue; }
      e.t = left; c.stages[k] = e.s * left.length;
      stageTimer(c, k);
      if (c.hp > 0 && (c.player || seen(c))) log(left.length ? `${nm(c)}의 ${jo(STAT_NAMES[k], '이')} 조금 원래대로 돌아왔다. (${e.s > 0 ? '+' : ''}${c.stages[k]})` : `${nm(c)}의 ${jo(STAT_NAMES[k], '이')} 원래대로 돌아왔다.`, Math.max(T.cursor, T.moveEnd));
    }
  }
  const AI_STAGE_LIMIT = 2;   // 적은 능력 변화를 ±2단계까지만 노린다
  function statusTick(c) {
    stageTick(c);
    abilityTick(c);
    effectTick(c);
    // 치유의마음: 옆 칸 같은 편의 상태이상을 고쳐 준다
    const hl = c.hp > 0 && abilityOf(c).healer;
    if (hl) for (const t of [D.player, ...D.mons]) {
      if (!t || t === c || t.hp <= 0 || !t.status || t.npc || hostileTo(c, t) || Math.max(Math.abs(t.x - c.x), Math.abs(t.y - c.y)) > 1) continue;
      if (Math.random() < hl) { abLog(c, `${nm(c)} 덕분에 ${nm(t)}의 ${STATUS_NAMES[t.status]} 상태가 나았다!`, Math.max(T.cursor, T.moveEnd)); t.status = null; }
    }
    if (!c.status || c.hp <= 0) return;
    const A = abilityOf(c);
    const cc = abVal(c, 'cureChance');
    if (cc && Math.random() < cc) {
      abLog(c, `${nm(c)}의 ${STATUS_NAMES[c.status]} 상태가 나았다!`, Math.max(T.cursor, T.moveEnd));
      c.status = null; return;
    }
    if (c.status === 'psn' && A.poisonHeal) {
      c.stTick = (c.stTick || 0) + 1;
      if (c.stTick % 2 === 0 && c.hp < c.maxhp) heal(c, Math.max(1, Math.floor(c.maxhp / 12)), Math.max(T.cursor, T.moveEnd));
    } else if ((c.status === 'psn' || c.status === 'brn') && !(heldOf(c).orb === c.status && !ORB_STATUS_DMG)) {
      // 화염구슬·맹독구슬을 지니고 있으면 그 상태이상의 데미지는 ORB_STATUS_DMG배 (지금은 0: 받지 않는다)
      c.stTick = (c.stTick || 0) + 1;
      if (c.stTick % 2 === 0) {
        const at = Math.max(T.cursor, T.moveEnd);
        if (c.player || seen(c)) log(`${jo(nm(c), '은')} ${c.status === 'psn' ? '독' : '화상'} 데미지를 입었다.`, at, 'st-' + c.status);
        damage(c, Math.max(1, Math.floor(pctDmg(c, 1 / 14) * (heldOf(c).orb === c.status ? ORB_STATUS_DMG : 1))), null, at);
      }
    }
    if (--c.statusT <= 0 && c.hp > 0) {
      const msg = { psn: '독이 나았다.', brn: '화상이 나았다.', par: '마비가 풀렸다.', slp: '눈을 떴다!', frz: '얼음이 녹았다!', cnf: '혼란이 풀렸다!' }[c.status];
      c.status = null;
      if (c.player || seen(c)) log(`${nm(c)}의 ${msg}`);
    }
  }
  const confuse = (c, dir) => (c.status === 'cnf' && Math.random() < 0.5 ? rand(8) : dir);

  // ───────────────────────── 적 AI ─────────────────────────
  // 적이 노릴 상대: 보이는 탐험대(플레이어·동료) 중 가장 가까운 쪽. 아무도 안 보이면 플레이어 (기억해 둔 곳으로 간다)
  // 동료가 노릴 상대: 리더 근처에서 보이는 가장 가까운 적. 없으면 null (리더를 따라간다)
  const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  // 동료 작전 (탐험마다 '나를 따라와'로 시작, 던전 안에서 바꾼다)
  //   follow 나를 따라와: 리더 뒤에 줄지어 따라오고, 나나 동료 가까이 온 적을 가까운 것부터 처리한다
  //   free 각자 행동: 보이는 적을 각자 쫓아가 싸우고, 없으면 근처로 모인다
  //   wait 여기서 기다려: 그 자리에서 기다린다. 옆에 온 적에게만 반격한다
  //   attack 적을 공격해: 멀리 있는 적도 쫓아가 공격한다 (보스가 보이면 보스부터)
  //   passive 먼저 공격하지마: 리더가 공격한 적만 상대하고, 그 밖에는 따라오기만 한다
  const tactic = () => (run && run.tactic) || 'follow';
  // 동료별 작전 (v1.02): run.tactics[포켓몬 번호]가 있으면 그것, 없으면 모두의 작전
  const tacticOf = a => (run && run.tactics && a && run.tactics[a.rsp || a.sp]) || tactic();
  const TACTIC_NAMES = { follow: '나를 따라와', free: '각자 행동', wait: '여기서 기다려', attack: '적을 공격해', passive: '먼저 공격하지마', flee: '여기서 도망쳐' };
  const TACTIC_DESC = {
    follow: '리더 뒤에 줄지어 따라오고, 나나 동료 가까이 온 적을 가까운 것부터 처리하고 다시 따라온다',
    free: '보이는 적을 각자 쫓아가 싸우고, 적이 없으면 근처로 모인다',
    wait: '그 자리에서 기다린다. 옆에 온 적에게만 반격한다',
    attack: '멀리 있는 적도 쫓아가 공격한다. 보스가 보이면 보스부터 (보스 방에서 유용)',
    passive: '리더가 공격한 적만 상대하고, 그 밖에는 따라오기만 한다',
    flee: '싸우지 않고 보이는 적에게서 멀어진다. 적이 없으면 리더를 따라온다',
  };
  // 동료 창: 동료의 HP·상태·지닌 물건·기술 PP·능력 변화, 작전
  function partyMenu() {
    if (!run || !(run.party || []).length) { log('함께 온 동료가 없다.', now()); return; }
    // 동료 창: 작전과 동료 관리 (능력치·기술·능력 변화는 탐험대 상태 창에서). 여기서는 한 줄 요약만
    const row = a => {
      const pc = a.fainted ? 0 : a.hp / a.maxhp * 100;
      return `<div class="row pm-row${a.fainted ? ' out' : ''}">${portraitImg(looksOf(a), 'portrait xs', a.fainted ? 'Pain' : 'Normal', a.shiny)}
        <span class="grow"><b>${esc(nm(a))}</b> Lv${a.lv} <span class="tag">${TACTIC_NAMES[tacticOf(a)]}</span>${isSupport(a) ? ' <span class="dim">🛡 지원</span>' : ''} ${a.fainted ? '<span class="warn">쓰러짐</span>' : `HP ${a.hp}/${a.maxhp} <span class="bar small"><i style="width:${pc}%;background:${pc > 50 ? '#4de36b' : pc > 20 ? '#f5d142' : '#f55'}"></i></span>${a.status ? ` <span class="warn">${STATUS_NAMES[a.status]}</span>` : ''}${D.mons.includes(a) ? ` <span class="dim">· ${cheb(a, P())}칸 떨어짐</span>` : ''}`}</span></div>`;
    };
    UI.open({ title: '🤝 동료 · 작전', wide: true,
      html: `<div class="row"><span class="grow">모두의 작전: <b>${TACTIC_NAMES[tactic()]}</b> <span class="dim">${TACTIC_DESC[tactic()]}</span></span></div>
        ${run.party.map(row).join('')}`,
      choices: [{ label: '📊 탐험대 상태 보기 (능력치·기술)', fn: () => setTimeout(showStatus, 0) },
        ...Object.entries(TACTIC_NAMES).map(([k, n]) => ({ label: `${k === tactic() && !Object.keys(run.tactics || {}).length ? '✔ ' : ''}모두: ${n}`, sub: TACTIC_DESC[k], fn: () => { run.tactic = k; run.tactics = {}; saveTactics(); log(`🤝 모두의 작전: ${n}`, now()); partyMenu(); } })),
        ...liveAllies().map(a => ({ label: `🎯 ${esc(nm(a))}의 작전: ${TACTIC_NAMES[tacticOf(a)]} <span class="dim">(눌러서 바꾸기)</span>`, fn: () => allyTacticMenu(a) })),
        ...run.party.filter(a => Game.save.roster[supportKey(a)]).map(a => ({ label: `${isSupport(a) ? '🛡 지원 위주' : '⚔ 공격 위주'} · ${esc(nm(a))} <span class="dim">(눌러서 ${isSupport(a) ? '공격 위주로' : '지원 위주로'})</span>`,
          sub: hasSupportMove(a) ? '지원 위주: 벽은 끊기기 전에 다시 깔고, 능력 올리기는 +6까지, 회복은 HP 60%부터, 유리한 날씨는 바로. 할 일이 없으면 공격' : '⚠ 회복·벽·능력 올리기·날씨 기술이 없어서 지원 위주로 바꿔도 달라지지 않아요',
          fn: () => { const ch = Game.save.roster[supportKey(a)]; if (ch.support) delete ch.support; else ch.support = true; Game.persist(); log(`🤝 ${jo(nm(a), '은')} ${ch.support ? '지원 위주로' : '공격 위주로'} 싸운다.`, now()); partyMenu(); } })),
        ...(liveAllies().length && run.bag.some(b => ALLY_USES.includes(ITEMS[b.id].use)) ? [{ label: '🎒 동료에게 아이템 쓰기', fn: allyBag }] : []),
        ...(downAllies().length && run.bag.some(b => b.id === 'reviver') ? [{ label: `🌰 쓰러진 동료 되살리기 (부활씨 ${run.bag.filter(b => b.id === 'reviver').length}개)`, fn: () => pickReviveFor(run.bag.findIndex(b => b.id === 'reviver'), partyMenu) }] : []),
        ...(liveAllies().length ? [{ label: '🎁 동료 지닌 물건 바꾸기', fn: () => pickAlly('누구의 지닌 물건을 바꿀까?', allyHeld) },
          { label: '📘 동료 기술 바꾸기', fn: () => pickAlly('누구의 기술을 바꿀까?', allyMoves) }] : []),
        { label: '닫기', fn: () => {} }] });
  }
  // 바꾼 작전을 이어하기 기록에 바로 남긴다 (새로고침해도 그대로)
  function saveTactics() { const sr = Game.save.run; if (sr && sr.dungeon === run.dungeon) { sr.tactic = run.tactic || null; sr.tactics = run.tactics || null; Game.persist(); } }
  // 동료 한 마리의 작전 (v1.02)
  function allyTacticMenu(a) {
    const key = a.rsp || a.sp, cur = (run.tactics || {})[key];
    UI.open({ title: `🎯 ${esc(nm(a))}의 작전`, wide: true,
      choices: [{ label: `${!cur ? '✔ ' : ''}모두의 작전을 따른다 (${TACTIC_NAMES[tactic()]})`, fn: () => { if (run.tactics) delete run.tactics[key]; saveTactics(); log(`🤝 ${jo(nm(a), '은')} 모두의 작전을 따른다.`, now()); partyMenu(); } },
        ...Object.entries(TACTIC_NAMES).map(([k, n]) => ({ label: `${cur === k ? '✔ ' : ''}${n}`, sub: TACTIC_DESC[k], fn: () => { (run.tactics = run.tactics || {})[key] = k; saveTactics(); log(`🤝 ${nm(a)}의 작전: ${n}`, now()); partyMenu(); } })),
        { label: '돌아간다', fn: partyMenu }], cancel: partyMenu });
  }
  function pickAlly(title, then) {
    const list = liveAllies();
    if (list.length === 1) return then(list[0]);
    UI.open({ title, choices: [...list.map(a => ({ label: `${esc(nm(a))} Lv${a.lv}`, fn: () => then(a) })), { label: '돌아간다', fn: partyMenu }] });
  }
  // 동료 지닌 물건: 가방의 지닌 물건과 바꾸거나 빼서 가방에 넣는다 (행동을 쓰지 않는다)
  function allyHeld(a) {
    const ab = a.baseAbility ?? a.ability;
    const list = run.bag.map((b, i) => ({ b, i })).filter(({ b }) => ITEMS[b.id].held);
    const swap = i => {
      const id = run.bag[i].id, old = a.held;
      takeFromBag(i); if (old) run.bag.push({ id: old, n: 1 });
      a.held = id; log(`${jo(nm(a), '은')} ${jo(ITEMS[id].n, '을')} 지녔다.`, now()); formCheck(a); allyHeld(a);
    };
    const own = id => !!(ITEMS[id].hold && ITEMS[id].hold.only && ITEMS[id].hold.only.includes(a.sp));
    list.sort((x, y) => own(y.b.id) - own(x.b.id));   // 이 동료의 전용 도구를 맨 위에
    UI.open({ title: `🎁 ${esc(nm(a))}의 지닌 물건: ${a.held ? ITEMS[a.held].icon + ' ' + esc(ITEMS[a.held].n) : '없음'}`, wide: true,
      html: list.length > 5 ? '<input class="held-q" placeholder="도구 이름·효과로 찾기" autocomplete="off" style="width:100%;margin-bottom:6px">' : '',
      onOpen: (box, m) => { const q = box.querySelector('.held-q'); if (q) q.oninput = () => { const v = q.value.trim().toLowerCase(); m.items.forEach(b => { b.hidden = !!v && !b.textContent.toLowerCase().includes(v) && !/돌아간다|빼서/.test(b.textContent); }); }; },
      choices: [...list.map(({ b, i }) => ({ label: `${ITEMS[b.id].icon} ${esc(ITEMS[b.id].n)}${sigTag(b.id)}`, sub: esc(heldBlockReason(ab, b.id) || ITEMS[b.id].d), disabled: !!heldBlockReason(ab, b.id), fn: () => swap(i) })),
        ...(a.held ? [{ label: '지닌 물건을 빼서 가방에 넣는다', disabled: run.bag.length >= bagMax(), sub: run.bag.length >= bagMax() ? '가방이 가득 찼다' : '', fn: () => { run.bag.push({ id: a.held, n: 1 }); log(`${nm(a)}의 ${jo(ITEMS[a.held].n, '을')} 가방에 넣었다.`, now()); a.held = null; formCheck(a); allyHeld(a); } }] : []),
        { label: '돌아간다', fn: partyMenu }] });
  }
  // 동료 기술: 지금 레벨까지 배우는 기술(진화 전 포함)·기술머신으로 배운 기술 중에서 한 칸씩 바꾼다
  // 뺐던 기술을 다시 넣으면 남아 있던 PP 그대로 (기술을 바꿔 PP를 채울 수 없게)
  function allyMoves(a) {
    if (a.tf) { UI.alert('기술 바꾸기', `<p>${esc(jo(nm(a), '은'))} 변신 중이라 기술을 바꿀 수 없어요. 다음 층에서 원래대로 돌아와요.</p>`); return; }
    const tms = (Game.save.roster[a.rsp || a.sp] || {}).tms || [];
    const pool = [...new Set([...learnableUpTo(a.sp, a.lv), ...(a.selForm && DATA.species[a.selForm] ? learnableUpTo(a.selForm, a.lv) : []), ...preEvos(a.sp).flatMap(x => learnableUpTo(x, a.lv)), ...tms])].filter(m => DATA.moves[m] && !a.moves.some(x => x.id === m));
    const slotRow = (m, k) => ({ label: m ? `${k + 1}. ${esc(DATA.moves[m.id].n)} <span class="dim">PP ${m.pp}/${m.max}</span>` : `${k + 1}. (빈 칸)`, fn: () => pickNew(k) });
    const pickNew = k => UI.open({ title: `${esc(nm(a))} — ${k + 1}번째 칸에 넣을 기술`, wide: true,
      choices: [...pool.map(mid => ({ label: moveLine(mid), fn: () => {
        a.ppKept = a.ppKept || {};
        const old = a.moves[k]; if (old) a.ppKept[old.id] = old.pp;
        const nm2 = newMove(a, mid); if (a.ppKept[mid] != null) nm2.pp = Math.min(a.ppKept[mid], nm2.max);
        a.moves[k] = nm2; log(`${jo(nm(a), '은')} ${jo(DATA.moves[mid].n, '을')} 쓰도록 했다.`, now()); allyMoves(a);
      } })), { label: '돌아간다', fn: () => allyMoves(a) }] });
    UI.open({ title: `📘 ${esc(nm(a))} 기술 바꾸기`, html: '<p class="dim">바꿀 칸을 고르세요. 뺐다가 다시 넣은 기술은 남아 있던 PP 그대로예요.</p>',
      choices: [...[0, 1, 2, 3].filter(k => k < Math.max(a.moves.length + 1, 1) && k < 4).map(k => slotRow(a.moves[k], k)), { label: '돌아간다', fn: partyMenu }] });
  }
  // 동료 창에서: 동료에게 쓸 수 있는 가방 아이템 고르기
  function allyBag() {
    const list = run.bag.map((b, i) => ({ b, i })).filter(({ b }) => ALLY_USES.includes(ITEMS[b.id].use));
    UI.open({ title: '🎒 동료에게 쓸 아이템', choices: [...list.map(({ b, i }) => ({ label: `${ITEMS[b.id].icon} ${esc(ITEMS[b.id].n)}${b.n > 1 ? ' ×' + b.n : ''} <span class="dim">${esc(ITEMS[b.id].d)}</span>`, fn: () => pickAllyFor(i, allyBag) })), { label: '돌아간다', fn: partyMenu }] });
  }
  function updateTacticBtn() {
    // 동료 버튼은 늘 보인다 (예전에는 동료와 함께일 때만 보여서 버튼이 사라진 것처럼 보였다). 혼자면 누르면 '함께 온 동료가 없다'
    const b = document.querySelector('#actions [data-k=tactic]'); if (b) b.hidden = false;
  }
  function aiTarget(e) {
    if (e.ally) {
      const lead = P(), t = tacticOf(e);
      // 따라와: 리더나 동료(자기 포함) 가까이 온 적을 가까운 것부터 처리한 뒤 다시 따라간다
      const near = m => cheb(m, lead) <= 3 || allies().some(a => cheb(m, a) <= 2);
      const ok = {
        follow: m => cheb(m, e) <= ALLY_SIGHT && (near(m) || (m.hitParty != null && D.turn - m.hitParty <= 5)),   // 가까이 온 적 + 최근에 탐험대를 공격한 적 (멀리서 쏘는 적, 물러나는 리더를 쫓는 적)
        free: m => cheb(m, e) <= ALLY_SIGHT,
        wait: m => cheb(m, e) <= 1,
        attack: m => cheb(m, e) <= ALLY_SIGHT_FAR,
        passive: m => m.provoked && cheb(m, e) <= ALLY_SIGHT,
      }[t] || (() => false);
      const foes = D.mons.filter(m => !m.npc && !m.ally && m.hp > 0 && (!m.napping || t === 'attack') && ok(m) && los(e.x, e.y, m.x, m.y));
      if (t === 'attack') { const boss = foes.find(m => m.boss); if (boss) return { p: boss, sees: true }; }
      foes.sort((a, b) => cheb(a, e) - cheb(b, e));
      return foes.length ? { p: foes[0], sees: true } : null;
    }
    const p = P();
    let best = p.hp > 0 && seen(e) ? p : null;
    // 하드모드: 가까운 상대 중 HP가 적은 쪽을 노린다 (거리 + HP 비율 × 3)
    const key = m => cheb(m, e) + (smartFoes() ? 3 * m.hp / m.maxhp : 0);
    for (const a of allies()) {
      if (cheb(a, e) > ALLY_SIGHT || !los(e.x, e.y, a.x, a.y)) continue;
      if (!best || key(a) < key(best)) best = a;
    }
    return best ? { p: best, sees: true } : { p, sees: false };
  }
  const ALLY_SIGHT = 6, ALLY_SIGHT_FAR = 12;
  // 똑똑한 적: 하드모드와 smartAI 던전(에리어 제로 최심부). 상성·면역을 따져 가장 효과적인 기술을 쓰고, HP가 낮은 탐험대를 노리고, 원거리 기술을 자주 쓴다
  const smartFoes = () => !!(run && (run.hard || (D && D.dg && D.dg.smartAI)));
  const ALLY_DETOUR = 4;   // 동료가 상대에게 가는 길이 직선거리보다 이만큼 넘게 길면 돌아가지 않는다
  // 이번 턴 행동 순서: 동료가 먼저 (리더에게 가까운 동료부터, 줄의 앞사람이 먼저 움직이게), 그다음 적
  function turnOrder() {
    const lead = P();
    // 줄 순서: 리더에게 가까운 순서지만, 지난 턴 순서를 크게 우선한다 (코너에서 뒷사람이 대각선으로 한 칸 가까워졌다고 앞뒤가 바뀌며 서로 자리를 바꾸지 않게)
    // 뒷사람이 앞사람보다 (줄에서 떨어진 칸 수 + 1)칸 넘게 리더에게 가까워야 순서가 바뀐다
    const prevOrder = (D.allyOrder || []).filter(m => m.hp > 0);
    const rank = m => { const i = prevOrder.indexOf(m); return i < 0 ? prevOrder.length + run.party.indexOf(m) : i; };
    D.allyOrder = allies().sort((a, b) => (cheb(a, lead) + rank(a) * 1.5) - (cheb(b, lead) + rank(b) * 1.5) || run.party.indexOf(a) - run.party.indexOf(b));
    return [...D.allyOrder, ...D.mons.filter(m => !m.ally)];
  }
  // 이번 턴에 움직인 자리 (뒤따르는 동료가 그 자리로 들어간다)
  function markMoved(c, fx, fy) {
    c.trail = { x: fx, y: fy, turn: D.turn };
    if (c.ally && c.hp > 0) {   // 동료도 함정을 밟는다 (리더처럼 모르는 함정·발견한 함정 확률)
      const tr = trapAt(c.x, c.y);
      if (tr && (TRAP_ALWAYS.includes(tr.kind) || Math.random() < (D.rule === 'trap' ? (tr.seen ? 0.8 : 1) : tr.seen ? TRAP_RATE.seen : TRAP_RATE.hidden))) triggerTrap(tr, 0, c);
    }
  }
  // 여기서 도망쳐 (v1.02): 보이는 적에게서 가장 멀어지는 칸으로 (같으면 리더 쪽). 적이 없으면 리더를 따라온다
  function fleeStep(a) {
    if (a.charging) a.charging = null;
    const foes = D.mons.filter(m => !m.npc && !m.ally && m.hp > 0 && cheb(m, a) <= ALLY_SIGHT && los(a.x, a.y, m.x, m.y));
    if (!foes.length) { followLeader(a); return; }
    const lead = P(), score = (x, y) => Math.min(...foes.map(m => Math.max(Math.abs(m.x - x), Math.abs(m.y - y)))) * 10 - Math.max(Math.abs(lead.x - x), Math.abs(lead.y - y));
    let best = null, bs = score(a.x, a.y);
    for (let d = 0; d < 8; d++) { const [dx, dy] = DIRS[d]; if (!canStep(a, dx, dy)) continue; const s = score(a.x + dx, a.y + dy); if (s > bs) { bs = s; best = [dx, dy]; } }
    if (!best) return;
    const fx = a.x, fy = a.y; a.x += best[0]; a.y += best[1]; a.dir = dirIndex(best[0], best[1]); schedMove(a, fx, fy); markMoved(a, fx, fy);
  }
  // 동료가 싸울 상대가 없으면 앞사람을 따라간다: 리더 → 동료1 → 동료2 … 줄지어 (멀리 떨어졌으면 한 턴에 두 칸)
  function followLeader(a) {
    if (a.swapped === D.turn) return;   // 방금 리더와 자리를 바꿨다
    const tc = tacticOf(a);
    if (tc === 'wait') return;   // 여기서 기다려
    const order = (D.allyOrder || allies()).filter(m => m.hp > 0 && D.mons.includes(m));
    const k = order.indexOf(a), prev = k > 0 ? order[k - 1] : P();
    const free = tc === 'free' || tc === 'attack', fx = a.x, fy = a.y;
    const d = cheb(a, prev);
    if (free && d <= 3) return;   // 각자 행동: 너무 멀어지지만 않게
    // 앞사람이 이번 턴에 비운 칸으로 바로 들어간다
    const tr = prev.trail;
    if (!free && tr && tr.turn === D.turn && cheb(a, tr) === 1 && !creatureAt(tr.x, tr.y) && diagOK(a.x, a.y, tr.x - a.x, tr.y - a.y) && !D.traps.some(t => t.seen && t.x === tr.x && t.y === tr.y)) {   // 발견한 함정은 밟지 않는다 (v1.06)
      const mx = tr.x - a.x, my = tr.y - a.y;
      a.x = tr.x; a.y = tr.y; a.dir = dirIndex(mx, my);
      schedMove(a, fx, fy); markMoved(a, fx, fy); return;
    }
    if (d <= 1) return;
    for (let step = d > 5 ? 2 : 1; step > 0; step--) {
      if (cheb(a, prev) <= 1) break;
      const near = (x, y) => Math.max(Math.abs(x - prev.x), Math.abs(y - prev.y)) === 1;
      const path = bfs(a.x, a.y, near, { blockMons: true, self: a, avoidTraps: true }) || bfs(a.x, a.y, near, { self: a, avoidTraps: true }) || bfs(a.x, a.y, near, { self: a });   // 발견한 함정은 돌아가고, 막혀 있으면 다른 포켓몬을 무시하고 길을 찾는다 (함정을 피할 길이 없으면 그냥 지나간다)
      if (!path) break;
      const mx = path.fx - a.x, my = path.fy - a.y;
      const b = creatureAt(a.x + mx, a.y + my);
      if (b && b.ally && b.swapped !== D.turn && diagOK(a.x, a.y, mx, my) && passable(b, a.x, a.y)) {   // 길을 막은 동료와 자리를 바꾼다 (막다른 길에서 되돌아갈 때). 그 동료가 내 자리(물·용암)에 설 수 있을 때만
        b.x = a.x; b.y = a.y; schedMove(b, a.x + mx, a.y + my); b.swapped = D.turn;
        a.x += mx; a.y += my; a.dir = dirIndex(mx, my);
        continue;
      }
      if (!canStep(a, mx, my)) break;
      a.x += mx; a.y += my; a.dir = dirIndex(mx, my);
    }
    if (a.x !== fx || a.y !== fy) { schedMove(a, fx, fy); markMoved(a, fx, fy); }
  }

  // ── 동료의 보조 기술: 회복(생명의물방울·HP회복 등), 능력 올리기(코칭·칼춤 등), 리플렉터·빛의장막 ──
  // 회복은 HP가 낮을 때 꼭, 능력 올리기·벽은 싸우는 중에 (보스전이면 더 자주, 더 높게까지). 쓸 게 없으면 null
  // 날씨가 탐험대(곁에 있는 같은 편)에게 얼마나 좋은지: 강해지는 공격 기술·날씨 특성·모래바람/설경에 강한 타입은 +, 약해지거나 다치면 −
  const WX_UP = { sun: 10, rain: 11 }, WX_DOWN = { sun: 11, rain: 10 };
  function wxValue(w, team) {
    let v = 0;
    for (const m of team) {
      const A = abilityOf(m), atk = m.moves.map(x => DATA.moves[x.id]).filter(x => x && x.c !== 1 && x.p > 0);
      if ((A.wx && A.wx.w === w) || A.setWeather === w) v += 2;
      if (WX_UP[w] && atk.some(x => x.t === WX_UP[w])) v += 1;
      if (WX_DOWN[w] && atk.some(x => x.t === WX_DOWN[w])) v -= 1;
      if (w === 'sand') v += m.types.some(t => t === 5 || t === 6 || t === 9) || A.chipImmune ? (m.types.includes(6) ? 1 : 0) : -1;
      if (w === 'snow') v += m.types.includes(15) ? 1 : -0.5;
    }
    return v;
  }
  // 지원 위주 동료 (v0.93): 동료마다 켜는 역할. 캐릭터 기록(roster)에 남아 다음 탐험에도 이어진다
  //  벽은 끊기기 전에 다시 깔고, 능력 올리기는 +6까지 확률 없이, 회복은 HP 60%부터, 날씨는 유리하면 바로
  const supportKey = a => a.rsp || a.sp;
  const isSupport = a => !!(a && a.ally && Game.save && (Game.save.roster[supportKey(a)] || {}).support);
  const supportMoveOf = m => m && m.c === 1 && m.r === 's' && (m.h > 0 || (MOVE_RULES[m.id] || {}).setWx || (MOVE_RULES[m.id] || {}).setTerrain || (MOVE_RULES[m.id] || {}).screen || (m.sc && m.sc.some(([, ch]) => ch > 0) && !m.ss));
  const hasSupportMove = a => a.moves.some(mv => supportMoveOf({ ...DATA.moves[mv.id], id: mv.id }));
  function allySupport(e, foe) {
    const sup = isSupport(e);
    const boss = !!(foe && foe.boss) || !!(D.boss && D.boss.hp > 0 && seen(D.boss));
    const team = [P(), ...allies()].filter(m => m.hp > 0 && cheb(m, e) <= TEAM_RANGE && los(e.x, e.y, m.x, m.y));
    const moves = e.moves.map((m, i) => ({ m: DATA.moves[m.id], i, id: m.id, pp: m.pp })).filter(o => o.pp > 0 && !moveOff(e, o.id) && o.m && o.m.c === 1 && o.m.r === 's' && !(e.tauntT));
    let best = null;
    for (const o of moves) {
      const R = MOVE_RULES[o.id] || {}, who = R.team ? team : R.allyHeal ? team.filter(m => m !== e) : [e];   // 치유파동: 자신 말고 같은 편
      let s = 0;
      if (o.m.h > 0) {   // 회복: 가장 다친 대상 기준
        const low = Math.min(...who.map(m => m.hp / m.maxhp));
        if (low < 0.35) s = 100; else if (low < (boss || sup ? 0.6 : 0.5)) s = sup ? 90 : 60;
      } else if (R.setWx) {   // 날씨: 싸우는 중이고, 지금 날씨보다 탐험대에 확실히 좋으면 (전용 날씨가 버티고 있으면 안 바뀌니 쓰지 않는다)
        const cur = wxBase(D.weather), lock = D.wxLock && D.wxLock.hp > 0 && !D.wxLock.dead;
        if (foe && !lock && cur !== R.setWx) {
          const gain = wxValue(R.setWx, team) - (cur ? wxValue(cur, team) : 0);
          if (wxValue(R.setWx, team) > 0 && gain >= 1) s = sup ? 80 : Math.min(boss ? 80 : 60, (boss ? 45 : 30) + gain * 10);
        }
      } else if (R.setTerrain) {   // 필드: 싸우는 중이고 아직 아니면, 그 타입 공격 기술을 가진 같은 편이 있으면 (미스트필드는 상태이상을 막으니 늘)
        const T = TERRAINS[R.setTerrain];
        // 필드는 모두에게 걸리니 같은 편 전체를 본다 (v1.04 보강: 자기만 봐서, 공격 기술이 없는 브리무음은 사이코필드를 끝내 쓰지 않았다)
        const useful = R.setTerrain === 'misty' || team.some(m => m.moves.some(x => DATA.moves[x.id] && DATA.moves[x.id].p > 0 && DATA.moves[x.id].t === T.type));
        const allyField = D.terrain && D.terrain !== R.setTerrain && D.terrainParty && D.terrainT > TERRAIN_TURNS / 3;   // 같은 편이 깐 다른 필드는 끝나 갈 때까지 덮어쓰지 않는다 (마휘핑·브리무음이 번갈아 바꾸지 않게)
        if (foe && !allyField && (D.terrain !== R.setTerrain || D.terrainT <= TERRAIN_TURNS / 3) && useful) s = sup ? 90 : boss ? 65 : 45;   // 끝나 가면 다시 깐다. 모두에게 걸리니 능력 올리기보다 먼저 (v1.03: 지원 위주 포켓몬이 랭크업을 다 쌓은 뒤에야 깔던 문제)
      } else if (R.screen) {   // 벽: 싸우는 중이고 아직 없으면 (오로라베일은 설경일 때만)
        if (foe && (!R.needWx || weatherNow() === R.needWx) && who.some(m => screenKeys(R).some(k => (m[k] || 0) <= (sup ? 2 : 0)))) s = sup ? 85 : boss ? 50 : 15;   // 지원 위주: 2턴 남으면 미리 다시
      } else if (o.m.sc && o.m.sc.some(([, ch]) => ch > 0) && !o.m.ss) {   // 능력 올리기: 아직 덜 오른 대상이 있으면
        // 얼마나 오르는지와 쓸모 (v0.102 보강): 그 포켓몬이 쓰는 공격 쪽(물리면 공격, 특수면 특수공격)이 오르면 더 높게.
        //  예전에는 오를 대상 수만 세어서 아로마미스트와 데코레이션이 같은 점수였고, 먼저 있는 아로마미스트만 썼다
        const cap = sup ? 6 : boss ? 4 : AI_STAGE_LIMIT;
        const uses = (m, c) => m.moves.some(x => DATA.moves[x.id] && DATA.moves[x.id].p > 0 && DATA.moves[x.id].c === c);
        let val = 0;
        for (const m of who) for (const [st, ch] of o.m.sc) {
          const g = ch > 0 ? Math.min(ch, cap - (m.stages[st] || 0)) : 0; if (g <= 0) continue;
          val += g * (st === 2 ? (uses(m, 2) ? 1.5 : 0.3) : st === 4 ? (uses(m, 3) ? 1.5 : 0.3) : 1);
        }
        if (foe && val > 0) s = Math.min(95, sup ? 65 + val * 3 : (boss ? 35 : 8) + val * 3);
      }
      if (s && (!best || s > best.s)) best = { ...o, s };
    }
    if (!best) return null;
    // 급한 회복은 늘, 나머지는 확률로 (매 턴 쓰지 않게). 지원 위주는 할 일이 있으면 늘
    return sup || best.s >= 100 || Math.random() < best.s / 100 ? best : null;
  }

  function enemyAct(e) {
    if (e.skipTurn) { e.skipTurn--; return; }
    if (e.hp <= 0 || e.npc) return;
    e.protectPrev = e.protecting; e.protecting = false;
    if (e.napping && [P(), ...allies()].some(m => cheb(m, e) <= 1) && Math.random() < NAP_WAKE) wakeNap(e, Math.max(T.cursor, T.moveEnd), true);
    if (e.napping) return;
    if (!canAct(e)) return;
    if (e.moveOnly && (e.charging || e.rampage)) return;
    if (e.ally && tacticOf(e) === 'flee') { fleeStep(e); return; }   // 여기서 도망쳐: 싸우지 않는다
    const tg = aiTarget(e);
    if (!tg) {
      if (e.charging || e.rampage) { if (e.rampage) { if (!rampageStep(e)) return; } else useMove(e, e.charging.slot, e.dir, { release: true, free: true }); return; }
      const sup = e.ally && !e.moveOnly && allySupport(e, null);   // 싸움이 없을 때도 다친 같은 편은 회복
      if (sup) { useMove(e, sup.i, e.dir); return; }
      followLeader(e); return;
    }
    const p = tg.p;
    if (e.charging) {
      const ddx = p.x - e.x, ddy = p.y - e.y;
      const aligned = ddx === 0 || ddy === 0 || Math.abs(ddx) === Math.abs(ddy);
      useMove(e, e.charging.slot, aligned && (ddx || ddy) ? dirIndex(ddx, ddy) : e.dir, { release: true, free: true });
      return;
    }
    if (e.rampage && rampageStep(e)) return;
    const nerve = abilityOf(p).unnerve ? 0.5 : 1;
    const sees = tg.sees && p.hp > 0;
    if (sees) e.target = { x: p.x, y: p.y };
    if (e.thief) e.target = { x: P().x, y: P().y };   // 화난 켈리몬: 어디 있든 쫓아온다
    const dx = p.x - e.x, dy = p.y - e.y, dist = Math.max(Math.abs(dx), Math.abs(dy));
    const usable = e.moves.map((m, i) => ({ m: liveMove(e, m.id), i, pp: m.pp, id: m.id })).filter(o => o.pp > 0 && !moveOff(e, o.id) && !selfKOBlocked(e, o.id) && !repeatBlocked(e, o.id, D.turn) && !(e.tauntT && o.m.c === 1));
    // 능력 변화 기술은 이미 충분히 바뀌었으면 쓰지 않는다 (작아지기·칼춤을 끝없이 쌓거나 상대 능력을 계속 깎지 않게)
    const worthUsing = (e, p, m) => {
      const R = MOVE_RULES[m.id] || {};   // 새 변화 기술: 소용없을 때는 쓰지 않는다
      if (R.rest) return e.hp < e.maxhp * 0.5 || !!e.status;
      if (R.allyHeal) return [D.player, ...D.mons].some(c => c && c !== e && c.hp > 0 && c.hp < c.maxhp * 0.7 && !c.npc && !hostileTo(e, c) && cheb(c, e) <= TEAM_RANGE);   // 치유파동: 다친 같은 편이 곁에 있을 때만
      if (R.setWx) return weatherNow() !== R.setWx;
      if (R.setTerrain) return D.terrain !== R.setTerrain || D.terrainT <= TERRAIN_TURNS / 3;
      if (R.screen) return (!R.needWx || weatherNow() === R.needWx) && screenKeys(R).some(k => !e[k]);
      if (R.seed) return !p.seeded && !p.types.includes(12);
      if (R.taunt) return !p.tauntT;
      if (R.transform) return !e.tf;
      if (R.sketch) return false;   // 스케치는 리더가 직접
      if (R.yawn) return !p.status && !p.yawnT;
      if (R.protect) return !e.protectPrev;
      if (m.c === 1 && m.ail) { const k = AILMENT_MAP[m.ail]; return !p.status && !(k === 'slp' && p.noSleep) && !p.types.some(t => (STATUS_IMMUNE_TYPES[k] || []).includes(t)); }   // 상태 이상 기술: 이미 걸렸거나 안 통하는 상대에게는 쓰지 않는다
      if (m.c !== 1 || !m.sc) return true;
      const self = m.r === 's' || m.ss;
      return m.sc.some(([st, ch]) => self ? ch > 0 && (e.stages[st] || 0) < AI_STAGE_LIMIT : ch < 0 && (p.stages[st] || 0) > -AI_STAGE_LIMIT);
    };
    if (e.moveOnly && sees && dist <= 1) return;   // 화난 켈리몬의 두 번째 이동: 붙었으면 멈춘다 (공격은 한 턴에 한 번)
    if (!e.ally && e.item && !e.moveOnly && enemyUseItem(e, p, sees, dist, dx, dy)) return;
    if (e.ally && !e.moveOnly && sees && dist <= 6) { const sup = allySupport(e, p); if (sup) { useMove(e, sup.i, e.dir); return; } }   // 동료: 회복·능력 올리기·벽
    // 적의 날씨·필드 기술 (v0.101): 예전에는 붙어 있을 때 다른 변화 기술과 섞여 가끔만 썼다. 상대가 보이면 떨어져 있어도, 자기에게 득이 될 때 쓴다
    if (!e.ally && !e.moveOnly && sees && dist <= 5) {
      const lock = D.wxLock && D.wxLock.hp > 0 && !D.wxLock.dead;
      const fx = usable.filter(o => {
        const R = MOVE_RULES[o.id] || {};
        if (R.setWx) return !lock && worthUsing(e, p, o.m) && wxValue(R.setWx, [e]) > 0;
        if (R.setTerrain) return worthUsing(e, p, o.m) && (R.setTerrain === 'misty' || e.moves.some(x => DATA.moves[x.id] && DATA.moves[x.id].p > 0 && DATA.moves[x.id].t === TERRAINS[R.setTerrain].type));
        return false;
      });
      if (fx.length && Math.random() < (e.boss ? 0.5 : 0.3) * nerve) { useMove(e, pick(fx).i, e.dir); return; }
    }
    // 상태 이상 기술 (최면술·다크홀·전기자석파·맹독 등): 아직 상태 이상이 아닌 상대가 닿는 곳에 있으면 먼저 건다 (보스에게는 동료가 더 자주)
    if (sees && !e.moveOnly && !p.status) {
      const aligned = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
      const reach = o => o.m.r === 'f' ? dist === 1 && diagOK(e.x, e.y, Math.sign(dx), Math.sign(dy))
        : o.m.r === 'p' ? aligned && dist <= PROJ_RANGE && lineClear(e, dirIndex(dx, dy), dist)
        : o.m.r === 'r' ? dist <= 3 && los(e.x, e.y, p.x, p.y) : false;
      const dis = usable.filter(o => o.m.c === 1 && o.m.ail && worthUsing(e, p, o.m) && reach(o));
      const rate = e.ally ? (p.boss ? 0.5 : 0.3) : smartFoes() || e.boss ? 0.35 : 0.2;
      if (dis.length && Math.random() < rate * nerve) { const o = pick(dis); useMove(e, o.i, o.m.r === 'r' ? e.dir : confuse(e, dirIndex(dx, dy))); return; }
    }
    // 동료는 상대에게 가장 효과적인 공격을 고른다 (면역·흡수되는 기술은 쓰지 않는다). 적은 지금처럼 무작위
    const score = o => moveScore(e, p, o.m) * (MOVE_RULES[o.id]?.pierce && (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) ? pierceN(e, dirIndex(dx, dy)) : 1);   // 관통기: 한 줄의 적 수만큼
    const best = list => list.map(o => ({ o, s: score(o) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s)[0]?.o;
    if ((e.ally || smartFoes()) && sees && dist === 1 && diagOK(e.x, e.y, Math.sign(dx), Math.sign(dy))) {
      const dir = confuse(e, dirIndex(dx, dy));
      const status = usable.filter(o => o.m.c === 1 && worthUsing(e, p, o.m));
      if (status.length && Math.random() < 0.15 * nerve) { useMove(e, pick(status).i, dir); return; }
      const atk = best(usable.filter(o => o.m.c !== 1 && o.m.r !== 's'));
      useMove(e, atk && score(atk) > moveScore(e, p, NORMAL_ATTACK) ? atk.i : -1, dir);
      return;
    }
    if (sees && dist === 1 && diagOK(e.x, e.y, Math.sign(dx), Math.sign(dy))) {
      const dir = confuse(e, dirIndex(dx, dy));
      const opts = usable.filter(o => worthUsing(e, p, o.m));
      if (opts.length && Math.random() < 0.4 * nerve) useMove(e, pick(opts).i, dir);
      else useMove(e, -1, dir);
      return;
    }
    // 동료: 상대 옆까지 갈 길이 다른 동료에게 막혔거나 한참 돌아가야 하면 (좁은 통로에 동료가 줄지어 있을 때) '막힘'
    // 막혔으면 원거리·범위 기술을 아끼지 않고 쓰고, 쓸 게 없으면 멀리 돌아가지 않고 줄을 지킨다
    let stuck = false;
    if (e.ally && sees && dist > 1) {
      const near = bfs(e.x, e.y, (x, y) => cheb({ x, y }, p) <= 1, { blockMons: true, self: e, max: 400 });
      stuck = !near || near.len > dist + ALLY_DETOUR;
    }
    if (sees && !e.moveOnly && dist <= PROJ_RANGE && (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy))) {
      const proj = usable.filter(o => o.m.c !== 1 && (o.m.r === 'p' || (o.m.r === 'f' && (MOVE_RULES[o.id] || {}).reach >= dist)));
      const pc = e.ally || smartFoes() ? best(proj) : pick(proj);
      const rate = e.ally ? (stuck ? 1 : 0.6) : smartFoes() ? 0.8 : 0.45;
      if (pc && Math.random() < rate * nerve && (lineClear(e, dirIndex(dx, dy), dist) || MOVE_RULES[pc.id]?.pierce)) { useMove(e, pc.i, dirIndex(dx, dy)); return; }
    }
    if (sees && !e.moveOnly && dist <= 3) {
      const area = usable.filter(o => o.m.r === 'r' && o.m.c !== 1);
      const ac = e.ally || smartFoes() ? best(area) : pick(area);
      if (ac && Math.random() < (stuck ? 1 : 0.25) * nerve && los(e.x, e.y, p.x, p.y)) { useMove(e, ac.i, dirIndex(dx, dy) || 0); return; }
    }
    if (e.ally && tacticOf(e) === 'wait') return;   // 기다리는 동료는 쫓아가지 않는다
    if (stuck) { followLeader(e); return; }   // 막힌 동료: 다른 길로 크게 돌지 않고 줄을 지킨다
    let goal = e.target;
    if (goal && goal.x === e.x && goal.y === e.y) { e.target = null; goal = null; }
    if (!goal) {
      if (!e.wander || (e.wander.x === e.x && e.wander.y === e.y) || Math.random() < 0.02) {
        const R = pick(D.rooms); e.wander = { x: rint(R.x, R.x + R.w - 1), y: rint(R.y, R.y + R.h - 1) };
      }
      goal = e.wander;
    }
    const goalAt = (x, y) => x === goal.x && y === goal.y;
    const path = (e.ally && bfs(e.x, e.y, goalAt, { blockMons: true, self: e, max: 900, avoidTraps: true })) || bfs(e.x, e.y, goalAt, { blockMons: true, self: e, max: 900 });   // 동료는 발견한 함정을 돌아간다
    let sx, sy;
    if (path) { sx = path.fx - e.x; sy = path.fy - e.y; }
    else { sx = Math.sign(goal.x - e.x); sy = Math.sign(goal.y - e.y); }
    const d0 = confuse(e, dirIndex(sx, sy));
    if (d0 < 0) return;
    let [mx, my] = DIRS[d0];
    if (!canStep(e, mx, my)) {
      // 막혔으면 비슷한 방향 시도
      const alts = [d0 + 1, d0 - 1].map(d => (d + 8) % 8).filter(d => canStep(e, DIRS[d][0], DIRS[d][1]));
      if (!alts.length) { if (!path) e.wander = null; return; }
      [mx, my] = DIRS[pick(alts)];
    }
    const fx = e.x, fy = e.y;
    e.x += mx; e.y += my; e.dir = dirIndex(mx, my);
    schedMove(e, fx, fy);
    if (e.ally) markMoved(e, fx, fy); else enemyPickup(e);
  }
  // 적이 밟은 아이템을 줍는다 (하나까지)
  function enemyPickup(e) {
    if (e.item || e.boss) return;
    const it = itemAt(e.x, e.y);
    if (!it || it.money || it.id === 'quest' || it.price || !ITEMS[it.id]) return;
    if (it.n > 1) it.n--; else D.items = D.items.filter(i => i !== it);
    e.item = it.id;
    if (seen(e)) log(`${jo(nm(e), '은')} ${jo(ITEMS[it.id].n, '을')} 주웠다!`, T.moveEnd || T.base);
  }
  // 적이 가진 아이템을 쓸지: 쓰면 true (그 턴의 행동)
  function enemyUseItem(e, p, sees, dist, dx, dy) {
    const id = e.item, it = id && ITEMS[id]; if (!it) return false;
    const at = Math.max(T.cursor, T.moveEnd, T.base);
    const eat = () => { e.item = null; if (seen(e)) log(`${jo(nm(e), '은')} ${jo(it.n, '을')} ${isEdible(it) ? '먹었다' : '사용했다'}!`, at); };
    if ((it.use === 'heal' || it.use === 'healPct' || it.use === 'fullheal') && e.hp < e.maxhp * 0.4) {
      eat(); heal(e, it.use === 'heal' ? it.v : it.use === 'healPct' ? Math.floor(e.maxhp * it.v / 100) : e.maxhp, at); return true;
    }
    if (e.status && ((it.use === 'cureOne' && it.st === e.status) || it.use === 'cure' || it.use === 'fullheal')) {
      eat(); e.status = null; if (seen(e)) log(`${nm(e)}의 상태가 나았다!`, at); return true;
    }
    if (it.use === 'stat' && sees && dist <= 3 && !(e.stages[it.st] > 0)) { eat(); statChange(e, it.st, it.v, at, e, STAGE_ITEM_TURNS); return true; }
    if (it.throw && sees && dist > 1 && dist <= 8 && (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) && lineClear(e, dirIndex(dx, dy), dist) && Math.random() < 0.5) {
      e.item = null; throwItem(e, id, dirIndex(dx, dy)); return true;
    }
    return false;
  }
  // 직선 기술·던지기가 닿는지 (벽 모서리는 지나간다)
  // 관통 기술이 이 방향으로 맞힐 적 수 (AI 점수용, 최소 1)
  function pierceN(c, dir) {
    let x = c.x, y = c.y, n = 0;
    for (let i = 0; i < PROJ_RANGE; i++) { x += DIRS[dir][0]; y += DIRS[dir][1]; if (!openAt(x, y)) break; const t = creatureAt(x, y); if (t && hostileTo(c, t)) n++; }
    return Math.max(1, n);
  }
  function lineClear(c, dir, dist) {
    let x = c.x, y = c.y;
    for (let i = 1; i < dist; i++) {
      x += DIRS[dir][0]; y += DIRS[dir][1];
      const b = creatureAt(x, y);
      if (!openAt(x, y) || (b && !(party(c) && party(b)))) return false;
    }
    return true;
  }

  // ───────────────────────── 플레이어 행동 ─────────────────────────
  function act(action) {
    if (!D || D.dead || busy() || UI.isOpen()) return false;
    const p = P();
    beginTurn();
    const hpBefore = p.hp;
    let used = false;
    if (action.t === 'face') { p.dir = action.dir; return false; }
    // 방어는 자신의 다음 행동 전까지 (연속으로 썼는지 보려고 직전 상태를 남긴다)
    p.protectPrev = p.protecting; p.protecting = false;
    const snore = action.t === 'skill' && p.status === 'slp' && p.moves[action.slot] && MOVE_RULES[p.moves[action.slot].id]?.needSleepSelf;
    if (action.t !== 'skill') p.chain = null;
    if (!snore && !canAct(p)) used = true;
    else if (p.charging) {
      const mv = DATA.moves[p.moves[p.charging.slot].id];
      autoFace(p, mv);
      useMove(p, p.charging.slot, confuse(p, p.dir), { release: true, free: true }); used = true;
    } else if (p.rampage && rampageStep(p)) { used = true; }
    else switch (action.t) {
      case 'move': used = doMove(confuse(p, action.dir)); break;
      case 'attack': useMove(p, -1, confuse(p, p.dir)); used = true; break;
      case 'skill': {
        const m = p.moves[action.slot];
        if (!m) return false;
        if (m.pp <= 0) { log('PP가 남아있지 않다!', now()); return false; }
        if (p.tauntT && DATA.moves[m.id].c === 1) { log(`${jo(nm(p), '은')} 도발당해서 ${jo(DATA.moves[m.id].n, '을')} 쓸 수 없다! (${p.tauntT}턴 남음)`, now()); return false; }
        if (repeatBlocked(p, m.id, D.turn)) { log(`${jo(DATA.moves[m.id].n, '은')} 연속으로 쓸 수 없다! (한 턴 다른 행동을 한 뒤에)`, now()); return false; }
        if (selfKOBlocked(p, m.id)) { log(`HP가 부족해서 ${jo(DATA.moves[m.id].n, '을')} 쓸 수 없다! (HP 절반 이상 필요)`, now()); return false; }
        const mv = DATA.moves[m.id];
        if (action.autoFace !== false) autoFace(p, mv, m.id);
        useMove(p, action.slot, confuse(p, p.dir)); used = true; break;
      }
      case 'wait': used = true; break;
      case 'item': used = useItem(action.slot, action.mode, action.move, action.ally); break;
      case 'foot': used = footAction(action.mode, action.slot, action.ally); break;
    }
    if (!used) return false;
    afterPlayer();
    return { hpLost: p.hp < hpBefore };
  }

  // 기술을 쓸 때 돌아보기: 바로 앞에 적이 없으면 근접 기술은 옆에 붙은 적 쪽으로, 원거리 기술·도구 던지기는 직선 위 가장 가까운 적 쪽으로
  // (v0.52에서 바라보는 방향으로 바꿨다가 v0.53에서 되돌림)
  function autoFace(p, mv, mid) {
    const [dx, dy] = DIRS[p.dir];
    const front = creatureAt(p.x + dx, p.y + dy);
    if (front && hostileTo(p, front)) return;
    const vis = hostilesVisible();
    if (mv.r === 'f') {
      const adj = vis.find(e => Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y)) === 1 && (diagOK(p.x, p.y, Math.sign(e.x - p.x), Math.sign(e.y - p.y)) || MOVE_RULES[mid]?.reach >= 2));
      if (adj) p.dir = dirIndex(adj.x - p.x, adj.y - p.y);
      else if (MOVE_RULES[mid]?.reach >= 2) {   // 선공기: 직선 2칸의 적 (사이 칸이 비어 있을 때)
        const far = vis.find(e => { const dx = e.x - p.x, dy = e.y - p.y; return Math.max(Math.abs(dx), Math.abs(dy)) === 2 && (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) && lineClear(p, dirIndex(dx, dy), 2); });
        if (far) p.dir = dirIndex(far.x - p.x, far.y - p.y);
      }
    } else if (mv.r === 'p') {
      const al = vis.filter(e => { const dx = e.x - p.x, dy = e.y - p.y; return (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) && Math.max(Math.abs(dx), Math.abs(dy)) <= PROJ_RANGE && lineClear(p, dirIndex(dx, dy), Math.max(Math.abs(dx), Math.abs(dy))); })
        .sort((a, b) => Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) - Math.max(Math.abs(b.x - p.x), Math.abs(b.y - p.y)));
      if (al[0]) p.dir = dirIndex(al[0].x - p.x, al[0].y - p.y);
    }
  }

  function doMove(dir) {
    const p = P(); const [dx, dy] = DIRS[dir];
    p.dir = dir;
    const t = creatureAt(p.x + dx, p.y + dy);
    if (t && t.npc && !t.letPass) { if (diagOK(p.x, p.y, dx, dy)) { talkNpc(t); } return false; }
    if (p.boundT > 0 && !(t && hostileTo(p, t))) { log(`${jo(nm(p), '은')} 갇혀 있어서 움직일 수 없다! (${p.boundT}턴 남음)`, now()); return false; }
    if (t && hostileTo(p, t)) {
      if (!diagOK(p.x, p.y, dx, dy)) return false;
      if (Game.save.settings.noBumpAttack) {   // 설정: 이동키로 공격하지 않기 (v0.100) — 방향만 돌리고 턴은 쓰지 않는다
        if (p.bumpWarn !== D.turn) { p.bumpWarn = D.turn; log(`앞에 ${jo(nm(t), '이')} 있다! (공격은 공격 키로)`, now()); }
        return false;
      }
      useMove(p, -1, dir); return true;
    }
    if (t && (t.ally || t.letPass) && diagOK(p.x, p.y, dx, dy) && passable(p, p.x + dx, p.y + dy) && passable(t, p.x, p.y)) {   // 동료(또는 비켜 주는 켈리몬)와 자리를 바꾼다
      const fx = p.x, fy = p.y;
      t.x = fx; t.y = fy; schedMove(t, p.x + dx, p.y + dy); t.swapped = D.turn;
      p.x += dx; p.y += dy; schedMove(p, fx, fy); markMoved(p, fx, fy);
      onStep(); return true;
    }
    // 물·용암 위의 리더가 땅의 동료 쪽으로 나올 때: 동료는 리더 자리(물)에 설 수 없으니 옆 빈칸으로 비켜 준다 (v0.102)
    //  (예전에는 자리를 바꾸지 못해 물 타입·부유 리더가 웅덩이에서 나오지 못했다)
    if (t && t.ally && diagOK(p.x, p.y, dx, dy) && passable(p, p.x + dx, p.y + dy) && !passable(t, p.x, p.y)) {
      const spot = allyStepAside(t, p);
      if (spot) {
        const ox = t.x, oy = t.y;
        t.x = spot.x; t.y = spot.y; schedMove(t, ox, oy); t.swapped = D.turn;
        const fx = p.x, fy = p.y;
        p.x += dx; p.y += dy; schedMove(p, fx, fy); markMoved(p, fx, fy);
        onStep(); return true;
      }
    }
    if (!canStep(p, dx, dy)) return false;
    const fx = p.x, fy = p.y;
    p.x += dx; p.y += dy;
    schedMove(p, fx, fy); markMoved(p, fx, fy);
    onStep();
    return true;
  }

  function talkNpc(npc) {
    if (npc.shopkeeper) { shopMenu(); return; }
    if (!npc.mission) return;
    D.mons = D.mons.filter(m => m !== npc);
    npc.dead = true; npc.deadAt = now() + 600; D.corpses.push(npc);
    if (npc.friend) {   // 친구 구조: 그 자리에서 바로 완료 (보상 확정, 게시판 구조는 서버에 바로 알림)
      log(`쓰러져 있던 친구의 ${jo(spName(npc.sp), '을')} 구조했다!`, now());
      if (!run.done.includes(npc.mission)) run.done.push(npc.mission);
      setFace('Happy', 3000);
      const res = Game.rescueNow(npc.mission);
      D.prompts.push(() => { stopAuto(); Game.rescueDialog(res); });
      return;
    }
    log(`${jo(spName(npc.sp), '을')} 구조했다! 의뢰인이 탈출 배지로 마을에 돌아갔다.`, now());
    missionDone(npc.mission, `${spName(npc.sp)} 구조 완료!`);
  }

  // ───────────────────────── 함정 / 몬스터 하우스 / 상점 ─────────────────────────
  const trapAt = (x, y) => D.traps.find(t => t.x === x && t.y === y);

  // who: 밟은 포켓몬 (리더 또는 동료, v1.05 보강: 예전에는 동료가 밟아도 아무 일이 없었다)
  function triggerTrap(tr, depth, who) {
    const lead = P(), p = who || lead, at = T.base + 130 * spd(), info = TRAPS[tr.kind];
    tr.seen = true;
    stopAuto();
    log(p === lead ? `${jo(info.n, '을')} 밟았다!` : `${jo(nm(p), '이')} ${jo(info.n, '을')} 밟았다!`, at);
    Sound.play('trap', at);
    D.fx.push({ kind: 'ring', x: tr.x, y: tr.y, at, dur: 350 * spd(), color: '#ff9a3c' });
    const pa = abilityOf(p);
    if (pa.trapImmune && pa.trapImmune.includes(tr.kind)) { abLog(p, '하지만 아무 일도 일어나지 않았다!', at); return; }
    if (heldOf(p).trapImmune) { log(`${jo(ITEMS[p.held].n, '이')} 함정을 막아 주었다!`, at); return; }
    switch (tr.kind) {
      case 'psn': case 'slp': case 'par': inflict(p, tr.kind, at, true); if (D.rule === 'trap' && p.status === tr.kind) p.statusT += tr.kind === 'slp' ? 2 : 10; break;   // 함정 지대: 더 오래
      case 'warp': {
        const t = randomRoomTile({ far: 6 });
        if (t) { const fx = p.x, fy = p.y; p.x = t.x; p.y = t.y; p.tween = null; log(p === lead ? '어딘가로 날아갔다!' : `${jo(nm(p), '은')} 어딘가로 날아갔다!`, at); if (p === lead) { computeVis(); onStep(depth + 1); } else markMoved(p, fx, fy); }
        break;
      }
      case 'blast': {
        const hit = [lead, ...D.mons].filter(m => m && !m.npc && m.hp > 0 && Math.max(Math.abs(m.x - tr.x), Math.abs(m.y - tr.y)) <= 1);
        for (const c of hit) { const amt = pctDmg(c, D.rule === 'trap' ? 0.3 : 0.2); log(`${jo(nm(c), '은')} ${amt}의 데미지를 입었다.`, at); damage(c, amt, null, at); }
        break;
      }
      case 'hunger': lead.belly = Math.max(0, lead.belly - (D.rule === 'trap' ? 30 : 20)); log('배가 급격히 고파졌다!', at); break;   // 배고픔은 탐험대가 함께 (리더의 배)
      case 'reset': {
        const any = Object.values(p.stages).some(v => v);
        for (const k of Object.keys(p.stages)) p.stages[k] = 0;
        log(any ? `${p === lead ? '' : nm(p) + '의 '}능력 변화가 모두 원래대로 돌아갔다!` : '하지만 아무 일도 일어나지 않았다.', at);
        break;
      }
      case 'summon': {
        let n = rint(2, 3);
        for (const [dx, dy] of DIRS) {
          if (!n) break;
          const x = p.x + dx, y = p.y + dy;
          if (floorAt(x, y) && !creatureAt(x, y)) { const e = spawnEnemy({ x, y }); e.target = { x: p.x, y: p.y }; n--; }
        }
        D.traps = D.traps.filter(t => t !== tr);
        log('적들이 나타났다!', at);
        break;
      }
    }
  }

  function triggerHouse(house) {
    const p = P(), room = house.room;
    house.triggered = true;
    Progress.add('houses'); checkLater(); Sound.play('trap');
    stopAuto();
    let n = rint(6, 9);
    for (let tries = 0; n > 0 && tries < 60; tries++) {
      const t = randomRoomTile({ room });
      if (!t || Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y)) < 2) continue;
      const e = spawnEnemy(t); e.target = { x: p.x, y: p.y }; e.skipTurn = 1; e.house = true; n--;   // 떨어진 턴에는 행동하지 않는다
    }
    computeVis();
    log('몬스터 하우스다!!', T.base);
    floorMusic();
    popup(p, 'MONSTER HOUSE!', '#ff5a5a', T.base + 100);
    D.fx.push({ kind: 'ring', x: p.x, y: p.y, at: T.base, dur: 600, color: '#ff5a5a' });
  }

  function makeShop(freeRooms) {
    const cand = freeRooms.filter(i => D.rooms[i].w >= 4 && D.rooms[i].h >= 4);
    if (!cand.length) return;
    const ri = cand[rand(cand.length)];
    freeRooms.splice(freeRooms.indexOf(ri), 1);
    const R = D.rooms[ri];
    const aw = Math.min(3, R.w - 1), ah = Math.min(2, R.h - 1);
    const ax = R.x + rint(0, R.w - aw), ay = R.y + rint(0, R.h - ah);
    const tiles = new Set();
    for (let y = ay; y < ay + ah; y++) for (let x = ax; x < ax + aw; x++) tiles.add(idx(x, y));
    // 상인은 진열대 바로 옆. 방 입구(통로와 맞닿은 칸) 앞은 피한다 (길을 막아 갇히지 않게)
    const inRoom = (x, y) => x >= R.x && x < R.x + R.w && y >= R.y && y < R.y + R.h;
    const atDoor = (x, y) => DIRS.some(([dx, dy]) => !inRoom(x + dx, y + dy) && inb(x + dx, y + dy) && floorAt(x + dx, y + dy));
    let keeperPos = null;
    for (let y = ay - 1; y <= ay + ah && !keeperPos; y++) for (let x = ax - 1; x <= ax + aw; x++) {
      if (inRoom(x, y) && !tiles.has(idx(x, y)) && !atDoor(x, y)) { keeperPos = { x, y }; break; }
    }
    if (!keeperPos) return;
    D.shop = { tiles, room: ri };
    const stock = SHOP_POOL.filter(id => id !== 'stone' && id !== 'link').concat(['candy', 'reviver', 'sitrus'], HELD_SHOP_POOL.filter(() => Math.random() < 0.15), TM_IDS.filter(() => Math.random() < 0.02));
    for (const i of tiles) {
      const id = pick(stock);
      D.items.push({ x: i % D.w, y: (i / D.w) | 0, id, n: ITEMS[id].stack ? 5 : 1, price: shopPrice(id) });
    }
    const k = makeCreature(KECLEON, keeperLv());
    k.npc = true; k.shopkeeper = true; k.x = keeperPos.x; k.y = keeperPos.y;
    Sprites.load(KECLEON);
    D.mons.push(k);
  }

  const keeperLv = () => Math.min(KEEPER_LV, MAX_LEVEL);
  // ── 도둑질: 상점 켈리몬이 화를 낸다 ──
  function makeAngry(k) {
    Object.assign(k, { npc: false, shopkeeper: false, letPass: false, enemy: true, thief: true, baseAll: THIEF_BASE, napping: false });
    Object.assign(k, statsFromBase(THIEF_BASE, k.lv, k.iv)); k.hp = k.maxhp;
    k.target = { x: P().x, y: P().y };
  }
  function spawnAngryKecleon(pos) {
    const c = makeCreature(KECLEON, keeperLv());
    c.x = pos.x; c.y = pos.y; c.dir = rand(8);
    makeAngry(c);
    D.mons.push(c);
    return c;
  }
  function becomeThief(how) {
    if (D.thief) return;
    D.thief = true;
    stopAuto();
    const k = D.mons.find(m => m.shopkeeper);
    if (k) makeAngry(k);
    // 남은 진열품은 이제 공짜로 주울 수 있다
    for (const it of D.items) if (it.price) delete it.price;
    setFace('Surprised', 2500);
    log(how === 'attack' ? '켈리몬에게 덤벼들었다!' : '물건을 훔쳤다!', now());
    log('켈리몬: "도둑이야!! 놓치지 않겠다!"', now() + 300);
    log('다음 층으로 갈 때까지 켈리몬들이 쫓아온다!', now() + 600);
    floorMusic();
    return k;
  }
  // 상점 켈리몬을 공격한다: 그 턴에 켈리몬은 움직이지 못한다
  function attackKeeper() {
    const k = becomeThief('attack');
    if (k) k.skipTurn = (k.skipTurn || 0) + 1;
    act({ t: 'attack' });
  }

  function shopBuyPrompt(it) {
    const p = P();
    if (itemAt(p.x, p.y) !== it) return;
    const info = ITEMS[it.id];
    const full = run.bag.length >= bagMax() && !(info.stack && run.bag.some(b => b.id === it.id));
    UI.open({
      title: '켈리몬 상점',
      html: `<p>${portraitImg(KECLEON, 'portrait sm')} 어서 오세요!</p>
        <p>${info.icon} <b>${esc(info.n)}</b>${it.n > 1 ? ' ×' + it.n : ''} — <b>₽${it.price}</b>입니다.</p><p class="dim">${esc(info.d)}</p>
        <p class="dim">가진 돈 ₽${Game.save.money}</p>`,
      choices: [
        { label: `산다 (₽${it.price})`, disabled: Game.save.money < it.price || full, sub: full ? '가방이 가득 찼다' : Game.save.money < it.price ? '돈이 부족하다' : '', fn: () => {
          Game.save.money -= it.price;
          run.money = Math.max(0, run.money - it.price);   // 이번 탐험에서 주운 돈부터 쓴다 (쓰러졌을 때 원래 가진 돈을 잃지 않게)
          D.items = D.items.filter(i => i !== it);
          addToBag(it.id, it.n);
          log(`${jo(info.n, '을')} ₽${it.price}에 샀다. "감사합니다!"`, now());
        } },
        { label: '훔친다', sub: '켈리몬이 화를 낸다!', disabled: full, fn: () => {
          D.items = D.items.filter(i => i !== it);
          addToBag(it.id, it.n);
          becomeThief('steal');
          log(`${jo(info.n, '을')} 손에 넣었다.`, now());
        } },
        { label: '그만둔다', fn: () => {} },
      ],
      cancel: () => {},
    });
  }

  function shopMenu() {
    stopAuto();
    UI.open({
      title: '켈리몬 상점',
      html: `<p>${portraitImg(KECLEON, 'portrait sm')} 어서 오세요! 켈리몬 상점입니다.</p><p class="dim">진열된 물건 위에 올라서면 살 수 있어요. 물건도 사들이고 있답니다.</p>`,
      choices: [{ label: '물건을 판다', fn: sellMenu }, { label: '자리를 바꿔 지나간다', fn: swapKeeper },
        { label: '공격한다', sub: '켈리몬이 화를 낸다! (이번 턴에는 반격하지 못함)', fn: () => setTimeout(async () => {
          const ok = await UI.confirm('켈리몬 공격', `<p>${portraitImg(KECLEON, 'portrait sm')} 정말 켈리몬을 공격할까요?</p>
            <p class="warn">화가 난 켈리몬은 Lv${keeperLv()}에 종족값이 모두 ${THIEF_BASE}라 매우 강하고, 한 턴에 두 칸씩 쫓아와요. 다음 층으로 갈 때까지 새로 나오는 적도 모두 화난 켈리몬이 돼요.</p>
            <p class="dim">남은 진열품은 공짜로 주울 수 있어요. 쓰러뜨려 영입하면 보통 켈리몬이 동료가 돼요.</p>`, '공격한다', '그만둔다');
          if (ok) attackKeeper();
        }, 0) },
        { label: '그만둔다', fn: () => {} }],
    });
  }
  // 켈리몬과 자리를 바꾼다 (좁은 곳에서 길을 막고 있을 때)
  function swapKeeper() {
    const k = D.mons.find(m => m.shopkeeper); if (!k) return;
    k.letPass = true; act({ t: 'move', dir: P().dir }); k.letPass = false;   // 방금 말을 건 방향으로 한 칸 (켈리몬과 자리를 바꾼다)
  }
  // 물건 팔기: 여러 개를 골라 한 번에 판다 (자동 판매 목록·전부 고르기, 합계 표시). 판 물건은 마을 상점에서 되살 수 있다
  const SELL_CONFIRM_PRICE = 1000;   // 이보다 비싼 물건이나 지닌 물건이 섞여 있으면 한 번 더 묻는다
  function sellMenu() {
    if (!run.bag.length) { UI.alert('켈리몬 상점', '<p>팔 물건이 없다.</p>'); return; }
    const auto = new Set(Game.save.autoSell || []);
    let box = null;
    const picked = () => box ? [...box.querySelectorAll('input[data-sell]:checked')].map(x => +x.dataset.sell) : [];
    const refresh = () => {
      const idx = picked(), sum = idx.reduce((s, i) => s + sellValue(run.bag[i]), 0);
      box.querySelector('.sell-sum').textContent = idx.length ? `${idx.length}개 고름 · 합계 ₽${sum}` : '고른 물건이 없어요';
    };
    UI.open({
      title: `물건 팔기 (가진 돈 ₽${Game.save.money})`, wide: true,
      html: `<div class="btns"><button class="btn sm ghost" data-pick="auto" ${run.bag.some(b => auto.has(b.id)) ? '' : 'disabled'}>자동 판매 목록 고르기</button>
          <button class="btn sm ghost" data-pick="all">전부 고르기</button> <button class="btn sm ghost" data-pick="none">모두 해제</button></div>
        <div class="sell-list">${run.bag.map((b, i) => `<label class="row chk"><input type="checkbox" data-sell="${i}">${Gfx.iconHtml(b.id)} <b>${esc(ITEMS[b.id].n)}</b>${b.n > 1 ? ' ×' + b.n : ''}
          <span class="grow"></span>${auto.has(b.id) ? '<span class="tag">자동 판매</span> ' : ''}<span>₽${sellValue(b)}</span></label>`).join('')}</div>
        <p class="center"><b class="sell-sum"></b></p>`,
      onOpen: b => {
        box = b;
        b.querySelectorAll('[data-pick]').forEach(btn => btn.onclick = () => {
          const k = btn.dataset.pick;
          b.querySelectorAll('input[data-sell]').forEach(x => { x.checked = k === 'all' || (k === 'auto' && auto.has(run.bag[+x.dataset.sell].id)); });
          refresh();
        });
        b.addEventListener('change', refresh);
        refresh();
      },
      choices: [
        { label: '고른 물건을 판다', fn: () => { const idx = picked(); setTimeout(() => sellPicked(idx), 0); } },
        { label: '그만둔다', fn: () => setTimeout(shopMenu, 0) },
      ],
      cancel: () => setTimeout(shopMenu, 0),
    });
  }
  async function sellPicked(idx) {
    if (!idx.length) { sellMenu(); return; }
    const items = idx.map(i => run.bag[i]), sum = items.reduce((s, b) => s + sellValue(b), 0);
    const risky = items.filter(b => sellValue(b) >= SELL_CONFIRM_PRICE || ITEMS[b.id].held);
    if (risky.length && !(await UI.confirm('물건 팔기', `<p>아래 물건도 함께 팝니다. 괜찮을까요?</p>
        <p>${risky.map(b => `${Gfx.iconHtml(b.id)} ${esc(ITEMS[b.id].n)}${b.n > 1 ? ' ×' + b.n : ''} (₽${sellValue(b)})`).join('<br>')}</p>
        <p class="dim">판 물건은 마을 상점의 '최근에 판 물건'에서 판 값 그대로 되살 수 있어요.</p>`, `${items.length}개를 ₽${sum}에 판다`, '다시 고른다'))) { sellMenu(); return; }
    for (const i of idx.slice().sort((a, b) => b - a)) {
      const b = run.bag[i], v = sellValue(b);
      run.bag.splice(i, 1); Game.save.money += v;
      Game.logSale(b.id, b.n, v, 'bag');
    }
    Sound.play('money');
    log(`${items.length}개를 ₽${sum}에 팔았다.`, now());
    if (run.bag.length) sellMenu(); else shopMenu();
  }

  // 영입: 쓰러진 적이 동료가 되고 싶어 한다
  function recruitPrompt(c) {
    if (Game.save.roster[c.sp]) return;   // 같은 턴에 같은 포켓몬을 둘 쓰러뜨려 영입 창이 두 번 쌓인 경우: 앞에서 이미 영입했다
    stopAuto();
    setFace('Surprised', 2500);
    Sound.play('shiny');
    UI.open({
      title: '동료가 되고 싶어 한다!',
      html: `<div class="center">${portraitImg(c.sp, 'portrait big', 'Happy', c.shiny)}</div>
        <p class="center">${c.shiny ? '✨ ' : ''}${esc(jo(spName(c.sp), '이'))} 일어나서 동료가 되고 싶은 듯 이쪽을 보고 있다!</p>
        <p class="center dim">영입하면 Lv${RECRUIT_LEVEL}${c.shiny ? ' (이로치)' : ''}로 합류해서, 마을의 캐릭터 탭에서 바꿔 플레이할 수 있다.</p>`,
      choices: [{ label: '영입한다', fn: () => { Game.recruit(c); log(`${jo(spName(c.sp), '이')} 동료가 되었다! (마을에서 캐릭터를 바꿀 수 있다)`, now()); setFace('Joyous', 2500); Sound.play('levelup'); } },
        { label: '거절한다', fn: () => log(`${jo(spName(c.sp), '은')} 아쉬운 듯 떠나갔다...`, now()) }],
      cancel: false,
    });
  }

  function missionDone(mid, msg) {
    if (run.done.includes(mid)) return;
    run.done.push(mid);
    setFace('Happy', 3000);
    D.prompts.push(() => {
      stopAuto();
      Sound.fanfare('reward', 'mission');   // 임무 완료 팡파르 (music/reward)
      // 연타하다 실수로 나가지 않게: '계속한다'를 위에, 처음부터 골라 둔다. 이 던전에 남은 임무도 보여 준다
      const left = Game.save.missions.accepted.filter(m => m.dungeon === run.dungeon && !run.done.includes(m.id)).sort((a, b) => a.floor - b.floor);
      const KIND = { rescue: '구조', outlaw: '수배', find: '탐색', sos: '친구 구조' };
      UI.open({
        title: '임무 완료', html: `<p>${esc(msg)}</p>${left.length ? `<p>이 던전에 남은 임무: ${left.map(m => `<b>${m.floor}F</b> ${KIND[m.kind] || ''}`).join(' · ')}</p>` : '<p class="dim">이 던전에 남은 임무는 없습니다.</p>'}
          <p class="dim">보상은 계단으로 나가거나 탈출해도 받을 수 있어요.</p>`,
        choices: [{ label: '탐험을 계속한다', fn: () => {}, def: true }, { label: '마을로 돌아가 보상 받기', fn: () => Game.endRun('escape') }],
        cancel: () => {},
      });
    });
  }

  function onStep(depth = 0) {
    const p = P();
    const it = itemAt(p.x, p.y);
    if (it && it.price) {
      if (!D.auto) D.prompts.push(() => shopBuyPrompt(it));
    } else if (it) {
      if (it.money) {
        if (heldOf(p).moneyMul) it.money = Math.floor(it.money * heldOf(p).moneyMul);
        Game.save.money += it.money; run.money += it.money;
        Sound.play('money', T.base + 60);
        D.items = D.items.filter(i => i !== it);
        log(`${it.money} 포켓을 주웠다.`, T.base + 60);
      } else if (it.id === 'quest') {
        D.items = D.items.filter(i => i !== it);
        log(`의뢰품을 찾았다!`, T.base + 60);
        missionDone(it.mission, '의뢰품을 찾았다!');
      } else if (addToBag(it.id, it.n)) {
        Sound.play('pickup', T.base + 60);
        D.items = D.items.filter(i => i !== it);
        log(`${jo(ITEMS[it.id].n, '을')} 주웠다.` + (it.n > 1 ? ` (${it.n}개)` : ''), T.base + 60);
      } else if (!(D.fullSkip = D.fullSkip || new Set()).has(idx(p.x, p.y))) {
        D.fullSkip.add(idx(p.x, p.y));   // 가방이 가득 차서 못 주운 곳: 가방에 자리가 나면 자동 탐색이 다시 주우러 간다
        log(`가방이 가득 차서 ${jo(ITEMS[it.id].n, '을')} 주울 수 없다.`, T.base + 60);
      }
    }
    const tr = trapAt(p.x, p.y);
    if (tr && depth < 2 && !abilityOf(p).levitate) {
      // 모르는 함정은 80%, 알고 있는 함정은 40% 확률로 작동한다 (능력 리셋 함정은 늘)
      if (TRAP_ALWAYS.includes(tr.kind) || Math.random() < (D.rule === 'trap' ? (tr.seen ? 0.8 : 1) : tr.seen ? TRAP_RATE.seen : TRAP_RATE.hidden)) triggerTrap(tr, depth);
      else { const was = tr.seen; tr.seen = true; log(was ? `${jo(TRAPS[tr.kind].n, '을')} 밟았지만 작동하지 않았다.` : `${jo(TRAPS[tr.kind].n, '을')} 밟았지만 다행히 작동하지 않았다!`, T.base + 60); }
    }
    const house = D.houses.find(h => !h.triggered && D.room[idx(p.x, p.y)] === h.room);
    if (house) triggerHouse(house);
    if (!D.stairsHidden && D.stairs.x === p.x && D.stairs.y === p.y) {
      // 자동 탐색이 다른 곳(아이템·안 가 본 곳)으로 가다 계단을 지나가는 중이면 그냥 지나간다
      if (D.auto && D.auto.kind === 'explore' && !D.auto.toStairs) {}
      // 계단으로 가던 중(자동 탐색을 마치고 계단으로, 또는 계단 버튼 G): 설정이 켜져 있으면 바로 내려간다
      else if (D.auto && D.auto.toStairs && Game.save.settings.autoDescend) D.prompts.push(() => descend());
      else D.prompts.push(stairsPrompt);
    }
  }

  function stairsPrompt() {
    if (D.dead || P().hp <= 0) return;
    stopAuto();
    const edg = dungeonById(run.dungeon);
    if (edg.endless && run.bossDone === run.floor) {
      UI.open({ title: '♾ 끝없는 던전', html: `<p><b>${run.floor}층</b>까지 왔다! 더 내려갈까요, 마을로 돌아갈까요?</p><p class="dim">돌아가면 주운 아이템·돈을 모두 가져가요. 계속 가다 쓰러지면 이번에 주운 것은 잃어요 (받은 티켓과 들고 온 가방은 남아요). 구미로 올린 능력은 돌아가면 사라져요.</p>`,
        choices: [{ label: `${goWord()}간다 (${run.floor + 1}층)`, fn: () => descend(true) }, { label: '마을로 돌아간다', fn: () => Game.endRun('escape') }, { label: '그만둔다', fn: () => {} }], cancel: () => {} });
      return;
    }
    const last = run.floor >= edg.floors && !edg.endless, left = missionsLeftHere();
    const warn = left.length ? `<p class="warn">⚠ 이 층에 아직 끝내지 않은 임무가 있어요! 이대로 ${last ? '나가면' : goWord() + '가면'} 이번 탐험에서는 다시 할 수 없어요.</p>${left.map(m => `<div class="row"><div class="grow">${Game.missionText(m)}</div></div>`).join('')}` : '';
    UI.open({
      title: left.length ? '⚠ 임무가 남아 있어요' : '계단', html: warn + (last ? '<p>출구가 보인다! 던전을 빠져나가시겠습니까?</p>' : `<p>다음 층으로 가는 계단이 있다. ${goWord()}가시겠습니까?</p>`),
      choices: [{ label: left.length ? (last ? '그래도 나간다' : `그래도 ${goWord()}간다`) : (last ? '나간다' : `${goWord()}간다`), fn: () => descend(true) }, { label: '그만둔다', fn: () => {} }], cancel: () => {},
    });
  }
  // 이 층에서 아직 끝내지 않은 임무 (구조·수배범·의뢰품): 그대로 계단을 쓰려 하면 한 번 더 묻는다
  function missionsLeftHere() {
    const dg = dungeonById(run.dungeon);
    if (dg.mode !== 'normal' || run.hard) return [];
    return Game.save.missions.accepted.filter(ms => ms.dungeon === dg.id && ms.floor === run.floor && !run.done.includes(ms.id));
  }
  // 올라가는 계단을 쓰는 던전 (탑·산·하늘): 원작처럼
  const STAIRS_UP = new Set(['purity', 'sky', 'summit', 'burned', 'spiral', 'twofist', 'mega', 'coronet', 'frost', 'volcano', 'skyplain', 'canyon', 'magma']);
  const goWord = () => (D && STAIRS_UP.has(D.dg.id) ? '올라' : '내려');   // 계단 창: 탑·산은 '올라간다'
  // 개발용 (로컬에서만 메뉴에 나온다): 보스·중간 보스 층으로 바로 내려간다
  function devJump(kind) {
    if (!D || ENV !== 'dev') return;
    const dg = D.dg, target = kind === 'boss' ? dg.floors : (dg.mid && dg.mid.floors[0]) || (dg.mode === 'rogue' ? 10 : 0);
    if (!target || target <= run.floor) { log('이 던전에는 그 층이 없거나 이미 지나왔다.', now()); return; }
    run.floor = target - 1; run.bossDone = null; run.bossPick = null;
    const p = P(); D.stairs = { x: p.x, y: p.y }; D.stairsHidden = false;
    descend(true);
  }
  function descend(force) {
    const p = P();
    if (D.dead || p.hp <= 0) return;   // 쓰러졌으면 내려가지 않는다
    if (!(D.stairs.x === p.x && D.stairs.y === p.y)) return;
    stopAuto();
    if (force !== true && missionsLeftHere().length) { stairsPrompt(); return; }   // 임무가 남은 층: 자동으로 내려가기를 켜 두었어도 묻는다
    const dg = dungeonById(run.dungeon);
    if (dg.endless && run.bossDone === run.floor && force !== true) { stairsPrompt(); return; }   // 끝없는 던전 보스 층: 계속할지 돌아갈지 묻는다
    Progress.add('floors');
    if (run.floor >= dg.floors && !dg.endless) { Sound.play('clear'); Game.endRun('clear'); return; }
    Sound.play('stairs');
    run.floor++;
    p.status = p.status === 'cnf' ? null : p.status;
    newFloor();
  }

  function afterPlayer() {
    const p = P();
    statusTick(p);
    const pSpeedy = (abVal(p, 'speedy') || 0) + (heldOf(p).speedy || 0);
    if (pSpeedy && Math.random() < pSpeedy && hostilesVisible().length) { abLog(p, `${jo(nm(p), '은')} 재빠르게 움직였다!`, T.base); D.mons.forEach(e => { if (!e.npc) abilityTick(e); }); }
    else for (const e of turnOrder()) {
      if (D.dead) break;
      if (e.dead) continue;
      const ex = e.x, ey = e.y;
      enemyAct(e);
      // 화난 켈리몬: 이동만 한 번 더 (한 턴에 두 칸)
      if (e.thief && !D.dead && e.hp > 0 && (e.x !== ex || e.y !== ey)) { e.moveOnly = true; enemyAct(e); e.moveOnly = false; }
      statusTick(e);
      const es = (abVal(e, 'speedy') || 0) + (heldOf(e).speedy || 0);   // 선제공격손톱: 동료(지닌 포켓몬)도
      if (es && !e.npc && !D.dead && e.hp > 0 && Math.random() < es) enemyAct(e);
    }
    // 동료: 배가 고프지 않은 동안 조금씩 회복 (플레이어와 같은 속도)
    for (const a of allies()) {
      a.regen = (a.regen || 0) + (a.maxhp / 110 + 0.05) * regenMul(a, heldOf(a)) * (heldOf(a).sludge && a.types.includes(4) ? 2.5 : 1);   // 검은오물: 독 타입이면 2.5배
      if (a.regen >= 1) { const n = Math.floor(a.regen); if (p.belly > 0 && a.hp < a.maxhp) a.hp = Math.min(a.maxhp, a.hp + n); a.regen -= n; }
    }
    p.partners = dungeonById(run.dungeon).pure ? -1 : (run.party || []).length;   // 혼자 탐험 보정 (청정의 탑은 없음): 동료 없이 들어왔을 때만 (동료가 모두 쓰러져도 생기지 않음)
    D.turn++; run.turnsOnFloor++; run.turns = (run.turns || 0) + 1;
    if (run.turnsOnFloor % ABILITY_RENEW === 0) renewAbilities();
    if (run.turnsOnFloor % 20 === 0) ensureMissionTargets();   // 임무 대상이 사라졌으면 다시 (v1.03 보강)   // 층에 들어설 때 발동하는 특성: 같은 층에서 100턴마다 다시
    const WD = windOf(D.dg), wi = WD.warn.indexOf(run.turnsOnFloor);
    if (wi >= 0) {
      Sound.play('wind');
      log(['어디선가 바람이 불어오기 시작했다...', '바람이 강해졌다... 서두르자!', '바람이 매우 강해졌다! 곧 날려갈 것 같다!'][wi], T.base);
      setFace(wi === 2 ? 'Worried' : 'Surprised', 2000); stopAuto();
    }
    if (run.turnsOnFloor >= WD.limit && !D.dead) {
      log('거센 바람에 날려 던전 밖으로 쫓겨났다!', T.base);
      D.dead = true; stopAuto();
      D.prompts = [() => Game.endRun('wind')];
    }
    for (const dl of D.delayed.filter(x => D.turn >= x.at)) {
      if (dl.t.hp > 0 && (dl.t.player || D.mons.includes(dl.t))) {
        const at = Math.max(T.cursor, T.moveEnd);
        log(`${dl.move.n}의 공격이 ${nm(dl.t)}에게 떨어졌다!`, at);
        D.fx.push({ kind: 'ring', x: dl.t.x, y: dl.t.y, at, dur: 400 * spd(), color: '#f95587' });
        resolveHit(dl.user, dl.t, { ...dl.move, a: 0 }, at);
        T.cursor = at + 250;
      }
    }
    D.delayed = D.delayed.filter(x => D.turn < x.at);
    // 배고픔 / 회복
    const b0 = p.belly;
    p.belly = Math.max(0, p.belly - 0.08 * ((weatherNow() === 'snow' && !p.types.includes(15)) || (weatherRaw() === 'hsand' && !p.types.some(t => t === 5 || t === 6 || t === 9)) ? 1.5 : 1) * (heldOf(p).bellyMul || 1) * (run.hard ? HARD_BELLY_MUL : 1));
    // 맹독구슬·화염구슬: 지닌 포켓몬(동료 포함)에게 5턴마다 (상태이상이 없을 때)
    if (run.turnsOnFloor % 5 === 0) for (const c of [p, ...allies()]) if (heldOf(c).orb && !c.status && c.hp > 0) { log(`${nm(c)}의 ${jo(ITEMS[c.held].n, '이')} 반응했다!`, T.base); inflict(c, heldOf(c).orb, T.base, true); }
    if (p.belly > 0) {
      const ph = heldOf(p);
      D.regen += (p.maxhp / 110 + 0.05) * regenMul(p, ph) * (ph.sludge && p.types.includes(4) ? 2.5 : 1);
      if (D.regen >= 1 && p.hp < p.maxhp && p.hp > 0) { const a = Math.floor(D.regen); p.hp = Math.min(p.maxhp, p.hp + a); D.regen -= a; }
      if (D.regen >= 1) D.regen = 0;
    } else if (p.hp > 0) {
      if (p.hp <= 1) log('배가 고파서 더는 버틸 수 없었다...', T.base);   // 쓰러진 이유가 기록에 남게
      damage(p, 1, null, T.base);
    }
    if (b0 > 20 && p.belly <= 20) { log('배가 고파졌다...', T.base); stopAuto('배가 고프다!'); }
    if (b0 > 10 && p.belly <= 10) log('배가 너무 고프다! 빨리 뭔가 먹어야 한다!', T.base);
    if (b0 > 0 && p.belly <= 0) { log('배가 고파서 기운이 없다! HP가 줄어든다!', T.base); stopAuto(); }
    // 나이트메어: 주변의 잠든 적이 악몽에 시달린다
    for (const c of [p, ...D.mons]) {
      if (c.hp <= 0 || !abilityOf(c).badDreams) continue;
      for (const e of [p, ...D.mons]) if (e.hp > 0 && e.status === 'slp' && hostileTo(c, e) && cheb(c, e) <= 4) {
        if (e.player || seen(e)) log(`${jo(nm(e), '은')} 악몽에 시달리고 있다!`, T.base);
        damage(e, pctDmg(e, 1 / 8), null, T.base);
      }
    }
    for (const c of [p, ...D.mons]) if (c.hp > 0 && !passable(c, c.x, c.y)) unstick(c);
    if (D.terrain && --D.terrainT <= 0) {   // 필드가 끝났다
      log(`발밑의 ${TERRAINS[D.terrain].icon} ${jo(TERRAINS[D.terrain].n, '이')} 사라졌다.`, Math.max(T.cursor, T.moveEnd));
      D.terrain = null; CUR_TERRAIN = null;
    }
    if (D.terrain === 'grassy' && D.turn % SAND_EVERY === 0) {   // 그래스필드: 땅에 있는 포켓몬이 조금씩 회복
      const at = Math.max(T.cursor, T.moveEnd);
      for (const c of [p, ...D.mons]) if (!c.npc && c.hp > 0 && c.hp < c.maxhp && grounded(c)) heal(c, Math.max(1, Math.floor(c.maxhp / 16)), at);
    }
    if (weatherRaw() === 'hail' && D.turn % SAND_EVERY === 0) {   // 싸라기눈 (끝없는 던전 규칙): 얼음 타입이 아니면 데미지
      const at = Math.max(T.cursor, T.moveEnd);
      for (const c of [p, ...D.mons]) {
        if (c.npc || c.hp <= 0 || c.types.includes(15) || abilityOf(c).chipImmune) continue;
        if (c.player || seen(c)) log(`싸라기눈이 ${jo(nm(c), '을')} 덮쳤다!`, at);
        const hp0 = c.hp;
        damage(c, pctDmg(c, 1 / 16), null, at);
        if (c === p) D.wxChip = (D.wxChip || 0) + Math.max(0, hp0 - c.hp);
      }
    }
    if (weatherNow() === 'sand' && D.turn % SAND_EVERY === 0) {
      const at = Math.max(T.cursor, T.moveEnd);
      for (const c of [p, ...D.mons]) {
        if (c.npc || c.hp <= 0 || c.types.some(t => t === 5 || t === 6 || t === 9) || abilityOf(c).chipImmune) continue;
        if (c.player || seen(c)) log(`모래바람이 ${jo(nm(c), '을')} 덮쳤다!`, at);
        const hp0 = c.hp;
        damage(c, pctDmg(c, 1 / 16), null, at);
        if (c === p) D.wxChip = (D.wxChip || 0) + Math.max(0, hp0 - c.hp);   // 자동 이동은 모래바람 데미지로 멈추지 않는다 (autoTick)
      }
    }
    // 함정 발견: 리더 옆 칸은 기본 20%. 날카로운눈·위험예지는 그 특성을 가진 포켓몬(동료 포함) 근처에서
    const finders = [p, ...allies()];
    const findChance = (m, tr) => {
      const dist = Math.max(Math.abs(tr.x - m.x), Math.abs(tr.y - m.y)), A = abilityOf(m);
      if (dist === 0) return 0;
      if (dist === 1) return A.keenEye ? 1 : A.anticipation ? 0.6 : m === p ? 0.2 : 0;
      return dist === 2 && A.anticipation ? 0.5 : 0;
    };
    for (const tr of D.traps) {
      const chance = Math.max(...finders.map(m => findChance(m, tr)));
      if (!tr.seen && chance > 0 && Math.random() < chance) {
        tr.seen = true; log(`${jo(TRAPS[tr.kind].n, '을')} 발견했다!`, T.base);
      }
    }
    // 적 추가 등장
    if (!D.noSpawn && --D.spawnT <= 0) {
      D.spawnT = run.hard ? rint(...HARD_SPAWN) : D.rule === 'many' ? rint(15, 25) : rint(30, 45);   // 하드모드: 더 빨리 다시 나타난다
      if (D.mons.filter(m => !m.npc && !m.ally).length < 12) { const t = randomRoomTile({ hidden: true, far: 7 }); if (t) spawnEnemy(t); }
    }
    // 모습 확인 (HP·날씨에 따라 바뀌는 포켓몬, 모르페코는 MORPEKO_TURNS턴마다)
    for (const c of [p, ...D.mons]) {
      if (c.hp <= 0 || !FORMS_OF[c.sp]) continue;
      if (c.sp === 877 && D.turn % MORPEKO_TURNS === 0) c.hangry = !c.hangry;
      formCheck(c, T.base);
    }
    computeVis();
    endTurnTiming();
    if (D.learnQueue.length) D.prompts.push(learnPrompt);
  }

  function learnPrompt() {
    const mid = D.learnQueue.shift(); if (mid == null) return;
    stopAuto();
    const p = P(), mv = DATA.moves[mid];
    if (p.moves.some(m => m.id === mid)) { if (D.learnQueue.length) D.prompts.push(learnPrompt); return; }
    UI.open({
      title: `새 기술: ${esc(mv.n)}`,
      html: `${moveDetailHtml(mid)}<p>기술을 4개 알고 있다. 잊을 기술을 고르세요.</p>`,
      choices: [...p.moves.map((m, i) => ({ label: moveLine(m.id, m.pp, m.max), sub: esc(DATA.moves[m.id].d || moveEffects(m.id).join(' ')), fn: () => {
        log(`${jo(DATA.moves[m.id].n, '을')} 잊고 ${jo(mv.n, '을')} 배웠다!`, now());
        p.moves[i] = newMove(p, mid);
      } })), { label: `${esc(jo(mv.n, '을'))} 배우지 않는다`, fn: () => {} }],
      cancel: false,
    });
    if (D.learnQueue.length) D.prompts.push(learnPrompt);
  }

  // ───────────────────────── 가방 ─────────────────────────
  function addToBag(id, n = 1) {
    const bag = run.bag;
    if (ITEMS[id].stack) { const e = bag.find(b => b.id === id); if (e) { e.n += n; return true; } }
    if (bag.length >= bagMax()) return false;
    bag.push({ id, n: ITEMS[id].stack ? n : 1 });
    if (!ITEMS[id].stack) for (let k = 1; k < n; k++) { if (bag.length >= bagMax()) return true; bag.push({ id, n: 1 }); }
    return true;
  }
  function takeFromBag(i) { const b = run.bag[i]; if (b.n > 1) b.n--; else run.bag.splice(i, 1); }

  // 떨어진 아이템을 놓는다: 그 칸이 막혀 있으면 가장 가까운 빈 바닥으로 튕겨 나간다 (3칸 안에 없으면 사라진다)
  // ignore: 자동 탐색이 주우러 가지 않을 물건 (탐험대가 던진 것). 쓰러진 적이 떨어뜨린 것은 false
  function landItem(x, y, id, n, at, ignore = true) {
    const free = (tx, ty) => floorAt(tx, ty) && !itemAt(tx, ty) && !(D.stairs.x === tx && D.stairs.y === ty) && !(D.shop && D.shop.tiles.has(idx(tx, ty)));
    for (let r = 0; r <= 3; r++) {
      const ring = [];
      for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) {
        if (Math.max(Math.abs(xx - x), Math.abs(yy - y)) === r && free(xx, yy)) ring.push([xx, yy]);
      }
      if (ring.length) {
        const [tx, ty] = pick(ring);
        D.items.push({ x: tx, y: ty, id, n }); if (ignore) D.ignore.add(idx(tx, ty));
        if (r && D.visible[idx(x, y)]) log(`${jo(ITEMS[id].n, '은')} 옆으로 튕겨 나갔다.`, at);
        return true;
      }
    }
    if (D.visible[idx(x, y)]) log(`${jo(ITEMS[id].n, '은')} 어딘가로 사라져 버렸다...`, at);
    return false;
  }
  // 아이템 던지기 (플레이어·적 공통): 앞으로 10칸 날아가 처음 맞은 포켓몬에게 효과, 안 맞으면 떨어진다
  function throwItem(user, id, dir) {
    const it = ITEMS[id], [dx, dy] = DIRS[dir];
    let x = user.x, y = user.y, hit = null;
    for (let i = 0; i < 10; i++) {   // 직선 기술처럼 벽 모서리는 지나간다
      if (!openAt(x + dx, y + dy)) break;
      x += dx; y += dy;
      const c = creatureAt(x, y);
      if (c && party(user) && party(c)) continue;   // 탐험대가 던진 것은 동료를 지나간다
      if (c) { hit = c; break; }
    }
    user.dir = dir;
    const t0 = schedAction(user, 'Attack', 260 * spd());
    D.fx.push({ kind: 'proj', x0: user.x, y0: user.y, x1: x, y1: y, at: t0 + 60, dur: 200 * spd(), color: '#ddd', icon: it.icon });
    log(`${jo(nm(user), '은')} ${jo(it.n, '을')} 던졌다!`, t0);
    const ht = t0 + 260 * spd();
    if (hit && !hit.npc) {
      if (it.throw === 'dmg') {
        let v = Math.floor(it.v * (abilityOf(user).klutz ? 1.5 : 1));
        if (!user.player) v = Math.min(v, Math.ceil(hit.maxhp * 0.3));   // 적이 던진 건 최대 HP의 30%까지 (초반에 한 방에 쓰러지지 않게)
        log(`${jo(nm(hit), '은')} ${v}의 데미지를 입었다.`, ht); damage(hit, v, user, ht); }
      else if (it.throw) inflict(hit, it.throw === 'sleep' ? 'slp' : it.throw, ht, true, user);
      else if (!it.stack) landItem(x, y, id, 1, ht);
    } else landItem(x, y, id, 1, ht);
  }

  // 구미·영양제를 먹어서 오를 능력치가 남았는지 (v1.06: 최대인데도 먹어서 없어지던 문제)
  function gummyCanRise(c, it) {
    if (D.dg.endless) { const eb = (run.eb && run.eb[c.rsp || c.sp]) || {}; return it.gummy.some(k => (eb[k] || 0) < endlessGummyCap(k)); }
    const b = c.boost || {}; return it.gummy.some(k => (b['g_' + k] || 0) < GUMMY_MAX);
  }
  const vitCanRise = (c, it) => { const ch = Game.save.roster[c.rsp || c.sp]; return !!ch && ((ch.boost || {})[it.vit] || 0) < VITAMIN_MAX; };
  // 영양제 (v1.06): 던전에서도 먹을 수 있다. 마을에서 먹은 것과 같이 캐릭터 기록에 영구히 남는다
  function useVitamin(c, it, at) {
    const ch = Game.save.roster[c.rsp || c.sp]; if (!ch) return;
    ch.boost = { ...(ch.boost || {}), [it.vit]: ((ch.boost || {})[it.vit] || 0) + 1 };
    if (run.mode === 'normal' || D.dg.endless) { c.boost = { ...(c.boost || {}), [it.vit]: ch.boost[it.vit] }; recalc(c); }   // 일반 던전·끝없는 던전은 바로 반영 (다른 로그라이크는 나온 뒤에)
    Game.persist();
    log(`${nm(c)}의 ${STAT_KO[it.vit]}이 영구히 올랐다! (${ch.boost[it.vit]}/${VITAMIN_MAX})`, at); Sound.play('levelup', at);
  }
  function useItem(slot, mode, moveIdx, allyIdx) {
    const p = P(), b = run.bag[slot]; if (!b) return false;
    const it = ITEMS[b.id];
    const at = T.base;
    if (mode === 'ally' || mode === 'revive') return useOnAlly(slot, mode, (run.party || [])[allyIdx], moveIdx);
    if (mode === 'drop') {
      if (itemAt(p.x, p.y) || (D.stairs.x === p.x && D.stairs.y === p.y)) { log('여기에는 내려놓을 수 없다.', now()); return false; }
      D.items.push({ x: p.x, y: p.y, id: b.id, n: b.n }); run.bag.splice(slot, 1);
      D.ignore.add(idx(p.x, p.y));
      log(`${jo(it.n, '을')} 내려놓았다.`, at); return true;
    }
    if (mode === 'throw') {
      takeFromBag(slot);
      throwItem(p, b.id, p.dir);
      return true;
    }
    // 사용
    if (!it.use || it.use === 'none') { log('지금은 사용할 수 없다.', now()); return false; }
    if (it.use === 'gummy' && !gummyCanRise(p, it)) { log(`${jo(nm(p), '은')} 더 이상 능력이 오르지 않는다.`, now()); return false; }
    if (it.use === 'vit' && !vitCanRise(p, it)) { log(`${nm(p)}의 ${STAT_KO[it.vit]}은 더 이상 오르지 않는다. (${VITAMIN_MAX}번까지)`, now()); return false; }
    if (it.use === 'tm') {
      const mv = DATA.moves[it.mv];
      if (p.tf) { log(`${jo(nm(p), '은')} 변신 중이라 기술을 배울 수 없다.`, now()); return false; }
      if (!canLearnTM(p.sp, it.mv)) { log(`${jo(nm(p), '은')} ${jo(mv.n, '을')} 배울 수 없다.`, now()); return false; }
      if (p.moves.some(m => m.id === it.mv)) { log(`이미 ${jo(mv.n, '을')} 알고 있다.`, now()); return false; }
      takeFromBag(slot);
      p.tms = [...new Set([...(p.tms || []), it.mv])];
      Progress.add('tms'); checkLater();
      Sound.play('item', at);
      log(`${jo(it.n, '을')} 사용했다!`, at);
      if (p.moves.length < 4) { p.moves.push(newMove(p, it.mv)); log(`${jo(nm(p), '은')} ${jo(mv.n, '을')} 배웠다!`, at); }
      else { D.learnQueue.push(it.mv); log(`(지금 배우지 않아도 마을의 기술 설정에서 언제든 넣을 수 있다)`, at); }
      return true;
    }
    takeFromBag(slot);
    if (!['heal', 'healPct', 'fullheal', 'gummy'].includes(it.use)) Sound.play('item', at);
    log(`${jo(it.n, '을')} ${isEdible(it) ? '먹었다' : '사용했다'}.`, at);
    if (isEdible(it)) { const b0 = p.belly; p.belly = Math.min(100, p.belly + BERRY_BELLY); if (p.belly > b0) log(`배가 조금 찼다. (+${Math.round(p.belly - b0)})`, at); }
    switch (it.use) {
      case 'vit': useVitamin(p, it, at); break;
      case 'heal': case 'healPct': {
        const pa = abilityOf(p);
        let amt = it.use === 'heal' ? it.v : Math.floor(p.maxhp * it.v / 100);
        if (pa.cheekPouch) amt = Math.floor(amt * 1.5);
        heal(p, amt, at);
        if (pa.harvest && Math.random() < 0.5) { addToBag(b.id); abLog(p, `${jo(it.n, '이')} 다시 열렸다!`, at); }
        break;
      }
      case 'food': setFace('Happy', 1500); p.belly = Math.min(100, p.belly + it.v * (abilityOf(p).gluttony ? 1.5 : 1)); log('배가 불러졌다!', at); break;
      case 'cureOne':
        if (p.status === it.st) { p.status = null; log(`${STATUS_NAMES[it.st]} 상태가 나았다!`, at); } else log('하지만 효과가 없었다...', at);
        break;
      case 'chesto': if (p.status === 'slp') p.status = null; p.noSleep = true; log('눈이 번쩍 뜨였다! 이 층에서는 잠들지 않는다.', at); break;
      case 'ppSome': p.moves.forEach(m => m.pp = Math.min(m.max, m.pp + it.v)); log(`모든 기술의 PP가 ${it.v}씩 회복되었다!`, at); break;
      case 'ppOne': {   // 고른 기술 하나 (고르지 않았으면 PP가 가장 많이 빈 기술)
        const m = p.moves[moveIdx] || [...p.moves].sort((a, b) => (b.max - b.pp) - (a.max - a.pp))[0];
        if (m) { m.pp = Math.min(m.max, m.pp + it.v); log(`${DATA.moves[m.id].n}의 PP가 ${it.v} 회복되었다!`, at); }
        break;
      }
      case 'statRandom': statChange(p, pick([2, 3, 4, 5, 6]), 2, at, p, STAGE_ITEM_TURNS); break;
      case 'critUp': p.critBoost = 2; p.critT = STAGE_ITEM_TURNS; log(`${jo(nm(p), '은')} 급소에 맞히기 쉬워졌다! (${STAGE_ITEM_TURNS}턴)`, at); break;
      case 'gummy': {
        setFace('Happy', 1500);
        p.belly = Math.min(100, p.belly + it.belly);
        if (D.dg.endless) { endlessGummy(p, it, at); break; }   // 끝없는 던전: 그 탐험 동안만 크게
        p.boost = { ...(p.boost || {}) };
        const up = it.gummy.filter(k => (p.boost['g_' + k] || 0) < GUMMY_MAX);
        up.forEach(k => { p.boost['g_' + k] = (p.boost['g_' + k] || 0) + 1; });
        recalc(p);
        log(`배가 조금 불러졌다! ` + (up.length ? `${up.map(k => `${STAT_KO[k]} +${gummyAmt(k)}`).join(', ')}${run.mode === 'normal' ? ' (영구)' : ' (이번 탐험 동안)'}` : '더 이상 능력이 오르지 않는다.'), at);
        if (up.length) Sound.play('levelup', at);
        break;
      }
      case 'cure': p.status = null; if (it.clearDrops) p.stages = Object.fromEntries(Object.entries(p.stages).filter(([, v]) => v > 0)); log('몸 상태가 좋아졌다!', at); break;   // 떨어진 능력은 리샘열매만 (치료씨는 상태이상만)
      case 'pp': p.moves.forEach(m => m.pp = m.max); log('모든 기술의 PP가 회복되었다!', at); break;
      case 'blast': {
        const [dx, dy] = DIRS[p.dir]; const t = creatureAt(p.x + dx, p.y + dy);
        D.fx.push({ kind: 'ring', x: p.x + dx, y: p.y + dy, at, dur: 400, color: '#ff7a2a' });
        if (t && hostileTo(p, t) && abilityOf(t).blastImmune) abLog(t, `${jo(nm(t), '은')} 폭발을 막아냈다!`, at);
        else if (t && hostileTo(p, t)) { log(`불꽃을 내뿜었다! ${jo(nm(t), '은')} 60의 데미지를 입었다.`, at); damage(t, 60, p, at + 150); }
        else log('불꽃을 내뿜었지만 아무도 없었다.', at);
        break;
      }
      case 'warp': {
        const t = randomRoomTile({ far: 6 });
        if (t) { p.x = t.x; p.y = t.y; p.tween = null; log('어딘가로 순간이동했다!', at); onStep(); }
        break;
      }
      case 'escape': D.prompts.push(() => Game.endRun('escape')); break;
      case 'map': D.explored.fill(1); D.traps.forEach(t => t.seen = true); log('층의 구조와 함정이 밝혀졌다!', at); break;
      case 'allsleep': hostilesVisible().forEach(e => inflict(e, 'slp', at, true)); break;
      case 'levelup': if (run.hard) log('하드모드에서는 레벨이 오르지 않는다...', at); else gainExp(Math.max(0, expFor(p.lv + 1) - p.exp), at, true); break;
      case 'fullheal': heal(p, p.maxhp, at); p.status = null; log('몸 상태가 완전히 좋아졌다!', at); break;
      case 'stat': statChange(p, it.st, it.v, at, p, STAGE_ITEM_TURNS); break;
      case 'radar': D.radar = true; log('층의 적과 아이템 위치를 알게 되었다!', at); break;
      case 'trapbust': D.traps = []; log('층의 함정이 모두 사라졌다!', at); break;
      case 'allpar': hostilesVisible().forEach(e => inflict(e, 'par', at, true, p)); break;
      case 'allslow': hostilesVisible().forEach(e => statChange(e, 6, -2, at, p)); break;
    }
    return true;
  }

  function openBag() {
    if (!D || busy()) return;
    stopAuto();
    const bag = run.bag, p = P();
    const heldHtml = p.held ? `<div class="row">지닌 물건: ${ITEMS[p.held].icon} <b>${esc(ITEMS[p.held].n)}${sigTag(p.held)}</b> <span class="grow dim">${esc(ITEMS[p.held].d)}</span></div>` : '<div class="row dim">지닌 물건 없음</div>';
    const foot = footItem();
    UI.open({
      title: `가방 (${bag.length}/${bagMax()})`, wide: true, html: heldHtml,
      choices: [
        // 순서: 발밑 → 지닌 물건 넣기 → 가방 정리 → 가방 아이템 (아이템을 고르러 내려가다 '지닌 물건 넣기'를 잘못 누르지 않게 위로)
        // 처음 고른 칸(def)은 그대로: 발밑이 있으면 발밑, 없으면 가방 정리, 둘 다 없으면 첫 아이템
        ...(foot ? [{ def: true, label: `👣 발밑: ${ITEMS[foot.id].icon} ${esc(ITEMS[foot.id].n)}${foot.n > 1 ? ' ×' + foot.n : ''}`, sub: '사용 · 줍기 · 교환 · 던지기', fn: footMenu }] : []),
        ...(p.held ? [{ label: `지닌 물건을 가방에 넣는다 (${esc(ITEMS[p.held].n)})`, disabled: bag.length >= bagMax(), fn: () => {
        run.bag.push({ id: p.held, n: 1 }); log(`${jo(ITEMS[p.held].n, '을')} 가방에 넣었다.`, now()); p.held = null; formCheck(p); openBag();
      } }] : []),
        ...(bag.length > 1 ? [{ def: !foot, label: '↕ 가방 정리 (종류별로 정렬)', fn: () => { sortBag(); openBag(); } }] : []),
        ...bag.map((b, i) => ({
        def: !foot && bag.length <= 1 && i === 0,
        label: `${ITEMS[b.id].icon} ${esc(ITEMS[b.id].n)}${sigTag(b.id)}${b.n > 1 ? ' ×' + b.n : ''}`, sub: esc(ITEMS[b.id].d),
        fn: () => itemMenu(i),
      }))],
    });
  }
  const ITEM_ORDER = Object.keys(ITEMS);
  function sortBag() {
    run.bag.sort((a, b) => ITEM_ORDER.indexOf(a.id) - ITEM_ORDER.indexOf(b.id));
    log('가방을 정리했다.', now());
  }
  // 발밑의 아이템 (돈·의뢰품·상점 물건 제외)
  function footItem() {
    const p = P(), it = itemAt(p.x, p.y);
    return it && !it.money && it.id !== 'quest' && !it.price && ITEMS[it.id] ? it : null;
  }
  function footMenu() {
    const it = footItem(); if (!it) return openBag();
    const I = ITEMS[it.id];
    UI.open({
      title: `👣 발밑: ${I.icon} ${esc(I.n)}${it.n > 1 ? ' ×' + it.n : ''}`, html: `<p>${esc(I.d)}</p>`,
      choices: [
        ...(I.use && I.use !== 'none' ? [{ label: '사용한다', fn: () => I.use !== 'ppOne' ? act({ t: 'foot', mode: 'use' }) : UI.open({
          title: `${I.icon} ${esc(I.n)} — PP를 회복할 기술`,
          choices: [...P().moves.map((m, k) => ({ label: `${esc(DATA.moves[m.id].n)} <span class="dim">PP ${m.pp}/${m.max}</span>`, fn: () => act({ t: 'foot', mode: 'use', slot: k }) })), { label: '돌아간다', fn: footMenu }] }) }] : []),
        ...(ALLY_USES.includes(I.use) && liveAllies().length ? [{ label: '🤝 동료에게 쓴다', fn: () => footAllyPick(I, footMenu) }] : []),
        ...(it.id === 'reviver' && downAllies().length ? [{ label: '🌰 쓰러진 동료를 되살린다', fn: () => UI.open({ title: '🌰 부활씨 — 누구를 되살릴까?', choices: [...downAllies().map(a => ({ label: esc(nm(a)), fn: () => act({ t: 'foot', mode: 'revive', ally: run.party.indexOf(a) }) })), { label: '돌아간다', fn: footMenu }], cancel: footMenu }) }] : []),
        { label: '줍는다', disabled: run.bag.length >= bagMax() && !(I.stack && run.bag.some(b => b.id === it.id)), fn: () => act({ t: 'foot', mode: 'pick' }) },
        { label: '가방의 아이템과 바꾼다', disabled: !run.bag.length, fn: () => UI.open({
          title: `무엇과 바꿀까? (${esc(I.n)})`, wide: true,
          choices: run.bag.map((b, i) => ({ label: `${ITEMS[b.id].icon} ${esc(ITEMS[b.id].n)}${b.n > 1 ? ' ×' + b.n : ''}`, fn: () => act({ t: 'foot', mode: 'swap', slot: i }) })),
          cancel: footMenu,
        }) },
        { label: '던진다', fn: () => act({ t: 'foot', mode: 'throw' }) },
        { label: '돌아간다', fn: openBag },
      ],
      cancel: openBag,
    });
  }
  // 발밑의 아이템을 동료에게 (가방의 '동료에게 쓴다'와 같다)
  function footAllyPick(I, back) {
    const go = (a, k) => act({ t: 'foot', mode: 'ally', ally: run.party.indexOf(a), slot: k });
    const pickMove = a => UI.open({ title: `${I.icon} ${esc(I.n)} — ${esc(nm(a))}의 어느 기술?`, choices: [...a.moves.map((m, k) => ({ label: `${esc(DATA.moves[m.id].n)} <span class="dim">PP ${m.pp}/${m.max}</span>`, fn: () => go(a, k) })), { label: '돌아간다', fn: back }], cancel: back });
    UI.open({ title: `${I.icon} ${esc(I.n)} — 누구에게?`, choices: [...liveAllies().map(a => ({ label: `${esc(nm(a))} <span class="dim">HP ${a.hp}/${a.maxhp}${a.status ? ' · ' + STATUS_NAMES[a.status] : ''}</span>`, fn: () => (I.use === 'ppOne' ? pickMove(a) : go(a)) })), { label: '돌아간다', fn: back }], cancel: back });
  }
  function footAction(mode, slot, ally) {
    const p = P(), it = footItem(); if (!it) return false;
    const I = ITEMS[it.id];
    if (mode === 'pick') {
      if (!addToBag(it.id, it.n)) { log('가방이 가득 찼다.', now()); return false; }
      D.items = D.items.filter(i => i !== it);
      Sound.play('pickup', T.base); log(`${jo(I.n, '을')} 주웠다.` + (it.n > 1 ? ` (${it.n}개)` : ''), T.base);
      return true;
    }
    if (mode === 'swap') {
      const b = run.bag[slot]; if (!b) return false;
      run.bag.splice(slot, 1);
      D.items = D.items.filter(i => i !== it);
      addToBag(it.id, it.n);
      D.items.push({ x: p.x, y: p.y, id: b.id, n: b.n }); D.ignore.add(idx(p.x, p.y));
      log(`${jo(ITEMS[b.id].n, '을')} 내려놓고 ${jo(I.n, '을')} 주웠다.`, T.base);
      return true;
    }
    if (mode === 'throw') {
      if (it.n > 1) it.n--; else D.items = D.items.filter(i => i !== it);
      throwItem(p, it.id, p.dir);
      return true;
    }
    if (mode === 'use' || mode === 'ally' || mode === 'revive') {
      // 발밑의 아이템을 잠깐 가방 끝에 넣고 그대로 쓴다 (가방이 가득 차 있어도). 못 쓰면 다시 바닥에 둔다. ally·revive: 동료에게 (v0.102 보강)
      const one = { id: it.id, n: 1 };
      run.bag.push(one);
      const ok = mode === 'use' ? useItem(run.bag.length - 1, 'use', slot) : useItem(run.bag.length - 1, mode, slot, ally);
      const k = run.bag.indexOf(one); if (k >= 0) run.bag.splice(k, 1);
      if (!ok) return false;
      if (it.n > 1) it.n--; else D.items = D.items.filter(i => i !== it);
      return true;
    }
    return false;
  }

  // ── 동료에게 아이템 쓰기: 회복·상태이상·PP 아이템, 부활씨는 쓰러진 동료를 되살린다 ──
  const ALLY_USES = ['heal', 'healPct', 'fullheal', 'cure', 'cureOne', 'pp', 'ppSome', 'ppOne', 'gummy', 'vit', 'levelup', 'tm'];
  const liveAllies = () => (run.party || []).filter(a => !a.fainted && D.mons.includes(a));
  const downAllies = () => (run.party || []).filter(a => a.fainted);
  function useOnAlly(slot, mode, a, moveIdx) {
    const itemId = run.bag[slot].id, it = ITEMS[itemId], at = T.base;
    if (!a) return false;
    if (mode === 'revive') {
      if (!a.fainted || run.bag[slot].id !== 'reviver') return false;
      const p = P(), spot = bfs(p.x, p.y, (x, y) => !creatureAt(x, y), { max: 400 });
      if (!spot) { log('되살릴 자리가 없다.', now()); return false; }
      takeFromBag(slot);
      Object.assign(a, { fainted: false, dead: false, deadAt: 0, hp: a.maxhp, status: null, statusT: 0, stages: {}, stageT: {}, x: spot.x, y: spot.y, tween: null, act: null, charging: null, rampage: null, recharge: false, struck: new Set(), target: null });
      a.stageS = {}; refillPP(a);
      D.corpses = D.corpses.filter(c => c !== a); D.mons.push(a);
      Sound.play('item', at); log(`부활씨의 힘으로 ${jo(nm(a), '이')} 되살아났다! (PP도 모두 회복)`, at); popup(a, 'REVIVE', '#ffe066', at + 150);
      updateTacticBtn(); return true;
    }
    if (a.fainted || !D.mons.includes(a) || !ALLY_USES.includes(it.use)) return false;
    if (it.use === 'gummy' && !gummyCanRise(a, it)) { log(`${jo(nm(a), '은')} 더 이상 능력이 오르지 않는다.`, now()); return false; }
    if (it.use === 'vit' && !vitCanRise(a, it)) { log(`${nm(a)}의 ${STAT_KO[it.vit]}은 더 이상 오르지 않는다. (${VITAMIN_MAX}번까지)`, now()); return false; }
    if (it.use === 'tm') {   // 동료 기술머신: 배운 기술은 캐릭터 기록에도 남는다 (동료 창의 기술 바꾸기·마을 기술 설정에서 넣고 뺄 수 있다)
      const mv = DATA.moves[it.mv], ch = Game.save.roster[a.rsp || a.sp];
      if (a.tf) { log(`${jo(nm(a), '은')} 변신 중이라 기술을 배울 수 없다.`, now()); return false; }
      if (!canLearnTM(a.sp, it.mv)) { log(`${jo(nm(a), '은')} ${jo(mv.n, '을')} 배울 수 없다.`, now()); return false; }
      if (a.moves.some(m => m.id === it.mv) || (ch && (ch.tms || []).includes(it.mv))) { log(`${jo(nm(a), '은')} 이미 ${jo(mv.n, '을')} 알고 있다.`, now()); return false; }
      takeFromBag(slot);
      a.tms = [...new Set([...(a.tms || []), it.mv])];
      if (ch) ch.tms = [...new Set([...(ch.tms || []), it.mv])];
      Progress.add('tms'); checkLater();
      Sound.play('item', at);
      log(`${nm(a)}에게 ${jo(it.n, '을')} 사용했다!`, at);
      if (a.moves.length < 4) { a.moves.push(newMove(a, it.mv)); if (ch) ch.moves = a.moves.map(m => m.id); log(`${jo(nm(a), '은')} ${jo(mv.n, '을')} 배웠다!`, at); }
      else log(`${jo(nm(a), '은')} ${jo(mv.n, '을')} 배울 수 있게 됐다! (동료 창의 기술 바꾸기에서 넣을 수 있다)`, at);
      return true;
    }
    takeFromBag(slot);
    Sound.play('item', at);
    log(`${nm(a)}에게 ${jo(it.n, '을')} 주었다.`, at);
    switch (it.use) {
      case 'vit': useVitamin(a, it, at); break;
      case 'heal': case 'healPct': {   // 볼주머니·수확: 먹는 동료의 특성
        const aa = abilityOf(a);
        let amt = it.use === 'heal' ? it.v : Math.floor(a.maxhp * it.v / 100);
        if (aa.cheekPouch) amt = Math.floor(amt * 1.5);
        heal(a, amt, at);
        if (aa.harvest && Math.random() < 0.5) { addToBag(itemId); abLog(a, `${jo(it.n, '이')} 다시 열렸다!`, at); }
        break;
      }
      case 'fullheal': a.status = null; heal(a, a.maxhp, at); break;
      case 'cure': a.status = null; if (it.clearDrops) a.stages = Object.fromEntries(Object.entries(a.stages).filter(([, v]) => v > 0)); log(`${nm(a)}의 몸 상태가 좋아졌다!`, at); break;
      case 'cureOne': if (a.status === it.st) { a.status = null; log(`${nm(a)}의 ${STATUS_NAMES[it.st]} 상태가 나았다!`, at); } else log('하지만 효과가 없었다...', at); break;
      case 'pp': a.moves.forEach(m => m.pp = m.max); log(`${nm(a)}의 모든 기술의 PP가 회복되었다!`, at); break;
      case 'ppSome': a.moves.forEach(m => m.pp = Math.min(m.max, m.pp + it.v)); log(`${nm(a)}의 모든 기술의 PP가 ${it.v}씩 회복되었다!`, at); break;
      case 'gummy': {   // 동료의 구미는 바로 캐릭터 기록에 남는다 (리더처럼 영구)
        if (D.dg.endless) { endlessGummy(a, it, at); break; }
        a.boost = { ...(a.boost || {}) };
        const up = it.gummy.filter(k => (a.boost['g_' + k] || 0) < GUMMY_MAX);
        up.forEach(k => { a.boost['g_' + k] = (a.boost['g_' + k] || 0) + 1; });
        const ch = Game.save.roster[a.rsp || a.sp]; if (ch && up.length) ch.boost = { ...(ch.boost || {}), ...Object.fromEntries(up.map(k => ['g_' + k, a.boost['g_' + k]])) };
        recalc(a);
        log(up.length ? `${nm(a)}의 ${up.map(k => `${STAT_KO[k]} +${gummyAmt(k)}`).join(', ')} (영구)` : `${jo(nm(a), '은')} 더 이상 능력이 오르지 않는다.`, at);
        if (up.length) Sound.play('levelup', at);
        break;
      }
      case 'levelup': if (run.hard) log('하드모드에서는 레벨이 오르지 않는다...', at); else allyExp(a, Math.max(0, expFor(a.lv + 1) - a.exp), at, true); break;
      case 'ppOne': { const m = a.moves[moveIdx] || [...a.moves].sort((x, y) => (y.max - y.pp) - (x.max - x.pp))[0]; if (m) { m.pp = Math.min(m.max, m.pp + it.v); log(`${nm(a)}의 ${DATA.moves[m.id].n} PP가 ${it.v} 회복되었다!`, at); } break; }
    }
    return true;
  }
  // 누구에게 쓸지 고른다 (기술을 고르는 아이템이면 그다음 기술)
  function pickAllyFor(slot, back) {
    const it = ITEMS[run.bag[slot].id];
    const go = (a, k) => act({ t: 'item', slot, mode: 'ally', ally: run.party.indexOf(a), move: k });
    const pickMove = a => UI.open({ title: `${it.icon} ${esc(it.n)} — ${esc(nm(a))}의 어느 기술?`, choices: [...a.moves.map((m, k) => ({ label: `${esc(DATA.moves[m.id].n)} <span class="dim">PP ${m.pp}/${m.max}</span>`, fn: () => go(a, k) })), { label: '돌아간다', fn: back }] });
    UI.open({ title: `${it.icon} ${esc(it.n)} — 누구에게?`,
      choices: [...liveAllies().map(a => ({ label: `${esc(nm(a))} <span class="dim">HP ${a.hp}/${a.maxhp}${a.status ? ' · ' + STATUS_NAMES[a.status] : ''}</span>`, fn: () => (it.use === 'ppOne' ? pickMove(a) : go(a)) })), { label: '돌아간다', fn: back }] });
  }
  function pickReviveFor(slot, back) {
    UI.open({ title: '🌰 부활씨 — 누구를 되살릴까?', choices: [...downAllies().map(a => ({ label: esc(nm(a)), fn: () => act({ t: 'item', slot, mode: 'revive', ally: run.party.indexOf(a) }) })), { label: '돌아간다', fn: back }] });
  }

  // 아이템 사용: 기술 하나를 고르는 아이템(과사열매)은 먼저 기술을 고른다
  function useAct(slot) {
    const it = ITEMS[run.bag[slot].id], p = P();
    if (it.use !== 'ppOne') { act({ t: 'item', slot, mode: 'use' }); return; }
    UI.open({ title: `${it.icon} ${esc(it.n)} — PP를 회복할 기술`, html: `<p>${esc(it.d)}</p>`,
      choices: [...p.moves.map((m, k) => ({ label: `${esc(DATA.moves[m.id].n)} <span class="dim">PP ${m.pp}/${m.max}</span>`, fn: () => act({ t: 'item', slot, mode: 'use', move: k }) })),
        { label: '그만둔다', fn: () => {} }] });
  }
  function quickUse() {
    if (!D || busy()) return;
    const id = Game.save.settings.quickItem;
    if (!id || !ITEMS[id]) { log('가방에서 아이템을 고른 뒤 "빠른 사용으로 등록"을 누르세요.', now()); return; }
    const it = ITEMS[id], p = P();
    // 지닌 물건 (v0.92): 지금 지닌 물건과 바꾼다. 이미 지니고 있으면 바꾸기 전에 지니던 물건으로 되돌린다 (친구리본 ↔ 원래 도구)
    if (it.held && p.held === id) {
      const back = p.quickPrev && run.bag.findIndex(b => b.id === p.quickPrev);
      if (back == null || back < 0) { log(`이미 ${jo(it.n, '을')} 지니고 있다.`, now()); return; }
      equipHeld(back); return;
    }
    const slot = run.bag.findIndex(b => b.id === id);
    if (slot < 0) { log(`가방에 ${jo(it.n, '이')} 없다.`, now()); return; }
    if (it.held) { const why = heldBlockReason(p.baseAbility ?? p.ability, id); if (why) { log(why, now()); return; } p.quickPrev = p.held; equipHeld(slot); return; }
    if (it.throw || !it.use || it.use === 'none') { autoFace(P(), { r: 'p' }); act({ t: 'item', slot, mode: 'throw' }); }
    else useAct(slot);
  }
  // 가방의 지닌 물건을 리더에게 지니게 한다 (지니던 물건은 가방으로). 턴을 쓰지 않는다
  // 지닌 물건을 리더나 동료에게 (동료는 행동을 쓰지 않는다, 동료 창의 지닌 물건 바꾸기와 같다)
  function pickHolder(i, back) {
    const id = run.bag[i].id, row = (c, lead) => {
      const why = heldBlockReason(c.baseAbility ?? c.ability, id);
      return { label: `${lead ? '👑 ' : '🤝 '}${esc(nm(c))} <span class="dim">지닌 물건: ${c.held ? ITEMS[c.held].icon + ' ' + esc(ITEMS[c.held].n) : '없음'}</span>`, sub: why || '', disabled: !!why,
        fn: () => { if (lead) return equipHeld(i);
          const old = c.held; takeFromBag(i); if (old) run.bag.push({ id: old, n: 1 });
          c.held = id; log(`${jo(nm(c), '은')} ${jo(ITEMS[id].n, '을')} 지녔다.` + (old ? ` (${jo(ITEMS[old].n, '은')} 가방으로)` : ''), now()); formCheck(c); } };
    };
    UI.open({ title: `${ITEMS[id].icon} ${esc(ITEMS[id].n)} — 누구에게 지니게 할까?`, choices: [row(P(), true), ...liveAllies().map(a => row(a, false)), { label: '돌아간다', fn: back }] });
  }
  function equipHeld(i) {
    const p = P(), b = run.bag[i], it = ITEMS[b.id], old = p.held;
    run.bag.splice(i, 1); p.held = b.id;
    if (old) run.bag.push({ id: old, n: 1 });
    log(`${jo(it.n, '을')} 지니게 했다.` + (old ? ` (${jo(ITEMS[old].n, '은')} 가방으로)` : ''), now());
    formCheck(p, now() + 200);   // 메가스톤·폼체인지 도구
  }

  const quickVerb = id => (ITEMS[id].held ? '지닌 물건과 바꾸기, 한 번 더 누르면 되돌리기' : ITEMS[id].throw || !ITEMS[id].use || ITEMS[id].use === 'none' ? '던지기' : '사용');
  function itemMenu(i) {
    const b = run.bag[i], it = ITEMS[b.id];
    const ch = [];
    if (it.use && it.use !== 'none') ch.push({ label: '사용한다', fn: () => useAct(i) });
    if (ALLY_USES.includes(it.use) && liveAllies().length) ch.push({ label: '🤝 동료에게 쓴다', fn: () => pickAllyFor(i, () => itemMenu(i)) });
    if (b.id === 'reviver' && downAllies().length) ch.push({ label: '🌰 쓰러진 동료를 되살린다', fn: () => pickReviveFor(i, () => itemMenu(i)) });
    if (it.held) {
      if (liveAllies().length) ch.push({ label: '지니게 한다 (누구에게?)', fn: () => pickHolder(i, () => itemMenu(i)) });
      else ch.push({ label: '지니게 한다', disabled: !!heldBlockReason(P().baseAbility ?? P().ability, b.id), sub: heldBlockReason(P().baseAbility ?? P().ability, b.id), fn: () => equipHeld(i) });
    }
    ch.push({ label: '던진다', fn: () => act({ t: 'item', slot: i, mode: 'throw' }) });
    const fav = Game.save.settings.quickItem === b.id;
    ch.push({ label: fav ? '⭐ 빠른 사용 해제' : `⭐ 빠른 사용으로 등록 (T 키 / 버튼으로 바로 ${quickVerb(b.id)})`, fn: () => {
      Game.setSetting('quickItem', fav ? null : b.id); quickCache = '';
      log(fav ? '빠른 사용을 해제했다.' : `${jo(it.n, '을')} 빠른 사용으로 등록했다.`, now()); openBag();
    } });
    ch.push({ label: '내려놓는다', fn: () => act({ t: 'item', slot: i, mode: 'drop' }) });
    ch.push({ label: '돌아간다', fn: openBag });
    UI.open({ title: `${it.icon} ${esc(it.n)}`, html: `<p>${esc(it.d)}</p>`, choices: ch, cancel: openBag });
  }

  // ───────────────────────── 자동 행동 (돌죽 스타일) ─────────────────────────
  function startAuto(kind, extra = {}) {
    if (!D || D.dead) return;
    // O: 적이 보이면 자동 전투 한 턴 (예전 Tab), 아니면 자동 이동 (적을 만나면 멈춘다)
    if (kind === 'explore' && engageable().length) { autoFight(); return; }   // 닿지 않는 적(웅덩이 위 등)만 보이면 그냥 자동 이동
    if (kind !== 'fight' && (kind === 'rest' ? hostilesVisible() : engageable()).length) { log('근처에 적이 있어서 할 수 없다!', now()); return; }
    if (kind === 'rest' && P().hp >= P().maxhp && !P().status) { log('휴식할 필요가 없다.', now()); return; }
    D.auto = { kind, hp: P().hp, n: 0, ...extra };
  }
  function stopAuto(msg) {
    if (!D || !D.auto) return;
    D.auto = null;
    if (msg) log(msg, now());
  }
  const AUTO_ITEM_REACH = 12;
  const bagFits = id => run.bag.length < bagMax() || (ITEMS[id] && ITEMS[id].stack && run.bag.some(b => b.id === id));
  function isFrontier(x, y) {
    if (!D.explored[idx(x, y)] || !floorAt(x, y)) return false;
    for (const [dx, dy] of DIRS) if (inb(x + dx, y + dy) && !D.explored[idx(x + dx, y + dy)]) return true;
    return false;
  }
  function autoTick() {
    const a = D.auto, p = P();
    if (!a) return;
    const chip = D.wxChip || 0; D.wxChip = 0;   // 모래바람 데미지는 '공격을 받았다'로 치지 않는다 (HP가 위험해지면 멈춘다)
    if ((p.hp + chip < a.hp || (chip && p.hp <= p.maxhp * DANGER_HP)) && a.kind !== 'fight') { stopAuto(p.belly <= 0 ? '배가 고파서 HP가 줄고 있다! 무언가 먹어야 한다.' : '공격을 받았다!'); return; }
    a.hp = p.hp;
    if (++a.n > 800) { stopAuto(); return; }
    if (a.kind === 'fight') { autoFight(); D.auto = null; return; }
    if ((a.kind === 'rest' ? hostilesVisible() : engageable()).length) { stopAuto('적이 나타났다! (O: 자동 전투 한 턴)'); return; }
    if (a.kind === 'rest') {
      if (p.hp >= p.maxhp && !p.status) { stopAuto('HP가 가득 찼다.'); return; }
      if (p.belly <= 0) { stopAuto(); return; }
      act({ t: 'wait' }); return;
    }
    let step = null;
    const AO = { known: true, blockMons: true, seenOnly: true, self: p, avoidTraps: true, passAllies: true, straight: { dir: p.dir } };
    if (a.kind === 'travel') {
      if (p.x === a.x && p.y === a.y) { stopAuto(); return; }
      step = bfs(p.x, p.y, (x, y) => x === a.x && y === a.y, AO);
      if (!step) { stopAuto('그곳까지 갈 수 없다.'); return; }
    } else {
      // 자동 탐색은 계단 칸을 밟고 지나가지 않는다 (계단으로 갈 때만 밟는다, v0.99)
      if (D.stairs) AO.avoid = (x, y) => x === D.stairs.x && y === D.stairs.y;
      // 구조 의뢰 대상이 보이면 옆까지 가서 멈춘다 (한 번 멈춘 뒤에는 다시 O를 누르면 그냥 지나간다)
      const sos = D.mons.find(m => m.npc && m.mission && seen(m) && !(D.npcSeen && D.npcSeen.has(m)));
      if (sos) {
        if (Math.max(Math.abs(sos.x - p.x), Math.abs(sos.y - p.y)) <= 1) {
          (D.npcSeen = D.npcSeen || new Set()).add(sos);
          stopAuto(`구조할 ${jo(spName(sos.sp), '이')} 바로 옆에 있다! (그쪽으로 움직이면 구조)`); return;
        }
        step = bfs(p.x, p.y, (x, y) => Math.max(Math.abs(sos.x - x), Math.abs(sos.y - y)) <= 1, AO);
        if (!a.toSos) { a.toSos = true; log(`구조할 ${jo(spName(sos.sp), '을')} 발견했다!`, now()); }
      }
      // 켈리몬 상점: 상인이 처음 보이면 옆까지 가서 멈춘다 (v0.99)
      const shop = !step && D.mons.find(m => m.shopkeeper && m.npc && m.hp > 0 && seen(m));
      if (shop && !D.shopNoted) {
        if (cheb(shop, p) <= 1) { D.shopNoted = true; stopAuto('켈리몬 상점이 바로 앞에 있다! (켈리몬 쪽으로 움직이면 상점 · O: 계속 탐색)'); return; }
        step = bfs(p.x, p.y, (x, y) => Math.max(Math.abs(shop.x - x), Math.abs(shop.y - y)) <= 1, AO);
        if (step && !a.toShop) { a.toShop = true; log('켈리몬 상점을 발견했다!', now()); }
      }
      // 계단이 처음 보이면 앞까지 가서 멈춘다 (구조 대상처럼. 다시 O를 누르면 남은 곳을 계속 탐색, v0.99)
      const st = D.stairs;
      if (!step && st && !D.stairsNoted && !D.stairsHidden && D.explored[idx(st.x, st.y)]) {
        const d = Math.max(Math.abs(st.x - p.x), Math.abs(st.y - p.y));
        if (d <= 1) { D.stairsNoted = true; stopAuto(d ? `계단이 바로 앞에 있다! (계단으로 움직이면 ${goWord()}간다 · O: 계속 탐색)` : '계단 위에 있다! (O: 계속 탐색)'); return; }
        step = bfs(p.x, p.y, (x, y) => Math.max(Math.abs(st.x - x), Math.abs(st.y - y)) <= 1 && !(x === st.x && y === st.y), AO);
        if (step && !a.toStairsSeen) { a.toStairsSeen = true; log('계단을 발견했다!', now()); }
      }
      // 아이템: 이미 본 바닥의 아이템 (일부러 내려놓거나 던진 것은 빼고, 가방이 가득 차 못 주운 것은 지금 들어갈 자리가 있으면)
      const wantItem = (x, y) => {
        const it = itemAt(x, y), k = idx(x, y);
        if (!it || it.price || !D.explored[k] || D.ignore.has(k)) return false;
        return !(D.fullSkip && D.fullSkip.has(k)) || it.money || it.id === 'quest' || bagFits(it.id);
      };
      // 가까운(AUTO_ITEM_REACH걸음 안) 아이템은 안 가 본 곳보다 먼저 줍는다. 그보다 멀면 가까운 쪽부터
      if (!step) { const s = bfs(p.x, p.y, wantItem, AO); if (s && s.len <= AUTO_ITEM_REACH) step = s; }
      if (!step) step = bfs(p.x, p.y, (x, y) => wantItem(x, y) || isFrontier(x, y), AO);
      if (!step) {
        const s = D.stairs;
        if (!D.stairsHidden && D.explored[idx(s.x, s.y)]) {
          if (p.x === s.x && p.y === s.y) { stopAuto(); D.prompts.push(Game.save.settings.autoDescend ? descend : stairsPrompt); return; }
          step = bfs(p.x, p.y, (x, y) => x === s.x && y === s.y, AO);
          if (!step) { stopAuto('계단까지 갈 수 없다.'); return; }
          if (!a.toStairs) { a.toStairs = true; log('탐색 완료. 계단으로 향한다.', now()); }
        } else { stopAuto('더 이상 탐색할 곳이 없다.'); return; }
      }
    }
    const r = act({ t: 'move', dir: dirIndex(step.fx - p.x, step.fy - p.y) });
    if (!r) stopAuto();
  }
  const AUTO_STOP_HP = 0.3;   // 자동 전투는 HP가 이보다 낮으면 멈춘다
  // 자동으로 상대할 수 있는 적 (v0.100): 지금 공격이 닿거나(옆·직선 기술·주변 기술), 바닥으로 걸어가 옆에 설 수 있는 적.
  //  물·용암 웅덩이 한가운데처럼 닿지 않는 적은 무시하고 자동 이동을 이어 간다 (가까워져서 닿게 되면 그때 싸운다)
  // 선공기(앞 2칸)로 지금 칠 수 있는지: 바로 옆(벽 모서리 너머 대각선 포함), 또는 직선 2칸 (사이 칸이 비었거나 동료)
  const reachSlots = p => p.moves.map((m, i) => i).filter(i => { const m = p.moves[i]; return m.pp > 0 && DATA.moves[m.id] && DATA.moves[m.id].r === 'f' && MOVE_RULES[m.id]?.reach >= 2 && !repeatBlocked(p, m.id, D.turn); });
  function reachHit(p, f) {
    const dx = f.x - p.x, dy = f.y - p.y, dist = Math.max(Math.abs(dx), Math.abs(dy));
    if (dist === 1) return true;
    if (dist !== 2 || !(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy))) return false;
    const sx = Math.sign(dx), sy = Math.sign(dy), mx = p.x + sx, my = p.y + sy, mid = creatureAt(mx, my);
    return openAt(mx, my) && (!mid || (party(p) && party(mid))) && diagOK(p.x, p.y, sx, sy) && diagOK(mx, my, sx, sy);
  }
  // 지금 실제로 쓰일 기술 (자동 전투·AI가 사거리를 판단할 때, v1.06): 와이드포스는 사이코필드에서 땅에 있으면 주변 범위
  const liveMove = (c, id) => { const m = DATA.moves[id]; return m && id === EXPANDING_FORCE && CUR_TERRAIN === 'psychic' && grounded(c) ? { ...m, r: 'r' } : m; };
  function canHitNow(p, f) {
    const dx = f.x - p.x, dy = f.y - p.y, dist = Math.max(Math.abs(dx), Math.abs(dy)), dir = dist ? dirIndex(dx, dy) : 0;
    if (dist <= 2 && reachSlots(p).length && reachHit(p, f)) return true;
    if (dist === 1) return diagOK(p.x, p.y, Math.sign(dx), Math.sign(dy));
    const has = r => p.moves.some(m => m.pp > 0 && liveMove(p, m.id) && liveMove(p, m.id).r === r && liveMove(p, m.id).c !== 1);
    if ((dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) && dist <= PROJ_RANGE && has('p') && lineClear(p, dir, dist)) return true;
    return dist <= 3 && has('r') && los(p.x, p.y, f.x, f.y);
  }
  const approachPath = (p, f) => bfs(p.x, p.y, (x, y) => Math.max(Math.abs(x - f.x), Math.abs(y - f.y)) <= 1 && diagOK(x, y, Math.sign(f.x - x), Math.sign(f.y - y)), { blockMons: true, self: p, avoidTraps: true, passAllies: true, max: 1500 });
  const engageable = () => { const p = P(); return hostilesVisible().filter(f => canHitNow(p, f) || approachPath(p, f)); };
  function autoFight() {
    const p = P();
    if (!hostilesVisible().length) { log('주변에 적이 없다.', now()); return; }
    const foes = engageable();
    if (!foes.length) { log('닿지 않는 곳에 있는 적뿐이다.', now()); return; }
    if (p.hp < p.maxhp * AUTO_STOP_HP) { log('HP가 너무 낮다! 직접 조작하세요.', now()); return; }
    // 지금 칠 수 있는 적 → 아니면 걸어서 가장 가까이 갈 수 있는 적
    let tgt = foes.filter(f => canHitNow(p, f)).sort((a, b) => cheb(a, p) - cheb(b, p))[0], path = null;
    if (!tgt) { for (const f of foes) { const ph = approachPath(p, f); if (ph && (!path || ph.len < path.len)) { path = ph; tgt = f; } } }
    const dx = tgt.x - p.x, dy = tgt.y - p.y, dist = Math.max(Math.abs(dx), Math.abs(dy));
    const cands = [{ slot: -1, s: moveScore(p, tgt, NORMAL_ATTACK) }];
    const dir = dirIndex(dx, dy), alignedT = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
    p.moves.forEach((m, i) => { if (m.pp > 0 && !moveOff(p, m.id) && !selfKOBlocked(p, m.id) && !repeatBlocked(p, m.id, D.turn)) { const mv = liveMove(p, m.id); cands.push({ slot: i, mv, s: moveScore(p, tgt, mv) * (mv.r === 'r' ? 1.1 : 1) * (MOVE_RULES[m.id]?.pierce && alignedT ? pierceN(p, dir) : 1) }); } });
    if (dist === 1 && diagOK(p.x, p.y, Math.sign(dx), Math.sign(dy))) {
      const best = cands.filter(c => c.slot < 0 || c.mv.r !== 's').sort((a, b) => b.s - a.s)[0];
      p.dir = dir;
      act(best.slot < 0 ? { t: 'attack' } : { t: 'skill', slot: best.slot, autoFace: false });
      return;
    }
    // 선공기 (v0.102 보강): 2칸 앞이면 다가가지 않고 바로, 벽 모서리 너머 바로 옆 대각선도
    if (dist <= 2 && reachHit(p, tgt)) {
      const rs = new Set(reachSlots(p)), best = cands.filter(c => c.slot >= 0 && rs.has(c.slot)).sort((a, b) => b.s - a.s)[0];
      if (best && best.s > 0) { p.dir = dir; act({ t: 'skill', slot: best.slot, autoFace: false }); return; }
    }
    const aligned = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
    if (aligned && dist <= PROJ_RANGE && lineClear(p, dir, dist)) {
      const best = cands.filter(c => c.slot >= 0 && c.mv.r === 'p').sort((a, b) => b.s - a.s)[0];
      if (best && best.s > 0) { p.dir = dir; act({ t: 'skill', slot: best.slot, autoFace: false }); return; }
    }
    if (dist <= 3 && los(p.x, p.y, tgt.x, tgt.y)) {
      const best = cands.filter(c => c.slot >= 0 && c.mv.r === 'r').sort((a, b) => b.s - a.s)[0];
      if (best && best.s > cands[0].s) { act({ t: 'skill', slot: best.slot, autoFace: false }); return; }
    }
    const go = path || approachPath(p, tgt);   // 닿는 기술이 마땅치 않으면 걸어서 다가간다
    if (go) { act({ t: 'move', dir: dirIndex(go.fx - p.x, go.fy - p.y) }); return; }
    const any = cands.filter(c => c.slot >= 0 && c.s > 0 && ((c.mv.r === 'p' && aligned && dist <= PROJ_RANGE && lineClear(p, dir, dist)) || (c.mv.r === 'r' && dist <= 3 && los(p.x, p.y, tgt.x, tgt.y)))).sort((a, b) => b.s - a.s)[0];
    if (any) { if (any.mv.r === 'p') p.dir = dir; act({ t: 'skill', slot: any.slot, autoFace: false }); }   // 걸어갈 수 없으면 닿는 기술이라도
  }

  // ───────────────────────── 렌더링 ─────────────────────────
  function buildMapCanvas() {
    const floor = D;
    // 타일셋 이미지(기본·변형)가 아직 로딩 중이면 있는 것으로 먼저 그리고, 하나씩 로딩될 때마다 다시 그린다
    const rebuild = () => { if (D === floor) D.mapCanvas = Tiles.build(D, rebuild); };
    D.mapCanvas = Tiles.build(D, rebuild);
  }

  function vpos(c, t) {
    const tw = c.tween;
    if (tw && t < tw.start + tw.dur) {
      const k = clamp((t - tw.start) / tw.dur, 0, 1);
      return { x: tw.fx + (c.x - tw.fx) * k, y: tw.fy + (c.y - tw.fy) * k, walking: t >= tw.start };
    }
    return { x: c.x, y: c.y, walking: false };
  }

  function drawCreature(c, t, ox, oy) {
    const v = vpos(c, t);
    let cx = v.x * TILE + TILE / 2 - ox, cy = v.y * TILE + TILE / 2 - oy;
    let anim = 'Idle', at = t + c.id * 5000, loop = true;
    if (c.act && t >= c.act.start && t < c.act.start + c.act.dur) {
      anim = c.act.name; at = (t - c.act.start) * 1.3 / spd(); loop = false;
      if (anim === 'Attack') { const k = Math.sin(Math.PI * (t - c.act.start) / c.act.dur) * 7; cx += DIRS[c.dir][0] * k; cy += DIRS[c.dir][1] * k; }
    } else if (c.hurtAt && t >= c.hurtAt && t < c.hurtAt + 260) { anim = 'Hurt'; at = t - c.hurtAt; loop = false; }
    else if (v.walking) { anim = 'Walk'; }
    else if (c.status === 'slp') { anim = 'Sleep'; }
    let alpha = 1;
    if (c.dead) alpha = clamp(1 - (t - c.deadAt) / 350, 0, 1);
    else if (c.charging && c.charging.invuln) alpha = 0.3;   // 구멍파기·다이빙·공중날기 등으로 숨은 동안 (v1.10): 흐리게
    const flash = c.hurtAt && t >= c.hurtAt && t < c.hurtAt + 120;
    // 새 그림(모습 바꾸기·이로치·메가진화)을 받는 동안은 회색 공 대신: 직전에 그리던 그림 → 같은 모습의 보통 색 → 원래 모습
    let look = looksOf(c), sh = !!c.shiny;
    if (Sprites.ready(look, sh)) c.drawnLook = [look, sh];
    else [look, sh] = (c.drawnLook && Sprites.ready(...c.drawnLook) && c.drawnLook) || (sh && Sprites.ready(look, false) && [look, false])
      || (look !== c.sp && Sprites.ready(c.sp, sh) && [c.sp, sh]) || [look, sh];
    Sprites.draw(ctx, look, anim, c.dir, at, loop, cx, cy, alpha, flash, sh);
    if (c.shiny && !c.dead && Math.floor(t / 180 + c.id * 10) % 6 === 0) { ctx.fillStyle = '#fff6a0'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('✦', cx - 10, cy - 12); }
    if (c.ally && !c.dead) { ctx.fillStyle = '#6cf'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('▼', cx, cy - 18); }
    if (!c.dead && (c.player || c.ally || c.hp < c.maxhp)) {   // 리더·동료는 늘, 적은 다쳤을 때만
      ctx.fillStyle = '#000a'; ctx.fillRect(cx - 10, cy + 10, 20, 3);
      const hr = shownHp(c, t) / c.maxhp;
      ctx.fillStyle = hr > 0.5 ? '#5f5' : hr > 0.2 ? '#fd4' : '#f55';
      ctx.fillRect(cx - 10, cy + 10, 20 * hr, 3);
    }
    if (c.npc && c.mission) { ctx.fillStyle = '#ffe066'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('SOS', cx, cy - 18); }
    if (c.shopkeeper) { ctx.fillStyle = '#ffe066'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('상점', cx, cy - 20); }
    if (c.boss && !c.dead) { ctx.fillStyle = '#ff5a5a'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('BOSS', cx, cy - 22); }
    if (c.outlaw) { ctx.fillStyle = '#ff5a5a'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('WANTED', cx, cy - 20); }
    // 머리 위 표시: 상태 이상 · 랭크 업(칼) · 랭크 다운(화살표) · 벽(방패) · HP 적음(느낌표, 우리 편만). 여러 개면 원작처럼 번갈아 (얼음은 늘 덮는다)
    if (!c.dead) {
      const marks = [];
      if (c.status === 'frz') Gfx.drawStatus(ctx, 'frz', cx, cy, t, c.id); else if (c.status) marks.push(c.status);
      const st = Object.values(c.stages || {});
      if (st.some(v => v > 0)) marks.push('up');
      if (st.some(v => v < 0)) marks.push('down');
      if (c.reflectT || c.screenT) marks.push('wall');
      if ((c.player || c.ally) && c.hp > 0 && c.hp <= c.maxhp / 4) marks.push('low');
      const mk = marks.length ? marks[Math.floor((t + (c.id || 0) * 97) / 1400) % marks.length] : null;
      if (mk && !Gfx.drawStatus(ctx, mk, cx, cy, t, c.id)) {   // 그림이 없으면 (마비 등) 글자로
        const ic = { psn: '☠', brn: '🔥', par: '⚡', slp: 'z', cnf: '?', up: '▲', down: '▼', wall: '🛡', low: '!' }[mk];
        if (ic) { ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText(ic, cx + 9, cy - 10); }
      }
    }
  }

  // 대기 중인 프롬프트 / 자동 행동 (렌더와 분리해서 탭이 가려져도 진행)
  function logicTick() {
    if (!D || busy() || UI.isOpen()) return;
    if (D.prompts.length) D.prompts.shift()();
    else if (D.auto) autoTick();
    else if (pendingKey) { const k = pendingKey; pendingKey = null; handleKey(k); }
    else if (heldMove.size && !turnHeld.size && !moveTimer && performance.now() - moveHeldAt >= HOLD_WALK_MS) { const d = heldDir(); if (d != null) handleKey({ dir: d }); }   // 방향 키를 누르고 있으면 걷기가 끝나는 대로 다음 칸 (OS 키 반복을 기다리지 않는다)
  }

  // 화면 세로 중심 (캔버스 좌표). 휴대폰은 위의 상태 창과 아래 메시지 창이 화면을 가리므로, 그 사이 보이는 곳의 가운데에 캐릭터를 둔다
  const narrowMQ = matchMedia('(max-width: 800px)');
  let camCYv = null, camCYat = -1e9;
  function camCY(H) {
    // 휴대폰 가로 화면: 아래쪽에 기술·메시지·패드가 겹치므로 캐릭터를 조금 위에 둔다
    if (document.body.classList.contains('phone-land')) { if (mini.style.top) mini.style.top = ''; return Math.round(H * 0.42); }
    if (!narrowMQ.matches) { if (mini.style.top) mini.style.top = ''; return H / 2; }
    const n = performance.now();
    if (n - camCYat > 250) {
      camCYat = n; camCYv = null;
      const cr = canvas.getBoundingClientRect(), hud = document.getElementById('hud').getBoundingClientRect(), lg = document.getElementById('log').getBoundingClientRect();
      if (cr.height > 0) {
        const top = Math.max(0, hud.bottom - cr.top), bot = Math.min(cr.height, lg.top - cr.top);
        if (bot - top > 60) camCYv = (top + bot) / 2 * canvas.height / cr.height;
        mini.style.top = Math.max(8, Math.round(hud.bottom - cr.top + 6)) + 'px';   // 미니맵은 상태 창 바로 아래 오른쪽
      }
    }
    return camCYv ?? H / 2;
  }

  function render() {
    rafId = requestAnimationFrame(render);
    if (!D) return;
    const t = now();
    const wrap = canvas.parentElement;
    // 게임 화면 확대 배율: 설정에서 고를 수 있다 (v0.89, 자동은 넓은 화면 3배·그 밖 2배)
    const vs = +Game.save.settings.viewScale || 0;
    const scale = vs || (wrap.clientWidth >= 1000 && wrap.clientHeight >= 620 ? 3 : 2);
    const W = Math.ceil(wrap.clientWidth / scale), H = Math.ceil(wrap.clientHeight / scale);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; ctx.imageSmoothingEnabled = false; }
    const p = P(), pv = vpos(p, t);
    const ox = Math.round(pv.x * TILE + TILE / 2 - W / 2), oy = Math.round(pv.y * TILE + TILE / 2 - camCY(H));
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(D.mapCanvas, -ox, -oy);
    // 안개: 지금 안 보이는 곳은 어둡게, 안 가 본 곳은 더 어둡게 (적·아이템·계단은 가 보기 전에는 그리지 않는다)
    const unseenFog = Game.save.settings.hideUnexplored ? '#000' : 'rgba(0,0,0,0.72)';
    const x0 = Math.max(0, Math.floor(ox / TILE)), y0 = Math.max(0, Math.floor(oy / TILE));
    const x1 = Math.min(D.w - 1, Math.ceil((ox + W) / TILE)), y1 = Math.min(D.h - 1, Math.ceil((oy + H) / TILE));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = idx(x, y);
      if (!D.explored[i]) { ctx.fillStyle = unseenFog; ctx.fillRect(x * TILE - ox, y * TILE - oy, TILE, TILE); }   // 안 가 본 곳: 반투명 (v0.100, 설정에서 완전히 가릴 수 있다)
      else if (!D.visible[i]) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x * TILE - ox, y * TILE - oy, TILE, TILE); }
    }
    // 바깥 영역
    if (ox < 0) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, -ox, H); }
    if (oy < 0) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, -oy); }
    // 계단
    const s = D.stairs;
    if (!D.stairsHidden && D.explored[idx(s.x, s.y)]) {
      const sx = s.x * TILE - ox, sy = s.y * TILE - oy;
      if (!Gfx.drawStairs(ctx, STAIRS_UP.has(D.dg.id), sx, sy)) {   // 원작 계단 그림 (탑·산은 올라가는 계단). 못 받았으면 직접 그린 계단
        ctx.fillStyle = '#1b1b2a'; ctx.fillRect(sx + 2, sy + 2, TILE - 4, TILE - 4);
        ctx.fillStyle = '#e8e2c8';
        for (let k = 0; k < 4; k++) ctx.fillRect(sx + 4 + k * 2, sy + 5 + k * 4, TILE - 8 - k * 4, 2);
      }
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // 상점 카펫
    if (D.shop) for (const i of D.shop.tiles) {
      if (!D.explored[i]) continue;
      const x = (i % D.w) * TILE - ox, y = ((i / D.w) | 0) * TILE - oy;
      ctx.fillStyle = 'rgba(150,40,60,0.55)'; ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
      ctx.strokeStyle = 'rgba(255,215,120,0.6)'; ctx.strokeRect(x + 3.5, y + 3.5, TILE - 7, TILE - 7);
    }
    // 함정
    for (const tr of D.traps) {
      if (!tr.seen || !D.explored[idx(tr.x, tr.y)]) continue;
      const x = tr.x * TILE - ox, y = tr.y * TILE - oy;
      if (Gfx.drawTrap(ctx, tr.kind, x, y)) continue;   // 원작 함정 그림 (없으면 아래 이모지)
      ctx.fillStyle = 'rgba(20,10,30,0.7)'; ctx.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
      ctx.font = '11px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(TRAPS[tr.kind].icon, x + TILE / 2, y + TILE / 2 + 1);
    }
    // 아이템
    for (const it of D.items) {
      if (!D.explored[idx(it.x, it.y)]) continue;
      const cx = it.x * TILE + TILE / 2 - ox, cy = it.y * TILE + TILE / 2 - oy;
      if (Gfx.drawItem(ctx, it, cx, cy)) {}   // 원작 아이템 그림 (없는 아이템·못 불러왔으면 아래 이모지)
      else if (it.money) {
        ctx.fillStyle = '#f5c542'; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 7); ctx.fill();
        ctx.fillStyle = '#b8860b'; ctx.beginPath(); ctx.arc(cx + 3, cy + 3, 4, 0, 7); ctx.fill();
      } else { ctx.font = '13px sans-serif'; ctx.fillText(ITEMS[it.id].icon, cx, cy + 1); }
      if (it.price) {
        ctx.font = 'bold 7px sans-serif'; ctx.fillStyle = '#000'; ctx.fillText('₽' + it.price, cx + 1, cy + 10);
        ctx.fillStyle = '#ffe066'; ctx.fillText('₽' + it.price, cx, cy + 9);
      }
    }
    // 방향 전환 중 (v0.101): 리더 둘레에 격자를 깔고 바라보는 칸을 표시 (키보드 Shift·컨트롤러·터치 ↻)
    const turning = turnHeld.size || turnSrc.size;
    if (turning) drawTurnGrid(p, t, ox, oy);
    // 포켓몬
    const list = [...D.mons.filter(m => seen(m) || (m.tween && t < m.tween.start + m.tween.dur && D.visible[idx(m.tween.fx, m.tween.fy)])), ...D.corpses, p];
    list.sort((a, b) => vpos(a, t).y - vpos(b, t).y);
    for (const c of list) if (c.hp > 0 || c.dead || c.player) drawCreature(c, t, ox, oy);
    D.corpses = D.corpses.filter(c => t < c.deadAt + 400);
    // 이펙트
    for (const f of D.fx) {
      if (t < f.at) continue;
      const k = (t - f.at) / f.dur; if (k > 1) continue;
      if (f.kind === 'proj') {
        const x = (f.x0 + (f.x1 - f.x0) * k) * TILE + TILE / 2 - ox, y = (f.y0 + (f.y1 - f.y0) * k) * TILE + TILE / 2 - oy;
        if (f.icon) { ctx.font = '12px sans-serif'; ctx.fillText(f.icon, x, y); }
        else { ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(x, y - 4, 4, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y - 4, 2, 0, 7); ctx.fill(); }
      } else if (f.kind === 'ring') {
        ctx.strokeStyle = f.color; ctx.globalAlpha = 1 - k; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(f.x * TILE + TILE / 2 - ox, f.y * TILE + TILE / 2 - oy, 6 + k * 60, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    D.fx = D.fx.filter(f => t < f.at + f.dur);
    drawWeather(t, W, H);
    if (D.boss && !D.boss.dead && D.boss.metPlayer) {
      const b = D.boss, bw = Math.min(200, W - 40), bx = (W - bw) / 2, by = 8;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx - 4, by - 2, bw + 8, 18);
      ctx.fillStyle = '#511'; ctx.fillRect(bx, by + 10, bw, 4);
      ctx.fillStyle = '#ff5a5a'; ctx.fillRect(bx, by + 10, bw * shownHp(b, t) / b.maxhp, 4);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(`BOSS ${spName(looksOf(b))} Lv${b.lv}`, W / 2, by + 8);
    }
    // 데미지 숫자
    ctx.font = 'bold 11px "Galmuri11", sans-serif';
    for (const pp of D.popups) {
      if (t < pp.at) continue;
      const k = (t - pp.at) / 750;
      const x = pp.x * TILE + TILE / 2 - ox, y = pp.y * TILE - oy - k * 14;
      ctx.globalAlpha = clamp(1.4 - k * 1.4, 0, 1);
      ctx.font = pp.size === 'big' ? 'bold 15px "Galmuri11", sans-serif' : pp.size === 'small' ? '9px "Galmuri11", sans-serif' : 'bold 11px "Galmuri11", sans-serif';
      ctx.fillStyle = '#000'; ctx.fillText(pp.text, x + 1, y + 1);
      ctx.fillStyle = pp.color; ctx.fillText(pp.text, x, y);
      ctx.globalAlpha = 1;
    }
    D.popups = D.popups.filter(pp => t < pp.at + 750);
    drawMini();
    updateHud(t);
  }

  function drawWeather(t, W, H) {
    const w = weatherNow(); if (!w) return;
    ctx.save();
    if (w === 'sun') { ctx.fillStyle = 'rgba(255,190,70,0.10)'; ctx.fillRect(0, 0, W, H); }
    if (w === 'fog') { ctx.fillStyle = 'rgba(200,205,215,0.22)'; ctx.fillRect(0, 0, W, H); }
    if (w === 'sand') { ctx.fillStyle = 'rgba(190,150,80,0.16)'; ctx.fillRect(0, 0, W, H); }
    if (w === 'snow') { ctx.fillStyle = 'rgba(220,235,255,0.08)'; ctx.fillRect(0, 0, W, H); }
    const n = { rain: 70, snow: 60, sand: 50, fog: 0, sun: 0 }[w];
    for (let i = 0; i < n; i++) {
      const s1 = (i * 7919) % 1000 / 1000, s2 = (i * 104729) % 1000 / 1000;
      if (w === 'rain') {
        const x = (s1 * W + t * 0.12) % W, y = (s2 * H + t * 0.45) % H;
        ctx.strokeStyle = 'rgba(170,200,255,0.55)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 9); ctx.stroke();
      } else if (w === 'snow') {
        const x = (s1 * W + Math.sin(t / 900 + i) * 8 + t * 0.01) % W, y = (s2 * H + t * 0.03) % H;
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x, y, 2, 2);
      } else if (w === 'sand') {
        const x = (s1 * W + t * 0.2) % W, y = (s2 * H + Math.sin(t / 500 + i) * 5 + H) % H;
        ctx.fillStyle = 'rgba(220,180,110,0.6)'; ctx.fillRect(x, y, 2, 1);
      }
    }
    ctx.restore();
  }

  // 큰 지도: N 키 / 미니맵 클릭. 큰 지도에서 가 본 곳을 누르면 그곳으로 이동
  let bigMap = false;
  function toggleMap(on = !bigMap) {
    if (!D) return;
    bigMap = on;
    if (on) stopAuto();
    mini.classList.toggle('big', on);
    document.getElementById('map-legend').classList.toggle('on', on);
  }
  function onMiniClick(e) {
    if (!D) return;
    if (!bigMap) { toggleMap(true); return; }
    const r = mini.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * D.w), y = Math.floor((e.clientY - r.top) / r.height * D.h);
    toggleMap(false);
    const p = P();
    if (inb(x, y) && D.explored[idx(x, y)] && floorAt(x, y) && !(x === p.x && y === p.y) && !busy()) startAuto('travel', { x, y });
  }
  function drawMini() {
    const S = bigMap ? 9 : 3;
    if (mini.width !== D.w * S) { mini.width = D.w * S; mini.height = D.h * S; }
    mctx.clearRect(0, 0, mini.width, mini.height);
    if (bigMap) { mctx.fillStyle = '#081026'; mctx.fillRect(0, 0, mini.width, mini.height); }
    // 가 본 바닥 둘레의 벽을 어둡게 칠하고, 바닥과 벽 사이에 밝은 선을 그어 길 모양이 잘 보이게 한다
    const seenFloor = (x, y) => inb(x, y) && D.explored[idx(x, y)] && openAt(x, y);   // 웅덩이도 길처럼 (색만 다르게)
    mctx.fillStyle = bigMap ? '#1c2748' : 'rgba(6,12,32,0.75)';
    for (let y = 0; y < D.h; y++) for (let x = 0; x < D.w; x++) {
      if (openAt(x, y)) continue;
      let near = false; for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (seenFloor(x + dx, y + dy)) { near = true; break; }
      if (near) mctx.fillRect(x * S, y * S, S, S);
    }
    mctx.fillStyle = bigMap ? 'rgb(84,120,190)' : 'rgba(120,170,255,0.6)';
    for (let y = 0; y < D.h; y++) for (let x = 0; x < D.w; x++) if (seenFloor(x, y)) { const lq = liquidAt(x, y); mctx.fillStyle = lq === 3 ? 'rgba(255,120,60,0.85)' : lq === 2 ? 'rgba(60,140,255,0.9)' : bigMap ? 'rgb(84,120,190)' : 'rgba(120,170,255,0.6)'; mctx.fillRect(x * S, y * S, S, S); }
    mctx.fillStyle = bigMap ? '#cfe0ff' : 'rgba(225,236,255,0.95)';
    const L = bigMap ? 2 : 1;
    for (let y = 0; y < D.h; y++) for (let x = 0; x < D.w; x++) {
      if (!seenFloor(x, y)) continue;
      if (!openAt(x, y - 1)) mctx.fillRect(x * S, y * S, S, L);
      if (!openAt(x, y + 1)) mctx.fillRect(x * S, y * S + S - L, S, L);
      if (!openAt(x - 1, y)) mctx.fillRect(x * S, y * S, L, S);
      if (!openAt(x + 1, y)) mctx.fillRect(x * S + S - L, y * S, L, S);
    }
    const s = D.stairs;
    if (!D.stairsHidden && D.explored[idx(s.x, s.y)]) { mctx.fillStyle = '#fff'; mctx.fillRect(s.x * S - 1, s.y * S - 1, S + 2, S + 2); mctx.fillStyle = '#39f'; mctx.fillRect(s.x * S, s.y * S, S, S); }
    const team = [P(), ...allies()], pa = { frisk: team.some(m => abilityOf(m).frisk), forewarn: team.some(m => abilityOf(m).forewarn) };   // 통찰·예지몽: 탐험대 누구든
    if (heldOf(P()).xray || D.radar) { pa.frisk = true; pa.forewarn = true; }
    for (const it of D.items) if (D.explored[idx(it.x, it.y)] || pa.frisk) { mctx.fillStyle = it.id === 'quest' ? '#f0f' : it.money ? '#fc3' : '#3fc'; mctx.fillRect(it.x * S, it.y * S, S, S); }
    for (const tr of D.traps) if (tr.seen) { mctx.fillStyle = tr.kind === 'reset' ? '#5f5' : '#f80'; mctx.fillRect(tr.x * S, tr.y * S, S, S); }
    for (const m of D.mons) if (seen(m) || (pa.forewarn && !m.npc)) { mctx.fillStyle = m.npc ? '#ff0' : m.ally ? '#6cf' : '#f44'; mctx.fillRect(m.x * S - 0.5, m.y * S - 0.5, S + 1, S + 1); }
    const p = P(); mctx.fillStyle = '#ff0'; mctx.fillRect(p.x * S - 1, p.y * S - 1, S + 2, S + 2);
    if (bigMap) { mctx.strokeStyle = '#000'; mctx.lineWidth = 2; mctx.strokeRect(p.x * S - 1, p.y * S - 1, S + 2, S + 2); }
  }

  // 턴이 정해진 효과 (상태 창에 아이콘과 남은 턴으로): 리플렉터·빛의장막은 좋은 것, 도발·하품·씨뿌리기는 나쁜 것
  const timedEffects = c => [c.reflectT && ['🛡', '리플렉터', c.reflectT, 'good'], c.screenT && ['✨', '빛의장막', c.screenT, 'good'],
    c.tauntT && ['💢', '도발', c.tauntT, 'bad'], c.yawnT && ['🥱', '하품', c.yawnT, 'bad'], c.seeded && ['🌱', '씨뿌리기', c.seeded.t, 'bad']].filter(Boolean);
  const effKey = c => timedEffects(c).map(e => e[0] + e[2]).join('');
  const DANGER_HP = 0.25;   // 위험 신호: 최대 HP의 이 비율 이하
  function updateHud(t) {
    const p = P(), dg = D.dg;
    const php = shownHp(p, t), ahp = a => (a.fainted ? 0 : shownHp(a, t));
    const pt = (run.party || []).map(a => `${a.sp}:${a.lv}:${ahp(a)}:${a.maxhp}:${a.fainted ? 1 : 0}:${a.status}:${a.fainted ? '' : effKey(a)}`).join(',');
    const hud = `${pt}|${p.held}|${weatherRaw()}|${D.terrain}${D.terrainT}|${dg.n}|${run.floor}|${p.lv}|${php}|${p.maxhp}|${Math.ceil(p.belly)}|${Game.save.money}|${run.money}|${p.status}|${p.exp}|${JSON.stringify(p.stages)}|${JSON.stringify(p.stageS || {})}|${effKey(p)}`;
    if (hud !== hudCache) {
      hudCache = hud;
      const hpPct = php / p.maxhp * 100;
      // 위험 신호 (v0.100): HP DANGER_HP 이하·배고픔 0이면 HUD 칸과 던전 화면 UI 상자들의 테두리가 빨갛게 깜빡인다 (설정에서 끌 수 있다)
      const blink = !Game.save.settings.noDangerBlink, lowHp = blink && php > 0 && hpPct <= DANGER_HP * 100, starving = blink && p.belly <= 0;
      document.getElementById('dungeon-screen').classList.toggle('danger', lowHp || starving);
      const need = expFor(p.lv + 1) - expFor(p.lv), have = p.exp - expFor(p.lv);
      // 랭크 변화: 넓은 화면은 이름 그대로, 휴대폰은 줄임말 (css .sl / .ss)
      const effs = timedEffects(p).map(([i, n, tl, k]) => `<span class="eff ${k}" title="${n} ${tl}턴 남음">${i}${n} ${tl}</span>`).join(' ');
      const stg = Object.entries(p.stages).filter(([, v]) => v).map(([k, v]) => `<span class="${v > 0 ? 'up' : 'down'}" title="${STAT_NAMES[k]} ${(p.stageS?.[k]?.t || [p.stageT?.[k] || 0]).slice().sort((a, b) => a - b).join(' · ')}턴 남음 (랭크마다 따로)"><i class="sl">${STAT_NAMES[k]}</i><i class="ss">${STAT_SHORT[k]}</i>${v > 0 ? '+' : ''}${v}</span>`).join(' ');
      document.getElementById('hud').innerHTML = `
        <span class="floor">${run.hard ? '☠ ' : ''}${esc(dg.n)} <b>${run.floor}F</b>${weatherRaw() ? ` <span class="wx" title="${esc(WEATHERS[weatherRaw()].d)}">${WEATHERS[weatherRaw()].icon} ${WEATHERS[weatherRaw()].n}</span>` : ''}${D.terrain ? ` <span class="wx" title="${esc(TERRAINS[D.terrain].d)}">${TERRAINS[D.terrain].icon} ${TERRAINS[D.terrain].n} <small>${D.terrainT}</small></span>` : ''}${dg.mode === 'rogue' ? ' <i class="rogue">로그라이크</i>' : ''}</span>
        <span class="lvl">Lv <b>${p.lv}</b> <span class="exp" title="다음 레벨까지 경험치"><span class="bar small"><i style="width:${p.lv >= lvCap() ? 100 : clamp(have / need * 100, 0, 100)}%;background:#6cf"></i></span></span></span>
        <span class="hpwrap${lowHp ? ' danger' : ''}">HP <b>${php}</b>/${p.maxhp}<span class="bar"><i style="width:${hpPct}%;background:${hpPct > 50 ? '#4de36b' : hpPct > 20 ? '#f5d142' : '#f55'}"></i></span></span>
        <span class="belly${starving ? ' danger' : ''}">배 <b class="${p.belly <= 20 ? 'warn' : ''}">${Math.ceil(p.belly)}</b>/100</span>
        ${p.held ? `<span class="held" title="${esc(ITEMS[p.held].d)}">${ITEMS[p.held].icon} ${esc(ITEMS[p.held].n)}${sigTag(p.held)}</span>` : ''}
        ${p.status || stg ? `<span class="stgs">${p.status ? `<span class="st">${STATUS_NAMES[p.status]}</span> ` : ''}${stg ? `<span class="sgrid">${stg}</span>` : ''}</span>` : ''}
        ${effs ? `<span class="effs">${effs}</span>` : ''}
        ${(run.party || []).length ? `<span class="party">${run.party.map(a => { const pc = ahp(a) / a.maxhp * 100; return `<span class="pm${a.fainted ? ' out' : ''}" title="${esc(spName(a.sp))} Lv${a.lv} HP ${ahp(a)}/${a.maxhp}${a.status ? ' · ' + STATUS_NAMES[a.status] : ''}"><span class="pmn">${esc(spName(a.sp))}</span>${a.fainted ? '' : timedEffects(a).map(([i, n, tl]) => `<i class="peff" title="${n} ${tl}턴">${i}</i>`).join('')} <span class="bar small"><i style="width:${pc}%;background:${pc > 50 ? '#4de36b' : pc > 20 ? '#f5d142' : '#f55'}"></i></span></span>`; }).join('')}</span>` : ''}
        <span class="money" title="쓰러지면 이번 탐험에서 주운 돈(괄호 안)을 잃습니다">₽ <b>${Game.save.money}</b>${run.money ? ` <span class="run-money">(이번 탐험 +${run.money})</span>` : ''}</span>`;
    }
    const mv = p.moves.map(m => m.id + ':' + m.pp + ':' + m.max).join(',');
    if (mv !== moveCache) {
      moveCache = mv;
      document.getElementById('moves').innerHTML = p.moves.map((m, i) => {
        const d = DATA.moves[m.id];
        return `<button class="mv${m.pp <= 0 ? ' empty' : ''}${moveOff(P(), m.id) ? ' auto-off' : ''}" data-slot="${i}" style="--tc:${TYPE_COLORS[d.t - 1]}" title="${esc(d.n)} (${typeName(d.t)} · ${['', '변화', '물리', '특수'][d.c]}${d.p ? ' · 위력 ' + d.p : ''})">
          <span class="k">${i + 1}</span><span class="n">${esc(d.n)}${masteryLevel(p.sp, m.id) ? `<i class="mastery">★${masteryLevel(p.sp, m.id)}</i>` : ''}</span><span class="p">${m.pp}/${m.max}</span><span class="info" data-move="${m.id}" data-pp="${m.pp}" data-max="${m.max}" data-sp="${p.sp}" title="기술 정보">?</span></button>`;
      }).join('');
    }
    const qid = Game.save.settings.quickItem, qn = qid ? run.bag.filter(b => b.id === qid).reduce((s, b) => s + b.n, 0) + (p.held === qid ? 1 : 0) : 0;
    const qk = (qid || '') + ':' + qn + ':' + (p.held === qid);
    if (qk !== quickCache) {
      quickCache = qk;
      const qb = document.querySelector('#actions [data-k=quick]');
      if (qb) { qb.innerHTML = qid && ITEMS[qid] ? `${ITEMS[qid].icon}×${qn} <kbd>T</kbd>` : '⭐ 빠른사용 <kbd>T</kbd>'; qb.title = qid && ITEMS[qid] ? `${ITEMS[qid].n} 바로 ${quickVerb(qid)} (T)` : '가방에서 아이템을 골라 "빠른 사용"으로 등록하세요'; qb.classList.toggle('empty', !!qid && !qn); }
    }
    const shown = LOG.filter(l => l.at <= t).slice(-5);
    const lg = shown.map(l => l.text + (l.cls || '')).join('\n') + shown.length;
    if (lg !== logCache) {
      logCache = lg;
      const el = document.getElementById('log');
      el.innerHTML = shown.map(l => `<div${l.cls ? ` class="${l.cls}"` : ''}>${esc(l.text)}</div>`).join('');
      // 긴 메시지가 줄바꿈되어 넘치면 위쪽(오래된) 줄을 통째로 뺀다 (반쯤 잘린 줄이 보이지 않게)
      const cs = getComputedStyle(el), avail = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      while (el.children.length > 1 && [...el.children].reduce((h, c) => h + c.offsetHeight, 0) > avail + 1) el.firstElementChild.remove();
    }
    updateFace(t);
    const WD = windOf(D.dg), wl = run.turnsOnFloor >= WD.warn[0] ? WD.warn.filter(w => run.turnsOnFloor >= w).length : 0;
    const wind = document.getElementById('wind-ind');
    const wtxt = wl ? ['', '🌬 바람', '🌬🌬 강한 바람', '🌬🌬🌬 거센 바람'][wl] : '';
    if (wind.textContent !== wtxt) { wind.textContent = wtxt; wind.className = 'wl' + wl; }
    document.getElementById('auto-ind').textContent = D.auto ? ({ explore: '자동 탐색 중…', travel: '이동 중…', rest: '휴식 중…', fight: '' }[D.auto.kind]) : '';
  }

  let bannerTimer = 0;
  function showFloorBanner(text) {
    const b = document.getElementById('floor-banner');
    b.textContent = text; b.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.remove('show'), 1100);
    T.busyUntil = now() + 500;
  }

  // ───────────────────────── 입력 ─────────────────────────
  // 상하좌우 키를 누르면 잠깐(DIAG_WAIT) 기다렸다가 움직인다: 그 사이 다른 방향 키가 눌리면 대각선 (두 키를 동시에 누르기 쉽게)
  const DIAG_WAIT = 50;
  // 키보드 이동 (v0.102 보강): 누르고 있으면 HOLD_WALK_MS 뒤부터는 걷는 연출이 끝나는 대로 바로 다음 칸 (예전에는 OS 키 반복 지연(약 0.5초)만큼 멈칫했다)
  const HOLD_WALK_MS = 180;
  let moveHeldAt = 0;
  const heldMove = new Map();   // 눌려 있는 상하좌우 키 → 방향
  const turnHeld = new Set();   // 눌려 있는 '방향만 바꾸기' 키 (기본 Shift)
  const turnSrc = new Set();    // 방향 전환 중인 다른 조작 (dpad·vp: 터치 ↻, gp: 컨트롤러) — 격자를 보여 준다
  const TURN_GRID_R = 2;        // 격자 반경 (칸)
  function drawTurnGrid(p, t, ox, oy) {
    const v = vpos(p, t), [dx, dy] = DIRS[p.dir];
    ctx.save();
    for (let yy = -TURN_GRID_R; yy <= TURN_GRID_R; yy++) for (let xx = -TURN_GRID_R; xx <= TURN_GRID_R; xx++) {
      const gx = p.x + xx, gy = p.y + yy, front = xx === dx && yy === dy;
      if (!openAt(gx, gy) && !front) continue;   // 바라보는 칸은 벽이어도 표시 (어느 쪽을 보는지 알 수 있게)
      const sx = Math.round((v.x + xx) * TILE - ox), sy = Math.round((v.y + yy) * TILE - oy);
      if (front) { ctx.fillStyle = 'rgba(255,70,40,0.38)'; ctx.fillRect(sx, sy, TILE, TILE); }
      ctx.strokeStyle = front ? '#ffffff' : 'rgba(255,255,255,0.4)'; ctx.lineWidth = front ? 2 : 1;
      ctx.strokeRect(sx + (front ? 1 : 0.5), sy + (front ? 1 : 0.5), TILE - (front ? 2 : 1), TILE - (front ? 2 : 1));
    }
    ctx.restore();
  }
  let moveTimer = null, moveFallback = null;
  const keyAct = code => keyActionMap((Game.save && Game.save.settings && Game.save.settings.keys) || {})[code];
  function heldDir() {
    let dx = 0, dy = 0;
    for (const d of heldMove.values()) { dx += DIRS[d][0]; dy += DIRS[d][1]; }
    dx = Math.sign(dx); dy = Math.sign(dy);
    return dx || dy ? dirIndex(dx, dy) : null;
  }
  function sendKey(k) { if (!D) return; if (busy()) pendingKey = k; else handleKey(k); }
  function onKeyDown(e) {
    if (!D) return;
    // 키로 연 창은 같은 키를 다시 누르면 닫는다 (v1.10). 그 창에서 더 연 창(가방의 아이템 메뉴 등)도 함께
    if (winKey && UI.isOpen() && UI.top() !== winKey.before && keyAct(e.code) === winKey.a && !e.ctrlKey && !e.metaKey && !e.altKey) {
      while (UI.isOpen() && UI.top() !== winKey.before) UI.close(UI.top());
      winKey = null; e.preventDefault(); return;
    }
    if (UI.key(e)) return;
    // Ctrl·Alt 조합은 브라우저 단축키로 둔다 (Ctrl+W 등)
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (bigMap) { toggleMap(false); e.preventDefault(); return; }
    if (D.auto) { stopAuto(); e.preventDefault(); return; }
    const a = keyAct(e.code);
    if (a === 'turn') { turnHeld.add(e.code); e.preventDefault(); return; }
    // 방향만 바꾸기 키를 누른 채로: 눌려 있는 방향 키를 합쳐 바로 돌아본다 (두 키면 대각선, 돌아보기는 턴을 쓰지 않는다)
    if (['up', 'down', 'left', 'right'].includes(a) && turnHeld.size) {
      e.preventDefault();
      heldMove.set(e.code, MOVE_ACTION_DIR[a]);
      sendKey({ dir: heldDir() ?? MOVE_ACTION_DIR[a], turn: true });
      return;
    }
    if (['up', 'down', 'left', 'right'].includes(a)) {
      e.preventDefault();
      if (e.repeat) return;   // 누르고 있는 동안은 logicTick이 걷는다
      if (!heldMove.size) moveHeldAt = performance.now();
      heldMove.set(e.code, MOVE_ACTION_DIR[a]);
      if (heldMove.size >= 2) { clearTimeout(moveTimer); moveTimer = null; sendKey({ dir: heldDir() ?? MOVE_ACTION_DIR[a] }); return; }
      clearTimeout(moveTimer); moveFallback = MOVE_ACTION_DIR[a];
      moveTimer = setTimeout(() => { moveTimer = null; sendKey({ dir: heldDir() ?? moveFallback }); }, DIAG_WAIT);
      return;
    }
    // 대각선 키(Q·E·Z·C·숫자패드 등, v0.102 보강): 상하좌우처럼 누르고 있으면 바로 이어서 걷는다 (기다리지 않고 바로 첫 칸)
    if (['upleft', 'upright', 'downleft', 'downright'].includes(a) && !turnHeld.size) {
      e.preventDefault();
      if (e.repeat) return;
      if (!heldMove.size) moveHeldAt = performance.now();
      heldMove.set(e.code, MOVE_ACTION_DIR[a]);
      clearTimeout(moveTimer); moveTimer = null;
      sendKey({ dir: heldDir() ?? MOVE_ACTION_DIR[a] }); return;
    }
    const k = { code: e.code, shift: e.shiftKey, turn: turnHeld.size > 0, key: e.key };
    if (busy()) { pendingKey = k; e.preventDefault(); return; }
    if (handleKey(k)) e.preventDefault();
  }
  function onKeyUp(e) { heldMove.delete(e.code); turnHeld.delete(e.code); }
  // 창을 여는 키: 다시 누르면 닫는다 (onKeyDown). before = 그 키를 누르기 전 맨 위의 창
  const WIN_KEY_ACTS = new Set(['bag', 'party', 'missions', 'status', 'log', 'help', 'menu', 'dginfo', 'quick']);
  let winKey = null;
  function handleKey(k) {
    if (!D || D.dead) return false;
    const a = k.dir != null ? null : keyAct(k.code);
    if (WIN_KEY_ACTS.has(a)) winKey = { a, before: UI.top() };
    const dir = k.dir != null ? k.dir : MOVE_ACTION_DIR[a];
    if (dir != null) {
      // 방향만 바꾸기 키(기본 Shift)+방향: 제자리에서 방향만 바꾼다
      if (k.turn) act({ t: 'face', dir });
      else act({ t: 'move', dir });
      return true;
    }
    if (k.key === '>') { tryStairs(); return true; }
    switch (a) {
      case 'attack': act({ t: 'attack' }); return true;
      case 'skill1': case 'skill2': case 'skill3': case 'skill4': {
        const slot = +a.slice(5) - 1;
        if (k.shift) { const m = P().moves[slot]; if (m) showMoveInfo(m.id, m.pp, m.max, P().sp); }
        else act({ t: 'skill', slot });
        return true;
      }
      case 'auto': startAuto('explore'); return true;
      case 'party': partyMenu(); return true;
      case 'fight': startAuto('fight'); return true;
      case 'rest': startAuto('rest'); return true;
      case 'wait': act({ t: 'wait' }); return true;
      case 'stairs': tryStairs(); return true;
      case 'bag': openBag(); return true;
      case 'menu': Game.dungeonMenu(); return true;
      case 'dginfo': Game.dungeonMenu('info'); return true;
      case 'help': showHelp(); return true;
      case 'missions': Game.showMissions(); return true;
      case 'map': toggleMap(true); return true;
      case 'look': toggleLook(); return true;
      case 'quick': quickUse(); return true;
      case 'status': showStatus(); return true;
      case 'log': showLog(); return true;
    }
    return false;
  }
  function tryStairs() {
    const p = P();
    if (D.stairsHidden) log('보스를 쓰러뜨려야 계단이 나타난다!', now());
    else if (D.stairs.x === p.x && D.stairs.y === p.y) stairsPrompt();
    else if (D.explored[idx(D.stairs.x, D.stairs.y)]) startAuto('travel', { x: D.stairs.x, y: D.stairs.y, toStairs: true });
    else log('아직 계단을 찾지 못했다.', now());
  }
  function onClick(e) {
    if (!D || UI.isOpen() || D.dead) return;
    if (D.lookNext) { D.lookNext = false; updateLookBtn(); lookAt(e); return; }
    if (D.auto) { stopAuto(); return; }
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * canvas.width / rect.width, sy = (e.clientY - rect.top) * canvas.height / rect.height;
    const t = now(), p = P(), pv = vpos(p, t);
    const ox = Math.round(pv.x * TILE + TILE / 2 - canvas.width / 2), oy = Math.round(pv.y * TILE + TILE / 2 - camCY(canvas.height));
    const tx = Math.floor((sx + ox) / TILE), ty = Math.floor((sy + oy) / TILE);
    if (!inb(tx, ty)) return;
    const dx = tx - p.x, dy = ty - p.y;
    if (dx === 0 && dy === 0) { if (!D.stairsHidden && D.stairs.x === p.x && D.stairs.y === p.y) stairsPrompt(); else act({ t: 'wait' }); return; }
    if (Math.max(Math.abs(dx), Math.abs(dy)) === 1) { act({ t: 'move', dir: dirIndex(dx, dy) }); return; }
    if (!D.explored[idx(tx, ty)] || !floorAt(tx, ty)) return;
    startAuto('travel', { x: tx, y: ty });
  }
  // 화면 좌표 → 칸
  function tileFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * canvas.width / rect.width, sy = (e.clientY - rect.top) * canvas.height / rect.height;
    const p = P(), pv = vpos(p, now());
    const ox = Math.round(pv.x * TILE + TILE / 2 - canvas.width / 2), oy = Math.round(pv.y * TILE + TILE / 2 - camCY(canvas.height));
    return { x: Math.floor((sx + ox) / TILE), y: Math.floor((sy + oy) / TILE) };
  }
  // 조사: 지금 보이는 포켓몬 목록 (화면 밖이라도 보이는 곳이면. 보스방의 보스 등) + 칸을 눌러 조사하기
  function toggleLook() {
    if (!D) return;
    if (D.lookNext) { D.lookNext = false; updateLookBtn(); return; }
    const p = P(), dist = c => Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y));
    const foes = D.mons.filter(c => c.hp > 0 && !c.dead && !c.ally && seen(c)).sort((a, b) => !!b.boss - !!a.boss || dist(a) - dist(b));
    const mine = [p, ...allies()];
    UI.open({
      title: '🔍 조사', wide: true,
      html: `<h3>보이는 포켓몬 <span class="dim">(${foes.length})</span></h3>${foes.map(creatureInfo).join('') || '<p class="dim">지금 보이는 포켓몬이 없다.</p>'}
        <h3>탐험대</h3>${mine.map(creatureInfo).join('')}
        <p class="dim">아이템·함정·바닥은 "칸 고르기"를 누른 뒤 화면의 칸을 누르면 조사할 수 있어요. (우클릭으로도 조사)</p>`,
      choices: [{ label: '칸 고르기 (화면의 칸을 눌러 조사)', fn: () => { D.lookNext = true; updateLookBtn(); log('조사할 칸을 누르세요.', now()); } }, { label: '닫기', fn: () => {} }],
    });
  }
  function updateLookBtn() { document.querySelector('#actions [data-k=look]')?.classList.toggle('on', !!(D && D.lookNext)); }
  function lookAt(e) {
    const { x, y } = tileFromEvent(e);
    if (!inb(x, y) || !D.explored[idx(x, y)]) { UI.alert('조사', '<p>아직 가 보지 않은 곳이라 알 수 없다.</p>'); return; }
    const vis = D.visible[idx(x, y)], rows = [];
    const c = vis ? creatureAt(x, y) : null;
    if (c) rows.push(creatureInfo(c));
    const it = itemAt(x, y);
    if (it && (vis || D.radar)) rows.push(it.money ? `<p>💰 ${it.money} 포켓</p>` : it.id === 'quest' ? '<p>📦 의뢰품</p>' : `<p>${ITEMS[it.id].icon} <b>${esc(ITEMS[it.id].n)}</b>${it.n > 1 ? ' ×' + it.n : ''}${it.price ? ` <span class="dim">(상품 ₽${it.price})</span>` : ''}<br><span class="dim">${esc(ITEMS[it.id].d)}</span></p>`);
    const tr = trapAt(x, y);
    if (tr && tr.seen) rows.push(`<p>${TRAPS[tr.kind].icon} <b>${esc(TRAPS[tr.kind].n)}</b><br><span class="dim">${esc(TRAPS[tr.kind].d)}</span></p>`);
    if (!D.stairsHidden && D.stairs.x === x && D.stairs.y === y) rows.push('<p>🪜 다음 층으로 가는 계단</p>');
    if (liquidAt(x, y)) rows.push(`<p>${LIQUIDS[liquidAt(x, y)].icon} ${LIQUIDS[liquidAt(x, y)].n} 웅덩이다. (${liquidAt(x, y) === 2 ? '물' : '불꽃'} 타입·비행 타입·부유 특성만 들어갈 수 있다)</p>`);
    else if (!floorAt(x, y)) rows.push('<p>벽이다.</p>');
    UI.alert('🔍 조사', rows.join('') || `<p>아무것도 없다.${vis ? '' : ' <span class="dim">(지금은 보이지 않는 곳)</span>'}</p>`);
  }
  // 능력치 (v1.02): 지닌 물건·증표·특성·혼자 탐험 보정까지 반영한 값 (원래 값은 괄호에). 능력 변화(랭크)는 따로
  function effStat(c, key) {
    const m = key === 'spe' ? (abVal(c, 'speedMul') || 1) * (heldOf(c).speedMul || 1) * (c.player && c.partners === 0 ? SOLO_STAT_MUL : 1) : statMul(c, key);
    return Math.abs(m - 1) < 0.001 ? `${c[key]}` : `${Math.floor(c[key] * m)} <span class="dim tiny">(${c[key]})</span>`;
  }
  const stageText = c => Object.entries(c.stages).filter(([, v]) => v).map(([k, v]) => `${STAT_NAMES[k] || k} ${v > 0 ? '+' : ''}${v}`).join(', ');
  function creatureInfo(c) {
    const st = stageText(c);
    return `<div class="row">${portraitImg(looksOf(c), 'portrait sm', 'Normal', c.shiny)}<div class="grow"><b>${esc(nm(c))}</b> Lv${c.lv} ${typeBadges(c.types)}
      <div>HP ${Math.max(0, c.hp)}/${c.maxhp}${c.status ? ` · <span class="warn">${STATUS_NAMES[c.status]}</span>` : ''}${c.boss ? ' · 👑 보스' : ''}${c.ally ? ' · 🤝 동료' : ''}</div>
      <div class="dim">특성 ${esc(abilityName(c.ability))}${c.item ? ` · 가진 아이템 ${ITEMS[c.item].icon}${esc(ITEMS[c.item].n)}` : ''}${c.held ? ` · 지닌 물건 ${esc(ITEMS[c.held].n)}` : ''}${st ? ` · 능력 변화 ${esc(st)}` : ''}</div></div></div>`;
  }
  // ── 2. 메시지 기록 / 내 상태
  // 쓰러졌을 때: 바로 끝내지 않고 마지막 메시지를 보여준다 (무엇에 맞고 쓰러졌는지)
  function faintReport() {
    const rows = LOG.slice(-25), end = () => Game.endRun('faint');
    UI.open({
      title: '💀 쓰러지고 말았다...', wide: true,
      html: `<p class="dim">쓰러지기 직전의 메시지</p><div class="log-history">${rows.map(l => `<div${l.cls ? ` class="${l.cls}"` : ''}>${esc(l.text)}</div>`).join('')}</div>`,
      choices: [{ label: '확인', fn: end }], cancel: end,
      onOpen: box => { const h = box.querySelector('.log-history'); if (h) h.scrollTop = h.scrollHeight; },
    });
  }
  // 메시지 기록 필터 (v0.92): 글로 분류한다 (먼저 맞는 쪽). 나머지는 전투
  const LOG_CATS = [['all', '전체'], ['battle', '⚔ 전투'], ['item', '🎒 아이템'], ['grow', '⭐ 성장'], ['ally', '🤝 동료·영입'], ['floor', '📜 층·임무']];
  const LOG_RULES = [
    ['grow', /레벨|배웠다|잊고|경험치|숙련도|진화|이로치/],
    ['ally', /동료|영입|아쉬운 듯 떠나|작전|탐험대에서 빠졌다|자리를 바꿨다/],
    ['item', /주웠다|주울 수|지니게|지녔다|가방|포켓|사용했다|던졌다|내려놓|손에 넣|샀다|팔았다|먹었다|배가|PP가|부활씨|열매|구슬|상점|켈리몬|의뢰품/],
    ['floor', /^— |임무|구조|의뢰|수배|계단|날씨|함정|탈출|층/],
  ];
  const logCat = text => (LOG_RULES.find(([, re]) => re.test(text)) || ['battle'])[0];
  let logFilter = 'all';
  function showLog() {
    if (!D) return;
    const t = now(), rows = LOG.filter(l => l.at <= t).slice(-300);
    UI.open({
      title: '💬 메시지 기록', wide: true,
      html: `<div class="dex-tabs log-tabs">${LOG_CATS.map(([k, n]) => `<button class="${logFilter === k ? 'on' : ''}" data-lf="${k}">${n}</button>`).join('')}</div>
        <input class="log-q" placeholder="글자로 찾기 (예: 이상해꽃, 효과가 굉장)" autocomplete="off">
        <div class="log-history">${rows.map(l => `<div data-c="${logCat(l.text)}"${l.cls ? ` class="${l.cls}"` : ''}>${esc(l.text)}</div>`).join('')}</div>
        <p class="dim log-none" hidden>조건에 맞는 메시지가 없다.</p>`,
      choices: [{ label: '닫기', fn: () => {} }],
      onOpen: box => {
        const h = box.querySelector('.log-history'), q = box.querySelector('.log-q'), none = box.querySelector('.log-none');
        const apply = () => {
          const w = q.value.trim();
          let n = 0;
          for (const el of h.children) { const ok = (logFilter === 'all' || el.dataset.c === logFilter) && (!w || el.textContent.includes(w)); el.hidden = !ok; if (ok) n++; }
          none.hidden = n > 0;
          box.querySelectorAll('[data-lf]').forEach(b => b.classList.toggle('on', b.dataset.lf === logFilter));
          h.scrollTop = h.scrollHeight;
        };
        box.querySelectorAll('[data-lf]').forEach(b => b.onclick = () => { logFilter = b.dataset.lf; apply(); });
        q.addEventListener('input', apply);
        q.addEventListener('keydown', e => e.stopPropagation());   // 글자 입력이 던전 조작키로 가지 않게
        apply();
      },
    });
  }
  // 상태 창: 리더와 동료 (위쪽 버튼으로 바꿔 본다)
  // 자동으로 쓰지 않을 기술 (v1.04 보강): 탐험대 상태 창에서 끈 기술은 자동 전투·동료 AI가 빼고 고른다 (직접 누르면 쓸 수 있다). 캐릭터 기록에 남는다
  const offList = c => (c && (c.player || c.ally) && !c.tf && Game.save.roster[c.rsp || c.sp]?.moveOff) || [];
  const moveOff = (c, id) => offList(c).includes(id);
  function toggleMoveOff(c, id) {
    const ch = Game.save.roster[c.rsp || c.sp]; if (!ch) return;
    const s = new Set(ch.moveOff || []); s.has(id) ? s.delete(id) : s.add(id);
    ch.moveOff = [...s]; if (!ch.moveOff.length) delete ch.moveOff;
    Game.persist(); moveCache = '';
  }
  function showStatus() {
    if (!D) return;
    const team = [P(), ...allies().filter(a => a.hp > 0)];
    const row = (k, a, b) => `<tr><td>${k}</td><td><b>${a}</b></td><td class="dim">${b || ''}</td></tr>`;
    const stg = (p, i) => p.stages[i] ? `(${p.stages[i] > 0 ? '+' : ''}${p.stages[i]}단계)` : '';
    const body = p => {
      const st = stageText(p), lead = p === P();
      const need = expFor(p.lv + 1) - expFor(p.lv), have = (p.exp || 0) - expFor(p.lv);
      return `<div class="row">${portraitImg(looksOf(p), 'portrait', 'Normal', p.shiny)}<div class="grow"><b>${esc(spName(looksOf(p)))}</b> Lv${p.lv} ${typeBadges(p.types)}
          <div>HP ${p.hp}/${p.maxhp}${lead ? ` · 배 ${Math.floor(p.belly)}/100` : ''}${p.status ? ` · <span class="warn">${STATUS_NAMES[p.status]}</span>` : ''}</div>
          <div class="dim">${lead ? `EXP ${p.lv >= lvCap() ? '최대' : `${have}/${need}`} · ₽ ${Game.save.money}${run.money ? ` (이번 탐험 +${run.money})` : ''} · ` : ''}특성 ${esc(abilityName(p.ability))} · 지닌 물건 ${p.held ? `${ITEMS[p.held].icon}${esc(ITEMS[p.held].n)}` : '없음'}</div></div></div>
        <table class="md-tbl">${row('공격', effStat(p, 'atk'), stg(p, 2))}${row('방어', effStat(p, 'def'), stg(p, 3))}
          ${row('특수공격', effStat(p, 'spa'), stg(p, 4))}${row('특수방어', effStat(p, 'spd'), stg(p, 5))}
          ${row('스피드', effStat(p, 'spe'), stg(p, 6))}</table>
        ${st ? `<p>능력 변화: ${esc(st)}</p>` : ''}
        ${timedEffects(p).length ? `<p>효과: ${timedEffects(p).map(([i, n, tl]) => `${i} ${n} <b>${tl}</b>턴 남음`).join(' · ')}</p>` : ''}
        <div class="cc-moves">${p.moves.map(m => `<div class="move-row st-mv${moveOff(p, m.id) ? ' off' : ''}"><span class="grow">${moveLine(m.id, m.pp, m.max)}</span>${p.tf ? '' : `<button class="btn sm ${moveOff(p, m.id) ? 'ghost' : ''} mv-auto" data-off="${m.id}" title="자동 전투·동료가 이 기술을 쓸지">${moveOff(p, m.id) ? '자동 OFF' : '자동 ON'}</button>`}</div>`).join('')}</div>
        <p class="dim tiny">자동 OFF인 기술은 자동 전투${lead ? '' : '와 동료'}가 쓰지 않아요${lead ? ' (직접 누르면 쓸 수 있어요)' : ''}. 캐릭터마다 기억해요.</p>
        ${lead && p.moves.length > 1 ? '<div class="btns"><button class="btn sm ghost" data-moveorder>🔀 기술 순서 바꾸기</button></div>' : ''}`;
    };
    const tabs = cur => team.length > 1 ? `<div class="btns st-tabs">${team.map((c, i) => `<button class="btn sm${c === cur ? '' : ' ghost'}" data-st="${i}">${i ? '' : '👑 '}${esc(spName(looksOf(c)))}</button>`).join(' ')}</div>` : '';
    UI.open({
      title: '📊 탐험대 상태', wide: true,
      html: `<div class="st-wrap">${tabs(team[0])}${body(team[0])}</div>`,
      onOpen: (box, m) => box.addEventListener('click', e => {
        if (e.target.closest('[data-moveorder]')) { UI.close(m); setTimeout(() => moveOrder(showStatus), 0); return; }
        const off = e.target.closest('[data-off]');
        if (off) { const c = team[+(box.querySelector('.st-tabs .btn:not(.ghost)')?.dataset.st || 0)]; toggleMoveOff(c, +off.dataset.off); box.querySelector('.st-wrap').innerHTML = tabs(c) + body(c); return; }
        const b = e.target.closest('[data-st]'); if (!b) return;
        const c = team[+b.dataset.st]; box.querySelector('.st-wrap').innerHTML = tabs(c) + body(c);
      }),
      choices: [{ label: '닫기', fn: () => {} }],
    });
  }

  // 던전 안에서 리더의 기술 순서 바꾸기 (v0.87): 위아래로 옮긴다. PP는 그대로, 마을의 캐릭터 기록과 이어하기 기록에도 바로 반영
  function moveOrder(back) {
    if (!D) return;
    stopAuto();
    const p = P();
    if (p.tf) { UI.alert('기술 순서', '<p>변신한 동안에는 기술 순서를 바꿀 수 없어요.</p>'); return; }
    const list = () => p.moves.map((m, i) => { const d = DATA.moves[m.id]; return `<div class="row mo-row"><b class="mo-k">${i + 1}</b>
      <span class="grow"><span class="type" style="background:${TYPE_COLORS[d.t - 1]}">${typeName(d.t)}</span> ${esc(d.n)} <span class="dim">${m.pp}/${m.max}</span></span>
      <button class="btn sm ghost" data-mo="${i}" data-d="-1" ${i ? '' : 'disabled'}>▲</button><button class="btn sm ghost" data-mo="${i}" data-d="1" ${i < p.moves.length - 1 ? '' : 'disabled'}>▼</button></div>`; }).join('');
    const keep = () => {
      moveCache = '';
      const ids = p.moves.map(m => m.id), sv = Game.save;
      if (run.mode === 'normal' && !run.hard && sv.roster[p.sp]) sv.roster[p.sp].moves = ids;
      if (sv.run && sv.run.p) { const old = sv.run.p; const pp = ids.map(id => (p.moves.find(m => m.id === id) || {}).pp); sv.run.p = { ...old, moves: ids, pp }; }
      Game.persist();
    };
    UI.open({
      title: '🔀 기술 순서 바꾸기', html: `<p class="dim">▲▼로 순서를 바꿔요. 숫자키·기술 칸의 번호가 이 순서를 따릅니다.</p><div class="mo-list">${list()}</div>`,
      onOpen: box => box.addEventListener('click', e => {
        const b = e.target.closest('[data-mo]'); if (!b || b.disabled) return;
        const i = +b.dataset.mo, j = i + +b.dataset.d;
        [p.moves[i], p.moves[j]] = [p.moves[j], p.moves[i]];
        box.querySelector('.mo-list').innerHTML = list(); keep();
      }),
      choices: [...(typeof back === 'function' ? [{ label: '← 탐험대 상태', fn: () => setTimeout(back, 0) }] : []), { label: '닫기', fn: () => {} }],
    });
  }

  function showHelp() {
    UI.alert('조작법', `<table class="help">
      <tr><td>이동</td><td>방향키(두 개 동시에 누르면 대각선) / 숫자패드 / WASD + QEZC / 마우스 클릭</td></tr>
      <tr><td>휴대폰</td><td>오른쪽 아래 방향 버튼: 누르고 있으면 계속 걷는다 (누른 채 옆 버튼으로 밀면 방향 전환). 가운데 ↻를 누른 뒤 방향을 누르면 제자리에서 방향만 바꾼다.
        화면의 가 본 곳을 누르면 그곳까지 이동. 창은 ✕나 바깥을 눌러 닫는다.</td></tr>
      <tr><td>방향만 바꾸기</td><td>Shift + 방향 (방향키 / 숫자패드 / WASD) · 키 설정에서 Shift 대신 다른 키로 바꿀 수 있음</td></tr>
      <tr><td>임무 확인</td><td>J: 받은 임무와 이 층의 임무 대상</td></tr>
      <tr><td>조사</td><td>K 또는 조사 버튼 → 살펴볼 칸을 누른다 (컴퓨터는 칸을 우클릭). 적의 HP·상태·가진 아이템, 떨어진 아이템, 발견한 함정을 볼 수 있다.</td></tr>
      <tr><td>메시지 기록 / 탐험대 상태</td><td>U 또는 메시지 창을 누르면 지난 메시지, P 또는 위쪽 상태 표시줄을 누르면 리더와 동료의 능력치·능력 변화·기술.</td></tr>
      <tr><td>빠른 사용</td><td>가방에서 아이템 → "빠른 사용으로 등록". 그 뒤 T 키나 ⭐ 버튼으로 바로 쓴다. 돌·가시 같은 던지는 아이템은 보이는 적 쪽으로 방향을 맞춰 던진다.</td></tr>
      <tr><td>발밑의 아이템</td><td>가방을 열면 맨 위의 "발밑"에서 조사·줍기·가방 아이템과 교환·던지기. 가방 정리 버튼으로 종류별 정렬.</td></tr>
      <tr><td>큰 지도</td><td>N 또는 미니맵 클릭. 큰 지도에서 가 본 곳을 누르면 그곳까지 이동한다. 아무 키나 누르면 닫힌다.</td></tr>
      <tr><td>공격</td><td>Space / Enter, 적 쪽으로 이동해도 공격</td></tr>
      <tr><td>기술</td><td>1 ~ 4 (가까운 적에게 자동으로 방향을 맞춤)</td></tr>
      <tr><td>기술 정보</td><td>Shift + 1 ~ 4, 기술 버튼의 ? 또는 우클릭</td></tr>
      <tr><td>자동 (O)</td><td>적이 없으면 자동 이동: 아이템을 줍고 탐색이 끝나면 계단으로. 적을 만나면 멈춘다.<br>적이 보이면 자동 전투: 가장 가까운 적에게 최적의 기술 (누를 때마다 1턴, Tab / F도 같음)</td></tr>
      <tr><td>동료</td><td>V 또는 🤝 버튼: 동료의 HP·PP·상태 확인, 작전 바꾸기</td></tr>
      <tr><td>휴식</td><td>R: HP가 찰 때까지 쉬기</td></tr>
      <tr><td>대기</td><td>X / 숫자패드 5 / .</td></tr>
      <tr><td>계단</td><td>G: 계단 위라면 내려가고, 아니면 계단까지 이동</td></tr>
      <tr><td>함정</td><td>밟거나 옆에서 발견하면 표시됩니다. 자동 탐색과 이동은 발견한 함정을 피해 갑니다.</td></tr>
      <tr><td>켈리몬 상점</td><td>진열된 물건 위에 서면 살 수 있고, 켈리몬에게 말을 걸면 팔 수 있습니다.</td></tr>
      <tr><td>스피드</td><td>상대보다 빠를수록 명중률이 오르고 상대의 공격을 잘 피한다 (최대 ±20%). 마비는 스피드 절반.</td></tr>
      <tr><td>날씨</td><td>던전에 따라 층마다 날씨가 생긴다. 화면 위 날씨 아이콘에 마우스를 올리면 효과를 볼 수 있다.</td></tr>
      <tr><td>가방</td><td>I / B</td></tr>
      <tr><td>던전 정보</td><td>Y</td></tr>
      <tr><td>메뉴</td><td>Esc / M</td></tr>
      <tr><td>🎮 컨트롤러</td><td>${GP_GUIDE_SHORT}</td></tr></table>`);
  }
  // 컨트롤러 조작 안내 (처음 연결했을 때 한 번, 그 뒤로는 행동 메뉴·조작 패드 설정·조작법에서)
  const GP_GUIDE_SHORT = '왼쪽 스틱·십자키 이동 · 오른쪽 스틱으로 방향만 · 기본 할당: LB+이동 방향만 · <b>RB를 누른 채 A·B·X·Y = 기술 1~4</b> · RT 빠른사용 · Back 지도 · Start 메뉴 · 모든 버튼은 ⚙ 조작에서 바꿀 수 있고, 닌텐도 버튼 배치는 🎮 컨트롤러 안내에서';
  // 컨트롤러 버튼 배치 (v0.92): 브라우저는 버튼을 위치로 알려 준다 (아래 0, 오른쪽 1, 왼쪽 2, 위 3 = Xbox의 A·B·X·Y)
  //  닌텐도 컨트롤러는 글자가 반대(오른쪽 A, 아래 B, 위 X, 왼쪽 Y)라서 닌텐도식이면 A↔B, X↔Y를 바꿔 읽는다
  //  설정 gpLayout: 'auto'(기본, 컨트롤러 이름으로 감지) / 'xbox' / 'nintendo'
  const GP_LAYOUTS = { auto: '자동', xbox: 'Xbox식', nintendo: '닌텐도식' };
  const gpConnected = () => (navigator.getGamepads ? [...navigator.getGamepads()].filter(g => g && g.connected) : []);
  const gpMain = () => { const l = gpConnected(); return l.find(g => g.mapping === 'standard') || l[0] || null; };
  const isNintendoPad = g => !!g && /nintendo|pro controller|joy-?con|057e/i.test(g.id || '');
  const gpLayoutSet = () => (Game.save && Game.save.settings.gpLayout) || 'auto';
  const gpNintendo = g => { const l = gpLayoutSet(); return l === 'nintendo' || (l === 'auto' && isNintendoPad(g)); };
  function gamepadGuide() {
    const b = vpSet().btns, nm = k => esc((VP_ACTS[b[k]] || ['?'])[0]);
    const g = gpMain(), lay = gpLayoutSet(), nin = gpNintendo(g);
    const layText = `${nin ? '닌텐도식' : 'Xbox식'}${lay === 'auto' ? ` <span class="dim">(자동 감지${g ? '' : ' · 연결된 컨트롤러 없음'})</span>` : ''}`;
    const next = { auto: 'xbox', xbox: 'nintendo', nintendo: 'auto' }[lay];
    UI.open({
      title: '🎮 컨트롤러 조작', wide: true,
      html: `<table class="help">
        <tr><td>버튼 배치</td><td><b>${layText}</b> <span class="dim">— 닌텐도식: 오른쪽 A·아래 B·위 X·왼쪽 Y / Xbox식: 아래 A·오른쪽 B·왼쪽 X·위 Y. 아래의 A·B·X·Y는 컨트롤러에 적힌 글자 그대로예요.</span></td></tr>
        <tr><td>왼쪽 스틱 / 십자키</td><td>이동 (누르고 있으면 계속 걷기, 스틱은 대각선도)</td></tr>
        <tr><td>오른쪽 스틱</td><td>기울인 쪽으로 방향만 바꾸기 (턴을 쓰지 않아요)</td></tr>
        ${gpWho('face') ? `<tr><td>${gpWho('face')} + 이동</td><td>제자리에서 방향만 바꾸기</td></tr>` : ''}
        ${gpWho('skill') ? `<tr><td><b>${gpWho('skill')} + A·B·X·Y</b></td><td><b>기술 1·2·3·4번</b> (누르고 있는 동안 기술 칸에 버튼이 표시됩니다)</td></tr>` : ''}
        <tr><td>A · B · X · Y</td><td>A ${nm('a')} · B ${nm('b')} · X ${nm('x')} · Y ${nm('y')} <span class="dim">(공격 버튼을 길게 누르면 정해 둔 순서로 기술)</span></td></tr>
        <tr><td>그 밖의 버튼</td><td>${GP_EXTRA.filter(([k]) => !['face', 'skill', 'none'].includes(gpExtra()[k])).map(([k, n]) => `${n} ${esc(gpActName(gpExtra()[k]))}`).join(' · ') || '없음'}</td></tr>
        <tr><td>창이 열려 있을 때</td><td>십자키 위아래로 고르기, A 확인, B 닫기</td></tr></table>
        <p class="dim">모든 버튼에 둘 행동은 행동 메뉴의 '⚙ 조작'에서 바꿀 수 있어요. 이 안내는 행동 메뉴의 '🎮 컨트롤러'와 조작법(?)에서 다시 볼 수 있어요.</p>`,
      choices: [{ label: '알겠다', fn: () => {} },
        { label: `버튼 배치 바꾸기 → ${GP_LAYOUTS[next]}${next === 'auto' ? ' (컨트롤러 이름으로 감지)' : ''}`, fn: () => { Game.setSetting('gpLayout', next); setTimeout(gamepadGuide, 0); } }],
    });
  }

  // ───────────────────────── 시작 / 종료 ─────────────────────────
  function init() {
    canvas = document.getElementById('view'); ctx = canvas.getContext('2d');
    mini = document.getElementById('minimap'); mctx = mini.getContext('2d');
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { heldMove.clear(); turnHeld.clear(); turnSrc.delete('gp'); });
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('contextmenu', e => { if (!D || UI.isOpen()) return; e.preventDefault(); lookAt(e); });   // 우클릭: 조사
    document.getElementById('log').addEventListener('click', () => { if (D && !UI.isOpen()) { stopAuto(); showLog(); } });
    // 메시지 창은 게임 화면 아래쪽에 겹쳐 띄운다 (원작처럼, 휴대폰도 v0.83부터 같게)
    document.getElementById('view-wrap').appendChild(document.getElementById('log'));
    // PC(넓은 화면): 조이스틱 패드는 아래 띠의 기술 오른쪽(버튼 줄 자리)에 둔다. 휴대폰은 맨 아래 그대로
    const vpEl = document.getElementById('vpad'), vpHome = vpEl.parentElement, wideMQ = matchMedia('(min-width: 801px)');
    // 휴대폰 가로 화면(body.phone-land)은 폭이 넓어도 패드를 화면 위에 겹쳐 둔다 (아래 띠에 넣으면 게임 화면이 얇아진다)
    const placeVpad = () => {
      const to = wideMQ.matches && !document.body.classList.contains('phone-land') ? document.getElementById('controls') : vpHome;
      if (vpEl.parentElement !== to) to.appendChild(vpEl);
    };
    placeVpadFn = placeVpad;
    wideMQ.addEventListener ? wideMQ.addEventListener('change', layoutVpad) : wideMQ.addListener(layoutVpad);
    placeVpad();
    document.getElementById('hud').addEventListener('click', e => { if (D && !UI.isOpen() && !e.target.closest('[title]')) { stopAuto(); showStatus(); } });
    mini.addEventListener('click', onMiniClick);
    initPad(); initVpad(); initGamepad();
    document.getElementById('moves').addEventListener('contextmenu', e => {
      const b = e.target.closest('.mv'); if (!b || !D) return;
      e.preventDefault();
      const m = P().moves[+b.dataset.slot]; if (m) showMoveInfo(m.id, m.pp, m.max, P().sp);
    });
    document.getElementById('moves').addEventListener('click', e => {
      const b = e.target.closest('.mv'); if (b && !busy()) { stopAuto(); act({ t: 'skill', slot: +b.dataset.slot }); }
    });
    document.getElementById('actions').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !D) return;
      runAction(b.dataset.k);
    });
  }

  // 아래 버튼·조이스틱 행동 메뉴가 함께 쓰는 행동
  function runAction(k) {
    if (!D) return;
    if (D.auto) stopAuto();
    if (busy() && k !== 'menu') return;
    ({ attack: () => act({ t: 'attack' }), explore: () => startAuto('explore'), fight: () => startAuto('fight'), tactic: partyMenu, rest: () => startAuto('rest'),
      wait: () => act({ t: 'wait' }), stairs: tryStairs, bag: openBag, menu: () => Game.dungeonMenu(), dginfo: () => Game.dungeonMenu('info'), help: showHelp,
      mission: () => Game.showMissions(), map: () => toggleMap(), look: toggleLook, quick: quickUse, padset: padSettings, gpguide: gamepadGuide, moveorder: moveOrder })[k]?.();
  }
  // 조이스틱 모드의 X: 아래 버튼들을 모은 행동 메뉴 (조이스틱 모드에서는 아래 버튼 줄을 숨긴다)
  const VP_MENU = [['explore', '🧭 자동 탐색'], ['look', '🔍 조사'], ['bag', '🎒 가방'], ['quick', '⭐ 빠른사용'], ['stairs', '🪜 계단'], ['wait', '⏳ 대기'], ['rest', '💤 휴식'], ['map', '🗺 지도'],
    ['mission', '📜 임무'], ['dginfo', 'ℹ 던전 정보'], ['tactic', '🤝 동료'], ['moveorder', '🔀 기술 순서'], ['padset', '⚙ 조작'], ['gpguide', '🎮 컨트롤러'], ['menu', '☰ 메뉴']];
  function vpMenu(viaPad) {
    stopAuto();
    const onBtn = Object.values(vpSet().btns);   // ABXY에 둔 행동은 빼고 보여 준다 (조작·메뉴는 늘)
    const hasPad = navigator.getGamepads && [...navigator.getGamepads()].some(g => g && g.connected);
    const items = VP_MENU.filter(([k]) => k === 'gpguide' ? hasPad : k === 'padset' || k === 'menu' || !onBtn.includes(k));
    // 컨트롤러: 십자키로 고를 수 있게 목록으로
    if (viaPad) return UI.open({ title: '행동', choices: [...items.map(([k, n]) => ({ label: n, fn: () => setTimeout(() => runAction(k), 0) })), { label: '닫기', fn: () => {} }] });
    UI.open({
      title: '행동', html: `<div class="vp-menu">${items.map(([k, n]) => `<button class="btn" data-vk="${k}">${n}</button>`).join('')}</div>`,
      onOpen: (box, m) => box.querySelectorAll('[data-vk]').forEach(b => b.onclick = () => { UI.close(m); setTimeout(() => runAction(b.dataset.vk), 0); }),
      choices: [{ label: '닫기', fn: () => {} }],
    });
  }

  // 터치 화면용 방향 버튼: 누르고 있으면 계속 걷는다. 가운데 ↻를 누른 뒤 방향을 누르면 방향만 바꾼다
  function initPad() {
    const pad = document.getElementById('dpad'); if (!pad) return;
    let timer = null, dir = null, face = false;
    const faceBtn = pad.querySelector('[data-face]');
    const setFace = v => { face = v; faceBtn.classList.toggle('on', v); if (v) turnSrc.add('dpad'); else turnSrc.delete('dpad'); };
    const fire = () => {
      if (!D || D.dead || UI.isOpen() || bigMap || dir == null || busy()) return;
      if (face) { setFace(false); act({ t: 'face', dir }); stop(); return; }
      act({ t: 'move', dir });
    };
    const stop = () => { clearInterval(timer); timer = null; dir = null; pad.querySelectorAll('.held').forEach(b => b.classList.remove('held')); };
    pad.addEventListener('pointerdown', e => {
      const b = e.target.closest('button'); if (!b || !D) return;
      e.preventDefault();
      if (b.dataset.face != null) { setFace(!face); return; }
      if (D.auto) { stopAuto(); return; }
      if (bigMap) { toggleMap(false); return; }
      stop();
      dir = dirIndex(+b.dataset.dx, +b.dataset.dy);
      b.classList.add('held');
      fire();
      if (dir != null) timer = setInterval(fire, 40);   // 걷는 연출이 끝나는 대로 다음 칸
    });
    // 누른 채로 손가락을 옆 버튼으로 옮기면 방향이 바뀐다
    pad.addEventListener('pointermove', e => {
      if (dir == null) return;
      const b = document.elementFromPoint(e.clientX, e.clientY)?.closest('#dpad button[data-dx]'); if (!b) return;
      const d = dirIndex(+b.dataset.dx, +b.dataset.dy);
      if (d !== dir) { pad.querySelectorAll('.held').forEach(x => x.classList.remove('held')); b.classList.add('held'); dir = d; }
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) pad.addEventListener(ev, stop);
    pad.addEventListener('contextmenu', e => e.preventDefault());
  }

  // ── 터치 화면 조이스틱·ABXY ──
  // 조이스틱: 끌면 8방향으로 걷는다 (누르고 있는 동안 계속). ↻를 누른 뒤 끌면 방향만 바꾼다
  // A 공격 (길게 누르면 정해 둔 순서대로 PP가 남은 기술) · B 자동 · X 메뉴 · Y 조사
  // 설정(⚙ 조작): 크기, 진동, A 길게 누르기 기술 순서, 끌어서 배치 (위치는 세로·가로 화면마다 따로)
  // ABXY에 둘 수 있는 행동: [버튼에 쓰는 짧은 이름, 설정 창의 이름]
  const VP_ACTS = { attack: ['공격', '⚔ 공격 (길게 누르면 기술)'], explore: ['자동', '🧭 자동 탐색 (다시 누르면 멈춤)'], vpmenu: ['행동', '📋 행동 메뉴'], look: ['조사', '🔍 조사'],
    stairs: ['계단', '🪜 계단'], quick: ['빠른', '⭐ 빠른사용'], bag: ['가방', '🎒 가방'], wait: ['대기', '⏳ 대기'], rest: ['휴식', '💤 휴식'],
    map: ['지도', '🗺 지도'], mission: ['임무', '📜 임무'], dginfo: ['정보', 'ℹ 던전 정보'], tactic: ['동료', '🤝 동료'], menu: ['메뉴', '☰ 메뉴'] };
  const VP_BTNS = { a: 'attack', b: 'explore', x: 'vpmenu', y: 'look' };
  const VP_DEFAULT = { js: 100, ab: 85, vib: true, order: [1, 2, 3, 4], btns: VP_BTNS };
  const VP_POS = { portrait: { js: [27, 52], abxy: [76, 52] }, landscape: { js: [16, 52], abxy: [84, 52] } };   // ↻(face)는 옮긴 적이 없으면 조이스틱 왼쪽 위에 따로 둔다
  const vpSet = () => { const v = { ...VP_DEFAULT, ...((Game.save && Game.save.settings.vpad) || {}) }; v.btns = { ...VP_BTNS, ...(v.btns || {}) }; return v; };
  // 컨트롤러 전용 버튼 (v0.100): LB·RB·LT·RT·Back·Start도 자유롭게 할당. face·skill은 누르고 있는 동안 (방향만 바꾸기 / A·B·X·Y가 기술 1~4)
  const GP_EXTRA = [['lb', 'LB'], ['rb', 'RB'], ['lt', 'LT'], ['rt', 'RT'], ['back', 'Back(Select)'], ['start', 'Start']];
  const GP_EXTRA_DEFAULT = { lb: 'face', rb: 'skill', lt: 'none', rt: 'quick', back: 'map', start: 'menu' };
  const GP_HOLD_ACTS = { face: ['방향', '↻ 누른 채 이동: 방향만 바꾸기'], skill: ['기술', '🎯 누른 채 A·B·X·Y: 기술 1~4'], none: ['없음', '— 쓰지 않음'] };
  const gpExtra = () => ({ ...GP_EXTRA_DEFAULT, ...((Game.save && Game.save.settings.gpBtns) || {}) });
  const gpActName = k => (GP_HOLD_ACTS[k] || VP_ACTS[k] || ['?'])[0];
  const gpWho = act => GP_EXTRA.filter(([k]) => gpExtra()[k] === act).map(([, n]) => n).join('·');   // 안내 글: 그 행동을 둔 버튼 이름
  // ABXY 아래 작은 이름을 할당에 맞춘다
  function vpLabels() {
    const btns = vpSet().btns;
    for (const b of document.querySelectorAll('#vpad .vp-abxy button[data-b]')) { const sm = b.querySelector('small'), n = (VP_ACTS[btns[b.dataset.b]] || [''])[0]; if (sm && sm.textContent !== n) sm.textContent = n; }
  }
  const vpOrient = () => (matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape');
  const vibe = () => { if (vpSet().vib && navigator.vibrate) try { navigator.vibrate(12); } catch (e) { /* 무시 */ } };
  // 화면이 좁으면 조이스틱과 ABXY가 겹치지 않게 함께 줄이고, 옮겨 둔 위치에서 겹치면 양 끝으로 붙인다
  const VP_GAP = 10;
  let placeVpadFn = null;
  function layoutVpad() {
    const vp = document.getElementById('vpad'); if (!vp || !Game.save) return;
    if (placeVpadFn) placeVpadFn();
    vpLabels();
    // 왼손 모드 (v0.102 보강): 기본 위치를 좌우로 뒤집는다 (조이스틱 오른쪽, ABXY 왼쪽). 직접 옮긴 위치가 있으면 그 위치
    const s = vpSet(), base = VP_POS[vpOrient()], mir = ([x, y]) => [100 - x, y];
    const pos = { ...(s.left ? { js: mir(base.js), abxy: mir(base.abxy) } : base), ...((s.pos || {})[vpOrient()] || {}) };
    let js = 140 * s.js / 100, ab = 64 * s.ab / 100;
    const W = vp.clientWidth;
    if (W > 0) {
      const room = W - VP_GAP * 3, need = js + ab * 2.6;   // 양 끝과 가운데 틈을 빼고 남는 너비에 두 묶음이 들어가게
      if (need > room) { const f = room / need; js *= f; ab *= f; }
    }
    const abW = ab * 2.6, H = Math.max(js, abW) + 20;
    vp.style.setProperty('--js', Math.floor(js) + 'px');
    vp.style.setProperty('--ab', Math.floor(ab) + 'px');
    vp.style.height = Math.ceil(H) + 'px';
    let [jx, jy] = pos.js, [ax, ay] = pos.abxy;
    if (W > 0) {
      // 위치(%)를 픽셀로 바꿔 영역 안에 두고, 두 묶음이 겹치면 왼쪽 끝·오른쪽 끝으로
      const clampX = (x, half) => Math.min(W - half - 2, Math.max(half + 2, x / 100 * W)), clampY = (y, half) => Math.min(H - half - 2, Math.max(half + 2, y / 100 * H));
      let jcx = clampX(jx, js / 2), jcy = clampY(jy, js / 2), acx = clampX(ax, abW / 2), acy = clampY(ay, abW / 2);
      const overlap = Math.abs(jcx - acx) < (js + abW) / 2 + VP_GAP && Math.abs(jcy - acy) < (js + abW) / 2 + VP_GAP;
      if (overlap) { jcx = VP_GAP + js / 2; acx = W - VP_GAP - abW / 2; jcy = acy = H / 2; if (s.left) { jcx = W - jcx; acx = W - acx; } }
      jx = jcx / W * 100; jy = jcy / H * 100; ax = acx / W * 100; ay = acy / H * 100;
    }
    // ↻ 방향만 바꾸기 버튼: 따로 옮길 수 있다. 기본은 조이스틱 왼쪽 위에서 조금 떨어진 곳
    let fx, fy;
    if (W > 0) {
      const half = 20, jcx = jx / 100 * W, jcy = jy / 100 * H;
      const [px, py] = pos.face ? [pos.face[0] / 100 * W, pos.face[1] / 100 * H] : [jcx + (s.left ? 1 : -1) * js * 0.62, jcy - js * 0.62];   // 왼손 모드: 조이스틱 오른쪽 위
      fx = Math.min(W - half, Math.max(half, px)) / W * 100; fy = Math.min(H - half, Math.max(half, py)) / H * 100;
    } else [fx, fy] = pos.face || [jx - 8, jy - 30];
    const at = { js: [jx, jy], abxy: [ax, ay], face: [fx, fy] };
    for (const g of vp.querySelectorAll('.vp-grp')) { const [x, y] = at[g.dataset.grp]; g.style.left = x + '%'; g.style.top = y + '%'; }
  }
  function initVpad() {
    const vp = document.getElementById('vpad'); if (!vp) return;
    const stick = vp.querySelector('.vp-stick'), base = vp.querySelector('.vp-base'), thumb = vp.querySelector('.vp-thumb'), faceBtn = vp.querySelector('.vp-face');
    let pid = null, dir = null, timer = null, face = false, editing = false;
    const setFace = v => { face = v; faceBtn.classList.toggle('on', v); if (v) turnSrc.add('vp'); else turnSrc.delete('vp'); };
    // ↻ 방향만 바꾸기: 조이스틱을 누르고 있는 동안 계속 (방향을 돌리면 그쪽으로 돌아서기만), 손을 떼면 풀린다
    let faceHeld = false;
    const fire = (changed) => {
      if (!D || D.dead || UI.isOpen() || bigMap || dir == null || busy()) return;
      if (face) { if (changed) act({ t: 'face', dir }); faceHeld = true; return; }
      act({ t: 'move', dir });
    };
    const release = () => { pid = null; dir = null; clearInterval(timer); timer = null; thumb.style.transform = 'translate(-50%, -50%)'; stick.classList.remove('on'); if (faceHeld) { faceHeld = false; setFace(false); } };
    const track = e => {
      const r = base.getBoundingClientRect(), R = r.width / 2;
      const dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
      const len = Math.hypot(dx, dy), k = len > R * 0.6 ? R * 0.6 / len : 1;
      thumb.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
      // 가운데(반지름의 30%) 안은 멈춤. 바깥은 45도씩 8방향
      let d = null;
      if (len > R * 0.3) { const o = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)); d = dirIndex(Math.round(Math.cos(o * Math.PI / 4)), Math.round(Math.sin(o * Math.PI / 4))); }
      if (d !== dir) { dir = d; if (d != null) { vibe(); fire(true); } }
      stick.classList.toggle('on', d != null);
    };
    base.addEventListener('pointerdown', e => {
      if (editing || !D) return;
      e.preventDefault();
      if (D.auto) { stopAuto(); return; }
      if (bigMap) { toggleMap(false); return; }
      pid = e.pointerId; try { base.setPointerCapture(pid); } catch (x) { /* 무시 */ } track(e);
      clearInterval(timer); timer = setInterval(fire, 40);   // 누르고 있으면 걷는 연출이 끝나는 대로 다음 칸
    });
    base.addEventListener('pointermove', e => { if (e.pointerId === pid) track(e); });
    for (const ev of ['pointerup', 'pointercancel']) base.addEventListener(ev, e => { if (e.pointerId === pid) release(); });
    faceBtn.addEventListener('pointerdown', e => { e.preventDefault(); if (!editing) { vibe(); setFace(!face); } });
    // ABXY
    let aTimer = null, aLong = false;
    const longSkill = () => {
      const p = P(); if (!p) return false;
      for (const n of vpSet().order) { const m = p.moves[n - 1]; if (m && m.pp > 0) { act({ t: 'skill', slot: n - 1 }); return true; } }
      log('PP가 남은 기술이 없다!', now()); return false;
    };
    const abxy = vp.querySelector('.vp-abxy');
    abxy.addEventListener('pointerdown', e => {
      const b = e.target.closest('button[data-b]'); if (!b || editing || !D) return;
      e.preventDefault(); vibe(); b.classList.add('held');
      const k = vpSet().btns[b.dataset.b];   // 버튼에 둔 행동
      if (k === 'attack') { aLong = false; clearTimeout(aTimer); aTimer = setTimeout(() => { aLong = true; vibe(); if (!busy() && !UI.isOpen()) { stopAuto(); longSkill(); } }, 420); return; }
      if (UI.isOpen() && k !== 'vpmenu') return;
      if (k === 'explore') { if (D.auto) stopAuto(); else if (!busy()) startAuto('explore'); return; }
      if (D.auto) stopAuto();
      if (k === 'vpmenu') { vpMenu(); return; }
      runAction(k);
    });
    const clearHeld = () => vp.querySelectorAll('.vp-abxy .held').forEach(x => x.classList.remove('held'));
    abxy.addEventListener('pointerup', e => {
      const b = e.target.closest && e.target.closest('button[data-b]');
      clearHeld();
      if (b && vpSet().btns[b.dataset.b] === 'attack' && aTimer) { clearTimeout(aTimer); aTimer = null; if (!aLong && D && !busy() && !UI.isOpen()) { stopAuto(); act({ t: 'attack' }); } }
    });
    abxy.addEventListener('pointercancel', () => { clearTimeout(aTimer); aTimer = null; clearHeld(); });
    vp.addEventListener('contextmenu', e => e.preventDefault());
    // 끌어서 배치 (조작 영역 안에서만)
    let drag = null;
    vp.addEventListener('pointerdown', e => {
      if (!editing) return;
      const g = e.target.closest('.vp-grp'); if (!g) return;
      e.preventDefault(); drag = { g, id: e.pointerId }; try { vp.setPointerCapture(e.pointerId); } catch (x) { /* 무시 */ }
    });
    vp.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const r = vp.getBoundingClientRect(), gr = drag.g.getBoundingClientRect();
      const hx = gr.width / 2 / r.width * 100, hy = gr.height / 2 / r.height * 100;
      const x = Math.min(100 - hx, Math.max(hx, (e.clientX - r.left) / r.width * 100)), y = Math.min(100 - hy, Math.max(hy, (e.clientY - r.top) / r.height * 100));
      drag.g.style.left = x + '%'; drag.g.style.top = y + '%';
    });
    vp.addEventListener('pointerup', () => { drag = null; });
    vp.querySelector('[data-vpdone]').addEventListener('click', () => {
      const s = vpSet(), pos = { ...(s.pos || {}) }, o = {};
      for (const g of vp.querySelectorAll('.vp-grp')) o[g.dataset.grp] = [parseFloat(g.style.left), parseFloat(g.style.top)];
      pos[vpOrient()] = o;
      editing = false; vp.classList.remove('editing');
      Game.setSetting('vpad', { ...s, pos }); UI.toast('패드 위치를 저장했어요. (' + (vpOrient() === 'portrait' ? '세로' : '가로') + ' 화면)');
    });
    initVpad.edit = () => { editing = true; release(); vp.classList.add('editing'); };
    window.addEventListener('resize', layoutVpad);
    if (window.ResizeObserver) new ResizeObserver(() => layoutVpad()).observe(vp);   // 던전 화면이 보일 때 (숨어 있을 때는 너비가 0)
    layoutVpad();
  }
  // ── 게임 컨트롤러 (Gamepad API, v0.84) ──
  //  왼쪽 스틱·십자키: 이동 (누르고 있으면 계속, 대각선 가능) / LB를 누른 채: 방향만 바꾸기
  //  A·B·X·Y: 조작 패드 설정의 버튼 할당 그대로 (기본 A 공격·길게 기술 / B 자동 / X 행동 메뉴 / Y 조사)
  //  기본 할당 (v0.100부터 ⚙ 조작에서 바꿀 수 있다, GP_EXTRA_DEFAULT): RB를 누른 채 A·B·X·Y 기술 1~4 / LB를 누른 채 이동 방향만 / RT 빠른사용 · Back 지도 · Start 메뉴. 창이 열려 있으면 십자키 위아래로 고르고 A 확인, B 닫기
  const GP = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  const GP_SKILL = [GP.A, GP.B, GP.X, GP.Y];   // RB + 이 버튼 = 기술 1~4
  const GP_NAME = { [GP.A]: 'a', [GP.B]: 'b', [GP.X]: 'x', [GP.Y]: 'y' };
  function initGamepad() {
    if (!navigator.getGamepads) return;
    let raf = 0, prev = [], prevDir = null, uiRepeat = 0, aAt = 0, aIdx = null, aLong = false, faceDir = null, rFaceDir = null;
    // 표준 배치(standard)인 컨트롤러를 먼저 (가상 장치·다른 입력 장치가 먼저 잡히지 않게)
    const pad = () => { const l = [...navigator.getGamepads()].filter(g => g && g.connected); return l.find(g => g.mapping === 'standard') || l[0]; };
    // 스틱 축은 한 번이라도 가운데(0 근처)에 온 것을 본 뒤부터 쓴다 (v0.91)
    //  - 가만히 있어도 -1 등으로 치우친 축: 가운데에 오지 않으니 쓰지 않는다 (저절로 걷지 않게)
    //  - 스틱을 민 채로 연결된 경우: 예전에는 그 값을 쉬는 위치로 잘못 잡아 손을 떼면 반대쪽으로 계속 걸었다
    const centered = {};
    const axis = (g, i) => { const k = g.index + ':' + i, v = g.axes[i] || 0; if (Math.abs(v) < 0.2) centered[k] = true; return centered[k] ? v : 0; };
    const uiKey = code => UI.key({ code, target: null, preventDefault() {} });
    const stickDir = g => {
      const b = i => !!(g.buttons[i] && g.buttons[i].pressed);
      let dx = (b(GP.RIGHT) ? 1 : 0) - (b(GP.LEFT) ? 1 : 0), dy = (b(GP.DOWN) ? 1 : 0) - (b(GP.UP) ? 1 : 0);
      if (!dx && !dy) {
        const x = axis(g, 0), y = axis(g, 1);
        if (Math.hypot(x, y) < 0.5) return null;
        const a = Math.round(Math.atan2(y, x) / (Math.PI / 4));   // 8방향
        dx = Math.round(Math.cos(a * Math.PI / 4)); dy = Math.round(Math.sin(a * Math.PI / 4));
      }
      return dirIndex(dx, dy);
    };
    const longSkill = () => {
      const p = P(); if (!p) return;
      for (const n of vpSet().order) { const m = p.moves[n - 1]; if (m && m.pp > 0) { act({ t: 'skill', slot: n - 1 }); return; } }
      log('PP가 남은 기술이 없다!', now());
    };
    const press = (name, k) => {   // 버튼을 막 눌렀을 때 (할당된 행동)
      if (k === 'attack') { aAt = performance.now(); aLong = false; return; }
      if (k === 'explore') { if (D.auto) stopAuto(); else if (!busy()) startAuto('explore'); return; }
      if (D.auto) stopAuto();
      if (k === 'vpmenu') vpMenu(true); else runAction(k);
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const g = pad(); if (!g) return;
      // 닌텐도식 배치: A·B·X·Y(0~3)는 위치를 바꿔 읽는다 (0↔1, 2↔3)
      const nin = gpNintendo(g), raw = i => (nin && i < 4 ? i ^ 1 : i);
      const now0 = performance.now(), down = i => !!(g.buttons[raw(i)] && g.buttons[raw(i)].pressed), hit = i => down(i) && !prev[raw(i)];
      const dir = stickDir(g), any = g.buttons.some(b => b.pressed) || dir != null;
      if (any && Game.poke) Game.poke();   // 자리 비움 깨우기 등
      const ex = gpExtra(), exIdx = { lb: GP.LB, rb: GP.RB, lt: GP.LT, rt: GP.RT, back: GP.BACK, start: GP.START };
      const holdDown = act => GP_EXTRA.some(([k]) => ex[k] === act && down(exIdx[k]));
      const skillMode = !UI.isOpen() && !!D && !bigMap && holdDown('skill');
      if (holdDown('face') && !UI.isOpen()) turnSrc.add('gp'); else turnSrc.delete('gp');   // 방향 전환 격자
      if (document.body.classList.contains('gp-skill') !== skillMode) document.body.classList.toggle('gp-skill', skillMode);   // 기술 칸에 A·B·X·Y 표시
      if (UI.isOpen()) {
        // 창: 위아래로 고르기 (누르고 있으면 반복), A 확인, B 닫기
        const v = dir === 4 ? 'ArrowUp' : dir === 0 ? 'ArrowDown' : null;
        if (v && (prevDir !== dir || now0 > uiRepeat)) { uiKey(v); uiRepeat = now0 + (prevDir !== dir ? 380 : 140); }
        if (hit(GP.A)) uiKey('Enter'); else if (hit(GP.B)) uiKey('Escape');
        aAt = 0;
      } else if (D && !D.dead) {
        if (bigMap) { if (hit(GP.B) || hit(GP.A) || GP_EXTRA.some(([k]) => ex[k] === 'map' && hit(exIdx[k]))) toggleMap(false); }
        else {
          const btns = vpSet().btns;
          if (skillMode) {
            aAt = 0;
            GP_SKILL.forEach((i, slot) => { if (hit(i) && P().moves[slot]) { if (D.auto) stopAuto(); if (!busy()) act({ t: 'skill', slot }); } });
          } else for (const i of [GP.A, GP.B, GP.X, GP.Y]) if (hit(i)) { aIdx = i; press(GP_NAME[i], btns[GP_NAME[i]]); }
          for (const [k] of GP_EXTRA) if (!GP_HOLD_ACTS[ex[k]] && hit(exIdx[k])) { aIdx = exIdx[k]; press(k, ex[k]); }   // LB·RB·LT·RT·Back·Start
          // 공격을 둔 버튼: 짧게 떼면 공격, 길게 누르면 기술
          const atkBtn = aIdx;   // 마지막으로 누른 버튼 (공격을 눌렀을 때만 aAt가 잡힌다)
          if (aAt && atkBtn != null) {
            if (down(atkBtn) && !aLong && now0 - aAt > 420) { aLong = true; if (!busy()) { stopAuto(); longSkill(); } }
            if (!down(atkBtn)) { if (!aLong && !busy()) { stopAuto(); act({ t: 'attack' }); } aAt = 0; }
          }
          if (dir != null) {
            if (D.auto) stopAuto();
            if (holdDown('face')) { if (dir !== faceDir && !busy()) { faceDir = dir; act({ t: 'face', dir }); } }
            else if (!busy()) act({ t: 'move', dir });
          }
          if (dir == null || !holdDown('face')) faceDir = null;
          // 오른쪽 스틱 (v0.92): 기울인 쪽으로 방향만 바꾼다 (새 방향일 때 한 번)
          const rx = axis(g, 2), ry = axis(g, 3);
          let rdir = null;
          if (Math.hypot(rx, ry) >= 0.5) { const o = Math.round(Math.atan2(ry, rx) / (Math.PI / 4)); rdir = dirIndex(Math.round(Math.cos(o * Math.PI / 4)), Math.round(Math.sin(o * Math.PI / 4))); }
          if (rdir != null && rdir !== rFaceDir && !busy()) { if (D.auto) stopAuto(); rFaceDir = rdir; act({ t: 'face', dir: rdir }); }
          if (rdir == null) rFaceDir = null;
        }
      }
      prev = g.buttons.map(b => b.pressed); prevDir = dir;
    };
    const start = () => { if (!raf && pad()) tick(); };
    window.addEventListener('gamepadconnected', () => {
      start();
      const st = Game.save && Game.save.settings;
      if (st && !st.gpGuided && !UI.isOpen()) { st.gpGuided = true; Game.setSetting('gpGuided', true); gamepadGuide(); }   // 처음 한 번은 안내 창
      else UI.toast(`🎮 컨트롤러 연결${gpWho('skill') ? `: ${gpWho('skill')}를 누른 채 A·B·X·Y로 기술 1~4` : ''} (행동 메뉴의 🎮 컨트롤러에서 전체 안내)`);
    });
    window.addEventListener('gamepaddisconnected', () => { if (!pad()) { cancelAnimationFrame(raf); raf = 0; } });
    start();
  }

  // 조작 패드 설정 창
  function padSettings() {
    stopAuto();
    const s = vpSet(), mode = Game.save.settings.padMode || 'stick';
    const sel = i => `<select data-ord="${i}">${[1, 2, 3, 4].map(n => `<option value="${n}" ${s.order[i] === n ? 'selected' : ''}>${n}번</option>`).join('')}</select>`;
    let box = null;   // 고르기 칸을 누르면 창이 먼저 닫히므로, 열 때 잡아 둔 창에서 값을 읽는다
    const savePadForm = () => {
      if (!box) return;
      const left = box.querySelector('[data-vp=left]').checked, old = vpSet();
      const v = { ...old, js: +box.querySelector('[data-vp=js]').value, ab: +box.querySelector('[data-vp=ab]').value, vib: box.querySelector('[data-vp=vib]').checked, left,
        ...(left !== !!old.left ? { pos: {} } : {}),   // 왼손 모드를 바꾸면 직접 옮긴 위치는 처음으로
        order: [0, 1, 2, 3].map(i => +box.querySelector(`[data-ord="${i}"]`).value),
        btns: Object.fromEntries(['a', 'b', 'x', 'y'].map(k => [k, box.querySelector(`[data-btn="${k}"]`).value])) };
      Game.setSetting('gpBtns', Object.fromEntries(GP_EXTRA.map(([k]) => [k, box.querySelector(`[data-gpb="${k}"]`).value])));
      // 행동 메뉴가 어디에도 없으면 가방·설정 등에 갈 수 없으니 X에 다시 둔다
      if (!Object.values(v.btns).includes('vpmenu')) { v.btns.x = 'vpmenu'; UI.toast('행동 메뉴는 꼭 하나의 버튼에 있어야 해서 X에 두었어요.'); }
      Game.setSetting('vpad', v); Game.setSetting('padMode', box.querySelector('[data-vp=mode]').value);
    };
    UI.open({
      title: '조작 패드 설정', wide: true,
      html: `<div class="vp-set">
        <div class="row"><span>패드 방식</span><select data-vp="mode"><option value="stick" ${mode === 'stick' ? 'selected' : ''}>조이스틱 + ABXY</option><option value="dpad" ${mode === 'dpad' ? 'selected' : ''}>방향 버튼 (화면 위)</option></select></div>
        <div class="row"><span>조이스틱 크기</span><input type="range" min="60" max="150" step="5" data-vp="js" value="${s.js}"><b class="vp-js">${s.js}%</b></div>
        <div class="row"><span>ABXY 크기</span><input type="range" min="60" max="150" step="5" data-vp="ab" value="${s.ab}"><b class="vp-ab">${s.ab}%</b></div>
        <label class="row chk"><input type="checkbox" data-vp="left" ${s.left ? 'checked' : ''}> 🫲 왼손 모드 (조이스틱을 오른쪽, ABXY를 왼쪽에. 바꾸면 직접 옮긴 위치는 처음으로)</label>
        <label class="row chk"><input type="checkbox" data-vp="vib" ${s.vib ? 'checked' : ''}> 누를 때 짧은 진동</label>
        <p class="dim">버튼 할당 <span class="dim">(버튼에 두지 않은 행동은 행동 메뉴에 나옵니다)</span></p>
        <div class="vp-btns">${['a', 'b', 'x', 'y'].map(k => `<label><b>${k.toUpperCase()}</b> <select data-btn="${k}">${Object.entries(VP_ACTS).map(([v, [, n]]) => `<option value="${v}" ${s.btns[k] === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`).join('')}</div>
        <p class="dim">🎮 컨트롤러 버튼 할당 <span class="dim">(컨트롤러에만 있는 버튼)</span></p>
        <div class="vp-btns">${GP_EXTRA.map(([k, n]) => `<label><b>${n}</b> <select data-gpb="${k}">${Object.entries({ ...GP_HOLD_ACTS, ...VP_ACTS }).map(([v, [, nm]]) => `<option value="${v}" ${gpExtra()[k] === v ? 'selected' : ''}>${nm}</option>`).join('')}</select></label>`).join('')}</div>
        <p class="dim">'공격'을 둔 버튼을 길게 누르면 쓸 기술 순서 (PP가 없으면 다음 순서)</p>
        <div class="vp-order">${sel(0)} → ${sel(1)} → ${sel(2)} → ${sel(3)}</div>
        <p class="dim">기본: A 공격 · 길게 누르면 기술 / B 자동 / X 행동 메뉴(가방·계단·대기·지도·메뉴 등) / Y 조사 · 조이스틱 옆 ↻를 누르고 조이스틱을 누르고 있는 동안은 방향만 바꿉니다.<br>위치는 세로·가로 화면마다 따로 저장되고, 아래 조작 영역 안에서만 옮길 수 있습니다.</p></div>`,
      onOpen: b => {
        box = b.querySelector('.vp-set') || b;
        b.addEventListener('input', e => {
          const k = e.target.dataset.vp;
          if (k === 'js' || k === 'ab') { b.querySelector('.vp-' + k).textContent = e.target.value + '%'; Game.save.settings.vpad = { ...vpSet(), [k]: +e.target.value }; layoutVpad(); }
        });
      },
      choices: [
        { label: '🎮 컨트롤러 조작 안내', fn: () => { savePadForm(); setTimeout(gamepadGuide, 0); } },
        { label: '패드 끌어서 배치', fn: () => { savePadForm(); setTimeout(() => initVpad.edit && initVpad.edit(), 0); } },
        { label: '기본값 복원', fn: () => { Game.save.settings.vpad = { ...VP_DEFAULT }; Game.setSetting('gpBtns', { ...GP_EXTRA_DEFAULT }); Game.setSetting('padMode', 'stick'); UI.toast('조작 패드를 기본값으로 되돌렸어요.'); } },
        { label: '저장·닫기', fn: savePadForm },
      ],
      cancel: savePadForm,
    });
  }

  // 아래 버튼의 키 표시를 키 설정에 맞춘다
  const BTN_ACTION = { explore: 'auto', tactic: 'party', rest: 'rest', stairs: 'stairs', mission: 'missions', map: 'map', bag: 'bag', look: 'look', quick: 'quick', attack: 'attack', wait: 'wait' };
  function updateKeyHints() {
    const custom = (Game.save && Game.save.settings && Game.save.settings.keys) || {};
    for (const [k, a] of Object.entries(BTN_ACTION)) {
      const b = document.querySelector(`#actions [data-k=${k}]`); if (!b) continue;
      const keys = keysOf(a, custom), kb = b.querySelector('kbd');
      if (kb) kb.textContent = keys.length ? keyLabel(keys[0]) : '';
      b.title = b.title.replace(/^[^:]*?(?=:|$)/, keys.map(keyLabel).join(' / ') || '키 없음');
    }
  }
  function enter(r) {
    ROGUE_LEARNER = r.mode === 'rogue' ? (r.p.rsp || r.p.sp) : null;   // 로그라이크: 들어간 포켓몬이 배울 수 있는 기술머신만 나온다
    updateKeyHints();
    run = r; LOG.length = 0; hudCache = logCache = moveCache = quickCache = '';
    Gfx.preload();
    Sprites.load(r.p.sp, r.p.shiny);
    newFloor();
    if (!rafId) render();
    if (!logicTimer) logicTimer = setInterval(logicTick, 16);
  }
  function leave() {
    Progress.unseed();
    toggleMap(false);
    D = null; run = null; CUR_WEATHER = null; CUR_TERRAIN = null; document.getElementById('dungeon-screen')?.classList.remove('danger'); faceTemp = null; faceShown = '';
    cancelAnimationFrame(rafId); rafId = 0;
    clearInterval(logicTimer); logicTimer = 0;
    pendingKey = null;
  }
  return { devJump, rebuildMap: () => { if (D) buildMapCanvas(); }, moveOrder, layoutVpad, padSettings, gamepadGuide, showLog, showStatus, partyMenu, floorCandidates, updateKeyHints, init, enter, leave, get run() { return run; }, get floor() { return D; }, stopAuto, showHelp, addToBag, _log: LOG };
})();
