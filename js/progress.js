// 기록: 도감 수집, 누적 통계, 업적, 오늘의 도전
'use strict';

const Progress = (() => {
  const S = () => Game.save;
  function ensure() {
    const s = S();
    s.stats = s.stats || {};
    s.dex = s.dex || { seen: {}, beaten: {} };
    s.ach = s.ach || {};
    return s;
  }
  const stat = k => (S().stats && S().stats[k]) || 0;
  function add(k, n = 1) { const s = ensure(); s.stats[k] = (s.stats[k] || 0) + n; }
  function max(k, v) { const s = ensure(); s.stats[k] = Math.max(s.stats[k] || 0, v); }

  // ── 도감 수집 ──
  function seen(sp) { const s = ensure(); if (!s.dex.seen[sp]) s.dex.seen[sp] = 1; }
  function beaten(sp) { const s = ensure(); seen(sp); s.dex.beaten[sp] = (s.dex.beaten[sp] || 0) + 1; }
  // 플레이한 포켓몬도 만난 것으로 친다. 그 진화 전 모습도 (가디안을 영입했으면 랄토스·킬리아도)
  let preKey = '', preSet = new Set();
  function ownedPre() {
    const ks = Object.keys(S().roster);
    if (ks.join(',') !== preKey) { preKey = ks.join(','); preSet = new Set(ks.flatMap(k => preEvos(+k))); }
    return preSet;
  }
  const isSeen = sp => !!(ensure().dex.seen[sp] || S().roster[sp] || ownedPre().has(+sp));
  const beatCount = sp => ensure().dex.beaten[sp] || 0;
  function dexCounts() {
    const ids = SPECIES_IDS;
    let seenN = 0, beatN = 0;
    for (const id of ids) { if (isSeen(id)) seenN++; if (beatCount(id)) beatN++; }
    return { total: ids.length, seen: seenN, beaten: beatN };
  }

  // ── 업적 ──
  const normalDgs = () => DUNGEONS.filter(d => d.mode === 'normal' && !d.endless);
  const rogueBest = () => Math.max(0, ...DUNGEONS.filter(d => d.mode === 'rogue' && !d.daily && !d.endless).map(d => S().best[d.id] || 0));
  const shinyN = () => Object.values(S().shinySeen || {}).reduce((a, b) => a + b, 0);
  const maxBoost = () => Math.max(0, ...Object.values(S().roster).flatMap(r => Object.values(r.boost || {})));
  // 수집 업적 (v0.102 보강): 스타팅(세대별·전체)·전설과 환상 영입, 청정의 탑
  const STARTERS = { 1: [1, 4, 7], 2: [152, 155, 158], 3: [252, 255, 258], 4: [387, 390, 393], 5: [495, 498, 501], 6: [650, 653, 656], 7: [722, 725, 728], 8: [810, 813, 816], 9: [906, 909, 912] };
  const GEN_N = ['', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const ownsLine = base => [...evoLine(base)].some(x => S().roster[x]);   // 그 진화 계열 중 하나라도 영입
  const startersOf = g => STARTERS[g].filter(ownsLine).length;
  let legendIds = null;
  const legends = () => (legendIds = legendIds || SPECIES_IDS.map(Number).filter(id => DATA.species[id].lg && !NO_RECRUIT.includes(id)));
  const legendOwned = () => legends().filter(id => S().roster[id]).length;
  // prog: [현재, 목표] / reward: 돈·아이템(n개)·티켓
  const ACH = [
    { id: 'kill1',    icon: '⚔', n: '첫 승리',         d: '적 포켓몬을 1마리 쓰러뜨린다.', prog: () => [stat('kills'), 1], reward: { money: 100 } },
    { id: 'kill100',  icon: '⚔', n: '백전노장',        d: '적 포켓몬을 100마리 쓰러뜨린다.', prog: () => [stat('kills'), 100], reward: { money: 1000 } },
    { id: 'kill1000', icon: '⚔', n: '천하무적',        d: '적 포켓몬을 1000마리 쓰러뜨린다.', prog: () => [stat('kills'), 1000], reward: { money: 5000, item: 'candy' } },
    { id: 'floor50',  icon: '🪜', n: '계단을 오르내리며', d: '계단을 50번 내려간다.', prog: () => [stat('floors'), 50], reward: { money: 500 } },
    { id: 'floor300', icon: '🪜', n: '던전 전문가',     d: '계단을 300번 내려간다.', prog: () => [stat('floors'), 300], reward: { money: 3000, item: 'hpup' } },
    { id: 'clear1',   icon: '🏁', n: '첫 클리어',       d: '일반 던전을 처음으로 클리어한다.', prog: () => [Object.keys(S().cleared).length, 1], reward: { money: 300 } },
    { id: 'clear7',   icon: '🏁', n: '탐험가',          d: '일반 던전을 7곳 클리어한다.', prog: () => [normalDgs().filter(d => S().cleared[d.id]).length, 7], reward: { money: 3000, item: 'protein' } },
    { id: 'clearAll', icon: '👑', n: '전설의 탐험대',   d: '모든 일반 던전을 클리어한다.', prog: () => [normalDgs().filter(d => S().cleared[d.id]).length, normalDgs().length], reward: { money: 20000, item: 'carbos' } },
    { id: 'boss1',    icon: '💀', n: '보스 격파',       d: '보스를 처음으로 쓰러뜨린다.', prog: () => [stat('bosses'), 1], reward: { money: 500, item: 'abcapsule' } },
    { id: 'boss20',   icon: '💀', n: '보스 헌터',       d: '보스를 20번 쓰러뜨린다.', prog: () => [stat('bosses'), 20], reward: { money: 4000, item: 'iron' } },
    { id: 'rogue10',  icon: '🌀', n: '미궁의 초보',     d: '로그라이크 던전에서 10층에 도달한다.', prog: () => [rogueBest(), 10], reward: { money: 500 } },
    { id: 'rogue30',  icon: '🌀', n: '미궁의 달인',     d: '로그라이크 던전에서 30층에 도달한다.', prog: () => [rogueBest(), 30], reward: { money: 4000, item: 'calcium' } },
    { id: 'rogue50',  icon: '🌌', n: '불가사의의 끝',   d: '불가사의 던전 50층을 완주한다.', prog: () => [S().best.mystery || 0, 50], reward: { money: 30000, item: 'zinc' } },
    { id: 'lv20',     icon: '⭐', n: '성장',            d: '레벨 20에 도달한다.', prog: () => [stat('maxLv'), 20], reward: { money: 300 } },
    { id: 'lv50',     icon: '⭐', n: '베테랑',          d: '레벨 50에 도달한다.', prog: () => [stat('maxLv'), 50], reward: { money: 3000, item: 'hpup' } },
    { id: 'lv100',    icon: '🌟', n: '최강의 증표',     d: '레벨 100에 도달한다.', prog: () => [stat('maxLv'), 100], reward: { money: 20000 } },
    { id: 'shiny1',   icon: '✨', n: '반짝이는 만남',   d: '색이 다른 포켓몬(이로치)을 발견한다.', prog: () => [shinyN(), 1], reward: { money: 1000 } },
    { id: 'shiny10',  icon: '✨', n: '이로치 수집가',   d: '이로치를 10번 발견한다.', prog: () => [shinyN(), 10], reward: { money: 10000, item: 'luckyegg' } },
    { id: 'seen100',  icon: '📖', n: '도감 채우기',     d: '포켓몬을 100종 만난다.', prog: () => [dexCounts().seen, 100], reward: { money: 1000 } },
    { id: 'seen300',  icon: '📖', n: '포켓몬 박사',     d: '포켓몬을 300종 만난다.', prog: () => [dexCounts().seen, 300], reward: { money: 5000, item: 'protein' } },
    { id: 'seen600',  icon: '📚', n: '살아있는 도감',   d: '포켓몬을 600종 만난다.', prog: () => [dexCounts().seen, 600], reward: { money: 20000, item: 'calcium' } },
    { id: 'dexAll',   icon: '💫', n: '도감 완성',       d: '모든 포켓몬을 만난다. 빛나는부적: 그 뒤로 이로치를 만날 확률이 늘 2배 (지니지 않아도)', prog: () => [dexCounts().seen, dexCounts().total], reward: { text: '💫빛나는부적 (늘 적용)' } },
    { id: 'beat100',  icon: '🥊', n: '다양한 상대',     d: '서로 다른 포켓몬을 100종 쓰러뜨린다.', prog: () => [dexCounts().beaten, 100], reward: { money: 2000 } },
    { id: 'roster5',  icon: '👥', n: '첫 동료들',       d: '캐릭터 목록의 포켓몬이 5종류가 된다. (영입)', prog: () => [Object.keys(S().roster).length, 5], reward: { money: 500, item: 'abcapsule' } },
    { id: 'roster20', icon: '👥', n: '대가족',          d: '캐릭터 목록의 포켓몬이 20종류가 된다. (영입)', prog: () => [Object.keys(S().roster).length, 20], reward: { money: 3000, item: 'iron' } },
    { id: 'evolve1',  icon: '🔆', n: '진화!',           d: '포켓몬을 진화시킨다.', prog: () => [stat('evolves'), 1], reward: { money: 500, item: 'abcapsule' } },
    { id: 'tm5',      icon: '💿', n: '기술 연구가',     d: '기술머신을 5번 사용한다.', prog: () => [stat('tms'), 5], reward: { money: 1500 } },
    { id: 'mission10', icon: '📜', n: '믿음직한 탐험대', d: '임무를 10번 완료한다.', prog: () => [stat('missions'), 10], reward: { money: 1000 } },
    { id: 'mission50', icon: '📜', n: '마을의 영웅',    d: '임무를 50번 완료한다.', prog: () => [stat('missions'), 50], reward: { money: 5000, item: 'zinc' } },
    { id: 'rescue1',  icon: '🆘', n: '구조대',          d: '친구를 구조한다.', prog: () => [stat('rescues'), 1], reward: { money: 1000, item: 'abcapsule' } },
    { id: 'rescued1', icon: '🤝', n: '고마운 친구',     d: '친구에게 구조를 받는다.', prog: () => [stat('rescued'), 1], reward: { money: 500 } },
    { id: 'house1',   icon: '🏚', n: '함정에 빠진 줄 알았지', d: '몬스터하우스에 들어간다.', prog: () => [stat('houses'), 1], reward: { money: 500 } },
    { id: 'daily1',   icon: '🗓', n: '오늘의 도전자',   d: '오늘의 도전에 참가한다.', prog: () => [stat('dailies'), 1], reward: { money: 300 } },
    { id: 'daily10',  icon: '🗓', n: '매일의 습관',     d: '오늘의 도전에 10번 참가한다.', prog: () => [stat('dailies'), 10], reward: { money: 3000, item: 'carbos' } },
    { id: 'dailyAll', icon: '🏆', n: '오늘의 챔피언',   d: '오늘의 도전을 완주한다.', prog: () => [stat('dailyClears'), 1], reward: { money: 3000, item: 'hpup' } },
    { id: 'vitamin',  icon: '🥤', n: '튼튼하게',        d: '영양제로 한 능력치를 최대까지 강화한다.', prog: () => [maxBoost(), VITAMIN_MAX], reward: { money: 3000 } },
    { id: 'pure99',   icon: '🌲', n: '청정의 탑 정복', d: '청정의 탑 99층을 오른다.', prog: () => [Math.min(99, S().best.purity || 0), 99], reward: { tickets: 100, item: 'rainbowgummy', n: 2 } },
    ...Object.keys(STARTERS).map(g => ({ id: 'starter' + g, icon: '🌱', n: L(`${GEN_N[g]}세대 스타팅`, `Gen ${g} Starters`), d: L(`${GEN_N[g]}세대 스타팅 포켓몬 3마리(진화형도 됨)를 모두 영입한다.`, `Recruit all 3 Gen ${g} starters (evolved forms count).`), prog: () => [startersOf(g), 3], reward: { money: 5000, item: 'rainbowgummy' } })),
    { id: 'starterAll', icon: '🌳', n: '스타팅 마스터', d: '1~9세대 스타팅 포켓몬 27마리를 모두 영입한다.', prog: () => [Object.keys(STARTERS).reduce((a, g) => a + startersOf(g), 0), 27], reward: { tickets: 100, item: 'rainbowgummy', n: 3 } },
    { id: 'legend10', icon: '🐉', n: '전설과의 인연', d: '전설·환상 포켓몬을 10마리 영입한다.', prog: () => [legendOwned(), 10], reward: { tickets: 30, item: 'rainbowgummy' } },
    { id: 'legend30', icon: '🐲', n: '전설의 수집가', d: '전설·환상 포켓몬을 30마리 영입한다.', prog: () => [legendOwned(), 30], reward: { tickets: 80, item: 'rainbowgummy', n: 2 } },
    { id: 'legendAll', icon: '👑', n: '신화의 탐험대', d: '전설·환상 포켓몬을 모두 영입한다.', prog: () => [legendOwned(), legends().length], reward: { tickets: 300, item: 'rainbowgummy', n: 5 } },
    { id: 'rich',     icon: '💰', n: '부자',            d: '돈을 50000 포켓 모은다.', prog: () => [S().money, 50000], reward: { item: 'amuletcoin' } },
  ];
  if (LANG === 'en') {
    const EN = {
      kill1: ['First Victory', 'Defeat 1 enemy Pokémon.'],
      kill100: ['Battle-Hardened', 'Defeat 100 enemy Pokémon.'],
      kill1000: ['Invincible', 'Defeat 1000 enemy Pokémon.'],
      floor50: ['Up and Down the Stairs', 'Take the stairs down 50 times.'],
      floor300: ['Dungeon Expert', 'Take the stairs down 300 times.'],
      clear1: ['First Clear', 'Clear a normal dungeon for the first time.'],
      clear7: ['Explorer', 'Clear 7 normal dungeons.'],
      clearAll: ['Legendary Team', 'Clear every normal dungeon.'],
      boss1: ['Boss Down', 'Defeat a boss for the first time.'],
      boss20: ['Boss Hunter', 'Defeat bosses 20 times.'],
      rogue10: ['Labyrinth Novice', 'Reach floor 10 in a roguelike dungeon.'],
      rogue30: ['Labyrinth Master', 'Reach floor 30 in a roguelike dungeon.'],
      rogue50: ['End of the Mystery', 'Complete all 50 floors of the Mystery Dungeon.'],
      lv20: ['Growing Up', 'Reach level 20.'],
      lv50: ['Veteran', 'Reach level 50.'],
      lv100: ['Proof of Strength', 'Reach level 100.'],
      shiny1: ['A Sparkling Encounter', 'Find a shiny Pokémon.'],
      shiny10: ['Shiny Collector', 'Find shinies 10 times.'],
      seen100: ['Filling the Dex', 'Meet 100 species.'],
      seen300: ['Pokémon Professor', 'Meet 300 species.'],
      seen600: ['Living Dex', 'Meet 600 species.'],
      dexAll: ['Dex Complete', 'Meet every Pokémon. Shiny Charm: shiny odds are always doubled afterward (no need to hold it).'],
      beat100: ['Many Opponents', 'Defeat 100 different species.'],
      roster5: ['First Friends', 'Have 5 species on your character list. (Recruit)'],
      roster20: ['Big Family', 'Have 20 species on your character list. (Recruit)'],
      evolve1: ['Evolution!', 'Evolve a Pokémon.'],
      tm5: ['Move Researcher', 'Use TMs 5 times.'],
      mission10: ['Reliable Team', 'Complete 10 missions.'],
      mission50: ['Town Hero', 'Complete 50 missions.'],
      rescue1: ['Rescue Team', 'Rescue a friend.'],
      rescued1: ['Grateful Friend', 'Get rescued by a friend.'],
      house1: ['Thought It Was a Trap', 'Enter a Monster House.'],
      daily1: ['Daily Challenger', 'Join the Daily Challenge.'],
      daily10: ['Daily Habit', 'Join the Daily Challenge 10 times.'],
      dailyAll: ['Daily Champion', 'Complete the Daily Challenge.'],
      vitamin: ['Healthy and Strong', 'Max out one stat with vitamins.'],
      pure99: ['Purity Tower Conquered', 'Climb to floor 99 of Purity Tower.'],
      starterAll: ['Starter Master', 'Recruit all 27 starters from Gen 1–9.'],
      legend10: ['Bond with Legends', 'Recruit 10 Legendary/Mythical Pokémon.'],
      legend30: ['Legend Collector', 'Recruit 30 Legendary/Mythical Pokémon.'],
      legendAll: ['Mythic Team', 'Recruit every Legendary/Mythical Pokémon.'],
      rich: ['Rich', 'Save up ₽50000.'],
    };
    for (const a of ACH) if (EN[a.id]) [a.n, a.d] = EN[a.id];
    const dx = ACH.find(a => a.id === 'dexAll');
    if (dx) dx.reward.text = '💫Shiny Charm (always on)';
  }
  const rewardText = r => [r.money ? `₽${r.money}` : '', r.item ? `${ITEMS[r.item].icon}${ITEMS[r.item].n}${r.n > 1 ? ' ×' + r.n : ''}` : '', r.tickets ? L(`🎟 티켓 ${r.tickets}장`, `🎟 ${r.tickets} tickets`) : '', r.text || ''].filter(Boolean).join(' + ');

  // 새로 달성한 업적을 찾아 보상을 주고 알린다
  function check() {
    const s = ensure();
    if (!s.roster) return [];
    max('maxLv', Math.max(0, ...Object.values(s.roster).map(r => r.lv || 0)));
    const got = [];
    for (const a of ACH) {
      if (s.ach[a.id]) continue;
      const [c, g] = a.prog();
      if (c < g) continue;
      s.ach[a.id] = s.day;
      if (a.reward.money) s.money += a.reward.money;
      if (a.reward.item) s.storage[a.reward.item] = (s.storage[a.reward.item] || 0) + (a.reward.n || 1);
      if (a.reward.tickets) s.tickets = (s.tickets || 0) + a.reward.tickets;
      got.push(a);
    }
    got.forEach((a, i) => setTimeout(() => { UI.toast(L(`🏆 업적 달성: ${a.n} — ${rewardText(a.reward)}${a.reward.item ? ' (창고로)' : ''}`, `🏆 Record complete: ${a.n} — ${rewardText(a.reward)}${a.reward.item ? ' (to storage)' : ''}`)); Sound.play('achieve'); }, i * 1800));
    return got;
  }

  function renderAch() {
    const s = ensure(), done = ACH.filter(a => s.ach[a.id]).length;
    return `<h3>${L('🏆 업적', '🏆 Records')} <span class="dim">${done}/${ACH.length}</span></h3>
      <p class="dim">${L('보상 돈은 바로 받고, 아이템은 창고로 들어갑니다.', 'Money rewards arrive at once; items go to storage.')}</p>
      <div class="ach-list">${ACH.map(a => {
        const ok = !!s.ach[a.id], [c, g] = a.prog();
        return `<div class="ach ${ok ? 'ok' : ''}"><span class="ach-ico">${ok ? a.icon : '🔒'}</span><div class="grow"><b>${esc(a.n)}</b>${ok ? ` <span class="dim tiny">${L(`${s.ach[a.id]}일째 달성`, `Day ${s.ach[a.id]}`)}</span>` : ''}
          <div class="dim">${esc(a.d)}</div>${ok ? '' : `<span class="bar"><i style="width:${clamp(c / g * 100, 0, 100)}%;background:#6cf"></i></span> <span class="tiny dim">${Math.min(c, g)}/${g}</span>`}</div>
          <span class="ach-rw">${rewardText(a.reward)}</span></div>`;
      }).join('')}</div>
      <h3>${L('통계', 'Stats')}</h3><table class="stats wide">
        <tr><td>${L('쓰러뜨린 포켓몬', 'Pokémon defeated')}</td><td>${stat('kills')}</td><td>${L('내려간 계단', 'Stairs taken')}</td><td>${stat('floors')}</td></tr>
        <tr><td>${L('쓰러뜨린 보스', 'Bosses defeated')}</td><td>${stat('bosses')}</td><td>${L('완료한 임무', 'Missions completed')}</td><td>${stat('missions')}</td></tr>
        <tr><td>${L('이로치 발견', 'Shinies found')}</td><td>${shinyN()}</td><td>${L('쓰러진 횟수', 'Faints')}</td><td>${stat('faints')}</td></tr>
        <tr><td>${L('친구 구조', 'Friend rescues')}</td><td>${stat('rescues')}</td><td>${L('오늘의 도전', 'Daily Challenges')}</td><td>${L(`${stat('dailies')}회`, stat('dailies'))}</td></tr></table>`;
  }

  // ── 오늘의 도전: 날짜로 정해지는 로그라이크. 같은 날에는 누구나 같은 포켓몬, 같은 맵 ──
  const DAILY_FLOORS = 20;
  const pal = [['#2a3b2f', '#4d6b52', '#a9c7a0', '#8fb088'], ['#3b2a3a', '#6b4d68', '#c7a0c0', '#b088a8'], ['#2a333b', '#4d5f6b', '#a0b8c7', '#88a0b0'],
    ['#3b352a', '#6b604d', '#c7b9a0', '#b0a288'], ['#2f2a3b', '#554d6b', '#afa0c7', '#9888b0']];
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function seedOf(date) { let h = 2166136261; const s = 'daily:' + date; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const DAILY = { id: 'daily', n: L('오늘의 도전', 'Daily Challenge'), floors: DAILY_FLOORS, lv: [5, 38], types: null, mode: 'rogue', daily: true, wx: [], pal: pal[0] };
  DUNGEONS.push(DAILY);
  // 날짜에 맞춰 던전 내용(타입·날씨·색·주인공)을 정한다
  function setupDaily(date = today()) {
    const r = mulberry(seedOf(date));
    const pk = arr => arr[Math.floor(r() * arr.length)];
    const types = [];
    while (types.length < 3) { const t = 1 + Math.floor(r() * 18); if (!types.includes(t)) types.push(t); }
    const w = pk(['rain', 'sun', 'sand', 'snow', 'fog', null]);
    // 주인공: 진화 전 모습(다른 포켓몬에서 진화하지 않는)이면서 진화할 수 있는 포켓몬
    const evolved = new Set(Object.values(DATA.species).flatMap(s => s.v.map(v => v[0])));
    const cand = SPECIES_IDS.map(Number).filter(id => !evolved.has(id) && DATA.species[id].v.length && !DATA.species[id].lg).sort((a, b) => a - b);
    Object.assign(DAILY, { date, seed: seedOf(date), types, wx: w ? [[w, 0.4]] : [], pal: pk(pal), hero: pk(cand), n: L(`오늘의 도전 (${date.slice(5).replace('-', '/')})`, `Daily Challenge (${date.slice(5).replace('-', '/')})`) });
    return DAILY;
  }
  setupDaily();

  // 도전 중에는 층마다 날짜+층 번호로 난수를 고정한다
  const origRandom = Math.random;
  function seedFloor(run) {
    if (!run || !run.daily) { Math.random = origRandom; return; }
    Math.random = mulberry((seedOf(run.daily) ^ Math.imul(run.floor, 0x9E3779B1)) >>> 0);
  }
  function unseed() { Math.random = origRandom; }

  function dailyRecord() { const s = ensure(); return s.daily && s.daily.date === today() ? s.daily : null; }
  function dailyCard() {
    const dg = setupDaily(), rec = dailyRecord(), hero = dg.hero;
    const best = ensure().stats.dailyBest || 0;
    return `<div class="card dg rogue daily" style="--c1:${dg.pal[1]};--c2:${dg.pal[2]}">
      <div class="dg-head"><b>🗓 ${esc(dg.n)}</b> <i class="rogue">${L('매일 바뀜', 'Changes daily')}</i></div>
      <div class="daily-body">${portraitImg(hero, 'portrait sm')}<div class="grow">
        <div>${L('오늘의 주인공', "Today's hero")} <b>${esc(spName(hero))}</b> Lv${ROGUE_LEVEL}</div>
        <div class="dim">${DAILY_FLOORS}${L('층', 'F')} · ${typeBadges(dg.types)}${dg.wx.length ? ` · ${WEATHERS[dg.wx[0][0]].icon}${WEATHERS[dg.wx[0][0]].n}` : ''}</div></div></div>
      <div class="note">${L(`같은 날에는 모두 같은 포켓몬과 같은 맵으로 도전합니다. 기록은 하루 한 번, 그 뒤로는 연습할 수 있어요. 보상은 도달한 층마다 ₽${DAILY_REWARD.floor}, 완주하면 ₽${DAILY_REWARD.clear} 추가. 기록을 친구와 비교해 보세요.`, `Everyone plays the same Pokémon on the same map each day. One recorded run per day; after that you can practice. Rewards: ₽${DAILY_REWARD.floor} per floor reached, plus ₽${DAILY_REWARD.clear} for finishing. Compare records with friends.`)}</div>
      ${rec ? `<div class="note ms">${L('오늘의 기록', "Today's record")}: <b>${rec.floor}F</b>${rec.clear ? L(' 완주!', ' Cleared!') : ''} · ${rec.turns}${L('턴', ' turns')}</div>` : ''}
      ${best ? `<div class="dim tiny">${L('지금까지 최고', 'Best so far')} ${best}F</div>` : ''}
      ${rec && S().dailyPractice && S().dailyPractice.date === dg.date ? `<div class="dim tiny">${L('오늘 연습 최고', "Today's best practice")} ${S().dailyPractice.floor}F · ${S().dailyPractice.turns}${L('턴', ' turns')}</div>` : ''}
      <div class="btns">${rec ? `<button class="btn" data-act="daily-share">${L('📋 기록 공유', '📋 Share record')}</button> <button class="btn ghost" data-act="daily-practice">${L('🔁 연습하기', '🔁 Practice')}</button>`
        : `<button class="btn" data-act="daily-go">${L('도전한다', 'Start')}</button>`} <button class="btn ghost" data-act="dg-info" data-arg="daily">${L('ℹ 정보', 'ℹ Info')}</button></div></div>`;
  }
  function shareText(rec) {
    return L(`🗓 미궁 탐험대 · 오늘의 도전 ${rec.date}\n${spName(rec.sp)} · ${rec.clear ? '완주! ' : ''}${rec.floor}F / ${DAILY_FLOORS}F · ${rec.turns}턴 · Lv${rec.lv}${rec.kills != null ? ` · ${rec.kills}마리 쓰러뜨림` : ''}`, `🗓 ${GAME_TITLE} · Daily Challenge ${rec.date}\n${spName(rec.sp)} · ${rec.clear ? 'Cleared! ' : ''}${rec.floor}F / ${DAILY_FLOORS}F · ${rec.turns} turns · Lv${rec.lv}${rec.kills != null ? ` · ${rec.kills} defeated` : ''}`);
  }
  // 오늘의 도전 보상: 도달한 층마다 + 완주 (v0.81에 10배: 층마다 ₽40 → ₽400, 완주 ₽1000 → ₽10000)
  const DAILY_REWARD = { floor: 400, clear: 10000 };
  function recordDaily(r, outcome, reached) {
    const s = ensure();
    const rec = { date: r.daily, sp: r.p.sp, floor: reached, clear: outcome === 'clear', turns: r.turns || 0, lv: r.p.lv, kills: r.kills || 0 };
    if (r.daily === today()) s.daily = rec;
    add('dailies');
    if (rec.clear) add('dailyClears');
    max('dailyBest', reached);
    const reward = reached * DAILY_REWARD.floor + (rec.clear ? DAILY_REWARD.clear : 0);
    s.money += reward;
    return { rec, reward };
  }

  return { add, max, stat, seen, beaten, isSeen, beatCount, dexCounts, check, renderAch, ACH,
    today, setupDaily, seedFloor, unseed, dailyRecord, dailyCard, shareText, recordDaily, DAILY_REWARD, get DAILY() { return DAILY; } };
})();
