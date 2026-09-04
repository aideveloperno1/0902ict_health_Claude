// 목록·상세 화면이 공통으로 밟는 절차.
// 운동/식단의 목록과 상세, 네 화면이 같은 모양이라 여기로 모았다.

import { el, showStatus, isStale, toast, withBusy } from './ui.js';
import { replace, setLeaveGuard, clearLeaveGuard } from './navigate.js';

/**
 * 불러오는 중 표시 → 조회 → 그리기. 실패하면 그 자리에 메시지를 남긴다.
 *
 * 두 가지를 반드시 구분해서 빠져나간다.
 *  - 401: 세션 만료. 라우터가 로그인 화면으로 보내므로 여기서는 아무것도 하지 않는다.
 *  - isStale: 응답을 기다리는 사이 사용자가 다른 화면으로 갔다. 남의 화면을 건드리면 안 된다.
 *
 * @param {object}   [o.missing]           404를 "오류"가 아니라 "이미 없어진 기록"으로 다룬다
 * @param {string}   o.missing.listHash    돌아갈 목록 주소 (예: '#/workouts')
 * @param {string}   o.missing.message     사용자에게 보여줄 문구
 */
export async function loadScreen({ nav, statusEl, load, render, missing = null }) {
  showStatus(statusEl, '불러오는 중…');

  try {
    const data = await load();
    if (isStale(nav)) return;

    showStatus(statusEl, '');
    render(data);
  } catch (err) {
    if (err.status === 401 || isStale(nav)) return;

    /**
     * 상세 화면에서의 404는 "서버가 고장났다"가 아니라 "그 기록이 이제 없다"는 뜻이다.
     * 대부분 사용자가 방금 지운 기록으로 뒤로가기를 한 경우다.
     *
     * 지울 때 replace로 방문 기록을 덮어쓰고 있지만, 그것은 "현재 항목" 하나만 지운다.
     * 같은 일지를 여러 번 오갔다면 방문 기록 깊은 곳에 예전 항목이 그대로 남아 있어서,
     * 뒤로가기를 몇 번 더 누르면 지워진 일지를 다시 열게 된다.
     * 그때 "일지를 찾을 수 없습니다"라는 오류 문구만 덩그러니 두면 사용자는
     * 무엇이 잘못됐는지 알 수 없다. 목록으로 돌려보내고 이유를 알려준다.
     *
     * 여기서도 replace를 쓴다. go를 쓰면 방금 그 죽은 주소가 방문 기록에 또 쌓여서
     * 뒤로가기를 누를 때마다 같은 일이 반복된다.
     */
    if (err.status === 404 && missing) {
      toast(missing.message);
      return replace(missing.listHash);
    }

    showStatus(statusEl, err.message);
  }
}

/**
 * "더 보기" 방식의 목록을 만든다. 운동·식단·신체 지표 세 화면이 같은 동작을 하므로 여기로 모았다.
 *
 * 왜 페이지 번호(1 2 3 …) 대신 "더 보기" 인가
 *   기록은 위에서부터 쭉 훑어보는 목록이다. 번호를 눌러 5페이지로 건너뛰는 일보다
 *   "조금 더 내려보기"가 압도적으로 흔하다. 스마트폰에서도 버튼 하나가 누르기 쉽다.
 *   무한 스크롤은 스크롤만으로 계속 불러와서, 목록 아래의 내용에 닿기 어려워진다.
 *
 * 왜 이어붙이지 않고 매번 전체를 다시 그리나
 *   지금까지 받은 항목을 items에 모아 두고, 늘어난 배열로 render를 다시 호출한다.
 *   식단 목록은 날짜별로 묶어서 그리는데, 2페이지의 첫 항목이 1페이지 마지막 날짜와
 *   같은 날일 수 있다. 이어붙이는 방식이면 그 묶음을 찾아 합치는 처리가 필요하지만,
 *   전체를 다시 그리면 그런 특수한 경우를 신경 쓸 필요가 없다.
 *   한 화면에 수십 개 정도라 다시 그리는 비용도 문제되지 않는다.
 *
 * @param {object}   o
 * @param {number}   o.nav        navSnapshot() 값. 응답을 기다리는 사이 화면이 바뀌었는지 확인용
 * @param {Element}  o.root       화면 최상위 요소 (data-el 로 하위 요소를 찾는다)
 * @param {number}   [o.limit]    한 번에 받아올 개수
 * @param {Function} o.fetchPage  ({ page, limit }) => { items, total, totalPages, page }
 * @param {Function} o.render     (지금까지 받은 항목 전체) => void
 */
