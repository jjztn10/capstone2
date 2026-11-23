const express = require("express");
const router = express.Router();

const { Query } = require("../database/db-helper");

/* ==========================================================
   LEADERBOARD PAGE
========================================================== */

router.get("/leaderboard", (req, res) => {

    // Remove this temporarily while testing
    // if (!req.session.user) {
    //     return res.redirect("/");
    // }

    res.render("pages/leaderboard-page", {
        layout: "layout/main-layout",
        layoutType: "user",
        title: "Leaderboard",
        pageStyle: "leaderboard.css",
        pageScript: "leaderboard-script",
        currentPath: req.originalUrl,
        user: req.session.user || null
    });

});

/* ==========================================
   GET LEADERBOARD
========================================== */

router.get("/api/leaderboard", async (req, res) => {

    try {

        const users = await Query(`
            SELECT
                u.uid,
                u.name,
                u.email,
                u.total_points,
                IFNULL(t.completedTasks,0) completedTasks,
                IFNULL(s.studyHours,0) studyHours,
                CASE
                    WHEN IFNULL(t.totalTasks,0)=0
                    THEN 0
                    ELSE ROUND((t.completedTasks/t.totalTasks)*100)
                END productivity
            FROM users u
            LEFT JOIN (
                SELECT
                    uid,
                    COUNT(*) totalTasks,
                    SUM(status='completed') completedTasks
                FROM tasks
                GROUP BY uid
            ) t ON u.uid=t.uid
            LEFT JOIN (
                SELECT
                    uid,
                    ROUND(SUM(duration_minutes)/60,1) studyHours
                FROM study_sessions
                GROUP BY uid
            ) s ON u.uid=s.uid
            ORDER BY
                productivity DESC,
                studyHours DESC,
                completedTasks DESC,
                u.total_points DESC,
                u.name ASC
        `);

        res.json({
            users
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: err.message
        });

    }

});

module.exports = router;