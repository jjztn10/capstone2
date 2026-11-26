const express = require("express");
const { Query } = require("../database/db-helper");
const { getUid, apiError } = require("../middleware/current-user");
const E = require("../services/predict-engine");

const userRouter = express.Router();
const adminRouter = express.Router();

/* ---------- settings: adjust to your schema ---------- */
// Every row in `users` is a regular user (admins live in master_users)
const USERS_SQL = `SELECT uid, name FROM users`;

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

// share of finished tasks (with a deadline) that were done on time
// null when there is not enough history yet
async function onTimeRateFor(uid) {
    try {
        const rows = await Query(`
            SELECT COUNT(*) AS total,
                   SUM(DATE(completed_at) <= DATE(deadline)) AS ontime
            FROM tasks
            WHERE uid = ? AND status = 'Completed'
              AND deadline IS NOT NULL AND completed_at IS NOT NULL
        `, [uid]);

        const total = Number(rows[0]?.total || 0);
        return total >= 3 ? Number(rows[0].ontime || 0) / total : null;
    } catch (e) {
        return null;      // tasks.completed_at missing
    }
}

/* ==========================================================
   USER: STRESS FORECAST + OVERDUE RISK + NEXT-WEEK LOAD
========================================================== */

userRouter.get("/api/forecast", async (req, res) => {
    try {
        const uid = getUid(req);

        const [open, sRows, rate] = await Promise.all([
            Query(`SELECT * FROM tasks WHERE uid = ? AND status <> 'Completed'`, [uid]),
            Query(`
                SELECT DATEDIFF(CURDATE(), created_at) AS ago, AVG(stress_level) AS s
                FROM mood_entries
                WHERE uid = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
                GROUP BY ago
                ORDER BY ago DESC
            `, [uid]),
            onTimeRateFor(uid)
        ]);

        const points = sRows.map(r => ({ x: -Number(r.ago), y: Number(r.s) }));
        const todayRow = sRows.find(r => Number(r.ago) === 0);
        const stress = todayRow ? Number(todayRow.s) : null;

        const risks = open
            .map(t => ({ t, r: E.overdueRisk(t, { open, onTimeRate: rate, stress }) }))
            .filter(x => x.r)
            // the tasks table's key is `id` (task_id only exists as an alias elsewhere)
            .map(({ t, r }) => ({ task_id: t.id ?? t.task_id, title: t.title, ...r }))
            .sort((a, b) => b.risk - a.risk);

        res.set("Cache-Control", "no-store");
        res.json({
            stress: E.forecastStress(points, 3),
            risks,
            week: E.weekLoad(open, stress),
            onTimeRate: rate == null ? null : Number(rate.toFixed(2))
        });
    } catch (err) {
        apiError(res, err);
    }
});

/* ==========================================================
   ADMIN: RECOMMENDED ASSIGNEE
   body: { subject, priority, effort, deadline }
========================================================== */

adminRouter.post("/api/team/recommend", requireAdmin, async (req, res) => {
    try {
        const b = req.body || {};
        const task = {
            task_id: "new",
            subject: String(b.subject || "").trim().slice(0, 120),
            priority: String(b.priority || "Medium"),
            effort: E.clamp(Number(b.effort) || 3, 1, 5),
            deadline: b.deadline || null
        };

        const [users, open, stressRows] = await Promise.all([
            Query(USERS_SQL),
            Query(`SELECT * FROM tasks WHERE status <> 'Completed'`),
            Query(`
                SELECT uid, AVG(stress_level) AS s
                FROM mood_entries
                WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
                GROUP BY uid
            `)
        ]);

        let otRows = [];
        let subRows = [];

        try {
            otRows = await Query(`
                SELECT uid, COUNT(*) AS total,
                       SUM(DATE(completed_at) <= DATE(deadline)) AS ontime
                FROM tasks
                WHERE status = 'Completed' AND deadline IS NOT NULL AND completed_at IS NOT NULL
                GROUP BY uid
            `);
        } catch (e) { /* completed_at missing: on-time history unknown */ }

        try {
            subRows = await Query(`
                SELECT uid, LOWER(TRIM(subject)) AS subject, COUNT(*) AS n
                FROM tasks
                WHERE status = 'Completed' AND subject IS NOT NULL AND subject <> ''
                GROUP BY uid, LOWER(TRIM(subject))
            `);
        } catch (e) { /* ignore */ }

        const wanted = task.subject.toLowerCase();

        const ranked = users.map(u => {
            const id = String(u.uid);
            const mine = open.filter(t => String(t.uid) === id);

            const sr = stressRows.find(r => String(r.uid) === id);
            const stress = sr ? Number(Number(sr.s).toFixed(1)) : null;

            const ot = otRows.find(r => String(r.uid) === id);
            const total = Number(ot?.total || 0);
            const onTimeRate = total >= 3 ? Number(ot.ontime || 0) / total : null;

            const sub = wanted
                ? subRows.find(r => String(r.uid) === id && r.subject === wanted)
                : null;

            const candidate = {
                uid: u.uid,
                name: u.name,
                openCount: mine.length,
                openEffort: mine.reduce((s, t) => s + E.effortOf(t), 0),
                stress,
                onTimeRate,
                subjectDone: Number(sub?.n || 0)
            };

            const fit = E.scoreAssignee(candidate, task);

            // would the new task be late on THIS person's schedule?
            const late = task.deadline
                ? E.overdueRisk(task, { open: mine.concat(task), onTimeRate, stress })
                : null;

            return {
                uid: u.uid,
                name: u.name,
                fit: fit.fit,
                reasons: fit.reasons,
                warnings: fit.warnings,
                openTasks: candidate.openCount,
                stress,
                onTimeRate: onTimeRate == null ? null : Math.round(onTimeRate * 100),
                subjectDone: candidate.subjectDone,
                lateRisk: late ? late.risk : null
            };
        }).sort((a, b) => b.fit - a.fit);

        res.set("Cache-Control", "no-store");
        res.json({ recommended: ranked[0] || null, ranked });
    } catch (err) {
        apiError(res, err);
    }
});

module.exports = { userRouter, adminRouter };