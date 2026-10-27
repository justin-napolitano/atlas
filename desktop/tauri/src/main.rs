mod backend;
mod policy;
#[cfg(feature = "native-review")]
mod review;

use backend::Backend;
use policy::{Preferences, Result};
#[cfg(feature = "native-review")]
use std::time::Instant;
use std::{
    path::PathBuf,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    webview::{DownloadEvent, NewWindowResponse, PermissionResponse},
    Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use url::Url;

struct Host {
    backend: Backend,
    origin: Mutex<Option<Url>>,
    approved_navigation: Mutex<Option<Url>>,
    preferences: PathBuf,
    busy: AtomicBool,
    closing: AtomicBool,
    finished: AtomicBool,
    #[cfg(feature = "native-review")]
    started: Instant,
}

#[derive(Clone)]
enum Action {
    Hide,
    Quit,
    Reload,
    Navigate(Url),
    Restore(PathBuf),
}

fn message(title: &str, description: &str) {
    rfd::MessageDialog::new()
        .set_title(title)
        .set_description(description)
        .show();
}

fn new_page(app: &tauri::AppHandle) {
    let host = app.state::<Arc<Host>>();
    if host.busy.load(Ordering::SeqCst) || host.closing.load(Ordering::SeqCst) {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = window.eval("window.dispatchEvent(new Event('atlas:new-page'))");
    }
}

fn external(url: &Url) {
    #[cfg(feature = "native-review")]
    if review::active() {
        return;
    }
    if policy::external(url) {
        let _ = Command::new("/usr/bin/open")
            .arg("--")
            .arg(url.as_str())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
}

const PROBE: &str = "(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return {dirty:e.defaultPrevented,location:location.pathname+location.search};})()";

fn request_action(app: &tauri::AppHandle, action: Action) {
    let host = app.state::<Arc<Host>>().inner().clone();
    if host.busy.load(Ordering::SeqCst) || host.closing.swap(true, Ordering::SeqCst) {
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        host.closing.store(false, Ordering::SeqCst);
        return;
    };
    let handle = app.clone();
    thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();
        let result = window.eval_with_callback(PROBE, move |json| {
            let _ = tx.send(json);
        });
        let probe = result
            .ok()
            .and_then(|_| rx.recv_timeout(Duration::from_secs(3)).ok())
            .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok());
        // No answer/invalid answer is treated as potentially unsaved writing.
        let dirty = probe
            .as_ref()
            .and_then(|value| value["dirty"].as_bool())
            .unwrap_or(true);
        if dirty {
            #[cfg(feature = "native-review")]
            let choice = if review::active() {
                rfd::MessageDialogResult::Custom("Keep writing".into())
            } else {
                discard_dialog()
            };
            #[cfg(not(feature = "native-review"))]
            let choice = discard_dialog();
            if choice != rfd::MessageDialogResult::Custom("Discard and continue".into()) {
                host.closing.store(false, Ordering::SeqCst);
                return;
            }
        }
        let location = if dirty {
            "/workspace.html?view=continue"
        } else {
            probe
                .as_ref()
                .and_then(|value| value["location"].as_str())
                .unwrap_or("/workspace.html")
        };
        save_preferences(&host, &window, location);
        match action {
            Action::Hide => {
                let _ = window.hide();
                host.closing.store(false, Ordering::SeqCst);
            }
            Action::Reload | Action::Navigate(_) => {
                if let Some(origin) = host.origin.lock().unwrap().as_ref() {
                    let target = if let Action::Navigate(url) = action {
                        url
                    } else {
                        origin.join(&policy::location(location, origin)).unwrap()
                    };
                    *host.approved_navigation.lock().unwrap() = Some(target.clone());
                    let _ = window.navigate(target);
                }
                host.closing.store(false, Ordering::SeqCst);
            }
            Action::Quit | Action::Restore(_) => {
                host.busy.store(true, Ordering::SeqCst);
                // Freeze editing before shutdown/restore so no new writing is accepted.
                let _ = window.hide();
                host.backend.stop();
                let restart = if let Action::Restore(archive) = action {
                    if host.backend.maintenance("restore", Some(&archive)).is_err() {
                        message("Restore was not completed", "Atlas kept the original database selected. It will reopen your current research.");
                    }
                    true
                } else {
                    false
                };
                host.finished.store(true, Ordering::SeqCst);
                if restart {
                    handle.restart();
                } else {
                    handle.exit(0);
                }
            }
        }
    });
}

