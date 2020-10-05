var UPDATE_INTERVAL = 1000; //ms
var MESSAGE_DURATION = 5000; //ms
var FADE_DURATION = 2000; //ms
var SYNCH_DELAY = 1; //s
var fadeTimerA = null;
var fadeTimerB = null;

var tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
var firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

// big iff true
function setWrapperSize(b) {
	var ifw = document.getElementById('playerdiv');
	ifw.className = (b) ? 'iframeWrapperBig' : 'iframeWrapperSmall';
}

function setResponseVisible(el, b) {
	el.className = (b) ? 'responseOn' : 'responseOff';
}

//var lastPlayerState = null;
var player = null;
function onYouTubeIframeAPIReady() {
	player = new YT.Player('player', {});
	setWrapperSize(true);
	//player.seekTo(lastTime, true);
	/*
	player.addEventListener('onStateChange', function(state) {
		console.log(state['data'] + ' ... ' + lastPlayerState);
		// This on its own could handle the unpause synchronization, I think, but doesn't quite work yet
		if (state['data'] == 1 && (lastPlayerState == -1 || lastPlayerState == 2)) {
			console.log('Seeking');
			player.seekTo(lastTime, true);
		}
		lastPlayerState = state['data'];
	});
	*/
}

var paused = false;
var unpausing = false;
var comingBack = false;
var muted = 1; // Initially muted because otherwise the video won't autoplay?
var unmuteApplied = false; // Only unmute at the beginning. Don't unmute every click
var currentSong = 'https://www.youtube.com/embed/';
var lastTime = 0;
var pauseTime = 0;
var playlistSize = 0;
var lastActiveIndex = -1;
var nowPlaying = false;
var currentSongName = '';

function init() {
	getPlaylist();
}

function update() {
	// Replaces upkeep, and also gets extra functionality, without having to make multiple server reqeusts
	var xhttp = new XMLHttpRequest();
	xhttp.onreadystatechange = function() {
		if (this.readyState == 4 && this.status == 200) {
			// Parse the JSON reponse
			//console.log(xhttp.responseText);
			var res = JSON.parse(xhttp.responseText);
			// Update current DJ, DJ list, newcomer list, user list, and playlist index
			document.getElementById('djcurr').innerHTML = res['currentUser'];
			nowPlaying = res['playing'];
			updateDJList(res['queue']);
			updateNewcomerList(res['newcomers']);
			updateUserList(res['userList']);
			updatePlaylistActiveSong(parseInt(res['playlistIndex']));
			// Show the current state of whether the playlist is active
			var toggleEl = document.getElementById('toggleplaylist');
			if (res['usingPlaylist']) {
				toggleEl.innerHTML = 'Deactivate';
			}
			else {
				toggleEl.innerHTML = 'Activate';
			}
			// Update the current song, but only if not paused
			if (!paused) {
				updateSong(res['currentSong'], parseInt(res['time']))
			}
			// Update the time on the song, regardless of whether it is paused
			lastTime = parseInt(res['time']);
			currentSongName = res['songName'];
			document.getElementById('songname').innerHTML = currentSongName;
			console.log(lastTime);
		}
	};
	xhttp.open('GET', 'update?name='+name+'&password='+password, true);
	xhttp.send();
}

function updatePlaylistActiveSong(index) {
	if (index != -1) {
		var el = document.getElementById('list'+index);
		if (el != null) {
			if (nowPlaying) {
				el.className = 'playingSong';
			}
			else {
				el.className = 'activeSong';
			}
		}
	}
	if (lastActiveIndex != -1 && index != lastActiveIndex) {
		var el_last = document.getElementById('list'+lastActiveIndex);
		if (el_last != null) {
			el_last.className = 'inactiveSong';
		}
	}
	lastActiveIndex = index;
}

function startEditSongName(index) {
	var el = document.getElementById('list'+index);
	if (el != null) {
		var txt = el.innerHTML;
		el.innerHTML = '<form onsubmit="return endEditSongName('+index+')"><input type="text" id="songName'+index+'" value="'+txt+'" maxlength="100" style="width: 100%;"/></form>'
		el.setAttribute('onclick', '');
	}
}

function endEditSongName(index) {
	var el = document.getElementById('list'+index);
	if (el != null) {
		var box = document.getElementById('songName'+index);
		var txt = box.value;
		el.innerHTML = txt;
		el.setAttribute('onclick', 'startEditSongName('+index+')');
		var xhttp = new XMLHttpRequest();
		xhttp.onreadystatechange = function() {
			if (this.readyState == 4 && this.status == 200) {
				// Get updated playlist (don't deal with trying to rearrange the indices yourself.)
				//getPlaylist();
			}
		};
		xhttp.open('GET', 'edit?name='+name+'&password='+password+'&i='+index+'&v='+txt, true);
		xhttp.send();
	}
	return false;
}

