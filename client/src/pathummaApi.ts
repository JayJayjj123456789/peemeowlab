/**
 * pathummaApi.ts — JaiKraJok ThaiLLM client (v6)
 * =====================================================
 * Primary model:  thaillm-8b  (tokenmind.pathumma.in.th)
 * Fallback model: typhoon-v2.5-30b-a3b-instruct  (api.opentyphoon.ai)
 *
 * VQA + Audio: Pathumma API (aiforthai.in.th) — text-only models above.
 */

// ─── Config ───────────────────────────────────────────────────────────────────

// Primary: team's thaillm-8b on tokenmind (via /api/thaillm proxy)
const THAILLM_PROXY = "/api/thaillm";
const THAILLM_MODEL = "thaillm-8b";

// Fallback: typhoon-v2.5-30b via existing proxy
const TYPHOON_PROXY = "/api/typhoon";
const TYPHOON_TEXT_MODEL = "typhoon-v2.5-30b-a3b-instruct";

const TYPHOON_OCR_MODEL = "typhoon-ocr";
const PATHUMMA_PROXY = "/api/pathumma";
const TAVILY_PROXY = "/api/search";  // SearXNG primary + Tavily fallback
const PTM_ASR_PROXY = "/api/ptm-asr";
const PTM_ASR_MODEL = "ptm-asr-1";

// Keys are server-side only — proxies always inject auth.

