require('dotenv').config();

const { explainMissingJwtSecret } = require('./jwtSecret');

const missingSecret = explainMissingJwtSecret();
if (missingSecret) {
  // 로컬에서는 server.js가 이 문구를 먼저 보여주고 종료하지만,
  // 서버리스에서는 server.js가 실행되지 않으므로 여기서 막아야 한다.
  console.error(missingSecret);

  if (process.env.VERCEL) {
    console.error('Vercel: Settings → Environment Variables 에서 JWT_SECRET을 추가하세요.');
  }

  throw new Error('JWT_SECRET 환경변수가 필요합니다.');
}

const path = require('path');
const express = require('express');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const authRouter = require('./routes/auth');
const workoutsRouter = require('./routes/workouts');
const mealsRouter = require('./routes/meals');
const bodyMetricsRouter = require('./routes/bodyMetrics');
const routinesRouter = require('./routes/routines');

const app = express();

/**
 * 프록시(nginx·Caddy 등) 뒤에 있을 때 진짜 접속 IP를 알아내기 위한 설정.
 *
 * 배포할 때는 앞에 프록시를 두고 그것이 HTTPS를 처리한다(README의 "배포할 때" 참고).
 * 그러면 이 서버 입장에서는 모든 요청이 프록시 한 곳에서 오는 것처럼 보여
 * req.ip가 전부 같은 값이 된다.
 *
 * 이 설정이 없으면 아래 로그인 시도 횟수 제한이 전체 사용자를 한 사람으로 취급해서,
 * 누군가 비밀번호를 다섯 번 틀리면 접속한 모든 사람이 함께 잠긴다.
 * 이 줄이 있으면 프록시가 붙여 주는 X-Forwarded-For 헤더에서 원래 IP를 읽는다.
 *
 * 숫자 1은 "바로 앞의 프록시 하나만 믿는다"는 뜻이다. true(전부 믿음)로 두면
 * 공격자가 헤더를 마음대로 지어내 횟수 제한을 피해 갈 수 있다.
 * 로컬에서는 프록시가 없어 아무 영향이 없다.
 */
app.set('trust proxy', 1);

/**
 * 들어온 요청을 터미널에 한 줄씩 찍는다.  예)  POST /api/workouts 201 12.480 ms - 385
 *
 * 왜 넣었나
 *   이게 없으면 요청이 들어와도 터미널이 조용해서, 화면이 어느 API를 몇 번 불렀는지
 *   응답이 200이었는지 404였는지를 볼 방법이 없다. 브라우저 개발자도구를 열지 않고도
 *   서버 쪽에서 바로 확인할 수 있어야 원인을 빨리 찾는다.
 *   강사님 예시(08_board)도 morgan을 쓴다.
 *
 * 'dev'는 개발용 형식이다. 상태 코드에 색이 붙어(2xx 초록 / 4xx 노랑 / 5xx 빨강)
 * 눈으로 훑기 좋다. 운영 서버라면 'combined'처럼 더 자세한 형식을 쓴다.
 *
 * 가장 위에 두는 이유: 아래 미들웨어에서 에러가 나 응답이 일찍 끝나더라도
 * 그 요청이 들어왔다는 사실은 남아야 하기 때문이다.
 *
 * 참고로 이 자리에 두면 /css/style.css 같은 정적 파일 요청까지 다 찍힌다.
 * 화면을 한 번 새로고침하면 여러 줄이 우르르 올라오는데 정상이다.
 * API 요청만 보고 싶다면 app.use('/api', morgan('dev')) 처럼 경로를 좁히면 된다.
 */
app.use(morgan('dev'));

// 프론트를 별도 도메인으로 분리할 때를 대비한 설정.
// 같은 오리진에서 호출하는 지금은 없어도 동작에 차이가 없다.
app.use((req, res, next) => {
  res.set('Access-Control-Expose-Headers', 'X-Total-Count, X-Total-Pages, X-Page, X-Limit');
  next();
});

// 라우터보다 반드시 위에 등록해야 한다. 빠지면 req.body가 undefined가 된다.
app.use(express.json());

// req.cookies를 채워 준다. Express는 쿠키를 스스로 해석하지 않는다.
// 갱신 토큰이 httpOnly 쿠키로 오기 때문에 필요하다(refreshTokens.js 참고).
app.use(cookieParser());

// 화면(프론트엔드). Vercel에서는 정적 파일을 Vercel CDN이 서빙한다.
// 서버리스 함수 안에서 중복 서빙할 필요가 없다. (Vercel은 자동으로 VERCEL=1 환경변수를 설정해 준다)
if (!process.env.VERCEL) {
  app.use(express.static(path.join(__dirname, 'public')));
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const { connectDb } = require('./db');

// '/api'로 시작하는 요청에만 건다. 정적 파일(CSS·JS)은 DB 없이도 서빙되어야 한다.
app.use('/api', async (req, res, next) => {
  try {
    await connectDb();
    next();
  } catch (error) {
    console.error('DB 연결 실패:', error.message);
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/workouts', workoutsRouter);
app.use('/api/meals', mealsRouter);
app.use('/api/body-metrics', bodyMetricsRouter);
app.use('/api/routines', routinesRouter);

// 404 핸들러. Express 5에서는 경로 없이 등록한다 ('*'는 path-to-regexp v8에서 에러가 난다)
app.use((req, res) => {
  res.status(404).json({ message: '요청한 경로를 찾을 수 없습니다.' });
});

// 에러 핸들러. 없으면 예외 발생 시 HTML 스택트레이스가 그대로 응답된다.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'JSON 형식이 올바르지 않습니다.' });
  }

  console.error(err);
  res.status(500).json({ message: '서버 오류가 발생했습니다.' });
});

module.exports = app;
