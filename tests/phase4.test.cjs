const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function moduleFrom(file, requireModule) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  } }).outputText;
  vm.runInNewContext(code, { exports, require: requireModule });
  return exports;
}

test('第五關通關才解鎖隱藏關，舊存檔能繼續且通關後仍可重玩', () => {
  const map = new Map();
  const storage = { getItem: k => map.get(k) || null, setItem: (k, v) => map.set(k, v) };
  const { Progression } = moduleFrom('src/systems/Progression.ts', name => ({
    default: JSON.parse(fs.readFileSync(path.join('src/systems', name), 'utf8'))
  }));
  const old = new Progression(storage);
  old.clear(4, 9);
  const progress = new Progression(storage);
  assert.equal(progress.data.stage, 5);
  progress.selectStage(6);
  assert.equal(progress.data.stage, 5);
  progress.clear(5, 10);
  assert.equal(new Progression(storage).data.stage, 6);
  progress.clear(6, 10);
  progress.selectStage(5);
  assert.equal(new Progression(storage).data.stage, 5); // Replay choice survives refresh.
});

test('終極 Boss 到 20% 進入惡魔形態，補滿兩倍原血量後才能擊敗', () => {
  const status = { EnemyStatus: class {} };
  const { Enemy, ENEMIES } = moduleFrom('src/entities/Enemy.ts', name => {
    if (name.endsWith('EnemyStatus')) return status;
    return { default: JSON.parse(fs.readFileSync(path.join('src/entities', name), 'utf8')) };
  });
  const object = () => { const proxy = new Proxy({}, { get(_target, _key) {
    return () => proxy;
  } }); return proxy; };
  // Rendering is a Phaser concern; exercise the actual damage and transition logic.
  Enemy.prototype.render = () => {};
  const sprites = [];
  const scene = { add: { graphics: object, text: object, image: () => {
    const sprite = { setOrigin() { return this; }, setVisible() { return this; },
      setTexture(texture) { this.texture = texture; return this; } };
    sprites.push(sprite);
    return sprite;
  } } };
  const enemy = new Enemy(scene, ENEMIES.final_boss, 300, 250, () => {}, () => {});
  assert.equal(enemy.hit(961), false);
  assert.equal(enemy.phaseTwo, true);
  assert.equal(enemy.maxHp, 2400);
  assert.equal(enemy.hp, 2400);
  assert.equal(sprites[0].texture, 'final_boss_phase2');
  assert.equal(enemy.hit(2400), true);
});
