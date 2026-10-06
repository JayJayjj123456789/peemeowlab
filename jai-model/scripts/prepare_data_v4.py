#!/usr/bin/env python
"""prepare_data_v4.py — Wisesight train (clean) + thai_emotion ×20 + SYNTHETIC 2.8k.

v4 changes vs v3:
  + synthetic_clean.jsonl 2,812 student-domain sentences (LLM-generated, scanned)
    - heavy on sad (864) and crisis (579) — the model's weak spot
  - synthetic split 90/10 into train/val (10% held out to prove generalization)
  - crisis merged into negative for the 3-class contract
"""
import json, random, collections, os, csv

random.seed(42)
DS = "/Users/thxdadloveyoumost/jaikrajok]/datasets"
V4 = "/Users/thxdadloveyoumost/jaikrajok]/ml/data_v4"
os.makedirs(V4, exist_ok=True)

WISE_MAP = {"pos": "positive", "neu": "neutral", "neg": "negative"}
THAI_MAP = {"joy": "positive", "sad": "negative", "anger": "negative",
            "fear": "negative", "neutral": "neutral", "crisis": "negative"}

# 1. wisesight train (clean labels)
texts = open(f"{DS}/wisesight_train.txt", encoding="utf-8").read().split("\n")
labels = open(f"{DS}/wisesight_train_label.txt", encoding="utf-8").read().split("\n")
pool = collections.defaultdict(list)
for t, l in zip(texts, labels):
    g = WISE_MAP.get(l.strip())
    if g and t.strip():
        pool[g].append(t.strip())

train_rows, val_rows = [], []
for cls, arr in pool.items():
    random.shuffle(arr)
    n_val = max(1, int(len(arr) * 0.10))
    val_rows += [(t, cls) for t in arr[:n_val]]
    train_rows += [(t, cls) for t in arr[n_val:]]

# 2. thai_emotion ×20 train, ×1 val (same as v3)
te = []
with open(f"{DS}/thai_emotion.csv", encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        lab = THAI_MAP.get(r["label"])
        if lab and r["text"].strip():
            te.append((r["text"].strip(), lab))
train_rows += te * 20
val_rows += te

# 3. synthetic (90/10 split — 10% held out to measure generalization on fresh domain data)
syn = [json.loads(l) for l in open(f"{V4}/synthetic_clean.jsonl")]
random.shuffle(syn)
n_syn_val = max(1, int(len(syn) * 0.10))
for r in syn[:n_syn_val]:
    val_rows.append((r["text"], THAI_MAP[r["label"]]))
for r in syn[n_syn_val:]:
    train_rows.append((r["text"], THAI_MAP[r["label"]]))

random.shuffle(train_rows)
random.shuffle(val_rows)

for name, rows in [("train", train_rows), ("val", val_rows)]:
    with open(f"{V4}/{name}.jsonl", "w") as f:
        for t, c in rows:
            f.write(json.dumps({"text": t, "label": c}, ensure_ascii=False) + "\n")

print(f"train: {len(train_rows)}  dist: {dict(collections.Counter(c for _, c in train_rows))}")
print(f"val:   {len(val_rows)}  dist: {dict(collections.Counter(c for _, c in val_rows))}")
syn_in_val = sum(1 for t, c in val_rows if any(t == s['text'] for s in syn[:n_syn_val]))
print(f"synthetic in val (held out): {syn_in_val}")
print(f"saved → {V4}/train.jsonl, {V4}/val.jsonl")
