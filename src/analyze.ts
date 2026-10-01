import Papa from "papaparse";

/** Files larger than this are rejected before any parsing happens. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

export type Severity = "error" | "warning" | "info";

export type LineEnding = "lf" | "crlf" | "cr" | "mixed" | "none";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  details: string[];
}

/** A record whose field count differs from the first non-blank record. */
export interface RaggedRow {
  /** 1-based position among parsed CSV records. */
  record: number;
  expected: number;
  actual: number;
}

export interface AnalysisStats {
  /** Size of the input in UTF-8 bytes. */
  byteSize: number;
  totalRecords: number;
  nonBlankRecords: number;
  blankLineCount: number;
  columnCount: number | null;
  delimiter: string;
  delimiterSource: "auto" | "manual";
  delimiterLabel: string;
  bomDetected: boolean;
  lineEndings: LineEnding;
  parseErrorCount: number;
}

export interface AnalysisResult {
  stats: AnalysisStats;
  findings: Finding[];
  ragged: RaggedRow[];
  records: string[][];
}

export interface AnalyzeOptions {
  /** Force a delimiter. Omit for auto-detection (which is always a guess). */
  delimiter?: string;
}

const DELIMITER_NAMES: Record<string, string> = {
  ",": "comma",
  ";": "semicolon",
  "\t": "tab",
  "|": "pipe",
};

const CANDIDATE_DELIMITERS = [",", ";", "\t", "|"];

const PARSE_ERROR_HINTS: Record<string, string> = {
  MissingQuotes:
    "A quoted field is never closed — look for a missing double quote (\"), usually on this record or the one before it.",
  InvalidQuotes:
    "A quote appears in the middle of a field. Wrap the field in quotes and escape inner quotes by doubling them (\"\").",
};

export function delimiterLabel(delimiter: string): string {
  return DELIMITER_NAMES[delimiter] ?? JSON.stringify(delimiter);
}

