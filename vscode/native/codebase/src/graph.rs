// Copyright (c) OpenIDE. Licensed under the MIT License.
//! Native import resolution and deterministic graph partitioning.
//!
//! The host retains locale-sensitive presentation: partition order, labels and previous-ID
//! remapping. JavaScript `.sort()` comparisons here use UTF-16 code units, not Rust's UTF-8
//! lexical order. The legacy edge locale sort only affects the insertion order of integer
//! weights; sums remain exact, and candidate communities are explicitly sorted by UTF-16 rank.
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

const EXTENSIONS: [&str; 7] = [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs"];
const IMPROVEMENT_THRESHOLD: f64 = 1e-4;
const MAX_PASSES: usize = 10;

type Edge = (usize, usize);

fn utf16_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

fn relative(specifier: &str) -> bool {
    specifier.starts_with("./") || specifier.starts_with("../") || specifier.starts_with('/')
}

fn aliased(specifier: &str) -> bool {
    ["@/", "~/", "#/"]
        .iter()
        .any(|prefix| specifier.starts_with(prefix))
}

fn normalize_uri(uri: &str) -> String {
    let (prefix, rest) = uri
        .find("://")
        .map_or(("", uri), |index| uri.split_at(index + 3));
    let mut out = Vec::new();
    for segment in rest.split('/') {
        if segment == "." || segment.is_empty() {
            if out.is_empty() && segment.is_empty() {
                out.push("");
            }
        } else if segment == ".." {
            if out.len() > 1 {
                out.pop();
            }
        } else {
            out.push(segment);
        }
    }
    format!("{prefix}{}", out.join("/"))
}

struct Imports<'a> {
    known: HashSet<&'a str>,
    // Suffix resolution is a prefix lookup on reversed URIs. At most two matches are read:
    // ambiguity at the first matching candidate must stop resolution, exactly as in TS.
    reversed: BTreeMap<String, &'a str>,
}

impl<'a> Imports<'a> {
    fn new(uris: &'a [String]) -> Self {
        Self {
            known: uris.iter().map(String::as_str).collect(),
            reversed: uris
                .iter()
                .map(|uri| (uri.chars().rev().collect(), uri.as_str()))
                .collect(),
        }
    }

    fn resolve(&self, importer: &str, specifier: &str) -> Option<&'a str> {
        if relative(specifier) {
            let dirname = importer.rsplit_once('/').map_or(importer, |(head, _)| head);
            let base = normalize_uri(&format!("{dirname}/{specifier}"));
            if let Some(uri) = self.known.get(base.as_str()) {
                return Some(*uri);
            }
            for extension in EXTENSIONS {
                if let Some(uri) = self.known.get(format!("{base}{extension}").as_str()) {
                    return Some(*uri);
                }
            }
            for extension in EXTENSIONS {
                if let Some(uri) = self.known.get(format!("{base}/index{extension}").as_str()) {
                    return Some(*uri);
                }
            }
            if let Some(base) = [".js", ".jsx", ".mjs", ".cjs"]
                .iter()
                .find_map(|ext| base.strip_suffix(ext))
            {
                for extension in EXTENSIONS {
                    if let Some(uri) = self.known.get(format!("{base}{extension}").as_str()) {
                        return Some(*uri);
                    }
                }
            }
        } else if aliased(specifier) {
            let tail = specifier[2..].trim_start_matches('/');
            if tail.is_empty() {
                return None;
            }
            let candidates = std::iter::once(format!("/{tail}"))
                .chain(EXTENSIONS.iter().map(|ext| format!("/{tail}{ext}")))
                .chain(EXTENSIONS.iter().map(|ext| format!("/{tail}/index{ext}")));
            for candidate in candidates {
                let prefix: String = candidate.chars().rev().collect();
                let mut matches = self
                    .reversed
                    .range(prefix.clone()..)
                    .take_while(|(key, _)| key.starts_with(&prefix));
                if let Some((_, uri)) = matches.next() {
                    return if matches.next().is_none() {
                        Some(*uri)
                    } else {
                        None
                    };
                }
            }
        }
        None
    }
}

struct WorkGraph {
    // IDs are ranks in the globally UTF-16-sorted URI array; all levels preserve this order.
    nodes: Vec<usize>,
    neighbors: Vec<BTreeMap<usize, f64>>,
    degree: Vec<f64>,
    total_weight: f64,
}

