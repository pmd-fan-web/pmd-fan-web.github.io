// 특성: 효과 정의 (원작 효과를 그대로, 또는 던전에 맞게 재해석)
// dungeon: 원작과 다르게 바꾼 경우의 설명. 없으면 원작 설명 그대로 동작.
'use strict';

const ABIL = {};
function ab_(ids, o) { for (const id of [].concat(ids)) ABIL[id] = { ...(ABIL[id] || {}), ...o }; }
// 타입 ID: 1노말 2격투 3비행 4독 5땅 6바위 7벌레 8고스트 9강철 10불꽃 11물 12풀 13전기 14에스퍼 15얼음 16드래곤 17악 18페어리

// ── 공격 강화 ──
ab_(65, { pinch: 12 }); ab_(66, { pinch: 10 }); ab_(67, { pinch: 11 }); ab_(68, { pinch: 7 });
ab_(91, { adapt: true });
ab_([168, 236], { protean: true, dungeon: '모든 기술이 자속 보정(1.5배)을 받는다.' });
ab_(101, { technician: true });
ab_(89, { flagMul: [8, 1.2] }); ab_(173, { flagMul: [16, 1.5] }); ab_(178, { flagMul: [17, 1.5] });
ab_(181, { flagMul: [1, 1.3] });
ab_(292, { slicing: 1.5 });
ab_(244, { flagMul: [9, 1.3], flagResist: [9, 0.5] });
ab_(125, { sheer: true });
ab_(120, { reckless: true });
ab_(110, { tinted: true });
ab_([37, 74], { atkMul: 2 });
ab_(55, { atkMul: 1.5, hustle: true });
ab_(62, { guts: true });
ab_(63, { marvel: true });
ab_(137, { toxicBoost: true }); ab_(138, { flareBoost: true });
ab_(97, { sniper: true }); ab_(105, { critStage: 1 });
ab_(14, { accMul: 1.3 });
ab_(99, { noGuard: true });
ab_(96, { normalize: true }); ab_(174, { skin: 15 }); ab_(182, { skin: 18 }); ab_(184, { skin: 3 });   // 노말스킨: 모든 기술이 노말 (원작처럼), 스카이스킨: 노말 → 비행
// ── 원본 특성 데이터에 없는 특성 (스카이스킨, 레전드 Z-A의 새 메가진화 특성): 여기서 더하고 그 메가진화에 붙인다 (PokeAPI 기준) ──
// 전에는 데이터가 없어서 원래 포켓몬의 첫 특성을 대신 썼다 (예: 메가루카리오Z가 불굴의마음)
const NEW_ABILITIES = {
  184: { n: '스카이스킨', d: '노말타입의 기술이 비행타입이 된다. 위력이 조금 올라간다.', fi: ['pinsir-mega', 'salamence-mega'] },
  309: { n: '드래곤스킨', d: '노말타입의 기술이 드래곤타입이 된다. 위력이 조금 올라간다.', fi: ['feraligatr-mega'] },
  310: { n: '메가솔라', d: '날씨가 쾌청이 아니어도 쾌청일 때처럼 기술을 쓸 수 있다.', fi: ['meganium-mega'] },
  311: { n: '하바네로분출', d: '공격 기술로 데미지를 받으면 공격한 상대를 화상 상태로 만든다.', fi: ['scovillain-mega'] },
  313: { n: '불꽃의갈기', d: '불꽃타입 기술의 위력이 올라간다.', fi: ['pyroar-mega'] },
  314: { n: '파동의방호', d: '접촉하는 기술로 받는 데미지가 절반이 된다.', fi: ['lucario-mega-z'] },
  266: { n: '혼연일체', d: '버드렉스의 긴장감과 블리자포스의 백의울음 두 가지 특성을 겸비한다.', fi: ['calyrex-ice'] },
  267: { n: '혼연일체', d: '버드렉스의 긴장감과 레이스포스의 흑의울음 두 가지 특성을 겸비한다.', fi: ['calyrex-shadow'] },
};
for (const [id, a] of Object.entries(NEW_ABILITIES)) {
  if (!DATA.abilities[id]) DATA.abilities[id] = { n: a.n, d: a.d };
  for (const s of Object.values(DATA.species)) if (a.fi.includes(s.fi)) s.ab = [[+id, 0]];
}
ab_(309, { skin: 16 });   // 드래곤스킨: 노말 → 드래곤, 1.2배
ab_(310, { megaSol: true, dungeon: '자기 기술은 늘 쾌청일 때처럼 쓴다: 불꽃 기술 1.5배·물 기술 0.5배, 솔라빔을 모으지 않고 쏘고, 아침햇살·광합성 회복량이 늘어난다.' });   // 메가솔라
ab_(311, { spicySpray: true, dungeon: '공격 기술로 데미지를 받으면 공격한 상대가 화상에 걸린다.' });   // 하바네로분출
ab_(313, { typeMul: { 10: 1.5 } });   // 불꽃의갈기
ab_(314, { contactResist: 0.5 });   // 파동의방호
ab_(266, { unnerve: true, onKO: 'atk', dungeon: '긴장감(적이 기술을 쓰는 확률 절반) + 적을 쓰러뜨리면 공격이 1단계 오른다.' });   // 혼연일체 (백마)
ab_(267, { unnerve: true, onKO: 'spa', dungeon: '긴장감(적이 기술을 쓰는 확률 절반) + 적을 쓰러뜨리면 특수공격이 1단계 오른다.' });   // 혼연일체 (흑마)
ab_(186, { typeMul: { 17: 1.33 } }); ab_(187, { typeMul: { 18: 1.33 } });
ab_(200, { typeMul: { 9: 1.5 } }); ab_(262, { typeMul: { 13: 1.3 } }); ab_(263, { typeMul: { 16: 1.5 } });
ab_(79, { rival: true, dungeon: '자신과 같은 타입을 가진 적에게 위력이 1.25배.' });
ab_(148, { analytic: true, dungeon: '지난 행동 이후 공격을 받았다면 위력이 1.3배.' });
ab_(198, { stakeout: true, dungeon: '그 적에게 하는 첫 공격의 위력이 2배.' });
ab_(113, { scrappy: true, noIntimidate: true });
ab_([104, 163, 164], { moldBreaker: true });
ab_(151, { infiltrate: true, dungeon: '상대의 방어·특수방어 상승을 무시하고 공격한다.' });
ab_(92, { skillLink: true });
ab_(32, { serene: true });
ab_(1, { stench: true });
ab_(143, { poisonTouch: true });
ab_([302, 307], { poisonTouch: true, dungeon: '공격이 맞으면 30% 확률로 상대를 독 상태로 만든다.' });
// 날씨·필드가 없으므로 해당 타입 강화로 바꿈
ab_(70, { typeMul: { 10: 1.3 }, dungeon: '날씨가 없어서 대신 불꽃 기술의 위력이 1.3배.' });
ab_(2, { typeMul: { 11: 1.3 }, dungeon: '날씨가 없어서 대신 물 기술의 위력이 1.3배.' });
ab_([45, 245], { typeMul: { 6: 1.3 }, dungeon: '날씨가 없어서 대신 바위 기술의 위력이 1.3배.' });
ab_(117, { typeMul: { 15: 1.3 }, dungeon: '날씨가 없어서 대신 얼음 기술의 위력이 1.3배.' });
ab_(159, { typeMul: { 5: 1.2, 6: 1.2, 9: 1.2 }, dungeon: '모래바람이 없어도 땅·바위·강철 기술의 위력이 1.2배.' });
ab_(226, { typeMul: { 13: 1.3 }, dungeon: '필드 대신 전기 기술의 위력이 1.3배.' });
ab_(227, { typeMul: { 14: 1.3 }, dungeon: '필드 대신 에스퍼 기술의 위력이 1.3배.' });
ab_(228, { resist: { 16: 0.5 }, dungeon: '필드 대신 드래곤 기술에 받는 데미지가 절반.' });
ab_(229, { typeMul: { 12: 1.3 }, dungeon: '필드 대신 풀 기술의 위력이 1.3배.' });
ab_(94, { spaMul: 1.3, dungeon: '날씨가 없어서 HP 감소 없이 특수공격이 1.3배.' });
ab_([57, 58], { spaMul: 1.2, dungeon: '동료가 없으므로 항상 특수공격이 1.2배.' });
ab_(282, { bestStatMul: 1.3, dungeon: '가장 높은 능력(공격·방어·특공·특방)이 항상 1.3배. (던전에는 일렉트릭필드가 없어서 늘 발동)' });
ab_(281, { bestStatMul: 1.1, wx: { w: 'sun', bestStatMul: 1.3 }, dungeon: '쾌청이면 가장 높은 능력(공격·방어·특공·특방)이 1.3배. (평소 1.1배)' });   // 고대활성: 날씨가 생겨서 원작대로 쾌청일 때만
ab_(288, { atkMul: 1.33, dungeon: '공격이 1.33배.' });
ab_(287, { spaMul: 1.25, dungeon: '특수공격이 1.25배. (주변 적의 특수방어를 낮추는 효과를 재해석)' });
ab_(293, { atkMul: 1.1, dungeon: '공격이 1.1배.' });
ab_([277, 280], { typeMul: { 13: 1.3 }, dungeon: '전기 기술의 위력이 1.3배.' });
ab_(269, { typeMul: { 12: 1.2 }, dungeon: '풀 기술의 위력이 1.2배.' });
ab_(42, { vsTypeMul: { 9: 1.2 }, dungeon: '강철 타입 적에게 주는 데미지가 1.2배.' });

