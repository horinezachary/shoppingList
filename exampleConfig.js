var config = {
development: {
    //url to be used in link generation (also used to validate request origins)
    url: 'callback_url',
    //database connection settings
    database: {
      host: "sql_server",
      user: "user",
      password: "pass",
      database: "recipes"
    },
    //Optional: a separate login for scripts/migrate.js (run by scripts/deploy.sh), which needs to
    //create and change tables. Lets the app's own login above stay limited to reading and writing
    //rows. Any field left out is taken from database above. Leave the block out to migrate with that login.
    //  CREATE USER 'migrator'@'localhost' IDENTIFIED BY '...';
    //  GRANT CREATE, ALTER, INDEX, SELECT, INSERT, UPDATE, DELETE ON recipes.* TO 'migrator'@'localhost';
    //migrationDatabase: {
    //  user: "migrator",
    //  password: "pass"
    //},
    //server details
    server: {
        host: '127.0.0.1',
        port: '3000'
    },
    //session cookie settings. Use a long random string for the secret, e.g.
    //  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    //Can also be provided with the SESSION_SECRET environment variable.
    session: {
        secret: 'change-me-to-a-long-random-string',
        //set to true once the node process sees HTTPS (or trusts a proxy that does)
        cookieSecure: false
    },
    //Lets the iPhone and Android apps open invitation and password-reset links
    //instead of the browser. Leave it out and links open the website, as before.
    //  ios.appIds     your Apple Team ID, a dot, then the app's bundle id
    //  android.sha256 the SHA-256 fingerprint(s) of the key the app is signed with
    //                 (Play Console > App signing, or `./gradlew signingReport`)
    //appLinks: {
    //    ios: { appIds: ['ABCDE12345.dev.horine.lorislist'] },
    //    android: {
    //        package: 'dev.horine.lorislist',
    //        sha256: ['AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99']
    //    }
    //},
    //outgoing mail (password resets and list sharing).
    //Can also be provided with the SMTP_USER and SMTP_PASS environment variables.
    mail: {
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        user: 'smtp_username',
        pass: 'smtp_password_or_app_password'
    }
}
};
module.exports = config;
