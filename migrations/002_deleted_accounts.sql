-- Usernames of deleted accounts, so they cannot be registered again (see
-- lib/accounts.js). Only a SHA-256 hash of the lower-cased username is kept.
--
-- Applied by scripts/deploy.sh (through scripts/migrate.js). By hand:
--   mysql -u <user> -p <database> < migrations/002_deleted_accounts.sql
CREATE TABLE IF NOT EXISTS DeletedAccount (
  uname_hash CHAR(64) NOT NULL,
  deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (uname_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
