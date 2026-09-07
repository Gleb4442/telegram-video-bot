import { getBot } from '../src/bot.js';

async function main(): Promise<void> {
  console.log('🚀 Starting Telegram Bot in Long Polling mode for local development...');
  const bot = getBot();

  // Delete any lingering webhook to allow polling
  await bot.api.deleteWebhook({ drop_pending_updates: true });

  const me = await bot.api.getMe();
  console.log(`🤖 Bot @${me.username} is now online and listening for messages!`);
  console.log('Press Ctrl+C to stop.\n');

  // Handle graceful shutdown
  process.once('SIGINT', () => bot.stop());
  process.once('SIGTERM', () => bot.stop());

  await bot.start({
    drop_pending_updates: true,
    allowed_updates: ['message', 'callback_query', 'inline_query'],
  });
}

main().catch((err) => {
  console.error('Error in dev polling:', err);
  process.exit(1);
});
