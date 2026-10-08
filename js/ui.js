// 공용 UI: 모달, 선택지 메뉴, 토스트
'use strict';

const UI = (() => {
  const root = () => document.getElementById('modal-root');
  const stack = [];

  // opts: { title, html, choices:[{label, fn, disabled, sub}], cancel:fn|false, wide }
  function open(opts) {
    const el = document.createElement('div');
    el.className = 'modal-back';
    const box = document.createElement('div');
    box.className = 'modal pmd-box' + (opts.wide ? ' wide' : '');
    box.innerHTML = (opts.title ? `<div class="modal-title">${opts.title}</div>` : '') + (opts.html ? `<div class="modal-body">${opts.html}</div>` : '');
    const m = { el, box, opts, sel: 0, items: [], t0: performance.now() };
    // 닫을 수 있는 창에는 ✕ 버튼 (휴대폰에는 Esc 키가 없다)
    if (opts.cancel !== false) {
      const x = document.createElement('button');
      x.className = 'modal-x'; x.textContent = '✕'; x.title = '닫기 (Esc)';
      x.onclick = () => { if (performance.now() - m.t0 > 300) cancel(m); };
      box.prepend(x);
    }
    if (opts.choices && opts.choices.length) {
      const list = document.createElement('div');
      list.className = 'choice-list';
      opts.choices.forEach((c, i) => {
        const b = document.createElement('button');
        b.className = 'choice';
        b.disabled = !!c.disabled;
        b.innerHTML = `<span class="cursor">▶</span><span class="lbl">${c.label}</span>` + (c.sub ? `<span class="sub">${c.sub}</span>` : '');
        b.onclick = () => { if (performance.now() - m.t0 > 300) choose(m, i); };   // 앞 창을 누른 클릭이 새 창까지 누르지 않게
        b.onmouseenter = () => setSel(m, i);
        list.appendChild(b);
        m.items.push(b);
      });
      box.appendChild(list);
      const di = opts.choices.findIndex(c => c.def && !c.disabled);   // def: 처음 고를 칸 (없으면 맨 위의 고를 수 있는 칸)
      m.sel = di >= 0 ? di : opts.choices.findIndex(c => !c.disabled);
      if (m.sel < 0) m.sel = 0;
      setSel(m, m.sel);
    }
    el.appendChild(box);
    el.addEventListener('mousedown', e => { if (e.target === el && opts.cancel !== false) cancel(m); });
    root().appendChild(el);
    stack.push(m);
    if (opts.onOpen) opts.onOpen(box, m);
    return m;
  }
  function setSel(m, i) {
    m.sel = i;
    m.items.forEach((b, k) => b.classList.toggle('sel', k === i));
    m.items[i]?.scrollIntoView({ block: 'nearest' });
  }
  function close(m) {
    const i = stack.indexOf(m);
    if (i >= 0) stack.splice(i, 1);
    m.el.remove();
  }
  function choose(m, i) {
    const c = m.opts.choices[i];
    if (!c || c.disabled) return;
    if (!c.keep) close(m);
    c.fn && c.fn();
  }
  function cancel(m) {
    close(m);
    if (typeof m.opts.cancel === 'function') m.opts.cancel();
  }
  // 모달이 열려 있으면 키 입력을 처리하고 true 반환
  function key(e) {
    const m = stack[stack.length - 1];
    if (!m) return false;
    if (e.target && e.target.tagName === 'INPUT') {
      if (e.code === 'Escape') { e.preventDefault(); if (m.opts.cancel !== false) cancel(m); }
      return true;
    }
    const n = m.items.length;
    const move = d => { if (!n) return; let i = m.sel; for (let k = 0; k < n; k++) { i = (i + d + n) % n; if (!m.items[i].disabled) break; } setSel(m, i); };
    switch (e.code) {
      case 'ArrowUp': case 'KeyW': case 'Numpad8': move(-1); break;
      case 'ArrowDown': case 'KeyS': case 'Numpad2': move(1); break;
      case 'Enter': case 'Space': case 'NumpadEnter': case 'KeyZ':
        if (performance.now() - m.t0 < 300) break;   // 앞 창(이야기 대사 등)을 넘기던 키가 새 창까지 바로 넘기지 않게 (클릭과 같은 0.3초)
        if (n) choose(m, m.sel); else if (m.opts.cancel !== false) cancel(m);
        break;
      case 'Escape': case 'KeyX': case 'Backspace':
        if (m.opts.cancel !== false) cancel(m);
        break;
      default:
        if (/^Digit[1-9]$/.test(e.code)) { const i = +e.code.slice(5) - 1; if (i < n && performance.now() - m.t0 >= 300) choose(m, i); }
        else return true;
    }
    e.preventDefault();
    return true;
  }
  const isOpen = () => stack.length > 0;
  const closeAll = () => { while (stack.length) close(stack[stack.length - 1]); };

  // extra: 예/아니요 사이에 넣을 선택지 [{ label, value }] (고르면 그 value로 끝난다)
  function confirm(title, html, yesLabel = '예', noLabel = '아니요', extra = [], onOpen) {
    return new Promise(res => open({ title, html, onOpen, choices: [{ label: yesLabel, fn: () => res(true) }, ...extra.map(x => ({ label: x.label, fn: () => res(x.value) })), { label: noLabel, fn: () => res(false) }], cancel: () => res(false) }));
  }
  function alert(title, html, label = '확인') {
    return new Promise(res => open({ title, html, choices: [{ label, fn: () => res() }], cancel: () => res() }));
  }
  function toast(text) {
    const t = document.createElement('div');
    t.className = 'toast pmd-box';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('out'), 1600);
    setTimeout(() => t.remove(), 2100);
  }
  return { open, close, key, isOpen, confirm, alert, toast, closeAll, top: () => stack[stack.length - 1] };
})();

