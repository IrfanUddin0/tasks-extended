import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from '@tauri-apps/api/window';
import "./signin.css";
import "./tasks.css";
import "./window.css";

const SCOPE = "https://www.googleapis.com/auth/tasks";
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET;

const appWindow = getCurrentWindow();

// near top of the file
function useFadeIn() {
    const [cls, setCls] = React.useState("");
    React.useEffect(() => {
        const id = requestAnimationFrame(() => setCls("is-in"));
        return () => cancelAnimationFrame(id);
    }, []);
    return cls;
}


function Titlebar() {
    return (
        <div className="titlebar">
            <div className="drag-region titlebar-left" data-tauri-drag-region>
                <span className="titlebar-title">Tasks Extended</span>
            </div>
            <div className="controls">
                <button className="ctrl-btn" title="Minimize" onClick={() => appWindow.minimize()} aria-label="Minimize">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M19 13H5v-2h14z" /></svg>
                </button>
                <button className="ctrl-btn" title="Maximize" onClick={() => appWindow.toggleMaximize()} aria-label="Maximize">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M4 4h16v16H4zm2 4v10h12V8z" /></svg>
                </button>
                <button className="ctrl-btn ctrl-close" title="Close" onClick={() => appWindow.close()} aria-label="Close">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M13.46 12L19 17.54V19h-1.46L12 13.46L6.46 19H5v-1.46L10.54 12L5 6.46V5h1.46L12 10.54L17.54 5H19v1.46z" /></svg>
                </button>
            </div>
        </div>
    );
}

export default function App() {
    const [token, setToken] = useState(null);
    const [booting, setBooting] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const t = await invoke("restore_session", {
                    clientId: CLIENT_ID,
                    clientSecret: CLIENT_SECRET,
                });
                setToken(t);
            } catch {
                // no stored session or refresh failed — show sign in
            } finally {
                setBooting(false);
            }
        })();
    }, []);

    return (
        <>
            <Titlebar />
            <div className="app-shell">
                {booting ? null : !token ? (
                    <SignInPage onSuccess={setToken} />
                ) : (
                    <TasksPage token={token} onSignOut={async () => {
                        await invoke("sign_out");
                        setToken(null);
                    }} />
                )}
            </div>
        </>
    );
}

function SignInPage({ onSuccess }) {
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");
    const fade = useFadeIn();

    async function signIn() {
        setErr("");
        setLoading(true);
        try {
            const res = await invoke("oauth_start_loopback", {
                clientId: CLIENT_ID,
                clientSecret: CLIENT_SECRET,
                scopes: SCOPE,
            });
            onSuccess(res);
        } catch (e) {
            setErr(String(e));
        } finally {
            setLoading(false);
        }
    }

    return (
        <div>
            <div className={`signin-container page ${fade}`}>
                <header className="signin-header">
                    <h1 className="signin-title">Tasks — Sign in</h1>
                    <p className="signin-sub">
                        Sign in with Google to sync your tasks. Local tags, colors, notes, and
                        attachments stay on your device.
                    </p>
                </header>

                <button className="signin-btn" onClick={signIn} disabled={loading}>
                    {loading ? "Waiting for authorization…" : "Sign in with Google"}
                </button>

                {err && <div className="signin-error">{err}</div>}
            </div>
        </div>

    );
}

function TasksPage({ token, onSignOut }) {
    const [items, setItems] = React.useState([]);   // flat
    const [roots, setRoots] = React.useState([]);   // tree
    const [booting, setBooting] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);
    const [err, setErr] = React.useState("");
    const lastUpdatedRef = React.useRef(null);
    const fade = useFadeIn();

    React.useEffect(() => {
        refresh({ initial: true });
        // refresh on focus
        let unlisten;
        (async () => {
            const { appWindow } = await import("@tauri-apps/api/window");
            unlisten = await appWindow.listen("tauri://focus", () => refresh());
        })();
        return () => { if (unlisten) unlisten(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function refresh({ initial = false } = {}) {
        if (initial) setBooting(true);
        setErr("");
        try {
            if (!initial && items.length) setRefreshing(true); // background state only
            const res = await invoke("list_google_tasks", {
                accessToken: token.access_token,
            });
            console.log(res);
            const list = (res?.items ?? []).map(t => ({
                id: t.id,
                title: t.title || "(untitled)",
                notes: t.notes || "",
                due: t.due || null,
                status: t.status || "needsAction",
                position: t.position || "",
                parent: t.parent || null,
            }));
            setItems(list);
            setRoots(buildTaskTree(list));
            lastUpdatedRef.current = new Date();
        } catch (e) {
            setErr(String(e));
            // keep showing stale data; no clearing
        } finally {
            setBooting(false);
            setRefreshing(false);
        }
    }

    return (
        <div className={`tasks-root page ${fade}`}>
            <div className="tasks-header">
                <div>
                    <div className="tasks-title">TASKS</div>
                    <div className="tasks-list-label">
                        My Tasks ▾
                        {lastUpdatedRef.current && (
                            <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                                Updated {timeAgo(lastUpdatedRef.current)}
                            </span>
                        )}
                    </div>
                </div>
                <button
                    className={`icon-btn ${refreshing ? "spin" : ""}`}
                    onClick={() => refresh()}
                    title="Refresh"
                    aria-busy={refreshing}
                >
                    ⟳
                </button>
            </div>

            {/* First ever load only shows a small message; after that we never blank the list */}
            {booting && roots.length === 0 && <div className="muted">Loading…</div>}
            {err && <div className="error-box">{err}</div>}

            {roots.length > 0 && (
                <ul className="tasks-list">
                    {roots.map((t) => (
                        <TaskNode key={t.id} task={t} depth={0} />
                    ))}
                </ul>
            )}

            {!booting && !err && roots.length === 0 && (
                <div className="muted">No tasks found.</div>
            )}

            <div className="tasks-footer">
                <button className="text-btn" onClick={onSignOut}>Sign out</button>
            </div>
        </div>
    );
}


/* --------- helpers (same as before) ---------- */
function buildTaskTree(list) {
    const byId = new Map(list.map(t => [t.id, { ...t, children: [] }]));
    const roots = [];
    for (const t of byId.values()) {
        if (t.parent && byId.has(t.parent)) byId.get(t.parent).children.push(t);
        else roots.push(t);
    }
    const sort = (a, b) => (a.position || "").localeCompare(b.position || "");
    (function walk(ns) { ns.sort(sort); ns.forEach(n => walk(n.children)); })(roots);
    return roots;
}
function TaskNode({ task, depth }) {
    const isCompleted = task.status === "completed";
    return (
        <li className={`row depth-${depth}`}>
            <span className={`dot ${isCompleted ? "dot--checked" : ""}`} />
            <div className="row-content">
                <div className={`title ${isCompleted ? "title--done" : ""}`}>{task.title}</div>
                {task.due && <span className="pill">{formatDue(task.due)}</span>}
                {task.notes && <div className="notes">{task.notes}</div>}
                {task.children.length > 0 && (
                    <ul className="tasks-list nested">
                        {task.children.map(ch => <TaskNode key={ch.id} task={ch} depth={depth + 1} />)}
                    </ul>
                )}
            </div>
        </li>
    );
}
function formatDue(iso) { try { const d = new Date(iso); return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return iso; } }
function timeAgo(date) { const s = Math.floor((Date.now() - date.getTime()) / 1000); if (s < 60) return "just now"; const m = Math.floor(s / 60); if (m < 60) return m + "m ago"; const h = Math.floor(m / 60); if (h < 24) return h + "h ago"; const d = Math.floor(h / 24); return d + "d ago"; }
