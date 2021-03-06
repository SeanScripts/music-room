var http = require('http');
var https = require('https');
var url = require('url');
var fs = require('fs');
var path = require('path');
var qs = require('querystring');
var createError = require('http-errors');
var express = require('express');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var hash = require('pbkdf2-password')()
var session = require('express-session');
var favicon = require('serve-favicon');
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
// At this point it almost seems easier to only list the files which can be accessed...
var blocked_folders = ['/node_modules/', '/.git/'];
var blocked_paths = ['/.gitattributes', '/.gitignore', '/favicon.xcf', '/login.html', '/music-room.html', '/package', '/package-lock', '/readme.md', '/server.js'];

var port = process.env.PORT || 80; // Required for Heroku

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(favicon(path.join(__dirname, 'public', 'images', 'favicon.ico')));

app.use(session({
  resave: true, // don't save session if unmodified
  saveUninitialized: true, // don't create session until something stored
  secret: 'shhhh, very secret'
}));

// Session-persisted message middleware

app.use(function(req, res, next){
  var err = req.session.error;
  var msg = req.session.success;
  delete req.session.error;
  delete req.session.success;
  res.locals.message = '';
  res.locals.first_name = '';
  res.locals.last_name = '';
  res.locals.email_address = '';
  if (err) res.locals.message = '<p class="msg error">' + err + '</p>';
  if (msg) res.locals.message = '<p class="msg success">' + msg + '</p>';
  if (req.session.user) {
	res.locals.first_name = req.session.user.first_name;
	res.locals.last_name = req.session.user.last_name;
	res.locals.email_address = req.session.user.email_address;
  }
  next();
});

// Actual code

var MAX_USERS = 50; // Maybe...
var MAX_USERPASS_LENGTH = 20;
var MAX_PLAYLIST_SIZE = 100;
var MAX_PLAYLIST_INPUT_TEXT_SIZE = MAX_PLAYLIST_SIZE*12 - 1;
var MAX_INACTIVE_SONGS = 5;
var QUEUE_LENGTH = 10;
var SONG_END_DELAY = 2000; //ms
var INACTIVE_TIME = 5000; //ms
var SKIP_VOTE_RATIO = 0.5; //Or maybe more
var SKIP_TIME_DELAY = 1000; //ms
var NEWCOMER_COOLDOWN = 1000*60*60*12; //ms

// Matched per user
var users = [];
//var passwords = []; // plaintext
var salts = [];
var hashes = [];
var lastActive = [];
var usingPlaylist = [];
var playlists = []; // Youtube IDs
var playlistsNames = []; // More descriptive titles
var playlistsDurations = [] // Durations to not have to run many searches
var playlistIndices = []; // Gives the next song to play for each user
var tempSongs = [];
var tempSongDurations = [];
var tempSongNames = [];
var skipVotes = [];
var songsSinceInactive = [];
var newcomerTime = []; // For newcomer cooldown

// Order of the users to cycle through
//var currQueueIndex = 0;
var userQueueOrder = [];

var userQueue = []; // Calculated next n players
var songIdQueue = []; // Calculated next n songs
var timeQueue = []; // Calculated duration of next n songs (currently only used internally, but could give total user order queue duration
var nameQueue = []; // Calculated next n song names

// Newcomers -- people who are just playing their first song (with a given cooldown) get priority
var newcomers = [];

// Current values
var currentUser = ''
var currentSongUrl = '';
var currentSongId = '';
var currentSongName = '';
var currentSongDuration = 0;
var timeStarted = '';
var ended = true;
var skipping = false;

// These are some weirdly special cases, but good to keep track of.
var currentSongDeleted = false;
var playingTempSong = false;

var timer = null;


