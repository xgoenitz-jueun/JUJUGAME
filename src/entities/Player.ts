import Phaser from 'phaser';
import { prototype } from '../config/prototype';
import type { PlayerSnapshot, Pose } from '../state/PlayerState';

type Hooks = {
  onMelee: (step: number) => void;
  onKi: (x: number, depthY: number, elevation: number, direction: 1 | -1, charge: number) => void;
};

export class Player {
  readonly snapshot: PlayerSnapshot;
  private readonly body: Phaser.GameObjects.Graphics;
  private readonly shadow: Phaser.GameObjects.Graphics;
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly chargeVisual: Phaser.GameObjects.Image;
  private visualClock = 0;
  private lastVisual = '';
  private velocityZ = 0;
  private rollLeft = 0;
  private attackLeft = 0;
  private comboLeft = 0;
  private comboStep = 0;
  private held: 'attack' | 'ki' | null = null;
  private heldFor = 0;
  private crouchHeld = false;
  private rollDirection = 1;
  private hurtLeft = 0;
  maxHp: number = prototype.hp;
  maxMp: number = prototype.mp;
  speedBonus = 0;

  constructor(private scene: Phaser.Scene, x: number, depthY: number, private hooks: Hooks) {
    this.snapshot = { x, depthY, elevation: 0, facing: 1, pose: 'idle', hp: prototype.hp, mp: prototype.mp, invulnerable: false, charge: 0 };
    this.shadow = scene.add.graphics();
    this.body = scene.add.graphics();
    this.sprite = scene.add.sprite(x, depthY, 'player_base_idle', 0).setOrigin(0.5, 1);
    this.chargeVisual = scene.add.image(x, depthY, 'player_ki_charge').setVisible(false);
    this.render();
  }

  get isRolling(): boolean { return this.rollLeft > 0; }
  get isCrouching(): boolean { return this.crouchHeld && this.snapshot.elevation === 0 && !this.isRolling; }

  receiveDamage(amount: number): number {
    if (this.snapshot.invulnerable || this.hurtLeft > 0 || this.snapshot.hp <= 0) return 0;
    const taken = Math.max(1, Math.round(amount));
    this.snapshot.hp = Math.max(0, this.snapshot.hp - taken);
    this.hurtLeft = 0.7;
    this.render();
    return taken;
  }

  heal(amount: number): number {
    const before = this.snapshot.hp;
    this.snapshot.hp = Math.min(this.maxHp, before + amount);
    return this.snapshot.hp - before;
  }

  setMaximums(hp: number, mp: number, speedBonus: number): void {
    const oldHp = this.maxHp;
    this.maxHp = hp;
    this.maxMp = mp;
    this.speedBonus = speedBonus;
    this.snapshot.hp = Math.min(hp, this.snapshot.hp + Math.max(0, hp - oldHp));
    this.snapshot.mp = Math.min(mp, this.snapshot.mp);
  }

  revive(x: number, depthY: number): void {
    this.snapshot.x = x;
    this.snapshot.depthY = depthY;
    this.snapshot.elevation = 0;
    this.snapshot.hp = this.maxHp;
    this.snapshot.mp = this.maxMp;
    this.snapshot.invulnerable = false;
    this.snapshot.charge = 0;
    this.rollLeft = 0;
    this.hurtLeft = 0;
    this.attackLeft = 0;
    this.held = null;
    this.heldFor = 0;
    this.crouchHeld = false;
  }

  beginAttack(kind: 'attack' | 'ki'): void {
    if (this.held || this.isRolling || this.snapshot.hp <= 0) return;
    this.held = kind;
    this.heldFor = 0;
  }

