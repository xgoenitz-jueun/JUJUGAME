import Phaser from 'phaser';
import stage1 from '../../data/levels/stage1.json';
import stage2 from '../../data/levels/stage2.json';
import { Enemy, ENEMIES, type Pattern } from '../entities/Enemy';
import { Player } from '../entities/Player';
import { prototype } from '../config/prototype';
import { Progression, type Stat } from '../systems/Progression';
import { Controls, type Action } from '../ui/Controls';

type Level = {
  id: string; number: number; name: string; worldWidth: number; background: string;
  checkpoints: { id: string; position: number }[];
  spawnTable: { enemyId: string; positions: number[] }[];
  boss: { enemyId: string; position: number };
  levelUpOnClear: number;
};
type Shot = { x: number; y: number; elevation: number; direction: number; damage: number;
  slow: number; owner: 'enemy' | 'player'; power: number; life: number; graphic: Phaser.GameObjects.Graphics };
type Drop = { x: number; y: number; coins: number; points: number; graphic: Phaser.GameObjects.Graphics };
const LEVELS: Record<number, Level> = { 1: stage1, 2: stage2 };

/** Phases 1–2. JSON drives enemy stats, layouts, checkpoints and shop items. */
export class BootScene extends Phaser.Scene {
  private player!: Player;
  private ui!: Controls;
  private progress!: Progression;
  private background!: Phaser.GameObjects.Graphics;
  private markers!: Phaser.GameObjects.Graphics;
  private level!: Level;
  private enemies: Enemy[] = [];
  private shots: Shot[] = [];
  private drops: Drop[] = [];
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private slowLeft = 0;
  private deadPending = false;
  private finished = false;

  constructor() { super('Boot'); }

  preload(): void {
    const url = (name: string) => `${import.meta.env.BASE_URL}assets/sprites/${name}.png`;
    for (const name of ['player_base_idle', 'player_base_move', 'player_base_jump',
      'player_base_crouch', 'player_base_roll']) {
      this.load.spritesheet(name, url(name), {
        frameWidth: name.endsWith('idle') || name.endsWith('move') ? 220 : 260,
        frameHeight: name.endsWith('idle') || name.endsWith('move') ? 270 : 290
      });
    }
    for (const name of ['player_ki_charge', 'player_ki_beam']) this.load.image(name, url(name));
    for (const config of Object.values(ENEMIES)) this.load.image(config.id, `${import.meta.env.BASE_URL}${config.spriteRef}`);
  }

