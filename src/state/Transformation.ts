/** In-game seconds. Cooldown starts when the form ends. */
export class Transformation {
  charge = 0;
  activeLeft = 0;
  cooldownLeft = 0;
  shieldLeft = 0;
  private colorIndex = 0;

  get active(): boolean { return this.activeLeft > 0; }
  get ready(): boolean { return !this.active && this.cooldownLeft <= 0 && this.charge >= 100; }
  get nextColor(): number { return this.colorIndex; }

  gain(amount: number): void {
    if (!this.active && this.cooldownLeft <= 0) this.charge = Math.min(100, this.charge + amount);
  }

  start(): boolean {
    if (!this.ready) return false;
    this.charge = 0;
    this.activeLeft = 20;
    this.shieldLeft = 0;
    this.colorIndex = 0;
    return true;
  }

  castColor(): number {
    const color = this.colorIndex;
    this.colorIndex = (color + 1) % 5;
    return color;
  }

  shield(seconds = 2.2): void { if (this.active) this.shieldLeft = seconds; }

  tick(dt: number): boolean {
    this.shieldLeft = Math.max(0, this.shieldLeft - dt);
    if (this.activeLeft > 0) {
      this.activeLeft = Math.max(0, this.activeLeft - dt);
      if (this.activeLeft < 0.00001) this.activeLeft = 0;
      if (!this.activeLeft) {
        this.cooldownLeft = 60;
        this.shieldLeft = 0;
        return true;
      }
    } else this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
    return false;
  }

  reset(): void {
    this.activeLeft = 0;
    this.cooldownLeft = 0;
    this.shieldLeft = 0;
  }
}
