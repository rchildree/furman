use crate::workspace::{self, scoped};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path, process::Command};
#[derive(Serialize, Deserialize, Clone)]
pub struct Entry {
    pub path: String,
    pub status: String,
    pub diff: String,
    pub hash: String,
}
#[derive(Serialize, Deserialize)]
pub struct Review {
    pub branch: String,
    pub remote: String,
    pub head: String,
    pub token: String,
    pub files: Vec<Entry>,
    pub excluded: usize,
    pub staged: bool,
    pub ahead: usize,
    pub behind: usize,
}
#[derive(Serialize)]
pub struct Published {
    pub commit: String,
    pub pushed: bool,
    pub message: String,
}
pub fn run(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("/usr/bin/git")
        .arg("-c")
        .arg("core.hooksPath=/dev/null")
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes -oConnectTimeout=15")
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
fn check_root(root: &Path) -> Result<(), String> {
    let top = run(root, &["rev-parse", "--show-toplevel"])?;
    if Path::new(top.trim())
        .canonicalize()
        .map_err(|e| e.to_string())?
        != root
    {
        return Err("Open the root of the Git repository to publish.".into());
    }
    Ok(())
}
pub fn review(root: &Path) -> Result<Review, String> {
    check_root(root)?;
    let branch = run(root, &["branch", "--show-current"])?.trim().to_string();
    if branch.is_empty() {
        return Err("Check out a branch before publishing.".into());
    }
    let head = run(root, &["rev-parse", "HEAD"])?.trim().to_string();
    let remote = run(root, &["remote", "get-url", "origin"])?
        .trim()
        .to_string();
    if !(remote.starts_with("https://github.com/") || remote.starts_with("git@github.com:")) {
        return Err(
            "Publishing currently supports a GitHub origin remote without embedded credentials."
                .into(),
        );
    }
    let raw = run(
        root,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--no-renames",
        ],
    )?;
    let staged = raw
        .split('\0')
        .filter(|x| x.len() > 3)
        .any(|x| !matches!(x.as_bytes()[0], b' ' | b'?'));
    let mut files = vec![];
    let mut excluded = 0;
    let mut signature = format!("{head}\n{branch}\n{remote}\n{raw}");
    for line in raw.split('\0').filter(|x| x.len() > 3) {
        let path = &line[3..];
        if !workspace::public_path(path) || scoped(root, path).is_err() {
            excluded += 1;
            continue;
        }
        let bytes = fs::read(scoped(root, path)?).unwrap_or_default();
        signature.push_str(&workspace::hash(&bytes));
        let mut diff = run(root, &["diff", "HEAD", "--", path])?;
        if diff.is_empty() && line.starts_with("??") {
            diff = match std::str::from_utf8(&bytes) {
                Ok(text) => text.lines().take(1000).map(|s| format!("+{s}\n")).collect(),
                Err(_) => format!("New file · {} bytes", bytes.len()),
            };
        }
        if diff.len() > 150_000 {
            let end = diff
                .char_indices()
                .map(|(i, _)| i)
                .take_while(|i| *i <= 150_000)
                .last()
                .unwrap_or(0);
            diff.truncate(end);
            diff.push_str("\n[Diff truncated]");
        }
        files.push(Entry {
            path: path.into(),
            status: line[..2].into(),
            diff,
            hash: if scoped(root, path)?.exists() {
                workspace::hash(&bytes)
            } else {
                "missing".into()
            },
        });
    }
    let counts = run(
        root,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    )
    .unwrap_or_default();
    let mut nums = counts.split_whitespace().filter_map(|s| s.parse().ok());
    let ahead = nums.next().unwrap_or(0);
    let behind = nums.next().unwrap_or(0);
    Ok(Review {
        branch,
        remote,
        head,
        token: workspace::hash(signature.as_bytes()),
        files,
        excluded,
        staged,
        ahead,
        behind,
    })
}
pub fn publish(
    root: &Path,
    token: &str,
    paths: &[String],
    message: &str,
) -> Result<Published, String> {
    let before = review(root)?;
    if before.token != token {
        return Err("Files changed since review. Refresh the review before publishing.".into());
    }
    if before.staged {
        return Err("Git already has staged changes. Commit or unstage those in VS Code before publishing from Syllabusser.".into());
    }
    if message.trim().is_empty() {
        return Err("Enter a commit message.".into());
    }
    if paths.is_empty() {
        return Err("Select files to publish.".into());
    }
    for path in paths {
        if !before.files.iter().any(|f| &f.path == path) {
            return Err("A selected file is outside this review.".into());
        }
    }
    run(root, &["fetch", "origin"])?;
    let upstream = run(root, &["rev-parse", "--abbrev-ref", "@{upstream}"]).map_err(|_| {
        "This branch needs an upstream on origin. Set it in VS Code before the first publish."
            .to_string()
    })?;
    if upstream.trim() != format!("origin/{}", before.branch) {
        return Err("The branch must track the same branch on origin.".into());
    }
    if review(root)?.behind > 0 {
        return Err(
            "GitHub has newer commits. Pull and resolve them in VS Code, then review again.".into(),
        );
    }
    if review(root)?.token != token {
        return Err("Files changed during the remote check. Refresh review.".into());
    }
    let hashes = before
        .files
        .iter()
        .map(|f| (f.path.clone(), f.hash.clone()))
        .collect();
    let commit = commit_selected(
        root,
        &before.head,
        &before.branch,
        paths,
        message,
        Some(&hashes),
    )?;
    push(root, &commit)
}
// Build the commit with an isolated index. Never stage unrelated working-tree
// changes, and take Git's index lock before changing the branch or real index.
fn commit_selected(
    root: &Path,
    head: &str,
    branch: &str,
    paths: &[String],
    message: &str,
    hashes: Option<&std::collections::BTreeMap<String, String>>,
) -> Result<String, String> {
    use std::io::Write;
    let index_path = run(root, &["rev-parse", "--git-path", "index"])?;
    let index_path = root.join(index_path.trim());
    let initial_index = fs::read(&index_path).map_err(|e| e.to_string())?;
    run(root, &["diff", "--cached", "--quiet"])
        .map_err(|_| "Staged files changed during publishing. Refresh review.".to_string())?;
    let temp = tempfile::tempdir_in(index_path.parent().unwrap()).map_err(|e| e.to_string())?;
    let index = temp.path().join("index");
    let indexed = |args: &[&str], input: Option<&[u8]>| -> Result<String, String> {
        use std::process::Stdio;
        let mut child = Command::new("/usr/bin/git")
            .args(args)
            .env("GIT_INDEX_FILE", &index)
            .current_dir(root)
            .stdin(if input.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        if let Some(bytes) = input {
            child
                .stdin
                .take()
                .unwrap()
                .write_all(bytes)
                .map_err(|e| e.to_string())?;
        }
        let o = child.wait_with_output().map_err(|e| e.to_string())?;
        if !o.status.success() {
            return Err(String::from_utf8_lossy(&o.stderr).trim().into());
        }
        Ok(String::from_utf8_lossy(&o.stdout).trim().into())
    };
    indexed(&["read-tree", head], None)?;
    for path in paths {
        let file = scoped(root, path)?;
        if file.exists() {
            let bytes = fs::read(&file).map_err(|e| e.to_string())?;
            if hashes.is_some_and(|h| h.get(path) != Some(&workspace::hash(&bytes))) {
                return Err(
                    "A selected file changed after review. Refresh before publishing.".into(),
                );
            }
            let blob = indexed(&["hash-object", "-w", "--stdin"], Some(&bytes))?;
            #[cfg(unix)]
            let mode = {
                use std::os::unix::fs::PermissionsExt;
                if fs::metadata(&file)
                    .map_err(|e| e.to_string())?
                    .permissions()
                    .mode()
                    & 0o111
                    != 0
                {
                    "100755"
                } else {
                    "100644"
                }
            };
            #[cfg(not(unix))]
            let mode = "100644";
            indexed(
                &["update-index", "--add", "--cacheinfo", mode, &blob, path],
                None,
            )?;
        } else {
            if hashes.is_some_and(|h| h.get(path).map(String::as_str) != Some("missing")) {
                return Err(
                    "A selected file was removed after review. Refresh before publishing.".into(),
                );
            }
            indexed(&["update-index", "--force-remove", "--", path], None)?;
        }
    }
    let tree = indexed(&["write-tree"], None)?;
    let commit = indexed(&["commit-tree", &tree, "-p", head, "-m", message], None)?;
    let lock = index_path.with_file_name("index.lock");
    let lock_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock)
        .map_err(|_| {
            "Git is busy. Try publishing again when the other Git operation finishes.".to_string()
        })?;
    struct Lock(std::path::PathBuf);
    impl Drop for Lock {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }
    let _guard = Lock(lock.clone());
    drop(lock_file);
    if fs::read(&index_path).map_err(|e| e.to_string())? != initial_index {
        return Err("Git's staged files changed during publishing. Refresh the review.".into());
    }
    fs::copy(&index, &lock).map_err(|e| e.to_string())?;
    let reference = format!("refs/heads/{branch}");
    run(
        root,
        &[
            "update-ref",
            "-m",
            "Syllabusser publish",
            &reference,
            &commit,
            head,
        ],
    )?;
    if let Err(e) = fs::rename(&lock, &index_path) {
        let rollback = run(root, &["update-ref", &reference, head, &commit]);
        return Err(format!(
            "Could not update the Git index: {e}. Branch rollback: {}",
            if rollback.is_ok() {
                "completed"
            } else {
                "failed; inspect Git before retrying"
            }
        ));
    }
    Ok(commit)
}

