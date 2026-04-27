use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Anchor {
    pub block_id: String,
    pub created_at_sha: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThreadStatus {
    Open,
    Resolved,
    Orphaned,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Comment {
    pub id: String,
    pub author: String,
    pub body: String,
    pub created_at: DateTime<Utc>,
    pub created_at_sha: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Thread {
    pub id: String,
    pub note_rel_path: String,
    pub anchor: Anchor,
    pub status: ThreadStatus,
    pub comments: Vec<Comment>,
    pub created_at: DateTime<Utc>,
    pub created_at_sha: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Decision {
    pub id: String,
    pub source_thread_id: String,
    pub note_rel_path: String,
    pub title: String,
    pub rationale: String,
    pub alternatives: Option<String>,
    pub owner: String,
    pub created_at: DateTime<Utc>,
    pub created_at_sha: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn fixed_dt() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 4, 26, 12, 0, 0).unwrap()
    }

    fn sample_anchor() -> Anchor {
        Anchor {
            block_id: "bn_block_abc".into(),
            created_at_sha: "0".repeat(40),
            content_hash: "sha256:0000".into(),
        }
    }

    fn sample_comment() -> Comment {
        Comment {
            id: "cmt_001".into(),
            author: "Test User <test@example.com>".into(),
            body: "First comment".into(),
            created_at: fixed_dt(),
            created_at_sha: "0".repeat(40),
        }
    }

    #[test]
    fn anchor_round_trip() {
        let value = sample_anchor();
        let json = serde_json::to_string(&value).unwrap();
        let parsed: Anchor = serde_json::from_str(&json).unwrap();
        assert_eq!(value, parsed);
    }

    #[test]
    fn anchor_uses_snake_case_field_names() {
        let json = serde_json::to_string(&sample_anchor()).unwrap();
        assert!(json.contains("\"block_id\""));
        assert!(json.contains("\"created_at_sha\""));
        assert!(json.contains("\"content_hash\""));
    }

    #[test]
    fn thread_status_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&ThreadStatus::Open).unwrap(),
            "\"open\""
        );
        assert_eq!(
            serde_json::to_string(&ThreadStatus::Resolved).unwrap(),
            "\"resolved\""
        );
        assert_eq!(
            serde_json::to_string(&ThreadStatus::Orphaned).unwrap(),
            "\"orphaned\""
        );
    }

    #[test]
    fn unknown_thread_status_is_rejected() {
        let result: Result<ThreadStatus, _> = serde_json::from_str("\"weird\"");
        assert!(result.is_err());
    }

    #[test]
    fn comment_round_trip() {
        let value = sample_comment();
        let json = serde_json::to_string(&value).unwrap();
        let parsed: Comment = serde_json::from_str(&json).unwrap();
        assert_eq!(value, parsed);
    }

    #[test]
    fn thread_round_trip_with_comments() {
        let value = Thread {
            id: "thr_001".into(),
            note_rel_path: "projects/example.md".into(),
            anchor: sample_anchor(),
            status: ThreadStatus::Open,
            comments: vec![sample_comment()],
            created_at: fixed_dt(),
            created_at_sha: "0".repeat(40),
        };
        let json = serde_json::to_string(&value).unwrap();
        let parsed: Thread = serde_json::from_str(&json).unwrap();
        assert_eq!(value, parsed);
    }

    #[test]
    fn decision_round_trip_with_alternatives_some() {
        let value = Decision {
            id: "dec_001".into(),
            source_thread_id: "thr_001".into(),
            note_rel_path: "projects/example.md".into(),
            title: "Adopt sidecar storage".into(),
            rationale: "Avoids fragmenting by SHA.".into(),
            alternatives: Some("Use a backend datastore.".into()),
            owner: "Test User <test@example.com>".into(),
            created_at: fixed_dt(),
            created_at_sha: "0".repeat(40),
        };
        let json = serde_json::to_string(&value).unwrap();
        let parsed: Decision = serde_json::from_str(&json).unwrap();
        assert_eq!(value, parsed);
    }

    #[test]
    fn decision_round_trip_with_alternatives_none() {
        let value = Decision {
            id: "dec_002".into(),
            source_thread_id: "thr_002".into(),
            note_rel_path: "projects/example.md".into(),
            title: "No alternatives".into(),
            rationale: "There weren't any worth recording.".into(),
            alternatives: None,
            owner: "Test User <test@example.com>".into(),
            created_at: fixed_dt(),
            created_at_sha: "0".repeat(40),
        };
        let json = serde_json::to_string(&value).unwrap();
        let parsed: Decision = serde_json::from_str(&json).unwrap();
        assert_eq!(value, parsed);
    }
}
