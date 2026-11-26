const { Query } = require("../database/config/db.js");
const { EncryptString } = require("../database/cryptography.js");

(async () => {
  const users = await Query(
    "SELECT mu_id, mu_username, mu_password, mu_role FROM master_users"
  );
  console.log("Users in master_users:", users.length);
  console.table(users);

  const roles = await Query("SELECT mr_id, mr_name FROM master_roles");
  console.table(roles);

  // Is EncryptString stable? (must print true)
  console.log("Encrypt is deterministic:", EncryptString("admin123") === EncryptString("admin123"));
  console.log("Encrypted 'admin123' =", EncryptString("admin123"));

  process.exit(0);
})();