// ── 방어 ──
ab_(47, { resist: { 10: 0.5, 15: 0.5 } });
ab_(85, { resist: { 10: 0.5 } });
ab_(199, { resist: { 10: 0.5 }, typeMul: { 11: 2 }, noStatus: ['brn'] });
ab_(87, { absorb: { t: 11, heal: 25 }, resist: { 10: 1.25 } });
ab_([111, 116, 232], { seMul: 0.75 });
ab_([136, 231], { fullHpHalf: true });
ab_(218, { contactResist: 0.5, resist: { 10: 2 } });
ab_(246, { specialResist: 0.5 });
ab_(169, { physResist: 0.5 });
ab_(272, { resist: { 8: 0.5 }, noStatus: ['psn', 'brn', 'par', 'slp', 'frz'] });
ab_(25, { wonderGuard: true });
ab_(5, { sturdy: true, dungeon: 'HP가 가득 찬 상태에서는 한 번에 쓰러지지 않는다. (함정·반동 포함, 여러 번 맞는 연속기는 버티지 못한다)' });
ab_([4, 75], { noCrit: true });
ab_(43, { immuneFlag: 9 }); ab_(171, { immuneFlag: 18 }); ab_(142, { immuneFlag: 15, trapImmune: ['psn', 'blast'], dungeon: '가루 기술과 독가시·폭발 함정이 통하지 않는다.' });
ab_(6, { trapImmune: ['blast'], blastImmune: true, dungeon: '폭발 함정과 폭발씨의 데미지를 받지 않는다.' });
ab_(26, { levitate: true, dungeon: '땅 타입 기술을 받지 않고, 함정을 밟지 않는다.' });
ab_(21, { trapImmune: ['warp'], dungeon: '워프 함정에 걸리지 않는다.' });
ab_(140, { areaResist: 0.5, dungeon: '적의 주변 공격(범위 기술)에 받는 데미지가 절반.' });
ab_(132, { dmgTaken: 0.9, dungeon: '동료가 없으므로 자신이 받는 데미지가 0.9배.' });
ab_([214, 219, 296], { dmgTaken: 0.9, dungeon: '선제기가 없으므로 받는 데미지가 0.9배.' });
ab_(46, { foeAcc: 0.9, dungeon: '위압감으로 적의 명중률이 0.9배.' });
ab_(147, { miracle: true });
ab_([156, 283], { magicBounce: true, dungeon: '적의 변화 기술(상태이상·능력 하락)을 받지 않는다.' });
// 흡수 / 무효
ab_(10, { absorb: { t: 13, heal: 25 } }); ab_(11, { absorb: { t: 11, heal: 25 } });
ab_(297, { absorb: { t: 5, heal: 25 } });
ab_(31, { absorb: { t: 13, st: 4, ch: 1 } }); ab_(114, { absorb: { t: 11, st: 4, ch: 1 } });
ab_(78, { absorb: { t: 13, st: 2, ch: 1 }, dungeon: '전기 기술을 받지 않고 공격이 오른다. (스피드 대신)' });
ab_(157, { absorb: { t: 12, st: 2, ch: 1 } });
ab_(18, { absorb: { t: 10, flash: true } });
ab_(273, { absorb: { t: 10, st: 3, ch: 2 } });

