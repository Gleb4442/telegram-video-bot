/** Telegram transport errors can contain the token in their request URL. Never log their object/message. */
export function safeErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'error_code' in error && typeof error.error_code === 'number') return `TELEGRAM_${error.error_code}`;
  return error instanceof Error ? error.name : 'UNKNOWN';
}
