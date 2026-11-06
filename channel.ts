// Anywhere Hermes can already send. One program, the credentials its gateway already holds: iMessage, WeChat,
// Telegram and the rest need no account of their own.
// Words and a link, no buttons — register the channel with "links": true so the link itself answers that one card.
//   rules.json:  "channels": { "wechat": { "name": "微信" }, "imessage": { "name": "iMessage" } }
//   config.json: "channels": { "wechat": { "use": "hermes-channel", "target": "weixin", "key": "…" } }
// A target is whatever `hermes send --list` printed: a bare platform for its home chat, or platform:chat_id.
import { execFileSync, spawn } from "node:child_process";

type Card = {
  id: number;
  version: number;
  ref: string | null;
  title: string;
  text: string;
  options: string[];
  state: string;
  link: string | null;
};
type Context = {
  hub: {
    nextCard(wait: number): Promise<{ card: Card | null }>;
    delivered(card: number, version: number, ref: string | null): Promise<unknown>;
    failed(card: number, version: number, error: string): Promise<unknown>;
  };
  options: Record<string, unknown>;
  log: (line: string) => void;
  signal: AbortSignal;
};

/** Heard through a login shell, the way an agent is found: a launchd PATH is smaller than a person's. */
const found = new Map<string, string>();
function findProgram(name: string) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`not a program name: ${name}`);
  const seen = found.get(name);
  if (seen) return seen;
  let onPath: string | null = null;
  try {
    const printed = execFileSync(process.env.SHELL ?? "/bin/sh", ["-lc", `command -v ${name}`], {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    onPath = printed.trim().split("\n").at(-1) || null;
  } catch {}
  if (!onPath) throw new Error(`${name} not found: install it and log in on this machine`);
  found.set(name, onPath);
  return onPath;
}

/** Sends as `hermes send` does, with the words on stdin: a card can be longer than an argument should be. */
function send(program: string, args: string[], input: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim() || `${program} exited with ${code}`)),
    );
    // A program that stops reading early is a failed send, not a crash of the hub.
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** Chats cut long messages; what is left of one is better than a send that fails. */
const BODY_MAX = 3500;

function words(card: Card) {
  const choices = card.options.map((option, index) => `${index + 1}. ${option}`).join("\n");
  const parts = [card.text, ...(card.state === "open" ? [choices, card.link] : [])];
  const body = parts.filter(Boolean).join("\n\n");
  return [...body].length > BODY_MAX ? `${[...body].slice(0, BODY_MAX).join("")}…` : body;
}

export default async function hermesChannel({ hub, options, log, signal }: Context) {
  const target = String(options.target ?? "").trim();
  if (!target) throw new Error('this channel needs a target: what `hermes send --list` calls it');
  const program = options.program ? String(options.program) : findProgram("hermes");
  while (!signal.aborted) {
    let card: Card | null;
    try {
      ({ card } = await hub.nextCard(50));
    } catch (error) {
      log(`couldn't reach the hub: ${error}`);
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      continue;
    }
    if (!card) continue;
    // A message already sent is not sent again: a chat cannot edit it, so an update has nothing to do.
    if (card.ref) {
      await hub.delivered(card.id, card.version, card.ref);
      continue;
    }
    try {
      // `--file -` is how `hermes send` reads the body from stdin; a positional "-" is sent as the word "-".
      await send(program, ["send", "--to", target, "--subject", card.title, "--file", "-"], words(card));
      // Shutting down is not the card's failure: the person just didn't hear about this one.
      if (signal.aborted) return;
      await hub.delivered(card.id, card.version, `hermes-${card.id}`);
    } catch (error) {
      if (signal.aborted) return;
      log(`card ${card.id} not sent: ${error}`);
      await hub.failed(card.id, card.version, String(error)).catch(() => {});
    }
  }
}
