'use strict';

const express = require("express");
const morgan = require('morgan');

const controllers = require("./controllers");
const serverPort = process.env.port || 3030;
const app = express();

app.use(morgan('dev'));
app.use(express.json());
app.use(express.static('public'));

app.use("*", function(req, res, next) {
  //jwt authentication
  var token = jwt.checkToken();
  console.log(token);
  next();
});

app.use('/',controllers);

app.use('*', function (req, res, next) {
  res.status(404).json({
    error: "Requested resource \"" + req.originalUrl + "\"not found."
  })
});

// Initialize the Swagger middleware
http.createServer(app).listen(serverPort, function () {
    console.log('Your server is listening on port %d (http://localhost:%d)', serverPort, serverPort);
    console.log('Swagger-ui is available on http://localhost:%d/docs/openapi.yaml', serverPort);
});
