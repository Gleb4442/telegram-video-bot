import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// Load environment variables from .env file if present
loadDotenv();

export const ConfigSchema = z.object({
  TELEGRAM_BOT_TOKEN: z
    .string({
      required_error:
        "TELEGRAM_BOT_TOKEN is required. Get one from @BotFather on Telegram.",
    })
    .min(10, "TELEGRAM_BOT_TOKEN must be at least 10 characters long"),

  TELEGRAM_SECRET_TOKEN: z
    .string({
      required_error:
        "TELEGRAM_SECRET_TOKEN is required for securing Vercel webhook endpoints.",
    })
    .min(1, "TELEGRAM_SECRET_TOKEN must not be empty")
    .regex(
      /^[A-Za-z0-9_-]+$/,
      "TELEGRAM_SECRET_TOKEN should only contain characters A-Z, a-z, 0-9, _ and -",
    ),

  COBALT_API_URL: z
    .string()
    .url("COBALT_API_URL must be a valid URL")
    .default("https://cobalt-service-gleb.onrender.com/"),

  COBALT_FALLBACK_URLS: z
    .string()
    .optional()
    .default("https://rue-cobalt.xenon.zone/"),

  COBALT_API_KEY: z.string().optional(),

  UPSTASH_REDIS_REST_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().url().optional(),
  ),
  UPSTASH_REDIS_REST_TOKEN: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(1).optional(),
  ),
  INNGEST_EVENT_KEY: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(1).optional(),
  ),
  INNGEST_SIGNING_KEY: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(1).optional(),
  ),
  MEDIA_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(900).default(300),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(50).default(50),
  COBALT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(15000),

  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),

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
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid application configuration:\n${errorDetails}\n\nPlease check your environment variables or .env file.`,
    );
  }

  if (
    !!result.data.UPSTASH_REDIS_REST_URL !==
    !!result.data.UPSTASH_REDIS_REST_TOKEN
  )
    throw new Error("Both Upstash REST credentials are required");
  if (
    result.data.INNGEST_EVENT_KEY &&
    (!result.data.INNGEST_SIGNING_KEY || !result.data.UPSTASH_REDIS_REST_URL)
  )
    throw new Error(
      "Queued production mode requires Inngest signing key and Upstash Redis",
    );
  cachedConfig = result.data;
  return cachedConfig;
}

export function getAllCobaltUrls(): string[] {
  const config = getConfig();
  const urls: string[] = [];

  const addUrl = (raw: string) => {
    const trimmed = raw.trim().replace(/\/+$/, "");
    if (trimmed && !urls.some((u) => u.replace(/\/+$/, "") === trimmed)) {
      urls.push(trimmed);
    }
  };

  if (config.COBALT_API_URL) {
    config.COBALT_API_URL.split(",").forEach(addUrl);
  }

  if (config.COBALT_FALLBACK_URLS) {
    config.COBALT_FALLBACK_URLS.split(",").forEach(addUrl);
  }

  return urls;
}

export function resetConfigForTesting(): void {
  cachedConfig = null;
}
