const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, dependencies) {
  const exports = {};
  const source = fs.readFileSync(file, 'utf8').replaceAll('import.meta.env.BASE_URL', "'/'");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true
  }}).outputText;
  vm.runInNewContext(compiled, { exports, require: name => dependencies(name) });
  return exports;
}

test('半獸人攻擊不直接改座標；衝撞移動受每幀速度限制且總距離有上限', () => {
  const BootScene = load('src/scenes/BootScene.ts', name => name === 'phaser' ?
    { __esModule: true, default: { Scene: class {} } } : name.endsWith('/Enemy') ? { ENEMIES: {} } :
      name.includes('/levels/') ? { number: 1 } : {}).BootScene;
  const scene = Object.create(BootScene.prototype);
  scene.player = { snapshot: { x: 260, depthY: 200 } };
  scene.enemies = [];
  scene.damagePlayer = () => {};
  let rush;
  const orc = { alive: true, x: 100, depthY: 200, config: { id: 'orc' },
    beginLunge(direction, distance, speed, onStep) { rush = { direction, distance, speed, onStep }; } };
  scene.enemies.push(orc);
  scene.enemyAttack(orc, { kind: 'lunge', range: 215, damage: 17 });
  assert.equal(orc.x, 100);
  assert.equal(rush.direction, 1);
  assert.equal(rush.distance, 165);

  const Enemy = load('src/entities/Enemy.ts', name => name.endsWith('/EnemyStatus') ?
    { EnemyStatus: class {}, STATUS_CONFIG: {} } : { default: {} }).Enemy;
  const moving = Object.create(Enemy.prototype);
  Object.assign(moving, { x: 100, depthY: 200, alive: true, phaseTwo: false, buffLeft: 0,
    config: { speed: 82, patterns: [] }, status: { canAttack: true, moveMultiplier: 1,
      update() {} }, cooldown: 99, flash: 0, phaseLeft: 0, render() {} });
  let contacts = 0;
  moving.beginLunge(rush.direction, rush.distance, rush.speed, () => contacts++);
  for (let i = 0; i < 15; i++) {
    const before = moving.x;
    moving.update(.05, { x: 260, depthY: 200 });
    assert.ok(moving.x - before <= 12.00001, '每 50 毫秒最多移動 12 單位');
  }
  assert.equal(moving.x, 265);
  assert.equal(contacts, 14);
});

test('Boss 血條顯示當前值與上限，第二形態可直接換成兩倍上限', () => {
  const Controls = load('src/ui/Controls.ts', () => ({})).Controls;
  const nodes = new Map(['boss-health', 'boss-name', 'boss-value', 'boss-fill'].map(id => [id, {
    hidden: true, textContent: '', style: {}, attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; }
  }]));
  const classes = new Set();
  const ui = Object.create(Controls.prototype);
  ui.root = { querySelector: selector => nodes.get(selector.slice(1)),
    classList: { toggle(name, active) { if (active) classes.add(name); else classes.delete(name); } } };
  ui.setBossHealth({ name: '終極 Boss', hp: 240, maxHp: 1200 });
  assert.equal(nodes.get('boss-fill').style.width, '20%');
  ui.setBossHealth({ name: '終極 Boss · 惡魔形態', hp: 2400, maxHp: 2400 });
  assert.equal(nodes.get('boss-value').textContent, '2400 / 2400');
  assert.equal(nodes.get('boss-fill').style.width, '100%');
  assert.equal(nodes.get('boss-health').attributes['aria-valuemax'], '2400');
  ui.setBossHealth(null);
  assert.equal(nodes.get('boss-health').hidden, true);
  assert.equal(classes.has('boss-active'), false);
});

test('第六關星穹套裝在前五關鎖定，入第六關可購買、裝備並跨存檔保留', () => {
  const Progression = load('src/systems/Progression.ts', name => ({ __esModule: true, default:
    JSON.parse(fs.readFileSync(`src/systems/${name}`, 'utf8')) })).Progression;
  const saved = new Map();
  const storage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) };
  const progress = new Progression(storage);
  assert.equal(progress.items(5).some(item => item.id === 'sky_weapon'), false);
  progress.collect(2000, 0);
  for (let stage = 1; stage <= 5; stage++) progress.clear(stage, Math.min(10, stage + 4));
  assert.equal(progress.data.stage, 6);
  assert.equal(progress.buy('sky_weapon'), '已購買星穹武器');
  assert.equal(progress.buy('sky_armor'), '已購買星穹防具');
  assert.equal(progress.buy('sky_charm'), '已購買星穹飾品');
  assert.equal(progress.items().filter(item => item.id.startsWith('sky_')).length, 3);
  progress.equip('sky_weapon');
  progress.equip('sky_armor');
  progress.equip('sky_charm');
  const restored = new Progression(storage);
  assert.equal(restored.attackBonus, 20);
  assert.equal(restored.damageReduction, 18);
  assert.equal(restored.maxHp, 156);
  assert.equal(restored.data.equipped.weapon, 'sky_weapon');
});
