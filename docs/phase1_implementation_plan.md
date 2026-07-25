# Phase 1 Implementation Plan — JaiKrajok (ใจกระจก)

**Project:** JaiKrajok — AI Emotion-Aware Study Buddy  
**Program:** AI for Thai Service Onboarding  
**Team:** PeeMeowLab  
**Phase:** 1 — Setup, API Integration & LINE Conversation Flow  
**VCS / collaboration:** **GitLab** (team repo)  
**Suggested window:** 5 working days (aligns with proposal: 23–27 Feb 2569)

---

## Goal

Get the foundation running — integrate AI for Thai / Pathumma APIs, stand up a basic backend, and make a **LINE OA bot** that can hold a simple conversation and call the core AI services.

**Target outcome:** Working LINE bot + API gateway skeleton + verified access to Pathumma LLM and AI for Thai services (Face, Sentiment, STT, TTS, OCR).

---

## 1. Phase 1 objectives

| # | Objective | Done when |
|---|-----------|-----------|
| 1 | Team + GitLab env ready | Group/project, protected branches, secrets policy, coding standards set |
| 2 | AI for Thai / Pathumma access | All 6 APIs callable from backend with test scripts |
| 3 | Backend skeleton | API Gateway + auth stub + logging |
| 4 | LINE OA bot | Receive message → reply via LINE Messaging API |
| 5 | Conversation flow v0 | Greeting, study Q&A (Pathumma), emotion-from-text (Sentiment) |
| 6 | Demo checklist | Short demo script + known limitations documented |

**Out of scope for Phase 1** (later weeks): full multimodal pipeline, OCR study flow, emotion trend dashboard, polished web UI, fine-tuning.

---

## 2. GitLab collaboration setup (do this first)

Because the team works on **GitLab**, Phase 1 starts with a shared, safe workflow—not only local code.

### 2.0 Critical: stop using one shared GitLab login

**Current risk:** the whole team logs in with the **same GitLab account / email**.

That must change before serious parallel work. A shared account breaks ownership, reviews, security, and audit history.

| Why shared login is bad | Impact on JaiKrajok |
|-------------------------|---------------------|
| No real author history | Cannot tell who broke Pathumma/LINE code |
| Fake code review | Same person merges their own MR as "reviewer" |
| Secret blast radius | One password leak = full repo + CI variables |
| Cannot revoke one person | Leaving teammate still has "the" password |
| LINE/API blame | Hard to debug who rotated or leaked a key |
| GitLab good practice | Accounts are meant to be individual |

#### Required model (do this ASAP)

| Person | Needs |
|--------|--------|
| Each teammate | **Own GitLab user** + own email + own password/2FA |
| Project | Invite each user as **Developer** (or **Maintainer** for 1-2 leads only) |
| Git on each laptop | `user.name` + `user.email` matching **that person** |

```bash
# On EACH person's machine (use THEIR email, not a shared one)
git config --global user.name "Firstname Lastname"
git config --global user.email "their.own.email@example.com"
git config --global --get user.name
git config --global --get user.email
```

#### Migration steps (Day 0 — before more commits)

1. **Pick one Maintainer** (project owner) with a personal GitLab account.
2. Create/transfer the project under that account or a **PeeMeowLab group** (preferred).
3. Every other member creates their **own** GitLab account (free tier is fine).
4. Maintainer invites them: **Settings -> Members** -> role **Developer** (Maintainer only for leads).
5. **Change the shared account password** (or stop using it) after everyone has personal access.
6. Enable **2FA** on Maintainer accounts at minimum.
7. Each person re-clones (or updates remote) and sets **personal** `user.name` / `user.email`.
8. Optional: old commits may still show the shared identity — OK for a short prototype if you migrate now; new commits must use personal identity.

#### What you may still share (OK)

| Shared | Not shared |
|--------|------------|
| GitLab **project/group** | GitLab **login password** |
| Repo URL | Other people's personal access tokens |
| Issue board, labels, MRs | One human acting as two reviewers |
| CI variable *names* in README | Pasting real API keys into chat/issues |
| LINE OA admin (1 owner + 1 backup) | Committing as "the team" on one account |

#### Interim only (if personal accounts are delayed by under 24h)

- Creating personal accounts is still the **first** task.
- Do **not** put production LINE/AI keys only in a shared browser profile.
- Do **not** approve your own MRs by re-logging as the same user.
- Until personal accounts exist: **single-writer** rule (only one person pushes) — then unlock parallel MRs after invites.

