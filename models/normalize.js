/**
 * 응답 모양을 인메모리 때와 같게 맞추는 공통 설정.
 *
 * MongoDB는 `_id`(ObjectId)와 `__v`를 붙이는데, 그대로 내보내면
 * 프론트와 test.http가 참조하는 `id`가 사라지고 낯선 필드가 늘어난다.
 * 그래서 모든 모델이 이 함수를 거쳐 아래를 보장한다.
 *
 *   _id  ->  id (24자리 문자열)
 *   __v  ->  숨김
 *   ObjectId 필드 -> 문자열
 *
 * @param {string[]} [hide] 응답에서 빼야 할 필드 (예: password, mealOrder)
 */
function normalizeJson(schema, hide = []) {
  schema.set('toJSON', {
    versionKey: false,
    transform(doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;

      // 소유자 id도 문자열로. 프론트가 그대로 비교할 수 있어야 한다.
      if (ret.userId) ret.userId = ret.userId.toString();

      for (const field of hide) delete ret[field];
      return ret;
    },
  });
}

/**
 * 중첩 문서(세트·음식)에는 _id를 붙이지 않는다.
 * 붙이면 세트마다 쓰지도 않는 id가 응답에 끼어들어 지금 형태와 달라진다.
 */
const SUBDOC = { _id: false };

// createdAt만 쓴다. updatedAt까지 켜면 지금 없던 필드가 응답에 생긴다.
const TIMESTAMPS = { timestamps: { createdAt: true, updatedAt: false } };

module.exports = { normalizeJson, SUBDOC, TIMESTAMPS };
