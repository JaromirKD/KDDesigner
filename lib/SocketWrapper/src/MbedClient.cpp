#include "MbedClient.h"

#ifndef SOCKET_TIMEOUT
#define SOCKET_TIMEOUT 1500
#endif

arduino::MbedClient::MbedClient()
  : _status(false),
    _timeout(SOCKET_TIMEOUT) {
}

uint8_t arduino::MbedClient::status() {
  return (_status && (getNetwork()->get_connection_status() < NSAPI_STATUS_DISCONNECTED));
}


// KD Designer: Arduino's version (core 4.6.0) never went back to waiting once a socket had
// nothing to read: `continue` in the do-while re-tested WOULD_BLOCK and called recv() again,
// so every open connection spun at normal priority and starved lower-priority threads (the
// DMX output dropped to a few frames/s while a browser was connected). Now it reads what is
// there, then waits for the socket's sigio event (or 100 ms), sleeps 1 ms while the buffer is
// full, and ends on a close. It reads before the first wait: a browser's request is usually
// in before accept() hands the socket over, so its sigio was missed and every request
// waited the full 100 ms.
void arduino::MbedClient::readSocket() {
  uint8_t data[SOCKET_BUFFER_SIZE];

  for (bool first = true; sock != nullptr; first = false) {
    if (!first) event->wait_any(0xFF, 100);
    for (;;) {
      mutex->lock();
      if (sock == nullptr) {
        mutex->unlock();
        goto cleanup;
      }
      int room = rxBuffer.availableForStore();
      if (room == 0) {
        mutex->unlock();
        rtos::ThisThread::sleep_for(std::chrono::milliseconds(1));
        continue;
      }
      int ret = sock->recv(data, room);
      if (ret == NSAPI_ERROR_WOULD_BLOCK) {
        mutex->unlock();
        break;
      }
      if (ret <= 0) {  // 0 = the peer closed the connection, < 0 = error
        mutex->unlock();
        goto cleanup;
      }
      for (int i = 0; i < ret; i++) {
        rxBuffer.store_char(data[i]);
      }
      mutex->unlock();
      _status = true;
    }
  }
cleanup:
  _status = false;
  return;
}

void arduino::MbedClient::getStatus() {
  event->set(1);
}

void arduino::MbedClient::setSocket(Socket *_sock) {
  sock = _sock;
  configureSocket(sock);
}

void arduino::MbedClient::configureSocket(Socket *_s) {
  _s->set_blocking(false);
  _s->getpeername(&address);

  if (event == nullptr) {
    event = new rtos::EventFlags;
  }
  if (mutex == nullptr) {
    mutex = new rtos::Mutex;
  }
  mutex->lock();
  if (reader_th == nullptr) {
    reader_th = new rtos::Thread(osPriorityNormal, OS_STACK_SIZE, nullptr, "readSocket");
    reader_th->start(mbed::callback(this, &MbedClient::readSocket));
  }
  mutex->unlock();
  _s->sigio(mbed::callback(this, &MbedClient::getStatus));
  _status = true;
}

int arduino::MbedClient::connect(SocketAddress socketAddress) {
  // if a connection is aready ongoing, a disconnection must be enforced before starting another one
  stop();

  if (sock == nullptr) {
    sock = new TCPSocket();
    _own_socket = true;
  }
  if (sock == nullptr) {
    return 0;
  }

  if (static_cast<TCPSocket *>(sock)->open(getNetwork()) != NSAPI_ERROR_OK) {
    return 0;
  }

  // KD Designer: Arduino's connect had no time limit (only connectSSL set one), so a device
  // that is off held the calling thread until lwIP gave up (20 s and more), and the I/O
  // thread's TCP devices, HTTP requests and PLC polls all waited behind it.
  sock->set_timeout(_timeout);
  nsapi_error_t returnCode = static_cast<TCPSocket *>(sock)->connect(socketAddress);
  int ret = 0;

  switch (returnCode) {
    case NSAPI_ERROR_IS_CONNECTED:
    case NSAPI_ERROR_OK:
      {
        ret = 1;
        break;
      }
  }

  if (ret == 1) {
    configureSocket(sock);   // non-blocking from here on
    _status = true;
  } else {
    _status = false;
  }

  return ret;
}

int arduino::MbedClient::connect(IPAddress ip, uint16_t port) {
  return connect(SocketHelpers::socketAddressFromIpAddress(ip, port));
}

int arduino::MbedClient::connect(const char *host, uint16_t port) {
  SocketAddress socketAddress = SocketAddress();
  socketAddress.set_port(port);
  SocketHelpers::gethostbyname(getNetwork(), host, &socketAddress);
  return connect(socketAddress);
}

