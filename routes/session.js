const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const { Query } = require("../database/db-helper");
const { getUid, apiError } = require("../middleware/current-user");

/* ==========================================================
   HELPERS
========================================================== */

// A task is available for a session if it is not finished.
// (Accepts 'pending', 'in progress', NULL, etc. - anything not completed.)
const OPEN_TASK = `(status IS NULL OR LOWER(status) NOT IN ('completed', 'done', 'cancelled'))`;

// Looks up the real primary key of study_sessions once (name + whether
// it is AUTO_INCREMENT), so the queries don't depend on a guessed name.
let meta = null;

async function getMeta() {
    if (meta) return meta;

    const rows = await Query(`
        SELECT COLUMN_NAME AS name, EXTRA AS extra
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'study_sessions'
          AND COLUMN_KEY = 'PRI'
        LIMIT 1
    `);

    const col = rows?.[0];

    if (!col || !/^\w+$/.test(col.name)) {
        throw new Error("study_sessions has no usable primary key column.");
    }

    meta = {
        pk: col.name,
        auto: /auto_increment/i.test(col.extra || "")
    };

    return meta;
}

/* ==========================================================
   STUDY SESSION PAGE
========================================================== */

router.get("/session", (req, res) => {
    res.render("pages/session-page", {
        layout: "layout/main-layout",
        layoutType: "user",
        title: "Study Session",
        pageStyle: "session.css",
        pageScript: "session-script",
        currentPath: req.originalUrl,
        user: req.session?.user || null
    });
});

/* ==========================================================
   GET SESSION DASHBOARD
========================================================== */

router.get("/api/session", async (req, res) => {
    try {
        const uid = getUid(req);
        const { pk } = await getMeta();

        const sessions = await Query(`
            SELECT
                s.\`${pk}\` AS session_id,
                s.task_id,
                t.title AS task_title,
                DATE_FORMAT(s.session_date, '%Y-%m-%d') AS session_date,
                s.started_at,
                s.ended_at,
                s.duration_minutes,
                CASE WHEN s.ended_at IS NULL THEN 'Running' ELSE 'Completed' END AS status
            FROM study_sessions s
            LEFT JOIN tasks t ON t.id = s.task_id
            WHERE s.uid = ?
            ORDER BY s.started_at DESC
        `, [uid]);

        // only finished sessions count toward totals
        const summary = await Query(`
            SELECT
                COUNT(*) AS totalSessions,
                IFNULL(ROUND(AVG(duration_minutes), 0), 0) AS averageMinutes,
                IFNULL(ROUND(SUM(
                    CASE WHEN session_date = CURDATE()
                         THEN duration_minutes ELSE 0 END
                ), 0), 0) AS todayMinutes,
                IFNULL(ROUND(SUM(
                    CASE WHEN YEARWEEK(session_date, 1) = YEARWEEK(CURDATE(), 1)
                         THEN duration_minutes ELSE 0 END
                ) / 60, 1), 0) AS weekHours
            FROM study_sessions
            WHERE uid = ? AND ended_at IS NOT NULL
        `, [uid]);

        res.set("Cache-Control", "no-store");
        res.json({ sessions, summary: summary[0] });
    } catch (err) {
        apiError(res, err);
    }
});

/* ==========================================================
   AVAILABLE TASKS (for the picker)
========================================================== */

router.get("/api/session/tasks", async (req, res) => {
    try {
        const uid = getUid(req);

        const tasks = await Query(`
            SELECT id, title, subject
            FROM tasks
            WHERE uid = ? AND ${OPEN_TASK}
            ORDER BY priority_score DESC, deadline ASC
        `, [uid]);

        res.set("Cache-Control", "no-store");
        res.json({ tasks });
    } catch (err) {
        apiError(res, err);
    }
});

/* ==========================================================
   START SESSION  (a task is required)
========================================================== */

router.post("/api/session/start", async (req, res) => {
    try {
        const uid = getUid(req);
        const { pk, auto } = await getMeta();
        const { task_id } = req.body || {};

        // already running? hand that one back instead of creating another
        const running = await Query(`
            SELECT \`${pk}\` AS session_id
            FROM study_sessions
            WHERE uid = ? AND ended_at IS NULL
            ORDER BY started_at DESC
            LIMIT 1
        `, [uid]);

        if (running.length) {
            return res.json({
                success: true,
                resumed: true,
                session_id: running[0].session_id
            });
        }

        if (!task_id) {
            return res.status(400).json({ error: "Please choose a task first." });
        }

        const task = await Query(`
            SELECT id
            FROM tasks
            WHERE id = ? AND uid = ? AND ${OPEN_TASK}
            LIMIT 1
        `, [task_id, uid]);

        if (!task.length) {
            return res.status(400).json({ error: "That task is not available." });
        }

        // duration_minutes is NOT NULL with no default, so start at 0
        if (!auto) {
            const id = crypto.randomUUID();

            await Query(`
                INSERT INTO study_sessions
                    (\`${pk}\`, uid, task_id, duration_minutes, session_date, started_at)
                VALUES (?, ?, ?, 0, CURDATE(), NOW())
            `, [id, uid, task_id]);

            return res.status(201).json({ success: true, session_id: id });
        }

        await Query(`
            INSERT INTO study_sessions
                (uid, task_id, duration_minutes, session_date, started_at)
            VALUES (?, ?, 0, CURDATE(), NOW())
        `, [uid, task_id]);

        const created = await Query(`
            SELECT \`${pk}\` AS session_id
            FROM study_sessions
            WHERE uid = ? AND ended_at IS NULL
            ORDER BY started_at DESC
            LIMIT 1
        `, [uid]);

        res.status(201).json({ success: true, session_id: created[0]?.session_id });
    } catch (err) {
        apiError(res, err);
    }
});

/* ==========================================================
   STOP SESSION
========================================================== */

router.put("/api/session/stop", async (req, res) => {
    try {
        const uid = getUid(req);
        const { pk } = await getMeta();
        const { session_id } = req.body || {};

        if (!session_id) {
            return res.status(400).json({ error: "session_id is required." });
        }

        // find the running session (and its task) first
        const running = await Query(`
            SELECT task_id
            FROM study_sessions
            WHERE \`${pk}\` = ? AND uid = ? AND ended_at IS NULL
            LIMIT 1
        `, [session_id, uid]);

        if (!running.length) {
            return res.status(404).json({ error: "No running session found." });
        }

        await Query(`
            UPDATE study_sessions
            SET ended_at = NOW(),
                duration_minutes = ROUND(TIMESTAMPDIFF(SECOND, started_at, NOW()) / 60, 2)
            WHERE \`${pk}\` = ? AND uid = ? AND ended_at IS NULL
        `, [session_id, uid]);

        // ending the session completes its task automatically
        // (if your tasks table has a completed_at column, add: , completed_at = NOW())
        if (running[0].task_id) {
            await Query(`
                UPDATE tasks
                SET status = 'completed'
                WHERE id = ? AND uid = ?
            `, [running[0].task_id, uid]);
        }

        res.json({ success: true, task_completed: !!running[0].task_id });
    } catch (err) {
        apiError(res, err);
    }
});

module.exports = router;