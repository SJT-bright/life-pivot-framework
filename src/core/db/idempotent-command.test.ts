import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  IdempotentCommandConflictError,
  IdempotentCommandIntegrityError,
  IdempotentCommandSerializationError,
  IdempotentCommandTransactionError,
  runIdempotentCommand,
} from "./idempotent-command";

const databases: Database.Database[] = [];

function setup() {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  sqlite.exec(`
    create table idempotency_keys (
      key text primary key not null,
      operation text not null,
      request_hash text not null,
      response_json text not null,
      created_at text not null
    )
  `);
  return sqlite;
}

function options(key = "idempotency-key-0001") {
  return {
    operation: "planning.command",
    idempotencyKey: key,
    now: () => new Date("2026-08-10T01:02:03.000Z"),
  };
}

function compileTimeSynchronousExecuteContract(sqlite: Database.Database): void {
  // @ts-expect-error Idempotent command callbacks cannot return a Promise.
  void runIdempotentCommand(sqlite, options("idempotency-key-types"), { type: "create" }, async () => ({ ok: true }));
}

void compileTimeSynchronousExecuteContract;

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("runIdempotentCommand", () => {
  it("returns the same canonical JSON snapshot for an initial command and a reordered replay", async () => {
    const sqlite = setup();
    let executions = 0;

    const first = await runIdempotentCommand(
      sqlite,
      options(),
      { command: { z: 2, a: 1 }, type: "create" },
      () => {
        executions += 1;
        return { result: { z: 2, a: 1 }, created: true };
      },
    );
    const replay = await runIdempotentCommand(
      sqlite,
      options(),
      { type: "create", command: { a: 1, z: 2 } },
      () => {
        throw new Error("a replay must not execute its command");
      },
    );

    expect(executions).toBe(1);
    expect(first).toEqual({ created: true, result: { a: 1, z: 2 } });
    expect(replay).toEqual(first);
    expect(JSON.stringify(first)).toBe('{"created":true,"result":{"a":1,"z":2}}');
    expect(sqlite.prepare("select response_json from idempotency_keys").pluck().get()).toBe(
      JSON.stringify(first),
    );
  });

  it("uses typed conflicts for a reused key with a different operation or payload", async () => {
    const sqlite = setup();
    await runIdempotentCommand(sqlite, options(), { type: "create", id: "goal-0001" }, () => ({ ok: true }));

    await expect(
      runIdempotentCommand(
        sqlite,
        { ...options(), operation: "planning.other-command" },
        { type: "create", id: "goal-0001" },
        () => ({ ok: false }),
      ),
    ).rejects.toBeInstanceOf(IdempotentCommandConflictError);
    await expect(
      runIdempotentCommand(
        sqlite,
        options(),
        { type: "create", id: "goal-0002" },
        () => ({ ok: false }),
      ),
    ).rejects.toBeInstanceOf(IdempotentCommandConflictError);
    expect(sqlite.prepare("select count(*) from idempotency_keys").pluck().get()).toBe(1);
  });

  // A durable replay record must be both parseable and exactly canonical JSON.
  it("fails closed when a stored response is malformed or parseable but noncanonical", async () => {
    const sqlite = setup();
    await runIdempotentCommand(sqlite, options(), { type: "create" }, () => ({ a: 1, z: 2 }));
    sqlite.prepare("update idempotency_keys set response_json = ?").run("{");

    await expect(
      runIdempotentCommand(sqlite, options(), { type: "create" }, () => ({ ok: false })),
    ).rejects.toBeInstanceOf(IdempotentCommandIntegrityError);

    sqlite.prepare("update idempotency_keys set response_json = ?").run('{"z":2,"a":1}');
    await expect(
      runIdempotentCommand(sqlite, options(), { type: "create" }, () => ({ ok: false })),
    ).rejects.toBeInstanceOf(IdempotentCommandIntegrityError);
  });

  it("rejects nested transactions, non-JSON values, and asynchronous execute functions before persistence", async () => {
    const sqlite = setup();
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      await expect(
        runIdempotentCommand(sqlite, options(), { type: "create" }, () => ({ ok: true })),
      ).rejects.toBeInstanceOf(IdempotentCommandTransactionError);
    } finally {
      sqlite.exec("ROLLBACK");
    }

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    await expect(
      runIdempotentCommand(sqlite, options("idempotency-key-0002"), cyclic, () => ({ ok: true })),
    ).rejects.toBeInstanceOf(IdempotentCommandSerializationError);
    await expect(
      runIdempotentCommand(
        sqlite,
        options("idempotency-key-0003"),
        { type: "create" },
        () => Promise.resolve({ ok: true }) as unknown as { ok: boolean },
      ),
    ).rejects.toBeInstanceOf(IdempotentCommandTransactionError);
    expect(sqlite.prepare("select count(*) from idempotency_keys").pluck().get()).toBe(0);
  });

  it("rejects a declared async execute function before it can perform command work", async () => {
    const sqlite = setup();
    let invoked = false;
    const execute = async () => {
      invoked = true;
      return { ok: true };
    };

    await expect(
      runIdempotentCommand(
        sqlite,
        options(),
        { type: "create" },
        execute as unknown as () => { ok: boolean },
      ),
    ).rejects.toBeInstanceOf(IdempotentCommandTransactionError);

    expect(invoked).toBe(false);
    expect(sqlite.prepare("select count(*) from idempotency_keys").pluck().get()).toBe(0);
  });

  it("fails closed for sparse arrays and arrays with unrepresented own properties", async () => {
    const sqlite = setup();
    const sparse = new Array<unknown>(1);
    const holeThenValue = new Array<unknown>(2);
    holeThenValue[1] = "value";
    const withExtraProperty = ["value"] as string[] & { extra?: string };
    withExtraProperty.extra = "not JSON array content";
    const withSymbolProperty = ["value"] as string[] & { [key: symbol]: string };
    withSymbolProperty[Symbol("extra")] = "not JSON array content";

    for (const [index, input] of [
      sparse,
      holeThenValue,
      withExtraProperty,
      withSymbolProperty,
    ].entries()) {
      await expect(
        runIdempotentCommand(
          sqlite,
          options(`idempotency-key-array-${index}`),
          input,
          () => ({ ok: true }),
        ),
      ).rejects.toBeInstanceOf(IdempotentCommandSerializationError);
    }

    expect(sqlite.prepare("select count(*) from idempotency_keys").pluck().get()).toBe(0);
  });

  // A rejected result must undo callback writes and leave the key retryable.
  it("rolls back callback writes when a sparse response value cannot be serialized", async () => {
    const sqlite = setup();
    sqlite.exec("create table command_writes (value text not null)");
    const sparse = new Array<string>(1);
    const key = "idempotency-key-result-rollback";

    await expect(
      runIdempotentCommand(
        sqlite,
        options(key),
        { type: "create" },
        () => {
          sqlite.prepare("insert into command_writes (value) values (?)").run("must roll back");
          return { values: sparse } as unknown as { values: readonly string[] };
        },
      ),
    ).rejects.toBeInstanceOf(IdempotentCommandSerializationError);

    expect(sqlite.prepare("select count(*) from command_writes").pluck().get()).toBe(0);
    expect(sqlite.prepare("select count(*) from idempotency_keys").pluck().get()).toBe(0);

    const retried = await runIdempotentCommand(
      sqlite,
      options(key),
      { type: "create" },
      () => {
        sqlite.prepare("insert into command_writes (value) values (?)").run("retry succeeds");
        return { values: ["stable"] };
      },
    );

    expect(retried).toEqual({ values: ["stable"] });
    expect(sqlite.prepare("select count(*) from command_writes").pluck().get()).toBe(1);
    expect(sqlite.prepare("select count(*) from idempotency_keys").pluck().get()).toBe(1);
  });

  it("does not invoke an async execute function whose public type tag is spoofed", async () => {
    const sqlite = setup();
    sqlite.exec("create table side_effects (value text not null)");
    let invoked = false;
    const execute = async () => {
      invoked = true;
      await Promise.resolve();
      sqlite.prepare("insert into side_effects (value) values ('late write')").run();
      return { ok: true };
    };
    Object.defineProperty(execute, Symbol.toStringTag, { value: "Function" });

    await expect(
      runIdempotentCommand(
        sqlite,
        options(),
        { type: "create" },
        execute as unknown as () => { ok: boolean },
      ),
    ).rejects.toBeInstanceOf(IdempotentCommandTransactionError);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(invoked).toBe(false);
    expect(sqlite.prepare("select count(*) from side_effects").pluck().get()).toBe(0);
    expect(sqlite.prepare("select count(*) from idempotency_keys").pluck().get()).toBe(0);
  });
});
