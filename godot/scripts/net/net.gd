## Astro Outpost — the network under crew mode (scripts/addons/crew.gd): up to four players, one of them hosts.
##
## Two ways to reach each other, both free, with nothing to install and no server of our own:
## - Direct (ENet over UDP). Games on the same network find each other by themselves: a guest's game calls out on the
##   local network ("who has crew ABCDE?") and the host's game answers. Over the internet, the host's game asks the
##   home router to let the crew in (UPnP) and tells the guests where to knock, through the relay. Fastest, tried first.
## - The relay. Many home routers, phone networks and school networks will not let two computers link directly. Then
##   the messages go through a public message relay (MQTT over a secure WebSocket: test.mosquitto.org, or
##   broker.hivemq.com). A guest switches to the relay by itself when no direct link has opened after a few seconds.
## Every message, both ways, is locked (AES-256) and signed (HMAC-SHA-256) with keys made from the crew code, so the
## relay, the network and anyone listening see only scrambled bytes, and only games that know the code can talk to
## the crew. Messages are Godot values (var_to_bytes: numbers keep their kind; objects are never decoded). Big ones
## are cut into pieces and put back together on the other side.
##
## Tests: "net=lan" after -- on the command line never uses the relay (and never asks the router); "net=relay" uses
## the relay only.
extends Node

const LETTERS := "ABCDEFGHJKLMNPQRSTUVWXYZ"        # no I and O: a code read out loud must not be mistaken
const RELAYS := ["wss://test.mosquitto.org:8081/mqtt", "wss://broker.hivemq.com:8884/mqtt"]
const VERSION := 1
const PORT0 := 47820            # the host's game listens on the first free port from here
const PORTS := 10
const DISCO := 47810            # "who has crew ABCDE?" on the local network: the first free port from here
const DISCOS := 4
const CHUNK := 12000
const MAX_GUESTS := 3
const LOST_AFTER := 20000.0
const DIRECT_WAIT := 6000.0
const JOIN_WAIT := 30000.0
const CID_CHARS := "abcdefghijklmnopqrstuvwxyz0123456789"

var mode = null                 # how this game reaches the others: "direct" or "relay"
var role = null                 # "host", "guest", or null outside a crew
var code = null
var cid := ""
var me := -1                    # this player's number: 0 is the host
var peers := {}                 # cid -> link { cid, pid, enet, relay, last, rtt, grace, told }
var on := {}                    # what the crew listens to: status, knock, join, leave, msg, joined, rejected, lost
var rtt := 0.0                  # a guest: the round trip to the host, in ms
var relay_on := false
var port := 0                   # the host: where guests can dial in directly (0: nowhere)
var public_ip := ""             # the host: its address on the internet, once the router has let the crew in
var session := 0

var _key := PackedByteArray()
var _mac := PackedByteArray()
var _base := ""
var _lan_tag := PackedByteArray()
var _aes := AESContext.new()
var _crypto := Crypto.new()
var _enet: ENetConnection = null
var _by_peer := {}              # the host: ENetPacketPeer -> link, once that game has said hello
var _dialing: Array = []        # a guest: the direct calls still ringing, { e: ENetConnection, p: ENetPacketPeer } (one each)
var _tried := {}
var _disco: PacketPeerUDP = null
var _ask: PacketPeerUDP = null
var _ask_at := 0.0
var _host_link = null
var _chunks := {}
var _seq := 0
var _tick_at := 0.0
var _beat := false
var _join = null
var _threads: Array = []
var _upnp = null
var _force := ""
var _closing: Array = []        # relays told goodbye, closed a moment later (so the goodbye leaves first)
var R = null                    # the relay: { ws, url, urls, subs, ready, settled, sent, buf, tries, t0, ping_at, redial_at, done, told }


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for a in OS.get_cmdline_user_args():
		if a.begins_with("net="):
			_force = a.substr(4)


static func now() -> float:
	return Time.get_ticks_usec() / 1000.0


func _emit(name: String, args: Array = []) -> void:
	var fn = on.get(name)
	if fn is Callable and fn.is_valid():
		fn.callv(args)


func _status(text: String) -> void:
	_emit("status", [text])


static func new_code() -> String:
	var c := ""
	for i in 5:
		c += LETTERS[randi() % LETTERS.length()]
	return c


## a code typed with spaces or lower-case letters, or "crew=ABCDE" pasted in, all give the 5 letters
static func clean_code(c) -> String:
	var t := str(c) if c != null else ""
	var m := RegEx.create_from_string("crew=([A-Za-z]{5})").search(t)
	if m:
		t = m.get_string(1)
	t = t.to_upper()
	var out := ""
	for ch in t:
		if ch >= "A" and ch <= "Z":
			out += ch
	return out.substr(0, 5)


