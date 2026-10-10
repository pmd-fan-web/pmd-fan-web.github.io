// 전투 / 성장 메커니즘
'use strict';

const NORMAL_ATTACK = { n: '공격', t: 0, p: 40, a: 100, pp: 0, c: 2, r: 'f', fg: [1], basic: true };
// 불가사의부적(껍질몬)도 그냥 공격은 이 확률로 맞는다
const WONDER_GUARD_BASIC = 0.3;
const MAX_LEVEL = 100;

const expFor = lv => lv > MAX_LEVEL ? Infinity : Math.pow(lv, 3);   // Lv100까지 오를 수 있다 (예전엔 Lv99→100 필요 경험치가 무한대였다)
// 레벨업 속도: 얻는 경험치를 이 수로 나눈다 (= 필요 경험치 배수). 경험치 표 자체는 모두 같아서 기존 세이브가 흐트러지지 않는다
//  전설·준전설·환상 2배, 울트라비스트·패러독스 1.6배 (종족값이 높아 레벨이 빨리 오르는 것 보정)
//  그 밖에는 원작의 성장 그룹을 절반쯤만 반영: 느림 1.15 · 보통-느림 1.05 · 보통 1 · 빠름 0.9 · 불규칙 0.85 · 변동 1.2
const LEGEND_EXP_DIV = 2, STRONG_EXP_DIV = 1.6;
// 모든 포켓몬 공통: 적을 쓰러뜨려 얻는 경험치 배율, 보스·수배범 배율 (v0.29에서 1 → 0.5, 3 → 2 / v0.30에서 0.5 → 0.3)
const EXP_RATE = 0.3, BOSS_EXP_MUL = 2;
const GROWTH_EXP_DIV = { 1: 1.15, 2: 1, 3: 0.9, 4: 1.05, 5: 0.85, 6: 1.2 };
function expDiv(sp) {
  const d = DATA.species[sp]; if (!d) return 1;
  if (d.lg) return LEGEND_EXP_DIV;
  const base = d.f ? d.f[0] : +sp;
  if ((typeof PARADOX !== 'undefined' && PARADOX.includes(base)) || (typeof ULTRA_BEASTS !== 'undefined' && ULTRA_BEASTS.includes(base))) return STRONG_EXP_DIV;
  return GROWTH_EXP_DIV[d.gr || 2] || 1;
}

function calcStats(sp, lv, iv) {
  const b = DATA.species[sp].b;
  const f = B => Math.floor((2 * B + iv) * lv / 100);
  return {
    maxhp: f(b[0]) + lv + 10,
    atk: f(b[1]) + 5, def: f(b[2]) + 5, spa: f(b[3]) + 5, spd: f(b[4]) + 5, spe: f(b[5]) + 5,
  };
}

// 종족값이 모두 B인 개체의 능력치 (화난 상점 켈리몬)
function statsFromBase(B, lv, iv) {
  const f = Math.floor((2 * B + iv) * lv / 100);
  return { maxhp: f + lv + 10, atk: f + 5, def: f + 5, spa: f + 5, spd: f + 5, spe: f + 5 };
}

function isDamaging(mid) { const m = DATA.moves[mid]; return m && m.c !== 1; }

function defaultMoves(sp, lv) {
  const list = [];
  for (const [l, m] of DATA.species[sp].l) if (l <= lv && !list.includes(m)) list.push(m);
  let moves = list.slice(-4);
  if (!moves.some(isDamaging)) {
    const dmg = list.filter(isDamaging).pop();
    if (dmg) moves = [dmg, ...moves.slice(-3)];
  }
  return moves;
}
const learnableUpTo = (sp, lv) => [...new Set(DATA.species[sp].l.filter(([l]) => l <= lv).map(x => x[1]))];
const learnedAt = (sp, lv) => DATA.species[sp].l.filter(([l]) => l === lv).map(x => x[1]);
// 레벨업 알림용: 진화 전 모습이 그 레벨에 배우는 기술도 (예: 버섯꼬의 Lv40 버섯포자를 먼저 진화한 버섯모도)
const learnedAtAll = (sp, lv) => [...new Set([...learnedAt(sp, lv), ...preEvos(sp).flatMap(p => learnedAt(p, lv))])];

