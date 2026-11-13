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
'   kd play <zone> <file|state>       play a file (or the file of a state, by its name) in a zone directly, once;
'                                     a picture stays until the next play. When a video / audio file has ended
'                                     and no new play comes within 2 s, the zone's own state starts again ("ended" follows when it is done)
'   kd stop <zone>                    stop the video/audio of a zone
'   kd seek <zone> <ms>               jump to a position in the zone's video
'   kd pause <zone> / kd resume <zone>   hold the zone's video / carry on
'   kd sync <zone> <file|state> <ms> play|pause   the zone follows a timeline of the controller (see kdlink_sync)
'   kd release <zone>                 the zone goes back to its own state of the presentation
'   kd event <text>                   a Plugin Message (plugin kdlink) to the presentation
'   kd var <name> <value>             set a user variable (User Variable events in the presentation fire)
'   kd probe                          for fault-finding: each zone's video position, length and the last player events
'   kd reboot                         restart the player (the show starts again from the beginning)
' To the controller: one JSON object per UDP packet:
'   {"kd":"hello","v":12,"zones":3,"vars":4,"model":"XT1144","gpio":true,"serial":false}
'   {"kd":"zone","i":1,"name":"Video","state":"Intro","file":"intro.mp4"}
'   {"kd":"state","z":1,"name":"Video 1","file":"video1.mp4","ms":83400}   every state of every zone (after hello);
'                                     ms = the video / audio file's length (v12; 0 = unknown, none for pictures)
'   {"kd":"var","name":"mode","value":"day"}
'   {"kd":"ended","i":1,"name":"Video","file":"intro.mp4","state":"Intro"}   a zone's video / audio file played to its end
'                                     (a looping video: each time it starts again)
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
  k.playFile = {}       ' zone name (lower case) -> the file a "kd play" / "kd test" started there
  k.wasTest = {}        ' zone name (lower case) -> "test": that file was a "kd test" (the zone goes back to its own file after it)
  k.resume = {}         ' zone name (lower case) -> {state, at}: at tick "at" a test file ended, restart the state's own file if the zone stays in it
  k.loopSeen = {}       ' zone name (lower case) -> {key, count, ms}: where a zone's video was at the last tick
  ' Reading a video's position needs BrightSignOS 8 or newer (asking an older one would stop the presentation).
  k.canPoll = false
  di = CreateObject("roDeviceInfo")
  if type(di) = "roDeviceInfo" then k.canPoll = Val(Left(kdlink_str(di.GetVersion()), 2)) >= 8
  k.durs = {}           ' file name (lower case) -> its length in ms, read once with ProbeFile (0 = unknown)
  k.durNote = ""        ' what ProbeFile said about the last file, for "kd probe"
  k.sync = {}           ' zone name (lower case) -> {file, ms, tick, paused, seen}: a zone that follows a controller timeline
  k.tickNo = 0          ' timer ticks (250 ms each) since the start: the plugin's clock for short waits
  k.playAt = {}         ' zone name (lower case) -> tickNo when a "kd play" / "kd test" started there
  k.evLog = []          ' the last video / audio events as "<second>:<code>", for "kd probe"
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
    m.tickNo = m.tickNo + 1
    kdlink_tick(m)
    m.timer.Start()
    return true
  else if t = "roVideoEvent" or t = "roAudioEvent" then
    ' 8 = the file played to its end. The presentation still gets the event (its own transitions).
    m.evLog.Push(Str(m.clock.TotalSeconds()).Trim() + ":" + Str(event.GetInt()).Trim())
    if m.evLog.Count() > 12 then m.evLog.Shift()
    if event.GetInt() = 8 then kdlink_ended(m, event)
    return false
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
    nVars = kdlink_count(m.userVariables)
    model = ""
    di = CreateObject("roDeviceInfo")
    if type(di) = "roDeviceInfo" then model = di.GetModel()
    kdlink_queue(m, {kd: "hello", v: 12, zones: zones.Count(), vars: nVars, model: model, gpio: m.gpio <> invalid, serial: m.serial <> invalid})
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
  else if cmd = "sync" and f.Count() >= 6 then
    kdlink_sync(m, f[2], f[3], Int(Val(f[4])), LCase(f[5]) = "pause")
  else if (cmd = "seek" and f.Count() >= 4) or ((cmd = "pause" or cmd = "resume" or cmd = "release") and f.Count() >= 3) then
    z = kdlink_findZone(m, f[2])
    if z = invalid then
      kdlink_reply(m, false, "no zone '" + f[2] + "'")
    else if cmd = "release" then
      kdlink_release(m, z)
      kdlink_reply(m, true, "release " + f[2])
    else if type(z.videoPlayer) <> "roVideoPlayer" then
      kdlink_reply(m, false, "zone '" + f[2] + "' has no video to " + cmd)
    else if cmd = "seek" then
      ms = Int(Val(f[3]))
      if ms < 0 then ms = 0
      z.videoPlayer.Seek(ms)
      m.loopSeen.Delete(LCase(kdlink_zoneName(z, 0)))
      kdlink_reply(m, true, "seek " + f[2] + " " + Str(ms / 1000).Trim() + " s")
    else if cmd = "pause" then
      z.videoPlayer.Pause()
      kdlink_reply(m, true, "pause " + f[2])
    else
      z.videoPlayer.Resume()
      kdlink_reply(m, true, "resume " + f[2])
    end if
  else if cmd = "probe" then
    kdlink_probe(m)
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
      m.playFile.Delete(LCase(kdlink_zoneName(z, 0)))
      m.resume.Delete(LCase(kdlink_zoneName(z, 0)))
      m.sync.Delete(LCase(kdlink_zoneName(z, 0)))
      kdlink_reply(m, true, "stop " + f[2])
    else
      file = f[3]
      label = file
      ' "play" also takes the name of a state (the name given in BrightAuthor): its file is played.
      if cmd = "play" then
        s = kdlink_findState(z, f[3])
        if s <> invalid then
          if kdlink_fileOf(s) <> "" then
            file = kdlink_fileOf(s)
            if LCase(file) <> LCase(f[3]) then label = f[3] + " (" + file + ")"
          end if
        end if
      end if
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
      if kdlink_play(m, z, file, false) then
        lname = LCase(kdlink_zoneName(z, 0))
        m.zoneSays[lname] = "(test) " + label
        real = ""
        if type(z.activeState) = "roAssociativeArray" then real = kdlink_str(z.activeState.id$)
        if real = "" and type(z.activeState) = "roAssociativeArray" then real = kdlink_str(z.activeState.name$)
        m.testFrom[lname] = real
        m.playFile[lname] = file
        m.wasTest[lname] = cmd
        m.loopSeen.Delete(lname)
        m.resume.Delete(lname)
        m.playAt[lname] = m.tickNo
        m.sync.Delete(lname)
        ' A picture never ends: after a test it is taken away again after 10 s (after a play it stays).
        if cmd = "test" and kdlink_isImage(file) then m.resume[lname] = {state: real, at: m.tickNo + 40}
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
  ' (No Keys() or Count() on an associative array: BrightSign OS 9.1 has neither, the player
  ' stopped with "Member function not found" and restarted. Collect first, delete after the loop.)
  gone = []
  for each key in m.peers
    if now - m.peers[key].at > 600 then gone.Push(key)
  end for
  for each key in gone
    m.peers.Delete(key)
  end for
  if kdlink_count(m.peers) = 0 then
    m.outbox = []
    return
  end if
  kdlink_syncWatch(m)
  kdlink_resume(m)
  kdlink_loops(m)
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
  ' (4 per tick: the controller's network chip lost the end of a burst of 10 packets sent back to back)
  while m.outbox.Count() > 0 and sent < 4
    text = m.outbox.Shift()
    for each key in m.peers
      p = m.peers[key]
      m.sock.SendTo(p.host, p.port, text)
    end for
    sent = sent + 1
  end while