static func _cid_ok(c) -> bool:
	return c is String and RegEx.create_from_string("^g[a-z0-9]{4,12}$").search(c) != null


func _rand_id(n: int) -> String:
	var b := _crypto.generate_random_bytes(n)
	var s := ""
	for i in n:
		s += CID_CHARS[b[i] % CID_CHARS.length()]
	return s


# =====================================================================
#  THE LOCK: keys from the crew code, AES-256-CBC, then an HMAC over all of it
# =====================================================================
static func _sha(t: String) -> PackedByteArray:
	var h := HashingContext.new()
	h.start(HashingContext.HASH_SHA256)
	h.update(t.to_utf8_buffer())
	return h.finish()


func _keys(c: String) -> void:
	_key = _sha("astro-outpost-godot crew key " + c)
	_mac = _sha("astro-outpost-godot crew mac " + c)
	_base = "astro-outpost-godot/" + _sha("astro-outpost-godot crew topic " + c).hex_encode().substr(0, 24)
	_lan_tag = _sha("astro-outpost-godot crew lan " + c).slice(0, 8)


func _seal(data: PackedByteArray) -> PackedByteArray:
	var iv := _crypto.generate_random_bytes(16)
	var p := data.duplicate()
	var pad := 16 - p.size() % 16
	for i in pad:
		p.append(pad)
	_aes.start(AESContext.MODE_CBC_ENCRYPT, _key, iv)
	var body := iv + _aes.update(p)
	_aes.finish()
	return body + _crypto.hmac_digest(HashingContext.HASH_SHA256, _mac, body)


## the message inside, or nothing when it was not locked with our code (or was changed on the way)
func _unseal(b: PackedByteArray) -> PackedByteArray:
	if _key.is_empty() or b.size() < 64 or (b.size() - 48) % 16 != 0:
		return PackedByteArray()
	var body := b.slice(0, b.size() - 32)
	if not _crypto.constant_time_compare(_crypto.hmac_digest(HashingContext.HASH_SHA256, _mac, body), b.slice(b.size() - 32)):
		return PackedByteArray()
	_aes.start(AESContext.MODE_CBC_DECRYPT, _key, body.slice(0, 16))
	var p := _aes.update(body.slice(16))
	_aes.finish()
	var pad := p[p.size() - 1]
	if pad < 1 or pad > 16:
		return PackedByteArray()
	return p.slice(0, p.size() - pad)


static func _decode(b: PackedByteArray):
	if b.size() < 4:
		return null
	return bytes_to_var(b)


# =====================================================================
#  THE RELAY: a tiny MQTT 3.1.1 client (QoS 0) over a secure WebSocket
# =====================================================================
# Topics (made from a hash of the crew code, so the code itself is not in them): <base>/h to the host,
# <base>/g/<guest> to one guest, <base>/a to every guest at once.
static func _rlen(n: int) -> PackedByteArray:
	var o := PackedByteArray()
	while true:
		var d := n % 128
		n = n / 128
		if n > 0:
			d |= 128
		o.append(d)
		if n <= 0:
			break
	return o


static func _mstr(s: String) -> PackedByteArray:
	var b := s.to_utf8_buffer()
	var o := PackedByteArray([b.size() >> 8, b.size() & 255])
	o.append_array(b)
	return o


static func _packet(type: int, body: PackedByteArray) -> PackedByteArray:
	var o := PackedByteArray([type])
	o.append_array(_rlen(body.size()))
	o.append_array(body)
	return o


func _mq_connect() -> PackedByteArray:
	var body := PackedByteArray([0, 4, 77, 81, 84, 84, 4, 2, 0, 60])
	body.append_array(_mstr("aog" + _rand_id(12)))
	return _packet(0x10, body)


func _mq_subscribe(topics: Array) -> PackedByteArray:
	var body := PackedByteArray([0, 1])
	for t in topics:
		body.append_array(_mstr(t))
		body.append(0)
	return _packet(0x82, body)


static func _mq_publish(topic: String, payload: PackedByteArray) -> PackedByteArray:
	var body := _mstr(topic)
	body.append_array(payload)
	return _packet(0x30, body)


