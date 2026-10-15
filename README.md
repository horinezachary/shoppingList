### Purpose
  This web app is a full stack implementation of a shopping list database. It was built for my mother, Lori, as a way to keep track of all of her different shopping lists.
  Some of the most important features were the ability to have multiple lists, all with their own customizable name and color, and the ability to cross things off of your list without deleting them.
  During this project, I learned alot about full stack development, using node.js, mysql and apache. I got to learn alot about SSL and TLS and how they play into web security, as the site is secured via https. I hope to continue adding features, some of which are listed below.
### Features to come:
- Print Friendly lists
- List link sharing
- Rearranging items on your list
- Intelligent logon and redirection after logon
    <li>OAuth login with Google and social media applications
### Feedback:
   If you have feature suggestions or would like to report an issue, please send an email to me at <a href="mailto:feedback@horine.dev">feedback@horine.dev
   This information is incredibly valuable and much appreciated!
   <p>Thanks,</p>
   Zachary Horine

### Development:
   When developing, you will need to create a file named config.js (it is gitignored) based on exampleConfig.js. It holds the database credentials, the public site `url` (used to build email links and to check where POST requests come from), a `session.secret` used to sign login cookies, and the `mail` credentials used to send password-reset and list-sharing emails.
   ```
   database: { host: "sql_server", user: "user", password: "pass", database: "recipes" }
   session:  { secret: "<long random string>", cookieSecure: false }
   mail:     { host: "smtp.gmail.com", port: 465, secure: true, user: "...", pass: "..." }
   ```
   The session secret and mail credentials can instead be supplied with the `SESSION_SECRET`, `SMTP_USER` and `SMTP_PASS` environment variables. The server refuses to start without them. Never commit real credentials to the repository.

### Requirements:
   Node.js 24 or newer and a MySQL database. After `npm install`, run `npm test` on the machine that will host the app: it checks that every dependency loads, that password hashing and the email templates work, and that the Express routes and cookie sessions behave, without needing a database. Please commit the `package-lock.json` that `npm install` creates, so every install gets the same versions.
