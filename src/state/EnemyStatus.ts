import statusData from '../../data/progression/five-color-status.json';

export const STATUS_COLORS = ['red', 'blue', 'yellow', 'green', 'purple'] as const;
export type StatusColor = typeof STATUS_COLORS[number];
type StatusConfig = { name: string; duration: number; damagePerTick?: number; tickSeconds?: number; moveMultiplier?: number };
export const STATUS_CONFIG: Record<StatusColor, StatusConfig> = statusData;

/** Timers use game seconds, so status damage and control stay independent of frame rate. */
export class EnemyStatus {
  private effects = new Map<StatusColor, { left: number; tick: number }>();

  get active(): StatusColor[] { return STATUS_COLORS.filter(color => this.effects.has(color)); }
  has(color: StatusColor): boolean { return this.effects.has(color); }
  get moveMultiplier(): number {
    if (this.has('purple') || this.has('blue')) return 0;
    return this.has('yellow') ? STATUS_CONFIG.yellow.moveMultiplier! : 1;
  }
  get canAttack(): boolean { return !this.has('purple') && !this.has('yellow') && !this.has('blue'); }

  apply(color: StatusColor): void {
    // Reapplying the same color refreshes its duration; it cannot stack unbounded damage.
    // Keep the existing tick timer so rapid hits cannot postpone the next damage tick.
    this.effects.set(color, { left: STATUS_CONFIG[color].duration,
      tick: this.effects.get(color)?.tick ?? 0 });
  }

  update(dt: number, damage: (amount: number) => void): void {
    for (const [color, state] of this.effects) {
      const config = STATUS_CONFIG[color];
      const elapsed = Math.min(Math.max(0, dt), state.left);
      state.left -= elapsed;
      if (config.tickSeconds && config.damagePerTick) {
        const total = state.tick + elapsed;
        const ticks = Math.floor((total + 1e-9) / config.tickSeconds);
        state.tick = Math.max(0, total - ticks * config.tickSeconds);
        for (let i = 0; i < ticks; i++) damage(config.damagePerTick);
      }
      if (state.left <= 0) this.effects.delete(color);
    }
  }
}
