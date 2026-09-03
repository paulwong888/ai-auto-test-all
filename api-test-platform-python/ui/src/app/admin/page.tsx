/**
 * 版权所有 (c) 2023-2026 北京慧测信息技术有限公司(但问智能) 保留所有权利。
 * 
 * 本代码版权归北京慧测信息技术有限公司(但问智能)所有，仅用于学习交流目的，未经公司商业授权，
 * 不得用于任何商业用途，包括但不限于商业环境部署、售卖或以任何形式进行商业获利。违者必究。
 * 
 * 授权商业应用请联系微信：huice666
 */

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PlatformLogoSVG } from "@/components/icons/langgraph";
import { ProjectForm } from "@/components/admin/project-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  listProjects,
  listRuns,
  listReports,
  analyzeCode,
  runTests,
  syncEndpoints,
} from "@/lib/management-api";
import {
  ArrowLeft,
  FileSearch,
  Play,
  RefreshCw,
  LayoutDashboard,
  LoaderCircle,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";

interface Project {
  id: string;
  name: string;
  repo_url?: string;
  base_url?: string;
  openapi_spec?: string;
  description?: string;
  created_at?: string;
}

interface Run {
  id: string;
  project_id?: string;
  test_path?: string;
  marker?: string;
  status: string;
  passed?: number;
  failed?: number;
  skipped?: number;
  total?: number;
  started_at?: string;
  finished_at?: string;
}

interface Report {
  id: string;
  project_id?: string;
  title: string;
  report_type?: string;
  created_at?: string;
}

export default function AdminPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>(
    {},
  );

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [p, r, rep] = await Promise.all([
        listProjects(),
        listRuns(),
        listReports(),
      ]);
      setProjects((p || []).map((item) => item as Project));
      setRuns((r || []).map((item) => item as Run));
      setReports((rep || []).map((item) => item as Report));
    } catch (err) {
      toast.error("加载数据失败", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const runAction = async (
    key: string,
    label: string,
    action: () => Promise<unknown>,
  ) => {
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const result = await action();
      toast.success(`${label}成功`, {
        description: JSON.stringify(result).slice(0, 120),
      });
      fetchAll();
    } catch (err) {
      toast.error(`${label}失败`, {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const formatTime = (value?: string) => {
    if (!value) return "—";
    const date = new Date(value);
    return isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b bg-white px-6 py-4 shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <PlatformLogoSVG width={36} height={36} />
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                智能 API 测试平台
              </h1>
              <p className="text-muted-foreground text-sm">管理后台</p>
            </div>
          </div>
          <Link href="/">
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-1 size-4" />
              返回聊天
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-6">
        {/* Projects */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <LayoutDashboard className="size-5" />
                项目列表
              </CardTitle>
              <CardDescription>管理测试项目并触发分析、测试与接口同步</CardDescription>
            </div>
            <ProjectForm onCreated={fetchAll} />
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton
                    key={i}
                    className="h-16 w-full"
                  />
                ))}
              </div>
            ) : projects.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center">
                暂无项目，点击右上角“新建项目”开始。
              </p>
            ) : (
              <div className="space-y-3">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="rounded-lg border bg-white p-4 transition-shadow hover:shadow-sm"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-medium">{project.name}</h3>
                        <p className="text-muted-foreground truncate text-sm">
                          {project.base_url || project.repo_url || "无地址配置"}
                        </p>
                        {project.description && (
                          <p className="text-muted-foreground mt-1 line-clamp-1 text-sm">
                            {project.description}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={actionLoading[`analyze-${project.id}`]}
                          onClick={() =>
                            runAction(
                              `analyze-${project.id}`,
                              "代码分析",
                              () => analyzeCode({ project_id: project.id, base_branch: "main" }),
                            )
                          }
                        >
                          {actionLoading[`analyze-${project.id}`] ? (
                            <LoaderCircle className="mr-1 size-4 animate-spin" />
                          ) : (
                            <FileSearch className="mr-1 size-4" />
                          )}
                          分析
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={actionLoading[`test-${project.id}`]}
                          onClick={() =>
                            runAction(
                              `test-${project.id}`,
                              "冒烟测试",
                              () =>
                                runTests({
                                  project_id: project.id,
                                  marker: "smoke",
                                }),
                            )
                          }
                        >
                          {actionLoading[`test-${project.id}`] ? (
                            <LoaderCircle className="mr-1 size-4 animate-spin" />
                          ) : (
                            <Play className="mr-1 size-4" />
                          )}
                          测试
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            actionLoading[`sync-${project.id}`] ||
                            !project.openapi_spec
                          }
                          onClick={() =>
                            runAction(
                              `sync-${project.id}`,
                              "接口同步",
                              () =>
                                syncEndpoints({ project_id: project.id }),
                            )
                          }
                        >
                          {actionLoading[`sync-${project.id}`] ? (
                            <LoaderCircle className="mr-1 size-4 animate-spin" />
                          ) : (
                            <RefreshCw className="mr-1 size-4" />
                          )}
                          同步
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Runs */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Play className="size-5" />
                最近测试运行
              </CardTitle>
              <CardDescription>查看 API 测试执行历史</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton
                      key={i}
                      className="h-12 w-full"
                    />
                  ))}
                </div>
              ) : runs.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center">暂无运行记录</p>
              ) : (
                <div className="space-y-2">
                  {runs.slice(0, 10).map((run) => (
                    <div
                      key={run.id}
                      className="flex items-center justify-between rounded-md border p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {run.status === "passed" ? (
                            <CheckCircle2 className="size-4 text-emerald-600" />
                          ) : run.status === "failed" ? (
                            <XCircle className="size-4 text-rose-600" />
                          ) : (
                            <Clock className="size-4 text-amber-600" />
                          )}
                          <span className="truncate text-sm font-medium">
                            {run.test_path || "api-test-run"}
                          </span>
                        </div>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {formatTime(run.started_at)}
                        </p>
                      </div>
                      <div className="text-right text-sm">
                        <span className="text-emerald-600">{run.passed ?? 0} 通过</span>
                        <span className="mx-1">/</span>
                        <span className="text-rose-600">{run.failed ?? 0} 失败</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Reports */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSearch className="size-5" />
                最近报告
              </CardTitle>
              <CardDescription>查看分析与测试报告</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton
                      key={i}
                      className="h-12 w-full"
                    />
                  ))}
                </div>
              ) : reports.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center">暂无报告</p>
              ) : (
                <div className="space-y-2">
                  {reports.slice(0, 10).map((report) => (
                    <div
                      key={report.id}
                      className="rounded-md border p-3"
                    >
                      <p className="truncate text-sm font-medium">
                        {report.title}
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {report.report_type} · {formatTime(report.created_at)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
