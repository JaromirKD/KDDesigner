#include "Net.h"
#include <EthernetUdp.h>
#include <events/mbed_shared_queues.h>
#include "stm32xx_emac.h"
#include "Config.h"
#include "Log.h"

namespace {
const uint16_t kArtPort = 6454;
const uint16_t kSacnPort = 5568;

// ---- Link and address ----------------------------------------------------------------
// Arduino's Ethernet.linkStatus() only says whether the interface has an address, so "no
// DHCP answer" looked like "cable not connected". The cable link is read from the PHY chip
// (LAN8742, address 0) instead, on Mbed's shared event queue: the Ethernet driver polls the
// chip from that thread too, so the two never talk to it at the same time.
volatile int8_t cable = -1;   // -1 not read yet, 0 no link, 1 link
void readPhy() {
  ETH_HandleTypeDef* h = &STM32_EMAC::get_instance().EthHandle;
  uint32_t v = 0;
  HAL_ETH_ReadPHYRegister(h, 0, 1, &v);   // the link bit latches low: the first read clears it
  if (HAL_ETH_ReadPHYRegister(h, 0, 1, &v) == HAL_OK && v != 0xffff) cable = (v & 4) ? 1 : 0;
}
void askPhy() { mbed::mbed_event_queue()->call(readPhy); }

// The same interface Arduino's Ethernet object uses (the core makes it this way).
EthernetInterface* eth() { return static_cast<EthernetInterface*>(EthInterface::get_default_instance()); }
bool hasAddress() { return eth()->get_connection_status() == NSAPI_STATUS_GLOBAL_UP; }
SocketAddress sockAddr(IPAddress a) {
  uint8_t b[4] = {a[0], a[1], a[2], a[3]};
  return SocketAddress(b, NSAPI_IPv4);
}

NetConfig want;               // from the project
bool onFallback = false;      // DHCP wanted but nobody answered: on KD_FALLBACK_IP
bool dhcpTrying = false;      // switched to DHCP after an OFFER (no address meanwhile)
uint32_t tryStart = 0, nextTry = 0, notUpSince = 0, lastPhy = 0;
int8_t lastCable = -1;
IPAddress lastIp;
uint8_t mac[6];

IPAddress fixedIp() { return want.dhcp ? IPAddress(KD_FALLBACK_IP) : want.ip; }
IPAddress fixedMask() { return want.dhcp ? IPAddress(KD_FALLBACK_MASK) : want.mask; }
IPAddress fixedGw() { return want.dhcp ? IPAddress(KD_FALLBACK_GW) : want.gateway; }

// Fixed (or fallback) address without waiting. Disconnect first: a connect() while the
// DHCP one is still running is ignored, which is why the fallback never took before.
void useFixed() {
  EthernetInterface* e = eth();
  e->disconnect();
  e->set_dhcp(false);
  e->set_network(sockAddr(fixedIp()), sockAddr(fixedMask()), sockAddr(fixedGw()));
  e->set_blocking(false);
  e->connect();
}

// While on the fallback a DHCP DISCOVER is sent now and then from port 68, keeping the
// address (asking lwIP for DHCP again would leave the controller without one for up to 10 s
// each time: everything dropped off the network). Only when a server OFFERs is the
// interface switched to DHCP.
EthernetUDP probe;
bool probeOpen = false;
uint32_t probeXid = 0;
void closeProbe() { if (probeOpen) probe.stop(); probeOpen = false; }
void sendDiscover(uint32_t now) {
  if (!probeOpen) probeOpen = probe.begin(68);
  if (!probeOpen) return;
  uint8_t p[300] = {0};                          // BOOTP minimum size
  p[0] = 1; p[1] = 1; p[2] = 6;                  // request, Ethernet, 6-byte MAC
  probeXid = 0x4B440000 ^ (now & 0xffff) ^ (mac[5] << 16);
  p[4] = probeXid >> 24; p[5] = probeXid >> 16; p[6] = probeXid >> 8; p[7] = probeXid;
  p[10] = 0x80;                                  // broadcast flag: answer to 255.255.255.255
  memcpy(p + 28, mac, 6);
  const uint8_t opts[] = {99, 130, 83, 99, 53, 1, 1, 55, 2, 1, 3, 255};   // cookie, DISCOVER, ask mask/router
  memcpy(p + 236, opts, sizeof(opts));
  probe.beginPacket(IPAddress(255, 255, 255, 255), 67);
  probe.write(p, sizeof(p));
  probe.endPacket();
}
// An OFFER for our DISCOVER: returns the server's address.
bool offerSeen(IPAddress& server) {
  if (!probeOpen) return false;
  uint8_t p[300];
  bool seen = false;
  while (probe.parsePacket() > 0) {
    int n = probe.read(p, sizeof(p));
    probe.flush();
    if (n < 243 || p[0] != 2 || memcmp(p + 28, mac, 6) != 0) continue;
    uint32_t xid = ((uint32_t)p[4] << 24) | (p[5] << 16) | (p[6] << 8) | p[7];
    if (xid != probeXid || p[236] != 99 || p[237] != 130) continue;
    for (int i = 240; i + 2 < n && p[i] != 255;) {   // option 53 = message type, 2 = OFFER
      if (p[i] == 0) { i++; continue; }
      if (p[i] == 53 && p[i + 2] == 2) { seen = true; server = probe.remoteIP(); }
      i += 2 + p[i + 1];
    }
  }
  return seen;
}

// Switches the interface to DHCP; maintain() goes back to the fallback after 10 s.
void tryDhcp(uint32_t now) {
  closeProbe();   // lwIP's DHCP client needs port 68
  EthernetInterface* e = eth();
  e->disconnect();
  e->set_dhcp(true);
  e->set_blocking(false);
  e->connect();
  dhcpTrying = true;
  tryStart = now;
}

// A DISCOVER every 30 s costs nothing (one small broadcast), so a router that comes back,
// or boots slower than the controller after a power cut, is found within half a minute.
void scheduleTry(uint32_t now) { nextTry = now + 30000; }

// beginMulticast is protected in MbedUDP; the sACN socket joins a group for DMX input.
struct McastUDP : public EthernetUDP {
  using MbedUDP::beginMulticast;
};

EthernetUDP artUdp;
McastUDP sacnUdp;
bool isUp = false;

struct DmxIn {
  bool sacn = false;
  uint16_t universe = 0;
  uint32_t frames = 0;
  uint8_t data[512];
};
DmxIn dmxIns[KD_MAX_DMX_IN];
int dmxInCount = 0;
uint16_t sacnGroup = 0, sacnJoined = 0;   // wanted / joined multicast universe (0 = none)
uint8_t rx[18 + 512];                     // Art-Net OpDmx is the biggest packet we read

// Stores a received frame for every DMX input that listens to this universe.
void storeIn(bool sacn, uint16_t universe, const uint8_t* data, int len) {
  for (int i = 0; i < dmxInCount; i++) {
    DmxIn& d = dmxIns[i];
    if (d.sacn != sacn || d.universe != universe) continue;
    int n = constrain(len, 0, 512);
    memcpy(d.data, data, n);
    if (n < 512) memset(d.data + n, 0, 512 - n);
    d.frames++;
  }
}

// Mbed's STM32 Ethernet driver ignores multicast joins (add_multicast_group does nothing),
// so the MAC's own filter kept dropping sACN multicast: only unicast sACN reached the
// socket. Let the group's MAC address 01:00:5e:7f:hi:lo through the hash filter (bin =
// top 6 bits of the bit-reversed CRC-32 of the address, as in Linux' dwmac4 driver). Only
// that bin passes, not all multicast, so other consoles' universes don't load the CPU.
void macAcceptGroup(uint16_t universe) {
  const uint8_t m[6] = {0x01, 0x00, 0x5e, 0x7f, (uint8_t)(universe >> 8), (uint8_t)(universe & 0xff)};
  uint32_t crc = 0xffffffff;
  for (uint8_t b : m) {
    crc ^= b;
    for (int i = 0; i < 8; i++) crc = (crc >> 1) ^ (0xEDB88320 & (0 - (crc & 1)));
  }
  crc = ~crc;
  uint32_t bin = 0;
  for (int i = 0; i < 6; i++) if (crc & (1u << i)) bin |= 1u << (5 - i);
  if (bin >= 32) ETH->MACHT1R |= 1u << (bin - 32);
  else ETH->MACHT0R |= 1u << bin;
  ETH->MACPFR |= ETH_MACPFR_HMC;
}

// The sACN socket is also the output socket: reopen it on the main thread only,
// when the multicast group for DMX input changes.
void joinSacn() {
  if (sacnGroup == sacnJoined) return;
  sacnUdp.stop();
  bool ok = sacnGroup ? sacnUdp.beginMulticast(IPAddress(239, 255, sacnGroup >> 8, sacnGroup & 0xff), kSacnPort) : sacnUdp.begin(kSacnPort);
  if (sacnGroup && !ok) { LOGW(Sacn, "Cannot join sACN universe %u (multicast) - only unicast sACN is received", sacnGroup); sacnUdp.begin(kSacnPort); }
  else if (sacnGroup) {
    uint32_t before = ETH->MACPFR;
    macAcceptGroup(sacnGroup);
    LOGI(Sacn, "Receiving sACN universe %u for DMX input (MAC filter %08lx -> %08lx, hash %08lx %08lx)", sacnGroup,
         (unsigned long)before, (unsigned long)ETH->MACPFR, (unsigned long)ETH->MACHT1R, (unsigned long)ETH->MACHT0R);
  }
  sacnJoined = sacnGroup;
}
uint8_t artSeq[256];           // sequence counter per (low byte of) port address
uint8_t sacnSeq[KD_MAX_UNIVERSES * 16];
uint8_t cid[16];
uint8_t pkt[640];

void put16be(uint8_t* p, uint16_t v) { p[0] = v >> 8; p[1] = v & 0xff; }

void sendPollReply(IPAddress to) {
  memset(pkt, 0, 239);
  memcpy(pkt, "Art-Net", 8);
  pkt[8] = 0x00; pkt[9] = 0x21;                      // OpPollReply
  IPAddress ip = Ethernet.localIP();
  for (int i = 0; i < 4; i++) pkt[10 + i] = ip[i];
  pkt[14] = kArtPort & 0xff; pkt[15] = kArtPort >> 8;
  pkt[16] = 0; pkt[17] = 1;                          // firmware version
  pkt[20] = 0x00; pkt[21] = 0xff;                    // OEM unknown
  pkt[23] = 0xd0;                                    // Status1: normal indicators, network-configured
  strncpy((char*)pkt + 26, "KD Designer", 17);
  strncpy((char*)pkt + 44, "KD Designer show controller (Portenta H7)", 63);
  strncpy((char*)pkt + 108, "#0001 [0000] Running", 63);
  pkt[173] = 1;                                      // one port
  pkt[174] = 0x40;                                   // port can input DMX into Art-Net
  pkt[178] = 0x80;                                   // data received
  pkt[200] = 0x00;                                   // StNode
  memcpy(pkt + 201, mac, 6);
  for (int i = 0; i < 4; i++) pkt[207 + i] = ip[i];
  pkt[211] = 1;
  pkt[212] = 0x08;                                   // Status2: supports 15-bit port address
  artUdp.beginPacket(to, kArtPort);
  artUdp.write(pkt, 239);
  artUdp.endPacket();
  Net::counters.pollReplies++;
}
}  // namespace

