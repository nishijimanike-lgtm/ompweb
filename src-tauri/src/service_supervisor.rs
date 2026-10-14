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
        // Fast TCP probe: if the port is not even accepting connections, return false immediately.
        let addr = format!("127.0.0.1:{}", port);
        if let Ok(socket_addr) = addr.parse() {
            if std::net::TcpStream::connect_timeout(&socket_addr, Duration::from_millis(600)).is_err() {
                return false;
            }
        } else {
            return false;
        }

        // Probing /api/home is lightweight and avoids triggering Next.js full SSR/page compilation
        let url = format!("http://127.0.0.1:{}/api/home", port);
        match ureq::get(&url).timeout(Duration::from_secs(3)).call() {
            Ok(resp) => resp.status() < 500,
            Err(ureq::Error::Status(code, _)) => code < 500,
            Err(_) => {
                // Fallback to probing root path with a 4s timeout
                let root_url = format!("http://127.0.0.1:{}/", port);
                match ureq::get(&root_url).timeout(Duration::from_secs(4)).call() {
                    Ok(resp) => resp.status() < 500,
                    Err(ureq::Error::Status(code, _)) => code < 500,
                    Err(_) => false,
                }
            }
        }
    }

    fn get_user_home() -> Option<PathBuf> {
        #[cfg(windows)]
        {
            std::env::var_os("USERPROFILE").map(PathBuf::from)
        }
        #[cfg(not(windows))]
        {
            std::env::var_os("HOME").map(PathBuf::from)
        }
    }

    /// Find the repo root where package.json lives across multiple possible launch contexts
    pub fn find_project_root() -> Option<PathBuf> {
        // 1. Explicit environment variable
        if let Ok(val) = std::env::var("OMP_WEB_ROOT") {
            let p = PathBuf::from(val);
            if p.join("package.json").exists() {
                return Some(p);
            }
        }

        // 2. Walk up from current working directory
        if let Ok(mut cur) = std::env::current_dir() {
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
        }

        // 3. Walk up from executable directory
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(mut cur) = exe_path.parent().map(|p| p.to_path_buf()) {
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
            }
        }

        // 4. Check ~/.omp/agent/web-service.json
        if let Some(home) = Self::get_user_home() {
            let config_path = home.join(".omp").join("agent").join("web-service.json");
            if config_path.exists() {
                if let Ok(content) = std::fs::read_to_string(&config_path) {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(repo_root) = val.get("repoRoot").and_then(|v| v.as_str()) {
                            let p = PathBuf::from(repo_root);
                            if p.join("package.json").exists() {
                                return Some(p);
                            }
                        }
                    }
                }
            }

            // 5. Check ~/.omp/agent/projects.json for an ompweb checkout
            let projects_path = home.join(".omp").join("agent").join("projects.json");
            if projects_path.exists() {
                if let Ok(content) = std::fs::read_to_string(&projects_path) {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(projects) = val.get("projects").and_then(|v| v.as_array()) {
                            for proj in projects {
                                if let Some(path_str) = proj.get("path").and_then(|v| v.as_str()) {
                                    let p = PathBuf::from(path_str);
                                    if p.join("package.json").exists() {
                                        if let Ok(pkg_content) = std::fs::read_to_string(p.join("package.json")) {
                                            if pkg_content.contains("ompweb") {
                                                return Some(p);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        None
    }

    /// Suppress legacy omp-web-tray.exe process to avoid double tray icons or port conflicts
    pub fn suppress_legacy_tray() {
        #[cfg(windows)]
        {
            let _ = Command::new("cmd.exe")
                .args(["/C", "taskkill /F /IM omp-web-tray.exe >nul 2>&1"])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        }
    }

    /// Ensure the backend server is running.
    /// If 30178 or 30177 is already running, reuse it.
    /// Otherwise, launch `npm run dev` (debug/unbuilt) or `npm run start` (release).
    pub fn ensure_service_started(&self) -> Result<u16, String> {
        Self::suppress_legacy_tray();

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

        let mut target_port = if cfg!(debug_assertions) { 30178 } else { 30177 };

        let root = Self::find_project_root()
            .ok_or_else(|| "Could not locate project root with package.json".to_string())?;

        // In release mode, if production build .next/BUILD_ID is missing, fallback to dev mode
        if target_port == 30177 && !root.join(".next").join("BUILD_ID").exists() {
            log::warn!("Production build not found in {:?}; falling back to dev mode on port 30178", root);
            target_port = 30178;
        }

        self.set_port(target_port);

        log::info!("Starting ompweb backend service from {:?} on port {}", root, target_port);
        self.spawn_server_process(&root, target_port)?;

        // Wait up to 50 seconds for the server to become responsive
        let start_time = Instant::now();
        let timeout = Duration::from_secs(50);
        while start_time.elapsed() < timeout {
            if Self::is_alive(target_port) {
                log::info!("ompweb service successfully responded on port {}", target_port);
                return Ok(target_port);
            }
            thread::sleep(Duration::from_millis(600));
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