// ── 상태이상 / 능력 보호 ──
ab_([15, 72, 175], { noStatus: ['slp'] });
ab_(175, { veil: ['slp'], dungeon: '자신과 같은 편 모두(같은 층) 잠듦 상태가 되지 않는다.' });   // 스위트베일: 같은 편 전체 (v0.90)
ab_(17, { noStatus: ['psn'] }); ab_(7, { noStatus: ['par'] }); ab_(41, { noStatus: ['brn'] }); ab_(40, { noStatus: ['frz'] });
ab_(270, { noStatus: ['brn'], onHitBy: { t: 10, st: 2, ch: 1 } });
ab_([20, 165], { noStatus: ['cnf'], noIntimidate: true });
ab_(165, { veil: ['cnf'], dungeon: '자신과 같은 편 모두(같은 층) 혼란 상태가 되지 않는다. 자신은 위협도 받지 않는다.' });   // 아로마베일: 같은 편 전체 (v0.90)
ab_(12, { noStatus: ['cnf'], noIntimidate: true, dungeon: '혼란에 걸리지 않고 위협도 통하지 않는다.' });
ab_(39, { noFlinch: true, noIntimidate: true });
ab_(102, { statusResist: 0.5, dungeon: '날씨가 없어서 대신 상태이상에 걸릴 확률이 절반.' });
ab_([29, 73, 230], { noDrop: 'all' }); ab_(166, { noDrop: 'all', dungeon: '능력이 떨어지지 않는다.' });
ab_(52, { noDrop: [2] }); ab_(145, { noDrop: [3] }); ab_(51, { noDrop: [7], keenEye: true, dungeon: '명중률이 떨어지지 않고, 옆 칸의 함정을 반드시 발견한다.' });
ab_(19, { shieldDust: true });
ab_(28, { synchronize: true });
ab_(48, { earlyBird: true });
ab_(30, { naturalCure: true, dungeon: '교체가 없으므로 대신 상태이상이 절반의 시간만에 낫는다.' });
ab_(61, { cureChance: 0.3 }); ab_(93, { cureChance: 0.2, dungeon: '비가 없어도 턴마다 20% 확률로 상태이상이 낫는다.' });
abSet(131, { healer: 0.3, dungeon: '턴마다 옆 칸에 있는 같은 편(자신 제외)의 상태이상을 30% 확률로 고쳐 준다.' });
ab_(90, { poisonHeal: true });
ab_(98, { magicGuard: true, dungeon: '공격 외의 데미지(독·화상·반동·함정·배고픔)를 받지 않는다.' });
ab_(69, { rockHead: true });

// ── 능력 변화 ──
ab_(86, { simple: true }); ab_(126, { contrary: true }); ab_(109, { unaware: true });
ab_(128, { defiant: 2 }); ab_(172, { defiant: 4 });
ab_(83, { angerPoint: true });
ab_(153, { onKO: 'atk' }); ab_([224, 220], { onKO: 'best' });
// 원작 설명이 데이터에 없는 9세대 특성: 원작 효과를 짧게 적어 둔다
const ABILITY_DESC_FILL = {
  268: '접촉 공격을 한 상대의 특성을 가시지않는향기로 바꾼다.',
  269: '공격을 받으면 발밑을 그래스필드로 만든다.',
  270: '불꽃 기술을 맞으면 공격이 올라간다. 화상을 입지 않는다.',
  272: '상태이상이 되지 않는다. 고스트 기술로 받는 데미지가 절반이 된다.',
  273: '불꽃 기술을 맞으면 데미지를 받지 않고 방어가 크게 올라간다.',
  274: '바람 기술을 맞으면 데미지를 받지 않고 공격이 올라간다.',
  277: '바람 기술을 맞으면 몸에 전기를 모은다 (다음 전기 기술의 위력이 올라간다).',
  278: '교체되어 물러나면 마이티폼으로 바뀐다.',
  279: '동료 드닐레이브의 입속에 들어가 안에서 지시를 내린다.',
  280: '데미지를 받으면 몸에 전기를 모은다 (다음 전기 기술의 위력이 올라간다).',
  281: '쾌청이거나 부스터에너지를 지니고 있으면 가장 높은 능력이 올라간다.',
  282: '일렉트릭필드이거나 부스터에너지를 지니고 있으면 가장 높은 능력이 올라간다.',
  283: '황금처럼 단단한 몸이라 상대의 변화 기술을 받지 않는다.',
  287: '재앙을 부르는 구슬의 힘으로 자신 이외 모든 포켓몬의 특수방어를 낮춘다.',
  288: '등장했을 때 날씨를 쾌청으로 만든다. 쾌청이면 공격이 올라간다.',
  290: '상대의 능력이 올라가면 자신도 편승해서 똑같이 올린다.',
  291: '먹은 열매를 다음 턴에 한 번 더 되새김질해서 먹는다.',
  292: '베는 기술의 위력이 올라간다.',
  293: '쓰러진 동료가 많을수록 공격과 특수공격이 조금씩 올라간다.',
  295: '물리 공격을 받으면 상대 주변에 독압정을 뿌린다.',
  296: '꼬리의 갑옷 덕분에 상대의 선제 기술을 받지 않는다.',
  297: '땅 타입 기술을 맞으면 데미지를 받지 않고 HP를 회복한다.',
  298: '변화 기술을 늦게 쓰는 대신 상대의 특성에 방해받지 않는다.',
  300: '등장했을 때 달콤한 꿀 향기로 상대의 회피율을 떨어뜨린다.',
  301: '등장했을 때 동료를 대접해서 HP를 회복시킨다.',
  302: '공격하면 상대를 맹독 상태로 만들 때가 있다.',
  304: '등장했을 때 테라스탈폼으로 바뀐다.',
  305: 'HP가 가득 차 있으면 어떤 기술을 맞아도 효과가 별로다.',
  307: '독 상태로 만든 상대를 혼란에 빠뜨린다.',
  308: '접촉 기술이 방어 기술을 뚫고 맞는다. (이때는 데미지가 줄어든다)',
};
for (const [id, d] of Object.entries(ABILITY_DESC_FILL)) if (DATA.abilities[id] && !DATA.abilities[id].d) DATA.abilities[id].d = d;

