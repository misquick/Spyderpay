export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

export interface WebhookRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
}

export type WebhookResult = { ok: true; status: number } | { ok: false; error: string };

export interface WebhookSender {
  send(request: WebhookRequest): Promise<WebhookResult>;
}
