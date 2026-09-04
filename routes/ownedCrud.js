const mongoose = require('mongoose');
const express = require('express');
const auth = require('../middlewares/auth');

const DUPLICATE_KEY = 11000;

/* --------------------------------------------------------------- 페이지네이션 */

// ?page=&limit= 을 생략했을 때 쓰는 값. limit을 안 적고 page만 적는 경우가 많다.
const DEFAULT_LIMIT = 20;
// 클라이언트가 limit=1000000 처럼 보내 서버를 무리하게 만드는 것을 막는 상한선.
const MAX_LIMIT = 100;

/**
 * ?page=2&limit=10 을 해석한다.
 *
 * 돌려주는 값
 *   { paged: false }                  -> 페이지네이션 없이 전부 준다
 *   { paged: true, page, limit }      -> 그만큼 잘라서 준다
 *   { error: '...' }                  -> 값이 이상하다 (400으로 응답)
 *
 * 왜 잘못된 값을 조용히 고쳐 쓰지 않고 400을 주나
 *   page=0 이나 page=abc 를 슬쩍 1로 바꿔 응답하면, 화면은 "1페이지"를 받고도
 *   자기가 2페이지를 보고 있다고 착각한다. 틀린 요청은 틀렸다고 알려주는 편이
 *   버그를 훨씬 빨리 찾게 해 준다.
 */
function parsePaging({ page, limit }) {
  // 둘 다 안 보냈으면 페이지네이션을 하지 않는다.
  // 대시보드처럼 "그날 기록 전부"가 필요한 화면이 있어서 기존 동작을 그대로 남겨둔다.
  if (page === undefined && limit === undefined) return { paged: false };

  const toPositiveInt = (raw, fallback) => {
    if (raw === undefined || raw === '') return fallback;
    // Number()는 ' 3 '이나 ''도 숫자로 봐주지만, 여기서는 엄격하게 본다.
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) return null; // null = 잘못된 값
    return n;
  };

  const parsedPage = toPositiveInt(page, 1);
  if (parsedPage === null) return { error: 'page는 1 이상의 정수여야 합니다.' };

  const parsedLimit = toPositiveInt(limit, DEFAULT_LIMIT);
  if (parsedLimit === null) return { error: 'limit은 1 이상의 정수여야 합니다.' };
  if (parsedLimit > MAX_LIMIT) return { error: `limit은 ${MAX_LIMIT} 이하여야 합니다.` };

  return { paged: true, page: parsedPage, limit: parsedLimit };
}


/**
 * "로그인한 사용자가 소유한 자원"의 CRUD 라우터를 만든다.
 * 운동 일지·식단·루틴·신체지표가 모두 같은 뼈대를 쓰므로 한 곳에 모았다.
 *
 * 이 팩토리가 보장하는 정책 (자원이 늘어도 흔들리지 않아야 한다):
 *  - 모든 요청에 JWT 인증 필수
 *  - 미존재와 타인 소유를 구분하지 않고 둘 다 404
 *    (403을 주면 그 id의 자료가 존재한다는 사실이 노출된다)
 *  - id / userId / createdAt은 서버가 정하고 클라이언트 값은 무시한다
 *  - 목록은 ?page=&limit= 으로 잘라 받을 수 있다 (안 보내면 전부 준다)
 *
 * @param {import('mongoose').Model} o.Model
 * @param {Function} o.validate         (body) => 에러 메시지 | null
 * @param {Function} o.editableFields   (body) => 저장할 필드만 추린 객체
 * @param {string}   o.notFoundMessage  404 문구
 * @param {object}   [o.sort]           Mongo 정렬 객체 (예: { date: -1, _id: -1 })
 * @param {boolean}  [o.dateFilter]     true면 ?date=YYYY-MM-DD 필터 지원
 * @param {string}   [o.uniqueBy]       이 필드가 같으면 새로 만들지 않고 덮어쓴다
 */
