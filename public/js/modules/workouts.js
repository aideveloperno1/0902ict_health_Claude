// 운동 일지 목록 / 상세 / 작성 / 수정 / 삭제 화면.

import { api } from '../api.js';
import {
  mountView, el, cloneTemplate, clearError, showError, toast, withBusy,
  navSnapshot, isStale,
} from '../ui.js';
import { loadScreen, wireDeleteConfirm, createPager, guardUnsavedChanges } from '../screen.js';
import { appendRow, numValue } from '../rows.js';
import { go, replace } from '../navigate.js';
import { today } from '../dates.js';
import {
  setVolume, exerciseVolume, workoutVolume, doneSetCount,
  muscleTags, formatVolume, formatDuration,
} from '../metrics.js';

let currentId = null; // 상세로 보고 있는 일지 id
let editingId = null; // 폼이 수정 모드일 때의 대상 id (작성 모드면 null)

// 지금 열려 있는 폼의 이탈 가드. 저장에 성공하면 풀어 준다.
let formGuard = null;

/* ------------------------------------------------------------------ 목록 */

function summarize(workout) {
  const exercises = workout.exercises || [];
  if (!exercises.length) return '기록된 운동 없음';

  const rest = exercises.length - 1;
  const parts = [rest > 0 ? `${exercises[0].name} 외 ${rest}개` : exercises[0].name];

  const sets = doneSetCount(workout);
  if (sets > 0) parts.push(`${sets}세트`);

  const volume = workoutVolume(workout);
  if (volume > 0) parts.push(formatVolume(volume));

  return parts.join(' · ');
}

function renderList(root, items) {
  const listEl = el(root, 'items');
  listEl.replaceChildren();

  el(root, 'empty').hidden = items.length > 0;

  for (const workout of items) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'item';

    // 구조(뼈대)만 만들고, 사용자가 입력한 값은 모두 textContent로 채운다.
    // innerHTML에 사용자 입력을 넣으면 스크립트가 실행될 수 있다.
    const meta = document.createElement('div');
    meta.className = 'meta-row';

    const date = document.createElement('span');
    date.className = 'date';
    date.textContent = workout.date;
    meta.append(date);

    // 부위는 이제 운동마다 붙으므로 일지 배지는 거기서 중복 없이 뽑아 쓴다.
    for (const muscle of muscleTags(workout)) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = muscle;
      meta.append(badge);
    }

    const duration = formatDuration(workout.durationMin);
    if (duration) {
      const span = document.createElement('span');
      span.className = 'date';
      span.textContent = duration;
      meta.append(span);
    }

    const title = document.createElement('div');
    title.className = 'item-title';
    title.textContent = workout.title;

    const sub = document.createElement('div');
    sub.className = 'item-sub';
    sub.textContent = summarize(workout);

    card.append(meta, title, sub);
    card.addEventListener('click', () => go(`#/workouts/${workout.id}`));
    listEl.append(card);
  }
}

// 한 번에 받아올 일지 개수. 화면에 10건이면 스크롤 한두 번 분량이라 훑어보기 좋다.
const PAGE_SIZE = 10;

export async function showList() {
  const nav = navSnapshot();
  const root = mountView('tpl-workout-list');

  const openNew = () => go('#/workouts/new');
  el(root, 'new').addEventListener('click', openNew);
  el(root, 'emptyNew').addEventListener('click', openNew);

  // 목록을 한 번에 다 받지 않고 10건씩 받는다. 일지는 매일 쌓이기 때문이다.
  // "더 보기"를 누를 때마다 다음 10건이 아래에 이어진다.
  // (loadScreen 대신 createPager를 쓴다. 불러오는 중 표시와 401·화면 이탈 처리는 둘 다 똑같이 한다)
  const pager = createPager({
    nav,
    root,
    limit: PAGE_SIZE,
    fetchPage: (opts) => api.listWorkoutsPage(opts),
    render: (items) => renderList(root, items),
  });

  await pager.reload();
}

/* ------------------------------------------------------------------ 상세 */

function renderDetailExercise(exercise) {
  const card = cloneTemplate('tpl-detail-exercise');

  el(card, 'name').textContent = exercise.name;

  const badge = el(card, 'muscle');
  badge.textContent = exercise.targetMuscle || '';
  badge.hidden = !exercise.targetMuscle;

  el(card, 'subtotal').textContent = formatVolume(exerciseVolume(exercise));

  const tbody = el(card, 'sets');
  for (const set of exercise.sets || []) {
    const tr = document.createElement('tr');
    if (!set.done) tr.className = 'set-undone';

    const cells = [
      { text: set.setNo, num: true },
      { text: set.weightKg == null ? '—' : `${set.weightKg}kg`, num: true },
      { text: set.reps == null ? '—' : `${set.reps}회`, num: true },
      { text: formatVolume(setVolume(set)), num: true },
      { text: set.done ? '✓' : '미완료', num: false },
    ];
    for (const cell of cells) {
      const td = document.createElement('td');
      if (cell.num) td.className = 'num';
      td.textContent = cell.text;
      tr.append(td);
    }
    tbody.append(tr);
  }

  return card;
}

