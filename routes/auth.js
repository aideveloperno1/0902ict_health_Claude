const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const auth = require('../middlewares/auth');
const rateLimit = require('../middlewares/rateLimit');
const { jwtSecret } = require('../jwtSecret');
const refreshTokens = require('../refreshTokens');
const User = require('../models/User');

const router = express.Router();

/* --------------------------------------------------------- 요청 횟수 제한 */

/**
 * 로그인은 IP와 이메일을 함께 묶어서 센다.
 *
 * IP만 세면: 학교·회사처럼 여러 명이 같은 IP를 쓰는 곳에서 한 사람 때문에 모두가 잠긴다.
 * 이메일만 세면: 공격자가 이메일을 바꿔 가며 얼마든지 시도할 수 있다.
 * 둘을 묶으면 "이 사람이 이 계정에 시도한 횟수"가 되어 두 문제를 모두 피한다.
 */
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10분
  max: 10,
  message: '로그인 시도가 너무 많습니다.',
  // 라우트와 똑같이 다듬은 값으로 센다. 기준이 다르면 대소문자·공백만 바꿔 가며
  // 제한을 피해 갈 수 있다. (normalizeEmail은 아래에 선언되어 있지만,
  //  이 함수는 요청이 들어올 때 실행되므로 참조에 문제가 없다)
  keyOf: (req) => `${req.ip}|${normalizeEmail(req.body?.email)}`,
});

// 회원가입은 계정을 자동으로 대량 생성하는 것을 막는 용도라 IP만 본다.
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1시간
  max: 20,
  message: '가입 요청이 너무 많습니다.',
});

// 비밀번호 변경은 이미 로그인한 사람만 하므로 사용자 단위로 센다.
// 현재 비밀번호를 계속 찍어보는 것을 막는다.
const passwordLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: '비밀번호 변경 시도가 너무 많습니다.',
  keyOf: (req) => req.user?.id || req.ip,
});

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const SALT_ROUNDS = 10;

/**
 * 이메일을 "쓰기 전에" 한 번 다듬는다.
 *
 * 모델(models/User.js)도 lowercase·trim을 걸어 두었지만, 그것만으로는 부족하다.
 * 스키마의 정규화는 저장·조회 "직전"에 일어나는데, 아래 라우트들은 그보다 먼저
 * 원문으로 형식을 검사하고 횟수 제한 키를 만들기 때문이다.
 * 실제로 '  User@Example.COM ' 처럼 앞뒤 공백이 붙으면
 * EMAIL_RE(\S+ 로 시작)에 걸려 400이 났다.
 *
 * 그래서 라우트 입구에서 한 번 다듬어, 검증·제한·저장이 모두 같은 값을 보게 한다.
 */
const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();

// 기초대사량 계산에 필요한 값들. 전부 선택 입력이며, 비어 있으면 계산하지 않는다.
const SEXES = ['male', 'female'];
const EMPTY_PROFILE = { sex: null, birthYear: null, heightCm: null };

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * 액세스 토큰을 만든다. 로그인과 비밀번호 변경 두 곳에서 쓰므로 함수로 뺐다.
 *
 * 토큰 안에는 "누구인지"만 담는다. 비밀번호처럼 민감한 값은 절대 넣지 않는다.
 * JWT는 암호화가 아니라 서명이라서, 담긴 내용은 누구나 열어볼 수 있기 때문이다.
 * (강사님 예시는 payload에 pw를 넣는데, 토큰만 있으면 비밀번호가 그대로 보인다)
 */
/**
 * 액세스 토큰의 수명. 짧다.
 *
 * 이 토큰은 서명만 확인하므로 서버가 중간에 취소할 수 없다. 그래서 새어 나갔을 때의
 * 피해를 줄이는 방법은 수명을 짧게 두는 것뿐이다.
 * 그렇다고 15분마다 다시 로그인하게 하면 못 쓰므로, 화면이 갱신 토큰으로
 * 조용히 새로 받아 온다(POST /api/auth/refresh).
 */
