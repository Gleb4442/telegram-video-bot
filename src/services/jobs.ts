import { Inngest } from "inngest";
import type { Update } from "grammy/types";
import { getBot } from "../bot.js";
import { getConfig } from "../config.js";
import { redis, namespace } from "../storage/state.js";

export const inngest = new Inngest({
  id: "telegram-video-bot",
  isDev: process.env["INNGEST_DEV"] === "1",
});
export async function enqueueUpdate(update: Update) {
  const user =
    update.message?.from?.id ??
    update.callback_query?.from.id ??
    update.inline_query?.from.id ??
    0;
  await inngest.send({
    id: `${namespace()}${update.update_id}`,
    name: "telegram/update",
    data: { update, user },
  });
}
export const processUpdate = inngest.createFunction(
  {
    id: "telegram-update",
    triggers: { event: "telegram/update" },
    retries: 3,
    concurrency: [{ limit: 4 }, { limit: 1, key: "event.data.user" }],
    timeouts: { finish: "10m" },
  },
  async ({ event, step }) => {
    return step.run("handle-update", async () => {
      getConfig();
      const update = event.data.update as Update;
      const client = await redis();
      if (!client) throw new Error("Durable processing requires Redis");
      const key = `${namespace()}done:${update.update_id}`;
      if (await client.get(key)) return { duplicate: true };
      const bot = getBot();
      await bot.init();
      await bot.handleUpdate(update);
      await client.set(key, "1", 604800);
      return { processed: update.update_id };
    });
  },
);
