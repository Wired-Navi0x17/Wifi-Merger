// Plexo whitepaper labs. Vanilla JS only.
function $(id) { return document.getElementById(id); }

// Lab 1: problem sliders
function probUpdate() {
  var sizeMB = Number($("probSize").value);
  var wifi = Number($("probWifi").value);
  var phone = Number($("probPhone").value);
  $("probSizeLabel").textContent = sizeMB + " MB";
  $("probWifiLabel").textContent = wifi + " Mbps";
  $("probPhoneLabel").textContent = phone + " Mbps";
  var sizeMb = sizeMB * 8;
  var tOne = wifi > 0 ? (sizeMb / wifi) / 60 : 0;
  var both = wifi + phone;
  var tTwo = both > 0 ? (sizeMb / both) / 60 : 0;
  $("timeOne").textContent = tOne.toFixed(1) + " min";
  $("timeTwo").textContent = tTwo.toFixed(1) + " min";
  var max = Math.max(tOne, tTwo, 1);
  $("barOne").style.width = Math.max(4, (tOne / max) * 100) + "%";
  $("barTwo").style.width = Math.max(4, (tTwo / max) * 100) + "%";
  if (phone === 0) {
    $("probNote").textContent = "Phone is off, so both bars match. Raise phone to see merge gain.";
  } else {
    var gain = tOne > 0 ? Math.round((1 - tTwo / tOne) * 100) : 0;
    $("probNote").textContent = "Merged paths save about " + gain + " percent here. Real gain is lower due to TCP and HTTP overhead.";
  }
}
["probSize", "probWifi", "probPhone"].forEach(function (id) {
  $(id).addEventListener("input", probUpdate);
});
probUpdate();

// Lab 2: official OSI layers, thorough network terms
var LAYERS = {
  7: {
    title: "L7 Application: HTTP, BitTorrent, DHT, DNS",
    pdu: "PDU: data and messages",
    text: "Protocols: HTTP/1.1 with Range and Content-Range, BitTorrent handshake plus bitfield plus have plus request plus piece, DHT and tracker announces, DNS names. PDU is a message like GET /file with Range: bytes=0-1023. Plexo probes with 0-1023 because HEAD lies and tiny ranges lie on some hosts. It checks 206 plus Content-Range plus ETag plus exact length. Torrent metadata comes from parse-torrent with v2 only rejected. Files: probe.ts, chunkDownloader.ts, torrent metadata.ts.",
    plexo: "Plexo home: pick byte ranges, pick peers, guard every answer before write."
  },
  6: {
    title: "L6 Presentation: TLS, certs, encoding",
    pdu: "PDU: TLS records",
    text: "Jobs: encryption, cert verify, char encoding. Plexo wraps its pinned TCP socket in TLS via RoutedHttpsAgent. It checks the cert against the URL host (SNI), caches sessions for resume, and treats a hung TLS handshake like a hung TCP SYN in the Happy Eyeballs race. No custom crypto. Content coding suffixes like gzip are stripped when comparing ETags.",
    plexo: "Plexo drives TLS but never invents crypto. Warm socket equals fast TTFB."
  },
  5: {
    title: "L5 Session: dialogs that stay open",
    pdu: "PDU: sessions and dialogs",
    text: "Jobs: open, checkpoint, resume, close. HTTP keep alive keeps one TCP session for many Range requests, so DNS plus TCP plus TLS plus slow start are paid once. BitTorrent wire holds a peer session with choke, unchoke, interested, keep alive. Electron IPC sessions carry typed calls between screen and engine. Sleep kills sessions, so wake forces reconnect.",
    plexo: "Plexo reuses sessions hard. Reconnect drops stale keep alive sockets after IP change or sleep."
  },
  4: {
    title: "L4 Transport: TCP segments, ports, windows",
    pdu: "PDU: TCP segment, UDP datagram",
    text: "TCP gives ports, seq numbers, acks, retransmit, receive window, congestion window with slow start. One stream equals one socket. Plexo runs 8 to 32 per network, doubles on health, cuts on 403, 429, 503 or silent while served. Stall watchdog is 20 s. Crawl rule is under 10 percent of median for 10 s. Backoff is 1 s doubling to 15 s with jitter. Pause fills the receive window so the sender slows with zero drops. UDP is off for bytes: uTP and WebRTC peers are disabled because UDP cannot pin like TCP.",
    plexo: "Plexo owns L4 behavior: open, race, throttle, refresh, retire."
  },
  3: {
    title: "L3 Network: IPv4, IPv6, routing, NAT",
    pdu: "PDU: packet",
    text: "IPv4 dotted plus mask, IPv6 hex, CIDR slash, longest prefix match in the routing table, gateway, NAT at home router and carrier grade NAT on mobile. Plexo reads each address family, computes subnet as IP AND mask, matches local family to remote family, resolves DNS with deadline, and on Linux pins egress with SO_BINDTODEVICE because source IP alone does not steer Linux. Same gateway on both cards equals shared bottleneck equals no gain.",
    plexo: "Plexo steers L3 path per socket. It never edits the routing table."
  },
  2: {
    title: "L2 Data Link: frames, MAC, ARP, MTU",
    pdu: "PDU: frame",
    text: "Ethernet and 802.11 Wi-Fi frames carry MAC source and dest, EtherType, payload, FCS. ARP maps IP to MAC on LAN. MTU is often 1500, which sets TCP MSS near 1460 and shapes segment size. USB tethering shows as RNDIS or ECM device. Plexo only reads adapter names and kinds plus first MAC for display. It never crafts frames and never sends ARP. Poll sees new cards each second.",
    plexo: "Plexo observes L2 to label nets. Drivers and OS own frames."
  },
  1: {
    title: "L1 Physical: bits on air and copper",
    pdu: "PDU: bits and symbols",
    text: "Modulation, coding, signal strength, cable category, USB power, interference. Phone bars and Wi-Fi RSSI live here. A weak signal shows up higher as low TCP goodput, high RTT, loss, and crawl refresh. Plexo cannot fix physics. It can only move work to the healthier path via scheduler and peer spread.",
    plexo: "Plexo adapts to L1 pain by shifting blocks and peers away from it."
  }
};
document.querySelectorAll(".layer-btn").forEach(function (btn) {
  btn.addEventListener("click", function () {
    document.querySelectorAll(".layer-btn").forEach(function (b) { b.classList.remove("active"); });
    btn.classList.add("active");
    var info = LAYERS[btn.getAttribute("data-layer")];
    $("layerTitle").textContent = info.title;
    $("layerPdu").textContent = info.pdu;
    $("layerText").textContent = info.text;
    $("layerPlexo").textContent = info.plexo;
  });
});

