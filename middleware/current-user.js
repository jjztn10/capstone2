// TEMPORARY dev fallback: your real user until login is wired up.
const DEV_UID = "7d93fab3-7e50-4bca-a262-fa89c647b282";

function getUid(req) {
    return req.session?.user?.uid || DEV_UID;
}

module.exports = { getUid };