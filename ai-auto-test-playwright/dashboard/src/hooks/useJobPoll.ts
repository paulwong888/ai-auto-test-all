import { useCallback, useRef } from "react";
import { fetchJson } from "../api/client.js";
import type { Job } from "../types/project.js";

export function useJobPoll() {
  const timerRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const pollJob = useCallback(
    (jobId: string, intervalMs = 2000): Promise<Job> =>
      new Promise((resolve, reject) => {
        stop();
        const tick = async () => {
          try {
            const job = await fetchJson<Job>(`/api/jobs/${jobId}`);
            if (["completed", "failed", "cancelled"].includes(job.status)) {
              stop();
              resolve(job);
            }
          } catch (err) {
            stop();
            reject(err);
          }
        };
        void tick();
        timerRef.current = window.setInterval(() => void tick(), intervalMs);
      }),
    [stop],
  );

  return { pollJob, stopPoll: stop };
}