// Lab 3: encapsulation wraps
var ENCAP = [
  ["L7 HTTP data", "GET /big.iso plus Range: bytes=8000000-15999999 plus Cookie plus Referer. Unit: message.", "#4f46e5"],
  ["L6 TLS record", "Wrap in TLS record with auth tag. Add SNI cdn.example.com. Unit: record.", "#7c3aed"],
  ["L4 TCP segment", "Add sport, dport 443, seq, ack, window. MSS near 1460 from MTU 1500. Unit: segment.", "#059669"],
  ["L3 IP packet", "Add src 192.168.1.5, dst 93.184.216.34, TTL, proto TCP. Longest prefix picks wlan0. Unit: packet.", "#ea580c"],
  ["L2 Wi-Fi frame", "Add Wi-Fi header plus MACs plus FCS. ARP already mapped gateway MAC. Unit: frame.", "#0284c7"],
  ["L1 bits", "Modulate to radio symbols on channel. Unit: bits. Loss here returns as TCP retransmit at L4.", "#be123c"]
];
var encIdx = 0;
function encPaint(msg) {
  var box = $("encapStack");
  box.innerHTML = "";
  for (var i = 0; i < encIdx; i++) {
    var d = document.createElement("div");
    d.className = "encap-row";
    d.style.background = ENCAP[i][2] + "22";
    d.style.borderColor = ENCAP[i][2];
    d.textContent = ENCAP[i][0] + " | " + ENCAP[i][1];
    box.appendChild(d);
  }
  $("encapNote").textContent = msg || ("Wrapped " + encIdx + " of 6. Decap is reverse on receive.");
}
$("encNext").addEventListener("click", function () {
  if (encIdx < ENCAP.length) { encIdx++; }
  encPaint();
});
$("encPrev").addEventListener("click", function () {
  if (encIdx > 0) { encIdx--; }
  encPaint();
});
$("encReset").addEventListener("click", function () { encIdx = 0; encPaint("Start: pure HTTP data at L7."); });
encPaint("Start: pure HTTP data at L7. Press Wrap next layer.");

