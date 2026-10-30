var mysql = require('mysql');
var env = process.env.NODE_ENV || 'development';
var config = require('./config')[env];
var con = require('./sqlConfig');
const accounts = require('./lib/accounts');

// Secrets come from config.js (which is gitignored) or from environment
// variables. They must never be committed to the repository.
function requireSetting(name, value) {
  if (!value) {
    console.error('Missing required setting "' + name + '". Set it in config.js (see exampleConfig.js) or as an environment variable.');
    process.exit(1);
  }
  return value;
}
const SESSION_CFG = config.session || {};
const MAIL = config.mail || {};
const SESSION_SECRET = requireSetting('session.secret (SESSION_SECRET)', process.env.SESSION_SECRET || SESSION_CFG.secret);
const MAIL_USER = requireSetting('mail.user (SMTP_USER)', process.env.SMTP_USER || MAIL.user);
const MAIL_PASS = requireSetting('mail.pass (SMTP_PASS)', process.env.SMTP_PASS || MAIL.pass);
// Only send the session cookie over HTTPS when the node process itself sees
// TLS (or trusts a proxy that says so). Off by default so existing deployments
// behind a TLS-terminating proxy keep working until it is switched on.
const COOKIE_SECURE = (process.env.COOKIE_SECURE !== undefined) ? (process.env.COOKIE_SECURE === 'true') : !!SESSION_CFG.cookieSecure;

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

const LOGIN_ERROR = 'Invalid username or password.';

var path = require('path');
var express = require('express');
var exphbs = require('express-handlebars');
var bodyParser = require('body-parser');
var session = require('client-sessions');
var md5 = require('md5');
var crypto = require('crypto');
// bcryptjs is a pure JavaScript bcrypt: same hash format and same calls as the
// native "bcrypt" package, but nothing to compile or download on the server.
const bcrypt = require('bcryptjs');
const saltRounds = 10;
const passwords = require('./lib/passwords').create({
  bcrypt: bcrypt,
  escape: function (value) { return mysql.escape(value); },
  rounds: saltRounds,
  log: console.log
});
const createLimiter = require('./lib/rateLimit').createLimiter;
const failureKeysFor = require('./lib/rateLimit').failureKeys;

var nodemailer = require('nodemailer');
var nodemailerhbs = require('nodemailer-express-handlebars');

var fs = require('fs');

var app = express();
var port = process.env.PORT || config.server.port;

const viewHelpers = require('./lib/viewHelpers');

var handlebars = exphbs.create({
    defaultLayout: 'main',
    extname: '.handlebars',
    helpers: viewHelpers
});

app.engine('.handlebars', handlebars.engine);
app.set('view engine', 'handlebars');

// ---------------------------------------------------------------------------
// Input helpers.
//
// Everything that comes from a request (body, params, query) is untrusted.
// All SQL below uses "?" placeholders, and values are first coerced to a plain
// string or integer. The coercion matters: the mysql library expands an
// object passed to "?" into "`key` = value" pairs, and JSON request bodies can
// contain objects.
// ---------------------------------------------------------------------------
const validate = require('./lib/validate');
const asString = validate.asString;
const toId = validate.toId;
const parseCount = validate.parseCount;
const isHexColor = validate.isHexColor;

// Only ever redirect to a path on this site: one leading slash, no "//" or
// "/\" (which browsers treat as a different host), no control characters.
function safeRedirect(target, fallback) {
  if (typeof target === 'string' && /^\/(?![\/\\])/.test(target) && !/[\u0000-\u001f\u007f]/.test(target)) {
    return target;
  }
  return fallback;
}

function loginErrorUrl(req, message) {
  var target = '/login/?error=' + encodeURIComponent(message || LOGIN_ERROR);
  var redirect = safeRedirect(req.query.redirect, null);
  if (redirect) {
    target += '&redirect=' + encodeURIComponent(redirect);
  }
  return target;
}

