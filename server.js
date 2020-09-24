var http = require('http');
var https = require('https');
var url = require('url');
var fs = require('fs');
var path = require('path');
var qs = require('querystring');
// To install sqlite3, run in the command prompt:
// npm install sqlite3
// Then to create a new database:
// sqlite3 test.db
// Inside the prompt that comes up:
// .databases
// Then .quit to exit.

// If using database (not yet)
//var sqlite3 = require('sqlite3');

var baseDirectory = __dirname;   // or whatever base directory you want

// Add files to this list that should not be accessible by users
// Examples are this file, any other server files, database files, probably text files for notes/ideas, etc
var blocked_paths = ['/nodetest.js', '/test.db', '/header.html', '/footer.html', '/example_secret_page.html', '/music-room.html'];

var port = process.env.PORT || 80; // Required for Heroku. Assuming this won't just give an error.

// Load in the header and footer files (which are marked as html but are somewhat incomplete)
//var header = fs.readFileSync(baseDirectory + '/header.html').toString();
//var footer = fs.readFileSync(baseDirectory + '/footer.html').toString();

// Testing out connecting to a database, creating a table, adding some data, querying the data, and closing the database
// Not meant to be run asynchronously, but only as an initial setup

// Database functions which aren't used here
/*
function testDatabase() {
	var db = new sqlite3.Database(baseDirectory + '/test.db', sqlite3.OPEN_READWRITE, (err) => {
		if (err) {
			return console.error(err.message);
		}
		console.log('Connected to the temporary sqlite database.');
	});

	//Plaintext password lol
	db.run('CREATE TABLE IF NOT EXISTS TempTable(username text, password text)');

	db.run(`INSERT INTO TempTable(username, password) VALUES(?, ?)`, ['Test user', '12345'], function(err) {
		if (err) {
			return console.log(err.message);
		}
		// get the last insert id
		console.log(`A row has been inserted with rowid ${this.lastID}`);
	});

	db.serialize(() => {
		db.each(`SELECT * FROM TempTable`, (err, row) => {
			if (err) {
				console.error(err.message);
			}
			console.log(row.username + "\t" + row.password);
		});
	});

	db.close((err) => {
		if (err) {
			return console.error(err.message);
		}
		console.log('Close the database connection.');
	});
}

// Initialize the database if you haven't already
//testDatabase();

function query_callback(sql, callback) {
	var results;
	
	var db = new sqlite3.Database(baseDirectory + '/test.db', sqlite3.OPEN_READWRITE, (err) => {
		if (err) {
			return callback(err, null); //console.error(err.message);
		}
		console.log('Connected to the temporary sqlite database.');
	});
	
	db.all(sql, [], (err, rows) => {
		if (err) {
			return callback(err, null); //console.error(err.message);
		}
		results = rows;
		return callback(null, results); 
		// Guess we won't even close the database... But somehow it still decides to close it after this.
		// asynchronous functions are bizarre.
	});
	
	db.close((err) => {
		if (err) {
			return callback(err, null); //console.error(err.message);
		}
		console.log('Close the database connection.');
	});
	
	//return callback(null, results);
}
*/

// Actual code

var QUEUE_LENGTH = 10;

// Matched per user
var users = [];
var passwords = []; // plaintext
var usingPlaylist = [];
var playlists = []; // Youtube IDs
var playlistsCommon = []; // More descriptive titles
var playlistIndices = [];
var tempSongs = [];

// Order of the users to cycle through
var currQueueIndex = 0;
var userQueueOrder = [];

var userQueue = []; // Calculated next n players
var songIdQueue = []; // Calculated next n songs

// Current values
var currentUser = ''
var currentSongUrl = '';
var currentSongId = '';
var timeStarted = '';
var ended = true;

// Add a user to the list when they arrive, or login otherwise
function login(user, password) {
	if (user == '') {
		return false;
	}
	var index = users.indexOf(user);
	if (index == -1) {
		users.push(user);
		passwords.push(password);
		usingPlaylist.push(false);
		playlistIndices.push(0);
		playlists.push([]);
		playlistsCommon.push([]);
		tempSongs.push('');
		return true;
	}
	// User is already in system
	// Validate password
	return password == passwords[index];	
}

