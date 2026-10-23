const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true, preferTsExts: true });
let IdleReturnDetector;
let missing;
try {
  ({ IdleReturnDetector } = require('./idle-return-detector.ts'));
} catch (e) {
  missing = e;
}
const detector = () => {
  assert.equal(missing, undefined, 'Return detector must exist');
  return new IdleReturnDetector(60000);
};

test('desktop return captures the ended interval once, excluding time after return', () => {
  const d = detector();
  assert.equal(d.sample(120000, 1000000), null);
  assert.equal(d.sample(150000, 1030000), null);
  assert.equal(d.sample(1000, 1060000), 179000);
  assert.equal(d.sample(2000, 1090000), null);
});
test('zero and invalid measurements cannot freeze a review after a detector failure', () => {
  const d = detector();
  d.sample(120000, 1000000);
  for (const value of [0, NaN, -1]) assert.equal(d.sample(value, 1030000), null);
  assert.equal(d.sample(500, 1060000), 179500);
});
test('ordinary activity below the idle floor does not create an ended idle period', () => {
  const d = detector();
  d.sample(30000, 1000000);
  assert.equal(d.sample(1000, 1030000), null);
});
test('a later idle episode can end independently', () => {
  const d = detector();
  d.sample(120000, 1000000);
  d.sample(1000, 1030000);
  assert.equal(d.sample(120000, 1160000), null);
  assert.equal(d.sample(500, 1190000), 149500);
});
