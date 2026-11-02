#include "Util.h"

String rest(const std::vector<String>& t, size_t from) {
  String s;
  for (size_t i = from; i < t.size(); i++) { if (i > from) s += ' '; s += t[i]; }
  return s;
}

bool httpMethod(const String& word, String& method, String& err) {
  method = word;
  method.toUpperCase();
  if (method == "GET" || method == "POST" || method == "PUT" || method == "DELETE") return true;
  err = "method must be get|post|put|delete";
  return false;
}

String unescape(const String& s) {
  String out;
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c != '\\' || i + 1 >= s.length()) { out += c; continue; }
    char n = s[++i];
    if (n == 'r') out += '\r';
    else if (n == 'n') out += '\n';
    else if (n == 't') out += '\t';
    else if (n == 'x' && i + 2 < s.length() && isxdigit(s[i + 1]) && isxdigit(s[i + 2])) {
      out += (char)strtol(s.substring(i + 1, i + 3).c_str(), nullptr, 16);
      i += 2;
    } else out += n;
  }
  return out;
}

String toHex(const uint8_t* d, size_t n) {
  static const char kHex[] = "0123456789abcdef";
  String s;
  s.reserve(n * 2);
  for (size_t i = 0; i < n; i++) { s += kHex[d[i] >> 4]; s += kHex[d[i] & 15]; }
  return s;
}

// Minimal MD5 (RFC 1321) for PJLink and HTTP digest auth; the core's mbedTLS build omits MD5.
void md5(const uint8_t* msg, size_t len, uint8_t out[16]) {
  static const uint32_t K[64] = {
      0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
      0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
      0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
      0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
      0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
      0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
      0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
      0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391};
  static const uint8_t R[64] = {7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
                                5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
                                4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
                                6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21};
  uint32_t h[4] = {0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476};
  size_t total = ((len + 8) / 64 + 1) * 64;
  std::vector<uint8_t> buf(total, 0);
  memcpy(buf.data(), msg, len);
  buf[len] = 0x80;
  uint64_t bits = (uint64_t)len * 8;
  for (int i = 0; i < 8; i++) buf[total - 8 + i] = bits >> (8 * i);
  for (size_t off = 0; off < total; off += 64) {
    uint32_t w[16];
    for (int i = 0; i < 16; i++)
      w[i] = buf[off + i * 4] | (buf[off + i * 4 + 1] << 8) | (buf[off + i * 4 + 2] << 16) | ((uint32_t)buf[off + i * 4 + 3] << 24);
    uint32_t a = h[0], b = h[1], c = h[2], d = h[3];
    for (int i = 0; i < 64; i++) {
      uint32_t f;
      int g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      uint32_t tmp = d;
      d = c;
      c = b;
      uint32_t x = a + f + K[i] + w[g];
      b = b + ((x << R[i]) | (x >> (32 - R[i])));
      a = tmp;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d;
  }
  for (int i = 0; i < 16; i++) out[i] = h[i / 4] >> (8 * (i % 4));
}

String md5hex(const String& s) {
  uint8_t d[16];
  md5((const uint8_t*)s.c_str(), s.length(), d);
  return toHex(d, 16);
}
