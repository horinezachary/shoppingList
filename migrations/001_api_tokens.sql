-- Sign-in tokens for the JSON API (/api/v1) used by the mobile apps.
--
-- Run once against the Lori's List database before using the API:
--   mysql -u <user> -p <database> < migrations/001_api_tokens.sql
--
-- One row per signed-in device. Only SHA-256 hashes of the tokens are stored, so
-- a copy of this table cannot be used to sign in. Deleting a row signs that
-- device out. The website does not use this table, so the site keeps working
-- whether or not it exists.
CREATE TABLE IF NOT EXISTS ApiToken (
  token_id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  uname           VARCHAR(255) NOT NULL,
  device_name     VARCHAR(100) NOT NULL DEFAULT '',
  access_hash     CHAR(64)     NOT NULL,
  access_expires  DATETIME     NOT NULL,
  refresh_hash    CHAR(64)     NOT NULL,
  refresh_expires DATETIME     NOT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token_id),
  UNIQUE KEY uq_access_hash (access_hash),
  UNIQUE KEY uq_refresh_hash (refresh_hash),
  KEY idx_uname (uname)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
