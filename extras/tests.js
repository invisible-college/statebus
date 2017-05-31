bus = require('../statebus')()
util = require('util')
fs = require('fs')
bus.label = 'bus'
statelog_indent++

function log () {
    var pre = '   '
    console.log(pre+util.format.apply(null,arguments).replace('\n','\n'+pre))
}
function assert () { console.assert.apply(console, arguments) }
function delay (time, f) {
    delay_so_far = delay_so_far + time
    return setTimeout(f, delay_so_far)
}   var delay_so_far = 0
delay.init = () => {delay_so_far = 0}

// Each test is a function in this array
var tests = [

    // Equality tests
    function equality (next) {
        var equality_tests = [
            [1, 1, true],
            [1, 3, false],
            [NaN, NaN, true],
            [NaN, undefined, false],
            [null, {}, false],
            [null, null, true],
            [[], [], true],
            [{}, [], false],
            [{}, {}, true],
            [[1], [], false],
            [[1], [1], true],
            [[1], [1, 1], false],
            [[{}], [{}], true],
            [{a:[]}, {a:[]}, true],
            [{a:[]}, {}, false],
            [[[[]]], [[[]]], true],
            [[[[]]], [[[[]]]], false],
            [[[{a:3,b:4}]], [[{b:4,a:3}]], true],
            [[[{a:3,b:4}]], [[{b:4,a:4}]], false],
            [function () {}, function () {}, false],
            [require, require, true],
            [require, function () {}, false],
            [{key:'f'}, {key:'f'}, true]
        ]

        for (var i=0; i<equality_tests.length; i++) {
            assert(bus.deep_equals(equality_tests[i][0],
                                   equality_tests[i][1])
                   === equality_tests[i][2],
                   'Equality test failed forward', equality_tests[i])

            assert(bus.deep_equals(equality_tests[i][1],
                                   equality_tests[i][0])
                   === equality_tests[i][2],
                   'Equality test failed backward', equality_tests[i])
        }

        next()
    },

    function validation (next) {
        var v_tests = [
            ['something', 'string', true],
            ['something', 'something', true],
            ['something', 3, false],
            [3, 3, true],
            [3, 'number', true],
            [3, 'string', false],
            [3, {}, false],
            [3, [], false],
            [{}, {}, true],
            [{}, {'key': 'string'}, false],
            [{}, {'?key': 'string'}, true],
            [{key: 3}, {'?key': 'string'}, false],
            [{key: '/foo'}, {key: 'string'}, true],
            [{a: 2, b: [], c: 'foo'},           {a: 'number', b: 'array', c: 'string'}, true],
            [{a: 2, b: [], c: 'foo', d: false}, {a: 'number', b: 'array', c: 'string'}, false],
            [{a: false}, {a: 'boolean'}, true],
            [{a: 1, b: 2}, {a: 1}, false],
            [{a: 1, b: 2}, {a: 1, '*':'*'}, true],
            [{a: 2, b: 2}, {a: 1, '*':'*'}, false]
        ]

        for (var i=0; i<v_tests.length; i++)
            assert(bus.validate(v_tests[i][0], v_tests[i][1]) === v_tests[i][2],
                   'Validation test failed', v_tests[i])

        next()
    },

    function auto_vars (next) {
        var n = require('../statebus')()
        n('r/*').to_fetch = function (rest, o) {return {rest: rest, o: o}}
        log(n.fetch('r/3'))
        assert(n.fetch('r/3').rest === '3')
        assert(n.fetch('r/3').o === undefined)

        n('v/*').to_fetch = function (vars, star) {return {vars: vars, rest: star}}
        log(n.fetch('v/[3,9 4]').rest)
        log(n.fetch('v/[3,9 4]').rest.match(/$Bad/))
        assert(n.fetch('v/[3,9 4]').rest === '[3,9 4]')

        log(n.fetch('v/[3,9 4]').vars)
        log(n.fetch('v/[3,9 4]').vars.match(/^Bad/))
        assert(n.fetch('v/[3,9 4]').vars.match(/^Bad/))
        assert(Array.isArray(n.fetch('v/[3,4]').vars))

        n('a/*').to_save = function (t, k, obj) {
            log('k:', k, 't:', t, 'o:', obj)
            assert(k === 'a/foo')
            assert(typeof obj === 'object')
            assert(obj.i >= 0 && obj.i <= 4)
            assert(Object.keys(obj).length === 2)
            assert(t.version)
            t.done()
        }
        for (var i=0; i<4; i++)
            n.save({key: 'a/foo', i:i})

        log('Forgetting things now')
        n('v/*').to_forget = function (vars, star) {log('(from auto_vars) forgot v/' + star)}
        n.forget('v/[3,9 4]')
        n.forget('v/[3,4]')

        next()
    },

    function serve_options (next) {
        var filename = 'test1.db', backups = 'test1.backups', certs = 'testcerts'

        // Remove old stuff if there
        try {
            // rm db
            fs.unlinkSync(filename)

            // rm -r backups
            fs.readdirSync(backups).forEach((f) => {
                fs.unlinkSync(backups + "/" + f);
            })
            fs.rmdirSync(backups)
            
            // // rm -r certs
            // fs.readdirSync(certs).forEach((f) => {
            //     fs.unlinkSync(certs + "/" + f);
            // })
            // fs.rmdirSync(certs)
        } catch (e) {log(e)}

        var b = require('../statebus').serve({
            port: 31829,
            file_store: false,
            //file_store: {filename: filename, save_delay: 0, backup_dir: backups},
            certs: {private_key: certs+'/pk', certificate: certs+'/cert'},
        })

        b.save({key: 'foo', body: 'is this on disk?'})
        setTimeout(() => next(), 60)
    },

    function transactions (next) {
        var bus = require('../statebus')()
        bus.honk = 'statelog'
        bus.label = 'tranny'

        // Test to_fetch handlers with t.done()
        bus('foo1').to_fetch = (t) => {
            log('to_fetching foo1')
            setTimeout(()=>{
                log('returning something for foo1')
                t.done({something: 'yeah'})
            }, 0)
        }
        var foo1 = bus.fetch('foo1')
        assert(!foo1.something)
        setTimeout(() => { log('test foo1'); assert(foo1.something === 'yeah') }, 10)

        // And return a value directly
        bus('foo2').to_fetch = (t) => { return {something: 'yeah'} }
        var foo2 = bus.fetch('foo2')
        setTimeout(() => { log('test foo2'); assert(foo2.something === 'yeah') }, 10)


        // Set up some rocks
        log('Set up some rocks')
        bus.save({key: 'rock1', a:1})
        bus.save({key: 'rock2', a:1})
        bus.save({key: 'softrock1', a:1})
        bus.save({key: 'softrock2', a:1})

        // Test to_save handlers with t.done(o), t.abort, 'done', 'abort'
        bus('rock1').to_save = (t) => {setTimeout(()=>{ t.abort() }, 0)}
        bus('rock2').to_save = ( ) => {return 'abort'}
        bus('softrock1').to_save = (t) => {setTimeout(()=>{ t.done() }, 0)}
        bus('softrock2').to_save = ( ) => {return 'done'}
        
        //bus.honk = true
        setTimeout(() => {
            log('Save some changes')
            bus.save({key: 'rock1', a:2})
            bus.save({key: 'rock2', a:2})
            bus.save({key: 'softrock1', a:2})
            bus.save({key: 'softrock2', a:2})

            setTimeout(() => {
                log('Check if the saves worked...')
                assert(bus.cache.rock1.a == 1)
                assert(bus.cache.rock2.a == 1)
                assert(bus.cache.softrock1.a == 2)
                assert(bus.cache.softrock2.a == 2)

                // Test the delete handlers with t.done(o), t.abort, 'done', 'abort'
                log("Now let's delete")
                bus('rock1').to_delete = (t) => {setTimeout(()=>{ t.abort() }, 0)}
                bus('rock2').to_delete = ( ) => {return 'abort'}
                bus('softrock1').to_delete = (t) => {setTimeout(()=>{ t.done() }, 0)}
                bus('softrock2').to_delete = ( ) => {return 'done'}
                
                log('Delete some rocks')
                bus.delete('rock1')
                bus.delete('rock2')
                bus.delete('softrock1')
                bus.delete('softrock2')

                setTimeout(() => {
                    log("Test if the deletes worked")
                    assert(bus.cache.rock1)
                    assert(bus.cache.rock2)
                    assert(!bus.cache.softrock1)
                    assert(!bus.cache.softrock2)
                    next()
                }, 10)

            }, 10)
        }, 20)
    },

    function url_translation (next) {
        var tests = [
            ['foo', 'foo'],
            [['a', 'b'], ['a', 'b']],
            [{key: 'a'}, {key: '/a'}],
            [{key: 'a', f: '3'}, {key: '/a', f: '3'}],
            [{a: {b: {key: 'a'}}}, {a: {b: {key: '/a'}}}],
            [{a: {b: {_key: ['a', 'b']}}}, {a: {b: {_key: ['/a', '/b']}}}],
            [{a: {b: {bombs_key: ['a', 1]}}}, {a: {b: {bombs_key: ['/a', 1]}}}],
            [{a: {b: {_key: ['a', {_key: 'b'}]}}}, {a: {b: {_key: ['/a', {_key: '/b'}]}}}],
            [{a: ['a', {_key: 'b'}]}, {a: ['a', {_key: '/b'}]}],
            ]
        for (var i=0; i<tests.length; i++) {
            log('Testing', i, JSON.stringify(tests[i][0]))
            var trans = bus.translate_keys(tests[i][0], function (k) {return '/' + k})
            assert(bus.deep_equals(trans, tests[i][1]),
                   'Bad translation: ' + JSON.stringify(trans))
        }
        next()
    },

    function basics (next) {
        bus('basic wait').to_fetch = function () {
            setTimeout(function () {bus.save.fire({key:'basic wait', a:1})},
                       30)
        }

        var count = 0
        bus(function () {
            var v = bus.fetch('basic wait')
            log('On round', count, 'we see', v)
            if (count == 0)
                assert(!v.a)
            if (count == 1) {
                assert(v.a)
                bus.forget()
                next()
            }
            count++
        })
    },

    // Multi-handlers
    function multiple_handlers1 (next) {
        var cuss = require('../statebus')()
        cuss('foo').to_fetch = () => {log('do nothing 1')}
        cuss('foo').to_fetch = () => {log('do nothing 2')}
        cuss('foo').to_fetch = () => (log('doing something'),{b: 3})
        cuss.fetch('foo', (o) => {
            log('Multi-handle got', o)
            cuss.forget()
            setTimeout(()=>{next()})
        })
    },

    function multiple_handlers2 (next) {
        var cuss = require('../statebus')()
        cuss('foo').to_save = (o) => {log('do nothing 1')}
        cuss('foo').to_save = (o) => {log('do nothing 2')}
        cuss('foo').to_save = (o) => {log('doin something'); cuss.save.fire(o)}
        //cuss('foo').to_save = (o) => {log('doin abortion'); cuss.save.abort(o)}
        cuss.save({key: 'foo', b: 55})
        log('over and out')
        setTimeout(()=>{next()})
    },

    // Callbacks are reactive
    function fetch_with_callback (next) {
        var count = 0

        function bbs() {
            return bus.bindings('bar', 'on_save').map(
                function (f){return bus.funk_name(f)})
        }
        function cb (o) {
            count++
            // log(bbs().length + ' bindings in cb before fetch')
            var bar = bus.fetch('bar')
            log('cb called', count, 'times', 'bar is', bar, 'foo is', o)
            // log(bbs().length + ' bindings in cb after fetch')
        }

        // log(bbs().length+ ' bindings to start')

        // Fetch a foo
        bus.fetch('foo', cb)                             // Call 1

        // Fire a foo
        setTimeout(function () {
            assert(count === 1, '1!=' + count)
            // log(bbs().length + ' bindings after first fetch')

            log('firing a new foo')
            // log(bbs().length + ' bindings')
            bus.save.fire({key: 'foo', count:count})       // Call 2
        }, 30)

        // Fire a bar, which the callback depends on
        setTimeout(function () {
            log('firing a new bar')
            // log(bbs().length+ ' bindings')
            assert(count === 2, '2!=' + count)
            bus.honk = true
            bus.save.fire({key: 'bar', count:count})       // Call 3
            log('fired the new bar')
            //log(bus.bindings('bar', 'on_save'))
        }, 50)

        // Next
        setTimeout(function () {
            assert(count === 2, '2!=' + count)
            bus.forget('foo', cb)
            //bus.forget('bar', cb)
            next()
        }, 100)
    },

    function fetch_once (next) {
        var calls = 0
        bus.fetch('fetch_once', function cb (o) {
            calls++
            log('Fetch_once called', calls)
            assert(calls < 2, 'Fetch-once called twice')
            bus.forget('fetch_once', cb)
        })
        bus.save.fire({key: 'fetch_once', _: 0})
        setTimeout(()=> { bus.save.fire({key: 'fetch_once', _: 1}) }, 10)
        setTimeout(()=> { bus.save.fire({key: 'fetch_once', _: 2}) }, 20)
        setTimeout(()=> { next() }, 30 )
    },

    // If there's an on_fetch handler, the callback doesn't return
    // until the handler fires a value
    function fetch_remote (next) {
        var count = 0

        // The moon responds in 30ms
        bus('moon').to_fetch =
            function (k) { setTimeout(function () {bus.save.fire({key:k})},30) }
        function cb (o) {
            count++
            var moon = bus.fetch('hey over there')
            log('cb called', count, 'times')
        }

        // Fetch a moon
        bus.fetch('moon', cb)       // Doesn't call back yet
        assert(count === 0, '0!=' + count)

        // There should be a moonshot by now
        setTimeout(function () {
            assert(count === 1, '1!=' + count)
            bus.forget('moon', cb)
            next()
        }, 50)
    },

    // Multiple batched fires might trigger duplicate reactions
    function duplicate_fires (next) {
        var calls = new Set()
        var count = 0
        var dupes = []
        function cb (o) {
            count++
            if (calls.has(o.n)) dupes.push(o.n)
            calls.add(o.n)
            log('cb called', count, 'times with', calls)
        }

        // Fetch a foo
        bus.fetch('foo', cb)                   // Call 1
        assert(count === 1, '1!=' + count)

        // Fire a foo
        setTimeout(function () {
            log('Firing a few new foos')
            bus.save.fire({key: 'foo', n:0})     // Skipped
            bus.save.fire({key: 'foo', n:1})     // Skipped
            bus.save.fire({key: 'foo', n:2})     // Skipped
            bus.save.fire({key: 'foo', n:3})     // Call 2
            log("ok, now let's see what happens.")
        }, 30)

        // Next
        setTimeout(function () {
            assert(count === 2, '2!=' + count)
            assert(dupes.length === 0, 'CB got duplicate calls', dupes)
            log('Well, that went smoothly!')
            bus.forget('foo', cb)
            //bus.forget('bar', cb)
            next()
        }, 60)
    },

    // Identity fires shouldn't infinite loop
    function identity (next) {
        var key = 'kooder'
        var count = 0
        function fire () { bus.save.fire({key: 'kooder', count: count}) }
        bus(key).to_fetch = function () { setTimeout(fire, 10) }
        function cb() {
            count++
            log('cb called', count, 'times')
            bus.save.fire(bus.fetch('new'))
        }
        bus.fetch(key, cb)

        // Next
        setTimeout(function () {
            // Calls:
            //  1. Initial call
            //  2. First return from pending fetch
            assert(count === 1, 'cb called '+count+'!=1 times')
            bus.forget(key, cb)
            bus(key).to_fetch.delete(fire)
            next()
        }, 40)
    },


    // bus.forget() within a callback
    function forgetting (next) {
        var key = 'kooder'
        var count = 0
        function fire () { log('firing!'); bus.save.fire({key: key, count: count}) }
        bus(key).to_fetch = function () { setTimeout(fire, 10) }

        function cb (o) {
            count++
            log('cb2 called', count, 'times', 'on', o)

            if (count > 2) assert(false, 'cb2 too many calls')
            if (count > 1) {
                log('cb2 forgetting', key)
                bus.forget(key, cb)
                log('forgot.')
            }
        }

        bus.fetch(key, cb)
        setTimeout(fire, 70)
        setTimeout(fire, 80)

        // Next
        setTimeout(function () {
            assert(count === 2, "Count should be 2 but is", count)
            bus(key).to_fetch.delete(fire)
            next()
        }, 100)
    },

    // Can we return an object that fetches another?
    function nested_fetch (next) {
        function outer () { return {inner: bus.fetch('inner') } }
        bus('outer').to_fetch = outer
        log('fetching the outer wrapper')
        var obj = bus.fetch('outer')
        log('Ok, we fetched:', obj)
        assert(obj.inner.key === 'inner')
        bus.save({key: 'inner', c: 1})
        assert(obj.inner.c === 1)

        log('vvv Grey line follows (cause outer fetched inner) vvv')

        // Next
        setTimeout(function () {
            bus('outer').to_fetch.delete(outer)
            next()
        }, 10)
    },

    // Russian dolls
    function russian_doll_nesting (next) {
        var nothing = 3
        function big () { return {middle: bus.fetch('middle') } }
        function middle () { return {small: bus.fetch('small') } }
        function small () { return {nothing: nothing} }
        bus('big').to_fetch = big
        bus('middle').to_fetch = middle
        bus('small').to_fetch = small

        log('fetching')
        var obj = bus.fetch('big')
        log('we got', obj)

        setTimeout(function () {
            bus.fetch('big', function (o) {
                nothing = 5
                log('About to update small')
                bus.save.fire({key: 'small', something: nothing})
                log('We did it.')
            })}, 10)

        setTimeout(function () {
            bus.fetch('big', function ruskie (o) {
                nothing = 50
                var small = bus.fetch('small')
                log()
                log('Second try.  Small starts as', small)
                bus.save.fire({key: 'small', something: nothing})
                log('Now it is', bus.fetch('small'))
            })}, 15)


        // Next
        setTimeout(function () {
            bus('big').to_fetch.delete(big)
            bus('middle').to_fetch.delete(middle)
            bus('small').to_fetch.delete(small)
            next()
        }, 50)
    },

    function some_handlers_suicide (next) {
        // These handlers stop reacting after they successfully complete:
        // 
        //   .on_save
        //   .to_save
        //   .to_forget
        //   .to_delete
        //
        // Ok, that's everyting except for a .to_fetch handler, which
        // runs until its key has been forget()ed.

        // XXX todo
        next()
    },

    function uncallback (next) {
        try {
            var chokidar = require('chokidar')
        } catch (e) {
            console.warn('#### Yo!  You need to run "npm install chokidar"')
            process.exit()
        }

        var watchers = {}
        function read_file (filename, cb) {
            fs.readFile(filename, function (err, result) {
                if (err) throw err
                else cb(null, result + '')
            })
            if (!(filename in watchers)) {
                watchers[filename] = chokidar.watch(filename)
                watchers[filename].on('change', () => { bus.dirty(this.key) })
            }
        }

        read_file = bus.uncallback(read_file, {stop_watching: (json) => {
            filename = json[0]
            log('unwatching', filename)
            //watchers[filename].unwatch(filename)
            watchers[filename].close()
            delete watchers[filename]
        }})

        fs.writeFileSync('/tmp/blah', 'foo')

        bus.honk = 3
        var runs = 0
        bus(() => {
            runs++
            var result = read_file('/tmp/blah')
            log('read file as', JSON.stringify(result && result.substr(0,50)))
            //bus.forget(); return;
            if (bus.loading())
                log('Still loading!')
            else
                if (result == '1' || result == '2' || result == '3') {
                    log('done. forgetting')
                    bus.forget()
                }

            switch(runs) {
            case 1:
                console.assert(result == undefined); break
            case 2:
                console.assert(result == 'foo'); break
            case 3:
            case 4:
                console.assert(result == '1' || result == '2' || result == '3'); break;
            }
        })

        delay.init()
        delay(10,  () => {log('* MODIFY 1'); fs.writeFileSync('/tmp/blah', '1')})
        delay(200, () => {log('* MODIFY 2'); fs.writeFileSync('/tmp/blah', '2')})
        delay(200, () => {log('* MODIFY 3'); fs.writeFileSync('/tmp/blah', '3')})

        delay(200, () => {console.assert(runs < 4, 'There were', runs, 'runs'); next()})
    },

    function readfile (next) {
        var b = require('../statebus')(),
            count = 0
        fs.writeFileSync('/tmp/blah', '1')
        b(() => {
            var r = b.read_file('/tmp/blah')
            log('Got', r)
            switch(count++) {
            case 0:
                console.assert(r == undefined); break
            case 1:
                console.assert(r == '1'); break
            case 2:
                console.assert(r == '2'); b.forget(); break
            case 3:
                console.assert(false); break
            }
        })

        delay(300, () => {log('* MODIFY 2'); fs.writeFileSync('/tmp/blah', '2')})
        delay(300, () => {log('* MODIFY 3'); fs.writeFileSync('/tmp/blah', '3')})
        delay(200, () => {next()})
    },

    function proxies (next) {
        var bus = require('../statebus')()
        db = bus.sb
        db.foo.a = 3
        assert(db.foo.a == 3)
        db.foo.a = [1,3,5, 'hello']
        db.foo.a.push({key: 'bar', 4:4})

        // Todo: make sure that push() and splice() etc. trigger updates to
        // state properly.  They should trigger save() when they modify the
        // array, and not when they don't.

        log('Now foo is', db.foo)
        log('And bar is', db.bar)

        db.f = 3
        assert(bus.validate(bus.cache['f'], {key: 'f', _: 3}),
               bus.cache['f'], 'should be', {key: 'f', _: 3})
        assert(db.f === 3)

        db.g = [1,2,4,5]
        assert(bus.cache['g']._.length = 4)

        next()
    },

    function only_one (next) {
        bus('only_one/*').to_fetch = function (k) {
            var id = k[k.length-1]
            return {selected: bus.fetch('selector').choice == id}
        }

        assert(!bus.fetch('only_one/1').selected)
        assert(!bus.fetch('only_one/2').selected)
        assert(!bus.fetch('only_one/3').selected)

        bus.save({key: 'selector', choice: 1})

        setTimeout(function () {
            assert( bus.fetch('only_one/1').selected)
            assert(!bus.fetch('only_one/2').selected)
            assert(!bus.fetch('only_one/3').selected)

            bus.save({key: 'selector', choice: 2})
        }, 10)

        setTimeout(function () {
            assert(!bus.fetch('only_one/1').selected)
            assert( bus.fetch('only_one/2').selected)
            assert(!bus.fetch('only_one/3').selected)

            bus.save({key: 'selector', choice: 3})
        }, 20)

        setTimeout(function () {
            assert(!bus.fetch('only_one/1').selected)
            assert(!bus.fetch('only_one/2').selected)
            assert( bus.fetch('only_one/3').selected)
            next()
        }, 30)
    },

    function save_can_trigger_tofetch (next) {
        // bus.honk = true
        bus('save_trigger_tofetch').to_fetch =
            function (k, old) {
                old.yes = Math.random()
                return old
            }

        var obj
        var triggered = 0
        bus(() => {
            log('Aight! Fetching save_trigger_fetch')
            obj = bus.fetch('save_trigger_tofetch')
            if (bus.loading()) return
            triggered++
            log('Triggered', triggered, 'times', obj)

            // XXX todo: because of a bug in how to_fetch is handled, this triggers 4 times instead of 3
            assert(triggered <= 4)
            log('GGGGGGGGGGGG')
        })

        delay.init()
        delay(30, () => { log('savin 1!'); obj.a = 1; bus.save(obj) })
        delay(30, () => { log('savin 2!'); obj.a = 2; bus.save(obj) })
        delay(30, next)
    },

    function rollback_savefire (next) {
        var count = 0
        var error = false
        var phase = 0
        
        function wait () { setTimeout(function () {
            assert(phase++ === 1)
            log('Firing wait')
            bus.save.fire({key: 'wait', count: count})
        }, 50) }
        bus('wait').to_fetch = wait

        // Initialize
        bus.save.fire({key: 'undo me', state: 'start'})
        
        // Now start the reactive function
        bus(function () {
            log('Reaction', ++count, 'starting with state',
                bus.fetch('undo me').state, 'and loading =', bus.loading())

            // Fetch something that we have to wait for
            var wait = bus.fetch('wait')

            // Save some middling state
            bus.save.fire({key: 'undo me', state: 'progressing'})

            if (count === 1 && !bus.loading()) {
                log('### Error! We should be loading!')
                error = true
            }
            log('Done with this reaction')
        })
        
        assert(!error)

        var state = bus.cache['undo me'].state
        log('After first reaction, the state is', state)
        assert(state === 'start', 'The state did not roll back.')

        // The state should still be "start" until 50ms
        setTimeout(function () {
                      assert(bus.cache['undo me'].state === 'start')
                      assert(phase++ === 0, phase)
                   },
                   40)

        // The state should finally progress after 50ms
        setTimeout(function () {
                      log('state is', bus.cache['undo me'].state)
                      assert(bus.cache['undo me'].state === 'progressing')
                      assert(phase++ === 2)
                   },
                   60)

        setTimeout(function () {
            bus('wait').to_fetch.delete(wait)
            assert(phase === 3)
            next()
        }, 80)
    },

    function rollback_del (next) {
        bus('wait forever').to_fetch = function () {} // shooting blanks
        bus.save.fire({key: 'kill me', alive: true})

        // First do a del that will roll back
        bus(function () {
            log('Doing a rollback on', bus.cache['kill me'])
            bus.fetch('wait forever')  // Never finishes loading
            bus.del('kill me')         // Will roll back
        })
        assert(bus.cache['kill me'].alive === true)

        // Now a del that goes through
        bus(function () {
            log('Doing a real delete on', bus.cache['kill me'])
            bus.del('kill me')         // Will not roll back
        })
        assert(!('kill me' in bus.cache))
        log('Now kill me is', bus.cache['kill me'])
        next()
    },

    function rollback_save (next) {
        var saves = []
        var done = false
        bus('candy').to_save = function (o) {saves.push(o); bus.save.fire(o)}
        bus.save.fire({key: 'candy', flavor: 'lemon'})

        log('Trying some rollbacks starting with', bus.cache['candy'])

        // First do a save that will roll back
        bus(function () { if (done) return;
            log('Doing a rollback on bananafied candy')
            bus.fetch('wait forever')                  // Never finishes loading
            bus.save({key:'candy', flavor: 'banana'})  // Will roll back
            log('...and the candy is', bus.cache['candy'])
            //forget('candy')
        })
        assert(bus.cache['candy'].flavor === 'lemon')
        assert(saves.length === 0)

        // Try rolling back another style of save
        bus(function () { if (done) return
            log("Now we'll First we licoricize the", bus.cache['candy'])
            bus.fetch('wait forever')                  // Never finishes loading
            var candy = bus.fetch('candy')
            candy.flavor = 'licorice'
            log('...the candy has become', bus.cache['candy'])
            bus.save(candy)                            // Will roll back
            log('...and now it\'s rolled back to', bus.cache['candy'])
            bus.forget('candy')
        })
        assert(bus.cache['candy'].flavor === 'lemon')
        assert(saves.length === 0)

        // Now a save that goes through
        bus(function () {
            log('Doing a real save on', bus.cache['candy'])
            bus.save({key:'candy', flavor: 'orangina'})  // Will go through
        })
        assert(bus.cache['candy'].flavor = 'orangina')
        assert(saves.length === 1, 'Saves.length 1 != '+saves.length)

        log('Now candy is', bus.cache['candy'])
        done = true
        next()
    },

    function rollback_abort (next) {
        var bus = require('../statebus')()
        bus('foo').to_save = (o, t) => {t.abort()}
        bus(()=> {
           var o = bus.fetch('foo')
           o.bar = 3
           bus.save(o)
        })
        setTimeout(() => {
            assert(!bus.cache.foo.bar)
            next()
        }, 40)
    },

    function loading_quirk (next) {
        // Make sure a function that called loading() gets re-run even
        // if the return from a fetch didn't actually change state

        // First define a delayed save.fire
        bus('wait a sec').to_fetch = function (k) {
            setTimeout(function () { bus.save.fire({key: k}) }, 50)
        }

        // Now run the test
        var loaded = false
        var num_calls = 0
        bus(function () {
            num_calls++
            log('called', num_calls, 'times')
            bus.fetch('wait a sec')
            loaded = !bus.loading()
        })

        // Finish
        setTimeout(function () {
            assert(loaded, 'We never got loaded.')
            assert(num_calls == 2,
                   'We got called '+num_calls+'!=2 times')
            next()
        }, 100)
    },

    function requires (next) {
        try {
            require.resolve('sockjs') // Will throw error if not found
            require.resolve('websocket')
        } catch (e) {
            console.warn('#### Yo!  You need to run "npm install sockjs websocket"')
            process.exit()
        }
        log('Ok good, we have the goods.')
        next()
    },

    function default_route (next) {
        var b1 = require('../statebus')()
        var b2 = require('../statebus')()
        b1.shadows(b2)
        b2.save({key: 'foo', bar: 3})
        console.assert(b1.fetch('foo').bar)
        log(b1.fetch('foo'))
        log(b2.fetch('foo'))
        b1.delete('foo')
        log(b1.fetch('foo'))
        log(b2.fetch('foo'))
        console.assert(!b1.fetch('foo').bar)
        console.assert(!b2.fetch('foo').bar)
        next()
    },

    function setup_server (next) {
        s = require('../statebus').serve({port: 3948, file_store: false})
        s.label = 's'
        log('Saving /far on server')
        s.save({key: 'far', away:'is this'})

        c = require('../statebus')()
        c.label = 'c'
        c.ws_client('/*', 'statei://localhost:3948')

        // s.honk = true
        // c.honk = true

        setTimeout(function () {
            log('Fetching /far on client')
            var count = 0
            c.fetch('/far', function (o) {
                log('cb !!!!!!!!! --- ^_^')
                c.fetch('/far')
                if (o.away === 'is this') {
                    log('We got '+o.key+' from the server!')

                    c.forget()
                    console.assert(count++ === 0, "Forget didn't work.")

                    setTimeout(function () {next()})
                }
            })
        }, 100)

        var matches = new Set()
        for (var k in s.busses) {
            log("Checking unique bus id", k, 'with name', s.busses[k].toString())
            console.assert(!matches.has(k), 'duplicate bus id', k)
            matches.add(k)
        }
    },

    function login (next) {
        s.save({key: 'users',
                all: [ {  key: 'user/1',
                          name: 'mike',
                          email: 'toomim@gmail.com',
                          admin: true,
                          pass: '$2a$10$Ti7BgAZS8sB0Z62o2NKsIuCdmU3q9xP7jexVccTcG19Y8qpBpl/1y' }

                       ,{ key: 'user/2',
                          name: 'j',
                          email: 'jtoomim@gmail.com',
                          admin: true,
                          pass: '$2a$10$Ti7BgAZS8sB0Z62o2NKsIuCdmU3q9xP7jexVccTcG19Y8qpBpl/1y' }

                       ,{ key: 'user/3',
                          name: 'boo',
                          email: 'boo@gmail.com',
                          admin: false,
                          pass: '$2a$10$4UTjzf5OOGdkrCEsT.hO/.csKqf7u8mZ23ZT6stamBAWNV7u5WJuu' } ] })

        c(function () {
            var u = c.fetch('/current_user')
            if (u.logged_in) {
                log('Yay! We are logged in as', u.user.name)
                forget()
                setTimeout(function () {next()})
            } else
                log("Ok... we aren't logged in yet.  We be patient.")
        })
        // c.honk = user0.honk = true
        var u = c.fetch('/current_user')
        u.login_as = {name: 'mike', pass: 'yeah'}
        log('Logging in')
        c.save(u)
    },

    function wrong_password (next) {
        var u = c.fetch('/current_user')
        assert(u.logged_in && u.user.name == 'mike')
        u.login_as = {name: 'j', pass: 'nah'}
        c.save(u)
        setTimeout(function () {
            assert(!u.login_as, 'Aborted login needs to abort')
            log('Good, the login failed.')
            next()
        }, 300)
    },

    function create_account (next) {
        assert(c.fetch('/current_user').logged_in)
        var count = 0
        c(function () {
            count++
            var u = c.fetch('/current_user')

            log('Phase', count, '(logged '+(u.logged_in?'in)':'out)'))

            switch (count) {
            case 1:
                log('In 1   -    Logging out')
                assert(u.logged_in, '1 not logged in')
                u.logout = true; c.save(u)
                break
            case 2: break
            case 3:
                log('In 3   -    Creating bob, logging in as bob')
                assert(!u.logged_in, '3 logged in')
                u.create_account = {name: 'bob', email: 'b@o.b', pass: 'boob'}
                c.save(u)

                // Note: I hope this next line isn't necessary in the future!
                delete u.create_account

                u.login_as = {name: 'bob', pass: 'boob'}
                c.save(u)
                break
            case 4: break
            case 5:
                log('In 5   -    Logging out')
                assert(u.logged_in)
                assert(u.user.name === 'bob'
                       && u.user.email === 'b@o.b'
                       && u.user.pass === undefined
                       && u.user.key.match(/\/user\/.*/),
                       'Bad user', u)
                // Now let's log out
                log('Almost done 5')
                u.logout = true; c.save(u)
                log('Done 5')
                break
            case 6: break
            case 7:
                log('In 7   -    Logging back in as boob')
                assert(!u.logged_in, '7. still logged in')
                u.login_as = {name: 'bob', pass:'boob'}
                c.save(u)
                break
            case 8: break
            case 9:
                log('In 9   -    Forget and finish.')
                assert(u.logged_in, '9 not logged in')
                forget()
                setTimeout(function () {next()})
                break
            default:
                assert(false)
                break
            }
        })
    },

    function email_read_permissions (next) {
        var phase = -1
        var u, user1, user2, user3
        var tmp1

        var states = function () { return [
            // Phase 0
            [true,
             function () {
                 log('Logging in as mike')
                 //s.honk=true
                 u.login_as = {name: 'mike', pass: 'yeah'}; c.save(u)
             }],

            // Phase 1
            // Logged in as mike
            [(u.logged_in
              && u.user.name === 'mike'
              && u.user.key === '/user/1'

              // We can see our email
              && u.user.email
              && user1.email

              // We can't see other emails
              && !user2.email
              && !user3.email),

             function () {
                 !tmp1 && log('Logging in as j')
                 setTimeout(function () {
                     if (tmp1) return
                     tmp1 = true
                     log('Firing the actual j login')
                     //s.userbus.honk = true
                     u.login_as = {name: 'j', pass: 'yeah'}; c.save(u)
                     log('We just logged in as j. now user is:', u.user.name)
                 }, 10)
             }],

            // Phase 2
            // Logged in as j
            [(u.logged_in
              && u.user.name === 'j'
              && u.user.key === '/user/2'

              // We can see j's email
              && u.user.email
              && user2.email

              // We can't see other emails
              && !user1.email
              && !user3.email),

             // That's all, Doc
             function () { log("That's all, Doc."); setTimeout(function () {next()}) }]
        ]}

        c('/current_user').on_save = function (o) {
            //if (o.user && o.user.name === 'j') {
                // log(s.userbus.deps('/current_user'))
                // log(s.userbus.deps('/user/2'))
            //}
        }
        c('/user/*').on_save = function (o) {
            //log('-> Got new', o.key, o.email ? 'with email' : '')
        }
        c('/current_user').on_save = function (o) {
            //log('-> Got new /current_user')
        }
        c(function loop () {
            u = c.fetch('/current_user')
            user1 = c.fetch('/user/1')
            user2 = c.fetch('/user/2')
            user3 = c.fetch('/user/3')
            var st = states()

            if (phase===1)
                log('\n\tcurr u:\t',u.user, '\n\t1:\t', user1,'\n\t2:\t', user2,'\n\t3:\t', user3)

            if (phase >= st.length) {
                loop.forget()
                return
            }

            if (phase + 1 < st.length && st[phase + 1][0]) {
                phase++
                log()
                log('## Shifting to phase', phase)
            }
            
            //log('Phase', phase, 'logged_in:', u.logged_in && u.user.name)
            st[phase][1]()
        })
    },

    function ambiguous_ordering (next) {
        // Not fully implemented yet

        /*
          Let's save within an on-save handler.  Which will trigger
          first... the dirty(), or the new save()?  Hm, do we really
          care?
         */

        var user = 3
        bus('user').to_fetch =
            function (k) {
                return {user: user}
            }

        bus('user').to_save =
            function (o) {
                if (o.funny)
                    bus.save({key: 'user', user: 'funny'})

                user = o.user
                bus.dirty('user')
            }

        log("Eh, nevermind.")
        next()
    }
]

// Run all tests
function run_next () {
    if (tests.length > 0) {
        var f = tests.shift()
        console.log('\nTesting:', f.name)
        f(function () {setTimeout(run_next)})
    } else
        (console.log('\nDone with all tests.'), process.exit())

    
}
run_next()
