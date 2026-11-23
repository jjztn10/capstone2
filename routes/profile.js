const express = require("express");
const bcrypt = require("bcrypt");

const router = express.Router();
const { Query } = require("../database/db-helper");

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
        user: null
    });

});

/* ==========================================
   GET PROFILE
========================================== */

router.get("/api/profile", async (req, res) => {

    try {

        const uid = 1; // Temporary test user

        const rows = await Query(`
            SELECT
                uid,
                name,
                email,
                study_streak,
                total_points,
                weekly_points,
                created_at
            FROM users
            WHERE uid = ?
            LIMIT 1
        `, [uid]);

        if (!rows.length) {
            return res.status(404).json({
                error: "User not found"
            });
        }

        res.json({
            profile: rows[0]
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: err.message
        });

    }

});

/* ==========================================
   UPDATE PROFILE
========================================== */

router.put("/api/profile", async (req, res) => {

    try {

        const uid = 1; // Temporary test user
        const name = String(req.body.name || "").trim();

        if (!name) {
            return res.status(400).json({
                error: "Name is required."
            });
        }

        await Query(`
            UPDATE users
            SET name = ?
            WHERE uid = ?
        `, [name, uid]);

        res.json({
            success: true,
            message: "Profile updated."
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: err.message
        });

    }

});

/* ==========================================
   CHANGE PASSWORD
========================================== */

router.put("/api/profile/password", async (req, res) => {

    try {

        const uid = 1; // Temporary test user

        const {
            currentPassword,
            newPassword
        } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                error: "All password fields are required."
            });
        }

        const rows = await Query(`
            SELECT password
            FROM users
            WHERE uid = ?
            LIMIT 1
        `, [uid]);

        if (!rows.length) {
            return res.status(404).json({
                error: "User not found."
            });
        }

        const valid = await bcrypt.compare(
            currentPassword,
            rows[0].password
        );

        if (!valid) {
            return res.status(400).json({
                error: "Current password is incorrect."
            });
        }

        const hash = await bcrypt.hash(newPassword, 10);

        await Query(`
            UPDATE users
            SET password = ?
            WHERE uid = ?
        `, [hash, uid]);

        res.json({
            success: true,
            message: "Password changed successfully."
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: err.message
        });

    }

});

module.exports = router;