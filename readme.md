# Statebus

*State* is the changing data your application uses and modifies. Some state is only relevant for a given client, like the current url or whether a button is depressed. And some state should be persisted to the server and broadcast to other clients, like an authenticated user's pseudonym or a new post in a forum. 

When we program dynamic web applications, we write an extraordinary amount of code just trying to keep state synchronized between different UI components, between client and server, and between multiple connected clients. 

<Reactjs made an important breakthrough by enabling web components to be programmed declaratively, without having to write code that specifically updates the HTML whenever a given piece of state changes.>

Statebus <takes state synchronization further. It> gives every piece of state its own URL, provides a simple, unified API for accessing state on clients and servers, and automatically handles synchronization. Whereas HTTP provides State Transfer, Statebus provides State Synchronization: 

| HTTP | Statebus | 
| ----: | :---- |
| `GET`       — Retrieve state from server | `Fetch`    — Retrieve and subscribe to future changes | 
| `PUT`       — Change state on server  | `Save`     — Change state and update all nodes |
| `POST`      — Change state on server     | `Forget`  — Unsubscribe from fetch |
| `PATCH`     — Change state on server   | `Delete`  — Remove state from all nodes |
| `DELETE`    — Remove state from server   |  |

This repository is a Javascript implementation of the Statebus protocol. It is backwards compatible with HTTP. You can use it right now to build web applications. It builds on Reactjs to provide reactive re-rendering, but extends the reactivity through the whole web stack. Servers and clients are automatically synchronized. 

