#!/usr/bin/env python3
"""A portal's ad network judges the LANGUAGE of the page from its raw HTML (Y8, Nov 16: "billiard_8's build page is marked and its static HTML text is Uzbek. The game switches to English
at runtime, but Google judges the page from its HTML. Uzbek isn't a Google-supported publisher language, so AdX declines the in-game requests ... make the static HTML text English").
english_static(html) makes the raw HTML of the page English without changing what a player sees:
  - <html lang="uz"> -> <html lang="en"> (the game sets document.documentElement.lang to the player's language when it starts, as before)
  - every piece of static TEXT inside <body> (the Uzbek menu labels, ...) and every title / placeholder / aria-label with letters is moved out of the markup: the markup keeps only an invisible
    marker (U+2063 INVISIBLE SEPARATOR + a number [+ U+2063]) and the originals go into a small script  window.__SEN = [...]  in the head;
    index.html puts them back (restoreStatic()) BEFORE it collects the static text for the language switch, so the labels, their translations and their sizes are exactly as without this step
  - what stays visible in the HTML is English: the <title>, the <noscript> paragraph, the links "Terms of Service / Privacy Policy / Refund Policy"
  - the script with the originals is plain ASCII (every non-ASCII character is a \\uXXXX escape) and stands right AFTER <meta charset>, so no host or browser can read the labels with a wrong encoding
  - calling it again on a page that already went through it changes nothing (the same count comes back)
Every build runs it: tools/build_web.py (the website, Telegram, the Android app, the Y8 zip) and tools/build_crazy.py (Playgama, and the CrazyGames / GameMonetize variants); UZ_HTML=1 keeps the plain Uzbek labels in the HTML and is refused outside the temp folder (only the tests compare the two).
RULE (the owner, Nov 16): the HTML of a shipped page is English, NEVER lang="uz" - see CLAUDE.md and tools/test_html_lang.js.
Usage: python3 tools/portal_html.py in.html out.html"""
import re, sys, json, html as H