function togglePause() {
	// Only allow pause toggle when a video is actually active, otherwise the behavior will be weird.
	if (currentSong != 'https://www.youtube.com/embed/') {
		console.log('Toggle pause');
		paused = !paused;
		if (!paused) {
			//getSong();
			//getTime();
			unpausing = true;
			update();
			if (player != null) {
				player.playVideo();
			}
			//unpausing = false; //This is bad, it asynchronously sets it back immediately...
		}
		else {
			pauseTime = lastTime;
			if (player != null) {
				player.pauseVideo();
			}
		}
	}
}

function getPlaylist() {
	var xhttp = new XMLHttpRequest();
	xhttp.onreadystatechange = function() {
		if (this.readyState == 4 && this.status == 200) {
			var res = JSON.parse(xhttp.responseText);
			console.log('Playlist data: ' +xhttp.responseText);
			if (res['data'] != '') {
				lastActiveIndex = res['index'];
				nowPlaying = res['playing'];
				var playlist = res['data'].split('\\');
				playlistSize = playlist.length;
				var playlisttext = '';
				for (var i = 0; i < playlistSize; i++) {
					var tempClassName = 'inactiveSong';
					if (i == lastActiveIndex) {
						tempClassName = 'activeSong';
						if (nowPlaying) {
							tempClassName = 'playingSong';
						}
					}
					playlisttext += '<li class="playlistitem"><div id="list'+i+'" class="'+tempClassName+'" onclick="startEditSongName('+i+')">'+playlist[i]+'</div><button title="Delete" class="del" id="del'+i+'" onclick="remove('+i+')">X</button><button title="Move to Top" class="toTop" id="toTop'+i+'" onclick="moveToTop('+i+')">&#8607;</button><button title="Move Up" class="up" id="up'+i+'" onclick="moveUp('+i+')">&#8593;</button><button title="Move Down" class="down" id="down'+i+'" onclick="moveDown('+i+')">&#8595;</button><button title="Move to Bottom" class="toBottom" id="toBottom'+i+'" onclick="moveToBottom('+i+')">&#8609;</button></li><hr>'
				}
				document.getElementById('playlist').innerHTML = playlisttext;
				enableButtons();
			}
			else {
				playlistSize = 0;
				document.getElementById('playlist').innerHTML = '';
			}
		}
	};
	xhttp.open('GET', 'playlist?name='+name+'&password='+password, true);
	xhttp.send();
}

function updateUserList(listText) {
	var userlist = listText.split('\\');
	//console.log(userlist);
	var userstext = '';
	for (var i = 0; i < userlist.length; i++) {
		userstext += userlist[i];
		if (i != userlist.length-1) {
			userstext += ', ';
		}
	}
	document.getElementById('users').innerHTML = userstext;
}

function updateDJList(listText) {
	var djlist = listText.split('\\');
	for (var i = 0; i < 10; i++) {
		let v = '';
		if (i < djlist.length) {
			v = djlist[i];
		}
		document.getElementById('dj'+i).innerHTML = v;
	}
}

function updateNewcomerList(listText) {
	var newcomerlist = listText.split('\\');
	for (var i = 0; i < 3; i++) {
		let v = '';
		if (i < newcomerlist.length) {
			v = newcomerlist[i];
		}
		document.getElementById('new'+i).innerHTML = v;
	}
}

function updateSong(newSong, newTime) {
	// Redesigned, hopefully works better
	if (newSong == 'https://www.youtube.com/embed/') {
		if (currentSong != 'https://www.youtube.com/embed/') {
			lastTime = 0;
			currentSong = newSong;
			document.getElementById('player').src = currentSong;
			setWrapperSize(true);
		}
	}
	else {
		setWrapperSize(false);
		// The song is not null. Check the player state
		if (currentSong != newSong) {
			console.log('Changing song');
			currentSong = newSong;
			// Mute added to align with Google's policies about autoplay
			document.getElementById('player').src = currentSong + '?enablejsapi=1&controls=1&autoplay=1&mute='+muted+'&start=' + newTime;
		}
		if (player != null && player.getPlayerState != null) {
			var state = player.getPlayerState();
			console.log('Player state: '+state);
			var valid = false;
			// TODO: This may still have issues
			if (state == -1) { // Not started
				valid = true;
			}
			else if (state == 0) { // Ended
				valid = true;
			}
			else if (state == 1) { // Playing
				if (newTime < lastTime) {
					valid = true;
				}
			}
			else if (state == 2) { // Paused
				if (unpausing && newTime - pauseTime > SYNCH_DELAY) {
					valid = true;
				}
			}
			else if (state == 3) { // Buffering
				if (comingBack) {
					valid = true;
				}
			}
			if (valid) {
				player.seekTo(newTime, true);
			}
		}
		else {
			console.log('Falling back, not using API');
			document.getElementById('player').src = currentSong + '?enablejsapi=1&controls=1&autoplay=1&mute='+muted+'&start=' + newTime;
		}
	}
	comingBack = false;
	unpausing = false;
}

