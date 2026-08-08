# 新マルチクリップボード デプロイスクリプト（Windows / PowerShell 7）
#
#   本番デプロイ → 無認証で見えるエイリアスを削除 → 状態を検証
#
# このサイトには個人情報を含むクリップがあるため、誰でも見られるURLを持たせていません。
# 本番デプロイのたびに Vercel が公開エイリアスを自動で復活させるので、必ずこのスクリプトを使ってください。
#
#   使い方:  pwsh ./deploy.ps1

$ErrorActionPreference = 'Stop'

$Scope       = 'makoto1465s-projects'
$PublicAlias = 'new-multi-clipboard.vercel.app'
$PrivateUrl  = 'https://new-multi-clipboard-makoto1465s-projects.vercel.app/'

function Get-Status([string]$Url) {
  return (curl.exe -s -o NUL -w "%{http_code}" $Url)
}

Write-Host "==> 本番デプロイ中..." -ForegroundColor Cyan
npx --yes vercel@latest deploy --prod --yes --scope $Scope
if ($LASTEXITCODE -ne 0) { throw "デプロイに失敗しました" }

Write-Host "`n==> 公開エイリアスを削除中: $PublicAlias" -ForegroundColor Cyan
try {
  npx --yes vercel@latest alias rm $PublicAlias --yes --scope $Scope
} catch {
  Write-Host "   （もともと存在しなかったようです）" -ForegroundColor DarkGray
}

Start-Sleep -Seconds 3

Write-Host "`n==> 状態を検証中..." -ForegroundColor Cyan
$pub  = Get-Status "https://$PublicAlias/"
$priv = Get-Status $PrivateUrl

Write-Host "   $PublicAlias -> $pub  (期待値 404)"
Write-Host "   認証つきURL              -> $priv (期待値 302)"

$ok = $true
if ($pub -ne '404') {
  Write-Host "`n[危険] 公開エイリアスがまだ生きています。中身が誰にでも見える状態です。" -ForegroundColor Red
  Write-Host "       手動で消してください: npx vercel@latest alias rm $PublicAlias --yes --scope $Scope" -ForegroundColor Red
  $ok = $false
}
if ($priv -ne '302' -and $priv -ne '401') {
  Write-Host "`n[注意] 認証つきURLが $priv を返しました。保護が外れている可能性があります。" -ForegroundColor Yellow
  Write-Host "       Vercel の Deployment Protection > Vercel Authentication を確認してください。" -ForegroundColor Yellow
  $ok = $false
}

if ($ok) {
  Write-Host "`n完了。 $PrivateUrl （Vercelログインが必要です）" -ForegroundColor Green
} else {
  exit 1
}