SEP = "⁣"
LETTER = re.compile(r"[^\W\d_]", re.U)
SKIP_TEXT_IN = {"script", "style", "noscript", "textarea", "title", "template"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
ATTRS = ("title", "placeholder", "aria-label")
KEEP = {"Terms of Service", "Privacy Policy", "Refund Policy", "VIP", "VS", "Y8", "Mini", "Chat", "·"}   # English / language-neutral labels: they stay in the markup (they help the page read as English)


def movable(text):
    """the decoded text of a piece of static text, if it has to move out of the markup (letters, and not an English / neutral label)"""
    t = H.unescape(text)
    core = re.sub(r"[^\w\s·]", "", t, flags=re.U).strip()   # (emoji and punctuation do not count)
    if not LETTER.search(core) or core in KEEP or t.strip() in KEEP: return None
    return t


def split_blocks(html):
    """[(kind, text)]: 'raw' for <script>/<style>/<!-- -->, 'markup' for everything else (the part we may change)."""
    out, pos = [], 0
    for m in re.finditer(r"<script\b.*?</script\s*>|<style\b.*?</style\s*>|<!--.*?-->|<noscript\b.*?</noscript\s*>", html, re.S | re.I):
        if m.start() > pos: out.append(("markup", html[pos:m.start()]))
        out.append(("raw", m.group(0))); pos = m.end()
    if pos < len(html): out.append(("markup", html[pos:]))
    return out


def plain_allowed(out_dir):
    """UZ_HTML=1 (the plain page with its Uzbek labels in the HTML) exists for the tests only: it is refused unless the output folder is inside the system's temp folder,
    so a page for the website, Telegram, the app or a portal can never be built with Uzbek HTML by accident (the owner, Nov 16: never lang=uz, never forget it)"""
    import os, tempfile
    t, o = os.path.realpath(tempfile.gettempdir()), os.path.realpath(out_dir)
    return o == t or o.startswith(t + os.sep)


SEN_RE = re.compile(r"window\.__SEN=(\[.*?\]);</script>", re.S)


def already(html):
    """the number of pieces if this page already went through english_static, else None"""
    m = SEN_RE.search(html)
    return len(json.loads(m.group(1))) if m else None


def english_static(html):
    done_before = already(html)
    if done_before is not None: return html, done_before   # (idempotent)
    sen = []
    head_end = re.search(r"<body\b", html, re.I)
    if not head_end: raise SystemExit("no <body> in the page")
    body_at = head_end.start()
    tag_re = re.compile(r"(<[^>]*>)")
    attr_re = {a: re.compile(r'(\s' + re.escape(a) + r'\s*=\s*)("([^"]*)"|\'([^\']*)\')', re.I) for a in ATTRS}
    done, pos, stack = [], 0, []   # stack: open elements (only to know when text is inside something that must be left alone)
    for kind, chunk in split_blocks(html):
        start = pos; pos += len(chunk)
        if kind == "raw" or start + len(chunk) <= body_at:   # scripts, styles, comments, <noscript>, and the whole <head>
            done.append(chunk); continue
        out = []
        for part in tag_re.split(chunk):
            if part.startswith("<") and part.endswith(">"):
                m = re.match(r"</?\s*([a-zA-Z][\w:-]*)", part)
                if m:
                    name = m.group(1).lower()
                    if part.startswith("</"):
                        if name in stack:
                            while stack and stack.pop() != name: pass
                    elif not part.endswith("/>") and name not in VOID: stack.append(name)
                if not part.startswith("</"):
                    for a, rx in attr_re.items():
                        def sub(mm, a=a):
                            v = movable(mm.group(3) if mm.group(3) is not None else mm.group(4))
                            if v is None: return mm.group(0)
                            sen.append(v); return f'{mm.group(1)}"{SEP}a{len(sen) - 1}{SEP}"'
                        part = rx.sub(sub, part)
                out.append(part)
            else:
                v = movable(part) if part.strip() and not (set(stack) & SKIP_TEXT_IN) and "<" not in part and ">" not in part else None
                if v is not None:
                    sen.append(v); out.append(f"{SEP}{len(sen) - 1}{SEP}")
                else: out.append(part)
        done.append("".join(out))
    res = "".join(done)
    res = re.sub(r"<html\b([^>]*?)\blang\s*=\s*\"[^\"]*\"", r'<html\1lang="en"', res, count=1, flags=re.I)
    if "<html" in res and not re.search(r"<html\b[^>]*\blang=", res, re.I): res = re.sub(r"<html\b", '<html lang="en"', res, count=1, flags=re.I)
    # plain ASCII ("\\ud83c\\udfb1"), and "</" / "<!--" cannot end or confuse the script
    data = json.dumps(sen, ensure_ascii=True).replace("</", "<\\/").replace("<!--", "\\u003c!--")
    inject = '<meta http-equiv="content-language" content="en"><script>window.__SEN=' + data + ";</script>"
    head = re.search(r"<head\b[^>]*>", res, re.I)
    if not head: raise SystemExit("no <head> in the page")
    at = head.end()
    close = re.search(r"</head\s*>", res[at:], re.I)
    cs = re.search(r"<meta\s+charset\s*=\s*[\"']?[\w-]+[\"']?\s*/?>", res[at:at + close.start()] if close else res[at:at + 4000], re.I)
    if cs: at += cs.end()   # after <meta charset>: the encoding is declared before anything that is not plain ASCII
    res = res[:at] + inject + res[at:]
    return res, len(sen)


def leftover(html):
    """static text that is still readable in the raw HTML (outside <script> / <style> / <noscript> / <head>) and is not an English / neutral label: must be empty"""
    body = re.search(r"<body\b", html, re.I)
    rest = []
    for kind, chunk in split_blocks(html[body.start():] if body else html):
        if kind == "raw": continue
        for part in re.split(r"(<[^>]*>)", chunk):
            if part.startswith("<"):
                for a in ATTRS:
                    for mm in re.finditer(r'\s' + re.escape(a) + r'\s*=\s*"([^"]*)"', part, re.I):
                        v = movable(mm.group(1))
                        if v is not None and SEP not in v: rest.append(v)
            elif SEP not in part:
                v = movable(part)
                if v is not None: rest.append(v)
    return rest


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    html = open(src, encoding="utf-8").read()
    out, n = english_static(html)
    open(dst, "w", encoding="utf-8").write(out)
    left = leftover(out)
    print(f"{n} pieces of static text moved out of the markup; lang=en;", len(html), "->", len(out), "bytes;", len(left), "pieces left", left[:5])
    if left: sys.exit(1)