function add() {
	var songId = document.getElementById('tempsongid').value;
	// Clear the textbox
	document.getElementById('tempsongid').value = '';
	console.log(songId);
	var xhttp = new XMLHttpRequest();
	xhttp.onreadystatechange = function() {
		if (this.readyState == 4 && this.status == 200) {
			var el = document.getElementById('responsetemp');
			el.innerHTML = xhttp.responseText;
			//setResponseVisible(el, true);
			//console.log('Visible');
			if (fadeTimerA != null) {
				clearTimeout(fadeTimerA);
			}
			fadeTimerA = setTimeout(function() { setResponseVisible(el, false); }, MESSAGE_DURATION);
			document.getElementById('addbutton').disabled = false;
		}
	};
	xhttp.open('GET', 'add?name='+name+'&password='+password+'&songId='+songId, true);
	xhttp.send();
	document.getElementById('addbutton').disabled = true;
	var el = document.getElementById('responsetemp');
	el.innerHTML = 'Loading...';
	setResponseVisible(el, true);
}

function listAdd() {
	var songId = document.getElementById('songid').value;
	// Clear the textbox
	document.getElementById('songid').value = '';
	console.log(songId);
	var xhttp = new XMLHttpRequest();
	xhttp.onreadystatechange = function() {
		if (this.readyState == 4 && this.status == 200) {
			var el = document.getElementById('response');
			el.innerHTML = xhttp.responseText;
			//setResponseVisible(el, true);
			//console.log('Visible');
			if (fadeTimerB != null) {
				clearTimeout(fadeTimerB);
			}
			fadeTimerB = setTimeout(function() { setResponseVisible(el, false); }, MESSAGE_DURATION);
			getPlaylist();
			document.getElementById('listaddbutton').disabled = false;
		}
	};
	xhttp.open('GET', 'listadd?name='+name+'&password='+password+'&songId='+songId, true);
	xhttp.send();
	document.getElementById('listaddbutton').disabled = true;
	var el = document.getElementById('response');
	el.innerHTML = 'Loading...';
	setResponseVisible(el, true);
}

function togglePlaylist() {
	var el = document.getElementById('toggleplaylist');
	if (el.innerHTML == 'Activate') {
		el.innerHTML = 'Activating...';
	}
	else {
		el.innerHTML = 'Deactivating...';
	}
	var xhttp = new XMLHttpRequest();
	xhttp.onreadystatechange = function() {
		if (this.readyState == 4 && this.status == 200) {
			var res = xhttp.responseText;
			if (res == 'Activate' || res == 'Deactivate') {
				el.disabled = false;
			}
			el.innerHTML = res;
		}
	};
	xhttp.open('GET', 'toggle?name='+name+'&password='+password, true);
	xhttp.send();
	el.disabled = true;
}

// Helps prevent extra rearranging while the server is still processing it
function disableButtons() {
	for (var i = 0; i < playlistSize; i++) {
		document.getElementById('del'+i).disabled = true;
		document.getElementById('toTop'+i).disabled = true;
		document.getElementById('up'+i).disabled = true;
		document.getElementById('down'+i).disabled = true;
		document.getElementById('toBottom'+i).disabled = true;
	}
}

function enableButtons() {
	for (var i = 0; i < playlistSize; i++) {
		document.getElementById('del'+i).disabled = false;
		document.getElementById('toTop'+i).disabled = false;
		document.getElementById('up'+i).disabled = false;
		document.getElementById('down'+i).disabled = false;
		document.getElementById('toBottom'+i).disabled = false;
	}
}

function remove(i) {
	console.log('Deleting song '+i);
	disableButtons();
	var xhttp = new XMLHttpRequest();
	xhttp.onreadystatechange = function() {
		if (this.readyState == 4 && this.status == 200) {
			// Get updated playlist (don't deal with trying to rearrange the indices yourself.)
			getPlaylist();
		}
	};
	xhttp.open('GET', 'remove?name='+name+'&password='+password+'&idx='+i, true);
	xhttp.send();
}

function moveUp(i) {
	if (i != 0) {
		disableButtons();
		var xhttp = new XMLHttpRequest();
		xhttp.onreadystatechange = function() {
			if (this.readyState == 4 && this.status == 200) {
				// Get updated playlist (don't deal with trying to rearrange the indices yourself.)
				getPlaylist();
			}
		};
		xhttp.open('GET', 'move?name='+name+'&password='+password+'&i='+i+'&j='+(i-1), true);
		xhttp.send();
	}
}

