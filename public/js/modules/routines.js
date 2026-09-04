// 루틴 템플릿. 자주 하는 운동 구성을 저장해 두고 일지를 쓸 때 불러온다.
// 루틴은 계획이므로 날짜와 완료 체크가 없다.

import { api } from '../api.js';
import {
  mountView, el, cloneTemplate, clearError, showError,
  toast, withBusy, navSnapshot, isStale,
} from '../ui.js';
import { loadScreen, guardUnsavedChanges } from '../screen.js';
import { appendRow, numValue } from '../rows.js';
import { go, replace } from '../navigate.js';

let editingId = null;

// 지금 열려 있는 폼의 이탈 가드. 저장에 성공하면 풀어 준다.
let formGuard = null;

/* ------------------------------------------------------------------ 목록 */

function summarize(routine) {
  const exercises = routine.exercises || [];
  if (!exercises.length) return '운동이 비어 있음';

  const rest = exercises.length - 1;
  const names = rest > 0 ? `${exercises[0].name} 외 ${rest}개` : exercises[0].name;

  const sets = exercises.reduce((sum, exercise) => sum + (exercise.sets || []).length, 0);
  return sets > 0 ? `${names} · ${sets}세트` : names;
}

function renderList(root, routines, reload) {
  const listEl = el(root, 'items');
  listEl.replaceChildren();

  el(root, 'empty').hidden = routines.length > 0;

  for (const routine of routines) {
    const row = cloneTemplate('tpl-routine-row');

    el(row, 'name').textContent = routine.name;
    el(row, 'sub').textContent = summarize(routine);

    el(row, 'start').addEventListener('click', () => go(`#/workouts/new/from/${routine.id}`));
    el(row, 'edit').addEventListener('click', () => go(`#/routines/${routine.id}/edit`));

    // 삭제는 되돌릴 수 없으므로 그 줄에서 한 번 더 확인한다.
    const actions = el(row, 'actions');
    const confirm = el(row, 'confirm');

    el(row, 'remove').addEventListener('click', () => {
      actions.hidden = true;
      confirm.hidden = false;
      el(row, 'cancelDelete').focus();
    });
    el(row, 'cancelDelete').addEventListener('click', () => {
      confirm.hidden = true;
      actions.hidden = false;
    });
    el(row, 'confirmDelete').addEventListener('click', async () => {
      try {
        await withBusy(el(row, 'confirmDelete'), '삭제 중…', () => api.deleteRoutine(routine.id));
        toast('삭제되었습니다');
        await reload();
      } catch (err) {
        if (err.status === 401) return;
        toast(err.message);
        confirm.hidden = true;
        actions.hidden = false;
      }
    });

    listEl.append(row);
  }
}

export async function showList() {
  const nav = navSnapshot();
  const root = mountView('tpl-routine-list');

  const openNew = () => go('#/routines/new');
  el(root, 'new').addEventListener('click', openNew);
  el(root, 'emptyNew').addEventListener('click', openNew);

  // 삭제 후 목록만 다시 그린다.
  const reload = async () => {
    const routines = await api.listRoutines();
    renderList(root, routines, reload);
  };

  await loadScreen({
    nav,
    statusEl: el(root, 'status'),
    load: () => api.listRoutines(),
    render: (routines) => renderList(root, routines, reload),
  });
}

/* ------------------------------------------------------------------ 폼 */

function renumber(setsEl) {
  [...setsEl.querySelectorAll('.rset-row')].forEach((row, index) => {
    el(row, 'no').textContent = index + 1;
  });
}

function addSetRow(setsEl, set) {
  const row = appendRow(setsEl, 'tpl-routine-set-row', {
    fill: (created) => {
      if (set) {
        el(created, 'weight').value = set.weightKg ?? '';
        el(created, 'reps').value = set.reps ?? '';
        return;
      }
      // 새 세트는 직전 세트 값을 이어받는다.
      const rows = setsEl.querySelectorAll('.rset-row');
      const last = rows[rows.length - 1];
      if (last) {
        el(created, 'weight').value = el(last, 'weight').value;
        el(created, 'reps').value = el(last, 'reps').value;
      }
    },
    onRemove: () => renumber(setsEl),
  });

  renumber(setsEl);
  return row;
}