// 모습이 바뀌는 특성: 능력 효과는 없고, 조건이 맞으면 던전에서 모습이 바뀐다 (js/forms.js의 BATTLE_FORMS)
const FORM_ABILITY_TEXT = {
  197: 'HP가 절반 이하가 되면 코어의 모습이 된다 (방어·특수방어가 낮아지고 공격·특수공격·스피드가 오른다).',
  161: 'HP가 절반 이하가 되면 달마모드가 된다.',
  176: '공격 기술을 쓰면 블레이드폼, 변화 기술을 쓰면 실드폼이 된다. 층마다 실드폼으로 돌아온다.',
  208: 'Lv20 이상이고 HP가 1/4보다 많으면 군집의 모습이 된다.',
  248: '물리 공격을 한 번 막아 내고 나이스페이스가 된다. 설경인 층에 들어서면 다시 아이스페이스가 된다.',
  258: '턴마다 배부른 모양과 배고픈 모양이 번갈아 바뀐다.',
  278: '계단을 한 번 내려간 뒤로는 마이티폼이 된다.',
  304: '던전에서는 늘 테라스탈폼이 된다.',
};
for (const [id, t] of Object.entries(FORM_ABILITY_TEXT)) ab_(+id, { formAbility: true, dungeon: '🔄 던전에서 모습이 바뀐다: ' + t });
// 천정부지 (메가저리더프, 데이터에는 영어 이름 Eelevate만 있음): 부유 + 쓰러뜨리면 능력 상승
if (DATA.abilities[312]) DATA.abilities[312] = { n: '천정부지', d: '땅에서 떠 있어 땅 타입 기술을 받지 않는다. 기술로 상대를 쓰러뜨리면 가장 높은 능력이 올라간다.' };
ab_(312, { levitate: true, onKO: 'best', dungeon: '땅 타입 기술을 받지 않고 함정을 밟지 않는다. 적을 쓰러뜨리면 공격·특수공격 중 높은 쪽이 1단계 오른다.' });
ab_(22, { intimidate: 2, dungeon: '처음 마주친 적의 공격을 1단계 낮춘다. (탐험대에 여럿 있어도 한 번만, 적의 위협은 탐험대 모두에게)' });
ab_(300, { intimidate: 8, dungeon: '처음 마주친 적의 회피율을 1단계 낮춘다. (탐험대에 여럿 있어도 한 번만, 적의 위압감은 탐험대 모두에게)' });
ab_(155, { onHitBy: { types: [7, 8, 17], st: 2, ch: 1 }, dungeon: '벌레·고스트·악 기술에 맞으면 공격이 오른다. (스피드 대신)' });
ab_(154, { onHitBy: { types: [17], st: 2, ch: 1 } });
ab_(192, { onHitBy: { st: 3, ch: 1 } });
ab_(133, { onHitBy: { phys: true, st: 3, ch: -1, st2: 2, ch2: 1 }, dungeon: '물리 공격에 맞으면 방어가 떨어지고 공격이 오른다. (스피드 대신)' });
ab_(80, { steadfast: true, dungeon: '풀죽으면 공격이 오른다. (스피드 대신)' });
ab_(141, { moody: true, dungeon: '10턴마다 무작위 능력 하나가 크게 오르고 다른 하나가 떨어진다.' });
ab_(88, { download: true, dungeon: '층에 들어설 때마다 공격 또는 특수공격이 오른다.' });
ab_(234, { floorStart: [2, 1], dungeon: '층에 들어설 때마다 공격이 오른다.' });
ab_(235, { floorStart: [3, 1], dungeon: '층에 들어설 때마다 방어가 오른다.' });
ab_(77, { tangled: true });
ab_(3, { speedy: 0.15, dungeon: '스피드가 없으므로 대신 행동 후 15% 확률로 적이 움직이지 못한다 (한 턴 더 행동).' });
ab_([33, 34, 146, 202, 84, 239], { speedy: 0.1, dungeon: '날씨·스피드 대신 행동 후 10% 확률로 적이 움직이지 못한다 (한 턴 더 행동).' });
ab_(95, { quickFeet: true, dungeon: '상태이상일 때 회피율이 1.3배. (스피드 대신)' });
ab_(50, { runAway: true, dungeon: 'HP가 1/4 이하이면 회피율이 1.5배.' });
ab_([8, 81], { evasion: 1.1, dungeon: '날씨가 없어도 회피율이 1.1배.' });

// ── 접촉 반격 ──
ab_(9, { contact: { ail: 'par', c: 30 } }); ab_(38, { contact: { ail: 'psn', c: 30 } }); ab_(49, { contact: { ail: 'brn', c: 30 } });
ab_(27, { contact: { ail: 'spore', c: 30 } });
ab_(56, { contact: { ail: 'cnf', c: 30 }, dungeon: '접촉한 적을 30% 확률로 혼란에 빠뜨린다. (헤롱헤롱 대신)' });
ab_([24, 160], { contact: { dmg: 8 } });
ab_([183, 221], { contact: { st: 2, ch: -1 }, dungeon: '접촉한 적의 공격을 낮춘다. (스피드 대신)' });
ab_(130, { contact: { flinch: 30 }, dungeon: '접촉한 적을 30% 확률로 풀죽게 한다.' });
ab_(238, { contact: { st: 7, ch: -1 }, dungeon: '접촉한 적의 명중률을 낮춘다.' });
ab_(295, { contact: { ail: 'psn', c: 30 }, dungeon: '접촉한 적을 30% 확률로 독 상태로 만든다.' });
ab_(124, { contact: { item: 10 }, dungeon: '접촉 공격을 받으면 10% 확률로 아이템을 줍는다.' });
ab_(170, { magician: true, dungeon: '접촉 공격이 맞으면 10% 확률로 아이템을 얻는다.' });
ab_(106, { aftermath: true });
ab_(64, { liquidOoze: true });

// ── 약점이 있는 특성 ──
ab_(54, { truant: 0.25, dungeon: '행동할 때 25% 확률로 게으름을 피운다. (원작은 한 턴 걸러 행동)' });
ab_(112, { slowStart: true, dungeon: '층에 들어선 뒤 10턴 동안 공격이 절반.' });
ab_(129, { defeatist: true });

// ── 회복 / 탐험 ──
ab_(144, { regen: 2, dungeon: '교체 대신 자연 회복 속도가 2배.' });
ab_([44, 115], { regen: 1.5, dungeon: '날씨 대신 자연 회복 속도가 1.5배.' });
ab_(53, { pickup: 0.3, dungeon: '층에 들어설 때 30% 확률로 아이템을 주워 온다.' });
ab_(237, { pickup: 0.3, dungeon: '층에 들어설 때 30% 확률로 아이템을 주워 온다.' });
ab_(118, { honey: true, dungeon: '층에 들어설 때 20% 확률로 사과를 발견한다.' });
ab_([139, 291], { harvest: true, dungeon: '열매를 먹었을 때 50% 확률로 열매가 남는다.' });
ab_(167, { cheekPouch: true, dungeon: '열매로 회복하는 양이 1.5배.' });
ab_(82, { gluttony: true, dungeon: '음식으로 채우는 배고픔이 1.5배.' });
ab_(60, { stickyHold: true, dungeon: '쓰러졌을 때 잃는 아이템이 1/4로 줄어든다.' });
ab_(119, { frisk: true, dungeon: '층의 아이템 위치가 미니맵에 표시된다.' });
ab_(107, { anticipation: true, dungeon: '주변 2칸 안의 함정을 발견하기 쉽다.' });
ab_(108, { forewarn: true, dungeon: '층의 모든 적 위치가 미니맵에 표시된다.' });
ab_(35, { illuminate: true, dungeon: '통로에서의 시야가 1칸 넓어진다.' });
ab_(127, { unnerve: true, dungeon: '적이 기술을 쓰는 확률이 절반으로 줄어든다.' });

