//! Compiled only into the separate native-review binary, never the installed app.
use super::*;
use serde::Deserialize;
static ROOT: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

pub fn download_destination() -> Option<PathBuf> {
    ROOT.get().map(|root| root.join("native-export.md"))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Config {
    pub resources: PathBuf,
    pub state: PathBuf,
    pub result_file: PathBuf,
}

pub fn active() -> bool {
    std::env::args().nth(1).as_deref() == Some("--review")
}
pub fn configuration() -> Result<Option<Config>> {
    if !active() {
        return Ok(None);
    }
    let file =
        PathBuf::from(std::env::args().nth(2).ok_or("Missing synthetic config")?).canonicalize()?;
    let root = file.parent().ok_or("Invalid synthetic directory")?;
    if root.parent() != Some(std::path::Path::new("/private/tmp"))
        || !root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("atlas-offline-")
        || std::fs::read(root.join(".atlas-tauri-synthetic"))? != b"isolated-test-only"
    {
        return Err("Synthetic review requires an isolated test directory".into());
    }
    let config: Config = policy::private_json(&file)?;
    if config.state != root.join("state")
        || config.result_file != root.join("tauri-result.json")
        || config.resources != root.join("Copied app resources")
    {
        return Err("Synthetic path outside test directory".into());
    }
    let _ = ROOT.set(root.to_path_buf());
    Ok(Some(config))
}

fn evaluate(window: &WebviewWindow, script: &str) -> Result<serde_json::Value> {
    let (tx, rx) = std::sync::mpsc::channel();
    window.eval_with_callback(script, move |value| {
        let _ = tx.send(value);
    })?;
    Ok(serde_json::from_str(
        &rx.recv_timeout(Duration::from_secs(5))?,
    )?)
}
fn until(window: &WebviewWindow, script: &str, stage: &'static str) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(90);
    while Instant::now() < deadline {
        if evaluate(window, script)
            .ok()
            .is_some_and(|value| value == true)
        {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err(stage.into())
}

pub fn run(app: tauri::AppHandle, window: WebviewWindow, config: Config) {
    thread::spawn(move || {
        let host = app.state::<Arc<Host>>().inner().clone();
        let result = (|| -> Result<serde_json::Value> {
            let opening_ms = host.started.elapsed().as_millis();
            if !window.is_visible()? {
                return Err("Opening window was hidden".into());
            }
            until(
                &window,
                "!!document.querySelector('.connected-nav')",
                "Workspace did not open",
            )?;
            let ready_ms = host.started.elapsed().as_millis();
            let restarted = config.state.parent().unwrap().join("window.json").exists();
            if restarted {
                until(&window, "document.querySelector('.working-surface:not([hidden]) .cm-content')?.textContent.includes('Synthetic العربية')", "Saved writing did not survive process restart")?;
            }
            if evaluate(&window, "typeof require==='undefined' && typeof process==='undefined' && !document.cookie.includes('atlas_local_owner')")? != true { return Err("Renderer isolation failed".into()); }
            // Native menu action follows the same capture event as Cmd+N.
            new_page(&app);
            until(
                &window,
                "document.activeElement?.getAttribute('aria-label')==='Note body'",
                "New page did not focus writing",
            )?;
            evaluate(&window, "document.execCommand('insertText',false,'## Tauri persistence check\\n\\nSynthetic العربية 😀');true")?;
            if evaluate(&window, PROBE)?["dirty"] != true {
                return Err("Unfinished writing was not detected".into());
            }
            request_action(&app, Action::Hide);
            let deadline = Instant::now() + Duration::from_secs(5);
            while host.closing.load(Ordering::SeqCst) && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(50));
            }
            if !window.is_visible()? || host.closing.load(Ordering::SeqCst) {
                return Err("Dirty close was not protected".into());
            }
            until(&window, "document.querySelector('.working-surface:not([hidden]) [role=status]')?.textContent==='Saved'", "Writing did not save")?;
            request_action(&app, Action::Reload);
            thread::sleep(Duration::from_millis(500));
            until(&window, "document.querySelector('.working-surface:not([hidden]) .cm-content')?.textContent.includes('Synthetic العربية')", "Saved writing did not reload")?;
            evaluate(&window, "window.__atlasNetworkDenied=null;fetch('https://example.invalid/tauri-test').then(()=>window.__atlasNetworkDenied=false).catch(()=>window.__atlasNetworkDenied=true);true")?;
            until(
                &window,
                "window.__atlasNetworkDenied===true",
                "External network was not denied",
            )?;
            let export = download_destination().ok_or("Missing synthetic export directory")?;
            if export.exists() {
                std::fs::remove_file(&export)?;
            }
            evaluate(&window, "(()=>{const url=URL.createObjectURL(new Blob(['Synthetic native export العربية'],{type:'text/markdown'}));const a=document.createElement('a');a.href=url;a.download='synthetic-export.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);return true;})()")?;
            let deadline = Instant::now() + Duration::from_secs(10);
            while !export.exists() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(50));
            }
            if std::fs::read_to_string(export).ok().as_deref()
                != Some("Synthetic native export العربية")
            {
                return Err("Native export did not preserve bytes".into());
            }
            evaluate(&window, "window.open('file:///tmp/not-an-app-page');true")?;
            if app.webview_windows().len() != 1 {
                return Err("Unexpected native popup".into());
            }
            evaluate(&window, "[...document.querySelectorAll('.connected-nav button')].find(b=>b.textContent==='Library').click();true")?;
            until(
                &window,
                "!!document.querySelector('.working-surface:not([hidden]) .library-book-title')",
                "Library did not load",
            )?;
            evaluate(&window, "document.querySelector('.working-surface:not([hidden]) .library-book-title').click();true")?;
            until(&window, "document.querySelectorAll('.working-surface:not([hidden]) [data-ayah]').length===176", "Complete Quran did not open")?;
            let manifest: serde_json::Value =
                serde_json::from_slice(&std::fs::read(config.resources.join("build.json"))?)?;
            let sqlite = manifest["kind"] == "offline-local-sqlite";
            if sqlite
                && (!config.state.join("sqlite-config.json").is_file()
                    || config.state.join("postgres-data").exists())
            {
                return Err("Synthetic SQLite storage selection did not match the bundle".into());
            }
            Ok(
                serde_json::json!({"nativeTauri":true,"realPostgresql":!sqlite,"realSqlite":sqlite,"openingWindowMs":opening_ms,"workspaceReadyMs":ready_ms,"rendererIsolation":true,"dirtyCloseProtected":true,"unicodeWritingReloaded":true,"processRestart":restarted,"nativeExport":true,"externalNetworkDenied":true,"unsafePopupDenied":true,"completeQuran":true,"ownerDataModified":false}),
            )
        })();
        let success = result.is_ok();
        let receipt = result.unwrap_or_else(
            |error| serde_json::json!({"failed":error.to_string(),"ownerDataModified":false}),
        );
        let _ = policy::write_private(&config.result_file, &receipt);
        host.backend.stop();
        host.finished.store(true, Ordering::SeqCst);
        app.exit(if success { 0 } else { 1 });
    });
}
