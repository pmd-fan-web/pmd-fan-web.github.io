// 폼체인지 · 메가진화
// 모습(species.fc)은 원래 포켓몬이 던전에서 잠깐 바뀌는 모습이다. c.sp(원래 포켓몬)는 그대로 두고 c.fsp에 보이는 모습을 둔다.
//   item   : 정해진 도구를 지니면 (백금옥 → 기라티나 오리진폼, 녹슨검 → 자시안 검왕 등)
//   mega   : 메가스톤을 지니면 (레쿠쟈는 화룡점정을 알고 있으면)
//   select : 마을의 캐릭터 탭에서 골라 둔 모습 (로토무, 테오키스, 쉐이미 등). 적으로 나올 때는 가끔 다른 모습
//   battle : 특성·기술로 던전 안에서 바뀐다 (캐스퐁, 킬가르도, 불비달마, 약어리, 메테노 등)
// 모습이 바뀌면 능력치·타입·특성이 그 모습의 것이 되고, 기술은 그대로다.
'use strict';

const FORMS_OF = {};        // 원래 포켓몬 번호 → 모습 번호들
const FORM_ID = {};         // 포켓API 이름(예: giratina-origin) → 모습 번호
for (const id of Object.keys(DATA.species)) {
  const s = DATA.species[id];
  if (!s.fc) continue;
  (FORMS_OF[s.f[0]] = FORMS_OF[s.f[0]] || []).push(+id);
  FORM_ID[s.fi] = +id;
}
const formsOfKind = (sp, kind) => (FORMS_OF[sp] || []).filter(id => DATA.species[id].fc === kind);

// ── 도구로 바뀌는 모습 ──
const FORM_ITEMS = {
  griseousorb: 'giratina-origin', adamantorb: 'dialga-origin', lustrousorb: 'palkia-origin',
  rustedsword: 'zacian-crowned', rustedshield: 'zamazenta-crowned',
  wellspringmask: 'ogerpon-wellspring-mask', hearthflamemask: 'ogerpon-hearthflame-mask', cornerstonemask: 'ogerpon-cornerstone-mask',
  blueorb: 'kyogre-primal', redorb: 'groudon-primal', ultranecroziumz: 'necrozma-ultra',
};
for (const [item, fi] of Object.entries(FORM_ITEMS)) if (ITEMS[item] && FORM_ID[fi]) ITEMS[item].formTo = FORM_ID[fi];

// ── 메가스톤: 메가진화 모습마다 하나 (던전에서만, 드롭 확률은 MEGA_RATE) ──
const MEGA_STONE_PRICE = 30000;
// 메가스톤 드롭: 일반 드롭 테이블과 따로 굴린다. 레벨 MEGA_MIN_LV 이상인 보스·이로치·층에서만, 던전 타입에 맞는 메가스톤만
// (보스·이로치 0.5%, 구조 보답·바닥 아이템·적이 떨어뜨리는 아이템 0.05%)
const MEGA_RATE = { boss: 0.01, shiny: 0.01, rescue: 0.001, floor: 0.001 };   // v0.52: 2배
const MEGA_MIN_LV = 35;
const megaPool = dg => MEGA_STONES.filter(id => typeFits(dg, id));
// 메가 진화의 탑에서는 출발할 때 고른 메가스톤(save.megaFocus)이 MEGA_FOCUS_RATE 확률로 나온다
const MEGA_FOCUS_RATE = 0.25;
function rollMega(kind, lvl, dg) {
  if (lvl < MEGA_MIN_LV || Math.random() >= MEGA_RATE[kind] * ((dg && dg.megaMul) || 1)) return null;
  const pool = megaPool(dg), focus = typeof Game !== 'undefined' && Game.save && Game.save.megaFocus;
  if (dg && dg.megaMul && focus && pool.includes(focus) && Math.random() < MEGA_FOCUS_RATE) return focus;
  return pool.length ? pick(pool) : null;
}
const MEGA_NO_STONE = { 384: 620 };   // 레쿠쟈: 메가스톤 대신 화룡점정을 알고 있으면
const MEGA_STONES = [];
for (const [fi, fid] of Object.entries(FORM_ID)) {
  const s = DATA.species[fid];
  if (s.fc !== 'mega' || MEGA_NO_STONE[s.f[0]]) continue;
  const base = s.f[0], xy = /-mega-([xyz])$/.exec(fi), id = 'ms_' + fi.replace(/-/g, '_');
  ITEMS[id] = {
    n: `${spName(base)}나이트${xy ? xy[1].toUpperCase() : ''}`, icon: '♾️', price: MEGA_STONE_PRICE, use: 'none', held: true, mega: fid,
    d: `[메가스톤] ${spName(base)}에게 지니게 하면 던전에서 ${s.n}${jo(s.n, '으로').slice(s.n.length)} 메가진화한다. 다른 포켓몬에게는 효과가 없다.`,
    hold: { only: [base] }, formTo: fid,
  };
  MEGA_STONES.push(id);
}

