#!/usr/bin/env python3
"""Renames one JavaScript identifier in the inline <script> blocks of a page (tokens only: strings, template text, regex literals, comments and
property names (x.$) are never touched).  Used by tools/build_crazy.py for the GameMonetize build:  the game's own helper  const $ = id => document.getElementById(id)
sits in the page's global scope and hides the jQuery that GameMonetize's SDK puts on window.$ and calls through the bare name $ (see README, "GameMonetize: why no ad came").

    from jsrename import rename_in_page
    page, n = rename_in_page(page, "$", "$b8")        # n = how many identifier tokens were renamed

A small tokenizer, not a parser: "/" is a regex when the token before it cannot end an expression (the usual rule); the result is checked by tools/test_gm_dollar.js,
which parses every inline script of the built page with a real parser (acorn) and fails on any remaining reference to the old name.
"""
import re, sys

_KW_BEFORE_REGEX = {"return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"}
_IDCH = re.compile(r"[A-Za-z0-9_$\u0080-￿]")
_PUNCT3 = ("...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=")
_PUNCT2 = ("=>", "?.", "??", "++", "--", "==", "!=", "<=", ">=", "&&", "||", "**", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>")


def rename_js(js, old, new):
    """Returns (js with every identifier token `old` renamed to `new`, count).  `old` after a "." / "?." (a property name) is left alone."""
    out, i, n, cnt = [], 0, len(js), 0
    prev = None            # last significant token: (kind, value); kind: id | kw | num | str | tpl | re | op
    prev2_value_like = False
    stack = []             # brace depths of the open ${ ... } parts of template literals
    depth = 0

    def value_like(tok):   # can this token end an expression (so a following "/" is a division)?
        if tok is None: return False
        k, v = tok
        if k in ("num", "str", "tpl", "re"): return True
        if k == "id": return True
        if k == "kw": return False
        if k == "op": return v in (")", "]", "}") or (v in ("++", "--") and prev2_value_like)
        return False

    def read_template_text(j):
        """From just after a backtick or a closing } of ${...}: copies template text up to the closing backtick (returns (end, False)) or up to a ${ (returns (end, True))."""
        while j < n:
            c = js[j]
            if c == "\\": j += 2; continue
            if c == "`": return j + 1, False
            if c == "$" and js.startswith("${", j): return j + 2, True
            j += 1
        raise ValueError("unterminated template literal")

    while i < n:
        c = js[i]
        if c in " \t\r\n﻿   ":
            out.append(c); i += 1; continue
        if js.startswith("//", i):
            j = js.find("\n", i); j = n if j < 0 else j
            out.append(js[i:j]); i = j; continue
        if js.startswith("/*", i):
            j = js.find("*/", i + 2)
            if j < 0: raise ValueError("unterminated comment")
            out.append(js[i:j + 2]); i = j + 2; continue
        if c in "'\"":
            j = i + 1
            while j < n and js[j] != c:
                if js[j] == "\\": j += 2; continue
                if js[j] == "\n": raise ValueError("unterminated string at %d" % i)
                j += 1
            if j >= n: raise ValueError("unterminated string at %d" % i)
            j += 1; out.append(js[i:j]); i = j; prev = ("str", ""); continue
        if c == "`":
            j, more = read_template_text(i + 1); out.append(js[i:j]); i = j
            if more: stack.append(depth); depth = 0; prev = ("op", "${")
            else: prev = ("tpl", "")
            continue
        if c == "/" :
            if not value_like(prev):   # a regular expression literal
                j, incls = i + 1, False
                while j < n:
                    d = js[j]
                    if d == "\\": j += 2; continue
                    if d == "\n": raise ValueError("unterminated regex at %d: %r" % (i, js[i:i + 60]))
                    if d == "[": incls = True
                    elif d == "]": incls = False
                    elif d == "/" and not incls: break
                    j += 1
                j += 1
                while j < n and _IDCH.match(js[j]): j += 1   # flags
                out.append(js[i:j]); i = j; prev = ("re", ""); continue
        if c.isdigit() or (c == "." and i + 1 < n and js[i + 1].isdigit()):
            j = i + 1
            while j < n and (_IDCH.match(js[j]) or js[j] == "." or (js[j] in "+-" and js[j - 1] in "eE" and not js.startswith("0x", i))): j += 1
            out.append(js[i:j]); i = j; prev = ("num", ""); continue
        if _IDCH.match(c):
            j = i + 1
            while j < n and _IDCH.match(js[j]): j += 1
            w = js[i:j]
            member = prev in (("op", "."), ("op", "?."))
            if w == old and not member: out.append(new); cnt += 1
            else: out.append(w)
            prev = ("id", w) if member else ("kw" if w in _KW_BEFORE_REGEX else "id", w)
            i = j; continue
        # punctuators
        p = js[i:i + 3] if js[i:i + 3] in _PUNCT3 else js[i:i + 2] if js[i:i + 2] in _PUNCT2 else c
        pv = value_like(prev)
        if p == "{": depth += 1
        elif p == "}":
            if stack and depth == 0:   # the end of a ${ ... } part: back to template text
                depth = stack.pop(); out.append("}"); i += 1
                j, more = read_template_text(i); out.append(js[i:j]); i = j
                if more: stack.append(depth); depth = 0; prev = ("op", "${")
                else: prev = ("tpl", "")
                continue
            depth -= 1
        out.append(p); i += len(p); prev2_value_like = pv; prev = ("op", p)
    if stack or depth: raise ValueError("unbalanced braces (%d open templates, depth %d)" % (len(stack), depth))
    return "".join(out), cnt


_SCRIPT = re.compile(r"(<script\b(?![^>]*\bsrc=)[^>]*>)(.*?)(</script>)", re.S | re.I)


def rename_in_page(page, old, new):
    """Applies rename_js to every inline <script> block (not the ones with src=) of an HTML page; returns (page, total count)."""
    total = [0]
    def one(m):
        body, k = rename_js(m.group(2), old, new); total[0] += k
        return m.group(1) + body + m.group(3)
    return _SCRIPT.sub(one, page), total[0]


if __name__ == "__main__":
    src = open(sys.argv[1], encoding="utf-8").read()
    res, k = rename_in_page(src, sys.argv[2], sys.argv[3])
    print("renamed", k, "tokens"); open(sys.argv[4], "w", encoding="utf-8").write(res) if len(sys.argv) > 4 else None
