# 03｜技術架構與 GitHub 整合規格

## 1. 引擎建議

| 方案 | 優點 | 缺點 | 建議情境 |
|---|---|---|---|
| **Phaser 3 + TypeScript（建議首選）** | 純網頁技術，AI 代理人（Astra）容易大量生成/迭代程式碼；可直接部署 GitHub Pages 免額外簽署；觸控 UI／半透明按鈕用 HTML/CSS 疊層很直觀 | 效能上限低於原生引擎；手機瀏覽器需注意觸控延遲 | 快速迭代、優先讓 Astra 自主開發、之後再包裝成 App（用 Capacitor/Cordova）上架 |
| **Unity (C#) + 2D URP** | 效能好、正式上架 App Store/Play Store 較成熟、資源商店多 | 建置環境重、AI 代理人操作 Unity Editor 較不直觀（多為場景檔而非純程式碼） | 若你確定要上架手機商店，且有人力維護 Unity 專案 |
| **Godot 4 (GDScript/C#)** | 開源免費、2D 效能佳、上架流程也支援 | 生態圈與 AI 訓練語料相對少，Astra 產出品質可能不如前兩者穩定 | 折衷方案 |

> **本文件後續的資料結構與資料夾架構以 Phaser 3 + TypeScript 為主要範例**，若最終選 Unity/Godot，資料驅動的 JSON 設計理念不變，只需替換載入方式。

## 2. 資料驅動設計原則

所有「會隨關卡變動」的內容（怪物數值、關卡配置、商店品項、技能點分配上限、裝備屬性）都用 **JSON 設定檔**描述，程式邏輯只負責讀取執行，方便：
- Astra 之後新增/調整關卡不需要改動核心程式碼。
- 你自己也能之後直接改數值做平衡調整。

### 2.1 敵人資料範例 `data/enemies/goblin.json`
```json
{
  "id": "goblin_boss",
  "displayName": "哥布林",
  "type": "boss",
  "stage": 1,
  "hp": 800,
  "attack": 25,
  "defense": 10,
  "moveSpeed": 90,
  "attackPatterns": [
    { "name": "club_swing", "damage": 25, "range": "melee", "cooldown": 1.5 },
    { "name": "rock_throw", "damage": 18, "range": "ranged", "cooldown": 3.0 }
  ],
  "dropTable": {
    "coins": [10, 30],
    "skillPoints": { "chance": 1.0, "amount": 2 }
  },
  "spriteRef": "PENDING_UPLOAD"
}
```

### 2.2 關卡資料範例 `data/levels/stage1.json`
```json
{
  "id": "stage1",
  "name": "第一關",
  "backgroundRef": "PENDING_UPLOAD",
  "minLengthSeconds": 60,
  "checkpoints": [
    { "id": "cp1_1", "position": 400 },
    { "id": "cp1_2_boss", "position": 1800 }
  ],
  "spawnTable": [
    { "enemyId": "slime", "count": 8, "positions": "auto" }
  ],
  "boss": "goblin_boss",
  "levelUpOnClear": { "from": 3, "to": 5 }
}
```

### 2.3 商店 / 裝備資料範例 `data/shop/stage1_equipment.json`
```json
{
  "stageUnlock": 1,
  "items": [
    { "id": "food_small", "type": "consumable", "healAmount": 20, "price": 10 },
    { "id": "potion_medium", "type": "consumable", "healAmount": 60, "price": 40 },
    { "id": "sword_bronze", "type": "equipment", "slot": "weapon", "strBonus": 5, "price": 100 }
  ]
}
```

### 2.4 技能點分配資料範例 `data/progression/stats.json`
```json
{
  "maxTotalSkillPoints": 50,
  "stats": ["STR", "DEF", "MAGIC", "SPD", "VIT"],
  "pointValuePerStat": {
    "STR": { "attackPerPoint": 1.5 },
    "DEF": { "damageReductionPerPoint": 0.4 },
    "MAGIC": { "skillDamagePerPoint": 1.5, "maxMpPerPoint": 3 },
    "SPD": { "moveSpeedPerPoint": 1.2, "attackSpeedPerPoint": 0.5 },
    "VIT": { "maxHpPerPoint": 8 }
  }
}
```

## 3. 玩家狀態機（State Machine）

```
Idle → Move → Jump / Crouch / Roll
Idle/Move → Attack(Combo1→2→3) → Idle
Idle/Move → ChargeKi(蓄力) → ReleaseKi(飛行放大) → Idle
Idle/Move → BlueStorm(範圍必殺) → Idle
Idle/Move → SuperLightning(全屏必殺) → Idle
Idle/Move → Transform(進入變身狀態機，數值×2、技能表替換) → (20s倒數) → RevertToBase
Any(受擊) → Hurt → Idle / Dead(觸發傳送點復活流程)
```

變身狀態機建議獨立一份，因為變身後角色的攻擊清單完全不同（五色魔法／絕對防禦／流星雨），可以用「角色資料表切換」的方式實作（載入變身版角色的 JSON 設定），而不是在同一顆角色物件上疊加大量 if-else。

## 4. 觸控 UI 技術要點

- 半透明懸浮按鈕：CSS/Canvas 疊層，`opacity: 0.45~0.55`，按下時 `opacity: 0.8` 作為回饋。
- 需處理手機瀏覽器安全區域：`env(safe-area-inset-*)`（若走網頁方案）。
- 搖桿建議用「浮動搖桿」（手指按下位置即生成搖桿中心），比固定位置搖桿更不容易誤觸擋畫面。

## 5. 專案資料夾架構建議

```
/game
  /src
    /entities      # 玩家、怪物、Boss 邏輯類別
    /systems       # 戰鬥系統、經濟系統、技能點系統、存檔系統
    /ui            # 半透明按鈕、血條/魔力條、收合式商店面板
    /scenes        # 各關卡場景載入邏輯
    /state         # 玩家/變身狀態機
  /data
    /enemies
    /levels
    /shop
    /progression
  /assets
    /sprites       # 待美術資源到位後放入
    /backgrounds
    /audio
  /public
index.html
package.json
tsconfig.json
README.md
.github
  /workflows
    ci.yml
```

## 6. 存檔系統
- 建議用 `localStorage`（網頁版）或對應平台的本地存檔（App 版），儲存：目前關卡進度、已解鎖的傳送點、技能點分配、擁有裝備/道具、當前金錢。
- 若之後要做雲端存檔（跨裝置），再評估接後端服務，初期不建議過度設計。

## 7. GitHub 整合（手動指令，供你或 Astra 執行）

由於這個 Claude 對話目前**沒有連接 GitHub 的工具**，以下指令由你自己執行，或直接交給 GPT-6 Astra（它具備瀏覽器/電腦操作能力可自行處理 Git 與 GitHub 網頁）：

```bash
# 初始化專案
git init
git add .
git commit -m "chore: 初始化 Q版娃娃橫向捲軸打怪遊戲 專案骨架"

# 連接到你的 GitHub repo（先在 GitHub 網站建立好空 repo）
git remote add origin https://github.com/<你的帳號>/<repo名稱>.git
git branch -M main
git push -u origin main
```

### 建議的 GitHub Actions CI（自動建置檢查）`.github/workflows/ci.yml`
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npm run build
      - run: npm test --if-present
```

若最終選擇網頁部署，可再加一個 `deploy.yml` 用 GitHub Pages 自動發布 `main` 分支的建置結果，這部分建議列入 `04` 文件的「需人工確認」階段（因為涉及公開發布）。
