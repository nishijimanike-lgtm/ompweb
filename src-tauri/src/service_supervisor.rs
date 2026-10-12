use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

// CREATE_NO_WINDOW flag on Windows
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Clone, Default)]
pub struct ServiceSupervisor {
    child: Arc<Mutex<Option<Child>>>,
    port: Arc<Mutex<u16>>,
}

impl ServiceSupervisor {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            port: Arc::new(Mutex::new(30178)),
        }
    }

    pub fn get_port(&self) -> u16 {
        *self.port.lock().unwrap()
    }

    pub fn set_port(&self, port: u16) {
        *self.port.lock().unwrap() = port;
    }

    /// Check whether a service is responding on 127.0.0.1:<port>
    pub fn is_alive(port: u16) -> bool {
        let url = format!("http://127.0.0.1:{}/", port);
        match ureq::get(&url).timeout(Duration::from_millis(800)).call() {
            Ok(resp) => resp.status() < 500,
            Err(ureq::Error::Status(code, _)) => code < 500,
            Err(_) => false,
        }
    }

    /// Find the repo root where package.json lives
    pub fn find_project_root() -> Option<PathBuf> {
        let mut cur = std::env::current_dir().ok()?;
        for _ in 0..6 {
            if cur.join("package.json").exists() {
                return Some(cur);
            }
            if let Some(parent) = cur.parent() {
                cur = parent.to_path_buf();
            } else {
                break;
            }
        }
        None
    }

    /// Ensure the backend server is running.
    /// If 30178 or 30177 is already running, reuse it.
    /// Otherwise, launch `npm run dev` (debug) or `npm run start` (release).
    pub fn ensure_service_started(&self) -> Result<u16, String> {
        // First check port 30178 then 30177
        if Self::is_alive(30178) {
            log::info!("ompweb service is already running on port 30178");
            self.set_port(30178);
            return Ok(30178);
        }
        if Self::is_alive(30177) {
            log::info!("ompweb service is already running on port 30177");
            self.set_port(30177);
            return Ok(30177);
        }

        let target_port = if cfg!(debug_assertions) { 30178 } else { 30177 };
        self.set_port(target_port);

        let root = Self::find_project_root()
            .ok_or_else(|| "Could not locate project root with package.json".to_string())?;

        log::info!("Starting ompweb backend service from {:?} on port {}", root, target_port);
        self.spawn_server_process(&root, target_port)?;

        // Wait up to 25 seconds for the server to become responsive
        let start_time = Instant::now();
        let timeout = Duration::from_secs(25);
        while start_time.elapsed() < timeout {
            if Self::is_alive(target_port) {
                log::info!("ompweb service successfully responded on port {}", target_port);
                return Ok(target_port);
            }
            thread::sleep(Duration::from_millis(500));
        }

        Err(format!("Timed out waiting for ompweb service on port {}", target_port))
    }

    fn spawn_server_process(&self, root: &Path, port: u16) -> Result<(), String> {
        self.stop_service();

        #[cfg(windows)]
        let mut cmd = Command::new("cmd.exe");
        #[cfg(windows)]
        {
            let script = if port == 30178 { "npm run dev" } else { "npm run start" };
            cmd.args(["/C", script]);
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        #[cfg(not(windows))]
        let mut cmd = Command::new("npm");
        #[cfg(not(windows))]
        {
            let script = if port == 30178 { "dev" } else { "start" };
            cmd.args(["run", script]);
        }

        cmd.current_dir(root);
        cmd.env("PORT", port.to_string());
        cmd.env("HOSTNAME", "127.0.0.1");

        let child = cmd.spawn().map_err(|e| format!("Failed to spawn server process: {}", e))?;
        *self.child.lock().unwrap() = Some(child);
        Ok(())
    }

    /// Stop managed child process if any
    pub fn stop_service(&self) {
        let mut guard = self.child.lock().unwrap();
        if let Some(mut child) = guard.take() {
            log::info!("Terminating managed ompweb server process...");
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// Restart service
    pub fn restart(&self) -> Result<u16, String> {
        let port = self.get_port();
        self.stop_service();
        thread::sleep(Duration::from_millis(600));
        if let Some(root) = Self::find_project_root() {
            self.spawn_server_process(&root, port)?;
            // Wait up to 15s
            let start_time = Instant::now();
            let timeout = Duration::from_secs(15);
            while start_time.elapsed() < timeout {
                if Self::is_alive(port) {
                    return Ok(port);
                }
                thread::sleep(Duration::from_millis(400));
            }
            Err(format!("Timed out waiting for restarted server on port {}", port))
        } else {
            Err("Project root not found".to_string())
        }
    }
}
