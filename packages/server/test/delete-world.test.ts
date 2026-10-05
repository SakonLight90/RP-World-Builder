import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { removeWorldDir } from "../src/http/routes.js";

/**
 * Deleting a world must take **everything** belonging to it.
 *
 * The defect this test covers was real: `delete` only touched the database and
 * the world folder stayed behind, with the opencode session inside. A folder
 * without a row is indistinguishable from a freshly created world, and wastes
 * space forever.
 */
async function makeDataDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "delete-world-"));
  await mkdir(join(root, "worlds", "my-world"), { recursive: true });
  await writeFile(join(root, "worlds", "my-world", "gm.md"), "agente\n", "utf8");
  await mkdir(join(root, "worlds", "my-world", ".opencode"), { recursive: true });
  // A shared library: belongs to no world and must not disappear.
  await mkdir(join(root, "lore", "fallout"), { recursive: true });
  await writeFile(join(root, "lore", "fallout", "library.yaml"), "id: fallout\n", "utf8");
  return root;
}

describe("deleting a world", () => {
  it("removes the world folder, nested files included", async () => {
    const data = await makeDataDir();
    const dir = join(data, "worlds", "my-world");

    expect(await removeWorldDir(dir, data)).toBe("removed");
    expect(existsSync(dir)).toBe(false);
  });

  it("leaves the shared library alone", async () => {
    const data = await makeDataDir();
    await removeWorldDir(join(data, "worlds", "my-world"), data);
    expect(existsSync(join(data, "lore", "fallout", "library.yaml"))).toBe(true);
  });

  it("deletes nothing outside the worlds folder", async () => {
    const data = await makeDataDir();
    // A historic or hand-entered directory pointing elsewhere: refused here,
    // because `opencodeDir` comes from the database and this function does recursive `rm`.
    const outside = join(data, "lore", "fallout");
    expect(await removeWorldDir(outside, data)).toBe("outside");
    expect(existsSync(outside)).toBe(true);
  });

  it("doesn't delete the worlds root even if passed in", async () => {
    const data = await makeDataDir();
    expect(await removeWorldDir(join(data, "worlds"), data)).toBe("outside");
    expect(existsSync(join(data, "worlds", "my-world"))).toBe(true);
  });

  it("doesn't delete the database nor the data root", async () => {
    const data = await makeDataDir();
    await writeFile(join(data, "rpwb.db"), "sqlite\n", "utf8");
    expect(await removeWorldDir(data, data)).toBe("outside");
    expect(existsSync(join(data, "rpwb.db"))).toBe(true);
  });

  it("an already missing folder is not an error", async () => {
    const data = await makeDataDir();
    // The server may have already removed everything, or the world never wrote.
    // "It wasn't there" is a result the API must accept without failing.
    expect(await removeWorldDir(join(data, "worlds", "inesistente"), data)).toBe("removed");
  });
});
