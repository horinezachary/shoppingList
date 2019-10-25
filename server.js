var mysql = require('mysql');

var con = mysql.createConnection({
   host: "165.227.28.206",
   user: "devUser",
   password: "68l80pgeAP3ocAOy",
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
var md5 = require('md5');
var crypto = require('crypto');

var nodemailer = require('nodemailer');
var nodemailerhbs = require('nodemailer-express-handlebars');

var fs = require('fs');

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
  duration: 365 * 24 * 60 * 60 * 1000, //1 day
  activeDuration: 365 * 24 * 60 * 60 * 1000,
}));

let transporter = nodemailer.createTransport({
   host: "smtp.gmail.com",
   port: 465,
   secure: true, // true for 465, false for other ports
   auth: {
      user: 'lorislist.noreply',
      pass: 'rbovqgckojvrcvwi'
   }
});

let ViewOption = (transport, hbs) => {
    transport.use('compile', hbs({
      viewEngine: {
         extName: '.hbs',
         partialsDir: 'views/partials',
         layoutsDir: 'views/layouts',
         defaultLayout: 'email.handlebars',
      },
      viewPath: 'views/email',
      extName: '.handlebars'
    }));
}

app.get('/', function (req, res, next) {
   if (req.session.uname) {
      res.redirect('/home');
   } else {
      res.status(200).render('info', {
         title: 'Lori\'s List',
         layout: 'bare',
         loginButton: true
      })
   }
});


app.get('/home', function (req, res, next) {
   if (!req.session.uname) {
      res.redirect('/login');
   } else {
      var user = req.session.uname;
      console.log(user);
      let listData = con.query(`SELECT * FROM ShoppingList WHERE ShoppingList.owner = '${user.toString()}'`,
         function (err, listData) {
         res.status(200).render('home', {
            title: 'Home',
            uname: req.session.uname,
            fname: req.session.fname,
            lname: req.session.lname,
            headerlists: listData
         });
      });
   }
});

app.post('/login', function(req, res) {
   var uname = mysql.escape(req.body.username);
   con.query(`SELECT * FROM User WHERE uname = ${uname.toString()};`,
      function(err, user) {
         if (!user || user.length == 0) {
            res.render('login.handlebars', {
               title: 'Login',
               layout: 'bare',
               error: 'Invalid email or password.'
            });
         } else {
            var passIn = mysql.escape(req.body.password);
            var salt = user[0].salt;
            var passwordHash = md5(passIn+salt);
            if (passwordHash === user[0].password) {
               // sets a cookie with the user's info
               req.session.uname = user[0].uname;
               req.session.fname = user[0].fname;
               req.session.lname = user[0].lname;
               req.session.email = user[0].email;
               res.redirect('/');
            } else {
               res.render('login.handlebars', {
                  title: 'Login',
                  layout: 'bare',
                  error: 'Invalid username or password.'
               });
            }
         }
   });
});

app.get('/logout', function (req, res, next) {
    req.session.reset();
    res.redirect('/');
});

app.post('/register', function(req, res) {
   var fname = mysql.escape(req.body.fname);
   var lname = mysql.escape(req.body.lname);
   var uname = mysql.escape(req.body.username);
   var email = mysql.escape(req.body.email);
   var pass1 = mysql.escape(req.body.password);
   var pass2 = mysql.escape(req.body.password2);
   var emailExists = con.query(`SELECT uname FROM User WHERE email = ${email.toString()};`,
      function(err, emailIn) {
   var userExists = con.query(`SELECT uname FROM User WHERE uname = ${uname.toString()};`,
      function(err, users) {
         if (emailIn.length > 0) {
            res.render('register.handlebars', {
               title: 'Register',
               layout: 'bare',
               error: 'Email is already in use!'
            });
            return true;
         }
         else if (users.length > 0) {
            res.render('register.handlebars', {
               title: 'Register',
               layout: 'bare',
               error: 'Username is already in use!'
            });
            return true;
         }
         else if (pass1 != pass2) {
            res.render('register.handlebars', {
               title: 'Register',
               layout: 'bare',
               error: 'Passwords must match.'
            });
         } else {
            //generate salt
            var salt = crypto.randomBytes(16).toString('hex');
            console.log(salt);
            //hash password
            var passwordHash = md5(pass1+salt);
            con.query(`INSERT INTO User (uname,fname,lname,email,password,salt)
                        VALUES (${uname.toString()},${fname.toString()},${lname.toString()},${email.toString()},'${passwordHash.toString()}','${salt.toString()}');`,
               function (err, userData) {
                  console.log(err);
               });

            req.session.uname = req.body.username;
            req.session.fname = req.body.fname;
            req.session.lname = req.body.lname;
            req.session.email = req.body.email;
            res.redirect('/');
         }
   });
   });
});