namespace Net {
Counters counters = {};

void begin(const NetConfig& cfg) {
  want = cfg;
  int ok = 0;
  if (cfg.dhcp) {
    LOGI(Net, "Requesting DHCP lease...");
    ok = Ethernet.begin(nullptr, 10000);
  }
  // The PHY is only powered once begin() ran; give the event queue a moment to read it.
  askPhy();
  for (int i = 0; i < 20 && cable < 0; i++) delay(5);
  IPAddress fip = fixedIp();
  if (!ok) {
    Ethernet.disconnect();
    // A short wait: with no cable the address comes up by itself once the link does.
    Ethernet.begin(nullptr, fip, fixedGw(), fixedGw(), fixedMask(), 3000);
  }
  if (cable == 0)
    LOGW(Net, "No Ethernet link: check the cable, the switch port and its link light. Address %s once the link is there%s",
         fip.toString().c_str(), cfg.dhcp ? " (DHCP is asked again first)" : "");
  else if (cfg.dhcp && !ok)
    LOGW(Net, "Cable OK, but no DHCP answer (is the router / DHCP server on?): using the fallback address %s, and switching to DHCP when a server answers",
         fip.toString().c_str());
  onFallback = cfg.dhcp && !ok;
  scheduleTry(millis());
  lastCable = cable;
  lastIp = Ethernet.localIP();

  Ethernet.macAddress(mac);
  // Stable sACN CID derived from the MAC address (RFC 4122 v4 layout).
  for (int i = 0; i < 16; i++) cid[i] = mac[i % 6] ^ (uint8_t)(0x4b + i * 37);
  cid[6] = (cid[6] & 0x0f) | 0x40;
  cid[8] = (cid[8] & 0x3f) | 0x80;

  artUdp.begin(kArtPort);
  sacnUdp.begin(kSacnPort);
  isUp = true;
  IPAddress ip = Ethernet.localIP();
  LOGI(Net, "IP %d.%d.%d.%d  MAC %02X:%02X:%02X:%02X:%02X:%02X", ip[0], ip[1], ip[2], ip[3], mac[0],
       mac[1], mac[2], mac[3], mac[4], mac[5]);
}

void maintain(uint32_t now) {
  if (!isUp || now - lastPhy < 1000) return;
  lastPhy = now;
  askPhy();   // read now, used next second
  if (sacnJoined) macAcceptGroup(sacnJoined);   // in case the driver re-initialised the MAC
  int8_t c = cable;
  if (c != lastCable && lastCable >= 0) {
    if (c) LOGI(Net, "Ethernet cable connected");
    else LOGW(Net, "Ethernet cable disconnected (or the switch went off)");
    if (c && onFallback && !dhcpTrying) nextTry = now;   // a DHCP server may be there now
  }
  lastCable = c;

  bool upNow = hasAddress();
  IPAddress server;
  if (dhcpTrying) {
    if (upNow) {
      dhcpTrying = onFallback = false;
    } else if (now - tryStart > 10000) {
      // Offered, but the lease didn't complete: back to the fallback, and wait longer
      // before the next switch so a half-working server can't drop the network every minute.
      LOGW(Net, "No DHCP lease after 10 s: back to the fallback %s", fixedIp().toString().c_str());
      dhcpTrying = false;
      onFallback = true;
      useFixed();
      nextTry = now + 600000;
    }
  } else if (onFallback && offerSeen(server)) {
    LOGI(Net, "DHCP server %s answers: switching from the fallback to DHCP", server.toString().c_str());
    tryDhcp(now);
  } else if (onFallback && c == 1 && (int32_t)(now - nextTry) >= 0) {
    sendDiscover(now);
    scheduleTry(now);
  } else if (c == 1 && !upNow) {
    // Cable in but no address for 15 s (a lost DHCP lease, or the stack didn't come back
    // after the link returned): DHCP again (falls back after 10 s) or the fixed address.
    if (!notUpSince) notUpSince = now;
    else if (now - notUpSince > 15000) {
      notUpSince = 0;
      if (want.dhcp) {
        LOGW(Net, "No network address: asking DHCP again");
        tryDhcp(now);
      } else useFixed();
    }
  }
  if (upNow || c != 1) notUpSince = 0;

  IPAddress ip = Ethernet.localIP();
  if (ip != lastIp) {
    lastIp = ip;
    if (ip != IPAddress(0, 0, 0, 0))
      LOGI(Net, "Network address now %s (%s)", ip.toString().c_str(), onFallback ? "fallback - no DHCP answer" : want.dhcp ? "DHCP" : "fixed");
  }
}

bool up() { return isUp; }
IPAddress localIP() { return Ethernet.localIP(); }
void macAddress(uint8_t out[6]) { memcpy(out, mac, 6); }

void poll() {
  if (!isUp) return;
  int len;
  IPAddress self = Ethernet.localIP();
  while ((len = artUdp.parsePacket()) > 0) {
    // Only DMX inputs need the whole packet; otherwise the header is enough.
    int n = artUdp.read(rx, dmxInCount ? sizeof(rx) : 12);
    artUdp.flush();
    counters.artRx++;
    if (n < 10 || memcmp(rx, "Art-Net", 8) != 0) continue;
    uint16_t op = rx[8] | (rx[9] << 8);
    if (op == 0x5000 && n >= 18 && dmxInCount && artUdp.remoteIP() != self) {   // OpDmx
      int dl = (rx[16] << 8) | rx[17];
      storeIn(false, rx[14] | ((rx[15] & 0x7f) << 8), rx + 18, min(dl, n - 18));
    } else if (op == 0x2000) {  // OpPoll
      LOGD(ArtNet, "ArtPoll from %s", artUdp.remoteIP().toString().c_str());
      IPAddress ip = Ethernet.localIP();
      IPAddress mask = Ethernet.subnetMask();
      IPAddress bcast(ip[0] | ~mask[0], ip[1] | ~mask[1], ip[2] | ~mask[2], ip[3] | ~mask[3]);
      sendPollReply(bcast);
    }
  }
  joinSacn();
  while ((len = sacnUdp.parsePacket()) > 0) {
    int n = sacnUdp.read(pkt, sizeof(pkt));
    sacnUdp.flush();
    counters.sacnRx++;
    // E1.31 data packet with a DMX start code, from another device.
    if (!dmxInCount || n < 126 || memcmp(pkt + 4, "ASC-E1.17", 9) != 0 || pkt[21] != 0x04 || pkt[43] != 0x02 || pkt[125] != 0) continue;
    if (sacnUdp.remoteIP() == self) continue;
    int count = ((pkt[123] << 8) | pkt[124]) - 1;
    storeIn(true, (pkt[113] << 8) | pkt[114], pkt + 126, min(count, n - 126));
  }
}

void setDmxInputs(const bool* sacn, const uint16_t* universes, int n) {
  dmxInCount = 0;
  sacnGroup = 0;
  for (int i = 0; i < n && dmxInCount < KD_MAX_DMX_IN; i++) {
    DmxIn& d = dmxIns[dmxInCount++];
    d.sacn = sacn[i];
    d.universe = universes[i];
    d.frames = 0;
    if (d.sacn && !sacnGroup && d.universe >= 1 && d.universe <= 63999) sacnGroup = d.universe;
  }
}

const uint8_t* dmxIn(int i, uint32_t& frames) {
  if (i < 0 || i >= dmxInCount) { frames = 0; return nullptr; }
  frames = dmxIns[i].frames;
  return frames ? dmxIns[i].data : nullptr;
}

void sendArtDmx(uint16_t portAddress, const uint8_t* data512, IPAddress dest) {
  if (!isUp) return;
  memcpy(pkt, "Art-Net", 8);
  pkt[8] = 0x00; pkt[9] = 0x50;                      // OpDmx
  pkt[10] = 0; pkt[11] = 14;                         // protocol version 14
  uint8_t& seq = artSeq[portAddress & 0xff];
  if (++seq == 0) seq = 1;
  pkt[12] = seq;
  pkt[13] = 0;                                       // physical
  pkt[14] = portAddress & 0xff;                      // SubUni
  pkt[15] = (portAddress >> 8) & 0x7f;               // Net
  put16be(pkt + 16, 512);
  memcpy(pkt + 18, data512, 512);
  artUdp.beginPacket(dest, kArtPort);
  artUdp.write(pkt, 18 + 512);
  artUdp.endPacket();
  counters.artTx++;
}

void sendSacn(uint16_t universe, const uint8_t* data512, uint8_t priority) {
  if (!isUp || universe == 0 || universe > 63999) return;
  memset(pkt, 0, 126);
  put16be(pkt + 0, 0x0010);                          // preamble size
  memcpy(pkt + 4, "ASC-E1.17\0\0\0", 12);
  put16be(pkt + 16, 0x7000 | (638 - 16));
  pkt[21] = 0x04;                                    // VECTOR_ROOT_E131_DATA
  memcpy(pkt + 22, cid, 16);
  put16be(pkt + 38, 0x7000 | (638 - 38));
  pkt[43] = 0x02;                                    // VECTOR_E131_DATA_PACKET
  strncpy((char*)pkt + 44, "KD Designer", 63);
  pkt[108] = priority;
  pkt[111] = ++sacnSeq[universe % sizeof(sacnSeq)];
  put16be(pkt + 113, universe);
  put16be(pkt + 115, 0x7000 | (638 - 115));
  pkt[117] = 0x02;                                   // VECTOR_DMP_SET_PROPERTY
  pkt[118] = 0xa1;
  put16be(pkt + 121, 0x0001);                        // address increment
  put16be(pkt + 123, 513);                           // property value count
  pkt[125] = 0;                                      // start code
  memcpy(pkt + 126, data512, 512);
  sacnUdp.beginPacket(IPAddress(239, 255, universe >> 8, universe & 0xff), kSacnPort);
  sacnUdp.write(pkt, 638);
  sacnUdp.endPacket();
  counters.sacnTx++;
}

}  // namespace Net