// 던전 안에서 쓰는 개체
// ── 기술 숙련도: 포켓몬마다·기술마다 쓴 횟수 (save.mastery[sp][mid], 기술을 빼도 남고 로그라이크에서도 쌓인다) ──
// ★n까지 필요한 사용 횟수 = 기본 PP의 절반 × (1 + 2 + … + n). ★마다 PP 최대치 +10%, PP를 안 쓸 확률 +3% (★10: +100%, 30%)
const MASTERY_MAX = 10, MASTERY_PP = 0.1, MASTERY_FREE = 0.03;
const masteryUses = (sp, mid) => ((typeof Game !== 'undefined' && Game.save && Game.save.mastery && Game.save.mastery[sp]) || {})[mid] || 0;
const masteryNeed = (mid, n) => Math.ceil(DATA.moves[mid].pp / 2 * n * (n + 1) / 2);   // ★n까지의 누적 횟수
function masteryLevel(sp, mid) {
  const u = masteryUses(sp, mid);
  let n = 0;
  while (n < MASTERY_MAX && u >= masteryNeed(mid, n + 1)) n++;
  return n;
}
const masteryMaxPP = (sp, mid) => Math.round(DATA.moves[mid].pp * (1 + MASTERY_PP * masteryLevel(sp, mid)));
const masteryFree = (sp, mid) => MASTERY_FREE * masteryLevel(sp, mid);
// 기술 하나 (탐험대는 숙련도만큼 PP 최대치가 늘어난다)
function newMove(c, mid) {
  const max = c && (c.player || c.ally) ? masteryMaxPP(c.sp, mid) : DATA.moves[mid].pp;
  return { id: mid, pp: max, max };
}

function makeCreature(sp, lv, opts = {}) {
  const d = DATA.species[sp];
  const iv = opts.player || opts.ally ? 31 : 8;   // 플레이어와 동료는 개체값 최고
  const c = {
    sp, lv, exp: opts.exp || expFor(lv), types: d.t.slice(), player: !!opts.player, ally: !!opts.ally,
    iv, stages: {}, status: null, statusT: 0, flinch: false, dir: 0, x: 0, y: 0, id: Math.random(),
    ...applyBoost(calcStats(sp, lv, iv), opts.boost),
  };
  if (opts.boost) c.boost = { ...opts.boost };
  c.ability = opts.ability != null ? opts.ability : (opts.player || opts.ally ? defaultAbility(sp) : randomAbility(sp));
  c.hp = c.maxhp;
  const ml = opts.moves || defaultMoves(sp, lv);
  c.moves = ml.map(id => newMove(c, id));
  if (opts.pp) c.moves.forEach((m, i) => { if (opts.pp[i] != null) m.pp = Math.min(m.max, opts.pp[i]); });
  return c;
}

function recalc(c) {
  const old = c.maxhp;
  Object.assign(c, c.baseAll ? statsFromBase(c.baseAll, c.lv, c.iv) : applyBoost(calcStats(looksOf(c), c.lv, c.iv), c.boost));   // 모습이 바뀌면 그 모습의 능력치
  if (c.hpMul) c.maxhp = Math.floor(c.maxhp * c.hpMul);   // 보스·수배범의 HP 배율 (모습이 바뀌어도 유지)
  if (c.statMul) for (const k of ['atk', 'def', 'spa', 'spd']) c[k] = Math.floor(c[k] * c.statMul);
  if (c.tf) {   // 변신한 동안: HP는 원래 포켓몬 기준, 나머지 능력치는 TF_STAT_MUL배
    c.maxhp = applyBoost(calcStats(c.sp, c.lv, c.iv), c.boost).maxhp;
    for (const k of ['atk', 'def', 'spa', 'spd', 'spe']) c[k] = Math.floor(c[k] * TF_STAT_MUL);
  }
  c.hp = clamp(c.hp + (c.maxhp - old), 1, c.maxhp);
}

