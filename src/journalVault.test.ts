import { describe, expect, it } from "vitest";
import { baseOf, changePassword, createVault, decryptPhoto, deriveWriteToken, encryptPhoto, mergeJournalContent, normalizeContent, openVault, RECOVERED_PAGE_HEADING, recoveryCandidates, resetPassword, sameJournal, sealContent } from "./journalVault";

const sample = () => ({ pages: [{ id: "p1", text: "hello", updatedAt: 1 }], photos: [], stickyNote: "note" });

describe("journal vault", () => {
  it("creates a journal that opens with its passphrase", async () => {
    const created = await createVault("first passphrase", sample());
    const opened = await openVault(created.envelope, "first passphrase");
    expect(opened.content.pages[0].text).toBe("hello");
    await expect(openVault(created.envelope, "wrong passphrase")).rejects.toThrow();
  });

  it("saves edits, changes the passphrase, and resets with the recovery code", async () => {
    const created = await createVault("first passphrase", sample());
    const saved = await sealContent({ ...sample(), stickyNote: "edited" }, created.key, created.envelope);
    const changed = await changePassword(saved, created.key, "second passphrase");
    expect((await openVault(changed, "second passphrase")).content.stickyNote).toBe("edited");
    const reset = await resetPassword(changed, created.code.toLowerCase(), "third passphrase");
    expect((await openVault(reset.envelope, "third passphrase")).content.stickyNote).toBe("edited");
    await expect(resetPassword(reset.envelope, created.code, "x")).rejects.toThrow();
  });

  it("issues recovery codes without look-alike characters and accepts them however they are typed back", async () => {
    const created = await createVault("first passphrase", sample());
    expect(created.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/);
    const handCopied = created.code.toLowerCase().replace(/-/g, " ").replace(/0/g, "o").replace(/1/g, "l");
    const reset = await resetPassword(created.envelope, handCopied, "second passphrase");
    expect((await openVault(reset.envelope, "second passphrase")).content.pages[0].text).toBe("hello");
  });

  it("reads a typed code both the forgiving way and exactly, so codes issued before the new alphabet still work", () => {
    expect(recoveryCandidates("ab0l-iO 9z")).toEqual(["AB01109Z", "AB0LIO9Z"]);
    expect(recoveryCandidates("ABCD-EF23")).toEqual(["ABCDEF23"]);
  });
});

describe("journal write token and photos", () => {
  it("keeps the same write token through passphrase changes and resets, and differs between journals", async () => {
    const created = await createVault("first passphrase", sample());
    const token = await deriveWriteToken(created.key);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    const changed = await changePassword(created.envelope, created.key, "second passphrase");
    expect(await deriveWriteToken((await openVault(changed, "second passphrase")).key)).toBe(token);
    const reset = await resetPassword(changed, created.code, "third passphrase");
    expect(await deriveWriteToken(reset.key)).toBe(token);
    const other = await createVault("first passphrase", sample());
    expect(await deriveWriteToken(other.key)).not.toBe(token);
  });

  it("encrypts photos so only the journal key can read them", async () => {
    const created = await createVault("first passphrase", sample());
    const bytes = new Uint8Array([255, 216, 255, 224, 1, 2, 3, 4]);
    const sealed = await encryptPhoto(created.key, bytes);
    expect(sealed.ciphertext).not.toContain("/9j/");
    expect(Array.from(await decryptPhoto(created.key, sealed.iv, sealed.ciphertext))).toEqual(Array.from(bytes));
    const other = await createVault("first passphrase", sample());
    await expect(decryptPhoto(other.key, sealed.iv, sealed.ciphertext)).rejects.toThrow();
  });

  it("opens older journals that are missing newer fields", async () => {
    const created = await createVault("first passphrase", { pages: [], photos: [] } as never);
    const opened = await openVault(created.envelope, "first passphrase");
    expect(opened.content.pages).toHaveLength(1);
    expect(opened.content.deletedPhotoIds).toEqual([]);
    expect(opened.content.stickyNote).toBe("");
  });
});

describe("merging journal copies from two devices", () => {
  const base = normalizeContent({ pages: [{ id: "a", text: "start", updatedAt: 10 }, { id: "b", text: "two", updatedAt: 10 }], photos: [{ id: "x", label: "Beach", addedAt: 1, labelUpdatedAt: 1, stored: true }], stickyNote: "milk", stickyNoteUpdatedAt: 5 });
  const stamps = baseOf(base);

  it("takes each side's edits when they touched different pages", () => {
    const local = { ...base, pages: [{ id: "a", text: "start + mine", updatedAt: 20 }, base.pages[1]] };
    const remote = { ...base, pages: [base.pages[0], { id: "b", text: "two + theirs", updatedAt: 21 }], stickyNote: "eggs", stickyNoteUpdatedAt: 22 };
    const { content, keptConflicts } = mergeJournalContent(stamps, local, remote);
    expect(keptConflicts).toBe(0);
    expect(content.pages.map((page) => page.text)).toEqual(["start + mine", "two + theirs"]);
    expect(content.stickyNote).toBe("eggs");
  });

  it("keeps both versions when the same page was edited on two devices", () => {
    const local = { ...base, pages: [{ id: "a", text: "mine", updatedAt: 30 }, base.pages[1]] };
    const remote = { ...base, pages: [{ id: "a", text: "theirs", updatedAt: 31 }, base.pages[1]] };
    const { content, keptConflicts } = mergeJournalContent(stamps, local, remote);
    expect(keptConflicts).toBe(1);
    expect(content.pages[0].text).toBe("mine");
    expect(content.pages).toHaveLength(3);
    expect(content.pages[2].text).toContain(RECOVERED_PAGE_HEADING);
    expect(content.pages[2].text).toContain("theirs");
  });

  it("keeps new pages from both devices and never revives a removed photo", () => {
    const local = { ...base, pages: [...base.pages, { id: "c", text: "local page", updatedAt: 40 }], photos: [], deletedPhotoIds: ["x"] };
    const remote = { ...base, pages: [...base.pages, { id: "d", text: "remote page", updatedAt: 41 }], photos: [...base.photos, { id: "y", label: "New", addedAt: 41, labelUpdatedAt: 41, stored: true }] };
    const { content } = mergeJournalContent(stamps, local, remote);
    expect(content.pages.map((page) => page.id)).toEqual(["a", "b", "d", "c"]);
    expect(content.photos.map((photo) => photo.id)).toEqual(["y"]);
    expect(content.deletedPhotoIds).toEqual(["x"]);
  });

  it("uses the most recent photo label", () => {
    const local = { ...base, photos: [{ ...base.photos[0], label: "Sunset", labelUpdatedAt: 50 }] };
    const remote = { ...base, photos: [{ ...base.photos[0], label: "Dunes", labelUpdatedAt: 49 }] };
    expect(mergeJournalContent(stamps, local, remote).content.photos[0].label).toBe("Sunset");
  });

  it("returns the cloud copy unchanged when this device made no edits", () => {
    const remote = { ...base, pages: [{ id: "a", text: "edited elsewhere", updatedAt: 60 }, base.pages[1]], stickyNote: "bread", stickyNoteUpdatedAt: 60 };
    const { content } = mergeJournalContent(stamps, base, remote);
    expect(sameJournal(content, remote)).toBe(true);
  });
});
