import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { BookOpen, Camera, ChevronLeft, ChevronRight, CloudOff, Copy, Eye, EyeOff, ImageOff, Images, KeyRound, LockKeyhole, LogOut, Plus, RefreshCw, Trash2, UnlockKeyhole, X } from "lucide-react";
import type { JournalEntry } from "./types";
import {
  baseOf, changePassword, createVault, decryptPhoto, deriveWriteToken, encryptPhoto, JournalVaultError, mergeJournalContent,
  openContent, openVault, resetPassword, sameJournal, sealContent,
  type JournalBase, type JournalContent, type JournalEnvelope,
} from "./journalVault";
import {
  createJournal, deleteJournalPhotos, readJournal, readJournalPhotos, readJournalVersion, saveJournal, uploadJournalPhoto,
  type StoredJournal,
} from "./sync";

/** The last journal copy this device saw in the cloud (still encrypted), so it can be unlocked offline. */
const CACHE_KEY = "daybook.journal.cache.v1";
/** Edits made on this device that the cloud hasn't confirmed yet (encrypted with the journal key). */
const PENDING_KEY = "daybook.journal.pending.v1";
const SAVE_DELAY_MS = 800;
const LOCAL_SAVE_DELAY_MS = 300;
const RETRY_MS = 15_000;
const LOCK_WAIT_MS = 8_000;
const AUTO_LOCK_MS = 10 * 60_000;
const MIN_PASSPHRASE = 8;
const MAX_PHOTO_EDGE = 1600;
const MISSING_PHOTO = "missing";
const OFFLINE_MESSAGE = "You’re offline. Connect to the internet and try again.";

type PendingChanges = { envelope: JournalEnvelope; baseVersion: number; base: JournalBase | null; savedAt: number };
type Phase = "loading" | "unreachable" | "create" | "locked" | "open";
type SaveStatus = "saved" | "saving" | "offline" | "error";
type PasswordRequest = { password: string; resolve: () => void; reject: (reason: unknown) => void };
type SyncOutcome = "done" | "again" | "stop";

const readJson = <T,>(key: string): T | null => { try { return JSON.parse(localStorage.getItem(key) ?? "null") as T | null; } catch { return null; } };
const writeJson = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full: the cloud copy is still kept */ } };
const removeKey = (key: string) => { try { localStorage.removeItem(key); } catch { /* nothing to clean up */ } };
const isStoredJournal = (value: unknown): value is StoredJournal => Boolean(value && typeof value === "object" && (value as StoredJournal).envelope && typeof (value as StoredJournal).version === "number");
const readCache = () => { const value = readJson<StoredJournal>(CACHE_KEY); return isStoredJournal(value) ? value : null; };
const readPending = () => { const value = readJson<PendingChanges>(PENDING_KEY); return value && value.envelope && typeof value.baseVersion === "number" ? value : null; };
const describe = (reason: unknown, fallback: string) => reason instanceof JournalVaultError ? reason.message : !navigator.onLine ? OFFLINE_MESSAGE : fallback;
const wait = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });
const revokeUrl = (url: string) => { if (url !== MISSING_PHOTO) URL.revokeObjectURL(url); };

async function loadImage(file: File): Promise<{ image: CanvasImageSource; width: number; height: number; release: () => void }> {
  try {
    const bitmap = await createImageBitmap(file);
    return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return { image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
    } catch (reason) { URL.revokeObjectURL(url); throw reason; }
  }
}

