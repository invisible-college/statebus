# Statebus Tutorial

Statebus is a new version of HTTP that *synchronizes* state.
  - All state in your website gets a URL, with `state://`
  - State can be a function of other state
  - Statebus guarantees all state is synchronized automatically.


## Making a client

No server needed!

Just put the following code into a .html file on your computer, and
double-click the file, to open it in your web browser with a `file:///` url,
and get a working chat:

```coffeescript
<script type="statebus">                       # Scripts with this tag are interpreted by statebus

dom.BODY = ->                                  # Define the webpage with dom.BODY = ->
  messages = fetch('/chat').messages or []     # Get the current state of the chat!
  DIV {},
    for message in messages                    # Print each message in the chat
      DIV(message)
    REPLY_BOX()                                # ... and a textbox for writing new messages

dom.REPLY_BOX = ->                             # So let's define the reply box
  reply = fetch('reply')                       # We fetch the text written so far
  chat = fetch('/chat')

  DIV {},
    INPUT
      type: 'text'
      value: reply.text                        # Show the current state of the text in the box
      onChange: (e) =>                         # ...and when it changes:
        reply.text = e.target.value            #    1) Update the state of the text
        save(reply)                            #    2) And save the new value to the bus!

    BUTTON
      onClick: (e) =>
        chat.messages or= []                   # Initialize the messages to []

        chat.messages.push(reply.text)         # Add our new message to the list!
        save(chat)

        reply.text = ''                        # Clear the reply box
        save(reply)
      'Send'

</script><script src="https://stateb.us/client6.js"></script>
```

Now you have a working statebus chat!  It synchronizes messages witih everyone
who opens it.


### Reactive Functions
This code is built using reactive functions.
Statebus provides a distributed key/value store for
managing your state, and will notify those functions to re-run whenever
it detects a change.

Here's one of those reactive functions:

```coffeescript
dom.REPLY_BOX = ->
```

Any function on `dom.*` defines a reactive HTML tag, which you can use
anywhere else in the page with e.g. `REPLY_BOX()`.  When the function runs,
it remembers every piece of state it fetches, and will re-runs automatically
whenever that state changes, to determine its new HTML.

Behind the scenes, these dom functions are actually creating React components.

### Fetch
```coffeescript
messages = fetch('/chat').messages or []
```
Fetch both retrieves and subscribes to a piece of state
in Statebus. State is arbitrary JSON with a field `key:`, which
defines its unique URL. So the line of code above subscribes to the
state at the URL '/chat', and returns its messages field.
If there isn't a messages field defined on that state,
Statebus returns undefined, and we so we set messages to be an empty list.

```javascript
> fetch('/chat')
> {
    key: '/chat',
    messages: ['hello world!']
  }
```


### Executing reactive functions
You can execute a reactive function using its UPPERCASE name.
There are the standard html components, like DIV and TEXTAREA,
and there are also the custom ones you import or define on your own.

Let's look at both standard components and custom components
in the next few lines of code.
```coffeescript
 DIV {},
    for message in messages
      DIV(message)
    REPLY_BOX()
```
This block of code that renders (1) the list of chat messages
and (2) a custom component for typing new messages. These both are
contained in a parent DIV. Any time the list of messages changes,
these components will re-render.

You might be wondering about the syntax `DIV {},`. The `{},` is related
to passing arguments to your components, like styling your components with css rules. But we're not passing any arguments now for simplicity, so we're just passing in an empty object.
<!---If you're curious about styles, jump to our [Defining styles](http://) section.---->

The custom REPLY_BOX component is defined in the next line.
```coffeescript
dom.REPLY_BOX = ->
```

Just like we defined the dom.BODY, this component defines an input box and
a send button. One difference is that the REPLY_BOX component is
concerned with changes in state that occur _locally_ when the user types in
a box. So this is a good time to look at where state is stored.

### Where is state stored?
State can be stored locally in the browser or remotely on any server that implements the
statebus protocol. Just like HTTP documents, the location of state is determined by its URL prefix.

Here's how you access 'chat' state from a server `stateb.us`:

```coffeescript
fetch('state://stateb.us:3006/chat')
```

That's a little verbose if you're always fetching from the same server, so we allow you to omit the server name when accessing statebus's default server.

```coffeescript
fetch('/chat')
```

And if you provide no prefix at all, then you can access the local storage in the browser.

<!--- Travis sez this isn't quite right...the state is stored locally, but not what is typically called Local Storage. You can store in local storage with the ls/ prefix, as in 'ls/you'. This state will persist between page refreshes. ---->

```coffeescript
fetch('chat')
```

That brings us to the next few lines, which fetch some local state at the URL 'reply'
and updates an input box whenever a user types and changes that state:

```coffeescript
  reply = fetch('reply')
  DIV {},
    INPUT
      type: 'text'
      value: reply.text
      onChange: (e) =>
        reply.text = e.target.value
        save(reply)
```

The final chunk of code works with both local and remote state to
implement a send button. When someone clicks the button, a new
message is added to the chat feed, and the textbox is cleared away.

```coffeescript
    BUTTON
      onClick: (e) =>
        chat.messages or= []                   # Initialize the messages to []

        chat.messages.push(reply.text)         # Add our new message to the list!
        save(chat)

        reply.text = ''                        # Clear the reply box
        save(reply)
      'Send'
```

## Make a server
Congratulations. You've walked through an entire chat widget implemented over the statebus protocol. Many applications can be built without touching server code, but sometimes it's
necessary to implement a server that handles permissions and other features like data filtering.

Let's make a server for our chat widget that allows us to create users and handle privacy.

### Install statebus and create your server

```shell
npm install statebus
```

Now create a barebones server called server.js, and put this in it:

```javascript
var bus = require('statebus').serve({port: 3006})
```

### Start your server

```shell
node server.js
```

Your server should now be running at localhost:3006. If you want the server to restart automatically when you edit your files, use `nodemon` or `supervisor` instead of `node`.


### Update your client to use your server