function addExerciseCard(container, exercise) {
  const card = cloneTemplate('tpl-routine-exercise-card');
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
  });

  el(card, 'remove').addEventListener('click', () => {
    card.remove();
    if (container.children.length === 0) addExerciseCard(container);
  });

  container.append(card);
  return card;
}

function collectExercises(container) {
  return [...container.querySelectorAll('.ex-card')]
    .map((card) => {
      const name = el(card, 'name').value.trim();
      if (!name) return null;

      const sets = [...el(card, 'sets').querySelectorAll('.rset-row')]
        .map((row) => {
          const weightKg = numValue(el(row, 'weight'));
          const reps = numValue(el(row, 'reps'));
          if (weightKg === null && reps === null) return null;

          const set = {};
          if (weightKg !== null) set.weightKg = weightKg;
          if (reps !== null) set.reps = reps;
          return set;
        })
        .filter(Boolean);

      return { name, targetMuscle: el(card, 'muscle').value, sets };
    })
    .filter(Boolean);
}

async function handleSubmit(root, event) {
  event.preventDefault();

  const errorEl = el(root, 'error');
  clearError(errorEl);

  const name = el(root, 'name').value.trim();
  if (!name) return showError(errorEl, '루틴 이름은 필수입니다.');

  const payload = { name, exercises: collectExercises(el(root, 'exercises')) };

  try {
    await withBusy(el(root, 'submit'), '저장 중…', () =>
      editingId === null ? api.createRoutine(payload) : api.updateRoutine(editingId, payload)
    );

    const wasEditing = editingId !== null;
    editingId = null;

    // 저장했으므로 더 이상 막을 이유가 없다. 풀지 않으면 바로 아래 이동에서
    // "저장되지 않습니다" 확인 바가 떠서 방금 저장한 사용자를 붙잡는다.
    formGuard?.release();

    toast(wasEditing ? '수정되었습니다' : '저장되었습니다');
    go('#/routines');
  } catch (err) {
    if (err.status === 401) return;
    showError(errorEl, err.message);
  }
}

function mountForm() {
  const root = mountView('tpl-routine-form');
  const container = el(root, 'exercises');

  el(root, 'addEx').addEventListener('click', () => {
    addExerciseCard(container).querySelector('[data-el="name"]').focus();
  });

  const cancel = () => go('#/routines');
  el(root, 'cancel').addEventListener('click', cancel);
  el(root, 'back').addEventListener('click', cancel);

  el(root, 'form').addEventListener('submit', (event) => handleSubmit(root, event));

  // 작성 중에 화면을 떠나려 하면 확인을 받는다.
  // 폼을 채우기 전에 걸어도 되는 이유: input·change는 사람이 입력할 때만 발생하므로,
  // 코드가 value에 값을 넣는 것은 "고쳤다"로 세지 않는다.
  formGuard = guardUnsavedChanges(el(root, 'form'));

  return root;
}

export function openCreateForm() {
  editingId = null;

  const root = mountForm();
  el(root, 'heading').textContent = '새 루틴';
  el(root, 'submit').textContent = '저장';

  addExerciseCard(el(root, 'exercises'));
  el(root, 'name').focus();
}

export async function openEditForm(id) {
  const nav = navSnapshot();

  editingId = id;

  const root = mountForm();
  el(root, 'heading').textContent = '루틴 수정';
  el(root, 'submit').textContent = '수정 저장';

  try {
    const routine = await api.getRoutine(id);
    if (isStale(nav)) return;

    el(root, 'name').value = routine.name;

    const container = el(root, 'exercises');
    container.replaceChildren();

    const exercises = routine.exercises || [];
    if (exercises.length === 0) addExerciseCard(container);
    else exercises.forEach((exercise) => addExerciseCard(container, exercise));
  } catch (err) {
    if (err.status === 401 || isStale(nav)) return;

    toast(err.message);
    replace('#/routines');
  }
}
