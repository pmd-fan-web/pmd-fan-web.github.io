// 구조 코드: SOS(구조 요청) / A-OK(구조 완료) / THX(감사 선물)
// 서버 없이 친구끼리 문자열을 주고받는다. 내용을 비트로 묶고, 검증값을 붙이고, 뒤섞어서 영문·숫자로 바꾼다.
// (브라우저에서만 도는 게임이라 마음먹으면 위조할 수 있다. 친구끼리 쓰는 용도)
'use strict';

const Codes = (() => {
  const ALPH = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   // 헷갈리는 0 O 1 I 제외, 32자
  const VER = 1;
  const TYPES = { sos: 1, aok: 2, thx: 3 };
  const LAYOUT = {
    sos: [['id', 32], ['dg', 6], ['fl', 7], ['sp', 11], ['lv', 7], ['sh', 1]],
    aok: [['id', 32], ['sp', 11], ['lv', 7], ['sh', 1]],
    thx: [['id', 32], ['item', 10]],
  };
  const payloadBits = type => 4 + LAYOUT[type].reduce((s, f) => s + f[1], 0);
  const codeLen = type => Math.ceil((payloadBits(type) + 16) / 5);
  // 게임 버전이 바뀌어도 순서가 흔들리지 않게 아이템은 id 이름순 목록의 번호로 넣는다
  const itemList = () => Object.keys(ITEMS).filter(id => id !== 'quest').sort();

  function hash16(v, n) {
    let h = 2166136261;
    const s = 'pmdweb' + n + ':' + v.toString(16);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h ^ (h >>> 16)) & 0xffff;
  }
  // 검증값에서 만든 난수열로 내용을 뒤섞는다 (코드가 비슷해 보이지 않게)
  function keystream(seed, n) {
    let x = (seed * 2654435761 + 0x9e3779b9) >>> 0 || 1, v = 0n;
    for (let i = 0; i < n; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; v = (v << 1n) | BigInt(x & 1); }
    return v;
  }

  function encode(type, obj) {
    let v = BigInt(VER), n = 2;
    v = (v << 2n) | BigInt(TYPES[type]); n += 2;
    for (const [k, w] of LAYOUT[type]) {
      const val = BigInt(Math.max(0, Math.floor(obj[k] || 0))) & ((1n << BigInt(w)) - 1n);
      v = (v << BigInt(w)) | val; n += w;
    }
    const c = hash16(v, n);
    const all = ((v ^ keystream(c, n)) << 16n) | BigInt(c);
    const len = codeLen(type);
    let out = '';
    for (let i = len - 1; i >= 0; i--) out += ALPH[Number((all >> BigInt(i * 5)) & 31n)];
    return out.match(/.{1,4}/g).join('-');
  }

  // 입력 문자열 → { type, ...필드 } 또는 { error }
  function decode(str) {
    const clean = String(str).toUpperCase().replace(/[\s-]/g, '');
    if (!clean) return { error: L('코드를 입력해 주세요.', 'Enter a code.') };
    if ([...clean].some(ch => !ALPH.includes(ch))) return { error: L('코드에 쓸 수 없는 글자가 들어 있습니다.', 'The code has characters that are not allowed.') };
    const type = Object.keys(LAYOUT).find(t => codeLen(t) === clean.length);
    if (!type) return { error: L('코드 길이가 맞지 않습니다. 빠진 글자가 없는지 확인해 주세요.', 'Wrong code length. Check for missing characters.') };
    let all = 0n;
    for (const ch of clean) all = (all << 5n) | BigInt(ALPH.indexOf(ch));
    const n = payloadBits(type);
    all &= (1n << BigInt(n + 16)) - 1n;
    const c = Number(all & 0xffffn);
    const v = (all >> 16n) ^ keystream(c, n);
    if (hash16(v, n) !== c) return { error: L('잘못된 코드입니다. 한 글자라도 틀리면 쓸 수 없어요.', 'Invalid code. Every character must match.') };
    let rest = v, out = {};
    for (const [k, w] of [...LAYOUT[type]].reverse()) { out[k] = Number(rest & ((1n << BigInt(w)) - 1n)); rest >>= BigInt(w); }
    const t = Number(rest & 3n), ver = Number(rest >> 2n);
    if (ver !== VER || t !== TYPES[type]) return { error: L('다른 버전의 코드이거나 잘못된 코드입니다.', 'This code is from another version or invalid.') };
    return { type, ...out };
  }

  const newId = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] || 1; };
  const itemToNum = id => (id ? itemList().indexOf(id) + 1 : 0);
  const numToItem = n => (n > 0 ? itemList()[n - 1] || null : null);
  return { encode, decode, newId, itemToNum, numToItem };
})();
