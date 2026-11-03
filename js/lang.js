// 언어 (v1.14): 설정 → 화면에서 고른다. 세이브가 없는 첫 화면에서도 쓰도록 세이브가 아니라 이 브라우저에 남긴다
//  - 포켓몬·기술·특성·타입·도구의 이름과 설명: js/lang_en.js (tools/build_en.py)
//  - 코드에서 만드는 문구: L('한국어', 'English')
//  - index.html에 고정된 문구: STATIC_EN (applyLangDom)
'use strict';
//  - 고른 적이 없으면: 이 브라우저에 미궁 탐험대 기록(pmd로 시작하는 키)이 있으면 한국어, 처음 온 사람은 브라우저 언어 (한국어가 아니면 영어). 정한 언어는 남겨 둔다
const LANG = (() => {
  try {
    const saved = localStorage.getItem('pmd-lang');
    if (saved === 'en' || saved === 'ko') return saved;
    const returning = Object.keys(localStorage).some(k => k.startsWith('pmd'));
    const nav = ((navigator.languages && navigator.languages[0]) || navigator.language || 'ko').toLowerCase();
    const l = returning || nav.startsWith('ko') ? 'ko' : 'en';
    localStorage.setItem('pmd-lang', l);
    return l;
  } catch (e) { return 'ko'; }
})();
try { document.documentElement.lang = LANG; } catch (e) {}
const L = (ko, en) => (LANG === 'en' && en != null ? en : ko);   // 문구 고르기: L('한국어', 'English')
const GAME_TITLE = L('미궁 탐험대', 'Labyrinth Explorers');
function setLang(l) {
  try { localStorage.setItem('pmd-lang', l === 'en' ? 'en' : 'ko'); } catch (e) {}
  location.reload();
}

// index.html에 고정된 문구 (글자 그대로 바꾼다. 앞뒤 공백은 그대로)
const STATIC_EN = {
  '미궁 탐험대': 'Labyrinth Explorers', '포켓몬 팬 게임': 'A Pokémon fan game', '시작': 'Start',
  '비상업적 팬 게임 · 스프라이트: PMD SpriteCollab (CC BY-NC 4.0)': 'Non-commercial fan game · Sprites: PMD SpriteCollab (CC BY-NC 4.0)',
  '🏠 보물마을': '🏠 Treasure Town',
  '🗺 던전': '🗺 Dungeons', '📜 임무': '📜 Missions', '🛒 상점': '🛒 Shop', '🎟 교환': '🎟 Exchange', '📦 창고': '📦 Storage', '🎒 가방': '🎒 Bag',
  '⭐ 캐릭터': '⭐ Character', '🤝 영입': '🤝 Recruits', '📖 도감': '📖 Dex', '🏆 업적': '🏆 Records', '⚙ 정보': '⚙ Info',
  '나': 'You', '적': 'Enemy', '계단': 'Stairs', '아이템': 'Item', '돈': 'Money', '의뢰품': 'Request', '함정': 'Trap',
  '가 본 곳을 누르면 이동 · 아무 키나 지도 버튼을 누르면 닫기': 'Tap an explored spot to move there · Any key or the map button closes',
  '방향 버튼': 'Direction pad', '누른 뒤 방향: 제자리에서 방향만 바꾸기': 'Then a direction: turn in place',
  '공격': 'Attack', '자동': 'Auto', '🤝 동료': '🤝 Team', '휴식': 'Rest', '대기': 'Wait', '임무': 'Mission', '지도': 'Map', '가방': 'Bag', '조사': 'Look',
  '⭐ 빠른사용': '⭐ Quick use', '메뉴': 'Menu', '⚙ 조작': '⚙ Pad',
  'O: 적이 없으면 자동 이동, 적이 보이면 자동 전투 한 턴': 'O: auto-move when no enemies, one turn of auto battle when enemies are in sight',
  'V: 동료 정보·작전': 'V: team info and tactics', 'K 또는 칸 우클릭': 'K or right-click a tile', '빠른 사용 (T)': 'Quick use (T)', '조작 패드 설정': 'Touch pad settings',
  '행동': 'Act', '조이스틱·↻·ABXY를 하나씩 끌어서 옮긴 뒤 누르세요': 'Drag the stick, ↻ and ABXY one by one, then tap', '배치 끝': 'Done',
};
function applyLangDom(root) {
  if (LANG !== 'en') return;
  document.title = GAME_TITLE;
  const w = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT);
  for (let t; (t = w.nextNode());) {
    const s = t.nodeValue.trim(), e = s && STATIC_EN[s];
    if (e) t.nodeValue = t.nodeValue.replace(s, e);
  }
  for (const el of (root || document.body).querySelectorAll('[title],[aria-label],[placeholder]'))
    for (const a of ['title', 'aria-label', 'placeholder']) { const v = el.getAttribute(a); if (v && STATIC_EN[v]) el.setAttribute(a, STATIC_EN[v]); }
}

