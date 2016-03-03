// These 5 lines generate a module that can be included with CommonJS, AMD, and <script> tags.
(function(name, definition) {
    if (typeof module != 'undefined') module.exports = definition()
    else if (typeof define == 'function' && typeof define.amd == 'object') define(definition)
    else this[name] = definition()
}('statebus', function() { var busses = {}, executing_funk, global_funk, funks = {}; return function make_bus () {
    function log () {
        if (bus.honk)
            console.log.apply(console, arguments)
    }

    // ****************
    // The statebus object we will return
    function bus (arg) {
        // Called with a function to react to
        if (typeof arg === 'function') {
            var f = reactive(arg)
            f()
            return f
        }

        // Called with a key to produce a subspace
        else return subspace(arg)
    }
    var id = 'bus ' + Math.random().toString(36).substring(7)
    bus.toString = function () { return id + (bus.label || '') }
    bus.delete_bus = function () {
        // // Forget all wildcard handlers
        // for (var i=0; i<wildcard_handlers.length; i++) {
        //     console.log('Forgetting', funk_name(wildcard_handlers[i].funk))
        //     wildcard_handlers[i].funk.forget()
        // }

        // // Forget all handlers
        // for (var k1 in handlers.hash)
        //     for (var k2 in handlers.hash[k])
        //         handlers.hash[k][k2].forget()

        delete busses[bus.id]
    }

    // The Data Almighty!!
    var cache = {}
    var backup_cache = {}

    // ****************
    // Reactive REST API

    var pending_fetches = {}
    var fetches_out = {}                // Maps `key' to `true' iff we've fetched `key'
    var fetches_in = new One_To_Many()  // Maps `key' to `pub_funcs' subscribed to our key
    function fetch (key, callback) {
        //console.log('fetch:', key, 'on', bus)
        key = key.key || key    // You can pass in an object instead of key

        var called_from_reactive_funk = !callback
        var funk = callback || executing_funk

        // Remove this limitation at some point.  One reason for it is
        // that bind() doesn't check if a wildcard handler
        // already exists... it just pushes a new one.  That'll grow
        // unbounded.  I can later use regexps for wildcard handlers,
        // and start escaping the patterns between fetch() and
        // bind() and solve these issues robustly.
        console.assert(key[key.length-1] !== '*')

        // ** Call fetchers upstream **

        // TODO: checking fetches_out[] doesn't count keys that we got
        // which arrived nested within a bigger object, because we
        // never explicity fetched those keys.  But we don't need to
        // fetch them now cause we already have them.
        if (!fetches_out[key])
            bus.route(key, 'fetch', key)

        // Now there might be a new value pubbed onto this bus.
        // Or there might be a pending fetch.
        // ... or there weren't any fetchers upstream.

        // ** Subscribe the calling funk **

        if (called_from_reactive_funk)
            funk.depends_on(bus, key)
        fetches_in.add(key, funk_key(funk))
        // log('Fetch: Executing_funk is', executing_funk && executing_funk.statebus_id)
        // log('fetches in adding', key, funk_key(funk),
        //     callback && funk_key(callback),
        //     executing_funk && funk_key(executing_funk))
        bind(key, 'pub', funk)

        // ** Return a value **

        // If called reactively, we always return a value.
        if (called_from_reactive_funk) {
            backup_cache[key] = backup_cache[key] || {key: key}
            return cache[key] = cache[key] || {key: key}
        }

        // Otherwise, we want to make sure that a pub gets called on
        // the handler.  If there's a pending fetch, then it'll get
        // called later.  Otherwise, let's call it now.
        else if (!pending_fetches[key]) {
            backup_cache[key] = backup_cache[key] || {key: key}
            run_handler(funk, 'pub', cache[key] = cache[key] || {key: key})
        }

    }

    function save (obj) {
        if ((executing_funk !== global_funk) && executing_funk.loading()) {
            abort_changes([obj.key])
            return
        }

        bus.route(obj.key, 'save', obj)
    }

    function pub (object) {
        delete pending_fetches[object.key]
        log('pub:', object)

        // Ignore if nothing happened
        if (object.key && !changed(object)) {
            log('Well, this is a boring pub.',
                object,
                cache[object.key],
                backup_cache[object.key])
            return
        }

        // Recursively add all of object, and its sub-objects, into the cache
        var modified_keys = update_cache(object, cache)

        if ((executing_funk !== global_funk) && executing_funk.loading()) {
            abort_changes(modified_keys)
        } else {
            // Now put it into the backup
            update_cache(object, backup_cache)

            publishable_keys.push.apply(publishable_keys, modified_keys)
            key_publisher = key_publisher ||
                setTimeout(function () {
                    //console.log('pub:', object.key+ '. Listeners on these keys need update:', keys)

                    // Note: this can be made more efficient.  There may
                    // be duplicate handler calls in here, because a
                    // single handler might react to multiple keys.  For
                    // instance, it might fetch multiple keys, where each
                    // key has been modified.  To make this more
                    // efficient, we should first find all the handlers
                    // affected by these keys, and then collapse them, and
                    // call each one once.  Unfortunately, doing so would
                    // require digging into the bus.route() API and
                    // changing it.  We'd probably need to make it accept
                    // an array of keys instead of a single key, and then
                    // have search_handlers take an array of keys as well.
                    // So I'm not bothering with this optimization yet.
                    // We will just have duplicate-running functions for a
                    // while.
                    for (var i=0; i<publishable_keys.length; i++) {
                        log('pub: In loop', i + ', updating listeners on \''
                            + publishable_keys[i] + "'")
                        var key = publishable_keys[i]
                        bus.route(key, 'pub', cache[key])
                    }
                    publishable_keys = []
                    key_publisher = null
                    //console.log('pub: done looping through', keys, ' and done with', object.key)
                }, 0)
        }
    }
    var key_publisher = null
    var publishable_keys = []

    // Folds object into the cache recursively and returns the keys
    // for all mutated staet
    function update_cache (object, cache) {
        var modified_keys = new Set()
        function update_object (obj) {

            // Two ways to optimize this in future:
            //
            // 1. Only clone objects/arrays if they are new.
            // 
            //    Right now we re-clone all internal arrays and
            //    objects on each pub.  But we really only need to
            //    clone them the first time they are pubbed into the
            //    cache.  After that, we can trust that they aren't
            //    referenced elsewhere.  (We make it the programmer's
            //    responsibility to clone data if necessary on fetch,
            //    but not when on pub.)
            // 
            //    We'll optimize this once we have history.  We can
            //    look at the old version to see if an object/array
            //    existed already before cloning it.
            //
            // 2. Don't go infinitely deep.
            //
            //    Eventually, each save/pub will be limited to the
            //    scope underneath nested keyed objects.  Right now
            //    I'm just recursing infinitely on the whole data
            //    structure with each pub.

            // Clone arrays
            if (Array.isArray(obj))
                obj = obj.slice()

            // Clone objects
            else if (typeof obj === 'object'
                     && obj        // That aren't null
                     && !(obj.key  // That aren't already in cache
                          && cache[obj.key] === obj)) {
                var tmp = {}; for (var k in obj) tmp[k] = obj[k]; obj = tmp
            }

            // Fold cacheable objects into cache
            if (obj && obj.key) {
                if (cache !== backup_cache && changed(obj))
                    modified_keys.add(obj.key)
                else
                    console.warn('Boring modified key', obj.key)
                if (!cache[obj.key])
                    // This object is new.  Let's store it.
                    cache[obj.key] = obj

                else if (obj !== cache[obj.key]) {
                    // Else, mutate cache to match the object.

                    // First, add/update missing/changed fields to cache
                    for (var k in obj)
                        if (cache[obj.key][k] !== obj[k])
                            cache[obj.key][k] = obj[k]
                    
                    // Then delete extra fields from cache
                    for (var k in cache[obj.key])
                        if (!(k in obj))
                            delete cache[obj.key][k]
                }
                obj = cache[obj.key]
            }

            return obj
        }
        deep_map(object, update_object)
        return modified_keys.values()
    }

    function changed (object) {
        return true
        return !(object.key in cache)
            || !(object.key in backup_cache)
            || !(deep_equals(object, backup_cache[object.key]))
    }
    function abort_changes (keys) {
        for (var i=0; i < keys.length; i++)
            update_cache(backup_cache[keys[i]], cache)
    }
        

    function forget (key, pub_handler) {
        //log('forget:', key, funk_name(pub_handler), funk_name(executing_funk))
        pub_handler = pub_handler || executing_funk
        var fkey = funk_key(pub_handler)
        //console.log('Fetches in is', fetches_in.hash)
        if (!fetches_in.contains(key, fkey)) {
            console.error("***\n****\nTrying to forget lost key", key,
                          'from', funk_name(pub_handler), fkey,
                          "that hasn't fetched that key.",
                          funks[fetches_in.get(key)[0]],
                          funks[fetches_in.get(key)[0]] && funks[fetches_in.get(key)[0]].statebus_id
                         )
            console.trace()
            throw Error('asdfalsdkfajsdf')
        }

        fetches_in.delete(key, fkey)
        unbind(key, 'pub', pub_handler)

        // If this is the last handler listening to this key, then we
        // can delete the cache entry and send a forget upstream.
        if (!fetches_in.has_any(key)) {
            clearTimeout(to_be_forgotten[key])
            to_be_forgotten[key] = setTimeout(function () {
                bus.route(key, 'forget', key)

                //delete cache[key]
                delete fetches_out[key]
                delete to_be_forgotten[key]
            }, 200)
        }
    }
    function del (obj_or_key) {
        var key = obj_or_key.key || obj_or_key

        if ((executing_funk !== global_funk) && executing_funk.loading()) {
            abort_changes([key])
            return
        }

        delete cache[key]

        var idx = publishable_keys.indexOf(key)
        if (idx > -1)
            publishable_keys.splice(idx, 1)

        log('del:', obj_or_key)
        bus.route(key, 'delete', key)
        //forget(key /*, bus??*/)
    }


    // ****************
    // Dirty
    var dirty_keys = new Set()
    var dirty_sweeper = null
    function dirty (key) {
        log('dirty:', key)
        dirty_keys.add(key)

        dirty_sweeper = dirty_sweeper || setTimeout(function () {
            //console.log('dirty_sweeper:', dirty_keys.all())

            // Let's grab the dirty keys and clear it, so that
            // anything that gets dirty during this sweep will be able
            // to sweep again afterward
            var keys = dirty_keys.values()
            dirty_keys.clear()
            dirty_sweeper = null
            
            // Now sweep through our cache of dirty filth and sweep it all up!
            for (var i=0; i<keys.length; i++)
                // If anybody is fetching this key
                if (fetches_in.has_any(keys[i])) {
                    log('dirty_sweeper: routing a fetch for', key)
                    bus.route(key, 'fetch', key)
                }
        }, 0)
    }


    // ****************
    // Connections
    function subspace (key) {
        var result = {}
        for (method in {fetch:null, save:null, pub:null,
                        'delete':null, forget:null})
            (function (method) {
                Object.defineProperty(result, 'on_' + method, {
                    set: function (func) { bind(key, method, func) },
                    get: function () {
                        var result = bindings(key, method)
                        result.delete = function (func) { unbind (key, method, func) }
                        return result
                    }
                })
            })(method)
        return result
    }

    // The funks attached to each key, maps e.g. 'fetch /point/3' to '/30'
    var handlers = new One_To_Many()
    var wildcard_handlers = []  // An array of {prefix, method, funk}
    //var funks = {}              // Maps funk_id -> function

    // A set of timers, for keys to send forgets on
    var to_be_forgotten = {}
    function funk_key (funk) {
        if (!funk.statebus_id) {
            funk.statebus_id = Math.random().toString(36).substring(7)
            funks[funk.statebus_id] = funk
        }
        return funk.statebus_id
    }
    function funk_name (f, char_limit) {
        char_limit = char_limit || 30
        if (f.proxies_for) f = f.proxies_for
        if (f.statebus_binding)
            return ("('"+f.statebus_binding.key+"').on_"
                    + f.statebus_binding.method
                    + (f.name? ' = function '+f.name+'() {...}' : ''))
        else
            return f.toString().substr(0,char_limit) + '...'
    }
    function bind (key, method, func) {
        // func.statebus_name = func.statebus_name ||
        //     ("('"+key+"').on_"+method
        //      + (func.name? ' = function '+func.name+'() {...}' : ''))

        if (key[key.length-1] !== '*')
            handlers.add(method + ' ' + key, funk_key(func))
        else
            wildcard_handlers.push({prefix: key,
                                    method: method,
                                    funk: func})

        if (to_be_forgotten[key]) {
            clearTimeout(to_be_forgotten[key])
            delete to_be_forgotten[key]
        }

        // Now check if the method is a fetch and there's a fetched
        // key in this space, and if so call the handler.
    }
    var forget_timer
    function unbind (key, method, funk) {
        if (key[key.length-1] !== '*')
            // Delete direct connection
            handlers.delete(method + ' ' + key, funk_key(funk))
        else
            // Delete wildcard connection
            for (var i=0; i<wildcard_handlers.length; i++) {
                var handler = wildcard_handlers[i]
                if (handler.prefix === key
                    && handler.method === method
                    && handler.funk === funk) {

                    wildcard_handlers.splice(i,1)  // Splice this element out of the array
                    i--                            // And decrement the counter while we're looping
                }
            }
    }

    function bindings(key, method) {
        if (typeof key !== 'string') {
            console.error('Error:', key, 'is not a string')
            console.trace()
        }

        //console.log('bindings:', key, method)
        var result = []

        // First get the exact key matches
        var exacts = handlers.get(method + ' ' + key)
        for (var i=0; i < exacts.length; i++) {
            funks[exacts[i]].statebus_binding = {key:key, method:method}
            result.push(funks[exacts[i]])
        }

        // Now iterate through prefixes
        for (var i=0; i < wildcard_handlers.length; i++) {
            handler = wildcard_handlers[i]

            var prefix = handler.prefix.slice(0, -1)       // Cut off the *
            if (prefix === key.substr(0,prefix.length)     // If the prefix matches
                && method === handler.method) {             // And it has the right method
                handler.funk.statebus_binding = {key:key, method:method}
                result.push(handler.funk)
            }
        }

        return result
    }

    function run_handler(funk, method, arg) {
        // console.log("run_handler: ('"+(arg.key||arg)+"').on_"
        //             +method+' = f^'+funk_key(funk))
        // if (funk.statebus_name === undefined || funk.statebus_name === 'undefined')
        //     console.log('WEIRDO FUNK', funk, typeof funk.statebus_name)

        if (!funk.global_funk)  // \u26A1 
            log('> a', method+"('"+(arg.key||arg)
                +"') is triggering", funk_name(funk), funk_key(funk))

        if (method === 'fetch') {
            fetches_out[arg] = true
            pending_fetches[arg] = funk
        }

        // When we first run a handler (e.g. a fetch or save), we wrap
        // it in a reactive() funk that calls it with its arg.  Then
        // if it fetches or saves, it'll register a pub handler with
        // this funk.

        // Pub events will be calling an already-wrapped funk, that
        // has its own arg
        if (funk.react) {
            console.assert(method === 'pub')
            return funk.react()
        }

        // Fresh fetch/save/forget/delete handlers will just be
        // regular functions.  We'll store their arg and let them
        // re-run until they are done re-running.
        var f = reactive(function () {
            var result = funk(arg)

            // For fetch
            if (method === 'fetch' && result instanceof Object && !f.loading()) {
                result.key = arg
                // console.log('run_handler: pubbing', arg,
                //             'after fetched RETURN from fetch('+arg+')')
                pub(result)
                return result
            }

            // Save, forget and delete handlers stop re-running once
            // they've completed without anything loading.
            // ... with f.forget()
            if ((method === 'save' || method === 'forget' || method === 'delete')
                && !f.loading())
                f.forget()
        })
        f.proxies_for = funk

        // on_fetch handlers stop re-running when the key is forgotten
        if (method === 'fetch') {
            var key = arg
            function handler_done () {
                f.forget()
                unbind(key, 'forget', handler_done)
            }
            bind(key, 'forget', handler_done)
        }

        return f()
    }

    // route() can be overridden
    bus.route = function (key, method, arg) {
        var funcs = bus.bindings(key, method)
        for (var i=0; i<funcs.length; i++)
            bus.run_handler(funcs[i], method, arg)

        if (method === 'fetch')
            console.assert(funcs.length<2,
                           'Two on_fetch functions are registered for the same key '+key,
                           funcs)
        return funcs.length
    }


    // ****************
    // Reactive functions
    // 
    // We wrap any function with a reactive wrapper that re-calls it
    // whenever state it's fetched changes.

    if (!global_funk) {
        global_funk = reactive(function global_funk () {})
        global_funk.global_funk = true
        executing_funk = global_funk
        funks[global_funk.statebus_id = 'global funk'] = global_funk
    }
    //global_funk.fetched_keys = new Set()

    function reactive(func) {
        var dis, args

        // You can call a funk directly:
        //
        //    f = reactive(func)
        //    f(arg1, arg2)
        //
        // This will remember every fetch it depends on, and make it
        // re-call itself whenever that state changes.  It will
        // remember arg1 and arg2 and use those again.  You can also
        // trigger a re-action manually with:
        //
        //    funk.react().
        //
        // ...which will make it re-run with the original arg1 and arg2 .
        function funk () {
            console.assert(executing_funk === global_funk
                           || executing_funk !== funk, 'Recursive funk', funk.func)

            // If you call this function with 
            if (funk.called_directly)
                dis = this, args = arguments

            // Forget the keys from last time
            funk.forget()

            // Now let's run it
            var last_executing_funk = executing_funk
            executing_funk = funk
            try {
                var result = func.apply(dis, args)
            } catch (e) {
                if (e.message === 'Maximum call stack size exceeded') {
                    console.error(e)
                    process.exit()
                }
                //executing_funk = null // Or should this be last_executing_funk?
                if (funk.loading()) return null
                else {
                    var result = func.apply(dis, args)
                    // If code reaches here, there was an error
                    // triggering the error.  We should warn the
                    // programmer, and then probably move on, because
                    // maybe the error went away... and it doesn't do
                    // us any good to just crash now, does it?  Then
                    // the programmer has less information on what
                    // happened because he/she can't see it in the
                    // result, which might also be fucked up, and
                    // might be informative.
                    console.error('Non-deterministic Error!', e.stack || e)
                    console.warn("A non-deterministic error is when your reactive function triggers an error only some of the times it's called.\nThe error originated from calling:", funk_name(func, 400))
                }
            } finally {
                executing_funk = last_executing_funk
            }
            return result
        }

        funk.func = func  // just for debugging
        funk.called_directly = true
        funk.fetched_keys = new One_To_Many() // maps bus to keys
        funk.abortable_keys = []
        funk.depends_on = function (bus, key) {
            this.fetched_keys.add(bus, key)
        }
        funk.react = function () {
            var result
            try {
                funk.called_directly = false
                result = funk()
            } finally {
                funk.called_directly = true
            }
            return result
        }
        funk.forget = function () {
            if (funk.statebus_id === 'global funk') return

            //console.log('Funk.forget() on', funk_name(funk))

            var buss_ids = Object.keys(funk.fetched_keys.hash)
            for (var i=0; i<buss_ids.length; i++) {
                var keys = funk.fetched_keys.get(buss_ids[i])
                for (var j=0; j<keys.length; j++) {
                    //console.log('Forgetting', keys[j], buss_ids[i], 'from', Object.keys(busses))
                    // There's a bug here when a funk depends on a bus
                    // that has disconnected.  What do we do in this
                    // situation?  Is the bus not cleaning up after
                    // itself when it dies?  How does it die?  What
                    // should it do?

                    // Answer: socksj_server calls delete_bus(), which
                    // just deletes the bussid from var busses[].  But
                    // this doesn't clean up each funk's fetched keys.
                    if (buss_ids[i] in busses)
                        busses[buss_ids[i]].forget(keys[j], funk)
                }
                funk.fetched_keys.delete_all(buss_ids[i])
            }
            // var keys = funk.fetched_keys.all()
            // //console.log('react: forgetting', keys)
            // for (var i=0; i<keys.length; i++) forget(keys[i], funk)
            // funk.fetched_keys.clear()
        }
        funk.loading = function () {
            var buss_ids = Object.keys(funk.fetched_keys.hash)
            for (var i=0; i<buss_ids.length; i++) {
                var b = buss_ids[i]
                if (busses[b] && busses[b].loading_keys(funk.fetched_keys.get(b)))
                    return true
            }
            return false
        }

        // for backwards compatibility
        funk.is_loading = funk.loading

        return funk
    }

    function loading_keys (keys) {
        // Do any of these keys have outstanding gets?
        //console.log('Loading: pending_keys is', pending_fetches)
        for (var i=0; i<keys.length; i++)
            if (pending_fetches[keys[i]]) return true
        return false
    }

    // Tells you whether the currently executing funk is loading
    function loading () { return executing_funk.loading() }

    // ******************
    // Utility funcs
    function One_To_Many() {
        var hash = this.hash = {}
        var counts = {}
        this.get = function (k) { return Object.keys(hash[k] || {}) }
        this.add = function (k, v) {
            if (hash[k] === undefined)   hash[k]   = {}
            if (counts[k] === undefined) counts[k] = 0
            if (!hash[k][v]) counts[k]++
            hash[k][v] = true
        }
        this.delete = function (k, v) { delete hash[k][v]; counts[k]-- }
        this.delete_all = function (k) { delete hash[k]; delete counts[k] }
        this.contains = function (k, v) { return hash[k] && hash[k][v] }
        this.has_any = function (k) { return counts[k] }
        this.del = this.delete // for compatibility; remove this soon
    }
    function Set () {
        var hash = {}
        this.add = function (a) { hash[a] = true }
        //this.has = function (a) { return a in hash }
        this.values = function () { return Object.keys(hash) }
        this.delete = function (a) { delete hash[a] }
        this.clear = function () { hash = {} }
        this.del = this.delete // for compatibility; remove this soon
        this.all = this.values // for compatibility; remove this soon
    }
    //Set = window.Set || Set
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
            if (obj.hasOwnProperty(attr)) obj[attr] = with_obj[attr]
        return obj
    }

    function deep_map (object, func) {
        object = func(object)

        // Recurse through each element in arrays
        if (Array.isArray(object))
            for (var i=0; i < object.length; i++)
                object[i] = deep_map(object[i], func)

        // Recurse through each property on objects
        else if (typeof(object) === 'object')
            for (var k in object)
                object[k] = deep_map(object[k], func)

        return object
    }
    function deep_equals (a, b) {
        // Equal Primitives?
        if (a === b
            // But because NaN === NaN returns false:
            || (isNaN(a) && isNaN(b)
                // And because isNaN(undefined) return true:
                && typeof a === 'number' && typeof b === 'number'))
            return true

        // Equal Arrays?
        var a_array = Array.isArray(a), b_array = Array.isArray(b)
        if (a_array !== b_array) return false
        if (a_array) {
            if (a.length !== b.length) return false
            for (var i=0; i < a.length; i++)
                if (!deep_equals (a[i], b[i]))
                    return false
            return true
        }

        // Equal Objects?
        var a_obj = a && typeof a === 'object',  // Note: typeof null === 'object'
            b_obj = b && typeof b === 'object'
        if (a_obj !== b_obj) return false
        if (a_obj) {
            var a_length = 0, b_length = 0
            for (var k in a) {
                a_length++
                if (!deep_equals(a[k], b[k]))
                    return false
            }
            for (var k in b) b_length++
            if (a_length !== b_length)
                return false
            return true
        }

        // Then Not Equal.
        return false
    }
    function key_id(string) { return string.match(/\/?[^\/]+\/(\d+)/)[1] }
    function key_name(string) { return string.match(/\/?([^\/]+).*/)[1] }


    // #######################################
    // ########### Browser Code ##############
    // #######################################

    // Make these private methods accessible
    var api = ['cache backup_cache fetch save forget del pub dirty',
               'subspace handlers wildcard_handlers bindings',
               'run_handler bind unbind reactive',
               'funk_key funk_name funks key_id key_name id',
               'pending_fetches fetches_in loading_keys loading',
               'global_funk',
               'Set One_To_Many clone extend deep_map deep_equals log'
              ].join(' ').split(' ')
    for (var i=0; i<api.length; i++)
        bus[api[i]] = eval(api[i])

    bus.delete = bus.del
    bus.executing_funk = function () {return executing_funk}

    // Export globals
    if (Object.keys(busses).length === 0) {
        var globals = 'fetch save pub del'.split(' ')
        for (var i=0; i<globals.length; i++)
            this[globals[i]] = /*window[globals[i]] ||*/ eval(globals[i])
    }
    busses[bus.id] = bus
    return bus
}}))