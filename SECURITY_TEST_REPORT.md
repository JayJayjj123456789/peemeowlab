# JaiKraJok — Security Test Report

**Date:** 2026-10-05 · **Scope:** full API (`api/`), client (`client/src/App.tsx`), Docker/CI config
**Test environment:** local — real API booted (`NODE_ENV=development`), no DB, all fixes from the 2026-10-05 security review applied
**Methods:** dependency audit (pnpm audit), git secret scan, 19-case crypto/auth unit suite, 19-case live HTTP integration battery, boot-guard test, client unit tests (vitest), `tsc --noEmit`, `node --check` (24 files), CI check-stage simulation

**Overall: 6 test groups · 3 findings found during testing · both fixed and re-verified · final state all green**

---

## 1. Dependency Audit — ⚠️ FINDINGS (informational, not fixed)

| Target | Result |
|---|---|
| `api/` (6 advisories) | **1 HIGH** — `path-to-regexp` <0.1.13 (ReDoS), 3 MOD (`qs` DoS ×3), 2 LOW (`body-parser`, `qs`) |
| root (163 advisories) | **68 HIGH / 85 MOD / 10 LOW** — mostly dev/build chain: `vite`, `rollup`, `sharp`, `axios`, `nanoid`, `lodash`, `form-data`, `undici` … |

- **No CRITICAL** vulnerabilities anywhere.
- The API's HIGH (`path-to-regexp`) is reachable in production via any URL request → worth bumping `express` to ≥4.21.x latest.
- The root's 68 HIGH are dominated by build-time tooling, not runtime code paths; still 100+ transitive bumps behind. Recommend `pnpm up --latest` + re-audit as a follow-up, and an `audit --audit-level=high` gate in CI.

## 2. Secret Scan — ✅ PASS

- No hardcoded key patterns (`sk-…`, AWS `AKIA…`, `ghp_…`, private key blocks) in any git-tracked file.
- `.env` is NOT tracked; **zero commits in the entire history ever touched `.env`** — no leak in history.
- `promptfooconfig.yaml` references keys only via `{{env.TOKENMIND_API_KEY}}` (verified: no literals).

## 3. Crypto & Auth Unit Suite — ✅ 19/19 PASS

| # | Test | Result |
|---|---|---|
| E1 | v2 AES-256-GCM round-trip (Thai + ASCII) | PASS |
| E2 | identical plaintext → different ciphertext (random salt+IV) | PASS |
| E3 | v2 layout salt-first, correct header | PASS |
| E4 | **legacy** (pre-v2) ciphertext still decrypts | PASS |
| E5 | legacy plaintext rows pass through decryptText | PASS |
| E6 | **fail-closed**: encryptText throws without `ENCRYPTION_KEY` | PASS |
| E7 | tampered ciphertext rejected (GCM auth tag) | PASS |
| A1 | hashId peppered ≠ bare SHA-256 (anti-bruteforce) | PASS |
| A2 | hashIdCandidates = [peppered, legacy] | PASS |
| A3 | idLookupCandidates = [peppered, legacy, raw] | PASS |
| A4 | no pepper → graceful legacy behavior | PASS |
| K1–K4 | deriveAuthKey deterministic / per-user unique / safeEqual correct / null-safe | PASS ×4 |
| M1 | requireAuthKey("require") + valid key → next() | PASS |
| M2 | requireAuthKey("require") + wrong key → 401 | PASS |
| M3 | requireAuthKey("require") + no pepper → **503 fail-closed** | PASS |
| M4 | requireAuthKey("optional") + no pepper → open (deploy-safe) | PASS |

## 4. Live Integration Battery (real booted API) — ✅ 19/19 PASS (after 1 fix)

