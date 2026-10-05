/**
 * eval-emotion.mjs — benchmark /api/emotion engine against labeled datasets.
 *
 * Usage:
 *   node eval-emotion.mjs thai       → thai_emotion.csv (100 rows, 5 emotion labels)
 *   node eval-emotion.mjs wisesight  → wisesight test set (2,674 rows, pos/neu/neg/q)
 *   node eval-emotion.mjs wisesight 500   → cap at N rows (stratified)
 */
import { classify } from "./emotion.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DS = path.join(__dirname, "..", "datasets");

const MODE = process.argv[2] || "thai";
const CAP = parseInt(process.argv[3] || "0", 10);

// map dataset labels → our 3-bucket contract
const THAI_MAP = { joy: "positive", sad: "negative", anger: "negative", fear: "negative", neutral: "neutral" };
const WISE_MAP = { pos: "positive", neu: "neutral", neg: "negative", q: "neutral" };

function loadThai() {
  const lines = fs.readFileSync(path.join(DS, "thai_emotion.csv"), "utf-8").split("\n").slice(1).filter(Boolean);
  return lines.map((l) => {
    const idx = l.lastIndexOf(",");
    return { text: l.slice(0, idx).trim(), expected: THAI_MAP[l.slice(idx + 1).trim()] };
  }).filter((r) => r.text && r.expected);
}

function loadWisesight(cap) {
  const texts = fs.readFileSync(path.join(DS, "wisesight_test.txt"), "utf-8").split("\n");
  const labels = fs.readFileSync(path.join(DS, "wisesight_test_label.txt"), "utf-8").split("\n");
  const rows = [];
  for (let i = 0; i < Math.min(texts.length, labels.length); i++) {
    const expected = WISE_MAP[labels[i].trim()];
    if (!expected || !texts[i].trim()) continue;
    rows.push({ text: texts[i].trim(), expected });
  }
  if (!cap) return rows;
  // stratified cap: proportional per class
  const byClass = {};
  for (const r of rows) (byClass[r.expected] ||= []).push(r);
  const total = rows.length;
  const out = [];
  for (const [cls, arr] of Object.entries(byClass)) {
    out.push(...arr.slice(0, Math.max(1, Math.round((arr.length / total) * cap))));
  }
  return out;
}

const rows = MODE === "wisesight" ? loadWisesight(CAP) : loadThai();
console.log(`eval on ${MODE}: ${rows.length} rows\n`);

const cm = {}; // confusion: cm[expected][predicted]++
for (const r of rows) (cm[r.expected] ||= {}), (cm[r.expected][null] = 0);
let correct = 0, n = 0;
const engineUses = {}, examples = { wrong: [] };

for (const { text, expected } of rows) {
  const res = await classify(text, { source: "eval", ssense: process.env.NO_SSENSE ? false : true });
  (cm[expected] ||= {});
  cm[expected][res.emotion] = (cm[expected][res.emotion] || 0) + 1;
  engineUses[res.signals.engine] = (engineUses[res.signals.engine] || 0) + 1;
  if (res.emotion === expected) correct++;
  else if (examples.wrong.length < 15) examples.wrong.push({ text: text.slice(0, 70), expected, got: res.emotion, engine: res.signals.engine, kw: res.signals.keywords_matched?.slice(0, 3) });
  n++;
  if (n % 500 === 0) console.log(`  ...${n} rows`);
}

console.log(`\n==== ACCURACY: ${correct}/${n} = ${(100 * correct / n).toFixed(1)}% ====\n`);

console.log("confusion matrix (rows=expected, cols=predicted):");
const cls = ["positive", "neutral", "negative"];
console.log("  " + "".padEnd(10) + cls.map((c) => c.padEnd(10)).join(""));
for (const e of cls) {
  console.log("  " + e.padEnd(10) + cls.map((p) => String(cm[e]?.[p] ?? 0).padEnd(10)).join(""));
}

console.log("\nengine usage:", engineUses);

if (examples.wrong.length) {
  console.log("\nsample mistakes:");
  for (const w of examples.wrong) console.log(`  [${w.expected}→${w.got}] (${w.engine}, kw=${JSON.stringify(w.kw)}) ${w.text}`);
}
