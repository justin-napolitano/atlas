//! Own exactly one service child. EOF preserves the existing Python shutdown contract.
use crate::policy::{self, Credentials, Result};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use url::Url;

pub struct Backend {
    pub service: PathBuf,
    pub state: PathBuf,
    child: Mutex<Option<Child>>,
    pub stopping: AtomicBool,
}

fn command(service: &Path) -> Command {
    let mut command = Command::new(service);
    command.current_dir(service.parent().unwrap());
    for key in [
        "PYTHONPATH",
        "PYTHONHOME",
        "PYTHONINSPECT",
        "PYTHONSTARTUP",
        "NODE_OPTIONS",
        "ELECTRON_RUN_AS_NODE",
        "DYLD_INSERT_LIBRARIES",
        "DYLD_LIBRARY_PATH",
    ] {
        command.env_remove(key);
    }
    command.env("PYTHONDONTWRITEBYTECODE", "1");
    command
}

impl Backend {
    pub fn new(service: PathBuf, state: PathBuf) -> Self {
        Self {
            service,
            state,
            child: Mutex::new(None),
            stopping: AtomicBool::new(false),
        }
    }
    pub fn start(&self, port: u16) -> Result<(Url, Credentials)> {
        if self.stopping.load(Ordering::SeqCst) {
            return Err("Opening cancelled".into());
        }
        let mut child = command(&self.service)
            .args(["--state-dir"])
            .arg(&self.state)
            .args([
                "--port",
                &if port >= 1024 { port } else { 0 }.to_string(),
                "serve",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let stdout = child.stdout.take().ok_or("Missing service pipe")?;
        {
            let mut owned = self.child.lock().unwrap();
            if self.stopping.load(Ordering::SeqCst) {
                drop(child.stdin.take());
                let _ = child.kill();
                let _ = child.wait();
                return Err("Opening cancelled".into());
            }
            *owned = Some(child);
        }
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut bytes = Vec::new();
            let result = reader
                .by_ref()
                .take(513)
                .read_until(b'\n', &mut bytes)
                .ok()
                .filter(|_| bytes.len() <= 512 && bytes.last() == Some(&b'\n'))
                .and_then(|_| String::from_utf8(bytes).ok());
            let _ = tx.send(result);
            let _ = std::io::copy(&mut reader, &mut std::io::sink());
        });
        let deadline = Instant::now() + Duration::from_secs(90);
        let origin = loop {
            if self.stopping.load(Ordering::SeqCst) || Instant::now() >= deadline {
                return Err("Local workspace did not start".into());
            }
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(Some(line)) => break policy::announcement(&line)?,
                Ok(None) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("Invalid service response".into())
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
        };
        let credentials: Credentials =
            policy::private_json(&self.state.join("local-session.json"))?;
        if !credentials.validate() {
            return Err("Invalid local session".into());
        }
        while Instant::now() < deadline && !self.stopping.load(Ordering::SeqCst) {
            if ready(&origin, &credentials.session) {
                return Ok((origin, credentials));
            }
            if self
                .child
                .lock()
                .unwrap()
                .as_mut()
                .and_then(|child| child.try_wait().ok().flatten())
                .is_some()
            {
                return Err("Local service stopped".into());
            }
            thread::sleep(Duration::from_millis(120));
        }
        Err("Local database did not become ready".into())
    }
    pub fn stop(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        if let Some(mut child) = self.child.lock().unwrap().take() {
            drop(child.stdin.take());
            let deadline = Instant::now() + Duration::from_secs(15);
            while Instant::now() < deadline {
                if child.try_wait().ok().flatten().is_some() {
                    return;
                }
                thread::sleep(Duration::from_millis(50));
            }
            // Kill only the process owned by this host; never a shared database.
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    pub fn running(&self) -> bool {
        self.child
            .lock()
            .unwrap()
            .as_mut()
            .is_some_and(|child| child.try_wait().ok().is_some_and(|status| status.is_none()))
    }
    pub fn maintenance(&self, operation: &str, archive: Option<&Path>) -> Result<()> {
        if !matches!(operation, "backup" | "restore") {
            return Err("Invalid maintenance operation".into());
        }
        let mut command = command(&self.service);
        command.arg("--state-dir").arg(&self.state);
        if let Some(archive) = archive {
            command.arg("--archive").arg(archive);
        }
        let mut child = command
            .arg(operation)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let stdout = child.stdout.take().ok_or("Missing maintenance pipe")?;
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = stdout.take(2049).read_to_end(&mut bytes);
            let _ = tx.send(bytes);
        });
        let output = rx.recv_timeout(Duration::from_secs(120));
        if output.is_err() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Storage command timed out".into());
        }
        let bytes = output?;
        if bytes.len() > 2048 || !child.wait()?.success() {
            return Err("Storage command failed".into());
        }
        let result: serde_json::Value = serde_json::from_slice(&bytes)?;
        if result[if operation == "backup" {
            "backup_created"
        } else {
            "restored"
        }] != true
        {
            return Err("Storage command failed".into());
        }
        Ok(())
    }
}

