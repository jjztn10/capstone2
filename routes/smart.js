const express = require("express");
const { Query } = require("../database/db-helper");
const { getUid } = require("../middleware/current-user");
const { rankTasks, zScore, mean, daysLeft, urgency, effortOf } = require("../services/smart-engine");

const userRouter = express.Router();
const adminRouter = express.Router();

/* ---------- settings: adjust to your schema ---------- */
// Every row in `users` is a regular user (admins live in master_users)
const USERS_SQL = `SELECT uid, name FROM users`;
const CAPACITY = 20;          // workload points that equal 100%
const STRESS_Z = 2;           // |z| needed to flag stress
const PRODUCTIVITY_Z = 1.5;   // |z| needed to flag productivity

function fail(res, err) {
    console.error(err);
    const status = err.status || 500;
    res.status(status).json({
        error: status === 500 ? "Something went wrong. Please try again." : err.message
    });
}

/* Admin check: accepts every shape the login saves.
   (app.js already blocks non-admins from /admindashboard.) */
function requireAdmin(req, res, next) {
    const s = req.session || {};
    const role = String(s.roleName || s.user?.role || s.role || "").toLowerCase();

    if (!s.userId || (role !== "admin" && s.isAdmin !== true)) {
        return res.status(403).json({ error: "Admin only." });
    }
    next();
}

async function todayStress(uid) {
    const rows = await Query(`
        SELECT stress_level FROM mood_entries
        WHERE uid = ? AND DATE(created_at) = CURDATE()
        ORDER BY created_at DESC LIMIT 1
    `, [uid]);
    return rows[0] ? Number(rows[0].stress_level) : null;
}

async function focusFor(uid) {
    const [tasks, stress] = await Promise.all([
        Query(`SELECT * FROM tasks WHERE uid = ? AND status <> 'Completed'`, [uid]),
        todayStress(uid)
    ]);
    return rankTasks(tasks, stress);
}

/* ==========================================================
   USER: "DO THIS FIRST"
========================================================== */

userRouter.get("/api/focus", async (req, res) => {
    try {
        res.set("Cache-Control", "no-store");
        res.json(await focusFor(getUid(req)));
    } catch (err) {
        fail(res, err);
    }
});

/* ==========================================================
   USER: CHAT ASSISTANT
   Uses Google Gemini (free tier) when GEMINI_API_KEY is set;
   otherwise a rule-based answer from the same ranking
   (works offline).
========================================================== */

const hits = new Map();   // simple per-user rate limit: 15 / minute
function limited(uid) {
    const now = Date.now();
    const list = (hits.get(uid) || []).filter(t => now - t < 60000);
    list.push(now);
    hits.set(uid, list);
    return list.length > 15;
}

// Drop stale entries so the map doesn't grow forever
setInterval(() => {
    const now = Date.now();
    for (const [uid, list] of hits) {
        if (!list.some(t => now - t < 60000)) hits.delete(uid);
    }
}, 5 * 60 * 1000).unref();

function contextText(f) {
    const line = (t, i) =>
        `${i + 1}. ${t.title}${t.subject ? ` (${t.subject})` : ""} | priority ${t.priority} | ` +
        `effort ${t.effort}/5 | ${t.daysLeft == null ? "no deadline" : t.daysLeft < 0 ? `overdue ${-t.daysLeft}d` : `due in ${t.daysLeft}d`}`;

    return [
        `Today's stress: ${f.stress == null ? "not logged" : f.stress + "/10"} (mode: ${f.mode})`,
        `Recommended order (already ranked by the app):`,
        ...(f.focus.length ? f.focus.map(line) : ["(no open tasks)"]),
        f.later.length ? `Postponed / lower priority:\n${f.later.map(line).join("\n")}` : ""
    ].filter(Boolean).join("\n");
}

function offlineReply(f) {
    if (!f.focus.length) return "You have no open tasks. Nice work! Add a task and I'll help you plan it.";
    const t = f.focus[0];
    let msg = `Start with "${t.title}"` + (t.reasons.length ? ` (${t.reasons.join(", ").toLowerCase()})` : "") + ".";
    if (f.focus[1]) msg += ` Then "${f.focus[1].title}".`;
    if (f.mode === "high") msg += " Your stress is high, so take breaks and leave heavy tasks for later.";
    return msg;
}

