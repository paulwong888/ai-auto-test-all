import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ResolvedLlmConfig } from "./llm-config-service.js";

const SKILLS_CANDIDATES = [
  "/root/.pi/agent/skills",
  "/etc/pi-agent/skills",
];

export class PiAgentConfigWriter {
  async write(jobId: string, config: ResolvedLlmConfig): Promise<{ homeDir: string }> {
    const homeDir = path.join(os.tmpdir(), `pi-home-${jobId}`);
    const agentDir = path.join(homeDir, ".pi", "agent");
    await rm(homeDir, { recursive: true, force: true });
    await mkdir(agentDir, { recursive: true });

    const models = this.buildModelsList(config);
    const modelsJson = {
      providers: {
        [config.provider]: {
          baseUrl: config.baseUrl,
          api: "openai-completions",
          apiKey: config.apiKey,
          authHeader: true,
          models,
        },
      },
    };

    const settingsJson = {
      defaultProvider: config.provider,
      defaultModel: config.defaultModel,
      enableSkillCommands: true,
      skills: [path.join(agentDir, "skills")],
    };

    await writeFile(path.join(agentDir, "models.json"), JSON.stringify(modelsJson, null, 2));
    await writeFile(path.join(agentDir, "settings.json"), JSON.stringify(settingsJson, null, 2));

    const skillsDest = path.join(agentDir, "skills");
    const skillsSrc = await this.resolveSkillsSource();
    if (skillsSrc) {
      await symlink(skillsSrc, skillsDest, "dir");
    } else {
      await mkdir(skillsDest, { recursive: true });
    }

    return { homeDir };
  }

  async cleanup(homeDir: string): Promise<void> {
    await rm(homeDir, { recursive: true, force: true }).catch(() => undefined);
  }

  private buildModelsList(config: ResolvedLlmConfig): Array<{ id: string }> {
    const ids = new Set<string>([config.defaultModel]);
    for (const model of config.extraModels) {
      ids.add(model);
    }
    return [...ids].map((id) => ({ id }));
  }

  private async resolveSkillsSource(): Promise<string | null> {
    const { access } = await import("node:fs/promises");
    for (const candidate of SKILLS_CANDIDATES) {
      try {
        await access(candidate);
        return candidate;
      } catch {
        // try next
      }
    }
    return null;
  }
}
