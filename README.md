# 미궁 탐험대

포켓몬 불가사의 던전 시리즈에서 영감을 받은 **비공식·비상업 웹 팬 게임**입니다. 공식 제품과 관련이 없습니다.

### ▶ [지금 플레이하기 — pmd-fan-web.github.io](https://pmd-fan-web.github.io/)
설치 없이 PC·휴대폰 브라우저에서 바로 할 수 있어요. 로그인은 선택입니다.

| 마을 | 던전 | 도감 |
|---|---|---|
| ![마을](docs/town.jpg) | ![던전 (메가리자몽X)](docs/dungeon.jpg) | ![도감 (로토무의 다른 모습)](docs/dex.jpg) |

## 어떤 게임인가요?
- 턴제 로그라이크 던전 탐험: 내가 한 칸 움직이면 적도 한 칸 움직여요. 층마다 지도·아이템·적이 새로 만들어집니다.
- **포켓몬 1,028종**을 모두 골라 플레이할 수 있어요. 리전폼 57종, 메가진화 40종, 로토무·기라티나 등 다른 모습도 있어요.
- 기술 550여 개와 특성은 던전에 맞게 다시 만들었어요. 캐스퐁은 날씨에 따라, 킬가르도는 공격할 때 모습이 바뀌어요.
- 던전 27곳: 일반 던전 14곳, 전설 포켓몬이 보스인 테마 던전 9곳, 로그라이크 던전 4곳(최대 100층), 그리고 날마다 바뀌는 **오늘의 도전**.
- 쓰러뜨린 적이 가끔 동료가 되고 싶어 해요. 영입한 포켓몬으로 바꿔 플레이할 수 있어요.
- 임무 게시판, 상점, 창고, 기술머신, 영양제·구미, 진화, 업적 36개, 도감.
- **구조 게시판** (로그인 시): 던전에서 쓰러지면 구조 요청을 올리고, 다른 탐험대가 구하러 와 줄 수 있어요.

## 조작
| | PC | 휴대폰 |
|---|---|---|
| 이동 | 방향키 / WASD / 숫자패드 (두 키 동시에 대각선) | 오른쪽 아래 방향 버튼, 화면의 칸 누르기 |
| 방향만 바꾸기 | Shift + 방향 | 가운데 ↻ 버튼 뒤 방향 |
| 공격 · 기술 | Space · 1~4 | 아래 버튼 |
| 자동 탐색 · 자동 전투 | O · Tab | 버튼 |
| 가방 · 지도 · 조사 | I · N · K | 버튼 |

자세한 규칙은 게임 안의 **정보 → 게임 가이드**에 있어요.

## 자주 묻는 질문
**세이브는 어디에 저장되나요?**
브라우저에 자동 저장돼요. 브라우저 방문 기록·사이트 데이터를 지우면 사라지니, 정보 탭의 **세이브 내보내기**로 가끔 백업해 두세요.

**로그인하면 뭐가 좋아요?**
세이브가 클라우드에도 저장돼서 다른 기기에서 이어할 수 있고, 구조 게시판을 쓸 수 있어요. 아이디와 비밀번호만 받고, 이메일 같은 개인정보는 받지 않아요.

**비밀번호를 잊었어요.**
이메일을 받지 않아서 **비밀번호 찾기가 없어요.** 새 계정을 만들어 주세요. 브라우저에 남은 세이브는 새 계정에 그대로 올릴 수 있어요.

**계정을 지우고 싶어요.**
로그인 → 계정 창 → **계정 삭제**를 누르면 서버의 기록(세이브·닉네임·구조 요청)이 모두 지워져요.

**온라인 기능이 안 돼요.**
무료 서버라 하루 사용량 한도가 있어요. 넘으면 그날 로그인과 구조 게시판만 멈추고, 한국 시간 오후 4~5시쯤 풀려요. 게임은 계속 할 수 있어요.

**포켓몬 그림이 안 나와요.**
그림을 인터넷(PMD SpriteCollab)에서 불러오기 때문에 인터넷 연결이 필요해요. 잠시 뒤 새로고침해 보세요.