## subs: the topic ends this player listens to; done(true) once listening, done(false) when no relay can be reached
func _relay_start(subs: Array, done: Callable) -> void:
	_relay_stop()
	if _force == "lan":
		done.call_deferred(false)
		return
	R = { "subs": subs, "urls": RELAYS.duplicate(), "ws": null, "url": "", "ready": false, "settled": false, "sent": false,
		"buf": PackedByteArray(), "tries": 0, "t0": 0.0, "ping_at": 0.0, "redial_at": 0.0, "redialing": false, "done": done, "told": false }
	_relay_dial()


func _relay_dial() -> void:
	var r = R
	while r != null:
		if r.urls.is_empty():
			r.ws = null
			if r.redialing:
				_relay_lost()
			elif not r.told:
				r.told = true
				r.done.call(false)
			return
		var url: String = r.urls.pop_front()
		var ws := WebSocketPeer.new()
		ws.supported_protocols = PackedStringArray(["mqtt"])
		ws.inbound_buffer_size = 1 << 20
		ws.outbound_buffer_size = 1 << 20
		ws.max_queued_packets = 8192
		if ws.connect_to_url(url) != OK:
			continue
		r.ws = ws
		r.url = url
		r.settled = false
		r.sent = false
		r.t0 = now()
		r.buf = PackedByteArray()
		return


## a redial did not work: wait a little and try again, five times at most
func _relay_lost() -> void:
	var r = R
	if r == null:
		return
	r.ready = false
	relay_on = false
	if r.tries < 5:
		r.tries += 1
		r.redial_at = now() + 1000.0


func _relay_fail() -> void:
	var r = R
	if r == null:
		return
	if r.ws:
		r.ws.close()
	r.ws = null
	if r.redialing:
		_relay_lost()
	else:
		_relay_dial()


func _relay_poll() -> void:
	var r = R
	if r == null:
		return
	var ws: WebSocketPeer = r.ws
	if ws == null:
		if r.redial_at > 0.0 and now() >= r.redial_at:
			r.redial_at = 0.0
			r.redialing = true
			r.urls = [r.url]           # the same relay again: the others must find us there
			_relay_dial()
		return
	ws.poll()
	var st := ws.get_ready_state()
	if st == WebSocketPeer.STATE_CONNECTING:
		if now() - r.t0 > 7000.0:
			_relay_fail()
		return
	if st == WebSocketPeer.STATE_OPEN:
		if not r.sent:
			r.sent = true
			ws.send(_mq_connect())
		while R == r and r.ws == ws and ws.get_available_packet_count() > 0:
			var b := ws.get_packet()
			if not r.settled:
				if b.size() < 4 or b[0] != 0x20 or b[3] != 0:
					_relay_fail()
					return
				r.settled = true
				r.ready = true
				r.redialing = false
				r.tries = 0
				var topics: Array = []
				for s in r.subs:
					topics.append(_base + s)
				ws.send(_mq_subscribe(topics))
				r.ping_at = now() + 20000.0
				relay_on = true
				if not r.told:
					r.told = true
					r.done.call(true)
				if b.size() > 4 and R == r:
					_feed(b.slice(4))
				continue
			_feed(b)
		if R != r or r.ws != ws:
			return
		if not r.settled and now() - r.t0 > 7000.0:
			_relay_fail()
		elif r.settled and now() >= r.ping_at:
			r.ping_at = now() + 20000.0
			ws.send(PackedByteArray([0xC0, 0]))
		return
	if st == WebSocketPeer.STATE_CLOSING:
		return
	# closed
	r.ws = null
	if not r.settled:
		_relay_fail()
	else:
		r.redialing = true
		_relay_lost()


func _relay_stop(later_ms := 0.0) -> void:
	var r = R
	R = null
	relay_on = false
	if r == null or r.ws == null:
		return
	_closing.append([r.ws, now() + later_ms])


## bytes from the relay: whole MQTT packets are taken out as they complete
func _feed(bytes: PackedByteArray) -> void:
	var r = R
	var b: PackedByteArray = r.buf + bytes
	while b.size() >= 2:
		var length := 0
		var mul := 1
		var i := 1
		var whole := true
		while true:
			if i >= b.size():
				whole = false
				break
			var c := b[i]
			i += 1
			length += (c & 127) * mul
			mul *= 128
			if (c & 128) == 0:
				break
		if not whole or b.size() < i + length:
			break
		if (b[0] & 0xF0) == 0x30 and length >= 2:
			var qos := (b[0] >> 1) & 3
			var tl := (b[i] << 8) | b[i + 1]
			var topic := b.slice(i + 2, i + 2 + tl).get_string_from_utf8()
			var data := b.slice(i + 2 + tl + (2 if qos else 0), i + length)
			_relay_in(topic, data)
			if R != r:
				return
		b = b.slice(i + length)
	r.buf = b


