import statebus from './statebus.js'

const websocket_prefix = (clientjs_option('websocket_path')
  || '_connect_to_statebus_')

// make_client_statebus_maker()
const bus = statebus()

export default bus
bus.label = 'bus'

bus.libs = {}

// ****************
// Connecting over the Network
function set_cookie (key, val) {
  document.cookie = key + '=' + val + '; Expires=21 Oct 2025 00:0:00 GMT;'
}
function get_cookie (key) {
  var c = document.cookie.match('(^|;)\\s*' + key + '\\s*=\\s*([^;]+)');
  return c ? c.pop() : '';
}
try { document.cookie } catch (e) {get_cookie = set_cookie = function (){}}
function make_websocket (url) {
  if (!url.match(/^\w{0,7}:\/\//))
    url = location.protocol+'//'+location.hostname+(location.port ? ':'+location.port : '') + url

    url = url.replace(/^state:\/\//, 'wss://')
      url = url.replace(/^istate:\/\//, 'ws://')
        url = url.replace(/^statei:\/\//, 'ws://')

          url = url.replace(/^https:\/\//, 'wss://')
            url = url.replace(/^http:\/\//, 'ws://')

              // {   // Convert to absolute
              //     var link = document.createElement("a")
              //     link.href = url
              //     url = link.href
              // }

              return new WebSocket(url + '/' + websocket_prefix + '/websocket')
              // return new SockJS(url + '/' + websocket_prefix)
            }
function client_creds (server_url) {
  // This function is only used for websocket connections.
  // http connections set the cookie on the server.
  var me = bus.get('ls/me')
  bus.log('connect: me is', me)
  if (!me.client) {
    // Create a client id if we have none yet.
    // Either from a cookie set by server, or a new one from scratch.
    var c = get_cookie('peer')
    me.client = c || (Math.random().toString(36).substring(2)
      + Math.random().toString(36).substring(2)
      + Math.random().toString(36).substring(2))
    bus.set(me)
  }

  set_cookie('peer', me.client)
  return {clientid: me.client}
}

bus.libs.http_out = (prefix, url) => {
  var preprefix = prefix.slice(0,-1)
  var has_prefix = new RegExp('^' + preprefix)
  var is_absolute = /^https?:\/\//
  var subscriptions = {}
  var put_counter = 0

  function add_prefix (url) {
    return is_absolute.test(url) ? url : preprefix + url }
  function rem_prefix (url) {
    return has_prefix.test(url) ? url.substr(preprefix.length) : url }
  function add_prefixes (obj) {
    var keyed = bus.translate_keys(bus.clone(obj), add_prefix)
    return bus.translate_links(bus.clone(keyed), add_prefix)
  }
  function rem_prefixes (obj) {
    var keyed = bus.translate_keys(bus.clone(obj), rem_prefix)
    return bus.translate_links(bus.clone(keyed), rem_prefix)
  }

  var puts = new Map()
  function enqueue_put (url, body) {
    var id = put_counter++
    puts.set(id, {url: url, body: body, id: id})
    send_put(id)
  }
  function send_put (id) {
    try {
      puts.get(id).status = 'sending'
      braid_fetch(
        puts.get(id).url,
        {
          method: 'put',
          headers: {
            'content-type': 'application/json',
            'put-order': id,
          },
          body: puts.get(id).body
        }
      ).then(function (res) {
        if (res.status !== 200)
          console.error('Server gave error on PUT:',
            e, 'for', puts.get(id).body)
        puts.delete(id)
      }).catch(function (e) {
        console.error('Error on PUT, waiting...', puts.get(id).url)
        puts.get(id).status = 'waiting'
      })
    } catch (e) {
      console.error('Error on PUT, waiting...', puts.get(id).url)
      puts.get(id).status = 'waiting'
    }
  }
  function retry_put (id) {
    setTimeout(function () {send_put(id)}, 1000)
  }
  function send_all_puts () {
    puts.forEach(function (value, id) {
      if (value.status === 'waiting') {
        console.log('Sending waiting put', id)
        send_put(id)
      }
    })
  }

  bus(prefix).setter   = function (obj, t) {
    bus.set.fire(obj)

    var put = {
      url: url + rem_prefix(obj.key),
      body: JSON.stringify(obj.val)
    }
    if (t.version) put.version = t.version
    if (t.parents) put.parents = t.parents
    if (t.patch)   put.patch   = t.patch
    var put_id = put_counter++
    puts.set(put_id, put)
    send_put(put_id)
  }

  bus(prefix).getter  = function (key, t) {
    // Subscription can be in states:
    // - connecting
    // - connected
    // - reconnect
    // - reconnecting
    // - aborted

    // If we have an outstanding get running, then let's tell it to
    // re-activate!
    if (subscriptions[key]) {
      // We should only be here if an existing subscription was
      // aborted, but hasn't cleared yet.
      console.assert(subscriptions[key].status === 'aborted',
        'Regetting a subscription of status '
        + subscriptions[key].status)

      console.trace('foo')

      // Let's tell it to reconnect when it tries to clear!
      subscriptions[key].status = 'reconnect'
    }

    // Otherwise, create a new subscription
    else
      subscribe (key, t)

    function subscribe (key, t) {
      var aborter = new AbortController(),
        reconnect_attempts = 0

      // Start the subscription!
      braid_fetch(
        // URL
        url + rem_prefix(key),

        // Options
        {
          method: 'get',
          subscribe: true,
          headers: {accept: 'application/json'},
          signal: aborter.signal
        }
      ).andThen( function (new_version) {
        // New update received!
        if (subscriptions[key].status === 'connecting') {
          console.log('%c[*] opened ' + key,
            'color: blue')
          reconnect_attempts = 0
          subscriptions[key].status = 'connected'
          send_all_puts()
        }

        // Return the update
        t.return({
          key: key,
          val: add_prefixes(JSON.parse(new_version.body))
        })
      }).catch( function (e) {
        if (subscriptions[key].status === 'aborted') {
          // Then this get is over and done with!
          delete subscriptions[key]
          return
        }

        // Reconnect!
        setTimeout(function () { subscribe(key, t) },
          reconnect_attempts > 0 ? 5000 : 1500)
        subscriptions[key].status = 'reconnecting'
      })

      // Remember this subscription
      subscriptions[key] = {
        aborter: aborter,
        status: 'connecting'
      }
    }
  }
  bus(prefix).forgetter = function (key) {
    subscriptions[key].status = 'aborted'
    subscriptions[key].aborter.abort()
  }
}

function http_automount () {
  function get_domain (key) { // Returns e.g. "state://foo.com"
    var m = key.match(/^https?\:\/\/(([^:\/?#]*)(?:\:([0-9]+))?)/)
    return m && m[0]
  }

  var old_route = bus.route
  var connections = {}
  bus.route = function (key, method, arg, t) {
    var d = get_domain(key)
    if (d && !connections[d]) {
      bus.libs.http_out(d + '/*', d + '/')
      connections[d] = true
    }

    return old_route(key, method, arg, t)
  }
}


// ****************
// Manipulate Localstorage
bus.libs.localstorage = (prefix) => {
  try { localStorage } catch (e) { return }

  // Sets are queued up, to store values with a delay, in batch
  var sets_are_pending = false
  var pending_sets = {}

  function set_the_pending_sets() {
    bus.log('localstore: saving', pending_sets)
    for (var k in pending_sets)
      localStorage.setItem(k, JSON.stringify(pending_sets[k]))
    sets_are_pending = false
  }

  bus(prefix).getter = function (key) {
    var result = localStorage.getItem(key)
    return result ? JSON.parse(result) : {key: key}
  }
  bus(prefix).setter = function (obj) {
    // Do I need to make this recurse into the object?
    bus.log('localStore: on_set:', obj.key)
    pending_sets[obj.key] = obj
    if (!sets_are_pending) {
      setTimeout(set_the_pending_sets, 50)
      sets_are_pending = true
    }
    bus.set.fire(obj)
    return obj
  }
  bus(prefix).deleter = function (key) { localStorage.removeItem(key) }


  // Hm... this update stuff doesn't seem to work on file:/// urls in chrome
  function update (event) {
    bus.log('Got a localstorage update', event)
    bus.dirty(event.key)
    //this.get(event.key.substr('statebus '.length))
  }
  if (window.addEventListener) window.addEventListener("storage", update, false)
  else                         window.attachEvent("onstorage", update)
}

// Stores state in the query string, as ?key1={obj...}&key2={obj...}
function url_store (prefix) {
  var bus = this
  function get_query_string_value (key) {
    return unescape(window.location.search.replace(
      new RegExp("^(?:.*[&\\?]"
        + escape(key).replace(/[\.\+\*]/g, "\\$&")
        + "(?:\\=([^&]*))?)?.*$", "i"),
      "$1"))
  }

  // Initialize data from the URL on load

  // Now the regular shit
  var data = get_query_string_value(key)
  data = (data && JSON.parse(data)) || {key : key}
  // Then I would need to:
  //  - Change the key prefix
  //  - Set this into the cache

  bus(prefix).setter = function (obj) {
    window.history.replaceState(
      '',
      '',
      document.location.origin
      + document.location.pathname
      + escape('?'+key+'='+JSON.stringify(obj)))
    bus.set.fire(obj)
  }
}

function clientjs_option (option_name) {
  // This function must be copy/paste synchronized with statebus.js.  Be
  // sure to clone all edits there.
  var script_elem = document.querySelector('script[src$="statebus/client.js"]')
  return script_elem && script_elem.getAttribute(option_name)
}


document.addEventListener('DOMContentLoaded', function () {
  if (window.statebus_ready)
    for (var i=0; i<statebus_ready.length; i++)
      statebus_ready[i]()
}, false)
