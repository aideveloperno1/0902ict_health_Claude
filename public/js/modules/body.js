// "내 몸" 화면. 두 가지를 함께 다룬다.
//
//   1. 신체 정보 (성별 · 출생연도 · 키)  — 거의 안 바뀜. 계정에 1건.
//   2. 체중 기록 (날짜 · 체중 · 컨디션)  — 매일 바뀜. 날짜당 1건.
//
// 저장되는 곳이 서로 다르다(계정 / 날짜별 기록). 그래서 폼도 둘로 나누고
// 저장 버튼도 각각 둔다. 하나로 합치면 체중만 적으려 해도 키까지 함께 보내게 된다.
//
// 그래도 한 화면에 두는 이유: 사용자에게는 둘 다 "내 몸에 관한 것" 이라
// 여기서 찾는다. 저장 위치가 다른 것은 서버 사정이지 화면을 나눌 이유가 아니다.
// 체중 기록은 날짜당 한 건만 남으므로 별도 수정 화면 없이 폼 하나로 기록과 수정을 겸한다.

import { api, session } from '../api.js';
import {
  mountView, el, cloneTemplate, clearError, showError, showStatus, toast, withBusy,
  navSnapshot, isStale,
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

/* ------------------------------------------------------- 신체 정보 (계정에 저장) */

/**
 * 성별·출생연도·키를 불러와 폼에 채운다.
 *
 * 체중 목록과 따로 부르는 이유: 저장되는 곳이 다르다.
 * 이 셋은 계정에 붙어 있고(/api/auth/me), 체중은 날짜별 기록이다.
 *
 * 실패해도 아래 체중 기록은 그대로 쓸 수 있어야 하므로 화면 전체를 막지 않고
 * 이 폼 자리에만 안내를 남긴다.
 */
async function loadBodyProfile(root, nav) {
  const statusEl = el(root, 'profileStatus');
  showStatus(statusEl, '불러오는 중…');

  try {
    const user = await api.getMe();
    if (isStale(nav)) return;

    const profile = user.profile || {};
    el(root, 'sex').value = profile.sex || '';
    el(root, 'birthYear').value = profile.birthYear ?? '';
    el(root, 'heightCm').value = profile.heightCm ?? '';

    showStatus(statusEl, '');
    el(root, 'profileForm').hidden = false;
  } catch (err) {
    if (err.status === 401 || isStale(nav)) return;
    showStatus(statusEl, err.message);
  }
}

async function handleProfileSubmit(root, event) {
  event.preventDefault();

  const errorEl = el(root, 'profileError');
  clearError(errorEl);

  // 비운 칸은 null로 보낸다. 서버가 "값 없음"으로 저장하고, 대시보드는 계산을 건너뛴다.
  // 이름은 보내지 않는다. 보내지 않은 항목은 서버가 지금 값을 그대로 둔다.
  const payload = {
    profile: {
      sex: el(root, 'sex').value || null,
      birthYear: numValue(el(root, 'birthYear')),
      heightCm: numValue(el(root, 'heightCm')),
    },
  };

  try {
    const updated = await withBusy(el(root, 'profileSubmit'), '저장 중…', () => api.updateMe(payload));

    // 토큰은 그대로 두고 사용자 정보만 갈아 끼운다.
    // 이걸 빠뜨리면 대시보드가 예전 프로필로 계산해서, 방금 넣은 키가 반영되지 않는다.
    session.save(session.token, updated);

    toast('저장되었습니다');
  } catch (err) {
    if (err.status === 401) return;
    showError(errorEl, err.message);
  }
}

/* ------------------------------------------------------- 체중 기록 (날짜별) */

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
  el(root, 'profileForm').addEventListener('submit', (event) => handleProfileSubmit(root, event));

  // 두 요청을 함께 보낸다. 하나가 실패해도 나머지는 그려져야 하므로 순서를 두지 않는다.
  await Promise.all([loadBodyProfile(root, nav), pager.reload()]);
}
