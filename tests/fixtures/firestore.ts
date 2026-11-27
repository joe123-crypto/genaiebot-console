/**
 * An in-memory Firestore, enough for the registry and the one seeded document.
 *
 * `tests/workspace.test.ts` has a smaller one of its own that supports only
 * `get` and transactional `create`; provisioning also needs `update`, `create`
 * on a subcollection, and reads inside a transaction, so this is the shared one.
 * Paths are flat strings, which is all the code under test ever builds.
 *
 * Mock `@/src/lib/firebase-admin` with `db`, and import the module under test
 * dynamically inside the test: `vi.mock` is hoisted above this file's import, so
 * a static import of the module under test could reach the factory first.
 */

export type Doc = Record<string, unknown>;

export type FirestoreFake = ReturnType<typeof firestoreFake>;

export function firestoreFake() {
  const store = new Map<string, Doc>();
  const state = { failing: false, reads: 0, writes: 0 };

  /** Firestore's own ALREADY_EXISTS, which the seeding step reads off `code`. */
  const alreadyExists = () => Object.assign(new Error("already exists"), { code: 6 });

  function snapshot(path: string) {
    const data = store.get(path);
    return {
      exists: data !== undefined,
      data: () => (data === undefined ? undefined : { ...data }),
      get: (field: string) => data?.[field],
    };
  }

  function reference(path: string) {
    return {
      path,
      collection: (name: string) => ({ doc: (id: string) => reference(`${path}/${name}/${id}`) }),
      async get() {
        state.reads++;
        if (state.failing) throw new Error("firestore down");
        return snapshot(path);
      },
      async create(data: Doc) {
        if (state.failing) throw new Error("firestore down");
        if (store.has(path)) throw alreadyExists();
        state.writes++;
        store.set(path, { ...data });
      },
      async set(data: Doc) {
        if (state.failing) throw new Error("firestore down");
        state.writes++;
        store.set(path, { ...data });
      },
      async update(data: Doc) {
        if (state.failing) throw new Error("firestore down");
        if (!store.has(path)) throw new Error("no such document");
        state.writes++;
        store.set(path, { ...store.get(path), ...data });
      },
    };
  }

  type Reference = ReturnType<typeof reference>;

  /** A dotted field path read out of a stored document, as Firestore does. */
  const fieldAt = (data: Doc, path: string): unknown =>
    path.split(".").reduce<unknown>((value, key) =>
      value && typeof value === "object" ? (value as Doc)[key] : undefined, data);

  /** Equality queries on one top-level collection: all the code under test runs. */
  function where(name: string, path: string, op: string, expected: unknown) {
    if (op !== "==") throw new Error(`the fake supports == only, not ${op}`);
    return {
      async get() {
        state.reads++;
        if (state.failing) throw new Error("firestore down");
        const docs = [...store.entries()]
          .filter(([key, data]) => key.startsWith(`${name}/`) && !key.slice(name.length + 1).includes("/")
            && fieldAt(data, path) === expected)
          .map(([key, data]) => ({ id: key.slice(name.length + 1), data: () => ({ ...data }),
                                   get: (field: string) => fieldAt(data, field) }));
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    };
  }

  const db = {
    collection: (name: string) => ({
      doc: (id: string) => reference(`${name}/${id}`),
      where: (path: string, op: string, expected: unknown) => where(name, path, op, expected),
    }),
    async runTransaction<T>(body: (transaction: unknown) => Promise<T>): Promise<T> {
      if (state.failing) throw new Error("firestore down");
      const staged = new Map<string, Doc>();
      const transaction = {
        get: async (target: Reference) => {
          state.reads++;
          const pending = staged.get(target.path);
          return pending === undefined ? snapshot(target.path) : {
            exists: true, data: () => ({ ...pending }), get: (field: string) => pending[field],
          };
        },
        create: (target: Reference, data: Doc) => {
          if (store.has(target.path) || staged.has(target.path)) throw alreadyExists();
          staged.set(target.path, { ...data });
        },
        set: (target: Reference, data: Doc) => { staged.set(target.path, { ...data }); },
        update: (target: Reference, data: Doc) => {
          const base = staged.get(target.path) ?? store.get(target.path);
          if (base === undefined) throw new Error("no such document");
          staged.set(target.path, { ...base, ...data });
        },
      };
      const result = await body(transaction);
      for (const [path, data] of staged) { state.writes++; store.set(path, data); }
      return result;
    },
  };

  return {
    db,
    put(path: string, data: Doc) { store.set(path, { ...data }); },
    read(path: string): Doc | undefined { const data = store.get(path); return data && { ...data }; },
    has(path: string) { return store.has(path); },
    paths() { return [...store.keys()]; },
    reset() { store.clear(); state.failing = false; state.reads = 0; state.writes = 0; },
    fail(failing: boolean) { state.failing = failing; },
    counts() { return { reads: state.reads, writes: state.writes }; },
  };
}
