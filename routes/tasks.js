const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const { Query } = require("../database/db-helper");
const { getUid, apiError } = require("../middleware/current-user");

/* ==========================================================
   HELPERS
   priority is stored in priority_score:
   Low = 25, Medium = 50, High = 75  (read back by range)
========================================================== */

const PRIORITY_TO_SCORE = { Low: 25, Medium: 50, High: 75 };

// UI label -> DB enum value ("Overdue" is calculated, never stored)
const STATUS_TO_DB = {
    "Pending": "pending",
    "In Progress": "in_progress",   // needs the enum change (see SQL notes)
    "Completed": "completed",
    "Overdue": "pending"
};

const PRIORITY_LABEL_SQL = `
    CASE
        WHEN priority_score >= 67 THEN 'High'
        WHEN priority_score >= 34 THEN 'Medium'
        ELSE 'Low'
    END
`;

/* Deadline in, "YYYY-MM-DD HH:mm:ss" out (or null).
   Accepts:  2026-11-28
             2026-11-28 15:30        2026-11-28T15:30
             2026-11-28 15:30:00     2026-11-28T15:30:00
   A date without a time is saved as midnight (00:00:00). */
function cleanDeadline(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(value ?? "").trim());
    if (!m) return null;

    const [, y, mo, d, h = "00", mi = "00", s = "00"] = m;

    if (Number(mo) < 1 || Number(mo) > 12) return null;
    if (Number(d) < 1 || Number(d) > 31) return null;
    if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;

    return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

function clean(body = {}) {
    const title = String(body.title ?? "").trim().slice(0, 255);
    if (!title) return { error: "Title is required." };

    const priority = PRIORITY_TO_SCORE[body.priority] ? body.priority : "Medium";

    return {
        data: {
            title,
            subject: String(body.subject ?? "").trim().slice(0, 120) || null,
            description: String(body.description ?? "").trim() || null,
            priority,
            score: PRIORITY_TO_SCORE[priority],
            status: STATUS_TO_DB[body.status] || "pending",
            deadline: cleanDeadline(body.deadline)
        }
    };
}

// Every API route needs a logged-in user. Returns the uid, or sends 401.
function requireUid(req, res) {
    try {
        return getUid(req);
    } catch (err) {
        res.status(401).json({ error: "Please log in again." });
        return null;
    }
}

// The smart panels (on-time rate, productivity) need tasks.completed_at.
// Fill it only if that column exists, so nothing breaks if it doesn't.
let hasCompletedAt = null;
async function supportsCompletedAt() {
    if (hasCompletedAt === null) {
        const rows = await Query(`
            SELECT COUNT(*) AS n
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'tasks'
              AND COLUMN_NAME = 'completed_at'
        `);
        hasCompletedAt = Number(rows[0]?.n || 0) > 0;
    }
    return hasCompletedAt;
}

/* ==========================================================
   TASKS PAGE
========================================================== */

router.get("/tasks", (req, res) => {
    res.render("pages/tasks-page", {
        layout: "layout/main-layout",
        layoutType: "user",
        title: "Tasks",
        pageScript: "tasks-script",
        currentPath: req.originalUrl,
        user: req.session?.user || null
    });
});

/* ==========================================================
   GET ALL TASKS

   deadline is returned as "YYYY-MM-DDTHH:mm:ss" with no time zone
   letter, so the browser reads it as the same local time that was
   saved (no shifting by hours).

   Overdue:
   - deadline on an earlier day, or
   - deadline has a real time (not midnight) and that time has passed.
   A deadline at exactly 00:00:00 is treated as "date only", so it
   stays Pending for the whole day.
========================================================== */

