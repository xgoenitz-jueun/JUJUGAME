export type Action = 'attack' | 'ki' | 'jump' | 'roll' | 'crouch';
import type { Progression } from '../systems/Progression';

/** DOM overlay keeps each touch action independent of the game canvas. */
export class Controls {
  private readonly root: HTMLDivElement;
  private readonly joystick: HTMLDivElement;
  private readonly stick: HTMLDivElement;
  private readonly arena: HTMLDivElement;
  private activePointer: number | null = null;
  private centerX = 0;
  private centerY = 0;
  readonly axes = { x: 0, y: 0 };
  private readonly pressed = new Set<Action>();

  constructor(private onAction: (action: Action, pressed: boolean) => void,
    private onMenu: (command: string, id: string) => void = () => {}) {
    const game = document.querySelector('#game');
    if (!game) throw new Error('Missing #game element');
    this.root = document.createElement('div');
    this.root.id = 'overlay';
    this.root.innerHTML = `
      <div id="hud"><div class="hud-title">Phase 1 · 操作／戰鬥原型</div>
        <div id="progress">第一關 · Lv3 · 金錢 0 · 點數 0</div>
        <div class="bar-label">HP <span id="hp-value"></span></div><div class="bar hp"><i id="hp-fill"></i></div>
        <div class="bar-label">MP <span id="mp-value"></span></div><div class="bar mp"><i id="mp-fill"></i></div>
        <div id="status" role="status" aria-live="polite">移動靠近練習標靶，試試三段連擊</div>
        <a id="sprite-gallery" href="./sprites.html">檢視本次角色與技能圖片</a>
      </div>
      <div id="hint">鍵盤：WASD／方向鍵移動 · J 攻擊（長按蓄力） · G 氣功 · K 跳 · L 翻滾 · C 蹲下</div>
      <button id="menu-toggle" aria-label="開關背包商店與配點選單" aria-expanded="false">背包／商店</button>
      <section id="menu-panel" aria-label="背包商店與配點" hidden></section>
      <div id="move-zone" aria-label="移動搖桿觸控區"><div id="joystick"><div id="stick"></div></div></div>
      <div id="action-zone">
        <button data-action="jump" aria-label="跳躍">跳躍</button>
        <button data-action="roll" aria-label="翻滾">翻滾</button>
        <button data-action="crouch" aria-label="蹲下">蹲下</button>
        <button data-action="ki" class="special" aria-label="按住氣功蓄力，放開發射">氣功</button>
        <button data-action="attack" class="attack" aria-label="點按拳腳連擊，長按蓄力氣功">攻擊</button>
      </div>`;
    game.appendChild(this.root);
    this.arena = this.root.querySelector('#move-zone') as HTMLDivElement;
    this.joystick = this.root.querySelector('#joystick') as HTMLDivElement;
    this.stick = this.root.querySelector('#stick') as HTMLDivElement;
    this.arena.addEventListener('pointerdown', this.startStick);
    this.arena.addEventListener('pointermove', this.moveStick);
    this.arena.addEventListener('pointerup', this.endStick);
    this.arena.addEventListener('pointercancel', this.endStick);
    const toggle = this.root.querySelector('#menu-toggle') as HTMLButtonElement;
    const panel = this.root.querySelector('#menu-panel') as HTMLElement;
    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
    });
    panel.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-menu]');
      if (button) this.onMenu(button.dataset.menu || '', button.dataset.id || '');
    });
    for (const button of Array.from(this.root.querySelectorAll<HTMLButtonElement>('[data-action]'))) {
      const action = button.dataset.action as Action;
      button.addEventListener('pointerdown', (event: PointerEvent) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        if (!this.pressed.has(action)) { this.pressed.add(action); this.onAction(action, true); }
        button.classList.add('pressed');
      });
      const release = (event: PointerEvent) => {
        event.preventDefault();
        if (this.pressed.delete(action)) this.onAction(action, false);
        button.classList.remove('pressed');
      };
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', release);
    }
  }

  private startStick = (event: PointerEvent): void => {
    if (this.activePointer !== null) return;
    event.preventDefault();
    this.activePointer = event.pointerId;
    this.arena.setPointerCapture(event.pointerId);
    this.centerX = event.clientX;
    this.centerY = event.clientY;
    const rect = this.arena.getBoundingClientRect();
    // Keep the visible ring inside the touch area and away from browser/safe-area edges.
    const clamp = (position: number, size: number) => {
      const margin = Math.min(57, size / 2);
      return Math.max(margin, Math.min(size - margin, position));
    };
    this.joystick.style.left = `${clamp(event.clientX - rect.left, rect.width)}px`;
    this.joystick.style.top = `${clamp(event.clientY - rect.top, rect.height)}px`;
    this.joystick.classList.add('visible');
    this.moveStick(event);
  };

  private moveStick = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointer) return;
    const x = event.clientX - this.centerX;
    const y = event.clientY - this.centerY;
    const radius = Math.max(1, Math.hypot(x, y));
    const amount = Math.min(1, radius / 52);
    this.axes.x = x / radius * amount;
    this.axes.y = y / radius * amount;
    this.stick.style.transform = `translate(${this.axes.x * 43}px, ${this.axes.y * 43}px)`;
  };

  private endStick = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointer) return;
    this.activePointer = null;
    this.axes.x = 0;
    this.axes.y = 0;
    this.stick.style.transform = '';
    this.joystick.classList.remove('visible');
  };

  setMeters(hp: number, mp: number, maxHp = 100, maxMp = 100): void {
    (this.root.querySelector('#hp-fill') as HTMLElement).style.width = `${Math.max(0, hp / maxHp * 100)}%`;
    (this.root.querySelector('#mp-fill') as HTMLElement).style.width = `${Math.max(0, mp / maxMp * 100)}%`;
    (this.root.querySelector('#hp-value') as HTMLElement).textContent = `${Math.ceil(hp)} / ${maxHp}`;
    (this.root.querySelector('#mp-value') as HTMLElement).textContent = `${Math.ceil(mp)} / ${maxMp}`;
  }

  renderMenu(progress: Progression, stageName: string): void {
    (this.root.querySelector('.hud-title') as HTMLElement).textContent = `Phase 2 · ${stageName}`;
    (this.root.querySelector('#progress') as HTMLElement).textContent = `Lv${progress.data.level} · 金錢 ${progress.data.coins} · 可用點數 ${progress.unspent}`;
    const panel = this.root.querySelector('#menu-panel') as HTMLElement;
    const rows = progress.items().map(item => `<div class="menu-row"><span>${item.name} · ${item.price} 金</span><button data-menu="buy" data-id="${item.id}">購買</button></div>`).join('');
    const owned = progress.data.ownedEquipment.map(id => {
      const item = progress.item(id);
      return item ? `<div class="menu-row"><span>${item.name}${progress.data.equipped[item.slot || 'weapon'] === id ? ' ✓' : ''}</span><button data-menu="equip" data-id="${id}">裝備</button></div>` : '';
    }).join('') || '尚無裝備';
    const inventory = Object.entries(progress.data.consumables).filter(([, count]) => count > 0).map(([id, count]) => {
      const item = progress.item(id);
      return item ? `<div class="menu-row"><span>${item.name} ×${count}</span><button data-menu="use" data-id="${id}">使用</button></div>` : '';
    }).join('') || '尚無補給';
    panel.innerHTML = `<h2>補給商店與裝備店</h2>${rows}<h2>背包 · 補給</h2>${inventory}<h2>背包 · 裝備</h2>${owned}<h2>技能點數 (${progress.unspent})</h2>
      <div class="stat-grid">${(['STR', 'DEF', 'MAGIC', 'SPD', 'VIT'] as const).map(stat => `<button data-menu="stat" data-id="${stat}">${stat} ${progress.data.stats[stat]} ＋</button>`).join('')}</div>`;
  }

  announce(message: string): void {
    (this.root.querySelector('#status') as HTMLElement).textContent = message;
  }

  destroy(): void {
    for (const action of this.pressed) this.onAction(action, false);
    this.arena.removeEventListener('pointerdown', this.startStick);
    this.arena.removeEventListener('pointermove', this.moveStick);
    this.arena.removeEventListener('pointerup', this.endStick);
    this.arena.removeEventListener('pointercancel', this.endStick);
    this.root.remove();
  }
}
