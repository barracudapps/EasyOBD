//! Byte transports to an ELM327-compatible adapter.
//!
//! All transports are blocking with a short read timeout: [`Transport::read`] returns `Ok(0)`
//! when no byte arrived in time, and the [`crate::Elm327`] session handles the overall deadline.

use std::io::{ErrorKind, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use crate::{Error, Result};

pub const POLL_TIMEOUT: Duration = Duration::from_millis(50);

/// Deadline helper that also works on `wasm32-unknown-unknown`, where `Instant` is unavailable:
/// there, the budget is counted in transport polls instead of wall-clock time.
pub struct Deadline {
    #[cfg(not(target_arch = "wasm32"))]
    end: std::time::Instant,
    #[cfg(target_arch = "wasm32")]
    polls_left: u64,
}

impl Deadline {
    pub fn after(d: Duration) -> Self {
        #[cfg(not(target_arch = "wasm32"))]
        return Self { end: std::time::Instant::now() + d };
        #[cfg(target_arch = "wasm32")]
        return Self { polls_left: (d.as_millis() / POLL_TIMEOUT.as_millis()).max(1) as u64 };
    }

    /// Call once per poll.
    pub fn expired(&mut self) -> bool {
        #[cfg(not(target_arch = "wasm32"))]
        return std::time::Instant::now() > self.end;
        #[cfg(target_arch = "wasm32")]
        {
            self.polls_left = self.polls_left.saturating_sub(1);
            self.polls_left == 0
        }
    }
}

pub trait Transport: Send {
    fn write_all(&mut self, data: &[u8]) -> Result<()>;
    /// Reads available bytes. Returns `Ok(0)` if nothing arrived within the poll timeout.
    fn read(&mut self, buf: &mut [u8]) -> Result<usize>;
    /// Human readable description ("Wi-Fi 192.168.0.10:35000", ...).
    fn describe(&self) -> String;
}

fn map_timeout(r: std::io::Result<usize>) -> Result<usize> {
    match r {
        Ok(n) => Ok(n),
        Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => Ok(0),
        Err(e) => Err(e.into()),
    }
}

/// Wi-Fi ELM327 dongles (usually `192.168.0.10:35000`). Works on every platform, mobile included.
pub struct TcpTransport {
    stream: TcpStream,
    addr: String,
}

impl TcpTransport {
    pub fn connect(host: &str, port: u16, timeout: Duration) -> Result<Self> {
        let addr = format!("{host}:{port}");
        let sock = addr
            .to_socket_addrs()?
            .next()
            .ok_or_else(|| Error::Protocol(format!("adresse invalide : {addr}")))?;
        let stream = TcpStream::connect_timeout(&sock, timeout)?;
        stream.set_read_timeout(Some(POLL_TIMEOUT))?;
        stream.set_nodelay(true)?;
        Ok(Self { stream, addr })
    }
}

impl Transport for TcpTransport {
    fn write_all(&mut self, data: &[u8]) -> Result<()> {
        Ok(self.stream.write_all(data)?)
    }
    fn read(&mut self, buf: &mut [u8]) -> Result<usize> {
        map_timeout(self.stream.read(buf))
    }
    fn describe(&self) -> String {
        format!("Wi-Fi {}", self.addr)
    }
}

/// USB adapters and Bluetooth Classic adapters paired as a serial port (desktop only).
#[cfg(feature = "serial")]
pub struct SerialTransport {
    port: Box<dyn serialport::SerialPort>,
    name: String,
}

#[cfg(feature = "serial")]
impl SerialTransport {
    pub fn open(path: &str, baud: u32) -> Result<Self> {
        let port = serialport::new(path, baud)
            .timeout(POLL_TIMEOUT)
            .open()
            .map_err(|e| Error::Protocol(format!("port série {path} : {e}")))?;
        Ok(Self { port, name: path.to_string() })
    }

    pub fn available_ports() -> Vec<String> {
        serialport::available_ports()
            .map(|ports| ports.into_iter().map(|p| p.port_name).collect())
            .unwrap_or_default()
    }
}

#[cfg(feature = "serial")]
impl Transport for SerialTransport {
    fn write_all(&mut self, data: &[u8]) -> Result<()> {
        Ok(self.port.write_all(data)?)
    }
    fn read(&mut self, buf: &mut [u8]) -> Result<usize> {
        map_timeout(self.port.read(buf))
    }
    fn describe(&self) -> String {
        format!("Série {}", self.name)
    }
}
