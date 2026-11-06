' KD Designer link - a script plugin for BrightAuthor:connected presentations.
'
' Add it under Presentation Settings > Support Content > Script Plugins, with the plugin name
' "kdlink" (exactly that: the start-up function below is kdlink_Initialize), and publish.
' Nothing else in the presentation changes: the player keeps running its own show, with or
' without a controller. The plugin only watches, and acts when the controller asks it to.
'
' The controller sends "kd hello" to UDP port 5010 on the player (a user variable "kdPort"
' changes the port). The plugin answers to whoever said hello and from then on sends every change
' at once (checked 4x a second); it goes quiet 10 minutes after the last hello.
' Your presentation's own UDP input (port 5000) is not touched.
'
' From the controller (fields separated by a tab):
'   kd hello                          report everything again
'   kd test <zone> <state>            play the media file of that state in the zone (for testing: the
'                                     presentation carries on by itself when the file ends)
'   kd play <zone> <file>             play a file in a zone directly
'   kd stop <zone>                    stop the video/audio of a zone
'   kd event <text>                   a Plugin Message (plugin kdlink) to the presentation
'   kd var <name> <value>             set a user variable (User Variable events in the presentation fire)
'   kd reboot                         restart the player (the show starts again from the beginning)
' To the controller: one JSON object per UDP packet:
'   {"kd":"hello","v":2,"zones":3,"vars":4,"model":"XT1144","gpio":true,"serial":false}
'   {"kd":"zone","i":1,"name":"Video","state":"Intro","file":"intro.mp4"}
'   {"kd":"state","z":1,"name":"Video 1","file":"video1.mp4"}       every state of every zone (after hello)
'   {"kd":"var","name":"mode","value":"day"}
'   {"kd":"gpio","bits":5}            the GPIO inputs, bit n = GPIO n (models with a GPIO port)
'   {"kd":"log","src":"serial","text":"..."}   what the player receives: serial lines, UDP, buttons
'   {"kd":"msg","text":"..."}         a Send Plugin Message (plugin kdlink) from the presentation;
'                                     "zone <zone> <text>" sets what that zone shows as playing instead
'   {"kd":"reply","ok":true,"text":"..."}
'
' Everything the plugin reads from the presentation (zones, states, players) belongs to the
' player's autorun and differs between versions, so every object is type-checked before use:
' an error here would stop the presentation.

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
  k.testFrom = {}       ' zone name (lower case) -> the state the zone was in when a test file started
  k.gpioSeen = -1
  k.logCount = 0        ' log lines this tick (a chatty serial device mustn't flood the network)
  k.clock = CreateObject("roTimespan")
  k.clock.Mark()
  k.ProcessEvent = kdlink_ProcessEvent

  k.port = 5010
  p = kdlink_varValue(userVariables, "kdPort")
  if p <> "" and Val(p) > 0 then k.port = Int(Val(p))

  k.sock = CreateObject("roDatagramSocket")
  k.sock.SetPort(msgPort)
  if not k.sock.BindToLocalPort(k.port) then kdlink_debug(k, "kdlink: can't open UDP port " + Str(k.port))

  ' Our own view of the GPIO port (invalid on models without one); its events are ours only,
  ' the presentation's own GPIO events reach it as before.
  k.gpio = CreateObject("roControlPort", "BrightSign")
  if type(k.gpio) = "roControlPort" then k.gpio.SetPort(msgPort) else k.gpio = invalid

  ' Serial: the plugin sees the lines the presentation receives. If the presentation doesn't use
  ' the serial port, a user variable "kdSerial" (baud rate, e.g. 9600) makes the plugin open port 0.
  k.serial = invalid
  baud = kdlink_varValue(userVariables, "kdSerial")
  if baud <> "" and Val(baud) > 0 then
    s = CreateObject("roSerialPort", 0, Int(Val(baud)))
    if type(s) = "roSerialPort" then
      s.SetLineEventPort(msgPort)
      k.serial = s
    end if
  end if

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
    if Left(text, 3) = "kd " or Left(text, 3) = "kd" + Chr(9) then
      kdlink_command(m, text, event.GetSourceHost(), event.GetSourcePort())
      return true
    end if
    kdlink_log(m, "udp", "from " + event.GetSourceHost() + ": " + text)
    return false
  else if t = "roTimerEvent" then
    if event.GetSourceIdentity() <> m.timer.GetIdentity() then return false
    kdlink_tick(m)
    m.timer.Start()
    return true
  else if t = "roStreamLineEvent" then
    kdlink_log(m, "serial", event.GetString())
    return m.serial <> invalid and event.GetSourceIdentity() = m.serial.GetIdentity()
  else if t = "roControlDown" or t = "roControlUp" then
    if m.gpio = invalid then
      kdlink_log(m, "gpio", "input " + Str(event.GetInt()).Trim() + kdlink_iif(t = "roControlDown", " on", " off"))
      return false
    end if
    if event.GetSourceIdentity() <> m.gpio.GetIdentity() then return false
    kdlink_log(m, "gpio", "input " + Str(event.GetInt()).Trim() + kdlink_iif(t = "roControlDown", " on", " off"))
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
    m.gpioSeen = -1
    zones = kdlink_zones(m)
    nVars = 0
    if type(m.userVariables) = "roAssociativeArray" then nVars = m.userVariables.Count()
    model = ""
    di = CreateObject("roDeviceInfo")
    if type(di) = "roDeviceInfo" then model = di.GetModel()
    kdlink_queue(m, {kd: "hello", v: 2, zones: zones.Count(), vars: nVars, model: model, gpio: m.gpio <> invalid, serial: m.serial <> invalid})
    kdlink_states(m)
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
  else if cmd = "reboot" then
    kdlink_reply(m, true, "rebooting")
    RebootSystem()
  else if (cmd = "play" and f.Count() >= 4) or (cmd = "test" and f.Count() >= 4) or (cmd = "stop" and f.Count() >= 3) then
    z = kdlink_findZone(m, f[2])
    if z = invalid then
      kdlink_reply(m, false, "no zone '" + f[2] + "'")
    else if cmd = "stop" then
      if type(z.videoPlayer) = "roVideoPlayer" then z.videoPlayer.Stop()
      if type(z.audioPlayer) = "roAudioPlayer" then z.audioPlayer.Stop()
      kdlink_reply(m, true, "stop " + f[2])
    else
      file = f[3]
      label = file
      if cmd = "test" then
        s = kdlink_findState(z, f[3])
        file = ""
        if s <> invalid then file = kdlink_fileOf(s)
        if file = "" then
          kdlink_reply(m, false, "state '" + f[3] + "' in zone '" + f[2] + "' has no media file to play")
          return
        end if
        label = f[3] + " (" + file + ")"
      end if
      if kdlink_play(m, z, file) then
        lname = LCase(kdlink_zoneName(z, 0))
        m.zoneSays[lname] = "(test) " + label
        real = ""
        if type(z.activeState) = "roAssociativeArray" then real = kdlink_str(z.activeState.id$)
        if real = "" and type(z.activeState) = "roAssociativeArray" then real = kdlink_str(z.activeState.name$)
        m.testFrom[lname] = real
        kdlink_reply(m, true, "play " + label + " in " + f[2])
      else
        kdlink_reply(m, false, "zone '" + f[2] + "' can't play '" + file + "' directly")
      end if
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
  m.logCount = 0
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
  if m.gpio <> invalid then
    bits = m.gpio.GetWholeState()
    if bits <> m.gpioSeen then
      m.gpioSeen = bits
      kdlink_queue(m, {kd: "gpio", bits: bits})
    end if
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
  if m.outbox.Count() < 200 then
    j = FormatJson(o)
    if j <> invalid and j <> "" then m.outbox.Push(j)
  end if
