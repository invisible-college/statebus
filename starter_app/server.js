var bus = require('statebus-server')()

// By default, data is stored in a sqlite database

bus('*').on_save = function (obj) {
    // process some save by a client to your server...
    // if (obj.key.match('/awesome')) ...
}

bus('*').on_fetch = function (obj) {
    // process some fetch by a client to your server...
    // if (obj.key.match('/awesome')) ...
}

// Run this server so that client apps can connect to it and access data
bus.serve({port: 9375})
