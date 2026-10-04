// 도감: 포켓몬 / 기술 / 아이템
'use strict';

const Dex = (() => {
  let mode = 'pokemon', medals = {};   // medals: 도감 목록에 띄울 메달 아이콘 (그릴 때마다 새로)
  const RANGE_SHORT = { f: '앞', p: '원거리', r: '주변', s: '자신' };
  const CLS = ['', '변화', '물리', '특수'];
  const bst = id => DATA.species[id].b.reduce((a, b) => a + b, 0);
  const shopSet = new Set([...SHOP_POOL, ...SHOP_FIXED, ...HELD_SHOP_POOL, ...TM_IDS, ...Object.keys(VITAMINS), ...Object.keys(GUMMIES), 'abcapsule', 'eggtm', 'abpatch']), dropSet = new Set([...DROP_TABLE.map(d => d[0]), ...MEGA_STONES]);

  function render() {
    const tabs = [['pokemon', '포켓몬'], ['move', '기술'], ['ability', '특성'], ['item', '아이템']]
      .map(([k, n]) => `<button class="${mode === k ? 'on' : ''}" data-dexmode="${k}">${n}</button>`).join('');
    return `<div class="dex-tabs">${tabs}</div>${{ pokemon: renderPokemon, move: renderMoves, ability: renderAbilities, item: renderItems }[mode]()}`;
  }

  function renderPokemon() {
    const ids = SPECIES_IDS.map(Number).sort(byDex);
    const gens =[...new Set(ids.map(id => DATA.species[id].g))].sort((a, b) => a - b);
    const cnt = Progress.dexCounts(), pct = n => (n / cnt.total * 100).toFixed(1);
    const state = id => (Progress.beatCount(id) ? 2 : Progress.isSeen(id) ? 1 : 0);
    // 영입: 캐릭터 목록에 있는 포켓몬과 그 진화 전 모습 (진화시키면 진화 전 모습은 목록에서 빠지지만 도감에는 영입한 것으로)
    const ownSet = new Set(Game.save ? Object.keys(Game.save.roster).flatMap(k => [+k, ...preEvos(+k)]) : []);
    const own = id => ownSet.has(+id);
    // 이로치: 그림이 있는지(sh) / 내가 얻었는지 (그 포켓몬이나 진화 계열의 이로치를 쓰러뜨리거나 영입하면 고를 수 있다)
    const shinyMine = id => !!(Game.save && DATA.species[id].sh && Game.shinyOk(+id));
    return `<div class="dex-rate">
        <div>👁 만난 포켓몬 <b>${cnt.seen}</b> / ${cnt.total} <span class="dim">(${pct(cnt.seen)}%)</span><span class="bar"><i style="width:${pct(cnt.seen)}%;background:#6cf"></i></span></div>
        <div>⚔ 쓰러뜨린 포켓몬 <b>${cnt.beaten}</b> / ${cnt.total} <span class="dim">(${pct(cnt.beaten)}%)</span><span class="bar"><i style="width:${pct(cnt.beaten)}%;background:#f58a42"></i></span></div>
        ${Game.save ? (() => { const n = ids.filter(own).length; return `<div>🤝 영입한 포켓몬 <b>${n}</b> / ${cnt.total} <span class="dim">(${pct(n)}%)</span><span class="bar"><i style="width:${pct(n)}%;background:#7fd67f"></i></span></div>`; })() : ''}</div>
      <div class="picker-bar"><input class="dex-q" placeholder="이름 / 영어 / 번호 검색" autocomplete="off">
      <select class="dex-g"><option value="">전체 세대</option>${gens.map(g => `<option value="${g}">${g}세대</option>`).join('')}</select>
      <select class="dex-t"><option value="">전체 타입</option>${DATA.types.map((t, i) => `<option value="${i + 1}">${t}</option>`).join('')}</select>
      <select class="dex-c"><option value="">전체</option><option value="1,2">만난 포켓몬</option><option value="2">쓰러뜨린 포켓몬</option><option value="0">아직 못 만난 포켓몬</option><option value="r">🤝 영입한 포켓몬</option><option value="s">✨ 이로치를 얻은 포켓몬</option><option value="s0">이로치를 아직 못 얻은 포켓몬</option><option value="sx">이로치 그림이 없는 포켓몬</option></select>
      <span class="dim dex-count"></span></div>
      ${(() => { medals = Game.save ? Game.dexMedals() : {}; return ''; })()}
      <div class="picker dex-grid">${ids.map(id => { const d = DATA.species[id], st = state(id), md = medals[id] || ''; return `<button class="pk dex-item${st ? '' : ' unseen'}" data-dexpoke="${id}"
        data-s="${esc((d.n + ' ' + d.e + ' ' + dexNo(id) + ' ' + id).toLowerCase())}" data-g="${d.g}" data-t="${d.t.join(',')}" data-c="${st}" data-r="${own(id) ? 1 : ''}" data-sh="${!d.sh ? 'x' : shinyMine(id) ? 'y' : 'n'}">
        ${portraitImg(id, 'portrait sm')}<span>${esc(d.n)}</span><i class="dim">${dexNo(id)}${st === 2 ? ' ⚔' : st === 1 ? ' 👁' : ''}</i>${md ? `<i class="dex-medals">${md}</i>` : ''}${own(id) ? '<i class="dex-own" title="영입한 포켓몬">🤝</i>' : ''}${shinyMine(id) ? '<i class="dex-shiny" title="이로치를 얻었어요">✨</i>' : ''}</button>`; }).join('')}</div>`;
  }

  function renderMoves() {
    const ids = Object.keys(DATA.moves).map(Number).sort((a, b) => DATA.moves[a].t - DATA.moves[b].t || DATA.moves[a].n.localeCompare(DATA.moves[b].n, 'ko'));
    return `<div class="picker-bar"><input class="dex-q" placeholder="기술 이름 검색" autocomplete="off">
      <select class="dex-t"><option value="">전체 타입</option>${DATA.types.map((t, i) => `<option value="${i + 1}">${t}</option>`).join('')}</select>
      <select class="dex-c"><option value="">전체 분류</option><option value="2">물리</option><option value="3">특수</option><option value="1">변화</option></select>
      <span class="dim dex-count"></span></div>
      <table class="dex-table"><thead><tr><th>타입</th><th>이름</th><th>분류</th><th>위력</th><th>명중</th><th>PP</th><th>범위</th></tr></thead><tbody>
      ${ids.map(id => { const m = DATA.moves[id]; return `<tr class="dex-item" data-dexmove="${id}" data-s="${esc(m.n.toLowerCase())}" data-t="${m.t}" data-c="${m.c}">
        <td><span class="type" style="background:${TYPE_COLORS[m.t - 1]}">${typeName(m.t)}</span></td><td><b>${esc(m.n)}</b></td><td>${CLS[m.c]}</td>
        <td>${m.p || '—'}</td><td>${m.a || '—'}</td><td>${m.pp}</td><td>${rangeShort(id)}</td></tr>`; }).join('')}
      </tbody></table>`;
  }

  function renderAbilities() {
    const ids = Object.keys(DATA.abilities).map(Number).sort((a, b) => DATA.abilities[a].n.localeCompare(DATA.abilities[b].n, 'ko'));
    return `<div class="picker-bar"><input class="dex-q" placeholder="특성 이름 검색" autocomplete="off">
      <select class="dex-c"><option value="">전체</option><option value="1">원작 그대로</option><option value="2">던전용으로 변경</option><option value="3">효과 없음</option></select>
      <span class="dim dex-count"></span></div>
      ${ids.map(id => { const x = abilityDesc(id), kind = x.none ? 3 : x.dungeon ? 2 : 1; return `<div class="row dex-item clickable" data-dexability="${id}" data-s="${esc(x.n.toLowerCase())}" data-c="${kind}">
        <div class="grow"><b>${esc(x.n)}</b> ${kind === 2 ? '<span class="tag">던전 규칙</span>' : kind === 3 ? '<span class="tag">효과 없음</span>' : ''}<div class="dim">${esc(x.dungeon || x.exact || x.d)}</div></div></div>`; }).join('')}`;
  }

  function renderItems() {
    const ids = Object.keys(ITEMS).filter(id => id !== 'quest');
    return `<div class="picker-bar"><input class="dex-q" placeholder="아이템 이름 검색" autocomplete="off">
      <select class="dex-c"><option value="">전체</option><option value="1">도구</option><option value="2,4,5">지닌 물건</option><option value="4">전용 도구 (녹슨검·금강옥 등)</option><option value="5">메가스톤</option><option value="3">기술머신</option></select><span class="dim dex-count"></span></div>
      ${ids.map(id => { const it = ITEMS[id]; return `<div class="row dex-item clickable" data-dexitem="${id}" data-s="${esc(it.n.toLowerCase())}" data-c="${it.tm ? 3 : it.mega ? 5 : it.sig ? 4 : it.held ? 2 : 1}">
        ${Gfx.iconHtml(id, true)}<div class="grow"><b>${esc(it.n)}</b><div class="dim">${esc(it.d)}</div></div>
        <div class="dex-tags">${it.held ? '<span class="tag">지닌 물건</span>' : ''}${shopSet.has(id) ? `<span class="tag">상점 ₽${it.price}</span>` : ''}${dropSet.has(id) ? '<span class="tag">던전</span>' : ''}${it.sig ? '<span class="tag">전용</span>' : ''}${it.mega ? '<span class="tag">메가스톤</span>' : ''}</div></div>`; }).join('')}`;
  }

  // 검색/필터 연결 (DOM만 숨겨서 입력 포커스 유지)
  function wire(el) {
    const q = el.querySelector('.dex-q'), g = el.querySelector('.dex-g'), t = el.querySelector('.dex-t'), c = el.querySelector('.dex-c');
    const items = [...el.querySelectorAll('.dex-item')], cnt = el.querySelector('.dex-count');
    const filter = () => {
      const s = (q?.value || '').trim().toLowerCase();
      let n = 0;
      for (const b of items) {
        const ok = (!s || b.dataset.s.includes(s)) && (!g || !g.value || b.dataset.g === g.value)
          && (!t || !t.value || b.dataset.t.split(',').includes(t.value)) && (!c || !c.value || (c.value === 'r' ? !!b.dataset.r : c.value === 's' ? b.dataset.sh === 'y' : c.value === 's0' ? b.dataset.sh === 'n' : c.value === 'sx' ? b.dataset.sh === 'x' : c.value.split(',').includes(b.dataset.c)));
        b.style.display = ok ? '' : 'none';
        if (ok) n++;
      }
      if (cnt) cnt.textContent = `${n}개`;
    };
    [q, g, t, c].forEach(x => x && (x.oninput = x.onchange = filter));
    filter();
  }

  // 도감 전역 클릭 (마을 탭과 상세 모달 모두)
  function onClick(e) {
    const m = e.target.closest('[data-dexmode]');
    if (m) { mode = m.dataset.dexmode; Game.renderTown(); return; }
    const p = e.target.closest('[data-dexpoke]'); if (p) { showPokemon(+p.dataset.dexpoke); return; }
    const mv = e.target.closest('[data-dexmove]'); if (mv) { showMove(+mv.dataset.dexmove); return; }
    const ab = e.target.closest('[data-dexability]'); if (ab) { showAbility(+ab.dataset.dexability); return; }
    const it = e.target.closest('[data-dexitem]'); if (it) { showItem(it.dataset.dexitem); }
  }

  // 포켓몬이 나오는 곳: 던전마다 일반 적으로 나오는 층, 테마 시리즈, 중간·최종 보스 (처음 열 때 한 번 계산)
  let whereCache = null;
  function whereMap() {
    if (whereCache) return whereCache;
    const m = {};
    const add = (sp, dg, text, f0) => (m[sp] = m[sp] || []).push({ dg, text, f0 });
    for (const dg of DUNGEONS) {
      if (dg.daily) continue;
      const fl = {};
      for (let f = 1; f <= dg.floors; f++) {
        if (f === dg.floors && isBossFloor(dg, f)) continue;
        const fc = Dungeon.floorCandidates(dg, f);
        for (const id of [...fc.concept, ...fc.cand.map(o => o.id)]) (fl[id] = fl[id] || []).push(f);
      }
      const lv = f => Math.round(dg.lv[0] + (dg.lv[1] - dg.lv[0]) * (dg.floors > 1 ? (f - 1) / (dg.floors - 1) : 0));
      for (const [sp, fs] of Object.entries(fl)) add(+sp, dg, `${fs[0] === fs[fs.length - 1] ? fs[0] : `${fs[0]}~${fs[fs.length - 1]}`}층 · Lv${lv(fs[0])}~${lv(fs[fs.length - 1])}${[...PARADOX_PAST, ...PARADOX_FUTURE].includes(+sp) && !dg.extra ? ' · 드물게' : ''}`, fs[0]);
      for (const sp of extraPool(dg)) add(sp, dg, '테마 시리즈로 섞여 나옴', 1);
      for (const sp of midPool(dg)) add(sp, dg, `중간 보스 (${dg.mid.floors.join(', ')}층)`, dg.mid.floors[0]);
      const finals = bossPool(dg).length ? bossPool(dg) : BOSSES[dg.id] && DATA.species[BOSSES[dg.id]] ? [BOSSES[dg.id]] : [];
      for (const sp of finals) add(sp, dg, `👑 최종 보스 (${dg.floors}층${finals.length > 1 ? `, ${finals.length}종 중 하나` : ''})`, dg.floors);
    }
    return (whereCache = m);
  }
  function whereHtml(id) {
    const d = DATA.species[id];
    if (d.fc) return '<p class="dim">던전에서 원래 모습이 바뀌어서 나타나는 모습이에요. 원래 모습이 나오는 곳을 확인하세요.</p>';
    const list = whereMap()[id] || [];
    if (!list.length) return '<p class="dim">지금은 던전에 나오지 않아요.</p>';
    const tabOf = dg => (dg.mode === 'rogue' ? '로그라이크' : dg.theme ? '테마' : '일반');
    const rank = dg => (dg.mode === 'rogue' ? 2000 : dg.theme ? 1000 : 0) + dg.lv[0];   // 일반 → 테마 → 로그라이크, 그 안에서 적 레벨 순
    list.sort((a, b) => rank(a.dg) - rank(b.dg) || a.f0 - b.f0);
    return `<div class="dex-where">${list.map(w => `<div class="row"><span class="grow"><b>${esc(w.dg.n)}</b> <span class="tag">${tabOf(w.dg)}</span> <span class="dim">${esc(w.text)}</span></span></div>`).join('')}</div>`;
  }
  function showPokemon(id) {
    const d = DATA.species[id];
    const labels = ['HP', '공격', '방어', '특공', '특방', '스피드'];
    const pre = Object.keys(DATA.species).map(Number).filter(k => DATA.species[k].v.some(v => v[0] === id));
    const evoText = ([to, lv, item]) => [lv ? `Lv ${lv}` : '', item === 1 ? ITEMS.stone.n : item === 2 ? ITEMS.link.n : ''].filter(Boolean).join(' + ');
    const mini = (k, sub) => `<button class="rcard" data-dexpoke="${k}">${portraitImg(k, 'portrait sm')}<span>${esc(spName(k))}</span>${sub ? `<span class="dim">${sub}</span>` : ''}</button>`;
    const played = Game.save?.roster?.[id];
    const rec = Progress.beatCount(id) ? `쓰러뜨림 ${Progress.beatCount(id)}회` : Progress.isSeen(id) ? '만난 적 있음' : '아직 만나지 못함';
    UI.open({
      title: `No.${dexNo(id)} ${esc(d.n)}`, wide: true,
      html: `<div class="dex-poke">
        <div class="cc-top">${portraitImg(id, 'portrait big')}<div><div class="cc-name">${esc(d.n)}</div><div class="dim">${esc(d.e)} · ${d.g}세대${d.lg ? ' · 전설/환상' : ''}</div>
          <div>${typeBadges(d.t)}</div><div class="dim">📖 ${rec} · 레벨업 ${expDiv(id) > 1.01 ? `느림 (필요 경험치 ${+expDiv(id).toFixed(2)}배)` : expDiv(id) < 0.99 ? `빠름 (필요 경험치 ${+expDiv(id).toFixed(2)}배)` : '보통'}</div>${played ? `<div class="note ms">플레이 기록 Lv${played.lv}</div>` : ''}
          <div>${!d.sh ? '<span class="dim">이로치: 그림이 없어요</span>' : Game.save && Game.shinyOk(id) ? '✨ 이로치: <b>얻었어요</b> <span class="dim">(캐릭터 탭에서 고를 수 있어요)</span>' : '이로치: 있어요 · <span class="dim">🔒 아직 못 얻었어요 (이 포켓몬이나 진화 계열의 이로치를 쓰러뜨리거나 영입하면 열려요)</span>'}</div></div>
          ${d.sh ? `<div class="dex-shiny-pic" title="이로치 모습">${portraitImg(id, 'portrait big', 'Normal', true)}<div class="dim tiny center">이로치</div></div>` : ''}</div>
        ${borrowNote(id) ? `<p class="note">${esc(borrowNote(id))}</p>` : ''}
        ${Game.save && Game.hasClears(id) ? `<h3>🏅 메달 <span class="dim">(이 포켓몬으로 클리어한 던전)</span></h3>${Game.medalSection(id)}` : ''}
        <table class="dex-stats">${d.b.map((v, i) => `<tr><td>${labels[i]}</td><td class="num">${v}</td><td><span class="sbar"><i style="width:${Math.min(100, v / 1.8)}%;background:${v >= 100 ? '#4de36b' : v >= 70 ? '#f5d142' : '#f58a42'}"></i></span></td></tr>`).join('')}
          <tr><td>합계</td><td class="num"><b>${bst(id)}</b></td><td></td></tr></table>
        <h3>🗺 나오는 곳</h3>${whereHtml(id)}
        <h3>특성</h3>${d.ab.map(([aid, hid]) => `<div class="row clickable" data-dexability="${aid}"><div class="grow"><b>${esc(abilityName(aid))}</b>${hid ? ' <span class="dim">(숨겨진 특성)</span>' : ''}<div class="dim">${esc(abilityDesc(aid).dungeon || abilityDesc(aid).exact || abilityDesc(aid).d)}</div></div></div>`).join('')}
        ${d.fc ? `<h3>원래 모습</h3><div class="roster">${mini(d.f[0], '')}</div><p class="dim">${esc(formHowText(id))}</p>` : ''}
        ${(FORMS_OF[id] || []).length ? `<h3>다른 모습</h3><div class="roster">${FORMS_OF[id].map(k => mini(k, formKindName(k))).join('')}</div>` : ''}
        ${pre.length || d.v.length ? `<h3>진화</h3><div class="roster">${pre.map(k => mini(k, '진화 전')).join('')}${d.v.map(v => mini(v[0], evoText(v))).join('')}</div>` : ''}
        <h3>레벨업으로 배우는 기술</h3>
        <table class="dex-table"><tbody>${d.l.map(([lv, mid]) => { const m = DATA.moves[mid]; return `<tr data-dexmove="${mid}"><td class="num">Lv${lv}</td>
          <td><span class="type" style="background:${TYPE_COLORS[m.t - 1]}">${typeName(m.t)}</span></td><td><b>${esc(m.n)}</b></td><td>${CLS[m.c]}</td><td>${m.p || '—'}</td><td>${rangeShort(mid)}</td></tr>`; }).join('')}</tbody></table>
        <h3>🥚 교배기술 (${eggMovesOf(id).length}) <span class="dim">— 교배기술머신으로 배운다</span></h3>
        <div class="tm-chips">${eggMovesOf(id).map(mid => `<span class="tm-chip" data-dexmove="${mid}"><i style="background:${TYPE_COLORS[DATA.moves[mid].t - 1]}"></i>${esc(DATA.moves[mid].n)}</span>`).join('') || '<span class="dim">없음</span>'}</div>
        <h3>기술머신으로 배울 수 있는 기술 (${tmMovesOf(id).length})</h3>
        <div class="tm-chips">${tmMovesOf(id).map(mid => `<span class="tm-chip" data-dexmove="${mid}"><i style="background:${TYPE_COLORS[DATA.moves[mid].t - 1]}"></i>${esc(DATA.moves[mid].n)}</span>`).join('') || '<span class="dim">없음</span>'}</div>
        ${d.cr ? `<p class="dim tiny">스프라이트: ${esc(d.cr[0])} / 초상화: ${esc(d.cr[1] || '?')} (PMD SpriteCollab)</p>` : ''}
      </div>`,
      choices: [{ label: '닫기', fn: () => {} }],
    });
  }

  function showMove(mid) {
    const learners = [];
    for (const id of SPECIES_IDS) {
      const e = DATA.species[id].l.find(x => x[1] === mid);
      if (e) learners.push([+id, e[0]]);
    }
    learners.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const tmLearners = ITEMS['tm' + mid] ? SPECIES_IDS.map(Number).filter(s => canLearnTM(s, mid)) : [];
    const eggLearners = SPECIES_IDS.map(Number).filter(s => eggMovesOf(s).includes(mid));   // 교배기술머신으로 배우는 포켓몬 (진화형 포함)
    UI.open({
      title: '기술 도감', wide: true,
      html: `${moveDetailHtml(mid)}${ITEMS['tm' + mid] ? `<p>💿 ${esc(ITEMS['tm' + mid].n)} — 기술머신으로 배우는 포켓몬 ${tmLearners.length}종</p>` : ''}<h3>레벨업으로 배우는 포켓몬 (${learners.length})</h3>
        <div class="roster dex-learners">${learners.map(([id, lv]) => `<button class="rcard" data-dexpoke="${id}">${portraitImg(id, 'portrait sm')}<span>${esc(spName(id))}</span><span class="dim">Lv${lv}</span></button>`).join('')}</div>
        ${tmLearners.length ? `<h3>기술머신으로 배우는 포켓몬 (${tmLearners.length})</h3><div class="roster dex-learners">${tmLearners.map(id => `<button class="rcard" data-dexpoke="${id}">${portraitImg(id, 'portrait sm')}<span>${esc(spName(id))}</span></button>`).join('')}</div>` : ''}
        ${eggLearners.length ? `<h3>🥚 교배기술로 배우는 포켓몬 (${eggLearners.length}) <span class="dim">— 교배기술머신으로 배운다</span></h3><div class="roster dex-learners">${eggLearners.map(id => `<button class="rcard" data-dexpoke="${id}">${portraitImg(id, 'portrait sm')}<span>${esc(spName(id))}</span></button>`).join('')}</div>` : ''}`,
      choices: [{ label: '닫기', fn: () => {} }],
    });
  }

  function showAbility(id) {
    const holders = Object.entries(DATA.species).filter(([, s]) => s.ab.some(a => a[0] === id)).map(([k, s]) => [+k, s.ab.find(a => a[0] === id)[1]]);
    UI.open({
      title: '특성 도감', wide: true,
      html: `${abilityHtml(id)}<h3>가진 포켓몬 (${holders.length})</h3>
        <div class="roster dex-learners">${holders.map(([k, hid]) => `<button class="rcard" data-dexpoke="${k}">${portraitImg(k, 'portrait sm')}<span>${esc(spName(k))}</span>${hid ? '<span class="dim">숨겨진</span>' : ''}</button>`).join('')}</div>`,
      choices: [{ label: '닫기', fn: () => {} }],
    });
  }

  function showItem(id) {
    const it = ITEMS[id];
    const sig = it.sig ? it.hold.only.filter(sp => DATA.species[sp]).map(spName).join('·') : '';
    const where = sig ? [`마을 상점에 가끔 진열 (₽${it.price})`, `${sig}이(가) 나오는 던전에서 드물게 발견`]
      : it.special ? ['업적 「도감 완성」(모든 포켓몬을 만나고 쓰러뜨리기) 보상', `업적을 달성하면 마을 상점에 늘 진열 (₽${it.price})`]
      : [shopSet.has(id) ? `상점에서 ₽${it.price}에 구매` : '', dropSet.has(id) ? `던전 바닥에서 발견 (${dropStagesOf(id).map(i => DROP_STAGE_NAMES[i]).join('·')} 단계${ITEM_LV_RANGE[id] ? ` · 적 Lv${ITEM_LV_RANGE[id][1] < Infinity ? `${ITEM_LV_RANGE[id][1]} 미만` : `${ITEM_LV_RANGE[id][0]} 이상`} 층` : ''})` : ''].filter(Boolean);
    const how = it.vit ? '마을의 캐릭터 탭에서 먹인다. 효과는 그 포켓몬에게 영구히 남는다.' : it.tm ? `마을의 캐릭터 탭이나 던전 가방에서 사용한다. 배울 수 있는 포켓몬 ${SPECIES_IDS.filter(s => canLearnTM(+s, it.mv)).length}종.` : it.held ? '마을의 캐릭터 탭이나 던전 가방에서 지니게 하면 효과를 발휘한다. (한 번에 하나)' : it.use && it.use !== 'none' ? '던전에서 사용하거나 던질 수 있다.' : it.throw ? '던전에서 적에게 던져서 사용한다.' : id === 'stone' || id === 'link' ? '마을의 캐릭터 탭에서 진화할 때 소모된다.' : id === 'reviver' ? '가방에 있으면 쓰러질 때 자동으로 사용된다.' : '';
    const sell = Math.floor(sellOf(id));
    UI.open({
      title: '아이템 도감',
      html: `<div class="dex-itemd"><div class="md-head">${Gfx.iconHtml(id, true)} <b>${esc(it.n)}</b></div>
        <p class="md-flavor">${esc(it.d)}</p>
        ${how ? `<div class="md-eff">• ${how}</div>` : ''}
        ${it.stack ? '<div class="md-eff">• 여러 개를 가방 한 칸에 겹쳐 담을 수 있다. (상점에서 5개 묶음)</div>' : ''}
        <div class="md-eff">• 입수: ${where.join(', ') || '임무 보상'}</div>
        ${sell ? `<div class="md-eff">• 판매가: ₽${sell}${it.stack ? ' (5개 기준)' : ''}</div>` : ''}</div>`,
      choices: [{ label: '닫기', fn: () => {} }],
    });
  }

  document.addEventListener('click', onClick);
  return { render, wire, showPokemon, showMove, showItem, showAbility };
})();
