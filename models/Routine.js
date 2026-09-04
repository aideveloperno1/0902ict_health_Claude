const mongoose = require('mongoose');
const { normalizeJson, SUBDOC, TIMESTAMPS } = require('./normalize');

// 루틴의 세트에는 done이 없다. 루틴은 계획이지 기록이 아니기 때문이다.
const setSchema = new mongoose.Schema(
  {
    setNo: { type: Number },
    weightKg: { type: Number, default: null },
    reps: { type: Number, default: null },
  },
  SUBDOC
);

const exerciseSchema = new mongoose.Schema(
  {
    name: { type: String },
    targetMuscle: { type: String, default: '' },
    sets: { type: [setSchema], default: [] },
  },
  SUBDOC
);

const routineSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // 날짜가 없다. 루틴은 특정 날에 매이지 않는다.
    name: { type: String },
    exercises: { type: [exerciseSchema], default: [] },
  },
  TIMESTAMPS
);

routineSchema.index({ userId: 1, createdAt: -1 });

normalizeJson(routineSchema);

module.exports = mongoose.model('Routine', routineSchema);