fn build_graph(nodes: &[usize], edges: &[Edge]) -> WorkGraph {
    let mut nodes = nodes.to_vec();
    nodes.sort_unstable();
    nodes.dedup();
    let index: HashMap<usize, usize> = nodes.iter().enumerate().map(|(i, id)| (*id, i)).collect();
    let mut neighbors = vec![BTreeMap::new(); nodes.len()];
    let mut total_weight = 0.0;
    for (source, target) in edges {
        if source == target {
            continue;
        }
        if let (Some(&source), Some(&target)) = (index.get(source), index.get(target)) {
            *neighbors[source].entry(target).or_insert(0.0) += 1.0;
            *neighbors[target].entry(source).or_insert(0.0) += 1.0;
            total_weight += 1.0;
        }
    }
    let degree = neighbors
        .iter()
        .map(|neighbors| neighbors.values().sum())
        .collect();
    WorkGraph {
        nodes,
        neighbors,
        degree,
        total_weight,
    }
}

fn louvain(graph: &WorkGraph) -> Vec<Vec<usize>> {
    if graph.total_weight == 0.0 {
        return graph.nodes.iter().map(|id| vec![*id]).collect();
    }
    let mut neighbors = graph.neighbors.clone();
    let mut degree = graph.degree.clone();
    let mut self_loops = vec![0.0; graph.nodes.len()];
    let mut members: Vec<Vec<usize>> = graph.nodes.iter().map(|id| vec![*id]).collect();
    let mut result = members.clone();
    let m2 = 2.0 * graph.total_weight;
    for _ in 0..MAX_PASSES {
        let count = neighbors.len();
        let mut community: Vec<usize> = (0..count).collect();
        let mut community_degree = degree.clone();
        let mut improved_total = false;
        loop {
            let mut improved = false;
            for node in 0..count {
                let node_degree = degree[node];
                let current = community[node];
                let mut weights = BTreeMap::new();
                for (&neighbor, &weight) in &neighbors[node] {
                    *weights.entry(community[neighbor]).or_insert(0.0) += weight;
                }
                community_degree[current] -= node_degree;
                let mut best = current;
                let mut best_gain = weights.get(&current).map_or(0.0, |weight| {
                    weight - community_degree[current] * node_degree / m2
                });
                for (&candidate, &weight) in &weights {
                    let gain = weight - community_degree[candidate] * node_degree / m2;
                    if gain > best_gain + IMPROVEMENT_THRESHOLD {
                        best_gain = gain;
                        best = candidate;
                    }
                }
                community_degree[best] += node_degree;
                if best != current {
                    community[node] = best;
                    improved = true;
                    improved_total = true;
                }
            }
            if !improved {
                break;
            }
        }
        if !improved_total {
            break;
        }
        let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for (node, &group) in community.iter().enumerate() {
            groups.entry(group).or_default().push(node);
        }
        let next_count = groups.len();
        let next_index: HashMap<usize, usize> = groups
            .keys()
            .enumerate()
            .map(|(index, &id)| (id, index))
            .collect();
        let mut next_neighbors = vec![BTreeMap::new(); next_count];
        let mut next_loops = vec![0.0; next_count];
        let mut next_members = vec![Vec::new(); next_count];
        for (&id, group) in &groups {
            let index = next_index[&id];
            for &node in group {
                next_members[index].extend_from_slice(&members[node]);
                next_loops[index] += self_loops[node];
            }
            next_members[index].sort_unstable();
        }
        for node in 0..count {
            let from = next_index[&community[node]];
            for (&neighbor, &weight) in &neighbors[node] {
                let to = next_index[&community[neighbor]];
                if from == to {
                    next_loops[from] += weight / 2.0;
                } else {
                    *next_neighbors[from].entry(to).or_insert(0.0) += weight;
                }
            }
        }
        result = next_members.clone();
        if next_count == count {
            break;
        }
        degree = next_neighbors
            .iter()
            .zip(&next_loops)
            .map(|(neighbors, loops)| neighbors.values().sum::<f64>() + loops * 2.0)
            .collect();
        members = next_members;
        self_loops = next_loops;
        neighbors = next_neighbors;
    }
    result
}

