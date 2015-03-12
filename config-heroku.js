var config = {};
config.dynmap = {};
config.slack = {};

config.dynmap.host = process.env.DYNMAP_HOST
config.dynmap.port = process.env.DYNMAP_PORT

config.slack.webhookurl = process.env.SLACK_WEBHOOK_URL
config.slack.icon_url = process.env.SLACK_ICON_URL

config.enableChat = process.env.CHAT_ENABLE
config.chatChannel = process.env.CHAT_CHANNEL
config.announceChannel = process.env.ANNOUNCE_CHANNEL

config.incomingChatServerPort = process.env.PORT
config.incomingChatToken = process.env.CHAT_SERVER_TOKEN
config.incomingChatPrivacy = process.env.CHAT_PRIVACY

config.chatNames = JSON.parse(process.env.CHAT_NAMES)

module.exports = config;