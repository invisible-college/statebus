var bus = require('statebus/server')()

// By default, the server's state will persist in a file called "db".

bus('/funny/*').on_save = function (obj) {
    // process some save by a client to your server...
}

bus('/funny/*').on_fetch = function (key) {
    return {joke: 'Why did the state cross the bus?'}
}

// Run this server so that client apps can connect to it and access data
bus.serve({port: 9375})