function authenticate(name, pass, fn) {
  if (name == '' || pass == '' || name.length > MAX_USERPASS_LENGTH || pass.length > MAX_USERPASS_LENGTH) {
	return fn(new Error('Invalid'));
  }
  if (!module.parent) console.log('authenticating %s:%s', name, pass);
  console.log('Start authentication');
  var index = users.indexOf(name);
  if (index != -1) {
	  hash({ password: pass, salt: salts[index] }, function(err, pass, salt, hash) {
		  if (err) return fn(err);
		  if (hash == hashes[index]) return fn(null, name);
		  fn(new Error('invalid password'));
	  });
  }
  else {
	//fn(new Error('No user with that name.'));
	console.log('Making new account');
	
	if (users.length < MAX_USERS) {
		hash({ password: pass }, function (err, pass, salt, hash) {
		  if (err) throw err;
		  salts.push(salt);
		  hashes.push(hash);
		});
		users.push(name);
		lastActive.push(Date.now());
		usingPlaylist.push(false);
		playlistIndices.push(0);
		playlists.push([]);
		playlistsNames.push([]);
		playlistsDurations.push([]);
		tempSongs.push('');
		tempSongDurations.push(0);
		tempSongNames.push('');
		skipVotes.push(false);
		songsSinceInactive.push(0);
		newcomerTime.push(0);
		return fn(null, name);
	}
	else {
		return fn(new Error('Too many users already'));
	}
  }
}

function restrict(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    req.session.error = 'Access denied!';
    res.redirect('/login');
  }
}


// Activate or deactivate the playlist for a user
function togglePlaylist(user) {
	console.log('Toggle playlist');
	var index = users.indexOf(user);
	usingPlaylist[index] = !usingPlaylist[index];
	var value = usingPlaylist[index];
	playlistIndices[index] = 0; // Reset playlist to start
	if (playlists[index].length > 0) {
		if (value) {
			// Remove if they had a temporary song planned
			//var idex = userQueueOrder.indexOf(user);
			//userQueueOrder.splice(idx, 1);
			// Make sure the user isn't already in the queue (from a temporary song)
			if (userQueueOrder.indexOf(user) == -1) {
				// Add to user queue
				userQueueOrder.push(user);
				// Insert in the correct position?
				/*
				var idx = currQueueIndex;
				userQueueOrder.splice(idx, 0, user);
				currQueueIndex++;
				*/
				// Check to see if they are a newcomer
				var time = Date.now();
				if (time - newcomerTime[index] > NEWCOMER_COOLDOWN && newcomers.indexOf(user) == -1) {
					newcomers.push(user);
					newcomerTime[index] = time;
				}
			}
		}
		else {
			// Remove from user queue
			var idx = userQueueOrder.indexOf(user);
			userQueueOrder.splice(idx, 1);
			// TODO: Deleting the queue order at the current index is an issue
			/*
			if (currQueueIndex == idx) {
				// Actually, this may not be a problem.
				console.log('Uncontrolled problem - deleted queue order at current index');
				// Leave unchanged...
			}
			else if (currQueueIndex > idx) {
				currQueueIndex--;
			}
			if (userQueueOrder.length == 0) {
				currQueueIndex = 0;
			}
			*/
		}
		// In either case, update the temporary Queue
		updateQueue();
	}
	/*
	else {
		message = 'You do not have any songs in your playlist.';
	}
	*/
	var retval = (value) ? 'Deactivate' :  'Activate';
	//console.log(retval);
	return retval;
}

function cycleOrder() {
	var newOrder = [];
	for (var i = 0; i < userQueueOrder.length; i++) {
		newOrder.push(userQueueOrder[(i+1)%userQueueOrder.length]);
	}
	userQueueOrder = newOrder;
}

