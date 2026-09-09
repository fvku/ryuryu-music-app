# Weekly実測用の参照画像

Weekly（NEW RELEASE WEEK）の版面をピクセル単位で確定させるための参照画像を置く場所。
`tools/monthly-generator/reference/`（Monthly／掲載枠のときに使った実測方式）と同じ位置づけ。

**この中の画像はGit管理外**（`.gitignore`）。1枚3〜9MBあり履歴を膨らませるため、各自の手元にだけ置く。
このREADMEだけが管理対象。

## 置いてあるファイル

| ファイル | 中身 |
|---|---|
| `2026#36/2026_W-0.png` 〜 `2026_W-6.png` | 2026年第36週の実物投稿7枚（2400×2400）。`W-0`が表紙、`W-1`〜`W-5`が作品面（1〜5位）、`W-6`がOther Releases |
| `wave26MM.png` | Koheiから受け取った波の**原版（未加工・カラー）**。2026-09〜12を受領済み |

解像度はどれでも実測できる（コードが幅から1200基準への倍率を自動算出する）。2400×2400（2倍書き出し）だとMonthlyの実測記録とサイズが揃う。

## 波の原版を受け取ったら

原版はそのままアプリでは使わない。グレースケールへ変換して`assets/waves/`へ置く。

```sh
node tools/generator-lab/make-wave.mjs tools/generator-lab/reference/wave2701.png
```

背景の合成はLuminosityで**波の輝度しか使わない**ので、色を落としても出力は1階調も変わらず、容量は約1/3になる。
変換後は`app/generator/runtime.tsx`の`BUNDLED_WAVES`へその月を追記する。詳しくは
`docs/generator-weekly-design.md` §6.5。

## 実測方法

版面の座標・書体・行送りは、この画像を画素単位で読んで `docs/generator-weekly-design.md` §6へ反映済み。

検証用のページとスクリプトがこの画像を使う（画像が手元に無いと動かない）。

```sh
node tools/generator-lab/measure/overlay-of.mjs          # 表紙のオーバーレイ色を逆算
```

- `background-check.html` … 実物投稿と`Render.drawBackground()`の出力を画素比較する（`generator-lab`サーバ8778番）
- `wave-blend-compare.html` … 波の重ね方（通常／Luminosity）を並べて見る

別の週の投稿を受け取ったら、同じ並び（`YYYY#WW/YYYY_W-0.png`〜`W-6.png`）で置けばそのまま検算できる。

## 注意

- 個人情報・非公開の下書きは置かない（このリポジトリはGit管理下）。
- 実測が終わったら、確定値は`docs/generator-weekly-design.md` §6へ反映し、このフォルダの画像は残す（回帰確認用）。