End Sub

' "kd sync <zone> <file|state> <ms> play|pause" from a controller timeline this zone follows: the file
' at that position, playing or standing still. Sent on every start, pause, jump and loop of the
' timeline and every 3 s; while the video is in step (within 0.6 s by the plugin's own count) nothing
' is touched, so the picture doesn't stutter.
Sub kdlink_sync(m As Object, zone As String, ref As String, ms As Integer, paused As Boolean)
  z = kdlink_findZone(m, zone)
  if z = invalid then return
  file = ref
  s = kdlink_findState(z, ref)
  if s <> invalid then
    if kdlink_fileOf(s) <> "" then file = kdlink_fileOf(s)
  end if
  lname = LCase(kdlink_zoneName(z, 0))
  if ms < 0 then ms = 0
  sy = m.sync[lname]
  fresh = true
  if sy <> invalid then
    if sy.file = file and kdlink_str(m.playFile[lname]) = file then fresh = false
  end if
  ' The file had played to its end (the timeline is longer) and the timeline jumps back: start it again.
  if not fresh then
    if sy.ended then
      here = sy.ms + (m.tickNo - sy.tick) * 250
      if ms < here - 600 then fresh = true
    end if
  end if
  if fresh then
    if not kdlink_play(m, z, file, false) then
      kdlink_reply(m, false, "zone '" + zone + "' can't play '" + file + "' directly")
      return
    end if
    label = file
    if LCase(file) <> LCase(ref) then label = ref + " (" + file + ")"
    m.zoneSays[lname] = "(test) " + label
    real = ""
    if type(z.activeState) = "roAssociativeArray" then real = kdlink_str(z.activeState.id$)
    m.testFrom[lname] = real
    m.playFile[lname] = file
    m.wasTest[lname] = "sync"
    m.resume.Delete(lname)
    m.playAt[lname] = m.tickNo
    sy = {file: file, ms: -100000, tick: m.tickNo, paused: false, ended: false, seen: m.tickNo}
    kdlink_reply(m, true, "follows the timeline with " + label + " in " + zone)
  end if
  if type(z.videoPlayer) = "roVideoPlayer" and not kdlink_isImage(file) then
    ' Where the video is by the plugin's own count since the last jump.
    here = sy.ms
    if not sy.paused then here = sy.ms + (m.tickNo - sy.tick) * 250
    off = ms - here
    if off < 0 then off = -off
    if sy.ended then off = 0
    if off > 600 or (fresh and ms > 0) then
      z.videoPlayer.Seek(ms)
      m.loopSeen.Delete(lname)
      m.playAt[lname] = m.tickNo
      sy.ms = ms
      sy.tick = m.tickNo
    else if fresh then
      sy.ms = ms
      sy.tick = m.tickNo
    end if
    if paused and not sy.paused then
      z.videoPlayer.Pause()
      sy.ms = ms
    else if sy.paused and not paused then
      z.videoPlayer.Resume()
      sy.ms = ms
      sy.tick = m.tickNo
    end if
    sy.paused = paused
  end if
  sy.seen = m.tickNo
  m.sync[lname] = sy
