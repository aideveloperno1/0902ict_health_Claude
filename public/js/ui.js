// 화면 부착과 공통 표시 도우미.

/** 앱 껍데기(헤더·토스트 등) 전용. 화면 안쪽 요소에는 쓰지 않는다. */
export const $ = (id) => document.getElementById(id);

/**
 * 화면 안 요소는 id가 아니라 data-el로 찾는다.
 * 모듈이 늘어도 이름이 겹치지 않고, 같은 템플릿을 여러 번 붙여도 안전하다.
 */
export const el = (root, name) => root.querySelector(`[data-el="${name}"]`);

/** 템플릿을 #app에 붙이고 그 화면의 최상위 요소를 돌려준다. */
export function mountView(templateId) {
  const fragment = $(templateId).content.cloneNode(true);
  const root = fragment.firstElementChild;

  $('app').replaceChildren(fragment);
  // 배경 광원은 로그인 화면에서만 보인다 (CSS의 body[data-view="auth"])
  document.body.dataset.view = templateId.replace(/^tpl-/, '');
  window.scrollTo(0, 0);

  return root;
}

/* ------------------------------------------------------------------ 헤더 */

export function renderHeader(user) {
  $('appHeader').hidden = !user;
  $('userName').textContent = user ? `${user.name} 님` : '';
}

/** 현재 화면에 해당하는 탭을 강조한다. 라우터가 라우트 정의를 보고 호출한다. */
export function setActiveTab(name) {
  for (const tab of $('tabs').querySelectorAll('.tab')) {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

/* ------------------------------------------------------------------ 상태 표시 */

export function showError(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

export function clearError(element) {
  showError(element, '');
}

export function showStatus(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

let toastTimer;
export function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.hidden = true;
  }, 2400);
}

/**
 * 요청이 끝날 때까지 버튼을 잠근다. 연타로 같은 요청이 여러 번 나가는 것을 막는다.
 * 실패해도 반드시 원래 상태로 되돌린다.
 */
export async function withBusy(button, label, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

/* ------------------------------------------------------------------ 이탈 확인 바 */

/**
 * 작성 중인 폼을 떠나려 할 때 확인을 받는다.
 *
 * @param {Function} onLeave 사용자가 "나가기"를 골랐을 때 실행할 것
 *
 * 확인을 받는 동안 화면은 그대로 둔다. 사용자가 "계속 작성"을 고르면
 * 적던 내용이 눈앞에 그대로 있어야 하기 때문이다.
 */
export function confirmLeave(onLeave) {
  const bar = $('leaveBar');
  const stay = $('leaveStay');
  const leave = $('leaveGo');

  const close = () => {
    bar.hidden = true;
    // 리스너를 걷어낸다. 이게 없으면 확인 바를 열 때마다 쌓여서
    // 두 번째부터는 "나가기" 한 번에 여러 번 이동하게 된다.
    stay.removeEventListener('click', onStay);
    leave.removeEventListener('click', onGo);
    document.removeEventListener('keydown', onKey);
  };

  function onStay() {
    close();
  }

  function onGo() {
    close();
    onLeave();
  }

  // Esc는 "계속 작성"과 같다. 실수로 내용을 날리는 쪽이 기본이 되면 안 된다.
  function onKey(event) {
    if (event.key === 'Escape') onStay();
  }

  stay.addEventListener('click', onStay);
  leave.addEventListener('click', onGo);
  document.addEventListener('keydown', onKey);

  bar.hidden = false;
  stay.focus();
}

/* ------------------------------------------------------------------ 화면 전환 순번 */

/* 비동기 응답이 도착했을 때 그 사이 다른 화면으로 넘어갔는지 확인하는 데 쓴다.
   뒤로가기가 생기면서 "응답을 기다리는 중에 사용자가 화면을 떠나는" 경우가 가능해졌다. */
let navToken = 0;

/** 라우터가 새 화면을 그리기 직전에 호출한다. */
export function beginNavigation() {
  navToken += 1;
}

/** 비동기 작업을 시작하기 전에 현재 순번을 받아 둔다. */
export function navSnapshot() {
  return navToken;
}

/** 받아 둔 순번이 더 이상 최신이 아니면 true. 이때는 DOM을 건드리지 않는다. */
export function isStale(snapshot) {
  return snapshot !== navToken;
}

/** 템플릿의 최상위 요소를 복제한다. 화면·행 템플릿 모두 이걸 쓴다. */
export function cloneTemplate(templateId) {
  return $(templateId).content.firstElementChild.cloneNode(true);
}