fn discard_dialog() -> rfd::MessageDialogResult {
    rfd::MessageDialog::new().set_title("Writing may still be unsaved")
        .set_description("Keep Atlas open to finish saving. Continue only if you intend to leave unfinished writing.")
        .set_level(rfd::MessageLevel::Warning)
        .set_buttons(rfd::MessageButtons::OkCancelCustom("Keep writing".into(), "Discard and continue".into())).show()
}

fn save_preferences(host: &Host, window: &WebviewWindow, location: &str) {
    if let Some(origin) = host.origin.lock().unwrap().as_ref() {
        let size = window
            .inner_size()
            .ok()
            .map(|s| s.to_logical::<f64>(window.scale_factor().unwrap_or(1.0)));
        let preferences = Preferences {
            width: size.map(|s| s.width).unwrap_or(1280.0),
            height: size.map(|s| s.height).unwrap_or(860.0),
            location: policy::location(location, origin),
            backend_port: origin.port().unwrap(),
        };
        let _ = policy::write_private(&host.preferences, &preferences);
    }
}

fn maintenance(app: &tauri::AppHandle, restore: bool) {
    let host = app.state::<Arc<Host>>().inner().clone();
    if host.origin.lock().unwrap().is_none()
        || host.closing.load(Ordering::SeqCst)
        || host.busy.swap(true, Ordering::SeqCst)
    {
        return;
    }
    let handle = app.clone();
    thread::spawn(move || {
        if restore {
            let archive = rfd::FileDialog::new()
                .set_title("Restore an Atlas backup")
                .set_directory(host.backend.state.join("backups"))
                .add_filter("Atlas backup", &["dump"])
                .pick_file();
            if let Some(archive) = archive {
                let choice = rfd::MessageDialog::new().set_title("Restore this local Atlas snapshot?")
                    .set_description("Atlas verifies the backup in a separate database and keeps your original. It will restart after restoring.")
                    .set_buttons(rfd::MessageButtons::OkCancelCustom("Cancel".into(), "Restore and restart".into())).show();
                host.busy.store(false, Ordering::SeqCst);
                if choice == rfd::MessageDialogResult::Custom("Restore and restart".into()) {
                    request_action(&handle, Action::Restore(archive));
                }
                return;
            }
        } else if host.backend.maintenance("backup", None).is_ok() {
            message("Local backup saved", "A consistent snapshot is in your private Atlas backups folder. Unfinished writing must finish saving to be included.");
        } else {
            message(
                "Backup could not finish",
                "Your current research is unchanged. Check available disk space and try again.",
            );
        }
        host.busy.store(false, Ordering::SeqCst);
    });
}

fn menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(app)?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new-page", "New Page", true, Some("CmdOrCtrl+N"))?,
            &PredefinedMenuItem::close_window(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "backup", "Back Up Research Now", true, None::<&str>)?,
            &MenuItem::with_id(app, "backups", "Show Backups", true, None::<&str>)?,
            &MenuItem::with_id(app, "restore", "Restore Local Backup…", true, None::<&str>)?,
        ],
    )?;
    if let Some(item) = menu.items()?.into_iter().find(|i| {
        i.as_submenu()
            .is_some_and(|s| s.text().ok().as_deref() == Some("File"))
    }) {
        menu.remove(&item)?;
    }
    menu.insert(&file, 1)?;
    menu.insert(
        &Submenu::with_items(
            app,
            "View",
            true,
            &[
                &MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?,
                &MenuItem::with_id(app, "zoom-in", "Zoom In", true, Some("CmdOrCtrl+Plus"))?,
                &MenuItem::with_id(app, "zoom-out", "Zoom Out", true, Some("CmdOrCtrl+-"))?,
                &MenuItem::with_id(app, "zoom-reset", "Actual Size", true, Some("CmdOrCtrl+0"))?,
                &PredefinedMenuItem::fullscreen(app, None)?,
            ],
        )?,
        3,
    )?;
    Ok(menu)
}