// 포켓몬 표시용 작은 HTML 조각
function typeBadges(types) {
  return types.map(t => `<span class="type" style="background:${TYPE_COLORS[t - 1]}">${typeName(t)}</span>`).join('');
}
function portraitImg(sp, cls = 'portrait', emotion = 'Normal', shiny = false) {
  // 못 불러오면 GitHub 원래 주소로 한 번 더, 그래도 안 되면 숨긴다
  return `<img class="${cls}" loading="lazy" src="${Sprites.portrait(sp, emotion, shiny)}" alt="" onerror="if(!this.dataset.r){this.dataset.r=1;this.src=spriteFallback(this.src)}else this.style.visibility='hidden'">`;
}
// 기술 상세 설명 (게임 내 실제 효과 기준)
const RANGE_DESC = { f: '바로 앞 1칸의 적', p: '바라보는 방향 직선 N칸 안의 첫 번째 적', r: '주변 3칸 안의 모든 적', s: '자기 자신' };
function moveEffects(mid) {
  const m = DATA.moves[mid], out = [];
  if (m.hits) out.push(`${m.hits[0]}~${m.hits[1]}회 연속으로 공격한다.`);
  if (m.ail) out.push(`${m.c === 1 || m.ac >= 100 ? '' : m.ac + '% 확률로 '}상대를 ${m.ailPick ? m.ailPick.map(k => STATUS_NAMES[k]).join('·') + ' 중 하나의' : STATUS_NAMES[AILMENT_MAP[m.ail]]} 상태로 만든다.`);
  if (m.sc) for (const [st, ch] of m.sc) {
    const who = m.ss || ch > 0 ? '자신' : '상대';
    out.push(`${m.scc < 100 ? m.scc + '% 확률로 ' : ''}${who}의 ${jo(STAT_NAMES[st], '을')} ${Math.abs(ch)}단계 ${ch > 0 ? '올린다' : '내린다'}.`);
  }
  if (m.h > 0) out.push(`최대 HP의 ${m.h}%를 회복한다.${m.h > BOSS_HEAL_MAX ? ` (보스가 쓰면 ${BOSS_HEAL_MAX}%)` : ''}`);
  if (m.dr > 0) out.push(`준 데미지의 ${DRAIN_PCT}%만큼 HP를 회복한다. (원작 ${m.dr}%에서 완화)`);
  if (m.dr < 0) out.push(`준 데미지의 ${Math.round(-m.dr * RECOIL_MUL)}%만큼 반동 데미지를 받는다. (원작 ${-m.dr}%에서 완화)`);
  if (m.fl) out.push(`${m.fl}% 확률로 상대를 풀죽게 한다 (1턴 행동 불가).`);
  if (m.cr) out.push('급소에 맞기 쉽다.');
  return out;
}
// 숙련도 표시: ★n (★0이면 비움) / 상세: 단계·효과·다음 단계까지
const masteryStar = (sp, mid) => { const n = sp ? masteryLevel(sp, mid) : 0; return n ? ` <span class="mastery" title="숙련도 ★${n}: PP 최대 +${n * MASTERY_PP * 100}%, ${Math.round(n * MASTERY_FREE * 100)}% 확률로 PP를 쓰지 않음">★${n}</span>` : ''; };
function masteryHtml(sp, mid) {
  const n = masteryLevel(sp, mid), u = masteryUses(sp, mid);
  const next = n < MASTERY_MAX ? `다음 ★${n + 1}까지 ${masteryNeed(mid, n + 1) - u}번` : '최고 단계';
  return `<div class="md-mastery">⭐ ${esc(spName(sp))}의 숙련도 <b>★${n}</b> <span class="dim">(사용 ${u}번 · ${next})</span><br><span class="dim">PP 최대 ${masteryMaxPP(sp, mid)} (+${Math.round(n * MASTERY_PP * 100)}%) · ${Math.round(n * MASTERY_FREE * 100)}% 확률로 PP를 쓰지 않음</span></div>`;
}
function moveDetailHtml(mid, pp, max, sp) {
  const m = DATA.moves[mid];
  const cls = ['', '변화', '물리', '특수'][m.c];
  return `<div class="move-detail">
    <div class="md-head"><span class="type" style="background:${TYPE_COLORS[m.t - 1]}">${typeName(m.t)}</span> <b>${esc(m.n)}</b> <span class="dim">${cls}</span></div>
    <table class="md-tbl"><tr><td>위력</td><td>${m.p || '—'}</td><td>명중</td><td>${m.a || '반드시 명중'}</td><td>PP</td><td>${pp != null ? pp + '/' + max : m.pp}</td></tr></table>
    <div><span class="dim">범위</span> ${MOVE_RULES[mid]?.allyHeal ? '같은 편 하나 (바로 앞, 없으면 주변 3칸에서 HP가 가장 적은 쪽)' : MOVE_RULES[mid]?.reach ? `앞 ${MOVE_RULES[mid].reach}칸 안의 첫 번째 적 (선공기)` : RANGE_DESC[m.r].replace('N', PROJ_RANGE)}</div>
    ${sp ? masteryHtml(sp, mid) : ''}
    ${moveRuleText(mid) ? `<div class="md-rule">⚑ 던전 규칙: ${esc(moveRuleText(mid))}</div>` : ''}
    ${m.d ? `<p class="md-flavor">${esc(m.d)}</p>` : ''}
    ${moveEffects(mid).map(e => `<div class="md-eff">• ${esc(e)}</div>`).join('')}
  </div>`;
}
function showMoveInfo(mid, pp, max, sp) { UI.alert('기술 정보', moveDetailHtml(mid, pp, max, sp)); }

function moveLine(mid, pp, max) {
  const m = DATA.moves[mid];
  const rng = rangeShort(mid);
  const cls = ['', '변화', '물리', '특수'][m.c];
  return `<span class="type" style="background:${TYPE_COLORS[m.t - 1]}">${typeName(m.t)}</span> <b>${esc(m.n)}</b>
    <span class="dim">${cls}${m.p ? ' 위력 ' + m.p : ''}${m.a ? ' 명중 ' + m.a : ''} · ${rng}</span>
    ${pp != null ? `<span class="pp">${pp}/${max}</span>` : `<span class="pp">PP ${m.pp}</span>`}`;
}