async function askGemini(f, history, message) {
    const system =
        "You are SmartWork Assistant, a friendly and helpful AI inside a workload management app for students and staff. " +
        "You can answer general questions on any topic, such as study help, explanations, writing, and advice. " +
        "When the user asks about their tasks, schedule, or what to work on, use the task and mood data below, and never invent tasks or deadlines. " +
        "Keep answers concise, at most 5 short sentences unless the user asks for more detail. " +
        "If stress is 8 or higher, be gentle and suggest fewer or lighter tasks and a short break. " +
        "You are not a medical professional; for serious distress suggest talking to someone they trust.\n\n" +
        `Today's date: ${new Date().toDateString()}\n` +
        contextText(f);

    // Gemini calls the assistant role "model"
    const contents = history
        .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .slice(-6)
        .map(m => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content.slice(0, 500) }]
        }));
    while (contents.length && contents[0].role !== "user") contents.shift();
    contents.push({ role: "user", parts: [{ text: message }] });

    // Tried in order. If one is overloaded or missing, the next one is used.
    // Put your preferred model first with GEMINI_MODEL in .env.
    const models = [...new Set([
        process.env.GEMINI_MODEL,
        "gemini-3.5-flash-lite",
        "gemini-2.5-flash",
        "gemini-4-hydrogen"
    ].filter(Boolean))];

    const body = JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents
    });

    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    let lastError = "AI request failed";

    for (const model of models) {
        for (let attempt = 1; attempt <= 2; attempt++) {
            let r, data;

            try {
                r = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
                    {
                        method: "POST",
                        headers: {
                            "content-type": "application/json",
                            "x-goog-api-key": process.env.GEMINI_API_KEY
                        },
                        body
                    }
                );
                data = await r.json();
            } catch (e) {
                lastError = e.message;
                await wait(800);
                continue;                       // network hiccup: retry
            }

            if (r.ok) {
                const text = (data.candidates?.[0]?.content?.parts || [])
                    .map(p => p.text || "")
                    .join("\n")
                    .trim();
                if (text) return text;
                lastError = "The AI returned an empty answer.";
                break;                          // try the next model
            }

            lastError = data.error?.message || `AI request failed (${r.status})`;
            console.warn(`Gemini ${model} attempt ${attempt}: ${lastError}`);

            // A bad key fails on every model, so stop right away
            if (/api key/i.test(lastError) || r.status === 401) {
                throw new Error(lastError);
            }
            // Model retired, not available, or not found: try the next model
            if (r.status === 400 || r.status === 403 || r.status === 404) break;

            // 429 / 500 / 503: busy, wait a moment and retry once
            if (attempt < 2) await wait(1200);
        }
    }

    throw new Error(lastError);
}

userRouter.post("/api/assistant", async (req, res) => {
    try {
        const uid = getUid(req);
        if (limited(uid)) return res.status(429).json({ error: "Too many messages. Wait a moment." });

        const message = String(req.body?.message || "").trim().slice(0, 500);
        if (!message) return res.status(400).json({ error: "Message is required." });

        const f = await focusFor(uid);
        let reply;
        let aiError = "";

        if (!process.env.GEMINI_API_KEY) {
            aiError = "GEMINI_API_KEY is not set (check .env and restart the server).";
            console.error("Assistant AI error:", aiError);
        } else {
            try {
                reply = await askGemini(f, Array.isArray(req.body?.history) ? req.body.history : [], message);
                if (!reply) aiError = "The AI returned an empty answer.";
            } catch (e) {
                aiError = e.message;
                console.error("Assistant AI error:", e.message);
            }
        }

        // TEMPORARY: shows why the AI failed. Remove the aiError part once it works.
        res.json({
            reply: reply || `[AI unavailable: ${aiError}]\n\n${offlineReply(f)}`,
            ai: !!reply
        });
    } catch (err) {
        fail(res, err);
    }
});

/* ==========================================================
   ADMIN: TEAM HEATMAP  (workload vs stress)
========================================================== */

