// 통합 대시보드. 고른 날짜의 운동·식단·신체 기록을 한 화면에 모아 본다.
//
// 집계 API를 따로 만들지 않고 기존 요청 4개를 병렬로 받아 조합한다.
// 백엔드를 순수 CRUD로 유지해야 검증이 단순해지기 때문이다.

import { api } from '../api.js';
import { mountView, el, showStatus, navSnapshot, isStale } from '../ui.js';
import { today, shiftDate } from '../dates.js';
import {
  workoutVolume, exerciseVolume, formatVolume, formatDuration,
  mealKcal, sumMeals, macroRatio, formatKcal,
  bmr, missingBmrInputs, exerciseCalories, netCalories,
  formatSigned, formatWeight,
} from '../metrics.js';

// 화면을 떠났다 돌아와도 보던 날짜를 유지한다. 주소에는 넣지 않는다(라우트를 늘리지 않기 위해).
let selectedDate = null;

const line = (className, text) => {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return element;
};

/* ------------------------------------------------------------------ 운동 */

function renderWorkouts(root, workouts) {
  const box = el(root, 'workouts');
  box.replaceChildren();

  const total = workouts.reduce((sum, workout) => sum + workoutVolume(workout), 0);
  el(root, 'volume').textContent = formatVolume(total);

  if (workouts.length === 0) {
    box.append(line('dash-empty', '기록된 운동이 없습니다.'));
    return;
  }

  for (const workout of workouts) {
    const block = document.createElement('div');
    block.className = 'dash-block';

    const head = document.createElement('div');
    head.className = 'dash-block-head';
    head.append(line('dash-block-title', workout.title));

    const duration = formatDuration(workout.durationMin);
    if (duration) head.append(line('dash-block-sub', duration));
    block.append(head);

    for (const exercise of workout.exercises || []) {
      const row = document.createElement('div');
      row.className = 'dash-row';
      row.append(line('dash-row-name', exercise.name));
      row.append(line('dash-row-value', formatVolume(exerciseVolume(exercise))));
      block.append(row);
    }

    box.append(block);
  }
}

/* ------------------------------------------------------------------ 식단 */

function renderMeals(root, meals) {
  const box = el(root, 'meals');
  box.replaceChildren();

  const totals = sumMeals(meals);
  el(root, 'kcal').textContent = formatKcal(totals.kcal);

  if (meals.length === 0) {
    box.append(line('dash-empty', '기록된 식단이 없습니다.'));
    el(root, 'bar').hidden = true;
    el(root, 'legend').textContent = '';
    return;
  }

  for (const meal of meals) {
    const row = document.createElement('div');
    row.className = 'dash-row';

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = meal.mealType;

    const name = line('dash-row-name', (meal.foods || []).map((f) => f.name).join(', ') || '—');

    row.append(badge, name, line('dash-row-value', formatKcal(mealKcal(meal))));
    box.append(row);
  }

  const ratio = macroRatio(totals);
  const bar = el(root, 'bar');

  if (!ratio) {
    bar.hidden = true;
    el(root, 'legend').textContent = '영양 정보 없음';
    return;
  }

  bar.hidden = false;
  el(root, 'carbs').style.flexGrow = ratio.carbs;
  el(root, 'protein').style.flexGrow = ratio.protein;
  el(root, 'fat').style.flexGrow = ratio.fat;

  const pct = (value) => Math.round(value);
  el(root, 'legend').textContent =
    `탄 ${pct(ratio.carbs)}% · 단 ${pct(ratio.protein)}% · 지 ${pct(ratio.fat)}%`;
}

/* ------------------------------------------------------------------ 신체 · 밸런스 */

/**
 * 그날의 체중을 찾는다. 그날 기록이 없으면 그 이전의 가장 최근 기록을 쓰되,
 * 어느 날짜 값인지 화면에 밝힌다. 출처를 숨기고 쓰면 안 된다.
 */
function resolveWeight(records, date) {
  const exact = records.find((record) => record.date === date && record.weightKg !== null);
  if (exact) return { weightKg: exact.weightKg, fromDate: date };

  const previous = records
    .filter((record) => record.date < date && record.weightKg !== null)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  return previous
    ? { weightKg: previous.weightKg, fromDate: previous.date }
    : { weightKg: null, fromDate: null };
}

function renderBody(root, records, date) {
  const record = records.find((item) => item.date === date);

  if (!record) {
    el(root, 'bodyInfo').textContent = '이 날짜의 기록이 없습니다.';
    return;
  }

  const parts = [formatWeight(record.weightKg)];
  if (record.conditionMemo) parts.push(record.conditionMemo);
  el(root, 'bodyInfo').textContent = parts.join('  ·  ');
}

/**
 * 계산할 수 없을 때 부르는 함수.
 * 숨기기만 하면 앞서 본 날짜의 수식이 숨겨진 채 남는다. 날짜를 옮겨 다니는 화면이라
 * 잘못된 값이 되살아나지 않도록 반드시 비운다.
 */
function clearBalance(root, message) {
  el(root, 'formula').textContent = '';
  el(root, 'net').textContent = '';

  el(root, 'balance').hidden = true;
  el(root, 'balanceMissing').hidden = false;
  el(root, 'balanceMissing').textContent = message;
}

