var mysql = require('mysql');
var env = process.env.NODE_ENV || 'development';
var config = require('./config')[env];
var con = require('./sqlConfig');

con.start(config.database);

const USER = 1;
const LIST_VIEW = 2;
const LIST_EDIT = 3;
const LIST_OWNER = 4;

const OWNER = "OWNER";
const SHARE_EDIT = "EDIT";
const SHARE_VIEW = "VIEW";
const QUERY_ONLY = false;
const EXECUTE = true;

var path = require('path');
const url = require('url');
const querystring = require('querystring');
var express = require('express');
var exphbs = require('express-handlebars');
var bodyParser = require('body-parser');
var session = require('client-sessions');
var md5 = require('md5');
var crypto = require('crypto');
const bcrypt = require('bcrypt');
const saltRounds = 10;

var nodemailer = require('nodemailer');
var nodemailerhbs = require('nodemailer-express-handlebars');

var fs = require('fs');

var app = express();
var port = process.env.PORT || config.server.port;
app.engine('handlebars', exphbs({ defaultLayout: 'main' }));
app.set('view engine', 'handlebars');

app.use(express.static('public'));
app.use('/:url', express.static('public'));
app.use(bodyParser.urlencoded({extended : false}));
app.use('*', (req,res,next) => {console.log(req.headers); next();});
app.post('*', (req,res,next) => {req.query = querystring.parse(url.parse(req.headers.referer).query); next();});
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

