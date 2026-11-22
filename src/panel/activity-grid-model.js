export const ACTIVITY_GRID_DAYS = 28;

const TITLE = `Activity over ${ACTIVITY_GRID_DAYS} days`;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const BLOCK_HOURS = [0, 6, 12, 18];

export const ACTIVITY_CELL_LABELS = {
    future: "Future",
    unknown: "No data",
    empty: "No activity",
    low: "Low activity",
    medium: "Medium activity",
    high: "High activity",
};

// Allow one missed refresh at the longest configured polling interval (30 minutes).
const MAX_EMPTY_GAP_SECONDS = 60 * 60;

/** @typedef {import("../../types/index.js").UsageSnapshot} UsageSnapshot */
/** @typedef {import("../../types/index.js").HistoryEntry} HistoryEntry */
/** @typedef {"future" | "unknown" | "empty" | "low" | "medium" | "high"} ActivityCell */

/**
 * @param {UsageSnapshot | null} snapshot
 * @param {HistoryEntry[]} history
 * @param {number} nowSeconds
 * @returns {{visible: boolean, title: string, summary: string, days: {label: string, dateLabel: string, cells: ActivityCell[]}[]}}
 */
export function createActivityGridViewModel(
    snapshot,
    history = [],
    nowSeconds = Date.now() / 1000,
) {
    const hidden = { visible: false, title: TITLE, summary: "", days: [] };
    const now = new Date(nowSeconds * 1000);
    if (!Number.isFinite(now.getTime())) return hidden;

    const weeklyQuota =
        snapshot?.quotas.find((quota) => quota.limitWindowSeconds === WEEK_SECONDS) ??
        snapshot?.quotas.find((quota) => quota.limitWindowSeconds == null && quota.id === "weekly");
    if (snapshot && !weeklyQuota) return hidden;

    const days = Array.from({ length: ACTIVITY_GRID_DAYS }, (_, index) => {
        const date = now.getDate() - (ACTIVITY_GRID_DAYS - 1) + index;
        /** @param {number} hour */
        const boundary = (hour) => new Date(now.getFullYear(), now.getMonth(), date, hour);
        return {
            date: boundary(0),
            blocks: BLOCK_HOURS.map((hour) => ({
                start: boundary(hour).getTime() / 1000,
                end: boundary(hour + 6).getTime() / 1000,
                value: /** @type {number | null} */ (null),
            })),
        };
    });
    const blocks = days.flatMap(({ blocks }) => blocks);
    const samples = getSamples(
        history,
        weeklyQuota?.id ?? "weekly",
        nowSeconds,
        snapshot,
        weeklyQuota,
    );
    for (let index = 1; index < samples.length; index += 1) {
        const previous = samples[index - 1];
        const current = samples[index];
        const duration = current.timestamp - previous.timestamp;
        const delta = current.usedPercent - previous.usedPercent;
        const reset =
            previous.resetAt != null &&
            ((previous.timestamp < previous.resetAt && previous.resetAt <= current.timestamp) ||
                (current.resetAt != null && previous.resetAt !== current.resetAt));
        if (delta < 0 || reset || duration > WEEK_SECONDS) continue;
        if (delta === 0 && duration > MAX_EMPTY_GAP_SECONDS) continue;

        for (const block of blocks) {
            const overlap =
                Math.min(current.timestamp, block.end) - Math.max(previous.timestamp, block.start);
            if (overlap > 0) block.value = (block.value ?? 0) + delta * (overlap / duration);
        }
    }
    if (blocks.every(({ value }) => value === null)) return hidden;

    const peak = Math.max(...blocks.map(({ value }) => value ?? 0));
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
    const month = new Intl.DateTimeFormat(undefined, { month: "short" });
    const gridDays = days.map(({ date, blocks }) => {
        const weekdayLabel = weekday.format(date);
        const [label] = weekdayLabel;
        return {
            label,
            dateLabel: `${weekdayLabel}, ${date.getDate()} ${month.format(date)}`,
            cells: blocks.map(({ start, value }) => {
                if (start > nowSeconds) return "future";
                if (value === null) return "unknown";
                if (value === 0) return "empty";
                if (value <= peak / 3) return "low";
                return value <= (2 * peak) / 3 ? "medium" : "high";
            }),
        };
    });
    let active = 0;
    let empty = 0;
    let unknown = 0;
    for (const { cells } of gridDays) {
        for (const cell of cells) {
            if (cell === "unknown") unknown++;
            else if (cell === "empty") empty++;
            else if (cell !== "future") active++;
        }
    }
    return {
        visible: true,
        title: TITLE,
        summary: `6-hour blocks: ${active} active, ${empty} with no activity, ${unknown} with no data.`,
        days: gridDays,
    };
}

/**
 * @param {HistoryEntry[]} history
 * @param {string} quotaId
 * @param {number} nowSeconds
 * @param {UsageSnapshot | null} snapshot
 * @param {UsageSnapshot["quotas"][number] | undefined} weeklyQuota
 */
function getSamples(history, quotaId, nowSeconds, snapshot, weeklyQuota) {
    /** @type {Map<number, {timestamp: number, usedPercent: number, resetAt: number | null}>} */
    const samples = new Map();
    let latest = -Infinity;

    /**
     * @param {number} timestamp
     * @param {HistoryEntry["quotas"][number] | undefined} quota
     */
    function addSample(timestamp, quota) {
        if (!Number.isFinite(timestamp) || timestamp > nowSeconds) return;
        const usedPercent = quota?.usedPercent;
        if (
            usedPercent == null ||
            !Number.isFinite(usedPercent) ||
            usedPercent < 0 ||
            usedPercent > 100
        )
            return;
        const resetAt = quota?.resetAt;
        samples.set(timestamp, {
            timestamp,
            usedPercent,
            resetAt: resetAt != null && Number.isFinite(resetAt) ? resetAt : null,
        });
        latest = Math.max(latest, timestamp);
    }

    for (const entry of history) {
        if (typeof entry?.timestamp !== "string" || !Array.isArray(entry.quotas)) continue;
        addSample(
            Date.parse(entry.timestamp) / 1000,
            entry.quotas.find((quota) => quota?.id === quotaId),
        );
    }
    // An unchanged refresh is not saved in history, but it can close the last interval.
    if (snapshot && snapshot.fetchedAt > latest) addSample(snapshot.fetchedAt, weeklyQuota);
    return [...samples.values()].sort((a, b) => a.timestamp - b.timestamp);
}
