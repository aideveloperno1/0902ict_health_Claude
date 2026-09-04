// 식단 목록 / 상세 / 작성 / 수정 / 삭제 화면.

import { api } from '../api.js';
import {
  mountView, el, cloneTemplate, clearError, showError, toast, withBusy,
  navSnapshot, isStale,
} from '../ui.js';
import { loadScreen, wireDeleteConfirm, createPager, guardUnsavedChanges } from '../screen.js';
import { appendRow, numValue } from '../rows.js';
import { go, replace } from '../navigate.js';
import { today, formatDayLabel } from '../dates.js';
import {
  mealKcal, mealMacros, sumMeals, macroRatio, kcalFromMacros,
  formatKcal, formatAmount,
} from '../metrics.js';

let currentId = null;
let editingId = null;

// 지금 열려 있는 폼의 이탈 가드. 저장에 성공하면 풀어 준다.
let formGuard = null;

/* ------------------------------------------------------------------ 공통 */

/**
 * 탄단지 막대와 설명을 그린다. 목록의 날짜 묶음과 상세 화면이 같이 쓴다.
 * flex-grow로 폭을 주므로 반올림 때문에 막대가 덜 차거나 넘치는 일이 없다.
 */
function renderMacroBar(scope, totals) {
  const ratio = macroRatio(totals);
  const bar = el(scope, 'bar');
  const legend = el(scope, 'legend');

  if (!ratio) {
    bar.hidden = true;
    legend.textContent = '영양 정보 없음';
    return;
  }

  bar.hidden = false;
  el(scope, 'carbs').style.flexGrow = ratio.carbs;
  el(scope, 'protein').style.flexGrow = ratio.protein;
  el(scope, 'fat').style.flexGrow = ratio.fat;

  const pct = (value) => Math.round(value);
  const gram = (value) => Math.round(value * 10) / 10;

  legend.textContent =
    `탄 ${pct(ratio.carbs)}% · 단 ${pct(ratio.protein)}% · 지 ${pct(ratio.fat)}%` +
    `  (${gram(totals.carbsG)}g · ${gram(totals.proteinG)}g · ${gram(totals.fatG)}g)`;
}

function summarizeFoods(meal) {
  const foods = meal.foods || [];
  if (!foods.length) return '기록된 음식 없음';

  const rest = foods.length - 1;
  return rest > 0 ? `${foods[0].name} 외 ${rest}개` : foods[0].name;
}

/* ------------------------------------------------------------------ 목록 */

/** 서버가 이미 날짜 내림차순 + 끼니 순으로 주므로 순서를 유지한 채 묶기만 한다. */
function groupByDate(meals) {
  const groups = new Map();
  for (const meal of meals) {
    if (!groups.has(meal.date)) groups.set(meal.date, []);
    groups.get(meal.date).push(meal);
  }
  return [...groups.entries()];
}

function renderDayGroup(date, meals) {
  const group = cloneTemplate('tpl-meal-day');
  const totals = sumMeals(meals);

  el(group, 'date').textContent = formatDayLabel(date);
  el(group, 'total').textContent = formatKcal(totals.kcal);
  renderMacroBar(group, totals);

  const items = el(group, 'items');
  for (const meal of meals) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'item';

    const meta = document.createElement('div');
    meta.className = 'meta-row';

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = meal.mealType;
    meta.append(badge);

    const kcal = document.createElement('span');
    kcal.className = 'item-kcal';
    kcal.textContent = formatKcal(mealKcal(meal));
    meta.append(kcal);

    const sub = document.createElement('div');
    sub.className = 'item-title';
    sub.textContent = summarizeFoods(meal);

    card.append(meta, sub);
    card.addEventListener('click', () => go(`#/meals/${meal.id}`));
    items.append(card);
  }

  return group;
}

function renderList(root, meals) {
  el(root, 'empty').hidden = meals.length > 0;

  const groups = el(root, 'groups');
  groups.replaceChildren();

  for (const [date, list] of groupByDate(meals)) {
    groups.append(renderDayGroup(date, list));
  }
}

// 끼니 단위로 세는 값이다. 하루에 3~4끼이므로 12건이면 대략 3~4일치가 한 번에 보인다.
const PAGE_SIZE = 12;

