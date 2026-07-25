# Phase 1 Deploy to Hackathon Server
# Run after local testing works

Write-Host "=== Deploy to team07.aiforthai.in.th ===" -ForegroundColor Cyan
Write-Host ""

# Check git remote
$remote = git remote get-url origin 2>$null
if (-not $remote) {
    Write-Host "No git remote found. Add it first:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  git init" -ForegroundColor White
    Write-Host "  git remote add origin https://gitlab.nectec.or.th/ai4thai-service-hackatho/team07/YOUR-REPO.git" -ForegroundColor White
    Write-Host ""
    Write-Host "Get the exact URL from your GitLab team repo page." -ForegroundColor Gray
    exit 0
}

Write-Host "Git remote: $remote" -ForegroundColor Green
Write-Host ""

# Check GitLab variables
Write-Host "BEFORE YOU PUSH - Set these in GitLab:" -ForegroundColor Yellow
Write-Host "  Settings > CI/CD > Variables > Add variable (tick 'Masked'):" -ForegroundColor Gray
Write-Host ""
Write-Host "  APP_AIFORTHAI_API_KEY" -ForegroundColor White
Write-Host "  APP_LINE_CHANNEL_ACCESS_TOKEN" -ForegroundColor White
Write-Host "  APP_LINE_CHANNEL_SECRET" -ForegroundColor White
Write-Host ""
$confirm = Read-Host "Have you set all 3 variables? (y/n)"
if ($confirm -ne 'y') {
    Write-Host "Set them first, then re-run this script." -ForegroundColor Red
    exit 0
}

# Stage and commit
Write-Host ""
Write-Host "Staging files..." -ForegroundColor Yellow
git add .
$status = git status --porcelain
if (-not $status) {
    Write-Host "No changes to commit" -ForegroundColor Gray
} else {
    Write-Host "Changes:" -ForegroundColor Gray
    git status --short
    Write-Host ""
    git commit -m "Phase 1: LINE bot with Pathumma + Sentiment"
}

# Push
Write-Host ""
Write-Host "Pushing to main..." -ForegroundColor Yellow
git push origin main

Write-Host ""
Write-Host "=== Pushed! ===" -ForegroundColor Green
Write-Host ""
Write-Host "NEXT:" -ForegroundColor Cyan
Write-Host "  1. Watch pipeline: $($remote -replace '\.git$','')/pipelines"
Write-Host "  2. Wait for 'deploy' stage to finish (green)"
Write-Host "  3. Test health: https://team07.aiforthai.in.th/api/health"
Write-Host "  4. Update LINE webhook to: https://team07.aiforthai.in.th/api/webhooks/line"
Write-Host "  5. Message your bot - it now runs on the server!"
Write-Host ""
Write-Host "Logs: https://team07.aiforthai.in.th/logs/ (login: team07)" -ForegroundColor Gray