// js/defs.js의 표에 든 이름 (번호·키는 그대로, 글만)
const DEFS_EN = {
  dungeons: {
    forest: 'Small Forest', beach: 'Beach Cave', crystal: 'Crystal Cave', plains: 'Thunder Plains', swamp: 'Toxic Fog Swamp', volcano: 'Flame Volcano',
    desert: 'Quicksand Desert', frost: 'Ice Mountain', storm: 'Stormy Sea', dark: 'Dark Forest', mine: 'Steel Mine', sky: 'Sky Tower', canyon: 'Dragon Canyon',
    summit: 'Star Summit', trial: 'Cave of Trials', twilight: 'Twilight Labyrinth', mystery: 'Mystery Dungeon', eternal: 'Endless Corridor', purity: 'Purity Tower',
    burned: 'Burned Tower', whirl: 'Whirl Islands', seafloor: 'Seafloor Cavern', ruins: 'Ancient Ruins', shrine: 'Shrine of Ruin', altar: 'Altar of the Sun and Moon',
    coronet: 'Mt. Coronet', spiral: 'Dragonspiral Tower', areazero: 'Area Zero', skyplain: 'Abundant Skyway', twofist: 'Tower of Two Fists', crown: 'Crown Tundra',
    ultra: 'Ultra Space Rift', meteor: 'Meteor Crater', zerodeep: 'Area Zero Depths', endless: 'Endless Dungeon', watercity: 'City of Water', genelab: 'Genetics Lab',
    kalos: 'Forest of Life and Ruin', hero: 'Forest of Heroes', flower: 'Flower Paradise', crescent: 'Fullmoon Island', crystaldeep: 'Crystal Cave Depths',
    factory: 'Ancient Factory', seatemple: 'Sea Temple', magma: 'Flame Mountain Depths', mega: 'Mega Evolution Tower',
  },
  themes: {
    '전설의 세 마리 개': 'Legendary Beasts', '전설의 새': 'Legendary Birds', '대지와 바다': 'Land and Sea', '레지 시리즈': 'The Regis', '재앙의 보물과 충신': 'Treasures of Ruin and Loyal Three',
    '수호신 카푸': 'Tapu Guardians', '창조의 신': 'Gods of Creation', '이상과 진실': 'Ideals and Truth', '풍요의 신': 'Forces of Nature', '무도의 길': 'Way of Martial Arts',
    '풍요의 왕': 'King of Bountiful Harvests', '물의 도시의 수호신': 'Guardians of the City of Water', '만들어진 포켓몬': 'Made Pokémon', '칼로스의 질서': 'Order of Kalos',
    '가라르의 영웅': 'Heroes of Galar', '숨은 던전': 'Hidden Dungeon', '메가진화': 'Mega Evolution',
  },
  weathers: {
    sun: ['Sunny', 'Fire moves ×1.5, Water moves ×0.5. No freezing. Solar Beam fires without charging.'],
    rain: ['Rain', 'Water moves ×1.5, Fire moves ×0.5.'],
    sand: ['Sandstorm', 'Non-Rock/Ground/Steel types take 1/16 of max HP every 8 turns. Rock types get Sp. Def ×1.5.'],
    snow: ['Snow', 'Ice types get Defense ×1.5. Non-Ice types get hungry 1.5× faster from the cold.'],
    fog: ['Fog', 'All moves have accuracy ×0.9. Vision in corridors shrinks by 1 tile.'],
    hsun: ['Extremely Harsh Sunlight', 'Sunny effects, and Water-type attacks evaporate and fail. Does not change until the Pokémon that caused it faints.'],
    hrain: ['Heavy Rain', 'Rain effects, and Fire-type attacks fizzle out and fail. Does not change until the Pokémon that caused it faints.'],
    wind: ['Strong Winds', 'Flying types take only normal damage from their weaknesses (Electric, Ice, Rock). Does not change until the Pokémon that caused it faints.'],
    hsand: ['Fierce Sandstorm', 'Sandstorm effects, and non-Rock/Ground/Steel types get hungry 1.5× faster.'],
    hail: ['Hail', 'Snow effects, and non-Ice types take 1/16 of max HP every 8 turns.'],
    hfog: ['Thick Fog', 'All moves have accuracy ×0.8. Vision in corridors shrinks by 1 tile.'],
  },
  terrains: {
    grassy: ['Grassy Terrain', 'Grounded Pokémon recover 1/16 of max HP every 8 turns and Grass moves ×1.3. Half damage from Earthquake, Bulldoze and Magnitude.'],
    misty: ['Misty Terrain', 'Grounded Pokémon cannot get status conditions or confusion, and take half damage from Dragon moves.'],
    electric: ['Electric Terrain', 'Grounded Pokémon cannot fall asleep, and Electric moves ×1.3.'],
    psychic: ['Psychic Terrain', 'Grounded Pokémon are not hit by priority moves (Quick Attack etc.), and Psychic moves ×1.3.'],
  },
  rules: {
    hp: ['Tough Foes', 'Enemy HP ×1.5'], stat: ['Fierce Foes', 'Enemy Attack, Defense, Sp. Atk and Sp. Def ×1.2'], many: ['Crowded Floors', 'Enemies ×1.5 and they respawn faster'],
    house: ['Monster House', 'Every floor has a Monster House'], heal: ['Barren Land', 'Your team recovers half as much HP'],
    storm: ['Rough Weather', 'Each floor has a Fierce Sandstorm (hunger ×1.5), Hail (damage every 8 turns) or Thick Fog (accuracy ×0.8)'],
    trap: ['Trap Zone', 'Twice the traps, and they always trigger (80% if found). Poison/paralysis +10 turns, explosions 30%, hunger 30'],
    gummy: ['Gummi Harvest', '2 extra Gummis on every floor (a good rule)'],
  },
  traps: {
    psn: ['Poison Trap', 'Poisons you.'], slp: ['Sleep Trap', 'Puts you to sleep.'], par: ['Paralysis Trap', 'Paralyzes you.'], warp: ['Warp Trap', 'Sends you somewhere on the floor.'],
    blast: ['Blast Trap', 'Everyone within 1 tile takes 20% of max HP.'], hunger: ['Hunger Trap', 'Lowers the belly by 20.'],
    summon: ['Summon Trap', 'Enemies appear around you. (Works once)'], reset: ['Stat Reset Trap', 'All raised or lowered stat stages return to normal.'],
  },
  ranks: ['Normal', 'Bronze', 'Silver', 'Gold', 'Diamond', 'Super', 'Ultra', 'Hyper', 'Master'],
  keys: {
    up: 'Move up', down: 'Move down', left: 'Move left', right: 'Move right', upleft: 'Move up-left', upright: 'Move up-right', downleft: 'Move down-left', downright: 'Move down-right',
    turn: 'Turn only (hold, then a direction)', attack: 'Attack', skill1: 'Move 1', skill2: 'Move 2', skill3: 'Move 3', skill4: 'Move 4', auto: 'Auto (move / one battle turn)',
    fight: 'One turn of auto battle', rest: 'Rest', wait: 'Wait', stairs: 'Stairs', bag: 'Bag', party: 'Team', quick: 'Quick use', map: 'Map', look: 'Look',
    missions: 'Missions', status: 'Team status', log: 'Message log', dginfo: 'Dungeon info', help: 'Help', menu: 'Menu',
  },
  stat: { 2: 'Attack', 3: 'Defense', 4: 'Sp. Atk', 5: 'Sp. Def', 6: 'Speed', 7: 'Accuracy', 8: 'Evasion' },
  statShort: { 2: 'Atk', 3: 'Def', 4: 'SpA', 5: 'SpD', 6: 'Spe', 7: 'Acc', 8: 'Eva' },
  status: { psn: 'Poison', brn: 'Burn', par: 'Paralysis', slp: 'Sleep', frz: 'Freeze', cnf: 'Confusion' },
  tiers: { 1: 'Common', 2: 'Uncommon', 3: 'Rare', 4: 'Unique', 5: 'Legendary' },
  dropStages: ['Early', 'Middle', 'Late', 'Final'],
  pokeClasses: { legend: 'All Legendary/Mythical', ultra: 'Box Legendary', sub: 'Sub-Legendary', myth: 'Mythical', ub: 'Ultra Beast', paradox: 'Paradox', plain: 'Regular Pokémon' },
  liquids: { 2: 'Water', 3: 'Lava' },
};
function applyLangDefs() {
  const E = DEFS_EN;
  for (const d of DUNGEONS) { if (E.dungeons[d.id]) d.n = E.dungeons[d.id]; if (d.theme && E.themes[d.theme]) d.theme = E.themes[d.theme]; }
  for (const [k, [n, d]] of Object.entries(E.weathers)) if (WEATHERS[k]) Object.assign(WEATHERS[k], { n, d });
  for (const [k, [n, d]] of Object.entries(E.terrains)) if (TERRAINS[k]) Object.assign(TERRAINS[k], { n, d });
  for (const [k, [n, d]] of Object.entries(E.rules)) if (ENDLESS_RULES[k]) Object.assign(ENDLESS_RULES[k], { n, d });
  for (const [k, [n, d]] of Object.entries(E.traps)) if (TRAPS[k]) Object.assign(TRAPS[k], { n, d });
  RANKS.forEach((r, i) => { if (E.ranks[i]) r[0] = E.ranks[i]; });
  for (const a of KEY_ACTIONS) if (E.keys[a[0]]) a[1] = E.keys[a[0]];
  Object.assign(STAT_NAMES, E.stat); Object.assign(STAT_SHORT, E.statShort); Object.assign(STATUS_NAMES, E.status); Object.assign(TIER_NAMES, E.tiers);
  DROP_STAGE_NAMES.splice(0, E.dropStages.length, ...E.dropStages);
  for (const c of POKE_CLASSES) if (E.pokeClasses[c[0]]) c[1] = E.pokeClasses[c[0]];
  for (const [k, n] of Object.entries(E.liquids)) if (LIQUIDS[k]) LIQUIDS[k].n = n;
}