## anything that does not unlock with our key is not for us
func _relay_in(topic: String, data: PackedByteArray) -> void:
	if not topic.begins_with(_base):
		return
	var env = _decode(_unseal(data))
	if env is Dictionary:
		_from_relay(topic.substr(_base.length()), env)


func _relay_out(end: String, env: Dictionary) -> void:
	var r = R
	if r == null or not r.ready or r.ws == null:
		return
	r.ws.send(_mq_publish(_base + end, _seal(var_to_bytes(env))))


func _from_relay(end: String, env: Dictionary) -> void:
	if role == "host":
		if end != "/h" or not _cid_ok(env.get("f")):
			return
		if env.has("sig"):
			_sig_host(env)
			return
		if not (env.get("d") is PackedByteArray):
			return
		var link = peers.get(env.f)
		if link == null:
			link = _new_link(env.f)
			link.relay = true
			peers[env.f] = link
			_emit("knock", ["relay"])
		elif not link.relay:
			link.relay = true
			_unbind(link)
		_received(link, env.d)
	elif role == "guest":
		if end != "/a" and end != "/g/" + cid:
			return
		if env.has("sig"):
			_sig_guest(env)
			return
		if _host_link == null or not _host_link.relay or not (env.get("d") is PackedByteArray):
			return
		if me >= 0 and int(env.get("x", -1)) == me:
			return
		_received(_host_link, env.d)


# ---------- finding the host: the relay tells a guest where to dial directly ----------
func _sig_host(env: Dictionary) -> void:
	if env.sig == "where":
		_relay_out("/g/" + str(env.f), { "f": "host", "sig": "here", "port": port, "addrs": _addresses() })


func _sig_guest(env: Dictionary) -> void:
	if env.sig != "here" or _join == null:
		return
	_join.heard = true
	var pt := int(env.get("port", 0))
	if pt <= 0:
		return
	for a in env.get("addrs", []):
		_dial(str(a), pt)


## where this computer can be reached: its addresses on the local network, and on the internet when the router let us in
func _addresses() -> Array:
	var out: Array = []
	for a in IP.get_local_addresses():
		if a.find(":") < 0 and not a.begins_with("127.") and not a.begins_with("169.254."):
			out.append(a)
	if public_ip != "" and not out.has(public_ip):
		out.append(public_ip)
	return out


# =====================================================================
#  THE LOCAL NETWORK: "who has crew ABCDE?"
# =====================================================================
func _disco_start() -> void:
	if _force == "relay":
		return
	for i in DISCOS:
		var u := PacketPeerUDP.new()
		if u.bind(DISCO + i, "0.0.0.0") == OK:
			_disco = u
			return


func _disco_poll() -> void:
	while _disco and _disco.get_available_packet_count() > 0:
		var b := _disco.get_packet()
		var ip := _disco.get_packet_ip()
		var pt := _disco.get_packet_port()
		if port <= 0 or b.size() != 12 or b.slice(0, 4) != PackedByteArray([65, 79, 81, VERSION]) or b.slice(4) != _lan_tag:
			continue
		var r := PackedByteArray([65, 79, 65, VERSION])
		r.append_array(_lan_tag)
		r.append(port >> 8)
		r.append(port & 255)
		_disco.set_dest_address(ip, pt)
		_disco.put_packet(r)


func _ask_start() -> void:
	_ask = PacketPeerUDP.new()
	_ask.set_broadcast_enabled(true)
	if _ask.bind(0, "0.0.0.0") != OK:
		_ask = null
	_ask_at = 0.0


func _ask_poll() -> void:
	if _ask == null:
		return
	if now() >= _ask_at and now() - _join.t0 < DIRECT_WAIT + 3000.0:
		_ask_at = now() + 900.0
		var q := PackedByteArray([65, 79, 81, VERSION])
		q.append_array(_lan_tag)
		for i in DISCOS:
			for to in ["255.255.255.255", "127.0.0.1"]:
				_ask.set_dest_address(to, DISCO + i)
				_ask.put_packet(q)
	while _ask and _ask.get_available_packet_count() > 0:
		var b := _ask.get_packet()
		var ip := _ask.get_packet_ip()
		if b.size() == 14 and b.slice(0, 4) == PackedByteArray([65, 79, 65, VERSION]) and b.slice(4, 12) == _lan_tag:
			_join.heard = true
			_dial(ip, (b[12] << 8) | b[13])