int arduino::MbedClient::connectSSL(SocketAddress socketAddress) {
  // if a connection is aready ongoing, a disconnection must be enforced before starting another one
  stop();

  if (sock == nullptr) {
    sock = new TLSSocket();
    _own_socket = true;
  }
  if (sock == nullptr) {
    return 0;
  }

  if (beforeConnect) {
    beforeConnect();
  }

  if (static_cast<TLSSocket *>(sock)->open(getNetwork()) != NSAPI_ERROR_OK) {
    return 0;
  }

  /* For TLS connection timeout needs to be configured before handshake starts
   * otherwise socket timeout is not adopted. See TLSSocketWrapper::set_timeout(int timeout)
   */
  sock->set_timeout(_timeout);

restart_connect:
  nsapi_error_t returnCode = static_cast<TLSSocket *>(sock)->connect(socketAddress);
  int ret = 0;

  switch (returnCode) {
    case NSAPI_ERROR_IS_CONNECTED:
    case NSAPI_ERROR_OK:
      {
        ret = 1;
        break;
      }
    case NSAPI_ERROR_IN_PROGRESS:
    case NSAPI_ERROR_ALREADY:
      {
        delay(100);
        goto restart_connect;
      }
  }

  if (ret == 1) {
    configureSocket(sock);
    _status = true;
  } else {
    _status = false;
  }

  return ret;
}

int arduino::MbedClient::connectSSL(IPAddress ip, uint16_t port) {
  return connectSSL(SocketHelpers::socketAddressFromIpAddress(ip, port));
}

int arduino::MbedClient::connectSSL(const char *host, uint16_t port) {
  SocketAddress socketAddress = SocketAddress();
  socketAddress.set_port(port);
  SocketHelpers::gethostbyname(getNetwork(), host, &socketAddress);
  return connectSSL(socketAddress);
}

size_t arduino::MbedClient::write(uint8_t c) {
  return write(&c, 1);
}

// KD Designer: Arduino's version made the socket blocking (set_timeout) for the send and
// non-blocking again after it. The reader thread's recv() in between then blocked too, while
// holding the mutex that read() needs, and the I/O thread waited behind it. The socket now
// stays non-blocking and the send is retried until it is all out or _timeout passes with no
// progress.
size_t arduino::MbedClient::write(const uint8_t *buf, size_t size) {
  if (sock == nullptr)
    return 0;

  size_t sent = 0;
  uint32_t t0 = millis();
  while (sent < size && sock != nullptr) {
    int ret = sock->send(buf + sent, size - sent);
    if (ret > 0) {
      sent += ret;
      t0 = millis();
      continue;
    }
    if (ret != NSAPI_ERROR_WOULD_BLOCK && ret != 0) break;
    if (millis() - t0 >= _timeout) break;
    rtos::ThisThread::sleep_for(std::chrono::milliseconds(1));
  }
  return sent;
}

int arduino::MbedClient::available() {
  int ret = rxBuffer.available();
  return ret;
}

int arduino::MbedClient::read() {
  if (sock == nullptr)
    return -1;
  mutex->lock();
  if (!available()) {
    mutex->unlock();
    return -1;
  }

  int ret = rxBuffer.read_char();
  mutex->unlock();
  return ret;
}

int arduino::MbedClient::read(uint8_t *data, size_t len) {
  if (sock == nullptr)
    return 0;
  mutex->lock();
  int avail = available();

  if (!avail) {
    mutex->unlock();
    return -1;
  }

  if ((int)len > avail) {
    len = avail;
  }

  for (size_t i = 0; i < len; i++) {
    data[i] = rxBuffer.read_char();
  }
  mutex->unlock();

  return len;
}

int arduino::MbedClient::peek() {
  return rxBuffer.peek();
}

void arduino::MbedClient::flush() {
}

void arduino::MbedClient::stop() {
  if (mutex != nullptr) {
    mutex->lock();
  }
  if (sock != nullptr) {
    if (_own_socket) {
      delete sock;
    } else {
      sock->set_timeout(_timeout);
      sock->close();
    }
    sock = nullptr;
  }
  if (mutex != nullptr) {
    mutex->unlock();
  }
  if (reader_th != nullptr) {
    reader_th->join();
    delete reader_th;
    reader_th = nullptr;
  }
  if (event != nullptr) {
    delete event;
    event = nullptr;
  }
  if (mutex != nullptr) {
    delete mutex;
    mutex = nullptr;
  }
  _status = false;
  rxBuffer.clear();
}

uint8_t arduino::MbedClient::connected() {
  return ((status() == true) || (available() > 0));
}

IPAddress arduino::MbedClient::remoteIP() {
  return SocketHelpers::ipAddressFromSocketAddress(address);
}

uint16_t arduino::MbedClient::remotePort() {
  return address.get_port();
}

void arduino::MbedClient::setSocketTimeout(unsigned long timeout) {
  _timeout = timeout;
}
