// Copyright (c) OpenIDE. Licensed under the MIT License.
// Bounded computation over stdio. The host owns files, trust, generations and persistence.
mod graph;
mod query;
mod syntax;
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{self, BufRead, Read, Write};

const MAX_FRAME: usize = 16 * 1024 * 1024;
const MAX_CONTENT: usize = 4 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Source {
    uri: String,
    content: String,
    language: String,
    workspace_key: String,
    known_hash: Option<String>,
    known_extraction_mode: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    #[serde(default)]
    tree_sitter: bool,
    version: u32,
    id: u64,
    files: Vec<Source>,
    regex: bool,
    indexed_at: u64,
}
struct Extractor {
    definitions: Regex,
    imports: Regex,
    tests: Regex,
    supported: Regex,
    keywords: HashSet<&'static str>,
}
fn evidence(provider: &str, at: u64) -> Value {
    json!({"provider":provider,"confidence":if provider=="regex" {0.45} else {0.25},"verified":false,"indexedAt":at})
}
fn node_id(file: &Source, uri: &str, kind: &str, name: &str) -> String {
    format!("{}::{uri}::{kind}::{name}", file.workspace_key)
}
fn hash(content: &str) -> String {
    // Match the existing manifest's FNV-1a over UTF-16 code units (including astral characters).
    let value = content.encode_utf16().fold(0x811c9dc5u32, |h, c| {
        (h ^ c as u32).wrapping_mul(0x01000193)
    });
    let mut digits = Vec::new();
    let mut remaining = value;
    loop {
        digits.push(b"0123456789abcdefghijklmnopqrstuvwxyz"[(remaining % 36) as usize]);
        remaining /= 36;
        if remaining == 0 {
            break;
        }
    }
    digits.reverse();
    String::from_utf8(digits).unwrap()
}
impl Extractor {
    fn new() -> Self {
        // JS's \w and word boundaries are ASCII. Preserve that contract across Rust regex.
        let whitespace = |pattern: &str| {
            pattern.replace(r"\s", r"[\t\n\r\x0B\x0C\x20\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]")
        };
        Self {
            definitions: Regex::new(&whitespace(r"(?-u:\b)(export\s+)?(?:default\s+)?(?:abstract\s+|public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+)*(class|interface|enum|type|function|const|let|var|def|fn)\s+([A-Za-z_$][A-Za-z0-9_$]*)")).unwrap(),
            imports: Regex::new(&whitespace(r#"import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][A-Za-z0-9_$]*|[A-Za-z_$][A-Za-z0-9_$]*)\s*(?:,\s*(?:\{[^}]*\}|[A-Za-z_$][A-Za-z0-9_$]*))*\s*from\s*['"]([^'"]+)['"]"#)).unwrap(),
            tests: Regex::new(r"(\.|_)(test|spec)\.[jt]sx?$|_test\.(go|py|rs)$|test_[^/]+\.py$|Tests?\.(cs|java|kt)$").unwrap(),
            supported: Regex::new(r"\.(ts|tsx|js|jsx|mjs|cjs|java|cs|go)$").unwrap(),
            keywords: "abstract async await break case catch class const continue debugger default delete do else enum export extends false finally for from function get if implements import in instanceof interface let new null of package private protected public return set static super switch this throw true try type typeof undefined var void while with yield".split(' ').collect(),
        }
    }
    fn extract(&self, file: &Source, regex_enabled: bool, at: u64) -> Value {
        let hash = hash(&file.content);
        let use_regex = regex_enabled
            && (self.supported.is_match(&file.uri)
                || [
                    "typescript",
                    "javascript",
                    "tsx",
                    "jsx",
                    "java",
                    "csharp",
                    "go",
                ]
                .contains(&file.language.as_str()));
        let mode = if use_regex { "regex" } else { "text" };
        if file.known_hash.as_deref() == Some(&hash)
            && file
                .known_extraction_mode
                .as_deref()
                .is_none_or(|known| known == mode)
        {
            return json!({"uri":file.uri,"hash":hash,"extractionMode":mode,"unchanged":true});
        }
        let file_id = node_id(file, &file.uri, "file", &file.uri);
        let basename = file
            .uri
            .rsplit('/')
            .next()
            .filter(|s| !s.is_empty())
            .unwrap_or(&file.uri);
        let e = evidence(if use_regex { "regex" } else { "text" }, at);
        let mut nodes = vec![
            json!({"id":file_id,"kind":"file","name":basename,"uri":file.uri,"evidence":e,"degree":0}),
        ];
        let mut edges = Vec::new();
        if use_regex {
            let mut seen = HashSet::new();
            let mut cursor = 0;
            let mut line = 1;
            for capture in self.definitions.captures_iter(&file.content) {
                let name = &capture[3];
                if self.keywords.contains(name) {
                    continue;
                }
                let start = capture.get(0).unwrap().start();
                line += file.content.as_bytes()[cursor..start]
                    .iter()
                    .filter(|&&b| b == b'\n')
                    .count();
                cursor = start;
                let kind = match &capture[2] {
                    "class" => "class",
                    "interface" => "interface",
                    "enum" => "enum",
                    "type" => "type",
                    "const" => "constant",
                    "let" | "var" => "variable",
                    _ => "function",
                };
                let id = format!("{}::{line}", node_id(file, &file.uri, kind, name));
                if !seen.insert(id.clone()) {
                    continue;
                }
                nodes.push(json!({"id":id,"kind":kind,"name":name,"qualifiedName":name,"uri":file.uri,"range":{"startLine":line,"startColumn":0,"endLine":line,"endColumn":0},"language":file.language,"exported":capture.get(1).is_some(),"evidence":e,"degree":0}));
                edges.push(json!({"source":file_id,"target":id,"type":"CONTAINS","evidence":e}));
            }
            let mut modules = HashMap::new();
            for capture in self.imports.captures_iter(&file.content) {
                let spec = &capture[1];
                let relative =
                    spec.starts_with("./") || spec.starts_with("../") || spec.starts_with('/');
                let alias = ["@/", "~/", "#/"]
                    .iter()
                    .any(|prefix| spec.starts_with(prefix));
                let internal = relative || alias;
                let package = if spec.starts_with('@') {
                    spec.split('/').take(2).collect::<Vec<_>>().join("/")
                } else {
                    spec.split('/')
                        .next()
                        .filter(|s| !s.is_empty())
                        .unwrap_or(spec)
                        .to_string()
                };
                let uri = if relative {
                    file.uri.clone()
                } else if alias {
                    format!("openide-alias:{spec}")
                } else {
                    format!("openide-package:{package}")
                };
                let kind = if internal { "module" } else { "dependency" };
                let id = node_id(file, &uri, kind, if internal { spec } else { &package });
                let name = if internal {
                    spec.rsplit('/')
                        .next()
                        .filter(|s| !s.is_empty())
                        .unwrap_or(spec)
                } else {
                    &package
                };
                let node = json!({"id":id,"kind":kind,"name":name,"qualifiedName":spec,"uri":uri,"evidence":e,"degree":0});
                // Match Map.set: later package subpaths update the value without changing order.
                if let Some(&index) = modules.get(&id) {
                    nodes[index] = node;
                } else {
                    modules.insert(id.clone(), nodes.len());
                    nodes.push(node);
                    edges.push(json!({"source":file_id,"target":id,"type":"IMPORTS","evidence":e}));
                }
            }
        }
        if self.tests.is_match(&file.uri) {
            let e = evidence("text", at);
            let id = format!("{file_id}::test");
            nodes.push(json!({"id":id,"kind":"test","name":basename,"uri":file.uri,"evidence":e,"degree":0}));
            edges.push(json!({"source":id,"target":file_id,"type":"TESTS","evidence":e}));
        }
        json!({"uri":file.uri,"hash":hash,"extractionMode":mode,"extraction":{"nodes":nodes,"edges":edges}})
    }
    fn handle(&self, request: Request, syntax: &mut syntax::SyntaxEngine) -> Value {
        if request.version != 1
            || request.files.len() > 40
            || request.files.iter().map(|f| f.content.len()).sum::<usize>() > MAX_CONTENT
            || request.files.iter().any(|f| {
                f.content.len() > 1600 * 1024
                    || f.uri.len() > 16 * 1024
                    || f.workspace_key.len() > 64 * 1024
            })
        {
            return json!({"version":1,"id":request.id,"error":"Invalid protocol version or batch limits"});
        }
        let files: Result<Vec<_>, String> = request.files.iter().map(|file| {
            if request.tree_sitter && syntax::SyntaxEngine::supports(&file.uri, &file.language) {
                let hash = hash(&file.content);
                if file.known_hash.as_deref() == Some(&hash)
                    && file.known_extraction_mode.as_deref() == Some("treeSitter")
                {
                    return Ok(json!({"uri":file.uri,"hash":hash,"extractionMode":"treeSitter","unchanged":true}));
                }
                if let Some(extraction) = syntax.extract(&file.uri, &file.content, &file.language, &file.workspace_key, request.indexed_at)? {
                    return Ok(json!({"uri":file.uri,"hash":hash,"extractionMode":"treeSitter","extraction":extraction}));
                }
            }
            Ok(self.extract(file, request.regex, request.indexed_at))
        }).collect();
        match files {
            Ok(files) => json!({"version":1,"id":request.id,"files":files}),
            Err(error) => json!({"version":1,"id":request.id,"error":error}),
        }
    }
}
// Retained JSON is capped independently of the per-frame transport limit. No workspace paths
// are opened here: all payloads arrive from the authenticated shared-process runtime.
const MAX_RETAINED: usize = 128 * 1024 * 1024;
#[derive(Default)]
struct Resident {
    files: BTreeMap<String, Value>,
    file_sizes: HashMap<String, usize>,
    graph_bytes: usize,
    query_version: String,
    query_snapshot: Value,
    query_bytes: usize,
    include_heuristic: bool,
    query_index: Option<query::QueryIndex>,
}
impl Resident {
    fn dispatch(&mut self, method: &str, params: &Value) -> Result<Value, String> {
        match method {
            "clear" => {
                *self = Self::default();
                Ok(json!(true))
            }
            "graphUpdate" => {
                if params["reset"].as_bool() == Some(true) {
                    self.files.clear();
                    self.file_sizes.clear();
                    self.graph_bytes = 0;
                }
                if let Some(removed) = params["removed"].as_array() {
                    for uri in removed.iter().filter_map(Value::as_str) {
                        self.files.remove(uri);
                        self.graph_bytes -= self.file_sizes.remove(uri).unwrap_or(0);
                    }
                }
                let files = params["files"].as_array().ok_or("Missing graph files")?;
                for file in files {
                    let uri = file["uri"].as_str().ok_or("Missing file URI")?;
                    if uri.len() > 16384 || !file["nodes"].is_array() || !file["edges"].is_array() {
                        return Err("Invalid graph payload".into());
                    }
                    let bytes = serde_json::to_vec(file)
                        .map_err(|_| "Invalid graph payload")?
                        .len();
                    let next =
                        self.graph_bytes - self.file_sizes.get(uri).copied().unwrap_or(0) + bytes;
                    if next > MAX_RETAINED
                        || (self.files.len() >= 100_000 && !self.files.contains_key(uri))
                    {
                        return Err("Resident graph exceeds limits".into());
                    }
                    self.files.insert(uri.to_owned(), file.clone());
                    self.file_sizes.insert(uri.to_owned(), bytes);
                    self.graph_bytes = next;
                }
                Ok(json!(true))
            }
            "graphFinalize" => {
                let uris = params["fileUris"].as_array().ok_or("Missing file URIs")?;
                if uris.len() > 100_000 {
                    return Err("Too many files".into());
                }
                let uris: Result<Vec<_>, _> = uris
                    .iter()
                    .map(|u| u.as_str().map(str::to_owned).ok_or("Invalid file URI"))
                    .collect();
                graph::finalize(&uris?, &self.files)
            }
            "queryReset" => {
                let version = params["version"].as_str().ok_or("Missing query version")?;
                if version.len() > 1024 {
                    return Err("Invalid query version".into());
                }
                self.query_version = version.to_owned();
                self.include_heuristic = params["includeHeuristic"].as_bool().unwrap_or(true);
                self.query_index = None;
                self.query_bytes = 0;
                self.query_snapshot = json!({"nodes":[],"edges":[],"communities":[],"dirtyUris":[],"collationIds":[],"version":{"version":params["indexVersion"]}});
                Ok(json!(true))
            }
            "queryAppend" => {
                self.check_version(params)?;
                if self.query_index.is_some() {
                    return Err("Query snapshot already committed".into());
                }
                let bytes = serde_json::to_vec(params)
                    .map_err(|_| "Invalid query payload")?
                    .len();
                if self.query_bytes + bytes > MAX_RETAINED {
                    return Err("Resident query exceeds limits".into());
                }
                for key in ["nodes", "edges", "communities", "dirtyUris", "collationIds"] {
                    if let Some(values) = params.get(key) {
                        let values = values.as_array().ok_or("Invalid query array")?;
                        self.query_snapshot[key]
                            .as_array_mut()
                            .ok_or("Missing query staging")?
                            .extend(values.iter().cloned());
                    }
                }
                self.query_bytes += bytes;
                Ok(json!(true))
            }
            "queryRun" => {
                self.check_version(params)?;
                if self.query_index.is_none() {
                    self.query_index = Some(query::QueryIndex::new(
                        &self.query_snapshot,
                        self.include_heuristic,
                    )?);
                    self.query_snapshot = Value::Null;
                }
                self.query_index
                    .as_ref()
                    .ok_or("Missing query index")?
                    .query(
                        params["method"].as_str().ok_or("Missing query method")?,
                        &params["args"],
                    )
            }
            _ => Err("Unknown native method".into()),
        }
    }
    fn check_version(&self, params: &Value) -> Result<(), String> {
        if self.query_version.is_empty()
            || params["version"].as_str() != Some(self.query_version.as_str())
        {
            return Err("Stale native query snapshot".into());
        }
        Ok(())
    }
}
fn main() -> io::Result<()> {
    let engine = Extractor::new();
    let mut resident = Resident::default();
    let mut syntax = syntax::SyntaxEngine::new();
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    loop {
        let mut frame = Vec::new();
        let bytes = input
            .by_ref()
            .take((MAX_FRAME + 1) as u64)
            .read_until(b'\n', &mut frame)?;
        if bytes == 0 {
            return Ok(());
        }
        if bytes > MAX_FRAME {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Frame too large",
            ));
        }
        let response = match serde_json::from_slice::<Value>(&frame) {
            Ok(value) if value["version"].as_u64() == Some(1) && value["method"].is_string() => {
                let method = value["method"].as_str().unwrap();
                if method == "clear" {
                    syntax.clear();
                }
                if method == "graphUpdate" {
                    if let Some(removed) = value["params"]["removed"].as_array() {
                        for uri in removed.iter().filter_map(Value::as_str) {
                            syntax.remove(uri);
                        }
                    }
                }
                let result = if method == "syntaxMetrics" {
                    Ok(syntax.metrics())
                } else {
                    resident.dispatch(method, &value["params"])
                };
                match result {
                    Ok(result) => json!({"version":1,"id":value["id"],"result":result}),
                    Err(error) => json!({"version":1,"id":value["id"],"error":error}),
                }
            }
            Ok(value) => match serde_json::from_value::<Request>(value) {
                Ok(request) => engine.handle(request, &mut syntax),
                Err(_) => json!({"version":1,"id":0,"error":"Invalid request"}),
            },
            Err(_) => json!({"version":1,"id":0,"error":"Invalid request"}),
        };
        let mut bytes = serde_json::to_vec(&response)?;
        if bytes.len() > MAX_FRAME {
            bytes = serde_json::to_vec(
                &json!({"version":1,"id":response["id"],"error":"Result too large"}),
            )?;
        }
        output.write_all(&bytes)?;
        output.write_all(b"\n")?;
        output.flush()?;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_utf16_manifest_hash() {
        assert_eq!(hash(""), "ztntfp");
        assert_eq!(hash("hello"), "m3bicr");
    }
    #[test]
    fn limits_and_version() {
        let engine = Extractor::new();
        let response = engine.handle(
            Request {
                tree_sitter: false,
                version: 2,
                id: 9,
                files: vec![],
                regex: true,
                indexed_at: 0,
            },
            &mut syntax::SyntaxEngine::new(),
        );
        assert!(response.get("error").is_some());
    }
}