End Sub

' Back to the presentation: the zone's own state starts again at the next tick.
Sub kdlink_release(m As Object, z As Object)
  lname = LCase(kdlink_zoneName(z, 0))
  m.sync.Delete(lname)
  m.playFile.Delete(lname)
  m.wasTest.Delete(lname)
  m.loopSeen.Delete(lname)
  if type(z.videoPlayer) = "roVideoPlayer" then z.videoPlayer.Resume()
  st = ""
  if type(z.activeState) = "roAssociativeArray" then st = kdlink_str(z.activeState.id$)
  m.resume[lname] = {state: st, at: m.tickNo}
End Sub

' A zone that follows a timeline hears from the controller every 3 s. After 12 s of silence
' (controller off, cable out) it goes back to the presentation by itself.
Sub kdlink_syncWatch(m As Object)
  if kdlink_count(m.sync) = 0 then return
  list = kdlink_zoneList(m)
  if list = invalid then return
  for each z in list
    if type(z) = "roAssociativeArray" then
      lname = LCase(kdlink_zoneName(z, 0))
      sy = m.sync[lname]
      if sy <> invalid then
        if m.tickNo - sy.seen > 48 then kdlink_release(m, z)
      end if
    end if
  end for
End Sub

' A video or audio player finished its file: tell the controller which zone and which file
' (the file a "kd play" started there, else the file of the zone's state).
Sub kdlink_ended(m As Object, event As Object)
  if kdlink_count(m.peers) = 0 then return
  list = kdlink_zoneList(m)
  if list = invalid then return
  id = event.GetSourceIdentity()
  n = 0
  for each z in list
    if type(z) = "roAssociativeArray" then
      n = n + 1
      mine = false
      if type(z.videoPlayer) = "roVideoPlayer" then
        if z.videoPlayer.GetIdentity() = id then mine = true
      end if
      if type(z.audioPlayer) = "roAudioPlayer" then
        if z.audioPlayer.GetIdentity() = id then mine = true
      end if
      if mine then
        name = kdlink_zoneName(z, n)
        lname = LCase(name)
        file = kdlink_str(m.playFile[lname])
        if file = "" and type(z.activeState) = "roAssociativeArray" then file = kdlink_fileOf(z.activeState)
        ' Stopping the video that was playing (for a picture, or for the next file) can still send its
        ' "ended": not the end of what was just started. Nothing ends within half a second, a picture never.
        if m.playFile[lname] <> invalid then
          if kdlink_isImage(file) then return
          if m.playAt[lname] <> invalid then
            if m.tickNo - m.playAt[lname] < 2 then return
          end if
        end if
        ' After a file started from the controller the presentation should carry on, so the screen never
        ' stays frozen on a last frame: the zone's own state is started again if the zone is still in it.
        ' After a test at once (two ticks); after a play only when the controller sends no new play within
        ' 2 s (a playlist run from the controller answers "ended" within milliseconds).
        if kdlink_str(m.wasTest[lname]) = "play" or kdlink_str(m.wasTest[lname]) = "test" then
          after = 8
          if kdlink_str(m.wasTest[lname]) = "test" then after = 2
          if type(z.activeState) = "roAssociativeArray" then m.resume[lname] = {state: kdlink_str(z.activeState.id$), at: m.tickNo + after}
        end if
        if kdlink_str(m.wasTest[lname]) = "sync" and m.sync[lname] <> invalid then
          ' Following a timeline that is longer than the file: the last frame stays until the timeline moves on.
          m.sync[lname].ended = true
        else
          m.playFile.Delete(lname)
          m.wasTest.Delete(lname)
        end if
        m.loopSeen.Delete(lname)
        kdlink_queue(m, {kd: "ended", i: n, name: Left(name, 100), file: Left(file, 150), state: Left(kdlink_stateOfFile(z, file), 100)})
        kdlink_tick(m)
        return
      end if
    end if
  end for
