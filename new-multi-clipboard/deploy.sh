#!/usr/bin/env bash
# 新マルチクリップボード デプロイスクリプト（bash）
#
#   本番デプロイ → 無認証で見えるエイリアスを削除 → 状態を検証
#
# このサイトには個人情報を含むクリップがあるため、誰でも見られるURLを持たせていません。
# 本番デプロイのたびに Vercel が公開エイリアスを自動で復活させるので、必ずこのスクリプトを使ってください。
#
#   使い方:  bash ./deploy.sh
set -euo pipefail

SCOPE='makoto1465s-projects'
PUBLIC_ALIAS='new-multi-clipboard.vercel.app'
PRIVATE_URL='https://new-multi-clipboard-makoto1465s-projects.vercel.app/'

status() { curl -s -o /dev/null -w "%{http_code}" "$1"; }

echo "==> 本番デプロイ中..."
npx --yes vercel@latest deploy --prod --yes --scope "$SCOPE"

echo
echo "==> 公開エイリアスを削除中: $PUBLIC_ALIAS"
npx --yes vercel@latest alias rm "$PUBLIC_ALIAS" --yes --scope "$SCOPE" || echo "   （もともと存在しなかったようです）"

sleep 3

echo
echo "==> 状態を検証中..."
pub=$(status "https://$PUBLIC_ALIAS/")
priv=$(status "$PRIVATE_URL")
echo "   $PUBLIC_ALIAS -> $pub  (期待値 404)"
echo "   認証つきURL              -> $priv (期待値 302)"

ok=1
if [ "$pub" != "404" ]; then
  echo
  echo "[危険] 公開エイリアスがまだ生きています。中身が誰にでも見える状態です。"
  echo "       手動で消してください: npx vercel@latest alias rm $PUBLIC_ALIAS --yes --scope $SCOPE"
  ok=0
fi
if [ "$priv" != "302" ] && [ "$priv" != "401" ]; then
  echo
  echo "[注意] 認証つきURLが $priv を返しました。保護が外れている可能性があります。"
  ok=0
fi

if [ "$ok" = "1" ]; then
  echo
  echo "完了。 $PRIVATE_URL （Vercelログインが必要です）"
else
  exit 1
fi
