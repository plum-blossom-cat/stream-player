fn main() {
    // The window and .exe icons are embedded at compile time; without this,
    // cargo reuses the old build and keeps the previous icon after `tauri icon`.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