// Start a song
function startSong(user, songId, songDuration, songName) {
	console.log('Start of start song');
	ended = false;
	currentSongDeleted = false;
	currentUser = user;
	currentSongId = songId;
	currentSongUrl = 'https://www.youtube.com/watch?v=' + songId;
	currentSongDuration = songDuration;
	currentSongName = songName;
	//currQueueIndex = (currQueueIndex+1)%userQueueOrder.length;
	var userIndex = users.indexOf(user);
	playingTempSong = (tempSongs[userIndex] != '')
	if (tempSongs[userIndex] != '') {
		// Remove the temporary song if necessary
		tempSongs[userIndex] = '';
		tempSongDurations[userIndex] = 0;
		tempSongNames[userIndex] = '';
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
	var time = Date.now();
	// This is a newcomer song, so remove them from the newcomer queue now
	// Only cycle the order if this isn't a newcomer song
	if (newcomers[0] == user) {
		newcomers.shift();
	}
	else {
		cycleOrder();
	}
	// If the user is inactive, increase their inactivity song count
	if (time - lastActive[userIndex] > INACTIVE_TIME) {
		songsSinceInactive[userIndex]++;
		if (songsSinceInactive[userIndex] > MAX_INACTIVE_SONGS) {
			// Remove from queue!
			usingPlaylist[userIndex] = false;
			var idx = userQueueOrder.indexOf(user);
			userQueueOrder.splice(idx, 1);
			//TODO: Delete from the user queue order
			/*
			if (currQueueIndex == idx) {
				// Actually, this may not be a problem.
				console.log('Uncontrolled problem - deleted queue order at current index');
				// Leave unchanged...
			}
			else if (currQueueIndex > idx) {
				currQueueIndex--;
			}
			if (userQueueOrder.length == 0) {
				// This is the last song
				currQueueIndex = 0;
			}
			*/
		}
	}
	else {
		// Reset inactivity count
		songsSinceInactive[userIndex] = 0;
	}
	// Update the queue again
	updateQueue();
	console.log('Song started: '+currentSongUrl+' by '+currentUser);
	timeStarted = Date.now();
	//var currTime = Date.now(); // Shouldn't be that different from the last time call...
	//let diff = currTime - timeStarted;
	let remaining = songDuration;// - diff;
	// Start the next song at the end of this one
	console.log('Waiting for end of song...');
	timer = setTimeout(endSong, remaining + SONG_END_DELAY);
	console.log('End of start song');
	// No longer need to scrape the video length, it's stored.
}

// End song and go to the next one if available
function endSong() {
	timer = null;
	ended = true;
	skipping = false;
	resetVotes();
	console.log('Song ended');
	if (userQueue.length > 0) {
		console.log('Starting next song');
		startSong(userQueue[0], songIdQueue[0], timeQueue[0], nameQueue[0]);
	}
}


// Get the playlist for a user
function getPlaylist(user) {
	var index = users.indexOf(user);
	var res = playlistsNames[index].join('\\');
	return JSON.stringify({'data': res, 'index': getPlaylistIndex(user), 'playing': (currentUser == user && !currentSongDeleted && !playingTempSong)});
}

// Get the current place in the user's playlist
function getPlaylistIndex(user) {
	var index = users.indexOf(user);
	if (currentUser == user && !playingTempSong) {
		// See if the current song playing exists in the playlist
		// This will be the previous index
		var idx = playlistIndices[index]-1;
		if (idx == -1) {
			idx = playlists[index].length-1;
		}
		// Special variable keeps track of whether the current song was deleted, because IDs alone can't tell if the songs are the same.
		if (currentSongDeleted) {
			return playlistIndices[index];
		}
		else {
			return idx;
		}
		/*
		// Equality of song ID is not enough.
		if (playlists[index][idx] == currentSongId) {
			return idx;
		}
		else {
			// It must have been deleted
			return -1;
		}
		*/
	}
	else {
		// The next song up
		return playlistIndices[index];
	}
}

// Get list of users
function getUserList() {
	var res = '';
	for (var i = 0; i < users.length; i++) {
		var time = Date.now();
		if (time - lastActive[i] < INACTIVE_TIME) {
			res += users[i];
			if (i < users.length - 1) {
				res += '\\';
			}
		}
	}
	return res;
}

// Get user queue
function getUserQueue() {
	return userQueue.join('\\');
}

// Get newcomers
function getNewcomers() {
	return newcomers.join('\\');
}

// Get current DJ
function getCurrentUser() {
	if (ended) {
		return 'None';
	}
	return currentUser;
}

function getCurrentSong() {
	if (ended) {
		return 'https://www.youtube.com/embed/';
	}
	return 'https://www.youtube.com/embed/' + currentSongId;
}

function getCurrentSongName() {
	if (ended) {
		return '';
	}
	return currentSongName;
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

// Update queue
function updateQueue() {
	console.log('Start update queue');
	//console.log('current queue index: '+currQueueIndex);
	console.log('user queue order: '+userQueueOrder);
	console.log('users: '+users);
	console.log('playlists: '+playlists);
	console.log('indices: '+playlistIndices);
	console.log('newcomers: '+newcomers);
	console.log('newcomer times: '+newcomerTime);
	
	if (userQueueOrder.length != 0) {
		// Use userQueueOrder along with usingPlaylist
		var uq = [];
		var sq = [];
		var tq = [];
		var nq = [];
		// Start at the next queue index so that it doesn't play the current person twice when new people join in
		var i = 1%userQueueOrder.length;
		//var i = (currQueueIndex+1)%userQueueOrder.length;
		var tempSongUsers = [];
		var cycle = 0;
		var inNewcomers = (newcomers.length > 0);
		var newcomerIndex = 0;
		var newcomersPlayed = [];
		while (uq.length < QUEUE_LENGTH && cycle < QUEUE_LENGTH) {
			var u = userQueueOrder[i];
			// Override with the newcomer if necessary
			if (inNewcomers) {
				u = newcomers[newcomerIndex];
				newcomersPlayed.push(u);
			}
			else {
				// Skip queue index for newcomers who have already played, so that they don't get multiple songs in a row. But only do it once for each newcomer.
				var skipNext = true;
				while (skipNext) {
					u = userQueueOrder[i]; //Slightly redundant, but helpful to make sure we have the right user
					var idx = newcomersPlayed.indexOf(u);
					if (idx != -1) {
						newcomersPlayed.splice(idx, 1);
						i = (i+1)%userQueueOrder.length;
					}
					else {
						skipNext = false;
					}
				}
			}
			var ui = users.indexOf(u);
			if (tempSongs[ui] != '') {
				if (usingPlaylist[ui]) {
					// Temp song and playlist
					if (tempSongUsers.indexOf(u) == -1) {
						// Temp song not added yet
						uq.push(u);
						sq.push(tempSongs[ui]);
						tq.push(tempSongDurations[ui]);
						nq.push(tempSongNames[ui]);
						tempSongUsers.push(u);
					}
					else {
						// Temp song added, so go to normal playlist, but the cycle is offset
						if (playlists[ui].length > 0) {
							uq.push(u);
							sq.push(playlists[ui][(playlistIndices[ui]+cycle-1)%playlists[ui].length]);
							tq.push(playlistsDurations[ui][(playlistIndices[ui]+cycle-1)%playlists[ui].length]);
							nq.push(playlistsNames[ui][(playlistIndices[ui]+cycle-1)%playlists[ui].length]);
						}
					}
				}
				else {
					if (tempSongUsers.indexOf(u) == -1) {
						// Temp song not added yet
						uq.push(u);
						sq.push(tempSongs[ui]);
						tq.push(tempSongDurations[ui]);
						nq.push(tempSongNames[ui]);
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
					tq.push(playlistsDurations[ui][(playlistIndices[ui]+cycle)%playlists[ui].length]);
					nq.push(playlistsNames[ui][(playlistIndices[ui]+cycle)%playlists[ui].length]);
				}
			}
			// Increment indices (depending on whether we are in the newcomer list or not)
			if (inNewcomers) {
				newcomerIndex++;
				if (newcomerIndex == newcomers.length) {
					inNewcomers = false;
				}
			}
			else {
				i = (i+1)%userQueueOrder.length;
				if (i == 0) {
					cycle++;
				}
			}
		}
		// Update the queue
		userQueue = uq;
		songIdQueue = sq;
		timeQueue = tq;
		nameQueue = nq;
		console.log(userQueue);
		console.log(songIdQueue);
		// If no song is playing, start the next one
		if (ended) {
			console.log('No song playing, so starting next song');
			startSong(userQueue[0], songIdQueue[0], timeQueue[0], nameQueue[0]);
		}
	}
	else {
		userQueue = [];
		songIdQueue = [];
	}
	console.log('End update queue');
}

// Called each second, combines some of the info in the response
function update(user) {
	var index = users.indexOf(user);

	// Update activity timestamp
	lastActive[index] = Date.now();
	
	// Find info for now
	var res = {};
	res['userList'] = getUserList();
	res['usingPlaylist'] = usingPlaylist[index];
	res['queue'] = getUserQueue();
	res['newcomers'] = getNewcomers();
	res['currentUser'] = getCurrentUser();
	res['playing'] = (user == getCurrentUser() && !currentSongDeleted && !playingTempSong);
	res['currentSong'] = getCurrentSong();
	res['time'] = getCurrentTimeInVideo();
	//res['playlist'] = getPlaylist(user, password); //This one could be considerably longer
	res['playlistIndex'] = getPlaylistIndex(user);
	res['songName'] = getCurrentSongName();
	return JSON.stringify(res);
}

// Add song for one-time playing
function addSong(user, songId, response) {
	console.log('Start add temp song');
	var feedback = 'Temporary song added to queue. ';
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
				console.log(resstr);
				let re = /approxDurationMs\":\"([0-9]+)\"/;
				var arr = resstr.match(re);
				if (arr != null && arr.length > 1) {
					// Verify that video is embeddable
					let re_emb = /playableInEmbed\":([a-z]+),/;
					var arr_emb = resstr.match(re_emb);
					if (arr_emb != null && arr_emb.length > 1 && arr_emb[1] == 'true') {
						var index = users.indexOf(user);
						tempSongs[index] = songId;
						tempSongDurations[index] = parseInt(arr[1]);
						// Get name, if possible
						let re2 = /title\":\"(.*?)\",\"l/; // Lazy quantifier really helps here.
						var arr2 = resstr.match(re2);
						if (arr2 != null && arr2.length > 1) {
							var songTitle = arr2[1];
							// Remove backslashes to not mess up the list
							songTitle = songTitle.replace(/\\u0026/g, '&'); //There may be others like this...
							songTitle = songTitle.replace(/\\/g, '');
							console.log(songTitle);
							tempSongNames[index] = songTitle;
						}
						else {
							tempSongNames[index] = 'Temp song (Could not find title)';
						}
						if (userQueueOrder.indexOf(user) == -1) {
							userQueueOrder.push(user);
							// Insert in the correct position?
							/*
							var idx = currQueueIndex;
							userQueueOrder.splice(idx, 0, user);
							currQueueIndex++;
							*/
						}
						// Check to see if newcomer
						var time = Date.now();
						if (time - newcomerTime[index] > NEWCOMER_COOLDOWN && newcomers.indexOf(user) == -1) {
							newcomers.push(user);
							newcomerTime[index] = time;
						}
						console.log('Temp song added to queue');
						updateQueue();
						feedback += 'You are in position '+userQueueOrder.length+'.'
					}
					else {
						feedback = 'Video is not embeddable.';
					}
				}
				else {
					valid = false;
					feedback = 'Invalid song id.';
				}
				response.end(feedback);
			});
		}
		else {
			valid = false;
			feedback = 'Could not find URL.';
			response.end(feedback);
		}
	});
	console.log('End add temp song');
}

