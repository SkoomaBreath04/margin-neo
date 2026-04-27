//! Tauri command surface for the async-collaboration feature.
//!
//! Each command is a thin wrapper around `crate::comments::lifecycle::*`.
//! The wrappers gather the impure inputs the lifecycle layer expects
//! (`Utc::now()`, the vault's HEAD SHA, the git config author) and pass
//! them through. Behavior is covered by the lifecycle tests; these
//! wrappers are tested end-to-end with a `tempdir` + `git init` to
//! verify the wiring (helpers + delegation), not the rules.
use std::path::{Path, PathBuf};
use std::process::Command;

use chrono::Utc;

use crate::comments::lifecycle::{
    self, AddCommentInput, CreateThreadInput, DecisionFilter, PromoteToDecisionInput,
};
use crate::comments::types::{Comment, Decision, Thread, ThreadStatus};

fn run_git(vault: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(vault)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to invoke git: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git {args:?} failed: {}", stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn current_head_sha(vault: &Path) -> Result<String, String> {
    run_git(vault, &["rev-parse", "HEAD"])
}

fn git_author(vault: &Path) -> Result<String, String> {
    let name = run_git(vault, &["config", "user.name"])?;
    let email = run_git(vault, &["config", "user.email"])?;
    Ok(format!("{name} <{email}>"))
}

#[tauri::command]
pub fn create_thread(
    vault_path: String,
    note_rel_path: String,
    block_id: String,
    block_text: String,
    initial_body: String,
) -> Result<Thread, String> {
    let vault = PathBuf::from(vault_path);
    let head_sha = current_head_sha(&vault)?;
    let author = git_author(&vault)?;
    lifecycle::create_thread(
        &vault,
        CreateThreadInput {
            note_rel_path,
            block_id,
            block_text,
            initial_body,
            author,
            head_sha,
            now: Utc::now(),
        },
    )
}

#[tauri::command]
pub fn add_comment(vault_path: String, thread_id: String, body: String) -> Result<Comment, String> {
    let vault = PathBuf::from(vault_path);
    let head_sha = current_head_sha(&vault)?;
    let author = git_author(&vault)?;
    lifecycle::add_comment(
        &vault,
        AddCommentInput {
            thread_id,
            body,
            author,
            head_sha,
            now: Utc::now(),
        },
    )
}

#[tauri::command]
pub fn list_threads_for_note(
    vault_path: String,
    note_rel_path: String,
) -> Result<Vec<Thread>, String> {
    let vault = PathBuf::from(vault_path);
    lifecycle::list_threads_for_note(&vault, &note_rel_path)
}

#[tauri::command]
pub fn update_thread_status(
    vault_path: String,
    thread_id: String,
    new_status: ThreadStatus,
) -> Result<Thread, String> {
    let vault = PathBuf::from(vault_path);
    lifecycle::update_thread_status(&vault, &thread_id, new_status)
}

#[tauri::command]
pub fn promote_to_decision(
    vault_path: String,
    thread_id: String,
    title: String,
    rationale: String,
    alternatives: Option<String>,
) -> Result<Decision, String> {
    let vault = PathBuf::from(vault_path);
    let head_sha = current_head_sha(&vault)?;
    let owner = git_author(&vault)?;
    lifecycle::promote_to_decision(
        &vault,
        PromoteToDecisionInput {
            thread_id,
            title,
            rationale,
            alternatives,
            owner,
            head_sha,
            now: Utc::now(),
        },
    )
}

