#!/usr/bin/env python
"""prepare_data_v5.py — v4 data + synthetic_v5 (2,063 targeted confusion-pattern rows).

v5 strategy: beat SSense everywhere.
  v4 already beats SSense on wisesight (65.3 vs 50).
  Gap left: thai_emotion 77 vs 82 — miss pattern was fear→positive (8),
  anger→positive (5), sad→positive (4), neutral→positive (4).
  synthetic_v5 was generated to hit exactly those patterns + hard_neg (ironic tone).
"""
import json, random, collections, os, csv

random.seed(42)
JK = "/Users/thxdadloveyoumost/jjfolder/jaikrajok]"
V4 = "/Users/thxdadloveyoumost/jjfolder/mymodel/data"

WISE_MAP = {"pos": "positive", "neu": "neutral", "neg": "negative"}
THAI_MAP = {"joy": "positive", "sad": "negative", "anger": "negative",
            "fear": "negative", "neutral": "neutral", "crisis": "negative",
            "negative": "negative", "positive": "positive"}  # v5 labels direct

# 1. wisesight train
texts = open(f"{JK}/datasets/wisesight_train.txt", encoding="utf-8").read().split("\n")
labels = open(f"{JK}/datasets/wisesight_train_label.txt", encoding="utf-8").read().split("\n")
pool = collections.defaultdict(list)
for t, l in zip(texts, labels):
    g = WISE_MAP.get(l.strip())
    if g and t.strip(): pool[g].append(t.strip())

train_rows, val_rows = [], []
for cls, arr in pool.items():
    random.shuffle(arr)
    n_val = max(1, int(len(arr) * 0.10))
    val_rows += [(t, cls) for t in arr[:n_val]]
    train_rows += [(t, cls) for t in arr[n_val:]]

# 2. thai_emotion ×20
te = []
with open(f"{JK}/datasets/thai_emotion.csv", encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        lab = THAI_MAP.get(r["label"])
        if lab and r["text"].strip():
            te.append((r["text"].strip(), lab))
train_rows += te * 20
val_rows += te

# 3. synthetic v4 (student domain, 2.8k)
v4_syn = [json.loads(l) for l in open("/Users/thxdadloveyoumost/jjfolder/mymodel/data/synthetic_clean.jsonl")]
random.shuffle(v4_syn)
n_v4_val = int(len(v4_syn) * 0.10)
for r in v4_syn[:n_v4_val]:
    val_rows.append((r["text"], THAI_MAP[r["label"]]))
for r in v4_syn[n_v4_val:]:
    train_rows.append((r["text"], THAI_MAP[r["label"]]))

# 4. NEW synthetic v5 (confusion-pattern targeted, 2k)
v5_syn = [json.loads(l) for l in open(f"{V4}/synthetic_v5_clean.jsonl")]
random.shuffle(v5_syn)
n_v5_val = int(len(v5_syn) * 0.10)
for r in v5_syn[:n_v5_val]:
    val_rows.append((r["text"], THAI_MAP[r["label"]]))
for r in v5_syn[n_v5_val:]:
    train_rows.append((r["text"], THAI_MAP[r["label"]]))

random.shuffle(train_rows)
random.shuffle(val_rows)

for name, rows in [("train_v5", train_rows), ("val_v5", val_rows)]:
    with open(f"{V4}/{name}.jsonl", "w") as f:
        for t, c in rows:
            f.write(json.dumps({"text": t, "label": c}, ensure_ascii=False) + "\n")

print(f"train: {len(train_rows)}  dist: {dict(collections.Counter(c for _, c in train_rows))}")
print(f"val:   {len(val_rows)}  dist: {dict(collections.Counter(c for _, c in val_rows))}")
print(f"synthetic v5 in mix: {len(v5_syn)} (val {n_v5_val})")
