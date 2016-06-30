# Statebus

Synchronizes state.  Automates caching, networking, history, and reactions to
state changes.  
Currently supports web browsers and nodejs servers.  
By the invisible college.

## Web Browsers

Make a `something.html` file with this inside:

```coffeescript
<script type="statebus">

dom.BODY = ->
  DIV 'hello world!'

</script><script src="https://stateb.us/client4.js">
```


## Nodejs Servers
