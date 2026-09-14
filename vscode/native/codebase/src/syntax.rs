// Copyright (c) OpenIDE. Licensed under the MIT License.
// Opt-in syntax extraction. No filesystem access, module resolution or semantic call inference.
use regex::Regex;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};
use tree_sitter::{
    InputEdit, Language, Node, ParseOptions, Parser, Point, Query, QueryCursor, StreamingIterator,
    Tree,
};

const MAX_FILE_BYTES: usize = 1600 * 1024;
const MAX_CACHE_FILES: usize = 32;
const MAX_CACHE_BYTES: usize = 8 * 1024 * 1024;
const MAX_CACHE_NODES: usize = 250_000;
const MAX_OUTPUT_NODES: usize = 30_000;
const PARSE_BUDGET: Duration = Duration::from_secs(1);
const COMMON_QUERY: &str = r#"
(function_declaration name: (identifier) @name) @function
(generator_function_declaration name: (identifier) @name) @function
(class_declaration name: (_) @name) @class
(variable_declarator name: (identifier) @name) @variable
(method_definition name: (_) @name) @method
(import_statement source: (string) @source) @import
(export_statement source: (string) @source) @reexport
"#;
const TYPESCRIPT_QUERY: &str = r#"
(abstract_class_declaration name: (_) @name) @class
(interface_declaration name: (_) @name) @interface
(enum_declaration name: (_) @name) @enum
(type_alias_declaration name: (_) @name) @type
"#;

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Grammar {
    TypeScript,
    Tsx,
    JavaScript,
}
impl Grammar {
    fn for_file(uri: &str, language: &str) -> Option<Self> {
        match language {
            "typescriptreact" | "tsx" => Some(Self::Tsx),
            "javascriptreact" | "jsx" | "javascript" => Some(Self::JavaScript),
            "typescript" => Some(Self::TypeScript),
            // Unknown language IDs may come from the indexer's extension classifier. Never
            // reinterpret a deliberately selected different language just because of its suffix.
            "" | "unknown" => {
                let path = uri.split(['?', '#']).next().unwrap_or(uri);
                if path.ends_with(".tsx") {
                    Some(Self::Tsx)
                } else if [".ts", ".mts", ".cts"].iter().any(|s| path.ends_with(s)) {
                    Some(Self::TypeScript)
                } else if [".js", ".jsx", ".mjs", ".cjs"]
                    .iter()
                    .any(|s| path.ends_with(s))
                {
                    Some(Self::JavaScript)
                } else {
                    None
                }
            }
            _ => None,
        }
    }
    fn language(self) -> Language {
        match self {
            Self::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Self::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Self::JavaScript => tree_sitter_javascript::LANGUAGE.into(),
        }
    }
}
struct Runtime {
    parser: Parser,
    query: Query,
}
impl Runtime {
    fn new(grammar: Grammar) -> Result<Self, String> {
        let language = grammar.language();
        let mut parser = Parser::new();
        parser
            .set_language(&language)
            .map_err(|_| "Unsupported syntax grammar ABI")?;
        let query = if grammar == Grammar::JavaScript {
            COMMON_QUERY.to_owned()
        } else {
            format!("{COMMON_QUERY}{TYPESCRIPT_QUERY}")
        };
        let query = Query::new(&language, &query).map_err(|_| "Invalid syntax extraction query")?;
        Ok(Self { parser, query })
    }
}
struct CachedTree {
    grammar: Grammar,
    content: String,
    tree: Tree,
    used: u64,
    nodes: usize,
}
#[derive(Default)]
struct Counters {
    full_parses: u64,
    incremental_parses: u64,
    unchanged_hits: u64,
    evictions: u64,
    parse_errors: u64,
}

