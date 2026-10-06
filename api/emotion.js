/**
 * emotion.js — JaiKraJok's own emotion-detection API (Phase 1 hybrid + Phase 3 ensemble).
 *
 * POST /api/emotion       { text, source? }          → classify one text
 * POST /api/emotion/batch { texts: [...], source? }  → classify many (trend backfill)
 *
 * Ensemble cascade (first decisive signal wins):
 *   1. [อารมณ์: ...] tag (LLM-authored, from selfie/vision flows)
 *   2. Local keyword engine — negation-aware, positive-priority
 *   3. Fine-tuned WangchanBERTa (localhost microservice, EMOTION_MODEL_URL) —
 *      consulted when keywords find nothing; used only if confidence ≥ 0.70
 *   4. SSense (aiforthai) — last tiebreaker; neutral is not decisive
 *   5. Neutral default
 *
 * The model service is OPTIONAL: if EMOTION_MODEL_URL is unset or the service
 * is down, the cascade skips straight to SSense — the API works fully without it.
 *
 * Every response carries `signals` — the Transparent-AI contract.
 */

import { createHash } from "crypto";

// ── Word lists (single source of truth for the server side) ────────────────────
// Negation prefixes: a word directly preceded by one of these is stripped.
const NEGATION_RE =
  /(ไม่มี|ไม่เป็น|ไม่ได้|ไม่|ไร้|ปราศจาก|หมดภัย|เลิก)\s*/u;

// Checked AFTER positive — recovery sentences ("เศร้าไปหลายวัน แต่ตอนนี้สดใสแล้ว")
// must classify as positive, so positive hits win ties.
const NEGATIVE_WORDS = [
  // core (จากลิสต์เดิม)
  "เครียด", "ตึงเครียด", "กังวล", "กังวลใจ", "เศร้า", "โศก", "ท้อ", "ท้อแท้",
  "เสียใจ", "เหนื่อย", "เพลีย", "อ่อนเพลีย", "หมดแรง", "ไม่มีแรง", "นอนไม่หลับ",
  "ล้า", "โกรธ", "โมโห", "เดือด", "หดหู่", "หงุดหงิด", "รำคาญ", "กลัว", "หวาดกลัว",
  "วิตก", "วิตกกังวล", "สิ้นหวัง", "ผิดหวัง", "เจ็บปวด", "ปวดใจ", "ทุกข์", "ทรมาน",
  "กดดัน", "กลุ้ม", "กลุ้มใจ", "รับไม่ไหว", "อึดอัด", "เหงา", "เวทนาตัวเอง",
  "อยากตาย", "ฆ่าตัวตาย", "อยากหายไป", "เบื่อตัวเอง", "เกลียดตัวเอง",
  // เติมจาก thai_emotion.csv — คำความรู้สึกที่นักเรียนใช้จริง (eval pass 1: 65%)
  "แย่", "หม่น", "น้ำตาซึม", "น้ำตาไหล", "ใจหาย", "โดดเดี่ยว",
  "เหมือนคนนอก", "เหมือนส่วนเกิน", "ไม่เข้าใจ", "ไม่มีใครเข้าใจ", "ไม่มีใครฟัง",
  "ของขึ้น", "เซ็ง", "เซ็งสุดๆ", "เกลียด", "ประชด", "ต่อว่า", "ถูกโยน",
  "ระแวง", "หวั่น", "หวั่นเกรง", "ไม่ปลอดภัย", "ไม่มั่นใจ", "ไม่กล้า", "ถูกโยนความผิด", "โดนโยน",
  "มือสั่น", "หัวใจเต้นแรง", "ล้มเหลว", "สอบตก", "สอบไม่ติด", "ไม่พอ", "ไม่สามารถ", "อยากตะโกน", "ไม่ตลก",
  "ไม่ไหว", "เหนื่อยใจ", "ฝืนยิ้ม", "น้ำตา", "อยากร้องไห้", "เหวี่ยง", "อยากระบาย", "ไม่รู้จะเล่าให้ใคร",
];

// Positive list deliberately includes mild/recovery words.
const POSITIVE_WORDS = [
  "ยิ้ม", "สดใส", "ร่าเริง", "มีความสุข", "สุขใจ", "อารมณ์ดี", "ดีใจ", "ดีขึ้น",
  "สนุก", "ผ่อนคลาย", "สบาย", "สบายใจ", "โล่ง", "โล่งใจ", "โล่งอก",
  "สงบ", "ใจสงบ", "อิ่มใจ", "อิ่มเอม", "ภูมิใจ", "เยี่ยม",
  "เบิกบาน", "แจ่มใส", "สดชื่น", "ตื้นตัน", "ซาบซึ้ง", "ขอบคุณ", "รักตัวเอง",
  "ใจฟู", "อบอุ่น", "แฮปปี้", "แฮปี้", "happy", "รู้สึกดี", "ดีมาก", "กรี๊ด", "ตื่นเต้นดีใจ",
];

