use sha2::{Digest, Sha256};

/// Hash plain-text block content into the format stored on
/// `Anchor.content_hash`: a `"sha256:"` prefix followed by 64
/// lowercase hex characters. Callers compare two such strings for
/// equality to detect whether a block's content has drifted from
/// the snapshot taken at thread creation time.
pub fn content_hash(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    let digest = hasher.finalize();
    format!("sha256:{:x}", digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_hash_uses_sha256_prefix() {
        let hash = content_hash("any text");
        assert!(
            hash.starts_with("sha256:"),
            "expected `sha256:` prefix, got {hash}"
        );
    }

    #[test]
    fn content_hash_hex_body_is_64_chars() {
        let hash = content_hash("any text");
        let body = hash.strip_prefix("sha256:").expect("prefix present");
        assert_eq!(body.len(), 64);
        assert!(body
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()));
    }

    #[test]
    fn content_hash_is_deterministic() {
        let a = content_hash("the quick brown fox");
        let b = content_hash("the quick brown fox");
        assert_eq!(a, b);
    }

    #[test]
    fn content_hash_distinguishes_different_inputs() {
        let a = content_hash("first paragraph");
        let b = content_hash("second paragraph");
        assert_ne!(a, b);
    }

    #[test]
    fn content_hash_empty_string_is_known_value() {
        // SHA-256 of the empty string per FIPS 180-4 / RFC 6234.
        assert_eq!(
            content_hash(""),
            "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn content_hash_treats_whitespace_as_significant() {
        let a = content_hash("hello world");
        let b = content_hash("hello  world"); // two spaces
        assert_ne!(a, b);
    }
}
