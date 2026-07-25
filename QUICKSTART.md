# QUICK START — Copy/Paste These Commands

## 1. First-time setup (once)

```powershell
cd E:\pathummalesgo
py -3.12 -m venv .venv
.\.venv\Scripts\activate
pip install -r api\requirements.txt
pip install line-bot-sdk
```

**Then get your LINE_CHANNEL_SECRET:**
1. Go to https://developers.line.biz/console/
2. Your channel → Basic settings → Channel secret (copy it)
3. Edit `.env` and paste it after `LINE_CHANNEL_SECRET=`

---

## 2. Test locally (your laptop)

```powershell
cd E:\pathummalesgo
.\.venv\Scripts\activate
.\run_local.ps1
```

This will:
- Check your config
- Test Pathumma + Sentiment
- Start uvicorn on port 8000

**Then in a NEW terminal:**
```powershell
ngrok http 8000
```

Copy the `https://...ngrok-free.app` URL, then:
1. LINE Developers → Messaging API → Webhook URL → paste `https://YOUR-ID.ngrok-free.app/webhooks/line`
2. Click **Verify** (should be green)
3. Turn **Use webhook** to ON
4. Turn **Auto-reply messages** to OFF
5. Message your bot → it replies!

---

## 3. Deploy to server

```powershell
cd E:\pathummalesgo
.\.venv\Scripts\activate
.\deploy.ps1
```

**Before running it:**
1. Add git remote (get URL from your team's GitLab repo)
2. Set 3 masked variables in GitLab → Settings → CI/CD → Variables:
   - `APP_AIFORTHAI_API_KEY`
   - `APP_LINE_CHANNEL_ACCESS_TOKEN`
   - `APP_LINE_CHANNEL_SECRET`

The script will push to main and trigger the pipeline.

**After pipeline finishes:**
1. Test: https://team07.aiforthai.in.th/api/health
2. Update LINE webhook to: `https://team07.aiforthai.in.th/api/webhooks/line`
3. Click Verify again
4. Message bot → now it runs on the server!

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "No module named linebot" | `pip install line-bot-sdk` |
| "LINE_CHANNEL_SECRET missing" | Get it from LINE console, add to `.env` |
| Webhook verify fails | Check ngrok is running, URL is correct |
| Bot doesn't reply | Check uvicorn terminal for errors |
| 503 on server | Pipeline failed or container not running |

**Full testing guide:** `docs/testing_checklist.md`

---

## What you have

| File | Purpose |
|------|---------|
| `run_local.ps1` | One command: test + start uvicorn |
| `deploy.ps1` | One command: commit + push + deploy |
| `api/scripts/test_bot_local.py` | Test bot logic without LINE |
| `docs/testing_checklist.md` | All 8 verification steps |

---

## Current status

✓ Repo configured for team07  
✓ Docker + compose ready  
✓ GitLab CI pipeline ready  
✓ AI for Thai key set  
✓ LINE token set  
⚠ **LINE_CHANNEL_SECRET needed** (blocks testing)  

**Next:** Add the secret to `.env`, then run `.\run_local.ps1`