export function createPager({ nav, root, limit = 10, fetchPage, render }) {
  const statusEl = el(root, 'status');
  const moreEl = el(root, 'more');
  const countEl = el(root, 'count');
  const buttonEl = el(root, 'loadMore');

  let items = [];
  let page = 0;
  let totalPages = 1;
  let total = 0;

  /** 남은 게 있을 때만 버튼을 보여주고, 어디까지 봤는지 숫자로 알려준다. */
  function updateFooter() {
    // 한 페이지로 끝나면 버튼도 개수도 필요 없다. 아무것도 없을 때(0건)도 마찬가지다.
    // 비어 있을 때는 화면마다 준비된 안내(empty)가 대신 보인다.
    if (total === 0 || totalPages <= 1) {
      moreEl.hidden = true;
      return;
    }

    moreEl.hidden = false;
    countEl.textContent = `${items.length} / ${total}건`;
    // 마지막 페이지까지 왔으면 개수만 남기고 버튼은 감춘다.
    buttonEl.hidden = page >= totalPages;
  }

  /**
   * 다음 페이지를 받아 이어붙인다.
   * @param {boolean} first 첫 호출이면 상태 문구를, 아니면 버튼을 잠근다
   */
  async function loadNext(first) {
    const target = page + 1;

    if (first) showStatus(statusEl, '불러오는 중…');

    try {
      const result = first
        ? await fetchPage({ page: target, limit })
        : await withBusy(buttonEl, '불러오는 중…', () => fetchPage({ page: target, limit }));

      // 응답을 기다리는 사이 사용자가 다른 화면으로 갔다면 남의 화면을 건드리면 안 된다.
      if (isStale(nav)) return;

      page = result.page;
      total = result.total;
      totalPages = result.totalPages;
      items = items.concat(result.items);

      showStatus(statusEl, '');
      render(items);
      updateFooter();
    } catch (err) {
      // 401은 라우터가 로그인 화면으로 보내므로 여기서 할 일이 없다.
      if (err.status === 401 || isStale(nav)) return;

      // 첫 페이지가 실패하면 보여줄 목록 자체가 없으므로 화면에 이유를 남긴다.
      // 이미 목록이 그려진 뒤라면 그것을 지우지 않고 잠깐 뜨는 알림으로만 알린다.
      if (first) showStatus(statusEl, err.message);
      else toast(err.message);
    }
  }

  buttonEl.addEventListener('click', () => loadNext(false));

  return {
    /** 처음부터 다시 불러온다. 저장·삭제 후 목록을 갱신할 때도 쓴다. */
    async reload() {
      items = [];
      page = 0;
      moreEl.hidden = true;
      await loadNext(true);
    },
  };
}

/**
 * 삭제 확인 바 배선. 상세 화면 두 곳이 완전히 같다.
 * 삭제는 되돌릴 수 없으므로 카드 안에서 한 번 더 확인받는다.
 *
 * @param {Function} remove 실제 삭제와 이후 이동까지 담당한다. 실패하면 던진다.
 */
export function wireDeleteConfirm(root, remove) {
  const actions = el(root, 'actions');
  const bar = el(root, 'confirmBar');

  const close = () => {
    bar.hidden = true;
    actions.hidden = false;
  };

  el(root, 'delete').addEventListener('click', () => {
    actions.hidden = true;
    bar.hidden = false;
    el(root, 'cancelDelete').focus();
  });

  el(root, 'cancelDelete').addEventListener('click', close);

  el(root, 'confirmDelete').addEventListener('click', async () => {
    try {
      await withBusy(el(root, 'confirmDelete'), '삭제 중…', remove);
    } catch (err) {
      if (err.status === 401) return;
      toast(err.message);
      close();
    }
  });
}

/* ------------------------------------------------------- 작성 중 이탈 방지 */

/**
 * 사용자가 폼에 무언가 입력했다면, 화면을 떠날 때 확인을 받도록 등록한다.
 *
 * 왜 beforeunload가 아닌가
 *   beforeunload는 탭을 닫거나 주소 자체를 바꿀 때만 발생한다. 이 앱은 주소의
 *   # 뒤만 바뀌는 방식이라 화면을 옮겨도 그 이벤트가 발생하지 않는다. 그래서
 *   라우터가 화면을 옮기기 직전에 직접 물어보는 방식을 쓴다(navigate.js의 이탈 가드).
 *
 * 왜 "처음 값과 비교"가 아니라 "입력 이벤트를 듣기"인가
 *   처음에는 폼을 연 시점의 값을 저장해 두고 떠날 때 비교하려 했는데, 그러면
 *   값을 다 채운 뒤에 기준을 잡아야 해서 화면마다 호출 위치를 신경 써야 했다.
 *   (수정 화면은 서버에서 값을 받아 채우므로, 채우기 전에 기준을 잡으면
 *    열자마자 "고쳤다"고 판단해 버린다)
 *
 *   input·change 이벤트는 사람이 입력할 때만 발생하고, 코드가 value에 값을
 *   넣을 때는 발생하지 않는다. 그래서 폼을 만들자마자 등록해 두어도
 *   불러온 값을 채우는 것과 사람이 고친 것이 저절로 구분된다.
 *
 * @returns {{ markDirty: Function, release: Function }}
 *   markDirty  코드로 값을 채워 넣었지만 "잃으면 아까운" 경우 직접 표시한다
 *   release    저장에 성공해 더 이상 막을 필요가 없을 때 부른다
 */
export function guardUnsavedChanges(formEl) {
  let touched = false;
  const mark = () => {
    touched = true;
  };

  // 폼 안쪽 어디서 발생하든 위로 올라오므로 폼에 한 번만 걸면 된다.
  // 나중에 추가되는 세트·음식 행에도 그대로 적용된다.
  formEl.addEventListener('input', mark);
  formEl.addEventListener('change', mark);

  setLeaveGuard(() => touched);

  return {
    markDirty: mark,
    release: clearLeaveGuard,
  };
}
