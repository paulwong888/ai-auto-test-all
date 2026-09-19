declare module "dockerode" {
  export default class Docker {
    constructor(options?: { socketPath?: string });
    createContainer(options: Record<string, unknown>): Promise<{
      id: string;
      start(): Promise<void>;
      stop(options?: { t?: number }): Promise<void>;
      inspect(): Promise<{
        NetworkSettings: { Ports?: Record<string, Array<{ HostPort?: string }> | null> };
      }>;
    }>;
    getContainer(id: string): {
      stop(options?: { t?: number }): Promise<void>;
    };
  }
}
