'use strict';


/**
 * Add a new list owned by the given user
 * Add an autofill item to a user (automatically done when an item is added to a list, but can be done manually) 
 *
 * body Autofill provide a name for the new autofill item, owner is pulled from url path

 * id String Unique username of a user 
 * returns Autofill
 **/
exports.addUserAutofill = function(body,id) {
  return new Promise(function(resolve, reject) {
    var examples = {};
    examples['application/json'] = {
  "owner" : "janedoe",
  "name" : "bananas",
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
 * Fetch all of a user's autofill items
 * Returns a JSON object with an array of autofill items 
 *
 * id String Unique username of a user 
 * returns Autofill
 **/
exports.getUserAutofill = function(id) {
  return new Promise(function(resolve, reject) {
    var examples = {};
    examples['application/json'] = {
  "owner" : "janedoe",
  "name" : "bananas",
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
 * Fetch all of a user's lists (that you have access to)
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


/**
 * Remove a specific autofill entry from the database.
 * Completely removes the autofill entry form the database. can only be done by the owner of the entry 
 *
 * id String Unique username of a user 
 * no response value expected for this operation
 **/
exports.removeAutofillById = function(id) {
  return new Promise(function(resolve, reject) {
    resolve();
  });
}


/**
 * Remove a specific user from the database.
 * Completely removes the user and all their associated data from the database. 
 *
 * id String Unique username of a User. 
 * no response value expected for this operation
 **/
exports.removeUserById = function(id) {
  return new Promise(function(resolve, reject) {
    resolve();
  });
}


/**
 * send a password reset request to the email given in the request body.
 * Returns nothing, but sets a key aside and sends an email to the specified address if an account exists. 
 *
 * body List provide a list name and color, the owner id is pulled from url

 * no response value expected for this operation
 **/
exports.sendForgotPassword = function(body) {
  return new Promise(function(resolve, reject) {
    resolve();
  });
}


/**
 * Reset a user's password, provided a valid auth token is given
 * Authenticate a specific User with their email address and password. 
 *
 * body User Email address and new plain-text password for the User who's password is being updated.

 * id String Unique username of a User. 
 * returns inline_response_200
 **/
exports.setUserPassword = function(body,id) {
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
 * Update data for the specified user.
 * Performs a partial update on the data for the user. Password can only be updated via the passwordUpdate POST request. 
 *
 * body User Partial updates to be applied to the specified user.

 * id Integer id of the requested user 
 * no response value expected for this operation
 **/
exports.updateUserById = function(body,id) {
  return new Promise(function(resolve, reject) {
    resolve();
  });
}

