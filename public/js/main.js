// 진입점. 모듈을 연결하고 라우터를 시작한다.
// 첫 화면은 라우터가 주소를 보고 결정하므로 여기서 정하지 않는다.

import { api, session, setSessionExpiredHandler } from './api.js';
import { initTheme, applyStoredTheme } from './theme.js';
import { $, toast } from './ui.js';
import { initAuth } from './modules/auth.js';
import { startRouter, afterLogin, refresh } from './router.js';

// 저장된 화면 밝기를 가장 먼저 적용한다.
// 뒤로 미루면 기본 테마로 한 번 그려졌다가 바뀌는 깜빡임이 보인다.
applyStoredTheme();

async function logout() {
  // 서버의 갱신 토큰도 함께 지운다. 화면에서만 지우면 쿠키가 남아 있어
  // 새로고침 한 번에 다시 로그인된 상태로 돌아온다.
  // 실패해도 로그아웃은 진행한다. 사용자가 나가려는 것을 막을 이유가 없다.
  try {
    await api.logout();
  } catch {
    // 서버에 닿지 못해도 이 브라우저에서는 로그아웃되어야 한다.
  }

  session.clear();
  // 주소는 그대로 두고, 라우터의 로그인 가드가 로그인 화면을 띄우게 한다.
  refresh();
  toast('로그아웃되었습니다');
}

// 갱신까지 실패했을 때(갱신 토큰도 만료·폐기됨) 여기로 들어온다.
// 액세스 토큰만 만료된 경우는 api.js가 조용히 새로 받아 오므로 여기까지 오지 않는다.
setSessionExpiredHandler(() => {
  refresh();
  toast('로그인이 만료되었습니다. 다시 로그인해 주세요.');
});

initAuth({ onLoggedIn: afterLogin });

$('logoutBtn').addEventListener('click', logout);
initTheme($('themeBtn'));

/**
 * 앱을 켤 때 로그인 상태를 되살린다.
 *
 * 액세스 토큰은 메모리에만 두므로 새로고침하면 사라진다(api.js 참고).
 * 대신 갱신 토큰이 httpOnly 쿠키로 남아 있으니, 그것으로 새 액세스 토큰을 받아 온다.
 *
 * 라우터를 "이 시도가 끝난 뒤에" 시작해야 한다. 먼저 시작하면 토큰이 아직 없어서
 * 로그인 가드가 로그인 화면을 띄우고, 잠시 뒤 갱신에 성공해 화면이 다시 바뀌는
 * 깜빡임이 생긴다.
 *
 * 실패해도(처음 방문, 로그아웃 상태, 쿠키 만료) 아무 문제가 없다.
 * 토큰이 없는 채로 라우터가 시작되고, 가드가 로그인 화면을 띄운다.
 */
try {
  const { token, user } = await api.restoreSession();
  session.save(token, user);
} catch {
  // 로그인한 적이 없거나 기간이 지났다. 로그인 화면으로 가면 된다.
}

startRouter();
