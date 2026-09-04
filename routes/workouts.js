const createOwnedCrudRouter = require('./ownedCrud');
const Workout = require('../models/Workout');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 부위는 운동 단위로 붙는다. 일지 단위가 아니다.
const MUSCLES = ['가슴', '등', '하체', '어깨', '팔', '복근'];

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

// 통과하면 null, 실패하면 에러 메시지를 돌려준다.
function validate({ date, title, exercises, durationMin }) {
  if (!date || !title) return 'date, title은 필수입니다.';
  if (!DATE_RE.test(date)) return 'date는 YYYY-MM-DD 형식이어야 합니다.';

  if (durationMin !== undefined && durationMin !== null) {
    if (!isNumber(durationMin) || durationMin < 0) {
      return 'durationMin은 0 이상의 숫자여야 합니다.';
    }
  }

  if (exercises === undefined) return null;
  if (!Array.isArray(exercises)) return 'exercises는 배열이어야 합니다.';

  for (const [i, exercise] of exercises.entries()) {
    if (!exercise || typeof exercise.name !== 'string' || !exercise.name.trim()) {
      return `exercises[${i}].name은 필수 문자열입니다.`;
    }

    const muscle = exercise.targetMuscle;
    if (muscle !== undefined && muscle !== null && muscle !== '' && !MUSCLES.includes(muscle)) {
      return `exercises[${i}].targetMuscle은 ${MUSCLES.join('/')} 중 하나여야 합니다.`;
    }

    if (exercise.sets === undefined) continue;
    if (!Array.isArray(exercise.sets)) return `exercises[${i}].sets는 배열이어야 합니다.`;

    for (const [j, set] of exercise.sets.entries()) {
      if (!set || typeof set !== 'object') {
        return `exercises[${i}].sets[${j}]는 객체여야 합니다.`;
      }
      for (const key of ['weightKg', 'reps']) {
        if (set[key] !== undefined && set[key] !== null && !isNumber(set[key])) {
          return `exercises[${i}].sets[${j}].${key}는 숫자여야 합니다.`;
        }
      }
      if (set.done !== undefined && typeof set.done !== 'boolean') {
        return `exercises[${i}].sets[${j}].done은 true 또는 false여야 합니다.`;
      }
    }
  }
  return null;
}

/**
 * 저장 형태를 서버가 확정한다.
 * setNo는 클라이언트 값을 믿지 않고 순서대로 다시 매긴다. 중간 세트를 지워도 번호가 이어진다.
 * 볼륨 같은 파생값은 저장하지 않는다. 저장하면 원본과 어긋난다.
 */
const normalizeExercises = (exercises = []) =>
  exercises.map((exercise) => ({
    name: exercise.name,
    targetMuscle: exercise.targetMuscle || '',
    sets: (exercise.sets || []).map((set, index) => ({
      setNo: index + 1,
      weightKg: isNumber(set.weightKg) ? set.weightKg : null,
      reps: isNumber(set.reps) ? set.reps : null,
      done: set.done === true,
    })),
  }));

const editableFields = (body) => ({
  date: body.date,
  title: body.title,
  durationMin: isNumber(body.durationMin) ? body.durationMin : null,
  exercises: normalizeExercises(body.exercises),
  memo: body.memo || '',
});

module.exports = createOwnedCrudRouter({
  Model: Workout,
  validate,
  editableFields,
  notFoundMessage: '일지를 찾을 수 없습니다.',
  dateFilter: true,
  // 같은 날짜가 여러 건이면 나중에 쓴 것이 위로. ObjectId에 생성 시각이 들어 있어 _id로 갈음된다.
  sort: { date: -1, createdAt: -1, _id: -1 },
});