function renderDetail(root, workout) {
  el(root, 'date').textContent = workout.date;

  const muscles = el(root, 'muscles');
  muscles.replaceChildren();
  for (const muscle of muscleTags(workout)) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = muscle;
    muscles.append(badge);
  }

  el(root, 'duration').textContent = formatDuration(workout.durationMin);
  el(root, 'title').textContent = workout.title;

  const exercises = workout.exercises || [];
  el(root, 'exercisesBlock').hidden = exercises.length === 0;
  el(root, 'totalVolume').textContent = formatVolume(workoutVolume(workout));

  const container = el(root, 'exercises');
  container.replaceChildren();
  for (const exercise of exercises) container.append(renderDetailExercise(exercise));

  el(root, 'memoBlock').hidden = !workout.memo;
  el(root, 'memo').textContent = workout.memo || '';
}

export async function openDetail(id) {
  const nav = navSnapshot();
  const root = mountView('tpl-workout-detail');

  currentId = id;

  el(root, 'back').addEventListener('click', () => go('#/workouts'));
  el(root, 'edit').addEventListener('click', () => go(`#/workouts/${currentId}/edit`));

  wireDeleteConfirm(root, async () => {
    await api.deleteWorkout(currentId);
    toast('삭제되었습니다');
    // replace라서 방문 기록에서 이 일지가 사라진다.
    // go를 쓰면 뒤로가기로 이미 지운 일지를 다시 열려다 404를 만나게 된다.
    replace('#/workouts');
  });

  await loadScreen({
    nav,
    statusEl: el(root, 'status'),
    load: () => api.getWorkout(id),
    // 지워진 기록으로 뒤로가기했을 때 오류 문구 대신 목록으로 돌려보낸다.
    missing: { listHash: '#/workouts', message: '이미 삭제된 일지입니다' },
    render: (workout) => {
      el(root, 'card').hidden = false;
      renderDetail(root, workout);
    },
  });
}

/* ------------------------------------------------------------------ 폼: 세트 행 */

/** 세트를 지우거나 추가해도 번호가 1부터 이어지도록 다시 매긴다. */
function renumberSets(setsEl) {
  [...setsEl.querySelectorAll('.set-row')].forEach((row, index) => {
    el(row, 'no').textContent = index + 1;
  });
}

function addSetRow(setsEl, set) {
  const row = appendRow(setsEl, 'tpl-set-row', {
    fill: (created) => {
      if (set) {
        el(created, 'weight').value = set.weightKg ?? '';
        el(created, 'reps').value = set.reps ?? '';
        el(created, 'done').checked = set.done === true;
        return;
      }
      // 새 세트는 직전 세트의 무게·횟수를 기본값으로 채운다. 대부분 같은 값을 이어서 하기 때문이다.
      const rows = setsEl.querySelectorAll('.set-row');
      const last = rows[rows.length - 1];
      if (last) {
        el(created, 'weight').value = el(last, 'weight').value;
        el(created, 'reps').value = el(last, 'reps').value;
      }
    },
    onRemove: () => renumberSets(setsEl),
  });

  renumberSets(setsEl);
  return row;
}

/* ------------------------------------------------------------------ 폼: 운동 카드 */

function addExerciseCard(container, exercise) {
  const card = cloneTemplate('tpl-exercise-card');
  const setsEl = el(card, 'sets');

  if (exercise) {
    el(card, 'name').value = exercise.name ?? '';
    el(card, 'muscle').value = exercise.targetMuscle ?? '';
    const sets = exercise.sets || [];
    if (sets.length === 0) addSetRow(setsEl);
    else sets.forEach((set) => addSetRow(setsEl, set));
  } else {
    addSetRow(setsEl);
  }

  el(card, 'addSet').addEventListener('click', () => {
    addSetRow(setsEl).querySelector('[data-el="weight"]').focus();
    container.dispatchEvent(new Event('input', { bubbles: true }));
  });

  el(card, 'remove').addEventListener('click', () => {
    card.remove();
    if (container.children.length === 0) addExerciseCard(container);
    container.dispatchEvent(new Event('input', { bubbles: true }));
  });

  container.append(card);
  return card;
}

