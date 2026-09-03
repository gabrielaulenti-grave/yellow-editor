use serde::Serialize;
use std::fs;
use std::path::Path;
use std::collections::HashMap;

fn parse_base_stats_slugs(
    project_root: &Path,
) -> Result<HashMap<String, String>, String> {
    let path = project_root
        .join("data")
        .join("pokemon")
        .join("base_stats.asm");

    let contents = fs::read_to_string(&path)
        .map_err(|e| {
            format!(
                "Failed to read {}: {}",
                path.display(),
                e
            )
        })?;

    let mut result = HashMap::new();

    for line in contents.lines() {
        let line = line.trim();

        let Some(include_path) = line.strip_prefix("INCLUDE \"") else {
            continue;
        };

        let Some(include_path) = include_path.strip_suffix('"') else {
            continue;
        };

        let prefix = "data/pokemon/base_stats/";
        let Some(filename) = include_path.strip_prefix(prefix) else {
            continue;
        };

        let Some(slug) = filename.strip_suffix(".asm") else {
            continue;
        };

        result.insert(
            normalize_species_name(slug),
            slug.to_string(),
        );
    }

    Ok(result)
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PokemonSprites {
    pub front: Option<String>,
    pub back: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PokemonBaseStats {
    pub dex_constant: String,
    pub hp: u8,
    pub attack: u8,
    pub defense: u8,
    pub speed: u8,
    pub special: u8,
    pub type1: String,
    pub type2: String,
    pub catch_rate: u8,
    pub base_exp: u8,
}

pub fn parse_base_stats(path: &Path) -> Result<PokemonBaseStats, String> {
    let contents = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    let mut data_lines = contents
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && !line.starts_with(';')
        });

    // 1. Pokédex ID
    let dex_line = data_lines
        .next()
        .ok_or("Missing Pokédex ID")?;

    let dex_constant = parse_db_values(dex_line)?
        .first()
        .ok_or("Missing Pokédex constant")?
        .to_string();

    // 2. Five base stats
    let stats_line = data_lines
        .next()
        .ok_or("Missing base stats")?;

    let stats = parse_db_values(stats_line)?;

    if stats.len() != 5 {
        return Err(format!(
            "Expected 5 base stats, found {}",
            stats.len()
        ));
    }

    let hp = parse_u8(&stats[0])?;
    let attack = parse_u8(&stats[1])?;
    let defense = parse_u8(&stats[2])?;
    let speed = parse_u8(&stats[3])?;
    let special = parse_u8(&stats[4])?;

    // 3. Types
    let types_line = data_lines
        .next()
        .ok_or("Missing types")?;

    let types = parse_db_values(types_line)?;

    if types.len() != 2 {
        return Err("Expected exactly 2 Pokémon types".into());
    }

    // 4. Catch rate
    let catch_rate_line = data_lines
        .next()
        .ok_or("Missing catch rate")?;

    let catch_rate = parse_single_u8(catch_rate_line)?;

    // 5. Base experience
    let base_exp_line = data_lines
        .next()
        .ok_or("Missing base experience")?;

    let base_exp = parse_single_u8(base_exp_line)?;

    Ok(PokemonBaseStats {
        dex_constant,
        hp,
        attack,
        defense,
        speed,
        special,
        type1: types[0].clone(),
        type2: types[1].clone(),
        catch_rate,
        base_exp,
    })
}
fn parse_db_values(line: &str) -> Result<Vec<String>, String> {
    let without_comment = line
        .split(';')
        .next()
        .unwrap_or("")
        .trim();

    let data = without_comment
        .strip_prefix("db")
        .ok_or_else(|| format!("Expected db directive: {}", line))?
        .trim();

    Ok(data
        .split(',')
        .map(|value| value.trim().to_string())
        .collect())
}

fn parse_u8(value: &str) -> Result<u8, String> {
    value
        .parse::<u8>()
        .map_err(|_| format!("Expected integer, got '{}'", value))
}

