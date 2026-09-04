// 밝은 화면 / 어두운 화면 전환.

const KEY = 'workoutLog.theme';

// 'system'이면 아무 표시도 남기지 않는다. 그러면 CSS의 prefers-color-scheme이 결정한다.
const ORDER = ['system', 'light', 'dark'];

const LABEL = {
  system: { icon: '🌗', text: '시스템 설정을 따릅니다' },
  light: { icon: '☀️', text: '밝은 화면' },
  dark: { icon: '🌙', text: '어두운 화면' },
};

/** 저장된 선택을 읽는다. 없거나 이상한 값이면 시스템 설정을 따른다. */
function stored() {
  try {
    const value = localStorage.getItem(KEY);
    return ORDER.includes(value) ? value : 'system';
  } catch {
    // 브라우저가 저장소를 막아 둔 경우(시크릿 모드 등)에도 화면은 떠야 한다.
    return 'system';
  }
}

/**
 * 선택을 화면에 반영한다.
 *
 * <html>에 data-theme을 붙이거나 뗀다. 색은 전부 CSS 변수라서
 * 이 속성 하나만 바뀌면 화면 전체가 함께 바뀐다.
 */
function apply(theme) {
  const root = document.documentElement;

  if (theme === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = theme;
}

/**
 * 헤더의 버튼에 연결한다. 누를 때마다 시스템 → 밝게 → 어둡게 순으로 돈다.
 *
 * 왜 두 개(밝게/어둡게)가 아니라 세 개인가
 *   "시스템 설정을 따른다"가 빠지면, 한 번이라도 누른 사람은 그 뒤로 영원히
 *   고정된 화면만 보게 된다. 저녁에 기기가 어두운 화면으로 바뀌어도 따라가지 않는다.
 *   되돌릴 방법을 남겨 두어야 한다.
 */
export function initTheme(button) {
  let theme = stored();
  apply(theme);
  paint();

  function paint() {
    const { icon, text } = LABEL[theme];
    button.textContent = icon;
    button.title = text;
    // 아이콘만 있는 버튼이라 화면 낭독기를 위한 설명을 따로 붙인다.
    button.setAttribute('aria-label', `화면 밝기: ${text}. 눌러서 변경`);
  }

  button.addEventListener('click', () => {
    theme = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];

    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // 저장에 실패해도 이번 방문에는 적용된다.
    }

    apply(theme);
    paint();
  });
}

/**
 * 화면이 그려지기 전에 저장된 선택을 미리 적용한다.
 *
 * initTheme은 모듈이 다 불러와진 뒤에 실행되는데, 그 사이 아주 잠깐
 * 기본 테마로 그려졌다가 바뀌는 깜빡임이 생긴다. 이 함수는 main.js 맨 위에서
 * 곧바로 부르기 위한 것이다.
 */
export function applyStoredTheme() {
  apply(stored());
}