// Add song to playlist
function addSongToPlaylist(user, songId, response) {
	if (songId.length > MAX_PLAYLIST_INPUT_TEXT_SIZE) {
		response.end('That\'s way too many songs.');
	}
	console.log('Start add song to playlist');
	var index = users.indexOf(user);
	var feedback = 'Song added to playlist.';
	var songIds = songId.split('.');
	console.log(songIds);
	if (songIds.length > 1) {
		var feedback = songIds.length+' songs added to playlist.'
	}
	var finished = 0;
	var failed = 0;
	// Placeholder lists for loading multiple songs
	var is_valid = [];
	var temp_names = [];
	var temp_durations = [];
	for (var i = 0; i < songIds.length; i++) {
		is_valid.push(false);
		temp_names.push('');
		temp_durations.push(0);
	}
	// Let solves the whole async problem here...
	for (let i = 0; i < songIds.length; i++) {
		console.log('Start scraping length of song '+i);
		// Verify song id
		var testSongUrl = 'https://www.youtube.com/watch?v=' + songIds[i];
		const options = new URL(testSongUrl);
		const req = https.get(options, (res) => {
			if (res.statusCode == 200) {
				res.setEncoding('utf8');
				var resstr = '';
				res.on('data', function(chunk) {
					resstr += chunk;
				});
				res.on('end', function() {
					console.log('Got html of song ' + i);
					let re = /approxDurationMs\":\"([0-9]+)\"/;
					var arr = resstr.match(re);
					if (arr != null && arr.length > 1) {
						// Verify that video is embeddable
						temp_durations[i] = parseInt(arr[1]);
						let re_emb = /playableInEmbed\":([a-z]+),/;
						var arr_emb = resstr.match(re_emb);
						if (arr_emb != null && arr_emb.length > 1 && arr_emb[1] == 'true') {
							is_valid[i] = true;
							let re2 = /title\":\"(.*?)\",\"l/; // Lazy quantifier really helps here.
							var arr2 = resstr.match(re2);
							if (arr2 != null && arr2.length > 1) {
								var songTitle = arr2[1];
								// Remove backslashes to not mess up the list
								songTitle = songTitle.replace(/\\u0026/g, '&'); //There may be others like this...
								songTitle = songTitle.replace(/\\/g, '');
								console.log(songTitle);
								temp_names[i] = songTitle;
							}
							else {
								temp_names[i] = songIds[i];
								feedback += 'Could not find title.';
							}
							console.log('Added song: '+songIds[i]);
							console.log('Song added to playlist');
						}
						else {
							feedback = 'Video is not embeddable.';
							failed++;
						}
					}
					else {
						feedback = 'Invalid song id.';
						failed++;
					}
					finished++;
					if (finished == songIds.length) {
						return endAddSongs(user, index, feedback, response, finished, failed, songIds, temp_names, temp_durations, is_valid);
					}
				});
			}
			else {
				feedback = 'Could not find URL.';
				failed++;
				finished++;
				if (finished == songIds.length) {
					return endAddSongs(user, index, feedback, response, finished, failed, songIds, temp_names, temp_durations, is_valid);
				}
			}
			
		});
	}
	console.log('End add song to playlist');
}