End Sub

Sub kdlink_queue(m As Object, o As Object)
  if m.outbox.Count() < 200 then
    j = FormatJson(o)
    if j <> invalid and j <> "" then m.outbox.Push(j)
  end if
End Sub

' What the player received, for the controller's Activity list (at most 8 lines per tick).
Sub kdlink_log(m As Object, src As String, text As String)
  if kdlink_count(m.peers) = 0 or m.logCount >= 8 then return
  m.logCount = m.logCount + 1
  kdlink_queue(m, {kd: "log", src: src, text: Left(text, 200)})
End Sub

Sub kdlink_reply(m As Object, ok As Boolean, text As String)
  kdlink_queue(m, {kd: "reply", ok: ok, text: Left(text, 450)})
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
          m.playFile.Delete(lname)
          m.wasTest.Delete(lname)
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
            file = kdlink_fileOf(s)
            o = {kd: "state", z: n, name: Left(name, 100), file: Left(file, 150)}
            ' The length lets the controller make a timeline as long as the video it follows
            ' (read once per file and kept in m.durs, so a second hello costs nothing).
            if file <> "" and not kdlink_isImage(file) then o.ms = Int(kdlink_duration(m, file))
            kdlink_queue(m, o)
            sent = sent + 1
          end if
        end for
      end if
    end if
  end for