export async function showList() {
  const nav = navSnapshot();
  const root = mountView('tpl-meal-list');

  const openNew = () => go('#/meals/new');
  el(root, 'new').addEventListener('click', openNew);
  el(root, 'emptyNew').addEventListener('click', openNew);

  // 12건씩 나눠 받는다.
  // 날짜 묶음이 페이지 경계에서 잘릴 수 있지만(2페이지 첫 끼니가 1페이지 마지막 날과 같은 날),
  // createPager가 지금까지 받은 전체 배열로 매번 다시 그리기 때문에 묶음이 알아서 합쳐진다.
  // 서버가 날짜·끼니 순으로 정렬해서 주므로 순서도 흐트러지지 않는다.
  const pager = createPager({
    nav,
    root,
    limit: PAGE_SIZE,
    fetchPage: (opts) => api.listMealsPage(opts),
    render: (meals) => renderList(root, meals),
  });

  await pager.reload();
}

/* ------------------------------------------------------------------ 상세 */

function renderDetail(root, meal) {
  el(root, 'date').textContent = formatDayLabel(meal.date);
  el(root, 'mealType').textContent = meal.mealType;
  el(root, 'total').textContent = formatKcal(mealKcal(meal));

  const foods = meal.foods || [];
  el(root, 'foodsBlock').hidden = foods.length === 0;

  const tbody = el(root, 'foods');
  tbody.replaceChildren();

  const dash = (value) => (value === null || value === undefined ? '—' : value);

  for (const food of foods) {
    const tr = document.createElement('tr');
    const cells = [
      { text: food.name, num: false },
      { text: formatAmount(food.amount, food.unit), num: true },
      { text: food.kcal === null ? '—' : Math.round(food.kcal), num: true },
      { text: dash(food.carbsG), num: true },
      { text: dash(food.proteinG), num: true },
      { text: dash(food.fatG), num: true },
    ];
    for (const cell of cells) {
      const td = document.createElement('td');
      if (cell.num) td.className = 'num';
      td.textContent = cell.text;
      tr.append(td);
    }
    tbody.append(tr);
  }

  renderMacroBar(root, mealMacros(meal));

  el(root, 'memoBlock').hidden = !meal.memo;
  el(root, 'memo').textContent = meal.memo || '';
}

export async function openDetail(id) {
  const nav = navSnapshot();
  const root = mountView('tpl-meal-detail');

  currentId = id;

  el(root, 'back').addEventListener('click', () => go('#/meals'));
  el(root, 'edit').addEventListener('click', () => go(`#/meals/${currentId}/edit`));

  wireDeleteConfirm(root, async () => {
    await api.deleteMeal(currentId);
    toast('삭제되었습니다');
    // replace라서 방문 기록에서 이 식단이 사라진다.
    replace('#/meals');
  });

  await loadScreen({
    nav,
    statusEl: el(root, 'status'),
    load: () => api.getMeal(id),
    // 지워진 기록으로 뒤로가기했을 때 오류 문구 대신 목록으로 돌려보낸다.
    missing: { listHash: '#/meals', message: '이미 삭제된 식단입니다' },
    render: (meal) => {
      el(root, 'card').hidden = false;
      renderDetail(root, meal);
    },
  });
}

/* ------------------------------------------------------------------ 폼 */

function addFoodRow(container, food) {
  return appendRow(container, 'tpl-food-row', {
    fill: (row) => {
      if (!food) return;
      el(row, 'name').value = food.name ?? '';
      el(row, 'amount').value = food.amount ?? '';
      el(row, 'unit').value = food.unit || 'g';
      el(row, 'kcal').value = food.kcal ?? '';
      el(row, 'carbs').value = food.carbsG ?? '';
      el(row, 'protein').value = food.proteinG ?? '';
      el(row, 'fat').value = food.fatG ?? '';
    },
    onRemove: () => {
      if (container.children.length === 0) addFoodRow(container);
    },
  });
}

/** 화면에 적힌 값만으로 합계를 다시 계산한다. */
function recalcTotals(root) {
  const rows = [...el(root, 'foods').querySelectorAll('.food-row')];

  let kcal = 0;
  const macros = { carbsG: 0, proteinG: 0, fatG: 0 };

  for (const row of rows) {
    kcal += numValue(el(row, 'kcal')) ?? 0;
    macros.carbsG += numValue(el(row, 'carbs')) ?? 0;
    macros.proteinG += numValue(el(row, 'protein')) ?? 0;
    macros.fatG += numValue(el(row, 'fat')) ?? 0;
  }

  el(root, 'total').textContent = formatKcal(kcal);

  // 탄단지로 계산한 값은 참고로만 보여준다. 입력한 kcal을 덮어쓰지 않는다. (확정 사항 3)
  const hint = el(root, 'hint');
  const computed = kcalFromMacros(macros);

  if (computed <= 0) {
    hint.hidden = true;
    return;
  }
  hint.hidden = false;
  hint.textContent = `탄단지로 계산하면 약 ${formatKcal(computed)}입니다. (참고용 · 저장은 입력한 kcal로)`;
}