  endAttack(kind: 'attack' | 'ki'): void {
    if (this.held !== kind) return;
    const charging = kind === 'ki' || this.heldFor >= prototype.chargeThresholdSeconds;
    const power = this.snapshot.charge;
    this.held = null;
    this.snapshot.charge = 0;
    if (charging) {
      if (this.snapshot.mp >= prototype.kiCost) {
        this.snapshot.mp -= prototype.kiCost;
        this.hooks.onKi(this.snapshot.x, this.snapshot.depthY, this.snapshot.elevation, this.snapshot.facing, Math.max(0.12, power));
        this.attackLeft = 0.22;
      }
      return;
    }
    if (this.isRolling) return;
    this.comboStep = this.comboLeft > 0 ? (this.comboStep % 3) + 1 : 1;
    this.comboLeft = prototype.comboWindowSeconds;
    this.attackLeft = 0.19;
    this.hooks.onMelee(this.comboStep);
  }

  jump(): void {
    if (this.snapshot.elevation === 0 && !this.isRolling && !this.isCrouching) this.velocityZ = prototype.jumpSpeed;
  }

  roll(horizontal: number): void {
    if (this.isRolling || this.snapshot.elevation > 0) return;
    this.held = null;
    this.snapshot.charge = 0;
    this.rollDirection = horizontal !== 0 ? Math.sign(horizontal) : this.snapshot.facing;
    this.rollLeft = prototype.rollSeconds;
    this.snapshot.invulnerable = true;
  }

  setCrouch(held: boolean): void { this.crouchHeld = held; }

  update(dt: number, dx: number, dy: number, bounds: { width: number; near: number; far: number }): void {
    const s = this.snapshot;
    this.visualClock += dt;
    this.rollLeft = Math.max(0, this.rollLeft - dt);
    this.hurtLeft = Math.max(0, this.hurtLeft - dt);
    this.attackLeft = Math.max(0, this.attackLeft - dt);
    this.comboLeft = Math.max(0, this.comboLeft - dt);
    if (!this.comboLeft) this.comboStep = 0;
    if (this.held) {
      this.heldFor += dt;
      if (this.held === 'ki' || this.heldFor >= prototype.chargeThresholdSeconds) {
        s.charge = Math.min(1, this.heldFor / prototype.maxChargeSeconds);
      }
    }
    const magnitude = Math.hypot(dx, dy);
    if (magnitude > 1) { dx /= magnitude; dy /= magnitude; }
    if (this.rollLeft > 0) {
      s.x += this.rollDirection * prototype.rollSpeed * dt;
      s.invulnerable = true;
    } else {
      s.invulnerable = false;
      const movementFactor = this.isCrouching ? 0.4 : 1;
      s.x += dx * (prototype.walkSpeed + this.speedBonus) * movementFactor * dt;
      s.depthY += dy * prototype.depthSpeed * movementFactor * dt;
      if (dx !== 0) s.facing = dx > 0 ? 1 : -1;
    }
    s.x = Phaser.Math.Clamp(s.x, 40, Math.max(41, bounds.width - 40));
    s.depthY = Phaser.Math.Clamp(s.depthY, bounds.near, bounds.far);
    if (this.velocityZ || s.elevation) {
      s.elevation += this.velocityZ * dt;
      this.velocityZ -= prototype.gravity * dt;
      if (s.elevation <= 0) { s.elevation = 0; this.velocityZ = 0; }
    }
    s.mp = Math.min(this.maxMp, s.mp + prototype.mpRegenerationPerSecond * dt);
    const pose: Pose = s.hp <= 0 ? 'dead' : this.isRolling ? 'roll' : this.hurtLeft > 0 ? 'hurt' : s.charge > 0 ? 'charge' : this.isCrouching ? 'crouch' : s.elevation > 0 ? 'jump' : this.attackLeft > 0 ? 'attack' : dx || dy ? 'move' : 'idle';
    s.pose = pose;
    this.render();
  }

