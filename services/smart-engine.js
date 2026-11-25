const DAY = 86400000;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

const PRIORITY_W = { high: 1, medium: 0.6, low: 0.3 };

// stress changes how the score is weighted and how many tasks are shown
const WEIGHTS = {
    normal:   { u: 0.45, p: 0.35, e: 0.20 },   // urgency, priority, lightness
    elevated: { u: 0.40, p: 0.30, e: 0.30 },
    high:     { u: 0.35, p: 0.25, e: 0.40 }
};
const LIMITS = { normal: 5, elevated: 4, high: 3 };

function stressMode(stress) {
    if (stress == null) return "normal";
    if (stress >= 8) return "high";
    if (stress >= 6) return "elevated";
    return "normal";
}

function daysLeft(deadline, now = new Date()) {
    if (!deadline) return null;
    const d = new Date(deadline);
    if (isNaN(d)) return null;
    const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((b - a) / DAY);
}

function urgency(d) {
    if (d == null) return 0.1;          // no deadline
    if (d <= 0) return 1;               // due today or overdue
    return Math.max(0.05, 1 - d / 14);  // fades to ~0 at two weeks
}

const effortOf = (t) => clamp(Number(t.effort) || 3, 1, 5);

function scoreTask(task, mode, now) {
    const d = daysLeft(task.deadline, now);
    const u = urgency(d);
    const p = PRIORITY_W[String(task.priority || "").toLowerCase()] ?? 0.5;
    const effort = effortOf(task);
    const light = 1 - (effort - 1) / 4;          // 1 = light, 0 = heavy
    const w = WEIGHTS[mode];

    const reasons = [];
    if (d != null && d < 0) reasons.push(`Overdue by ${-d} day${-d > 1 ? "s" : ""}`);
    else if (d === 0) reasons.push("Due today");
    else if (d === 1) reasons.push("Due tomorrow");
    else if (d != null && d <= 3) reasons.push(`Due in ${d} days`);
    if (p >= 1) reasons.push("High priority");
    if (effort <= 2) reasons.push("Light effort");
    if (effort >= 4) reasons.push("Heavy effort");

    return {
        task_id: task.task_id,
        title: task.title,
        subject: task.subject,
        priority: task.priority,
        deadline: task.deadline,
        effort,
        daysLeft: d,
        score: Math.round((w.u * u + w.p * p + w.e * light) * 100),
        reasons
    };
}

function rankTasks(tasks, stress, now = new Date()) {
    const mode = stressMode(stress);
    const limit = LIMITS[mode];

    const ranked = tasks
        .filter(t => t.status !== "Completed")
        .map(t => scoreTask(t, mode, now))
        .sort((a, b) => b.score - a.score);

    // very stressed: heavy tasks wait unless they are due within a day
    const deferred = (t) =>
        mode === "high" && t.effort >= 4 && !(t.daysLeft != null && t.daysLeft <= 1);

    const eligible = ranked.filter(t => !deferred(t));
    const focus = eligible.slice(0, limit);
    const later = ranked.filter(t => !focus.includes(t));

    const message = {
        normal:   "Here is your best order for today.",
        elevated: "Your stress is a bit high, so lighter tasks get a boost.",
        high:     "Your stress is high today. Showing fewer, lighter tasks first. Heavy tasks wait unless they are due soon."
    }[mode];

    return { mode, stress: stress ?? null, limit, message, focus, later };
}

/* ---------- z-score ---------- */

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

// how far `value` is from this person's own baseline
function zScore(value, baseline, minStd = 0.5) {
    if (baseline.length < 3) return null;
    const m = mean(baseline);
    const sd = Math.sqrt(baseline.reduce((s, x) => s + (x - m) ** 2, 0) / (baseline.length - 1));
    return { z: (value - m) / Math.max(sd, minStd), mean: m, sd };
}

module.exports = { rankTasks, stressMode, zScore, mean, daysLeft, urgency, effortOf };