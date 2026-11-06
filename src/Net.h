#pragma once
#include <Arduino.h>
#include <PortentaEthernet.h>
#include <Ethernet.h>

struct NetConfig {
  bool dhcp = true;
  IPAddress ip, mask, gateway;
};

// Ethernet bring-up plus Art-Net and sACN (E1.31) transmitters.
namespace Net {
void begin(const NetConfig& cfg);
// Call from the main loop: watches the cable link (logged), and when DHCP is on but nobody
// answered (fallback address) asks DHCP again now and then and when the cable comes back.
void maintain(uint32_t now);
bool up();
IPAddress localIP();
void macAddress(uint8_t mac[6]);

void poll();  // answers ArtPoll, counts incoming packets, keeps DMX-input frames; caller holds g_engine

// DMX input for "DMX input" triggers: the universes to keep (sacn: sACN universe 1-63999,
// else an Art-Net 15-bit port address). Max KD_MAX_DMX_IN; caller holds g_engine.
// sACN arrives by multicast for the first sACN universe only (one group per socket);
// others need the console to send unicast to the controller.
void setDmxInputs(const bool* sacn, const uint16_t* universes, int n);
// Input i's last frame (nullptr until one arrived); frames counts the packets received.
const uint8_t* dmxIn(int i, uint32_t& frames);

// Art-Net: portAddress is the 15-bit Net/SubNet/Universe address.
void sendArtDmx(uint16_t portAddress, const uint8_t* data512, IPAddress dest);
// sACN: universe 1..63999, sent to 239.255.hi.lo multicast.
void sendSacn(uint16_t universe, const uint8_t* data512, uint8_t priority);

struct Counters {
  volatile uint32_t artTx, artRx, sacnTx, pollReplies;
};
extern Counters counters;
}  // namespace Net