# =====================================================================
#  DIRECT LINKS (ENet): channel 0 reliable and in order, channel 1 fast (positions)
# =====================================================================
func _dial(ip: String, pt: int) -> void:
	if _join == null or _join.done or _join.via_relay or ip == "" or pt <= 0:
		return
	var key := ip + ":" + str(pt)
	if _tried.has(key):
		return
	_tried[key] = true
	var e := ENetConnection.new()           # one connection can call one address: each address gets its own
	if e.create_host(1, 2) != OK:
		return
	var p := e.connect_to_host(ip, pt, 2)
	if p == null:
		e.destroy()
		return
	_dialing.append({ "e": e, "p": p })


func _dial_of(p: ENetPacketPeer):
	for d in _dialing:
		if d.p == p:
			return d
	return null


func _drop_dials() -> void:
	for d in _dialing:
		d.p.peer_disconnect_now()
		d.e.flush()
		d.e.destroy()
	_dialing.clear()


func _enet_poll() -> void:
	if _enet:
		_poll_conn(_enet)
	for d in _dialing.duplicate():
		if _dialing.has(d):
			_poll_conn(d.e)


func _poll_conn(e: ENetConnection) -> void:
	for guard in 256:
		if e != _enet and not _dialing.any(func(d): return d.e == e):
			return                          # closed meanwhile
		var ev: Array = e.service(0)
		var type: int = ev[0]
		if type == ENetConnection.EVENT_NONE or type == ENetConnection.EVENT_ERROR:
			return
		var p: ENetPacketPeer = ev[1]
		if type == ENetConnection.EVENT_CONNECT:
			_enet_open(p)
		elif type == ENetConnection.EVENT_DISCONNECT:
			_enet_gone(p)
		elif type == ENetConnection.EVENT_RECEIVE:
			var b := p.get_packet()
			_enet_data(p, b)


func _enet_open(p: ENetPacketPeer) -> void:
	var d = _dial_of(p)
	if role != "guest" or d == null or _join == null or _join.via_relay or _host_link == null or _host_link.enet:
		return
	_dialing.erase(d)
	_drop_dials()
	if _enet:
		_enet.destroy()
	_enet = d.e
	_host_link.enet = p
	_host_link.last = now()
	_join.heard = true
	mode = "direct"
	_status("Connected to the host. Saying hello…")
	_send_raw(_host_link, _join.hi)
	_beat = true


func _enet_gone(p: ENetPacketPeer) -> void:
	if role == "host":
		var link = _by_peer.get(p)
		_by_peer.erase(p)
		if link and link.enet == p:
			link.enet = null
			if not link.relay:
				_drop(link, "left")
	elif _host_link and _host_link.enet == p:
		_host_link.enet = null
		if _host_link.pid == 0:
			_drop(_host_link, "closed")
	else:
		var d = _dial_of(p)
		if d:
			_dialing.erase(d)
			d.e.destroy()


func _enet_data(p: ENetPacketPeer, b: PackedByteArray) -> void:
	var m = _decode(_unseal(b))
	if not (m is Dictionary):
		return
	if role == "host":
		var link = _by_peer.get(p)
		if link == null:
			if m.get("t") != "_hello" or not _cid_ok(m.get("cid")):
				return
			link = peers.get(m.cid)
			if link and link.relay:               # this guest already came in through the relay
				p.peer_disconnect_later()
				return
			if link == null:
				link = _new_link(m.cid)
				peers[m.cid] = link
				_emit("knock", ["direct"])
			link.enet = p
			_by_peer[p] = link
		_received_msg(link, m)
	elif _host_link and _host_link.enet == p:
		_received_msg(_host_link, m)


# =====================================================================
#  LINKS: one per other player
# =====================================================================
func _new_link(c: String) -> Dictionary:
	return { "cid": c, "pid": -1, "enet": null, "relay": false, "last": now(), "rtt": 0.0, "grace": 0.0, "told": false }


func _unbind(link: Dictionary) -> void:
	var p = link.get("enet")
	if p:
		_by_peer.erase(p)
		p.peer_disconnect_later()
	link.enet = null


func _out(link: Dictionary, b: PackedByteArray, fast: bool) -> void:
	if link.get("all", false):
		_relay_out("/a", { "f": "host", "x": link.x, "d": b })
		return
	if link.relay:
		if role == "host":
			_relay_out("/g/" + link.cid, { "f": "host", "d": b })
		else:
			_relay_out("/h", { "f": cid, "d": b })
		return
	var p = link.enet
	if p == null or p.get_state() != ENetPacketPeer.STATE_CONNECTED:
		return
	p.send(1 if fast else 0, _seal(b), 0 if fast else ENetPacketPeer.FLAG_RELIABLE)


