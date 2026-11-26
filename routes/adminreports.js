// routes/adminreports.js
// GET /admindashboard/api/reports?from=YYYY-MM-DD&to=YYYY-MM-DD
// Admin-only (the gate in app.js already runs requireLogin + requireRole("admin")).

const express = require("express");
const router = express.Router();
const db = require("../database/config/db");

/* ==========================================================
   !!  CHANGE THESE TO MATCH YOUR DATABASE  !!
   I could not see your schema, so these names are guesses.
   Everything the report needs is listed here, in one place.
========================================================== */
const T = {
    users:    { table: "users",         id: "id", name: "fullname", email: "email" },
    tasks:    { table: "tasks",         userId: "user_id", status: "status", doneValue: "completed", createdAt: "created_at" },
    sessions: { table: "work_sessions", userId: "user_id", startedAt: "started_at", endedAt: "ended_at" },
    moods:    { table: "mood_logs",     userId: "user_id", score: "mood_score", createdAt: "created_at" },

    // Optional: leave admins out of the report, e.g. "AND u.role = 'user'"
    userFilter: "",
};

// mysql2 promise pool: db.pool, or db itself exposing .query()
const runner = db.pool || db;

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");

router.get("/api/reports", async (req, res) => {
    try {
        // Default range: last 30 days
        const today = new Date();
        const past = new Date(Date.now() - 29 * 86400000);
        const iso = (d) => d.toISOString().slice(0, 10);

        const from = isDate(req.query.from) ? req.query.from : iso(past);
        const to = isDate(req.query.to) ? req.query.to : iso(today);

        if (from > to) {
            return res.status(400).json({ success: false, message: "'From' date must be before 'To' date." });
        }

        const start = `${from} 00:00:00`;
        const end = `${to} 23:59:59`;

        const sql = `
            SELECT
                u.${T.users.id}    AS id,
                u.${T.users.name}  AS name,
                u.${T.users.email} AS email,
                COALESCE(t.total, 0)   AS tasksTotal,
                COALESCE(t.done, 0)    AS tasksDone,
                COALESCE(s.minutes, 0) AS workMinutes,
                m.avgMood              AS avgMood
            FROM ${T.users.table} u
            LEFT JOIN (
                SELECT ${T.tasks.userId} AS uid,
                       COUNT(*) AS total,
                       SUM(${T.tasks.status} = ?) AS done
                FROM ${T.tasks.table}
                WHERE ${T.tasks.createdAt} BETWEEN ? AND ?
                GROUP BY ${T.tasks.userId}
            ) t ON t.uid = u.${T.users.id}
            LEFT JOIN (
                SELECT ${T.sessions.userId} AS uid,
                       SUM(TIMESTAMPDIFF(MINUTE, ${T.sessions.startedAt}, ${T.sessions.endedAt})) AS minutes
                FROM ${T.sessions.table}
                WHERE ${T.sessions.endedAt} IS NOT NULL
                  AND ${T.sessions.startedAt} BETWEEN ? AND ?
                GROUP BY ${T.sessions.userId}
            ) s ON s.uid = u.${T.users.id}
            LEFT JOIN (
                SELECT ${T.moods.userId} AS uid,
                       AVG(${T.moods.score}) AS avgMood
                FROM ${T.moods.table}
                WHERE ${T.moods.createdAt} BETWEEN ? AND ?
                GROUP BY ${T.moods.userId}
            ) m ON m.uid = u.${T.users.id}
            WHERE 1 = 1 ${T.userFilter}
            ORDER BY tasksDone DESC, workMinutes DESC
        `;

        const params = [T.tasks.doneValue, start, end, start, end, start, end];
        const [rows] = await runner.query(sql, params);

        const users = rows.map((r) => ({
            id: r.id,
            name: r.name,
            email: r.email,
            tasksTotal: Number(r.tasksTotal) || 0,
            tasksDone: Number(r.tasksDone) || 0,
            workMinutes: Number(r.workMinutes) || 0,
            avgMood: r.avgMood === null ? null : Number(Number(r.avgMood).toFixed(2)),
        }));

        const tasksTotal = users.reduce((a, u) => a + u.tasksTotal, 0);
        const tasksDone = users.reduce((a, u) => a + u.tasksDone, 0);
        const workMinutes = users.reduce((a, u) => a + u.workMinutes, 0);
        const moods = users.filter((u) => u.avgMood !== null);

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