# Phase 1 Local Test — One-command runner
# Run this after: pip install line-bot-sdk

Write-Host "=== JaiKrajok Phase 1 Local Test ===" -ForegroundColor Cyan
Write-Host ""

# Check .env
if (-not (Test-Path ".env")) {
    Write-Host "ERROR: .env not found" -ForegroundColor Red
    exit 1
}

$env_content = Get-Content ".env" -Raw
$has_aiforthai = $env_content -match "AIFORTHAI_API_KEY=\S+"
$has_line_token = $env_content -match "LINE_CHANNEL_ACCESS_TOKEN=\S+"
$has_line_secret = $env_content -match "LINE_CHANNEL_SECRET=\S+"

Write-Host "Config check:" -ForegroundColor Yellow
Write-Host "  AIFORTHAI_API_KEY: $(if($has_aiforthai){'OK'}else{'MISSING'})"
Write-Host "  LINE_CHANNEL_ACCESS_TOKEN: $(if($has_line_token){'OK'}else{'MISSING'})"
Write-Host "  LINE_CHANNEL_SECRET: $(if($has_line_secret){'OK'}else{'MISSING'})"
Write-Host ""

if (-not $has_line_secret) {
    Write-Host "ACTION NEEDED:" -ForegroundColor Red
    Write-Host "  1. Go to https://developers.line.biz/console/"
    Write-Host "  2. Your channel > Basic settings > Channel secret"
    Write-Host "  3. Copy it, edit .env, paste after LINE_CHANNEL_SECRET="
    Write-Host ""
    Read-Host "Press Enter after you add it, then re-run this script"
    exit 0
}

# Test bot logic
Write-Host "Testing bot logic (Pathumma)..." -ForegroundColor Yellow
python api\scripts\test_bot_local.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "Bot test failed - check API keys/endpoints" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Bot logic works! ===" -ForegroundColor Green
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Cyan
Write-Host "  1. Open a NEW terminal, run: ngrok http 8000"
Write-Host "  2. Copy the https URL from ngrok"
Write-Host "  3. Go to LINE Developers > Messaging API > Webhook URL"
Write-Host "  4. Paste: https://YOUR-ID.ngrok-free.app/webhooks/line"
Write-Host "  5. Click Verify (should be green)"
Write-Host "  6. Message your bot - it will reply!"
Write-Host ""
Write-Host "Starting uvicorn on port 8000..." -ForegroundColor Yellow
Write-Host "(Press Ctrl+C to stop)"
Write-Host ""

cd api
uvicorn app.main:app --reload --port 8000
