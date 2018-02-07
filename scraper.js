// This is a template for a Node.js scraper on morph.io (https://morph.io)

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
	
	// Get list from pages.json
	// For each page
	// 		Download page
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
	
	console.log(pages);
	
	for (i in pages) {
		
		console.log(i, pages[i]);
		
		// Use request to read in pages.
		fetchPage(pages[i].url, function (body) {
			
			console.log(i, body);
			
			// Use cheerio to find things in the page with css selectors.
			var $ = cheerio.load(body);

			var contents = $(page.selector).text().fullTrim();
			console.log(i, contents);
			
			/*
			updateRow
			
			each(function () {
				var value = $(this).text().trim();
				updateRow(db, value);
			});

			readRows(db);
			*/

			db.close();
		});
		
		
		
	}
	
}

initDatabase(run);
