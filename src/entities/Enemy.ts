import Phaser from 'phaser';
import type { PlayerSnapshot } from '../state/PlayerState';
import slime from '../../data/enemies/slime.json';
import goblin from '../../data/enemies/goblin.json';
import wolf from '../../data/enemies/wolf.json';
import tiger from '../../data/enemies/tiger.json';

export type AttackKind = 'melee' | 'ranged' | 'lunge' | 'combo' | 'wave' | 'buff';
export interface Pattern { id: string; damage: number; range: number; cooldown: number; windup: number; kind: AttackKind; slowSeconds?: number; hits?: number }
export interface EnemyConfig {
  id: string; displayName: string; type: 'normal' | 'boss'; stage: number;
  hp: number; speed: number; color: number; coinDrop: number; skillPointDrop: number;
  enrageBelow?: number; patterns: Pattern[]; spriteRef: string;
}
export const ENEMIES: Record<string, EnemyConfig> = { slime, goblin, wolf, tiger } as unknown as Record<string, EnemyConfig>;

export class Enemy {
  readonly graphics: Phaser.GameObjects.Graphics;
  readonly sprite: Phaser.GameObjects.Image;
  readonly label: Phaser.GameObjects.Text;
  readonly maxHp: number;
  hp: number;
  x: number;
  depthY: number;
  alive = true;
  buffLeft = 0;
  private cooldown = 1;
  private windup = 0;
  private nextPattern = 0;
  private selected: Pattern | null = null;
  private flash = 0;
  private faceRight = false;

  constructor(private scene: Phaser.Scene, readonly config: EnemyConfig, x: number, depthY: number,
    private attack: (enemy: Enemy, pattern: Pattern) => void) {
    this.x = x;
    this.depthY = depthY;
    this.maxHp = config.hp;
    this.hp = config.hp;
    this.graphics = scene.add.graphics();
    this.sprite = scene.add.image(x, depthY, config.id).setOrigin(0.5, 1);
    this.label = scene.add.text(x, depthY - 82, config.displayName, { fontFamily: 'sans-serif', fontSize: '13px', color: '#fff' }).setOrigin(0.5);
    this.render();
  }

  get boss(): boolean { return this.config.type === 'boss'; }
  get enraged(): boolean { return this.boss && this.hp / this.maxHp < (this.config.enrageBelow || 0); }

  update(dt: number, player: PlayerSnapshot): void {
    if (!this.alive || Math.abs(this.x - player.x) > 650) return;
    this.faceRight = player.x > this.x;
    this.flash = Math.max(0, this.flash - dt);
    this.buffLeft = Math.max(0, this.buffLeft - dt);
    const speedMultiplier = this.enraged ? 1.35 : 1;
    const cooldownMultiplier = this.enraged || this.buffLeft > 0 ? 1.3 : 1;
    if (this.selected) {
      this.windup -= dt;
      if (this.windup <= 0) {
        this.attack(this, this.selected);
        this.cooldown = this.selected.cooldown / cooldownMultiplier;
        this.selected = null;
      }
    } else {
      this.cooldown -= dt;
      const dx = player.x - this.x, dy = player.depthY - this.depthY;
      if (Math.abs(dx) > 62 || Math.abs(dy) > 35) {
        this.x += Math.sign(dx) * Math.min(Math.abs(dx), this.config.speed * speedMultiplier * dt);
        this.depthY += Math.sign(dy) * Math.min(Math.abs(dy), this.config.speed * .52 * dt);
      }
      if (this.cooldown <= 0) {
        const options = this.config.patterns;
        // Each attack is telegraphed. Use long range only when the player is in reach.
        for (let tries = 0; tries < options.length; tries++) {
          const pattern = options[(this.nextPattern + tries) % options.length];
          if (Math.abs(dx) <= pattern.range && Math.abs(dy) < 65) {
            this.nextPattern = (this.nextPattern + tries + 1) % options.length;
            this.selected = pattern;
            this.windup = pattern.windup;
            break;
          }
        }
        if (!this.selected) this.cooldown = 0.2;
      }
    }
    this.render();
  }

  hit(damage: number): boolean {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - damage);
    this.flash = .16;
    if (!this.hp) {
      this.alive = false;
      this.graphics.setVisible(false);
      this.sprite.setVisible(false);
      this.label.setVisible(false);
      return true;
    }
    this.render();
    return false;
  }

  private render(): void {
    if (!this.alive) return;
    const g = this.graphics;
    g.clear().setDepth(this.depthY + 1);
    const bodyColor = this.flash > 0 ? 0xffffff : this.config.color;
    g.fillStyle(0x142234, .25).fillEllipse(this.x, this.depthY, this.boss ? 78 : 57, 15);
    if (this.scene.textures.exists(this.config.id)) {
      this.sprite.setPosition(this.x, this.depthY).setDepth(this.depthY + 1)
        .setDisplaySize(this.boss ? 115 : 82, this.boss ? 115 : 78)
        .setFlipX(this.faceRight);
      if (this.flash > 0) this.sprite.setTint(0xffffff);
      else this.sprite.clearTint();
    } else if (this.config.id === 'slime') {
      g.fillStyle(bodyColor).fillEllipse(this.x, this.depthY - 24, 51, 43);
      g.fillStyle(0xffffff).fillCircle(this.x - 10, this.depthY - 30, 4).fillCircle(this.x + 10, this.depthY - 30, 4);
    } else if (this.config.id === 'wolf' || this.config.id === 'tiger') {
      g.fillStyle(bodyColor).fillEllipse(this.x, this.depthY - 28, this.boss ? 82 : 62, this.boss ? 58 : 45);
      g.fillTriangle(this.x - 22, this.depthY - 48, this.x - 15, this.depthY - 73, this.x - 5, this.depthY - 49);
      g.fillTriangle(this.x + 8, this.depthY - 49, this.x + 18, this.depthY - 73, this.x + 25, this.depthY - 48);
      g.fillStyle(0xffffff).fillCircle(this.x - 9, this.depthY - 31, 3).fillCircle(this.x + 9, this.depthY - 31, 3);
    } else {
      g.fillStyle(bodyColor).fillRoundedRect(this.x - 24, this.depthY - 67, 48, 57, 13);
      g.fillStyle(0xe4c4aa).fillCircle(this.x, this.depthY - 66, 20);
      g.lineStyle(7, 0x795037).lineBetween(this.x + 22, this.depthY - 40, this.x + 43, this.depthY - 79);
    }
    if (this.selected) {
      g.lineStyle(3, 0xffd4a1, .9).strokeCircle(this.x, this.depthY - 28, this.selected.kind === 'wave' ? 52 : 36);
      g.lineStyle(2, 0xffa878, .65).strokeEllipse(this.x, this.depthY, this.selected.range * 2, 48);
    }
    g.fillStyle(0x16233b).fillRoundedRect(this.x - 27, this.depthY - 94, 54, 6, 3);
    g.fillStyle(this.boss ? 0xffb36e : 0xf16c84).fillRoundedRect(this.x - 27, this.depthY - 94, 54 * this.hp / this.maxHp, 6, 3);
    this.label.setPosition(this.x, this.depthY - 105).setDepth(this.depthY + 2);
  }

  destroy(): void { this.graphics.destroy(); this.sprite.destroy(); this.label.destroy(); }
}
