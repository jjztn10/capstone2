/* ==========================================================
   PREDICT ENGINE
   - forecastStress : linear regression + backtest (MAE vs naive)
   - overdueRisk    : explainable logistic score per task
   - weekLoad       : next-7-days workload vs capacity
   - scoreAssignee  : weighted fit score for task allocation
========================================================== */

const DAY = 86400000;

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const sum = (a) => a.reduce((s, x) => s + x, 0);

// effort points one person can finish per day (lowered when stressed)
const DAILY_EFFORT = 4;

const effortOf = (t) => clamp(Number(t.effort) || 3, 1, 5);

function daysLeft(deadline, now = new Date()) {
    if (!deadline) return null;
    const d = new Date(deadline);
    if (isNaN(d)) return null;
    const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((b - a) / DAY);
}

function capacityFor(stress) {
    if (stress == null) return DAILY_EFFORT;
    if (stress >= 8) return DAILY_EFFORT * 0.7;
    if (stress >= 6) return DAILY_EFFORT * 0.85;
    return DAILY_EFFORT;
}

/* ---------- 1. stress forecast ---------- */

// least squares line through [{x, y}]
function linFit(pts) {
    const n = pts.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;

    pts.forEach(p => {
        sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y;
    });

    const d = n * sxx - sx * sx;
    const slope = d === 0 ? 0 : (n * sxy - sx * sy) / d;

    return { slope, intercept: (sy - slope * sx) / n };
}

// points: x = day offset (today = 0, yesterday = -1 ...), y = avg stress
function forecastStress(points, horizon = 3) {
    const pts = points
        .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
        .sort((a, b) => a.x - b.x);

    if (pts.length < 4) return null;           // not enough history

    const { slope, intercept } = linFit(pts);

    const predicted = [];
    for (let h = 1; h <= horizon; h++) {
        predicted.push({
            ahead: h,
            value: Number(clamp(intercept + slope * h, 1, 10).toFixed(1))
        });
    }

    // backtest: predict each point from the ones before it,
    // compare with the naive guess "same as the previous entry"
    let err = 0, naive = 0, k = 0;
    for (let i = 3; i < pts.length; i++) {
        const f = linFit(pts.slice(0, i));
        const pred = clamp(f.intercept + f.slope * pts[i].x, 1, 10);
        err += Math.abs(pred - pts[i].y);
        naive += Math.abs(pts[i - 1].y - pts[i].y);
        k++;
    }

    const avg = mean(predicted.map(p => p.value));

    return {
        predicted,
        slope: Number(slope.toFixed(3)),
        trend: slope > 0.15 ? "up" : slope < -0.15 ? "down" : "stable",
        level: avg >= 7 ? "high" : avg >= 5.5 ? "medium" : "low",
        samples: pts.length,
        mae: k ? Number((err / k).toFixed(2)) : null,
        naiveMae: k ? Number((naive / k).toFixed(2)) : null
    };
}

/* ---------- 2. overdue risk ---------- */

// ctx: { open: [user's open tasks], onTimeRate: 0..1|null, stress: 1..10|null }
function overdueRisk(task, ctx, now = new Date()) {
    const d = daysLeft(task.deadline, now);
    if (d == null) return null;                // no deadline, no risk score

    if (d < 0) {
        return {
            risk: 1, level: "high", daysLeft: d,
            reasons: [`Already overdue by ${-d} day${-d > 1 ? "s" : ""}`]
        };
    }

    const open = ctx.open || [];
    const stress = ctx.stress ?? null;
    const rate = ctx.onTimeRate ?? 0.8;
    const cap = capacityFor(stress);

    // other open tasks that are due on or before this one compete for time
    const ahead = open.filter(o =>
        String(o.task_id) !== String(task.task_id) &&
        o.deadline && daysLeft(o.deadline, now) <= d
    );

    const needed = (effortOf(task) + sum(ahead.map(effortOf))) / cap;   // days of work
    const available = d + 0.5;
    const slack = available - needed;

    const risk = sigmoid(-1 * slack + 0.4 + 1.5 * (1 - rate));

    const reasons = [];
    if (slack < 1) reasons.push(`Needs about ${needed.toFixed(1)} days of work, ${d} left`);
    if (ahead.length) reasons.push(`${ahead.length} other task${ahead.length > 1 ? "s" : ""} due first`);
    if (rate < 0.6) reasons.push("Past deadlines were often missed");
    if (stress != null && stress >= 6) reasons.push("High stress slows the pace");
    if (!reasons.length) reasons.push("Comfortable amount of time");

    return {
        risk: Number(risk.toFixed(2)),
        level: risk >= 0.7 ? "high" : risk >= 0.4 ? "medium" : "low",
        daysLeft: d,
        reasons
    };
}

/* ---------- 3. next-7-days workload ---------- */

function weekLoad(open, stress, now = new Date()) {
    const due = open.filter(t => {
        const d = daysLeft(t.deadline, now);
        return d != null && d <= 7;
    });

    const points = sum(due.map(effortOf));
    const capacity = Math.round(capacityFor(stress) * 7);

    return {
        dueTasks: due.length,
        points,
        capacity,
        percent: Math.min(200, Math.round(points / capacity * 100))
    };
}

/* ---------- 4. task allocation ---------- */

const W = { load: 0.35, stress: 0.25, onTime: 0.25, subject: 0.15 };
const LOAD_CAP = 25;       // open effort points that count as "full"

// c: { uid, name, openEffort, openCount, stress, onTimeRate, subjectDone }
function scoreAssignee(c, task) {
    const loadScore = 1 - clamp(c.openEffort / LOAD_CAP, 0, 1);
    const stressScore = c.stress == null ? 0.5 : 1 - (c.stress - 1) / 9;
    const onTime = c.onTimeRate ?? 0.7;
    const subject = clamp(c.subjectDone / 5, 0, 1);

    let score =
        W.load * loadScore +
        W.stress * stressScore +
        W.onTime * onTime +
        W.subject * subject;

    const reasons = [];
    const warnings = [];

    if (loadScore >= 0.7) reasons.push("Light current workload");
    else if (loadScore <= 0.3) warnings.push("Already carrying a heavy workload");

    if (c.stress != null && c.stress <= 4) reasons.push("Low recent stress");
    if (c.stress != null && c.stress >= 7) warnings.push("High recent stress");

    if (c.onTimeRate != null && c.onTimeRate >= 0.8) reasons.push(`Finishes on time (${Math.round(c.onTimeRate * 100)}%)`);
    if (c.onTimeRate != null && c.onTimeRate < 0.5) warnings.push("Often misses deadlines");

    if (c.subjectDone >= 3) reasons.push(`Experienced in this subject (${c.subjectDone} done)`);

    // heavy task + stressed person = bad match
    if (effortOf(task) >= 4 && c.stress != null && c.stress >= 7) {
        score -= 0.15;
        warnings.push("Heavy task for a stressed person");
    }

    return {
        fit: Math.round(clamp(score, 0, 1) * 100),
        reasons,
        warnings
    };
}

module.exports = {
    DAILY_EFFORT, clamp, mean, daysLeft, effortOf,
    forecastStress, overdueRisk, weekLoad, scoreAssignee
};