module.exports = function createOwnedCrudRouter({
  Model,
  validate,
  editableFields,
  notFoundMessage,
  sort = { createdAt: -1, _id: -1 },
  dateFilter = false,
  uniqueBy = null,
}) {
  const router = express.Router();

  router.use(auth);

  const NOT_FOUND = { message: notFoundMessage };

  /**
   * ObjectId 형식이 아니면 조회 없이 404를 준다.
   * 그냥 넘기면 Mongoose가 CastError를 던져 500이 나고, 소유권 정책이 깨진다.
   * (인메모리 때는 Number('abc')가 NaN이 되어 자연스럽게 404였다)
   */
  const isBadId = (id) => !mongoose.isValidObjectId(id);

  // 소유권은 비교하지 않고 쿼리 조건으로 넘긴다.
  // JWT의 id는 문자열, DB의 userId는 ObjectId라서 ===로 비교하면 항상 false가 된다.
  const owned = (req) => ({ _id: req.params.id, userId: req.user.id });

  /**
   * 목록
   *
   * 페이지네이션을 왜 붙였나
   *   운동 일지는 매일 쌓인다. 1년만 지나도 수백 건이라, 목록을 부를 때마다
   *   전부 내려보내면 DB·네트워크·브라우저가 모두 손해를 본다.
   *   그래서 ?page=2&limit=10 처럼 필요한 만큼만 잘라 받을 수 있게 했다.
   *
   * 강사님 예시(08_board)와 다른 두 가지
   *   1. 예시는 주소에 페이지를 넣는다:  GET /board/list/2
   *      우리는 쿼리스트링을 쓴다:       GET /api/workouts?page=2&limit=10
   *      쿼리스트링은 "있어도 되고 없어도 되는 값"을 표현하기에 알맞고,
   *      이미 쓰고 있는 ?date=2026-08-30 와 자연스럽게 함께 쓸 수 있다.
   *      (?date=2026-08-30&page=2 처럼 조건을 겹쳐 걸 수 있다)
   *      경로에 넣으면 /board/list/2 와 /board/list 를 따로 만들어야 한다.
   *   2. 예시는 5개씩으로 개수가 코드에 고정되어 있다.
   *      우리는 화면마다 필요한 개수가 달라서 limit으로 받되, 상한선을 둔다.
   *
   * 응답은 왜 그대로 "배열"인가
   *   { items: [...], total: 42 } 처럼 감싸는 방식이 더 흔하긴 하다.
   *   하지만 그러면 이미 이 API를 쓰고 있는 화면(public/js)과 test.http가 전부 깨진다.
   *   또 page를 안 보냈을 때는 배열, 보냈을 때는 객체처럼 응답 모양이 두 가지가 되면
   *   쓰는 쪽이 매번 어느 쪽인지 확인해야 해서 더 헷갈린다.
   *   그래서 본문은 항상 배열로 두고, 총 개수 같은 부가 정보는 응답 헤더에 담는다.
   *   (GitHub API 등이 쓰는 X-Total-Count 방식이다)
   */
  router.get('/', async (req, res) => {
    const query = { userId: req.user.id };
    if (dateFilter && req.query.date) query.date = req.query.date;

    const paging = parsePaging(req.query);
    if (paging.error) return res.status(400).json({ message: paging.error });

    // page도 limit도 안 보냈으면 예전처럼 전부 돌려준다.
    if (!paging.paged) return res.json(await Model.find(query).sort(sort));

    const { page, limit } = paging;

    // 전체 개수를 먼저 센다. 화면이 "3 / 12 페이지"를 그리려면 총 개수가 필요하다.
    // countDocuments는 조건에 맞는 개수만 세고 문서 내용은 가져오지 않아 가볍다.
    const total = await Model.countDocuments(query);

    // skip(건너뛸 개수).limit(가져올 개수) 가 페이지네이션의 핵심이다.
    // 2페이지에 10개씩이면 앞의 10개를 건너뛰고 그 다음 10개를 가져온다.
    // 주의: sort를 반드시 함께 걸어야 한다. 정렬 없이 skip을 쓰면 순서가 보장되지 않아
    //       1페이지에 봤던 항목이 2페이지에 또 나올 수 있다.
    const items = await Model.find(query)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit);

    // 본문(배열)에는 담을 자리가 없는 정보를 헤더로 알려준다.
    // Math.max(..., 1) 은 결과가 0건일 때 totalPages가 0이 되어
    // 화면에 "1 / 0 페이지"라고 찍히는 것을 막기 위함이다.
    res.set({
      'X-Total-Count': String(total),
      'X-Total-Pages': String(Math.max(Math.ceil(total / limit), 1)),
      'X-Page': String(page),
      'X-Limit': String(limit),
    });

    res.json(items);
  });

  // 상세
  router.get('/:id', async (req, res) => {
    if (isBadId(req.params.id)) return res.status(404).json(NOT_FOUND);

    const found = await Model.findOne(owned(req));
    if (!found) return res.status(404).json(NOT_FOUND);

    res.json(found);
  });

  // 작성
  router.post('/', async (req, res) => {
    const body = req.body || {};

    const error = validate(body);
    if (error) return res.status(400).json({ message: error });

    // uniqueBy가 지정된 자원(신체지표 등)은 같은 값의 기존 항목을 덮어쓴다.
    // 새로 만든 게 아니므로 201이 아니라 200을 준다.
    if (uniqueBy) {
      const filter = { userId: req.user.id, [uniqueBy]: body[uniqueBy] };
      const update = { $set: editableFields(body) };

      try {
        const result = await Model.findOneAndUpdate(filter, update, {
          upsert: true,
          new: true,
          includeResultMetadata: true,
        });
        const existed = result.lastErrorObject?.updatedExisting === true;
        return res.status(existed ? 200 : 201).json(result.value);
      } catch (err) {
        // 같은 순간에 두 요청이 함께 insert를 시도하면 unique 인덱스가 하나를 막는다.
        // 사용자 입장에서는 덮어쓰기가 성공한 것이므로, 이미 생긴 문서에 다시 반영하고 200을 준다.
        if (err.code !== DUPLICATE_KEY) throw err;

        const retried = await Model.findOneAndUpdate(filter, update, { new: true });
        return res.json(retried);
      }
    }

    // userId를 마지막에 넣어, 클라이언트가 보낸 값으로 덮어쓸 수 없게 한다.
    const created = await Model.create({ ...editableFields(body), userId: req.user.id });
    res.status(201).json(created);
  });

  // 수정
  router.put('/:id', async (req, res) => {
    if (isBadId(req.params.id)) return res.status(404).json(NOT_FOUND);

    // 없는 자원과 남의 자원은 검증보다 먼저 걸러낸다. 인메모리 때와 순서를 맞춘다.
    if (!(await Model.exists(owned(req)))) return res.status(404).json(NOT_FOUND);

    const body = req.body || {};

    const error = validate(body);
    if (error) return res.status(400).json({ message: error });

    try {
      // _id / userId / createdAt은 건드리지 않고 나머지만 교체한다.
      const updated = await Model.findOneAndUpdate(
        owned(req),
        { $set: editableFields(body) },
        { new: true }
      );
      res.json(updated);
    } catch (err) {
      // uniqueBy가 걸린 자원에서 이미 있는 값으로 바꾸려 한 경우
      if (err.code !== DUPLICATE_KEY) throw err;
      res.status(409).json({ message: '같은 값의 기록이 이미 있습니다.' });
    }
  });

  // 삭제
  router.delete('/:id', async (req, res) => {
    if (isBadId(req.params.id)) return res.status(404).json(NOT_FOUND);

    const deleted = await Model.findOneAndDelete(owned(req));
    if (!deleted) return res.status(404).json(NOT_FOUND);

    res.json({ message: '삭제되었습니다.', id: String(deleted._id) });
  });

  return router;
};