const ACCESS_TOKEN_TTL = '15m';

const issueToken = (user) =>
  jwt.sign(
    // tv는 토큰 세대 번호다. 비밀번호를 바꾸면 DB의 번호만 올라가고
    // 이미 나간 토큰의 번호는 그대로라, 미들웨어가 그 차이로 옛 토큰을 걸러낸다.
    { id: String(user._id), email: user.email, tv: user.tokenVersion ?? 0 },
    jwtSecret(),
    { expiresIn: ACCESS_TOKEN_TTL }
  );

// 응답에 password 해시가 새어나가지 않도록 항상 이 함수를 거쳐서 내보낸다.
// 모델의 toJSON도 password를 지우지만, createdAt까지 빼서 지금 응답 형태를 유지하려면 이 함수가 필요하다.
const publicUser = (user) => ({
  id: String(user._id),
  email: user.email,
  name: user.name,
  profile: user.profile || { ...EMPTY_PROFILE },
});

// 회원가입
router.post('/signup', signupLimiter, async (req, res) => {
  const { password, name } = req.body || {};
  const email = normalizeEmail(req.body?.email);

  if (!email || !password || !name) {
    return res.status(400).json({ message: 'email, password, name은 필수입니다.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ message: '이메일 형식이 올바르지 않습니다.' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ message: '비밀번호는 8자 이상이어야 합니다.' });
  }
  if (await User.exists({ email })) {
    return res.status(409).json({ message: '이미 가입된 이메일입니다.' });
  }

  let user;
  try {
    user = await User.create({
      email,
      password: await bcrypt.hash(String(password), SALT_ROUNDS),
      name,
      profile: { ...EMPTY_PROFILE },
    });
  } catch (err) {
    // 위 검사와 저장 사이에 같은 이메일이 먼저 들어온 경우. unique 인덱스가 막아준다.
    if (err.code !== 11000) throw err;
    return res.status(409).json({ message: '이미 가입된 이메일입니다.' });
  }

  res.status(201).json(publicUser(user));
});

// 로그인 (JWT 발급)
router.post('/login', loginLimiter, async (req, res) => {
  const { password } = req.body || {};
  const email = normalizeEmail(req.body?.email);

  if (!email || !password) {
    return res.status(400).json({ message: 'email, password는 필수입니다.' });
  }

  // 가입되지 않은 이메일인지 비밀번호가 틀린 것인지 구분해서 알려주지 않는다.
  // password는 스키마에서 select:false라 기본 조회에 안 담긴다. 여기서만 명시적으로 꺼낸다.
  const user = await User.findOne({ email }).select('+password');
  const matched = user && (await bcrypt.compare(String(password), user.password));
  if (!matched) {
    return res.status(401).json({ message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
  }

  // 갱신 토큰은 응답 본문이 아니라 httpOnly 쿠키로 나간다.
  // 본문에 담으면 화면의 자바스크립트가 읽을 수 있게 되어, 쿠키로 옮긴 의미가 사라진다.
  await refreshTokens.issue(res, user._id);

  res.json({ token: issueToken(user), user: publicUser(user) });
});

/* ------------------------------------------------------------------- 갱신 */

/**
 * 액세스 토큰 재발급.
 *
 * 이 요청에는 Authorization 헤더가 필요 없다. 만료된 액세스 토큰으로는
 * 아무것도 증명할 수 없기 때문이다. 대신 브라우저가 자동으로 붙여 보내는
 * httpOnly 쿠키(갱신 토큰)로 본인을 확인한다.
 *
 * 확인한 갱신 토큰은 그 자리에서 버리고 새것을 심는다(회전). refreshTokens.js 참고.
 */
router.post('/refresh', async (req, res) => {
  const userId = await refreshTokens.consume(req);

  if (!userId) {
    // 쿠키가 없거나, 이미 쓴 토큰이거나, 만료됐다. 남은 쿠키가 있으면 치운다.
    refreshTokens.clear(res);
    return res.status(401).json({ message: '다시 로그인해 주세요.' });
  }

  const user = await User.findById(userId);
  if (!user) {
    // 갱신 토큰은 멀쩡한데 회원이 사라진 경우(탈퇴 등).
    refreshTokens.clear(res);
    return res.status(401).json({ message: '다시 로그인해 주세요.' });
  }

  await refreshTokens.issue(res, user._id);

  res.json({ token: issueToken(user), user: publicUser(user) });
});

/**
 * 로그아웃.
 *
 * 화면에서 토큰을 지우는 것만으로는 부족하다. 그건 그 브라우저에서만 사라질 뿐
 * 갱신 토큰은 서버에 그대로 남아 계속 쓸 수 있기 때문이다. 서버에서도 지운다.
 *
 * 인증을 요구하지 않는다. 액세스 토큰이 이미 만료된 상태에서도 로그아웃은 되어야 한다.
 */
router.post('/logout', async (req, res) => {
  await refreshTokens.consume(req);
  refreshTokens.clear(res);
  res.json({ message: '로그아웃되었습니다.' });
});

/* --------------------------------------------------------------- 비밀번호 */

/**
 * 비밀번호 변경. 로그인한 사람이 "현재 비밀번호를 알고 있는" 상태에서 바꾸는 기능이다.
 *
 * 비밀번호를 잊어버린 경우(재설정)는 여기서 다루지 않는다. 그때는 현재 비밀번호를
 * 물어볼 수가 없어서, 이메일처럼 본인임을 증명할 다른 수단이 필요하기 때문이다.
 */
router.put('/password', auth, passwordLimiter, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'currentPassword, newPassword는 필수입니다.' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ message: '새 비밀번호는 8자 이상이어야 합니다.' });
  }
  if (String(currentPassword) === String(newPassword)) {
    return res.status(400).json({ message: '새 비밀번호가 기존 비밀번호와 같습니다.' });
  }

  // password는 스키마에서 select:false라 기본 조회에 안 담긴다. 여기서만 꺼낸다.
  const user = await User.findById(req.user.id).select('+password');
  if (!user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });

  /**
   * 토큰을 훔친 사람이 비밀번호까지 바꿔 계정을 완전히 빼앗는 것을 막는 장치다.
   * 토큰만으로는 부족하고 현재 비밀번호를 알아야 한다.
   *
   * 여기서 401이 아니라 400을 주는 이유
   *   이 요청은 이미 토큰으로 인증을 통과했다. 실패한 것은 "인증"이 아니라
   *   "본문에 담아 보낸 값"이므로 400이 맞다.
   *   그리고 실용적인 이유가 하나 더 있다. 화면(public/js/api.js)은 401을
   *   "세션이 만료됐다"로 보고 곧바로 로그아웃시킨다. 여기서 401을 주면
   *   비밀번호를 한 글자 잘못 친 사용자가 로그인 화면으로 튕겨 나간다.
   */
  if (!(await bcrypt.compare(String(currentPassword), user.password))) {
    return res.status(400).json({ message: '현재 비밀번호가 올바르지 않습니다.' });
  }

  user.password = await bcrypt.hash(String(newPassword), SALT_ROUNDS);

  // 세대 번호를 올린다. 이 줄 하나로 지금까지 발급된 액세스 토큰이 전부 무효가 된다.
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();

  /**
   * 갱신 토큰도 전부 없앤다.
   *
   * 세대 번호는 액세스 토큰만 막는다. 갱신 토큰을 그대로 두면 다른 기기가
   * 그것으로 새 액세스 토큰을 받아 가서, 비밀번호를 바꾼 의미가 없어진다.
   * 다 지운 뒤 지금 이 기기에만 새로 하나 심는다.
   */
  await refreshTokens.revokeAll(user._id);
  await refreshTokens.issue(res, user._id);

  /**
   * 새 토큰을 함께 내려준다.
   *
   * 비밀번호를 바꾸면 그 전에 나간 토큰이 전부 무효가 된다(middlewares/auth.js).
   * 지금 쓰고 있는 토큰도 예외가 아니라서, 새 토큰을 주지 않으면 비밀번호를 바꾼
   * 사용자가 곧바로 로그아웃된다. 스스로 바꾼 사람까지 쫓아낼 이유는 없다.
   * 다른 기기에 남아 있던 토큰은 그대로 무효가 된다. 그게 이 기능의 목적이다.
   *
   * 반드시 save() 뒤에 만들어야 한다. 그래야 올라간 세대 번호가 새 토큰에 담긴다.
   */
  res.json({ message: '비밀번호가 변경되었습니다.', token: issueToken(user) });
});