**Phase 1 exit criterion add-on:** every PeeMeowLab member has a **distinct** GitLab identity on the project; no day-to-day use of a shared login.

### 2.1 Project setup

- [ ] Create a **private** GitLab project (or under PeeMeowLab group): e.g. `peemeowlab/jaikrajok`
- [ ] Add **each person as their own GitLab user** (never one shared login) with clear roles:
  - **Maintainer** (1–2 people): protect `main`, merge MRs, manage CI variables
  - **Developer**: push feature branches, open Merge Requests
- [ ] Enable: Merge Requests, Issue tracker (prefer living docs in `/docs`)
- [ ] Default branch: **`main`** (stable only)
- [ ] Protect `main`: no direct push; MR required; at least **1 approval** if team has 2+; pipeline must pass once CI exists

### 2.2 Branching strategy (simple for 4-week sprint)

```text
main              <- always demo-able / stable
  └── feature/<area>-<short-name>
  └── fix/<short-name>
  └── docs/<short-name>
```

**Phase 1 recommendation (small team):**

- Branch from `main`
- Example names: `feature/backend-fastapi-skeleton`, `feature/line-webhook`, `feature/pathumma-client`, `feature/sentiment-client`, `docs/phase1-plan`
- Open an **MR early** (Draft MR is OK)
- Agree on squash merge vs regular merge and stick to one rule

### 2.3 Issues and board

Create a **GitLab Issue Board** with labels:

| Label | Meaning |
|-------|---------|
| `phase::1` | Phase 1 work |
| `type::feature` / `type::bug` / `type::docs` / `type::chore` | Work type |
| `area::backend` / `area::line` / `area::ai` / `area::devops` | Ownership area |
| `priority::P0` / `P1` / `P2` | Urgency |
| `blocked` | Waiting on keys, API, or another person |

**Seed Phase 1 issues:**

1. Bootstrap repo structure + README + `.gitignore` + `.env.example`
2. AI for Thai API smoke test script
3. Pathumma service wrapper
4. Sentiment service wrapper
5. FastAPI app + `/health` + config
6. LINE webhook + signature verify
7. Conversation flow v0 (menu / study / emotion / help)
8. Face / STT / TTS / OCR smoke tests
9. `.gitlab-ci.yml` lint/test job
10. Phase 1 demo script + known issues doc

Assign **one assignee** per issue; due dates aligned to Day 1–5.

### 2.4 Merge Request rules

Every MR should include:

- [ ] Linked Issue (`Closes #123` or `Related to #123`)
- [ ] What changed (short)
- [ ] How to test (commands / LINE steps)
- [ ] Screenshots or sample API responses when relevant
- [ ] No secrets in diff
- [ ] Updated docs if behavior changed

**Reviewer checks:** runs locally or CI green; timeouts/errors for external APIs; no tokens/biometric data in logs; Thai copy clear enough for demo.

### 2.5 Secrets and GitLab CI/CD variables

**Never commit** real keys.

| Secret | Where |
|--------|--------|
| Local dev | `.env` (gitignored) |
| Shared team reference | GitLab **masked** CI/CD variables (Maintainer only) and/or password manager |
| LINE / AI for Thai keys | `AIFORTHAI_API_KEY`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, etc. |

GitLab → **Settings → CI/CD → Variables**: mask + protect; document variable **names** in README only.

Also add:

- `.gitignore` (`.env`, `venv/`, `__pycache__/`, IDE folders, local media)
- `.env.example` with empty placeholders only

### 2.6 Suggested lightweight CI (Phase 1)

Add `.gitlab-ci.yml` early:

```yaml
stages:
  - check

lint:
  stage: check
  image: python:3.11-slim
  script:
    - pip install -r requirements.txt
    - python -m compileall app scripts
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == "main"
```

Do **not** call quota-limited AI for Thai APIs on every pipeline—use mocks/unit tests; run real smoke tests locally.

### 2.7 Communication habits

- Daily: done / doing / blocked on Issue comments or team chat
- Blockers → label `blocked` + tag Maintainer same day
- Prefer **MR discussion** for code decisions
- Coordinate **one active LINE webhook tunnel** at a time (post ngrok URL in chat, never commit)

---

## 3. Prerequisites (Day 0 / before coding)

### Accounts and keys

