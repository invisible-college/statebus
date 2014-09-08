for el of React.DOM
  this[el.toUpperCase()] = React.DOM[el]

window.parse_key = (key) ->
  word = "([^/]+)"
  # Matching things like: "/new/name/number"
  # or:                   "/name/number"
  # or:                   "/name"
  # or:                   "name/number"
  # or:                   "name"
  # ... and you can optionally include a final slash.
  regexp = new RegExp("(/)?(new/)?#{word}(/#{word})?(/)?")
  m = key.match(regexp)
  if not m
    return null

  [has_match, server_owned, is_new, name, tmp1, number, tmp2] = m
  owner = if server_owned then 'server' else 'client'
  return has_match and {owner, 'new': is_new, name, number}

window.StateDash = ReactiveComponent
  displayName: 'State Dash'
  render: ->
    dash = @fetch('state_dash')
    
    if dash.filter?.match(/idfa/) or dash.filter?.match(/idmap/)
      dash.on = false
      dash.filter = ''
      save(dash)

    if not dash.on
      return DIV null, ''

    url_tree = (cache) ->
      # The key tree looks like:
      #
      # {server: {thing: [obj1, obj2], shing: [obj1, obj2], ...}
      #  client: {dong: [obj1, ...]}}
      #
      # And objects without a number, like '/shong' will go on:
      #  key_tree.server.shong[null]
      tree = {server: {}, client: {}}
      
      add_key = (key) ->
        p = parse_key(key)
        if not p
          console.log('The state dash can\'t deal with key', key); return null

        tree[p.owner][p.name] ||= []
        tree[p.owner][p.name][p.number or null] = cache[key]

      for key of cache
        add_key(key)
      return tree

    cache = @search_results().data_matches
    tree = url_tree(cache)
    first_key = do () ->
      for key of cache
        reject_name = dash.selected.name and parse_key(key).name != dash.selected.name
        reject_numb = dash.selected.number and parse_key(key).number != dash.selected.number
        if !reject_name and !reject_numb
          return key
      return null

    DIV className: 'state_dash',
      STYLE null,
        """
        .state_dash {
          position: absolute;
          margin: 20px;
          z-index: 10000;
          max-width: 100%;
        }
        .state_dash .left, .state_dash .right, .state_dash .top {
          background-color: #eee;
          overflow-wrap: break-word;
          padding: 10px;
          vertical-align: top;
        }
        .state_dash .left  { min-width:   40px; display: inline-block; }
        .state_dash .right { margin-left: 30px; display: inline-block; max-width: 70%; }
        .state_dash .top   { max-width:   100%; margin: 20px 0; }
        """

      # Render the top (name) menu
      DIV className: 'left', #onMouseLeave: reset_selection,
        INPUT (className: 'search', onChange: @filter_to, onMouseEnter: reset_selection)
        for owner in ['client', 'server']
          prefix = (owner == 'server') and '/' or ''
          DIV {key: owner},
            for name of tree[owner]
              do (owner, name) ->
                f = -> dash.selected={owner, name, number:null}; save(dash)
                style = (name == dash.selected.name) and {'background-color':'#aaf'} or {}
                DIV onMouseEnter: f, key: name, style: style,
                  prefix + name

      # Render the object
      DIV className: 'right',
        JSON.stringify(arest.cache[first_key])

  # Other methods
  componentDidMount: ->
    console.log('focused it')
  search_results: () ->
    # Returns two filtered views of the cache:
    # 
    #   { key_matches: {...a cache filtered to matching keys... }
    #     data_matches: {...a cache filtered to matching data...} }

    dash = fetch('state_dash')
    key_matches = {}
    data_matches = {}
    if dash.filter
      for key of arest.cache
        if key.match(dash.filter)
          key_matches[key] = arest.cache[key]
        if JSON.stringify(arest.cache[key]).match(dash.filter)
          data_matches[key] = arest.cache[key]
    else
      key_matches = data_matches = arest.cache

    return {key_matches, data_matches}
  filter_to: (e) ->
    dash = @data('state_dash')
    dash.filter = e.target.value
    if dash.filter.length == 0
      dash.filter = null
    save(dash)
    true
reset_selection = () ->
  dash = fetch('state_dash')
  dash.selected = {owner: null, name: null, number: null}
  save(dash)

fetch 'state_dash',
  on: false
  selected: {owner: null, name: null, number: null}
  filter: null

recent_keys = [0,0,0,0,0]
document.onkeypress = (e) ->
  key = (e and e.keyCode) or event.keyCode
  recent_keys.push(key)
  recent_keys = recent_keys.slice(1)
  if key==4 or "#{recent_keys}" == "#{[105, 100, 109, 97, 112]}" \   # idmap
            or "#{recent_keys.slice(1)}" == "#{[105, 100, 102, 97]}" # idfa
    dash = fetch('state_dash')
    if dash.on
      dash.on = false
    else
      dash.on = true
    save(dash)
    setTimeout(->$('.state_dash input').focus())
