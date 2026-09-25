export type Pose = 'idle' | 'move' | 'jump' | 'crouch' | 'roll' | 'attack' | 'charge' | 'hurt' | 'dead';

export interface PlayerSnapshot {
  x: number;
  depthY: number;
  elevation: number;
  facing: 1 | -1;
  pose: Pose;
  hp: number;
  mp: number;
  invulnerable: boolean;
  charge: number;
}
