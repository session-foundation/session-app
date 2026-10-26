#!/usr/bin/python3
"""PreToolUse hook: refuse commits, pushes and GitHub posts that carry AI attribution."""
import json, os, re, shlex, subprocess, sys

ATTRIBUTION = re.compile(
    r"co-authored-by:[^\n]*(claude|anthropic|copilot|openai|chatgpt|gpt-|gemini|cursor)"
    r"|claude-session:"
    r"|claude\.ai/code"
    r"|generated (with|by) \[?(claude|copilot|chatgpt|cursor)",
    re.IGNORECASE,
)
GH_POST = re.compile(r"\bgh\s+(pr|issue|release)\s+(create|edit|comment|review)\b|\bgh\s+api\b")
GIT = re.compile(r"\bgit\s+(?:-C\s+\S+\s+)?(commit|push|merge|tag)\b")


def deny(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": f"AI attribution is forbidden: {reason}. Remove it and retry.",
    }}))
    sys.exit(0)


def git(cwd, *args):
    try:
        return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def tokens(cmd):
    try:
        return shlex.split(cmd, comments=False)
    except ValueError:
        return cmd.split()


def referenced_files(toks, cwd):
    """Message bodies passed by path: -F/--file, --body-file, gh api `field=@path`."""
    paths = []
    for i, t in enumerate(toks):
        if t in ("-F", "--file", "--body-file") and i + 1 < len(toks):
            nxt = toks[i + 1]
            paths.append(nxt.split("=@", 1)[1] if "=@" in nxt else nxt)
        elif t.startswith(("--file=", "--body-file=")):
            paths.append(t.split("=", 1)[1])
        elif "=@" in t:
            paths.append(t.split("=@", 1)[1])
    out = []
    for p in paths:
        if p == "-":
            continue
        try:
            with open(os.path.join(cwd, os.path.expanduser(p)), errors="replace") as f:
                out.append(f.read(1_000_000))
        except OSError:
            pass
    return out


def repo_dir(toks, cwd):
    for i, t in enumerate(toks):
        if t == "-C" and i + 1 < len(toks):
            return os.path.join(cwd, os.path.expanduser(toks[i + 1]))
    return cwd


def unpushed_messages(toks, cwd):
    """Messages of every commit the push could publish: anything not on a remote yet."""
    refs = ["HEAD"]
    after_push = toks[toks.index("push") + 1:] if "push" in toks else []
    positional = [t for t in after_push if not t.startswith("-")]
    for spec in positional[1:]:
        src = spec.lstrip("+").split(":", 1)[0]
        if src:
            refs.append(src)
    return git(cwd, "log", "--format=%H%n%B%x00", *refs, "--not", "--remotes")


def main():
    data = json.load(sys.stdin)
    cmd = data.get("tool_input", {}).get("command", "")
    is_git, is_gh = GIT.search(cmd), GH_POST.search(cmd)
    if not (is_git or is_gh):
        return
    cwd = data.get("cwd") or os.getcwd()
    toks = tokens(cmd)

    if ATTRIBUTION.search(cmd):
        deny("the command text contains an attribution line or session link")
    for body in referenced_files(toks, cwd):
        if ATTRIBUTION.search(body):
            deny("a message or body file passed to the command contains attribution")

    if is_git:
        where = repo_dir(toks, cwd)
        verb = is_git.group(1)
        if verb == "commit" and "--amend" in toks and ATTRIBUTION.search(git(where, "log", "-1", "--format=%B")):
            deny("the commit being amended carries attribution; reword it")
        if verb == "push":
            for entry in unpushed_messages(toks, where).split("\x00"):
                if ATTRIBUTION.search(entry):
                    sha = entry.strip().split("\n", 1)[0][:10]
                    deny(f"unpushed commit {sha} carries attribution; reword it before pushing")


if __name__ == "__main__":
    main()
