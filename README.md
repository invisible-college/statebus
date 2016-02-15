# Statebus

Statebus is a reactive framework for distributed state. It simplifies web development and will eliminate much of the web stack. Many projects of the invisible.college use statebus. 

Statebus is particularly good for prototyping web applications. You only need a single .html file, and you can easily share that file with other people, or fork it if you want to explore different ways your idea might be brought into the world. 

## Making a client

You don't need a server.  Just put this into a .html file on your filesystem:

```coffeescript
<script type="statebus">                                       # Initial line

dom.BODY = ->                                                  # Your code here
  DIV 'Hello, World!'

#</script><script src="https://stateb.us/client.js"></script>  # Loads statebus
```

Now you have a working statebus app, in a single html file!
Double-click to open it in your web browser with a `file:///` url.

## Writing code

In statebus we:

- Don't use CSS. We just inline all of our styles.
- Don't directly write HTML. The html is generated in the javascript with e.g. `DIV {style: position: 'absolute'}, 'My div'`
- We're using coffeescript, which is nicer syntax than javascript. It compiles down to javascript, but you don't have to worry about the compilation. That's taken care of by statebus.
- The web framework uses facebook's Reactjs behind the scenes.

## You write code in coffeescript

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

### You build a virtual dom using react

In [react.js](https://facebook.github.io/react/), you create a virtual dom that automatically updates based on state changes. To do this, you essentially define a render function that returns a dom element based on the current state. Statebus removes the cruft so you only need to define the render method. Like this example below, that creates a virtual comment box element and renders it with the 'render' method.

In javascript:

```javascript
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
example = ->
  state = fetch('/morgan/example')   # fetch this key from the server
                                     # because of the leading '/'
  if state.width == undefined
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

This example resizes a square when you click on it. [Play with it here](https://cheeseburgertherapy.com/emo/square).

`fetch` returns an object located at the key '/morgan/example', and subscribes to that object. What that means is that any time the state at /morgan/example changes, example will re-execute. `save(state)` will save changes and propagate them to any function that is subscribed.

Important: *the leading / in '/morgan/example' means that the state will synchronize with the server. A key 'morgan/example' would only be available to the client.*

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

## Making a statebus server

Install statebus on your server:

```
npm install statebus
npm install sockjs
```

Make a `server.js` file:

```javascript
var bus = require('statebus/server')
bus.serve({port: 3942})

bus('/funny/*').on_fetch = function (key) {
    return {joke: 'Why did the state cross the bus?'}
}

bus('/funny/*').on_save = function (obj) {
    send_email({subject: "Our funny joke changed!", body: obj.joke})
}
```

Run it:

```
node server.js
```

Tell your client that all `/*` state comes from this server by adding
this line to end of its html file:

```html
<script> statebus_server = "http://localhost:3942" </script>
```

## Other Examples

A simple statebus client and server can be found at https://github.com/invisible-college/considerit-data. 