// 능력 단계 (공격·방어·특공·특방): +1마다 +25%, 최대 +6에 2.5배 / −6에 0.4배 (v0.50 너프, 원래는 +6에 4배)
const stageMul = s => s >= 0 ? (4 + s) / 4 : 4 / (4 - s);
// 스피드 단계: 기본 스피드 차이 보정(최대 ±20%)과 따로, 단계 차이 1마다 명중 ×(1+SPEED_STAGE_ACC) 곱연산 (+6이면 내 명중 ×1.34, 나를 노리는 공격 ÷1.34)
const SPEED_STAGE_ACC = 0.05;
const accMul = s => s >= 0 ? (3 + s) / 3 : 3 / (3 - s);

// 불가사의 던전식 상성: 효과가 굉장함 1.4배, 별로 0.7배, 원래 무효인 상성은 0.5배 (이중이면 곱해짐)
// 특성에 의한 무효(부유, 저수 등)는 calcHit/resolveHit에서 따로 처리한다
const TYPE_MUL = { 2: 1.4, 0.5: 0.7, 0: 0.5, 1: 1 };
// mid: 상성이 특별한 기술 (프리즈드라이: 물에게 굉장함 / 플라잉프레스: 격투+비행 상성 / 사우전드애로: 비행에게도 보통)
const FREEZE_DRY = 573, FLYING_PRESS = 560, THOUSAND_ARROWS = 614;
function typeEff(moveType, types, mid) {
  if (!moveType) return 1;
  // 굉장함과 별로가 겹치면 서로 지워서 보통(1배)이 된다 (1.4 × 0.7 = 0.98로 '별로'가 되지 않게)
  let n = 0, e = 1;
  for (const a of mid === FLYING_PRESS ? [moveType, 3] : [moveType]) for (const t of types) {
    let c = DATA.chart[a - 1][t - 1];
    if (mid === FREEZE_DRY && t === 11) c = 2;
    if (mid === THOUSAND_ARROWS && a === 5 && t === 3) c = 1;
    if (c === 2) n++; else if (c === 0.5) n--; else if (c === 0) e *= TYPE_MUL[0];
  }
  return e * (n > 0 ? TYPE_MUL[2] ** n : n < 0 ? TYPE_MUL[0.5] ** -n : 1);
}

// 현재 날씨 (플레이어가 날씨부정/에어록이면 무효)
// 실제 날씨 이름 (아주 강한 햇살 등 전용 날씨 그대로). 효과 계산은 weatherNow (전용 날씨는 쾌청·비로 본다)
function weatherRaw() {
  if (!CUR_WEATHER) return null;
  if (typeof Dungeon !== 'undefined' && Dungeon.floor && abilityOf(Dungeon.floor.player).cloudNine) return null;
  return CUR_WEATHER;
}
function weatherNow() {
  if (!CUR_WEATHER) return null;
  if (WEATHERS[CUR_WEATHER] && WEATHERS[CUR_WEATHER].base) return weatherRaw() && WEATHERS[CUR_WEATHER].base;
  if (typeof Dungeon !== 'undefined' && Dungeon.floor && abilityOf(Dungeon.floor.player).cloudNine) return null;
  return CUR_WEATHER;
}
// 스피드: 명중률·회피율 보정에 쓰인다
function speedOf(c) {
  let s = c.spe * (abVal(c, 'speedMul') || 1) * (heldOf(c).speedMul || 1) * (c.player && c.partners === 0 ? SOLO_STAT_MUL : 1);
  if (abilityOf(c).quickFeet && c.status) s *= 1.5;
  else if (c.status === 'par') s *= 0.5;
  return s;
}
// 스피드 차이 → 명중 배율: 스피드(특성·물건·마비 포함) 2배 빠르면 +20%, 절반이면 −20% (최대 ±20%) × 1.05^(스피드 단계 차이)
function speedAccMul(att, def) {
  const st = ((att.stages && att.stages[6]) || 0) - ((def.stages && def.stages[6]) || 0);
  return clamp(1 + 0.2 * Math.log2(speedOf(att) / speedOf(def)), 0.8, 1.2) * (1 + SPEED_STAGE_ACC) ** st;
}