/** Shrinks a picture to a sensible size and re-encodes it as JPEG (which also drops location metadata). */
async function preparePhoto(file: File) {
  const source = await loadImage(file);
  try {
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(source.width, source.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");
    context.drawImage(source.image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    if (!blob) throw new Error("The picture could not be encoded.");
    return blob;
  } finally { source.release(); }
}

export function PasswordInput({ value, onChange, autoComplete, placeholder, autoFocus, label = "passphrase" }: { value: string; onChange: (value: string) => void; autoComplete: string; placeholder?: string; autoFocus?: boolean; label?: string }) {
  const [visible, setVisible] = useState(false);
  return <span className="password-input"><input className="input-control" type={visible ? "text" : "password"} autoComplete={autoComplete} autoCapitalize="off" autoCorrect="off" spellCheck={false} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoFocus={autoFocus} required /><button className="password-toggle" type="button" onClick={() => setVisible(!visible)} aria-label={visible ? `Hide ${label}` : `Show ${label}`} aria-pressed={visible} title={visible ? `Hide ${label}` : `Show ${label}`}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>;
}

/**
 * "Add a photo" with a choice of camera or gallery. On Android a plain image picker goes straight to
 * the photo library, so on touch screens the button opens a small menu instead; the camera input
 * uses `capture`, which opens the camera app directly. Computers have no camera choice to make, so
 * there the button opens the file picker as before. `onPickerOpen` runs just before a picker opens,
 * since on phones the camera or gallery app covers the page while it is open.
 */
function AddPhotoButton({ busy, busyLabel, iconSize, onPick, onPickerOpen }: { busy: boolean; busyLabel: string; iconSize: number; onPick: (file?: File) => void; onPickerOpen: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const showMenu = open && !busy;
  const touch = matchMedia("(pointer: coarse)").matches;
  useEffect(() => {
    if (!showMenu) return;
    const outside = (event: PointerEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [showMenu]);
  const choose = (input: HTMLInputElement | null) => { setOpen(false); onPickerOpen(); input?.click(); };
  const picked = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; event.target.value = ""; onPick(file); };
  return <div className="photo-picker" ref={wrap}>
    <button ref={toggle} className="soft-button" type="button" disabled={busy} aria-expanded={touch ? showMenu : undefined} onClick={() => touch ? setOpen(!open) : choose(gallery.current)}><Camera size={iconSize} /> {busy ? busyLabel : "Add a photo"}</button>
    {showMenu && <div className="photo-picker-menu"><button type="button" autoFocus onClick={() => choose(camera.current)}><Camera size={17} /> Take a photo</button><button type="button" onClick={() => choose(gallery.current)}><Images size={17} /> Choose from gallery</button></div>}
    <input ref={camera} className="visually-hidden" type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" onChange={picked} />
    <input ref={gallery} className="visually-hidden" type="file" accept="image/*" tabIndex={-1} aria-hidden="true" onChange={picked} />
  </div>;
}

/**
 * The private journal. Everything is encrypted in the browser with a key that only the passphrase
 * (or the recovery code) unlocks. Saves are version-checked: when another device saved first, the
 * two copies are merged instead of one overwriting the other. Unsent edits are kept, encrypted, on
 * this device and retried until the cloud confirms them. Closing the journal logs out of it, so the
 * passphrase is asked for every time it is opened.
 */
export function JournalPage({ active, legacyEntries, onLegacyMigrated }: { active: boolean; legacyEntries: JournalEntry[]; onLegacyMigrated: () => void }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [content, setContentState] = useState<JournalContent | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false), [locking, setLocking] = useState(false), [photoBusy, setPhotoBusy] = useState(false);
  const [password, setPassword] = useState(""), [confirm, setConfirm] = useState(""), [recovery, setRecovery] = useState(""), [newPassword, setNewPassword] = useState("");
  const [resetMode, setResetMode] = useState(false), [changingPassword, setChangingPassword] = useState(false);
  const [pageId, setPageId] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [photoRetry, setPhotoRetry] = useState(0);
  const [unsyncedOnDevice, setUnsyncedOnDevice] = useState(() => Boolean(readPending()));
  const [usingDeviceCopy, setUsingDeviceCopy] = useState(false);

  const remoteRef = useRef<StoredJournal | null>(null);
  const missingOnServer = useRef(false);
  const keyRef = useRef<CryptoKey | null>(null);
  const tokenRef = useRef<string | null>(null);
  const contentRef = useRef<JournalContent | null>(null);
  const baseRef = useRef<JournalBase | null>(null);
  const dirtyRef = useRef(false);
  const sessionRef = useRef(0);
  const syncRef = useRef<{ running: boolean; rerun: boolean; pull: boolean; promise: Promise<void> }>({ running: false, rerun: false, pull: false, promise: Promise.resolve() });
  const passwordRequest = useRef<PasswordRequest | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const localTimer = useRef<number | undefined>(undefined);
  const urlsRef = useRef<Record<string, string>>({});
  const loadingPhotos = useRef(new Set<string>());
  const failedPhotos = useRef(new Set<string>());
  const syncError = useRef("");
  const purgedPhotos = useRef(new Set<string>());
  const activeRef = useRef(active);
  const awaySince = useRef<number | null>(null);
  const lockingRef = useRef(false);
  /** A photo picker is open: on phones the camera or gallery covers the page, which isn't closing the journal. */
  const pickingPhoto = useRef(false);
  /** A new recovery code is on screen, and the person may switch to another app to save it. */
  const recoveryShowing = useRef(false);
  useEffect(() => { recoveryShowing.current = Boolean(recoveryCode); }, [recoveryCode]);

  const showContent = (next: JournalContent) => { contentRef.current = next; setContentState(next); };

  // ---- Finding the journal --------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    readJournal().then((remote) => {
      if (cancelled) return;
      const cached = readCache();
      setUsingDeviceCopy(false);
      if (remote) { remoteRef.current = remote; writeJson(CACHE_KEY, remote); missingOnServer.current = false; setPhase("locked"); }
      // The cloud has no journal but this device has a copy: unlocking it puts it back.
      else if (cached) { remoteRef.current = cached; missingOnServer.current = true; setPhase("locked"); }
      else setPhase("create");
    }).catch(() => {
      if (cancelled) return;
      const cached = readCache();
      if (cached) { remoteRef.current = cached; setUsingDeviceCopy(true); setPhase("locked"); }
      else setPhase("unreachable");
    });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  // Keep trying when storage couldn't be reached, and re-check before offering to create a journal.
  useEffect(() => {
    if (phase !== "unreachable") return;
    const retry = () => setLoadAttempt((value) => value + 1);
    const timer = window.setInterval(retry, RETRY_MS);
    window.addEventListener("online", retry);
    return () => { window.clearInterval(timer); window.removeEventListener("online", retry); };
  }, [phase]);

  // ---- Saving and syncing -------------------------------------------------------------------
  const persistLocally = async () => {
    const key = keyRef.current, snapshot = contentRef.current, remote = remoteRef.current, base = baseRef.current;
    if (!key || !snapshot || !remote || !dirtyRef.current) return;
    const sealed = await sealContent(snapshot, key, remote.envelope);
    if (!dirtyRef.current || keyRef.current !== key) return;
    writeJson(PENDING_KEY, { envelope: sealed, baseVersion: remote.version, base, savedAt: Date.now() } satisfies PendingChanges);
    setUnsyncedOnDevice(true);
  };

  /** Records that the cloud now holds `snapshot` at `version`. */
  const accept = (envelope: JournalEnvelope, version: number, snapshot: JournalContent) => {
    remoteRef.current = { envelope, version };
    writeJson(CACHE_KEY, remoteRef.current);
    baseRef.current = baseOf(snapshot);
    missingOnServer.current = false;
    setUsingDeviceCopy(false);
    if (contentRef.current === snapshot) { dirtyRef.current = false; removeKey(PENDING_KEY); setUnsyncedOnDevice(false); }
    // Photos removed from the gallery are deleted from storage once the removal itself is saved.
    const token = tokenRef.current;
    const removed = (snapshot.deletedPhotoIds ?? []).filter((id) => !purgedPhotos.current.has(id));
    if (token && removed.length) {
      removed.forEach((id) => purgedPhotos.current.add(id));
      deleteJournalPhotos(token, removed).catch(() => removed.forEach((id) => purgedPhotos.current.delete(id)));
    }
  };

  /** Fetches the newest cloud copy and merges it into what is on screen. */
  const mergeLatest = async (session: number) => {
    const key = keyRef.current;
    if (!key) return;
    const fresh = await readJournal();
    if (session !== sessionRef.current) return;
    if (!fresh) { missingOnServer.current = true; dirtyRef.current = true; return; }
    const theirs = await openContent(key, fresh.envelope);
    const mine = contentRef.current;
    if (session !== sessionRef.current || !mine) return;
    const merged = mergeJournalContent(baseRef.current, mine, theirs);
    remoteRef.current = fresh;
    writeJson(CACHE_KEY, fresh);
    baseRef.current = baseOf(theirs);
    if (!sameJournal(merged.content, mine)) showContent(merged.content);
    dirtyRef.current = !sameJournal(merged.content, theirs);
    if (merged.keptConflicts) setNotice("A page was also edited on another device at the same time. Both versions are kept — the other one is on the last page.");
  };

  const pushChanges = async (session: number): Promise<SyncOutcome> => {
    const key = keyRef.current, token = tokenRef.current, remote = remoteRef.current, snapshot = contentRef.current;
    if (!key || !token || !remote || !snapshot) return "stop";
    const request = passwordRequest.current;
    setStatus("saving");
    const sealed = await sealContent(snapshot, key, remote.envelope);
    if (dirtyRef.current && session === sessionRef.current) {
      writeJson(PENDING_KEY, { envelope: sealed, baseVersion: remote.version, base: baseRef.current, savedAt: Date.now() } satisfies PendingChanges);
      setUnsyncedOnDevice(true);
    }
    const outgoing = request ? await changePassword(sealed, key, request.password) : sealed;
    let result = await saveJournal(remote.version, outgoing, token);
    if (result.status === "missing") result = await createJournal(outgoing, token);
    if (result.status === "ok") {
      accept(outgoing, result.version, snapshot);
      if (request && passwordRequest.current === request) { passwordRequest.current = null; request.resolve(); }
      return session === sessionRef.current ? "done" : "stop";
    }
    if (session !== sessionRef.current) return "stop";
    if (result.status === "conflict" || result.status === "exists") { await mergeLatest(session); return "again"; }
    throw new JournalVaultError(result.status === "forbidden"
      ? "This journal was replaced on another device, so this copy can’t be saved. Lock it and unlock it again."
      : "The journal couldn’t be saved. It may have grown too large.");
  };

  const pullChanges = async (session: number): Promise<SyncOutcome> => {
    const remote = remoteRef.current;
    if (!remote) return "stop";
    const version = await readJournalVersion();
    if (session !== sessionRef.current) return "stop";
    if (version === null) { missingOnServer.current = true; dirtyRef.current = true; return "again"; }
    if (version === remote.version) return "done";
    await mergeLatest(session);
    return dirtyRef.current ? "again" : "done";
  };

  /** Sends unsaved edits (and, when asked, checks for edits from other devices). Only one run at a time. */
  const runSync = (pull: boolean): Promise<void> => {
    const state = syncRef.current;
    state.pull ||= pull;
    if (state.running) { state.rerun = true; return state.promise; }
    if (!keyRef.current || (!dirtyRef.current && !passwordRequest.current && !state.pull)) return Promise.resolve();
    state.running = true;
    window.clearTimeout(saveTimer.current);
    const session = sessionRef.current;
    state.promise = (async () => {
      try {
        for (let round = 0; round < 8; round += 1) {
          state.rerun = false;
          if (session !== sessionRef.current || !keyRef.current) return;
          const wantsPull = state.pull;
          state.pull = false;
          const outcome: SyncOutcome = dirtyRef.current || passwordRequest.current ? await pushChanges(session) : wantsPull ? await pullChanges(session) : "done";
          if (outcome === "stop") return;
          if (outcome === "done" && !state.rerun && !state.pull) break;
        }
        if (session === sessionRef.current) {
          setStatus(dirtyRef.current ? "saving" : "saved");
          const cleared = syncError.current;
          if (cleared) { syncError.current = ""; setError((current) => current === cleared ? "" : current); }
        }
      } catch (reason) {
        if (session !== sessionRef.current) return;
        const request = passwordRequest.current;
        if (request) { passwordRequest.current = null; request.reject(reason); }
        if (reason instanceof JournalVaultError && !request) { syncError.current = reason.message; setError(reason.message); setStatus("error"); }
        else setStatus(navigator.onLine ? "error" : "offline");
      } finally {
        state.running = false;
        // Work asked for while an earlier (now locked) session was finishing belongs to the current session.
        if (state.rerun && session !== sessionRef.current && keyRef.current) { state.rerun = false; void runSync(false); }
      }
    })();
    return state.promise;
  };

  const edit = (update: (current: JournalContent) => JournalContent) => {
    const current = contentRef.current;
    if (!current || locking) return;
    showContent(update(current));
    dirtyRef.current = true;
    setStatus((value) => value === "offline" || value === "error" ? value : "saving");
    window.clearTimeout(localTimer.current);
    localTimer.current = window.setTimeout(() => { void persistLocally(); }, LOCAL_SAVE_DELAY_MS);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void runSync(false); }, SAVE_DELAY_MS);
  };

  // ---- Opening and locking ------------------------------------------------------------------
  const enter = async (key: CryptoKey, remote: StoredJournal, opened: JournalContent) => {
    const token = await deriveWriteToken(key);
    let working = opened;
    let dirty = missingOnServer.current;
    const pending = readPending();
    if (pending) {
      try {
        const mine = await openContent(key, pending.envelope);
        working = pending.baseVersion === remote.version ? mine : mergeJournalContent(pending.base, mine, opened).content;
        dirty ||= !sameJournal(working, opened);
      } catch { /* saved by a journal that no longer exists; it can't be opened with this key */ }
    }
    if (!dirty && pending) removeKey(PENDING_KEY);
    sessionRef.current += 1;
    keyRef.current = key;
    tokenRef.current = token;
    remoteRef.current = remote;
    writeJson(CACHE_KEY, remote);
    baseRef.current = baseOf(opened);
    dirtyRef.current = dirty;
    showContent(working);
    setPageId(working.pages[working.pages.length - 1]?.id ?? null);
    setStatus(dirty ? "saving" : "saved");
    setUnsyncedOnDevice(Boolean(readPending()));
    setError("");
    awaySince.current = null;
    setPhase("open");
    if (dirty) void runSync(false);
  };

  const lock = async () => {
    if (!keyRef.current || lockingRef.current) return;
    lockingRef.current = true;
    setLocking(true);
    window.clearTimeout(saveTimer.current);
    window.clearTimeout(localTimer.current);
    if (dirtyRef.current) {
      await persistLocally();
      await Promise.race([runSync(false), wait(LOCK_WAIT_MS)]);
    }
    sessionRef.current += 1;
    const request = passwordRequest.current;
    if (request) { passwordRequest.current = null; request.reject(new JournalVaultError("The journal was locked before the passphrase could be changed.")); }
    keyRef.current = null; tokenRef.current = null; contentRef.current = null; baseRef.current = null; dirtyRef.current = false;
    pickingPhoto.current = false;
    Object.values(urlsRef.current).forEach(revokeUrl);
    urlsRef.current = {};
    loadingPhotos.current.clear();
    failedPhotos.current.clear();
    purgedPhotos.current.clear();
    setPhotoUrls({}); setContentState(null);
    setPassword(""); setConfirm(""); setRecovery(""); setNewPassword("");
    setChangingPassword(false); setResetMode(false); setRecoveryCode(""); setNotice(""); setError("");
    setUnsyncedOnDevice(Boolean(readPending()));
    lockingRef.current = false;
    setLocking(false);
    setPhase("locked");
  };

  /** Locks the journal once it has been out of sight (another section, tab or app) for AUTO_LOCK_MS. */
  const lockIfAwayTooLong = () => {
    const away = document.visibilityState === "hidden" || !activeRef.current;
    if (away && awaySince.current === null) awaySince.current = Date.now();
    const since = awaySince.current;
    if (!away) awaySince.current = null;
    if (since !== null && Date.now() - since >= AUTO_LOCK_MS && keyRef.current) { void lock(); return true; }
    return false;
  };

  /**
   * Logs out as soon as the journal is closed: another section of the app is opened, or the app or
   * tab is put away. While a photo is being picked or a new recovery code is waiting to be saved,
   * it waits for AUTO_LOCK_MS instead, so neither is lost.
   */
  const lockIfClosed = () => {
    if (!keyRef.current) return false;
    const closed = !activeRef.current || document.visibilityState === "hidden";
    if (closed && !pickingPhoto.current && !recoveryShowing.current) { void lock(); return true; }
    return lockIfAwayTooLong();
  };

  useEffect(() => {
    activeRef.current = active;
    if (phase === "open") { if (!lockIfClosed() && active) void runSync(true); }
    else if (active && (phase === "create" || phase === "unreachable")) setLoadAttempt((value) => value + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (phase !== "open") return;
    const flush = () => { void persistLocally(); void runSync(false); };
    const retryPhotos = () => { if (failedPhotos.current.size) { failedPhotos.current.clear(); setPhotoRetry((value) => value + 1); } };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") { if (!lockIfClosed()) flush(); return; }
      pickingPhoto.current = false;
      if (!lockIfClosed()) { void runSync(true); retryPhotos(); }
    };
    // The window gets focus back when a computer's file picker closes, picked or cancelled.
    const onFocus = () => { pickingPhoto.current = false; if (!lockIfClosed()) void runSync(true); };
    const onOnline = () => { void runSync(true); retryPhotos(); };
    const onOffline = () => setStatus((value) => value === "saved" && !dirtyRef.current ? value : "offline");
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { flush(); event.preventDefault(); event.returnValue = ""; } };
    const timer = window.setInterval(() => {
      if (lockIfClosed()) return;
      const watching = document.visibilityState === "visible" && activeRef.current;
      if (dirtyRef.current || watching) void runSync(watching);
      if (watching) retryPhotos();
    }, RETRY_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", warnBeforeLeaving);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => () => {
    window.clearTimeout(saveTimer.current);
    window.clearTimeout(localTimer.current);
    Object.values(urlsRef.current).forEach(revokeUrl);
  }, []);

  // ---- Photos -------------------------------------------------------------------------------
  useEffect(() => {
    const key = keyRef.current;
    if (phase !== "open" || !content || !key) return;
    const wanted = content.photos.filter((photo) => photo.stored && !(photo.id in urlsRef.current) && !loadingPhotos.current.has(photo.id) && !failedPhotos.current.has(photo.id)).map((photo) => photo.id);
    if (!wanted.length) return;
    wanted.forEach((id) => loadingPhotos.current.add(id));
    const session = sessionRef.current;
    void (async () => {
      try {
        const rows = await readJournalPhotos(wanted);
        const found: Record<string, string> = {};
        for (const row of rows) {
          try { found[row.id] = URL.createObjectURL(new Blob([await decryptPhoto(key, row.iv, row.ciphertext)], { type: "image/jpeg" })); }
          catch { found[row.id] = MISSING_PHOTO; }
        }
        for (const id of wanted) if (!(id in found)) found[id] = MISSING_PHOTO;
        if (session !== sessionRef.current) { Object.values(found).forEach(revokeUrl); return; }
        urlsRef.current = { ...urlsRef.current, ...found };
        setPhotoUrls(urlsRef.current);
      } catch { wanted.forEach((id) => failedPhotos.current.add(id)); /* tried again when the connection returns */ }
      finally { wanted.forEach((id) => loadingPhotos.current.delete(id)); }
    })();
  }, [phase, content, photoRetry]);

  const addPhoto = async (file?: File) => {
    const key = keyRef.current, token = tokenRef.current;
    if (!file || !key || !token) return;
    setError(""); setNotice(""); setPhotoBusy(true);
    try {
      const blob = await preparePhoto(file);
      const id = crypto.randomUUID();
      const sealed = await encryptPhoto(key, new Uint8Array(await blob.arrayBuffer()));
      await uploadJournalPhoto(token, id, sealed.iv, sealed.ciphertext);
      urlsRef.current = { ...urlsRef.current, [id]: URL.createObjectURL(blob) };
      setPhotoUrls(urlsRef.current);
      const now = Date.now();
      edit((current) => ({ ...current, photos: [...current.photos, { id, label: "A moment", addedAt: now, labelUpdatedAt: now, stored: true }] }));
      setNotice("Photo added to your private gallery.");
    } catch (reason) {
      setError(!navigator.onLine ? "You’re offline. Photos can be added once you’re connected again." : reason instanceof Error && reason.message.startsWith("This journal") ? reason.message : "That picture couldn’t be added. Try again, or choose a different photo.");
    } finally { setPhotoBusy(false); }
  };

  const holdOpenForPicker = () => { pickingPhoto.current = true; };

  const removePhoto = (id: string) => {
    if (!window.confirm("Remove this photo from your private gallery? It will be deleted on every device.")) return;
    edit((current) => ({ ...current, photos: current.photos.filter((photo) => photo.id !== id), deletedPhotoIds: [...(current.deletedPhotoIds ?? []).filter((item) => item !== id), id].slice(-1000) }));
    const url = urlsRef.current[id];
    if (url) { revokeUrl(url); const rest = { ...urlsRef.current }; delete rest[id]; urlsRef.current = rest; setPhotoUrls(rest); }
  };

  // ---- Forms ----------------------------------------------------------------------------------
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError("");
    if (password.length < MIN_PASSPHRASE) { setError(`Use at least ${MIN_PASSPHRASE} characters for your passphrase.`); return; }
    if (password !== confirm) { setError("The two passphrases don’t match."); return; }
    setBusy(true);
    try {
      const migrated = legacyEntries.length ? legacyEntries.map((entry) => `${entry.title}\n${entry.body}`).join("\n\n") : "";
      const now = Date.now();
      const created = await createVault(password, { pages: [{ id: crypto.randomUUID(), text: migrated, updatedAt: now }], photos: [], stickyNote: "", stickyNoteUpdatedAt: 0, deletedPhotoIds: [] });
      const result = await createJournal(created.envelope, await deriveWriteToken(created.key));
      if (result.status === "ok") {
        if (legacyEntries.length) onLegacyMigrated();
        missingOnServer.current = false;
        await enter(created.key, { envelope: created.envelope, version: result.version }, created.content);
        setRecoveryCode(created.code);
        setPassword(""); setConfirm("");
      } else if (result.status === "exists") {
        const remote = await readJournal();
        if (remote) { remoteRef.current = remote; writeJson(CACHE_KEY, remote); }
        setPassword(""); setConfirm("");
        setPhase("locked");
        setError("A journal was already set up on another device. Unlock it with that passphrase.");
      } else setError("The journal couldn’t be created. Try again.");
    } catch (reason) { setError(describe(reason, "The journal couldn’t be created. Check your connection and try again.")); }
    finally { setBusy(false); }
  };

  const unlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      // Use the newest copy so a passphrase changed on another device works here too.
      let remote = remoteRef.current;
      try {
        const fresh = await readJournal();
        if (fresh) { remote = fresh; missingOnServer.current = false; setUsingDeviceCopy(false); }
        else missingOnServer.current = true;
      } catch { setUsingDeviceCopy(true); }
      if (!remote) {
        if (missingOnServer.current) { setPhase("create"); setPassword(""); return; }
        setError("Your journal can’t be reached right now. Check your connection and try again."); return;
      }
      const opened = await openVault(remote.envelope, password);
      await enter(opened.key, remote, opened.content);
      setPassword("");
    } catch (reason) { setError(describe(reason, "The journal couldn’t be opened. Try again.")); }
    finally { setBusy(false); }
  };

  const reset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError("");
    if (newPassword.length < MIN_PASSPHRASE) { setError(`Use at least ${MIN_PASSPHRASE} characters for the new passphrase.`); return; }
    if (newPassword !== confirm) { setError("The two passphrases don’t match."); return; }
    setBusy(true);
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const remote = await readJournal();
        if (!remote) { setError("There’s no journal in the cloud to reset yet."); return; }
        const result = await resetPassword(remote.envelope, recovery, newPassword);
        const saved = await saveJournal(remote.version, result.envelope, await deriveWriteToken(result.key));
        if (saved.status === "ok") {
          await enter(result.key, { envelope: result.envelope, version: saved.version }, result.content);
          setRecoveryCode(result.code);
          setRecovery(""); setNewPassword(""); setConfirm(""); setResetMode(false);
          setNotice("Passphrase reset. Your old recovery code no longer works — save the new one below.");
          return;
        }
        if (saved.status !== "conflict") { setError("The passphrase couldn’t be reset. Try again."); return; }
      }
      setError("The journal is being saved on another device. Try again in a moment.");
    } catch (reason) { setError(describe(reason, "The passphrase couldn’t be reset. Try again.")); }
    finally { setBusy(false); }
  };

  const change = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); setNotice("");
    if (newPassword.length < MIN_PASSPHRASE) { setError(`Use at least ${MIN_PASSPHRASE} characters for the new passphrase.`); return; }
    if (newPassword !== confirm) { setError("The two passphrases don’t match."); return; }
    if (!navigator.onLine) { setError(OFFLINE_MESSAGE); return; }
    setBusy(true);
    try {
      await new Promise<void>((resolve, reject) => { passwordRequest.current = { password: newPassword, resolve, reject }; void runSync(false); });
      setChangingPassword(false); setNewPassword(""); setConfirm("");
      setNotice("Passphrase changed. Use the new passphrase on your other devices too.");
    } catch (reason) { setError(describe(reason, "The passphrase couldn’t be changed. Try again.")); }
    finally { setBusy(false); }
  };

  const copyRecoveryCode = async () => {
    try { await navigator.clipboard.writeText(recoveryCode); setNotice("Recovery code copied. Paste it somewhere safe, away from this device."); }
    catch { setNotice("Select the code and copy it by hand."); }
  };

  // ---- Screens --------------------------------------------------------------------------------
  if (!window.isSecureContext || !window.crypto?.subtle) return <section className="journal-lock paper-sheet"><span className="lock-emblem"><LockKeyhole size={23} /></span><h2>Secure connection needed</h2><p>Open the daybook over HTTPS to use journal encryption on this device. Your journal stays locked until the browser can provide secure encryption.</p></section>;
  if (phase === "loading") return <section className="journal-lock paper-sheet" aria-busy="true"><span className="lock-emblem"><BookOpen size={23} /></span><h2>Opening your journal</h2><p>Checking your journal storage…</p></section>;
  if (phase === "unreachable") return <section className="journal-lock paper-sheet"><span className="lock-emblem"><CloudOff size={23} /></span><h2>Your journal can’t be reached</h2><p>{navigator.onLine ? "Journal storage didn’t respond." : "You’re offline."} Nothing has been changed — this page will keep trying, or you can try again now.</p><div className="journal-auth-form"><button className="primary-button" type="button" onClick={() => { setPhase("loading"); setLoadAttempt((value) => value + 1); }}><RefreshCw size={16} /> Try again</button></div></section>;
  if (phase === "create") return <section className="journal-lock paper-sheet"><span className="lock-emblem"><LockKeyhole size={23} /></span><p className="journal-kicker">A private place, just for you</p><h2>Begin your journal</h2><p>Your pages and private gallery are encrypted in your browser before they are stored, and sync to every device where you unlock them. Choose a passphrase you’ll remember.</p><form className="journal-auth-form" onSubmit={create}><label className="field"><span>Passphrase</span><PasswordInput autoComplete="new-password" value={password} onChange={setPassword} /></label><label className="field"><span>Type it again</span><PasswordInput autoComplete="new-password" value={confirm} onChange={setConfirm} label="confirmation" /></label><p className="journal-footnote">Your passphrase never leaves this device. You’ll get a recovery code next — save it somewhere safe.</p><p className="form-error" role="alert">{error}</p><button className="primary-button" type="submit" disabled={busy}><LockKeyhole size={16} /> {busy ? "Setting up…" : "Create private journal"}</button></form></section>;
  // Pages leave the screen at once; the last edits finish saving behind this.
  if (locking) return <section className="journal-lock paper-sheet" aria-busy="true"><span className="lock-emblem"><LogOut size={23} /></span><h2>Logging out</h2><p>Saving your last changes before the journal locks…</p></section>;
  if (phase === "locked" || !content) return <section className="journal-lock paper-sheet"><span className="lock-emblem"><LockKeyhole size={23} /></span><p className="journal-kicker">Your private journal</p><h2>{resetMode ? "Reset your passphrase" : "Unlock your pages"}</h2>
    {usingDeviceCopy && !resetMode && <p className="journal-footnote">You’re offline, so this opens the copy saved on this device. Changes sync when you’re back online.</p>}
    {unsyncedOnDevice && !resetMode && <p className="journal-footnote">This device has journal changes that haven’t reached the cloud yet. Unlock to send them.</p>}
    {!resetMode
      ? <form className="journal-auth-form" onSubmit={unlock}><label className="field"><span>Passphrase</span><PasswordInput autoComplete="current-password" value={password} onChange={setPassword} autoFocus /></label><p className="form-error" role="alert">{error}</p><button className="primary-button" type="submit" disabled={busy}><UnlockKeyhole size={16} /> {busy ? "Unlocking…" : "Unlock journal"}</button><button className="text-link" type="button" onClick={() => { setResetMode(true); setError(""); setConfirm(""); }}>Forgot passphrase? Use recovery code</button></form>
      : <form className="journal-auth-form" onSubmit={reset}><label className="field"><span>Recovery code</span><input className="input-control" value={recovery} onChange={(event) => setRecovery(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus required /></label><label className="field"><span>New passphrase</span><PasswordInput autoComplete="new-password" value={newPassword} onChange={setNewPassword} /></label><label className="field"><span>Type it again</span><PasswordInput autoComplete="new-password" value={confirm} onChange={setConfirm} label="confirmation" /></label><p className="form-error" role="alert">{error}</p><button className="primary-button" type="submit" disabled={busy}><KeyRound size={16} /> {busy ? "Resetting…" : "Reset passphrase"}</button><button className="text-link" type="button" onClick={() => { setResetMode(false); setError(""); setConfirm(""); }}>Back to unlock</button></form>}
  </section>;

  const pageIndex = Math.max(0, content.pages.findIndex((item) => item.id === pageId));
  const page = content.pages[pageIndex];
  const goToPage = (index: number) => setPageId(content.pages[Math.min(Math.max(index, 0), content.pages.length - 1)]?.id ?? null);
  const updatePage = (text: string) => { const id = page.id; edit((current) => ({ ...current, pages: current.pages.map((item) => item.id === id ? { ...item, text, updatedAt: Date.now() } : item) })); };
  const addPage = () => {
    const last = content.pages[content.pages.length - 1];
    if (last && !last.text.trim()) { setPageId(last.id); return; }
    const fresh = { id: crypto.randomUUID(), text: "", updatedAt: Date.now() };
    edit((current) => ({ ...current, pages: [...current.pages, fresh] }));
    setPageId(fresh.id);
  };
  const offline = status === "offline", failed = status === "error";
  const statusLabel = offline ?"Offline — saved on this device" : failed ? "Not synced yet — retrying" : status === "saving" ? "Saving privately…" : "Saved privately";

  return <div className="journal-workspace">
    {recoveryCode && <section className="recovery-card paper-sheet"><div><span className="journal-kicker">Save this recovery code</span><h2>Keep a way back in</h2><p>If you forget your passphrase, this code is the only way to open the journal. Save it somewhere separate from this device — it won’t be shown again.</p><code>{recoveryCode}</code></div><button className="soft-button" onClick={() => void copyRecoveryCode()}><Copy size={16} /> Copy code</button><button className="soft-button" onClick={() => setRecoveryCode("")}>I’ve saved it</button><button className="icon-button" onClick={() => setRecoveryCode("")} aria-label="Close recovery code"><X size={18} /></button></section>}
    <div className="journal-toolbar"><div className="journal-save-state">{offline || failed ? <CloudOff size={15} /> : <LockKeyhole size={15} />}<span>{statusLabel}</span>{(offline || failed) && <button className="text-link" type="button" onClick={() => void runSync(true)}>Retry now</button>}</div><div className="journal-tools"><AddPhotoButton busy={photoBusy} busyLabel="Adding photo…" iconSize={16} onPick={(file) => void addPhoto(file)} onPickerOpen={holdOpenForPicker} /><button className="quiet-button" onClick={() => { setChangingPassword(!changingPassword); setNewPassword(""); setConfirm(""); setError(""); }}><KeyRound size={15} /> Passphrase</button><button className="quiet-button" onClick={() => void lock()}><LogOut size={15} /> Log out</button></div></div>
    {changingPassword && <form className="password-change paper-sheet" onSubmit={change}><div><strong>Change your passphrase</strong><span>At least {MIN_PASSPHRASE} characters. Your recovery code stays the same.</span></div><PasswordInput autoComplete="new-password" value={newPassword} onChange={setNewPassword} placeholder="New passphrase" /><PasswordInput autoComplete="new-password" value={confirm} onChange={setConfirm} placeholder="Type it again" label="confirmation" /><button className="soft-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save passphrase"}</button></form>}
    {(error || notice) && <p className={`journal-flash ${error ? "has-error" : ""}`} role={error ? "alert" : "status"}>{error || notice}</p>}
    <section className="sticky-note paper-sheet"><div className="sticky-note-heading"><span className="sticky-pin"/><div><span className="journal-kicker">Post-it</span><strong>Keep one thought in front</strong></div><small>Private and encrypted</small></div><textarea aria-label="Your private post-it note" maxLength={400} value={content.stickyNote ?? ""} onChange={(event) => { const value = event.target.value; edit((current) => ({ ...current, stickyNote: value, stickyNoteUpdatedAt: Date.now() })); }} placeholder="One thing to remember…" rows={2}/></section>
    <section className="journal-paper paper-sheet" aria-label="Journal page"><div className="paper-page-top"><span>DAYBOOK · PERSONAL NOTES</span><span>{String(pageIndex + 1).padStart(2, "0")}</span></div><textarea aria-label={`Journal page ${pageIndex + 1}`} className="freeflow-page" value={page?.text ?? ""} onBlur={() => void runSync(false)} onChange={(event) => updatePage(event.target.value)} placeholder="Let your thoughts find their own shape…" spellCheck /><div className="paper-page-bottom"><span>Write freely. This page has no date or prompt.</span><div className="page-turn"><button className="icon-button" disabled={pageIndex === 0} onClick={() => goToPage(pageIndex - 1)} aria-label="Previous page"><ChevronLeft size={18} /></button><span>Page {pageIndex + 1} of {content.pages.length}</span><button className="icon-button" disabled={pageIndex === content.pages.length - 1} onClick={() => goToPage(pageIndex + 1)} aria-label="Next page"><ChevronRight size={18} /></button><button className="soft-button page-add" onClick={addPage}><Plus size={15} /> New page</button></div></div></section>
    <section className="photo-gallery paper-sheet"><div className="gallery-heading"><span className="lock-emblem"><Camera size={18} /></span><div><h2>Private photo gallery</h2><p>Pictures are separate from your writing and encrypted before upload.</p></div><AddPhotoButton busy={photoBusy} busyLabel="Adding…" iconSize={15} onPick={(file) => void addPhoto(file)} onPickerOpen={holdOpenForPicker} /></div>
      {content.photos.length ? <div className="gallery-grid">{content.photos.map((photo) => {
        const source = photo.image ?? photoUrls[photo.id];
        return <figure className="gallery-photo" key={photo.id}>{source && source !== MISSING_PHOTO ? <img src={source} alt={photo.label || "Private gallery photo"} /> : <div className="gallery-photo-placeholder" aria-label={source === MISSING_PHOTO ? "Photo unavailable" : "Loading photo"}>{source === MISSING_PHOTO ? <><ImageOff size={20} /><span>Photo unavailable</span></> : <span>Decrypting…</span>}</div>}<div><input aria-label="Photo label" value={photo.label} maxLength={120} onChange={(event) => { const label = event.target.value; edit((current) => ({ ...current, photos: current.photos.map((item) => item.id === photo.id ? { ...item, label, labelUpdatedAt: Date.now() } : item) })); }} /><button className="row-delete" onClick={() => removePhoto(photo.id)} aria-label="Remove photo"><Trash2 size={15} /></button></div></figure>;
      })}</div> : <div className="gallery-empty"><Camera size={19} /><span>Photos you add will live here, separate from your pages.</span></div>}
    </section>
  </div>;
}
