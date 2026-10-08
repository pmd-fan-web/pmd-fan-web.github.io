// 온라인 기능: 계정(아이디/비밀번호), 클라우드 세이브, 구조 게시판
// Firebase 무료 요금제(Spark)만 쓴다. 한도를 넘으면 그날은 요청이 거절될 뿐 요금은 나가지 않는다.
// 서버가 막혀도 게임은 브라우저 세이브로 계속할 수 있어야 한다: 여기서 나는 오류는 전부 잡아서 알림만 한다.
'use strict';

const Online = (() => {
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const MAIL = '@pmdweb.invalid';   // 아이디를 Firebase 이메일 로그인에 쓰기 위한 가짜 주소 (메일은 보내지 않는다)
  let ready = null, auth = null, db = null, user = null, profile = null;
  const listeners = [];

  const enabled = () => typeof ONLINE_CONFIG !== 'undefined' && !!ONLINE_CONFIG;
  const appCheckOn = () => typeof APPCHECK_SITE_KEY === 'string' && !!APPCHECK_SITE_KEY;
  const loggedIn = () => !!user;

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src));
      document.head.appendChild(s);
    });
  }

  // SDK를 불러오고 로그인 상태를 확인한다. 실패하면 false (오프라인 등)
  function init() {
    if (!enabled()) return Promise.resolve(false);
    if (ready) return ready;
    ready = (async () => {
      const files = ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js'];
      if (appCheckOn()) files.push('firebase-app-check-compat.js');
      for (const f of files) await loadScript(SDK + f);
      const app = firebase.initializeApp(ONLINE_CONFIG);
      if (appCheckOn()) app.appCheck().activate(APPCHECK_SITE_KEY, true);   // reCAPTCHA v3, 토큰 자동 갱신
      auth = app.auth(); db = app.firestore();
      await new Promise(res => {
        let first = true;
        auth.onAuthStateChanged(async u => {
          user = u; profile = null;
          if (u) { try { await loadProfile(); } catch (e) { console.warn(e); } }
          if (first) { first = false; res(); } else listeners.forEach(f => f(u));
        });
      });
      return true;
    })().catch(e => { console.warn('온라인 기능을 불러오지 못했습니다', e); ready = null; return false; });
    return ready;
  }
  const onChange = f => listeners.push(f);

  let profileAt = 0;
  // 이 브라우저에서 이미 차지를 확인한 닉네임 (로그인할 때마다 다시 확인하지 않게)
  const NAME_OK_KEY = 'pmdweb_nameok';
  const nameOkHere = n => { try { return localStorage.getItem(NAME_OK_KEY) === user.uid + '|' + n; } catch (e) { return false; } };
  const setNameOk = n => { try { localStorage.setItem(NAME_OK_KEY, user.uid + '|' + n); } catch (e) { /* 무시 */ } };
  // 동시에 여러 곳에서 불러도 한 번만 읽는다 (로그인 직후 onAuthStateChanged와 signIn이 겹침)
  let profileP = null;
  function loadProfile() {
    if (!profileP) profileP = readProfile().finally(() => { profileP = null; });
    return profileP;
  }
  const freshProfile = () => profile && Date.now() - profileAt < 15000;
  async function readProfile() {
    const d = await db.collection('users').doc(user.uid).get();
    profile = d.exists ? d.data() : {};
    profileAt = Date.now();
    // 닉네임을 겹치지 않게 하기 전에 만든 계정: 로그인할 때 차지해 둔다 (이미 다른 사람이 쓰면 바꾸라고 안내)
    if (profile.name && nameOkHere(profile.name)) profile.nameOk = true;
    else if (profile.name) {
      try { await claimName(profile.name); profile.nameOk = true; setNameOk(profile.name); }
      catch (e) { if (e.taken) profile.nameTaken = true; }
    }
  }
  const name = () => (profile && profile.name) || (user ? user.email.replace(MAIL, '') : '');
  // 구조 게시판에 쓰는 닉네임은 names/에 내 것으로 있어야 서버가 받아 준다 (보안 규칙 ownsName).
  // 닉네임 없이 가입이 끝난 계정(아이디가 닉네임)·옛 계정: 쓰기 전에 한 번 차지해 둔다. 남이 쓰고 있으면 바꾸라고 안내
  async function ensureName() {
    if (profile && profile.nameOk) return;
    const n = name();
    try { await claimName(n); profile = { ...(profile || {}), nameOk: true }; setNameOk(n); }
    catch (e) { if (e.taken) { profile = { ...(profile || {}), nameTaken: true }; throw { code: 'name-taken', msg: '닉네임을 다른 사람이 쓰고 있어요. 계정 → 닉네임 바꾸기에서 새 닉네임을 정해 주세요.' }; } throw e; }
  }

  // ── 진단: 서버가 거절한 요청을 동작별로 세어 두었다가 DIAG_GAP마다 diag/{uid}에 남긴다 (원인 찾기용, 콘솔에서만 본다) ──
  // 어떤 기능이 몇 번 실패했는지만 남는다 (세이브 내용·닉네임 등은 없음). 실패가 있던 사람만 2시간에 한 번 + 끝날 때 한 번 (최대 4번)
  // 6시간만 모은다 (DIAG_UNTIL까지 세고, 그 뒤 1시간 안에 마지막으로 올림). 그 뒤로는 세지도 올리지도 않는다
  const DIAG_UNTIL = Date.parse('2026-10-03T23:00:00+09:00');
  const DIAG_KEY = 'pmdweb_diag', DIAG_GAP = 2 * 3600 * 1000, DIAG_CODES = /permission-denied|failed-precondition|invalid-argument|resource-exhausted|name-taken/;
  const today = () => new Date().toLocaleDateString('sv');
  function diagRead() {
    try { const d = JSON.parse(localStorage.getItem(DIAG_KEY)); if (d && d.day === today() && d.c) return d; } catch (e) { /* 무시 */ }
    return { day: today(), c: {}, at: 0 };
  }
  function noteFail(op, e) {
    const code = String((e && e.code) || '').replace(/^firestore\//, '');
    if (!DIAG_CODES.test(code) || Date.now() > DIAG_UNTIL) return;
    const d = diagRead(), k = op + ':' + code;
    if (Object.keys(d.c).length >= 30 && !d.c[k]) return;
    d.c[k] = (d.c[k] || 0) + 1;
    try { localStorage.setItem(DIAG_KEY, JSON.stringify(d)); } catch (x) { /* 무시 */ }
  }
  async function flushDiag() {
    if (!user) return;
    if (Date.now() > DIAG_UNTIL + 3600 * 1000) return;
    const d = diagRead(), last = Date.now() > DIAG_UNTIL;   // 끝난 뒤 마지막 한 번
    if (!Object.keys(d.c).length || (Date.now() - d.at < DIAG_GAP && !(last && !d.final))) return;
    if (last) d.final = true;
    d.at = Date.now();
    try { localStorage.setItem(DIAG_KEY, JSON.stringify(d)); } catch (x) { /* 무시 */ }
    await db.collection('diag').doc(user.uid).set({ day: d.day, ver: GAME_VERSION, c: d.c, at: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => {});
  }
  // 바깥에서 부르는 서버 기능: 실패하면 세어 둔다 (오류는 그대로 다시 던진다)
  // 서버가 한도 초과·연결 불가로 막혔는지: 그런 실패가 난 뒤 성공한 요청이 없으면 막힌 것으로 본다 (구조 요청 코드를 다시 보여 줄 때)
  let downAt = 0;
  const DOWN_CODES = /resource-exhausted|quota|unavailable|deadline-exceeded/;
  const serverDown = () => downAt > 0;
  const track = (op, fn) => async (...a) => {
    try { const r = await fn(...a); downAt = 0; return r; }
    catch (e) { noteFail(op, e); if (DOWN_CODES.test(String((e && e.code) || ''))) downAt = Date.now(); throw e; }
  };
  const userId = () => (user ? user.email.replace(MAIL, '') : '');

  // Firebase 오류 → 한국어 안내
  function why(e) {
    const c = (e && e.code) || '';
    if (/email-already-in-use/.test(c)) return '이미 있는 아이디입니다. 다른 아이디를 골라 주세요.';
    if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return '아이디나 비밀번호가 맞지 않습니다.';
    if (/weak-password/.test(c)) return '비밀번호는 6자 이상이어야 합니다.';
    if (/invalid-email/.test(c)) return '아이디에 쓸 수 없는 글자가 있습니다.';
    if (/too-many-requests/.test(c)) return '시도가 너무 많아 잠시 막혔습니다. 조금 뒤에 다시 해 주세요.';
    if (/network|unavailable/.test(c)) return '서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.';
    if (/deadline-exceeded/.test(c)) return '서버가 대답하지 않습니다. 오늘 서버 사용량 한도를 넘었을 수 있어요. (브라우저 세이브로는 계속 플레이할 수 있습니다)';
    if (/quota|resource-exhausted/.test(c)) return '오늘 서버 사용량 한도를 넘었습니다. 내일 다시 이용할 수 있어요. (브라우저 세이브로는 계속 플레이할 수 있습니다)';
    if (/permission-denied/.test(c)) return '권한이 없습니다. 다시 로그인해 보세요.';
    return '알 수 없는 오류가 났습니다. (' + (c || (e && e.message) || e) + ')';
  }

  const ID_RE = /^[a-z0-9_]{3,16}$/;
  // 닉네임 금칙어: 닉네임은 구조 게시판에서 다른 사람에게 보인다. 욕설·비하·성적인 말과 운영자 사칭을 막는다
  // 띄어쓰기·숫자·기호를 빼고 비교한다 (시 1 발, s.h.i.t 같은 우회)
  const BAD_WORDS = ['시발', '씨발', '씨바', '시바', '씨빨', '시빨', '싸발', '쌰발', 'ㅅㅂ', 'ㅆㅂ', 'ㅅㅃ', '병신', '븅신', '빙신', 'ㅂㅅ', '좆', '좃', 'ㅈㄴ', '존나', '졸라', '지랄', 'ㅈㄹ',
    '개새', '개색', '개세', '새끼', '색기', '섹스', '쎅스', '보지', '자지', '느금', '니미', '니애미', '애미', '애비', '에미', '엠창', '앰창', '창녀', '걸레', '썅', '쌍놈', '쌍년', '미친', '미췬', '닥쳐', '꺼져', '뒤져', '뒤질',
    '한남', '김치녀', '메갈', '일베', '운지', '노무', '틀딱', '급식충', '장애새', '정신병자', '엿먹',
    'fuck', 'fuk', 'shit', 'bitch', 'sex', 'porn', 'nigger', 'nigga', 'cunt', 'dick', 'pussy', 'asshole', 'penis', 'vagina',
    '운영자', '관리자', '개발자', '공식', 'admin', 'official', 'moderator', 'nintendo', '닌텐도', 'gamefreak', '게임프리크', '포켓몬코리아'];
  const squash = n => String(n || '').normalize('NFC').toLowerCase().replace(/[\s\p{N}_.\-]/gu, '');
  // 금칙어가 들어 있지만 괜찮은 말 (먼저 지우고 검사)
  const OK_WORDS = ['시바견', '시바이누', '보지마', '바보지', '자지러', '공식적'];
  const badName = n => { let s = squash(n); for (const w of OK_WORDS) s = s.split(w).join(''); return BAD_WORDS.some(w => s.includes(w)); };
  // 다른 사람의 닉네임을 보여줄 때 (예전에 만든 닉네임이나 조작된 값도 가린다)
  const cleanName = n => { n = String(n || '').slice(0, 16); return !n || badName(n) ? '익명의 탐험대' : n; };
  function checkName(n, max = 10) {
    n = String(n || '').trim();
    if (!n) return '닉네임을 입력해 주세요.';
    if (n.length > max) return `닉네임은 ${max}자까지입니다.`;
    if (!/^[\p{L}\p{N} _.\-]+$/u.test(n) || /^\.+$/.test(n) || /^__.*__$/.test(n)) return '닉네임에는 글자, 숫자, 띄어쓰기, _ . - 만 쓸 수 있습니다.';
    if (badName(n)) return '쓸 수 없는 말이 들어 있어요. 다른 닉네임을 골라 주세요.';
    return null;
  }
  // ── 닉네임은 겹치지 않게: names/{소문자 닉네임} = { uid } 로 먼저 차지한다 (아이디는 로그인 기능이 알아서 겹치지 않게 한다)
  const nameKey = n => String(n).trim().normalize('NFC').toLowerCase();
  async function nameFree(n) {
    const d = await db.collection('names').doc(nameKey(n)).get();
    return !d.exists || (user && d.data().uid === user.uid);
  }
  async function claimName(n, old) {
    const ref = db.collection('names').doc(nameKey(n));
    await db.runTransaction(async t => {
      const d = await t.get(ref);
      if (d.exists && d.data().uid !== user.uid) throw { taken: true };
      if (!d.exists) t.set(ref, { uid: user.uid });
    });
    if (old && nameKey(old) !== nameKey(n)) await db.collection('names').doc(nameKey(old)).delete().catch(() => {});
  }
  const TAKEN = '이미 누가 쓰고 있는 닉네임입니다. 다른 닉네임을 골라 주세요.';
  async function signUp(id, pw, nick) {
    id = String(id || '').trim().toLowerCase(); nick = String(nick || '').trim();
    if (!ID_RE.test(id)) throw { msg: '아이디는 영어 소문자, 숫자, _ 로 3~16자입니다.' };
    if (String(pw).length < 6) throw { msg: '비밀번호는 6자 이상이어야 합니다.' };
    nick = nick || id;   // 닉네임을 비우면 아이디를 닉네임으로 (그래서 아이디도 금칙어 검사)
    const bad = checkName(nick, nick === id ? 16 : 10); if (bad) throw { msg: nick === id ? '아이디를 닉네임으로 쓸 수 없어요. ' + bad : bad };
    await init();
    let free;
    try { free = await nameFree(nick); } catch (e) { throw { msg: why(e) }; }
    if (!free) throw { msg: nick === id ? '아이디와 같은 닉네임을 이미 누가 쓰고 있어요. 닉네임을 따로 정해 주세요.' : TAKEN };
    try { user = (await auth.createUserWithEmailAndPassword(id + MAIL, pw)).user; }
    catch (e) { throw { msg: why(e) }; }
    profile = { id };
    try { await claimName(nick); }
    catch (e) {   // 그 사이에 누가 먼저 가져감: 가입은 됐으니 닉네임만 다시 정하게 한다
      await db.collection('users').doc(user.uid).set({ id, created: Date.now() }, { merge: true }).catch(() => {});
      throw { msg: e.taken ? '가입은 됐지만 그 닉네임을 방금 다른 사람이 가져갔어요. 계정 → 닉네임 바꾸기에서 정해 주세요.' : why(e), joined: true };
    }
    profile = { name: nick, id, nameOk: true }; profileAt = Date.now(); setNameOk(nick);
    try { await db.collection('users').doc(user.uid).set({ name: nick, id, created: Date.now() }, { merge: true }); }
    catch (e) { throw { msg: why(e), joined: true }; }
  }
  async function signIn(id, pw) {
    id = String(id || '').trim().toLowerCase();
    if (!id || !pw) throw { msg: '아이디와 비밀번호를 입력해 주세요.' };
    await init();
    try { const cred = await auth.signInWithEmailAndPassword(id + MAIL, pw); user = cred.user; if (!freshProfile()) await loadProfile(); }
    catch (e) { throw { msg: why(e) }; }
  }
  async function signOut() { if (auth) await auth.signOut(); user = null; profile = null; }
  // 계정 삭제: 비밀번호를 한 번 더 확인하고, 서버에 남은 내 기록(세이브, 닉네임, 접속 표시, 아직 아무도 구조하지 않은 요청)을 지운 뒤 계정을 없앤다
  async function deleteAccount(pw) {
    if (!user) throw { msg: '로그인되어 있지 않아요.' };
    try { await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, pw)); }
    catch (e) { throw { msg: why(e) }; }
    const uid = user.uid;
    try {
      const q = await db.collection('sos').where('owner', '==', uid).get();
      for (const d of q.docs) if (d.data().status === 'open') await d.ref.delete().catch(() => {});
      if (profile && profile.name) {
        const ref = db.collection('names').doc(nameKey(profile.name)), n = await ref.get();
        if (n.exists && n.data().uid === uid) await ref.delete();
      }
      await db.collection('presence').doc(uid).delete().catch(() => {});
      await db.collection('diag').doc(uid).delete().catch(() => {});
      await db.collection('endingVotes').doc(uid).delete().catch(() => {});
      await db.collection('users').doc(uid).delete();
      await user.delete();
    } catch (e) { throw { msg: why(e) }; }
    try { localStorage.removeItem(NAME_OK_KEY); } catch (e) { /* 무시 */ }
    user = null; profile = null;
  }
  async function setName(nick) {
    nick = String(nick || '').trim();
    const bad = checkName(nick); if (bad) throw { msg: bad };
    try {
      await claimName(nick, profile && profile.nameOk ? profile.name : null);
      await db.collection('users').doc(user.uid).set({ name: nick }, { merge: true });
      profile = { ...profile, name: nick, nameOk: true, nameTaken: false }; setNameOk(nick);
    } catch (e) { throw { msg: e.taken ? TAKEN : why(e) }; }
  }

  // ── 클라우드 세이브: users/{uid}.save (JSON 문자열), savedAt (저장한 시각) ──
  async function fetchCloud() {
    if (!user) return null;
    if (!freshProfile()) await loadProfile();   // 로그인하며 방금 읽었으면 다시 읽지 않는다
    return profile.save ? { raw: profile.save, savedAt: profile.savedAt || 0, ver: profile.ver || '0' } : null;
  }
  // upAt: 서버 시각. 보안 규칙(firestore.rules)이 이걸로 너무 잦은 저장을 막는다 (20초에 한 번까지)
  async function pushCloud(raw, savedAt) {
    if (!user) return;
    await db.collection('users').doc(user.uid).set({ save: raw, savedAt, ver: GAME_VERSION, upAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    profile = { ...profile, save: raw, savedAt, ver: GAME_VERSION };
  }
  async function clearCloud() {
    const del = firebase.firestore.FieldValue.delete();
    await db.collection('users').doc(user.uid).update({ save: del, savedAt: del, ver: del, upAt: firebase.firestore.FieldValue.serverTimestamp() });
    profile = { name: profile && profile.name, id: profile && profile.id };
  }

  // ── 구조 게시판: sos/{올린 시각_요청 번호} ──
  // 문서 이름이 올린 시각으로 시작해서, 이름순으로 읽으면 오래된 요청부터 나온다 (추가 색인 없이)
  const openKey = () => GAME_VERSION + '|open';   // 서버 규칙이 확인하는 값 (게시판은 버전과 상관없이 모든 열린 요청을 보여준다)
  const BOARD_SIZE = 10;               // 게시판에 보이는 요청 수 (가장 오래 기다린 것부터)
  const HOLD_MS = SOS_HOLD_MS;     // 누가 구조하러 가면 이 시간 동안 다른 사람에게는 안 보인다 (js/defs.js, 구조 중에는 연장)
  const stamp = t => String(t).padStart(14, '0');
  const idOf = docId => +String(docId).split('_').pop();   // 문서 이름 → 요청 번호 (SOS 코드의 번호)
  async function postSOS(s) {
    await ensureName();
    dropListCache();
    const created = Date.now(), docId = `${stamp(created)}_${s.id}`;
    await db.collection('sos').doc(docId).set({
      owner: user.uid, name: name(), dungeon: s.dungeon, floor: s.floor, sp: s.sp, lv: s.lv, shiny: !!s.shiny,
      ver: GAME_VERSION, key: openKey(), status: 'open', created, sid: s.id,
    });
    return docId;
  }
  const heldByOther = s => s.takenBy && s.takenBy !== user.uid && s.takenAt && s.takenAt.toMillis() > Date.now() - HOLD_MS;
  // 열린 요청 중 가장 오래 기다린 것부터. 요청에는 던전·층·포켓몬 번호만 있어서 버전이 달라도 구조할 수 있다
  // (이 버전에 없는 던전·포켓몬이 담긴 요청은 게시판 화면에서 뺀다) (최근 48시간, 내 것과 다른 사람이 구조하러 간 것 제외)
  // 게시판을 다시 열어도 2분 안이면 방금 읽은 목록을 보여준다 (읽기 절약). 내가 요청을 맡거나 올리면 새로 읽는다
  const LIST_CACHE_MS = 5 * 60 * 1000;   // 2분 → 5분 (v0.96, 읽기 한도 아끼기)
  let listCache = null;
  const dropListCache = () => { listCache = null; };
  async function listSOS() {
    if (listCache && listCache.uid === user.uid && Date.now() - listCache.at < LIST_CACHE_MS) return listCache.list;
    const since = stamp(Date.now() - SOS_EXPIRE_MS);   // 48시간이 지난 요청은 구조 실패라 보이지 않는다
    const q = await db.collection('sos').where('status', '==', 'open')
      .orderBy(firebase.firestore.FieldPath.documentId()).startAt(since).limit(BOARD_SIZE + 2).get();   // 30 → 12 (v0.96): 보이는 10개 + 내 요청·남이 맡은 요청 여유
    const list = q.docs.map(d => ({ id: d.id, sid: idOf(d.id), ...d.data() }))
      .filter(s => s.owner !== user.uid && !heldByOther(s)).slice(0, BOARD_SIZE);
    listCache = { uid: user.uid, at: Date.now(), list };
    return list;
  }
  // 구조하러 간다: 이 요청을 30분 동안 맡는다 (다시 부르면 연장). 이미 다른 사람이 맡았거나 끝났으면 false
  async function takeSOS(docId) {
    dropListCache();
    const ref = db.collection('sos').doc(String(docId));
    return db.runTransaction(async t => {
      const d = await t.get(ref);
      if (!d.exists || d.data().status !== 'open' || heldByOther(d.data())) return false;
      t.update(ref, { takenBy: user.uid, takenAt: firebase.firestore.FieldValue.serverTimestamp() });
      return true;
    });
  }
  // 구조 임무를 취소: 다른 사람이 받을 수 있게 풀어 준다
  async function releaseSOS(docId) {
    dropListCache();
    const ref = db.collection('sos').doc(String(docId));
    const d = await ref.get();
    if (d.exists && d.data().status === 'open' && d.data().takenBy === user.uid) await ref.update({ takenBy: null, takenAt: null });
  }
  // 내가 올린 요청 중 요청 번호가 id인 문서 이름 (없으면 null)
  async function findMySOS(id) {
    const q = await db.collection('sos').where('owner', '==', user.uid).limit(20).get();
    const d = q.docs.find(x => idOf(x.id) === +id);
    return d ? d.id : null;
  }
  // 내 구조 요청 지켜보기: 문서가 바뀔 때만 알려 준다 (처음 1번 + 바뀔 때마다 읽기 1번. 1분 30초마다 확인하는 것보다 싸고 바로 알 수 있다)
  function watchSOS(docId, cb) {
    return db.collection('sos').doc(String(docId)).onSnapshot(d => cb(d.exists ? d.data() : null), e => { noteFail('watchSOS', e); if (DOWN_CODES.test(String((e && e.code) || ''))) downAt = Date.now(); });   // 지켜보기가 막혀도 '서버 막힘'으로 (코드를 다시 보여 준다)
  }
  // SOS 코드의 요청 번호로 게시판 문서 찾기 (v0.57부터 올린 요청만 sid가 있다). 없으면 null
  async function findSOSById(sid) {
    const q = await db.collection('sos').where('sid', '==', +sid).limit(1).get();
    return q.empty ? null : { docId: q.docs[0].id, ...q.docs[0].data() };
  }
  // 읽기가 되는지 서버에 직접 확인 (캐시 말고). 읽기 한도만 넘고 쓰기는 되는 날이 있어서 (v0.95)
  async function probeSOS(id) { await db.collection('sos').doc(String(id)).get({ source: 'server' }); return true; }
  async function getSOS(id) {
    const d = await db.collection('sos').doc(String(id)).get();
    return d.exists ? d.data() : null;
  }
  // 구조 완료를 알린다. 이미 누가 구조했거나 요청자가 포기했으면 false
  // noGift: 감사 선물을 받지 않는 탐험대 (요청자에게 선물 고르는 창을 띄우지 않게). 서버 규칙이 아직 이 값을 모르면 빼고 다시 보낸다
  async function claimRescue(id, me, noGift) {
    await ensureName();
    const ref = db.collection('sos').doc(String(id));
    const run = ng => db.runTransaction(async t => {
      const d = await t.get(ref);
      if (!d.exists || d.data().status !== 'open') return false;
      t.update(ref, { status: 'rescued', key: d.data().ver + '|done', rescuer: { uid: user.uid, name: name(), sp: me.sp, lv: me.lv, shiny: !!me.shiny, ...(ng ? { noGift: true } : {}) } });
      return true;
    });
    try { return await run(noGift); }
    catch (e) { if (noGift && e && e.code === 'permission-denied') return run(false); throw e; }
  }
  const thankSOS = (id, item) => db.collection('sos').doc(String(id)).update({ status: 'thanked', thx: item || null });
  const deleteSOS = id => db.collection('sos').doc(String(id)).delete();

  // ── 접속자 수: 로그인한 사람만 presence/{uid}에 "지금 있음" 시각을 남긴다 ──
  // 무료 한도를 아끼려고 PRESENCE_MIN분마다 한 번씩만 남기고, 최근 ONLINE_WINDOW분 안에 남긴 사람을 센다 (문서를 읽지 않는 count 집계)
  const PRESENCE_MIN = 30, ONLINE_WINDOW = 61;   // 10분 → 15분(v0.47) → 30분(v0.51) (창은 표시 간격의 두 배 + 1분)
  async function touchPresence() {
    if (!user) return;
    await db.collection('presence').doc(user.uid).set({ at: firebase.firestore.FieldValue.serverTimestamp() });
  }
  // compat SDK에는 count가 없어서 REST 집계 요청을 쓴다 (문서 1000개까지 읽기 1번으로 계산됨)
  async function onlineCount() {
    if (!user) return null;
    const since = new Date(Date.now() - ONLINE_WINDOW * 60 * 1000).toISOString();
    const url = `https://firestore.googleapis.com/v1/projects/${ONLINE_CONFIG.projectId}/databases/(default)/documents:runAggregationQuery`;
    const body = { structuredAggregationQuery: {
      structuredQuery: { from: [{ collectionId: 'presence' }], where: { fieldFilter: { field: { fieldPath: 'at' }, op: 'GREATER_THAN', value: { timestampValue: since } } } },
      aggregations: [{ alias: 'n', count: {} }] } };
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await user.getIdToken() };
    if (appCheckOn()) headers['X-Firebase-AppCheck'] = (await firebase.appCheck().getToken()).token;   // REST 요청도 App Check 토큰을 붙인다
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) throw { code: r.status === 403 ? 'permission-denied' : r.status === 429 ? 'resource-exhausted' : 'http-' + r.status, message: 'count ' + r.status };
    const j = await r.json();
    return +((j[0] && j[0].result && j[0].result.aggregateFields.n.integerValue) || 0);
  }

  // ── 스타팅 순위: 계정마다 한 번, starterVotes/{uid}를 만들면서 stats/starters의 그 포켓몬 수를 1 올린다 (규칙이 한 번·1만 허용) ──
  async function voteStarter(sp) {
    if (!user) return;
    const b = db.batch();
    b.set(db.collection('starterVotes').doc(user.uid), { sp, at: firebase.firestore.FieldValue.serverTimestamp() });
    b.set(db.collection('stats').doc('starters'), { c: { [String(sp)]: firebase.firestore.FieldValue.increment(1) } }, { merge: true });
    await b.commit();
  }
  // ── 엔딩 통계: 계정마다 한 번, endingVotes/{uid}를 만들면서 stats/endings를 그 기록만큼 올린다 (보안 규칙이 한 번·정확한 값만 허용) ──
  async function voteEnding(rec) {
    if (!user) return;
    const cur = await db.collection('stats').doc('endings').get();
    const minDays = cur.exists && cur.data().minDays != null ? cur.data().minDays : Infinity;
    const inc = firebase.firestore.FieldValue.increment;
    const st = { n: inc(1), sum: {} };
    for (const k of ['starter', 'shiny', 'ultra', 'legend', 'lead', 'faint', 'most']) if (rec[k] != null) st[k] = { [String(rec[k])]: inc(1) };
    for (const k of ['days', 'sec', 'kills', 'floors', 'bosses', 'clears', 'missions', 'rescues', 'faints']) st.sum[k] = inc(rec[k]);
    if (rec.days < minDays) st.minDays = rec.days;
    const b = db.batch();
    b.set(db.collection('endingVotes').doc(user.uid), { ...rec, ver: GAME_VERSION, at: firebase.firestore.FieldValue.serverTimestamp() });
    b.set(db.collection('stats').doc('endings'), st, { merge: true });
    await b.commit();
    try { localStorage.removeItem(END_KEY); } catch (e) { /* 무시 */ }
  }
  // 엔딩 통계는 하루에 한 번만 읽는다 (낸 직후에는 새로)
  // 아직 아무도 없던 결과는 END_EMPTY_MS 동안만 쓴다 (그 사이 누가 엔딩을 보면 그날 안에 보이게. 예전에는 하루 내내 '없음'으로 남았다)
  const END_KEY = 'pmdweb_endings', END_EMPTY_MS = 30 * 60 * 1000;
  async function endingStats() {
    const day = new Date().toLocaleDateString('sv');
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(END_KEY)); } catch (e) { /* 무시 */ }
    if (cached && cached.day === day && cached.d && (cached.d.n > 0 || Date.now() - (cached.at || 0) < END_EMPTY_MS)) return cached;
    if (!await init()) throw new Error('offline');
    const d = await db.collection('stats').doc('endings').get();
    const out = { day, at: Date.now(), d: d.exists ? d.data() : { n: 0 } };
    try { localStorage.setItem(END_KEY, JSON.stringify(out)); } catch (e) { /* 무시 */ }
    return out;
  }

  // 순위는 하루에 한 번만 읽는다 (브라우저에 저장해 두고 날짜가 바뀌면 다시 읽음)
  const RANK_KEY = 'pmdweb_starters';
  async function starterRanks() {
    const day = new Date().toLocaleDateString('sv');
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(RANK_KEY)); } catch (e) { /* 무시 */ }
    if (cached && cached.day === day && cached.c) return cached;
    if (!await init()) throw new Error('offline');
    const d = await db.collection('stats').doc('starters').get();
    const out = { day, c: (d.exists && d.data().c) || {} };
    try { localStorage.setItem(RANK_KEY, JSON.stringify(out)); } catch (e) { /* 무시 */ }
    return out;
  }

  return {
    touchPresence: track('touchPresence', touchPresence), onlineCount: track('onlineCount', onlineCount), PRESENCE_MIN, ONLINE_WINDOW,
    voteStarter: track('voteStarter', voteStarter), starterRanks: track('starterRanks', starterRanks), flushDiag,
    voteEnding: track('voteEnding', voteEnding), endingStats: track('endingStats', endingStats),
    enabled, init, onChange, loggedIn, name, userId, why, nameTaken: () => !!(profile && profile.nameTaken),
    serverDown, signUp, signIn, signOut, setName: track('setName', setName), deleteAccount, cleanName, uid: () => user && user.uid,
    fetchCloud: track('fetchCloud', fetchCloud), pushCloud: track('pushCloud', pushCloud), clearCloud: track('clearCloud', clearCloud),
    postSOS: track('postSOS', postSOS), listSOS: track('listSOS', listSOS), takeSOS: track('takeSOS', takeSOS), releaseSOS: track('releaseSOS', releaseSOS),
    getSOS: track('getSOS', getSOS), probeSOS: track('probeSOS', probeSOS), findMySOS: track('findMySOS', findMySOS), findSOSById: track('findSOSById', findSOSById), watchSOS,
    claimRescue: track('claimRescue', claimRescue), thankSOS: track('thankSOS', thankSOS), deleteSOS: track('deleteSOS', deleteSOS), idOf,
  };
})();