// 기술 분류
const hasFlag = (m, f) => !!(m.fg && m.fg.includes(f));
const isContact = m => hasFlag(m, 1);
const isSlicing = m => SLICING_MOVES.has(m.id);   // 원작 목록 (js/moverules.js)
// 특성이 바꾸는 기술 타입: 노말스킨(모든 기술 → 노말), 촉촉보이스(소리 기술 → 물), 페어리스킨 등(노말 기술 → 그 타입). 타입 없는 기본 공격은 그대로
// 덩굴방망이(오거폰): 쓰고 있는 가면의 타입 (풀 말고 다른 타입). 가면이 없으면 풀
function ivyType(att, move) {
  if (!move.ivy) return move.t;
  const s = DATA.species[looksOf(att)];
  return (s && s.f && s.f[0] === 1017 && s.t.find(t => t !== 12)) || move.t;
}
function moveType(att, move) { const A = abilityOf(att), t = ivyType(att, move); return A.normalize && t ? 1 : A.soundType && hasFlag(move, 9) ? A.soundType : A.skin && t === 1 ? A.skin : t; }
function bestStatKey(c) { return ['atk', 'def', 'spa', 'spd'].reduce((b, k) => (c[k] > c[b] ? k : b), 'atk'); }

// 플라워기프트: 쾌청이면 같은 편(탐험대끼리, 적끼리)에 플라워기프트를 가진 포켓몬이 있으면 공격·특수방어 1.5배 (v0.99)
function flowerGiftAlly(c) {
  if (weatherNow() !== 'sun' || typeof Dungeon === 'undefined' || !Dungeon.floor) return false;
  const F = Dungeon.floor, mine = !!(c.player || c.ally);
  return [F.player, ...F.mons].some(o => o && o !== c && o.hp > 0 && !o.npc && !!(o.player || o.ally) === mine && abilityOf(o).flowerGift);
}
// 특성에 의한 능력치 배율 (brk: 틀깨기 등으로 공격받는 쪽이면 방어 특성 배율을 무시한다, v0.99)
function statMul(c, key, brk) {
  const A = brk ? {} : abilityOf(c);
  let m = 1;
  if (key === 'atk') {
    const am = abVal(c, 'atkMul'); if (am) m *= am;
    if (A.guts && c.status) m *= 1.5;
    if (A.toxicBoost && c.status === 'psn') m *= 1.5;
    if (A.slowStart && c.slowT > 0) m *= 0.5;
    if (A.defeatist && c.hp * 2 <= c.maxhp) m *= 0.5;
  } else if (key === 'spa') {
    const sm = abVal(c, 'spaMul'); if (sm) m *= sm;
    if (A.flareBoost && c.status === 'brn') m *= 1.5;
    if (A.defeatist && c.hp * 2 <= c.maxhp) m *= 0.5;
  } else if (key === 'def') {
    if (A.marvel && c.status) m *= 1.5;
    if (A.defMul) m *= A.defMul;
  } else if (key === 'spd') {
    const dm = !brk && abVal(c, 'spdMul'); if (dm) m *= dm;
  }
  if ((key === 'atk' || key === 'spd') && !brk && !A.flowerGift && flowerGiftAlly(c)) m *= 1.5;   // 같은 편의 플라워기프트 (쾌청)
  const bm = abVal(c, 'bestStatMul');   // 쿼크차지 / 고대활성(쾌청)
  if (bm && key === bestStatKey(c)) m *= bm;
  const H = heldOf(c);
  if (H[key + 'Mul']) m *= H[key + 'Mul'];
  if (H.eviolite && (key === 'def' || key === 'spd') && DATA.species[c.sp].v.length) m *= 1.5;
  if (c.player && c.partners === 0) m *= SOLO_STAT_MUL;   // 혼자 탐험 보정
  return m;
}
function evasionMul(c, A) {
  let m = (A === abilityOf(c) ? abVal(c, 'evasion') : A.evasion) || 1;
  if (A.runAway && c.hp * 4 <= c.maxhp) m *= 1.5;
  if (A.tangled && c.status === 'cnf') m *= 1.5;
  m *= heldOf(c).evaMul || 1;
  return m;
}
// 공격 측 위력 배율
function powerMul(att, def, move, mt, A) {
  let m = 1;
  if (A.pinch === mt && att.hp * 3 <= att.maxhp) m *= 1.5;
  if (A.typeMul && A.typeMul[mt]) m *= A.typeMul[mt];
  if (A.technician && move.p <= 60) m *= 1.5;
  if (A.flagMul && hasFlag(move, A.flagMul[0])) m *= A.flagMul[1];
  if (A.slicing && isSlicing(move)) m *= A.slicing;
  if (A.sheer && (move.ail || move.fl || (move.sc && !move.ss))) m *= 1.3;
  if (A.reckless && move.dr < 0) m *= 1.2;
  if ((A.skin && move.t === 1) || (A.normalize && move.t)) m *= 1.2;
  if (A.rival && def.types.some(t => att.types.includes(t))) m *= 1.25;
  if (A.vsTypeMul) for (const t of def.types) if (A.vsTypeMul[t]) m *= A.vsTypeMul[t];
  if (att.flashFire && mt === 10) m *= 1.5;
  return m;
}
// 방어 측 데미지 배율
function guardMul(def, Dd, move, mt, eff) {
  let m = 1;
  if (Dd.resist && Dd.resist[mt]) m *= Dd.resist[mt];
  if (Dd.seMul && eff > 1) m *= Dd.seMul;
  if (Dd.fullHpHalf && def.hp >= def.maxhp) m *= 0.5;
  if (Dd.contactResist && isContact(move)) m *= Dd.contactResist;
  if (Dd.specialResist && move.c === 3) m *= Dd.specialResist;
  if (Dd.physResist && move.c === 2) m *= Dd.physResist;
  if (Dd.flagResist && hasFlag(move, Dd.flagResist[0])) m *= Dd.flagResist[1];
  if (Dd.dmgTaken) m *= Dd.dmgTaken;
  if (Dd.areaResist && move.r === 'r') m *= Dd.areaResist;
  return m;
}

