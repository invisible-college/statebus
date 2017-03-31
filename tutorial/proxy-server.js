// A proxy server
//  • Chat messages are taken from the stateb.us server
//  • New messages are posted to stateb.us

statebus = require('statebus/server')

var upstream_bus = statebus(),                           // Create a bus for our upstream server
    proxy_bus = statebus({port: 3005})                   // ..and our proxy server

proxy_bus('chat').to_fetch = function (k) {              // When a client fetches '/chat', 
  return upstream_bus.fetch('chat')                      // return the chat data stored at our upstream server
}                                                        // We're also subscribed to changes from upstream server

proxy_bus('message/*').to_save = function (o) {          // When a client saves a message, 
  upstream_bus.save.fire(o)                              // pass it upstream
}

upstream_bus.ws_client('/*', 'state://stateb.us:3005')   // Connect to our upstream server