fn open_window(app: &tauri::AppHandle, host: Arc<Host>) -> Result<WebviewWindow> {
    let preferences = policy::private_json::<Preferences>(&host.preferences).unwrap_or_default();
    let nav_host = host.clone();
    let nav_app = app.clone();
    let popup_host = host.clone();
    let popup_app = app.clone();
    let download_host = host.clone();
    let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Atlas")
        .inner_size(
            if preferences.width.is_finite() {
                preferences.width.clamp(760.0, 2560.0)
            } else {
                1280.0
            },
            if preferences.height.is_finite() {
                preferences.height.clamp(560.0, 1600.0)
            } else {
                860.0
            },
        )
        .min_inner_size(640.0, 480.0)
        .background_color(tauri::window::Color(28, 28, 28, 255))
        .disable_drag_drop_handler()
        .incognito(cfg!(feature = "native-review"))
        .devtools(false)
        .on_permission_request(|_, _| PermissionResponse::Deny)
        .on_navigation(move |url| {
            let origin = nav_host.origin.lock().unwrap();
            if let Some(origin) = origin.as_ref() {
                if policy::page(url, origin) {
                    let mut approved = nav_host.approved_navigation.lock().unwrap();
                    if approved.as_ref() == Some(url) {
                        approved.take();
                        return true;
                    }
                    drop(approved);
                    request_action(&nav_app, Action::Navigate(url.clone()));
                    return false;
                }
                external(url);
                false
            } else {
                matches!(url.scheme(), "tauri" | "about")
                    || url.host_str() == Some("tauri.localhost")
            }
        })
        .on_new_window(move |url, _| {
            if let Some(origin) = popup_host.origin.lock().unwrap().as_ref() {
                if policy::page(&url, origin) {
                    request_action(&popup_app, Action::Navigate(url));
                    return NewWindowResponse::Deny;
                }
            }
            external(&url);
            NewWindowResponse::Deny
        })
        .on_download(move |_, event| {
            if let DownloadEvent::Requested { url, destination } = event {
                let allowed = download_host
                    .origin
                    .lock()
                    .unwrap()
                    .as_ref()
                    .is_some_and(|origin| {
                        policy::owned(&url, origin)
                            || url.scheme() == "blob"
                                && Url::parse(url.path())
                                    .ok()
                                    .is_some_and(|inner| policy::owned(&inner, origin))
                    });
                if !allowed {
                    return false;
                }
                let name = policy::filename(
                    destination
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("Atlas export.md"),
                );
                if let Some(chosen) = download_destination(&name) {
                    *destination = chosen;
                } else {
                    return false;
                }
            }
            true
        })
        .build()?;
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            request_action(&handle, Action::Hide);
        }
    });
    let handle = app.clone();
    let ready_window = window.clone();
    thread::spawn(move || {
        match host.backend.start(preferences.backend_port) {
            Ok((origin, credentials)) if !host.backend.stopping.load(Ordering::SeqCst) => {
                *host.origin.lock().unwrap() = Some(origin.clone());
                let cookie =
                    tauri::webview::Cookie::build(("atlas_local_owner", credentials.session))
                        .domain("127.0.0.1")
                        .path("/")
                        .http_only(true)
                        .same_site(tauri::webview::cookie::SameSite::Strict)
                        .build();
                let target = origin
                    .join(&policy::location(&preferences.location, &origin))
                    .unwrap();
                *host.approved_navigation.lock().unwrap() = Some(target.clone());
                if ready_window
                    .set_cookie(cookie)
                    .and_then(|_| ready_window.navigate(target))
                    .is_err()
                {
                    host.backend.stop();
                    message(
                        "Atlas could not open",
                        "The local workspace is not ready. Your research is unchanged.",
                    );
                }
                while !host.backend.stopping.load(Ordering::SeqCst) {
                    thread::sleep(Duration::from_millis(500));
                    if !host.backend.running() && !host.backend.stopping.load(Ordering::SeqCst) {
                        message("Atlas storage stopped", "The local service stopped. Keep unfinished writing open and save a copy before restarting Atlas.");
                        break;
                    }
                }
            }
            _ => {
                host.backend.stop();
                if !host.closing.load(Ordering::SeqCst) {
                    let _ = ready_window.eval("document.querySelector('[role=status]').textContent='Atlas could not open your workspace. Your research is unchanged. Quit and try again.'");
                }
            }
        }
        let _ = handle;
    });
    Ok(window)
}