// Plug demo
var phoneOn = true;
function netPaint() {
  var card = $("netPhone");
  var pill = card.querySelector(".pill");
  if (phoneOn) {
    card.classList.remove("off");
    pill.textContent = "on";
    pill.className = "pill on";
    $("netNote").textContent = "Both on with own gateway, so merge gain is real. Same gateway would mean shared pipe.";
  } else {
    card.classList.add("off");
    pill.textContent = "off, unplugged";
    pill.className = "pill off";
    $("netNote").textContent = "Phone gone. Its streams retire. Written bytes stay. Frontier never moves back except on overlap trim.";
  }
}
$("btnUnplug").addEventListener("click", function () { phoneOn = false; netPaint(); });
$("btnReplug").addEventListener("click", function () { phoneOn = true; netPaint(); });

// Packet life 8 steps
var PKT = [
  ["1 DNS ask", "DNS lookup for cdn.example.com with all:true and deadline. A and AAAA return. Literal IP skips DNS."],
  ["2 Family match", "routesFor keeps only pairs where local family equals remote family. Else NoCompatibleRoute for that net."],
  ["3 Pinned SYN", "Linux: socket plus SO_BINDTODEVICE wlan0 plus localAddress. Mac and Win: localAddress is enough."],
  ["4 Eyeballs race", "v4 and v6 start 250 ms apart. First connect or secureConnect wins. Winner cached in lastGoodRoute."],
  ["5 TLS lock", "ClientHello with SNI, cert check vs host, session resume on warm socket. Hung TLS loses like hung TCP."],
  ["6 Range ask", "GET path plus Range plus Cookie scoped per hop plus Referer plus UA. Reuse keep alive lane if free."],
  ["7 Strict check", "Need 206, Content-Range start equals ask, end inside ask, ETag match, exact byte count. Else fail and requeue."],
  ["8 Offset write", "Write at rangeStart plus offset with r+ start. Throttle via limits.take. Fsync on checkpoint. Rename .plexo at end."]
];
var pktIdx = 0;
function pktPaint() {
  $("packetView").textContent = "Step " + (pktIdx + 1) + " of 8: " + PKT[pktIdx][0];
  $("packetText").textContent = PKT[pktIdx][1];
  var dots = $("pktDots");
  dots.innerHTML = "";
  for (var i = 0; i < PKT.length; i++) {
    var d = document.createElement("span");
    d.className = "dot" + (i === pktIdx ? " on" : "");
    dots.appendChild(d);
  }
}
$("pktNext").addEventListener("click", function () { pktIdx = (pktIdx + 1) % PKT.length; pktPaint(); });
$("pktPrev").addEventListener("click", function () { pktIdx = (pktIdx + PKT.length - 1) % PKT.length; pktPaint(); });
pktPaint();

// Splitter
function splitCalc() {
  var sizeMB = Number($("splitSize").value);
  var nets = Number($("splitNet").value);
  $("splitSizeLabel").textContent = sizeMB;
  $("splitNetLabel").textContent = nets;
  var totalBytes = sizeMB * 1024 * 1024;
  var target = nets * 32 * 2;
  var raw = Math.ceil(totalBytes / target);
  var min = 1 * 1024 * 1024;
  var max = 8 * 1024 * 1024;
  var blockSize = Math.min(Math.max(raw, min), max);
  var count = Math.ceil(totalBytes / blockSize);
  if (count > 96) { count = 96; }
  $("splitInfo").textContent = "Target " + target + " blocks. Block " + (blockSize / 1048576).toFixed(1) + " MB. Showing " + count + ".";
  var box = $("splitBlocks");
  box.innerHTML = "";
  var names = ["wifi", "phone", "extra", "extra"];
  for (var i = 0; i < count; i++) {
    var el = document.createElement("div");
    el.className = "block " + names[i % nets];
    el.textContent = i + 1;
    box.appendChild(el);
  }
}
var splitTimer = null;
$("splitSize").addEventListener("input", splitCalc);
$("splitNet").addEventListener("input", splitCalc);
splitCalc();
$("splitPlay").addEventListener("click", function () {
  var cells = Array.prototype.slice.call(document.querySelectorAll("#splitBlocks .block"));
  cells.forEach(function (c) { c.classList.remove("done"); });
  var i = 0;
  clearInterval(splitTimer);
  splitTimer = setInterval(function () {
    if (i >= cells.length) { clearInterval(splitTimer); return; }
    for (var k = 0; k < 3 && i < cells.length; k++, i++) { cells[i].classList.add("done"); }
  }, 150);
});
$("splitReset").addEventListener("click", function () {
  clearInterval(splitTimer);
  document.querySelectorAll("#splitBlocks .block").forEach(function (c) { c.classList.remove("done"); });
});

