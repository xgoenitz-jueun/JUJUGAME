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
  private velocityZ = 0;
  private rollLeft = 0;
  private attackLeft = 0;
  private comboLeft = 0;
  private comboStep = 0;
  private held: 'attack' | 'ki' | null = null;
  private heldFor = 0;
  private crouchHeld = false;
  private rollDirection = 1;

  constructor(private scene: Phaser.Scene, x: number, depthY: number, private hooks: Hooks) {
    this.snapshot = { x, depthY, elevation: 0, facing: 1, pose: 'idle', hp: prototype.hp, mp: prototype.mp, invulnerable: false, charge: 0 };
    this.shadow = scene.add.graphics();
    this.body = scene.add.graphics();
    this.render();
  }

  get isRolling(): boolean { return this.rollLeft > 0; }
  get isCrouching(): boolean { return this.crouchHeld && this.snapshot.elevation === 0 && !this.isRolling; }

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
    this.rollLeft = Math.max(0, this.rollLeft - dt);
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
      s.x += dx * prototype.walkSpeed * movementFactor * dt;
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
    s.mp = Math.min(prototype.mp, s.mp + prototype.mpRegenerationPerSecond * dt);
    const pose: Pose = this.isRolling ? 'roll' : s.charge > 0 ? 'charge' : this.isCrouching ? 'crouch' : s.elevation > 0 ? 'jump' : this.attackLeft > 0 ? 'attack' : dx || dy ? 'move' : 'idle';
    s.pose = pose;
    this.render();
  }

  private render(): void {
    const s = this.snapshot;
    this.shadow.clear().fillStyle(0x0c1d39, 0.36).fillEllipse(0, 0, s.elevation ? 49 : 63, 16);
    this.shadow.setPosition(s.x, s.depthY + 2).setDepth(s.depthY);
    const g = this.body;
    g.clear();
    const crouch = s.pose === 'crouch' || s.pose === 'roll';
    const h = crouch ? 56 : 78;
    const bottom = 0;
    g.fillStyle(s.invulnerable ? 0x99c2ef : 0xf8f2fb).fillRoundedRect(-21, -h + 28, 42, h - 36, 13);
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

  destroy(): void { this.shadow.destroy(); this.body.destroy(); }
}