End Sub

' What the player received, for the controller's Activity list (at most 8 lines per tick).
Sub kdlink_log(m As Object, src As String, text As String)
  if m.peers.Count() = 0 or m.logCount >= 8 then return
  m.logCount = m.logCount + 1
  kdlink_queue(m, {kd: "log", src: src, text: Left(text, 200)})
End Sub

Sub kdlink_reply(m As Object, ok As Boolean, text As String)
  kdlink_queue(m, {kd: "reply", ok: ok, text: Left(text, 300)})
  kdlink_tick(m)
End Sub

Function kdlink_zoneList(m As Object) As Dynamic
  if type(m.bsp) = "roAssociativeArray" and type(m.bsp.sign) = "roAssociativeArray" then return m.bsp.sign.zonesHSM
  return invalid
End Function

' The zones of the presentation with their state and file. A zone whose state can't be read shows
' what "zone <zone> <text>" plugin messages last said; a test play shows until the zone moves on.
Function kdlink_zones(m As Object) As Object
  out = []
  list = kdlink_zoneList(m)
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
      lname = LCase(name)
      said = m.zoneSays[lname]
      ' A test play shows until the zone moves on to another state by itself.
      if said <> invalid and Left(said, 7) = "(test) " and m.testFrom[lname] <> invalid then
        if kdlink_str(m.testFrom[lname]) <> state then
          m.zoneSays.Delete(lname)
          m.testFrom.Delete(lname)
          said = invalid
        end if
      end if
      if said <> invalid and (state = "" or Left(said, 7) = "(test) ") then state = said
      out.Push({name: Left(name, 100), state: Left(state, 150), file: Left(file, 150)})
    end if
  end for
  return out
