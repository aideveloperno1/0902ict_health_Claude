const createOwnedCrudRouter = require('./ownedCrud');
const Meal = require('../models/Meal');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MEAL_TYPES = ['아침', '점심', '저녁', '간식'];
// 섭취량은 숫자와 단위를 나눠서 받는다. 한 필드에 "150g"처럼 담으면 합산할 수 없다.
const UNITS = ['g', '인분'];

// 하루 안에서는 먹은 순서대로 보이는 편이 읽기 좋다.
const MEAL_ORDER = Object.fromEntries(MEAL_TYPES.map((type, index) => [type, index]));

const NUTRIENT_KEYS = ['amount', 'kcal', 'carbsG', 'proteinG', 'fatG'];

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

function validate({ date, mealType, foods }) {
  if (!date || !mealType) return 'date, mealType은 필수입니다.';
  if (!DATE_RE.test(date)) return 'date는 YYYY-MM-DD 형식이어야 합니다.';
  if (!MEAL_TYPES.includes(mealType)) {
    return `mealType은 ${MEAL_TYPES.join('/')} 중 하나여야 합니다.`;
  }

  if (foods === undefined) return null;
  if (!Array.isArray(foods)) return 'foods는 배열이어야 합니다.';

  for (const [i, food] of foods.entries()) {
    if (!food || typeof food.name !== 'string' || !food.name.trim()) {
      return `foods[${i}].name은 필수 문자열입니다.`;
    }

    const unit = food.unit;
    if (unit !== undefined && unit !== null && unit !== '' && !UNITS.includes(unit)) {
      return `foods[${i}].unit은 ${UNITS.join('/')} 중 하나여야 합니다.`;
    }

    for (const key of NUTRIENT_KEYS) {
      const value = food[key];
      if (value === undefined || value === null) continue;
      if (!isNumber(value)) return `foods[${i}].${key}는 숫자여야 합니다.`;
      if (value < 0) return `foods[${i}].${key}는 0 이상이어야 합니다.`;
    }
  }
  return null;
}

/**
 * 총 칼로리나 탄단지 비율 같은 합계는 저장하지 않는다. 화면에서 계산한다.
 * 사용자가 넣은 kcal을 그대로 보관한다. 탄단지로 계산한 값으로 덮어쓰지 않는다.
 * (둘이 어긋나도 사용자가 적은 값이 우선이다)
 */
const normalizeFoods = (foods = []) =>
  foods.map((food) => ({
    name: food.name,
    amount: isNumber(food.amount) ? food.amount : null,
    unit: UNITS.includes(food.unit) ? food.unit : 'g',
    kcal: isNumber(food.kcal) ? food.kcal : null,
    carbsG: isNumber(food.carbsG) ? food.carbsG : null,
    proteinG: isNumber(food.proteinG) ? food.proteinG : null,
    fatG: isNumber(food.fatG) ? food.fatG : null,
  }));

const editableFields = (body) => ({
  date: body.date,
  mealType: body.mealType,

  // 끼니 순서는 가나다순이 아니라서(간식·아침·저녁·점심) mealType만으로는 정렬할 수 없다.
  // 순서를 숫자로 함께 저장해 DB가 정렬할 수 있게 한다. mealType에서 파생되므로 서버가 정한다.
  mealOrder: MEAL_ORDER[body.mealType] ?? 99,

  foods: normalizeFoods(body.foods),
  memo: body.memo || '',
});

module.exports = createOwnedCrudRouter({
  Model: Meal,
  validate,
  editableFields,
  notFoundMessage: '식단을 찾을 수 없습니다.',
  dateFilter: true,
  // 날짜는 최신순, 같은 날 안에서는 먹은 순서(아침 → 점심 → 저녁 → 간식)
  sort: { date: -1, mealOrder: 1, createdAt: 1 },
});
