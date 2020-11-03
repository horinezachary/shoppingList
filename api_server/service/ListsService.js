'use strict';


/**
 * Fetch a specific list
 * Returns a JSON object with the list specified, including list elements 
 *
 * id Integer id of the requested list 
 * returns DetailedList
 **/
exports.getDetailedList = function(id) {
  return new Promise(function(resolve, reject) {
    var examples = {};
    examples['application/json'] = {
  "owner" : "janedoe",
  "last_change" : 0,
  "name" : "Shopping List",
  "list_color" : "FF6600",
  "id" : 123456,
  "list_items" : { }
};
    if (Object.keys(examples).length > 0) {
      resolve(examples[Object.keys(examples)[0]]);
    } else {
      resolve();
    }
  });
}


/**
 * Fetch all lists a user has access to
 * Returns a JSON object with an array of Userlists and sharedLists (without list elements) 
 *
 * returns List
 **/
exports.getLists = function() {
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
 * Remove a specific List from the database.
 * Completely removes the data for the specified list, including all list elements.  Only an authenticated whose ID matches the `owner` of the List with the given `listId` can delete a List. 
 *
 * no response value expected for this operation
 **/
exports.removeListById = function() {
  return new Promise(function(resolve, reject) {
    resolve();
  });
}


/**
 * Add a new share record for the given list
 * Share the list with the given id with the user 
 *
 * body Body provide a user and level to share

 * id Integer id of the list to share 
 * returns List
 **/
exports.shareListById = function(body,id) {
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
 * Remove the sharing permissions for a given user
 * Share the list with the given id with the user 
 *
 * id Integer id of the list to add the item to 
 * no response value expected for this operation
 **/
exports.unShareListById = function(id) {
  return new Promise(function(resolve, reject) {
    resolve();
  });
}


/**
 * Update data for the specified list.
 * Performs a partial update on the data for the list. 
 *
 * body List Partial updates to be applied to the specified list.

 * no response value expected for this operation
 **/
exports.updateListById = function(body) {
  return new Promise(function(resolve, reject) {
    resolve();
  });
}

