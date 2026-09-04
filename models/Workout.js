const mongoose = require('mongoose');
const { normalizeJson, SUBDOC, TIMESTAMPS } = require('./normalize');

// 세트 하나. setNo는 서버가 순서대로 다시 매기므로 클라이언트 값을 믿지 않는다.
const setSchema = new mongoose.Schema(
  {
    setNo: { type: Number },
    weightKg: { type: Number, default: null },
    reps: { type: Number, default: null },
    done: { type: Boolean, default: false },
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

const workoutSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    date: { type: String },
    title: { type: String },
    durationMin: { type: Number, default: null },
    exercises: { type: [exerciseSchema], default: [] },
    memo: { type: String, default: '' },
  },
  TIMESTAMPS
);

// 목록은 늘 "내 것 + 날짜순"으로 조회한다. 날짜 필터도 이 인덱스를 탄다.
workoutSchema.index({ userId: 1, date: -1 });

// 값의 유효성(필수·형식·허용값)은 routes/workouts.js가 검사한다.
// 스키마에 required/enum을 걸면 에러 메시지와 상태코드가 지금과 달라진다.
normalizeJson(workoutSchema);

module.exports = mongoose.model('Workout', workoutSchema);
