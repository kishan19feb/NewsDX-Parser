const constants = require('./constants');
const clientData = require('mysql').createConnection({
	"host" : constants.HOST,
	"user" : constants.USER,
	"password" : constants.PASSWORD,
	"database" : constants.CLIENT
});
module.exports = clientData;