// Demoted from NEGATIVE_WORDS after review #5: "เบื่อ" is boredom, not distress.
// Only compound self-directed forms count as negative.
const NEUTRAL_WORDS = ["เบื่อ", "เบื่อจัง", "เบื่อแล้ว", "เบื่ออะไรไม่รู้", "เหงา",
  "ปกติ", "ตามปกติ", "เหมือนทุกวัน", "ธรรมดา", "โอเค", "เฉยๆ", "เฉย ๆ"];

const CRISIS_WORDS = ["อยากตาย", "ฆ่าตัวตาย", "อยากหายไปจากโลก", "ไม่อยากมีชีวิต", "ทำร้ายตัวเอง"];

const TAG_RE = /\[อารมณ์[:\s]+([^\]]+)\]/i;

// Context guards: happy words INSIDE sad frames must lose.
// e.g. "ต้องฝืนยิ้ม" (forced smile), "ไม่มีใครถามว่าเราโอเคไหม" (nobody asks if I'm ok)
const NEGATIVE_OVERRIDE_RES = [
  /ฝืน\s*(ยิ้ม|ขำ|หัวเราะ|สดใส|มีความสุข)/u,
  /ไม่มีใคร(ถาม|สนใจ|เข้าใจ|ฟัง|อยากฟัง)/u,
  /ไม่มี(โอกาส|ทาง|ใคร)/u,
  /แต่(ก็|ก็ต้อง|มัน)ยัง/u,
  /บางทีรู้สึก(ว่า|ว่าตัวเอง)/u,
  /ทำไมต้อง/u,
  /โดน(โยน|ดุ|หลอก|เอาเปรียบ)/u,
];

// ── helpers ────────────────────────────────────────────────────────────────────

