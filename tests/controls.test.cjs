const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

class Element {
  constructor(id = '') {
    this.id = id;
    this.style = {};
    this.dataset = {};
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = {
      add: name => this.classes.add(name),
      remove: name => this.classes.delete(name),
      contains: name => this.classes.has(name)
    };
  }
  set innerHTML(html) {
    this._innerHTML = html;
    this.elements = new Map();
    for (const match of html.matchAll(/id="([^"]+)"/g)) this.elements.set(match[1], new Element(match[1]));
    this.classesByName = new Map();
    for (const match of html.matchAll(/class="([^"]+)"/g)) {
      for (const name of match[1].split(/\s+/)) this.classesByName.set(name, new Element(name));
    }
    this.buttons = [...html.matchAll(/<button\s+data-action="([^"]+)"/g)].map(match => {
      const el = new Element();
      el.dataset.action = match[1];
      return el;
    });
  }
  get innerHTML() { return this._innerHTML; }
  querySelector(selector) { return selector.startsWith('#') ? this.elements.get(selector.slice(1)) : this.classesByName.get(selector.slice(1)); }
  querySelectorAll() { return this.buttons; }
  appendChild(child) { this.child = child; }
  remove() { this.removed = true; }
  addEventListener(name, handler) {
    const list = this.listeners.get(name) || [];
    list.push(handler);
    this.listeners.set(name, list);
  }
  removeEventListener(name, handler) {
    this.listeners.set(name, (this.listeners.get(name) || []).filter(fn => fn !== handler));
  }
  setPointerCapture(id) { this.captured = id; }
  setAttribute(name, value) { this[name] = value; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 200 }; }
  dispatch(name, properties = {}) {
    const event = { pointerId: 1, clientX: 100, clientY: 100, preventDefault() {}, ...properties };
    for (const handler of this.listeners.get(name) || []) handler(event);
  }
}

function setup() {
  const game = new Element('game');
  const module = { exports: {} };
  const source = fs.readFileSync('src/ui/Controls.ts', 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  vm.runInNewContext(compiled.outputText, { exports: module.exports, document: {
    createElement: () => new Element(),
    querySelector: selector => selector === '#game' ? game : null
  }});
  const events = [];
  const controls = new module.exports.Controls((action, pressed) => events.push([action, pressed]));
  return { controls, game, events, root: game.child };
}

test('五個獨立按鈕都有觸控按下、放開與取消事件', () => {
  const { controls, root, events } = setup();
  assert.deepEqual(root.buttons.map(button => button.dataset.action), ['jump', 'roll', 'crouch', 'ki', 'attack']);
  for (const button of root.buttons) {
    button.dispatch('pointerdown');
    assert.equal(button.classList.contains('pressed'), true);
    button.dispatch('pointerup');
    assert.equal(button.classList.contains('pressed'), false);
    button.dispatch('lostpointercapture'); // 不可重複送出放開
  }
  assert.deepEqual(events, root.buttons.flatMap(button => [[button.dataset.action, true], [button.dataset.action, false]]));
  const attack = root.buttons.find(button => button.dataset.action === 'attack');
  attack.dispatch('pointerdown');
  attack.dispatch('pointercancel');
  assert.deepEqual(events.slice(-2), [['attack', true], ['attack', false]]);
  controls.destroy();
  assert.equal(root.removed, true);
});

test('浮動搖桿限制幅度、忽略其他手指並在取消時歸零', () => {
  const { controls, root } = setup();
  const arena = root.querySelector('#move-zone');
  arena.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 120 });
  arena.dispatch('pointermove', { pointerId: 2, clientX: 500, clientY: 500 });
  assert.equal(controls.axes.x, 0);
  arena.dispatch('pointermove', { pointerId: 1, clientX: 200, clientY: 120 });
  assert.equal(controls.axes.x, 1);
  assert.equal(controls.axes.y, 0);
  assert.equal(root.querySelector('#joystick').classList.contains('visible'), true);
  arena.dispatch('pointercancel', { pointerId: 1 });
  assert.equal(controls.axes.x, 0);
  assert.equal(root.querySelector('#joystick').classList.contains('visible'), false);
  controls.destroy();
});

test('從觸控區邊緣啟動搖桿時，外圈維持在可見的安全區內', () => {
  const { controls, root } = setup();
  root.querySelector('#move-zone').dispatch('pointerdown', { clientX: 4, clientY: 198 });
  const ring = root.querySelector('#joystick');
  assert.equal(ring.style.left, '57px');
  assert.equal(ring.style.top, '143px');
  controls.destroy();
});

test('HUD 更新生命、魔力和操作回饋', () => {
  const { controls, root } = setup();
  controls.setMeters(63, 24.4);
  controls.announce('命中');
  assert.equal(root.querySelector('#hp-fill').style.width, '63%');
  assert.equal(root.querySelector('#mp-value').textContent, '25 / 100');
  assert.equal(root.querySelector('#status').textContent, '命中');
  controls.destroy();
});

test('選單可開合且商店、背包與五項配點能同時顯示', () => {
  const { controls, root } = setup();
  const progress = {
    data: { level: 4, coins: 20, stats: { STR: 1, DEF: 0, MAGIC: 0, SPD: 0, VIT: 0 },
      ownedEquipment: ['sword'], equipped: { weapon: 'sword' }, consumables: { food: 2 } },
    unspent: 2,
    items: () => [{ id: 'food', name: '食物', price: 10 }],
    item: () => ({ id: 'sword', name: '武器', slot: 'weapon' })
  };
  controls.renderMenu(progress, '第一關');
  const panel = root.querySelector('#menu-panel');
  assert.match(panel.innerHTML, /補給商店與裝備店/);
  assert.match(panel.innerHTML, /技能點數/);
  assert.match(panel.innerHTML, /data-menu="equip"/);
  const toggle = root.querySelector('#menu-toggle');
  panel.hidden = true;
  toggle.dispatch('click');
  assert.equal(panel.hidden, false);
  toggle.dispatch('click');
  assert.equal(panel.hidden, true);
  controls.destroy();
});

test('CSS 允許遊戲畫面穿透，但搖桿與按鍵能接收事件', () => {
  const css = fs.readFileSync('src/style.css', 'utf8');
  const rule = selector => css.match(new RegExp(selector + '\\s*\\{([^}]+)\\}'))?.[1] || '';
  assert.match(rule('#overlay'), /pointer-events:\s*none/);
  assert.match(rule('#move-zone'), /pointer-events:\s*auto/);
  assert.match(rule('#action-zone button'), /pointer-events:\s*auto/);
  assert.match(rule('#action-zone'), /pointer-events:\s*none/);
  assert.match(rule('#menu-panel'), /pointer-events:\s*auto/);
  assert.match(rule('#menu-toggle'), /pointer-events:\s*auto/);
  assert.match(rule('#action-zone button'), /opacity:\s*\.50/);
  assert.match(css, /env\(safe-area-inset-(?:top|left|right|bottom)\)/);
});

test('手機 viewport 與動態可視高度、四邊安全區皆有設定', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('src/style.css', 'utf8');
  assert.match(html, /<meta\s+name="viewport"\s+content="[^"]*width=device-width[^"]*viewport-fit=cover[^"]*"/);
  assert.match(css, /#game\s*\{[^}]*height:\s*100vh;\s*height:\s*100dvh/);
  for (const side of ['top', 'left', 'right', 'bottom']) {
    assert.match(css, new RegExp(`env\\(safe-area-inset-${side}\\)`));
  }
});
