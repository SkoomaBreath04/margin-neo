use std::path::Path;

use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::anchor::content_hash;
use super::store;
use super::types::{Anchor, Comment, Thread, ThreadStatus};

/// Inputs for `create_thread`. Owned strings so the struct can be
/// built directly from JSON-deserialized Tauri command arguments.
/// All identity-, time-, and git-related context is passed in
/// rather than read from the environment so the lifecycle layer
/// stays a pure function and the Tauri wrapper (slice 1.10) is the
/// one place that touches the clock and `git config` / HEAD.
#[derive(Debug, Clone)]
pub struct CreateThreadInput {
    pub note_rel_path: String,
    pub block_id: String,
    pub block_text: String,
    pub initial_body: String,
    pub author: String,
    pub head_sha: String,
    pub now: DateTime<Utc>,
}

fn validate(input: &CreateThreadInput) -> Result<(), String> {
    let mut empty: Option<&str> = None;
    if input.note_rel_path.is_empty() {
        empty = Some("note_rel_path");
    } else if input.block_id.is_empty() {
        empty = Some("block_id");
    } else if input.head_sha.is_empty() {
        empty = Some("head_sha");
    } else if input.author.is_empty() {
        empty = Some("author");
    } else if input.initial_body.is_empty() {
        empty = Some("initial_body");
    }
    match empty {
        Some(field) => Err(format!("create_thread: {field} must not be empty")),
        None => Ok(()),
    }
}

fn generate_thread_id() -> String {
    format!("thr_{}", Uuid::new_v4().simple())
}

fn generate_comment_id() -> String {
    format!("cmt_{}", Uuid::new_v4().simple())
}

