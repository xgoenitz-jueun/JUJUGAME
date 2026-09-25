import Phaser from 'phaser';
import stage1 from '../../data/levels/stage1.json';
import stage2 from '../../data/levels/stage2.json';
import stage3 from '../../data/levels/stage3.json';
import stage4 from '../../data/levels/stage4.json';
import stage5 from '../../data/levels/stage5.json';
import stage6 from '../../data/levels/stage6.json';
import { Enemy, ENEMIES, type EnemyConfig, type Pattern } from '../entities/Enemy';
import { Player } from '../entities/Player';
import { prototype } from '../config/prototype';
import { Progression, type Stat } from '../systems/Progression';
import { Controls, type Action } from '../ui/Controls';
import { Transformation } from '../state/Transformation';
import { STATUS_COLORS, STATUS_CONFIG } from '../state/EnemyStatus';

type Level = {
  id: string; number: number; name: string; worldWidth: number; background: string;
  enemyScale?: { hp: number; damage: number; speed: number };
  checkpoints: { id: string; position: number }[];
  spawnTable: { enemyId: string; positions: number[] }[];
  boss: { enemyId: string; position: number };
  levelUpOnClear: number;
};
type Shot = { x: number; y: number; elevation: number; direction: number; damage: number;
  slow: number; seal: number; owner: 'enemy' | 'player'; power: number; life: number; graphic: Phaser.GameObjects.Graphics;
  element?: 'fire' | 'ice' | 'lightning' | 'dark' };
type Drop = { x: number; y: number; coins: number; points: number; graphic: Phaser.GameObjects.Graphics };
type Hazard = { x: number; y: number; radius: number; left: number; tick: number; graphic: Phaser.GameObjects.Graphics };
const LEVELS: Record<number, Level> = { 1: stage1, 2: stage2, 3: stage3, 4: stage4, 5: stage5, 6: stage6 };
const COLORS = [0xff814c, 0x60cfff, 0xf7de69, 0x8ed976, 0xe992f5];

