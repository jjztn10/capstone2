var express = require("express");
var router = express.Router();
const bcrypt = require("bcryptjs");
const { Query } = require("./../database/config/db.js");
const { Query: UserQuery } = require("./../database/db-helper");
const { EncryptString } = require("./../database/cryptography.js");
const { homeFor } = require("./../middleware/auth.js");

const normalize = (s) => String(s ?? "").toLowerCase().replace(/[\s\-_]+/g, "");

function validateCredentials(body) {
  const identifier = (body.Username ?? body.username ?? "").toString().trim();
  const password = (body.Password ?? body.password ?? "").toString().trim();

  if (!identifier) return { error: "Username or email is required." };
  if (!password) return { error: "Password is required." };

  return { value: { identifier, password } };
}

// Role name + { route: permission } map for a role id
async function loadAccess(roleId) {
  const [role] = await Query("SELECT mr_name FROM master_roles WHERE mr_id = ?", [roleId]);
  const permissions = {};

  try {
    const rows = await Query(
      `SELECT rt.mr_name AS route_name, p.mrp_permission AS permission
       FROM master_role_permission p
       INNER JOIN master_routes rt ON rt.mr_id = p.mrp_route_id
       WHERE p.mrp_role_id = ?`,
      [roleId]
    );
    for (const r of rows) permissions[normalize(r.route_name)] = r.permission;
  } catch (err) {
    // permission tables not created yet: log in with no permissions
    console.warn("Permissions not loaded:", err.code || err.message);
  }

  return { roleName: role?.mr_name ?? "", permissions };
}

// Admin/staff account (master_users) -> by username
async function findStaff(identifier, password) {
  const [u] = await Query(
    "SELECT mu_id, mu_fullname, mu_role, mu_username FROM master_users WHERE mu_username = ? AND mu_password = ?",
    [identifier, EncryptString(password)]
  );
  if (!u) return null;

  const access = await loadAccess(u.mu_role);
  return {
    id: u.mu_id,
    roleId: u.mu_role,
    username: u.mu_username,
    fullname: u.mu_fullname,
    ...access,
  };
}

// Regular user (users table) -> by email, bcrypt password
async function findStudent(identifier, password) {
  const [u] = await UserQuery(
    "SELECT uid, email, name, password FROM users WHERE email = ? LIMIT 1",
    [identifier.toLowerCase()]
  );
  if (!u || !u.password) return null;
  if (!(await bcrypt.compare(password, u.password))) return null;

  // Give them the "user" role's permissions if that role exists
  const [r] = await Query("SELECT mr_id FROM master_roles WHERE mr_name = 'user'");
  const access = r ? await loadAccess(r.mr_id) : { roleName: "user", permissions: {} };

  return {
    id: u.uid, // UUID string
    roleId: r?.mr_id ?? null,
    username: u.email,
    fullname: u.name || u.email,
    roleName: access.roleName || "user",
    permissions: access.permissions,
  };
}

// Login page
router.get("/", function (req, res) {
  if (req.session.userId) return res.redirect(homeFor(req.session.roleName));

  res.render("layout/sub-layout", {
    layout: false, // stops express-ejs-layouts from wrapping this in main-layout
    body: "../pages/login-page.ejs",
    title: "SmartWork | Login",
    pageStyle: "login.css",
    pageScript: "../scripts/login-script.ejs",
    roleName: "",
  });
});

// Login
router.post("/login", async function (req, res) {
  try {
    const { error, value } = validateCredentials(req.body);
    if (error) return res.status(400).json({ success: false, message: error });

    let account = null;

    // Not an email -> try the admin/staff table first
    if (!value.identifier.includes("@")) {
      account = await findStaff(value.identifier, value.password);
    }
    // Otherwise (or no match) -> try regular users by email
    if (!account) {
      account = await findStudent(value.identifier, value.password);
    }

    if (!account) {
      return res.status(401).json({ success: false, message: "Invalid username/email or password." });
    }

    const isAdmin = String(account.roleName).toLowerCase() === "admin";

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ success: false, message: "Session error." });

      // Saved in several shapes so every part of the app can read it
      req.session.userId = account.id;
      req.session.roleId = account.roleId;
      req.session.role = account.roleName; // "admin" or "user"
      req.session.roleName = account.roleName;
      req.session.isAdmin = isAdmin;
      req.session.permissions = account.permissions;
      req.session.username = account.username;
      req.session.fullname = account.fullname;
      req.session.user = {
        id: account.id,
        uid: account.id,
        name: account.fullname,
        email: account.username,
        role: account.roleName,
        isAdmin,
      };

      req.session.save((err) => {
        if (err) return res.status(500).json({ success: false, message: "Session error." });
        res.json({ success: true, message: "Logged in.", redirectTo: homeFor(account.roleName) });
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// Re-read permissions without logging in again
router.get("/refresh", async function (req, res) {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ success: false, message: "Please log in again." });
    }
    if (req.session.roleId) {
      const access = await loadAccess(req.session.roleId);
      req.session.roleName = access.roleName || req.session.roleName;
      req.session.permissions = access.permissions;
    }
    req.session.save(() => res.json({ success: true, permissions: req.session.permissions }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

// Logout (GET link or POST form both work)
function logout(req, res) {
  req.session.destroy((err) => {
    if (err) {
      console.error(err);
      return res.redirect("/auth");
    }
    res.clearCookie("connect.sid");
    res.redirect("/auth");
  });
}
router.get("/logout", logout);
router.post("/logout", logout);

module.exports = router;