import Phaser from 'phaser';
import type { PlayerSnapshot } from '../state/PlayerState';
import { EnemyStatus, STATUS_CONFIG, type StatusColor } from '../state/EnemyStatus';
import slime from '../../data/enemies/slime.json';
import goblin from '../../data/enemies/goblin.json';
import wolf from '../../data/enemies/wolf.json';
import tiger from '../../data/enemies/tiger.json';
import ghost from '../../data/enemies/ghost.json';
import zombie from '../../data/enemies/zombie.json';
import orc from '../../data/enemies/orc.json';
import cyclops from '../../data/enemies/cyclops.json';
import redDragon from '../../data/enemies/red_dragon.json';
import wyvernRed from '../../data/enemies/wyvern_red.json';
import wyvernBlue from '../../data/enemies/wyvern_blue.json';
import wyvernGold from '../../data/enemies/wyvern_gold.json';
import wyvernGreen from '../../data/enemies/wyvern_green.json';
import wyvernPurple from '../../data/enemies/wyvern_purple.json';
import finalBoss from '../../data/enemies/final_boss.json';

export type AttackKind = 'melee' | 'ranged' | 'lunge' | 'combo' | 'wave' | 'buff' | 'phase' | 'grab' | 'poison' | 'summon' | 'laser' | 'fire' | 'dive';
export interface Pattern { id: string; damage: number; range: number; cooldown: number; windup: number; kind: AttackKind; slowSeconds?: number; sealSeconds?: number; hits?: number; element?: 'fire' | 'ice' | 'lightning' | 'dark'; phase?: number }
export interface EnemyConfig {
  id: string; displayName: string; type: 'normal' | 'boss'; stage: number;
  hp: number; speed: number; color: number; coinDrop: number; skillPointDrop: number;
  enrageBelow?: number; patterns: Pattern[]; spriteRef: string;
  phaseTwoSpriteRef?: string;
  phaseTwo?: { triggerHpRatio: number; maxHpMultiplier: number; darkFlameIntervalSeconds: number; darkFlameWarningSeconds: number; darkFlameMaxHpRatio: number };
}
export const ENEMIES: Record<string, EnemyConfig> = { slime, goblin, wolf, tiger, ghost, zombie, orc, cyclops,
  red_dragon: redDragon, wyvern_red: wyvernRed, wyvern_blue: wyvernBlue, wyvern_gold: wyvernGold,
  wyvern_green: wyvernGreen, wyvern_purple: wyvernPurple, final_boss: finalBoss } as unknown as Record<string, EnemyConfig>;

export class Enemy {
  readonly graphics: Phaser.GameObjects.Graphics;
  readonly sprite: Phaser.GameObjects.Image;
  readonly label: Phaser.GameObjects.Text;
  readonly statusLabel: Phaser.GameObjects.Text;
  readonly status = new EnemyStatus();
  maxHp: number;
  hp: number;
  x: number;
  depthY: number;
  alive = true;
  buffLeft = 0;
  private cooldown = 1;
  private windup = 0;
  private nextPattern = 0;
  private selected: Pattern | null = null;
  private lunge: { direction: number; remaining: number; speed: number; onStep: (from: number, to: number) => void } | null = null;
  private flash = 0;
  private faceRight = false;
  private phaseLeft = 0;
  private visualTime = 0;
  summoned = false;
  phaseTwo = false;
  phaseJustChanged = false;

  constructor(private scene: Phaser.Scene, readonly config: EnemyConfig, x: number, depthY: number,
    private attack: (enemy: Enemy, pattern: Pattern) => void,
    private statusDamage: (enemy: Enemy, damage: number) => void) {
    this.x = x;
    this.depthY = depthY;
    this.maxHp = config.hp;
    this.hp = config.hp;
    this.graphics = scene.add.graphics();
    this.sprite = scene.add.image(x, depthY, config.id).setOrigin(0.5, 1);
    this.label = scene.add.text(x, depthY - 82, config.displayName, { fontFamily: 'sans-serif', fontSize: '13px', color: '#fff' }).setOrigin(0.5);
    this.statusLabel = scene.add.text(x, depthY - 127, '', { fontFamily: 'sans-serif', fontSize: '12px',
      fontStyle: 'bold', color: '#fff', backgroundColor: '#1a2239bb', padding: { x: 3, y: 2 } }).setOrigin(0.5);
    this.render();
  }

  get boss(): boolean { return this.config.type === 'boss'; }
  get enraged(): boolean { return this.boss && this.hp / this.maxHp < (this.config.enrageBelow || 0); }

