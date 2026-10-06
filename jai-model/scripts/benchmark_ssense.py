#!/usr/bin/env python
"""benchmark_ssense.py — finally measure SSense on OUR test sets.
Throttled 1 req/sec to respect aiforthai rate limits.
"""
import csv, json, time, urllib.request, urllib.parse, collections

DS = "/Users/thxdadloveyoumost/jaikrajok]/datasets"
API_KEY = None  # read from .env

for line in open("/Users/thxdadloveyoumost/jaikrajok]/.env"):
    if line.startswith("PATHUMMA_API_KEY="):
        API_KEY = line.split("=", 1)[1].strip()
    elif line.startswith("AIFORTHAI_API_KEY=") and not API_KEY:
        API_KEY = line.split("=", 1)[1].strip()

assert API_KEY, "no aiforthai key in .env"

THAI_MAP = {"joy": "positive", "sad": "negative", "anger": "negative", "fear": "negative", "neutral": "neutral"}
WISE_MAP = {"pos": "positive", "neu": "neutral", "neg": "negative", "q": "neutral"}

def ssense(text):
    params = urllib.parse.urlencode({"text": text[:2000]}).encode()
    req = urllib.request.Request("https://api.aiforthai.in.th/ssense", data=params, headers={
        "Apikey": API_KEY, "Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read())
    # SSense returns a single object (not an array): {"sentiment": {"polarity": ...}}
    if isinstance(data, dict):
        return data["sentiment"]["polarity"]  # pos/neu/neg (their scale)
    return data[0]["sentiment"]["polarity"]

def run(name, rows):
    cm = collections.defaultdict(collections.Counter)
    correct = 0
    for i, (text, gold) in enumerate(rows):
        try:
            p = ssense(text)
            pred = {"pos": "positive", "positive": "positive",
                    "neu": "neutral", "neutral": "neutral",
                    "neg": "negative", "negative": "negative"}.get(p, "neutral")
        except Exception as e:
            pred = "error"
            print(f"  [{i}] {type(e).__name__}: {str(e)[:60]}")
        cm[gold][pred] += 1
        if pred == gold: correct += 1
        time.sleep(1.0)  # throttle
        if (i+1) % 50 == 0: print(f"  {i+1}/{len(rows)} running acc: {100*correct/(i+1):.1f}%", flush=True)
    print(f"\n==== {name}: {correct}/{len(rows)} = {100*correct/len(rows):.1f}% ====")
    print("  " + "".join(c.ljust(11) for c in ["pos","neu","neg"]))
    for g in ["positive","neutral","negative"]:
        print(f"  {g:12}" + "".join(str(cm[g][p]).ljust(11) for p in ["positive","neutral","negative"]))
    return correct, len(rows)

# 1. thai_emotion (all 100)
rows = []
with open(f"{DS}/thai_emotion.csv", encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        g = THAI_MAP.get(r["label"])
        if g: rows.append((r["text"].strip(), g))
print(f"=== thai_emotion: {len(rows)} rows ===", flush=True)
c1, n1 = run("thai_emotion", rows)

# 2. wisesight test — 150 stratified (throttled, keep it ~3min)
texts = open(f"{DS}/wisesight_test.txt", encoding="utf-8").read().split("\n")
labels = open(f"{DS}/wisesight_test_label.txt", encoding="utf-8").read().split("\n")
pool = collections.defaultdict(list)
for t, l in zip(texts, labels):
    g = WISE_MAP.get(l.strip())
    if g and t.strip(): pool[g].append(t.strip())
sample = [(t, g) for g in ["positive", "neutral", "negative"] for t in pool[g][:50]]
print(f"\n=== wisesight: {len(sample)} rows ===", flush=True)
c2, n2 = run("wisesight", sample)

print(f"\n==== SSENSE OVERALL: {c1+c2}/{n1+n2} = {100*(c1+c2)/(n1+n2):.1f}% ====")
print("=== reference: regex 98%/56% · our model v2 74%/62.7% ===")
