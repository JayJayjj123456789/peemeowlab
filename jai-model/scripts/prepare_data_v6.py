#!/usr/bin/env python
"""prepare_data_v6.py — balance fix: wisesight ×2 + synthetic v5 capped at 1.5k
v5 บทเรียน: synthetic 2k เบียด wisesight ทำให้ OOS ลดลง 2.9 จุด
v6 จึง: คง synthetic เจาะจุดพลาด แต่ไม่ให้ทับ wisesight"""
import json, random, collections, os, csv

random.seed(42)
JK = "/Users/thxdadloveyoumost/jjfolder/jaikrajok]"
DATA = "/Users/thxdadloveyoumost/jjfolder/mymodel/data"

WISE_MAP = {"pos": "positive", "neu": "neutral", "neg": "negative"}
THAI_MAP = {"joy": "positive", "sad": "negative", "anger": "negative",
            "fear": "negative", "neutral": "neutral", "crisis": "negative",
            "negative": "negative", "positive": "positive"}

# 1. wisesight ×2 (กันเบียด)
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
    train_rows += [(t, cls) for t in arr[n_val:]] * 2  # ×2

# 2. thai_emotion ×20
te = []
with open(f"{JK}/datasets/thai_emotion.csv", encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        lab = THAI_MAP.get(r["label"])
        if lab and r["text"].strip():
            te.append((r["text"].strip(), lab))
train_rows += te * 20
val_rows += te

# 3. synthetic v4 (2.8k) — 90/10 เหมือนเดิม
v4_syn = [json.loads(l) for l in open(f"{DATA}/synthetic_clean.jsonl")]
random.shuffle(v4_syn)
n4 = int(len(v4_syn) * 0.10)
for r in v4_syn[:n4]: val_rows.append((r["text"], THAI_MAP[r["label"]]))
for r in v4_syn[n4:]: train_rows.append((r["text"], THAI_MAP[r["label"]]))

# 4. synthetic v5 — cap 1,500 (ลดจาก 2,063 กันเบียด)
v5_syn = [json.loads(l) for l in open(f"{DATA}/synthetic_v5_clean.jsonl")]
random.shuffle(v5_syn)
v5_syn = v5_syn[:1500]
n5 = int(len(v5_syn) * 0.10)
for r in v5_syn[:n5]: val_rows.append((r["text"], THAI_MAP[r["label"]]))
for r in v5_syn[n5:]: train_rows.append((r["text"], THAI_MAP[r["label"]]))

random.shuffle(train_rows)
random.shuffle(val_rows)

for name, rows in [("train_v6", train_rows), ("val_v6", val_rows)]:
    with open(f"{DATA}/{name}.jsonl", "w") as f:
        for t, c in rows:
            f.write(json.dumps({"text": t, "label": c}, ensure_ascii=False) + "\n")

print(f"train: {len(train_rows)}  dist: {dict(collections.Counter(c for _, c in train_rows))}")
print(f"val:   {len(val_rows)}  dist: {dict(collections.Counter(c for _, c in val_rows))}")
