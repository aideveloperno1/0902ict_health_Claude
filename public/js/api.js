// 서버 통신과 로그인 상태 보관을 담당한다.

const USER_KEY = 'workoutLog.user';

/**
 * 액세스 토큰은 "메모리에만" 둔다. localStorage에 넣지 않는다.
 *
 * 왜 바꿨나
 *   localStorage는 이 사이트에서 도는 모든 자바스크립트가 읽을 수 있다.
 *   XSS(남의 스크립트가 우리 페이지에서 실행되는 것) 구멍이 하나라도 생기면
 *   토큰이 통째로 새어 나간다.
 *
 *   지금은 이렇게 나눈다.
 *     액세스 토큰(15분)  → 자바스크립트 변수. 새로고침하면 사라진다.
 *     갱신 토큰(14일)    → httpOnly 쿠키. 자바스크립트가 아예 읽을 수 없다.
 *
 *   그래서 XSS가 나더라도 훔칠 수 있는 것은 최대 15분짜리 토큰뿐이고,
 *   로그인 상태를 이어 주는 진짜 열쇠는 건드릴 수 없다.
 *
 * 새로고침하면 어떻게 되나
 *   변수가 사라지므로 앱을 켤 때 항상 갱신을 한 번 시도한다(main.js).
 *   쿠키가 살아 있으면 조용히 다시 로그인된 상태가 되고, 아니면 로그인 화면이 뜬다.
 *
 * 사용자 정보(이름·이메일)는 계속 localStorage에 둔다.
 * 새어 나가도 계정을 빼앗기지 않는 값이고, 화면을 그릴 때 바로 필요하기 때문이다.
 */
let accessToken = null;

export const session = {
  get token() {
    return accessToken;
  },
  get user() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY));
    } catch {
      return null;
    }
  },
  save(token, user) {
    accessToken = token;
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    accessToken = null;
    localStorage.removeItem(USER_KEY);
  },
};

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// 토큰이 만료·무효일 때 로그인 화면으로 돌려보내기 위한 콜백. main.js가 등록한다.
let onSessionExpired = () => {};
export function setSessionExpiredHandler(fn) {
  onSessionExpired = fn;
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.publicRoute]
 *   로그인·회원가입처럼 토큰이 필요 없는 요청. 이 경우 401은 "비밀번호가 틀렸다"는
 *   뜻이므로 세션 만료 처리를 하지 않고 서버 메시지를 그대로 전달한다.
 * @param {boolean} [opts.withHeaders]
 *   응답 본문만이 아니라 헤더까지 필요할 때 { data, headers } 형태로 돌려준다.
 *   목록의 전체 개수(X-Total-Count)가 본문이 아니라 헤더로 오기 때문에 필요하다.
 */
/**
 * 갱신 요청은 동시에 여러 번 나가면 안 된다.
 *
 * 대시보드는 네 개의 요청을 한꺼번에 보낸다. 액세스 토큰이 막 만료됐다면 네 개가
 * 모두 401을 받는데, 각자 갱신을 시도하면 네 번 나간다. 갱신 토큰은 한 번 쓰면
 * 버려지므로(회전), 첫 번째만 성공하고 나머지 세 개는 "이미 쓴 토큰"으로 실패해
 * 사용자가 이유 없이 로그아웃된다.
 *
 * 그래서 진행 중인 갱신 약속을 하나만 두고 모두가 그것을 함께 기다린다.
 */
let refreshing = null;

function refreshAccessToken() {
  if (!refreshing) {
    refreshing = fetch('/api/auth/refresh', { method: 'POST' })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json();
        session.save(data.token, data.user);
        return data.token;
      })
      .catch(() => null)
      .finally(() => {
        // 다음 만료 때 다시 시도할 수 있도록 비운다.
        refreshing = null;
      });
  }
  return refreshing;
}

/**
 * @param {boolean} [retrying] 갱신 후 다시 보내는 중인지. 무한 반복을 막는다.
 */
async function request(method, path, body, opts = {}, retrying = false) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const token = session.token;
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인해 주세요.', 0);
  }

  if (res.status === 401 && !opts.publicRoute) {
    /**
     * 액세스 토큰이 만료됐을 수 있다. 갱신 토큰으로 새로 받아 한 번만 다시 보낸다.
     * 사용자는 아무것도 눈치채지 못하고 하던 일을 계속한다.
     *
     * retrying으로 한 번만 시도하는 이유: 새 토큰으로도 401이면 갱신으로 풀리는
     * 문제가 아니다(비밀번호가 바뀌었거나 계정이 사라진 경우). 계속 시도하면
     * 요청이 끝없이 반복된다.
     */
    if (!retrying) {
      const fresh = await refreshAccessToken();
      if (fresh) return request(method, path, body, opts, true);
    }

    // 여러 요청이 동시에 실패해도 안내와 화면 전환은 한 번만 일어나게 한다.
    const hadToken = session.token !== null;
    session.clear();
    if (hadToken) onSessionExpired();
    throw new ApiError('로그인이 만료되었습니다. 다시 로그인해 주세요.', 401);
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    throw new ApiError(data?.message || `요청에 실패했습니다. (${res.status})`, res.status);
  }

  return opts.withHeaders ? { data, headers: res.headers } : data;
}