fn cohesion(members: &[usize], graph: &WorkGraph) -> f64 {
    if members.len() < 2 {
        return 1.0;
    }
    let member_set: HashSet<usize> = members.iter().copied().collect();
    let mut internal = 0;
    for &id in members {
        let Ok(index) = graph.nodes.binary_search(&id) else {
            continue;
        };
        for &neighbor_index in graph.neighbors[index].keys() {
            let neighbor = graph.nodes[neighbor_index];
            if id < neighbor && member_set.contains(&neighbor) {
                internal += 1;
            }
        }
    }
    internal as f64 / ((members.len() * (members.len() - 1)) as f64 / 2.0)
}

fn split_once(members: Vec<usize>, edges: &[Edge]) -> Vec<Vec<usize>> {
    let member_set: HashSet<usize> = members.iter().copied().collect();
    let sub_edges: Vec<Edge> = edges
        .iter()
        .filter(|(source, target)| member_set.contains(source) && member_set.contains(target))
        .copied()
        .collect();
    if sub_edges.is_empty() {
        return members.into_iter().map(|id| vec![id]).collect();
    }
    let parts = louvain(&build_graph(&members, &sub_edges));
    if parts.len() > 1 {
        parts
    } else {
        vec![members]
    }
}

fn partition(count: usize, edges: &[Edge], degrees: &[usize]) -> Vec<Vec<usize>> {
    if count == 0 {
        return Vec::new();
    }
    let mut sorted_degrees = degrees.to_vec();
    sorted_degrees.sort_unstable();
    let threshold = 50.max(sorted_degrees[((count as f64 * 0.99).floor() as usize).min(count - 1)]);
    let hubs: BTreeSet<usize> = (0..count).filter(|&id| degrees[id] >= threshold).collect();
    let core: Vec<usize> = (0..count).filter(|id| !hubs.contains(id)).collect();
    let core_edges: Vec<Edge> = edges
        .iter()
        .filter(|(source, target)| !hubs.contains(source) && !hubs.contains(target))
        .copied()
        .collect();
    let graph = build_graph(&core, &core_edges);
    let mut groups = louvain(&graph);
    let max_size = 10.max(core.len() / 4);
    groups = groups
        .into_iter()
        .flat_map(|group| {
            if group.len() > max_size {
                split_once(group, &core_edges)
            } else {
                vec![group]
            }
        })
        .collect();
    groups = groups
        .into_iter()
        .flat_map(|group| {
            if group.len() >= 50 && cohesion(&group, &graph) < 0.05 {
                split_once(group, &core_edges)
            } else {
                vec![group]
            }
        })
        .collect();
    let mut community_of = vec![None; count];
    for (index, group) in groups.iter().enumerate() {
        for &id in group {
            community_of[id] = Some(index);
        }
    }
    let mut neighbors_all = vec![Vec::new(); count];
    for &(source, target) in edges {
        neighbors_all[source].push(target);
        neighbors_all[target].push(source);
    }
    for hub in hubs {
        let mut votes = BTreeMap::new();
        for &neighbor in &neighbors_all[hub] {
            if let Some(community) = community_of[neighbor] {
                *votes.entry(community).or_insert(0usize) += 1;
            }
        }
        // BTree order + strictly greater replacement gives the smaller community on a tie.
        let mut winner = None;
        let mut most_votes = 0;
        for (community, votes) in votes {
            if votes > most_votes {
                most_votes = votes;
                winner = Some(community);
            }
        }
        if let Some(winner) = winner {
            groups[winner].push(hub);
            groups[winner].sort_unstable();
            community_of[hub] = Some(winner);
        } else {
            community_of[hub] = Some(groups.len());
            groups.push(vec![hub]);
        }
    }
    groups
}

fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Invalid graph {key}"))
}

