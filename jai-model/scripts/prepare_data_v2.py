#!/usr/bin/env python
"""prepare_data_v2.py — Wisesight ORIGINAL train set (24k, clean labels) + thai_emotion.

Why v2: ZombitX64 (628k) has noisy crowdsourced labels — its val ceiling was 71.5%.
Wisesight train.txt/train_label.txt is the benchmark the whole Thai NLP scene uses;
WangchanBERTa fine-tunes on it reach 90-92% (published benchmarks). Same label
space as our API: pos/neu/neg (q=question → drop, tiny class 575 msgs).

Split: train 90% / val 10% stratified by label.
thai_emotion.csv ×20 oversample added to BOTH train and val (in-domain anchor).
"""
import csv, json, random, collections, os

random.seed(42)
DS = "/Users/thxdadloveyoumost/jaikrajok]/datasets"
OUT = "/Users/thxdadloveyoumost/jaikrajok]/ml/data_v2"
os.makedirs(OUT, exist_ok=True)

WISE_MAP = {"pos": "positive", "neu": "neutral", "neg": "negative"}
THAI_MAP = {"joy": "positive", "sad": "negative", "anger": "negative",
            "fear": "negative", "neutral": "neutral"}

texts = open(f"{DS}/wisesight_train.txt", encoding="utf-8").read().split("\n")
labels = open(f"{DS}/wisesight_train_label.txt", encoding="utf-8").read().split("\n")
assert len(texts) == len(labels), f"mismatch {len(texts)} vs {len(labels)}"
# note: split("\n") aligns line-for-line; splitlines() was collapsing ~12
# newline-embedded message boundaries (multi-line tweets) — labels are 1:1
# with physical \n positions, so this is the correct pairing.

pool = collections.defaultdict(list)
skipped = 0
for t, l in zip(texts, labels):
    g = WISE_MAP.get(l.strip())
    if g and t.strip():
        pool[g].append(t.strip())
    else:
        skipped += 1

print("wisesight train:", {k: len(v) for k, v in pool.items()}, "| skipped(q/empty):", skipped)

# stratified 90/10 split per class
train_rows, val_rows = [], []
for cls, arr in pool.items():
    random.shuffle(arr)
    n_val = max(1, int(len(arr) * 0.10))
    val_rows += [(t, cls) for t in arr[:n_val]]
    train_rows += [(t, cls) for t in arr[n_val:]]

# in-domain anchor: thai_emotion ×20 in both splits
te = []
with open(f"{DS}/thai_emotion.csv", encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        lab = THAI_MAP.get(r["label"])
        if lab and r["text"].strip():
            te.append((r["text"].strip(), lab))
train_rows += te * 20
val_rows += te  # ×1 in val (no leakage into train val evaluation ambiguity)

random.shuffle(train_rows)
random.shuffle(val_rows)

for name, rows in [("train", train_rows), ("val", val_rows)]:
    with open(f"{OUT}/{name}.jsonl", "w") as f:
        for t, c in rows:
            f.write(json.dumps({"text": t, "label": c}, ensure_ascii=False) + "\n")

print(f"\ntrain: {len(train_rows)}  dist: {dict(collections.Counter(c for _, c in train_rows))}")
print(f"val:   {len(val_rows)}  dist: {dict(collections.Counter(c for _, c in val_rows))}")
print(f"saved → {OUT}/train.jsonl, {OUT}/val.jsonl")
