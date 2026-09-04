// 주소 이동만 담당한다.
// 라우터를 참조하지 않으므로 router.js ↔ workouts.js 사이에 순환 import가 생기지 않는다.

// 해시를 현재와 같은 값으로 다시 넣으면 hashchange가 발생하지 않아 화면이 갱신되지 않는다.
// 그럴 때는 이벤트를 직접 발생시켜 라우터가 다시 그리게 한다.
function forceDispatch() {
  window.dispatchEvent(new Event('hashchange'));
}

/** 방문 기록을 쌓으며 이동한다. 대부분의 이동은 이것을 쓴다. */
export function go(hash) {
  if (location.hash === hash) return forceDispatch();
  location.hash = hash;
}

/**
 * 현재 방문 기록을 덮어쓰며 이동한다.
 * 뒤로가기로 되돌아가면 안 되는 곳(삭제한 일지, 로그인 화면)을 떠날 때 쓴다.
 */
export function replace(hash) {
  if (location.hash === hash) return forceDispatch();
  location.replace(location.pathname + location.search + hash);
}

/* ------------------------------------------------------------ 이탈 가드 */

/**
 * "지금 화면을 떠나도 되는가"를 판단하는 함수를 한 개 보관한다.
 *
 * 왜 router.js가 아니라 여기에 두나
 *   router.js는 화면 모듈들(workouts.js 등)을 가져다 쓰고, 그 화면 모듈들이
 *   가드를 등록해야 한다. 가드를 router.js에 두면 서로가 서로를 가져오는
 *   순환 import가 된다. 이 파일은 아무것도 가져오지 않으므로 안전하다.
 *   (파일 맨 위 주석에 적힌 것과 같은 이유다)
 */
let leaveGuard = null;

/**
 * @param {Function} fn 떠나면 안 될 때 true를 돌려주는 함수
 */
export function setLeaveGuard(fn) {
  leaveGuard = fn;
}

/** 저장하고 나가는 등, 더 이상 막을 이유가 없어졌을 때 부른다. */
export function clearLeaveGuard() {
  leaveGuard = null;
}

/** 라우터가 화면을 옮기기 직전에 물어본다. 가드가 없으면 언제나 떠나도 된다. */
export function shouldBlockLeave() {
  return typeof leaveGuard === 'function' && leaveGuard() === true;
}
