// Id of the logged-in user, set at login (users.uid, a UUID string).
// Throws a 401 if nobody is logged in, so a missing session can never
// fall back to someone else's data.
function getUid(req) {
    const uid = req.session?.user?.uid ?? req.session?.userId;

    if (uid === undefined || uid === null || uid === "") {
        const err = new Error("Please log in.");
        err.status = 401;
        throw err;
    }
    return uid;
}

// One place that turns an error into a JSON response.
// 401/4xx keep their message; real server errors stay in the terminal.
function apiError(res, err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);

    res.status(status).json({
        error: status >= 500 ? "Something went wrong. Please try again." : err.message
    });
}

module.exports = { getUid, apiError };