- [ ] **AI for Thai** account (`aiforthai.in.th`) + API key(s)
- [ ] Confirm access for Pathumma LLM, Face, Sentiment, STT, TTS, OCR
- [ ] **LINE Developers** Messaging API channel + token/secret; single admin + backup
- [ ] Optional Hugging Face later (not required if using AI for Thai API)
- [ ] **GitLab** access for every teammate (SSH key or PAT)

### Tooling

- [ ] Python 3.11+
- [ ] Git + GitLab clone for all members
- [ ] `.env` for secrets
- [ ] Postman / Bruno / curl
- [ ] ngrok or Cloudflare Tunnel
- [ ] Agree on same Python version as a team

### Suggested repo structure

```text
jaikrajok/
├── .env.example
├── .gitignore
├── .gitlab-ci.yml
├── README.md
├── requirements.txt
├── app/
│   ├── main.py
│   ├── config.py
│   ├── api/
│   │   ├── gateway.py
│   │   └── webhooks/line.py
│   ├── services/
│   │   ├── pathumma.py
│   │   ├── sentiment.py
│   │   ├── face.py
│   │   ├── stt.py
│   │   ├── tts.py
│   │   └── ocr.py
│   ├── bots/
│   │   └── conversation.py
│   └── utils/
│       ├── logging.py
│       └── security.py
├── scripts/
│   └── test_aiforthai_apis.py
└── docs/
    ├── phase1_implementation_plan.md
    └── phase1_demo.md
```

---

## 4. Day-by-day plan

### Day 1 — Setup and API access (+ GitLab bootstrap)

**Theme:** Repo is shared; can we call the AI services?

#### Tasks

1. **Personal GitLab accounts for all** (no shared login); create/invite project; protect `main`; labels/board; seed Issues.
2. First MR: skeleton + README + `.gitignore` + `.env.example`.
3. Local venv + `requirements.txt` (`fastapi`, `uvicorn`, `httpx`, `python-dotenv`, `line-bot-sdk`, `pydantic-settings`).
4. Maintainers define how devs get `.env` safely; optional masked CI variables.
5. Write `scripts/test_aiforthai_apis.py` for Pathumma, Sentiment, Face, STT, TTS, OCR.
6. Document API shapes in `docs/api_notes.md` (redacted samples only).
7. Stack decision: FastAPI + LINE only for Phase 1.
8. Minimal `.gitlab-ci.yml`.

#### Exit criteria

- Everyone can clone and follow README.
- Pathumma + Sentiment + LINE credentials verified; noted on Issues.
- Other APIs working or `blocked` with owner + next step.

#### Suggested split

| Person A | Person B | Person C |
|----------|----------|----------|
| GitLab, CI, README, structure | Pathumma + Sentiment smoke | LINE channel + other API smokes |

---

### Day 2 — Backend skeleton and API Gateway

**Theme:** One place to call AI safely.

#### Tasks

1. FastAPI: `GET /health`, `POST /webhooks/line` on a feature branch.
2. Config from env.
3. Service wrappers: timeout, limited retries, structured errors, safe logs.
4. Gateway: request id, LINE signature check, routing, centralized errors.
5. Open MR(s); review for secret leaks.

#### Exit criteria

- Backend runs for all via README.
- Wrappers callable; LINE signature verify in place.
- MR merged or ready.

---

### Day 3 — LINE OA + Conversation Flow v0

**Theme:** Student can chat on LINE.

#### Tasks

1. Webhook → tunnel → `/webhooks/line`.
2. Only one public webhook URL active; coordinate owner for the day.
3. Events: follow → welcome; text → reply.
4. Flow v0 (in-memory OK): START menu → STUDY (Pathumma) / EMOTION_TEXT (Sentiment) / HELP (privacy + 1323).
5. Pathumma prompt: Thai study buddy, supportive, no diagnosis.
6. Crisis keyword boilerplate.
7. Short screen capture for MR (no secrets).

#### Exit criteria

- LINE text → Pathumma answer; Sentiment path works; welcome/help work; flow documented.

---

### Day 4 — Remaining AI services (smoke)

**Theme:** Prove integrations exist.

#### Tasks

1. TTS / STT / Face / OCR smoke (LINE handlers optional).
2. Normalize internal response shape (`service`, `ok`, `label`, `score`, `raw`).
3. In-memory rate limit per user.
4. Board update: pass/fail per API with redacted evidence.

