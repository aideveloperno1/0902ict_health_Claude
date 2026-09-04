const mongoose = require('mongoose');
const { normalizeJson, SUBDOC, TIMESTAMPS } = require('./normalize');

const foodSchema = new mongoose.Schema(
  {
    name: { type: String },
    amount: { type: Number, default: null },
    unit: { type: String, default: 'g' },
    kcal: { type: Number, default: null },
    carbsG: { type: Number, default: null },
    proteinG: { type: Number, default: null },
    fatG: { type: Number, default: null },
  },
  SUBDOC
);

const mealSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    date: { type: String },
    mealType: { type: String },

    // 아침 → 점심 → 저녁 → 간식 순서를 DB가 알 수 있게 숫자로 저장한다.
    // 이 순서는 가나다순이 아니라서(간식·아침·저녁·점심) mealType만으로는 정렬할 수 없다.
    // mealType에서 파생되는 값이므로 서버가 정하고, 응답에는 내보내지 않는다.
    mealOrder: { type: Number, default: 0 },

    foods: { type: [foodSchema], default: [] },
    memo: { type: String, default: '' },
  },
  TIMESTAMPS
);

mealSchema.index({ userId: 1, date: -1, mealOrder: 1 });

normalizeJson(mealSchema, ['mealOrder']);

module.exports = mongoose.model('Meal', mealSchema);
