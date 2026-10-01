import "./style.css";
import { analyzeCsv, fileSizeError, type AnalysisResult } from "./analyze";
import { buildMarkdownReport, formatBytes } from "./report";

const REPO_URL = "https://github.com/MHK-ctrl/csv-triage";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

const fileInput = el<HTMLInputElement>("file-input");
const dropZone = el<HTMLDivElement>("drop-zone");
const delimiterSelect = el<HTMLSelectElement>("delimiter-select");
const statusEl = el<HTMLParagraphElement>("status");
const summaryEl = el<HTMLElement>("summary");
const findingsEl = el<HTMLElement>("findings");
const reportActionsEl = el<HTMLElement>("report-actions");
const copyButton = el<HTMLButtonElement>("copy-report");
const downloadButton = el<HTMLButtonElement>("download-report");

interface Source {
  text: string;
  fileName: string;
}

interface Analysis {
  result: AnalysisResult;
  generatedAt: string;
}

let source: Source | null = null;
let analysis: Analysis | null = null;

function setStatus(message: string, kind: "" | "ok" | "error" = ""): void {
  statusEl.textContent = message;
  statusEl.className = kind === "" ? "status" : `status status-${kind}`;
}

function resetResults(): void {
  summaryEl.replaceChildren();
  summaryEl.hidden = true;
  findingsEl.replaceChildren();
  findingsEl.hidden = true;
  reportActionsEl.hidden = true;
  analysis = null;
}

function showLoadError(message: string): void {
  source = null;
  resetResults();
  setStatus(message, "error");
}

function decodeUtf8(buffer: ArrayBuffer): string {
  // ignoreBOM keeps a leading U+FEFF in the string so the analysis can report it.
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(buffer);
}

async function loadFile(file: File): Promise<void> {
  const sizeError = fileSizeError(file.size);
  if (sizeError) {
    showLoadError(sizeError);
    return;
  }
  const buffer = await file.arrayBuffer();
  source = { text: decodeUtf8(buffer), fileName: file.name };
  analyzeSource();
}

function analyzeSource(): void {
  if (!source) return;
  const manual = delimiterSelect.value === "" ? undefined : delimiterSelect.value;
  const result = analyzeCsv(source.text, { delimiter: manual });
  analysis = { result, generatedAt: new Date().toISOString() };
  render();
}

function chip(label: string, value: string): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "chip";
  const labelEl = document.createElement("span");
  labelEl.className = "chip-label";
  labelEl.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.className = "chip-value";
  valueEl.textContent = value;
  wrapper.append(labelEl, valueEl);
  return wrapper;
}

const LINE_ENDING_NAMES = {
  lf: "LF (Unix)",
  crlf: "CRLF (Windows)",
  cr: "CR (old Mac)",
  mixed: "mixed",
  none: "none",
} as const;

function renderSummary(result: AnalysisResult): void {
  const stats = result.stats;
  const chips = [
    chip("Records", String(stats.totalRecords)),
    chip("Columns", stats.columnCount === null ? "unknown" : String(stats.columnCount)),
    chip("Delimiter", `${stats.delimiterLabel} (${stats.delimiterSource === "auto" ? "guess" : "manual"})`),
    chip("Size", formatBytes(stats.byteSize)),
  ];
  if (stats.blankLineCount > 0) {
    chips.push(chip("Blank lines", String(stats.blankLineCount)));
  }
  if (stats.lineEndings !== "none") {
    chips.push(chip("Line endings", LINE_ENDING_NAMES[stats.lineEndings]));
  }
  if (stats.bomDetected) {
    chips.push(chip("BOM", "present"));
  }
  summaryEl.replaceChildren(...chips);
  summaryEl.hidden = false;
}

const SEVERITY_NAMES = { error: "Error", warning: "Warning", info: "Note" } as const;

function renderFindings(result: AnalysisResult): void {
  findingsEl.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = "Findings";
  findingsEl.append(heading);

  if (result.findings.length === 0) {
    const allClear = document.createElement("p");
    allClear.className = "all-clear";
    allClear.textContent = "Nothing looks wrong with this file.";
    findingsEl.append(allClear);
  } else {
    for (const finding of result.findings) {
      const article = document.createElement("article");
      article.className = `finding severity-${finding.severity}`;
      const title = document.createElement("h3");
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = SEVERITY_NAMES[finding.severity];
      title.append(badge, finding.title);
      article.append(title);
      const list = document.createElement("ul");
      for (const detail of finding.details) {
        const item = document.createElement("li");
        item.textContent = detail;
        list.append(item);
      }
      article.append(list);
      findingsEl.append(article);
    }
  }
  findingsEl.hidden = false;
}

function render(): void {
  if (!analysis || !source) return;
  const problems = analysis.result.findings.filter((finding) => finding.severity !== "info").length;
  if (problems === 0) {
    setStatus(`No import-blocking problems found in "${source.fileName}".`, "ok");
  } else {
    setStatus(
      `${problems} problem${problems === 1 ? "" : "s"} found in "${source.fileName}" — details below.`,
      "error",
    );
  }
  renderSummary(analysis.result);
  renderFindings(analysis.result);
  reportActionsEl.hidden = false;
}

function currentMarkdown(): string | null {
  if (!analysis || !source) return null;
  return buildMarkdownReport(analysis.result, {
    fileName: source.fileName,
    generatedAt: analysis.generatedAt,
    repoUrl: REPO_URL,
  });
}

copyButton.addEventListener("click", () => {
  const markdown = currentMarkdown();
  if (markdown === null) return;
  navigator.clipboard.writeText(markdown).then(
    () => {
      copyButton.textContent = "Copied ✓";
      window.setTimeout(() => {
        copyButton.textContent = "Copy report";
      }, 1500);
    },
    () => setStatus("Clipboard access was blocked — use \u201CDownload .md\u201D instead.", "error"),
  );
});

downloadButton.addEventListener("click", () => {
  const markdown = currentMarkdown();
  if (markdown === null) return;
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "csv-triage-report.md";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void loadFile(file);
});

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});
dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("is-dragging");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("is-dragging"));
dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  const file = event.dataTransfer?.files?.[0];
  if (file) void loadFile(file);
});

delimiterSelect.addEventListener("change", () => {
  if (source) analyzeSource();
});

window.addEventListener("paste", (event) => {
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) {
    return;
  }
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (text === "") return;
  event.preventDefault();
  const sizeError = fileSizeError(new TextEncoder().encode(text).length);
  if (sizeError) {
    showLoadError(sizeError);
    return;
  }
  source = { text, fileName: "pasted text" };
  analyzeSource();
});
