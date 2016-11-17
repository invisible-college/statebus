(function () {

    // ****************
    // Connecting over the Network
    function socketio_client (bus, prefix, url) {
        bus.log('socketio to', url)
        var socket = io(url)
        var fetched_keys = new Set()

        bus(prefix).to_fetch = function (key) {
            bus.log('fetching', key, 'from', url)
            // Error check
            // if (pending_fetches[key]) {
            //     console.error('Duplicate request for '+key)
            //     return
            // }
            // pending_fetches[key] = true
            fetched_keys.add(key)
            socket.emit('fetch', key)
        }

        var saver = bus(prefix).to_save = function (object) {
            bus.log('sending save', object)
            socket.emit('save', object)
            bus.save.fire(object)
        }
        bus(prefix).to_delete = function (key)    { socket.emit('delete', key) }
        bus(prefix).to_forget = function (key) {
            socket.emit('forget', key)
            fetched_keys.delete(key)
        }

        // Receive stuff
        socket.on('save', function(message) {
            bus.log('socketio_client: received SAVE', message.obj.key)
            var obj = message.obj
            //delete pending_fetches[obj.key]
            save(obj, saver)
        })

        socket.on('delete', del)

        // Reconnect needs to re-establish dependencies
        socket.on('reconnect', function() {
            var keys = fetched_keys.values()
            for (var i=0; i<keys.length; i++)
                socket.emit('fetch', keys[i])
        })
    }

    function sockjs_client(prefix, url) {
        var bus = this
        var recent_saves = []
        var sock
        var attempts = 0
        var outbox = []
        var fetched_keys = new bus.Set()
        var heartbeat
        url = url.replace(/^state:\/\//, 'https://')
        url = url.replace(/^statei:\/\//, 'http://')
        if (url[url.length-1]=='/') url = url.substr(0,url.length-1)
        function send (o, pushpop) {
            pushpop = pushpop || 'push'
            bus.log('sockjs.send:', JSON.stringify(o))
            outbox[pushpop](JSON.stringify(o))
            flush_outbox()
        }
        function flush_outbox() {
            if (sock.readyState === 1)
                while (outbox.length > 0)
                    sock.send(outbox.shift())
            else
                setTimeout(flush_outbox, 400)
        }
        var preprefix = prefix.slice(0,-1)
        function add_prefix (key) { return preprefix + key }
        function add_prefixes (obj) { return bus.translate_keys(bus.clone(obj), add_prefix) }
        function rem_prefix (key) { return key.substr(preprefix.length) }
        function rem_prefixes (obj) { return bus.translate_keys(bus.clone(obj), rem_prefix) }
        bus(prefix).to_save   = function (obj) { bus.save.fire(obj)
                                                 obj = rem_prefixes(obj)
                                                 send({method: 'save', obj: obj})
                                                 if (window.ignore_flashbacks)
                                                     recent_saves.push(JSON.stringify(obj))
                                                 if (recent_saves.length > 100) {
                                                     var extra = recent_saves.length - 100
                                                     recent_saves.splice(0, extra)
                                                 }
                                               }
        bus(prefix).to_fetch  = function (key) { key = rem_prefix(key)
                                                 send({method: 'fetch', key: key}),
                                                 fetched_keys.add(key) }
        bus(prefix).to_forget = function (key) { key = rem_prefix(key)
                                                 send({method: 'forget', key: key}),
                                                 fetched_keys.delete(key) }
        bus(prefix).to_delete = function (key) { key = rem_prefix(key)
                                                 send({method: 'delete', key: key}) }

        function connect () {
            console.log('%c[ ] trying to open ' + url, 'color: blue')
            sock = sock = new SockJS(url + '/statebus')
            sock.onopen = function()  {
                console.log('%c[*] opened ' + url, 'color: blue')

                var me = fetch('ls/me')
                bus.log('connect: me is', me)
                if (!me.client) {
                    me.client = (Math.random().toString(36).substring(2)
                                 + Math.random().toString(36).substring(2)
                                 + Math.random().toString(36).substring(2))
                    save(me)
                }
                send({method: 'save', obj: {key: 'current_user', client: me.client}},
                     'unshift')

                if (attempts > 0) {
                    // Then we need to refetch everything, cause it
                    // might have changed
                    recent_saves = []
                    var keys = fetched_keys.values()
                    for (var i=0; i<keys.length; i++)
                        send({method: 'fetch', key: keys[i]})
                }

                attempts = 0
                //heartbeat = setInterval(function () {send({method: 'ping'})}, 5000)
            }
            sock.onclose   = function()  {
                console.log('%c[*] closed ' + url, 'color: blue')
                heartbeat && clearInterval(heartbeat); heartbeat = null
                setTimeout(connect, attempts++ < 3 ? 1500 : 5000)

                // Remove all fetches and forgets from queue
                var new_outbox = []
                var bad = {'fetch':1, 'forget':1}
                for (var i=0; i<outbox.length; i++)
                    if (!bad[JSON.parse(outbox[i]).method])
                        new_outbox.push(outbox[i])
                outbox = new_outbox
            }

            sock.onmessage = function(event) {
                // Todo: Perhaps optimize processing of many messages
                // in batch by putting new messages into a queue, and
                // waiting a little bit for more messages to show up
                // before we try to re-render.  That way we don't
                // re-render 100 times for a function that depends on
                // 100 items from server while they come in.  This
                // probably won't make things render any sooner, but
                // will probably save energy.

                //console.log('[.] message')
                try {
                    var message = JSON.parse(event.data)
                    var method = message.method.toLowerCase()

                    // Convert v3 pubs to v4 saves for compatibility
                    if (method == 'pub') method = 'save'
                    // We only take saves from the server for now
                    if (method !== 'save' && method !== 'pong') throw 'barf'
                    bus.log('sockjs_client received', message.obj)

                    var is_recent_save = false
                    if (window.ignore_flashbacks) {
                        var s = JSON.stringify(message.obj)
                        for (var i=0; i<recent_saves.length; i++)
                            if (s === recent_saves[i]) {
                                is_recent_save = true
                                recent_saves.splice(i, 1)
                            }
                        // bus.log('Msg', message.obj.key,
                        //         is_recent_save?'is':'is NOT', 'a flashback')
                    }

                    if (!is_recent_save)
                        bus.save.fire(add_prefixes(message.obj))
                        //setTimeout(function () {bus.announce(message.obj)}, 1000)
                } catch (err) {
                    console.error('Received bad sockjs message from '
                                  +url+': ', event.data, err)
                    return
                }
            }

        }
        connect()
    }

    function localstorage_client (prefix) {
        // This doesn't yet trigger updates across multiple browser windows.
        // We can do that by adding a list of dirty keys and 

        var bus = this
        bus.log(this)

        // Fetch returns the value immediately in a save
        // Saves are queued up, to store values with a delay, in batch
        var saves_are_pending = false
        var pending_saves = {}

        function save_the_pending_saves() {
            bus.log('localstore: saving', pending_saves)
            for (var k in pending_saves)
                localStorage.setItem(k, JSON.stringify(pending_saves[k]))
            saves_are_pending = false
        }

        bus(prefix).to_fetch = function (key) {
            var result = localStorage.getItem(key)
            return result ? JSON.parse(result) : {key: key}
        }
        bus(prefix).to_save = function (obj) {
            // Do I need to make this recurse into the object?
            bus.log('localStore: on_save:', obj.key)
            pending_saves[obj.key] = obj
            if (!saves_are_pending) {
                setTimeout(save_the_pending_saves, 50)
                saves_are_pending = true
            }
            bus.save.fire(obj)
            return obj
        }
        bus(prefix).to_delete = function (key) { localStorage.removeItem(key) }


        // Hm... this update stuff doesn't seem to work on file:/// urls in chrome
        function update (event) {
            bus.log('Got a localstorage update', event)
            //this.get(event.key.substr('statebus '.length))
        }
        if (window.addEventListener) window.addEventListener("storage", update, false)
        else                         window.attachEvent("onstorage", update)
    }

    function universal_sockjs () {
        var bus = this
        var old_route = bus.route
        var connections = {}
        bus.route = function (key, method, arg, opts) {
            var d = get_domain(key)
            if (d && !connections[d]) {
                bus.sockjs_client(d + '*', d)
                connections[d] = true
            }

            return old_route(key, method, arg, opts)
        }
        function get_domain(key) {
            var m = key.match(/^state\:\/\/(([^:\/?#]*)(?:\:([0-9]+))?)/)
            // if (!m) throw Error('Bad url: ', key)
            return m && m[0]
        }

        // Now, if I implement proxy, then we can implement /* using a
        // proxy on top of this universal_sockjs
        if (window.slashcut) {
            // Proxy shortcut defined with:
            bus('/*').to_fetch = function (key) {
                return fetch('state://stateb.us' + key)
            }
            bus('/*').to_save = function (obj) {
                bus.save(copy(obj, 'state://stateb.us' + obj.key))
                bus.save.fire(obj)
            }

            bus('/*').proxy = function (key) { return 'state://stateb.us' + key }
            bus('/*').proxy('state://stateb.us/*')
            bus.proxy('/*', 'state://stateb.us/*')
        }
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
        //  - Save this into the cache

        bus(prefix).to_save = function (obj) {
            window.history.replaceState(
                '',
                '',
                document.location.origin
                    + document.location.pathname
                    + escape('?'+key+'='+JSON.stringify(obj)))
            bus.save.fire(obj)
        }
    }

    function live_reload_from (prefix) {
        if (!window.live_reload_initialized) {
            var first_time = true
            this(function () {
                var re = new RegExp(".*/" + prefix + "/(.*)")
                var file = window.location.href.match(re)[1]
                var code = fetch('/code/invisible.college/' + file).code
                if (!code) return
                if (first_time) {first_time = false; return}
                var old_scroll_position = window.pageYOffset
                document.body.innerHTML = code
                var i = 0
                var d = 100
                var interval = setInterval(function () {
                    if (i > 500) clearInterval(interval)
                    i += d
                    window.scrollTo(0, old_scroll_position)
                }, d)
            })
            window.live_reload_initialized = true
        }
    }

    // ****************
    // Wrapper for React Components

    // XXX Currently assumes there's a statebus named "bus" in global
    // XXX scope.

    var components = {}                  // Indexed by 'component/0', 'component/1', etc.
    var components_count = 0
    var dirty_components = {}
    function React_View(component) {
        function wrap(name, new_func) {
            var old_func = component[name]
            component[name] = function wrapper () { return new_func.bind(this)(old_func) }
        }
        
        // Register the component's basic info
        wrap('componentWillMount', function new_cwm (orig_func) {
            if (component.displayName === undefined)
                throw 'Component needs a displayName'
            this.name = component.displayName.toLowerCase().replace(' ', '_')
            this.key = 'component/' + components_count++
            components[this.key] = this

            function add_shortcut (obj, shortcut_name, to_key) {
                delete obj[shortcut_name]
                Object.defineProperty(obj, shortcut_name, {
                    get: function () { return fetch(to_key) },
                    configurable: true })
            }
            add_shortcut(this, 'local', this.key)

            orig_func && orig_func.apply(this, arguments)

            // Make render reactive
            var orig_render = this.render
            this.render = bus.reactive(function () {
                console.assert(this !== window)
                if (this.render.called_directly) {
                    delete dirty_components[this.key]

                    // Register on any keys passed in objects in props.
                    for (k in this.props)
                        if (this.props.hasOwnProperty(k)
                            && this.props[k] !== null
                            && typeof this.props[k] === 'object'
                            && this.props[k].key)
                            
                            fetch(this.props[k].key)
                    
                    // Call the renderer!
                    return orig_render.apply(this, arguments)
                } else {
                    dirty_components[this.key] = true
                    schedule_re_render()
                }
            })
        })

        wrap('componentWillUnmount', function new_cwu (orig_func) {
            orig_func && orig_func.apply(this, arguments)
            // Clean up
            bus.delete(this.key)
            delete components[this.key]
            delete dirty_components[this.key]
        })

        component.shouldComponentUpdate = function new_scu (next_props, next_state) {
            // This component definitely needs to update if it is marked as dirty
            if (dirty_components[this.key] !== undefined) return true

            // Otherwise, we'll check to see if its state or props
            // have changed.  But ignore React's 'children' prop,
            // because it often has a circular reference.
            next_props = bus.clone(next_props); this_props = bus.clone(this.props)
            delete next_props['children']; delete this_props['children']
            return !bus.deep_equals([next_state, next_props], [this.state, this_props])

            // TODO:
            //
            //  - Check children too.  Right now we just slidently fail
            //    on components with children.  WTF?
            //
            //  - A better method might be to mark a comopnent dirty when
            //    it receives new props in the
            //    componentWillReceiveProps React method.
        }
        
        component.loading = function loading () {
            return this.render.loading()
        }

        // Now create the actual React class with this definition, and
        // return it.
        var react_class = React.createClass(component)
        var result = function (props, children) {
            props = props || {}
            return (React.version >= '0.12.'
                    ? React.createElement(react_class, props, children)
                    : react_class(props, children))
        }
        // Give it the same prototype as the original class so that it
        // passes React.isValidClass() inspection
        result.prototype = react_class.prototype
        return result
    }
    window.React_View = React_View


    // *****************
    // Re-rendering react components
    var re_render_scheduled = false
    re_rendering = false
    function schedule_re_render() {
        if (!re_render_scheduled) {
            requestAnimationFrame(function () {
                re_render_scheduled = false

                // Re-renders dirty components
                for (var comp_key in dirty_components) {
                    if (dirty_components[comp_key] // Since another component's update might update this
                        && components[comp_key])   // Since another component might unmount this

                        try {
                            re_rendering = true
                            components[comp_key].forceUpdate()
                        } finally {
                            re_rendering = false
                        }
                }
            })
            re_render_scheduled = true
        }
    }

    // ##############################################################################
    // ###
    // ###  Full-featured single-file app methods
    // ###

    function make_client_statebus_maker () {
        var extra_stuff = ['socketio_client sockjs_client localstorage_client',
                           'universal_sockjs url_store components live_reload_from'].join(' ').split(' ')
        if (window.statebus) {
            var orig_statebus = statebus
            window.statebus = function make_client_bus () {
                var bus = orig_statebus()
                for (var i=0; i<extra_stuff.length; i++)
                    bus[extra_stuff[i]] = eval(extra_stuff[i])
                return bus
            }
        }
    }

    load_scripts() // This function could actually be inlined
    function load_scripts() {
        // console.info('Loading scripts!', window.statebus)
        if (!window.statebus) {
            var statebus_dir = script_elem().getAttribute('src').match(/(.*)[\/\\]/)
            statebus_dir = (statebus_dir && statebus_dir[1] + '/')||''

            var js_urls = {
                react: statebus_dir + 'extras/react.js',
                sockjs: statebus_dir + 'extras/sockjs.js',
                coffee: statebus_dir + 'extras/coffee.js',
                statebus: statebus_dir + 'statebus.js'
            }
            if (statebus_dir == 'https://stateb.us/')
                js_urls.statebus = statebus_dir + 'statebus4.js'

            for (name in js_urls)
                document.write('<script src="' + js_urls[name] + '" charset="utf-8"></script>')
        }

        document.addEventListener('DOMContentLoaded', scripts_ready, false)
    }

    function script_elem () {
        return document.querySelector('script[src*="client"][src$=".js"]')
    }
    window.statebus_server = window.statebus_server ||
        script_elem().getAttribute('server') || 'https://stateb.us:3005'
    window.statebus_backdoor = window.statebus_backdoor ||
        script_elem().getAttribute('backdoor')
    function scripts_ready () {
        make_client_statebus_maker()
        window.bus = window.statebus()
        window.bus.label = 'bus'
        window.sb = bus.sb

        improve_react()
        window.dom = {}
        window.ignore_flashbacks = false
        bus.localstorage_client('ls/*')
        bus.sockjs_client ('/*', statebus_server)

        if (window.statebus_backdoor) {
            window.master = statebus()
            master.sockjs_client('*', statebus_backdoor)
        }

        // bus('*').to_save = function (obj) { bus.save.fire(obj) }
        bus('/new/*').to_save = function (o) {
            if (o.key.split('/').length > 3) return

            var old_key = o.key
            o.key = old_key + '/' + Math.random().toString(36).substring(2,12)
            statebus.cache[o.key] = o
            delete statebus.cache[old_key]
            bus.save(o)
        }
        load_coffee()
        if (dom.Body || dom.body || dom.BODY)
            React.render((window.Body || window.body || window.BODY)(), document.body)
    }

    function improve_react() {
        function capitalize (s) {return s[0].toUpperCase() + s.slice(1)}
        function camelcase (s) { var a = s.split(/[_-]/)
                                 return a.slice(0,1).concat(a.slice(1).map(capitalize)).join('') }

        var css_props = 'background background-attachment background-color background-image background-position background-repeat border border-collapse border-color border-spacing border-style border-width bottom caption-side clear clip color content counter-increment counter-reset cursor direction display empty-cells float font font-family font-size font-style font-variant font-weight height left letter-spacing line-height list-style list-style-image list-style-position list-style-type margin max-height max-width min-height min-width orphans outline outline-color outline-style outline-width overflow padding page-break-after page-break-before page-break-inside position quotes right table-layout text-align text-decoration text-indent text-transform top unicode-bidi vertical-align visibility white-space widows width word-spacing z-index'.split(' ')
        var is_css_prop = {}
        for (var i=0; i<css_props.length; i++)
            is_css_prop[camelcase(css_props[i])] = true

        function better_element(el) {
            return function () {
                var children = []
                var attrs = {style: {}}
                
                for (var i=0; i<arguments.length; i++) {
                    var arg = arguments[i]

                    // Strings and DOM nodes and undefined become children
                    if (typeof arg === 'string'   // For "foo"
                        || arg instanceof String  // For new String()
                        || arg && arg._isReactElement
                        || arg === undefined)
                        children.push(arg)

                    // Arrays append onto the children
                    else if (arg instanceof Array)
                        Array.prototype.push.apply(children, arg)

                    // Pure objects get merged into object city
                    // Styles get redirected to the style field
                    else if (arg instanceof Object)
                        for (k in arg)
                            if (is_css_prop[k])
                                attrs.style[k] = arg[k]        // Merge styles
                    else
                        if (k === 'style')             // Merge insides of style tags
                            for (k2 in arg[k])
                                attrs.style[k2] = arg[k][k2]
                    else
                        attrs[k] = arg[k]          // Or be normal.
                    // else
                    //     console.log("Couldn't parse param", arg)
                }
                if (children.length === 0) children = undefined
                if (attrs['ref'] === 'input')
                    bus.log(attrs, children)
                return el(attrs, children)
            }
        }

        for (var el in React.DOM)
            window[el.toUpperCase()] = better_element(React.DOM[el])

        function make_better_input (name, element) {
            window[name] = React.createFactory(React.createClass({
                getInitialState: function() {
                    return {value: this.props.value}
                },
                componentWillReceiveProps: function(new_props) {
                    this.setState({value: new_props.value})
                },
                onChange: function(e) {
                    this.props.onChange && this.props.onChange(e)
                    if (this.props.value)
                        this.setState({value: e.target.value})
                },
                render: function() {
                    var new_props = {}
                    for (var k in this.props)
                        if (this.props.hasOwnProperty(k))
                            new_props[k] = this.props[k]
                    if (this.state.value) new_props.value = this.state.value
                    new_props.onChange = this.onChange
                    return element(new_props)
                }
            }))
        }

        make_better_input("INPUT", React.DOM.input)
        make_better_input("TEXTAREA", React.DOM.textarea)
    }

    // Load the components
    function make_component(name) {
        // Define the component
        window[name] = window.React_View({
            displayName: name,
            render: function () { return window.dom[name].bind(this)()},
            componentDidMount: function () {
                var refresh = window.dom[name].refresh
                refresh && refresh.bind(this)()
            },
            componentWillUnmount: function () {
                var down = window.dom[name].down
                return down && down.bind(this)()
            },
            componentDidUpdate: function () {
                if (!this.initial_render_complete && !this.loading()) {
                    this.initial_render_complete = true
                    var up = window.dom[name].up
                    up && up.bind(this)()
                }
                var refresh = window.dom[name].refresh
                return refresh && refresh.bind(this)()
            },
            getInitialState: function () { return {} }
        })
    }

    function load_coffee () {
        var scripts = document.getElementsByTagName("script")
        var filename = window.location.href.substring(window.location.href.lastIndexOf('/') + 1)
        for (var i=0; i<scripts.length; i++)
            if (scripts[i].getAttribute('type') === 'statebus'
                || scripts[i].getAttribute('type') === 'coffeedom') {
                // Compile coffeescript to javascript
                var compiled
                try {
                    compiled = CoffeeScript.compile(scripts[i].text/*.replace(/(\s[A-Z_]+)\n/g, '$1 null,\n')*/,
                                                    {bare: true,
                                                     sourceMap: true,
                                                     filename: filename})
                    var v3SourceMap = JSON.parse(compiled.v3SourceMap)
                    v3SourceMap.sourcesContent = scripts[i].text
                    v3SourceMap = JSON.stringify(v3SourceMap)

                    // Base64 encode it
                    var js = compiled.js + '\n'
                    js += '//# sourceMappingURL=data:application/json;base64,'
                    js += btoa(v3SourceMap) + '\n'
                    js += '//# sourceURL=' + filename
                    compiled = js
                } catch (error) {
                    if (error.location)
                        console.error('Syntax error in '+ filename + ' on line',
                                      error.location.first_line
                                      + ', column ' + error.location.first_column + ':',
                                      error.message)
                    else throw error
                }

                if (compiled) {
                    eval(compiled)
                    window.dom = dom
                    for (var view in dom)
                        make_component(view)
                }
            }
    }
})()