/** 화면에 적힌 값만으로 볼륨을 다시 계산한다. 저장 전에도 즉시 반영되어야 한다. */
function recalcVolumes(root) {
  const container = el(root, 'exercises');
  let total = 0;

  for (const card of container.querySelectorAll('.ex-card')) {
    let subtotal = 0;

    for (const row of card.querySelectorAll('.set-row')) {
      const set = {
        weightKg: numValue(el(row, 'weight')),
        reps: numValue(el(row, 'reps')),
        done: el(row, 'done').checked,
      };
      const volume = setVolume(set);
      subtotal += volume;
      el(row, 'volume').textContent = formatVolume(volume);
    }

    el(card, 'subtotal').textContent = formatVolume(subtotal);
    total += subtotal;
  }

  el(root, 'totalVolume').textContent = formatVolume(total);
}

/**
 * 입력창의 값은 숫자가 아니라 문자열("70")이다. 그대로 보내면 서버 검증에서 400이 난다.
 * 빈 칸은 Number('')가 0이 되므로, 값이 없으면 그 필드 자체를 넣지 않는다.
 */
function collectExercises(container) {
  return [...container.querySelectorAll('.ex-card')]
    .map((card) => {
      const name = el(card, 'name').value.trim();
      if (!name) return null; // 이름이 빈 운동은 보내지 않는다

      const sets = [...el(card, 'sets').querySelectorAll('.set-row')]
        .map((row) => {
          const weightKg = numValue(el(row, 'weight'));
          const reps = numValue(el(row, 'reps'));
          const done = el(row, 'done').checked;

          // 아무것도 입력하지 않은 빈 세트는 보내지 않는다
          if (weightKg === null && reps === null && !done) return null;

          const set = { done };
          if (weightKg !== null) set.weightKg = weightKg;
          if (reps !== null) set.reps = reps;
          return set;
        })
        .filter(Boolean);

      return { name, targetMuscle: el(card, 'muscle').value, sets };
    })
    .filter(Boolean);
}

/* ------------------------------------------------------------------ 폼: 저장 */

async function handleFormSubmit(root, event) {
  event.preventDefault();

  const errorEl = el(root, 'error');
  clearError(errorEl);

  const duration = numValue(el(root, 'duration'));

  const payload = {
    date: el(root, 'date').value,
    title: el(root, 'title').value.trim(),
    exercises: collectExercises(el(root, 'exercises')),
    memo: el(root, 'memo').value.trim(),
  };
  if (duration !== null) payload.durationMin = duration;

  if (!payload.date || !payload.title) {
    return showError(errorEl, '날짜와 제목은 필수입니다.');
  }

  try {
    const saved = await withBusy(el(root, 'submit'), '저장 중…', () =>
      editingId === null ? api.createWorkout(payload) : api.updateWorkout(editingId, payload)
    );

    const wasEditing = editingId !== null;
    editingId = null;

    // 저장했으므로 더 이상 막을 이유가 없다. 풀지 않으면 바로 아래 이동에서
    // "저장되지 않습니다" 확인 바가 떠서 방금 저장한 사용자를 붙잡는다.
    formGuard?.release();

    toast(wasEditing ? '수정되었습니다' : '저장되었습니다');

    if (wasEditing) go(`#/workouts/${saved.id}`);
    else go('#/workouts');
  } catch (err) {
    if (err.status === 401) return;
    showError(errorEl, err.message);
  }
}

/**
 * 같은 이름의 운동을 가장 최근에 한 기록을 찾아 무게·횟수를 채운다.
 *
 * 서버가 목록을 날짜 내림차순으로 주므로 처음 만나는 것이 가장 최근 기록이다.
 * 완료 체크는 가져오지 않는다. 오늘은 아직 하지 않았기 때문이다.
 */
async function loadPreviousSets(root) {
  const container = el(root, 'exercises');
  const cards = [...container.querySelectorAll('.ex-card')];

  if (cards.every((card) => !el(card, 'name').value.trim())) {
    return toast('먼저 운동 이름을 입력해 주세요');
  }

  let workouts;
  try {
    workouts = await withBusy(el(root, 'loadPrev'), '불러오는 중…', () => api.listWorkouts());
  } catch (err) {
    if (err.status === 401) return;
    return toast(err.message);
  }

  // 수정 중인 일지 자신은 "직전 기록"이 될 수 없다.
  const others = workouts.filter((workout) => workout.id !== editingId);
  let filled = 0;

  for (const card of cards) {
    const name = el(card, 'name').value.trim();
    if (!name) continue;

    const found = others
      .flatMap((workout) => workout.exercises || [])
      .find((exercise) => exercise.name === name);
    if (!found) continue;

    if (!el(card, 'muscle').value && found.targetMuscle) {
      el(card, 'muscle').value = found.targetMuscle;
    }

    const setsEl = el(card, 'sets');
    setsEl.replaceChildren();

    const sets = found.sets || [];
    if (sets.length === 0) addSetRow(setsEl);
    else sets.forEach((set) => addSetRow(setsEl, { weightKg: set.weightKg, reps: set.reps, done: false }));

    filled += 1;
  }

  recalcVolumes(root);
  // 코드가 채운 값이라 input 이벤트가 발생하지 않는다. 그래도 잃으면 아까우므로 직접 표시한다.
  if (filled > 0) formGuard?.markDirty();

  toast(filled > 0 ? `${filled}개 운동의 직전 기록을 불러왔습니다` : '이전 기록을 찾지 못했습니다');
}