// Having this many parameters is a bit annoying, but is is better than repeating the exact same code twice and opening up an opportunity for errors with the two parts being different.
function endAddSongs(user, index, feedback, response, finished, failed, songIds, temp_names, temp_durations, is_valid) {
	console.log('Finished adding to playlist');
	//This was the last one, repond here
	if (songIds.length != 1) {
		feedback += ' '+(100*(finished-failed)/finished)+'%'
	}
	var appendIndex = playlists[index].length;
	for (var j = 0; j < songIds.length; j++) {
		if (is_valid[j]) {
			if (playlists[index].length < MAX_PLAYLIST_SIZE) {
				playlists[index].push(songIds[j]);
				playlistsNames[index].push(temp_names[j]);
				playlistsDurations[index].push(temp_durations[j]);
			}
			else {
				console.log(user + ' reached max playlist size');
				feedback = 'You have reached the maximum playlist size.';
			}
		}
	}
	// Fix the index so it doesn't reset to zero when adding songs while the last one is playing
	if (playlistIndices[index] == 0 && user == getCurrentUser() && playlists[index].length < MAX_PLAYLIST_SIZE) {
		playlistIndices[index] = appendIndex;
	}
	if (usingPlaylist[index] && playlists[index].length == 1) {
		// This song was just added to an empty, active playlist
		// So add this user to the queue
		if (userQueueOrder.indexOf(user) == -1) {
			console.log('Adding to user queue order because this is the first song added to an active playlist');
			userQueueOrder.push(user);
			// Insert in the correct position?
			/*
			var idx = currQueueIndex;
			userQueueOrder.splice(idx, 0, user);
			currQueueIndex++;
			*/
			// Check to see if newcomer
			var time = Date.now();
			if (time - newcomerTime[index] > NEWCOMER_COOLDOWN && newcomers.indexOf(user) == -1) {
				newcomers.push(user);
				newcomerTime[index] = time;
			}
		}
	}
	if (finished-failed > 0) {
		updateQueue();
	}
	response.end(feedback);
}