// ── 효과가 없던 특성 (v0.46): 원작 느낌을 살려 던전에 맞게 ──
ab_(209, { disguise: true, dungeon: '층마다 처음 받는 공격 하나를 탈이 대신 맞는다 (최대 HP의 1/8만 잃는다).' });   // 탈
ab_(201, { berserk: true, dungeon: 'HP가 절반 아래로 떨어지면 특수공격이 1단계 오른다 (층마다 한 번).' });   // 발끈
ab_(123, { badDreams: true, dungeon: '주변 4칸 안의 잠든 적은 턴마다 최대 HP의 1/8 데미지를 입는다.' });   // 나이트메어
ab_(121, { protean: true, dungeon: '모든 기술이 자속 보정(1.5배)을 받는다. (타입을 바꾸는 힘을 재해석)' });   // 멀티타입
ab_(225, { protean: true, dungeon: '모든 기술이 자속 보정(1.5배)을 받는다. (메모리로 타입을 바꾸는 힘을 재해석)' });   // AR시스템
abSet(189, { setWeather: 'hrain', dungeon: '층에 들어서거나(플레이어) 처음 마주치면(적) 날씨를 강한 비로 바꾼다. 물 기술 1.5배, 불꽃 타입 공격 기술은 꺼져서 실패한다. 이 포켓몬이 쓰러지기 전에는 다른 날씨로 바뀌지 않는다.' });   // 시작의바다
abSet(190, { setWeather: 'hsun', dungeon: '층에 들어서거나(플레이어) 처음 마주치면(적) 날씨를 아주 강한 햇살로 바꾼다. 불꽃 기술 1.5배, 물 타입 공격 기술은 증발해서 실패한다. 이 포켓몬이 쓰러지기 전에는 다른 날씨로 바뀌지 않는다.' });   // 끝의대지
abSet(191, { setWeather: 'wind', dungeon: '층에 들어서거나(플레이어) 처음 마주치면(적) 날씨를 난기류로 바꾼다. 비행 타입이 약점(전기·얼음·바위)에 보통 데미지만 받고, 쾌청·비 효과는 사라진다. 이 포켓몬이 쓰러지기 전에는 다른 날씨로 바뀌지 않는다.' });   // 델타스트림
ab_(185, { atkMul: 1.25, spaMul: 1.25, dungeon: '새끼와 함께 공격해서 주는 데미지가 1.25배.' });   // 부자유친
ab_(308, { infiltrate: true, moldBreaker: true, dungeon: '상대의 방어 상승과 방어 특성을 무시하고 공격한다.' });   // 관통드릴
ab_(260, { infiltrate: true, dungeon: '상대의 방어·특수방어 상승을 무시하고 공격한다.' });   // 보이지않는주먹
ab_(188, { vsTypeMul: { 17: 1.2, 18: 1.2 }, dungeon: '오라를 뒤집는 힘으로 악·페어리 타입 적에게 주는 데미지가 1.2배.' });   // 오라브레이크
ab_(211, { dmgTaken: 0.85, dungeon: '세포가 모여 단단해져 받는 데미지가 0.85배.' });   // 스웜체인지
ab_(162, { accMul: 1.2, dungeon: '승리를 부르는 힘으로 명중률이 1.2배.' });   // 승리의별
ab_(264, { onKO: 'atk', dungeon: '적을 쓰러뜨리면 공격이 1단계 오른다.' });   // 백의울음
ab_(265, { onKO: 'best', dungeon: '적을 쓰러뜨리면 공격·특수공격 중 높은 쪽이 1단계 오른다.' });   // 흑의울음
ab_(206, { skin: 13, dungeon: '노말 기술이 전기 타입이 되고 위력이 오른다.' });   // 일렉트릭스킨
ab_(152, { contact: { flinch: 30 }, dungeon: '접촉한 적은 30% 확률로 저주에 걸려 풀죽는다.' });   // 미라
ab_(254, { contact: { st: 2, ch: -1 }, dungeon: '접촉한 적의 공격을 낮춘다.' });   // 떠도는영혼
ab_(268, { contact: { ail: 'cnf', c: 30 }, dungeon: '접촉한 적을 30% 확률로 지독한 향기로 혼란에 빠뜨린다.' });   // 가시지않는향기
ab_(223, { poisonTouch: true, dungeon: '공격이 맞으면 30% 확률로 상대를 독 상태로 만든다.' });   // 과학의힘
ab_(251, { infiltrate: true, dungeon: '상대의 방어·특수방어 상승을 무시하고 공격한다.' });   // 배리어프리
ab_(257, { noStatus: ['psn'], dungeon: '독 상태가 되지 않는다.' });   // 파스텔베일
ab_(255, { pinch: 15, dungeon: 'HP가 1/3 이하이면 얼음 기술의 위력이 1.5배.' });   // 무아지경
ab_(259, { speedy: 0.15, dungeon: '재빠르게 뽑아 들어 행동 후 15% 확률로 한 턴 더 행동한다.' });   // 퀵드로
ab_(100, { dmgTaken: 0.9, dungeon: '느긋하게 버텨서 받는 데미지가 0.9배.' });   // 시간벌기
ab_(122, { atkMul: 1.2, dungeon: '꽃을 피워서 공격이 1.2배.' });   // 플라워기프트
abSet(150, { imposter: true, dungeon: '층에서 처음 마주친 상대로 변신한다 (모습·타입·능력치·능력 변화·특성·기술. HP를 뺀 능력치는 1.1배, 기술 PP는 10). HP는 그대로이고 다음 층에 가면 원래대로 돌아온다. 적이면 리더로 변신한다.' });   // 괴짜
ab_([193, 194], { runAway: true, dungeon: 'HP가 1/4 이하이면 회피율이 1.5배.' });   // 도망태세·위기회피
ab_(205, { regen: 1.5, dungeon: '치유의 힘으로 자연 회복 속도가 1.5배.' });   // 힐링시프트
ab_(207, { speedy: 0.1, dungeon: '파도를 타듯 행동 후 10% 확률로 한 턴 더 행동한다.' });   // 서핑테일
ab_(213, { noStatus: ['psn', 'brn', 'par', 'slp', 'frz'], dungeon: '늘 잠든 듯한 상태라 상태이상이 되지 않는다.' });   // 절대안깸
ab_(215, { aftermath: true, dungeon: '쓰러지면 마지막으로 공격한 상대에게 데미지를 준다.' });   // 내용물분출
ab_(216, { speedy: 0.1, dungeon: '춤추듯 행동 후 10% 확률로 한 턴 더 행동한다.' });   // 무희
ab_(217, { spaMul: 1.2, dungeon: '전기를 공급해서 특수공격이 1.2배.' });   // 배터리
ab_(222, { onKO: 'atk', dungeon: '적을 쓰러뜨리면 기세를 이어받아 공격이 1단계 오른다.' });   // 리시버
ab_(240, { noDrop: 'all', dungeon: '능력이 떨어지지 않는다.' });   // 미러아머
ab_(241, { contact: { dmg: 8 }, dungeon: '접촉한 적은 최대 HP의 1/8 데미지를 입는다.' });   // 그대로꿀꺽미사일
ab_(249, { atkMul: 1.1, spaMul: 1.1, dungeon: '공격과 특수공격이 1.1배.' });   // 파워스폿
ab_(252, { typeMul: { 9: 1.5 }, dungeon: '강철 기술의 위력이 1.5배.' });   // 강철정신
ab_(253, { contact: { dmg: 8 }, dungeon: '접촉한 적은 최대 HP의 1/8 데미지를 입는다.' });   // 멸망의바디
ab_(261, { cureChance: 0.3, dungeon: '턴마다 30% 확률로 상태이상이 낫는다.' });   // 기묘한약
ab_(279, { atkMul: 1.1, spaMul: 1.1, dungeon: '지휘 능력으로 공격과 특수공격이 1.1배.' });   // 사령탑
ab_(290, { floorStart: [[2, 1], [4, 1]], dungeon: '층에 들어설 때마다 공격과 특수공격이 오른다.' });   // 편승 (v0.95: 불요의검과 같던 효과를 공격·특수공격으로)
ab_(305, { fullHpHalf: true, dungeon: 'HP가 가득 차 있으면 받는 데미지가 절반.' });   // 테라셸