// Make sure the correct username and password is used
function validateUser(user, password) {
	var index = users.indexOf(user);
	if (index == -1) {
		return false;
	}
	return password == passwords[index];
}

// Activate or deactivate the playlist for a user
function togglePlaylist(user, password) {
	console.log('Start toggle playlist');
	var valid = validateUser(user, password);
	if (!valid) {
		return 'Not logged in';
	}
	var index = users.indexOf(user);
	var message = '';
	if (index == -1) {
		message = 'No user with that name.'; // Unreachable
	}
	else {
		usingPlaylist[index] = !usingPlaylist[index];
		playlistIndices[index] = 0; // Reset playlist to start
		if (playlists[index].length > 0) {
			var value = usingPlaylist[index];
			message = 'Using playlist: '+value;
			if (value) {
				// Remove if they had a temporary song planned
				//var idex = userQueueOrder.indexOf(user);
				//userQueueOrder.splice(idx, 1);
				// Add to user queue
				userQueueOrder.push(user);
			}
			else {
				// Remove from user queue
				var idx = userQueueOrder.indexOf(user);
				if (currQueueIndex >= idx) {
					currQueueIndex = (currQueueIndex-1)%userQueueOrder.length;
				}
				userQueueOrder.splice(idx, 1);
				if (userQueueOrder.length == 0) {
					currQueueIndex = 0;
				}
			}
			// In either case, update the temporary Queue
			updateQueue();
		}
		/*
		else {
			message = 'You do not have any songs in your playlist.';
		}
		*/
	}
	console.log('End toggle playlist');
	return message;
}

// Get the playlist for a user
function getPlaylist(user, password) {
	var valid = validateUser(user, password);
	if (!valid) {
		console.log('no auth');
		return '';
	}
	var index = users.indexOf(user);
	if (index != -1) {
		var playlist = playlistsCommon[index];
		//console.log(playlist);
		var res = '';
		for (var i = 0; i < playlist.length; i++) {
			res += playlist[i];
			if (i < playlist.length - 1) {
				res += '\\';
			}
		}
		console.log(res);
		return res;
	}
	else {
		console.log('no user');
		return '';
	}
}

// Get the current place in the user's playlist
function getPlaylistIndex(user, password) {
	var valid = validateUser(user, password);
	if (!valid) {
		return -1;
	}
	var index = users.indexOf(user);
	if (index != -1) {
		return playlistIndices[index];
	}
	else {
		return -1;
	}
}

// Start a song
function startSong(user, songId) {
	console.log('Start of start song');
	ended = false;
	currentUser = user;
	currentSongId = songId;
	currentSongUrl = 'https://www.youtube.com/watch?v=' + songId;
	currQueueIndex = (currQueueIndex+1)%userQueueOrder.length;
	var userIndex = users.indexOf(user);
	if (tempSongs[userIndex] != '') {
		// Remove the temporary song if necessary
		tempSongs[userIndex] = '';
		console.log('Removing temp song');
		if (!usingPlaylist[userIndex]) {
			// Remove user from the queue entirely
			var idx = userQueueOrder.indexOf(user);
			userQueueOrder.splice(idx, 1);
			console.log('Removing '+user+' from queue');
		}
	}
	else {
		// Advance the playlist index
		playlistIndices[userIndex] = (playlistIndices[userIndex]+1)%playlists[userIndex].length;
	}
	// Update the queue again
	updateQueue();
	console.log('Song started: '+currentSongUrl+' by '+currentUser);
	timeStarted = Date.now();
	// Scrape video length
	const options = new URL(currentSongUrl);
	const req = https.get(options, (res) => {
		if (res.statusCode == 200) {
			//console.log(`STATUS: ${res.statusCode}`);
			//console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
			console.log('Start scrape length');
			res.setEncoding('utf8');
			var resstr = '';
			res.on('data', (chunk) => {
				resstr += chunk;
			});
			res.on('end', () => {
				console.log('Collected html');
				let re = /approxDurationMs\\\":\\\"([0-9]+)\\\"/;
				var arr = resstr.match(re);
				if (arr != null && arr.length > 1) {
					console.log('Duration for url '+currentSongUrl+' is '+arr[1]);
					var duration = arr[1];
					let currTime = Date.now();
					let diff = currTime - timeStarted;
					let remaining = duration - diff;
					// Start the next song at the end of this one (TODO: Plus some wait for loading?)
					console.log('Waiting for end of song...');
					setTimeout(endSong, remaining);
				}
				else {
					console.log('Failed to find song duration for url: '+currentSongUrl);
				}
			});
		}
		else {
			console.log('Could not load video to find duration: '+currentSongUrl)
		}
	});
	console.log('End of start song');
}

