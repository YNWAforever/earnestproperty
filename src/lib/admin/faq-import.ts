export type ParsedFaqImportRow = {
  scope: string | null;
  question: string;
  answer: string;
};

export function parseAdminFaqImport(text: string, fallbackScope = "general"): ParsedFaqImportRow[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const explicitRows = parseQuestionAnswerBlocks(normalized, fallbackScope);
  if (explicitRows.length) return explicitRows;

  const headingRows = parseMarkdownHeadings(normalized, fallbackScope);
  if (headingRows.length) return headingRows;

  return parseDelimitedRows(normalized, fallbackScope);
}

function parseQuestionAnswerBlocks(text: string, fallbackScope: string) {
  const rows: ParsedFaqImportRow[] = [];
  let scope = fallbackScope.trim() || "general";
  let question: string | null = null;
  let answerLines: string[] = [];

  function flush() {
    const answer = answerLines.join("\n").trim();
    if (question && answer) {
      rows.push({ scope, question: question.trim(), answer });
    }
    question = null;
    answerLines = [];
  }

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const scopeMatch = line.match(/^(?:scope|分組|分類)\s*[:：]\s*(.+)$/i);
    const questionMatch = line.match(/^(?:q|question|問題|問)\s*[:：]\s*(.+)$/i);
    const answerMatch = line.match(/^(?:a|answer|答案|答)\s*[:：]\s*(.+)$/i);

    if (scopeMatch) {
      // Flush before switching: the pending question belongs to the scope that
      // was in effect when it was read, not the one being declared here.
      flush();
      scope = scopeMatch[1]?.trim() || scope;
      continue;
    }
    if (questionMatch) {
      flush();
      question = questionMatch[1]?.trim() || "";
      continue;
    }
    if (answerMatch) {
      answerLines = [answerMatch[1]?.trim() || ""];
      continue;
    }
    if (question && line) {
      answerLines.push(rawLine);
    }
  }

  flush();
  return rows;
}

function parseMarkdownHeadings(text: string, fallbackScope: string) {
  const rows: ParsedFaqImportRow[] = [];
  const sections = text.split(/\n(?=#{1,4}\s+)/g);

  for (const section of sections) {
    const lines = section.trim().split("\n");
    const heading = lines[0]?.replace(/^#{1,4}\s+/, "").trim();
    const answer = lines.slice(1).join("\n").trim();
    if (heading && answer && lines[0]?.startsWith("#")) {
      rows.push({ scope: fallbackScope.trim() || "general", question: heading, answer });
    }
  }

  return rows;
}

function parseDelimitedRows(text: string, fallbackScope: string) {
  const rows: ParsedFaqImportRow[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || /^scope\s*,\s*question\s*,\s*answer/i.test(line)) continue;
    const parts = splitDelimitedLine(line);
    if (parts.length >= 3) {
      rows.push({
        scope: parts[0]?.trim() || fallbackScope.trim() || "general",
        question: parts[1]?.trim() || "",
        answer: parts.slice(2).join(",").trim(),
      });
    } else if (parts.length === 2) {
      rows.push({
        scope: fallbackScope.trim() || "general",
        question: parts[0]?.trim() || "",
        answer: parts[1]?.trim() || "",
      });
    }
  }

  return rows.filter((row) => row.question && row.answer);
}

function splitDelimitedLine(line: string) {
  return line.includes("\t") ? line.split("\t") : line.split(",");
}
