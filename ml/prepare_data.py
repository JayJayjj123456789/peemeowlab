#!/usr/bin/env python
"""prepare_data.py — build the fine-tune dataset from ZombitX64 (628k) + thai_emotion (100).

Label mapping (contract of /api/emotion):
  positive, neutral, negative

Mapping decisions (documented, reversible):
  positive  → positive
  neutral   → neutral
  negative  → negative
  mixed     → dropped (ambiguous by definition; keep the contract clean)
  question  → dropped (not an emotion; ~88k rows of news/questions would dilute)

Balancing: negative is the minority class (17k) and the class we care most
about (crisis detection lives there). We keep ALL negatives and subsample
positive/neutral to 3× negative each. Result ≈ 17k neg / 51k pos / 51k neu
≈ 120k rows — plenty for LoRA fine-tune, trains in ~40-80 min on M5 MPS.
thai_emotion.csv (100 rows, our exact domain) is oversampled ×20 and added.
"""
import csv, json, random, collections
from datasets import load_dataset

random.seed(42)
OUT = "/Users/thxdadloveyoumost/jaikrajok]/ml/data"
import os
os.makedirs(OUT, exist_ok=True)

KEEP = {"positive": "positive", "neutral": "neutral", "negative": "negative"}

print("loading ZombitX64 ...")
ds = load_dataset("ZombitX64/Wisesight-Sentiment-Thai", split="train")

buckets = collections.defaultdict(list)
for r in ds:
    lab = r["sentiment"]
    if lab in KEEP:
        buckets[KEEP[lab]].append(r["text"].strip())

print("before balancing:", {k: len(v) for k, v in buckets.items()})

NEG_KEEP = len(buckets["negative"])            # 17,208
PER = NEG_KEEP * 3
for cls in ["positive", "neutral"]:
    random.shuffle(buckets[cls])
    buckets[cls] = buckets[cls][:PER]

rows = [(t, c) for c, arr in buckets.items() for t in arr]

# our in-domain data, oversampled ×20 (it IS the target domain)
with open("/Users/thxdadloveyoumost/jaikrajok]/datasets/thai_emotion.csv", encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        lab = {"joy": "positive", "sad": "negative", "anger": "negative",
               "fear": "negative", "neutral": "neutral"}.get(r["label"])
        if lab:
            rows += [(r["text"].strip(), lab)] * 20

random.shuffle(rows)

train_path = f"{OUT}/train.jsonl"
val_path = f"{OUT}/val.jsonl"
n_val = 3000
with open(train_path, "w") as f:
    for t, c in rows[:-n_val]:
        f.write(json.dumps({"text": t, "label": c}, ensure_ascii=False) + "\n")
with open(val_path, "w") as f:
    for t, c in rows[-n_val:]:
        f.write(json.dumps({"text": t, "label": c}, ensure_ascii=False) + "\n")

dist = collections.Counter(c for _, c in rows)
print(f"total: {len(rows)}  → train {len(rows)-n_val} / val {n_val}")
print("final dist:", dict(dist))
print("saved:", train_path)
