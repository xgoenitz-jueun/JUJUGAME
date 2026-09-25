const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadProgression() {
  const module = { exports: {} };
  const source = fs.readFileSync('src/systems/Progression.ts', 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const localRequire = name => ({ default: JSON.parse(fs.readFileSync(path.join('src/systems', name), 'utf8')) });
  vm.runInNewContext(compiled.outputText, { exports: module.exports, require: localRequire });
  const map = new Map();
  const store = { getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value) };
  return { Progression: module.exports.Progression, store };
}

test('金錢、購物、背包、裝備與素質加成跨關保存', () => {
  const { Progression, store } = loadProgression();
  const progress = new Progression(store);
  assert.equal(progress.data.level, 3);
  progress.collect(200, 3);
  assert.equal(progress.buy('food_small'), '已購買小份食物');
  assert.equal(progress.buy('bronze_weapon'), '已購買初階武器');
  assert.equal(progress.equip('bronze_weapon'), '已裝備初階武器');
  assert.equal(progress.allocate('STR'), 'STR +1');
  assert.equal(progress.attackBonus, 5.5);
  assert.equal(progress.use('food_small'), 20);
  progress.checkpoint(1, 'cp1_1', 1900);
  progress.checkpoint(1, 'older', 1200);
  progress.clear(1, 4);
  const restored = new Progression(store);
  assert.equal(restored.data.stage, 2);
  assert.equal(restored.data.level, 4);
  assert.equal(restored.data.checkpoints['1'].id, 'cp1_1');
  assert.equal(restored.data.equipped.weapon, 'bronze_weapon');
  assert.equal(restored.items().some(item => item.id === 'forest_weapon'), true);
  restored.clear(2, 6);
  assert.equal(restored.data.level, 6);
});

test('技能點上限 50，不能重複買裝備或超額配點', () => {
  const { Progression, store } = loadProgression();
  const progress = new Progression(store);
  progress.collect(1000, 70);
  assert.equal(progress.data.earned, 50);
  for (let n = 0; n < 50; n++) assert.equal(progress.allocate('VIT'), 'VIT +1');
  assert.equal(progress.allocate('VIT'), '沒有可用點數');
  assert.equal(progress.maxHp, 500);
  assert.equal(progress.buy('cloth_armor'), '已購買初階防具');
  assert.equal(progress.buy('cloth_armor'), '已擁有此裝備');
});

test('兩關使用各自怪物、Boss、Boss 前傳送點與長度基準', () => {
  for (const [stage, monster, boss] of [[1, 'slime', 'goblin'], [2, 'wolf', 'tiger']]) {
    const level = JSON.parse(fs.readFileSync(`data/levels/stage${stage}.json`, 'utf8'));
    assert.equal(level.spawnTable[0].enemyId, monster);
    assert.equal(level.boss.enemyId, boss);
    assert.equal(level.minLengthSeconds, 60);
    assert.equal(level.checkpoints.length, 3);
    assert.ok(level.checkpoints.at(-1).position < level.boss.position);
    assert.ok(level.worldWidth / 210 >= 50); // 道路時間加戰鬥時間應超過一分鐘
  }
  const monsters = ['slime', 'goblin', 'wolf', 'tiger'].map(id => JSON.parse(fs.readFileSync(`data/enemies/${id}.json`, 'utf8')));
  assert.ok(monsters[2].hp > monsters[0].hp);
  assert.ok(monsters[3].hp > monsters[1].hp);
  assert.ok(monsters[0].patterns.some(pattern => pattern.kind === 'ranged' && pattern.slowSeconds));
  assert.ok(monsters[1].patterns.some(pattern => pattern.kind === 'melee'));
  assert.ok(monsters[2].patterns.some(pattern => pattern.kind === 'buff'));
  assert.ok(monsters[3].patterns.some(pattern => pattern.kind === 'wave'));
});