/** 작성·수정이 같은 템플릿을 쓴다. 공통 배선만 여기서 한다. */
function mountForm() {
  const root = mountView('tpl-workout-form');
  const container = el(root, 'exercises');

  // 값이 바뀔 때마다 볼륨을 다시 계산한다.
  // 완료 체크를 끄면 합계가 그 자리에서 줄어야 규칙을 이해할 수 있다.
  const recalc = () => recalcVolumes(root);
  container.addEventListener('input', recalc);
  container.addEventListener('change', recalc);

  el(root, 'addEx').addEventListener('click', () => {
    addExerciseCard(container).querySelector('[data-el="name"]').focus();
    recalc();
  });

  el(root, 'loadPrev').addEventListener('click', () => loadPreviousSets(root));

  // history.back()이 더 자연스러워 보이지만, 주소로 직접 들어온 경우
  // 앱 바깥으로 나가버린다. 항상 명시적으로 이동한다.
  const cancel = () => {
    if (editingId !== null) go(`#/workouts/${editingId}`);
    else go('#/workouts');
  };
  el(root, 'cancel').addEventListener('click', cancel);
  el(root, 'back').addEventListener('click', cancel);

  el(root, 'form').addEventListener('submit', (event) => handleFormSubmit(root, event));

  // 작성 중에 화면을 떠나려 하면 확인을 받는다.
  // 폼을 채우기 전에 걸어도 되는 이유: input·change는 사람이 입력할 때만 발생하므로,
  // 코드가 value에 값을 넣는 것은 "고쳤다"로 세지 않는다.
  formGuard = guardUnsavedChanges(el(root, 'form'));

  return root;
}

/**
 * 새 일지 작성.
 * routineId가 있으면 그 루틴의 구성을 그대로 가져와 시작한다.
 * 루틴 세트에는 done이 없으므로 모두 미완료 상태로 채워진다.
 */
export async function openCreateForm(routineId = null) {
  const nav = navSnapshot();
  editingId = null;

  const root = mountForm();

  el(root, 'heading').textContent = '새 일지 쓰기';
  el(root, 'submit').textContent = '저장';
  el(root, 'date').value = today();

  const container = el(root, 'exercises');

  if (routineId === null) {
    addExerciseCard(container);
    recalcVolumes(root);
    el(root, 'title').focus();
    return;
  }

  try {
    const routine = await api.getRoutine(routineId);
    if (isStale(nav)) return;

    el(root, 'title').value = routine.name;

    container.replaceChildren();
    const exercises = routine.exercises || [];
    if (exercises.length === 0) addExerciseCard(container);
    else exercises.forEach((exercise) => addExerciseCard(container, exercise));

    recalcVolumes(root);
    toast(`'${routine.name}' 루틴을 불러왔습니다`);
  } catch (err) {
    if (err.status === 401 || isStale(nav)) return;

    // 루틴을 못 불러와도 빈 폼으로 작성은 이어갈 수 있어야 한다.
    toast(err.message);
    addExerciseCard(container);
    recalcVolumes(root);
  }
}

export async function openEditForm(id) {
  const nav = navSnapshot();

  editingId = id;

  const root = mountForm();
  el(root, 'heading').textContent = '일지 수정';
  el(root, 'submit').textContent = '수정 저장';

  try {
    const workout = await api.getWorkout(id);
    if (isStale(nav)) return;

    el(root, 'date').value = workout.date;
    el(root, 'title').value = workout.title;
    el(root, 'duration').value = workout.durationMin ?? '';
    el(root, 'memo').value = workout.memo || '';

    const container = el(root, 'exercises');
    container.replaceChildren();

    const exercises = workout.exercises || [];
    if (exercises.length === 0) addExerciseCard(container);
    else exercises.forEach((exercise) => addExerciseCard(container, exercise));

    recalcVolumes(root);
  } catch (err) {
    if (err.status === 401 || isStale(nav)) return;

    // 불러오지 못한 일지의 수정 폼을 빈 채로 두면 안 된다.
    // 삭제한 일지의 수정 주소로 뒤로가기했을 때 실제로 이 경로를 타게 된다.
    toast(err.message);
    replace('#/workouts');
  }
}
