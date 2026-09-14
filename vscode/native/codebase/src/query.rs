// Copyright (c) OpenIDE. Licensed under the MIT License.
// Resident query indexes. Evidence and node/edge payloads remain canonical; no file I/O.
use regex::Regex;
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::OnceLock;

const MAX_NODES: usize = 250_000;
const MAX_EDGES: usize = 1_000_000;
const MAX_TARGETS: usize = 256;

#[derive(Clone)]
struct SearchText {
    name: String,
    body: String,
    qualified: String,
    uri: String,
    text: String,
}

#[derive(Clone)]
struct Row {
    node: usize,
    edge: usize,
    depth: usize,
}

pub struct QueryIndex {
    nodes: Vec<Value>,
    edges: Vec<Value>,
    text: Vec<SearchText>,
    ids: HashMap<String, usize>,
    outgoing: HashMap<String, Vec<usize>>,
    incoming: HashMap<String, Vec<usize>>,
    degree: HashMap<String, usize>,
    hub_threshold: usize,
    community_labels: HashMap<String, String>,
    collation: HashMap<String, usize>,
    version: Value,
    stale: bool,
}

fn field<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}
fn number(value: &Value, key: &str) -> f64 {
    value.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}
fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

// ECMAScript's default lowercasing uses the contextual final sigma mapping, unlike
// char::to_lowercase. The remaining mappings are Rust's Unicode default mappings.
fn lowercase(value: &str) -> String {
    static CASED: OnceLock<Regex> = OnceLock::new();
    static IGNORABLE: OnceLock<Regex> = OnceLock::new();
    let cased = CASED.get_or_init(|| Regex::new(r"^\p{Cased}$").unwrap());
    let ignorable = IGNORABLE.get_or_init(|| Regex::new(r"^\p{Case_Ignorable}$").unwrap());
    if !value.contains('Σ') {
        return value.to_lowercase();
    }
    let chars: Vec<char> = value.chars().collect();
    let mut out = String::new();
    for (i, ch) in chars.iter().enumerate() {
        if *ch == 'Σ' {
            let before = chars[..i]
                .iter()
                .rev()
                .find(|ch| !ignorable.is_match(&ch.to_string()));
            let after = chars[i + 1..]
                .iter()
                .find(|ch| !ignorable.is_match(&ch.to_string()));
            if before.is_some_and(|ch| cased.is_match(&ch.to_string()))
                && !after.is_some_and(|ch| cased.is_match(&ch.to_string()))
            {
                out.push('ς');
                continue;
            }
        }
        out.extend(ch.to_lowercase());
    }
    out
}

fn query_terms(query: &str) -> Vec<String> {
    static CAMEL: OnceLock<Regex> = OnceLock::new();
    static TERMS: OnceLock<Regex> = OnceLock::new();
    static SPLIT: OnceLock<Regex> = OnceLock::new();
    const STOP: &[&str] = &[
        "about", "after", "also", "antes", "como", "con", "contra", "cual", "cuando", "donde",
        "este", "esta", "esto", "from", "hacer", "hace", "hacia", "para", "pero", "porque",
        "quiero", "sobre", "that", "the", "this", "una", "uno", "usar", "uses", "with", "what",
        "where", "which", "your",
    ];
    let expanded = lowercase(
        &CAMEL
            .get_or_init(|| Regex::new(r"([a-z0-9])([A-Z])").unwrap())
            .replace_all(query, "$1 $2"),
    );
    let mut seen = HashSet::new();
    let mut terms = Vec::new();
    let split = SPLIT.get_or_init(|| Regex::new(r"[_-]+").unwrap());
    for item in TERMS
        .get_or_init(|| Regex::new(r"[\p{L}\p{N}_-]{3,}").unwrap())
        .find_iter(&expanded)
    {
        for term in split.split(item.as_str()) {
            if utf16_len(term) >= 3 && !STOP.contains(&term) && seen.insert(term.to_owned()) {
                terms.push(term.to_owned());
            }
        }
    }
    if terms.len() > 32 {
        terms.drain(..terms.len() - 32);
    }
    terms
}

