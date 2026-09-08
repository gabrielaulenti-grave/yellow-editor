use serde::Serialize;
use std::fs;
use std::io::{Cursor, ErrorKind};
use std::path::{Component, Path, PathBuf};
use tauri::Manager;

const MAX_DECODED_PNG_PIXELS: u64 = 16 * 1024 * 1024;
const MAX_PNG_INPUT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DecodedPngImage {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_project_text,
            read_project_bytes,
            decode_png_rgba,
            write_project_text,
            project_path_exists,
            resolve_project_asset,
            load_project_history,
            save_project_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn project_relative_path(project_path: &str, relative_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);

    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(format!(
            "Project paths must be relative to the selected project: {}",
            relative_path
        ));
    }

    Ok(Path::new(project_path).join(relative))
}

fn write_text_atomically(path: &Path, contents: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Could not determine parent directory for {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Invalid UTF-8 filename: {}", path.display()))?;
    let temp_path = parent.join(format!(".{}.yellow-editor.tmp", file_name));
    let backup_path = parent.join(format!(".{}.yellow-editor.bak", file_name));

    if temp_path.exists() {
        fs::remove_file(&temp_path)
            .map_err(|e| format!("Failed to remove stale {}: {}", temp_path.display(), e))?;
    }

    fs::write(&temp_path, contents)
        .map_err(|e| format!("Failed to write {}: {}", temp_path.display(), e))?;

    #[cfg(not(windows))]
    {
        fs::rename(&temp_path, path).map_err(|e| {
            let _ = fs::remove_file(&temp_path);
            format!("Failed to replace {}: {}", path.display(), e)
        })?;
    }

    #[cfg(windows)]
    {
        if backup_path.exists() {
            fs::remove_file(&backup_path).map_err(|e| {
                format!("Failed to remove stale {}: {}", backup_path.display(), e)
            })?;
        }

        if path.exists() {
            fs::rename(path, &backup_path).map_err(|e| {
                let _ = fs::remove_file(&temp_path);
                format!("Failed to prepare {} for replacement: {}", path.display(), e)
            })?;
        }

        if let Err(error) = fs::rename(&temp_path, path) {
            if backup_path.exists() {
                let _ = fs::rename(&backup_path, path);
            }
            let _ = fs::remove_file(&temp_path);
            return Err(format!("Failed to replace {}: {}", path.display(), error));
        }

        if backup_path.exists() {
            let _ = fs::remove_file(&backup_path);
        }
    }

    Ok(())
}

fn project_history_path(app: &tauri::AppHandle, project_path: &str) -> Result<PathBuf, String> {
    let normalized = if cfg!(windows) {
        project_path.replace('\\', "/").to_lowercase()
    } else {
        project_path.to_string()
    };

    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in normalized.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }

    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not locate Yellow Editor app data: {}", e))?
        .join("history");

    fs::create_dir_all(&directory)
        .map_err(|e| format!("Failed to create {}: {}", directory.display(), e))?;

    Ok(directory.join(format!("{:016x}.json", hash)))
}

#[tauri::command]
fn read_project_text(project_path: String, relative_path: String) -> Result<String, String> {
    let path = project_relative_path(&project_path, &relative_path)?;
    fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))
}

#[tauri::command]
fn read_project_bytes(project_path: String, relative_path: String) -> Result<Vec<u8>, String> {
    let path = project_relative_path(&project_path, &relative_path)?;
    fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))
}

#[tauri::command]
fn decode_png_rgba(bytes: Vec<u8>) -> Result<DecodedPngImage, String> {
    if bytes.is_empty() {
        return Err("PNG input is empty.".into());
    }
    if bytes.len() > MAX_PNG_INPUT_BYTES {
        return Err(format!(
            "PNG input is too large to decode safely ({} bytes).",
            bytes.len()
        ));
    }

    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|error| format!("Could not read PNG header: {}", error))?;

    let source_info = reader.info();
    let pixel_count = u64::from(source_info.width) * u64::from(source_info.height);
    if pixel_count == 0 || pixel_count > MAX_DECODED_PNG_PIXELS {
        return Err(format!(
            "PNG dimensions {}x{} are outside Yellow Editor's supported range.",
            source_info.width, source_info.height
        ));
    }

    let mut buffer = vec![0; reader.output_buffer_size()];
    let output = reader
        .next_frame(&mut buffer)
        .map_err(|error| format!("Could not decode PNG pixels: {}", error))?;

    if output.bit_depth != png::BitDepth::Eight {
        return Err(format!(
            "PNG decoder returned unsupported {:?} channel depth.",
            output.bit_depth
        ));
    }

    let source = &buffer[..output.buffer_size()];
    let rgba_capacity = usize::try_from(pixel_count)
        .ok()
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "PNG dimensions overflow the RGBA output buffer.".to_string())?;
    let mut rgba = Vec::with_capacity(rgba_capacity);

    match output.color_type {
        png::ColorType::Grayscale => {
            for &gray in source {
                rgba.extend_from_slice(&[gray, gray, gray, 0xff]);
            }
        }
        png::ColorType::GrayscaleAlpha => {
            for pixel in source.chunks_exact(2) {
                rgba.extend_from_slice(&[pixel[0], pixel[0], pixel[0], pixel[1]]);
            }
        }
        png::ColorType::Rgb => {
            for pixel in source.chunks_exact(3) {
                rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 0xff]);
            }
        }
        png::ColorType::Rgba => rgba.extend_from_slice(source),
        png::ColorType::Indexed => {
            return Err("PNG palette data was not expanded by the native decoder.".into());
        }
    }

    if rgba.len() != rgba_capacity {
        return Err(format!(
            "Decoded PNG produced {} RGBA bytes; expected {}.",
            rgba.len(), rgba_capacity
        ));
    }

    Ok(DecodedPngImage {
        width: output.width,
        height: output.height,
        rgba,
    })
}

#[tauri::command]
fn write_project_text(
    project_path: String,
    relative_path: String,
    contents: String,
) -> Result<(), String> {
    let path = project_relative_path(&project_path, &relative_path)?;

    if !path.is_file() {
        return Err(format!(
            "Yellow Editor only writes existing project files: {}",
            path.display()
        ));
    }

    write_text_atomically(&path, &contents)
}

#[tauri::command]
fn project_path_exists(project_path: String, relative_path: String) -> Result<bool, String> {
    let path = project_relative_path(&project_path, &relative_path)?;
    Ok(path.exists())
}

#[tauri::command]
fn resolve_project_asset(
    project_path: String,
    relative_path: String,
) -> Result<Option<String>, String> {
    let path = project_relative_path(&project_path, &relative_path)?;

    if !path.is_file() {
        return Ok(None);
    }

    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
fn load_project_history(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<Option<String>, String> {
    let path = project_history_path(&app, &project_path)?;

    match fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Failed to read {}: {}", path.display(), error)),
    }
}

#[tauri::command]
fn save_project_history(
    app: tauri::AppHandle,
    project_path: String,
    contents: String,
) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&contents)
        .map_err(|e| format!("Refusing to store invalid history JSON: {}", e))?;

    let path = project_history_path(&app, &project_path)?;
    write_text_atomically(&path, &contents)
}