function thaiLLMHeaders(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

function pathummaHeaders(): Record<string, string> {
  return { "X-lib": "jaikrajok-web" };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = (reader.result as string) || "";
      resolve(dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Convert any browser audio blob (webm, ogg, etc.) to PCM WAV
 * using the Web Audio API. Needed because Chrome records in audio/webm
 * which Typhoon ASR rejects (415 Unsupported Media Type).
 */
async function blobToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();

  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = audioBuffer.length;
  const bytesPerSample = 2; // 16-bit PCM

  const dataSize = numSamples * numChannels * bytesPerSample;
  const wavBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wavBuffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  // RIFF header
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  // fmt chunk
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);          // bits per sample
  // data chunk
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  // Write interleaved PCM samples
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = audioBuffer.getChannelData(ch)[i];
      const clamped = Math.max(-1, Math.min(1, s));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([wavBuffer], { type: "audio/wav" });
}

/** Strip <think>...</think> reasoning blocks, or leaked English reasoning, from Qwen3-Think model */
function stripThink(text: string): string {
  if (!text) return "";

  // 1. Remove ALL <think> tags first (both paired and unpaired)
  let cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")  // Remove paired tags
    .replace(/<\/?think>/gi, "")                 // Remove any remaining unpaired tags
    .trim();

  // 2. Remove leaked English reasoning blocks
  if (/(?:The task is to|First, I need to|The user wants|Check if it's within|Wait, the user|Looking at the|Let's analyze|Let's break down|We need to solve|So, start by|The response should|Okay, the user just said)/i.test(cleaned)) {
    // Check if there is a quoted Thai message like "ดีใจที่เห็นรอยยิ้ม..."
    const thaiQuoteMatch = cleaned.match(/"([฀-๿][^"]{10,})"/);
    if (thaiQuoteMatch && thaiQuoteMatch[1]) {
      return thaiQuoteMatch[1].trim();
    }

    // Otherwise, split into lines and find lines that contain natural Thai text without English instructions
    const lines = cleaned.split("\n");
    const thaiLines = lines.filter(l => {
      const thaiCount = (l.match(/[฀-๿]/g) || []).length;
      const engCount = (l.match(/[a-zA-Z]/g) || []).length;
      return thaiCount > 8 && thaiCount > engCount && !l.includes("The task is") && !l.includes("First, I need") && !l.includes("The user wants") && !l.includes("Okay, the user");
    });

    if (thaiLines.length > 0) {
      return thaiLines.join("\n").trim();
    }
  }

  // 3. General preamble stripping: if text starts with English reasoning before Thai content
  const firstThaiIdx = cleaned.search(/[฀-๿]/);
  if (firstThaiIdx > 0) {
    const preamble = cleaned.slice(0, firstThaiIdx).trim();
    if (/^(Also|Wait|Okay|Alright|Let|The|First|So|I|Hmm|Looking|To|Because|In|#\s*Wait)/i.test(preamble)) {
      return cleaned.slice(firstThaiIdx).trim();
    }
  }


  // 4. Physics/math homework: if response is long and starts with reasoning prose before
  //    the structured answer (## header), trim the preamble. Threshold: >400 chars before first ##.
  const firstHeaderIdx = cleaned.search(/^#{1,3}\s/m);
  if (firstHeaderIdx > 400) {
    const preamble5 = cleaned.slice(0, firstHeaderIdx);
    if (/ดังนั้น|พิจารณา|สังเกต|จะเห็นว่า|ต้องการหา|กำหนดให้|เนื่องจาก|จากโจทย์/.test(preamble5)) {
      return cleaned.slice(firstHeaderIdx).trim();
    }
  }
  return cleaned;
}

/** Extract text from Pathumma (VQA/Audio) raw response shapes */
function extractPathummaText(raw: unknown): string {
  if (typeof raw === "string") return raw.trim();
  if (!raw || typeof raw !== "object") return "";
  const r = raw as Record<string, unknown>;

  if (Array.isArray(r.choices) && r.choices.length > 0) {
    const c = r.choices[0] as Record<string, unknown>;
    const msg = c.message as Record<string, unknown> | undefined;
    if (msg?.content) return String(msg.content).trim();
    if (c.text) return String(c.text).trim();
  }

  for (const k of ["content", "response", "output", "text", "result", "generated_text", "answer"]) {
    if (r[k] && typeof r[k] === "string") return (r[k] as string).trim();
  }
  return "";
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. TEXT LLM — ThaiLLM Chat Completions (OpenAI-compatible)
// ═══════════════════════════════════════════════════════════════════════════════

export const JAIKRAJOK_SYSTEM_PROMPT =
  "คุณคือ กระจก (JaiKraJok) ผู้ช่วยสอนเรียนและเพื่อนคู่คิดอัจฉริยะ สร้างโดยทีม JaiKraJok\n\n" +
  "วิธีตอบ:\n" +
  "- ตอบเป็นภาษาไทยอย่างสุภาพ อบอุ่น ชัดเจน\n" +
  "- ถ้าผู้ใช้แสดงอารมณ์ (เศร้า เครียด เหนื่อย) → ตอบสั้น ๆ 2-4 ประโยคเหมือนเพื่อน ให้กำลังใจ รับฟัง **ห้ามเสนอตัวเลือก [ ] หรือแผนผังช่วยเหลือ**\n" +
  "- ถ้าผู้ใช้ถามคำถามหรือขอแก้โจทย์ → ตอบครอบคลุมละเอียดด้วย Markdown, LaTeX, code blocks ตามปกติ\n" +
  "- สำคัญ: เมื่อได้รับประวัติการสนทนา (conversation history) ให้อ่านและเข้าใจบริบทก่อนตอบทุกครั้ง\n" +
  "- หากคำถามปัจจุบันอ้างอิงถึงคำตอบก่อนหน้า (เช่น 'คูณอีก' '*5' 'เพิ่ม' 'มัน' 'ของเดิม') ให้ใช้ข้อมูลจากประวัติมาคำนวณหรือตอบต่อ ไม่ใช่เริ่มใหม่\n\n" +
  "📐 กฎการจัดรูปแบบคำตอบสำหรับโจทย์และคำถามเชิงวิชาการ (Output Formatting Rules): " +
  "1. **LaTeX Math**: ใช้ `$...$` สำหรับ inline math และ `$$...$$` สำหรับ display math ทุกสูตรสมการ " +
  "2. **Code Blocks**: ใช้ ```language\ncode\n``` พร้อมระบุภาษา (python, cpp, javascript, etc.) " +
  "3. **Tables**: สร้างตาราง markdown เมื่อเปรียบเทียบข้อมูล หรือแสดงขั้นตอนคำนวณ " +
  "4. **Blockquotes**: ใช้ `> quote` สำหรับข้อความสำคัญหรือคำแนะนำ " +
  "5. **Headers**: ใช้ `##` `###` จัดโครงสร้างคำตอบเป็นหัวข้อย่อย " +
  "6. **Bold/Italic**: ใช้ `**bold**` และ `*italic*` เน้นจุดสำคัญ " +
  "7. **Links**: ใช้ `[text](url)` สำหรับอ้างอิงแหล่งข้อมูล " +
  "8. **Horizontal Rules**: ใช้ `---` แยกส่วนที่เกี่ยวข้อง " +
  "⚠️ สำหรับการตอบคำถามเกี่ยวกับอารมณ์/ความรู้สึก: ห้ามใช้ Task Lists `- [ ]`, ห้ามใช้ Mermaid diagrams, ห้ามใช้รายการตัวเลือกแบบเมนู " +
  "🚫 กฎต่อต้านการซ้ำซ้อน (Anti-Repetition Rules) — บังคับเด็ดขาด: " +
  "- ห้ามแสดงส่วน 'สรุปคำตอบ' หรือ 'คำตอบที่ถูกต้อง' มากกว่า 1 ครั้งต่อคำตอบ " +
  "- ห้ามซ้ำข้อความเดิมหรือย่อหน้าเดิมในคำตอบเด็ดขาด " +
  "- ตอบครั้งเดียว สรุปครั้งเดียว จบในคำตอบเดียว " +
  "กฎสำคัญสำหรับการคำนวณทางคณิตศาสตร์และวิชาการ (Anti-Hallucination & Precise Math Rules): " +
  "1. ห้ามเดาคำตอบ หรือเดาผลลัพธ์เด็ดขาด! ต้องแสดงขั้นตอนการคำนวณทางคณิตศาสตร์ที่ถูกต้องทีละบรรทัด " +
  "2. สำหรับโจทย์เศษเหลือ/ทฤษฎีบทจำนวน/ทฤษฎีเศษเหลือ (Remainder / Modular Arithmetic / LCM / ค.ร.น.): " +
  "   - คำนวณ ค.ร.น. ของตัวหารอย่างแม่นยำ " +
  "   - บวกเศษกลับเข้าไป ตรวจสอบเงื่อนไขช่วง " +
  "   - ตรวจสอบกับตัวเลือก ก. ข. ค. ง. ให้ตรงกับข้อที่คำนวณได้ถูกต้อง 100% " +
  "3. สำหรับโจทย์การโปรแกรม/เขียนโค้ด (C, C++, Python, Java, JS ฯลฯ): " +
  "   - สอน 5 หัวข้อหลักพร้อมกล่องโค้ด ```lang ... ``` แยกแต่ละหัวข้อ " +
  "   - โค้ดต้องถูกต้องตามไวยากรณ์ภาษา 100% " +
  "4. สำหรับโจทย์คณิตศาสตร์/วิทยาศาสตร์ ใช้ LaTeX $...$ และ $$...$$ แสดงสมการแบบละเอียดทุกขั้นตอน " +
  "5. หากผู้ใช้มีความเสี่ยงซึมเศร้ารุนแรง ให้แนะนำสายด่วน 1323 ด้วยความห่วงใย";

export const MATH_SYSTEM_PROMPT =
  "คุณคือครูสอนพิเศษคณิตศาสตร์และวิทยาศาสตร์ผู้เชี่ยวชาญระดับสูง สร้างโดยทีม JaiKraJok " +
  "📐 กฎการจัดรูปแบบคำตอบ (Output Formatting Rules) — **บังคับปฏิบัติตลอด**: " +
  "1. **LaTeX Math**: ใช้ `$...$` สำหรับ inline math และ `$$...$$` สำหรับ display math **ทุกสูตรสมการ** " +
  "2. **Code Blocks**: ใช้ ```language\ncode\n``` พร้อมระบุภาษา " +
  "3. **Tables**: สร้างตาราง markdown แสดงขั้นตอนคำนวณ เปรียบเทียบตัวเลือก หรือสรุปผล " +
  "4. **Task Lists**: ใช้ `- [ ]` สำหรับขั้นตอนการแก้โจทย์ `- [x]` สำหรับขั้นตอนที่ทำเสร็จ " +
  "5. **Blockquotes**: ใช้ `> **คำแนะนำ**` เน้นเคล็ดลับ สูตรสำคัญ หรือข้อระวัง " +
  "6. **Headers**: ใช้ `##` `###` จัดโครงสร้าง: ## วิธีแก้, ## การคำนวณ, ## สรุปคำตอบ " +
  "7. **Bold**: ใช้ `**คำตอบสุดท้าย**` เน้นผลลัพธ์ " +
  "8. **Horizontal Rules**: ใช้ `---` แยกแต่ละขั้นตอนหลัก " +
  "🔤 กฎการใช้อักษรตัวเลือก (CRITICAL Choice Rule): " +
  "- หากโจทย์ใช้ตัวเลือกภาษาไทย (ก. ข. ค. ง.) ให้ใช้อักษร ก. ข. ค. ง. ตลอดทั้งคำตอบ ❌ ห้ามเปลี่ยนเป็น A, B, C, D เด็ดขาด " +
  "🚫 กฎต่อต้านการซ้ำซ้อน (CRITICAL Anti-Repetition): " +
  "- ห้ามแสดงส่วน '## สรุปคำตอบสุดท้าย' หรือ 'คำตอบที่ถูกต้อง' มากกว่า **1 ครั้ง** ต่อคำตอบ เด็ดขาด! " +
  "- ห้ามซ้ำหรือ copy ย่อหน้าเดิม ประโยคเดิม หรือข้อความเดิมในคำตอบ " +
  "- ตอบจบในส่วนสรุปเดียว ไม่ต้องพูดซ้ำอีก " +
  "กฎการตอบ (ห้ามเดาตัวเลข คำนวณจริงทีละขั้น): " +
  "1. ตอบเป็นภาษาไทย อธิบายละเอียด ทุกขั้นตอน ห้ามสุ่มหรือเดาคำตอบเด็ดขาด " +
  "2. สำหรับโจทย์เศษเหลือและการหาร: คำนวณ ค.ร.น. (LCM) ให้แม่นยำ บวกเศษกลับเข้าไป แล้วตรวจสอบเงื่อนไขขอบเขต " +
  "3. หากมีตัวเลือก ก. ข. ค. ง. ให้ตรวจทานคำตอบที่คำนวณได้กับตัวเลือกอย่างระมัดระวัง แล้วระบุข้อที่ถูกต้องด้วยอักษร ก. ข. ค. ง. " +
  "4. แสดงสูตรและสมการด้วย LaTeX: inline ใช้ $...$ และ block ใช้ $$...$$ " +
  "5. สรุปคำตอบสุดท้าย **ครั้งเดียว** ในกรอบ $$...$$ และให้กำลังใจผู้เรียน — ห้ามซ้ำสรุปอีก!";

/** OpenAI-compatible message type */
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * TEXT LLM: Call ThaiLLM thaillm-8b via TokenMind
 * Uses proper OpenAI messages[] array format — no need to inject history into prompt strings.
 */
export async function callTextLLM(
  instruction: string,
  systemPrompt: string = JAIKRAJOK_SYSTEM_PROMPT,
  maxTokens: number = 2048,
  temperature: number = 0.4,
  history?: { role: string; text: string }[]
): Promise<string> {
  let effectiveTemperature = temperature;
  let extraInstruction = "";

  // Detect Math / Calculation / Explicit Math Homework Prompt
  // (Excludes simple range hyphens like "2-3 ประโยค" from false-triggering math mode)
  const isMathOrChoice = /(โจทย์คณิต|คำนวณ|สมการ|ค\.ร\.น\.|ห\.ร\.ม\.|เศษเหลือ|ข้อสอบ|lcm|gcd|\bmod\b|\$\d|\d+\s*[+*/%]\s*\d+|\d+\s*=\s*\d+|โจทย์ที่อ่านได้|คำอธิบายแผนภาพ|ข้อมูลโจทย์)/i.test(instruction);
  if (isMathOrChoice) {
    effectiveTemperature = 0.05;
    extraInstruction = "\n\n[หากมีโจทย์คณิตศาสตร์ในคำขอ: แสดงขั้นตอนการคำนวณอย่างแม่นยำทีละบรรทัด ห้ามเดาตัวเลข " +
      "จัดรูปแบบด้วย $$...$$ สำหรับทุกสูตรสมการ และ **Bold** เน้นคำตอบสุดท้าย]";
  }

  // Detect Problem Solving Request (e.g. solve problem, URL, tasks, competitive programming)
  const isProblemSolving = /(solve|แก้โจทย์|คำตอบ|ส่งผ่าน|pass|tasks\/|problem\/|contest\/|toi\d|codecube|leetcode|hackerrank)/i.test(instruction);

  // Detect Programming Tutorial (ONLY when explicitly asked to teach/tutorial, NOT when solving a problem)
  const isExplicitTutorial = /(สอน|tutorial|คู่มือ|เรียนรู้|overview|เรียนเขียน)/i.test(instruction);

  if (isProblemSolving) {
    extraInstruction = "\n\n[ข้อบังคับในการตอบโจทย์โปรแกรมมิ่ง]: " +
      "1. ตอบตรงจุดทันทีด้วยโค้ดภาษาที่ระบุ (เช่น C++) " +
      "2. อธิบายแนวคิด/อัลกอริทึม (Algorithm & Complexity) อย่างกระชับ " +
      "3. แสดงกล่องโค้ด ```cpp ... ``` ฉบับสมบูรณ์ที่พร้อมนำไปคอมไพล์และรันส่งผ่าน 100% " +
      "4. ❌ ห้ามเขียนบทเรียน Hello World หรือบทเรียนพื้นฐานเด็ดขาด ให้แก้โจทย์ที่ระบุทันที";
  } else if (isExplicitTutorial && !isMathOrChoice) {
    extraInstruction = "\n\n[คำขอสอนโปรแกรมมิ่ง: เขียนบทเรียน 5 หัวข้อ: 1. โครงสร้างหลัก & Hello World, 2. Variables & Data Types, 3. Input & Output, 4. Conditionals & Loops, 5. Functions โดยมีกล่องโค้ด ```lang...```]";
  }

  // General formatting boost for all responses — encourage rich markdown
  if (!extraInstruction) {
    extraInstruction = "\n\n[จัดรูปแบบ: ใช้ markdown ให้ครบถ้วน — **Bold** เน้นจุดสำคัญ | `code` inline | ```code blocks``` | " +
      "$$LaTeX$$ สูตร | ตาราง | `- [ ]` task list | `> quote` | `---` แยกส่วน | Mermaid ถ้าเหมาะสม]";
  }

  // Build messages array
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  // Add conversation history as proper assistant/user messages
  if (history && history.length > 0) {
    for (const m of history.slice(-10)) { // Keep last 10 messages
      messages.push({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text,
      });
    }
  }

  // Add current user message (with any extra instruction appended)
  messages.push({ role: "user", content: instruction + extraInstruction });

  const body = JSON.stringify({
    model: THAILLM_MODEL,
    messages,
    max_tokens: maxTokens,
    temperature: effectiveTemperature,
  });

  // ── Primary: thaillm-8b (tokenmind via /api/thaillm proxy) ────────────────
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(`${THAILLM_PROXY}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });

      if (res.ok) {
        const raw = await res.json().catch(() => ({})) as Record<string, unknown>;
        console.debug("[PTM-ThaiLLM] raw response:", raw);
        const choices = raw.choices as { message?: { content?: string } }[] | undefined;
        const content = choices?.[0]?.message?.content ?? "";
        const text = stripThink(content);
        if (text) return text;
      } else {
        console.warn("[PTM-ThaiLLM] HTTP", res.status, "— falling back to typhoon");
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.warn("[PTM-ThaiLLM] timed out after 60s — falling back to typhoon");
    } else {
      console.warn("[PTM-ThaiLLM] fetch error — falling back to typhoon:", err);
    }
  }

  // ── Fallback: typhoon-v2.5-30b ────────────────────────────────────────────
  const fallbackBody = JSON.stringify({
    model: TYPHOON_TEXT_MODEL,
    messages,
    max_tokens: maxTokens,
    temperature: effectiveTemperature,
  });

  const res = await fetch(`${TYPHOON_PROXY}/v1/chat/completions`, {
    method: "POST",
    headers: thaiLLMHeaders(),
    body: fallbackBody,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("[Typhoon fallback] HTTP error", res.status, errBody.slice(0, 300));
    throw new Error(`ThaiLLM ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const raw = await res.json().catch(() => ({})) as Record<string, unknown>;
  console.debug("[Typhoon fallback] raw response:", raw);

  // OpenAI-compatible extraction
  const choices = raw.choices as { message?: { content?: string } }[] | undefined;
  const content = choices?.[0]?.message?.content ?? "";

  const text = stripThink(content);
  if (!text) throw new Error("ThaiLLM returned empty response");
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1b. WEB SEARCH — Tavily Search API
// ═══════════════════════════════════════════════════════════════════════════════

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface TavilySearchResponse {
  query: string;
  results: TavilyResult[];
  answer?: string;
}

/**
 * Search the web using Tavily Search API.
 * Returns up to `maxResults` results with titles, URLs and content snippets.
 */
export async function searchWeb(
  query: string,
  maxResults = 5,
  searchDepth: "basic" | "advanced" = "basic"
): Promise<TavilySearchResponse> {
  const res = await fetch(TAVILY_PROXY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      search_depth: searchDepth,
      include_answer: true,
      include_raw_content: false,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("[Search] HTTP error", res.status, errBody.slice(0, 300));
    throw new Error(`Search ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const raw = await res.json() as TavilySearchResponse;
  console.debug("[Search] Search results for:", query, "| count:", raw.results?.length);
  return raw;
}

/**
 * Keywords/patterns that indicate the user needs current web information.
 * Questions about live data, news, prices, events, people, etc.
 */
const NEEDS_SEARCH_RE = new RegExp(
  [
    // URLs and programming task IDs
    "https?:\\/\\/|tasks\\/|problem\\/|toi\\d|_maxseq|programming\\.in\\.th|codecube|leetcode|hackerrank|solve",
    // Explicit search intent / info queries
    "ค้นหา|search|หาข้อมูล|ข้อมูล|ข้อมูลล่าสุด|latest|recent|ประวัติ|ใครคือ|คือใคร|คืออะไร|รู้จัก",
    // News / current events
    "ข่าว|news|วันนี้|today|ล่าสุด|ปัจจุบัน|current|now|ตอนนี้|เมื่อกี้",
    // Prices / market
    "ราคา|price|หุ้น|stock|บิทคอยน์|bitcoin|crypto|เงิน|dollar|baht|บาท",
    // Weather
    "อากาศ|weather|ฝน|rain|อุณหภูมิ|temperature|forecast|พยากรณ์",
    // People / places / events
    "นักการเมือง|politician|นายก|prime minister|รัฐบาล|government|ดร\\.|ศาสตราจารย์|อาจารย์|ผศ\\.|รศ\\.",
    "ผู้ชนะ|winner|แชมป์|champion|รางวัล|award",
    "กีฬา|sport|ฟุตบอล|football|บาสเกตบอล|basketball",
    "ภาพยนตร์|movie|ซีรีส์|series|เพลง|song",
    // Science / tech facts needing current info
    "ค้นพบ|discovery|งานวิจัย|research|ใหม่|new|เปิดตัว|launch|release",
  ].join("|"),
  "i"
);

export const SEARCH_SYSTEM_PROMPT =
  "คุณคือ กระจก (JaiKraJok) ผู้ช่วยตอบคำถามจากผลการค้นหาเว็บจริงอย่างแม่นยำ 100% " +
  "📐 กฎเหล็กป้องกันการหลอนและอ้างอิงผิดคน (Strict Grounding Rules): " +
  "1. ตอบคำถามเฉพาะข้อมูลบุคคลหรือหัวข้อที่ผู้ใช้ถาม โดยยึดตามข้อความจากผลการค้นหาจริงที่จัดสรรให้เท่านั้น " +
  "2. **ห้ามเอ่ยชื่อบุคคลอื่นที่ไม่ตรงกับคำถามเด็ดขาด** (เช่น ห้ามแต่งชื่อ ดร.ศราวุธ แรมจันทร์, ดร.ศราวุฒิ อารีย์ หรือคนอื่นที่ไม่มีในผลการค้นหามาปะปน) " +
  "3. **ห้ามแต่งประวัติการศึกษา ปริญญา หรือตำแหน่งงาน** ที่ไม่ได้ระบุไว้ในผลการค้นหาเด็ดขาด " +
  "4. **ห้ามสร้างส่วน 'ข้อควรระวัง' หรือสมมุติการสับสนชื่อขึ้นมาเอง** หากไม่มีระบุไว้ในผลการค้นหาจริง " +
  "5. อ้างอิงส่วนที่นำมาตอบด้วยเลข [1], [2], ... ให้ตรงกับแหล่งข้อมูลจริง " +
  "6. หากข้อมูลใดไม่มีระบุในผลการค้นหา ให้ระบุเพียงว่า 'ไม่มีระบุในผลการค้นหาที่พบ'";

export const CODING_SOLVER_PROMPT =
  "คุณคือ กระจก (JaiKraJok) ผู้เชี่ยวชาญการแก้โจทย์โปรแกรมมิ่งและการแข่งขันอัลกอริทึม (Competitive Programming) " +
  "🎯 กฎเหล็กในการตอบโจทย์โปรแกรมมิ่ง (ห้ามละเมิดเด็ดขาด):\n" +
  "1. ❌ CRITICAL: Do NOT write any English thinking, reasoning, or scratchpad text. Begin directly with Thai explanations and the ```cpp ... ``` code block.\n" +
  "2. **อ่าน Output Format ของโจทย์ให้ครบ 100% ก่อนเขียนโค้ด** — ดูตัวอย่าง Input/Output ในโจทย์แล้วตรวจว่าต้อง output กี่บรรทัด อะไรบ้าง\n" +
  "3. **Trace ผ่าน Example ก่อนส่ง** — รัน logic ในหัวกับ example ที่โจทย์ให้ ตรวจว่า output ตรงกับ expected output ทุกบรรทัดทุกช่องว่าง\n" +
  "4. ตอบตรงประเด็นด้วยโค้ดฉบับเต็มภาษา C++ (หรือภาษาที่ขอ) พร้อมใช้งาน 100% — ต้องครอบคลุมทุก output field ที่โจทย์กำหนด\n" +
  "5. อธิบายแนวคิดหลัก (Algorithm & Time Complexity) อย่างกระชับชัดเจน\n" +
  "6. ❌ ห้าม output น้อยกว่าหรือผิดรูปแบบที่โจทย์กำหนด (เช่น ถ้าโจทย์ต้องการ 2 บรรทัด ต้องแสดง 2 บรรทัดตามตัวอย่างอย่างถูกต้อง)";

/**
 * Smart wrapper around callTextLLM:
 * - Detects if the query needs web search (using NEEDS_SEARCH_RE)
 * - If yes: fetches Tavily results (with titles, URLs, snippets), injects them into prompt
 * - Appends verified clickable Markdown links [Title](URL) for every source used.
 */
export async function callTextLLMWithSearch(
  instruction: string,
  systemPrompt: string = JAIKRAJOK_SYSTEM_PROMPT,
  maxTokens: number = 3072,
  temperature: number = 0.3,
  history?: { role: string; text: string }[]
): Promise<{ reply: string; searchUsed: boolean; sources: { title: string; url: string }[] }> {
  const needsSearch = NEEDS_SEARCH_RE.test(instruction);

  if (!needsSearch) {
    const reply = await callTextLLM(instruction, systemPrompt, maxTokens, temperature, history);
    return { reply, searchUsed: false, sources: [] };
  }

  // Perform web search with Tavily
  let searchCtx = "";
  let sources: { title: string; url: string }[] = [];

  try {
    const searchData = await searchWeb(instruction, 5, "basic");
    sources = searchData.results.map(r => ({ title: r.title, url: r.url }));

    const snippets = searchData.results
      .map((r, i) => `[${i + 1}] **${r.title}** (${r.url})\n${r.content.slice(0, 400)}`)
      .join("\n\n");

    searchCtx =
      `\n\n---\n**ผลการค้นหาเว็บ (Tavily Search) — ใช้ข้อมูลเหล่านี้ตอบคำถาม:**\n\n${snippets}\n\n` +
      `**คำสั่ง**: ตอบคำถามผู้ใช้โดยอิงจากผลการค้นหาด้านบนเท่านั้น อ้างอิงด้วย [1], [2], ... ห้ามแต่งข้อมูลที่ไม่มีในผลการค้นหา\n---`;
  } catch (err) {
    console.warn("[Tavily] Search failed, falling back to LLM-only:", err);
  }

  const augmentedInstruction = instruction + searchCtx;
  const effectiveSystemPrompt = searchCtx ? SEARCH_SYSTEM_PROMPT : systemPrompt;

  const reply = await callTextLLM(augmentedInstruction, effectiveSystemPrompt, maxTokens, temperature, history);

  // Append source links if search was used
  if (sources.length > 0) {
    const sourcesBlock =
      "\n\n---\n**แหล่งข้อมูล:**\n" +
      sources.map((s, idx) => `[${idx + 1}] [${s.title}](${s.url})`).join("\n");

    return { reply: reply + sourcesBlock, searchUsed: sources.length > 0, sources };
  }

  return { reply, searchUsed: sources.length > 0, sources };
}

/**
 * SENTIMENT ANALYSIS via ThaiLLM / Tag Parsing / Regex
 */
export async function analyzeSentiment(text: string): Promise<string> {
  if (!text) return "neutral";

  // 1. Direct tag check from Vision LLM [อารมณ์: ...]
  const tagMatch = text.match(/\[อารมณ์[:\s]+([^\]]+)\]/i);
  if (tagMatch) {
    const tag = tagMatch[1].trim().toLowerCase();
    if (tag.includes("เครียด") || tag.includes("ตึง") || tag.includes("กังวล") ||
      tag.includes("เศร้า") || tag.includes("ท้อ") || tag.includes("เสียใจ") ||
      tag.includes("เหนื่อย") || tag.includes("เพลีย") || tag.includes("ล้า") ||
      tag.includes("โกรธ") || tag.includes("หดหู่") || tag.includes("หงุดหงิด") ||
      tag.includes("รำคาญ") || tag.includes("เบื่อ") || tag.includes("กลัว") ||
      tag.includes("วิตก") || tag.includes("ผิดหวัง") || tag.includes("สิ้นหวัง")) return "negative";
    if (tag.includes("สดใส") || tag.includes("ยิ้ม") || tag.includes("สุข") ||
      tag.includes("ดีใจ") || tag.includes("สงบ") || tag.includes("ผ่อนคลาย") ||
      tag.includes("ร่าเริง") || tag.includes("เบิกบาน") || tag.includes("มีความสุข")) return "positive";
  }

  // 2. Our own /api/emotion — server-side engine (regex+negation+model ensemble).
  //    Replaces direct SSense calls: same-origin, faster, transparent, no quota.
  try {
    const res = await fetch("/api/emotion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 4000), source: "web" }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.emotion && ["positive", "neutral", "negative"].includes(data.emotion))
        return data.emotion;
    }
  } catch {
    // fall through to local keyword fallback
  }

  // 3. Local keyword fallback
  return classifyMoodFromText(text);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. VISION LLM — Pathumma VQA (still uses aiforthai API — ThaiLLM is text-only)
// ═══════════════════════════════════════════════════════════════════════════════

export interface VisionResult {
  answer: string;
  llmReply: string;
}

export async function callVisionLLM(
  imageBlob: Blob,
  query: string,
  _filename = "image.jpg",
  model = TYPHOON_OCR_MODEL,
  systemPromptOverride?: string
): Promise<string> {
  const base64Data = await blobToBase64(imageBlob);
  const mimeType = imageBlob.type || "image/jpeg";

  const ocrSystemPrompt = systemPromptOverride ??
    "You are an OCR engine. Extract ALL text from the image exactly as it appears. " +
    "Return clean Markdown only — no explanations, no commentary, no extra text. " +
    "Format rules: " +
    "- Mathematical equations: inline as $...$ and block as $$...$$ (LaTeX). " +
    "- Tables: use HTML <table>...</table> format. " +
    "- Diagrams, figures, charts: wrap in <figure>...</figure> and describe all visible elements, labels, annotations, and numbers in Thai. " +
    "- Include ALL visible text: headings, body text, labels, captions, choices (ก. ข. ค. ง.), numbers, units. " +
    "- Do NOT skip, summarize, or paraphrase any content. Transcribe verbatim.";

  const payload = {
    model: model,
    messages: [
      { role: "system", content: ocrSystemPrompt },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } },
          { type: "text", text: query },
        ],
      },
    ],
    max_tokens: 4096,
    temperature: 0.1,
    top_p: 0.6,
    repetition_penalty: 1.2,
  };

  const res = await fetch(`${TYPHOON_PROXY}/v1/chat/completions`, {
    method: "POST",
    headers: { ...thaiLLMHeaders() },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`TyphoonOCR ${res.status}: ${errText.slice(0, 200)}`);
  }

  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const choices = raw.choices as { message?: { content?: string } }[] | undefined;
  const text = choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("TyphoonOCR returned empty response");
  return text;
}

export const SELFIE_SYSTEM_PROMPT =
  "คุณคือ กระจก (JaiKraJok) ผู้ช่วยตอบสนองอารมณ์จากใบหน้าอย่างอบอุ่นและเห็นอกเห็นใจ " +
  "ตอบเป็นข้อความสั้น ๆ 2-3 ประโยคภาษาไทยอย่างเป็นธรรมชาติ สุภาพ และน่าฟัง " +
  "❌ CRITICAL: Respond ONLY in Thai language. Do NOT output any English thinking or reasoning blocks. " +
  "❌ ห้ามใส่ [Task List], ห้ามใส่รายการข้อ 1. 2. 3., ห้ามใส่ไดอะแกรม Mermaid หรือโค้ดใด ๆ เด็ดขาด " +
  "ตอบเฉพาะข้อความทักทาย ให้กำลังใจ และสอบถามความรู้สึกอย่างจริงใจเท่านั้น";

export async function analyzeSelfie(imageBlob: Blob): Promise<VisionResult & { emotionKey?: string }> {
  const visionQuery =
    "ดูใบหน้าของคนในภาพนี้แล้วบรรยายอารมณ์และความรู้สึกที่สังเกตเห็นเป็นภาษาไทย " +
    "สังเกตจากแววตา รอยยิ้ม สีหน้า และท่าทาง ตอบสั้น ๆ 1-2 ประโยค " +
    "แล้วลงท้ายด้วย: [อารมณ์: <คำเดียว เช่น ยิ้มแย้ม / สดใส / เศร้า / เครียด / เหนื่อย / สงบ / โกรธ / หดหู่ / กังวล / ผ่อนคลาย>]";

  let answer: string;
  try {
    answer = await callVisionLLM(imageBlob, visionQuery);
  } catch (e) {
    console.warn("Vision LLM selfie failed:", e);
    answer = "ไม่สามารถวิเคราะห์ภาพใบหน้าได้ในขณะนี้";
  }

  // Derive emotionKey: tag check + keyword scan on the vision answer (skip SSense —
  // SSense reads sentence tone, not described emotion, so "บุคคลนี้ดูเหมือนจะโกรธ" → neutral)
  const emotionKey = classifyMoodFromText(answer);

  let llmReply: string;
  try {
    const rawReply = await callTextLLM(
      `จากการวิเคราะห์ภาพใบหน้า: "${answer}" ตอบสนองด้วยความเห็นอกเห็นใจ สอบถามความรู้สึกของผู้ใช้ 2-3 ประโยคเป็นภาษาไทยเท่านั้น (ห้ามใส่ Task List หรือ Mermaid เด็ดขาด)`,
      SELFIE_SYSTEM_PROMPT,
      1024,
      0.1
    );
    // Strip any stray internal Task List or Mermaid blocks or leaked thinking
    llmReply = rawReply
      .replace(/\[Task List\][\s\S]*?(?=\n\[|\n#|\n\n[A-Z]|$)/gi, "")
      .replace(/\[Mermaid\][\s\S]*?```[\s\S]*?```/gi, "")
      .replace(/```mermaid[\s\S]*?```/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch {
    llmReply = "กระจกเห็นรูปคุณแล้วค่ะ วันนี้รู้สึกเป็นยังไงบ้าง?";
  }

  return { answer, llmReply, emotionKey };
}

/** Helper to convert stray A/B/C/D choice letters back to ก./ข./ค./ง. if question uses Thai choice letters */
function fixThaiChoices(reply: string, ocrText: string): string {
  if (!reply) return reply;

  const hasThaiChoices = /[กขคง][.)]|\bก\b|\bข\b|\bค\b|\bง\b/.test(ocrText);
  if (!hasThaiChoices) return reply;

  let result = reply;
  result = result.replace(/ตัวเลือก\s*A\b/gi, "ตัวเลือก ก.");
  result = result.replace(/ตัวเลือก\s*B\b/gi, "ตัวเลือก ข.");
  result = result.replace(/ตัวเลือก\s*C\b/gi, "ตัวเลือก ค.");
  result = result.replace(/ตัวเลือก\s*D\b/gi, "ตัวเลือก ง.");

  result = result.replace(/ข้อ\s*A\b/gi, "ข้อ ก.");
  result = result.replace(/ข้อ\s*B\b/gi, "ข้อ ข.");
  result = result.replace(/ข้อ\s*C\b/gi, "ข้อ ค.");
  result = result.replace(/ข้อ\s*D\b/gi, "ข้อ ง.");

  result = result.replace(/(คำตอบที่ถูกต้องคือ:\s*)A\b/gi, "$1ก.");
  result = result.replace(/(คำตอบที่ถูกต้องคือ:\s*)B\b/gi, "$1ข.");
  result = result.replace(/(คำตอบที่ถูกต้องคือ:\s*)C\b/gi, "$1ค.");
  result = result.replace(/(คำตอบที่ถูกต้องคือ:\s*)D\b/gi, "$1ง.");

  result = result.replace(/(คำตอบคือ:\s*)A\b/gi, "$1ก.");
  result = result.replace(/(คำตอบคือ:\s*)B\b/gi, "$1ข.");
  result = result.replace(/(คำตอบคือ:\s*)C\b/gi, "$1ค.");
  result = result.replace(/(คำตอบคือ:\s*)D\b/gi, "$1ง.");

  return result;
}

// System prompt for the unified vision+reasoning call on homework images
const HOMEWORK_VISION_SYSTEM =
  "You are a physics and mathematics expert who can both read Thai text from images and reason about diagrams. " +
  "When given an image containing a problem: " +
  "1. Transcribe ALL Thai text exactly as written (problem statement, variable names, units). " +
  "2. For any diagram/figure: identify every labeled point (O, A, B, ...), every angle arc with its exact degree value, " +
  "every vector/arrow with its direction description, every axis label, and every annotated quantity. " +
  "State each diagram fact as a complete sentence: 'The projectile is launched from point O at 45 degrees from the vertical axis (Y-axis).' " +
  "'At point A, the velocity vector makes 60 degrees from the vertical (Y-axis), i.e., 30 degrees above horizontal.' " +
  "3. List ALL given quantities with their symbols and values. " +
  "4. State what the problem is asking to find. " +
  "Do NOT solve — only extract and describe. Be exhaustive and precise about angles; never describe grid coordinates as physics data.";

export async function analyzeHomework(imageBlob: Blob): Promise<VisionResult> {
  // Single vision call: unified OCR + diagram description with physics-aware system prompt
  let answer: string;
  try {
    // typhoon-ocr is the only model that accepts image inputs; 
    // it reasons about angles/diagram structure instead of just dumping raw text.
    answer = await callVisionLLM(
      imageBlob,
      "Read this image. Transcribe all Thai text exactly. For each diagram element (points, angles, vectors, axes), " +
      "write one sentence per element stating exactly what it shows with its precise numerical value. " +
      "List all given quantities. State what the problem asks to find. Do not solve.",
      "image.jpg",
      TYPHOON_OCR_MODEL,
      HOMEWORK_VISION_SYSTEM
    );
    console.debug("[Homework vision]", answer);
  } catch (e) {
    console.warn("Homework vision failed:", e);
    answer = "ไม่สามารถอ่านโจทย์จากภาพได้ในขณะนี้";
  }

  if (!answer || answer.length < 10) {
    return { answer: "ไม่สามารถอ่านโจทย์จากภาพได้ในขณะนี้", llmReply: "ไม่สามารถอ่านโจทย์จากภาพได้ในขณะนี้" };
  }

  // Detect multiple-choice: require choice labels (ก./ข./ค./ง.) at line start, at least 2 distinct
  const lineStartChoiceRe = /(?:^|\n)\s*([กขคง])\.\s/g;
  const choiceLettersFound = new Set<string>();
  let _cm: RegExpExecArray | null;
  while ((_cm = lineStartChoiceRe.exec(answer)) !== null) {
    choiceLettersFound.add(_cm[1]);
  }
  const hasChoices = choiceLettersFound.size >= 2;

  let llmReply: string;
  try {
    let solvePrompt: string;

    if (hasChoices) {
      solvePrompt =
        `ข้อมูลโจทย์และตัวเลือกที่อ่านและวิเคราะห์ได้จากภาพ:\n${answer.slice(0, 3000)}\n\n` +
        `คำสั่งเรียบเรียงเฉลย:\n` +
        `1. **โจทย์และข้อมูลในภาพ**: สรุปโจทย์และรายละเอียดสั้น ๆ\n` +
        `2. **ตัวเลือกทั้งหมด**: แสดงตัวเลือก ก., ข., ค., ง. ที่ **ถอดความได้จากภาพข้างต้นเท่านั้น** — ห้ามประดิษฐ์หรือแต่งตัวเลือกใหม่เด็ดขาด\n` +
        `3. **วิเคราะห์ตัวเลือก**: อธิบายเหตุผลของแต่ละตัวเลือกว่าถูกหรือผิด\n` +
        `4. **สรุปคำตอบ**: ปิดท้ายด้วยบรรทัด **คำตอบที่ถูกต้องคือ: [ก./ข./ค./ง.]** เพียง 1 ครั้งเท่านั้น\n\n` +
        `❌ ห้ามใส่ตัวเลือกที่ไม่ได้ปรากฏในข้อความด้านบนเด็ดขาด`;
    } else {
      solvePrompt =
        `ข้อมูลทั้งหมดที่อ่านได้จากภาพโจทย์ (รวมมุม จุด เวกเตอร์ ค่าที่กำหนด และสิ่งที่โจทย์ถาม):\n` +
        `${answer.slice(0, 4000)}\n\n` +
        `⚠️ คำสั่งสำคัญ: ข้อมูลด้านบนมาจากการอ่านภาพโจทย์จริง รวมถึงมุมและค่าต่าง ๆ จากแผนภาพ\n` +
        `ทุกมุม ทุกจุด และทุกค่าที่ระบุด้านบน คือข้อมูลฟิสิกส์ที่ต้องใช้คำนวณโดยตรง ห้ามบอกว่า 'ขาดข้อมูล'\n\n` +
        `คำสั่ง: แก้โจทย์นี้แบบเฉลยสมบูรณ์\n` +
        `1. **ข้อมูลที่กำหนด**: รวบรวมค่า สัญลักษณ์ มุม และสิ่งที่โจทย์ถามหา\n` +
        `2. **วิธีคำนวณ**: แสดงสมการและขั้นตอนทีละบรรทัด\n` +
        `3. **คำตอบสุดท้าย**: ระบุค่าพร้อมหน่วย\n\n` +
        `❌ ห้ามสร้างตัวเลือก ก. ข. ค. ง. เพิ่มเองเด็ดขาด`;
    }

    const rawReply = await callTextLLM(solvePrompt, MATH_SYSTEM_PROMPT, 6144, 0.05);
    llmReply = fixThaiChoices(rawReply, answer);
    if (!llmReply || llmReply.length < 30) {
      llmReply = `## เฉลยการบ้าน\n\n${answer}`;
    }
  } catch (err) {
    console.error("Homework text LLM failed:", err);
    llmReply = `## โจทย์และเฉลยจากภาพ\n\n${answer}`;
  }

  return { answer, llmReply };
}

export async function analyzeImageWithCaption(imageBlob: Blob, caption: string = ""): Promise<VisionResult> {
  let answer: string;
  try {
    const visionQuery = caption.trim()
      ? `วิเคราะห์ภาพนี้ตามคำสั่งของผู้ใช้: "${caption.trim()}". อ่านข้อความ ตัวเลข สูตร ไดอะแกรม และตารางทั้งหมดในภาพอย่างละเอียด`
      : "อ่านข้อความทั้งหมดในภาพอย่างละเอียด แปลงสูตรคณิตศาสตร์เป็น LaTeX และอธิบายตารางหรือแผนภาพ";

    answer = await callVisionLLM(
      imageBlob,
      visionQuery,
      "image.jpg",
      TYPHOON_OCR_MODEL,
      HOMEWORK_VISION_SYSTEM
    );
  } catch (e) {
    console.warn("Image vision failed:", e);
    answer = "ไม่สามารถอ่านข้อมูลจากภาพได้ในขณะนี้";
  }

  if (!answer || answer.length < 5) {
    answer = "ไม่สามารถอ่านข้อมูลจากภาพได้ในขณะนี้";
  }

  let llmReply: string;
  try {
    const prompt = caption.trim()
      ? `ผู้ใช้ส่งภาพพร้อมคำสั่ง: "${caption.trim()}"\n\nข้อมูลที่อ่านและวิเคราะห์ได้จากภาพ:\n${answer.slice(0, 4000)}\n\nคำสั่ง: ตอบคำถามและอธิบายโจทย์/ข้อสงสัยของผู้ใช้เกี่ยวกับภาพนี้อย่างละเอียด จัดรูปแบบ Markdown และ KaTeX $$...$$ ให้ครบถ้วนสมบูรณ์`
      : `ข้อมูลที่อ่านและวิเคราะห์ได้จากภาพ:\n${answer.slice(0, 4000)}\n\nคำสั่ง: อธิบายและวิเคราะห์เนื้อหาในภาพนี้ให้ผู้ใช้เข้าใจง่าย จัดรูปแบบ Markdown และ KaTeX $$...$$ ให้สวยงาม`;

    const rawReply = await callTextLLM(prompt, MATH_SYSTEM_PROMPT, 6144, 0.05);
    llmReply = fixThaiChoices(rawReply, answer);
    if (!llmReply || llmReply.length < 20) {
      llmReply = answer;
    }
  } catch (err) {
    console.error("Vision caption LLM failed:", err);
    llmReply = answer;
  }

  return { answer, llmReply };
}


// ═══════════════════════════════════════════════════════════════════════════════
// 3. AUDIO — Pathumma ptm-asr-1 (primary) + Pathumma AudioQA (fallback)
// ═══════════════════════════════════════════════════════════════════════════════

export interface AudioResult {
  transcription: string;
  llmReply: string;
  emotionKey: string;
}

/** Pathumma ptm-asr-1 — OpenAI-compatible transcription endpoint */
export async function callTyphoonASR(audioBlob: Blob): Promise<string> {
  // ptm-asr-1 supported formats: wav, mp3, flac, ogg, opus
  // Chrome MediaRecorder produces audio/webm which is rejected (415).
  // Convert any unsupported format to WAV via Web Audio API.
  const SUPPORTED = ["audio/wav", "audio/wave", "audio/x-wav", "audio/mp3", "audio/mpeg", "audio/flac", "audio/ogg", "audio/opus"];
  const isSupported = SUPPORTED.some(t => audioBlob.type.startsWith(t.split(";")[0]));

  let fileBlob = audioBlob;
  let fileName: string;

  if (!isSupported) {
    console.debug("[ptm-asr-1] Converting", audioBlob.type, "→ WAV for upload");
    fileBlob = await blobToWav(audioBlob);
    fileName = "recording.wav";
  } else {
    const mimeToExt: Record<string, string> = {
      "audio/wav": "wav", "audio/wave": "wav", "audio/x-wav": "wav",
      "audio/mp3": "mp3", "audio/mpeg": "mp3", "audio/flac": "flac",
      "audio/ogg": "ogg", "audio/opus": "opus",
    };
    const ext = Object.entries(mimeToExt).find(([k]) => audioBlob.type.startsWith(k))?.[1] ?? "wav";
    fileName = `recording.${ext}`;
  }

  const form = new FormData();
  form.append("file", fileBlob, fileName);
  form.append("model", PTM_ASR_MODEL);

  const res = await fetch(`${PTM_ASR_PROXY}/audio/transcriptions`, {
    method: "POST",
    headers: {},
    body: form,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("[ptm-asr-1] HTTP error", res.status, errBody.slice(0, 300));
    throw new Error(`ptm-asr-1 ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  console.debug("[ptm-asr-1] raw response:", raw);
  const text = (raw.text as string) ?? "";
  if (!text.trim()) throw new Error("ptm-asr-1 returned empty transcription");
  return text.trim();
}

/** Pathumma AudioQA fallback */
export async function callAudioLLM(audioBlob: Blob, instruction: string): Promise<string> {
  const mimeToExt: Record<string, string> = {
    "audio/wav": "wav", "audio/wave": "wav", "audio/x-wav": "wav",
    "audio/mp3": "mp3", "audio/mpeg": "mp3", "audio/ogg": "ogg",
    "audio/mp4": "mp4", "audio/webm": "webm", "video/webm": "webm",
  };
  const ext = mimeToExt[audioBlob.type] ?? "webm";
  const form = new FormData();
  form.append("file", audioBlob, `recording.${ext}`);
  form.append("instruction", instruction);

  const res = await fetch(`${PATHUMMA_PROXY}/audioqa/inference/`, {
    method: "POST",
    headers: pathummaHeaders(),
    body: form,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("[AudioLLM] HTTP error", res.status, errBody.slice(0, 300));
    throw new Error(`Audio LLM ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const raw = await res.json().catch(() => ({}));
  console.debug("[AudioLLM] raw response:", raw);
  const text = stripThink(extractPathummaText(raw));
  if (!text) throw new Error("Audio LLM returned empty response");
  return text;
}

export async function analyzeAudio(audioBlob: Blob): Promise<AudioResult> {
  let transcription = "";

  // Always use ptm-asr-1 via proxy
  try {
    transcription = await callTyphoonASR(audioBlob);
    console.debug("[ptm-asr-1] Transcription:", transcription);
  } catch (err) {
    console.warn("[ptm-asr-1] Failed, falling back to Pathumma AudioQA:", err);
  }

  // Fallback: Pathumma AudioQA
  if (!transcription) {
    const audioInstruction =
      "ฟังเสียงนี้และแปลงเป็นข้อความภาษาไทยให้ครบถ้วน " +
      "ตอบในรูปแบบ: [ข้อความ: ...ข้อความที่ได้ยิน...] แล้วตามด้วยสรุปสั้น ๆ ว่าผู้พูดกำลังพูดถึงอะไร";
    try {
      const audioResponse = await callAudioLLM(audioBlob, audioInstruction);
      const match = audioResponse.match(/\[ข้อความ[:\s]+([^\]]+)\]/i);
      transcription = match ? match[1].trim() : audioResponse;
    } catch (err) {
      console.warn("Pathumma AudioQA also failed:", err);
      return {
        transcription: "",
        llmReply: "ขอโทษนะคะ กระจกได้ยินเสียงไม่ชัด ลองพูดอีกครั้งหรือพิมพ์ข้อความแทนได้ค่ะ",
        emotionKey: "neutral",
      };
    }
  }

  const textForAnalysis = transcription;
  const emotionKey = await analyzeSentiment(textForAnalysis);

  let llmReply: string;
  try {
    llmReply = await callTextLLM(
      `ผู้ใช้พูดว่า: "${textForAnalysis}"\nตอบสนองด้วยความเข้าใจและเห็นอกเห็นใจ ถ้ามีคำถามช่วยตอบด้วย ตอบไม่เกิน 3 ประโยค`
    );
  } catch {
    llmReply = transcription || "กระจกได้ยินคุณแล้วค่ะ วันนี้รู้สึกเป็นยังไงบ้าง?";
  }

  return { transcription, llmReply, emotionKey };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mood Classifier — Thai keyword-based (local fallback)
// ═══════════════════════════════════════════════════════════════════════════════

export function classifyMoodFromText(text: string): string {
  if (!text) return "neutral";

  // 1. Direct tag check from Vision LLM [อารมณ์: ...]
  const tagMatch = text.match(/\[อารมณ์[:\s]+([^\]]+)\]/i);
  if (tagMatch) {
    const tag = tagMatch[1].trim().toLowerCase();
    if (tag.includes("เครียด") || tag.includes("ตึง") || tag.includes("กังวล") ||
      tag.includes("เศร้า") || tag.includes("ท้อ") || tag.includes("เสียใจ") ||
      tag.includes("เหนื่อย") || tag.includes("เพลีย") || tag.includes("ล้า") ||
      tag.includes("โกรธ") || tag.includes("หดหู่") || tag.includes("หงุดหงิด") ||
      tag.includes("รำคาญ") || tag.includes("เบื่อ") || tag.includes("กลัว") ||
      tag.includes("วิตก") || tag.includes("ผิดหวัง") || tag.includes("สิ้นหวัง")) return "negative";
    if (tag.includes("สดใส") || tag.includes("ยิ้ม") || tag.includes("สุข") ||
      tag.includes("ดีใจ") || tag.includes("สงบ") || tag.includes("ผ่อนคลาย") ||
      tag.includes("ร่าเริง") || tag.includes("เบิกบาน") || tag.includes("มีความสุข")) return "positive";
  }

  const lower = text.toLowerCase();
  const cleaned = lower.replace(/(ไม่มี|ไม่|ไร้|ปราศจาก)\s*(รอยยิ้ม|ยิ้ม|ความสุข|ความสดใส|อารมณ์ดี|ความผ่อนคลาย)/g, "");

  if (/(เครียด|ปวดศีรษะ|หมอง|ตึง|กดดัน|กังวล|กลุ้ม|รับไม่ไหว|stress|เหนื่อย|อ่อนเพลีย|หมดแรง|ไม่มีแรง|เพลีย|นอนไม่หลับ|ล้า|tired|เศร้า|เสียใจ|ท้อแท้|ท้อใจ|สิ้นหวัง|หมดกำลังใจ|เหงา|โดดเดี่ยว|ผิดหวัง|sad|โกรธ|หดหู่|หงุดหงิด|รำคาญ|เบื่อหน่าย|กลัว|วิตก|ขุ่นเคือง|เจ็บปวด|ทุกข์|ทุกข์ใจ|หน่ายใจ|angry|upset|frustrated)/.test(cleaned)) return "negative";
  if (/(ยิ้ม|สดใส|ร่าเริง|มีความสุข|อารมณ์ดี|ดีใจ|สนุก|เยี่ยม|ภูมิใจ|สุขใจ|สำเร็จ|เบิกบาน|เป็นมิตร|หัวเราะ|happy|ผ่อนคลาย|สบายใจ|สงบ|โล่งใจ|ปกติดี|calm|โอเค)/.test(cleaned)) return "positive";

  return "neutral";
}

// ═══════════════════════════════════════════════════════════════════════════════
// Unified chat handler — ThaiLLM + parallel sentiment analysis
// ═══════════════════════════════════════════════════════════════════════════════

export interface ChatResult {
  reply: string;
  emotionKey: string;
  searchUsed?: boolean;
  sources?: { title: string; url: string }[];
}

export async function chat(
  userMessage: string,
  history?: { role: string; text: string }[]
): Promise<ChatResult> {
  const [searchResult, emotionKey] = await Promise.all([
    callTextLLMWithSearch(userMessage, JAIKRAJOK_SYSTEM_PROMPT, 3072, 0.4, history),
    analyzeSentiment(userMessage).catch(() => classifyMoodFromText(userMessage)),
  ]);
  return {
    reply: searchResult.reply,
    emotionKey,
    searchUsed: searchResult.searchUsed,
    sources: searchResult.sources,
  };
}

/**
 * Determine if a query needs web search based on content analysis.
 * Returns true for questions about current events, facts, or information lookup.
 */
function needsWebSearch(message: string): boolean {
  const lower = message.toLowerCase().trim();

  // Math expressions and simple calculations don't need search
  if (/^[\d\s+\-*/()×÷.]+$/.test(message)) return false;
  if (/^\d+\s*[+\-*/×÷]\s*\d+/.test(message)) return false;

  // Simple greetings and emotions don't need search
  if (/^(สวัสดี|หวัดดี|ดีจ้า|ว่าไง|hello|hi|hey|เหนื่อย|เครียด|เศร้า|สบายดี)/.test(lower)) return false;

  // Questions with "who", "what", "when", "where", "why" likely need search
  if (/(ใคร|อะไร|เมื่อไร|ที่ไหน|ทำไม|อย่างไร|who|what|when|where|why|how)/.test(lower)) return true;

  // Current/recent time indicators need search
  if (/(ปัจจุบัน|ตอนนี้|วันนี้|เดี๋ยวนี้|ล่าสุด|current|now|today|recent|latest)/.test(lower)) return true;

  // Questions ending with question mark likely need information
  if (/[?？]$/.test(message)) return true;

  // Default to no search for casual conversation
  return false;
}

/**
 * Smart chat with conditional web search.
 * Analyzes the input and only uses web search when needed.
 */
export async function chatWithSearch(
  userMessage: string,
  history?: { role: string; text: string }[]
): Promise<ChatResult> {
  const emotionKey = await analyzeSentiment(userMessage).catch(() => classifyMoodFromText(userMessage));

  // Check if this query needs web search
  if (!needsWebSearch(userMessage)) {
    // Simple query - use LLM directly without search
    const reply = await callTextLLM(userMessage, JAIKRAJOK_SYSTEM_PROMPT, 3072, 0.4, history);
    return { reply, emotionKey, searchUsed: false, sources: [] };
  }

  // Fetch search results for information queries
  const searchData = await searchWeb(userMessage, 5, "basic").catch(() => ({ results: [], query: userMessage }));

  if (searchData.results.length === 0) {
    // No search results — fall back to regular LLM
    const reply = await callTextLLM(userMessage, JAIKRAJOK_SYSTEM_PROMPT, 3072, 0.4, history);
    return { reply, emotionKey, searchUsed: false, sources: [] };
  }

  // Build search context with results - include full content for sources
  const sources = searchData.results.map(r => ({ title: r.title, url: r.url, content: r.content }));
  const snippets = searchData.results
    .map((r, i) => `[${i + 1}] **${r.title}** (${r.url})\n${r.content.slice(0, 400)}`)
    .join("\n\n");

  const searchCtx =
    `\n\n---\n**ผลการค้นหาเว็บ — ใช้ข้อมูลเหล่านี้ตอบคำถาม:**\n\n${snippets}\n\n` +
    `**คำสั่ง**: ตอบคำถามผู้ใช้โดยอิงจากผลการค้นหาด้านบนเท่านั้น อ้างอิงด้วย [1], [2], ... ห้ามแต่งข้อมูลที่ไม่มีในผลการค้นหา\n---`;

  const augmentedInstruction = userMessage + searchCtx;
  const searchReply = await callTextLLM(augmentedInstruction, SEARCH_SYSTEM_PROMPT, 3072, 0.4, history);

  // Append clickable source links
  const sourcesBlock =
    "\n\n---\n**แหล่งข้อมูล:**\n" +
    sources.map((s, idx) => `[${idx + 1}] [${s.title}](${s.url})`).join("\n");

  return {
    reply: searchReply + sourcesBlock,
    emotionKey,
    searchUsed: true,
    sources,
  };
}