  private render(): void {
    const s = this.snapshot;
    this.shadow.clear().fillStyle(0x0c1d39, 0.36).fillEllipse(0, 0, s.elevation ? 49 : 63, 16);
    this.shadow.setPosition(s.x, s.depthY + 2).setDepth(s.depthY);
    const g = this.body;
    g.clear();
    if (this.scene.textures.exists('player_base_idle')) {
      g.setVisible(false);
      const visual = s.pose === 'jump' ? 'jump' : s.pose === 'roll' ? 'roll' :
        s.pose === 'crouch' ? 'crouch' : s.pose === 'move' ? 'move' : 'idle';
      if (this.lastVisual !== visual) { this.visualClock = 0; this.lastVisual = visual; }
      const texture = `player_base_${visual}`;
      const lengths: Record<string, number> = { idle: 8, move: 8, jump: 7, crouch: 5, roll: 7 };
      const frame = visual === 'jump' ? Math.min(6, Math.floor(this.visualClock * 9)) :
        visual === 'roll' ? Math.min(6, Math.floor((1 - this.rollLeft / prototype.rollSeconds) * 7)) :
        visual === 'crouch' ? 2 : Math.floor(this.visualClock * (visual === 'move' ? 12 : 5)) % lengths[visual];
      if (this.sprite.texture.key !== texture || this.sprite.frame.name !== String(frame))
        this.sprite.setTexture(texture, frame);
      this.sprite.setDisplaySize(visual === 'roll' ? 93 : 85, visual === 'crouch' ? 89 : 108)
        .setPosition(s.x, s.depthY - s.elevation).setDepth(s.depthY + 1)
        .setFlipX(s.facing < 0);
      if (s.pose === 'hurt') this.sprite.setTint(0xffb1c2);
      else this.sprite.clearTint();
      this.chargeVisual.setVisible(s.charge > 0);
      if (s.charge > 0) {
        const diameter = 25 + s.charge * 59;
        this.chargeVisual.setPosition(s.x + s.facing * 32, s.depthY - s.elevation - 59)
          .setDisplaySize(diameter, diameter).setDepth(s.depthY + 3).setAlpha(.75 + s.charge * .25);
      }
      return;
    }
    const crouch = s.pose === 'crouch' || s.pose === 'roll';
    const h = crouch ? 56 : 78;
    const bottom = 0;
    g.fillStyle(s.invulnerable ? 0x99c2ef : s.pose === 'hurt' ? 0xffb9c6 : 0xf8f2fb).fillRoundedRect(-21, -h + 28, 42, h - 36, 13);
    g.fillStyle(0x659be3).fillRoundedRect(-22, bottom - 22, 17, 20, 5).fillRoundedRect(5, bottom - 22, 17, 20, 5);
    g.fillStyle(0xf8d9cc).fillCircle(0, -h + 17, 23);
    g.fillStyle(0x35324d).fillRoundedRect(-23, -h - 5, 46, 16, 7);
    g.fillStyle(0x35324d).fillEllipse(-17, -h + 19, 12, 35).fillEllipse(17, -h + 19, 12, 35);
    g.fillStyle(0x2e3b57).fillCircle(-8, -h + 18, 2).fillCircle(8, -h + 18, 2);
    g.lineStyle(2, 0xa85472).beginPath().arc(0, -h + 26, 5, 0.15, Math.PI - 0.15).strokePath();
    g.fillStyle(0xf8d9cc).fillCircle(s.facing * (s.pose === 'attack' ? 35 : 23), -h + 42, 8);
    if (s.charge > 0) {
      const orbX = s.facing * 32;
      const orbY = -h + 40;
      g.fillStyle(0xff6ac9, 0.23).fillCircle(orbX, orbY, 19 + s.charge * 19);
      g.fillStyle(0xffa9e2, 0.85).fillCircle(orbX, orbY, 8 + s.charge * 12);
      g.fillStyle(0xffffff, 0.85).fillCircle(orbX - 3, orbY - 3, 3 + s.charge * 4);
    }
    g.setPosition(s.x, s.depthY - s.elevation).setDepth(s.depthY + 1);
  }

  destroy(): void { this.shadow.destroy(); this.body.destroy(); this.sprite.destroy(); this.chargeVisual.destroy(); }
}
