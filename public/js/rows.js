// 반복 입력 행을 다루는 도우미.
// 운동의 세트 행과 식단의 음식 행이 같은 뼈대를 쓴다.

import { cloneTemplate } from './ui.js';

/**
 * 행을 하나 만들어 컨테이너에 붙인다.
 * 삭제 버튼을 배선하고, 값이 바뀌었다는 신호(input)를 컨테이너로 올려보낸다.
 * 이 신호를 받아 합계를 다시 계산하므로, 행을 지워도 즉시 반영된다.
 *
 * @param {HTMLElement} container 행이 담기는 요소
 * @param {string}      templateId 행 템플릿 id
 * @param {Function}    [fill]     만든 행에 값을 채운다
 * @param {Function}    [onRemove] 삭제 직후 처리 (번호 다시 매기기 등)
 */
export function appendRow(container, templateId, { fill, onRemove } = {}) {
  const row = cloneTemplate(templateId);

  fill?.(row);

  row.querySelector('[data-el="remove"]').addEventListener('click', () => {
    row.remove();
    onRemove?.();
    container.dispatchEvent(new Event('input', { bubbles: true }));
  });

  container.append(row);
  return row;
}

/** 입력창에서 숫자를 꺼낸다. 빈 칸은 null. Number('')가 0이 되는 함정을 여기서 막는다. */
export function numValue(input) {
  const raw = input.value.trim();
  if (raw === '') return null;

  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
