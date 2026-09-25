import Phaser from 'phaser';

/** Phase 0: verifies that a Phaser scene can start; gameplay begins in Phase 1. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    // Intentionally empty until the Phase 1 prototype.
  }
}
