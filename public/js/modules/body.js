// 신체 지표(체중 · 컨디션) 화면.
// 날짜당 한 건만 남으므로 별도 수정 화면 없이, 위 폼 하나로 기록과 수정을 겸한다.

import { api } from '../api.js';
import {
  mountView, el, cloneTemplate, clearError, showError, toast, withBusy, navSnapshot,
} from '../ui.js';
import { createPager } from '../screen.js';
import { numValue } from '../rows.js';
import { today, formatDayLabel } from '../dates.js';
import { formatWeight } from '../metrics.js';

// 하루 한 건이므로 15건이면 대략 보름치가 한 번에 보인다.
const PAGE_SIZE = 15;

/**
 * @param {Function} reload 저장·삭제 뒤 목록을 처음부터 다시 불러오는 함수.
 *   전에는 이 파일 안의 loadList()를 직접 불렀지만, 이제는 목록을 페이지 단위로
 *   관리하는 쪽(createPager)이 "다시 불러오기"를 맡으므로 넘겨받아 쓴다.
 */
function renderList(root, items, reload) {
  const listEl = el(root, 'items');
  listEl.replaceChildren();

  el(root, 'empty').hidden = items.length > 0;

  for (const record of items) {
    const row = cloneTemplate('tpl-body-row');

    el(row, 'date').textContent = formatDayLabel(record.date);
    el(row, 'weight').textContent = formatWeight(record.weightKg);
    el(row, 'memo').textContent = record.conditionMemo || '';

    // 같은 날짜로 저장하면 덮어쓰므로, 폼에 값을 채워주는 것이 곧 수정이다.
    el(row, 'load').addEventListener('click', () => {
      el(root, 'date').value = record.date;
      el(root, 'weight').value = record.weightKg ?? '';
      el(root, 'memo').value = record.conditionMemo || '';
      clearError(el(root, 'error'));
      window.scrollTo(0, 0);
    });

    el(row, 'remove').addEventListener('click', async () => {
      try {
        await withBusy(el(row, 'remove'), '…', () => api.deleteBodyMetric(record.id));
        toast('삭제되었습니다');
        // 한 건이 빠지면 전체 개수와 페이지 수가 달라진다. 처음부터 다시 불러온다.
        await reload();
      } catch (err) {
        if (err.status === 401) return;
        toast(err.message);
      }
    });

    listEl.append(row);
  }
}

async function handleSubmit(root, event, reload) {
  event.preventDefault();

  const errorEl = el(root, 'error');
  clearError(errorEl);

  const date = el(root, 'date').value;
  if (!date) return showError(errorEl, '날짜는 필수입니다.');

  const weight = numValue(el(root, 'weight'));

  const payload = { date, conditionMemo: el(root, 'memo').value.trim() };
  if (weight !== null) payload.weightKg = weight;

  try {
    await withBusy(el(root, 'submit'), '저장 중…', () => api.saveBodyMetric(payload));
    toast('저장되었습니다');
    // 목록만 다시 불러온다. 화면을 새로 붙이지 않으므로 폼에 적던 값은 그대로 남는다.
    await reload();
  } catch (err) {
    if (err.status === 401) return;
    showError(errorEl, err.message);
  }
}

export async function showBody() {
  const nav = navSnapshot();
  const root = mountView('tpl-body');

  el(root, 'date').value = today();

  // 체중은 하루 한 건씩 계속 쌓이므로 목록을 15건씩 나눠 받는다.
  // 불러오는 중 표시, 401 처리, 화면을 떠났는지 확인은 createPager가 함께 해 준다.
  // (그래서 이 함수에 있던 try/catch와 loadList가 통째로 사라졌다)
  const pager = createPager({
    nav,
    root,
    limit: PAGE_SIZE,
    fetchPage: (opts) => api.listBodyMetricsPage(opts),
    render: (items) => renderList(root, items, () => pager.reload()),
  });

  el(root, 'form').addEventListener('submit', (event) => handleSubmit(root, event, () => pager.reload()));

  await pager.reload();
}
