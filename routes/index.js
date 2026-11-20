"use strict";

const express = require("express");
const router = express.Router();
const db = require("../database/db-helper");

router.get("/", async (req, res, next) => {
    try {

        const users = await db.Query("SELECT * FROM users");
        const tasks = await db.Query("SELECT * FROM tasks");
        const moods = await db.Query("SELECT * FROM mood_entries");
        const metrics = await db.Query("SELECT * FROM metrics");

        const stats = {
            totalUsers: users.length,
            totalTasks: tasks.length,
            moodEntries: moods.length,
            studySessions: metrics.length,
            leaderboardEvents: 0
        };

        const moodStats = {
            happy: moods.filter(m => m.mood === "happy").length,
            neutral: moods.filter(m => m.mood === "neutral").length,
            sad: moods.filter(m => m.mood === "sad").length,
            stressed: moods.filter(m => m.mood === "stressed").length,
            frustrated: moods.filter(m => m.mood === "frustrated").length
        };

        const sessionStats = {
            active: 0,
            completed: metrics.length,
            cancelled: 0,
            total: metrics.length,
            averageHours: 0,
            productivity: 0
        };

        res.render("pages/admindashboard-page", {
            title: "Admin Dashboard",

            layout: "layout/main-layout",
            layoutType: "admin",

            pageStyle: "admin-dashboard.css",
            pageScript: "admindashboard-script",

            activeTab: "overview",
            activePage: "dashboard",

            roleName: req.session?.roleName || "Admin",

            stats,
            users,
            tasks,
            moodLogs: moods,
            moodStats,
            sessionLogs: metrics,
            sessionStats
        });

    } catch (err) {
        console.error(err);
        next(err);
    }
});

module.exports = router;