async function authorize(session, res, authLevel, page, execute) {
  if (!session.uname) {
    res.redirect('/login?redirect='+page.redirect);
    return false;
  } else if (authLevel == USER) {
    return true;
  } else if (authLevel == LIST_VIEW || authLevel == LIST_EDIT || authLevel == LIST_OWNER){
    let auth = "";
    let list_id = page.list;
    console.log(list_id);
    let [list] = await con.asyncQuery(`SELECT * FROM ShoppingList WHERE list_id = '${list_id}';`);
    console.log(list);
    if (list[0].owner == session.uname) {
      owner = true;
    } else {
      let [shares] = await con.asyncQuery(`SELECT * FROM Shared_list WHERE list_id = '${list_id}' & share_user = '${session.uname}' & accepted = '1';`);
      if (shares[0]) {
        auth = shares[0].share_perms;
      }
    }
    if (authLevel == LIST_OWNER && (list[0].owner == session.uname)) {
      return true;
    } else if (authLevel == LIST_EDIT && (auth == SHARE_EDIT || list[0].owner == session.uname)) {
      return true;
    } else if (authLevel == LIST_VIEW && (auth == SHARE_VIEW || auth == SHARE_EDIT || list[0].owner == session.uname)) {
      return true;
    } else if (execute){
      res.status(404).render('404.handlebars', {
        title: '404',
        layout: 'bare'
      });
      return false;
    }
  } else if (execute){
    res.status(404).render('404.handlebars', {
      title: '404',
      layout: 'bare'
    });
    return false;
  }
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


app.get('/home', async function (req, res, next) {
  if (!req.session.uname) {
    res.redirect('/login?redirect=/home');
  } else {
    const [colors] = await con.asyncQuery(`SELECT * FROM colors`);
    var user = req.session.uname;
    console.log(user);
    let [sharedlists] = await con.asyncQuery(`SELECT * FROM Shared_list NATURAL JOIN ShoppingList WHERE share_user = '${user.toString()}';`)
    console.log(sharedlists);
    let listData = con.query(`SELECT * FROM ShoppingList WHERE ShoppingList.owner = '${user.toString()}'`,
    function (err, listData) {
      res.status(200).render('home', {
        title: 'Home',
        uname: req.session.uname,
        fname: req.session.fname,
        lname: req.session.lname,
        headerlists: listData,
        sharedlists: sharedlists,
        colors: colors
      });
    });
  }
});

function updatePassword(uname,passIn) {
  bcrypt.hash(passIn, saltRounds, function(err, hash) {
    //store hash
    con.query(`UPDATE User SET password = '${hash}', salt='', hash='BCR' WHERE uname = ${uname.toString()};`);
    console.log(hash);
  });
}

app.post('/login', function(req, res) {
  var uname = mysql.escape(req.body.username);
  con.query(`SELECT * FROM User WHERE uname = ${uname.toString()};`,
    function(err, user) {
      if (!user || user.length == 0) {
        res.redirect("/login/?error="+'Invalid username or password.'+"&redirect="+req.query.redirect);
      } else {
        var passIn = mysql.escape(req.body.password);
        var salt = user[0].salt;
        var passwordHash;
        if (user[0].hash == "MD5") {
          var passwordHash = md5(passIn+salt);
          if (passwordHash === user[0].password) {
            //convert to BCR
            updatePassword("\'"+user[0].uname+"\'",passIn);
            //set values
            req.session.uname = user[0].uname;
            req.session.fname = user[0].fname;
            req.session.lname = user[0].lname;
            req.session.email = user[0].email;
            req.session.showAlert = user[0].showAlert;
            //go home
            console.log(req.query);
            if (req.query.redirect) {
              res.redirect(req.query.redirect);
            } else{
              res.redirect('/');
            }
          } else {
            res.redirect("/login/?error="+'Invalid username or password.'+"&redirect="+req.query.redirect);
          }
        } else if (user[0].hash == "BCR") {
          bcrypt.compare(passIn, user[0].password, function(err, result) {
            if (result == true) {
              //set values
              req.session.uname = user[0].uname;
              req.session.fname = user[0].fname;
              req.session.lname = user[0].lname;
              req.session.email = user[0].email;
              req.session.showAlert = user[0].showAlert;
              //go home
              console.log(req.query);
              if (req.query.redirect) {
                res.redirect(req.query.redirect);
              } else{
                res.redirect('/');
              }
            }
            if (result == false) {
              res.redirect("/login/?error="+'Invalid username or password.'+"&redirect="+req.query.redirect);
            }
          });
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
        bcrypt.hash(pass1, saltRounds, function(err, hash) {
          con.query(`INSERT INTO User (uname,fname,lname,email,password,hash)
                    VALUES (${uname.toString()},${fname.toString()},${lname.toString()},${email.toString()},'${hash.toString()}','BCR');`,
          function (err, userData) {
            console.log(err);
          });
        });
        req.session.uname = req.body.username;
        req.session.fname = req.body.fname;
        req.session.lname = req.body.lname;
        req.session.email = req.body.email;
        if (req.query.redirect) {
          res.redirect(req.query.redirect);
        } else{
          res.redirect('/');
        }
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
          link: config.url+'/passwordReset/'+token,
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
      updatePassword(reset[0].uname,password)
      con.query(`DELETE FROM PasswordResetToken WHERE uname = '${reset[0].uname.toString()}';`);

      req.session.uname = req.body.username;
      req.session.fname = req.body.fname;
      req.session.lname = req.body.lname;
      req.session.email = req.body.email;
      res.redirect('/');
    });
  }
});

app.get('/l/:list', async function (req, res, next) {
  if (await authorize(req.session,res,LIST_VIEW,{redirect:'/l/'+req.params.list,list:req.params.list},EXECUTE)){ //has view
    let edit = await authorize(req.session,res,LIST_EDIT,{redirect:'/l/'+req.params.list,list:req.params.list},QUERY_ONLY); //has view
    const [colors] = await con.asyncQuery(`SELECT * FROM colors`);
    var user = req.session.uname;
    var list = req.params.list;
    var showAlert = req.session.showAlert;
    var fname = req.session.fname;
    var lname = req.session.lname;
    console.log(showAlert);
    if (showAlert == 0) {
      showAlert = false;
    }
    list = mysql.escape(list);
    con.query(`SELECT * FROM ShoppingList WHERE ShoppingList.list_id = ${list}`,
    function (err, singleListData) {
      if (singleListData.length == 0){
        next(); //render 404
      } else {
        let owner = false;
        if (singleListData[0].owner == user) {
          owner = true;
        }
        con.query(`SELECT * FROM ShoppingList NATURAL JOIN ShoppingList_Item NATURAL JOIN Item WHERE ShoppingList_Item.list_id = ${mysql.escape(req.params.list)}`,
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
              console.log("Header Lists: " + listData);
              res.status(200).render('shoppingList', {
                title: singleListData[0].list_name,
                fname: fname,
                lname: lname,
                list: singleListData,
                autofillItem: autofillData,
                listItem: listItemData,
                headerlists: listData,
                colors: colors,
                buttonDisabled: buttonDisabled,
                showAlert: showAlert,
                edit: edit,
                owner: owner
              });
            });
          });
        });
      }
    });
  }
});

app.post('/l/:list/showAlert', async function (req, res) {
  if (await authorize(req.session,res,USER,{redirect:'/l/'+req.params.list,list:req.params.list},EXECUTE)){ //has view
    var user = req.session.uname;
    var dontshow = req.body.dontshow;
    var list = req.params.list;
    console.log(dontshow);
    if (dontshow == 'Show') {
      req.session.showAlert = 0;
      con.query(`UPDATE User SET showAlert = FALSE WHERE uname = '${user.toString()}';`);
    }
    res.redirect('/l/'+list);
  }
});

