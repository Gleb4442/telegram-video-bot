import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { mkdtemp, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  preferences,
  togglePreference,
  quota,
  checkpoint,
  closeState,
} from "../src/storage/state.js";
import { resetConfigForTesting } from "../src/config.js";
const run = promisify(execFile);
let directory: string;
let socket: string;
let processHandle: ReturnType<typeof spawn>;
let server: ReturnType<typeof createServer>;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "tvb-redis-test-"));
  socket = join(directory, "redis.sock");
  processHandle = spawn(
    process.env["REDIS_SERVER_BIN"] ?? "redis-server",
    ["--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "no"],
    { stdio: "ignore" },
  );
  for (let i = 0; i < 100; i++) {
    try {
      await access(socket);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    try {
      const data = JSON.parse(Buffer.concat(chunks).toString());
      const batch = Array.isArray(data[0]);
      const commands: Array<Array<string | number>> = batch ? data : [data];
      const results = await Promise.all(
        commands.map(async (command) => {
          const out = await run(process.env["REDIS_CLI_BIN"] ?? "redis-cli", [
            "-s",
            socket,
            "--json",
            ...command.map(String),
          ]);
          return { result: JSON.parse(out.stdout) };
        }),
      );
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(batch ? results : results[0]));
    } catch {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: "test Redis failure" }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "1234567890:integration");
  vi.stubEnv("TELEGRAM_SECRET_TOKEN", "test");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", `http://127.0.0.1:${address.port}`);
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fixture");
  resetConfigForTesting();
});
beforeEach(async () => {
  await run(process.env["REDIS_CLI_BIN"] ?? "redis-cli", [
    "-s",
    socket,
    "FLUSHDB",
  ]);
  await closeState();
});
afterAll(async () => {
  await closeState();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (processHandle) {
    const exited = new Promise<void>((resolve) =>
      processHandle.once("exit", () => resolve()),
    );
    processHandle.kill("SIGTERM");
    await exited;
  }
  await rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
  resetConfigForTesting();
});
it("retains settings across client recreation and toggles atomically", async () => {
  await togglePreference(42, "asDocument", 1);
  await closeState();
  expect((await preferences(42)).asDocument).toBe(true);
  await Promise.all([
    togglePreference(42, "cleanMode", 2),
    togglePreference(42, "cleanMode", 3),
  ]);
  expect((await preferences(42)).cleanMode).toBe(false);
});
it("does not apply a duplicate callback toggle twice", async () => {
  expect((await togglePreference(42, "asDocument", 11)).asDocument).toBe(true);
  expect((await togglePreference(42, "asDocument", 11)).asDocument).toBe(true);
  expect((await preferences(42)).asDocument).toBe(true);
});
it("enforces shared quota without counting redelivered updates twice", async () => {
  for (let i = 0; i < 10; i++) expect(await quota(42, i)).toBe(true);
  expect(await quota(42, 0)).toBe(true);
  expect(await quota(42, 10)).toBe(false);
  expect(await quota(43, 11)).toBe(true);
});
it("resumes delivery without repeating previously confirmed sends", async () => {
  const send = vi.fn().mockResolvedValue("sent");
  expect(await checkpoint(42, "sendVideo:0", send)).toBe("sent");
  await closeState();
  expect(await checkpoint(42, "sendVideo:0", send)).toBeUndefined();
  expect(send).toHaveBeenCalledTimes(1);
});
