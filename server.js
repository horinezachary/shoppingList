var mysql = require('mysql');

var con = mysql.createConnection({
   host: "192.168.1.15",
   user: "app",
   password: "8eKta0TjuU6Pijfd",
   database: "loris_kitchen"
});

con.connect(function(err) {
   if (err) throw err;
   console.log("Connected to mysql!");
});

var path = require('path');
var express = require('express');
var exphbs = require('express-handlebars');
var bodyParser = require('body-parser');

var app = express();
var port = process.env.PORT || 3000;
app.engine('handlebars', exphbs({ defaultLayout: 'main' }));
app.set('view engine', 'handlebars');

app.use(express.static('public'));
app.use(bodyParser.json());

app.get('/', function (req, res, next) {
   let query = "SELECT * FROM ShoppingList NATURAL JOIN ShoppingList_Item NATURAL JOIN Item"
   con.query(query, function (err, result) {
      if (err) res.redirect('/');
      console.log("Result: " + result);
      res.status(200).render('shoppingList', {

         listItem: result
      });
   });
});

app.get('*', function (req, res) {
  res.status(404).render('404');
});

app.listen(port, function () {
    console.log("== Server listening on port", port);
});
