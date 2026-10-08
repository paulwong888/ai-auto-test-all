import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";

const workerStreamAgent = new Agent({
  bodyTimeout: 0,
  headersTimeout: 60_000,
});

export function fetchWorkerStream(url: string, init: UndiciRequestInit) {
  return undiciFetch(url, { ...init, dispatcher: workerStreamAgent });
}