End Sub

' The name of the state that plays this file in a zone (the zone's own state first); "" = none.
Function kdlink_stateOfFile(z As Object, file As String) As String
  if file = "" then return ""
  s = z.activeState
  if type(s) = "roAssociativeArray" then
    if LCase(kdlink_fileOf(s)) = LCase(file) and kdlink_str(s.id$) <> "" then return kdlink_str(s.id$)
  end if
  table = z.stateTable
  if type(table) <> "roAssociativeArray" then return ""
  for each key in table
    s = table[key]
    if type(s) = "roAssociativeArray" then
      if LCase(kdlink_fileOf(s)) = LCase(file) then
        if kdlink_str(s.id$) <> "" then return kdlink_str(s.id$)
        return key
      end if
    end if
  end for
  return ""
End Function

Function kdlink_isImage(file As String) As Boolean
  ext = LCase(Right(file, 4))
  return ext = ".jpg" or ext = ".png" or ext = "jpeg" or ext = ".bmp" or ext = ".gif"
End Function

' What a player call returned (true / false or 1 / 0, depending on the object) as a yes or no.
Function kdlink_ok(x As Dynamic) As Boolean
  v = kdlink_str(x)
  return v = "true" or (v <> "" and v <> "false" and v <> "0")
End Function

' Whether the presentation loops this state's video itself (the same rule as the player's own software).
Function kdlink_loopsItself(s As Object) As Boolean
  if type(s.videoEndEvent) = "roAssociativeArray" then return false
  it = s.videoItem
  if type(it) = "roAssociativeArray" then
    if kdlink_str(it.automaticallyLoop) = "false" then return false
  end if
  return true
End Function

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

' A video that loops (a state without a Media End event) never sends a "media ended" event, so its
' position is watched: each time it passes the end of the file, that is reported as "ended" too.
' (The position keeps counting through a loop on some OS versions and starts again on others.)
Sub kdlink_loops(m As Object)
  if not m.canPoll then return
  list = kdlink_zoneList(m)
  if list = invalid then return
  n = 0
  for each z in list
    if type(z) = "roAssociativeArray" then
      n = n + 1
      if type(z.videoPlayer) = "roVideoPlayer" then
        name = kdlink_zoneName(z, n)
        lname = LCase(name)
        file = kdlink_str(m.playFile[lname])
        if file = "" and type(z.activeState) = "roAssociativeArray" then file = kdlink_fileOf(z.activeState)
        st = ""
        if type(z.activeState) = "roAssociativeArray" then st = kdlink_str(z.activeState.id$)
        key = st + "|" + file
        ms = Val(kdlink_str(z.videoPlayer.GetPlaybackPosition()))
        dur = Val(kdlink_str(z.videoPlayer.GetDuration()))
        ' (LS425, OS 9.1: GetDuration says -1 and the position counts on through every loop)
        if dur < 1000 and file <> "" and not kdlink_isImage(file) then dur = kdlink_duration(m, file)
        if file = "" or kdlink_isImage(file) then
          m.loopSeen.Delete(lname)
        else
          ' Passes of the file so far, where the position keeps counting and the length is known.
          count = 0
          if dur >= 1000 and ms > dur then count = Int((ms - 150) / dur)
          t = m.loopSeen[lname]
          looped = false
          if t <> invalid then
            if t.key = key then
              if count > t.count then looped = true
              ' The position jumped back by more than a second in the same file: it started again.
              if count = t.count and ms + 1000 < t.ms then looped = true
            end if
          end if
          m.loopSeen[lname] = {key: key, count: count, ms: ms}
          if looped then kdlink_queue(m, {kd: "ended", i: n, name: Left(name, 100), file: Left(file, 150), state: Left(kdlink_stateOfFile(z, file), 100)})
        end if
      end if
    end if
  end for
End Sub

' The length of a media file in ms, read from the file itself (once per file); 0 = unknown.
' First the player's own ProbeFile; where that says nothing (LS425, OS 9.1), the mp4 / mov header.
Function kdlink_duration(m As Object, file As String) As Float
  k = LCase(file)
  if m.durs[k] <> invalid then return m.durs[k]
  d = 0
  path = kdlink_path(m, file)
  vp = CreateObject("roVideoPlayer")
  note = "vp=" + type(vp)
  if type(vp) = "roVideoPlayer" then
    info = vp.ProbeFile(path)
    note = note + " info=" + type(info)
    if type(info) = "roAssociativeArray" then
      for each key in info
        note = note + " " + key + "=" + Left(kdlink_str(info[key]), 12)
      end for
      d = Val(kdlink_str(info["VideoDuration"]))
      if d < 1000 then d = Val(kdlink_str(info["AudioDuration"]))
      if d < 1000 then d = Val(kdlink_str(info["Duration"]))
    end if
  end if
  vp = invalid
  if d < 1000 then
    d = kdlink_mp4ms(path)
    note = note + " mp4=" + kdlink_str(d)
  end if
  m.durs[k] = d
  m.durNote = Left(path + " " + note, 330)
  return d
End Function

' A big-endian 32-bit number in a byte array; -1 when it doesn't fit a (signed) integer.
Function kdlink_be32(ba As Object, i As Integer) As Integer
  if ba.Count() < i + 4 then return -1
  if ba[i] > 127 then return -1
  return ba[i] * 16777216 + ba[i + 1] * 65536 + ba[i + 2] * 256 + ba[i + 3]
End Function

Function kdlink_tag(ba As Object, i As Integer) As String
  if ba.Count() < i + 4 then return ""
  return Chr(ba[i]) + Chr(ba[i + 1]) + Chr(ba[i + 2]) + Chr(ba[i + 3])
End Function

' The length of an mp4 / mov file in ms from its header (the "mvhd" box inside "moov"); 0 = not found.
' Only reads the few bytes it needs, wherever in the file they are.
Function kdlink_mp4ms(path As String) As Float
  ba = CreateObject("roByteArray")
  if type(ba) <> "roByteArray" then return 0
  off = 0
  for i = 1 to 100
    ba.Clear()
    if not ba.ReadFile(path, off, 16) then return 0
    size = kdlink_be32(ba, 0)
    tag = kdlink_tag(ba, 4)
    head = 8
    if size = 1 then
      ' a 64-bit size: fine as long as it is below 2 GB
      if kdlink_be32(ba, 8) <> 0 then return 0
      size = kdlink_be32(ba, 12)
      head = 16
    end if
    if size < 8 then return 0
    if tag = "moov" then
      inner = off + head
      for j = 1 to 50
        ba.Clear()
        if not ba.ReadFile(path, inner, 44) then return 0
        size2 = kdlink_be32(ba, 0)
        if size2 < 8 then return 0
        if kdlink_tag(ba, 4) = "mvhd" then
          scale = 0
          length = 0
          if ba[8] = 1 then
            scale = kdlink_be32(ba, 28)
            if kdlink_be32(ba, 32) <> 0 then return 0
            length = kdlink_be32(ba, 36)
          else
            scale = kdlink_be32(ba, 20)
            length = kdlink_be32(ba, 24)
          end if
          if scale <= 0 or length <= 0 then return 0
          return length * 1000.0 / scale
        end if
        inner = inner + size2
        if inner >= off + size then return 0
      end for
      return 0
    end if
    off = off + size
  end for
  return 0
End Function

' "kd probe": what the plugin sees of each zone's video player, to find out why something isn't reported.
Sub kdlink_probe(m As Object)
  text = "t=" + Str(m.clock.TotalSeconds()).Trim() + " poll=" + kdlink_str(m.canPoll)
  list = kdlink_zoneList(m)
  n = 0
  if list <> invalid then
    for each z in list
      if type(z) = "roAssociativeArray" then
        n = n + 1
        text = text + " | z" + Str(n).Trim() + " video=" + type(z.videoPlayer) + " audio=" + type(z.audioPlayer)
        if m.canPoll and type(z.videoPlayer) = "roVideoPlayer" then
          text = text + " pos=" + kdlink_str(z.videoPlayer.GetPlaybackPosition()) + " dur=" + kdlink_str(z.videoPlayer.GetDuration())
        end if
      end if
    end for
  end if
  for each k in m.durs
    text = text + " | " + k + "=" + kdlink_str(m.durs[k])
  end for
  for each k in m.sync
    sy = m.sync[k]
    text = text + " | sync " + k + " ms=" + kdlink_str(sy.ms) + " tick=" + kdlink_str(sy.tick) + "/" + kdlink_str(m.tickNo) + " paused=" + kdlink_str(sy.paused) + " ended=" + kdlink_str(sy.ended)
  end for
  text = text + " | " + kdlink_str(m.durNote)
  ev = ""
  for each e in m.evLog
    ev = ev + " " + e
  end for
  kdlink_reply(m, true, text + " | events" + ev)
End Sub

' A test file ended in a zone whose state loops its own file: start that file again (looping), so
' the presentation looks as before the test.
Sub kdlink_resume(m As Object)
  if kdlink_count(m.resume) = 0 then return
  list = kdlink_zoneList(m)
  if list = invalid then return
  n = 0
  for each z in list
    if type(z) = "roAssociativeArray" then
      n = n + 1
      lname = LCase(kdlink_zoneName(z, n))
      r = m.resume[lname]
      if r <> invalid then
        if m.tickNo >= r.at then
          m.resume.Delete(lname)
          s = z.activeState
          if type(s) = "roAssociativeArray" then
            if kdlink_str(s.id$) = r.state and kdlink_fileOf(s) <> "" then
              kdlink_play(m, z, kdlink_fileOf(s), kdlink_loopsItself(s))
              m.playFile.Delete(lname)
              m.loopSeen.Delete(lname)
              m.zoneSays.Delete(lname)
              m.testFrom.Delete(lname)
            end if
          end if
        end if
      end if
    end if
  end for
End Sub

' Plays a file in a zone with the zone's own player object. looping = false: once, so its end is
' reported (a state without a Media End event leaves the zone's player looping).
Function kdlink_play(m As Object, z As Object, file As String, looping As Boolean) As Boolean
  path = kdlink_path(m, file)
  ' A picture: on the zone's picture layer (an roImageWidget in BrightAuthor:connected), shown over
  ' the video, which is stopped and cleared - the same steps the presentation takes for a picture state.
  if kdlink_isImage(file) then
    t = type(z.imagePlayer)
    if t <> "roImageWidget" and t <> "roImagePlayer" then return false
    aa = {}
    aa.filename = path
    if not kdlink_ok(z.imagePlayer.DisplayFile(aa)) then return false
    if t = "roImageWidget" then z.imagePlayer.Show()
    if type(z.videoPlayer) = "roVideoPlayer" then z.videoPlayer.StopClear()
    return true
  end if
  ' Video / audio: take a picture that is showing away first, or it stays on top of the video.
  if type(z.imagePlayer) = "roImageWidget" or type(z.imagePlayer) = "roImagePlayer" then z.imagePlayer.StopDisplay()
  ext = LCase(Right(file, 4))
  if ext = ".mp3" or ext = ".wav" or ext = ".aac" or ext = ".m4a" or ext = "flac" then
    if type(z.audioPlayer) = "roAudioPlayer" then
      z.audioPlayer.SetLoopMode(looping)
      return z.audioPlayer.PlayFile(path)
    end if
  end if
  if type(z.videoPlayer) = "roVideoPlayer" then
    z.videoPlayer.SetLoopMode(looping)
    return z.videoPlayer.PlayFile(path)
  end if
  if type(z.audioPlayer) = "roAudioPlayer" then
    z.audioPlayer.SetLoopMode(looping)
    return z.audioPlayer.PlayFile(path)
  end if
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

' The number of entries of an associative array (0 for anything else).
Function kdlink_count(aa As Dynamic) As Integer
  n = 0
  if type(aa) = "roAssociativeArray" then
    for each key in aa
      n = n + 1
    end for
  end if
  return n
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
