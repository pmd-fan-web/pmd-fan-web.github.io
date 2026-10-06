배경음악 파일을 이 폴더에 넣으면 합성 배경음 대신 재생됩니다.
확장자: ogg / mp3 / m4a / wav (예: town.ogg). 파일이 없는 곳은 합성 배경음이 나옵니다.

루프 구간 (인트로 뒤 반복 구간만 반복):
- 파일 안의 루프 정보를 자동으로 읽습니다: OGG의 LOOPSTART / LOOPLENGTH(또는 LOOPEND) 태그, WAV의 smpl 청크.
  (vgmstream 등으로 뽑은 파일에 흔히 들어 있습니다)
- 없으면 loops.js에 초 단위로 적습니다. 예) town: [12.345, 98.765]
- 게임 안의 정보 탭 → 배경음악 파일 → 🔁 루프 에서 들어 보며 맞출 수도 있습니다 (그 브라우저에만 저장, loops.js보다 우선).
- 게임을 index.html 더블클릭(file://)으로 열면 브라우저 제한 때문에 파일 안의 루프 정보를 읽지 못합니다.
  배포할 때는 loops.js에 루프 값을 적어 두는 것을 권장합니다.

title     타이틀 화면 (없으면 town)
town      마을
boss      보스전
dungeon   던전 공통 (던전별 파일이 없을 때)
(오늘의 도전은 날마다 던전 곡 중 하나를 골라 틉니다)
forest    작은 숲
beach     해변 동굴
crystal   수정 동굴
plains    번개 초원
swamp     독안개 늪
volcano   불꽃 화산
desert    유사 사막
frost     얼음 산
storm     폭풍의 바다
dark      어둠의 숲
mine      강철 광산
sky       하늘의 탑
canyon    용의 협곡
summit    별의 정상
trial     시련의 동굴
twilight  황혼의 미궁
mystery   불가사의 던전
burned    불탄 탑
whirl     소용돌이 섬
seafloor  해저 동굴
ruins     고대 유적
shrine    재앙의 사당
altar     해와 달의 제단
coronet   천관산
spiral    용의 나선탑
areazero  에리어 제로
skyplain  풍요의 하늘길
twofist   쌍권의 탑
crown     왕관의 설원
watercity 물의 도시
genelab   유전자 연구소
kalos     생명과 파괴의 숲
hero      영웅의 숲
meteor    운석 낙하지점
ultra     울트라 차원의 틈
zerodeep  에리어 제로 최심부
flower    꽃의 낙원 (숨은 던전)
crescent  초승달 섬 (숨은 던전)
crystaldeep 수정 동굴 심층 (숨은 던전)
factory   고대 공장 (숨은 던전)
seatemple 바다의 신전 (숨은 던전)
magma     불꽃 산 심층 (숨은 던전)

특별한 순간 (파일이 없으면 지금 곡 그대로)
outlaw        수배범을 발견했을 때 · 켈리몬 상점에서 도둑질했을 때 (다 쓰러뜨리거나 층을 옮기면 원래 곡)
monsterhouse  몬스터하우스 (다 쓰러뜨리면 원래 곡)

이야기 장면 (js/scenes.js의 bgm·departBgm·introBgm)
guild         길드 (마을 이야기 기본)
wigglytuff    길드장 · 승급식 · 프롤로그
teamskull     구린내 탐험대 (1장·5장)
jobclear      축하 (1부·2부 마지막 장)
legend        보스가 나타날 때의 이야기 기본
fear          불안한 장면 (10장 출발 전 등)

팡파르 (한 번만, 그동안 배경음을 줄인다. 없으면 합성 효과음)
rankup     탐험대 승급 창
bigreward  승급 선물 창
reward     임무 완료 · 친구 구조 완료 · 운영 선물
