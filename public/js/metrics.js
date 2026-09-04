// 계산식을 한 곳에 모은다.
// 근거를 한눈에 확인하고 고칠 수 있어야 하므로 화면 코드에 흩어 놓지 않는다.
// 여기서 나온 값은 전부 화면 표시용이며 서버에 저장하지 않는다. 저장하면 원본과 어긋난다.

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * 세트 볼륨 = 무게 × 횟수.
 * 완료 체크가 없는 세트는 0으로 친다. (확정 사항 1: 미완료 세트는 볼륨에서 제외)
 */
export function setVolume(set) {
  if (!set || set.done !== true) return 0;
  return num(set.weightKg) * num(set.reps);
}

export function exerciseVolume(exercise) {
  return (exercise?.sets || []).reduce((sum, set) => sum + setVolume(set), 0);
}

export function workoutVolume(workout) {
  return (workout?.exercises || []).reduce((sum, ex) => sum + exerciseVolume(ex), 0);
}

/** 완료된 세트 수 */
export function doneSetCount(workout) {
  return (workout?.exercises || []).reduce(
    (sum, ex) => sum + (ex.sets || []).filter((set) => set.done === true).length,
    0
  );
}

/** 일지에 쓰인 부위를 중복 없이, 등장 순서대로 뽑는다. 목록 카드의 배지에 쓴다. */
export function muscleTags(workout) {
  const tags = [];
  for (const exercise of workout?.exercises || []) {
    const muscle = exercise.targetMuscle;
    if (muscle && !tags.includes(muscle)) tags.push(muscle);
  }
  return tags;
}

/* ------------------------------------------------------------------ 표시 형식 */

/** 1120 -> "1,120kg", 0이나 값 없음 -> "—" */
export function formatVolume(value) {
  return value ? `${Math.round(value).toLocaleString('ko-KR')}kg` : '—';
}

/** 60 -> "60분", 없으면 빈 문자열 */
export function formatDuration(minutes) {
  return num(minutes) > 0 ? `${minutes}분` : '';
}

/* ------------------------------------------------------------------ 식단 */

// 1g당 칼로리. 탄수화물·단백질 4, 지방 9.
const KCAL_PER_G = { carbs: 4, protein: 4, fat: 9 };

/** 사용자가 넣은 kcal을 그대로 합산한다. 탄단지로 계산한 값으로 덮어쓰지 않는다. (확정 사항 3) */
export function mealKcal(meal) {
  return (meal?.foods || []).reduce((sum, food) => sum + num(food.kcal), 0);
}

export function mealMacros(meal) {
  return (meal?.foods || []).reduce(
    (acc, food) => ({
      carbsG: acc.carbsG + num(food.carbsG),
      proteinG: acc.proteinG + num(food.proteinG),
      fatG: acc.fatG + num(food.fatG),
    }),
    { carbsG: 0, proteinG: 0, fatG: 0 }
  );
}

/** 여러 끼니를 합친다. 하루 결산에 쓴다. */
export function sumMeals(meals = []) {
  return meals.reduce(
    (acc, meal) => {
      const macros = mealMacros(meal);
      return {
        kcal: acc.kcal + mealKcal(meal),
        carbsG: acc.carbsG + macros.carbsG,
        proteinG: acc.proteinG + macros.proteinG,
        fatG: acc.fatG + macros.fatG,
      };
    },
    { kcal: 0, carbsG: 0, proteinG: 0, fatG: 0 }
  );
}

/**
 * 탄단지 g를 칼로리로 환산해 비율(%)을 낸다.
 * 셋 다 0이면 null을 돌려준다. 이때 화면은 막대 대신 "영양 정보 없음"을 보여준다.
 */
export function macroRatio({ carbsG = 0, proteinG = 0, fatG = 0 } = {}) {
  const carbs = num(carbsG) * KCAL_PER_G.carbs;
  const protein = num(proteinG) * KCAL_PER_G.protein;
  const fat = num(fatG) * KCAL_PER_G.fat;

  const total = carbs + protein + fat;
  if (total <= 0) return null;

  return {
    carbs: (carbs / total) * 100,
    protein: (protein / total) * 100,
    fat: (fat / total) * 100,
  };
}

