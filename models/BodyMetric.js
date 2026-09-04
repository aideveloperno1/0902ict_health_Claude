const mongoose = require('mongoose');
const { normalizeJson, TIMESTAMPS } = require('./normalize');

const bodyMetricSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    date: { type: String },
    weightKg: { type: Number, default: null },
    conditionMemo: { type: String, default: '' },
  },
  TIMESTAMPS
);

// 날짜당 1건 규칙을 DB가 직접 보장한다. 지금까지는 코드로만 막고 있었다.
// 사용자별로 unique이므로 다른 사람이 같은 날짜로 저장해도 내 기록은 그대로다.
bodyMetricSchema.index({ userId: 1, date: 1 }, { unique: true });

normalizeJson(bodyMetricSchema);

module.exports = mongoose.model('BodyMetric', bodyMetricSchema);