// date는 이 화면이 "불러오기 시작할 때" 고른 날짜다. 전역 selectedDate를 직접 읽지 않는다.
// 응답을 기다리는 사이 사용자가 날짜를 옮기면 둘이 어긋나, 체중 출처 문구가 틀리게 찍힌다.
function renderBalance(root, { profile, weight, workouts, intake, date }) {
  const balance = el(root, 'balance');
  const missingEl = el(root, 'balanceMissing');

  const missing = missingBmrInputs(profile, weight.weightKg);
  if (missing.length > 0) {
    return clearBalance(
      root,
      `${missing.join(' · ')}이(가) 없어 계산할 수 없습니다. 프로필과 내 몸에서 입력하면 표시됩니다.`
    );
  }

  const bmrValue = bmr(profile, weight.weightKg);
  const totalMinutes = workouts.reduce((sum, workout) => sum + (workout.durationMin || 0), 0);
  const burned = exerciseCalories(totalMinutes, weight.weightKg);
  const net = netCalories({ bmrValue, burned, intake });

  balance.hidden = false;
  missingEl.hidden = true;
  missingEl.textContent = ''; // 앞 날짜의 안내 문구가 숨겨진 채 남지 않도록

  const source = weight.fromDate === date ? '' : ` · 체중은 ${weight.fromDate} 기록 기준`;

  el(root, 'formula').textContent =
    `기초대사 ${Math.round(bmrValue).toLocaleString('ko-KR')}` +
    ` + 운동 소모 ${Math.round(burned).toLocaleString('ko-KR')}` +
    ` − 섭취 ${Math.round(intake).toLocaleString('ko-KR')}${source}`;

  el(root, 'net').textContent = formatSigned(net);

  /**
   * 순 칼로리 = (기초대사 + 운동 소모) − 섭취  (PLAN.md 9장)
   *
   * 그래서 부호의 뜻은 이렇다:
   *   net > 0  소모가 섭취보다 많다 → 칼로리 적자(deficit)
   *   net < 0  섭취가 소모보다 많다 → 칼로리 잉여(surplus)
   *
   * is-surplus는 잉여일 때 앰버색(--fat)으로 강조하는 클래스이므로 net < 0이 맞다.
   * 전에는 net > 0에 걸려 있어서, 적자인 날에 "잉여" 강조가 켜지고
   * 정작 과식한 날에는 아무 표시가 없었다.
   */
  el(root, 'net').classList.toggle('is-surplus', net < 0);

  // -1,000 ~ +1,000 구간에 표시한다. 벗어나면 양 끝에 붙는다.
  const ratio = Math.min(Math.max((net + 1000) / 2000, 0), 1);
  el(root, 'marker').style.left = `${ratio * 100}%`;
}

/* ------------------------------------------------------------------ 불러오기 */

async function load(root) {
  const nav = navSnapshot();
  const date = selectedDate;

  for (const name of ['workoutStatus', 'mealStatus', 'bodyStatus']) {
    showStatus(el(root, name), '불러오는 중…');
  }

  // Promise.all은 하나만 실패해도 전부 버린다.
  // 식단 조회가 실패했다고 운동까지 안 보이면 안 되므로 allSettled를 쓴다.
  const [workoutsResult, mealsResult, bodyResult, profileResult] = await Promise.allSettled([
    api.listWorkouts(date),
    api.listMeals(date),
    api.listBodyMetrics(),
    api.getMe(),
  ]);

  if (isStale(nav)) return;

  // 세션이 만료됐다면 라우터가 이미 로그인 화면으로 보냈다. 여기서 더 그릴 필요가 없다.
  const results = [workoutsResult, mealsResult, bodyResult, profileResult];
  if (results.some((r) => r.status === 'rejected' && r.reason?.status === 401)) return;

  // 운동
  showStatus(el(root, 'workoutStatus'), '');
  const workouts = workoutsResult.status === 'fulfilled' ? workoutsResult.value : [];
  if (workoutsResult.status === 'fulfilled') renderWorkouts(root, workouts);
  else showStatus(el(root, 'workoutStatus'), workoutsResult.reason.message);

  // 식단
  showStatus(el(root, 'mealStatus'), '');
  const meals = mealsResult.status === 'fulfilled' ? mealsResult.value : [];
  if (mealsResult.status === 'fulfilled') renderMeals(root, meals);
  else showStatus(el(root, 'mealStatus'), mealsResult.reason.message);

  // 신체
  showStatus(el(root, 'bodyStatus'), '');
  const records = bodyResult.status === 'fulfilled' ? bodyResult.value : [];
  if (bodyResult.status === 'fulfilled') renderBody(root, records, date);
  else showStatus(el(root, 'bodyStatus'), bodyResult.reason.message);

  // 칼로리 밸런스 — 앞의 결과가 모두 있어야 의미가 있다
  const profile = profileResult.status === 'fulfilled' ? profileResult.value.profile : null;

  if (!profile || bodyResult.status !== 'fulfilled') {
    return clearBalance(root, '프로필이나 신체 기록을 불러오지 못해 계산할 수 없습니다.');
  }

  renderBalance(root, {
    profile,
    weight: resolveWeight(records, date),
    workouts,
    intake: sumMeals(meals).kcal,
    date,
  });
}

/* ------------------------------------------------------------------ 화면 */

export async function showDashboard() {
  if (!selectedDate) selectedDate = today();

  const root = mountView('tpl-dashboard');
  const dateInput = el(root, 'date');
  dateInput.value = selectedDate;

  const move = (days) => {
    selectedDate = shiftDate(selectedDate, days);
    dateInput.value = selectedDate;
    load(root);
  };

  el(root, 'prev').addEventListener('click', () => move(-1));
  el(root, 'next').addEventListener('click', () => move(1));

  el(root, 'today').addEventListener('click', () => {
    selectedDate = today();
    dateInput.value = selectedDate;
    load(root);
  });

  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    selectedDate = dateInput.value;
    load(root);
  });

  await load(root);
}