// 기술의 상성 배율 (상성이 특별한 기술, 배짱: 노말·격투 기술이 고스트를 무시)
function moveEff(att, def, move, mt, A) {
  const types = A.scrappy && (mt === 1 || mt === 2) ? def.types.filter(t => t !== 8) : def.types;
  return typeEff(mt, types, move.id);
}

// 실제 피해 계산 (명중 판정 포함)
function calcHit(att, def, move) {
  const A = abilityOf(att), Dd = defAbility(att, def);
  const wxa = typeof MOVE_RULES !== 'undefined' && MOVE_RULES[move.id] && MOVE_RULES[move.id].wxAcc, wxw = wxa && wxa[weatherNow()];   // 번개·눈보라 등
  if (wxw === 'sure') { /* 날씨 덕분에 반드시 맞는다 */ }
  else if (move.a && !A.noGuard && !Dd.noGuard && !(A.prankster && move.c === 1)) {
    const aSt = Dd.unaware ? 0 : (att.stages[7] || 0), eSt = A.unaware || A.ignoreEvasion ? Math.min(0, def.stages[8] || 0) : (def.stages[8] || 0);
    let acc = (wxw || move.a) * accMul(aSt) / accMul(eSt) * (A.accMul || 1) / (A.ignoreEvasion ? 1 : evasionMul(def, Dd));
    if (A.hustle && move.c === 2) acc *= 0.8;
    if (Dd.miracle && move.c === 1) acc *= 0.5;
    if (Dd.foeAcc) acc *= Dd.foeAcc;
    acc *= (heldOf(att).accMul || 1) * (heldOf(def).foeAcc || 1);
    acc *= speedAccMul(att, def);
    if (weatherNow() === 'fog') acc *= 0.9;
    if (Math.random() * 100 >= acc) return { miss: true };
  }
  if (move.c === 1) return { hit: true, dmg: 0, eff: 1 };
  const mt = moveType(att, move);
  let eff = moveEff(att, def, move, mt, A);
  if (weatherRaw() === 'wind' && mt && def.types.includes(3) && typeEff(mt, [3]) > 1) eff /= TYPE_MUL[2];   // 난기류: 비행의 약점을 지운다
  if (Dd.levitate && mt === 5 && move.id !== THOUSAND_ARROWS) eff = 0;
  if (Dd.immuneFlag && hasFlag(move, Dd.immuneFlag)) eff = 0;
  if (Dd.wonderGuard && eff <= 1 && !(move.basic && Math.random() < WONDER_GUARD_BASIC)) eff = 0;
  if (eff === 0) return { hit: true, dmg: 0, eff: 0 };
  const phys = move.c === 2;
  let aSt = Dd.unaware ? 0 : (att.stages[phys ? 2 : 4] || 0);
  let dSt = def.stages[phys ? 3 : 5] || 0;
  if (A.unaware) dSt = 0; else if (A.infiltrate) dSt = Math.min(0, dSt);
  let Atk = (phys ? att.atk : att.spa) * statMul(att, phys ? 'atk' : 'spa') * stageMul(aSt);
  let Def = (phys ? def.def : def.spd) * statMul(def, phys ? 'def' : 'spd', !!A.moldBreaker) * stageMul(dSt);   // 틀깨기: 상대의 이상한비늘·플라워기프트 무시
  const W = weatherNow();
  if (W === 'sand' && !phys && def.types.includes(6)) Def *= 1.5;
  if (W === 'snow' && phys && def.types.includes(15)) Def *= 1.5;
  if (phys && att.status === 'brn' && !A.guts) Atk *= 0.5;
  const Ha = heldOf(att);
  const critStage = (move.cr || 0) + (A.critStage || 0) + (Ha.critStage || 0) + (att.critBoost || 0);
  const crit = !Dd.noCrit && (A.merciless && def.status === 'psn' || Math.random() < [1 / 16, 1 / 8, 1 / 2, 1][clamp(critStage, 0, 3)]);
  const power = move.p * powerMul(att, def, move, mt, A) * (phys ? Ha.physMul || 1 : Ha.specMul || 1) * ((Ha.typeMul && Ha.typeMul[mt]) || 1) * (Ha.lifeOrb ? 1.3 : 1);
  let dmg = Math.floor(Math.floor(Math.floor(2 * att.lv / 5 + 2) * power * Atk / Def) / 50) + 2;
  if (mt && (att.types.includes(mt) || A.protean)) dmg *= A.adapt ? 2 : 1.5;
  dmg *= eff;
  if (Ha.seBoost && eff > 1) dmg *= Ha.seBoost;
  if (A.neuroforce && eff > 1) dmg *= 1.25;   // 브레인포스
  const Wa = A.megaSol ? 'sun' : W;   // 메가솔라: 자기 기술은 늘 쾌청처럼
  if (Wa === 'sun') dmg *= mt === 10 ? 1.5 : mt === 11 ? (move.id === 876 ? 1.5 : 0.5) : 1;   // 하이드로스팀은 쾌청에서 오히려 1.5배
  if (Wa === 'rain') dmg *= mt === 11 ? 1.5 : mt === 10 ? 0.5 : 1;
  if (A.tinted && eff < 1) dmg *= 2;
  dmg *= (crit ? (A.sniper ? 2.25 : 1.5) : 1) * (0.85 + Math.random() * 0.15);
  dmg *= guardMul(def, Dd, move, mt, eff);
  if (phys ? def.reflectT : def.screenT) dmg *= 0.5;   // 리플렉터·빛의장막
  if (!att.player && def.player && def.partners === 0) dmg *= SOLO_DMG_MUL;   // 혼자 탐험 보정 (동료와 함께 들어왔으면 모두 쓰러져도 없음)
  return { hit: true, dmg: Math.max(1, Math.floor(dmg)), eff, crit };
}

