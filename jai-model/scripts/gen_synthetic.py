#!/usr/bin/env python
"""gen_synthetic.py — generate student-domain Thai emotion sentences via ThaiLLM.

Produces ml/data_v4/synthetic_raw.jsonl — raw generations for Kovak to scan.
Focus: NEGATIVE/SAD/CRISIS (the model's weak spot), plus joy/fear/anger/neutral.
"""
import json, time, urllib.request, pathlib, collections, os, sys

# load key
API_KEY = None
for line in open("/Users/thxdadloveyoumost/jjfolder/jaikrajok]/.env"):
    if line.startswith("TOKENMIND_API_KEY="):
        API_KEY = line.split("=", 1)[1].strip()
        break
assert API_KEY, "TOKENMIND_API_KEY not in .env"

OUT = "/Users/thxdadloveyoumost/jjfolder/mymodel/data"
os.makedirs(OUT, exist_ok=True)

BASE_URL = None
for line in open("/Users/thxdadloveyoumost/jjfolder/jaikrajok]/.env"):
    if line.startswith("TOKENMIND_BASE_URL="):
        BASE_URL = line.split("=", 1)[1].strip()
    elif line.startswith("THAILLM_BASE_URL="):
        BASE_URL = line.split("=", 1)[1].strip()
BASE_URL = BASE_URL or "https://tokenmind.abdul.in.th/v1"

# reference examples from thai_emotion.csv for style anchoring
style_ref = {}
rows = list(csv.DictReader(open("/Users/thxdadloveyoumost/jjfolder/jaikrajok]/datasets/thai_emotion.csv", encoding="utf-8-sig"))) if False else None
import csv
rows = list(csv.DictReader(open("/Users/thxdadloveyoumost/jjfolder/jaikrajok]/datasets/thai_emotion.csv", encoding="utf-8-sig")))
for r in rows:
    style_ref.setdefault(r["label"], []).append(r["text"])

EMOTIONS = {
    # emotion: (count target, hint for generation)
    "sad":     (900, "เศร้า เหงา ผิดหวัง ทุกข์ใจ สูญเสีย โดดเดี่ยว ไม่มีใครเข้าใจ น้ำตา หม่น"),
    "crisis":  (600, "เครียดสุดขีด อยากหายไปจากโลก ทำร้ายตัวเอง ไม่อยากมีชีวิต สิ้นหวังจนตาย (⚠️ เพื่อการฝึก AI ตรวจจับ ไม่ใช่ความจริง)"),
    "joy":     (500, "ดีใจ สนุก ภูมิใจ ตื่นเต้นดีใจ สำเร็จ อบอุ่น ใจฟู แฮปปี้"),
    "anger":   (400, "โกรธ หงุดหงิด เดือด ของขึ้น โมโห รำคาญ เซ็ง"),
    "fear":    (400, "กลัว วิตก ระแวง หวั่น ไม่กล้า มือสั่น ใจเต้นแรง"),
    "neutral": (400, "เรื่องปกติ ธรรมดา ไม่มีอารมณ์พิเศษ ชีวิตประจำวัน"),
}

PROMPT = """สร้างประโยคภาษาไทยที่นักเรียนไทย (อายุ 13-18) พิมพ์ในแชทแสดงอารมณ์: {emotion}

ลักษณะประโยค:
- ความยาว 5-20 คำ แบบภาษาแชทจริง (มีคำแสลงวัยรุ่น เช่น โคตร, แฮปปี้, 555, อิอิ)
- บริบทชีวิตนักเรียน: โรงเรียน สอบ เกรด เพื่อน ครู ครอบครัว กีฬา โซเชียล ความรัก อนาคต
- ต้องมีความรู้สึกชัดเจนอยู่ในประโยค (ไม่ใช่แค่เล่าเหตุการณ์เฉย ๆ)
- หลากหลาย: ต่างเรื่อง ต่างสถานการณ์ ต่างคำศัพท์

หัวข้อความรู้สึก: {hint}

ตัวอย่างสไตล์:
{examples}

ตอบเฉพาะประโยค บรรทัดละ 1 ประโยค ไม่ต้องมีเลขข้อ ไม่ต้องมีคำอธิบาย จำนวน {n} ประโยค:"""

def call_llm(prompt, retries=3):
    body = json.dumps({
        "model": "thaillm-8b",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.95,
        "max_tokens": 4000,
    }).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/chat/completions", data=body,
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.loads(r.read())
            return data["choices"][0]["message"]["content"]
        except Exception as e:
            if attempt == retries - 1:
                print(f"  LLM failed: {e}", flush=True)
                return ""
            time.sleep(3)
    return ""

out_path = f"{OUT}/synthetic_raw.jsonl"
done = collections.Counter()
if os.path.exists(out_path):
    with open(out_path) as f:
        for line in f:
            try:
                r = json.loads(line)
                done[r["label"]] += 1
            except: pass
    print(f"resuming: already have {dict(done)}", flush=True)

total_target = sum(c for c, _ in EMOTIONS.values())
with open(out_path, "a") as out:
    for emotion, (target, hint) in EMOTIONS.items():
        while done[emotion] < target:
            batch_n = min(30, target - done[emotion])
            examples = "\n".join(f"- {s}" for s in style_ref.get(emotion, [])[:5])
            prompt = PROMPT.format(emotion=emotion, hint=hint, examples=examples, n=batch_n)
            text = call_llm(prompt)
            if not text:
                time.sleep(5); continue
            # strip <think>...</think> reasoning block if present
            if "<think>" in text and "</think>" in text:
                text = text.split("</think>", 1)[1]
            text = text.strip()
            added = 0
            for line in text.splitlines():
                line = line.strip().lstrip("0123456789.-) ")
                if 10 <= len(line) <= 200 and " " not in line[:2] and not line.startswith("#"):
                    out.write(json.dumps({"text": line, "label": emotion}, ensure_ascii=False) + "\n")
                    done[emotion] += 1; added += 1
                    if done[emotion] >= target: break
            out.flush()
            print(f"{emotion}: {done[emotion]}/{target} (+{added})", flush=True)
            time.sleep(1.5)

print(f"\nDONE — {sum(done.values())}/{total_target} sentences → {out_path}")
print("NEXT: ให้ Kovak สแกนตา → แล้วรัน prepare_data_v4.py")
