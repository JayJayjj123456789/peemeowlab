/**
 * MathText.tsx — Robust Rich Text, Code & KaTeX Math Renderer for JaiKraJok
 * Renders:
 *   - Code blocks ```lang\ncode``` (with dark theme, syntax colors & Copy button)
 *   - LaTeX Display Math ($...$, \[...\], \begin{aligned}...\end{aligned}) via KaTeX
 *   - LaTeX Inline Math ($...$, \(...\)) via KaTeX
 *   - Markdown headers (#, ##, ###), bold (**text**), lists (1., -), blockquotes (>), inline code (`code`), tables
 */
import { useState } from "react";
import "katex/dist/katex.min.css";
import katex from "katex";

interface Props {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function MathText({ text, className, style }: Props) {
  if (!text) return null;

  // Render markdown directly from prop text (prevents state desync)
  const nodes = parseFullMarkdown(text);

  return (
    <div
      className={className}
      style={{
        ...style,
        display: "block",
        width: "100%",
        lineHeight: 1.6,
        color: "inherit",
        wordBreak: "break-word",
      }}
    >
      {nodes}
    </div>
  );
}

// ─── Single-Pass Sequential Block Tokenizer ────────────────────────────────────

function parseFullMarkdown(raw: string): React.ReactNode[] {
  let text = raw.replace(/\r\n/g, "\n");

  // Normalize delimiters for consistent handling:
  //   \[ ... \]  =>  $$ ... $$
  //   \( ... \)  =>  $ ... $
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, latex) => `\n$$\n${latex.trim()}\n$$\n`);
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, latex) => `$${latex.trim()}$`);

  const nodes: React.ReactNode[] = [];

  // Master Block Matcher:
  //   Group 1: Code blocks ```lang\ncode...```
  //   Group 2: Display Math $$...$$
  //   Group 3: Bare LaTeX Environments \begin{env}...\end{env}
  const MASTER_BLOCK_REGEX = /(```[a-zA-Z0-9_+#-]*[ \t]*\n?[\s\S]*?(?:```|$))|(\$\$[\s\S]*?\$\$)|(\\begin\{[a-zA-Z0-9*]+\}[\s\S]*?\\end\{[a-zA-Z0-9*]+\})/gi;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = MASTER_BLOCK_REGEX.exec(text)) !== null) {
    if (match.index === MASTER_BLOCK_REGEX.lastIndex) {
      MASTER_BLOCK_REGEX.lastIndex++;
    }

    // 1. Text BEFORE this block -> parse line-by-line Markdown
    const preText = text.substring(lastIndex, match.index);
    if (preText) {
      nodes.push(...parseLinesAndBlocks(preText, `pre-${lastIndex}`));
    }

    // 2. The block itself:
    if (match[1]) {
      // Fenced Code Block
      const codeMatch = match[1].match(/^```([a-zA-Z0-9_+#-]*)[ \t]*\n?([\s\S]*?)(?:```|$)/);
      const lang = codeMatch ? codeMatch[1].trim() || "code" : "code";
      const codeContent = codeMatch ? codeMatch[2].trim() : match[1].trim();
      nodes.push(<CodeBlock key={`code-${match.index}`} lang={lang} code={codeContent} />);
    } else if (match[2]) {
      // Display Math $$...$$
      const latex = match[2].slice(2, -2).trim();
      if (latex) {
        nodes.push(<BlockMath key={`math-${match.index}`} latex={latex} />);
      }
    } else if (match[3]) {
      // Bare LaTeX Environment \begin{aligned}...\end{aligned}
      const latex = match[3].trim();
      if (latex) {
        nodes.push(<BlockMath key={`math-${match.index}`} latex={latex} />);
      }
    }

    lastIndex = MASTER_BLOCK_REGEX.lastIndex;
    if (match.index + match[0].length === text.length) break;
  }

  // 3. Text AFTER the last block -> parse line-by-line Markdown
  const remainingText = text.substring(lastIndex);
  if (remainingText && lastIndex < text.length) {
    nodes.push(...parseLinesAndBlocks(remainingText, `post-${lastIndex}`));
  }

  return nodes.length > 0 ? nodes : [<span key="fallback">{raw}</span>];
}

// ─── Parse Line-by-Line Markdown ───────────────────────────────────────────────

