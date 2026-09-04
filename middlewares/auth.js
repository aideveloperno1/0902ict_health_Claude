const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { jwtSecret } = require('../jwtSecret');
const User = require('../models/User');

// 토큰 없음 / 형식 오류 / 만료 / 변조를 구분하지 않고 모두 401로 응답한다.
module.exports = async function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: '인증이 필요합니다.' });
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ message: '인증이 필요합니다.' });
  }

  try {
    // 서명할 때(routes/auth.js)와 반드시 같은 키를 써야 하므로 jwtSecret.js에서 가져온다.
    // 예전에는 여기에 `process.env.JWT_SECRET || 'dev-secret'`이라고 직접 적어두었는데,
    // 같은 문장이 두 파일에 흩어져 있으면 한쪽만 고쳤을 때 검증이 조용히 깨진다.
    const payload = jwt.verify(token, jwtSecret());

    // MongoDB 전환 전에 발급된 토큰은 id가 숫자(1, 2, 3)다.
    // 그대로 통과시키면 모든 쿼리에서 CastError가 나 500이 된다.
    // 여기서 걸러 401을 주면, 화면이 알아서 로그아웃하고 다시 로그인시킨다.
    if (!mongoose.isValidObjectId(payload.id)) {
      return res.status(401).json({ message: '유효하지 않은 토큰입니다.' });
    }

    /**
     * 비밀번호를 바꾼 뒤에 무효가 된 토큰인지 확인한다.
     *
     * 토큰 안의 tv(토큰 세대 번호)를 DB의 현재 번호와 맞춰 본다. 비밀번호를 바꾸면
     * DB의 번호만 올라가므로, 그 전에 나간 토큰은 번호가 뒤처져 여기서 걸린다.
     *
     * 이 검사 때문에 요청마다 DB를 한 번 더 보게 된다. 토큰만으로 끝내는 것보다
     * 느리지만, "비밀번호를 바꿨는데도 훔쳐 간 사람이 계속 들어올 수 있다"는
     * 문제를 없애는 값으로는 싸다. (_id 인덱스를 타는 조회라 빠르다)
     *
     * ?? 0 은 이 기능이 생기기 전에 발급된 토큰(tv가 없음)과
     * 그 전에 만들어진 사용자 문서를 위한 것이다. 둘 다 0세대로 본다.
     */
    const user = await User.findById(payload.id).select('tokenVersion');
    if (!user) {
      return res.status(401).json({ message: '유효하지 않은 토큰입니다.' });
    }

    if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) {
      return res.status(401).json({ message: '비밀번호가 변경되었습니다. 다시 로그인해 주세요.' });
    }

    req.user = { id: payload.id, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ message: '유효하지 않은 토큰입니다.' });
  }
};
