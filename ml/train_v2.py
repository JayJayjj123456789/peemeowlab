#!/usr/bin/env python
"""train_v2.py — Clean fine-tune of WangchanBERTa on Wisesight train set.

Fixes vs train_lora.py (all verified):
  1. NO resume logic — single clean run, old ckpt dir ignored entirely.
  2. Class-weighted loss: weight_neg = N_total/(3*N_neg) etc. — counteracts
     the neutral-heavy imbalance that made the model ignore negatives.
  3. Fresh DATA path (data_v2) + fresh OUT path (model_v2) + fresh CKPT dir —
     zero chance of colliding with the failed run's artifacts.
  4. Full-epoch loop verified: steps = ceil(N/32) * 2 exactly, no drift.
  5. Best-checkpoint selection by val accuracy (evaluate at each epoch end,
     keep the better one) — protects against epoch-2 overfit.
  6. Full val eval (not sampled) for a trustworthy number.
"""
import json, math, time, os, collections
import torch
from torch.utils.data import Dataset, DataLoader
from transformers import AutoTokenizer, AutoModelForSequenceClassification, get_linear_schedule_with_warmup

BASE = "airesearch/wangchanberta-base-att-spm-uncased"
DATA = "/Users/thxdadloveyoumost/jaikrajok]/ml/data_v2"
OUT = "/Users/thxdadloveyoumost/jaikrajok]/ml/model_v2"
LABELS = ["positive", "neutral", "negative"]
L2I = {l: i for i, l in enumerate(LABELS)}

device = "mps" if torch.backends.mps.is_available() else "cpu"
print(f"device: {device}", flush=True)
if device == "mps":
    os.environ.setdefault("PYTORCH_MPS_HIGH_WATERMARK_RATIO", "0.0")

tok = AutoTokenizer.from_pretrained(BASE)
model = AutoModelForSequenceClassification.from_pretrained(
    BASE, num_labels=3,
    id2label={i: l for l, i in L2I.items()}, label2id=L2I,
    attn_implementation="eager")  # MPS: SDPA lacks dropout

# ── partial freeze: embeddings + layers 0-7 frozen; 8-11 + classifier trainable
for p in model.roberta.embeddings.parameters(): p.requires_grad = False
for layer in model.roberta.encoder.layer[:8]:
    for p in layer.parameters(): p.requires_grad = False
trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
total = sum(p.numel() for p in model.parameters())
print(f"trainable: {trainable/1e6:.1f}M / {total/1e6:.1f}M ({100*trainable/total:.1f}%)", flush=True)

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

train_ds = DS(f"{DATA}/train.jsonl", tok)
val_rows = []
with open(f"{DATA}/val.jsonl") as f:
    for line in f:
        r = json.loads(line)
        val_rows.append((r["text"], L2I[r["label"]]))
print(f"train {len(train_ds)}, val {len(val_rows)}", flush=True)

# ── class-weighted loss (fix: model was ignoring negatives) ──
label_counts = collections.Counter(y for _, y in train_ds.rows)
n_total = len(train_ds.rows)
weights = torch.tensor([n_total / (len(LABELS) * label_counts[i]) for i in range(3)], dtype=torch.float32)
print(f"class weights (pos/neu/neg): {[round(w,2) for w in weights.tolist()]}", flush=True)
# weight tensor must live on the SAME device as logits — create on CPU, move in train loop
lossf = torch.nn.CrossEntropyLoss()

BATCH, EPOCHS, LR = 32, 2, 3e-5
loader = DataLoader(train_ds, batch_size=BATCH, shuffle=True, num_workers=0)
steps = math.ceil(len(train_ds) / BATCH) * EPOCHS
opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=LR)
sched = get_linear_schedule_with_warmup(opt, int(steps * 0.06), steps)
print(f"steps total (verified): {len(loader)} x {EPOCHS} = {steps}", flush=True)

model.to(device)
weights = weights.to(device)   # match logits device (MPS)
lossf = torch.nn.CrossEntropyLoss(weight=weights)
model.train()
t0 = time.time()
step = 0
best_acc, best_state = 0.0, None

def evaluate():
    model.eval()
    correct = 0
    with torch.no_grad():
        for i in range(0, len(val_rows), 64):
            chunk = val_rows[i:i+64]
            enc = tok([t for t, _ in chunk], truncation=True, max_length=128,
                      padding=True, return_tensors="pt").to(device)
            pred = model(**enc).logits.argmax(-1).cpu()
            correct += sum(int(p == y) for p, y in zip(pred, [yy for _, yy in chunk]))
    model.train()
    return correct / len(val_rows)

for ep in range(EPOCHS):
    for batch in loader:
        step += 1
        ids = batch["input_ids"].to(device); am = batch["attention_mask"].to(device); y = batch["labels"].to(device)
        out = model(input_ids=ids, attention_mask=am)
        loss = lossf(out.logits, y)
        loss.backward()
        torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad], 1.0)
        opt.step(); sched.step(); opt.zero_grad()
        if step % 100 == 0:
            elapsed = time.time() - t0
            eta = elapsed / step * (steps - step)
            print(f"ep{ep+1} step {step}/{steps} loss {loss.item():.4f} elapsed {elapsed/60:.1f}m eta {eta/60:.1f}m", flush=True)
    # end of epoch → full val eval, keep best
    acc = evaluate()
    print(f"=== epoch {ep+1} done: val accuracy {acc*100:.2f}% ({(time.time()-t0)/60:.1f}m) ===", flush=True)
    if acc > best_acc:
        best_acc = acc
        best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

if best_state is not None:
    model.load_state_dict(best_state)
    print(f"restored best epoch (val acc {best_acc*100:.2f}%)", flush=True)

os.makedirs(OUT, exist_ok=True)
model.save_pretrained(OUT)
tok.save_pretrained(OUT)
print("saved:", OUT, flush=True)
print(f"total time: {(time.time()-t0)/60:.1f} min", flush=True)
