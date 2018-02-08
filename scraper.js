var cheerio = require("cheerio");
var request = require("request");
var sqlite3 = require("sqlite3").verbose();

// https://stackoverflow.com/questions/10011011/using-node-js-how-do-i-read-a-json-object-into-server-memory
var pages = require('./pages.json');

function initDatabase(callback) {
	// Set up sqlite database.
	var db = new sqlite3.Database("data.sqlite");
	db.serialize(function() {
		db.run("CREATE TABLE IF NOT EXISTS pages (name TEXT, url TEXT, selector TEXT, contents TEXT)");
		callback(db);
	});
}

function updateRow(db, value) {
	// Insert some data.
	var statement = db.prepare("INSERT INTO data VALUES (?)");
	statement.run(value);
	statement.finalize();
}

function readRows(db, name) {
	// Read some data.
	db.each("SELECT rowid AS id, name FROM data", function(err, row) {
		console.log(row.id + ": " + row.name);
	});
}

function fetchPage(url, callback) {
	// Use request to read in pages.
	request(url, function (error, response, body) {
		if (error) {
			console.log("Error requesting page: " + error);
			return;
		}

		callback(body);
	});
}

function run(db) {
	
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
	
	// Loop through pages
	nextPage(0);
	
}

function nextPage() {
	
	if (i > pages.length) {
		console.log('processed ' + (pages.length + 1) + ' pages, finished');
		return;
	}
	
	// Fetch the next page
	console.log(i, pages[i]);
	fetchPage(pages[i].url, processfetchedPage);
	
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
			var contents = fullTrim(target.text());
			console.log(i, contents.substr(0, 100));
		}
		
		/*
		updateRow
		
		each(function () {
			var value = $(this).text().trim();
			updateRow(db, value);
		});

		readRows(db);
		
		i++;
		nextPage();
		*/

		db.close();
	
}

function fullTrim(string) {
	return string.replace(/[\s\r\n]+/g, ' ').trim();
}

initDatabase(run);
