export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number;
}

async function withTimedFetch<T>(
  url: string | URL,
  options: FetchWithTimeoutOptions,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  const { timeoutMs = 8000, signal, ...fetchOptions } = options;
  const controller = new AbortController();
  const combinedSignal = controller.signal;
  const onCallerAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onCallerAbort();
  else signal?.addEventListener("abort", onCallerAbort, { once: true });
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  let onAbort: () => void = () => {};
  try {
    combinedSignal.throwIfAborted();
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(combinedSignal.reason);
      combinedSignal.addEventListener("abort", onAbort, { once: true });
    });
    return await Promise.race([
      fetch(url, { ...fetchOptions, signal: combinedSignal }).then(read),
      aborted,
    ]);
  } finally {
    clearTimeout(timeoutId);
    combinedSignal.removeEventListener("abort", onAbort);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}

/** Bounds fetching response headers. Use fetchJsonWithTimeout for JSON bodies. */
export function fetchWithTimeout(
  url: string | URL,
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  return withTimedFetch(url, options, async (response) => response);
}

/** Keeps cancellation active until the entire JSON body has been consumed. */
export function fetchJsonWithTimeout(
  url: string | URL,
  options: FetchWithTimeoutOptions = {},
): Promise<{ response: Response; data: unknown }> {
  return withTimedFetch(url, options, async (response) => ({
    response,
    data: await readBoundedJson(response).catch((error: unknown) => {
      if (error instanceof SyntaxError) return null;
      throw error;
    }),
  }));
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (Number(response.headers?.get("content-length")) > 1024 * 1024) {
    await response.body?.cancel();
    throw new Error("JSON response too large");
  }
  if (!response.body) return response.json();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > 1024 * 1024) {
        await reader.cancel();
        throw new Error("JSON response too large");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
