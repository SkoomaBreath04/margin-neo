use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use tempfile::NamedTempFile;

use super::types::Thread;

const THREADS_DIRNAME: &str = ".tolaria/threads";

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("Thread id is empty".to_string());
    }
    let valid = id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !valid {
        return Err(format!("Thread id contains invalid characters: {id}"));
    }
    Ok(())
}

pub fn threads_dir(vault: &Path) -> PathBuf {
    vault.join(THREADS_DIRNAME)
}

pub fn thread_path(vault: &Path, thread_id: &str) -> Result<PathBuf, String> {
    validate_id(thread_id)?;
    Ok(threads_dir(vault).join(format!("{thread_id}.json")))
}

/// Atomically write a thread JSON file. Creates `.tolaria/threads/`
/// if missing, then writes via a same-directory temp file + rename
/// so a crash mid-write cannot leave a half-written sidecar that
/// breaks subsequent reads.
pub fn write_thread(vault: &Path, thread: &Thread) -> Result<(), String> {
    let path = thread_path(vault, &thread.id)?;
    let dir = threads_dir(vault);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;
    let json = serde_json::to_string_pretty(thread)
        .map_err(|e| format!("Failed to serialize thread {}: {}", thread.id, e))?;
    let mut tmp = NamedTempFile::new_in(&dir)
        .map_err(|e| format!("Failed to create temp file in {}: {}", dir.display(), e))?;
    tmp.write_all(json.as_bytes())
        .map_err(|e| format!("Failed to write thread {}: {}", thread.id, e))?;
    tmp.persist(&path).map_err(|e| {
        format!(
            "Failed to persist thread {} to {}: {}",
            thread.id,
            path.display(),
            e
        )
    })?;
    Ok(())
}

pub fn read_thread(vault: &Path, thread_id: &str) -> Result<Thread, String> {
    let path = thread_path(vault, thread_id)?;
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    serde_json::from_slice(&bytes)
        .map_err(|e| format!("Failed to parse thread {}: {}", path.display(), e))
}

pub fn list_thread_ids(vault: &Path) -> Result<Vec<String>, String> {
    let dir = threads_dir(vault);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut ids: Vec<String> = fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read {}: {}", dir.display(), e))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension()? == "json" {
                path.file_stem()?.to_str().map(String::from)
            } else {
                None
            }
        })
        .collect();
    ids.sort();
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::comments::types::{Anchor, Thread, ThreadStatus};
    use chrono::{TimeZone, Utc};
    use tempfile::tempdir;

    fn sample_thread(id: &str) -> Thread {
        Thread {
            id: id.to_string(),
            note_rel_path: "projects/example.md".into(),
            anchor: Anchor {
                block_id: "bn_block_abc".into(),
                created_at_sha: "0".repeat(40),
                content_hash: "sha256:dead".into(),
            },
            status: ThreadStatus::Open,
            comments: Vec::new(),
            created_at: Utc.with_ymd_and_hms(2026, 4, 26, 12, 0, 0).unwrap(),
            created_at_sha: "0".repeat(40),
        }
    }

    #[test]
    fn thread_path_uses_dot_tolaria_threads_layout() {
        let path = thread_path(Path::new("/vault"), "thr_001").unwrap();
        assert!(path.ends_with(".tolaria/threads/thr_001.json"));
    }

    #[test]
    fn write_then_read_round_trip() {
        let dir = tempdir().unwrap();
        let thread = sample_thread("thr_001");
        write_thread(dir.path(), &thread).unwrap();
        let parsed = read_thread(dir.path(), "thr_001").unwrap();
        assert_eq!(parsed, thread);
    }

    #[test]
    fn write_creates_threads_dir() {
        let dir = tempdir().unwrap();
        assert!(!threads_dir(dir.path()).exists());
        write_thread(dir.path(), &sample_thread("thr_002")).unwrap();
        assert!(threads_dir(dir.path()).exists());
    }

    #[test]
    fn read_missing_thread_returns_error() {
        let dir = tempdir().unwrap();
        let err = read_thread(dir.path(), "thr_missing").unwrap_err();
        assert!(err.contains("Failed to read"));
    }

    #[test]
    fn list_thread_ids_when_dir_missing_returns_empty() {
        let dir = tempdir().unwrap();
        assert_eq!(list_thread_ids(dir.path()).unwrap(), Vec::<String>::new());
    }

    #[test]
    fn list_thread_ids_returns_sorted() {
        let dir = tempdir().unwrap();
        write_thread(dir.path(), &sample_thread("thr_002")).unwrap();
        write_thread(dir.path(), &sample_thread("thr_001")).unwrap();
        write_thread(dir.path(), &sample_thread("thr_003")).unwrap();
        let ids = list_thread_ids(dir.path()).unwrap();
        assert_eq!(ids, vec!["thr_001", "thr_002", "thr_003"]);
    }

    #[test]
    fn list_thread_ids_ignores_non_json_files() {
        let dir = tempdir().unwrap();
        write_thread(dir.path(), &sample_thread("thr_001")).unwrap();
        fs::write(threads_dir(dir.path()).join("README.md"), "stray").unwrap();
        let ids = list_thread_ids(dir.path()).unwrap();
        assert_eq!(ids, vec!["thr_001"]);
    }

    #[test]
    fn thread_path_rejects_path_traversal() {
        assert!(thread_path(Path::new("/vault"), "..").is_err());
    }

    #[test]
    fn thread_path_rejects_slash() {
        assert!(thread_path(Path::new("/vault"), "thr/etc").is_err());
    }

    #[test]
    fn thread_path_rejects_empty_id() {
        assert!(thread_path(Path::new("/vault"), "").is_err());
    }

    #[test]
    fn write_produces_pretty_json() {
        let dir = tempdir().unwrap();
        write_thread(dir.path(), &sample_thread("thr_001")).unwrap();
        let path = thread_path(dir.path(), "thr_001").unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains('\n'), "expected pretty JSON, got: {text}");
        assert!(
            text.contains("  \"id\""),
            "expected indented fields, got: {text}"
        );
    }
}