/**
 * 탄단지로 계산한 칼로리.
 * 사용자가 넣은 kcal과 어긋날 수 있으므로 화면에서 "힌트"로만 보여준다. (확정 사항 3)
 */
export function kcalFromMacros({ carbsG = 0, proteinG = 0, fatG = 0 } = {}) {
  return (
    num(carbsG) * KCAL_PER_G.carbs +
    num(proteinG) * KCAL_PER_G.protein +
    num(fatG) * KCAL_PER_G.fat
  );
}

/** 1840 -> "1,840 kcal", 0이면 "0 kcal" */
export function formatKcal(value) {
  return `${Math.round(num(value)).toLocaleString('ko-KR')} kcal`;
}

/** 150, 'g' -> "150g" / 1, '인분' -> "1인분" / 값 없으면 "—" */
export function formatAmount(amount, unit) {
  if (amount === null || amount === undefined) return '—';
  return `${amount}${unit || 'g'}`;
}

/* ------------------------------------------------------------------ 신체 · 기초대사량 */

/** 출생연도로 만 나이를 어림한다. 값이 없으면 null. */
export function ageFrom(birthYear) {
  if (!num(birthYear)) return null;
  return new Date().getFullYear() - birthYear;
}

/**
 * 기초대사량(BMR) — Mifflin-St Jeor 식.
 *   남: 10×체중(kg) + 6.25×키(cm) − 5×나이 + 5
 *   여: 10×체중(kg) + 6.25×키(cm) − 5×나이 − 161
 *
 * 입력이 하나라도 없으면 **계산하지 않고 null을 돌려준다.**
 * 임의의 기본값을 넣으면 그럴듯하지만 틀린 숫자를 보여주게 된다.
 */
export function bmr(profile, weightKg) {
  const { sex, heightCm } = profile || {};
  const age = ageFrom(profile?.birthYear);

  if (!sex || !num(heightCm) || !num(weightKg) || age === null) return null;

  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

/** BMR 계산에 무엇이 비어 있는지 알려준다. 화면에서 "무엇을 채워야 하는지" 안내하는 데 쓴다. */
export function missingBmrInputs(profile, weightKg) {
  const missing = [];
  if (!profile?.sex) missing.push('성별');
  if (!num(profile?.birthYear)) missing.push('출생연도');
  if (!num(profile?.heightCm)) missing.push('키');
  if (!num(weightKg)) missing.push('체중');
  return missing;
}

/** 72.4 -> "72.4kg", 값 없으면 "—" */
export function formatWeight(value) {
  return num(value) ? `${value}kg` : '—';
}

/* ------------------------------------------------------------------ 칼로리 밸런스 (추정) */

// 근력운동의 대사당량(MET). 강도에 따라 3~6 사이인데 중간값을 쓴다.
// 이 상수 하나로 계산하므로 실제 소모량과 차이가 클 수 있다. 화면에 "추정치"라고 밝힌다.
export const RESISTANCE_MET = 5.0;

/**
 * 운동 소모 칼로리 추정 = MET × 체중(kg) × 시간(h).
 *
 * 볼륨(무게×횟수)으로는 칼로리를 구할 수 없다. 그건 일의 양이지 소모량이 아니다.
 * 그래서 일지에 운동 시간(durationMin)을 받는다.
 *
 * 체중을 모르면 추정 자체가 불가능하므로 null.
 * 운동 시간이 없으면(그날 운동을 안 했으면) 소모는 0이다. 이건 "모름"이 아니다.
 */
export function exerciseCalories(durationMin, weightKg) {
  if (!num(weightKg)) return null;

  const minutes = num(durationMin);
  if (minutes <= 0) return 0;

  return RESISTANCE_MET * weightKg * (minutes / 60);
}

/** 일일 순 칼로리 = (기초대사량 + 운동 소모) − 섭취. 앞의 둘 중 하나라도 모르면 null. */
export function netCalories({ bmrValue, burned, intake }) {
  if (bmrValue === null || bmrValue === undefined) return null;
  if (burned === null || burned === undefined) return null;

  return bmrValue + burned - num(intake);
}

/** +190 -> "+190 kcal", -320 -> "-320 kcal" */
export function formatSigned(value) {
  const rounded = Math.round(num(value));
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toLocaleString('ko-KR')} kcal`;
}
