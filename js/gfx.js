// 원작(불가사의 던전 레드 구조대) 아이템·함정·상태 이상 그림: 던전 화면에 그린다
// 그림은 별도 저장소(pmd-fan-web/assets, js/config.js GFX_BASE)에 있다. 못 불러오면 false를 돌려주고, 부르는 쪽이 이모지로 그린다
// 그림 묶음은 tools/build_gfx.py가 만든다 (칸 번호가 그 순서와 같아야 한다)
'use strict';

const Gfx = (() => {
  const sheets = {};
  function sheet(name) {
    if (!sheets[name]) {
      const img = new Image();
      sheets[name] = { img, ok: false, bad: false };
      img.onload = () => { sheets[name].ok = true; };
      img.onerror = () => { sheets[name].bad = true; };
      img.src = GFX_BASE + name + '.png';
    }
    return sheets[name];
  }

  // ── 아이템 (items.png, 16×16 칸, 한 줄 16칸) ──
  // 0 씨앗 1 사과 2 바나나 3 밤송이 4 약병 5 구슬 6 얼음 상자 7 열쇠 8 동전 9 안경
  // 10~19 구미 (보라 빨강 은색 파랑 초록 노랑 남색 황토 갈색 분홍) / 20~25 열매 (빨강 남색 파랑 분홍 초록 노랑)
  // 26~32 돌 (27 회색: 자갈) / 33~38 가시 (갈색 회색 남색 분홍 금색 초록)
  // 39~44 상자 / 45~48 스카프 (분홍 파랑 노랑 초록) / 49~51 결정 (빨강 파랑 회색) / 52~53 소용돌이 / 54~55 기술머신 원반 (파랑 노랑)
  // 원작처럼 씨앗은 모두 같은 씨앗 그림, 구슬은 모두 같은 구슬 그림
  const SEEDS = ['heal', 'reviver', 'blast', 'sleep', 'warp', 'stun', 'poisonseed', 'confuseseed'];
  const ORBS = ['escape', 'lumi', 'foesleep', 'radar', 'trapbust', 'paraorb', 'sloworb'];
  const ITEM_CELL = {
    apple: 1, bigapple: 1, gravel: 27, elixir: 4, quest: 41,
    oran: 22, sitrus: 25, cheri: 20, chesto: 21, pecha: 23, rawst: 24, persim: 20, lum: 24, leppa: 20,
    liechi: 20, ganlon: 25, salac: 24, petaya: 21, apicot: 22, lansat: 23, starf: 25,
    ...Object.fromEntries(SEEDS.map(id => [id, 0])), ...Object.fromEntries(ORBS.map(id => [id, 5])),
    redgummy: 11, bluegummy: 13, greengummy: 14, yellowgummy: 15, pinkgummy: 19, whitegummy: 12, rainbowgummy: 10,
    thorn: 34, goldthorn: 37,
    stone: 49, wiseglasses: 9, xrayspecs: 9, insomniscope: 9,
    pechascarf: 45, choicescarf: 46, defscarf: 47, trapscarf: 48,
  };
  const MONEY_CELL = 8, TM_CELL = 54;
  function itemCell(it) {
    if (it.money) return MONEY_CELL;
    if (ITEM_CELL[it.id] != null) return ITEM_CELL[it.id];
    const d = ITEMS[it.id];
    if ((d && d.tm) || it.id === 'eggtm') return TM_CELL;
    return null;
  }
  // 바닥의 아이템 하나를 (cx, cy) 가운데에 그린다. 그림이 없으면 false
  function drawItem(ctx, it, cx, cy) {
    const s = sheet('items'), cell = itemCell(it);
    if (cell == null || !s.ok) return false;
    ctx.drawImage(s.img, (cell % 16) * 16, ((cell / 16) | 0) * 16, 16, 16, Math.round(cx - 8), Math.round(cy - 8), 16, 16);
    return true;
  }

  // ── 함정 (traps.png, 24×24 칸 8×3. 시트의 배치 그대로) ──
  // 능력 리셋: 원더 타일(초록 화살표) / 워프·수면·소환·폭발·배고픔(질퍽): 원작 함정 그림 / 독가시: 밤송이 / 마비: 원작에 없어 찌리리공 (임시)
  const TRAP_CELL = { psn: 12, slp: 9, par: 6, warp: 1, blast: 7, hunger: 3, summon: 14, reset: 17 };

  // 계단: 함정 시트의 18번(내려가는 계단) / 19번(올라가는 계단, 탑·산)
  function drawStairs(ctx, up, x, y) {
    const s = sheet('traps'); if (!s.ok) return false;
    const cell = up ? 19 : 18;
    ctx.drawImage(s.img, (cell % 8) * 24, ((cell / 8) | 0) * 24, 24, 24, x, y, 24, 24);
    return true;
  }
  function drawTrap(ctx, kind, x, y) {
    const s = sheet('traps'), cell = TRAP_CELL[kind];
    if (cell == null || !s.ok) return false;
    ctx.drawImage(s.img, (cell % 8) * 24, ((cell / 8) | 0) * 24, 24, 24, x, y, 24, 24);
    return true;
  }

  // ── 상태 이상 (status.png 안의 애니메이션 줄: y, 칸 너비·높이, 프레임 수, 한 프레임 ms) ──
  // 마비는 그림이 없어서 이모지 그대로
  const STATUS_ANIM = {
    slp: { y: 200, w: 16, h: 16, n: 10, ms: 110 },
    psn: { y: 216, w: 16, h: 16, n: 7, ms: 120 },
    brn: { y: 80, w: 16, h: 16, n: 7, ms: 90 },
    cnf: { y: 96, w: 16, h: 16, n: 8, ms: 90 },
    frz: { y: 112, w: 32, h: 32, n: 6, ms: 140, cover: true },   // 얼음: 포켓몬을 덮는다
    // 상태 이상이 아닌 표시 (v0.88): 랭크 업 칼 · 랭크 다운 노란 화살표 · 리플렉터·빛의장막 파란 방패 · HP가 적을 때 파란 느낌표
    up: { y: 184, w: 16, h: 16, n: 13, ms: 70 },
    down: { y: 160, w: 16, h: 16, n: 11, ms: 70 },
    wall: { y: 64, w: 16, h: 16, n: 13, ms: 80 },
    low: { y: 0, w: 16, h: 16, n: 9, ms: 90 },
  };
  // 머리 위(얼음은 몸 위)에 그린다. 그림이 없으면 false
  function drawStatus(ctx, status, cx, cy, t, seed = 0) {
    const a = STATUS_ANIM[status], s = sheet('status');
    if (!a || !s.ok) return false;
    const f = Math.floor((t + seed * 37) / a.ms) % a.n;
    if (a.cover) {
      ctx.save(); ctx.globalAlpha = 0.8;
      ctx.drawImage(s.img, f * a.w, a.y, a.w, a.h, Math.round(cx - a.w / 2), Math.round(cy - a.h / 2 - 2), a.w, a.h);
      ctx.restore();
    } else ctx.drawImage(s.img, f * a.w, a.y, a.w, a.h, Math.round(cx + 2), Math.round(cy - 24), a.w, a.h);
    return true;
  }

  // 메뉴·도감용 아이콘 HTML: 원작 그림이 있고 불러왔으면 그 칸, 아니면 이모지 (big: 2배)
  function iconHtml(id, big = false) {
    const s = sheet('items'), cell = ITEMS[id] ? itemCell({ id }) : null;
    if (cell == null || !s.ok) return `<span class="ico${big ? ' big' : ''}">${ITEMS[id] ? ITEMS[id].icon : '?'}</span>`;
    const k = big ? 2 : 1, x = (cell % 16) * 16 * k, y = ((cell / 16) | 0) * 16 * k;
    return `<span class="ico gfx-ico${big ? ' big' : ''}" style="background-image:url(${GFX_BASE}items.png);background-position:-${x}px -${y}px;background-size:${256 * k}px ${64 * k}px"></span>`;
  }
  // 미리 불러 둔다 (마을에서도: 도감·상점 아이콘)
  function preload(onItems) { const s = sheet('items'); if (onItems && !s.ok && !s.bad) s.img.addEventListener('load', onItems, { once: true }); sheet('traps'); sheet('status'); }
  return { drawItem, drawTrap, drawStairs, drawStatus, iconHtml, preload };
})();
