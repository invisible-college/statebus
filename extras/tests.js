bus = require('../statebus')()
util = require('util')
fs = require('fs')
bus.label = 'bus'
statelog_indent++

// Include the test functions
var {test, run_tests, log, assert, delay} = require('../statebus').testing

// Make sure we have all the npm packages installed
try {
    var reqs = 'sockjs chokidar websocket bcrypt-nodejs'.split(' ')
    for (var i=0; i<reqs.length; i++) require(reqs[i])
} catch (e) {
    console.log(e)
    console.warn('#### Yo!  You need to run "npm install sockjs chokidar websocket bcrypt-nodejs"')
    process.exit()
}


// Equality tests
test(function equality (done) {
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

    done()
})

test(function validation (done) {
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

    done()
})

test(function applying_patches (done) {
    var tests = [
        ['0', '[0] = "1"', '1'],
        [['0'], '[0] = "1"', ['1']],
        [['0'], '[0] = [1]', [[1]]],
        ['', '[0:0] = "something"', 'something'],
        ['hello', '[-0:-0] = " there"', 'hello there'],
        [{}, '.foo = "bar"', {foo: 'bar'}],
        [{a:1}, '.a = true', {a: true}],
        [[1,2,3], '[1:1] = [4, 5, 6]', [1, 4, 5, 6, 2, 3]],
        [[1,2,3], '[-0:-0] = 0', [1, 2, 3, 0]],
        [[1,2,3], '[-1] = 0', [1, 2, 0]],
        [[1,2,3], '[-1:-0] = [0]', [1, 2, 0]],
        [[1,2,3], '[-1:-0] = [0, 0, 0]', [1, 2, 0, 0, 0]]
    ]

    for (var i=0; i<tests.length; i++) {
        var x = bus.apply_patch(tests[i][0], tests[i][1])
        assert(bus.deep_equals(x, tests[i][2]),
               `Patch applied wrong ${JSON.stringify(tests[i])} got ${x}`)
    }
    done()
})

test(function prune (done) {
    var boose = require('../statebus')()
    boose.save({key: 'nark', _: 333666})
    var a = {key: 'funny',
             b: {key: 'farty', booger: 3}}
    assert(!boose.prune(a).b.booger)
    var b = {key: 'farty',
             a: a,
             arr: [1, 3, a, {key: 'nark', ___: 999}]}
    done()
})

test(function auto_vars (done) {
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

    done()
})

test(function serve_options (done) {
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
        //file_store: false,
        file_store: {filename: filename, save_delay: 0, backup_dir: backups},
        certs: {private_key: certs+'/pk', certificate: certs+'/cert'},
    })

    b.save({key: 'foo', body: 'is this on disk?'})
    setTimeout(() => done(), 60)
})

test(function transactions (done) {
    var bus = require('../statebus')()
    bus.honk = 'statelog'
    bus.label = 'tranny'

    // Test to_fetch handlers with t.done()
    bus('foo1').to_fetch = function (t) {
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
                done()
            }, 10)

        }, 10)
    }, 20)
})

test(function url_translation (done) {
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
    done()
})

test(function basics (done) {
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
            done()
        }
        count++
    })
})

// Multi-handlers
test(function multiple_handlers1 (done) {
    var cuss = require('../statebus')()
    cuss('foo').to_fetch = () => {log('do nothing 1')}
    cuss('foo').to_fetch = () => {log('do nothing 2')}
    cuss('foo').to_fetch = () => (log('doing something'),{b: 3})
    cuss.fetch('foo', (o) => {
        log('Multi-handle got', o)
        cuss.forget()
        setTimeout(()=>{done()})
    })
})

test(function multiple_handlers2 (done) {
    var cuss = require('../statebus')()
    cuss('foo').to_save = (o) => {log('do nothing 1')}
    cuss('foo').to_save = (o) => {log('do nothing 2')}
    cuss('foo').to_save = (o) => {log('doin something'); cuss.save.fire(o)}
    //cuss('foo').to_save = (o) => {log('doin abortion'); cuss.save.abort(o)}
    cuss.save({key: 'foo', b: 55})
    log('over and out')
    setTimeout(()=>{done()})
})

// Callbacks are reactive
test(function fetch_with_callback (done) {
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

    // Done
    setTimeout(function () {
        assert(count === 2, '2!=' + count)
        bus.forget('foo', cb)
        //bus.forget('bar', cb)
        done()
    }, 100)
})

test(function fetch_once (done) {
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
    setTimeout(()=> { done() }, 30 )
})

