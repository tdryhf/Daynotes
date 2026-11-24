export type JournalPage = { id: string; text: string; updatedAt: number };
/**
 * A photo in the private gallery. New photos are encrypted and stored separately from the journal
 * text (`stored`); very early journals kept the picture inline as a data URL (`image`).
 */
export type JournalPhoto = { id: string; label: string; addedAt: number; labelUpdatedAt?: number; stored?: boolean; image?: string };
export type JournalContent = {
  pages: JournalPage[];
  photos: JournalPhoto[];
  stickyNote?: string;
  stickyNoteUpdatedAt?: number;
  /** Photos removed from the gallery, remembered so another device's older copy can't bring them back. */
  deletedPhotoIds?: string[];
};
export type JournalEnvelope = {
  passwordSalt: string; passwordIv: string; wrappedKey: string;
  recoverySalt: string; recoveryIv: string; recoveryWrappedKey: string;
  contentIv: string; ciphertext: string;
};
/** Edit stamps of the last copy this device saw from the cloud: the common ancestor for a three-way merge. */
export type JournalBase = { pages: Record<string, number>; sticky: number };

/** An error whose message is meant for the person using the journal. */
export class JournalVaultError extends Error {}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const to64 = (bytes: Uint8Array) => { let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)); return btoa(binary); };
const from64 = (value: string) => { const raw = atob(value); const bytes = new Uint8Array(new ArrayBuffer(raw.length)); for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index); return bytes; };
const random = (size: number) => { const bytes = new Uint8Array(new ArrayBuffer(size)); crypto.getRandomValues(bytes); return bytes; };
/** Crockford base32: no I, L, O or U, so a code copied out by hand can't be misread. */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const encodeCode = (bytes: Uint8Array) => {
  let value = 0, bits = 0, out = "";
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) { out += CODE_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += CODE_ALPHABET[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)?.join("-") ?? "";
};
/** 15 random bytes = 120 bits = 24 characters, shown as six groups of four. */
const newRecoveryCode = () => encodeCode(random(15));
const codeSecret = (code: string) => code.replace(/-/g, "");
/**
 * What the person typed, in every form it could have been issued in: the forgiving form
 * (case, spaces and dashes ignored; O read as 0; I and L read as 1) and, for codes issued before
 * the look-alike-free alphabet, exactly as typed apart from case, spaces and dashes.
 */
export const recoveryCandidates = (typed: string) => {
  const plain = typed.replace(/[\s-]/g, "").toUpperCase();
  return [...new Set([plain.replace(/O/g, "0").replace(/[IL]/g, "1"), plain])];
};
const MAX_TOMBSTONES = 1000;

async function derive(secret: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", new Uint8Array(encoder.encode(secret.normalize("NFKC"))), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: new Uint8Array(salt), iterations: 310_000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function encryptBytes(key: CryptoKey, bytes: Uint8Array) {
  const iv = random(12);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, new Uint8Array(bytes));
  return { iv: to64(iv), ciphertext: to64(new Uint8Array(ciphertext)) };
}
async function decryptBytes(key: CryptoKey, iv: string, ciphertext: string) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(from64(iv)) }, key, new Uint8Array(from64(ciphertext))));
}
const exportKey = (key: CryptoKey) => crypto.subtle.exportKey("raw", key);
// Extractable because the data key must be exported to be re-wrapped under the passphrase and recovery keys.
const importDataKey = (raw: ArrayBuffer) => crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);

export const emptyJournal = (): JournalContent => ({ pages: [{ id: crypto.randomUUID(), text: "", updatedAt: Date.now() }], photos: [], stickyNote: "", stickyNoteUpdatedAt: 0, deletedPhotoIds: [] });

/** Fills in fields that older saved journals don't have, so the rest of the app can rely on them. */
export function normalizeContent(saved: Partial<JournalContent> | null | undefined): JournalContent {
  const pages = Array.isArray(saved?.pages) ? saved.pages.filter((page) => page && typeof page.id === "string").map((page) => ({ id: page.id, text: typeof page.text === "string" ? page.text : "", updatedAt: Number(page.updatedAt) || 0 })) : [];
  const photos = Array.isArray(saved?.photos) ? saved.photos.filter((photo) => photo && typeof photo.id === "string") : [];
  return {
    pages: pages.length ? pages : emptyJournal().pages,
    photos,
    stickyNote: typeof saved?.stickyNote === "string" ? saved.stickyNote : "",
    stickyNoteUpdatedAt: Number(saved?.stickyNoteUpdatedAt) || 0,
    deletedPhotoIds: Array.isArray(saved?.deletedPhotoIds) ? saved.deletedPhotoIds.filter((id) => typeof id === "string") : [],
  };
}

