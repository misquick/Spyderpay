import type { Logger } from '../ports/system.js';

export interface Job {
  readonly name: string;
  run(): Promise<void>;
}

/**
 * Runs background jobs in a loop. It knows nothing about what the jobs do:
 * a new job is added in the composition root without touching this class.
 */
export class Worker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private current: Promise<void> | undefined;

  constructor(
    private readonly jobs: readonly Job[],
    private readonly intervalMs: number,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.running = true;
    this.logger.info('worker started', { jobs: this.jobs.map((j) => j.name), intervalMs: this.intervalMs });
    void this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    clearTimeout(this.timer);
    await this.current;
  }

  /** One pass over all jobs. A failing job is logged and does not stop the others. */
  async tick(): Promise<void> {
    for (const job of this.jobs) {
      try {
        await job.run();
      } catch (error) {
        this.logger.error('job failed', { job: job.name, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  private async loop(): Promise<void> {
    if (!this.running) return;
    this.current = this.tick();
    await this.current;
    if (this.running) this.timer = setTimeout(() => void this.loop(), this.intervalMs);
  }
}
