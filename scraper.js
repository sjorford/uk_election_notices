var cheerio = require("cheerio");
var request = require("request");
var sqlite3 = require("sqlite3").verbose();
var diff    = require("diff");
var gsjson  = require("google-spreadsheet-to-json");
var moment  = require("moment");

// TODO:
// send emails for errors
// front end to view diffs
// something else I can't remember
// add error column to pages table

// https://stackoverflow.com/questions/10011011/using-node-js-how-do-i-read-a-json-object-into-server-memory
var conf = require('./conf.json');

var db, i, pages;
var numFetched, numUpdated, numErrors;

function initDatabase() {
	
	// Set up sqlite database
	db = new sqlite3.Database("data.sqlite");
	db.serialize(function() {
		db.run("CREATE TABLE IF NOT EXISTS pages (name TEXT, url TEXT, selector TEXT, contents TEXT, checked TEXT, updated TEXT, error TEXT)");
		db.run("CREATE TABLE IF NOT EXISTS diffs (name TEXT, diff TEXT, date TEXT)");
		getPages();
	});
	
}

function getPages() {
	
	// Get pages from Google Sheet
	gsjson({spreadsheetId: conf.spreadsheetId})
		.then(result => {
			pages = result.map(item => ({name: item.district, url: item.currentElectionsPage, selector: item.selector}));
			getFirstPage();
		});
	
}

function getFirstPage() {
	
	// Get first page
	i = -1;
	numFetched = numUpdated = numErrors = 0;
	nextPage();
	
}

function nextPage() {
	
	while (true) {
		
		// Finish if no more pages
		i++;
		if (i >= pages.length) {
			quit();
		}

		// Fetch the page
		if (pages[i].name && pages[i].url && pages[i].selector) {
			//console.log(i, 'getting page for ' + pages[i].name);
			numFetched++;
			request(pages[i].url, function(error, response, body) {
				if (error) {
					processfetchedPage(null, 'error getting page: ' + error);
				} else {
					processfetchedPage(body, null);
				}
			});
			break;
		} else {
			//console.log(i, 'no url for ' + pages[i].name);
		}
		
	}
	
}

function quit() {
	
	db.close();
	console.log(numFetched + ' of ' + pages.length + ' pages fetched, ' + numUpdated + ' updated');
	if (numErrors > 0) console.log(numErrors == 1 ? '1 error was encountered' : numErrors + ' errors were encountered');
	return;
	
}

function processfetchedPage(body, fetchError) {
	//console.log(i, 'processing ' + pages[i].name);
	
	var pageError = '';
	var contents;
	var currentTime = moment().format('YYYY-MM-DD HH:mm:ss');
	
	if (fetchError) {
		pageError = fetchError;
	} else {
		
		// Find unique instance of selector
		var $ = cheerio.load(body);
		var target = $(pages[i].selector);
		if (target.length != 1) {
			pageError = target.length == 0 ? 'selector not found' : `too many instances of selector found (${target.length})`;
			//numErrors++;
			//console.error(i, pages[i].name, );
			//nextPage();
			//return;
		} else {
			
			// Get selected text
			contents = fullTrim(getSpacedText(target.get(0)));
			if (contents.length == 0) {
				pageError = 'no text found';
				// TODO: log error only, not text
			}
			
		}
		
	}
	
	// Read the row for this page
	db.get("SELECT name, url, selector, contents, error FROM pages WHERE name = ?", [pages[i].name], function(dbError, row) {
		
		if (dbError) {
			
			// Log error and quit
			numErrors++;
			console.error(i, pages[i].name, 'error retrieving database row');
			console.error(dbError);
			console.error('quitting scraper');
			quit();
			return;
			
		}
		
		if (pageError) {
			
			// Log error
			numErrors++;
			console.error(i, pages[i].name, 'error getting page', error);
			
			if (row) {
				
			} else {
				
			}

		} else {
			
		}
	
	
	
	
	
					if (error) {
					return;
				}

	
		if (row) {
			
			if (row.url != pages[i].url || row.selector != pages[i].selector) {
				
				// Selection criteria have changed, just update the table without logging a diff
				numUpdated++;
				console.log(i, pages[i].name, 'url or selector has changed, updating table');
				var statement = db.prepare("UPDATE pages SET url = ?, selector = ?, contents = ?, checked = ?, updated = ?, error = ? WHERE name = ?", 
						[pages[i].url, pages[i].selector, contents, currentTime, currentTime, error, 
							pages[i].name]);
				statement.run();
				statement.finalize(nextPage);
				
			} else if (row.contents != contents) {
				
				// Contents have changed
				numUpdated++;
				console.log(i, pages[i].name, 'contents have changed, updating table');
				
				// Save diff of lines
				var diffs = diff.diffLines(row.contents, contents);
				var statement = db.prepare("INSERT INTO diffs VALUES (?, ?, ?)", 
						[pages[i].name, JSON.stringify(diffs), currentTime]);
				statement.run();
				statement.finalize();
				
				// Update the main table
				var statement = db.prepare("UPDATE pages SET contents = ?, checked = ?, updated = ?, error = ? WHERE name = ?", 
						[contents, currentTime, currentTime, error, 
							pages[i].name]);
				statement.run();
				statement.finalize(nextPage);
				
				
			} else {
				//console.log(i, pages[i].name, 'no change');
				var statement = db.prepare("UPDATE pages SET checked = ?, error = ? WHERE name = ?", 
						[currentTime, error, 
							pages[i].name]);
				statement.run();
				statement.finalize(nextPage);
				
			}
			
		} else {
			
			// Insert row
			numUpdated++;
			console.log(i, pages[i].name, 'new page, inserting row');
			var statement = db.prepare("INSERT INTO pages VALUES (?, ?, ?, ?, ?, ?, ?)", 
					[pages[i].name, pages[i].url, pages[i].selector, contents, currentTime, currentTime, error]);
			statement.run();
			statement.finalize(nextPage);
			
		}
		
	});
	
}

function getSpacedText(element) {
	
	if (element.nodeType == 3) {
		
		// Get raw content of text nodes
		return element.nodeValue.replace(/[\r\n]/g, ' ');
		
	} else if (element.nodeType == 1) {
		
		// Only process display elements
		var tag = element.tagName.toLowerCase();
		if (conf.elements.block.indexOf(tag) >= 0 || conf.elements.inline.indexOf(tag) >= 0) {
			
			// Get contents of descendant elements
			var contentsText = element.firstChild ? Array.from(element.childNodes).map(child => getSpacedText(child)).join('') : '';
			
			// Separate block elements with newlines
			if (conf.elements.block.indexOf(tag) >= 0) {
				return '\n' + contentsText + '\n';
			} else {
				return contentsText;
			}
			
		} else {
			
			// Ignore other elements
			if (conf.elements.other.indexOf(tag) < 0) {
				console.warn(i, pages[i].name, `unknown element encountered (${tag})`);
			}
			return '';
			
		}
		
	} else {
		
		// Ignore comment nodes
		if (element.nodeType != 8) {
			console.log(i, pages[i].name, `unknown node type encountered (${element.nodeType})`);
			return '';
		}
		
	}
}

function fullTrim(string) {
	return string.replace(/\s*[\r\n]+\s*/g, '\n').replace(/[ \f\t\v\u00a0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g, ' ').trim();
}

initDatabase();
