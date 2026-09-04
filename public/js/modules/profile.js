// 프로필 화면. 기초대사량 계산에 필요한 성별·출생연도·키를 받는다.

import { api, session } from '../api.js';
import {
  mountView, el, clearError, showError, renderHeader, toast, withBusy, navSnapshot,
} from '../ui.js';
import { loadScreen } from '../screen.js';
import { numValue } from '../rows.js';

function fill(root, user) {
  el(root, 'name').value = user.name || '';
  el(root, 'email').value = user.email || '';

  const profile = user.profile || {};
  el(root, 'sex').value = profile.sex || '';
  el(root, 'birthYear').value = profile.birthYear ?? '';
  el(root, 'heightCm').value = profile.heightCm ?? '';

  el(root, 'form').hidden = false;
  el(root, 'pwForm').hidden = false;
}

/* --------------------------------------------------------------- 비밀번호 */

async function handlePasswordSubmit(root, event) {
  event.preventDefault();

  const errorEl = el(root, 'pwError');
  clearError(errorEl);

  const currentPassword = el(root, 'currentPassword').value;
  const newPassword = el(root, 'newPassword').value;
  const confirm = el(root, 'newPassword2').value;

  // 서버도 같은 것을 검사하지만, 여기서 먼저 걸러 주면 왕복 없이 바로 알 수 있다.
  // 서버 검사를 생략해도 된다는 뜻은 아니다. 화면은 얼마든지 우회할 수 있다.
  if (!currentPassword || !newPassword) {
    return showError(errorEl, '현재 비밀번호와 새 비밀번호를 모두 입력해 주세요.');
  }
  if (newPassword.length < 8) {
    return showError(errorEl, '새 비밀번호는 8자 이상이어야 합니다.');
  }

  // 확인란은 화면에만 있는 개념이라 서버로 보내지 않는다.
  // 오타로 자기 계정에서 잠기는 것을 막기 위한 장치다.
  if (newPassword !== confirm) {
    return showError(errorEl, '새 비밀번호가 서로 다릅니다.');
  }

  try {
    const result = await withBusy(el(root, 'pwSubmit'), '변경 중…', () =>
      api.changePassword({ currentPassword, newPassword })
    );

    /**
     * 서버가 새 토큰을 함께 준다. 반드시 갈아 끼워야 한다.
     * 비밀번호를 바꾸는 순간 그 전에 발급된 토큰은 전부 무효가 되므로,
     * 갖고 있던 토큰을 그대로 두면 다음 요청부터 로그아웃된다.
     */
    session.save(result.token, session.user);

    // 입력값은 화면에 남겨 두지 않는다.
    el(root, 'currentPassword').value = '';
    el(root, 'newPassword').value = '';
    el(root, 'newPassword2').value = '';

    toast('비밀번호가 변경되었습니다');
  } catch (err) {
    // 401은 세션 만료뿐이다. 라우터가 로그인 화면으로 보내므로 여기서 할 일이 없다.
    // "현재 비밀번호가 틀렸다"는 400으로 오므로 아래에서 폼에 그대로 표시된다.
    if (err.status === 401) return;
    showError(errorEl, err.message);
  }
}

async function handleSubmit(root, event) {
  event.preventDefault();

  const errorEl = el(root, 'error');
  clearError(errorEl);

  const name = el(root, 'name').value.trim();
  if (!name) return showError(errorEl, '이름은 비어 있을 수 없습니다.');

  // 비운 칸은 null로 보낸다. 서버가 "값 없음"으로 저장하고, 대시보드는 계산을 건너뛴다.
  const payload = {
    name,
    profile: {
      sex: el(root, 'sex').value || null,
      birthYear: numValue(el(root, 'birthYear')),
      heightCm: numValue(el(root, 'heightCm')),
    },
  };

  try {
    const updated = await withBusy(el(root, 'submit'), '저장 중…', () => api.updateMe(payload));

    // 헤더에 뜨는 이름도 같이 갱신해야 한다. 토큰은 그대로 두고 사용자 정보만 바꾼다.
    session.save(session.token, updated);
    renderHeader(updated);

    toast('저장되었습니다');
  } catch (err) {
    if (err.status === 401) return;
    showError(errorEl, err.message);
  }
}

export async function showProfile() {
  const nav = navSnapshot();
  const root = mountView('tpl-profile');

  el(root, 'form').addEventListener('submit', (event) => handleSubmit(root, event));
  el(root, 'pwForm').addEventListener('submit', (event) => handlePasswordSubmit(root, event));

  await loadScreen({
    nav,
    statusEl: el(root, 'status'),
    load: () => api.getMe(),
    render: (user) => fill(root, user),
  });
}
