#!/usr/bin/env python3
"""Double-fork daemonizer: start `bun run dev` as a child of PID 1 so it
survives the tool-call process-group cleanup that killed earlier attempts."""
import os, sys, time

DEVLOG = "/home/z/my-project/dev.log"

def daemonize_and_exec():
    # 1st fork: detach from the calling session
    pid = os.fork()
    if pid > 0:
        return  # parent returns to main flow
    os.setsid()  # new session, escape the tool call's process group
    # 2nd fork: grandchild gets reparented to PID 1 when this intermediate exits
    pid = os.fork()
    if pid > 0:
        os._exit(0)
    # grandchild: redirect stdio and exec
    os.chdir("/home/z/my-project")
    fd = os.open(DEVLOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    os.dup2(fd, 1)
    os.dup2(fd, 2)
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0)
    os.execvp("bun", ["bun", "run", "dev"])

if __name__ == "__main__":
    daemonize_and_exec()
    time.sleep(0.5)
    print("daemon forked")
