export const PYTEST_BIN = "/opt/venv/bin/pytest";

export interface PytestRunOptions {
  workspacePath: string;
  baseUrl?: string;
  headed?: boolean;
  slowmo?: number;
  specFilter?: string | null;
  nodeIds?: string[];
}

export interface PytestSummary {
  passed: number;
  failed: number;
  skipped: number;
}

const PASSED_RE = /(\d+)\s+passed/i;
const FAILED_RE = /(\d+)\s+failed/i;
const ERROR_RE = /(\d+)\s+errors?/i;
const SKIPPED_RE = /(\d+)\s+skipped/i;

export function buildPytestCommand(options: PytestRunOptions): string {
  const headed = options.headed !== false ? "--headed" : "";
  const slowmo =
    options.slowmo !== undefined && options.slowmo > 0 ? `--slowmo ${options.slowmo}` : "";

  let target = "specs/";
  if (options.nodeIds && options.nodeIds.length > 0) {
    target = options.nodeIds.map((id) => shellQuote(id)).join(" ");
  } else if (options.specFilter) {
    target = options.specFilter;
  }

  const baseUrl =
    options.baseUrl !== undefined && options.baseUrl.length > 0
      ? `--base-url ${shellQuote(options.baseUrl)}`
      : "";

  const parts = [
    `cd ${shellQuote(`${options.workspacePath}/tests`)}`,
    "&&",
    PYTEST_BIN,
    target,
    baseUrl,
    headed,
    slowmo,
    "--tracing retain-on-failure",
    "--output test-results",
    "--html report.html --self-contained-html",
    "-v",
  ].filter(Boolean);

  return parts.join(" ");
}

export function parsePytestSummary(line: string): PytestSummary | null {
  if (!/passed|failed|error|skipped/i.test(line)) {
    return null;
  }
  const passed = line.match(PASSED_RE)?.[1];
  const failed = line.match(FAILED_RE)?.[1];
  const errors = line.match(ERROR_RE)?.[1];
  const skipped = line.match(SKIPPED_RE)?.[1];
  if (!passed && !failed && !errors && !skipped) {
    return null;
  }
  return {
    passed: passed ? Number(passed) : 0,
    failed: (failed ? Number(failed) : 0) + (errors ? Number(errors) : 0),
    skipped: skipped ? Number(skipped) : 0,
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
