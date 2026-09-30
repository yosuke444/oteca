# オテカ（おてあげカードバトル）

ブラウザで遊ぶ 1対1 のオンライン対戦カードゲーム。

- 遊ぶ：https://yosuke444.github.io/oteca/
- 仕様：[SPEC.md](SPEC.md)

## 開発

```
npm install
npm run dev     # 開発サーバー
npm test        # テスト
npm run build   # 公開用ビルド（dist/）
```

`main` ブランチに push すると、GitHub Actions がテスト・ビルドして GitHub Pages に公開します（`.github/workflows/deploy.yml`）。

BGM・画像の置き方は [public/audio/README.md](public/audio/README.md) と [CLAUDE.md](CLAUDE.md) を見てください。
