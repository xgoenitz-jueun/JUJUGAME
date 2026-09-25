import statsData from '../../data/progression/stats.json';
import stage1Shop from '../../data/shop/stage1.json';
import stage2Shop from '../../data/shop/stage2.json';
import stage3Shop from '../../data/shop/stage3.json';
import stage4Shop from '../../data/shop/stage4.json';

export type Stat = 'STR' | 'DEF' | 'MAGIC' | 'SPD' | 'VIT';
export type Slot = 'weapon' | 'armor' | 'accessory';
export type ShopItem = {
  id: string; name: string; type: 'consumable' | 'equipment'; price: number;
  healAmount?: number; slot?: Slot; strBonus?: number; defBonus?: number; vitBonus?: number;
};
export interface SaveData {
  stage: number; level: number; cleared: number; coins: number; earned: number;
  stats: Record<Stat, number>; consumables: Record<string, number>;
  ownedEquipment: string[]; equipped: Partial<Record<Slot, string>>;
  checkpoints: Record<string, { id: string; position: number }>;
}
const KEY = 'juju-game-v2-phase2';
const STATS: Stat[] = ['STR', 'DEF', 'MAGIC', 'SPD', 'VIT'];

function fresh(): SaveData {
  return { stage: 1, level: 3, cleared: 0, coins: 0, earned: 0,
    stats: { STR: 0, DEF: 0, MAGIC: 0, SPD: 0, VIT: 0 },
    consumables: {}, ownedEquipment: [], equipped: {}, checkpoints: {} };
}

export class Progression {
  data: SaveData;
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'>) {
    this.data = fresh();
    try {
      const value = JSON.parse(storage.getItem(KEY) || 'null') as Partial<SaveData> | null;
      if (value && [1, 2, 3, 4, 5, 6].includes(value.stage || 0)) {
        this.data = { ...fresh(), ...value, stats: { ...fresh().stats, ...value.stats },
          consumables: value.consumables || {}, checkpoints: value.checkpoints || {},
          ownedEquipment: value.ownedEquipment || [], equipped: value.equipped || {} };
        // An older Phase 2 save kept stage=2 after its Boss was defeated.
        if (this.data.stage <= 4) this.data.stage = Math.min(6, Math.max(this.data.stage, this.data.cleared + 1));
      }
    } catch { /* Corrupt local data starts a new local run. */ }
  }

  save(): void { this.storage.setItem(KEY, JSON.stringify(this.data)); }
  get unspent(): number { return Math.max(0, this.data.earned - STATS.reduce((sum, stat) => sum + this.data.stats[stat], 0)); }
  get maxHp(): number { return 100 + this.data.stats.VIT * statsData.pointValuePerStat.VIT.maxHpPerPoint + this.gearBonus('vitBonus') * 8; }
  get maxMp(): number { return 100 + this.data.stats.MAGIC * statsData.pointValuePerStat.MAGIC.maxMpPerPoint; }
  get attackBonus(): number { return this.data.stats.STR * statsData.pointValuePerStat.STR.attackPerPoint + this.gearBonus('strBonus'); }
  get magicBonus(): number { return this.data.stats.MAGIC * statsData.pointValuePerStat.MAGIC.skillDamagePerPoint; }
  get damageReduction(): number { return this.data.stats.DEF * statsData.pointValuePerStat.DEF.damageReductionPerPoint + this.gearBonus('defBonus'); }
  get speedBonus(): number { return this.data.stats.SPD * statsData.pointValuePerStat.SPD.moveSpeedPerPoint; }

  items(stage = this.data.stage): ShopItem[] {
    return [...stage1Shop.items, ...(stage >= 2 ? stage2Shop.items : []),
      ...(stage >= 3 ? stage3Shop.items : []), ...(stage >= 4 ? stage4Shop.items : [])] as ShopItem[];
  }
  item(id: string): ShopItem | undefined { return this.items().find(x => x.id === id); }

  buy(id: string): string {
    const item = this.item(id);
    if (!item) return '尚未解鎖此商品';
    if (item.type === 'equipment' && this.data.ownedEquipment.includes(id)) return '已擁有此裝備';
    if (this.data.coins < item.price) return '金錢不足';
    this.data.coins -= item.price;
    if (item.type === 'consumable') this.data.consumables[id] = (this.data.consumables[id] || 0) + 1;
    else this.data.ownedEquipment.push(id);
    this.save();
    return `已購買${item.name}`;
  }

  use(id: string): number {
    const item = this.item(id);
    if (!item || item.type !== 'consumable' || !this.data.consumables[id]) return 0;
    this.data.consumables[id]--;
    this.save();
    return item.healAmount || 0;
  }

  equip(id: string): string {
    const item = this.item(id);
    if (!item || item.type !== 'equipment' || !item.slot || !this.data.ownedEquipment.includes(id)) return '尚未擁有此裝備';
    this.data.equipped[item.slot] = id;
    this.save();
    return `已裝備${item.name}`;
  }

  allocate(stat: Stat): string {
    if (!STATS.includes(stat)) return '未知素質';
    if (this.unspent === 0) return '沒有可用點數';
    this.data.stats[stat]++;
    this.save();
    return `${stat} +1`;
  }

  collect(coins: number, points: number): void {
    this.data.coins += Math.max(0, coins);
    this.data.earned = Math.min(statsData.maxTotalSkillPoints, this.data.earned + Math.max(0, points));
    this.save();
  }

  checkpoint(stage: number, id: string, position: number): void {
    const key = String(stage);
    if (position <= (this.data.checkpoints[key]?.position || 0)) return;
    this.data.checkpoints[key] = { id, position };
    this.save();
  }

  clear(stage: number, level: number): void {
    this.data.cleared = Math.max(this.data.cleared, stage);
    this.data.level = level;
    if (stage < 6) this.data.stage = stage + 1;
    this.save();
  }

  selectStage(stage: 5 | 6): void {
    if (this.data.cleared < stage - 1) return;
    this.data.stage = stage;
    this.save();
  }

  private gearBonus(key: 'vitBonus' | 'strBonus' | 'defBonus'): number {
    return Object.values(this.data.equipped).reduce((sum, id) => sum + (this.item(id || '')?.[key] || 0), 0);
  }
}
