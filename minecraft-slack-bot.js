var config = require('./config-heroku.js')
var http = require('http')
var slack = require('slack-notify')(config.slack.webhookurl);
var express = require('express')
var Q = require('q')

var bodyParser = require('body-parser');
var multer = require('multer');

var serverState = {
	initialized: false,
	playersOnline: 0,
	players: [],
	playerFaces: {},
	lastTimestamp: 0,
	lastServerResponseTime: 0,
	serverOnline: true
}

var sessionCookie = null

var recentSentMessages = []

var TIMEOUT_LENGTH = 120000

var defaultChatFace = 'http://' + config.dynmap.host + ':' + config.dynmap.port + '/tiles/faces/32x32/default.png'

// If we're doing Slack->Minecraft chat, set up an http server to get the data from Slack
if (config.enableChat) {
	var app = express()
	app.use(bodyParser.json()); // for parsing application/json
	app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
	app.use(multer()); // for parsing multipart/form-data

	// Just in case someone opens the page in the browser
	app.get('/', function (req, res) {
		console.log("Got GET request")
		res.send("You don't belong here.")
	})

	app.post('/', function (req, res) {
		console.log("Got POST request")
		var postdata = req.body

		// Only do something if the token matches the secret token in the Slack integration config
		if(postdata.token == config.incomingChatToken) {
			// Ignore messages from USLACKBOT, as those were sent TO slack from Minecraft in the first place!
			if(postdata.user_id != 'USLACKBOT') {
				var username = 'UnknownUser'
				if (config.chatNames[postdata.user_name]) {
					username = config.chatNames[postdata.user_name]
				} else if (!config.incomingChatPrivacy) {
					username = postdata.user_name
				}

				var message = postdata.text

				var payload = JSON.stringify({
					name: username,
					message: message
				})

				console.log("Sending chat to Minecraft server:")

				if (recentSentMessages.unshift(username + '-' + message) > 10) {
					recentSentMessages.length = 10
				}

				var options = {
					hostname: config.dynmap.host,
					port: config.dynmap.port,
					path: '/up/sendmessage',
					method: 'POST',
					'Content-Type': 'application/json',
					'Content-Length': payload.length
				};

				var req = http.request(options, function(res) {
					res.setEncoding('utf8');
					res.on('data', function (chunk) {
						// TODO We should really check the server's response in case it was rejected
					});
				});

				req.on('error', function(e) {
					console.log('HTTP Error while sending chat to dynmap: ' + e.message)
					console.log(e)
				});

				// write data to request body
				req.write(payload);
				req.end();
			}
		}

		res.send('')
	})

	var server = app.listen(config.incomingChatServerPort, function() {
		var host = server.address().address
		var port = server.address().port

		console.log('Chat server listening at http://%s:%s', host, port)
	})
}

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
			serverState.lastServerResponseTime = Date.now();
			serverState.serverOnline = true;
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
							// Check to make sure this message wasn't sent FROM Slack to begin with
							if(recentSentMessages.indexOf(update.playerName + '-' + update.message) == -1) {
								updateChatIcon(update.playerName)
								chatToSlack(update.playerName, update.message, update.source)
							} else {
								console.log('Ignored chat message that originated from Slack')
							}
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
			console.log("HTTP error: Non-200 status code")
			console.log(res)
			deferred.resolve()
		}

		res.on('error', function(err) {
			console.log("http error when recieving packets")
			console.log(err)
			deferred.resolve()
		});
	});

	request.on('error', function(err) {
		console.log("http error on connection attempt")
		console.log(err)
		deferred.resolve()

		if(serverState.serverOnline && Date.now() - serverState.lastServerResponseTime > TIMEOUT_LENGTH) {
			console.log("Server has been offline for 60 seconds. Announcing it to Slack!")
			serverState.serverOnline = false;
			reportServerOffline();
		}
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

	icon_url = serverState.playerFaces[playerName] || defaultChatFace

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

function reportServerOffline() {
    minecraftNotice({
    	text: "Oh noooooooooo. Server appears to be offline!",
    	fields: {}
    }, function(err) {
		if (err) {
			console.log("Slack error")
			console.log(err)
		} else {
			console.log("Slack success")
		}
	})
}