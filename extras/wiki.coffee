exports.code = `<script type="statebus">
name = location.pathname.replace(/^\\/edit\\//, '')
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
        id: 'wiki-editor'
        autoFocus: true
        rows: 20
        cols: 100
        value: code._ or ''
        onChange: (e) -> code._ = e.target.value; save(code)
        onKeyPress: toggle_editor
        style:
          position: 'fixed'
          bottom: 0
    DIV @props.children

save({key: 'editor', open: true})

toggle_editor = (e) ->
  mods = 0
  for k in ['ctrlKey', 'shiftKey', 'altKey']
    if e[k] then mods += 1
  if mods >= 2 and e.keyCode == 32
    e.stopPropagation()
    editor = fetch('editor')
    editor.open = not editor.open
    save(editor)
    if editor.open
      setTimeout((-> document.getElementById('wiki-editor').focus()), 10)

document.addEventListener('keydown', toggle_editor, false)
#</script><script src="https://stateb.us/client6.js"></script>`