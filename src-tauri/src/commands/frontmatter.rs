use crate::errors::{AppError, Result};
use gray_matter::{engine::YAML, Matter};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct ParsedDoc {
    pub frontmatter: serde_yaml::Value,
    pub body: String,
}

pub fn parse_doc(raw: &str) -> Result<ParsedDoc> {
    let matter = Matter::<YAML>::new();
    let result = matter.parse(raw);
    let frontmatter = match result.data {
        Some(pod) => {
            let json: serde_json::Value = pod.deserialize()
                .map_err(|e| AppError::Frontmatter(e.to_string()))?;
            serde_yaml::to_value(json).map_err(|e| AppError::Frontmatter(e.to_string()))?
        }
        None => serde_yaml::Value::Null,
    };
    // gray_matter strips a trailing newline from content; restore it if the
    // original raw string ended with one so round-trips are lossless.
    let body = if raw.ends_with('\n') && !result.content.ends_with('\n') {
        format!("{}\n", result.content)
    } else {
        result.content
    };
    Ok(ParsedDoc { frontmatter, body })
}

pub fn serialize_doc(doc: &ParsedDoc) -> Result<String> {
    let body = doc.body.trim_start_matches('\n').to_string();
    let yaml_out = match &doc.frontmatter {
        serde_yaml::Value::Null => return Ok(body),
        serde_yaml::Value::Mapping(m) if m.is_empty() => return Ok(body),
        v => serde_yaml::to_string(v).map_err(|e| AppError::Frontmatter(e.to_string()))?,
    };
    Ok(format!("---\n{}---\n\n{}", yaml_out, body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_doc_with_frontmatter() {
        let raw = "---\ntitle: Hello\ntags:\n  - a\n---\n\n# Body";
        let doc = parse_doc(raw).unwrap();
        let map = doc.frontmatter.as_mapping().unwrap();
        assert_eq!(map.get(&serde_yaml::Value::String("title".into())).unwrap().as_str().unwrap(), "Hello");
        assert!(doc.body.contains("# Body"));
    }

    #[test]
    fn parses_doc_without_frontmatter() {
        let raw = "# Just body";
        let doc = parse_doc(raw).unwrap();
        assert!(matches!(doc.frontmatter, serde_yaml::Value::Null));
        assert_eq!(doc.body.trim(), "# Just body");
    }

    #[test]
    fn round_trip_preserves_content() {
        let raw = "---\ntitle: T\ndate: 2026-05-09\ntags:\n- a\n- b\n---\n\n# Heading\n\nBody.";
        let doc = parse_doc(raw).unwrap();
        let out = serialize_doc(&doc).unwrap();
        let reparsed = parse_doc(&out).unwrap();
        assert_eq!(reparsed.body, doc.body);
        assert_eq!(reparsed.frontmatter, doc.frontmatter);
    }

    #[test]
    fn serializes_no_frontmatter_as_plain_body() {
        let doc = ParsedDoc { frontmatter: serde_yaml::Value::Null, body: "hi".into() };
        let out = serialize_doc(&doc).unwrap();
        assert_eq!(out, "hi");
    }
}
