# JaiKraJok Emotion Model — Kovak's Personal Model

โมเดลตรวจอารมณ์ภาษาไทยของเราเอง (fine-tuned WangchanBERTa) — โฟลเดอร์นี้คือบ้านเดียวของมัน

**สถานะปัจจุบัน:** v4 — in-domain 77% / out-of-sample 65.3%
**เป้าหมาย:** ชนะ SSense (82% in-domain / 50% out-of-sample) แล้วเอามาแทน regex+SSense ทั้งหมด
**สถานะเป้าหมาย:** out-of-sample ผ่าน SSense แล้ว ✓ · in-domain ยังห่าง 6 จุด

## โครงสร้าง

```
jai-model/
├── scripts/        สคริปต์เทรน/ประเมิน/เสิร์ฟ ทั้งหมด
│   ├── train_v2.py          สคริปต์เทรนหลัก (ใช้ v3/v4 มาจากไฟล์นี้)
│   ├── prepare_data_v4.py   เตรียมข้อมูล (wisesight+thai_emotion+synthetic)
│   ├── gen_synthetic.py     ใช้ ThaiLLM สร้างประโยคนักเรียน
│   ├── eval_model.py        วัดผลกับชุดสอบ 2 ชุด
│   ├── benchmark_ssense.py  วัดผล SSense (เทียบคู่แข่ง)
│   └── serve_model.py       microservice รันโมเดล (localhost:8100)
├── data/           ข้อมูลเทรน (jsonl)
├── models/         weight โมเดล (ไฟล์ใหญ่ gitignored)
│   └── v4-current/  ตัวที่ใช้งานจริงตอนนี้
├── logs/           log การเทรน/ประเมิน
└── results/        ตารางผลสอบแต่ละรอบ
```

## ตารางประวัติผลสอบ

| รอบ | ข้อมูล | in-domain | out-of-sample | หมายเหตุ |
|---|---|---|---|---|
| v1 | ZombitX64 122k (noisy) | 69% | 41.5% | label noise + resume bug |
| v2 | Wisesight 23k + thai_emotion | 74% | 62.7% | ชนะ regex ฝั่ง OOS |
| v3 | เท่าเดิม + 4 epochs | 76% | 64.7% | ตั้ง best-epoch selection |
| **v4 ★** | + synthetic 2.8k | **77%** | **65.3%** | รอบปัจจุบัน |
| SSense | — | 82% | 50% | คู่แข่ง (แพ้เราฝั่ง OOS แล้ว) |

## การเทรนครั้งถัดไป (v5)

ทางเลือกที่ยังไม่ได้ลอง (เรียงตามความคุ้ม):
1. **เพิ่ม epochs ด้วย lr schedule ต่างออกไป** (cosine restarts) — อาจดึงอีก 1-2 จุด
2. **Augment synthetic ด้วย paraphrase หลายสไตล์** — ปัจจุบันสไตล์เดียวจาก thai_emotion
3. **รวมข้อมูลคนจริง** — แชทจริงจาก LINE/เว็บ (Phase 2)
4. **Dropout/weight decay tune** — ลอง 0.1/0.2 สลับ

## รันเอง

```bash
# เทรนรอบใหม่ (แก้ DATA/OUT/EPOCHS ในสคริปต์ก่อน)
caffeinate -ims ./venv/bin/python scripts/train_v2.py

# ประเมิน
./venv/bin/python scripts/eval_model.py 800

# เปิด serve
./venv/bin/python scripts/serve_model.py
```

venv อยู่ที่ `../ml/venv` (torch + transformers + onnx)
