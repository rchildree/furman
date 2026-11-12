import { lstat, symlink } from "node:fs/promises";
const target = "src-tauri/target/release/bundle/macos/Syllabusser.app";
try {
  await lstat("Syllabusser.app");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  await symlink(target, "Syllabusser.app");
}