func _send_raw(link: Dictionary, msg: Dictionary, fast := false) -> void:
	var b := var_to_bytes(msg)
	if b.size() <= CHUNK:
		_out(link, b, fast)
		return
	# too big for one message on the relay: send it in pieces, in order, on the reliable path
	_seq += 1
	var n := ceili(b.size() / float(CHUNK))
	for k in n:
		_out(link, var_to_bytes({ "t": "_part", "id": _seq, "k": k, "n": n, "d": b.slice(k * CHUNK, (k + 1) * CHUNK) }), false)


func _received(link: Dictionary, b: PackedByteArray) -> void:
	_received_msg(link, _decode(b))


func _received_msg(link, m) -> void:
	if link == null or role == null or not (m is Dictionary):
		return                    # a late message after leaving the crew
	link.last = now()
	var t = m.get("t")
	if t == "_part":
		var key: String = link.cid + ":" + str(m.get("id"))
		if not _chunks.has(key):
			_chunks[key] = {}
		var box: Dictionary = _chunks[key]
		box[int(m.get("k", 0))] = m.get("d", PackedByteArray())
		var n := int(m.get("n", 0))
		if box.size() < n:
			return
		_chunks.erase(key)
		var all := PackedByteArray()
		for k in n:
			if not box.has(k):
				return
			all.append_array(box[k])
		_received_msg(link, _decode(all))
		return
	if t == "_ping":
		_send_raw(link, { "t": "_pong", "ts": m.get("ts", 0.0), "rtt": link.rtt }, true)
		return
	if t == "_bye":                       # they closed the game or left the crew
		_drop(link, "left")
		return
	if t == "_busy":                      # building a world: silence is not a lost link
		link.grace = now() + float(m.get("ms", 30000))
		return
	if t == "_pong":
		var d := clampf(now() - float(m.get("ts", now())), 0.0, 1500.0)      # a frozen game (building a world) is not a slow link
		link.rtt = link.rtt * 0.7 + d * 0.3 if link.rtt else d
		if role == "guest":
			rtt = link.rtt
		return
	if role == "host":
		if t == "_hello":
			_hello(link, m)
		elif link.pid > 0:
			_emit("msg", [link.pid, m])
		elif link.relay and not link.told:  # we had let this player go
			link.told = true
			_send_raw(link, { "t": "_reject", "why": "dropped" })
	else:
		if t == "_welcome":
			link.pid = 0
			me = int(m.get("pid", -1))
			if _ask:
				_ask.close()
				_ask = null
			_emit("joined", [m])
			return
		if t == "_reject":
			_emit("rejected", [str(m.get("why", ""))])
			close()
			return
		_emit("msg", [0, m])


## Once a second: a ping to each player (for the round trip time), and a check that we still hear from them.
## When this game itself was frozen (building a world), the silence is ours: nobody is blamed for it.
func _heartbeat() -> void:
	var t := now()
	var stalled := t - _tick_at > 3000.0
	_tick_at = t
	for k in peers.keys():
		var l = peers.get(k)
		if l == null:
			continue
		if stalled:
			l.last = maxf(l.last, t)
		if l.pid < 0 and not l.relay and l.enet == null:
			continue              # still connecting
		_send_raw(l, { "t": "_ping", "ts": t }, true)
		if l.pid >= 0 and t - l.last > LOST_AFTER and t > l.grace:
			_drop(l, "lost")


func _drop(link: Dictionary, why: String) -> void:
	if not peers.has(link.cid) or not is_same(peers[link.cid], link):
		return
	peers.erase(link.cid)
	_unbind(link)
	if role == "host":
		if link.pid > 0:
			_emit("leave", [link.pid, why])
	else:
		_emit("lost", [why])


# =====================================================================
#  THE HOST
# =====================================================================
func _free_pid() -> int:
	var used := {}
	for k in peers:
		if peers[k].pid > 0:
			used[peers[k].pid] = true
	for p in range(1, MAX_GUESTS + 1):
		if not used.has(p):
			return p
	return 0


func _hello(link: Dictionary, m: Dictionary) -> void:
	if link.pid > 0:                       # said twice (both ways got through)
		_send_raw(link, { "t": "_welcome", "pid": link.pid })
		return
	var pid := _free_pid()                 # players may join at any time, also in the middle of a mission
	var v := int(m.get("v", -1))
	if pid == 0 or v != VERSION:
		_send_raw(link, { "t": "_reject", "why": "version" if v != VERSION else "full" })
		get_tree().create_timer(0.3).timeout.connect(func(): _drop(link, "rejected"))
		return
	link.pid = pid
	_send_raw(link, { "t": "_welcome", "pid": pid })
	_emit("join", [pid, m.get("hello", {}) if m.get("hello") is Dictionary else {}])


