# Statebus
Statebus is a new web protocol where every piece of state has a URL. It provides a unified API for accessing state on clients and servers, and automatically handles synchronization. In contrast to how HTTP provides State Transfer, Statebus provides State *Synchronization*.

This repository is a Javascript implementation of the Statebus protocol. You can use it right now to build web applications. It builds from [Reactjs](http://reactjs.org) to provide reactive re-rendering, but extends the reactivity through the whole web stack.

This implementation is great for prototyping. You can see some prototypes and applications [here](https://invisible.college). We welcome contributions, and are excited to help you build your own Statebus applications.

# Getting started
Today we are going to make a basic chat widget. It's a public chat that anyone can post to. We hope you'll post a message on it - it's a guestbook for anyone who visits this tutorial!

We've broken the tutorial into two parts: Making a client and Making a server. Most of the logic is in the client, because Statebus [collapses time and space](https://github.com/invisible-college/statebus/blob/v5/readme.md#fetch-and-save-are-reactive-functions). The server handles basic privacy and data filtering features.

## Making a client
To write client code, you don't need to download anything. Instead, you'll just edit a single .html file locally on your computer. However, you'll be writing in [Coffeescript](http://coffeescript.org) and creating [React](http://reactjs.org) web components, so make sure you're familiar with both of these tools. Aside from Coffeescript and React, there are really only two methods that you will need to learn: `fetch` and `save`. To get a sense of how they work, let's make something!

Here's the chat you'll be making. Copy and paste this into your .html file.

```coffeescript
<script type="statebus">                          #Scripts with this tag are interpreted by statebus

dom.BODY = ->                                     #Define the react component that renders the dom body
  messages = fetch('/chat').messages or []        #Synchronize with the chat messages using statebus  
  DIV {},                                         #Define a div that displays the messages       
    for message in messages                       #For each message render its text  
      DIV(message.content)
    NEW_MESSAGE()                                 #A component for writing new messsages

                                                  #Defining the new message component here
dom.NEW_MESSAGE = ->
  new_message = fetch('new_message')              #Access local state for the new message
  DIV {},
    INPUT
      type: 'text'
      value: new_message.text                     #Display the new message in the input 
      onChange: (e) =>                            #When someone types, update the text in this input box
        new_message.text = e.target.value         #Save this local state and re-render the NEW_MESSAGE component
        save(new_message)

    BUTTON
      onClick: (e) =>                             #When someone clicks on this button, publish their message
        chat = fetch('/chat')                     #Get the chat messages from statebus
        chat.messages or= []                      #Add a new message to the chat and save it using statebus
        message = {
          key: "/message/#{new_key_id()}"         #Give the message its own state URL. Will be useful for us later.
          content: new_message.text
        }
        chat.messages.push( message )             #Add the new message to the chat history
        save(message)                             #Publish the new message and cause the body to re-render
        new_message.text = ''
        save(new_message)
      'Send'

new_key_id = -> Math.random().toString(36).substring(3)

</script><script src="https://stateb.us/client5.js" server="http://localhost:3005"></script> #This is the server we'll synchronize our state with.
```	

Now you have a working statebus app, in a single html file! 
Double-click to open it in your web browser with a `file:///` url.
You should be able to see everyone's messages.

### Reactive Functions
This code is built using reactive functions. 
Statebus provides a distributed key/value store for
managing your state, and will notify those functions to re-run whenever
it detects a change.

Here's one of those reactive functions:
```coffeescript
dom.BODY = -> #Define the react component that renders the dom body
``` 
Anything starting with _dom._ that has UPPERCASE characters will define
a new react component. The body defines the react component's
render function. This syntax strips away some cruft in programming
with react.

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
> console.log(fetch('/chat'))
> {
    key: '/chat',
    messages: [{content: 'hello world!'}]
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
      DIV(message.content)
    NEW_MESSAGE() 
```
This block of code that renders (1) the list of chat messages
and (2) a custom component for typing new messages. These both are
contained in a parent DIV. Any time the list of messages changes,
these components will re-render.

You might be wondering about the syntax `DIV {},`. The `{},` is related
to passing arguments to your components, like styling your components with css rules. But we're not passing any arguments now for simplicity, so we're just passing in an empty object.
<!---If you're curious about styles, jump to our [Defining styles](http://) section.---->

The custom NEW_MESSAGE component is defined in the next line.
```coffeescript
dom.NEW_MESSAGE = ->
```

Just like we defined the dom.BODY, this component defines an input box and
a send button. One difference is that the NEW_MESSAGE component is
concerned with changes in state that occur _locally_ when the user types in
a box. So this is a good time to look at where state is stored.

### Where is state stored?
State can be stored locally in the browser or remotely on any server that implements the
statebus protocol. Just like HTTP documents, the location of state is determined by its URL prefix.

Here's how you access 'chat' state from a server `stateb.us`: 

```coffeescript
fetch('state://stateb.us:3005/chat')
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

That brings us to the next few lines, which fetch some local state at the URL 'new_message'
and updates an input box whenever a user types and changes that state:

```coffeescript
  new_message = fetch('new_message')
  DIV {},
    INPUT
      type: 'text'
      value: new_message.text 
      onChange: (e) =>                            
        new_message.text = e.target.value
        save(new_message)
```

The final chunk of code works with both local and remote state to 
implement a send button. When someone clicks the button, a new
message is added to the chat feed, and the textbox is cleared away.

```coffeescript
    BUTTON
      onClick: (e) =>                     
        chat = fetch('/chat')
        chat.messages or= []     
        message = {content: new_message.text}
        chat.messages.push( message )
        save(chat)
        new_message.text = ''
        save(new_message)
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
var bus = require('statebus/server')({port: 3005})
```

### Start your server

```shell
node server.js
```

Your server should now be running at localhost:3005. If you want the server to restart automatically when you edit your files, use `nodemon` or `supervisor` instead of `node`.


### Update your client to use your server

In your sample [client code](https://github.com/invisible-college/statebus#making-a-client), you included the statebus library with:

```html
<script src="https://stateb.us/client5.js"></script>
``` 

We're going to use our own server, not the default https://stateb.us:3005 server. Update your html file with:

```html
<script src="https://stateb.us/client5.js" server="http://localhost:3005"></script>
``` 

Open your .html file in your browser. It now has an empty chat history. This is because every Statebus server has its own data store, and when you set the `server` attribute of the statebus client script tag, you specify a default server for the data. Thus, `fetch('/chat')` state is now accessing the data stored at your new server.

<!--- To continue fetching and saving chat data to the stateb.us server, use absolute state URLs by fetching from `state://stateb.us:3005/chat` instead of `/chat`---->

For now, let's add access control to our chat application. Later on, we'll reintegrate the chat history data hosted at stateb.us!

### A server with authentication and access control

It is time to add authentication and access control to our server. Copy and paste the code below into your server.js file, and then we'll unpack it. 

Don't be intimidated!

```javascript
// A chat server
// We want these controls on the server:
//  • Users can save a "draft" post before it is shown publicly
//  • Users can see their own draft posts
//  • Some users are admins
//  • Admins can delete any post; users can delete their own
//  • Ensure the /chat index stays in sync with new posts added

var master = require('statebus/server')({           // The master bus
  port: 3005,

  client: function (client) {                       // The client bus defines an API for how each connected 
                                                    // user can fetch() and save() master state.

    var admins = {'user/powertripper': true,        // Only some users are admins
                  'user/2': true}
    
    client('message/*').to_fetch = function (k) {   // Enforce access control on draft messages

      var message = master.fetch(k),                // Get the message from the master bus
          user = uid(client)                        // Know who the client is. uid is defined below.

      if (!message.draft || message.author == user)
        return message                              // a-ok! Pass through the master state for this message
      else
        return {error: 'not permitted'}
    }

    client('message/*').to_save = function (o) {    // Only authors can update a post
      o.key = o.key || 'message/' + new_key_id()    // Ensure that a message has a URL
      var obj = master.fetch(o.key)                 // Get the version of this state stored in master, if any

      author_change = obj.author && obj.author != o.author
      if (!author_change)
        o.author = o.author || uid(client)          // Initialize author for new messages

      if (author_change || o.author != uid(client))
        client.save.abort(o)                        // Thwart devious clients!
      else {
        master.save(o)                              // Save it to master
      }
    }

    client('chat').to_fetch = function (k) {        // Each client has a different view of the chat history
      var user = uid(client),
          chat = master.clone(master.fetch('chat')) // We start with a copy of the full chat history...
                                                    // and filter out messages this user isn't permitted to see
      permitted = function(m) {return !client.fetch(m).error}
      chat.messages = chat.messages.filter(permitted)
      return chat
    }

    client('chat').to_save = function (o) {         // Clients can't change the chat history directly
      client.save.abort(o)                          // Abort this save attempt!
    }

    client('message/*').to_delete = function (k) {  // Admins can delete any message
      var u = client.fetch('current_user')
      if (!u.logged_in || !admins[u.user.key])     // Ensure current user is an admin.
        client.save.abort(o)
      else 
        master.delete(k)
    }

    // Anything not matched to the handlers above will automatically pass
    // through to the master bus.

  }

})

// Now we can define how state on the master bus behaves.

master('message/*').to_save = function (o) {       // When a message is saved, put it in the chat history
  var chat = master.fetch('chat'),                 
      idx = chat.messages.findIndex(function (m) {return m.key === o.key})

  if (idx == -1) {                                 // If this message is not in the chat history...   
    chat.messages.push(o)                          // add it
    master.save(chat)                              // and save our change to the history
  }
  master.save.fire(o)                              // Now complete the save of the message
}

master('message/*').to_delete = function (k) {     // Cleanup when a message is deleted
  var chat = master.fetch('chat'), 
      idx = chat.messages.findIndex(function(m){return m.key == k})

  if (idx > -1) {                                  // We found the message to delete
    m = chat.messages.splice(idx, 1)               // Remove the message from the index
    master.save(chat)
  }
}

chat = master.fetch('chat')                        
if (!chat.messages) {                              // Initialize chat history
  chat.messages = []
  master.save(chat)
}

function uid(client) {
  var c = client.fetch('connection'),              // Know who the client is...
      u = c.user ? c.user.key : 'user/' + c.client //    either a logged in user or session id
                                                   // Note: Reactive functions that call this function will 
  return u                                         // be subscribed to changes to any state that this 
}                                                  // function fetches. 

function new_key_id() { return Math.random().toString(36).substring(3) }
```

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


# What's missing

- Good SQL database adapters
- Finalized API names (the v5 release might break your code)
- Connect to multiple servers simultaneously