test(function once (done) {
    bus('takeawhile').to_fetch = (t) => {
        setTimeout(_=> t.return({_: 3}), 150)
    }
    bus.once(_=> {
        var x = bus.fetch('takeawhile')
        var y = bus.fetch('changing')
        log('running the once func! loading is', bus.loading())
        assert(!bus.cache.certified)
        bus.save({key: 'whendone', certified: true})
    })

    delay(50, _=> assert(!bus.fetch('whendone').certified))
    delay(10, _=> bus.save({key: 'changing', _: 1}))
    delay(10, _=> bus.save({key: 'changing', _: 2}))
    delay(150, _=> assert(bus.fetch('whendone').certified))
    delay(10, _=> bus.save({key: 'changing', _: 3}))
    delay(10, _=> bus.save({key: 'changing', _: 4}))
    delay(30, _=> done())
})

// If there's an on_fetch handler, the callback doesn't return
// until the handler fires a value
test(function fetch_remote (done) {
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
        done()
    }, 50)
})

// Multiple batched fires might trigger duplicate reactions
test(function duplicate_fires (done) {
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

    // Done
    setTimeout(function () {
        assert(count === 2, '2!=' + count)
        assert(dupes.length === 0, 'CB got duplicate calls', dupes)
        log('Well, that went smoothly!')
        bus.forget('foo', cb)
        //bus.forget('bar', cb)
        done()
    }, 60)
})

// Identity fires shouldn't infinite loop
test(function identity (done) {
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

    // Done
    setTimeout(function () {
        // Calls:
        //  1. Initial call
        //  2. First return from pending fetch
        assert(count === 1, 'cb called '+count+'!=1 times')
        bus.forget(key, cb)
        bus(key).to_fetch.delete(fire)
        done()
    }, 40)
})


// bus.forget() within a callback
test(function forgetting (done) {
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

    // Done
    setTimeout(function () {
        assert(count === 2, "Count should be 2 but is", count)
        bus(key).to_fetch.delete(fire)
        done()
    }, 100)
})

// Can we return an object that fetches another?
test(function nested_fetch (done) {
    function outer () { return {inner: bus.fetch('inner') } }
    bus('outer').to_fetch = outer
    log('fetching the outer wrapper')
    var obj = bus.fetch('outer')
    log('Ok, we fetched:', obj)
    assert(obj.inner.key === 'inner')
    bus.save({key: 'inner', c: 1})
    assert(obj.inner.c === 1)

    log('vvv Grey line follows (cause outer fetched inner) vvv')

    // Done
    setTimeout(function () {
        bus('outer').to_fetch.delete(outer)
        done()
    }, 10)
})

// Russian dolls
test(function russian_doll_nesting (done) {
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


    // Done
    setTimeout(function () {
        bus('big').to_fetch.delete(big)
        bus('middle').to_fetch.delete(middle)
        bus('small').to_fetch.delete(small)
        done()
    }, 50)
})

test(function some_handlers_suicide (done) {
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
    done()
})

