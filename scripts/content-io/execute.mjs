import {setTimeout, clearTimeout} from "node:timers";
import {spawn} from "node:child_process";
import {createWriteStream} from "node:fs";
import {finished} from "node:stream/promises";
import {atomicJSON} from "./cli.mjs";
export async function execute(command, logRoot, timeout = 300000) {
  if (!Number.isSafeInteger(timeout) || timeout < 1) throw new Error("CONTENT_IO_TIMEOUT_INVALID");
  const stdoutPath = `${logRoot}.stdout.log`, stderrPath = `${logRoot}.stderr.log`;
  const stdout = createWriteStream(stdoutPath), stderr = createWriteStream(stderrPath);
  const startedAt = new Date().toISOString();
  const exit = await new Promise(resolve => {
    const child = spawn(command.executable, command.args, {cwd: command.cwd, shell: false,
      detached: process.platform !== "win32", env: {...process.env, ...command.env}, stdio: ["ignore", "pipe", "pipe"]});
    let force, timedOut = false;
    const stop = signal => {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) {if (error.code !== "ESRCH") throw error;}
    };
    const timer = setTimeout(() => {
      timedOut = true; stop("SIGTERM");
      force = setTimeout(() => stop("SIGKILL"), 250); force.unref();
    }, timeout);
    timer.unref();
    child.stdout.pipe(stdout); child.stderr.pipe(stderr);
    const clear = () => {clearTimeout(timer); clearTimeout(force);};
    child.once("error", error => {clear(); resolve({exitCode: null, signal: null, error: error.message, timedOut});});
    child.once("close", (exitCode, signal) => {clear(); resolve({exitCode, signal, timedOut});});
  });
  await Promise.all([finished(stdout), finished(stderr)]);
  const record = {...command, stdoutPath, stderrPath, startedAt, finishedAt: new Date().toISOString(), ...exit};
  await atomicJSON(`${logRoot}.command.json`, record);
  return record;
}
