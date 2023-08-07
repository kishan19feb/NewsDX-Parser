const constants = require('./constants');
const masterData = require('mysql').createConnection({
	"host" : constants.HOST,
	"user" : constants.USER,
	"password" : constants.PASSWORD,
	"database" : "ndx_master"
});
module.exports = masterData;