import type { LoreDescriptor } from "../layout.js";
import type { LoreProvider } from "../provider.js";
import { legacyDescriptor, recordList } from "./record-list.js";
import { yamlRecords } from "./yaml-records.js";

/**
 * Which adapter can read which format.
 *
 * It is the only place where formats are registered, and it is a table: adding one
 * is not a change to the engine, it is one more row. The server core only asks
 * for `providerFor` and receives a `LoreProvider`.
 */

/** Format used when the library declares no `layout`. */
export const DEFAULT_ADAPTER = "record-list";

const ADAPTERS: Record<string, (layout: LoreDescriptor) => LoreProvider> = {
  [DEFAULT_ADAPTER]: recordList,
  "yaml-records": yamlRecords,
};

/**
 * An adapter that reads nothing.
 *
 * It is needed when a library declares a format this version of the server cannot
 * read. A library that says nothing is better than a library read with the wrong
 * format: in the first case you can see an adapter is missing, in the second you
 * see names taken from the wrong file, which is the flaw this refactor wants to
 * eliminate.
 */
function unreadable(layout: LoreDescriptor): LoreProvider {
  return {
    id: "unreadable",
    layout,
    kinds: () => [],
    readIndex: async () => [],
    readEntry: async () => {
      throw new Error(`Unsupported library format: ${layout.adapter}`);
    },
    isPrimary: () => false,
    searchKeys: () => [],
    isUsefulName: () => false,
  };
}

export function providerFor(layout: LoreDescriptor | null): LoreProvider {
  // Without `layout` it is read with the historical format: its declaration carries
  // `DEFAULT_ADAPTER`, so it lands in the right row of the table.
  const descriptor = layout ?? legacyDescriptor();
  const build = ADAPTERS[descriptor.adapter];
  if (build === undefined) return unreadable(descriptor);
  return build(descriptor);
}
