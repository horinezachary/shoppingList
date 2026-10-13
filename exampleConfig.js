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
