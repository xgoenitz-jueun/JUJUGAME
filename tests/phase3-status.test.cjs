const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadStatus() {
  const file = path.resolve('src/state/EnemyStatus.ts');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    resolveJsonModule: true
  }}).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: id => require(path.resolve(path.dirname(file), id)) });
  return exports;
}

test('五色狀態有對應控制，施法順序與設定一致', () => {
  const { EnemyStatus, STATUS_COLORS, STATUS_CONFIG } = loadStatus();
  assert.deepEqual(Array.from(STATUS_COLORS), ['red', 'blue', 'yellow', 'green', 'purple']);
  assert.deepEqual(Array.from(STATUS_COLORS, color => STATUS_CONFIG[color].name),
    ['燒傷', '冰凍', '麻痺', '中毒', '暈眩']);
  const status = new EnemyStatus();
  status.apply('blue');
  assert.equal(status.moveMultiplier, 0);
  assert.equal(status.canAttack, false);
  status.update(1.4, () => assert.fail('冰凍不可造成持續傷害'));
  assert.equal(status.moveMultiplier, 1);
  status.apply('yellow');
  assert.equal(status.moveMultiplier, .5);
  assert.equal(status.canAttack, false);
  status.apply('purple');
  assert.equal(status.moveMultiplier, 0);
  status.update(1.2, () => {});
  assert.equal(status.moveMultiplier, .5);
  status.update(.8, () => {});
  assert.equal(status.canAttack, true);
});

test('燒傷與中毒按秒扣血，重複命中刷新時間而不堆疊傷害', () => {
  const { EnemyStatus } = loadStatus();
  const status = new EnemyStatus();
  let damage = 0;
  status.apply('red');
  status.update(.6, amount => damage += amount);
  status.apply('red');
  status.apply('green');
  status.update(.4, amount => damage += amount);
  assert.equal(damage, 6);
  status.update(.6, amount => damage += amount);
  assert.equal(damage, 10);
  status.update(4.4, amount => damage += amount);
  assert.equal(damage, 44); // red: 4 x 6, green: 5 x 4
  assert.equal(status.active.length, 0);
});
