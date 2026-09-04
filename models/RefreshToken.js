const mongoose = require('mongoose');

/**
 * 로그인 상태를 이어 주는 "갱신 토큰".
 *
 * 왜 DB에 저장하나
 *   액세스 토큰(JWT)은 서명만 확인하므로 서버가 따로 보관하지 않는다. 대신
 *   한 번 발급하면 만료될 때까지 취소할 방법이 없다. 그래서 수명을 15분으로 짧게 둔다.
 *
 *   갱신 토큰은 14일짜리라 취소할 수단이 반드시 있어야 한다. 로그아웃하거나
 *   비밀번호를 바꿨을 때 즉시 무효로 만들어야 하기 때문이다.
 *   그래서 이것만은 DB에 남기고, 지우는 것으로 취소를 구현한다.
 *
 * 왜 토큰을 그대로 저장하지 않고 해시로 저장하나
 *   비밀번호와 같은 이유다. DB가 통째로 새어 나가도 그 내용만으로는
 *   남의 계정에 로그인할 수 없어야 한다. 저장된 것은 해시라 되돌릴 수 없다.
 *
 *   비밀번호와 달리 bcrypt가 아니라 sha256을 쓴다. 갱신 토큰은 사람이 정한 값이 아니라
 *   서버가 만든 완전한 무작위 값이라, 추측으로 맞힐 수 없어 느린 해시가 필요 없다.
 *   오히려 요청마다 계산하므로 빠른 편이 낫다.
 */
const refreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // 토큰 원본은 사용자만 갖고 있다. 서버에는 이 해시만 남는다.
    tokenHash: { type: String, required: true, unique: true },

    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

/**
 * 만료된 문서를 MongoDB가 알아서 지우게 한다(TTL 인덱스).
 *
 * expireAfterSeconds: 0 은 "expiresAt에 적힌 시각이 지나면 지워라"라는 뜻이다.
 * 이게 없으면 로그인할 때마다 문서가 쌓이기만 하고 아무도 치우지 않는다.
 * 삭제는 MongoDB가 1분 주기로 돌면서 처리하므로 정확히 그 시각은 아니고 조금 늦을 수 있다.
 * 그래서 코드에서도 만료 여부를 한 번 더 확인한다. TTL은 청소용이지 검사용이 아니다.
 */
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// 로그아웃·비밀번호 변경 때 "이 사용자의 토큰 전부"를 지우므로 userId로도 찾는다.
refreshTokenSchema.index({ userId: 1 });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
