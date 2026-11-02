#include "Net.h"
#include <EthernetUdp.h>
#include "Config.h"
#include "Log.h"

namespace {
const uint16_t kArtPort = 6454;
const uint16_t kSacnPort = 5568;

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

// The sACN socket is also the output socket: reopen it on the main thread only,
// when the multicast group for DMX input changes.
void joinSacn() {
  if (sacnGroup == sacnJoined) return;
  sacnUdp.stop();
  bool ok = sacnGroup ? sacnUdp.beginMulticast(IPAddress(239, 255, sacnGroup >> 8, sacnGroup & 0xff), kSacnPort) : sacnUdp.begin(kSacnPort);
  if (sacnGroup && !ok) { LOGW(Sacn, "Cannot join sACN universe %u (multicast) - only unicast sACN is received", sacnGroup); sacnUdp.begin(kSacnPort); }
  else if (sacnGroup) LOGI(Sacn, "Receiving sACN universe %u for DMX input", sacnGroup);
  sacnJoined = sacnGroup;
}
uint8_t artSeq[256];           // sequence counter per (low byte of) port address
uint8_t sacnSeq[KD_MAX_UNIVERSES * 16];
uint8_t cid[16];
uint8_t mac[6];
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
  int ok = 0;
  if (cfg.dhcp) {
    LOGI(Net, "Requesting DHCP lease...");
    ok = Ethernet.begin(nullptr, 10000);
    if (!ok) LOGW(Net, "DHCP failed, using fallback address");
  }
  if (!ok) {
    IPAddress ip = cfg.dhcp ? IPAddress(KD_FALLBACK_IP) : cfg.ip;
    IPAddress mask = cfg.dhcp ? IPAddress(KD_FALLBACK_MASK) : cfg.mask;
    IPAddress gw = cfg.dhcp ? IPAddress(KD_FALLBACK_GW) : cfg.gateway;
    Ethernet.begin(nullptr, ip, gw, gw, mask);
  }
  if (Ethernet.linkStatus() == LinkOFF) LOGW(Net, "Ethernet cable not connected");

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
