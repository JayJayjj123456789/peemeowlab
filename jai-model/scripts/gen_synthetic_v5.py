#!/usr/bin/env python
"""gen_synthetic_v5.py — targeted generation to BEAT SSense.

Not student-focused this time — focused on the model's CONFUSION PATTERNS:
  - fear misread as positive (8 cases: "กลัวสอบไม่ติดที่อยากเข้า")
  - anger misread as positive (5: "โดนโยนความผิด")
  - sad misread as positive (4: "รู้สึกแย่มาก" with but-frames)
  - neutral misread as positive (4: "ไม่มีอะไรพิเศษ")
  - joy misread (2: "รู้สึกดีมาก")
Plus hard examples with mixed/ironic tone to teach the model nuance.
"""
import json, time, urllib.request, collections, os, sys

API_KEY, BASE = None, None
for line in open("/Users/thxdadloveyoumost/jjfolder/jaikrajok]/.env"):
    if line.startswith("TOKENMIND_API_KEY="): API_KEY = line.split("=",1)[1].strip()
    if line.startswith("TOKENMIND_BASE_URL="): BASE = line.split("=",1)[1].strip()
assert API_KEY and BASE

OUT = "/Users/thxdadloveyoumost/jjfolder/mymodel/data/synthetic_v5.jsonl"

# (target_count, label, generation_hint)
JOBS = [
    (600, "fear",    "ความกลัว กังวล หวาดระแวง ไม่กล้า ตื่นตระหนก หัวใจเต้นแรง — ต้องรู้สึกกลัว/วิตกชัดเจน"),
    (400, "anger",   "ความโกรธ โมโห เดือด ของขึ้น หงุดหงิด ถูกเอาเปรียบ ถูกโยนความผิด โดนต่อว่า"),
    (400, "sad",     "ความเศร้า เหงา ผิดหวัง โดดเดี่ยว เหมือนคนนอก น้ำตาไหล ใจหาย หม่น รู้สึกแย่"),
    (300, "neutral", "เรื่องประจำวันธรรมดา ไม่มีอารมณ์เด่น ทำกิจวัตร ไม่มีความสุขหรือทุกข์เด่น"),
    (300, "joy",     "ความดีใจ สนุก ภูมิใจ ตื่นเต้นดีใจ สำเร็จ อบอุ่น แฮปปี้"),
    # hard/nuanced: mixed tone that LOOKS positive but is negative (the exact failure mode)
    (200, "hard_neg", "ประโยคที่มีคำฟังดีปนอยู่ แต่ความรู้สึกจริงเป็นลบ เช่น 'ต้องฝืนยิ้ม', 'เห็นคนอื่นมีความสุขแต่เราเปล่า', 'พยายามแล้วก็ยังแย่', 'ทำดีให้เขาแต่เขาไม่เห็นค่า'"),
]

PROMPT = """สร้างประโยคภาษาไทยที่แสดงอารมณ์: {label}

ความรู้สึกที่ต้องชัดเจน: {hint}

กติกา:
- ความยาว 4-25 คำ ภาษาแชทจริง
- ประโยคต้องแสดงอารมณ์ประเภทนี้ชัดเจน (ไม่กำกวม)
- หลากหลายบริบท: เรียน งาน ครอบครัว เพื่อน ความรัก เกม กีฬา โซเชียล

บรรทัดละ 1 ประโยค จำนวน {n} ประโยค ไม่ต้องมีเลขข้อ:"""

def call(prompt):
    body = json.dumps({"model": "thaillm-8b", "messages": [{"role": "user", "content": prompt}],
                       "temperature": 0.95, "max_tokens": 4000}).encode()
    req = urllib.request.Request(f"{BASE}/chat/completions", data=body,
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"})
    for a in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                text = json.loads(r.read())["choices"][0]["message"]["content"]
            if "<think>" in text and "</think>" in text:
                text = text.split("</think>", 1)[1]
            return text.strip()
        except Exception as e:
            if a == 2: print(f"  LLM fail: {e}", flush=True); return ""
            time.sleep(3)
    return ""

def label_of(job_label):
    return {"hard_neg": "negative"}.get(job_label, job_label)

done = collections.Counter()
out_path = OUT
if os.path.exists(out_path):
    with open(out_path) as f:
        for line in f:
            try: done[json.loads(line)["label"]] += 1
            except: pass
print(f"resuming: {dict(done)}", flush=True)

total_target = sum(c for c, _, _ in JOBS)
with open(out_path, "a") as out:
    for target, label, hint in JOBS:
        while done[label] < target:
            n = min(30, target - done[label])
            text = call(PROMPT.format(label=label, hint=hint, n=n))
            if not text: time.sleep(5); continue
            added = 0
            for line in text.splitlines():
                line = line.strip().lstrip("0123456789.-) ")
                if 10 <= len(line) <= 220:
                    out.write(json.dumps({"text": line, "label": label_of(label)}, ensure_ascii=False) + "\n")
                    done[label] += 1; added += 1
                    if done[label] >= target: break
            out.flush()
            print(f"{label}: {done[label]}/{target} (+{added})", flush=True)
            time.sleep(1.2)

print(f"\nDONE — {sum(done.values())}/{total_target} → {out_path}")