// End song and go to the next one if available
function endSong() {
	ended = true;
	console.log('Song ended');
	if (userQueue.length > 0) {
		console.log('Starting next song');
		var nextUser = userQueue[0];
		var nextSongId = songIdQueue[0];
		startSong(nextUser, nextSongId);
	}
}

// Get list of users
function getUserList() {
	var res = '';
	for (var i = 0; i < users.length; i++) {
		res += users[i];
		if (i < users.length - 1) {
			res += '\\';
		}
	}
	return res;
}

// Get user queue
function getUserQueue() {
	var res = '';
	for (var i = 0; i < userQueue.length; i++) {
		res += userQueue[i];
		if (i < userQueue.length - 1) {
			res += '\\';
		}
	}
	return res;
}

// Get current DJ
function getCurrentUser() {
	if (ended) {
		return 'None';
	}
	return currentUser;
}

// Get current song
function getCurrentSong() {
	if (ended) {
		return 'https://www.youtube.com/embed/';
	}
	return 'https://www.youtube.com/embed/' + currentSongId;
}

// Get current time in video for synchronization
function getCurrentTimeInVideo() {
	if (ended) {
		return 0;
	}
	else {
		let currTime = Date.now();
		let diff = currTime - timeStarted;
		return Math.round(diff/1000);
	}
}

// TODO: Update queue
function updateQueue() {
	console.log('Start update queue');
	console.log('Current Queue Index: '+currQueueIndex);
	console.log('userQueueOrder: '+userQueueOrder);
	console.log('users: '+users);
	console.log('playlists: '+playlists);
	console.log('indices: '+playlistIndices);
	
	if (userQueueOrder.length != 0) {
		// Use userQueueOrder along with usingPlaylist
		var uq = [];
		var sq = [];
		var i = currQueueIndex;
		var tempSongUsers = [];
		var cycle = 0;
		while (uq.length < QUEUE_LENGTH && cycle < QUEUE_LENGTH) {
			var u = userQueueOrder[i];
			var ui = users.indexOf(u);
			if (tempSongs[ui] != '') {
				if (usingPlaylist[ui]) {
					// Temp song and playlist
					if (tempSongUsers.indexOf(u) == -1) {
						// Temp song not added yet
						uq.push(u);
						sq.push(tempSongs[ui]);
						tempSongUsers.push(u);
					}
					else {
						// Temp song added, so go to normal playlist, but the cycle is offset
						if (playlists[ui].length > 0) {
							uq.push(u);
							sq.push(playlists[ui][(playlistIndices[ui]+cycle-1)%playlists[ui].length]);
						}
					}
				}
				else {
					if (tempSongUsers.indexOf(u) == -1) {
						// Temp song not added yet
						uq.push(u);
						sq.push(tempSongs[ui]);
						tempSongUsers.push(u);
					}
					// Otherwise, no other songs, so no other places in queue
				}
			}
			else {
				// Just using playlist
				if (playlists[ui].length > 0) {
					uq.push(u);
					sq.push(playlists[ui][(playlistIndices[ui]+cycle)%playlists[ui].length]);
				}
			}
			i = (i+1)%userQueueOrder.length;
			if (i == 0) {
				cycle++;
			}
		}
		// Update the queue
		userQueue = uq;
		songIdQueue = sq;
		console.log(userQueue);
		console.log(songIdQueue);
		// If no song is playing, start the next one
		if (ended) {
			console.log('No song playing, so starting next song');
			startSong(userQueue[0], songIdQueue[0]);
		}
	}
	else {
		userQueue = [];
		songIdQueue = [];
	}
	console.log('End update queue');
}

