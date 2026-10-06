// 이야기 대화 장면 (v0.91): 원작처럼 초상화 + 이름 + 대사를 한 줄씩. 탭·클릭·Enter로 넘기고, 건너뛰기(Esc)로 끝낸다
// 대사 한 줄: [말하는 포켓몬, 표정, 대사]
//   말하는 포켓몬: 도감 번호 / 'L' (리더: 지금 캐릭터) / null (해설: 초상화 없이)
//   표정: EMOTIONS의 이름 (Normal, Happy, Joyous, Surprised, Worried, Sad, Angry, Determined, Pain, Dizzy, Crying). 그 포켓몬에 없으면 Normal
//   대사 안의 {리더}는 리더 이름, {리더|은}처럼 쓰면 조사까지 맞춘다. {값}은 play(…, { vars: { 값: … } })로 넘긴 것
'use strict';

const Story = (() => {
  const TYPE_MS = 22;   // 한 글자가 나오는 시간
  const leaderSp = () => Game.save && Game.save.current;
  // 조사: 받침에 맞춰 (와·가·를·는·로처럼 받침 없는 쪽으로 써도 된다). 이라/라도
  const JO = { 은: '은', 는: '은', 이: '이', 가: '이', 을: '을', 를: '을', 과: '과', 와: '과', 으로: '으로', 로: '으로' };
  function particle(w, p) {
    if (p === '이라' || p === '라') { const c = w.charCodeAt(w.length - 1); return w + (c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '이라' : '라'); }
    return JO[p] ? jo(w, JO[p]) : w + p;
  }
  function fill(text, vars) {
    return text.replace(/\{([^}|]+)(?:\|([^}]+))?\}/g, (all, k, p) => {
      const v = k === '리더' ? spName(leaderSp()) : vars[k];
      if (v === undefined) return all;
      return p ? particle(String(v), p) : String(v);
    });
  }
  function who(sp) {
    if (sp === null) return { name: '', pt: '' };
    if (sp === 'L') { const s = leaderSp(), ch = Game.save.roster[s]; return { name: spName(s), id: s, shiny: !!(ch && ch.shiny) }; }
    return { name: spName(sp), id: sp, shiny: false };
  }
  // lines를 차례로 보여 주고, 다 보거나 건너뛰면 끝난다 (Promise)
  function play(lines, opts = {}) {
    const vars = opts.vars || {};
    return new Promise(res => {
      let i = -1, full = '', shown = 0, timer = null, done = false, m = null;
      let watch = null, restore = null, ended = false;
      // 장면 곡 (music/<이름>): 끝나면 원래 곡으로
      if (opts.bgm && typeof Sound !== 'undefined' && Sound.scene) Sound.scene(opts.bgm).then(r => { if (ended) r(); else restore = r; });
      const end = () => { if (done) return; done = true; ended = true; clearInterval(timer); clearInterval(watch); if (m) UI.close(m); if (restore) restore(); res(); };
      const finishTyping = () => { clearInterval(timer); timer = null; shown = full.length; m.box.querySelector('.story-say').textContent = full; m.box.classList.add('typed'); };
      const show = () => {
        const [sp, emo, text] = lines[i], w = who(sp), box = m.box;
        box.classList.toggle('narration', sp === null);
        box.querySelector('.story-pt').innerHTML = w.id ? portraitImg(w.id, 'portrait story-portrait', emo || 'Normal', w.shiny) : '';
        box.querySelector('.story-name').textContent = w.name;
        full = fill(text, vars); shown = 0; box.classList.remove('typed');
        const say = box.querySelector('.story-say'); say.textContent = '';
        clearInterval(timer);
        timer = setInterval(() => { shown += 1; say.textContent = full.slice(0, shown); if (shown >= full.length) finishTyping(); }, TYPE_MS);
      };
      const next = () => {
        if (done) return;
        if (timer) { finishTyping(); return; }   // 글자가 나오는 중이면 먼저 다 보여 준다
        i += 1;
        if (i >= lines.length) { end(); return; }
        show();
      };
      m = UI.open({
        html: `<div class="story-line"><div class="story-pt"></div><div class="story-txt"><div class="story-name"></div><div class="story-say"></div><span class="story-more">▼</span></div></div>`,
        choices: [{ label: '다음', keep: true, fn: next }, { label: '⏭ 스킵', fn: end }],
        cancel: false,   // ✕·바깥 클릭으로 사라지지 않게 (끝내기는 스킵 버튼으로만)
        onOpen: (box, mm) => {
          mm.el.classList.add('story-back'); box.classList.add('story-box');
          // 대사 칸 아무 데나 눌러도 넘어간다 (버튼은 버튼대로)
          box.querySelector('.story-line').addEventListener('click', () => { if (performance.now() - mm.t0 > 250) next(); });
        },
      });
      next();
      watch = setInterval(() => { if (!m.el.isConnected) end(); }, 400);   // 다른 곳에서 창을 모두 닫아도 (UI.closeAll) 장면이 끝난 것으로
    });
  }
  // ── 이야기 진행 (장면 목록: js/scenes.js) ──
  // save.story = { seen: { 장면 id: true }, offer: 처음 한 번 '지난 이야기를 볼까요?' }
  const TEAM_DEFAULT = '새내기';
  const teamLabel = () => `${(Game.save && Game.save.teamName) || TEAM_DEFAULT} 탐험대`;
  const baseVars = () => ({ 탐험대: teamLabel() });
  let running = false;
  const busy = () => running;
  function state() {
    const s = Game.save;
    if (!s.story) {
      // 이야기가 생기기 전부터 하던 탐험대: 지금 조건에 맞는 장면은 본 것으로 두고 (밀려서 한꺼번에 나오지 않게), 처음 한 번 볼지 묻는다
      const old = Object.keys(s.cleared || {}).length > 0;
      s.story = { seen: {} };
      if (old) { for (const sc of SCENES) if (whenOf(sc)(s)) s.story.seen[sc.id] = true; s.story.offer = true; }
    }
    return s.story;
  }
  // 마을 부분이 나올 조건: 따로 없으면 '그 던전을 클리어했다'
  const whenOf = sc => sc.when || (s => !!(sc.dg && s.cleared && s.cleared[sc.dg]));
  const DUNGEON_PARTS = ['mid', 'intro', 'won'];
  // 처음부터 끝까지 (다시 보기·한꺼번에 볼 때): 출발 전 → 중간 보스 → 보스 → 쓰러뜨린 뒤 → 길드로 돌아와서
  const fullLines = sc => {
    const inDg = DUNGEON_PARTS.flatMap(k => sc[k] || []);
    return [...(sc.depart || []), ...inDg, ...(inDg.length ? [[null, '', '— 길드로 돌아와서 —']] : []), ...(sc.lines || [])];
  };
  // full: 던전 안 대사까지 이어서 / 아니면 마을 부분만
  // 장면 곡: 마을·출발 전은 길드 곡, 보스 앞은 전설 곡 (장면마다 bgm·departBgm·introBgm으로 바꿀 수 있다)
  const BGM = { town: 'guild', depart: 'guild', mid: 'legend', intro: 'legend', won: null };
  const bgmOf = (sc, part) => (part === 'depart' ? sc.departBgm : part === 'intro' || part === 'mid' ? sc.introBgm : part === 'town' ? sc.bgm : null) || BGM[part];
  async function runScene(sc, { again = false, full = false } = {}) {
    const api = { play: lines => play(lines, { vars: baseVars(), bgm: bgmOf(sc, 'town') }), askTeamName: again && Game.save.teamName ? async () => {} : askTeamName };   // 다시 보기에서는 이름을 다시 묻지 않는다
    if (sc.run) await sc.run(api); else await api.play(full ? fullLines(sc) : sc.lines);
  }
  // 던전 안: 아직 클리어하지 않은 던전의 다음 장면 조각 (출발 전 depart · 중간 보스 mid · 보스 intro · 쓰러뜨린 뒤 won)
  function pendingIn(dgId) {
    const save = Game.save; if (!save || !dgId || (save.cleared && save.cleared[dgId])) return null;
    const st = state();
    return SCENES.find(sc => sc.dg === dgId && !st.seen[sc.id] && (!sc.after || st.seen[sc.after])) || null;
  }
  const hasPart = (dgId, part) => { const sc = pendingIn(dgId); return !!(sc && sc[part] && sc[part].length); };
  async function inDungeon(dgId, part) {
    const sc = pendingIn(dgId); if (!sc || !sc[part] || !sc[part].length || running) return;
    if (part === 'won') { const st = state(); st.shownIn = st.shownIn || {}; st.shownIn[sc.id] = true; Game.persist(); }   // 쓰러뜨린 뒤까지 던전에서 봤으면 마을에서는 마을 부분만
    running = true;
    try { await play(sc[part], { vars: baseVars(), bgm: bgmOf(sc, part) }); } finally { running = false; }
  }
  // 마을에서: 볼 장면이 있으면 차례로 (창이 열려 있으면 닫힌 뒤)
  async function check() {
    const save = Game.save;
    if (!save || running || (typeof Dungeon !== 'undefined' && Dungeon.run)) return;
    if (UI.isOpen()) { setTimeout(check, 1500); return; }
    const st = state();
    if (st.offer) {
      st.offer = false; Game.persist();
      const seen = SCENES.filter(sc => st.seen[sc.id]);
      const ok = await UI.confirm('📖 이야기가 생겼어요!', `<p>푸크린 길드의 신입 탐험대 이야기가 추가됐어요. 지금까지 진행한 곳까지의 이야기 <b>${seen.length}편</b>을 처음부터 볼까요?</p>
        <p class="dim">나중에 정보 탭의 '📖 이야기 다시 보기'에서 언제든 볼 수 있어요. 탐험대 이름도 거기서 정할 수 있어요.</p>`, '처음부터 본다', '나중에 볼게요');
      if (ok) { running = true; try { for (const sc of seen) await runScene(sc, { full: true }); } finally { running = false; } }
    }
    // 볼 장면을 차례대로 모은다 (새 장이 추가되면 이미 깬 던전의 장면이 여럿 한꺼번에 생길 수 있다)
    const queue = [], tmp = { ...st.seen };
    for (;;) {
      const sc = SCENES.find(x => !tmp[x.id] && (!x.after || tmp[x.after]) && whenOf(x)(save));
      if (!sc) break;
      queue.push(sc); tmp[sc.id] = true;
    }
    if (!queue.length) return;
    for (const sc of queue) st.seen[sc.id] = true;   // 먼저 기록 (보는 도중 새로고침해도 다시 나오지 않게, 다시 보기는 언제든)
    Game.persist();
    if (queue.length > 1 && !await UI.confirm('📖 새 이야기', `<p>새 이야기 <b>${queue.length}편</b>이 생겼어요. (${esc(queue[0].title)} ~ ${esc(queue[queue.length - 1].title)})</p><p>지금 이어서 볼까요?</p>
      <p class="dim">나중에 정보 탭의 '📖 이야기'에서 언제든 볼 수 있어요.</p>`, '이어서 본다', '나중에 볼게요')) return;
    running = true;
    try {
      for (const sc of queue) {
        const full = !(st.shownIn && st.shownIn[sc.id]);   // 던전 안 대사를 못 봤으면 (하드 모드 등) 이어서 보여 준다
        if (st.shownIn) delete st.shownIn[sc.id];
        await runScene(sc, { full });
      }
      Game.persist();
    } finally { running = false; }
  }
  // 탐험대 이름 정하기 (8글자까지, 뒤에 '탐험대'가 붙는다)
  function askTeamName() {
    return new Promise(res => {
      let inp = null, done = false;
      const finish = () => {
        if (done) return; done = true;
        const v = (inp && inp.value || '').replace(/\s+/g, ' ').trim().replace(/\s*탐험대$/, '').slice(0, 8);
        Game.save.teamName = v || Game.save.teamName || TEAM_DEFAULT; Game.persist(); res();
      };
      const m = UI.open({
        title: '🏷 탐험대 이름', cancel: false,
        html: `<p>탐험대 이름을 정해 주세요. <span class="dim">(8글자까지 · 뒤에 '탐험대'가 붙어요)</span></p>
          <p><input class="team-name-input" maxlength="8" value="${esc((Game.save && Game.save.teamName) || '')}" placeholder="${TEAM_DEFAULT}"> 탐험대</p>`,
        choices: [{ label: '이 이름으로 정한다', fn: finish }],
        onOpen: box => {
          inp = box.querySelector('input');
          setTimeout(() => inp.focus(), 50);
          // 한글 조합 중의 Enter는 글자 확정이라 넘긴다
          inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); UI.close(m); finish(); } });
        },
      });
    });
  }
  // 정보 탭: 이야기 다시 보기
  // 정보 탭: 한 줄 요약 (목록은 팝업)
  function replayHtml() {
    const st = state(), seen = SCENES.filter(sc => st.seen[sc.id]);
    const main = seen.filter(sc => !sc.side).length, side = seen.filter(sc => sc.side).length;
    return `<h3>📖 이야기</h3><div class="row"><span class="grow">🏷 <b>${esc(teamLabel())}</b> <span class="dim">· 본편 ${main}/${SCENES.filter(sc => !sc.side).length}편 · 외전 ${side}/${SCENES.filter(sc => sc.side).length}편</span></span>
      <button class="btn sm" data-act="story-list">이야기 다시 보기</button> <button class="btn sm ghost" data-act="team-name">이름 바꾸기</button></div>`;
  }
  function openList() {
    const st = state(), seen = SCENES.filter(sc => st.seen[sc.id]);
    const list = arr => `<div class="btns">${arr.map(sc => `<button class="btn sm ghost" data-replay="${sc.id}">${esc(sc.title)}</button>`).join(' ')}</div>`;
    const main = seen.filter(sc => !sc.side), side = seen.filter(sc => sc.side), sideAll = SCENES.filter(sc => sc.side).length;
    const m = UI.open({
      title: '📖 이야기 다시 보기', wide: true,
      html: `<h3>본편 <span class="dim">(${main.length}/${SCENES.length - sideAll})</span></h3>${main.length ? list(main) : '<p class="dim">아직 본 이야기가 없어요.</p>'}
        <h3>외전 <span class="dim">(${side.length}/${sideAll})</span></h3>${side.length ? list(side) : '<p class="dim">아직 본 외전이 없어요.</p>'}
        <p class="dim">일반 던전을 처음 클리어하고 마을에 돌아오면 본편이, 테마 던전을 처음 클리어하면 그 던전의 외전이 나와요.</p>`,
      choices: [{ label: '닫기', fn: () => {} }],
      onOpen: box => box.addEventListener('click', e => {
        const b = e.target.closest('[data-replay]'); if (!b) return;
        UI.close(m); replay(b.dataset.replay).then(openList);   // 다 보면 목록으로 돌아온다
      }),
    });
  }
  async function replay(id) {
    const sc = SCENES.find(x => x.id === id); if (!sc || running) return;
    running = true; try { await runScene(sc, { again: true, full: true }); } finally { running = false; }
  }
  return { play, fill, check, busy, askTeamName, replayHtml, replay, openList, teamLabel, inDungeon, hasPart };
})();
