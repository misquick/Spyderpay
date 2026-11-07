import { pino } from 'pino';
import type { Logger } from '../ports/system.js';

/** Structured JSON logs (one line per event) — easy to read with `docker compose logs`. */
export function createLogger(level: string): Logger {
  const log = pino({ level, base: undefined, timestamp: pino.stdTimeFunctions.isoTime });
  return {
    debug: (msg, data) => log.debug(data ?? {}, msg),
    info: (msg, data) => log.info(data ?? {}, msg),
    warn: (msg, data) => log.warn(data ?? {}, msg),
    error: (msg, data) => log.error(data ?? {}, msg),
  };
}