#### Exit criteria

- All 6 APIs documented pass/fail; Pathumma + Sentiment live in LINE; MRs merged.

---

### Day 5 — Hardening, demo, Phase 2 handoff

**Theme:** Demo-ready; GitLab `main` clean.

#### Tasks

1. Fix timeouts / empty messages / 401 / 429.
2. `docs/phase1_demo.md`.
3. Close Phase 1 Issues; open Phase 2 epic/issues.
4. Phase 2 interface contract in `docs/`.
5. Optional tag/release `phase1-demo`.
6. 30-min retro.

#### Exit criteria

- Stable demo; onboarding via README + Issues; Phase 2 backlog on GitLab; protected `main`.

---

## 5. Technical design (Phase 1 scope)

### Request flow

```text
LINE User → LINE Platform → /webhooks/line → verify signature
  → router: study | emotion | help → LINE reply
```

### Data and security

- No DB required in Phase 1 (in-memory session OK).
- Secrets only in `.env` / GitLab masked variables.
- No PII, student chats, or face photos committed to GitLab.
- LINE signature check; privacy + helpline messaging.

---

## 6. Team roles (GitLab-oriented)

| Role | Focus | GitLab duties |
|------|--------|---------------|
| Maintainer / Tech lead | Architecture, reviews | Protect `main`, approvals, CI variables |
| Backend lead | FastAPI, gateway, wrappers | `area::backend` Issues/MRs |
| LINE / UX | OA, copy, quick replies | `area::line`, demo |
| AI integration | Pathumma + AI for Thai | `area::ai`, api notes |
| All | Demo rehearsal | Blockers early; review ≥1 MR |

---

## 7. Deliverables checklist

- [ ] **No shared GitLab login** — each member has own account + personal git identity
- [ ] Private GitLab project + protected `main`
- [ ] Issue board; Phase 1 issues closed/moved
- [ ] Runnable backend on `main`
- [ ] `.env.example`, `.gitignore`, README
- [ ] Minimal `.gitlab-ci.yml` green on MRs
- [ ] LINE OA welcome + study Q&A
- [ ] Pathumma + Sentiment integrated
- [ ] Face/STT/TTS/OCR smoke documented
- [ ] Logging + error handling
- [ ] Demo script + limitations
- [ ] Phase 2 contract + Issues
- [ ] Optional release `phase1-demo`

---

## 8. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| API key/quota | Keys Day 1; offline samples; `blocked` Issue |
| Pathumma latency | Timeouts; short prompts; fallback text |
| Webhook exposure | One tunnel owner; or small cloud deploy |
| Shared GitLab login | Separate accounts Day 0; revoke shared password; 2FA on Maintainers |
| Secrets in GitLab | gitignore + MR review + rotate + masked vars |
| Merge conflicts | Small MRs; Draft early; file ownership |
| Scope creep multimodal | Smoke only in Phase 1 |
| Safety edge cases | Keywords + disclaimer + 1323 |

---

## 9. Definition of Done

1. Real LINE user gets Thai study answer from Pathumma.
2. Emotion-from-text via Sentiment works.
3. Structure ready for Emotion Pipeline in Phase 2.
4. Under-5-minute stable demo.
5. Everything on **GitLab `main`**, secrets out of repo, new teammate can onboard from README + Issues.
6. **Each teammate uses their own GitLab account** (shared login retired).

---

## 10. Immediate next actions

1. **Break shared login:** each PeeMeowLab member creates a personal GitLab account; Maintainer invites them; retire the shared password.
2. Create/confirm private GitLab project; protect `main`; labels/board.
3. Each person sets personal `git config user.name` and `user.email` (not the shared email).
4. Seed and assign Phase 1 Issues.
5. First MR: skeleton + README + gitignore + env example.
6. Confirm AI for Thai + LINE credentials; store safely (Maintainer: GitLab masked variables / password manager).
7. Smoke Pathumma + Sentiment; comment on Issues.
8. FastAPI `/health` feature branch -> MR.
9. LINE echo bot -> then Pathumma.

## 11. Bridge to Phase 2

Build next: fused emotion (Face + Sentiment), multimodal handling, emotion-conditioned prompts, short-term memory.

Track as GitLab **Epic/Milestone** + child Issues.

### Interface contract (draft)