  create(): void {
    this.progress = new Progression(window.localStorage);
    this.level = LEVELS[this.progress.data.stage];
    this.background = this.add.graphics().setDepth(-1000);
    this.markers = this.add.graphics().setDepth(-100);
    const checkpoint = this.progress.data.checkpoints[String(this.level.number)];
    this.player = new Player(this, checkpoint ? checkpoint.position + 18 : 120, this.scale.height * .59, {
      onMelee: step => this.melee(step),
      onKi: (x, y, elevation, direction, power) => this.fireBeam(x, y, elevation, direction, power)
    });
    this.ui = new Controls((action, pressed) => this.action(action, pressed),
      (command, id) => this.menuAction(command, id));
    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.keys = keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,J,G,K,L,C') as Record<string, Phaser.Input.Keyboard.Key>;
      const bindings: Record<string, Action> = { J: 'attack', G: 'ki', K: 'jump', L: 'roll', C: 'crouch' };
      for (const [key, action] of Object.entries(bindings)) {
        this.keys[key].on('down', () => this.action(action, true));
        this.keys[key].on('up', () => this.action(action, false));
      }
      keyboard.addCapture(['UP', 'DOWN', 'LEFT', 'RIGHT']);
    } else this.keys = {};
    this.loadStage(this.level.number, true);
    this.scale.on('resize', this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.layout, this);
      this.ui.destroy();
      this.player.destroy();
      this.clearStage();
    });
  }

  private loadStage(number: number, resume = false): void {
    this.clearStage();
    this.level = LEVELS[number];
    this.finished = false;
    this.deadPending = false;
    this.slowLeft = 0;
    const cp = resume ? this.progress.data.checkpoints[String(number)] : undefined;
    const startX = cp ? cp.position + 18 : 120;
    this.player.setMaximums(this.progress.maxHp, this.progress.maxMp, this.progress.speedBonus);
    this.player.revive(startX, this.scale.height * .59);
    for (const wave of this.level.spawnTable) {
      wave.positions.forEach((x, index) => {
        if (cp && x < cp.position - 70) return;
        this.enemies.push(new Enemy(this, ENEMIES[wave.enemyId], x, this.depthFor(index),
          (enemy, pattern) => this.enemyAttack(enemy, pattern)));
      });
    }
    this.enemies.push(new Enemy(this, ENEMIES[this.level.boss.enemyId], this.level.boss.position, this.scale.height * .59,
      (enemy, pattern) => this.enemyAttack(enemy, pattern)));
    this.cameras.main.setBounds(0, 0, this.level.worldWidth, this.scale.height);
    this.layout();
    this.refreshHud();
    this.ui.announce(`${this.level.name}：擊敗怪物、啟動傳送點，再挑戰 Boss`);
  }

  private depthFor(index: number): number { return this.scale.height * (.54 + (index % 3 - 1) * .065); }

  private clearStage(): void {
    this.enemies.forEach(enemy => enemy.destroy());
    this.shots.forEach(shot => shot.graphic.destroy());
    this.drops.forEach(drop => drop.graphic.destroy());
    this.enemies = [];
    this.shots = [];
    this.drops = [];
  }

  private action(action: Action, pressed: boolean): void {
    if (this.deadPending || this.finished) return;
    if (action === 'attack' || action === 'ki') {
      if (pressed) this.player.beginAttack(action); else this.player.endAttack(action);
    } else if (action === 'jump' && pressed) this.player.jump();
    else if (action === 'roll' && pressed) this.player.roll(this.moveX());
    else if (action === 'crouch') this.player.setCrouch(pressed);
  }

  private menuAction(command: string, id: string): void {
    if (command === 'buy') this.ui.announce(this.progress.buy(id));
    if (command === 'equip') this.ui.announce(this.progress.equip(id));
    if (command === 'stat') this.ui.announce(this.progress.allocate(id as Stat));
    if (command === 'use') {
      const amount = this.progress.use(id);
      this.ui.announce(amount ? `回復 ${this.player.heal(amount)} HP` : '背包沒有此補給');
    }
    this.player.setMaximums(this.progress.maxHp, this.progress.maxMp, this.progress.speedBonus);
    this.refreshHud();
  }

  private down(...names: string[]): boolean { return names.some(name => this.keys[name]?.isDown); }
  private moveX(): number {
    return Phaser.Math.Clamp(this.ui.axes.x + Number(this.down('D', 'RIGHT')) - Number(this.down('A', 'LEFT')), -1, 1);
  }
  private moveY(): number {
    return Phaser.Math.Clamp(this.ui.axes.y + Number(this.down('S', 'DOWN')) - Number(this.down('W', 'UP')), -1, 1);
  }

  update(_time: number, elapsed: number): void {
    const dt = Math.min(elapsed / 1000, .05), p = this.player.snapshot;
    this.slowLeft = Math.max(0, this.slowLeft - dt);
    const firstAlive = this.enemies.find(enemy => enemy.alive);
    const barrier = firstAlive ? Math.min(this.level.worldWidth, firstAlive.x + 155) : this.level.worldWidth;
    this.player.update(dt, this.deadPending || this.finished ? 0 : this.moveX() * (this.slowLeft > 0 ? .55 : 1),
      this.deadPending || this.finished ? 0 : this.moveY() * (this.slowLeft > 0 ? .55 : 1), {
        width: barrier,
        near: this.scale.height * (this.scale.height > this.scale.width ? .35 : .44),
        far: this.scale.height * (this.scale.height > this.scale.width ? .78 : .82)
      });
    this.cameras.main.scrollX = Phaser.Math.Clamp(p.x - this.scale.width * .30, 0,
      Math.max(0, this.level.worldWidth - this.scale.width));
    if (!this.deadPending && !this.finished) {
      for (const enemy of this.enemies) enemy.update(dt, p);
      this.checkCheckpoints();
      this.checkDrops();
      this.updateShots(dt);
    }
    this.ui.setMeters(p.hp, p.mp, this.player.maxHp, this.player.maxMp);
  }

  private melee(step: number): void {
    const p = this.player.snapshot;
    const damage = Math.round(prototype.meleeDamage[step - 1] + this.progress.attackBonus);
    let hits = 0;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const dx = (enemy.x - p.x) * p.facing;
      if (dx < -15 || dx > 95 || Math.abs(enemy.depthY - p.depthY) > 52) continue;
      hits++;
      this.hitEnemy(enemy, damage);
    }
    this.ui.announce(hits ? `第 ${step} 段命中 ${hits} 隻怪物` : `第 ${step} 段揮擊；請靠近怪物並對準縱深`);
  }

  private hitEnemy(enemy: Enemy, damage: number): void {
    if (enemy.hit(damage)) {
      const graphic = this.add.graphics().setDepth(enemy.depthY + 2);
      this.drops.push({ x: enemy.x, y: enemy.depthY, coins: enemy.config.coinDrop,
        points: enemy.config.skillPointDrop, graphic });
      this.drawDrop(this.drops[this.drops.length - 1]);
      if (enemy.boss) {
        const stage = this.level.number;
        // Award Boss drops before the stage changes; otherwise the pickup would disappear.
        const reward = this.drops.pop();
        reward?.graphic.destroy();
        this.progress.collect(enemy.config.coinDrop, enemy.config.skillPointDrop);
        this.finished = true;
        this.progress.clear(stage, this.level.levelUpOnClear);
        this.refreshHud();
        this.ui.announce(stage === 1 ? '哥布林已擊敗！進入第二關' : '小老虎已擊敗！Phase 2 兩關完成');
        this.time.delayedCall(1100, () => {
          if (stage === 1) this.loadStage(2);
        });
      }
    }
  }

  private enemyAttack(enemy: Enemy, pattern: Pattern): void {
    if (!enemy.alive || this.deadPending || this.finished) return;
    const p = this.player.snapshot;
    if (pattern.kind === 'buff') {
      for (const other of this.enemies) if (other.alive && other.config.id === 'wolf' && Math.abs(other.x - enemy.x) < pattern.range) other.buffLeft = 3;
      this.ui.announce('小野狼嚎叫：附近狼群短暫加速攻擊');
      return;
    }
    const direction = p.x >= enemy.x ? 1 : -1;
    if (pattern.kind === 'ranged') {
      this.spawnShot({ x: enemy.x + direction * 34, y: enemy.depthY, elevation: 0, direction,
        damage: pattern.damage, slow: pattern.slowSeconds || 0, owner: 'enemy', power: 0 });
      return;
    }
    if (pattern.kind === 'lunge') enemy.x += direction * 32;
    const range = pattern.range + (pattern.kind === 'wave' ? 10 : 0);
    const canHit = Math.abs(p.x - enemy.x) < range && Math.abs(p.depthY - enemy.depthY) < (pattern.kind === 'wave' ? 95 : 47);
    if (canHit && !(pattern.kind === 'wave' && p.elevation > 20)) this.damagePlayer(pattern.damage, pattern.kind);
    if (pattern.kind === 'combo') this.time.delayedCall(210, () => {
      if (enemy.alive && this.enemies.includes(enemy) && this.level.number === 2 && Math.abs(p.x - enemy.x) < range && Math.abs(p.depthY - enemy.depthY) < 47)
        this.damagePlayer(pattern.damage, pattern.kind);
    });
  }

  private damagePlayer(amount: number, kind: string): void {
    if (this.deadPending || this.finished) return;
    if (kind === 'ranged' && this.player.isCrouching) return;
    const taken = this.player.receiveDamage(amount - this.progress.damageReduction);
    if (taken) this.ui.announce(`受到 ${taken} 傷害；翻滾可避開攻擊`);
    if (this.player.snapshot.hp <= 0) {
      this.deadPending = true;
      this.ui.announce('HP 歸零，從最近啟動的傳送點復活');
      this.time.delayedCall(1100, () => this.revive());
    }
  }

  private revive(): void {
    const cp = this.progress.data.checkpoints[String(this.level.number)];
    this.player.revive(cp ? cp.position + 18 : 120, this.scale.height * .59);
    this.deadPending = false;
    this.clearStage();
    this.loadStage(this.level.number, true);
    this.ui.announce(cp ? `從 ${cp.id} 復活` : '從關卡起點復活');
  }

  private spawnShot(shot: Omit<Shot, 'life' | 'graphic'>): void {
    this.shots.push({ ...shot, life: 0, graphic: this.add.graphics() });
  }

  /** The beam is instantaneous: hit detection happens when charge is released. */
  private fireBeam(x: number, y: number, elevation: number, direction: number, power: number): void {
    const length = Math.min(600, this.scale.width * .82);
    const beam = this.add.image(x + direction * 30, y - elevation - 55, 'player_ki_beam')
      .setOrigin(direction > 0 ? 0 : 1, .5).setFlipX(direction < 0)
      .setDisplaySize(length, 90 + power * 28).setDepth(y + 4);
    const damage = Math.round(20 + power * 12 + this.progress.magicBonus);
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const distance = (enemy.x - x) * direction;
      if (distance >= 0 && distance <= length && Math.abs(enemy.depthY - y) < 54) this.hitEnemy(enemy, damage);
    }
    this.tweens.add({ targets: beam, alpha: 0, duration: 230, onComplete: () => beam.destroy() });
  }

  private updateShots(dt: number): void {
    const p = this.player.snapshot;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const shot = this.shots[i];
      shot.life += dt;
      shot.x += shot.direction * (shot.owner === 'player' ? 380 : 245) * dt;
      const radius = shot.owner === 'player' ? 12 + Math.min(1, shot.life / .65) * (16 + shot.power * 15) : 10;
      shot.graphic.clear();
      shot.graphic.fillStyle(shot.owner === 'player' ? 0xff6ac9 : shot.slow ? 0xa9d0fa : 0xd0c4a4, .3).fillCircle(0, 0, radius + 9);
      shot.graphic.fillStyle(shot.owner === 'player' ? 0xffa9e2 : shot.slow ? 0x6ba9f2 : 0xbbb19c).fillCircle(0, 0, radius);
      shot.graphic.setPosition(shot.x, shot.y - shot.elevation - 36).setDepth(shot.y + 5);
      let collided = false;
      if (shot.owner === 'player') {
        for (const enemy of this.enemies) {
          if (enemy.alive && Math.abs(enemy.x - shot.x) < radius + 23 && Math.abs(enemy.depthY - shot.y) < 54) {
            this.hitEnemy(enemy, shot.damage);
            collided = true;
            break;
          }
        }
      } else if (Math.abs(p.x - shot.x) < radius + 17 && Math.abs(p.depthY - shot.y) < 38) {
        const oldHp = p.hp;
        this.damagePlayer(shot.damage, 'ranged');
        if (shot.slow && p.hp < oldHp) this.slowLeft = shot.slow;
        collided = true;
      }
      if (collided || shot.life > 3 || shot.x < 0 || shot.x > this.level.worldWidth) {
        shot.graphic.destroy();
        this.shots.splice(i, 1);
      }
    }
  }

  private drawDrop(drop: Drop): void {
    const g = drop.graphic;
    g.clear().fillStyle(0xfbd26c, .35).fillCircle(drop.x, drop.y - 21, 24);
    g.fillStyle(0xffd65a).fillCircle(drop.x, drop.y - 21, 11);
    g.fillStyle(0xffffff).fillCircle(drop.x + 4, drop.y - 28, 3);
  }

  private checkDrops(): void {
    const p = this.player.snapshot;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i];
      if (Math.abs(drop.x - p.x) > 45 || Math.abs(drop.y - p.depthY) > 45) continue;
      this.progress.collect(drop.coins, drop.points);
      drop.graphic.destroy();
      this.drops.splice(i, 1);
      this.refreshHud();
      this.ui.announce(`拾取 ${drop.coins} 金錢、${drop.points} 技能點`);
    }
  }

  private checkCheckpoints(): void {
    const p = this.player.snapshot;
    for (const cp of this.level.checkpoints) {
      if (p.x < cp.position || cp.position <= (this.progress.data.checkpoints[String(this.level.number)]?.position || 0)) continue;
      this.progress.checkpoint(this.level.number, cp.id, cp.position);
      this.ui.announce('這是重生點，之後陣亡會從這裡復活');
    }
    this.drawMarkers();
  }

  private refreshHud(): void {
    this.player.setMaximums(this.progress.maxHp, this.progress.maxMp, this.progress.speedBonus);
    this.ui.renderMenu(this.progress, this.level.name);
    this.ui.setMeters(this.player.snapshot.hp, this.player.snapshot.mp, this.player.maxHp, this.player.maxMp);
    this.drawMarkers();
  }

  private drawMarkers(): void {
    const g = this.markers;
    g.clear();
    for (const cp of this.level.checkpoints) {
      const active = cp.position <= (this.progress.data.checkpoints[String(this.level.number)]?.position || 0);
      const y = this.scale.height * .59;
      g.fillStyle(active ? 0x8ff5e0 : 0x9bc8fb, .25).fillEllipse(cp.position, y + 4, 75, 23);
      g.lineStyle(3, active ? 0x92f6da : 0x9bc8fb).strokeEllipse(cp.position, y + 4, 74, 23);
      g.lineStyle(5, active ? 0x92f6da : 0x9bc8fb).lineBetween(cp.position, y - 95, cp.position, y - 9);
      g.fillStyle(active ? 0x92f6da : 0xc5ddff).fillCircle(cp.position, y - 101, 12);
    }
  }

  private layout(): void {
    const w = this.level.worldWidth, h = this.scale.height, g = this.background;
    this.cameras.main.setBounds(0, 0, w, h);
    g.clear();
    const forest = this.level.number === 2;
    g.fillGradientStyle(forest ? 0x203c4f : 0x77aae2, forest ? 0x203c4f : 0x77aae2,
      forest ? 0x5c8675 : 0xc6dcf4, forest ? 0x5c8675 : 0xc6dcf4).fillRect(0, 0, w, h);
    const horizon = h * (h > this.scale.width ? .32 : .40);
    g.fillStyle(forest ? 0x314b3a : 0x7db878).fillRect(0, horizon, w, h - horizon);
    for (let x = 150; x < w; x += forest ? 220 : 320) {
      g.fillStyle(forest ? 0x425f4c : 0x89ba82).fillEllipse(x, horizon - 8, forest ? 110 : 160, forest ? 160 : 48);
      if (forest) {
        g.fillStyle(0x423d3a).fillRect(x - 9, horizon - 120, 18, 127);
        g.fillStyle(0x2a6048).fillCircle(x, horizon - 139, 49);
      }
    }
    g.fillStyle(forest ? 0x708467 : 0xb7c895).fillRect(0, horizon + 25, w, h - horizon - 25);
    for (let x = 0; x < w; x += 150) {
      g.fillStyle(forest ? 0xa0bc87 : 0xf3e4a0, .52).fillCircle(x + 55, h * .75 + x % 41, 3);
    }
    this.drawMarkers();
  }
}
