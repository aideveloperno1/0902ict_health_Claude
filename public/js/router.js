// 해시 기반 라우터. 주소(#/...)와 화면을 연결한다.
//
// 해시 뒤쪽은 서버로 전송되지 않으므로, 백엔드의 정적 파일 서빙과 JSON 404 핸들러를
// 그대로 둔 채 브라우저 뒤로/앞으로가기를 지원할 수 있다.

import { session } from './api.js';
import { renderHeader, beginNavigation, setActiveTab, confirmLeave } from './ui.js';
import { showAuthView } from './modules/auth.js';
import {
  showList, openDetail, openCreateForm, openEditForm,
} from './modules/workouts.js';
import {
  showList as showMeals,
  openDetail as openMeal,
  openCreateForm as openMealForm,
  openEditForm as openMealEdit,
} from './modules/meals.js';
import {
  showList as showRoutines,
  openCreateForm as openRoutineForm,
  openEditForm as openRoutineEdit,
} from './modules/routines.js';
import { showDashboard } from './modules/dashboard.js';
import { showBody } from './modules/body.js';
import { showProfile } from './modules/profile.js';
import { showPlaceholder } from './modules/placeholder.js';
import { replace, shouldBlockLeave, clearLeaveGuard } from './navigate.js';

const DEFAULT_HASH = '#/';

// [정규식, 실행 함수, 강조할 탭]
//
// id는 MongoDB의 ObjectId라 24자리 16진 문자열이다. (전에는 숫자여서 (\d+)를 썼다)
// #/workouts/new 는 길이가 24가 아니라 id 패턴과 겹치지 않지만, 읽기 쉽게 위에 둔다.
const routes = [
  [/^#\/$/, () => showDashboard(), 'dashboard'],

  [/^#\/workouts$/, () => showList(), 'workouts'],
  [/^#\/workouts\/new$/, () => openCreateForm(), 'workouts'],
  [/^#\/workouts\/new\/from\/([0-9a-f]{24})$/, (id) => openCreateForm(id), 'workouts'],
  [/^#\/workouts\/([0-9a-f]{24})$/, (id) => openDetail(id), 'workouts'],
  [/^#\/workouts\/([0-9a-f]{24})\/edit$/, (id) => openEditForm(id), 'workouts'],

  [/^#\/meals$/, () => showMeals(), 'meals'],
  [/^#\/meals\/new$/, () => openMealForm(), 'meals'],
  [/^#\/meals\/([0-9a-f]{24})$/, (id) => openMeal(id), 'meals'],
  [/^#\/meals\/([0-9a-f]{24})\/edit$/, (id) => openMealEdit(id), 'meals'],
  [/^#\/routines$/, () => showRoutines(), 'routines'],
  [/^#\/routines\/new$/, () => openRoutineForm(), 'routines'],
  [/^#\/routines\/([0-9a-f]{24})\/edit$/, (id) => openRoutineEdit(id), 'routines'],
  [/^#\/body$/, () => showBody(), 'body'],
  [/^#\/profile$/, () => showProfile(), null],
];

// 로그아웃 상태에서 열려던 주소. 로그인에 성공하면 이 주소로 보낸다.
let intendedHash = null;

/* --------------------------------------------------- 작성 중 이탈 확인 */

// 지금 그려져 있는 화면의 주소. 이탈을 막았을 때 여기로 되돌린다.
let currentHash = location.hash;

// 되돌리는 중에 발생하는 hashchange를 한 번 무시하기 위한 표시.
// 이게 없으면 되돌리기 → hashchange → 다시 확인 바 → 무한 반복이 된다.
let reverting = false;

/** 주소에 맞는 실행 함수와 탭 이름을 찾는다. 없으면 null. */
function match(hash) {
  for (const [pattern, handler, tab] of routes) {
    const found = hash.match(pattern);
    if (found) return { run: () => handler(...found.slice(1)), tab };
  }
  return null;
}

function dispatch() {
  const hash = location.hash;

  // 주소를 되돌리느라 발생한 이벤트다. 화면은 그대로 두고 넘어간다.
  if (reverting) {
    reverting = false;
    return;
  }

  /**
   * 작성 중인 폼을 떠나려는지 확인한다.
   *
   * hashchange는 주소가 "이미 바뀐 뒤에" 발생한다. 그래서 막으려면
   * 주소를 직접 원래대로 되돌려야 한다. 사용자가 "나가기"를 고르면
   * 가드를 풀고 원래 가려던 주소로 다시 보낸다.
   *
   * 되돌릴 때 location.hash에 값을 넣으면 방문 기록이 하나 쌓인다.
   * 뒤로가기로 들어온 경우 앞쪽 기록이 이 항목으로 대체되는데,
   * 작성 중인 내용을 지키는 편이 방문 기록의 정확함보다 중요하다고 보았다.
   */
  if (hash !== currentHash && shouldBlockLeave()) {
    const target = hash;

    reverting = true;
    location.hash = currentHash;

    confirmLeave(() => {
      clearLeaveGuard();
      location.hash = target;
    });
    return;
  }

  // 화면이 바뀌므로 이전 화면이 걸어 둔 가드는 더 이상 유효하지 않다.
  clearLeaveGuard();
  currentHash = hash;

  // 로그인 가드. 토큰이 없으면 어떤 주소로 들어왔든 로그인 화면을 보여준다.
  // 주소 자체는 건드리지 않고, 로그인 후 돌아갈 수 있도록 기억만 해 둔다.
  if (!session.token) {
    intendedHash = match(hash) ? hash : null;
    renderHeader(null);
    showAuthView();
    return;
  }

  const found = match(hash);

  // 모르는 주소(빈 해시, #/workouts/abc 등)는 기본 화면으로 보낸다.
  // replace라서 잘못된 주소가 방문 기록에 남지 않는다.
  if (!found) return replace(DEFAULT_HASH);

  beginNavigation();
  renderHeader(session.user);
  setActiveTab(found.tab);
  found.run();
}

/** 로그인 직후. 가려던 주소가 있으면 그리로, 없으면 기본 화면으로. */
export function afterLogin() {
  const target = intendedHash || DEFAULT_HASH;
  intendedHash = null;
  // replace라서 뒤로가기로 로그인 화면에 되돌아가지 않는다.
  replace(target);
}

/** 로그아웃·세션 만료. 주소는 그대로 두고 가드가 로그인 화면을 띄우게 한다. */
export function refresh() {
  dispatch();
}

export function startRouter() {
  window.addEventListener('hashchange', dispatch);

  if (location.hash) dispatch();
  else replace(DEFAULT_HASH);
}