// Delete song from playlist
function deleteFromPlaylist(user, idx) {
	console.log('Start delete song from playlist');
	var index = users.indexOf(user);
	var feedback = 'Deleted from playlist. ';
	if (idx < 0 || idx >= playlists[index].length) {
		feedback = 'Out of array bounds.';
		return false;
	}
	else {
		// Delete
		playlists[index].splice(idx, 1);
		playlistsNames[index].splice(idx, 1);
		playlistsDurations[index].splice(idx, 1);
		// TODO: Deleting the song currently playing is an issue
		// Because the index gives the next cued song, index - 1 is what we want
		// Note the edge case has idx == length, when the last element is deleted
		if (user == getCurrentUser() && !currentSongDeleted && (idx == playlistIndices[index]-1 || (playlistIndices[index] == 0 && idx == playlists[index].length))) {
			//console.log('Uncontrolled problem - deleted song at current index');
			currentSongDeleted = true;
			// Okay, this is finally right.
			playlistIndices[index]--;
			if (playlistIndices[index] == -1) {
				playlistIndices[index] = playlists[index].length-2;
			}
		}
		else if (playlistIndices[index] > idx) {
			playlistIndices[index]--;
		}
		else if (playlistIndices[index] == idx && idx == playlists[index].length) {
			// Yet another edge case.
			playlistIndices[index] = 0;
		}
		if (playlists[index].length == 0) {
			playlistIndices[index] = 0;
			// Remove from the user queue order
			var tidx = userQueueOrder.indexOf(user);
			if (tidx != -1) {
				userQueueOrder.splice(tidx, 1);
				// TODO: Deleting the queue order at the current index is an issue
				/*
				if (currQueueIndex == tidx) {
					// Actually, this may not be a problem.
					console.log('Uncontrolled problem - deleted queue order at current index');
					// Leave unchanged...
				}
				else if (currQueueIndex > tidx) {
					currQueueIndex--;
				}
				if (userQueueOrder.length == 0) {
					currQueueIndex = 0;
				}
				*/
			}
			else {
				console.log('User not in queue somehow');
				return false;
			}
		}
		console.log('Song deleted from playlist');
		// Refresh
		updateQueue();
	}
	console.log('End delete song from playlist');
	return true;
}

