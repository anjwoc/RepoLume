const COMPLETION_CHATTER =
  String.raw`(?:No further actions required\.?|I have generated[^\n]*(?:wiki page|markdown file)[^\n]*(?:I am now done with the task\.?)?|I am now done with the task\.?|I believe the task is complete\.?)`;

function stripCompletionChatter(text: string): string {
  let next = text.trim();
  let previous = "";

  while (next !== previous) {
    previous = next;
    next = next
      .replace(new RegExp(String.raw`\n{2,}` + String.raw`\`\`\s*(?:text|markdown|md)?\s*\n\s*` + COMPLETION_CHATTER + String.raw`\s*\n\`\`\`\s*$`, "i"), "")
      .replace(new RegExp(String.raw`\n{2,}` + String.raw`\`\`\s*` + COMPLETION_CHATTER + String.raw`\s*\n?\`\`\`\s*$`, "i"), "")
      .replace(new RegExp(String.raw`\n{2,}` + COMPLETION_CHATTER + String.raw`\s*$`, "i"), "")
      .trim();
  }

  return next;
}

function stripTrailingEmptyCodeFence(text: string): string {
  let next = text.trim();
  let previous = "";

  while (next !== previous) {
    previous = next;
    next = next
      .replace(/\n{2,}```(?:text|markdown|md)?\s*\n\s*```\s*$/i, "")
      .replace(/\n{2,}```(?:text|markdown|md)?\s*$/i, "")
      .trim();
  }

  return next;
}

// Korean/CJK character range for the bold-delimiter fix below.
// Covers Hangul syllables (AC00-D7A3), Hangul Jamo (1100-11FF),
// Hangul Compatibility Jamo (3130-318F), CJK Unified Ideographs (4E00-9FFF),
// CJK Extension A (3400-4DBF), Hiragana (3040-309F), Katakana (30A0-30FF).
const CJK_CHAR = /[가-힣ᄀ-ᇿ㄰-㆏一-鿿㐀-䶿぀-ヿ]/;

export function normalizeMarkdownContent(content: string): string {
  let text = (content || "").replace(/\r\n/g, "\n").trim();
  if (!text) return text;

  const executeTagIndex = text.search(/<execute_(?:bash|command)>/i);
  if (executeTagIndex > 0) {
    text = text.slice(0, executeTagIndex).trim();
  }

  const firstMarkdownMarker = [
    text.search(/```(?:markdown|md)?\s*\n/i),
    text.search(/^#{1,6}\s+/m),
  ].filter((index) => index >= 0).sort((a, b) => a - b)[0];

  if (firstMarkdownMarker > 0) {
    const preamble = text.slice(0, firstMarkdownMarker);
    if (/\b(generate|generated|wiki page|following your instructions)\b/i.test(preamble)) {
      text = text.slice(firstMarkdownMarker).trim();
    }
  }

  let lines = text.split("\n");
  const openingFence = lines[0]?.match(/^```(?:markdown|md)?\s*$/i);
  if (openingFence && /^#{1,6}\s+/.test(lines[1] || "")) {
    lines = lines.slice(1);
    const fenceCount = lines.filter((line) => /^```/.test(line.trim())).length;
    if (fenceCount % 2 === 1 && /^```\s*$/.test(lines[lines.length - 1]?.trim() || "")) {
      lines = lines.slice(0, -1);
    }
    text = lines.join("\n").trim();
  }

  lines = text.split("\n");
  const firstHeading = lines.find((line) => /^#{1,6}\s+/.test(line));
  const firstHeadingText = firstHeading?.replace(/^#{1,6}\s+/, "").trim().toLowerCase();
  const duplicateFenceIndex = lines.findIndex((line, index) => {
    if (index === 0 || !/^```(?:markdown|md)?\s*$/i.test(line.trim())) return false;
    const nextHeading = lines[index + 1]?.replace(/^#{1,6}\s+/, "").trim().toLowerCase();
    return Boolean(firstHeadingText && nextHeading && firstHeadingText === nextHeading);
  });
  if (duplicateFenceIndex > 0) {
    text = lines.slice(0, duplicateFenceIndex).join("\n").trim();
  }

  lines = text.split("\n");
  const completionLineIndex = lines.findIndex((line, index) => {
    if (index === 0) return false;
    return /\bI have generated\b/i.test(line)
      || /\bI am now done with the task\b/i.test(line)
      || /\bI believe the task is complete\b/i.test(line)
      || /\bNo further actions required\b/i.test(line);
  });
  if (completionLineIndex > 0) {
    let cutIndex = completionLineIndex;
    let openFenceIndex = -1;
    for (let i = 0; i < completionLineIndex; i++) {
      if (/^```/.test(lines[i].trim())) {
        openFenceIndex = openFenceIndex >= 0 ? -1 : i;
      }
    }
    if (openFenceIndex >= 0) {
      cutIndex = openFenceIndex;
    }
    text = lines.slice(0, cutIndex).join("\n").trim();
  }

  let finalContent = stripTrailingEmptyCodeFence(stripCompletionChatter(text));

  // Fix CommonMark right-flanking rule: the closing ** is not recognised as a
  // strong-emphasis delimiter when immediately followed by a Korean/CJK letter
  // (a Unicode letter, not whitespace or punctuation).  Insert a zero-width
  // space (​) so the parser sees a non-letter boundary without affecting
  // visible layout.
  finalContent = finalContent.replace(
    new RegExp(`(\\*{1,2}[^*\\n]+\\*{1,2})(${CJK_CHAR.source})`, 'g'),
    '$1​$2'
  );

  // Escape unrecognized HTML tags to prevent React render crashes.
  // Allowed tags remain intact; anything else becomes &lt;tag&gt;
  const escapeUnknownTags = (segment: string): string =>
    segment.replace(/<(\/?)([A-Za-z0-9_-]+)([^>]*)>/g, (match, slash, tag, rest) => {
      const allowedTags = new Set([
        'div', 'span', 'p', 'a', 'b', 'i', 'u', 'strong', 'em', 'br', 'hr',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
        'table', 'thead', 'tbody', 'tr', 'th', 'td', 'pre', 'code', 'img',
        'svg', 'path', 'g', 'video', 'audio', 'source', 'iframe', 'blockquote',
        'sup', 'sub', 'del', 'kbd', 'details', 'summary'
      ]);
      if (allowedTags.has(tag.toLowerCase())) {
        return match;
      }
      return `&lt;${slash}${tag}${rest}&gt;`;
    });

  // Only escape tags OUTSIDE fenced code blocks. Code fences (``` ... ```),
  // including mermaid, render as literal code — escaping their content would
  // corrupt the diagram (e.g. the mermaid arrow `<-->` → `&lt;--&gt;`) and
  // break the diagram-fix match against the stored source. split() with a
  // capturing group keeps the fenced blocks as their own segments.
  finalContent = finalContent
    .split(/(```[\s\S]*?```)/g)
    .map((segment) => (segment.startsWith('```') ? segment : escapeUnknownTags(segment)))
    .join('');

  return finalContent;
}
