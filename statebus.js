// These 5 lines generate a module that can be included with CommonJS, AMD, and <script> tags.
(function(name, definition) {
    if (typeof module != 'undefined') module.exports = definition()
    else if (typeof define == 'function' && typeof define.amd == 'object') define(definition)
    else this[name] = definition()
}('statebus', function() {statelog_indent = 0; var busses = {}, bus_count = 0, executing_funk, global_funk, funks = {}, clean_timer, symbols, nodejs = typeof window === 'undefined'; function make_bus (options) {


    // ****************
    // Get, Set, Forget, Delete

    function get (key, callback) {
        if (typeof key !== 'string'
            && !(typeof key === 'object' && typeof key.key === 'string'))
            throw ('Error: get(key) called with key = '
                   + JSON.stringify(key))
        key = key.key || key  // You can pass in an object instead of key
                              // We should probably disable this in future
        bogus_check(key)

        var called_from_reactive_funk = !callback
        var funk = callback || executing_funk

        // Initialize callback
        if (callback) {
            (callback.defined = callback.defined || []
            ).push({as:'get callback', key:key});
            callback.has_seen = callback.has_seen || function (bus, key, version) {
                callback.seen_keys = callback.seen_keys || {}
                var bus_key = JSON.stringify([bus.id, key])
                var seen_versions =
                    callback.seen_keys[bus_key] = callback.seen_keys[bus_key] || []
                seen_versions.push(version)
                if (seen_versions.length > 50) seen_versions.shift()
            }
        }

        // ** Subscribe the calling funk **

        gets_in.add(key, funk_key(funk))
        if (to_be_forgotten[key]) {
            clearTimeout(to_be_forgotten[key])
            delete to_be_forgotten[key]
        }

        bind(key, 'on_set', funk)

        // ** Call getters upstream **

        // TODO: checking gets_out[] doesn't count keys that we got which
        // arrived nested within a bigger object, because we never explicity
        // got those keys.  But we don't need to get them now cause we
        // already have them.
        var getterters = 0
        if (!gets_out[key])
            getterters = bus.route(key, 'getter', key)

        // Now there might be a new value pubbed onto this bus.
        // Or there might be a pending get.
        // ... or there weren't any getters upstream.


        // ** Return a value **

        // If called reactively, we always return a value.
        if (called_from_reactive_funk) {
            funk.has_seen(bus, key, versions[key])
            backup_cache[key] = backup_cache[key] || {key: key}
            return cache[key] = cache[key] || {key: key}
        }

        // Otherwise, we want to make sure that a pub gets called on the
        // handler.  If there's a pending get, then it'll get called later.
        // If there was a getter, then it already got called.  Otherwise,
        // let's call it now.
        else if (!pending_gets[key] && getterters === 0) {
            // TODO: my intuition suggests that we might prefer to delay this
            // .on_set getting called in a setTimeout(f,0), to be consistent
            // with other calls to .on_set.
            backup_cache[key] = backup_cache[key] || {key: key}
            run_handler(funk, 'on_set', cache[key] = cache[key] || {key: key})
        }
    }
    function get_once (key, cb) {
        function cb2 (o) { cb(o); forget(key, cb2) }
        // get(key)   // This prevents key from being forgotten
        get(key, cb2)
    }
    get.once = get_once
    var pending_gets = {}
    var gets_out = {}                // Maps `key' to `func' iff we've got `key'
    var gets_in = new One_To_Many()  // Maps `key' to `pub_funcs' subscribed to our key

    var currently_saving

    // Two forms:
    //  - set(obj, t)  with snapshot
    //  - set(key, t)  with patches
    function set (obj, t) {
        // First let's handle patches.  We receive them as:
        //
        //     set("foo", {patches: [{...}, ...]})
        //
        // Note the `obj` will actually be a string, set to the key in this case.
        //
        if (typeof obj === 'string' && t && t.patches) {
            if (!Array.isArray(t.patches)) t.patches = [t.patches]
            // Apply the patch locally
            var key = obj,
                obj = bus.cache[key]

            // console.log('set: applying the patches!', {
            //     key: key,
            //     obj: obj,
            //     patches: t.patches[0]
            // })
            obj.val = apply_patch(obj.val, t.patches[0])
        }

        if (!('key' in obj) || typeof obj.key !== 'string') {
            console.error('Error: set(obj) called on object without a key: ', obj)
            console.trace('Bad set(obj)')
        }
        bogus_check(obj.key)

        t = t || {}
        // Make sure it has a version.
        t.version = t.version || new_version()

        if ((executing_funk !== global_funk) && executing_funk.loading()) {
            abort_changes([obj.key])
            return
        }

        if (honking_at(obj.key))
            var message = set_msg(obj, t, 'set')

        // Ignore if nothing happened
        if (obj.key && !changed(obj)) {
            statelog(obj.key, grey, 'x', message)
            return
        } else
            statelog(obj.key, red, 'o', message)

        try {
            statelog_indent++
            var was_saving = currently_saving
            currently_saving = obj.key

            // Call the setter() handlers!
            var num_handlers = bus.route(obj.key, 'setter', obj, t)
            if (num_handlers === 0) {
                // And fire if there weren't any!
                set.fire(obj, t)
                bus.route(obj.key, 'on_set_sync', obj, t)
            }
        }
        finally {
            statelog_indent--
            currently_saving = was_saving
        }
        // TODO: Here's an alternative.  Instead of counting the handlers and
        // seeing if there are zero, I could just make a setter handler that
        // is shadowed by other handlers if I can get later handlers to shadow
        // earlier ones.
    }

    // set.sync() will set with the version of the current executing reaction
    set.sync = function set_sync (obj, t) {
        t = bus.clone(t || {})
        // t.version: executing_funk?.transaction?.version
        //          || executing_funk?.latest_reaction_at
        t.version = ((executing_funk
                      && executing_funk.transaction
                      && executing_funk.transaction.version)
                     || (executing_funk
                         && executing_funk.latest_reaction_at))
        set(obj, t)
    }

    // We might eventually want a set.fire.sync() too, which defaults the
    // version to `executing_funk?.transaction?.version`

    set.fire = fire
    function fire (obj, t) {
        t = t || {}

        // Make sure it has a version.
        t.version = t.version
            || executing_funk && executing_funk.latest_reaction_at
            || new_version()

        // Handle patches.  We receive them as:
        //
        //     set.fire("foo", {patches: [{...}, ...]})
        //
        // Note the `obj` will actually be a string, set to the key in this case.
        //
        if (typeof obj === 'string' && t && t.patch) {
            if (!Array.isArray(t.patches)) t.patches = [t.patches]
            // Apply the patches locally
            var key = obj,
                obj = bus.cache[key]

            // console.log('set.fire: applying the patches!', {
            //     key: key,
            //     obj: obj,
            //     patch: t.patches[0]
            // })
            obj.val = apply_patch(obj.val, t.patches[0])
        }

        // Print a statelog entry
        if (obj.key && honking_at(obj.key)) {
            // Warning: Changes to *nested* objects will *not* be printed out!
            // In the future, we'll remove the recursion from fire() so that
            // nested objects aren't even changed.
            var message = set_msg(obj, t, 'set.fire')
            var color, icon
            if (currently_saving === obj.key &&
                !(obj.key && !changed(obj))) {
                statelog_indent--
                statelog(obj.key, red, '•', '↵' +
                         (t.version ? '\t\t\t[' + t.version + ']' : ''))
                statelog_indent++
            } else {
                // Ignore if nothing happened
                if (obj.key && !changed(obj)) {
                    color = grey
                    icon = 'x'
                    if (t.getter)
                        message = (t.m) || 'Got ' + bus + "('"+obj.key+"')"
                    if (t.version) message += ' [' + t.version + ']'
                    statelog(obj.key, color, icon, message)
                    return
                }

                color = red, icon = '•'
                if (t.getter || pending_gets[obj.key]) {
                    color = green
                    icon = '^'
                    message = add_diff_msg((t.m)||'Got '+bus+"('"+obj.key+"')",
                                           obj)
                    if (t.version) message += ' [' + t.version + ']'
                }

                statelog(obj.key, color, icon, message)
            }
        }
        // Then we're gonna fire!

        // Recursively add all of obj, and its sub-objects, into the cache
        var modified_keys = update_cache(obj, cache)

        delete pending_gets[obj.key]

        if ((executing_funk !== global_funk) && executing_funk.loading()) {
            abort_changes(modified_keys)
        } else {
            // Let's publish these changes!

            // These objects must replace their backups
            update_cache(obj, backup_cache)

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

    set.abort = function (obj, t) {
        if (!obj) console.error('No obj', obj)
        abort_changes([obj.key])
        statelog(obj.key, yellow, '<', 'Aborting ' + obj.key)
        mark_changed(obj.key, t)
    }

    var version_count = 0
    function new_version () {
        return (bus.label||(id+' ')) + (version_count++).toString(36)
    }

    // Now create the statebus object
    function bus (arg1, arg2) {
        // Called with a function to react to
        if (typeof arg1 === 'function') {
            var f = reactive(arg1)
            f()
            return f
        }

        // Called with a key to produce a subspace.
        // We currently have two forms:
        //
        //    old_subspace('foo').to_get = ... // etc.
        //
        //    new_subspace('foo', {get: ...})  // etc
        //
        else if (arg2 === undefined)
            return old_subspace(arg1)
        else
            return new_subspace(arg1, arg2)
    }
    var id = 'bus-' + Math.random().toString(36).substring(7)
    bus.toString = function () { return bus.label || 'bus'+this_bus_num || id }
    bus.delete_bus = function () {
        // // Forget all pattern handlers
        // for (var i=0; i<pattern_handlers.length; i++) {
        //     console.log('Forgetting', funk_name(pattern_handlers[i].funk))
        //     pattern_handlers[i].funk.forget()
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
            //    on get, but not when on pub.)
            //
            //    We'll optimize this once we have history.  We can look at
            //    the old version to see if an object/array existed already
            //    before cloning it.
            //
            // 2. Don't go infinitely deep.
            //
            //    Eventually, each set/pub will be limited to the scope
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

            // Inline pointers
            if ((nodejs ? global : window).pointerify && obj && obj._key) {
                if (Object.keys(obj).length > 1)
                    console.error('Got a {_key: ...} object with additional fields')
                obj = bus.cache[obj._key] = bus.cache[obj._key] || {key: obj._key}
            }

            // Fold cacheable objects into cache
            else if (obj && obj.key) {
                bogus_check(obj.key)

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
                        if (!obj.hasOwnProperty(k))
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
        return pending_gets[object.key]
            || !       cache.hasOwnProperty(object.key)
            || !backup_cache.hasOwnProperty(object.key)
            || !(deep_equals(object, backup_cache[object.key]))
    }
    function abort_changes (keys) {
        for (var i=0; i < keys.length; i++)
            update_cache(backup_cache[keys[i]], cache)
    }


    function forget (key, set_handler, t) {
        if (arguments.length === 0) {
            // Then we're forgetting the executing funk
            console.assert(executing_funk !== global_funk,
                           'forget() with no arguments forgets the currently executing reactive function.\nHowever, there is no currently executing reactive function.')
            executing_funk.forget()
            return
        }
        bogus_check(key)

        //log('forget:', key, funk_name(set_handler), funk_name(executing_funk))
        set_handler = set_handler || executing_funk
        var fkey = funk_key(set_handler)
        //console.log('Gets in is', gets_in.hash)
        if (!gets_in.has(key, fkey)) {
            console.error("***\n****\nTrying to forget lost key", key,
                          'from', funk_name(set_handler), fkey,
                          "that hasn't got that key.")
            console.trace()
            return
            // throw Error('asdfalsdkfajsdf')
        }

        gets_in.delete(key, fkey)
        unbind(key, 'on_set', set_handler)

        // If this is the last handler listening to this key, then we can
        // delete the cache entry, send a forget upstream, and de-activate the
        // .on_get handler.
        if (!gets_in.has_any(key)) {
            clearTimeout(to_be_forgotten[key])
            to_be_forgotten[key] = setTimeout(function () {
                // Send a forget upstream
                bus.route(key, 'forgetter', key, t)

                // Delete the cache entry...?
                // delete cache[key]
                // delete backup_cache[key]
                delete gets_out[key]
                delete to_be_forgotten[key]

                if (bus.auto_delete && gets_in.empty()) {
                    bus.auto_delete()
                    bus.delete_bus()
                }

            }, 200)
        }
    }
    function del (key, t) {
        key = key.key || key   // Prolly disable this in future
        bogus_check(key)

        if ((executing_funk !== global_funk) && executing_funk.loading()) {
            abort_changes([key])
            return
        }

        statelog(key, yellow, 'v', 'Deleting ' + key)
        // Call the deleter handlers
        var handlers_called = bus.route(key, 'deleter', key)
        if (handlers_called === 0) {
            // And go ahead and delete if there aren't any!
            delete cache[key]
            delete backup_cache[key]
        }

        // Call the on_delete handlers
        bus.route(key, 'on_delete', cache[key] || {key: key}, t)

        // console.warn("Deleting " + key + "-- Statebus doesn't yet re-run functions subscribed to it, or update versions")

        // Todos:
        //
        //  - Add transactions, so you can check permissions, abort a delete,
        //    etc.
        //    - NOTE: I did a crappy implementation of abort just now above!
        //      But it doesn't work if called after the deleter handler returns.
        //    - Generalize the code across set and del with a "mutate"
        //      operation
        //
        //  - Right now we fire the deleter handlers right here.
        //
        //    - Do we want to batch them up and fire them later?
        //      e.g. we could make a mark_deleted(key) like mark_changed(key)
        //
        //    - We might also record a new version of the state to show that
        //      it's been deleted, which we can use to cancel echoes from the
        //      sending bus.

    }

    var changed_keys = new Set()
    var dirty_getters = {}       // Maps funk_key => version dirtied at
    function dirty (key, t) {
        statelog(key, brown, '*', bus + ".dirty('"+key+"')")
        bogus_check(key)

        var version = (t && t.version) || 'dirty-' + new_version()

        // Find any .getter, and mark as dirty so that it re-runs
        var found = false
        if (gets_out.hasOwnProperty(key))
            for (var i=0; i<gets_out[key].length; i++) {
                dirty_getters[funk_key(gets_out[key][i])] = version
                found = true
            }
        clean_timer = clean_timer || setTimeout(clean)

        // If none found, then just mark the key changed
        if (!found && cache.hasOwnProperty(key)) mark_changed(key, t)
    }

    function mark_changed (key, t) {
        // Marks a key as dirty, meaning that functions on it need to update
        log('Marking changed', bus.toString(), key)
        changed_keys.add(key)
        clean_timer = clean_timer || setTimeout(clean)
    }

    function clean () {
        // 1. Collect all functions for all keys and dirtied getters
        var dirty_funks = {}
        for (var b in busses) {
            var fs = busses[b].rerunnable_funks()
            for (var i=0; i<fs.length; i++)
                dirty_funks[fs[i].funk_key] = fs[i].at_version
        }
        clean_timer = null

        // 2. Run any priority function first (e.g. file_store's on_set)
        log(bus.label, 'Cleaning up', Object.keys(dirty_funks).length, 'funks')
        for (var k in dirty_funks) {
            var funk    = funks[k],
                version = dirty_funks[k]

            var p = funk.proxies_for
            if (p && p.priority) {
                log('Clean-early:', funk_name(funk))
                if (!funk.global_funk)
                    funk.latest_reaction_at = version
                funk.react()
                delete dirty_funks[k]
            }
        }

        // 3. Re-run the functions
        for (var k in dirty_funks) {
            var funk    = funks[k],
                version = dirty_funks[k]
            log('Clean:', funk_name(funk))
            if (bus.render_when_loading || !funk.loading()) {
                if (!funk.global_funk)
                    funk.latest_reaction_at = version
                funk.react()
            }
        }
        // console.log('We just cleaned up', dirty_funks.length, 'funks!')
    }

    // Let's change this function to go through each key and grab the latest
    // version of that key, and store that when we re-run the funk for it.
    // Then we can pass this back to clean as [{version, funk} ...], and then
    // clean can run it with a transaction that has that version in it.
    // That'll stop a lot of echoes.
    function rerunnable_funks () {
        var result = []
        var keys = changed_keys.values()

        // console.log(bus+' Finding rerunnable funcs for', keys, 'keys, and', Object.keys(dirty_getters).length, 'dirty_getters')
        for (var i=0; i<keys.length; i++) {          // Collect all keys
            // if (to_be_forgotten[keys[i]])
            //     // Ignore changes to keys that have been forgotten, but not
            //     // processed yet
            //     continue
            var fs = bindings(keys[i], 'on_set')
            for (var j=0; j<fs.length; j++) {
                var f = fs[j].func
                if (f.react) {
                    // Skip if it's already up to date
                    var v = f.getted_keys[JSON.stringify([this.id, keys[i]])]
                    // console.log('re-run:', keys[i], f.statebus_id, f.getted_keys)
                    if (v && v.indexOf(versions[keys[i]]) !== -1) {
                        log('skipping', funk_name(f), 'already at version', versions[keys[i]], 'proof:', v)
                        continue
                    }
                } else {
                    // Fresh handlers are always run, but need a wrapper
                    f.seen_keys = f.seen_keys || {}
                    var v = f.seen_keys[JSON.stringify([this.id, keys[i]])]
                    if (v && v.indexOf(versions[keys[i]]) !== -1) {
                        // Note: Is this even possible?  Isn't it impossible
                        // for a fresh handler to have seen a version already?

                        //log('skipping', funk_name(f), 'already at version', v)
                        continue
                    }
                    autodetect_args(f)
                    f = run_handler(f, 'on_set', cache[keys[i]], {dont_run: true,
                                                                  binding: keys[i]})
                }
                result.push({funk_key: funk_key(f),
                             at_version: versions[keys[i]]})
            }
        }
        for (var k in dirty_getters)  // Collect all getters
            result.push({funk_key: k,
                         at_version: dirty_getters[k]})

        changed_keys.clear()
        dirty_getters = {}

        // console.log('found', result.length, 'funks to re run')

        return result
    }

    // ****************
    // Connections
    function old_subspace (key, params) {
        var methods = {getter:null, setter:null, on_set:null, on_set_sync:null,
                       on_delete:null, deleter:null, forgetter:null}

        var result = {}
        for (var method in methods)
            (function (method) {
                Object.defineProperty(result, method, {
                    set: function (func) {
                        autodetect_args(func)
                        func.defined = func.defined || []
                        func.defined.push(
                            {as:'handler', bus:bus, method:method, key:key})
                        bind(key, method, func, 'pattern')
                    },
                    get: function () {
                        var result = bindings(key, method)
                        for (var i=0; i<result.length; i++) result[i] = result[i].func
                        result.delete = function (func) { unbind (key, method, func, 'pattern') }
                        return result
                    }
                })
            })(method)
        return result
    }

    function new_subspace (key, params) {
        for (var method in params) {
            var func = params[method]
            var param_names = {get:'getter', set:'setter',
                               delete: 'deleter', forget: 'forgetter',
                               on_set:'on_set', on_set_sync:'on_set_sync'}

            // Map it from the API's name to our internal name
            console.assert(param_names[method],
                           'Method "' + method + '" is invalid')
            method = param_names[method]

            autodetect_args(func)
            func.call_with_proxies = true
            func.defined = func.defined || []
            func.defined.push({bus, method, key, as: 'handler'})
            bind(key, method, func, 'pattern')
        }
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
            case 'path':
                handler.args['path'] = i; break
            case 'json':
            case 'vars':
                handler.args['vars'] = i; break
            case 'star':
            case 'rest':
                handler.args['rest'] = i; break
            case 'cb':
            case 't':
            case 'transaction':
                handler.args['t'] = i; break
            case 'o':
            case 'obj':
            case 'val':
            case 'new':
            case 'New':
                handler.args['obj'] = i; break
            case 'old':
                handler.args['old'] = i; break
            case 'func_args':
                handler.args['func_args'] = i; break
            }
    }

    // The funks attached to each key, maps e.g. 'get /point/3' to '/30'
    var handlers = new One_To_Many()
    var pattern_handlers = []  // An array of {pattern, method, funk}

    // A set of timers, for keys to send forgets on
    var to_be_forgotten = {}
    function bind (pattern, method, func, type) {
        bogus_check(pattern)

        function pattern_matcher (pattern) {
            var param_names = []

            // console.log('Creating pattern for', pattern)

            // First, convert the pattern into a regexp.

            // 1. Handle :foo by swapping it with '([^/*()]+)'
            pattern = pattern.replace(/(?<=^|\/):[^/*()]+/g, match => {
                // Replace :foo with ([^/]+), and remember the "foo" name
                param_names.push(match.slice(1))
                return '([^/*()]+)'
            })

            // Now look for * and () at the end and replace with regexps
            if (pattern.slice(-3) === '*()')
                pattern = pattern.slice(0, -3) + '(?<star>[^()]*)(?<fstring>\\(.*\\))?'
            else if (pattern.slice(-1) === '*')
                pattern = pattern.slice(0, -1) + '(?<star>.*)'
            else if (pattern.slice(-2) === '()')
                pattern = pattern.slice(0, -2) + '(?<fstring>\\(.*\\))?'

            // Construct the regexp
            var regex = new RegExp('^' + pattern + '$')
            
            // console.log('Pattern became      ', regex)

            // Return a matcher function that runs it
            return path => {
                var match = path.match(regex)
                if (!match) return null
                var params = {}
                params.func_args = match.groups.fstring
                params.star = match.groups.star

                // Add to params.path all the path parts
                params.path = {}
                match.slice(1, param_names.length + 1).forEach((val, i) =>
                    params.path[param_names[i]] = val
                )

                return params
            }
        }

        // Add patterns to the list, not the hash
        if (type === 'pattern' && /[:*]/.test(pattern))  // Is it a pattern?
            pattern_handlers.push({pattern: pattern,
                                   matcher: pattern_matcher(pattern),
                                   method: method,
                                   funk: func})

        // Add simple keys to the hash
        else
            handlers.add(method + ' ' + pattern, funk_key(func))

        // Now check if the method is a get and there's a getted
        // key in this space, and if so call the handler.
    }
    function unbind (pattern, method, funk, type) {
        bogus_check(pattern)
        if (type === 'pattern' && /[:*]/.test(pattern))  // Is it a pattern?
            // Delete pattern connection
            for (var i=0; i < pattern_handlers.length; i++) {
                var handler = pattern_handlers[i]
                if (handler.pattern === pattern
                    && handler.method === method
                    && handler.funk === funk) {

                    pattern_handlers.splice(i,1)  // Splice this element out of the array
                    i--                           // And decrement the counter while we're looping
                }
            }
        else
            // Delete direct connection
            handlers.delete(method + ' ' + pattern, funk_key(funk))
    }

    function bindings(key, method) {
        bogus_check(key)
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

        // Now iterate through patterns
        for (var i=0; i < pattern_handlers.length; i++) {
            handler = pattern_handlers[i]
            var matches = handler.matcher(key)
            // console.log('The matching of', pattern_handlers[i], 'to', key, 'is', matches)

            if (matches                                // If the pattern matches
                && method === handler.method           // And it has the right method
                && !seen[funk_key(handler.funk)]) {

                handler.funk.statebus_binding = {
                    key:    handler.pattern,
                    method: method,
                    args:   matches
                }
                result.push({method, key:handler.pattern, func:handler.funk})
                seen[funk_key(handler.funk)] = true
            }
        }

        return result
    }

    function run_handler(funck, method, arg, options) {
        // If method == "set",    then arg is an object {key: "foobar", ...}
        // If method == "get",    then arg is a key     "foobar"
        // If method == "forget", then arg is a key     "foobar"
        // If method == "delete", then arg is a key     "foobar"

        options = options || {}
        var t = options.t,
            just_make_it = options.dont_run,
            binding = options.binding

        // When we first run a handler (e.g. a get or set), we wrap it in a
        // reactive() funk that calls it with its arg.  Then if it gets or
        // sets, it'll register a .on_set handler with this funk.

        // Is it reactive already?  Let's distinguish it.
        var funk = funck.react && funck,  // Funky!  So reactive!
            func = !funk && funck         // Just a function, waiting for a rapper to show it the funk.

        console.assert(funk || func)

        if (false && !funck.global_funk) {
            // \u26A1
            var event = {'setter':'set','on_set':'set.fire','getter':'get',
                         'deleter':'delete','forgetter':'forget'}[method],
                triggering = funk ? 're-running' : 'initiating'
            console.log('   > a', bus+'.'+event + "('" + (arg.key||arg) + "') is " + triggering
                +'\n     ' + funk_name(funck))
        }

        if (funk) {
            // Then this is an on_set event re-triggering an already-wrapped
            // funk.  It has its own arg internally that it's calling itself
            // with.  Let's tell it to re-trigger itself with that arg.

            if (method !== 'on_set') {
                console.error(method === 'on_set', 'Funk is being re-triggered, but isn\'t on_set. It is: "' + method + '", oh and funk: ' + funk_name(funk))
                return
            }
            return funk.react()

            // Hmm... does this do the right thing?  Example:
            //
            //    bus('foo').on_set = function (o) {...}
            //    set({key: 'foo'})
            //    set({key: 'foo'})
            //    set({key: 'foo'})
            //
            // Does this spin up 3 reactive functions?  Hmm...
            // Well, I think it does, but they all get forgotten once
            // they run once, and then are garbage collected.
            //
            //    bus('foo*').on_set = function (o) {...}
            //    set({key: 'foo1'})
            //    set({key: 'foo2'})
            //    set({key: 'foo1'})
            //    set({key: 'foo3'})
            //
            // Does this work ok?  Yeah, I think so.
        }

        // Alright then.  Let's wrap this func with some funk.

        // Fresh get/set/forget/delete handlers will just be regular
        // functions.  We'll store their arg and transaction and let them
        // re-run until they are done re-running.
        function key_arg () { return ((typeof arg.key) === 'string') ? arg.key : arg }
        function rest_arg () {
            return func.statebus_binding && func.statebus_binding.args.star
            // (key_arg()).substr(binding.length-1)
        }
        function val_arg () {
            console.assert(method === 'setter' || method === 'on_set' || method === 'on_set_sync',
                           'Bad method for val_arg()')

            var value = (typeof arg === 'string'
                         // If arg is a key, then semantics of val is "the
                         // current value in the cache".  I'm doing this
                         // because it *might* be useful in a getter ... but
                         // let's see if we actually have good examples of use
                         // for this feature.
                         ? bus.cache[arg]
                         // Otherwise, arg must be the actual object
                         : arg)

            // The Proxy API unwraps the .val for us
            if (func.call_with_proxies)
                value = value.val

            return value
        }
        function vars_arg () {
            var r = rest_arg()
            try {
                return JSON.parse(r)
            } catch (e) {
                return 'Bad JSON "' + r + '" for key ' + key_arg()
            }
        }
        // Parse out function params for URLs in the style /foo/bar(param1,param2:val2).
        // We're currently calling that (param1,param2:val2) part "function params", and presuming
        // that it exists in the () part of the pattern like in /foo/bar*().
        function func_args () {
            // This code is copied from Raphael Walker's parser.coffee
            function split_once (str, char) {
                var i = str.indexOf(char)
                return i === -1 ? [str, ""] : [str.slice(0, i), str.slice(i + 1)]
            }

            // Function Strings -- an alternative to query strings
            //
            function parse_function_string (str) {
                // Coffeescript doesn't have object comprehensions :(
                var ret = {}

                // Now process the string:
                str
                    // Pull out the parentheses
                    .slice(1, -1)
                    // Split by commas. TODO: Allow spaces after commas?
                    .split(",")
                    // Delete empty parts (this ensures that empty strings
                    // will properly result in empty func_string, and allows trailing
                    // commas)
                    .filter(part => part.length)
                    .forEach(part => {
                        // If the part has a comma, its a key:value, otherwise
                        // it's just a singleton
                        var [k, v] = split_once(part, ":")
                        
                        if (v.length === 0) ret[k] = true
                        // If the value is itself a func_string params object, parse it recursively
                        else if (v.startsWith("(")) ret[k] = parse_function_string(v)
                        else ret[k] = v
                    })
                return ret
            }
            // console.log('Getting func_args from', func.statebus_binding.args)
            if (!(func.statebus_binding.args
                  && func.statebus_binding.args.func_args))
                return undefined
            return parse_function_string(func.statebus_binding.args.func_args)
        }
        var f = reactive(function () {
            // Initialize transaction
            t = clone(t || {})

            // Add .abort() method
            if (method === 'setter' || method === 'deleter')
                t.abort = function () {
                    var key = method === 'setter' ? arg.key : arg
                    if (f.loading()) return
                    bus.cache[key] = bus.cache[key] || {key: key}
                    bus.backup_cache[key] = bus.backup_cache[key] || {key: key}
                    bus.set.abort(bus.cache[key])
                }

            // Add .done() method
            if (method !== 'forgetter')
                t.done = function (o) {
                    var key = method === 'setter' ? arg.key : arg
                    if (func.call_with_proxies)
                        o = {key, val: raw(o)}
                    bus.log('We are DONE()ing', method, key, o||arg)

                    // We use a simple (and crappy?) heuristic to know if the
                    // setter handler has changed the state: whether the
                    // programmer passed (o) to the t.done(o) handler.  If
                    // not, we assume it hasn't changed.  If so, we assume it
                    // *has* changed, and thus we change the version of the
                    // state.  I imagine it would be more accurate to diff
                    // from before the setter handler began with when
                    // t.done(o) ran.
                    //
                    // Note: We will likely solve this in the future by
                    // preventing .setter() from changing the incoming state,
                    // except through an explicit .revise() function.
                    if (o) t.version = new_version()

                    if (method === 'deleter') {
                        delete bus.cache[key]
                        delete bus.backup_cache[key]
                    }
                    else if (method === 'setter') {
                        bus.set.fire(o || arg, t)
                        bus.route(key, 'on_set_sync', o || arg, t)
                    } else {
                        // Now method === 'getter'
                        o.key = key
                        bus.set.fire(o, t)
                        // And now reset the version cause it could get called again
                        delete t.version
                    }
                }

            // Alias .return() to .done(), in case that feels better to you
            t.return = t.done

            // Prepush Scratch:
            //   var prepushed = {}
            //   t.prepush = function (key) {
            //       prepushed[key] = bus.get(key)
            //   }

            // Alias t.reget() to bus.dirty()
            if (method === 'setter')
                t.reget = function () { bus.dirty(arg.key) }

            // Now to call the handler, let's line up the function's special
            // named arguemnts like key, o, t, rest, vars, etc.
            var args = []
            args[0] = (method in {setter:1, on_set:1, on_set_sync:1}) ? val_arg() : arg
            args[1] = t
            for (var k in (func.args||{})) {
                switch (k) {
                case 'key':
                    args[func.args[k]] = key_arg(); break
                case 'path':
                    args[func.args[k]] = (func.statebus_binding
                                          && func.statebus_binding.args
                                          && func.statebus_binding.args.path)
                    break
                case 'rest':
                    args[func.args[k]] = rest_arg(); break
                case 'vars':
                    args[func.args[k]] = vars_arg();
                    break
                case 't':
                    args[func.args[k]] = t; break
                case 'obj':
                    args[func.args[k]] = val_arg(); break
                case 'old':
                    var key = key_arg()
                    args[func.args[k]] = bus.cache[key] || (bus.cache[key] = {key:key})
                    if (func.call_with_proxies)
                        args[func.args[k]] = args[func.args[k]].val
                    break
                case 'func_args':
                    args[func.args[k]] = func_args(); break
                }
            }

            // Call the raw function here!
            var result = func.apply(null, args)

            // We will wanna add in the fancy arg stuff here, with:
            // arr = []
            // for (var k of func.args || {})
            //    arr[func.args[k]] = <compute_blah(k)>

            // Trigger done() or abort() by return value
            console.assert(!(result === 'getter' &&
                             (result === 'done' || result === 'abort')),
                           'Returning "done" or "abort" is not allowed from getter handlers')

            if (result === 'done')  t.done()
            if (result === 'abort') t.abort()

            // For get
            if (func.call_with_proxies) {
                if (method === 'getter' && result !== undefined && !f.loading()) {
                    var obj = {key: arg, val: raw(result)}
                    var new_t = clone(t || {})
                    new_t.getter = true
                    set.fire(obj, new_t)
                    return result
                }
            } else {
                if (method === 'getter' && result instanceof Object
                    && !f.loading()     // Experimental.
                   ) {
                    result.key = arg
                    var new_t = clone(t || {})
                    new_t.getter = true
                    set.fire(result, new_t)
                    return result
                }
            }

            // Set, forget and delete handlers stop re-running once they've
            // completed without anything loading.
            // ... with f.forget()
            if (method !== 'getter' && !f.loading())
                f.forget()
        })
        f.proxies_for = func
        f.arg = arg
        f.transaction = t || {}

        // getter handlers stop re-running when the key is forgotten
        if (method === 'getter') {
            var key = arg
            function handler_done () {
                f.forget()
                unbind(key, 'forgetter', handler_done)
            }
            bind(key, 'forgetter', handler_done)

            // // Check if it's doubled-up
            // if (gets_out[key])
            //     console.error('Two .getter functions are running on the same key',
            //                   key+'!', funk_name(funck), funk_name(gets_out[key]))

            gets_out[key] = gets_out[key] || []
            gets_out[key].push(f)   // Record active getter handler
            pending_gets[key] = f   // Record that the get is pending
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

        // if (method === 'getter')
        //     console.assert(handlers.length<2,
        //                    'Two getter functions are registered for the same key '+key,
        //                    handlers)
        return handlers.length
    }


    // ****************
    // Reactive functions
    //
    // We wrap any function with a reactive wrapper that re-calls it whenever
    // state it's got changes.

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
        // This will remember every get it depends on, and make it re-call
        // itself whenever that state changes.  It will remember arg1 and arg2
        // and use those again.  You can also trigger a re-action manually
        // with:
        //
        //    funk.react().
        //
        // ...which will make it re-run with the original arg1 and arg2 .
        //
        // Each subsequent time you call f(arg1, arg2), it will change the
        // remembered args and re-run the funk.
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
        funk.getted_keys = {} // maps [bus,key] to version
                               // version will be undefined until loaded
        funk.abortable_keys = []
        funk.has_seen = function (bus, key, version) {
            //console.log('depend:', bus, key, versions[key])
            var bus_key = JSON.stringify([bus.id, key])
            var seen_versions =
                this.getted_keys[bus_key] = this.getted_keys[bus_key] || []
            seen_versions.push(version)
            if (seen_versions.length > 50) seen_versions.shift()
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
            // Todo: This will bug out if an .on_set handler for a key also
            // gets that key once, and then doesn't get it again, because
            // when it gets the key, that key will end up being a
            // getted_key, and will then be forgotten as soon as the funk is
            // re-run, and doesn't get it again, and the fact that it is
            // defined as an .on_set .on_set handler won't matter anymore.

            if (funk.statebus_id === 'global funk') return

            for (var hash in funk.getted_keys) {
                var tmp = JSON.parse(hash),
                    bus = busses[tmp[0]], key = tmp[1]
                if (bus)  // Cause it might have been deleted
                    bus.forget(key, funk)
            }
            funk.getted_keys = {}
        }
        funk.loading = function () {
            for (var hash in funk.getted_keys) {
                var tmp = JSON.parse(hash),
                    bus = busses[tmp[0]], key = tmp[1]
                if (bus  // Cause it might have been deleted
                    && bus.pending_gets[key])
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
        //console.log('Loading: pending_keys is', pending_gets)
        for (var i=0; i<keys.length; i++)
            if (pending_gets[keys[i]]) return true
        return false
    }

    // Tells you whether the currently executing funk is loading
    function loading () { return executing_funk.loading() }

    bus.default = function () {
        bus.deep_map(arguments, function (o) {
            if (o.key && !(bus.cache.hasOwnProperty(o.key)))
                bus.cache[o.key] = o
            return o
        })
    }

    function once (f) {
        var r = reactive(function () {
            f()
            if (!r.loading()) r.forget()
        })
        r()
    }

    // ******************
    // Pretty Printing

    if (nodejs)
        var red = '\x1b[31m', normal = '\x1b[0m', grey = '\x1b[0;38;5;245m',
            green = '\x1b[0;38;5;46m', brown = '\x1b[0;38;5;130m',
            yellow = '\x1b[0;38;5;226m'
    else
        var red = '', normal = '', grey = '',
            green = '', brown = ''
    function add_diff_msg (message, obj) {
        var diff = sorta_diff(backup_cache[obj.key] && backup_cache[obj.key].val,
                              obj && obj.val)
        if (diff) {
            var end_col = message.length + 2 + statelog_indent * 3
            for (var i=0; i<40-end_col; i++) message += ' '
            message += diff.substring(0,80)
        }
        else message += ' <no diff>'
        return message
    }
    function set_msg (obj, t, meth) {
        if (!honking_at(obj.key)) return
        var message = (t && t.m) || bus + "."+meth+"('"+obj.key+"')"
        message = add_diff_msg(message, obj)
        if (t.version) message += ' [' + t.version + ']'
        return message
    }


    // ******************
    // Fancy Stuff

    var uncallback_counter = 0
    function uncallback (f, options) {
        name = (options && options.name) || f.name || (uncallback_counter+'')
        if (!name) throw 'Uncallback function needs a name'
        var watching = {}
        var prefix = 'uncallback/' + name
        bus(prefix + '/*').getter = function (key, json) {
            var args = json
            function cb (err, result) {
                if (err) {
                    console.trace('have err:', err, 'and result is', JSON.stringify(result))
                    throw err
                } else
                    bus.set.fire({key: key, _: result})
            }

            // Inject the callback into the right place
            args[options.callback_at || args.length] = cb

            // And call the underlying function
            f.apply({key:key}, args)
            if (options.start_watching && !watching[key]) {
                watching[key] = true
                options.start_watching(
                    args,
                    function () { bus.dirty(key) },
                    function () { bus.del(key) }
                )
            }
        }
        if (options.stop_watching)
            bus(prefix + '/*').forgetter = function (key, json) {
                console.assert(watching[key],
                               'Forgetting a watcher for ' + JSON.stringify(key)
                               + ' that is not enabled')
                delete watching[key]
                options.stop_watching(json)
            }
        return function () {
            var args = [].slice.call(arguments)
            return bus.get(prefix + '/' + JSON.stringify(args))._
        }
    }

    function unpromise (f) {
        // Doesn't work yet!  In progress.
        return uncallback(function () {
            var args = [].slice.call(arguments)
            var cb = args.pop()
            f.apply(null, args).then(cb)
        })
    }

    function aget (key) {
        return new Promise((resolve, reject) =>
            bus.get_once(key, (o) => resolve(o)))
    }

    // ******************
    // Proxy

    var symbols = {
        is_proxy: Symbol('is_proxy'),
        raw: Symbol('raw'),
        link: Symbol('link')
    }

    if (nodejs)
        var util = require('util')

    // The top-level Proxy object holds HTTP resources
    var top_level_proxy = new Proxy(cache, {
        get: function get(o, k) {
            if (k === symbols.is_proxy)
                return true
            if (k === symbols.raw)
                return bus.cache
            // if (k === 'inspect' || k === 'valueOf' || typeof k === 'symbol')
            //     return undefined
            bogus_check(k)
            var base = bus.get(k)
            return json_proxy(base, '', base.val)
        },
        set: function set(o, key, val) {
            if (typeof key === 'symbol')
                return true

            bus.set({
                key: key,
                val: escape_json_to_bus(val)
            })
            return true
        },
        deleteProperty: function del (o, k) {
            bus.delete(escape_field_to_bus(k))
            return true // Report success to Proxy
        }
    })
    bus.state = top_level_proxy

    // The proxy within; a recursive tree holds each piece of JSON in a resource
    function json_proxy (base, path, o) {

        // Primitives pass through unscathed
        if (typeof o === 'number'
            || typeof o === 'string'
            || typeof o === 'boolean'
            || o === undefined
            || o === null
            || typeof o === 'function')

            return o

        // Then o must be an object, array, or link

        // First, handle links.
        if (typeof o === 'object' && 'link' in o) {
            // var new_base = bus.get(o.link)
            // return json_proxy(new_base, '', new_base.val)
            return link(o.link)

            // Todo: to allow modifying links, or adding new fields to them,
            // we'll need to treat them more like a json_proxy, that passes
            // the base into the proxy creator, allowing edits, etc.
        }

        // Now it must be an array or object.  Shallow clone it, so we can set
        // a custom formatter on it
        var target = o
        if (Array.isArray(target)) target = [...o]
        else                       target = {...o}

        // Now set the custom formatter
        if (nodejs)
            target[util.inspect.custom] = function print_as_proxy (depth, opts) {
                var formatted = Array.isArray(target) ? [] : {}
                for (let prop of Object.getOwnPropertyNames(target))
                    formatted[prop] = target[prop]
                formatted = unescape_bus_to_json(formatted)

                return `Proxy ${util.inspect(formatted, { ...opts, customInspect: true })}`
            }

        var proxy = new Proxy(target, {
            get: function (o, k) {
                // console.log('proxy get:', o, k)

                if (k === 'inspect' || k === 'valueOf')
                    return undefined
                if (k === symbols.is_proxy)
                    return true
                if (k === symbols.raw)
                    return unescape_bus_to_json(o)

                // Compute the new path
                var new_path = path + '[' + JSON.stringify(k) + ']'
                return json_proxy(base, new_path, o[escape_field_json_to_bus(k)])
            },
            set: function (target, k, v) {
                var value = escape_json_to_bus(v)
                var escaped_key = escape_field_json_to_bus(k)

                // Now mutate both the shallow-copied target and the original
                // object because we have two because es6 proxies are stupidly
                // designed and we had to make a copy to make custom inspect
                // symbol work
                     o[escaped_key] = value
                target[escaped_key] = value
                var new_path = path + '[' + JSON.stringify(k) + ']'
                bus.set.sync(
                    base,
                    // Forward the patches too
                    {patches: [{unit: 'json',
                                range: new_path,
                                content: JSON.stringify(v)}]}
                )
                return true
            },
            has: function (o, k) {
                return o.hasOwnProperty(escape_field_json_to_bus(k))
            },
            ownKeys: function () {
                return Object.keys(target).map(unescape_field_bus_to_json)
            },
            getOwnPropertyDescriptor: function (target, key) {
                return { enumerable: true, configurable: true,
                         value: this.get(target, escape_field_json_to_bus(key))
                       }
            },
            deleteProperty: function del (target, k) {
                var new_path = path + '[' + JSON.stringify(k) + ']'
                var escaped_key = escape_field_json_to_bus(k)
                delete      o[escaped_key]
                delete target[escaped_key]
                bus.set(
                    base,
                    // Forward the patches too
                    {patches: [{unit: 'json',
                                range: new_path,
                                content: undefined}]}
                )
                return true // Report success to Proxy
            },
        })

        return proxy
    }

    // This doesn't work because custom inspectors only work when the
    // util.inspect.custom symbol is defined on the "target" of the
    // proxy... which right now is `cache` for the top_level_proxy.  I could
    // shallow-copy cache into a new target variable, and add this symbol to
    // it, and keep them in sync, but that sounds annoying.  I'm just going to
    // ignore the custom proxy formatter on the top-level-proxy for now.

    // if (nodejs) {
    //     var util = require('util')
    //     top_level_proxy[util.inspect.custom] = function(depth, opts) {
    //         var formatted = {}
    //         for (let prop of Object.getOwnPropertyNames(cache)) {
    //             formatted[prop] = cache[prop].val
    //         }
    //         return `STATE ${util.inspect(formatted, { ...opts, customInspect: true })}`
    //     }
    // }

    // This is disabled because it's not being used.
    //
    // // This is temporary code to wrap the cache as a flat key/valuel store
    // // that returns raw objects, dereferencing .val.  We can remove it once we
    // // remove the internal .val stuff from statebus.
    // function raw_proxy () {
    //     return new Proxy(cache, {
    //         get: function get(o, k) { return bus.cache[k].val },
    //         set: function set(o, key, val) {
    //             return false
    //         },
    //         deleteProperty: function del (o, k) {
    //             return false
    //         }
    //     })
    // }


    // Old link code:

    // // How proxy links work right now:
    // //  - The user creates a link with bus.link(key)
    // //    - which produces a {[symbols.link]: key}
    // //    - which when set() into a proxy, is replaced with a {link: key}, to store internally
    // //  - Then, when get()ing that internal {link: key} through Proxy:
    // //    - We auto-dereference the key, with another get()
    // //    - So the user actually sees the value of the resource on the other side of the link
    // function link (url) {
    //     return {
    //         link: url,
    //         [symbols.link]: true,
    //         _: (args, o) => (o = get(url), json_proxy(o, '', o.val))
    //     }
    // }

    // The proxy object for links.  Disabled for now.
    // This type of link has to be function called, as link(), to dereference.
    // function proxy_link (url) {
    //     function follow_link () {}
    //     var proxy = new Proxy(follow_link, {
    //         get: function (o, k) {
    //             console.log('get', k)
    //             if (k === 'inspect' || k === 'valueOf')
    //                 return undefined
    //             // if (custom_inspect && k === custom_inspect)
    //             //     return custom_inspect
    //             if (k === symbols.is_proxy)
    //                 return true
    //             if (k === symbols.link)
    //                 return true
    //             if (k === symbols.raw)
    //                 return {link: url}
    //             if (typeof k === 'symbol')
    //                 return undefined

    //             if (k === 'link')
    //                 return url

    //             return follow_link[k]

    //             // return undefined
    //         },
    //         set: function (o, k, v) {
    //             if (k === 'link') {
    //                 url = v
    //             }

    //             console.assert(false, "Have not fully implemented setting links yet")

    //             // Todo: update the containing proxy object with bus.set.sync
    //             // else return
    //             // var value = escape_json_to_bus(v)
    //             // o[escape_field_json_to_bus(k)] = value
    //             // var new_path = path + '[' + JSON.stringify(k) + ']'
    //             // bus.set.sync(
    //             //     base,
    //             //     // Forward the patches too
    //             //     {patches: [{unit: 'json',
    //             //                 range: new_path,
    //             //                 content: JSON.stringify(v)}]}
    //             // )
    //             return true
    //         },
    //         has: function (o, k) {
    //             return k === 'link'
    //         },
    //         ownKeys: function () {
    //             console.log('ownkeys')
    //             return ['link', 'arguments', 'caller', 'prototype']
    //         },
    //         getOwnPropertyDescriptor: function (target, key) {
    //             console.log('getownpropertydescriptor', key)
    //             return {
    //                 enumerable: true,
    //                 configurable: true,
    //                 value: key === 'link' ? url : undefined
    //             }
    //         },
    //         // deleteProperty: function del (o, k) {
    //         //     var new_path = path + '[' + JSON.stringify(k) + ']'
    //         //     delete o[escape_field_json_to_bus(k)]
    //         //     bus.set(
    //         //         base,
    //         //         // Forward the patches too
    //         //         {patches: [{unit: 'json',
    //         //                     range: new_path,
    //         //                     content: undefined}]}
    //         //     )
    //         //     return true // Report success to Proxy
    //         // }

    //         // For function proxy:
    //         apply: function apply (o, This, args) {
    //             // console.log('Descending into the link', url, '!')
    //             return top_level_proxy[url]
    //         }
    //     })

    //     proxy[util.inspect.custom] = function(depth, opts) {
    //         var formatted = Array.isArray(o) ? [] : {}
    //         for (let prop of Object.getOwnPropertyNames(o)) {
    //             formatted[prop] = o[prop]
    //         }
    //         return `*${util.inspect({link: url})}`
    //     }

    //     return proxy

    // }

    // function proxy_link2 (url) {
    //     var target = {link: url}

    //     Object.setPrototypeOf(obj, Function.prototype);
    //     Object.defineProperty(obj, 'toString', {
    //         value: function() { return `{link: "${this.link}"}`; },
    //         writable: true,
    //         configurable: true
    //     })

    //     return new Proxy(target, {
    //         apply(target, this_arg, args) {
    //             return top_level_proxy[url]
    //         }
    //     })
    // }


    // New link code
    function link (url) {
        var target = () => {}

        // Use non-enumerable properties for function stuff
        Object.defineProperties(target, {
            // 'length': { value: 0, enumerable: false },
            'name': { value: '', enumerable: false },
            'prototype': { value: {}, enumerable: false },

            // Make link enumerable
            'link': { value: url, enumerable: true, writable: true, configurable: true },
            'toString': {
                value: function() { return `{link: "${this.link}"}` },
                enumerable: false
            },

            // Add toJSON method
            'toJSON': {
                value: function() { return { link: this.link } },
                enumerable: false
            }
        })

        var proxy = new Proxy(target, {
            get: function (o, k) {
                // console.log('link getting',k)
                // if (k === 'inspect' || k === 'valueOf')
                //     return undefined

                // if (custom_inspect && k === custom_inspect)
                //     return custom_inspect
                if (k === symbols.is_proxy)
                    return true
                if (k === symbols.link)
                    return true
                if (k === symbols.raw)
                    return {link: url}
                // if (typeof k === 'symbol')
                //     return undefined

                // if (k === 'link')
                //     return url

                return target[k]

                // return undefined

            },
            apply(target, this_arg, args) {
                return top_level_proxy[url]
            },
            has: function (o, k) {
                if (k === symbols.link)
                     return true
                return Reflect.has(o, k)
            },
        })

        if (nodejs)
            proxy[util.inspect.custom] = function(depth, opts) {
                var formatted = Array.isArray(target) ? [] : {}
                for (let prop of Object.getOwnPropertyNames(target)) {
                    formatted[prop] = target[prop]
                }
                formatted = {link: url}
                return `Proxy ${util.inspect(formatted, { ...opts, customInspect: true })}`
            }

        return proxy
    }

    function raw (proxy) {
        if (!(typeof proxy === 'object' && proxy[symbols.is_proxy]))
            return proxy

        return proxy[symbols.raw]
    }

    // So chrome can print out proxy objects decently
    if (!nodejs)
        window.devtoolsFormatters = [{
            header: function (x) {
                if (x[symbols.is_proxy]) {
                    return ['span', {style: 'background-color: #fffbe5; padding: 3px;'},
                            JSON.stringify(x)]
                }
                // For function proxies:
                // JSON.stringify(x(), null, 2)]
            },
            hasBody: function (x) {return false}
        }]


    // ************************************************
    //
    // Every dialogue we have with a peer gets an ID.
    // This `bus.dialogues` variable maps:
    //
    //      dialogue ID -> send_function
    //
    // for each peer we are in dialogue with.
    //
    // One can use this to make sure we don't send an update
    // back to the same peer that sent it to us.

    bus.dialogues = {}


    // ************************************************
    // Custom clients
    var client_counter = 0
    var client_busses  = {}
    function client_bus_for (client_id) {
        if (!bus.custom_clients) return bus

        // Do we have a bus for this client yet?
        if (client_busses[client_id])

            // Return existing bus
            return client_busses[client_id]

        else {

            // Make a new bus
            var client_bus = make_bus()
            client_bus.label = 'client-' + client_counter++
            client_bus.master = bus

            // Initialize the client-specific handlers
            bus.custom_clients(client_bus, client_id)

            // Remember it, and auto-delete it when it's no longer being used
            client_busses[client_id] = client_bus
            client_bus.auto_delete = () => delete client_busses[client_id]

            return client_bus
        }
    }


    // ************************************************
    // Network client
    function get_domain (key) { // Returns e.g. "state://foo.com"
        var m = key.match(/^i?statei?\:\/\/(([^:\/?#]*)(?:\:([0-9]+))?)/)
        return m && m[0]
    }
    function message_method (m) {
        return (m.get && 'get')
            || (m.set && 'set')
            || (m['delete'] && 'delete')
            || (m.forget && 'forget')
    }

    function ws_mount (prefix, url, client_creds) {
        // Local: state://foo.com/* or /*
        var preprefix = prefix.slice(0,-1)
        var bus = this
        var is_absolute = /^i?statei?:\/\//
        var creds = client_creds || (bus.client_creds && bus.client_creds(url))
        var has_prefix = new RegExp('^' + preprefix)
        var sock
        var attempts = 0
        var outbox = []
        var client_getted_keys = new bus.Set()
        var heartbeat
        if (url[url.length-1]=='/') url = url.substr(0,url.length-1)
        function nlog (s) {
            if (nodejs) {console.log(s)} else console.log('%c' + s, 'color: blue')
        }
        function send (o, pushpop) {
            pushpop = pushpop || 'push'
            o = rem_prefixes(o)
            var m = message_method(o)
            if (m == 'get' || m == 'delete' || m == 'forget')
                o[m] = rem_prefix(o[m])
            bus.log('ws_mount.send:', JSON.stringify(o))
            outbox[pushpop](JSON.stringify(o))
            flush_outbox()
        }
        function flush_outbox() {
            if (sock.readyState === 1)
                while (outbox.length > 0)

                    // Debug mode can simulate network latency
                    if (bus.simulate_network_delay) {
                        var msg = outbox.shift()
                        setTimeout((function () { sock.send(msg) }), bus.simulate_network_delay)
                    }

                    // But normally we just send the message immediately
                    else
                        sock.send(outbox.shift())
            else
                setTimeout(flush_outbox, 400)
        }
        function add_prefix (key) {
            return is_absolute.test(key) ? key : preprefix + key }
        function rem_prefix (key) {
            return has_prefix.test(key) ? key.substr(preprefix.length) : key }
        function add_prefixes (obj) {
            var keyed = bus.translate_keys(bus.clone(obj), add_prefix)
            return bus.translate_links(bus.clone(keyed), add_prefix)
        }
        function rem_prefixes (obj) {
            var keyed = bus.translate_keys(bus.clone(obj), rem_prefix)
            return bus.translate_links(bus.clone(keyed), rem_prefix)
        }

        bus(prefix).setter   = function (obj, t) {
            bus.set.fire(obj)
            var x = {set: obj}
            if (t.version) x.version = t.version
            if (t.parents) x.parents = t.parents
            if (t.patches) x.patches = t.patches
            if (t.patches) x.set     = rem_prefix(x.set.key)
            send(x)
        }
        bus(prefix).getter  = function (key) { send({get: key}),
                                                 client_getted_keys.add(key) }
        bus(prefix).forgetter = function (key) { send({forget: key}),
                                                 client_getted_keys.delete(key) }
        bus(prefix).deleter = function (key, t) {
            t.done()
            send({'delete': key})
        }

        function connect () {
            nlog('[ ] trying to open ' + url)
            sock = bus.make_websocket(url)
            sock.onopen = function()  {
                nlog('[*] opened ' + url)

                // Update state
                var peers = bus.get('peers')
                peers[url] = peers[url] || {}
                peers[url].connected = true
                set(peers)

                // Login
                if (creds) {
                    var i = []
                    function intro (o) {i.push(JSON.stringify({set: o}))}
                    if (creds.clientid)
                        intro({key: 'current_user', val: {client: creds.clientid}})
                    if (creds.name && creds.pass)
                        intro({key: 'current_user', val: {login_as: {name: creds.name, pass: creds.pass}}})
                    // Todo: make this kinda thing work:
                    if (creds.private_key && creds.public_key) {
                        // Send public_key... start waiting for a
                        // challenge... look up server's public key, verify
                        // signature from server's challenge, then respond to
                        // challenge.

                        // This will be used for mailbus
                    }
                    outbox = i.concat(outbox); flush_outbox()
                }

                // Reconnect
                if (attempts > 0) {
                    // Then we need to reget everything, cause it
                    // might have changed
                    var keys = client_getted_keys.values()
                    for (var i=0; i<keys.length; i++)
                        send({get: keys[i]})
                }

                attempts = 0
                //heartbeat = setInterval(function () {send({ping:true})}, 5000)
            }
            sock.onclose   = function()  {
                if (done) {
                    nlog('[*] closed ' + url + '. Goodbye!')
                    return
                }
                nlog('[*] closed ' + url)
                heartbeat && clearInterval(heartbeat); heartbeat = null
                setTimeout(connect, attempts++ < 3 ? 1500 : 5000)

                // Update state
                var peers = bus.get('peers')
                peers[url] = peers[url] || {}
                peers[url].connected = false
                set(peers)

                // Remove all gets and forgets from queue
                var new_outbox = []
                var bad = {'get':1, 'forget':1}
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
                    var method = message_method(message)

                    // We only take sets from the server for now
                    if (method !== 'set' && method !== 'pong') throw 'barf'
                    bus.log('net client received', message)
                    var t = {version: message.version,
                             parents: message.parents,
                             patches: message.patches}

                    var obj

                    // Are we receiving a patches?
                    if (message.patches && typeof message.set === 'string') {
                        // Then message.set is a key, and we are applying a
                        // patch to the data at that key
                        var key = message.set
                        obj = apply_patch(bus.cache[key] && bus.cache[key].val,
                                          message.patches[0])
                    }

                    // Then we're receiving the full state as an object
                    else
                        obj = message.set

                    if (!(t.version||t.parents||t.patches))
                        t = undefined

                    bus.set.fire(add_prefixes(message.set), t)
                } catch (err) {
                    console.error('Received bad network message from '
                                  +url+': ', event.data, err)
                    return
                }
            }

        }
        connect()

        var done = false

        // Note: this return value is probably not necessary anymore.
        return {send: send, sock: sock, close: function () {done = true; sock.close()}}
    }

    bus.client_creds = function client_creds (server_url) {
        // This default implementation just creates a different random id each time
        // we connect.  Override this if you want a client ID that persists.
        return {clientid: (Math.random().toString(36).substring(2)
                           + Math.random().toString(36).substring(2)
                           + Math.random().toString(36).substring(2))}
    }

    function net_automount () {
        var bus = this
        var old_route = bus.route
        var connections = {}
        bus.route = function (key, method, arg, t) {
            var d = get_domain(key)
            if (d && !connections[d]) {
                bus.ws_mount(d + '/*', d)
                connections[d] = true
            }

            return old_route(key, method, arg, t)
        }
    }


    // ************************************************
    // Translating the URLs under keys of state
    function translate_keys (obj, translate) {
        // Recurse through each element in arrays
        if (Array.isArray(obj))
            for (var i=0; i < obj.length; i++)
                translate_keys(obj[i], translate)

        // Recurse through each property on objects
        else if (typeof obj === 'object')
            for (var k in obj) {
                if (k === 'key' || /.*_key$/.test(k))
                    if (typeof obj[k] == 'string')
                        obj[k] = translate(obj[k])
                    else if (Array.isArray(obj[k]))
                        for (var i=0; i < obj[k].length; i++) {
                            if (typeof obj[k][i] === 'string')
                                obj[k][i] = translate(obj[k][i])
                        }
                translate_keys(obj[k], translate)
            }
        return obj
    }

    // ************************************************
    // Translating the URLs under links of state
    function translate_links (obj, translate) {
        // Recurse through each element in arrays
        if (Array.isArray(obj))
            for (var i=0; i < obj.length; i++)
                translate_links(obj[i], translate)

        // Recurse through each property on objects
        else if (typeof obj === 'object')
            for (var k in obj) {
                if (k === 'link')
                    if (typeof obj[k] === 'string')
                        obj[k] = translate(obj[k])
                    else if (Array.isArray(obj[k]))
                        for (var i=0; i < obj[k].length; i++) {
                            if (typeof obj[k][i] === 'string')
                                obj[k][i] = translate(obj[k][i])
                        }
                translate_links(obj[k], translate)
            }
        return obj
    }


    // ************************************************
    // Translating fields of objects

    // Recurse through JSON and swap all object fields with other field names,
    // according to the function f(field, object).  Returns a copy.
    //
    // translate(field, object) takes a string `field` and returns the new
    // field name for `object`.
    function translate_fields (json, translate) {
        var result

        // Recurse through each element in arrays
        if (Array.isArray(json)) {
            var new_array = json.slice()
            for (var i=0; i < json.length; i++)
                new_array[i] = translate_fields(json[i], translate)
            result = new_array
        }

        // Recurse through each property on objects
        else if (typeof json === 'object' && json !== null && !(symbols.link in json)) {
            var new_obj = {}

            // Regular objects get their fields translated
            for (var k in json)
                if (typeof k === 'string')
                    new_obj[translate(k, json)] = translate_fields(json[k], translate)
            result = new_obj
        }

        // Everything else passes through unscathed
        else
            result = json

        return result
    }


    // Three levels of escaping through state:
    //
    //  - bus internal      escapes key  -> _key
    //  - nelSON            escapes link -> _link
    //  - JSON
    //
    var escape_field_to_bus        = (field) => field_replace(field, /^(_*)key$/, '$1_key'),
        unescape_field_from_bus    = (field) => field_replace(field, /^(_*)_key$/, '$1key'),
        escape_field_to_nelson     = (field) => field_replace(field, /^(_*)link$/, '$1_link'),
        unescape_field_from_nelson = (field) => field_replace(field, /^(_*)_link$/, '$1link')

    var escape_to_bus              = (obj)   => translate_fields(obj, escape_field_to_bus)
        unescape_from_bus          = (obj)   => translate_fields(obj, unescape_field_from_bus)
        escape_to_nelson           = (obj)   => translate_fields(obj, escape_field_to_nelson)
        unescape_from_nelson       = (obj)   => translate_fields(obj, unescape_field_from_nelson)

    var escape_field_json_to_bus   = (field) =>
        escape_field_to_bus(escape_field_to_nelson(field))
    var unescape_field_bus_to_json = (field) =>
        unescape_field_from_nelson(unescape_field_from_bus(field))

    var escape_json_to_bus         = (obj) => {
        obj = translate_fields(obj, escape_field_json_to_bus)
        return deep_map(obj, o => ((typeof o === 'object' || typeof o === 'function')
                                   && symbols.link in o
                                   ? {link: o.link}
                                   : o))
    }
    var unescape_bus_to_json       = (obj) =>
        translate_fields(obj, field => unescape_field_bus_to_json(field))
        

    var field_replace = (field, pattern, replacement) => (typeof field === 'string'
                                                          ? field.replace(pattern, replacement)
                                                          : field)

    function key_id(string) { return string.match(/\/?[^\/]+\/(\d+)/)[1] }
    function key_name(string) { return string.match(/\/?([^\/]+).*/)[1] }

    // ******************
    // Applying Patches, aka Diffs
    function apply_patch (obj, patch) {
        obj = bus.clone(obj)
        // Descend down a bunch of objects until we get to the final object
        // The final object can be a slice
        // Set the value in the final object

        console.assert(patch.unit === 'json', "Can't apply non-json patches")

        var path = patch.range, new_stuff = JSON.parse(patch.content)

        var path_segment = /^(\.?([^\.\[]+))|(\[((-?\d+):)?(-?\d+)\])|\[("(\\"|[^"])*")\]/
        var curr_obj = obj,
            last_obj = null
        function de_neg (numstr) {
            return numstr[0] === '-'
                ? curr_obj.length - parseInt(numstr.substr(1))
                : parseInt(numstr)
        }

        // console.log('Getting path', JSON.stringify(path), 'in obj', obj)

        while (true) {
            var match = path_segment.exec(path),
                subpath = match ? match[0] : '',
                field = match && match[2],
                slice_start = match && match[5],
                slice_end = match && match[6],
                quoted_field = match && match[7]

            slice_start = slice_start && de_neg(slice_start)
            slice_end = slice_end && de_neg(slice_end)

            if (quoted_field) field = JSON.parse(quoted_field)

            // console.log('Descending', {curr_obj, path, subpath, field, slice_start, slice_end, last_obj})

            // If it's the final item, set it
            if (path.length == subpath.length) {
                if (!subpath) return new_stuff
                else if (field)                          // Object
                    if (new_stuff === undefined)
                        delete curr_obj[field]           // - Delete a field in object
                    else
                        curr_obj[field] = new_stuff      // - Set a field in object

                else if (typeof curr_obj == 'string') {  // String
                    console.assert(typeof new_stuff === 'string')
                    if (!slice_start) {
                        slice_start = slice_end
                        slice_end = slice_end + 1
                    }
                    if (last_obj) {
                        var s = last_obj[last_field]
                        last_obj[last_field] = (s.slice(0, slice_start)
                                                + new_stuff
                                                + s.slice(slice_end))
                    } else
                        return obj.slice(0, slice_start) + new_stuff + obj.slice(slice_end)
                } else                                   // Array
                    if (slice_start)                     //  - Array splice
                        [].splice.apply(curr_obj, [slice_start, slice_end-slice_start]
                                        .concat(new_stuff))
                else {                                   //  - Array set
                    console.assert(slice_end >= 0, 'Index '+subpath+' is too small')
                    console.assert(slice_end <= curr_obj.length - 1,
                                   'Index '+subpath+' is too big')
                    curr_obj[slice_end] = new_stuff
                }

                return obj
            }

            // Otherwise, descend down the path
            console.assert(!slice_start, 'No splices allowed in middle of path')
            last_obj = curr_obj
            last_field = field
            curr_obj = curr_obj[field || slice_end]
            path = path.substr(subpath.length)
        }
    }

    // ******************
    // Utility funcs
    function parse (s) {try {return JSON.parse(s)} catch (e) {return {}}}
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
        this.empty = function () { return !Object.values(counts).some(count => count !== 0) }
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
        // This code was only needed for link_proxy:
        // // Treat link proxy objects as regular JSON links.  Otherwise, the
        // // function fields on them confuse everything.
        // if (a && typeof a === 'object' && a[symbols.link]) a = {link: a.link}
        // if (b && typeof b === 'object' && b[symbols.link]) b = {link: b.link}

        // Equal Primitives?
        if (a === b
            // But because NaN === NaN returns false:
            || (typeof a === 'number' && typeof b === 'number'
                && isNaN(a) && isNaN(b)))
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
            || (typeof a === 'number' && typeof b === 'number'
                && isNaN(a) && isNaN(b)))
            return null

        // Equal Arrays?
        var a_array = Array.isArray(a), b_array = Array.isArray(b)
        if (a_array !== b_array) return ' = ' + JSON.stringify(b)
        if (a_array) {
            if (a.length === b.length-1
                && deep_equals(a[a.length-1], b[b.length-2])) {
                return '.push(' +JSON.stringify(b[b.length-1]) + ')'
            }
            for (var i=0; i < a.length; i++) {
                var tmp = sorta_diff (a[i], b[i])
                if (tmp)
                    return '['+i+']'+tmp
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
                if (!a.hasOwnProperty(k))
                    return '.' + k +' = '+JSON.stringify(b[k])
            }
            return null
        }

        // Then Not Equal.
        return ' = ' + JSON.stringify(b)
    }

    // This prune() function is a temporary workaround for dealing with nested
    // objects in set() handlers, until we change statebus' behavior.  Right
    // now, it calls .setter only on the top-level state.  But if that state
    // validates, it calls fire() on *every* level of state.  This means that
    // state changes can sneak inside.  Prune() will take out any changes from
    // the nested levels of state in a new object -- replacing them with the
    // existing state from this bus.
    function prune (obj) {
        var bus = this
        obj = bus.clone(obj)
        function recurse (o) {
            // Recurse through each element in arrays
            if (Array.isArray(o))
                for (var i=0; i < o.length; i++)
                    o[i] = recurse(o[i])

            // Recurse through each property on objects
            else if (typeof(o) === 'object')
                if (o !== null && o.key)
                    return bus.get(o.key)
                else
                    for (var k in o)
                        o[k] = recurse(o[k])

            return o
        }

        for (var k in obj)
            obj[k] = recurse(obj[k])
        return obj
    }

    function validate (obj, schema) {
        // XXX Warning:
        //
        // If the programmer plugs a variable in as validation schema type,
        // thinking it's ok cause he'll be seeking an exact match:
        //
        //    var thing // manipulable via user input
        //    bus.validate(obj, {a: thing})
        //
        // An attacker could set `thing' to 'string', 'number', or '*', and
        // suddenly get it to validate anything he wants.
        //
        // I *only* imagine this a tempting way to program if you are seeking
        // an exact match on schema.  So we should consider removing this
        // feature, 3 lines below.

        var optional = false
        if (schema === '*')              return true
        if (obj === schema)              return true  // DANGEROUS API!!!

        if (typeof obj === 'string')     return schema === 'string'
        if (typeof obj === 'number')     return schema === 'number'
        if (typeof obj === 'boolean')    return schema === 'boolean'
        if (       obj === null)         return schema === 'null'
        if (       obj === undefined)    return schema === 'undefined'

        if (Array.isArray(obj))          return schema === 'array'

        if (typeof obj === 'object') {
            if (schema === 'object')     return true
            if (schema === 'link')
                return validate(obj, {link: 'string'})

            if (typeof schema === 'object') {
                for (var k in obj) {
                    var sk
                    if (schema.hasOwnProperty(k))
                        sk = k
                    else if (schema.hasOwnProperty('?'+k))
                        sk = '?'+k
                    else if (schema.hasOwnProperty('*'))
                        sk = '*'
                    else                 return false

                    if (!validate(obj[k], schema[sk]))
                                         return false
                }
                for (var k in schema)
                    if (k[0] !== '?' && k !== '*')
                        if (!(obj.hasOwnProperty(k)))
                                         return false

                return true
            }

            return false
        }

        if (typeof obj == 'function')
            throw 'bus.validate() cannot validate functions'
        console.trace()
        throw "You hit a Statebus bug! Tell the developers!"
    }

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
        case 'get callback':
                return 'get('+def.key+', '+f_string+')'
        case 'reactive':
            return "reactive('"+f_string+"')"
        default:
            return 'UNKNOWN Funky Definition!!!... ???'
        }
    }

    function deps (key) {
        // First print out everything waiting for it to pub
        var result = 'Deps: ('+key+') fires into:'
        var pubbers = bindings(key, 'on_set')
        if (pubbers.length === 0) result += ' nothing'
        for (var i=0; i<pubbers.length; i++)
            result += '\n  ' + funk_name(pubbers[i].func)
        return result
    }

    function log () {
        if (bus.honk === true) indented_log.apply(null, arguments)
    }
    function indented_log () {
        if (nodejs) {
            var indent = ''
            for (var i=0; i<statelog_indent; i++) indent += '   '
            console.log(indent+require('util').format.apply(null,arguments).replace(/\n/g,'\n'+indent))
        } else
            console.log.apply(console, arguments)
    }
    function statelog (key, color, icon, message) {
        if (honking_at(key))
            if (bus.honking_colors === false)
                indented_log(icon + ' ' + message)
            else
                indented_log(color + icon + ' ' + message + normal)
    }
    function honking_at (key) {
        return (bus.honk instanceof RegExp
                ? bus.honk.test(key)
                : bus.honk)
    }
    var bogus_keys = {constructor:1, hasOwnProperty:1, isPrototypeOf:1,
                      propertyIsEnumerable:1, toLocaleString:1, toString:1, valueOf:1,
                      __defineGetter__:1, __defineSetter__:1,
                      __lookupGetter__:1, __lookupSetter__:1, __proto__:1}
    function bogus_check (key) {
        if (!(key in bogus_keys))
            return

        var msg = "Sorry, statebus.js currently prohibits use of the key \""+key+"\", and in fact all of these keys: " + Object.keys(bogus_keys).join(', ') + ".  This is because Javascript is kinda lame, and even empty objects like \"{}\" have the \""+key+"\" field defined on them.  Try typing this in your Javascript console: \"({}).constructor\" -- it returns a function instead of undefined!  Mike needs to work around it by replacing every \"obj[key]\" with \"obj.hasOwnProperty(key) && obj[key]\" in the statebus code, or switching to a Map() object.  Please contact him and let him know where this is impacting you, so he can bump the priority on it."
        console.error(msg)
        throw 'Invalid key'
    }

    // Make these private methods accessible
    var api = ['cache backup_cache get set forget del fire dirty get_once',
               'old_subspace new_subspace bindings run_handler bind unbind reactive uncallback',
               'versions new_version',
               'aget client_bus_for',
               'funk_key funk_name funks key_id key_name id',
               'pending_gets gets_in gets_out loading_keys loading once',
               'global_funk busses rerunnable_funks',
               'link raw translate_keys translate_links apply_patch',
               'translate_fields escape_to_bus unescape_from_bus escape_to_nelson unescape_from_nelson',
               'escape_field_json_to_bus unescape_field_bus_to_json escape_json_to_bus unescape_bus_to_json',
               'ws_mount net_automount message_method',
               'parse Set One_To_Many clone extend deep_map deep_equals prune validate sorta_diff log deps symbols'
              ].join(' ').split(' ')
    for (var i=0; i<api.length; i++)
        bus[api[i]] = eval(api[i])

    bus.delete = bus.del
    bus.executing_funk = function () {return executing_funk}

    // Export globals
    function clientjs_option (option_name) {
        // This function is duplicated in client.js.  Be sure to clone all
        // edits there.
        var script_elem = (
            document.querySelector('script[src*="/client"][src$=".js"]') ||
            document.querySelector('script[src^="client"][src$=".js"]'))
        return script_elem && script_elem.getAttribute(option_name)
    }

    busses[bus.id] = bus
    var this_bus_num = bus_count++

    bus.libs = {}

    if (nodejs)
        // Use require.call() instead of require() to fool jsdelivr.net into ignoring the require
        require.call(null, './server-library').import_server(bus, make_bus, options)

    bus.render_when_loading = true

    return bus
}

if (nodejs)
    // Use require.call() instead of require() to fool jsdelivr.net into ignoring the require
    require.call(null, './server-library').import_module(make_bus)

return make_bus
}))
