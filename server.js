const app = require('./app');
const {
  connectDb,
  disconnectDb,
  explainConnectionFailure,
  explainIndexFailures,
  uri,
} = require('./db');
const { warnWeakJwtSecret } = require('./jwtSecret');

const PORT = process.env.PORT || 3000;

/**
 * 서버를 켤 수 없는 이유를 사람이 읽을 수 있는 말로 바꾼다.
 *
 * 왜 필요한가
 *   이 처리가 없으면 포트가 이미 쓰이고 있을 때
 *   `Error: listen EADDRINUSE: address already in use :::3000` 뒤에
 *   node 내부 스택트레이스가 20줄쯤 쏟아진다. 처음 보면 무엇을 해야 할지 알 수 없다.
 *   DB 연결 실패는 이미 db.js가 친절하게 안내하고 있으니, 포트도 같은 수준으로 맞춘다.
 *
 * 강사님 예시(08_board)의 bin/www 가 하는 onError 와 같은 역할이다.
 * 예시는 express-generator가 만들어 준 bin/www 라는 별도 파일에 이 코드를 두는데,
 * 우리는 이미 server.js가 "서버를 띄우는 파일" 역할을 하고 있어 여기에 함께 둔다.
 * (app.js = 앱 설정, server.js = 실행. 파일이 나뉜 이유는 예시와 같다)
 */
function explainListenFailure(error, port) {
  if (error.code === 'EADDRINUSE') {
    return [
      '',
      `${port}번 포트를 이미 다른 프로그램이 쓰고 있어 서버를 켤 수 없습니다.`,
      '',
      '이렇게 하세요:',
      '  1. 이 서버가 다른 터미널에 이미 켜져 있지 않은지 확인합니다',
      '     (가장 흔한 원인입니다. 그 터미널에서 Ctrl + C 로 끄세요)',
      '  2. 그래도 안 되면 누가 쓰는지 찾아봅니다',
      `     PowerShell:  Get-NetTCPConnection -LocalPort ${port} | Select-Object OwningProcess`,
      '  3. 또는 .env의 PORT를 다른 번호(예: 3001)로 바꿉니다',
      '',
    ].join('\n');
  }

  if (error.code === 'EACCES') {
    return [
      '',
      `${port}번 포트를 쓸 권한이 없습니다.`,
      '',
      '1024보다 작은 번호(80, 443 등)는 관리자 권한이 필요합니다.',
      '.env의 PORT를 3000처럼 1024보다 큰 번호로 바꾸세요.',
      '',
    ].join('\n');
  }

  // 위 두 가지가 아니면 원인을 짐작하지 않는다. 잘못 안내하면 오히려 헤매게 된다.
  return `\n서버를 켜지 못했습니다.\n  원인: ${error.message}\n`;
}

/**
 * DB에 먼저 연결하고 나서 서버를 띄운다.
 *
 * 준비가 끝나면 resolve되는 약속을 그대로 내보낸다.
 * 검증 스크립트처럼 이 파일을 require해서 쓰는 쪽이 "언제 준비됐는지" 알 수 있어야 하기 때문이다.
 */
const ready = (async () => {
  // 있긴 한데 약한 경우. 멈추지는 않고 알리기만 한다.
  const weakSecret = warnWeakJwtSecret();
  if (weakSecret) console.warn(weakSecret);

  try {
    await connectDb();
    console.log(`MongoDB 연결됨: ${uri()}`);
  } catch (error) {
    console.error(explainConnectionFailure(error));
    process.exit(1);
  }

  // 연결에 성공해도 인덱스는 따로 실패할 수 있다. 위의 약한 비밀 키 경고와 같은 자리다.
  // 서버를 멈추지는 않는다 — 인덱스가 없어도 앱은 돌아가고, 고치려면 서버를 켠 채로
  // DB를 들여다봐야 하기 때문이다. 대신 무엇이 빠졌는지 분명히 알린다.
  const indexWarning = await explainIndexFailures();
  if (indexWarning) console.warn(indexWarning);

  const server = app.listen(PORT, () => {
    /**
     * 여기서 server.address()를 확인하는 이유 (직접 겪어보고 알게 된 함정)
     *
     * 보통은 "listen에 성공했을 때만 이 콜백이 불린다"고 생각하지만,
     * Express 5에서는 포트를 잡지 못했을 때도 이 콜백이 한 번 불린다.
     * 그대로 두면 포트가 이미 쓰이는 상황에서
     *     서버 실행 중: http://localhost:3000     <- 거짓말
     *     3000번 포트를 이미 다른 프로그램이...    <- 진짜
     * 이렇게 앞뒤가 안 맞는 메시지가 찍혀서 더 헷갈린다.
     *
     * 실제로 자리를 잡았다면 address()가 { port: 3000, ... } 을 돌려주고,
     * 잡지 못했다면 null을 돌려준다. 그래서 이 값으로 진짜 성공인지 가린다.
     * 실패한 경우에는 여기서 조용히 빠져나가고, 아래 error 핸들러가 설명을 맡는다.
     */
    if (!server.address()) return;

    console.log(`서버 실행 중: http://localhost:${PORT}`);
  });

  // listen은 곧바로 실패하지 않고 나중에 'error' 이벤트로 알려준다.
  // 이 핸들러를 달아두지 않으면 그 이벤트가 처리되지 않은 예외가 되어
  // 프로세스가 스택트레이스와 함께 죽는다.
  server.on('error', (error) => {
    console.error(explainListenFailure(error, PORT));
    process.exit(1);
  });

  // Ctrl+C로 끌 때 커넥션을 정리한다.
  const shutdown = async () => {
    server.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
})();

module.exports = ready;
