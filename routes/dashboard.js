const express = require("express");
const router = express.Router();

const { Query } = require("../database/db-helper");
const { getUid } = require("../middleware/current-user");

const MOOD_LABELS = {
    happy: "Happy",
    neutral: "Neutral",
    sad: "Sad",
    stressed: "Stressed",
    frustrated: "Frustrated",
};

/* ==========================================
   DASHBOARD PAGE
========================================== */

router.get("/", (req, res) => {
    res.render("pages/dashboard-page", {
        layout: "layout/main-layout",
        layoutType: "user",
        title: "Dashboard",
        currentPath: req.originalUrl,
        pageStyle: "user/dashboard.css",
        pageScript: "dashboard-script",
    });
});

/* ==========================================
   USER DASHBOARD API
========================================== */

router.get("/api/dashboard", async (req, res) => {
    try {
        const uid = getUid(req);

        /* USER */
        const users = await Query(
            `SELECT name, study_streak, weekly_points, total_points
             FROM users
             WHERE uid = ?
             LIMIT 1`,
            [uid]
        );
        const user = users[0] || {};

        /* TASK COUNTS (one query instead of two) */
        const counts = await Query(
            `SELECT
                IFNULL(SUM(status = 'pending'), 0)   AS pending,
                IFNULL(SUM(status = 'completed'), 0) AS completed
             FROM tasks
             WHERE uid = ?`,
            [uid]
        );

        /* STUDY HOURS */
        const study = await Query(
            `SELECT IFNULL(ROUND(SUM(duration_minutes) / 60, 1), 0) AS studyHours
             FROM study_sessions
             WHERE uid = ?`,
            [uid]
        );

        /* BURNOUT: optional, so a missing metrics table or column
           doesn't take down the whole dashboard */
        let burnoutRisk = "LOW";
        try {
            const burnout = await Query(
                `SELECT burnout_risk
                 FROM metrics
                 WHERE uid = ?
                 ORDER BY day DESC, created_at DESC
                 LIMIT 1`,
                [uid]
            );
            burnoutRisk = burnout[0]?.burnout_risk || "LOW";
        } catch (err) {
            console.warn("Burnout query skipped:", err.message);
        }

        /* LATEST MOOD */
        const moodRows = await Query(
            `SELECT mood
             FROM mood_entries
             WHERE uid = ?
             ORDER BY created_at DESC
             LIMIT 1`,
            [uid]
        );

        const latestMood = moodRows.length
            ? {
                  mood: moodRows[0].mood,
                  label: MOOD_LABELS[moodRows[0].mood] || moodRows[0].mood,
              }
            : null;

        /* RECENT TASKS: pending first, soonest deadline first */
        const tasks = await Query(
            `SELECT title, subject, deadline, status
             FROM tasks
             WHERE uid = ?
             ORDER BY (status = 'completed') ASC,
                      deadline IS NULL ASC,
                      deadline ASC
             LIMIT 5`,
            [uid]
        );

        /* WEEKLY STUDY CHART */
        const chartRows = await Query(
            `SELECT
                DATE(session_date) AS day,
                IFNULL(SUM(duration_minutes), 0) AS minutes
             FROM study_sessions
             WHERE uid = ?
             GROUP BY DATE(session_date)
             ORDER BY DATE(session_date) DESC
             LIMIT 7`,
            [uid]
        );

        chartRows.reverse();

        /* RESPONSE */
        res.json({
            summary: {
                name: user.name || "User",
                study_streak: user.study_streak || 0,
                weekly_points: user.weekly_points || 0,
                total_points: user.total_points || 0,
                pending: Number(counts[0]?.pending || 0),
                completed: Number(counts[0]?.completed || 0),
                studyHours: Number(study[0]?.studyHours || 0),
                burnout: burnoutRisk,
            },

            mood: latestMood,

            tasks,

            chart: {
                labels: chartRows.map((row) =>
                    new Date(row.day).toLocaleDateString("en-US", {
                        weekday: "short",
                    })
                ),
                data: chartRows.map((row) => Number(row.minutes)),
            },
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;