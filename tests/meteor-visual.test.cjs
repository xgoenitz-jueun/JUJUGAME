const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function sceneClass() {
  const source = fs.readFileSync('src/scenes/BootScene.ts', 'utf8').replaceAll('import.meta.env.BASE_URL', "'/'");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true
  }}).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => name === 'phaser' ?
    { __esModule: true, default: { Scene: class {} } } : name.endsWith('/Enemy') ? { ENEMIES: {} } :
      name.includes('/levels/') ? { number: 1 } : {} });
  return exports.BootScene;
}

test('流星雨使用正確貼圖與螢幕座標，三次傷害落在可見動畫期間', () => {
  const sprites = JSON.parse(fs.readFileSync('data/assets/sprites.json', 'utf8'));
  assert.equal(sprites.transform_meteor_rain, 'assets/sprites/transform_meteor_rain.png');
  assert.equal(fs.existsSync(`public/${sprites.transform_meteor_rain}`), true);

  const scene = Object.create(sceneClass().prototype);
  const image = { x: 0, y: 0, alpha: 0, destroyed: false,
    setScrollFactor() { return this; }, setDepth() { return this; }, setAlpha(alpha) { this.alpha = alpha; return this; },
    setScale(scale) { this.scale = scale; return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; }, destroy() { this.destroyed = true; } };
  let streakCount = 0;
  const streaks = { destroyed: false, clear() { streakCount = 0; return this; },
    setScrollFactor() { return this; }, setDepth() { return this; },
    lineStyle() { return this; }, lineBetween() { return this; }, fillStyle() { return this; },
    fillCircle() { streakCount++; return this; }, destroy() { this.destroyed = true; } };
  const hits = [];
  Object.assign(scene, {
    form: { active: true }, sealLeft: 0, meteorUsed: false, specialLock: 0, finished: false,
    player: { snapshot: { mp: 100 } }, level: { number: 4 },
    progress: { magicBonus: 2 },
    cameras: { main: { scrollX: 9000, width: 400, height: 600 } },
    textures: { get: () => ({ getSourceImage: () => ({ width: 850, height: 467 }) }) },
    add: { image: (x, y, key) => { assert.equal(key, 'transform_meteor_rain'); image.x = x; image.y = y; return image; },
      graphics: () => streaks },
    ui: { announce() {} }, enemies: [{ alive: true, x: 9200 }],
    hitEnemy(_enemy, amount) { hits.push(amount); }
  });
  scene.meteorRain();
  assert.equal(image.x, 200, '螢幕固定物件不能加入鏡頭捲動距離');
  assert.equal(streakCount, 18);
  assert.equal(hits.length, 0);
  scene.updateMeteorEffect(.28);
  assert.equal(hits.length, 1);
  assert.ok(image.alpha > 0);
  const firstY = image.y;
  scene.updateMeteorEffect(.32);
  assert.equal(hits.length, 2);
  assert.ok(image.y > firstY, '參考貼圖由上往下移動');
  scene.updateMeteorEffect(.35);
  assert.equal(hits.length, 3);
  assert.equal(hits.reduce((sum, damage) => sum + damage, 0), 214);
  scene.updateMeteorEffect(.25);
  assert.equal(scene.meteorEffect, null);
  assert.equal(image.destroyed, true);
  assert.equal(streaks.destroyed, true);
});
