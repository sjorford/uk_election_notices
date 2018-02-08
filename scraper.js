var cheerio = require("cheerio");
var request = require("request");
var sqlite3 = require("sqlite3").verbose();

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
	console.log(i, 'processing page', pages[i].name);
	
	// Get selected text
	var $ = cheerio.load(body);
	var target = $(pages[i].selector);
	if (target.length == 0) {
		console.error(i, 'selector not found');
	} else if (target.length == 0) {
		console.error(i, 'too many instances of selector found (' + target.length + ')');
	} else {
		pages[i].contents = getSpacedText(target.get(0));
		console.log(i, pages[i].contents.substr(0, 100));
	}
	
	// Read the row for this page
	db.get("SELECT name, url, selector, contents FROM pages WHERE name = ?", [pages[i].name], function(error, row) {
		
		if (error) {
			
			// Log error
			console.log(i, 'error retrieving row', error);
			nextPage();
			
		} else if (row) {
			console.log(i, row);
			
			if (row.url != pages[i].url || row.selector != pages[i].selector) {
				console.log(i, 'url or selector has changed, updating table');
				var statement = db.prepare("UPDATE pages SET url = ?, selector = ?, contents = ? WHERE name = ?", 
						[pages[i].url, pages[i].selector, pages[i].contents, pages[i].name]);
				statement.run();
				statement.finalize(nextPage);
				
			} else if (row.contents != pages[i].contents) {
				console.log(i, 'contents have changed, updating table');
				var statement = db.prepare("UPDATE pages SET contents = ? WHERE name = ?", 
						[pages[i].contents, pages[i].name]);
				statement.run();
				statement.finalize(nextPage);
				
				
			} else {
				console.log(i, 'no change');
			}
			
			
			// Compare page and selector
				// Update row
			
			// Else
			// Compare text
				// Update row
				// Log a change
				
			nextPage();
			
		} else {
			
			// Insert row
			console.log(i, 'inserting row');
			var statement = db.prepare("INSERT INTO pages VALUES (?, ?, ?, ?)", 
					[pages[i].name, pages[i].url, pages[i].selector, pages[i].contents]);
			statement.run();
			statement.finalize(nextPage);
			
		}
		
	});
	
}

function getSpacedText(element) {
	if (element.nodeType == 3) {
		return element.textContent;
	} else if (element.nodeType == 1) {
		console.log('checking element node ' + element.tagName);
		var contentsText = element.firstChild ? Array.from(element.childNodes).map(child => getSpacedText(child)).join('') : '';
		if (conf.blocks.indexOf(element.tagName.toLowerCase()) >= 0) {
			console.log('block-level node ' + element.tagName + ', adding newlines');
			return '\r\n' + contentsText + '\r\n';
		} else {
			return contentsText;
		}
	} else {
		return '';
	}
}

function fullTrim(string) {
	return string.replace(/[\s\r\n]*\r\n[\s\r\n]*/g, '\r\n').replace(/\s+/g, ' ').trim();
}

initDatabase();
