// What these cover: the arguments `hermes send` is given, the words it gets on stdin, what is reported for a card
// already sent, a send that fails, and a channel with no target. They do not cover the hub: a context is passed in.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import hermesChannel from "../channel.ts";

const scratch = mkdtempSync(join(tmpdir(), "hermes-channel-"));
after(() => assert.ok(existsSync(scratch)));

/** Stands in for the real program: keeps the arguments and whatever came in on stdin. */
function fakeProgram(name: string, exit = 0, stderr = "") {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "hermes");
  const args = join(dir, "args.txt");
  const body = join(dir, "body.txt");
  writeFileSync(
    file,
    [
      "#!/bin/sh",
      `printf "%s\\n" "$@" > "${args}"`,
      `cat > "${body}"`,
      stderr ? `printf "%s" "${stderr}" >&2` : "",
      `exit ${exit}`,
      "",
    ].join("\n"),
  );
  chmodSync(file, 0o755);
  return {
    program: file,
    args: () => readFileSync(args, "utf8").trimEnd().split("\n"),
    body: () => readFileSync(body, "utf8"),
    sent: () => existsSync(body),
  };
}

const card = (over: Record<string, unknown> = {}) => ({
  id: 5,
  version: 1,
  ref: null as string | null,
  title: "要不要删",
  text: "占了 10 GB",
  options: ["删", "留着"],
  state: "open",
  link: "https://example.test/c/5",
  ...over,
});

function context(queue: ReturnType<typeof card>[], sent: unknown[][], failures: unknown[][]) {
  const stop = new AbortController();
  const value = {
    hub: {
      nextCard: async () => {
        const next = queue.shift();
        if (!next) stop.abort();
        return { card: next ?? null };
      },
      delivered: async (...args: unknown[]) => sent.push(args),
      failed: async (...args: unknown[]) => failures.push(args),
    },
    options: {} as Record<string, unknown>,
    log: () => {},
    signal: stop.signal,
  };
  return value as Parameters<typeof hermesChannel>[0];
}

test("sends the card as words on stdin, with the chat as the target", async () => {
  const fake = fakeProgram("ok");
  const sent: unknown[][] = [];
  await hermesChannel({ ...context([card()], sent, []), options: { target: "weixin", program: fake.program } });
  assert.deepEqual(fake.args(), ["send", "--to", "weixin", "--subject", "要不要删", "--file", "-"]);
  const body = fake.body();
  assert.match(body, /占了 10 GB/);
  assert.match(body, /1\. 删/);
  assert.match(body, /2\. 留着/);
  assert.match(body, /https:\/\/example\.test\/c\/5/);
  assert.deepEqual(sent, [[5, 1, "hermes-5"]]);
});

test("cuts what a chat would refuse rather than failing the send", async () => {
  const fake = fakeProgram("long");
  await hermesChannel({
    ...context([card({ text: "长".repeat(4000) })], [], []),
    options: { target: "telegram", program: fake.program },
  });
  const body = fake.body();
  assert.equal([...body].length, 3501);
  assert.ok(body.endsWith("…"));
});

test("leaves a card it has already sent alone", async () => {
  const fake = fakeProgram("update");
  const sent: unknown[][] = [];
  await hermesChannel({
    ...context([card({ version: 2, ref: "hermes-5" })], sent, []),
    options: { target: "weixin", program: fake.program },
  });
  assert.deepEqual(sent, [[5, 2, "hermes-5"]]);
  assert.equal(fake.sent(), false, "an update sends nothing again");
});

test("says so when the program fails", async () => {
  const fake = fakeProgram("fails", 1, "no such chat");
  const failures: unknown[][] = [];
  await hermesChannel({
    ...context([card()], [], failures),
    options: { target: "weixin", program: fake.program },
  });
  assert.equal(failures[0][0], 5);
  assert.match(String(failures[0][2]), /no such chat/);
});

test("a channel without a target says what to write", async () => {
  await assert.rejects(() => hermesChannel({ ...context([], [], []), options: {} }), /hermes send --list/);
});