/**
 * 목록을 "페이지 단위로" 받아온다.
 *
 * 서버는 목록 응답의 본문을 항상 배열로 주고, 전체 개수 같은 정보는 헤더에 담는다.
 *   X-Total-Count  조건에 맞는 전체 개수
 *   X-Total-Pages  전체 페이지 수
 * 화면에서 "더 보기" 버튼을 언제 감출지 정하려면 이 값이 필요하므로,
 * 여기서 본문과 헤더를 하나로 합쳐서 돌려준다.
 *
 * @returns {Promise<{items: object[], total: number, totalPages: number, page: number}>}
 */
async function requestPage(resource, { page = 1, limit = 10, date } = {}) {
  // URLSearchParams를 쓰면 값에 특수문자가 있어도 알아서 안전하게 인코딩해 준다.
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (date) params.set('date', date);

  const { data, headers } = await request('GET', `/${resource}?${params}`, undefined, {
    withHeaders: true,
  });

  // 헤더가 없거나 숫자가 아니면(중간에 프록시가 지우는 경우 등) 받은 개수로 갈음한다.
  // 화면이 헤더 하나 때문에 아예 안 그려지는 것보다 낫다.
  const toInt = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  return {
    items: data,
    total: toInt(headers.get('X-Total-Count'), data.length),
    totalPages: toInt(headers.get('X-Total-Pages'), 1),
    page,
  };
}

export const api = {
  signup: (body) => request('POST', '/auth/signup', body, { publicRoute: true }),
  login: (body) => request('POST', '/auth/login', body, { publicRoute: true }),

  // 앱을 켤 때 한 번 부른다. 쿠키가 살아 있으면 로그인 상태를 되살린다.
  // publicRoute로 두는 이유: 여기서의 401은 "세션 만료"가 아니라
  // "아직 로그인한 적이 없다"는 정상적인 답이라, 만료 안내를 띄우면 안 된다.
  restoreSession: () => request('POST', '/auth/refresh', undefined, { publicRoute: true }),

  logout: () => request('POST', '/auth/logout', undefined, { publicRoute: true }),

  /**
   * 목록 함수가 자원마다 두 벌인 이유
   *   listWorkouts(date)      -> 배열을 그대로 준다. 조건에 맞는 것을 "전부" 받는다.
   *   listWorkoutsPage(opts)  -> { items, total, totalPages, page } 를 준다.
   *
   * 대시보드는 "그날의 기록 전부"를 합산해야 하므로 나눠 받으면 총합이 틀린다.
   * 반대로 목록 화면은 전부 받을 이유가 없어 페이지 단위로 받는다.
   * 필요에 따라 골라 쓸 수 있게 두 가지를 모두 남겨 둔다.
   */
  listWorkouts: (date) => request('GET', date ? `/workouts?date=${date}` : '/workouts'),
  listWorkoutsPage: (opts) => requestPage('workouts', opts),
  getWorkout: (id) => request('GET', `/workouts/${id}`),
  createWorkout: (body) => request('POST', '/workouts', body),
  updateWorkout: (id, body) => request('PUT', `/workouts/${id}`, body),
  deleteWorkout: (id) => request('DELETE', `/workouts/${id}`),

  listRoutines: () => request('GET', '/routines'),
  getRoutine: (id) => request('GET', `/routines/${id}`),
  createRoutine: (body) => request('POST', '/routines', body),
  updateRoutine: (id, body) => request('PUT', `/routines/${id}`, body),
  deleteRoutine: (id) => request('DELETE', `/routines/${id}`),

  getMe: () => request('GET', '/auth/me'),
  updateMe: (body) => request('PUT', '/auth/me', body),
  changePassword: (body) => request('PUT', '/auth/password', body),

  listBodyMetrics: (date) =>
    request('GET', date ? `/body-metrics?date=${date}` : '/body-metrics'),
  listBodyMetricsPage: (opts) => requestPage('body-metrics', opts),
  saveBodyMetric: (body) => request('POST', '/body-metrics', body),
  deleteBodyMetric: (id) => request('DELETE', `/body-metrics/${id}`),

  listMeals: (date) => request('GET', date ? `/meals?date=${date}` : '/meals'),
  listMealsPage: (opts) => requestPage('meals', opts),
  getMeal: (id) => request('GET', `/meals/${id}`),
  createMeal: (body) => request('POST', '/meals', body),
  updateMeal: (id, body) => request('PUT', `/meals/${id}`, body),
  deleteMeal: (id) => request('DELETE', `/meals/${id}`),
};