function parseLinesAndBlocks(textBlock: string, keyPrefix: string): React.ReactNode[] {
  const lines = textBlock.split("\n");
  const nodes: React.ReactNode[] = [];

  let tableLines: string[] = [];
  let inTable = false;
  let tableAlign: ("left" | "center" | "right")[] = [];

  const flushTable = () => {
    if (tableLines.length > 0) {
      nodes.push(<Table key={`table-${keyPrefix}-${nodes.length}`} rows={tableLines} align={tableAlign} />);
      tableLines = [];
      tableAlign = [];
      inTable = false;
    }
  };

  lines.forEach((line, lineIdx) => {
    const key = `${keyPrefix}-${lineIdx}`;

    // Blank line
    if (line.trim() === "") {
      flushTable();
      if (lineIdx > 0 && lineIdx < lines.length - 1) {
        nodes.push(<div key={`space-${key}`} style={{ height: "0.4em" }} />);
      }
      return;
    }

    // Horizontal rule: --- or ***
    if (/^[-*]{3,}\s*$/.test(line.trim())) {
      flushTable();
      nodes.push(<hr key={key} style={{ border: "none", borderTop: "1px solid #E2D9C2", margin: "0.8em 0" }} />);
      return;
    }

    // Headers
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) {
      flushTable();
      nodes.push(
        <h2 key={key} style={{ fontWeight: 800, fontSize: "1.25em", marginTop: "0.8em", marginBottom: "0.3em", color: "inherit" }}>
          {renderInline(h1Match[1])}
        </h2>
      );
      return;
    }
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      flushTable();
      nodes.push(
        <h3 key={key} style={{ fontWeight: 700, fontSize: "1.12em", marginTop: "0.7em", marginBottom: "0.25em", color: "inherit" }}>
          {renderInline(h2Match[1])}
        </h3>
      );
      return;
    }
    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match) {
      flushTable();
      nodes.push(
        <h4 key={key} style={{ fontWeight: 700, fontSize: "1.02em", marginTop: "0.5em", marginBottom: "0.2em", color: "inherit" }}>
          {renderInline(h3Match[1])}
        </h4>
      );
      return;
    }

    // Blockquote: > text
    const blockquoteMatch = line.match(/^>\s*(.+)$/);
    if (blockquoteMatch) {
      flushTable();
      nodes.push(
        <blockquote
          key={key}
          style={{
            margin: "0.4em 0",
            padding: "0.4em 0.8em",
            borderLeft: "1px solid #C4B88A",
            backgroundColor: "rgba(0,0,0,0.02)",
            borderRadius: "0 4px 4px 0",
            fontStyle: "italic",
          }}
        >
          {renderInline(blockquoteMatch[1])}
        </blockquote>
      );
      return;
    }

    // Numbered list: 1. ...
    const numMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (numMatch) {
      flushTable();
      nodes.push(
        <div key={key} style={{ display: "flex", gap: "0.4em", marginTop: "0.25em", alignItems: "flex-start" }}>
          <span style={{ fontWeight: 700, minWidth: "1.4em", opacity: 0.85 }}>{numMatch[1]}.</span>
          <div style={{ flex: 1 }}>{renderInline(numMatch[2])}</div>
        </div>
      );
      return;
    }

    // Bullet list: - ... or • ... or * ...
    const bulletMatch = line.match(/^[-•*]\s+(.+)$/);
    if (bulletMatch) {
      flushTable();
      nodes.push(
        <div key={key} style={{ display: "flex", gap: "0.4em", marginTop: "0.25em", alignItems: "flex-start" }}>
          <span style={{ opacity: 0.7, minWidth: "1em" }}>•</span>
          <div style={{ flex: 1 }}>{renderInline(bulletMatch[1])}</div>
        </div>
      );
      return;
    }

    // Table detection: | col1 | col2 |
    const tableMatch = line.match(/^\s*\|(.+)\|\s*$/);
    if (tableMatch) {
      if (!inTable) {
        inTable = true;
        tableLines = [];
        tableAlign = [];
      }
      const cells = tableMatch[1].split("|").map(c => c.trim());
      tableLines.push(cells.join("|"));

      if (/^[\s|:-]+\s*$/.test(line)) {
        tableAlign = cells.map(c => {
          if (c.startsWith(":") && c.endsWith(":")) return "center";
          if (c.endsWith(":")) return "right";
          return "left";
        });
      }
      return;
    }

    if (inTable && !tableMatch) {
      flushTable();
    }

    // Normal paragraph line
    nodes.push(
      <div key={key} style={{ marginTop: lineIdx === 0 ? 0 : "0.15em" }}>
        {renderInline(line)}
      </div>
    );
  });

  flushTable();
  return nodes;
}