End Function

' Every state of every zone with its media file, so the controller can offer a test button for each.
Sub kdlink_states(m As Object)
  list = kdlink_zoneList(m)
  if list = invalid then return
  n = 0
  sent = 0
  for each z in list
    if type(z) = "roAssociativeArray" then
      n = n + 1
      table = z.stateTable
      if type(table) = "roAssociativeArray" then
        for each key in table
          s = table[key]
          if type(s) = "roAssociativeArray" and sent < 80 then
            name = kdlink_str(s.id$)
            if name = "" then name = key
            kdlink_queue(m, {kd: "state", z: n, name: Left(name, 100), file: Left(kdlink_fileOf(s), 150)})
            sent = sent + 1
          end if
        end for
      end if
    end if
  end for
End Sub

Function kdlink_findState(z As Object, ref As String) As Dynamic
  table = z.stateTable
  if type(table) <> "roAssociativeArray" then return invalid
  for each key in table
    s = table[key]
    if type(s) = "roAssociativeArray" then
      if LCase(key) = LCase(ref) or LCase(kdlink_str(s.id$)) = LCase(ref) then return s
    end if
  end for
  return invalid
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
  list = kdlink_zoneList(m)
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

' Where a file of the presentation is on the card: published media live in the asset pool under
' hashed names, which the autorun's roAssetPoolFiles knows.
Function kdlink_path(m As Object, file As String) As String
  if Instr(1, file, ":") > 0 then return file
  if type(m.bsp) = "roAssociativeArray" and type(m.bsp.assetPoolFiles) = "roAssetPoolFiles" then
    p = m.bsp.assetPoolFiles.GetPoolFilePath(file)
    if kdlink_str(p) <> "" then return p
  end if
  return "SD:/" + file
End Function

' Plays a file in a zone with the zone's own player object.
Function kdlink_play(m As Object, z As Object, file As String) As Boolean
  path = kdlink_path(m, file)
  ext = LCase(Right(file, 4))
  if ext = ".jpg" or ext = ".png" or ext = "jpeg" or ext = ".bmp" then
    if type(z.imagePlayer) = "roImagePlayer" then return z.imagePlayer.DisplayFile(path)
    return false
  end if
  if ext = ".mp3" or ext = ".wav" or ext = ".aac" or ext = ".m4a" or ext = "flac" then
    if type(z.audioPlayer) = "roAudioPlayer" then return z.audioPlayer.PlayFile(path)
  end if
  if type(z.videoPlayer) = "roVideoPlayer" then return z.videoPlayer.PlayFile(path)
  if type(z.audioPlayer) = "roAudioPlayer" then return z.audioPlayer.PlayFile(path)
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

Function kdlink_iif(c As Boolean, a As String, b As String) As String
  if c then return a
  return b
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