/** Returns a human-readable error when `bytes` exceeds the limit, else null. */
export function fileSizeError(bytes: number): string | null {
  if (bytes <= MAX_FILE_BYTES) return null;
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  return (
    `This file is ${mb} MB, and CSV Triage only reads files up to 5 MB because everything ` +
    "runs in your browser tab. Nothing was uploaded — try splitting the file first."
  );
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function detectLineEndings(text: string): LineEnding {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  const cr = (text.match(/\r/g) ?? []).length - crlf;
  const kinds: LineEnding[] = [];
  if (crlf > 0) kinds.push("crlf");
  if (lf > 0) kinds.push("lf");
  if (cr > 0) kinds.push("cr");
  if (kinds.length === 0) return "none";
  return kinds.length === 1 ? kinds[0] : "mixed";
}

function isBlankRecord(record: string[]): boolean {
  return record.length === 0 || (record.length === 1 && record[0] === "");
}

function bomFinding(): Finding {
  return {
    id: "bom",
    severity: "info",
    title: "UTF-8 BOM detected",
    details: [
      "The file starts with a byte order mark (EF BB BF). It is ignored while reading — the bytes on disk are not touched — but some importers include it in the first column name.",
    ],
  };
}

function buildRaggedFinding(ragged: RaggedRow[], columnCount: number): Finding {
  const shown = ragged.slice(0, 20);
  const details = shown.map(
    (row) =>
      `Record ${row.record}: ${row.actual} field${row.actual === 1 ? "" : "s"} (expected ${row.expected}).`,
  );
  if (ragged.length > shown.length) {
    const remaining = ragged.length - shown.length;
    details.push(`…and ${remaining} more record${remaining === 1 ? "" : "s"} with a different field count.`);
  }
  details.unshift(
    `The first row defines ${columnCount} column${columnCount === 1 ? "" : "s"}; these records don't match — the most common reason CSV imports fail.`,
  );
  return {
    id: "ragged",
    severity: "error",
    title: `Ragged rows: ${ragged.length} record${ragged.length === 1 ? "" : "s"} with a different number of fields`,
    details,
  };
}

/**
 * Diagnose a CSV text. Pure: no DOM, no network, and the input is never modified.
 *
 * Record numbers in the result are *parsed record* numbers (1-based), not
 * editor line numbers — a newline inside a quoted field shifts the numbering.
 */
export function analyzeCsv(input: string, options: AnalyzeOptions = {}): AnalysisResult {
  const manualDelimiter =
    options.delimiter && options.delimiter.length > 0 ? options.delimiter : undefined;
  const bomDetected = input.charCodeAt(0) === 0xfeff;
  const text = bomDetected ? input.slice(1) : input;
  const byteSize = utf8ByteLength(input);
  const lineEndings = detectLineEndings(text);

  if (text.trim() === "") {
    const findings: Finding[] = [];
    if (bomDetected) findings.push(bomFinding());
    findings.push({
      id: "empty",
      severity: "warning",
      title: "The file is empty",
      details: [
        "There is nothing to triage. If you expected data, the file or paste may have been empty.",
      ],
    });
    return {
      stats: {
        byteSize,
        totalRecords: 0,
        nonBlankRecords: 0,
        blankLineCount: 0,
        columnCount: null,
        delimiter: manualDelimiter ?? ",",
        delimiterSource: manualDelimiter ? "manual" : "auto",
        delimiterLabel: delimiterLabel(manualDelimiter ?? ","),
        bomDetected,
        lineEndings,
        parseErrorCount: 0,
      },
      findings,
      ragged: [],
      records: [],
    };
  }

  // Delimiter handling: let Papa Parse auto-detect, but on a pass that ignores
  // blank rows — otherwise a trailing newline (or an empty line) drags the
  // guesser's average field count down and detection fails for ordinary
  // comma/semicolon/tab/pipe files. Detection is still only a guess, and the
  // UI always offers a manual override.
  let delimiter = manualDelimiter ?? "";
  if (delimiter === "") {
    const detection = Papa.parse<string[]>(text, { skipEmptyLines: true, preview: 10 });
    delimiter = detection.meta.delimiter || ",";
  }

  const parsed = Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: false,
    header: false,
    dynamicTyping: false,
  });

  const records = parsed.data.slice();
  // A file that ends with a line terminator parses to a final empty record;
  // that is the normal end of the file, not a blank line.
  if (text.endsWith("\n") || text.endsWith("\r")) {
    const last = records[records.length - 1];
    if (last && isBlankRecord(last)) records.pop();
  }
  const firstNonBlank = records.findIndex((record) => !isBlankRecord(record));
  const columnCount = firstNonBlank === -1 ? null : records[firstNonBlank].length;
  const blankLineCount = records.filter(isBlankRecord).length;

  const ragged: RaggedRow[] = [];
  if (columnCount !== null) {
    records.forEach((record, index) => {
      if (index === firstNonBlank || isBlankRecord(record)) return;
      if (record.length !== columnCount) {
        ragged.push({ record: index + 1, expected: columnCount, actual: record.length });
      }
    });
  }

  const findings: Finding[] = [];
  if (bomDetected) findings.push(bomFinding());

  if (columnCount === 1) {
    const firstLine = text.split(/\r\n|\r|\n/, 1)[0] ?? "";
    const alternatives = CANDIDATE_DELIMITERS.filter(
      (candidate) => candidate !== delimiter && firstLine.includes(candidate),
    );
    if (alternatives.length > 0) {
      const names = alternatives.map((candidate) => `a ${delimiterLabel(candidate)}`).join(" or ");
      findings.push({
        id: "delimiter-guess",
        severity: "warning",
        title: "Only one column detected — the delimiter guess looks wrong",
        details: [
          `The first line contains ${names}, but the records were read as a single column.`,
          `If ${names} is the real delimiter, choose it from the delimiter menu and the analysis will re-run.`,
        ],
      });
    }
  }

  const parseErrors = parsed.errors.filter((error) => error.code !== "UndetectableDelimiter");
  if (parseErrors.length > 0) {
    const details = parseErrors.slice(0, 20).map((error) => {
      const where = typeof error.row === "number" ? `Record ${error.row + 1}: ` : "";
      const hint = PARSE_ERROR_HINTS[error.code];
      return `${where}${error.message}${hint ? ` — ${hint}` : ""}`;
    });
    if (parseErrors.length > 20) {
      details.push(`…and ${parseErrors.length - 20} more parser errors.`);
    }
    findings.push({
      id: "parse-errors",
      severity: "error",
      title: `Parser errors: ${parseErrors.length}`,
      details,
    });
  }

  if (ragged.length > 0 && columnCount !== null) {
    findings.push(buildRaggedFinding(ragged, columnCount));
  }

  const headerRecord = firstNonBlank === -1 ? null : records[firstNonBlank];
  if (headerRecord) {
    const groups = new Map<string, number[]>();
    headerRecord.forEach((name, index) => {
      const key = name.trim().toLowerCase();
      if (key === "") return;
      const existing = groups.get(key);
      if (existing) existing.push(index);
      else groups.set(key, [index]);
    });
    const duplicates = [...groups.values()].filter((indexes) => indexes.length > 1);
    if (duplicates.length > 0) {
      findings.push({
        id: "duplicate-headers",
        severity: "warning",
        title: `Duplicate headers: ${duplicates.length} group${duplicates.length === 1 ? "" : "s"}`,
        details: duplicates.map((indexes) => {
          const columns = indexes.map((index) => index + 1);
          const names = indexes.map((index) => `"${headerRecord[index]}"`).join(" / ");
          return `Columns ${columns.join(", ")} share the header ${names} (compared case-insensitively).`;
        }),
      });
    }

    const emptyColumns = headerRecord
      .map((name, index) => ({ name, index }))
      .filter(({ name }) => name.trim() === "")
      .map(({ index }) => index + 1);
    if (emptyColumns.length > 0) {
      const plural = emptyColumns.length === 1 ? "" : "s";
      findings.push({
        id: "empty-headers",
        severity: "warning",
        title: `Empty headers: ${emptyColumns.length} column${plural} with no name`,
        details: [
          `Column${plural} ${emptyColumns.join(", ")} ${emptyColumns.length === 1 ? "has" : "have"} no header name.`,
          'This usually means the header row ends with an extra delimiter — a trailing "phantom" column that most importers reject.',
        ],
      });
    }
  }

  if (blankLineCount > 0) {
    findings.push({
      id: "blank-lines",
      severity: "info",
      title: `Blank lines: ${blankLineCount}`,
      details: [
        "Blank lines are counted here, not reported as ragged rows.",
        "Some importers skip blank lines; others stop at the first one.",
      ],
    });
  }

  if (lineEndings === "mixed") {
    findings.push({
      id: "mixed-line-endings",
      severity: "info",
      title: "Mixed line endings",
      details: [
        "The file contains both Windows-style (CRLF) and Unix-style (LF) line endings.",
        "Most tools cope, but some strict importers reject mixed endings.",
      ],
    });
  }

  if (text.includes("\uFFFD")) {
    findings.push({
      id: "replacement-characters",
      severity: "info",
      title: "Characters that are not valid UTF-8",
      details: [
        'The text contains "\uFFFD" replacement characters. CSV Triage reads UTF-8 only — if this file uses another encoding, not all bytes could be read.',
      ],
    });
  }

  const stats: AnalysisStats = {
    byteSize,
    totalRecords: records.length,
    nonBlankRecords: records.length - blankLineCount,
    blankLineCount,
    columnCount,
    delimiter,
    delimiterSource: manualDelimiter ? "manual" : "auto",
    delimiterLabel: delimiterLabel(delimiter),
    bomDetected,
    lineEndings,
    parseErrorCount: parseErrors.length,
  };

  return { stats, findings, ragged, records };
}
