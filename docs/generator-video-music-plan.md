# 画像ジェネレーター：動画書き出しと音楽の共有（設計案）

作成：2026-11-07（Claude Code）。状態：**案（音声の保存先は Backblaze B2 に決定）**。ブランチ `feat/generator-video-export`（未コミット）。

## 1. 背景と利用者の決定

- これまで表紙以外の画像は、Keynoteで音楽を付けて動画にしてからInstagramへ投稿していた。これをジェネレーターでできるようにする。
- 1枚に1本。掲載ページは上下どちらの作品の曲を使うかを選ぶ。曲は各作品のおすすめ曲。
- 長さは既定59秒（フィードは60秒未満）。開始は Release Master の `Start Time` 列。どちらも調整できる。
- 投稿先はフィード（正方形）。作業は主にPC、iPhoneも見据える。
- 右の編集パネルを「画像／音楽」のタブにし、音楽タブで設定する（2026-11-07。2026-09-18の「タブなし1枚」を利用者の指示で変更）。
- 書き出しは1枚ずつと、全ページ（表紙はPNG）の両方。
- **音声ファイルと設定は別の端末でも続けられるよう共有する**（2026-11-07）。
- **音声の保存先は Backblaze B2**（2026-11-07、利用者の決定。比較は3-7）。MP3は変換せずに保存する（3-1）。

## 2. 現在の実装（UI確認版・未コミット）

