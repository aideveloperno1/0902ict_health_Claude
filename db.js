const mongoose = require('mongoose');

// 로컬 MongoDB 기본 주소. 비밀번호가 없으므로 코드에 적어 두어도 안전하다.
const DEFAULT_URI = 'mongodb://127.0.0.1:27017/workout-log';

const uri = () => process.env.MONGODB_URI || DEFAULT_URI;

// 서버리스에서 함수 인스턴스가 재사용될 때(웜 스타트) 살아남도록 global에 둔다.
// 모듈이 다시 로드돼도 같은 상자를 가리키게 하는 것이 목적이다.
let cached = global._mongoose;
if (!cached) cached = global._mongoose = { promise: null };

/**
 * 연결된 "다음에" 생기는 문제를 감시한다.
 *
 * 왜 필요한가
 *   connectDb()의 try/catch는 "처음 붙을 때" 실패만 잡는다.
 *   서버가 잘 돌던 중에 MongoDB 서비스가 멈추면(윈도우 업데이트 재부팅 등)
 *   그 사실을 아무도 알려주지 않는다. 화면에서는 요청이 한참 멈춰 있다가
 *   시간 초과로 실패할 뿐이라, "내 코드가 느린가?" 하고 엉뚱한 곳을 뒤지게 된다.
 *   끊기는 순간 터미널에 찍히면 원인을 바로 알 수 있다.
 *   강사님 예시(08_board)의 config/db.js 에 있는 db.on('error') 와 같은 역할이다.
 *
 * mongoose는 끊겨도 알아서 재연결을 계속 시도한다. 그래서 여기서는 서버를 죽이지 않고
 * 상태만 알린다. MongoDB를 다시 켜면 reconnected가 찍히며 정상으로 돌아온다.
 */
function watchConnection() {
  const db = mongoose.connection;

  db.on('error', (error) => {
    console.error(`[MongoDB] 오류: ${error.message}`);
  });

  db.on('disconnected', () => {
    console.warn('[MongoDB] 연결이 끊겼습니다. 다시 연결을 시도합니다…');
    console.warn('          MongoDB가 꺼졌을 수 있습니다.  PowerShell:  Start-Service MongoDB');
  });

  db.on('reconnected', () => {
    console.log('[MongoDB] 다시 연결되었습니다.');
  });
}

/**
 * MongoDB에 연결한다.
 * 연결이 끝난 뒤에 서버를 띄워야, DB가 준비되기 전에 들어온 요청이 실패하지 않는다.
 */
async function connectDb() {
  // 이미 연결이 살아 있으면 그대로 쓴다.
  // readyState: 0=끊김, 1=연결됨, 2=연결중, 3=끊는중
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  /**
   * DB_DEBUG=true 이면 mongoose가 실행하는 쿼리를 그대로 터미널에 찍는다.
   *   예)  Mongoose: workouts.find({ userId: ObjectId("...") }, { sort: { date: -1 } })
   *
   * 내가 짠 조건이 실제로 어떤 쿼리가 되는지, 인덱스를 태우려고 만든 조건이
   * 제대로 들어갔는지 눈으로 확인할 때 아주 유용하다.
   *
   * 강사님 예시(08_board)는 이 값을 항상 켜 두는데(mongoose.set('debug', true)),
   * 우리는 .env로 켜고 끌 수 있게 했다. 화면 한 번 여는 데 쿼리가 여러 개 나가서
   * 늘 켜 두면 정작 보고 싶은 morgan 로그가 묻히기 때문이다. 필요할 때만 켠다.
   */
  if (process.env.DB_DEBUG === 'true') {
    mongoose.set('debug', true);
    console.log('[MongoDB] 쿼리 로그가 켜져 있습니다. (.env의 DB_DEBUG)');
  }

  // ★ await 하지 않고 Promise를 먼저 저장한다.
  //   동시에 들어온 다른 요청은 이 if를 건너뛰고 같은 약속을 함께 기다린다.
  //   readyState만 봐서는 "연결 중"(2)인 요청들이 각자 connect()를 불러 버린다.
  if (!cached.promise) {
    cached.promise = mongoose.connect(uri());
  }

  try {
    await cached.promise;
  } catch (error) {
    // 실패한 약속을 남겨두면 다음 요청도 같은 실패를 물려받는다. 비우고 다시 시도하게 한다.
    cached.promise = null;
    throw error;
  }

  // 기존과 똑같이 Connection 객체를 돌려준다.
  // (주의: mongoose.connect()가 resolve하는 값은 Connection이 아니라 mongoose 인스턴스다.
  //  그 값을 그대로 반환하면 함수의 반환 타입이 조용히 바뀐다)
  return mongoose.connection;
}

async function disconnectDb() {
  // 종료할 때는 '연결이 끊겼다'는 경고가 뜰 필요가 없다. 우리가 일부러 끊는 것이므로
  // 감시 핸들러를 먼저 떼어낸다. (이게 없으면 Ctrl+C 때마다 경고가 한 줄 찍힌다)
  mongoose.connection.removeAllListeners('disconnected');
  await mongoose.connection.close();
  cached.promise = null;
}

/** 연결에 실패했을 때 무엇을 해야 하는지 알려준다. 조용히 죽으면 원인을 찾기 어렵다. */
function explainConnectionFailure(error) {
  return [
    '',
    'MongoDB에 연결하지 못했습니다.',
    `  주소: ${uri()}`,
    `  원인: ${error.message}`,
    '',
    '확인해 보세요:',
    '  1. MongoDB가 설치되어 있나요?   winget install MongoDB.Server',
    '  2. 서비스가 실행 중인가요?      Get-Service MongoDB',
    '  3. .env의 MONGODB_URI가 맞나요?',
    '',
  ].join('\n');
}

// 모듈당 한 번만 실행된다. connectDb() 안에서 부르면 재연결마다 중복 등록된다.
watchConnection();

module.exports = { connectDb, disconnectDb, explainConnectionFailure, uri, DEFAULT_URI };