// Hedge race
var raceTimer = null;
$("racePlay").addEventListener("click", function () {
  var slow = 0, fast = 0;
  var slowEl = $("raceSlow"), fastEl = $("raceFast");
  slowEl.style.width = "0%"; fastEl.style.width = "0%";
  $("raceNote").textContent = "Running: slow holder crawls, hedge starts late but runs fast.";
  clearInterval(raceTimer);
  var tick = 0;
  raceTimer = setInterval(function () {
    tick++;
    slow += 2.2;
    if (tick > 8) { fast += 9; }
    if (slow > 100) { slow = 100; }
    if (fast > 100) { fast = 100; }
    slowEl.style.width = slow + "%";
    fastEl.style.width = fast + "%";
    if (fast >= 100 || slow >= 100) {
      clearInterval(raceTimer);
      var win = fast >= 100 && fast >= slow ? "hedge" : "slow holder";
      $("raceNote").textContent = "Winner: " + win + ". Loser aborted as lost. Frontier counts once.";
    }
  }, 130);
});

// Peers
var peerCount = 0;
var wifiPeers = [], phonePeers = [];
function peerPaint(list, elId) {
  var el = $(elId);
  el.innerHTML = "";
  list.forEach(function (n) {
    var s = document.createElement("span");
    s.className = "peer-dot";
    s.textContent = n;
    el.appendChild(s);
  });
}
$("peerAdd").addEventListener("click", function () {
  peerCount++;
  if (wifiPeers.length <= phonePeers.length) { wifiPeers.push(peerCount); }
  else { phonePeers.push(peerCount); }
  peerPaint(wifiPeers, "peerWifi");
  peerPaint(phonePeers, "peerPhone");
});
$("peerReset").addEventListener("click", function () {
  wifiPeers = []; phonePeers = []; peerCount = 0;
  peerPaint([], "peerWifi"); peerPaint([], "peerPhone");
});

// Merge lab: 12 blocks
var mergeState = [];
function mergeBuild() {
  var box = $("mergeFile");
  box.innerHTML = "";
  mergeState = [];
  for (var i = 0; i < 12; i++) {
    var owner = i % 2 === 0 ? "w" : "p";
    mergeState.push({ owner: owner, done: false, overlap: false });
    var c = document.createElement("div");
    c.className = "mcell";
    c.textContent = "B" + (i + 1);
    c.id = "mcell" + i;
    box.appendChild(c);
  }
  mergeStats();
}
function mergeStats() {
  var done = mergeState.filter(function (m) { return m.done; }).length;
  var w = mergeState.filter(function (m) { return m.done && m.owner === "w"; }).length;
  var p = mergeState.filter(function (m) { return m.done && m.owner === "p"; }).length;
  $("mergeFront").textContent = done;
  $("mergeWifi").textContent = w + " blocks";
  $("mergePhone").textContent = p + " blocks";
  for (var i = 0; i < 12; i++) {
    var c = $("mcell" + i);
    c.className = "mcell";
    if (mergeState[i].done) {
      c.classList.add(mergeState[i].owner === "w" ? "w" : "p");
    }
    if (mergeState[i].overlap) { c.classList.add("both"); }
  }
}
mergeBuild();
var mergeTimer = null;
$("mergePlay").addEventListener("click", function () {
  mergeBuild();
  $("mergeNote").textContent = "Merging: even to Wi-Fi, odd to phone. Order on disk is still B1 to B12 by offset.";
  var i = 0;
  clearInterval(mergeTimer);
  mergeTimer = setInterval(function () {
    if (i >= 12) { clearInterval(mergeTimer); $("mergeNote").textContent = "Done. 12 blocks, 6 plus 6. Sum equals frontier. Zero overlap."; return; }
    mergeState[i].done = true;
    mergeState[i].overlap = false;
    i++;
    mergeStats();
  }, 260);
});
$("mergeOverlap").addEventListener("click", function () {
  mergeBuild();
  var order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10];
  var i = 0;
  clearInterval(mergeTimer);
  $("mergeNote").textContent = "Hedge test: B11 fetched twice. Second copy is overlap. Frontier stays 11 until B12 lands.";
  mergeTimer = setInterval(function () {
    if (i >= order.length) {
      clearInterval(mergeTimer);
      $("mergeNote").textContent = "Overlap counted once. Frontier equals max, not sum. Loser aborted as lost.";
      return;
    }
    var idx = order[i];
    if (mergeState[idx].done) { mergeState[idx].overlap = true; }
    else { mergeState[idx].done = true; }
    i++;
    mergeStats();
  }, 320);
});

