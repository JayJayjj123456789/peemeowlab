# JaiKrajok (ใจกระจก) — team07

AI Emotion-Aware Study Buddy for Thai students | AI for Thai Service Onboarding Hackathon | PeeMeowLab

---

## Team info

| Item | Value |
|------|-------|
| Team | team07 |
| Scope | **Phase 1: LINE-only** (no web frontend yet) |
| LINE webhook | https://team07.aiforthai.in.th/api/webhooks/line |
| Health | https://team07.aiforthai.in.th/api/health |
| API docs | https://team07.aiforthai.in.th/api/docs |
| Dozzle logs | https://team07.aiforthai.in.th/logs/ |
| Ports | BASE_1 **20061** (api) / 20060 reserved for future frontend |
| GitLab | https://gitlab.nectec.or.th/ai4thai-service-hackatho/team07/ |

Since there is no frontend yet, `https://team07.aiforthai.in.th/` returns 503.
That is expected — all traffic goes through `/api/`.

---

## Local development

### 1. Clone and virtualenv

```bash
cd pathummalesgo
py -3.12 -m venv .venv
.\.venv\Scripts\activate          # Windows
pip install -r api/requirements.txt
```

### 2. Environment

```bash
copy .env.example .env
# fill in AIFORTHAI_API_KEY, LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET
```

### 3. Run API locally

```bash
cd api
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- Health: http://127.0.0.1:8000/health
- Docs: http://127.0.0.1:8000/docs

### 4. Smoke test AI services

```bash
python api/scripts/test_aiforthai_apis.py
```

### 5. LINE webhook (local dev only)

Use ngrok while developing locally — not needed after deploy to hackathon server:

```bash
ngrok http 8000
# set webhook to: https://<id>.ngrok-free.app/webhooks/line
```

On the server the webhook is:
```
https://team07.aiforthai.in.th/api/webhooks/line
```

---

## Deploy to hackathon server

Push to **main** branch — the GitLab CI pipeline handles everything:

```bash
git add .
git commit -m "feat: describe change"
git push origin main
# watch: GitLab > Build > Pipelines
```

**Stages:** `check` (validates compose rules) → `deploy` (docker compose up) → `ops` (manual buttons)

### Secrets (API keys)

Never commit real keys. Add them in GitLab → Settings → CI/CD → Variables:

| Variable | Contains | Required |
|----------|----------|----------|
| `APP_LINE_CHANNEL_ACCESS_TOKEN` | LINE token | yes |
| `APP_LINE_CHANNEL_SECRET` | LINE channel secret | yes |
| `APP_AIFORTHAI_API_KEY` | AI for Thai key | yes |
| `APP_PATHUMMA_ENDPOINT` | only if custom endpoint | no |

Tick **Masked** on all of them. The deploy job writes every `APP_*` variable
into `.env` before `docker compose up`.

> If a token ever appears in a chat, screenshot, or commit, rotate it in the
> LINE Developers console and update the GitLab variable.

### Manual ops (replaces SSH)

GitLab → Build → Pipelines → stage `ops` → press ▶

| Job | Does |
|-----|------|
| `logs` | Show last 400 lines |
| `ps` | Container status + stats |
| `restart` | Restart all services |
| `smoke-ai` | Run AI smoke test script |
| `shell-cmd` | Run any command in a container (set SERVICE + CMD) |

---

## Project layout

```text
docker-compose.yml          # hackathon deploy config
.gitlab-ci.yml              # CI pipeline (check / deploy / ops)
.env.example                # copy to .env for local dev
api/
  Dockerfile                # python:3.12-slim, listens 0.0.0.0:8000
  .dockerignore
  requirements.txt
  app/
    main.py                 # FastAPI + root_path + /health
    config.py
    api/webhooks/line.py    # LINE Messaging API webhook
    services/               # Pathumma, Sentiment, Face, STT, TTS, OCR
    bots/conversation.py    # chat flow
    utils/
  scripts/
    test_aiforthai_apis.py  # smoke tests
docs/
  phase1_implementation_plan.md
  api_notes.md
```

---

## Notes for teammates

- Feature branches + MR into `main` (deploy triggers on `main` only)
- LINE webhook route is `/webhooks/line` in code; `/api/webhooks/line` publicly
- Do not add relative bind mounts (`./data`) — use `/data/hack/team07/...`
- All API keys go in GitLab Variables (prefix `APP_`), not in `.env` committed
- Check Dozzle for live logs before opening a support ticket