function moveDown(i) {
	if (i != playlistSize-1) {
		disableButtons();
		var xhttp = new XMLHttpRequest();
		xhttp.onreadystatechange = function() {
			if (this.readyState == 4 && this.status == 200) {
				// Get updated playlist (don't deal with trying to rearrange the indices yourself.)
				getPlaylist();
			}
		};
		xhttp.open('GET', 'move?name='+name+'&password='+password+'&i='+i+'&j='+(i+1), true);
		xhttp.send();
	}
}

function moveToTop(i) {
	if (i != 0) {
		disableButtons();
		var xhttp = new XMLHttpRequest();
		xhttp.onreadystatechange = function() {
			if (this.readyState == 4 && this.status == 200) {
				// Get updated playlist (don't deal with trying to rearrange the indices yourself.)
				getPlaylist();
			}
		};
		xhttp.open('GET', 'move?name='+name+'&password='+password+'&i='+i+'&j=0', true);
		xhttp.send();
	}
}

function moveToBottom(i) {
	if (i != playlistSize-1) {
		disableButtons();
		var xhttp = new XMLHttpRequest();
		xhttp.onreadystatechange = function() {
			if (this.readyState == 4 && this.status == 200) {
				// Get updated playlist (don't deal with trying to rearrange the indices yourself.)
				getPlaylist();
			}
		};
		xhttp.open('GET', 'move?name='+name+'&password='+password+'&i='+i+'&j='+(playlistSize-1), true);
		xhttp.send();
	}
}

function voteSkip() {
	var reason = prompt("Are you sure you want to skip?", "Reason for skipping (optional, for debug)");
	if (reason != null) {
		console.log('Voting to skip');
		var xhttp = new XMLHttpRequest();
		xhttp.onreadystatechange = function() {
			if (this.readyState == 4 && this.status == 200) {
				// Nothing to do I guess
			}
		};
		if (reason != '') {
			xhttp.open('GET', 'skip?name='+name+'&password='+password+'&reason='+reason, true);
		}
		else {
			xhttp.open('GET', 'skip?name='+name+'&password='+password+'&reason=null', true);
		}
		xhttp.send();
	}
	else {
		console.log('Cancelled skip');
	}
}

function savePlaylist() {
	if (playlistSize > 0) {
		var xhttp = new XMLHttpRequest();
		xhttp.onreadystatechange = function() {
			if (this.readyState == 4 && this.status == 200) {
				//Download a txt file
				if (xhttp.responseText != '') {
					var data = new Blob([xhttp.responseText], {type: 'text/plain'});
					var url = window.URL.createObjectURL(data);
					window.open(url, '_blank');
				}
			}
		};
		xhttp.open('GET', 'save?name='+name+'&password='+password, true);
		xhttp.send();
	}
	
}

document.addEventListener('click', function() {
	muted = 0;
	// I was hoping this would work on mobile, but it does not.
	if (player != null && !unmuteApplied && currentSong != 'https://www.youtube.com/embed/') {
		player.unMute();
		console.log('unmuted');
		unmuteApplied = true;
	}
});

(function() {
	var hidden = "hidden";
	
	// Standards:
	if (hidden in document)
		document.addEventListener("visibilitychange", onchange);
	else if ((hidden = "mozHidden") in document)
		document.addEventListener("mozvisibilitychange", onchange);
	else if ((hidden = "webkitHidden") in document)
		document.addEventListener("webkitvisibilitychange", onchange);
	else if ((hidden = "msHidden") in document)
		document.addEventListener("msvisibilitychange", onchange);
	// IE 9 and lower:
	else if ("onfocusin" in document)
		document.onfocusin = document.onfocusout = onchange;
	// All others:
	else
		window.onpageshow = window.onpagehide = window.onfocus = window.onblur = onchange;
	
	function onchange (evt) {
		var v = "visible", h = "hidden",
		evtMap = {
		  focus:v, focusin:v, pageshow:v, blur:h, focusout:h, pagehide:h
		};
		evt = evt || window.event;
		if (evt.type in evtMap) {
			document.body.className = evtMap[evt.type];
		}
		else {
			document.body.className = this[hidden] ? "hidden" : "visible";
		}
		if (document.body.className != "hidden") {
			console.log('Update after coming back from another tab');
			comingBack = true;
			update();
		}
	}
	
	// set the initial state (but only if browser supports the Page Visibility API)
	if( document[hidden] !== undefined )
		onchange({type: document[hidden] ? "blur" : "focus"});
})();

setInterval(update, UPDATE_INTERVAL);
