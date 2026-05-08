import GLib from "gi://GLib";

export class Scheduler {
    private timeoutId: number | null = null;
    private running = false;
    private started = false;

    constructor(
        private intervalSeconds: number,
        private readonly task: () => Promise<void>,
    ) {}

    start({ runImmediately = false }: { runImmediately?: boolean } = {}): void {
        if (this.started) {
            return;
        }

        this.started = true;
        this.schedule();

        if (runImmediately) {
            void this.run();
        }
    }

    stop(): void {
        this.started = false;
        this.removeTimeout();
    }

    setIntervalSeconds(intervalSeconds: number): void {
        this.intervalSeconds = intervalSeconds;

        if (!this.started) {
            return;
        }

        this.removeTimeout();
        this.schedule();
    }

    runNow(): void {
        void this.run();
    }

    private schedule(): void {
        if (this.timeoutId !== null || this.intervalSeconds <= 0) {
            return;
        }

        this.timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            this.intervalSeconds,
            () => {
                if (!this.started) {
                    this.timeoutId = null;
                    return GLib.SOURCE_REMOVE;
                }

                void this.run();
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    private removeTimeout(): void {
        if (this.timeoutId === null) {
            return;
        }

        GLib.source_remove(this.timeoutId);
        this.timeoutId = null;
    }

    private async run(): Promise<void> {
        if (this.running) {
            return;
        }

        this.running = true;

        try {
            await this.task();
        } catch (err) {
            console.error("Scheduler task failed", err);
        } finally {
            this.running = false;
        }
    }
}