/**
 * 입력창의 값은 숫자가 아니라 문자열이다. 그대로 보내면 서버 검증에서 400이 난다.
 * 빈 칸은 필드 자체를 넣지 않는다. Number('')가 0이 되기 때문이다.
 */
function collectFoods(container) {
  const FIELDS = [
    ['amount', 'amount'],
    ['kcal', 'kcal'],
    ['carbsG', 'carbs'],
    ['proteinG', 'protein'],
    ['fatG', 'fat'],
  ];

  return [...container.querySelectorAll('.food-row')]
    .map((row) => {
      const name = el(row, 'name').value.trim();
      if (!name) return null; // 이름이 빈 행은 보내지 않는다

      const food = { name, unit: el(row, 'unit').value };
      for (const [key, elName] of FIELDS) {
        const value = numValue(el(row, elName));
        if (value !== null) food[key] = value;
      }
      return food;
    })
    .filter(Boolean);
}

async function handleFormSubmit(root, event) {
  event.preventDefault();

  const errorEl = el(root, 'error');
  clearError(errorEl);

  const payload = {
    date: el(root, 'date').value,
    mealType: el(root, 'mealType').value,
    foods: collectFoods(el(root, 'foods')),
    memo: el(root, 'memo').value.trim(),
  };

  if (!payload.date) return showError(errorEl, '날짜는 필수입니다.');

  try {
    const saved = await withBusy(el(root, 'submit'), '저장 중…', () =>
      editingId === null ? api.createMeal(payload) : api.updateMeal(editingId, payload)
    );

    const wasEditing = editingId !== null;
    editingId = null;

    // 저장했으므로 더 이상 막을 이유가 없다. 풀지 않으면 바로 아래 이동에서
    // "저장되지 않습니다" 확인 바가 떠서 방금 저장한 사용자를 붙잡는다.
    formGuard?.release();

    toast(wasEditing ? '수정되었습니다' : '저장되었습니다');

    if (wasEditing) go(`#/meals/${saved.id}`);
    else go('#/meals');
  } catch (err) {
    if (err.status === 401) return;
    showError(errorEl, err.message);
  }
}

function mountForm() {
  const root = mountView('tpl-meal-form');
  const container = el(root, 'foods');

  const recalc = () => recalcTotals(root);
  container.addEventListener('input', recalc);
  container.addEventListener('change', recalc);

  el(root, 'addFood').addEventListener('click', () => {
    addFoodRow(container).querySelector('[data-el="name"]').focus();
    recalc();
  });

  const cancel = () => {
    if (editingId !== null) go(`#/meals/${editingId}`);
    else go('#/meals');
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

export function openCreateForm() {
  editingId = null;

  const root = mountForm();
  el(root, 'heading').textContent = '식단 기록';
  el(root, 'submit').textContent = '저장';
  el(root, 'date').value = today();

  addFoodRow(el(root, 'foods'));
  recalcTotals(root);

  el(root, 'foods').querySelector('[data-el="name"]').focus();
}

export async function openEditForm(id) {
  const nav = navSnapshot();

  editingId = id;

  const root = mountForm();
  el(root, 'heading').textContent = '식단 수정';
  el(root, 'submit').textContent = '수정 저장';

  try {
    const meal = await api.getMeal(id);
    if (isStale(nav)) return;

    el(root, 'date').value = meal.date;
    el(root, 'mealType').value = meal.mealType;
    el(root, 'memo').value = meal.memo || '';

    const container = el(root, 'foods');
    container.replaceChildren();

    const foods = meal.foods || [];
    if (foods.length === 0) addFoodRow(container);
    else foods.forEach((food) => addFoodRow(container, food));

    recalcTotals(root);
  } catch (err) {
    if (err.status === 401 || isStale(nav)) return;

    // 불러오지 못한 식단의 수정 폼을 빈 채로 두면 안 된다.
    toast(err.message);
    replace('#/meals');
  }
}
