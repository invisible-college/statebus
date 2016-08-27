# What's new in Statebus v4

The big news is that you can now
**[program state behavior](#program-state-behavior)**! When combined with
[multiple busses](#make-multiple-busses), this lets us implement
[multiple-user support](#support-multiple-users) on the server.

But first let's get installation out of the way.

## Installing

#### Server

```shell
npm install statebus#next
```

The `#next` tells npm to give you version 4 instead of 3.

Create a server with:
```javascript
var bus = require('statebus/server')(options)
```

Options is a dictionary, and you can put these things in it:

```javascript
{
    port: 3004,                  // Each client normally connects on port 3004
    backdoor: 4004,              // For testing, you can enable direct access to the master bus at a port
    file_store: false,           // Persists state across server restarts.  Defaults to true.
    client: function (client) {} // See "multiple users" below.  Defaults to null.
}
```

If you specify a `port`, `backdoor`, or `client`, then this bus will start a
websocket server and serve its state over the internet.  Otherwise, it'll just
make a new bus object, as described in
[Multiple Busses](#make-multiple-busses).


#### Client

The template for client code has changed:

```coffeescript
<script type="statebus">

dom.BODY = ->
  DIV
    'Hello world!'

</script><script src="https://stateb.us/client4.js"></script>
```

- You don't need to add `null,` to that `DIV` anymore!
- Link to `client4.js` instead of `client.js` to get version 4
- And specifying a custom server is easier now, with the `server` attribute. Check it out:

```html
</script><script src="https://stateb.us/client4.js"
                 server="http://localhost:3004"></script>
```

The default port for statebus version 4 is `3004`.


## Program state behavior

Up until now, the statebus has been dumb and passive—it saves and fetches
whatever anyone asks it to.  But now there's an API to *control* reads and
writes to state.  You can:
- Give distinct users distinct permissions and views of state **⬅︎ You can write server code!**
- Connect statebusses together
- Make proxies or caches that define state in terms of other state
- Create handy state abstractions that live-update on any schedule you can program

How does it work? Recall the four statebus methods:
- fetch(key)
- save(obj)
- forget(key)
- delete(key)

You can now define *handlers* that control how each method behaves on a set of keys:
- bus(key_space).to_fetch = function (key) { ... }
- bus(key_space).to_save = function (obj) { ... }
- bus(key_space).to_forget = function (key) { ... }
- bus(key_space).to_delete = function (key) { ... }

Let's start with the handlers for `fetch` and `save`.

### Define state programmatically with `to_fetch`

Let's imagine I want to define an aggregate blog state, that pulls in state
from multiple other blogs.  To define new state, we define how to *fetch* it.
When someone fetches this state, it'll run our function, which returns the
aggregated blog:

```javascript
bus('/aggregate_blog').to_fetch = function (key) {
   var blog1 = fetch('/blog1')
   var blog2 = fetch('/blog2')
   return {posts: blog1.posts.concat(blog2.posts)}
}
```

Handlers are automatically reactive, so whenever blog1 or blog2 change, our
`to_fetch` handler will re-run and produce a new aggregate blog.  The
reactions will start when a client fetches it, and stop when all clients
have forgotten it.

You can also define a `.to_fetch` function for a *space* of keys, by appending
`*` to the key:

```javascript
bus('one_plus/*').to_fetch = function (key) {
   // The *individual* key being fetched is passed to this function as "key"
   var num = Number(key.split('/')[1])
   return {result: 1 + num}
}

fetch('one_plus/2').num   // result: 3
```

The general form of a `to_fetch` handler is:

```javascript
bus('the_answer').to_fetch = function (key) {
   // Do some stuff...

   // ...and then produce new state to fire across the bus,
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

### Control saves with `to_save`

A `to_save` handler looks like this:

```javascript
bus("key_pattern").to_save = function (obj) {

   // Here you can validate obj, tweak it, update a backing store...

   // And eventually, either call:
   save.abort(obj)   // To deny this save request!

   // ... or:
   save.fire(obj)    // To broadcast the result across the bus!
}
```

Your `to_save` handler will receive the requested new state `obj` as a
parameter, and must either call `save.abort(obj)` to ignore the request, or
`save.fire(obj)` (after making any desired changes to `obj`) to broadcast it.

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
bus.save({key:'foo', bar=3})
bus.fetch('foo').bar          // ==> 3

gus.fetch('foo').bar          // ==> undefined
```

You can connect busses together with handlers.  For instance:
```javascript
// Connect fetchs on 'foo' to gus
bus('foo').to_fetch = function () { return gus.fetch('foo') }

// Connect saves on 'foo' to gus
bus('foo').to_save = function (obj) { gus.save(obj); bus.save.fire(obj) }
```

If you only have one bus, you can also use the global `fetch()` and `save()`
functions.

```javascript
fetch('foo').fuzz          // ==> undefined
save({key:'foo', fuzz=3})
fetch('foo').fuzz          // ==> 3
```

But these globals are disabled on multi-user servers, where they become ambiguous.

(We might remove multiple busses in a future release.)

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

        // Give each client a different view of the '/foo' state:
        client('/foo').to_fetch = function (key) {
            if (fetch('/current_user').logged_in)
                return {you_are: 'logged in!!!'}
            else
                return {you_are: 'not logged in... sad.'}
        }
    }
})

// Master state definitions can go below
// master('/bar').to_fetch = ...
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

### The `/current_user` state

Each user will have a different `/current_user` state. By default, it looks like this:

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

#### Log in

Run this:
```javascript
c = fetch('/current_user')
c.login_as = {name: 'mike', pass: '••••'}
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

#### Create a new account
```javascript
c.create_account = {name: 'Reginald McGee', pass: 'security-R-us', email: 'barf@toilet.guru'}
save(c)

// ... and now log into it:
c.login_as = {name: 'Reginald McGee', pass: 'security-R-us'}
save(c)
```

#### The `/user/*` state

Each user has a key starting with `/user/`.  You can look up any other
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

This is the list of all clients connected to the server—whether logged, in or not.  For example, this
server has 3 connected clients, and two of them are the same user (me):

```javascript
{
  key: "/connections",
  all: [
    {user: {key: "/user/mike", name: "mike", email: "toomim@gmail.com"}},
    {},
    {user: {key: "/user/mike", name: "mike", email: "toomim@gmail.com"}}
  ]
}
```

I have two connections because I have two browser tabs open to the server.

You can see your client's current connection with the `/connection` state:

```javascript
{
  key: "/connection",
  mine: {user: {key: "/user/mike", name: "mike", email: "toomim@gmail.com"}}
}
```

Each client can store additional information in their connection:

```javascript
c = fetch('/connection')
c.mine.extra_info = 'Something!'
save(c)
```

This info is broadcast to everyone who fetched `/connections` on the server:

```javascript
{
  key: "/connections",
  all: [
    {user: {key: "/user/mike", name: "mike", email: "toomim@gmail.com"}, extra_info: "Something!"},
    {},
    {user: {key: "/user/mike", name: "mike", email: "toomim@gmail.com"}}
  ]
}
```

## Little things

### Back door entry

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

```shell
npm install statebus#next
```

Make a `demo.js`:
```javascript
bus = require('statebus/server')({port: 3004})

// Define state that derives from other statebus state
bus('/sum').to_fetch = function (key) {
    var a = fetch('/a'), b = fetch('/b')
    return {sum: a.val + b.val}  // Shorthand for => save.fire({key: '/sum', sum: a.val + b.val})
}

// Define state that incorporates external state
var timer
bus('/time').to_fetch = function (key) {
    timer = setInterval(function () {
        bus.save.fire({key: key, time: new Date().getTime()})
    }, 1000)
}
bus('/time').to_forget = function (key) {
    clearInterval(timer)
}

// Control changes to state
bus('/blog').to_save = function (obj) {
    if (Math.random() < .5) {
        obj.var = "I'm forcing this var!"
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
```

# What's not new

## Fetch and Save with Rerunnable Functions

The statebus `fetch()` and `save()` methods give you the illusion that all
state is always available if you use them from within a *rerunnable* function.
This way, if a piece of state isn't available, statebus will just wait until
it becomes available, and re-run the function then. And every time the state
changes, statebus will re-run the function again. This way you can write
functions that produce state that is always up to date, whithout callbacks,
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

### Intermediate states, crash recovery, and loading()

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

# API Reference

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
- Equivalent to:
```javascript
bus.reactive(func)
func()
```

### `bus.loading(key=null)`
  - If given a `key`, returns true if `bus` has pending fetches waiting for data to key from other busses.
  - Without a `key`, returns true if the currently-executing reactive function has subscribed to any keys with such pending fetches.


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
  - You shouldn't need this.



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
