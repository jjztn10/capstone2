const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { Query, Transaction } = require("../database/db-helper");

const router = express.Router();

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const h = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// GET /admindashboard/api/users
router.get(
  "/",
  h(async (req, res) => {
    const rows = await Query(`
      SELECT uid, email, name, study_streak, total_points, weekly_points,
             last_streak_date, created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 500`);
    res.json(rows);
  })
);

// POST /admindashboard/api/users
router.post(
  "/",
  h(async (req, res) => {
    const name = String(req.body.name ?? "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const uid = crypto.randomUUID();

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "A valid email is required." });
    }
    if (password.length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters." });
    }

    const existing = await Query(
      "SELECT uid FROM users WHERE email = ? LIMIT 1",
      [email]
    );
    if (existing.length) {
      return res
        .status(409)
        .json({ error: "A user with that email already exists." });
    }

    const hashed = await bcrypt.hash(password, 10);
    await Query(
      `INSERT INTO users
         (uid, email, name, password, study_streak, total_points, weekly_points, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 0, 0, NOW(), NOW())`,
      [uid, email, name || null, hashed]
    );
    res.status(201).json({ uid, email, name });
  })
);

// PUT /admindashboard/api/users/:uid
router.put(
  "/:uid",
  h(async (req, res) => {
    const sets = [];
    const vals = [];

    if (req.body.name !== undefined) {
      sets.push("name = ?");
      vals.push(String(req.body.name).trim() || null);
    }

    if (req.body.email !== undefined) {
      const email = String(req.body.email).trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        return res.status(400).json({ error: "A valid email is required." });
      }
      const clash = await Query(
        "SELECT uid FROM users WHERE email = ? AND uid <> ? LIMIT 1",
        [email, req.params.uid]
      );
      if (clash.length) {
        return res
          .status(409)
          .json({ error: "Another user already uses that email." });
      }
      sets.push("email = ?");
      vals.push(email);
    }

    const password = String(req.body.password || "");
    if (password) {
      if (password.length < 8) {
        return res
          .status(400)
          .json({ error: "Password must be at least 8 characters." });
      }
      sets.push("password = ?");
      vals.push(await bcrypt.hash(password, 10));
    }

    if (!sets.length)
      return res.status(400).json({ error: "Nothing to update." });
    sets.push("updated_at = NOW()");

    const result = await Query(
      `UPDATE users SET ${sets.join(", ")} WHERE uid = ?`,
      [...vals, req.params.uid]
    );
    if (!result.affectedRows)
      return res.status(404).json({ error: "User not found." });
    res.json({ success: true });
  })
);

// DELETE /admindashboard/api/users/:uid
router.delete(
  "/:uid",
  h(async (req, res) => {
    const uid = req.params.uid;
    await Transaction([
      { sql: "DELETE FROM metrics WHERE uid = ?", values: [uid] },
      { sql: "DELETE FROM mood_entries WHERE uid = ?", values: [uid] },
      { sql: "DELETE FROM study_sessions WHERE uid = ?", values: [uid] },
      { sql: "DELETE FROM tasks WHERE uid = ?", values: [uid] },
      { sql: "DELETE FROM users WHERE uid = ?", values: [uid] },
    ]);
    res.json({ success: true });
  })
);

module.exports = router;