/** JSON drives enemy stats, layouts, checkpoints and shop items. */
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
  private hazards: Hazard[] = [];
  private form = new Transformation();
  private stormGauge = 0;
  private lightningGauge = 0;
  private darkFlameTimer = 0;
  private darkFlameWarning = 0;
  private darkFlameBoss: Enemy | null = null;
  private darkWarningVisual: Phaser.GameObjects.Image | null = null;
  private stormCooldown = 0;
  private meteorUsed = false;
  private specialLock = 0;
  private sealLeft = 0;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private slowLeft = 0;
  private deadPending = false;
  private finished = false;
  private stageSlimeKills = 0;

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
    for (const name of ['player_transform_idle', 'player_transform_jump', 'player_transform_crouch', 'player_transform_roll']) {
      const idle = name.endsWith('idle');
      this.load.spritesheet(name, url(name), { frameWidth: idle ? 220 : 260, frameHeight: idle ? 270 : 290 });
    }
    for (const name of ['blue_storm_front', 'blue_storm_back', 'blue_storm_left', 'blue_storm_right',
      'super_lightning_blue', 'super_lightning_gold', 'final_boss_dark_flame',
      'transform_five_color_magic', 'transform_absolute_defense', 'transform_meteor_rain']) this.load.image(name, url(name));
    for (const config of Object.values(ENEMIES)) this.load.image(config.id, `${import.meta.env.BASE_URL}${config.spriteRef}`);
    if (ENEMIES.final_boss.phaseTwoSpriteRef)
      this.load.image('final_boss_phase2', `${import.meta.env.BASE_URL}${ENEMIES.final_boss.phaseTwoSpriteRef}`);
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
      this.keys = keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,J,G,K,L,C,B,T,F,H,M,V') as Record<string, Phaser.Input.Keyboard.Key>;
      const bindings: Record<string, Action> = { J: 'attack', G: 'ki', K: 'jump', L: 'roll', C: 'crouch',
        B: 'storm', T: 'transform', F: 'color', H: 'shield', M: 'meteor', V: 'lightning' };
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
    this.stageSlimeKills = 0;
    this.ui.hideVictory();
    this.deadPending = false;
    this.slowLeft = 0;
    this.sealLeft = 0;
    this.stormGauge = 0;
    this.lightningGauge = 0;
    this.darkFlameTimer = 0;
    this.darkFlameWarning = 0;
    this.darkFlameBoss = null;
    this.stormCooldown = 0;
    this.form.reset();
    this.meteorUsed = false;
    this.player.setTransformed(false);
    const cp = resume ? this.progress.data.checkpoints[String(number)] : undefined;
    const startX = cp ? cp.position + 18 : 120;
    this.player.setMaximums(this.progress.maxHp, this.progress.maxMp, this.progress.speedBonus);
    this.player.revive(startX, this.scale.height * .59);
    for (const wave of this.level.spawnTable) {
      wave.positions.forEach((x, index) => {
        if (cp && x < cp.position - 70) return;
        this.enemies.push(new Enemy(this, this.enemyConfig(wave.enemyId), x, this.depthFor(index),
          (enemy, pattern) => this.enemyAttack(enemy, pattern),
          (enemy, damage) => this.hitEnemy(enemy, damage, false)));
      });
    }
    this.enemies.push(new Enemy(this, ENEMIES[this.level.boss.enemyId], this.level.boss.position, this.scale.height * .59,
      (enemy, pattern) => this.enemyAttack(enemy, pattern),
      (enemy, damage) => this.hitEnemy(enemy, damage, false)));
    this.cameras.main.setBounds(0, 0, this.level.worldWidth, this.scale.height);
    this.layout();
    this.refreshHud();
    this.ui.announce(`${this.level.name}：擊敗怪物、啟動傳送點，再挑戰 Boss`);
    if (number === 1) this.ui.showTutorial('move', '拖曳左側搖桿上下左右移動，調整縱深對準怪物。', 'move-zone');
  }

  private depthFor(index: number): number { return this.scale.height * (.54 + (index % 3 - 1) * .065); }

  private enemyConfig(id: string): EnemyConfig {
    const base = ENEMIES[id];
    const scale = this.level.enemyScale;
    if (!scale || base.type === 'boss') return base;
    return { ...base, hp: Math.round(base.hp * scale.hp), speed: Math.round(base.speed * scale.speed),
      patterns: base.patterns.map(pattern => ({ ...pattern, damage: Math.round(pattern.damage * scale.damage) })) };
  }

  private clearStage(): void {
    this.darkWarningVisual?.destroy();
    this.darkWarningVisual = null;
    this.enemies.forEach(enemy => enemy.destroy());
    this.shots.forEach(shot => shot.graphic.destroy());
    this.drops.forEach(drop => drop.graphic.destroy());
    this.hazards.forEach(hazard => hazard.graphic.destroy());
    this.enemies = [];
    this.shots = [];
    this.drops = [];
    this.hazards = [];
  }

  private action(action: Action, pressed: boolean): void {
    if (this.deadPending || this.finished) return;
    if (pressed && action === 'storm') this.blueStorm();
    else if (pressed && action === 'lightning') this.superLightning();
    else if (pressed && action === 'transform') this.transform();
    else if (pressed && action === 'color') this.fiveColor();
    else if (pressed && action === 'shield') this.absoluteDefense();
    else if (pressed && action === 'meteor') this.meteorRain();
    else if (this.form.active && action === 'ki' && pressed) this.fiveColor();
    else if (this.form.active && action === 'ki') return;
    else if (this.sealLeft > 0 && action === 'ki') { if (pressed) this.ui.announce('詛咒暫時封鎖技能'); }
    if (action === 'attack' || action === 'ki') {
      if (action === 'attack' || (!this.form.active && this.sealLeft <= 0)) {
        if (pressed) this.player.beginAttack(action); else this.player.endAttack(action);
      }
    } else if (action === 'jump' && pressed) this.player.jump();
    else if (action === 'roll' && pressed) this.player.roll(this.moveX());
    else if (action === 'crouch') this.player.setCrouch(pressed);
  }

  private menuAction(command: string, id: string): void {
    if (command === 'travel') {
      const stage = Number(id);
      if ((stage === 5 || stage === 6) && this.progress.data.cleared >= stage - 1) {
        this.progress.selectStage(stage);
        this.loadStage(stage, true);
      }
      return;
    }
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
    this.sealLeft = Math.max(0, this.sealLeft - dt);
    this.stormCooldown = Math.max(0, this.stormCooldown - dt);
    this.specialLock = Math.max(0, this.specialLock - dt);
    if (this.form.tick(dt)) {
      this.player.setTransformed(false);
      this.ui.announce('變身結束，60 秒後可重新集滿量表');
    }
    this.player.protected = this.form.shieldLeft > 0;
    const firstAliveX = Math.min(...this.enemies.filter(enemy => enemy.alive).map(enemy => enemy.x));
    const barrier = Number.isFinite(firstAliveX) ? Math.min(this.level.worldWidth, firstAliveX + 155) : this.level.worldWidth;
    this.player.update(dt, this.deadPending || this.finished ? 0 : this.moveX() * (this.slowLeft > 0 ? .55 : 1),
      this.deadPending || this.finished ? 0 : this.moveY() * (this.slowLeft > 0 ? .55 : 1), {
        width: barrier,
        near: this.scale.height * (this.scale.height > this.scale.width ? .35 : .44),
        far: this.scale.height * (this.scale.height > this.scale.width ? .78 : .82)
      });
    this.cameras.main.scrollX = Phaser.Math.Clamp(p.x - this.scale.width * .30, 0,
      Math.max(0, this.level.worldWidth - this.scale.width));
    if (!this.deadPending && !this.finished) {
      this.updateTutorials();
      for (const enemy of this.enemies) enemy.update(dt, p);
      this.updateDarkFlame(dt);
      this.checkCheckpoints();
      this.checkDrops();
      this.updateShots(dt);
      this.updateHazards(dt);
    }
    this.ui.setMeters(p.hp, p.mp, this.player.maxHp, this.player.maxMp);
    this.ui.setSkills(this.stormGauge, this.form, this.lightningGauge);
    const boss = this.enemies.find(enemy => enemy.boss && enemy.alive);
    const camera = this.cameras.main;
    this.ui.setBossHealth(boss && boss.x >= camera.scrollX - 30 && boss.x <= camera.scrollX + camera.width + 30
      ? { name: boss.phaseTwo ? `${boss.config.displayName} · 惡魔形態` : boss.config.displayName,
          hp: boss.hp, maxHp: boss.maxHp } : null);
  }

  private updateTutorials(): void {
    if (this.level.number === 1) {
      const p = this.player.snapshot;
      const firstSlime = this.enemies.find(enemy => enemy.config.id === 'slime' && enemy.alive);
      if (firstSlime && Math.abs(firstSlime.x - p.x) < 420)
        this.ui.showTutorial('attack', '遇到史萊姆了！點按「攻擊」使出三段連擊。', 'attack');
      if (this.stageSlimeKills >= 2)
        this.ui.showTutorial('ki', '已擊敗數隻史萊姆。按住「氣功」蓄力，放開後瞬間射出粉紅光束；也可長按「攻擊」。', 'ki');
      const boss = this.enemies.find(enemy => enemy.boss && enemy.alive);
      if (boss && boss.x - p.x < 680) {
        this.ui.showTutorial('storm', 'Boss 就在前方！藍色風暴量表滿格發光時，按「風暴」向四方擴散。', 'storm');
      }
      if (this.form.ready && boss && boss.x - p.x < 1100)
        this.ui.showTutorial('transform', '變身量表已滿！按「變身」切換白蝶造型，持續 20 秒。', 'transform');
    } else if (this.level.number === 2 && this.form.ready) {
      this.ui.showTutorial('transform', '變身量表已滿！按「變身」切換白蝶造型，持續 20 秒。', 'transform');
    }
  }

  private melee(step: number): void {
    const p = this.player.snapshot;
    const damage = Math.round((prototype.meleeDamage[step - 1] + this.progress.attackBonus) * (this.form.active ? 2 : 1));
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

  private hitEnemy(enemy: Enemy, damage: number, gainGauge = true): boolean {
    if (!enemy.alive) return false;
    const before = enemy.hp;
    if (enemy.hit(damage)) {
      if (this.level.number === 1 && enemy.config.id === 'slime') this.stageSlimeKills++;
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
        if (stage >= 5) {
          this.ui.showVictory(stage, () => {
            if (stage === 6) this.progress.selectStage(6);
            this.loadStage(6);
          });
        } else {
          this.ui.announce(`${enemy.config.displayName}已擊敗！進入下一關`);
          this.time.delayedCall(1100, () => this.loadStage(stage + 1));
        }
      }
    }
    if (gainGauge && enemy.hp < before) {
      this.stormGauge = Math.min(100, this.stormGauge + (enemy.boss ? 8 : 17));
      this.lightningGauge = Math.min(100, this.lightningGauge + (enemy.boss ? 5 : 11));
      this.form.gain(enemy.boss ? 11 : 19);
    }
    if (enemy.phaseJustChanged) {
      enemy.phaseJustChanged = false;
      this.darkFlameBoss = enemy;
      this.darkFlameTimer = enemy.config.phaseTwo?.darkFlameIntervalSeconds || 50;
      this.ui.announce('終極 Boss 惡魔化！生命值翻倍，黑紫火焰即將週期性襲來');
      this.cameras.main.flash(450, 136, 55, 180);
    }
    return enemy.hp < before;
  }

  private blueStorm(): void {
    if (this.form.active) return this.ui.announce('變身期間請使用五色魔法、絕對防禦與流星雨');
    if (this.sealLeft > 0 || this.stormGauge < 100 || this.stormCooldown > 0) {
      this.ui.announce(this.sealLeft > 0 ? '詛咒暫時封鎖技能' : '藍色風暴量表尚未集滿');
      return;
    }
    this.stormGauge = 0;
    this.stormCooldown = 2.5;
    const p = this.player.snapshot;
    const directions = [
      { key: 'blue_storm_front', dx: 0, dy: 95 }, { key: 'blue_storm_back', dx: 0, dy: -95 },
      { key: 'blue_storm_left', dx: -175, dy: 0 }, { key: 'blue_storm_right', dx: 175, dy: 0 }
    ];
    // Four different directional illustrations grow and travel out together.
    for (const { key, dx, dy } of directions) {
      const img = this.add.image(p.x, p.depthY - 50, key).setAlpha(.92).setDisplaySize(50, 50).setDepth(p.depthY + 20);
      this.tweens.add({ targets: img, x: p.x + dx, y: p.depthY - 50 + dy, displayWidth: 230,
        displayHeight: 175, alpha: 0, duration: 480, onComplete: () => img.destroy() });
    }
    for (const enemy of this.enemies) {
      if (enemy.alive && Math.abs(enemy.x - p.x) < 260 && Math.abs(enemy.depthY - p.depthY) < 155)
        this.hitEnemy(enemy, Math.round(55 + this.progress.magicBonus * 1.5));
    }
    this.ui.announce('藍色風暴：前、後、左、右同時擴散！');
  }

  private superLightning(): void {
    if (this.form.active) return this.ui.announce('變身期間使用五色魔法、絕對防禦與流星雨');
    if (this.sealLeft > 0 || this.lightningGauge < 100) {
      this.ui.announce(this.sealLeft > 0 ? '詛咒暫時封鎖技能' : '全屏閃電量表尚未集滿');
      return;
    }
    this.lightningGauge = 0;
    const camera = this.cameras.main;
    for (let i = 0; i < 7; i++) {
      const image = this.add.image(camera.width / 2, camera.height / 2,
        i % 2 ? 'super_lightning_gold' : 'super_lightning_blue')
        .setScrollFactor(0).setDisplaySize(camera.width, camera.height)
        .setAlpha(0).setDepth(11000);
      this.tweens.add({ targets: image, alpha: { from: 0, to: .83 }, yoyo: true,
        duration: 85, delay: i * 160, onComplete: () => image.destroy() });
    }
    // The entire active screen is struck; offscreen foes remain untouched.
    for (const enemy of [...this.enemies]) {
      if (enemy.alive && enemy.x >= camera.scrollX && enemy.x <= camera.scrollX + camera.width)
        this.hitEnemy(enemy, Math.round(240 + this.progress.magicBonus * 2.2), false);
    }
    this.ui.announce('全屏閃電！藍金交錯，消耗獨立大招槽（不消耗 MP）');
  }

  private updateDarkFlame(dt: number): void {
    const boss = this.darkFlameBoss;
    const config = boss?.config.phaseTwo;
    if (!boss?.alive || !boss.phaseTwo || !config) return;
    if (this.darkFlameWarning > 0) {
      this.darkFlameWarning = Math.max(0, this.darkFlameWarning - dt);
      if (this.darkFlameWarning === 0) {
        this.darkWarningVisual?.destroy();
        this.darkWarningVisual = null;
        const image = this.add.image(this.scale.width / 2, this.scale.height / 2, 'final_boss_dark_flame')
          .setScrollFactor(0).setDisplaySize(this.scale.width, this.scale.height).setDepth(12000).setAlpha(.85);
        this.tweens.add({ targets: image, alpha: 0, duration: 700, onComplete: () => image.destroy() });
        // Fixed maximum-HP hit; rolling and Absolute Defense both avoid it.
        const amount = Math.round(this.player.maxHp * config.darkFlameMaxHpRatio);
        const taken = this.player.receiveDamage(amount);
        if (taken) {
          this.ui.announce(`黑紫火焰造成 ${taken} 傷害（血量上限的 30%）`);
          if (this.player.snapshot.hp <= 0) {
            this.deadPending = true;
            this.time.delayedCall(1100, () => this.revive());
          }
        } else this.ui.announce('成功用翻滾或絕對防禦避開黑紫火焰！');
        this.darkFlameTimer = config.darkFlameIntervalSeconds;
      }
      return;
    }
    this.darkFlameTimer -= dt;
    if (this.darkFlameTimer <= 0) {
      this.darkFlameWarning = config.darkFlameWarningSeconds;
      this.darkWarningVisual = this.add.image(this.scale.width / 2, this.scale.height / 2,
        'final_boss_dark_flame').setScrollFactor(0).setDisplaySize(this.scale.width, this.scale.height)
        .setDepth(11000).setAlpha(.18);
      this.tweens.add({ targets: this.darkWarningVisual, alpha: .42, duration: 260, yoyo: true, repeat: 2 });
      this.ui.announce('黑紫火焰預警！倒數後全屏攻擊：翻滾或絕對防禦！');
      this.cameras.main.flash(450, 115, 34, 139);
    }
  }

  private transform(): void {
    if (this.sealLeft > 0) return this.ui.announce('詛咒暫時封鎖變身');
    if (!this.form.start()) return this.ui.announce(this.form.cooldownLeft > 0 ?
      `變身冷卻 ${Math.ceil(this.form.cooldownLeft)} 秒` : '變身量表尚未集滿');
    this.player.setTransformed(true);
    this.meteorUsed = false;
    const p = this.player.snapshot;
    const ring = this.add.graphics().lineStyle(6, 0xf6e6ff, .85).strokeCircle(0, 0, 56)
      .setPosition(p.x, p.depthY - 55).setDepth(p.depthY + 8);
    this.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 620, onComplete: () => ring.destroy() });
    this.ui.announce('變身啟動！20 秒內使用五色魔法、絕對防禦、流星雨');
  }

  private fiveColor(): void {
    if (!this.form.active || this.sealLeft > 0 || this.specialLock > 0) return;
    const p = this.player.snapshot;
    if (p.mp < 12) return this.ui.announce('MP 不足，無法施放五色魔法');
    p.mp -= 12;
    this.specialLock = .3;
    const index = this.form.castColor();
    const color = STATUS_COLORS[index];
    const shot = this.add.image(p.x + p.facing * 55, p.depthY - 58, 'transform_five_color_magic')
      .setDisplaySize(155, 85).setTint(COLORS[index]).setFlipX(p.facing < 0).setDepth(p.depthY + 8);
    this.tweens.add({ targets: shot, x: shot.x + p.facing * 275, alpha: 0, duration: 380,
      onComplete: () => shot.destroy() });
    for (const enemy of this.enemies) {
      const distance = (enemy.x - p.x) * p.facing;
      if (enemy.alive && distance > -15 && distance < 350 && Math.abs(enemy.depthY - p.depthY) < 75 &&
        this.hitEnemy(enemy, Math.round((32 + this.progress.magicBonus) * 2))) enemy.applyStatus(color);
    }
    this.ui.announce(`五色魔法：${['紅', '藍', '黃', '綠', '紫'][index]}色 · ${STATUS_CONFIG[color].name}`);
  }

  private absoluteDefense(): void {
    if (!this.form.active || this.sealLeft > 0 || this.specialLock > 0) return;
    if (this.player.snapshot.mp < 30) return this.ui.announce('MP 不足，無法使用絕對防禦');
    this.player.snapshot.mp -= 30;
    this.specialLock = .5;
    this.form.shield();
    this.player.protected = true;
    const p = this.player.snapshot;
    const shield = this.add.image(p.x, p.depthY - 54, 'transform_absolute_defense')
      .setDisplaySize(175, 175).setAlpha(.75).setDepth(p.depthY + 9);
    this.tweens.add({ targets: shield, alpha: .38, yoyo: true, repeat: 5, duration: 180,
      onComplete: () => shield.destroy() });
    this.ui.announce('絕對防禦：短時間內免疫傷害');
  }

  private meteorRain(): void {
    if (!this.form.active || this.sealLeft > 0 || this.meteorUsed || this.specialLock > 0) return;
    if (this.player.snapshot.mp < 55) return this.ui.announce('MP 不足，無法施放流星雨');
    this.player.snapshot.mp -= 55;
    this.meteorUsed = true;
    this.specialLock = .6;
    const camera = this.cameras.main;
    const image = this.add.image(camera.scrollX + camera.width / 2, camera.height / 2,
      'transform_meteor_rain').setDisplaySize(camera.width, camera.height).setScrollFactor(0).setAlpha(.9).setDepth(10000);
    this.tweens.add({ targets: image, alpha: 0, duration: 850, onComplete: () => image.destroy() });
    for (const enemy of this.enemies) {
      if (enemy.alive && enemy.x >= camera.scrollX && enemy.x <= camera.scrollX + camera.width)
        this.hitEnemy(enemy, Math.round((105 + this.progress.magicBonus) * 2));
    }
    this.ui.announce('流星雨：攻擊目前畫面內全部敵人');
  }

  private enemyAttack(enemy: Enemy, pattern: Pattern): void {
    if (!enemy.alive || this.deadPending || this.finished) return;
    const p = this.player.snapshot;
    if (pattern.kind === 'buff') {
      for (const other of this.enemies) if (other.alive && other.config.id === 'wolf' && Math.abs(other.x - enemy.x) < pattern.range) other.buffLeft = 3;
      this.ui.announce('小野狼嚎叫：附近狼群短暫加速攻擊');
      return;
    }
    if (pattern.kind === 'summon') {
      if (enemy.hp / enemy.maxHp < .4 && !enemy.summoned) {
        enemy.summoned = true;
        for (const side of [-1, 1]) this.enemies.push(new Enemy(this, ENEMIES.ghost,
          Math.max(90, enemy.x + side * 125), enemy.depthY + side * 25,
          (target, attack) => this.enemyAttack(target, attack),
          (target, damage) => this.hitEnemy(target, damage, false)));
        this.ui.announce('小殭屍召喚兩隻小幽靈！');
      }
      return;
    }
    const direction = p.x >= enemy.x ? 1 : -1;
    if (pattern.kind === 'ranged') {
      if (this.level.number === 1)
        this.ui.showTutorial('dodge', '遠程攻擊來了！按「翻滾」閃避，或按住「蹲下」躲開飛來的彈幕。', 'roll');
      this.spawnShot({ x: enemy.x + direction * 34, y: enemy.depthY, elevation: 0, direction,
        damage: pattern.damage, slow: pattern.slowSeconds || 0, seal: pattern.sealSeconds || 0,
        owner: 'enemy', power: 0, element: pattern.element });
      return;
    }
    if (pattern.kind === 'fire') {
      const flame = this.add.graphics().setDepth(enemy.depthY + 7);
      flame.fillStyle(0xff6b25, .5).fillRoundedRect(direction > 0 ? enemy.x : enemy.x - pattern.range,
        enemy.depthY - 79, pattern.range, 86, 24);
      this.tweens.add({ targets: flame, alpha: 0, duration: 550, onComplete: () => flame.destroy() });
      if (Math.abs(p.x - enemy.x) < pattern.range && (p.x - enemy.x) * direction >= 0 &&
        Math.abs(p.depthY - enemy.depthY) < 50) this.damagePlayer(pattern.damage, 'fire');
      return;
    }
    if (pattern.kind === 'dive') {
      const markX = p.x, markY = p.depthY;
      const marker = this.add.graphics().setDepth(markY - 1).lineStyle(5, 0xff655c, .9)
        .strokeEllipse(markX, markY, 135, 76);
      this.time.delayedCall(650, () => {
        marker.destroy();
        if (!enemy.alive || this.finished || this.deadPending || !this.enemies.includes(enemy)) return;
        enemy.x = Phaser.Math.Clamp(markX + direction * 35, 0, this.level.worldWidth);
        enemy.depthY = markY;
        if (Math.abs(p.x - markX) < 72 && Math.abs(p.depthY - markY) < 45)
          this.damagePlayer(pattern.damage, 'dive');
      });
      return;
    }
    if (pattern.kind === 'phase') {
      enemy.phase(.65);
      enemy.x += direction * Math.min(130, Math.abs(p.x - enemy.x));
    }
    if (pattern.kind === 'poison') {
      const graphic = this.add.graphics().setDepth(p.depthY - 1);
      this.hazards.push({ x: p.x, y: p.depthY, radius: 88, left: 4, tick: .5, graphic });
      this.ui.announce('毒霧出現，離開綠色範圍！');
      return;
    }
    if (pattern.kind === 'laser') {
      const beam = this.add.graphics().setDepth(enemy.depthY + 7)
        .lineStyle(10, 0xe47aff, .75)
        .lineBetween(enemy.x, enemy.depthY - 56, enemy.x + direction * pattern.range, enemy.depthY - 56);
      this.tweens.add({ targets: beam, alpha: 0, duration: 450, onComplete: () => beam.destroy() });
    }
    if (pattern.kind === 'lunge' && enemy.config.id === 'orc') {
      let hit = false;
      enemy.beginLunge(direction, 165, 240, (from, to) => {
        if (hit || this.deadPending || this.finished) return;
        const target = this.player.snapshot;
        if (target.x >= Math.min(from, to) - 45 && target.x <= Math.max(from, to) + 45 &&
          Math.abs(target.depthY - enemy.depthY) < 47) {
          hit = true;
          this.damagePlayer(pattern.damage, 'lunge');
        }
      });
      return;
    }
    if (pattern.kind === 'lunge') enemy.x += direction * 32;
    const range = pattern.range + (pattern.kind === 'wave' ? 10 : 0);
    const canHit = Math.abs(p.x - enemy.x) < range && Math.abs(p.depthY - enemy.depthY) <
      (pattern.kind === 'wave' ? 95 : pattern.kind === 'laser' ? 38 : 47);
    if (canHit && !(pattern.kind === 'wave' && p.elevation > 20)) this.damagePlayer(pattern.damage, pattern.kind);
    if (pattern.kind === 'combo' || pattern.kind === 'grab') this.time.delayedCall(260, () => {
      if (enemy.alive && this.enemies.includes(enemy) && !this.deadPending && !this.finished &&
        Math.abs(p.x - enemy.x) < range && Math.abs(p.depthY - enemy.depthY) < 47)
        this.damagePlayer(pattern.damage, pattern.kind);
    });
  }

  private damagePlayer(amount: number, kind: string): void {
    if (this.deadPending || this.finished) return;
    if (kind === 'ranged' && this.player.isCrouching) return;
    const taken = this.player.receiveDamage(amount - this.progress.damageReduction * (this.form.active ? 2 : 1));
    if (taken) this.ui.announce(`受到 ${taken} 傷害；翻滾可避開攻擊`);
    if (taken) this.form.gain(5);
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
      const color = shot.element === 'fire' ? 0xff782d : shot.element === 'ice' ? 0x6bbded :
        shot.element === 'lightning' ? 0xffdd69 : shot.element === 'dark' ? 0x9a63d7 : 0xffa9e2;
      shot.graphic.fillStyle(color, .3).fillCircle(0, 0, radius + 9);
      shot.graphic.fillStyle(color).fillCircle(0, 0, radius);
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
        if (shot.seal && p.hp < oldHp) this.sealLeft = shot.seal;
        collided = true;
      }
      if (collided || shot.life > 3 || shot.x < 0 || shot.x > this.level.worldWidth) {
        shot.graphic.destroy();
        this.shots.splice(i, 1);
      }
    }
  }

  private updateHazards(dt: number): void {
    const p = this.player.snapshot;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const hazard = this.hazards[i];
      hazard.left -= dt;
      hazard.tick -= dt;
      hazard.graphic.clear().fillStyle(0x80be65, .38).fillEllipse(hazard.x, hazard.y, hazard.radius * 2, 65);
      hazard.graphic.lineStyle(2, 0xd9eb91, .7).strokeEllipse(hazard.x, hazard.y, hazard.radius * 2, 65);
      if (hazard.tick <= 0) {
        hazard.tick = .8;
        if (Math.abs(p.x - hazard.x) < hazard.radius && Math.abs(p.depthY - hazard.y) < 34)
          this.damagePlayer(8, 'poison');
      }
      if (hazard.left <= 0) { hazard.graphic.destroy(); this.hazards.splice(i, 1); }
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
      this.ui.showTutorial('shop', '拾取金錢與技能點！打開「背包／商店」購買補給、裝備並分配素質。', 'menu-toggle');
    }
  }

  private checkCheckpoints(): void {
    const p = this.player.snapshot;
    for (const cp of this.level.checkpoints) {
      if (p.x < cp.position || cp.position <= (this.progress.data.checkpoints[String(this.level.number)]?.position || 0)) continue;
      this.progress.checkpoint(this.level.number, cp.id, cp.position);
      this.ui.announce('這是重生點，之後陣亡會從這裡復活');
      this.ui.showTutorial('checkpoint', '已啟動傳送點！陣亡後會從最近啟動的位置復活。');
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
    const grave = this.level.number === 3;
    const camp = this.level.number === 4;
    const lair = this.level.number === 5;
    const heaven = this.level.number === 6;
    const sky = heaven ? 0x466cba : lair ? 0x462338 : grave ? 0x27324f : camp ? 0x945c48 : forest ? 0x203c4f : 0x77aae2;
    const horizonColor = heaven ? 0xe7c7fa : lair ? 0xa44844 : grave ? 0x717b86 : camp ? 0xd69b68 : forest ? 0x5c8675 : 0xc6dcf4;
    g.fillGradientStyle(sky, sky, horizonColor, horizonColor).fillRect(0, 0, w, h);
    const horizon = h * (h > this.scale.width ? .32 : .40);
    g.fillStyle(heaven ? 0xa8b9e5 : lair ? 0x332d40 : grave ? 0x404858 : camp ? 0x6b5247 : forest ? 0x314b3a : 0x7db878).fillRect(0, horizon, w, h - horizon);
    for (let x = 150; x < w; x += forest ? 220 : 320) {
      g.fillStyle(heaven ? 0xeaf3ff : lair ? 0x704755 : grave ? 0x626d79 : camp ? 0x97715b : forest ? 0x425f4c : 0x89ba82)
        .fillEllipse(x, horizon - 8, forest ? 110 : 160, forest ? 160 : 48);
      if (forest) {
        g.fillStyle(0x423d3a).fillRect(x - 9, horizon - 120, 18, 127);
        g.fillStyle(0x2a6048).fillCircle(x, horizon - 139, 49);
      } else if (grave) {
        g.fillStyle(0x939ba3).fillRoundedRect(x - 15, horizon - 55, 30, 55, 12);
        g.fillStyle(0x323849).fillRect(x - 3, horizon - 42, 6, 26).fillRect(x - 10, horizon - 35, 20, 5);
        g.lineStyle(3, 0x303b4b).lineBetween(x + 72, horizon - 105, x + 78, horizon + 2);
      } else if (heaven) {
        g.fillStyle(0xffffff, .65).fillEllipse(x + 35, horizon - 85, 240, 42);
        g.lineStyle(4, 0xf4e6ba).lineBetween(x - 28, horizon - 5, x + 35, horizon - 100);
      } else if (lair) {
        g.fillStyle(0x251b32).fillTriangle(x - 65, horizon + 5, x, horizon - 135, x + 70, horizon + 5);
        g.fillStyle(0xff653b, .7).fillEllipse(x + 104, horizon + 3, 40, 18);
      } else if (camp) {
        g.fillStyle(0x593f37).fillTriangle(x - 52, horizon + 7, x, horizon - 84, x + 55, horizon + 7);
        g.lineStyle(3, 0xd0a280).lineBetween(x, horizon - 84, x, horizon + 5);
        g.fillStyle(0xe9964b, .65).fillCircle(x + 90, horizon - 9, 12);
      }
    }
    g.fillStyle(heaven ? 0xd3d9e9 : lair ? 0x4c3641 : grave ? 0x63645b : camp ? 0xa48561 : forest ? 0x708467 : 0xb7c895)
      .fillRect(0, horizon + 25, w, h - horizon - 25);
    for (let x = 0; x < w; x += 150) {
      g.fillStyle(heaven ? 0xffffff : lair ? 0xff8e50 : grave ? 0xb7b8bc : camp ? 0xf3ba75 : forest ? 0xa0bc87 : 0xf3e4a0, .52)
        .fillCircle(x + 55, h * .75 + x % 41, 3);
    }
    this.drawMarkers();
  }
}
