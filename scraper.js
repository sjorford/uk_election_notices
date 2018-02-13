var cheerio = require("cheerio");
var request = require("request");
var sqlite3 = require("sqlite3").verbose();
var diff    = require("diff");
var gsjson  = require("google-spreadsheet-to-json");
var moment  = require("moment");

// TODO:
// front end to view pages/diffs/errors
// serialize db statements properly
// something else I can't remember

// https://stackoverflow.com/questions/10011011/using-node-js-how-do-i-read-a-json-object-into-server-memory
var conf = require('./conf.json');

var db, index, pages;
var numFetched, numUpdated, numErrors;

function initDatabase() {
	
	// Set up sqlite database
	db = new sqlite3.Database("data.sqlite");
	db.serialize(function() {
		db.run("CREATE TABLE IF NOT EXISTS pages (name TEXT, url TEXT, selector TEXT, contents TEXT, checked TEXT, updated TEXT, error TEXT)");
		db.run("CREATE TABLE IF NOT EXISTS diffs (name TEXT, diff TEXT, date TEXT)", getPages);
	});
	
}

function getPages() {
	
	// Get pages from Google Sheet
	gsjson({spreadsheetId: conf.spreadsheetId})
		.then(result => {
			pages = result.map(item => ({name: item.district, url: item.currentElectionsPage, selector: item.selector}));
			firstPage();
		});
	
}

function firstPage() {
	
	// Get first page
	index = -1;
	numFetched = numUpdated = numErrors = 0;
	nextPage();
	
}

function nextPage() {
	
	var session = Math.random();
	
	while (true) {
		
		// Finish if no more pages
		index++;
		//console.log(index, session);
		if (index >= pages.length) {
			//console.log(index, session, 'no more pages, quitting scraper');
			quitScraper();
			return;
		}
		
		// Only process spreadsheet rows with a URL and selector
		if (pages[index].name && pages[index].url && pages[index].selector) {
			//console.log(index, session, 'reading database row');
			readDatabaseRow(pages[index]);
			break;
		}
		
	}
	
}

function quitScraper() {
	
	// Close the database and log summary
	db.close();
	console.log(numFetched + ' of ' + pages.length + ' pages fetched, ' + numUpdated + ' updated');
	if (numErrors > 0) console.log(numErrors == 1 ? '1 error was encountered' : numErrors + ' errors were encountered');
	
}

function readDatabaseRow(page) {
	
	// Read the database row for this page
	db.get("SELECT name, url, selector, contents FROM pages WHERE name = ?", [page.name], function(error, row) {
		if (error) {
			
			// Exit scraper on database error
			numErrors++;
			console.error(page.name, 'error retrieving database row', error);
			quitScraper();
			return;
			
		} else {
			fetchPage(page, row);
		}
	});
	
}

function fetchPage(page, row) {
	
	// Fetch the page
	numFetched++;
	request(page.url, function (error, response, body) {
		if (error) {
			logError(page, row, 'error fetching page', error);
			nextPage();
		} else {
			processfetchedPage(page, row, body);
		}
	});
	
}