// ─── Inline Token Parser (Math, Code, Bold, Links) ─────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  // Tokens:
  // 1. Inline Math: $...$
  // 2. Inline Code: `...`
  // 3. Bold: **...**
  // 4. Links: [text](url)
  const TOKEN_REGEX = /(\$[^$\n]+?\$|`[^`\n]+?`|\*\*[^*]+?\*\*|\[[^\]]+\]\([^)]+\))/g;

  const parts = text.split(TOKEN_REGEX);
  return parts.map((part, i) => {
    if (!part) return null;

    // Inline math: $...$
    if (part.startsWith("$") && part.endsWith("$") && part.length > 2) {
      return <InlineMath key={i} latex={part.slice(1, -1).trim()} />;
    }
    // Inline code: `...`
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <InlineCode key={i} code={part.slice(1, -1)} />;
    }
    // Bold: **...**
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} style={{ fontWeight: 700 }}>{part.slice(2, -2)}</strong>;
    }
    // Links: [text](url)
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a key={i} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" style={{ color: "#2E7D32", textDecoration: "underline" }}>
          {linkMatch[1]}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ─── Table Component ────────────────────────────────────────────────────────────

function Table({ rows, align }: { rows: string[]; align: ("left" | "center" | "right")[] }) {
  if (rows.length === 0) return null;

  const parsedRows = rows.map(r => r.split("|").map(c => c.trim()));
  const hasHeader = parsedRows.length > 1;

  return (
    <div style={{ overflowX: "auto", margin: "0.6em 0" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9em" }}>
        <thead>
          {hasHeader && (
            <tr style={{ backgroundColor: "#F3E6C8", color: "#6E4F1F" }}>
              {parsedRows[0].map((cell, ci) => (
                <th
                  key={ci}
                  style={{
                    padding: "0.5em 0.7em",
                    textAlign: align[ci] || "left",
                    border: "1px solid #E2D9C2",
                    fontWeight: 700,
                  }}
                >
                  {renderInline(cell)}
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {parsedRows.slice(hasHeader ? 1 : 0).map((row, ri) => (
            <tr key={ri} style={{ backgroundColor: ri % 2 === 0 ? "rgba(0,0,0,0.02)" : "transparent" }}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    padding: "0.4em 0.7em",
                    textAlign: align[ci] || "left",
                    border: "1px solid #E2D9C2",
                  }}
                >
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Code Block Component with Dark Theme & Copy Button ──────────────────────────

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      style={{
        margin: "0.6em 0",
        borderRadius: "10px",
        overflow: "hidden",
        backgroundColor: "#181825",
        color: "#CDD6F4",
        boxShadow: "0 3px 12px rgba(0,0,0,0.12)",
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
        fontSize: "0.85em",
        border: "1px solid #313244",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0.35em 0.8em",
          backgroundColor: "#11111B",
          borderBottom: "1px solid #313244",
          fontSize: "0.8em",
          color: "#A6ADC8",
        }}
      >
        <span style={{ fontWeight: 600, textTransform: "lowercase" }}>{lang || "code"}</span>
        <button
          onClick={handleCopy}
          style={{
            background: "none",
            border: "1px solid #45475A",
            borderRadius: "5px",
            color: copied ? "#A6E3A1" : "#BAC2DE",
            padding: "0.15em 0.5em",
            fontSize: "0.8em",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "0.3em",
            transition: "all 0.2s",
          }}
        >
          {copied ? "✓ Copied" : "📋 Copy"}
        </button>
      </div>

      {/* Code body */}
      <pre
        style={{
          margin: 0,
          padding: "0.8em 1em",
          overflowX: "auto",
          lineHeight: 1.5,
          fontFamily: "inherit",
          whiteSpace: "pre",
          tabSize: 2,
        }}
      >
        <code>{highlightSyntax(code, lang)}</code>
      </pre>
    </div>
  );
}

// Lightweight syntax highlighter
function highlightSyntax(code: string, lang: string): React.ReactNode[] {
  const lines = code.split("\n");
  const keywordsByLang: Record<string, string[]> = {
    cpp: ["include", "using", "namespace", "int", "double", "float", "char", "string", "bool", "void", "class", "struct", "if", "else", "for", "while", "return", "cout", "cin", "endl", "std", "true", "false", "auto", "const", "nullptr"],
    c: ["include", "int", "double", "float", "char", "bool", "void", "struct", "if", "else", "for", "while", "return", "printf", "scanf", "true", "false", "const", "NULL"],
    python: ["def", "import", "from", "print", "in", "range", "if", "else", "elif", "for", "while", "return", "class", "try", "except", "finally", "with", "as", "lambda", "yield", "True", "False", "None", "self"],
    javascript: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "class", "import", "export", "from", "async", "await", "try", "catch", "true", "false", "null", "undefined", "this", "new"],
    typescript: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "class", "import", "export", "from", "async", "await", "try", "catch", "true", "false", "null", "undefined", "interface", "type", "enum"],
    java: ["public", "private", "protected", "class", "interface", "extends", "implements", "static", "final", "void", "int", "double", "boolean", "String", "if", "else", "for", "while", "return", "new", "this", "true", "false", "null"],
    go: ["func", "package", "import", "var", "const", "if", "else", "for", "range", "return", "struct", "interface", "true", "false", "nil", "defer"],
    rust: ["fn", "let", "mut", "const", "struct", "enum", "impl", "trait", "pub", "use", "mod", "if", "else", "for", "while", "return", "match", "true", "false"],
    sql: ["SELECT", "FROM", "WHERE", "INSERT", "UPDATE", "DELETE", "JOIN", "INNER", "LEFT", "RIGHT", "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "OFFSET", "CREATE", "TABLE", "INDEX", "PRIMARY", "KEY", "FOREIGN", "REFERENCES"],
  };

  const keywords = keywordsByLang[lang.toLowerCase()] || [];
  const keywordSet = new Set(keywords.map(k => k.toLowerCase()));

  return lines.map((line, idx) => {
    if (line.trim().startsWith("//") || line.trim().startsWith("# ")) {
      return (
        <span key={idx} style={{ color: "#6C7086", fontStyle: "italic" }}>
          {line}
          {idx < lines.length - 1 ? "\n" : ""}
        </span>
      );
    }

    return (
      <span key={idx}>
        {colorLineKeywords(line, keywordSet)}
        {idx < lines.length - 1 ? "\n" : ""}
      </span>
    );
  });
}

function colorLineKeywords(line: string, keywordSet: Set<string>): React.ReactNode[] {
  const TOKEN_REGEX = /(\b\w+\b|"[^"]*"|'[^']*'|\/\/.*$|\/\*[\s\S]*?\*\/|\b\d+\.?\d*\b)/g;

  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_REGEX.exec(line)) !== null) {
    if (match.index > lastIdx) {
      parts.push(line.substring(lastIdx, match.index));
    }

    const matchedStr = match[0];
    if (matchedStr.startsWith("//") || matchedStr.startsWith("/*")) {
      parts.push(<span key={match.index} style={{ color: "#6C7086", fontStyle: "italic" }}>{matchedStr}</span>);
    } else if (matchedStr.startsWith('"') || matchedStr.startsWith("'")) {
      parts.push(<span key={match.index} style={{ color: "#A6E3A1" }}>{matchedStr}</span>);
    } else if (/^\d+\.?\d*$/.test(matchedStr)) {
      parts.push(<span key={match.index} style={{ color: "#FAB387" }}>{matchedStr}</span>);
    } else if (keywordSet.has(matchedStr.toLowerCase())) {
      parts.push(<span key={match.index} style={{ color: "#F38BA8", fontWeight: 600 }}>{matchedStr}</span>);
    } else {
      parts.push(matchedStr);
    }

    lastIdx = TOKEN_REGEX.lastIndex;
  }

  if (lastIdx < line.length) {
    parts.push(line.substring(lastIdx));
  }

  return parts;
}

// ─── Inline Code Badge ──────────────────────────────────────────────────────────

function InlineCode({ code }: { code: string }) {
  return (
    <code
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.06)",
        color: "#C41E3A",
        padding: "0.12em 0.35em",
        borderRadius: "4px",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: "0.88em",
        border: "1px solid rgba(0, 0, 0, 0.08)",
      }}
    >
      {code}
    </code>
  );
}

// ─── KaTeX Components ──────────────────────────────────────────────────────────

function renderKatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      displayMode,
      trust: false,
      strict: false,
      output: "html",
    });
  } catch {
    return `<span style="color: #C41E3A; font-family: monospace;">${escapeHtml(latex)}</span>`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function InlineMath({ latex }: { latex: string }) {
  const html = renderKatex(latex, false);
  return (
    <span
      dangerouslySetInnerHTML={{ __html: html }}
      style={{ display: "inline", fontSize: "1em" }}
    />
  );
}

function BlockMath({ latex }: { latex: string }) {
  const html = renderKatex(latex, true);
  return (
    <div
      dangerouslySetInnerHTML={{ __html: html }}
      style={{
        display: "block",
        overflowX: "auto",
        margin: "0.6em 0",
        textAlign: "center",
        fontSize: "1.05em",
      }}
    />
  );
}