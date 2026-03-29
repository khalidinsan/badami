use notify::{
    event::{CreateKind, ModifyKind},
    Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, Serialize)]
pub struct FileChangedPayload {
    pub watch_id: String,
    pub path: String,
}

type WatcherMap = Arc<Mutex<HashMap<String, RecommendedWatcher>>>;

pub struct FileWatchState {
    watchers: WatcherMap,
}

impl FileWatchState {
    pub fn new() -> Self {
        Self {
            watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Default for FileWatchState {
    fn default() -> Self {
        Self::new()
    }
}

/// Start watching a local file for changes.
/// Emits the event `file-watch-changed` with `{ watch_id, path }` payload
/// whenever the file is modified or recreated (atomic save).
///
/// A 3-second grace period is applied after registration to suppress spurious
/// events caused by the initial download write and the editor opening the file.
#[tauri::command]
pub fn watch_file(
    app: AppHandle,
    watch_id: String,
    path: String,
    state: State<FileWatchState>,
) -> Result<(), String> {
    let watch_id_event = watch_id.clone();
    let path_event = path.clone();
    // Capture registration time inside the closure so initial events are ignored
    let registered_at = std::time::Instant::now();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            // Suppress all events for the first 3s after registration.
            // This prevents false uploads triggered by the download write and
            // the editor opening/reading the file.
            if registered_at.elapsed() < std::time::Duration::from_secs(3) {
                return;
            }
            let relevant = matches!(
                event.kind,
                EventKind::Modify(ModifyKind::Data(_))
                    | EventKind::Modify(ModifyKind::Any)
                    | EventKind::Create(CreateKind::File)
                    | EventKind::Create(CreateKind::Any)
            );
            if relevant {
                let _ = app.emit(
                    "file-watch-changed",
                    FileChangedPayload {
                        watch_id: watch_id_event.clone(),
                        path: path_event.clone(),
                    },
                );
            }
        }
    })
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    watcher
        .watch(Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch path: {e}"))?;

    let mut map = state.watchers.lock().unwrap();
    map.insert(watch_id, watcher);

    Ok(())
}

/// Stop watching a file by its watch_id.
#[tauri::command]
pub fn unwatch_file(watch_id: String, state: State<FileWatchState>) {
    let mut map = state.watchers.lock().unwrap();
    map.remove(&watch_id);
}