test(function uncallback (done) {
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
    }

    read_file = bus.uncallback(read_file, {
        start_watching: (args, dirty, del) => {
            var filename = args[0]
            assert(!(filename in watchers), 'WTF... the file ' + filename + ' is already being watched?')
            watchers[filename] = chokidar.watch(filename)
            watchers[filename].on('change', () => { bus.dirty(this.key) })
        },
        stop_watching: (json) => {
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

    delay(10,  () => {log('* MODIFY 1'); fs.writeFileSync('/tmp/blah', '1')})
    delay(200, () => {log('* MODIFY 2'); fs.writeFileSync('/tmp/blah', '2')})
    delay(200, () => {log('* MODIFY 3'); fs.writeFileSync('/tmp/blah', '3')})

    delay(200, () => {console.assert(runs < 4, 'There were', runs, 'runs'); done()})
})

test(function readfile (done) {
    var b = require('../statebus')(),
        count = 0

    fs.writeFileSync('/tmp/blah', '1')
    b(() => {
        var r = b.read_file('/tmp/blah')
        log('Got', r, 'at count', count)
        switch(count++) {
        case 0:
            console.assert(r === undefined); break
        case 1:
            console.assert(r === '1'); break
        case 2:
            console.assert(r === '2'); b.forget(); break
        case 3:
            console.assert(false); break
        }
    })

    delay(300, () => {log('* MODIFY 2'); fs.writeFileSync('/tmp/blah', '2')})
    delay(300, () => {log('* MODIFY 3'); fs.writeFileSync('/tmp/blah', '3')})
    delay(200, () => {done()})
})

test(function proxies (done) {
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

    done()
})

test(function proxies2 (done) {
    var bus = require('../statebus')()
    var state = bus.state

    assert(state.array === undefined)
    assert(state.bar === undefined)

    state.array = []
    log('array:', state.array)
    assert(state.array.length === 0)
    state.array[0] = 1
    log('array:', state.array)
    assert(state.array.length === 1)
    state.bar = {}
    log('bar:', state.bar)
    state.bar = {a: 1}
    log('bar:', state.bar)
    assert(state.bar.a === 1)
    state.bar.a = state.array
    log('bar:', state.bar)
    state.array[1] = 2
    log('array:', state.array)
    log('bar:', state.bar)
    assert(state.bar.a[1] === 2,
           "Array ref didn't link.\n\t"
           + JSON.stringify(bus.cache.bar) + '\n\t'
           + JSON.stringify(bus.cache.array))

    state.undefining = undefined
    assert(state.undefining === undefined)
    state.undefining = {a: undefined}
    log('state.undefining =', state.undefining)
    // assert(state.undefining.a === undefined)
    // TODO: fix https://github.com/invisible-college/statebus/issues/34
    state.undefining = {}
    assert(!('a' in state.undefining))
    state.undefining.a = undefined
    assert('a' in state.undefining)
    assert(state.undefining.a === undefined)

    state.b = {a: undefined}
    assert('a' in state.b)
    assert(state.b.a === undefined)
    delete state.b.a
    // TODO: https://github.com/invisible-college/statebus/issues/34
    assert(!('a' in state.b))
    assert(state.b.a === undefined)

    return done()

    /*
      Things I want to test:

      - Setting nested items
      - Escaping their fields
      - Calling fetch on them
      - Converting state[..] to keyed objects internally
      - has() potentially doing a fetch, or loading()
      - set() returning a proxy object
      - console output
      - node AND chrome
      - having nice colors and distinctions and shit
    */

    state.foo = 3
    // This should set into _
    console.assert(bus.validate(bus.cache.foo,
                                {key: 'foo', _: 3}))


    state.foo = {a: 5}
    // This should set directly on it
    console.assert(bus.validate(bus.cache.foo,
                                {key: 'foo', a: 5}))
    state.foo.b = 6
    console.assert(bus.validate(bus.cache.foo,
                                {key: 'foo', b: 6}))

    state.bar = [3]
    state.foo = {a: 3, bar: state.bar}

    bus(() => {
        state.foo      // foo triggers re-render
        state.foo.bar  // bar triggers re-render
        state.foo.a    // triggers re-render too
    })

    // Getting a linked item should do a fetch
    bus(() => {
        state.bar
    })

    // Getting a normal property should do a fetch
})

test(function only_one (done) {
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
        done()
    }, 30)
})

test(function save_can_trigger_tofetch (done) {
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

    delay(30, () => { log('savin 1!'); obj.a = 1; bus.save(obj) })
    delay(30, () => { log('savin 2!'); obj.a = 2; bus.save(obj) })
    delay(30, done)
})

test(function rollback_savefire (done) {
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
        done()
    }, 80)
})

test(function rollback_del (done) {
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
    done()
})

test(function rollback_save (done) {
    var saves = []
    var all_done = false
    bus('candy').to_save = function (o) {saves.push(o); bus.save.fire(o)}
    bus.save.fire({key: 'candy', flavor: 'lemon'})

    log('Trying some rollbacks starting with', bus.cache['candy'])

    // First do a save that will roll back
    bus(function () { if (all_done) return;
                      log('Doing a rollback on bananafied candy')
                      bus.fetch('wait forever')                  // Never finishes loading
                      bus.save({key:'candy', flavor: 'banana'})  // Will roll back
                      log('...and the candy is', bus.cache['candy'])
                      //forget('candy')
                    })
    assert(bus.cache['candy'].flavor === 'lemon')
    assert(saves.length === 0)

    // Try rolling back another style of save
    bus(function () { if (all_done) return
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
    all_done = true
    done()
})

test(function rollback_abort (done) {
    var bus = require('../statebus')()
    bus('foo').to_save = (o, t) => {t.abort()}
    bus(()=> {
        var o = bus.fetch('foo')
        o.bar = 3
        bus.save(o)
    })
    setTimeout(() => {
        assert(!bus.cache.foo.bar)
        done()
    }, 40)
})

test(function loading_quirk (done) {
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
        done()
    }, 100)
})

