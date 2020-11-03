'use strict';


/**
 * Add a new list owned by the given user
 * Add a list with the given name and color, with the owner id given 
 *
 * body List provide a list name and color, the owner id is pulled from url

 * id String Unique username of a user 
 * returns List
 **/
exports.addUserList = function(body,id) {
  return new Promise(function(resolve, reject) {
    var examples = {};
    examples['application/json'] = {
  "owner" : "janedoe",
  "last_change" : 0,
  "name" : "Shopping List",
  "list_color" : "FF6600",
  "id" : 123456
};
    if (Object.keys(examples).length > 0) {
      resolve(examples[Object.keys(examples)[0]]);
    } else {
      resolve();
    }
  });
}


/**
 * Log in a User.
 * Authenticate a specific User with their email address and password. 
 *
 * body User Email address and plain-text password for the User being authenticated.

 * returns inline_response_200
 **/
exports.authenticateUser = function(body) {
  return new Promise(function(resolve, reject) {
    var examples = {};
    examples['application/json'] = {
  "token" : "aaaaaaaa.bbbbbbbb.cccccccc"
};
    if (Object.keys(examples).length > 0) {
      resolve(examples[Object.keys(examples)[0]]);
    } else {
      resolve();
    }
  });
}


/**
 * Create a new User.
 * Create and store a new application User with specified data and adds it to the application's database. 
 *
 * body User A User object.
 * returns inline_response_201
 **/
exports.createUser = function(body) {
  return new Promise(function(resolve, reject) {
    var examples = {};
    examples['application/json'] = {
  "id" : "janedoe"
};
    if (Object.keys(examples).length > 0) {
      resolve(examples[Object.keys(examples)[0]]);
    } else {
      resolve();
    }
  });
}


/**
 * Fetch data about a specific User.
 * Returns information about the specified User. 
 *
 * id String Unique username of a User. 
 * returns User
 **/
exports.getUserByUsername = function(id) {
  return new Promise(function(resolve, reject) {
    var examples = {};
    examples['application/json'] = {
  "fname" : "Jane",
  "lname" : "Doe",
  "password" : "password or '$2a$04$dEeAqgYktiz8nEEWMC8e4u2Ff/QWkfDR4TQbpKcdcbMr.a3gV89vy'",
  "uname" : "janedoe",
  "last_web_change" : 0,
  "showAlert" : true,
  "email" : "example@horine.dev"
};
    if (Object.keys(examples).length > 0) {
      resolve(examples[Object.keys(examples)[0]]);
    } else {
      resolve();
    }
  });
}


/**
 * Fetch all of a user's lists
 * Returns a JSON object with an array of lists (without list elements) 
 *
 * id String Unique username of a user 
 * returns List
 **/
exports.getUserLists = function(id) {
  return new Promise(function(resolve, reject) {
    var examples = {};
    examples['application/json'] = {
  "owner" : "janedoe",
  "last_change" : 0,
  "name" : "Shopping List",
  "list_color" : "FF6600",
  "id" : 123456
};
    if (Object.keys(examples).length > 0) {
      resolve(examples[Object.keys(examples)[0]]);
    } else {
      resolve();
    }
  });
}

