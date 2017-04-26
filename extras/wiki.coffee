<script type="statebus">
name = location.pathname.replace(/^\/edit\//, '')
ui.BODY = ->
  code = fetch('/code/' + name)._ or ''
  empty = not code.match(/^(dom|UI).BODY /i)
  compiled = statebus.compile_coffee(code.replace(/^(dom|ui).BODY /i, 'ui.WIKI_BODY '))
  statebus.load_client_code(compiled, true)

  EDITABLE_BODY
    code_key: '/code/' + name
    if not empty
      WIKI_BODY()
    else
      'empty'

ui.EDITABLE_BODY = ->
  code = fetch('/code/' + name)
  editor = fetch('editor')
  DIV {},
    if editor.open
      TEXTAREA
        rows: 20
        cols: 100
        value: code._ or ''
        onChange: (e) -> code._ = e.target.value; save(code)
    DIV @props.children

save({key: 'editor', open: true})

document.addEventListener('keydown', (e) ->
  if (e.ctrlKey or e.altKey or e.shiftKey) and e.keyCode == 32
    e = fetch('editor')
    e.open = not e.open
    save(e)
, false)
#</script><script src="/client.js"></script>