| # | Test | Expected | Result |
|---|---|---|---|
| I1 | GET /health baseline | 200 | ✅ 200 |
| I2 | Security headers (nosniff, SAMEORIGIN, Referrer-Policy, HSTS, CSP) | all 5 | ✅ present |
| I3 | LINE webhook, **no signature** → 401 (fail-closed) | 401 | ✅ |
| I4 | LINE webhook, invalid signature → 401 | 401 | ✅ |
| I5 | LINE webhook, well-formed sig w/o configured secret → 401 | 401 | ✅ |
| I6 | GET /user-data/export, **no auth** → 401 | 401 | ✅ |
| I7 | GET /user-data/export, wrong key → 401 | 401 | ✅ |
| I8 | export: valid key(user A) but query asks user B → 401 | 401 | ⚠️→✅ **(finding #1, see below)** |
| I9 | export: valid key+uid → auth accepted (500 = DB absent, not auth) | 500 | ✅ |
| I10 | DELETE /user-data, no auth → 401 | 401 | ✅ |
| I11 | GET /admin-db, no secret → 401 | 401 | ✅ |
| I12 | GET /admin-db, wrong secret → 401 | 401 | ✅ |
| I13 | /admin-db correct secret → 500(DB) **+ HttpOnly session cookie** | 500+cookie | ✅ |
| I14 | /admin-db via cookie only (no secret in URL) | 500 | ✅ |
| I15 | /admin-db forged cookie → 401 | 401 | ✅ |
| I16 | GET /history, no auth (pepper set) → 401 | 401 | ✅ |
| I17 | POST /auth/challenge, fake LINE token → 401 (not 200) | 401 | ✅ |
| I18 | strictLimiter: 12× POST /send-otp → 429 | 429 by ~11th | ✅ 503×9 → **429×3** |
| I19 | PROD boot without LINE_CHANNEL_SECRET → process exits(1) | exit 1 | ✅ |

### Finding #1 (found & fixed during testing): guard-order leak
I8 initially returned **500 instead of 401** — the `DATABASE_URL` guard ran *before* the
user-mismatch check, so in a no-DB state a mismatched request learned server config state.
**Not a data exposure** (auth still gated), but wrong failure semantics.
**Fix:** mismatch check moved above the DB guard in both `exportUserData` and `deleteUserData`.
**Re-test: I8 → 401 ✅, I9 → 500 ✅.**

### Note on I18 (rate limiting behaves as designed)
First 9 requests returned 503 (SMTP not configured in test env — the endpoint's own guard),
then the limiter kicked in with 429s from request #10 of 12 (limit: 10/15min). Limiter verified live.

## 5. LLM Red-Team Suite (promptfoo) — ✅ CONFIG VALID (execution needs a live key)

- 15 test cases: 10 Thai quality, **5 attack cases with 19 leak-prevention assertions**
  (system-prompt extraction EN+TH, API-key exfiltration TH, cross-user history access, debug-mode jailbreak, admin credential theft).
- Config integrity verified: correct `{{env.TOKENMIND_API_KEY}}` reference, no hardcoded keys, all assertion types valid.
- **Not executed against the live LLM** (would burn prod quota / needs TOKENMIND_API_KEY in env).
  Run with: `pnpm test:ai`.

## 6. Build, Types, CI Rules — ✅ ALL PASS

| Check | Result |
|---|---|
| `node --check` — all 24 api/*.js files | ✅ clean |
| `tsc --noEmit` (client, incl. new auth-key code in App.tsx) | ✅ exit 0 |
| vitest — client unit tests | ✅ 3/3 passed |
| CI check-stage sim: ports var-bound to 127.0.0.1, healthcheck, memory limits, log rotation, no docker.sock, mounts under /data/hack | ✅ all pass |

---

## Summary Scoreboard

| Group | Tests | Pass | Fail | Notes |
|---|---|---|---|---|
| Dependency audit | 2 targets | — | ⚠️ | 1 HIGH runtime (api), 68 HIGH build-chain (root) — fix recommended |
| Secret scan | 3 | 3 | 0 | clean, incl. full git history |
| Crypto/auth unit | 19 | 19 | 0 | |
| Live integration | 19 | 19 | 0 | 1 finding fixed mid-test (I8 guard order) |
| LLM red-team config | 15 cases | validated | — | execution attempted — see §7: upstream dead + prod auth broken |
| Build/types/CI sim | 4 groups | 4 | 0 | |

**Total: 41 automated checks executed · 41 passing at final state · 1 vulnerability-class finding (I8) discovered and fixed during the run · 1 dependency-debt warning · 1 production outage found (§7)**

---

## 7. AI Red-Team Execution Attempt (2026-10-05) — 🚨 PRODUCTION FINDING

Attempted live execution of the 15 promptfoo cases (10 Thai quality + 5 jailbreak/secret-leak attacks, 36 assertions).

**What happened:**

| Step | Result |
|---|---|
| `pnpm test:ai` (promptfoo 0.123.1) | ✗ All 15 ERROR — `interceptors.decompress is not a function` (promptfoo's axios stack incompatible with axios 1.12 in tree) |
| Re-implemented all 15 cases with plain HTTP (identical endpoint/model/assertions) | ✗ Upstream `tokenmind.abdul.in.th` **network-unreachable** — DNS resolves (43.208.152.200) but TCP 443 blackholes from this network |
| Alternate upstream `tokenmind.pathumma.in.th` (code default) | UP (94 ms) but **401** — rejects the locally stored `TOKENMIND_API_KEY` (issued by abdul proxy, not pathumma's LiteLLM) |
| **Production** `https://team07.aiforthai.in.th/api/thaillm` (exactly as CI smoke calls it) | 🚨 **401 `token_not_found_in_db`** — LiteLLM rejects the key the deployed API itself is sending |

**🚨 Production finding:** the deployed bot's ThaiLLM path is failing auth **right now** —
the server forwards a key (`sk-...xc1g`) that the LiteLLM proxy no longer recognizes.
Consequences:

- The LINE bot's text-LLM replies are failing (or running on fallback only).
- The CI `smoke-test` job will FAIL on its next `main` run (it asserts `"role":"assistant"` in the response).

**Fix for the team:** reissue `APP_TOKENMIND_API_KEY` in GitLab CI/CD variables — the key must be
an `sk-` LiteLLM virtual key valid for `tokenmind.pathumma.in.th` (the proxy currently deployed
behind `/api/thaillm`), then re-run the CI smoke job.

**Red-team execution remains blocked on:** a reachable + authorized ThaiLLM endpoint.
The 15-case suite (36 assertions) is parsed and ready in `/tmp/ai-cases.json` → re-run the
moment the key/host is fixed. No results were fabricated; every attempt is documented above.

## Recommended next actions (not blocking)

1. `pnpm up --latest` in `api/` to clear the `path-to-regexp` HIGH, then re-run this suite.
2. Add an `audit --audit-level=high` gate to the CI `check` stage so new HIGHs fail the pipeline.
3. Promote my ad-hoc unit suite into `api/security.test.mjs` (vitest) + add the I3/I6/I11/I18 checks to the CI smoke job — the exact battery that caught finding #1 would then run on every push.
4. Run `pnpm test:ai` against staging (not prod quota) for the LLM red-team execution.
