# Lori's List API (v1)

A JSON API for the mobile apps. It does everything the website does. The full
reference is [`openapi.yaml`](openapi.yaml) (open it in Swagger Editor or
Postman, or generate client code from it with OpenAPI Generator).

Base URL: `https://lorislist.horinetech.com/api/v1`

## Setting it up on the server

The API keeps its sign-ins in one new table. Run this once, before using the API:

```
mysql -u <user> -p <database> < migrations/001_api_tokens.sql
```

`scripts/deploy.sh` does not run migrations. Until the table exists the website
works as before and the API sign-in answers `503 api_not_ready` (the server log says why).

## Signing in

There are no cookies. Signing in returns two tokens:

| Token | Lifetime | Use |
| --- | --- | --- |
| `accessToken` | 60 minutes | Send as `Authorization: Bearer <token>` on every request |
| `refreshToken` | 60 days from last use | Exchange for a new access token at `POST /auth/refresh` |

Store both in the Keychain (iOS) or the Keystore / EncryptedSharedPreferences
(Android). When a request answers `401`, refresh once and retry; if the refresh
also answers `401`, send the person back to the sign-in screen.

Only hashes of the tokens are stored on the server. Each sign-in is a "session"
with a device name, shown by `GET /auth/sessions` and revocable one by one,
or all at once (`POST /auth/logout-everywhere`). Changing the password signs out
the other devices; a password reset signs out all of them.

```
curl -s https://lorislist.horinetech.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"lori","password":"…","deviceName":"Lori'"'"'s iPhone"}'
```
```json
{
  "user": { "username": "lori", "firstName": "Lori", "lastName": "Horine", "email": "lori@example.com" },
  "accessToken": "…", "refreshToken": "…", "tokenType": "Bearer", "expiresIn": 3600
}
```

```
curl -s https://lorislist.horinetech.com/api/v1/lists -H "Authorization: Bearer $ACCESS"
curl -s https://lorislist.horinetech.com/api/v1/lists -H "Authorization: Bearer $ACCESS" \
  -H 'Content-Type: application/json' -d '{"name":"Groceries","color":"ff9900"}'
curl -s -X POST https://lorislist.horinetech.com/api/v1/lists/12/items -H "Authorization: Bearer $ACCESS" \
  -H 'Content-Type: application/json' -d '{"name":"Milk","count":2}'
curl -s -X PATCH https://lorislist.horinetech.com/api/v1/lists/12/items/345 -H "Authorization: Bearer $ACCESS" \
  -H 'Content-Type: application/json' -d '{"checked":true}'
```

## Endpoints

| | |
| --- | --- |
| Auth | `POST /auth/login`, `/auth/register`, `/auth/refresh`, `/auth/logout`, `/auth/logout-everywhere`; `GET /auth/sessions`; `DELETE /auth/sessions/{id}` |
| Password reset | `POST /auth/password-reset` (emails a link); `GET`/`PUT /auth/password-reset/{token}` |
| Account | `GET`/`PATCH`/`DELETE /me` (delete needs `{"password"}`); `PUT /me/password` |
| Lookups | `GET /colors`; `GET /items/suggestions` |
| Lists | `GET`/`POST /lists`; `GET`/`PATCH`/`DELETE /lists/{id}` |
| Items | `POST /lists/{id}/items`; `DELETE /lists/{id}/items?checked=true` (clear ticked); `PATCH`/`DELETE /lists/{id}/items/{itemId}` |
| Sharing | `POST /lists/{id}/shares`; `GET`/`POST /shares/{key}`; `DELETE /lists/{id}/members/me` (leave) |

## Rules worth knowing

- **Errors** are always `{"error": {"code": "...", "message": "..."}}` with a matching HTTP status. Branch on `code`, not `message`.
- **Roles**: each list has `role` of `owner`, `edit` or `view`. Only the owner can rename, delete or share. `edit` can change items. `view` can only read (`403`).
- **Lists that are not yours** answer `404`, the same as lists that do not exist.
- **Item ids** are per-line ids (one per item on a list), not product ids.
- **Colours** are six hex digits without `#`; `#` is accepted when sending.
- **Rate limits** answer `429` with `Retry-After` (seconds): sign-in and current-password guesses (5 per username and address, 30 per address, per 15 minutes), password reset emails (5 per address per hour), share invitations (20 per account per hour), new accounts (10 per address per hour).
- **Emails**: password reset and share invitations are emails whose links open the website (`/share/{key}` and `/passwordReset/{token}`). Once the apps are installed they can open those links themselves, using `GET`/`POST /shares/{key}` and `GET`/`PUT /auth/password-reset/{token}`. That needs the server to vouch for the apps: set `appLinks` in `config.js` (see `exampleConfig.js`) and the server serves `/.well-known/apple-app-site-association` (iOS universal links) and `/.well-known/assetlinks.json` (Android app links). Without it the routes answer `404` and links open the website.
- **Sync**: see "Keeping an app up to date" below.

## Keeping an app up to date

`GET /changes` returns a short fingerprint (`revision`) for every list you can see and for the whole set.
`GET /lists/{id}` returns the same fingerprint for that list. It changes exactly when what the person sees would
change, whoever made the edit, so an app can store the fingerprint with each cached list, ask `GET /changes`, and fetch
only the lists that differ. A list that is missing from the answer was deleted or is no longer shared.

`GET /events` is the same digest as a stream (Server-Sent Events): the first message arrives straight away
(which also catches an app up after being offline), and a new one whenever something changes. Read it with a plain HTTP
client and the usual bearer header; ignore lines starting with `:`; reconnect after `event: bye`, after an error, or when
nothing (not even a `: ping`) has arrived for about 45 seconds. If a proxy holds the messages back, poll `GET /changes` every
10 to 15 seconds instead. Streams last at most ten minutes and at most 4 are open per account.

For edits made while offline, send each write with an `Idempotency-Key` header (any unique string, such as a UUID) and
resend it until it gets an answer. If the first attempt reached the server but the answer was lost, the repeat returns the
first answer (marked `Idempotent-Replay: true`) instead of adding the item twice.