#[tauri::command]
pub fn list_decisions(
    vault_path: String,
    note_rel_path: Option<String>,
    owner: Option<String>,
) -> Result<Vec<Decision>, String> {
    let vault = PathBuf::from(vault_path);
    let filter = DecisionFilter {
        note_rel_path,
        owner,
    };
    lifecycle::list_decisions(&vault, &filter)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn init_git_repo(vault: &Path) {
        run_git(vault, &["init", "-q", "-b", "main"]).unwrap();
        run_git(vault, &["config", "user.name", "Test User"]).unwrap();
        run_git(vault, &["config", "user.email", "test@example.com"]).unwrap();
        fs::write(vault.join("seed"), "seed").unwrap();
        run_git(vault, &["add", "seed"]).unwrap();
        run_git(vault, &["commit", "-q", "-m", "seed"]).unwrap();
    }

    fn vault_str(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn current_head_sha_returns_40_char_hex() {
        let dir = tempdir().unwrap();
        init_git_repo(dir.path());
        let sha = current_head_sha(dir.path()).unwrap();
        assert_eq!(sha.len(), 40);
        assert!(sha.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn git_author_formats_name_and_email() {
        let dir = tempdir().unwrap();
        init_git_repo(dir.path());
        let author = git_author(dir.path()).unwrap();
        assert_eq!(author, "Test User <test@example.com>");
    }

    #[test]
    fn create_thread_command_persists_to_disk() {
        let dir = tempdir().unwrap();
        init_git_repo(dir.path());
        let thread = create_thread(
            vault_str(dir.path()),
            "projects/example.md".into(),
            "bn_block_abc".into(),
            "block content".into(),
            "First comment".into(),
        )
        .unwrap();
        assert!(thread.id.starts_with("thr_"));
        assert_eq!(thread.note_rel_path, "projects/example.md");
        assert_eq!(thread.comments.len(), 1);
        assert_eq!(thread.created_at_sha.len(), 40);
        assert_eq!(thread.comments[0].author, "Test User <test@example.com>");
    }

    #[test]
    fn add_comment_command_appends_reply() {
        let dir = tempdir().unwrap();
        init_git_repo(dir.path());
        let thread = create_thread(
            vault_str(dir.path()),
            "projects/example.md".into(),
            "bn_block_abc".into(),
            "block".into(),
            "First".into(),
        )
        .unwrap();
        let reply = add_comment(vault_str(dir.path()), thread.id.clone(), "Reply".into()).unwrap();
        assert!(reply.id.starts_with("cmt_"));
        assert_eq!(reply.body, "Reply");
        assert_eq!(reply.author, "Test User <test@example.com>");
    }

    #[test]
    fn list_threads_for_note_command_returns_only_match() {
        let dir = tempdir().unwrap();
        init_git_repo(dir.path());
        create_thread(
            vault_str(dir.path()),
            "projects/example.md".into(),
            "bn_block_abc".into(),
            "block".into(),
            "Body".into(),
        )
        .unwrap();
        create_thread(
            vault_str(dir.path()),
            "projects/other.md".into(),
            "bn_block_xyz".into(),
            "other".into(),
            "Other".into(),
        )
        .unwrap();
        let threads =
            list_threads_for_note(vault_str(dir.path()), "projects/example.md".into()).unwrap();
        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].note_rel_path, "projects/example.md");
    }

    #[test]
    fn update_thread_status_command_persists() {
        let dir = tempdir().unwrap();
        init_git_repo(dir.path());
        let thread = create_thread(
            vault_str(dir.path()),
            "projects/example.md".into(),
            "bn_block_abc".into(),
            "block".into(),
            "Body".into(),
        )
        .unwrap();
        let updated = update_thread_status(
            vault_str(dir.path()),
            thread.id.clone(),
            ThreadStatus::Resolved,
        )
        .unwrap();
        assert_eq!(updated.status, ThreadStatus::Resolved);
    }

    #[test]
    fn promote_to_decision_command_creates_decision_and_resolves_thread() {
        let dir = tempdir().unwrap();
        init_git_repo(dir.path());
        let thread = create_thread(
            vault_str(dir.path()),
            "projects/example.md".into(),
            "bn_block_abc".into(),
            "block".into(),
            "Body".into(),
        )
        .unwrap();
        let decision = promote_to_decision(
            vault_str(dir.path()),
            thread.id.clone(),
            "Adopt sidecar".into(),
            "Avoids fragmenting by SHA.".into(),
            Some("Use a backend.".into()),
        )
        .unwrap();
        assert!(decision.id.starts_with("dec_"));
        assert_eq!(decision.source_thread_id, thread.id);
        assert_eq!(decision.owner, "Test User <test@example.com>");
        assert_eq!(decision.alternatives.as_deref(), Some("Use a backend."));
    }

    #[test]
    fn list_decisions_command_filters_by_note() {
        let dir = tempdir().unwrap();
        init_git_repo(dir.path());
        let thread = create_thread(
            vault_str(dir.path()),
            "projects/a.md".into(),
            "bn_block_abc".into(),
            "block".into(),
            "Body".into(),
        )
        .unwrap();
        promote_to_decision(
            vault_str(dir.path()),
            thread.id,
            "Title".into(),
            "Rationale".into(),
            None,
        )
        .unwrap();

        let on_a =
            list_decisions(vault_str(dir.path()), Some("projects/a.md".into()), None).unwrap();
        assert_eq!(on_a.len(), 1);

        let on_b =
            list_decisions(vault_str(dir.path()), Some("projects/b.md".into()), None).unwrap();
        assert!(on_b.is_empty());
    }

    #[test]
    fn run_git_surfaces_failure_with_stderr() {
        let dir = tempdir().unwrap();
        // No `git init` — `rev-parse HEAD` will fail.
        let result = current_head_sha(dir.path());
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("rev-parse"),
            "error should reference the failing args, got: {err}"
        );
    }
}
