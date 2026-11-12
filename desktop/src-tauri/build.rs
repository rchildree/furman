fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "choose_folder",
            "open_library",
            "read_files",
            "save_files",
            "list_files",
            "import_files",
            "upload_files",
            "git_review",
            "git_publish",
            "git_push",
            "deployment",
            "open_url",
        ]),
    ))
    .expect("Tauri build failed");
}