app.post('/l/:list/addItem', async function (req, res) {
  if (await authorize(req.session,res,LIST_EDIT,{redirect:'/l/'+req.params.list,list:req.params.list},EXECUTE)){ //has edit
    var user = req.session.uname;
    var list = req.params.list;
    var icount = req.body.icount;
    console.log("icount: \'"+icount+"\'");
    if (!icount) {
      icount = 'NULL';
    }
    var item = req.body.itemName;
    console.log(user+", "+list+", "+icount+", "+item);
    con.query(`CALL addShoppingItem('${user.toString()}',${list},${icount},'${item.toString()}');`);
    res.redirect('/l/'+list);
  }
});

app.post('/l/:list/delItem', async function (req, res) {
  if (await authorize(req.session,res,LIST_EDIT,{redirect:'/l/'+req.params.list,list:req.params.list},EXECUTE)){ //has edit
    var list = req.params.list;
    var items = req.body.items;
    for (i = 0; i < items.length; i++) {
      con.query(`CALL deleteShoppingItem(${items[i]}, ${list});`);
    }
    res.redirect('/l/'+list);
   }
});


app.post('/l/:list/crossItem', async function (req, res) {
  if (await authorize(req.session,res,LIST_EDIT,{redirect:'/l/'+req.params.list,list:req.params.list},EXECUTE)){ //has edit
    var list = req.params.list;
    var items = req.body.items;
    var check = req.body.check;
    console.log(check);
    con.query(`CALL setChecked(${items},${check});`);
    res.redirect('/l/'+list);
  }
});

app.post('/l/:list/share/', async function (req, res) {
  if (await authorize(req.session,res,LIST_OWNER,{redirect:'/l/'+req.params.list,list:req.params.list},EXECUTE)){ //has owner
    var user = req.session.uname;
    var list = req.params.list;
    var email = req.body.email;
    var perms = req.body.perms;
    console.log(user+", "+list+", "+email+", "+perms);

    //generate key
    var share_key = crypto.randomBytes(16).toString('hex');
    //add Keyed Share

    con.query(`INSERT INTO Shared_list (share_key,list_id,owner,share_email,share_perms) VALUES('${share_key}','${list}','${user}','${email}','${perms}')
                ON DUPLICATE KEY UPDATE share_key='${share_key}', list_id='${list}', owner='${user}', share_email='${email}', share_perms='${perms}'`);
    let share_user = await con.asyncQuery(`SELECT DISTINCT * FROM User WHERE email = '${email}'`);
    share_user = share_user[0];
    console.log(share_user);
    //send email
    ViewOption(transporter,nodemailerhbs);
    let HelperOptions = {
      from: '"Loris-List" <noreply@horine.dev>',
      to: email,
      subject: user + ' would like to share a list with you - Lori\'s List',
      template: 'share',
      context: {
        uname: user,
        share_user: share_user[0],
        perms: perms,
        list_name: list,
        link: config.url+'/share/'+share_key,
        register_link: config.url+'/register'
      }
    };
    transporter.sendMail(HelperOptions, (error,info) => {
      if(error) {
        console.log(error);
        res.json(error);
      }
      console.log("email is sent");
      console.log(info);
      res.json(info)
    });
    console.log("email sent to "+email);
    res.redirect('/l/'+list);
   }
});

app.get('/share/:share_key', async function (req, res, next) {
  if (await authorize(req.session,res,USER,{redirect:'/share/'+req.params.share_key},EXECUTE)){ //is logged in
    let [share_line] = await con.asyncQuery(`SELECT DISTINCT * FROM Shared_list WHERE share_key = ${mysql.escape(req.params.share_key)};`);
    let [share_list] = await con.asyncQuery(`SELECT * FROM ShoppingList WHERE list_id = '${share_line[0].list_id}';`);
    let [listData] = await con.asyncQuery(`SELECT * FROM ShoppingList WHERE ShoppingList.owner = ${mysql.escape(req.session.uname)}`);
    console.log(share_line);
    console.log(share_list);
    console.log(req.session);
    if (share_line[0].share_email == req.session.email) {
      res.status(200).render('shareConfirmation', {
        share_key: req.params.share_key,
        share_list: share_list[0],
        share_perms: share_line[0].share_perms,
        headerlists: listData
      });
    } else { //send 404
      next();
    }
  }
});

