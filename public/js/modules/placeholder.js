// 아직 구현하지 않은 모듈의 자리표시 화면.
// 1단계에서 탭 이동이 동작하는지 확인하기 위한 것이며, 각 단계에서 실제 화면으로 교체된다.

import { mountView, el } from '../ui.js';

export function showPlaceholder(title) {
  const root = mountView('tpl-placeholder');
  el(root, 'title').textContent = title;
}
