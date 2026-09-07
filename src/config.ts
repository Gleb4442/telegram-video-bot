import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file if present
loadDotenv();

export const ConfigSchema = z.object({
  TELEGRAM_BOT_TOKEN: z
    .string({
      required_error: 'TELEGRAM_BOT_TOKEN is required. Get one from @BotFather on Telegram.',
    })
    .min(10, 'TELEGRAM_BOT_TOKEN must be at least 10 characters long'),
  
  TELEGRAM_SECRET_TOKEN: z
    .string({
      required_error: 'TELEGRAM_SECRET_TOKEN is required for securing Vercel webhook endpoints.',
    })
    .min(1, 'TELEGRAM_SECRET_TOKEN must not be empty')
    .regex(
      /^[A-Za-z0-9_-]+$/,
      'TELEGRAM_SECRET_TOKEN should only contain characters A-Z, a-z, 0-9, _ and -'
    ),

  COBALT_API_URL: z
    .string()
    .url('COBALT_API_URL must be a valid URL')
    .default('https://api.cobalt.tools/'),

  COBALT_API_KEY: z.string().optional(),

  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('production'),

  PORT: z.coerce.number().default(3000),
});

export type Config = z.infer<typeof ConfigSchema>;

let cachedConfig: Config | null = null;

export function getConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid application configuration:\n${errorDetails}\n\nPlease check your environment variables or .env file.`
    );
  }

  cachedConfig = result.data;
  return cachedConfig;
}

export function resetConfigForTesting(): void {
  cachedConfig = null;
}