/* ------------------------------------------------------------------ 프로필 */

// 기초대사량(BMR)을 구하려면 성별·나이·키가 필요한데, 가입 정보에는 없다.
// 나이는 해가 바뀌면 틀려지므로 출생연도를 저장하고 나이는 화면에서 계산한다.
function validateProfile({ sex, birthYear, heightCm }) {
  if (sex !== undefined && sex !== null && sex !== '' && !SEXES.includes(sex)) {
    return `sex는 ${SEXES.join('/')} 중 하나여야 합니다.`;
  }

  if (birthYear !== undefined && birthYear !== null) {
    if (!isNumber(birthYear) || !Number.isInteger(birthYear)) {
      return 'birthYear는 정수여야 합니다.';
    }
    const thisYear = new Date().getFullYear();
    if (birthYear < 1900 || birthYear > thisYear) {
      return `birthYear는 1900 이상 ${thisYear} 이하여야 합니다.`;
    }
  }

  if (heightCm !== undefined && heightCm !== null) {
    if (!isNumber(heightCm)) return 'heightCm은 숫자여야 합니다.';
    if (heightCm <= 0 || heightCm > 300) return 'heightCm은 0보다 크고 300 이하여야 합니다.';
  }
  return null;
}

router.get('/me', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });

  res.json(publicUser(user));
});

