const { Query: QueryA } = require("../database/config/db.js");
const { Query: QueryB } = require("../database/db-helper");

(async () => {
  try {
    const [a] = await QueryA("SELECT DATABASE() AS db");
    const [b] = await QueryB("SELECT DATABASE() AS db");
    console.log("auth uses database:     ", a.db);
    console.log("dashboard uses database:", b.db);

    const cols = await QueryB("SHOW COLUMNS FROM users");
    console.table(cols.map((c) => ({ Field: c.Field, Type: c.Type })));

    const [row] = await QueryB("SELECT * FROM users LIMIT 1");
    for (const k of Object.keys(row || {})) {
      if (/pass|hash|pwd/i.test(k)) {
        const v = String(row[k] ?? "");
        row[k] = v.slice(0, 8) + "... (" + v.length + " chars)";
      }
    }
    console.log(row);
  } catch (err) {
    console.error("Failed:", err.message);
  }
  process.exit(0);
})();