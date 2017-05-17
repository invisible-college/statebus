exports.code = `<script type="statebus">
window.state = bus.sb
name = location.pathname.replace(/^\\/edit\\//, '')
ui.BODY = ->
  console.log('rendering body')
  DIV {},
    WIKI_EDITOR()
    WIKI_HOLSTER()

ui.WIKI_HOLSTER = ->
  code = fetch('/code/' + name)
  code._ or= ''
  matcher = /(^|\\n)(dom|ui).BODY /i
  empty = not code._.match(matcher)
  console.log('compiling yer code', empty, code._.replace(matcher, '\\nui.WIKI_BODY '))
  compiled = statebus.compile_coffee(code._.replace(matcher, '\\nui.WIKI_BODY '))
  console.log(' ...compiled')
  statebus.load_client_code(compiled, true)
  console.log(' ...loaded')
  if not empty
    WIKI_BODY()
  else
    'empty'

ui.WIKI_EDITOR = ->
  editor = fetch('editor')
  code = fetch('/code/' + name)
  if editor.open
    console.log('rendering textarea', JSON.stringify(code._))
    TEXTAREA
      id: 'wiki-editor'
      autoFocus: true
      rows: 20
      cols: 100
      value: code._
      onChange: (e) => code._ = e.target.value; save(code); console.log('changing to', JSON.stringify(e.target.value))
      style:
        position: 'fixed'
        bottom: 0

toggle_editor = (e) ->
  mods = 0
  for k in ['ctrlKey', 'shiftKey', 'altKey']
    if e[k] then mods += 1
  if mods >= 2 and e.keyCode == 32
    console.log('toggling editor')
    e.stopPropagation()
    editor = fetch('editor')
    editor.open = not editor.open
    save(editor)
    if editor.open
      setTimeout((-> document.getElementById('wiki-editor').focus()), 10)

save({key: 'editor', open: true})
document.addEventListener('keydown', toggle_editor, false)
#</script><script src="https://stateb.us/client6.js"></script>`