/** Remove negated occurrences of every word in `list` from `lower`; report what was stripped. */
function stripNegated(lower, list) {
  const stripped = [];
  let out = lower;
  for (const w of list) {
    // word optionally preceded by a negation prefix
    const re = new RegExp(`(${NEGATION_RE.source})${escapeRe(w)}`, "gu");
    out = out.replace(re, (m, neg) => {
      stripped.push(`${neg.trim()}${w}`);
      return " ";
    });
  }
  return { out, stripped };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hitAny(lower, list) {
  const hits = [];
  for (const w of list) {
    if (lower.includes(w)) hits.push(w);
  }
  return hits;
}

/** Classify the [อารมณ์: ...] tag if present. Returns null when no decisive tag. */
function fromTag(text) {
  const m = text.match(TAG_RE);
  if (!m) return null;
  const tag = m[1].trim().toLowerCase();
  const negHits = NEGATIVE_WORDS.filter((w) => tag.includes(w));
  const posHits = POSITIVE_WORDS.filter((w) => tag.includes(w));
  if (posHits.length) return { emotion: "positive", matched: posHits };
  if (negHits.length) return { emotion: "negative", matched: negHits };
  return { emotion: "neutral", matched: [tag] };
}

/** SSense call — 8s budget; returns "positive" | "negative" | null. */
async function ssensePolarity(text) {
  try {
    const params = new URLSearchParams({ text: text.slice(0, 2000) });
    const res = await fetch("https://api.aiforthai.in.th/ssense", {
      method: "POST",
      headers: {
        Apikey: process.env.PATHUMMA_API_KEY ?? process.env.AIFORTHAI_API_KEY ?? "",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const p = data?.[0]?.sentiment?.polarity ?? "";
    if (p === "positive" || p === "negative") return p;
    return null; // neutral is not decisive
  } catch {
    return null;
  }
}

/** Fine-tuned model microservice (optional). Returns {emotion, confidence} or null. */
const MODEL_URL = process.env.EMOTION_MODEL_URL || "";
const MODEL_MIN_CONFIDENCE = 0.70;

async function modelPredict(text) {
  if (!MODEL_URL) return null;
  try {
    const res = await fetch(`${MODEL_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 4000) }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.emotion || typeof data?.confidence !== "number") return null;
    if (data.confidence < MODEL_MIN_CONFIDENCE) return null;  // not decisive
    return { emotion: data.emotion, confidence: data.confidence };
  } catch {
    return null;  // service down / timeout — cascade continues
  }
}

// ── core classifier ────────────────────────────────────────────────────────────

export async function classify(text, { source = "unknown", ssense = true } = {}) {
  const raw = String(text ?? "");
  const started = Date.now();

  // 1. LLM tag
  const tagResult = fromTag(raw);
  if (tagResult) {
    return respond(tagResult.emotion, {
      engine: "llm_tag",
      keywords_matched: tagResult.matched,
      negation_stripped: [],
      crisis_flag: tagResult.emotion === "negative" && crisisHit(raw),
      source, started, note: "classified from [อารมณ์] tag",
    });
  }

  const lower = raw.toLowerCase();

  // 2a. strip negated words from BOTH lists (ไม่เศร้า → เศร้า must not fire).
  // stripNegated removes the match INCLUDING the word itself, so what remains
  // cannot re-match the stripped word later — no placeholder-residue bug.
  const neg = stripNegated(lower, NEGATIVE_WORDS);
  const pos = stripNegated(lower, POSITIVE_WORDS);

  // start from the negation-cleaned text, then remove every negated positive hit too
  let cleaned = neg.out;
  for (const hit of pos.stripped) {
    cleaned = cleaned.replace(new RegExp(escapeRe(hit.replace(NEGATION_RE, "")), "gu"), " ");
  }
  cleaned = cleaned.replace(new RegExp(NEGATION_RE.source, "gu"), " ");

  const posHits = hitAny(cleaned, POSITIVE_WORDS);
  const neuHits = hitAny(cleaned, NEUTRAL_WORDS);

  // 2b-pre. context overrides — sad frames ("ไม่มีใครเข้าใจ", "ฝืนยิ้ม") force negative
  // even without a list keyword: the frame itself is the signal (data-driven, eval pass 1-3)
  const negCtx = NEGATIVE_OVERRIDE_RES.some((re) => re.test(cleaned) || re.test(lower));

  // 2b. positive-priority: recovery wins ties — UNLESS a sad frame guards the sentence
  if (posHits.length && !negCtx) {
    return respond("positive", {
      engine: "keyword",
      keywords_matched: posHits,
      negation_stripped: [...neg.stripped, ...pos.stripped],
      crisis_flag: false,
      source, started, note: "positive-priority: recovery/positive words outrank negative residue",
    });
  }

  const negHits = hitAny(cleaned, NEGATIVE_WORDS);
  if (negCtx && !negHits.length) {
    // sad frame present, no explicit keyword — trust the frame
    return respond("negative", {
      engine: "context_frame",
      keywords_matched: [],
      negation_stripped: neg.stripped,
      crisis_flag: crisisHit(raw),
      source, started, note: "negative context frame matched without keyword",
    });
  }
  if (negHits.length) {
    return respond("negative", {
      engine: "keyword",
      keywords_matched: negHits,
      negation_stripped: neg.stripped,
      crisis_flag: crisisHit(raw) || negHits.some((w) => CRISIS_WORDS.includes(w)),
      source, started, note: undefined,
    });
  }

  // 2c. neutral-only words (เบื่อ family) — decisive, do NOT escalate
  if (neuHits.length) {
    return respond("neutral", {
      engine: "keyword_neutral",
      keywords_matched: neuHits,
      negation_stripped: neg.stripped,
      crisis_flag: false,
      source, started, note: "mild/bored words deliberately neutral (review #5)",
    });
  }

  // 3. Fine-tuned model (localhost microservice) — decisive if confident
  const mp = await modelPredict(raw);
  if (mp) {
    return respond(mp.emotion, {
      engine: "wangchanberta",
      keywords_matched: [],
      negation_stripped: neg.stripped,
      crisis_flag: crisisHit(raw),
      source, started,
      note: `keyword lists found nothing; model confidence ${mp.confidence.toFixed(2)} ≥ ${MODEL_MIN_CONFIDENCE}`,
    });
  }

  // 4. SSense tiebreaker when neither keywords nor model decided
  if (ssense) {
    const polarity = await ssensePolarity(raw);
    if (polarity) {
      return respond(polarity, {
        engine: "ssense",
        keywords_matched: [],
        negation_stripped: neg.stripped,
        crisis_flag: false,
        source, started, note: "keyword lists found nothing; SSense polarity applied",
      });
    }
  }

  // 4. default
  return respond("neutral", {
    engine: "default",
    keywords_matched: [],
    negation_stripped: neg.stripped,
    crisis_flag: false,
    source, started,
    note: "no decisive signal anywhere (keywords/model/SSense)",
  });
}

function crisisHit(text) {
  return CRISIS_WORDS.some((w) => text.includes(w));
}

function respond(emotion, { engine, keywords_matched, negation_stripped, crisis_flag, source, started, note }) {
  const scores = { positive: 0, negative: 0, neutral: 0 };
  scores[emotion] = 1;
  return {
    emotion,
    scores,
    confidence: 1,
    signals: {
      engine,
      keywords_matched,
      negation_stripped,
      crisis_flag: !!crisis_flag,
      source,
      elapsed_ms: Date.now() - started,
      version: ENGINE_VERSION,
      ...(note ? { note } : {}),
    },
  };
}

export const ENGINE_VERSION = "1.0.0";

// ── HTTP surface ───────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body ?? {};

  if (Array.isArray(body.texts)) {
    const texts = body.texts.slice(0, 50).filter((t) => typeof t === "string" && t.trim());
    if (!texts.length) return res.status(400).json({ error: "texts must be a non-empty string array" });
    const results = [];
    for (const t of texts) results.push(await classify(t, { source: body.source ?? "batch" }));
    return res.status(200).json({ results });
  }

  const { text, source } = body;
  if (!text || typeof text !== "string")
    return res.status(400).json({ error: "Valid text required" });
  if (text.length > 4000) return res.status(413).json({ error: "Text too long (max 4000 chars)" });

  const result = await classify(text, { source: source ?? "api" });
  return res.status(200).json(result);
}
