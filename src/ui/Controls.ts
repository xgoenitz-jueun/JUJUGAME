export type Action = 'attack' | 'ki' | 'jump' | 'roll' | 'crouch' | 'storm' | 'transform' | 'color' | 'shield' | 'meteor' | 'lightning';
import type { Progression } from '../systems/Progression';
import type { Transformation } from '../state/Transformation';

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
  private readonly tutorialSeen = new Set<string>();
  private readonly tutorialQueue: { id: string; message: string; target?: string }[] = [];
  private tutorialActive: { id: string; message: string; target?: string } | null = null;

  constructor(private onAction: (action: Action, pressed: boolean) => void,
    private onMenu: (command: string, id: string) => void = () => {}) {
    const game = document.querySelector('#game');
    if (!game) throw new Error('Missing #game element');
    this.root = document.createElement('div');
    this.root.id = 'overlay';
    this.root.innerHTML = `
      <div id="hud"><div class="hud-title">珠珠橫向冒險 · 第一關</div>
        <div id="progress">第一關 · Lv3 · 金錢 0 · 點數 0</div>
        <div class="bar-label">HP <span id="hp-value"></span></div><div class="bar hp"><i id="hp-fill"></i></div>
        <div class="bar-label">MP <span id="mp-value"></span></div><div class="bar mp"><i id="mp-fill"></i></div>
        <div class="bar-label">藍色風暴 <span id="storm-value">0%</span></div><div class="bar storm"><i id="storm-fill"></i></div>
        <div class="bar-label">變身 <span id="form-value">0%</span></div><div class="bar form"><i id="form-fill"></i></div>
        <div class="bar-label">全屏閃電 <span id="lightning-value">0%</span></div><div class="bar lightning"><i id="lightning-fill"></i></div>
        <div id="status" role="status" aria-live="polite">移動靠近練習標靶，試試三段連擊</div>
        <a id="sprite-gallery" href="./sprites.html">角色與技能圖鑑</a>
      </div>
      <section id="boss-health" role="meter" aria-label="Boss 血量" aria-valuemin="0" hidden>
        <div class="bar-label"><strong id="boss-name"></strong><span id="boss-value"></span></div>
        <div class="bar boss-hp"><i id="boss-fill"></i></div>
      </section>
      <div id="hint">WASD 移動 · J 攻擊 · G 氣功 · B 風暴 · V 閃電 · T 變身 · F 五色 · H 防禦 · M 流星雨</div>
      <button id="menu-toggle" aria-label="開關背包商店與配點選單" aria-expanded="false">背包／商店</button>
      <section id="menu-panel" aria-label="背包商店與配點" hidden></section>
      <div id="move-zone" aria-label="移動搖桿觸控區"><div id="joystick"><div id="stick"></div></div></div>
      <div id="action-zone">
        <button data-action="jump" aria-label="跳躍">跳躍</button>
        <button data-action="roll" aria-label="翻滾">翻滾</button>
        <button data-action="crouch" aria-label="蹲下">蹲下</button>
        <button data-action="ki" class="special" aria-label="按住氣功蓄力，放開發射">氣功</button>
        <button data-action="attack" class="attack" aria-label="點按拳腳連擊，長按蓄力氣功">攻擊</button>
        <button data-action="storm" class="storm-action" aria-label="藍色風暴">風暴</button>
        <button data-action="lightning" class="lightning-action" aria-label="全屏閃電">閃電</button>
        <button data-action="transform" class="transform-action" aria-label="變身">變身</button>
        <button data-action="color" class="form-action color-action" aria-label="五色魔法">五色</button>
        <button data-action="shield" class="form-action shield-action" aria-label="絕對防禦">防禦</button>
        <button data-action="meteor" class="form-action meteor-action" aria-label="流星雨">流星</button>
      </div>
      <small id="fan-notice">粉絲自製非營利作品，僅供同好交流</small>
      <aside id="tutorial" role="status" aria-live="polite" hidden>
        <strong>遊戲提示</strong><p id="tutorial-message"></p><button id="tutorial-dismiss" type="button">知道了</button>
      </aside>
      <div id="victory" role="dialog" aria-modal="true" aria-labelledby="victory-title" hidden>
        <div class="victory-confetti" aria-hidden="true"></div>
        <div class="victory-card">
          <svg class="victory-trophy" viewBox="0 0 200 240" role="img" aria-label="冠軍獎盃">
            <defs><linearGradient id="trophy-gold" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#fff1a6"/><stop offset=".48" stop-color="#e8ae40"/><stop offset="1" stop-color="#fff4c6"/></linearGradient></defs>
            <path d="M46 31h108v42c0 46-25 75-54 75S46 119 46 73V31Z" fill="url(#trophy-gold)" stroke="#fff4c9" stroke-width="4"/>
            <path d="M46 48H24v15c0 36 19 54 51 54M154 48h22v15c0 36-19 54-51 54" fill="none" stroke="#e8ae40" stroke-width="12" stroke-linejoin="round"/>
            <path d="M89 145h22v35H89zM65 181h70v18H65zM48 201h104v20H48z" fill="url(#trophy-gold)" stroke="#fff4c9" stroke-width="3"/>
            <path d="m100 56 7 15 16 2-12 12 3 17-14-8-14 8 3-17-12-12 16-2z" fill="#fff8d3"/>
          </svg>
          <p id="victory-subtitle"></p><h1 id="victory-title">富邦悍將總冠軍</h1>
          <p id="victory-detail"></p><button id="victory-next" type="button"></button>
        </div>
      </div>`;
    game.appendChild(this.root);
    try {
      for (const id of JSON.parse(window.localStorage.getItem('juju-game-tutorial-v1') || '[]') as string[])
        if (typeof id === 'string') this.tutorialSeen.add(id);
    } catch { /* Tutorials still work in memory if storage is unavailable. */ }
    (this.root.querySelector('#tutorial-dismiss') as HTMLButtonElement).addEventListener('click', () => this.dismissTutorial());
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

  setBossHealth(boss: { name: string; hp: number; maxHp: number } | null): void {
    const panel = this.root.querySelector('#boss-health') as HTMLElement;
    panel.hidden = !boss;
    this.root.classList.toggle('boss-active', !!boss);
    if (!boss) return;
    const hp = Math.max(0, Math.min(boss.hp, boss.maxHp));
    (this.root.querySelector('#boss-name') as HTMLElement).textContent = boss.name;
    (this.root.querySelector('#boss-value') as HTMLElement).textContent = `${Math.ceil(hp)} / ${boss.maxHp}`;
    (this.root.querySelector('#boss-fill') as HTMLElement).style.width = `${boss.maxHp > 0 ? hp / boss.maxHp * 100 : 0}%`;
    panel.setAttribute('aria-valuenow', String(Math.ceil(hp)));
    panel.setAttribute('aria-valuemax', String(boss.maxHp));
  }

  setSkills(storm: number, form: Transformation, lightning = 0): void {
    (this.root.querySelector('#storm-fill') as HTMLElement).style.width = `${storm}%`;
    (this.root.querySelector('#storm-value') as HTMLElement).textContent = `${Math.floor(storm)}%`;
    (this.root.querySelector('[data-action="storm"]') as HTMLElement).classList.toggle('ready', storm >= 100);
    (this.root.querySelector('#lightning-fill') as HTMLElement).style.width = `${lightning}%`;
    (this.root.querySelector('#lightning-value') as HTMLElement).textContent = `${Math.floor(lightning)}%`;
    (this.root.querySelector('[data-action="lightning"]') as HTMLElement).classList.toggle('ready', lightning >= 100);
    (this.root.querySelector('#form-fill') as HTMLElement).style.width = `${form.active ? form.activeLeft / 20 * 100 : form.cooldownLeft > 0 ? 0 : form.charge}%`;
    (this.root.querySelector('#form-value') as HTMLElement).textContent = form.active ? `${Math.ceil(form.activeLeft)} 秒` :
      form.cooldownLeft > 0 ? `冷卻 ${Math.ceil(form.cooldownLeft)} 秒` : `${Math.floor(form.charge)}%`;
    (this.root.querySelector('[data-action="transform"]') as HTMLElement).classList.toggle('ready', form.ready);
    this.root.classList.toggle('transformed', form.active);
  }

  renderMenu(progress: Progression, stageName: string): void {
    (this.root.querySelector('.hud-title') as HTMLElement).textContent = `珠珠橫向冒險 · ${stageName}`;
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
    panel.innerHTML = `${progress.data.cleared >= 4 ? '<h2>已解鎖關卡</h2><div class="stat-grid"><button data-menu="travel" data-id="5">第五關 · 龍之巢穴</button>' + (progress.data.cleared >= 5 ? '<button data-menu="travel" data-id="6">隱藏第六關</button>' : '') + '</div>' : ''}<h2>補給商店與裝備店</h2>${rows}<h2>背包 · 補給</h2>${inventory}<h2>背包 · 裝備</h2>${owned}<h2>技能點數 (${progress.unspent})</h2>
      <div class="stat-grid">${(['STR', 'DEF', 'MAGIC', 'SPD', 'VIT'] as const).map(stat => `<button data-menu="stat" data-id="${stat}">${stat} ${progress.data.stats[stat]} ＋</button>`).join('')}</div>`;
  }

  announce(message: string): void {
    (this.root.querySelector('#status') as HTMLElement).textContent = message;
  }

  showTutorial(id: string, message: string, target?: string): void {
    if (this.tutorialSeen.has(id) || this.tutorialActive?.id === id || this.tutorialQueue.some(tip => tip.id === id)) return;
    this.tutorialQueue.push({ id, message, target });
    this.nextTutorial();
  }

  private nextTutorial(): void {
    if (this.tutorialActive || !this.tutorialQueue.length) return;
    this.tutorialActive = this.tutorialQueue.shift()!;
    this.tutorialSeen.add(this.tutorialActive.id);
    try { window.localStorage.setItem('juju-game-tutorial-v1', JSON.stringify([...this.tutorialSeen])); }
    catch { /* Private browsing may reject writes. */ }
    (this.root.querySelector('#tutorial-message') as HTMLElement).textContent = this.tutorialActive.message;
    (this.root.querySelector('#tutorial') as HTMLElement).hidden = false;
    if (this.tutorialActive.target) this.root.querySelector(`[data-action="${this.tutorialActive.target}"], #${this.tutorialActive.target}`)?.classList.add('tutorial-focus');
  }

  private dismissTutorial(): void {
    if (!this.tutorialActive) return;
    this.root.querySelector('.tutorial-focus')?.classList.remove('tutorial-focus');
    this.tutorialActive = null;
    (this.root.querySelector('#tutorial') as HTMLElement).hidden = true;
    this.nextTutorial();
  }

  showVictory(stage: number, onContinue: () => void): void {
    this.tutorialQueue.length = 0;
    this.dismissTutorial();
    const victory = this.root.querySelector('#victory') as HTMLElement;
    (this.root.querySelector('#victory-subtitle') as HTMLElement).textContent = stage === 5 ? '主線通關' : '隱藏關 · 真結局';
    (this.root.querySelector('#victory-detail') as HTMLElement).textContent = stage === 5 ?
      '巨大紅龍已擊敗，隱藏第六關已解鎖！' : '終極 Boss 已擊敗！';
    const button = this.root.querySelector('#victory-next') as HTMLButtonElement;
    button.textContent = stage === 5 ? '挑戰隱藏第六關' : '再次挑戰隱藏關';
    button.onclick = () => { this.hideVictory(); onContinue(); };
    const confetti = this.root.querySelector('.victory-confetti') as HTMLElement;
    confetti.replaceChildren(...Array.from({ length: 28 }, (_, i) => {
      const ribbon = document.createElement('i');
      ribbon.style.setProperty('--x', `${(i * 37 + 13) % 100}%`);
      ribbon.style.setProperty('--delay', `${(i % 11) * -.32}s`);
      ribbon.style.setProperty('--speed', `${2.8 + (i % 5) * .4}s`);
      return ribbon;
    }));
    victory.hidden = false;
    button.focus();
  }

  hideVictory(): void {
    (this.root.querySelector('#victory') as HTMLElement).hidden = true;
    (this.root.querySelector('#victory-next') as HTMLButtonElement).onclick = null;
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
