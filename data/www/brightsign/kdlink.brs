' KD Designer link - a script plugin for BrightAuthor:connected presentations.
'
' Add it under Presentation Settings > Support Content > Script Plugins, with the plugin name
' "kdlink" (exactly that: the start-up function below is kdlink_Initialize), and publish.
'
' The controller sends "kd hello" to UDP port 5010 on the player (a user variable "kdPort"
' changes the port). The plugin answers to whoever said hello with the zones, what each zone is
' playing and the user variables, and from then on sends every change at once (checked 4x a second).
' Your presentation's own UDP input (port 5000) is not touched.
'
' From the controller (fields separated by a tab):
'   kd hello                          report everything again
'   kd event <text>                   a Plugin Message (plugin kdlink) to the presentation: use it as the
'                                     event of a transition, so any zone can go to any state
'   kd var <name> <value>             set a user variable (User Variable events in the presentation fire)
'   kd play <zone> <file>             play a file in a zone directly (outside the presentation's states)
'   kd stop <zone>                    stop the video/audio of a zone
' To the controller: one JSON object per UDP packet:
'   {"kd":"hello","v":1,"zones":3,"vars":4}
'   {"kd":"zone","i":1,"name":"Video","state":"Intro","file":"intro.mp4"}
'   {"kd":"var","name":"mode","value":"day"}
'   {"kd":"msg","text":"..."}         a Send Plugin Message (plugin kdlink) from the presentation;
'                                     "zone <zone> <text>" sets what that zone shows as playing instead
'   {"kd":"reply","ok":true,"text":"..."}

Function kdlink_Initialize(msgPort As Object, userVariables As Object, bsp As Object) As Object
  k = {}
  k.objectName = "kdlink_object"
  k.msgPort = msgPort
  k.userVariables = userVariables
  k.bsp = bsp
  k.peers = {}          ' "host:port" -> {host, port, at}
  k.outbox = []         ' JSON texts still to send (a few per tick, so a big snapshot doesn't flood)
  k.zoneSeen = {}       ' zone index -> "state|file" last sent
  k.varSeen = {}        ' variable name -> value last sent
  k.zoneSays = {}       ' zone name (lower case) -> text set by "zone <zone> <text>" plugin messages
  k.clock = CreateObject("roTimespan")
  k.clock.Mark()
  k.ProcessEvent = kdlink_ProcessEvent

  k.port = 5010
  p = kdlink_varValue(userVariables, "kdPort")
  if p <> "" and Val(p) > 0 then k.port = Int(Val(p))

  k.sock = CreateObject("roDatagramSocket")
  k.sock.SetPort(msgPort)
  if not k.sock.BindToLocalPort(k.port) then kdlink_debug(k, "kdlink: can't open UDP port " + Str(k.port))

  k.timer = CreateObject("roTimer")
  k.timer.SetPort(msgPort)
  k.timer.SetElapsed(0, 250)
  k.timer.Start()
  kdlink_debug(k, "kdlink: listening on UDP port " + Str(k.port))
  return k
End Function

' True = the event was ours, the presentation doesn't see it.
Function kdlink_ProcessEvent(event As Object) As Boolean
  t = type(event)
  if t = "roDatagramEvent" then
    text = event.GetString()
    if Left(text, 3) <> "kd " and Left(text, 3) <> "kd" + Chr(9) then return false
    kdlink_command(m, text, event.GetSourceHost(), event.GetSourcePort())
    return true
  else if t = "roTimerEvent" then
    if event.GetSourceIdentity() <> m.timer.GetIdentity() then return false
    kdlink_tick(m)
    m.timer.Start()
    return true
  else if t = "roAssociativeArray" then
    if kdlink_str(event["EventType"]) = "SEND_PLUGIN_MESSAGE" and LCase(kdlink_str(event["PluginName"])) = "kdlink" then
      kdlink_pluginMessage(m, kdlink_str(event["PluginMessage"]))
      return true
    end if
  end if
  return false
End Function

