import { Bot } from 'grammy';
import { getConfig } from '../src/config.js';

async function main(): Promise<void> {
  const config = getConfig();
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  // Read URL from CLI arg or environment variable
  let webhookUrl = process.argv[2] || process.env['WEBHOOK_URL'];

  if (!webhookUrl) {
    console.error(`
❌ Error: Webhook URL is required!
Usage:
  pnpm set-webhook https://your-vercel-deployment.vercel.app/api/webhook

Or set the WEBHOOK_URL environment variable:
  WEBHOOK_URL=https://your-vercel-deployment.vercel.app/api/webhook pnpm set-webhook
`);
    process.exit(1);
  }

  webhookUrl = webhookUrl.trim();

  // Validate URL format
  try {
    const parsed = new URL(webhookUrl);
    if (parsed.protocol !== 'https:') {
      console.warn('⚠️ Warning: Telegram webhooks require an HTTPS URL. Make sure your domain uses HTTPS.');
    }
  } catch (err) {
    console.error(`❌ Error: "${webhookUrl}" is not a valid URL.`);
    process.exit(1);
  }

  console.log('📡 Setting Telegram Webhook...');
  console.log(`- Webhook URL:   ${webhookUrl}`);
  console.log(`- Secret Token:  ${'*'.repeat(config.TELEGRAM_SECRET_TOKEN.length)}`);

  try {
    const botInfo = await bot.api.getMe();
    console.log(`🤖 Connected to Bot: @${botInfo.username} (${botInfo.first_name})`);

    const setResult = await bot.api.setWebhook(webhookUrl, {
      secret_token: config.TELEGRAM_SECRET_TOKEN,
      drop_pending_updates: false,
      allowed_updates: ['message'],
      max_connections: 40,
    });

    if (setResult) {
      console.log('✅ Webhook successfully registered with Telegram!');
    }

    const info = await bot.api.getWebhookInfo();
    console.log('\n📊 Current Webhook Status:');
    console.log(`- URL:                     ${info.url}`);
    console.log(`- Custom certificate:      ${info.has_custom_certificate}`);
    console.log(`- Pending update count:    ${info.pending_update_count}`);
    console.log(`- Max connections:         ${info.max_connections ?? 'default'}`);
    console.log(`- Allowed updates:         ${info.allowed_updates?.join(', ') ?? 'all'}`);

    if (info.last_error_date) {
      const errorDate = new Date(info.last_error_date * 1000).toLocaleString();
      console.log(`- Last error date:         ${errorDate}`);
      console.log(`- Last error message:      ${info.last_error_message}`);
    } else {
      console.log(`- Last error:              None (healthy)`);
    }

    console.log('\n🎉 Bot is ready to receive updates on Vercel!');
  } catch (error: unknown) {
    console.error('❌ Failed to set webhook:', error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error running set-webhook:', err);
  process.exit(1);
});