function processfetchedPage(page, row, body) {
	
	// Find unique instance of selector
	var $ = cheerio.load(body);
	var target = $(page.selector);
	if (target.length != 1) {
		logError(page, row, target.length == 0 ? 'selector not found' : `too many instances of selector found (${target.length})`);
		nextPage();
		return;
	}
	
	// Get selected text
	var contents = fullTrim(getSpacedText(page, target.get(0)));
	
	// Check text is not empty
	if (contents.length == 0) {
		logError(page, row, 'no text found');
		nextPage();
		return;
	}
	
	if (row) {
		
		if (row.url != page.url || row.selector != page.selector) {
			
			// Selection criteria have changed, update the table without logging a diff
			numUpdated++;
			console.log(page.name, 'url or selector has changed, updating table');
			var statement = db.prepare("UPDATE pages SET url = ?, selector = ?, contents = ?, checked = ?, updated = ?, error = ? WHERE name = ?", 
					[page.url, page.selector, contents, currentTime(), currentTime(), '',  
						page.name]);
			statement.run();
			statement.finalize(nextPage);
			
		} else if (row.contents != contents) {
			
			// Contents have changed
			numUpdated++;
			console.log(page.name, 'contents have changed, updating table');
			
			db.serialize(() => {
				
				// Save diff of lines
				if (row.contents.length > 0) {
					var diffs = diff.diffLines(row.contents, contents);
					var statement = db.prepare("INSERT INTO diffs (name, diff, date) VALUES (?, ?, ?)", 
							[page.name, JSON.stringify(diffs), currentTime()]);
					statement.run();
					statement.finalize();
				}
				
				// Update the main table
				var statement = db.prepare("UPDATE pages SET contents = ?, checked = ?, updated = ?, error = ? WHERE name = ?", 
						[contents, currentTime(), currentTime(), '', 
							page.name]);
				statement.run();
				statement.finalize(nextPage);
				
			});
			
		} else {
			
			// No change, just update the last checked time
			var statement = db.prepare("UPDATE pages SET checked = ?, error = ? WHERE name = ?", 
					[currentTime(), '', 
						page.name]);
			statement.run();
			statement.finalize(nextPage);
			
		}
		
	} else {
		
		// Insert page into table
		numUpdated++;
		console.log(page.name, 'new page, inserting row');
		var statement = db.prepare("INSERT INTO pages (name, url, selector, contents, checked, updated, error) VALUES (?, ?, ?, ?, ?, ?, ?)", 
				[page.name, page.url, page.selector, contents, currentTime(), currentTime(), '']);
		statement.run();
		statement.finalize(nextPage);
		
	}
	
}

// Get text of HTML element, respecting block-level element boundaries
function getSpacedText(page, element) {
	
	if (element.nodeType == 3) {
		
		// Get raw content of text nodes, removing newlines
		return element.nodeValue.replace(/[\r\n]/g, ' ');
		
	} else if (element.nodeType == 1) {
		
		// Only process display elements
		var tag = element.tagName.toLowerCase();
		if (conf.elements.block.indexOf(tag) >= 0 || conf.elements.inline.indexOf(tag) >= 0) {
			
			// Get contents of descendant elements
			var contentsText = element.firstChild ? Array.from(element.childNodes).map(child => getSpacedText(child)).join('') : '';
			
			// Surround block elements with newlines
			if (conf.elements.block.indexOf(tag) >= 0) {
				return '\n' + contentsText + '\n';
			} else {
				return contentsText;
			}
			
		} else {
			
			// Ignore other elements
			if (conf.elements.other.indexOf(tag) < 0) {
				console.warn(page.name, `unknown element encountered (${tag})`);
			}
			return '';
			
		}
		
	} else {
		
		// Ignore comment nodes
		if (element.nodeType != 8) {
			console.log(page.name, `unknown node type encountered (${element.nodeType})`);
			return '';
		}
		
	}
}

function logError(page, row, error, originalError) {
	
	// Log error to the console
	numErrors++;
	var fullError = error + (originalError ? ': ' + originalError : '');
	console.error(page.name, fullError);
	
	if (row) {
		
		// Update row
		var statement = db.prepare("UPDATE pages SET checked = ?, error = ? WHERE name = ?", 
				[currentTime(), fullError, 
					page.name]);
		statement.run();
		statement.finalize(nextPage);
		
	} else {
		
		// Insert row
		var statement = db.prepare("INSERT INTO pages (name, url, selector, contents, checked, updated, error) VALUES (?, ?, ?, ?, ?, ?, ?)", 
				[page.name, page.url, page.selector, '', currentTime(), '', fullError]);
		statement.run();
		statement.finalize(nextPage);
		
	}
	
}

function fullTrim(string) {
	return string.replace(/\s*[\r\n]+\s*/g, '\n').replace(/[ \f\t\v\u00a0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g, ' ').trim();
}

function currentTime() {
	return moment().format('YYYY-MM-DD HH:mm:ss');
}

initDatabase();
