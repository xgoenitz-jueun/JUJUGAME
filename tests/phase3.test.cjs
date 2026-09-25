const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file) {
  const exports = {};
  const source = fs.readFileSync(file, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  }}).outputText;
  vm.runInNewContext(code, { exports });
  return exports;
}

test('變身結束後才開始 60 秒冷卻，冷卻後須重新集滿', () => {
  const { Transformation } = load('src/state/Transformation.ts');
  const form = new Transformation();
  form.gain(100);
  assert.equal(form.start(), true);
  assert.equal(form.active, true);
  form.shield();
  assert.equal(form.castColor(), 0);
  assert.equal(form.castColor(), 1);
  assert.equal(form.tick(19.9), false);
  assert.equal(form.active, true);
  assert.equal(form.tick(.1), true);
  assert.equal(form.cooldownLeft, 60);
  form.gain(100);
  assert.equal(form.start(), false);
  form.tick(60);
  form.gain(100);
  assert.equal(form.start(), true);
});

test('第三四關可通關、具對應怪物技能與新裝備', () => {
  for (const [number, enemyId, bossId, patterns] of [
    [3, 'ghost', 'zombie', ['phase', 'ranged', 'grab', 'poison', 'summon']],
    [4, 'orc', 'cyclops', ['lunge', 'melee', 'wave', 'ranged', 'laser']]
  ]) {
    const level = JSON.parse(fs.readFileSync(`data/levels/stage${number}.json`, 'utf8'));
    const enemies = [enemyId, bossId].map(id => JSON.parse(fs.readFileSync(`data/enemies/${id}.json`, 'utf8')));
    const shop = JSON.parse(fs.readFileSync(`data/shop/stage${number}.json`, 'utf8'));
    assert.equal(level.spawnTable[0].enemyId, enemyId);
    assert.equal(level.boss.enemyId, bossId);
    assert.ok(level.checkpoints.at(-1).position < level.boss.position);
    assert.deepEqual(enemies.flatMap(enemy => enemy.patterns.map(pattern => pattern.kind)).sort(), patterns.sort());
    for (const enemy of enemies) assert.equal(fs.existsSync(`public/${enemy.spriteRef}`), true);
    assert.equal(shop.stageUnlock, number);
    assert.equal(shop.items.length, 3);
  }
});
