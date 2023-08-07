const express = require('express');
const server = express();
const ndx = require('./ndx');
const bodyParser = require("body-parser");
const PORT = 8082;
server.use(bodyParser.urlencoded({extended : true}));
server.use(bodyParser.json());
server.listen(PORT, function(err) {
	if (err) {
		throw err;
	}
	console.log("API Active on Port " + PORT);
});
// Routes
server.use("/parse", function(req, res) {
	console.log('Cron Frequency : ' + req.query.cronTime + ' | Running : '+(new Date()));
	ndx.parse(req, res);
});