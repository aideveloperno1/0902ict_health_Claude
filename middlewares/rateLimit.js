/**
 * 같은 곳에서 같은 요청을 너무 자주 보내면 잠시 막는다.
 *
 * 왜 필요한가
 *   비밀번호를 자동으로 계속 바꿔 가며 시도하면(무차별 대입) 언젠가는 맞는다.
 *   사람은 비밀번호를 다섯 번씩 틀리지 않지만 프로그램은 초당 수백 번도 시도한다.
 *   그래서 "짧은 시간에 여러 번"을 막는 것만으로 이 공격이 사실상 불가능해진다.
 *
 * 왜 라이브러리(express-rate-limit)를 쓰지 않았나
 *   학습용이라 동작을 직접 보는 편이 낫다고 판단했다. 아래 코드가 전부이고,
 *   실제 라이브러리도 저장소가 다를 뿐 원리는 같다.
 *
 * 이 구현의 한계 (실제 서비스라면 반드시 알아야 한다)
 *   1. 기록을 서버 메모리에 둔다 → 서버를 재시작하면 초기화된다.
 *   2. 서버를 여러 대로 늘리면 각자 따로 센다 → 대수만큼 시도 횟수가 늘어난다.
 *   3. 서버리스(Vercel 등)에서는 인스턴스마다 따로 세고 수시로 사라진다
 *      → 사실상 방어가 되지 않는다. 실제 보호가 필요하면 외부 저장소로 옮겨야 한다.
 *   실제 서비스는 Redis처럼 모든 서버가 함께 보는 저장소에 기록을 둔다.
 */

/**
 * @param {number} o.windowMs  이 시간 안의 요청을 함께 센다
 * @param {number} o.max       이 횟수를 넘으면 막는다
 * @param {string} o.message   막혔을 때 보여줄 문구
 * @param {Function} [o.keyOf] 무엇을 기준으로 셀지 정한다 (기본: 접속 IP)
 */
module.exports = function rateLimit({ windowMs, max, message, keyOf = (req) => req.ip }) {
  // key -> { count, resetAt }
  const hits = new Map();

  /**
   * 만료된 기록을 치운다.
   *
   * 이게 없으면 서버가 오래 돌수록 Map이 계속 커진다(메모리 누수).
   * 별도 타이머를 돌리지 않고 요청이 들어올 때 함께 치운다.
   * 요청이 없으면 메모리도 늘지 않으므로 타이머를 돌릴 이유가 없다.
   */
  function sweep(now) {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }

  return function limiter(req, res, next) {
    const now = Date.now();
    sweep(now);

    const key = keyOf(req);
    const entry = hits.get(key);

    // 처음이거나 시간이 다 지났으면 새로 센다.
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;

    if (entry.count > max) {
      const seconds = Math.ceil((entry.resetAt - now) / 1000);

      // Retry-After는 "몇 초 뒤에 다시 오라"는 뜻의 표준 헤더다.
      // 화면이 이 값을 읽어 사용자에게 남은 시간을 보여줄 수 있다.
      res.set('Retry-After', String(seconds));

      // 429 Too Many Requests. 401(인증 실패)과 구분해야 한다.
      // 401로 응답하면 화면이 "비밀번호가 틀렸다"고 잘못 안내하게 된다.
      return res.status(429).json({ message: `${message} (${seconds}초 후 다시 시도해 주세요)` });
    }

    next();
  };
};
