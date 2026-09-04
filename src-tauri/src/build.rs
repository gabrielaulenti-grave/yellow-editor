use serde::Serialize;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;
use tauri::Manager;

const RGBDS_TOOLS: [&str; 4] = ["rgbasm", "rgblink", "rgbfix", "rgbgfx"];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildToolStatus {
    name: String,
    available: bool,
    path: Option<String>,
    version: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildEnvironment {
    backend: String,
    ready: bool,
    targets: Vec<String>,
    required_rgbds_version: Option<String>,
    detected_rgbds_version: Option<String>,
    version_matches: Option<bool>,
    toolchain_source: String,
    tools: Vec<BuildToolStatus>,
    build_tool: BuildToolStatus,
    helper_compiler: Option<BuildToolStatus>,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildResult {
    success: bool,
    target: String,
    rom_path: Option<String>,
    stdout: String,
    stderr: String,
    duration_ms: u128,
    exit_code: Option<i32>,
}

struct ResolvedBuildEnvironment {
    public: BuildEnvironment,
    rgbds_paths: Vec<(String, PathBuf)>,
    make_path: Option<PathBuf>,
}

fn executable_names(name: &str) -> Vec<String> {
    #[cfg(windows)]
    {
        vec![format!("{}.exe", name), name.to_string()]
    }

    #[cfg(not(windows))]
    {
        vec![name.to_string()]
    }
}

fn find_in_directory(directory: &Path, name: &str) -> Option<PathBuf> {
    executable_names(name)
        .into_iter()
        .map(|candidate| directory.join(candidate))
        .find(|candidate| candidate.is_file())
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    for directory in env::split_paths(&path) {
        if let Some(found) = find_in_directory(&directory, name) {
            return Some(found);
        }
    }
    None
}

fn run_version(path: &Path) -> Option<String> {
    let output = Command::new(path).arg("--version").output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn unavailable_tool(name: &str) -> BuildToolStatus {
    BuildToolStatus {
        name: name.to_string(),
        available: false,
        path: None,
        version: None,
    }
}

fn status_for_path(name: &str, path: Option<PathBuf>) -> BuildToolStatus {
    match path {
        Some(path) => BuildToolStatus {
            name: name.to_string(),
            available: true,
            version: run_version(&path),
            path: Some(path.to_string_lossy().to_string()),
        },
        None => unavailable_tool(name),
    }
}

fn parse_rgbds_version(version_line: &str) -> Option<String> {
    for token in version_line.split_whitespace() {
        let token = token.trim_matches(|character: char| {
            !character.is_ascii_alphanumeric() && character != '.' && character != '-' && character != '+'
        });
        let token = token.strip_prefix('v').unwrap_or(token);
        if token
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_digit())
            && token.contains('.')
        {
            return Some(token.to_string());
        }
    }
    None
}

fn normalize_version(version: &str) -> &str {
    version.trim().trim_start_matches('v')
}

fn read_required_rgbds_version(project_root: &Path) -> Option<String> {
    let path = project_root.join(".rgbds-version");
    fs::read_to_string(path)
        .ok()
        .map(|contents| contents.trim().to_string())
        .filter(|contents| !contents.is_empty())
}

fn project_targets(project_root: &Path) -> Vec<String> {
    if project_root.join("data").join("pokemon").join("mew.asm").exists() {
        vec!["red".to_string(), "blue".to_string()]
    } else {
        vec!["yellow".to_string()]
    }
}

fn bundled_rgbds_directories(app: &tauri::AppHandle, version: &str) -> Vec<PathBuf> {
    let mut directories = vec![
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("rgbds")
            .join(version)
            .join("bin"),
    ];

    if let Ok(resource_dir) = app.path().resource_dir() {
        directories.push(
            resource_dir
                .join("resources")
                .join("rgbds")
                .join(version)
                .join("bin"),
        );
        directories.push(
            resource_dir
                .join("rgbds")
                .join(version)
                .join("bin"),
        );
    }

    directories
}

fn find_complete_bundled_toolchain(
    app: &tauri::AppHandle,
    version: Option<&str>,
) -> Option<Vec<(String, PathBuf)>> {
    let version = version?;

    for directory in bundled_rgbds_directories(app, version) {
        let mut paths = Vec::new();
        let mut complete = true;

        for tool in RGBDS_TOOLS {
            match find_in_directory(&directory, tool) {
                Some(path) => paths.push((tool.to_string(), path)),
                None => {
                    complete = false;
                    break;
                }
            }
        }

        if complete {
            return Some(paths);
        }
    }

    None
}

fn detect_helper_compiler() -> BuildToolStatus {
    for name in ["cc", "gcc", "clang"] {
        if let Some(path) = find_on_path(name) {
            return status_for_path(name, Some(path));
        }
    }
    unavailable_tool("C compiler")
}

fn resolve_build_environment(
    app: &tauri::AppHandle,
    project_path: &str,
) -> Result<ResolvedBuildEnvironment, String> {
    let project_root = Path::new(project_path);
    if !project_root.is_dir() {
        return Err("The selected project folder no longer exists.".into());
    }

    let required_rgbds_version = read_required_rgbds_version(project_root);
    let targets = project_targets(project_root);

    let (toolchain_source, rgbds_paths) = if let Some(paths) = find_complete_bundled_toolchain(
        app,
        required_rgbds_version.as_deref(),
    ) {
        ("bundled".to_string(), paths)
    } else {
        let paths: Vec<(String, PathBuf)> = RGBDS_TOOLS
            .into_iter()
            .filter_map(|tool| find_on_path(tool).map(|path| (tool.to_string(), path)))
            .collect();

        if paths.len() == RGBDS_TOOLS.len() {
            ("system".to_string(), paths)
        } else {
            ("unavailable".to_string(), paths)
        }
    };

    let tools: Vec<BuildToolStatus> = RGBDS_TOOLS
        .into_iter()
        .map(|tool| {
            let path = rgbds_paths
                .iter()
                .find(|(name, _)| name == tool)
                .map(|(_, path)| path.clone());
            status_for_path(tool, path)
        })
        .collect();

    let detected_rgbds_version = tools
        .iter()
        .find(|tool| tool.name == "rgbasm")
        .and_then(|tool| tool.version.as_deref())
        .and_then(parse_rgbds_version);

    let version_matches = match (
        required_rgbds_version.as_deref(),
        detected_rgbds_version.as_deref(),
    ) {
        (Some(required), Some(detected)) => {
            Some(normalize_version(required) == normalize_version(detected))
        }
        _ => None,
    };

    let make_path = find_on_path("make");
    let build_tool = status_for_path("make", make_path.clone());
    let helper_compiler = detect_helper_compiler();
    let rgbds_ready = tools.iter().all(|tool| tool.available);
    let ready = rgbds_ready && build_tool.available;

    let mut notes = Vec::new();
    match toolchain_source.as_str() {
        "bundled" => notes.push("Yellow Editor's bundled RGBDS toolchain is available.".to_string()),
        "system" => notes.push("RGBDS was found on the system PATH. Bundled RGBDS binaries have not been added yet.".to_string()),
        _ => notes.push("RGBDS is not available yet. Yellow Editor will prefer a bundled toolchain, then fall back to the system PATH during this integration phase.".to_string()),
    }

    if !build_tool.available {
        notes.push("The project build also needs make, which was not found on PATH.".to_string());
    }

    if !helper_compiler.available {
        notes.push("A C compiler was not found. Fresh pret checkouts may need one to build their helper tools.".to_string());
    }

    if version_matches == Some(false) {
        if let (Some(required), Some(detected)) = (
            required_rgbds_version.as_deref(),
            detected_rgbds_version.as_deref(),
        ) {
            notes.push(format!(
                "This checkout requests RGBDS {}, but {} was detected. The build is allowed for now so compatibility can be tested.",
                required, detected
            ));
        }
    }

    Ok(ResolvedBuildEnvironment {
        public: BuildEnvironment {
            backend: "desktop-native".to_string(),
            ready,
            targets,
            required_rgbds_version,
            detected_rgbds_version,
            version_matches,
            toolchain_source,
            tools,
            build_tool,
            helper_compiler: Some(helper_compiler),
            message: notes.join(" "),
        },
        rgbds_paths,
        make_path,
    })
}

#[tauri::command]
pub fn get_build_environment(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<BuildEnvironment, String> {
    Ok(resolve_build_environment(&app, &project_path)?.public)
}

fn rom_filename(target: &str) -> Option<&'static str> {
    match target {
        "yellow" => Some("pokeyellow.gbc"),
        "red" => Some("pokered.gbc"),
        "blue" => Some("pokeblue.gbc"),
        _ => None,
    }
}

fn make_variable_command(path: &Path) -> String {
    let value = path.to_string_lossy();
    if value.contains(' ') {
        format!("\"{}\"", value)
    } else {
        value.into_owned()
    }
}

#[tauri::command]
pub fn build_rom(
    app: tauri::AppHandle,
    project_path: String,
    target: String,
) -> Result<BuildResult, String> {
    let resolved = resolve_build_environment(&app, &project_path)?;
    let started = Instant::now();

    if !resolved.public.targets.iter().any(|candidate| candidate == &target) {
        return Err(format!("Build target '{}' does not belong to this project.", target));
    }

    if !resolved.public.ready {
        return Ok(BuildResult {
            success: false,
            target,
            rom_path: None,
            stdout: String::new(),
            stderr: resolved.public.message,
            duration_ms: started.elapsed().as_millis(),
            exit_code: None,
        });
    }

    let make_path = resolved
        .make_path
        .ok_or_else(|| "make disappeared from PATH before the build started.".to_string())?;
    let project_root = Path::new(&project_path);
    let mut command = Command::new(make_path);
    command.current_dir(project_root);

    match target.as_str() {
        "yellow" => {}
        "red" | "blue" => {
            command.arg(&target);
        }
        _ => unreachable!(),
    }

    for (name, path) in &resolved.rgbds_paths {
        let variable = match name.as_str() {
            "rgbasm" => "RGBASM",
            "rgblink" => "RGBLINK",
            "rgbfix" => "RGBFIX",
            "rgbgfx" => "RGBGFX",
            _ => continue,
        };
        command.env(variable, make_variable_command(path));
    }

    let output = command
        .output()
        .map_err(|error| format!("Failed to start project build: {}", error))?;

    let success = output.status.success();
    let rom_path = rom_filename(&target)
        .map(|filename| project_root.join(filename))
        .filter(|path| success && path.is_file())
        .map(|path| path.to_string_lossy().to_string());

    Ok(BuildResult {
        success,
        target,
        rom_path,
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        duration_ms: started.elapsed().as_millis(),
        exit_code: output.status.code(),
    })
}
