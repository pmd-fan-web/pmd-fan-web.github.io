// 게임 상태, 저장, 마을 UI
'use strict';

const SAVE_KEY = 'pmdweb_save_v1';
// 창고 사용량: 겹치는 아이템은 종류당 1칸, 나머지는 개수만큼
// 창고 칸: 겹치는 물건은 한 칸, 아니면 개수만큼. 기술머신은 따로 보관해서 칸을 차지하지 않는다 (v0.67)
const storageUsedOf = st => Object.entries(st).reduce((s, [id, n]) => s + (n > 0 && !ITEMS[id]?.tm ? (ITEMS[id]?.stack ? 1 : n) : 0), 0);

const Game = (() => {
  let save = null;
  let tab = 'dungeon';
  let dgTab = 'normal';   // 던전 탭의 하위 탭

  // ───────────────────────── 저장 ─────────────────────────
  function newSave(sp) {
    return {
      v: SAVE_SCHEMA, gameVersion: GAME_VERSION, money: 500, day: 1, current: sp, starter: sp,
      roster: { [sp]: newEntry(sp) },
      bag: [{ id: 'oran', n: 1 }, { id: 'oran', n: 1 }, { id: 'apple', n: 1 }, { id: 'gravel', n: 5 }],   // 처음 탐험용 던질 것 (v0.91)
      storage: {}, cleared: {}, best: {},
      missions: { board: [], accepted: [] }, shop: [], run: null,
      settings: { fast: false, autoDescend: false }, bagMax: BAG_BASE, storageMax: STORAGE_BASE, storageV44: true,
    };
  }
  const newEntry = sp => ({ lv: START_LEVEL, exp: expFor(START_LEVEL), moves: defaultMoves(sp, START_LEVEL), ability: defaultAbility(sp) });
  // 저장된 특성이 그 포켓몬의 것이 아니면 기본 특성으로
  // ── 동료: 영입한 포켓몬 중 최대 PARTY_MAX마리를 데리고 일반·테마 던전에 간다 (각자 레벨) ──
  const PARTY_MAX = 3;
  const partyList = () => (save.party || []).filter(sp => save.roster[sp] && sp !== save.current).slice(0, PARTY_MAX);
  function makePartner(sp) {
    const ch = save.roster[sp];
    const a = makeCreature(sp, ch.lv, { ally: true, exp: ch.exp, moves: ch.moves.length ? ch.moves : undefined, ability: entryAbility(sp, ch), boost: ch.boost });
    a.ally = true; a.held = ch.held || null; a.shiny = !!ch.shiny; a.tms = (ch.tms || []).slice(); a.selForm = ch.form || undefined;
    return a;
  }
  // 하드모드 탐험대: 고정 레벨, 레벨이 낮으면 진화 전 모습 (rsp: 캐릭터 기록의 원래 포켓몬)
  // 진화 전 모습으로 들어갈 때 고를 수 있는 특성: 일반 특성 전부 (원래 숨겨진 특성을 쓰고 있었으면 숨겨진 특성도)
  // 기본값은 진화할 때처럼 같은 칸의 특성
  function hardAbilityChoices(sp, dsp) {
    const ch = save.roster[sp], cur = entryAbility(sp, ch), hidden = !!(DATA.species[sp].ab.find(a => a[0] === cur) || [])[1];
    const list = DATA.species[dsp].ab.filter(([, h]) => !h || hidden).map(([id]) => id);
    const slot = Math.max(0, DATA.species[sp].ab.findIndex(a => a[0] === cur));
    const def = (DATA.species[dsp].ab[slot] && list.includes(DATA.species[dsp].ab[slot][0])) ? DATA.species[dsp].ab[slot][0] : list[0];
    return { list: [...new Set(list)], def };
  }
  function makeHardMember(sp, lv, opts, abil) {
    const ch = save.roster[sp], dsp = devolveFor(sp, lv);
    const ab = dsp === sp ? entryAbility(sp, ch) : (abil && DATA.species[dsp].ab.some(a => a[0] === abil) ? abil : hardAbilityChoices(sp, dsp).def);
    const c = makeCreature(dsp, lv, { ...opts, moves: ch.moves.length ? ch.moves : undefined, ability: ab, boost: ch.boost });
    c.rsp = sp; c.held = ch.held || null; c.shiny = !!ch.shiny && !!DATA.species[dsp].sh; c.tms = (ch.tms || []).slice();
    if (dsp === sp) c.selForm = ch.form || undefined;
    return c;
  }
  // 하드모드에서 나올 때 캐릭터 기록에 남기는 것: 지닌 물건·기술머신·영양제/구미만 (레벨·경험치·기술은 그대로)
  function saveHardMember(c, isLeader) {
    const k = c.rsp || c.sp; if (!save.roster[k]) return;
    save.roster[k] = { ...save.roster[k], held: c.held || null, ...(c.tms ? { tms: c.tms } : {}), ...(isLeader && c.boost ? { boost: c.boost } : {}) };
  }
  // 동료의 진행(레벨·경험치·기술)을 캐릭터 기록에 남긴다
  function saveParty(r) {
    if (r.mode !== 'normal') return;
    if (r.hard) { for (const a of r.party || []) saveHardMember(a, false); return; }
    for (const a of r.party || []) if (save.roster[a.sp]) save.roster[a.sp] = { ...save.roster[a.sp], lv: a.lv, exp: a.exp, moves: ownMoves(a).map(m => m.id), held: a.held || null };   // 던전에서 바꾼 지닌 물건도 남는다
  }
  const entryAbility = (sp, ch) => (ch && DATA.species[sp].ab.some(a => a[0] === ch.ability) ? ch.ability : defaultAbility(sp));
  let newerSave = null;   // 세이브가 이 화면보다 새 버전에서 저장됐으면 그 버전 (덮어쓰지 않는다)
  let lastBody = null;   // 저장 시각을 뺀 세이브 내용 (내용이 바뀌었을 때만 저장 시각을 갱신한다)
  const bodyOf = s => JSON.stringify({ ...s, savedAt: 0, playSec: 0 });   // 플레이 시간만 늘어난 것은 '바뀜'으로 치지 않는다 (클라우드 저장을 아끼려고)
  // 세이브를 통째로 바꾸고 새로고침하는 중 (불러오기·백업 복원·초기화): 새로고침하면서 창이 숨겨질 때
  // 지금 메모리의 옛 세이브를 다시 저장하면 바꾼 세이브가 덮여 버린다 (v0.78 전까지 불러오기·초기화가 안 되던 원인)
  let leaving = false;
  function reloadAfterReplace() { leaving = true; clearTimeout(upTimer); location.reload(); }
  function persist() {
    if (newerSave || leaving || !save) return;
    const body = bodyOf(save);
    if (body !== lastBody) { save.savedAt = Date.now(); lastBody = body; }
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 저장 불가 환경 */ }
    scheduleUpload();
  }
  function load() {
    try { const s = localStorage.getItem(SAVE_KEY); const v = s ? migrateSave(JSON.parse(s), s) : null; if (v) lastBody = bodyOf(v); return v; }
    catch (e) { return null; }
  }

  // ── 세이브 변환: 버전이 바뀌면 먼저 백업하고, 새 버전에 맞게 고친다 ──
  const BACKUP_KEY = 'pmdweb_save_backups';
  const SAVE_SCHEMA = 2;
  // 세이브 구조가 바뀔 때 여기에 변환을 추가한다 (to: 바뀐 뒤 번호)
  const MIGRATIONS = [
    { to: 2, fn: s => { s.settings = s.settings || {}; } },
  ];
  function backups() { try { return JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]'); } catch (e) { return []; } }
  function backupSave(raw, ver) {
    const list = backups().filter(b => b.data !== raw);
    list.unshift({ ver, at: new Date().toISOString(), data: raw });
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(list.slice(0, 3))); } catch (e) { /* 공간 부족: 백업 생략 */ }
  }
  // 새 기능이 추가되며 생긴 항목들: 없으면 기본값
  // 숙련도 옮기기 (진화): from에 쌓인 사용 횟수를 to에 더한다
  function mergeMastery(s, from, to) {
    if (!s.mastery || !s.mastery[from]) return;
    const b = s.mastery[to] = s.mastery[to] || {};
    for (const [mid, n] of Object.entries(s.mastery[from])) b[mid] = (b[mid] || 0) + n;
    delete s.mastery[from];
  }
  function ensureDefaults(s) {
    s.settings = { fast: false, autoDescend: false, ...(s.settings || {}) };
    s.bag = s.bag || []; s.storage = s.storage || {}; s.cleared = s.cleared || {}; s.best = s.best || {};
    s.missions = s.missions || { board: [], accepted: [] }; s.missions.board = s.missions.board || []; s.missions.accepted = s.missions.accepted || [];
    s.shop = s.shop || []; s.money = s.money || 0; s.day = s.day || 1; s.clears = s.clears || {};
    s.bagMax = s.bagMax || Math.max(BAG_BASE, s.bag.length);
    // v0.44: 창고 기본 40 → 300칸. 확장한 단계는 그대로 이어진다 (예: 120칸 = 4단계 → 380칸)
    // v0.50: 진화 전 모습에 남아 있던 숙련도를 지금 모습으로 (진화 전 모습이 따로 목록에 있으면 그대로 둔다)
    if (!s.masteryV50) { for (const sp of Object.keys(s.roster || {})) for (const pre of DATA.species[sp] ? preEvos(+sp) : []) if (!s.roster[pre]) mergeMastery(s, pre, +sp); s.masteryV50 = true; }
    if (!s.storageV44) { if (s.storageMax > OLD_STORAGE_BASE) s.storageMax += STORAGE_BASE - OLD_STORAGE_BASE; s.storageV44 = true; }
    s.storageMax = Math.max(s.storageMax || 0, STORAGE_BASE, storageUsedOf(s.storage));
    for (const [sp, ch] of Object.entries(s.roster || {})) {
      if (!DATA.species[sp]) { delete s.roster[sp]; continue; }
      ch.lv = ch.lv || START_LEVEL; ch.exp = ch.exp ?? expFor(ch.lv); ch.moves = (ch.moves || []).filter(m => DATA.moves[m]);
      if (!ch.moves.length) ch.moves = defaultMoves(+sp, ch.lv);
    }
    s.bag = s.bag.filter(b => ITEMS[b.id]);
    for (const id of Object.keys(s.storage)) if (!ITEMS[id]) delete s.storage[id];
  }
  function migrateSave(s, raw) {
    if (!s || !s.roster) return s;
    const from = s.gameVersion || '0';
    if (cmpVer(from, GAME_VERSION) > 0) { newerSave = from; return s; }   // 옛 화면: 읽기만
    if (from !== GAME_VERSION) backupSave(raw, from);
    let v = s.v || 1;
    for (const m of MIGRATIONS) if (v < m.to) { m.fn(s); v = m.to; }
    s.v = Math.max(v, SAVE_SCHEMA);
    ensureDefaults(s);
    s.gameVersion = GAME_VERSION;
    return s;
  }
  async function restoreBackup(i) {
    const b = backups()[i]; if (!b) return;
    const ok = await UI.confirm('백업에서 복원', `<p>v${esc(b.ver)} 세이브 (${esc(new Date(b.at).toLocaleString())})로 되돌립니다.</p><p class="warn">지금 세이브는 이 백업으로 바뀝니다. (지금 세이브도 백업 목록에 남겨 둡니다)</p>`, '복원한다', '그만둔다');
    if (!ok) return;
    backupSave(JSON.stringify(save), GAME_VERSION);
    try { localStorage.setItem(SAVE_KEY, b.data); } catch (e) { UI.alert('복원 실패', '<p>브라우저에 저장할 수 없습니다.</p>'); return; }
    reloadAfterReplace();
  }

  // ── 새 버전 알림: 사이트에 새 버전이 올라오면 마을에서 새로고침을 안내한다 (던전 중에는 방해하지 않음) ──
  let updateVer = null;
  async function checkUpdate() {
    if (!/^https?:/.test(location.protocol)) return;
    try {
      const t = await (await fetch('js/defs.js?check=' + Date.now(), { cache: 'no-store' })).text();
      const v = (t.match(/GAME_VERSION = '([^']+)'/) || [])[1];
      if (v && cmpVer(v, GAME_VERSION) > 0 && v !== updateVer) { updateVer = v; if (!Dungeon.floor && save) { renderTown(); UI.toast(`새 버전 v${v}이 나왔어요. 마을 위쪽의 알림을 눌러 새로고침하세요.`); } }
    } catch (e) { /* 오프라인 등 */ }
  }
  // 캐시를 피해서 새로 불러온다 (진행 상황은 이미 저장되어 있다)
  const reloadFresh = () => { location.href = location.pathname + '?r=' + Date.now(); };
  async function askUpdate() {
    if (!updateVer) return;
    if (Dungeon.floor) { UI.toast('던전에서 나온 뒤에 새로고침하세요.'); return; }
    const ok = await UI.confirm('새 버전', `<p>새 버전 <b>v${esc(updateVer)}</b>이 나왔어요. (지금 v${GAME_VERSION})</p><p>새로고침하면 적용됩니다. 진행 상황은 저장되어 있고, 업데이트 전 세이브는 자동으로 백업돼요.</p>`, '새로고침', '나중에');
    if (ok) { persist(); reloadFresh(); }
  }

  // ── 클라우드 세이브: 로그인하면 세이브를 서버에도 올려서 다른 기기에서 이어한다 ──
  // 서버가 막혀도 이 브라우저의 세이브로 계속 플레이할 수 있다. 덮어쓰기 전에는 항상 백업을 남긴다.
  const SYNC_KEY = 'pmdweb_sync';   // 마지막으로 맞춘 클라우드 세이브 { uid, at }
  const syncMeta = () => { try { return JSON.parse(localStorage.getItem(SYNC_KEY) || 'null'); } catch (e) { return null; } };
  const setSyncMeta = m => { try { if (m) localStorage.setItem(SYNC_KEY, JSON.stringify(m)); else localStorage.removeItem(SYNC_KEY); } catch (e) { /* 무시 */ } };
  // 클라우드 저장 (다른 기기에서 이어하기용. 브라우저 세이브는 매번 바로 저장된다)
  //  마을: 바뀐 게 있으면 30분에 한 번까지 / 던전 안: 올리지 않는다 (층마다 바뀌어서)
  //  던전을 마치고 마을에 돌아올 때, 창을 닫거나 다른 탭으로 갈 때는 바로 올린다 (던전 도중이어도)
  //  서버 규칙은 20초에 한 번까지만 받아 준다. 탭을 자주 오가도 FLUSH_GAP 안에는 다시 올리지 않는다
  // 클라우드 세이브 최대 크기 (보안 규칙과 같게. 문서 한도 1MB 안, v0.64에 40만 → 90만 자)
  const CLOUD_SAVE_MAX = 900000;
  const UPLOAD_GAP = 30 * 60 * 1000, FLUSH_GAP = 10 * 60 * 1000;   // 창을 숨길 때: 2분 → 10분 (v0.96, 쓰기 한도 아끼기. 휴대폰은 앱을 자주 오간다)
  const RETURN_GAP = 10 * 60 * 1000;   // 던전에서 돌아올 때 (v0.76: 2분 → 10분. 짧은 탐험을 자주 돌면 돌아올 때마다 쓰기가 나갔다)   // 무료 한도(쓰기)를 아끼려고 10분 → 20분(v0.47) → 30분(v0.51), 창을 숨길 때 30초 → 2분
  // 마지막 클라우드 저장 시각도 브라우저에 남긴다 (새로고침 직후 다시 올리다 20초 제한에 걸리지 않게)
  const UP_KEY = 'pmdweb_lastup';
  let bound = false, upTimer = null, lastUp = (() => { try { return +localStorage.getItem(UP_KEY) || 0; } catch (e) { return 0; } })(), upPending = false, syncing = null, cloudErr = null, onlineBoot = null;
  const inDungeon = () => typeof Dungeon !== 'undefined' && !!Dungeon.run;
  function scheduleUpload() {
    if (!bound || !Online.loggedIn()) return;
    upPending = true;
    if (upTimer || inDungeon()) return;
    upTimer = setTimeout(() => { upTimer = null; if (!inDungeon()) uploadNow(); }, Math.max(0, lastUp + UPLOAD_GAP - Date.now()));
  }
  // 서버가 한도를 넘으면 쓰기는 실패로 끝나지 않고 계속 다시 시도한다 (Firestore가 resource-exhausted를 재시도함).
  //  기다리는 쪽이 멈추지 않게 CLOUD_WAIT 뒤에는 실패로 보고, 하나가 끝나기 전에는 새로 올리지 않는다 (v0.96)
  const CLOUD_WAIT = 10 * 1000;
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej({ code: 'deadline-exceeded', message: 'timeout' }), ms))]);
  let upFlight = null;
  async function uploadNow() {
    if (!bound || !Online.loggedIn() || !save || newerSave || leaving) return false;
    if (upFlight) { scheduleUpload(); return false; }
    const m = syncMeta();
    if (m && m.uid === Online.uid() && m.at === save.savedAt) { upPending = false; return true; }   // 바뀐 것 없음
    lastUp = Date.now(); try { localStorage.setItem(UP_KEY, String(lastUp)); } catch (e) { /* 무시 */ }
    const raw = JSON.stringify(save);
    if (raw.length > CLOUD_SAVE_MAX) { cloudErr = '세이브가 너무 커서 클라우드에 올릴 수 없어요. 이 브라우저에는 그대로 저장됩니다.'; upPending = false; return false; }
    // 올리는 동안 세이브가 또 바뀔 수 있다: 올린 그 시점의 값으로 기록해야 바뀐 부분이 다음에 다시 올라간다
    // (예전에는 올린 뒤의 savedAt을 적어서, 그 사이 바뀐 내용이 클라우드에 안 올라가고 다음 접속 때 옛 클라우드 세이브로 덮였다)
    const at = save.savedAt || 0;
    try {
      const push = Online.pushCloud(raw, at);
      upFlight = push; push.then(() => {}, () => {}).finally(() => { if (upFlight === push) upFlight = null; });
      await withTimeout(push, CLOUD_WAIT); setSyncMeta({ uid: Online.uid(), at }); cloudErr = null;
      upPending = (save.savedAt || 0) !== at; if (upPending) scheduleUpload();
      return true;
    }
    catch (e) { cloudErr = Online.why(e); console.warn(e); scheduleUpload(); return false; }   // 실패하면 다음 주기에 다시
  }
  // 올릴 게 남아 있으면 바로 올린다 (창을 닫거나 숨길 때, 던전에서 돌아왔을 때)
  // gap: 지난 저장 뒤 이만큼 지났으면 바로 올린다. 안 지났으면 (던전에서 돌아왔을 때) 그 시각에 올리도록 예약
  function flushUpload(gap = FLUSH_GAP) {
    if (!upPending) return;
    const wait = lastUp + gap - Date.now();
    if (wait > 0) {
      if (gap !== FLUSH_GAP && bound && Online.loggedIn()) { clearTimeout(upTimer); upTimer = setTimeout(() => { upTimer = null; if (!inDungeon()) uploadNow(); }, wait); }
      return;
    }
    clearTimeout(upTimer); upTimer = null; uploadNow();
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushUpload(); });
  window.addEventListener('pagehide', flushUpload);

  // ── 접속자 수 (로그인한 탐험대 기준) ──
  //  "접속 중" 표시는 30분마다 남기고 (던전 안에서도), 수는 마을 화면을 보고 있을 때만 30분마다 센다. 창을 숨기면 쉰다
  // 마지막 접속 표시·접속자 수 확인 시각은 브라우저에 남겨서 새로고침해도 이어서 센다 (v0.70: 새로고침마다 쓰기·읽기가 나가고, 1분 안이면 서버가 거절하던 문제)
  const PRES_KEY = 'pmdweb_presence';
  const presLoad = () => { try { const o = JSON.parse(localStorage.getItem(PRES_KEY)); return o && o.uid === Online.uid() ? o : null; } catch (e) { return null; } };
  const presSave = () => { try { localStorage.setItem(PRES_KEY, JSON.stringify({ uid: Online.uid(), at: presenceAt, countAt, n: onlineN })); } catch (e) { /* 무시 */ } };
  let onlineN = null, presenceAt = 0, countAt = 0, presenceTimer = null, presUid = null;
  const PRESENCE_MS = () => Online.PRESENCE_MIN * 60 * 1000 - 5000;
  const inTown = () => document.getElementById('town-screen')?.classList.contains('active');
  async function presenceTick() {
    if (!Online.loggedIn() || document.hidden || idle) return;
    if (presUid !== Online.uid()) { presUid = Online.uid(); const o = presLoad(); presenceAt = o ? o.at || 0 : 0; countAt = o ? o.countAt || 0 : 0; if (o && o.n != null) onlineN = o.n; }
    if (Date.now() - presenceAt >= PRESENCE_MS()) {
      presenceAt = Date.now(); presSave();
      try { await Online.touchPresence(); } catch (e) { console.warn(e); }   // 방금 남겼으면 서버가 거절한다 (괜찮음)
    }
    renewSOSHolds();
    Online.flushDiag().catch(() => {});
    if (inTown() && Date.now() - countAt >= PRESENCE_MS()) {
      countAt = Date.now(); presSave();
      try { onlineN = await Online.onlineCount(); presSave(); } catch (e) { console.warn(e); }
    }
    showOnline();
  }
  function showOnline() {
    const el = document.getElementById('town-online'); if (!el) return;
    el.hidden = onlineN == null || !Online.loggedIn();
    el.textContent = `🟢 접속 ${onlineN}명`;
    el.title = `최근 약 ${Online.ONLINE_WINDOW - 1}분 안에 접속한 탐험대 (로그인한 사람 기준, ${Online.PRESENCE_MIN}분마다 갱신)`;
  }
  // 게시판 구조: 그 던전에 들어가 있는 동안 SOS_RENEW_MS마다 다시 맡는다 (맡은 시간 연장)
  async function renewSOSHolds() {
    const run = Dungeon.run; if (!run || !Dungeon.floor) return;
    for (const m of save.missions.accepted) {
      if (m.kind !== 'sos' || !m.online || !m.docId || m.dungeon !== run.dungeon || run.done.includes(m.id)) continue;
      if (Date.now() - (m.heldAt || 0) < SOS_RENEW_MS) continue;
      m.heldAt = Date.now();
      try { await Online.takeSOS(m.docId); } catch (e) { console.warn(e); }   // 이미 구조됐거나 다른 사람이 맡았으면 그냥 둔다
    }
  }
  // ── 마을 자리 비움 (v0.83): 마을에서 10분 동안 아무 조작이 없으면 서버 연결(접속 표시·구조 게시판 지켜보기)을 쉰다 ──
  //  들어갈 때 남은 클라우드 저장은 먼저 올린다. 누르거나 키를 누르면 돌아온다
  const IDLE_MS = 10 * 60 * 1000;
  let idle = false, lastInput = Date.now();
  function goIdle() {
    idle = true;
    flushUpload(0);
    if (sosWatch) { sosWatch(); sosWatch = null; } sosWatchId = null; sosLast = undefined;
    let el = document.getElementById('idle-cover');
    if (!el) {
      el = document.createElement('div'); el.id = 'idle-cover';
      el.innerHTML = '<div class="box"><div class="z">💤</div><p><b>자리 비움</b></p><p class="dim">마을에서 10분 동안 조작이 없어서 서버 연결을 쉬고 있어요.<br>아무 곳이나 누르거나 키를 누르면 돌아옵니다.</p></div>';
      el.addEventListener('click', e => { e.stopPropagation(); wakeIdle(); });
      document.body.appendChild(el);
    }
    el.hidden = false;
  }
  function wakeIdle() {
    if (!idle) return;
    idle = false; lastInput = Date.now();
    const el = document.getElementById('idle-cover'); if (el) el.hidden = true;
    if (bound) watchMySOS();
    presenceTick(); checkOnline();
  }
  for (const t of ['pointerdown', 'keydown', 'wheel', 'touchstart']) document.addEventListener(t, e => {
    lastInput = Date.now();
    if (idle && t === 'keydown') { e.preventDefault(); e.stopPropagation(); wakeIdle(); }
  }, { capture: true, passive: t !== 'keydown' });
  setInterval(() => { if (!idle && save && inTown() && !document.hidden && Date.now() - lastInput >= IDLE_MS) goIdle(); }, 20 * 1000);

  function startPresence() {
    if (presenceTimer) return;
    presenceTimer = setInterval(presenceTick, 60 * 1000);
    document.addEventListener('visibilitychange', presenceTick);
    presenceTick();
  }

  function saveSummary(raw, at) {
    let s; try { s = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return '<p class="warn">읽을 수 없는 세이브</p>'; }
    const ch = s.roster && s.roster[s.current], ok = DATA.species[s.current];
    return `<div class="row">${ok ? portraitImg(s.current, 'portrait sm', 'Normal', ch && ch.shiny) : ''}<div class="grow">
      <b>${ok ? esc(spName(s.current)) : '?'}</b> Lv${ch ? ch.lv : '?'} · ${s.day || 1}일째 · ₽${s.money || 0} · 동료 ${Object.keys(s.roster || {}).length}마리 · 도감 ${Object.keys((s.dex || {}).seen || {}).length}종
      <div class="dim">마지막 저장 ${at ? esc(new Date(at).toLocaleString()) : '알 수 없음'}${s.gameVersion ? ` · v${esc(s.gameVersion)}` : ''}</div></div></div>`;
  }
  function chooseSave(c) {
    return new Promise(res => UI.open({
      title: '☁ 어느 세이브로 할까요?', wide: true, cancel: false,
      html: `<p>이 브라우저의 세이브와 계정의 클라우드 세이브가 다릅니다.</p>
        <h3>☁ 클라우드 세이브</h3>${saveSummary(c.raw, c.savedAt)}
        <h3>💻 이 브라우저의 세이브</h3>${saveSummary(save, save.savedAt)}
        <p class="dim">고르지 않은 쪽은 정보 탭의 백업 목록에 남겨 둡니다.</p>`,
      choices: [{ label: '☁ 클라우드 세이브로 이어한다', fn: () => res('cloud') }, { label: '💻 이 브라우저의 세이브를 클라우드에 올린다', fn: () => res('local') }],
    }));
  }
  function useCloud(c) {
    let s; try { s = JSON.parse(c.raw); } catch (e) { UI.alert('클라우드 세이브', '<p>클라우드 세이브를 읽을 수 없어서 이 브라우저의 세이브를 씁니다.</p>'); return false; }
    if (save) backupSave(JSON.stringify(save), (save.gameVersion || GAME_VERSION) + ' 이 브라우저');
    newerSave = null;
    save = migrateSave(s, c.raw);
    if (newerSave) return false;
    lastBody = bodyOf(save);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 무시 */ }
    setSyncMeta({ uid: Online.uid(), at: c.savedAt });
    return true;
  }
  // 로그인 직후 / 게임을 열 때: 클라우드와 이 브라우저의 세이브를 맞춘다
  function syncSave() {
    if (syncing) return syncing;
    syncing = (async () => {
      bound = false;
      if (!Online.loggedIn() || newerSave) return;   // 옛 화면에서는 세이브를 건드리지 않는다
      let c;
      try { c = await withTimeout(Online.fetchCloud(), CLOUD_WAIT); } catch (e) { cloudErr = Online.why(e); UI.toast('클라우드 세이브를 확인하지 못했어요. 이 브라우저의 세이브로 계속합니다.'); return; }
      const uid = Online.uid(), m = syncMeta();
      if (c && cmpVer(c.ver, GAME_VERSION) > 0) {
        await new Promise(res => UI.open({ title: '새 버전이 필요해요', cancel: false,
          html: `<p>클라우드 세이브는 <b>v${esc(c.ver)}</b>에서 저장됐는데, 지금 열린 게임은 옛 버전 <b>v${GAME_VERSION}</b>이에요. 새로고침해서 최신 버전으로 열어 주세요.</p>`,
          choices: [{ label: '새로고침', fn: reloadFresh }, { label: '이번에는 클라우드 없이 한다', fn: res }] }));
        return;
      }
      let changed = false;
      if (!c) { bound = true; if (save && !newerSave) await uploadNow(); return; }
      if (!save) changed = useCloud(c);
      else if ((save.savedAt || 0) === c.savedAt) setSyncMeta({ uid, at: c.savedAt });
      else if (m && m.uid === uid && m.at === c.savedAt) { bound = true; await uploadNow(); }   // 클라우드는 그대로이고 여기서만 진행
      else if (m && m.uid === uid && m.at === save.savedAt) { changed = useCloud(c); if (changed) UI.toast('다른 기기에서 진행한 세이브를 불러왔어요.'); }
      else if ((await chooseSave(c)) === 'cloud') changed = useCloud(c);
      else { backupSave(c.raw, c.ver + ' 클라우드'); bound = true; setSyncMeta(null); await uploadNow(); }
      bound = true;
      if (changed) afterSaveReplaced();
    })().finally(() => { syncing = null; });
    return syncing;
  }
  function afterSaveReplaced() {
    refreshTitle();
    if (document.getElementById('town-screen').classList.contains('active')) { UI.closeAll(); enterTown(); }
  }
  function refreshTitle() {
    document.getElementById('btn-start').textContent = save ? '이어하기' : '새로 시작';
    renderAcct();
  }
  // 타이틀 화면의 계정 표시
  const standaloneApp = () => !!(navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches));
  function renderAcct() {
    const el = document.getElementById('title-acct'); if (!el) return;
    if (!Online.enabled()) { el.innerHTML = ''; return; }
    el.innerHTML = Online.loggedIn()
      ? `<span>☁ <b>${esc(Online.name())}</b> 님 · 클라우드 세이브 사용 중</span> <button class="btn sm ghost" data-acct>계정</button>`
      : `<button class="btn sm" data-acct>☁ 로그인 / 계정 만들기</button><div class="dim tiny">로그인 없이도 플레이할 수 있어요. 로그인하면 다른 기기에서 이어하고 구조 게시판을 쓸 수 있어요.</div>`
        // 홈 화면에 추가한 웹앱은 (특히 아이폰) 브라우저와 저장 공간이 따로라 세이브가 보이지 않는다: 옮겨 오는 방법 안내
        + (standaloneApp() && !save ? '<div class="warn tiny">📱 홈 화면 앱은 브라우저와 저장 공간이 따로예요. 브라우저에서 하던 세이브는 로그인(클라우드 세이브)하거나, 브라우저에서 세이브 내보내기 → 여기서 불러오기로 옮겨 올 수 있어요.</div>' : '');
    el.querySelector('[data-acct]').onclick = () => accountDialog();
    // 세이브가 없을 때: 처음 화면에서 바로 세이브 파일을 불러올 수 있게 (홈 화면 앱으로 옮겨 올 때 등)
    if (!save) {
      el.insertAdjacentHTML('beforeend', '<div><label class="btn sm ghost">📂 세이브 파일 불러오기<input type="file" accept=".json,application/json" hidden id="title-import"></label></div>');
      el.querySelector('#title-import').onchange = e => { if (e.target.files[0]) importSave(e.target.files[0]); e.target.value = ''; };
    }
  }
  // 처음 고른 포켓몬을 스타팅 순위에 한 번 넣는다 (로그인한 사람만, 계정마다 한 번)
  async function voteStarter() {
    if (!Online.loggedIn() || !save || !save.starter || save.starterVoted) return;
    try { await Online.voteStarter(save.starter); }
    catch (e) { if (!/permission/.test(e.code || '')) { console.warn(e); return; } }   // 거절 = 이미 넣었음
    save.starterVoted = true; persist();
  }
  async function afterLogin() {
    renderAcct();
    await syncSave();
    voteStarter(); voteEnding();
    renderAcct();
    if (save && document.getElementById('town-screen').classList.contains('active')) { renderTown(); checkOnline(true); }
  }
  function accountDialog(mode = 'login') {
    if (!Online.enabled()) return;
    if (Online.loggedIn()) return accountInfo();
    const su = mode === 'signup';
    let busy = false;
    const m = UI.open({
      title: su ? '☁ 계정 만들기' : '☁ 로그인',
      html: `<div class="acct-form">
        <label>아이디 <input id="ac-id" autocomplete="username" maxlength="16" placeholder="영어 소문자·숫자·_ 3~16자" autocapitalize="off" spellcheck="false"></label>
        <label>비밀번호 <input id="ac-pw" type="password" autocomplete="${su ? 'new-password' : 'current-password'}" placeholder="6자 이상"></label>
        ${su ? `<label>비밀번호 확인 <input id="ac-pw2" type="password" autocomplete="new-password"></label>
        <label>닉네임 <input id="ac-nick" maxlength="10" placeholder="구조 게시판에 보이는 이름 (한글 가능, 비우면 아이디)"></label>
        <p class="dim tiny">아이디와 닉네임은 다른 사람과 겹칠 수 없어요.</p>` : ''}
        <p id="ac-msg" class="warn"></p></div>
        ${su ? `<p class="warn">⚠ <b>비밀번호 찾기가 없어요.</b> 이메일을 받지 않아서, 비밀번호를 잊으면 계정을 되찾을 수 없어요. 꼭 적어 두세요.</p>
          <p class="dim tiny">아이디와 비밀번호만으로 가입해요. 이메일 같은 개인정보는 받지 않아요. 다른 사이트에서 쓰는 비밀번호는 쓰지 마세요.<br>
          욕설·비하·운영자 사칭 닉네임은 쓸 수 없고, 다른 사람에게 가려져 보여요.</p>`
          : '<p class="dim tiny">로그인하면 세이브가 클라우드에도 저장되어 다른 기기에서 이어할 수 있고, 구조 게시판을 쓸 수 있어요.<br>비밀번호 찾기는 없어요 (이메일을 받지 않기 때문).</p>'}`,
      choices: [
        { label: su ? '가입하기' : '로그인', keep: true, fn: () => submit() },
        { label: su ? '이미 계정이 있어요 (로그인)' : '계정 만들기', fn: () => accountDialog(su ? 'login' : 'signup') },
        { label: '닫기', fn: () => {} },
      ],
      onOpen: box => {
        box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submit(); } });
        setTimeout(() => box.querySelector('#ac-id').focus(), 0);
      },
    });
    async function submit() {
      if (busy) return;
      const v = id => (m.box.querySelector('#' + id) || {}).value || '';
      const msg = m.box.querySelector('#ac-msg');
      if (su && v('ac-pw') !== v('ac-pw2')) { msg.textContent = '비밀번호 확인이 다릅니다.'; return; }
      busy = true; msg.textContent = '처리 중…';
      try {
        if (su) await Online.signUp(v('ac-id'), v('ac-pw'), v('ac-nick'));
        else await Online.signIn(v('ac-id'), v('ac-pw'));
      } catch (e) {
        if (e.joined) { UI.close(m); UI.alert('☁ 가입', `<p>${esc(e.msg)}</p>`); afterLogin(); return; }
        msg.textContent = e.msg || Online.why(e); busy = false; return;
      }
      UI.close(m);
      UI.toast(su ? `가입했어요. ${Online.name()} 님, 환영합니다!` : `${Online.name()} 님, 어서 오세요!`);
      afterLogin();
    }
  }
  function accountInfo() {
    const m = syncMeta();
    UI.open({
      title: '☁ 계정', wide: true,
      html: `<p>아이디 <b>${esc(Online.userId())}</b> · 닉네임 <b>${esc(Online.name())}</b></p>
        <p>클라우드 세이브: ${m && m.uid === Online.uid() ? `${esc(new Date(m.at).toLocaleString())}에 저장한 세이브와 맞춰져 있어요.` : '아직 올리지 않았어요.'}</p>
        ${Online.nameTaken() ? '<p class="warn">이 닉네임은 다른 사람이 먼저 쓰고 있어요. 구조 게시판을 쓰려면 닉네임을 바꿔 주세요.</p>' : ''}
        ${cloudErr ? `<p class="warn">마지막 오류: ${esc(cloudErr)}</p>` : ''}
        <p class="dim">진행 상황은 이 브라우저에는 바로 저장됩니다. 클라우드에는 던전을 마치고 돌아올 때, 창을 닫거나 다른 탭으로 갈 때, 마을에서는 30분마다 자동으로 올라갑니다.</p>`,
      choices: [
        { label: '☁ 지금 클라우드에 저장', fn: async () => {
          if (Date.now() - lastUp < FLUSH_GAP) { UI.toast('방금 저장했어요. 잠시 뒤에 다시 눌러 주세요.'); return; }
          persist(); const ok = await uploadNow(); UI.toast(ok ? '클라우드에 저장했어요.' : `저장하지 못했어요. ${cloudErr || ''}`);
        } },
        { label: '✏ 닉네임 바꾸기', fn: renameDialog },
        { label: '로그아웃', fn: logoutDialog },
        { label: '🗑 계정 삭제', fn: deleteAccountDialog },
        { label: '닫기', fn: () => {} },
      ],
    });
  }
  // 계정 삭제: 서버에 남은 내 기록을 모두 지운다. 이 브라우저의 세이브는 남는다 (로그인 없이 계속 플레이)
  function deleteAccountDialog() {
    let busy = false;
    const m = UI.open({
      title: '🗑 계정 삭제',
      html: `<p>계정 <b>${esc(Online.userId())}</b>와(과) 서버에 있는 기록을 모두 지웁니다.</p>
        <ul><li>클라우드 세이브, 닉네임, 접속 기록</li><li>아직 아무도 구조하지 않은 내 구조 요청</li></ul>
        <p class="warn">되돌릴 수 없어요.</p>
        <div class="acct-form"><label>비밀번호 확인 <input id="del-pw" type="password" autocomplete="current-password"></label>
        <label class="check"><input id="del-local" type="checkbox"> 이 브라우저의 세이브도 지우기 <span class="dim">(체크하지 않으면 로그인 없이 계속 플레이할 수 있어요)</span></label>
        <p id="del-msg" class="warn"></p></div>`,
      choices: [{ label: '계정을 삭제한다', keep: true, fn: async () => {
        if (busy) return; busy = true;
        const msg = m.box.querySelector('#del-msg'); msg.textContent = '지우는 중…';
        if (upTimer) { clearTimeout(upTimer); upTimer = null; }
        try { await Online.deleteAccount(m.box.querySelector('#del-pw').value); }
        catch (e) { msg.textContent = e.msg || Online.why(e); busy = false; return; }
        bound = false; setSyncMeta(null);
        if (m.box.querySelector('#del-local').checked) {   // 브라우저의 세이브와 백업까지 지우고 처음 화면으로
          try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem('pmdweb_save_backups'); } catch (e) { /* 무시 */ }
          save = null; leaving = true; location.href = location.pathname; return;
        }
        if (save) delete save.sos?.online;
        UI.close(m); renderAcct(); refreshTitle();
        if (save && document.getElementById('town-screen').classList.contains('active')) renderTown();
        UI.alert('계정 삭제', '<p>계정과 서버의 기록을 지웠어요. 이 브라우저의 세이브로 계속 플레이할 수 있어요.</p>');
      } }, { label: '그만둔다', fn: () => {} }],
    });
  }
  function renameDialog() {
    const m = UI.open({
      title: '✏ 닉네임 바꾸기', html: `<div class="acct-form"><label>새 닉네임 <input id="ac-nick" maxlength="10" value="${esc(Online.name())}"></label><p id="ac-msg" class="warn"></p></div>`,
      choices: [{ label: '바꾸기', keep: true, fn: async () => {
        try { await Online.setName(m.box.querySelector('#ac-nick').value); } catch (e) { m.box.querySelector('#ac-msg').textContent = e.msg || Online.why(e); return; }
        UI.close(m); UI.toast('닉네임을 바꿨어요.'); renderAcct(); if (save && tab === 'info') renderTown();
      } }, { label: '그만둔다', fn: () => {} }],
    });
  }
  async function logoutDialog() {
    if (upTimer) { clearTimeout(upTimer); upTimer = null; }
    await uploadNow();
    UI.open({
      title: '로그아웃', html: '<p>로그아웃해도 이 브라우저의 세이브는 남아서 로그인 없이 계속할 수 있어요.</p><p class="dim">여럿이 쓰는 컴퓨터라면 이 브라우저의 세이브를 지워 두세요. 클라우드 세이브는 남아 있어서 다시 로그인하면 이어할 수 있어요.</p>',
      choices: [
        { label: '로그아웃', fn: async () => { await Online.signOut(); bound = false; setSyncMeta(null); UI.toast('로그아웃했어요.'); renderAcct(); if (save && document.getElementById('town-screen').classList.contains('active')) renderTown(); } },
        { label: '로그아웃하고 이 브라우저의 세이브도 지운다', fn: async () => {
          await Online.signOut(); bound = false; setSyncMeta(null);
          try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem('pmdweb_save_backups'); } catch (e) { /* 무시 */ }
          leaving = true; location.href = location.pathname;   // 떠나면서 옛 세이브를 다시 저장하지 않게
        } },
        { label: '그만둔다', fn: () => {} },
      ],
    });
  }

  // 게시판에 올린 내 구조 요청을 실시간으로 지켜본다: 구조되거나 누가 구조하러 가면 바로 확인 (던전 안이면 마을에 돌아왔을 때)
  let sosWatch = null, sosWatchId = null, sosPending = false;
  let sosLast;   // 지켜보기로 받은 내 요청의 마지막 값 (undefined: 아직 못 받음). 있으면 checkOnline이 따로 읽지 않는다 (v0.96)
  function watchMySOS() {
    if (idle) return;
    const s = save && save.sos, id = s && s.online && !s.revived && Online.loggedIn() ? (s.docId || s.id) : null;
    if (id === sosWatchId) return;
    if (sosWatch) { sosWatch(); sosWatch = null; }
    sosWatchId = id; sosLast = undefined;
    if (!id) return;
    let first = true;
    sosWatch = Online.watchSOS(id, d => {
      if (sosWatchId === id) sosLast = d;
      if (first) { first = false; return; }   // 처음 읽은 값은 checkOnline이 이미 본다
      const s2 = save && save.sos;
      const changed = !d || d.status !== 'open' || (d.takenBy && !s2?.takenAt) || (!d.takenBy && s2?.takenAt);
      if (!changed) return;
      if (inTown()) checkOnline(true); else sosPending = true;
    });
  }

  // 구조 게시판 확인: 내 요청이 구조됐는지, 내가 구조한 친구가 감사 편지를 보냈는지 (자주 읽지 않게 1분 30초 간격)
  // 게시판 구조 완료를 서버에 전하고 구조 보답을 준다. { ok, html } / { lost } / { denied, msg } / { error } (error면 다음에 다시)
  const claimingNow = new Set();
  async function claimRescueOne(id, r) {
    const doc = r.docId || id;
    claimingNow.add(doc);
    try {
      let ok;
      try { ok = await Online.claimRescue(doc, r.me, !!save.settings.noGift); }
      catch (e) {
        if (!/permission|name-taken/.test((e && e.code) || '')) return { error: true };
        claimFailed.add(doc);
        return { denied: true, msg: e.msg || '서버가 구조 완료를 받아 주지 않았어요.' };
      }
      if (!ok) { r.thanked = true; r.lost = true; persist(); return { lost: true }; }
      // 구조 보답: 요청자가 게임을 그만둬도 받을 수 있게 바로 준다 (감사 편지는 따로)
      r.claimed = true;
      const rdg = dungeonById(r.dungeon), rlv = rdg?.lv?.[1] || r.me?.lv || 20;
      const item = rollMega('rescue', rlv, rdg) || weighted(rewardPool(rlv, rdg)), money = 50 + (r.floor || 5) * 15;
      storeAdd(item); save.money += money; persist();
      return { ok: true, html: `구조 보답: ${ITEMS[item].icon} <b>${esc(ITEMS[item].n)}</b> (창고로) · ₽${money}` };
    } catch (e) { console.warn(e); return { error: true }; }
    finally { claimingNow.delete(doc); }
  }
  let lastCheck = 0, checking = false;
  let sosRelinked = false;
  const claimFailed = new Set();
  const thxChecked = new Map(), THX_CHECK_MS = 15 * 60 * 1000;   // 감사 편지를 마지막으로 확인한 시각 (이번 접속 동안)   // 구조 완료를 서버가 거절한 요청 (이번 접속 동안은 다시 보내지 않는다)
  async function checkOnline(force) {
    if (idle || !save || !bound || !Online.loggedIn() || checking || (!force && Date.now() - lastCheck < 90 * 1000)) return;
    checking = true; lastCheck = Date.now();
    try {
      await flushThanks();
      const s = save.sos;
      // 게시판에 올린 표시가 세이브에서 빠진 요청 (예전 클라우드 동기화 버그): 서버에서 내 요청을 찾아 다시 잇는다 (접속마다 한 번)
      if (s && !s.online && !s.revived && !sosRelinked) {
        sosRelinked = true;
        const docId = await Online.findMySOS(s.id);
        if (docId) { s.docId = docId; s.online = true; persist(); }
      }
      if (s && s.online && !s.revived) {
        const myId = s.docId || s.id;
        const d = sosWatch && sosWatchId === myId && sosLast !== undefined ? sosLast : await Online.getSOS(myId);   // 지켜보는 중이면 따로 읽지 않는다
        // 서버의 값은 다른 사람이 쓴 것이라 숫자·이름을 다시 확인한다 (조작된 값이 화면에 그대로 들어가지 않게)
        // 구조한 사람의 포켓몬이 이 버전에 없어도 (더 새 버전에서 구조) 부활은 시킨다. 그림만 내 포켓몬으로
        const rs = d && d.rescuer;
        if (d && d.status === 'rescued' && rs) {
          const known = hasKey(DATA.species, rs.sp);
          await receiveAOK({ id: s.id, sp: known ? +rs.sp : s.sp, lv: clamp(Math.floor(+rs.lv) || 1, 1, MAX_LEVEL), sh: known && rs.shiny ? 1 : 0, noGift: rs.noGift === true }, Online.cleanName(rs.name));
        } else if (d && d.status === 'open' && sosLeft(s) <= 0) {
          failSOS(s);
        } else if (d && d.status === 'open') {
          // 다른 탐험대가 구조하러 갔는지 (맡은 지 30분이 지나면 다시 게시판으로, 구조 중이면 연장됨)
          const at = d.takenBy && d.takenAt && d.takenAt.toMillis ? d.takenAt.toMillis() : 0;
          const taken = at && at > Date.now() - SOS_HOLD_MS ? at : null;
          if (taken && !s.takenAt) UI.toast('🏃 다른 탐험대가 구조하러 출발했어요!');
          if ((s.takenAt || null) !== taken) { s.takenAt = taken; persist(); }
          setTimeout(() => autoRescue(s), 0);
        } else if (!d && sosLeft(s) <= 0) {
          failSOS(s);
        } else if (!d) {   // 요청이 서버에서 사라짐: 게시판으로는 더 기다릴 수 없다 (코드로 구조받거나 포기)
          s.online = false; persist();
          UI.alert('🆘 구조 요청', '<p>구조 게시판에서 내 구조 요청을 찾을 수 없어요. 임무 탭에서 SOS 코드를 친구에게 보내거나, 포기하고 돌아갈 수 있어요.</p>');
        }
      }
      for (const [id, r] of Object.entries(save.rescued || {})) {
        if (!r.online || r.thanked) continue;
        const doc = r.docId || id;
        if (!r.claimed) {
          if (claimFailed.has(doc) || claimingNow.has(doc)) continue;   // 이번 접속에서 서버가 거절함 / 던전에서 지금 전하는 중
          const c = await claimRescueOne(id, r);
          if (c.ok) UI.alert('✅ 구조 완료', `<div class="center">${portraitImg(r.sp, 'portrait big', 'Joyous', r.shiny)}</div>
              <p class="center">${esc(spName(r.sp))}의 구조 완료를 요청자에게 전했어요!</p>
              <p class="center">${c.html}</p><p class="center dim">요청자가 감사 편지를 보내면 선물이 더 올 수도 있어요.</p>`);
          else if (c.lost) UI.toast(`${spName(r.sp)}: 다른 탐험대가 먼저 구조했거나 요청이 취소됐어요.`);
          else if (c.denied) UI.alert('구조 완료를 전하지 못했어요', `<p>${esc(c.msg)}</p><p class="dim">닉네임 문제라면 계정 창에서 닉네임을 바꾼 뒤 새로고침하면 다시 전해요.</p>`);
          continue;
        }
        if (Date.now() - (thxChecked.get(doc) || 0) < THX_CHECK_MS) continue;   // 감사 편지 확인: 접속마다 한 번, 그 뒤 15분마다 (v0.96)
        thxChecked.set(doc, Date.now());
        const d = await Online.getSOS(doc);
        if (!d) { r.thanked = true; persist(); continue; }
        if (d.status === 'thanked') {
          await gotThanks(r, hasKey(ITEMS, d.thx) && d.thx !== 'quest' ? d.thx : null, Online.cleanName(d.name));
          Online.deleteSOS(doc).catch(() => {});   // 다 쓴 요청은 지운다
        }
      }
    } catch (e) { console.warn('구조 게시판 확인 실패', e); }
    finally { checking = false; }
    if (tab === 'mission' && document.getElementById('town-screen').classList.contains('active') && !UI.isOpen()) renderTown();
  }
  // 감사 편지는 보낼 때 실패해도 다음에 다시 보낸다
  async function flushThanks() {
    const q = save.thxQueue || [];
    while (q.length) {
      try { await Online.thankSOS(q[0].id, q[0].item); } catch (e) { if (!/not-found|permission/.test(e.code || '')) throw e; }
      q.shift(); persist();
    }
  }

  const ONLINE_RESCUE_MAX = 2;   // 게시판 구조 임무는 한 번에 이만큼 (한 사람이 요청을 다 가져가지 않게)
  async function starterRank() {
    let r;
    try { r = await Online.starterRanks(); } catch (e) { UI.alert('🏆 스타팅 순위', `<p>${esc(Online.why(e))}</p>`); return; }
    const list = Object.entries(r.c).map(([sp, n]) => [+sp, +n || 0]).filter(([sp, n]) => n > 0 && hasKey(DATA.species, sp)).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const total = list.reduce((t, [, n]) => t + n, 0);
    let rank = 0, prev = -1;
    const rows = list.map(([sp, n], i) => { if (n !== prev) { rank = i + 1; prev = n; }
      return `<div class="row">${rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : `<b class="num">${rank}</b>`} ${portraitImg(sp, 'portrait sm')}<span class="grow"><b>${esc(spName(sp))}</b></span><span>${n}명 <span class="dim">(${Math.round(n * 100 / total)}%)</span></span></div>`; }).join('');
    UI.alert('🏆 스타팅 순위', `${total ? `<p class="dim">전체 ${list.length}종</p><div class="rank-list">${rows}</div>` : '<p>아직 집계된 탐험대가 없어요.</p>'}
      <p class="dim tiny">총 ${total}명 · ${esc(r.day)} 기준 (하루에 한 번 갱신) · 로그인한 탐험대가 처음 고른 포켓몬만 세요 (v0.33부터 시작한 탐험대).</p>`);
  }

  async function sosBoard() {
    if (!Online.loggedIn()) return accountDialog();
    let list;
    try { list = await Online.listSOS(); } catch (e) { UI.alert('📋 구조 게시판', `<p>${esc(Online.why(e))}</p>`); return; }
    list = list.filter(s => dungeonById(s.dungeon) && hasKey(DATA.species, s.sp) && Number.isInteger(s.floor) && Number.isInteger(s.lv) && s.lv >= 1 && s.lv <= MAX_LEVEL)
      .map(s => ({ ...s, sp: +s.sp, name: Online.cleanName(s.name), created: +s.created || Date.now(), floor: Math.min(+s.floor || 1, dungeonById(s.dungeon)?.floors || 99) }));   // 층수가 줄어든 던전의 예전 요청은 마지막 층으로 보인다
    const taken = sid => !!((save.rescued || {})[sid] || save.missions.accepted.some(m => m.sosId === sid));
    const ago = t => { const mnt = Math.max(1, Math.round((Date.now() - t) / 60000)); return mnt < 60 ? `${mnt}분 전` : mnt < 1440 ? `${Math.round(mnt / 60)}시간 전` : `${Math.round(mnt / 1440)}일 전`; };
    const rows = list.map(s => {
      const dg = dungeonById(s.dungeon), ok = unlocked(dg), got = taken(s.sid);
      const secret = dg.hidden && !ok;   // 아직 못 찾은 숨은 던전은 이름과 여는 법을 가린다
      return `<div class="row">${portraitImg(s.sp, 'portrait sm', 'Pain', s.shiny)}<div class="grow"><b>${secret ? '✨ 숨은 던전' : esc(dg.n)} ${s.floor}F</b> · ${esc(s.name)} 님의 ${esc(spName(s.sp))} Lv${s.lv}
        <div class="dim">${ago(s.created)}${ok ? '' : secret ? ' · 🔒 아직 찾지 못한 던전' : ` · 🔒 ${esc(dungeonById(dg.req).n)} 클리어 필요`}</div></div>
        <button class="btn sm" data-sos="${esc(s.id)}" ${!ok || got ? 'disabled' : ''}>${got ? '받음' : '구조하러 간다'}</button></div>`;
    });
    UI.open({
      title: '📋 구조 게시판', wide: true,
      html: `<p class="dim">구조 요청 중 가장 오래 기다린 ${list.length || ''}건. 누가 구조하러 가면 30분 동안 다른 사람에게는 보이지 않아요 (구조하러 던전에 들어가 있는 동안은 연장).
        구조 임무는 한 번에 ${ONLINE_RESCUE_MAX}개까지 받을 수 있어요.</p>${rows.join('') || '<p>지금은 구조를 기다리는 탐험대가 없어요.</p>'}`,
      choices: [{ label: '🔄 새로고침', fn: sosBoard }, { label: '닫기', fn: () => {} }],
      onOpen: (box, m) => box.querySelectorAll('[data-sos]').forEach(b => { b.onclick = () => {
        const s = list.find(x => x.id === b.dataset.sos); if (!s) return;
        UI.close(m);
        acceptSOS({ id: s.sid, dg: DUNGEONS.findIndex(d => d.id === s.dungeon), fl: s.floor, sp: s.sp, lv: s.lv, sh: s.shiny ? 1 : 0 }, s.name, s.id);
      }; }),
    });
  }

  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    if (id !== 'town-screen') TownScene.stop();   // 마을 풍경은 마을에서만 그린다
  }

  // ───────────────────────── 시작 화면 ─────────────────────────
  function boot() {
    Dungeon.init();
    save = load();
    if (save) fitFloors(save);
    if (Tiles.CUSTOM && save && save.settings.useTileset === true) Tiles.probe();   // 타일셋을 켠 경우만 미리 확인 (끄면 tiles/ 요청도 하지 않는다)
    if (save && !newerSave) persist();
    if (save) applyPad();   // 마을을 거치지 않고 이어하던 던전으로 바로 들어가도 터치 조작이 켜지게
    setTimeout(checkUpdate, 3000); setInterval(checkUpdate, 10 * 60 * 1000);
    // 플레이 시간 (v0.69부터): 창이 보이는 동안만 센다. 메모리에서 늘리고 다른 저장 때·창을 닫을 때 함께 저장된다
    let playTick = performance.now();
    setInterval(() => { const t = performance.now(), dt = Math.min(60, (t - playTick) / 1000); playTick = t; if (save && !document.hidden) save.playSec = (save.playSec || 0) + dt; }, 15000);
    document.addEventListener('visibilitychange', () => { playTick = performance.now(); if (document.hidden) persist(); });
    // 다른 탭에 있다가 돌아오면 바로 확인 (1분에 한 번까지). 파일 하나를 읽을 뿐이라 서버(Firebase) 사용량과는 상관없다
    let lastCheckUpd = Date.now();
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastCheckUpd > 60 * 1000) { lastCheckUpd = Date.now(); checkUpdate(); } });
    if (Online.enabled()) {
      document.getElementById('title-acct').innerHTML = '<span class="dim tiny">☁ 온라인 연결 중…</span>';
      onlineBoot = Online.init().then(async ok => {
        if (!ok) { document.getElementById('title-acct').innerHTML = '<span class="dim tiny">☁ 서버에 연결하지 못했어요. 로그인 없이 플레이할 수 있어요.</span>'; return; }
        renderAcct();
        if (Online.loggedIn()) { await syncSave(); refreshTitle(); voteStarter(); voteEnding(); }
        startPresence();
      });
      Online.onChange(() => { renderAcct(); presenceAt = 0; presenceTick(); showOnline(); });
    }
    let starting = false;
    document.getElementById('btn-start').onclick = async () => {
      if (starting) return;
      starting = true;
      if (onlineBoot) await Promise.race([onlineBoot, new Promise(r => setTimeout(r, 5000))]);
      if (syncing) await Promise.race([syncing, new Promise(r => setTimeout(r, CLOUD_WAIT + 2000))]);   // 서버가 대답하지 않아도 들어간다 (v0.96: 한도 초과 날 이어하기가 멈추던 문제)
      starting = false;
      if (newerSave) {
        UI.open({ title: '새 버전이 필요해요', cancel: false,
          html: `<p>이 세이브는 <b>v${esc(newerSave)}</b>에서 저장됐는데, 지금 열린 게임은 옛 버전 <b>v${GAME_VERSION}</b>이에요.</p><p>세이브가 망가지지 않도록 새로고침해서 최신 버전으로 열어 주세요.</p>`,
          choices: [{ label: '새로고침', fn: reloadFresh }] });
        return;
      }
      if (save) enterTown();
      else Starter.begin(sp => { UI.closeAll(); save = newSave(sp); refreshDay(); persist(); enterTown(); voteStarter(); UI.alert('환영합니다!', `<p>${esc(jo(spName(sp), '으로'))} 모험을 시작합니다.</p><p>마을에서 임무를 받고, 상점에서 준비한 뒤 던전으로 떠나 보세요.<br>던전 안에서 <b>O</b> 키로 자동 탐색, <b>Tab</b> 키로 자동 전투를 할 수 있습니다.<br>던전에서 쓰러뜨린 적이 가끔 동료가 되고 싶어 해요. 영입하면 캐릭터를 바꿀 수 있어요.</p>`); },
        (cb, back) => chooseCharacter(cb, true, starterIds(), back));
    };
    refreshTitle();
    const n = SPECIES_IDS.length;
    document.getElementById('title-sub').textContent = `v${GAME_VERSION} · 등장 포켓몬 ${n}종 · 스프라이트 PMD SpriteCollab`;
    // 타이틀 장식
    const deco = document.getElementById('title-deco');
    const ids = SPECIES_IDS;
    for (let i = 0; i < 7; i++) deco.insertAdjacentHTML('beforeend', portraitImg(pick(ids), 'deco'));
    show('title-screen');
    Sound.title();
  }

  // ───────────────────────── 마을 ─────────────────────────
  // 창고에 남아 있는 자동 판매 아이템을 한 번 판다 (v0.72 이전에 '남겨 둔다'를 골랐거나 다른 길로 들어온 것. 그 뒤로 직접 산 물건은 남긴다)
  function sweepAutoSell() {
    if (save.autoSellV72) return;
    save.autoSellV72 = true;
    for (const id of save.autoSell || []) { const n = save.storage[id] || 0; if (n > 0 && ITEMS[id]) { delete save.storage[id]; storeDeposit(id, n); } }
  }
  // 모든 탐험대에게 주는 선물 (js/defs.js GLOBAL_GIFTS)
  function claimGlobalGifts() {
    if (!save || save.day < 2 || UI.isOpen()) return;
    const got = save.giftsGot = save.giftsGot || [], today = Progress.today();
    const list = GLOBAL_GIFTS.filter(g => !got.includes(g.id) && today <= g.until);
    if (!list.length) return;
    const lines = [];
    for (const g of list) {
      got.push(g.id);
      const parts = g.items.filter(([id]) => ITEMS[id]).map(([id, n]) => { storeKeep(id, n); return `${ITEMS[id].icon} <b>${esc(ITEMS[id].n)}</b>${n > 1 ? ' ×' + n : ''}`; });
      if (g.money) { save.money += g.money; parts.push(`₽${g.money}`); }
      lines.push(`<p>${esc(g.note)}</p><p>${parts.join(' · ')} <span class="dim">(창고로)</span></p>`);
    }
    persist(); renderTown(); Sound.fanfare('reward', 'achieve');   // 팡파르 곡: music/reward (없으면 합성 효과음)
    UI.alert('🎁 선물이 도착했어요', lines.join('<hr>'));
  }
  // 터치 기기에서 처음 한 번: 조작 방식을 고른다 (조이스틱이 생긴 것을 모를 수 있어서, v0.83)
  function askPadMode() {
    if (!save || save.settings.padModeAsked || !touchDevice() || touchCtl() === 'off') return;
    if (UI.isOpen()) { setTimeout(askPadMode, 1500); return; }   // 다른 창(탐험 재개 등)이 닫히면 묻는다
    save.settings.padModeAsked = true; persist();
    const pick = m => { setSetting('padMode', m); UI.toast(m === 'stick' ? '조이스틱 + ABXY로 조작합니다.' : '방향 버튼 + 아래 버튼(예전 방식)으로 조작합니다.'); };
    UI.open({
      title: '📱 터치 조작 방식', cancel: false,
      html: `<p>던전에서 쓸 조작 방식을 골라 주세요. <span class="dim">(나중에 설정에서 언제든 바꿀 수 있어요)</span></p>
        <div class="row"><b class="grow">🕹 조이스틱 + ABXY <span class="tag">새로 나옴</span></b></div>
        <p class="dim">아래 조작 영역의 조이스틱을 끌어 8방향으로 걷고, A 공격(길게 누르면 기술) · B 자동 · X 행동 메뉴 · Y 조사. 크기·위치를 바꿀 수 있어요.</p>
        <div class="row"><b class="grow">✛ 방향 버튼 + 아래 버튼 <span class="tag">예전 방식</span></b></div>
        <p class="dim">게임 화면 위의 3×3 방향 버튼과 아래의 공격·자동·가방 등 버튼으로 조작해요.</p>`,
      choices: [{ label: '🕹 조이스틱 + ABXY', fn: () => pick('stick') }, { label: '✛ 방향 버튼 (예전 방식)', fn: () => pick('dpad') },
        { label: '⌨ 터치 조작 끄기', fn: () => { setSetting('touchCtl', 'off'); UI.toast('터치 조작을 껐습니다. 설정에서 다시 켤 수 있어요.'); } }],
    });
  }
  function enterTown() {
    applyPad();
    if (save) sweepAutoSell();
    if (save) setTimeout(claimGlobalGifts, 400);
    if (save) setTimeout(() => Story.check(), 1000);   // 이야기 (js/story.js, js/scenes.js)
    if (save) setTimeout(checkRankUp, 1300);
    if (save) setTimeout(checkMegaGift, 1600);
    Gfx.preload(() => { if (!Dungeon.run) renderTown(); });
    if (save) setTimeout(askPadMode, 900);   // 원작 아이템 아이콘: 처음 불러오면 마을 화면을 다시 그린다
    show('town-screen');
    checkUpdate();
    Sound.town();
    if (Progress.check().length) persist();
    if (!save.shop.length || !save.missions.board.length) refreshDay();
    renderTown();
    checkOnline();
    if (save.run) {
      const r = save.run;
      UI.open({
        title: '탐험 재개', html: `<p>${esc(dungeonById(r.dungeon).n)} ${r.floor}F 탐험이 중단되어 있습니다.</p><p>이어서 하면 해당 층의 처음부터 다시 시작합니다.</p>`,
        choices: [{ label: '이어서 탐험한다', fn: resumeRun }, { label: '포기한다 (쓰러진 것으로 처리)', fn: () => { abandonSavedRun(); } }],
        cancel: false,
      });
    }
  }
  // 이미 들어가 본 던전은 열리는 순서가 바뀌어도 계속 열려 있다
  const unlocked = dg => dg.mode === 'rogue' || !dg.req || !!save.cleared[dg.req] || !!save.cleared[dg.id] || !!save.best[dg.id];

  function refreshDay() {
    rollShop();
    const board = [];
    for (let i = 0; i < boardSize(); i++) { const m = genMission(); if (m) board.push(m); }   // 탐험대 등급에 따라 의뢰 수가 다르다
    save.missions.board = board;
  }
  // 마을 상점 진열: 하루에 한 번, 또는 돈을 내고 새로고침
  function rollShop() {
    // 늘 있는 물건(SHOP_FIXED)은 진열 위에 따로 보여준다. 여기서는 날마다 바뀌는 8칸
    const stock = new Set();
    const pool = SHOP_POOL.filter(i => !SHOP_FIXED.includes(i));
    while (stock.size < 8) stock.add(pick(pool));
    const held = HELD_SHOP_POOL.slice().sort(() => Math.random() - 0.5).slice(0, 3);
    if (Math.random() < SIG_SHOP_CHANCE) held.push(pick(SIG_ITEMS));   // 전용 도구는 가끔 하나
    // 기술머신 SHOP_TM_N개: 고른 분류(변화·물리·특수)가 있으면 그 분류에서만
    const cat = SHOP_TM_CAT[save.tmFocus];
    const tms = TM_IDS.filter(id => !cat || DATA.moves[ITEMS[id].mv].c === cat).sort(() => Math.random() - 0.5).slice(0, SHOP_TM_N);
    const vit = Math.random() < 0.35 ? [pick(Object.keys(VITAMINS))] : [];
    const abi = [Math.random() < 0.4 ? 'abcapsule' : null, Math.random() < 0.4 ? 'eggtm' : null, Math.random() < 0.15 ? 'abpatch' : null].filter(Boolean);
    // 구미: 가끔 하나 (무지개구미는 아주 가끔)
    const gum = [Math.random() < 0.2 ? pick(Object.keys(GUMMIES).filter(id => id !== 'rainbowgummy')) : null, Math.random() < 0.02 ? 'rainbowgummy' : null].filter(Boolean);
    save.shop = [...stock, ...held, ...tms, ...vit, ...abi, ...gum];
    save.shopBought = {};
  }
  const SHOP_TM_N = 3, SHOP_TM_CAT = { status: 1, phys: 2, spec: 3 };   // 오늘의 진열 기술머신 수 (v0.83에 2 → 3), 분류 → 기술 분류 번호
  // 오늘의 진열에서 이 물건을 몇 번 더 살 수 있나 (늘 파는 물건은 제한 없음)
  const shopLeft = id => shopFixedFor(save).includes(id) ? Infinity : ((save.shopBought || {})[id] ? 0 : 1);

  // 게시판에서 고른 "자주 뜨는 지역": 새 의뢰의 30~50%쯤이 그 던전에서 (MISSION_FOCUS_RATE, v0.69에 50% → 40%)
  // 받을 수 있는 임무 수·게시판 의뢰 수: 탐험대 등급에 따라 (js/defs.js RANK_MISSION_MAX, RANK_BOARD, v0.91)
  const MISSION_FOCUS_RATE = 0.4;
  const missionMax = () => RANK_MISSION_MAX[rankLv()], boardSize = () => RANK_BOARD[rankLv()];
  const focusDungeon = () => { const d = save.missionFocus && dungeonById(save.missionFocus); return d && d.mode === 'normal' && unlocked(d) ? d : null; };
  function genMission() {
    const dgs = DUNGEONS.filter(d => d.mode === 'normal' && unlocked(d));
    const fd = focusDungeon();
    const dg = fd && Math.random() < MISSION_FOCUS_RATE ? fd : pick(dgs);
    const tier = dungeonTier(dg);
    let floor = rint(Math.min(2, dg.floors - 1), Math.max(1, dg.floors - 1));
    while (floor > 1 && isBossFloor(dg, floor)) floor--;
    const kind = pick(['rescue', 'outlaw', 'find']);
    const ids = SPECIES_IDS.filter(id => !DATA.species[id].lg);
    const client = +pick(ids);
    const prog = (floor - 1) / Math.max(1, dg.floors - 1);
    const lvl = Math.round(dg.lv[0] + (dg.lv[1] - dg.lv[0]) * prog);
    const rk = rankLv();
    const reward = Math.round((80 + floor * 35) * (1 + tier * 0.8) * MISSION_MONEY_MUL * (1 + 0.05 * rk) / 20) * 10;   // 탐험대 등급마다 +5%
    const m = { id: Date.now() + '' + rand(1e6), dungeon: dg.id, floor, kind, client, reward, lv: Math.min(MAX_LEVEL, lvl + 3) };
    const item = missionRewardItem(lvl); if (item) m.item = item;   // 의뢰 레벨에 맞는 보상 (js/defs.js)
    if (Math.random() < rankStarRate(rk)) {   // ★우대 의뢰 (골드 랭크부터): 보상 2배 + 더 좋은 물건, 포인트 2배
      m.star = true; m.reward *= 2;
      m.item = missionRewardItem(Math.min(MAX_LEVEL, lvl + 30)) || missionRewardItem(Math.min(MAX_LEVEL, lvl + 30)) || m.item;
    }
    if (kind === 'outlaw') {
      // 그 층에 실제로 나오는 포켓몬 중에서 (컨셉 포켓몬 + 타입에 맞는 포켓몬)
      const fc = Dungeon.floorCandidates(dg, floor);
      const cand = [...new Set([...fc.concept, ...fc.cand.map(o => o.id)])].filter(id => !DATA.species[id].lg);
      m.target = +pick(cand.length ? cand : ids);
    }
    return m;
  }
  // ── 운석 낙하지점 첫 클리어 선물 (v0.91): 원하는 메가스톤 하나. 이미 클리어한 탐험대도 한 번 (save.megaGift = 고른 스톤) ──
  const MEGA_GIFT_DG = 'meteor';
  function checkMegaGift() {
    if (!save || Dungeon.run || !(save.cleared && save.cleared[MEGA_GIFT_DG]) || save.megaGift) return;
    // 이야기(2부 1장: 지라치의 답례)를 본 뒤에 (이야기를 건너뛰어도 본 것으로 기록된다)
    if (UI.isOpen() || Story.busy() || !(save.story && save.story.seen && save.story.seen.p2ch1)) { if ((checkMegaGift.tries = (checkMegaGift.tries || 0) + 1) < 40) setTimeout(checkMegaGift, 1500); return; }
    checkMegaGift.tries = 0;
    megaGiftDialog();
  }
  function megaGiftDialog() {
    const list = MEGA_STONES.filter(id => ITEMS[id]).map(id => ({ id, n: ITEMS[id].n, to: ITEMS[id].formTo })).sort((a, b) => a.n.localeCompare(b.n, 'ko'));
    const have = id => (save.storage[id] || 0) + save.bag.filter(b => b.id === id).reduce((a, b) => a + (b.n || 1), 0) + Object.values(save.roster).filter(c => c.held === id).length;
    Sound.fanfare('bigreward', 'achieve');
    const m = UI.open({
      title: '☄️ 운석의 선물: 메가스톤 고르기', wide: true,
      html: `<p>운석 낙하지점 첫 클리어 기념으로 <b>원하는 메가스톤 하나</b>를 드려요. <span class="dim">(한 번만 · 고르면 바꿀 수 없어요)</span></p>
        <p><input class="mg-search" placeholder="포켓몬·스톤 이름으로 찾기" autocomplete="off"></p>
        <div class="mg-list">${list.map(o => `<button class="btn ghost mg-item" data-mg="${o.id}" data-s="${esc((o.n + ' ' + (o.to ? spName(o.to) : '')).toLowerCase())}">${o.to ? portraitImg(o.to, 'portrait xs') : ''}<span><b>${esc(o.n)}</b><span class="dim">${o.to ? esc(spName(o.to)) : ''}${have(o.id) ? ` · 가지고 있음 ${have(o.id)}` : ''}</span></span></button>`).join('')}</div>`,
      choices: [{ label: '나중에 고르기 (다음에 마을에 오면 다시 물어요)', fn: () => {} }],
      onOpen: box => {
        const q = box.querySelector('.mg-search');
        q.addEventListener('input', () => { const v = q.value.trim().toLowerCase(); box.querySelectorAll('.mg-item').forEach(b => { b.hidden = !!v && !b.dataset.s.includes(v); }); });
        box.querySelector('.mg-list').addEventListener('click', async e => {
          const b = e.target.closest('[data-mg]'); if (!b) return;
          const id = b.dataset.mg;
          if (!(await UI.confirm('메가스톤 고르기', `<p>${Gfx.iconHtml(id)} <b>${esc(ITEMS[id].n)}</b>로 할까요?</p><p class="dim">한 번만 고를 수 있어요.</p>`, '이걸로 한다', '다시 고른다'))) return;
          if (save.megaGift) return;
          save.megaGift = id; storeKeep(id); persist(); UI.close(m); renderTown();
          Sound.fanfare('reward', 'achieve');
          UI.alert('☄️ 운석의 선물', `<p>${Gfx.iconHtml(id)} <b>${esc(jo(ITEMS[id].n, '을'))}</b> 받았어요! <span class="dim">(창고로)</span></p><p class="dim">${esc(ITEMS[id].d)}</p>`);
        });
      },
    });
  }
  // ── 탐험대 등급 (v0.91, 등급표·혜택은 js/defs.js RANKS) ──
  function rankState() {
    if (!save.rank) {   // 처음 한 번: 지금까지 완료한 임무로 시작 포인트 (게시판 임무 20점, 친구 구조 60점). 승급식은 마을에서 한꺼번에
      const resc = Progress.stat('rescues'), board = Math.max(0, Progress.stat('missions') - resc);
      save.rank = { pts: board * 20 + resc * 60, seen: 0 };
    }
    return save.rank;
  }
  const rankLv = () => rankOf(rankState().pts);
  // 임무 하나의 포인트: 깊은 층·어려운 던전일수록 많이. 수배 1.5배, 친구 구조 3배, ★우대 2배
  function missionRankPts(m) {
    const dg = dungeonById(m.dungeon), tier = dg ? dungeonTier(dg) : 0;
    let p = (5 + (m.floor || 1) / 2) * (1 + tier * 0.3);
    if (m.kind === 'outlaw') p *= 1.5;
    if (m.kind === 'sos') p *= 3;
    if (m.star) p *= 2;
    return Math.max(1, Math.round(p));
  }
  function addRankPts(m, lines) { const p = missionRankPts(m); rankState().pts += p; lines.push(`🏅 탐험대 포인트 +${p}`); }
  const rankBadge = (r = rankLv()) => `<span class="rank-badge r${r}" title="탐험대 등급">${RANKS[r][1]} ${RANKS[r][0]} 랭크</span>`;
  function rankSection() {
    const st = rankState(), r = rankOf(st.pts), nx = RANKS[r + 1];
    const pct = nx ? clamp((st.pts - RANKS[r][2]) / (nx[2] - RANKS[r][2]) * 100, 0, 100) : 100;
    return `<h3>🏅 탐험대 등급</h3><div class="row rank-row"><span class="grow">${rankBadge(r)} <b>${st.pts}</b>점
      ${nx ? `<span class="dim">· 다음 ${nx[1]} ${nx[0]}까지 ${nx[2] - st.pts}점</span>` : '<span class="dim">· 최고 등급!</span>'}
      <span class="bar rank-bar"><i style="width:${pct}%"></i></span>
      <span class="dim">혜택: 게시판 의뢰 ${RANK_BOARD[r]}개 · 진행 임무 ${RANK_MISSION_MAX[r]}개 · 임무 보상 돈 +${r * 5}%${r >= RANK_STAR_FROM ? ` · ★우대 의뢰 ${Math.round(rankStarRate(r) * 100)}%쯤` : ` · ${RANKS[RANK_STAR_FROM][0]} 랭크부터 ★우대 의뢰`}</span>
      <span class="dim">임무를 완료하면 포인트가 쌓여요. 깊은 층·어려운 던전일수록, 수배는 1.5배, 친구 구조는 3배!</span></span></div>`;
  }
  // 승급식: 마을에서 (창이 열려 있으면 닫힌 뒤). 선물은 장면 전에 먼저 넣고 저장한다 (중간에 새로고침해도 두 번 받지 않게)
  async function checkRankUp() {
    if (!save || Dungeon.run) return;
    const st = rankState(), r = rankOf(st.pts);
    if (r <= st.seen) return;
    if (UI.isOpen() || Story.busy()) { setTimeout(checkRankUp, 1500); return; }
    if (Story.pending()) { Story.check(); setTimeout(checkRankUp, 1500); return; }   // 볼 이야기가 남았으면 이야기 먼저
    const from = st.seen, parts = [];
    st.seen = r;
    for (const g of RANKS.slice(from + 1, r + 1).map(x => x[3]).filter(Boolean)) {
      for (const [id, n] of g.items) if (ITEMS[id]) { storeKeep(id, n); parts.push(`${ITEMS[id].icon} <b>${esc(ITEMS[id].n)}</b>${n > 1 ? ' ×' + n : ''}`); }
      if (g.money) save.money += g.money;
    }
    const money = RANKS.slice(from + 1, r + 1).reduce((a, x) => a + ((x[3] && x[3].money) || 0), 0);
    persist(); renderTown();
    const nx = RANKS[r + 1];
    await Story.play(rankScene(from, r), { bgm: 'wigglytuff', vars: { 탐험대: Story.teamLabel(), 랭크: RANKS[r][0], 포인트: st.pts, 다음: nx ? nx[2] - st.pts : 0 } });
    // 승급 창 (music/rankup) → 승급 선물 창 (music/bigreward)
    Sound.fanfare('rankup', 'achieve');
    await UI.alert(`${RANKS[r][1]} ${RANKS[r][0]} 랭크로 승급!`, `<p class="center">${rankBadge(r)}</p>
      <p class="center">혜택: 게시판 의뢰 ${RANK_BOARD[r]}개 · 진행 임무 ${RANK_MISSION_MAX[r]}개 · 임무 보상 돈 +${r * 5}%${r >= RANK_STAR_FROM ? ' · ★우대 의뢰' : ''}</p>`, '승급 선물 받기');
    Sound.fanfare('bigreward', 'achieve');
    UI.alert('🎁 승급 선물', `<p>${parts.join(' · ')}${money ? ` · ₽${money}` : ''}</p><p class="dim">물건은 창고에 넣어 두었어요.</p>`);
  }
  // 승급식 대사 (푸크린 길드: 길드장 푸크린, 조수 페라페)
  function rankScene(from, r) {
    const last = r === RANKS.length - 1;
    return [
      [40, 'Joyous', '친구친구~! 다들 모여 봐~!'],
      [441, 'Normal', '에헴! 지금부터 탐험대 승급식을 시작하겠다!'],
      r - from > 1 ? [441, 'Surprised', '그동안 {리더|이} 해낸 의뢰를 세어 봤더니… 이, 이렇게나 많았단 말인가?!']
        : [441, 'Normal', '{탐험대|가} 의뢰를 열심히 해낸 덕분에 탐험대 포인트가 {포인트}점이 되었다!'],
      [40, 'Happy', '그래서~ 오늘부터 {랭크} 랭크야~! 축하해 친구친구~!'],
      last ? [441, 'Crying', '마, 마스터 랭크라니… 우리 길드의 자랑이다! 흐윽… 승급 선물은 창고에 넣어 두었다!']
        : [441, 'Happy', '승급 선물은 창고에 넣어 두었다! 다음 랭크까지 {다음}점, 방심하지 말도록!'],
      [40, 'Joyous', '앞으로도 잘 부탁해~! 야아앗~!!'],
    ];
  }
  // 임무가 있는 층에 들어왔을 때 알림 창
  function missionAlert(list) {
    UI.open({
      title: '📜 이 층에 임무가 있어요!',
      html: list.map(m => `<div class="row">${portraitImg(m.kind === 'outlaw' ? m.target : m.client, 'portrait sm', m.kind === 'sos' ? 'Pain' : 'Normal', !!m.shiny)}
        <div class="grow">${missionText(m)}<div class="dim">보상 ${rewardText(m)}</div></div></div>`).join('')
        + '<p class="dim">임무 확인(J)으로 언제든 다시 볼 수 있어요.</p>',
      choices: [{ label: '알겠다', fn: () => {} }],
    });
  }
  const missionText = m => (m.star ? '<b class="star-mission" title="탐험대 등급 혜택: 보상 2배 + 좋은 물건, 탐험대 포인트 2배">★우대</b> ' : '') + missionBody(m);
  function missionBody(m) {
    const dg = dungeonById(m.dungeon);
    if (m.kind === 'sos') return `<b>🆘 ${m.online ? '탐험대 구조' : '친구 구조'}</b> ${esc(dg.n)} ${m.floor}F에서 쓰러진 ${m.from ? esc(m.from) + ' 님' : '친구'}의 Lv${m.lv} ${esc(jo(spName(m.client), '을'))} 구해 주세요.`;
    // 앞부분에 늘 '던전 층'이 오게 (한눈에 지역이 보이게)
    if (m.kind === 'rescue') return `<b>구조</b> ${esc(dg.n)} ${m.floor}F에서 길을 잃은 ${esc(jo(spName(m.client), '을'))} 구해 주세요.`;
    if (m.kind === 'outlaw') return `<b>수배</b> ${esc(dg.n)} ${m.floor}F에 숨은 Lv${m.lv} ${esc(jo(spName(m.target), '을'))} 쓰러뜨려 주세요.`;
    return `<b>탐색</b> ${esc(dg.n)} ${m.floor}F에서 떨어뜨린 물건을 ${esc(jo(spName(m.client), '이'))} 찾고 있어요.`;
  }
  // 임무 정렬: 받은 순서(그대로) / 층수 (던전 → 층 순서)
  const dgOrder = id => DUNGEONS.findIndex(d => d.id === id);
  const sortMissions = list => save.missionSort === 'floor' ? list.slice().sort((a, b) => dgOrder(a.dungeon) - dgOrder(b.dungeon) || a.floor - b.floor) : list;
  const rewardText = m => m.kind === 'sos' ? `₽${m.reward} + ${m.online ? '구조 보답(무작위 아이템·돈)' : 'A-OK 코드'}` : `₽${m.reward}${m.item ? ` + ${ITEMS[m.item].icon}${ITEMS[m.item].n}` : ''}`;

  let ccOpen = null;   // 휴대폰에서 캐릭터 카드를 펼쳐 두었는지
  // ── 탭마다 맞아 주는 포켓몬 (말풍선 한 줄, 날마다 바뀐다. 누르면 다음 말) ──
  const HOSTS = {
    // 푸크린: 해맑은 길드장 (친구친구~) · 페라페: 깐깐한 조수 (에헴, ~하도록!) — 이야기(js/scenes.js)의 말투와 같게
    dungeon: [40, '푸크린', ['친구친구~! 오늘은 어디로 탐험 갈 거야~?', '던전은 들어갈 때마다 모양이 바뀌어~ 그래서 매일 새롭고 재밌지~!', '출발하기 전에 가방 확인~! 사과 챙겼어~? 나는 벌써 다 먹었어~', '동료랑 같이 가면 훨씬 든든해~ 친구는 많을수록 좋은걸~!', '돌아오면 꼭 얘기해 줘~! 야아앗~!!']],
    mission: [441, '페라페', ['에헴! 의뢰 게시판이다. 오늘도 새 의뢰가 잔뜩 붙어 있다!', '임무를 받아 두면 그 층에서 대상을 만날 수 있다. 받은 임무는 끝까지 해내도록!', '의뢰를 해내면 탐험대 포인트가 쌓인다. 랭크가 오르면 받을 수 있는 임무도 늘지!', '구조를 기다리는 탐험대도 있다! 길드의 이름을 걸고 구하러 가도록!', '수배범은 만만치 않다. 방심하지 말도록! …길드장님처럼 사과만 생각하면 곤란하다.']],
    shop: [352, '켈리몬', ['어서 오세요! 켈리몬 상점입니다~', '진열은 날이 바뀌면 새로 바뀌어요~', '필요 없는 물건은 팔아도 괜찮아요~']],
    storage: [115, '캥카', ['맡길 물건이 있나요? 소중히 보관해 둘게요.', '가방이 가득 차면 여기에 맡겨 두세요.', '자동 판매를 켜 두면 필요 없는 물건은 바로 팔아 드려요.']],
    bag: [113, '럭키', ['가방 정리는 탐험의 기본이에요!', '회복 아이템은 넉넉히 챙겨 가세요!', '빠른사용에 자주 쓰는 아이템을 등록해 두면 편해요.']],
    char: [178, '네이티오', ['……더 강해질 수 있어…… 느껴져……', '기술과 지닌 물건을 바꿔 보는 것도 좋아.', '진화의 때가 오면…… 알 수 있을 거야.']],
    dex: [479, '로토무', ['만난 포켓몬이 늘어날수록 도감이 채워져요!', '분류로 전설·환상 포켓몬만 찾아볼 수도 있어요!', '아직 못 만난 포켓몬도 어딘가에 있어요!']],
    ach: [25, '피카츄', ['피카피카! 업적을 달성하면 선물이 있어!', '조금씩 해 나가면 언젠가 전부 달성할 수 있어!']],
    info: [137, '폴리곤', ['설정과 세이브는 여기서 관리할 수 있어요.', '다른 기기에서 이어 하려면 로그인하거나 세이브를 내보내세요.']],
  };
  let hostTurn = 0;
  function hostBar(t) {
    const h = HOSTS[t]; if (!h || !DATA.species[h[0]]) return '';
    const lines = h[2], line = lines[(save.day + Object.keys(HOSTS).indexOf(t) + hostTurn) % lines.length];
    return `<div class="host" data-act="host-next" title="누르면 다른 말">${portraitImg(h[0], 'portrait sm', 'Happy')}<div class="host-bubble"><b>${esc(h[1])}</b><span>${esc(line)}</span></div></div>`;
  }
  let renderedTab = null;
  function renderTown() {
    // 같은 탭을 다시 그릴 때(팔기·꺼내기 등)는 스크롤 위치를 지킨다 (휴대폰 창고 목록이 맨 위로 올라가던 문제)
    const sameTab = renderedTab === tab, keepY = window.scrollY, keepLists = [...document.querySelectorAll('#tab-content .store-list')].map(e => e.scrollTop);
    if (onlineBoot) presenceTick();   // 마을에 오면 접속자 수가 오래됐을 때만 다시 센다
    if (bound) watchMySOS();
    if (sosPending) { sosPending = false; checkOnline(true); }
    setTimeout(checkSOSExpiry, 0);
    const sp = save.current, ch = save.roster[sp], d = DATA.species[sp];
    const st = applyBoost(calcStats(sp, ch.lv, 31), ch.boost);
    const need = expFor(ch.lv + 1) - expFor(ch.lv), have = ch.exp - expFor(ch.lv);
    document.getElementById('town-money').textContent = `₽ ${save.money}`;
    document.getElementById('town-day').textContent = `${save.day}일째`;
    // 마을 풍경: 리더와 동료가 길을 걸어 다닌다 (js/townscene.js)
    TownScene.show(document.getElementById('town-scene'), [save.current, ...partyList()].filter(id => save.roster[id]).map(id => ({ id: save.roster[id].form && save.current === id ? save.roster[id].form : id, shiny: !!save.roster[id].shiny })));
    const un = document.getElementById('update-note');
    un.hidden = !updateVer; un.textContent = updateVer ? `🔔 새 버전 v${updateVer} — 눌러서 새로고침` : '';
    document.getElementById('char-card').innerHTML = `
      <div class="cc-top">${portraitImg(sp, 'portrait big', 'Normal', ch.shiny)}
        <div><div class="cc-name">${esc(d.n)} ${medalIcons(sp)}</div><div class="dim">No.${dexNo(sp)} ${esc(d.e)}</div><div>${typeBadges(d.t)}</div><div class="cc-rank">${rankBadge()}</div>
        <div class="cc-lv">Lv <b>${ch.lv}</b></div></div></div>
      <details class="cc-more"${(ccOpen ?? !matchMedia('(max-width: 800px)').matches) ? ' open' : ''}><summary>능력치 · 특성 · 기술 보기</summary>
      <div class="bar-l">EXP <span class="bar"><i style="width:${ch.lv >= MAX_LEVEL ? 100 : clamp(have / need * 100, 0, 100)}%;background:#6cf"></i></span></div>
      <table class="stats">
        <tr><td>HP</td><td>${st.maxhp}</td><td>공격</td><td>${st.atk}</td></tr>
        <tr><td>방어</td><td>${st.def}</td><td>특공</td><td>${st.spa}</td></tr>
        <tr><td>특방</td><td>${st.spd}</td><td>스피드</td><td>${st.spe}</td></tr></table>
      <div class="cc-ability">지닌 물건 ${ch.held ? `${ITEMS[ch.held].icon} <b>${esc(ITEMS[ch.held].n)}</b>` : '<span class="dim">없음</span>'}</div>
      <div class="cc-ability">특성 <span class="ab-link" data-ability="${entryAbility(sp, ch)}">${esc(abilityName(entryAbility(sp, ch)))}</span></div>
      <div class="cc-moves">${ch.moves.map(m => `<div class="move-row clickable" data-move="${m}" data-sp="${sp}" title="클릭하면 기술 설명">${moveLine(m)}${masteryStar(sp, m)}</div>`).join('') || '<div class="dim">배운 기술이 없습니다</div>'}</div></details>
      ${partyCard()}`;
    const det = document.querySelector('#char-card .cc-more'); det.ontoggle = () => { ccOpen = det.open; };
    document.querySelectorAll('#town-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    const el = document.getElementById('tab-content');
    el.innerHTML = hostBar(tab) + ({ dungeon: tabDungeon, mission: tabMission, shop: tabShop, storage: tabStorage, bag: tabBag, char: tabChar, dex: Dex.render, ach: Progress.renderAch, info: tabInfo })[tab]();
    if (tab === 'dex') Dex.wire(el);
    if (sameTab) { el.querySelectorAll('.store-list').forEach((e, i) => { if (keepLists[i]) e.scrollTop = keepLists[i]; }); if (Math.abs(window.scrollY - keepY) > 1) window.scrollTo(0, keepY); }
    renderedTab = tab;
    if (tab === 'mission') checkOnline();
    el.onclick = e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) onAction(b.dataset.act, b.dataset.arg); };
    document.getElementById('char-card').onclick = el.onclick;   // 캐릭터 카드의 동료 버튼
  }

  const bagSlots = () => save.bag.length;
  function bagAdd(id, n = 1) {
    if (ITEMS[id].stack) { const e = save.bag.find(b => b.id === id); if (e) { e.n += n; return true; } if (bagSlots() >= bagMax()) return false; save.bag.push({ id, n }); return true; }
    if (bagSlots() >= bagMax()) return false;
    save.bag.push({ id, n: 1 }); return true;
  }
  // 창고에 넣기: 자동 판매 아이템은 어떤 길로 들어와도 (의뢰 보상·구조 보답·맡기기 등) 넣지 않고 판다 (v0.72)
  // 직접 사거나 되사거나 지닌 물건을 뺀 것은 storeKeep (팔지 않고 그대로 넣는다)
  const storeKeep = (id, n = 1) => { save.storage[id] = (save.storage[id] || 0) + n; };
  const storeAdd = (id, n = 1) => { storeDeposit(id, n); };
  // 최근에 판 물건 (되사기용, SOLD_LOG_MAX개까지)
  const SOLD_LOG_MAX = 10;
  function logSale(id, n, money, from) { save.soldLog = [{ id, n, money, from }, ...(save.soldLog || [])].slice(0, SOLD_LOG_MAX); }
  const storageUsed = () => storageUsedOf(save.storage);
  const storageRoom = (id, n) => !!ITEMS[id].tm || storageUsed() + (ITEMS[id].stack ? (save.storage[id] ? 0 : 1) : n) <= save.storageMax;
  const itemLabel = id => `${Gfx.iconHtml(id)} <b>${esc(ITEMS[id].n)}</b>`;   // 원작 아이콘이 있으면 그림 (js/gfx.js)

  const DG_TABS = [['normal', '🗺 일반 던전', d => d.mode === 'normal' && !d.theme], ['theme', '👑 테마 던전', d => !!d.theme],
    ['rogue', '🌀 로그라이크', d => d.mode === 'rogue' && !d.daily], ['daily', '🗓 오늘의 도전', d => false], ['hard', '☠ 하드 (테스트 중)', d => false]];
  // ── 포켓몬별 클리어 기록과 메달 (오늘의 도전 제외) ──
  const MEDALS = [
    { k: 'normal', icon: '🎖', n: '일반 던전 정복', d: '일반 던전을 모두 클리어' },
    { k: 'theme', icon: '👑', n: '테마 던전 정복', d: '테마 던전을 모두 클리어' },
    { k: 'rogue', icon: '🌀', n: '로그라이크 정복', d: '로그라이크 던전을 모두 클리어' },
    { k: 'all', icon: '🏆', n: '완전 정복', d: '일반·테마·로그라이크 던전을 모두 클리어' },
  ];
  const medalDungeons = k => DUNGEONS.filter(d => DG_TABS.find(t => t[0] === k)[2](d) && !d.hidden);   // 숨은 던전은 메달에 들어가지 않는다
  // 진화 전 모습의 기록도 합친다 (그 모습을 따로 데리고 있지 않을 때: 예전 세이브는 진화할 때 기록을 옮기지 않았다)
  const clearsOf = sp => {
    const all = save.clears || {};
    let c = { ...all[sp] };
    for (const pre of preEvos(sp)) if (all[pre] && !save.roster[pre]) c = { ...all[pre], ...c };
    return c;
  };
  function medalsOf(sp) {
    const c = clearsOf(sp), got = {};
    for (const k of ['normal', 'theme', 'rogue']) { const list = medalDungeons(k); got[k] = list.length > 0 && list.every(d => c[d.id]); }
    got.all = got.normal && got.theme && got.rogue;
    return MEDALS.filter(m => got[m.k]);
  }
  const medalIcons = sp => medalsOf(sp).map(m => `<span class="medal" title="${esc(m.n)}: ${esc(m.d)}">${m.icon}</span>`).join('');
  // 던전 클리어를 기록하고, 새로 받은 메달을 돌려준다
  function recordClear(sp, dg) {
    if (dg.daily || !DG_TABS.some(t => t[0] !== 'daily' && t[2](dg))) return [];
    const before = medalsOf(sp).map(m => m.k);
    save.clears = save.clears || {};
    save.clears[sp] = { ...(save.clears[sp] || {}), [dg.id]: 1 };
    noteFirst('clear', { dungeon: dg.id });   // 엔딩: 처음 클리어한 던전 (v0.69부터)
    return medalsOf(sp).filter(m => !before.includes(m.k));
  }
  function medalSection(sp) {
    const c = clearsOf(sp), got = medalsOf(sp).map(m => m.k);
    return `<div class="medal-list">${MEDALS.map(m => {
      const list = m.k === 'all' ? DUNGEONS.filter(d => ['normal', 'theme', 'rogue'].some(k => DG_TABS.find(t => t[0] === k)[2](d))) : medalDungeons(m.k);
      const n = list.filter(d => c[d.id]).length;
      return `<div class="medal-row${got.includes(m.k) ? ' got' : ''}"><span class="medal">${m.icon}</span><b>${esc(m.n)}</b> <span class="dim">${esc(m.d)} · ${n}/${list.length}</span></div>`;
    }).join('')}${hardUnlocked(save) ? (() => { const hc = (save.hardClears || {})[sp] || {}, all = hardDungeons(), n = all.filter(d => hc[d.id]).length;
      return `<div class="medal-row${n >= all.length ? ' got' : ''}"><span class="medal">☠</span><b>하드모드</b> <span class="dim">하드모드로 클리어한 일반·테마 던전 · ${n}/${all.length}</span></div>`; })() : ''}</div>`;
  }

  function tabDungeon() {
    const cur = DG_TABS.find(t => t[0] === dgTab) || DG_TABS[0];
    const nav = `<div class="dex-tabs dg-tabs">${DG_TABS.map(([k, n, f]) => {
      const list = DUNGEONS.filter(d => f(d) && !d.hidden), open = list.filter(unlocked).length;
      return `<button class="${k === dgTab ? 'on' : ''}" data-act="dgtab" data-arg="${k}">${n}${list.length ? ` <span class="dim">${open}/${list.length}</span>` : ''}</button>`;
    }).join('')}</div>`;
    // 일반·테마 던전은 열리는 순서대로 (적 레벨 순). 목록 자체의 순서는 SOS 코드 때문에 그대로 둔다
    const byLevel = (a, b) => a.mode === 'rogue' || b.mode === 'rogue' ? 0 : a.lv[0] - b.lv[0] || a.lv[1] - b.lv[1];
    // 숨은 던전은 열린 것만 보인다 (메달 진행도에는 들어가지 않는다)
    const allHere = DUNGEONS.filter(cur[2]).sort(byLevel), hiddenLeft = allHere.filter(d => d.hidden && !unlocked(d)).length;
    const mine = clearsOf(save.current), curList = allHere.filter(d => !d.hidden);
    const shown = allHere.filter(d => !d.hidden || unlocked(d));
    const medal = MEDALS.find(m => m.k === dgTab);
    const progress = dgTab === 'daily' ? '' : `<div class="dg-progress">${portraitImg(save.current, 'portrait xs', 'Normal', save.roster[save.current]?.shiny)} <span><b>${esc(spName(save.current))}</b>${jo(spName(save.current), '으로').slice(spName(save.current).length)} 클리어 <b>${curList.filter(d => mine[d.id]).length}</b>/${curList.length}</span>
      ${medal ? (medalsOf(save.current).some(m => m.k === medal.k) ? `<span class="medal-got">${medal.icon} ${esc(medal.n)}!</span>` : `<span class="dim">· 모두 클리어하면 ${medal.icon} ${esc(medal.n)} 메달</span>`) : ''}</div>`;
    if (dgTab === 'daily') return nav + `<div class="cards">${Progress.dailyCard()}</div>`;
    if (dgTab === 'hard') return nav + hardTabHtml();
    return nav + progress + (hiddenLeft ? `<p class="dim">🔒 아직 찾지 못한 숨은 던전이 ${hiddenLeft}곳 있어요. 던전을 클리어하다 보면 열려요.</p>` : '') + `<div class="cards">${shown.map(dg => {
      const ok = unlocked(dg);
      const ms = save.missions.accepted.filter(m => m.dungeon === dg.id).length;
      const types = dg.types ? typeBadges(dg.types) : '<span class="type" style="background:#777">모든 타입</span>';
      return `<div class="card dg ${dg.mode} ${ok ? '' : 'locked'}" style="--c1:${dg.pal[1]};--c2:${dg.pal[2]}">
        <div class="dg-head"><b>${esc(dg.n)}</b> ${dg.mode === 'rogue' ? '<i class="rogue">로그라이크</i>' : ''}${save.cleared[dg.id] ? '<i class="clear">클리어</i>' : ''}${mine[dg.id] ? `<i class="clear me" title="${esc(jo(spName(save.current), '으로'))} 클리어했다">✔ ${esc(spName(save.current))}</i>` : ''}</div>
        <div class="dim">${dg.floors}층 · 적 Lv ${dg.lv[0]}~${dg.lv[1]}${save.best[dg.id] ? ` · 최고 ${save.best[dg.id]}F` : ''}</div>
        <div>${types}</div>
        ${dg.wx && dg.wx.length ? `<div class="note">날씨: ${dg.wx.map(([w, p]) => `${WEATHERS[w].icon}${WEATHERS[w].n} ${Math.round(p * 100)}%`).join(' · ')}</div>` : ''}
        ${!dg.theme && bossPool(dg).length ? `<div class="note theme">👑 최종 보스 ${bossPool(dg).map(spName).join(' / ')}${bossPool(dg).length > 1 ? ' 중 하나' : ''}${midPool(dg).length ? ` · 중간 보스 ${dg.mid.floors.join(', ')}층` : ''}</div>` : ''}
        ${dg.theme ? `<div class="note theme">👑 ${esc(dg.theme)} — 최종 보스 ${bossPool(dg).map(spName).join(' / ') || '?'}${bossPool(dg).length > 1 ? ' 중 하나' : ''}${midPool(dg).length ? ` · 중간 보스 ${dg.mid.floors.join(', ')}층` : ''}</div>` : ''}
        ${dg.mode === 'rogue' ? `<div class="note">입장 시 Lv${ROGUE_LEVEL}, 가방 초기화 (지닌 물건은 그대로). 나오면 원래대로 돌아갑니다.</div>` : ''}
        ${ms ? `<div class="note ms">📜 진행 중인 임무 ${ms}개</div>` : ''}
        <div class="dg-btns">${sosLocked(dg.id) ? (save.sos.revived   // 구조된 뒤에는 여기서 바로 이어서 탐험 (v0.98: 구조 대기 중으로 막혀 보여서 다시 못 들어간다는 제보)
            ? `<button class="btn" data-act="sos-resume">🆘 ${save.sos.floor}F부터 이어서 탐험</button>`
            : '<button class="btn" disabled title="구조를 받거나 포기하면 다시 들어갈 수 있어요">🆘 구조 대기 중</button>')
          : `<button class="btn" data-act="go" data-arg="${dg.id}" ${ok ? '' : 'disabled'}>${ok ? '출발' : `🔒 ${esc(dungeonById(dg.req).n)} 클리어 필요`}</button>`}
          <button class="btn ghost" data-act="dg-info" data-arg="${dg.id}" title="나오는 적과 아이템">ℹ 정보</button></div></div>`;
    }).join('')}</div>`;
  }

  // ── ☠ 하드 탭 ──
  const kitText = lv => { const c = {}; for (const b of hardKit(lv)) c[b.id] = (c[b.id] || 0) + b.n; return Object.entries(c).map(([id, n]) => `${ITEMS[id].icon}${esc(ITEMS[id].n)}×${n}`).join(' '); };
  function hardTabHtml() {
    if (!hardUnlocked(save)) {
      const all = hardDungeons(), n = all.filter(d => save.cleared[d.id]).length;
      return `<p>🔒 <b>하드모드</b>는 일반·테마 던전(숨은 던전 제외)을 모두 클리어하면 열려요. <span class="dim">(${n}/${all.length})</span></p>`;
    }
    const mine = (save.hardClears || {})[save.current] || {};
    return `<p class="warn">🧪 하드모드는 테스트 중이에요. 규칙·난이도·보상이 바뀔 수 있어요.</p><p class="dim">탐험대와 적 모두 던전 최고 레벨로 고정 (경험치 없음, 레벨이 진화 조건보다 낮으면 진화 전 모습). 가방은 기본 아이템으로 시작하고 지닌 물건만 그대로예요. 적이 똑똑해지고 좋은 기술을 들고 나와요.</p>
      <div class="cards">${HARD_LIST.map(dungeonById).filter(Boolean).map(dg => `<div class="card dg normal" style="--c1:${dg.pal[1]};--c2:${dg.pal[2]}">
        <div class="dg-head"><b>☠ ${esc(dg.n)}</b> ${(save.hardCleared || {})[dg.id] ? '<i class="clear">클리어</i>' : ''}${mine[dg.id] ? `<i class="clear me" title="${esc(jo(spName(save.current), '으로'))} 하드 클리어">☠</i>` : ''}</div>
        <div class="dim">${dg.floors}층 · 탐험대·적 Lv${dg.lv[1]} 고정</div>
        <div class="note">기본 아이템: ${kitText(dg.lv[1])}</div>
        <div class="note theme">클리어 보상: 테스트 중이라 아직 없음 (주운 아이템과 돈은 가져옴)</div>
        <div class="dg-btns"><button class="btn" data-act="go-hard" data-arg="${dg.id}">출발</button> <button class="btn ghost" data-act="dg-info" data-arg="${dg.id}">ℹ 정보</button></div></div>`).join('')}</div>`;
  }
  function prepareHard(id) {
    const dg = dungeonById(id); if (!dg || !hardUnlocked(save) || !HARD_LIST.includes(id)) return;
    const lv = dg.lv[1], sp = save.current, ch = save.roster[sp];
    // 진화 전 모습으로 들어가는 포켓몬은 특성을 고른다
    const picks = {};
    const heldTxt = x => { const h = save.roster[x].held; return ` · 지닌 물건 ${h ? `${ITEMS[h].icon}${esc(ITEMS[h].n)}` : '<span class="dim">없음</span>'}`; };
    const team = [sp, ...partyList()].map(x => {
      const d = devolveFor(x, lv);
      if (d === x) return `<div class="row">${portraitImg(x, 'portrait xs')} <b>${esc(spName(x))}</b> Lv${lv} <span class="dim">· 특성 ${esc(abilityName(entryAbility(x, save.roster[x])))}</span>${heldTxt(x)}</div>`;
      const { list, def } = hardAbilityChoices(x, d); picks[x] = def;
      return `<div class="row">${portraitImg(d, 'portrait xs')} <b>${esc(spName(d))}</b> Lv${lv} <span class="dim">(${esc(spName(x))}의 진화 전 모습)</span>
        · 특성 <select data-hab="${x}">${list.map(a => `<option value="${a}" ${a === def ? 'selected' : ''}>${esc(abilityName(a))}${DATA.species[d].ab.find(z => z[0] === a)?.[1] ? ' (숨겨진 특성)' : ''}</option>`).join('')}</select>${heldTxt(x)}</div>`;
    });
    UI.open({ title: `☠ ${esc(dg.n)} (하드)`, wide: true, html: `<p class="warn">🧪 하드모드는 테스트 중이에요. 규칙·난이도·보상이 바뀔 수 있어요.</p>${team.join('')}<ul>
      <li>탐험대와 적 모두 <b>Lv${lv}</b> 고정. 경험치·숙련도는 오르지 않아요.</li>
      <li>가방: ${kitText(lv)} <span class="dim">(마을 가방은 그대로 두고 가요. 지닌 물건은 그대로)</span></li>
      <li>클리어하거나 탈출하면 주운 아이템과 돈을 가져와요 (기본 아이템은 빼고). 클리어 보상은 테스트 중이라 아직 없어요.</li>
      <li class="warn">쓰러지면 주운 아이템과 돈을 모두 잃어요. 구조 요청과 임무는 없어요.</li></ul>`,
      choices: [{ label: '출발한다', fn: () => startRun(dg, true, picks) }, { label: '그만둔다', fn: () => {} }],
      onOpen: box => box.querySelectorAll('[data-hab]').forEach(s => s.onchange = () => { picks[s.dataset.hab] = +s.value; }) });
  }

  // ── 던전 정보: 나오는 적, 보스, 아이템, 특징 ──
  function showDungeonInfo(id) {
    const dg = id === 'daily' ? Progress.setupDaily() : dungeonById(id);
    if (!dg) return;
    UI.open({ title: `${esc(dg.n)} 정보`, wide: true, html: dungeonInfoHtml(dg), choices: [{ label: '닫기', fn: () => {} }] });
  }
  function dungeonInfoHtml(dg) {
    const floorLv = f => Math.round(dg.lv[0] + (dg.lv[1] - dg.lv[0]) * (dg.floors > 1 ? (f - 1) / (dg.floors - 1) : 0));
    // 출현 포켓몬: 층 구간마다 후보를 모은다
    const band = dg.floors <= 10 ? Math.ceil(dg.floors / 2) : 5;
    const bands = [];
    for (let a = 1; a <= dg.floors; a += band) {
      const b = Math.min(dg.floors, a + band - 1), set = new Set();
      for (let f = a; f <= b; f++) if (!isBossFloor(dg, f) || f !== dg.floors) { const fc = Dungeon.floorCandidates(dg, f); fc.concept.forEach(id => set.add(id)); fc.cand.forEach(o => set.add(o.id)); }
      bands.push({ a, b, ids: [...set].sort((x, y) => x - y) });
    }
    // 도감처럼: 🤝 영입한 포켓몬(영입한 포켓몬의 진화 전 모습 포함) / ✨ 이로치를 얻은 포켓몬
    const ownSet = new Set(Object.keys(save.roster).flatMap(k => [+k, ...preEvos(+k)]));
    const mon = ids => `<div class="roster dg-mons">${ids.map(k => `<button class="rcard${Progress.isSeen(k) ? '' : ' unseen'}" data-dexpoke="${k}">${portraitImg(k, 'portrait sm')}<span>${esc(spName(k))}</span>${ownSet.has(+k) ? '<i class="dex-own" title="영입한 포켓몬">🤝</i>' : ''}${DATA.species[k].sh && shinyOk(+k) ? '<i class="dex-shiny" title="이로치를 얻었어요">✨</i>' : ''}</button>`).join('')}</div>`;
    const seenIn = ids => ids.filter(k => Progress.isSeen(k)).length;
    // 보스
    const finals = bossPool(dg).length ? bossPool(dg) : BOSSES[dg.id] && DATA.species[BOSSES[dg.id]] ? [BOSSES[dg.id]] : [];
    const bossHtml = `<h3>보스</h3>
      <div class="row"><span class="grow"><b>${dg.floors}층 (최종)</b> ${finals.length ? finals.map(spName).join(' / ') + (finals.length > 1 ? ' 중 하나' : '') : '그 층 후보 중 가장 강한 포켓몬'} · Lv${floorLv(dg.floors) + 3}</span></div>
      ${finals.length ? mon(finals) : ''}
      ${midPool(dg).length ? `<div class="row"><span class="grow"><b>중간 보스 ${dg.mid.floors.join(', ')}층</b> 아래 중 하나씩 (한 탐험에서 겹치지 않음)</span></div>${mon(midPool(dg))}` : ''}
      ${dg.mode === 'rogue' ? '<p class="dim">10층마다 그 층 후보 중 가장 강한 포켓몬이 중간 보스로 나온다.</p>' : ''}
      <p class="dim">보스는 HP 3.5배, 공격·방어·특공·특방 1.1배, 레벨 +3. 쓰러뜨리면 계단이 나타나고 돈과 좋은 아이템을 준다.</p>`;
    // 특징
    const firstAt = lv => { for (let f = 1; f <= dg.floors; f++) if (floorLv(f) >= lv) return f; return 0; };
    const trapF = firstAt(FEATURE_LV.trap), shopF = firstAt(FEATURE_LV.shop), houseF = firstAt(FEATURE_LV.house);
    const feat = [
      `적 레벨 ${dg.lv[0]} ~ ${dg.lv[1]} (층마다 점점 강해짐)`,
      dg.wx && dg.wx.length ? `날씨: ${dg.wx.map(([w, p]) => `${WEATHERS[w].icon}${WEATHERS[w].n} ${Math.round(p * 100)}%`).join(' · ')} (층마다 결정)` : '날씨 없음',
      trapF ? `함정: ${trapF}층부터` : '함정 없음',
      shopF ? `켈리몬 상점: ${shopF}층부터 층마다 ${Math.round(SHOP_CHANCE * 100)}%` : '켈리몬 상점 없음',
      houseF ? `몬스터하우스: ${houseF}층부터 층마다 ${Math.round(HOUSE_CHANCE * 100)}%` : '몬스터하우스 없음',
      dg.hidden ? '숨은 던전 (메달 진행도에는 들어가지 않는다)' : '',
      dg.extra ? `${dg.theme} 시리즈가 일반 적으로도 섞여 나온다` : '',
      `한 층에 머물 수 있는 시간: ${WIND.limit}턴 (넘으면 바람에 날려감)`,
      dg.mode === 'rogue' ? `로그라이크: Lv${ROGUE_LEVEL}, 기본 가방으로 입장 (지닌 물건은 그대로)` : '',
    ].filter(Boolean);
    // 아이템: 마지막 층 기준 드롭 확률 (앞쪽 층은 등급이 낮은 아이템만)
    const table = dropTable(dropLvFor(dg, dg.floors, dg.lv[1]), dg);
    const total = table.reduce((a, d) => a + d[1], 0) / (1 - (table.money || 0));   // 돈 무더기로 바뀌는 몫까지 포함한 전체
    const groups = { heal: ['🍎 회복·음식', []], berry: ['🍒 열매', []], throw: ['📌 던지는 도구', []], misc: ['🔮 씨앗·구슬·기타', []], rare: ['💎 희귀 (영양제·구미·사탕 등)', []], held: ['🎗 지닌 물건', []], tm: ['💿 기술머신', []] };
    const merged = {};
    for (const [iid, w] of table) merged[iid] = (merged[iid] || 0) + w;
    // 아이템 단계: 층마다 적 레벨로 정해진다 (초반·중반·후반·최종)
    const stages = [];
    for (let f = 1; f <= dg.floors; f++) { const st = dropStage(dropLvFor(dg, f, floorLv(f))); if (!stages.length || stages[stages.length - 1][0] !== st) stages.push([st, f]); }
    const tierNote = stages.length <= 1 ? `${DROP_STAGE_NAMES[stages[0][0]]} 단계 아이템` : `아이템 단계: ${stages.map(([st, f]) => `${DROP_STAGE_NAMES[st]} ${f}층~`).join(', ')}`;
    for (const [iid, w] of Object.entries(merged)) groups[itemGroup(iid)][1].push([iid, w]);
    const pctT = w => { const p = w / total * 100; return p >= 1 ? p.toFixed(1) + '%' : p >= 0.1 ? p.toFixed(2) + '%' : p.toFixed(3) + '%'; };
    const itemHtml = Object.values(groups).filter(g => g[1].length).map(([name, list]) => {
      list.sort((a, b) => b[1] - a[1]);
      const sum = list.reduce((a, x) => a + x[1], 0);
      const many = list.length > 14;
      return `<details${many ? '' : ' open'}><summary><b>${name}</b> <span class="dim">합계 ${pctT(sum)} · ${list.length}종${many ? ' (눌러서 펼치기)' : ''}</span></summary>
        <div class="dg-items">${list.map(([iid, w]) => `<span class="dg-item" data-dexitem="${iid}">${ITEMS[iid].icon} ${esc(ITEMS[iid].n)} <i class="dim">${pctT(w)}</i></span>`).join('')}</div></details>`;
    }).join('');
    const allIds = new Set(bands.flatMap(b => b.ids));
    const sigHere = sigItemsFor([...allIds, ...finals, ...midPool(dg)]);
    const megaHere = dg.lv[1] >= MEGA_MIN_LV ? megaPool(dg) : [];
    return `<div class="dg-info">
        <p>${dg.floors}층 · ${dg.mode === 'rogue' ? '로그라이크' : '일반'} 던전${dg.theme ? ` · 👑 ${esc(dg.theme)}` : ''} · ${dg.types ? typeBadges(dg.types) : '<span class="type" style="background:#777">모든 타입</span>'}
          ${dg.req ? `<br><span class="dim">${esc(jo(dungeonById(dg.req).n, '을'))} 클리어하면 열림</span>` : ''}</p>
        <ul class="dg-feat">${feat.map(x => `<li>${x}</li>`).join('')}</ul>
        ${bossHtml}
        <h3>나오는 포켓몬 <span class="dim">${seenIn([...allIds])}/${allIds.size}종 만남 · 층마다 이 중 6종이 무작위로 등장${!dg.extra && [...PARADOX_PAST, ...PARADOX_FUTURE].some(id => allIds.has(id)) ? ' (패러독스 포켓몬은 드물게)' : ''} · 어두운 것은 아직 못 만난 포켓몬</span></h3>
        ${bands.map((b, i) => `<details${i === 0 ? ' open' : ''}><summary><b>${b.a === b.b ? b.a : `${b.a}~${b.b}`}층</b> <span class="dim">Lv${floorLv(b.a)}~${floorLv(b.b)} · ${b.ids.length}종 (만남 ${seenIn(b.ids)})</span></summary>${mon(b.ids)}</details>`).join('')}
        <h3>나오는 아이템 <span class="dim">마지막 층 기준 확률 · 한 층에 아이템 ${ITEMS_PER_FLOOR[0]}~${ITEMS_PER_FLOOR[1]}개, 돈 2~4무더기 · ${tierNote}</span></h3>
        ${itemHtml}
        ${table.money ? `<p>💰 <b>돈 무더기</b> <span class="dim">${pctT(total * table.money)} · 아이템 자리에 대신 놓이는 돈</span></p>` : ''}
        ${megaHere.length ? `<p><b>♾️ 메가스톤</b> <span class="dim">레벨 ${MEGA_MIN_LV} 이상인 층에서만 · 보스·이로치 ${+(MEGA_RATE.boss * (dg.megaMul || 1) * 100).toFixed(2)}%, 바닥 아이템·적이 떨어뜨리는 아이템 ${+(MEGA_RATE.floor * (dg.megaMul || 1) * 100).toFixed(2)}%${dg.megaMul ? ` (이 던전은 ${dg.megaMul}배)` : ''} · 던전 타입에 맞는 ${megaHere.length}종</span>
          <details><summary class="dim">눌러서 펼치기</summary><div class="dg-items">${megaHere.map(iid => `<span class="dg-item" data-dexitem="${iid}">${ITEMS[iid].icon} ${esc(ITEMS[iid].n)}</span>`).join('')}</div></details></p>` : ''}
        ${sigHere.length ? `<p><b>전용 도구</b> <span class="dim">주인 포켓몬이 나오는 층에서 드물게 떨어진다 (보스가 주인이면 더 자주)</span><br>${sigHere.map(iid => `<span class="dg-item" data-dexitem="${iid}">${ITEMS[iid].icon} ${esc(ITEMS[iid].n)}</span>`).join(' ')}</p>` : ''}
      </div>`;
  }

  function tabMission() {
    const acc = save.missions.accepted;
    return `${rankSection()}${sosSection()}
      <h3>진행 중인 임무 (${acc.length}/${missionMax()}) <select class="mission-sort" title="임무 정렬"><option value="">받은 순서</option><option value="floor" ${save.missionSort === 'floor' ? 'selected' : ''}>던전·층수 순서</option></select></h3>
      ${acc.length ? sortMissions(acc).map(m => `<div class="row">${portraitImg(m.kind === 'outlaw' ? m.target : m.client, 'portrait sm', m.kind === 'sos' ? 'Pain' : 'Normal', !!m.shiny)}<div class="grow">${missionText(m)}<div class="dim">보상 ${rewardText(m)}</div></div>
        <button class="btn sm ghost" data-act="drop-mission" data-arg="${m.id}">취소</button></div>`).join('') : '<p class="dim">받은 임무가 없습니다.</p>'}
      <h3>게시판 <span class="dim">(던전에서 돌아오면 새 의뢰가 붙습니다)</span></h3>
      <div class="row"><span class="grow">📍 자주 뜨는 지역 <span class="dim">(고른 던전의 의뢰가 새 의뢰의 30~50%쯤 나와요)</span></span>
        <select data-mfocus="1"><option value="">고르지 않음</option>${DUNGEONS.filter(d => d.mode === 'normal' && unlocked(d)).sort((a, b) => a.lv[0] - b.lv[0]).map(d => `<option value="${d.id}" ${save.missionFocus === d.id ? 'selected' : ''}>${esc(d.n)}</option>`).join('')}</select></div>
      ${save.missions.board.slice().sort((a, b) => dgOrder(a.dungeon) - dgOrder(b.dungeon) || a.floor - b.floor).map(m => `<div class="row">${portraitImg(m.kind === 'outlaw' ? m.target : m.client, 'portrait sm')}<div class="grow">${missionText(m)}<div class="dim">보상 ${rewardText(m)}</div></div>
        <button class="btn sm" data-act="take-mission" data-arg="${m.id}" ${acc.length >= missionMax() ? 'disabled' : ''}>수락</button></div>`).join('') || '<p class="dim">의뢰가 없습니다.</p>'}`;
  }

  function tabShop() {
    const row = (id, daily) => {
      const left = daily ? shopLeft(id) : Infinity;
      return `<div class="row">${itemLabel(id)}<span class="grow dim">${esc(ITEMS[id].d)}${daily && !left ? ' <span class="warn">(매진)</span>' : ''}</span>
        <button class="btn sm" data-act="buy" data-arg="${id}" ${save.money < ITEMS[id].price || !left ? 'disabled' : ''}>₽${ITEMS[id].price}${ITEMS[id].stack ? ' (5개)' : ''}</button></div>`;
    };
    return `<h3>켈리몬 상점 <span class="dim">· 항상 판매</span></h3><div class="grid2">${shopFixedFor(save).map(id => row(id)).join('')}</div>
      <h3>오늘의 진열 <span class="dim">· 하나씩만 (겹치는 물건은 5개 한 묶음)</span> <button class="btn sm ghost" data-act="shop-reroll" ${save.money < SHOP_REROLL_COST ? 'disabled' : ''} title="오늘 진열을 새로 뽑는다">🔄 새로고침 ₽${SHOP_REROLL_COST}</button></h3>
      <div class="row"><span class="grow">💿 기술머신 분류 <span class="dim">(고르면 다음 진열부터 그 분류의 기술머신만 ${SHOP_TM_N}개)</span></span>
        <select data-tmfocus="1"><option value="">전체</option>${[['status', '변화'], ['phys', '물리'], ['spec', '특수']].map(([k, n]) => `<option value="${k}" ${save.tmFocus === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div><div class="grid2">
      ${save.shop.filter(id => !SHOP_FIXED.includes(id) && ITEMS[id]).map(id => row(id, true)).join('')}</div>
      ${(save.soldLog || []).length ? `<h3>↩ 최근에 판 물건 <span class="dim">(판 값 그대로 되살 수 있어요, 최근 ${SOLD_LOG_MAX}개)</span></h3>
        ${save.soldLog.map((e, i) => `<div class="row">${itemLabel(e.id)}${e.n > 1 ? ' ×' + e.n : ''}<span class="grow dim">${e.from === 'storage' ? '창고에서' : '가방에서'} 판 물건</span>
          <button class="btn sm" data-act="buyback" data-arg="${i}" ${save.money < e.money ? 'disabled' : ''}>₽${e.money}에 되사기</button></div>`).join('')}` : ''}
      <h3>팔기 <span class="dim">(가방의 아이템 · 창고의 아이템은 창고 탭에서)</span></h3>
      ${save.bag.length ? save.bag.map((b, i) => `<div class="row">${itemLabel(b.id)}${b.n > 1 ? ' ×' + b.n : ''}<span class="grow"></span>
        <button class="btn sm ghost" data-act="sell" data-arg="${i}">₽${sellPrice(b)}에 팔기</button></div>`).join('') : '<p class="dim">가방이 비어 있습니다.</p>'}`;
  }
  const sellPrice = sellValue;

  // 창고 정렬 (보기만 바뀐다)
  const ITEM_ORDER = Object.keys(ITEMS);
  const STORE_SORTS = { kind: '종류순', name: '이름순', count: '많은 순', new: '넣은 순' };
  const byKind = (a, b) => ITEM_ORDER.indexOf(a) - ITEM_ORDER.indexOf(b);
  function storageIds() {
    const ids = Object.keys(save.storage).filter(k => save.storage[k] > 0 && ITEMS[k]);
    const mode = save.storageSort || 'kind';
    if (mode === 'kind') ids.sort(byKind);
    else if (mode === 'name') ids.sort((a, b) => ITEMS[a].n.localeCompare(ITEMS[b].n, 'ko'));
    else if (mode === 'count') ids.sort((a, b) => save.storage[b] - save.storage[a] || byKind(a, b));
    return ids;
  }
  // 창고 필터 (도감 아이템 필터와 같은 분류): 1 도구 · 2 지닌 물건 · 3 기술머신 · 4 전용 도구 · 5 메가스톤
  const itemKindNo = id => { const it = ITEMS[id]; return it.tm ? 3 : it.mega ? 5 : it.sig ? 4 : it.held ? 2 : 1; };
  const STORE_FILTERS = [['', '전체'], ['1', '도구'], ['2,4,5', '지닌 물건'], ['4', '전용 도구'], ['5', '메가스톤']];   // 기술머신은 아래 기술머신 보관함에
  function tabStorage() {
    const every = storageIds(), all = every.filter(id => !ITEMS[id].tm), tms = every.filter(id => ITEMS[id].tm).sort((a, b) => ITEMS[a].n.localeCompare(ITEMS[b].n, 'ko'));
    if (save.storageFilter === '3') save.storageFilter = '';
    const f = save.storageFilter || '';
    const ids = f ? all.filter(id => f.split(',').includes(String(itemKindNo(id)))) : all;
    const filter = all.length > 1 ? `<select class="store-filter" title="종류별로 보기">${STORE_FILTERS.map(([v, n]) => `<option value="${v}" ${v === f ? 'selected' : ''}>${n}</option>`).join('')}</select>` : '';
    const sorts = Object.entries(STORE_SORTS).map(([k, n]) => `<button class="btn sm${(save.storageSort || 'kind') === k ? '' : ' ghost'}" data-act="store-sort" data-arg="${k}">${n}</button>`).join('');
    const tmN = tms.reduce((s, id) => s + save.storage[id], 0), asN = (save.autoSell || []).filter(id => ITEMS[id]).length;
    return `${upgradeBox()}<div class="btns store-dlgs"><button class="btn" data-act="dlg-tms">💿 기술머신 보관함 (${tmN}개)</button> <button class="btn" data-act="dlg-autosell">🔁 자동 판매 (${asN}개)</button></div>
      <div class="split"><div><h3>창고 (${storageUsed()}/${save.storageMax})</h3>${storageUsed() > save.storageMax ? '<p class="warn">창고가 넘쳤습니다. 정리하기 전까지는 맡길 수 없습니다.</p>' : ''}
      ${all.length > 1 ? `<div class="row sort-row">↕ ${sorts} ${filter}</div>` : ''}
      <div class="store-list">${ids.length ? ids.map(id => `<div class="row">${itemLabel(id)} ×${save.storage[id]}<span class="grow"></span>
        <button class="btn sm ghost" data-dexitem="${id}" title="아이템 정보">ℹ</button>${id === 'candy' ? ' <button class="btn sm" data-act="use-candy">사용</button>' : ''}
        <button class="btn sm" data-act="withdraw" data-arg="${id}" ${bagSlots() >= bagMax() && !ITEMS[id].stack ? 'disabled' : ''}>꺼내기</button>
        ${id !== 'quest' ? `<button class="btn sm ghost" data-act="sell-store" data-arg="${id}" title="${ITEMS[id].stack ? '5개씩' : '하나'} 판다 (상점 탭에서 되살 수 있음)">₽${sellValue({ id, n: ITEMS[id].stack ? Math.min(5, save.storage[id]) : 1 })} 팔기</button>` : ''}</div>`).join('') : `<p class="dim">${all.length ? '이 종류의 아이템이 없습니다.' : '창고가 비어 있습니다.'}</p>`}</div>
      </div><div>${presetBox()}<h3>가방 (${bagSlots()}/${bagMax()})</h3>
      ${save.bag.length ? `<div class="row sort-row"><button class="btn sm" data-act="deposit-all">모두 맡기기</button>${save.bag.length > 1 ? ' <button class="btn sm ghost" data-act="sort-bag">↕ 가방 정리</button>' : ''}</div>` : ''}
      ${save.bag.map((b, i) => `<div class="row">${itemLabel(b.id)}${b.n > 1 ? ' ×' + b.n : ''}<span class="grow"></span>
        <button class="btn sm ghost" data-act="deposit" data-arg="${i}">${autoSellsNow(b.id) ? '팔기' : '맡기기'}</button></div>`).join('') || '<p class="dim">가방이 비어 있습니다.</p>'}</div></div>`;
  }

  // ── 꺼내기 프리셋: 지금 가방 구성을 저장해 두고, 창고에서 그대로 다시 채운다 (PRESET_N개, 이름 바꾸기 가능) ──
  const PRESET_N = 3;
  function presets() {
    save.presets = save.presets || [];
    for (let i = 0; i < PRESET_N; i++) if (!save.presets[i]) save.presets[i] = { name: `프리셋 ${i + 1}`, items: [] };
    return save.presets;
  }
  const bagCount = id => save.bag.filter(b => b.id === id).reduce((s, b) => s + b.n, 0);
  function presetBox() {
    return `<h3>🎒 꺼내기 프리셋 <span class="dim">(지금 가방을 저장해 두고, 다음에 창고에서 그대로 채워요)</span></h3>
      ${presets().map((p, i) => `<div class="row preset"><div class="grow"><b>${esc(p.name)}</b> <button class="btn sm ghost" data-act="preset-name" data-arg="${i}" title="이름 바꾸기">✏</button>
        <div class="dim tiny">${p.items.length ? p.items.map(x => `${ITEMS[x.id] ? ITEMS[x.id].icon + esc(ITEMS[x.id].n) : '?'}${x.n > 1 ? '×' + x.n : ''}`).join(' ') : '비어 있음'}</div></div>
        <button class="btn sm" data-act="preset-load" data-arg="${i}" ${p.items.length ? '' : 'disabled'} title="가방에 모자란 만큼 창고에서 꺼낸다">꺼내기</button>
        <button class="btn sm ghost" data-act="preset-save" data-arg="${i}" title="지금 가방 구성을 이 프리셋에 저장">저장</button></div>`).join('')}`;
  }
  function presetSave(i) {
    const items = {};
    for (const b of save.bag) if (ITEMS[b.id] && b.id !== 'quest') items[b.id] = (items[b.id] || 0) + b.n;
    presets()[i].items = Object.entries(items).map(([id, n]) => ({ id, n }));
    UI.toast(`${presets()[i].name}에 지금 가방을 저장했어요.`);
  }
  // 가방에 이미 있는 만큼은 빼고, 모자란 만큼만 창고에서 꺼낸다
  function presetLoad(i) {
    const p = presets()[i]; let short = false, full = false;
    for (const { id, n } of p.items) {
      if (!ITEMS[id]) continue;
      let need = n - bagCount(id);
      const take = Math.min(Math.max(0, need), save.storage[id] || 0);
      if (take < need) short = true;
      if (take <= 0) continue;
      let got = 0;
      if (ITEMS[id].stack) { if (bagAdd(id, take)) got = take; }
      else while (got < take && bagAdd(id, 1)) got++;
      if (got < take) full = true;
      save.storage[id] -= got; if (save.storage[id] <= 0) delete save.storage[id];
    }
    UI.toast(full ? '가방이 가득 차서 일부만 꺼냈어요.' : short ? '창고에 모자란 아이템이 있어서 있는 만큼만 꺼냈어요.' : `${p.name}대로 꺼냈어요.`);
  }
  function presetName(i) {
    const p = presets()[i];
    UI.open({ title: '프리셋 이름', html: `<input id="preset-name" maxlength="12" value="${esc(p.name)}" autocomplete="off" style="width:100%">`,
      choices: [{ label: '바꾸기', fn: box => {} }, { label: '그만둔다', fn: () => {} }],
      onOpen: (box, m) => {
        const inp = box.querySelector('#preset-name'), ok = () => { const v = inp.value.trim(); if (v) { p.name = v.slice(0, 12); persist(); renderTown(); } };
        const btn = [...box.querySelectorAll('button')].find(b => b.textContent.includes('바꾸기'));
        if (btn) btn.addEventListener('click', ok, true);
        inp.onkeydown = e => { if (e.key === 'Enter') { ok(); UI.close(m); } };
        setTimeout(() => { inp.focus(); inp.select(); }, 50);
      } });
  }

  // ── 자동 판매: 고른 아이템은 창고에 맡길 때 (맡기기·모두 맡기기·하드모드/로그라이크에서 가져온 아이템) 창고에 넣지 않고 바로 판다 ──
  const autoSells = id => !!(save.autoSell && save.autoSell.includes(id));
  // 자동 판매하면서 창고에 남겨 둘 개수 (v0.90): 이만큼까지는 창고에 넣고 넘치는 것만 판다. 기본 0 (모두 판다)
  const AUTO_SELL_KEEP_DEFAULT = 0;
  const autoSellKeep = id => { const v = (save.autoSellKeep || {})[id]; return v == null ? AUTO_SELL_KEEP_DEFAULT : Math.max(0, Math.floor(+v) || 0); };
  // 지금 맡기면 팔리는지 (가방의 버튼 이름용)
  const autoSellsNow = id => autoSells(id) && (save.storage[id] || 0) >= autoSellKeep(id);
  // 창고 화면의 버튼으로 여는 창 (창고 목록이 아래로 밀리지 않게): 고치면 창 내용만 다시 그린다
  function storeDialog(title, body, bind, onClose) {
    const done = onClose || (() => {});
    UI.open({ title, wide: true, html: `<div class="dlg-body">${body()}</div>`, choices: [{ label: '닫기', fn: done }], cancel: done,
      onOpen: box => {
        const el = box.querySelector('.dlg-body');
        const refresh = () => { persist(); renderTown(); el.innerHTML = body(); };
        bind(el, refresh);
      } });
  }
  // 💿 기술머신 보관함: 이름 검색, 꺼내기·팔기
  function tmStoreDialog() {
    let q = '';
    const body = () => {
      const tms = storageIds().filter(id => ITEMS[id].tm).sort((a, b) => ITEMS[a].n.localeCompare(ITEMS[b].n, 'ko'));
      const shown = tms.filter(id => !q || ITEMS[id].n.toLowerCase().includes(q));
      return `<p class="dim">기술머신은 창고 칸을 차지하지 않아요. 가방 ${bagSlots()}/${bagMax()}칸</p>
        <input data-tmq="1" placeholder="기술 이름 검색" value="${esc(q)}" autocomplete="off" style="width:100%;margin-bottom:6px">
        ${shown.map(id => `<div class="row">${itemLabel(id)} ×${save.storage[id]}<span class="grow"></span>
          <button class="btn sm ghost" data-dexitem="${id}" title="아이템 정보">ℹ</button>
          <button class="btn sm" data-tmw="${id}" ${bagSlots() >= bagMax() ? 'disabled' : ''}>꺼내기</button>
          <button class="btn sm ghost" data-tms="${id}" title="하나 판다 (상점 탭에서 되살 수 있음)">₽${sellValue({ id, n: 1 })} 팔기</button></div>`).join('') || `<p class="dim">${tms.length ? '찾는 기술머신이 없습니다.' : '보관한 기술머신이 없습니다.'}</p>`}`;
    };
    storeDialog('💿 기술머신 보관함', body, (el, refresh) => {
      el.addEventListener('click', async e => {
        const w = e.target.closest('[data-tmw]'), s = e.target.closest('[data-tms]');
        if (w) { await onAction('withdraw', w.dataset.tmw); refresh(); }
        if (s) { await onAction('sell-store', s.dataset.tms); refresh(); }
      });
      el.addEventListener('input', e => {
        if (!e.target.dataset.tmq) return;
        q = e.target.value.trim().toLowerCase(); const pos = e.target.selectionStart;
        el.innerHTML = body(); const inp = el.querySelector('[data-tmq]'); inp.focus(); inp.setSelectionRange(pos, pos);
      });
    });
  }
  function autoSellDialog() {
    storeDialog('🔁 자동 판매', autoSellBox, (el, refresh) => {
      el.addEventListener('click', async e => { const b = e.target.closest('[data-asoff]'); if (b) { await toggleAutoSell(b.dataset.asoff); refresh(); } });
      el.addEventListener('change', async e => {
        if (e.target.dataset.asadd && e.target.value) { await toggleAutoSell(e.target.value); refresh(); }
        if (e.target.dataset.askeep) { setAutoSellKeep(e.target.dataset.askeep, e.target.value); refresh(); }
      });
    }, sellStoredAutoSell);   // 창을 닫을 때 창고에 있던 것 중 남길 개수를 넘는 것을 판다
  }
  function sellStoredAutoSell() {
    for (const id of (save.autoSell || []).filter(x => ITEMS[x])) {
      const have = save.storage[id] || 0, keep = autoSellKeep(id);
      if (have > keep) { if (keep) save.storage[id] = keep; else delete save.storage[id]; storeDeposit(id, have - keep); }
    }
    persist(); renderTown();
  }
  function autoSellBox() {
    const list = (save.autoSell || []).filter(id => ITEMS[id]);
    // 한 줄에 하나씩. 추가는 목록에서 고른다 (창고·가방에 있는 것 먼저)
    const have = new Set([...Object.keys(save.storage).filter(k => save.storage[k] > 0), ...save.bag.map(b => b.id)]);
    const opts = Object.keys(ITEMS).filter(id => id !== 'quest' && !list.includes(id) && ITEMS[id].price).sort(byKind);
    const opt = id => `<option value="${id}">${ITEMS[id].icon} ${esc(ITEMS[id].n)}</option>`;
    return `<div class="autosell"><p class="dim">고른 아이템은 창고에 들어올 때(맡기기·의뢰 보상 등) 넣지 않고 바로 팔아요. <b>남길 개수</b>를 정하면 그만큼은 창고에 넣고 넘치는 것만 팔아요 (0이면 모두 판매). 창고에 이미 있던 것은 이 창을 닫을 때 팔아요. 직접 사거나 되산 물건은 팔지 않아요. 판 물건은 상점 탭에서 되살 수 있어요. (${list.length}개)</p>
      <div class="row"><select data-asadd="1"><option value="">＋ 자동 판매할 아이템 고르기</option>
        <optgroup label="창고·가방에 있는 것">${opts.filter(id => have.has(id)).map(opt).join('')}</optgroup>
        <optgroup label="그 밖의 아이템">${opts.filter(id => !have.has(id)).map(opt).join('')}</optgroup></select></div>
      ${list.map(id => `<div class="row">${itemLabel(id)}<span class="grow dim">창고 ${save.storage[id] || 0}개 · ${ITEMS[id].stack ? '5개에' : '하나에'} ₽${sellValue({ id, n: ITEMS[id].stack ? 5 : 1 })}</span>
        <label class="dim tiny">남길 개수 <input type="number" min="0" max="999" step="1" data-askeep="${id}" value="${autoSellKeep(id)}" style="width:4.2em"></label>
        <button class="btn sm ghost" data-asoff="${id}">끄기</button></div>`).join('')}</div>`;
  }
  let autoSoldMoney = 0, autoSoldTimer = null;
  // 창고에 맡긴다. 자동 판매 아이템이면 대신 판다 (true: 팔았음)
  function storeDeposit(id, n = 1) {
    if (!autoSells(id) || id === 'quest') { storeKeep(id, n); return false; }
    const keepN = Math.min(n, Math.max(0, autoSellKeep(id) - (save.storage[id] || 0)));   // 남길 개수까지는 창고로
    if (keepN) { storeKeep(id, keepN); n -= keepN; if (!n) return false; }
    const v = sellValue({ id, n });
    save.money += v; logSale(id, n, v, 'storage');
    autoSoldMoney += v; clearTimeout(autoSoldTimer);
    autoSoldTimer = setTimeout(() => { UI.toast(`🔁 자동 판매로 ₽${autoSoldMoney}을 받았습니다. (상점 탭에서 되살 수 있어요)`); autoSoldMoney = 0; }, 50);
    return true;
  }
  async function toggleAutoSell(id) {
    if (!ITEMS[id] || id === 'quest') return;
    save.autoSell = (save.autoSell || []).filter(x => ITEMS[x]);
    if (autoSells(id)) { save.autoSell = save.autoSell.filter(x => x !== id); UI.toast(`${ITEMS[id].n} 자동 판매를 껐습니다.`); persist(); renderTown(); return; }
    save.autoSell.push(id);
    UI.toast(`${ITEMS[id].n} 자동 판매를 켰습니다.${save.storage[id] ? ' 창고에 있는 것은 이 창을 닫을 때 팔아요.' : ''}`);   // 창고에 있던 것은 창을 닫을 때 (sellStoredAutoSell)
    persist(); renderTown();
  }

  // 남길 개수를 바꾸면 창고에 넘치는 것은 바로 판다
  function setAutoSellKeep(id, v) {
    if (!ITEMS[id]) return;
    const n = Math.max(0, Math.min(999, Math.floor(+v) || 0));
    save.autoSellKeep = { ...(save.autoSellKeep || {}) };
    save.autoSellKeep[id] = n;
    UI.toast(n ? `${ITEMS[id].n}: 창고에 ${n}개까지 남기고 넘치는 것만 팝니다.` : `${ITEMS[id].n}: 모두 자동 판매합니다.`);
    persist(); renderTown();
  }

  function upgradeBox() {
    const bc = bagUpgradeCost(save.bagMax), sc = storageUpgradeCost(save.storageMax);
    const bFull = save.bagMax >= BAG_LIMIT, sFull = save.storageMax >= STORAGE_LIMIT;
    return `<div class="upgrades">
      <div class="row">🎒 <span class="grow">가방 <b>${save.bagMax}</b>칸${bFull ? ' (최대)' : ` → ${save.bagMax + BAG_STEP}칸`}</span>
        <button class="btn sm" data-act="up-bag" ${bFull || save.money < bc ? 'disabled' : ''}>${bFull ? '최대' : '₽' + bc + ' 확장'}</button></div>
      <div class="row">📦 <span class="grow">창고 <b>${save.storageMax}</b>칸${sFull ? ' (최대)' : ` → ${save.storageMax + STORAGE_STEP}칸`}</span>
        <button class="btn sm" data-act="up-storage" ${sFull || save.money < sc ? 'disabled' : ''}>${sFull ? '최대' : '₽' + sc + ' 확장'}</button></div></div>`;
  }

  function tabBag() {
    return `${upgradeBox()}<h3>가방 (${bagSlots()}/${bagMax()})</h3>
      <p class="dim">일반 던전에서 쓰러지면 가방 아이템의 절반을 무작위로 잃습니다. 귀중한 아이템은 창고에 맡기세요.</p>
      ${save.bag.length > 1 ? '<button class="btn sm ghost" data-act="sort-bag">↕ 가방 정리 (종류별로 정렬)</button>' : ''}
      ${save.bag.map((b, i) => `<div class="row">${itemLabel(b.id)}${b.n > 1 ? ' ×' + b.n : ''}<span class="grow dim">${esc(ITEMS[b.id].d)}</span>
        ${b.id === 'candy' ? '<button class="btn sm" data-act="use-candy">사용</button>' : ''}
        <button class="btn sm ghost" data-act="deposit" data-arg="${i}">창고로</button>
        <button class="btn sm ghost danger" data-act="discard" data-arg="${i}">버리기</button></div>`).join('') || '<p class="dim">가방이 비어 있습니다.</p>'}`;
  }

  function evoOptions(sp) {
    const ch = save.roster[sp], v = DATA.species[sp].v;
    // 이미 영입한 진화형(또는 그 뒤 갈래를 모두 영입한 진화형)으로는 진화하지 않는다: 다른 갈래로
    // 단 갈 수 있는 진화가 모두 이미 있으면 (크랩·킹크랩을 둘 다 영입한 경우 등) 진화해서 그 포켓몬과 합친다
    const covered = v.map(([to]) => familyCovered(to, save.roster)), allCovered = covered.every(Boolean);
    return v.map(([to, lv, item], i) => {
      const itemId = item === 1 ? 'stone' : item === 2 ? 'link' : null;
      const hasItem = !itemId || save.bag.some(b => b.id === itemId) || save.storage[itemId] > 0;
      const taken = covered[i] && !allCovered;
      const req = taken ? '이미 영입한 포켓몬이라 이쪽으로는 진화할 수 없어요' : [lv ? `Lv ${lv} 이상` : '', itemId ? ITEMS[itemId].n + ' 필요' : ''].filter(Boolean).join(', ');
      return { to, lv, itemId, ok: !taken && ch.lv >= lv && hasItem, req };
    });
  }

  function tabChar() {
    const sp = tmWho(), ch = save.roster[sp];
    const evos = evoOptions(sp);
    const roster = Object.keys(save.roster).map(Number);
    const w = sp, wc = ch;
    return `<h3>캐릭터 관리</h3>
      ${tmWhoBar()}
      <h3>🏅 ${esc(spName(sp))}의 메달</h3>${medalSection(sp)}
      <div class="btns"><button class="btn" data-act="change-char">🔄 리더 변경</button> <button class="btn" data-act="set-moves" data-arg="${sp}">📘 ${esc(spName(sp))} 기술 설정</button></div>
      <p class="dim">영입한 포켓몬 ${roster.length}마리 · 지금 영입 확률 <b>${(recruitRate(save.roster[save.current].lv) * 100).toFixed(1)}%</b> <span class="tiny">(리더 레벨 기준, 전설·환상은 절반)</span></p>
      ${DATA.species[sp].sh ? `<h3>모습</h3><div class="row">${portraitImg(sp, 'portrait sm', 'Normal', false)} ${portraitImg(sp, 'portrait sm', 'Normal', true)}
        <span class="grow">${ch.shiny ? '✨ 이로치(색이 다른 모습)로 탐험합니다.' : '보통 모습으로 탐험합니다.'} <span class="dim">(겉모습만 바뀝니다)</span></span>
        ${shinyOk(sp) ? `<button class="btn sm" data-act="toggle-shiny">${ch.shiny ? '보통 모습으로' : '✨ 이로치로'}</button>` : '<span class="dim tiny">🔒 이 포켓몬이나 같은 진화 계열의 이로치를 쓰러뜨리거나 영입하면 고를 수 있어요</span>'}</div>` : ''}
      ${formSection(sp, ch)}
      <h3>특성 <span class="dim">(누르면 설명. 바꾸려면 ${ITEMS.abcapsule.icon}특성캡슐 ×${ownedCount('abcapsule')}, 숨겨진 특성은 ${ITEMS.abpatch.icon}특성패치 ×${ownedCount('abpatch')}가 필요)</span></h3>
      ${DATA.species[sp].ab.map(([aid, hid]) => { const cur = entryAbility(sp, save.roster[sp]) === aid, x = abilityDesc(aid); return `<div class="row">
        <div class="grow"><span class="ab-link" data-ability="${aid}">${esc(x.n)}</span>${hid ? ' <span class="dim">(숨겨진 특성)</span>' : ''}
        <div class="dim">${esc(x.dungeon || x.exact || x.d)}${x.none ? ' <span class="warn">— 던전에서는 효과 없음</span>' : ''}</div></div>
        <button class="btn sm${cur ? '' : ' ghost'}" data-act="set-ability" data-arg="${aid}" ${cur || !ownedCount(hid ? 'abpatch' : 'abcapsule') ? 'disabled' : ''}>${cur ? '사용 중' : `${ITEMS[hid ? 'abpatch' : 'abcapsule'].icon} 바꾸기`}</button></div>`; }).join('')}
      <h3>기술머신 <span class="dim">(한 번 쓰면 사라지고, 배운 기술은 기술 설정에서 언제든 넣고 뺄 수 있습니다)</span></h3>
      ${tmSection(w, wc)}
      <h3>🥚 교배기술 <span class="dim">(${ITEMS.eggtm.icon}교배기술머신 ×${ownedCount('eggtm')}. 하나 쓰면 교배기술 하나를 배웁니다)</span></h3>
      ${eggSection(w, wc)}
      <h3>${ITEMS.masterbook.icon} 숙련맥스 <span class="dim">(×${ownedCount('masterbook')}. 기술 하나의 숙련도를 바로 ★${MASTERY_MAX}으로. 상점에서 늘 판매)</span></h3>
      ${masterSection(w, wc)}
      <h3>영양제 <span class="dim">(능력치를 영구히 올립니다. 일반 던전에서만 적용되고 로그라이크에서는 무시)</span></h3>
      <div class="row"><span class="grow">${wc.boost && wc.boost.off ? '⏸ 영양제·구미 효과를 <b>꺼 두었습니다</b> (먹은 기록은 남아 있어요)' : '영양제·구미 효과가 켜져 있습니다.'}</span>
        <button class="btn sm ghost" data-act="boost-toggle" data-arg="${w}">${wc.boost && wc.boost.off ? '효과 켜기' : '효과 끄기'}</button></div>
      ${vitaminSection(wc, w)}
      <h3>구미 <span class="dim">(아주 드문 간식. 능력치가 영구히 조금 오르고, 던전에서 먹으면 배도 찹니다)</span></h3>
      ${gummySection(wc, w)}
      <h3>${ITEMS.candy.icon} 이상한사탕 <span class="dim">(레벨이 1 오릅니다)</span></h3>
      <div class="row"><span class="grow">${esc(spName(w))} <b>Lv${wc.lv}</b> · 이상한사탕 ×${ownedCount('candy')}</span>
        <button class="btn sm" data-act="use-candy" data-arg="${w}" ${ownedCount('candy') && wc.lv < MAX_LEVEL ? '' : 'disabled'}>먹이기</button></div>
      <h3>지닌 물건</h3>
      <div class="row">${wc.held ? `${ITEMS[wc.held].icon} <b>${esc(ITEMS[wc.held].n)}</b><span class="grow dim">${esc(ITEMS[wc.held].d)}</span>
        <button class="btn sm ghost" data-act="unhold" data-arg="${w}">빼기</button>` : '<span class="grow dim">지닌 물건이 없습니다. 상점에서 사거나 던전에서 주울 수 있어요.</span>'}
        <button class="btn sm" data-act="hold" data-arg="${w}">${wc.held ? '바꾸기' : '지니게 하기'}</button></div>
      <h3>진화</h3>
      ${evos.length ? evos.map(e => `<div class="row">${portraitImg(e.to, 'portrait sm')}<div class="grow"><b>${esc(spName(e.to))}</b> ${typeBadges(DATA.species[e.to].t)}<div class="dim">${e.req}</div>${borrowNote(e.to) ? `<div class="dim tiny">${esc(borrowNote(e.to))}</div>` : ''}</div>
        <button class="btn sm" data-act="evolve" data-arg="${e.to}" ${e.ok ? '' : 'disabled'}>진화</button></div>`).join('') : '<p class="dim">더 이상 진화하지 않습니다.</p>'}
      ${devolveSection(sp, ch)}
      ${partySection()}`;
  }
  // 왼쪽 캐릭터 카드 아래: 동료 정보와 기술·지닌 물건 변경, 작전
  function partyCard() {
    const pl = partyList();
    const one = id => {
      const c = save.roster[id], s = applyBoost(calcStats(id, c.lv, 31), c.boost), mv = c.moves.length ? c.moves : defaultMoves(id, c.lv);
      return `<details class="cc-mate"><summary>${portraitImg(id, 'portrait xs', 'Normal', c.shiny)} <b>${esc(spName(id))}</b> Lv${c.lv}${c.held ? ` ${ITEMS[c.held].icon}` : ''}</summary>
        <div class="dim">${typeBadges(DATA.species[id].t)} HP ${s.maxhp} · 특성 <span class="ab-link" data-ability="${entryAbility(id, c)}">${esc(abilityName(entryAbility(id, c)))}</span></div>
        <table class="stats">
          <tr><td>HP</td><td>${s.maxhp}</td><td>공격</td><td>${s.atk}</td></tr>
          <tr><td>방어</td><td>${s.def}</td><td>특공</td><td>${s.spa}</td></tr>
          <tr><td>특방</td><td>${s.spd}</td><td>스피드</td><td>${s.spe}</td></tr></table>
        <div class="cc-ability">지닌 물건 ${c.held ? `${ITEMS[c.held].icon} <b>${esc(ITEMS[c.held].n)}</b>` : '<span class="dim">없음</span>'}</div>
        <div class="cc-moves">${mv.map(m => `<div class="move-row clickable" data-move="${m}" data-sp="${id}">${moveLine(m)}${masteryStar(id, m)}</div>`).join('')}</div>
        ${evoOptions(id).filter(e => e.ok).map(e => `<div class="row">${portraitImg(e.to, 'portrait xs', 'Normal', c.shiny)} <span class="grow">✨ <b>${esc(spName(e.to))}</b>(으)로 진화할 수 있어요${e.itemId ? ` <span class="dim">(${esc(ITEMS[e.itemId].n)} 사용)</span>` : ''}</span><button class="btn sm" data-act="evolve-mate" data-arg="${id}:${e.to}">진화</button></div>`).join('')}
        <div class="btns"><button class="btn sm" data-act="set-moves" data-arg="${id}">📘 기술</button> <button class="btn sm" data-act="hold" data-arg="${id}">지닌 물건</button>${c.held ? ` <button class="btn sm ghost" data-act="unhold" data-arg="${id}">빼기</button>` : ''} <button class="btn sm ghost danger" data-act="party-remove" data-arg="${id}">동료에서 빼기</button></div></details>`;
    };
    return `<div class="cc-party"><div class="cc-party-head">🤝 동료 ${pl.length}/${PARTY_MAX}${pl.length < PARTY_MAX ? ' <button class="btn sm ghost" data-act="party-add">＋ 추가</button>' : ''}</div>
      ${pl.length ? `<div class="dim tiny">작전은 던전에서 🤝 동료 버튼(V)으로 바꿔요. 탐험마다 '나를 따라와'로 시작해요.</div>${pl.map(one).join('')}` : `<div class="dim">동료 없이 혼자 탐험합니다. <span title="혼자 탐험 보정">(받는 데미지 ${SOLO_DMG_MUL}배, 능력치 ${SOLO_STAT_MUL}배)</span></div>`}</div>`;
  }
  function partySection() {
    const pl = partyList(), cand = Object.keys(save.roster).map(Number).filter(id => id !== save.current && !pl.includes(id));
    return `<h3>🤝 동료 <span class="dim">(${pl.length}/${PARTY_MAX} · 일반·테마 던전에 함께 간다. 로그라이크와 오늘의 도전은 혼자)</span></h3>
      <p class="dim">동료는 스스로 싸우고 리더를 따라온다. 경험치도 함께 받는다. 쓰러지면 그 탐험에서만 빠지고, 리더가 쓰러지면 탐험이 끝난다. 동료가 있으면 혼자 탐험 보정(받는 데미지 ${SOLO_DMG_MUL}배, 능력치 ${SOLO_STAT_MUL}배)은 없다. 동료가 모두 쓰러져도 생기지 않는다.</p>
      <div class="roster">${pl.map(id => `<button class="rcard on" data-act="party-remove" data-arg="${id}" title="눌러서 빼기">${portraitImg(id, 'portrait sm', 'Normal', save.roster[id].shiny)}<span>${esc(spName(id))}</span><span class="dim">Lv${save.roster[id].lv} · 빼기</span>${heldOfRoster(id) ? `<b class="pk-held" title="지닌 물건: ${esc(ITEMS[heldOfRoster(id)].n)}">${Gfx.iconHtml(heldOfRoster(id))}</b>` : ''}</button>`).join('')}
        ${pl.length < PARTY_MAX && cand.length ? '<button class="rcard" data-act="party-add"><span style="font-size:22px">＋</span><span>동료 추가</span></button>' : ''}</div>
      ${!cand.length && !pl.length ? '<p class="dim">던전에서 영입한 포켓몬이 있어야 동료로 데려갈 수 있어요.</p>' : ''}`;
  }
  function partyAdd() {
    const pl = partyList(), cand = Object.keys(save.roster).map(Number).filter(id => id !== save.current && !pl.includes(id)).sort((a, b) => (isFav(b) - isFav(a)) || save.roster[b].lv - save.roster[a].lv);
    if (!cand.length) return;
    chooseCharacter(id => { save.party = [...partyList(), id].slice(0, PARTY_MAX); persist(); renderTown(); }, false, cand, null,
      { title: `🤝 동료 추가 (${pl.length}/${PARTY_MAX})`, ok: '동료로 데려간다', note: `동료로 데려갈 포켓몬을 고르세요. (영입한 포켓몬 중 지금 리더와 동료를 뺀 ${cand.length}마리)` });
  }

  // 폼체인지·메가진화 (js/forms.js): 고를 수 있는 모습은 여기서 고르고, 나머지는 던전에서 바뀌는 방법을 보여준다
  function formSection(sp, ch) {
    const forms = FORMS_OF[sp] || [];
    if (!forms.length) return '';
    const sel = forms.filter(id => DATA.species[id].fc === 'select'), other = forms.filter(id => DATA.species[id].fc !== 'select');
    const need = id => FORM_NEEDS[id] && !save.roster[FORM_NEEDS[id]] ? FORM_NEEDS[id] : null;   // 먼저 영입해야 하는 포켓몬
    const card = (id, on, act) => `<button class="rcard ${on ? 'on' : ''}" ${act ? `data-act="set-form" data-arg="${id}"` : `data-dexpoke="${id}"`} ${need(id) ? `disabled title="${esc(jo(spName(need(id)), '을'))} 동료로 영입하면 고를 수 있어요"` : ''}>${portraitImg(id, 'portrait sm', 'Normal', ch.shiny)}<span>${esc(id === sp ? '기본 모습' : spName(id))}</span>${id !== sp ? `<span class="dim">${typeBadges(DATA.species[id].t)}</span>` : ''}${need(id) ? `<span class="dim">🔒 ${esc(spName(need(id)))} 영입 필요</span>` : ''}</button>`;
    return `<h3>다른 모습 <span class="dim">(능력치·타입·특성이 바뀌고 기술은 그대로)</span></h3>
      ${sel.length ? `<p class="dim">던전에 들고 갈 모습을 고르세요.${sel.some(id => FORM_SIG[id]) ? ` 모습마다 전용기가 있어요: ${sel.filter(id => FORM_SIG[id]).map(id => esc(DATA.moves[FORM_SIG[id]].n)).join(' · ')} (기술 설정에서)` : ''}${sel.some(id => DATA.species[id].sb) ? ' 던전 그림은 아직 없어서 기본 모습으로 보여요.' : ''}</p><div class="roster">${card(sp, !ch.form, true)}${sel.map(id => card(id, ch.form === id, true)).join('')}</div>` : ''}
      ${other.map(id => `<div class="row">${portraitImg(id, 'portrait sm', 'Normal', ch.shiny)}<div class="grow"><b>${esc(spName(id))}</b> ${typeBadges(DATA.species[id].t)}<div class="dim">${esc(formHowText(id))}</div></div></div>`).join('')}`;
  }
  const ownedCount = id => (save.storage[id] || 0) + save.bag.filter(b => b.id === id).length;
  function vitaminSection(ch, sp) {
    const b = ch.boost || {};
    return `<div class="vit-grid">${Object.entries(VITAMINS).map(([id, [n, k, sn, v]]) => {
      const cnt = b[k] || 0, own = ownedCount(id), full = cnt >= VITAMIN_MAX;
      return `<div class="vit"><div><b>${sn}</b> <span class="dim">+${cnt * v}</span></div>
        <span class="pips">${'●'.repeat(cnt)}${'○'.repeat(VITAMIN_MAX - cnt)}</span>
        <button class="btn sm${own ? '' : ' ghost'}" data-act="vitamin" data-arg="${id}:${sp}" ${own && !full ? '' : 'disabled'} title="${esc(ITEMS[id].d)}">🥤 ${esc(n)} ×${own}</button></div>`;
    }).join('')}</div>`;
  }
  function gummySection(ch, sp) {
    const b = ch.boost || {};
    const counts = Object.entries(STAT_KO).map(([k, n]) => `<span class="gm-stat"><b>${n}</b> +${(b['g_' + k] || 0) * gummyAmt(k)} <span class="dim">(${b['g_' + k] || 0}/${GUMMY_MAX})</span></span>`).join('');
    const own = Object.keys(GUMMIES).filter(id => ownedCount(id));
    return `<div class="gm-counts">${counts}</div>
      <div class="btns">${own.length ? own.map(id => `<button class="btn sm" data-act="gummy" data-arg="${id}:${sp}" title="${esc(ITEMS[id].d)}">${ITEMS[id].icon} ${esc(ITEMS[id].n)} ×${ownedCount(id)}</button>`).join(' ')
        : '<span class="dim">가진 구미가 없습니다. 던전 깊은 곳에서 아주 드물게 발견됩니다.</span>'}</div>`;
  }
  function useGummy(id, sp = save.current) {
    const g = ITEMS[id], ch = save.roster[sp];
    ch.boost = { ...(ch.boost || {}) };
    const up = g.gummy.filter(k => (ch.boost['g_' + k] || 0) < GUMMY_MAX);
    if (!up.length || !ownedCount(id)) { UI.toast('더 이상 오르지 않습니다.'); return; }
    takeItem(id);
    up.forEach(k => { ch.boost['g_' + k] = (ch.boost['g_' + k] || 0) + 1; });
    Sound.play('levelup');
    UI.toast(`${jo(spName(sp), '은')} ${jo(g.n, '을')} 먹었다! ${up.map(k => `${STAT_KO[k]} +${gummyAmt(k)}`).join(', ')}`);
  }
  function useVitamin(id, sp = save.current) {
    const [n, k, sn, v] = VITAMINS[id], ch = save.roster[sp];
    ch.boost = ch.boost || {};
    if ((ch.boost[k] || 0) >= VITAMIN_MAX || !ownedCount(id)) return;
    const bi = save.bag.findIndex(b => b.id === id);
    if (bi >= 0) save.bag.splice(bi, 1); else { save.storage[id]--; if (save.storage[id] <= 0) delete save.storage[id]; }
    ch.boost[k] = (ch.boost[k] || 0) + 1;
    Sound.play('levelup');
    UI.toast(`${jo(spName(sp), '은')} ${jo(n, '을')} 먹었다! ${jo(sn, '이')} ${v} 올랐다!`);
    Progress.check();
  }

  // 이상한사탕: 마을에서도 리더나 동료의 레벨을 1 올린다 (새로 배우는 기술은 빈 칸에, 나머지는 기술 설정에서)
  async function useCandy(sp = null) {
    if (!ownedCount('candy')) return;
    if (sp == null) {
      const list = [save.current, ...partyList()];
      if (list.length > 1) {
        UI.open({ title: '누구에게 먹일까요?', choices: list.map(id => ({ label: `${id === save.current ? '👑 ' : '🤝 '}${esc(spName(id))} <span class="dim">Lv${save.roster[id].lv}</span>`, disabled: save.roster[id].lv >= MAX_LEVEL, fn: () => setTimeout(() => useCandy(id), 0) })) });
        return;
      }
      sp = save.current;
    }
    const ch = save.roster[sp];
    if (ch.lv >= MAX_LEVEL) { UI.toast('이미 최고 레벨입니다.'); return; }
    if (!(await UI.confirm('이상한사탕', `<p>${esc(spName(sp))}에게 이상한사탕을 먹입니다. (Lv${ch.lv} → Lv${ch.lv + 1})</p>`, '먹인다', '그만둔다'))) return;
    takeItem('candy');
    ch.lv++; ch.exp = Math.pow(ch.lv, 3);   // 그 레벨의 시작 경험치 (expFor는 최고 레벨에서 Infinity)
    const learned = learnedAtAll(sp, ch.lv).filter(mid => !ch.moves.includes(mid));
    const added = learned.filter(mid => ch.moves.length < 4 && ch.moves.push(mid));
    Progress.max('maxLv', ch.lv); Progress.check();
    Sound.play('levelup'); persist(); renderTown();
    const rest = learned.filter(mid => !added.includes(mid));
    UI.alert('레벨 업!', `<div class="center">${portraitImg(sp, 'portrait big', 'Joyous', ch.shiny)}</div><p class="center">${esc(spName(sp))}의 레벨이 올랐다! <b>Lv${ch.lv}</b></p>
      ${added.length ? `<p class="center">새 기술: ${added.map(mid => esc(DATA.moves[mid].n)).join(', ')}</p>` : ''}
      ${rest.length ? `<p class="center dim">새로 배울 수 있는 기술: ${rest.map(mid => esc(DATA.moves[mid].n)).join(', ')} (기술 설정에서 고르세요)</p>` : ''}
      ${evoOptions(sp).some(e => e.ok) ? '<p class="center">✨ 진화할 수 있어요! 캐릭터 탭에서 진화하세요.</p>' : ''}`);
  }

  // 특성 바꾸기: 일반 특성은 특성캡슐, 숨겨진 특성은 특성패치를 하나 쓴다
  function takeItem(id) {
    const bi = save.bag.findIndex(b => b.id === id);
    if (bi >= 0) save.bag.splice(bi, 1); else { save.storage[id]--; if (save.storage[id] <= 0) delete save.storage[id]; }
  }
  async function changeAbility(aid) {
    const sp = tmWho(), ch = save.roster[sp];
    const slot = DATA.species[sp].ab.find(a => a[0] === aid); if (!slot) return;
    const need = slot[1] ? 'abpatch' : 'abcapsule', it = ITEMS[need];
    if (!ownedCount(need)) { UI.alert('특성 바꾸기', `<p>${it.icon} <b>${esc(jo(it.n, '이'))}</b> 필요합니다.</p><p class="dim">마을 상점에 가끔 진열되고, 던전에서 드물게 주울 수 있어요.</p>`); return; }
    const ok = await UI.confirm('특성 바꾸기', `<p>${esc(spName(sp))}의 특성을 <b>${esc(abilityName(entryAbility(sp, ch)))}</b> → <b>${esc(jo(abilityName(aid), '으로'))}</b> 바꿉니다.${slot[1] ? ' <span class="dim">(숨겨진 특성)</span>' : ''}</p>
      <p>${it.icon} ${esc(it.n)} 1개를 사용합니다. <span class="dim">(가진 개수 ${ownedCount(need)})</span></p>`, '바꾼다', '그만둔다');
    if (!ok) return;
    takeItem(need);
    ch.ability = aid;
    Sound.play('item');
    persist(); renderTown();
    UI.toast(`특성을 ${jo(abilityName(aid), '으로')} 바꿨습니다.`);
  }

  // 사용자 타일셋(DTEF) 설정 화면. 지금은 꺼져 있다 (tiles.js의 CUSTOM_TILESETS)
  // 사용자 타일셋·음악 파일 불러오기 (v0.92부터 정보 탭에서 숨김: 원작 그림·음악이 기본으로 들어 있어서. 다시 보이려면 tabInfo에서 부르면 된다)
  function tilesetSection(s) {
    return `<h3>던전 타일셋 <span class="dim">(선택 사항)</span></h3>
      <p class="dim">기본은 게임이 직접 그린 타일입니다. 직접 구한 <b>DTEF 형식</b> 타일셋 PNG(가로:세로 18:8, 예: 432×192)를 불러오면 그 던전의 벽·바닥이 바뀝니다.
        변형 타일(<code>tileset_1.png</code>, <code>tileset_2.png</code>)도 함께 선택하면 섞어서 그립니다.
        불러온 파일은 이 브라우저에만 저장되고, 게임 파일에는 포함되지 않습니다. 게임 폴더의 <code>tiles/던전ID.png</code>(변형은 <code>던전ID_1.png</code>, <code>던전ID_2.png</code> / 공통은 <code>default.png</code>)에 넣어도 됩니다.</p>
      <label class="chk"><input type="checkbox" data-set="useTileset" ${s.useTileset === true ? 'checked' : ''}> 불러온 타일셋 사용 (끄면 기본 타일)</label>
      ${s.useTileset !== true ? '' : `<div class="tileset-list">${[{ id: '*', n: '모든 던전 공통' }, ...DUNGEONS].map(d => {
        const st = d.id === '*' ? (Tiles.uploaded['*'] ? '불러옴' : '') : Tiles.status(d.id);
        return `<div class="row"><span class="grow">${esc(d.n)} <span class="dim">${d.id === '*' ? '' : d.id}</span> ${st ? `<span class="tag">${st}</span>` : ''}</span>
          <label class="btn sm ghost">PNG 불러오기<input type="file" accept="image/png" multiple data-tileset="${d.id}" hidden></label>
          ${Tiles.uploaded[d.id] ? `<button class="btn sm ghost danger" data-act="tileset-del" data-arg="${d.id}">삭제</button>` : ''}</div>`;
      }).join('')}</div>`}`;
  }

  // 배경음악 파일 설정: music/ 폴더에 넣거나 여기서 불러온다 (불러온 파일은 이 브라우저에만 저장)
  function musicSection() {
    const rows = [{ id: 'title', n: '타이틀 (없으면 마을 곡)' }, { id: 'town', n: '마을' }, { id: 'boss', n: '보스전' }, { id: 'dungeon', n: '던전 공통 (던전별 파일이 없을 때)' },
      ...DUNGEONS.filter(d => !d.daily && (!d.hidden || unlocked(d))).map(d => ({ id: d.id, n: d.n }))];   // 오늘의 도전은 날마다 던전 곡 중 하나 (못 찾은 숨은 던전은 뺀다)
    return `<h3>배경음악 파일 <span class="dim">(선택 사항)</span></h3>
      <p class="dim">기본은 게임이 직접 합성한 배경음입니다. 음악 파일(ogg / mp3 / m4a / wav)을 불러오거나 게임 폴더의 <code>music/이름.ogg</code>에 넣으면 그 곡을 반복 재생합니다.
        파일이 없는 곳은 합성 배경음이 나옵니다. 불러온 파일은 이 브라우저에만 저장되고 게임 파일에는 포함되지 않습니다.</p>
      <div class="tileset-list">${rows.map(r => `<div class="row"><span class="grow">${esc(r.n)} <span class="dim">music/${r.id}.ogg</span> ${Sound.uploaded.has(r.id) ? '<span class="tag">불러옴</span>' : ''}</span>
        <button class="btn sm ghost" data-act="music-loop" data-arg="${r.id}" title="인트로 뒤 반복 구간 설정">🔁 루프</button>
        <label class="btn sm ghost">파일 불러오기<input type="file" accept="audio/*,.ogg,.mp3,.m4a,.wav" data-music="${r.id}" hidden></label>
        ${Sound.uploaded.has(r.id) ? `<button class="btn sm ghost danger" data-act="music-del" data-arg="${r.id}">삭제</button>` : ''}</div>`).join('')}</div>`;
  }

  // 곡의 루프 구간 설정
  async function musicLoopDialog(key) {
    const info = await Sound.loopInfo(key);
    if (!info) { UI.alert('루프 설정', `<p>이 곡의 음악 파일이 없습니다. <code>music/${esc(key)}.ogg</code>에 넣거나 파일을 불러오세요.</p>`); return; }
    const f = v => (v == null ? '' : (+v).toFixed(3));
    const src = info.user ? '정보 탭에서 설정한 값' : info.cfg ? 'music/loops.js' : info.tags ? '파일 안의 루프 정보' : '없음 (곡 전체 반복)';
    const m = UI.open({
      title: `🔁 루프 구간 — ${esc(key)}`, wide: true,
      html: `<p>곡 길이 <b>${info.dur.toFixed(2)}초</b> · 지금 쓰는 루프: <b>${info.use ? `${f(info.use.start)}초 ~ ${f(info.use.end)}초` : '곡 전체'}</b> <span class="dim">(${src})</span></p>
        ${info.tags ? `<p class="dim">파일 안의 루프 정보: ${f(info.tags.start)}초 ~ ${info.tags.end ? f(info.tags.end) + '초' : '끝'}</p>` : ''}
        ${info.cfg ? `<p class="dim">music/loops.js: ${f(info.cfg.start)}초 ~ ${info.cfg.end ? f(info.cfg.end) + '초' : '끝'}</p>` : ''}
        <div class="loop-form"><label>루프 시작 <input type="number" step="0.001" min="0" id="lp-s" value="${f(info.use ? info.use.start : 0)}">초</label>
          <label>루프 끝 <input type="number" step="0.001" min="0" id="lp-e" value="${f(info.use ? info.use.end : info.dur)}">초</label></div>
        <p class="dim">곡이 루프 끝에 닿으면 루프 시작으로 돌아갑니다. 끝을 비우면 곡 끝까지.
          ${info.exact ? '' : '<br>⚠ 게임을 파일로 직접 열면(file://) 브라우저 제한 때문에 연결 부분에서 아주 짧게 끊길 수 있어요. 파일 안의 루프 정보도 읽지 못해서, 여기서 설정하거나 music/loops.js에 적어야 합니다.'}</p>`,
      choices: [
        { label: '저장', fn: () => { Sound.endPreview(); const s0 = +document.getElementById('lp-s').value || 0, e0 = +document.getElementById('lp-e').value || 0; Sound.setLoop(key, { start: s0, end: e0 }); UI.toast('루프 구간을 저장했습니다.'); renderTown(); } },
        { label: '🎧 연결 부분 들어 보기 (저장된 값 기준, 끝나기 3초 전부터)', fn: async () => { const ok = await Sound.previewLoop(key); if (!ok) UI.toast('들을 수 없습니다.'); setTimeout(() => musicLoopDialogKeep(key), 0); } },
        { label: '설정 지우기 (파일 정보·loops.js 사용)', fn: () => { Sound.endPreview(); Sound.setLoop(key, null); UI.toast('설정을 지웠습니다.'); } },
        { label: '닫기', fn: () => Sound.endPreview() },
      ],
    });
    return m;
  }
  // 미리 듣기 중에는 같은 창을 다시 띄운다
  function musicLoopDialogKeep(key) { musicLoopDialog(key); }

  function tabInfo() {
    const cr = DATA.species[save.current].cr || ['?', '?'];
    const s = save.settings;
    return `<h3>버전</h3>
      <div class="row"><span class="grow">미궁 탐험대 <b>v${GAME_VERSION}</b> <span class="dim">(${GAME_DATE})</span>${ENV === 'dev' ? ' <span class="tag">개발 환경</span>' : ''}${updateVer ? ` <a href="#" data-act="update">🔔 새 버전 v${esc(updateVer)}</a>` : ''}
        <div class="dim">친구와 구조 코드나 오늘의 도전 기록을 주고받을 때는 서로 같은 버전인지 확인하세요.</div></span>
        <button class="btn sm ghost" data-act="version-notes">변경 내역</button>${save.endingSeen || save.cleared?.[ENDING_DUNGEON] ? ' <button class="btn sm ghost" data-act="ending">🎬 엔딩 다시 보기</button>' : ''}${Online.enabled() ? ' <button class="btn sm ghost" data-act="ending-stats">🌍 엔딩 통계</button>' : ''}</div>
      <h3>⚙ 설정</h3><div class="row"><span class="grow">화면 · 소리 · 조작 · 플레이</span><button class="btn sm" data-act="settings">설정 열기</button></div>
      <h3>📖 게임 가이드</h3><div class="row"><span class="grow">타입 상성 · 전투 규칙 · 상태이상 · 날씨 · 조작법 등</span><button class="btn sm" data-act="guide-menu">가이드 보기</button></div>
      ${Story.replayHtml()}
      ${Online.enabled() ? `<h3>☁ 계정</h3><div class="row"><span class="grow">${Online.loggedIn() ? `<b>${esc(Online.name())}</b> 님으로 로그인 · 세이브가 클라우드에도 저장됩니다${cloudErr ? ` <span class="warn">(${esc(cloudErr)})</span>` : ''}` : '로그인하지 않았어요. 로그인하면 다른 기기에서 이어하고 구조 게시판을 쓸 수 있어요.'}</span>
        <button class="btn sm${Online.loggedIn() ? ' ghost' : ''}" data-act="account">${Online.loggedIn() ? '계정' : '로그인 / 가입'}</button></div>` : ''}
      ${Online.enabled() ? `<h3>🏆 스타팅 순위</h3><div class="row"><span class="grow">탐험대가 처음 고른 포켓몬 순위 <span class="dim">(로그인한 탐험대 기준 · 하루에 한 번 갱신)</span></span>
        <button class="btn sm ghost" data-act="starter-rank">보기</button></div>` : ''}
      ${ENV === 'dev' ? '<div class="btns"><button class="btn ghost" data-act="dev-admin" title="로컬(개발)에서만 보입니다">🛠 운영자 테스트 계정으로 만들기 (개발용)</button></div>' : ''}
      <h3>세이브 관리</h3>
      <p class="dim">${Online.loggedIn() ? '세이브는 이 브라우저와 클라우드에 저장됩니다. 만일을 위해 가끔 파일로도 내보내 두세요.' : '세이브는 이 브라우저에만 저장됩니다. 브라우저 데이터를 지우거나 다른 컴퓨터로 옮기기 전에 파일로 내보내 두세요.'}</p>
      <div class="btns"><button class="btn" data-act="save-export">💾 세이브 내보내기</button> <button class="btn ghost" data-act="save-import">📂 세이브 불러오기</button> <button class="btn ghost danger" data-act="reset">저장 데이터 초기화</button>
        <input type="file" id="save-file" accept=".json,application/json" hidden></div>
      ${backups().length ? `<p class="dim">업데이트할 때 자동으로 만든 백업 (최근 3개)</p>${backups().map((b, i) => `<div class="row"><span class="grow">v${esc(b.ver)} 세이브 <span class="dim">${esc(new Date(b.at).toLocaleString())}</span></span>
        <button class="btn sm ghost" data-act="restore-backup" data-arg="${i}">이 백업으로 복원</button></div>`).join('')}` : ''}
      <h3>크레딧</h3>
      <p>포켓몬 스프라이트와 초상화: <a href="https://sprites.pmdcollab.org/" target="_blank" rel="noopener">PMD Sprite Repository (SpriteCollab)</a>, CC BY-NC 4.0.<br>
      현재 캐릭터 ${esc(spName(save.current))}: 스프라이트 by ${esc(cr[0])} / 초상화 by ${esc(cr[1] || '?')}</p>
      <p>포켓몬 데이터(이름, 능력치, 기술): <a href="https://pokeapi.co/" target="_blank" rel="noopener">PokeAPI</a></p>
      <p>원작 던전 타일셋·음악 (게임 폴더의 tiles/, music/에 들어 있는 경우): Pokémon Mystery Dungeon 시리즈 © Nintendo / Spike Chunsoft</p>
      <p>던전의 아이템·함정·상태 이상 도트 그림: Pokémon Mystery Dungeon: Red Rescue Team © Nintendo / Spike Chunsoft (The Spriters Resource)</p>
      <p>이 게임의 소스 코드: GNU AGPL-3.0 (게임 폴더의 LICENSE 파일)</p>
      <p>버그 제보 · 문의 · 삭제 요청: <a href="https://github.com/pmd-fan-web/pmd-fan-web.github.io/issues" target="_blank" rel="noopener">GitHub Issues</a></p>
      <h3>개인정보</h3>
      <p class="dim">로그인하지 않으면 모든 기록은 이 브라우저에만 저장되고, 서버로 보내지 않습니다.
        로그인하면 <b>아이디, 닉네임, 세이브, 마지막 접속 시각</b>과 구조 게시판에 올린 요청, 오류 기록(어떤 기능이 몇 번 실패했는지), 엔딩 통계(엔딩을 처음 본 순간의 기록, 누구의 것인지 알 수 없게 숫자로만 합산)만 서버(Google Firebase)에 저장합니다. 이메일·전화번호 같은 개인정보는 받지 않고, 광고나 방문 기록 분석도 하지 않습니다.
        계정 창의 <b>계정 삭제</b>로 언제든 서버의 기록을 모두 지울 수 있습니다. (스타팅 순위에 더해진 포켓몬 번호 하나는 누구 것인지 알 수 없는 형태로 순위에 남습니다.)</p>
      <p class="dim">비상업적 팬 게임입니다. Pokémon © Nintendo / Creatures Inc. / GAME FREAK inc. Pokémon Mystery Dungeon © Spike Chunsoft.</p>`;
  }

  async function onAction(act, arg) {
    switch (act) {
      case 'go': return prepareRun(arg);
      case 'go-hard': return prepareHard(arg);
      case 'take-mission': {
        const i = save.missions.board.findIndex(m => m.id === arg);
        if (i >= 0 && save.missions.accepted.length < missionMax()) save.missions.accepted.push(save.missions.board.splice(i, 1)[0]);
        break;
      }
      case 'drop-mission': {
        if (!(await UI.confirm('임무 취소', '<p>이 임무를 취소하시겠습니까?</p>'))) return;
        const dm = save.missions.accepted.find(m => m.id === arg);
        if (dm && dm.online && dm.docId) Online.releaseSOS(dm.docId).catch(() => {});   // 게시판 구조: 다른 사람이 받을 수 있게
        save.missions.accepted = save.missions.accepted.filter(m => m.id !== arg);
        break;
      }
      case 'buy': {
        const it = ITEMS[arg];
        if (save.money < it.price || !shopLeft(arg)) return;
        const n = it.stack ? 5 : 1;
        if (!bagAdd(arg, n)) {
          if (!storageRoom(arg, n)) { UI.toast('가방과 창고가 모두 가득 찼습니다.'); return; }
          storeKeep(arg, n); UI.toast('가방이 가득 차서 창고로 보냈습니다.');
        }
        else UI.toast(`${jo(it.n, '을')} 샀습니다.`);
        save.money -= it.price;
        if (!shopFixedFor(save).includes(arg)) (save.shopBought = save.shopBought || {})[arg] = 1;
        break;
      }
      case 'shop-reroll': {
        if (save.money < SHOP_REROLL_COST) return;
        if (!(await UI.confirm('상점 새로고침', `<p>₽${SHOP_REROLL_COST}을 내고 오늘 진열된 물건을 새로 뽑습니다.</p><p class="dim">지금 진열된 물건은 사라집니다.</p>`, '새로고침', '그만둔다'))) return;
        save.money -= SHOP_REROLL_COST; rollShop(); UI.toast('상점 진열이 바뀌었습니다!');
        break;
      }
      case 'sell': {
        const b = save.bag[+arg]; if (!b) return;
        const v = sellPrice(b);
        save.money += v; save.bag.splice(+arg, 1); logSale(b.id, b.n, v, 'bag');
        UI.toast(`${jo(ITEMS[b.id].n, '을')} ₽${v}에 팔았습니다. (상점 탭에서 되살 수 있어요)`);
        break;
      }
      case 'sell-store': {   // 창고에서 바로 팔기: 하나씩 (겹치는 물건은 5개 묶음)
        const id = arg, have = save.storage[id] || 0; if (!have || !ITEMS[id] || id === 'quest') return;
        const n = ITEMS[id].stack ? Math.min(5, have) : 1, v = sellValue({ id, n });
        save.storage[id] -= n; if (save.storage[id] <= 0) delete save.storage[id];
        save.money += v; logSale(id, n, v, 'storage');
        UI.toast(`${jo(ITEMS[id].n, '을')} ${n > 1 ? n + '개 ' : ''}₽${v}에 팔았습니다. (상점 탭에서 되살 수 있어요)`);
        break;
      }
      case 'buyback': {   // 최근에 판 물건을 판 값 그대로 되사기
        const e = (save.soldLog || [])[+arg]; if (!e || save.money < e.money) return;
        if (e.from === 'bag' && bagAdd(e.id, e.n)) { /* 가방으로 */ }
        else if (storageRoom(e.id, e.n)) storeKeep(e.id, e.n);
        else if (bagAdd(e.id, e.n)) { /* 창고가 가득 차면 가방으로 */ }
        else { UI.toast('가방과 창고가 모두 가득 찼습니다.'); return; }
        save.money -= e.money; save.soldLog.splice(+arg, 1);
        UI.toast(`${jo(ITEMS[e.id].n, '을')} 되샀습니다.`);
        break;
      }
      case 'withdraw': {
        const n = ITEMS[arg].stack ? save.storage[arg] : 1;
        if (!bagAdd(arg, n)) { UI.toast('가방이 가득 찼습니다.'); return; }
        save.storage[arg] -= n; if (save.storage[arg] <= 0) delete save.storage[arg];
        break;
      }
      case 'preset-save': presetSave(+arg); break;
      case 'preset-load': presetLoad(+arg); break;
      case 'preset-name': return presetName(+arg);
      case 'auto-sell': return toggleAutoSell(arg);
      case 'dlg-tms': return tmStoreDialog();
      case 'dlg-autosell': return autoSellDialog();
      case 'deposit': {
        const b = save.bag[+arg]; if (!b) return;
        if (!autoSells(b.id) && !storageRoom(b.id, b.n)) { UI.toast('창고가 가득 찼습니다. 창고를 확장하세요.'); return; }
        save.bag.splice(+arg, 1); storeDeposit(b.id, b.n); break;
      }
      case 'deposit-all': {
        const keep = [];
        for (const b of save.bag) { if (autoSells(b.id) || storageRoom(b.id, b.n)) storeDeposit(b.id, b.n); else keep.push(b); }
        if (keep.length) UI.toast('창고가 가득 차서 일부를 맡기지 못했습니다.');
        save.bag = keep; break;
      }
      case 'store-sort': if (STORE_SORTS[arg]) save.storageSort = arg; break;
      case 'sort-bag': save.bag.sort((a, b) => byKind(a.id, b.id)); break;
      case 'up-bag': {
        const cost = bagUpgradeCost(save.bagMax);
        if (save.bagMax >= BAG_LIMIT || save.money < cost) return;
        if (!(await UI.confirm('가방 확장', `<p>₽${cost}을 내고 가방을 ${save.bagMax}칸 → ${save.bagMax + BAG_STEP}칸으로 늘립니다.</p>`, '확장한다', '그만둔다'))) return;
        save.money -= cost; save.bagMax += BAG_STEP; UI.toast(`가방이 ${save.bagMax}칸이 되었습니다!`);
        break;
      }
      case 'up-storage': {
        const cost = storageUpgradeCost(save.storageMax);
        if (save.storageMax >= STORAGE_LIMIT || save.money < cost) return;
        if (!(await UI.confirm('창고 확장', `<p>₽${cost}을 내고 창고를 ${save.storageMax}칸 → ${save.storageMax + STORAGE_STEP}칸으로 늘립니다.</p>`, '확장한다', '그만둔다'))) return;
        save.money -= cost; save.storageMax += STORAGE_STEP; UI.toast(`창고가 ${save.storageMax}칸이 되었습니다!`);
        break;
      }
      case 'discard': {
        if (!(await UI.confirm('버리기', `<p>${esc(jo(ITEMS[save.bag[+arg].id].n, '을'))} 버리시겠습니까?</p>`))) return;
        save.bag.splice(+arg, 1); break;
      }
      case 'change-char': chooseCharacter(sp => switchChar(sp), false, Object.keys(save.roster).map(Number)); return;
      case 'switch': if (save.roster[+arg]) switchChar(+arg); break;
      case 'host-next': hostTurn++; renderTown(); return;
      case 'party-add': return partyAdd();
      case 'evolve-mate': { const [m, to] = String(arg).split(':').map(Number); if (save.roster[m] && m !== save.current) return evolve(to, m); return; }
      case 'party-remove': save.party = partyList().filter(id => id !== +arg); break;
      case 'set-moves': return setMoves(arg && save.roster[+arg] ? +arg : save.current);
      case 'code-enter': return enterCode();
      case 'account': return accountDialog();
      case 'sos-board': return sosBoard();
      case 'starter-rank': return starterRank();
      case 'update': return askUpdate();
      case 'restore-backup': return restoreBackup(+arg);
      case 'dgtab': dgTab = arg; break;
      case 'dg-info': return showDungeonInfo(arg);
      case 'ending': return showEnding(false);
      case 'ending-stats': return showEndingStats();
      case 'version-notes': UI.alert('변경 내역', VERSION_NOTES.map(([v, list]) => `<h3>v${v}${v === GAME_VERSION ? ' <span class="tag">지금 버전</span>' : ''}</h3><ul>${list.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')); return;
      case 'vitamin': { const [id, sp] = arg.split(':'); useVitamin(id, save.roster[+sp] ? +sp : save.current); break; }
      case 'use-candy': return useCandy(arg && save.roster[+arg] ? +arg : null);
      case 'gummy': { const [id, sp] = arg.split(':'); useGummy(id, save.roster[+sp] ? +sp : save.current); break; }
      case 'boost-toggle': { const ch = save.roster[arg && save.roster[+arg] ? +arg : save.current]; ch.boost = { ...(ch.boost || {}) }; if (ch.boost.off) delete ch.boost.off; else ch.boost.off = true; UI.toast(ch.boost.off ? '영양제·구미 효과를 껐습니다.' : '영양제·구미 효과를 켰습니다.'); break; }
      case 'devolve': return devolve();
      case 'daily-go': return prepareDaily();
      case 'daily-share': { const rec = Progress.dailyRecord(); if (rec) codeBox('🗓 오늘의 도전 기록', '<p>친구에게 보내서 기록을 비교해 보세요.</p>', esc(Progress.shareText(rec).replace(/\n/g, ' · ')), '확인'); return; }
      case 'sos-show': if (save.sos && save.sos.online && !save.sos.revived && !Online.serverDown()) {
        const s = save.sos, ok = await Promise.race([Online.probeSOS(s.docId || s.id).then(() => true, () => false), new Promise(res => setTimeout(() => res(false), SOS_POST_WAIT))]);
        if (ok) { sosPostedNote(s); return; }
        renderTown();
      } if (save.sos) codeBox('🆘 SOS 코드', `<p>${esc(dungeonById(save.sos.dungeon).n)} ${save.sos.floor}F — ${esc(spName(save.sos.sp))} Lv${save.sos.lv}</p>${save.sos.online ? '<p class="warn">지금 서버가 막혀 있어서 구조 게시판이 동작하지 않아요. 서버가 돌아올 때까지는 이 코드로 친구에게 구조를 부탁할 수 있어요.</p>' : ''}`, sosCode(save.sos)); return;
      case 'sos-giveup': return giveUpSOS();
      case 'sos-resume': return save.sos && save.sos.thx ? resumeSOS() : receiveAOKAgain();
      case 'aok-show': { const a = (save.aokSent || []).find(x => String(x.id) === arg); if (a) codeBox('✅ A-OK 코드', `<p>친구의 ${esc(spName(a.sp))} 구조 완료 코드입니다.</p>`, a.code); return; }
      case 'set-form': {
        const sp = tmWho(), ch = save.roster[sp], id = +arg;
        if (id === sp) { delete ch.form; UI.toast('기본 모습으로 탐험합니다.'); break; }
        if (!(FORMS_OF[sp] || []).includes(id) || DATA.species[id].fc !== 'select') return;
        if (FORM_NEEDS[id] && !save.roster[FORM_NEEDS[id]]) { UI.toast(`${jo(spName(FORM_NEEDS[id]), '을')} 동료로 영입하면 고를 수 있어요.`); return; }
        ch.form = id;
        // 모습 전용기: 기술 칸이 비어 있으면 바로 넣고, 꽉 차 있으면 기술 설정에서 넣도록 안내
        const sig = FORM_SIG[id];
        if (sig && !ch.moves.includes(sig) && ch.moves.length < 4) { ch.moves = [...ch.moves, sig]; UI.toast(`${spName(id)}의 모습으로 탐험합니다. 전용기 ${jo(DATA.moves[sig].n, '을')} 넣었어요.`); break; }
        UI.toast(`${spName(id)}의 모습으로 탐험합니다.${sig && !ch.moves.includes(sig) ? ` 전용기 ${jo(DATA.moves[sig].n, '은')} 기술 설정에서 넣을 수 있어요.` : ''}`); break;
      }
      case 'toggle-shiny': { const ch = save.roster[tmWho()]; if (!shinyOk(tmWho())) return; ch.shiny = !ch.shiny; UI.toast(ch.shiny ? '✨ 이로치로 바꿨습니다.' : '보통 모습으로 바꿨습니다.'); break; }
      case 'save-export': exportSave(); return;
      case 'save-import': document.getElementById('save-file').click(); return;
      case 'unhold': { const ch = save.roster[arg ? +arg : save.current]; if (ch && ch.held) { storeKeep(ch.held); ch.held = null; UI.toast('지닌 물건을 창고에 넣었습니다.'); } break; }
      case 'hold': return chooseHeld(arg && save.roster[+arg] ? +arg : save.current);
      case 'use-tm': return useTM(arg);
      case 'tm-target': tmTarget = +arg; break;
      case 'learn-egg': return learnEgg(+arg);
      case 'set-ability': return changeAbility(+arg);
      case 'master-book': return useMasterBook(+arg);
      case 'evolve': return evolve(+arg, tmWho());
      case 'help': Dungeon.showHelp(); return;
      case 'key-settings': keySettings(); return;
      case 'settings': openSettings(); return;
      case 'dev-admin': return devAdmin();
      case 'story-list': return Story.openList();
      case 'team-name': return Story.askTeamName().then(renderTown);
      case 'guide': Guide.open(arg); return;
      case 'guide-menu': Guide.menu(); return;
      case 'music-loop': return musicLoopDialog(arg);
      case 'music-del': await Sound.removeMusic(arg); UI.toast('음악 파일을 삭제했습니다.'); break;
      case 'tileset-del': Tiles.setUploaded(arg, null); UI.toast('타일셋을 삭제했습니다.'); break;
      case 'reset': {
        if (!(await UI.confirm('초기화', `<p>모든 진행 상황을 지우고 처음부터 시작합니다. 계속하시겠습니까?</p>${Online.loggedIn() ? '<p class="warn">로그인 중이라 클라우드 세이브도 함께 지웁니다.</p>' : ''}`))) return;
        if (Online.loggedIn()) {
          try { bound = false; clearTimeout(upTimer); await Online.clearCloud(); setSyncMeta(null); }
          catch (e) { UI.alert('초기화 실패', `<p>클라우드 세이브를 지우지 못했어요. ${esc(Online.why(e))}</p>`); return; }
        }
        try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 무시 */ }
        reloadAfterReplace(); return;
      }
    }
    persist(); renderTown();
  }

  // 캐릭터 탭에서 보고 있는 포켓몬: 리더 또는 동료 (v0.91 기술머신, v0.93 캐릭터 탭 전체). 동료에서 빠지면 리더로 돌아간다
  let tmTarget = null;
  const tmWho = () => (tmTarget != null && partyList().includes(tmTarget) ? tmTarget : save.current);
  function tmWhoBar() {
    const list = [save.current, ...partyList()];
    if (list.length < 2) return '';
    return `<div class="btns tm-who">${list.map(id => `<button class="btn sm${id === tmWho() ? '' : ' ghost'}" data-act="tm-target" data-arg="${id}">${id === save.current ? '👑 ' : '🤝 '}${esc(spName(id))} <span class="dim">Lv${save.roster[id].lv}</span></button>`).join(' ')}</div>`;
  }
  // 가진 기술머신 목록 (가방 + 창고)
  function ownedTMs() {
    const ids = new Set([...save.bag.filter(b => ITEMS[b.id]?.tm).map(b => b.id), ...Object.keys(save.storage).filter(id => ITEMS[id]?.tm && save.storage[id] > 0)]);
    return [...ids].sort((a, b) => ITEMS[a].no - ITEMS[b].no);
  }
  function tmSection(sp, ch) {
    const own = ownedTMs();
    const learned = (ch.tms || []).filter(m => DATA.moves[m]);
    let h = learned.length ? `<div class="dim">배운 기술: ${learned.map(m => `<span class="ab-link" data-move="${m}">${esc(DATA.moves[m].n)}</span>`).join(', ')}</div>` : '';
    if (!own.length) return h + '<p class="dim">가진 기술머신이 없습니다. 상점에서 매일 2개씩 팔고, 던전에서 드물게 주울 수 있어요.</p>';
    const rows = own.map(id => {
      const it = ITEMS[id], ok = canLearnTM(sp, it.mv), known = learned.includes(it.mv) || ch.moves.includes(it.mv);
      return { id, it, usable: ok && !known, ok, known };
    }).sort((a, b) => b.usable - a.usable || a.it.no - b.it.no);
    const usable = rows.filter(r => r.usable).length;
    const cnt = id => (save.storage[id] || 0) + save.bag.filter(b => b.id === id).length;
    return h + `<div class="tm-bar"><span>가진 기술머신 <b>${own.length}</b>종 · 지금 배울 수 있는 것 <b>${usable}</b>종</span>
        <input class="tm-q" placeholder="기술 이름 검색" autocomplete="off">
        <label class="chk inline"><input type="checkbox" class="tm-only" checked> 배울 수 있는 것만</label></div>
      <div class="tm-box">${rows.map(r => `<div class="row tm-item" data-s="${esc(r.it.n.toLowerCase())}" data-u="${r.usable ? 1 : 0}"${r.usable ? '' : ' style="display:none"'}>
        <span class="grow">💿 <span class="ab-link" data-move="${r.it.mv}">${esc(r.it.n)}</span>${cnt(r.id) > 1 ? ` <span class="dim">×${cnt(r.id)}</span>` : ''}
        <span class="${r.ok ? 'dim' : 'warn'}">${r.known ? '이미 배움' : r.ok ? '' : '배울 수 없음'}</span></span>
        <button class="btn sm" data-act="use-tm" data-arg="${r.id}" ${r.usable ? '' : 'disabled'}>사용</button></div>`).join('')}
        <p class="dim tm-empty"${usable ? ' style="display:none"' : ''}>조건에 맞는 기술머신이 없습니다.</p></div>`;
  }
  async function useTM(id) {
    const sp = tmWho(), ch = save.roster[sp], it = ITEMS[id], mv = DATA.moves[it.mv];
    if (!canLearnTM(sp, it.mv)) return;
    if (!(await UI.confirm('기술머신', `<p>${esc(jo(it.n, '을'))} 사용해서 ${esc(spName(sp))}에게 ${esc(jo(mv.n, '을'))} 가르칩니다.</p><p class="dim">기술머신은 사라집니다.</p>`, '사용한다', '그만둔다'))) return;
    const bi = save.bag.findIndex(b => b.id === id);
    if (bi >= 0) save.bag.splice(bi, 1); else { save.storage[id]--; if (save.storage[id] <= 0) delete save.storage[id]; }
    ch.tms = [...new Set([...(ch.tms || []), it.mv])];
    Progress.add('tms'); Progress.check();
    if (ch.moves.length < 4) { ch.moves.push(it.mv); persist(); renderTown(); UI.toast(`${jo(mv.n, '을')} 배웠습니다!`); return; }
    persist(); renderTown();
    UI.open({
      title: `${esc(mv.n)} — 잊을 기술 선택`, html: `${moveDetailHtml(it.mv)}<p>기술을 4개 알고 있습니다. 지금 바꿀 기술을 고르세요.</p>`,
      choices: [...ch.moves.map((m, i) => ({ label: moveLine(m), fn: () => { ch.moves[i] = it.mv; persist(); renderTown(); UI.toast(`${jo(mv.n, '을')} 배웠습니다!`); } })),
        { label: '지금은 바꾸지 않는다 (나중에 기술 설정에서 넣을 수 있음)', fn: () => {} }],
    });
  }

  // 교배기술: 교배기술머신 하나로 그 포켓몬(진화 전 모습 포함)의 교배기술 하나를 배운다. 배운 기술은 기술머신으로 배운 기술과 같이 ch.tms에 남는다
  function eggSection(sp, ch) {
    const eggs = eggMovesOf(sp);
    if (!eggs.length) return '<p class="dim">이 포켓몬은 교배기술이 없습니다.</p>';
    const have = ownedCount('eggtm');
    return `<div class="tm-box">${eggs.map(m => { const known = (ch.tms || []).includes(m) || ch.moves.includes(m); return `<div class="row">
      <span class="grow">🥚 <span class="ab-link" data-move="${m}">${esc(DATA.moves[m].n)}</span> <span class="dim">${known ? '배움' : ''}</span></span>
      <button class="btn sm" data-act="learn-egg" data-arg="${m}" ${known || !have ? 'disabled' : ''}>배우기</button></div>`; }).join('')}</div>
      ${have ? '' : '<p class="dim">교배기술머신이 없습니다. 마을 상점에 가끔 진열되고, 던전에서 드물게 주울 수 있어요.</p>'}`;
  }
  // 숙련맥스 (v0.98): 지금 쓰는 기술 중 하나를 골라 숙련도를 ★10까지 채운다 (save.mastery[sp][mid] = ★10에 필요한 횟수)
  function masterSection(sp, ch) {
    const have = ownedCount('masterbook'), mv = ch.moves.length ? ch.moves : defaultMoves(sp, ch.lv);
    return `<div class="tm-box">${mv.filter(m => DATA.moves[m]).map(m => { const lv = masteryLevel(sp, m), full = lv >= MASTERY_MAX; return `<div class="row">
      <span class="grow"><span class="ab-link" data-move="${m}">${esc(DATA.moves[m].n)}</span> <span class="dim">★${lv}</span></span>
      <button class="btn sm" data-act="master-book" data-arg="${m}" ${full || !have ? 'disabled' : ''}>${full ? '최대' : `★${MASTERY_MAX}으로`}</button></div>`; }).join('')}</div>
      ${have ? '<p class="dim tiny">지금 기술 칸에 넣은 기술만 고를 수 있어요. 다른 기술은 기술 설정에서 넣은 뒤에 쓰세요.</p>' : ''}`;
  }
  async function useMasterBook(mid) {
    const sp = tmWho(), ch = save.roster[sp], it = ITEMS.masterbook, mv = DATA.moves[mid];
    if (!mv || !ownedCount('masterbook') || masteryLevel(sp, mid) >= MASTERY_MAX) return;
    if (!(await UI.confirm(it.n, `<p>${it.icon} ${esc(jo(it.n, '을'))} 써서 ${esc(spName(sp))}의 <b>${esc(mv.n)}</b> 숙련도를 ★${masteryLevel(sp, mid)} → <b>★${MASTERY_MAX}</b>으로 올립니다.</p>
      <p class="dim">PP 최대 +${Math.round(MASTERY_MAX * MASTERY_PP * 100)}%, PP를 안 쓸 확률 ${Math.round(MASTERY_MAX * MASTERY_FREE * 100)}%</p>`, '쓴다', '그만둔다'))) return;
    takeItem('masterbook');
    save.mastery = save.mastery || {};
    const book = save.mastery[sp] = save.mastery[sp] || {};
    book[mid] = Math.max(book[mid] || 0, masteryNeed(mid, MASTERY_MAX));
    Sound.play('levelup'); persist(); renderTown();
    UI.toast(`${spName(sp)}의 ${mv.n} 숙련도가 ★${MASTERY_MAX}이 되었다!`);
  }
  async function learnEgg(mid) {
    const sp = tmWho(), ch = save.roster[sp], it = ITEMS.eggtm, mv = DATA.moves[mid];
    if (!eggMovesOf(sp).includes(mid) || (ch.tms || []).includes(mid) || !ownedCount('eggtm')) return;
    if (!(await UI.confirm('교배기술', `<p>${it.icon} ${esc(jo(it.n, '을'))} 사용해서 ${esc(spName(sp))}에게 ${esc(jo(mv.n, '을'))} 가르칩니다.</p>${moveDetailHtml(mid)}<p class="dim">교배기술머신 1개가 사라집니다. (가진 개수 ${ownedCount('eggtm')})</p>`, '배운다', '그만둔다'))) return;
    takeItem('eggtm');
    ch.tms = [...new Set([...(ch.tms || []), mid])];
    Sound.play('item');
    if (ch.moves.length < 4) { ch.moves.push(mid); persist(); renderTown(); UI.toast(`${jo(mv.n, '을')} 배웠습니다!`); return; }
    persist(); renderTown();
    UI.open({
      title: `${esc(mv.n)} — 잊을 기술 선택`, html: '<p>기술을 4개 알고 있습니다. 지금 바꿀 기술을 고르세요.</p>',
      choices: [...ch.moves.map((m, i) => ({ label: moveLine(m), fn: () => { ch.moves[i] = mid; persist(); renderTown(); UI.toast(`${jo(mv.n, '을')} 배웠습니다!`); } })),
        { label: '지금은 바꾸지 않는다 (나중에 기술 설정에서 넣을 수 있음)', fn: () => {} }],
    });
  }

  // 가방/창고의 지닌 물건 중에서 고르기 (원래 지니던 것은 창고로)
  function chooseHeld(sp = save.current) {
    const ch = save.roster[sp];
    const opts = [];
    save.bag.forEach((b, i) => { if (ITEMS[b.id]?.held) opts.push({ id: b.id, from: 'bag', i }); });
    Object.keys(save.storage).forEach(id => { if (ITEMS[id]?.held && save.storage[id] > 0) opts.push({ id, from: 'storage' }); });
    if (!opts.length) { UI.alert('지닌 물건', '<p>가방이나 창고에 지닐 수 있는 물건이 없습니다.</p><p class="dim">상점에서 매일 지닌 물건 몇 개를 팔고, 던전에서도 가끔 주울 수 있어요.</p>'); return; }
    UI.open({
      title: `${esc(spName(sp))}에게 지니게 할 물건`, wide: true,
      choices: opts.map(o => ({ label: `${ITEMS[o.id].icon} ${esc(ITEMS[o.id].n)} <span class="dim">(${o.from === 'bag' ? '가방' : '창고'})</span>`, sub: esc(heldBlockReason(entryAbility(sp, ch), o.id) || ITEMS[o.id].d), disabled: !!heldBlockReason(entryAbility(sp, ch), o.id), fn: () => {
        if (o.from === 'bag') save.bag.splice(o.i, 1); else { save.storage[o.id]--; if (save.storage[o.id] <= 0) delete save.storage[o.id]; }
        if (ch.held) storeKeep(ch.held);
        ch.held = o.id; persist(); renderTown(); UI.toast(`${jo(ITEMS[o.id].n, '을')} 지니게 했습니다.`);
      } })),
    });
  }

  function exportSave() {
    const data = JSON.stringify({ game: 'pmd-web', version: GAME_VERSION, exported: new Date().toISOString(), save }, null, 1);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    a.download = `pmd-web-save-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    UI.toast('세이브 파일을 저장했습니다.');
  }
  async function importSave(file) {
    let obj = null;
    try { obj = JSON.parse(await file.text()); } catch (e) { obj = null; }
    const s = obj && obj.game === 'pmd-web' ? obj.save : obj;
    if (!s || typeof s !== 'object' || !s.roster || !s.current || !s.roster[s.current]) { UI.alert('불러오기 실패', '<p>이 게임의 세이브 파일이 아닙니다.</p>'); return; }
    if (s.gameVersion && cmpVer(s.gameVersion, GAME_VERSION) > 0) { UI.alert('불러오기 실패', `<p>이 세이브는 더 새 버전(v${esc(s.gameVersion)})에서 저장됐어요. 새로고침해서 최신 버전으로 불러와 주세요.</p>`); return; }
    const ch = s.roster[s.current];
    const ok = await UI.confirm('세이브 불러오기', `<div class="center">${portraitImg(s.current, 'portrait big', 'Normal', ch.shiny)}</div>
      <p class="center"><b>${esc(spName(s.current))}</b> Lv${ch.lv} · ${s.day || 1}일째 · ₽${s.money || 0}${obj.exported ? `<br><span class="dim">내보낸 시각 ${esc(new Date(obj.exported).toLocaleString())}${obj.version ? ` · 버전 v${esc(obj.version)}` : ''}</span>` : ''}</p>
      ${obj.version && obj.version !== GAME_VERSION ? `<p class="dim">지금 게임은 v${GAME_VERSION}입니다. 다른 버전의 세이브도 불러올 수 있어요.</p>` : ''}
      <p class="warn">지금 진행 중인 세이브는 이 파일로 바뀝니다.</p>`, '불러온다', '그만둔다');
    if (!ok) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) { UI.alert('불러오기 실패', '<p>브라우저에 저장할 수 없습니다.</p>'); return; }
    reloadAfterReplace();
  }
  function noteShiny(sp) { save.shinySeen = save.shinySeen || {}; save.shinySeen[sp] = (save.shinySeen[sp] || 0) + 1; noteFirst('shiny', { sp }); }   // 엔딩: 처음 만난 이로치
  // 이로치 모습: 그 포켓몬의 이로치를 쓰러뜨리거나 영입하면 해금 (이미 이로치로 쓰던 캐릭터는 그대로 인정)
  // 진화 계열 전체가 함께 풀린다 (미진화체의 이로치를 만나도 진화체에서 쓸 수 있게)
  const shinyOk = sp => evoFamily(sp).some(x => (save.shinyOwned && save.shinyOwned[x]) || save.roster[x]?.shiny);
  function unlockShiny(sp) {
    if (!DATA.species[sp]?.sh || shinyOk(sp)) return false;
    save.shinyOwned = save.shinyOwned || {}; save.shinyOwned[sp] = true; persist(); return true;
  }
  // 영입: Lv5로 합류. 영입한 그 포켓몬 하나만 (진화 전 모습은 따로 생기지 않는다). 이로치면 진화 전 모습의 이로치도 해금
  function recruit(c) {
    if (save.roster[c.sp]) return;
    const ab0 = c.baseAbility ?? c.ability, ab = DATA.species[c.sp].ab.some(a => a[0] === ab0) ? ab0 : defaultAbility(c.sp);   // 숨겨진 특성인 적을 영입하면 그 특성 그대로
    save.roster[c.sp] = { lv: RECRUIT_LEVEL, exp: expFor(RECRUIT_LEVEL), moves: defaultMoves(c.sp, RECRUIT_LEVEL), ability: ab, shiny: !!c.shiny };
    if (DATA.species[c.sp].lg) noteFirst(isUltra(c.sp) ? 'ultra' : 'legend', { sp: c.sp });   // 엔딩: 처음 함께한 전설
    if (c.shiny) unlockShiny(c.sp);
    save.recruited = (save.recruited || 0) + 1;
    Progress.check();
    persist();
  }

  function switchChar(sp) {
    if (!save.roster[sp]) save.roster[sp] = newEntry(sp);
    save.current = sp; persist(); renderTown();
    UI.toast(`${jo(spName(sp), '으로')} 변경했습니다.`);
  }

  function setMoves(sp = save.current) {
    const ch = save.roster[sp];
    // 진화 전 모습이 이 레벨까지 배우는 기술과 지금 쓰고 있는 기술도 고를 수 있다 (진화해도 잊지 않는다)
    const egg = new Set(eggMovesOf(sp));
    const all = [...new Set([...ch.moves, ...learnableUpTo(sp, ch.lv), ...(ch.form && DATA.species[ch.form] ? learnableUpTo(ch.form, ch.lv) : []), ...preEvos(sp).flatMap(p => learnableUpTo(p, ch.lv)), ...(ch.tms || [])])].filter(m => DATA.moves[m]);
    if (!all.length) { UI.alert('기술 설정', '<p>배울 수 있는 기술이 없습니다.</p>'); return; }
    const sel = new Set(ch.moves);
    UI.open({
      title: `${esc(spName(sp))} 기술 설정 (최대 4개)`, wide: true,
      html: `<p class="dim">현재 레벨까지 배울 수 있는 기술(진화 전 모습과 지금 고른 모습의 기술 포함), 기술머신·🧬교배기술머신으로 배운 기술 중에서 자유롭게 고르세요. <b>?</b>를 누르면 기술 설명을 볼 수 있습니다.</p><div class="move-pick">${all.map(id => `<label class="move-row"><input type="checkbox" value="${id}" ${sel.has(id) ? 'checked' : ''}> ${moveLine(id)}${egg.has(id) && !learnableUpTo(sp, MAX_LEVEL).includes(id) ? ' <span class="tag" title="교배기술">🥚</span>' : ''}${masteryStar(sp, id)}<span class="info" data-move="${id}" data-sp="${sp}" title="기술 정보">?</span></label>`).join('')}</div>`,
      choices: [{ label: '저장', fn: () => { ch.moves = [...sel]; persist(); renderTown(); } }, { label: '취소', fn: () => {} }],
      onOpen: box => {
        box.querySelectorAll('input[type=checkbox]').forEach(cb => cb.onchange = () => {
          const id = +cb.value;
          if (cb.checked) { if (sel.size >= 4) { cb.checked = false; UI.toast('기술은 4개까지 고를 수 있습니다.'); return; } sel.add(id); }
          else sel.delete(id);
        });
      },
    });
  }

  // ── 퇴화(초기화): 진화 계열의 가장 처음 모습, Lv5로 되돌린다 ──
  // 기술은 Lv5에 배우는 기술로. 숙련도·특성(같은 칸)·이로치·지닌 물건·기술머신·영양제·구미 기록은 남는다 (영양제·구미는 캐릭터 탭에서 켜고 끌 수 있다)
  const devolveRoot = sp => { const pre = preEvos(sp); return pre.length ? pre[pre.length - 1] : sp; };
  function devolveBlock(sp, ch) {
    const root = devolveRoot(sp);
    if (root === sp && ch.lv <= RECRUIT_LEVEL) return '이미 처음 모습, 처음 레벨입니다.';
    if (root !== sp && save.roster[root]) return `이미 ${spName(root)}이(가) 있어서 퇴화할 수 없어요.`;
    if (save.sos && save.sos.sp === sp) return '구조를 기다리는 중에는 퇴화할 수 없어요.';
    return '';
  }
  function devolveSection(sp, ch) {
    const root = devolveRoot(sp), why = devolveBlock(sp, ch);
    return `<h3>퇴화 · 초기화</h3><div class="row">${portraitImg(root, 'portrait sm', 'Normal', ch.shiny)}<div class="grow"><b>${esc(spName(root))}</b> Lv${RECRUIT_LEVEL}로 되돌리기
      <div class="dim">${why ? esc(why) : '기술은 Lv' + RECRUIT_LEVEL + ' 기술로 바뀌고, 숙련도·특성·이로치·지닌 물건·기술머신·영양제·구미 기록은 남습니다.'}</div></div>
      <button class="btn sm ghost danger" data-act="devolve" ${why ? 'disabled' : ''}>퇴화</button></div>`;
  }
  async function devolve() {
    const sp = tmWho(), ch = save.roster[sp], root = devolveRoot(sp);
    if (devolveBlock(sp, ch)) return;
    const ok = await UI.confirm('퇴화 · 초기화', `<div class="center">${portraitImg(sp, 'portrait big', 'Normal', ch.shiny)} → ${portraitImg(root, 'portrait big', 'Normal', ch.shiny)}</div>
      <p>${esc(spName(sp))} Lv${ch.lv}을(를) <b>${esc(spName(root))} Lv${RECRUIT_LEVEL}</b>로 되돌립니다.</p>
      <ul><li>레벨과 경험치가 처음으로 돌아가고, 기술은 Lv${RECRUIT_LEVEL}에 배우는 기술로 바뀝니다. (기술머신·교배기술로 배운 기술은 기술 설정에서 다시 넣을 수 있어요)</li>
      <li>숙련도·특성·이로치·지닌 물건·클리어 기록은 남습니다.</li>
      <li>영양제·구미로 올린 능력치도 남습니다. 캐릭터 탭에서 효과를 끄고 켤 수 있어요.</li></ul>
      <p class="warn">레벨은 되돌릴 수 없습니다.</p>`, '퇴화한다', '그만둔다');
    if (!ok) return;
    const entry = { ...ch, lv: RECRUIT_LEVEL, exp: expFor(RECRUIT_LEVEL), moves: defaultMoves(root, RECRUIT_LEVEL) };
    if (root !== sp) {
      const slot = DATA.species[sp].ab.findIndex(a => a[0] === ch.ability);
      entry.ability = (DATA.species[root].ab[slot] || DATA.species[root].ab[0] || [0])[0];
      delete entry.form;
      delete save.roster[sp];
      mergeMastery(save, sp, root);
      if (save.clears && save.clears[sp]) { save.clears[root] = { ...save.clears[root], ...save.clears[sp] }; delete save.clears[sp]; }
      if (isFav(sp)) save.favs = [...new Set(save.favs.map(x => x === sp ? root : x))];
      if (save.party) save.party = save.party.map(x => x === sp ? root : x);
    }
    save.roster[root] = entry;
    if (sp === save.current) save.current = root; else if (tmTarget === sp) tmTarget = root;
    persist(); renderTown();
    UI.toast(`${spName(root)} Lv${RECRUIT_LEVEL}로 되돌렸습니다.`);
  }

  // sp: 진화할 포켓몬 (없으면 리더). 동료도 마을의 동료 카드에서 진화할 수 있다 (v0.90)
  async function evolve(to, sp = save.current) {
    const e = save.roster[sp] && evoOptions(sp).find(o => o.to === to);
    const isLeader = sp === save.current;
    if (!e || !e.ok) return;
    let msg = `<p>${esc(jo(spName(sp), '이'))} ${esc(jo(spName(to), '으로'))} 진화합니다.</p>`;
    if (borrowNote(to)) msg += `<p class="dim">${esc(borrowNote(to))}</p>`;
    const other = save.roster[to];   // 이미 있는 진화형: 둘을 합친다 (레벨이 높은 쪽의 기록이 남는다)
    if (other) msg += `<p class="warn">이미 있는 ${esc(spName(to))}(Lv${other.lv})와 합칩니다. 레벨이 더 높은 쪽(Lv${Math.max(other.lv, save.roster[sp].lv)})의 기록이 남고, 숙련도·클리어 기록은 합쳐집니다.</p>`;
    if (!(await UI.confirm('진화', msg, '진화한다', '그만둔다'))) return;
    if (e.itemId) {
      const bi = save.bag.findIndex(b => b.id === e.itemId);
      if (bi >= 0) save.bag.splice(bi, 1); else { save.storage[e.itemId]--; if (save.storage[e.itemId] <= 0) delete save.storage[e.itemId]; }
    }
    let entry = save.roster[sp];
    if (shinyOk(sp)) { save.shinyOwned = save.shinyOwned || {}; save.shinyOwned[to] = true; }
    const keepOther = other && other.lv > entry.lv;   // 합칠 때 이미 있던 쪽이 레벨이 더 높으면 그쪽 기록을 쓴다
    delete save.roster[sp];
    if (isFav(sp)) save.favs = [...new Set(save.favs.map(x => x === sp ? to : x))];   // 즐겨찾기도 진화한 모습으로
    // 진화해야 배울 수 있는 기술 (예: 누리레느의 물거품아리아): 진화 전 모습은 못 배우는 것
    const preSet = new Set([sp, ...preEvos(sp)].flatMap(x => learnableUpTo(x, MAX_LEVEL)));
    const evoNew = learnableUpTo(to, entry.lv).filter(m => DATA.moves[m] && !preSet.has(m));
    // 진화 후 레벨에서 새로 배우는 기술이 있으면 빈 칸에 추가
    for (const mid of learnedAt(to, entry.lv).concat(learnedAt(to, 1))) if (entry.moves.length < 4 && !entry.moves.includes(mid)) entry.moves.push(mid);
    const slot = DATA.species[sp].ab.findIndex(a => a[0] === entry.ability);
    entry.ability = (DATA.species[to].ab[slot] || DATA.species[to].ab[0] || [0])[0];
    delete entry.form;   // 골라 둔 모습은 진화 전 포켓몬의 것
    mergeMastery(save, sp, to);   // 숙련도도 진화한 모습으로
    save.roster[to] = keepOther ? other : entry;   // 합칠 때는 레벨이 높은 쪽
    if (isLeader) save.current = to;
    if (tmTarget === sp) tmTarget = to;   // 캐릭터 탭에서 보던 동료가 진화하면 진화한 모습을 계속 본다
    // 동료 목록도 진화한 모습으로 (합쳐진 포켓몬이 리더면 동료에서는 빠진다)
    if (save.party) save.party = [...new Set(save.party.map(x => x === sp ? to : x))].filter(x => x !== save.current && save.roster[x]);
    entry = save.roster[to];
    if (save.sos && save.sos.sp === sp) save.sos.sp = to;   // 구조를 기다리는 포켓몬이 진화하면 구조 요청도 진화한 모습으로
    // 클리어 기록도 진화한 모습으로 옮긴다
    if (save.clears && save.clears[sp]) { save.clears[to] = { ...save.clears[to], ...save.clears[sp] }; delete save.clears[sp]; }
    Progress.add('evolves'); Progress.check();
    noteFirst('evolve', { from: sp, to });
    Sound.play('levelup');
    persist(); renderTown();
    // 진화로 새로 배울 수 있게 된 기술: 넣었으면 알리고, 기술 칸이 꽉 차서 못 넣었으면 기술 설정에서 넣으라고 알린다
    const added = evoNew.filter(m => entry.moves.includes(m)), wait = evoNew.filter(m => !entry.moves.includes(m));
    const mvList = ids => { const t = ids.map(m => DATA.moves[m].n).join(', '); return `<b>${esc(t)}</b>${jo(t, '을').slice(t.length)}`; };   // '물거품아리아를'
    UI.alert('축하합니다!', `<div class="center">${portraitImg(to, 'portrait big', 'Joyous', entry.shiny)}</div><p>${esc(jo(spName(sp), '은'))} ${esc(jo(spName(to), '으로'))} 진화했다!</p>
      ${added.length ? `<p>새 기술 ${mvList(added)} 배웠다!</p>` : ''}
      ${wait.length ? `<p>진화해서 ${mvList(wait)} 배울 수 있게 됐어요. 기술 칸이 꽉 차 있어서, 캐릭터 탭의 <b>기술 설정</b>에서 바꿔 넣을 수 있어요.</p>` : ''}`);
  }

  // 영입한 포켓몬 즐겨찾기 (캐릭터 변경·동료 추가에서 앞에 나온다)
  const isFav = id => !!(save && save.favs && save.favs.includes(+id));
  function toggleFav(id) {
    save.favs = (save.favs || []).filter(x => save.roster[x]);
    const on = !save.favs.includes(id);
    save.favs = on ? [...save.favs, id] : save.favs.filter(x => x !== id);
    persist(); return on;
  }

  // 음량: 0~VOL_MAX%. 100%를 넘으면 빨간색
  const VOL_MAX = 200;
  const volInput = (k, def, title) => { const v = save.settings[k] ?? def, hot = v > 100 ? ' loud' : ''; return `<input type="range" class="vol${hot}" min="0" max="${VOL_MAX}" step="5" data-setnum="${k}" value="${v}" title="${title}"><span class="vol-num${hot}">${v}%</span>`; };
  const soundSettings = s => `<div class="sound-set">
        <label class="chk"><input type="checkbox" data-set="sfx" ${s.sfx !== false ? 'checked' : ''}> 효과음</label> ${volInput('sfxVol', 60, '효과음 음량')}
        <label class="chk"><input type="checkbox" data-set="bgm" ${s.bgm !== false ? 'checked' : ''}> 배경음</label> ${volInput('bgmVol', 40, '배경음 음량')}</div>`;
  const VIEW_SCALES = [['', '자동'], ['1', '1배 (아주 작게)'], ['1.5', '1.5배'], ['2', '2배'], ['2.5', '2.5배'], ['3', '3배'], ['4', '4배 (크게)']];

  // ── 설정 창 (v0.92): 마을 정보 탭·던전 메뉴에 흩어져 있던 설정을 한 창에 분류별로 모은다 ──
  const SET_CATS = [['screen', '🖼 화면'], ['sound', '🔊 소리'], ['control', '🎮 조작'], ['play', '🧭 플레이']];
  let setCat = 'screen';
  function settingsBody(c, s) {
    const sel = (k, opts, cur) => `<select data-setsel="${k}">${opts.map(([v, n]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
    if (c === 'sound') return `${soundSettings(s)}<p class="dim tiny">브라우저 정책상 화면을 한 번 눌러야 소리가 나기 시작합니다.</p>`;
    if (c === 'control') return `<div class="btns"><button class="btn ghost" data-sact="keys">⌨ 키 설정 (PC)</button> <button class="btn ghost" data-sact="help">📖 조작법</button></div>
      <h3>📱 터치 (휴대폰·태블릿)</h3>
      <div class="row"><span class="grow">터치 조작 방식</span>${sel('padMode', [['stick', '조이스틱 + ABXY'], ['dpad', '방향 버튼 + 아래 버튼 (예전 방식)']], s.padMode || 'stick')}</div>
      <div class="row"><span class="grow">터치 조작 <span class="dim">(조작 버튼이 안 보이면 '항상 켜기', 키보드로만 하려면 '끄기')</span></span>${sel('touchCtl', [['auto', '터치 기기에서만 켜기'], ['on', '항상 켜기'], ['off', '끄기']], touchCtl())}</div>
      <div class="btns"><button class="btn ghost" data-sact="pad">⚙ 조작 패드 크기·버튼 할당·배치</button></div>
      <h3>🎮 컨트롤러</h3>
      <div class="row"><span class="grow">버튼 배치 <span class="dim">(자동: 닌텐도 컨트롤러면 닌텐도식)</span></span>${sel('gpLayout', [['auto', '자동'], ['xbox', 'Xbox식 (아래 A·오른쪽 B)'], ['nintendo', '닌텐도식 (오른쪽 A·아래 B)']], s.gpLayout || 'auto')}</div>
      <div class="btns"><button class="btn ghost" data-sact="gp">🎮 컨트롤러 조작 안내</button></div>`;
    if (c === 'play') return `<label class="chk"><input type="checkbox" data-set="autoDescend" ${s.autoDescend ? 'checked' : ''}> 자동 탐색·계단(G)으로 계단에 도착하면 바로 내려가기</label>
      <label class="chk"><input type="checkbox" data-set="noGift" ${s.noGift ? 'checked' : ''}> 💌 감사 선물 받지 않기 <span class="dim">(구조 게시판으로 구조하면 요청자에게 선물 고르는 창이 뜨지 않아요. 그래도 선물이 오면 판매 값만큼 돈으로 받아요. 구조 보답은 그대로)</span></label>
      <p class="dim">자동 판매는 창고 탭, 빠른 사용은 던전의 가방에서 정할 수 있어요.</p>`;
    return `<label class="chk"><input type="checkbox" data-set="origTiles" ${s.origTiles !== false ? 'checked' : ''}> 🗺 원작 던전 그림 (끄면 게임이 직접 그린 단순한 타일)</label>
      <div class="row"><span class="grow">🔍 던전 화면 크기 <span class="dim">(작을수록 넓게 보여요. 자동: 넓은 화면 3배, 그 밖 2배)</span></span>${sel('viewScale', VIEW_SCALES, String(s.viewScale || ''))}</div>
      <label class="chk"><input type="checkbox" data-set="fast" ${s.fast ? 'checked' : ''}> 빠른 연출</label>`;
  }
  function openSettings(cat, back) {
    if (cat) setCat = cat;
    const s = save.settings;
    const head = `<div class="dex-tabs set-tabs">${SET_CATS.map(([k, n]) => `<button class="${setCat === k ? 'on' : ''}" data-scat="${k}">${n}</button>`).join('')}</div>`;
    UI.open({
      title: '⚙ 설정', wide: true, html: head + `<div class="set-body">${settingsBody(setCat, s)}</div>`,
      onOpen: (box, m) => {
        box.querySelectorAll('[data-scat]').forEach(b => b.onclick = () => { if (b.dataset.scat !== setCat) { UI.close(m); openSettings(b.dataset.scat, back); } });
        box.addEventListener('change', e => {
          if (e.target.dataset.set) setSetting(e.target.dataset.set, e.target.checked);
          if (e.target.dataset.setsel) setSetting(e.target.dataset.setsel, e.target.value);
          if (e.target.dataset.setnum) { setSetting(e.target.dataset.setnum, +e.target.value); Sound.play('menu'); }
        });
        box.addEventListener('input', e => { if (e.target.dataset.setnum) { const n = e.target.nextElementSibling; if (n) n.textContent = e.target.value + '%'; } });
        box.querySelectorAll('[data-sact]').forEach(b => b.onclick = () => {
          const a = b.dataset.sact; UI.close(m);
          setTimeout(() => ({ keys: keySettings, help: Dungeon.showHelp, pad: Dungeon.padSettings, gp: Dungeon.gamepadGuide })[a](), 0);
        });
      },
      choices: [...(back ? [{ label: '← 메뉴로', fn: () => setTimeout(back, 0) }] : []), { label: '닫기', fn: () => { if (tab === 'info' && inTown()) renderTown(); } }],
    });
  }

  // ── 개발용 운영자 테스트 계정 (로컬에서만): 모든 포켓몬 Lv100 영입, 영양제·구미 최대, 배울 수 있는 기술 전부, 특성 변경 아이템·돈 넉넉히, 모든 던전 클리어 ──
  // 세이브가 커서(약 400KB) 이 상태로 로그인하면 클라우드 저장이 막힌다. 로그인하지 않고 쓴다
  async function devAdmin() {
    if (ENV !== 'dev') return;
    if (Online.loggedIn()) { UI.alert('운영자 계정', '<p>로그인한 상태에서는 만들 수 없어요. (클라우드 세이브를 덮어쓰지 않게) 로그아웃하고 해 주세요.</p>'); return; }
    if (!(await UI.confirm('운영자 계정', '<p>이 브라우저의 세이브를 테스트용 운영자 계정으로 바꿉니다. (개발용, 되돌릴 수 없음)</p>', '바꾼다', '그만둔다'))) return;
    const boost = {}; for (const [, [, k]] of Object.entries(VITAMINS)) boost[k] = VITAMIN_MAX; for (const g of Object.values(GUMMIES)) for (const k of g.stats) boost['g_' + k] = GUMMY_MAX;
    for (const id of SPECIES_IDS.map(Number)) {
      const learn = [...new Set([...learnableUpTo(id, MAX_LEVEL), ...preEvos(id).flatMap(p => learnableUpTo(p, MAX_LEVEL)), ...tmMovesOf(id), ...eggMovesOf(id)])].filter(m => DATA.moves[m]);
      save.roster[id] = { ...(save.roster[id] || { moves: defaultMoves(id, MAX_LEVEL), ability: defaultAbility(id), shiny: false }), lv: MAX_LEVEL, exp: expFor(MAX_LEVEL), boost: { ...boost }, tms: learn };
      if (DATA.species[id].sh) (save.shinyOwned = save.shinyOwned || {})[id] = true;
    }
    for (const d of DUNGEONS) if (!d.daily) save.cleared[d.id] = true;
    save.money = 9999999; save.storageMax = 99999;
    for (const it of ['abcapsule', 'abpatch', 'eggtm', 'candy', 'stone', 'link']) save.storage[it] = 999;
    persist(); renderTown(); UI.toast('운영자 테스트 계정으로 바꿨어요.');
  }

  // ── 키 설정: 동작마다 키 하나로 바꾸기 (바꾸지 않은 동작은 기본 키 그대로) ──
  function keySettings() {
    const custom = save.settings.keys || {};
    Dungeon.updateKeyHints();   // 던전 아래 버튼의 키 표시도 바로 맞춘다
    const row = ([a, n]) => `<div class="row"><span class="grow">${esc(n)}</span>
      <span class="keycaps">${keysOf(a, custom).map(c => `<kbd>${esc(keyLabel(c))}</kbd>`).join(' ') || '<span class="warn">없음</span>'}</span>
      <button class="btn sm ghost" data-key="${a}">바꾸기</button>${custom[a] ? ` <button class="btn sm ghost" data-keyreset="${a}" title="기본 키로">↺</button>` : ''}</div>`;
    UI.open({
      title: '🎮 키 설정', wide: true,
      html: `<p class="dim">바꾸기를 누른 뒤 쓸 키를 누르세요. 그 동작은 그 키 하나로 바뀌고, 다른 동작에 같은 키가 있었다면 그 동작에서는 빠져요. Esc는 늘 메뉴예요.
        상하좌우 이동 키 두 개를 함께 누르면 대각선으로 움직여요.</p><div class="key-list">${KEY_ACTIONS.map(row).join('')}</div>`,
      choices: [{ label: '모두 기본 키로', fn: () => { save.settings.keys = {}; persist(); keySettings(); } }, { label: '닫기', fn: () => {} }],
      onOpen: (box, m) => {
        box.querySelectorAll('[data-keyreset]').forEach(b => b.onclick = () => { delete save.settings.keys[b.dataset.keyreset]; persist(); UI.close(m); keySettings(); });
        box.querySelectorAll('[data-key]').forEach(b => b.onclick = () => {
          const a = b.dataset.key;
          b.textContent = '키를 누르세요…'; b.classList.remove('ghost');
          const grab = e => {
            e.preventDefault(); e.stopPropagation();
            window.removeEventListener('keydown', grab, true);
            if (e.code === 'Escape') { UI.close(m); keySettings(); return; }
            if (['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) { UI.toast('Ctrl·Alt는 쓸 수 없어요.'); UI.close(m); keySettings(); return; }
            const keys = { ...(save.settings.keys || {}) };
            for (const [k, c] of Object.entries(keys)) if (c === e.code) delete keys[k];   // 다른 동작이 쓰던 같은 키는 뺀다
            keys[a] = e.code; save.settings.keys = keys; persist();
            UI.toast(`${KEY_ACTIONS.find(x => x[0] === a)[1]}: ${keyLabel(e.code)}`);
            UI.close(m); keySettings();
          };
          window.addEventListener('keydown', grab, true);
        });
      },
    });
  }

  // ───────────────────────── 캐릭터 선택 ─────────────────────────
  // only: 고를 수 있는 포켓몬 (캐릭터 변경은 영입한 포켓몬만)
  // opts: 다른 곳에서 같은 고르기 창을 쓸 때 (동료 추가) { title, ok: 확인 버튼, note: 위 설명 }
  // 영입한 포켓몬이 지닌 물건 (고르기 창에 표시)
  const heldOfRoster = id => { const h = save && save.roster && save.roster[id] && save.roster[id].held; return h && ITEMS[h] ? h : null; };
  function chooseCharacter(cb, first, only, back, opts = {}) {
    const favMode = !!(only && !first);   // 영입한 포켓몬 고르기: ⭐ 즐겨찾기를 앞에
    const ids = (only || SPECIES_IDS.map(Number)).slice().sort(byDex);
    if (favMode) ids.sort((a, b) => isFav(b) - isFav(a));
    const gens = [...new Set(ids.map(id => DATA.species[id].g))].sort((a, b) => a - b);
    UI.open({
      title: opts.title || (first ? '함께 모험할 포켓몬을 고르세요' : '캐릭터 변경'), wide: true, cancel: first ? false : undefined,
      html: `${opts.note ? `<p class="dim">${esc(opts.note)}</p>` : only && !first ? `<p class="dim">영입한 포켓몬 ${ids.length}마리 중에서 고릅니다. 던전에서 쓰러뜨린 적이 가끔 동료가 되고 싶어 해요. (지금 영입 확률 ${(recruitRate(save.roster[save.current].lv) * 100).toFixed(1)}%)</p>` : ''}<div class="picker-bar"><input id="pk-q" placeholder="이름 / 영어 / 번호 검색" autocomplete="off">
        <select id="pk-g"><option value="">전체 세대</option>${gens.map(g => `<option value="${g}">${g}세대</option>`).join('')}</select>
        <select id="pk-t"><option value="">전체 타입</option>${DATA.types.map((t, i) => `<option value="${i + 1}">${t}</option>`).join('')}</select>
        ${first ? '' : pokeClassSelect('pk-k')}
        ${favMode ? `<label class="pk-favonly"><input type="checkbox" id="pk-f"> ⭐ 즐겨찾기만</label>` : ''}
        <button class="btn sm ghost" id="pk-r">무작위</button>${back ? ' <button class="btn sm ghost" id="pk-back">← 방법 다시 고르기</button>' : ''}</div>
        <div class="picker" id="pk-grid">${ids.map(id => `<button class="pk" data-id="${id}" data-s="${(DATA.species[id].n + ' ' + DATA.species[id].e + ' ' + dexNo(id) + ' ' + id).toLowerCase()}" data-g="${DATA.species[id].g}" data-t="${DATA.species[id].t.join(',')}" data-k="${pokeClass(id)}">
          ${favMode ? `<b class="fav${isFav(id) ? ' on' : ''}" data-fav="${id}" title="즐겨찾기">${isFav(id) ? '★' : '☆'}</b>` : ''}${portraitImg(id, 'portrait sm', 'Normal', !!(only && !first && save && save.roster[id]?.shiny))}<span>${esc(DATA.species[id].n)}</span>${save && save.roster && save.roster[id] ? `<i>Lv${save.roster[id].lv} ${medalIcons(id)}</i>` : ''}${heldOfRoster(id) ? `<b class="pk-held" title="지닌 물건: ${esc(ITEMS[heldOfRoster(id)].n)}">${Gfx.iconHtml(heldOfRoster(id))}</b>` : ''}</button>`).join('')}</div>`,
      onOpen: (box, m) => {
        const q = box.querySelector('#pk-q'), g = box.querySelector('#pk-g'), t = box.querySelector('#pk-t'), f = box.querySelector('#pk-f'), k = box.querySelector('.pk-k');
        const filter = () => {
          const s = q.value.trim().toLowerCase();
          box.querySelectorAll('.pk').forEach(b => {
            b.style.display = (!s || b.dataset.s.includes(s)) && (!g.value || b.dataset.g === g.value) && (!t.value || b.dataset.t.split(',').includes(t.value)) && (!k || !k.value || b.dataset.k.split(',').includes(k.value))
              && (!f || !f.checked || isFav(+b.dataset.id)) ? '' : 'none';
          });
        };
        q.oninput = filter; g.onchange = filter; t.onchange = filter; if (k) k.onchange = filter; if (f) f.onchange = filter;
        if (back) box.querySelector('#pk-back').onclick = () => { UI.close(m); setTimeout(back, 0); };
        box.querySelector('#pk-r').onclick = () => { const vis = [...box.querySelectorAll('.pk')].filter(b => b.style.display !== 'none'); if (vis.length) confirmPick(+pick(vis).dataset.id); };
        const confirmPick = async id => {
          const d = DATA.species[id], st = calcStats(id, START_LEVEL, 31);
          const ok = await UI.confirm(esc(d.n), `<div class="center">${portraitImg(id, 'portrait big')}</div><p class="center">${typeBadges(d.t)}</p>
            <p class="center dim">종족값 HP ${d.b[0]} / 공 ${d.b[1]} / 방 ${d.b[2]} / 특공 ${d.b[3]} / 특방 ${d.b[4]} / 스피드 ${d.b[5]}</p>
            <p class="center">${save && save.roster && save.roster[id] ? `저장된 기록: Lv${save.roster[id].lv}` : `Lv${START_LEVEL}부터 시작 (HP ${st.maxhp})`}</p>
            ${heldOfRoster(id) ? `<p class="center">지닌 물건: ${itemLabel(heldOfRoster(id))}<br><span class="dim">${esc(ITEMS[heldOfRoster(id)].d)}</span></p>` : ''}`, opts.ok || '이 포켓몬으로 한다', '다시 고른다');
          if (ok) { UI.close(m); cb(id); }
        };
        box.querySelector('#pk-grid').onclick = e => {
          const fv = e.target.closest('[data-fav]');
          if (fv) {   // ⭐ 누르면 즐겨찾기만 바꾸고 고르지는 않는다
            const id = +fv.dataset.fav, on = toggleFav(id);
            fv.classList.toggle('on', on); fv.textContent = on ? '★' : '☆';
            const grid = box.querySelector('#pk-grid'), btns = [...grid.children];
            btns.sort((a, b) => (isFav(+b.dataset.id) - isFav(+a.dataset.id)) || byDex(+a.dataset.id, +b.dataset.id)).forEach(b => grid.appendChild(b));
            filter(); return;
          }
          const b = e.target.closest('.pk'); if (b) confirmPick(+b.dataset.id);
        };
        setTimeout(() => q.focus(), 50);
      },
    });
  }

  // ───────────────────────── 던전 출입 ─────────────────────────
  // 구조를 기다리는 던전에는 들어갈 수 없다 (구조받거나 포기하면 풀린다)
  const sosLocked = id => !!(save.sos && save.sos.dungeon === id);

  async function prepareRun(id) {
    const dg = dungeonById(id);
    if (sosLocked(id) && save.sos.revived) return save.sos.thx ? resumeSOS() : receiveAOKAgain();
    if (sosLocked(id)) { UI.alert('🆘 구조 대기 중', `<p>${esc(dg.n)}에서 구조를 기다리고 있어요. 구조를 받아 이어서 탐험하거나, 임무 탭에서 구조 요청을 포기하면 다시 들어갈 수 있어요.</p>`); return; }
    const ch = save.roster[save.current];
    if (dg.mode === 'rogue') {
      const ok = await UI.confirm(esc(dg.n), `<p><b>로그라이크 던전</b>입니다.</p><ul>
        <li>레벨이 <b>${jo(ROGUE_LEVEL, '으로')}</b>, 가방이 초기화된 상태로 들어갑니다. (오랭열매 2개, 사과 1개 지급)</li>
        <li>지닌 물건은 그대로 지니고 들어갑니다${ch.held ? ` (${ITEMS[ch.held].icon}${esc(ITEMS[ch.held].n)})` : ''}. 쓰러져도 잃지 않아요.</li>
        <li>던전에서 나오면 레벨과 가방이 원래대로 돌아옵니다.</li>
        <li>클리어하거나 탈출하면 주운 돈과 아이템(창고로)을 가져올 수 있습니다. 쓰러지면 아무것도 가져오지 못합니다.</li></ul>`, '들어간다', '그만둔다');
      if (!ok) return;
    } else {
      const ms = save.missions.accepted.filter(m => m.dungeon === id);
      const ok = await UI.confirm(esc(dg.n), `<p>${dg.floors}층짜리 던전입니다. (적 Lv ${dg.lv[0]}~${dg.lv[1]}, 내 레벨 ${ch.lv})</p>
        <p>가방: ${save.bag.length}/${bagMax()}칸${save.bag.length ? '' : ' <span class="warn">(비어 있음!)</span>'}</p>
        ${ms.length ? `<p>이 던전의 임무: ${ms.map(m => m.floor + 'F').join(', ')}</p>` : ''}
        ${partyList().length ? `<p>🤝 동료: ${partyList().map(id => `${esc(spName(id))} Lv${save.roster[id].lv}`).join(', ')}</p>` : `<p class="dim">혼자 갑니다. 혼자 탐험 보정으로 적에게 받는 데미지가 ${SOLO_DMG_MUL}배, HP를 뺀 능력치가 ${SOLO_STAT_MUL}배예요. (캐릭터 탭에서 동료를 고를 수 있어요)</p>`}
        ${dg.megaMul ? megaFocusHtml() : ''}
        <p class="dim">쓰러지면 가방 아이템의 절반(무작위)과 이번 탐험에서 주운 돈을 잃습니다. 레벨은 유지됩니다.</p>`, '출발한다', '그만둔다', [],
        box => { const s = box.querySelector('[data-megafocus]'); if (s) s.onchange = () => { save.megaFocus = s.value || null; persist(); }; });
      if (!ok) return;
    }
    if (dg.mode === 'normal') await Story.inDungeon(dg.id, 'depart');   // 이야기: 출발하기 직전의 대사 (아직 클리어하지 않은 던전)
    startRun(dg);
  }

  // 메가 진화의 탑: 노릴 메가스톤 (나오는 메가스톤의 MEGA_FOCUS_RATE만큼이 이 스톤)
  function megaFocusHtml() {
    const list = MEGA_STONES.map(id => [id, ITEMS[id].n]).sort((a, b) => a[1].localeCompare(b[1], 'ko'));
    return `<p>♾️ 노릴 메가스톤 <select data-megafocus="1"><option value="">고르지 않음</option>${list.map(([id, n]) => `<option value="${id}" ${save.megaFocus === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <br><span class="dim">고르면 이 탑에서 나오는 메가스톤의 ${Math.round(MEGA_FOCUS_RATE * 100)}%가 그 스톤이 돼요.</span></p>`;
  }

  // ── 엔딩용 기록 (v0.69부터): 처음 있었던 일, 많이 함께한 포켓몬 ──
  // 초전설 (그 밖의 전설·환상은 '전설'). 모습(폼)은 원래 포켓몬 번호로
  const ULTRA_LEGENDS = ULTRA_LEGEND_IDS;   // js/defs.js
  const baseSp = sp => (DATA.species[sp]?.f ? DATA.species[sp].f[0] : +sp);
  const isUltra = sp => ULTRA_LEGENDS.has(baseSp(sp));
  function noteFirst(k, v) { save.firsts = save.firsts || {}; if (!save.firsts[k]) save.firsts[k] = { ...v, day: save.day }; }
  function noteUse(k, kind) { save.usage = save.usage || {}; save.usage[kind] = save.usage[kind] || {}; save.usage[kind][k] = (save.usage[kind][k] || 0) + 1; }

  // ── 엔딩: 에리어 제로 최심부를 처음 완주하면 (정보 탭에서 다시 보기) ──
  const ENDING_DUNGEON = 'zerodeep';
  // 엔딩 통계에 보낼 내 기록 (엔딩을 본 순간 고정)
  function endingRecord() {
    const s = save, f = s.firsts || {}, st = s.stats || {};
    const top = o => { const e = Object.entries(o || {}).sort((a, b) => b[1] - a[1])[0]; return e ? e[0] : null; };
    const spv = x => (x != null && DATA.species[x] ? +x : null), int = x => Math.max(0, Math.round(+x || 0));
    return {
      starter: spv(s.starter), shiny: spv(f.shiny && f.shiny.sp), ultra: spv(f.ultra && f.ultra.sp), legend: spv(f.legend && f.legend.sp),
      lead: spv(top(s.usage && s.usage.lead)), faint: (f.faint && f.faint.dungeon) || null, most: top(s.usage && s.usage.dungeon),
      days: int(s.day), sec: int(s.playSec), kills: int(st.kills), floors: int(st.floors), bosses: int(st.bosses),
      clears: Object.keys(s.cleared || {}).length, missions: int(st.missions), rescues: int(st.rescues), faints: int(st.faints),
    };
  }
  // 엔딩 통계에 보내기 (로그인했을 때 한 번. 안 했으면 다음에 로그인할 때)
  async function voteEnding() {
    if (!save || !save.endingRec || save.endingVoted || !Online.loggedIn()) return;
    try { await Online.voteEnding(save.endingRec); }
    catch (e) { if (!/permission/.test(e.code || '')) { console.warn(e); return; } }   // 거절 = 이미 냈음
    save.endingVoted = true; persist();
  }
  // 🌍 엔딩 통계: 엔딩을 본 탐험대들의 기록 (하루에 한 번 갱신)
  async function showEndingStats() {
    let r;
    try { r = await Online.endingStats(); } catch (e) { UI.alert('🌍 엔딩 통계', `<p>${esc(Online.why(e))}</p>`); return; }
    const d = r.d || {}, n = d.n || 0, me = save.endingRec || null, sum = d.sum || {};
    if (!n) { UI.alert('🌍 엔딩 통계', '<p>아직 엔딩을 본 탐험대가 없어요. 에리어 제로 최심부를 처음 완주한 탐험대가 첫 기록을 남겨요.</p><p class="dim">로그인한 탐험대만 집계돼요.</p>'); return; }
    const rank = (cat, name, mine) => {
      const list = Object.entries(d[cat] || {}).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
      const tot = list.reduce((t, [, c]) => t + c, 0);
      if (!tot) return '<p class="dim">아직 기록이 없어요</p>';
      const row = ([k, c], i) => `<div class="row${String(mine) === k ? ' end-mine' : ''}"><b class="num">${i + 1}</b> ${name(k)}<span class="grow"></span><span>${c}명 <span class="dim">(${Math.round(c * 100 / tot)}%)</span></span></div>`;
      const mi = list.findIndex(([k]) => String(mine) === k);
      return list.slice(0, 5).map(row).join('') + (mi >= 5 ? `<div class="dim tiny">…</div>${row(list[mi], mi)}` : '');
    };
    const pk = k => DATA.species[k] ? `${portraitImg(+k, 'portrait xs')} ${esc(spName(+k))}` : `#${esc(k)}`;
    const dgn = k => esc(dungeonById(k)?.n || k);
    const avg = k => (sum[k] || 0) / n;
    const cmp = (label, k, fmt = x => Math.round(x).toLocaleString()) => `<div class="end-stat"><span>${label}</span><b>${fmt(avg(k))}</b>${me ? `<span class="dim">나 ${fmt(me[k] || 0)}</span>` : ''}</div>`;
    UI.open({ title: '🌍 엔딩 통계', wide: true, html: `<div class="ending end-global">
      <p class="center">엔딩을 본 탐험대 <b>${n}명</b>${d.minDays != null ? ` · 가장 빠른 탐험대 <b>${d.minDays}일째</b>` : ''}</p>
      <h3>📊 평균 기록 <span class="dim">(엔딩을 본 순간)</span></h3><div class="end-stats">
        ${cmp('엔딩까지 걸린 날', 'days', x => `${Math.round(x)}일`)}${cmp('플레이 시간', 'sec', playText)}
        ${cmp('쓰러뜨린 적', 'kills')}${cmp('내려간 계단', 'floors')}${cmp('쓰러뜨린 보스', 'bosses')}${cmp('클리어한 던전', 'clears')}
        ${cmp('완료한 임무', 'missions')}${cmp('친구 구조', 'rescues')}${cmp('쓰러진 횟수', 'faints')}</div>
      <h3>🌱 가장 많이 고른 첫 파트너</h3>${rank('starter', pk, me && me.starter)}
      <h3>🤝 가장 오래 함께한 리더</h3>${rank('lead', pk, me && me.lead)}
      <h3>✨ 처음 만난 이로치</h3>${rank('shiny', pk, me && me.shiny)}
      <h3>👑 처음 함께한 초전설</h3>${rank('ultra', pk, me && me.ultra)}
      <h3>👑 처음 함께한 전설</h3>${rank('legend', pk, me && me.legend)}
      <h3>💥 처음 쓰러진 던전</h3>${rank('faint', dgn, me && me.faint)}
      <h3>🗺 가장 많이 도전한 던전</h3>${rank('most', dgn, me && me.most)}
      <p class="dim tiny center">로그인한 탐험대가 엔딩을 처음 본 순간의 기록만 세요 (계정마다 한 번, 누구의 기록인지는 남지 않음) · ${esc(r.day)} 기준, 하루에 한 번 갱신 · '처음' 기록은 v0.69부터 쌓인 것만</p></div>`,
      choices: [{ label: '닫기', fn: () => {} }] });
  }
  const playText = sec => { const m = Math.floor((sec || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`; };
  function showEnding(first) {
    const s = save, st = s.stats || {}, f = s.firsts || {}, at = s.endingAt;
    const top = o => Object.entries(o || {}).sort((a, b) => b[1] - a[1])[0];
    const lead = top(s.usage && s.usage.lead), mate = top(s.usage && s.usage.party), most = top(s.usage && s.usage.dungeon);
    const card = (sp, sub, face = 'Joyous') => DATA.species[sp] ? `<div class="end-card">${portraitImg(sp, 'portrait big', face, s.roster[sp]?.shiny)}<b>${esc(spName(sp))}</b><span class="dim">${sub}</span></div>` : '';
    const none = '<p class="dim">기록 없음 (v0.69부터 기록돼요)</p>';
    const dn = id => esc(dungeonById(id)?.n || id);
    const dexC = Progress.dexCounts();
    const ownN = new Set(Object.keys(s.roster).flatMap(k => [+k, ...preEvos(+k)])).size;
    const shinyN = SPECIES_IDS.filter(id => DATA.species[id].sh && shinyOk(+id)).length;
    const achN = Progress.ACH.filter(a => s.ach[a.id]).length;
    const legends = Object.keys(s.roster).map(Number).filter(id => DATA.species[id]?.lg);
    const ultra = legends.filter(isUltra), legend = legends.filter(id => !isUltra(id));
    const pct = (a, b) => b ? Math.round(a * 100 / b) : 0;
    const stat = (k, n) => `<div class="end-stat"><span>${k}</span><b>${n}</b></div>`;
    const sec = (i, title, body) => `<section class="end-sec" style="animation-delay:${i * 0.6}s"><h3>${title}</h3>${body}</section>`;
    let i = 0;
    const html = `<div class="ending">
      ${sec(i++, '', `<p class="end-title">에리어 제로 최심부를 넘어서</p><p class="center">${first ? '긴 탐험 끝에, 미궁의 가장 깊은 곳에 닿았다.' : '지금까지의 탐험 기록'}</p>
        ${at ? `<p class="center end-when"><b>${at.day}일째</b>${at.sec ? ` · 플레이 시간 <b>${playText(at.sec)}</b>` : ''}에 에리어 제로 최심부 도착</p>` : ''}<div class="end-cards">${card(s.current, '지금의 리더')}</div>`)}
      ${sec(i++, '🌱 모든 것의 시작', `<div class="end-cards">${s.starter ? card(s.starter, '처음 고른 파트너', 'Happy') : ''}</div>`)}
      ${sec(i++, '🤝 가장 오래 함께한 포켓몬', lead || mate ? `<div class="end-cards">${lead ? card(+lead[0], `리더로 ${lead[1]}번 탐험`) : ''}${mate ? card(+mate[0], `동료로 ${mate[1]}번 탐험`) : ''}</div>` : none)}
      ${sec(i++, '🔆 처음 진화시킨 포켓몬', f.evolve ? `<div class="end-cards">${card(f.evolve.from, '진화 전', 'Normal')}<span class="end-arrow">→</span>${card(f.evolve.to, `${f.evolve.day}일째`)}</div>` : none)}
      ${sec(i++, '✨ 처음 만난 이로치', f.shiny && DATA.species[f.shiny.sp] ? `<div class="end-cards"><div class="end-card">${portraitImg(f.shiny.sp, 'portrait big', 'Normal', true)}<b>${esc(spName(f.shiny.sp))}</b><span class="dim">${f.shiny.day}일째</span></div></div>`
        : Object.keys(s.shinySeen || {}).length ? `<p class="dim center">이로치를 ${Object.values(s.shinySeen).reduce((a, b) => a + b, 0)}번 만났어요 (처음 만난 이로치는 v0.70부터 기록돼요)</p>` : '<p class="dim center">아직 이로치를 만나지 못했어요</p>')}
      ${sec(i++, '👑 처음 함께한 전설', `<div class="end-cards">${f.ultra ? card(f.ultra.sp, `초전설 · ${f.ultra.day}일째`, 'Determined') : ''}${f.legend ? card(f.legend.sp, `전설 · ${f.legend.day}일째`, 'Determined') : ''}</div>
        ${!f.ultra && !f.legend ? (legends.length ? '' : none) : ''}
        <p class="dim center">함께하는 초전설 ${ultra.length}마리 · 전설·환상 ${legend.length}마리</p>`)}
      ${sec(i++, '📜 잊지 못할 순간', `<div class="end-stats">
        ${stat('처음 쓰러진 곳', f.faint ? `${dn(f.faint.dungeon)} ${f.faint.floor}층 <span class="dim">(${f.faint.day}일째)</span>` : '<span class="dim">기록 없음</span>')}
        ${stat('처음 구조한 곳', f.rescue ? `${dn(f.rescue.dungeon)} ${f.rescue.floor || ''}층 <span class="dim">(${f.rescue.day}일째)</span>` : '<span class="dim">기록 없음</span>')}
        ${stat('가장 많이 도전한 던전', most && dungeonById(most[0]) ? `${dn(most[0])} <span class="dim">(${most[1]}번)</span>` : '<span class="dim">기록 없음</span>')}
        ${stat('처음 클리어한 던전', f.clear ? `${dn(f.clear.dungeon)} <span class="dim">(${f.clear.day}일째)</span>` : '<span class="dim">기록 없음</span>')}</div>`)}
      ${sec(i++, '📖 도감', `<div class="end-stats">
        ${stat('만난 포켓몬', `${dexC.seen} / ${dexC.total} (${pct(dexC.seen, dexC.total)}%)`)}
        ${stat('쓰러뜨린 포켓몬', `${dexC.beaten} / ${dexC.total} (${pct(dexC.beaten, dexC.total)}%)`)}
        ${stat('영입한 포켓몬', `${ownN} / ${dexC.total} (${pct(ownN, dexC.total)}%)`)}
        ${stat('얻은 이로치', `${shinyN}종`)}</div>`)}
      ${sec(i++, '🏆 업적', `<div class="end-stats">${stat('달성한 업적', `${achN} / ${Progress.ACH.length} (${pct(achN, Progress.ACH.length)}%)`)}</div>`)}
      ${sec(i++, '📊 탐험 기록', `<div class="end-stats">
        ${stat('탐험한 날', `${s.day}일`)}
        ${stat('플레이 시간', s.playSec ? playText(s.playSec) : '<span class="dim">기록 없음</span>')}
        ${stat('쓰러뜨린 적', `${st.kills || 0}마리`)}
        ${stat('내려간 계단', `${st.floors || 0}번`)}
        ${stat('쓰러뜨린 보스', `${st.bosses || 0}마리`)}
        ${stat('클리어한 던전', `${Object.keys(s.cleared || {}).length}곳`)}
        ${stat('완료한 임무', `${st.missions || 0}번`)}
        ${stat('친구 구조', `${st.rescues || 0}번`)}
        ${stat('진화', `${st.evolves || 0}번`)}
        ${stat('쓰러진 횟수', `${st.faints || 0}번`)}
        ${stat('최고 레벨', `Lv${st.maxLv || 0}`)}</div>`)}
      ${sec(i++, '', `<p class="end-title small">그리고 탐험은 계속된다…</p><p class="center dim">플레이해 주셔서 고맙습니다.</p>${Online.enabled() ? '<div class="btns center"><button class="btn" data-end-global>🌍 다른 탐험대는?</button></div>' : ''}`)}
    </div>`;
    Sound.play('clear');
    UI.open({ title: first ? '🎬 엔딩' : '🎬 탐험 기록', wide: true, html, choices: [{ label: '마을로 돌아간다', fn: () => {} }],
      onOpen: box => { const b = box.querySelector('[data-end-global]'); if (b) b.onclick = () => showEndingStats(); } });
  }

  // 로그라이크 기술 고르기 (v0.95): Lv5까지 배우는 기술이 4개를 넘으면 입장할 때 4개를 고른다
  //  처음에는 자동으로 들어가던 4개(마지막 4개)를 골라 두고, 고른 조합은 포켓몬마다 기억한다 (ch.rogueMoves)
  //  결과: 고른 기술 배열 / null (고를 필요 없음) / false (그만둔다)
  function pickRogueMoves(sp) {
    const ch = save.roster[sp], pool = learnableUpTo(sp, ROGUE_LEVEL).filter(m => DATA.moves[m]);
    if (pool.length <= 4) return Promise.resolve(null);
    const saved = (ch.rogueMoves || []).filter(m => pool.includes(m));
    let sel = saved.length ? saved : defaultMoves(sp, ROGUE_LEVEL).filter(m => pool.includes(m));
    return new Promise(res => {
      const show = focus => UI.open({ title: `📘 ${esc(spName(sp))} Lv${ROGUE_LEVEL} — 가져갈 기술 4개`, wide: true,
        html: `<p class="dim">이 레벨까지 배우는 기술이 ${pool.length}개라 4개만 가져갈 수 있어요. 눌러서 넣고 빼세요. (고른 조합은 다음 로그라이크에도 기억해요)</p>`,
        choices: [
          ...pool.map((m, i) => ({ def: focus === i, label: `${sel.includes(m) ? '✅' : '⬜'} ${moveLine(m)}`, disabled: !sel.includes(m) && sel.length >= 4,
            sub: !sel.includes(m) && sel.length >= 4 ? '4개를 골랐어요. 다른 기술을 빼면 넣을 수 있어요' : '',
            fn: () => { sel = sel.includes(m) ? sel.filter(x => x !== m) : [...sel, m]; setTimeout(() => show(i), 0); } })),
          { def: focus == null, label: `▶ 이 기술로 출발한다 (${sel.length}/4)`, disabled: !sel.length,
            fn: () => { ch.rogueMoves = pool.filter(m => sel.includes(m)); persist(); res(ch.rogueMoves.slice()); } },
          { label: '그만둔다', fn: () => res(false) }],
        cancel: () => res(false) });
      show(null);
    });
  }
  async function startRun(dg, hard, abilPicks = {}) {
    const sp = save.current, ch = save.roster[sp];
    const rogueMoves = !hard && dg.mode === 'rogue' ? await pickRogueMoves(sp) : null;
    if (rogueMoves === false) return;
    noteUse(sp, 'lead'); if (dg.mode === 'normal') for (const id of partyList()) noteUse(id, 'party');   // 엔딩: 가장 많이 함께한 포켓몬
    noteUse(dg.id, 'dungeon');   // 엔딩: 가장 많이 도전한 던전
    let p, bag;
    if (hard) {
      const lv = dg.lv[1];
      p = makeHardMember(sp, lv, { player: true }, abilPicks[sp]);
      p.belly = 100;
      const run = { dungeon: dg.id, floor: 1, mode: 'normal', hard: true, hardLv: lv, p, bag: hardKit(lv), kit: hardKit(lv), money: 0, done: [], party: partyList().map(id => makeHardMember(id, lv, { ally: true }, abilPicks[id])).map(a => Object.assign(a, { ally: true })), carried: null };
      show('dungeon-screen');
      Dungeon.enter(run);
      return;
    }
    if (dg.mode === 'rogue') {
      p = makeCreature(sp, ROGUE_LEVEL, { player: true, ability: entryAbility(sp, ch), moves: rogueMoves || undefined });
      p.shiny = !!ch.shiny;
      p.held = ch.held || null;   // 지닌 물건 하나는 들고 간다 (메가스톤·전용 도구·모습 바꾸는 도구). 캐릭터 기록에서는 빠지지 않는다
      bag = [{ id: 'oran', n: 1 }, { id: 'oran', n: 1 }, { id: 'apple', n: 1 }];
    } else {
      p = makeCreature(sp, ch.lv, { player: true, exp: ch.exp, moves: ch.moves.length ? ch.moves : undefined, ability: entryAbility(sp, ch), boost: ch.boost });
      p.held = ch.held || null;
      p.shiny = !!ch.shiny;
      p.tms = (ch.tms || []).slice();
      bag = JSON.parse(JSON.stringify(save.bag));
    }
    p.selForm = ch.form || undefined;   // 캐릭터 탭에서 골라 둔 모습 (로토무 등)
    p.belly = 100;
    const run = { dungeon: dg.id, floor: 1, mode: dg.mode, p, bag, money: 0, done: [], party: dg.mode === 'normal' ? partyList().map(makePartner) : [], carried: dg.mode === 'rogue' ? ch.held || null : null };
    show('dungeon-screen');
    Dungeon.enter(run);
  }

  // 오늘의 도전: 그날 정해진 포켓몬으로, 하루 한 번
  async function prepareDaily() {
    if (Progress.dailyRecord()) return;
    const dg = Progress.setupDaily();
    const ok = await UI.confirm(esc(dg.n), `<div class="center">${portraitImg(dg.hero, 'portrait big')}</div>
      <p class="center">오늘의 주인공 <b>${esc(spName(dg.hero))}</b> Lv${ROGUE_LEVEL}</p><ul>
      <li>${dg.floors}층짜리 로그라이크 던전입니다. 오늘은 누구나 같은 포켓몬, 같은 맵으로 도전합니다.</li>
      <li><b>하루 한 번</b>만 도전할 수 있습니다. 도중에 창을 닫으면 그 층의 처음부터 이어집니다.</li>
      <li>가방은 오랭열매 2개, 사과 1개, 자갈 5개로 시작합니다. 내 캐릭터와 가방은 그대로 보존됩니다.</li>
      <li>보상: 도달한 층 × ₽${Progress.DAILY_REWARD.floor} (완주하면 ₽${Progress.DAILY_REWARD.clear} 추가). 쓰러져도 받을 수 있어요.</li></ul>`, '도전한다', '그만둔다');
    if (!ok) return;
    const p = makeCreature(dg.hero, ROGUE_LEVEL, { player: true });
    p.belly = 100;
    const run = { dungeon: 'daily', daily: dg.date, floor: 1, mode: 'rogue', p, bag: [{ id: 'oran', n: 1 }, { id: 'oran', n: 1 }, { id: 'apple', n: 1 }, { id: 'gravel', n: 5 }], money: 0, done: [], turns: 0, kills: 0 };
    // 시작하자마자 기록을 남겨서 다시 도전하지 못하게 한다
    save.daily = { date: dg.date, sp: dg.hero, floor: 1, clear: false, turns: 0, lv: ROGUE_LEVEL, kills: 0 };
    persist();
    show('dungeon-screen');
    Dungeon.enter(run);
  }

  // 던전 층수가 줄었을 때(v0.87 테마 던전 30 → 25층): 진행 중인 탐험·임무·구조 요청의 층을 마지막 층까지로 맞춘다
  function fitFloors(s) {
    const fit = o => { const dg = o && dungeonById(o.dungeon); if (dg && o.floor > dg.floors) o.floor = dg.floors; };
    if (s.run) { const was = s.run.floor; fit(s.run); if (s.run.floor !== was) { s.run.bossDone = null; s.run.bossPick = null; } }
    (s.missions && s.missions.accepted || []).forEach(fit); (s.missions && s.missions.board || []).forEach(fit);
    fit(s.sos);
    for (const [id, f] of Object.entries(s.best || {})) { const dg = dungeonById(id); if (dg && f > dg.floors) s.best[id] = dg.floors; }   // 최고 기록도 (예: 25층 던전에 '최고 28F'가 나오지 않게)
  }
  function saveRunSnapshot(r) {
    const p = r.p;
    save.run = { dungeon: r.dungeon, floor: r.floor, bossDone: r.bossDone === r.floor ? r.floor : null, bossPick: r.bossPick && r.bossPick.floor === r.floor ? r.bossPick : null, mode: r.mode, bag: r.bag, money: r.money, done: r.done, daily: r.daily || null, turns: r.turns || 0, kills: r.kills || 0, carried: r.carried || null, stats: r.stats || null,
      ...(r.hard ? { hard: true, hardLv: r.hardLv, rsp: p.rsp, kit: r.kit } : {}),
      p: { sp: p.sp, lv: p.lv, exp: p.exp, hp: p.hp, belly: p.belly, status: p.status, statusT: p.statusT, moves: ownMoves(p).map(m => m.id), pp: ownMoves(p).map(m => m.pp), ability: p.baseAbility ?? p.ability, held: p.held || null, tms: p.tms || [], shiny: !!p.shiny, boost: p.boost || null, form: p.selForm || null } };
    save.run.party = (r.party || []).map(a => ({ sp: a.sp, rsp: a.rsp, lv: a.lv, exp: a.exp, hp: a.hp, moves: ownMoves(a).map(m => m.id), pp: ownMoves(a).map(m => m.pp), ability: a.baseAbility ?? a.ability, fainted: !!a.fainted, status: a.status, statusT: a.statusT }));
    saveParty(r);
    // 일반 던전은 층마다 레벨도 저장
    if (r.hard) saveHardMember(p, true);
    else if (r.mode === 'normal') save.roster[p.sp] = { ...save.roster[p.sp], lv: p.lv, exp: p.exp, moves: ownMoves(p).map(m => m.id), held: p.held || null, tms: p.tms || [], ...(p.boost ? { boost: p.boost } : {}) };
    persist();
  }

  function resumeRun() {
    const s = save.run;
    if (s.daily) Progress.setupDaily(s.daily);
    if (s.hard) {   // 하드모드: 고정 레벨 탐험대를 다시 만들고 저장된 HP·기술 상태를 얹는다
      if (!save.roster[s.rsp]) { save.run = null; persist(); renderTown(); return; }
      const restore = (c, x) => { if (x.ability != null && DATA.species[c.sp].ab.some(a => a[0] === x.ability)) { c.ability = x.ability; c.baseAbility = x.ability; } c.hp = clamp(x.hp, 1, c.maxhp); c.status = x.status; c.statusT = x.statusT; if (x.moves) { c.moves = x.moves.map((id, i) => ({ ...newMove(c, id), pp: x.pp ? x.pp[i] : undefined })).map(m => ({ ...m, pp: m.pp ?? m.max })); } return c; };
      const p = restore(makeHardMember(s.rsp, s.hardLv, { player: true }), s.p);
      p.belly = s.p.belly; p.held = s.p.held || null;
      const party = (s.party || []).filter(x => save.roster[x.rsp]).map(x => { const a = restore(Object.assign(makeHardMember(x.rsp, s.hardLv, { ally: true }), { ally: true }), x); a.fainted = !!x.fainted; return a; });
      const run = { dungeon: s.dungeon, floor: s.floor, bossDone: s.bossDone || null, bossPick: s.bossPick || null, mode: 'normal', hard: true, hardLv: s.hardLv, kit: s.kit || [], p, bag: s.bag, money: s.money, done: s.done, turns: s.turns || 0, kills: s.kills || 0, party, carried: null, stats: s.stats || null };
      show('dungeon-screen');
      Dungeon.enter(run);
      return;
    }
    const p = makeCreature(s.p.sp, s.p.lv, { player: true, exp: s.p.exp, moves: s.p.moves, pp: s.p.pp, ability: s.p.ability ?? entryAbility(s.p.sp, save.roster[s.p.sp]), boost: s.p.boost || undefined });
    p.hp = clamp(s.p.hp, 1, p.maxhp); p.belly = s.p.belly; p.held = s.p.held || null; p.tms = s.p.tms || []; p.shiny = !!s.p.shiny; p.status = s.p.status; p.statusT = s.p.statusT; p.selForm = s.p.form || undefined;
    const party = (s.party || []).filter(x => save.roster[x.sp]).map(x => {
      const a = makePartner(x.sp);
      Object.assign(a, makeCreature(x.sp, x.lv, { ally: true, exp: x.exp, moves: x.moves, pp: x.pp, ability: x.ability, boost: save.roster[x.sp].boost }), { ally: true, held: a.held, shiny: a.shiny, tms: a.tms, selForm: a.selForm });
      a.hp = clamp(x.hp, 1, a.maxhp); a.fainted = !!x.fainted; a.status = x.status; a.statusT = x.statusT;
      return a;
    });
    const run = { dungeon: s.dungeon, floor: s.floor, bossDone: s.bossDone || null, bossPick: s.bossPick || null, mode: s.mode, p, bag: s.bag, money: s.money, done: s.done, daily: s.daily || null, turns: s.turns || 0, kills: s.kills || 0, party, carried: s.carried || null, stats: s.stats || null };
    show('dungeon-screen');
    Dungeon.enter(run);
  }
  function abandonSavedRun() {
    const s = save.run;
    if (s.daily) Progress.setupDaily(s.daily);
    const fake = { dungeon: s.dungeon, floor: s.floor, mode: s.mode, bag: s.bag, money: s.money, done: [], daily: s.daily || null, turns: s.turns || 0, kills: s.kills || 0, hard: !!s.hard,
      kit: s.kit || [], p: { sp: s.p.sp, rsp: s.rsp, lv: s.p.lv, exp: s.p.exp, ability: s.p.ability, held: s.p.held, moves: s.p.moves.map(id => ({ id })) } };
    finishRun(fake, 'faint');
  }

  function endRun(outcome) {
    const r = Dungeon.run;
    if (!r) return;
    Dungeon.leave();
    UI.closeAll();
    // 일반 던전에서 쓰러졌을 때: 친구에게 구조를 요청할 수 있다 (요청은 한 번에 하나)
    if (outcome === 'faint' && r.mode === 'normal' && !r.hard) {
      show('town-screen'); renderTown(); Sound.town();   // 구조 요청 창도 마을에서 띄운다 (던전 음악이 남지 않게)
      if (save.sos) {
        UI.alert('구조 요청 불가', '<p>이미 기다리고 있는 구조 요청이 있어서 새로 요청할 수 없습니다.</p>').then(() => finishRun(r, 'faint'));
        return;
      }
      UI.open({
        title: '눈앞이 캄캄해졌다...',
        html: `<div class="center">${portraitImg(r.p.sp, 'portrait big', 'Pain', r.p.shiny)}</div>
          <p>친구에게 <b>구조를 요청</b>할 수 있습니다. ${Online.loggedIn() ? '요청하면 <b>구조 게시판에 자동으로 올라가고</b>' : '요청하면 SOS 코드가 나오고'}, 구조될 때까지 아이템과 돈을 잃지 않고 기다립니다.
          기다리는 동안에도 다른 던전은 탐험할 수 있어요.</p>`,
        choices: [{ label: Online.loggedIn() ? '🆘 구조를 요청한다 (구조 게시판에 올리기)' : '🆘 구조를 요청한다 (SOS 코드 만들기)', fn: () => createSOS(r) }, { label: '포기하고 돌아간다', fn: () => finishRun(r, 'faint') }],
        cancel: false,
      });
      return;
    }
    finishRun(r, outcome === 'quit' ? 'faint' : outcome);
  }

  // ───────────────────────── 친구 구조 (코드) ─────────────────────────
  function codeBox(title, html, code, label, then, extra = []) {
    UI.open({
      title, wide: true,
      html: `${html}<div class="code-box"><input class="code-text" readonly value="${code}"><button class="btn sm" data-copy>복사</button></div>
        <p class="dim">코드는 메신저 등으로 친구에게 보내 주세요. 이 화면은 임무 탭에서 다시 볼 수 있습니다.</p>`,
      choices: [{ label: label || '확인', fn: then || (() => {}), def: true }, ...extra], cancel: then || (() => {}),
      onOpen: box => {
        const inp = box.querySelector('.code-text');
        inp.onclick = () => inp.select();
        box.querySelector('[data-copy]').onclick = async () => {
          try { await navigator.clipboard.writeText(code); UI.toast('복사했습니다.'); }
          catch (e) { inp.select(); document.execCommand && document.execCommand('copy'); UI.toast('선택된 코드를 Ctrl+C로 복사하세요.'); }
        };
      },
    });
  }
  function sosCode(s) { return Codes.encode('sos', { id: s.id, dg: DUNGEONS.findIndex(d => d.id === s.dungeon), fl: s.floor, sp: s.sp, lv: s.lv, sh: s.shiny ? 1 : 0 }); }

  async function createSOS(r) {
    const p = r.p;
    const s = {
      id: Codes.newId(), dungeon: r.dungeon, floor: r.floor, sp: p.sp, lv: p.lv, shiny: !!p.shiny, day: save.day, created: Date.now(),
      snap: { bag: r.bag, money: r.money, done: r.done, held: p.held || null, stats: r.stats || null },
    };
    save.sos = s;
    save.mySOS = [...(save.mySOS || []), s.id].slice(-50);   // 내가 보낸 구조 요청 (포기한 뒤에도 내 코드로 구조하러 가지 못하게)
    saveParty(r);
    // 레벨은 그대로 남고, 가방과 지닌 물건은 쓰러진 곳에 남아 구조를 기다린다
    save.roster[p.sp] = { ...save.roster[p.sp], lv: p.lv, exp: p.exp, moves: ownMoves(p).map(m => m.id), held: null, ...(p.tms ? { tms: p.tms } : {}), ...(p.boost ? { boost: p.boost } : {}) };
    save.bag = [];   // 가방은 쓰러진 곳에서 구조를 기다린다 (s.snap.bag)
    save.best[r.dungeon] = Math.max(save.best[r.dungeon] || 0, r.floor);
    save.run = null; save.day++; refreshDay(); persist();
    tab = 'mission'; renderTown();
    let posted = false;
    if (Online.loggedIn()) {
      // 서버가 대답하지 않으면 (연결이 끊기면 쓰기가 실패하지 않고 계속 기다린다) SOS_POST_WAIT 뒤 코드를 먼저 보여 준다 (v0.95)
      //  늦게라도 올라가면 그때 게시판 요청으로 이어 둔다 (코드와 게시판 둘 다 쓸 수 있다)
      const post = Online.postSOS(s);
      try {
        const id = await Promise.race([post, new Promise(res => setTimeout(() => res(null), SOS_POST_WAIT))]);
        if (id) { s.docId = id; s.online = true; posted = true; persist(); renderTown(); }
        else {
          UI.toast('구조 게시판 서버가 대답하지 않아요. 코드로 친구에게 부탁해 주세요.');
          post.then(late => { if (late && save.sos === s && !s.revived) { s.docId = late; s.online = true; persist(); renderTown(); } }).catch(() => {});
        }
      } catch (e) { console.warn(e); UI.toast('구조 게시판에 올리지 못했어요. 코드로 친구에게 부탁해 주세요.'); }
      // 쓰기는 됐어도 읽기 한도를 넘었으면 아무도 게시판을 못 본다: 읽어 보고 막혔으면 코드를 보여 준다
      if (posted) { try { await Promise.race([Online.probeSOS(s.docId), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), SOS_POST_WAIT))]); } catch (e) { posted = false; UI.toast('구조 게시판을 지금 읽을 수 없어요. 코드로 친구에게 부탁해 주세요.'); } }
    }
    // 게시판에 올라갔으면 코드를 보여 주지 않는다 (코드를 커뮤니티에 따로 올리는 일이 많았다. 게시판에서 사라지면 다시 코드가 나온다)
    if (posted) { sosPostedNote(s); return; }
    codeBox('🆘 SOS 코드', `<p>${esc(dungeonById(s.dungeon).n)} ${s.floor}F에서 쓰러진 <b>${esc(spName(s.sp))}</b> Lv${s.lv}의 구조 요청입니다.</p>
      <p>친구가 이 코드로 구조해 주면 <b>A-OK 코드</b>를 받게 됩니다. 그 코드를 임무 탭에 입력하면 쓰러진 층부터 이어서 탐험할 수 있어요.</p>`, sosCode(s));
  }
  function sosPostedNote(s) {
    UI.alert('🆘 구조 요청', `<p>${esc(dungeonById(s.dungeon).n)} ${s.floor}F에서 쓰러진 <b>${esc(spName(s.sp))}</b> Lv${s.lv}의 구조 요청입니다.</p>
      <p>📋 <b>구조 게시판에 자동으로 올렸어요.</b> 게임 안의 다른 탐험대가 게시판에서 보고 구조하러 와요.</p>
      <p class="warn">커뮤니티 등에 따로 구조 글이나 코드를 올리지 않아도 됩니다.</p>
      <p class="dim">누군가 구조하러 출발하거나 구조하면 임무 탭에서 자동으로 알려 드려요.</p>`);
  }

  // 달성 선물: 친구 구조 / 임무 완료 횟수가 정해진 수에 닿을 때마다 창고로 (두 횟수는 따로 센다)
  const GIFT_NAMES = { rescues: '친구 구조', missions: '임무 완료' };
  // 임무 횟수는 친구 구조를 뺀 게시판 임무만 (기록의 '임무'에는 친구 구조도 들어 있다)
  const giftCount = kind => kind === 'missions' ? Math.max(0, Progress.stat('missions') - Progress.stat('rescues')) : Progress.stat(kind);
  function milestoneGift(kind, lines) {
    const n = giftCount(kind), every = MILESTONE_GIFT[kind];
    if (n <= 0 || n % every) return;
    const id = pick(milestoneGiftPool());
    storeAdd(id);
    lines.push(`🎁 ${GIFT_NAMES[kind]} ${n}번 달성 선물: ${ITEMS[id].icon} <b>${esc(ITEMS[id].n)}</b> (창고로)`);
  }
  // 달성 선물 진행: 설명과 횟수를 섞지 않고, 횟수는 칸(●○)과 숫자로 따로 보여 준다 (v0.94)
  const GIFT_ICONS = { rescues: '🆘', missions: '📜' };
  function giftNote() {
    const row = kind => {
      const n = giftCount(kind), every = MILESTONE_GIFT[kind], k = n % every;
      return `<div class="gift-row"><span class="gift-name">${GIFT_ICONS[kind]} ${GIFT_NAMES[kind]}</span>
        <span class="gift-pips" title="${every}번마다 선물">${'●'.repeat(k)}${'○'.repeat(every - k)}</span>
        <span class="gift-left">다음 선물까지 <b>${every - k}</b>번</span><span class="gift-total dim">누적 ${n}번</span></div>`;
    };
    return `<div class="gift-box"><div class="dim">🎁 <b>달성 선물</b> — 영양제·구미(무지개구미 포함)·특성패치 중 하나를 창고로 드려요</div>${row('rescues')}${row('missions')}</div>`;
  }
  function sosSection() {
    const s = save.sos;
    let h = '<h3>🆘 친구 구조</h3>' + giftNote();
    if (s) {
      const dg = dungeonById(s.dungeon);
      h += `<div class="row sos-row">${portraitImg(s.sp, 'portrait sm', s.revived ? 'Happy' : 'Pain', s.shiny)}<div class="grow">
        ${s.revived ? `<b>구조되었습니다!</b> ${esc(dg.n)} ${s.floor}F에서 이어서 탐험할 수 있어요.` : `<b>구조를 기다리는 중</b> — ${esc(dg.n)} ${s.floor}F에서 쓰러진 ${esc(spName(s.sp))} Lv${s.lv}`}
        <div class="dim">가방 ${s.snap.bag.length}칸${s.snap.held ? ` · 지닌 물건 ${esc(ITEMS[s.snap.held].n)}` : ''}이 함께 기다리고 있습니다.</div>
        ${s.revived ? '' : `<div class="${sosLeft(s) < 6 * 3600e3 ? 'warn' : 'dim'}">⏳ 구조 가능 시간 ${Math.max(0, Math.floor(sosLeft(s) / 3600e3))}시간 ${Math.max(0, Math.floor(sosLeft(s) / 60000) % 60)}분 남음 <span class="dim">(48시간이 지나면 구조 실패: 포기와 같은 패널티)</span></div>`}
        ${s.online && !s.revived ? (s.takenAt && s.takenAt > Date.now() - SOS_HOLD_MS
          ? `<div class="ok">🏃 다른 탐험대가 구조하러 출발했어요! (${Math.max(1, Math.round((Date.now() - s.takenAt) / 60000))}분 전) <span class="dim">구조하던 탐험대가 게임을 끄거나 30분 넘게 던전에 들어가지 않으면 다시 게시판에 올라가요.</span></div>`
          : '<div class="dim">📋 구조 게시판에 올라가 있어요. 누군가 구조하러 가면 여기에 표시되고, 구조하면 자동으로 알려 드려요.</div>') : ''}
        ${s.revived ? '' : `<div class="dim">🦨 ${sosAutoLeft(s) > 0 ? `${Math.ceil(sosAutoLeft(s) / 60000)}분 뒤에도` : '곧'} 구조하러 온 탐험대가 없으면 ${SOS_AUTO_NAME}가 대신 구조하러 와요.</div>`}</div>
        ${s.revived ? '<button class="btn sm" data-act="sos-resume">이어서 탐험</button>' : `<button class="btn sm ghost" data-act="sos-show">${s.online && !Online.serverDown() ? '자세히' : 'SOS 코드'}</button>` + ' <button class="btn sm ghost danger" data-act="sos-giveup">포기</button>'}</div>`;
    }
    if (Online.enabled()) h += Online.loggedIn()
      ? '<div class="row"><span class="grow">📋 <b>구조 게시판</b> <span class="dim">다른 플레이어의 구조 요청을 골라서 구하러 갈 수 있어요.</span></span><button class="btn sm" data-act="sos-board">게시판 보기</button></div>'
      : '<div class="row"><span class="grow dim">📋 로그인하면 구조 게시판에서 다른 플레이어를 구조하거나 구조 요청을 올릴 수 있어요.</span><button class="btn sm ghost" data-act="account">로그인</button></div>';
    h += `<div class="code-box"><input id="code-input" placeholder="친구에게 받은 코드 입력 (SOS / A-OK / 감사 코드)" autocomplete="off"><button class="btn sm" data-act="code-enter">입력</button></div>`;
    const sent = (save.aokSent || []).slice(-3);
    if (sent.length) h += `<div class="dim">보낸 A-OK 코드: ${sent.map(a => `<a href="#" data-act="aok-show" data-arg="${a.id}">${esc(spName(a.sp))} (${a.code.slice(0, 9)}…)</a>`).join(', ')}</div>`;
    return h;
  }

  async function enterCode() {
    const inp = document.getElementById('code-input');
    const d = Codes.decode(inp ? inp.value : '');
    if (d.error) { UI.alert('코드 오류', `<p>${esc(d.error)}</p>`); return; }
    if (d.type === 'sos') return acceptSOS(d);
    if (d.type === 'aok') return receiveAOK(d);
    if (d.type === 'thx') return receiveTHX(d);
  }

  // 친구의 SOS → 구조 임무
  async function acceptSOS(d, from, docId) {
    const dg = DUNGEONS[d.dg];
    // v0.87에 30층 → 25층으로 줄인 던전의 예전 코드도 받는다 (마지막 층으로)
    if (!dg || dg.mode !== 'normal' || d.fl < 1 || d.fl > Math.max(dg.floors, 30) || !DATA.species[d.sp]) { UI.alert('코드 오류', '<p>이 게임에서 쓸 수 없는 SOS 코드입니다.</p>'); return; }
    const selfMsg = () => UI.alert('구조 불가', '<p>자기 자신의 구조 요청은 받을 수 없어요. 친구에게 보내 주세요.</p>');
    if ((save.sos && save.sos.id === d.id) || (save.mySOS || []).includes(d.id)) { selfMsg(); return; }
    // 로그인했으면 서버에서도 확인: 같은 계정이 다른 기기·세이브에서 올린 요청
    if (!docId && Online.loggedIn()) { try { if (await Online.findMySOS(d.id)) { selfMsg(); return; } } catch (e) { /* 확인 실패: 그대로 진행 */ } }
    if ((save.rescued || {})[d.id] || save.missions.accepted.some(m => m.sosId === d.id)) { UI.alert('구조 불가', '<p>이미 받았거나 구조를 마친 요청입니다.</p>'); return; }
    // 코드로 들어왔어도 게시판에 올라간 요청이면 서버의 상태를 본다: 이미 구조됐거나 끝난 요청은 받지 않고, 기다리는 중이면 게시판 구조로 받는다
    if (!docId && Online.loggedIn()) {
      let doc = null;
      try { doc = await Online.findSOSById(d.id); } catch (e) { /* 확인 실패: 코드 구조로 그대로 진행 */ }
      if (doc) {
        if (doc.status !== 'open') { UI.alert('구조 불가', '<p>이미 다른 탐험대가 구조한 요청이에요.</p>'); return; }
        if (doc.created && doc.created < Date.now() - SOS_EXPIRE_MS) { UI.alert('구조 불가', '<p>48시간이 지나 끝난 구조 요청이에요.</p>'); return; }
        docId = doc.docId; from = Online.cleanName(doc.name);
      }
    }
    if (!unlocked(dg)) { UI.alert('구조 불가', `<p>${esc(jo(dg.n, '은'))} 아직 열리지 않은 던전이라 구조하러 갈 수 없어요.</p><p class="dim">${esc(jo(dungeonById(dg.req).n, '을'))} 클리어하면 열립니다.</p>`); return; }
    if (save.missions.accepted.length >= missionMax()) { UI.alert('구조 불가', `<p>진행 중인 임무가 ${missionMax()}개입니다. 하나를 끝내거나 취소한 뒤 받아 주세요.</p>`); return; }
    if (docId && save.missions.accepted.filter(m => m.online).length >= ONLINE_RESCUE_MAX) { UI.alert('구조 불가', `<p>게시판 구조 임무는 한 번에 ${ONLINE_RESCUE_MAX}개까지 받을 수 있어요. 먼저 받은 구조를 끝내 주세요.</p>`); return; }
    const reward = Math.round((150 + d.fl * 40) * (1 + dungeonTier(dg) * 0.5) * MISSION_MONEY_MUL / 10) * 10;
    const ok = await UI.confirm('🆘 구조 요청', `<div class="center">${portraitImg(d.sp, 'portrait big', 'Pain', !!d.sh)}</div>
      <p class="center"><b>${esc(dg.n)} ${d.fl}F</b>에서 ${from ? `<b>${esc(from)}</b> 님` : '친구'}의 Lv${d.lv} <b>${esc(jo(spName(d.sp), '이'))}</b> 쓰러져 있습니다.</p>
      <p class="center dim">그 층까지 내려가서 말을 걸면 구조 성공. 보상 ₽${reward} + ${from ? '마을로 돌아오면 구조 완료가 자동으로 전해져요' : 'A-OK 코드'}</p>
      ${from ? '<p class="center dim">구조를 마치면 구조 보답(무작위 아이템과 돈)도 받아요. 30분 동안은 이 요청이 다른 사람에게 보이지 않아요. 그 던전에 들어가 있는 동안은 자동으로 연장돼요.</p>' : ''}`, '구조하러 간다', '그만둔다');
    if (!ok) return;
    if (docId) {   // 게시판 요청: 먼저 맡는다 (이미 누가 맡았으면 받을 수 없음)
      let got = false;
      try { got = await Online.takeSOS(docId); } catch (e) { UI.alert('구조 불가', `<p>${esc(Online.why(e))}</p>`); return; }
      if (!got) { UI.alert('구조 불가', '<p>방금 다른 탐험대가 구조하러 갔거나, 이미 구조된 요청이에요.</p>'); return; }
    }
    save.missions.accepted.push({ id: 'sos' + d.id, kind: 'sos', sosId: d.id, dungeon: dg.id, floor: Math.min(d.fl, dg.floors), client: d.sp, lv: d.lv, shiny: !!d.sh, reward, ...(from ? { online: true, from, docId, heldAt: Date.now() } : {}) });
    const ci = document.getElementById('code-input'); if (ci) ci.value = '';
    persist(); renderTown(); UI.toast('구조 임무를 받았습니다!');
  }

  // 내 SOS에 대한 A-OK → 부활
  async function receiveAOK(d, from) {
    const s = save.sos;
    if (!s || s.id !== d.id) { UI.alert('코드 오류', '<p>지금 기다리고 있는 구조 요청에 대한 A-OK 코드가 아닙니다.</p>'); return; }
    if (s.revived) { UI.alert('이미 구조됨', '<p>이미 구조되었어요. 임무 탭에서 이어서 탐험할 수 있습니다.</p>'); return; }
    s.revived = { sp: d.sp, lv: d.lv, sh: !!d.sh, ...(from ? { from } : {}), ...(d.noGift ? { noGift: true } : {}) };
    const ci = document.getElementById('code-input'); if (ci) ci.value = '';
    if (s.online && !from) { s.online = false; Online.deleteSOS(s.docId || s.id).catch(() => {}); }   // 코드로 구조됨: 게시판에서 내린다
    persist(); renderTown();
    await UI.alert('구조되었다!', `<div class="center">${portraitImg(d.sp, 'portrait big', 'Happy', !!d.sh)} ${portraitImg(s.sp, 'portrait big', 'Joyous', s.shiny)}</div>
      <p class="center">${from ? `<b>${esc(from)}</b> 님` : '친구'}의 <b>${esc(spName(d.sp))}</b> Lv${d.lv} 덕분에 ${esc(jo(spName(s.sp), '이'))} 되살아났다!</p>`);
    // 감사 선물 (선택). 선물을 받지 않는 탐험대면 감사 편지만
    if (s.revived.noGift) {
      UI.open({ title: '💌 감사 편지', html: `<p><b>${esc(from || '구조해 준 탐험대')}</b> 님은 감사 선물을 받지 않아요. 감사 편지만 보낼게요.</p>`,
        choices: [{ label: '감사 편지를 보낸다', fn: () => sendThanks(s, null) }], cancel: false });
      return;
    }
    const gifts = [...save.bag.map((b, i) => ({ id: b.id, from: 'bag', i })), ...Object.keys(save.storage).filter(id => save.storage[id] > 0).map(id => ({ id, from: 'storage' }))]
      .filter(g => ITEMS[g.id] && g.id !== 'quest');
    UI.open({
      title: '💌 감사 선물', wide: true,
      html: s.online ? '<p>구조해 준 탐험대에게 감사 편지와 함께 아이템 하나를 선물할 수 있어요. 상대의 창고로 들어갑니다.</p>'
        : '<p>구조해 준 친구에게 아이템 하나를 선물할 수 있어요. 감사 코드를 보내면 친구의 창고로 들어갑니다.</p>',
      choices: [{ label: s.online ? '선물 없이 감사 편지만 보낸다' : '선물 없이 감사 코드만 보낸다', fn: () => sendThanks(s, null) },
        ...gifts.slice(0, 40).map(g => ({ label: `${ITEMS[g.id].icon} ${esc(ITEMS[g.id].n)} <span class="dim">(${g.from === 'bag' ? '가방' : '창고'})</span>`, fn: () => {
          if (g.from === 'bag') save.bag.splice(g.i, 1); else { save.storage[g.id]--; if (save.storage[g.id] <= 0) delete save.storage[g.id]; }
          sendThanks(s, g.id);
        } }))],
      cancel: false,
    });
  }
  function receiveAOKAgain() {
    const s = save.sos; if (!s || !s.revived) return;
    UI.confirm('이어서 탐험', `<p>구조해 준 ${s.online ? '탐험대에게 감사 편지를' : '친구에게 감사 코드를'} 보내지 않았어요. 선물 없이 감사 ${s.online ? '편지를 보내고' : '코드를 만들고'} 이어서 탐험할까요?</p>`, '그렇게 한다', '그만둔다')
      .then(ok => { if (ok) sendThanks(s, null); });
  }
  function sendThanks(s, itemId) {
    if (s.online) {
      save.thxQueue = [...(save.thxQueue || []), { id: s.docId || s.id, item: itemId }];
      s.thx = 'online'; persist(); renderTown();
      flushThanks().catch(e => console.warn('감사 편지는 다음에 다시 보냅니다', e));
      UI.open({ title: '💌 감사 편지', html: `<p>${s.revived && s.revived.from ? `<b>${esc(s.revived.from)}</b> 님에게` : '구조해 준 탐험대에게'} 감사 편지를 보냈어요.${itemId ? ` 선물: ${ITEMS[itemId].icon} ${esc(ITEMS[itemId].n)}` : ''}</p>`,
        choices: [{ label: '쓰러진 층부터 이어서 탐험한다', fn: resumeSOS }], cancel: () => renderTown() });
      return;
    }
    const code = Codes.encode('thx', { id: s.id, item: Codes.itemToNum(itemId) });
    s.thx = code; persist(); renderTown();
    codeBox('💌 감사 코드', `<p>구조해 준 친구에게 보내 주세요.${itemId ? ` 선물: ${ITEMS[itemId].icon} ${esc(ITEMS[itemId].n)}` : ''}</p>`, code, '쓰러진 층부터 이어서 탐험한다', resumeSOS);
  }

  // 구조된 뒤 이어서 탐험
  function resumeSOS() {
    const s = save.sos; if (!s || !s.revived) return;
    // 기다리는 동안 진화했으면 진화한 모습으로 (예전 세이브: 진화할 때 구조 요청이 따라가지 않았다)
    if (!save.roster[s.sp]) { const evo = evolvedInRoster(s.sp); if (evo) s.sp = evo; }
    const ch = save.roster[s.sp] || newEntry(s.sp);
    const p = makeCreature(s.sp, ch.lv, { player: true, exp: ch.exp, moves: ch.moves.length ? ch.moves : undefined, ability: entryAbility(s.sp, ch), boost: ch.boost });
    Progress.add('rescued');
    p.held = s.snap.held; p.tms = (ch.tms || []).slice(); p.shiny = !!ch.shiny; p.belly = 100; p.selForm = ch.form || undefined;
    // 기다리는 동안 모은 가방은 창고로 (구조된 가방을 돌려받기 위해)
    if (save.bag.length) { save.bag.forEach(b => storeAdd(b.id, b.n)); UI.toast('지금 가방의 아이템은 창고에 넣었습니다.'); save.bag = []; }
    save.current = s.sp;
    // 동료도 다시 함께 (구조되어 모두 기운을 되찾았다)
    const run = { dungeon: s.dungeon, floor: s.floor, mode: 'normal', p, bag: s.snap.bag, money: s.snap.money, done: s.snap.done || [], party: partyList().map(makePartner), stats: s.snap.stats || null };
    save.sos = null; persist();
    UI.closeAll();
    show('dungeon-screen');
    Dungeon.enter(run);
  }

  // 영입한 포켓몬 중 sp가 진화한 모습 (여럿이면 레벨이 가장 높은 것)
  function evolvedInRoster(sp) {
    const out = [], todo = [...DATA.species[sp].v.map(v => v[0])];
    while (todo.length) { const x = todo.shift(); if (!DATA.species[x] || out.includes(x)) continue; out.push(x); todo.push(...DATA.species[x].v.map(v => v[0])); }
    return out.filter(x => save.roster[x]).sort((a, b) => save.roster[b].lv - save.roster[a].lv)[0] || null;
  }
  // 구조를 포기: 그때 쓰러진 것으로 처리
  async function giveUpSOS() {
    const s = save.sos; if (!s) return;
    if (!(await UI.confirm('구조 포기', '<p>구조를 포기하면 쓰러졌을 때의 패널티(가방 아이템 절반, 지닌 물건 50%, 주웠던 돈)를 받습니다. 남은 아이템은 창고로 갑니다.</p>', '포기한다', '계속 기다린다'))) return;
    UI.alert('구조를 포기했다', endSOS(s));
  }
  // 구조 요청을 끝낸다 (포기·구조 실패): 쓰러졌을 때의 패널티, 게시판에서 내림. 결과 문구를 돌려준다
  function endSOS(s) {
    const bag = s.snap.bag.slice(), lost = [];
    const loseN = Math.floor(bag.length / 2) + (bag.length % 2 && Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < loseN; i++) lost.push(bag.splice(rand(bag.length), 1)[0]);
    bag.forEach(b => storeAdd(b.id, b.n));
    if (s.snap.held) { if (Math.random() < 0.5) lost.push({ id: s.snap.held, n: 1 }); else storeAdd(s.snap.held); }
    save.money = Math.max(0, save.money - (s.snap.money || 0));
    if (s.online) Online.deleteSOS(s.docId || s.id).catch(() => {});
    save.sos = null; persist(); renderTown();
    return `<p>${lost.length ? `잃어버린 아이템: ${lost.map(b => ITEMS[b.id].icon + esc(ITEMS[b.id].n)).join(', ')}` : '잃어버린 아이템은 없다.'}</p>
      ${s.snap.money ? `<p>주웠던 돈 ₽${jo(s.snap.money, '을')} 잃었다.</p>` : ''}<p class="dim">남은 아이템은 창고로 옮겼습니다.</p>`;
  }
  // 구조 요청을 올린 시각 (예전 세이브: 게시판 문서 이름의 시각, 그것도 없으면 지금부터 센다)
  function sosCreated(s) {
    if (!s.created) { s.created = (s.docId && +String(s.docId).split('_')[0]) || Date.now(); persist(); }
    return s.created;
  }
  const sosLeft = s => sosCreated(s) + SOS_EXPIRE_MS - Date.now();
  // 48시간 동안 구조받지 못함 → 구조 실패 (게시판으로 구조됐는지는 먼저 확인한 뒤에 부른다)
  let sosFailing = false;
  function failSOS(s) {
    if (sosFailing || !s || s.revived || save.sos !== s) return;
    sosFailing = true;
    const html = endSOS(s);
    UI.alert('🆘 구조 실패', `<div class="center">${portraitImg(s.sp, 'portrait big', 'Pain', s.shiny)}</div>
      <p class="center">${esc(dungeonById(s.dungeon)?.n || '')} ${s.floor}F에서 쓰러진 ${esc(jo(spName(s.sp), '은'))} 48시간 동안 구조받지 못했다...</p>${html}`).then(() => { sosFailing = false; });
  }
  // 게시판 확인이 안 되는 요청 (코드로만 부탁했거나 로그인하지 않음)은 시간만 보고 끝낸다
  function checkSOSExpiry() {
    const s = save && save.sos;
    if (s && !s.revived && sosLeft(s) <= 0 && !(s.online && Online.loggedIn())) failSOS(s);
    // 게시판 요청은 서버에서 아무도 구조하지 않은 것을 확인한 뒤(checkOnline)에. 서버가 막혔으면 기다리지 않는다
    else if (s && !s.revived && (!(s.online && Online.loggedIn()) || Online.serverDown())) autoRescue(s);
  }

  // 구조 요청을 올린 뒤 SOS_AUTO_MS(30분) 동안 아무도 구조하지 않으면 구린내 탐험대가 대신 구조한다 (v0.92: 사람이 적은 시간에도 이어서 할 수 있게)
  //  다른 탐험대가 구조하러 가 있는 동안은 기다린다. 게시판 요청은 내린다. 감사 선물은 없다
  const sosAutoLeft = s => sosCreated(s) + SOS_AUTO_MS - Date.now();
  let sosAutoBusy = false;
  async function autoRescue(s) {
    if (sosAutoBusy || !s || s.revived || save.sos !== s || sosAutoLeft(s) > 0) return;
    if (s.takenAt && s.takenAt > Date.now() - SOS_HOLD_MS) return;
    if (!inTown() || UI.isOpen() || Story.busy()) return;   // 마을에서 창이 없을 때 (1분마다 다시 본다)
    sosAutoBusy = true;
    s.revived = { sp: SOS_AUTO_TEAM[0], lv: clamp(s.lv + 5, 20, MAX_LEVEL), sh: 0, from: SOS_AUTO_NAME, auto: true };
    s.thx = 'auto';   // 감사 편지 없이 바로 이어서 탐험
    if (s.online) { s.online = false; if (Online.loggedIn()) Online.deleteSOS(s.docId || s.id).catch(() => {}); }
    persist(); renderTown();
    const [SKUNK, ZUBAT] = SOS_AUTO_TEAM, who = spName(s.sp), dg = dungeonById(s.dungeon);
    await Story.play([
      [null, null, `${dg ? dg.n + ' ' : ''}${s.floor}F… 쓰러진 ${jo(who, '은')} 오지 않는 구조대를 하염없이 기다리고 있었다.`],
      [ZUBAT, 'Surprised', '형님! 여기 누가 쓰러져 있는뎁쇼!'],
      [SKUNK, 'Normal', `…뭐야, 길드의 그 ${who} 아니냐. 꼴 좋구나, 크크크.`],
      [ZUBAT, 'Worried', '어떡할까요, 형님? 그냥 두고 갈깝쇼?'],
      [SKUNK, 'Normal', '…여기서 뻗어 있으면 우리 앞길이 막히잖아. 주뱃, 업어라.'],
      [ZUBAT, 'Happy', '넵, 형님! 역시 형님은 마음이 넓으셔요!'],
      [SKUNK, 'Angry', '착각하지 마라! 빚을 하나 지워 두는 것뿐이다. 나중에 두 배로 갚아라!'],
      [null, null, `${SOS_AUTO_NAME} 덕분에 ${jo(who, '이')} 기운을 되찾았다!`],
    ], { bgm: 'teamskull' });
    sosAutoBusy = false;
    if (save.sos !== s) return;
    UI.open({
      title: '구조되었다!',
      html: `<div class="center">${portraitImg(SKUNK, 'portrait big', 'Happy')} ${portraitImg(ZUBAT, 'portrait big', 'Happy')} ${portraitImg(s.sp, 'portrait big', 'Joyous', s.shiny)}</div>
        <p class="center"><b>${SOS_AUTO_NAME}</b>가 ${esc(jo(spName(s.sp), '을'))} 구조해 주었다!</p>
        <p class="center dim">30분 동안 구조하러 온 탐험대가 없어서 대신 와 주었어요. 가방도 그대로 돌려받습니다.</p>`,
      choices: [{ label: '쓰러진 층부터 이어서 탐험한다', fn: resumeSOS, def: true }, { label: '나중에 (임무 탭에서 이어서 탐험)', fn: () => {} }],
    });
  }
  // 마을에 있는 동안 1분마다: 게시판 요청은 서버 확인(checkOnline이 1분 30초 간격을 지킨다), 아니면 시간만 본다
  setInterval(() => {
    const s = save && save.sos;
    if (!s || s.revived || idle || !inTown() || sosAutoLeft(s) > 0) return;
    if (s.online && Online.loggedIn() && !Online.serverDown()) checkOnline(); else checkSOSExpiry();
  }, 60 * 1000);

  // 구조해 준 친구에게서 온 감사 코드
  function receiveTHX(d) {
    const r = (save.rescued || {})[d.id];
    if (!r) { UI.alert('코드 오류', '<p>내가 구조한 친구에게서 온 감사 코드가 아닙니다.</p>'); return; }
    if (r.thanked) { UI.alert('이미 받음', '<p>이미 받은 감사 코드입니다.</p>'); return; }
    const ci = document.getElementById('code-input'); if (ci) ci.value = '';
    return gotThanks(r, Codes.numToItem(d.item));
  }
  function gotThanks(r, item, from) {
    r.thanked = true;
    // 설정에서 '감사 선물 받지 않기'를 켰으면 창고에 넣지 않고 판매 값만큼 돈으로
    const cash = item && save.settings.noGift ? Math.max(1, Math.floor(sellOf(item))) : 0;
    if (cash) save.money += cash; else if (item) storeAdd(item);
    persist(); renderTown();
    return UI.alert('💌 감사 편지', `<div class="center">${portraitImg(r.sp, 'portrait big', 'Joyous', r.shiny)}</div>
      <p class="center">구조해 준 ${esc(spName(r.sp))}의 ${from ? `탐험대 <b>${esc(from)}</b> 님` : '친구'}에게서 감사 편지가 왔다!</p>
      ${cash ? `<p class="center">선물로 온 ${ITEMS[item].icon} <b>${esc(jo(ITEMS[item].n, '은'))}</b> 받지 않고 ₽${cash}로 바꿨다. <span class="dim">(설정: 감사 선물 받지 않기)</span></p>`
        : item ? `<p class="center">선물로 ${ITEMS[item].icon} <b>${esc(jo(ITEMS[item].n, '을'))}</b> 받았다! (창고로)</p>` : ''}`);
  }

  // ── 친구 구조는 구조한 그 자리에서 바로 완료 (v0.85): 보상·횟수를 확정하고, 게시판 구조는 서버에 바로 알린다 (뒤에 쓰러져도 그대로) ──
  function rescueNow(mid) {
    const r = Dungeon.run, m = save.missions.accepted.find(x => x.id === mid);
    if (!r || !m || m.kind !== 'sos') return null;
    const p = r.p, lines = [];
    let code = null;
    save.rescued = save.rescued || {};
    if (m.online) save.rescued[m.sosId] = { sp: m.client, shiny: m.shiny, thanked: false, online: true, claimed: false, docId: m.docId, dungeon: m.dungeon, floor: m.floor, me: { sp: p.sp, lv: p.lv, shiny: !!p.shiny } };
    else {
      code = Codes.encode('aok', { id: m.sosId, sp: p.sp, lv: p.lv, sh: p.shiny ? 1 : 0 });
      save.rescued[m.sosId] = { sp: m.client, shiny: m.shiny, thanked: false };
      save.aokSent = [...(save.aokSent || []), { id: m.sosId, sp: m.client, code }].slice(-10);
    }
    Progress.add('rescues'); noteFirst('rescue', { dungeon: m.dungeon, floor: m.floor }); milestoneGift('rescues', lines);
    Progress.add('missions');
    save.money += m.reward;
    if (m.item) storeAdd(m.item);
    lines.push(`임무 완료 보상: ${rewardText(m)}${m.item ? ' (창고로)' : ''}`);
    addRankPts(m, lines);
    save.missions.accepted = save.missions.accepted.filter(x => x.id !== mid);
    persist();
    return { m, lines, code };
  }
  function rescueDialog(res) {
    if (!res) return;
    const { m, lines, code } = res;
    // 다른 임무처럼 탐험을 계속할지 마을로 돌아갈지 고른다 (계속하기가 기본, 이 던전에 남은 임무도 보여 준다)
    const r = Dungeon.run, KIND = { rescue: '구조', outlaw: '수배', find: '탐색', sos: '친구 구조' };
    const left = r ? save.missions.accepted.filter(x => x.dungeon === r.dungeon && !r.done.includes(x.id)).sort((a, b) => a.floor - b.floor) : [];
    const leftHtml = left.length ? `<p>이 던전에 남은 임무: ${left.map(x => `<b>${x.floor}F</b> ${KIND[x.kind] || ''}`).join(' · ')}</p>` : '<p class="dim">이 던전에 남은 임무는 없습니다.</p>';
    const back = [{ label: '마을로 돌아간다', fn: () => endRun('escape') }];
    const head = `<div class="center">${portraitImg(m.client, 'portrait big', 'Joyous', !!m.shiny)}</div>
      <p class="center"><b>${esc(spName(m.client))}</b> 구조 완료!</p><ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul>`;
    if (code) { codeBox('✅ A-OK 코드', head + '<p>이 코드를 친구에게 보내면 친구가 되살아납니다.</p>' + leftHtml, code, '탐험을 계속한다', null, back); return; }
    // 게시판 구조: 창 하나에서 서버에 전하고, 결과(구조 보답)를 같은 창에 덧붙인다
    Sound.fanfare('reward', 'mission');   // 구조 완료 = 임무 완료 팡파르
    UI.open({ title: '✅ 구조 완료', html: head + `<p class="center rescue-claim">📡 구조 완료를 요청자에게 전하는 중…</p>
      ${leftHtml}<p class="dim">이 뒤에 쓰러져도 구조는 그대로입니다.</p>`, choices: [{ label: '탐험을 계속한다', fn: () => {}, def: true }, ...back], cancel: () => {} });
    const sid = m.sosId, rec = save.rescued && save.rescued[sid];
    const show = h => { const el = document.querySelector('.rescue-claim'); if (el) el.innerHTML = h; };
    if (!rec || !bound || !Online.loggedIn()) { show('📡 지금은 서버에 연결되어 있지 않아요. 마을에서 다시 전할게요.'); return; }
    claimRescueOne(sid, rec).then(c => show(c.ok ? `요청자에게 전했어요! ${c.html}`
      : c.lost ? '다른 탐험대가 먼저 구조했거나 요청이 취소됐어요.'
      : c.denied ? `전하지 못했어요: ${esc(c.msg)}` : '📡 지금은 전하지 못했어요. 마을에서 다시 전할게요.'));
  }

  function finishRun(r, outcome) {
    const dg = dungeonById(r.dungeon);
    const firstClear = !(save.cleared && save.cleared[dg.id]);   // 엔딩: 이번이 처음 완주인지 (아래에서 클리어 기록을 남기기 전에)
    const p = r.p;
    const success = outcome === 'clear' || outcome === 'escape';
    const lines = [], aoks = [];
    const reached = outcome === 'clear' ? dg.floors : r.floor;
    if (!success) Progress.add('faints');
    if (outcome === 'faint') noteFirst('faint', { dungeon: dg.id, floor: r.floor });   // 엔딩: 처음 쓰러진 곳
    if (!dg.daily) save.best[dg.id] = Math.max(save.best[dg.id] || 0, reached);
    if (outcome === 'clear' && r.hard) {   // 하드모드 클리어: 캐릭터(원래 포켓몬)마다 따로 기록
      const k = p.rsp || p.sp; save.hardClears = save.hardClears || {}; save.hardClears[k] = save.hardClears[k] || {};
      const was = save.hardClears[k][dg.id]; save.hardClears[k][dg.id] = true;
      if (!was) lines.push(`☠ ${esc(jo(spName(k), '으로'))} ${esc(jo(dg.n, '을'))} 하드모드로 처음 클리어했다!`);
    } else if (outcome === 'clear' && !dg.daily) {
      const was = clearsOf(p.sp)[dg.id];
      const got = recordClear(p.sp, dg);
      if (dg.mode === 'rogue') save.cleared[dg.id] = true;
      if (!was) lines.push(`✔ ${esc(jo(spName(p.sp), '으로'))} ${esc(jo(dg.n, '을'))} 처음 클리어했다!`);
      for (const m of got) lines.push(`${m.icon} <b>메달 획득: ${esc(m.n)}</b> — ${esc(jo(spName(p.sp), '으로'))} ${esc(m.d.replace('모두 클리어', '모두 클리어했다!'))}`);
    }
    saveParty(r);
    if (r.hard) {
      saveHardMember(p, true);
      if (success) {
        // 주운 것만 가져온다: 가방에서 기본 아이템 개수만큼 뺀다 (마을 가방은 그대로)
        const left = {}; for (const b of r.kit || []) left[b.id] = (left[b.id] || 0) + b.n;
        const got = [];
        for (const b of r.bag) { const take = Math.min(b.n, left[b.id] || 0); if (take) left[b.id] -= take; if (b.n - take > 0) got.push({ id: b.id, n: b.n - take }); }
        got.forEach(b => storeDeposit(b.id, b.n));
        lines.push(got.length ? `주운 아이템 ${got.length}종을 창고에 넣었다.` : '주운 아이템은 없다.');
        if (r.money) lines.push(`주운 돈 ₽${r.money}`);
        if (outcome === 'clear') { save.hardCleared = save.hardCleared || {}; save.hardCleared[dg.id] = true; }   // 클리어 보상은 테스트 중이라 아직 없음
      } else {
        save.money = Math.max(0, save.money - r.money);
        lines.push('쓰러져서 주운 아이템과 돈을 모두 잃었다...');
      }
    } else if (dg.mode === 'normal') {
      if (!r.hard && (save.roster[p.sp] || p.sp === save.current)) save.roster[p.sp] = { ...save.roster[p.sp], lv: p.lv, exp: p.exp, moves: ownMoves(p).map(m => m.id), held: p.held || null, ...(p.tms ? { tms: p.tms } : {}), ...(p.boost ? { boost: p.boost } : {}) };
      if (success) {
        save.bag = r.bag;
        if (outcome === 'clear') {
          const bonus = dg.floors * (5 + dg.lv[1]);
          save.money += bonus;
          lines.push(`던전 클리어 보너스 ₽${bonus}`);
          if (!save.cleared[dg.id]) {
            save.cleared[dg.id] = true;
            for (const next of DUNGEONS.filter(d => d.req === dg.id)) lines.push(`새 던전 <b>${esc(jo(next.n, '이'))}</b> 열렸다!`);
          }
        }
        for (const m of save.missions.accepted.filter(m => r.done.includes(m.id))) {
          if (m.kind === 'sos' && m.online) {
            save.rescued = save.rescued || {};
            save.rescued[m.sosId] = { sp: m.client, shiny: m.shiny, thanked: false, online: true, claimed: false, docId: m.docId, dungeon: m.dungeon, floor: m.floor, me: { sp: p.sp, lv: p.lv, shiny: !!p.shiny } };
            Progress.add('rescues'); noteFirst('rescue', { dungeon: m.dungeon, floor: m.floor }); milestoneGift('rescues', lines);
          } else if (m.kind === 'sos') {
            const code = Codes.encode('aok', { id: m.sosId, sp: p.sp, lv: p.lv, sh: p.shiny ? 1 : 0 });
            save.rescued = save.rescued || {}; save.rescued[m.sosId] = { sp: m.client, shiny: m.shiny, thanked: false };
            save.aokSent = [...(save.aokSent || []), { id: m.sosId, sp: m.client, code }].slice(-10);
            aoks.push({ m, code });
            Progress.add('rescues'); noteFirst('rescue', { dungeon: m.dungeon, floor: m.floor }); milestoneGift('rescues', lines);
          }
          Progress.add('missions');
          if (m.kind !== 'sos') milestoneGift('missions', lines);
          save.money += m.reward;
          if (m.item) storeAdd(m.item);
          lines.push(`임무 완료 보상: ${rewardText(m)}${m.item ? ' (창고로)' : ''}`);
          addRankPts(m, lines);
        }
        save.missions.accepted = save.missions.accepted.filter(m => !r.done.includes(m.id));
      } else {
        const bag = r.bag.slice();
        const half = abilityOf(p).stickyHold ? bag.length / 4 : bag.length / 2;
        const loseN = Math.floor(half) + (Math.random() < half % 1 ? 1 : 0);
        if (abilityOf(p).stickyHold) lines.push(`[${abilityName(p.ability)}] 아이템을 꽉 붙잡고 있었다!`);
        const lost = [];
        for (let i = 0; i < loseN; i++) lost.push(bag.splice(rand(bag.length), 1)[0]);
        save.bag = bag;
        if (p.held && Math.random() < (abilityOf(p).stickyHold ? 0.25 : 0.5)) { lost.push({ id: p.held, n: 1 }); if (save.roster[p.rsp || p.sp]) save.roster[p.rsp || p.sp].held = null; }
        save.money = Math.max(0, save.money - r.money);
        if (lost.length) lines.push(`가방의 아이템 ${lost.length}개를 잃어버렸다: ${lost.map(b => ITEMS[b.id].icon + esc(ITEMS[b.id].n) + (b.n > 1 ? '×' + b.n : '')).join(', ')}`);
        else lines.push('가방의 아이템은 무사했다.');
        if (r.money) lines.push(`주웠던 돈 ₽${jo(r.money, '을')} 잃어버렸다...`);
        lines.push(`레벨은 유지된다. (Lv${p.lv})`);
      }
    } else {
      if (success) {
        const items = r.bag.filter(b => ITEMS[b.id]).concat(p.held ? [{ id: p.held, n: 1 }] : []);
        // 들고 들어간 지닌 물건은 캐릭터가 계속 지니고 있으므로 하나 빼고 가져온다 (복사되지 않게)
        if (r.carried) { const k = items.findIndex(b => b.id === r.carried); if (k >= 0) { if (items[k].n > 1) items[k] = { ...items[k], n: items[k].n - 1 }; else items.splice(k, 1); } }
        items.forEach(b => storeDeposit(b.id, b.n));
        if (items.length) lines.push(`가져온 아이템 ${items.length}종을 창고에 넣었다.`);
        if (r.money) lines.push(`주운 돈 ₽${r.money}`);
        if (outcome === 'clear') { const bonus = dg.floors * 60; save.money += bonus; lines.push(`완주 보너스 ₽${bonus}`); }
      } else {
        save.money = Math.max(0, save.money - r.money);
        lines.push('쓰러져서 아무것도 가져오지 못했다...');
      }
      if (dg.daily) {
        const { rec, reward } = Progress.recordDaily(r, outcome, reached);
        lines.push(`오늘의 도전 기록: <b>${rec.floor}F</b>${rec.clear ? ' 완주!' : ''} · ${rec.turns}턴 · ${rec.kills}마리 쓰러뜨림`);
        lines.push(`도전 보상 ₽${reward}`);
        lines.push('기록은 던전 탭에서 친구에게 공유할 수 있습니다.');
      } else lines.push(`레벨과 가방이 원래대로 돌아왔다. (최고 기록 ${save.best[dg.id]}F)`);
    }
    save.run = null;
    save.day++;
    refreshDay();
    const got = Progress.check();
    if (got.length) lines.push(...got.map(a => `🏆 업적 달성: <b>${esc(a.n)}</b>`));
    persist();
    flushUpload(RETURN_GAP);   // 던전을 마치면 클라우드에 올린다 (지난 저장 뒤 10분이 안 됐으면 10분이 될 때)
    Sound.town();
    show('town-screen');
    tab = 'dungeon';
    renderTown();
    const title = { clear: '던전 클리어!', escape: '무사히 돌아왔다', faint: '눈앞이 캄캄해졌다...', wind: '바람에 날려 쫓겨났다...', quit: '탐험을 포기했다' }[outcome] || '귀환';
    const face = { clear: 'Joyous', escape: 'Happy', faint: 'Crying', wind: 'Sad' }[outcome] || 'Normal';
    const res = UI.alert(title, `<div class="center">${portraitImg(p.sp, 'portrait big', face, save.roster[p.sp]?.shiny)}</div><p>${esc(dg.n)} ${reached}F${outcome === 'clear' ? ' 완주' : ''}</p><ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul>${runStatsHtml(r)}`);
    if (Object.values(save.rescued || {}).some(x => x.online && !x.claimed && !x.thanked)) res.then(() => checkOnline(true));
    // 이야기·승급식: 던전에서 돌아온 뒤 (결과·엔딩 창이 모두 닫히면 차례로)
    setTimeout(() => Story.check(), 600); setTimeout(checkRankUp, 900); setTimeout(checkMegaGift, 1200);
    // 엔딩: 에리어 제로 최심부를 처음 완주하면 결과 창 뒤에
    if (outcome === 'clear' && dg.id === ENDING_DUNGEON && !r.hard && firstClear && !save.endingSeen) { save.endingSeen = save.day; save.endingAt = { day: save.day, sec: Math.round(save.playSec || 0) }; save.endingRec = endingRecord(); voteEnding(); persist(); res.then(() => setTimeout(() => showEnding(true), 0)); }
    // 친구 구조 완료 → A-OK 코드 보여주기
    aoks.reduce((pr, a) => pr.then(() => new Promise(done => codeBox('✅ A-OK 코드', `<p>친구의 <b>${esc(jo(spName(a.m.client), '을'))}</b> 구조했다! 이 코드를 친구에게 보내면 친구가 되살아납니다.</p>`, a.code, '확인', done))), res);
  }

  // 탐험대 기록: 포켓몬마다 준 데미지·받은 데미지 막대 그래프 (쓰러뜨린 수·회복량)
  function runStatsHtml(r) {
    const st = Object.entries(r.stats || {}).map(([sp, v]) => ({ sp: +sp, ...v })).filter(v => v.dealt || v.taken || v.kills);
    if (!st.length) return '';
    st.sort((a, b) => b.leader - a.leader || b.dealt - a.dealt);
    const max = Math.max(1, ...st.map(v => Math.max(v.dealt, v.taken)));
    const total = st.reduce((s, v) => s + v.dealt, 0) || 1;
    const bar = (n, cls) => `<span class="rs-bar"><i class="${cls}" style="width:${(n / max * 100).toFixed(1)}%"></i></span><b>${n.toLocaleString()}</b>`;
    return `<h3>📊 탐험대 기록</h3><div class="rs">${st.map(v => `<div class="rs-row">
      ${portraitImg(v.sp, 'portrait sm', 'Normal', save.roster[v.sp]?.shiny)}
      <div class="rs-main"><div class="rs-name">${v.leader ? '👑 ' : ''}${esc(spName(v.sp))} <span class="dim">· 쓰러뜨림 ${v.kills} · 딜 비중 ${Math.round(v.dealt / total * 100)}%${v.heal ? ` · 회복 ${v.heal.toLocaleString()}` : ''}</span></div>
        <div class="rs-line"><span class="rs-k">준 피해</span>${bar(v.dealt, 'dealt')}</div>
        <div class="rs-line"><span class="rs-k">받은 피해</span>${bar(v.taken, 'taken')}</div></div></div>`).join('')}</div>`;
  }

  // 던전 안에서 받은 임무 보기
  function showMissions() {
    const r = Dungeon.run; if (!r || UI.isOpen()) return;
    Dungeon.stopAuto();
    const dg = dungeonById(r.dungeon), acc = save.missions.accepted;
    const mine = acc.filter(m => m.dungeon === dg.id).sort((a, b) => a.floor - b.floor), other = sortMissions(acc.filter(m => m.dungeon !== dg.id));
    const state = m => r.done.includes(m.id) ? '<span class="tag ok">✅ 완료 · 마을로 돌아가면 보상</span>'
      : m.floor === r.floor ? '<span class="tag here">📍 이 층</span>'
      : m.floor > r.floor ? `<span class="tag">${m.floor}F · ${m.floor - r.floor}층 아래</span>` : `<span class="tag dim">${m.floor}F · 이미 지나침</span>`;
    const row = (m, st) => `<div class="row">${portraitImg(m.kind === 'outlaw' ? m.target : m.client, 'portrait sm', m.kind === 'sos' ? 'Pain' : 'Normal', !!m.shiny)}
      <div class="grow">${missionText(m)}<div class="dim">보상 ${rewardText(m)}</div>${st ? `<div>${st}</div>` : ''}</div></div>`;
    let html;
    if (r.mode !== 'normal') html = '<p>로그라이크 던전에서는 임무를 진행할 수 없습니다.</p>' + (acc.length ? `<p class="dim">받아 둔 임무 ${acc.length}개는 일반 던전에서 진행하세요.</p>` : '');
    else {
      html = `<h3>${esc(dg.n)}의 임무 <span class="dim">(지금 ${r.floor}F)</span></h3>
        ${mine.length ? mine.map(m => row(m, state(m))).join('') : '<p class="dim">이 던전에서 받은 임무가 없습니다.</p>'}
        ${other.length ? `<h3>다른 던전의 임무</h3>${other.map(m => row(m)).join('')}` : ''}
        ${r.done.length ? '<p class="dim">완료한 임무의 보상은 계단으로 나가거나 탈출하면 받습니다. 쓰러지면 받을 수 없어요.</p>' : ''}`;
    }
    UI.open({ title: '📜 임무 확인', wide: true, html, choices: [{ label: '닫기', fn: () => {} }] });
  }

  // 던전 메뉴: 탭 (메뉴 / 던전 정보 / 설정 / 조작·가이드)
  function dungeonMenu(tabKey) {
    if (UI.isOpen() && !tabKey) return;
    Dungeon.stopAuto();
    const s = save.settings, t = tabKey || 'menu', D = Dungeon.floor, run = Dungeon.run;
    const tabs = [['menu', '🧭 메뉴'], ['info', '🗺 던전 정보'], ['set', '⚙ 설정'], ['help', '📖 조작·가이드']];
    const head = `<div class="dex-tabs dm-tabs">${tabs.map(([k, n]) => `<button class="${t === k ? 'on' : ''}" data-dmtab="${k}">${n}</button>`).join('')}</div>`;
    const close = [{ label: '닫기', fn: () => {} }];
    const onOpen = (box, m) => {
      box.querySelectorAll('[data-dmtab]').forEach(b => b.onclick = () => { if (b.dataset.dmtab !== t) { UI.close(m); dungeonMenu(b.dataset.dmtab); } });
      box.addEventListener('change', e => {
        if (e.target.dataset.set) setSetting(e.target.dataset.set, e.target.checked);
        if (e.target.dataset.setsel) setSetting(e.target.dataset.setsel, e.target.value);
        if (e.target.dataset.setnum) { setSetting(e.target.dataset.setnum, +e.target.value); Sound.play('menu'); }
      });
      box.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
        const a = b.dataset.act;
        if (a === 'key-settings') keySettings(); else if (a === 'help') Dungeon.showHelp(); else if (a === 'guide') Guide.open(b.dataset.arg);
      });
    };
    if (t === 'info' && D && D.dg) {
      const dg = D.dg, w = D.weather;
      const here = `<p><b>지금 ${run.floor}층</b> / ${dg.floors}층 · 날씨 ${w ? `${WEATHERS[w].icon} ${WEATHERS[w].n}` : '없음'} · 이 층에서 ${run.turnsOnFloor || 0} / ${WIND.limit}턴</p>`;
      UI.open({ title: esc(dg.n), wide: true, html: head + here + dungeonInfoHtml(dg), choices: close, onOpen });
      return;
    }
    if (t === 'set') { openSettings(null, () => dungeonMenu()); return; }
    if (t === 'help') {
      UI.open({ title: '조작·가이드', wide: true, html: head + `<div class="btns"><button class="btn ghost" data-act="key-settings">🎮 키 설정</button></div>
        <h3>📖 게임 가이드 · 조작법</h3><div class="btns">${Guide.buttons()}</div>`, choices: close, onOpen });
      return;
    }
    UI.open({
      title: '메뉴', html: head, onOpen,
      choices: [
        { label: '돌아가기', fn: () => {} },
        { label: '가방', fn: () => Dungeon.floor && document.querySelector('#actions [data-k=bag]').click() },
        { label: '📜 임무 확인 (J)', fn: () => setTimeout(showMissions, 0) },
        { label: '💬 메시지 기록 (U)', fn: () => setTimeout(Dungeon.showLog, 0) },
        { label: '📊 탐험대 상태 (P)', fn: () => setTimeout(Dungeon.showStatus, 0) },
        ...((Dungeon.run?.party || []).length ? [{ label: '🤝 동료 (V) — 상태·작전', fn: () => setTimeout(Dungeon.partyMenu, 0) }] : []),
        { label: '🗺 던전 정보', fn: () => setTimeout(() => dungeonMenu('info'), 0) },
        { label: '⚙ 설정 (음량·키 설정 등)', fn: () => setTimeout(() => dungeonMenu('set'), 0) },
        { label: '📖 조작법·게임 가이드', fn: () => setTimeout(() => dungeonMenu('help'), 0) },
        ...(ENV === 'dev' ? [{ label: '🛠 최종 보스 층으로 (개발용)', fn: () => setTimeout(() => Dungeon.devJump('boss'), 0) },
          { label: '🛠 중간 보스 층으로 (개발용)', fn: () => setTimeout(() => Dungeon.devJump('mid'), 0) }] : []),
        { label: '포기하고 돌아간다', fn: async () => {
          const ok = await UI.confirm('포기', '<p>탐험을 포기합니다. 쓰러진 것과 같이 처리됩니다.</p>', '포기한다', '계속한다');
          if (ok) endRun('quit');
        } },
      ],
    });
  }

  function setSetting(k, v) { save.settings[k] = v; persist(); Sound.refresh(); applyPad(); if (k === 'origTiles' || k === 'useTileset') Dungeon.rebuildMap(); }   // 던전 그림을 바꾸면 지금 층도 바로 다시 그린다
  // 휴대폰 조작: 터치가 되는 기기면 방향 버튼을 보인다. 펜·마우스가 함께 있는 기기는 브라우저가 터치 기기로 알려주지 않기도 해서 넓게 본다
  // (설정에서 '방향 버튼 항상 표시'를 켜면 어떤 기기에서든 보인다)
  const touchDevice = () => (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window || matchMedia('(any-pointer: coarse)').matches;
  // 터치 조작 켜기: auto(터치 기기면) / on(항상) / off(끄기). v0.83 전의 '항상 표시'(dpad) 설정은 on으로 본다
  const touchCtl = () => save?.settings?.touchCtl || (save?.settings?.dpad ? 'on' : 'auto');
  // 화면을 돌리거나 크기가 바뀌면 다시 (휴대폰 가로 화면 배치)
  for (const ev of ['resize', 'orientationchange']) window.addEventListener(ev, () => { if (save) applyPad(); });
  function applyPad() {
    const tc = touchCtl();
    document.body.classList.toggle('touch', tc === 'on' || (tc === 'auto' && touchDevice()));
    document.body.classList.toggle('notouch', tc === 'off');
    document.body.classList.toggle('vpad', (save?.settings?.padMode || 'stick') === 'stick');   // 터치 조작: 조이스틱·ABXY (기본) / 방향 버튼
    // 휴대폰 가로 화면 (v0.92): 터치 조작이 켜져 있고 가로가 더 길며 높이가 낮으면, 게임 화면을 꽉 채우고 조작 버튼을 그 위에 겹친다
    const touchOn = document.body.classList.contains('touch');
    document.body.classList.toggle('phone-land', touchOn && innerWidth > innerHeight && innerHeight <= 520);
    if (typeof Dungeon !== 'undefined' && Dungeon.layoutVpad) Dungeon.layoutVpad();
  }

  // 도감용: 클리어 기록이 있는 포켓몬의 메달 (기록이 없으면 빈 값)
  const hasClears = sp => Object.keys(clearsOf(sp)).length > 0;
  const dexMedals = () => { const out = {}; for (const k of new Set([...Object.keys(save?.clears || {}), ...Object.keys(save?.roster || {})])) { const ic = medalIcons(+k); if (ic) out[k] = ic; } return out; };
  // 상점 기술머신 분류 (다음 진열부터)
  function setTmFocus(v) { save.tmFocus = v || null; persist(); UI.toast(v ? '다음 진열부터 그 분류의 기술머신만 나와요. (🔄 새로고침하거나 다음 날)' : '기술머신 분류를 고르지 않았어요.'); }
  function setMissionFocus(id) { save.missionFocus = id || null; persist(); UI.toast(id ? `${dungeonById(id).n}의 의뢰가 더 자주 붙어요. (다음 새 의뢰부터)` : '자주 뜨는 지역을 해제했어요.'); }
  return { persist, rescueNow, rescueDialog, poke: () => { lastInput = Date.now(); if (idle) wakeIdle(); }, missionAlert, logSale, setTmFocus, shinyOk, setMissionFocus, hasClears, medalSection, dexMedals, askUpdate, recruit, unlockShiny, showMissions, importSave, noteShiny, boot, endRun, saveRunSnapshot, dungeonMenu, setSetting, renderTown, get save() { return save; }, setTab(t) { tab = t; renderTown(); } };
})();

window.addEventListener('DOMContentLoaded', () => {
  // 음량 슬라이더: 움직이는 동안 숫자와 색(100% 넘으면 빨강)
  document.addEventListener('input', e => {
    const t = e.target; if (!t.classList || !t.classList.contains('vol')) return;
    const v = +t.value, n = t.nextElementSibling;
    t.classList.toggle('loud', v > 100);
    if (n && n.classList.contains('vol-num')) { n.textContent = v + '%'; n.classList.toggle('loud', v > 100); }
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-ability]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (Dex && b.closest('#tab-content') && b.dataset.dex) Dex.showAbility(+b.dataset.ability); else showAbilityInfo(+b.dataset.ability);
  }, true);
  // 어디서든 data-move 요소를 누르면 기술 설명
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-move]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    showMoveInfo(+b.dataset.move, b.dataset.pp != null ? +b.dataset.pp : undefined, b.dataset.max != null ? +b.dataset.max : undefined, b.dataset.sp ? +b.dataset.sp : undefined);
  }, true);
  document.getElementById('update-note').onclick = () => Game.askUpdate();
  document.getElementById('town-tabs').onclick = e => { const b = e.target.closest('button'); if (b) Game.setTab(b.dataset.tab); };
  document.getElementById('town-screen').addEventListener('change', async e => {
    if (e.target.dataset.set) { Game.setSetting(e.target.dataset.set, e.target.checked); if (e.target.dataset.set === 'useTileset') Game.renderTown(); }   // 타일셋: 켜면 불러오기 목록이 나온다
    if (e.target.dataset.setsel) Game.setSetting(e.target.dataset.setsel, e.target.value);
    if (e.target.dataset.setnum) { Game.setSetting(e.target.dataset.setnum, +e.target.value); Sound.play('menu'); }
    if (e.target.dataset.mfocus) { Game.setMissionFocus(e.target.value); }
    if (e.target.dataset.tmfocus) Game.setTmFocus(e.target.value);
    if (e.target.classList.contains('tm-only')) filterTMs();
    if (e.target.classList.contains('mission-sort')) { Game.save.missionSort = e.target.value || null; Game.renderTown(); }
    if (e.target.classList.contains('store-filter')) { Game.save.storageFilter = e.target.value; Game.renderTown(); }
    if (e.target.id === 'save-file' && e.target.files[0]) { Game.importSave(e.target.files[0]); e.target.value = ''; }
    if (e.target.dataset.music && e.target.files[0]) {
      const ok = await Sound.importMusic(e.target.dataset.music, e.target.files[0]);
      if (ok) { UI.toast('음악 파일을 불러왔습니다. 그 장소에 가면 재생됩니다.'); Game.renderTown(); }
      else UI.alert('불러오기 실패', '<p>음악 파일(ogg / mp3 / m4a / wav)이 아니거나 브라우저에 저장할 수 없습니다.</p>');
      e.target.value = '';
    }
    if (e.target.dataset.tileset && e.target.files[0]) {
      const r = await Tiles.importFiles(e.target.dataset.tileset, e.target.files);
      if (r.ok) { UI.toast(`타일셋을 불러왔습니다${r.vars ? ` (변형 ${r.vars}개 포함)` : ''}. 다음 층부터 적용됩니다.`); Game.renderTown(); }
      else UI.alert('타일셋 불러오기 실패', `<p>${esc(r.msg)}</p>`);
    }
  });
  // 기술머신 목록 검색 (다시 그리지 않고 숨기기만 해서 입력이 끊기지 않게)
  function filterTMs() {
    const q = (document.querySelector('.tm-q')?.value || '').trim().toLowerCase(), only = document.querySelector('.tm-only')?.checked;
    let n = 0;
    document.querySelectorAll('.tm-item').forEach(r => { const ok = (!q || r.dataset.s.includes(q)) && (!only || r.dataset.u === '1'); r.style.display = ok ? '' : 'none'; if (ok) n++; });
    const em = document.querySelector('.tm-empty'); if (em) em.style.display = n ? 'none' : '';
  }
  document.getElementById('town-screen').addEventListener('input', e => { if (e.target.classList.contains('tm-q')) filterTMs(); });
  window.addEventListener('keydown', e => { if (!Dungeon.floor && UI.isOpen()) UI.key(e); });
  Game.boot();
});
