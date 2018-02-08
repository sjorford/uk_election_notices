var cheerio = require("cheerio");
var request = require("request");
var sqlite3 = require("sqlite3").verbose();

// https://stackoverflow.com/questions/10011011/using-node-js-how-do-i-read-a-json-object-into-server-memory
var pages = require('./pages.json');

var db;
var i;

function initDatabase() {
	
	// Set up sqlite database
	db = new sqlite3.Database("data.sqlite");
	db.serialize(function() {
		db.run("CREATE TABLE IF NOT EXISTS pages (name TEXT, url TEXT, selector TEXT, contents TEXT)");
		getFirstPage();
	});
	
}

	// 		Get selector
	// 		Get full trimmed text
	//		if not in database
	//			insert
	//		else
	//			compare
	//			if difference
	//				add to differences table
	//			update
	// If differences
	//		email differences
	
function getFirstPage() {
	
	// Get first page
	i = 0;
	nextPage();
	
}

function nextPage() {
	
	// Finish if no more pages
	if (i >= pages.length) {
		db.close();
		console.log('processed ' + pages.length + ' pages, finished');
		return;
	}
	
	// Fetch the page
	console.log(i, pages[i]);
	request(pages[i].url, function (error, response, body) {
		if (error) {
			console.log("Error requesting page: " + error);
			return;
		}
		processfetchedPage(body);
	});
	
}

function processfetchedPage(body) {
	
	// Get selected text
	var $ = cheerio.load(body);
	var target = $(pages[i].selector);
	if (target.length == 0) {
		console.error(i, 'selector not found');
	} else if (target.length == 0) {
		console.error(i, target.length + ' instances of selector found');
	} else {
		pages[i].contents = fullTrim(target.text());
		console.log(i, pages[i].contents.substr(0, 100));
	}
	
	// Read the row for this page
	db.each("SELECT name, url, selector, contents FROM pages WHERE name = '" + pages[i].name + "'", function(err, row) {
		console.log(err, row);
		//console.log(row.id + ": " + row.name);
			
		i++;
		nextPage();
		
	});
	
	
	
	
	/*
	updateRow
	
	each(function () {
		var value = $(this).text().trim();
		updateRow(db, value);
	});
	
	readRows(db);
	
	*/
	
}

function updateRow(db, value) {
	// Insert some data.
	var statement = db.prepare("INSERT INTO data VALUES (?)");
	statement.run(value);
	statement.finalize();
}

function fullTrim(string) {
	return string.replace(/[\s\r\n]+/g, ' ').trim();
}

initDatabase();
