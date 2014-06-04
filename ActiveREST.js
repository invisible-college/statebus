// To do:
//  - Test this on consider.it
//  - Transform server_fetch() to use callbacks and asynch ajax
//  - Implement server_save() in the same fashion


var cache = []
function fetch(url) {
    // Check the cache for the url
    var result = cache[url]

    // Fetch from the server if it's missing
    if (!result) {
        result = server_fetch(url)
        result = update_cache(obj)
    }
    return result
}

function server_fetch(url) {
    // This needs to take a callback and become async
    var request = new XMLHttpRequest()
    request.open('GET', url, false)
    request.send(null);
    if (request.status == 200)
        return JSON.parse(request.responseText)

    // return {url: '/proposal/34',
    //         title: 'I am a dog',
    //         description: 'My mother ate a banana',
    //         points: [{url: '/point/82',
    //                   nutshell: 'Bananas R Us',
    //                   is_pro: true},
    //                  {url: '/point/2',
    //                   nutshell: 'Dogs R Bananas',
    //                   is_pro: false}]
    //        }
}

function update_cache(object) {
    // Recurses through object and folds it into the cache.

    // If this object has a url, update the cache for it
    var url = object.url
    if (url) {
        var cached = cache[url]
        if (!cached)
            // This object is new.  Let's cache it.
            cache[url] = object
        else {
            // Else, mutate cache to equal the object.  (We want to
            // mutate it in place so that we don't break pointers to
            // this cache object.)
            for (var key in cache[url])
                if (cache[url].hasOwnProperty(key))
                    // Delete all properties from the cached object
                    delete cache[url][key]
            for (var key in object)
                if (object.hasOwnProperty(key))
                    // Now add in all properties from the new object
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
                object[key] = update_cache(key)

    // Return the new cached representation of this object
    return cache[url] || object
}

function save() {
    // Takes any number of object arguments.  For each:
    //  - Update cache
    //  - Saves to server
    //
    // If called with only a single argument, returns the new cached
    // version of it.

    for (var i=0; i < arguments.length; i++) {
        var object = arguments[i]
        update_cache(object)
        server_save(object)
    }

    // In the future, we can optimize by squeezing multiple save
    // requests into one with this line:
    //server_save.apply(null, arguments)

    if (arguments.length == 1)
        return cache[object.url]
}

function server_save(object) {
    // Jsonify object
    // Do a PUT/UPDATE/whatever request to the server at url for this object.
}