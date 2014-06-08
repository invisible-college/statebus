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
        var cache_key = url
        var result = cache[cache_key]
        if (result)
            return result

        // Else, prepare a stub result and start a server_fetch in the
        // background.
        cache[cache_key] = {key: mark_as_loading(cache_key)}
        server_fetch(url, function (obj) {
            update_cache(obj)
            var re_render = (window.re_render || function () {
                console.log('You need to implement re_render()') })
            re_render()
        })
        return cache[cache_key]
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
     *               if (is_loading(this.props)) {
     *                   ... render loading indicator ...
     *               } else {
     *                   ... render normally ...
     *               }
     */
    function is_loading(props) {
        if (props.key && has_loading(props.key))
            return true
        for (var v in props)
            if (props.hasOwnProperty(v))
                if (props[v].key && has_loading(props[v].key))
                    return true
        return false
    }


    // ================================
    // == Internal funcs

    function update_cache(object) {
        // Recurses through object and folds it into the cache.

        // If this object has a key, update the cache for it
        var key = object.key
        if (key) {
            var cached = cache[key]
            if (!cached)
                // This object is new.  Let's cache it.
                cache[key] = object
            else if (object !== cache[key]) {
                // Else, mutate cache to equal the object.

                // We want to mutate it in place so that we don't break
                // pointers to this cache object.
                for (var v in cache[key])
                    delete cache[key][v]
                for (var v in object)
                    cache[key][v] = object[v]
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
                // Make sure the server returns data for the url we asked it for
                console.assert(result.key && result.key.split('?')[0] === url.split('?')[0],
                               'Server returned bad data', result, 'for url', url)
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
    function mark_as_loading(key) {
        return key.split('?')[0] + '?loading'
    }
    function has_loading(key) {
        key = key.split('?')
        if (key.length < 2) return false
        vars = key[1].split('&')
        for (var i=0; i < vars.length; i++) {
            pair = vars[i].split('=')

            // Return true for both "?loading", and "?<key>=loading"
            if (pair[0] === 'loading')
                return true
            if (pair.length > 1 && pair[1] === 'loading')
                return true
        }
        return false
    }


    // Export the public API
    return {fetch: fetch,
            save: save,
            //server_fetch: server_fetch,
            //server_save: server_save,
            is_loading: is_loading,
            isLoading: is_loading} // We support CamelCase too
})()

// Make the API global
for (var key in ActiveREST)
    window[key] = ActiveREST[key]
