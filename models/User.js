const mongoose = require('mongoose');
const { normalizeJson, SUBDOC, TIMESTAMPS } = require('./normalize');

// 기초대사량 계산에 쓰는 값들. 전부 선택 입력이라 기본값은 null이다.
const profileSchema = new mongoose.Schema(
  {
    sex: { type: String, default: null },
    birthYear: { type: Number, default: null },
    heightCm: { type: Number, default: null },
  },
  SUBDOC
);

const userSchema = new mongoose.Schema(
  {
    /**
     * lowercase·trim을 붙인 이유
     *
     * 전에는 원문 그대로 저장했다. 그러면 'User@x.com'과 'user@x.com'이
     * 서로 다른 값이라 unique 인덱스에 함께 들어가고, 같은 사람이 대문자로 한 번
     * 소문자로 한 번 가입해 계정이 둘로 갈린다.
     * 로그인할 때 어느 쪽으로 쳤느냐에 따라 "비밀번호가 틀렸다"는 말을 듣게 된다.
     *
     * 게다가 로그인 횟수 제한(routes/auth.js)은 이미 이메일을 소문자로 바꿔서 세고 있었다.
     * 세는 기준과 저장 기준이 달라서, 대소문자를 바꿔 가며 시도하면 제한을 피해 갈 수 있었다.
     *
     * mongoose의 lowercase는 저장할 때뿐 아니라 조회 조건에도 적용된다.
     * 그래서 findOne({ email })·exists({ email })를 고치지 않아도 함께 맞춰진다.
     *
     * ⚠ 이미 대문자가 섞인 계정이 DB에 있다면 그 계정은 조회되지 않는다.
     *    README의 "기존 데이터 정리" 항목을 참고해 한 번만 소문자로 바꿔 주면 된다.
     */
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // 기본 조회에서 아예 빠진다. 로그인할 때만 .select('+password')로 꺼낸다.
    password: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true },

    /**
     * 토큰 세대 번호. 비밀번호를 바꿀 때마다 1씩 올린다.
     *
     * 왜 필요한가
     *   비밀번호를 바꿔도 이미 발급된 토큰은 그대로 살아 있다. 토큰은 서명만 확인할 뿐
     *   매번 DB를 보지 않기 때문이다. 그래서 비밀번호가 새어 나가 바꾼 경우에도
     *   훔쳐 간 사람은 남은 시간 동안 계속 들어올 수 있다.
     *
     *   그래서 토큰 안에 이 번호를 함께 넣어 두고(tv), middlewares/auth.js가
     *   "토큰에 적힌 번호가 지금 번호와 다르면 거부"하도록 한다.
     *   번호를 올리는 순간 그 전에 나간 토큰이 한꺼번에 전부 무효가 된다.
     *
     * 왜 "바꾼 시각"이 아니라 번호인가
     *   처음에는 마지막 변경 시각을 적어 두고 토큰의 발급 시각(iat)과 비교했는데,
     *   iat은 초 단위라 소수점이 없다. 옛 토큰과 새 토큰이 같은 1초 안에 만들어지면
     *   둘의 iat이 같아져서 구분할 수 없었다(실제로 테스트에서 옛 토큰이 통과했다).
     *   번호로 세면 시간 해상도와 무관하게 항상 정확하다.
     *
     * 응답에는 내보내지 않는다(아래 normalizeJson). 사용자가 알 필요가 없는 내부 값이다.
     */
    tokenVersion: { type: Number, default: 0 },

    profile: { type: profileSchema, default: () => ({}) },
  },
  TIMESTAMPS
);

// select:false로 이미 막았지만, 혹시 꺼내 온 문서를 그대로 내보내도 새지 않게 한 겹 더 막는다.
normalizeJson(userSchema, ['password', 'tokenVersion']);

module.exports = mongoose.model('User', userSchema);
