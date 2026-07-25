# How to Know the Bot is Working

## Stage 1: Local tests (before LINE)

### Test 1: Health endpoint
```powershell
cd E:\pathummalesgo\api
uvicorn app.main:app --reload --port 8000
```
Open http://127.0.0.1:8000/health in browser. Should see:
```json
{
  "status": "ok",
  "team": "team07",
  "timestamp": "2026-07-25T..."
}
```
✓ If this works → FastAPI is running

### Test 2: Bot logic (without LINE webhook)
```powershell
cd E:\pathummalesgo
.\.venv\Scripts\activate
python api\scripts\test_bot_local.py
```
You'll see:
1. Config check (all keys present?)
2. Your test message
3. Sentiment result (label + score)
4. **Pathumma's reply in Thai**

✓ If you see a Thai reply → the bot brain works, ready for LINE

### Test 3: Webhook receives POST
With uvicorn still running, in another terminal:
```powershell
curl -X POST http://127.0.0.1:8000/webhooks/line `
  -H "Content-Type: application/json" `
  -d '{\"events\":[]}'
```
Should return `{"status":"ok"}` (empty events = valid but nothing to process)

✓ If this works → webhook endpoint exists

---

## Stage 2: ngrok + LINE webhook (local server, real LINE)

### Test 4: LINE can reach your local server
```powershell
ngrok http 8000
```
Copy the https URL, then:
**LINE Developers → Messaging API → Webhook URL** = `https://abc123.ngrok-free.app/webhooks/line`

Click **Verify**. LINE will send a test POST.

✓ Green checkmark → LINE can reach you
✗ Red X → check ngrok is running, URL is correct, uvicorn is running

### Test 5: Send a real message
1. Add your bot as a friend (QR code in LINE console)
2. Send: `สวัสดี`
3. Watch the uvicorn terminal

You should see:
```
INFO: POST /webhooks/line
INFO: Received 1 LINE event(s)
INFO: Message event from user_id=U...
```

**In LINE chat:** bot replies in Thai (Pathumma's answer)

✓ If bot replies → **everything works end-to-end locally**

---

## Stage 3: Deployed on hackathon server

### Test 6: Server health
After `git push origin main` and pipeline finishes, open:
https://team07.aiforthai.in.th/api/health

Should see the same JSON as Test 1.

✓ If this works → container is running on the server

### Test 7: Webhook on production
Update LINE webhook to:
`https://team07.aiforthai.in.th/api/webhooks/line`

Click **Verify** again.

✓ Green → server webhook works

### Test 8: Real message on production
Send another message to the bot. This time it's processed by the server, not your laptop.

Watch logs at: https://team07.aiforthai.in.th/logs/
- Login: `team07`
- Password: (set by organizers, check your email or ask)

You'll see the same log pattern as Test 5.

✓ Bot replies in LINE → **Phase 1 complete, production ready**

---

## Common failure modes and how to spot them

| Symptom | Where | Cause |
|---------|-------|-------|
| `/health` 503 | Server | Container not running (check pipeline logs) |
| `/health` timeout | Server | Healthcheck failing (wrong bind address in container) |
| Webhook verify fails | Both | Wrong URL, or signature mismatch (check `LINE_CHANNEL_SECRET`) |
| Bot doesn't reply | Both | Check logs — likely Pathumma endpoint wrong or API key invalid |
| Bot replies "config error" | Both | `AIFORTHAI_API_KEY` or `PATHUMMA_ENDPOINT` not set |
| 400 signature error in logs | Both | `LINE_CHANNEL_SECRET` wrong or missing |

---

## Quick validation order (copy this)

```text
[ ] Test 1: /health returns 200
[ ] Test 2: test_bot_local.py shows Thai reply
[ ] Test 3: curl webhook returns ok
[ ] Test 4: ngrok running, LINE verify ✓
[ ] Test 5: message → bot replies locally
[ ] Test 6: server /health returns 200
[ ] Test 7: server webhook verify ✓
[ ] Test 8: message → bot replies on server
```

When all 8 pass → Phase 1 done.
