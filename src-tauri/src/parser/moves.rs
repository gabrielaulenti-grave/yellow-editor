use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveData {
    pub id: u8,
    pub constant: String,
    pub name: String,
    pub animation: String,
    pub effect: String,
    pub power: u8,
    pub move_type: String,
    pub accuracy: u8,
    pub pp: u8,
    pub animation_label: Option<String>,
    pub animation_script: Vec<String>,
}

pub fn parse_moves(project_root: &Path) -> Result<Vec<MoveData>, String> {
    let move_rows = parse_move_rows(project_root)?;
    let constants = parse_move_constants(project_root)?;
    let names = parse_move_names(project_root)?;
    let animation_labels = parse_animation_labels(project_root)?;

    let mut moves = Vec::with_capacity(move_rows.len());

    for (index, row) in move_rows.into_iter().enumerate() {
        let id = u8::try_from(index + 1)
            .map_err(|_| "Move index does not fit in a byte".to_string())?;

        let constant = constants
            .get(index)
            .cloned()
            .unwrap_or_else(|| row.animation.clone());

        let name = names
            .get(index)
            .cloned()
            .unwrap_or_else(|| constant.clone());

        let animation_label = animation_labels.get(index).cloned();
        let animation_script = match animation_label.as_deref() {
            Some(label) => parse_animation_script(project_root, label)?,
            None => Vec::new(),
        };

        moves.push(MoveData {
            id,
            constant,
            name,
            animation: row.animation,
            effect: row.effect,
            power: row.power,
            move_type: row.move_type,
            accuracy: row.accuracy,
            pp: row.pp,
            animation_label,
            animation_script,
        });
    }

    Ok(moves)
}

struct MoveRow {
    animation: String,
    effect: String,
    power: u8,
    move_type: String,
    accuracy: u8,
    pp: u8,
}

fn parse_move_rows(project_root: &Path) -> Result<Vec<MoveRow>, String> {
    let path = project_root
        .join("data")
        .join("moves")
        .join("moves.asm");

    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    let mut rows = Vec::new();

    for raw_line in contents.lines() {
        let line = raw_line
            .split(';')
            .next()
            .unwrap_or("")
            .trim();

        let Some(values) = line.strip_prefix("move ") else {
            continue;
        };

        // Ignore the macro definition line: move rows in the table have six
        // comma-separated arguments.
        let fields: Vec<&str> = values.split(',').map(str::trim).collect();
        if fields.len() != 6 {
            continue;
        }

        rows.push(MoveRow {
            animation: fields[0].to_string(),
            effect: fields[1].to_string(),
            power: parse_u8(fields[2], "power")?,
            move_type: fields[3].to_string(),
            accuracy: parse_u8(fields[4], "accuracy")?,
            pp: parse_u8(fields[5], "PP")?,
        });
    }

    if rows.is_empty() {
        return Err(format!("No move rows found in {}", path.display()));
    }

    Ok(rows)
}

fn parse_move_constants(project_root: &Path) -> Result<Vec<String>, String> {
    let path = project_root
        .join("constants")
        .join("move_constants.asm");

    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    let mut constants = Vec::new();
    let mut in_move_ids = false;

    for raw_line in contents.lines() {
        let line = raw_line
            .split(';')
            .next()
            .unwrap_or("")
            .trim();

        if line == "const_def" && !in_move_ids {
            in_move_ids = true;
            continue;
        }

        if !in_move_ids {
            continue;
        }

        if let Some(name) = line.strip_prefix("const ") {
            let name = name.trim();

            // NO_MOVE is id $00. Moves: starts at id $01, so skip it.
            if name == "NO_MOVE" && constants.is_empty() {
                continue;
            }

            constants.push(name.to_string());
            continue;
        }

        // Stop when the first contiguous move-constant section ends.
        if !constants.is_empty() && !line.is_empty() {
            break;
        }
    }

    Ok(constants)
}

fn parse_move_names(project_root: &Path) -> Result<Vec<String>, String> {
    let path = project_root
        .join("data")
        .join("moves")
        .join("names.asm");

    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    let mut names = Vec::new();

    for raw_line in contents.lines() {
        let line = raw_line.trim();

        let Some(value) = line.strip_prefix("li \"") else {
            continue;
        };

        let Some(value) = value.strip_suffix('"') else {
            continue;
        };

        names.push(value.to_string());
    }

    Ok(names)
}

fn parse_animation_labels(project_root: &Path) -> Result<Vec<String>, String> {
    let path = project_root
        .join("data")
        .join("moves")
        .join("animations.asm");

    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    let mut labels = Vec::new();
    let mut in_table = false;

    for raw_line in contents.lines() {
        let line = raw_line.trim();

        if line == "AttackAnimationPointers:" {
            in_table = true;
            continue;
        }

        if !in_table {
            continue;
        }

        // The first assertion ends the move animation portion of the table;
        // entries after it are non-move battle animations.
        if line.starts_with("assert_table_length") {
            break;
        }

        if let Some(label) = line.strip_prefix("dw ") {
            labels.push(label.trim().to_string());
        }
    }

    Ok(labels)
}

fn parse_animation_script(
    project_root: &Path,
    label: &str,
) -> Result<Vec<String>, String> {
    let path = project_root
        .join("data")
        .join("moves")
        .join("animations.asm");

    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    let marker = format!("{}:", label);
    let start = contents
        .find(&marker)
        .ok_or_else(|| format!("Could not find animation label {}", marker))?;

    let block = &contents[start + marker.len()..];
    let mut lines = Vec::new();

    for raw_line in block.lines() {
        let line = raw_line.trim();

        if line.is_empty() || line.starts_with(';') {
            continue;
        }

        // Some animations share a body through consecutive labels, so retain
        // alias labels until the terminating db -1 is reached.
        lines.push(line.to_string());

        let code = line.split(';').next().unwrap_or("").trim();
        if code == "db -1" {
            break;
        }
    }

    Ok(lines)
}

fn parse_u8(value: &str, field: &str) -> Result<u8, String> {
    value
        .parse::<u8>()
        .map_err(|_| format!("Invalid move {}: {}", field, value))
}