## 버그 제보 · 건의
[GitHub Issues](https://github.com/pmd-fan-web/pmd-fan-web.github.io/issues/new/choose)에 남겨 주세요 (버그 제보·건의 양식이 있어요). 게임 버전(정보 탭 맨 위)을 함께 적어 주시면 빨리 고칠 수 있어요.

## 개인정보
- 로그인하지 않으면 모든 기록은 브라우저에만 저장되고, 서버로 보내지 않습니다.
- 로그인하면 아이디, 닉네임, 세이브, 마지막 접속 시각과 구조 게시판에 올린 요청만 Google Firebase에 저장합니다.
- 광고·방문 기록 분석은 하지 않습니다.

## 크레딧과 라이선스
- **이 게임의 소스 코드**(`index.html`, `css/`, `js/`, 스크립트 파일. 단 `js/data.js`의 포켓몬 데이터는 제외): [GNU AGPL-3.0](LICENSE). 고친 버전을 배포하거나 웹사이트로 서비스하면 그 소스 코드도 같은 라이선스로 공개해야 합니다.
- 아래 에셋과 데이터는 AGPL 대상이 **아니며** 각자의 권리와 라이선스를 따릅니다.
- 포켓몬 스프라이트와 초상화: [PMD Sprite Repository (SpriteCollab)](https://sprites.pmdcollab.org/), CC BY-NC 4.0. 제작자별 크레딧은 게임 안(정보 탭, 도감)에서 볼 수 있습니다.
- 포켓몬 데이터(이름, 능력치, 기술, 특성): [PokeAPI](https://pokeapi.co/).
- 원작 배경음악과 아이템·함정·상태 이상 도트 그림(별도 저장소 [pmd-fan-web/assets](https://github.com/pmd-fan-web/assets)), 원작 타일셋: Pokémon Mystery Dungeon 시리즈에서 가져온 것으로, 저작권은 Nintendo / Creatures Inc. / GAME FREAK inc. / Spike Chunsoft에 있습니다.
- Pokémon © Nintendo / Creatures Inc. / GAME FREAK inc. Pokémon Mystery Dungeon © Spike Chunsoft.

### 권리자 삭제 요청
비상업적 팬 게임이며, 권리자의 요청이 있으면 해당 콘텐츠를 신속히 내립니다. [삭제 요청 양식](https://github.com/pmd-fan-web/pmd-fan-web.github.io/issues/new/choose)을 이용해 주세요.
This is a non-commercial fan game. Content will be removed promptly upon request from rights holders.

---

## 개발자용

### 내 컴퓨터에서 실행
`index.html`을 더블클릭해도 되지만(인터넷 연결 필요), 로컬 서버로 열면 배경음악 루프가 정확해집니다.
- **Windows:** `start.bat`을 더블클릭 (Python 또는 Node.js 필요). 게임하는 동안 검은 창을 닫지 마세요.
- **직접:** 게임 폴더에서 `python -m http.server 8765` 또는 `npx http-server -p 8765` 실행 후 `http://localhost:8765`.

세이브는 연 주소마다 따로 저장됩니다. 옮기려면 정보 탭의 **세이브 내보내기 → 세이브 불러오기**를 쓰세요.

### 작업과 배포
- 고치고 테스트하는 건 `localhost`에서 하고, GitHub에 push하는 순간이 곧 배포입니다 (GitHub Pages).
- 배포할 때는 `index.html`의 `?v=` 숫자와 `js/defs.js`의 `GAME_VERSION`, `GAME_DATE`, `VERSION_NOTES`를 올리세요. 게임이 새 버전을 감지하면 마을에서 새로고침을 안내합니다.
- 버전이 바뀌면 세이브를 자동으로 백업(최근 3개)한 뒤 변환합니다. 세이브 구조를 바꿀 때는 `js/main.js`의 `MIGRATIONS`에 변환을 추가하세요. 옛 버전 화면이 새 버전 세이브를 덮어쓰지 않도록 막혀 있습니다.

### 온라인 기능 (Firebase, 무료 Spark 요금제)
- `js/config.js`: `localhost`·파일로 열면 개발용, 실제 사이트면 서비스용 프로젝트. 둘 다 Spark 요금제로만 씁니다 (Blaze로 올리지 않음).
- 보안 규칙은 `firestore.rules`. 바꾸면 콘솔의 Firestore → 규칙에 붙여 넣고 게시하세요 (두 프로젝트 모두). 새 코드와 규칙이 함께 바뀌면 규칙을 먼저 올립니다.
- 서버 사용량 절약: 클라우드 저장은 던전을 마칠 때·창을 닫을 때·마을에서 10분마다, 규칙으로 20초에 한 번까지. 접속 표시는 10분마다.
- App Check는 `js/config.js`의 `APPCHECK_SITE_KEY`에 reCAPTCHA v3 사이트 키를 넣으면 켜집니다 (지금은 꺼져 있음).

### 데이터
- `tools_build_data.py`: PokeAPI CSV, SpriteCollab `tracker.json`, `credit_names.txt`로 `js/data.js`를 만듭니다.
- 리전폼은 `tools/build_forms.py`, 폼체인지·메가진화 모습은 `tools/build_altforms.py`로 더합니다 (번호는 `tools/form_ids.json`에 고정). 모습이 바뀌는 규칙은 `js/forms.js`.
- 스프라이트는 jsDelivr로 불러오고, 실패하면 GitHub 원래 주소로 다시 시도합니다 (`js/defs.js`의 `SPRITE_BASE`).

### 소리 · 타일
- 효과음과 기본 배경음은 `js/audio.js`에서 Web Audio로 직접 합성합니다.
- **원작 음악 파일은 이 저장소에 없습니다.** 별도 저장소 [pmd-fan-web/assets](https://github.com/pmd-fan-web/assets)에 두고 사이트에서는 `/assets/music/`에서 불러옵니다 (`js/config.js`의 `MUSIC_BASE`). 그 저장소를 내려도 게임은 합성 배경음으로 동작합니다. 내 컴퓨터에서는 게임 폴더의 `music/`에 파일을 넣어 두면 됩니다 (git에는 올라가지 않음). 루프 구간은 `music/loops.js`.
- 던전 타일은 `js/tiles.js`에서 코드로 그립니다. `tiles/던전ID.png`(DTEF 형식)를 넣으면 그 타일셋을 씁니다 (`tiles/README.txt`).
- 오늘의 도전은 날짜로 난수를 고정합니다 (`js/progress.js`). 던전·아이템을 추가하면 같은 날짜라도 맵이 달라집니다.
- 배포용 zip은 `python make_release.py`.