adminRouter.get("/api/team/heatmap", requireAdmin, async (req, res) => {
    try {
        const users = await Query(USERS_SQL);
        const open = await Query(`SELECT * FROM tasks WHERE status <> 'Completed'`);
        const stressRows = await Query(`
            SELECT uid, DATEDIFF(CURDATE(), created_at) AS ago, AVG(stress_level) AS stress
            FROM mood_entries
            WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
            GROUP BY uid, ago
        `);

        const rows = users.map(u => {
            const mine = open.filter(t => String(t.uid) === String(u.uid));

            let load = 0, overdue = 0;
            mine.forEach(t => {
                const d = daysLeft(t.deadline);
                if (d != null && d < 0) overdue++;
                load += effortOf(t) * (1 + urgency(d));
            });
            const workload = Math.min(100, Math.round(load / CAPACITY * 100));

            // 7 days, oldest first; null = no entry that day
            const days = Array(7).fill(null);
            stressRows
                .filter(r => String(r.uid) === String(u.uid))
                .forEach(r => { if (r.ago >= 0 && r.ago <= 6) days[6 - r.ago] = Number(Number(r.stress).toFixed(1)); });

            const seen = days.filter(v => v != null);
            const stress = seen.length ? Number(mean(seen).toFixed(1)) : null;

            const heavy = workload >= 70;
            const stressed = stress != null && stress >= 7;
            const status = heavy && stressed ? "overloaded" : (heavy || stressed ? "watch" : "ok");

            return { uid: u.uid, name: u.name, openTasks: mine.length, overdue, workload, stress, days, status };
        });

        res.set("Cache-Control", "no-store");
        res.json({ rows });
    } catch (err) {
        fail(res, err);
    }
});

/* ==========================================================
   ADMIN: ANOMALY DETECTION  (z-score vs the person's own normal)
========================================================== */

adminRouter.get("/api/team/anomalies", requireAdmin, async (req, res) => {
    try {
        const users = await Query(USERS_SQL);
        const anomalies = [];
        const notes = [];

        /* ----- stress: last 3 days vs the 4+ weeks before ----- */
        const sRows = await Query(`
            SELECT uid, DATEDIFF(CURDATE(), created_at) AS ago, AVG(stress_level) AS s
            FROM mood_entries
            WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY uid, ago
        `);

        users.forEach(u => {
            const mine = sRows.filter(r => String(r.uid) === String(u.uid));
            const recent = mine.filter(r => r.ago <= 2).map(r => Number(r.s));
            const base = mine.filter(r => r.ago >= 3).map(r => Number(r.s));
            if (!recent.length || base.length < 7) return;      // not enough history

            const cur = mean(recent);
            const zr = zScore(cur, base, 0.75);
            if (zr && Math.abs(zr.z) >= STRESS_Z) {
                anomalies.push({
                    uid: u.uid, name: u.name, type: "stress",
                    direction: zr.z > 0 ? "up" : "down",
                    z: Number(zr.z.toFixed(2)),
                    current: Number(cur.toFixed(1)), baseline: Number(zr.mean.toFixed(1)),
                    message: `Stress is ${zr.z > 0 ? "much higher" : "much lower"} than usual (${cur.toFixed(1)} vs normal ${zr.mean.toFixed(1)}).`
                });
            }
        });

        /* ----- productivity: tasks completed this week vs previous 4 weeks ----- */
        try {
            const pRows = await Query(`
                SELECT uid, FLOOR(DATEDIFF(CURDATE(), completed_at) / 7) AS wago, COUNT(*) AS n
                FROM tasks
                WHERE status = 'Completed' AND completed_at IS NOT NULL
                  AND completed_at >= DATE_SUB(CURDATE(), INTERVAL 35 DAY)
                GROUP BY uid, wago
            `);

            users.forEach(u => {
                const weeks = [0, 0, 0, 0, 0];   // index = weeks ago
                pRows.filter(r => String(r.uid) === String(u.uid))
                     .forEach(r => { if (r.wago >= 0 && r.wago <= 4) weeks[r.wago] = Number(r.n); });

                const base = weeks.slice(1);
                if (base.every(v => v === 0)) return;           // no history yet

                const zr = zScore(weeks[0], base, 1);
                if (zr && Math.abs(zr.z) >= PRODUCTIVITY_Z) {
                    anomalies.push({
                        uid: u.uid, name: u.name, type: "productivity",
                        direction: zr.z > 0 ? "up" : "down",
                        z: Number(zr.z.toFixed(2)),
                        current: weeks[0], baseline: Number(zr.mean.toFixed(1)),
                        message: `Completed ${weeks[0]} task(s) this week vs a usual ${zr.mean.toFixed(1)}.`
                    });
                }
            });
        } catch (e) {
            notes.push("Productivity check skipped: tasks.completed_at is missing.");
        }

        anomalies.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
        res.set("Cache-Control", "no-store");
        res.json({ anomalies, notes });
    } catch (err) {
        fail(res, err);
    }
});

module.exports = { userRouter, adminRouter };