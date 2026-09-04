const createOwnedCrudRouter = require('./ownedCrud');
const Routine = require('../models/Routine');

const MUSCLES = ['가슴', '등', '하체', '어깨', '팔', '복근'];

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * 루틴은 "계획"이지 "기록"이 아니다. 그래서 운동 일지와 두 가지가 다르다.
 *  - 날짜가 없다
 *  - 세트에 완료 여부(done)가 없다. 아직 하지 않은 것이므로.
 */
function validate({ name, exercises }) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    return 'name은 필수입니다.';
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
    }
  }
  return null;
}

const normalizeExercises = (exercises = []) =>
  exercises.map((exercise) => ({
    name: exercise.name,
    targetMuscle: exercise.targetMuscle || '',
    sets: (exercise.sets || []).map((set, index) => ({
      setNo: index + 1,
      weightKg: isNumber(set.weightKg) ? set.weightKg : null,
      reps: isNumber(set.reps) ? set.reps : null,
    })),
  }));

const editableFields = (body) => ({
  name: body.name.trim(),
  exercises: normalizeExercises(body.exercises),
});

module.exports = createOwnedCrudRouter({
  Model: Routine,
  validate,
  editableFields,
  notFoundMessage: '루틴을 찾을 수 없습니다.',
  sort: { createdAt: -1, _id: -1 },
});
