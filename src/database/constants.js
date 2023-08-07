const local = {
	HOST : "localhost",
	USER : "root",
	PASSWORD : "root",
	CLIENT : "ndx2",
	IMAGE_SERVICE : "http://localhost:9899/upload"
};
const development = {
	HOST : "localhost",
	USER : "ndx",
	PASSWORD : "N@w$#X",
	CLIENT : "ndx3",
	IMAGE_SERVICE : "http://localhost:9899/upload"
};
const production = {
	HOST : "ndxMysql",
	USER : "root",
	PASSWORD : "NDX@123*",
	CLIENT : "ndx2",
	IMAGE_SERVICE : "http://localhost:9899/upload"
};
module.exports = development;