fn download_destination(name: &str) -> Option<PathBuf> {
    #[cfg(feature = "native-review")]
    if review::active() {
        return review::download_destination();
    }
    rfd::FileDialog::new()
        .set_title("Save Atlas export")
        .set_file_name(name)
        .save_file()
}

fn main() {
    let option = std::env::args().nth(1);
    if option.as_deref() == Some("--build-info") {
        println!(
            "{}",
            serde_json::json!({"shell":"tauri","version":env!("CARGO_PKG_VERSION"),"nativeReview":cfg!(feature = "native-review")})
        );
        return;
    }
    if option.as_deref() == Some("--review") && !cfg!(feature = "native-review") {
        std::process::exit(2);
    }
    let builder = tauri::Builder::default();
    #[cfg(feature = "native-review")]
    let synthetic = review::active();
    #[cfg(not(feature = "native-review"))]
    let synthetic = false;
    // Synthetic review must never forward to the installed owner's instance.
    // Its marked private fixture is already enforced by review::configuration.
    let builder = if synthetic {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if app.try_state::<Arc<Host>>().is_some_and(|host| {
                host.busy.load(Ordering::SeqCst) || host.closing.load(Ordering::SeqCst)
            }) {
                return;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
    };
    let app = builder.setup(|app| {
            let home = app.path().home_dir()?;
            let resources = app.path().resource_dir()?;
            #[cfg(feature = "native-review")]
            let review = review::configuration().map_err(|_| std::io::Error::other("Invalid synthetic review configuration"))?;
            let service = resources.join("offline/runtime/atlas-service/atlas-service");
            #[cfg(feature = "native-review")]
            let service = review.as_ref().map(|r| r.resources.join("runtime/atlas-service/atlas-service")).unwrap_or(service);
            let state = home.join(".local/share/atlas");
            let preferences = home.join("Library/Application Support/Atlas/window.json");
            #[cfg(feature = "native-review")]
            let (state, preferences) = review.as_ref().map(|r| (r.state.clone(), r.state.parent().unwrap().join("window.json"))).unwrap_or((state, preferences));
            let host = Arc::new(Host {
                backend: Backend::new(service, state),
                origin: Mutex::new(None), approved_navigation: Mutex::new(None), preferences,
                busy: AtomicBool::new(false), closing: AtomicBool::new(false), finished: AtomicBool::new(false),
                #[cfg(feature = "native-review")]
                started: Instant::now(),
            });
            app.manage(host.clone());
            app.set_menu(menu(app.handle())?)?;
            let window = open_window(app.handle(), host).map_err(|_| std::io::Error::other("Atlas window could not open"))?;
            #[cfg(feature = "native-review")]
            if let Some(config) = review { review::run(app.handle().clone(), window, config); }
            #[cfg(not(feature = "native-review"))]
            let _ = window;
            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "new-page" => new_page(app),
                "backup" => maintenance(app, false), "restore" => maintenance(app, true),
                "backups" => { let path = app.state::<Arc<Host>>().backend.state.join("backups"); let _ = Command::new("/usr/bin/open").arg(path).spawn(); },
                "reload" => request_action(app, Action::Reload),
                "zoom-in" | "zoom-out" | "zoom-reset" => if let Some(window) = app.get_webview_window("main") { let _ = window.eval(match event.id().as_ref() {
                    "zoom-in" => "document.documentElement.style.zoom=String(Math.min(2,Number(document.documentElement.style.zoom||1)+.1))",
                    "zoom-out" => "document.documentElement.style.zoom=String(Math.max(.5,Number(document.documentElement.style.zoom||1)-.1))",
                    _ => "document.documentElement.style.zoom='1'",
                }); },
                _ => {}
            }
        })
        .build(tauri::generate_context!()).expect("Atlas could not initialize its native window");
    app.run(|app, event| match event {
        RunEvent::ExitRequested { api, .. } => {
            let host = app.state::<Arc<Host>>();
            if !host.finished.load(Ordering::SeqCst) {
                api.prevent_exit();
                request_action(app, Action::Quit);
            }
        }
        RunEvent::Reopen { .. } => {
            let host = app.state::<Arc<Host>>();
            if host.busy.load(Ordering::SeqCst) || host.closing.load(Ordering::SeqCst) {
                return;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        RunEvent::Exit => app.state::<Arc<Host>>().backend.stop(),
        _ => {}
    });
}