/// Create a new thread anchored to one block of one note, with one
/// initial comment, and persist it to `<vault>/.tolaria/threads/`.
/// Returns the thread on success.
pub fn create_thread(vault: &Path, input: CreateThreadInput) -> Result<Thread, String> {
    validate(&input)?;

    let anchor = Anchor {
        block_id: input.block_id,
        created_at_sha: input.head_sha.clone(),
        content_hash: content_hash(&input.block_text),
    };
    let comment = Comment {
        id: generate_comment_id(),
        author: input.author,
        body: input.initial_body,
        created_at: input.now,
        created_at_sha: input.head_sha.clone(),
    };
    let thread = Thread {
        id: generate_thread_id(),
        note_rel_path: input.note_rel_path,
        anchor,
        status: ThreadStatus::Open,
        comments: vec![comment],
        created_at: input.now,
        created_at_sha: input.head_sha,
    };
    store::write_thread(vault, &thread)?;
    Ok(thread)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::comments::store::{list_thread_ids, read_thread};
    use chrono::TimeZone;
    use tempfile::tempdir;

    fn fixed_now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 4, 27, 9, 0, 0).unwrap()
    }

    fn sample_input() -> CreateThreadInput {
        CreateThreadInput {
            note_rel_path: "projects/example.md".into(),
            block_id: "bn_block_abc".into(),
            block_text: "the original block content".into(),
            initial_body: "First comment".into(),
            author: "Test User <test@example.com>".into(),
            head_sha: "0".repeat(40),
            now: fixed_now(),
        }
    }

    #[test]
    fn create_thread_persists_to_disk() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        let on_disk = read_thread(dir.path(), &thread.id).unwrap();
        assert_eq!(on_disk, thread);
    }

    #[test]
    fn create_thread_assigns_thr_prefix_and_36_chars() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        assert!(
            thread.id.starts_with("thr_"),
            "expected thr_ prefix, got {}",
            thread.id
        );
        assert_eq!(thread.id.len(), 36, "thr_ + 32 hex chars = 36");
    }

    #[test]
    fn create_thread_initial_comment_uses_cmt_prefix() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        assert_eq!(thread.comments.len(), 1);
        assert!(thread.comments[0].id.starts_with("cmt_"));
        assert_eq!(thread.comments[0].id.len(), 36);
    }

    #[test]
    fn create_thread_starts_in_open_status() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        assert_eq!(thread.status, ThreadStatus::Open);
    }

    #[test]
    fn create_thread_records_provided_body_and_author() {
        let dir = tempdir().unwrap();
        let input = sample_input();
        let expected_body = input.initial_body.clone();
        let expected_author = input.author.clone();
        let thread = create_thread(dir.path(), input).unwrap();
        assert_eq!(thread.comments[0].body, expected_body);
        assert_eq!(thread.comments[0].author, expected_author);
    }

    #[test]
    fn create_thread_computes_content_hash_from_block_text() {
        let dir = tempdir().unwrap();
        let input = sample_input();
        let expected_hash = content_hash(&input.block_text);
        let thread = create_thread(dir.path(), input).unwrap();
        assert_eq!(thread.anchor.content_hash, expected_hash);
    }

    #[test]
    fn create_thread_propagates_head_sha_everywhere() {
        let dir = tempdir().unwrap();
        let input = sample_input();
        let head_sha = input.head_sha.clone();
        let thread = create_thread(dir.path(), input).unwrap();
        assert_eq!(thread.created_at_sha, head_sha);
        assert_eq!(thread.anchor.created_at_sha, head_sha);
        assert_eq!(thread.comments[0].created_at_sha, head_sha);
    }

    #[test]
    fn create_thread_uses_provided_now_for_thread_and_comment() {
        let dir = tempdir().unwrap();
        let input = sample_input();
        let now = input.now;
        let thread = create_thread(dir.path(), input).unwrap();
        assert_eq!(thread.created_at, now);
        assert_eq!(thread.comments[0].created_at, now);
    }

    #[test]
    fn create_thread_anchor_records_block_id_and_note_path() {
        let dir = tempdir().unwrap();
        let input = sample_input();
        let block_id = input.block_id.clone();
        let note_path = input.note_rel_path.clone();
        let thread = create_thread(dir.path(), input).unwrap();
        assert_eq!(thread.anchor.block_id, block_id);
        assert_eq!(thread.note_rel_path, note_path);
    }

    #[test]
    fn create_thread_appears_in_listing() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        let ids = list_thread_ids(dir.path()).unwrap();
        assert_eq!(ids, vec![thread.id]);
    }

    #[test]
    fn create_thread_generates_unique_ids_across_calls() {
        let dir = tempdir().unwrap();
        let a = create_thread(dir.path(), sample_input()).unwrap();
        let b = create_thread(dir.path(), sample_input()).unwrap();
        assert_ne!(a.id, b.id);
        assert_ne!(a.comments[0].id, b.comments[0].id);
    }

    type FieldMutator = fn(&mut CreateThreadInput);

    #[test]
    fn create_thread_rejects_empty_required_fields() {
        let dir = tempdir().unwrap();
        let mutators: Vec<(&str, FieldMutator)> = vec![
            ("note_rel_path", |i| i.note_rel_path.clear()),
            ("block_id", |i| i.block_id.clear()),
            ("head_sha", |i| i.head_sha.clear()),
            ("author", |i| i.author.clear()),
            ("initial_body", |i| i.initial_body.clear()),
        ];
        for (field, mutate) in mutators {
            let mut input = sample_input();
            mutate(&mut input);
            let result = create_thread(dir.path(), input);
            assert!(
                result.is_err(),
                "{field} was accepted as empty (expected rejection)"
            );
            let err = result.unwrap_err();
            assert!(
                err.contains(field),
                "error message should mention {field}, got: {err}"
            );
        }
    }

    #[test]
    fn create_thread_accepts_empty_block_text() {
        // An empty block has a valid SHA-256 (the FIPS empty-string
        // hash); no reason to reject — content_hash handles it.
        let dir = tempdir().unwrap();
        let mut input = sample_input();
        input.block_text.clear();
        let thread = create_thread(dir.path(), input).unwrap();
        assert_eq!(
            thread.anchor.content_hash,
            "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }
}
