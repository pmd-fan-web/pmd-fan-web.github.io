// SpriteCollab 스프라이트 로더 / 애니메이터
'use strict';

const Sprites = (() => {
  const cache = {};
  const WANT = ['Idle', 'Walk', 'Attack', 'Hurt', 'Sleep', 'Shoot'];

  function load(id, shiny) {
    shiny = !!shiny && !!DATA.species[id]?.sh;
    const key = shiny ? id + 's' : id;
    if (cache[key]) return cache[key];
    const s = cache[key] = { ready: false, failed: false, anims: {}, shadow: 1 };
    // 걷는 모습이 아직 없는 포켓몬은 진화 전 포켓몬의 그림을 빌려 쓴다 (species.sb)
    // species.ss: 걷는 그림이 하위 폴더에만 있는 포켓몬 (딩루: 1003/0001, 초상화는 1003)
    const ss = DATA.species[id]?.ss;
    const local = !shiny && LOCAL_SPRITES[id];
    if (local) s.dy = local.dy || 0;
    let base = local ? local.path : `${SPRITE_BASE}/sprite/${ss ? `${pad4(id)}/${ss}/` : spritePath(DATA.species[id]?.sb || id, shiny)}`;
    // CDN에서 못 받으면 GitHub 원래 주소로 한 번 더 (그 뒤 그림도 같은 곳에서)
    const get = u => fetch(u).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
    get(base + 'AnimData.xml').catch(() => { base = spriteFallback(base); return get(base + 'AnimData.xml'); }).then(txt => {
      const xml = new DOMParser().parseFromString(txt, 'text/xml');
      s.shadow = +(xml.querySelector('ShadowSize')?.textContent || 1);
      const defs = {};
      xml.querySelectorAll('Anim').forEach(a => {
        const name = a.querySelector('Name')?.textContent;
        const copy = a.querySelector('CopyOf')?.textContent;
        if (copy) { defs[name] = { copy }; return; }
        defs[name] = {
          fw: +a.querySelector('FrameWidth').textContent,
          fh: +a.querySelector('FrameHeight').textContent,
          dur: [...a.querySelectorAll('Duration')].map(d => +d.textContent),
          hit: +(a.querySelector('HitFrame')?.textContent || -1),
        };
      });
      const resolve = n => { let d = defs[n], k = 0; while (d && d.copy && k++ < 5) { n = d.copy; d = defs[n]; } return d ? { n, d } : null; };
      let pending = 0;
      for (const w of WANT) {
        const r = resolve(w);
        if (!r) continue;
        const img = new Image();
        const anim = { ...r.d, img, ok: false, total: r.d.dur.reduce((a, b) => a + b, 0) };
        s.anims[w] = anim;
        pending++;
        img.onload = () => { anim.ok = true; anim.rows = Math.max(1, Math.round(img.height / anim.fh)); if (--pending === 0) s.ready = true; };
        img.onerror = () => { if (--pending === 0) s.ready = true; };
        img.src = base + r.n + '-Anim.png';
      }
      if (!pending) s.failed = true;
    }).catch(() => { s.failed = true; });
    return s;
  }

  function getAnim(s, name) {
    const order = { Idle: ['Idle', 'Walk'], Walk: ['Walk', 'Idle'], Attack: ['Attack', 'Walk'], Hurt: ['Hurt', 'Idle', 'Walk'], Sleep: ['Sleep', 'Idle', 'Walk'], Shoot: ['Shoot', 'Attack', 'Walk'] }[name] || [name, 'Idle', 'Walk'];
    for (const n of order) { const a = s.anims[n]; if (a && a.ok) return a; }
    return null;
  }

  // t: 애니메이션 시작 후 경과 ms, loop: 반복 여부
  function draw(ctx, id, name, dir, t, loop, cx, cy, alpha = 1, flash = false, shiny = false) {
    const s = load(id, shiny);
    const a = getAnim(s, name);
    const shadowW = [6, 9, 13][clamp(s.shadow, 0, 2)];
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(cx, cy + 6, shadowW, shadowW * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    if (!a) {
      // 로딩 중 / 실패 시 대체 표시
      ctx.fillStyle = s.failed ? '#c55' : '#aab';
      ctx.beginPath(); ctx.arc(cx, cy - 2, 7, 0, Math.PI * 2); ctx.fill();
      return;
    }
    let frameT = t * 60 / 1000;
    if (loop) frameT %= a.total; else frameT = Math.min(frameT, a.total - 0.01);
    let f = 0;
    for (let acc = 0; f < a.dur.length; f++) { acc += a.dur[f]; if (frameT < acc) break; }
    f = Math.min(f, a.dur.length - 1);
    const row = Math.min(dir, a.rows - 1);
    ctx.globalAlpha = alpha;
    ctx.drawImage(a.img, f * a.fw, row * a.fh, a.fw, a.fh, Math.round(cx - a.fw / 2), Math.round(cy - a.fh / 2 - 2 + (s.dy || 0)), a.fw, a.fh);
    if (flash) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 * alpha;
      ctx.drawImage(a.img, f * a.fw, row * a.fh, a.fw, a.fh, Math.round(cx - a.fw / 2), Math.round(cy - a.fh / 2 - 2 + (s.dy || 0)), a.fw, a.fh);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  // 그 모습의 그림을 다 받았나 (받는 중이면 다른 그림으로 대신 그리려고)
  const ready = (id, shiny) => !!getAnim(load(id, shiny), 'Idle');

  function animLength(id, name, shiny) {
    const s = cache[shiny && DATA.species[id]?.sh ? id + 's' : id]; if (!s) return 300;
    const a = getAnim(s, name); return a ? a.total * 1000 / 60 : 300;
  }

  // 표정 초상화: 없는 표정이면 Normal로
  // 폼체인지·메가진화 모습에 그 표정이 없으면 원래 모습의 초상화 (초상화가 아예 없는 모습도)
  function portrait(id, emotion = 'Normal', shiny = false) {
    const d = DATA.species[id] || {};
    if (d.fc) {
      const have = shiny && d.sem ? d.sem : d.em;
      if (!have || !have.includes(EMOTIONS[emotion] || 'N')) return portrait(d.f[0], emotion, shiny);
    }
    const useShiny = shiny && d.sem;
    const have = (useShiny ? d.sem : d.em) || 'N';
    const e = have.includes(EMOTIONS[emotion]) ? emotion : 'Normal';
    return `${SPRITE_BASE}/portrait/${spritePath(id, useShiny)}${e}.png`;
  }
  return { load, ready, draw, animLength, portrait };
})();