fn parse_single_u8(line: &str) -> Result<u8, String> {
    let values = parse_db_values(line)?;

    if values.len() != 1 {
        return Err(format!(
            "Expected one value, found {}",
            values.len()
        ));
    }

    parse_u8(&values[0])
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PokemonIndexEntry {
    pub internal_id: u8,
    pub constant: Option<String>,
    pub display_name: String,
    pub kind: String,

    pub source_slug: Option<String>,
}

pub fn parse_pokemon_index(
    project_root: &Path,
) -> Result<Vec<PokemonIndexEntry>, String> {
    let source_slugs = parse_base_stats_slugs(project_root)?;

    let path = project_root
        .join("constants")
        .join("pokemon_constants.asm");

    let contents = fs::read_to_string(&path)
        .map_err(|e| {
            format!(
                "Failed to read {}: {}",
                path.display(),
                e
            )
        })?;

    let mut entries = Vec::new();
    let mut current_id: u16 = 0;

    for raw_line in contents.lines() {
        let line = raw_line
            .split(';')
            .next()
            .unwrap_or("")
            .trim();

        if line.is_empty() {
            continue;
        }

        if line == "const_def" {
            current_id = 0;
            continue;
        }

        if line == "const_skip" {
            entries.push(PokemonIndexEntry {
                internal_id: current_id as u8,
                constant: None,
                display_name: "MissingNo.".to_string(),
                kind: "missingno".to_string(),
                source_slug: None,
            });

            current_id += 1;
            continue;
        }

        if let Some(name) = line.strip_prefix("const ") {
            let constant = name.trim().to_string();

            let kind = match constant.as_str() {
                "FOSSIL_KABUTOPS"
                | "FOSSIL_AERODACTYL"
                | "MON_GHOST" => "special",

                "NO_MON" => "system",

                _ => "pokemon",
            };

            let normalized =
                normalize_species_name(&constant);

            let source_slug =
                source_slugs.get(&normalized).cloned();

            entries.push(PokemonIndexEntry {
                internal_id: current_id as u8,
                constant: Some(constant.clone()),
                display_name: format_display_name(&constant),
                kind: kind.to_string(),
                source_slug,
            });

            current_id += 1;
        }
    }

    Ok(entries)
}
fn normalize_species_name(name: &str) -> String {
    name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}
fn format_display_name(constant: &str) -> String {
    match constant {
        "NIDORAN_M" => "Nidoran♂".to_string(),
        "NIDORAN_F" => "Nidoran♀".to_string(),
        "MR_MIME" => "Mr. Mime".to_string(),
        "FARFETCHD" => "Farfetch'd".to_string(),
        "FOSSIL_KABUTOPS" => "Fossil Kabutops".to_string(),
        "FOSSIL_AERODACTYL" => "Fossil Aerodactyl".to_string(),
        "MON_GHOST" => "Ghost".to_string(),
        "NO_MON" => "No Pokémon".to_string(),

        _ => {
            let lowercase = constant.to_lowercase();

            let mut chars = lowercase.chars();

            match chars.next() {
                Some(first) => {
                    first.to_uppercase().collect::<String>()
                        + chars.as_str()
                }
                None => String::new(),
            }
        }
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnsetMove {
    pub level: u8,
    pub move_constant: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evolution {
    pub method: String,
    pub level: Option<u8>,
    pub item: Option<String>,
    pub target: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PokedexTextLine {
    pub kind: String,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PokedexInfo {
    pub category: String,
    pub height_feet: u8,
    pub height_inches: u8,
    pub weight_tenths_lb: u16,
    pub text_label: String,
    pub text_lines: Vec<PokedexTextLine>,
}
fn parse_pokedex_text(
    project_root: &Path,
    text_label: &str,
) -> Result<Vec<PokedexTextLine>, String> {
    let path = project_root
        .join("data")
        .join("pokemon")
        .join("dex_text.asm");

    let contents = fs::read_to_string(&path)
        .map_err(|e| {
            format!(
                "Failed to read {}: {}",
                path.display(),
                e
            )
        })?;

    let marker = format!("{}::", text_label);

    let start = contents
        .find(&marker)
        .ok_or_else(|| {
            format!(
                "Could not find Pokédex text label {}",
                marker
            )
        })?;

    let block = &contents[start + marker.len()..];

    let mut lines = Vec::new();

    for raw_line in block.lines() {
        let line = raw_line.trim();

        if line.is_empty() {
            continue;
        }

        if line == "dex" {
            break;
        }

        if line.ends_with("::") {
            break;
        }

        for kind in ["text", "next", "page"] {
            let prefix = format!("{} \"", kind);

            if let Some(value) = line
                .strip_prefix(&prefix)
                .and_then(|s| s.strip_suffix('"'))
            {
                lines.push(PokedexTextLine {
                    kind: kind.to_string(),
                    text: value.to_string(),
                });

                break;
            }
        }
    }

    Ok(lines)
}
fn parse_text_directive(
    line: &str,
    directive: &str,
) -> Option<String> {
    let prefix = format!("{} \"", directive);

    let value = line
        .strip_prefix(&prefix)?
        .strip_suffix('"')?;

    Some(value.to_string())
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PokemonDetails {
    pub stats: PokemonBaseStats,
    pub evolutions: Vec<Evolution>,
    pub learnset: Vec<LearnsetMove>,
    pub pokedex: Option<PokedexInfo>,
    pub sprites: PokemonSprites,
}
fn parse_evos_moves_pointer_table(
    project_root: &Path,
) -> Result<Vec<String>, String> {
    let path = project_root
        .join("data")
        .join("pokemon")
        .join("evos_moves.asm");

    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    let mut labels = Vec::new();
    let mut in_table = false;

    for raw_line in contents.lines() {
        let line = raw_line.trim();

        if line == "EvosMovesPointerTable:" {
            in_table = true;
            continue;
        }

        if !in_table {
            continue;
        }

        if line.starts_with("assert_table_length") {
            break;
        }

        if let Some(label) = line.strip_prefix("dw ") {
            labels.push(label.trim().to_string());
        }
    }

    Ok(labels)
}
pub fn parse_evos_moves(
    project_root: &Path,
    internal_id: u8,
) -> Result<(Vec<Evolution>, Vec<LearnsetMove>), String> {
    let path = project_root
        .join("data")
        .join("pokemon")
        .join("evos_moves.asm");

    let contents = fs::read_to_string(&path)
        .map_err(|e| e.to_string())?;

    let labels = parse_evos_moves_pointer_table(project_root)?;

    if internal_id == 0 {
        return Ok((Vec::new(), Vec::new()));
    }

    let label = labels
        .get((internal_id - 1) as usize)
        .ok_or("No EvosMoves pointer for internal ID")?;

    let marker = format!("{}:", label);

    let start = contents
        .find(&marker)
        .ok_or_else(|| format!("Could not find {}", marker))?;

    let block = &contents[start + marker.len()..];

    parse_evos_moves_block(block)
}
fn parse_evos_moves_block(
    block: &str,
) -> Result<(Vec<Evolution>, Vec<LearnsetMove>), String> {
    let mut evolutions = Vec::new();
    let mut learnset = Vec::new();

    enum Phase {
        Evolutions,
        Learnset,
    }

    let mut phase = Phase::Evolutions;

    for raw_line in block.lines() {
        let line = raw_line
            .split(';')
            .next()
            .unwrap_or("")
            .trim();

        if line.is_empty() {
            continue;
        }

        // Stop if we've reached the next label.
        if line.ends_with(':') {
            break;
        }

        let Some(data) = line.strip_prefix("db ") else {
            continue;
        };

        let values: Vec<&str> =
            data.split(',').map(|v| v.trim()).collect();

        if values.len() == 1 && values[0] == "0" {
            match phase {
                Phase::Evolutions => {
                    phase = Phase::Learnset;
                    continue;
                }
                Phase::Learnset => break,
            }
        }

        match phase {
            Phase::Evolutions => {
                evolutions.push(parse_evolution(&values)?);
            }

            Phase::Learnset => {
                if values.len() != 2 {
                    return Err(format!(
                        "Invalid learnset row: {}",
                        line
                    ));
                }

                learnset.push(LearnsetMove {
                    level: values[0]
                        .parse()
                        .map_err(|_| format!("Invalid level: {}", values[0]))?,
                    move_constant: values[1].to_string(),
                });
            }
        }
    }

    Ok((evolutions, learnset))
}
fn parse_evolution(values: &[&str]) -> Result<Evolution, String> {
    match values.first().copied() {
        Some("EVOLVE_LEVEL") if values.len() == 3 => {
            Ok(Evolution {
                method: "level".to_string(),
                level: Some(
                    values[1]
                        .parse::<u8>()
                        .map_err(|_| {
                            format!(
                                "Invalid evolution level: {}",
                                values[1]
                            )
                        })?
                ),
                item: None,
                target: values[2].to_string(),
            })
        }

        Some("EVOLVE_ITEM") if values.len() == 4 => {
            Ok(Evolution {
                method: "item".to_string(),
                level: Some(
                    values[2]
                        .parse::<u8>()
                        .map_err(|_| {
                            format!(
                                "Invalid evolution minimum level: {}",
                                values[2]
                            )
                        })?
                ),
                item: Some(values[1].to_string()),
                target: values[3].to_string(),
            })
        }

        Some("EVOLVE_TRADE") if values.len() == 3 => {
            Ok(Evolution {
                method: "trade".to_string(),
                level: Some(
                    values[1]
                        .parse::<u8>()
                        .map_err(|_| {
                            format!(
                                "Invalid trade evolution minimum level: {}",
                                values[1]
                            )
                        })?
                ),
                item: None,
                target: values[2].to_string(),
            })
        }

        _ => Err(format!(
            "Unknown evolution format: {:?}",
            values
        )),
    }
}
fn parse_pokedex_pointer_table(
    project_root: &Path,
) -> Result<Vec<String>, String> {
    let path = project_root
        .join("data")
        .join("pokemon")
        .join("dex_entries.asm");

    let contents = fs::read_to_string(&path)
        .map_err(|e| {
            format!(
                "Failed to read {}: {}",
                path.display(),
                e
            )
        })?;

    let mut labels = Vec::new();
    let mut in_table = false;

    for raw_line in contents.lines() {
        let line = raw_line.trim();

        if line == "PokedexEntryPointers:" {
            in_table = true;
            continue;
        }

        if !in_table {
            continue;
        }

        if line.starts_with("assert_table_length") {
            break;
        }

        if let Some(label) = line.strip_prefix("dw ") {
            labels.push(label.trim().to_string());
        }
    }

    Ok(labels)
}
pub fn parse_pokedex_info(
    project_root: &Path,
    internal_id: u8,
) -> Result<Option<PokedexInfo>, String> {
    if internal_id == 0 {
        return Ok(None);
    }

    let path = project_root
        .join("data")
        .join("pokemon")
        .join("dex_entries.asm");

    let contents = fs::read_to_string(&path)
        .map_err(|e| {
            format!(
                "Failed to read {}: {}",
                path.display(),
                e
            )
        })?;

    let labels = parse_pokedex_pointer_table(project_root)?;

    let label = labels
        .get((internal_id - 1) as usize)
        .ok_or("No Pokédex pointer for internal ID")?;

    let marker = format!("{}:", label);

    let start = contents
        .find(&marker)
        .ok_or_else(|| {
            format!(
                "Could not find Pokédex entry label {}",
                marker
            )
        })?;

    let block = &contents[start + marker.len()..];

    let mut lines = block
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && !line.starts_with(';')
        });

    let category_line = lines
        .next()
        .ok_or("Missing Pokédex category")?;

    let category = category_line
        .strip_prefix("db \"")
        .and_then(|s| s.strip_suffix('"'))
        .ok_or_else(|| {
            format!(
                "Invalid Pokédex category line: {}",
                category_line
            )
        })?
        .trim_end_matches('@')
        .to_string();

    let height_line = lines
        .next()
        .ok_or("Missing Pokédex height")?;

    let height_values = parse_db_values(height_line)?;

    if height_values.len() != 2 {
        return Err(format!(
            "Expected 2 height values, found {}",
            height_values.len()
        ));
    }

    let height_feet = parse_u8(&height_values[0])?;
    let height_inches = parse_u8(&height_values[1])?;

    let weight_line = lines
        .next()
        .ok_or("Missing Pokédex weight")?;

    let weight_text = weight_line
        .strip_prefix("dw")
        .ok_or_else(|| {
            format!(
                "Expected dw directive for weight: {}",
                weight_line
            )
        })?
        .trim();

    let weight_tenths_lb = weight_text
    .parse::<u16>()
    .map_err(|_| {
        format!(
            "Invalid Pokédex weight: {}",
            weight_text
        )
    })?;

	let text_line = lines
		.next()
		.ok_or("Missing Pokédex text label")?;

	let text_label = text_line
		.strip_prefix("text_far ")
		.ok_or_else(|| {
			format!(
				"Expected text_far directive: {}",
				text_line
			)
		})?
		.trim()
		.to_string();

	let text_lines =
		parse_pokedex_text(project_root, &text_label)?;

	Ok(Some(PokedexInfo {
		category,
		height_feet,
		height_inches,
		weight_tenths_lb,
		text_label,
		text_lines,
	}))
}