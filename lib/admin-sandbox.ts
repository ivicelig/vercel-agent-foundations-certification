import { Sandbox } from "@vercel/sandbox";

/**
 * The admin agent's persistent sandbox.
 *
 * One named sandbox holds both computation and memory, so the memory file and
 * the commands that analyse data live in the same persistent environment.
 * Only the filesystem survives a stop; the sandbox auto-resumes on the next
 * command. Server-only: nothing here may be imported by a client component.
 */

export const SANDBOX_NAME = "ship-it-shop-admin";
export const WORK_DIR = "/vercel/sandbox";
/** The memory file. Absolute path: commands do not start in WORK_DIR. */
export const MEMORY_PATH = `${WORK_DIR}/memory/MEMORY.md`;

/** Commands may run this long before they are cut off. */
const COMMAND_TIMEOUT_MS = 60_000;
/** A session lives this long; a stopped sandbox resumes on the next command. */
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_OUTPUT_CHARS = 8_000;
export const MAX_MEMORY_CHARS = 20_000;

const MEMORY_HEADER = `# Admin agent memory

Saved employee preferences, corrections and business context.
Store data is NOT kept here: always fetch current numbers with the tools.

`;

/**
 * Get (or create) the admin sandbox.
 *
 * - `persistent: true` snapshots the filesystem on stop, so memory survives.
 * - `networkPolicy: "deny-all"`: the code the model writes cannot reach the
 *   internet, so it cannot send data out or fetch anything. Data goes in
 *   through files the application writes, never through the network.
 * - No environment variables are passed in, so no credential is present in
 *   the VM for that code to read.
 */
export async function getAdminSandbox(): Promise<Sandbox> {
  return Sandbox.getOrCreate({
    name: SANDBOX_NAME,
    persistent: true,
    resources: { vcpus: 1 },
    timeout: SESSION_TIMEOUT_MS,
    networkPolicy: "deny-all",
    onCreate: async (sandbox) => {
      await sandbox.runCommand("bash", [
        "-c",
        `mkdir -p ${WORK_DIR}/memory ${WORK_DIR}/data`,
      ]);
    },
  });
}

function clip(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… [output truncated at ${MAX_OUTPUT_CHARS} characters]`
    : text;
}

export interface CommandOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Run one shell command in the sandbox. `runCommand` has no shell of its own,
 * so the command goes through `bash -c`. A non-zero exit code is returned, not
 * thrown, so the agent can read the error and try again.
 */
export async function runBash(command: string): Promise<CommandOutcome> {
  const sandbox = await getAdminSandbox();
  // Two layers, because each alone is not enough (measured against a real
  // sandbox):
  //  1. coreutils `timeout` ends the command on time (SIGTERM, then SIGKILL
  //     after a grace period) and the call returns promptly.
  //  2. `timeoutMs` is the backstop enforced by the sandbox. On its own it
  //     only returned after the child finished (a 3 s limit took 11.9 s).
  // The command is passed through an environment variable and expanded by the
  // outer shell, so no quoting of the model's text is needed.
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-c",
      `timeout -k 2 ${COMMAND_TIMEOUT_MS / 1000} bash -c "$ADMIN_COMMAND"`,
    ],
    env: { ADMIN_COMMAND: command },
    cwd: WORK_DIR,
    timeoutMs: COMMAND_TIMEOUT_MS + 15_000,
  });
  const killed = result.exitCode === 124 || result.exitCode === 137;
  return {
    exitCode: result.exitCode,
    stdout: clip(await result.stdout()),
    stderr: killed
      ? `${clip(await result.stderr())}\nThe command was stopped after ${COMMAND_TIMEOUT_MS / 1000} seconds.`.trim()
      : clip(await result.stderr()),
    timedOut: killed,
  };
}

/** Write a JSON dataset into the sandbox so commands can analyse it. */
export async function writeDataFile(
  name: string,
  data: unknown,
): Promise<string> {
  if (!/^[a-z0-9][a-z0-9_.-]{0,60}\.json$/i.test(name)) {
    throw new Error("Invalid data file name");
  }
  const sandbox = await getAdminSandbox();
  const path = `${WORK_DIR}/data/${name}`;
  await sandbox.writeFiles([
    { path, content: Buffer.from(JSON.stringify(data)) },
  ]);
  return path;
}

/** Read the memory file. A missing file means a fresh start, not an error. */
export async function readMemory(): Promise<string> {
  const sandbox = await getAdminSandbox();
  const buf = await sandbox.readFileToBuffer({ path: MEMORY_PATH });
  return buf ? buf.toString("utf8") : "";
}

/** Append one note to the memory file, creating the file on first use. */
export async function appendMemory(note: string): Promise<{ size: number }> {
  const sandbox = await getAdminSandbox();
  const existing = await sandbox.readFileToBuffer({ path: MEMORY_PATH });
  const current = existing ? existing.toString("utf8") : MEMORY_HEADER;
  const stamp = new Date().toISOString().slice(0, 10);
  const next = `${current.trimEnd()}\n- (${stamp}) ${note.replace(/\s*\n\s*/g, " ").trim()}\n`;
  if (next.length > MAX_MEMORY_CHARS) {
    throw new Error(
      "The memory file is full. Ask an administrator to prune it before saving more.",
    );
  }
  await sandbox.writeFiles([
    { path: MEMORY_PATH, content: Buffer.from(next) },
  ]);
  return { size: next.length };
}