// Torrent pieces lab
function torrentBuild() {
  var box = $("torrentPieces");
  box.innerHTML = "";
  for (var i = 0; i < 16; i++) {
    var el = document.createElement("div");
    el.className = "block prov";
    el.textContent = "P" + (i + 1);
    el.id = "tp" + i;
    box.appendChild(el);
  }
}
torrentBuild();
$("torrentPlay").addEventListener("click", function () {
  torrentBuild();
  $("torrentNote").textContent = "Receiving grey provisional bytes from both nets...";
  var i = 0;
  var t = setInterval(function () {
    if (i >= 16) {
      clearInterval(t);
      $("torrentNote").textContent = "Hash verified. Colors lock. If a hash failed, grey would drop to zero and refetch.";
      return;
    }
    var el = $("tp" + i);
    el.classList.remove("prov");
    el.classList.add(i % 2 === 0 ? "wifi" : "phone");
    el.classList.add("done");
    i++;
  }, 220);
});

// Conflicts grid
var CONFS = [
  {
    tag: "L3 subnet clash",
    title: "Same subnet on both cards",
    body: "Cause: Wi-Fi 192.168.1.5/24 and phone 192.168.1.27/24 share 192.168.1.0/24. Sign: UI same subnet warning. Risk: both exits may hit one upstream NAT, gain near zero, ARP flux. Fix: Plexo still runs but warns. Prefer distinct subnets like 192.168.1.0/24 plus 192.168.42.0/24. Code: ipv4Subnet plus NewDownloadDialog subnet check."
  },
  {
    tag: "L3 shared pipe",
    title: "Same gateway, no independent path",
    body: "Cause: Wi-Fi plus Ethernet to one home router. One public IP, one ISP cap. Sign: total equals single speed. Fix: Plexo cannot invent capacity. Use phone data with own gateway 192.168.42.129. README states this limit plainly."
  },
  {
    tag: "L3 family split",
    title: "IPv4 only net vs IPv6 only host",
    body: "Cause: tether has v4 only, server AAAA only. routesFor yields zero routes. Sign: NoCompatibleRouteError for that net. Fix: skip that net for this host, keep it for dual hosts. No retry storm."
  },
  {
    tag: "L3 mobility",
    title: "IP change mid flight",
    body: "Cause: DHCP renew or phone reconnect swaps 192.168.1.5 to 192.168.1.9. Sockets bound to old IP die. Sign: stall plus moved set in networksChanged. Fix: wake with reconnect true drops dead keep alive lanes, frontier bytes stay, fresh SYN uses new source. Same idea as browser ERR_NETWORK_CHANGED."
  },
  {
    tag: "L7 version fork",
    title: "ETag or size change mid file",
    body: "Cause: server republishes file. Next 206 carries new ETag or new total. Sign: RemoteChangedError. Fix: size diff equals proof, fail fast and discard. Validator diff equals hint, so refetch 8 by 16 KiB and byte compare. Same bytes under new label are accepted, else fail all workers at once."
  },
  {
    tag: "L7 duplicate work",
    title: "Hedge double fetch",
    body: "Cause: two attempts write same block range. Naive sum would count twice and publish short. Fix: frontier max via advanceBlock, tail trim via retractBlock with blamed net first, loser abort as lost. bytesByInterface always sums to bytesDownloaded."
  },
  {
    tag: "Local port clash",
    title: "Bridge 19288 busy",
    body: "Cause: another app holds 19288. Browser POST would hit wrong app. Fix: try 19288, 19289, 19290 in order. Check Host header equals 127.0.0.1 plus port to stop DNS rebinding. Check Origin is extension plus JSON content type. Token expires in 15 s unconfirmed."
  },
  {
    tag: "Disk clash",
    title: "File name plus sparse plus cap",
    body: "Cause: big.iso exists, or NTFS gap fill doubles writes, or two downloads share disk. Fix: reserve free name with (1) loop up to 10000, skip taken .plexo, stage beside final for atomic rename. Mark sparse via FSCTL_SET_SPARSE on Windows. DiskWatch halves streams when majority held over 500 ms. Limits share 32 streams across concurrent downloads."
  }
];
function confBuild() {
  var grid = $("confGrid");
  grid.innerHTML = "";
  CONFS.forEach(function (c, idx) {
    var card = document.createElement("div");
    card.className = "conf-card";
    card.innerHTML = '<span class="conf-tag">' + c.tag + '</span><h4>' + (idx + 1) + ". " + c.title + "</h4>" + '<div class="conf-body"><p>' + c.body + "</p></div>";
    card.addEventListener("click", function () { card.classList.toggle("open"); });
    grid.appendChild(card);
  });
}
confBuild();