test(function requires (done) {
    try {
        require.resolve('sockjs') // Will throw error if not found
        require.resolve('websocket')
    } catch (e) {
        console.warn('#### Yo!  You need to run "npm install sockjs websocket"')
        process.exit()
    }
    log('Ok good, we have the goods.')
    done()
})

test(function default_route (done) {
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
    done()
})

test(function setup_server (done) {
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

                setTimeout(function () {done()})
            }
        })
    }, 100)

    var matches = new Set()
    for (var k in s.busses) {
        log("Checking unique bus id", k, 'with name', s.busses[k].toString())
        console.assert(!matches.has(k), 'duplicate bus id', k)
        matches.add(k)
    }
})

test(function login (done) {
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
            setTimeout(function () {done()})
        } else
            log("Ok... we aren't logged in yet.  We be patient.")
    })
    // c.honk = user0.honk = true
    var u = c.fetch('/current_user')
    u.login_as = {name: 'mike', pass: 'yeah'}
    log('Logging in')
    c.save(u)
})

test(function wrong_password (done) {
    var u = c.fetch('/current_user')
    assert(u.logged_in && u.user.name == 'mike')
    u.login_as = {name: 'j', pass: 'nah'}
    c.save(u)
    setTimeout(function () {
        assert(!u.login_as, 'Aborted login needs to abort')
        log('Good, the login failed.')
        done()
    }, 300)
})

test(function create_account (done) {
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
            // These are triggering a weird race condition bug, where the
            // server sends a duplicate {user: {key: 'user/bob', name:
            // 'bob', email: 'b@o.b'}, logged_in: true, key:
            // 'current_user'} event, triggering a re-render at 7 before
            // the logout has transpired.
            // c.honk = true
            // s.honk = true
            log('In 3   -    Creating bob, logging in as bob')
            assert(!u.logged_in, '3 logged in')
            u.create_account = {name: 'bob', email: 'b@o.b', pass: 'boob'}
            c.save(u)

            // Note: I hope this done line isn't necessary in the future!
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
            assert(!u.logged_in, '7. still logged in, as', u)
            u.login_as = {name: 'bob', pass:'boob'}
            c.save(u)
            break
        case 8: break
        case 9:
            log('In 9   -    Forget and finish.')
            assert(u.logged_in, '9 not logged in')
            forget()
            setTimeout(function () {done()})
            break
        default:
            assert(false)
            break
        }
    })
})

function connections_helper (done, port, options) {
    // Setup a server
    var s = require('../statebus').serve({port: port,
                                          file_store: false,
                                          connections: options})
    s.label = 's'

    // Connect two clients
    var c1 = require('../statebus')()
    c1.label = 'c1'
    c1.ws_client('/*', 'statei://localhost:' + port)

    var c2 = require('../statebus')()
    c2.label = 'c2'
    c2.ws_client('/*', 'statei://localhost:' + port)

    // Load the basic connections
    c1.c = c1.fetch('/connection')
    c2.c = c2.fetch('/connection')
    c1.all = c1.fetch('/connections')

    delay(50, _=> {
        // Test
        log('c1.c:', c1.c)
        log('c2.c:', c2.c)
        log('all:', c1.all)
        assert(c1.c.id)
        assert(c2.c.id)

        // Load the connections inside
        c1.c1 = c1.fetch('/connection/' + c1.c.id)
        c1.c2 = c1.fetch('/connection/' + c2.c.id)
        c2.c1 = c2.fetch('/connection/' + c1.c.id)
        c2.c2 = c2.fetch('/connection/' + c2.c.id)
    })

    delay(50, _=> {
        // Test
        assert(c1.validate(c1.c1, {key: 'string', client: 'string', id: 'string'}))
        log('c1.c1', JSON.stringify(c1.c1))
        log('c2.c2', JSON.stringify(c2.c2))
        assert(c1.c1.id === c1.c.id)
        assert(c1.c2.id === c2.c.id)
        assert(c2.c1.id === c1.c.id)
        assert(c2.c2.id === c2.c.id)

        // Modify a connection
        c1.c.foo = 'bar'; c1.save(c1.c)
        c2.c2.fuzz = 'buzz'; c2.save(c2.c2)
    })

    delay(50, _=> {
        // Test
        assert(c1.c.foo === 'bar')
        assert(c1.c1.foo === 'bar')
        assert(c2.c1.foo === 'bar')

        assert(c2.c.fuzz === 'buzz')
        assert(c2.c2.fuzz === 'buzz')
        assert(c1.c2.fuzz === 'buzz')

        // Modify someone else's connection
        c1.c2.fuzz = 'fart'; c1.save(c1.c2)
        c2.c1.free = 'willy'; c2.save(c2.c1)
    })

    delay(50, _=> {
        // Test
        if (options.edit_others) {
            assert(c1.c2.fuzz === 'fart')
            assert(c2.c2.fuzz === 'fart')
            assert(c1.c1.free === 'willy')
            assert(c2.c1.free === 'willy')
        } else {
            assert(c1.c2.fuzz !== 'fart')
            assert(c2.c2.fuzz !== 'fart')
            assert(c1.c1.free !== 'willy')
            assert(c2.c1.free !== 'willy')
        }
    })

    // Todo: test the inclusion of users

    delay(50, _=> done())
}