In your sample [client code](https://github.com/invisible-college/statebus#making-a-client), you included the statebus library with:

```html
<script src="https://stateb.us/client6.js"></script>
```

We're going to use our own server, not the default `https://stateb.us:3006` server. Update your html file with:

```html
<script src="https://stateb.us/client6.js" server="http://localhost:3006"></script>
```

Open your .html file in your browser. It now has an empty chat history. This is because every Statebus server has its own data store, and when you set the `server` attribute of the statebus client script tag, you specify a default server for the data. Thus, `fetch('/chat')` state is by default accessing the data stored at your new server.

To continue fetching and saving chat data to the stateb.us server, you could modify your .html file to use absolute state URLs by fetching from `state://stateb.us:3006/chat` instead of `/chat`. Or we could change our server to proxy state stored at `stateb.us:3006`. Let's create that proxy server!


### Question: What's on the bus?

Answer: State is on the bus, getting delivered.

```javascript
var upstream_bus = statebus.serve(),
    proxy_bus = statebus.serve({port: 3006})

upstream_bus.ws_client('/*', 'state://stateb.us:3006')
```

Each bus defines a separate state space that allows a client to access data through it. On our proxy server, we have a `proxy_bus` that will deliver state to any clients that connect to our proxy. Our proxy, in turn, will access state from our upstream server through the `upstream_bus`.

You can make multiple busses anywhere, client or server, fetch and save from them independently, and set to_* handlers on them.

```javascript
var statebus = require('statebus')  // This is already done for you on client

// Make a couple busses:
var bus = statebus.serve()          // This is already done for you on client
var gus = statebus.serve()

bus.fetch('foo').bar          // ==> undefined
bus.save({key:'foo', bar: 3})
bus.fetch('foo').bar          // ==> 3
fetch('foo').bar              // ==> 3
gus.fetch('foo').bar          // ==> undefined
```

(On the client, you can use the global `fetch()` and `save()` functions, which access state on `bus`.)

### Programming state with to_* handlers

In our proxy server above, we defined two custom handlers for our state:

```javascript
proxy_bus('chat').to_fetch = function (k) {[snip]}
proxy_bus('message/*').to_save = function (o) {[snip]}
```

These handlers define how our proxy server relays state between clients and the upstream `stateb.us:3006` server.

These handlers give you control over how state is read and written through the respective bus. You can use them to:
- Make proxies or caches that define state in terms of other state
- Give users distinct permissions and views of state (we'll do this later)
- Create handy state abstractions that live-update on any schedule you can program

There is a handler for each of the Statebus methods:

| Method      | Handler                                           |
| :---------- | :------------------------------------------------ |
| fetch(key)  | bus(key_space).to_fetch  = function (key) { ... } |
| save(obj)   | bus(key_space).to_save   = function (obj) { ... } |
| forget(key) | bus(key_space).to_forget = function (key) { ... } |
| delete(key) | bus(key_space).to_delete = function (key) { ... } |

These handlers can be written on clients as well -- on any state bus.

Let's take a closer look at the `to_fetch` and `to_save` handlers.

### Define state programmatically with `to_fetch`

`to_fetch` is handy for making proxies or caches in terms of other state, regardless of where that state is stored.

```javascript
proxy_bus('chat').to_fetch = function (k) {
  return upstream_bus.fetch('chat')
}
```

Whenever a client requests the chat state from our proxy server, the `to_fetch` handler just passes through the chat state from our upstream server.

A `to_fetch` handler can add any state it wishes. For example, perhaps we want to note the origin of the state from our upstream server for our client:

```javascript
proxy_bus('chat').to_fetch = function (k) {  
  return {
    key: 'chat',
    origin: 'stateb.us:3006',
    messages: upstream_bus.fetch('chat').messages
  }
}
```

Handlers are automatically reactive, so whenever the chat state on our upstream server changes, our
`to_fetch` handler will re-run and produce a new chat history for any clients that fetched the
proxy's chat history.  The reactions will start when a client fetches it, and stop when all clients
have forgotten it, so that we don't carry on with unnecessary reactions.

You can also define a `to_fetch` handler for a *space* of keys, by appending `*` to the key:

```javascript
bus('one_plus/*').to_fetch = function (key) {         // The specific key being fetched is passed as "key"
   var num = Number(key.split('/')[1])
   return {result: 1 + num}
}

fetch('one_plus/2').result   // ==> 3
```

The general form of a `to_fetch` handler is:

```javascript
bus('the_answer').to_fetch = function (key, t) {
   // Do some stuff...
   // ...and then fire the new state across the bus,
   // using one of these equivalent statements:
   return {key: 'the_answer', n: 42}
   return {n: 42}                                    // Statebus can infer the key in return statements
   my_async_funk( function(){
     t.done({key: 'the_answer', n: 42})       // Use this from within callbacks
   })
}
```

Each .to_fetch function *must* eventually return new state, either with a
return statement or t.done(obj).  Until the `.to_fetch function returns,
anything that fetches it will be *loading*.

### Handle saves with `to_save`

`to_save` handlers help you control what happens when a piece of state changes. For example,
our proxy server will send new and updated messages to our upstream server:

```javascript
proxy_bus('message/*').to_save = function (o, t) {
  upstream_bus.save(o)
}
```

The general form of a `to_save` handler is:

```javascript
bus("key_pattern").to_save = function (obj, t) {
   // Here you can validate obj, tweak it, update a backing store...
   // And eventually, either call:
   t.abort()   // To deny this save request!

   // ... or:
   t.done(obj)    // To broadcast the result across the bus!

   // ... or:
   t.refetch()    // To re-run a to_fetch handler, if you've defined one.
}
```

Your `to_save` handler will receive the requested new state `obj` and transaction `t` as
parameters, and must either call `t.abort(obj)` to ignore the request, or
`t.done(obj)` to broadcast it.

This lets you control:
- Which changes to state are allowed
- Validation and cleaning
- Where state is stored (*e.g.* in a database)
- Updating dependent state
- When to broadcast updates

`to_save handlers are also reactive, but stop reacting as soon as they run once
to completion without anything fetched loading.  This lets you fetch state
from other places (*e.g.* over the network) and be sure that your handler will
run once the state has loaded.


## A server with authentication and access control

Sometimes you want to know who is riding your bus, and make sure they're not rifling through someone else's baggage.

Let's create a different server with multiple users, authentication, and access control. Copy and paste the code below into your server.js file, entirely replacing its contents. We'll then unpack it.

```javascript
// A chat server
// We want these controls on the server:
//  • Only authors can update a message or delete it
//  • Ensure the /chat index stays in sync with new messages added

var master_bus = require('statebus').serve({       // The master bus
  port: 3006,

  client: function (client_bus) {                   // The client bus defines an API for how each connected
                                                    // user can fetch() and save() master state.

    client_bus('message/*').to_save = function (o) {// Only authors can update a post
      o.key = o.key || 'message/' + random_string()    // Ensure that a message has a key
      var obj = master_bus.fetch(o.key)             // Get the version of this state stored in master, if any

      author_change = obj.author &&                 // Address case where a malicious client tries to
                      obj.author != o.author        // directly change the author of the message

      if (!o.author && !author_change)
        o.author = uid(client_bus)                  // Set the author of a new message

      if (author_change || o.author != uid(client_bus))
        client_bus.save.abort(o)                    // Ha! A devious client thwarted!
      else {
        master_bus.save(o)                          // Looks good. Save it to master
      }
    }
                                                    // Only authors can delete a message
    client_bus('message/*').to_delete = function (k,t) {
      var msg = client_bus.fetch(k)
      if (uid(client_bus) == msg.author) {          // Ensure current user is the author
        master_bus.delete(k)                        // to delete the message
        t.done()
      } else {
        t.abort()                                   // otherwise, reject the delete
      }                                             // (the abort method for delete will change soon)
    }

    client_bus('chat').to_save = function (o) {     // Clients can't change the chat history directly
      client_bus.save.abort(o)                      // Prevent save from happening!
    }

    client_bus.shadows(master_bus)                  // Anything not matched to the handlers above
                                                    // will pass through to the master bus.
  }

})

// Now we can define how state on the master bus behaves.

master_bus('message/*').to_save = function (o, t) { // When a message is saved, put it in the chat history
  var chat = master_bus.fetch('chat'),
      idx = chat.messages.findIndex(function (m) {return m.key === o.key})

  if (idx == -1) {                                 // If this message is not in the chat history...
    chat.messages.push(o)                          // add it
    master_bus.save(chat)                          // and save our change to the history
  }
  t.done(o)                                        // Now complete the save of the message
}

master_bus('message/*').to_delete = function (k, t) { // Cleanup when a message is deleted
  var chat = master_bus.fetch('chat'),
      idx = chat.messages.findIndex(function(m){return m.key == k})

  if (idx > -1) {                                  // We found the message to delete
    m = chat.messages.splice(idx, 1)               // Remove the message from the index
    master_bus.save(chat)
  }
  t.done()
}

chat = master_bus.fetch('chat')
if (!chat.messages) {                              // Initialize chat history
  chat.messages = []
  master_bus.save(chat)
}

function uid(client) {
  var c = client.fetch('connection'),              // Know who the client is...
      u = client.fetch('current_user')             //    either a logged in user or session id
      k = u.logged_in ? '/' + u.user.key : c.client
                                                   // Reactive functions that call this function will
  return k                                         // be subscribed to changes to current_user and connection
}

function random_string() { return Math.random().toString(36).substring(3) }
```

Before we unpack this code, also replace your .html file with [this code](tutorial/client-with-auth.html), which implements authentication.

## Support multiple users

Earlier, we had a bus for our proxy server and an upstream server. In our multi-user server above, we have a client bus and a master bus:

```javascript
var master_bus = require('statebus').serve({

  client: function (client_bus) {
    client_bus('message/*').to_fetch = function (k) {...}
    (...)
  }
  (...)
})
```

If you use the `client:` option when you create a bus, you enable multiple users and authentication on your server. Each user will have a distinct `client` bus that shadows the state on the `master` bus. Thus, each user can have a different view of the master state:

```
 Client Busses
     o o o
      \|/
       o
   Master Bus
```

The function you pass to the `client:` option when you create a bus defines the custom view each connected user will have of the master state. The general pattern is:

```javascript
var master = require('statebus').serve({  // The master bus is defined here
    client: function (client) {            // Each client bus is passed as an argument here

        // Client-specific state definitions go here

        client('foo').to_fetch = function (key) {         // Each client gets a different view of 'foo'
            if (fetch('/current_user').logged_in)
                return {you_are: 'logged in!!!'}
            else
                return {you_are: 'not logged in... sad.'}
        }
    }
})

// Master state definitions can go below
// master('bar').to_fetch = ...
```

Any handler defined on the `client` bus will shadow the `master` bus.  If you
don't define any custom behavior for a key, all `fetch` and `save` calls will
pass through to `master`, and thus be shared across all clients.  For example:

<!--- when does the pass through happen and when doesn't it? ---->

```javascript
// client 1:
fetch('/foo').you_are        // -> 'logged in!!!'
fetch('/bar').num            // -> undefined
save({key: '/bar', num: 3})  // Saved to master

// client 2:
fetch('/foo').you_are        // -> 'not logged in... sad.'
fetch('/bar').num            // -> 3
```

Additionally, if you enable multi-user support with the `client:` option, each
client will automatically have a custom `current_user`, `connections`, and
`connection` state defined for it. Let's look at those!

### The `current_user` state

Each user will have a different `current_user` state. By default, it looks like this on the client:

```javascript
{
  key: "/current_user",
  logged_in: false,
  user: null,
  salt: 0.6722493639426692
}
```

You can check if the current user is logged in with `fetch('/current_user').logged_in`.  
If they are, you can get the current user's key with `fetch('/current_user').user.key`.

In our server code above, we use the `current_user` state to check if the client has sufficient permissions to delete the message:

```javascript
client_bus('message/*').to_delete = function (k, t) {
  var msg = client_bus.fetch(k)
  if (uid(client_bus) == msg.author) {
    master_bus.delete(k)
    t.done()
  } else
    t.abort(o)
}

function uid(client) {
  var c = client.fetch('connection'),              // Know who the client is...
      u = client.fetch('current_user')             //    either a logged in user or session id
      k = u.logged_in ? u.user.key : 'user/' + c.client
                                                   // Reactive functions that call this function will
  return k                                         // be subscribed to changes to current_user and connection
}
```

You can also manipulate `current_user`, to log in, out, or edit or create your account:

#### Create a new account

Run this:
```javascript
c.create_account = {name: 'Reginald McGee', pass: 'security-R-us', email: 'barf@toilet.guru'}
save(c)
```

#### Log in

... and now log into it:

```javascript
c.login_as = {name: 'Reginald McGee', pass: 'security-R-us'}
save(c)
```

If successful, you'll see something like this:

```javascript
{
  key: "/current_user",
  logged_in: true,
  user: {
    key: "/user/mike",
    name: "mike",
    email: "toomim@gmail.com"
  },
  salt: 0.6722493639426692
}
```

#### Edit your account

```javascript
c.user.name = 'Miiiiike'
c.user.email = 'my_new_email@gmail.com'
c.user.pass = '••••••••••'
save(c.user)
```

#### Log out
```javascript
c.logout = true
save(c)
```


#### The `/user/*` state

Each user has a key starting with `user/` (or `user/`).  You can look up any other
user by fetching their `user/` key.  You'll be able to see their name, but
not private information like email address.

For instance:

```javascript
// As mike:
fetch('/user/mike')
=> {key: "/user/mike", name: "mike", email: "toomim@gmail.com"}

// Log out:
c.logout = true
save(c)

// Now my email is hidden:
fetch('/user/mike')
=> {key: "/user/mike", name: "mike"}
```

### The `/connections` state

<!--- todo: add client/id for each connection ---->


This is the list of all clients connected to the server—whether logged in or
not.  For example, this server has 3 connected clients, and two of them are
the same user (me):

```javascript
{
  key: "connections",
  all: [
    {user: {key: "user/mike", name: "mike", email: "toomim@gmail.com"}},
    {},
    {user: {key: "user/mike", name: "mike", email: "toomim@gmail.com"}}
  ]
}
```

I have two connections because I have two browser tabs open to the server.

You can see your client's current connection with the `/connection` state:

```javascript
{
  key: "/connection",
  user: {key: "/user/mike", name: "mike", email: "toomim@gmail.com"}
}
```

Each client can store additional information in their connection:

```javascript
c = fetch('/connection')
c.extra_info = 'Something!'
save(c)
```

This info is broadcast to everyone who fetched `/connections` on the server:

```javascript
{
  key: "/connections",
  all: [
    {user: {key: "/user/mike", name: "mike"}, extra_info: "Something!"},
    {},
    {user: {key: "/user/mike", name: "mike"}}
  ]
}
```

## ...And now you're a bus driver

Congrats on working through the tutorial!

<!--- todo: add client/id for each connection ---->



















<!---
### Client and master:


## Client and server busses

Each bus defines a separate state space.  







Note that you can make multiple busses
anywhere—client or server—but we have some defaults set up for you on the client.

```javascript
var statebus = require('statebus')  // This is already done for you on client

// Make a couple busses:
var bus = statebus()                // This is already done for you on client
var gus = statebus()
```

You can fetch and save from busses independently:

```javascript
bus.fetch('foo').bar          // ==> undefined
bus.save({key:'foo', bar: 3})
bus.fetch('foo').bar          // ==> 3

gus.fetch('foo').bar          // ==> undefined
```

You can connect busses together with handlers.  For instance:
```javascript
// Connect fetches on 'foo' to gus
bus('foo').to_fetch = function () { return gus.fetch('foo') }

// Connect saves on 'foo' to gus
bus('foo').to_save = function (obj) { gus.save(obj) }
```

If you only have one bus, you can also use the global `fetch()` and `save()`
functions.

```javascript
fetch('foo').fuzz          // ==> undefined
save({key: 'foo', fuzz: 3})
fetch('foo').fuzz          // ==> 3
```

But these globals are disabled on multi-user servers, where they become ambiguous.

(We might remove multiple busses in a future release.  Then you would disambiguate with keys, instead.)

## Support multiple users

Multiple busses let you interact with multiple users on the server, where each
user sees a different state space.  Each user will have a distinct `client`
bus, and which inherit state from a common `master` bus.

```
 Client Busses
     o o o
      \|/
       o
   Master Bus
```

To enable multiple users, use the `client:` option when you create a bus,
passing it a function that will run to customize each client bus as new users
connect to the server:

```javascript
var master = require('statebus/server')({  // The master bus is defined here
    client: function (client) {            // Each client bus is passed as an argument here

        // Client-specific state definitions go here

        // Give each client a different view of the 'foo' state:
        client('foo').to_fetch = function (key) {
            if (fetch('/current_user').logged_in)
                return {you_are: 'logged in!!!'}
            else
                return {you_are: 'not logged in... sad.'}
        }
    }
})

// Master state definitions can go below
// master('bar').to_fetch = ...
```

Any handler defined on the `client` bus will shadow the `master` bus.  If you
don't define any custom behavior for a key, all `fetch` and `save` calls will
pass through to `master`, and thus be shared across all clients.  For example:

```javascript
// client 1:
fetch('/foo').you_are        // -> 'logged in!!!'
fetch('/bar').num            // -> undefined
save({key: '/bar', num: 3})  // Saved to master

// client 2:
fetch('/foo').you_are        // -> 'not logged in... sad.'
fetch('/bar').num            // -> 3
```

Additionally, if you enable multi-user support with the `client:` option, each
client will automatically have a custom `/current_user`, `/connections`, and
`/connection` state defined for it.

### The `current_user` state

Each user will have a different `/current_user` state. By default, it looks like this on the client:

```javascript
{
  key: "/current_user",
  logged_in: false,
  user: null,
  salt: 0.6722493639426692
}
```

You can check if the current user is logged in with `fetch('/current_user').logged_in`.  
If they are, you can get the current user's key with `fetch('/current_user').user.key`.

You can also manipulate `/current_user`, to log in, out, or edit or create your account:

#### Create a new account

Run this:
```javascript
c.create_account = {name: 'Reginald McGee', pass: 'security-R-us', email: 'barf@toilet.guru'}
save(c)


#### Log in

// ... and now log into it:
c.login_as = {name: 'Reginald McGee', pass: 'security-R-us'}
save(c)
```

If successful, you'll see something like this:

```javascript
{
  key: "/current_user",
  logged_in: true,
  user: {
    key: "/user/mike",
    name: "mike",
    email: "toomim@gmail.com"
  },
  salt: 0.6722493639426692
}
```

#### Edit your account

```javascript
c.user.name = 'Miiiiike'
c.user.email = 'my_new_email@gmail.com'
c.user.pass = '••••••••••'
save(c.user)
```

#### Log out
```javascript
c.logout = true
save(c)
```


#### The `/user/*` state

Each user has a key starting with `user/` (or `user/`).  You can look up any other
user by fetching their `/user/` key.  You'll be able to see their name, but
you can only see your own email address.

For instance:

```javascript
// As mike:
fetch('/user/mike')
=> {key: "/user/mike", name: "mike", email: "toomim@gmail.com"}

// Log out:
c.logout = true
save(c)

// Now my email is hidden:
fetch('/user/mike')
=> {key: "/user/mike", name: "mike"}
```






---->







<!--- # Statebus programming model ---->

# API Reference

The API works on both client and server.

## Valid State
Each state object:
- Is JSON
- Is an object
- Has a field `key:`, which defines a unique URL
- Can contain other state objects

For instance, these state objects are **valid**:

| Example state |
| :---- |
| `{key: '/blog', posts: [], owner: '/user/4'}` |
| `{key: 'empty thing'}` |
| `{key: 'parent/4', child: {key: '/kiddo/3'}}` |
| `{key: 'some variable value', var: 3}` |

But these aren't:

| Invalid state: | Because |
| :---- | :---- |
| `3` | Individual variables *have* to be wrapped in objects. |
| `[3, 5, {23: 99}]` | Arrays must be wrapped in objects too |
| `{var: 3}` |  Objects need a `key:` |
| `{key: 'foo', var: function () {}}` |  Functions aren't in JSON. |

## URLs
The URL for a `key` can be an arbitrary string.

## Statebus Protocol Methods
Each bus implements the four methods of the statebus protocol: `fetch`, `save`, `forget`, and `delete`.

#### `bus.fetch(key,  callback=null)`

  - If given `callback`, calls `callback(obj)` with the current state of `key`, and subscribes it to future changes
  - Else if called from within a reactive function, returns the current state of `key`, and subscribes the function to future changes
  - Otherwise, returns the current state of `key`


#### `bus.save(obj,   deets={})`

  - Changes the state of `obj.key` to `obj`
  - You don't need to specify `deets` (details) unless you implement custom versioning.  Deets take the form `{version: <v>, parent: <p>}`, where each `<v>` and `<p>` are a string.
  - `Todo:` Does this recursively save all nested state?

#### `bus.forget(key, callback=null)`

  - If `callback` is specified, cancels the subscription of `callback` to state changes at `key`.
  - Else, unsubscribes the currently executing reactive function from `key`

#### `bus.delete(key)`

  - (Not yet fully implemented.)
  - Removes the state at `key` from the state space

## Reactive functions

### `f = bus.reactive(func)`
- Returns a reactive version of `func`, with the API:
  - `f(args...)` or `object.f(args...)` runs the reactive function, with `this=object` and `arguments=args`.  (This behavior is likely to change in the future.)
  - `f.react()` triggers a reaction using the most recently specified `this` and `args`
  - `f.forget()` stops reacting
  - `f.loading()` reports whether the function depends on any loading keys


### `bus(func)`
- This is the shorthand equivalent of `bus.reactive(func); func()`

### `bus.loading(key=null)`
  - If given a `key`, returns true if `bus` has pending fetches waiting for data to key from other busses.
  - Without a `key`, returns true if the currently-executing reactive function has subscribed to any keys with such pending fetches.


### Fetch and Save are Reactive functions

The statebus `fetch()` and `save()` methods give you the illusion that all
state is always available if you use them from within a *rerunnable* function.
This way, if a piece of state isn't available, statebus will just wait until
it becomes available, and re-run the function then. And every time the state
changes, statebus will re-run the function again. This way you can write
functions that produce state that is always up to date, without callbacks,
promises, async/yield, threads, or fibers.

Statebus automatically makes functions rerunnable that are passed to it:
  - HTML renderers: `dom.BODY = <rerunnable>`
  - Handlers: `bus(key).to_*  = <rerunnable>`
  - Fetch callbacks: `fetch(key, <rerunnable>)`

You can also make your own rerunnable functions with
`bus.reactive(<rerunnable>)` and `bus(<rerunnable>)` to make a standalone
reactive process.

### Rerunning and `fetch()`

Each time `fetch(key)` is called during the execution of a rerunnable
function, the function will subscribe to the `key` and automatically re-run
when it changes.  For instance, we can re-render the dom `BODY` element each
time someone's name changes:

```coffeescript
dom.BODY = ->
   DIV "Hello, " + fetch('mother').name
```

Or we can write a standalone function that rings a bell when an angel
gets her wings:

```coffeescript
bus(->
  if fetch('angel').wings
     bell_sound.play()
)
```

## Configuring a bus with handlers

You configure a bus by specifying functions to fetch, save, forget, and delete
state at keys.  Each function will automatically be made reactive, so you can
fetch and save within them.  However, the save, forget, and delete handlers
will only be reactive until they successfully complete once without being
loading().

### `bus(key_pattern).to_fetch = function (key) {...}`

  - Called the first time a `key` matching `key_pattern` is fetched on `bus`.
  - The `function` is made reactive until `key` is forgotten by all subscribers
    on `bus`.

### `bus(key_pattern).to_save  = function (obj) {...}`

  - Called each time a state object matching `key_pattern` is saved on `bus`.
  - If a save handler is defined for a key, the state object won't
    actually be fired to the bus unless `save.fire(obj)` is called.
    - If *no* save handler is defined for a key, the object will be fired
      immediately.
    - The save handler is free to alter the object (*e.g.* validating and
      cleaning fields) before firing the save.
    - If the save handler wants to reject the change entirely, it should run
      `save.abort(obj)`, which will notify the calling bus that its change has
      been rejected so that it can undo its state change.
  - The `function` is made reactive until it completes once without being `loading()`.



### `bus(key_pattern).to_forget = function (key) {...}`
  - Called when the last subscription to `key` has been forgotten on `bus`, to
    notify any upstream busses providing `key` to cancel this bus's
    subscription to the `key`.
  - The `function` is made reactive until it completes once without being `loading()`.

### `bus(key_pattern).to_delete = function (key) {...}`
  - Called each time `key` is deleted on `bus`.
  - The `function` is made reactive until it completes once without being `loading()`.

## Other little guys

### `bus.save.fire(obj)`
- Immediately publishes `obj` on the `bus`, re-rendering any subscribed functions.
- If no `.to_save` handler is defined for a key, any `save(obj)` operation
  will automatically invoke `save.fire(obj)`.  But if a `.to_save` handler
  *is* defined, the programmer is responsible for ensuring that
  `save.fire(obj)` is called.

### `bus.save.abort(obj)`
- Call this if a `to_save` handler denies a requested change to a state `obj`.
  It will notify the sending bus.

### `bus.dirty(key)`
  - Re-runs the `bus(key).to_fetch` function.
  - Use this if your `to_fetch` function derives from a variable that's changed outside of statebus, and you need to explicitly tell it to re-run.


## Raw Access

### `bus.cache[key]`
  - Lets you bypass `fetch` to access the cache directly
  - You shouldn't need this, but it can be nice for debugging.

## Eliminate callback code with `uncallback()`

Now you can transform APIs that use callbacks:

```javascript
fs.readFile('hello.txt', (err, first_file) => {
    if (err)
        console.error('Error', err)
    else
        fs.readFile('world.txt', (err, second_file) => {
            if (err)
                console.error('Error', err)
            else
                fs.writeFile('hello world.txt', first_file + second_file)
        })
})

```

...into reactions:

```javascript
bus(() => {
    var first_file = readFile('hello.txt')
    var second_file = readFile('world.txt')
    fs.writeFile('hello world.txt', first_file + second_file)
})
```
Isn't that much nicer?

To transform callbacky functions into reactive functions, use the `bus.uncallback()` command:
```javascript
var readFile = bus.uncallback(fs.readFile)  // Overly simplified
```

The catch is that callbacky function's inputs and outputs must be serializable
JSON.  Since `fs.readFile()` returns a `Buffer`, we should serialize the result with
`.toString()`:

```javascript
// Wrap fs.readFile() in a function that returns a string:
readFile = bus.uncallback(function (path, cb) {
    fs.readFile(path, (err, result) => cb(err, result.toString()))
})
```

You can uncallback any function where:
  - The inputs and outputs are serializable in JSON
  - Except the last argument, which is a callback that takes args `(error, result)`


<!---
## Proxy interface
This wraps `fetch()` and `save()`. Makes all state look like a big global variable.

```javascript
sb = bus.sb      // sb might become the new 'bus'

sb.foo           // fetch("foo")
sb["/foo"]       // fetch from server
sb["/foo"].posts[5].title   // access an array

sb.bar.fi = 3    // save({key: "bar", fi: 3})
sb.foo = 3       // save({key: "foo", _: 3})
sb.foo = sb.bar  // save({key: "foo", _: fetch("bar")})

sb.foo()         // access the underlying raw JSON: {key: "foo", _: {key: "bar", fi: 3}}
sb.foo().key     // => "foo"
```

Behind the scenes, all data is stored in a JSON encoding.  You can get the
underlying JSON with `sb.blah()`.

#### JSON encoding

The encoding hides keys, dereferences pointers, and unwraps singleton objects
when viewed through the `sb` proxy interface.

```javascript
  // Basics
  {_: 3}             -> 3                           // Underscore is unwrapped
  {key: 3}           -> {}                          // Keys are hidden
  {bar_key: '/bar'}  -> {bar: {..this is bar..}}    // *_key is a pointer to other state
  {key_: 3}          -> {key: 3}                    // Trailing underscore escapes
  {__: 3}            -> {_: 3}                      // Trailing underscore escapes

  // Now let's try some combinations
  {_key: '/bar'}     -> {..this is bar..}           // _key means "unwrap this pointer"

  // On an array, appending "_key" means each element is a pointer
  {bars_key: ['/bar/1', '/bar/2']}               -> {bars: [{..bar1..}, {..bar2..}]}

  // You can get the same result by wrapping each element with {_key: ..}
  {bars: [{_key: '/bar/1'}, {_key: '/bar/2'}]}   -> {bars: [{..bar1..}, {..bar2..}]}

  // In either case, you can escape an exceptional element in an array by wrapping it
  {bars_key: ['/bar/1', {_: 'hi!'}   ]}          -> {bars: [{..bar1..}, 'hi!']}
  {bars:     [{_key: '/bar/1'}, 'hi!']}          -> {bars: [{..bar1..}, 'hi!']}
```

---->

## Intermediate states, crash recovery, and loading()

If a state `/foo` hasn't loaded yet, `fetch("/foo")` will return an empty
object `{key: "/foo"}`.  In these intermediate states, your code might return
an errant `undefined`, or just crash:

```coffeescript
dom.THING1 = -> DIV fetch('/foo').bar       # <div>undefined</div>
dom.THING2 = -> DIV fetch('/foo').bar.baz   # Crash: "Cannot read property 'baz' of undefined"
```

 You can check that any particular object is loaded by looking
for the presence of the expected fields on it, or check whether an entire
function has loaded with the `loading()` function:

```coffeescript
dom.BODY = ->
   mom = fetch('/mom')
   dad = fetch('/dad')
   if loading()
     return DIV 'Loading...'

   DIV "Hello, #{mom.name} and #{dad.name}!'
```


# Websocket Network Protocol

You can connect to a statebus server by just opening a websocket to `ws://<domain>/_connect_to_statebus_` (e.g. `new WebSocket('wss://stateb.us:3006/_connect_to_statebus_')`)
Then you can send these messages (e.g. `sock.send(JSON.stringify(...))`:

```javascript
{fetch: <key>}
{save: <obj>}
{forget: <key>}  // To stop receiving objects that you've fetched
{delete: <key>}
```

If you fetch, the server will send you back objects with `{save: <obj>}`.

There is also a backwards-compatible HTTP version of the network protocol.

# What's missing
- Widgets re-render when their props change, or when statebus state changes,
  but not when their children change.  We haven't figured out a good way to
  determine when children change.  Luckily, we have rarely encountered
  children changing in practice without state or props changing.
