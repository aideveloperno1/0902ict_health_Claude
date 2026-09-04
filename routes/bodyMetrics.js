const createOwnedCrudRouter = require('./ownedCrud');
const BodyMetric = require('../models/BodyMetric');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

function validate({ date, weightKg, conditionMemo }) {
  if (!date) return 'date는 필수입니다.';
  if (!DATE_RE.test(date)) return 'date는 YYYY-MM-DD 형식이어야 합니다.';

  if (weightKg !== undefined && weightKg !== null) {
    if (!isNumber(weightKg)) return 'weightKg는 숫자여야 합니다.';
    if (weightKg <= 0 || weightKg > 500) return 'weightKg는 0보다 크고 500 이하여야 합니다.';
  }

  if (conditionMemo !== undefined && conditionMemo !== null && typeof conditionMemo !== 'string') {
    return 'conditionMemo는 문자열이어야 합니다.';
  }
  return null;
}

const editableFields = (body) => ({
  date: body.date,
  weightKg: isNumber(body.weightKg) ? body.weightKg : null,
  conditionMemo: body.conditionMemo || '',
});

module.exports = createOwnedCrudRouter({
  Model: BodyMetric,
  validate,
  editableFields,
  notFoundMessage: '신체 기록을 찾을 수 없습니다.',
  dateFilter: true,

  // 하루에 두 건이 있으면 기초대사량 계산에 어느 체중을 쓸지 모호해진다.
  // 같은 날짜로 저장하면 새로 만들지 않고 덮어쓴다. (이때는 201이 아니라 200)
  uniqueBy: 'date',

  sort: { date: -1, _id: -1 },
});
