/** Phase 1 test values only. The design documents do not define numeric combat tuning. */
export const prototype = {
  hp: 100,
  mp: 100,
  mpRegenerationPerSecond: 5,
  kiCost: 25,
  chargeThresholdSeconds: 0.24,
  maxChargeSeconds: 1.5,
  walkSpeed: 210,
  depthSpeed: 135,
  rollSpeed: 370,
  rollSeconds: 0.35,
  jumpSpeed: 510,
  gravity: 1180,
  comboWindowSeconds: 0.65,
  meleeDamage: [8, 10, 14] as const,
  dummyHp: 100
} as const;
