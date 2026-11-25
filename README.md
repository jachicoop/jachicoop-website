# jachicoop-website
자치교육 사회적협동조합 길잡이 홈페이지입니다.

## 기존 홈페이지에 사진 첨부와 슬라이드 편집 업데이트 적용하기

1. Vercel의 홈페이지 프로젝트 **Settings → Environment Variables**에서 두 변수를 **Production**으로 설정합니다.
   - `IMAGEKIT_PRIVATE_KEY`는 **Secret**으로 추가하고 ImageKit의 **Private Key**를 넣습니다.
   - `IMAGEKIT_PUBLIC_KEY`는 **Config**로 추가하고 ImageKit의 **Public Key**를 넣습니다.
2. Firebase 콘솔에서 현재 프로젝트의 **Firestore Database → Rules**를 열고 `firestore.rules`를 게시합니다. 마지막 슬라이드를 지울 때도 빈 목록을 저장할 수 있도록 허용하는 변경입니다.
3. ZIP에 들어 있는 변경 파일을 기존 GitHub 저장소의 같은 위치에 올립니다. `api/imagekit-upload.mjs`는 저장소 루트의 `api` 폴더에 넣습니다. Vercel 배포가 끝난 뒤 홈페이지 하단의 **관리자 로그인**에서 사진 첨부를 확인합니다.

사진은 ImageKit의 `/jachicoop` 폴더에 저장되고, 게시글과 슬라이드에는 사진 주소가 저장됩니다. 대표 사진이나 슬라이드를 화면에서 빼도 ImageKit 파일은 남습니다. 저장공간을 정리할 때는 다른 곳에서 사용 중인지 확인한 뒤 ImageKit의 **Media Library**에서 파일을 삭제할 수 있습니다.

## Firestore를 처음 연결하기

Vercel에서 홈페이지를 배포하고 Firebase의 Spark 무료 요금제로 게시글과 행사 슬라이드를 저장합니다.

1. [Firebase 콘솔](https://console.firebase.google.com/)에서 조합이 관리할 구글 계정으로 프로젝트를 만듭니다. 요금제는 **Spark**를 선택합니다.
2. **Firestore Database → 데이터베이스 만들기**에서 **Standard**와 **(default)**를 선택합니다. 지역을 고를 수 있으면 **서울(asia-northeast3)**을 선택하고 **프로덕션 모드**로 생성합니다.
3. Firestore의 **규칙(Rules)** 탭에 이 저장소의 `firestore.rules` 내용을 붙여 넣고 **게시(Publish)**를 누릅니다. 규칙은 방문자에게 게시글과 메인 슬라이드 읽기 권한을 주고, 아래에서 등록한 관리자만 수정할 수 있게 합니다.
4. **Authentication → 로그인 방법(Sign-in method)**에서 **이메일/비밀번호**를 켭니다. **사용자(Users) → 사용자 추가(Add user)**에서 관리자 이메일과 이 사이트 전용 비밀번호를 등록합니다. 생성한 계정의 **사용자 UID**를 복사합니다. Authentication 설정에 **사용자 가입 허용**이 보이면 꺼 둡니다.
5. **Firestore → 데이터(Data)**에서 `cmsAdmins` 컬렉션을 만들고, **문서 ID**에 방금 복사한 UID를 넣습니다. 필드는 이름 `enabled`, 유형 **boolean**, 값 **true**로 추가합니다. 관리 권한을 회수할 때는 이 문서의 값을 false로 바꿉니다.
6. **프로젝트 설정 → 일반 → 내 앱**에서 웹 앱 **`</>`**을 등록합니다. **구성(Config)**에 나오는 `const firebaseConfig = { ... };`을 `firebase-config.js`에 복사하고 마지막 줄에 `export default firebaseConfig;`를 넣습니다. 콘솔의 **웹 앱 구성**은 공개 값입니다. 관리자 비밀번호나 서비스 계정 키는 따로 보관합니다.
7. GitHub에서 변경 파일을 현재 홈페이지 파일과 같은 폴더에 올립니다. Vercel 배포가 끝나면 홈페이지 하단 **관리자 로그인**에서 4단계의 계정으로 로그인합니다.

## 연결 확인

- 관리자 화면에서 테스트용 공지 한 건을 저장합니다.
- 시크릿 창에서 공지사항을 열어 같은 글이 보이는지 확인합니다.
- 관리자 화면에서 글을 수정하고 삭제해 각각 반영되는지 확인합니다.
- 저장한 슬라이드 설정이 없는 홈페이지에는 기본 슬라이드가 표시됩니다. 마지막 슬라이드까지 삭제하면 홈에서 슬라이드가 숨겨집니다.
- 사진은 JPG, PNG 또는 WebP를 첨부합니다. 5MB를 넘는 사진은 업로드 전에 자동으로 줄입니다. 첨부 문서는 방문자에게 공유할 수 있는 HTTPS 주소를 넣습니다.
