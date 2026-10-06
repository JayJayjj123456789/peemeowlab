#!/usr/bin/env python
"""train_lora.py — LoRA fine-tune WangchanBERTa for 3-class Thai emotion.
Apple M5 / MPS backend. Runs on localhost, ~40-80 min for 2 epochs.
"""
import json, math, time
import torch
from torch.utils.data import Dataset, DataLoader
from transformers import AutoTokenizer, AutoModelForSequenceClassification, get_linear_schedule_with_warmup

BASE = "airesearch/wangchanberta-base-att-spm-uncased"
DATA = "/Users/thxdadloveyoumost/jaikrajok]/ml/data"
OUT = "/Users/thxdadloveyoumost/jaikrajok]/ml/model"
LABELS = ["positive", "neutral", "negative"]
L2I = {l: i for i, l in enumerate(LABELS)}

device = "mps" if torch.backends.mps.is_available() else "cpu"
print(f"device: {device}")

# MPS stability: disable early-abort watermark, allow cache reclaim
if device == "mps":
    import os
    os.environ.setdefault("PYTORCH_MPS_HIGH_WATERMARK_RATIO", "0.0")

tok = AutoTokenizer.from_pretrained(BASE)
model = AutoModelForSequenceClassification.from_pretrained(BASE, num_labels=3,
                                                           id2label={i: l for l, i in L2I.items()},
                                                           label2id=L2I,
                                                           attn_implementation="eager")  # MPS: SDPA lacks dropout

# ── LoRA-lite via targeted freezing (works without peft lib, keeps it simple):
# freeze embeddings + first 8 encoder layers; fine-tune last 4 layers + classifier
for p in model.roberta.embeddings.parameters(): p.requires_grad = False
for layer in model.roberta.encoder.layer[:8]:
    for p in layer.parameters(): p.requires_grad = False
trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
total = sum(p.numel() for p in model.parameters())
print(f"trainable: {trainable/1e6:.1f}M / {total/1e6:.1f}M ({100*trainable/total:.1f}%)")

class DS(Dataset):
    def __init__(self, path, tok, max_len=128):
        self.rows = []
        with open(path) as f:
            for line in f:
                r = json.loads(line)
                self.rows.append((r["text"], L2I[r["label"]]))
        self.tok, self.max_len = tok, max_len
    def __len__(self): return len(self.rows)
    def __getitem__(self, i):
        t, y = self.rows[i]
        enc = self.tok(t, truncation=True, max_length=self.max_len, padding="max_length", return_tensors="pt")
        return {"input_ids": enc["input_ids"][0], "attention_mask": enc["attention_mask"][0], "labels": torch.tensor(y)}

def load_jsonl(p):
    rows = []
    with open(p) as f:
        for line in f:
            r = json.loads(line)
            rows.append((r["text"], L2I[r["label"]]))
    return rows

train_ds = DS(f"{DATA}/train.jsonl", tok)
val_rows = load_jsonl(f"{DATA}/val.jsonl")
print(f"train {len(train_ds)}, val {len(val_rows)}")

BATCH, EPOCHS, LR = 32, 2, 3e-5
loader = DataLoader(train_ds, batch_size=BATCH, shuffle=True, num_workers=0)
opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=LR)
steps = len(loader) * EPOCHS
sched = get_linear_schedule_with_warmup(opt, int(steps*0.06), steps)
lossf = torch.nn.CrossEntropyLoss()

model.to(device)
model.train()
t0 = time.time()

# ── resume support: pick up from last checkpoint if present ──
START_EPOCH, START_STEP = 0, 0
CKPT_DIR = "/Users/thxdadloveyoumost/jaikrajok]/ml/ckpt"
import os, glob
ckpts = sorted(glob.glob(f"{CKPT_DIR}/ep*_step*.pt"))
if ckpts:
    last = ckpts[-1]
    state = torch.load(last, map_location=device)
    model.load_state_dict(state["model"])
    opt.load_state_dict(state["opt"])
    sched.load_state_dict(state["sched"])
    START_EPOCH, START_STEP = state["epoch"], state["step"]
    print(f"resumed from {last} (epoch {START_EPOCH}, step {START_STEP})")

step = START_STEP
for ep in range(START_EPOCH, EPOCHS):
    for batch in loader:
        step += 1
        if step <= START_STEP:   # skip already-done steps of resumed epoch
            continue
        ids = batch["input_ids"].to(device); am = batch["attention_mask"].to(device); y = batch["labels"].to(device)
        out = model(input_ids=ids, attention_mask=am)
        loss = lossf(out.logits, y)
        loss.backward()
        torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad], 1.0)
        opt.step(); sched.step(); opt.zero_grad()
        if step % 200 == 0:
            elapsed = time.time()-t0
            remaining = steps - step
            eta = elapsed/(step-START_STEP)*remaining if step > START_STEP else 0
            print(f"ep{ep+1} step {step}/{steps} loss {loss.item():.4f} elapsed {elapsed/60:.1f}m eta {eta/60:.1f}m", flush=True)
        # checkpoint every 1000 steps
        if step % 1000 == 0:
            os.makedirs(CKPT_DIR, exist_ok=True)
            torch.save({"model": model.state_dict(), "opt": opt.state_dict(),
                        "sched": sched.state_dict(), "epoch": ep, "step": step},
                       f"{CKPT_DIR}/ep{ep+1}_step{step}.pt")

# ── eval on val set (sampled for speed) ──
model.eval()
import random
sample = random.sample(val_rows, min(2000, len(val_rows)))
correct = 0
with torch.no_grad():
    for i in range(0, len(sample), 64):
        chunk = sample[i:i+64]
        enc = tok([t for t, _ in chunk], truncation=True, max_length=128, padding=True, return_tensors="pt").to(device)
        pred = model(**enc).logits.argmax(-1).cpu()
        correct += sum(int(p == y) for p, y in zip(pred, [yy for _, yy in chunk]))
print(f"val accuracy (n={len(sample)}): {correct/len(sample)*100:.1f}%")

import os
os.makedirs(OUT, exist_ok=True)
model.save_pretrained(OUT)
tok.save_pretrained(OUT)
print("saved:", OUT)
print(f"total time: {(time.time()-t0)/60:.1f} min")
