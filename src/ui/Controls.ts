export type Action = 'attack' | 'ki' | 'jump' | 'roll' | 'crouch';

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

  constructor(private onAction: (action: Action, pressed: boolean) => void) {
    const game = document.querySelector('#game');
    if (!game) throw new Error('Missing #game element');
    this.root = document.createElement('div');
    this.root.id = 'overlay';
    this.root.innerHTML = `
      <div id="hud"><div class="hud-title">Phase 1 · 操作／戰鬥原型</div>
        <div class="bar-label">HP <span id="hp-value"></span></div><div class="bar hp"><i id="hp-fill"></i></div>
        <div class="bar-label">MP <span id="mp-value"></span></div><div class="bar mp"><i id="mp-fill"></i></div>
        <div id="status" role="status" aria-live="polite">移動靠近練習標靶，試試三段連擊</div>
      </div>
      <div id="hint">鍵盤：WASD／方向鍵移動 · J 攻擊（長按蓄力） · G 氣功 · K 跳 · L 翻滾 · C 蹲下</div>
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
    this.joystick.style.left = `${event.clientX - rect.left}px`;
    this.joystick.style.top = `${event.clientY - rect.top}px`;
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

  setMeters(hp: number, mp: number): void {
    (this.root.querySelector('#hp-fill') as HTMLElement).style.width = `${hp}%`;
    (this.root.querySelector('#mp-fill') as HTMLElement).style.width = `${mp}%`;
    (this.root.querySelector('#hp-value') as HTMLElement).textContent = `${Math.ceil(hp)} / 100`;
    (this.root.querySelector('#mp-value') as HTMLElement).textContent = `${Math.ceil(mp)} / 100`;
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
