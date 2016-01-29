var extra_methods = {
    setup: function setup (options) {
        var bus = this
        options = options || {}
        var c = options.client_definition
        if (!('file_store' in options) || options.file_store)
            bus.file_store('*')                                // Save everything to a file
        bus('*').on_save = function reflect (o) { bus.pub(o) } // No security/validation

        // Custom route
        var OG_route = bus.route
        bus.route = function(key, method, arg) {
            var count = OG_route(key, method, arg)

            // This whitelists anything we don't have a specific handler for,
            // reflecting it to all clients!
            if (count === 0 && method === 'save')
                bus.pub(arg)

            return count
        }
    },
    serve: function serve (options) {
        var bus = this
        options = options || {}
        var c = options.client_definition
        if (!('file_store' in options) || options.file_store)
            bus.file_store('*')                          // Save everything to a file
        bus.make_http_server(options)                    // Create our own http server
        bus.sockjs_server(this.http_server, c)           // Serve via sockjs on it
        bus('*').on_save = function reflect (o) { bus.pub(o) }   // No security/validation

        // Custom route
        var OG_route = bus.route
        bus.route = function(key, method, arg) {
            var count = OG_route(key, method, arg)

            // This whitelists anything we don't have a specific handler for,
            // reflecting it to all clients!
            if (count === 0 && method === 'save') {
                bus.pub(arg)
                count++
            }

            return count
        }
    },
    make_http_server: function make_http_server (options) {
        options = options || {}
        var port = options.port || 3000
        var fs = require('fs')

        if (fs.existsSync('certs')) {
            // Load with TLS/SSL
            console.log('Encryption ON')
            var http = require('https')
            var protocol = 'https'
            var ssl_options = {
                ca: require('split-ca')('certs/certificate-bundle'),
                key:  fs.readFileSync('certs/private-key'),
                cert: fs.readFileSync('certs/certificate'),
                ciphers: "ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384"
                    + ":ECDHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA256"
                    + ":ECDHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA256"
                    + ":HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA",
                honorCipherOrder: true}
        }
        else {
            // Load unencrypted server
            console.log('Encryption OFF')
            var http = require('http')
            var protocol = 'http'
            var ssl_options = undefined
        }

        this.http_server = http.createServer(ssl_options)
        this.http_server.listen(port, function(){
            console.log('Listening on '+protocol+ '//:<host>:' + port)
        })
    },

    sockjs_server: function sockjs_server(httpserver, user_bus_func) {
        var master = this
        master.pub({key: 'connections'}) // Clean out old sessions
        var connections = master.fetch('connections')
        var s = require('sockjs').createServer({
            sockjs_url: 'https://cdn.jsdelivr.net/sockjs/0.3.4/sockjs.min.js' })
        s.on('connection', function(conn) {
            connections[conn.id] = {}; master.pub(connections)
            var user = user_bus_func ? make_server_bus() : master
            //user.label = user.label || 'client ' + conn.id
            if (user_bus_func) user_bus_func(user, conn)

            var our_fetches_in = {}  // Every key that every client has fetched.
            console.log('sockjs_s: New connection from', conn.remoteAddress)
            function sockjs_pubber (obj) {
                conn.write(JSON.stringify({method: 'pub', obj: obj}))
                console.log('sockjs: SENT', obj.key)
            }
            conn.on('data', function(message) {
                try {
                    message = JSON.parse(message)
                    var method = message.method.toLowerCase()
                    var arg = message.key || message.obj
                    console.log('sockjs_s:', method, arg)
                    if (!arg) throw 'Missing argument in message'
                } catch (e) {
                    console.error('Received bad sockjs message from '
                                  + conn.remoteAddress +': ', message, e)
                }

                switch (message.method) {
                case 'fetch':  our_fetches_in[arg] = true; break
                case 'forget': delete our_fetches_in[arg]; break
                case 'delete': message.method = 'del';     break
                }

                user[message.method](arg, sockjs_pubber)

                // validate that our fetches_in are all in the bus
                for (var key in our_fetches_in)
                    if (!user.fetches_in.contains(key, master.funk_key(sockjs_pubber)))
                        console.trace("***\n****\nFound errant key", key,
                                      'when receiving a sockjs', message.method, 'on', arg)
                //console.log('sockjs_s: done with message')
            })
            conn.on('close', function() {
                console.log('sockjs_s: disconnected from', conn.remoteAddress, conn.id, user.id)
                for (var key in our_fetches_in)
                    user.forget(key, sockjs_pubber)
                delete connections[conn.id]; master.pub(connections)
                user.delete_bus()
            })
            if (user_bus_func) {
                user('/connection').on_fetch = function () {
                    var c = user.clone(connections[conn.id])
                    if (c.user) c.user = user.fetch(c.user.key)
                    return {mine: c}
                }
                user('/connection').on_save = function (o) {
                    connections[conn.id] = o.mine
                    master.pub(connections)
                }
                user('/connections').on_save = function noop () {}
                user('/connections').on_fetch = function () {
                    var result = []
                    var conns = master.fetch('connections')
                    for (connid in conns)
                        if (connid !== 'key') {
                            var c = master.clone(conns[connid])
                            if (c.user) c.user = user.fetch(c.user)
                            result.push(c)
                        }
                    
                    return {all: result}
                }
            }
        })

        s.installHandlers(httpserver, {prefix:'/statebus'});
    },

    ws_server: function ws_server(httpserver, ws, user_bus_func) {
        var master = this
        var connections = master.fetch('connections')
        var next_id = 0
        master.pub({key: 'connections'}) // Clean out old sessions
        var s = new ws.Server({server: httpserver})
        s.on('connection', function(socket) {
            socket.remoteAddress = (socket.upgradeReq.connection.remoteAddress
                                    || socket.remoteAddress)
            socket.write = socket.write || socket.send
            socket.id = next_id++
            connections[socket.id] = {}; save(connections)
            var user = user_bus_func ? make_bus() : master
            if (user_bus_func) user_bus_func(user, socket)

            var our_fetches_in = {}  // Every key that every client has fetched.
            console.log('ws: New connection from', socket.remoteAddress)
            function ws_pubber (obj) {
                console.log('ws_pubber:', obj.key)
                socket.write(JSON.stringify({method: 'pub', obj: obj}))
            }
            socket.on('data', function(message) {
                console.log('Got message', messasge)
                try {
                    message = JSON.parse(message)
                    var method = message.method.toLowerCase()
                    var arg = message.key || message.obj
                    console.log('ws:', method, arg)
                    if (!arg) throw 'Missing argument in message'
                } catch (e) {
                    console.error('Received bad ws message from '
                                  + socket.remoteAddress +': ', message, e)
                }

                switch (message.method) {
                case 'fetch':  our_fetches_in[arg] = true; break
                case 'forget': delete our_fetches_in[arg]; break
                case 'delete': message.method = 'del';     break
                }

                user[message.method](arg, ws_pubber)

                // validate that our fetches_in are all in the bus
                for (var key in our_fetches_in)
                    if (!user.fetches_in.contains(key, master.funk_key(ws_pubber)))
                        console.trace("***\n****\nFound errant key", key,
                                      'when receiving a ws', message.method, 'on', arg)
            })
            socket.on('close', function() {
                console.log('ws: disconnected from', socket.remoteAddress, socket.id, user.id)
                for (var key in our_fetches_in)
                    user.forget(key, ws_pubber)
                delete connections[socket.id]; save(connections)
                user.delete_bus()
            })
            user('/connection').on_fetch = function () { return {mine: connections[socket.id]} }
        })

        // s.installHandlers(httpserver, {prefix:'/statebus'});

        master('/connections').on_fetch = function (key) {
            var result = []
            for (c in master.fetch('connections'))
                if (c !== 'key') result.push(c)
            return {all: result}
        }
        master('/connections').on_save = function () {}
    },

    socketio_server: function socketio_server (http_server, socket_io_module) {
        var io = socket_io_module.listen(http_server)
        
        var fetches_in = {}  // Every key that every client has fetched.
        io.on('connection', function(client){
            console.log('New connection from', client.id)

            function save_cb (obj) {
                // Error check
                if (!io.sockets.connected[client.id]) {
                    console.error("DAMN got a stale socket_id", client.id,
                                  '(the keys are', Object.keys(io.sockets.connected))
                    disconnect_everything()
                    return
                }

                // Do the save
                console.log('Sending', obj.key, 'to', client.id)
                client.emit('save', obj)
            }

            function disconnect_everything() {
                console.log(client.id, 'just disconnected')
                for (var key in fetches_in)
                    forget(key, save_cb)
            }
            client.on('disconnect', disconnect_everything)

            client.on('fetch', function (key) {
                console.log('socketio_server: fetching', key, 'for', client.id)
                fetch(key, save_cb)
                fetches_in[key] = true
            })
            client.on('save', function (obj) {
                console.log('Saving', obj, 'for', client.id)
                save(obj, save_cb)
            })
            client.on('forget', function (key) {
                console.log('Forgetting', key, 'for', client.id)
                forget(key, save_cb)
                delete fetches_in[key]
            })
            client.on('delete', function (key) {
                console.log('Deleting', key)
                del(key)
                // del(key) doesn't need a second arg, because all
                // that does is skip any .on_del listeners, and we
                // don't have any here.
            })
        })
    },

    file_store: function file_store (prefix, options) {
        // This should get run before anything else so it can load
        // data into the statebus cache

        var bus = this

        // Make a database for the server
        var filename = (options && options.filename) || 'db'
        var backup_dir = (options && options.backup_dir) || 'backups'

        var fs = require('fs')
        var db = {}
        var db_is_ok = false
        var save_timer = null
        function save_db() {
            save_timer = null
            if (!db_is_ok) return
            fs.writeFile('db', JSON.stringify(db, null, 1), function(err) {
                if (err) {
                    console.log('Crap! DB IS DYING!!!!')
                    db_is_ok = false
                }
                console.log(err || 'saved db')
            })
        }
        try {
            if (fs.existsSync && !fs.existsSync('db'))
                (fs.writeFileSync('db', '{}'), console.log('Made a new db file'))
            db = JSON.parse(fs.readFileSync('db'))
            db_is_ok = true
            // If we put before anything else is connected, we'll get this
            // into the cache but not affect anything else
            pub(db)
            console.log('Read db')
        } catch (e) {
            console.log(e)
            console.log('bad db file')
        }

        bus(prefix).on_save = function file_store (obj) {
            db[obj.key]=obj
            save_timer = save_timer || setTimeout(save_db, 100)
        }

        setInterval(
            // This copies the current db over backups/db.<curr_date> every minute
            function backup_db() {
                if (!db_is_ok) return
                if (fs.existsSync && !fs.existsSync(backup_dir))
                    fs.mkdirSync(backup_dir)

                var d = new Date()
                var y = d.getYear() + 1900
                var m = d.getMonth() + 1
                if (m < 10) m = '0' + m
                var day = d.getDate()
                if (day < 10) day = '0' + day
                var date = y + '-' + m + '-' + day

                //console.log('Backing up db on', date)

                require('child_process').execFile(
                    '/bin/cp', [filename, backup_dir+'/'+filename+'.'+date])
            },
            1000 * 60 // Every minute
        )
    },

    sqlite_query_server: function sqlite_query_server (db) {
        var bus = this
        var fetch = bus.fetch
        bus('/table_columns/*').on_fetch =
            function fetch_table_columns (key) {
                if (typeof key !== 'string')
                    console.log(handlers.hash)
                var table_name = key.split('/')[2]
                var columns = fetch('/sql/PRAGMA table_info(' + table_name + ')').rows.slice()
                var foreign_keys = fetch('/table_foreign_keys/' + table_name)
                var column_info = {}
                for (var i=0;i< columns .length;i++) {
                    var col = columns[i].name
                    column_info[col] = columns[i]
                    // if (col === 'customer' || col === 'customers')
                    //     console.log('FOR CUSTOMER, got', col, foreign_keys[col])
                    column_info[col].foreign_key = foreign_keys[col] && foreign_keys[col].table
                    columns[i] = col
                }
                columns.splice(columns[columns.indexOf('id')], 1)
                column_info['key'] = column_info['id']
                delete column_info['id']
                return {columns:columns, column_info:column_info}
            }


        bus('/table_foreign_keys/*').on_fetch =
            function table_foreign_keys (key) {
                var table_name = key.split('/')[2]
                var foreign_keys = fetch('/sql/PRAGMA foreign_key_list(' + table_name + ')').rows
                var result = {}
                for (var i=0;i< foreign_keys .length;i++)
                    result[foreign_keys[i].from] = foreign_keys[i]
                delete result.id
                result.key = key
                pub(result)
            }

        bus('/sql/*').on_fetch =
            function sql (key) {
                fetch('timer/60000')
                var query = key.substr('/sql/'.length)
                try { query = JSON.parse(query) }
                catch (e) { query = {stmt: query, args: []} }
                
                db.all(query.stmt, query.args,
                       function (err, rows) {
                           if (rows) pub({key:key, rows: rows})
                           else console.error('Bad sqlite query', key, err)
                       }.bind(this))
            }
    },

    sqlite_table_server: function sqlite_table_server(db, table_name) {
        var bus = this
        var save = bus.save, fetch = bus.fetch
        var table_columns = fetch('/table_columns/'+table_name) // This will fail if used too soon
        var foreign_keys  = fetch('/table_foreign_keys/'+table_name)
        var remapped_keys = fetch('/remapped_keys')
        remapped_keys.keys = remapped_keys.keys || {}
        remapped_keys.revs = remapped_keys.revs || {}
        function row_json (row) {
            var result = {key: '/' + table_name + '/' + row.id}
            for (var k in row)
                if (row.hasOwnProperty(k))
                    result[k] = (foreign_keys[k] && row[k]
                                 ? '/' + foreign_keys[k].table + '/' + row[k]
                                 : result[k] = row[k])
            if ('other' in result) result.other = JSON.parse(result.other || '{}')
            delete result.id
            return result
        }
        function json_values (json) {
            var columns = table_columns.columns
            var result = []
            for (var i=0; i<columns.length; i++) {
                var col = columns[i]
                var val = json[col]

                // JSONify the `other' column
                if (col === 'other')
                    val = JSON.stringify(val || {})

                // Convert foreign keys from /customer/3 to 3
                else if (foreign_keys[col] && typeof val === 'string') {
                    val = remapped_keys.keys[val] || val
                    val = json[columns[i]].split('/')[2]
                }

                result.push(val)
            }
            return result
        }
        function render_table () {
            var result = []
            db.all('select * from ' + table_name, function (err, rows) {
                if (err) console.error('Problem with table!', table_name, err)
                for (var i=0; i<rows.length; i++)
                    result[i] = row_json(rows[i])
                pub({key: '/'+table_name, rows: result})
            })
        }
        function render_row(obj) {
            pub(row_json(obj))
            if (remapped_keys.revs[obj.key]) {
                var alias = bus.clone(obj)
                alias.key = remapped_keys.revs[obj.key]
                pub(row_json(alias))
            }
        }

        // ************************
        // Handlers!
        // ************************

        // Fetching the whole table, or a single row
        bus('/' + table_name + '*').on_fetch = function (key) {
            if (key.split('/').length < 3)
                // Return the whole table
                return render_table()

            key = remapped_keys.keys[key] || key

            var id = key.split('/')[2]
            db.get('select * from '+table_name+' where rowid = ?',
                   [id],
                   function (err, row) {
                       if (!row)
                       { console.log('Row', id, "don't exist.", err); return }

                       render_row(row)
                   }.bind(this))
        }

        // Saving a row
        bus('/'+ table_name + '/*').on_save = function (obj) {
            var columns = table_columns.columns
            var key = remapped_keys.keys[obj.key] || obj.key

            // Compose the query statement
            var stmt = 'update ' + table_name + ' set '
            var rowid = key.split('/')[2]
            var vals = json_values(obj)
            for (var i=0; i<columns.length; i++) {
                stmt += columns[i] + ' = ?'
                //vals.push(obj[columns[i]])
                if (i < columns.length - 1)
                    stmt += ', '
            }
            stmt += ' where rowid = ?'
            vals.push(rowid)

            // Run the query
            db.run(stmt, vals,
                   function (e,r) {
                       console.log('updated',e,r,key)
                       bus.dirty(key)
                   })
        }

        // Inserting a new row
        bus('/new/' + table_name + '/*').on_save = function (obj) {
            var columns = table_columns.columns
            var stmt = ('insert into ' + table_name + ' (' + columns.join(',')
                        + ') values (' + new Array(columns.length).join('?,') + '?)')
            var values = json_values(obj)

            console.log('Sqlite:' + stmt)

            db.run(stmt, values, function (error) {
                if (error) console.log('INSERT error!', error)
                console.log('insert complete, got id', this.lastID)
                remapped_keys.keys[obj.key] = '/' + table_name + '/' + this.lastID
                remapped_keys.revs[remapped_keys.keys[obj.key]] = obj.key
                save(remapped_keys)
                render_table()
            })
        }

        // Deleting a row
        bus('/'+ table_name + '/*').on_delete = function (key) {
            if (remapped_keys.keys[key]) {
                var old_key = key
                var new_key = remapped_keys.keys[key]
                delete remapped_keys.keys[old_key]
                delete remapped_keys.revs[new_key]
                key = new_key
            }

            var stmt = 'delete from ' + table_name + ' where rowid = ?'
            var rowid = key.split('/')[2]
            console.log('DELETE', stmt)
            db.run(stmt, [rowid],
                   function (err) {
                       if (err) console.log('DELETE error', err)
                       else     console.log('delete complete')
                       render_table() })
        }
    },

    serves_auth: function serves_auth (conn, master) {
        var user = this // to keep me straight while programming

        // Initialize salt
        var a = master.fetch('auth')
        if (!a.salt) { a.salt = Math.random(); master.save(a) }
        var salt = a.salt
            
        // Initialize master
        if (master('users/passwords').on_fetch.length === 0) {
            master('users/passwords').on_fetch = function (k) {
                var result = {key: 'users/passwords'}
                var users = master.fetch('/users')
                for (var i=0; i<users.all.length; i++) {
                    var u = master.fetch(users.all[i])
                    if (u.name !== 'key')
                        result[u.name] = {user: u.key, pass: u.pass}
                    else
                        console.error("upass: can't have a user named key, dude.", u.key)
                }
                //console.log('upass: ', result)
                return result
            }

            master('/online_users').on_fetch = function () {
                var result = []
                var conns = master.fetch('connections')
                console.log('online: conns', conns)
                for (var conn in conns) if (conn !== 'key') result.push(conns[conn].user)
                return {all: result}
            }
        }
        user('/online_users').on_fetch = function (k) {
            var result = master.fetch(k)
            for (var i=0; i<result.all.length; i++) {
                console.log(result.all[i].key)
                result.all[i] = user.fetch(result.all[i])
            }
            return result
        }
        function authenticate (name, pass) {
            if (name === 'key') return false
            var userpass = master.fetch('users/passwords')[name]
            if (!userpass) return null

            console.log('authenticate: we see',
                        userpass.pass,
                        pass,
                        userpass.pass === pass
                       )
            if (userpass.pass === pass)
                return master.fetch(userpass.user)
        }

        user('/current_user').on_fetch = function () {
            //console.log('/current_user.on_fetch is defining it')
            if (!conn.client) return
            var u = master.fetch('logged_in_clients')[conn.client]
            // console.log('Giving a /current_user for', conn.client,
            //             master.fetch('logged_in_clients'))
            return {user: u || null, salt: salt, logged_in: !!u}
        }

        user('/current_user').on_save = function (o) {
            console.log('current_user: saving', o)

            if (o.client && !conn.client) {
                // Set the client
                conn.client = o.client

                var connections = master.fetch('connections')
                connections[conn.id].user = master.fetch('logged_in_clients')[conn.client]
                master.save(connections)
            }

            else if (o.login_as) {
                // Then client is trying to log in
                console.log('current_user: trying to log in')
                var creds = o.login_as

                if (creds.name && creds.pass) {
                    // With a username and password
                    var u = authenticate(creds.name, creds.pass)
                    if (u) {
                        // Success!
                        // Associate this user with this session
                        console.log('Logging the user in!', u)

                        var clients     = master.fetch('logged_in_clients')
                        var connections = master.fetch('connections')

                        clients[conn.client]      = u
                        connections[conn.id].user = u

                        master.save(clients)
                        master.save(connections)
                    }
                }
            }

            else if (o.logout) {
                var clients = master.fetch('logged_in_clients')
                delete clients[conn.client]
                save(clients)
            }

            user.dirty('/current_user')
        }

        // setTimeout(function () {
        //     console.log('DIRTYING!!!!!')
        //     user.dirty('/current_user')
        //     console.log('DIRTIED!!!!!')
        // }, 4000)

        user('/user/*').on_save = function (o) {
            var c = user.fetch('/current_user')
            console.log(o.key + '.on_save:', o, c.logged_in, c.user)
            if (c.logged_in && c.user.key === o.key) {
                var u = master.fetch(o.key)
                u.email = o.email
                u.name = o.name
                u.pass = o.pass || u.pass
                master.save(u)
                o = user.clone(u)
                console.log(o.key + '.on_save: saved user to master')
            }

            user.dirty(o.key)
        }

        user('/user/*').on_fetch = function filtered_user (k) {
            //console.trace('/user/*.on_fetch', k)
            var o = master.fetch(k)
            var c = user.fetch('/current_user')
            //console.log('/user/*: fetch', k)
            if (c.user && c.user.key === k)
                return {name: o.name, email: o.email}
            else
                return {name: o.name}
        }
        user('/users').on_fetch = function () {}
        user('/users').on_save = function () {}
    },

    route_defaults_to: function route_defaults_to (master_bus) {
        var bus = this

        // Custom route
        var OG_route = bus.route
        bus.route = function(key, method, arg) {
            var count = OG_route(key, method, arg)

            // This forwards anything we don't have a specific handler for
            // to the global cache
            if (count === 0 && key[0] === '/') {
                count++
                if (method === 'fetch')
                    bus.run_handler(function get_from_master (k) { return master_bus.fetch(k) }, method, arg)
                else if (method === 'save')
                    bus.run_handler(function save_to_master (o) { master_bus.save(bus.clone(o)) }, method, arg)
            }
            return count
        }
    }
}

function make_server_bus () {
    var bus = require('./statebus')()
    for (m in extra_methods)
        bus[m] = extra_methods[m]
    return bus
}
module.exports = make_server_bus