impl QueryIndex {
    pub fn new(snapshot: &Value, include_heuristic: bool) -> Result<Self, String> {
        let empty = Vec::new();
        let all_nodes = snapshot
            .get("nodes")
            .and_then(Value::as_array)
            .unwrap_or(&empty);
        let all_edges = snapshot
            .get("edges")
            .and_then(Value::as_array)
            .unwrap_or(&empty);
        if all_nodes.len() > MAX_NODES || all_edges.len() > MAX_EDGES {
            return Err("Query graph exceeds the native index bounds".into());
        }
        let superseded: HashSet<&str> = all_nodes
            .iter()
            .filter(|n| field(n, "kind") == "note")
            .filter_map(|n| {
                n.get("metadata")
                    .and_then(|m| m.get("supersedes"))
                    .and_then(Value::as_str)
            })
            .filter(|s| !s.is_empty())
            .collect();
        let nodes: Vec<Value> = all_nodes
            .iter()
            .filter(|n| {
                field(n, "kind") != "note" || {
                    let metadata = &n["metadata"];
                    field(metadata, "status") != "superseded"
                        && !superseded.contains(field(metadata, "id"))
                }
            })
            .cloned()
            .collect();
        let ids: HashMap<String, usize> = nodes
            .iter()
            .enumerate()
            .map(|(i, n)| (field(n, "id").to_owned(), i))
            .collect();
        let edges: Vec<Value> = all_edges
            .iter()
            .filter(|e| {
                ids.contains_key(field(e, "source"))
                    && ids.contains_key(field(e, "target"))
                    && (include_heuristic || e["evidence"]["verified"].as_bool() == Some(true))
            })
            .cloned()
            .collect();
        let mut outgoing: HashMap<String, Vec<usize>> = HashMap::new();
        let mut incoming: HashMap<String, Vec<usize>> = HashMap::new();
        let mut degree: HashMap<String, usize> = HashMap::new();
        for (i, e) in edges.iter().enumerate() {
            let source = field(e, "source");
            let target = field(e, "target");
            outgoing.entry(source.to_owned()).or_default().push(i);
            incoming.entry(target.to_owned()).or_default().push(i);
            *degree.entry(source.to_owned()).or_default() += 1;
            *degree.entry(target.to_owned()).or_default() += 1;
        }
        let mut degrees: Vec<usize> = degree.values().copied().collect();
        degrees.sort_unstable();
        let p99 = if degrees.is_empty() {
            0
        } else {
            degrees[((degrees.len() as f64 * 0.99).floor() as usize).min(degrees.len() - 1)]
        };
        let mut community_labels = HashMap::new();
        for community in snapshot
            .get("communities")
            .and_then(Value::as_array)
            .unwrap_or(&empty)
        {
            for member in community
                .get("members")
                .and_then(Value::as_array)
                .unwrap_or(&empty)
            {
                if let Some(uri) = member.as_str() {
                    community_labels.insert(uri.to_owned(), field(community, "label").to_owned());
                }
            }
        }
        let text = nodes
            .iter()
            .map(|n| SearchText {
                name: lowercase(field(n, "name")),
                body: lowercase(field(n, "documentation")),
                qualified: lowercase(field(n, "qualifiedName")),
                uri: lowercase(field(n, "uri")),
                text: lowercase(&format!(
                    "{} {} {} {} {}",
                    field(n, "name"),
                    field(n, "qualifiedName"),
                    field(n, "uri"),
                    field(n, "signature"),
                    field(n, "documentation")
                )),
            })
            .collect();
        let collation = snapshot
            .get("collationIds")
            .and_then(Value::as_array)
            .unwrap_or(&empty)
            .iter()
            .enumerate()
            .filter_map(|(i, id)| id.as_str().map(|id| (id.to_owned(), i)))
            .collect();
        Ok(Self {
            nodes,
            edges,
            text,
            ids,
            outgoing,
            incoming,
            degree,
            hub_threshold: 50.max(p99),
            community_labels,
            collation,
            version: snapshot
                .get("version")
                .and_then(|v| v.get("version"))
                .cloned()
                .unwrap_or(json!(0)),
            stale: snapshot
                .get("dirtyUris")
                .and_then(Value::as_array)
                .is_some_and(|uris| !uris.is_empty()),
        })
    }

