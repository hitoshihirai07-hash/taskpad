# TaskPad (MVP)

自分用タスク管理の最小構成（静的HTML/JS + localStorage）。

## 仕様（ざっくり）
- 予定日 = 期日（締切）
- スマホ下タブ：今日 / 今週 / ＋ / 期限なし / 設定
- 追加はタイトルだけでOK（後から編集）
- 今日：期限切れ / 今日が期日 を最上段で強調
- 設定：TSVコピー（未転記/全件）、Inbox（カテゴリ未設定）、完了、全削除

## Cloudflare Pages 推奨設定（静的）
- Build command: `exit 0`
- Build output directory: `public`
- Root directory: `.`

`public/` の中がそのまま配信されます。