| ファイル | 内容 |
| --- | --- |
| `lib/generator/video.ts` | 時刻の読み書き、範囲の計算（ドラッグ含む）、Start Time の照合、波形（RMS）。テストあり |
| `lib/generator/pcm.ts` | 非圧縮WAV／AIFFの読み込み（ChromeはAIFFを読めないため）。テストあり |
| `app/api/generator/start-times/route.ts` | Start Time を読むだけのAPI（新設・読み取り専用） |
| `app/generator/music-store.ts` | 音楽設定の状態。**今はこの端末の中だけ**（localStorage＋IndexedDB） |
| `app/generator/MusicPanel.tsx`・`MusicWaveform.tsx` | 音楽タブ、波形のドラッグ調整・クリック試聴 |
| `app/generator/video-export.ts`・`BulkVideoExportButton.tsx` | MP4書き出し（1枚・全ページZIP）。2026-11-07 実装済み（[UI実装記録 §41](./generator-ui-implementation.md#41-2026-11-07動画mp4の書き出しopus-55)） |

## 3. 音声共有の設計案

### 3-1. 音声の保存形式（音質を優先）
- 手元の音源は**基本MP3で、10MBを超えるものもある**（2026-11-07、利用者）。ほかにWAV／AIFもある。
- 直接アップロード（3-2）にするので、10MB・4.5MBの上限には当たらない。ファイル1つの上限は Supabase 側の設定（無料プランは50MB）。
- **MP3は変換せず、そのまま保存する。** 非可逆の圧縮を重ねるたびに劣化が積み重なる（シンバルや残響のにじみなど）ため。
  - 当初は保存前に AAC 160kbps へ変換する案だったが、2026-11-07 に「音質は本当に大丈夫か」と指摘されて取りやめた。
  - これだと非可逆の圧縮は「元のMP3 → 書き出し時のAAC → Instagramの再圧縮」の3回になる。今のKeynoteでの作り方と同じ回数で、劣化は増えない。
- WAV／AIF（非圧縮）は容量が大きいので AAC 256kbps に変換して保存する。元が非圧縮なので、劣化はMP3を保存するのと同程度。
- 書き出す動画の音声は AAC 256kbps・44.1kHz（または元の周波数）。
- 変換には WebCodecs の `AudioEncoder` と MP4 コンテナ（`mediabunny`）を使う。動画書き出しと同じ部品なので、**先に動画書き出しを実装する**。

### 3-2. アップロードと読み出し
- Vercel Functions は本文・応答とも4.5MBが上限のため、音声はサーバーを経由させない。
- サーバーが認可（許可メンバー・同一Origin）と記録を済ませてから、Supabase Storage の**署名付きアップロードURL**を発行し、ブラウザが直接アップロードする。完了後にサーバーがサイズとハッシュを確かめて ready にする。
- 読み出しも、サーバーが短時間有効の署名付きURLを発行してブラウザが直接取得する。
- 既存の非公開バケット `generator-assets`（Supabase）は、1ファイル10MBまで・画像だけに設定されている（2026-11-07にStorage APIで確認）。音声は入らない。
- 音声は **Backblaze B2 の非公開バケット**に置く。S3互換APIの署名付きURL（PUT／GET、有効期限は数分）をサーバーが発行し、ブラウザが直接送受信する。
- 1回のアップロードの上限：Vercelの4.5MBは通らないので関係しない。B2の1回の送信は5GBまで。アプリ側で1ファイル50MBまでとする。
- ブラウザから直接送るため、バケットにCORS（許可するOrigin：本番URLとlocalhost、操作：s3_put／s3_get／s3_head）を設定する。B2 CLIで行う。
- 署名付きURLでの1回の送信は、6MBを超えると通信が不安定なときに失敗しやすい（Supabaseは大きなファイルに再開可能アップロードを推奨）。失敗したら最初から送り直すことにし、再開可能アップロードは必要になってから入れる。

### 3-3. DB（新しいマイグレーションが必要）
既存の `generator_assets` は画像専用（mime と幅・高さの制約）のため触らず、次の2つを新設する案。

- `generator_audio`：document_id, item_id, id, object_key（B2上の場所）, status(pending/ready), mime, bytes, duration, sha256, created_by, created_at
- `generator_music`：document_id, target_kind(item/page), target_id, settings(jsonb), version, updated_by, updated_at
  - item：`{ audioId, start, length, fadeIn, fadeOut }`
  - page：`{ itemId }`（掲載の上下どちら）

RLS有効・直接権限なし・RPC経由のみ、という既存の方針に合わせる。

### 3-4. 保存とロック
- 音楽タブにも「保存」を置く（画像と同じく、みんなのデータへの確定）。
- 画像の編集ロックとは分ける。`version` による楽観的な競合検出だけにし、競合したら最新を読み込み直すよう案内する。履歴は持たない。

### 3-5. 容量と保存期間
- B2の無料枠は10GB。MP3をそのまま保存すると1曲約8〜12MBで、Monthly と Japan を合わせて1か月に約500MB。
- 対象月の終わりから**1年後に自動で削除**する案（既存の日次Cronに追加）。常時の使用量は約6GBで無料枠に収まる。期間は利用者が決める。
- 取り出しの無料枠は保存量の3倍まで。この用途なら超えない見込み。

### 3-6. 注意点
- 市販の曲のコピーを保管することになる。非公開バケット、メンバーだけに発行する署名付きURL、自動削除で範囲を絞る。

### 3-7. 音声の保存先の比較（2026-11-07）
利用者から「50MBでは足りず、Supabase以外も検討が必要では」と指摘を受けて比較した。数値は各社の公開情報（2026-11時点の検索結果）で、契約前に公式ページで再確認する。

| 保存先 | 無料の容量 | 1ファイルの上限 | 取り出しの通信量 | 準備 |
| --- | --- | --- | --- | --- |
| Supabase（無料） | 1GB（画像と共用） | 50MB | 無料枠あり | 今の構成のまま |
| Supabase Pro | 100GB（月$25） | 設定で引き上げ可 | 枠あり | プラン変更 |
| Vercel Blob（Hobby） | 1GB | 5TB | 月10GB | Vercelの画面で作るだけ |
| **Cloudflare R2** | **10GB** | **1回の送信で5GB** | **無料** | Cloudflareのアカウントとキーの発行が要る |

- 推奨は Cloudflare R2。無料で10GB（MP3で約1,000曲）入り、別端末で何度読み直しても通信料がかからない。S3互換なので、署名付きURLで直接アップロード・読み出しができる。
- 音楽の設定（曲の選択・範囲）は小さいので、DB（Supabase）に置く案のまま。R2には音声ファイルだけを置く。
- 容量に余裕ができるので、保存期間は1年などに延ばせる。

#### ほかの候補（2026-11-07 追記）
- **Google Drive**：可能だが条件つき。
  - アプリが今使っているサービスアカウントは、Driveに自分のファイルを持てない（容量0）。共有ドライブなら置けるが、共有ドライブは有料の Google Workspace だけ。メンバーは Gmail なので使えない。
  - そのため、Koheiさんの Google アカウントに許可をもらい（OAuth、権限は「このアプリが作ったファイルだけ」の `drive.file`）、その Drive のフォルダへ保存する形になる。容量は Gmail・Googleフォトと共用の15GB。
  - OAuth の同意画面が「テスト中」だと、許可が7日で切れる。「本番」にしておく必要がある（`drive.file` だけなら Google の審査は不要の見込み）。
  - Vercel の4.5MB上限があるため、アップロード・読み出しはブラウザから Drive へ直接行う。サーバーは短時間だけ有効な許可（アクセストークン）を渡す。
  - 利点：Koheiさんが Drive のフォルダで中身を見て整理できる。MP3が元から Drive にあるなら、アップロードせず Drive から選ぶ形にもできる。
  - 欠点：Koheiさん個人のアカウントに依存する。許可が切れたり外されたりすると、全員がアップロード・読み出しできなくなる。
- **Backblaze B2**：無料10GB、取り出しは保存量の3倍まで無料。R2と同じ使い方（S3互換・署名付きURL）。避ける決定的な理由は無い。
  - R2より良い点：登録にクレジットカードが要らない（公式の登録ページの表記。R2は無料枠でも支払い方法の登録を求められる）。無料枠を超えた後の保存料も安い。
  - R2より劣る点：データセンターが米国・欧州（・カナダ）だけで、日本からは少し遅い（10MBで数秒の差の見込み）。取り出しの無料は保存量の3倍まで（この用途なら超えない見込み）。
  - 準備：ブラウザから直接アップロードするために、バケットにCORS（許可するサイト）の設定が要る。管理画面ではなくコマンド（B2 CLI）で設定する。
- **Firebase Storage**：今は従量課金プラン（クレジットカード登録）が前提。
- **Dropbox**：無料2GB。

## 4. 進め方の案

1. **MP4書き出し**（1枚・全ページZIP）。端末内の音楽設定のままで動く。B2は不要
2. **音声と設定の共有**（B2、Supabaseに2表を追加するマイグレーション、API、音楽タブの保存ボタン、自動削除）。マイグレーションは利用者が Supabase の SQL Editor で適用する
3. 実機確認（PC Chrome／Safari は 2026-11-07 済み。iPhone Safari は後回し）

### 利用者にお願いする準備（2の前まで）
1. Backblaze に登録する（https://www.backblaze.com/sign-up/cloud-storage-v2）。地域は **US West** を選ぶ（日本から最も近い見込み）
2. B2 Cloud Storage → Buckets → Create a Bucket。名前は `ryuryu-generator-audio`（世界で一意なので、使われていれば末尾を変える）、**Private**、暗号化は有効、Object Lock は無効
3. Application Keys → Add a New Application Key。対象をこのバケットだけに絞り、Read and Write
4. 表示された `keyID` と `applicationKey` を次の名前で登録する。**チャットには貼らない**
   - ローカル：`.env.development.local`
   - Vercel：Production の環境変数
   - `B2_KEY_ID` / `B2_APPLICATION_KEY` / `B2_BUCKET` / `B2_ENDPOINT`（バケット画面の Endpoint。例 `s3.us-west-004.backblazeb2.com`）
5. 登録後、CORSの設定はClaude Codeがローカルのキーを使ってコマンドで行う

**2026-11-07 実施済み**：バケット `ryuryu-generator-audio`（US West、Private）を作成。キーはこのバケットだけに限定。ローカルの `.env.development.local` に4項目を登録（`B2_ENDPOINT=s3.us-west-004.backblazeb2.com`）。CORSルール `generatorAudio` を設定した（許可Origin：`https://ryuryu-music-app.vercel.app`・`http://localhost:3000`・`3456`・`3458`、操作：s3_put／s3_get／s3_head）。事前確認リクエストで、許可Originは200、それ以外は403になることを確認。カスタムドメインを使い始めたら、許可Originへ追加する。

## 5. 未確認事項
- ~~iPhone Safari の `AudioEncoder`（AAC）と `VideoEncoder`（H.264）の対応状況~~ → 2026-11-07 確認。Safari 26（Mac・iOS）は両方あり、AAC 44.1k／48k・H.264 とも「対応」。iOSシミュレーターでは H.264 High が止まり Baseline は動いたため、書き出し前に実際に符号化して選ぶ実装にした。Safari 18以前（iOS 18以前）は `AudioEncoder` が無く、理由を出して止まる
- 物理iPhoneでの書き出しと、共有シートからInstagramへの投稿（2026-11-07 利用者の指示で後回し。PCブラウザを先に完成）
- Windows の Chrome・Edge

## 6. 新しいチャットへの引き継ぎプロンプト

```
ryuryu-music の画像ジェネレーターに「動画書き出し」を実装してください。
ブランチ feat/generator-video-export に、UI確認版が未コミットで入っています（git status で確認）。
最初に docs/generator-video-music-plan.md を最後まで読み、続いて CLAUDE.md の「画像ジェネレーターのUI引き継ぎ」の手順どおり docs/claude-generator-ui-handoff.md を読んでください。

今回の範囲は「4. 進め方の案」の 1（MP4書き出し）です。
- 1枚：プレビュー下の「動画を書き出す」。全ページ：見出し行の「全ページを動画つきで書き出す（ZIP）」（表紙はPNG、ほかはMP4）
- 画像はジェネレーターの描画（runtime.exporter.renderTiled）を 1080×1080 に縮小した静止画、音声は音楽タブの範囲・フェード
- MP4（H.264／AAC 256kbps）。WebCodecs と mediabunny を使い、ブラウザの中だけで作る。音声の非可逆圧縮はこの1回だけにする
- 今は app/generator/video-export.ts の VIDEO_ENCODER_READY=false で、変換の代わりに案内を出している。ここを本実装に置き換える
- ZIPは既存の bulk-export.ts のまとめ役を使う。「アプリで送る」はPNGと同じく共有シート
- 対応しないブラウザでは理由を出して止める（iPhone Safari の対応状況を確かめる）

守ること：commit・push・デプロイは依頼されるまでしない。共有DBの永続変更もしない。
確認：npx tsc --noEmit --incremental false / npm run lint / npm test / npm run build、
ローカル確認は .claude/launch.json の generator-preview-3458 で /generator/uipreview-temp を開く。
音声は ~/Downloads の WAV などを使ってよい（public に置く場合は拡張子 .png にしないとログイン確認で弾かれる。使い終わったら消す）。
書き出したMP4は、再生できること・長さ・音の範囲・フェードを確かめる（ffmpeg あり）。
```
