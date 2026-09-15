import { JourneysPanel } from "./JourneyCard";
import type {
  ComponentRegistryPreview,
  ExecutionReportPreview,
  InjectionsPreview,
  JourneysDocument,
  LocatorsPreview,
} from "../types";

function ExecutionReportView({
  data,
  onRetryJourneys,
  retryDisabled,
}: {
  data: ExecutionReportPreview;
  onRetryJourneys?: (journeyIds: string[]) => void;
  retryDisabled?: boolean;
}) {
  const retryable = data.results.filter(
    (r) => r.status === "failed" || r.status === "flaky",
  );
  const retryableIds = retryable.map((r) => r.journeyId);

  return (
    <div className="artifact-structured">
      <div className="artifact-stats">
        <span>模式 {data.executionMode}</span>
        <span>通过 {data.summary.passed}</span>
        <span>失败 {data.summary.failed}</span>
        <span>不稳定 {data.summary.flaky ?? 0}</span>
        <span>跳过 {data.summary.skipped}</span>
        {retryableIds.length > 0 && onRetryJourneys && (
          <button
            type="button"
            className="btn-secondary report-retry-all"
            disabled={retryDisabled}
            onClick={() => onRetryJourneys(retryableIds)}
          >
            重跑全部失败项 ({retryableIds.length})
          </button>
        )}
      </div>
      <table className="artifact-table">
        <thead>
          <tr>
            <th>Journey</th>
            <th>状态</th>
            <th>类型</th>
            <th>次数</th>
            {onRetryJourneys && <th>操作</th>}
          </tr>
        </thead>
        <tbody>
          {data.results.map((r) => (
            <tr key={r.journeyId}>
              <td>{r.title}</td>
              <td>{r.status}</td>
              <td>{r.failureType ?? "—"}</td>
              <td>{r.attempts}</td>
              {onRetryJourneys && (
                <td>
                  {(r.status === "failed" || r.status === "flaky") && (
                    <button
                      type="button"
                      className="step-retry"
                      disabled={retryDisabled}
                      onClick={() => onRetryJourneys([r.journeyId])}
                    >
                      重跑
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Props {
  artifactKey: string;
  content: string;
  availableSpecKeys: Set<string>;
  journeySpecOverlay?: { key: string; content: string } | null;
  onCloseJourneySpec?: () => void;
  onViewSpec?: (artifactKey: string) => void;
  onRetryJourneys?: (journeyIds: string[]) => void;
  retryDisabled?: boolean;
}

function tryParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function RegistryPreview({ data }: { data: ComponentRegistryPreview }) {
  const stats = data.scanStats;
  return (
    <div className="artifact-structured">
      <div className="artifact-stats">
        {stats && (
          <>
            <span>文件 {stats.filesScanned}</span>
            <span>组件 {stats.componentsFound}</span>
            <span>解析错误 {stats.parseErrors}</span>
          </>
        )}
        {data.frontendPath && (
          <span className="mono muted path">{data.frontendPath}</span>
        )}
      </div>
      <table className="artifact-table">
        <thead>
          <tr>
            <th>组件</th>
            <th>交互元素</th>
            <th>语义</th>
          </tr>
        </thead>
        <tbody>
          {data.components.slice(0, 30).map((c) => (
            <tr key={c.name}>
              <td className="mono">{c.name}</td>
              <td>{c.interactiveElements?.length ?? 0}</td>
              <td className="muted truncate">{c.businessSemantics ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.components.length > 30 && (
        <p className="hint">显示前 30 / {data.components.length} 个组件</p>
      )}
    </div>
  );
}

function InjectionsPreviewView({ data }: { data: InjectionsPreview }) {
  return (
    <div className="artifact-structured">
      <div className="artifact-stats">
        <span>补丁 {data.patches.length}</span>
        {data.dryRun ? (
          <span className="badge badge-idle">dry-run</span>
        ) : (
          <span className="badge badge-ready">applied</span>
        )}
      </div>
      <table className="artifact-table">
        <thead>
          <tr>
            <th>组件</th>
            <th>元素</th>
            <th>testId</th>
            <th>动作</th>
          </tr>
        </thead>
        <tbody>
          {data.patches.slice(0, 25).map((p, i) => (
            <tr key={`${p.file}-${p.line}-${i}`}>
              <td>{p.component}</td>
              <td className="mono">{p.elementRole}</td>
              <td className="mono">{p.testId}</td>
              <td>{p.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.patches.length > 25 && (
        <p className="hint">显示前 25 / {data.patches.length} 条</p>
      )}
    </div>
  );
}

function LocatorsPreviewView({ data }: { data: LocatorsPreview }) {
  return (
    <div className="artifact-structured">
      <div className="artifact-stats">
        <span>定位器 {data.locators.length}</span>
      </div>
      <table className="artifact-table">
        <thead>
          <tr>
            <th>组件</th>
            <th>元素</th>
            <th>testId</th>
            <th>优先链</th>
          </tr>
        </thead>
        <tbody>
          {data.locators.slice(0, 25).map((l, i) => (
            <tr key={`${l.component}-${l.element}-${i}`}>
              <td>{l.component}</td>
              <td className="mono">{l.element}</td>
              <td className="mono">{l.testId ?? "—"}</td>
              <td className="mono truncate">{l.priority[0] ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.locators.length > 25 && (
        <p className="hint">显示前 25 / {data.locators.length} 条</p>
      )}
    </div>
  );
}

function CodePreview({ content, language }: { content: string; language: string }) {
  return (
    <div className="code-preview">
      <div className="code-preview-label">{language}</div>
      <pre>{content}</pre>
    </div>
  );
}

function JsonPreview({ content }: { content: string }) {
  const parsed = tryParseJson<unknown>(content);
  const formatted = parsed ? JSON.stringify(parsed, null, 2) : content;
  return (
    <div className="code-preview">
      <div className="code-preview-label">JSON</div>
      <pre>{formatted}</pre>
    </div>
  );
}

function JourneySpecOverlay({
  specKey,
  content,
  onClose,
}: {
  specKey: string;
  content: string;
  onClose: () => void;
}) {
  return (
    <div className="journey-spec-overlay">
      <div className="journey-spec-overlay-header">
        <span className="mono muted">{specKey.replace(/^spec-/, "tests/")}.spec.ts</span>
        <button type="button" className="preview-back" onClick={onClose}>
          关闭 Spec
        </button>
      </div>
      <CodePreview content={content} language="Playwright Spec" />
    </div>
  );
}

export function ArtifactPreview({
  artifactKey,
  content,
  availableSpecKeys,
  journeySpecOverlay,
  onCloseJourneySpec,
  onViewSpec,
  onRetryJourneys,
  retryDisabled,
}: Props) {
  if (artifactKey === "journeys") {
    const doc = tryParseJson<JourneysDocument>(content);
    if (doc?.journeys) {
      return (
        <>
          {journeySpecOverlay && onCloseJourneySpec && (
            <JourneySpecOverlay
              specKey={journeySpecOverlay.key}
              content={journeySpecOverlay.content}
              onClose={onCloseJourneySpec}
            />
          )}
          <JourneysPanel
            doc={doc}
            availableSpecKeys={availableSpecKeys}
            onViewSpec={onViewSpec}
          />
        </>
      );
    }
  }

  if (artifactKey === "registry") {
    const data = tryParseJson<ComponentRegistryPreview>(content);
    if (data?.components) {
      return <RegistryPreview data={data} />;
    }
  }

  if (artifactKey === "injections") {
    const data = tryParseJson<InjectionsPreview>(content);
    if (data?.patches) {
      return <InjectionsPreviewView data={data} />;
    }
  }

  if (artifactKey === "locators") {
    const data = tryParseJson<LocatorsPreview>(content);
    if (data?.locators) {
      return <LocatorsPreviewView data={data} />;
    }
  }

  if (artifactKey === "execution-report") {
    const data = tryParseJson<ExecutionReportPreview>(content);
    if (data?.results) {
      return (
        <ExecutionReportView
          data={data}
          onRetryJourneys={onRetryJourneys}
          retryDisabled={retryDisabled}
        />
      );
    }
  }

  if (artifactKey.startsWith("pom-") || artifactKey.startsWith("spec-")) {
    const lang = artifactKey.startsWith("spec-") ? "Playwright Spec" : "POM TypeScript";
    return <CodePreview content={content} language={lang} />;
  }

  return <JsonPreview content={content} />;
}

export function previewMetaForArtifact(
  artifactKey: string,
  content: string,
): string {
  if (artifactKey === "registry") {
    const reg = tryParseJson<ComponentRegistryPreview>(content);
    const count =
      reg?.components?.length ?? reg?.scanStats?.componentsFound ?? 0;
    return count ? `组件数: ${count}` : "";
  }
  if (artifactKey === "injections") {
    const data = tryParseJson<InjectionsPreview>(content);
    return data?.patches ? `补丁数: ${data.patches.length}` : "";
  }
  if (artifactKey === "locators") {
    const data = tryParseJson<LocatorsPreview>(content);
    return data?.locators ? `定位器: ${data.locators.length}` : "";
  }
  if (artifactKey === "journeys") {
    const doc = tryParseJson<JourneysDocument>(content);
    const count = doc?.summary?.journeyCount ?? doc?.journeys?.length ?? 0;
    return count ? `旅程数: ${count}` : "";
  }
  if (artifactKey === "execution-report") {
    const doc = tryParseJson<ExecutionReportPreview>(content);
    if (!doc?.summary) return "";
    return `通过 ${doc.summary.passed}/${doc.summary.total}`;
  }
  if (artifactKey.startsWith("spec-")) {
    const lines = content.split("\n").length;
    return `行数: ${lines}`;
  }
  if (artifactKey.startsWith("pom-")) {
    const methods = (content.match(/async\s+\w+\s*\(/g) ?? []).length;
    return methods ? `方法: ${methods}` : "";
  }
  return "";
}
