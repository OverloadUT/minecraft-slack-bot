var config = require('./config.js')
var http = require('http')
var slack = require('slack-notify')(config.slack.webhookurl);
var Q = require('q')

var serverState = {
	initialized: false,
	playersOnline: 0,
	players: [],
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

	http.get(options, function(res) {
		if(res.statusCode == 200) {
			console.log("Good server response. Getting data...")
			var resbody = '';

			//another chunk of data has been recieved, so append it to `str`
			res.on('data', function (chunk) {
				console.log(".")
				resbody += chunk;
			});

			//the whole response has been recieved, so we just print it out here
			res.on('end', function () {
				//console.log(resbody)
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
				} else {
					serverState.players = []
					resjson.players.forEach(function (player) {
						serverState.players.push(player.name)
					})

					resjson.updates.forEach(function(update) {
						if (update.type == "chat" && config.enableChat) {
							message = update.message
							username = update.playerName
							if (update.source == "web") {
								username = "[Web] " + username
							} else {
								username = "[Game] " + username
							}

							minecraftChat({
								text: message,
								username: username
							}, function(err) {
								if (err) {
									console.log("Slack error")
									console.log(err)
								}
							})
						} else if (update.type == 'playerjoin') {
							reportPlayerLogin(update.playerName, serverState.players)
						}
					})
				}

				serverState.playersOnline = resjson.currentcount;
				serverState.players = resjson.players;
				serverState.lastTimestamp = resjson.timestamp;

				deferred.resolve()
			});

    		res.on('error', function(err) {
				console.log("http error")
				console.log(err)
    			deferred.error()
    		});
		} else {
			console.log("http error")
			console.log(res)
			deferred.error()
		}
	});

	return deferred.promise;
}

function mainLoopSync() {
	mainLoop().then(function() {
		setTimeout(mainLoopSync, 2000)
	})
}

mainLoopSync()

var minecraftNotice = slack.extend({
  channel: config.announceChannel,
  icon_url: config.slack.icon_url,
  username: 'Minecraft Server'
});

var minecraftChat = slack.extend({
  channel: config.chatChannel,
  icon_url: config.slack.icon_url,
});

// ()).then(function() {
// 	setTimeout(mainLoop, 2000)
// });

function reportPlayerLogin(thisplayer, players) {
    var deferred = Q.defer();

    minecraftNotice({
    	text: thisplayer + " logged in to the server!",
    	fields: {
    		'Players Online': players.join(", ")
    	}
    }, function(err) {
		if (err) {
			console.log("Slack error")
			console.log(err)
			deferred.error()
		} else {
			console.log("Slack success")
			deferred.resolve()
		}
	})

    return deferred.promise;
}