router.put('/me', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });

  const body = req.body || {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return res.status(400).json({ message: 'name은 비어 있을 수 없습니다.' });
    }
  }

  const profile = body.profile || {};
  const error = validateProfile(profile);
  if (error) return res.status(400).json({ message: error });

  if (body.name !== undefined) user.name = body.name.trim();

  /**
   * 보내온 항목만 바꾼다. 보내지 않은 항목은 지금 값을 그대로 둔다.
   *
   * 전에는 body.profile이 없으면 빈 객체로 보고 세 항목을 전부 null로 덮어썼다.
   * 그래서 { "name": "새 이름" } 만 보내면 성별·출생연도·키가 조용히 지워지고,
   * 기초대사량 계산이 그날부터 멈췄다.
   *
   * 값을 "비우고 싶을" 때는 그 항목을 null(또는 빈 문자열)로 명시해서 보내면 된다.
   * 화면(public/js/modules/profile.js)은 항상 세 항목을 모두 보내므로 동작이 달라지지 않는다.
   */
  const current = user.profile || { ...EMPTY_PROFILE };

  const pick = (key, isValid) => {
    if (!(key in profile)) return current[key] ?? null;   // 안 보냈으면 유지
    return isValid(profile[key]) ? profile[key] : null;    // 보냈으면 반영(유효하지 않으면 비움)
  };

  // email과 password는 여기서 바꿀 수 없다. 보내도 무시한다.
  user.profile = {
    sex: pick('sex', (v) => SEXES.includes(v)),
    birthYear: pick('birthYear', isNumber),
    heightCm: pick('heightCm', isNumber),
  };
  await user.save();

  res.json(publicUser(user));
});

module.exports = router;