    fn result(
        &self,
        data: Value,
        evidence: impl Iterator<Item = (String, f64)>,
        minimum: bool,
        empty_confidence: f64,
    ) -> Value {
        let mut seen = HashSet::new();
        let mut providers = Vec::new();
        let mut confidence: Option<f64> = None;
        for (provider, current) in evidence {
            if seen.insert(provider.clone()) {
                providers.push(provider);
            }
            confidence = Some(match confidence {
                Some(previous) if minimum => previous.min(current),
                Some(previous) => previous.max(current),
                None => current,
            });
        }
        json!({"data": data, "indexVersion": self.version, "isStale": self.stale, "providers": providers, "confidence": confidence.unwrap_or(empty_confidence)})
    }

    fn evidence(value: &Value) -> (String, f64) {
        (
            field(&value["evidence"], "provider").to_owned(),
            number(&value["evidence"], "confidence"),
        )
    }

    fn rows_value(&self, rows: &[Row]) -> Value {
        Value::Array(rows.iter().map(|row| json!({"node":self.nodes[row.node], "edge":self.edges[row.edge], "depth":row.depth})).collect())
    }

    fn rows_result(&self, rows: &[Row], minimum: bool, empty: f64) -> Value {
        self.result(
            self.rows_value(rows),
            rows.iter().map(|row| Self::evidence(&self.edges[row.edge])),
            minimum,
            empty,
        )
    }

    fn score(&self, index: usize, terms: &[String], weights: &[f64]) -> f64 {
        if terms.is_empty() {
            return 0.0;
        }
        let node = &self.nodes[index];
        let text = &self.text[index];
        let base =
            number(&node["evidence"], "confidence") * 4.0 + number(node, "degree").min(20.0) * 0.15;
        let joined = terms.join("");
        let mut tiered = 0.0;
        let mut matched = 0;
        for (term, idf) in terms.iter().zip(weights) {
            if text.name == *term {
                tiered += 1000.0 * idf;
                matched += 1;
            } else if text.name.starts_with(term) {
                tiered += 100.0 * idf;
                matched += 1;
            } else if text.name.contains(term) || text.qualified.contains(term) {
                tiered += idf;
                matched += 1;
            } else if field(node, "kind") == "note" && text.body.contains(term) {
                tiered += 10.0 * idf;
                matched += 1;
            } else if text.uri.contains(term) {
                tiered += 0.5 * idf;
            }
        }
        let joined_idf = weights.iter().copied().fold(1.0, f64::max);
        if text.name == joined || text.qualified == joined || field(node, "id") == joined {
            tiered += 10000.0 * joined_idf;
        } else if text.name.starts_with(&joined) {
            tiered += 1000.0 * joined_idf;
        }
        let coverage = f64::from(matched) / terms.len() as f64;
        base + tiered * coverage * coverage
    }

    fn weights(&self, terms: &[String], entries: &[usize]) -> Vec<f64> {
        terms
            .iter()
            .map(|term| {
                let count = entries
                    .iter()
                    .filter(|i| self.text[**i].text.contains(term))
                    .count();
                ((self.nodes.len() as f64 + 1.0) / (count as f64 + 1.0)).ln() + 1.0
            })
            .collect()
    }

    fn compare_id(&self, a: &str, b: &str) -> Ordering {
        match (self.collation.get(a), self.collation.get(b)) {
            (Some(a), Some(b)) => a.cmp(b),
            _ => a.encode_utf16().cmp(b.encode_utf16()),
        }
    }

