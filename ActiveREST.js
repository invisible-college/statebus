ActiveREST = (function () {
    /*   To do:
          - Make fetch() work for root objects lacking cache key
          - Try connecting to a real React component
          - Implement server_save()
     */

    // ****************
    // Public API
    var cache = {}
    function fetch(url) {
        // Return the cached version if it exists
        var cache_key = url.split('?')[0]
        var result = cache[cache_key]
        if (result)
            return result

        // Else, start a server_fetch in the background and return {}.
        server_fetch(url, function (obj) {
            update_cache(obj)
            var re_render = (window.re_render || function () {
                console.log('You need to implement re_render()') })
            re_render()
        })
        return {}
    }

    /*
     *  Takes any number of object arguments.  For each:
     *  - Update cache
     *  - Saves to server
     *
     *  It supports multiple arguments to allow batching multiple
     *  server_save() calls together in future optimizations.
     */
    function save() {
        for (var i=0; i < arguments.length; i++) {
            var object = arguments[i]
            update_cache(object)
            server_save(object)
        }
    }

    /* Use this inside render() so you know when to show a loading
     * indicator.  Like:
     *
     *     render: function () {
     *               if (is_loaded(object)) {
     *                   ... render normally ...
     *               } else {
     *                   ... render loading indicator ...
     *               }
     */
    function is_loaded(obj, subset) {
        var cached = cache[obj.key]
        if (cached) {
            var cached_subsets = querystring_vals(cached.key, 'subset')
            // Check if fully loaded
            if (cached_subsets == null)
                return true

            // Check if it's loaded for an unlabeled '?subset'
            if (subset === 'subset')
                return cached_subsets.length == 0

            // Check if a labeled subset is present
            if (subset)
                return cached_subsets.indexOf(subset) != -1
        }
        return false
    }


    // ================================
    // == Internal funcs

    function update_cache(object) {
        // Recurses through object and folds it into the cache.

        // If this object has a key, update the cache for it
        var key = object.key && object.key.split('?')[0]
        if (key) {
            var cached = cache[key]
            if (!cached)
                // This object is new.  Let's cache it.
                cache[key] = object
            else if (object !== cached) {
                // Else, mutate cache to equal the object.

                // First let's merge the subset keys
                var old_subsets = querystring_vals(cached.key, 'subset')
                var new_subsets = querystring_vals(object.key, 'subset')
                var merged_subsets = array_union(old_subsets || [],
                                                 new_subsets || [])

                // We want to mutate it in place so that we don't break
                // pointers to this cache object.
                for (var v in cache[key])
                    delete cache[key][v]
                for (var v in object)
                    cache[key][v] = object[v]

                if (merged_subsets.length > 0)
                    // I'll have to generalize this later if we want
                    // it to support params in urls beyond 'subset'
                    // ... right now it wipes out all other params.
                    cache[key].key = key + '?subset=' + merged_subsets.join(',')
            }
        }

        // Now recurse into this object.
        //  - Through each element in arrays
        //  - And each property on objects
        if (Array.isArray(object))
            for (var i=0; i < object.length; i++)
                object[i] = update_cache(object[i])
        else if (typeof(object) === 'object')
            for (var v in object)
                object[v] = update_cache(object[v])

        // Return the new cached representation of this object
        return cache[key] || object
    }

    function server_fetch(url, callback) {
        // This needs to take a callback and become async
        var request = new XMLHttpRequest()
        request.onload = function () {
            if (request.status === 200) {
                var result = JSON.parse(request.responseText)
                // Warn if the server returns data for a different url than we asked it for
                console.assert(result.key && result.key.split('?')[0] === url.split('?')[0],
                               'Server returned data with unexpected key', result, 'for url', url)
                callback(result)
            }
        }

        request.open('GET', url, true)
        request.send(null);
    }

    function server_save(object) {
        // XXX unimplemented XXX
        // Jsonify object
        // Do a PUT/UPDATE/whatever request to the server at url for this object.
    }



    // ******************
    // Internal key helpers
    function querystring_vals(query, variable) {
        var params = query.split('?')[1]
        if (!params) return null
        params = params.split('&')
        for (var i=0; i<params.length; i++) {
            var param = params[i].split('=')
            if (param.length < 2) continue
            var param_variable = param[0]
            var param_value = param[1]
            if (param_variable.toLowerCase() === variable.toLowerCase())
                return param_value.split(',')
        }
        return null
    }

    function array_union(array1, array2) {
        var hash = {}

        for (var i=0; i<array1.length; i++)
            hash[array1[i]] = true
        for (var i=0; i<array2.length; i++)
            hash[array2[i]] = true

        return Object.keys(hash)
    }

    // Export the public API
    return {fetch: fetch,
            save: save,
            is_loaded: is_loaded,
            isLoaded: is_loaded} // We support CamelCase too
})()

// Make the API global
for (var key in ActiveREST)
    window[key] = ActiveREST[key]
