const isAdmin = (roleName) => String(roleName).toLowerCase() === "admin";

// Where each role lands
function homeFor(roleName) {
  return isAdmin(roleName) ? "/admindashboard" : "/userdashboard";
}

const wantsJson = (req) =>
  req.xhr || (req.headers.accept || "").includes("application/json");

// Blocks anyone who isn't logged in
function requireLogin(req, res, next) {
  // Stops the back button from showing a protected page after logout
  res.set("Cache-Control", "no-store");

  if (req.session && req.session.userId) return next();

  if (wantsJson(req)) {
    return res.status(401).json({ success: false, message: "Please log in." });
  }
  res.redirect("/auth");
}

// Allows only the listed roles, e.g. requireRole("admin")
function requireRole(...roles) {
  const allowed = roles.map((r) => r.toLowerCase());

  return function (req, res, next) {
    const current = String(req.session?.roleName).toLowerCase();
    if (allowed.includes(current)) return next();

    if (wantsJson(req)) {
      return res.status(403).json({ success: false, message: "You don't have access to this." });
    }
    // Wrong area for this role: send them to their own home
    res.redirect(homeFor(req.session?.roleName));
  };
}

module.exports = { requireLogin, requireRole, homeFor };