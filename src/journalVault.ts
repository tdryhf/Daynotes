export type JournalPage = { id: string; text: string; updatedAt: number };
export type JournalPhoto = { id: string; label: string; image: string; addedAt: number };
export type JournalContent = { pages: JournalPage[]; photos: JournalPhoto[]; stickyNote?: string };
export type JournalEnvelope = {
  passwordSalt: string; passwordIv: string; wrappedKey: string;
  recoverySalt: string; recoveryIv: string; recoveryWrappedKey: string;
  contentIv: string; ciphertext: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const to64 = (bytes: Uint8Array) => { let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)); return btoa(binary); };
const from64 = (value: string) => { const raw = atob(value); const bytes = new Uint8Array(new ArrayBuffer(raw.length)); for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index); return bytes; };
const random = (size: number) => { const bytes = new Uint8Array(new ArrayBuffer(size)); crypto.getRandomValues(bytes); return bytes; };
const encodeCode = (bytes: Uint8Array) => to64(bytes).replace(/[+/=]/g, "").toUpperCase().match(/.{1,4}/g)?.join("-") ?? "";

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
const importDataKey = (raw: ArrayBuffer) => crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);

export const emptyJournal = (): JournalContent => ({ pages: [{ id: crypto.randomUUID(), text: "", updatedAt: Date.now() }], photos: [], stickyNote: "" });

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
  const passwordSalt = random(16), recoverySalt = random(16), code = encodeCode(random(18));
  const [passwordKey, recoveryKey] = await Promise.all([derive(password, passwordSalt), derive(code.replace(/-/g, ""), recoverySalt)]);
  const dataKey = await importDataKey(random(32).buffer as ArrayBuffer);
  return { key: dataKey, code, envelope: await seal(content, dataKey, passwordSalt, passwordKey, recoverySalt, recoveryKey), content };
}

export async function openVault(envelope: JournalEnvelope, password: string) {
  try {
    const passwordKey = await derive(password, from64(envelope.passwordSalt));
    const dataKey = await importDataKey((await decryptBytes(passwordKey, envelope.passwordIv, envelope.wrappedKey)).buffer);
    const saved = JSON.parse(decoder.decode(await decryptBytes(dataKey, envelope.contentIv, envelope.ciphertext))) as JournalContent;
    const content = { ...saved, stickyNote: saved.stickyNote ?? "" };
    return { key: dataKey, content };
  } catch { throw new Error("That passphrase didn’t open the journal. Try again."); }
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
  try {
    const recoveryKey = await derive(code.replace(/-/g, "").toUpperCase(), from64(envelope.recoverySalt));
    const dataKey = await importDataKey((await decryptBytes(recoveryKey, envelope.recoveryIv, envelope.recoveryWrappedKey)).buffer);
    const saved = JSON.parse(decoder.decode(await decryptBytes(dataKey, envelope.contentIv, envelope.ciphertext))) as JournalContent;
    const content = { ...saved, stickyNote: saved.stickyNote ?? "" };
    const passwordSalt = random(16), recoverySalt = random(16), newCode = encodeCode(random(18));
    const [passwordKey, nextRecoveryKey] = await Promise.all([derive(newPassword, passwordSalt), derive(newCode.replace(/-/g, ""), recoverySalt)]);
    const nextEnvelope = await seal(content, dataKey, passwordSalt, passwordKey, recoverySalt, nextRecoveryKey);
    return { key: dataKey, content, code: newCode, envelope: nextEnvelope };
  } catch { throw new Error("That recovery code didn’t match. Use the code saved when the journal was set up."); }
}