## cb(err, code): err is null once the crew is open. want: a code to use (tests), else a new one.
func host(cb: Callable, want := "") -> void:
	close()
	session += 1
	role = "host"
	me = 0
	cid = "host"
	code = clean_code(want) if clean_code(want).length() == 5 else new_code()
	_keys(code)
	_status("Opening a crew…")
	if _force != "relay":
		for i in PORTS:
			var e := ENetConnection.new()
			if e.create_host_bound("*", PORT0 + i, 8, 2) == OK:
				_enet = e
				port = PORT0 + i
				break
	if port > 0:
		mode = "direct"
		_disco_start()
		_upnp_start()
	var sess := session
	# the relay listens too, for guests who cannot reach this computer directly
	_relay_start(["/h"], func(ok: bool):
		if session != sess or role != "host" or mode != null:
			return
		if ok:
			mode = "relay"
			_beat = true
			_tick_at = now()
			cb.call(null, code)
		else:
			close()
			cb.call("load"))
	if mode == "direct":
		_beat = true
		_tick_at = now()
		cb.call_deferred(null, code)


func kick(pid: int) -> void:
	for k in peers.keys():
		if peers[k].pid == pid:
			_drop(peers[k], "kicked")


## How guests can reach this host now: on the same network, and over the internet (relay, or directly).
func reach() -> Dictionary:
	return { "lan": port > 0 and _disco != null, "relay": relay_on, "open": public_ip != "" }


# ---------- the home router: please let the crew in (UPnP), in the background ----------
func _upnp_start() -> void:
	if _force != "" or port <= 0:
		return
	var pt := port
	var th := Thread.new()
	_threads.append(th)
	th.start(func():
		var u := UPNP.new()
		if u.discover(1500, 2, "InternetGatewayDevice") != UPNP.UPNP_RESULT_SUCCESS:
			return
		var gw := u.get_gateway()
		if gw == null or not gw.is_valid_gateway():
			return
		if u.add_port_mapping(pt, pt, "Astro Outpost crew", "UDP", 7200) != UPNP.UPNP_RESULT_SUCCESS:
			return
		var ip := u.query_external_address()
		_upnp_done.call_deferred(u, ip, pt))


func _upnp_done(u: UPNP, ip: String, pt: int) -> void:
	if role == "host" and port == pt and ip != "":
		_upnp = u
		public_ip = ip
	else:
		_upnp_free(u, pt)


func _upnp_free(u: UPNP, pt: int) -> void:
	var th := Thread.new()
	_threads.append(th)
	th.start(func(): u.delete_port_mapping(pt, "UDP"))


# =====================================================================
#  A GUEST
# =====================================================================
## cb(err): err is "" once the host has welcomed this game
func join(c: String, hi: Dictionary, cb: Callable) -> void:
	close()
	session += 1
	role = "guest"
	code = clean_code(c)
	_keys(code)
	cid = "g" + _rand_id(8)
	_host_link = _new_link("host")
	peers["host"] = _host_link
	_join = { "cb": cb, "done": false, "t0": now(), "via_relay": false, "relay": "wait", "direct_gone": false, "heard": false,
		"relay_wait": 0.0, "hi": { "t": "_hello", "v": VERSION, "cid": cid, "hello": hi } }
	on["joined"] = func(_m): _finish("")
	on["rejected"] = func(why): _finish(why if why != "" else "rejected")
	_status("Looking for the crew " + code + "…")
	if _force != "relay":
		_ask_start()
	var sess := session
	# the relay gets ready in the background, in case a direct link cannot be made
	_relay_start(["/g/" + cid, "/a"], func(ok: bool):
		if session != sess or _join == null or _join.done:
			return
		_join.relay = "ok" if ok else "no"
		if ok:
			_relay_out("/h", { "f": cid, "sig": "where" })     # the host's game answers with the ways to dial it directly
		if _join.direct_gone or _force == "relay":
			if ok:
				_use_relay()
			else:
				_finish("nohost" if _join.heard else "blocked"))


func _finish(err: String) -> void:
	if _join == null or _join.done:
		return
	_join.done = true
	if _ask:
		_ask.close()
		_ask = null
	_join.cb.call(err)