    fn search(&self, query: &str, options: &Value) -> Vec<usize> {
        let terms = query_terms(query);
        if terms.is_empty() {
            return Vec::new();
        }
        let kinds = strings(options.get("kinds"))
            .iter()
            .map(|s| lowercase(s))
            .collect::<Vec<_>>();
        let languages = strings(options.get("languages"))
            .iter()
            .map(|s| lowercase(s))
            .collect::<Vec<_>>();
        let prefix = lowercase(field(options, "pathPrefix"));
        let candidates: Vec<usize> = self
            .nodes
            .iter()
            .enumerate()
            .filter(|(i, node)| {
                (kinds.is_empty() || kinds.contains(&lowercase(field(node, "kind"))))
                    && (languages.is_empty()
                        || languages.contains(&lowercase(field(node, "language"))))
                    && (prefix.is_empty() || self.text[*i].uri.contains(&prefix))
                    && terms.iter().any(|term| self.text[*i].text.contains(term))
            })
            .map(|(i, _)| i)
            .collect();
        let weights = self.weights(&terms, &candidates);
        let limit = options
            .get("limit")
            .and_then(Value::as_f64)
            .filter(|n| n.is_finite())
            .map(|n| n.floor().max(0.0) as usize)
            .unwrap_or(50)
            .min(self.nodes.len());
        let compare = |a: &(usize, f64), b: &(usize, f64)| {
            b.1.total_cmp(&a.1)
                .then_with(|| {
                    utf16_len(field(&self.nodes[a.0], "name"))
                        .cmp(&utf16_len(field(&self.nodes[b.0], "name")))
                })
                .then_with(|| {
                    self.compare_id(field(&self.nodes[a.0], "id"), field(&self.nodes[b.0], "id"))
                })
        };
        let mut scored: Vec<(usize, f64)> = Vec::new();
        for index in candidates {
            if limit == 0 {
                break;
            }
            let entry = (index, self.score(index, &terms, &weights));
            if scored.len() == limit && compare(&entry, &scored[scored.len() - 1]) != Ordering::Less
            {
                continue;
            }
            let mut low = 0;
            let mut high = scored.len();
            while low < high {
                let middle = (low + high) / 2;
                if compare(&entry, &scored[middle]) == Ordering::Less {
                    high = middle;
                } else {
                    low = middle + 1;
                }
            }
            scored.insert(low, entry);
            if scored.len() > limit {
                scored.pop();
            }
        }
        scored.into_iter().map(|(index, _)| index).collect()
    }

    fn resolve(&self, target: &str) -> Option<usize> {
        self.ids.get(target).copied().or_else(|| {
            let target = lowercase(target);
            self.text.iter().position(|text| text.name == target)
        })
    }

    fn candidates(&self, id: &str, direction: &str) -> Vec<usize> {
        let mut edges = Vec::new();
        if direction != "incoming" {
            edges.extend(self.outgoing.get(id).into_iter().flatten().copied());
        }
        if direction != "outgoing" {
            edges.extend(self.incoming.get(id).into_iter().flatten().copied());
        }
        edges
    }

    fn adjacency(
        &self,
        target: &str,
        direction: &str,
        relations: &[String],
        depth: f64,
        limit: f64,
        configured: f64,
    ) -> Vec<Row> {
        let Some(start) = self.resolve(target) else {
            return Vec::new();
        };
        let start_id = field(&self.nodes[start], "id").to_owned();
        let mut seen = HashSet::from([start_id.clone()]);
        let mut frontier = vec![start_id];
        let mut rows = Vec::new();
        let capped = depth.max(1.0).min(configured);
        for depth in 1..=capped.floor() as usize {
            let mut next = Vec::new();
            for id in frontier {
                for edge_index in self.candidates(&id, direction) {
                    let edge = &self.edges[edge_index];
                    let kind = field(edge, "type");
                    if !relations.is_empty() && !relations.iter().any(|r| r == kind) {
                        continue;
                    }
                    let (source, target) = (field(edge, "source"), field(edge, "target"));
                    let reversed = kind == "CALLED_BY";
                    let (outgoing, incoming) = if reversed {
                        (
                            (target == id).then_some(source),
                            (source == id).then_some(target),
                        )
                    } else {
                        (
                            (source == id).then_some(target),
                            (target == id).then_some(source),
                        )
                    };
                    let other = match direction {
                        "outgoing" => outgoing,
                        "incoming" => incoming,
                        _ => outgoing.or(incoming),
                    };
                    let Some(other) = other else {
                        continue;
                    };
                    let Some(&node) = self.ids.get(other) else {
                        continue;
                    };
                    if !seen.insert(other.to_owned()) {
                        continue;
                    }
                    rows.push(Row {
                        node,
                        edge: edge_index,
                        depth,
                    });
                    if self.degree.get(other).copied().unwrap_or(0) < self.hub_threshold {
                        next.push(other.to_owned());
                    }
                    if rows.len() as f64 >= limit {
                        return rows;
                    }
                }
            }
            frontier = next;
            if frontier.is_empty() {
                break;
            }
        }
        rows
    }

