// 사이트 설정 — 이 파일만 고치면 됩니다.
window.GATE_CONFIG = {
  // Firebase 웹 앱 설정값 (README의 2단계). null 이면 '데모 모드'로 열립니다.
  // 이 값은 공개되어도 괜찮습니다. 쓰기 권한은 firestore.rules 가 막습니다.
  FIREBASE: {
    apiKey: 'AIzaSyCZc69YmMZ6oPrS3eHm-ZfOeh89ZwhJ-ls',
    authDomain: 'gate-archive.firebaseapp.com',
    projectId: 'gate-archive',
    appId: '1:335250541685:web:49b24d3d422c0d1ec6bc3c',
  },

  ORG_NAME: '강원미술교육연구회',
  // 연구회 회장. 비워 두면(null) 표시하지 않습니다.
  PRESIDENT: { name: '서보경', org: '치악고등학교' },
  SITE_TITLE: 'GATE 자료실',
  INTRO: '강원 지역 미술 선생님들이 수업을 위해 만든 웹앱을 함께 나눕니다. 링크를 열어 바로 쓰거나, 만든 과정과 프롬프트를 참고해 우리 학교에 맞게 바꾸어 보세요.',

  // 웹앱 분류. 순서대로 필터에 나옵니다. color 는 카드·필터 색입니다.
  CATEGORIES: [
    { key: '감상', color: '#1f5fd1' },
    { key: '표현', color: '#e5232a' },
    { key: '미술 게임', color: '#ffd60a' },
    { key: '수업 도구', color: '#18a058' },
    { key: '평가·피드백', color: '#f7a3b4' },
    { key: '기타', color: '#111111' },
  ],

  // 대상 (여러 개 고를 수 있음)
  TARGETS: ['초등학교', '중학교', '고등학교', '교사용'],
};