function arrayMove(arr, fromIndex, toIndex) {
    var element = arr[fromIndex];
    arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, element);
}

function moveSong(user, i, j) {
	console.log('Start move song');
	var index = users.indexOf(user);
	if (i >= 0 && i < playlists[index].length && j >= 0 && j < playlists[index].length) {
		// Move the songs
		arrayMove(playlists[index], i, j);
		arrayMove(playlistsNames[index], i, j);
		arrayMove(playlistsDurations[index], i, j);
		// Update the queue now
		updateQueue();
	}
	else {
		return false;
	}
}

function voteSkip(user, reason) {
	console.log('Vote to skip');
	var index = users.indexOf(user);
	if (reason != 'null' && reason != 'Reason for skipping (optional, for debug)') {
		console.log('Reason for skipping: '+reason);
	}
	if (!skipping && !ended) {
		skipVotes[index] = true;
		var total = 0;
		var votes = 0;
		var time = Date.now();
		for (var i = 0; i < users.length; i++) {
			// Check that the user is active and voted to skip
			if (time - lastActive[i] < INACTIVE_TIME) {
				total++;
				if (skipVotes[i]) {
					votes++;
				}
			}
		}
		console.log('Skip ratio: '+(votes/total));
		if ((votes/total) > SKIP_VOTE_RATIO) {
			console.log('Skipping song');
			skipping = true;
			clearTimeout(timer);
			timer = setTimeout(endSong, SKIP_TIME_DELAY);
			//skipping = false;
			//resetVotes();
			return true;
		}
	}
	else {
		// Don't let them try to skip if it's already currently skipping or not playing anything
		return false;
	}
}

