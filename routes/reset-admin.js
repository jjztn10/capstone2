// scripts/reset-admin.js
const { Query } = require("../database/config/db.js");
const { EncryptString } = require("../database/cryptography.js");

(async () => {
  const r = await Query(
    "UPDATE master_users SET mu_password = ? WHERE mu_username = 'admin'",
    [EncryptString("admin123")]
  );
  console.log(r);
  process.exit(0);
})();