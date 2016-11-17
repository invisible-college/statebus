// These 5 lines generate a module that can be included with CommonJS, AMD, and <script> tags.
(function(name, definition) {
    if (typeof module != 'undefined') module.exports = definition()
    else if (typeof define == 'function' && typeof define.amd == 'object') define(definition)
    else this[name] = definition()
}('statebus', function() { statelog_indent = 0; var busses = {}, executing_funk, global_funk, funks = {}, clean_timer; return function make_bus () {
    var nodejs = typeof window === 'undefined'

    // ****************
    // Public API

    function fetch (key, callback) {
        key = key.key || key    // You can pass in an object instead of key
                                // We should probably disable this in future

        if (typeof key !== 'string')
            throw ('Error: fetch(key) called with a non-string key: '+key)

        var called_from_reactive_funk = !callback
        var funk = callback || executing_funk

        if (callback) {
            (callback.defined = callback.defined || []
            ).push({as:'fetch callback', key:key});
            callback.has_seen = callback.has_seen || function (bus, key, version) {
                callback.seen_keys = callback.seen_keys || {}
                callback.seen_keys[JSON.stringify([bus.id, key])] = version
            }
        }

        //log('fetch:', key, {called_from_reactive_funk: called_from_reactive_funk})

        // Remove this limitation at some point.  One reason for it is that
        // bind() doesn't check if a wildcard handler already exists... it
        // just pushes a new one.  That'll grow unbounded.  I can later use
        // regexps for wildcard handlers, and start escaping the patterns
        // between fetch() and bind() and solve these issues robustly.
        console.assert(key[key.length-1] !== '*')

        // ** Subscribe the calling funk **

        if (called_from_reactive_funk)
            funk.has_seen(bus, key, versions[key])
        fetches_in.add(key, funk_key(funk))
        if (to_be_forgotten[key]) {
            clearTimeout(to_be_forgotten[key])
            delete to_be_forgotten[key]
        }

        bind(key, 'on_save', funk)

        // ** Call fetchers upstream **

        // TODO: checking fetches_out[] doesn't count keys that we got which
        // arrived nested within a bigger object, because we never explicity
        // fetched those keys.  But we don't need to fetch them now cause we
        // already have them.
        var to_fetchers = 0
        if (!fetches_out[key])
            to_fetchers = bus.route(key, 'to_fetch', key)

        // Now there might be a new value pubbed onto this bus.
        // Or there might be a pending fetch.
        // ... or there weren't any fetchers upstream.


        // ** Return a value **

        // If called reactively, we always return a value.
        if (called_from_reactive_funk) {
            backup_cache[key] = backup_cache[key] || {key: key}
            return cache[key] = cache[key] || {key: key}
        }

        // Otherwise, we want to make sure that a pub gets called on the
        // handler.  If there's a pending fetch, then it'll get called later.
        // If there was a to_fetch, then it already got called.  Otherwise,
        // let's call it now.
        else if (!pending_fetches[key] && to_fetchers === 0) {
            // TODO: my intuition suggests that we might prefer to
            // delay this .on_save getting called in a
            // setTimeout(f,0), to be consistent with other calls to
            // .on_save.
            backup_cache[key] = backup_cache[key] || {key: key}
            run_handler(funk, 'on_save', cache[key] = cache[key] || {key: key})
        }
    }
    var pending_fetches = {}
    var fetches_out = {}                // Maps `key' to `func' iff we've fetched `key'
    var fetches_in = new One_To_Many()  // Maps `key' to `pub_funcs' subscribed to our key

    if (nodejs)
        var red = '\x1b[31m', normal = '\x1b[0m', grey = '\x1b[0;38;5;245m',
            green = '\x1b[0;38;5;46m', brown = '\x1b[0;38;5;130m'
    else
        var red = '', normal = '', grey = '',
            green = '', brown = ''
    var currently_saving
    function add_diff_msg (message, obj) {
        var diff = sorta_diff(backup_cache[obj.key], obj)
        if (diff) {
            var end_col = message.length + 2 + statelog_indent * 3
            for (var i=0; i<40-end_col; i++) message += ' '
            message += diff.substring(0,80)
        }
        else message += ' <no diff>'
        return message
    }
    function save_msg (obj, t, meth) {
        var message = (t && t.m) || bus + "."+meth+"('"+obj.key+"')"
        message = add_diff_msg(message, obj)
        if (t.version) message += ' [' + t.version + ']'
        return message
    }
    function save (obj, t) {
        if (!('key' in obj) || typeof obj.key !== 'string')
            console.error('Error: save(obj) called on object without a key: ', obj)

        t = t || {}
        // Make sure it has a version.
        t.version = t.version || new_version()

        if ((executing_funk !== global_funk) && executing_funk.loading()) {
            abort_changes([obj.key])
            return
        }

        var message = save_msg(obj, t, 'save')

        // Ignore if nothing happened
        if (obj.key && !changed(obj)) {
            statelog(grey, 'x', message)
            return
        } else
            statelog(red, 'o', message)

        try {
            statelog_indent++
            var was_saving = currently_saving
            currently_saving = obj.key

            // Call the to_save() handler!
            var num_handlers = bus.route(obj.key, 'to_save', obj, t)
            if (num_handlers === 0)
                // And fire if there weren't any!
                save.fire(obj, t)
        }
        finally {
            statelog_indent--
            currently_saving = was_saving
        }
        // TODO: Here's an alternative.  Instead of counting the handlers and
        // seeing if there are zero, I could just make a to_save handler that
        // is shadowed by other handlers if I can get later handlers to shadow
        // earlier ones.
    }
    save.fire = fire
    function fire (object, t) {
        t = t || {}
        // Make sure it has a version.
        t.version = t.version || new_version()

        // First, let's print out the statelog entry.
        // (And abort if there's no change.)
        var message = save_msg(object, t, 'save.fire')
        var color, icon
        if (currently_saving === object.key &&
            !(object.key && !changed(object))) {
            statelog_indent--
            statelog(red, '•', '↵' + (t.version ? '\t\t\t[' + t.version + ']' : ''))
            statelog_indent++
        } else {
            // Ignore if nothing happened
            if (object.key && !changed(object)) {
                // log('fire: o|c=', deep_equals(object, cache[object.key]),
                //     'b|c=', deep_equals(backup_cache[object.key], cache[object.key]),
                //     'o|b=', deep_equals(backup_cache[object.key], object))
                color = grey
                icon = 'x'
                if (t.to_fetch)
                    message = (t.m) || 'Fetched ' + bus + "('"+object.key+"')"
                if (t.version) message += ' [' + t.version + ']'
                statelog(color, icon, message)
                return
            }

            color = red, icon = '•'
            if (t.to_fetch || pending_fetches[object.key]) {
                color = green
                icon = '^'
                message = add_diff_msg((t.m)||'Fetched '+bus+"('"+object.key+"')",
                                       object)
                if (t.version) message += ' [' + t.version + ']'
            }

            statelog(color, icon, message)
        }

        // Then we're gonna fire!

        // Recursively add all of object, and its sub-objects, into the cache
        var modified_keys = update_cache(object, cache)

        delete pending_fetches[object.key]

        if ((executing_funk !== global_funk) && executing_funk.loading()) {
            abort_changes(modified_keys)
        } else {
            // Let's publish these changes!

            // These objects must replace their backups
            update_cache(object, backup_cache)

            // And we mark each changed key as changed so that
            // reactions happen to them
            for (var i=0; i < modified_keys.length; i++) {
                var key = modified_keys[i]
                var parents = [versions[key]]   // Not stored yet
                versions[key] = t.version
                mark_changed(key, t)
            }
        }
    }

    save.abort = function (obj, t) {
        console.assert(obj)
        log('Abort:', obj.key)
        mark_changed(obj.key, t)
    }

    var version_count = 0
    function new_version () {
        return (bus.label||(id+' ')) + (version_count++).toString(36)
    }

    // Now create the statebus object
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
    bus.toString = function () { return bus.label || id }
    // bus.toString = function () { return (bus.label||'') + id }
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
    var versions = {}

    // Folds object into the cache recursively and returns the keys
    // for all mutated staet
    function update_cache (object, cache) {
        var modified_keys = new Set()
        function update_object (obj) {

            // Two ways to optimize this in future:
            //
            // 1. Only clone objects/arrays if they are new.
            // 
            //    Right now we re-clone all internal arrays and objects on
            //    each pub.  But we really only need to clone them the first
            //    time they are pubbed into the cache.  After that, we can
            //    trust that they aren't referenced elsewhere.  (We make it
            //    the programmer's responsibility to clone data if necessary
            //    on fetch, but not when on pub.)
            // 
            //    We'll optimize this once we have history.  We can look at
            //    the old version to see if an object/array existed already
            //    before cloning it.
            //
            // 2. Don't go infinitely deep.
            //
            //    Eventually, each save/pub will be limited to the scope
            //    underneath nested keyed objects.  Right now I'm just
            //    recursing infinitely on the whole data structure with each
            //    pub.

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
                if (cache !== backup_cache)
                    if (changed(obj))
                        modified_keys.add(obj.key)
                    else
                        log('Boring modified key', obj.key)
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
        return pending_fetches[object.key]
            || !(object.key in cache)
            || !(object.key in backup_cache)
            || !(deep_equals(object, backup_cache[object.key]))
    }
    function abort_changes (keys) {
        for (var i=0; i < keys.length; i++)
            update_cache(backup_cache[keys[i]], cache)
    }
        

    function forget (key, save_handler) {
        if (arguments.length === 0) {
            // Then we're forgetting the executing funk
            console.assert(executing_funk !== global_funk,
                           'forget() with no arguments forgets the currently executing reactive function.\nHowever, there is no currently executing reactive function.')
            executing_funk.forget()
            return
        }

        //log('forget:', key, funk_name(save_handler), funk_name(executing_funk))
        save_handler = save_handler || executing_funk
        var fkey = funk_key(save_handler)
        //console.log('Fetches in is', fetches_in.hash)
        if (!fetches_in.has(key, fkey)) {
            console.error("***\n****\nTrying to forget lost key", key,
                          'from', funk_name(save_handler), fkey,
                          "that hasn't fetched that key.",
                          funks[fetches_in.get(key)[0]],
                          funks[fetches_in.get(key)[0]] && funks[fetches_in.get(key)[0]].statebus_id
                         )
            console.trace()
            return
            // throw Error('asdfalsdkfajsdf')
        }

        fetches_in.delete(key, fkey)
        unbind(key, 'on_save', save_handler)

        // If this is the last handler listening to this key, then we can
        // delete the cache entry, send a forget upstream, and de-activate the
        // .on_fetch handler.
        if (!fetches_in.has_any(key)) {
            clearTimeout(to_be_forgotten[key])
            to_be_forgotten[key] = setTimeout(function () {
                // Send a forget upstream
                bus.route(key, 'to_forget', key)

                // Delete the cache entry...?
                // delete cache[key]
                delete fetches_out[key]
                delete to_be_forgotten[key]

                // Todo: deactivate any reactive .on_fetch handler, or
                // .on_save handler.
            }, 200)
        }
    }
    function del (key) {
        key = key.key || key   // Prolly disable this in future

        if ((executing_funk !== global_funk) && executing_funk.loading()) {
            abort_changes([key])
            return
        }

        delete cache[key]

        console.warn("Deleting " + key + "-- Statebus doesn't yet re-run functions subscribed to it, or update versions")

        // Todos:
        //
        // Right now we fire the to_delete handlers right here.
        //
        //  - Do we want to batch them up and fire them later?
        //    e.g. we could make a mark_deleted(key) like mark_changed(key)
        //
        //  - We might also record a new version of the state to show that
        //    it's been deleted, which we can use to cancel echoes from the
        //    sending bus.

        log('del:', key)
        bus.route(key, 'to_delete', key)
        //forget(key /*, bus??*/)
    }

    var changed_keys = new Set()
    var dirty_fetchers = new Set()
    function dirty (key) {
        // Marks a fetcher as dirty, meaning the .to_fetch will re-run
        statelog(brown, '*', bus + ".dirty('"+key+"')")
        if (key in fetches_out)
            dirty_fetchers.add(funk_key(fetches_out[key]))
        clean_timer = clean_timer || setTimeout(clean)
    }

    function mark_changed (key, t) {
        // Marks a key as dirty, meaning that functions on it need to update
        log('Marking changed', bus, key)
        changed_keys.add(key)
        clean_timer = clean_timer || setTimeout(clean)
    }

    function clean () {
        // 1. Collect all functions for all keys and dirtied fetchers
        var dirty_funks = new Set()
        for (var b in busses) {
            var fs = busses[b].rerunnable_funks()
            for (var i=0; i<fs.length; i++)
                dirty_funks.add(fs[i])
        }
        clean_timer = null

        // 2. Run any priority function first (e.g. file_store's on_save)
        dirty_funks = dirty_funks.values()
        log('Cleaning up', dirty_funks.length, 'funks')
        for (var i=0; i<dirty_funks.length; i++) {
            // console.log(funks[dirty_funks[i]].proxies_for)
            var p = funks[dirty_funks[i]].proxies_for
            if (p && p.priority) {
                log('Clean-early:', funk_name(funks[dirty_funks[i]]))
                funks[dirty_funks[i]].react()
                dirty_funks.splice(i,1)
                i--
            }
        }

        // 3. Re-run the functions
        for (var i=0; i<dirty_funks.length; i++) {
            log('Clean:', funk_name(funks[dirty_funks[i]]))
            funks[dirty_funks[i]].react()
        }
        // log('We just cleaned up', dirty_funks.length, 'funks!')
    }

    function rerunnable_funks () {
        var result = []
        var keys = changed_keys.values()
        var fetchers = dirty_fetchers.values()

        //log(bus+' Cleaning up!', keys, 'keys, and', fetchers.length, 'fetchers')
        for (var i=0; i<keys.length; i++) {          // Collect all keys
            var fs = bindings(keys[i], 'on_save')
            for (var j=0; j<fs.length; j++) {
                var f = fs[j].func
                if (f.react) {
                    // Skip if it's already up to date
                    var v = f.fetched_keys[JSON.stringify([this.id, keys[i]])]
                    //log('re-run:', keys[i], f.statebus_id, f.fetched_keys)
                    if (v && v === versions[keys[i]]) {
                        log('skipping', funk_name(f), 'already at version', v)
                        continue
                    }
                } else {
                    // Fresh handlers are always run, but need a wrapper
                    f.seen_keys = f.seen_keys || {}
                    var v = f.seen_keys[JSON.stringify([this.id, keys[i]])]
                    if (v && v === versions[keys[i]]) {
                        //log('skipping', funk_name(f), 'already at version', v)
                        continue
                    }
                    autodetect_args(f)
                    f = run_handler(f, 'on_save', cache[keys[i]], {dont_run: true,
                                                                   binding: keys[i]})
                }
                result.push(funk_key(f))
            }
        }
        for (var i=0; i<fetchers.length; i++)        // Collect all fetchers
            result.push(fetchers[i])

        changed_keys.clear()
        dirty_fetchers.clear()

        //log('found', result.length, 'funks to re run')

        return result
    }

    // ****************
    // Connections
    function subspace (key) {
        var result = {}
        for (method in {to_fetch:null, to_save:null, on_save:null,
                        to_delete:null, to_forget:null})
            (function (method) {
                Object.defineProperty(result, method, {
                    set: function (func) {
                        autodetect_args(func)
                        func.defined = func.defined || []
                        func.defined.push(
                            {as:'handler', bus:bus, method:method, key:key})
                        bind(key, method, func)
                    },
                    get: function () {
                        var result = bindings(key, method)
                        for (var i=0; i<result.length; i++) result[i] = result[i].func
                        result.delete = function (func) { unbind (key, method, func) }
                        return result
                    }
                })
            })(method)
        return result
    }

    function autodetect_args (handler) {
        if (handler.args) return

        // Get an array of the handler's params
        var comments = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg,
            params = /([^\s,]+)/g,
            s = handler.toString().replace(comments, '')
        params = s.slice(s.indexOf('(')+1, s.indexOf(')')).match(params) || []
        
        handler.args = {}
        for (var i=0; i<params.length; i++)
            switch (params[i]) {
            case 'key':
            case 'k':
                handler.args['key'] = i; break
            case 'vars':
                handler.args['vars'] = i; break
            case 'star':
            case 'rest':
                handler.args['rest'] = i; break
            case 't':
            case 'transaction':
                handler.args['t'] = i; break
            case 'o':
            case 'obj':
            case 'val':
                handler.args['obj'] = i; break
            case 'old':
                handler.args['old'] = i; break
            }
    }

    // The funks attached to each key, maps e.g. 'fetch /point/3' to '/30'
    var handlers = new One_To_Many()
    var wildcard_handlers = []  // An array of {prefix, method, funk}

    // A set of timers, for keys to send forgets on
    var to_be_forgotten = {}
    function bind (key, method, func) {
        if (key[key.length-1] !== '*')
            handlers.add(method + ' ' + key, funk_key(func))
        else
            wildcard_handlers.push({prefix: key,
                                    method: method,
                                    funk: func})

        // Now check if the method is a fetch and there's a fetched
        // key in this space, and if so call the handler.
    }
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
            console.error('Error:', key, 'is not a string', method)
            console.trace()
        }

        //console.log('bindings:', key, method)
        var result = []
        var seen = {}

        // First get the exact key matches
        var exacts = handlers.get(method + ' ' + key)
        for (var i=0; i < exacts.length; i++) {
            var f = funks[exacts[i]]
            if (!seen[funk_key(f)]) {
                f.statebus_binding = {key:key, method:method}
                result.push({method:method, key:key, func:f})
                seen[funk_key(f)] = true
            }
        }

        // Now iterate through prefixes
        for (var i=0; i < wildcard_handlers.length; i++) {
            handler = wildcard_handlers[i]

            var prefix = handler.prefix.slice(0, -1)       // Cut off the *
            if (prefix === key.substr(0,prefix.length)     // If the prefix matches
                && method === handler.method               // And it has the right method
                && !seen[funk_key(handler.funk)]) {
                handler.funk.statebus_binding = {key:handler.prefix, method:method}
                result.push({method:method, key:handler.prefix, func:handler.funk})
                seen[funk_key(handler.funk)] = true
            }
        }

        return result
    }

    /* Regular expressions might be more efficient.
    function bind_re () {
        var r=''
        for (var i=arguments.length-1; i>=0; i--) {
            var s = (typeof arguments[i] == 'string' ? arguments[i] : arguments[i].source);
            r += i==arguments.length-1 ? ('('+s+')') : ('|('+s+')')
        }
        return new RegExp(r)
    }
    function bindings_re (key, method) {
    }
    */

    function run_handler(funck, method, arg, options) {
        options = options || {}
        var t = options.t,
            just_make_it = options.dont_run,
            binding = options.binding
        // console.log("run_handler: ('"+(arg.key||arg)+"').on_"
        //             +method+' = f^'+funk_key(funck))
        // if (funck.statebus_name === undefined || funck.statebus_name === 'undefined')
        //     console.log('WEIRDO FUNCK', funck, typeof funck.statebus_name)

        // When we first run a handler (e.g. a fetch or save), we wrap it in a
        // reactive() funk that calls it with its arg.  Then if it fetches or
        // saves, it'll register a .on_save handler with this funk.

        // Is it reactive already?  Let's distinguish it.
        var funk = funck.react && funck,  // Funky!  So reactive!
            func = !funk && funck         // Just a function, waiting for a rapper to show it the funk.

        console.assert(funk || func)

        if (false && !funck.global_funk) {
            // \u26A1
            var event = {'to_save':'save','on_save':'save.fire','to_fetch':'fetch',
                         'to_delete':'delete','to_forget':'forget'}[method],
                triggering = funk ? 're-running' : 'initiating'
            console.log('   > a', bus+'.'+event + "('" + (arg.key||arg) + "') is " + triggering
                +'\n     ' + funk_name(funck))
        }

        //console.log('     run_handler:  funk', funk_name(funk))

        if (funk) {
            // Then this is an on_save event re-triggering an already-wrapped
            // funk.  It has its own arg internally that it's calling itself
            // with.  Let's tell it to re-trigger itself with that arg.

            console.assert(method === 'on_save')
            return funk.react()

            // This might not work that great.
            // Ex:
            //
            //    bus('foo').on_save = function (o) {...}
            //    save({key: 'foo'})
            //    save({key: 'foo'})
            //    save({key: 'foo'})
            //
            // Does this spin up 3 reactive functions?  I think so.
            // No, I think it does, but they all get forgotten once
            // they run once, and then are garbage collected.
            //
            //    bus('foo*').on_save = function (o) {...}
            //    save({key: 'foo1'})
            //    save({key: 'foo2'})
            //    save({key: 'foo1'})
            //    save({key: 'foo3'})
            //
            // Does this work ok?  Yeah, I think so.
        }

        // Alright then.  Let's wrap this func with some funk.

        // Fresh fetch/save/forget/delete handlers will just be regular
        // functions.  We'll store their arg and let them re-run until they
        // are done re-running.
        function key_arg () { return ((typeof arg.key) == 'string') ? arg.key : key }
        function rest_arg () { return (key_arg()).substr(binding.length-1) }
        function vars_arg () {
            var r = rest_arg()
            try {
                return JSON.parse(r)
            } catch (e) {
                return 'Bad JSON "' + r + '" for key ' + key_arg()
            }
        }
        var f = reactive(function () {
            // Then in run_handler, we'll call it with:
            var args = []
            args[0] = arg
            args[1] = t
            //console.log('This funcs args are', func.args)
            for (var k in func.args) {
                switch (k) {
                case 'key':
                    args[func.args[k]] = key_arg(); break
                case 'rest':
                    args[func.args[k]] = rest_arg(); break
                case 'vars':
                    args[func.args[k]] = vars_arg();
                    //console.log('We just made an arg', args[func.args[k]], 'in slot', func.args[k], 'for', k)
                    break
                case 't':
                    args[func.args[k]] = t; break
                case 'obj':
                    args[func.args[k]] = arg.key ? arg : bus.cache[arg]; break
                case 'old':
                    args[func.args[k]] = bus.cache[key_arg()]; break
                }
                //console.log('processed', k, 'at slot', func.args[k], 'to make', args[func.args[k]])
            }
            //console.log('args is', args)

            var result = func.apply(null, args)

            // We will wanna add in the fancy arg stuff here, with:
            // arr = []
            // for (var k of func.args || {})
            //    arr[func.args[k]] = <compute_blah(k)>


            // For fetch
            if (method === 'to_fetch' && result instanceof Object
                && !f.loading()     // Experimental.
               ) {
                result.key = arg
                var new_t = clone(t || {})
                new_t.to_fetch = true
                save.fire(result, new_t)
                return result
            }

            // Save, forget and delete handlers stop re-running once they've
            // completed without anything loading.
            // ... with f.forget()
            if (method !== 'to_fetch' && !f.loading())
                f.forget()
        })
        f.proxies_for = func
        f.arg = arg

        // on_fetch handlers stop re-running when the key is forgotten
        if (method === 'to_fetch') {
            var key = arg
            function handler_done () {
                f.forget()
                unbind(key, 'to_forget', handler_done)
            }
            bind(key, 'to_forget', handler_done)

            // Check if it's doubled-up
            if (fetches_out[key])
                console.error('Two .to_fetch functions are running on the same key',
                              key+'!', funk_name(funck), funk_name(fetches_out[key]))
            
            fetches_out[arg] = f       // Record active to_fetch handler
            pending_fetches[arg] = f   // Record that the fetch is pending
        }

        if (just_make_it)
            return f
        
        return f()
    }

    // route() can be overridden
    bus.route = function (key, method, arg, t) {
        var handlers = bus.bindings(key, method)
        if (handlers.length)
            log('route:', bus+'("'+key+'").'+method+'['+handlers.length+'](key:"'+(arg.key||arg)+'")')
        // log('route: got bindings',
        //     funcs.map(function (f) {return funk_key(f)+':'+funk_keyr(f)}))
        for (var i=0; i<handlers.length; i++)
            bus.run_handler(handlers[i].func, method, arg, {t: t, binding: handlers[i].key})

        if (method === 'to_fetch')
            console.assert(handlers.length<2,
                           'Two to_fetch functions are registered for the same key '+key,
                           handlers)
        return handlers.length
    }


    // ****************
    // Reactive functions
    // 
    // We wrap any function with a reactive wrapper that re-calls it whenever
    // state it's fetched changes.

    if (!global_funk) {
        global_funk = reactive(function global_funk () {})
        global_funk.global_funk = true
        executing_funk = global_funk
        funks[global_funk.statebus_id = 'global funk'] = global_funk
    }

    function reactive(func) {
        // You can call a funk directly:
        //
        //    f = reactive(func)
        //    f(arg1, arg2)
        //
        // This will remember every fetch it depends on, and make it re-call
        // itself whenever that state changes.  It will remember arg1 and arg2
        // and use those again.  You can also trigger a re-action manually
        // with:
        //
        //    funk.react().
        //
        // ...which will make it re-run with the original arg1 and arg2 .
        function funk () {
            console.assert(executing_funk === global_funk
                           || executing_funk !== funk, 'Recursive funk', funk.func)

            if (funk.called_directly)
                funk.this = this, funk.args = arguments

            // Forget the keys from last time
            funk.forget()

            // Now let's run it
            var last_executing_funk = executing_funk
            executing_funk = funk
            try {
                var result = func.apply(funk.this, funk.args)
            } catch (e) {
                if (e.message === 'Maximum call stack size exceeded') {
                    console.error(e)
                    process.exit()
                }
                //executing_funk = null // Or should this be last_executing_funk?
                if (funk.loading()) return null
                else {
                    // If we ware on node, then just print out the error
                    if (nodejs) {
                        console.error(e.stack)
                        process.exit()
                    } else {
                        // This is the best way to print errors in browsers,
                        // so that they get clickable line numbers
                        var result = func.apply(funk.this, funk.args)
                        // If code reaches here, there was an error triggering
                        // the error.  We should warn the programmer, and then
                        // probably move on, because maybe the error went
                        // away... and it doesn't do us any good to just crash
                        // now, does it?  Then the programmer has less
                        // information on what happened because he/she can't
                        // see it in the result, which might also be fucked
                        // up, and might be informative.
                        console.error('Non-deterministic Error!', e.stack || e)
                        console.warn("A non-deterministic error is when your reactive function triggers an error only some of the times it's called.\nThe error originated from calling:", funk_name(func, 400))
                    }
                }
            } finally {
                executing_funk = last_executing_funk
            }
            return result
        }

        funk.func = func  // just for debugging
        funk.called_directly = true
        funk.fetched_keys = {} // maps [bus,key] to version
                               // version will be undefined until loaded
        funk.abortable_keys = []
        funk.has_seen = function (bus, key, version) {
            //console.log('depend:', bus, key, versions[key])
            this.fetched_keys[JSON.stringify([bus.id, key])] = version
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
            // Todo: This will bug out if an .on_save handler for a key also
            // fetches that key once, and then doesn't fetch it again, because
            // when it fetches the key, that key will end up being a
            // fetched_key, and will then be forgotten as soon as the funk is
            // re-run, and doesn't fetch it again, and the fact that it is
            // defined as an .on_save .on_save handler won't matter anymore.

            if (funk.statebus_id === 'global funk') return

            for (hash in funk.fetched_keys) {
                var tmp = JSON.parse(hash),
                    bus = busses[tmp[0]], key = tmp[1]
                if (bus)  // Cause it might have been deleted
                    bus.forget(key, funk)
            }
            funk.fetched_keys = {}
        }
        funk.loading = function () {
            for (hash in funk.fetched_keys) {
                var tmp = JSON.parse(hash),
                    bus = busses[tmp[0]], key = tmp[1]
                if (bus  // Cause it might have been deleted
                    && bus.pending_fetches[key])
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

    bus.default = function () {
        bus.deep_map(arguments, function (o) {
            if (o.key && !(o.key in bus.cache))
                bus.cache[o.key] = o
            return o
        })
    }

    function deep_map (object, func) {
        object = func(object)

        // Recurse through each element in arrays
        if (Array.isArray(object))
            for (var i=0; i < object.length; i++)
                object[i] = deep_map(object[i], func)

        // Recurse through each property on objects
        else if (typeof object === 'object')
            for (var k in object)
                object[k] = deep_map(object[k], func)

        return object
    }

    function translate_keys (obj, f) {
        // Recurse through each element in arrays
        if (Array.isArray(obj))
            for (var i=0; i < obj.length; i++)
                translate_keys(obj[i], f)

        // Recurse through each property on objects
        else if (typeof obj === 'object')
            for (var k in obj) {
                if (k === 'key' || /.*_key$/.test(k))
                    obj[k] = f(obj[k])
                else if (/.*_keys$/.test(k))
                    for (var i=0; i < obj[k].length; i++) {
                        if (typeof obj[k][i] === 'string')
                            obj[k][i] = f(obj[k][i])
                    }
                translate_keys(obj[k], f)
            }
        return obj
    }
    function escape_key(k) {
        return k.replace(/(_(keys?|time)?$|^key$)/, '$1_')
    }
    function unescape_key (k) {
        return k.replace(/(_$)/, '')
    }
    // function escape_obj (o) {
    //     var result = {}
    //     for (k in o)
    //         result[escape_key(k)] = escape_obj(o[k])
    //     return result
    // }
    // function unescape_obj (o) {
    // }
    // // Assumes there are no pointers
    // function hash (o) {
    //     var data = escape_obj(o)

    //     return {
    //         get: function (k) {
    //             return unescape_obj(data[k])
    //         },
    //         set: function (k, v) {
    //             data[escape_key(k)] = v
    //         }
    //     }
    // }

    function sb () {
        // I have the cache behind the scenes
        // Each proxy has a target object -- the raw data on cache
        // If we're proxying a {_: ...} singleton then ...

        // function empty_obj (o) {
        //     if (typeof o !== 'object' || o === null) return false
        //     for (k in o)
        //         if (k !== 'key') return false
        //     return true
        // }
        function item_proxy (base, o) {
            if (typeof o !== 'object' && o !== null) return o

            return new Proxy(o, {
                get: function get(o, k) {
                    if (k === 'inspect' || k === 'valueOf' || typeof k === 'symbol')
                        return undefined
                    k = escape_key(k)
                    return item_proxy(base, o[k])
                },
                set: function set(o, k, v) {
                    var result = o[escape_key(k)] = v
                    bus.save(base)
                    return result
                },
                has: function has(o, k) {
                    return escape_key(k) in o
                },
                deleteProperty: function del (o, k) {
                    delete o[escape_key(k)]
                },
                apply: function apply (o, This, args) {
                    return o
                }
            })}

        return new Proxy(bus.cache, {
            get: function get(o, k) {
                if (k === 'inspect' || k === 'valueOf' || typeof k === 'symbol')
                    return undefined
                var raw = bus.fetch(k),
                    obj = raw
                while (typeof obj == 'object' && '_' in obj) obj = obj._
                return item_proxy(raw, obj)
            },
            set: function set(o, k, v) {
                if (typeof v === 'number'
                    || typeof v === 'string'
                    || v === undefined
                    || v === null
                    || typeof v === 'function'
                    || Array.isArray(v))
                    v = {_:v}
                else
                    v = bus.clone(v)
                v.key = k
                bus.save(v)
            },
            // In future, this might check if there's a .to_fetch function OR
            // something in the cache:
            // 
            // has: function has(o, k) {
            //     return k in o
            // },
            // ... but I haven't had a need yet.
            deleteProperty: function del (o, k) {
                bus.delete(escape_key(k))
            }
        })
    }

    if ((nodejs?global:window).Proxy)
        Object.defineProperty(bus, 'sb', { get: sb })
    else
        bus.sb = "Your javascript doesn't support ES6 Proxy"

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
        this.has = function (k, v) { return hash[k] && hash[k][v] }
        this.has_any = function (k) { return counts[k] }
        this.del = this.delete // for compatibility; remove this soon
    }
    function Set () {
        var hash = {}
        this.add = function (a) { hash[a] = true }
        this.has = function (a) { return a in hash }
        this.values = function () { return Object.keys(hash) }
        this.delete = function (a) { delete hash[a] }
        this.clear = function () { hash = {} }
        this.del = this.delete // for compatibility; remove this soon
        this.all = this.values // for compatibility; remove this soon
    }
    //Set = window.Set || Set
    // function clone(obj) {
    //     if (obj == null) return obj
    //     var copy = obj.constructor()
    //     for (var attr in obj)
    //         if (obj.hasOwnProperty(attr)) copy[attr] = obj[attr]
    //     return copy
    // }
    function clone(item) {
        if (!item               // null, undefined values check
            || item instanceof Number
            || item instanceof String
            || item instanceof Boolean)
            return item

        if (Array.isArray(item)) {
            item = item.slice()
            for (var i=0; i<item.length; i++)
                item[i] = clone(item[i])
            return item
        }
        
        if (typeof item == "object") {
            // Is it DOM
            if (item.nodeType && typeof item.cloneNode == "function")
                return item.cloneNode(true)

            if (item instanceof Date)
                return new Date(item)
            else {
                var result = {}
                for (var i in item) result[i] = clone(item[i])
                return result
            }
        }

        // Give up on everything else...
        return item
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
                // And because isNaN(undefined) returns true:
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
    function sorta_diff(a, b) {
        // Equal Primitives?
        if (a === b
            // But because NaN === NaN returns false:
            || (isNaN(a) && isNaN(b)
                // And because isNaN(undefined) returns true:
                && typeof a === 'number' && typeof b === 'number'))
            return null

        // Equal Arrays?
        var a_array = Array.isArray(a), b_array = Array.isArray(b)
        if (a_array !== b_array) return ' = ' + JSON.stringify(b)
        if (a_array) {
            //if (a.length !== b.length) return ' = ' + JSON.stringify(b)
            if (a.length === b.length-1
                && !deep_equals(a[a.length], b[b.length])) {
                return '.push(' +JSON.stringify(b[b.length]) + ')'
            }
            for (var i=0; i < a.length; i++) {
                var tmp = sorta_diff (a[i], b[i])
                if (tmp)
                    return '['+i+'] = '+tmp
            }
            return null
        }

        // Equal Objects?
        var a_obj = a && typeof a === 'object',  // Note: typeof null === 'object'
            b_obj = b && typeof b === 'object'
        if (a_obj !== b_obj) return ' = ' + JSON.stringify(b)
        if (a_obj) {
            for (var k in a) {
                var tmp = sorta_diff(a[k], b[k])
                if (tmp)
                    return '.' + k + tmp
            }
            for (var k in b) {
                if (!(k in a))
                    return '.' + k +' = '+JSON.stringify(b[k])
            }
            return null
        }

        // Then Not Equal.
        return ' = ' + JSON.stringify(b)
    }

    function validate (obj, schema) {
        var optional = false
        if (schema === '*') return true
        if (obj === schema) return true

        if (typeof obj === 'string')
            return schema === 'string'
        if (typeof obj === 'number')
            return schema === 'number'
        if (typeof obj === 'boolean')
            return schema === 'boolean'

        if (Array.isArray(obj))
            return schema === 'array'

        if (typeof obj === 'object') {
            if (schema === 'object')
                return true

            if (typeof schema === 'object') {
                for (var k in obj) {
                    var sk
                    if (k in schema)
                        sk = k
                    else if ('?'+k in schema)
                        sk = '?'+k
                    else return false

                    if (!validate(obj[k], schema[sk]))
                        return false
                }
                for (var k in schema)
                    if (k[0] !== '?')
                        if (!(k in obj))
                            return false

                return true
            }

            return false
        }

        throw "You hit a Statebus bug!"
    }

    function key_id(string) { return string.match(/\/?[^\/]+\/(\d+)/)[1] }
    function key_name(string) { return string.match(/\/?([^\/]+).*/)[1] }
    function funk_key (funk) {
        if (!funk.statebus_id) {
            funk.statebus_id = Math.random().toString(36).substring(7)
            funks[funk.statebus_id] = funk
        }
        return funk.statebus_id
    }
    function funk_keyr (funk) {
        while (funk.proxies_for) funk = funk.proxies_for
        return funk_key(funk)
    }
    function funk_name (f, char_limit) {
        char_limit = char_limit || 30

        // if (f.react)
        //     var arg = JSON.stringify((f.args && f.args[0] && (f.args[0].key || f.args[0])) || '').substring(0.30)
        // else
        //     var arg = ''
        var arg = f.react ? (f.args && f.args[0]) : ''
        arg = f.react ? (JSON.stringify(f.arg)||'').substring(0,30) : ''
        f = f.proxies_for || f
        var f_string = 'function ' + (f.name||'') + '(' + (arg||'') + ') {..}'
        // Or: f.toString().substr(0,char_limit) + '...'

        if (!f.defined) return f_string
        if (f.defined.length > 1) return '**' + f_string + '**'

        var def = f.defined[0]
        switch (def.as) {
        case 'handler':
            return def.bus+"('"+def.key+"')."+def.method+' = '+f_string
        case 'fetch callback':
                return 'fetch('+def.key+', '+f_string+')'
        case 'reactive':
            return "reactive('"+f_string+"')"
        default:
            return 'UNKNOWN Funky Definition!!!... ???'
        }
    }

    function funk_name2 (f, char_limit) {
        char_limit = char_limit || 30

        var arg = f.react ? (f.args && f.args[0]) : ''
        arg = f.react ? (JSON.stringify(f.arg)||'').substring(0,30) : ''
        f = f.proxies_for || f
        var f_string = 'function ' + (f.name||'') + '(' + (arg||'') + ') {..}'
        // Or: f.toString().substr(0,char_limit) + '...'

        if (!f.defined) return f_string

        var result = ''
        if (f.defined.length > 1) result += '['
        for (var i=0; i<f.defined.length; i++) {
            var def = f.defined[i]
            switch (def.as) {
            case 'handler':
                result += def.bus+"('"+def.key+"')."+def.method+' = '+f_string; break
            case 'fetch callback':
                result += 'fetch('+def.key+', '+f_string+')'; break
                result += "the callback for fetch('"+def.key+"', "+f_string+')'; break
            case 'reactive':
                result += "reactive('"+f_string+"')"; break
            default:
                result += 'UNKNOWN Funky Definition!!!... ???'; break
            }
            if (i+1 < f.defined.length) result += ', '
        }
        if (f.defined.length > 1) result += ']'
        return result
    }
    function deps (key) {
        // First print out everything waiting for it to pub
        var result = 'Deps: ('+key+') fires into:'
        var pubbers = bindings(key, 'on_save')
        if (pubbers.length === 0) result += ' nothing'
        for (var i=0; i<pubbers.length; i++)
            result += '\n  ' + funk_name(pubbers[i].func)
        return result
    }

    function log () {
        if (bus.honk !== true) return
        if (nodejs) {
            var indent = ''
            for (var i=0; i<statelog_indent; i++) indent += '   '
            console.log(indent+require('util').format.apply(null,arguments).replace(/\n/g,'\n'+indent))
        } else
            console.log.apply(console, arguments)
    }

    function statelog (color, icon, message) {
        var old_honk = bus.honk
        if (bus.honk) bus.honk = true
        log(color + icon + ' ' + message + normal)
        //log.apply(null, arguments)
        bus.honk = old_honk
    }

    function kp () {
        log('changed_keys:', changed_keys.values())
    }

    // #######################################
    // ########### Browser Code ##############
    // #######################################

    // Make these private methods accessible
    var api = ['cache backup_cache fetch save forget del fire dirty',
               'subspace bindings run_handler bind unbind reactive',
               'versions new_version',
               'funk_key funk_name funks key_id key_name id kp',
               'pending_fetches fetches_in loading_keys loading',
               'global_funk busses rerunnable_funks',
               'escape_key unescape_key translate_keys',
               'Set One_To_Many clone extend deep_map deep_equals validate sorta_diff log deps'
              ].join(' ').split(' ')
    for (var i=0; i<api.length; i++)
        bus[api[i]] = eval(api[i])

    bus.delete = bus.del
    bus.executing_funk = function () {return executing_funk}

    // Export globals
    if (Object.keys(busses).length === 0) {
        var globals = 'fetch save del forget loading clone'.split(' ')
        for (var i=0; i<globals.length; i++)
            this[globals[i]] = eval(globals[i])
    }
    busses[bus.id] = bus
    return bus
}}))
