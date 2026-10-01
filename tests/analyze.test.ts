import { describe, expect, it } from "vitest";
import { analyzeCsv, fileSizeError, MAX_FILE_BYTES, type AnalysisResult } from "../src/analyze";
import { buildMarkdownReport } from "../src/report";

function findingById(result: AnalysisResult, id: string) {
  return result.findings.find((finding) => finding.id === id);
}

/** IDs of findings that block an import (everything except plain notes). */
function problems(result: AnalysisResult): string[] {
  return result.findings
    .filter((finding) => finding.severity !== "info")
    .map((finding) => finding.id);
}

describe("analyzeCsv", () => {
  it("reports a clean CSV as clean", () => {
    const result = analyzeCsv("name,age\nBob,42\nAlice,37\n");
    expect(result.stats.delimiter).toBe(",");
    expect(result.stats.delimiterSource).toBe("auto");
    expect(result.stats.columnCount).toBe(2);
    expect(result.stats.totalRecords).toBe(3);
    expect(result.stats.nonBlankRecords).toBe(3);
    expect(result.stats.blankLineCount).toBe(0);
    expect(result.ragged).toEqual([]);
    expect(problems(result)).toEqual([]);
  });

  it("keeps quoted commas inside a single field", () => {
    const result = analyzeCsv('name,note\n"Doe, Jane","a, b"\n');
    expect(result.stats.columnCount).toBe(2);
    expect(result.records[1]).toEqual(["Doe, Jane", "a, b"]);
    expect(result.ragged).toEqual([]);
    expect(problems(result)).toEqual([]);
  });

  it("numbers ragged rows by parsed record", () => {
    const result = analyzeCsv("a,b,c\n1,2,3\n4,5\n6,7,8\n");
    expect(result.ragged).toEqual([{ record: 3, expected: 3, actual: 2 }]);
    const finding = findingById(result, "ragged");
    expect(finding?.severity).toBe("error");
    expect(finding?.details.join(" ")).toContain("Record 3: 2 fields (expected 3).");
  });

  it("detects semicolon files", () => {
    const result = analyzeCsv("name;age;city\nBob;42;Paris\nCara;33;Rome\n");
    expect(result.stats.delimiter).toBe(";");
    expect(result.stats.delimiterSource).toBe("auto");
    expect(result.stats.delimiterLabel).toBe("semicolon");
    expect(result.stats.columnCount).toBe(3);
    expect(result.ragged).toEqual([]);
    expect(problems(result)).toEqual([]);
  });

  it("detects tab and pipe files", () => {
    const tab = analyzeCsv("a\tb\n1\t2\n");
    expect(tab.stats.delimiter).toBe("\t");
    expect(tab.stats.columnCount).toBe(2);
    expect(tab.ragged).toEqual([]);

    const pipe = analyzeCsv("a|b\n1|2\n");
    expect(pipe.stats.delimiter).toBe("|");
    expect(pipe.stats.columnCount).toBe(2);
    expect(pipe.ragged).toEqual([]);
  });

  it("detects and ignores a UTF-8 BOM without polluting the header", () => {
    const result = analyzeCsv("\uFEFFname,age\nBob,42\n");
    expect(result.stats.bomDetected).toBe(true);
    expect(findingById(result, "bom")?.severity).toBe("info");
    expect(result.stats.columnCount).toBe(2);
    expect(result.ragged).toEqual([]);
    expect(problems(result)).toEqual([]);
  });

  it("reports duplicate headers with column numbers", () => {
    const result = analyzeCsv("id,Name,name\n1,2,3\n");
    const finding = findingById(result, "duplicate-headers");
    expect(finding?.severity).toBe("warning");
    expect(finding?.details.join(" ")).toContain("Columns 2, 3");
  });

  it("reports empty headers from a trailing delimiter", () => {
    const result = analyzeCsv("a,b,\n1,2,3\n");
    const finding = findingById(result, "empty-headers");
    expect(finding?.severity).toBe("warning");
    expect(finding?.details.join(" ")).toContain("Column 3");
  });

  it("warns when a manual delimiter collapses rows to one column", () => {
    const result = analyzeCsv("name;age\nBob;42\n", { delimiter: "," });
    expect(result.stats.columnCount).toBe(1);
    expect(result.stats.delimiterSource).toBe("manual");
    expect(findingById(result, "delimiter-guess")?.severity).toBe("warning");
  });

  it("warns when detection fails but another delimiter appears in the first line", () => {
    const result = analyzeCsv("a;b\nc\nd;e");
    expect(result.stats.columnCount).toBe(1);
    expect(findingById(result, "delimiter-guess")?.severity).toBe("warning");
  });

  it("labels manually chosen delimiters as manual", () => {
    const result = analyzeCsv("a;b;c\n1;2;3\n", { delimiter: ";" });
    expect(result.stats.delimiterSource).toBe("manual");
    expect(result.stats.delimiterLabel).toBe("semicolon");
    expect(result.stats.columnCount).toBe(3);
    expect(result.ragged).toEqual([]);
  });

  it("handles empty and whitespace-only input without crashing", () => {
    const empty = analyzeCsv("");
    expect(empty.stats.totalRecords).toBe(0);
    expect(empty.ragged).toEqual([]);
    expect(findingById(empty, "empty")?.severity).toBe("warning");

    const spaces = analyzeCsv("   \n");
    expect(findingById(spaces, "empty")).toBeDefined();
  });

  it("counts blank lines without treating them as ragged rows", () => {
    const result = analyzeCsv("a,b\n\n1,2\n");
    expect(result.stats.blankLineCount).toBe(1);
    expect(result.stats.totalRecords).toBe(3);
    expect(result.ragged).toEqual([]);
    const finding = findingById(result, "blank-lines");
    expect(finding?.severity).toBe("info");
    expect(finding?.title).toContain("1");
  });

  it("notes mixed line endings", () => {
    const result = analyzeCsv("a,b\r\n1,2\n3,4\r\n");
    expect(result.stats.lineEndings).toBe("mixed");
    expect(findingById(result, "mixed-line-endings")?.severity).toBe("info");
  });

  it("explains unclosed quotes in plain language", () => {
    const result = analyzeCsv('a,b\n1,"broken\n2,3\n');
    const finding = findingById(result, "parse-errors");
    expect(finding?.severity).toBe("error");
    const text = finding?.details.join(" ").toLowerCase() ?? "";
    expect(text).toContain("quote");
    expect(text).toContain("record 2");
  });

  it("caps ragged detail at 20 records and summarizes the rest", () => {
    const lines = ["a,b,c", ...Array.from({ length: 30 }, () => "1,2"), ""];
    const result = analyzeCsv(lines.join("\n"));
    expect(result.ragged).toHaveLength(30);
    const finding = findingById(result, "ragged");
    const recordLines = finding?.details.filter((detail) => detail.startsWith("Record ")) ?? [];
    expect(recordLines).toHaveLength(20);
    expect(finding?.details.join(" ")).toContain("10 more record");
  });

  it("rejects files over the 5 MB limit via the size helper", () => {
    expect(fileSizeError(MAX_FILE_BYTES)).toBeNull();
    expect(fileSizeError(MAX_FILE_BYTES + 1)).toContain("5 MB");
  });
});

describe("buildMarkdownReport", () => {
  it("includes the summary, findings and the record-number caveat", () => {
    const result = analyzeCsv("a,b,c\n1,2,3\n4,5\n");
    const markdown = buildMarkdownReport(result, {
      fileName: "data.csv",
      generatedAt: "2026-10-01T00:00:00.000Z",
      repoUrl: "https://github.com/MHK-ctrl/csv-triage",
    });
    expect(markdown).toContain("# CSV Triage report");
    expect(markdown).toContain("data.csv");
    expect(markdown).toContain("Record 3: 2 fields (expected 3).");
    expect(markdown).toContain("parsed CSV record numbers");
    expect(markdown).toContain("auto-detected guess");
    expect(markdown).toContain("Generated with [CSV Triage](https://github.com/MHK-ctrl/csv-triage)");
  });
});
