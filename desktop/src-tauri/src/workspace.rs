use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
};
pub type Root = Arc<Mutex<Option<PathBuf>>>;
pub fn root(state: &Root) -> Result<PathBuf, String> {
    state
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("Open a course folder first.".into())
}
pub fn public_path(path: &str) -> bool {
    path == "courses.yaml"
        || path == "index.html"
        || path == ".nojekyll"
        || path.starts_with("courses/")
        || path.starts_with("assets/")
}
pub fn scoped(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty() || relative.contains('\\') || !public_path(relative) {
        return Err("This path is outside the course site.".into());
    }
    let path = Path::new(relative);
    for part in path.components() {
        match part {
            Component::Normal(name)
                if !name.to_string_lossy().starts_with('.') || relative == ".nojekyll" =>
            {
                ()
            }
            _ => return Err("Invalid site path.".into()),
        }
    }
    let dest = root.join(path);
    let mut ancestor = dest.as_path();
    while !ancestor.exists() {
        // Broken symlinks are still symlinks, and must never be followed.
        if fs::symlink_metadata(ancestor).is_ok() {
            return Err("Symbolic links are not supported.".into());
        }
        ancestor = ancestor.parent().ok_or("Invalid path")?;
    }
    if !ancestor
        .canonicalize()
        .map_err(|e| e.to_string())?
        .starts_with(root.canonicalize().map_err(|e| e.to_string())?)
    {
        return Err("Path leaves the course folder.".into());
    }
    // Reject all symlinks, including in-root ones, to keep writes and preview predictable.
    let mut cursor = root.to_path_buf();
    for part in path.components() {
        cursor.push(part);
        if fs::symlink_metadata(&cursor)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
        {
            return Err("Symbolic links are not supported.".into());
        }
    }
    Ok(dest)
}
pub fn read(root: &Path, path: &str) -> Result<Option<String>, String> {
    let p = scoped(root, path)?;
    if !p.exists() {
        return Ok(None);
    }
    if fs::metadata(&p).map_err(|e| e.to_string())?.len() > 10_000_000 {
        return Err("Text file exceeds 10 MB.".into());
    }
    fs::read_to_string(p)
        .map(Some)
        .map_err(|e| format!("{path}: {e}"))
}
#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct Change {
    pub path: String,
    pub expected: Option<String>,
    pub text: String,
}
pub fn save(root: &Path, changes: &[Change]) -> Result<(), String> {
    let mut seen = HashSet::new();
    for c in changes {
        if !seen.insert(&c.path) {
            return Err("A file was listed twice.".into());
        }
        let ext = Path::new(&c.path)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        if !["yaml", "yml", "md", "css", "html"].contains(&ext) {
            return Err("Only course text files can be saved here.".into());
        }
        if c.text.len() > 10_000_000 {
            return Err("Text exceeds 10 MB.".into());
        }
        if read(root, &c.path)? != c.expected {
            return Err(format!("{} changed outside Syllabusser. Your draft is kept. Reload the file before saving.",c.path));
        }
    }
    if changes.is_empty() {
        return Ok(());
    }
    let txn = root.join(".syllabusser-recovery");
    fs::create_dir(&txn).map_err(|_|"An unfinished save needs recovery. See .syllabusser-recovery in this folder; no files have been overwritten.".to_string())?;
    let prepared = (|| -> Result<(), String> {
        fs::write(
            txn.join("changes.json"),
            serde_json::to_vec_pretty(changes).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        for (i, c) in changes.iter().enumerate() {
            fs::write(txn.join(i.to_string()), &c.text).map_err(|e| e.to_string())?;
        }
        for c in changes {
            if read(root, &c.path)? != c.expected {
                return Err(format!("{} changed during saving; try reloading.", c.path));
            }
        }
        Ok(())
    })();
    if let Err(e) = prepared {
        let _ = fs::remove_dir_all(&txn);
        return Err(e);
    }
    let mut applied: Vec<&Change> = vec![];
    for (i, c) in changes.iter().enumerate() {
        let dest = scoped(root, &c.path)?;
        let result = fs::create_dir_all(dest.parent().unwrap())
            .and_then(|_| fs::rename(txn.join(i.to_string()), &dest));
        if let Err(e) = result {
            let mut failed = false;
            for old in applied.iter().rev() {
                let p = scoped(root, &old.path)?;
                let r = match &old.expected {
                    Some(text) => fs::write(p, text),
                    None => fs::remove_file(p),
                };
                if r.is_err() {
                    failed = true;
                }
            }
            if !failed {
                let _ = fs::remove_dir_all(&txn);
            }
            return Err(format!(
                "Save failed: {e}. {}",
                if failed {
                    "Recovery copies remain in .syllabusser-recovery."
                } else {
                    "Earlier files were restored."
                }
            ));
        }
        applied.push(c);
    }
    fs::remove_dir_all(txn)
        .map_err(|e| format!("Files saved, but recovery cleanup failed: {e}"))?;
    Ok(())
}
pub fn files(root: &Path, dir: &str) -> Result<Vec<String>, String> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) -> Result<(), String> {
        if !dir.exists() {
            return Ok(());
        }
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if entry.file_name().to_string_lossy().starts_with('.') || kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                walk(root, &entry.path(), out)?;
            } else {
                out.push(
                    entry
                        .path()
                        .strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .into(),
                );
            }
            if out.len() > 20_000 {
                return Err("Too many site files.".into());
            }
        }
        Ok(())
    }
    let mut out = vec![];
    walk(root, &scoped(root, dir)?, &mut out)?;
    out.sort();
    Ok(out)
}
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_escape_and_symlinks() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path().canonicalize().unwrap();
        assert!(scoped(&r, "courses/../../secret").is_err());
        assert!(scoped(&r, ".git/config").is_err());
        assert!(scoped(&r, "assets/.hidden").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/tmp", r.join("assets")).unwrap();
            assert!(scoped(&r, "assets/a.css").is_err());
        }
    }
    #[test]
    fn stale_second_file_does_not_write_first() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        fs::write(r.join("courses.yaml"), "old").unwrap();
        let c = vec![
            Change {
                path: "courses.yaml".into(),
                expected: Some("old".into()),
                text: "new".into(),
            },
            Change {
                path: "assets/theme.css".into(),
                expected: Some("missing".into()),
                text: "css".into(),
            },
        ];
        assert!(save(r, &c).is_err());
        assert_eq!(read(r, "courses.yaml").unwrap().unwrap(), "old");
        assert!(!r.join(".syllabusser-recovery").exists());
    }
    #[test]
    fn saves_pair_and_refuses_existing_recovery() {
        let d = tempfile::tempdir().unwrap();
        let c = vec![
            Change {
                path: "courses.yaml".into(),
                expected: None,
                text: "courses: []".into(),
            },
            Change {
                path: "assets/theme.css".into(),
                expected: None,
                text: "/* theme */".into(),
            },
        ];
        save(d.path(), &c).unwrap();
        assert_eq!(
            read(d.path(), "assets/theme.css").unwrap().unwrap(),
            "/* theme */"
        );
        fs::create_dir(d.path().join(".syllabusser-recovery")).unwrap();
        assert!(save(
            d.path(),
            &[Change {
                path: "courses.yaml".into(),
                expected: Some("courses: []".into()),
                text: "changed".into()
            }]
        )
        .is_err());
    }
}
