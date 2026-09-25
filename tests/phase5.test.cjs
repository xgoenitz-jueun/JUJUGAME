const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function bootScene() {
  const source = fs.readFileSync('src/scenes/BootScene.ts', 'utf8').replaceAll('import.meta.env.BASE_URL', "'/'");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true
  }}).outputText;
  const exports = {};
  const requireModule = name => name.includes('/levels/') ? { number: 1 } :
    name === 'phaser' ? { __esModule: true, default: { Scene: class {} } } :
      name.endsWith('/Enemy') ? { ENEMIES: {} } : {};
  vm.runInNewContext(compiled, { exports, require: requireModule });
  return exports.BootScene;
}

test('第五關 Boss 擊敗後先顯示主線結局，按鈕才前往第六關；隱藏關也能重看結局', () => {
  const BootScene = bootScene();
  for (const stage of [5, 6]) {
    const scene = Object.create(BootScene.prototype);
    const calls = [];
    scene.level = { number: stage, levelUpOnClear: 10 };
    scene.drops = [];
    scene.stageSlimeKills = 0;
    scene.add = { graphics: () => ({ setDepth() { return this; }, destroy() {} }) };
    scene.drawDrop = () => {};
    scene.refreshHud = () => {};
    scene.progress = {
      collect: () => calls.push('reward'), clear: number => calls.push(`clear ${number}`),
      selectStage: number => calls.push(`select ${number}`)
    };
    scene.ui = { showVictory(number, callback) { calls.push(`victory ${number}`); this.continue = callback; } };
    scene.time = { delayedCall: () => calls.push('automatic transition') };
    scene.loadStage = number => calls.push(`load ${number}`);
    const enemy = { alive: true, hp: 20, x: 100, depthY: 200, boss: true,
      config: { id: 'boss', coinDrop: 20, skillPointDrop: 1 }, hit: () => true,
      phaseJustChanged: false };
    scene.hitEnemy(enemy, 20, false);
    assert.deepEqual(calls, ['reward', `clear ${stage}`, `victory ${stage}`]);
    scene.ui.continue();
    assert.deepEqual(calls.slice(3), stage === 5 ? ['load 6'] : ['select 6', 'load 6']);
  }
});

test('小幅調整維持 Boss 二階段、五色效果及關卡長度', () => {
  const json = name => JSON.parse(fs.readFileSync(name, 'utf8'));
  const stage5 = json('data/levels/stage5.json');
  const stage6 = json('data/levels/stage6.json');
  const finalBoss = json('data/enemies/final_boss.json');
  assert.equal(stage5.minLengthSeconds, 90);
  assert.equal(stage6.minLengthSeconds, 90);
  assert.ok(stage5.enemyScale.hp > 1.7 && stage5.enemyScale.damage > 1.4);
  assert.equal(finalBoss.phaseTwo.triggerHpRatio, .2);
  assert.equal(finalBoss.phaseTwo.maxHpMultiplier, 2);
  assert.equal(finalBoss.phaseTwo.darkFlameIntervalSeconds, 50);
  assert.equal(Object.keys(json('data/progression/five-color-status.json')).length >= 5, true);
});