/// Pure graph finalization over one host-controlled index generation. Payload traversal follows
/// `file_uris`, not BTreeMap ordering: duplicate synthetic IDs retain the last importer's meaning.
/// Locale-dependent ordering/labels and stable community IDs remain a small host metadata pass.
pub fn finalize(file_uris: &[String], payloads: &BTreeMap<String, Value>) -> Result<Value, String> {
    let imports = Imports::new(file_uris);
    let mut uris = file_uris.to_vec();
    uris.sort_by(|a, b| utf16_cmp(a, b));
    uris.dedup();
    let index: HashMap<&str, usize> = uris
        .iter()
        .enumerate()
        .map(|(index, uri)| (uri.as_str(), index))
        .collect();
    let mut uri_by_node: HashMap<&str, &str> = HashMap::new();
    let mut file_by_uri = HashMap::new();
    let mut pending = HashMap::new();
    for uri in file_uris {
        let Some(payload) = payloads.get(uri) else {
            continue;
        };
        let nodes = payload
            .get("nodes")
            .and_then(Value::as_array)
            .ok_or("Invalid graph nodes")?;
        for node in nodes {
            let id = string(node, "id")?;
            let node_uri = string(node, "uri")?;
            let kind = string(node, "kind")?;
            uri_by_node.insert(
                id,
                if node_uri.starts_with("openide-alias:")
                    || node_uri.starts_with("openide-package:")
                {
                    node_uri
                } else {
                    uri.as_str()
                },
            );
            if kind == "file" && node_uri == uri {
                file_by_uri.insert(uri.as_str(), id);
            }
            if kind == "module" {
                if let Some(specifier) = node.get("qualifiedName").and_then(Value::as_str) {
                    if relative(specifier) || aliased(specifier) {
                        pending.insert(id, (uri.as_str(), specifier));
                    }
                }
            }
        }
    }
    let mut aliases = BTreeMap::new();
    for (id, (importer, specifier)) in pending {
        if let Some(file_id) = imports
            .resolve(importer, specifier)
            .and_then(|uri| file_by_uri.get(uri))
        {
            if *file_id != id {
                aliases.insert(id, *file_id);
            }
        }
    }
    let mut edges = Vec::new();
    let mut degrees = vec![0usize; uris.len()];
    for uri in file_uris {
        let Some(payload) = payloads.get(uri) else {
            continue;
        };
        let payload_edges = payload
            .get("edges")
            .and_then(Value::as_array)
            .ok_or("Invalid graph edges")?;
        for edge in payload_edges {
            let source = string(edge, "source")?;
            let target = string(edge, "target")?;
            let source = aliases.get(source).copied().unwrap_or(source);
            let target = aliases.get(target).copied().unwrap_or(target);
            let source = uri_by_node.get(source).and_then(|uri| index.get(uri));
            let target = uri_by_node.get(target).and_then(|uri| index.get(uri));
            if let (Some(&source), Some(&target)) = (source, target) {
                if source != target {
                    edges.push((source, target));
                    degrees[source] += 1;
                    degrees[target] += 1;
                }
            }
        }
    }
    let groups: Vec<Vec<&str>> = partition(uris.len(), &edges, &degrees)
        .iter()
        .map(|group| group.iter().map(|&index| uris[index].as_str()).collect())
        .collect();
    let degree_by_uri: BTreeMap<&str, usize> = uris
        .iter()
        .zip(degrees)
        .filter(|(_, degree)| *degree > 0)
        .map(|(uri, degree)| (uri.as_str(), degree))
        .collect();
    Ok(json!({ "aliases": aliases, "groups": groups, "degreeByUri": degree_by_uri }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_preserve_candidate_priority_and_ambiguity() {
        let uris: Vec<String> = [
            "file:///root/x.ts",
            "file:///root/x.js",
            "file:///root/a/index.ts",
            "file:///other/x.ts",
        ]
        .iter()
        .map(|uri| uri.to_string())
        .collect();
        let imports = Imports::new(&uris);
        assert_eq!(
            imports.resolve("file:///root/main.ts", "./x"),
            Some("file:///root/x.ts")
        );
        assert_eq!(imports.resolve("file:///root/main.ts", "@/x"), None);
        assert_eq!(
            imports.resolve("file:///root/main.ts", "~/a"),
            Some("file:///root/a/index.ts")
        );
        assert_eq!(
            imports.resolve("file:///root/main.ts", "./a/../x.js"),
            Some("file:///root/x.js")
        );
    }

    #[test]
    fn partition_keeps_unconnected_nodes_and_utf16_order() {
        let uris = vec![
            "file:///root/\u{e000}".to_string(),
            "file:///root/\u{10000}".to_string(),
            "file:///root/a".to_string(),
        ];
        let result = finalize(&uris, &BTreeMap::new()).unwrap();
        assert_eq!(
            result["groups"],
            json!([
                ["file:///root/a"],
                ["file:///root/\u{10000}"],
                ["file:///root/\u{e000}"]
            ])
        );
    }
}