This implementation is great for prototyping. It can be used in production (see e.g. [Consider.it](https://consider.it) or [Cheeseburger Therapy](https://cheeseburgertherapy.com)), but there are rough edges. We welcome contributions, and are excited to help you build your own Statebus applications.

# Getting started

## Make a client

You don't need a server yet.  You don't need to download anything.
Just make a .html file on your filesystem containing this:

```coffeescript
<script type="statebus">                                           # Initial line

dom.BODY = ->                                                      # Your code here
  DIV 'Hello, World!'    # Return a div

#</script><script src="https://stateb.us/client5.js"></script>     # Loads statebus v5
```	

Now you have a working statebus app, in a single html file!
Double-click to open it in your web browser with a `file:///` url.

Want to turn this into a simple blog?  Replace the body with this:

```coffeescript
dom.BODY = ->
  blog = fetch('/your/blog')
  DIV {},
    for post in blog.posts
      DIV {},
        H1 post.title
        DIV post.body
```

Your blog will be empty initially until you add some content though.

Open your javascript console and run:

```javascript
save({
  key: '/your/blog',
  posts: [{title: 'hello', body: 'world'}]
})
```

Boom! Your post shows up.

Now try reloading the page. It's still there! You saved your blog on the
*server* hosted at `state://stateb.us:3005`.

Try opening a new browser window. If you change the blog in one, it will
immediately update the other. Statebus keeps the state between both browsers
syncronized.

## What's going on here?

Statebus provides a distributed key/value store. Each state object:

- Is JSON
- Is an object
- Has a field `key:`, which defines a unique URL
- Can contain other state objects

`fetch(key)` returns an object in Statebus' distributed key/value store, and also subscribes the calling function to changes to that state. So when a reactive function like dom.BODY runs `fetch('/your/blog')`, it returns:
{
  key: '/your/blog',
  posts: [{title: 'hello', body: 'world'}]
}

Importantly, Statebus notes that `dom.BODY` depends on the state at `/your/blog` and will re-execute it if the state changes. These web component functions are *reactive* to changes in state.

Go ahead and change the state. In the javascript console, run:
```javascript
index = fetch('state://stateb.us:3005/your/blog')
index.posts[0].body = 'universe'
save(index)
```

`save(state)` saves changes and propagates them to any function that depends on that state.


### Where is state stored?

[distinguish local / server state]
You can do a lot writing Statebus web applications without a server! It is particularly useful for prototyping new interactive UIs. Every time you want a new variation of the UI, just copy the single file and modify it. It will have access to the same state.

[merge below]
In the above code, you accessed `state://stateb.us:3005`. This is long form. You can instead just do e.g. `fetch('/your/blog')`. This will access state at the default server (which is stateb.us:3005 by default). You only need the full state URL if you are 


## Make a server

You can host your own state(bus) server, with permissions, authentication, and anything else you want to do server-side.

```shell
npm install statebus@5
```

The `@5` tells npm to install Statebus v5.

Create a server with:
```javascript 
var bus = require('statebus/server')({
    // You can pass these options to your new server:
    port: 3005,                  // 3005 is the default port for Statebus v5 to listen on
    // backdoor: 4004,           // For testing. Direct access to master at this port. Defaults to null.
    file_store: true,            // Persists state across server restarts.  Defaults to true.
    client: function (client) {} // See "multiple users" below.  Defaults to null.
})
// ...put server methods for handling requests, enforcing access control, etc. 
// Note that the API for starting a server is in flux. 
```

If you specify a `port`, `backdoor`, or `client`, then this bus will start a
websocket server and serve its state over the internet.  Otherwise, it'll just
make a new bus object, as described in
[Multiple Busses](#make-multiple-busses), disconnected from the network.

You can then run your server with `node` or `nodemon` or `supervisor`.

To set your server as the default in any client code, set the `server` attribute of the statebus client script element. For example, if you're doing local development, you might have: 

```coffeescript
<script type="statebus">

dom.BODY = ->
  DIV null,
    'Hello world!'

</script><script src="https://stateb.us/client5.js"
                 server="http://localhost:3005"></script>
```



# Writing code

In statebus we:

### ...prefer to write code in coffeescript

[Coffeescript](http://coffeescript.org) lets you execute javascript functions without curly braces and using indentation. You also don't need return statements.

In javascript:

```javascript
function foo(a, b,c ){
  return a + b + c;
}

function bar(){
  alert('hello world');
}

foo(1,2,3);
bar();
```

In coffeescript/statebus:

```coffeescript
foo = (a, b, c) ->
  a + b + c

bar = ->
  alert('hello world')

foo 1 2 3

bar
```

Note that you can use Javascript instead of Coffeescript, but our examples will all be in Coffeescript.

### ...build a virtual dom using react

In [react.js](https://facebook.github.io/react/), you create a virtual dom that automatically updates based on state changes. To do this, you essentially define a render function that returns a dom element based on the current state. Statebus removes the cruft so you only need to define the render method. Like this example below, that creates a virtual comment box element and renders it with the 'render' method.

In javascript:

```javascript / JSX
var CommentBox = React.createClass({ 
  render: function() { 
    return ( 
      <div style="font-size:" + this.props.font_size + "px">Hello, world! I am a CARDBOARDBOX</div> ); } });
```

In statebus:

```coffeescript
dom.CARDBOARDBOX = ->
  DIV
    style: 
      fontSize: @props.font_size
    "Hello, world! I am a CARDBOARDBOX"
```

Virtual dom elements in statebus are written in ALLCAPS. You can re-use them inside other elements:

```coffeescript
dom.MAIN =->
  DIV
    className: 'main_area'
    'hello'
    CARDBOARDBOX
      font_size: 50
```

### You manage state using `fetch` and `save` functions
In react, each component has its own "state" and "props" objects. When these change (by calling `setState()` or `setProps()`), the virtual dom automatically re-renders. But this approach doesn't provide any support for synchronizing with a server, and it also makes it difficult for two components to communicate.

Instead, statebus simplifies the idea by providing distributed access to state using a url-like syntax. Specifically you can use `fetch` and `save` commands like this:

```coffeescript
dom.EXAMPLE = ->
  state = fetch('/morgan/example')   # fetch this key from the server
                                     # because of the leading '/'
  if !state.width?
    state.width = 100
    state.height = 100
  DIV
    style:
      height: state.height
      width: state.width
      backgroundColor: 'red'

    onClick: (e) ->
      state.width += 100
      state.height += 100
      save(state)
```

This example resizes a square when you click on it. 

`fetch` returns an object located at the key `/morgan/example`, and
subscribes to that object. What that means is that any time the state
at `/morgan/example` changes, example will re-execute. `save(state)`
will save changes and propagate them to any function that is
subscribed.

**Important:** the leading `/` in `/morgan/example` means that the state
will synchronize with the server. A key `morgan/example` would only be
available to the client.


#### ...and a dumb quirk

Dom elements are functions that take two arguments: props and children. For example, `DIV( { id: 'example' }, [ child1, child2 ])`. In coffeescript you can write this as

```coffeescript
DIV
  id: 'example'
  child1
  child2
```

But if you don't have any props to pass, you need to pass in 'null' like this:

```coffeescript
DIV null,
  child1
  child2
```






## Program state behavior

You can *control* reads and writes to state to:
- Give distinct users distinct permissions and views of state **⬅︎ You can write server code!**
- Connect statebusses together
- Make proxies or caches that define state in terms of other state
- Create handy state abstractions that live-update on any schedule you can program

How does it work? Recall the four statebus methods:
- fetch(key)
- save(obj)
- forget(key)
- delete(key)

You can define *handlers* that control how each method behaves on a set of keys:
- bus(key_space).to_fetch = function (key) { ... }
- bus(key_space).to_save = function (obj) { ... }
- bus(key_space).to_forget = function (key) { ... }
- bus(key_space).to_delete = function (key) { ... }

These handlers can be written on clients as well -- on any bus. 

Let's start with the handlers for `fetch` and `save`.

### Define state programmatically with `to_fetch`

Let's imagine I want to define an aggregate blog state, that pulls in state
from multiple other blogs.  To define new state, we define how to *fetch* it.
When someone fetches this state, it'll run our function, which returns the
aggregated blog:

```javascript
bus('aggregate_blog').to_fetch = function (key) {
   var blog1 = fetch('blog1')
   var blog2 = fetch('blog2')
   return {posts: blog1.posts.concat(blog2.posts)}
}
```

Handlers are automatically reactive, so whenever blog1 or blog2 change, our
`to_fetch` handler will re-run and produce a new aggregate blog.  The
reactions will start when a client fetches it, and stop when all clients
have forgotten it, so that we don't carry on with unnecessary reactions.

You can also define a `.to_fetch` function for a *space* of keys, by appending
`*` to the key:

```javascript
bus('one_plus/*').to_fetch = function (key) {
   // The *individual* key being fetched is passed to this function as "key"
   var num = Number(key.split('/')[1])
   return {result: 1 + num}
}

fetch('one_plus/2').result   // ==>: 3
```

The general form of a `to_fetch` handler is:

```javascript
bus('the_answer').to_fetch = function (key) {
   // Do some stuff...
   // ...and then fire the new state across the bus,
   // using one of these equivalent statements:
   return {key: 'the_answer', n: 42}
   return {n: 42}                             // Statebus can infer the key in return statements
   bus.save.fire({key: 'the_answer', n: 42})  // Use this from within callbacks
}
```

If your handler needs to return state from within a callback, use the
`save.fire()` form.

Each .to_fetch function *must* eventually return new state, either with a
return statement or bus.save.fire.  Until the .to_fetch function returns,
anything that fetches it will be *loading*.

### Control saves with a `to_save` handler

A `to_save` handler looks like this:

```javascript
bus("key_pattern").to_save = function (obj) {

   // Here you can validate obj, tweak it, update a backing store...

   // And eventually, either call:
   bus.save.abort(obj)   // To deny this save request!

   // ... or:
   bus.save.fire(obj)    // To broadcast the result across the bus!

   // ... or:
   bus.dirty(obj.key)    // To re-run a to_fetch handler, if you've defined one.
}
```

Your `to_save` handler will receive the requested new state `obj` as a
parameter, and must either call `save.abort(obj)` to ignore the request, or
`save.fire(obj)` (after making any desired changes to `obj`) to broadcast it.
It doesn't matter if the `to_save` handler *itself* fires the change, but the
save will remain pending until *something* does.

This lets you control:
- Which changes to state are allowed
- Validation and cleaning
- Where state is stored (*e.g.* in a database)
- Updating dependent state
- When to broadcast updates

To_save handlers are also reactive, but stop reacting as soon as they run once
to completion without anything fetched loading.  This lets you fetch state
from other places (*e.g.* over the network) and be sure that your handler will
run once the state has loaded.


## Make multiple busses

Each bus defines a separate state space.  You can make multiple busses
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

### The `/connections` state

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

## Little things


### Back door entry

*Travis asks: can we remove this section?*

The backdoor is cool. Enable it in options on the server:

```javascript
var bus = require('statebus/server')({backdoor: 4004})
```

And add a backdoor attribute to the script tag in your `client.html` file:

```html
</script><script src="https://stateb.us/client4.js"
                 server="http://localhost:3004"
                 backdoor="http://localhost:4004"></script>
```

And you will have a new variable `master` in the javascript console connected
directly to the master bus on the server!

```javascript
master.fetch('/raw_master_stuff')
```

### Safety measures in Reactive Funk

Although you may fetch many things in a reactive funk, and some of those
fetched results may be delayed by e.g. the network, reactive funks try to
present the illusion of all state being loaded all the time, by re-running
until all state has loaded.

However, we want to make sure your code doesn't cause unintended side-effect
damage in the interim state before all state has loaded.  To guard against
this, statebus keeps a backup of the state cache, and automatically undoes any
`save()` calls from the backup that occur while the function is still
`loading()`.  Example:

```javascript
bus('foo').to_save = function (obj) {
   obj.bar = fetch('/bar').name      // Fetch something over the network
   save.fire(obj)                    // This will only happen once /bar has loaded!
}
```

### Debugging output
Enable extra statebus logging info with `bus.honk = true`. If you're on the
server, you need to enable it separately for the master and every client bus
you are concerned with.


# Examples

## Server example

* Travis asks: can we eliminate this example and just use the blog example? *

```shell
npm install statebus@5
```

Make a `demo.js`:
```javascript
bus = require('statebus/server')({port: 3004})

// Define state that derives from other statebus state
bus('/sum').to_fetch = function (key) {
    var a = fetch('/a'), b = fetch('/b')
    return {sum: a.val + b.val}  // Shorthand for => save.fire({key: '/sum', sum: a.val + b.val})
}

// Define state where we set up and tear down an external subscription
var timer
bus('/time').to_fetch = function (key) {       // Called when first client fetches /time
    timer = setInterval(function () {
        bus.save.fire({key: key, time: new Date().getTime()})
    }, 1000)
}
bus('/time').to_forget = function (key) {      // Called when last client forgets /time
    clearInterval(timer)
}

// Control changes to state
bus('/sometimes_saveable').to_save = function (obj) {
    if (Math.random() < .5) {
        obj.var = "I'm forcing this var!"
        delete obj.bad_thing
        save.fire(obj)    // Go live!
    } else
        save.abort(obj)
}
```

Run it:
```shell
node demo
```

## Server example with multiple users

Here's a blog with access control.
  - Only approved "editors" can make posts.
  - Posts aren't visibled until published.

```javascript
// Let's implement a blog!
// We want these controls on the server:
//    • Some users are editors
//    • Posts can be marked "unpublished"
//    • Only editors can edit posts
//    • Only editors can see unpublished posts
//    • Ensure the /blog index stays in sync with new posts added

var master = require('statebus/server')({              // Define the master bus

    port: 3004,         // Each client normally connects on port 3004
    // backdoor: 4004,  // For testing, you can enable direct access to the master bus on 4004

    client: function (client) {                        // Define each client bus

        // Each client gets its own "client" bus, which defines how to
        // fetch() and save() that client's state.

        // Only some users will be editors
        var editors = {'/user/mike': true,
                       '/user/2': true}

        // Let's define the blog.
        // First, define how to fetch it for a client:
        client('/blog').to_fetch = function (k) {

            // We start from the state of the master blog
            var blog = master.fetch('/blog')

            // We want to hide all unpublished posts if the current user isn't an editor
            var u = client.fetch('/current_user')
            if (!u.logged_in || !editors[u.user.key]) {
                // Make a new version of the blog, with unpublished posts filtered out:
                blog = clone(blog)   // Clone the blog so we don't mutate the master copy
                blog.posts = (blog.posts || []).filter(function (p) { return !client.fetch(p).unpublished })
                return blog
            }

            // But editors can see all posts, so show them the unaltered master blog:
            else return blog
        }


        // Clients can't change the list of blog posts directly.  Not even editors.
        client('/blog').to_save = function (o) {
            client.save.abort(o)      // Abort this save attempt!
        }


        // But they can add new posts, and edit old ones, if they are an editor.
        client('/post/*').to_save = function (o) {

            // 1. Ensure current user is an editor.
            var u = client.fetch('/current_user')
            if (!u.logged_in || !editors[u.user.key]) {
                client.save.abort(o)
                return
            }

            // 2. Validate and save the post
            o.author = o.author || u.user.key  // XXX problem here
            o.title = o.title || ''
            o.body = o.body || ''
            master.save(o)  // Save it to master
            // We don't have to call client.save.fire(o) here because
            // master.save(o) will call master.save.fire(o), which will bubble
            // up to this client
        }

        // Only editors can /see/ unpublished posts
        client('/post/*').to_fetch = function (k) {
            var post = master.fetch(k)
            var u = client.fetch('/current_user')

            if (!post.unpublished || (u.logged_in && editors[u.user.key]))
                return master.fetch(k)
            else
                return {error: 'not permitted'}
        }
    }

    // Anything not matched to the handlers above will automatically pass
    // through to the master bus.
})

// Now we can define how state on the master bus behaves.

// We want '/blog'.posts to index every post in the system.  So whenever a
// post is saved to master, let's make sure that '/blog' knows about it.
master('/post/*').to_save = function (o) {
    var blog = master.fetch('/blog')       // Get the master list of posts
    blog.posts = blog.posts || []          // Initialize it if empty

                                           // If this post isn't indexed yet...
    if (!blog.posts.find(function (p) {return p.key === o.key})) {
        blog.posts.push(o)                 // Then add it to the blog
        master.save(blog)                  // And save our change
    }
    master.save.fire(o)                    // Now the save is complete.
}
```






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


