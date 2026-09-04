// 날짜 도우미.

/** 오늘 날짜를 YYYY-MM-DD로. UTC 기준(toISOString)으로 하면 자정 무렵 하루가 밀린다. */
export function today() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** "2026-09-01" -> "2026-09-01 (화)" */
export function formatDayLabel(date) {
  const [year, month, day] = String(date).split('-').map(Number);
  if (!year || !month || !day) return date;

  return `${date} (${WEEKDAYS[new Date(year, month - 1, day).getDay()]})`;
}

/** "2026-09-01" 에서 며칠 앞뒤로 옮긴 날짜. 월말·연말도 Date가 알아서 넘겨준다. */
export function shiftDate(date, days) {
  const [year, month, day] = String(date).split('-').map(Number);
  const moved = new Date(year, month - 1, day + days);

  const pad = (value) => String(value).padStart(2, '0');
  return `${moved.getFullYear()}-${pad(moved.getMonth() + 1)}-${pad(moved.getDate())}`;
}
