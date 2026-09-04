// 로그인 / 회원가입 화면.

import { api, session } from '../api.js';
import { mountView, el, clearError, showError, toast, withBusy } from '../ui.js';

let mode = 'login'; // 'login' | 'signup'
let onLoggedIn = () => {};

export function initAuth(handlers) {
  onLoggedIn = handlers.onLoggedIn;
}

/** 현재 모드(로그인/회원가입)에 맞게 문구와 필드를 맞춘다. */
function applyMode(root) {
  const isSignup = mode === 'signup';

  el(root, 'nameField').hidden = !isSignup;
  el(root, 'sub').textContent = isSignup ? '새 계정을 만드세요' : '계정에 로그인하세요';
  el(root, 'submit').textContent = isSignup ? '회원가입' : '로그인';
  el(root, 'switchText').textContent = isSignup
    ? '이미 계정이 있으신가요?'
    : '계정이 없으신가요?';
  el(root, 'switch').textContent = isSignup ? '로그인' : '회원가입';

  // 브라우저가 저장된 비밀번호를 제안할지 여부가 달라진다.
  el(root, 'password').autocomplete = isSignup ? 'new-password' : 'current-password';

  clearError(el(root, 'error'));
}

async function handleSubmit(root, event) {
  event.preventDefault();

  const errorEl = el(root, 'error');
  clearError(errorEl);

  const name = el(root, 'name').value.trim();
  const email = el(root, 'email').value.trim();
  const password = el(root, 'password').value;

  // 서버에 보내기 전에 걸러낼 수 있는 것은 미리 알려준다. 서버 검증도 그대로 살아 있다.
  if (!email || !password || (mode === 'signup' && !name)) {
    return showError(errorEl, '모든 항목을 입력해 주세요.');
  }
  if (mode === 'signup' && password.length < 8) {
    return showError(errorEl, '비밀번호는 8자 이상이어야 합니다.');
  }

  const wasSignup = mode === 'signup';

  try {
    await withBusy(el(root, 'submit'), '처리 중…', async () => {
      if (wasSignup) await api.signup({ email, password, name });
      // 가입 직후에도 바로 로그인시켜 준다.
      const { token, user } = await api.login({ email, password });
      session.save(token, user);
    });
  } catch (err) {
    return showError(errorEl, err.message);
  }

  mode = 'login';
  onLoggedIn();
  toast(wasSignup ? '가입이 완료되었습니다' : '로그인되었습니다');
}

/** 로그인 화면을 띄운다. 라우터의 로그인 가드가 호출한다. */
export function showAuthView() {
  mode = 'login';

  const root = mountView('tpl-auth');
  applyMode(root);

  el(root, 'form').addEventListener('submit', (event) => handleSubmit(root, event));

  el(root, 'switch').addEventListener('click', () => {
    mode = mode === 'login' ? 'signup' : 'login';
    applyMode(root);
    el(root, mode === 'signup' ? 'name' : 'email').focus();
  });
}