// 모든 데이터 파일을 읽은 뒤 (main.js 바로 앞) 이름과 설명을 영어로 바꾼다
function applyLangData() {
  if (LANG !== 'en') return;
  applyLangDefs();
  if (typeof LANG_EN === 'undefined') return;
  const E = LANG_EN, ko2en = {};
  for (const s of Object.values(DATA.species)) if (s.e) ko2en[s.n] = s.e;
  const sp = n => ko2en[n] || n;
  const KT = DATA.types.slice(), ty = s => s.split('·').map(t => (KT.includes(t) ? E.types[KT.indexOf(t)] : t)).join('/');
  // 전용 도구 설명의 문장 조각 (36가지). 못 바꾼 조각은 한국어 그대로
  const STAT = { '공격': 'Attack', '특수공격': 'Sp. Atk', '방어': 'Defense', '특수방어': 'Sp. Def', '스피드': 'Speed', '회피율': 'Evasion', '자연 회복': 'Natural HP recovery' };
  const SIG_PHRASES = [
    [/^(.+) 기술의 위력이 ([\d.]+)배$/, (m) => (m[1] === '자기 타입' ? `Own-type move power ×${m[2]}` : `${ty(m[1])} move power ×${m[2]}`)],
    [/^기술의 위력이 ([\d.]+)배$/, m => `Move power ×${m[1]}`],
    [/^(공격|특수공격|방어|특수방어|스피드|회피율|자연 회복)(?:이|가) ([\d.]+)배$/, m => `${STAT[m[1]]} ×${m[2]}`],
    [/^(공격)과 (특수공격|방어|스피드)(?:이|가) ([\d.]+)배$/, m => `${STAT[m[1]]} and ${STAT[m[2]]} ×${m[3]}`],
    [/^급소율이 (\d+)단계 오(?:른다|르고)$/, m => `Critical-hit ratio +${m[1]}`],
    [/^가방에 있어도 효과가 있다$/, () => 'Works even from the bag'],
    [/^진화형이나 모습마다 그 포켓몬의 타입 기술을 올린다$/, () => 'Each evolution or form boosts its own type'],
    [/^상태이상이 절반의 시간에 낫는다$/, () => 'Status conditions wear off in half the time'],
    [/^행동 후 (\d+)% 확률로 한 턴 더 행동한다$/, m => `${m[1]}% chance to act again after acting`],
    [/^배가 고파지는 속도가 절반 \(리더일 때\)$/, () => 'Belly empties at half speed (as leader)'],
    [/^줍는 돈이 ([\d.]+)배 \(리더일 때\)$/, m => `Money picked up ×${m[1]} (as leader)`],
    [/^오리진폼이 되고$/, () => 'Becomes Origin Forme'],
    [/^검왕의 모습이 된다$/, () => 'Becomes Crowned Sword'],
    [/^방패왕의 모습이 된다$/, () => 'Becomes Crowned Shield'],
    [/^(우물|화덕|주춧돌)의가면 모습\((.+)\)이 되고$/, m => `Becomes ${{ '우물': 'Wellspring', '화덕': 'Hearthflame', '주춧돌': 'Cornerstone' }[m[1]]} Mask (${ty(m[2])})`],
    [/^원시회귀해서 (.+?)(?:이|가) 된다$/, m => `Primal Reverts into ${sp(m[1])}`],
    [/^울트라버스트해서 (.+?)(?:이|가) 된다$/, m => `Ultra Bursts into ${sp(m[1])}`],
    [/^스텔라폼이 되고$/, () => 'Becomes Stellar Form'],
    [/^등장할 때 날씨와 필드를 모두 없앤다 \(제로포밍\)$/, () => 'clears all weather and terrain on entry (Teraform Zero)'],
    [/^날씨와 상관없이 포지폼이 되고 플라워기프트도 쾌청일 때처럼 발동한다 \(체리꼬만\)$/, () => 'Always in Sunshine Form, and Flower Gift works as in harsh sunlight (Cherrim only)'],
    [/^날씨와 상관없이 (태양|빗방울|설운)의 모습\((.+) 타입\)이 되고$/, m => `Always in ${{ '태양': 'Sunny', '빗방울': 'Rainy', '설운': 'Snowy' }[m[1]]} Form (${ty(m[2])} type)`],
  ];
  const sigPhrase = s => { s = s.trim(); for (const [re, f] of SIG_PHRASES) { const m = s.match(re); if (m) return f(m); } return s; };
  const sigMemo = new Map();
  const sigDesc = s => {
    if (!s) return s;
    if (sigMemo.has(s)) return sigMemo.get(s);
    const up = s.match(/\s*(\[\+\d+:.*\])$/), body = up ? s.slice(0, up.index) : s;
    const m = body.match(/^\[전용\] (.+?)에게 지니게 하면 (.+?)\. 다른 포켓몬에게는 효과가 없다\.\s*(.*)$/);
    let out = s;
    if (m) {
      const tail = m[3].split(/\.\s*/).filter(Boolean).map(sigPhrase).join('. ');
      out = `[Signature] When held by ${m[1].split('·').map(sp).join(' / ')}: ${m[2].split(/, |\. /).map(sigPhrase).join(', ')}. No effect on other Pokémon.${tail ? ' ' + tail + '.' : ''}${up ? ' ' + up[1] : ''}`;
    }
    sigMemo.set(s, out); return out;
  };
  DATA.types.splice(0, E.types.length, ...E.types);
  for (const s of Object.values(DATA.species)) if (s.e) s.n = s.e;
  for (const [id, m] of Object.entries(DATA.moves)) { const e = E.moves[id]; if (e) { m.n = e[0]; if (e[1]) m.d = e[1]; } }
  for (const [id, a] of Object.entries(DATA.abilities)) { const e = E.abilities[id]; if (e) { a.n = e[0]; if (e[1]) a.d = e[1]; } }
  const CLS = ['', 'status', 'physical', 'special'];
  for (const [id, it] of Object.entries(ITEMS)) {
    const e = E.items[id], h = typeof HELD_ITEMS !== 'undefined' && HELD_ITEMS[id];
    let n = e && e[0], d = e && e[1];
    if (it.tm && DATA.moves[it.mv]) {   // 기술머신001 메가톤펀치 → TM001 Mega Punch
      const mv = DATA.moves[it.mv], no = (it.n.match(/\d+/) || [''])[0];
      n = `TM${no} ${mv.n}`; d = `Teaches the ${DATA.types[mv.t - 1]}-type ${CLS[mv.c]} move ${mv.n}. Single use.`;
    } else if (it.mega) {   // [메가스톤] 리자몽에게 지니게 하면 던전에서 메가리자몽X로 메가진화한다
      const m = (it.d || '').match(/\[메가스톤\] (.+?)에게 지니게 하면 던전에서 (.+?)(?:으로|로) 메가진화한다/);
      if (m) d = `[Mega Stone] When held by ${sp(m[1])}, it Mega Evolves into ${sp(m[2])} in dungeons. No effect on other Pokémon.`;
    } else if (it.sig) {   // 전용 도구: 이름은 '피카츄의 증표' → 'Pikachu Emblem', 설명은 문장 조각마다 (SIG_PHRASES)
      if (!n) { const m = it.n.match(/^(.+)의 증표$/); if (m) n = `${sp(m[1])} Emblem`; }
      // 설명은 강화 단계를 붙이는 getter (js/defs.js)라 그 결과를 바꾼다. 강화 단계 [+n: …]는 아직 한국어
      for (const o of [it, h]) {
        const g = o && Object.getOwnPropertyDescriptor(o, 'd');
        if (g && g.get) Object.defineProperty(o, 'd', { get: () => sigDesc(g.get.call(o)), enumerable: true, configurable: true });
        else if (o) o.d = sigDesc(o.d);
      }
      d = null;
    }
    for (const o of [it, h]) if (o) { o.nKo = o.nKo || o.n; if (n) o.n = n; if (d) o.d = d; }
  }
}