// Subnet clash checker
function ipToInt(ip) {
  var p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(function (n) { return !(n >= 0 && n <= 255); })) { return null; }
  return ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3];
}
$("cfgCheck").addEventListener("click", function () {
  function parse(s) {
    var parts = s.split("/");
    if (parts.length !== 2) { return null; }
    var ip = ipToInt(parts[0].trim());
    var bits = Number(parts[1]);
    if (ip === null || !(bits >= 0 && bits <= 32)) { return null; }
    var mask = bits === 0 ? 0 : (Math.pow(2, 32) - Math.pow(2, 32 - bits));
    return { net: (ip & mask) >>> 0, bits: bits };
  }
  var a = parse($("cfgA").value), b = parse($("cfgB").value);
  if (!a || !b) { $("cfgOut").textContent = "Bad format. Use like 192.168.1.5/24."; return; }
  if (a.net === b.net && a.bits === b.bits) {
    $("cfgOut").textContent = "CLASH: same subnet. Expect warning and likely no gain. Change one side to another /24.";
  } else {
    $("cfgOut").textContent = "OK: distinct subnets. Paths look independent at L3. Gain is plausible if gateways differ too.";
  }
});

// Bucket
$("bucketRate").addEventListener("input", function () {
  $("bucketLabel").textContent = $("bucketRate").value + " MB/s";
});
$("bucketSend").addEventListener("click", function () {
  var rateMB = Number($("bucketRate").value);
  var burstMB = 5;
  var waitSec = Math.max(0, burstMB - rateMB) / rateMB;
  var fill = $("bucketFill");
  fill.style.width = "100%";
  $("bucketNote").textContent = "Burst 5 MB at " + rateMB + " MB/s. Pause about " + waitSec.toFixed(1) + " s. Receive window fills, sender slows, zero loss.";
  setTimeout(function () { fill.style.width = "20%"; }, 900);
});

// Bridge
var bridgeTexts = [
  "Ping ok: app plexo api 1 on 127.0.0.1:19288. Bad Host gets 403. Bad Origin gets 403. Non JSON POST gets 415.",
  "Add ok: probe with 8 s deadline, token held 15 s. Small file rule and fail match attached. No UI yet.",
  "Confirm ok: browser erased its copy first, then POST confirm. Now UI shows link. Expired token gets 410, never double."
];
document.querySelectorAll(".bstep").forEach(function (b) {
  b.addEventListener("click", function () {
    document.querySelectorAll(".bstep").forEach(function (x) { x.classList.remove("done"); });
    var idx = Number(b.getAttribute("data-b"));
    var all = document.querySelectorAll(".bstep");
    for (var i = 0; i <= idx; i++) { all[i].classList.add("done"); }
    $("bridgeNote").textContent = bridgeTexts[idx];
  });
});

$("toTop").addEventListener("click", function (e) {
  e.preventDefault();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
