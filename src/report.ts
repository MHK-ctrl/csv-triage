import type { AnalysisResult, Finding } from "./analyze";

export interface ReportMeta {
  fileName: string;
  /** Human-readable timestamp shown in the report header. */
  generatedAt: string;
  /** Public repo URL, linked in the footer. */
  repoUrl?: string;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function findingSection(heading: string, findings: Finding[]): string[] {
  if (findings.length === 0) return [];
  const lines = [`## ${heading}`, ""];
  for (const finding of findings) {
    lines.push(`### ${finding.title}`, "");
    for (const detail of finding.details) {
      lines.push(`- ${detail}`);
    }
    lines.push("");
  }
  return lines;
}

/** Render an analysis as a Markdown report suitable for pasting into an issue. */
export function buildMarkdownReport(result: AnalysisResult, meta: ReportMeta): string {
  const { stats, findings } = result;
  const errors = findings.filter((finding) => finding.severity === "error");
  const warnings = findings.filter((finding) => finding.severity === "warning");
  const notes = findings.filter((finding) => finding.severity === "info");
  const problemCount = errors.length + warnings.length;

  const lines: string[] = [
    "# CSV Triage report",
    "",
    `- **File:** ${meta.fileName}`,
    `- **Size:** ${formatBytes(stats.byteSize)}`,
    `- **Generated:** ${meta.generatedAt}`,
    `- **Delimiter:** ${stats.delimiterLabel} (${stats.delimiterSource === "manual" ? "chosen manually" : "auto-detected guess"})`,
    `- **Records:** ${stats.totalRecords}`,
    `- **Columns:** ${stats.columnCount ?? "unknown"}`,
  ];
  if (stats.blankLineCount > 0) {
    lines.push(`- **Blank lines:** ${stats.blankLineCount}`);
  }
  lines.push("");
  lines.push(
    problemCount === 0
      ? "**No import-blocking problems found.**"
      : `**${problemCount} problem${problemCount === 1 ? "" : "s"} found.**`,
  );
  lines.push("");
  lines.push(
    "> Record numbers are parsed CSV record numbers, not editor line numbers —",
    "> a newline inside a quoted field shifts the numbering.",
    "",
  );
  lines.push(...findingSection(`❌ Errors (${errors.length})`, errors));
  lines.push(...findingSection(`⚠️ Warnings (${warnings.length})`, warnings));
  lines.push(...findingSection(`ℹ️ Notes (${notes.length})`, notes));
  lines.push("---");
  lines.push(
    meta.repoUrl
      ? `Generated with [CSV Triage](${meta.repoUrl}) — everything ran in the browser; the file was never uploaded.`
      : "Generated with CSV Triage — everything ran in the browser; the file was never uploaded.",
  );
  return `${lines.join("\n")}\n`;
}
