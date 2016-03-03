bus = require('../statebus.js')()

function log () {
    var a = Array.prototype.slice.call(arguments)
    a.unshift('   ')
    console.log.apply(console, a)
}

// Each test is a function in this array
var tests = [

    // Equality tests
    function equality (next) {
        equality_tests = [
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
            console.assert(bus.deep_equals(equality_tests[i][0],
                                           equality_tests[i][1])
                           === equality_tests[i][2],
                           'Equality test failed forward', equality_tests[i])

            console.assert(bus.deep_equals(equality_tests[i][1],
                                           equality_tests[i][0])
                           === equality_tests[i][2],
                           'Equality test failed backward', equality_tests[i])
        }

        next()
    },

    // Callbacks are reactive
    function fetch_with_callback (next) {
        var count = 0
        function cb (o) {
            count++
            log('cb called', count, 'times')
            if (count === 5) console.trace('Where did 5 come from?')
            var bar = fetch('bar')
            log('bar is', bar, 'foo is', o)

            if (count > 3)
                log('### Too many cb calls! Figure this out sometime.')
        }
        fetch('foo', cb)

        setTimeout(function () {
            log('pubbing a new foo')
            bus.pub({key: 'foo', count:count})
        }, 30)

        setTimeout(function () {
            log('pubbing a new bar')
            bus.pub({key: 'bar', count:count})
        }, 50)

        // Next
        setTimeout(function () {
            log('done with this test')
            if (count !== 3)
                log("### I want only 3 runs of cb! Figure this out!")
            bus.forget('foo', cb)
            //bus.forget('bar', cb)
            next()
        }, 100)
    },

    // Identity pubs shouldn't trigger
    function identity (next) {
        var key = 'kooder'
        var count = 0
        function fire () { bus.pub({key: 'kooder', count: count}) }
        bus(key).on_fetch = function () { setTimeout(fire, 10) }
        function cb() {
            if (count++ > 0) console.assert(false, 'cb1 too many calls')
            log('cb1 called', count, 'times')
            pub(fetch('new'))
        }
        fetch(key, cb)

        // Next
        setTimeout(function () {
            console.assert(count === 1, 'cb1 should be called only once')
            bus.forget(key, cb)
            bus(key).on_fetch.delete(fire)
            next()
        }, 200)
    },


    // bus.forget() within a callback
    function forgetting (next) {
        var key = 'kooder'
        var count = 0
        function fire () { log('firing!'); bus.pub({key: key, count: count}) }
        bus(key).on_fetch = function () { setTimeout(fire, 10) }

        function cb (o) {
            count++
            log('cb2 called', count, 'times', 'on', o)

            if (count > 2) console.assert(false, 'cb2 too many calls')
            if (count > 1) {
                log('cb2 forgetting', key)
                bus.forget(key, cb)
                log('forgot.')
            }
        }

        //bus.honk = true
        fetch(key, cb)
        setTimeout(fire, 80)
        setTimeout(fire, 90)

        // Next
        setTimeout(function () {
            //console.assert(count === 2, "Count should be 2 but is", count)
            bus(key).on_fetch.delete(fire)
            next()
        }, 200)
    },

    // Can we return an object that fetches another?
    function nested_fetch (next) {
        function outer () { return {inner: fetch('inner') } }
        bus('outer').on_fetch = outer
        log('fetching')
        var obj = fetch('outer')
        log('we got', obj)
        console.assert(obj.inner.key === 'inner')
        pub({key: 'inner', c: 1})
        console.assert(obj.inner.c === 1)

        // Next
        setTimeout(function () {
            bus('outer').on_fetch.delete(outer)
            next()
        }, 10)
    },

    // Russian dolls
    function russian_doll_nesting (next) {
        var nothing = 3
        function big () { return {middle: fetch('middle') } }
        function middle () { return {small: fetch('small') } }
        function small () { return {nothing: nothing} }
        bus('big').on_fetch = big
        bus('middle').on_fetch = middle
        bus('small').on_fetch = small

        log('fetching')
        var obj = fetch('big')
        log('we got', obj)

        setTimeout(function () {
            fetch('big', function (o) {
                nothing = 5
                log('About to update small')
                pub({key: 'small', something: nothing})
                log('We did it.')
            })}, 10)

        setTimeout(function () {
            //bus.honk = true
            fetch('big', function ruskie (o) {
                nothing = 50
                var small = fetch('small')
                log()
                log('Second try.  Small starts as', small)
                pub({key: 'small', something: nothing})
                log('Now it is', fetch('small'))
            })}, 15)


        // Next
        setTimeout(function () {
            bus.honk = false
            bus('big').on_fetch.delete(big)
            bus('middle').on_fetch.delete(middle)
            bus('small').on_fetch.delete(small)
            next()
        }, 50)
    },

    function rollback_pub (next) {
        var count = 0
        var error = false
        function wait () { setTimeout(function () {
            log('Pubbing wait')
            pub({key: 'wait', count: count})
        }, 100) }
        bus('wait').on_fetch = wait

        // Initialize
        pub({key: 'undo me', state: 'start'})
        
        // Now start the reactive function
        bus(function () {
            log('Reaction', ++count, 'starting with state',
                fetch('undo me').state, 'and loading =', bus.loading())
            // Fetch something that we have to wait for
            var wait = fetch('wait')

            // Save some middling state
            pub({key: 'undo me', state: 'progressing'})

            //bus.honk = true
            if (count === 1 && !bus.loading()) {
                log('### Error! We should be loading!')
                error = true
            }
            log('Done with this reaction')
        })
        bus.honk = false
        
        console.assert(!error)

        var state = bus.cache['undo me'].state
        log('After first reaction, the state is', state)
        console.assert(state === 'start', 'The state did not roll back.')

        // The state should still be start until 100ms
        setTimeout(function () {
                      console.assert(bus.cache['undo me'].state === 'start')
                   },
                   50)

        // The state should finally progress after 100ms
        setTimeout(function () {
                      log('state is', bus.cache['undo me'].state)
                      console.assert(bus.cache['undo me'].state === 'progressing')
                   },
                   150)

        setTimeout(function () {
            bus('wait').on_fetch.delete(wait)
            next()
        }, 200)
    },

    function rollback_del (next) {
        bus('wait forever').on_fetch = function () {} // shooting blanks
        pub({key: 'kill me', alive: true})

        // First do a del that will roll back
        bus(function () {
            log('Doing a rollback on', bus.cache['kill me'])
            fetch('wait forever')  // Never finishes loading
            del('kill me')         // Will roll back
        })
        console.assert(bus.cache['kill me'].alive === true)

        // Now a del that goes through
        bus(function () {
            log('Doing a real delete on', bus.cache['kill me'])
            del('kill me')         // Will not roll back
        })
        console.assert(!('kill me' in bus.cache))
        log('Now kill me is', bus.cache['kill me'])
        next()
    },

    function rollback_save (next) {
        var saves = []
        var done = false
        bus('candy').on_save = function (o) {saves.push(o); pub(o)}
        pub({key: 'candy', flavor: 'lemon'})

        console.log('Trying some rollbacks starting with', bus.cache['candy'])

        // First do a save that will roll back
        bus(function () { if (done) return
            log('Doing a rollback on bananafied candy')
            fetch('wait forever')                  // Never finishes loading
            save({key:'candy', flavor: 'banana'})  // Will roll back
            log('...and the candy is', bus.cache['candy'])
            forget('candy')
        })
        console.assert(bus.cache['candy'].flavor === 'lemon')
        console.assert(saves.length === 0)

        // Try rolling back another style of save
        bus(function () { if (done) return
            log("Now we'll First we licoricize the", bus.cache['candy'])
            fetch('wait forever')                  // Never finishes loading
            var candy = fetch('candy')
            candy.flavor = 'licorice'
            log('...the candy has become', bus.cache['candy'])
            save(candy)                            // Will roll back
            log('...and now it\'s rolled back to', bus.cache['candy'])
            forget('candy')
        })
        console.assert(bus.cache['candy'].flavor === 'lemon')
        console.assert(saves.length === 0)

        // Now a save that goes through
        bus(function () {
            log('Doing a real save on', bus.cache['candy'])
            save({key:'candy', flavor: 'orangina'})  // Will go through
        })
        console.assert(bus.cache['candy'].flavor = 'orangina')
        console.assert(saves.length === 1)

        log('Now candy is', bus.cache['candy'])
        done = true
        next()
    }        
]

// Run all tests
function run_next () {
    if (tests.length > 0) {
        var f = tests.shift()
        console.log('\nTesting:', f.name)
        f(run_next)
    } else
        console.log('\nDone with all tests.')
    
}
run_next()
