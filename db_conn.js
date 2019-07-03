var mysql = require('mysql');

var con = mysql.createConnection({
  host: "192.168.1.15",
  user: "app",
  password: "8eKta0TjuU6Pijfd"
});

con.connect(function(err) {
  if (err) throw err;
  console.log("Connected!");
});