// Express 4 does not catch rejected promises from async handlers. Without this
// a single failed database call would be an unhandled rejection that takes the
// whole process down.
function route(handler) {
  return function (req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const isEmail = validate.isEmail;
const passwordProblem = validate.passwordProblem;
const RESET_TOKEN_HOURS = validate.RESET_TOKEN_HOURS;

// ---------------------------------------------------------------------------
// Rate limits. req.ip is the real visitor address because Express trusts the
// X-Forwarded-For header that Apache (on this machine) adds.
// ---------------------------------------------------------------------------
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const LOGIN_LIMITED = 'Too many attempts. Please wait a few minutes and try again.';
// failed logins / password checks: per address and username, and per address
const failedPerUser = createLimiter({ max: 5, windowMs: FIFTEEN_MINUTES });
const failedPerIp = createLimiter({ max: 30, windowMs: FIFTEEN_MINUTES });
// password reset emails per address, and shared-list emails per account
const resetRequests = createLimiter({ max: 5, windowMs: ONE_HOUR });
const shareRequests = createLimiter({ max: 20, windowMs: ONE_HOUR });
// sign-ups through the API, per address
const registrations = createLimiter({ max: 10, windowMs: ONE_HOUR });

function failureKeys(req, uname) {
  return failureKeysFor(req.ip, uname);
}

// ---------------------------------------------------------------------------
// CSRF: refuse state-changing requests that a browser says came from another
// site. Origin is checked first, then Referer. Requests that carry neither
// (non-browser clients) are let through, as they cannot ride on a victim's
// cookies.
// ---------------------------------------------------------------------------
var ALLOWED_ORIGIN = null;
try {
  ALLOWED_ORIGIN = new URL(config.url).origin;
} catch (e) {
  console.log('config.url is not an absolute URL; only POSTs from the same host will be accepted.');
}

function originCheck(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  var source = req.headers.origin || req.headers.referer;
  if (!source) {
    return next();
  }
  var parsed;
  try {
    parsed = new URL(source);
  } catch (e) {
    return res.status(403).send('Forbidden');
  }
  if (parsed.origin === ALLOWED_ORIGIN || parsed.host === req.headers.host) {
    return next();
  }
  return res.status(403).send('Forbidden');
}

app.disable('x-powered-by');
// Apache runs on this machine and adds X-Forwarded-For / X-Forwarded-Proto.
// Only believe those headers when the request comes from the loopback address.
app.set('trust proxy', 'loopback');
app.use(function (req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
// The JSON API for the mobile apps (see docs/API.md). It signs requests with
// bearer tokens instead of cookies, so it is mounted before the cookie session
// and the browser CSRF check, which would only get in its way.
const apiTokens = require('./lib/apiTokens').create({ con: con, log: console.log });
const api = require('./lib/api').create({
  con: con,
  passwords: passwords,
  tokens: apiTokens,
  config: config,
  limiters: {
    failedPerUser: failedPerUser,
    failedPerIp: failedPerIp,
    resetRequests: resetRequests,
    shareRequests: shareRequests,
    registrations: registrations
  },
  failureKeys: failureKeysFor,
  updatePassword: updatePassword,
  sendMail: sendTemplateMail,
  log: console.log
});
app.use('/api/v1', require('./lib/apiRouter').create(express, api, {
  events: require('./lib/apiEvents').create({ api: api, log: console.log }),
  idempotency: require('./lib/idempotency').create()
}));
con.asyncQuery('SELECT 1 FROM ApiToken LIMIT 1').catch(function (e) {
  if (e && e.code === 'ER_NO_SUCH_TABLE') {
    console.log('API: the ApiToken table does not exist yet, so nobody can sign in to the mobile API. Run migrations/001_api_tokens.sql to create it.');
  }
});

// Lets the iPhone and Android apps open invitation and password-reset links (see
// lib/appLinks.js). Before express.static, which would skip the .well-known folder.
const appLinkFiles = require('./lib/appLinks').mount(app, config.appLinks);
if (appLinkFiles.apple || appLinkFiles.android) {
  console.log('App links: serving ' + [appLinkFiles.apple && 'iOS', appLinkFiles.android && 'Android'].filter(Boolean).join(' and ') + ' association file(s).');
}

app.use(express.static('public'));
app.use('/:url', express.static('public'));
app.use(originCheck);
app.use(bodyParser.urlencoded({extended : false}));
app.use(bodyParser.json());
// TLS ends at the Apache reverse proxy, so Node itself only sees plain HTTP.
// Two libraries refuse to issue a Secure cookie on a connection they do not
// think is encrypted, and client-sessions silently drops the cookie when that
// happens (every login would bounce straight back to the login page):
//   * the cookies library, which looks at req.protocol. "trust proxy" (set
//     above) makes Express take that from X-Forwarded-Proto, but only when the
//     request comes from the loopback address, i.e. from Apache on this machine.
//   * client-sessions itself, which looks at req.connection.proxySecure.
// This is only safe because the server listens on the loopback address (see
// app.listen below), so nothing but the proxy can set that header.
if (COOKIE_SECURE) {
  app.use(function (req, res, next) {
    if (req.protocol === 'https') {
      req.connection.proxySecure = true;
    }
    next();
  });
}
app.use(session({
  cookieName: 'session',
  secret: SESSION_SECRET,
  duration: 365 * 24 * 60 * 60 * 1000, //1 day
  activeDuration: 365 * 24 * 60 * 60 * 1000,
  cookie: {
    httpOnly: true,
    secure: COOKIE_SECURE
  }
}));

let transporter = nodemailer.createTransport({
  host: MAIL.host || "smtp.gmail.com",
  port: MAIL.port || 465,
  secure: (MAIL.secure !== undefined) ? MAIL.secure : true, // true for 465, false for other ports
  auth: {
    user: MAIL_USER,
    pass: MAIL_PASS
  }
});

let ViewOption = (transport, hbs) => {
  transport.use('compile', hbs({
    viewEngine: {
      extName: '.hbs',
      partialsDir: 'views/partials',
      layoutsDir: 'views/layouts',
      defaultLayout: 'email.handlebars',
      helpers: viewHelpers,
    },
    viewPath: 'views/email',
    extName: '.handlebars'
  }));
}

// Send a templated email (views/email/<template>.handlebars). Failures are
// logged, not thrown, so a mail problem never fails the request.
function sendTemplateMail(template, to, subject, context) {
  ViewOption(transporter, nodemailerhbs);
  transporter.sendMail({
    from: '"Loris-List" <noreply@horine.dev>',
    to: to,
    subject: subject,
    template: template,
    context: context
  }, (error) => {
    if (error) {
      console.log(error);
    }
  });
}

function renderNotFound(res) {
  res.status(404).render('404.handlebars', {
    title: '404',
    layout: 'bare'
  });
}

async function authorize(session, res, authLevel, page, execute) {
  if (!session.uname) {
    res.redirect('/login?redirect=' + encodeURIComponent(page.redirect));
    return false;
  }
  // The account may have been deleted (from an app, or another browser) since
  // this cookie was issued; sign the cookie out instead of acting for nobody.
  let [account] = await con.asyncQuery('SELECT uname FROM User WHERE uname = ?', [session.uname]);
  if (account.length === 0) {
    session.reset();
    res.redirect('/login?redirect=' + encodeURIComponent(page.redirect));
    return false;
  }
  if (authLevel == USER) {
    return true;
  }
  if (authLevel == LIST_VIEW || authLevel == LIST_EDIT || authLevel == LIST_OWNER) {
    let list_id = toId(page.list);
    let list = [];
    if (list_id !== null) {
      [list] = await con.asyncQuery('SELECT * FROM ShoppingList WHERE list_id = ?', [list_id]);
    }
    if (list.length > 0) {
      let isOwner = (list[0].owner == session.uname);
      let auth = "";
      if (!isOwner) {
        let [shares] = await con.asyncQuery('SELECT * FROM Shared_list WHERE list_id = ? AND share_user = ?', [list_id, session.uname]);
        if (shares[0]) {
          auth = shares[0].share_perms;
        }
      }
      if (authLevel == LIST_OWNER && isOwner) {
        return true;
      } else if (authLevel == LIST_EDIT && (auth == SHARE_EDIT || isOwner)) {
        return true;
      } else if (authLevel == LIST_VIEW && (auth == SHARE_VIEW || auth == SHARE_EDIT || isOwner)) {
        return true;
      }
    }
  }
  // not allowed (or the list does not exist)
  if (execute) {
    renderNotFound(res);
  }
  return false;
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


app.get('/home', route(async function (req, res, next) {
  if (await authorize(req.session,res,USER,{redirect:'/home'},EXECUTE)){ //logged in
    const [colors] = await con.asyncQuery('SELECT * FROM colors');
    var user = req.session.uname;
    let [sharedlists] = await con.asyncQuery('SELECT * FROM Shared_list NATURAL JOIN ShoppingList WHERE share_user = ?', [user]);
    let [listData] = await con.asyncQuery('SELECT * FROM ShoppingList WHERE ShoppingList.owner = ?', [user]);
    res.status(200).render('home', {
      title: 'Home',
      uname: req.session.uname,
      fname: req.session.fname,
      lname: req.session.lname,
      headerlists: listData,
      sharedlists: sharedlists,
      colors: colors
    });
  }
}));

async function updatePassword(uname, passIn) {
  const hash = await passwords.hash(passIn);
  await con.asyncQuery("UPDATE User SET password = ?, salt = '', hash = 'BCR' WHERE uname = ?", [hash, uname]);
}

app.post('/login', route(async function(req, res) {
  var uname = asString(req.body.username);
  var password = asString(req.body.password);
  var keys = failureKeys(req, uname);
  if (failedPerUser.isLimited(keys.user) || failedPerIp.isLimited(keys.ip)) {
    console.log('login: too many failed attempts from ' + req.ip);
    res.redirect(loginErrorUrl(req, LOGIN_LIMITED));
    return;
  }
  let [user] = await con.asyncQuery('SELECT * FROM User WHERE uname = ?', [uname]);
  var found = !!user && user.length > 0;
  // An unknown username takes as long to answer as a wrong password.
  var result = await passwords.verify(password, found ? user[0].password : null);
  if (found && result.ok) {
    failedPerUser.reset(keys.user);
    if (result.upgrade) {
      // password was stored in the older form; store it in the current one
      try {
        await updatePassword(user[0].uname, password);
      } catch (e) {
        console.log('login: could not update the stored password for "' + user[0].uname + '":', e.message);
      }
    }
    //set values
    req.session.uname = user[0].uname;
    req.session.fname = user[0].fname;
    req.session.lname = user[0].lname;
    req.session.email = user[0].email;
    req.session.showAlert = user[0].showAlert;
    //go home
    res.redirect(safeRedirect(req.query.redirect, '/home'));
  } else {
    failedPerUser.hit(keys.user);
    failedPerIp.hit(keys.ip);
    console.log('login: failed for ' + JSON.stringify(uname.slice(0, 64)));
    res.redirect(loginErrorUrl(req));
  }
}));

app.get('/logout', function (req, res, next) {
  req.session.reset();
  res.redirect('/');
});

app.post('/register', route(async function(req, res) {
  var fname = asString(req.body.fname);
  var lname = asString(req.body.lname);
  var uname = asString(req.body.username);
  var email = asString(req.body.email);
  var pass1 = asString(req.body.password);
  var pass2 = asString(req.body.password2);
  let [emailIn] = await con.asyncQuery('SELECT uname FROM User WHERE email = ?', [email]);
  let [users] = await con.asyncQuery('SELECT uname FROM User WHERE uname = ?', [uname]);
  var error = null;
  if (!uname || !email || !pass1) {
    error = 'Username, email and password are required.';
  } else if (emailIn.length > 0) {
    error = 'Email is already in use!';
  } else if (users.length > 0 || await accounts.isRetired(con, uname)) {
    error = 'Username is already in use!';
  } else if (!isEmail(email)) {
    error = 'Please enter a valid email address.';
  } else if (pass1 != pass2) {
    error = 'Passwords must match.';
  } else {
    error = passwordProblem(pass1);
  }
  if (error) {
    res.render('register.handlebars', {
      title: 'Register',
      layout: 'bare',
      error: error
    });
    return;
  }
  const hash = await passwords.hash(pass1);
  await con.asyncQuery('INSERT INTO User (uname,fname,lname,email,password) VALUES (?,?,?,?,?)', [uname, fname, lname, email, hash]);
  req.session.uname = uname;
  req.session.fname = fname;
  req.session.lname = lname;
  req.session.email = email;
  res.redirect(safeRedirect(req.query.redirect, '/'));
}));

// Reset links stop working after RESET_TOKEN_HOURS.
async function findResetToken(token) {
  let [rows] = await con.asyncQuery(
    'SELECT * FROM PasswordResetToken NATURAL JOIN User WHERE token = ? AND PasswordResetToken.date_added > (NOW() - INTERVAL ' + RESET_TOKEN_HOURS + ' HOUR)',
    [token]);
  return rows;
}

app.get('/passwordReset/:token', route(async function(req, res, next) {
  var token = asString(req.params.token);
  let tokens = await findResetToken(token);
  if (tokens.length > 0) {
    res.render('passwordReset.handlebars',{
      title: 'Password Reset',
      layout: 'bare',
      token: token
    });
  } else {
    res.status(404).render('404.handlebars');
  }
}));

app.post('/passwordReset', route(async function(req, res) {
  var email = asString(req.body.email);
  // Each address can ask for a handful of reset emails per hour. The answer is
  // the same either way, so this does not reveal anything.
  var limited = resetRequests.isLimited(req.ip);
  resetRequests.hit(req.ip);
  if (!limited && isEmail(email)) {
    let [uEmail] = await con.asyncQuery('SELECT * FROM User WHERE email = ?', [email]);
    if (uEmail.length > 0) {
      //generate token
      var token = crypto.randomBytes(16).toString('hex');
      await con.asyncQuery('DELETE FROM PasswordResetToken WHERE date_added <= (NOW() - INTERVAL ' + RESET_TOKEN_HOURS + ' HOUR)');
      await con.asyncQuery('DELETE FROM PasswordResetToken WHERE uname = ?', [uEmail[0].uname]);
      await con.asyncQuery('INSERT INTO PasswordResetToken (uname,token,date_added) VALUES (?, ?, NOW())', [uEmail[0].uname, token]);
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
      transporter.sendMail(HelperOptions, (error) => {
        if (error) {
          console.log(error);
        }
      });
    }
  }
  // Respond the same way whether or not the email has an account, so this form
  // cannot be used to find out which addresses are registered.
  res.redirect('/login');
}));

app.post('/updatePassword/:token', route(async function(req, res) {
  var token = asString(req.params.token);
  var password = asString(req.body.password);
  var password2 = asString(req.body.password2);
  let reset = await findResetToken(token);
  if (reset.length == 0) {
    res.status(404).render('404.handlebars');
    return;
  }
  var problem = null;
  if (password != password2) {
    problem = 'Passwords must match.';
  } else {
    problem = passwordProblem(password);
  }
  if (problem) {
    res.status(400).render('passwordReset.handlebars', {
      title: 'Password Reset',
      layout: 'bare',
      token: token,
      error: problem
    });
    return;
  }
  await updatePassword(reset[0].uname, password);
  await con.asyncQuery('DELETE FROM PasswordResetToken WHERE uname = ?', [reset[0].uname]);
  req.session.reset();
  res.redirect('/');
}));

app.get('/l/:list', route(async function (req, res, next) {
  if (await authorize(req.session,res,LIST_VIEW,{redirect:'/l/'+req.params.list,list:req.params.list},EXECUTE)){ //has view
    let edit = await authorize(req.session,res,LIST_EDIT,{redirect:'/l/'+req.params.list,list:req.params.list},QUERY_ONLY); //has edit
    const [colors] = await con.asyncQuery('SELECT * FROM colors');
    var user = req.session.uname;
    var list = toId(req.params.list);
    var showAlert = req.session.showAlert;
    var fname = req.session.fname;
    var lname = req.session.lname;
    if (showAlert == 0) {
      showAlert = false;
    }
    let [singleListData] = await con.asyncQuery('SELECT * FROM ShoppingList WHERE ShoppingList.list_id = ?', [list]);
    if (singleListData.length == 0){
      next(); //render 404
    } else {
      let owner = false;
      if (singleListData[0].owner == user) {
        owner = true;
      }
      let [listItemData] = await con.asyncQuery('SELECT * FROM ShoppingList NATURAL JOIN ShoppingList_Item JOIN Item WHERE ShoppingList_Item.list_id = ? AND Item.item_id = ShoppingList_Item.item_id', [list]);
      var buttonDisabled = true;
      for (let i = 0; i < listItemData.length; i++) {
        if (listItemData[i].checked == 1) {
          buttonDisabled = false;
          break;
        }
      }
      let [autofillData] = await con.asyncQuery('SELECT * FROM Item WHERE Item.owner = ?', [user]);
      let [listData] = await con.asyncQuery('SELECT * FROM ShoppingList WHERE ShoppingList.owner = ?', [user]);
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
    }
  }
}));

app.post('/l/:list/showAlert', route(async function (req, res) {
  if (await authorize(req.session,res,USER,{redirect:'/l/'+req.params.list,list:req.params.list},EXECUTE)){ //logged in
    var user = req.session.uname;
    var dontshow = req.body.dontshow;
    var list = toId(req.params.list);
    if (dontshow == 'Show') {
      req.session.showAlert = 0;
      await con.asyncQuery('UPDATE User SET showAlert = FALSE WHERE uname = ?', [user]);
    }
    res.redirect(list === null ? '/home' : '/l/'+list);
  }
}));

app.post('/l/:list/addItem', route(async function (req, res) {
  if (await authorize(req.session,res,LIST_EDIT,{redirect:'/l/'+req.params.list,list:req.params.list},EXECUTE)){ //has edit
    var user = req.session.uname;
    var list = toId(req.params.list);
    var icount = parseCount(req.body.icount);
    var item = asString(req.body.itemName);
    if (item.trim() !== '') {
      await con.asyncQuery('CALL addShoppingItem(?,?,?,?)', [user, list, icount, item]);
    }
    res.redirect('/l/'+list);
  }
}));

app.post('/l/:list/delItem', route(async function (req, res) {
  if (await authorize(req.session,res,LIST_EDIT,{redirect:'/l/'+req.params.list,list:req.params.list},EXECUTE)){ //has edit
    var list = toId(req.params.list);
    var items = Array.isArray(req.body.items) ? req.body.items : [];
    for (let i = 0; i < items.length; i++) {
      var item = toId(items[i]);
      if (item !== null) {
        await con.asyncQuery('CALL deleteShoppingItem(?, ?)', [item, list]);
      }
    }
    res.redirect('/l/'+list);
   }
}));


app.post('/l/:list/crossItem', route(async function (req, res) {
  if (await authorize(req.session,res,LIST_EDIT,{redirect:'/l/'+req.params.list,list:req.params.list},EXECUTE)){ //has edit
    var list = toId(req.params.list);
    var item = toId(req.body.items);
    var check = Number(req.body.check) ? 1 : 0;
    // Having edit rights on this list must not allow changing an item that
    // belongs to someone else's list, so make sure the item is on this list.
    let [listItems] = await con.asyncQuery('SELECT * FROM ShoppingList NATURAL JOIN ShoppingList_Item JOIN Item WHERE ShoppingList_Item.list_id = ? AND Item.item_id = ShoppingList_Item.item_id', [list]);
    if (item === null || !listItems.some(function (row) { return row.sItem_id == item; })) {
      res.sendStatus(404);
      return;
    }
    await con.asyncQuery('CALL setChecked(?,?)', [item, check]);
    res.redirect('/l/'+list);
  }
}));

app.post('/l/:list/share/', route(async function (req, res) {
  if (await authorize(req.session,res,LIST_OWNER,{redirect:'/l/'+req.params.list,list:req.params.list},EXECUTE)){ //has owner
    var user = req.session.uname;
    var list = toId(req.params.list);
    var email = asString(req.body.email).trim().toLowerCase();
    var perms = asString(req.body.perms);
    if (perms != SHARE_EDIT && perms != SHARE_VIEW) {
      res.status(400).send('Invalid share request.');
      return;
    }
    if (!isEmail(email)) {
      res.status(400).send('Please enter a valid email address.');
      return;
    }
    // Each account can send a limited number of share emails per hour.
    if (shareRequests.isLimited(user)) {
      res.status(429).send('You have shared a lot of lists recently. Please try again in a while.');
      return;
    }
    shareRequests.hit(user);
    let [listRows] = await con.asyncQuery('SELECT list_name FROM ShoppingList WHERE list_id = ?', [list]);
    var listName = listRows.length > 0 ? listRows[0].list_name : '';

    //generate key
    var share_key = crypto.randomBytes(16).toString('hex');
    //add Keyed Share
    await con.asyncQuery(`INSERT INTO share_pending (share_key,list_id,list_owner,share_email,share_perms) VALUES(?,?,?,?,?)
                ON DUPLICATE KEY UPDATE share_key = ?, list_id = ?, list_owner = ?, share_email = ?, share_perms = ?`,
                [share_key, list, user, email, perms, share_key, list, user, email, perms]);
    let [share_user] = await con.asyncQuery('SELECT DISTINCT * FROM User WHERE email = ?', [email]);
    share_user = share_user[0];
    //send email
    ViewOption(transporter,nodemailerhbs);
    let HelperOptions = {
      from: '"Loris-List" <noreply@horine.dev>',
      to: email,
      subject: user + ' would like to share a list with you - Lori\'s List',
      template: 'share',
      context: {
        uname: user,
        // only what the email template needs, not the whole user row
        share_user: share_user ? { fname: share_user.fname, lname: share_user.lname } : undefined,
        perms: perms,
        // the email templates show {{list}}, the list's name
        list: listName,
        list_name: listName,
        link: config.url+'/share/'+share_key,
        register_link: config.url+'/register'
      }
    };
    transporter.sendMail(HelperOptions, (error) => {
      if (error) {
        console.log(error);
      }
    });
    res.redirect('/l/'+list);
   }
}));

app.get('/share/:share_key', route(async function (req, res, next) {
  var share_key = asString(req.params.share_key);
  if (await authorize(req.session,res,USER,{redirect:'/share/'+share_key},EXECUTE)){ //is logged in
    let [share_line] = await con.asyncQuery('SELECT DISTINCT * FROM share_pending WHERE share_key = ?', [share_key]);
    if (share_line.length == 0) {
      renderNotFound(res);
      return;
    }
    let [share_list] = await con.asyncQuery('SELECT * FROM ShoppingList WHERE list_id = ?', [share_line[0].list_id]);
    let [listData] = await con.asyncQuery('SELECT * FROM ShoppingList WHERE ShoppingList.owner = ?', [req.session.uname]);
    res.status(200).render('shareConfirmation', {
      share_key: share_key,
      share_list: share_list[0],
      share_perms: share_line[0].share_perms,
      headerlists: listData
    });
  }
}));

app.post('/shareConfirmation/:share_key', route(async function (req, res, next) {
  var share_key = asString(req.params.share_key);
  if (await authorize(req.session,res,USER,{redirect:'/share/'+share_key},EXECUTE)){ //is logged in
    let [share_line] = await con.asyncQuery('SELECT DISTINCT * FROM share_pending WHERE share_key = ?', [share_key]);
    if (share_line.length == 0) {
      renderNotFound(res);
      return;
    }
    let [share_list] = await con.asyncQuery('SELECT * FROM ShoppingList WHERE list_id = ?', [share_line[0].list_id]);
    let [listData] = await con.asyncQuery('SELECT * FROM ShoppingList WHERE ShoppingList.owner = ?', [req.session.uname]);
    if (req.body.confirm == 'ACCEPT') {
      await con.asyncQuery('INSERT INTO Shared_list (list_id,share_user,share_perms) VALUES (?,?,?)', [share_line[0].list_id, req.session.uname, share_line[0].share_perms]);
      await con.asyncQuery('DELETE FROM share_pending WHERE share_key = ?', [share_key]);
      res.status(200).render('shareAccept', {
        share_list: share_list[0],
        share_perms: share_line[0].share_perms,
        headerlists: listData
      });
    } else if (req.body.confirm == 'DENY'){
      await con.asyncQuery('DELETE FROM share_pending WHERE share_key = ?', [share_key]);
      res.status(200).render('shareDeny', {
        share_list: share_list[0],
        share_perms: share_line[0].share_perms,
        headerlists: listData
      });
    } else { //send 404
      next();
    }
  }
}));

app.post('/l/:list/unsub/', route(async function (req,res) {
  if (await authorize(req.session,res,LIST_VIEW,{redirect:'/home',list:req.params.list},EXECUTE)){ //has view
    await con.asyncQuery('DELETE FROM Shared_list WHERE list_id = ? AND share_user = ?', [toId(req.params.list), req.session.uname]);
    res.sendStatus(204);
  }
}));

app.post('/l/:list/delList/',  route(async function (req, res) {
   if (await authorize(req.session,res,LIST_OWNER,{redirect:'/home',list:req.params.list},EXECUTE)){ //has owner
      // Use the list that was authorised (from the URL), never an id taken from
      // the request body, so an owner of one list cannot delete another.
      await con.asyncQuery('CALL deleteList(?)', [toId(req.params.list)]);
      res.redirect('/');
   }
}));

app.post('/:other?/addList', route(async function (req, res) {
  let redirect = "/";
  if (req.params.other) {redirect+=req.params.other;}
  if (await authorize(req.session,res,USER,{redirect:redirect},EXECUTE)){ //is logged in
    var user = req.session.uname;
    var list = asString(req.body.listName);
    var color = asString(req.body.color);
    if (!list.trim() || !isHexColor(color)) {
      res.status(400).send('Invalid list.');
      return;
    }
    await con.asyncQuery('CALL addList(?,?,?)', [list, user, color]);
    let [data] = await con.asyncQuery('SELECT * FROM ShoppingList WHERE Owner = ? ORDER BY last_change DESC', [user]);
    res.redirect(data.length > 0 ? '/l/'+data[0].list_id : '/home');
  }
}));

async function renderAccount(req, res, extra) {
  const [colors] = await con.asyncQuery('SELECT * FROM colors');
  let [listData] = await con.asyncQuery('SELECT * FROM ShoppingList WHERE ShoppingList.owner = ?', [req.session.uname]);
  res.render('user.handlebars', Object.assign({
    title: req.session.uname,
    uname: req.session.uname,
    fname: req.session.fname,
    lname: req.session.lname,
    email: req.session.email,
    headerlists: listData,
    colors: colors
  }, extra));
}

app.post('/editInfo', route(async function (req, res) {
  if (await authorize(req.session,res,USER,{redirect:'/myAccount'},EXECUTE)){ //is logged in
    var user = req.session.uname;
    var fname = asString(req.body.fname);
    var lname = asString(req.body.lname);
    var email = asString(req.body.email).trim();
    var currentPassword = asString(req.body.current_password);
    var pass1 = asString(req.body.password);
    var pass2 = asString(req.body.password2);
    if (fname && lname){
      await con.asyncQuery('UPDATE User SET fname = ?, lname = ? WHERE uname = ?', [fname, lname, user]);
      req.session.fname = fname;
      req.session.lname = lname;
      res.redirect('/myAccount');
    } else if (email) {
      if (!isEmail(email)) {
        res.status(400);
        await renderAccount(req, res, { emailerror: 'Please enter a valid email address.' });
        return;
      }
      let [existing] = await con.asyncQuery('SELECT uname FROM User WHERE email = ? AND uname <> ?', [email, user]);
      if (existing.length > 0) {
        await renderAccount(req, res, { emailerror: 'The email you entered is already in use!' });
        return;
      }
      else {
        await con.asyncQuery('UPDATE User SET email = ? WHERE uname = ?', [email, user]);
        req.session.email = email;
        res.redirect('/myAccount');
      }
    } else if (pass1 != '' || pass2 != '') {
      // Changing the password needs the current one, so a stolen or left-open
      // session cannot be used to take over the account.
      var keys = failureKeys(req, user);
      var problem = null;
      if (failedPerUser.isLimited(keys.user) || failedPerIp.isLimited(keys.ip)) {
        problem = LOGIN_LIMITED;
      } else {
        let [rows] = await con.asyncQuery('SELECT password FROM User WHERE uname = ?', [user]);
        var check = await passwords.verify(currentPassword, rows.length > 0 ? rows[0].password : null);
        if (!check.ok) {
          failedPerUser.hit(keys.user);
          failedPerIp.hit(keys.ip);
          problem = 'Your current password was not correct.';
        } else if (pass1 != pass2) {
          problem = 'The new passwords must match.';
        } else {
          problem = passwordProblem(pass1);
        }
      }
      if (problem) {
        res.status(400);
        await renderAccount(req, res, { passworderror: problem });
        return;
      }
      failedPerUser.reset(keys.user);
      await updatePassword(user, pass1);
      res.redirect('/myAccount');
    } else {
      res.redirect('/myAccount');
    }
  }
}));

app.post('/l/:list/editList', route(async function (req, res) {
  if (await authorize(req.session,res,LIST_OWNER,{redirect:'/home',list:req.params.list},EXECUTE)){ //has owner
    var listid = toId(req.params.list);
    var list = asString(req.body.listName);
    var color = asString(req.body.color);
    if (!list.trim() || !isHexColor(color)) {
      res.status(400).send('Invalid list.');
      return;
    }
    await con.asyncQuery('CALL editList(?,?,?)', [listid, list, color]);
    res.redirect('/');
  }
}));

app.get('/:other?/myAccount', route(async function (req, res, next) {
  if (await authorize(req.session,res,USER,{redirect:'/myAccount'},EXECUTE)){ //is logged in
    const [colors] = await con.asyncQuery('SELECT * FROM colors');
    var user = req.session.uname;
    let [listData] = await con.asyncQuery('SELECT * FROM ShoppingList WHERE ShoppingList.owner = ?', [user]);
    res.status(200).render('user', {
      title: user,
      uname: req.session.uname,
      fname: req.session.fname,
      lname: req.session.lname,
      email: req.session.email,
      headerlists: listData,
      colors: colors
    });
  }
}));

app.get('/login', function (req, res, next) {
  res.render('login.handlebars', {
      title: 'Login',
      layout: 'bare',
      // only ever show our own message, never text supplied in the URL
      error: (req.query.error === LOGIN_ERROR) ? LOGIN_ERROR : undefined
   });
});

app.get('/register', function (req, res, next) {
   res.render('register.handlebars', {
      title: 'Register',
      layout: 'bare'
   });
});

app.get('*', function (req, res) {
  renderNotFound(res);
});

app.use(function (err, req, res, next) {
  console.log(err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).send('Something went wrong. Please try again.');
});

// Listen on the configured address (loopback by default) so the app can only be
// reached through the Apache reverse proxy, not directly on its own port.
var listenHost = process.env.HOST || (config.server && config.server.host) || '127.0.0.1';
app.listen(port, listenHost, function () {
    console.log("== Server listening on", listenHost + ":" + port);
});