app.get('/passwordReset/:token', function(req, res, next) {
   var token = mysql.escape(req.params.token);
   console.log(req.params.token);
   con.query(`SELECT * FROM PasswordResetToken NATURAL JOIN User WHERE token = ${token.toString()}`,
      function (err, tokens) {
         if (tokens.length > 0) {
            console.log(tokens.length);
            res.render('passwordReset.handlebars',{
               title: 'Password Reset',
               layout: 'bare',
               token: req.params.token
            });
         } else {
            res.status(404).render('404.handlebars');
         }
   });
});

app.post('/passwordReset', function(req, res) {
   var email = mysql.escape(req.body.email);
   con.query(`SELECT * FROM User WHERE email = ${email}`,
      function (err, uEmail) {
         if (uEmail.length > 0) {
            console.log(uEmail[0].uname);
            //generate token
            var token = crypto.randomBytes(16).toString('hex');
            console.log(token);
            con.query(`DELETE FROM PasswordResetToken WHERE uname = '${uEmail[0].uname.toString()}';`);
            con.query(`INSERT INTO PasswordResetToken (uname,token) VALUES ('${uEmail[0].uname.toString()}', ${mysql.escape(token.toString())});`);
            //send email
            ViewOption(transporter,nodemailerhbs);
            let HelperOptions = {
              from: '"Loris-List" <noreply@horine.dev>',
              to: uEmail[0].email,
              subject: 'Password Reset - Lori\'s List',
              template: 'reset',
              context: {
                name: uEmail[0].fname+' '+uEmail[0].lname,
                email: uEmail[0].email,
                uname: uEmail[0].uname,
                link: 'https://lorislist.horine.dev/passwordReset/'+token,
              }
            };
            transporter.sendMail(HelperOptions, (error,info) => {
              if(error) {
                console.log(error);
                res.json(error);
              }
              console.log("email is send");
              console.log(info);
              res.json(info)
            });
            console.log("email sent to"+email);
         } else {console.log("no match!");}
         res.redirect('/login');
   });
});

app.post('/updatePassword/:token', function(req, res) {
   var token = mysql.escape(req.params.token);
   var password = mysql.escape(req.body.password);
   var password2 = mysql.escape(req.body.password2);
   if (password != password2) {
      res.redirect('/passwordReset/'+token);
   } else {
      con.query(`SELECT * FROM PasswordResetToken NATURAL JOIN User WHERE token = ${token.toString()}`,
         function (err, reset) {
            console.log(reset.length);
            //generate salt
            var salt = crypto.randomBytes(8).toString('hex');
            console.log(salt);
            //hash password
            var passwordHash = md5(password+salt);
            console.log(passwordHash);
            con.query(`UPDATE User SET password = '${passwordHash}', salt='${salt}' WHERE uname = '${reset[0].uname.toString()}';`);
            con.query(`DELETE FROM PasswordResetToken WHERE uname = '${reset[0].uname.toString()}';`);

            req.session.uname = req.body.username;
            req.session.fname = req.body.fname;
            req.session.lname = req.body.lname;
            req.session.email = req.body.email;
            res.redirect('/');
      });
   }
});

