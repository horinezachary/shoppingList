var config = {
development: {
    //url to be used in link generation
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
    }
}
};
module.exports = config;
