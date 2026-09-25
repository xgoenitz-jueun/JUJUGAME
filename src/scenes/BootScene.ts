import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { prototype } from '../config/prototype';
import { Controls, type Action } from '../ui/Controls';

interface Projectile {
  x: number;
  depthY: number;
  elevation: number;
  direction: 1 | -1;
  power: number;
  life: number;
  sprite: Phaser.GameObjects.Graphics;
}

/** Phase 1 sandbox: one passive training target; enemy AI and stages begin in Phase 2. */
export class BootScene extends Phaser.Scene {
  private player!: Player;
  private ui!: Controls;
  private background!: Phaser.GameObjects.Graphics;
  private target!: Phaser.GameObjects.Graphics;
  private targetLabel!: Phaser.GameObjects.Text;
  private targetHp: number = prototype.dummyHp;
  private targetFlash = 0;
  private respawnIn = 0;
  private projectiles: Projectile[] = [];
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private targetX = 0;
  private targetY = 0;

  constructor() { super('Boot'); }

  create(): void {
    this.background = this.add.graphics().setDepth(-1000);
    this.target = this.add.graphics();
    this.targetLabel = this.add.text(0, 0, '', { color: '#f2f6ff', fontFamily: 'sans-serif', fontSize: '13px', align: 'center' }).setOrigin(0.5);
    this.player = new Player(this, this.scale.width * 0.24, this.scale.height * 0.59, {
      onMelee: step => this.hitWithMelee(step),
      onKi: (x, depthY, elevation, direction, power) => this.spawnKi(x, depthY, elevation, direction, power)
    });
    this.ui = new Controls((action, pressed) => this.action(action, pressed));
    this.ui.setMeters(this.player.snapshot.hp, this.player.snapshot.mp);
    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.keys = keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,J,G,K,L,C') as Record<string, Phaser.Input.Keyboard.Key>;
      const bindings: Record<string, Action> = { J: 'attack', G: 'ki', K: 'jump', L: 'roll', C: 'crouch' };
      for (const [key, action] of Object.entries(bindings)) {
        this.keys[key].on('down', () => this.action(action, true));
        this.keys[key].on('up', () => this.action(action, false));
      }
      keyboard.addCapture(['UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE']);
    } else {
      this.keys = {};
    }
    this.layout();
    this.scale.on('resize', this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.layout, this);
      this.ui.destroy();
      this.player.destroy();
      for (const shot of this.projectiles) shot.sprite.destroy();
    });
  }

  private action(action: Action, pressed: boolean): void {
    if (action === 'attack' || action === 'ki') {
      if (pressed) this.player.beginAttack(action); else this.player.endAttack(action);
    } else if (action === 'jump' && pressed) this.player.jump();
    else if (action === 'roll' && pressed) this.player.roll(this.directionX());
    else if (action === 'crouch') this.player.setCrouch(pressed);
  }

  private isDown(...names: string[]): boolean { return names.some(name => this.keys[name]?.isDown); }
  private directionX(): number {
    return Phaser.Math.Clamp(this.ui.axes.x + Number(this.isDown('D', 'RIGHT')) - Number(this.isDown('A', 'LEFT')), -1, 1);
  }
  private directionY(): number {
    return Phaser.Math.Clamp(this.ui.axes.y + Number(this.isDown('S', 'DOWN')) - Number(this.isDown('W', 'UP')), -1, 1);
  }

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.05);
    const height = this.scale.height;
    this.player.update(dt, this.directionX(), this.directionY(), {
      width: this.scale.width,
      near: height * (height > this.scale.width ? 0.35 : 0.44),
      far: height * (height > this.scale.width ? 0.78 : 0.82)
    });
    this.ui.setMeters(this.player.snapshot.hp, this.player.snapshot.mp);
    this.targetFlash = Math.max(0, this.targetFlash - dt);
    if (this.respawnIn > 0) {
      this.respawnIn -= dt;
      if (this.respawnIn <= 0) {
        this.targetHp = prototype.dummyHp;
        this.ui.announce('練習標靶已重置；連點攻擊可打出三段連擊');
      }
    }
    this.renderTarget();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const shot = this.projectiles[i];
      shot.life += dt;
      shot.x += shot.direction * 380 * dt;
      const radius = 12 + Math.min(1, shot.life / 0.65) * (16 + shot.power * 15);
      shot.sprite.clear();
      shot.sprite.fillStyle(0xff63ca, 0.17).fillCircle(0, 0, radius + 14);
      shot.sprite.fillStyle(0xff82d6, 0.9).fillCircle(0, 0, radius);
      shot.sprite.fillStyle(0xffffff, 0.88).fillCircle(-radius * 0.2, -radius * 0.2, radius * 0.38);
      shot.sprite.setPosition(shot.x, shot.depthY - shot.elevation - 39).setDepth(shot.depthY + 4);
      if (this.targetHp > 0 && Math.abs(shot.x - this.targetX) < radius + 22 && Math.abs(shot.depthY - this.targetY) < 55) {
        this.hitTarget(Math.round(20 + shot.power * 12), '氣功命中');
        shot.life = 3;
      }
      if (shot.life > 2 || shot.x < -70 || shot.x > this.scale.width + 70) {
        shot.sprite.destroy();
        this.projectiles.splice(i, 1);
      }
    }
  }

  private hitWithMelee(step: number): void {
    const p = this.player.snapshot;
    if (this.targetHp > 0 && (this.targetX - p.x) * p.facing > -15 && (this.targetX - p.x) * p.facing < 94 && Math.abs(p.depthY - this.targetY) < 43) {
      this.hitTarget(prototype.meleeDamage[step - 1], `第 ${step} 段命中`);
    } else {
      this.ui.announce(`第 ${step} 段揮擊；靠近標靶並對準相同縱深可命中`);
    }
  }

  private hitTarget(damage: number, action: string): void {
    this.targetHp = Math.max(0, this.targetHp - damage);
    this.targetFlash = 0.15;
    if (this.targetHp === 0) {
      this.respawnIn = 2;
      this.ui.announce(`${action}！標靶暫時倒下，稍後重置`);
    } else {
      this.ui.announce(`${action} · ${damage} 傷害 · 標靶 HP ${this.targetHp}`);
    }
  }

  private spawnKi(x: number, depthY: number, elevation: number, direction: 1 | -1, power: number): void {
    this.projectiles.push({ x: x + direction * 38, depthY, elevation, direction, power, life: 0, sprite: this.add.graphics() });
    this.ui.announce('粉紅氣功發射：能量球飛行時逐漸放大');
  }

  private layout(): void {
    const w = this.scale.width, h = this.scale.height;
    this.targetX = w * 0.72;
    this.targetY = h * 0.59;
    const g = this.background;
    g.clear();
    g.fillGradientStyle(0x213860, 0x213860, 0x6080ab, 0x6080ab).fillRect(0, 0, w, h);
    const horizon = h * (h > w ? 0.32 : 0.40);
    g.fillStyle(0xb6cce9, 0.17).fillEllipse(w * .65, horizon - 20, w * 1.4, 190);
    g.fillStyle(0x4b708e).fillRect(0, horizon, w, h - horizon);
    for (let i = 0; i < 8; i++) {
      const y = horizon + (h - horizon) * (i / 8) ** 1.5;
      g.lineStyle(1, 0xc0dcf4, 0.12).lineBetween(0, y, w, y);
    }
    for (let x = 0; x < w; x += 90) g.lineStyle(1, 0xc0dcf4, 0.08).lineBetween(x, horizon, x, h);
    g.fillStyle(0xffffff, 0.13).fillRoundedRect(w * .48, horizon + 6, Math.max(120, w * .45), 32, 12);
    this.renderTarget();
  }

  private renderTarget(): void {
    const g = this.target;
    g.clear();
    this.targetLabel.setPosition(this.targetX, this.targetY - 113);
    if (this.targetHp <= 0) { this.targetLabel.setText('標靶重置中…'); return; }
    this.targetLabel.setText(`練習標靶 · ${this.targetHp}/${prototype.dummyHp}`);
    g.setDepth(this.targetY + 1);
    g.fillStyle(0x192b4b, 0.35).fillEllipse(this.targetX, this.targetY + 2, 59, 16);
    g.fillStyle(this.targetFlash ? 0xffd3ec : 0xe9b272).fillRoundedRect(this.targetX - 20, this.targetY - 80, 40, 66, 9);
    g.fillStyle(0xf7ddad).fillCircle(this.targetX, this.targetY - 83, 22);
    g.lineStyle(4, 0x654756).strokeCircle(this.targetX, this.targetY - 83, 12);
    g.fillStyle(0xc75c75).fillCircle(this.targetX, this.targetY - 83, 5);
    g.fillStyle(0x182c4f).fillRoundedRect(this.targetX - 22, this.targetY - 11, 15, 13, 3).fillRoundedRect(this.targetX + 7, this.targetY - 11, 15, 13, 3);
    g.fillStyle(0x1c2d47).fillRoundedRect(this.targetX - 35, this.targetY - 124, 70, 7, 4);
    g.fillStyle(0xee6980).fillRoundedRect(this.targetX - 35, this.targetY - 124, 70 * this.targetHp / prototype.dummyHp, 7, 4);
  }
}
