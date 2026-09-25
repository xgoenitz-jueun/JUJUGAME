# Q版娃娃橫向捲軸打怪遊戲

本專案依 `00_README_使用說明.md`、`01_GDD_核心遊戲設計.md`、`02_關卡與怪物設計.md`、`03_技術架構與GitHub整合.md`、`04_分階段執行與授權計畫.md` 建置，並依 04 文件的 Phase 0→6 順序推進。

## 目前進度

Phase 0：Phaser 3 + TypeScript 專案骨架。遊戲畫面目前是空白的啟動場景；角色操作、戰鬥與美術資源尚未進入實作階段。四個資料目錄內的 JSON 檔案為有效但未填入遊戲設定的骨架。

## 本機執行

需要 Node.js 20.19+ 或 22.12+。

```bash
npm install
npm run dev
```

檢查建置：

```bash
npm run build
```

## 目錄

- `src/entities`：角色、怪物與 Boss。
- `src/systems`：戰鬥、經濟、點數與存檔。
- `src/ui`：操作按鈕與介面。
- `src/scenes`：場景載入邏輯。
- `src/state`：角色及變身狀態機。
- `data/enemies`、`data/levels`、`data/shop`、`data/progression`：資料驅動設定。
- `assets/sprites`、`assets/backgrounds`、`assets/audio`：素材預留目錄。

待美術資源仍用佔位圖推進後續邏輯。GitHub repo 連接、公開部署及涉及商標的結局文字依 04 文件對應 ⛔ 節點確認。