// Add song for one-time playing
function addSong(user, password, songId, response) {
	console.log('Start add temp song');
	var valid = validateUser(user, password);
	if (!valid) {
		response.writeHead(403);
		response.end();
	}
	else {
		var feedback = 'Temporary song added to queue. ';
		/*
		for (i = 0; i < userQueue.length; i++) {
			if (userQueue[i] == reqUser) {
				valid = false;
				feedback = 'You are already in the queue.'
			}
		}
		*/
		if (valid) {
			// Verify song id
			console.log('Start scraping length of temp song');
			var testSongUrl = 'https://www.youtube.com/watch?v=' + songId;
			const options = new URL(testSongUrl);
			const req = https.get(options, (res) => {
				if (res.statusCode == 200) {
					res.setEncoding('utf8');
					var resstr = '';
					res.on('data', (chunk) => {
						resstr += chunk;
					});
					res.on('end', () => {
						console.log('Got html for temp song');
						let re = /approxDurationMs\\\":\\\"([0-9]+)\\\"/;
						var arr = resstr.match(re);
						if (arr != null && arr.length > 1) {
							//TODO: Don't add directly?
							var index = users.indexOf(user);
							tempSongs[index] = songId;
							if (userQueueOrder.indexOf(user) == -1) {
								userQueueOrder.push(user);
							}
							console.log('Temp song added to queue');
							updateQueue();
							/*
							userQueue.push(reqUser);
							songIdQueue.push(reqSongId);
							if (userQueue.length == 1 && ended) {
								var user = userQueue.shift();
								var songId = songIdQueue.shift();
								startSong(user, songId);
							}
							*/
							feedback += 'You are in position '+userQueueOrder.length+'.'
						}
						else {
							valid = false;
							feedback = 'Invalid song id.';
						}
						response.writeHead(200);
						response.end(feedback);
					});
				}
				else {
					valid = false;
					feedback = 'Could not find URL.';
					response.writeHead(200);
					response.end(feedback);
				}
			});
		}
		else {
			response.writeHead(200);
			response.end(feedback);
		}
	}
	console.log('End add temp song');
}

// Add song to playlist
function addSongToPlaylist(user, password, songId, response) {
	console.log('Start add song to playlist');
	var valid = validateUser(user, password);
	if (!valid) {
		response.writeHead(403);
		response.end();
	}
	else {
		var index = users.indexOf(user);
		var feedback = 'Song added to playlist. ';
		console.log('Start scraping length of song');
		// Verify song id
		var testSongUrl = 'https://www.youtube.com/watch?v=' + songId;
		const options = new URL(testSongUrl);
		const req = https.get(options, (res) => {
			if (res.statusCode == 200) {
				res.setEncoding('utf8');
				var resstr = '';
				res.on('data', (chunk) => {
					resstr += chunk;
				});
				res.on('end', () => {
					console.log('Got html of song');
					let re = /approxDurationMs\\\":\\\"([0-9]+)\\\"/;
					var arr = resstr.match(re);
					if (arr != null && arr.length > 1) {
						playlists[index].push(songId);
						let re2 = /title\\\":\\\"(.*?)\\\",\\\"l/; // Lazy quantifier really helps here.
						var arr2 = resstr.match(re2);
						if (arr2 != null && arr2.length > 1) {
							var songTitle = arr2[1];
							// Remove backslashes to not mess up the list
							songTitle = songTitle.replace(/\\/g, '');
							console.log(songTitle);
							//console.log(songTitle.length);
							playlistsCommon[index].push(songTitle);
							//console.log(playlistsCommon);
						}
						else {
							playlistsCommon[index].push(songId);
							feedback += 'Could not find title.';
						}
						console.log('Added song: '+songId);
						console.log('Song added to playlist');
						if (usingPlaylist[index] && playlists[index].length == 1) {
							// This song was just added to an empty, active playlist
							// So add this user to the queue
							userQueueOrder.push(user);
						}
						updateQueue();
						/*
						userQueue.push(reqUser);
						songIdQueue.push(reqSongId);
						if (userQueue.length == 1 && ended) {
							var user = userQueue.shift();
							var songId = songIdQueue.shift();
							startSong(user, songId);
						}
						*/
						//feedback += 'Song added at position '+(playlists[index].length-1)+'.'
					}
					else {
						valid = false;
						feedback = 'Invalid song id.';
					}
					response.writeHead(200);
					response.end(feedback);
				});
			}
			else {
				valid = false;
				feedback = 'Could not find URL.';
				response.writeHead(200);
				response.end(feedback);
			}
		});
	}
	console.log('End add song to playlist');
}