// ── 전투 중 바뀌는 모습: 원래 포켓몬 번호 → 지금 되어야 할 모습의 포켓API 이름 (없으면 원래 모습) ──
const hpRate = c => c.hp / c.maxhp;
const BATTLE_FORMS = {
  351: c => ({ sun: 'castform-sunny', rain: 'castform-rainy', snow: 'castform-snowy' })[weatherNow()],   // 캐스퐁: 날씨
  778: c => (c.disguiseBroken ? 'mimikyu-busted' : null),                           // 따라큐: 탈이 벗겨지면 (층마다 다시, v0.99)
  421: c => (weatherNow() === 'sun' ? 'cherrim-sunshine' : null),                   // 체리꼬: 쾌청이면 포지폼 (v0.99)
  681: c => (c.blade ? 'aegislash-blade' : null),                                    // 킬가르도: 공격 기술을 쓰면 블레이드폼, 변화 기술·대기면 실드폼
  555: c => (hpRate(c) <= 0.5 ? 'darmanitan-zen' : null),                            // 불비달마: HP 절반 이하
  746: c => (c.lv >= 20 && hpRate(c) > 0.25 ? 'wishiwashi-school' : null),          // 약어리: Lv20 이상, HP 1/4 초과
  774: c => {                                                                         // 메테노: HP 절반 이하면 코어 (색은 개체마다)
    if (hpRate(c) > 0.5) return null;
    if (c.coreColor == null) c.coreColor = rand(7);
    return 'minior-' + ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'violet'][c.coreColor];
  },
  875: c => (c.noice ? 'eiscue-noice' : null),                                       // 빙큐보: 물리 공격을 한 번 막으면 나이스페이스 (설경인 층에서 되돌아옴)
  877: c => (c.hangry ? 'morpeko-hangry' : null),                                    // 모르페코: 5턴마다 바뀜 (js/dungeon.js MORPEKO_TURNS)
  964: c => (c.hero ? 'palafin-hero' : null),                                        // 돌핀맨: 계단을 한 번 내려가면 마이티폼
  648: c => (c.pirouette ? 'meloetta-pirouette' : null),                             // 메로엣타: 옛노래를 쓸 때마다 바뀜
  718: c => (c.complete || hpRate(c) <= 0.5 ? (c.complete = true, 'zygarde-complete') : null),   // 지가르데: HP 절반 이하면 그 층 동안 퍼펙트폼
  1024: c => 'terapagos-terastal',                                                   // 테라파고스: 던전에서는 늘 테라스탈폼
};
// 전투 중 모습은 그 특성이 있을 때만 (캐스퐁은 날씨 특성, 나머지는 원래 특성)
const BATTLE_ABILITY = { 778: 209, 421: 122, 351: 59, 681: 176, 555: 161, 746: 208, 774: 197, 875: 248, 877: 258, 964: 278 };

// 지금 되어야 할 모습 (우선순위: 도구·메가 > 전투 > 골라 둔 모습)
function wantedForm(c) {
  const sp = c.sp;
  if (!FORMS_OF[sp]) return null;
  const h = c.held && ITEMS[c.held];
  if (h && h.formTo && DATA.species[h.formTo].f[0] === sp) return h.formTo;
  if (MEGA_NO_STONE[sp] && c.moves.some(m => m.id === MEGA_NO_STONE[sp])) { const m = formsOfKind(sp, 'mega')[0]; if (m) return m; }
  const rule = BATTLE_FORMS[sp];
  if (rule && (!BATTLE_ABILITY[sp] || (c.baseAbility ?? c.ability) === BATTLE_ABILITY[sp])) {
    const fi = rule(c);
    if (fi && FORM_ID[fi]) return FORM_ID[fi];
  }
  if (c.selForm && DATA.species[c.selForm]?.f?.[0] === sp) return c.selForm;
  return null;
}