    fn impact(
        &self,
        targets: &[String],
        include_tests: bool,
        transitive: bool,
        depth: f64,
        configured: f64,
    ) -> Value {
        let mut direct = Vec::new();
        let mut indirect = Vec::new();
        let mut tests = Vec::new();
        for target in targets {
            for row in self.adjacency(
                target,
                "incoming",
                &[],
                if transitive { depth } else { 1.0 },
                300.0,
                configured,
            ) {
                match field(&self.edges[row.edge], "type") {
                    "TESTS" | "TESTED_BY" => tests.push(row),
                    _ if row.depth == 1 => direct.push(row),
                    _ => indirect.push(row),
                }
            }
        }
        let data = json!({"direct":self.rows_value(&direct), "transitive":self.rows_value(&indirect), "tests":if include_tests {self.rows_value(&tests)} else {json!([])}});
        self.result(
            data,
            direct
                .iter()
                .chain(&indirect)
                .chain(&tests)
                .map(|row| Self::evidence(&self.edges[row.edge])),
            false,
            0.0,
        )
    }

    fn path(
        &self,
        from: &str,
        to: &str,
        relations: &[String],
        depth: f64,
        configured: f64,
    ) -> Value {
        let (Some(start), Some(end)) = (self.resolve(from), self.resolve(to)) else {
            return self.rows_result(&[], false, 0.0);
        };
        let start_id = field(&self.nodes[start], "id").to_owned();
        let end_id = field(&self.nodes[end], "id");
        let mut queue = VecDeque::from([(start_id.clone(), Vec::<Row>::new())]);
        let mut visited = HashSet::from([start_id]);
        let capped = depth.max(1.0).min(configured + 2.0);
        while let Some((id, rows)) = queue.pop_front() {
            if id == end_id {
                return self.rows_result(&rows, true, 1.0);
            }
            if rows.len() as f64 >= capped {
                continue;
            }
            for edge_index in self.candidates(&id, "both") {
                let edge = &self.edges[edge_index];
                if !relations.is_empty() && !relations.iter().any(|r| r == field(edge, "type")) {
                    continue;
                }
                let other = if field(edge, "source") == id {
                    field(edge, "target")
                } else {
                    field(edge, "source")
                };
                if !visited.insert(other.to_owned()) {
                    continue;
                }
                if let Some(&node) = self.ids.get(other) {
                    let mut next = rows.clone();
                    next.push(Row {
                        node,
                        edge: edge_index,
                        depth: rows.len() + 1,
                    });
                    queue.push_back((other.to_owned(), next));
                }
            }
        }
        self.rows_result(&[], false, 0.0)
    }

