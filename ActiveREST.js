ActiveREST = (function () {
    // To do:
    //  - Test this on consider.it
    //    - Connect 
    //  - Implement server_save()


    // ****************
    // Public API
    var cache = {}
    function fetch(url) {
        // Return the cached version if it exists
        var result = cache[url]
        if (result)
            return result

        // Else, prepare a stub result and start a server_fetch in the
        // background.
        cache[url] = {url: mark_as_loading(url)}
        server_fetch(url, function (obj) {
            update_cache(obj)
            re_render()
        })
        return cache[url]
    }

    /** 
        Takes any number of object arguments.  For each:
        - Update cache
        - Saves to server

        It supports multiple arguments to allow batching multiple
        server_save() calls together in future optimizations.
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
        function has_loading(url) {
            url = url.split('?')
            if (url.length < 2) return false
            vars = url[1].split('&')
            for (var i=0; i < vars.length; i++) {
                pair = vars[i].split('=')

                // Return true for both "?loading", and "?<key>=loading"
                if (pair[0] == 'loading')
                    return true
                if (pair.length > 1 && pair[1] == 'loading')
                    return true
            }
            return false
        }
        for (var key in props)
            if (props.hasOwnProperty(key))
                if (props[key].url && has_loading(props[key].url))
                    return true
        return false
    }


    // ================================
    // == Internal funcs

    function update_cache(object) {
        // Recurses through object and folds it into the cache.

        // If this object has a url, update the cache for it
        var url = object.url
        if (url) {
            var cached = cache[url]
            if (!cached)
                // This object is new.  Let's cache it.
                cache[url] = object
            else if (object !== cache[url]) {
                // Else, mutate cache to equal the object.

                // We want to mutate it in place so that we don't break
                // pointers to this cache object.
                for (var key in cache[url])
                    delete cache[url][key]
                for (var key in object)
                    cache[url][key] = object[key]
            }
        }

        // Now recurse into this object.
        //  - Through each element in arrays
        //  - And each property on objects
        if (Array.isArray(object))
            for (var i=0; i < object.length; i++)
                object[i] = update_cache(object[i])
        else if (typeof(object) == 'object')
            for (var key in object)
                if (object.hasOwnProperty(key))
                    object[key] = update_cache(object[key])

        // Return the new cached representation of this object
        return cache[url] || object
    }

    function server_fetch(url, callback) {
        // This needs to take a callback and become async
        var request = new XMLHttpRequest()
        request.onload = function () {
            if (request.status == 200) {
                var result = JSON.parse(request.responseText)
                // Make sure the server returns data for the url we asked it for
                console.assert(result.url && result.url.split('?')[0] == url.split('?')[0],
                               'Server returned bad data', result, 'for url', url)
                callback(result)
            }
        }
        
        request.open('GET', url, true)
        request.send(null);
    }

    function server_save(object) {
        // Jsonify object
        // Do a PUT/UPDATE/whatever request to the server at url for this object.
    }

    function re_render() {
        // At some point this should redraw the react shit
    }


    // ******************
    // Internal url helpers

    function mark_as_loading(url) {
        return url.split('?')[0] + '?loading'
    }


    // Export the public API
    return {fetch: fetch,
            save: save,
            server_fetch: server_fetch,
            server_save: server_save,
            is_loading: is_loading}
})()

// Make the API global
for (var key in ActiveREST)
    window[key] = ActiveREST[key]