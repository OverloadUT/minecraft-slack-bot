var config = require('./config.js')
var http = require('http')
var slack = require('slack-notify')(config.slack.webhookurl);
var Q = require('q')

var serverState = {
	initialized: false,
	playersOnline: 0,
	players: [],
	playerFaces: {},
	lastTimestamp: 0
}

var sessionCookie = null

function mainLoop() {
	var deferred = Q.defer()
	var cookie = ''
	if (sessionCookie) {
		cookie = 'JSESSIONID=' + sessionCookie
	}

	var options = {
		'hostname': config.dynmap.host,
		'port': config.dynmap.port,
		'path': '/up/world/world/'+serverState.lastTimestamp,
		'headers': {
			'Cookie': cookie
		}
	}

	var request = http.get(options, function(res) {
		if(res.statusCode == 200) {
			process.stdout.write("Good server response. Getting data");
			var resbody = '';

			//another chunk of data has been recieved, so append it to `resbody`
			res.on('data', function (chunk) {
				process.stdout.write(".");
				resbody += chunk;
			});

			//the whole response has been recieved, so process it
			res.on('end', function () {
				process.stdout.write("\r\n");
				resjson = JSON.parse(resbody)

				// If we haven't set out cookie yet, get it from the server
				if (sessionCookie == null) {
					if (res.headers['set-cookie'] != null && res.headers['set-cookie'][0] != null) {
						res.headers['set-cookie'][0].split(';').forEach(function(cookie) {
							cookiearr = cookie.split('=')
							if (cookiearr[0] == 'JSESSIONID') {
								sessionCookie = cookiearr[1]
								console.log("Got a cookie!")
								console.log(sessionCookie)
							}
						})
					}
				}

				if(!serverState.initialized) {
					serverState.initialized = true;
					resjson.players.forEach(function (player) {
						updateChatIcon(player.name)
					})
				} else {
					serverState.players = []
					resjson.players.forEach(function (player) {
						serverState.players.push(player.name)
					})

					resjson.updates.forEach(function(update) {
						if (update.type == "chat" && config.enableChat) {
							updateChatIcon(update.playerName)
							chatToSlack(update.playerName, update.message, update.source)
						} else if (update.type == 'playerjoin') {
							updateChatIcon(update.playerName)
							reportPlayerLogin(update.playerName, serverState.players)
						}
					})
				}

				serverState.playersOnline = resjson.currentcount;
				serverState.players = resjson.players;
				serverState.lastTimestamp = resjson.timestamp;

				deferred.resolve()
			});
		} else {
			console.log("http error")
			console.log(res)
			deferred.error()
		}

		res.on('error', function(err) {
			console.log("http error")
			console.log(err)
			deferred.error()
		});
	});

	request.on('error', function(err) {
		console.log("http error")
		console.log(err)
		deferred.error()
	});

	return deferred.promise;
}

// The main synchronous loop
(function mainLoopSync() {
	mainLoop().then(function() {
		setTimeout(mainLoopSync, 2000)
	})
})()

function updateChatIcon(playerName) {
	if (typeof(serverState.playerFaces[playerName]) === 'undefined') {
		var options = {
			'hostname': config.dynmap.host,
			'port': config.dynmap.port,
			'path': '/tiles/faces/32x32/' + playerName + '.png',
		}

		var request = http.get(options, function(res) {
			if (res.statusCode == 200) {
				serverState.playerFaces[playerName] = 'http://' + config.dynmap.host + ':' + config.dynmap.port + '/tiles/faces/32x32/' + playerName + '.png'
				console.log("Found a chat face for " + playerName)
			} else {
				serverState.playerFaces[playerName] = null
				console.log("No chat face found for " + playerName)
			}

			res.on('error', function(e) {
				console.log('problem with request: ' + e.message);
			});
		})

		request.on('error', function(err) {
			console.log("http error while getting chat icon")
			console.log(err)
		});
	}
	
}

var minecraftNotice = slack.extend({
  channel: config.announceChannel,
  icon_url: config.slack.icon_url,
  username: 'Minecraft Server'
});

var minecraftChat = slack.extend({
  channel: config.chatChannel,
  icon_url: config.slack.icon_url,
});


function chatToSlack(playerName, message, source) {
	username = playerName
	if (source == "web") {
		username = "[Web] " + username
	} else {
		username = "[Game] " + username
	}

	icon_url = serverState.playerFaces[playerName] || config.defaultChatFace

	minecraftChat({
		text: message,
		username: username,
		icon_url: icon_url
	}, function(err) {
		if (err) {
			console.log("Slack error")
			console.log(err)
		}
	})
}

function reportPlayerLogin(thisplayer, players) {
    minecraftNotice({
    	text: thisplayer + " logged in to the server!",
    	fields: {
    		'Players Online': players.join(", ")
    	}
    }, function(err) {
		if (err) {
			console.log("Slack error")
			console.log(err)
		} else {
			console.log("Slack success")
		}
	})
}