Sub kdlink_command(m As Object, text As String, host As String, port As Integer)
  f = kdlink_fields(text)
  if f.Count() < 2 then return
  cmd = LCase(f[1])
  key = host + ":" + Str(port).Trim()
  isNew = not m.peers.DoesExist(key)
  m.peers[key] = {host: host, port: port, at: m.clock.TotalSeconds()}
  if cmd = "hello" then
    ' A hello (re)sends everything: the controller may just have restarted.
    m.zoneSeen = {}
    m.varSeen = {}
    zones = kdlink_zones(m)
    nVars = 0
    if type(m.userVariables) = "roAssociativeArray" then nVars = m.userVariables.Count()
    kdlink_queue(m, {kd: "hello", v: 1, zones: zones.Count(), vars: nVars})
    kdlink_tick(m)
    return
  end if
  if cmd = "event" and f.Count() >= 3 then
    msg = {}
    msg["EventType"] = "EVENT_PLUGIN_MESSAGE"
    msg["PluginName"] = "kdlink"
    msg["PluginMessage"] = f[2]
    m.msgPort.PostMessage(msg)
    kdlink_reply(m, true, "event " + f[2])
  else if cmd = "var" and f.Count() >= 4 then
    uv = invalid
    if type(m.userVariables) = "roAssociativeArray" then uv = m.userVariables.Lookup(f[2])
    if uv = invalid then
      kdlink_reply(m, false, "no user variable '" + f[2] + "'")
    else if type(uv) = "roAssociativeArray" and uv.DoesExist("SetCurrentValue") then
      uv.SetCurrentValue(f[3], true)   ' true: the presentation gets a "user variables updated" event
      kdlink_reply(m, true, f[2] + " = " + f[3])
    else
      kdlink_reply(m, false, "can't set '" + f[2] + "' on this player")
    end if
  else if (cmd = "play" and f.Count() >= 4) or (cmd = "stop" and f.Count() >= 3) then
    z = kdlink_findZone(m, f[2])
    if z = invalid then
      kdlink_reply(m, false, "no zone '" + f[2] + "'")
    else if cmd = "play" then
      if kdlink_play(z, f[3]) then
        m.zoneSays[LCase(kdlink_zoneName(z, 0))] = "(direct) " + f[3]
        kdlink_reply(m, true, "play " + f[3] + " in " + f[2])
      else
        kdlink_reply(m, false, "zone '" + f[2] + "' can't play '" + f[3] + "' directly")
      end if
    else
      if z.videoPlayer <> invalid then z.videoPlayer.Stop()
      if z.audioPlayer <> invalid then z.audioPlayer.Stop()
      kdlink_reply(m, true, "stop " + f[2])
    end if
  else if isNew then
    kdlink_reply(m, false, "unknown: " + text)
  end if
End Sub

' A Send Plugin Message (plugin kdlink) in the presentation: "zone <zone> <text>" says what that zone
' plays (for players where the plugin can't see the zone's state), anything else goes to the controller.
Sub kdlink_pluginMessage(m As Object, text As String)
  if LCase(Left(text, 5)) = "zone " then
    rest = Mid(text, 6)
    sp = Instr(1, rest, " ")
    if sp > 1 then
      m.zoneSays[LCase(Left(rest, sp - 1))] = Mid(rest, sp + 1)
      return
    end if
  end if
  kdlink_queue(m, {kd: "msg", text: Left(text, 300)})
End Sub

' Every 250 ms: drop controllers that stopped saying hello, send what changed, send a few queued packets.
Sub kdlink_tick(m As Object)
  now = m.clock.TotalSeconds()
  for each key in m.peers.Keys()
    if now - m.peers[key].at > 600 then m.peers.Delete(key)
  end for
  if m.peers.Count() = 0 then
    m.outbox = []
    return
  end if
  zones = kdlink_zones(m)
  for i = 0 to zones.Count() - 1
    z = zones[i]
    sig = z.state + "|" + z.file
    k = Str(i + 1).Trim()
    if kdlink_str(m.zoneSeen[k]) <> sig or m.zoneSeen[k] = invalid then
      m.zoneSeen[k] = sig
      kdlink_queue(m, {kd: "zone", i: i + 1, name: z.name, state: z.state, file: z.file})
    end if
  end for
  if type(m.userVariables) = "roAssociativeArray" then
    for each name in m.userVariables
      uv = m.userVariables[name]
      shown = name
      if type(uv) = "roAssociativeArray" and kdlink_str(uv.name$) <> "" then shown = uv.name$
      v = kdlink_varValue(m.userVariables, name)
      if m.varSeen[name] = invalid or kdlink_str(m.varSeen[name]) <> v then
        m.varSeen[name] = v
        kdlink_queue(m, {kd: "var", name: shown, value: Left(v, 300)})
      end if
    end for
  end if
  sent = 0
  while m.outbox.Count() > 0 and sent < 12
    text = m.outbox.Shift()
    for each key in m.peers
      p = m.peers[key]
      m.sock.SendTo(p.host, p.port, text)
    end for
    sent = sent + 1
  end while
End Sub

Sub kdlink_queue(m As Object, o As Object)
  if m.outbox.Count() < 200 then m.outbox.Push(FormatJson(o))
End Sub

Sub kdlink_reply(m As Object, ok As Boolean, text As String)
  kdlink_queue(m, {kd: "reply", ok: ok, text: Left(text, 300)})
  kdlink_tick(m)
End Sub

