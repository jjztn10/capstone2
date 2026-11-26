const express = require("express");
const bcrypt = require("bcryptjs");

const router = express.Router();
const { Query } = require("../database/db-helper");
const { getUid, apiError } = require("../middleware/current-user");

/* ==========================================
   PROFILE PAGE
========================================== */

router.get("/profile", (req, res) => {
    res.render("pages/profile-page", {
        layout: "layout/main-layout",
        layoutType: "user",
        title: "Profile",
        pageStyle: "profile.css",
        pageScript: "profile-script",
        currentPath: req.originalUrl,
        user: req.session?.user || null
    });
});

/* ==========================================
   GET PROFILE
========================================== */

router.get("/api/profile", async (req, res) => {
    try {
        const uid = getUid(req);

        const rows = await Query(`
            SELECT uid, name, email, study_streak, total_points, weekly_points, created_at
            FROM users
            WHERE uid = ?
            LIMIT 1
        `, [uid]);

        if (!rows.length) {
            return res.status(404).json({ error: "User not found" });
        }

        res.set("Cache-Control", "no-store");
        res.json({ profile: rows[0] });
    } catch (err) {
        apiError(res, err);
    }
});

/* ==========================================
   UPDATE PROFILE
========================================== */

router.put("/api/profile", async (req, res) => {
    try {
        const uid = getUid(req);
        const name = String(req.body.name || "").trim();

        if (!name) {
            return res.status(400).json({ error: "Name is required." });
        }
        if (name.length > 100) {
            return res.status(400).json({ error: "Name is too long (max 100)." });
        }

        await Query(`
            UPDATE users
            SET name = ?, updated_at = NOW()
            WHERE uid = ?
        `, [name, uid]);

        // Keep the name in the session in sync with the database
        if (req.session.user) req.session.user.name = name;
        req.session.fullname = name;

        res.json({ success: true, message: "Profile updated." });
    } catch (err) {
        apiError(res, err);
    }
});

/* ==========================================
   CHANGE PASSWORD
========================================== */

router.put("/api/profile/password", async (req, res) => {
    try {
        const uid = getUid(req);
        const { currentPassword, newPassword } = req.body || {};

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: "All password fields are required." });
        }
        if (String(newPassword).length < 8) {
            return res.status(400).json({ error: "Password must be at least 8 characters." });
        }

        const rows = await Query(`
            SELECT password
            FROM users
            WHERE uid = ?
            LIMIT 1
        `, [uid]);

        if (!rows.length) {
            return res.status(404).json({ error: "User not found." });
        }

        const valid = await bcrypt.compare(String(currentPassword), rows[0].password);

        if (!valid) {
            return res.status(400).json({ error: "Current password is incorrect." });
        }

        const hash = await bcrypt.hash(String(newPassword), 10);

        await Query(`
            UPDATE users
            SET password = ?, updated_at = NOW()
            WHERE uid = ?
        `, [hash, uid]);

        res.json({ success: true, message: "Password changed successfully." });
    } catch (err) {
        apiError(res, err);
    }
});

module.exports = router;