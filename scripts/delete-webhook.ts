import { Bot } from 'grammy';
import { getConfig } from '../src/config.js';

async function main(): Promise<void> {
  const config = getConfig();
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  console.log('🗑️ Deleting Telegram Webhook...');

  try {
    const botInfo = await bot.api.getMe();
    console.log(`🤖 Connected to Bot: @${botInfo.username} (${botInfo.first_name})`);

    await bot.api.deleteWebhook({ drop_pending_updates: true });
    console.log('✅ Webhook successfully removed from Telegram.');

    const info = await bot.api.getWebhookInfo();
    console.log(`- Webhook URL is now: "${info.url}" (empty indicates polling mode is enabled)`);
  } catch (error) {
    console.error('❌ Failed to delete webhook:', error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
