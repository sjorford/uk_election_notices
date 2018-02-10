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

// https://stackoverflow.com/questions/10011011/using-node-js-how-do-i-read-a-json-object-into-server-memory
//var pages = require('./pages.json');
var conf = require('./conf.json');

var db, i, pages;
var numFetched, numUpdated, numErrors;

function initDatabase() {
	
	// Set up sqlite database
	db = new sqlite3.Database("data.sqlite");
	db.serialize(function() {
		// TODO: lastchecked, lastupdated
		db.run("CREATE TABLE IF NOT EXISTS pages (name TEXT, url TEXT, selector TEXT, contents TEXT, checked TEXT, updated TEXT)");
		db.run("CREATE TABLE IF NOT EXISTS diffs (name TEXT, diff TEXT, date TEXT)");
		getPages();
	});
	
}

function getPages() {
	
	// TODO: put this in a conf file I guess
	gsjson({spreadsheetId: '1C0FFS2EJYnnKNIP4hdt73sy7_9RIz70IvsYKoEt-Ebk'})
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
			db.close();
			console.log(numFetched + ' of ' + pages.length + ' pages fetched, ' + numUpdated + ' updated');
			if (numErrors > 0) console.log(numErrors == 1 ? '1 error was encountered' : numErrors + ' errors were encountered');
			return;
		}

		// Fetch the page
		if (pages[i].name && pages[i].url && pages[i].selector) {
			//console.log(i, 'getting page for ' + pages[i].name);
			numFetched++;
			request(pages[i].url, function (error, response, body) {
				if (error) {
					numErrors++;
					console.error(i, pages[i].name, 'error getting page', error);
					return;
				}
				processfetchedPage(body);
			});
			break;
		} else {
			//console.log(i, 'no url for ' + pages[i].name);
		}
		
	}
	
}

function processfetchedPage(body) {
	//console.log(i, 'processing ' + pages[i].name);
	
	// Find unique instance of selector
	var $ = cheerio.load(body);
	var target = $(pages[i].selector);
	if (target.length != 1) {
		numErrors++;
		console.error(i, pages[i].name, target.length == 0 ? 'selector not found' : `too many instances of selector found (${target.length})`);
		nextPage();
		return;
	}
	
	// Get selected text
	pages[i].contents = fullTrim(getSpacedText(target.get(0)));
	pages[i].checked = moment().format('YYYY-MM-DD HH:mm:ss');
	
	// Check text is not empty
	if (pages[i].contents.length == 0) {
		console.error(i, pages[i].name, 'no text found');
		nextPage();
		return;
	}
	
	// Read the row for this page
	db.get("SELECT name, url, selector, contents FROM pages WHERE name = ?", [pages[i].name], function(error, row) {
		
		if (error) {
			
			// Log error
			numErrors++;
			console.error(i, pages[i].name, 'error retrieving row', error);
			nextPage();
			return;
			
		} else if (row) {
			
			if (row.url != pages[i].url || row.selector != pages[i].selector) {
				
				// Selection criteria have changed, just update the table
				numUpdated++;
				console.log(i, pages[i].name, 'url or selector has changed, updating table');
				var statement = db.prepare("UPDATE pages SET url = ?, selector = ?, contents = ?, checked = ?, updated = ? WHERE name = ?", 
						[pages[i].url, pages[i].selector, pages[i].contents, pages[i].name, pages[i].checked, pages[i].checked]);
				statement.run();
				statement.finalize(nextPage);
				
			} else if (row.contents != pages[i].contents) {
				
				// Contents have changed
				numUpdated++;
				console.log(i, pages[i].name, 'contents have changed, updating table');
				
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
				//console.log(i, pages[i].name, 'no change');
				var statement = db.prepare("UPDATE pages SET checked = ? WHERE name = ?", 
						[pages[i].checked, pages[i].name]);
				statement.run();
				statement.finalize(nextPage);
				
			}
			
		} else {
			
			// Insert row
			numUpdated++;
			console.log(i, pages[i].name, 'new page, inserting row');
			var statement = db.prepare("INSERT INTO pages VALUES (?, ?, ?, ?, ?, ?)", 
					[pages[i].name, pages[i].url, pages[i].selector, pages[i].contents, pages[i].checked, pages[i].checked]);
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
				console.warn(i, pages[i].name, 'unknown element encountered (' + tag + ')');
			}
			return '';
			
		}
		
	} else {
		
		// Ignore all other node types (?)
		return '';
		
	}
}

function fullTrim(string) {
	return string.replace(/\s*[\r\n]+\s*/g, '\n').replace(/[ \f\t\v\u00a0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g, ' ').trim();
}

initDatabase();
