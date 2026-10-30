// Deleting an account, for the API (DELETE /api/v1/me) and the website.
//
// Everything the person owns goes: their lists (with their items and shares),
// their places on other people's lists, pending invitations to or from them,
// their item suggestions, password reset links, app sign-ins, and the User row.
// Items they added to someone else's list stay on that list, since they are part
// of that person's list now.
//
// It all runs in one transaction, so a failure part way leaves the account as it
// was and the person can simply try again.
//
// The username is retired (only a hash of it is kept, in DeletedAccount; see
// migrations/002_deleted_accounts.sql) so nobody can register it again. Without
// that, a website cookie left signed in to the old account, or items left on a
// shared list under the old name, would belong to the newcomer.
'use strict';

const crypto = require('crypto');

function usernameHash(uname) {
  return crypto.createHash('sha256').update(String(uname).toLowerCase()).digest('hex');
}

// con needs transaction(work), where work(query) runs its statements on one
// connection between START TRANSACTION and COMMIT (see sqlConfig.js).
async function deleteAccount(con, account) {
  const uname = account.uname;
  const email = String(account.email || '').toLowerCase();
  await con.transaction(async function (q) {
    const [lists] = await q('SELECT list_id FROM ShoppingList WHERE ShoppingList.owner = ?', [uname]);
    for (const list of lists) {
      await q('CALL deleteList(?)', [list.list_id]);
    }
    await q('DELETE FROM Shared_list WHERE share_user = ?', [uname]);
    await q('DELETE FROM share_pending WHERE list_owner = ? OR share_email = ?', [uname, email]);
    await q('DELETE FROM Item WHERE Item.owner = ? AND NOT EXISTS (SELECT 1 FROM ShoppingList_Item WHERE ShoppingList_Item.item_id = Item.item_id)', [uname]);
    await q('DELETE FROM PasswordResetToken WHERE uname = ?', [uname]);
    await q('DELETE FROM ApiToken WHERE uname = ?', [uname]);
    await q('INSERT IGNORE INTO DeletedAccount (uname_hash, deleted_at) VALUES (?, NOW())', [usernameHash(uname)]);
    await q('DELETE FROM User WHERE uname = ?', [uname]);
  });
}

// True when this username belonged to a deleted account. Before the migration
// has run nothing is retired, so sign-ups keep working.
async function isRetired(con, uname) {
  try {
    const [rows] = await con.asyncQuery('SELECT uname_hash FROM DeletedAccount WHERE uname_hash = ?', [usernameHash(uname)]);
    return rows.length > 0;
  } catch (e) {
    if (e && e.code === 'ER_NO_SUCH_TABLE') { return false; }
    throw e;
  }
}

module.exports = { deleteAccount: deleteAccount, isRetired: isRetired, usernameHash: usernameHash };
