import GLib from "gi://GLib";
export class Scheduler {
    intervalSeconds;
    task;
    timeoutId = null;
    running = false;
    started = false;
    constructor(intervalSeconds, task) {
        this.intervalSeconds = intervalSeconds;
        this.task = task;
    }
    start({ runImmediately = false } = {}) {
        if (this.started) {
            return;
        }
        this.started = true;
        this.schedule();
        if (runImmediately) {
            void this.run();
        }
    }
    stop() {
        this.started = false;
        this.removeTimeout();
    }
    setIntervalSeconds(intervalSeconds) {
        this.intervalSeconds = intervalSeconds;
        if (!this.started) {
            return;
        }
        this.removeTimeout();
        this.schedule();
    }
    runNow() {
        void this.run();
    }
    schedule() {
        if (this.timeoutId !== null || this.intervalSeconds <= 0) {
            return;
        }
        this.timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this.intervalSeconds, () => {
            if (!this.started) {
                this.timeoutId = null;
                return GLib.SOURCE_REMOVE;
            }
            void this.run();
            return GLib.SOURCE_CONTINUE;
        });
    }
    removeTimeout() {
        if (this.timeoutId === null) {
            return;
        }
        GLib.source_remove(this.timeoutId);
        this.timeoutId = null;
    }
    async run() {
        if (this.running) {
            return;
        }
        this.running = true;
        try {
            await this.task();
        }
        catch (err) {
            console.error("Scheduler task failed", err);
        }
        finally {
            this.running = false;
        }
    }
}