func _use_relay() -> void:
	if _join == null or _join.done or _join.via_relay or _join.relay != "ok":
		return
	_join.via_relay = true
	_host_link.relay = true
	mode = "relay"
	_drop_dials()
	_status("A direct link is not possible on this network, so the game goes through the relay. Calling the host…")
	_send_raw(_host_link, _join.hi)
	_beat = true
	_tick_at = now()
	_join.relay_wait = now() + 12000.0


func _no_direct() -> void:
	if _join.direct_gone or _join.done:
		return
	_join.direct_gone = true
	if _join.relay == "ok":
		_use_relay()
	elif _join.relay == "no":
		_finish("blocked")
	else:
		_status("Still trying… calling through the relay.")


func _join_poll() -> void:
	var t: float = now() - float(_join.t0)
	if t > JOIN_WAIT or (_join.relay_wait > 0.0 and now() > _join.relay_wait):
		_finish("timeout" if _join.heard else "nohost")
		close()
		return
	if not _join.direct_gone and t > DIRECT_WAIT and _host_link and _host_link.enet == null:
		_no_direct()
	_ask_poll()


# =====================================================================
#  SENDING
# =====================================================================
## to: a player number (0 = the host). fast: may arrive out of order or not at all (positions); the rest arrives in order.
func send(pid: int, msg: Dictionary, fast := false) -> bool:
	for k in peers:
		if peers[k].pid == pid:
			_send_raw(peers[k], msg, fast)
			return true
	return false


func to_host(msg: Dictionary, fast := false) -> void:
	if _host_link:
		_send_raw(_host_link, msg, fast)


## to every guest; the ones on the relay get one shared copy
func broadcast(msg: Dictionary, fast := false, except := -1) -> void:
	var relays := 0
	for k in peers:
		var l = peers[k]
		if l.pid <= 0 or l.pid == except:
			continue
		if l.relay:
			relays += 1
		else:
			_send_raw(l, msg, fast)
	if relays:
		_send_raw({ "all": true, "x": except, "relay": true, "cid": "*" }, msg, fast)


## About to be busy for a while (building a world can hold up a slow computer for seconds): tell the others to wait.
func busy(ms := 30000) -> void:
	var t := now() + ms
	for k in peers:
		var l = peers[k]
		l.grace = maxf(l.grace, t)
		_send_raw(l, { "t": "_busy", "ms": ms })


func guests() -> Array:
	return peers.values().filter(func(l): return l.pid > 0)


func rtt_of(pid: int) -> float:
	for l in guests():
		if l.pid == pid:
			return l.rtt
	return 0.0


## how a player is linked: "direct" or "relay" (for a guest's own screen: its link to the host)
func link_of(pid: int) -> String:
	var l = null
	if role == "host":
		for g in guests():
			if g.pid == pid:
				l = g
	else:
		l = _host_link
	if l == null:
		return ""
	return "relay" if l.relay else "direct"


func close() -> void:
	_beat = false
	for k in peers:
		var l = peers[k]
		if role == "guest" or l.pid > 0:
			_send_raw(l, { "t": "_bye" })
	if _enet:
		_enet.flush()                     # the goodbye leaves first
	for k in peers:
		var p = peers[k].get("enet")
		if p:
			p.peer_disconnect_now()
	peers = {}
	_by_peer = {}
	_host_link = null
	_chunks = {}
	_drop_dials()
	_tried = {}
	if _enet:
		_enet.flush()
		_enet.destroy()
		_enet = null
	if _disco:
		_disco.close()
		_disco = null
	if _ask:
		_ask.close()
		_ask = null
	if _upnp:
		_upnp_free(_upnp, port)
		_upnp = null
	_relay_stop(300.0)
	_join = null
	role = null
	code = null
	mode = null
	rtt = 0.0
	me = -1
	port = 0
	public_ip = ""


func _process(_dt: float) -> void:
	_enet_poll()
	_relay_poll()
	if _disco:
		_disco_poll()
	if _join and not _join.done:
		_join_poll()
	if _beat and now() - _tick_at >= 1000.0:
		_heartbeat()
	for c in _closing.duplicate():
		var ws: WebSocketPeer = c[0]
		ws.poll()
		if ws.get_ready_state() == WebSocketPeer.STATE_CLOSED:
			_closing.erase(c)
		elif now() >= c[1] and ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
			ws.close()
		elif now() > c[1] + 3000.0:
			_closing.erase(c)
	for th in _threads.duplicate():
		if not th.is_alive():
			th.wait_to_finish()
			_threads.erase(th)


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST and role != null:
		close()


func _exit_tree() -> void:
	if role != null:
		close()
	for th in _threads:
		th.wait_to_finish()
	_threads.clear()
