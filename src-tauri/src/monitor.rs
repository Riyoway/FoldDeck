use crate::AppState;
use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{Emitter, Manager};

/// Live resource usage for one running project (its whole process tree).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcStat {
    pub id: String,
    /// Root (spawned powershell) pid; 0 for in-process static servers.
    pub pid: u32,
    /// Machine-normalized CPU percent 0..100; None until the 2nd sample or for
    /// in-process servers.
    pub cpu: Option<f32>,
    /// Resident memory of the tree in MB; None for in-process servers.
    pub mem_mb: Option<f64>,
}

/// Process ids of the subtree rooted at `root`, using a pid -> parent map.
fn subtree(root: Pid, parents: &HashMap<Pid, Option<Pid>>) -> Vec<Pid> {
    let mut tree = vec![root];
    let mut i = 0;
    while i < tree.len() {
        let cur = tree[i];
        for (pid, parent) in parents {
            if *parent == Some(cur) && !tree.contains(pid) {
                tree.push(*pid);
            }
        }
        i += 1;
    }
    tree
}

/// One long-lived sampler thread: refreshes process CPU/memory every 2s and
/// emits a `process-stats` event with per-project totals. CPU% is a diff between
/// two refreshes, so the System is kept alive and primed once before the loop.
pub fn spawn_sampler(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut sys = System::new();
        sys.refresh_cpu_all();
        let ncpu = sys.cpus().len().max(1) as f32;
        let refresh = |s: &mut System| {
            s.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing().with_cpu().with_memory(),
            );
        };
        // Prime: first refresh has no previous sample, so every cpu is 0.
        refresh(&mut sys);
        loop {
            std::thread::sleep(Duration::from_secs(2));
            refresh(&mut sys);

            let Some(state) = app.try_state::<AppState>() else {
                continue;
            };
            let running = state.manager.running_procs();
            let procs = sys.processes();
            let parents: HashMap<Pid, Option<Pid>> =
                procs.iter().map(|(pid, p)| (*pid, p.parent())).collect();

            let stats: Vec<ProcStat> = running
                .iter()
                .map(|(id, pid_opt)| match pid_opt {
                    None => ProcStat { id: id.clone(), pid: 0, cpu: None, mem_mb: None },
                    Some(root) => {
                        let tree = subtree(Pid::from_u32(*root), &parents);
                        let (mut cpu, mut mem) = (0.0f32, 0u64);
                        for pid in &tree {
                            if let Some(p) = procs.get(pid) {
                                cpu += p.cpu_usage();
                                mem += p.memory();
                            }
                        }
                        ProcStat {
                            id: id.clone(),
                            pid: *root,
                            cpu: Some(cpu / ncpu),
                            mem_mb: Some(mem as f64 / 1_048_576.0),
                        }
                    }
                })
                .collect();

            *state.last_stats.lock().unwrap() = stats.clone();
            let _ = app.emit("process-stats", &stats);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subtree_collects_descendants() {
        let a = Pid::from_u32(1);
        let b = Pid::from_u32(2);
        let c = Pid::from_u32(3);
        let d = Pid::from_u32(4); // unrelated
        let parents: HashMap<Pid, Option<Pid>> =
            [(a, None), (b, Some(a)), (c, Some(b)), (d, None)].into_iter().collect();
        let mut tree = subtree(a, &parents);
        tree.sort();
        assert_eq!(tree, vec![a, b, c]);
    }
}
