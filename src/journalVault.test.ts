import { describe, expect, it } from "vitest";
import { changePassword, createVault, openVault, resetPassword, sealContent } from "./journalVault";

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
});