// Delete song from playlist
function deleteFromPlaylist(user, password, idx) {
	console.log('Start delete song from playlist');
	var valid = validateUser(user, password);
	if (!valid) {
		return false;
	}
	else {
		var index = users.indexOf(user);
		var feedback = 'Deleted from playlist. ';
		if (idx < 0 || idx >= playlists[index].length) {
			feedback = 'Out of array bounds.';
			return false;
		}
		else {
			// Delete
			playlists[index].splice(idx, 1);
			playlistsCommon[index].splice(idx, 1);
			if (playlistIndices[index] >= idx) {
				playlistIndices[index]--;
			}
			if (playlists[index].length == 0) {
				playlistIndices[index] = 0;
			}
			console.log('Song deleted from playlist');
			// Refresh
			updateQueue();
		}
	}
	console.log('End delete song from playlist');
	return true;
}

// Test

//startSong('None', 'WtfsIBwOobA');

// Main

http.createServer(function (request, response) {
    try {
        var pathname = url.parse(request.url).pathname;
		//console.log('URL: '+pathname);
		
		//Do not allow access to blocked paths
		if (blocked_paths.indexOf(pathname) != -1) {
			console.log('Attempted to access a blocked path');
			response.writeHead(403); //403: Forbidden
			response.end();
		}
		else {
			var tmpUser = '';
			var tmpPassword = '';
			//Redirect to the index
			if (pathname == '/') {
				/*
				if (request.method == 'POST') {
					var body = '';
					request.on('data', function (data) {
						body += data;
						if (body.length > 1e6) request.connection.destroy();
					});
					request.on('end', function () {
						// Everything goes inside here now. Why is node designed like this? Why so much nesting?
						var post = qs.parse(body);
						reqUser = post['name'];
						reqPassword = post['password'];
						// And so on...
						// If I do it this way, the password won't be in plaintext, but I will have to put basically all of the following code nested inside this block, which is a pain. Passwords aren't super important for this anyway.
					});
				}
				*/
				var params = url.parse(request.url, true).query;
				reqUser = params['name'];
				reqPassword = params['password'];
				if (reqUser == null || reqPassword == null) {
					pathname = '/login.html';
				}
				else {
					var valid = login(reqUser, reqPassword);
					//response.writeHead(200);
					//response.end(valid);
					if (!valid) {
						console.log('Failed login for user '+reqUser);
						response.writeHead(403);
						response.end();
					}
					else {
						pathname = '/music-room.html';
						tmpUser = reqUser;
						tmpPassword = reqPassword;
						console.log('User: '+tmpUser)
						//console.log('Password: '+tmpPassword);
					}
				}
			}
			
			//Static requests
			if (pathname == '/time') {
				//console.log('time');
				// Get current time in song
				response.writeHead(200);
				response.end(''+getCurrentTimeInVideo());
			}
			else if (pathname == '/song') {
				//console.log('song');
				// Get current song
				response.writeHead(200);
				response.end(''+getCurrentSong());
			}
			else if (pathname == '/dj') {
				//console.log('dj');
				// Get current dj
				response.writeHead(200);
				response.end(''+getCurrentUser());
			}
			else if (pathname == '/list') {
				//console.log('list');
				// Get user list
				response.writeHead(200);
				response.end(''+getUserList());
			}
			else if (pathname == '/queue') {
				//console.log('queue');
				// Get user queue
				response.writeHead(200);
				response.end(''+getUserQueue());
			}
			else if (pathname == '/toggle') {
				//console.log('toggle');
				// Toggle playlist active
				var params = url.parse(request.url, true).query;
				reqUser = params['name'];
				reqPassword = params['password'];
				var valid = togglePlaylist(reqUser, reqPassword);
				response.writeHead(200);
				response.end(valid);
			}
			else if (pathname == '/index') {
				//console.log('index');
				// Get index in playlist for user
				var params = url.parse(request.url, true).query;
				reqUser = params['name'];
				reqPassword = params['password'];
				var valid = getPlaylistIndex(reqUser, reqPassword);
				response.writeHead(200);
				response.end(valid);
			}
			else if (pathname == '/playlist') {
				//console.log('playlist');
				// Get playlist for user
				var params = url.parse(request.url, true).query;
				reqUser = params['name'];
				reqPassword = params['password'];
				var valid = getPlaylist(reqUser, reqPassword);
				response.writeHead(200);
				response.end(valid);
			}
			else if (pathname == '/remove') {
				//console.log('remove');
				// Remove from playlist
				var params = url.parse(request.url, true).query;
				reqUser = params['name'];
				reqPassword = params['password'];
				reqIdx = params['idx'];
				var valid = deleteFromPlaylist(reqUser, reqPassword, reqIdx);
				response.writeHead(200);
				response.end(''+valid);
			}
			else if (pathname == '/add') {
				//console.log('add temp');
				// Add new song to queue, maybe
				var params = url.parse(request.url, true).query;
				reqUser = params['name'];
				reqPassword = params['password'];
				reqSongId = params['songId'];
				// Correct to the ID
				if (reqSongId.startsWith('http')) {
					var re = /v=(.*)/;
					var arr = reqSongId.match(re);
					if (arr != null && arr.length > 1) {
						reqSongId = arr[1];
					}
				}
				addSong(reqUser, reqPassword, reqSongId, response);
			}
			else if (pathname == '/listadd') {
				//console.log('add list');
				// Add new song to queue, maybe
				var params = url.parse(request.url, true).query;
				reqUser = params['name'];
				reqPassword = params['password'];
				reqSongId = params['songId'];
				// Correct to the ID
				if (reqSongId.startsWith('http')) {
					var re = /v=(.*)/;
					var arr = reqSongId.match(re);
					if (arr != null && arr.length > 1) {
						reqSongId = arr[1];
					}
				}
				addSongToPlaylist(reqUser, reqPassword, reqSongId, response);
			}
			else {
				if (pathname == '/music-room.html' && tmpUser == '') {
					response.writeHead(403);
					response.end();
				}
				else {
					// need to use path.normalize so people can't access directories underneath baseDirectory
					var fsPath = baseDirectory+path.normalize(pathname);
					
					var fileStream = fs.createReadStream(fsPath);
					
					//fileStream.pipe(response)
					
					var fileData = "";
					var chunks = [];
					
					// Modify the file data however is necessary (this is where you would use templating to your advantage)
					fileStream.on('open', function() {
						//console.log("open");
						//response.writeHead(200); //200: Good
					})
					fileStream.on("data", function (chunk) {
						//console.log(chunk);
						chunks.push(chunk);
					});
					fileStream.on("end", function () {
						//console.log("end");
						console.log(pathname);
						if (pathname == '/favicon.ico' || pathname == '/synthwave.jpg') {
							//response.writeHead(200, {'Content-Type': 'image/x-icon'} );
							response.writeHead(200);
							var icon = Buffer.concat(chunks);
							response.end(icon);
							//console.log('Got icon');
						}
						else {
							response.writeHead(200);
							fileData = Buffer.concat(chunks).toString();
							//fileData = fileData.replace(/\{% header %\}/g, header);
							//fileData = fileData.replace(/\{% footer %\}/g, footer);
							fileData = fileData.replace(/\{% name %\}/g, tmpUser);
							fileData = fileData.replace(/\{% password %\}/g, tmpPassword);
							response.end(fileData);
							//console.log('main');
						}
						
						//response.writeHead(200);
						//response.end(Buffer.concat(chunks));
					});
					fileStream.on('error',function(e) {
						console.log("error: no file");
						response.writeHead(404); //404: Not found
						response.end();
					});
				}
			}
		}
   } catch(e) {
        response.writeHead(500); //500: Internal server error
        response.end();     // end the response so browsers don't hang
        console.log(e.stack);
   }
}).listen(port);

console.log("listening on port "+port);