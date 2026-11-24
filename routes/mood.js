const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const { Query } = require("../database/db-helper");
const { getUid } = require("../middleware/current-user");

const VALID_MOODS = ["happy", "neutral", "sad", "stressed", "frustrated"];

/* ==========================================================
   HELPERS
========================================================== */

// Reads mood_entries' structure once: primary key (name + whether it is
// AUTO_INCREMENT) and the list of columns, so the queries adapt to the
// real table instead of guessed names.
let meta = null;

async function getMeta() {
    if (meta) return meta;

    const cols = await Query(`
        SELECT COLUMN_NAME AS name, COLUMN_KEY AS ckey, EXTRA AS extra
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'mood_entries'
    `);

    const pkCol = cols.find(c => c.ckey === "PRI");

    if (!pkCol || !/^\w+$/.test(pkCol.name)) {
        throw new Error("mood_entries has no usable primary key column.");
    }

    meta = {
        pk: pkCol.name,
        auto: /auto_increment/i.test(pkCol.extra || ""),
        columns: new Set(cols.map(c => c.name))
    };

    return meta;
}

// latest entry logged today (server date), or null
async function getTodayEntry(uid) {
    const rows = await Query(`
        SELECT mood, stress_level
        FROM mood_entries
        WHERE uid = ?
          AND DATE(created_at) = CURDATE()
        ORDER BY created_at DESC
        LIMIT 1
    `, [uid]);

    return rows[0] || null;
}

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
   DAILY CHECK-IN STATUS  (used by the login popup)
========================================================== */

router.get("/api/mood", async (req, res) => {
    try {
        const uid = getUid(req);
        const { pk } = await getMeta();

        // graph window: 7 to 90 days (a clean integer, safe to inline)
        const days = Math.min(90, Math.max(7, parseInt(req.query.days, 10) || 30));

        const entries = await Query(`
            SELECT \`${pk}\` AS mood_id, mood, stress_level, workload, notes, created_at
            FROM mood_entries
            WHERE uid = ?
            ORDER BY created_at DESC
            LIMIT 100
        `, [uid]);

        // one point per day (average, in case a day has more than one entry)
        // one point per day (average, in case a day has more than one entry)
const chart = await Query(`
    SELECT
        DATE_FORMAT(created_at, '%Y-%m-%d') AS day,
        ROUND(AVG(stress_level), 1) AS stress
    FROM mood_entries
    WHERE uid = ?
      AND created_at >= DATE_SUB(CURDATE(), INTERVAL ${days - 1} DAY)
    GROUP BY day
    ORDER BY day
`, [uid]);
        const count = await Query(`
            SELECT COUNT(*) AS total
            FROM mood_entries
            WHERE uid = ?
        `, [uid]);

        const today = await getTodayEntry(uid);

        res.json({
            entries,
            chart,
            summary: {
                mood: today ? today.mood : null,
                stress: today ? today.stress_level : 0,
                totalEntries: Number(count[0]?.total || 0)
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

/* ==========================================================
   GET MOOD DATA
========================================================== */

router.get("/api/mood", async (req, res) => {
    try {
        const uid = getUid(req);
        const { pk } = await getMeta();

        const entries = await Query(`
            SELECT \`${pk}\` AS mood_id, mood, stress_level, workload, notes, created_at
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

        const today = await getTodayEntry(uid);

        res.json({
            entries,
            summary: {
                mood: today ? today.mood : null,
                stress: today ? today.stress_level : 0,
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
   once: true  -> daily check-in; skipped if already logged today
========================================================== */

router.post("/api/mood", async (req, res) => {
    try {
        const uid = getUid(req);
        const { pk, auto, columns } = await getMeta();

        const { mood, stress_level, workload, notes, once } = req.body || {};

        const stress = Number(stress_level);
        const load = Number(workload);

        if (!VALID_MOODS.includes(mood)) {
            return res.status(400).json({ error: "Invalid mood." });
        }

        if (!(stress >= 1 && stress <= 10) || !(load >= 1 && load <= 10)) {
            return res.status(400).json({ error: "Stress and workload must be 1-10." });
        }

        if (once && await getTodayEntry(uid)) {
            return res.json({ success: true, alreadyLogged: true });
        }

        // build the INSERT from what the table really has
        const cols = [];
        const marks = [];
        const vals = [];

        const addValue = (col, val) => {
            cols.push(`\`${col}\``);
            marks.push("?");
            vals.push(val);
        };

        const addSql = (col, sql) => {
            cols.push(`\`${col}\``);
            marks.push(sql);
        };

        if (!auto) addValue(pk, crypto.randomUUID());   // no AUTO_INCREMENT: supply the id

        addValue("uid", uid);
        addValue("mood", mood);
        addValue("stress_level", Math.round(stress));
        addValue("workload", Math.round(load));
        addValue("notes", String(notes || "").slice(0, 500));
        addSql("created_at", "NOW()");

        // the table's own "which day" column, when it has one
        if (columns.has("local_day")) addSql("local_day", "CURDATE()");

        await Query(`
            INSERT INTO mood_entries (${cols.join(", ")})
            VALUES (${marks.join(", ")})
        `, vals);

        res.status(201).json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;