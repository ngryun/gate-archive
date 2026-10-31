# GATE 자료실 — 강원미술교육연구회 웹앱 공유 사이트

선생님들이 만든 수업용 웹앱 **링크**를 모아 나누는 사이트입니다.
화면은 GitHub Pages에, 목록은 Firebase(무료 Spark 요금제)에 둡니다. 서버나 빌드 도구는 필요 없습니다.

- **사이트**: https://ngryun.github.io/gate-archive/
- **Firebase 콘솔**: https://console.firebase.google.com/project/gate-archive

```
누구나 ──보기·등록──▶ GitHub Pages (index.html)
                          │
                          ▼
                    Firebase Firestore
                     ├─ items    웹앱 목록 (누구나 읽기)
                     ├─ secrets  등록자 비밀번호 해시 (아무도 못 읽음)
                     ├─ proofs   수정·삭제 때 쓰는 비밀번호 증명 (아무도 못 읽음)
                     ├─ settings 회원 인증 코드 (아무도 못 읽음)
                     └─ admins   관리자 Google 계정
```

| 파일 | 하는 일 |
|---|---|
| `index.html`, `assets/` | 사이트 화면 |
| `config.js` | **사이트 설정**: Firebase 설정값, 분류, 소개 글 |
| `firestore.rules` | 보안 규칙. 누가 무엇을 쓸 수 있는지 정함 |

## 누가 무엇을 할 수 있나

| | 보기 | 등록 | 수정·삭제 |
|---|---|---|---|
| 누구나 | ✅ | — | — |
| 회원 | ✅ | ✅ **회원 인증 코드** + 수정·삭제용 비밀번호 | 등록할 때 정한 **비밀번호**로 자기 자료만 |
| 관리자 (Google 로그인) | ✅ | ✅ 비밀번호 없이 | **모든 자료** (스팸·부적절한 자료 정리) |

- 비밀번호는 브라우저에서 해시(SHA-256)로 바꿔 보내므로 원래 비밀번호는 어디에도 저장되지 않습니다. 해시가 든 `secrets`도 보안 규칙상 아무도 읽을 수 없습니다.
- 비밀번호를 잊은 선생님의 자료는 관리자가 대신 고치거나 지웁니다.
- 관리자가 올린 자료는 관리자만 고칠 수 있습니다.
- 수정·삭제 권한은 화면이 아니라 `firestore.rules`가 Firebase 서버에서 확인하므로, 화면을 거치지 않고 직접 요청해도 막힙니다.

## 회원 인증 코드 바꾸기

지금 코드는 `GATE`입니다(대소문자 구분 없음). 연구회 이름이라 짐작하기 쉬우니, 학기마다 바꾸고 회원 단톡방에서만 알리는 것을 권합니다.

Firestore [데이터](https://console.firebase.google.com/project/gate-archive/firestore/databases/-default-/data) → `settings` → `registration` 문서 → `code` 값을 고치면 **바로** 적용됩니다. 사이트 코드는 고칠 필요가 없습니다.
이미 올라온 자료의 수정·삭제에는 영향이 없습니다(그건 각자 정한 비밀번호로 합니다).

## 관리자 추가 · 삭제

Firestore [데이터](https://console.firebase.google.com/project/gate-archive/firestore/databases/-default-/data) → `admins` 컬렉션 → **문서 추가**
- **문서 ID**: 선생님의 Google 계정 이메일 (예: `hong.art@gmail.com`)
- 필드: `name`(문자열) = `홍길동(춘천중)`처럼 아무거나 하나

문서를 지우면 관리자 권한이 없어집니다. 관리자는 사이트 맨 아래 **관리자 로그인**으로 들어갑니다.

> 자료는 콘솔에서 지우지 말고 **사이트의 삭제 단추**로 지우세요. 사이트는 방문자 브라우저에 목록을 저장해 두고 바뀐 것만 받아 오기 때문에, 콘솔에서 문서를 직접 지우면 이미 다녀간 방문자 화면에는 남아 있을 수 있습니다.

## 고치고 다시 올리기

- **화면·설정**: 파일을 고친 뒤 GitHub에 올리면 1~2분 뒤 사이트에 반영됩니다.
  ```bash
  git add . && git commit -m "내용 수정" && git push
  ```
- **보안 규칙**: `firestore.rules`를 고친 뒤
  ```bash
  firebase deploy --only firestore
  ```
- **분류·대상 바꾸기**: `config.js`의 `CATEGORIES`, `TARGETS`

## 무료 한도 (Spark 요금제)

| 항목 | 하루 한도 | 이 사이트에서 |
|---|---|---|
| 문서 읽기 | 50,000회 | 처음 방문: 자료 수만큼 · 다시 방문: 그동안 바뀐 자료 수만큼(보통 1회) |
| 문서 쓰기 | 20,000회 | 등록·수정·삭제 1번에 2회 |
| 저장 공간 | 1GiB 전체 | 대표 이미지를 넣어도 자료 수만 개 |

한도를 넘으면 그날만 사이트가 멈추고 요금은 나가지 않습니다. 결제 수단을 등록하지 않았기 때문입니다.

## 로컬에서 미리 보기

```bash
python3 -m http.server 8765
```

브라우저에서 http://localhost:8765 를 엽니다. `config.js`의 `FIREBASE`를 `null`로 바꾸면 Firebase 없이 **데모 모드**로 열립니다.

## 처음부터 새 Firebase 프로젝트로 옮길 때

1. [Firebase 콘솔](https://console.firebase.google.com)에서 프로젝트 만들기 → 웹 앱(`</>`) 추가 → `firebaseConfig` 값을 `config.js`에 넣기
2. **Authentication** → 시작하기 → Google 사용 설정 → 설정 탭 → 승인된 도메인에 `<GitHub 계정>.github.io` 추가
3. **Firestore Database** → 데이터베이스 만들기 → 위치 `asia-northeast3 (Seoul)` → 프로덕션 모드
4. `.firebaserc`의 프로젝트 ID를 바꾸고 `firebase deploy --only firestore`
5. `admins` 컬렉션에 관리자 이메일 추가
6. `settings` 컬렉션에 `registration` 문서를 만들고 `code`(문자열) 필드에 회원 인증 코드 입력