// 모습 바꾸기. 바뀌었으면 true
function setForm(c, fid) {
  const target = fid && fid !== c.sp ? fid : null;
  if ((c.fsp || null) === target) return false;
  if (c.baseAbility == null) c.baseAbility = c.ability;
  // 특성: 원래 모습에서 몇 번째 특성이었는지에 맞춰 그 모습의 특성을 고른다
  const baseAb = DATA.species[c.sp].ab, slot = Math.max(0, baseAb.findIndex(a => a[0] === c.baseAbility));
  c.fsp = target || undefined;
  const d = DATA.species[looksOf(c)];
  c.types = d.t.slice();
  c.ability = target ? (d.ab[slot] || d.ab[0] || [c.baseAbility])[0] : c.baseAbility;
  recalc(c);
  if (typeof Sprites !== 'undefined') Sprites.load(looksOf(c), c.shiny);
  return true;
}
// 되어야 할 모습으로 맞춘다. 바뀌었으면 { from, to, kind }
function updateForm(c) {
  if (!c || c.hp <= 0 || !FORMS_OF[c.sp]) return null;
  const from = looksOf(c), want = wantedForm(c);
  if (!setForm(c, want)) return null;
  return { from, to: looksOf(c), kind: want ? DATA.species[want].fc : 'back' };
}
// 층에 들어설 때 초기화할 전투 상태
function resetBattleForm(c, weather) {
  c.blade = false; c.complete = false; c.hangry = false; c.disguiseBroken = false; c.berserkUsed = false;   // 탈·발끈도 층마다 다시
  if (c.noice && weather === 'snow') c.noice = false;
}
// 적으로 나올 때: 골라 둘 수 있는 모습이 있으면 가끔 그 모습
function rollEnemyForm(c) {
  const sel = formsOfKind(c.sp, 'select');
  if (sel.length && Math.random() < 0.5) { c.selForm = pick(sel); giveFormSig(c); }
}
// 이 모습을 고르려면 영입해 둬야 하는 포켓몬 (버드렉스 백마·흑마: 블리자포스·레이스포스)
const FORM_NEEDS = { 1244: 896, 1245: 897 };
// 모습 전용기: 적이 그 모습으로 나오면 이 기술을 쓴다 (플레이어는 캐릭터 탭의 기술 설정에서)
const FORM_SIG = { 1244: 824, 1245: 825 };
function giveFormSig(c) {
  const mv = FORM_SIG[c.selForm];
  if (mv && DATA.moves[mv] && !c.moves.some(m => m.id === mv)) c.moves[0] = newMove(c, mv);
}
// 도감·설명용
const FORM_KIND_NAMES = { item: '도구', mega: '메가진화', select: '모습 고르기', battle: '던전에서 변신' };
const formKindName = id => FORM_KIND_NAMES[DATA.species[id]?.fc] || '';
function formHowText(id) {
  const s = DATA.species[id]; if (!s || !s.fc) return '';
  const base = spName(s.f[0]);
  if (s.fc === 'item' || s.fc === 'mega') {
    if (MEGA_NO_STONE[s.f[0]]) return `${jo(base, '이')} 화룡점정을 알고 있으면 던전에서 메가진화한다.`;
    const item = Object.keys(ITEMS).find(k => ITEMS[k].formTo === id);
    return `${base}에게 ${jo(item ? ITEMS[item].n : '정해진 도구', '을')} 지니게 하면 던전에서 이 모습이 된다.${s.fc === 'mega' ? ' 메가스톤은 적 Lv35 이상 층에서 아주 드물게 떨어진다.' : ''}`;
  }
  if (s.fc === 'select') return `마을의 캐릭터 탭에서 ${base}의 모습을 고를 수 있다.`;
  return BATTLE_FORM_TEXT[s.f[0]] || `${jo(base, '이')} 던전에서 특성으로 변신한 모습.`;
}
const BATTLE_FORM_TEXT = {
  351: '캐스퐁(날씨 특성)은 쾌청·비·설경에 따라 모습과 타입이 바뀐다.',
  681: '킬가르도(배틀스위치)는 공격 기술을 쓰면 블레이드폼, 변화 기술을 쓰거나 기다리면 실드폼이 된다.',
  555: '불비달마(달마모드)는 HP가 절반 이하가 되면 달마모드가 된다.',
  746: '약어리(어군)는 Lv20 이상이고 HP가 1/4보다 많으면 군집의 모습이 된다.',
  774: '메테노(리밋실드)는 HP가 절반 이하가 되면 껍질이 깨져 코어가 드러난다 (색은 개체마다).',
  875: '빙큐보(아이스페이스)는 물리 공격을 한 번 막아 주고 나이스페이스가 된다. 설경인 층에 들어서면 되돌아온다.',
  877: '모르페코(꼬르륵스위치)는 턴마다 배부른 모양과 배고픈 모양이 바뀐다.',
  964: '돌핀맨(마이티체인지)은 계단을 한 번 내려가면 그 탐험 동안 마이티폼이 된다.',
  648: '메로엣타는 옛노래를 쓸 때마다 보이스폼과 스텝폼이 바뀐다.',
  718: '지가르데는 HP가 절반 이하가 되면 그 층 동안 퍼펙트폼이 된다.',
  1024: '테라파고스는 던전에서 늘 테라스탈폼이다.',
};

// 메가진화하는 포켓몬 (원래 모습) / 그 포켓몬의 메가스톤 (리자몽·뮤츠처럼 둘이면 무작위)
const megaBases = () => [...new Set(MEGA_STONES.map(id => DATA.species[ITEMS[id].formTo].f[0]))];
const megaStoneOf = sp => { const l = MEGA_STONES.filter(id => DATA.species[ITEMS[id].formTo].f[0] === sp); return l.length ? pick(l) : null; };