fn ready(origin: &Url, session: &str) -> bool {
    // The origin comes only from the validated child announcement. No proxy,
    // DNS, redirect, or renderer-provided address is involved.
    let address: SocketAddr = format!("127.0.0.1:{}", origin.port().unwrap())
        .parse()
        .unwrap();
    let result = (|| -> Result<bool> {
        let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))?;
        stream.set_read_timeout(Some(Duration::from_secs(2)))?;
        stream.set_write_timeout(Some(Duration::from_secs(2)))?;
        write!(stream, "GET /health/ready HTTP/1.1\r\nHost: {}\r\nCookie: atlas_local_owner={}\r\nConnection: close\r\n\r\n", origin.authority(), session)?;
        let mut bytes = String::new();
        stream.take(8192).read_to_string(&mut bytes)?;
        let Some((headers, body)) = bytes.split_once("\r\n\r\n") else {
            return Ok(false);
        };
        Ok(headers.starts_with("HTTP/1.1 200 ")
            && serde_json::from_str::<serde_json::Value>(body)
                .ok()
                .is_some_and(|v| v["status"] == "ready"))
    })();
    result.unwrap_or(false)
}

impl Drop for Backend {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, net::TcpListener, os::unix::fs::PermissionsExt, sync::Arc};

    #[test]
    fn child_authentication_and_eof_shutdown() {
        let root = std::env::temp_dir().join(format!("atlas-backend-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let state = root.join("state");
        policy::write_private(&state.join("local-session.json"), &serde_json::json!({"launch":"synthetic-launch-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa", "session":"synthetic-session-token-bbbbbbbbbbbbbbbbbbbbbbbbbbb"})).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let service = root.join("service");
        fs::write(&service, format!("#!/bin/sh\nprintf '%s\\n' '{{\"format\":1,\"kind\":\"atlas-local-owner\",\"port\":{port}}}'\ncat >/dev/null\n")).unwrap();
        fs::set_permissions(&service, fs::Permissions::from_mode(0o700)).unwrap();
        let http = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = [0; 4096];
            let n = stream.read(&mut bytes).unwrap();
            let request = std::str::from_utf8(&bytes[..n]).unwrap();
            assert!(request.contains("GET /health/ready HTTP/1.1"));
            assert!(request.contains("Cookie: atlas_local_owner=synthetic-session-token-"));
            let body = r#"{"status":"ready"}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
        });
        let backend = Backend::new(service, state);
        assert_eq!(backend.start(0).unwrap().0.port(), Some(port));
        assert!(backend.running());
        backend.stop();
        assert!(!backend.running());
        backend.stop();
        http.join().unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cancellation_during_start_does_not_leave_a_child() {
        let root = std::env::temp_dir().join(format!("atlas-cancel-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let service = root.join("service");
        fs::write(&service, "#!/bin/sh\nexec cat >/dev/null\n").unwrap();
        fs::set_permissions(&service, fs::Permissions::from_mode(0o700)).unwrap();
        let backend = Arc::new(Backend::new(service, root.join("state")));
        let worker = backend.clone();
        let task = thread::spawn(move || assert!(worker.start(0).is_err()));
        thread::sleep(Duration::from_millis(100));
        backend.stop();
        task.join().unwrap();
        assert!(!backend.running());
        fs::remove_dir_all(root).unwrap();
    }
}