  update(dt: number, player: PlayerSnapshot): void {
    if (!this.alive) return;
    this.status.update(dt, damage => this.statusDamage(this, damage));
    if (!this.alive || Math.abs(this.x - player.x) > 650) return;
    this.visualTime += dt;
    this.faceRight = player.x > this.x;
    this.flash = Math.max(0, this.flash - dt);
    this.phaseLeft = Math.max(0, this.phaseLeft - dt);
    this.buffLeft = Math.max(0, this.buffLeft - dt);
    const speedMultiplier = this.enraged || this.phaseTwo ? 1.35 : 1;
    const cooldownMultiplier = this.enraged || this.buffLeft > 0 ? 1.3 : 1;
    if (this.lunge) {
      // Travel through the warned lane over several frames; a status effect can interrupt it.
      if (!this.status.canAttack) this.lunge = null;
      else if (this.status.moveMultiplier > 0) {
        const rush = this.lunge;
        const step = Math.min(rush.remaining, rush.speed * this.status.moveMultiplier * dt);
        const from = this.x;
        this.x += rush.direction * step;
        rush.remaining -= step;
        rush.onStep(from, this.x);
        if (rush.remaining <= 0) this.lunge = null;
      }
    } else if (this.selected && this.status.canAttack) {
      this.windup -= dt;
      if (this.windup <= 0) {
        this.attack(this, this.selected);
        this.cooldown = this.selected.cooldown / cooldownMultiplier;
        this.selected = null;
      }
    } else if (!this.selected) {
      this.cooldown -= dt;
      const dx = player.x - this.x, dy = player.depthY - this.depthY;
      if (Math.abs(dx) > 62 || Math.abs(dy) > 35) {
        this.x += Math.sign(dx) * Math.min(Math.abs(dx), this.config.speed * speedMultiplier * this.status.moveMultiplier * dt);
        this.depthY += Math.sign(dy) * Math.min(Math.abs(dy), this.config.speed * .52 * this.status.moveMultiplier * dt);
      }
      if (this.cooldown <= 0 && this.status.canAttack) {
        const options = this.config.patterns;
        // Each attack is telegraphed. Use long range only when the player is in reach.
        for (let tries = 0; tries < options.length; tries++) {
          const pattern = options[(this.nextPattern + tries) % options.length];
          if ((!pattern.phase || this.phaseTwo) && Math.abs(dx) <= pattern.range && Math.abs(dy) < 65) {
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

  beginLunge(direction: number, distance: number, speed: number, onStep: (from: number, to: number) => void): void {
    this.lunge = { direction: Math.sign(direction) || 1, remaining: distance, speed, onStep };
  }

  hit(damage: number): boolean {
    if (!this.alive) return false;
    if (this.phaseLeft > 0) return false;
    this.hp = Math.max(0, this.hp - damage);
    this.flash = .16;
    if (this.config.phaseTwo && !this.phaseTwo && this.hp <= this.maxHp * this.config.phaseTwo.triggerHpRatio) {
      this.phaseTwo = true;
      this.phaseJustChanged = true;
      this.maxHp = Math.round(this.maxHp * this.config.phaseTwo.maxHpMultiplier);
      this.hp = this.maxHp;
      this.selected = null;
      this.lunge = null;
      this.windup = 0;
      this.cooldown = 2;
      this.sprite.setTexture(`${this.config.id}_phase2`);
      this.render();
      return false;
    }
    if (!this.hp) {
      this.alive = false;
      this.graphics.setVisible(false);
      this.sprite.setVisible(false);
      this.label.setVisible(false);
      this.statusLabel.setVisible(false);
      return true;
    }
    this.render();
    return false;
  }

  phase(seconds: number): void { this.phaseLeft = seconds; }

  applyStatus(color: StatusColor): void {
    if (!this.alive) return;
    this.status.apply(color);
    // Stun breaks a warned attack; freeze holds its windup until thawed.
    if (color === 'purple') {
      this.selected = null;
      this.lunge = null;
      this.windup = 0;
      this.cooldown = Math.max(this.cooldown, .4);
    }
    this.render();
  }

  private render(): void {
    if (!this.alive) return;
    const g = this.graphics;
    g.clear().setDepth(this.depthY + 1);
    const bodyColor = this.flash > 0 ? 0xffffff : this.config.color;
    g.fillStyle(0x142234, .25).fillEllipse(this.x, this.depthY, this.boss ? 78 : 57, 15);
    if (this.scene.textures.exists(this.config.id)) {
      this.sprite.setPosition(this.x, this.depthY).setDepth(this.depthY + 1)
        .setDisplaySize(this.config.id === 'red_dragon' ? 205 : this.config.id === 'final_boss' ? 145 : this.boss ? 115 : 82,
          this.config.id === 'red_dragon' ? 200 : this.config.id === 'final_boss' ? 155 : this.boss ? 115 : 78)
        .setFlipX(this.faceRight);
      if (this.flash > 0) this.sprite.setTint(0xffffff);
      else this.sprite.clearTint();
      this.sprite.setAlpha(this.phaseLeft > 0 ? .3 : 1);
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
      if (this.selected.kind === 'lunge') {
        const direction = this.faceRight ? 1 : -1;
        g.lineStyle(7, 0xffad57, .7).lineBetween(this.x, this.depthY - 8,
          this.x + direction * Math.min(this.selected.range, this.config.id === 'orc' ? 165 : 42), this.depthY - 8);
        g.fillStyle(0xffdf91, .85).fillTriangle(this.x + direction * 24, this.depthY - 70,
          this.x + direction * 12, this.depthY - 85, this.x + direction * 36, this.depthY - 85);
      } else if (this.selected.kind === 'laser') {
        g.lineStyle(4, 0xeeb0ff, .85).lineBetween(this.x, this.depthY - 56,
          this.x + (this.faceRight ? 1 : -1) * this.selected.range, this.depthY - 56);
      } else {
        g.lineStyle(3, 0xffd4a1, .9).strokeCircle(this.x, this.depthY - 28, this.selected.kind === 'wave' ? 52 : 36);
        g.lineStyle(2, 0xffa878, .65).strokeEllipse(this.x, this.depthY, this.selected.range * 2, 48);
      }
    }
    if (this.lunge) g.lineStyle(5, 0xffa05f, .8).lineBetween(this.x - this.lunge.direction * 32,
      this.depthY - 12, this.x, this.depthY - 12);
    if (this.status.has('red')) {
      g.fillStyle(0xff7937, .75).fillCircle(this.x - 20, this.depthY - 48, 5)
        .fillCircle(this.x + 18, this.depthY - 55, 4);
    }
    if (this.status.has('blue')) {
      g.lineStyle(3, 0x65d6ff, .9).strokeEllipse(this.x, this.depthY - 37, 60, 69);
    }
    if (this.status.has('yellow')) {
      g.lineStyle(3, 0xffe36b, .95).lineBetween(this.x - 24, this.depthY - 76, this.x - 13, this.depthY - 60)
        .lineBetween(this.x - 13, this.depthY - 60, this.x - 21, this.depthY - 58);
    }
    if (this.status.has('green')) {
      g.fillStyle(0x55dc70, .55).fillEllipse(this.x, this.depthY - 25, 78, 58);
      for (let i = 0; i < 3; i++) g.fillStyle(0xa5fb83, .9)
        .fillCircle(this.x + Math.sin(this.visualTime * 2 + i * 2.4) * 24,
          this.depthY - 23 - (this.visualTime * 16 + i * 17) % 55, 3 + i);
    }
    if (this.status.has('purple')) {
      g.lineStyle(2, 0xdf8dff, .9).strokeEllipse(this.x, this.depthY - 112, 48, 13);
      for (let i = 0; i < 3; i++) g.fillStyle(0xffdc74, 1).fillCircle(
        this.x + Math.cos(this.visualTime * 6 + i * 2.09) * 23,
        this.depthY - 112 + Math.sin(this.visualTime * 6 + i * 2.09) * 7, 4);
    }
    g.fillStyle(0x16233b).fillRoundedRect(this.x - 27, this.depthY - 94, 54, 6, 3);
    g.fillStyle(this.boss ? 0xffb36e : 0xf16c84).fillRoundedRect(this.x - 27, this.depthY - 94, 54 * this.hp / this.maxHp, 6, 3);
    this.label.setText(this.phaseTwo ? `${this.config.displayName} · 惡魔形態` : this.config.displayName)
      .setPosition(this.x, this.depthY - 105).setDepth(this.depthY + 2);
    const active = this.status.active;
    this.statusLabel.setText(active.map(color => STATUS_CONFIG[color].name).join(' · '))
      .setPosition(this.x, this.depthY - 137).setDepth(this.depthY + 3).setVisible(active.length > 0);
  }

  destroy(): void { this.graphics.destroy(); this.sprite.destroy(); this.label.destroy(); this.statusLabel.destroy(); }
}
