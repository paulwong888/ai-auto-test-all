import { useCallback, useEffect, useState } from "react";

export interface PublicE2eAuthRecord {
  username: string;
  caseUsername?: string;
  corpUsername?: string;
  hasPassword: boolean;
  hasCasePassword?: boolean;
  hasCorpPassword?: boolean;
}

export interface ProjectRecord {
  id: string;
  name: string;
  frontendGitUrl: string | null;
  frontendBranch: string;
  backendGitUrl: string | null;
  backendBranch: string;
  localPathOverride: string | null;
  targetUrl: string | null;
  e2eAuth: PublicE2eAuthRecord | null;
  cloneStatus: string;
  cloneError: string | null;
  frontendRepoPath: string | null;
  backendRepoPath: string | null;
  lastClonedAt: string | null;
}

interface ProjectForm {
  id: string;
  name: string;
  frontendGitUrl: string;
  frontendBranch: string;
  backendGitUrl: string;
  backendBranch: string;
  localPathOverride: string;
  targetUrl: string;
  e2eUsername: string;
  e2ePassword: string;
  e2eCaseUsername: string;
  e2eCasePassword: string;
  e2eCorpUsername: string;
  e2eCorpPassword: string;
}

function isMountOnlyProject(p: ProjectRecord): boolean {
  const override = p.localPathOverride?.trim();
  if (!override) return false;
  return !p.frontendGitUrl?.trim() && !p.backendGitUrl?.trim();
}

const emptyForm = (): ProjectForm => ({
  id: "",
  name: "",
  frontendGitUrl: "",
  frontendBranch: "main",
  backendGitUrl: "",
  backendBranch: "main",
  localPathOverride: "",
  targetUrl: "",
  e2eUsername: "",
  e2ePassword: "",
  e2eCaseUsername: "",
  e2eCasePassword: "",
  e2eCorpUsername: "",
  e2eCorpPassword: "",
});

interface Props {
  projects: ProjectRecord[];
  selectedId: string;
  onRefresh: () => Promise<void>;
  onSelect: (id: string) => void;
}