app.post('/shareConfirmation/:share_key', async function (req, res, next) {
  if (await authorize(req.session,res,USER,{redirect:'/login?redirect=/shareConfirmation/'+req.params.share_key},EXECUTE)){ //is logged in
    let [share_line] = await con.asyncQuery(`SELECT DISTINCT * FROM Shared_list WHERE share_key = ${mysql.escape(req.params.share_key)};`);
    let [share_list] = await con.asyncQuery(`SELECT * FROM ShoppingList WHERE list_id = '${share_line[0].list_id}';`);
    let [listData] = await con.asyncQuery(`SELECT * FROM ShoppingList WHERE ShoppingList.owner = ${mysql.escape(req.session.uname)}`);
    if (req.body.confirm == 'ACCEPT') {
      await con.asyncQuery(`UPDATE Shared_list SET accepted = true, share_user = '${req.session.uname}', share_email = '${req.session.email}' WHERE share_key = ${mysql.escape(req.params.share_key)};`);
      res.status(200).render('shareAccept', {
        share_list: share_list[0],
        share_perms: share_line[0].share_perms,
        headerlists: listData
      });
    } else if (req.body.confirm == 'DENY'){
      await con.asyncQuery(`DELETE FROM Shared_list WHERE share_key = ${mysql.escape(req.params.share_key)};`);
      res.status(200).render('shareDeny', {
        share_list: share_list[0],
        share_perms: share_line[0].share_perms,
        headerlists: listData
      });
    } else { //send 404
      next();
    }
  }
});

app.post('/l/:list/unsub/', async function (req,res) {
  if (await authorize(req.session,res,LIST_EDIT,{redirect:'/home',list:req.params.list},EXECUTE)){ //has edit
    await con.asyncQuery(`DELETE FROM Shared_list WHERE list_id = '${req.params.list}' & share_user = '${req.params.uname}'};`);
  }
});

app.post('/l/:list/delList/',  async function (req, res) {
   if (await authorize(req.session,res,LIST_OWNER,{redirect:'/home',list:req.params.list},EXECUTE)){ //has owner
      var list = req.body.list;
      console.log(list);
      con.query(`CALL deleteList(${list});`);
      res.redirect('/');
   }
});

app.post('/:other?/addList', async function (req, res) {
  let redirect = "/";
  if (req.params.other) {redirect+=req.params.other;}
  if (await authorize(req.session,res,USER,{redirect:redirect},EXECUTE)){ //is logged in
    var user = mysql.escape(req.session.uname);
    var list = mysql.escape(req.body.listName);
    var color = mysql.escape(req.body.color);
    console.log(list+", "+color);
    con.query(`CALL addList(${list.toString()},${user.toString()},${color.toString()});`);
    con.query(`SELECT * FROM ShoppingList WHERE Owner = ${user.toString()} ORDER BY last_change DESC;`, function(err,data) {
      console.log(data[0].list_id);
      res.redirect('/l/'+data[0].list_id);
    });
  }
});

app.post('/editInfo', async function (req, res) {
  if (await authorize(req.session,res,USER,{redirect:'/myAccount'},EXECUTE)){ //is logged in
    const [colors] = await con.asyncQuery(`SELECT * FROM colors`);
    var user = mysql.escape(req.session.uname);
    var fname = mysql.escape(req.body.fname);
    var lname = mysql.escape(req.body.lname);
    var email = mysql.escape(req.body.email);
    var pass1 = mysql.escape(req.body.password);
    var pass2 = mysql.escape(req.body.password2);
    console.log("F: "+fname);
    console.log("L: "+lname);
    console.log("E: "+email);
    console.log("U: "+user);
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
              colors: colors,
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
        //console.log(user);
        updatePassword(user,pass1);
        res.redirect('/myAccount');
      }
    }
  }
});

app.post('/l/:list/editList', async function (req, res) {
  if (await authorize(req.session,res,LIST_OWNER,{redirect:'/home',list:req.params.list},EXECUTE)){ //has owner
    var user = mysql.escape(req.session.uname);
    var listid = mysql.escape(req.params.list);
    var list = mysql.escape(req.body.listName);
    var color = mysql.escape(req.body.color);
    console.log(listid+", "+list+", "+color);
    con.query(`CALL editList(${listid},${list},${color});`);
    res.redirect('/');
  }
});

app.get('/:other?/myAccount', async function (req, res, next) {
  if (await authorize(req.session,res,USER,{redirect:'/myAccount'},EXECUTE)){ //is logged in
    const [colors] = await con.asyncQuery(`SELECT * FROM colors`);
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
        headerlists: listData,
        colors: colors
      });
    });
  }
});

app.get('/login', function (req, res, next) {
  res.render('login.handlebars', {
      title: 'Login',
      layout: 'bare',
      error: req.query.error
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
