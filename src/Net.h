#pragma once
#include <Arduino.h>
#include <PortentaEthernet.h>
#include <Ethernet.h>
#include <ArduinoJson.h>

struct NetConfig {
  bool dhcp = true;
  IPAddress ip, mask, gateway;
  IPAddress dns, dns2;   // fixed address only (DHCP brings its own); 0.0.0.0 = none (dns: the gateway)
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
// What the interface really uses (Settings > Network): mode, link, ip, mask, gateway, dns, mac,
// and a running network test ("trial": seconds left, the new address).
void statusJson(JsonObject o);

// Network test (Settings > Network, after a save): switch to cfg now, without a restart, and go
// back to the setting in use after KD_NET_TRIAL_MS unless confirm() is called (a browser
// reached the controller at its new address). Web thread; the switch happens in maintain().
// Returns false (with why) when a test is already running. old = the setting in use now.
bool requestTry(const NetConfig& cfg, NetConfig& old, String& why);
bool confirm();   // true = a test was running and is now kept
// A test went back: the project file must get the old setting again (web thread, NetSafe).
bool takeRevert(NetConfig& old);

// Answers ArtPoll and joins the sACN group for DMX input; main loop. Receiving (counting,
// DMX-input frames) runs in the network receive thread (NetRx.h).
void poll();

// DMX input for "DMX input" triggers: the universes to keep (sacn: sACN universe 1-63999,
// else an Art-Net 15-bit port address). Max KD_MAX_DMX_IN; caller holds g_engine.
// sACN arrives by multicast for the first sACN universe only (one group per socket);
// others need the console to send unicast to the controller.
void setDmxInputs(const bool* sacn, const uint16_t* universes, int n);
// Input i: frames received so far (0 = none yet), and a copy of the last one (512 bytes;
// returns its frame count). The receive thread writes them: read through the copy.
uint32_t dmxInFrames(int i);
uint32_t dmxInCopy(int i, uint8_t* out512);

// Art-Net: portAddress is the 15-bit Net/SubNet/Universe address.
void sendArtDmx(uint16_t portAddress, const uint8_t* data512, IPAddress dest);
// sACN: universe 1..63999, sent to 239.255.hi.lo multicast.
void sendSacn(uint16_t universe, const uint8_t* data512, uint8_t priority);

struct Counters {
  volatile uint32_t artTx, artRx, sacnTx, sacnRx, pollReplies;
};
extern Counters counters;
}  // namespace Net
