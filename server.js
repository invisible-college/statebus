fs = require('fs')

var util = require('util')
function make_server_bus (options)
{   var extra_methods = {
    setup: function setup (options) {
        options = options || {}
        if (!('file_store' in options) || options.file_store)
            bus.file_store('*')           // Save everything to a file

        bus.label = bus.label || 'server'

        // Custom route
        var OG_route = bus.route
        bus.route = function(key, method, arg, opts) {
            var count = OG_route(key, method, arg, opts)

            // This whitelists anything we don't have a specific handler for,
            // reflecting it to all clients!
            if (count === 0 && method === 'to_save') {
                bus.save.fire(arg, opts)
                count++
            }

            return count
        }
    },
    serve: function serve (options) {
        bus.honk = 'statelog'
        options = options || {}
        var c = options.client_definition
        if (options.client) {
            var master = bus
            master.label = 'master'
            delete global.fetch
            delete global.save
            c = function (client, conn) {
                client.honk = 'statelog'
                client.serves_auth(conn, master)
                if (!bus.options.__secure) client.route_defaults_to(master)
                options.client(client)
            }
        }

        if (!('file_store' in options) || options.file_store)
            bus.file_store('*')                // Save everything to a file

        bus.make_http_server(options)          // Create our own http server
        bus.sockjs_server(this.http_server, c) // Serve via sockjs on it
        bus.label = bus.label || 'server'

        // Custom route
        var OG_route = bus.route
        bus.route = function(key, method, arg, opts) {
            var count = OG_route(key, method, arg, opts)

            // This whitelists anything we don't have a specific handler for,
            // reflecting it to all clients!
            if (count === 0 && method === 'to_save') {
                bus.save.fire(arg, opts)
                count++
            }

            return count
        }

        // Back door to the control room
        if (options.backdoor) {
            bus.make_http_server({
                port: options.backdoor,
                name: 'backdoor_http_server'
            })
            bus.sockjs_server(this.backdoor_http_server)
        }
    },

    serve_node: function serve_node () {
        bus.honk = 'statelog'

        var master = bus
        master.label = 'master'
        delete global.fetch
        delete global.save

        var on_listen = null
        // Do extra stuff if we're root:
        //  - Bind to port 443 if SSL
        //    - Redirect port 80 to 443
        //  - Undo the sudo
        //  - Wait until that's finished before touching any files
        if (process.getuid() === 0) {

            // Setup handler for when we are listening
            var num_servers_listening = 0
            var num_servers_desired = 1
            on_listen = function () {
                num_servers_listening++
                if (num_servers_listening === num_servers_desired) {
                    // Undo the sudo
                    // Find out original user through environment variable
                    var uid = parseInt(process.env.SUDO_UID)
                    var gid = parseInt(process.env.SUDO_GID)
                    // Set our server's uid/gid to that user
                    if (gid) process.setgid(gid)
                    if (uid) process.setuid(uid)
                    console.log('Server\'s UID/GID is now '
                                + process.getuid() + '/' + process.getgid())

                    // Start writing to the file_store, since we aren't root
                    bus.file_store.activate()
                    console.log('db is active')
                }
            }

            // Add a redirect server if we have SSL
            var port = 80
            if (require('fs').existsSync('certs')) {
                port = 443
                num_servers_desired = 2

                var redirector = require('http')
                redirector.createServer(function (req, res) {
                    res.writeHead(301, {"Location": "https://"+req.headers['host']+req.url})
                    res.end()
                }).listen(80, on_listen)
            }
        } else
            var port = bus.options.port

        function c (client, conn) {
            client.honk = 'statelog'
            client.serves_auth(conn, master)
            bus.options.client && bus.options.client(client)
        }
        
        if (bus.options.file_store)
            bus.file_store('*', {delay_activate: port <= 443})

        // Create our own http server
        bus.make_http_server({port: port, on_listen: on_listen})
        bus.sockjs_server(this.http_server, c) // Serve via sockjs on it
        var express = require('express')
        bus.express = express()
        bus.http = express.Router()
        bus.install_express(bus.express)

        // User will put their routes in here
        bus.express.use('/', bus.http)

        // Add a fallback that goes to state
        // bus.express.get('*', function (req, res) {
        //     bus.fetch(  // Unfinished
        // })

        bus.serve_client_coffee()
        bus.label = bus.label || 'server'

        // Custom route
        var OG_route = bus.route
        bus.route = function(key, method, arg, opts) {
            var count = OG_route(key, method, arg, opts)

            // This whitelists anything we don't have a specific handler for,
            // reflecting it to all clients!
            if (count === 0 && method === 'to_save') {
                bus.save.fire(arg, opts)
                count++
            }

            return count
        }

        // Back door to the control room
        if (bus.options.backdoor) {
            bus.make_http_server({
                port: bus.options.backdoor,
                name: 'backdoor_http_server'
            })
            bus.sockjs_server(this.backdoor_http_server)
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
                ca: (fs.existsSync('certs/certificate-bundle')
                     && require('split-ca')('certs/certificate-bundle')),
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

        var http_server = http.createServer(ssl_options)
        http_server.listen(port, function () {
            console.log('Listening on '+protocol+ '//:<host>:' + port)
            if (options.on_listen)
                options.on_listen()
        })
        bus[options.name || 'http_server'] = http_server
    },

    install_express: function install_express (express_app) {
        this.http_server.on('request',  // Install express
		            function (request, response) {
		                // But express should ignore all sockjs requests
		                if (!request.url.startsWith('/statebus/'))
			            express_app(request, response)
		            })

    },
    sockjs_server: function sockjs_server(httpserver, user_bus_func) {
        var master = this
        var client_num = 0
        // var client_busses = {}  // XXX work in progress
        var log = master.log
        if (user_bus_func) {
            master.save({key: 'connections'}) // Clean out old sessions
            var connections = master.fetch('connections')
        }
        var s = require('sockjs').createServer({
            sockjs_url: 'https://cdn.jsdelivr.net/sockjs/0.3.4/sockjs.min.js' })
        s.on('connection', function(conn) {
            if (user_bus_func) {
                // To do for pooling client busses:
                //  - What do I do with connections?  Do they pool at all?
                //  - Before creating a new bus here, check to see if there's
                //    an existing one in the pool, and re-use it if so.
                //  - Count the number of connections using a client.
                //  - When disconnecting, decrement the number, and if it gets
                //    to zero, delete the client bus.

                connections[conn.id] = {client: conn.id}; master.save(connections)

                var user = make_server_bus()
                user.label = 'client' + client_num++
                master.label = master.label || 'master'
                user.master = master
                user_bus_func(user, conn)
            } else
                var user = master

            var our_fetches_in = {}  // Every key that every client has fetched.
            log('sockjs_s: New connection from', conn.remoteAddress)
            function sockjs_pubber (obj) {
                conn.write(JSON.stringify({save: obj}))
                log('sockjs_s: SENT a', obj, 'to client')
            }
            conn.on('data', function(message) {
                log('sockjs_s:', message)
                try {
                    message = JSON.parse(message)
                    var method = bus.message_method(message)

                    // Validate the message
                    if (!((method === 'fetch'
                           && master.validate(message, {fetch: 'string',
                                                        '?parent': 'string', '?version': 'string'}))
                          ||
                          (method === 'save'
                           && master.validate(message, {save: 'object',
                                                        '?parents': 'array', '?version': 'string'})
                           && typeof(message.save.key === 'string'))
                          ||
                          (method === 'forget'
                           && master.validate(message, {forget: 'string'}))
                          ||
                          (method === 'delete'
                           && master.validate(message, {'delete': 'string'}))))
                        throw 'validation error'

                } catch (e) {
                    for (var i=0; i<4; i++) console.error('#######')
                    console.error('Received bad sockjs message from '
                                  + conn.remoteAddress +': ', message, e)
                    return
                }

                switch (method) {
                case 'fetch':
                    our_fetches_in[message.fetch] = true
                    user.fetch(message.fetch, sockjs_pubber)
                    break
                case 'forget':
                    delete our_fetches_in[message.forget]
                    user.forget(message.forget, sockjs_pubber)
                    break
                case 'delete':
                    user.delete(message['delete'])
                    break
                case 'save':
                    message.version = message.version || user.new_version()
                    // sockjs_pubber.has_seen(user, message.save.key, message.version)
                    user.save(message.save,
                              {version: message.version,
                               parents: message.parents,
                               // Remove the peer thing, cause we'll use has_seen instead
                               peer: sockjs_pubber})
                    if (our_fetches_in[message.save.key]) {  // Store what we've seen if we
                                                             // might have to publish it later
                        user.log('Adding', message.save.key+'#'+message.version,
                                 'to pubber!')
                        sockjs_pubber.has_seen(user, message.save.key, message.version)
                    }
                    break
                }

                // validate that our fetches_in are all in the bus
                for (var key in our_fetches_in)
                    if (!user.fetches_in.has(key, master.funk_key(sockjs_pubber)))
                        console.trace("***\n****\nFound errant key", key,
                                      'when receiving a sockjs', method, 'of', message)
                //log('sockjs_s: done with message')
            })
            conn.on('close', function() {
                log('sockjs_s: disconnected from', conn.remoteAddress, conn.id, user.id)
                for (var key in our_fetches_in)
                    user.forget(key, sockjs_pubber)
                if (user_bus_func) {
                    delete connections[conn.id]; master.save(connections)
                    user.delete_bus()
                }
            })
            if (user_bus_func && !master.options.__secure) {
                user('connection').to_fetch = function () {
                    // subscribe to changes in authentication
                    // note: it would be better to be subscribed to just this particular user
                    //       changing auth, rather whenever logged_in_clients changes.  
                    master.fetch('logged_in_clients')
                    
                    var c = user.clone(connections[conn.id])
                /// XXX work in progress with client busses
                //     return {_: user.fetch('connection/' + conn.id)}
                // }
                // user('connection/*').to_fetch = function (star) {
                //     master.fetch('logged_in_clients')
                //     var c = user.clone(connections[star])
                    if (c.user) c.user = user.fetch(c.user.key)
                    return c
                }
                user('connection').to_save = function (o) {
                    delete o.key
                    o.client = conn.id // don't let client update the client id or user
                    o.user = connections[conn.id].user
                    connections[conn.id] = o
                    master.save(connections)
                }
                // To do:
                //  We want each connection in /connections.all to have a key
                //  - Make a state for '/connection/<id>',
                //    ... which will be mirrored in your '/connection'
                //  - The connections object will have an array or hash of these connections
                //  - When you save /connection, it will update to your /connection/<id>
                //  - When you fetch /connection, it will derive from /connection/<id>
                user('connections').to_save = function noop () {}
                user('connections').to_fetch = function () {
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

        s.installHandlers(httpserver, {prefix:'/statebus'})
    },

    ws_client: function (prefix, url, account) {
        function make_sock (url) {
            WebSocket = require('websocket').w3cwebsocket
            return new WebSocket(url + '/statebus/websocket')
        }
        function login (send_login_info) {
            account = account || bus.account || {}
            account.clientid = (account.clientid
                                || (Math.random().toString(36).substring(2)
                                    + Math.random().toString(36).substring(2)
                                    + Math.random().toString(36).substring(2)))

            send_login_info(account.clientid, account.name, account.pass)
        }
        bus.net_client(prefix, url, make_sock, login)
    },

    file_store: (function () {
        // Make a database
        var filename = 'db'
        var backup_dir = 'backups'

        var fs = require('fs')
        var db = {}
        var db_is_ok = false
        var pending_save = null
        var active
        function file_store (prefix, options) {
            filename = (options && options.filename) || filename
            backup_dir = (options && options.backup_dir) || backup_dir
            save_delay = ((options && options.save_delay)
                          || (bus.options.file_store && bus.options.file_store.save_delay)
                          || 250)

            // Loading db
            try {
                if (fs.existsSync && !fs.existsSync(filename))
                    (fs.writeFileSync(filename, '{}'), bus.log('Made a new db file'))
                db = JSON.parse(fs.readFileSync(filename))
                db_is_ok = true
                // If we save before anything else is connected, we'll get this
                // into the cache but not affect anything else
                bus.save.fire(db)
                bus.log('Read db')
            } catch (e) {
                console.error(e)
                console.error('bad db file')
            }

            // Saving db
            function save_db() {
                if (!db_is_ok) return

                console.time('saved db')

                fs.writeFile(filename+'.tmp', JSON.stringify(db, null, 1), function(err) {
                    if (err) {
                        console.error('Crap! DB IS DYING!!!!', err)
                        db_is_ok = false
                    } else
                        fs.rename(filename+'.tmp', filename, function (err) {
                            if (err) {
                                console.error('Crap !! DB IS DYING !!!!', err)
                                db_is_ok = false
                            } else {
                                console.timeEnd('saved db')
                                pending_save = null
                            }
                        })
                })
            }

            function save_later() {
                pending_save = pending_save || setTimeout(save_db, save_delay)
            }
            active = !options || !options.delay_activate
            function on_save (obj) {
                db[obj.key]=obj
                if (active) save_later()
            }
            on_save.priority = true
            bus(prefix).on_save = on_save
            bus(prefix).to_delete = function (key) {
                delete db[key]
                if (active) save_later()
            }
            file_store.activate = function () {
                active = true
                save_later()
            }

            // Handling errors
            function recover (e) {
                console.log('### cleanup func')
                if (e) {
                    process.stderr.write("Uncaught Exception:\n");
                    process.stderr.write(e.stack + "\n");
                }
                if (pending_save) {
                    console.log('Saving db after crash')
                    console.time()
                    fs.writeFileSync(filename, JSON.stringify(db, null, 1))
                    console.log('Saved db after crash')
                }
                process.exit(1)
            }
            process.on('SIGINT', recover)
            process.on('SIGTERM', recover)
            process.on('uncaughtException', recover)

            // Rotating backups
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

                    //bus.log('Backing up db on', date)

                    require('child_process').execFile(
                        '/bin/cp', [filename, backup_dir+'/'+filename+'.'+date])
                },
                1000 * 60 // Every minute
            )
        }

        return file_store
    })(),


    sqlite_query_server: function sqlite_query_server (db) {
        var fetch = bus.fetch
        bus('table_columns/*').to_fetch =
            function fetch_table_columns (key, rest) {
                if (typeof key !== 'string')
                    console.log(handlers.hash)
                var table_name = rest
                var columns = fetch('sql/PRAGMA table_info(' + table_name + ')').rows.slice()
                var foreign_keys = fetch('table_foreign_keys/' + table_name)
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


        bus('table_foreign_keys/*').to_fetch =
            function table_foreign_keys (key, rest) {
                var table_name = rest
                var foreign_keys = fetch('sql/PRAGMA foreign_key_list(' + table_name + ')').rows
                var result = {}
                for (var i=0;i< foreign_keys .length;i++)
                    result[foreign_keys[i].from] = foreign_keys[i]
                delete result.id
                result.key = key
                return result
            }

        bus('sql/*').to_fetch =
            function sql (key, rest) {
                fetch('timer/60000')
                var query = rest
                try { query = JSON.parse(query) }
                catch (e) { query = {stmt: query, args: []} }
                
                db.all(query.stmt, query.args,
                       function (err, rows) {
                           if (rows) bus.save.fire({key:key, rows: rows})
                           else console.error('Bad sqlite query', key, err)
                       }.bind(this))
            }
    },

    sqlite_table_server: function sqlite_table_server(db, table_name) {
        var save = bus.save, fetch = bus.fetch
        var table_columns = fetch('table_columns/'+table_name) // This will fail if used too soon
        var foreign_keys  = fetch('table_foreign_keys/'+table_name)
        var remapped_keys = fetch('remapped_keys')
        remapped_keys.keys = remapped_keys.keys || {}
        remapped_keys.revs = remapped_keys.revs || {}
        function row_json (row) {
            var result = {key: table_name + '/' + row.id}
            for (var k in row)
                if (row.hasOwnProperty(k))
                    result[k] = (foreign_keys[k] && row[k]
                                 ? foreign_keys[k].table + '/' + row[k]
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
                    val = json[columns[i]].split('/')[1]
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
                bus.save.fire({key: table_name, rows: result})
            })
        }
        function render_row(obj) {
            bus.save.fire(row_json(obj))
            if (remapped_keys.revs[obj.key]) {
                var alias = bus.clone(obj)
                alias.key = remapped_keys.revs[obj.key]
                bus.save.fire(row_json(alias))
            }
        }

        // ************************
        // Handlers!
        // ************************

        // Fetching the whole table, or a single row
        bus(table_name + '*').to_fetch = function (key, rest) {
            if (rest === '')
                // Return the whole table
                return render_table()

            if (rest[0] !== '/') return {error: 'bad key: ' + key}
            key = remapped_keys.keys[key] || key

            var id = key.split('/')[1]
            db.get('select * from '+table_name+' where rowid = ?',
                   [id],
                   function (err, row) {
                       if (!row)
                       { console.log('Row', id, "don't exist.", err); return }

                       render_row(row)
                   }.bind(this))
        }

        // Saving a row
        bus(table_name + '/*').to_save = function (obj, rest) {
            var columns = table_columns.columns
            var key = remapped_keys.keys[obj.key] || obj.key

            // Compose the query statement
            var stmt = 'update ' + table_name + ' set '
            var rowid = rest
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
        bus('new/' + table_name + '/*').to_save = function (obj) {
            var columns = table_columns.columns
            var stmt = ('insert into ' + table_name + ' (' + columns.join(',')
                        + ') values (' + new Array(columns.length).join('?,') + '?)')
            var values = json_values(obj)

            console.log('Sqlite:' + stmt)

            db.run(stmt, values, function (error) {
                if (error) console.log('INSERT error!', error)
                console.log('insert complete, got id', this.lastID)
                remapped_keys.keys[obj.key] = table_name + '/' + this.lastID
                remapped_keys.revs[remapped_keys.keys[obj.key]] = obj.key
                save(remapped_keys)
                render_table()
            })
        }

        // Deleting a row
        bus(table_name + '/*').to_delete = function (key, rest) {
            if (remapped_keys.keys[key]) {
                var old_key = key
                var new_key = remapped_keys.keys[key]
                delete remapped_keys.keys[old_key]
                delete remapped_keys.revs[new_key]
                key = new_key
            }

            var stmt = 'delete from ' + table_name + ' where rowid = ?'
            var rowid = rest
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

        // Initialize master
        if (master('users/passwords').to_fetch.length === 0) {
            master('users/passwords').to_fetch = function (k) {
                var result = {key: 'users/passwords'}
                var users = master.fetch('users')
                users.all = users.all || []
                for (var i=0; i<users.all.length; i++) {
                    var u = master.fetch(users.all[i])
                    if (u.name !== 'key')
                        result[u.name] = {user: u.key, pass: u.pass}
                    else
                        console.error("upass: can't have a user named key, dude.", u.key)
                }
                return result
            }

        }
        function authenticate (name, pass) {
            var userpass = master.fetch('users/passwords')[name]
            master.log('authenticate: we see',
                master.fetch('users/passwords'),
                userpass && userpass.pass,
                pass)


            if (!(typeof name === 'string' && typeof pass === 'string')) return false
            if (name === 'key') return false
            if (!userpass) return null

            //console.log('comparing passwords', pass, userpass.pass)
            if (require('bcrypt-nodejs').compareSync(pass, userpass.pass))
                return master.fetch(userpass.user)
        }
        function create_account (params) {
            if (!(   typeof params.name === 'string'
                  && typeof params.pass === 'string'
                  && typeof params.email === 'string'))
                return false

            var passes = master.fetch('users/passwords')
            if ([params.name] in passes)
                return false

            // Hash password
            params.pass = require('bcrypt-nodejs').hashSync(params.pass)

            // Choose account key
            var key = 'user/' + params.name
            if (key in master.cache)
                key = 'user/' + Math.random().toString(36).substring(7)

            // Make account object
            var new_account = {key: key,
                               name: params.name,
                               pass: params.pass,
                               email: params.email,
                               admin: false }

            var users = master.fetch('users')
            users.all.push(new_account)
            passes[params.name] = {user: new_account.key,
                                   pass: new_account.pass}
            master.save(users)
            master.save(passes)
            return true
        }

        user('current_user').to_fetch = function () {
            user.log('* current_user fetching')
            if (!conn.client) return
            var u = master.fetch('logged_in_clients')[conn.client]
            u = u && user_obj(u.key, true)
            return {user: u || null, logged_in: !!u}
        }

        user('current_user').to_save = function (o) {
            function error (msg) {
                user.save.abort(o)
                var c = user.fetch('current_user')
                c.error = msg
                user.save(c)
            }

            user.log('* Current User Saver going!')
            if (o.client && !conn.client) {
                // Set the client
                conn.client = o.client
                user.client_id = o.client
                user.client_ip = conn.remoteAddress

                var connections = master.fetch('connections')
                connections[conn.id].user = master.fetch('logged_in_clients')[conn.client]
                master.save(connections)
            }
            else {
                if (o.create_account) {
                    user.log('current_user: creating account')
                    if (create_account(o.create_account))
                        user.log('Success creating account!')
                    else {
                        error('Cannot create that account')
                        return
                    }
                }

                if (o.login_as) {
                    // Then client is trying to log in
                    user.log('current_user: trying to log in')
                    var creds = o.login_as

                    if (creds.name && creds.pass) {
                        // With a username and password
                        var u = authenticate(creds.name, creds.pass)

                        user.log('auth said:', u)
                        if (u) {
                            // Success!
                            // Associate this user with this session
                            // user.log('Logging the user in!', u)

                            var clients     = master.fetch('logged_in_clients')
                            var connections = master.fetch('connections')

                            clients[conn.client]      = u
                            connections[conn.id].user = u

                            master.save(clients)
                            master.save(connections)
                        }
                        else {
                            error('Cannot log in with that information')
                            return
                        }
                    }
                    else {
                        error('Cannot log in with that information')
                        return
                    }
                }

                else if (o.logout) {
                    user.log('current_user: logging out')
                    var clients = master.fetch('logged_in_clients')
                    var connections = master.fetch('connections')

                    delete clients[conn.client]
                    connections[conn.id].user = null

                    master.save(clients)
                    master.save(connections)
                }
            }

            user.dirty('current_user')
        }

        // setTimeout(function () {
        //     log('DIRTYING!!!!!')
        //     user.dirty('current_user')
        //     log('DIRTIED!!!!!')
        // }, 4000)

        user('user/*').to_save = function (o) {
            var c = user.fetch('current_user')
            user.log(o.key + '.to_save:', o, c.logged_in, c.user)
            if (c.logged_in && c.user.key === o.key) {
                var u = master.fetch(o.key)
                u.email = o.email
                u.name = o.name

                // Hash password
                o.pass = o.pass && require('bcrypt-nodejs').hashSync(o.pass)
                u.pass = o.pass || u.pass

                // user's avatar
                if(o.pic && o.pic.indexOf('data:image') > -1) {
                    var img_type = o.pic.match(/^data:image\/(\w+);base64,/)[1]
                    var b64 = o.pic.replace(/^data:image\/\w+;base64,/, '')
                    var upload_dir = 'static/'
                    // ensure that the uploads directory exists
                    if (!fs.existsSync(upload_dir)){
                        fs.mkdirSync(upload_dir)
                    }

                    // bug: users with the same name can overwrite each other's files
                    u.pic = u.name + '.' + img_type
                    fs.writeFile(upload_dir + u.pic, b64, {encoding: 'base64'})
                }


                master.save(u)
                o = user.clone(u)
                user.log(o.key + '.to_save: saved user to master')
            }

            user.dirty(o.key)
        }

        function user_obj (k, logged_in) {
            var o = master.fetch(k)
            if (logged_in)
                return {key: k, name: o.name, pic: o.pic, email: o.email}
            else
                return {key: k, name: o.name, pic: o.pic}
        }
        user('user/*').to_fetch = function filtered_user (k) {
            var c = user.fetch('current_user')
            return user_obj(k, c.logged_in && c.user.key === k)
        }
        user('users').to_fetch = function () {}
        user('users').to_save = function () {}
    },

     code_restarts: function () {
         var got = {}
         bus('code/*').on_save = function (o) {
             bus.log('Ok restart, we\'ll quit if ' + (got[o.key]||false))
             if (got[o.key])
                 process.exit(1)
             if (o.code)
                 got[o.key] = true
         }
     },

    persist: function (prefix_to_sync, validate) {
        var client = this
        var was_logged_in = false

        function client_prefix (current_user) {
            return 'client/' + (current_user.logged_in
                                 ? current_user.user.key.substr('user/'.length)
                                 : client.client_id)
        }

        function copy_client_to_user(client, user) {
            var old_prefix = 'client/' + client.client_id
            var new_prefix = 'client/' + user.key.substr('user/'.length)
            var cache = client.master.cache

            var keys = Object.keys(cache)         // Make a copy
            for (var i=0; i<keys.length; i++) {   // Because we'll mutate
                var old_key = keys[i]             // As we iterate

                if (old_key.startsWith(old_prefix)) {
                    var new_key = new_prefix + old_key.substr(old_prefix.length)
                    var o = client.clone(cache[old_key])
                    // Delete the old
                    client.master.del(old_key)

                    if (!(new_key in cache)) {
                        // Save the new
                        o.key = new_key
                        client.master.save(o)
                    }
                }
            }
        }

        client(prefix_to_sync).to_fetch = function (key) {
            var c = client.fetch('current_user')
            if (client.loading()) return
            var prefix = client_prefix(c)

            if (!was_logged_in && c.logged_in)
                // User just logged in!  Let's copy his stuff over
                copy_client_to_user(client, c.user)
            was_logged_in = c.logged_in

            // Get the state from master
            var obj = client.clone(client.master.fetch(prefix + key))

            // Translate it back to client
            obj = client.deep_map(obj, function (o) {
                if (typeof o === 'object' && 'key' in o && typeof o.key === 'string')
                    o.key = o.key.substr(prefix.length)
                return o
            })
            return obj
        }

        client(prefix_to_sync).to_save = function (obj) {
            if (validate && !validate(obj)) {
                console.warn('Validation failed on', obj)
                client.save.abort(obj)
                return
            }

            var c = client.fetch('current_user')
            if (client.loading()) return
            var prefix = client_prefix(c)

            // Make it safe
            obj = client.clone(obj)
            obj = client.deep_map(obj, function (o) {
                if (typeof o === 'object' && 'key' in o && typeof o.key === 'string')
                    o.key = prefix + o.key
                return o
            })

            // Save to master
            client.master.save(obj)
        }

        client(prefix_to_sync).to_delete = function (k) {
            client.master.delete(client_prefix(client.fetch('current_user')) + k)
        }
    },

    route_defaults_to: function route_defaults_to (master_bus) {
        // Custom route
        var OG_route = bus.route
        bus.route = function(key, method, arg, t) {
            var count = OG_route(key, method, arg, t)

            // This forwards anything we don't have a specific handler for
            // to the global cache
            if (count === 0) {
                count++
                if (method === 'to_fetch')
                    bus.run_handler(function get_from_master (k) {
                        // console.log('DEFAULT FETCHing', k)
                        var r = master_bus.fetch(k)
                        // console.log('DEFAULT FETCHed', r)
                        bus.save.fire(r, {version: master_bus.versions[r.key]})
                        }, method, arg)
                else if (method === 'to_save')
                    bus.run_handler(function save_to_master (o, t) {
                        // console.log('DEFAULT ROUTE', t)
                        master_bus.save(bus.clone(o), t)
                    }, method, arg, {t: t})
            }
            return count
        }
    },

    read_file: function init (filename) {
        // The first time this is run, we initialize it by loading some
        // libraries
        var chokidar = require('chokidar')
        var watchers = {}
        var fs = require('fs')

        // Now we redefine the function
        bus.read_file = bus.uncallback(
            function (filename, cb) {
                fs.readFile(filename, (err, result) => {
                    if (err) console.error('Error in read_file:', err)
                    cb(null, result.toString())
                })
            },
            {
                start_watching: (args, dirty) => {
                    watchers[filename] = chokidar.watch(filename)
                    watchers[filename].on('change', () => { dirty() })
                },
                stop_watching: (json) => {
                    filename = json[0]
                    // log('unwatching', filename)
                    watchers[filename].close()
                    delete watchers[filename]
                }
            })
        return bus.read_file(filename)
    },

    http_serve: function http_serve (route, fetcher) {
        var textbus = make_server_bus()
        textbus.label = 'textbus'
        var watched = new Set()
        textbus('*').to_fetch = (filename, old) => {
            return {etag: Math.random() + '',
                    _: fetcher(filename)}
        }
        bus.http.get(route, (req, res) => {
            var path = req.path
            var etag = textbus.cache[path] && textbus.cache[path].etag
            if (etag && req.get('If-None-Match') === etag) {
                res.status(304).end()
                return
            }

            textbus.fetch(req.path) // So that textbus never clears the cache
            textbus.fetch(req.path, function cb (o) {
                res.setHeader('Cache-Control', 'public')
                // res.setHeader('Cache-Control', 'public, max-age='
                //               + (60 * 60 * 24 * 30))  // 1 month
                res.setHeader('ETag', o.etag)
                res.setHeader('content-type', 'application/javascript')
                res.send(o._)
                textbus.forget(o.key, cb)  // But we do want to forget the cb
            })
        })
    },

    serve_client_coffee: function serve_client_coffee () {
        bus.http_serve('/client/:filename', (filename) => {
            filename = /\/client\/(.*)/.exec(filename)[0]
            var source_filename = filename.substr(1)
            var source = bus.read_file(source_filename)
            var compiled = require('coffee-script').compile(source, {filename,
                                                                     bare: true,
                                                                     sourceMap: true})

            var source_map = JSON.parse(compiled.v3SourceMap)
            source_map.sourcesContent = source
            compiled = 'window.dom = window.dom || {}\n' + compiled.js

            function btoa(s) { return new Buffer(s.toString(),'binary').toString('base64') }

            // Base64 encode it
            compiled += '\n'
            compiled += '//# sourceMappingURL=data:application/json;base64,'
            compiled += btoa(JSON.stringify(source_map)) + '\n'
            compiled += '//# sourceURL=' + source_filename
            return compiled
        })
    },

    unix_socket_repl: function (filename) {
        var repl = require('repl')
        var net = require('net')
        var fs = require('fs')
        if (fs.existsSync && fs.existsSync(filename))
            fs.unlinkSync(filename)
        net.createServer(function (socket) {
            var r = repl.start({
                //prompt: '> '
                input: socket
                , output: socket
                , terminal: true
                //, useGlobal: false
            })
            r.on('exit', function () {
                socket.end()
            })
            r.context.socket = socket
        }).listen(filename)
    },

    schema: function schema () {
        function url_tree (cache) {
            // The key tree looks like:
            //
            // {server: {thing: [obj1, obj2], shing: [obj1, obj2], ...}
            //  client: {dong: [obj1, ...]}}
            //
            // And objects without a number, like 'shong' will go on:
            //  key_tree.server.shong[null]
            var tree = {server: {}, client: {}}
            for (key in cache) {
                var p = parse_key(key)
                if (!p) {
                    console.log('The state dash can\'t deal with key', key)
                    return null
                }
                tree[p.owner][p.name] || (tree[p.owner][p.name] = {})
                tree[p.owner][p.name][p.number || null] = cache[key]
            }
            return tree
        }

        function parse_key (key) {
            var word = "([^/]+)"
            // Matching things like: "/new/name/number"
            // or:                   "/name/number"
            // or:                   "/name"
            // or:                   "name/number"
            // or:                   "name"
            // ... and you can optionally include a final slash.
            var regexp = new RegExp("(/)?(new/)?" +word+ "(/" +word+ ")?(/)?")
            var m = key.match(regexp)
            if (!m) return null
            // indices = [0: has_match, 1: server_owned, 2: is_new, 3: name, 5: number]
            var owner = m[1] ? 'server' : 'client'
            return m[0] && {owner:owner, 'new': m[2], name: m[3], number: m[5]}
        }
        schema.parse_key = parse_key
        schema.url_tree = url_tree
        return url_tree(bus.cache)
    }
}

    var bus = require('./statebus')()
    bus.honk = 'statelog'

    // Options
    var default_options = {
        port: 3005,
        backdoor: null,
        client: null,
        file_store: true,
        __secure: false,
        full_node: false
    }
    bus.options = default_options
    options = options || {}
    for (k in (options || {}))
        bus.options[k] = options[k]

    // Add methods to bus object
    for (m in extra_methods)
        bus[m] = extra_methods[m]

    if (options.full_node)
        bus.serve_node()

    // Maybe serve
    else if (options && (options.client || options.port || options.backdoor))
        bus.serve(options)
    return bus
}
module.exports = make_server_bus

// Handy repl. Invoke with node -e 'require("statebus/server").repl("/tmp/foo")'
make_server_bus.repl = function (filename) {
    var net = require('net')
    var sock = net.connect(filename)

    process.stdin.pipe(sock)
    sock.pipe(process.stdout)

    sock.on('connect', function () {
        process.stdin.resume();
        process.stdin.setRawMode(true)
    })

    sock.on('close', function done () {
        process.stdin.setRawMode(false)
        process.stdin.pause()
        sock.removeListener('close', done)
    })

    process.stdin.on('end', function () {
        sock.destroy()
        console.log()
    })

    process.stdin.on('data', function (b) {
        if (b.length === 1 && b[0] === 4) {
            process.stdin.emit('end')
        }
    })
}