test(function connections_1 (done) {
    connections_helper(done, 3951, {include_users: true, edit_others: true})
})

test(function connections_2 (done) {
    connections_helper(done, 3952, {include_users: false, edit_others: false})
})

test(function flashbacks (done) {
    // We have an echo canceler.  If you save state, it shouldn't send the
    // same state back to you, but it should send it to everyone else.  But if
    // the state is changed in a to_save handler, it *should* send you
    // changes.

    var port = 3873

    // Setup a server
    var s = require('../statebus').serve({port: port, file_store: false})
    s.label = 's'

    s('x').to_save = (o, t) => {
        log('Saving x with', o)
        o.x++        // Change the value of o.x a little
        t.done(o)
    }

    // Connect two clients
    var c1 = require('../statebus')()
    c1.label = 'c1'
    c1.ws_client('*', 'statei://localhost:' + port)

    var c2 = require('../statebus')()
    c2.label = 'c2'
    c2.ws_client('*', 'statei://localhost:' + port)
    
    c1.x = c1.fetch('x')
    c2.x = c2.fetch('x')

    // Change stuff
    delay(50, _=> {
        c1.x.x = 1
        c1.save(c1.x)
    })

    // Test stuff
    delay(50, _=> {
        assert(c2.x.x === 2, 'c2 didn\'t get it')
        assert(c1.x.x === 2, 'c1 didn\'t get it')
        log('complete!', c1.x, c2.x)
        done()
    })
})

test(function email_read_permissions (done) {
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
         function () { log("That's all, Doc."); setTimeout(function () {done()}) }]
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
})

test(function closet_space (done) {
    var s = require('../statebus').serve({port: 3949,
                                          file_store: false,
                                          client: (c)=>{c.honk=true}})
    s.label = 's'

    var c = require('../statebus')()
    c.label = 'c'
    c.ws_client('/*', 'statei://localhost:3949')

    // Make stuff as user A
    var cu = c.fetch('/current_user')
    c.save({key: '/current_user', create_account: {name: 'a', pass: 'a'}})
    c.save({key: '/current_user', login_as: {name: 'a', pass: 'a'}})
    var a_closet = c.fetch('/user/a/foo')
    var a_private = c.fetch('/user/a/private/foo')

    delay(400, () => {
        c.save({key: '/user/a/foo', _: 3})
        c.save({key: '/user/a/private/foo', _: 4})
    })

    // User A can see it
    delay(450, ()=> {
        log('1. Now curr user is', cu)
        console.assert(cu.logged_in == true, 'not logged in')
        log('closet is', a_closet)
        console.assert(a_closet._ === 3, 'closet not right')
        console.assert(a_private._ === 4, 'private not right')

        // Set up User B
        c.save({key: '/current_user', create_account: {name: 'b', pass: 'b'}})
        c.save({key: '/current_user', login_as: {name: 'b', pass: 'b'}})
    })

    // User B can't see private stuff
    delay(450, ()=> {
        log('3. Now curr user is', cu)
        log('closet is', {closet:a_closet, private:a_private})
        console.assert(a_closet._ === 3, 'A\'s closet is not visible')
        console.assert(a_private._ !== 4, 'damn can still see private')

        // User B tries editing the first closet
        a_closet._ = 5; c.save(a_closet)
    })

    // User B could not edit that
    delay(350, ()=> {
        console.assert(a_closet._ === 3, 'damn he could edit it')
    })

    delay(50, ()=>done())
})

test(function ambiguous_ordering (done) {
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
    done()
})

run_tests()