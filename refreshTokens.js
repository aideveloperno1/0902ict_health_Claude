const crypto = require('crypto');
const RefreshToken = require('./models/RefreshToken');

/**
 * 갱신 토큰을 만들고, 확인하고, 없애는 일을 한곳에 모았다.
 * routes/auth.js가 이 함수들만 쓰면 되도록 해서, 라우트에는 흐름만 남긴다.
 */

// 쿠키 이름. 화면(JS)에서는 읽을 수 없고 브라우저가 알아서 붙여 보낸다.
const COOKIE_NAME = 'refreshToken';

// 14일. 이 기간 동안은 다시 로그인하지 않아도 된다.
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** 저장·비교에 쓰는 해시. 무작위 값이라 빠른 해시로 충분하다(모델 주석 참고). */
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * 브라우저에 갱신 토큰을 심을 때 쓰는 설정.
 *
 * httpOnly  자바스크립트에서 읽을 수 없다. 이 앱에 XSS 취약점이 생기더라도
 *           공격자가 이 토큰을 훔쳐 갈 수 없다. 이 설정이 이 구조의 핵심이다.
 *
 * sameSite  'lax'면 다른 사이트에서 보낸 POST 요청에는 이 쿠키가 실리지 않는다.
 *           공격자가 만든 페이지가 몰래 /api/auth/refresh를 호출해도 쿠키가 안 가므로
 *           CSRF 토큰을 따로 두지 않아도 된다.
 *
 * secure    HTTPS에서만 전송한다. 로컬은 http라서 켜면 로그인 자체가 안 되므로
 *           배포(NODE_ENV=production)에서만 켠다. README의 "배포할 때" 참고.
 *
 * path      이 쿠키가 필요한 곳은 갱신·로그아웃뿐이다. 경로를 좁혀 두면
 *           일지·식단 같은 평범한 요청에는 쿠키가 아예 실리지 않는다.
 */
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/api/auth',
  maxAge: MAX_AGE_MS,
});

/** 새 갱신 토큰을 만들어 DB에 남기고, 브라우저 쿠키로 심는다. */
async function issue(res, userId) {
  // 사람이 추측할 수 없어야 하므로 Math.random이 아니라 crypto를 쓴다.
  // Math.random은 예측 가능한 값이라 이런 용도에 쓰면 안 된다.
  const token = crypto.randomBytes(48).toString('base64url');

  await RefreshToken.create({
    userId,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + MAX_AGE_MS),
  });

  res.cookie(COOKIE_NAME, token, cookieOptions());
  return token;
}

/**
 * 쿠키로 온 토큰이 유효한지 확인하고, 확인한 것은 곧바로 없앤다(회전).
 *
 * 왜 한 번 쓰면 버리나
 *   같은 토큰을 14일 내내 재사용하면, 한 번 새어 나갔을 때 그 기간 내내 쓸 수 있다.
 *   쓸 때마다 새 토큰으로 바꾸면 훔친 토큰의 수명이 "다음 갱신까지"로 줄어든다.
 *
 * @returns {string|null} 유효하면 사용자 id, 아니면 null
 */
async function consume(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;

  // findOneAndDelete를 쓰는 이유: 찾기와 지우기가 한 번에 일어나야 한다.
  // 따로 하면 같은 토큰으로 동시에 들어온 두 요청이 둘 다 통과할 수 있다.
  const found = await RefreshToken.findOneAndDelete({ tokenHash: hash(token) });
  if (!found) return null;

  // TTL 청소는 1분 주기라 조금 늦을 수 있다. 시간은 여기서 직접 확인한다.
  if (found.expiresAt.getTime() <= Date.now()) return null;

  return String(found.userId);
}

/**
 * 이 사용자의 갱신 토큰을 전부 없앤다.
 * 비밀번호를 바꿨을 때 다른 기기의 로그인까지 함께 끊기 위한 것이다.
 */
const revokeAll = (userId) => RefreshToken.deleteMany({ userId });

/** 쿠키를 지운다. 심을 때와 같은 path·옵션이어야 브라우저가 같은 쿠키로 인식한다. */
function clear(res) {
  const { maxAge, ...options } = cookieOptions();
  res.clearCookie(COOKIE_NAME, options);
}

module.exports = { issue, consume, revokeAll, clear, COOKIE_NAME, MAX_AGE_MS };
