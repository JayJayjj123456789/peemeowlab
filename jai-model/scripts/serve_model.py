#!/usr/bin/env python
"""serve_model.py — tiny localhost HTTP server exposing the fine-tuned model.

POST /predict  {"text": "..."}  →  {"emotion": "positive|neutral|negative",
                                    "confidence": 0.87,
                                    "scores": {...}}

Stdlib-only HTTP (no FastAPI needed). Runs on 127.0.0.1:8100 by default.
The Node API calls this only when its regex engine has no signal — so this
service can be down without affecting the main flow.
"""
import json
import torch
from http.server import BaseHTTPRequestHandler, HTTPServer
from transformers import AutoTokenizer, AutoModelForSequenceClassification

MODEL = "/Users/thxdadloveyoumost/jjfolder/mymodel/models/v6"
HOST, PORT = "127.0.0.1", 8100
LABELS = ["positive", "neutral", "negative"]

device = "mps" if torch.backends.mps.is_available() else "cpu"
tok = AutoTokenizer.from_pretrained(MODEL)
model = AutoModelForSequenceClassification.from_pretrained(MODEL).to(device).eval()
print(f"model loaded on {device}, serving http://{HOST}:{PORT}", flush=True)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # silence request logging
        pass

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/predict":
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")
            text = str(payload.get("text", "")).strip()
            if not text or len(text) > 4000:
                return self._json(400, {"error": "valid text required (max 4000 chars)"})

            with torch.no_grad():
                enc = tok(text, truncation=True, max_length=128, padding=True, return_tensors="pt").to(device)
                probs = torch.softmax(model(**enc).logits, dim=-1)[0].cpu().tolist()

            scores = dict(zip(LABELS, [round(p, 4) for p in probs]))
            emotion = max(scores, key=scores.get)
            self._json(200, {
                "emotion": emotion,
                "confidence": scores[emotion],
                "scores": scores,
            })
        except Exception as e:
            self._json(500, {"error": "prediction failed"})

if __name__ == "__main__":
    HTTPServer((HOST, PORT), Handler).serve_forever()