' The zones of the presentation with their state and file. The zone objects belong to the player's
' autorun and differ between versions, so every field is looked for carefully; a zone whose state
' can't be read shows what "zone <zone> <text>" plugin messages last said.
Function kdlink_zones(m As Object) As Object
  out = []
  list = invalid
  if type(m.bsp) = "roAssociativeArray" and type(m.bsp.sign) = "roAssociativeArray" then list = m.bsp.sign.zonesHSM
  if list = invalid then return out
  for each z in list
    if type(z) = "roAssociativeArray" then
      name = kdlink_zoneName(z, out.Count() + 1)
      state = ""
      file = ""
      s = z.activeState
      if type(s) = "roAssociativeArray" then
        state = kdlink_str(s.id$)
        if state = "" then state = kdlink_str(s.name$)
        file = kdlink_fileOf(s)
      end if
      said = m.zoneSays[LCase(name)]
      if said <> invalid and (state = "" or Left(said, 9) = "(direct) ") then state = said
      out.Push({name: Left(name, 100), state: Left(state, 150), file: Left(file, 150)})
    end if
  end for
  return out
End Function

Function kdlink_zoneName(z As Object, n As Integer) As String
  name = kdlink_str(z.name$)
  if name = "" then name = kdlink_str(z.id$)
  if name = "" then name = "Zone " + Str(n).Trim()
  return name
End Function

Function kdlink_fileOf(s As Object) As String
  for each k in ["videoItem", "audioItem", "imageItem", "mediaItem"]
    it = s[k]
    if type(it) = "roAssociativeArray" then
      f = kdlink_str(it.fileName$)
      if f = "" then f = kdlink_str(it.filename$)
      if f <> "" then return f
    end if
  end for
  return ""
End Function

Function kdlink_findZone(m As Object, ref As String) As Dynamic
  list = invalid
  if type(m.bsp) = "roAssociativeArray" and type(m.bsp.sign) = "roAssociativeArray" then list = m.bsp.sign.zonesHSM
  if list = invalid then return invalid
  n = 0
  for each z in list
    if type(z) = "roAssociativeArray" then
      n = n + 1
      if LCase(kdlink_zoneName(z, n)) = LCase(ref) or Str(n).Trim() = ref then return z
    end if
  end for
  return invalid
End Function

' Plays a file from the card in a zone with the zone's own player object.
Function kdlink_play(z As Object, file As String) As Boolean
  path = file
  if Instr(1, path, ":") = 0 then path = "SD:/" + file
  ext = LCase(Right(file, 4))
  if ext = ".jpg" or ext = ".png" or ext = "jpeg" or ext = ".bmp" then
    if z.imagePlayer <> invalid then return z.imagePlayer.DisplayFile(path)
    return false
  end if
  if ext = ".mp3" or ext = ".wav" or ext = ".aac" or ext = ".m4a" or ext = "flac" then
    if z.audioPlayer <> invalid then return z.audioPlayer.PlayFile(path)
  end if
  if z.videoPlayer <> invalid then return z.videoPlayer.PlayFile(path)
  if z.audioPlayer <> invalid then return z.audioPlayer.PlayFile(path)
  return false
End Function

Function kdlink_varValue(vars As Object, name As String) As String
  if type(vars) <> "roAssociativeArray" then return ""
  uv = vars.Lookup(name)
  if type(uv) = "roAssociativeArray" and uv.DoesExist("GetCurrentValue") then return kdlink_str(uv.GetCurrentValue())
  return kdlink_str(uv)
End Function

' Splits "kd<tab>var<tab>name<tab>value" (or with spaces when there are no tabs).
Function kdlink_fields(text As String) As Object
  sep = Chr(9)
  if Instr(1, text, sep) = 0 then sep = " "
  out = []
  at = 1
  while true
    p = Instr(at, text, sep)
    if p = 0 or (sep = " " and out.Count() >= 3) then
      out.Push(Mid(text, at))
      exit while
    end if
    out.Push(Mid(text, at, p - at))
    at = p + 1
  end while
  return out
End Function

Function kdlink_str(x As Dynamic) As String
  t = type(x)
  if t = "String" or t = "roString" then return x
  if t = "Integer" or t = "roInt" or t = "roInteger" or t = "LongInteger" then return Str(x).Trim()
  if t = "Float" or t = "roFloat" or t = "Double" or t = "roDouble" then return Str(x).Trim()
  if t = "Boolean" or t = "roBoolean" then
    if x then return "true"
    return "false"
  end if
  return ""
End Function

Sub kdlink_debug(m As Object, text As String)
  print text
  if type(m.bsp) = "roAssociativeArray" and type(m.bsp.diagnostics) = "roAssociativeArray" then m.bsp.diagnostics.PrintDebug(text)
End Sub