pub struct SyntaxEngine {
    runtimes: HashMap<Grammar, Runtime>,
    cache: HashMap<String, CachedTree>,
    bytes: usize,
    nodes: usize,
    clock: u64,
    counters: Counters,
    tests: Regex,
}
impl SyntaxEngine {
    pub fn supports(uri: &str, language: &str) -> bool {
        Grammar::for_file(uri, language).is_some()
    }
    pub fn new() -> Self {
        Self {
            runtimes: HashMap::new(),
            cache: HashMap::new(),
            bytes: 0,
            nodes: 0,
            clock: 0,
            counters: Counters::default(),
            tests: Regex::new(r"(\.|_)(test|spec)\.[jt]sx?$").expect("Static test-file pattern"),
        }
    }
    pub fn remove(&mut self, uri: &str) {
        if let Some(entry) = self.cache.remove(uri) {
            self.bytes -= entry.content.len();
            self.nodes -= entry.nodes;
        }
    }
    pub fn clear(&mut self) {
        self.cache.clear();
        self.runtimes.clear();
        self.bytes = 0;
        self.nodes = 0;
    }
    pub fn metrics(&self) -> Value {
        json!({"fullParses":self.counters.full_parses,"incrementalParses":self.counters.incremental_parses,
            "unchangedHits":self.counters.unchanged_hits,"evictions":self.counters.evictions,
            "parseErrors":self.counters.parse_errors,"cachedFiles":self.cache.len(),
            "cachedBytes":self.bytes,"cachedNodes":self.nodes})
    }
    pub fn extract(
        &mut self,
        file_uri: &str,
        content: &str,
        language: &str,
        workspace_key: &str,
        indexed_at: u64,
    ) -> Result<Option<Value>, String> {
        let Some(grammar) = Grammar::for_file(file_uri, language) else {
            self.remove(file_uri);
            return Ok(None);
        };
        if content.len() > MAX_FILE_BYTES {
            self.remove(file_uri);
            return Err("Syntax source exceeds size limit".into());
        }
        if let std::collections::hash_map::Entry::Vacant(entry) = self.runtimes.entry(grammar) {
            entry.insert(Runtime::new(grammar)?);
        }
        let previous = self.cache.remove(file_uri);
        if let Some(entry) = &previous {
            self.bytes -= entry.content.len();
            self.nodes -= entry.nodes;
        }
        let previous = previous.filter(|entry| entry.grammar == grammar);
        let tree = if let Some(entry) = previous.as_ref().filter(|entry| entry.content == content) {
            self.counters.unchanged_hits += 1;
            entry.tree.clone()
        } else {
            let old_tree = previous.map(|mut entry| {
                entry.tree.edit(&edit_between(&entry.content, content));
                entry.tree
            });
            let runtime = self
                .runtimes
                .get_mut(&grammar)
                .expect("Initialized grammar");
            let started = Instant::now();
            let mut stop = |_: &tree_sitter::ParseState| started.elapsed() > PARSE_BUDGET;
            let mut input = |offset: usize, _: Point| &content.as_bytes()[offset..];
            let parsed = runtime.parser.parse_with_options(
                &mut input,
                old_tree.as_ref(),
                Some(ParseOptions::new().progress_callback(&mut stop)),
            );
            let Some(tree) = parsed else {
                runtime.parser.reset();
                return Err("Syntax parse exceeded time limit".into());
            };
            if old_tree.is_some() {
                self.counters.incremental_parses += 1;
            } else {
                self.counters.full_parses += 1;
            }
            tree
        };
        if tree.root_node().has_error() {
            self.counters.parse_errors += 1;
        }
        let runtime = self.runtimes.get(&grammar).expect("Initialized grammar");
        let extraction = extract_tree(
            &runtime.query,
            &tree,
            file_uri,
            content,
            language,
            workspace_key,
            indexed_at,
            self.tests.is_match(file_uri),
        )?;
        let count = tree.root_node().descendant_count();
        // Count retained text and tree nodes, not an assumed bytes-per-node allocation. Individual
        // parser allocations are additionally bounded by source size and the parse time budget.
        if count <= MAX_CACHE_NODES && content.len() <= MAX_CACHE_BYTES {
            while self.cache.len() >= MAX_CACHE_FILES
                || self.bytes + content.len() > MAX_CACHE_BYTES
                || self.nodes + count > MAX_CACHE_NODES
            {
                let Some(oldest) = self
                    .cache
                    .iter()
                    .min_by_key(|(_, entry)| entry.used)
                    .map(|(uri, _)| uri.clone())
                else {
                    break;
                };
                self.remove(&oldest);
                self.counters.evictions += 1;
            }
            self.clock += 1;
            self.bytes += content.len();
            self.nodes += count;
            self.cache.insert(
                file_uri.to_owned(),
                CachedTree {
                    grammar,
                    content: content.to_owned(),
                    tree,
                    used: self.clock,
                    nodes: count,
                },
            );
        }
        Ok(Some(extraction))
    }
}

