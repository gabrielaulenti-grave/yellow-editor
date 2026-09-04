mod parser;

use parser::pokemon::{
    PokemonBaseStats,
    PokemonDetails,
};
use std::fs;
use std::path::Path;
use serde::Serialize;

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
            get_pokemon_tmhm_moves
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

#[tauri::command]
fn open_project(path: String) -> Result<ProjectInfo, String> {
    let root = Path::new(&path);

    if !root.exists() {
        return Err("That folder does not exist.".into());
    }

    if !root.is_dir() {
        return Err("The selected path is not a folder.".into());
    }

    let required_files = [
        "main.asm",
        "Makefile",
    ];

    for file in required_files {
        if !root.join(file).exists() {
            return Err(format!(
                "This does not appear to be a Pokémon disassembly project: missing {}",
                file
            ));
        }
    }

    let required_dirs = [
        "data",
        "engine",
        "maps",
    ];

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
        let line = raw_line
            .split(';')
            .next()
            .unwrap_or("")
            .trim();

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

    let stats =
        parser::pokemon::parse_base_stats(&stats_path)?;

    let (evolutions, learnset) =
        parser::pokemon::parse_evos_moves(root, internal_id)?;

    let pokedex =
        parser::pokemon::parse_pokedex_info(root, internal_id)?;

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