pub fn push(root: &Path, expected_head: &str) -> Result<Published, String> {
    let review = review(root)?;
    if review.head != expected_head {
        return Err("The local commit changed. Refresh review before pushing.".into());
    }
    let result = run(
        root,
        &[
            "push",
            "origin",
            &format!("HEAD:refs/heads/{}", review.branch),
        ],
    );
    Ok(Published{commit:review.head,pushed:result.is_ok(),message:match result{Ok(_)=>"Pushed to GitHub. Check deployment status to confirm the site is live.".into(),Err(e)=>format!("Commit saved locally; push failed. Retry push after fixing authentication or remote changes. {e}")}})
}
pub fn gh_path() -> String {
    for p in ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"] {
        if Path::new(p).exists() {
            return p.into();
        }
    }
    "gh".into()
}
pub fn deployment(root: &Path) -> Result<serde_json::Value, String> {
    let info = review(root)?;
    let remote = info.remote.trim_end_matches(".git");
    let repo = remote
        .strip_prefix("https://github.com/")
        .or_else(|| remote.strip_prefix("git@github.com:"))
        .ok_or("Unsupported remote")?;
    let api = |endpoint: &str| -> Result<serde_json::Value, String> {
        let out = Command::new(gh_path())
            .args(["api", endpoint])
            .current_dir(root)
            .output()
            .map_err(|_| "Install GitHub CLI to check deployments.".to_string())?;
        if !out.status.success() {
            return Err("Could not read deployment status. Sign in with GitHub CLI and check repository access.".into());
        }
        serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())
    };
    let runs = api(&format!(
        "repos/{repo}/actions/runs?head_sha={}&per_page=10",
        info.head
    ))?;
    let pages = api(&format!("repos/{repo}/pages")).ok();
    let build = api(&format!("repos/{repo}/pages/builds/latest")).ok();
    Ok(
        serde_json::json!({"commit":info.head,"runs":runs["workflow_runs"],"pages":pages,"build":build}),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        run(d.path(), &["init", "-b", "main"]).unwrap();
        run(d.path(), &["config", "user.name", "Test"]).unwrap();
        run(d.path(), &["config", "user.email", "test@example.invalid"]).unwrap();
        fs::create_dir(d.path().join("assets")).unwrap();
        fs::write(d.path().join("courses.yaml"), "old").unwrap();
        fs::write(d.path().join("notes.txt"), "unrelated").unwrap();
        run(d.path(), &["add", "."]).unwrap();
        run(d.path(), &["commit", "-m", "Initial"]).unwrap();
        d
    }
    #[test]
    fn commit_only_selected_files_and_keep_other_changes() {
        let d = fixture();
        let r = d.path();
        let head = run(r, &["rev-parse", "HEAD"]).unwrap();
        fs::write(r.join("courses.yaml"), "new").unwrap();
        fs::write(r.join("notes.txt"), "private draft").unwrap();
        fs::write(r.join("assets/custom.css"), "body{}").unwrap();
        let commit = commit_selected(
            r,
            head.trim(),
            "main",
            &["courses.yaml".into(), "assets/custom.css".into()],
            "Update course",
            None,
        )
        .unwrap();
        assert_ne!(commit, head.trim());
        assert_eq!(run(r, &["show", "HEAD:courses.yaml"]).unwrap(), "new");
        assert_eq!(run(r, &["show", "HEAD:notes.txt"]).unwrap(), "unrelated");
        assert!(run(r, &["diff", "--cached"]).unwrap().is_empty());
        assert!(run(r, &["diff", "--", "notes.txt"])
            .unwrap()
            .contains("private draft"));
    }
    #[test]
    fn existing_git_lock_preserves_head_and_index() {
        let d = fixture();
        let r = d.path();
        let head = run(r, &["rev-parse", "HEAD"]).unwrap();
        let index = fs::read(r.join(".git/index")).unwrap();
        fs::write(r.join("courses.yaml"), "new").unwrap();
        fs::write(r.join(".git/index.lock"), "other operation").unwrap();
        assert!(commit_selected(
            r,
            head.trim(),
            "main",
            &["courses.yaml".into()],
            "Update",
            None
        )
        .is_err());
        assert_eq!(run(r, &["rev-parse", "HEAD"]).unwrap(), head);
        assert_eq!(fs::read(r.join(".git/index")).unwrap(), index);
        assert_eq!(
            fs::read_to_string(r.join(".git/index.lock")).unwrap(),
            "other operation"
        );
    }
    #[test]
    fn stale_head_cannot_replace_a_new_commit() {
        let d = fixture();
        let r = d.path();
        let head = run(r, &["rev-parse", "HEAD"]).unwrap();
        run(r, &["commit", "--allow-empty", "-m", "Outside commit"]).unwrap();
        let new_head = run(r, &["rev-parse", "HEAD"]).unwrap();
        assert!(commit_selected(
            r,
            head.trim(),
            "main",
            &["courses.yaml".into()],
            "Update",
            None
        )
        .is_err());
        assert_eq!(run(r, &["rev-parse", "HEAD"]).unwrap(), new_head);
    }
}