async function seal(content: JournalContent, dataKey: CryptoKey, passwordSalt: Uint8Array, passwordKey: CryptoKey, recoverySalt: Uint8Array, recoveryKey: CryptoKey): Promise<JournalEnvelope> {
  const [passwordWrap, recoveryWrap, body] = await Promise.all([
    encryptBytes(passwordKey, new Uint8Array(await exportKey(dataKey))),
    encryptBytes(recoveryKey, new Uint8Array(await exportKey(dataKey))),
    encryptBytes(dataKey, encoder.encode(JSON.stringify(content))),
  ]);
  return {
    passwordSalt: to64(passwordSalt), passwordIv: passwordWrap.iv, wrappedKey: passwordWrap.ciphertext,
    recoverySalt: to64(recoverySalt), recoveryIv: recoveryWrap.iv, recoveryWrappedKey: recoveryWrap.ciphertext,
    contentIv: body.iv, ciphertext: body.ciphertext,
  };
}

export async function createVault(password: string, content = emptyJournal()) {
  const passwordSalt = random(16), recoverySalt = random(16), code = newRecoveryCode();
  const [passwordKey, recoveryKey] = await Promise.all([derive(password, passwordSalt), derive(codeSecret(code), recoverySalt)]);
  const dataKey = await importDataKey(random(32).buffer as ArrayBuffer);
  return { key: dataKey, code, envelope: await seal(content, dataKey, passwordSalt, passwordKey, recoverySalt, recoveryKey), content };
}

/** Decrypts the journal text with an already unlocked data key. */
export async function openContent(key: CryptoKey, envelope: JournalEnvelope) {
  try {
    return normalizeContent(JSON.parse(decoder.decode(await decryptBytes(key, envelope.contentIv, envelope.ciphertext))) as Partial<JournalContent>);
  } catch { throw new JournalVaultError("This journal was replaced on another device. Lock it and unlock it again."); }
}

export async function openVault(envelope: JournalEnvelope, password: string) {
  let dataKey: CryptoKey;
  try {
    const passwordKey = await derive(password, from64(envelope.passwordSalt));
    dataKey = await importDataKey((await decryptBytes(passwordKey, envelope.passwordIv, envelope.wrappedKey)).buffer);
  } catch { throw new JournalVaultError("That passphrase didn’t open the journal. Try again."); }
  return { key: dataKey, content: await openContent(dataKey, envelope) };
}

export async function sealContent(content: JournalContent, key: CryptoKey, envelope: JournalEnvelope) {
  const body = await encryptBytes(key, encoder.encode(JSON.stringify(content)));
  return { ...envelope, contentIv: body.iv, ciphertext: body.ciphertext };
}

export async function changePassword(envelope: JournalEnvelope, key: CryptoKey, password: string) {
  const passwordSalt = random(16), passwordKey = await derive(password, passwordSalt);
  const wrapped = await encryptBytes(passwordKey, new Uint8Array(await exportKey(key)));
  return { ...envelope, passwordSalt: to64(passwordSalt), passwordIv: wrapped.iv, wrappedKey: wrapped.ciphertext };
}

export async function resetPassword(envelope: JournalEnvelope, code: string, newPassword: string) {
  let dataKey: CryptoKey | undefined;
  for (const candidate of recoveryCandidates(code)) {
    try {
      const recoveryKey = await derive(candidate, from64(envelope.recoverySalt));
      dataKey = await importDataKey((await decryptBytes(recoveryKey, envelope.recoveryIv, envelope.recoveryWrappedKey)).buffer);
      break;
    } catch { /* try the next reading of the code */ }
  }
  if (!dataKey) throw new JournalVaultError("That recovery code didn’t match. Use the most recent code this journal gave you.");
  const content = await openContent(dataKey, envelope);
  const passwordSalt = random(16), recoverySalt = random(16), newCode = newRecoveryCode();
  const [passwordKey, nextRecoveryKey] = await Promise.all([derive(newPassword, passwordSalt), derive(codeSecret(newCode), recoverySalt)]);
  const nextEnvelope = await seal(content, dataKey, passwordSalt, passwordKey, recoverySalt, nextRecoveryKey);
  return { key: dataKey, content, code: newCode, envelope: nextEnvelope };
}

/**
 * Proof that this device can unlock the journal, sent with every write. It is derived from the data
 * key, so it never reveals the key or the passphrase, and it stays the same when the passphrase is
 * changed or reset. The server only stores its SHA-256 hash.
 */
