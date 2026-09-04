mod build;
mod parser;

use build::{build_rom, get_build_environment};
use parser::pokemon::{PokemonBaseStats, PokemonDetails};
use serde::Serialize;
use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_project,
            get_pokemon_base_stats,
            get_pokemon_index,
            get_pokemon_details,
            get_pokemon_tmhm_moves,
            get_moves,
            read_project_text,
            write_project_text,
            project_path_exists,
            resolve_project_asset,
            load_project_history,
            save_project_history,
            get_build_environment,
            build_rom
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectInfo {
    path: String,
    valid: bool,
    project_name: String,
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

    // Stable FNV-1a project key keeps absolute checkout paths out of filenames.
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

#[tauri::command]
fn open_project(path: String) -> Result<ProjectInfo, String> {
    let root = Path::new(&path);

    if !root.exists() {
        return Err("That folder does not exist.".into());
    }

    if !root.is_dir() {
        return Err("The selected path is not a folder.".into());
    }

    let required_files = ["main.asm", "Makefile"];

    for file in required_files {
        if !root.join(file).exists() {
            return Err(format!(
                "This does not appear to be a Pokémon disassembly project: missing {}",
                file
            ));
        }
    }

    let required_dirs = ["data", "engine", "maps"];

    for dir in required_dirs {
        if !root.join(dir).is_dir() {
            return Err(format!(
                "This does not appear to be a Pokémon disassembly project: missing {} directory",
                dir
            ));
        }
    }

    let project_name = if root.join("data").join("pokemon").join("mew.asm").exists() {
        "pokered"
    } else {
        "pokeyellow"
    };

    Ok(ProjectInfo {
        path,
        valid: true,
        project_name: project_name.into(),
    })
}

#[tauri::command]
fn get_pokemon_base_stats(
    project_path: String,
    pokemon: String,
) -> Result<PokemonBaseStats, String> {
    let path = std::path::Path::new(&project_path)
        .join("data")
        .join("pokemon")
        .join("base_stats")
        .join(format!("{}.asm", pokemon));

    parser::pokemon::parse_base_stats(&path)
}

#[tauri::command]
fn get_pokemon_tmhm_moves(
    project_path: String,
    source_slug: String,
) -> Result<Vec<String>, String> {
    let path = Path::new(&project_path)
        .join("data")
        .join("pokemon")
        .join("base_stats")
        .join(format!("{}.asm", source_slug));

    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    let mut moves = Vec::new();
    let mut collecting = false;

    for raw_line in contents.lines() {
        let line = raw_line.split(';').next().unwrap_or("").trim();

        if line.is_empty() {
            continue;
        }

        let values = if let Some(rest) = line.strip_prefix("tmhm ") {
            collecting = true;
            Some(rest)
        } else if collecting {
            Some(line)
        } else {
            None
        };

        let Some(values) = values else {
            continue;
        };

        let continues = values.trim_end().ends_with('\\');
        let values = values.trim_end_matches('\\').trim();

        for value in values.split(',') {
            let value = value.trim();
            if !value.is_empty() {
                moves.push(value.to_string());
            }
        }

        if !continues {
            break;
        }
    }

    Ok(moves)
}

#[tauri::command]
fn get_pokemon_index(
    project_path: String,
) -> Result<Vec<parser::pokemon::PokemonIndexEntry>, String> {
    let root = Path::new(&project_path);
    let mut entries = parser::pokemon::parse_pokemon_index(root)?;

    // pokered intentionally excludes Mew from data/pokemon/base_stats.asm,
    // even though data/pokemon/base_stats/mew.asm exists. If the checkout
    // contains that standalone file, expose it as Mew's normal source slug.
    let mew_stats_path = root
        .join("data")
        .join("pokemon")
        .join("base_stats")
        .join("mew.asm");

    if mew_stats_path.exists() {
        if let Some(mew) = entries
            .iter_mut()
            .find(|entry| entry.constant.as_deref() == Some("MEW"))
        {
            if mew.source_slug.is_none() {
                mew.source_slug = Some("mew".to_string());
            }
        }
    }

    Ok(entries)
}

#[tauri::command]
fn get_pokemon_details(
    project_path: String,
    internal_id: u8,
    source_slug: String,
) -> Result<PokemonDetails, String> {
    let root = Path::new(&project_path);

    let stats_path = root
        .join("data")
        .join("pokemon")
        .join("base_stats")
        .join(format!("{}.asm", source_slug));

    let stats = parser::pokemon::parse_base_stats(&stats_path)?;

    let (evolutions, learnset) = parser::pokemon::parse_evos_moves(root, internal_id)?;

    let pokedex = parser::pokemon::parse_pokedex_info(root, internal_id)?;

    let front_path = root
        .join("gfx")
        .join("pokemon")
        .join("front")
        .join(format!("{}.png", source_slug));

    let back_path = root
        .join("gfx")
        .join("pokemon")
        .join("back")
        .join(format!("{}b.png", source_slug));

    let sprites = parser::pokemon::PokemonSprites {
        front: front_path
            .exists()
            .then(|| front_path.to_string_lossy().to_string()),
        back: back_path
            .exists()
            .then(|| back_path.to_string_lossy().to_string()),
    };

    Ok(PokemonDetails {
        stats,
        evolutions,
        learnset,
        pokedex,
        sprites,
    })
}

#[tauri::command]
fn get_moves(
    project_path: String,
) -> Result<Vec<parser::moves::MoveData>, String> {
    parser::moves::parse_moves(Path::new(&project_path))
}