app.get('/l/:list', function (req, res, next) {
   if (!req.session.uname) {
      res.redirect('/login');
   } else {
      var user = req.session.uname;
      var list = req.params.list;
      list = mysql.escape(list);
      console.log(req.params.user);
      con.query(`SELECT * FROM ShoppingList WHERE ShoppingList.owner = '${user.toString()}' AND ShoppingList.list_id = ${list}`,
         function (err, singleListData) {
            if (singleListData.length == 0){
               res.status(404).render('404.handlebars', {
                  title: '404',
                  layout: 'bare'
               });
            } else {
               con.query(`SELECT * FROM ShoppingList NATURAL JOIN ShoppingList_Item NATURAL JOIN Item WHERE ShoppingList.owner = '${user.toString()}' AND ShoppingList_Item.list_id = ${mysql.escape(req.params.list)}`,
                  function (err, listItemData) {
                     var buttonDisabled = true;
                     for (i = 0; i < listItemData.length; i++) {
                        if (listItemData[i].checked == 1) {
                           buttonDisabled = false;
                           break;
                        }
                     }
               con.query(`SELECT * FROM Item WHERE Item.owner = '${user.toString()}';`,
                  function (err, autofillData) {

               con.query(`SELECT * FROM ShoppingList WHERE ShoppingList.owner = '${user.toString()}';`,
                  function (err, listData) {
               console.log("Result: " + listData);
                  res.status(200).render('shoppingList', {
                     title: singleListData[0].list_name,
                     list: singleListData,
                     autofillItem: autofillData,
                     listItem: listItemData,
                     headerlists: listData,
                     buttonDisabled: buttonDisabled
               });
               });
               });
               });
            }
      });
   }
});

app.post('/l/addItem/:list', function (req, res) {
   if (!req.session.uname) {
      res.redirect('/login');
   } else {
      var user = req.session.uname;
      var list = req.params.list;
      var icount = req.body.icount;
      console.log("\'"+icount+"\'");
      if (!icount) {
         icount = 'NULL';
      }
      var item = req.body.itemName;
      console.log(list+", "+icount+", "+item);
      con.query(`CALL addShoppingItem('${user.toString()}',${list},${icount},'${item.toString()}');`);
      res.redirect('/l/'+list);
   }
});

app.post('/l/delItem/:list', function (req, res) {
   if (!req.session.uname) {
      res.redirect('/login');
   } else {
      var list = req.params.list;
      var items = req.body.items;
      var query = `DELETE FROM ShoppingList_Item WHERE sItem_id = ${items[0]}`;
      for (i = 1; i < items.length; i++) {
         query += ` OR sItem_id = ${items[i]}`;
      }
      con.query(query+`;`);
      res.redirect('/l/'+list);
   }
});


app.post('/l/crossItem/:list', function (req, res) {
   if (!req.session.uname) {
      res.redirect('/login');
   } else {
      var list = req.params.list;
      var items = req.body.items;
      var check = req.body.check;
      console.log(check);
      var query = `UPDATE ShoppingList_Item SET checked = ${check} WHERE sItem_id = ${items}`;
      con.query(query+`;`);
      res.redirect('/l/'+list);
   }
});

app.post('/l/delList/', function (req, res) {
   if (!req.session.uname) {
      res.redirect('/login');
   } else {
      var list = req.body.list;
      console.log(list);
      con.query(`DELETE FROM ShoppingList WHERE list_id = ${list};`);
      res.redirect('/');
   }
});

app.post('/:other?/addList', function (req, res) {
   if (!req.session.uname) {
      res.redirect('/login');
   } else {
      var user = mysql.escape(req.session.uname);
      var list = mysql.escape(req.body.listName);
      var color = mysql.escape(req.body.color);
      console.log(list+", "+color);
      con.query(`INSERT INTO ShoppingList (list_name,owner,listColor) VALUES (${list.toString()},${user.toString()},${color.toString()});`);
      res.redirect('/');
   }
});

