// routes/adminreports.js
// GET /admindashboard/api/reports?from=YYYY-MM-DD&to=YYYY-MM-DD
// Admin-only (the gate in app.js already runs requireLogin + requireRole("admin")).

const express = require("express");
const router = express.Router();
const { Query } = require("../database/db-helper");

/* ==========================================================
   Real schema names (from your project).
   Only change these if a column name differs in your DB.
========================================================== */
const MOOD_SCORE_COLUMN = "mood";          // numeric mood value in mood_entries
const DONE = `COALESCE(LOWER(status), '') IN ('completed', 'done')`;

// Optional: leave admins out of the report, e.g. "AND u.role = 'user'"
const USER_FILTER = "";

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");
const iso = (d) => d.toISOString().slice(0, 10);

router.get("/api/reports", async (req, res) => {
    try {
        // Default range: last 30 days
        const from = isDate(req.query.from)
            ? req.query.from
            : iso(new Date(Date.now() - 29 * 86400000));
        const to = isDate(req.query.to) ? req.query.to : iso(new Date());

        if (from > to) {
            return res.status(400).json({
                success: false,
                message: "'From' date must be before 'To' date."
            });
        }

        const start = `${from} 00:00:00`;
        const end = `${to} 23:59:59`;

        const rows = await Query(`
            SELECT
                u.uid   AS id,
                u.name  AS name,
                u.email AS email,
                COALESCE(t.total, 0)   AS tasksTotal,
                COALESCE(t.done, 0)    AS tasksDone,
                COALESCE(s.minutes, 0) AS workMinutes,
                m.avgMood              AS avgMood
            FROM users u

            LEFT JOIN (
                SELECT uid,
                       COUNT(*) AS total,
                       SUM(CASE WHEN ${DONE} THEN 1 ELSE 0 END) AS done
                FROM tasks
                WHERE created_at BETWEEN ? AND ?
                GROUP BY uid
            ) t ON t.uid = u.uid

            LEFT JOIN (
                SELECT uid,
                       SUM(duration_minutes) AS minutes
                FROM study_sessions
                WHERE ended_at IS NOT NULL
                  AND session_date BETWEEN ? AND ?
                GROUP BY uid
            ) s ON s.uid = u.uid

            LEFT JOIN (
                SELECT uid,
                       AVG(\`${MOOD_SCORE_COLUMN}\`) AS avgMood
                FROM mood_entries
                WHERE created_at BETWEEN ? AND ?
                GROUP BY uid
            ) m ON m.uid = u.uid

            WHERE 1 = 1 ${USER_FILTER}
            ORDER BY tasksDone DESC, workMinutes DESC
        `, [start, end, from, to, start, end]);

        const users = rows.map((r) => ({
            id: r.id,
            name: r.name,
            email: r.email,
            tasksTotal: Number(r.tasksTotal) || 0,
            tasksDone: Number(r.tasksDone) || 0,
            workMinutes: Math.round(Number(r.workMinutes) || 0),
            avgMood: r.avgMood === null ? null : Number(Number(r.avgMood).toFixed(2)),
        }));

        const tasksTotal = users.reduce((a, u) => a + u.tasksTotal, 0);
        const tasksDone = users.reduce((a, u) => a + u.tasksDone, 0);
        const workMinutes = users.reduce((a, u) => a + u.workMinutes, 0);
        const moods = users.filter((u) => u.avgMood !== null);

        res.set("Cache-Control", "no-store");
        res.json({
            success: true,
            range: { from, to },
            summary: {
                totalUsers: users.length,
                activeUsers: users.filter((u) => u.tasksTotal || u.workMinutes).length,
                tasksTotal,
                tasksDone,
                completionRate: tasksTotal ? Math.round((tasksDone / tasksTotal) * 100) : 0,
                workMinutes,
                avgMood: moods.length
                    ? Number((moods.reduce((a, u) => a + u.avgMood, 0) / moods.length).toFixed(2))
                    : null,
            },
            users,
        });
    } catch (err) {
        console.error("Reports error:", err.message);
        res.status(500).json({ success: false, message: "Could not load the report." });
    }
});

module.exports = router;