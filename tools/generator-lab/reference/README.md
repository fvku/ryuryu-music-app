# Weekly実測用の参照画像

Weekly（NEW RELEASE WEEK）の版面をピクセル単位で確定させるための参照画像を置く場所。
`tools/monthly-generator/reference/`（Monthly／掲載枠のときに使った実測方式）と同じ位置づけ。

## 置いてあるファイル

| フォルダ | 中身 | 状態 |
|---|---|---|
| `2026#36/2026_W-0.png` 〜 `2026_W-6.png` | 2026年第36週の実物投稿7枚（2400×2400）。`W-0`が表紙、`W-1`〜`W-5`が作品面（1〜5位）、`W-6`がOther Releases | 受領済み（2026-09-04） |

解像度はどれでも実測できる（コードが幅から1200基準への倍率を自動算出する）。2400×2400（2倍書き出し）だとMonthlyの実測記録とサイズが揃う。

## 実測方法

版面の座標・書体・行送りは、この画像を画素単位で読んで `docs/generator-weekly-design.md` §6へ反映済み。

表紙の色オーバーレイだけは専用の検算スクリプトがある。表紙の帯と、同じジャケットが無加工で写っている
作品面を突き合わせ、`dst = (1-a)·src + a·C` を最小二乗で解いてオーバーレイの色と不透明度を出す。

```sh
node tools/generator-lab/measure/overlay-of.mjs                       # 既定は 2026#36
node tools/generator-lab/measure/overlay-of.mjs tools/generator-lab/reference/2026#37
```

別の週の投稿を受け取ったら、同じ並び（`YYYY#WW/YYYY_W-0.png`〜`W-6.png`）で置けばそのまま検算できる。

## 注意

- 個人情報・非公開の下書きは置かない（このリポジトリはGit管理下）。
- 実測が終わったら、確定値は`docs/generator-weekly-design.md` §6へ反映し、このフォルダの画像は残す（回帰確認用）。
