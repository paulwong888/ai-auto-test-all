/**
 * 版权所有 (c) 2023-2026 北京慧测信息技术有限公司(但问智能) 保留所有权利。
 * 
 * 本代码版权归北京慧测信息技术有限公司(但问智能)所有，仅用于学习交流目的，未经公司商业授权，
 * 不得用于任何商业用途，包括但不限于商业环境部署、售卖或以任何形式进行商业获利。违者必究。
 * 
 * 授权商业应用请联系微信：huice666
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetTrigger,
} from "@/components/ui/sheet";
import { createProject } from "@/lib/management-api";
import { Plus, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

interface ProjectFormProps {
  onCreated: () => void;
}

export function ProjectForm({ onCreated }: ProjectFormProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [openapiSpec, setOpenapiSpec] = useState("");
  const [description, setDescription] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    try {
      await createProject({
        name: name.trim(),
        repo_url: repoUrl.trim(),
        base_url: baseUrl.trim(),
        openapi_spec: openapiSpec.trim(),
        description: description.trim(),
      });
      toast.success("项目创建成功");
      setOpen(false);
      setName("");
      setRepoUrl("");
      setBaseUrl("");
      setOpenapiSpec("");
      setDescription("");
      onCreated();
    } catch (err) {
      toast.error("创建失败", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
    >
      <SheetTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 size-4" />
          新建项目
        </Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>新建项目</SheetTitle>
          <SheetDescription>
            创建新项目后，可在项目卡片中触发分析、测试或同步接口清单。
          </SheetDescription>
        </SheetHeader>
        <form
          onSubmit={handleSubmit}
          className="flex flex-1 flex-col gap-4 px-4 py-6"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-name">
              项目名称 <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：订单服务 API"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="project-base-url">API Base URL</Label>
            <Input
              id="project-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:8000"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="project-repo">代码仓库路径</Label>
            <Input
              id="project-repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="C:/Users/.../project 或 git URL"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="project-openapi">OpenAPI 规范路径</Label>
            <Input
              id="project-openapi"
              value={openapiSpec}
              onChange={(e) => setOpenapiSpec(e.target.value)}
              placeholder="swagger.json 或远程 URL"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="project-desc">描述</Label>
            <Textarea
              id="project-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="项目描述..."
              rows={3}
            />
          </div>

          <SheetFooter className="mt-auto">
            <Button
              type="submit"
              disabled={loading || !name.trim()}
              className="w-full"
            >
              {loading && (
                <LoaderCircle className="mr-2 size-4 animate-spin" />
              )}
              创建项目
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
