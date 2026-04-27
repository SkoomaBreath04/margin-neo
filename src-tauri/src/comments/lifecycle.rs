use std::path::Path;

use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::anchor::content_hash;
use super::store;
use super::types::{Anchor, Comment, Decision, Thread, ThreadStatus};

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

fn generate_decision_id() -> String {
    format!("dec_{}", Uuid::new_v4().simple())
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

/// Inputs for `add_comment`. Same dependency-injection style as
/// `CreateThreadInput`: caller provides clock and identity.
#[derive(Debug, Clone)]
pub struct AddCommentInput {
    pub thread_id: String,
    pub body: String,
    pub author: String,
    pub head_sha: String,
    pub now: DateTime<Utc>,
}

fn validate_add_comment(input: &AddCommentInput) -> Result<(), String> {
    let mut empty: Option<&str> = None;
    if input.thread_id.is_empty() {
        empty = Some("thread_id");
    } else if input.body.is_empty() {
        empty = Some("body");
    } else if input.author.is_empty() {
        empty = Some("author");
    } else if input.head_sha.is_empty() {
        empty = Some("head_sha");
    }
    match empty {
        Some(field) => Err(format!("add_comment: {field} must not be empty")),
        None => Ok(()),
    }
}

/// Append a comment to an existing thread, persist the updated
/// thread, and return the new comment. The thread anchor is left
/// untouched — replies inherit the thread's anchor by construction
/// (decision 5 in the fork's local plan).
pub fn add_comment(vault: &Path, input: AddCommentInput) -> Result<Comment, String> {
    validate_add_comment(&input)?;

    let mut thread = store::read_thread(vault, &input.thread_id)?;
    let comment = Comment {
        id: generate_comment_id(),
        author: input.author,
        body: input.body,
        created_at: input.now,
        created_at_sha: input.head_sha,
    };
    thread.comments.push(comment.clone());
    store::write_thread(vault, &thread)?;
    Ok(comment)
}

/// Return every thread anchored to `note_rel_path`, sorted oldest-
/// first by `thread.created_at`. Threads on other notes are not
/// returned. Returns an empty vec when no threads exist for the
/// note (or when no threads exist at all).
pub fn list_threads_for_note(vault: &Path, note_rel_path: &str) -> Result<Vec<Thread>, String> {
    let mut threads: Vec<Thread> = store::list_thread_ids(vault)?
        .into_iter()
        .map(|id| store::read_thread(vault, &id))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .filter(|t| t.note_rel_path == note_rel_path)
        .collect();
    threads.sort_by_key(|t| t.created_at);
    Ok(threads)
}

/// Update the status of an existing thread (e.g. `Open` → `Resolved`
/// when a reviewer marks the discussion settled, or `Open` →
/// `Orphaned` when the underlying block has been deleted). All
/// other thread fields — id, anchor, comments, timestamps — are
/// preserved. Returns the updated thread.
pub fn update_thread_status(
    vault: &Path,
    thread_id: &str,
    new_status: ThreadStatus,
) -> Result<Thread, String> {
    let mut thread = store::read_thread(vault, thread_id)?;
    thread.status = new_status;
    store::write_thread(vault, &thread)?;
    Ok(thread)
}

/// Inputs for `promote_to_decision`. Mirrors the dependency-
/// injection style: caller supplies `now`, `head_sha`, and identity.
#[derive(Debug, Clone)]
pub struct PromoteToDecisionInput {
    pub thread_id: String,
    pub title: String,
    pub rationale: String,
    pub alternatives: Option<String>,
    pub owner: String,
    pub head_sha: String,
    pub now: DateTime<Utc>,
}

fn validate_promote_to_decision(input: &PromoteToDecisionInput) -> Result<(), String> {
    let mut empty: Option<&str> = None;
    if input.thread_id.is_empty() {
        empty = Some("thread_id");
    } else if input.title.is_empty() {
        empty = Some("title");
    } else if input.rationale.is_empty() {
        empty = Some("rationale");
    } else if input.owner.is_empty() {
        empty = Some("owner");
    } else if input.head_sha.is_empty() {
        empty = Some("head_sha");
    }
    match empty {
        Some(field) => Err(format!("promote_to_decision: {field} must not be empty")),
        None => Ok(()),
    }
}

/// Promote a thread to a decision. Reads the source thread (to
/// inherit its `note_rel_path` and confirm it exists), writes a new
/// `Decision` with `dec_<32hex>` id and `source_thread_id` set to
/// the thread, then marks the source thread `Resolved`. Per
/// decision 4 in the fork's local plan, the decision intentionally
/// does NOT carry the thread's anchor forward — decisions are
/// durable artifacts that outlive the text they were made about,
/// and the back-link to the source thread (and through it the
/// historical anchor + content hash) is enough for traceability.
pub fn promote_to_decision(
    vault: &Path,
    input: PromoteToDecisionInput,
) -> Result<Decision, String> {
    validate_promote_to_decision(&input)?;

    let thread = store::read_thread(vault, &input.thread_id)?;
    let decision = Decision {
        id: generate_decision_id(),
        source_thread_id: thread.id.clone(),
        note_rel_path: thread.note_rel_path.clone(),
        title: input.title,
        rationale: input.rationale,
        alternatives: input.alternatives,
        owner: input.owner,
        created_at: input.now,
        created_at_sha: input.head_sha,
    };
    store::write_decision(vault, &decision)?;
    update_thread_status(vault, &thread.id, ThreadStatus::Resolved)?;
    Ok(decision)
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

    fn add_comment_input(thread_id: &str, body: &str) -> AddCommentInput {
        AddCommentInput {
            thread_id: thread_id.to_string(),
            body: body.to_string(),
            author: "Reviewer Two <r2@example.com>".into(),
            head_sha: "1".repeat(40),
            now: Utc.with_ymd_and_hms(2026, 4, 27, 10, 0, 0).unwrap(),
        }
    }

    #[test]
    fn add_comment_appends_to_existing_thread() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        add_comment(dir.path(), add_comment_input(&thread.id, "Reply body")).unwrap();
        let on_disk = read_thread(dir.path(), &thread.id).unwrap();
        assert_eq!(on_disk.comments.len(), 2);
        assert_eq!(on_disk.comments[1].body, "Reply body");
    }

    #[test]
    fn add_comment_returns_new_comment_with_cmt_prefix() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        let comment = add_comment(dir.path(), add_comment_input(&thread.id, "Reply body")).unwrap();
        assert!(comment.id.starts_with("cmt_"));
        assert_eq!(comment.id.len(), 36);
    }

    #[test]
    fn add_comment_does_not_change_existing_comment() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        let original_first = thread.comments[0].clone();
        add_comment(dir.path(), add_comment_input(&thread.id, "Reply body")).unwrap();
        let on_disk = read_thread(dir.path(), &thread.id).unwrap();
        assert_eq!(on_disk.comments[0], original_first);
    }

    #[test]
    fn add_comment_uses_provided_now_and_head_sha() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        let input = add_comment_input(&thread.id, "Reply body");
        let expected_now = input.now;
        let expected_sha = input.head_sha.clone();
        let comment = add_comment(dir.path(), input).unwrap();
        assert_eq!(comment.created_at, expected_now);
        assert_eq!(comment.created_at_sha, expected_sha);
    }

    #[test]
    fn add_comment_rejects_unknown_thread() {
        let dir = tempdir().unwrap();
        let result = add_comment(dir.path(), add_comment_input("thr_missing", "Reply body"));
        assert!(result.is_err());
    }

    type AddCommentFieldMutator = fn(&mut AddCommentInput);

    #[test]
    fn add_comment_rejects_empty_required_fields() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        let mutators: Vec<(&str, AddCommentFieldMutator)> = vec![
            ("thread_id", |i| i.thread_id.clear()),
            ("body", |i| i.body.clear()),
            ("author", |i| i.author.clear()),
            ("head_sha", |i| i.head_sha.clear()),
        ];
        for (field, mutate) in mutators {
            let mut input = add_comment_input(&thread.id, "Reply body");
            mutate(&mut input);
            let result = add_comment(dir.path(), input);
            assert!(result.is_err(), "{field} accepted as empty");
            let err = result.unwrap_err();
            assert!(
                err.contains(field),
                "error should mention {field}, got: {err}"
            );
        }
    }

    #[test]
    fn list_threads_for_note_returns_empty_when_no_threads() {
        let dir = tempdir().unwrap();
        let threads = list_threads_for_note(dir.path(), "projects/example.md").unwrap();
        assert!(threads.is_empty());
    }

    #[test]
    fn list_threads_for_note_returns_only_matching_note() {
        let dir = tempdir().unwrap();
        let mut a = sample_input();
        a.note_rel_path = "projects/a.md".into();
        let mut b = sample_input();
        b.note_rel_path = "projects/b.md".into();
        let mut c = sample_input();
        c.note_rel_path = "projects/a.md".into();
        create_thread(dir.path(), a).unwrap();
        create_thread(dir.path(), b).unwrap();
        create_thread(dir.path(), c).unwrap();

        let on_a = list_threads_for_note(dir.path(), "projects/a.md").unwrap();
        let on_b = list_threads_for_note(dir.path(), "projects/b.md").unwrap();
        assert_eq!(on_a.len(), 2);
        assert!(on_a.iter().all(|t| t.note_rel_path == "projects/a.md"));
        assert_eq!(on_b.len(), 1);
        assert!(on_b.iter().all(|t| t.note_rel_path == "projects/b.md"));
    }

    #[test]
    fn list_threads_for_note_returns_chronological_order() {
        let dir = tempdir().unwrap();
        let mut earlier = sample_input();
        earlier.now = Utc.with_ymd_and_hms(2026, 4, 27, 8, 0, 0).unwrap();
        let mut later = sample_input();
        later.now = Utc.with_ymd_and_hms(2026, 4, 27, 12, 0, 0).unwrap();
        // Create the later one first to verify sort doesn't just preserve insertion order.
        create_thread(dir.path(), later).unwrap();
        create_thread(dir.path(), earlier).unwrap();

        let threads = list_threads_for_note(dir.path(), "projects/example.md").unwrap();
        assert_eq!(threads.len(), 2);
        assert!(threads[0].created_at < threads[1].created_at);
    }

    #[test]
    fn update_thread_status_open_to_resolved() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        let updated = update_thread_status(dir.path(), &thread.id, ThreadStatus::Resolved).unwrap();
        assert_eq!(updated.status, ThreadStatus::Resolved);
    }

    #[test]
    fn update_thread_status_open_to_orphaned() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        let updated = update_thread_status(dir.path(), &thread.id, ThreadStatus::Orphaned).unwrap();
        assert_eq!(updated.status, ThreadStatus::Orphaned);
    }

    #[test]
    fn update_thread_status_persists_to_disk() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        update_thread_status(dir.path(), &thread.id, ThreadStatus::Resolved).unwrap();
        let on_disk = read_thread(dir.path(), &thread.id).unwrap();
        assert_eq!(on_disk.status, ThreadStatus::Resolved);
    }

    #[test]
    fn update_thread_status_preserves_other_fields() {
        let dir = tempdir().unwrap();
        let original = create_thread(dir.path(), sample_input()).unwrap();
        let updated =
            update_thread_status(dir.path(), &original.id, ThreadStatus::Resolved).unwrap();
        assert_eq!(updated.id, original.id);
        assert_eq!(updated.note_rel_path, original.note_rel_path);
        assert_eq!(updated.anchor, original.anchor);
        assert_eq!(updated.comments, original.comments);
        assert_eq!(updated.created_at, original.created_at);
        assert_eq!(updated.created_at_sha, original.created_at_sha);
    }

    #[test]
    fn update_thread_status_rejects_unknown_thread() {
        let dir = tempdir().unwrap();
        let result = update_thread_status(dir.path(), "thr_missing", ThreadStatus::Resolved);
        assert!(result.is_err());
    }

    #[test]
    fn update_thread_status_can_round_trip_through_all_states() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        for status in [
            ThreadStatus::Resolved,
            ThreadStatus::Orphaned,
            ThreadStatus::Open,
        ] {
            let updated = update_thread_status(dir.path(), &thread.id, status).unwrap();
            assert_eq!(updated.status, status);
        }
    }

    fn promote_input(thread_id: &str) -> PromoteToDecisionInput {
        PromoteToDecisionInput {
            thread_id: thread_id.to_string(),
            title: "Adopt sidecar storage".into(),
            rationale: "Avoids fragmenting by SHA.".into(),
            alternatives: Some("Use a backend datastore.".into()),
            owner: "Reviewer Two <r2@example.com>".into(),
            head_sha: "1".repeat(40),
            now: Utc.with_ymd_and_hms(2026, 4, 27, 11, 0, 0).unwrap(),
        }
    }

    #[test]
    fn promote_to_decision_creates_decision_with_dec_prefix() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        let decision = promote_to_decision(dir.path(), promote_input(&thread.id)).unwrap();
        assert!(decision.id.starts_with("dec_"));
        assert_eq!(decision.id.len(), 36);
    }

    #[test]
    fn promote_to_decision_links_to_source_thread() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        let decision = promote_to_decision(dir.path(), promote_input(&thread.id)).unwrap();
        assert_eq!(decision.source_thread_id, thread.id);
    }

    #[test]
    fn promote_to_decision_inherits_note_rel_path_from_thread() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        let decision = promote_to_decision(dir.path(), promote_input(&thread.id)).unwrap();
        assert_eq!(decision.note_rel_path, thread.note_rel_path);
    }

    #[test]
    fn promote_to_decision_marks_source_thread_resolved() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        promote_to_decision(dir.path(), promote_input(&thread.id)).unwrap();
        let on_disk = read_thread(dir.path(), &thread.id).unwrap();
        assert_eq!(on_disk.status, ThreadStatus::Resolved);
    }

    #[test]
    fn promote_to_decision_persists_decision_to_disk() {
        use crate::comments::store::read_decision;
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        let decision = promote_to_decision(dir.path(), promote_input(&thread.id)).unwrap();
        let on_disk = read_decision(dir.path(), &decision.id).unwrap();
        assert_eq!(on_disk, decision);
    }

    #[test]
    fn promote_to_decision_with_alternatives_some() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        let decision = promote_to_decision(dir.path(), promote_input(&thread.id)).unwrap();
        assert_eq!(
            decision.alternatives.as_deref(),
            Some("Use a backend datastore.")
        );
    }

    #[test]
    fn promote_to_decision_with_alternatives_none() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        let mut input = promote_input(&thread.id);
        input.alternatives = None;
        let decision = promote_to_decision(dir.path(), input).unwrap();
        assert!(decision.alternatives.is_none());
    }

    #[test]
    fn promote_to_decision_uses_provided_now_and_head_sha() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        let input = promote_input(&thread.id);
        let now = input.now;
        let head_sha = input.head_sha.clone();
        let decision = promote_to_decision(dir.path(), input).unwrap();
        assert_eq!(decision.created_at, now);
        assert_eq!(decision.created_at_sha, head_sha);
    }

    #[test]
    fn promote_to_decision_rejects_unknown_thread() {
        let dir = tempdir().unwrap();
        let result = promote_to_decision(dir.path(), promote_input("thr_missing"));
        assert!(result.is_err());
    }

    type PromoteFieldMutator = fn(&mut PromoteToDecisionInput);

    #[test]
    fn promote_to_decision_rejects_empty_required_fields() {
        let dir = tempdir().unwrap();
        let thread = create_thread(dir.path(), sample_input()).unwrap();
        let mutators: Vec<(&str, PromoteFieldMutator)> = vec![
            ("thread_id", |i| i.thread_id.clear()),
            ("title", |i| i.title.clear()),
            ("rationale", |i| i.rationale.clear()),
            ("owner", |i| i.owner.clear()),
            ("head_sha", |i| i.head_sha.clear()),
        ];
        for (field, mutate) in mutators {
            let mut input = promote_input(&thread.id);
            mutate(&mut input);
            let result = promote_to_decision(dir.path(), input);
            assert!(result.is_err(), "{field} accepted as empty");
            let err = result.unwrap_err();
            assert!(
                err.contains(field),
                "error should mention {field}, got: {err}"
            );
        }
    }
}
