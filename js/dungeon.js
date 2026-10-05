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
  const nm = c => (c.outlaw ? '수배범 ' : '') + spName(looksOf(c));

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

  // 복도(방이 아닌 바닥)가 r칸 안에 있는지: 방 입구 근처에는 함정을 만들지 않는다
  function nearCorridor(x, y, r) {
    for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) if (floorAt(xx, yy) && D.room[idx(xx, yy)] < 0) return true;
    return false;
  }
  function randomRoomTile(opts = {}) {
    for (let tries = 0; tries < 400; tries++) {
      const r = opts.room != null ? D.rooms[opts.room] : pick(D.rooms);
      const x = rint(r.x, r.x + r.w - 1), y = rint(r.y, r.y + r.h - 1);
      if (creatureAt(x, y)) continue;
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
    const lvl = Math.round(dg.lv[0] + (dg.lv[1] - dg.lv[0]) * prog);
    const target = 230 + lvl * 6.5;
    const fams = concepts()[dg.id] || [];
    const concept = fams.map(f => f.reduce((best, id) => (Math.abs(bstOf(id) - target) < Math.abs(bstOf(best) - target) ? id : best)))
      .sort((a, b) => Math.abs(bstOf(a) - target) - Math.abs(bstOf(b) - target));
    // 메가 진화의 탑: 메가진화하는 포켓몬(전설 제외)만
    if (dg.megaAll) return { lvl, target, concept: [], cand: megaBases().filter(id => hasSprite(id) && !DATA.species[id].lg).map(id => ({ id, s: DATA.species[id], bst: bstOf(id) })) };
    const all = SPECIES_IDS.map(id => ({ id: +id, s: DATA.species[id], bst: bstOf(id) }))
      .filter(o => !o.s.lg && !UB_IDS.has(o.id) && !concept.includes(o.id) && (!dg.types || o.s.t.some(t => dg.types.includes(t))));
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
    if (run.daily) return new Set();   // 오늘의 도전은 모두 같은 층이어야 하므로 그대로
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
    const para = new Set(dg.extra ? [] : [...PARADOX_PAST, ...PARADOX_FUTURE]);
    while (pool.length < 6 && cand.length) {
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
  function spawnEnemy(pos, sp, lv) {
    if (D.thief) return spawnAngryKecleon(pos);
    sp = sp || (D.want && D.want.size ? weighted(D.pool.map(id => [id, D.want.has(+id) ? WANT_W : 1])) : pick(D.pool));
    const c = makeCreature(sp, run.hard ? run.hardLv : clamp((lv || D.lvl) + rint(-1, 1), 1, MAX_LEVEL));   // 하드모드: 레벨 고정
    c.enemy = true; c.x = pos.x; c.y = pos.y; c.dir = rand(8);
    c.shiny = !!DATA.species[sp].sh && Math.random() < SHINY_CHANCE * (heldOf(run.p).shinyMul || 1);   // 빛나는부적: 리더가 지니면 2배
    Sprites.load(sp, c.shiny);
    rollEnemyForm(c);
    if (run.hard) c.moves = hardMoves(c);
    if (D.dg && D.dg.megaAll) { const st = megaStoneOf(sp); if (st) c.held = st; }   // 메가 진화의 탑: 메가스톤을 지니고 나와서 바로 메가진화
    applyForecast(c);
    D.mons.push(c);
    updateForm(c);
    return c;
  }

  // ── 보스 층: 큰 방 하나, 보스와 부하 둘, 보스를 쓰러뜨리면 계단이 나타난다 ──
  function genBossMap() {
    const W = 54, H = 32, tiles = new Uint8Array(W * H), room = new Int16Array(W * H).fill(-1);
    const R = { x: 13, y: 7, w: 28, h: 18 };
    for (let y = R.y; y < R.y + R.h; y++) for (let x = R.x; x < R.x + R.w; x++) { tiles[y * W + x] = 1; room[y * W + x] = 0; }
    return { w: W, h: H, tiles, room, rooms: [R] };
  }
  function bossSpecies(dg) {
    if (run.floor === dg.floors) {
      const list = bossPool(dg);
      if (list.length) return pick(list);   // 테마 던전: 후보 중 무작위
      const fixed = BOSSES[dg.id];
      if (fixed && DATA.species[fixed]) return fixed;
    } else if (dg.mid && dg.mid.floors.includes(run.floor)) {
      // 중간 보스: 이번 탐험에서 아직 안 나온 후보 중에서
      run.midUsed = run.midUsed || [];
      let list = midPool(dg).filter(id => !run.midUsed.includes(id));
      if (!list.length) list = midPool(dg);
      if (list.length) { const id = pick(list); run.midUsed.push(id); return id; }
    }
    // 로그라이크 중간 보스: 이 층 후보 중 가장 강한 포켓몬
    return D.pool.slice().sort((a, b) => DATA.species[b].b.reduce((s, v) => s + v, 0) - DATA.species[a].b.reduce((s, v) => s + v, 0))[0];
  }
  function setupBossFloor(dg, p) {
    const R = D.rooms[0], cx = R.x + Math.floor(R.w / 2);
    p.x = cx; p.y = R.y + R.h - 2;
    D.stairs = { x: cx, y: R.y + 1 }; D.stairsHidden = true; D.noSpawn = true;
    const sp = bossSpecies(dg);
    const blv = Math.min(MAX_LEVEL, (run.hard ? run.hardLv : D.lvl) + 3);   // 보스는 +3 (최고 레벨은 넘지 않는다)
    const b = spawnEnemy({ x: cx, y: R.y + 3 }, sp, blv);
    b.lv = blv; recalc(b);
    b.boss = true; b.hpMul = 3.5; b.statMul = 1.1; recalc(b); b.hp = b.maxhp;
    // 특별한 모습이 있는 보스는 원래 모습으로 나타났다가, 등장 알림 뒤에 눈앞에서 바뀐다
    bossForm(b, run.floor === dg.floors);
    setForm(b, null); b.hp = b.maxhp;
    if (wantedForm(b)) { b.introForm = true; Sprites.load(wantedForm(b), b.shiny); }   // 바뀔 모습의 그림도 미리 받아 둔다
    b.dir = 0; b.target = { x: p.x, y: p.y };
    D.boss = b;
    for (const dx of [-3, 3]) { const m = spawnEnemy({ x: cx + dx, y: R.y + 4 }); m.dir = 0; }
    Sprites.load(sp);
  }
  // 보스의 모습: 모습을 바꾸는 도구(원시회귀 구슬·금강옥 등·가면·녹슨검/방패)를 지니고, 고르는 모습(테오키스·큐레무·쉐이미·후파)은 하나를 고른다.
  // 적 Lv BOSS_MEGA_LV 이상 던전의 최종 보스는 메가진화 (레쿠쟈는 화룡점정). 싸우는 도중 바뀌는 포켓몬(지가르데·메로엣타 등)은 그 규칙대로
  const BOSS_MEGA_LV = 60;
  function bossForm(b, final) {
    const sp = b.sp;
    if (BATTLE_FORMS[sp]) return;
    const items = Object.keys(ITEMS).filter(k => ITEMS[k].formTo && DATA.species[ITEMS[k].formTo].f[0] === sp);
    const formItems = items.filter(k => !ITEMS[k].mega), megas = items.filter(k => ITEMS[k].mega);
    if (formItems.length) { b.held = pick(formItems); return; }
    if (final && D.dg.lv[1] >= BOSS_MEGA_LV) {
      if (megas.length) { b.held = pick(megas); return; }
      const mv = MEGA_NO_STONE[sp];
      if (mv && FORM_KINDS_MEGA(sp)) { if (!b.moves.some(m => m.id === mv)) b.moves[0] = newMove(b, mv); return; }
    }
    const sel = formsOfKind(sp, 'select');
    if (sel.length) b.selForm = pick(sel);
  }
  const FORM_KINDS_MEGA = sp => formsOfKind(sp, 'mega').length > 0;
  function bossIntro() {
    const b = D.boss; if (!b) return;
    stopAuto();
    Sound.play('boss');
    setFace('Determined', 3000);
    UI.open({
      title: run.floor === D.dg.floors ? '⚠ 보스 층' : '⚠ 중간 보스',
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
    Progress.add('bosses'); checkLater();
    setTimeout(() => { if (D) Sound.dungeon(D.dg); }, Math.max(0, at - now()) + 800);
    D.explored[idx(D.stairs.x, D.stairs.y)] = 1;
    log(`${jo(spName(b.sp), '을')} 쓰러뜨렸다! 계단이 나타났다!`, at + 200);
    setFace('Joyous', 3500);
    const bonus = D.lvl * 15;
    Game.save.money += bonus; run.money += bonus;
    log(`보스 보상으로 ${bonus} 포켓을 받았다.`, at + 300);
    // 좋은 아이템 하나 (이상한사탕, 지닌 물건, 기술머신 중)
    // 전용 도구의 주인이 보스면 가끔 그 도구를 떨어뜨린다
    const sig = sigItemsFor([b.sp]);
    // 초반 보스는 조금 드문 아이템, 그 뒤로는 지닌 물건·기술머신·사탕 (층 레벨보다 한 등급 위까지)
    const id = sig.length && Math.random() < SIG_DROP.boss ? pick(sig) : (rollMega('boss', b.lv, D.dg) || weighted(rewardPool(D.dropLv + 10, D.dg)));
    for (const [dx, dy] of [[0, 0], ...DIRS]) {
      const x = b.x + dx, y = b.y + dy;
      if (floorAt(x, y) && !itemAt(x, y) && !(x === D.stairs.x && y === D.stairs.y)) { D.items.push({ x, y, id, n: 1 }); break; }
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

  function newFloor() {
    run.p.partners = (run.party || []).length;   // 혼자 탐험 보정 (afterPlayer와 같게)
    untransform(run.p); (run.party || []).forEach(untransform);   // 괴짜: 지난 층의 변신을 푼다 (이 층에서 처음 만나는 적으로 다시)
    const dg = dungeonById(run.dungeon);
    const bossFloor = isBossFloor(dg, run.floor);
    if (bossFloor) Sound.boss(); else Sound.dungeon(dg);
    Progress.seedFloor(run);   // 오늘의 도전: 날짜+층으로 맵 고정
    const m = bossFloor ? genBossMap() : genMap();
    D = { ...m, explored: new Uint8Array(m.w * m.h), visible: new Uint8Array(m.w * m.h), items: [], mons: [], corpses: [], popups: [], fx: [],
      prompts: [], learnQueue: [], delayed: [], traps: [], shop: null, houses: [], seq: 0, turn: 0, spawnT: run.hard ? 20 : 40, auto: null, ignore: new Set(), regen: 0, dg };
    const { pool, lvl } = makePool(dg, run.floor);
    D.pool = pool; D.lvl = lvl + (run.hard ? HARD_DROP_LV : 0);   // 하드모드: 아이템·돈은 한 등급 위 (적 레벨은 run.hardLv)
    D.dropLv = dropLvFor(dg, run.floor, D.lvl);   // 아이템 단계를 정하는 레벨 (로그라이크는 층 진행으로)
    D.weather = rollWeather(dg); CUR_WEATHER = D.weather; D.baseWeather = D.weather; D.wxLock = null;
    pool.forEach(id => Sprites.load(id));
    // 탐험대가 바뀔 수 있는 모습(메가진화·폼체인지)의 그림도 미리 받아 둔다
    for (const c of [run.p, ...(run.party || [])]) if (c && FORMS_OF[c.sp]) for (const f of FORMS_OF[c.sp]) if (!formsOfKind(c.sp, 'select').includes(f) || f === c.selForm) Sprites.load(f, c.shiny);
    // 플레이어
    const p = run.p;
    D.player = p;
    p.noSleep = false;   // 유루열매는 그 층에서만 (랑사열매는 100턴)
    if (bossFloor) {
      p.dir = 4; p.tween = null; p.act = null; p.stages = p.stages || {}; p.stageT = p.stageT || {};
      p.charging = null; p.rampage = null; p.recharge = false; p.chain = null; p.struck = new Set(); p.lastActSeq = p.lastHurtSeq = 0;
      setupBossFloor(dg, p);
      computeVis();
    } else {
    const startRoom = rand(D.rooms.length);
    const sp = randomRoomTile({ room: startRoom });
    p.x = sp.x; p.y = sp.y; p.dir = 0; p.tween = null; p.act = null; p.stages = p.stages || {}; p.stageT = p.stageT || {};
    p.charging = null; p.rampage = null; p.recharge = false; p.chain = null; p.struck = new Set(); p.lastActSeq = p.lastHurtSeq = 0;
    // 계단
    let sroom = rand(D.rooms.length);
    if (D.rooms.length > 1) while (sroom === startRoom) sroom = rand(D.rooms.length);
    D.stairs = randomRoomTile({ room: sroom, noItem: true });
    const freeRooms = D.rooms.map((_, i) => i).filter(i => i !== startRoom && i !== sroom);
    if (lvl >= FEATURE_LV.shop && Math.random() < SHOP_CHANCE) makeShop(freeRooms);
    // 몬스터하우스: 보통은 한 층에 하나까지. 하드모드는 2층부터 더 자주, 여러 개
    const houseN = () => {
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
      for (let i = rint(2, 4) + Math.floor(lvl / 25); i > 0; i--) {
        const t = randomRoomTile({ noItem: true, far: 3 });
        // 복도와 붙은 칸(방 출입구 옆)에는 만들지 않는다
        if (t && !nearCorridor(t.x, t.y, 2)) { const kind = pick(kinds); D.traps.push({ ...t, kind, seen: TRAP_VISIBLE.includes(kind) }); }
      }
    }
    // 아이템 / 돈
    const nItems = rint(ITEMS_PER_FLOOR[0], ITEMS_PER_FLOOR[1]);
    for (let i = 0; i < nItems; i++) { const t = randomRoomTile({ noItem: true }); if (t) { const id = rollMega('floor', lvl, D.dg) || pickDrop(D.dropLv, D.dg); D.items.push(id ? { ...t, id, n: 1 } : { ...t, money: moneyPile(lvl) }); } }
    // 전용 도구: 그 주인이 이 층에 나오면 드물게 바닥에 하나
    const sig = sigItemsFor(pool);
    if (sig.length && Math.random() < SIG_DROP.floor) { const t = randomRoomTile({ noItem: true }); if (t) D.items.push({ ...t, id: pick(sig), n: 1 }); }
    D.items.forEach(it => { if (it.id && ITEMS[it.id].stack) it.n = rint(3, 9); });
    const nMoney = rint(2, 4);
    for (let i = 0; i < nMoney; i++) { const t = randomRoomTile({ noItem: true }); if (t) D.items.push({ ...t, money: moneyPile(lvl) }); }
    // 적
    computeVis();
    const nEn = Math.min(10, rint(4, 6) + Math.floor(run.floor / 3));
    for (let i = 0; i < nEn; i++) {
      const t = randomRoomTile({ far: 5 }); if (!t) continue;
      const e = spawnEnemy(t);
      if (Math.random() < NAP_CHANCE) { e.napping = true; e.status = 'slp'; e.statusT = 99999; }   // 가끔 제자리에서 자고 있다
    }
    }
    placeAllies(p);
    // 임무 대상 (하드모드는 임무 없음)
    if (dg.mode === 'normal' && !run.hard) {
      for (const ms of Game.save.missions.accepted) {
        if (ms.dungeon !== dg.id || ms.floor !== run.floor || run.done.includes(ms.id)) continue;
        const t = randomRoomTile({ noItem: true, far: 4 });
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
    buildMapCanvas();
    computeVis();
    const fname = `${dg.n} ${run.floor}F`;
    log(`— ${fname} —`, now());
    const here = dg.mode === 'normal' && !run.hard ? Game.save.missions.accepted.filter(ms => ms.dungeon === dg.id && ms.floor === run.floor && !run.done.includes(ms.id)) : [];
    if (here.length) { log(`📜 이 층에 임무 대상이 있다! (${here.length}개, J로 확인)`, now()); Sound.play('mission', now() + 500); D.prompts.push(() => { stopAuto(); Game.missionAlert(here); }); }   // 메시지만으로는 놓치기 쉬워서 알림 창도 (v0.84)
    if (D.weather) log(`날씨: ${WEATHERS[D.weather].icon} ${WEATHERS[D.weather].n} — ${WEATHERS[D.weather].d}`, now());
    showFloorBanner(fname + (D.weather ? `\n${WEATHERS[D.weather].icon} ${WEATHERS[D.weather].n}` : ''));
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
      a.charging = null; a.rampage = null; a.recharge = false; a.struck = new Set(); a.target = null;
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
      if (!floorAt(x, y)) return false;
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
        if (r >= 0 && (dx === 0 || dy === 0 || floorAt(v.x + dx, v.y) || floorAt(v.x, v.y + dy))) rs.add(r);
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
    if (!abilityOf(c).forecast) return;
    c.types = [{ sun: 10, rain: 11, snow: 15 }[weatherNow()] || 1];
    if (D && D.player) formCheck(c);
  }
  // 폼체인지·메가진화 (js/forms.js): 모습이 바뀌었으면 알림과 효과. quiet면 알림 없이 (모르페코처럼 자주 바뀌는 경우)
  function formCheck(c, at, quiet) {
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
  function floorStartAbility(p) {
    p.seeded = null; p.yawnT = 0; p.protecting = false;   // 지난 층의 씨앗(심은 적은 이 층에 없다)·하품
    resetBattleForm(p, D.weather);
    if (run.floor > 1 || run.sos) p.hero = true;   // 돌핀맨: 계단을 내려간 뒤로는 마이티폼
    formCheck(p, now() + 500);
    const A = abilityOf(p), at = now() + 600;
    if (!p.player) {
      if (A.slowStart) p.slowT = 10;
      // 날씨 특성: 리더 → 동료 순서로 먼저 바꾼 쪽이 이긴다 (여럿이 서로 덮어쓰지 않게)
      // 단, 전용 날씨(원시회귀·델타스트림)는 보통 날씨보다 앞선다 (리더가 가뭄이어도 동료 원시가이오가의 강한 비)
      const extreme = EXTREME_WX.includes(A.setWeather) && !EXTREME_WX.includes(D.weather);
      if (A.setWeather && (!D.wxByParty || extreme)) { setWeather(A.setWeather, p, at); D.wxByParty = true; }
      applyForecast(p);
      if (A.download) statChange(p, p.atk >= p.spa ? 2 : 4, 1, at, p);
      if (A.floorStart) statChange(p, A.floorStart[0], A.floorStart[1], at, p);
      if (A.floorRandom) statChange(p, pick([2, 3, 4, 5, 7, 8]), 1, at, p);
      if (A.pickup && Math.random() < A.pickup) { const id = weighted(dropTable(D.dropLv, D.dg)); if (addToBag(id)) abLog(p, `${jo(nm(p), '이')} ${jo(ITEMS[id].n, '을')} 주워 왔다!`, at); }
      if (A.honey && Math.random() < 0.2 && addToBag('apple')) abLog(p, `${jo(nm(p), '이')} 사과를 발견했다!`, at);
      return;
    }
    if (A.slowStart) p.slowT = 10;
    if (A.setWeather) { setWeather(A.setWeather, p, at); D.wxByParty = true; }
    applyForecast(p);
    if (A.download) statChange(p, p.atk >= p.spa ? 2 : 4, 1, at, p);
    if (A.floorStart) statChange(p, A.floorStart[0], A.floorStart[1], at, p);
    if (A.floorRandom) statChange(p, pick([2, 3, 4, 5, 7, 8]), 1, at, p);
    if (A.pickup && Math.random() < A.pickup) { const id = weighted(dropTable(D.dropLv, D.dg)); if (addToBag(id)) abLog(p, `${jo(ITEMS[id].n, '을')} 주워 왔다!`, at); }
    if (A.honey && Math.random() < 0.2 && addToBag('apple')) abLog(p, '사과를 발견했다!', at);
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
      if (e.shiny) { Sound.play('shiny', at); log(`✨ 색이 다른 ${jo(spName(e.sp), '이')} 나타났다!`, at); setFace('Surprised', 2000); D.fx.push({ kind: 'ring', x: e.x, y: e.y, at, dur: 700, color: '#fff6a0' }); Game.noteShiny(e.sp); }
      for (const [st, m] of byStat) intimidate(m, e, st, at);
      const ea = abilityOf(e);
      // 괴짜: 이 층에서 처음 마주친 적으로. 등장 후 변신하는 보스가 있는 층에서는 보스가 변신할 때까지 기다렸다가 변신 후 모습으로 (bossTransform)
      const bossWait = D.boss && D.boss.introForm && D.boss.hp > 0;
      if (!bossWait) for (const m of team) if (abilityOf(m).imposter && !m.tf) transformInto(m, e, at);
      if (ea.imposter && !e.tf) transformInto(e, p, at);   // 적 메타몽: 리더로
      if (ea.intimidate) for (const m of team) intimidate(e, m, ea.intimidate, at);
      if (ea.setWeather) setWeather(ea.setWeather, e, at);
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
  function diagOK(x, y, dx, dy) { return !(dx && dy) || (floorAt(x + dx, y) && floorAt(x, y + dy)); }
  function canStep(c, dx, dy) {
    const x = c.x + dx, y = c.y + dy;
    return floorAt(x, y) && diagOK(c.x, c.y, dx, dy) && !creatureAt(x, y);
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
        if (!floorAt(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (prev[ni] !== -1) continue;
        if (opts.known && !D.explored[ni]) continue;
        if (!diagOK(x, y, DIRS[d][0], DIRS[d][1])) continue;
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
  function useMove(user, slot, dir, opts = {}) {
    const mid = slot < 0 ? null : user.moves[slot].id;
    const R = (mid && MOVE_RULES[mid]) || {};
    const mastery = slot >= 0 && party(user) && (!opts.free || opts.release) && !run.hard && !user.tf;   // 이번 사용이 숙련도에 들어가나 (하드모드는 레벨처럼 성장 없음)
    let move = slot < 0 ? NORMAL_ATTACK : DATA.moves[mid];
    const wbT = { sun: 10, rain: 11, sand: 6, snow: 15 }[weatherNow()];
    if (R.weatherBall && wbT) move = { ...move, t: wbT, p: 100 };
    if (slot >= 0 && !opts.free) {
      if (party(user) && Math.random() < masteryFree(user.sp, mid)) log(`${jo(nm(user), '은')} PP를 쓰지 않았다! (숙련도)`, T.base);
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
    const fail = msg => { log(msg || '그러나 실패했다!', hitAt); user.lastMissed = true; };
    const blk = WX_BLOCK[weatherRaw()];
    if (blk && move.c !== 1 && moveType(user, move) === blk) return fail(blk === 11 ? '아주 강한 햇살에 물 기술이 증발해 버렸다!' : '강한 비에 불꽃 기술이 꺼져 버렸다!');
    if (R.focus && ctx.hurtSince) return fail(`${jo(nm(user), '은')} 집중이 흐트러져서 기술을 쓸 수 없었다!`);
    if (R.needSleepSelf && user.status !== 'slp') return fail();
    if (R.hpCostPct) {
      const cost = Math.floor(user.maxhp * R.hpCostPct / 100);
      if (user.hp <= cost) return fail();
      user.hp -= cost; popup(user, '-' + cost, '#ff8a8a', hitAt);
      log(`${jo(nm(user), '은')} HP를 깎아 힘을 끌어올렸다!`, hitAt);
    }
    let targets = [];
    const [dx, dy] = DIRS[dir];
    if (move.r === 'f') {
      const t = creatureAt(user.x + dx, user.y + dy);
      if (t && hostileTo(user, t) && diagOK(user.x, user.y, dx, dy)) targets = [t];
      else if ((!t || (party(user) && party(t))) && R.reach >= 2 && floorAt(user.x + dx, user.y + dy) && diagOK(user.x, user.y, dx, dy)) {   // 선공기: 바로 앞이 비었으면 한 칸 너머
        const t2 = creatureAt(user.x + 2 * dx, user.y + 2 * dy);
        if (t2 && hostileTo(user, t2) && diagOK(user.x + dx, user.y + dy, dx, dy)) targets = [t2];
      }
    } else if (move.r === 'p') {
      let x = user.x, y = user.y;
      for (let i = 0, n = PROJ_RANGE; i < n; i++) {   // 직선 기술은 대각선 벽 모서리를 스쳐 지나간다
        x += dx; y += dy;
        if (!floorAt(x, y)) break;
        const t = creatureAt(x, y);
        if (t && party(user) && party(t)) continue;   // 탐험대의 직선 기술은 동료를 지나간다
        if (t) { if (hostileTo(user, t)) targets = [t]; break; }
      }
      D.fx.push({ kind: 'proj', x0: user.x, y0: user.y, x1: targets[0]?.x ?? x, y1: targets[0]?.y ?? y, at: t0 + dur * 0.3, dur: dur * 0.3, color });
    } else if (move.r === 'r') {
      const pool = [D.player, ...D.mons].filter(t => t && t.hp > 0);
      targets = pool.filter(t => hostileTo(user, t) && Math.max(Math.abs(t.x - user.x), Math.abs(t.y - user.y)) <= 3 && los(user.x, user.y, t.x, t.y));
      D.fx.push({ kind: 'ring', x: user.x, y: user.y, at: t0 + dur * 0.3, dur: 350 * spd(), color });
    }
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
    if (mastery && user.landed) addMastery(user, user.moves[slot]);
    afterUse();

    function afterUse() {
      if (R.chain && user.chain) user.chain.n++;
      if (R.recharge) user.recharge = true;
      if (R.selfKO && user.hp > 1) {
        popup(user, '-' + (user.hp - 1), '#ff8a8a', hitAt + 100);
        user.hp = 1; user.hurtAt = hitAt + 100;
        log(`${jo(nm(user), '은')} 힘을 모두 써버려서 HP가 1만 남았다!`, hitAt + 100);
      }
      if (R.selfDmgPct) {
        const amt = Math.min(Math.floor(user.maxhp * R.selfDmgPct / 100), user.hp - 1);
        if (amt > 0) { user.hp -= amt; user.hurtAt = hitAt + 100; popup(user, '-' + amt, '#ff8a8a', hitAt + 100); log(`${jo(nm(user), '은')} 반동으로 데미지를 입었다.`, hitAt + 100); }
      }
      if (R.rampage) {
        if (!opts.free) user.rampage = { slot, left: rint(1, 2) };
        else if (user.rampage && --user.rampage.left <= 0) {
          user.rampage = null;
          log(`${jo(nm(user), '은')} 난동을 부린 끝에 지쳐버렸다!`, hitAt + 150);
          inflict(user, 'cnf', hitAt + 150);
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
    const foes = [D.player, ...D.mons].filter(m => hostileTo(c, m));
    const adj = foes.find(f => Math.max(Math.abs(f.x - c.x), Math.abs(f.y - c.y)) === 1 && diagOK(c.x, c.y, Math.sign(f.x - c.x), Math.sign(f.y - c.y)));
    const dir = adj ? dirIndex(adj.x - c.x, adj.y - c.y) : c.dir;
    useMove(c, c.rampage.slot, confuse(c, dir), { free: true });
  }

  const abLog = (c, text, at) => { if (c.player || seen(c)) log(`[${abilityName(c.ability)}] ${text}`, at); };

  function resolveHit(user, tgt, move, at, R = {}) {
    if (tgt.hp <= 0) return;
    if (tgt.protecting && tgt !== user) { log(`${jo(nm(tgt), '은')} 공격으로부터 몸을 지켰다!`, at); popup(tgt, '방어', '#9fd8ff', at); user.lastMissed = true; return; }
    if (tgt.charging && tgt.charging.invuln) { log(`${nm(tgt)}에게 공격이 닿지 않았다!`, at); user.lastMissed = true; return; }
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
      if (Dd.disguise && !tgt.disguiseBroken && r.dmg > 0) {   // 탈: 층마다 첫 공격을 탈이 대신 맞는다
        tgt.disguiseBroken = true; abLog(tgt, `${nm(tgt)}의 탈이 대신 공격을 받았다! 탈이 벗겨졌다!`, at);
        damage(tgt, pctDmg(tgt, 1 / 8), null, at); return;
      }
      if (move.c === 2 && tgt.sp === 875 && !tgt.noice && (tgt.baseAbility ?? tgt.ability) === 248 && !A.moldBreaker) {
        abLog(tgt, `${jo(nm(tgt), '은')} 얼음 얼굴로 공격을 막아냈다!`, at); tgt.noice = true; formCheck(tgt, at); return;
      }
      let total = r.dmg;
      let hits = move.hits ? (A.skillLink ? move.hits[1] : rint(move.hits[0], move.hits[1])) : 1;
      if (R.popBomb && !A.skillLink) { hits = 1; while (hits < move.hits[1] && Math.random() < 0.9) hits++; }
      for (let i = 1; i < hits; i++) total += calcHit(user, tgt, { ...move, a: 0, p: R.escalate ? move.p * (i + 1) : move.p }).dmg || 0;
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
      log(`${jo(nm(tgt), '은')} ${total}의 데미지를 입었다.` + (hits > 1 ? ` (${hits}회)` : ''), at, ec);
      if (total > 0) Sound.play(tgt.player ? 'hurt' : r.crit ? 'crit' : r.eff > 1 ? 'super' : r.eff < 1 ? 'weak' : 'hit', at);
      const hpBefore = tgt.hp;
      if (total > 0) damage(tgt, total, user, at, r.eff, r.crit);
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
      if (tgt.hp > 0 && A.stench && Math.random() < 0.1 * serene) setFlinch(tgt, at);
      if (tgt.hp > 0 && A.poisonTouch && Math.random() < 0.3) inflict(tgt, 'psn', at, false, user);
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
      if (move.sc) for (const [st, ch] of move.sc) if (ch > 0) statChange(t, st, ch * scMul, at, t);
      if (R.cure && t.status) { t.status = null; t.statusT = 0; log(`${nm(t)}의 상태 이상이 나았다!`, at); }
      if (R.screen) { t[R.screen === 'phys' ? 'reflectT' : 'screenT'] = SCREEN_TURNS; log(`${nm(t)}에게 ${jo(R.screen === 'phys' ? '리플렉터' : '빛의장막', '이')} 생겼다! (${SCREEN_TURNS}턴)`, at); }
      D.fx.push({ kind: 'ring', x: t.x, y: t.y, at, dur: 300 * spd(), color: '#fff6a0' });
    }
  }
  function heal(c, amt, at) {
    const before = c.hp; c.hp = Math.min(c.maxhp, c.hp + amt);
    if (party(c) && c.hp > before) runStat(c).heal += c.hp - before;
    if (c.hp > before) { if (c.player) Sound.play('heal', at); popup(c, '+' + (c.hp - before), '#7f7', at); log(`${jo(nm(c), '은')} HP를 ${c.hp - before} 회복했다.`, at); }
  }
  // src: 능력 변화를 일으킨 쪽 (상대가 떨어뜨렸는지 판정)
  function statChange(c, st, ch, at, src) {
    const A = abilityOf(c), byFoe = src && src !== c;
    if (A.contrary) ch = -ch;
    if (A.simple) ch *= 2;
    if (ch < 0 && byFoe) {
      const nd = A.noDrop;
      if (nd && (nd === 'all' || nd.includes(st))) { abLog(c, `${nm(c)}의 ${jo(STAT_NAMES[st], '은')} 떨어지지 않는다!`, at); return; }
      if (heldOf(c).noDrop) { log(`${ITEMS[c.held].n}의 힘으로 ${nm(c)}의 ${jo(STAT_NAMES[st], '은')} 떨어지지 않았다!`, at); return; }
    }
    const cur = c.stages[st] || 0, nv = clamp(cur + ch, -6, 6);
    if (nv === cur) {   // 이미 최대: 가장 적게 남은 랭크의 지속 시간을 새로 센다
      stageRefresh(c, st, Math.abs(ch));
      log(`${nm(c)}의 ${jo(STAT_NAMES[st], '은')} 더 이상 ${ch > 0 ? '오르지' : '떨어지지'} 않는다! (지속 시간 갱신)`, at); return;
    }
    c.stages[st] = nv; stageTimer(c, st);
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
    if (kind === 'slp' && c.noSleep) { log(`${jo(nm(c), '은')} 유루열매 덕분에 잠들지 않았다!`, at); return; }
    if (heldOf(c).noStatus && heldOf(c).noStatus.includes(kind)) { log(`${jo(nm(c), '은')} ${ITEMS[c.held].n}의 힘으로 ${STATUS_NAMES[kind]} 상태를 막았다!`, at); return; }
    if (A.noStatus && A.noStatus.includes(kind)) { abLog(c, `${jo(nm(c), '은')} ${STATUS_NAMES[kind]} 상태가 되지 않는다!`, at); return; }
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
  function damage(c, amt, src, at, eff = 1, crit = false) {
    if (c.hp <= 0) return;
    if (src && party(src) && !party(c)) { wakeNap(c, at, true); if (src.player) c.provoked = true; }
    if (src && src !== c) { c.lastHurt = amt; c.lastHurtTurn = D.turn; }   // 앙갚음용: 공격으로 받은 데미지   // 잠든 적은 맞으면 깬다 / 리더가 공격한 적 (먼저 공격하지마 작전)
    const A = abilityOf(c);
    if (!src && A.magicGuard) return;
    if (A.sturdy && c.hp >= c.maxhp && amt >= c.hp && c.maxhp > 1) { amt = c.hp - 1; abLog(c, `${jo(nm(c), '은')} 공격을 버텼다!`, at); }
    const H = heldOf(c);
    if (amt >= c.hp && c.hp > 1 && ((H.sash && c.hp >= c.maxhp) || (H.band && Math.random() < H.band))) {
      amt = c.hp - 1; log(`${jo(nm(c), '은')} ${jo(ITEMS[c.held].n, '으로')} 버텼다!`, at);
    }
    const wasAboveHalf = c.hp > c.maxhp / 2;
    // 탐험대 기록: 준 데미지·받은 데미지 (쓰러뜨릴 때 넘친 만큼은 빼고)
    const real = Math.max(0, Math.min(amt, c.hp));
    if (src && party(src) && !party(c)) runStat(src).dealt += real;
    if (party(c)) runStat(c).taken += real;
    c.hp -= amt; c.hurtAt = at;
    if (A.berserk && wasAboveHalf && c.hp > 0 && c.hp <= c.maxhp / 2 && !c.berserkUsed) { c.berserkUsed = true; abLog(c, `${jo(nm(c), '은')} 발끈했다!`, at); statChange(c, 4, 1, at, c); }
    if (c.player && amt >= c.maxhp * 0.2) setFace('Pain', 1200);
    c.lastHurtSeq = ++D.seq; c.lastHurtBy = src ? src.id : null;
    if (crit) popup(c, amt + (eff > 1 ? '!!' : '!'), '#ff5ce1', at, 'big');
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
  function faint(c, src, at) {
    if (c.player) {
      const bi = run.bag.findIndex(b => b.id === 'reviver');
      if (bi >= 0) {
        takeFromBag(bi);
        c.hp = c.maxhp; c.status = null; c.stages = {};
        log(`쓰러졌지만 부활씨의 힘으로 되살아났다!`, at);
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
      if (sa.onKO) statChange(src, sa.onKO === 'best' ? (src.atk >= src.spa ? 2 : 4) : 2, 1, at, src);
    }
    if (src && abilityOf(c).aftermath && src.hp > 0) { abLog(c, `${jo(nm(src), '은')} 폭발에 휘말렸다!`, at); damage(src, pctDmg(src, 1 / 4), c, at); }
    if (byParty) {
      const expOf = m => Math.floor(expGain(c, m.lv) * (c.outlaw || c.boss ? BOSS_EXP_MUL : 1) * (c.shiny ? 2 : 1) * (heldOf(m).expMul || 1) * (run.mode === 'rogue' ? ROGUE_EXP_MUL : 1));
      gainExp(expOf(P()), at);
      for (const a of allies()) allyExp(a, expOf(a), at);   // 동료도 같은 방식으로 경험치를 받는다
      const free = !itemAt(c.x, c.y) && !(D.stairs.x === c.x && D.stairs.y === c.y);
      const sig = sigItemsFor([c.sp]);
      if (c.shiny && free) D.items.push({ x: c.x, y: c.y, id: rollMega('shiny', c.lv, D.dg) || weighted(rewardPool(D.dropLv + 10, D.dg)), n: 1 });   // 이로치: 보스 보상과 같은 등급
      else if (sig.length && !c.boss && free && Math.random() < SIG_DROP.defeat) D.items.push({ x: c.x, y: c.y, id: pick(sig), n: 1 });
      else if (Math.random() < ENEMY_DROP_CHANCE && free) { const id = rollMega('floor', c.lv, D.dg) || pickDrop(D.dropLv, D.dg); D.items.push(id ? { x: c.x, y: c.y, id, n: 1 } : { x: c.x, y: c.y, money: moneyPile(D.lvl) }); }
      if (c.shiny && Game.unlockShiny(c.sp)) log(`✨ 이제 캐릭터 탭에서 ${jo(spName(c.sp), '과')} 그 진화 계열의 이로치 모습을 고를 수 있다!`, at + 300);
      if (run.mode === 'normal' && !c.outlaw && !NO_RECRUIT.includes(c.sp) && canRecruit(c.sp, Game.save.roster)) {   // 남은 진화가 없으면 진화 전 모습은 영입하지 않는다 (js/defs.js)
        const rate = recruitRate(P().lv) * (DATA.species[c.sp].lg ? 0.5 : 1) * (heldOf(P()).recruitMul || 1);
        if (Math.random() < rate) D.prompts.push(() => recruitPrompt(c));
      }
    }
    if (c.boss) bossDefeated(c, at);
    if (c.outlaw) missionDone(c.mission, `수배범 ${jo(spName(c.sp), '을')} 붙잡았다!`);
  }
  // 동료의 경험치: 레벨이 오르면 새 기술은 빈 칸에만 (나머지는 마을의 기술 설정에서)
  function allyExp(a, amt, at) {
    if (a.lv >= MAX_LEVEL || run.hard) return;   // 하드모드: 경험치 없음
    a.exp += Math.max(1, Math.floor(amt / expDiv(a.sp)));
    while (a.lv < MAX_LEVEL && a.exp >= expFor(a.lv + 1)) {
      a.lv++; recalc(a);
      log(`${jo(nm(a), '은')} 레벨 ${jo(a.lv, '으로')} 올랐다!`, at);
      popup(a, 'LEVEL UP', '#ffe066', at + 200);
      for (const mid of learnedAtAll(a.sp, a.lv)) if (!a.moves.some(m => m.id === mid) && a.moves.length < 4) { a.moves.push(newMove(a, mid)); log(`${jo(nm(a), '은')} ${jo(DATA.moves[mid].n, '을')} 배웠다!`, at); }
    }
  }
  // raw: 이상한사탕처럼 정해진 만큼 (전설 보정 없이)
  function gainExp(amt, at, raw) {
    const p = P();
    if (p.lv >= MAX_LEVEL || run.hard) return;
    if (!raw) amt = Math.max(1, Math.floor(amt / expDiv(p.sp)));
    p.exp += amt;
    log(`경험치를 ${amt} 얻었다.`, at);
    while (p.lv < MAX_LEVEL && p.exp >= expFor(p.lv + 1)) {
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
  const STAGE_TURNS = 100;
  function stageTimer(c, st) {
    c.stageS = c.stageS || {}; c.stageT = c.stageT || {};
    const v = c.stages[st] || 0, n = Math.abs(v);
    let e = c.stageS[st];
    if (!e || e.s !== Math.sign(v)) e = { s: Math.sign(v), t: [] };
    e.t.sort((a, b) => b - a);
    while (e.t.length > n) e.t.pop();
    while (e.t.length < n) e.t.push(STAGE_TURNS);
    if (n) { c.stageS[st] = e; c.stageT[st] = Math.min(...e.t); }
    else { delete c.stageS[st]; delete c.stageT[st]; }
  }
  // 이미 최대(±6)인데 같은 쪽으로 또 바꾸면: 가장 적게 남은 랭크부터 k개를 새로 센다
  function stageRefresh(c, st, k) {
    stageTimer(c, st);
    const e = c.stageS[st]; if (!e) return;
    e.t.sort((a, b) => a - b);
    for (let i = 0; i < Math.min(k, e.t.length); i++) e.t[i] = STAGE_TURNS;
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
  const TACTIC_NAMES = { follow: '나를 따라와', free: '각자 행동', wait: '여기서 기다려', attack: '적을 공격해', passive: '먼저 공격하지마' };
  const TACTIC_DESC = {
    follow: '리더 뒤에 줄지어 따라오고, 나나 동료 가까이 온 적을 가까운 것부터 처리하고 다시 따라온다',
    free: '보이는 적을 각자 쫓아가 싸우고, 적이 없으면 근처로 모인다',
    wait: '그 자리에서 기다린다. 옆에 온 적에게만 반격한다',
    attack: '멀리 있는 적도 쫓아가 공격한다. 보스가 보이면 보스부터 (보스 방에서 유용)',
    passive: '리더가 공격한 적만 상대하고, 그 밖에는 따라오기만 한다',
  };
  // 동료 창: 동료의 HP·상태·지닌 물건·기술 PP·능력 변화, 작전
  function partyMenu() {
    if (!run || !(run.party || []).length) { log('함께 온 동료가 없다.', now()); return; }
    const row = a => {
      const pc = a.fainted ? 0 : a.hp / a.maxhp * 100, st = stageText(a);
      return `<div class="pm-card${a.fainted ? ' out' : ''}"><div class="row">${portraitImg(looksOf(a), 'portrait sm', a.fainted ? 'Pain' : 'Normal', a.shiny)}<div class="grow">
        <b>${esc(nm(a))}</b> Lv${a.lv} ${typeBadges(a.types)}${a.fainted ? ' <span class="warn">쓰러짐 (이번 탐험에서 빠짐)</span>' : ''}
        <div>HP ${a.fainted ? 0 : a.hp}/${a.maxhp} <span class="bar small"><i style="width:${pc}%;background:${pc > 50 ? '#4de36b' : pc > 20 ? '#f5d142' : '#f55'}"></i></span>${a.status ? ` <span class="warn">${STATUS_NAMES[a.status]}</span>` : ''}${D.mons.includes(a) ? ` · 나와의 거리 ${cheb(a, P())}칸` : ''}</div>
        <div class="dim">특성 ${esc(abilityName(a.ability))}${a.held ? ` · ${ITEMS[a.held].icon} ${esc(ITEMS[a.held].n)}` : ''}${st ? ` · 능력 변화 ${esc(st)}` : ''}</div></div></div>
        <div class="pm-moves">${a.moves.map(m => { const d = DATA.moves[m.id]; return `<span class="type" style="background:${TYPE_COLORS[d.t - 1]}">${typeName(d.t)}</span> ${esc(d.n)}${masteryStar(a.sp, m.id)} <span class="dim">PP ${m.pp}/${m.max}</span>`; }).join('<br>')}</div></div>`;
    };
    UI.open({ title: '🤝 동료', wide: true,
      html: `<div class="row"><span class="grow">작전: <b>${TACTIC_NAMES[tactic()]}</b> <span class="dim">${TACTIC_DESC[tactic()]}</span></span></div>
        ${run.party.map(row).join('')}`,
      choices: [...Object.entries(TACTIC_NAMES).map(([k, n]) => ({ label: `${k === tactic() ? '✔ ' : ''}작전: ${n}`, sub: TACTIC_DESC[k], fn: () => { run.tactic = k; log(`🤝 작전: ${n}`, now()); partyMenu(); } })),
        ...(liveAllies().length && run.bag.some(b => ALLY_USES.includes(ITEMS[b.id].use)) ? [{ label: '🎒 동료에게 아이템 쓰기', fn: allyBag }] : []),
        ...(downAllies().length && run.bag.some(b => b.id === 'reviver') ? [{ label: `🌰 쓰러진 동료 되살리기 (부활씨 ${run.bag.filter(b => b.id === 'reviver').length}개)`, fn: () => pickReviveFor(run.bag.findIndex(b => b.id === 'reviver'), partyMenu) }] : []),
        ...(liveAllies().length ? [{ label: '🎁 동료 지닌 물건 바꾸기', fn: () => pickAlly('누구의 지닌 물건을 바꿀까?', allyHeld) },
          { label: '📘 동료 기술 바꾸기', fn: () => pickAlly('누구의 기술을 바꿀까?', allyMoves) }] : []),
        { label: '닫기', fn: () => {} }] });
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
    UI.open({ title: `🎁 ${esc(nm(a))}의 지닌 물건: ${a.held ? ITEMS[a.held].icon + ' ' + esc(ITEMS[a.held].n) : '없음'}`, wide: true,
      choices: [...list.map(({ b, i }) => ({ label: `${ITEMS[b.id].icon} ${esc(ITEMS[b.id].n)}`, sub: esc(heldBlockReason(ab, b.id) || ITEMS[b.id].d), disabled: !!heldBlockReason(ab, b.id), fn: () => swap(i) })),
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
      const lead = P(), t = tactic();
      // 따라와: 리더나 동료(자기 포함) 가까이 온 적을 가까운 것부터 처리한 뒤 다시 따라간다
      const near = m => cheb(m, lead) <= 3 || allies().some(a => cheb(m, a) <= 2);
      const ok = {
        follow: m => cheb(m, e) <= ALLY_SIGHT && near(m),
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
  function markMoved(c, fx, fy) { c.trail = { x: fx, y: fy, turn: D.turn }; }
  // 동료가 싸울 상대가 없으면 앞사람을 따라간다: 리더 → 동료1 → 동료2 … 줄지어 (멀리 떨어졌으면 한 턴에 두 칸)
  function followLeader(a) {
    if (a.swapped === D.turn) return;   // 방금 리더와 자리를 바꿨다
    if (tactic() === 'wait') return;   // 여기서 기다려
    const order = (D.allyOrder || allies()).filter(m => m.hp > 0 && D.mons.includes(m));
    const k = order.indexOf(a), prev = k > 0 ? order[k - 1] : P();
    const free = tactic() === 'free' || tactic() === 'attack', fx = a.x, fy = a.y;
    const d = cheb(a, prev);
    if (free && d <= 3) return;   // 각자 행동: 너무 멀어지지만 않게
    // 앞사람이 이번 턴에 비운 칸으로 바로 들어간다
    const tr = prev.trail;
    if (!free && tr && tr.turn === D.turn && cheb(a, tr) === 1 && !creatureAt(tr.x, tr.y) && diagOK(a.x, a.y, tr.x - a.x, tr.y - a.y)) {
      const mx = tr.x - a.x, my = tr.y - a.y;
      a.x = tr.x; a.y = tr.y; a.dir = dirIndex(mx, my);
      schedMove(a, fx, fy); markMoved(a, fx, fy); return;
    }
    if (d <= 1) return;
    for (let step = d > 5 ? 2 : 1; step > 0; step--) {
      if (cheb(a, prev) <= 1) break;
      const near = (x, y) => Math.max(Math.abs(x - prev.x), Math.abs(y - prev.y)) === 1;
      const path = bfs(a.x, a.y, near, { blockMons: true, self: a }) || bfs(a.x, a.y, near, { self: a });   // 막혀 있으면 다른 포켓몬을 무시하고 길을 찾는다
      if (!path) break;
      const mx = path.fx - a.x, my = path.fy - a.y;
      const b = creatureAt(a.x + mx, a.y + my);
      if (b && b.ally && b.swapped !== D.turn && diagOK(a.x, a.y, mx, my)) {   // 길을 막은 동료와 자리를 바꾼다 (막다른 길에서 되돌아갈 때)
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
  function allySupport(e, foe) {
    const boss = !!(foe && foe.boss) || !!(D.boss && D.boss.hp > 0 && seen(D.boss));
    const team = [P(), ...allies()].filter(m => m.hp > 0 && cheb(m, e) <= TEAM_RANGE && los(e.x, e.y, m.x, m.y));
    const moves = e.moves.map((m, i) => ({ m: DATA.moves[m.id], i, id: m.id, pp: m.pp })).filter(o => o.pp > 0 && o.m && o.m.c === 1 && o.m.r === 's' && !(e.tauntT));
    let best = null;
    for (const o of moves) {
      const R = MOVE_RULES[o.id] || {}, who = R.team ? team : R.allyHeal ? team.filter(m => m !== e) : [e];   // 치유파동: 자신 말고 같은 편
      let s = 0;
      if (o.m.h > 0) {   // 회복: 가장 다친 대상 기준
        const low = Math.min(...who.map(m => m.hp / m.maxhp));
        if (low < 0.35) s = 100; else if (low < (boss ? 0.6 : 0.5)) s = 60;
      } else if (R.setWx) {   // 날씨: 싸우는 중이고, 지금 날씨보다 탐험대에 확실히 좋으면 (전용 날씨가 버티고 있으면 안 바뀌니 쓰지 않는다)
        const cur = wxBase(D.weather), lock = D.wxLock && D.wxLock.hp > 0 && !D.wxLock.dead;
        if (foe && !lock && cur !== R.setWx) {
          const gain = wxValue(R.setWx, team) - (cur ? wxValue(cur, team) : 0);
          if (wxValue(R.setWx, team) > 0 && gain >= 1) s = Math.min(boss ? 80 : 50, (boss ? 30 : 15) + gain * 10);
        }
      } else if (R.screen) {   // 벽: 싸우는 중이고 아직 없으면
        const k = R.screen === 'phys' ? 'reflectT' : 'screenT';
        if (foe && who.some(m => !m[k])) s = boss ? 50 : 15;
      } else if (o.m.sc && o.m.sc.some(([, ch]) => ch > 0) && !o.m.ss) {   // 능력 올리기: 아직 덜 오른 대상이 있으면
        const cap = boss ? 4 : AI_STAGE_LIMIT;
        const need = who.filter(m => o.m.sc.some(([st, ch]) => ch > 0 && (m.stages[st] || 0) < cap)).length;
        if (foe && need) s = (boss ? 40 : 10) + need * 5;
      }
      if (s && (!best || s > best.s)) best = { ...o, s };
    }
    if (!best) return null;
    // 급한 회복은 늘, 나머지는 확률로 (매 턴 쓰지 않게)
    return best.s >= 100 || Math.random() < best.s / 100 ? best : null;
  }

  function enemyAct(e) {
    if (e.skipTurn) { e.skipTurn--; return; }
    if (e.hp <= 0 || e.npc) return;
    e.protectPrev = e.protecting; e.protecting = false;
    if (e.napping && [P(), ...allies()].some(m => cheb(m, e) <= 1) && Math.random() < NAP_WAKE) wakeNap(e, Math.max(T.cursor, T.moveEnd), true);
    if (e.napping) return;
    if (!canAct(e)) return;
    if (e.moveOnly && (e.charging || e.rampage)) return;
    const tg = aiTarget(e);
    if (!tg) {
      if (e.charging || e.rampage) { if (e.rampage) rampageStep(e); else useMove(e, e.charging.slot, e.dir, { release: true, free: true }); return; }
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
    if (e.rampage) { rampageStep(e); return; }
    const nerve = abilityOf(p).unnerve ? 0.5 : 1;
    const sees = tg.sees && p.hp > 0;
    if (sees) e.target = { x: p.x, y: p.y };
    if (e.thief) e.target = { x: P().x, y: P().y };   // 화난 켈리몬: 어디 있든 쫓아온다
    const dx = p.x - e.x, dy = p.y - e.y, dist = Math.max(Math.abs(dx), Math.abs(dy));
    const usable = e.moves.map((m, i) => ({ m: DATA.moves[m.id], i, pp: m.pp, id: m.id })).filter(o => o.pp > 0 && !selfKOBlocked(e, o.id) && !(e.tauntT && o.m.c === 1));
    // 능력 변화 기술은 이미 충분히 바뀌었으면 쓰지 않는다 (작아지기·칼춤을 끝없이 쌓거나 상대 능력을 계속 깎지 않게)
    const worthUsing = (e, p, m) => {
      const R = MOVE_RULES[m.id] || {};   // 새 변화 기술: 소용없을 때는 쓰지 않는다
      if (R.rest) return e.hp < e.maxhp * 0.5 || !!e.status;
      if (R.allyHeal) return [D.player, ...D.mons].some(c => c && c !== e && c.hp > 0 && c.hp < c.maxhp * 0.7 && !c.npc && !hostileTo(e, c) && cheb(c, e) <= TEAM_RANGE);   // 치유파동: 다친 같은 편이 곁에 있을 때만
      if (R.setWx) return weatherNow() !== R.setWx;
      if (R.screen) return !e[R.screen === 'phys' ? 'reflectT' : 'screenT'];
      if (R.seed) return !p.seeded && !p.types.includes(12);
      if (R.taunt) return !p.tauntT;
      if (R.transform) return !e.tf;
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
    const score = o => moveScore(e, p, o.m);
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
      if (pc && Math.random() < rate * nerve && lineClear(e, dirIndex(dx, dy), dist)) { useMove(e, pc.i, dirIndex(dx, dy)); return; }
    }
    if (sees && !e.moveOnly && dist <= 3) {
      const area = usable.filter(o => o.m.r === 'r' && o.m.c !== 1);
      const ac = e.ally || smartFoes() ? best(area) : pick(area);
      if (ac && Math.random() < (stuck ? 1 : 0.25) * nerve && los(e.x, e.y, p.x, p.y)) { useMove(e, ac.i, dirIndex(dx, dy) || 0); return; }
    }
    if (e.ally && tactic() === 'wait') return;   // 기다리는 동료는 쫓아가지 않는다
    if (stuck) { followLeader(e); return; }   // 막힌 동료: 다른 길로 크게 돌지 않고 줄을 지킨다
    let goal = e.target;
    if (goal && goal.x === e.x && goal.y === e.y) { e.target = null; goal = null; }
    if (!goal) {
      if (!e.wander || (e.wander.x === e.x && e.wander.y === e.y) || Math.random() < 0.02) {
        const R = pick(D.rooms); e.wander = { x: rint(R.x, R.x + R.w - 1), y: rint(R.y, R.y + R.h - 1) };
      }
      goal = e.wander;
    }
    const path = bfs(e.x, e.y, (x, y) => x === goal.x && y === goal.y, { blockMons: true, self: e, max: 900 });
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
    if (it.use === 'stat' && sees && dist <= 3 && !(e.stages[it.st] > 0)) { eat(); statChange(e, it.st, it.v, at, e); return true; }
    if (it.throw && sees && dist > 1 && dist <= 8 && (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) && lineClear(e, dirIndex(dx, dy), dist) && Math.random() < 0.5) {
      e.item = null; throwItem(e, id, dirIndex(dx, dy)); return true;
    }
    return false;
  }
  // 직선 기술·던지기가 닿는지 (벽 모서리는 지나간다)
  function lineClear(c, dir, dist) {
    let x = c.x, y = c.y;
    for (let i = 1; i < dist; i++) {
      x += DIRS[dir][0]; y += DIRS[dir][1];
      const b = creatureAt(x, y);
      if (!floorAt(x, y) || (b && !(party(c) && party(b)))) return false;
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
    } else if (p.rampage) { rampageStep(p); used = true; }
    else switch (action.t) {
      case 'move': used = doMove(confuse(p, action.dir)); break;
      case 'attack': useMove(p, -1, confuse(p, p.dir)); used = true; break;
      case 'skill': {
        const m = p.moves[action.slot];
        if (!m) return false;
        if (m.pp <= 0) { log('PP가 남아있지 않다!', now()); return false; }
        if (p.tauntT && DATA.moves[m.id].c === 1) { log(`${jo(nm(p), '은')} 도발당해서 ${jo(DATA.moves[m.id].n, '을')} 쓸 수 없다! (${p.tauntT}턴 남음)`, now()); return false; }
        if (selfKOBlocked(p, m.id)) { log(`HP가 부족해서 ${jo(DATA.moves[m.id].n, '을')} 쓸 수 없다! (HP 절반 이상 필요)`, now()); return false; }
        const mv = DATA.moves[m.id];
        if (action.autoFace !== false) autoFace(p, mv, m.id);
        useMove(p, action.slot, confuse(p, p.dir)); used = true; break;
      }
      case 'wait': used = true; break;
      case 'item': used = useItem(action.slot, action.mode, action.move, action.ally); break;
      case 'foot': used = footAction(action.mode, action.slot); break;
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
      const adj = vis.find(e => Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y)) === 1 && diagOK(p.x, p.y, Math.sign(e.x - p.x), Math.sign(e.y - p.y)));
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
    if (t && hostileTo(p, t)) {
      if (!diagOK(p.x, p.y, dx, dy)) return false;
      useMove(p, -1, dir); return true;
    }
    if (t && (t.ally || t.letPass) && diagOK(p.x, p.y, dx, dy)) {   // 동료(또는 비켜 주는 켈리몬)와 자리를 바꾼다
      const fx = p.x, fy = p.y;
      t.x = fx; t.y = fy; schedMove(t, p.x + dx, p.y + dy); t.swapped = D.turn;
      p.x += dx; p.y += dy; schedMove(p, fx, fy); markMoved(p, fx, fy);
      onStep(); return true;
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

  function triggerTrap(tr, depth) {
    const p = P(), at = T.base + 130 * spd(), info = TRAPS[tr.kind];
    tr.seen = true;
    stopAuto();
    log(`${jo(info.n, '을')} 밟았다!`, at);
    Sound.play('trap', at);
    D.fx.push({ kind: 'ring', x: tr.x, y: tr.y, at, dur: 350 * spd(), color: '#ff9a3c' });
    const pa = abilityOf(p);
    if (pa.trapImmune && pa.trapImmune.includes(tr.kind)) { abLog(p, '하지만 아무 일도 일어나지 않았다!', at); return; }
    if (heldOf(p).trapImmune) { log(`${jo(ITEMS[p.held].n, '이')} 함정을 막아 주었다!`, at); return; }
    switch (tr.kind) {
      case 'psn': case 'slp': case 'par': inflict(p, tr.kind, at, true); break;
      case 'warp': {
        const t = randomRoomTile({ far: 6 });
        if (t) { p.x = t.x; p.y = t.y; p.tween = null; log('어딘가로 날아갔다!', at); computeVis(); onStep(depth + 1); }
        break;
      }
      case 'blast': {
        const hit = [p, ...D.mons.filter(m => !m.npc && Math.max(Math.abs(m.x - tr.x), Math.abs(m.y - tr.y)) <= 1)];
        for (const c of hit) { const amt = pctDmg(c, 0.2); log(`${jo(nm(c), '은')} ${amt}의 데미지를 입었다.`, at); damage(c, amt, null, at); }
        break;
      }
      case 'hunger': p.belly = Math.max(0, p.belly - 20); log('배가 급격히 고파졌다!', at); break;
      case 'reset': {
        const any = Object.values(p.stages).some(v => v);
        for (const k of Object.keys(p.stages)) p.stages[k] = 0;
        log(any ? '능력 변화가 모두 원래대로 돌아갔다!' : '하지만 아무 일도 일어나지 않았다.', at);
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
      const e = spawnEnemy(t); e.target = { x: p.x, y: p.y }; e.skipTurn = 1; n--;   // 떨어진 턴에는 행동하지 않는다
    }
    computeVis();
    log('몬스터 하우스다!!', T.base);
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
      if (TRAP_ALWAYS.includes(tr.kind) || Math.random() < (tr.seen ? TRAP_RATE.seen : TRAP_RATE.hidden)) triggerTrap(tr, depth);
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
    const last = run.floor >= dungeonById(run.dungeon).floors;
    UI.open({
      title: '계단', html: last ? '<p>출구가 보인다! 던전을 빠져나가시겠습니까?</p>' : '<p>다음 층으로 가는 계단이 있다. 내려가시겠습니까?</p>',
      choices: [{ label: last ? '나간다' : '내려간다', fn: descend }, { label: '그만둔다', fn: () => {} }], cancel: () => {},
    });
  }
  function descend() {
    const p = P();
    if (D.dead || p.hp <= 0) return;   // 쓰러졌으면 내려가지 않는다
    if (!(D.stairs.x === p.x && D.stairs.y === p.y)) return;
    stopAuto();
    const dg = dungeonById(run.dungeon);
    Progress.add('floors');
    if (run.floor >= dg.floors) { Sound.play('clear'); Game.endRun('clear'); return; }
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
      a.regen = (a.regen || 0) + (a.maxhp / 110 + 0.05) * (abVal(a, 'regen') || 1) * (heldOf(a).regen || 1) * (heldOf(a).sludge && a.types.includes(4) ? 2.5 : 1);   // 검은오물: 독 타입이면 2.5배
      if (a.regen >= 1) { const n = Math.floor(a.regen); if (p.belly > 0 && a.hp < a.maxhp) a.hp = Math.min(a.maxhp, a.hp + n); a.regen -= n; }
    }
    p.partners = (run.party || []).length;   // 혼자 탐험 보정: 동료 없이 들어왔을 때만 (동료가 모두 쓰러져도 생기지 않음)
    D.turn++; run.turnsOnFloor++; run.turns = (run.turns || 0) + 1;
    const wi = WIND.warn.indexOf(run.turnsOnFloor);
    if (wi >= 0) {
      Sound.play('wind');
      log(['어디선가 바람이 불어오기 시작했다...', '바람이 강해졌다... 서두르자!', '바람이 매우 강해졌다! 곧 날려갈 것 같다!'][wi], T.base);
      setFace(wi === 2 ? 'Worried' : 'Surprised', 2000); stopAuto();
    }
    if (run.turnsOnFloor >= WIND.limit && !D.dead) {
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
    p.belly = Math.max(0, p.belly - 0.08 * (weatherNow() === 'snow' && !p.types.includes(15) ? 1.5 : 1) * (heldOf(p).bellyMul || 1));
    // 맹독구슬·화염구슬: 지닌 포켓몬(동료 포함)에게 5턴마다 (상태이상이 없을 때)
    if (run.turnsOnFloor % 5 === 0) for (const c of [p, ...allies()]) if (heldOf(c).orb && !c.status && c.hp > 0) { log(`${nm(c)}의 ${jo(ITEMS[c.held].n, '이')} 반응했다!`, T.base); inflict(c, heldOf(c).orb, T.base, true); }
    if (p.belly > 0) {
      const ph = heldOf(p);
      D.regen += (p.maxhp / 110 + 0.05) * (abVal(p, 'regen') || 1) * (ph.regen || 1) * (ph.sludge && p.types.includes(4) ? 2.5 : 1);
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
    if (weatherNow() === 'sand' && D.turn % SAND_EVERY === 0) {
      const at = Math.max(T.cursor, T.moveEnd);
      for (const c of [p, ...D.mons]) {
        if (c.npc || c.hp <= 0 || c.types.some(t => t === 5 || t === 6 || t === 9) || abilityOf(c).chipImmune) continue;
        if (c.player || seen(c)) log(`모래바람이 ${jo(nm(c), '을')} 덮쳤다!`, at);
        damage(c, pctDmg(c, 1 / 16), null, at);
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
      D.spawnT = run.hard ? rint(...HARD_SPAWN) : rint(30, 45);   // 하드모드: 더 빨리 다시 나타난다
      if (D.mons.filter(m => !m.npc && !m.ally).length < 12) { const t = randomRoomTile({ hidden: true, far: 7 }); if (t) spawnEnemy(t); }
    }
    // 모습 확인 (HP·날씨에 따라 바뀌는 포켓몬, 모르페코는 턴마다)
    for (const c of [p, ...D.mons]) {
      if (c.hp <= 0 || !FORMS_OF[c.sp]) continue;
      if (c.sp === 877) c.hangry = !c.hangry;
      formCheck(c, T.base, c.sp === 877);
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
      if (!floorAt(x + dx, y + dy)) break;
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
      case 'statRandom': statChange(p, pick([2, 3, 4, 5, 6]), 2, at, p); break;
      case 'critUp': p.critBoost = 2; p.critT = STAGE_TURNS; log(`${jo(nm(p), '은')} 급소에 맞히기 쉬워졌다! (100턴)`, at); break;
      case 'gummy': {
        setFace('Happy', 1500);
        p.belly = Math.min(100, p.belly + it.belly);
        p.boost = { ...(p.boost || {}) };
        const up = it.gummy.filter(k => (p.boost['g_' + k] || 0) < GUMMY_MAX);
        up.forEach(k => { p.boost['g_' + k] = (p.boost['g_' + k] || 0) + 1; });
        recalc(p);
        log(`배가 조금 불러졌다! ` + (up.length ? `${up.map(k => `${STAT_KO[k]} +${gummyAmt(k)}`).join(', ')}${run.mode === 'normal' ? ' (영구)' : ' (이번 탐험 동안)'}` : '더 이상 능력이 오르지 않는다.'), at);
        if (up.length) Sound.play('levelup', at);
        break;
      }
      case 'cure': p.status = null; p.stages = Object.fromEntries(Object.entries(p.stages).filter(([, v]) => v > 0)); log('몸 상태가 좋아졌다!', at); break;
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
      case 'stat': statChange(p, it.st, it.v, at, p); break;
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
    const heldHtml = p.held ? `<div class="row">지닌 물건: ${ITEMS[p.held].icon} <b>${esc(ITEMS[p.held].n)}</b> <span class="grow dim">${esc(ITEMS[p.held].d)}</span></div>` : '<div class="row dim">지닌 물건 없음</div>';
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
        label: `${ITEMS[b.id].icon} ${esc(ITEMS[b.id].n)}${b.n > 1 ? ' ×' + b.n : ''}`, sub: esc(ITEMS[b.id].d),
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
  function footAction(mode, slot) {
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
    if (mode === 'use') {
      // 발밑의 아이템을 잠깐 가방 끝에 넣고 그대로 쓴다 (가방이 가득 차 있어도). 못 쓰면 다시 바닥에 둔다
      const one = { id: it.id, n: 1 };
      run.bag.push(one);
      const ok = useItem(run.bag.length - 1, 'use', slot);
      const k = run.bag.indexOf(one); if (k >= 0) run.bag.splice(k, 1);
      if (!ok) return false;
      if (it.n > 1) it.n--; else D.items = D.items.filter(i => i !== it);
      return true;
    }
    return false;
  }

  // ── 동료에게 아이템 쓰기: 회복·상태이상·PP 아이템, 부활씨는 쓰러진 동료를 되살린다 ──
  const ALLY_USES = ['heal', 'healPct', 'fullheal', 'cure', 'cureOne', 'pp', 'ppSome', 'ppOne'];
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
      D.corpses = D.corpses.filter(c => c !== a); D.mons.push(a);
      Sound.play('item', at); log(`부활씨의 힘으로 ${jo(nm(a), '이')} 되살아났다!`, at); popup(a, 'REVIVE', '#ffe066', at + 150);
      updateTacticBtn(); return true;
    }
    if (a.fainted || !D.mons.includes(a) || !ALLY_USES.includes(it.use)) return false;
    takeFromBag(slot);
    Sound.play('item', at);
    log(`${nm(a)}에게 ${jo(it.n, '을')} 주었다.`, at);
    switch (it.use) {
      case 'heal': case 'healPct': {   // 볼주머니·수확: 먹는 동료의 특성
        const aa = abilityOf(a);
        let amt = it.use === 'heal' ? it.v : Math.floor(a.maxhp * it.v / 100);
        if (aa.cheekPouch) amt = Math.floor(amt * 1.5);
        heal(a, amt, at);
        if (aa.harvest && Math.random() < 0.5) { addToBag(itemId); abLog(a, `${jo(it.n, '이')} 다시 열렸다!`, at); }
        break;
      }
      case 'fullheal': a.status = null; heal(a, a.maxhp, at); break;
      case 'cure': a.status = null; a.stages = Object.fromEntries(Object.entries(a.stages).filter(([, v]) => v > 0)); log(`${nm(a)}의 몸 상태가 좋아졌다!`, at); break;
      case 'cureOne': if (a.status === it.st) { a.status = null; log(`${nm(a)}의 ${STATUS_NAMES[it.st]} 상태가 나았다!`, at); } else log('하지만 효과가 없었다...', at); break;
      case 'pp': a.moves.forEach(m => m.pp = m.max); log(`${nm(a)}의 모든 기술의 PP가 회복되었다!`, at); break;
      case 'ppSome': a.moves.forEach(m => m.pp = Math.min(m.max, m.pp + it.v)); log(`${nm(a)}의 모든 기술의 PP가 ${it.v}씩 회복되었다!`, at); break;
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
    const slot = run.bag.findIndex(b => b.id === id);
    if (slot < 0) { log(`가방에 ${jo(ITEMS[id].n, '이')} 없다.`, now()); return; }
    const it = ITEMS[id];
    if (it.throw || !it.use || it.use === 'none') { autoFace(P(), { r: 'p' }); act({ t: 'item', slot, mode: 'throw' }); }
    else useAct(slot);
  }

  function itemMenu(i) {
    const b = run.bag[i], it = ITEMS[b.id];
    const ch = [];
    if (it.use && it.use !== 'none') ch.push({ label: '사용한다', fn: () => useAct(i) });
    if (ALLY_USES.includes(it.use) && liveAllies().length) ch.push({ label: '🤝 동료에게 쓴다', fn: () => pickAllyFor(i, () => itemMenu(i)) });
    if (b.id === 'reviver' && downAllies().length) ch.push({ label: '🌰 쓰러진 동료를 되살린다', fn: () => pickReviveFor(i, () => itemMenu(i)) });
    if (it.held) ch.push({ label: '지니게 한다', disabled: !!heldBlockReason(P().baseAbility ?? P().ability, b.id), sub: heldBlockReason(P().baseAbility ?? P().ability, b.id), fn: () => {
      const p = P(), old = p.held;
      run.bag.splice(i, 1); p.held = b.id;
      if (old) run.bag.push({ id: old, n: 1 });
      log(`${jo(it.n, '을')} 지니게 했다.` + (old ? ` (${jo(ITEMS[old].n, '은')} 가방으로)` : ''), now());
      formCheck(p, now() + 200);   // 메가스톤·폼체인지 도구
    } });
    ch.push({ label: '던진다', fn: () => act({ t: 'item', slot: i, mode: 'throw' }) });
    const fav = Game.save.settings.quickItem === b.id;
    ch.push({ label: fav ? '⭐ 빠른 사용 해제' : `⭐ 빠른 사용으로 등록 (T 키 / 버튼으로 바로 ${it.throw || !it.use || it.use === 'none' ? '던지기' : '사용'})`, fn: () => {
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
    if (kind === 'explore' && hostilesVisible().length) { autoFight(); return; }
    if (kind !== 'fight' && hostilesVisible().length) { log('근처에 적이 있어서 할 수 없다!', now()); return; }
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
    if (p.hp < a.hp && a.kind !== 'fight') { stopAuto('공격을 받았다!'); return; }
    a.hp = p.hp;
    if (++a.n > 800) { stopAuto(); return; }
    if (a.kind === 'fight') { autoFight(); D.auto = null; return; }
    if (hostilesVisible().length) { stopAuto('적이 나타났다! (O: 자동 전투 한 턴)'); return; }
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
  function autoFight() {
    const p = P();
    const foes = hostilesVisible();
    if (!foes.length) { log('주변에 적이 없다.', now()); return; }
    if (p.hp < p.maxhp * AUTO_STOP_HP) { log('HP가 너무 낮다! 직접 조작하세요.', now()); return; }
    // 가장 가까운 적
    const path = bfs(p.x, p.y, (x, y) => foes.some(f => f.x === x && f.y === y), { blockMons: true, self: p, avoidTraps: true, passAllies: true });
    const tgt = path ? foes.find(f => f.x === path.x && f.y === path.y) : foes[0];
    const dx = tgt.x - p.x, dy = tgt.y - p.y, dist = Math.max(Math.abs(dx), Math.abs(dy));
    const cands = [{ slot: -1, s: moveScore(p, tgt, NORMAL_ATTACK) }];
    p.moves.forEach((m, i) => { if (m.pp > 0 && !selfKOBlocked(p, m.id)) { const mv = DATA.moves[m.id]; cands.push({ slot: i, mv, s: moveScore(p, tgt, mv) * (mv.r === 'r' ? 1.1 : 1) }); } });
    const dir = dirIndex(dx, dy);
    if (dist === 1 && diagOK(p.x, p.y, Math.sign(dx), Math.sign(dy))) {
      const best = cands.filter(c => c.slot < 0 || c.mv.r !== 's').sort((a, b) => b.s - a.s)[0];
      p.dir = dir;
      act(best.slot < 0 ? { t: 'attack' } : { t: 'skill', slot: best.slot, autoFace: false });
      return;
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
    if (path) act({ t: 'move', dir: dirIndex(path.fx - p.x, path.fy - p.y) });
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
      ctx.fillStyle = c.hp / c.maxhp > 0.5 ? '#5f5' : c.hp / c.maxhp > 0.2 ? '#fd4' : '#f55';
      ctx.fillRect(cx - 10, cy + 10, 20 * c.hp / c.maxhp, 3);
    }
    if (c.npc && c.mission) { ctx.fillStyle = '#ffe066'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('SOS', cx, cy - 18); }
    if (c.shopkeeper) { ctx.fillStyle = '#ffe066'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('상점', cx, cy - 20); }
    if (c.boss && !c.dead) { ctx.fillStyle = '#ff5a5a'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('BOSS', cx, cy - 22); }
    if (c.outlaw) { ctx.fillStyle = '#ff5a5a'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('WANTED', cx, cy - 20); }
    if (c.status && !c.dead && Gfx.drawStatus(ctx, c.status, cx, cy, t, c.id)) {}   // 원작 상태 이상 그림 (마비는 이모지)
    else if (c.status && !c.dead) {
      const ic = { psn: '☠', brn: '🔥', par: '⚡', slp: 'z', frz: '❄', cnf: '?' }[c.status];
      ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText(ic, cx + 9, cy - 10);
    }
  }

  // 대기 중인 프롬프트 / 자동 행동 (렌더와 분리해서 탭이 가려져도 진행)
  function logicTick() {
    if (!D || busy() || UI.isOpen()) return;
    if (D.prompts.length) D.prompts.shift()();
    else if (D.auto) autoTick();
    else if (pendingKey) { const k = pendingKey; pendingKey = null; handleKey(k); }
  }

  // 화면 세로 중심 (캔버스 좌표). 휴대폰은 위의 상태 창과 아래 메시지 창이 화면을 가리므로, 그 사이 보이는 곳의 가운데에 캐릭터를 둔다
  const narrowMQ = matchMedia('(max-width: 800px)');
  let camCYv = null, camCYat = -1e9;
  function camCY(H) {
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
    const scale = wrap.clientWidth >= 1000 && wrap.clientHeight >= 620 ? 3 : 2;
    const W = Math.ceil(wrap.clientWidth / scale), H = Math.ceil(wrap.clientHeight / scale);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; ctx.imageSmoothingEnabled = false; }
    const p = P(), pv = vpos(p, t);
    const ox = Math.round(pv.x * TILE + TILE / 2 - W / 2), oy = Math.round(pv.y * TILE + TILE / 2 - camCY(H));
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(D.mapCanvas, -ox, -oy);
    // 안개
    const x0 = Math.max(0, Math.floor(ox / TILE)), y0 = Math.max(0, Math.floor(oy / TILE));
    const x1 = Math.min(D.w - 1, Math.ceil((ox + W) / TILE)), y1 = Math.min(D.h - 1, Math.ceil((oy + H) / TILE));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = idx(x, y);
      if (!D.explored[i]) { ctx.fillStyle = '#000'; ctx.fillRect(x * TILE - ox, y * TILE - oy, TILE, TILE); }
      else if (!D.visible[i]) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x * TILE - ox, y * TILE - oy, TILE, TILE); }
    }
    // 바깥 영역
    if (ox < 0) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, -ox, H); }
    if (oy < 0) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, -oy); }
    // 계단
    const s = D.stairs;
    if (!D.stairsHidden && D.explored[idx(s.x, s.y)]) {
      const sx = s.x * TILE - ox, sy = s.y * TILE - oy;
      ctx.fillStyle = '#1b1b2a'; ctx.fillRect(sx + 2, sy + 2, TILE - 4, TILE - 4);
      ctx.fillStyle = '#e8e2c8';
      for (let k = 0; k < 4; k++) ctx.fillRect(sx + 4 + k * 2, sy + 5 + k * 4, TILE - 8 - k * 4, 2);
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
      ctx.fillStyle = '#ff5a5a'; ctx.fillRect(bx, by + 10, bw * b.hp / b.maxhp, 4);
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
    const seenFloor = (x, y) => inb(x, y) && D.explored[idx(x, y)] && floorAt(x, y);
    mctx.fillStyle = bigMap ? '#1c2748' : 'rgba(6,12,32,0.75)';
    for (let y = 0; y < D.h; y++) for (let x = 0; x < D.w; x++) {
      if (floorAt(x, y)) continue;
      let near = false; for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (seenFloor(x + dx, y + dy)) { near = true; break; }
      if (near) mctx.fillRect(x * S, y * S, S, S);
    }
    mctx.fillStyle = bigMap ? 'rgb(84,120,190)' : 'rgba(120,170,255,0.6)';
    for (let y = 0; y < D.h; y++) for (let x = 0; x < D.w; x++) if (seenFloor(x, y)) mctx.fillRect(x * S, y * S, S, S);
    mctx.fillStyle = bigMap ? '#cfe0ff' : 'rgba(225,236,255,0.95)';
    const L = bigMap ? 2 : 1;
    for (let y = 0; y < D.h; y++) for (let x = 0; x < D.w; x++) {
      if (!seenFloor(x, y)) continue;
      if (!floorAt(x, y - 1)) mctx.fillRect(x * S, y * S, S, L);
      if (!floorAt(x, y + 1)) mctx.fillRect(x * S, y * S + S - L, S, L);
      if (!floorAt(x - 1, y)) mctx.fillRect(x * S, y * S, L, S);
      if (!floorAt(x + 1, y)) mctx.fillRect(x * S + S - L, y * S, L, S);
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
  function updateHud(t) {
    const p = P(), dg = D.dg;
    const pt = (run.party || []).map(a => `${a.sp}:${a.lv}:${a.hp}:${a.maxhp}:${a.fainted ? 1 : 0}:${a.status}:${a.fainted ? '' : effKey(a)}`).join(',');
    const hud = `${pt}|${p.held}|${weatherRaw()}|${dg.n}|${run.floor}|${p.lv}|${p.hp}|${p.maxhp}|${Math.ceil(p.belly)}|${Game.save.money}|${run.money}|${p.status}|${p.exp}|${JSON.stringify(p.stages)}|${JSON.stringify(p.stageS || {})}|${effKey(p)}`;
    if (hud !== hudCache) {
      hudCache = hud;
      const hpPct = p.hp / p.maxhp * 100;
      const need = expFor(p.lv + 1) - expFor(p.lv), have = p.exp - expFor(p.lv);
      // 랭크 변화: 넓은 화면은 이름 그대로, 휴대폰은 줄임말 (css .sl / .ss)
      const effs = timedEffects(p).map(([i, n, tl, k]) => `<span class="eff ${k}" title="${n} ${tl}턴 남음">${i}${n} ${tl}</span>`).join(' ');
      const stg = Object.entries(p.stages).filter(([, v]) => v).map(([k, v]) => `<span class="${v > 0 ? 'up' : 'down'}" title="${STAT_NAMES[k]} ${(p.stageS?.[k]?.t || [p.stageT?.[k] || 0]).slice().sort((a, b) => a - b).join(' · ')}턴 남음 (랭크마다 따로)"><i class="sl">${STAT_NAMES[k]}</i><i class="ss">${STAT_SHORT[k]}</i>${v > 0 ? '+' : ''}${v}</span>`).join(' ');
      document.getElementById('hud').innerHTML = `
        <span class="floor">${run.hard ? '☠ ' : ''}${esc(dg.n)} <b>${run.floor}F</b>${weatherRaw() ? ` <span class="wx" title="${esc(WEATHERS[weatherRaw()].d)}">${WEATHERS[weatherRaw()].icon} ${WEATHERS[weatherRaw()].n}</span>` : ''}${dg.mode === 'rogue' ? ' <i class="rogue">로그라이크</i>' : ''}</span>
        <span class="lvl">Lv <b>${p.lv}</b> <span class="exp" title="다음 레벨까지 경험치"><span class="bar small"><i style="width:${p.lv >= MAX_LEVEL ? 100 : clamp(have / need * 100, 0, 100)}%;background:#6cf"></i></span></span></span>
        <span class="hpwrap">HP <b>${p.hp}</b>/${p.maxhp}<span class="bar"><i style="width:${hpPct}%;background:${hpPct > 50 ? '#4de36b' : hpPct > 20 ? '#f5d142' : '#f55'}"></i></span></span>
        <span class="belly">배 <b class="${p.belly <= 20 ? 'warn' : ''}">${Math.ceil(p.belly)}</b>/100</span>
        ${p.held ? `<span class="held" title="${esc(ITEMS[p.held].d)}">${ITEMS[p.held].icon} ${esc(ITEMS[p.held].n)}</span>` : ''}
        ${p.status || stg ? `<span class="stgs">${p.status ? `<span class="st">${STATUS_NAMES[p.status]}</span> ` : ''}${stg ? `<span class="sgrid">${stg}</span>` : ''}</span>` : ''}
        ${effs ? `<span class="effs">${effs}</span>` : ''}
        ${(run.party || []).length ? `<span class="party">${run.party.map(a => { const pc = a.fainted ? 0 : a.hp / a.maxhp * 100; return `<span class="pm${a.fainted ? ' out' : ''}" title="${esc(spName(a.sp))} Lv${a.lv} HP ${a.fainted ? 0 : a.hp}/${a.maxhp}${a.status ? ' · ' + STATUS_NAMES[a.status] : ''}"><span class="pmn">${esc(spName(a.sp))}</span>${a.fainted ? '' : timedEffects(a).map(([i, n, tl]) => `<i class="peff" title="${n} ${tl}턴">${i}</i>`).join('')} <span class="bar small"><i style="width:${pc}%;background:${pc > 50 ? '#4de36b' : pc > 20 ? '#f5d142' : '#f55'}"></i></span></span>`; }).join('')}</span>` : ''}
        <span class="money" title="쓰러지면 이번 탐험에서 주운 돈(괄호 안)을 잃습니다">₽ <b>${Game.save.money}</b>${run.money ? ` <span class="run-money">(이번 탐험 +${run.money})</span>` : ''}</span>`;
    }
    const mv = p.moves.map(m => m.id + ':' + m.pp + ':' + m.max).join(',');
    if (mv !== moveCache) {
      moveCache = mv;
      document.getElementById('moves').innerHTML = p.moves.map((m, i) => {
        const d = DATA.moves[m.id];
        return `<button class="mv${m.pp <= 0 ? ' empty' : ''}" data-slot="${i}" style="--tc:${TYPE_COLORS[d.t - 1]}" title="${esc(d.n)} (${typeName(d.t)} · ${['', '변화', '물리', '특수'][d.c]}${d.p ? ' · 위력 ' + d.p : ''})">
          <span class="k">${i + 1}</span><span class="n">${esc(d.n)}${masteryLevel(p.sp, m.id) ? `<i class="mastery">★${masteryLevel(p.sp, m.id)}</i>` : ''}</span><span class="p">${m.pp}/${m.max}</span><span class="info" data-move="${m.id}" data-pp="${m.pp}" data-max="${m.max}" data-sp="${p.sp}" title="기술 정보">?</span></button>`;
      }).join('');
    }
    const qid = Game.save.settings.quickItem, qn = qid ? run.bag.filter(b => b.id === qid).reduce((s, b) => s + b.n, 0) : 0;
    const qk = (qid || '') + ':' + qn;
    if (qk !== quickCache) {
      quickCache = qk;
      const qb = document.querySelector('#actions [data-k=quick]');
      if (qb) { qb.innerHTML = qid && ITEMS[qid] ? `${ITEMS[qid].icon}×${qn} <kbd>T</kbd>` : '⭐ 빠른사용 <kbd>T</kbd>'; qb.title = qid && ITEMS[qid] ? `${ITEMS[qid].n} 바로 ${ITEMS[qid].throw || !ITEMS[qid].use || ITEMS[qid].use === 'none' ? '던지기' : '사용'} (T)` : '가방에서 아이템을 골라 "빠른 사용"으로 등록하세요'; qb.classList.toggle('empty', !!qid && !qn); }
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
    const wl = run.turnsOnFloor >= WIND.warn[0] ? WIND.warn.filter(w => run.turnsOnFloor >= w).length : 0;
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
  const DIAG_WAIT = 70;
  const heldMove = new Map();   // 눌려 있는 상하좌우 키 → 방향
  const turnHeld = new Set();   // 눌려 있는 '방향만 바꾸기' 키 (기본 Shift)
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
      heldMove.set(e.code, MOVE_ACTION_DIR[a]);
      if (heldMove.size >= 2 || e.repeat) { clearTimeout(moveTimer); moveTimer = null; sendKey({ dir: heldDir() ?? MOVE_ACTION_DIR[a] }); return; }
      clearTimeout(moveTimer); moveFallback = MOVE_ACTION_DIR[a];
      moveTimer = setTimeout(() => { moveTimer = null; sendKey({ dir: heldDir() ?? moveFallback }); }, DIAG_WAIT);
      return;
    }
    const k = { code: e.code, shift: e.shiftKey, turn: turnHeld.size > 0, key: e.key };
    if (busy()) { pendingKey = k; e.preventDefault(); return; }
    if (handleKey(k)) e.preventDefault();
  }
  function onKeyUp(e) { heldMove.delete(e.code); turnHeld.delete(e.code); }
  function handleKey(k) {
    if (!D || D.dead) return false;
    const a = k.dir != null ? null : keyAct(k.code);
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
    if (!floorAt(x, y)) rows.push('<p>벽이다.</p>');
    UI.alert('🔍 조사', rows.join('') || `<p>아무것도 없다.${vis ? '' : ' <span class="dim">(지금은 보이지 않는 곳)</span>'}</p>`);
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
  function showLog() {
    if (!D) return;
    const t = now(), rows = LOG.filter(l => l.at <= t).slice(-150);
    UI.open({
      title: '💬 메시지 기록', wide: true,
      html: `<div class="log-history">${rows.map(l => `<div${l.cls ? ` class="${l.cls}"` : ''}>${esc(l.text)}</div>`).join('') || '<p class="dim">아직 메시지가 없다.</p>'}</div>`,
      choices: [{ label: '닫기', fn: () => {} }],
      onOpen: box => { const h = box.querySelector('.log-history'); if (h) h.scrollTop = h.scrollHeight; },
    });
  }
  function showStatus() {
    if (!D) return;
    const p = P(), st = stageText(p), need = expFor(p.lv + 1) - expFor(p.lv), have = p.exp - expFor(p.lv);
    const row = (k, a, b) => `<tr><td>${k}</td><td><b>${a}</b></td><td class="dim">${b || ''}</td></tr>`;
    UI.open({
      title: '📊 내 상태', wide: true,
      html: `<div class="row">${portraitImg(looksOf(p), 'portrait', 'Normal', p.shiny)}<div class="grow"><b>${esc(spName(looksOf(p)))}</b> Lv${p.lv} ${typeBadges(p.types)}
          <div>HP ${p.hp}/${p.maxhp} · 배 ${Math.floor(p.belly)}/100${p.status ? ` · <span class="warn">${STATUS_NAMES[p.status]}</span>` : ''}</div>
          <div class="dim">EXP ${p.lv >= MAX_LEVEL ? '최대' : `${have}/${need}`} · ₽ ${Game.save.money}${run.money ? ` (이번 탐험 +${run.money})` : ''} · 특성 ${esc(abilityName(p.ability))} · 지닌 물건 ${p.held ? `${ITEMS[p.held].icon}${esc(ITEMS[p.held].n)}` : '없음'}</div></div></div>
        <table class="md-tbl">${row('공격', p.atk, p.stages[2] ? `(${p.stages[2] > 0 ? '+' : ''}${p.stages[2]}단계)` : '')}${row('방어', p.def, p.stages[3] ? `(${p.stages[3] > 0 ? '+' : ''}${p.stages[3]}단계)` : '')}
          ${row('특수공격', p.spa, p.stages[4] ? `(${p.stages[4] > 0 ? '+' : ''}${p.stages[4]}단계)` : '')}${row('특수방어', p.spd, p.stages[5] ? `(${p.stages[5] > 0 ? '+' : ''}${p.stages[5]}단계)` : '')}
          ${row('스피드', p.spe, p.stages[6] ? `(${p.stages[6] > 0 ? '+' : ''}${p.stages[6]}단계)` : '')}</table>
        ${st ? `<p>능력 변화: ${esc(st)}</p>` : ''}
        ${timedEffects(p).length ? `<p>효과: ${timedEffects(p).map(([i, n, tl]) => `${i} ${n} <b>${tl}</b>턴 남음`).join(' · ')}</p>` : ''}
        <div class="cc-moves">${p.moves.map(m => `<div class="move-row">${moveLine(m.id, m.pp, m.max)}</div>`).join('')}</div>`,
      choices: [{ label: '닫기', fn: () => {} }],
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
      <tr><td>메시지 기록 / 내 상태</td><td>U 또는 메시지 창을 누르면 지난 메시지, P 또는 위쪽 상태 표시줄을 누르면 내 능력치·능력 변화·기술.</td></tr>
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
      <tr><td>메뉴</td><td>Esc / M</td></tr>
      <tr><td>🎮 컨트롤러</td><td>${GP_GUIDE_SHORT}</td></tr></table>`);
  }
  // 컨트롤러 조작 안내 (처음 연결했을 때 한 번, 그 뒤로는 행동 메뉴·조작 패드 설정·조작법에서)
  const GP_GUIDE_SHORT = '스틱·십자키 이동 · LB+이동 방향만 · <b>RB를 누른 채 A·B·X·Y = 기술 1~4</b> · A·B·X·Y는 버튼 할당대로 · RT 빠른사용 · Back 지도 · Start 메뉴';
  function gamepadGuide() {
    const b = vpSet().btns, nm = k => esc((VP_ACTS[b[k]] || ['?'])[0]);
    UI.open({
      title: '🎮 컨트롤러 조작', wide: true,
      html: `<table class="help">
        <tr><td>왼쪽 스틱 / 십자키</td><td>이동 (누르고 있으면 계속 걷기, 스틱은 대각선도)</td></tr>
        <tr><td>LB + 이동</td><td>제자리에서 방향만 바꾸기</td></tr>
        <tr><td><b>RB + A·B·X·Y</b></td><td><b>기술 1·2·3·4번</b> (RB를 누르고 있는 동안 기술 칸에 버튼이 표시됩니다)</td></tr>
        <tr><td>A · B · X · Y</td><td>A ${nm('a')} · B ${nm('b')} · X ${nm('x')} · Y ${nm('y')} <span class="dim">(공격 버튼을 길게 누르면 정해 둔 순서로 기술)</span></td></tr>
        <tr><td>RT</td><td>빠른사용</td></tr>
        <tr><td>Back(Select) / Start</td><td>지도 / 메뉴</td></tr>
        <tr><td>창이 열려 있을 때</td><td>십자키 위아래로 고르기, A 확인, B 닫기</td></tr></table>
        <p class="dim">A·B·X·Y에 둘 행동은 행동 메뉴의 '⚙ 조작'에서 바꿀 수 있어요. 이 안내는 행동 메뉴의 '🎮 컨트롤러'와 조작법(?)에서 다시 볼 수 있어요.</p>`,
      choices: [{ label: '알겠다', fn: () => {} }],
    });
  }

  // ───────────────────────── 시작 / 종료 ─────────────────────────
  function init() {
    canvas = document.getElementById('view'); ctx = canvas.getContext('2d');
    mini = document.getElementById('minimap'); mctx = mini.getContext('2d');
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { heldMove.clear(); turnHeld.clear(); });
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('contextmenu', e => { if (!D || UI.isOpen()) return; e.preventDefault(); lookAt(e); });   // 우클릭: 조사
    document.getElementById('log').addEventListener('click', () => { if (D && !UI.isOpen()) { stopAuto(); showLog(); } });
    // 메시지 창은 게임 화면 아래쪽에 겹쳐 띄운다 (원작처럼, 휴대폰도 v0.83부터 같게)
    document.getElementById('view-wrap').appendChild(document.getElementById('log'));
    // PC(넓은 화면): 조이스틱 패드는 아래 띠의 기술 오른쪽(버튼 줄 자리)에 둔다. 휴대폰은 맨 아래 그대로
    const vpEl = document.getElementById('vpad'), vpHome = vpEl.parentElement, wideMQ = matchMedia('(min-width: 801px)');
    const placeVpad = () => {
      const to = wideMQ.matches ? document.getElementById('controls') : vpHome;
      if (vpEl.parentElement !== to) { to.appendChild(vpEl); layoutVpad(); }
    };
    wideMQ.addEventListener ? wideMQ.addEventListener('change', placeVpad) : wideMQ.addListener(placeVpad);
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
      wait: () => act({ t: 'wait' }), stairs: tryStairs, bag: openBag, menu: () => Game.dungeonMenu(), help: showHelp,
      mission: () => Game.showMissions(), map: () => toggleMap(), look: toggleLook, quick: quickUse, padset: padSettings, gpguide: gamepadGuide })[k]?.();
  }
  // 조이스틱 모드의 X: 아래 버튼들을 모은 행동 메뉴 (조이스틱 모드에서는 아래 버튼 줄을 숨긴다)
  const VP_MENU = [['explore', '🧭 자동 탐색'], ['look', '🔍 조사'], ['bag', '🎒 가방'], ['quick', '⭐ 빠른사용'], ['stairs', '🪜 계단'], ['wait', '⏳ 대기'], ['rest', '💤 휴식'], ['map', '🗺 지도'],
    ['mission', '📜 임무'], ['tactic', '🤝 동료'], ['padset', '⚙ 조작'], ['gpguide', '🎮 컨트롤러'], ['menu', '☰ 메뉴']];
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
    const setFace = v => { face = v; faceBtn.classList.toggle('on', v); };
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
    map: ['지도', '🗺 지도'], mission: ['임무', '📜 임무'], tactic: ['동료', '🤝 동료'], menu: ['메뉴', '☰ 메뉴'] };
  const VP_BTNS = { a: 'attack', b: 'explore', x: 'vpmenu', y: 'look' };
  const VP_DEFAULT = { js: 100, ab: 85, vib: true, order: [1, 2, 3, 4], btns: VP_BTNS };
  const VP_POS = { portrait: { js: [24, 52], abxy: [76, 52] }, landscape: { js: [16, 52], abxy: [84, 52] } };
  const vpSet = () => { const v = { ...VP_DEFAULT, ...((Game.save && Game.save.settings.vpad) || {}) }; v.btns = { ...VP_BTNS, ...(v.btns || {}) }; return v; };
  // ABXY 아래 작은 이름을 할당에 맞춘다
  function vpLabels() {
    const btns = vpSet().btns;
    for (const b of document.querySelectorAll('#vpad .vp-abxy button[data-b]')) { const sm = b.querySelector('small'), n = (VP_ACTS[btns[b.dataset.b]] || [''])[0]; if (sm && sm.textContent !== n) sm.textContent = n; }
  }
  const vpOrient = () => (matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape');
  const vibe = () => { if (vpSet().vib && navigator.vibrate) try { navigator.vibrate(12); } catch (e) { /* 무시 */ } };
  // 화면이 좁으면 조이스틱과 ABXY가 겹치지 않게 함께 줄이고, 옮겨 둔 위치에서 겹치면 양 끝으로 붙인다
  const VP_GAP = 10;
  function layoutVpad() {
    const vp = document.getElementById('vpad'); if (!vp || !Game.save) return;
    vpLabels();
    const s = vpSet(), pos = { ...VP_POS[vpOrient()], ...((s.pos || {})[vpOrient()] || {}) };
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
      if (overlap) { jcx = VP_GAP + js / 2; acx = W - VP_GAP - abW / 2; jcy = acy = H / 2; }
      jx = jcx / W * 100; jy = jcy / H * 100; ax = acx / W * 100; ay = acy / H * 100;
    }
    const at = { js: [jx, jy], abxy: [ax, ay] };
    for (const g of vp.querySelectorAll('.vp-grp')) { const [x, y] = at[g.dataset.grp]; g.style.left = x + '%'; g.style.top = y + '%'; }
  }
  function initVpad() {
    const vp = document.getElementById('vpad'); if (!vp) return;
    const stick = vp.querySelector('.vp-stick'), base = vp.querySelector('.vp-base'), thumb = vp.querySelector('.vp-thumb'), faceBtn = vp.querySelector('.vp-face');
    let pid = null, dir = null, timer = null, face = false, editing = false;
    const setFace = v => { face = v; faceBtn.classList.toggle('on', v); };
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
  //  RB를 누른 채 A·B·X·Y: 기술 1·2·3·4 / RT 빠른사용 · Back(Select) 지도 · Start 메뉴. 창이 열려 있으면 십자키 위아래로 고르고 A 확인, B 닫기
  const GP = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  const GP_SKILL = [GP.A, GP.B, GP.X, GP.Y];   // RB + 이 버튼 = 기술 1~4
  const GP_NAME = { [GP.A]: 'a', [GP.B]: 'b', [GP.X]: 'x', [GP.Y]: 'y' };
  function initGamepad() {
    if (!navigator.getGamepads) return;
    let raf = 0, prev = [], prevDir = null, uiRepeat = 0, aAt = 0, aLong = false, faceDir = null;
    const pad = () => [...navigator.getGamepads()].find(g => g && g.connected);
    const uiKey = code => UI.key({ code, target: null, preventDefault() {} });
    const stickDir = g => {
      const b = i => !!(g.buttons[i] && g.buttons[i].pressed);
      let dx = (b(GP.RIGHT) ? 1 : 0) - (b(GP.LEFT) ? 1 : 0), dy = (b(GP.DOWN) ? 1 : 0) - (b(GP.UP) ? 1 : 0);
      if (!dx && !dy) {
        const x = g.axes[0] || 0, y = g.axes[1] || 0;
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
      const now0 = performance.now(), down = i => !!(g.buttons[i] && g.buttons[i].pressed), hit = i => down(i) && !prev[i];
      const dir = stickDir(g), any = g.buttons.some(b => b.pressed) || dir != null;
      if (any && Game.poke) Game.poke();   // 자리 비움 깨우기 등
      const skillMode = !UI.isOpen() && !!D && !bigMap && down(GP.RB);
      if (document.body.classList.contains('gp-skill') !== skillMode) document.body.classList.toggle('gp-skill', skillMode);   // 기술 칸에 A·B·X·Y 표시
      if (UI.isOpen()) {
        // 창: 위아래로 고르기 (누르고 있으면 반복), A 확인, B 닫기
        const v = dir === 4 ? 'ArrowUp' : dir === 0 ? 'ArrowDown' : null;
        if (v && (prevDir !== dir || now0 > uiRepeat)) { uiKey(v); uiRepeat = now0 + (prevDir !== dir ? 380 : 140); }
        if (hit(GP.A)) uiKey('Enter'); else if (hit(GP.B)) uiKey('Escape');
        aAt = 0;
      } else if (D && !D.dead) {
        if (bigMap) { if (hit(GP.B) || hit(GP.BACK) || hit(GP.A)) toggleMap(false); }
        else {
          const btns = vpSet().btns;
          if (skillMode) {
            aAt = 0;
            GP_SKILL.forEach((i, slot) => { if (hit(i) && P().moves[slot]) { if (D.auto) stopAuto(); if (!busy()) act({ t: 'skill', slot }); } });
          } else for (const i of [GP.A, GP.B, GP.X, GP.Y]) if (hit(i)) press(GP_NAME[i], btns[GP_NAME[i]]);
          // 공격을 둔 버튼: 짧게 떼면 공격, 길게 누르면 기술
          const atkBtn = [GP.A, GP.B, GP.X, GP.Y].find(i => btns[GP_NAME[i]] === 'attack');
          if (aAt && atkBtn != null) {
            if (down(atkBtn) && !aLong && now0 - aAt > 420) { aLong = true; if (!busy()) { stopAuto(); longSkill(); } }
            if (!down(atkBtn)) { if (!aLong && !busy()) { stopAuto(); act({ t: 'attack' }); } aAt = 0; }
          }
          if (hit(GP.RT)) runAction('quick');
          if (hit(GP.BACK)) runAction('map');
          if (hit(GP.START)) runAction('menu');
          if (dir != null) {
            if (D.auto) stopAuto();
            if (down(GP.LB)) { if (dir !== faceDir && !busy()) { faceDir = dir; act({ t: 'face', dir }); } }
            else if (!busy()) act({ t: 'move', dir });
          }
          if (dir == null || !down(GP.LB)) faceDir = null;
        }
      }
      prev = g.buttons.map(b => b.pressed); prevDir = dir;
    };
    const start = () => { if (!raf && pad()) tick(); };
    window.addEventListener('gamepadconnected', () => {
      start();
      const st = Game.save && Game.save.settings;
      if (st && !st.gpGuided && !UI.isOpen()) { st.gpGuided = true; Game.setSetting('gpGuided', true); gamepadGuide(); }   // 처음 한 번은 안내 창
      else UI.toast('🎮 컨트롤러 연결: RB를 누른 채 A·B·X·Y로 기술 1~4 (행동 메뉴의 🎮 컨트롤러에서 전체 안내)');
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
      const v = { ...vpSet(), js: +box.querySelector('[data-vp=js]').value, ab: +box.querySelector('[data-vp=ab]').value, vib: box.querySelector('[data-vp=vib]').checked,
        order: [0, 1, 2, 3].map(i => +box.querySelector(`[data-ord="${i}"]`).value),
        btns: Object.fromEntries(['a', 'b', 'x', 'y'].map(k => [k, box.querySelector(`[data-btn="${k}"]`).value])) };
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
        <label class="row chk"><input type="checkbox" data-vp="vib" ${s.vib ? 'checked' : ''}> 누를 때 짧은 진동</label>
        <p class="dim">버튼 할당 <span class="dim">(버튼에 두지 않은 행동은 행동 메뉴에 나옵니다)</span></p>
        <div class="vp-btns">${['a', 'b', 'x', 'y'].map(k => `<label><b>${k.toUpperCase()}</b> <select data-btn="${k}">${Object.entries(VP_ACTS).map(([v, [, n]]) => `<option value="${v}" ${s.btns[k] === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`).join('')}</div>
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
        { label: '기본값 복원', fn: () => { Game.save.settings.vpad = { ...VP_DEFAULT }; Game.setSetting('padMode', 'stick'); UI.toast('조작 패드를 기본값으로 되돌렸어요.'); } },
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
    D = null; run = null; CUR_WEATHER = null; faceTemp = null; faceShown = '';
    cancelAnimationFrame(rafId); rafId = 0;
    clearInterval(logicTimer); logicTimer = 0;
    pendingKey = null;
  }
  return { layoutVpad, padSettings, showLog, showStatus, partyMenu, floorCandidates, updateKeyHints, init, enter, leave, get run() { return run; }, get floor() { return D; }, stopAuto, showHelp, addToBag, _log: LOG };
})();
