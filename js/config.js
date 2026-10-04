// 실행 환경: 내 컴퓨터에서 테스트(개발) / 실제 사이트(서비스)
// 개발 중에 만든 테스트 계정·구조 요청이 실제 플레이어 쪽에 섞이지 않도록, 온라인 기능은 환경마다 다른 Firebase 프로젝트에 연결한다.
'use strict';

const ENV = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ? 'dev' : 'prod';

// Firebase 설정: 프로젝트를 만든 뒤 콘솔의 "웹 앱 설정" 값을 붙여 넣는다 (이 값은 공개되어도 되는 값이다)
// 둘 다 무료 요금제(Spark)로만 사용한다. Blaze로 업그레이드하지 않는다.
const FIREBASE_CONFIG = {
  // 개발용 프로젝트 (localhost / 파일로 열었을 때)
  dev: {
    apiKey: 'AIzaSyC9ojnyB6RGPNrFN7oX0tnev6XHUXjUV88',
    authDomain: 'pmd-web-dev.firebaseapp.com',
    projectId: 'pmd-web-dev',
    storageBucket: 'pmd-web-dev.firebasestorage.app',
    messagingSenderId: '616176015485',
    appId: '1:616176015485:web:80eda5ff81f6226700b914',
  },
  // 서비스용 프로젝트 (GitHub Pages 사이트)
  prod: {
    apiKey: 'AIzaSyC7P5xmsOcNr0ruNpDKxCY_cZySwhUNNKA',
    authDomain: 'pmd-web-43713.firebaseapp.com',
    projectId: 'pmd-web-43713',
    storageBucket: 'pmd-web-43713.firebasestorage.app',
    messagingSenderId: '955480535200',
    appId: '1:955480535200:web:10b20c39b5c857153619c5',
  },
};
const ONLINE_CONFIG = FIREBASE_CONFIG[ENV];

// App Check (reCAPTCHA v3 사이트 키): 이 사이트에서 온 요청만 서버가 받게 한다 (스크립트로 한도를 다 쓰는 공격 방지)
// 사이트 키는 공개되어도 되는 값이다. 비어 있으면 App Check를 쓰지 않는다 (내 컴퓨터 테스트는 쓰지 않음)
const APPCHECK_SITE_KEY = { dev: '', prod: '' }[ENV];

// 원작 배경음악: 코드와 다른 저장소(pmd-fan-web/assets)에 따로 둔다.
// 권리자 요청으로 음악을 내려도 게임은 합성 배경음으로 계속 돌아간다. 내 컴퓨터에서는 게임 폴더의 music/을 쓴다.
const MUSIC_BASE = ENV === 'prod' ? '/assets/music/' : 'music/';
// 원작 아이템·함정·상태 이상 그림도 같은 저장소에 (못 불러오면 이모지로). 내 컴퓨터에서는 pmdgfx/ (tools/build_gfx.py로 만든다)
const GFX_BASE = ENV === 'prod' ? '/assets/sprites/' : 'pmdgfx/';
