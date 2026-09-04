/**
 * 토큰(JWT)에 서명할 때 쓰는 비밀 키를 "한 곳에서만" 읽는다.
 *
 * 왜 파일을 따로 뺐나
 *   전에는 routes/auth.js(토큰을 만드는 쪽)와 middlewares/auth.js(토큰을 검사하는 쪽)가
 *   각자 `process.env.JWT_SECRET || 'dev-secret'` 이라고 적고 있었다.
 *   같은 문자열이 두 군데 있으면, 나중에 한쪽만 고쳤을 때
 *   "로그인은 되는데 그 다음 요청이 전부 401" 이라는 아주 찾기 힘든 버그가 난다.
 *   서명과 검증은 반드시 같은 키를 써야 하므로 출처를 하나로 만든다.
 *
 * 왜 'dev-secret' 같은 기본값을 없앴나
 *   기본값이 있으면 .env를 깜빡해도 서버가 그냥 켜진다. 문제는 그 기본값이
 *   깃허브에 올라간 코드에 그대로 적혀 있다는 점이다. 키를 아는 사람은
 *   누구나 "나는 아무개다" 라고 적힌 토큰을 직접 만들어 낼 수 있다.
 *   그래서 기본값을 없애고, 키가 없으면 서버가 아예 뜨지 않게 했다(server.js).
 *   조용히 취약한 상태로 도는 것보다, 시끄럽게 멈추고 알려주는 편이 안전하다.
 *
 * 강사님 예시(08_board)와 다른 점
 *   예시는 app.js에서 `process.env.SECRET = crypto.randomBytes(64).toString('hex')`,
 *   즉 서버를 켤 때마다 키를 새로 만든다. 키가 파일에 남지 않는 장점은 있지만
 *   서버를 재시작하는 순간 이전에 나눠준 토큰이 전부 무효가 되어
 *   사용자들이 영문도 모른 채 로그아웃된다. 코드를 고칠 때마다 nodemon이
 *   서버를 재시작하는 개발 중에는 특히 불편하다.
 *   그래서 우리는 .env에 고정된 값을 두고 쓴다.
 */

/**
 * 값을 미리 상수에 담아두지 않고 "부를 때마다" 읽는다.
 * 모듈을 불러오는 순간의 값을 박아두면, dotenv가 .env를 읽기 전에
 * 이 파일이 먼저 로드된 경우 undefined가 그대로 굳어버리기 때문이다.
 */
const jwtSecret = () => process.env.JWT_SECRET;

/**
 * JWT_SECRET이 비어 있으면 "무엇을 해야 하는지" 알려주는 문구를 돌려준다.
 * 제대로 설정되어 있으면 null을 돌려준다. (server.js가 시작할 때 확인한다)
 */
function explainMissingJwtSecret() {
  if (jwtSecret()) return null;

  return [
    '',
    '.env에 JWT_SECRET이 없습니다. 로그인 기능을 켤 수 없어 서버를 종료합니다.',
    '',
    '이렇게 하세요:',
    '  1. 프로젝트 폴더에 .env 파일이 있는지 확인합니다',
    '     (없다면)  PowerShell:  Copy-Item .env.example .env',
    '  2. .env 파일을 열어 JWT_SECRET에 아무 문자열이나 채웁니다',
    '     예)  JWT_SECRET=my-super-secret-key-change-me',
    '  3. 서버를 다시 켭니다',
    '',
    '참고: 이 값을 바꾸면 이전에 발급한 토큰은 모두 무효가 되어 다시 로그인해야 합니다.',
    '',
  ].join('\n');
}

/* ------------------------------------------------------- 키가 충분히 강한지 */

// .env.example과 README에 예시로 적어 둔 값. 그대로 쓰면 아무 의미가 없다.
const EXAMPLE_SECRETS = ['my-super-secret-key-change-me', 'dev-secret', 'secret', 'changeme'];

// 32자 미만이면 무차별 대입으로 맞혀볼 수 있다. HS256은 키가 짧을수록 약해진다.
const MIN_LENGTH = 32;

/**
 * 키가 약하면 경고 문구를, 괜찮으면 null을 돌려준다.
 *
 * 없을 때(explainMissingJwtSecret)는 서버를 멈추지만 여기서는 멈추지 않는다.
 * 공부하는 동안 짧은 키를 쓰는 것까지 막으면 불편하기만 하고 배우는 것이 없기 때문이다.
 * 대신 켤 때마다 눈에 띄게 알려서, 배포 전에 반드시 바꾸도록 한다.
 */
function warnWeakJwtSecret() {
  const secret = jwtSecret();
  if (!secret) return null;

  const reason = EXAMPLE_SECRETS.includes(secret)
    ? '예시로 적어 둔 값을 그대로 쓰고 있습니다'
    : secret.length < MIN_LENGTH
      ? `${secret.length}자로 너무 짧습니다 (권장 ${MIN_LENGTH}자 이상)`
      : null;

  if (!reason) return null;

  return [
    '',
    `⚠ JWT_SECRET이 약합니다 — ${reason}.`,
    '  이 키를 아는 사람은 "나는 아무개다"라고 적힌 토큰을 직접 만들어 낼 수 있습니다.',
    '  공부하는 동안은 그대로 두어도 되지만, 배포 전에는 반드시 바꾸세요.',
    '',
    '  무작위 키 만들기:',
    `    node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`,
    '',
    '  만든 값을 .env의 JWT_SECRET에 붙여 넣으면 됩니다.',
    '  (바꾸면 이전에 발급된 토큰은 모두 무효가 되어 다시 로그인해야 합니다)',
    '',
  ].join('\n');
}

module.exports = { jwtSecret, explainMissingJwtSecret, warnWeakJwtSecret };
