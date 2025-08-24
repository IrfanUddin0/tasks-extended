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

// simple hook to trigger CSS transition on mount
function useFadeIn() {
    const [cls, setCls] = useState("");
    useEffect(() => {
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

// App.jsx (structure)
export default function App() {
    const [token, setToken] = useState(null);
    return (
        <>
            <Titlebar />                           {/* fixed, outside animations */}
            <div className="app-shell">
                {!token ? (
                    <SignInPage onSuccess={setToken} />
                ) : (
                    <TasksPage token={token} onSignOut={() => setToken(null)} />
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
    const [roots, setRoots] = useState([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState("");
    const fade = useFadeIn();

    useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

    async function load() {
        setLoading(true);
        setErr("");
        try {
            const res = await invoke("list_google_tasks", { accessToken: token.access_token });
            const tree = buildTaskTree(res?.items ?? []);
            setRoots(tree);
        } catch (e) {
            setErr(String(e));
        } finally {
            setLoading(false);
        }
    }

    return (
        <div>
            <div className={`tasks-root page ${fade}`}>
                <div className="tasks-header">
                    <div>
                        <div className="tasks-title">TASKS</div>
                        <div className="tasks-list-label">My Tasks ▾</div>
                    </div>
                    <button className="icon-btn" onClick={load} title="Refresh">
                        ⟳
                    </button>
                </div>


                <button className="tasks-add">＋ Add a task</button>

                {loading && <div className="muted">Loading…</div>}
                {err && <div className="error-box">{err}</div>}
                {!loading && roots.length === 0 && !err && (
                    <div className="muted">No tasks found.</div>
                )}

                {!loading && roots.length > 0 && (
                    <ul className="tasks-list">
                        {roots.map((t) => (
                            <TaskNode key={t.id} task={t} depth={0} />
                        ))}
                    </ul>
                )}

                <div className="tasks-footer">
                    <button className="text-btn" onClick={onSignOut}>Sign out</button>
                </div>
            </div>
        </div>

    );
}

/* --------- helpers (same as before) ---------- */
function normalizeTask(t) { return { id: t.id, title: t.title || "(untitled)", notes: t.notes || "", due: t.due || null, status: t.status || "needsAction", position: t.position || "", parent: t.parent || null, children: [] } }
function buildTaskTree(items) { const byId = new Map(items.map(t => [t.id, normalizeTask(t)])); const roots = []; for (const task of byId.values()) { if (task.parent && byId.has(task.parent)) byId.get(task.parent).children.push(task); else roots.push(task) } const sort = (a, b) => (a.position || "").localeCompare(b.position || ""); (function rec(ns) { ns.sort(sort); ns.forEach(n => rec(n.children)) })(roots); return roots }
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
                        {task.children.map((ch) => (
                            <TaskNode key={ch.id} task={ch} depth={depth + 1} />
                        ))}
                    </ul>
                )}
            </div>
        </li>
    );
}
function formatDue(iso) { try { const d = new Date(iso); return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) } catch { return iso } }
