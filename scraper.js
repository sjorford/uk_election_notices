var cheerio = require("cheerio");
var request = require("request");
var sqlite3 = require("sqlite3").verbose();
var diff = require("diff");
var moment = require("moment");

// https://stackoverflow.com/questions/10011011/using-node-js-how-do-i-read-a-json-object-into-server-memory
var pages = require('./pages.json');
var conf = require('./conf.json');

var db;
var i;

function initDatabase() {
	
	// Set up sqlite database
	db = new sqlite3.Database("data.sqlite");
	db.serialize(function() {
		// TODO: lastchecked, lastupdated
		db.run("CREATE TABLE IF NOT EXISTS pages (name TEXT, url TEXT, selector TEXT, contents TEXT, checked TEXT, updated TEXT)");
		db.run("CREATE TABLE IF NOT EXISTS diffs (name TEXT, diff TEXT, date TEXT)");
		getFirstPage();
	});
	
}

function getFirstPage() {
	
	// Get first page
	i = -1;
	nextPage();
	
}

function nextPage() {
	
	// Finish if no more pages
	i++;
	if (i >= pages.length) {
		db.close();
		console.log('processed ' + pages.length + ' pages, finished');
		return;
	}
	
	// Fetch the page
	console.log(i, 'getting page', pages[i].name);
	request(pages[i].url, function (error, response, body) {
		if (error) {
			console.log(i, 'error getting page', error);
			return;
		}
		processfetchedPage(body);
	});
	
}

function processfetchedPage(body) {
	console.log(i, 'processing ' + pages[i].name);
	
	pages[i].checked = moment().format('YYYY-MM-DD HH:mm:ss');
	
	// Get selected text
	var $ = cheerio.load(body);
	var target = $(pages[i].selector);
	if (target.length == 0) {
		console.error(i, 'selector not found');
	} else if (target.length == 0) {
		console.error(i, 'too many instances of selector found (' + target.length + ')');
	} else {
		pages[i].contents = fullTrim(getSpacedText(target.get(0)));
		//pages[i].contents = pages[i].checked + ' ' + pages[i].contents; // TESTING
		//console.log(i, pages[i].contents);
	}
	
	// Read the row for this page
	db.get("SELECT name, url, selector, contents FROM pages WHERE name = ?", [pages[i].name], function(error, row) {
		
		if (error) {
			
			// Log error
			console.log(i, 'error retrieving row', error);
			nextPage();
			
		} else if (row) {
			//console.log(i, row);
			
			if (row.url != pages[i].url || row.selector != pages[i].selector) {
				
				// Selection criteria have changed, just update the table
				console.log(i, 'url or selector has changed, updating table');
				var statement = db.prepare("UPDATE pages SET url = ?, selector = ?, contents = ?, checked = ?, updated = ? WHERE name = ?", 
						[pages[i].url, pages[i].selector, pages[i].contents, pages[i].name, pages[i].checked, pages[i].checked]);
				statement.run();
				statement.finalize(nextPage);
				
			} else if (row.contents != pages[i].contents) {
				
				// Contents have changed
				console.log(i, 'contents have changed, updating table');
				
				// Save diff of lines
				var diffs = diff.diffLines(row.contents, pages[i].contents);
				var statement = db.prepare("INSERT INTO diffs VALUES (?, ?, ?)", 
						[pages[i].name, JSON.stringify(diffs), pages[i].checked]);
				statement.run();
				statement.finalize();
				
				// Update the main table
				var statement = db.prepare("UPDATE pages SET contents = ?, checked = ?, updated = ? WHERE name = ?", 
						[pages[i].contents, pages[i].checked, pages[i].checked, pages[i].name]);
				statement.run();
				statement.finalize(nextPage);
				
				
			} else {
				console.log(i, 'no change');
				var statement = db.prepare("UPDATE pages SET checked = ? WHERE name = ?", 
						[pages[i].checked, pages[i].name]);
				statement.run();
				statement.finalize(nextPage);
				
			}
			
		} else {
			
			// Insert row
			console.log(i, 'inserting row');
			var statement = db.prepare("INSERT INTO pages VALUES (?, ?, ?, ?, ?, ?)", 
					[pages[i].name, pages[i].url, pages[i].selector, pages[i].contents]);
			statement.run();
			statement.finalize(nextPage);
			
		}
		
	});
	
}

function getSpacedText(element) {
	if (element.nodeType == 3) {
		return element.nodeValue;
	} else if (element.nodeType == 1) {
		var tag = element.tagName.toLowerCase();
		if (conf.elements.block.indexOf(tag) >= 0 || conf.elements.inline.indexOf(tag) >= 0) {
			var contentsText = element.firstChild ? Array.from(element.childNodes).map(child => getSpacedText(child)).join('') : '';
			if (conf.elements.block.indexOf(tag) >= 0) {
				return '\n' + contentsText + '\n';
			} else {
				return contentsText;
			}
		} else {
			return '';
		}
	} else {
		return '';
	}
}

function fullTrim(string) {
	return string.replace(/\s*[\r\n]+\s*/g, '\n').replace(/[ \f\t\v\u00a0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g, ' ').trim();
}

initDatabase();