**Input:** `{ "user_id", "text?", "image?", "audio?" }`  
**Output:** `{ "emotion", "confidence", "study_reply", "safety_flag" }`

---

## Related docs

- Proposal PDF (JaiKrajok / PeeMeowLab)
- `docs/phase1_demo.md` (to add)
- `docs/api_notes.md` (to add)
- `docs/phase1_implementation_plan.md` (this file)

---

## 12. Deployment — AI for Thai hackathon server (team07)

Deployment is fully automated through the event GitLab. **No SSH access.**

### Team facts

| Item | Value |
|------|-------|
| Team | **team07** |
| Public URL | `https://team07.aiforthai.in.th` |
| API base | `https://team07.aiforthai.in.th/api/` |
| Health | `https://team07.aiforthai.in.th/api/health` |
| Docs | `https://team07.aiforthai.in.th/api/docs` |
| Live logs (Dozzle) | `https://team07.aiforthai.in.th/logs/` (login `team07`) |
| Port range | **20060 - 20069** |
| BASE (frontend) | **20060** |
| BASE_1 (api) | **20061** |
| GitLab | `gitlab.nectec.or.th/ai4thai-service-hackatho/team07/<repo>` |

Port math: `base = 20000 + (7 - 1) * 10 = 20060`

### How to deploy

```bash
git add .
git commit -m "feat: ..."
git push origin main          # deploy runs only on main
```

Pipeline stages: **check** (compose rules) -> **deploy** (build + up + health wait) -> **ops** (manual buttons).

Other branches run `check` only, which is useful before merging an MR.

### Non-negotiable server rules

1. Ports bind `127.0.0.1` only, inside 20060-20069
2. Every service needs `deploy.resources.limits` (team total under ~13 GB)
3. `api` must have a `healthcheck`
4. `logging` with `max-size` required
5. Bind mounts must be absolute under `/data/hack/team07/`

### Backend requirements (already applied in this repo)

| Requirement | Where |
|-------------|-------|
| `root_path` from `ROOT_PATH` | `api/app/main.py` |
| `/health` returning 200 | `api/app/main.py` |
| Listen `0.0.0.0:8000` in container | `api/Dockerfile` CMD |
| Routes unprefixed (`/health`, not `/api/health`) | proxy strips `/api` |

### Secrets

Add in GitLab -> Settings -> CI/CD -> Variables, **prefix `APP_`**, tick **Masked**:

- `APP_AIFORTHAI_API_KEY`
- `APP_LINE_CHANNEL_ACCESS_TOKEN`
- `APP_LINE_CHANNEL_SECRET`
- `APP_PATHUMMA_ENDPOINT` (if custom)

The deploy job writes all `APP_*` vars into `.env` automatically. Never commit real keys.

### LINE webhook after deploy

```text
https://team07.aiforthai.in.th/api/webhooks/line
```

ngrok is only needed for local development. Route in code stays `/webhooks/line`.

### Manual ops instead of SSH

GitLab -> Build -> Pipelines -> stage `ops` -> press the play button:

| Job | Purpose |
|-----|---------|
| `logs` | last 400 log lines |
| `ps` | container status + resource stats |
| `restart` | restart services |
| `smoke-ai` | run `scripts/test_aiforthai_apis.py` inside the container |
| `shell-cmd` | arbitrary command (set `SERVICE`, `CMD`) |

Prefer **Dozzle** (`/logs/`) for realtime debugging - no runner queue.

### Constraints

- Job timeout **20 min**, max **3 concurrent jobs** per team
- **CPU only**, no GPU
- Data in `/data/hack/team07/` survives redeploy
- Database not reachable from your laptop; use `shell-cmd` or request Adminer on a port in 20062-20069

### Common failures

| Symptom | Cause |
|---------|-------|
| 503 | container down, or app bound to `127.0.0.1` inside container |
| `/api/...` 404 | route written as `/api/x` instead of `/x` |
| `/api/docs` blank | `root_path` not set |
| Job stuck pending | runner has tags; add `tags:` in `.gitlab-ci.yml` |

### Phase 1 deploy checklist

- [ ] Repo pushed to team07 GitLab project
- [ ] `.gitlab-ci.yml` variables = team07 / 20060 / 20061
- [ ] `check` stage green
- [ ] `APP_*` secrets set as Masked variables
- [ ] `deploy` green and `/api/health` returns 200
- [ ] LINE webhook switched to the server URL
- [ ] Dozzle access verified