// 자동 전투·동료 AI용 예상 점수 (실제 계산의 상성·면역·방어 특성·날씨를 반영. 효과가 없으면 0)
function moveScore(att, def, move) {
  if (!move || move.c === 1) return 0;
  const phys = move.c === 2;
  const A = phys ? att.atk : att.spa, D = phys ? def.def : def.spd;
  const Ab = abilityOf(att), Dd = defAbility(att, def), mt = moveType(att, move);
  const stab = mt && (att.types.includes(mt) || Ab.protean) ? (Ab.adapt ? 2 : 1.5) : 1;
  const hits = move.hits ? (Ab.skillLink ? move.hits[1] : (move.hits[0] + move.hits[1]) / 2) : 1;
  let eff = moveEff(att, def, move, mt, Ab);
  if (WX_BLOCK[weatherRaw()] === mt) return 0;   // 아주 강한 햇살의 물 기술, 강한 비의 불꽃 기술은 실패한다
  if (weatherRaw() === 'wind' && mt && def.types.includes(3) && typeEff(mt, [3]) > 1) eff /= TYPE_MUL[2];
  // 면역: 부유(땅), 흡수 특성(저수·건조한피부·축전 등), 방음·방탄 같은 기술 종류 면역
  if ((Dd.levitate && mt === 5 && move.id !== THOUSAND_ARROWS) || (Dd.absorb && Dd.absorb.t === mt) || (Dd.immuneFlag && hasFlag(move, Dd.immuneFlag))) return 0;
  if (Dd.wonderGuard && eff <= 1) eff = move.basic ? eff * WONDER_GUARD_BASIC : 0;
  if (!eff) return 0;
  const W = Ab.megaSol ? 'sun' : weatherNow();
  const wx = W === 'sun' ? (mt === 10 ? 1.5 : mt === 11 ? (move.id === 876 ? 1.5 : 0.5) : 1) : W === 'rain' ? (mt === 11 ? 1.5 : mt === 10 ? 0.5 : 1) : 1;
  const tinted = Ab.tinted && eff < 1 ? 2 : 1;
  const wall = (phys ? def.reflectT : def.screenT) ? 0.5 : 1;
  return move.p * powerMul(att, def, move, mt, Ab) * hits * stab * eff * wx * tinted * wall * guardMul(def, Dd, move, mt, eff) * (A / D) * ((move.a || 100) / 100);
}

function effText(eff) {
  if (eff === 0) return '효과가 없는 것 같다...';
  if (eff > 1) return '효과가 굉장했다!';
  if (eff < 1) return '효과가 별로인 것 같다...';
  return '';
}

// 5세대식: 상대보다 레벨이 높을수록 경험치 감소
// 내 레벨보다 LOW_LV_GAP 이상 낮은 적은 전체 배율 EXP_RATE 대신 LOW_LV_MUL배
const LOW_LV_GAP = 6, LOW_LV_MUL = 0.1;
// 혼자 탐험할 때 적에게 받는 데미지 배율
const SOLO_DMG_MUL = 0.85, SOLO_STAT_MUL = 1.1;   // 혼자 탐험 보정: 받는 데미지 배율, 능력치(HP 제외) 배율
function expGain(enemy, plv) {
  const e = enemy.lv, scale = Math.pow((2 * e + 10) / (e + plv + 10), 2.5);
  return Math.max(1, Math.floor(DATA.species[enemy.sp].x * e / 7 * scale * (plv - e >= LOW_LV_GAP ? LOW_LV_MUL : EXP_RATE)));
}
