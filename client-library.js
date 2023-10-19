(function () {
    var websocket_prefix = (clientjs_option('websocket_path')
                            || '_connect_to_statebus_')

    // make_client_statebus_maker()
    window.bus = window.statebus()
    bus.label = 'bus'

    bus.libs = {}
    bus.libs.react12 = {}
    bus.libs.react17 = {}

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
    bus.client_creds = function client_creds () {
        // This function is only used for websocket connections.
        // http connections set the cookie on the server.
        var me = JSON.parse(localStorage['ls/me'])
        bus.log('connect: me is', me)
        if (!me.client) {
            // Create a client id if we have none yet.
            // Either from a cookie set by server, or a new one from scratch.
            var c = get_cookie('peer')
            me.client = c || (Math.random().toString(36).substring(2)
                              + Math.random().toString(36).substring(2)
                              + Math.random().toString(36).substring(2))
            localStorage['ls/me'] = JSON.stringify(me)
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
            var the_put = puts.get(id)
            try {
                console.log('Sending a put!', {
                    patches: the_put.patches,
                    body: the_put.body
                })

                the_put.status = 'sending'
                braid_fetch(
                    the_put.url,
                    {
                        method: 'put',
                        headers: {
                            'content-type': 'application/json',
                            'put-order': id,
                            'peer': bus.client_creds().clientid
                        },
                        body: the_put.body,
                        patches: the_put.patches
                    }
                ).then(function (res) {
                    if (res.status === 200) {
                        console.log('PUT succeeded!')
                        puts.delete(id)
                    }
                    else
                        console.error(
                            'Server gave error on PUT:', e,
                            'for', {body: the_put.body, patches: the_put.patches}
                        )
                }).catch(function (e) {
                    console.error(e, 'Error on PUT, waiting...', the_put.url)
                    the_put.status = 'waiting'
                })
            } catch (e) {
                console.error(e, 'Error on PUT, waiting...', the_put.url)
                the_put.status = 'waiting'
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

            var put = {url: url + rem_prefix(obj.key)}

            // Set the version and parents
            if (t.version) put.version = t.version
            if (t.parents) put.parents = t.parents

            // Do we have patches?
            if (t.patch) {
                put.patches = t.patch.map(patch => {
                    var match = patch.match(/(.*) = (.*)/),
                        range = match[1],
                        content = match[2]
                    return {unit: 'json', range, content}
                })
            }
            // Then we just have a simple body.
            else put.body = JSON.stringify(obj.val)

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
                    reconnect_attempts = 0,
                    reconnect = (e) => {
                        if (subscriptions[key].status === 'aborted') {
                            // Then this get is over and done with!
                            delete subscriptions[key]
                            return
                        }

                        // Else, reconnect!
                        setTimeout(() => subscribe(key, t),
                                   reconnect_attempts > 0 ? 5000 : 1500)
                        subscriptions[key].status = 'reconnecting'
                        reconnect_attempts++
                    }

                // Start the subscription!
                braid_fetch(
                    // URL
                    url + rem_prefix(key),

                    // Options
                    {
                        method: 'get',
                        subscribe: true,
                        headers: {accept: 'application/json'},
                        signal: aborter.signal,
                        // credentials: 'include'
                    }
                ).then(res => res.subscribe(
                    new_version => {
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
                    },
                    reconnect
                )).catch(reconnect)

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


    // ****************
    // Wrapper for React Components

    function react_version () {
        if (!window.React) return undefined;
        return Number(window.React.version.split('.')[0])
    }

    // Newer React requires createReactClass as a separate libary
    if (window.React && !React.createClass && window.createReactClass)
        React.createClass = createReactClass

    // XXX Currently assumes there's a statebus named "bus" in global
    // XXX scope.

    var components = {}                  // Indexed by 'component/0', 'component/1', etc.
    var components_count = 0
    var dirty_components = {}
    function create_react_class(component) {
        function wrap(name, new_func) {
            var old_func = component[name]
            component[name] = function wrapper () { return new_func.bind(this)(old_func) }
        }
        
        // Register the component's basic info
        wrap((react_version() >= 16 ? 'UNSAFE_' : '') + 'componentWillMount',
             function new_cwm (orig_func) {
            // if (component.displayName === undefined)
            //     throw 'Component needs a displayName'
            //this.name = component.displayName.toLowerCase().replace(' ', '_')
            this.key = 'component/' + components_count++
            components[this.key] = this

            function add_shortcut (obj, shortcut_name, to_key) {
                delete obj[shortcut_name]
                Object.defineProperty(obj, shortcut_name, {
                    get: function () { return bus.get(to_key) },
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

                    // Add reactivity to any keys passed inside objects in props.
                    for (var k in this.props)
                        if (this.props.hasOwnProperty(k)
                            && this.props[k] !== null
                            && typeof this.props[k] === 'object'
                            && this.props[k].key)
                            
                            bus.get(this.props[k].key)
                    
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

        function shallow_clone(original) {
            var clone = Object.create(Object.getPrototypeOf(original))
            var i, keys = Object.getOwnPropertyNames(original)
            for (i=0; i < keys.length; i++){
                Object.defineProperty(clone, keys[i],
                    Object.getOwnPropertyDescriptor(original, keys[i])
                )
            }
            return clone
        }

        component.shouldComponentUpdate = function new_scu (next_props, next_state) {
            // This component definitely needs to update if it is marked as dirty
            if (dirty_components[this.key] !== undefined) return true

            // Otherwise, we'll check to see if its state or props
            // have changed.  But ignore React's 'children' prop,
            // because it often has a circular reference.
            next_props = shallow_clone(next_props)
            this_props = shallow_clone(this.props)

            delete next_props['children']; delete this_props['children']
            // delete next_props['kids']; delete this_props['kids']

            next_props = bus.clone(next_props)
            this_props = bus.clone(this_props)
            

            return !bus.deep_equals([next_state, next_props], [this.state, this_props])

            // TODO:
            //
            //  - Check children too.  Right now we just silently fail
            //    on components with children.  WTF?
            //
            //  - A better method might be to mark a component dirty when
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
            props['data-key'] = props.key
            props['data-widget'] = component.displayName

            return React.createElement(react_class, props, children)
        }
        Object.defineProperty(result, 'name',
                              {value: component.displayName, writable: false})
        return result
    }

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

    // function make_client_statebus_maker () {
    //     var extra_stuff = ['make_websocket client_creds',
    //                        'url_store components'].join(' ').split(' ')
    //     if (window.statebus) {
    //         var orig_statebus = statebus
    //         window.statebus = function make_client_bus () {
    //             var bus = orig_statebus()
    //             for (var i=0; i<extra_stuff.length; i++)
    //                 bus[extra_stuff[i]] = eval(extra_stuff[i])
    //             return bus
    //         }
    //     }
    // }

    function clientjs_option (option_name) {
        // This function must be copy/paste synchronized with statebus.js.  Be
        // sure to clone all edits there.
        var script_elem = document.querySelector('script[src$="statebus/client.js"]')
        return script_elem && script_elem.getAttribute(option_name)
    }
    var loaded_from_file_url = window.location.href.match(/^file:\/\//)

    // Todo: remove this global
    window.statebus_server = clientjs_option('server')

    function is_css_prop (name) {
        if (!is_css_prop.memoized) {
            // Precompute all the css props
            is_css_prop.memoized = {}

            // We used to get all_css_props like this:
            //
            //   var all_css_props = Object.keys(document.body.style)
            //   if (all_css_props.length < 100) // Firefox
            //       all_css_props = Object.keys(document.body.style.__proto__)
            //
            // But now I've hard-coded them:
            var all_css_props = ["alignContent","alignItems","alignSelf","alignmentBaseline","all","animation","animationDelay","animationDirection","animationDuration","animationFillMode","animationIterationCount","animationName","animationPlayState","animationTimingFunction","backfaceVisibility","background","backgroundAttachment","backgroundBlendMode","backgroundClip","backgroundColor","backgroundImage","backgroundOrigin","backgroundPosition","backgroundPositionX","backgroundPositionY","backgroundRepeat","backgroundRepeatX","backgroundRepeatY","backgroundSize","baselineShift","blockSize","border","borderBottom","borderBottomColor","borderBottomLeftRadius","borderBottomRightRadius","borderBottomStyle","borderBottomWidth","borderCollapse","borderColor","borderImage","borderImageOutset","borderImageRepeat","borderImageSlice","borderImageSource","borderImageWidth","borderLeft","borderLeftColor","borderLeftStyle","borderLeftWidth","borderRadius","borderRight","borderRightColor","borderRightStyle","borderRightWidth","borderSpacing","borderStyle","borderTop","borderTopColor","borderTopLeftRadius","borderTopRightRadius","borderTopStyle","borderTopWidth","borderWidth","bottom","boxShadow","boxSizing","breakAfter","breakBefore","breakInside","bufferedRendering","captionSide","caretColor","clear","clip","clipPath","clipRule","color","colorInterpolation","colorInterpolationFilters","colorRendering","columnCount","columnFill","columnGap","columnRule","columnRuleColor","columnRuleStyle","columnRuleWidth","columnSpan","columnWidth","columns","contain","content","counterIncrement","counterReset","cursor","cx","cy","d","direction","display","dominantBaseline","emptyCells","fill","fillOpacity","fillRule","filter","flex","flexBasis","flexDirection","flexFlow","flexGrow","flexShrink","flexWrap","float","floodColor","floodOpacity","font","fontDisplay","fontFamily","fontFeatureSettings","fontKerning","fontSize","fontStretch","fontStyle","fontVariant","fontVariantCaps","fontVariantEastAsian","fontVariantLigatures","fontVariantNumeric","fontVariationSettings","fontWeight","gap","grid","gridArea","gridAutoColumns","gridAutoFlow","gridAutoRows","gridColumn","gridColumnEnd","gridColumnGap","gridColumnStart","gridGap","gridRow","gridRowEnd","gridRowGap","gridRowStart","gridTemplate","gridTemplateAreas","gridTemplateColumns","gridTemplateRows","height","hyphens","imageRendering","inlineSize","isolation","justifyContent","justifyItems","justifySelf","left","letterSpacing","lightingColor","lineBreak","lineHeight","listStyle","listStyleImage","listStylePosition","listStyleType","margin","marginBottom","marginLeft","marginRight","marginTop","marker","markerEnd","markerMid","markerStart","mask","maskType","maxBlockSize","maxHeight","maxInlineSize","maxWidth","maxZoom","minBlockSize","minHeight","minInlineSize","minWidth","minZoom","mixBlendMode","objectFit","objectPosition","offset","offsetDistance","offsetPath","offsetRotate","opacity","order","orientation","orphans","outline","outlineColor","outlineOffset","outlineStyle","outlineWidth","overflow","overflowAnchor","overflowWrap","overflowX","overflowY","overscrollBehavior","overscrollBehaviorX","overscrollBehaviorY","padding","paddingBottom","paddingLeft","paddingRight","paddingTop","page","pageBreakAfter","pageBreakBefore","pageBreakInside","paintOrder","perspective","perspectiveOrigin","placeContent","placeItems","placeSelf","pointerEvents","position","quotes","r","resize","right","rowGap","rx","ry","scrollBehavior","shapeImageThreshold","shapeMargin","shapeOutside","shapeRendering","size","speak","src","stopColor","stopOpacity","stroke","strokeDasharray","strokeDashoffset","strokeLinecap","strokeLinejoin","strokeMiterlimit","strokeOpacity","strokeWidth","tabSize","tableLayout","textAlign","textAlignLast","textAnchor","textCombineUpright","textDecoration","textDecorationColor","textDecorationLine","textDecorationSkipInk","textDecorationStyle","textIndent","textOrientation","textOverflow","textRendering","textShadow","textSizeAdjust","textTransform","textUnderlinePosition","top","touchAction","transform","transformBox","transformOrigin","transformStyle","transition","transitionDelay","transitionDuration","transitionProperty","transitionTimingFunction","unicodeBidi","unicodeRange","userSelect","userZoom","vectorEffect","verticalAlign","visibility","webkitAlignContent","webkitAlignItems","webkitAlignSelf","webkitAnimation","webkitAnimationDelay","webkitAnimationDirection","webkitAnimationDuration","webkitAnimationFillMode","webkitAnimationIterationCount","webkitAnimationName","webkitAnimationPlayState","webkitAnimationTimingFunction","webkitAppRegion","webkitAppearance","webkitBackfaceVisibility","webkitBackgroundClip","webkitBackgroundOrigin","webkitBackgroundSize","webkitBorderAfter","webkitBorderAfterColor","webkitBorderAfterStyle","webkitBorderAfterWidth","webkitBorderBefore","webkitBorderBeforeColor","webkitBorderBeforeStyle","webkitBorderBeforeWidth","webkitBorderBottomLeftRadius","webkitBorderBottomRightRadius","webkitBorderEnd","webkitBorderEndColor","webkitBorderEndStyle","webkitBorderEndWidth","webkitBorderHorizontalSpacing","webkitBorderImage","webkitBorderRadius","webkitBorderStart","webkitBorderStartColor","webkitBorderStartStyle","webkitBorderStartWidth","webkitBorderTopLeftRadius","webkitBorderTopRightRadius","webkitBorderVerticalSpacing","webkitBoxAlign","webkitBoxDecorationBreak","webkitBoxDirection","webkitBoxFlex","webkitBoxOrdinalGroup","webkitBoxOrient","webkitBoxPack","webkitBoxReflect","webkitBoxShadow","webkitBoxSizing","webkitClipPath","webkitColumnBreakAfter","webkitColumnBreakBefore","webkitColumnBreakInside","webkitColumnCount","webkitColumnGap","webkitColumnRule","webkitColumnRuleColor","webkitColumnRuleStyle","webkitColumnRuleWidth","webkitColumnSpan","webkitColumnWidth","webkitColumns","webkitFilter","webkitFlex","webkitFlexBasis","webkitFlexDirection","webkitFlexFlow","webkitFlexGrow","webkitFlexShrink","webkitFlexWrap","webkitFontFeatureSettings","webkitFontSizeDelta","webkitFontSmoothing","webkitHighlight","webkitHyphenateCharacter","webkitJustifyContent","webkitLineBreak","webkitLineClamp","webkitLocale","webkitLogicalHeight","webkitLogicalWidth","webkitMarginAfter","webkitMarginAfterCollapse","webkitMarginBefore","webkitMarginBeforeCollapse","webkitMarginBottomCollapse","webkitMarginCollapse","webkitMarginEnd","webkitMarginStart","webkitMarginTopCollapse","webkitMask","webkitMaskBoxImage","webkitMaskBoxImageOutset","webkitMaskBoxImageRepeat","webkitMaskBoxImageSlice","webkitMaskBoxImageSource","webkitMaskBoxImageWidth","webkitMaskClip","webkitMaskComposite","webkitMaskImage","webkitMaskOrigin","webkitMaskPosition","webkitMaskPositionX","webkitMaskPositionY","webkitMaskRepeat","webkitMaskRepeatX","webkitMaskRepeatY","webkitMaskSize","webkitMaxLogicalHeight","webkitMaxLogicalWidth","webkitMinLogicalHeight","webkitMinLogicalWidth","webkitOpacity","webkitOrder","webkitPaddingAfter","webkitPaddingBefore","webkitPaddingEnd","webkitPaddingStart","webkitPerspective","webkitPerspectiveOrigin","webkitPerspectiveOriginX","webkitPerspectiveOriginY","webkitPrintColorAdjust","webkitRtlOrdering","webkitRubyPosition","webkitShapeImageThreshold","webkitShapeMargin","webkitShapeOutside","webkitTapHighlightColor","webkitTextCombine","webkitTextDecorationsInEffect","webkitTextEmphasis","webkitTextEmphasisColor","webkitTextEmphasisPosition","webkitTextEmphasisStyle","webkitTextFillColor","webkitTextOrientation","webkitTextSecurity","webkitTextSizeAdjust","webkitTextStroke","webkitTextStrokeColor","webkitTextStrokeWidth","webkitTransform","webkitTransformOrigin","webkitTransformOriginX","webkitTransformOriginY","webkitTransformOriginZ","webkitTransformStyle","webkitTransition","webkitTransitionDelay","webkitTransitionDuration","webkitTransitionProperty","webkitTransitionTimingFunction","webkitUserDrag","webkitUserModify","webkitUserSelect","webkitWritingMode","whiteSpace","widows","width","willChange","wordBreak","wordSpacing","wordWrap","writingMode","x","y","zIndex","zoom"]

            var ignore = {d:1, cx:1, cy:1, rx:1, ry:1, x:1, y:1,
                          content:1, fill:1, stroke:1, src:1}

            for (var i=0; i<all_css_props.length; i++)
                if (!ignore[all_css_props[i]])
                    is_css_prop.memoized[all_css_props[i]] = true
        }
        return is_css_prop.memoized[name]
    }

    // ================================================================
    // React v12 Support

    bus.libs.react12.improve_react = () => {

        function better_element(el) {
            // To do:
            //  - Don't put all args into a children array, cause react thinks
            //    that means they need a key.

            return function () {
                var children = []
                var attrs = {style: {}}
                
                for (var i=0; i<arguments.length; i++) {
                    var arg = arguments[i]

                    // Strings and DOM nodes and undefined become children
                    if (typeof arg === 'string'   // For "foo"
                        || arg instanceof String  // For new String()
                        || arg && React.isValidElement(arg)
                        || arg === undefined)
                        children.push(arg)

                    // Arrays append onto the children
                    else if (arg instanceof Array)
                        Array.prototype.push.apply(children, arg)

                    // Pure objects get merged into object city
                    // Styles get redirected to the style field
                    else if (arg instanceof Object)
                        for (var k in arg)
                            if (is_css_prop(k)
                                && !(k in {width:1,height:1,size:1}
                                     && el in {canvas:1, input:1, embed:1, object:1}))
                                attrs.style[k] = arg[k]        // Merge styles
                            else if (k === 'style')            // Merge insides of style tags
                                for (var k2 in arg[k])
                                    attrs.style[k2] = arg[k][k2]
                            else {
                                attrs[k] = arg[k]          // Or be normal.

                                if (k === 'key')
                                    attrs['data-key'] = arg[k]
                            }
                }
                if (children.length === 0) children = undefined
                if (attrs['ref'] === 'input')
                    bus.log(attrs, children)
                return React.DOM[el](attrs, children)
            }
        }
        for (var el in React.DOM)
            window[el.toUpperCase()] = better_element(el)
        
        // Fixes React controlled textarea widgets so they can work with state
        // updates triggered by forceUpdate, rather than just setState(),
        // because statebus keeps its own state outside of React's setState(),
        // but react doesn't know how to preserve the cursor (and selection)
        // position for updates unless they go through setState().  So this
        // function just wraps input widgets with a component that uses
        // setState().
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

        make_better_input("INPUT", window.INPUT)
        make_better_input("TEXTAREA", window.TEXTAREA)
        make_syncarea()

        // Make IMG accept data from state:
        var og_img = window.IMG
        window.IMG = function () {
            var args = []
            for (var i=0; i<arguments.length; i++) {
                args.push(arguments[i])
                if (arguments[i].state)
                    args[i].src = 'data:;base64,' + bus.get(args[i].state)._
            }
            return og_img.apply(this, args)
        }


        // Unfortunately, React's default STYLE and TITLE tags are useless
        // unless you "dangerously set inner html" because they wrap strings
        // inside useless spans.
        function escape_html (s) {
            // TODO: this will fail on '<' and '>' in CSS selectors
            return s.replace(/</g, "&lt;").replace(/>/g, "&gt;")
        }
        window.STYLE = function (s) {
            return React.DOM.style({dangerouslySetInnerHTML: {__html: escape_html(s)}})
        }
        window.TITLE = function (s) {
            return React.DOM.title({dangerouslySetInnerHTML: {__html: escape_html(s)}})
        }
    }

    bus.libs.react17.reactive_dom = () => {
        // The window.dom object lets the user define new react components as
        // functions
        window.dom = window.dom || new Proxy({}, {
            get: function (o, k) { return o[k] },
            set: function (o, k, v) {
                o[k] = v
                window[k] = make_component(k, v)
                return true
            }
        })

        // We'll define functions for all HTML tags...
        var function_for_tag = (tag) =>
            (...arguments) => {
                var children = []
                var attrs = {style: {}}
                
                for (var i=0; i<arguments.length; i++) {
                    var arg = arguments[i]

                    if (arg === undefined)
                        continue

                    // Strings, DOM nodes, and arrays become children
                    else if (typeof arg === 'string'   // For "foo"
                        || arg instanceof String  // For new String()
                        || arg && React.isValidElement(arg)
                        || arg instanceof Array)
                        children.push(arg)

                    // // Arrays append onto the children
                    // else if (arg instanceof Array)
                    //     Array.prototype.push.apply(children, arg)

                    // Pure objects get merged into object city
                    // Styles get redirected to the style field
                    else if (arg instanceof Object)
                        for (var k in arg)
                            if (is_css_prop(k)
                                && !(k in {width:1,height:1,size:1}
                                     && tag in {canvas:1, input:1, embed:1, object:1}))
                                attrs.style[k] = arg[k]        // Merge styles
                            else if (k === 'style')            // Merge insides of style tags
                                for (var k2 in arg[k])
                                    attrs.style[k2] = arg[k][k2]
                            else
                                attrs[k] = arg[k]          // Or be normal.
                }

                // Now call React.createElement(tag, attrs, children...)
                return React.createElement.apply(
                    null,
                    [tag, attrs].concat(children)
                )
            }

        // ... or at least most of them -- there are just a few missing from
        // this list.
        var all_tags = 'a,abbr,address,area,article,aside,audio,b,base,bdi,bdo,blockquote,br,button,canvas,caption,cite,code,col,colgroup,data,datalist,dd,del,details,dfn,dialog,div,dl,dt,em,embed,fieldset,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,head,header,hgroup,hr,html,i,iframe,img,ins,kbd,label,legend,li,link,main,map,mark,menu,meta,meter,nav,noscript,object,ol,optgroup,option,output,p,param,picture,pre,progress,q,s,samp,script,section,select,slot,small,source,span,strong,style,sub,summary,sup,svg,table,tbody,td,template,tfoot,th,thead,title,tr,u,ul,video,input,circle,ellipse,g,image,line,path,polygon,polyline,rect,switch,symbol,text,textPath,tspan,use'.split(',')
        all_tags.forEach((tagname) => {
            window[tagname.toUpperCase()] = function_for_tag(tagname)
        })

        // We create special functions for INPUT and TEXTAREA, because they
        // have to do extra work to maintain the cursor when we use statebus
        // instead of React's setState() for state updates.
        window.INPUT    = function_for_tag(bus.libs.react17.input)
        window.TEXTAREA = function_for_tag(bus.libs.react17.textarea)


        // Improve the functions ^^^ put this above
        function better_element(el) {
            // To do:
            //  - Don't put all args into a children array, cause react thinks
            //    that means they need a key.

            return function () {
                var children = []
                var attrs = {style: {}}
                
                for (var i=0; i<arguments.length; i++) {
                    var arg = arguments[i]

                    // Strings and DOM nodes and undefined become children
                    if (typeof arg === 'string'   // For "foo"
                        || arg instanceof String  // For new String()
                        || arg && React.isValidElement(arg)
                        || arg === undefined)
                        children.push(arg)

                    // Arrays append onto the children
                    else if (arg instanceof Array)
                        Array.prototype.push.apply(children, arg)

                    // Pure objects get merged into object city
                    // Styles get redirected to the style field
                    else if (arg instanceof Object)
                        for (var k in arg)
                            if (is_css_prop(k)
                                && !(k in {width:1,height:1,size:1}
                                     && el in {canvas:1, input:1, embed:1, object:1}))
                                attrs.style[k] = arg[k]        // Merge styles
                            else if (k === 'style')            // Merge insides of style tags
                                for (var k2 in arg[k])
                                    attrs.style[k2] = arg[k][k2]
                            else {
                                attrs[k] = arg[k]          // Or be normal.

                                if (k === 'key')
                                    attrs['data-key'] = arg[k]
                            }
                }
                if (children.length === 0) children = undefined
                return React.DOM[el](attrs, children)
            }
        }
    }

    // Fixes React controlled textarea widgets so they can work with state
    // updates triggered by forceUpdate, rather than just setState(),
    // because statebus keeps its own state outside of React's setState(),
    // but react doesn't know how to preserve the cursor (and selection)
    // position for updates unless they go through setState().  So this
    // function just wraps input widgets with a component that uses
    // setState().
    //
    // This one is for react v17+.
    function make_fixed_textbox (tagname) {
        // `tagname` can be either "input" or "textarea"

        // Create a special component
        var component = createReactClass({
            getInitialState: function() {
                return {value: this.props.value}
            },
            UNSAFE_componentWillReceiveProps: function(new_props) {
                this.setState({value: new_props.value})
            },
            onChange: function(e) {
                this.props.onChange && this.props.onChange(e)
                if (this.props.value)
                    this.setState({value: e.target.value})
            },
            onInput: function(e) {
                this.props.onInput && this.props.onInput(e)
                if (this.props.value)
                    this.setState({value: e.target.value})
            },
            render: function() {
                var new_props = {
                    ...this.props,
                    ref: this.props.forwarded_ref   // We had to rename ref
                }
                delete new_props.forwarded_ref      // Delete the old name

                // Now replace any onChange or onInput with our wrapper handlers
                if (new_props.hasOwnProperty('onChange'))
                    new_props.onChange = this.onChange
                if (new_props.hasOwnProperty('onInput'))
                    new_props.onInput = this.onInput

                return React.createElement(tagname, new_props)
            }
        })

        // But react components don't pass through the `ref` prop by default,
        // so we have to do that with this special function and rename it to
        // forwarded_ref temporarily:
        return React.forwardRef((props, ref) => {
            return React.createElement(component, {...props, forwarded_ref: ref})
        })
    }

    // We create special functions for INPUT and TEXTAREA, because they
    // have to do extra work to maintain the cursor when we use statebus
    // instead of React's setState() for state updates.
    if (window.React && !React.createClass && window.createReactClass) {
        bus.libs.react17.input = make_fixed_textbox('input')
        bus.libs.react17.textarea = make_fixed_textbox('textarea')
    }
    function autodetect_args (func) {
        if (func.args) return

        // Get an array of the func's params
        var comments = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg,
            params = /([^\s,]+)/g,
            s = func.toString().replace(comments, '')
        func.args = s.slice(s.indexOf('(')+1, s.indexOf(')')).match(params) || []
    }

    // Load the components
    var users_widgets = {}
    function make_component(name, func) {
        // Define the component
        return users_widgets[name] = create_react_class({
            displayName: name,
            render: function () {
                var args = []

                // Parse the function's args, and pass props into them directly
                autodetect_args(func)
                // this.props.kids = this.props.kids || this.props.children
                for (var i=0; i<func.args.length; i++)
                    args.push(this.props[func.args[i]])

                // Now run the function.
                var vdom = func.apply(this, args)

                // This automatically adds two attributes "data-key" and
                // "data-widget" to the root node of every react component.
                // I think we might wanna find a better solution.
                if (vdom && vdom.props) {
                    vdom.props['data-widget'] = name
                    vdom.props['data-key'] = this.props['data-key']
                }

                // Wrap plain JS values with SPAN, so react doesn't complain
                // if (!React.isValidElement(vdom))
                //     // To do: should arrays be flattened into a SPAN's arguments?
                //     vdom = React.DOM.span(null, (typeof vdom === 'string')
                //                           ? vdom : JSON.stringify(vdom))
                return vdom
            },
            componentDidMount: function () {
                var refresh = func.refresh
                refresh && refresh.bind(this)()
            },
            componentWillUnmount: function () {
                var down = func.down
                return down && down.bind(this)()
            },
            componentDidUpdate: function () {
                if (!this.initial_render_complete && !this.loading()) {
                    this.initial_render_complete = true
                    var up = func.up
                    up && up.bind(this)()
                }
                var refresh = func.refresh
                return refresh && refresh.bind(this)()
            },
            getInitialState: function () { return {} }
        })
    }

    function compile_coffee (coffee, filename) {
        var compiled
        try {
            compiled = CoffeeScript.compile(coffee,
                                            {bare: true,
                                             sourceMap: true,
                                             filename: filename})
            var source_map = JSON.parse(compiled.v3SourceMap)
            source_map.sourcesContent = coffee
            compiled = compiled.js

            // Base64 encode the source map
            try {
                compiled += '\n'
                compiled += '//# sourceMappingURL=data:application/json;base64,'
                compiled += btoa(JSON.stringify(source_map)) + '\n'
                compiled += '//# sourceURL=' + filename
            } catch (e) {}  // btoa() fails on unicode. Give up for now.

        } catch (error) {
            if (error.location)
                console.error('Syntax error in '+ filename + ' on line',
                              error.location.first_line
                              + ', column ' + error.location.first_column + ':',
                              error.message)
            else throw error
        }
        return compiled
    }
    function load_client_code (code) {
        // What is this function for?
        var dom = {}
        if (code)
            eval(code)
        else
            dom = window.dom
        for (var widget_name in dom)
            window.dom[widget_name] = dom[widget_name]
    }
    function load_coffee () {
        load_client_code()
        var scripts = document.getElementsByTagName("script")
        var filename = location.pathname.substring(location.pathname.lastIndexOf('/') + 1)
        for (var i=0; i<scripts.length; i++)
            if (scripts[i].getAttribute('type')
                in {'statebus':1, 'coffeedom':1,'statebus-js':1,
                    'coffee':1, 'coffeescript':1}) {

                if (!window.CoffeeScript) {
                    console.error('Cannot load <script type="coffee"> because coffeescript library isn\'t present')
                    return
                }
                // Compile coffeescript to javascript
                var compiled = scripts[i].text
                if (scripts[i].getAttribute('type') !== 'statebus-js')
                    compiled = compile_coffee(scripts[i].text, filename)
                if (compiled)
                    load_client_code(compiled)
            }
    }

    function dom_to_widget (node) {
        if (node.nodeName === '#text') return node.textContent
        if (!(node.nodeName in users_widgets)) return node

        node.seen = true
        var children = [], props = {}
        // Recursively convert children
        for (var i=0; i<node.childNodes.length; i++)
            children.push(dom_to_widget(node.childNodes[i]))  // recurse

        // Convert attributes to props
        var props = {}
        for (var i=0; node.attributes && i<node.attributes.length; i++)
            props[node.attributes[i].name] = node.attributes[i].value

        var widge = (window[node.nodeName.toLowerCase()]
                     || window[node.nodeName.toUpperCase()])
        console.assert(widge, node.nodeName + ' has not been defined as a UI widget.')

        return widge(props, children)
    }

    // var react_render = ReactDOM.render
    // window.users_widgets = users_widgets
    // function load_widgets () {
    //     for (var w in users_widgets) {
    //         var nodes = document.getElementsByTagName(w)
    //         for (var i=0; i<nodes.length; i++)
    //             if (!nodes[i].seen)
    //                 react_render(dom_to_widget(nodes[i]), nodes[i])
    //     }
    // }


    bus.libs.react17.react_class = create_react_class
    bus.libs.react17.coffreact = () => {
        bus.libs.react17.reactive_dom()
        load_coffee()
        if (dom.BODY)
            document.addEventListener(
                'DOMContentLoaded',
                () => {
                    var root = document.createElement('root')
                    document.body.appendChild(root)
                    ReactDOM.render(BODY(), root)
                },
                false
            )
    }

    // if (statebus_server !== 'none') {
    //     if (clientjs_option('braid_mode')) {
    //         console.log('Using Braid-HTTP!')
    //         bus.libs.http_out ('/*', statebus_server)
    //     } else {
    //         bus.ws_mount ('/*', statebus_server)
    //     }
    // }

    http_automount()

    statebus.compile_coffee = compile_coffee
    statebus.load_client_code = load_client_code

    // if (clientjs_option('globals')) {
    //     // Setup globals
    //     var globals = ['get', 'set', 'state']

    //     for (var i=0; i<globals.length; i++) {
    //         console.log('globalizing', globals[i], 'as',
    //                     eval('bus.' + globals[i]))
    //         window[globals[i]] = eval('bus.' + globals[i])
    //     }
    // }

    document.addEventListener('DOMContentLoaded', function () {
        if (window.statebus_ready)
            for (var i=0; i<statebus_ready.length; i++)
                statebus_ready[i]()
    }, false)

    // document.addEventListener('DOMContentLoaded', load_widgets, false)
})()
