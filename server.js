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
var session = require('client-sessions');

var app = express();
var port = process.env.PORT || 3000;
app.engine('handlebars', exphbs({ defaultLayout: 'main' }));
app.set('view engine', 'handlebars');

app.use(express.static('public'));
app.use('/:url', express.static('public'));
app.use(bodyParser.urlencoded({extended : true}));
app.use(bodyParser.json());
app.use(session({
  cookieName: 'session',
  secret: 'dQ46q4AlvniGACyALReI',
  duration: 24 * 60 * 60 * 1000, //1 day
  activeDuration: 24 * 60 * 60 * 1000,
}));

app.get('/', function (req, res, next) {
   //var user = mysql.escape(req.params.user);
   var user = mysql.escape("goofyone");
   console.log(req.params.user);
   let userData = con.query(`SELECT * FROM User WHERE User.uname = ${user}`,
      function (err, userData) {
   let listData = con.query(`SELECT * FROM ShoppingList WHERE ShoppingList.owner = ${user}`,
      function (err, listData) {
      res.status(200).render('home', {
         user: userData,
         headerlists: listData
      });
   });
   });
});

app.get('/l/:list', function (req, res, next) {
   //var user = mysql.escape(req.params.user);
   var user = mysql.escape("goofyone");
   var list = req.params.list;
   list = mysql.escape(list);
   console.log(req.params.user);
   con.query(`SELECT * FROM ShoppingList WHERE ShoppingList.owner = ${user} AND ShoppingList.list_id = ${list}`,
      function (err, singleListData) {
   con.query(`SELECT * FROM ShoppingList NATURAL JOIN ShoppingList_Item NATURAL JOIN Item WHERE ShoppingList_Item.list_id = ${mysql.escape(req.params.list)}`,
      function (err, listItemData) {

   con.query(`SELECT * FROM Item`,
      function (err, autofillData) {

   con.query(`SELECT * FROM ShoppingList WHERE ShoppingList.owner = ${user}`,
      function (err, listData) {
   console.log("Result: " + listData);
      res.status(200).render('shoppingList', {
         list: singleListData,
         autofillItem: autofillData,
         listItem: listItemData,
         headerlists: listData
   });
   });
   });
   });
   });
});

app.post('/l/addItem/:list', function (req, res) {
   var list = req.params.list;
   var icount = req.body.icount;
   var item = req.body.itemName;
   console.log(list+", "+icount+", "+item);
   con.query(`CALL addShoppingItem(${list},${icount},'${item.toString()}');`);
   res.redirect('/l/'+list);
});

app.post('/l/delItem/:list', function (req, res) {
   var list = req.params.list;
   var items = req.body.items;
   var query = `DELETE FROM ShoppingList_Item WHERE sItem_id = ${items[0]}`;
   for (i = 1; i < items.length; i++) {
      query += ` OR sItem_id = ${items[i]}`;
   }
   con.query(query+`;`);
   res.redirect('/l/'+list);
});

app.post('/l/delList/', function (req, res) {
   var list = req.body.list;
   console.log(list);
   con.query(`DELETE FROM ShoppingList WHERE list_id = ${list};`);
   res.redirect('/');
});

app.post('/:other?/addList', function (req, res) {
   //var user = mysql.escape(req.params.user);
   var user = mysql.escape("goofyone");
   var list = mysql.escape(req.body.listName);
   var color = mysql.escape(req.body.color);
   console.log(list+", "+color);
   con.query(`INSERT INTO ShoppingList (list_name,owner,listColor) VALUES (${list.toString()},${user.toString()},${color.toString()});`);
   res.redirect('/');
});


app.get('/u/:user', function (req, res, next) {
   //var user = mysql.escape(req.params.user);
   var user = mysql.escape("goofyone");
   console.log(req.params.user);
   let userData = con.query(`SELECT * FROM User WHERE User.uname = ${user}`,
      function (err, userData) {
   let listData = con.query(`SELECT * FROM ShoppingList WHERE ShoppingList.owner = ${user}`,
      function (err, listData) {
      res.status(200).render('user', {
         user: userData,
         headerlists: listData
      });
   });
   });
});

app.get('/login', function (req, res, next) {
   res.render('login.handlebars', {
      title: 'Login',
      layout: 'bare',
      error: 'Invalid email or password.'
   });
});

app.post('/login', function(req, res) {
   User.findOne({ email: req.body.email }, function(err, user) {
      if (!user) {
         res.render('login.handlebars', { error: 'Invalid email or password.' });
         } else {
            if (req.body.password === user.password) {
               // sets a cookie with the user's info
               req.session.user = user;
               res.redirect('/');
         } else {
            res.render('login.handlebars', {
               title: 'Login',
               layout: 'bare',
               error: 'Invalid email or password.'
            });
         }
      }
   });
});

app.get('*', function (req, res) {
  res.status(404).render('404.handlebars');
});

app.listen(port, function () {
    console.log("== Server listening on port", port);
});