// ── 추가 재해석 ──
ab_(158, { prankster: true, dungeon: '선제 개념이 없으므로 대신 변화 기술이 반드시 명중한다.' });
ab_(298, { prankster: true, dungeon: '변화 기술이 반드시 명중한다.' });
ab_(103, { klutz: true, dungeon: '도구를 다루는 게 서툴러서 오히려 던지는 아이템의 데미지가 1.5배.' });
ab_([13, 76, 256], { moldBreaker: true, dungeon: '날씨가 없으므로 대신 공격할 때 상대의 특성을 무시한다.' });
ab_(134, { defMul: 1.3, dungeon: '무거운 몸으로 방어가 1.3배.' });
ab_(135, { evasion: 1.2, dungeon: '가벼운 몸으로 회피율이 1.2배.' });
ab_([23, 71], { ignoreEvasion: true, dungeon: '적을 놓치지 않는다. 상대의 회피율 상승을 무시한다.' });
ab_(36, { floorRandom: true, dungeon: '층에 들어설 때마다 무작위 능력 하나가 오른다.' });
ab_(212, { corrosion: true, dungeon: '독·강철 타입도 독 상태로 만들 수 있다.' });
ab_(177, { typeMul: { 3: 1.2 }, dungeon: '선제 개념이 없으므로 대신 비행 기술의 위력이 1.2배.' });
ab_(274, { typeMul: { 3: 1.2 }, dungeon: '바람 기술 구분이 없으므로 비행 기술의 위력이 1.2배.' });
ab_(242, { typeMul: { 9: 1.5 }, dungeon: '강철 기술의 위력이 1.5배.' });
ab_(203, { noContact: true, dungeon: '접촉 공격을 해도 상대의 접촉 특성(정전기 등)이 발동하지 않는다.' });
ab_(204, { soundType: 11, flagMul: [9, 1.2], dungeon: '소리 기술이 물 타입이 되고, 위력이 1.2배.' });
ab_([247, 301], { cheekPouch: true, dungeon: '열매로 회복하는 양이 1.5배.' });
ab_(149, { evasion: 1.15, dungeon: '모습을 속여서 회피율이 1.15배.' });
ab_(179, { defMul: 1.3, dungeon: '필드 대신 항상 방어가 1.3배.' });
ab_(195, { onHitBy: { t: 11, st: 3, ch: 2 } });
ab_(196, { merciless: true });
ab_(16, { colorChange: true });
ab_(180, { dmgTaken: 0.95, dungeon: '동료가 없으므로 받는 데미지가 0.95배.' });

// ── 날씨·스피드가 생긴 뒤의 재조정 (기존 정의를 덮어씀) ──
function abSet(ids, o) { for (const id of [].concat(ids)) ABIL[id] = o; }
abSet(3, { speedBoost: true, dungeon: '5턴마다 스피드가 1단계 오른다.' });
abSet(33, { speedy: 0.05, wx: { w: 'rain', speedMul: 2, speedy: 0.2 }, dungeon: '비가 오면 스피드가 2배가 되고 행동 후 20% 확률로 한 턴 더 행동한다. (평소 5%)' });
abSet(34, { speedy: 0.05, wx: { w: 'sun', speedMul: 2, speedy: 0.2 }, dungeon: '쾌청이면 스피드가 2배가 되고 행동 후 20% 확률로 한 턴 더 행동한다. (평소 5%)' });
abSet(146, { speedy: 0.05, chipImmune: true, wx: { w: 'sand', speedMul: 2, speedy: 0.2 }, dungeon: '모래바람이면 스피드가 2배가 되고 행동 후 20% 확률로 한 턴 더 행동한다. 모래바람 데미지를 받지 않는다. (평소 5%)' });
abSet(202, { speedy: 0.05, wx: { w: 'snow', speedMul: 2, speedy: 0.2 }, dungeon: '설경이면 스피드가 2배가 되고 행동 후 20% 확률로 한 턴 더 행동한다. (평소 5%)' });
abSet(84, { speedMul: 1.3, dungeon: '가진 도구 개념이 없으므로 항상 스피드가 1.3배.' });
abSet(239, { speedMul: 1.1, dungeon: '스피드가 1.1배.' });
abSet(8, { evasion: 1.05, chipImmune: true, wx: { w: 'sand', evasion: 1.25 }, dungeon: '모래바람이면 회피율 1.25배 (평소 1.05배). 모래바람 데미지를 받지 않는다.' });
abSet(81, { evasion: 1.05, wx: { w: 'snow', evasion: 1.25 }, dungeon: '설경이면 회피율 1.25배 (평소 1.05배).' });
abSet(94, { spaMul: 1.1, wx: { w: 'sun', spaMul: 1.5 }, dungeon: '쾌청이면 특수공격 1.5배 (HP 감소 없음). 평소에도 1.1배.' });
abSet(44, { regen: 1.2, wx: { w: 'rain', regen: 2.5 }, dungeon: '비가 오면 자연 회복 2.5배 (평소 1.2배).' });
abSet(115, { regen: 1.2, wx: { w: 'snow', regen: 2.5 }, dungeon: '설경이면 자연 회복 2.5배 (평소 1.2배).' });
abSet(93, { cureChance: 0.1, wx: { w: 'rain', cureChance: 0.6 }, dungeon: '비가 오면 턴마다 60% 확률로 상태이상이 낫는다. (평소 10%)' });
abSet(102, { statusResist: 0.25, wx: { w: 'sun', statusResist: 1 }, dungeon: '쾌청이면 상태이상에 걸리지 않는다. (평소 25% 확률로 막음)' });
ABIL[87] = { ...ABIL[87], wx: { w: 'rain', regen: 2 }, dungeon: '물 기술을 흡수해 회복하고, 비가 오면 자연 회복 2배. 불꽃 기술에 약하다.' };
abSet(70, { setWeather: 'sun', dungeon: '층에 들어서거나(플레이어) 처음 마주치면(적) 날씨를 쾌청으로 바꾼다.' });
abSet(2, { setWeather: 'rain', dungeon: '층에 들어서거나(플레이어) 처음 마주치면(적) 날씨를 비로 바꾼다.' });
abSet([45, 245], { setWeather: 'sand', dungeon: '층에 들어서거나(플레이어) 처음 마주치면(적) 날씨를 모래바람으로 바꾼다.' });
abSet(117, { setWeather: 'snow', dungeon: '층에 들어서거나(플레이어) 처음 마주치면(적) 날씨를 설경으로 바꾼다.' });
abSet([13, 76], { cloudNine: true, dungeon: '플레이어가 이 특성이면 날씨 효과가 모두 사라진다. (적일 때는 효과 없음)' });
abSet(59, { forecast: true, dungeon: '날씨에 따라 타입이 바뀐다 (쾌청 불꽃, 비 물, 설경 얼음).' });
abSet(78, { absorb: { t: 13, st: 6, ch: 1 } });
abSet(155, { onHitBy: { types: [7, 8, 17], st: 6, ch: 1 } });
abSet(133, { onHitBy: { phys: true, st: 3, ch: -1, st2: 6, ch2: 2 } });
abSet(80, { steadfast: true });
abSet(95, { quickFeet: true });
ABIL[159] = { ...ABIL[159], chipImmune: true, dungeon: '땅·바위·강철 기술의 위력이 1.2배. 모래바람 데미지를 받지 않는다.' };
ABIL[142] = { ...ABIL[142], chipImmune: true, dungeon: '가루 기술, 독가시·폭발 함정, 모래바람 데미지를 받지 않는다.' };

