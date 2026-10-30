-- Lets new accounts be created again.
--
-- The User table has columns from older versions of the site (salt, hash,
-- last_web_change and possibly others) that are NOT NULL without a default.
-- The current code no longer writes them, so every sign-up failed with
-- ER_NO_DEFAULT_FOR_FIELD. This makes every such column nullable, except the
-- primary key and the columns sign-up fills in. Existing values are kept.
--
-- The column list is read from INFORMATION_SCHEMA so the statement matches
-- this database, whatever legacy columns it has. When there are none, it does
-- nothing.
--
-- Applied by scripts/deploy.sh (through scripts/migrate.js). By hand:
--   mysql -u <user> -p <database> < migrations/003_user_legacy_columns_nullable.sql
SET @user_columns = (
  SELECT GROUP_CONCAT(CONCAT('MODIFY `', COLUMN_NAME, '` ', COLUMN_TYPE, ' NULL') ORDER BY ORDINAL_POSITION SEPARATOR ', ')
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'User'
    AND IS_NULLABLE = 'NO'
    AND COLUMN_DEFAULT IS NULL
    AND COLUMN_KEY <> 'PRI'
    AND EXTRA NOT LIKE '%auto_increment%'
    AND COLUMN_NAME NOT IN ('uname', 'fname', 'lname', 'email', 'password')
);
SET @user_alter = IFNULL(CONCAT('ALTER TABLE `User` ', @user_columns), 'DO 0');
PREPARE user_alter FROM @user_alter;
EXECUTE user_alter;
DEALLOCATE PREPARE user_alter;