export function ProjectPanel({
  projects,
  selectedId,
  onRefresh,
  onSelect,
}: Props) {
  const [form, setForm] = useState<ProjectForm>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = projects.find((p) => p.id === selectedId);

  const pollClone = useCallback(
    async (id: string) => {
      for (let i = 0; i < 120; i++) {
        const res = await fetch(`/api/projects/${id}`);
        const data = await res.json();
        const status = data.project?.cloneStatus as string | undefined;
        if (status === "ready" || status === "failed") {
          setCloningId(null);
          await onRefresh();
          if (status === "failed") {
            setError(data.project?.cloneError ?? "clone failed");
          } else {
            setMessage("Clone 完成");
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      setCloningId(null);
      setError("Clone 超时，请刷新查看状态");
    },
    [onRefresh],
  );

  useEffect(() => {
    if (!cloningId) return;
    void pollClone(cloningId);
  }, [cloningId, pollClone]);

  function loadEdit(p: ProjectRecord) {
    setEditingId(p.id);
    setForm({
      id: p.id,
      name: p.name,
      frontendGitUrl: p.frontendGitUrl ?? "",
      frontendBranch: p.frontendBranch,
      backendGitUrl: p.backendGitUrl ?? "",
      backendBranch: p.backendBranch,
      localPathOverride: p.localPathOverride ?? "",
      targetUrl: p.targetUrl ?? "",
      e2eUsername: p.e2eAuth?.username ?? "",
      e2ePassword: "",
      e2eCaseUsername: p.e2eAuth?.caseUsername ?? "",
      e2eCasePassword: "",
      e2eCorpUsername: p.e2eAuth?.corpUsername ?? "",
      e2eCorpPassword: "",
    });
    setMessage(null);
    setError(null);
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm());
  }

  function buildE2eAuthPayload(): Record<string, string> {
    const auth: Record<string, string> = {
      username: form.e2eUsername.trim(),
    };

    if (form.e2ePassword) {
      auth.password = form.e2ePassword;
    } else if (!editingId) {
      auth.password = form.e2ePassword;
    }

    if (form.e2eCaseUsername.trim()) {
      auth.caseUsername = form.e2eCaseUsername.trim();
    }
    if (form.e2eCasePassword) {
      auth.casePassword = form.e2eCasePassword;
    }
    if (form.e2eCorpUsername.trim()) {
      auth.corpUsername = form.e2eCorpUsername.trim();
    }
    if (form.e2eCorpPassword) {
      auth.corpPassword = form.e2eCorpPassword;
    }

    return auth;
  }

  async function saveProject() {
    setError(null);
    setMessage(null);

    if (!form.name.trim()) {
      setError("请填写项目名称");
      return;
    }

    if (!editingId) {
      if (!form.e2eUsername.trim() || !form.e2ePassword) {
        setError("新建项目必须填写 E2E 用户名和密码");
        return;
      }
    } else if (!form.e2eUsername.trim()) {
      setError("E2E 用户名不能为空");
      return;
    }

    const e2eAuth = buildE2eAuthPayload();
    const body: Record<string, unknown> = {
      name: form.name,
      frontendGitUrl: form.frontendGitUrl,
      frontendBranch: form.frontendBranch,
      backendGitUrl: form.backendGitUrl,
      backendBranch: form.backendBranch,
      localPathOverride: form.localPathOverride || undefined,
      targetUrl: form.targetUrl || undefined,
      ...(editingId ? {} : form.id ? { id: form.id } : {}),
    };

    body.e2eAuth = e2eAuth;

    const url = editingId ? `/api/projects/${editingId}` : "/api/projects";
    const method = editingId ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) {
      setError(typeof data.error === "string" ? data.error : "保存失败");
      return;
    }
    setMessage(editingId ? "项目已更新" : "项目已创建");
    resetForm();
    await onRefresh();
    if (data.project?.id) onSelect(data.project.id);
  }

  async function deleteProject(id: string) {
    if (!confirm(`删除项目 ${id}？（磁盘 repo 不会删除）`)) return;
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!data.ok) {
      setError("删除失败");
      return;
    }
    setMessage("项目已删除");
    await onRefresh();
  }

  async function cloneProject(id: string) {
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/projects/${id}/clone`, { method: "POST" });
    const data = await res.json();
    if (res.status === 409) {
      setError("Clone 正在进行中");
      return;
    }
    if (!data.ok) {
      setError(typeof data.error === "string" ? data.error : "Clone 启动失败");
      return;
    }
    setCloningId(id);
    setMessage("Clone 进行中…");
    await onRefresh();
  }

  function statusClass(status: string): string {
    return `badge badge-${status}`;
  }

  return (
    <section className="panel projects-panel">
      <h2>项目管理</h2>

      {message && <p className="hint ok">{message}</p>}
      {error && <p className="error">{error}</p>}

      <div className="project-list">
        {projects.map((p) => (
          <div
            key={p.id}
            className={`project-row${p.id === selectedId ? " selected" : ""}`}
          >
            <button
              type="button"
              className="project-select"
              onClick={() => onSelect(p.id)}
            >
              <strong>{p.name}</strong>
              <span className="mono">{p.id}</span>
            </button>
            <span className={statusClass(p.cloneStatus)}>{p.cloneStatus}</span>
            <span className="path mono" title={p.frontendRepoPath ?? ""}>
              {p.frontendRepoPath ?? "—"}
            </span>
            <div className="row-actions">
              <button type="button" onClick={() => loadEdit(p)}>
                编辑
              </button>
              <button
                type="button"
                disabled={cloningId === p.id}
                onClick={() => void cloneProject(p.id)}
              >
                {cloningId === p.id ? "Clone…" : "Clone"}
              </button>
              <button type="button" onClick={() => void deleteProject(p.id)}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <p className="hint">
          当前选中：<strong>{selected.name}</strong>
          {selected.e2eAuth?.hasPassword ? (
            <> — E2E 凭证已配置（{selected.e2eAuth.username}）</>
          ) : (
            <> — 未配置 E2E 登录凭证</>
          )}
          {selected.cloneStatus !== "ready" && (
            <>
              {" "}
              —{" "}
              {isMountOnlyProject(selected)
                ? "挂载路径尚不可用，请检查 local path override"
                : "请先 Clone 再启动 pipeline"}
            </>
          )}
        </p>
      )}

      <details className="project-form-wrap" open={!!editingId}>
        <summary>{editingId ? `编辑 ${editingId}` : "新建项目"}</summary>
        <div className="project-form">
          {!editingId && (
            <label>
              ID（可选）
              <input
                value={form.id}
                onChange={(e) => setForm({ ...form, id: e.target.value })}
                placeholder="自动生成"
              />
            </label>
          )}
          <label>
            名称
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </label>
          <label>
            Frontend Git URL（SSH）
            <input
              value={form.frontendGitUrl}
              onChange={(e) =>
                setForm({ ...form, frontendGitUrl: e.target.value })
              }
              placeholder="git@github.com:org/repo.git"
            />
          </label>
          <label>
            Frontend Branch
            <input
              value={form.frontendBranch}
              onChange={(e) =>
                setForm({ ...form, frontendBranch: e.target.value })
              }
            />
          </label>
          <label>
            Backend Git URL
            <input
              value={form.backendGitUrl}
              onChange={(e) =>
                setForm({ ...form, backendGitUrl: e.target.value })
              }
            />
          </label>
          <label>
            Backend Branch
            <input
              value={form.backendBranch}
              onChange={(e) =>
                setForm({ ...form, backendBranch: e.target.value })
              }
            />
          </label>
          <label>
            Local Path Override
            <input
              value={form.localPathOverride}
              onChange={(e) =>
                setForm({ ...form, localPathOverride: e.target.value })
              }
              placeholder="/data/repos/external/..."
            />
          </label>
          <label>
            Target URL
            <input
              value={form.targetUrl}
              onChange={(e) => setForm({ ...form, targetUrl: e.target.value })}
            />
          </label>

          <fieldset className="e2e-auth-fieldset">
            <legend>E2E 登录凭证</legend>
            <label>
              E2E 用户名
              <input
                value={form.e2eUsername}
                onChange={(e) =>
                  setForm({ ...form, e2eUsername: e.target.value })
                }
                required
                autoComplete="off"
              />
            </label>
            <label>
              E2E 密码
              <input
                type="password"
                value={form.e2ePassword}
                onChange={(e) =>
                  setForm({ ...form, e2ePassword: e.target.value })
                }
                placeholder={editingId ? "留空则不修改" : undefined}
                required={!editingId}
                autoComplete="new-password"
              />
            </label>
            <details className="e2e-auth-optional">
              <summary>Case / Corp 角色（可选）</summary>
              <label>
                Case 用户名
                <input
                  value={form.e2eCaseUsername}
                  onChange={(e) =>
                    setForm({ ...form, e2eCaseUsername: e.target.value })
                  }
                  autoComplete="off"
                />
              </label>
              <label>
                Case 密码
                <input
                  type="password"
                  value={form.e2eCasePassword}
                  onChange={(e) =>
                    setForm({ ...form, e2eCasePassword: e.target.value })
                  }
                  placeholder={editingId ? "留空则不修改" : undefined}
                  autoComplete="new-password"
                />
              </label>
              <label>
                Corp 用户名
                <input
                  value={form.e2eCorpUsername}
                  onChange={(e) =>
                    setForm({ ...form, e2eCorpUsername: e.target.value })
                  }
                  autoComplete="off"
                />
              </label>
              <label>
                Corp 密码
                <input
                  type="password"
                  value={form.e2eCorpPassword}
                  onChange={(e) =>
                    setForm({ ...form, e2eCorpPassword: e.target.value })
                  }
                  placeholder={editingId ? "留空则不修改" : undefined}
                  autoComplete="new-password"
                />
              </label>
            </details>
          </fieldset>

          <div className="form-actions">
            <button type="button" onClick={() => void saveProject()}>
              {editingId ? "保存" : "创建"}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm}>
                取消
              </button>
            )}
          </div>
        </div>
      </details>
    </section>
  );
}