// One replacement edit describes any two versions. Prefix/suffix scanning is byte-based, but
// boundaries retreat to Unicode scalar boundaries before Tree-sitter receives UTF-8 positions.
fn edit_between(old: &str, new: &str) -> InputEdit {
    let mut start = old
        .bytes()
        .zip(new.bytes())
        .take_while(|(a, b)| a == b)
        .count();
    while !old.is_char_boundary(start) || !new.is_char_boundary(start) {
        start -= 1;
    }
    let mut suffix = old.as_bytes()[start..]
        .iter()
        .rev()
        .zip(new.as_bytes()[start..].iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    while !old.is_char_boundary(old.len() - suffix) || !new.is_char_boundary(new.len() - suffix) {
        suffix -= 1;
    }
    let old_end = old.len() - suffix;
    let new_end = new.len() - suffix;
    InputEdit {
        start_byte: start,
        old_end_byte: old_end,
        new_end_byte: new_end,
        start_position: byte_point(old, start),
        old_end_position: byte_point(old, old_end),
        new_end_position: byte_point(new, new_end),
    }
}
fn byte_point(content: &str, offset: usize) -> Point {
    let prefix = &content.as_bytes()[..offset];
    Point::new(
        prefix.iter().filter(|&&b| b == b'\n').count(),
        prefix
            .iter()
            .rposition(|&b| b == b'\n')
            .map_or(offset, |i| offset - i - 1),
    )
}
fn evidence(at: u64) -> Value {
    json!({"provider":"treeSitter","confidence":0.8,"verified":false,"indexedAt":at})
}
fn range(node: Node<'_>, content: &str) -> Value {
    let column = |offset: usize, point: Point| {
        content[offset - point.column..offset]
            .encode_utf16()
            .count()
    };
    let start = node.start_position();
    let end = node.end_position();
    json!({"startLine":start.row+1,"startColumn":column(node.start_byte(),start),
        "endLine":end.row+1,"endColumn":column(node.end_byte(),end)})
}
fn malformed(node: Node<'_>) -> bool {
    if node.has_error() || node.is_missing() {
        return true;
    }
    let mut parent = node.parent();
    while let Some(value) = parent {
        if value.is_error() || value.is_missing() {
            return true;
        }
        parent = value.parent();
    }
    false
}
fn declaration(node: Node<'_>) -> Node<'_> {
    let mut result = node;
    if result.kind() == "variable_declarator" {
        if let Some(parent) = result.parent() {
            result = parent;
        }
    }
    if let Some(parent) = result.parent().filter(|parent| {
        parent.kind() == "export_statement" || parent.kind() == "ambient_declaration"
    }) {
        result = parent;
    }
    result
}
#[allow(clippy::too_many_arguments)]
fn extract_tree(
    query: &Query,
    tree: &Tree,
    uri: &str,
    content: &str,
    language: &str,
    workspace: &str,
    at: u64,
    is_test: bool,
) -> Result<Value, String> {
    let e = evidence(at);
    let file_id = format!("{workspace}::{uri}::file::{uri}");
    let basename = uri
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or(uri);
    let mut nodes = vec![
        json!({"id":file_id,"kind":"file","name":basename,"uri":uri,"evidence":e,"degree":0,"metadata":{"syntaxErrors":tree.root_node().has_error()}}),
    ];
    let mut edges = Vec::new();
    let mut seen = HashSet::new();
    let mut imports = HashMap::new();
    let mut cursor = QueryCursor::new();
    cursor.set_match_limit(128);
    let mut matches = cursor.matches(query, tree.root_node(), content.as_bytes());
    let started = Instant::now();
    while let Some(m) = matches.next() {
        if started.elapsed() > PARSE_BUDGET || nodes.len() >= MAX_OUTPUT_NODES {
            return Err("Syntax extraction exceeds work limit".into());
        }
        let mut name = None;
        let mut source = None;
        let mut capture = None;
        for c in m.captures {
            let label = query.capture_names()[c.index as usize];
            match label {
                "name" => name = Some(c.node),
                "source" => source = Some(c.node),
                _ => capture = Some((label, c.node)),
            }
        }
        let Some((capture_kind, node)) = capture else {
            continue;
        };
        if malformed(node) {
            continue;
        }
        if let Some(source) = source {
            let text = &content[source.byte_range()];
            // Escaped literals need JS decoding; leaving them unresolved is safer than fabricating
            // a different path. Dynamic import expressions and require calls are not inferred.
            if text.len() < 2 || text.contains('\\') {
                continue;
            }
            let spec = &text[1..text.len() - 1];
            if spec.is_empty() {
                continue;
            }
            let relative =
                spec.starts_with("./") || spec.starts_with("../") || spec.starts_with('/');
            let alias = ["@/", "~/", "#/"].iter().any(|p| spec.starts_with(p));
            let internal = relative || alias;
            let package = if spec.starts_with('@') {
                spec.split('/').take(2).collect::<Vec<_>>().join("/")
            } else {
                spec.split('/').next().unwrap_or(spec).to_owned()
            };
            let target_uri = if relative {
                uri.to_owned()
            } else if alias {
                format!("openide-alias:{spec}")
            } else {
                format!("openide-package:{package}")
            };
            let kind = if internal { "module" } else { "dependency" };
            let identity = if internal { spec } else { &package };
            let id = format!("{workspace}::{target_uri}::{kind}::{identity}");
            let target = json!({"id":id,"kind":kind,"name":if internal { spec.rsplit('/').next().unwrap_or(spec) } else { &package },"qualifiedName":spec,"uri":target_uri,"evidence":e,"degree":0});
            if let Some(&index) = imports.get(&id) {
                nodes[index] = target;
            } else {
                imports.insert(id.clone(), nodes.len());
                nodes.push(target);
                edges.push(json!({"source":file_id,"target":id,"type":"IMPORTS","evidence":e}));
            }
            // A re-export depends on the source module syntactically; no symbol-level target is
            // guessed. Keep the existing synthetic import contract for the graph resolver.
            continue;
        }
        let Some(name_node) = name else {
            continue;
        };
        if ![
            "identifier",
            "type_identifier",
            "property_identifier",
            "private_property_identifier",
        ]
        .contains(&name_node.kind())
        {
            continue;
        }
        let name = &content[name_node.byte_range()];
        let kind = if capture_kind == "variable" {
            let parent = node.parent();
            if parent
                .and_then(|p| p.child(0))
                .is_some_and(|first| first.kind() == "const")
            {
                "constant"
            } else {
                "variable"
            }
        } else if capture_kind == "method" && name == "constructor" {
            "constructor"
        } else {
            capture_kind
        };
        let declaration = declaration(node);
        let line = declaration.start_position().row + 1;
        let id = format!("{workspace}::{uri}::{kind}::{name}::{line}");
        if !seen.insert(id.clone()) {
            continue;
        }
        nodes.push(json!({"id":id,"kind":kind,"name":name,"qualifiedName":name,"uri":uri,"range":range(declaration,content),"language":language,"exported":declaration.kind()=="export_statement","evidence":e,"degree":0}));
        edges.push(json!({"source":file_id,"target":id,"type":"CONTAINS","evidence":e}));
    }
    drop(matches);
    if cursor.did_exceed_match_limit() {
        return Err("Syntax query exceeds match limit".into());
    }
    if is_test {
        let text_evidence =
            json!({"provider":"text","confidence":0.25,"verified":false,"indexedAt":at});
        let id = format!("{file_id}::test");
        nodes.push(json!({"id":id,"kind":"test","name":basename,"uri":uri,"evidence":text_evidence,"degree":0}));
        edges.push(json!({"source":id,"target":file_id,"type":"TESTS","evidence":text_evidence}));
    }
    Ok(json!({"nodes":nodes,"edges":edges}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn extract(engine: &mut SyntaxEngine, uri: &str, text: &str, lang: &str) -> Value {
        engine.extract(uri, text, lang, "w", 123).unwrap().unwrap()
    }
    fn named<'a>(value: &'a Value, name: &str) -> &'a Value {
        value["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["name"] == name)
            .unwrap()
    }
    #[test]
    fn syntax_ignores_comments_strings_and_extracts_static_imports() {
        let mut engine = SyntaxEngine::new();
        let value = extract(
            &mut engine,
            "file:///src/a.test.ts",
            r#"// class Ghost {}
const text = 'function Fake() {}';
export class Real { run() {} }
import './side-effect';
export {thing} from './other';
import type {Type} from '@/type';
import {readFile} from 'node:fs';
"#,
            "typescript",
        );
        assert!(!value["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["name"] == "Ghost" || n["name"] == "Fake"));
        assert_eq!(
            named(&value, "Real")["id"],
            "w::file:///src/a.test.ts::class::Real::3"
        );
        assert_eq!(named(&value, "Real")["exported"], true);
        assert_eq!(named(&value, "run")["kind"], "method");
        assert_eq!(named(&value, "Real")["evidence"]["provider"], "treeSitter");
        assert_eq!(
            value["edges"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|e| e["type"] == "IMPORTS")
                .count(),
            4
        );
        assert_eq!(
            value["edges"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|e| e["type"] == "TESTS")
                .count(),
            1
        );
    }
    #[test]
    fn incremental_unicode_edits_match_fresh_parse_and_utf16_ranges() {
        let mut engine = SyntaxEngine::new();
        let uri = "file:///unicode.tsx";
        let variants = [
            "/*😀*/ export const café = <div>é</div>;\nclass Ä {}",
            "/*😁*/ export const café = <div>😀x</div>;\nclass Å {}",
            "\n/*😁*/ export const cafe = <div/>;\nclass Å {}",
            "class End {}",
        ];
        for text in variants {
            let updated = extract(&mut engine, uri, text, "typescriptreact");
            assert_eq!(
                updated,
                extract(&mut SyntaxEngine::new(), uri, text, "typescriptreact")
            );
        }
        assert_eq!(engine.metrics()["incrementalParses"], 3);
        let value = extract(&mut engine, uri, variants[0], "typescriptreact");
        assert_eq!(named(&value, "café")["range"]["startColumn"], 7);
        assert_eq!(
            named(&value, "café")["range"]["endColumn"],
            variants[0].lines().next().unwrap().encode_utf16().count()
        );
        extract(&mut engine, uri, variants[0], "typescriptreact");
        assert_eq!(engine.metrics()["unchangedHits"], 1);
    }
    #[test]
    fn broken_code_recovers_and_language_changes_drop_old_tree() {
        let mut engine = SyntaxEngine::new();
        let uri = "file:///file.ts";
        let broken = extract(
            &mut engine,
            uri,
            "function intact() {}\nconst broken = ;",
            "typescript",
        );
        assert_eq!(named(&broken, "file.ts")["metadata"]["syntaxErrors"], true);
        assert_eq!(named(&broken, "intact")["kind"], "function");
        let fixed = extract(
            &mut engine,
            uri,
            "function intact() {}\nconst broken = 1;",
            "typescript",
        );
        assert_eq!(named(&fixed, "file.ts")["metadata"]["syntaxErrors"], false);
        assert!(engine
            .extract(uri, "class Python:", "python", "w", 123)
            .unwrap()
            .is_none());
        assert_eq!(engine.metrics()["cachedFiles"], 0);
        extract(&mut engine, uri, "const jsx = <div/>;", "javascriptreact");
        assert_eq!(engine.metrics()["fullParses"], 2);
    }
    #[test]
    fn cache_is_bounded_and_explicit_disposal_releases_state() {
        let mut engine = SyntaxEngine::new();
        for i in 0..MAX_CACHE_FILES + 5 {
            extract(
                &mut engine,
                &format!("file:///{i}.js"),
                "const value = 1;",
                "javascript",
            );
        }
        assert_eq!(engine.cache.len(), MAX_CACHE_FILES);
        assert_eq!(engine.metrics()["evictions"], 5);
        assert!(!engine.cache.contains_key("file:///0.js"));
        engine.remove("file:///36.js");
        assert_eq!(engine.cache.len(), MAX_CACHE_FILES - 1);
        engine.clear();
        assert!(engine.cache.is_empty());
        assert!(engine.runtimes.is_empty());
        assert_eq!(engine.bytes, 0);
        assert_eq!(engine.nodes, 0);
    }
    #[test]
    fn cache_eviction_caps_retained_source_and_syntax_nodes() {
        let mut engine = SyntaxEngine::new();
        let comment = format!("/*{}*/\nconst value = 1;", "x".repeat(1_300_000));
        for i in 0..8 {
            extract(
                &mut engine,
                &format!("file:///comment{i}.js"),
                &comment,
                "javascript",
            );
            assert!(engine.bytes <= MAX_CACHE_BYTES);
        }
        assert!(engine.cache.len() < 8);
        engine.clear();
        let code = (0..12_000)
            .map(|i| format!("const value{i} = {i};\n"))
            .collect::<String>();
        for i in 0..6 {
            extract(
                &mut engine,
                &format!("file:///symbols{i}.js"),
                &code,
                "javascript",
            );
            assert!(engine.nodes <= MAX_CACHE_NODES);
        }
        assert!(engine.cache.len() < 6);
        assert!(engine
            .extract(
                "file:///symbols5.js",
                &" ".repeat(MAX_FILE_BYTES + 1),
                "javascript",
                "w",
                123
            )
            .is_err());
        assert!(!engine.cache.contains_key("file:///symbols5.js"));
    }
    #[test]
    fn edits_are_valid_at_utf8_boundaries() {
        for (old, new) in [
            ("é", "ê"),
            ("😀a", "😁a"),
            ("a😀", "a"),
            ("", "é"),
            ("a\r\nb", "a\r\n😀b"),
            ("same", "same"),
        ] {
            let e = edit_between(old, new);
            assert!(old.is_char_boundary(e.start_byte));
            assert!(new.is_char_boundary(e.start_byte));
            assert!(old.is_char_boundary(e.old_end_byte));
            assert!(new.is_char_boundary(e.new_end_byte));
            assert_eq!(
                format!(
                    "{}{}{}",
                    &old[..e.start_byte],
                    &new[e.start_byte..e.new_end_byte],
                    &old[e.old_end_byte..]
                ),
                new
            );
        }
    }
}
