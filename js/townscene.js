// 마을 풍경 (마을 화면 맨 위 띠): 시간대에 따라 하늘색이 바뀌고, 리더와 동료가 길 위를 걸어 다닌다
// 배경은 바뀔 때만 따로 그려 두고(집·나무·언덕), 매 프레임에는 포켓몬만 다시 그린다. 마을 화면이 보일 때만 돈다
'use strict';

const TownScene = (() => {
  let canvas = null, ctx = null, bg = null, bgKey = '', raf = 0, walkers = [], lastT = 0;
  const VIEW_H = 64;   // 논리 높이 (화면 높이에 맞춰 키운다)

  // 시간대: 0 낮 · 1 저녁 · 2 밤 · 3 아침
  function phase() { const h = new Date().getHours(); return h >= 6 && h < 9 ? 3 : h >= 9 && h < 17 ? 0 : h >= 17 && h < 20 ? 1 : 2; }
  const SKY = [['#7ec8ff', '#d4efff'], ['#f08a5d', '#ffd59a'], ['#0b1633', '#24427e'], ['#9fc3f0', '#ffe2c4']];
  const HILL = [['#5fa86b', '#4a8f57'], ['#7a7d5a', '#61654a'], ['#1f3a3d', '#18302f'], ['#6aa47a', '#57906a']];
  const GRASS = ['#78c25a', '#8f9b52', '#2c4a35', '#7cba63'], PATH = ['#d9b77a', '#c99d6a', '#5d5442', '#d6b685'];

  // 늘 같은 모양이 나오게 하는 간단한 난수 (집 배치 등)
  const rnd = seed => () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

  function drawBg(W, H, ph) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), R = rnd(7);
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, SKY[ph][0]); sky.addColorStop(1, SKY[ph][1]);
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    if (ph === 2) { g.fillStyle = '#fff'; for (let i = 0; i < W / 6; i++) g.fillRect(Math.floor(R() * W), Math.floor(R() * H * 0.5), 1, 1); g.fillStyle = '#fff6c8'; g.beginPath(); g.arc(W * 0.82, 12, 6, 0, Math.PI * 2); g.fill(); }
    else if (ph !== 1) { g.fillStyle = '#ffffffcc'; for (const [x, y, w] of [[0.12, 10, 18], [0.45, 7, 24], [0.74, 14, 16]]) { g.fillRect(Math.floor(W * x), y, w, 4); g.fillRect(Math.floor(W * x) + 4, y - 3, w - 8, 3); } }
    else { g.fillStyle = '#ffdf8a'; g.beginPath(); g.arc(W * 0.8, H * 0.55, 9, 0, Math.PI * 2); g.fill(); }
    // 언덕 두 겹
    for (let k = 0; k < 2; k++) {
      g.fillStyle = HILL[ph][k]; g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 4) g.lineTo(x, H * (0.55 + k * 0.08) - Math.sin(x / (38 - k * 10) + k * 2) * (6 - k * 2) - Math.sin(x / 13 + k) * 1.5);
      g.lineTo(W, H); g.fill();
    }
    // 땅과 길
    const gy = H - 18;
    g.fillStyle = GRASS[ph]; g.fillRect(0, gy, W, 18);
    g.fillStyle = PATH[ph]; g.fillRect(0, gy + 7, W, 7);
    g.fillStyle = '#00000018'; for (let x = 0; x < W; x += 9) g.fillRect(x, gy + 9 + (x % 2), 3, 1);
    // 집·나무 (길 위쪽 풀밭에)
    const lit = ph === 2 || ph === 1;
    const house = (x, w, h, roof) => {
      const y = gy + 2 - h;
      g.fillStyle = '#00000030'; g.fillRect(x + 2, gy, w, 2);
      g.fillStyle = '#e8d6b0'; g.fillRect(x, y, w, h);
      g.fillStyle = roof; g.beginPath(); g.moveTo(x - 3, y + 1); g.lineTo(x + w / 2, y - h * 0.7); g.lineTo(x + w + 3, y + 1); g.fill();
      g.fillStyle = '#7a4e2d'; g.fillRect(x + Math.floor(w / 2) - 2, gy - 5, 4, 7);
      g.fillStyle = lit ? '#ffd86b' : '#8fc8e8'; g.fillRect(x + 2, y + 3, 3, 3); g.fillRect(x + w - 5, y + 3, 3, 3);
    };
    const tree = (x, s) => { g.fillStyle = '#6b4a2b'; g.fillRect(x - 1, gy - 4, 2, 6); g.fillStyle = ph === 2 ? '#2f5a3c' : '#4f9e4f'; g.beginPath(); g.arc(x, gy - 7, s, 0, Math.PI * 2); g.fill(); };
    const roofs = ['#d85a4a', '#4a7fd8', '#4fae6a', '#d8a04a', '#9a5ad8'];
    // 가운데는 탐험대 기지 (큰 천막)
    const cx = Math.floor(W * 0.5);
    g.fillStyle = '#c94f6d'; g.beginPath(); g.moveTo(cx - 20, gy + 2); g.lineTo(cx, gy - 26); g.lineTo(cx + 20, gy + 2); g.fill();
    g.fillStyle = '#f2c94c'; g.beginPath(); g.moveTo(cx - 12, gy + 2); g.lineTo(cx, gy - 26); g.lineTo(cx + 12, gy + 2); g.fill();
    g.fillStyle = '#3b2a1e'; g.fillRect(cx - 4, gy - 8, 8, 10);
    g.fillStyle = '#ff6b6b'; g.fillRect(cx, gy - 34, 1, 8); g.fillRect(cx + 1, gy - 34, 5, 3);
    for (let x = 6, i = 0; x < W - 20; i++) {
      if (Math.abs(x + 10 - cx) < 32) { x = cx + 30; continue; }
      if (R() < 0.62) { const w = 14 + Math.floor(R() * 6); house(x, w, 10 + Math.floor(R() * 5), roofs[i % roofs.length]); x += w + 10 + Math.floor(R() * 14); }
      else { tree(x + 4, 5 + Math.floor(R() * 3)); x += 14 + Math.floor(R() * 10); }
    }
    return c;
  }

  // 걷는 포켓몬: 길 위의 정해진 곳까지 걸어가고, 잠깐 쉬고, 다시 다른 곳으로
  function makeWalkers(list) {
    const old = new Map(walkers.map(w => [w.id + (w.shiny ? 's' : ''), w]));
    walkers = list.map(({ id, shiny }, i) => old.get(id + (shiny ? 's' : '')) || { id, shiny, x: 0.35 + i * 0.1, tx: 0.35 + i * 0.1, dir: 0, rest: 600 + i * 400, since: 0 });
  }
  function step(dt, W) {
    for (const w of walkers) {
      const dx = w.tx - w.x;
      if (Math.abs(dx) * W < 0.6) {
        w.x = w.tx; w.rest -= dt; w.dir = 0;
        if (w.rest <= 0) { w.tx = 0.08 + Math.random() * 0.84; w.rest = 1200 + Math.random() * 2500; }
      } else { const v = 22 / W * dt / 1000; w.x += Math.sign(dx) * Math.min(Math.abs(dx), v); w.dir = dx > 0 ? 2 : 6; }
    }
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (!canvas || !canvas.isConnected || document.hidden) return;
    const cw = canvas.clientWidth, ch = canvas.clientHeight; if (!cw || !ch) return;
    const k = ch / VIEW_H, W = Math.ceil(cw / k), H = VIEW_H;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; ctx.imageSmoothingEnabled = false; bgKey = ''; }
    const ph = phase(), key = W + ':' + ph;
    if (key !== bgKey) { bg = drawBg(W, H, ph); bgKey = key; }
    const dt = lastT ? Math.min(100, t - lastT) : 16; lastT = t;
    step(dt, W);
    ctx.drawImage(bg, 0, 0);
    // 뒤(위)에 있는 포켓몬부터: 같은 줄이라 왼쪽부터 그린다
    const gy = H - 7;
    for (const w of walkers.slice().sort((a, b) => a.x - b.x)) Sprites.draw(ctx, w.id, w.rest > 0 && w.x === w.tx ? 'Idle' : 'Walk', w.dir, t, true, Math.round(w.x * W), gy - 4, 1, false, w.shiny);
    if (phase() === 2) { ctx.fillStyle = '#0b163333'; ctx.fillRect(0, 0, W, H); }   // 밤에는 포켓몬도 조금 어둡게
  }

  // list: [{ id, shiny }] (리더, 동료)
  function show(el, list) {
    if (canvas !== el) { canvas = el; ctx = el.getContext('2d'); bgKey = ''; }
    makeWalkers(list);
    if (!raf) { lastT = 0; raf = requestAnimationFrame(frame); }
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  return { show, stop };
})();