app.post('/editInfo', function (req, res) {
   if (!req.session.uname) {
      res.redirect('/login');
   } else {
      var user = mysql.escape(req.session.uname);
      var fname = mysql.escape(req.body.fname);
      var lname = mysql.escape(req.body.lname);
      var email = mysql.escape(req.body.email);
      var pass1 = mysql.escape(req.body.password);
      var pass2 = mysql.escape(req.body.password2);
      console.log(req.body.fname);
      console.log(lname);
      console.log(email);
      if (req.body.fname && req.body.lname){
         console.log("update name");
         con.query(`UPDATE User SET fname = ${fname}, lname = ${lname} WHERE uname = ${user};`);
         req.session.fname = req.body.fname;
         req.session.lname = req.body.lname;
         res.redirect('/myAccount');
      } else if (req.body.email) {
         var emailExists = con.query(`SELECT uname FROM User WHERE email = ${email.toString()};`,
            function(err, email) {
               if (email.length > 0) {
                  let listData = con.query(`SELECT * FROM ShoppingList WHERE ShoppingList.owner = ${user.toString()}`,
                     function (err, listData) {
                        res.render('user.handlebars', {
                           title: req.session.uname,
                           uname: req.session.uname,
                           fname: req.session.fname,
                           lname: req.session.lname,
                           email: req.session.email,
                           headerlists: listData,
                           emailerror: 'The email you entered is already in use!'
                        });
                  });
                  return true;
               }
               else {
                  con.query(`UPDATE User SET email = ${email} WHERE uname = ${user};`);
                  req.session.email = req.body.email;
                  res.redirect('/myAccount');
               }
            });
      } else if (pass1 != '' && pass2 != '') {
         if (pass1 != pass2) {
            var token = crypto.randomBytes(16).toString('hex');
            console.log(token);
            con.query(`DELETE FROM PasswordResetToken WHERE uname = ${user};`);
            con.query(`INSERT INTO PasswordResetToken (uname,token) VALUES (${user}, ${mysql.escape(token.toString())});`);
            res.redirect('/passwordReset/'+token);
         } else {
            //generate salt
            var salt = crypto.randomBytes(8).toString('hex');
            console.log(salt);
            //hash password
            var passwordHash = md5(pass1+salt);
            console.log(passwordHash);
            con.query(`UPDATE User SET password = '${passwordHash}', salt='${salt}' WHERE uname = ${user};`);
            res.redirect('/myAccount');
         }
      }
   }
});

app.post('/:editList/editList/:list', function (req, res) {
   if (!req.session.uname) {
      res.redirect('/login');
   } else {
      var user = mysql.escape(req.session.uname);
      var listid = mysql.escape(req.params.list);
      var list = mysql.escape(req.body.listName);
      var color = mysql.escape(req.body.color);
      console.log(listid+", "+list+", "+color);
      con.query(`UPDATE ShoppingList SET list_name = ${list}, listColor = ${color} WHERE list_id = ${listid};`);
      res.redirect('/');
   }
});

app.get('/:other?/myAccount', function (req, res, next) {
   if (!req.session.uname) {
      res.redirect('/login');
   } else {
      var user = mysql.escape(req.session.uname);
      console.log(user);
      let listData = con.query(`SELECT * FROM ShoppingList WHERE ShoppingList.owner = ${user.toString()}`,
         function (err, listData) {
         res.status(200).render('user', {
            title: user,
            uname: req.session.uname,
            fname: req.session.fname,
            lname: req.session.lname,
            email: req.session.email,
            headerlists: listData
         });
      });
   }
});

app.get('/login', function (req, res, next) {
   res.render('login.handlebars', {
      title: 'Login',
      layout: 'bare'
   });
});

app.get('/register', function (req, res, next) {
   res.render('register.handlebars', {
      title: 'Register',
      layout: 'bare'
   });
});

app.get('*', function (req, res) {
  res.status(404).render('404.handlebars', {
     title: '404',
     layout: 'bare'
  });
});

app.listen(port, function () {
    console.log("== Server listening on port", port);
});