router.get("/api/tasks", async (req, res) => {
    try {
        const uid = requireUid(req, res);
        if (uid === null) return;

        // tasks.status / tasks.deadline are qualified on purpose: inside
        // ORDER BY an unqualified "status" would mean the computed alias.
        const tasks = await Query(`
            SELECT
                tasks.id AS task_id,
                tasks.title,
                tasks.subject,
                tasks.description,
                ${PRIORITY_LABEL_SQL} AS priority,
                DATE_FORMAT(tasks.deadline, '%Y-%m-%dT%H:%i:%s') AS deadline,
                CASE
                    WHEN tasks.status = 'completed' THEN 'Completed'
                    WHEN tasks.deadline IS NOT NULL AND (
                            DATE(tasks.deadline) < CURDATE()
                            OR (TIME(tasks.deadline) <> '00:00:00' AND tasks.deadline < NOW())
                         ) THEN 'Overdue'
                    WHEN tasks.status = 'in_progress' THEN 'In Progress'
                    ELSE 'Pending'
                END AS status
            FROM tasks
            WHERE tasks.uid = ?
            ORDER BY (tasks.status = 'completed'),
                     (tasks.deadline IS NULL),
                     tasks.deadline ASC,
                     tasks.created_at DESC
        `, [uid]);

        res.set("Cache-Control", "no-store");
        res.json({ tasks });
    } catch (err) {
        apiError(res, err);
    }
});

/* ==========================================================
   ADD TASK
========================================================== */

router.post("/api/tasks", async (req, res) => {
    try {
        const uid = requireUid(req, res);
        if (uid === null) return;

        const { data, error } = clean(req.body);
        if (error) return res.status(400).json({ error });

        const id = crypto.randomUUID();   // id is char(36) with no default

        await Query(`
            INSERT INTO tasks
                (id, uid, title, subject, description, priority_score, status, deadline, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
            id,
            uid,
            data.title,
            data.subject,
            data.description,
            data.score,
            data.status,
            data.deadline
        ]);

        res.status(201).json({ success: true, task_id: id });
    } catch (err) {
        apiError(res, err);
    }
});

/* ==========================================================
   COMPLETE TASK
========================================================== */

router.put("/api/tasks/:id/complete", async (req, res) => {
    try {
        const uid = requireUid(req, res);
        if (uid === null) return;

        const stamp = (await supportsCompletedAt())
            ? ", completed_at = COALESCE(completed_at, NOW())"
            : "";

        const result = await Query(`
            UPDATE tasks
            SET status = 'completed'${stamp}
            WHERE id = ? AND uid = ?
        `, [req.params.id, uid]);

        if (!result.affectedRows) {
            return res.status(404).json({ error: "Task not found." });
        }

        res.json({ success: true });
    } catch (err) {
        apiError(res, err);
    }
});

/* ==========================================================
   UPDATE TASK
   priority_score is only overwritten when the priority level
   actually changed, so calculated scores are preserved.
========================================================== */

router.put("/api/tasks/:id", async (req, res) => {
    try {
        const uid = requireUid(req, res);
        if (uid === null) return;

        const { data, error } = clean(req.body);
        if (error) return res.status(400).json({ error });

        const stamped = await supportsCompletedAt();
        const stampSql = stamped
            ? `, completed_at = IF(? = 'completed', COALESCE(completed_at, NOW()), NULL)`
            : "";

        const params = [
            data.title,
            data.subject,
            data.description,
            data.priority,
            data.score,
            data.status,
            data.deadline
        ];
        if (stamped) params.push(data.status);
        params.push(req.params.id, uid);

        const result = await Query(`
            UPDATE tasks
            SET title = ?,
                subject = ?,
                description = ?,
                priority_score = IF(? = (${PRIORITY_LABEL_SQL}), priority_score, ?),
                status = ?,
                deadline = ?${stampSql}
            WHERE id = ? AND uid = ?
        `, params);

        if (!result.affectedRows) {
            return res.status(404).json({ error: "Task not found." });
        }

        res.json({ success: true });
    } catch (err) {
        apiError(res, err);
    }
});

/* ==========================================================
   DELETE TASK
========================================================== */

router.delete("/api/tasks/:id", async (req, res) => {
    try {
        const uid = requireUid(req, res);
        if (uid === null) return;

        const result = await Query(`
            DELETE FROM tasks
            WHERE id = ? AND uid = ?
        `, [req.params.id, uid]);

        if (!result.affectedRows) {
            return res.status(404).json({ error: "Task not found." });
        }

        res.json({ success: true });
    } catch (err) {
        apiError(res, err);
    }
});

module.exports = router;