function resetVotes() {
	for (var i = 0; i < users.length; i++) {
		skipVotes[i] = false;
	}
}

function savePlaylist(user) {
	console.log('Start save playlist');
	var index = users.indexOf(user);
	if (playlists[index].length > 0) {
		return playlists[index].join('.');
	}
	else {
		return '';
	}
}

function editSongName(user, idx, val) {
	console.log('Start edit song name');
	var index = users.indexOf(user);
	if (idx >= 0 && idx < playlistsNames[index].length) { 
		playlistsNames[index][idx] = val;
		return true;
	}
	else {
		return false;
	}
}

app.get('/', function(req, res) {
	if (req.session.user) {
		res.redirect('/music-room');
	}
	else {
		res.redirect('/login');
	}
});

app.get('/music-room', restrict, function(req, res) {
	res.render('music-room');
});

app.get('/playlist', restrict, function(req, res) {
	res.send(getPlaylist(req.session.user));
});	

app.get('/toggle', restrict, function(req, res) {
	res.send(togglePlaylist(req.session.user));
});

app.get('/remove', restrict, function(req, res) {
	res.send(deleteFromPlaylist(req.session.user, req.query.idx));
});

app.get('/move', restrict, function(req, res) {
	res.send(moveSong(req.session.user, req.query.i, req.query.j));
});

app.get('/skip', restrict, function(req, res) {
	res.send(voteSkip(req.session.user, req.query.reason));
});

app.get('/edit', restrict, function(req, res) {
	res.send(editSongName(req.session.user, req.query.i, req.query.v));
});

app.get('/save', restrict, function(req, res) {
	res.send(savePlaylist(req.session.user));
});

app.get('/load', restrict, function(req, res) {
	res.send(loadPlaylist(req.session.user, req.query.data));
});

app.get('/update', restrict, function(req, res) {
	res.send(update(req.session.user));
});

app.get('/add', restrict, function(req, res) {
	var reqSongId = req.query.songId;
	if (reqSongId.startsWith('http')) {
		var re = /(?:com|be)\/(?:watch\?v=)?(.+)/; // Accounts for youtu.be short form
		var arr = reqSongId.match(re);
		if (arr != null && arr.length > 1) {
			reqSongId = arr[1];
		}
	}
	addSong(req.session.user, reqSongId, res);
});

app.get('/listadd', restrict, function(req, res) {
	var reqSongId = req.query.songId;
	// Correct to the ID
	if (reqSongId.startsWith('http')) {
		var re = /(?:com|be)\/(?:watch\?v=)?(.+)/; // Accounts for youtu.be short form
		var arr = reqSongId.match(re);
		if (arr != null && arr.length > 1) {
			reqSongId = arr[1];
		}
	}
	addSongToPlaylist(req.session.user, reqSongId, res);
});

// Login / Logout
app.get('/logout', function(req, res){
  // destroy the user's session to log them out
  // will be re-created next request
  req.session.destroy(function(){
    res.redirect('/login');
  });
});

app.get('/login', function(req, res){
	res.render('login');
});

app.post('/login', function(req, res){
  authenticate(req.body.username, req.body.password, function(err, user){
    if (user) {
      // Regenerate session when signing in
      // to prevent fixation
      req.session.regenerate(function(){
        // Store the user's primary key
        // in the session store to be retrieved,
        // or in this case the entire user object
        req.session.user = user;
		/*
        req.session.success = 'Authenticated as ' + user + '. '
          + ' click to <a href="/logout">logout</a>. '
          + ' You may now access <a href="/restricted">/restricted</a>.';
		*/
		
		res.redirect('/music-room');
		
      });
    } 
	else {
      req.session.error = 'Authentication failed, please check your username and password.';
      res.redirect('/login');
    }
  });
});




// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
