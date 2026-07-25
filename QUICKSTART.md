# QUICK START — Copy/Paste These Commands

## 1. First-time setup (once)

```powershell
cd E:\pathummalesgo
py -3.12 -m venv .venv
.\.venv\Scripts\activate
pip install -r api\requirements.txt
pip install line-bot-sdk
```

**Then set up your credentials in `.env`:**

### LINE credentials
1. Go to https://developers.line.biz/console/
2. Your channel → Basic settings → copy **Channel secret** and **Channel access token**
3. Edit `.env` and paste them after `LINE_CHANNEL_SECRET=` and `LINE_CHANNEL_ACCESS_TOKEN=`

### GitLab repo
1. Go to https://gitlab.nectec.or.th and log in
2. Find your group (e.g. `ai4thai-service-hackatho` or `hackathon/ai-thailand-2025`)
3. Click **New project** → **Create blank project**
4. Project name: **`team07`** → Visibility: **Private** → Uncheck "Initialize with README"
5. Click **Create project**
6. Create a **personal access token** at https://gitlab.nectec.or.th/-/profile/personal_access_tokens
   - Token name: `team07-push`
   - Scopes: `write_repository`
   - Click **Create** and **copy the token immediately**
7. Set the remote URL (replace `YOUR_GROUP_PATH` and `YOUR_TOKEN`):

```powershell
git remote set-url origin https://oauth2:YOUR_TOKEN@gitlab.nectec.or.th/YOUR_GROUP_PATH/team07.git
```

8. Push:

```powershell
git push -u origin main
```

### GitLab CI/CD variables
In GitLab → Settings → CI/CD → Variables, add these 3 **masked** variables:

| Variable | Value |
|----------|-------|
| `APP_AIFORTHAI_API_KEY` | Your AI for Thai key |
| `APP_LINE_CHANNEL_ACCESS_TOKEN` | Your LINE token |
| `APP_LINE_CHANNEL_SECRET` | Your LINE secret |

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
1. LINE Developers → Messaging API → Webhook URL → paste `https://YOUR-ID.ngrok-free.app/api/webhooks/line`
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
| Push fails "not found" | Create the repo on GitLab first, then set remote URL |
| Wrong token format | Token starts with `glpat-` on GitLab.com, but self-hosted may differ |
| Webhook verify fails | Check ngrok is running, URL ends with `/api/webhooks/line` |
| Bot doesn't reply | Check uvicorn terminal for errors |
| Loading animation not showing | Check server logs. LINE OA must be on a valid plan. Only works in 1-on-1 chats |
| 503 on server | Pipeline failed or container not running |

**Full testing guide:** `docs/testing_checklist.md`

---

## What you have

| File | Purpose |
|------|---------|
| `run_local.ps1` | One command: test + start uvicorn |
| `deploy.ps1` | One command: commit + push + deploy |
| `api/scripts/test_bot_local.py` | Test bot logic without LINE |
| `api/app/services/pathumma.py` | Pathumma LLM client (endpoint: `/textqa/completion`) |
| `api/app/services/sentiment.py` | Sentiment analysis via ssense |
| `docs/testing_checklist.md` | All 8 verification steps |

---

## Current status

✓ Repo configured for team07  
✓ Docker + compose ready  
✓ GitLab CI pipeline ready  
✓ AI for Thai key set  
✓ LINE token set  
✓ LINE channel secret set  
✓ Pathumma API working (endpoint fixed to `/textqa/completion`)  
✓ Loading animation fixed (uses `httpx` directly)  
