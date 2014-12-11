(function () {

    // ****************
    // Public API
    var cache = {}
    function fetch(key, defaults) {
        if (key.key) key = key.key // if key is passed as object

        window.record_dependence && record_dependence(key)

        // Return the cached version if it exists
        if (cache[key]) return cache[key]

        // Else, start a serverFetch in the background and return stub.
        if (key[0] === '/')
            server_fetch(key)

        update_cache(extend({key: key}, defaults))
        return cache[key]
    }

    /*  Updates cache and saves to server.
     *  You can pass a callback that will run when the saves have finished.
     */
    function save(object, continuation) {
        update_cache(object)

        // Save all the objects
        if (object.key && object.key[0] == '/')
            server_save(object, continuation)
        else
            if (continuation) continuation()
    }

    /*  Deletes from server (if it's there) and removes from cache
     *  You can pass a callback that will run when the delete has finished.
     */
    function destroy(key, continuation) {
        if (!key) return

        // Save all the objects
        if (key[0] == '/')
            server_destroy(key, continuation)
        else {
            // Just remove the key from the cache if this state is
            // owned by the client.  Note that this won't clean up
            // references to this object in e.g. any lists. The Client
            // is responsible for updating all the relevant
            // references.
            delete cache[key]
            if (continuation) continuation()
        }
    }


    // ================================
    // == Internal funcs

    var new_index = 0
    var affected_keys = new Set()
    var re_render_timer = null
    function update_cache(object) {
        function recurse(object) {
            // Recurses into object and folds it into the cache.

            // If this object has a key, update the cache for it
            var key = object && object.key
            if (key) {
                // Change /new/thing to /new/thing/45
                if (key.match(new RegExp('^/new/'))     // Starts with /new/
                    && !key.match(new RegExp('/\\d+$'))) // Doesn't end in a /number
                    key = object.key = key + '/' + new_index++

                var cached = cache[key]
                if (!cached)
                    // This object is new.  Let's cache it.
                    cache[key] = object
                else if (object !== cached)
                    // Else, mutate cache to match the object.
                    for (var k in object)          // Mutating in place preserves
                        cache[key][k] = object[k]  // pointers to this object

                // Remember this key for re-rendering
                affected_keys.add(key)
            }

            // Now recurse into this object.
            //  - Through each element in arrays
            //  - And each property on objects
            if (Array.isArray(object))
                for (var i=0; i < object.length; i++)
                    object[i] = recurse(object[i])
            else if (typeof(object) === 'object' && object !== null)
                for (var k in object)
                    object[k] = recurse(object[k])

            // Return the new cached representation of this object
            return cache[key] || object
        }

        recurse(object)

        // Now initiate the re-rendering, if there isn't a timer already going
        re_render_timer = re_render_timer || setTimeout(function () {
            re_render_timer = null
            var keys = affected_keys.all()
            affected_keys.clear()
            if (keys.length > 0) {
                var re_render = (window.re_render || function () {
                    console.log('You need to implement re_render()') })
                re_render(keys)
            }
        })
    }

    var pending_fetches = {}
    function server_fetch(key) {
        // Error check
        if (pending_fetches[key]) {
            console.error('Duplicate request for '+key)
            return
        }

        // Build request
        var request = new XMLHttpRequest()
        request.onload = function () {
            delete pending_fetches[key]
            if (request.status === 200) {
                var result = JSON.parse(request.responseText)
                if (window.arest.trans_in)
                    result = arest.trans_in(result)
                update_cache(result)
            }
            else if (request.status === 500)
                if (window.on_ajax_error) window.on_ajax_error()

        }

        // Open request
        pending_fetches[key] = request
        request.open('GET', key, true)
        request.setRequestHeader('Accept','application/json')
        request.setRequestHeader('X-Requested-With','XMLHttpRequest')

        request.send(null)
    }

    var pending_saves = {} // Stores xmlhttprequest of any key being saved
                           // (Note: This shim will fail in many situations...)
    function server_save(object, continuation) {
        console.log('pending saves', pending_saves[object.key])
        if (pending_saves[object.key]) {
            console.log('Yo foo, aborting')
            pending_saves[object.key].abort()
            delete pending_saves[object.key]
        }

        var original_key = object.key
        
        // Special case for /new.  Grab the pieces of the URL.
        var pattern = new RegExp("/new/([^/]+)/(\\d+)")
        var match = original_key.match(pattern)
        var url = (match && '/' + match[1]) || original_key

        // Build request
        var request = new XMLHttpRequest()
        request.onload = function () {
            // No longer pending
            delete pending_saves[original_key]

            if (request.status === 200) {
                var result = JSON.parse(request.responseText)
                // console.log('New save result', result)
                // Handle /new/stuff
                deep_map(function (obj) {
                    match = obj.key && obj.key.match(/(.*)\?original_id=(\d+)$/)
                    if (match && match[2]) {
                        // Let's map the old and new together
                        var new_key = match[1]                // It's got a fresh key
                        cache[new_key] = cache[original_key]  // Point them at the same thing
                        obj.key = new_key                     // And it's no longer "/new/*"
                    }
                },
                        result)
                update_cache(result)
                if (continuation) continuation()
            }
            else if (request.status === 500)
                window.ajax_error && window.ajax_error()
        }

        object = clone(object)
        object['authenticity_token'] = csrf()

        // Open request
        var POST_or_PUT = match ? 'POST' : 'PUT'
        request.open(POST_or_PUT, url, true)
        request.setRequestHeader('Accept','application/json')
        request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        request.setRequestHeader('X-CSRF-Token', csrf())
        request.setRequestHeader('X-Requested-With','XMLHttpRequest')
        request.send(JSON.stringify(object))

        // Remember it
        pending_saves[original_key] = request
    }

    function server_delete(key, continuation) {
        // Build request
        var request = new XMLHttpRequest()
        request.onload = function () {
            if (request.status === 200) {
                console.log('Delete returned for', key)
                var result = JSON.parse(request.responseText)
                delete cache[key]
                update_cache(result)
                if (continuation) continuation()
            }
            else if (request.status === 500)
                if (window.on_ajax_error) window.on_ajax_error()
            else {
                // TODO: give user feedback that DELETE failed
                console.log('DELETE of', key, 'failed!')
            }

        }

        payload = {'authenticity_token': csrf()}

        // Open request
        request.open('DELETE', key, true)
        request.setRequestHeader('Accept','application/json')
        request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        request.setRequestHeader('X-CSRF-Token', csrf())
        request.setRequestHeader('X-Requested-With','XMLHttpRequest')
        request.send(JSON.stringify(payload))
    }

    var csrf_token = null
    function csrf(new_token) {
        if (new_token) csrf_token = new_token
        if (csrf_token) return csrf_token
        var metas = document.getElementsByTagName('meta')
        for (i=0; i<metas.length; i++) { 
            if (metas[i].getAttribute("name") == "csrf-token") { 
                return metas[i].getAttribute("content");
            } 
        } 
        return ""
    }

    // Websockets code
    function upgrade_to_websockets() {
        if (window.socket && window.socket.io) {
            console.log('Upgrading statebus to websockets')
            
            // Fetch
            server_fetch = function (key) {
                // Error check
                if (pending_fetches[key]) {
                    console.error('Duplicate request for '+key)
                    return
                }
                pending_fetches[key] = true

                socket.emit('get', key)
            }

            // Save
            server_save = function (object) {
                socket.emit('put', object)            
            }
            // Still need to handle /new stuff

            server_delete = function (key) {
                socket.emit('delete', key)
            }

            // Receive stuff
            socket.on('put', function(obj) {
                console.log('We got putted a', obj)
                delete pending_fetches[obj.key]
                if (window.arest.trans_in)
                    result = arest.trans_in(obj)
                update_cache(obj)
            })

            socket.on('delete', function(key) {
                delete cache[key]
            })

            // Reconnect needs to re-establish dependencies
            socket.on('reconnect', function() {
                for (var key in cache)
                    if (key[0] == '/')
                        socket.emit('get', key)
            })
        }
    }
    document.addEventListener('DOMContentLoaded', upgrade_to_websockets, false)


    // This is used in a specific hack.  I need to work on it.
    function clear_matching_objects (match_key_func) {
        // Clears all keys where match_key_func(key) returns true
        for (key in cache)
            if (match_key_func(key))
                delete cache[key]
    }

    loading_indicator = React.DOM.div({style: {height: '100%', width: '100%'},
                                       className: 'loading'}, 'Loading')
    function error_indicator(message) {
        return React.DOM.div(null, 'Error! ' + message)
    }

    // ****************
    // Wrapper for React Components
    var components = {}                  // Indexed by 'component/0', 'component/1', etc.
    var components_count = 0
    var dirty_components = {}
    var execution_context = []  // The stack of components that are being rendered
    function ReactiveComponent(component) {
        // STEP 1: Define get() and save()
        component.fetch = component.data = component.get = function (key, defaults) {
            if (!this._lifeCycleState || this._lifeCycleState == 'UNMOUNTED')
                throw Error('Component ' + this.name + ' (' + this.local_key
                            + ') is tryin to get data(' + key + ') after it died.')

            if (key === undefined)    key = this.mounted_key || this.name
            if (!key)                 return null
            // if (!key)    throw TypeError('Component mounted onto a null key. '
            //                              + this.name + ' ' + this.local_key)
            if (key.key) key = key.key   // If user passes key as object
            return fetch(key, defaults)  // Call into main activerest
        }
        component.save = save                  // Call into main activerest
        

        // STEP 2: Wrap all the component's methods
        function wrap(obj, method, before, after) {
            var original_method = obj[method]
            if (!(original_method || before || after)) return
            obj[method] = function() {
                before && before.apply(this, arguments)
                if (this.local_key !== undefined)
                    // We only want to set the execution context on wrapped methods
                    // that are called on live instance.  getDefaultProps(), for
                    // instance, is called when defining a component class, but not
                    // on actual instances.  You can't render new components from
                    // within there, so we don't need to track the execution context.
                    execution_context = this.props.parents.concat([this.local_key])

                try {
                    var result = original_method && original_method.apply(this, arguments)
                } catch (e) {
                    execution_context = []
                    if (e instanceof TypeError) {
                        if (this.is_waiting()) return loading_indicator
                        else { error(e, this.name); return error_indicator(e.message) }
                    } else { error(e, this.name) }
                }
                execution_context = []
                after && after.apply(this, arguments)

                return result
            }
        }

        // We register the component when mounting it into the DOM
        wrap(component, 'componentWillMount',
             function () { 

                 // STEP 1. Register the component's basic info
                 if (component.displayName === undefined)
                     throw 'Component needs a displayName'
                 this.name = component.displayName.toLowerCase().replace(' ', '_')
                 this.local_key = 'component/' + components_count++
                 components[this.local_key] = this

                 // You can pass an object in as a key if you want:
                 if (this.props.key && this.props.key.key)
                     this.props.key = this.props.key.key

                 // XXX Putting this into WillMount probably won't let you use the
                 // mounted_key inside getInitialState!  But you should be using
                 // activerest state anyway, right?
                 this.mounted_key = this.props.key

                 // STEP 2: Create shortcuts e.g. `this.foo' for all parents up the
                 // tree, and this component's local key

                 // First for all parents
                 var parents = this.props.parents.concat([this.local_key])
                 for (var i=0; i<parents.length; i++) {
                     parent_keys = keys_4_component.get(parents[i])
                     if (this.mounted_key)
                         parent_keys = parent_keys.concat([this.mounted_key])
                     for (var j=0; j<parent_keys.length; j++) {
                         var key = parent_keys[j]
                         var name = key_name(key)
                         add_shortcut(this, name, key)
                     }
                 }

                 // ...and now for @local
                 add_shortcut(this, 'local', this.local_key)
             })

        wrap(component, 'render', function () {
            // Render will need to clear the component's old
            // dependencies before rendering and finding new ones
            clear_component_dependencies(this.local_key)
            delete dirty_components[this.local_key]
        })

        wrap(component, 'componentDidMount')
        wrap(component, 'componentDidUpdate')
        wrap(component, 'getDefaultProps')
        //wrap(component, 'componentWillReceiveProps')
        wrap(component, 'componentWillUnmount', function () {
            // Clean up
            clear_component_dependencies(this.local_key)
            delete cache[this.local_key]
            delete components[this.local_key]
            delete dirty_components[this.local_key]
        })
        component.shouldComponentUpdate = function (next_props, next_state) {
            // This component definitely needs to update if it is marked as dirty
            if (dirty_components[this.local_key] !== undefined) return true

            // Otherwise, we'll check to see if its state or props
            // have changed.  We can do so by simply serializing them
            // and then comparing them.  But ignore React's 'children'
            // prop, because it often has a circular reference.
            next_props = clone(next_props); this_props = clone(this.props)
            delete next_props['children']; delete this_props['children']
            return JSON.stringify([next_state, next_props]) != JSON.stringify([this.state, this_props])
        }
        
        component.is_waiting = function () {
            // Does this component depend on any keys that are being
            // requested?
            var dependent_keys = keys_4_component.get(this.local_key)
            for (var i=0; i<dependent_keys.length; i++)
                if (pending_fetches[dependent_keys[i]])
                    return true
            return false
        }

        // STEP 3: Configure the global function hooks for React
        window.re_render = react_rerender
        window.record_dependence = record_component_dependence

        // Now create the actual React class with this definition, and
        // return it.
        var react_class = React.createClass(component)
        var result = function (props, children) {
            props = props || {}
            props.parents = execution_context.slice()
            return react_class(props, children)
        }
        // Give it the same prototype as the original class so that it
        // passes React.isValidClass() inspection
        result.prototype = react_class.prototype
        return result
    }

    function add_shortcut (obj, shortcut_name, to_key) {
        //console.log('Giving '+obj.name+' shorcut @'+shortcut_name+'='+to_key)
        delete obj[shortcut_name]
        Object.defineProperty(obj, shortcut_name, {
            get: function () { return obj.get(to_key) },
            configurable: true })
    }


    // *****************
    // Dependency-tracking for React components
    var keys_4_component = new One_To_Many() // Maps component to its dependence keys
    var components_4_key = new One_To_Many() // Maps key to its dependent components
    function react_rerender (keys) {
        // Re-renders only the components that depend on `keys'

        // First we determine the components that will need to be updated
        for (var i = 0; i < keys.length; i++) {
            affected_components = components_4_key.get(keys[i])
            for (var j = 0; j < affected_components.length; j++)
                dirty_components[affected_components[j]] = true
        }

        // Then we sweep through and update them
        for (var comp_key in dirty_components)
            // the check on both dirty_components and components is a PATCH
            // for a possible inconsistency between dirty_components and components
            // that occurs if a component has a componentWillUnmount method.
            if (dirty_components[comp_key] && components[comp_key]) // Since one component might update another
                components[comp_key].forceUpdate()
    }
    function record_component_dependence(key) {
        // Looks up current component from the execution context
        if (execution_context.length > 0) {
            var component = execution_context[execution_context.length-1]
            if (!keys_4_component.contains(component, key)) {
                keys_4_component.add(component, key)  // Track dependencies
                components_4_key.add(key, component)  // both ways

                // Give it the this.foo syntax
                add_shortcut(components[component], key_name(key), key)
            }
        }
    }
    function clear_component_dependencies(component) {
        var depends_on_keys = keys_4_component.get(component)
        for (var i=0; i<depends_on_keys.length; i++)
            components_4_key.del(depends_on_keys[i], component)
        keys_4_component.delAll(component)
    }


    // ****************
    // Utility for React Components
    function One_To_Many() {
        var hash = this.hash = {}
        this.get = function (k) { return Object.keys(hash[k] || {}) }
        this.add = function (k, v) {
            if (hash[k] === undefined)
                hash[k] = {}
            hash[k][v] = true
        }
        this.del = function (k, v) {
            delete hash[k][v]
        }
        this.delAll = function (k) { hash[k] = {} }
        this.contains = function (k, v) { return hash[k] && hash[k][v] }
    }
    function Set() {
        var hash = {}
        this.add = function (a) { hash[a] = true }
        this.all = function () { return Object.keys(hash) }
        this.clear = function () { hash = {} }
    }


    // ******************
    // General utility funcs
    function clone(obj) {
        if (obj == null) return obj
        var copy = obj.constructor()
        for (var attr in obj)
            if (obj.hasOwnProperty(attr)) copy[attr] = obj[attr]
        return copy
    }
    function extend(obj, with_obj) {
        if (with_obj === undefined) return obj
        for (var attr in with_obj)
            if (!obj.hasOwnProperty(attr)) obj[attr] = with_obj[attr]
        return obj
    }
    function deep_map(func, object) {
        // This function isn't actually a full "deep map" yet.
        // Limitations: It only applies func to OBJECTS (not arrays or
        // atoms), and doesn't return anything.
        if (Array.isArray(object))
            for (var i=0; i < object.length; i++)
                deep_map(func, object[i])
        else if (typeof(object) === 'object' && object !== null) {
            func(object)
            for (var k in object)
                deep_map(func, object[k])
        }
    }
    function error(e, name) {
        console.error('In', name + ':', e.stack)
        if (window.on_client_error)
            window.on_client_error(e)
    }

    function key_id(string) {
        return string.match(/\/?[^\/]+\/(\d+)/)[1]
    }
    function key_name(string) {
        return string.match(/\/?([^\/]+).*/)[1]
    }

    // Camelcased API options
    var updateCache=update_cache, serverFetch=server_fetch,
        serverSave=server_save,
        serverDelete  =server_delete,
        serverDestroy =server_delete
        server_destroy=server_delete

    // Export the public API
    window.ReactiveComponent = ReactiveComponent
    window.fetch = fetch
    window.save = save
    window.destroy = destroy

    // Make the private methods accessible under "window.arest"
    vars = 'cache fetch save server_fetch serverFetch server_save serverSave update_cache updateCache csrf keys_4_component components_4_key components execution_context One_To_Many clone dirty_components affected_keys clear_matching_objects deep_map key_id key_name'.split(' ')
    window.arest = {}
    for (var i=0; i<vars.length; i++)
        window.arest[vars[i]] = eval(vars[i])

})()