export async function deriveWriteToken(key: CryptoKey) {
  const material = await crypto.subtle.importKey("raw", await exportKey(key), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: encoder.encode("daybook-private-journal"), info: encoder.encode("write-token-v1") }, material, 256);
  return to64(new Uint8Array(bits)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const encryptPhoto = (key: CryptoKey, bytes: Uint8Array) => encryptBytes(key, bytes);
export async function decryptPhoto(key: CryptoKey, iv: string, ciphertext: string) {
  try { return await decryptBytes(key, iv, ciphertext); } catch { throw new JournalVaultError("This photo couldn’t be decrypted."); }
}

export const baseOf = (content: JournalContent): JournalBase => ({
  pages: Object.fromEntries(content.pages.map((page) => [page.id, page.updatedAt])),
  sticky: content.stickyNoteUpdatedAt ?? 0,
});

/** True when two journal copies hold the same pages, note, and photos. */
export function sameJournal(a: JournalContent, b: JournalContent) {
  return JSON.stringify(normalizeContent(a)) === JSON.stringify(normalizeContent(b));
}

export const RECOVERED_PAGE_HEADING = "Kept from another device — this page was edited in two places at once, so both versions are saved.";

/**
 * Combines this device's journal (`local`) with a newer copy saved by another device (`remote`).
 * `base` is the cloud copy this device last saw. A page or note changed on only one side takes that
 * side's version. When both sides changed the same page, this device's text stays in place and the
 * other device's text is kept on a new page at the end, so no writing is ever dropped. Photos are
 * combined, and a photo removed on either device stays removed.
 */
export function mergeJournalContent(base: JournalBase | null, local: JournalContent, remote: JournalContent, now = Date.now()) {
  const kept: string[] = [];
  const localPages = new Map(local.pages.map((page) => [page.id, page]));
  const remotePages = new Map(remote.pages.map((page) => [page.id, page]));
  const order = [...remote.pages.map((page) => page.id), ...local.pages.filter((page) => !remotePages.has(page.id)).map((page) => page.id)];
  const pages = order.map((id) => {
    const mine = localPages.get(id), theirs = remotePages.get(id);
    if (!mine) return theirs!;
    if (!theirs) return mine;
    if (mine.text === theirs.text) return mine.updatedAt >= theirs.updatedAt ? mine : theirs;
    const stamp = base?.pages[id];
    const mineChanged = stamp === undefined || mine.updatedAt !== stamp;
    const theirsChanged = stamp === undefined || theirs.updatedAt !== stamp;
    if (!mineChanged) return theirs;
    if (!theirsChanged) return mine;
    if (theirs.text.trim()) kept.push(theirs.text);
    return mine;
  });

  const localSticky = local.stickyNote ?? "", remoteSticky = remote.stickyNote ?? "";
  let stickyNote = localSticky, stickyNoteUpdatedAt = local.stickyNoteUpdatedAt ?? 0;
  if (localSticky !== remoteSticky) {
    const mineChanged = !base || stickyNoteUpdatedAt !== base.sticky;
    const theirsChanged = !base || (remote.stickyNoteUpdatedAt ?? 0) !== base.sticky;
    if (!mineChanged) { stickyNote = remoteSticky; stickyNoteUpdatedAt = remote.stickyNoteUpdatedAt ?? 0; }
    else if (theirsChanged && remoteSticky.trim()) kept.push(`Post-it: ${remoteSticky}`);
  }

  const deleted = [...new Set([...(remote.deletedPhotoIds ?? []), ...(local.deletedPhotoIds ?? [])])].slice(-MAX_TOMBSTONES);
  const gone = new Set(deleted);
  const localPhotos = new Map(local.photos.map((photo) => [photo.id, photo]));
  const remotePhotoIds = new Set(remote.photos.map((photo) => photo.id));
  const photos = [...remote.photos, ...local.photos.filter((photo) => !remotePhotoIds.has(photo.id))]
    .filter((photo) => !gone.has(photo.id))
    .map((photo) => {
      const mine = localPhotos.get(photo.id);
      if (!mine || mine === photo) return photo;
      return (mine.labelUpdatedAt ?? 0) > (photo.labelUpdatedAt ?? 0) ? { ...photo, label: mine.label, labelUpdatedAt: mine.labelUpdatedAt } : photo;
    });

  if (kept.length) pages.push({ id: crypto.randomUUID(), text: `${RECOVERED_PAGE_HEADING}\n\n${kept.join("\n\n———\n\n")}`, updatedAt: now });
  return { content: { pages, photos, stickyNote, stickyNoteUpdatedAt, deletedPhotoIds: deleted } satisfies JournalContent, keptConflicts: kept.length };
}
