function isAdmin(req) {
    const u = req.session?.user;
    return !!u && (u.role === "admin" || u.is_admin === 1 || u.is_admin === true);
}

function requireAdmin(req, res, next) {
    // DEV ONLY: set DEV_ADMIN=true in .env to skip login while building
    if (process.env.NODE_ENV !== "production" && process.env.DEV_ADMIN === "true") {
        return next();
    }

    const wantsJson = req.originalUrl.includes("/api/");

    if (!req.session?.user) {
        return wantsJson
            ? res.status(401).json({ error: "Please log in." })
            : res.redirect("/login");
    }

    if (!isAdmin(req)) {
        return wantsJson
            ? res.status(403).json({ error: "Admin access only." })
            : res.status(403).send("Forbidden");
    }

    next();
}

module.exports = { requireAdmin, isAdmin };