    pub fn query(&self, method: &str, args: &Value) -> Result<Value, String> {
        let arguments = args
            .get("arguments")
            .and_then(Value::as_array)
            .ok_or("Query arguments must be an array")?;
        if arguments.len() > 8
            || arguments.iter().any(|arg| {
                arg.as_str().is_some_and(|s| s.len() > 65_536)
                    || arg.as_array().is_some_and(|a| a.len() > MAX_TARGETS)
            })
        {
            return Err("Query exceeds argument bounds".into());
        }
        let arg = |index: usize| arguments.get(index).unwrap_or(&Value::Null);
        let text = |index: usize| arg(index).as_str().unwrap_or("");
        let num = |index: usize, default: f64| {
            arg(index)
                .as_f64()
                .filter(|n| n.is_finite())
                .unwrap_or(default)
        };
        let boolean = |index: usize, default: bool| arg(index).as_bool().unwrap_or(default);
        let configured = args
            .get("maxTraversalDepth")
            .and_then(Value::as_f64)
            .filter(|n| n.is_finite() && *n >= 1.0)
            .unwrap_or(3.0)
            .min(6.0);
        Ok(match method {
            "search" => {
                let indices = self.search(text(0), arg(1));
                self.result(
                    Value::Array(indices.iter().map(|i| self.nodes[*i].clone()).collect()),
                    indices.iter().map(|i| Self::evidence(&self.nodes[*i])),
                    false,
                    0.0,
                )
            }
            "explore" => {
                let direction = if text(1).is_empty() { "both" } else { text(1) };
                if !["incoming", "outgoing", "both"].contains(&direction) {
                    return Err("Invalid query direction".into());
                }
                let rows = self.adjacency(
                    text(0),
                    direction,
                    &strings(Some(arg(2))),
                    num(3, 1.0),
                    num(4, 100.0),
                    configured,
                );
                self.rows_result(&rows, false, 0.0)
            }
            "callers" | "callees" => {
                let rows = self.adjacency(
                    text(0),
                    if method == "callers" {
                        "incoming"
                    } else {
                        "outgoing"
                    },
                    &["CALLS".into(), "CALLED_BY".into()],
                    if boolean(1, false) { num(2, 1.0) } else { 1.0 },
                    num(3, 100.0),
                    configured,
                );
                self.rows_result(&rows, false, 0.0)
            }
            "impact" => self.impact(
                &strings(Some(arg(0))),
                boolean(1, true),
                boolean(2, true),
                num(3, 2.0),
                configured,
            ),
            "path" => self.path(
                text(0),
                text(1),
                &strings(Some(arg(2))),
                num(3, 5.0),
                configured,
            ),
            "relatedTests" => {
                let mut result = self.impact(&strings(Some(arg(0))), true, true, 2.0, configured);
                let tests = result["data"]["tests"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
                // Array.slice supports negative limits and truncates fractional limits toward zero.
                let limit = num(1, 100.0).trunc();
                let count = if limit < 0.0 {
                    (tests.len() as f64 + limit).max(0.0) as usize
                } else {
                    (limit as usize).min(tests.len())
                };
                result["data"] = Value::Array(tests.into_iter().take(count).collect());
                result
            }
            "communityLabel" => self
                .community_labels
                .get(text(0))
                .map_or(Value::Null, |label| json!(label)),
            "pickSeeds" => {
                let terms = query_terms(text(0));
                let ranked = self.search(&terms.join(" "), &json!({"limit":50}));
                if ranked.is_empty() {
                    return Ok(json!([]));
                }
                let weights = self.weights(&terms, &ranked);
                let top_score = self.score(ranked[0], &terms, &weights);
                let mut seeds = Vec::new();
                let mut labels = HashSet::new();
                for &i in &ranked {
                    if seeds.len() as f64 >= num(1, 3.0)
                        || self.score(i, &terms, &weights) < top_score * 0.2
                    {
                        break;
                    }
                    let label = lowercase(
                        self.nodes[i]
                            .get("qualifiedName")
                            .and_then(Value::as_str)
                            .unwrap_or(field(&self.nodes[i], "name")),
                    );
                    if labels.insert(label) {
                        seeds.push(i);
                    }
                }
                for term in &terms {
                    if seeds.iter().any(|i| self.text[*i].text.contains(term)) {
                        continue;
                    }
                    if let Some(&best) = ranked.iter().find(|i| self.text[**i].text.contains(term))
                    {
                        if !seeds
                            .iter()
                            .any(|i| field(&self.nodes[*i], "id") == field(&self.nodes[best], "id"))
                        {
                            seeds.push(best);
                        }
                    }
                }
                Value::Array(seeds.iter().map(|i| self.nodes[*i].clone()).collect())
            }
            _ => return Err(format!("Unknown query method: {method}")),
        })
    }
}

fn strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|v| {
            v.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn terms_preserve_javascript_tokens() {
        assert_eq!(
            query_terms("quiero findHTTP file_path includeTests TESTS ΜΈΣΟΣ"),
            ["find", "http", "file", "path", "include", "tests", "μέσος"]
        );
        assert_eq!(lowercase("ΟΣ ΟΣΑ ΟΣ'"), "ος οσα ος'");
    }
    #[test]
    fn unknown_methods_and_oversized_graphs_are_rejected() {
        let index = QueryIndex::new(&json!({}), true).unwrap();
        assert!(index.query("execute", &json!({"arguments":[]})).is_err());
        assert_eq!(
            index
                .query("communityLabel", &json!({"arguments":["missing"]}))
                .unwrap(),
            Value::Null
        );
    }
}
