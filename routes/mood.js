const express = require("express");
const router = express.Router();

const { Query } = require("../database/db-helper");
const { getUid } = require("../middleware/current-user");

const VALID_MOODS = ["happy", "neutral", "sad", "stressed", "frustrated"];

/* ==========================================================
   MOOD PAGE
========================================================== */

router.get("/mood", (req, res) => {
    res.render("pages/mood-page", {
        layout: "layout/main-layout",
        layoutType: "user",
        title: "Mood",
        pageStyle: "mood.css",
        pageScript: "mood-script",
        currentPath: req.originalUrl,
        user: req.session?.user || null
    });
});

/* ==========================================================
   GET MOOD DATA
========================================================== */

router.get("/api/mood", async (req, res) => {
    try {
        const uid = getUid(req);

        const entries = await Query(`
            SELECT mood_id, mood, stress_level, workload, notes, created_at
            FROM mood_entries
            WHERE uid = ?
            ORDER BY created_at DESC
            LIMIT 100
        `, [uid]);

        const count = await Query(`
            SELECT COUNT(*) AS total
            FROM mood_entries
            WHERE uid = ?
        `, [uid]);

        const today = await Query(`
            SELECT mood, stress_level
            FROM mood_entries
            WHERE uid = ?
            AND DATE(created_at) = CURDATE()
            ORDER BY created_at DESC
            LIMIT 1
        `, [uid]);

        res.json({
            entries,
            summary: {
                mood: today.length ? today[0].mood : null,
                stress: today.length ? today[0].stress_level : 0,
                totalEntries: Number(count[0]?.total || 0)
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

/* ==========================================================
   SAVE MOOD ENTRY
========================================================== */

router.post("/api/mood", async (req, res) => {
    try {
        const uid = getUid(req);

        const { mood, stress_level, workload, notes } = req.body;

        const stress = Number(stress_level);
        const load = Number(workload);

        if (!VALID_MOODS.includes(mood)) {
            return res.status(400).json({ error: "Invalid mood." });
        }

        if (!(stress >= 1 && stress <= 10) || !(load >= 1 && load <= 10)) {
            return res.status(400).json({ error: "Stress and workload must be 1-10." });
        }

        await Query(`
            INSERT INTO mood_entries
                (uid, mood, stress_level, workload, notes, created_at)
            VALUES (?, ?, ?, ?, ?, NOW())
        `, [uid, mood, stress, load, String(notes || "").slice(0, 500)]);

        res.status(201).json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;