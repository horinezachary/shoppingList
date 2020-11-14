'use strict';


/**
 * Add a new list Item to the given List
 * Add an Item to the list with the given list id 
 *
 * body Item provide an item quantity (optional) and item name

 * id Integer id of the requested list 
 * returns Item
 **/
exports.addListItem = function(body,id) {
  return new Promise(function(resolve, reject) {
    var examples = {};
    examples['application/json'] = {
  "list_id" : 123456,
  "name" : "bananas",
  "count" : 5,
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
 * Remove a specific Item from the database.
 * Completely removes the data for the specified Item, and removes it's link to the list.  Only an authenticated User with edit access to the List with the given `listId`. 
 *
 * id Integer id of the requested list 
 * no response value expected for this operation
 **/
exports.removeListItemById = function(id) {
  return new Promise(function(resolve, reject) {
    resolve();
  });
}

