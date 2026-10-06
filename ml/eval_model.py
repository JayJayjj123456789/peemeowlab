#!/usr/bin/env python
"""eval_model.py — benchmark the fine-tuned model vs the old regex engine.
Datasets: thai_emotion.csv (in-domain, 100) + wisesight test (out-of-sample).
"""
import json, csv, sys, collections
import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification

MODEL = "/Users/thxdadloveyoumost/jaikrajok]/ml/model_v2"
DS = "/Users/thxdadloveyoumost/jaikrajok]/datasets"
LABELS = ["positive", "neutral", "negative"]
L2I = {l: i for i, l in enumerate(LABELS)}

device = "mps" if torch.backends.mps.is_available() else "cpu"
tok = AutoTokenizer.from_pretrained(MODEL)
model = AutoModelForSequenceClassification.from_pretrained(MODEL).to(device).eval()

THAI_MAP = {"joy": "positive", "sad": "negative", "anger": "negative", "fear": "negative", "neutral": "neutral"}
WISE_MAP = {"pos": "positive", "neu": "neutral", "neg": "negative", "q": "neutral"}

def predict_batch(texts, bs=64):
    preds = []
    with torch.no_grad():
        for i in range(0, len(texts), bs):
            enc = tok(texts[i:i+bs], truncation=True, max_length=128, padding=True, return_tensors="pt").to(device)
            preds += [LABELS[p] for p in model(**enc).logits.argmax(-1).cpu().tolist()]
    return preds

def report(name, pairs):
    correct = sum(p == g for p, g in pairs)
    cm = collections.defaultdict(collections.Counter)
    for p, g in pairs: cm[g][p] += 1
    print(f"\n==== {name}: {correct}/{len(pairs)} = {100*correct/len(pairs):.1f}% ====")
    print(f"{'':12}" + "".join(c.ljust(11) for c in LABELS))
    for g in LABELS:
        print(f"{g:12}" + "".join(str(cm[g][p]).ljust(11) for p in LABELS))
    return correct, len(pairs)

tot_c = tot_n = 0

# 1. thai_emotion (in-domain)
rows = []
with open(f"{DS}/thai_emotion.csv", encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        lab = THAI_MAP.get(r["label"])
        if lab: rows.append((r["text"].strip(), lab))
preds = predict_batch([t for t, _ in rows])
c, n = report("thai_emotion (in-domain)", list(zip(preds, [g for _, g in rows])))
tot_c += c; tot_n += n

# 2. wisesight test (out-of-sample) — cap 800 stratified if arg given
cap = int(sys.argv[1]) if len(sys.argv) > 1 else 800
texts = open(f"{DS}/wisesight_test.txt").read().splitlines()
labels = open(f"{DS}/wisesight_test_label.txt").read().splitlines()
pool = collections.defaultdict(list)
for t, l in zip(texts, labels):
    g = WISE_MAP.get(l.strip())
    if g and t.strip(): pool[g].append(t.strip())
per = max(1, cap // 3)
sample = [(t, g) for g in LABELS for t in pool[g][:per]]
preds = predict_batch([t for t, _ in sample])
c, n = report(f"wisesight test (n={len(sample)})", list(zip(preds, [g for _, g in sample])))
tot_c += c; tot_n += n

print(f"\n==== OVERALL: {tot_c}/{tot_n} = {100*tot_c/tot_n:.1f}% ====")
print("old regex engine reference: thai_emotion 98% / wisesight ~56%")
