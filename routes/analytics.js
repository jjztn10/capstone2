const express = require("express");
const router = express.Router();

const { Query } = require("../database/db-helper");
const { getUid, apiError } = require("../middleware/current-user");

/* ==========================================================
   ANALYTICS PAGE
========================================================== */

router.get("/analytics", (req, res) => {
    res.render("pages/analytics-page", {
        layout: "layout/main-layout",
        layoutType: "user",
        title: "Analytics",
        pageStyle: "analytics.css",
        pageScript: "analytics-script",
        currentPath: req.originalUrl,
        user: req.session?.user || null
    });
});

/* ==========================================================
   GET ANALYTICS
========================================================== */

router.get("/api/analytics", async (req, res) => {
    try {
        const uid = getUid(req);

        /* SUMMARY */

        const taskSummary = await Query(`
            SELECT
                COUNT(*) AS total,
                IFNULL(SUM(status = 'completed'), 0) AS completed
            FROM tasks
            WHERE uid = ?
        `, [uid]);

        const studySummary = await Query(`
            SELECT IFNULL(ROUND(SUM(duration_minutes) / 60, 1), 0) AS hours
            FROM study_sessions
            WHERE uid = ?
        `, [uid]);

        const moodSummary = await Query(`
            SELECT IFNULL(ROUND(AVG(stress_level), 1), 0) AS stress
            FROM mood_entries
            WHERE uid = ?
        `, [uid]);

        const total = Number(taskSummary[0]?.total || 0);
        const completed = Number(taskSummary[0]?.completed || 0);
        const productivity = total ? Math.round((completed / total) * 100) : 0;

        /* WEEKLY STUDY (one row per day, last 7 days with sessions) */

        const studyRows = await Query(`
            SELECT
                DATE_FORMAT(session_date, '%b %d') AS label,
                ROUND(SUM(duration_minutes) / 60, 2) AS hours
            FROM study_sessions
            WHERE uid = ?
            GROUP BY session_date
            ORDER BY session_date DESC
            LIMIT 7
        `, [uid]);

        studyRows.reverse();

        const study = studyRows.map((row) => ({
            label: row.label,
            hours: Number(row.hours)
        }));

        /* TASK STATUS */

        const tasks = {
            completed,
            pending: total - completed,
            inProgress: 0
        };

        /* MOOD TREND */

        const moodRows = await Query(`
            SELECT DATE_FORMAT(created_at, '%b %d') AS label, mood
            FROM mood_entries
            WHERE uid = ?
            ORDER BY created_at DESC
            LIMIT 7
        `, [uid]);

        moodRows.reverse();

        const moodScore = { happy: 5, neutral: 4, sad: 3, stressed: 2, frustrated: 1 };

        const moods = moodRows.map((row) => ({
            label: row.label,
            score: moodScore[row.mood] || 0
        }));

        /* WORKLOAD */

        const workload = await Query(`
            SELECT DATE_FORMAT(created_at, '%b %d') AS label, workload AS value
            FROM mood_entries
            WHERE uid = ?
            ORDER BY created_at DESC
            LIMIT 7
        `, [uid]);

        workload.reverse();

        res.set("Cache-Control", "no-store");
        res.json({
            summary: {
                productivity,
                studyHours: Number(studySummary[0]?.hours || 0),
                completedTasks: completed,
                averageStress: Number(moodSummary[0]?.stress || 0)
            },
            study,
            tasks,
            moods,
            workload
        });
    } catch (err) {
        apiError(res, err);
    }
});

module.exports = router;