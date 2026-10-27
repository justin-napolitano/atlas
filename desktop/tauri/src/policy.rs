//! Native boundary policy. No private value is included in error messages.
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::Path,
};
use url::Url;

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Announcement {
    format: u8,
    kind: String,
    port: u16,
}

pub fn announcement(line: &str) -> Result<Url> {
    if line.len() > 300 {
        return Err("Invalid service response".into());
    }
    let value: Announcement = serde_json::from_str(line)?;
    if value.format != 1 || value.kind != "atlas-local-owner" || value.port < 1024 {
        return Err("Invalid service response".into());
    }
    Ok(Url::parse(&format!("http://127.0.0.1:{}", value.port))?)
}

pub fn owned(url: &Url, origin: &Url) -> bool {
    url.origin() == origin.origin() && url.username().is_empty() && url.password().is_none()
}

pub fn page(url: &Url, origin: &Url) -> bool {
    owned(url, origin) && matches!(url.path(), "/workspace.html" | "/publish.html")
}

pub fn location(value: &str, origin: &Url) -> String {
    origin
        .join(value)
        .ok()
        .filter(|url| page(url, origin) && url.query().unwrap_or("").len() <= 4000)
        .map(|url| {
            format!(
                "{}{}",
                url.path(),
                url.query().map(|s| format!("?{s}")).unwrap_or_default()
            )
        })
        .unwrap_or_else(|| "/workspace.html".into())
}

pub fn external(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return false;
    }
    match url.host_str() {
        Some(host) => {
            !(host == "localhost"
                || host.ends_with(".localhost")
                || host == "[::1]"
                || host == "0.0.0.0"
                || host.starts_with("127."))
        }
        None => false,
    }
}

pub fn filename(value: &str) -> String {
    let value = value.rsplit(['/', '\\']).next().unwrap_or("");
    let clean: String = value
        .chars()
        .filter(|c| !c.is_control())
        .take(180)
        .collect();
    if clean.is_empty() || clean == "." || clean == ".." {
        "Atlas export.md".into()
    } else {
        clean
    }
}

pub fn private_json<T: DeserializeOwned>(path: &Path) -> Result<T> {
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)?;
    let info = file.metadata()?;
    if !info.is_file()
        || info.len() > 4096
        || info.mode() & 0o077 != 0
        || info.uid() != unsafe { libc::geteuid() }
    {
        return Err("Private local configuration required".into());
    }
    let mut bytes = Vec::new();
    (&mut file).take(4097).read_to_end(&mut bytes)?;
    if bytes.len() > 4096 {
        return Err("Invalid private configuration".into());
    }
    Ok(serde_json::from_slice(&bytes)?)
}

pub fn write_private<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let parent = path.parent().ok_or("Invalid preferences directory")?;
    fs::create_dir_all(parent)?;
    let info = fs::symlink_metadata(parent)?;
    if !info.is_dir() || info.uid() != unsafe { libc::geteuid() } {
        return Err("Invalid preferences directory".into());
    }
    fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
    let temporary = path.with_extension("tmp");
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&temporary)?;
    file.set_permissions(fs::Permissions::from_mode(0o600))?;
    file.write_all(&serde_json::to_vec(value)?)?;
    file.sync_all()?;
    fs::rename(temporary, path)?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Credentials {
    pub launch: String,
    pub session: String,
}
impl Credentials {
    pub fn validate(&self) -> bool {
        [&self.launch, &self.session].iter().all(|s| {
            (43..=128).contains(&s.len())
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        })
    }
}

#[derive(Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    pub width: f64,
    pub height: f64,
    pub location: String,
    pub backend_port: u16,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            width: 1280.0,
            height: 860.0,
            location: "/workspace.html".into(),
            backend_port: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reject_foreign_service_and_navigation() {
        for line in [
            r#"{"format":1,"kind":"atlas-local-owner","port":80}"#,
            r#"{"format":1,"kind":"atlas-local-owner","port":5187,"host":"evil.example"}"#,
        ] {
            assert!(announcement(line).is_err());
        }
        let origin =
            announcement(r#"{"format":1,"kind":"atlas-local-owner","port":5187}"#).unwrap();
        for value in [
            "http://localhost:5187/workspace.html",
            "http://127.0.0.1:5188/workspace.html",
            "http://user@127.0.0.1:5187/workspace.html",
            "file:///workspace.html",
            "http://127.0.0.1:5187/local/login",
        ] {
            assert!(!page(&Url::parse(value).unwrap(), &origin));
        }
        assert_eq!(
            location("//evil.example/workspace.html", &origin),
            "/workspace.html"
        );
        assert_eq!(
            location("/workspace.html?view=continue", &origin),
            "/workspace.html?view=continue"
        );
    }
    #[test]
    fn external_schemes_and_download_names() {
        for value in [
            "file:///tmp/x",
            "javascript:alert(1)",
            "https://user:pass@example.org",
            "http://127.1/",
            "http://localhost/",
            "http://[::1]/",
        ] {
            assert!(!external(&Url::parse(value).unwrap()));
        }
        assert!(external(
            &Url::parse("https://doi.org/10.1/example").unwrap()
        ));
        assert_eq!(filename("../../note.md"), "note.md");
        assert_eq!(filename(".."), "Atlas export.md");
    }
    #[test]
    fn private_files_reject_symlinks_and_public_modes() {
        let dir = std::env::temp_dir().join(format!("atlas-policy-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("window.json");
        write_private(&path, &Preferences::default()).unwrap();
        assert!(private_json::<Preferences>(&path).is_ok());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(private_json::<Preferences>(&path).is_err());
        let link = dir.join("link.json");
        std::os::unix::fs::symlink(&path, &link).unwrap();
        assert!(private_json::<Preferences>(&link).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
