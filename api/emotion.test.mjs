/**
 * Regression tests for the /api/emotion engine — run: node api/emotion.test.mjs
 * These are the exact failure cases from the Oct 5 review + core invariants.
 * Every engine change must keep this green before deploy.
 */
import { classify } from "./emotion.js";

const CASES = [
  // [text, expected, why]
  ["ไม่เศร้าแล้ววันนี้สดใสขึ้น", "positive", "negation must strip เศร้า; สดใส wins"],
  ["ไม่เศร้าแล้ว", "neutral",   "negation strips the only signal word"],
  ["เมื่อวานเศร้ามาก แต่วันนี้สดใสขึ้นละ", "positive", "recovery sentence — positive outranks"],
  ["เบื่อจัง ทำอะไรดี", "neutral",  "เบื่อ demoted to neutral (review #5)"],
  ["เบื่อ", "neutral", "เบื่อ alone is boredom, not distress"],
  ["เบื่อตัวเองจัง", "negative", "compound self-directed form stays negative"],
  ["เครียดมากเลยอ่ะ", "negative", "core concern word"],
  ["มีความสุขมากค่ะวันนี้", "positive", "core positive word"],
  ["สวัสดีค่ะ", "neutral", "greeting — no signal words"],
  ["อยากตายแล้ว", "negative", "crisis word must be negative + crisis_flag"],
  ["ผลออกมาดีมาก ไม่ผิดหวังเลย ภูมิใจ", "positive", "negation + positive present"],
];

let pass = 0, fail = 0;
for (const [text, expected, why] of CASES) {
  const r = await classify(text, { source: "test", ssense: false });
  const crisisOk = typeof r.signals.crisis_flag === "boolean";
  const ok = r.emotion === expected && crisisOk;
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✓" : "✗"} [${text}] → ${r.emotion} (want ${expected}) — ${why}` +
    (ok ? "" : `  signals=${JSON.stringify(r.signals)}`));
}

// crisis flag specific check
const c = await classify("อยากตายแล้ว", { source: "test", ssense: false });
const crisisOk2 = c.signals.crisis_flag === true;
console.log(`${crisisOk2 ? "✓" : "✗"} crisis_flag set on crisis text`);
if (!crisisOk2) fail++; else pass++;

// tag path
const t = await classify("หน้าดูเป็นสุขภาพดี [อารมณ์: ยิ้มแย้ม]", { source: "test", ssense: false });
const tagOk = t.emotion === "positive" && t.signals.engine === "llm_tag";
console.log(`${tagOk ? "✓" : "✗"} llm tag path: ${t.emotion} via ${t.signals.engine}`);
if (!tagOk) fail++; else pass++;

console.log(`\n==== ${pass}/${pass + fail} PASS ====`);
process.exit(fail ? 1 : 0);
