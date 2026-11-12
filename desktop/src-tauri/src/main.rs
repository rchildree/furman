#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod git;
mod workspace;
use base64::Engine;
use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::State;
use workspace::{Change, Root};
#[tauri::command]
async fn choose_folder() -> Result<Option<String>, String> {
    Ok(rfd::AsyncFileDialog::new()
        .set_title("Open the folder containing courses.yaml")
        .pick_folder()
        .await
        .map(|p| p.path().to_string_lossy().into()))
}
#[tauri::command]
fn open_library(path: String, state: State<Root>) -> Result<String, String> {
    let p = PathBuf::from(path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !p.join("courses.yaml").is_file() {
        return Err("Choose a course repository containing courses.yaml.".into());
    }
    if p.join(".syllabusser-recovery").exists() {
        return Err("An interrupted save was found. Recovery data is in .syllabusser-recovery; restore or inspect it before reopening.".into());
    }
    *state.lock().map_err(|e| e.to_string())? = Some(p.clone());
    Ok(p.to_string_lossy().into())
}
#[tauri::command]
fn read_files(
    paths: Vec<String>,
    state: State<Root>,
) -> Result<BTreeMap<String, Option<String>>, String> {
    let root = workspace::root(&state)?;
    paths
        .into_iter()
        .map(|p| workspace::read(&root, &p).map(|s| (p, s)))
        .collect()
}
#[tauri::command]
fn save_files(changes: Vec<Change>, state: State<Root>) -> Result<(), String> {
    workspace::save(&workspace::root(&state)?, &changes)
}
#[tauri::command]
fn list_files(dir: String, state: State<Root>) -> Result<Vec<String>, String> {
    workspace::files(&workspace::root(&state)?, &dir)
}
fn import(root: &std::path::Path, dir: &str, name: &str, bytes: &[u8]) -> Result<String, String> {
    if !dir.starts_with("courses/") || !dir.ends_with("/files") {
        return Err("Choose a course files folder.".into());
    }
    if name.contains('/') || name.contains('\\') || name.starts_with('.') || name.is_empty() {
        return Err("Invalid attachment name.".into());
    }
    if bytes.len() > 50_000_000 {
        return Err("Attachments must be under 50 MB.".into());
    }
    let directory = workspace::scoped(root, dir)?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let stem = std::path::Path::new(name)
        .file_stem()
        .unwrap()
        .to_string_lossy();
    let ext = std::path::Path::new(name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    for i in 0..1000 {
        let filename = if i == 0 {
            name.to_string()
        } else {
            format!("{stem}-{i}{ext}")
        };
        let rel = format!("{dir}/{filename}");
        let path = workspace::scoped(root, &rel)?;
        use std::io::Write;
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut f) => {
                if let Err(e) = f.write_all(bytes) {
                    let _ = fs::remove_file(path);
                    return Err(e.to_string());
                }
                return Ok(rel);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("Too many files with this name.".into())
}
#[tauri::command]
async fn import_files(dir: String, state: State<'_, Root>) -> Result<Vec<String>, String> {
    let root = workspace::root(&state)?;
    let picked = rfd::AsyncFileDialog::new()
        .set_title("Add course files")
        .pick_files()
        .await;
    let mut out = vec![];
    for file in picked.unwrap_or_default() {
        let p = file.path();
        if fs::metadata(p).map_err(|e| e.to_string())?.len() > 50_000_000 {
            return Err("Attachments must be under 50 MB.".into());
        }
        out.push(import(
            &root,
            &dir,
            &file.file_name(),
            &fs::read(p).map_err(|e| e.to_string())?,
        )?);
    }
    Ok(out)
}
#[derive(serde::Deserialize)]
struct Upload {
    name: String,
    base64: String,
}
#[tauri::command]
fn upload_files(
    dir: String,
    uploads: Vec<Upload>,
    state: State<Root>,
) -> Result<Vec<String>, String> {
    let root = workspace::root(&state)?;
    uploads
        .iter()
        .map(|u| {
            let b = base64::engine::general_purpose::STANDARD
                .decode(&u.base64)
                .map_err(|e| e.to_string())?;
            import(&root, &dir, &u.name, &b)
        })
        .collect()
}
#[tauri::command]
async fn git_review(state: State<'_, Root>) -> Result<git::Review, String> {
    let root = workspace::root(&state)?;
    tauri::async_runtime::spawn_blocking(move || git::review(&root))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn git_publish(
    token: String,
    paths: Vec<String>,
    message: String,
    state: State<'_, Root>,
) -> Result<git::Published, String> {
    let root = workspace::root(&state)?;
    tauri::async_runtime::spawn_blocking(move || git::publish(&root, &token, &paths, &message))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn git_push(head: String, state: State<'_, Root>) -> Result<git::Published, String> {
    let root = workspace::root(&state)?;
    tauri::async_runtime::spawn_blocking(move || git::push(&root, &head))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn deployment(state: State<'_, Root>) -> Result<serde_json::Value, String> {
    let root = workspace::root(&state)?;
    tauri::async_runtime::spawn_blocking(move || git::deployment(&root))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Only web links can be opened.".into());
    }
    std::process::Command::new("/usr/bin/open")
        .arg(url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn main() {
    let root: Root = Arc::new(Mutex::new(None));
    let preview_root = root.clone();
    tauri::Builder::default().manage(root)
    .register_uri_scheme_protocol("preview",move|_,request|{
        let result=(||->Result<(Vec<u8>,String),String>{
            let root=workspace::root(&preview_root)?;
            let relative=percent_encoding::percent_decode_str(request.uri().path().trim_start_matches('/')).decode_utf8().map_err(|e|e.to_string())?;
            let relative=if relative.is_empty(){"index.html"}else{relative.as_ref()};
            let path=workspace::scoped(&root,relative)?;
            let bytes=fs::read(&path).map_err(|e|e.to_string())?;
            let mime=mime_guess::from_path(&path).first_or_octet_stream().to_string();
            let bytes=if mime=="text/html"{
                let html=String::from_utf8(bytes).map_err(|e|e.to_string())?;
                // Preview is a sandboxed, separate origin with no native capabilities.
                let hook=format!("<script>{}</script>",include_str!("../../src/preview.js"));
                html.replace("</body>",&format!("{hook}</body>")).into_bytes()
            }else{bytes};Ok((bytes,mime))
        })();
        let (status,bytes,mime)=match result{Ok((b,m))=>(200,b,m),Err(_)=>(404,b"Not found".to_vec(),"text/plain".into())};
        tauri::http::Response::builder().status(status).header("Content-Type",mime).header("Access-Control-Allow-Origin","*").header("Cache-Control","no-store")
          .header("Content-Security-Policy","default-src 'self' preview: http://preview.localhost; script-src 'self' 'unsafe-inline' preview: http://preview.localhost; style-src 'self' 'unsafe-inline' preview: http://preview.localhost; img-src 'self' data: preview: http://preview.localhost; connect-src 'self' preview: http://preview.localhost; font-src 'self' preview: http://preview.localhost; object-src 'none'")
          .body(bytes).unwrap()
    })
    .invoke_handler(tauri::generate_handler![choose_folder,open_library,read_files,save_files,list_files,import_files,upload_files,git_review,git_publish,git_push,deployment,open_url])
    .run(tauri::generate_context!()).expect("Unable to start Syllabusser");
}
