var mysql = require('mysql');
var pool;

function start(cfg) {
   pool = mysql.createPool(cfg);
}

function query(sql,callback) {
   pool.getConnection(function(err, connection) {
      if(err) {
         console.log(err);
         if (callback) {
            callback(true);
         }
         return;
      }
      connection.query(sql, function(err, results) {
         connection.release(); // always put connection back in pool after last query
         if(err) {
            console.log(err);
            if (callback) {
               callback(true);
            }
            return;
         }
         if (callback) {
            callback(false, results);
         }
      });
   });
}

//called with: const [results] = await asyncQuery(query, [sourceName, 0]);
function asyncQuery(query, values) {
  return new Promise((resolve, reject) => {
    pool.query(query, values, (error, results, fields) => {
      if (error) {
        reject(error);
      }
      resolve([results, fields]);
    });
  });
}

// Runs work(query) on one connection inside a transaction: committed when work
// resolves, rolled back when it throws. query has the same shape as asyncQuery.
async function transaction(work) {
  const connection = await new Promise((resolve, reject) => {
    pool.getConnection((error, c) => error ? reject(error) : resolve(c));
  });
  const query = (sql, values) => new Promise((resolve, reject) => {
    connection.query(sql, values, (error, results, fields) => error ? reject(error) : resolve([results, fields]));
  });
  try {
    await query('START TRANSACTION');
    const result = await work(query);
    await query('COMMIT');
    return result;
  } catch (e) {
    await query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    connection.release();
  }
}

module.exports = {
   start: function(cfg) {
      return start(cfg);
   },
   query: function(sql,callback) {
      return query(sql,callback);
   },
   asyncQuery: function(sql,values) {
      return asyncQuery(sql,values);
   },
   transaction: function(work) {
      return transaction(work);
   }

}
