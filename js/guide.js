// 게임 가이드: 타입 상성표, 전투·던전 규칙 (게임에 설정된 값을 그대로 읽어서 보여준다)
'use strict';

const Guide = (() => {
  const TOPICS = [
    ['types', '🔥 타입 상성표'],
    ['battle', '⚔ 전투 규칙'],
    ['status', '💫 상태이상'],
    ['weather', '🌦 날씨'],
    ['dungeon', '🗺 던전 규칙'],
    ['growth', '⭐ 성장과 보상'],
    ['items', '🎒 던전 아이템 단계'],
    ['party', '🤝 동료'],
    ['controls', '⌨ 조작법'],
  ];
  const short = t => typeName(t).slice(0, 2);
  const badge = t => `<span class="type" style="background:${TYPE_COLORS[t - 1]}">${typeName(t)}</span>`;
  const mulText = m => (Math.round(m * 100) / 100).toString();
  const mulCls = m => (m >= 1.9 ? 'x4' : m > 1 ? 'x2' : m === 1 ? '' : m >= 0.69 ? 'xh' : m >= 0.49 ? 'xq' : 'x0');

  function typeChart() {
    const T = DATA.types.map((_, i) => i + 1);
    const head = `<tr><th class="corner">공격 ↓ / 방어 →</th>${T.map(t => `<th style="background:${TYPE_COLORS[t - 1]}" title="${typeName(t)}">${short(t)}</th>`).join('')}</tr>`;
    const rows = T.map(a => `<tr><th style="background:${TYPE_COLORS[a - 1]}">${typeName(a)}</th>${T.map(d => {
      const m = typeEff(a, [d]);
      return `<td class="${mulCls(m)}" title="${typeName(a)} → ${typeName(d)}: ×${mulText(m)}">${m === 1 ? '' : mulText(m)}</td>`;
    }).join('')}</tr>`).join('');
    return `<p>이 게임은 원작 불가사의 던전처럼 상성 배율이 완만합니다.</p>
      <div class="legend"><span class="x2">1.4 효과가 굉장함</span><span class="xh">0.7 효과가 별로</span><span class="xq">0.5 원래 무효인 상성 (약하게 맞음)</span>
      <span class="dim">타입이 2개면 곱합니다. 예) 1.4×1.4=1.96, 0.7×0.7=0.49</span></div>
      <div class="chart-wrap"><table class="type-chart">${head}${rows}</table></div>
      <h3>타입 조합 계산기</h3>
      <div class="picker-bar"><select id="gc-a">${T.map(t => `<option value="${t}">${typeName(t)}</option>`).join('')}</select>
        <select id="gc-b"><option value="">(단일 타입)</option>${T.map(t => `<option value="${t}">${typeName(t)}</option>`).join('')}</select></div>
      <div id="gc-out"></div>
      <p class="dim">특성에 의한 무효(부유, 저수, 불가사의부적 등)는 따로 적용되어 완전히 막힙니다. 날씨·특성·지닌 물건 보정은 여기에 더 곱해집니다.</p>`;
  }
  function calcCombo(box) {
    const a = +box.querySelector('#gc-a').value, b = +box.querySelector('#gc-b').value;
    const types = b && b !== a ? [a, b] : [a];
    const groups = {};
    DATA.types.forEach((_, i) => { const m = typeEff(i + 1, types); (groups[mulText(m)] = groups[mulText(m)] || []).push(i + 1); });
    const order = Object.keys(groups).sort((x, y) => y - x);
    box.querySelector('#gc-out').innerHTML = `<table class="combo">${order.filter(k => k !== '1').map(k => `<tr><td class="${mulCls(+k)}">×${k}</td><td>${groups[k].map(badge).join(' ')}</td></tr>`).join('')}</table>`;
  }

  function battle() {
    return `<table class="rules">
      <tr><td>데미지</td><td>원작과 같은 계산식 (레벨·위력·공격/방어). 자기 타입 기술은 <b>1.5배</b> (적응력 2배).</td></tr>
      <tr><td>일반 공격</td><td>타입 없는 위력 ${NORMAL_ATTACK.p} 물리 공격. PP를 쓰지 않는다.</td></tr>
      <tr><td>급소</td><td>기본 1/16 확률, <b>1.5배</b> (스나이퍼 2.25배). 급소율 단계: 1/16 → 1/8 → 1/2 → 확정.</td></tr>
      <tr><td>능력 단계</td><td>−6 ~ +6. 공격·방어·특공·특방은 +1마다 0.25배씩 (+2에 1.5배, +4에 2배, 최대 +6에 2.5배 / −6에 0.4배) / 스피드는 단계 차이 1마다 명중 ×1.05 곱연산 (+6이면 내 명중 ×1.34, 나를 노리는 공격 ÷1.34) / 명중·회피는 +1마다 1.33배. 처음 오르거나 내린 뒤 100턴이 지나면 원래대로 (더 쌓아도 남은 턴은 늘지 않는다) (층을 내려가도 유지).</td></tr>
      <tr><td>스피드</td><td>상대보다 빠를수록 명중률이 오르고 상대 공격을 잘 피한다. <b>2배 빠르면 +20%, 절반이면 −20%</b> (최대 ±20%). 마비는 스피드 절반. "반드시 명중" 기술은 영향 없음.</td></tr>
      <tr><td>혼자 탐험 보정</td><td>동료 없이 들어가면 적에게 받는 데미지 ${SOLO_DMG_MUL}배, HP를 뺀 능력치 ${SOLO_STAT_MUL}배. 동료와 함께 들어가면 (모두 쓰러져도) 보정 없음.</td></tr>
      <tr><td>🤝 동료</td><td>영입한 포켓몬을 최대 3마리까지 데리고 갈 수 있다. 자세한 내용은 가이드의 <b>🤝 동료</b> 항목.</td></tr>
      <tr><td>기술 범위</td><td>앞 1칸 (선공기는 앞 2칸) / 원거리(직선 5칸의 첫 적) / 주변 3칸의 모든 적 / 자신.</td></tr>
      <tr><td>반동 기술</td><td>반동 데미지는 원작의 <b>절반</b>. 자폭·대폭발은 기절 대신 HP 1.</td></tr>
      <tr><td>특수 기술</td><td>모으기·반동·난동·첫 공격 전용 등 원작 조건은 던전에 맞게 재해석. 기술 설명의 <b>⚑ 던전 규칙</b> 참고.</td></tr>
      <tr><td>특성</td><td>원작 효과 또는 던전용 효과. 특성 설명의 <b>⚑ 던전 규칙</b> 참고. 발동하면 로그에 [특성 이름]이 표시된다.</td></tr>
    </table>`;
  }

  function status() {
    return `<table class="rules">
      <tr><td>☠ 독</td><td>2턴마다 최대 HP의 1/14 데미지. 15턴 지속. 독·강철 타입은 걸리지 않는다.</td></tr>
      <tr><td>🔥 화상</td><td>2턴마다 최대 HP의 1/14 데미지 + 물리 공격 절반. 15턴 지속. 불꽃 타입은 걸리지 않는다.</td></tr>
      <tr><td>⚡ 마비</td><td>25% 확률로 행동 불가, 스피드 절반. 15턴 지속. 전기 타입은 걸리지 않는다.</td></tr>
      <tr><td>💤 잠듦</td><td>3~5턴 행동 불가.</td></tr>
      <tr><td>❄ 얼음</td><td>2~4턴 행동 불가. 공격받으면 30% 확률로 녹는다. 얼음 타입·쾌청일 때는 걸리지 않는다.</td></tr>
      <tr><td>? 혼란</td><td>4~7턴 동안 50% 확률로 엉뚱한 방향으로 이동·공격.</td></tr>
      <tr><td>풀죽음</td><td>다음 한 번의 행동을 못 한다.</td></tr>
      <tr><td>회복</td><td>치료씨·회복약으로 즉시 회복. 시간이 지나면 자연히 낫는다.</td></tr>
    </table>`;
  }

  function weather() {
    return `<table class="rules">${Object.values(WEATHERS).map(w => `<tr><td>${w.icon} ${w.n}</td><td>${esc(w.d)}</td></tr>`).join('')}</table>
      <h3>던전별 날씨 (층마다 확률)</h3>
      <table class="rules">${DUNGEONS.filter(d => !d.daily && d.wx && d.wx.length).map(d => `<tr><td>${esc(d.n)}</td><td>${d.wx.map(([w, p]) => `${WEATHERS[w].icon}${WEATHERS[w].n} ${Math.round(p * 100)}%`).join(' · ')}</td></tr>`).join('')}</table>
      <p class="dim">가뭄·잔비·모래날림·눈퍼뜨리기 특성은 날씨를 바꾸고, 날씨부정·에어록(플레이어)은 날씨 효과를 없앤다.</p>`;
  }

  function dungeon() {
    return `<table class="rules">
      <tr><td>배고픔</td><td>턴마다 0.08씩 줄어든다 (설경에서 얼음 타입이 아니면 1.5배). 0이 되면 턴마다 HP가 1씩 준다.</td></tr>
      <tr><td>자연 회복</td><td>배가 차 있으면 조금씩 HP가 회복된다. 재생력·먹다남은음식 등으로 빨라진다.</td></tr>
      <tr><td>잠든 적</td><td>층에 처음 있던 적 중 일부는 제자리에서 잠들어 있다. 공격받으면 깨고, 탐험대가 바로 옆에 가면 가끔 깬다.</td></tr>
      <tr><td>던전의 포켓몬</td><td>던전마다 컨셉에 맞는 포켓몬이 주로 나온다 (층마다 6종 중 ${CONCEPT_SHARE}종). 같은 진화 계열이면 깊은 층일수록 진화한 모습. 나머지는 던전 타입에 맞는 포켓몬. 울트라비스트는 울트라 차원의 틈에서만. 도감의 🗺 나오는 곳에서 확인.</td></tr>
      <tr><td>적 등장</td><td>30~45턴마다 보이지 않는 곳에 새 적이 나타난다.</td></tr>
      <tr><td>함정</td><td>층의 적 레벨 <b>${FEATURE_LV.trap}</b> 이상에서 등장. 숨겨져 있다가 밟거나 옆에서 발견(20%)하면 보인다. 자동 탐색은 발견한 함정을 피한다.
        <div class="dim">${Object.values(TRAPS).map(t => `${t.icon} ${t.n}: ${t.d}`).join('<br>')}</div></td></tr>
      <tr><td>몬스터 하우스</td><td>적 레벨 <b>${FEATURE_LV.house}</b> 이상에서 ${Math.round(HOUSE_CHANCE * 100)}%. 아이템이 많은 방에 들어가면 적 6~9마리가 나타난다. 나타난 턴에는 행동하지 않는다.</td></tr>
      <tr><td>켈리몬 상점</td><td>적 레벨 <b>${FEATURE_LV.shop}</b> 이상에서 ${Math.round(SHOP_CHANCE * 100)}%. 진열된 물건 위에 서면 사고, 켈리몬에게 말을 걸면 판다.</td></tr>
      <tr><td>계단</td><td>밟으면 다음 층으로 갈지 묻는다. 마지막 층의 계단은 출구.</td></tr>
      <tr><td>보스 층</td><td>일반 던전의 마지막 층, 로그라이크는 10층마다와 마지막 층. 큰 방에서 보스(HP 3.5배)와 부하 둘이 기다린다. 보스를 쓰러뜨려야 계단이 나타나고, 돈과 좋은 아이템을 얻는다. 보스는 상태이상이 절반만 지속되고, 최대 HP에 비례하는 데미지(독·화상·모래바람·까칠한피부·울퉁불퉁멧·함정 등)도 절반만 받는다.</td></tr>
      <tr><td>바람</td><td>한 층에 ${WIND.warn[0]}턴 넘게 머물면 바람이 불기 시작하고, ${WIND.limit}턴이 되면 던전 밖으로 날려간다 (쓰러진 것과 같은 패널티).</td></tr>
      <tr><td>탈출</td><td>탈출구슬을 쓰거나, 임무를 완료하면 바로 마을로 돌아갈 수 있다.</td></tr>
    </table>`;
  }

  function growth() {
    return `<table class="rules">
      <tr><td>경험치</td><td>쓰러뜨린 적의 레벨이 내 레벨보다 낮을수록 줄어든다 (5세대식). 내 레벨보다 ${LOW_LV_GAP} 이상 낮은 적은 기본 배율 ${EXP_RATE}배 대신 ${LOW_LV_MUL}배. 보스·수배범 ${BOSS_EXP_MUL}배, 행복의알 1.5배, 로그라이크 던전 ${ROGUE_EXP_MUL}배. 전설·환상은 필요 경험치 ${LEGEND_EXP_DIV}배, 울트라비스트·패러독스 ${STRONG_EXP_DIV}배 (도감에서 포켓몬마다 확인).</td></tr>
      <tr><td>아이템 단계</td><td>던전 바닥·적이 떨어뜨리는 아이템은 층의 적 레벨에 따라 단계별 표가 따로 있다: ${DROP_STAGE_NAMES.map((n, i) => `${n} Lv${DROP_STAGE_LV[i]}+`).join(' · ')}. 예) 초반에는 오랭열매, 중반에는 자뭉열매·좋은상처약, 후반·최종에는 자뭉열매·회복약. 자세한 표는 '던전 아이템 단계'에서.</td></tr>
      <tr><td>전용 도구</td><td>금강옥·전기구슬처럼 정해진 포켓몬만 쓰는 도구. 그 포켓몬이 나오는 던전에서만 드물게 떨어지고(보스가 주인이면 ${Math.round(SIG_DROP.boss * 100)}%), 마을 상점에 가끔 진열된다.</td></tr>
      <tr><td>진화</td><td>마을의 캐릭터 탭에서. 레벨 진화는 레벨만, 아이템 진화는 진화의돌, 통신 진화는 연결의끈이 필요. 그 외 조건(친밀도 등)은 Lv25.</td></tr>
      <tr><td>다른 모습 · 메가진화</td><td>던전에서 모습이 바뀌면 능력치·타입·특성이 그 모습의 것이 된다 (기술은 그대로). 도감에서 포켓몬마다 확인.<br>
        <b>모습 고르기</b> 로토무·테오키스·쉐이미·큐레무 등은 캐릭터 탭에서 고른다. <b>도구</b> 백금옥·녹슨검·가면·쪽빛구슬 등을 지니면 그 모습.
        <b>메가진화</b> 그 포켓몬의 메가스톤을 지니면 층에 들어설 때 메가진화 (메가스톤은 Lv${MEGA_MIN_LV} 이상인 층·보스·이로치에게서 아주 드물게, 던전 타입에 맞는 것만). <b>던전에서 변신</b> 캐스퐁·킬가르도·약어리·메테노 등은 특성에 따라 바뀐다.</td></tr>
      <tr><td>기술</td><td>레벨업으로 배우고, 마을의 기술 설정에서 배운 기술 중 4개를 자유롭게 고른다. 기술머신으로 배운 기술도 영구히 기억한다. 진화해도 진화 전에 배우던 기술을 계속 고를 수 있다. 기술머신은 던전 타입과 같은 타입의 기술만 나온다.</td></tr>
      <tr><td>⭐ 기술 숙련도</td><td>탐험대(나와 동료)의 기술이 적에게 맞을 때마다 (자신에게 쓰는 기술은 쓸 때마다) 그 포켓몬의 그 기술 숙련도가 오른다. 허공에 쓰거나 빗나가면 오르지 않는다 (기술을 빼도 남고, 로그라이크에서도 쌓이고 적용된다). ★1~★10: ★마다 PP 최대치 +${MASTERY_PP * 100}%, ${MASTERY_FREE * 100}% 확률로 PP를 쓰지 않음 (★10이면 PP 2배, 30%). 다음 ★까지 필요한 횟수는 기본 PP의 절반 × 단계라서 PP가 적은 기술도 비슷한 속도로 오른다. 기술 정보 창에서 진행도 확인.</td></tr>
      <tr><td>특성 / 지닌 물건</td><td>캐릭터 탭에서 특성을 바꿀 수 있다. 일반 특성으로 바꾸려면 ⚗특성캡슐, 숨겨진 특성으로 바꾸려면 🧩특성패치가 하나 필요하다 (상점에 가끔 진열, 던전에서 드물게 발견). 지닌 물건은 하나 지닌다.</td></tr>
      <tr><td>교배기술</td><td>캐릭터 탭에서 🧬교배기술머신을 하나 쓰면 그 포켓몬(진화 전 모습 포함)의 교배기술 중 하나를 배운다. 배운 기술은 기술 설정에서 언제든 넣고 뺄 수 있다 (상점에 가끔 진열, 던전에서 드물게 발견).</td></tr>
      <tr><td>일반 던전에서 쓰러지면</td><td>레벨 유지. 가방 아이템의 <b>절반</b>(무작위)과 지닌 물건(50%), 이번 탐험에서 주운 돈을 잃는다. 점착 특성이면 1/4.</td></tr>
      <tr><td>로그라이크 던전</td><td>Lv${ROGUE_LEVEL}, 기본 가방(오랭열매 2, 사과 1)으로 입장. 지닌 물건은 그대로 지니고 들어가고 쓰러져도 잃지 않는다 (메가스톤·전용 도구도 쓸 수 있다). 나오면 원래대로. 클리어·탈출하면 주운 돈과 아이템(창고로)을 가져온다.</td></tr>
      <tr><td>임무</td><td>구조(의뢰인에게 말 걸기) / 수배(강한 적 쓰러뜨리기) / 탐색(의뢰품 줍기). 완료 후 마을로 돌아오면 보상.</td></tr>
      <tr><td>👑 테마 던전</td><td>같은 시리즈로 묶이는 포켓몬이 보스로 나온다. 중간 보스 층에서는 시리즈 멤버가(한 탐험에서 겹치지 않게), 마지막 층에서는 최종 보스 후보 중 하나가 무작위로 나온다.
      <tr><td>✨ 숨은 던전</td><td>어떤 던전을 클리어하면 몰래 열리는 던전 (6곳). 환상의 포켓몬이 보스로 나온다. 열리기 전에는 목록에 보이지 않고, 메달 진행도에는 들어가지 않는다.</td></tr>
      <tr><td>📖 이야기</td><td>1부: 보물마을 주변에 미궁이 생겨나고, 탐험대는 그 힘을 쫓아 별의 정상에서 아르세우스를 만난다. 2부: 정상의 힘에 끌려 떨어진 운석(지라치·테오키스)을 따라 하늘의 틈에 닿고, 빛을 삼킨 네크로즈마와 마주한다. 3부: 빛이 돌아오자 시간이 뒤틀려 에리어 제로가 열리고, 그 바닥에서 테라파고스를 만난다. 각지의 전설은 이변에 반응해 테마 던전의 보스로 깨어난다.</td></tr>
        ${DUNGEONS.filter(d => d.theme).map(d => `${esc(d.n)}(${esc(d.theme)})`).join(', ')}.</td></tr>
      <tr><td>🆘 친구 구조</td><td>일반 던전에서 쓰러지면 SOS 코드로 친구에게 구조를 요청할 수 있다 (한 번에 하나). 기다리는 동안 패널티 없이 다른 던전을 탐험할 수 있다.
        친구가 임무 탭에 SOS 코드를 넣으면 구조 임무가 생기고 (그 던전이 열려 있어야 함), 그 층에서 말을 걸면 구조 성공 → A-OK 코드.
        A-OK 코드를 넣으면 쓰러진 층부터 이어서 탐험. 구조한 친구는 구조한 그 자리에서 구조 보답(무작위 아이템·돈)을 받는다.</td></tr>
      <tr><td>☁ 계정</td><td>로그인은 선택이다. 로그인하면 세이브가 클라우드에도 저장되어 다른 기기에서 이어할 수 있다 (던전을 마치고 돌아올 때, 창을 닫거나 다른 탭으로 갈 때, 마을에서는 30분마다 자동 저장. 이 브라우저에는 매번 바로 저장).
        이메일을 받지 않으므로 비밀번호를 잊으면 찾을 수 없다.</td></tr>
      <tr><td>📋 구조 게시판</td><td>로그인한 상태에서 쓰러져 구조를 요청하면 게시판에 올라간다. 같은 버전의 다른 플레이어가 임무 탭의 게시판에서 골라 구조하러 갈 수 있고,
        게시판에는 가장 오래 기다린 요청 10개가 보이고, 누가 구조하러 가면 그 요청은 30분 동안 다른 사람에게 보이지 않는다 (구조하러 던전에 들어가 있는 동안은 연장) (게시판 구조는 한 번에 2개까지).
        구조하고 마을로 돌아오면 요청자가 되살아나고, 구조한 사람은 구조 보답(무작위 아이템 + 돈)을 바로 받는다. 감사 편지(선물)는 요청자가 보내면 더 온다. 30분 동안 아무도 구조하러 오지 않으면 구린내 탐험대가 대신 구조해 준다 (감사 선물 없음). 구조 실패는 없다. 게시판에는 올린 지 48시간까지만 보인다.</td></tr>
      <tr><td>🥤 영양제</td><td>맥스업(HP +4)·타우린(공격)·사포닌(방어)·리보플라빈(특공)·키토산(특방)·알칼로이드(스피드) 각 +2. 캐릭터 탭에서 먹이면 그 포켓몬에게 영구히 남고, 능력치마다 ${VITAMIN_MAX}번까지. 일반 던전에서만 적용된다. 상점(가끔)·던전 바닥·보스·업적 보상으로 얻는다.</td></tr>
      <tr><td>🍬 구미</td><td>아주 드문 간식. 먹으면 배가 15 차고 (무지개구미는 30), 능력치가 영구히 오른다: 하양 HP +2, 빨강 공격 +1, 노랑 방어 +1, 파랑 특공 +1, 초록 특방 +1, 분홍 스피드 +1, 무지개 전부. 능력치마다 ${GUMMY_MAX}번까지 (영양제와 따로 셈). 로그라이크에서 먹으면 그 탐험 동안만.</td></tr>
      <tr><td>🎀 전용 도구</td><td>굵은뼈(탕구리·텅구리), 전기구슬(피카츄), 심해의이빨/비늘(진주몽), 금속/스피드파우더(메타몽), 럭키펀치(럭키), 대파(파오리·창파나이트), 마음의물방울(라티아스·라티오스), 금강옥·백옥·백금옥(디아루가·펄기아·기라티나). 정해진 포켓몬만 효과가 있다.</td></tr>
      <tr><td>🗓 오늘의 도전</td><td>날짜마다 바뀌는 ${Progress.DAILY.floors}층 로그라이크. 그날 정해진 포켓몬(Lv${ROGUE_LEVEL})으로 도전하고, 같은 날이면 누구나 같은 맵이 나온다. 하루 한 번. 도달한 층 × ₽${Progress.DAILY_REWARD.floor} (완주 +₽${Progress.DAILY_REWARD.clear}). 기록은 던전 탭에서 공유.</td></tr>
      <tr><td>🏆 업적 / 도감</td><td>업적을 달성하면 돈과 아이템(창고로)을 받는다. 도감은 만난 포켓몬과 쓰러뜨린 포켓몬을 기록한다.</td></tr>
      <tr><td>가방 / 창고</td><td>가방 ${BAG_BASE}칸, 창고 ${STORAGE_BASE}칸에서 시작해 돈으로 확장 (가방 최대 ${BAG_LIMIT}, 창고 최대 ${STORAGE_LIMIT}).</td></tr>
    </table>`;
  }

  // 동료: 고르기·성장·행동·작전·아이템
  function party() {
    return `<table class="rules">
      <tr><td>✨ 이로치</td><td>적이 ${Math.round(1 / SHINY_CHANCE)}분의 1 확률로 색이 다른 모습으로 나타난다. 리더가 빛나는부적(도감 완성 업적 보상)을 지니면 2배. 쓰러뜨리면 경험치 2배와 좋은 아이템. 보스도 이로치로 나올 수 있다. 어떤 포켓몬의 이로치를 쓰러뜨리거나 영입하면, 그 포켓몬과 같은 진화 계열(진화 전·후 모두)의 이로치 모습을 캐릭터 탭에서 고를 수 있다.</td></tr>
      <tr><td>🤝 영입</td><td>탐험대가 쓰러뜨린 적이 가끔 동료가 되고 싶어 한다. 영입하면 Lv${RECRUIT_LEVEL}로 캐릭터 목록에 들어가고, 마을에서 바꿔 플레이할 수 있다. 영입한 그 포켓몬 하나만 들어온다 (진화 전 모습은 따로 생기지 않는다). 친구리본을 지니면 확률 1.5배.
        확률은 내 레벨에 따라: Lv10 ${(recruitRate(10) * 100).toFixed(0)}% · Lv30 ${(recruitRate(30) * 100).toFixed(0)}% · Lv50 ${(recruitRate(50) * 100).toFixed(0)}% · Lv70 ${(recruitRate(70) * 100).toFixed(0)}% · Lv90 ${(recruitRate(90) * 100).toFixed(0)}% (Lv${MAX_LEVEL}에서 최대 ${(recruitRate(MAX_LEVEL) * 100).toFixed(1)}%, 친구리본을 지니면 ${(recruitRate(MAX_LEVEL) * 1.5 * 100).toFixed(1)}%). 탐험대 등급이 오를 때마다 +1%p (마스터 +${(RANKS.length - 1) * RECRUIT_RANK_BONUS * 100}%p, 레벨 확률에 더한 뒤 전설·친구리본 배율을 곱한다). ${RECRUIT_HALF}. 수배범과 이미 영입한 포켓몬은 나오지 않는다.</td></tr>
      <tr><td>고르기</td><td>던전에서 영입한 포켓몬 중 최대 <b>3마리</b> (나 포함 4명). 캐릭터 탭 아래쪽이나 마을 왼쪽 캐릭터 카드의 <b>🤝 동료</b>에서 추가·빼기.</td></tr>
      <tr><td>함께 가는 곳</td><td>일반·테마 던전. 로그라이크와 오늘의 도전은 혼자 간다.</td></tr>
      <tr><td>동료 관리</td><td>마을 왼쪽 캐릭터 카드 아래에서 동료마다 능력치·특성·지닌 물건·기술 확인, <b>📘 기술</b>·<b>지닌 물건</b> 바꾸기.</td></tr>
      <tr><td>성장</td><td>각자 저장된 레벨로 간다. 탐험대가 적을 쓰러뜨리면 동료도 경험치를 받는다 (동료가 쓰러뜨려도 같다). 레벨이 오르면 새 기술은 빈 칸에만 들어가고, 나머지는 마을의 기술 설정에서 고른다. 진행은 층마다 저장된다.</td></tr>
      <tr><td>따라오기</td><td>리더 뒤에 줄지어 따라온다. 리더가 동료 쪽으로 움직이면 자리를 바꾼다 (자동 이동도 동료와 자리를 바꾸며 지나간다). 멀리 떨어진 동료는 한 턴에 두 칸씩 따라붙는다.</td></tr>
      <tr><td>공격</td><td>동료는 스스로 기술을 골라 싸운다. 탐험대의 직선 기술과 던진 도구는 동료를 지나간다. 적의 범위 기술은 동료에게도 맞는다. 잠든 적은 건드리지 않는다 (적을 공격해 작전 제외).</td></tr>
      <tr><td>🤝 동료 창 (V)</td><td>던전의 🤝 동료 버튼이나 V 키, 메뉴에서 연다. 동료의 HP·상태이상·나와의 거리·특성·지닌 물건·능력 변화·기술 PP 확인, 작전 바꾸기, 아이템 쓰기, 되살리기.</td></tr>
      <tr><td>작전</td><td>탐험마다 <b>나를 따라와</b>로 시작하고, 동료 창에서 바꾼다.<br>
        <b>나를 따라와</b> — 줄지어 따라오고, 나나 동료 가까이 온 적을 가까운 것부터 처리하고 다시 따라온다<br>
        <b>각자 행동</b> — 보이는 적을 각자 쫓아가 싸우고, 적이 없으면 근처로 모인다<br>
        <b>여기서 기다려</b> — 그 자리에서 기다린다. 옆에 온 적에게만 반격한다<br>
        <b>적을 공격해</b> — 멀리 있는 적도 쫓아가 공격한다. 보스가 보이면 보스부터 (보스 방에서 유용)<br>
        <b>먼저 공격하지마</b> — 리더가 공격한 적만 상대하고, 그 밖에는 따라오기만 한다</td></tr>
      <tr><td>아이템</td><td>가방에서 아이템을 고르고 <b>동료에게 쓴다</b>, 또는 동료 창의 <b>동료에게 아이템 쓰기</b>. 회복(오랭열매·자뭉열매·상처약·회복약), 상태이상 회복(치료씨·리샘열매·각종 열매), PP 회복(맥스엘릭서·과사열매). 한 턴을 쓴다.</td></tr>
      <tr><td>시야</td><td>동료가 있는 방과 주변도 보이고 지도에 기록된다.</td></tr>
      <tr><td>회복</td><td>리더의 배가 고프지 않으면 동료도 리더와 같은 속도로 HP가 조금씩 찬다.</td></tr>
      <tr><td>쓰러지면</td><td>동료는 그 탐험에서만 빠진다 (레벨·경험치는 남는다). 부활씨로 되살릴 수 있다 (가방의 부활씨 → 쓰러진 동료를 되살린다, 또는 동료 창). 리더가 쓰러지면 탐험이 끝난다 (구조 요청 가능). 구조받아 이어서 탐험하면 동료도 다시 함께 간다.</td></tr>
      <tr><td>혼자 탐험 보정</td><td>동료 없이 들어가면 적에게 받는 데미지 ${SOLO_DMG_MUL}배, HP를 뺀 능력치 ${SOLO_STAT_MUL}배. 동료와 함께 들어가면 (모두 쓰러져도) 보정 없음.</td></tr>
    </table>`;
  }

  // 단계별 드롭표: 단계마다 나오는 아이템과 비율 (기술머신·지닌 물건은 묶음, 아이템은 눌러서 도감으로)
  function items() {
    const chip = (id, w) => `<span class="dg-item" data-dexitem="${id}">${ITEMS[id].icon} ${esc(ITEMS[id].n)}${w != null ? ` <i class="dim">${w >= 1 ? w : w.toFixed(2)}%</i>` : ''}</span>`;
    const rows = DROP_STAGE_NAMES.map((name, st) => {
      const lv = DROP_STAGE_LV[st], t = baseTable(lv + (st === 1 ? 10 : 0), null);   // 중반은 쇠가시→금바늘이 바뀌는 Lv30 이후 기준
      const total = t.reduce((a, d) => a + d[1], 0), pct = w => +(w / total * 100 * (1 - MONEY_SHARE[st])).toFixed(w / total >= 0.01 ? 1 : 2);
      const one = t.filter(([id]) => !ITEMS[id].tm && !ITEMS[id].held && !VITAMINS[id] && !GUMMIES[id]).sort((a, b) => b[1] - a[1]);
      const sum = f => t.filter(([id]) => f(id)).reduce((a, d) => a + d[1], 0);
      return `<tr><td><b>${name}</b><br><span class="dim">적 Lv${lv}+ 층</span></td><td>
        <div class="dg-items">${one.map(([id, w]) => chip(id, pct(w))).join('')}</div>
        <div class="dim">영양제·구미 ${pct(sum(id => VITAMINS[id] || GUMMIES[id]))}% · 🎗 지닌 물건 ${pct(sum(id => ITEMS[id].held))}% · 💿 기술머신 ${pct(sum(id => ITEMS[id].tm))}% (던전 타입의 기술만) · 💰 돈 ${MONEY_SHARE[st] * 100}%</div></td></tr>`;
    }).join('');
    return `<p>던전 바닥과 적이 떨어뜨리는 아이템은 <b>층의 적 레벨</b>에 따라 단계별 표에서 나온다. 단계가 바뀌면 앞 단계의 흔한 물건은 줄거나 나오지 않는다.
      던지는 가시는 적 Lv${ITEM_LV_RANGE.goldthorn[0]} 전까지 ${ITEMS.thorn.n}, 그 뒤로 ${ITEMS.goldthorn.n}. 강한 지닌 물건(생명의구슬 등)은 후반부터.
      아이템을 누르면 설명을 볼 수 있다. 던전마다 실제로 나오는 아이템과 확률은 던전 카드의 ℹ 정보에서 확인.</p>
      <table class="rules">${rows}
      <tr><td><b>로그라이크</b></td><td>단계를 적 레벨 대신 층 진행으로 정한다: 전체 층을 넷으로 나눠 초반 → 중반 → 후반 → 최종. PP가 모자라기 쉬워서 과사열매 ${ROGUE_DROP_MUL.leppa}배, 맥스엘릭서 ${ROGUE_DROP_MUL.elixir}배, 영양제·구미 ${ROGUE_RARE_MUL}배 더 잘 나온다. 경험치도 ${ROGUE_EXP_MUL}배.</td></tr>
      <tr><td><b>♾️ 메가스톤</b></td><td>Lv${MEGA_MIN_LV}+ 층·보스·이로치에서만, 던전 타입에 맞는 것. 보스·이로치 ${MEGA_RATE.boss * 100}%, 바닥·적 드롭·구조 보답 ${MEGA_RATE.floor * 100}%</td></tr>
      <tr><td><b>🎀 전용 도구</b></td><td>주인 포켓몬이 나오는 던전에서만: 바닥 ${SIG_DROP.floor * 100}% · 쓰러뜨린 주인 ${SIG_DROP.defeat * 100}% · 주인이 보스면 ${SIG_DROP.boss * 100}%</td></tr>
      </table>`;
  }

  function open(topic) {
    if (topic === 'controls') { Dungeon.showHelp(); return; }
    const t = TOPICS.find(x => x[0] === topic);
    const body = { types: typeChart, battle, status, weather, dungeon, growth, items, party }[topic]();
    UI.open({
      title: t[1], wide: true, html: `<div class="guide">${body}</div>`,
      choices: [{ label: '다른 항목 보기', fn: menu }, { label: '닫기', fn: () => {} }],
      onOpen: box => {
        if (topic !== 'types') return;
        box.querySelector('#gc-a').onchange = box.querySelector('#gc-b').onchange = () => calcCombo(box);
        calcCombo(box);
      },
    });
  }
  function menu() {
    UI.open({ title: '📖 게임 가이드', choices: TOPICS.map(([k, n]) => ({ label: n, fn: () => open(k) })) });
  }
  const buttons = () => TOPICS.map(([k, n]) => `<button class="btn ghost" data-act="guide" data-arg="${k}">${n}</button>`).join(' ');
  return { open, menu, buttons };
})();
