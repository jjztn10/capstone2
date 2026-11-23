const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const { Query } = require("../database/db-helper");
const { getUid } = require("../middleware/current-user");

/* ==========================================================
   HELPERS
   priority is stored in priority_score:
   Low = 25, Medium = 50, High = 75  (read back by range)
========================================================== */

const PRIORITY_TO_SCORE = { Low: 25, Medium: 50, High: 75 };

// UI label -> DB enum value ("Overdue" is calculated, never stored)
const STATUS_TO_DB = {
    "Pending": "pending",
    "In Progress": "in_progress",   // needs the enum change, see notes
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

function clean(body = {}) {
    const title = String(body.title ?? "").trim().slice(0, 255);
    if (!title) return { error: "Title is required." };

    const priority = PRIORITY_TO_SCORE[body.priority] ? body.priority : "Medium";

    const deadline = /^\d{4}-\d{2}-\d{2}/.test(body.deadline || "")
        ? String(body.deadline).slice(0, 10)
        : null;

    return {
        data: {
            title,
            subject: String(body.subject ?? "").trim().slice(0, 120) || null,
            description: String(body.description ?? "").trim() || null,
            priority,
            score: PRIORITY_TO_SCORE[priority],
            status: STATUS_TO_DB[body.status] || "pending",
            deadline
        }
    };
}

const fail = (res, err) => {
    console.error(err);
    res.status(500).json({ error: err.message });
};

/* ==========================================================
   TASKS PAGE
========================================================== */

router.get("/tasks", (req, res) => {
    res.render("pages/tasks-page", {
        layout: "layout/main-layout",
        layoutType: "user",
        title: "Tasks",
        pageStyle: "tasks.css",
        pageScript: "tasks-script",
        currentPath: req.originalUrl,
        user: req.session?.user || null
    });
});

/* ==========================================================
   GET ALL TASKS
========================================================== */

router.get("/api/tasks", async (req, res) => {
    try {
        const uid = getUid(req);
console.log("TASK uid =", uid, typeof uid);
        const tasks = await Query(`
            SELECT
                id AS task_id,
                title,
                subject,
                description,
                ${PRIORITY_LABEL_SQL} AS priority,
                DATE_FORMAT(deadline, '%Y-%m-%d') AS deadline,
                CASE
                    WHEN status = 'completed' THEN 'Completed'
                    WHEN deadline IS NOT NULL
                         AND DATE(deadline) < CURDATE() THEN 'Overdue'
                    WHEN status = 'in_progress' THEN 'In Progress'
                    ELSE 'Pending'
                END AS status
            FROM tasks
            WHERE uid = ?
            ORDER BY status = 'completed', deadline IS NULL, deadline ASC, created_at DESC
        `, [uid]);

        res.json({ tasks });
    } catch (err) {
        fail(res, err);
    }
});

/* ==========================================================
   ADD TASK
========================================================== */

router.post("/api/tasks", async (req, res) => {
    try {
        const uid = getUid(req);

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
        fail(res, err);
    }
});

/* ==========================================================
   COMPLETE TASK  (must come before /api/tasks/:id)
========================================================== */

router.put("/api/tasks/:id/complete", async (req, res) => {
    try {
        const uid = getUid(req);

        await Query(`
            UPDATE tasks
            SET status = 'completed'
            WHERE id = ? AND uid = ?
        `, [req.params.id, uid]);

        res.json({ success: true });
    } catch (err) {
        fail(res, err);
    }
});

/* ==========================================================
   UPDATE TASK
   priority_score is only overwritten when the priority level
   actually changed, so calculated scores are preserved.
========================================================== */

router.put("/api/tasks/:id", async (req, res) => {
    try {
        const uid = getUid(req);

        const { data, error } = clean(req.body);
        if (error) return res.status(400).json({ error });

        await Query(`
            UPDATE tasks
            SET title = ?,
                subject = ?,
                description = ?,
                priority_score = IF(? = (${PRIORITY_LABEL_SQL}), priority_score, ?),
                status = ?,
                deadline = ?
            WHERE id = ? AND uid = ?
        `, [
            data.title,
            data.subject,
            data.description,
            data.priority,
            data.score,
            data.status,
            data.deadline,
            req.params.id,
            uid
        ]);

        res.json({ success: true });
    } catch (err) {
        fail(res, err);
    }
});

/* ==========================================================
   DELETE TASK
========================================================== */

router.delete("/api/tasks/:id", async (req, res) => {
    try {
        const uid = getUid(req);

        await Query(`
            DELETE FROM tasks
            WHERE id = ? AND uid = ?
        `, [req.params.id, uid]);

        res.json({ success: true });
    } catch (err) {
        fail(res, err);
    }
});

module.exports = router;