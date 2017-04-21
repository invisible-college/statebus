// A proxy server
//  • Chat messages are taken from the stateb.us server
//  • New messages are posted to stateb.us

statebus = require('statebus')

var upstream_bus = statebus.serve(),                     // Create a bus for our upstream server
    proxy_bus = statebus.serve({port: 3005})             // ..and our proxy server

proxy_bus('chat').to_fetch = function (k) {              // When a client fetches '/chat',
  return upstream_bus.fetch('/chat')                     // return the chat data stored at our upstream server
}                                                        // We're also subscribed to changes from upstream server

proxy_bus('message/*').to_save = function (o) {          // When a client saves a message, 
  chat = upstream_bus.fetch('/chat')                     // we'll add it to the chat history of the upstream bus
  chat.key = '/' + chat.key                              // (the need for this key prefixing is a bug)
  o.key = '/' + o.key
  chat.messages.push(o)
  upstream_bus.save(chat)                                // and then deliver it upstream  
}

upstream_bus.ws_client('/*', 'state://stateb.us:3006')   // Connect to our upstream server