// 날씨에 따라 달라지는 특성 값
function abVal(c, key) {
  const A = abilityOf(c), W = A.wx && weatherNow() === A.wx.w ? A.wx : null;
  return W && W[key] != null ? W[key] : A[key];
}

function abilityOf(c) { return (c && ABIL[c.ability]) || {}; }
// 틀깨기: 공격할 때 상대 특성 무시
function defAbility(att, def) { return abilityOf(att).moldBreaker ? {} : abilityOf(def); }
function abilityName(id) { return DATA.abilities[id]?.n || '?'; }

// 특성 정의에서 정확한 효과(수치)를 글로 만든다 (던전 규칙 설명이 따로 없는 특성용)
const AB_FLAG_N = { 1: '접촉', 8: '펀치', 9: '소리', 15: '가루', 16: '물기', 17: '파동', 18: '탄환·폭탄' };
function abilityExact(r) {
  if (!r) return '';
  const T = t => typeName(t), S = st => STAT_NAMES[st], x = v => `${+v.toFixed(2)}배`, pct = v => `${Math.round(v * 100)}%`;
  const types = o => Object.entries(o).map(([t, m]) => `${T(+t)} ${x(m)}`).join(', ');
  const stage = (st, ch) => `${S(st)} ${Math.abs(ch)}단계 ${ch > 0 ? '상승' : '하락'}`;
  const o = [];
  if (r.pinch) o.push(`HP가 1/3 이하이면 ${T(r.pinch)} 기술의 위력 1.5배`);
  if (r.adapt) o.push('자속 보정이 1.5배 → 2배');
  if (r.technician) o.push('위력 60 이하인 기술의 위력 1.5배');
  if (r.flagMul) o.push(`${AB_FLAG_N[r.flagMul[0]] || '특정'} 기술의 위력 ${x(r.flagMul[1])}`);
  if (r.slicing) o.push(`베는 기술(리프블레이드·시저크로스·깜짝베기·에어슬래시·사이코커터 등)의 위력 ${x(r.slicing)}`);
  if (r.sheer) o.push('추가 효과가 있는 기술의 위력 1.3배 (대신 추가 효과가 발동하지 않음)');
  if (r.reckless) o.push('반동이 있는 기술의 위력 1.2배');
  if (r.tinted) o.push('효과가 별로인 기술의 데미지 2배');
  if (r.atkMul) o.push(`공격 ${x(r.atkMul)}`);
  if (r.hustle) o.push('물리 기술의 명중률 0.8배');
  if (r.guts) o.push('상태이상일 때 공격 1.5배 (화상으로 공격이 줄지 않음)');
  if (r.marvel) o.push('상태이상일 때 방어 1.5배');
  if (r.toxicBoost) o.push('독 상태일 때 공격 1.5배');
  if (r.flareBoost) o.push('화상 상태일 때 특수공격 1.5배');
  if (r.sniper) o.push('급소 데미지 1.5배 → 2.25배');
  if (r.critStage) o.push(`급소율 ${r.critStage}단계 상승 (1/16 → 1/8)`);
  if (r.accMul) o.push(`명중률 ${x(r.accMul)}`);
  if (r.noGuard) o.push('자신과 상대의 기술이 반드시 명중');
  if (r.skin) o.push(`노말 기술이 ${T(r.skin)} 타입이 되고 위력 1.2배`);
  if (r.normalize) o.push('모든 기술이 노말 타입이 되고 위력 1.2배');
  if (r.typeMul) o.push(`기술 위력: ${types(r.typeMul)}`);
  if (r.scrappy) o.push('노말·격투 기술이 고스트 타입에게 반감(0.5배) 없이 보통(1배)으로 맞음');
  if (r.moldBreaker) o.push('공격할 때 상대의 특성을 무시');
  if (r.skillLink) o.push('연속 기술이 항상 최대 횟수로 맞음');
  if (r.serene) o.push('기술의 추가 효과 확률 2배');
  if (r.stench) o.push('공격이 맞으면 10% 확률로 상대가 풀죽음');
  if (r.poisonTouch) o.push('공격이 맞으면 30% 확률로 상대가 독 상태');
  if (r.resist) o.push(`받는 데미지: ${types(r.resist)}`);
  if (r.absorb) {
    const a = r.absorb;
    o.push(`${T(a.t)} 기술을 받지 않고 ${a.heal ? `최대 HP의 ${a.heal}% 회복` : a.flash ? '이후 불꽃 기술의 위력 1.5배' : stage(a.st, a.ch)}`);
  }
  if (r.seMul) o.push(`효과가 굉장한 기술에 받는 데미지 ${x(r.seMul)}`);
  if (r.fullHpHalf) o.push('HP가 가득 차 있으면 받는 데미지 절반');
  if (r.contactResist) o.push(`접촉 기술에 받는 데미지 ${x(r.contactResist)}`);
  if (r.specialResist) o.push(`특수 기술에 받는 데미지 ${x(r.specialResist)}`);
  if (r.physResist) o.push(`물리 기술에 받는 데미지 ${x(r.physResist)}`);
  if (r.flagResist) o.push(`${AB_FLAG_N[r.flagResist[0]] || '특정'} 기술에 받는 데미지 ${x(r.flagResist[1])}`);
  if (r.wonderGuard) o.push(`효과가 굉장한 기술에만 맞음 (그냥 공격은 ${WONDER_GUARD_BASIC * 100}% 확률로 맞음)`);
  if (r.noCrit) o.push('급소에 맞지 않음');
  if (r.immuneFlag) o.push(`${AB_FLAG_N[r.immuneFlag] || '특정'} 기술을 받지 않음`);
  if (r.dmgTaken) o.push(`받는 데미지 ${x(r.dmgTaken)}`);
  if (r.foeAcc) o.push(`적의 명중률 ${x(r.foeAcc)}`);
  if (r.miracle) o.push('적의 변화 기술 명중률 0.5배');
  if (r.noStatus) o.push(`${r.noStatus.map(k => STATUS_NAMES[k]).join('·')} 상태가 되지 않음`);
  if (r.onHitBy) {
    const h = r.onHitBy;
    const when = h.types ? `${h.types.map(T).join('·')} 기술에 맞으면` : h.t ? `${T(h.t)} 기술에 맞으면` : h.phys ? '물리 기술에 맞으면' : '공격에 맞으면';
    o.push(`${when} ${stage(h.st, h.ch)}${h.st2 ? `, ${stage(h.st2, h.ch2)}` : ''}`);
  }
  if (r.noFlinch) o.push('풀죽지 않음');
  if (r.noIntimidate) o.push('위협이 통하지 않음');
  if (r.statusResist) o.push(`${pct(r.statusResist)} 확률로 상태이상을 막음`);
  if (r.noDrop) o.push(r.noDrop === 'all' ? '상대가 능력을 떨어뜨리지 못함' : `상대가 ${jo(r.noDrop.map(S).join('·'), '을')} 떨어뜨리지 못함`);
  if (r.keenEye) o.push('옆 칸의 함정을 반드시 발견');
  if (r.shieldDust) o.push('상대 기술의 추가 효과를 받지 않음');
  if (r.synchronize) o.push('자신을 독·화상·마비로 만든 상대도 같은 상태로 만듦');
  if (r.earlyBird) o.push('잠듦이 절반의 시간에 풀림');
  if (r.cureChance) o.push(`턴마다 ${pct(r.cureChance)} 확률로 상태이상이 나음`);
  if (r.poisonHeal) o.push('독 상태면 데미지 대신 2턴마다 최대 HP의 1/12 회복');
  if (r.rockHead) o.push('반동 데미지를 받지 않음');
  if (r.simple) o.push('능력 변화가 2배');
  if (r.contrary) o.push('능력 변화가 반대로 적용');
  if (r.unaware) o.push('상대의 능력 변화를 무시');
  if (r.defiant) o.push(`상대가 능력을 떨어뜨리면 ${S(r.defiant)} 2단계 상승`);
  if (r.angerPoint) o.push('급소에 맞으면 공격이 최대(6단계)로 상승');
  if (r.onKO) o.push(`적을 쓰러뜨리면 ${r.onKO === 'best' ? '공격·특수공격 중 높은 쪽' : r.onKO === 'spa' ? '특수공격' : '공격'} 1단계 상승`);
  if (r.contact) {
    const c = r.contact, ail = c.ail === 'spore' ? '독·마비·잠듦 중 하나' : c.ail ? STATUS_NAMES[c.ail] + ' 상태' : '';
    if (c.ail) o.push(`접촉한 적을 ${c.c}% 확률로 ${ail}로 만듦`);
    if (c.dmg) o.push(`접촉한 적에게 그 적의 최대 HP 1/${c.dmg} 데미지`);
    if (c.st) o.push(`접촉한 적의 ${stage(c.st, c.ch)}`);
    if (c.flinch) o.push(`접촉한 적을 ${c.flinch}% 확률로 풀죽게 함`);
  }
  if (r.aftermath) o.push('자신을 쓰러뜨린 적에게 그 적의 최대 HP 1/4 데미지');
  if (r.liquidOoze) o.push('HP를 흡수하는 기술을 쓴 상대가 회복 대신 데미지를 입음');
  if (r.defeatist) o.push('HP가 절반 이하면 공격·특수공격 절반');
  if (r.tangled) o.push('혼란 상태일 때 회피율 1.5배');
  if (r.merciless) o.push('독 상태인 상대에게는 반드시 급소');
  if (r.colorChange) o.push('맞은 기술의 타입으로 자신의 타입이 바뀜');
  if (r.spaMul) o.push(`특수공격 ${x(r.spaMul)}`);
  if (r.defMul) o.push(`방어 ${x(r.defMul)}`);
  if (r.evasion) o.push(`회피율 ${x(r.evasion)}`);
  if (r.regen) o.push(`자연 회복 속도 ${x(r.regen)}`);
  if (r.chipImmune) o.push('모래바람 데미지를 받지 않음');
  if (r.steadfast) o.push('풀죽으면 스피드 1단계 상승');
  if (r.quickFeet) o.push('상태이상일 때 스피드 1.5배 (마비여도 스피드가 줄지 않음)');
  if (r.speedMul) o.push(`스피드 ${x(r.speedMul)}`);
  return o.join(' / ');
}
function abilityDesc(id) {
  const a = DATA.abilities[id], r = ABIL[id];
  const dungeon = r ? r.dungeon || '' : '';
  return { n: a?.n || '?', d: a?.d || '', dungeon, exact: dungeon ? '' : abilityExact(r), none: !r };
}
function abilityHtml(id, hidden) {
  const x = abilityDesc(id);
  return `<div class="ab-box"><b>${esc(x.n)}</b>${hidden ? ' <span class="dim">(숨겨진 특성)</span>' : ''}
    <div class="dim">${esc(x.d)}</div>
    ${x.dungeon ? `<div class="md-rule">⚑ 던전 규칙: ${esc(x.dungeon)}</div>` : ''}
    ${x.exact ? `<div class="md-rule">📊 정확한 효과: ${esc(x.exact)}</div>` : ''}
    ${x.none ? '<div class="md-rule">⚑ 던전에서는 효과가 없다.</div>' : ''}</div>`;
}
function showAbilityInfo(id, hidden) { UI.alert('특성 정보', abilityHtml(id, hidden)); }
// 적이 가질 특성 (숨겨진 특성 제외)
// 적의 특성: 보통은 일반 특성 중 하나, HIDDEN_ABILITY_CHANCE 확률로 숨겨진 특성 (있으면)
const HIDDEN_ABILITY_CHANCE = 0.1;
// 포켓몬별로 다르게: 마기라스는 반대로 숨겨진 특성(긴장감)이 90% (모래날림이 층마다 모래바람을 일으켜 거슬린다는 의견, v0.89)
const HIDDEN_ABILITY_CHANCE_SP = { 248: 0.9 };
function randomAbility(sp) {
  const hidden = DATA.species[sp].ab.filter(a => a[1]);
  if (hidden.length && Math.random() < (HIDDEN_ABILITY_CHANCE_SP[sp] ?? HIDDEN_ABILITY_CHANCE)) return pick(hidden)[0];
  const list = DATA.species[sp].ab.filter(a => !a[1]);
  return (list.length ? pick(list) : DATA.species[sp].ab[0] || [0])[0];
}
function defaultAbility(sp) { return (DATA.species[sp].ab[0] || [0])[0]; }
