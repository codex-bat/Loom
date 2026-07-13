// ============================================================
//   LOOM SYNTAX HIGHLIGHTER – single-pass tokenizer, richer palette
//   Placed in assets/scripts/loom-syntax.js
// ============================================================
(function (global) {
  "use strict";

  // ---- CSS class map (matches the extended stylesheet) ----
  var CLASS = {
    comment: "syn-comment",
    string: "syn-string",
    number: "syn-number",
    boolean: "syn-boolean",
    keyword: "syn-keyword",
    builtin: "syn-builtin",
    function: "syn-function",
    class: "syn-class",
    operator: "syn-operator",
    regex: "syn-regex",
    tag: "syn-tag",
    attrName: "syn-attr-name",
    attrValue: "syn-attr-value",
  };

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function wrap(type, text) {
    var cls = CLASS[type];
    var esc = escapeHtml(text);
    return cls ? '<span class="' + cls + '">' + esc + "</span>" : esc;
  }

  function toSet(arr) {
    var s = {};
    for (var i = 0; i < arr.length; i++) s[arr[i]] = true;
    return {
      has: function (x) {
        return !!s[x];
      },
    };
  }

  // ---------------- language keyword tables ----------------
  var CODE_DEFS = {
    js: {
      name: "JavaScript",
      keywords:
        "break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return static super switch this throw try typeof var void while with yield async await get set of as from".split(
          " ",
        ),
      booleans: ["true", "false", "null", "undefined", "NaN", "Infinity"],
      builtins:
        "console document window globalThis Array Object String Number Boolean RegExp Math Date JSON Promise Set Map WeakMap WeakSet Symbol Error TypeError RangeError SyntaxError parseInt parseFloat isNaN isFinite Proxy Reflect fetch require module exports process".split(
          " ",
        ),
      lineComment: "//",
      blockComment: ["/*", "*/"],
    },
    py: {
      name: "Python",
      keywords:
        "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case".split(
          " ",
        ),
      booleans: ["True", "False", "None"],
      builtins:
        "print range len int float str list dict tuple set frozenset bool type enumerate zip map filter sorted reversed abs min max sum any all input open self cls super isinstance issubclass staticmethod classmethod property".split(
          " ",
        ),
      lineComment: "#",
      blockComment: null,
    },
  };

  var JS_OPERATORS = [
    ">>>=",
    "**=",
    "<<=",
    ">>=",
    "===",
    "!==",
    "...",
    "&&=",
    "||=",
    "??=",
    ">>>",
    "=>",
    "==",
    "!=",
    "<=",
    ">=",
    "&&",
    "||",
    "??",
    "?.",
    "++",
    "--",
    "**",
    "<<",
    ">>",
    "+=",
    "-=",
    "*=",
    "/=",
    "%=",
    "&=",
    "|=",
    "^=",
    "+",
    "-",
    "*",
    "/",
    "%",
    "=",
    "<",
    ">",
    "!",
    "&",
    "|",
    "^",
    "~",
    "?",
    ":",
  ];
  var PY_OPERATORS = [
    "**=",
    "//=",
    "<<=",
    ">>=",
    "==",
    "!=",
    "<=",
    ">=",
    "->",
    ":=",
    "**",
    "//",
    "<<",
    ">>",
    "+=",
    "-=",
    "*=",
    "/=",
    "%=",
    "&=",
    "|=",
    "^=",
    "@=",
    "+",
    "-",
    "*",
    "/",
    "%",
    "=",
    "<",
    ">",
    "&",
    "|",
    "^",
    "~",
    "@",
  ];

  var PUNCT = toSet(["(", ")", "[", "]", "{", "}", ",", ";", "."]);
  var REGEX_OK_PUNCT = toSet(["(", "[", "{", ",", ";", ":"]);
  var REGEX_OK_KEYWORDS = toSet([
    "return",
    "typeof",
    "instanceof",
    "in",
    "of",
    "new",
    "delete",
    "void",
    "throw",
    "case",
    "yield",
    "await",
    "else",
    "do",
  ]);

  var LANGUAGES = CODE_DEFS;

  // ---------------- helper scanners ----------------
  function scanRegexLiteral(code, start) {
    var n = code.length;
    var i = start + 1;
    var inClass = false;
    var closed = false;
    while (i < n) {
      var c = code[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "\n") break;
      if (c === "[") {
        inClass = true;
        i++;
        continue;
      }
      if (c === "]") {
        inClass = false;
        i++;
        continue;
      }
      if (c === "/" && !inClass) {
        i++;
        closed = true;
        break;
      }
      i++;
    }
    if (!closed) return null;
    var flags = /^[a-zA-Z]*/.exec(code.slice(i));
    i += flags[0].length;
    return code.slice(start, i);
  }

  // Scans a JS template literal starting at the opening backtick.
  // Recursively tokenizes ${...} interpolations so they get real
  // syntax highlighting instead of being swallowed as plain string text.
  function scanTemplate(code, start) {
    var n = code.length;
    var i = start + 1;
    var html = wrap("string", "`");
    var litStart = i;

    function flush(end) {
      if (end > litStart) html += wrap("string", code.slice(litStart, end));
    }

    while (i < n) {
      var c = code[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        flush(i);
        html += wrap("string", "`");
        i++;
        return { end: i, html: html };
      }
      if (c === "$" && code[i + 1] === "{") {
        flush(i);
        html += escapeHtml("${");
        i += 2;
        var depth = 1;
        var exprStart = i;
        while (i < n && depth > 0) {
          var ch = code[i];
          if (ch === "{") {
            depth++;
            i++;
            continue;
          }
          if (ch === "}") {
            depth--;
            if (depth === 0) break;
            i++;
            continue;
          }
          if (ch === "'" || ch === '"') {
            var q = ch;
            i++;
            while (i < n && code[i] !== q) {
              if (code[i] === "\\") i++;
              i++;
            }
            i++;
            continue;
          }
          if (ch === "`") {
            // nested template literal: skip to its matching backtick
            // (interpolations inside a nested template are not recursed into)
            i++;
            while (i < n && code[i] !== "`") {
              if (code[i] === "\\") i++;
              i++;
            }
            i++;
            continue;
          }
          i++;
        }
        var exprCode = code.slice(exprStart, i);
        html += renderTokens(tokenizeCode(exprCode, "js"));
        html += escapeHtml("}");
        i++;
        litStart = i;
        continue;
      }
      i++;
    }
    flush(i);
    return { end: i, html: html };
  }

  // ---------------- core code tokenizer (js / py) ----------------
  function tokenizeCode(code, lang) {
    var def = CODE_DEFS[lang];
    var n = code.length;
    var i = 0;
    var tokens = [];
    var prevSig = null; // last non-whitespace, non-comment token: {type, text}

    var kwSet = toSet(def.keywords);
    var boolSet = toSet(def.booleans);
    var builtinSet = toSet(def.builtins);
    var idRe =
      lang === "js" ? /^[A-Za-z_$][A-Za-z0-9_$]*/ : /^[A-Za-z_][A-Za-z0-9_]*/;
    var numRe =
      /^0[xX][0-9a-fA-F]+n?|^0[bB][01]+n?|^0[oO][0-7]+n?|^(?:\d[\d_]*\.?[\d_]*|\.[\d_]+)(?:[eE][+-]?\d+)?[nj]?/;
    var operators = lang === "js" ? JS_OPERATORS : PY_OPERATORS;

    function push(type, text) {
      tokens.push({ type: type, text: text });
      if (type !== "comment" && !/^\s*$/.test(text))
        prevSig = { type: type, text: text };
    }

    function canBeRegex() {
      if (!prevSig) return true;
      if (prevSig.type === "operator") return true;
      if (prevSig.type === "punct") return REGEX_OK_PUNCT.has(prevSig.text);
      if (prevSig.type === "keyword")
        return REGEX_OK_KEYWORDS.has(prevSig.text);
      return false; // after identifier/number/string/closing-bracket => division
    }

    while (i < n) {
      var rest = code.slice(i);

      var ws = /^[ \t\r\n]+/.exec(rest);
      if (ws) {
        push(null, ws[0]);
        i += ws[0].length;
        continue;
      }

      if (
        def.blockComment &&
        rest.slice(0, def.blockComment[0].length) === def.blockComment[0]
      ) {
        var endIdx = code.indexOf(
          def.blockComment[1],
          i + def.blockComment[0].length,
        );
        var end = endIdx === -1 ? n : endIdx + def.blockComment[1].length;
        push("comment", code.slice(i, end));
        i = end;
        continue;
      }

      if (
        def.lineComment &&
        rest.slice(0, def.lineComment.length) === def.lineComment
      ) {
        var nl = code.indexOf("\n", i);
        var end2 = nl === -1 ? n : nl;
        push("comment", code.slice(i, end2));
        i = end2;
        continue;
      }

      if (lang === "py") {
        var triple = /^[rRbBfFuU]{0,2}('''|""")/.exec(rest);
        if (triple) {
          var quote = triple[1];
          var from = i + triple[0].length;
          var tEnd = code.indexOf(quote, from);
          var end3 = tEnd === -1 ? n : tEnd + quote.length;
          push("string", code.slice(i, end3));
          i = end3;
          continue;
        }
      }

      if (lang === "js" && rest[0] === "`") {
        var tmpl = scanTemplate(code, i);
        tokens.push({ type: "raw", html: tmpl.html });
        prevSig = { type: "string", text: "`" };
        i = tmpl.end;
        continue;
      }

      var strMatch =
        lang === "py"
          ? /^[rRbBfFuU]{0,2}('([^'\\\n]|\\.)*'|"([^"\\\n]|\\.)*")/.exec(rest)
          : /^('([^'\\\n]|\\.)*'|"([^"\\\n]|\\.)*")/.exec(rest);
      if (strMatch) {
        push("string", strMatch[0]);
        i += strMatch[0].length;
        continue;
      }

      if (lang === "js" && rest[0] === "/" && canBeRegex()) {
        var rx = scanRegexLiteral(code, i);
        if (rx) {
          push("regex", rx);
          i += rx.length;
          continue;
        }
      }

      var numMatch = numRe.exec(rest);
      if (numMatch && numMatch[0]) {
        push("number", numMatch[0]);
        i += numMatch[0].length;
        continue;
      }

      if (lang === "py" && rest[0] === "@") {
        var dec = /^@[A-Za-z_][A-Za-z0-9_.]*/.exec(rest);
        if (dec) {
          push("function", dec[0]);
          i += dec[0].length;
          continue;
        }
      }

      var idMatch = idRe.exec(rest);
      if (idMatch) {
        var word = idMatch[0];
        var type;
        if (kwSet.has(word)) {
          type = "keyword";
        } else if (prevSig && prevSig.text === "class") {
          type = "class";
        } else if (
          prevSig &&
          (prevSig.text === "function" || prevSig.text === "def")
        ) {
          type = "function";
        } else if (boolSet.has(word)) {
          type = "boolean";
        } else if (builtinSet.has(word)) {
          type = "builtin";
        } else if (word.length > 1 && /^[A-Z][A-Za-z0-9_]*$/.test(word)) {
          type = "class"; // PascalCase convention
        } else if (/^\s*\(/.test(code.slice(i + word.length))) {
          type = "function"; // call-site heuristic
        } else {
          type = null;
        }
        push(type, word);
        i += word.length;
        continue;
      }

      var opMatch = null;
      for (var oi = 0; oi < operators.length; oi++) {
        var op = operators[oi];
        if (rest.slice(0, op.length) === op) {
          opMatch = op;
          break;
        }
      }
      if (opMatch) {
        push("operator", opMatch);
        i += opMatch.length;
        continue;
      }

      if (PUNCT.has(rest[0])) {
        push("punct", rest[0]);
        i += 1;
        continue;
      }

      push(null, rest[0]);
      i += 1;
    }

    return tokens;
  }

  function renderTokens(tokens) {
    var out = "";
    for (var idx = 0; idx < tokens.length; idx++) {
      var t = tokens[idx];
      out += t.type === "raw" ? t.html : wrap(t.type, t.text);
    }
    return out;
  }

  // ---------------- CSS tokenizer ----------------
  function highlightCSS(code) {
    var n = code.length,
      i = 0,
      html = "";
    var braceDepth = 0,
      afterColon = false;

    while (i < n) {
      var rest = code.slice(i);
      var m;

      if (rest.slice(0, 2) === "/*") {
        var end = code.indexOf("*/", i + 2);
        end = end === -1 ? n : end + 2;
        html += wrap("comment", code.slice(i, end));
        i = end;
        continue;
      }

      if (rest[0] === "'" || rest[0] === '"') {
        var q = rest[0],
          j = i + 1;
        while (j < n && code[j] !== q) {
          if (code[j] === "\\") j++;
          j++;
        }
        j = Math.min(j + 1, n);
        html += wrap("string", code.slice(i, j));
        i = j;
        continue;
      }

      if (rest[0] === "{") {
        braceDepth++;
        afterColon = false;
        html += escapeHtml("{");
        i++;
        continue;
      }
      if (rest[0] === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
        afterColon = false;
        html += escapeHtml("}");
        i++;
        continue;
      }
      if (rest[0] === ";") {
        afterColon = false;
        html += escapeHtml(";");
        i++;
        continue;
      }
      if (rest[0] === ":") {
        if ((m = /^::?[a-zA-Z-]+/.exec(rest))) {
          html += wrap("keyword", m[0]);
          i += m[0].length;
          continue;
        }
        afterColon = true;
        html += escapeHtml(":");
        i++;
        continue;
      }

      if ((m = /^@[a-zA-Z-]+/.exec(rest))) {
        html += wrap("keyword", m[0]);
        i += m[0].length;
        continue;
      }
      if ((m = /^!\s*important\b/.exec(rest))) {
        html += wrap("keyword", m[0]);
        i += m[0].length;
        continue;
      }
      if ((m = /^#[0-9a-fA-F]{3,8}\b/.exec(rest))) {
        html += wrap("number", m[0]);
        i += m[0].length;
        continue;
      }
      if ((m = /^[.#][a-zA-Z_-][a-zA-Z0-9_-]*/.exec(rest))) {
        html += wrap("class", m[0]);
        i += m[0].length;
        continue;
      }
      if ((m = /^-?\d*\.?\d+(?:[a-zA-Z%]+)?/.exec(rest))) {
        html += wrap("number", m[0]);
        i += m[0].length;
        continue;
      }
      if ((m = /^--[a-zA-Z0-9-]+/.exec(rest))) {
        html += wrap(
          braceDepth > 0 && !afterColon ? "attrName" : "class",
          m[0],
        );
        i += m[0].length;
        continue;
      }
      if ((m = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(rest))) {
        var word = m[0];
        var isFunc = /^\s*\(/.test(code.slice(i + word.length));
        if (isFunc) html += wrap("function", word);
        else if (braceDepth > 0 && !afterColon) html += wrap("attrName", word);
        else if (braceDepth === 0) html += wrap("tag", word);
        else html += escapeHtml(word); // property value keyword, left unstyled
        i += word.length;
        continue;
      }

      html += escapeHtml(rest[0]);
      i++;
    }
    return html;
  }

  // ---------------- HTML tokenizer ----------------
  function highlightHTML(code) {
    var n = code.length,
      i = 0,
      html = "";
    function isNameChar(c) {
      return c !== undefined && /[a-zA-Z0-9:_-]/.test(c);
    }

    while (i < n) {
      var rest = code.slice(i);

      if (rest.slice(0, 4) === "<!--") {
        var end = code.indexOf("-->", i + 4);
        end = end === -1 ? n : end + 3;
        html += wrap("comment", code.slice(i, end));
        i = end;
        continue;
      }

      if (/^<!DOCTYPE/i.test(rest)) {
        var end2 = code.indexOf(">", i);
        end2 = end2 === -1 ? n : end2 + 1;
        html += wrap("keyword", code.slice(i, end2));
        i = end2;
        continue;
      }

      if (rest[0] === "<" && (isNameChar(rest[1]) || rest[1] === "/")) {
        var j = i + 1;
        var closing = code[j] === "/";
        if (closing) {
          html += escapeHtml("</");
          j++;
        } else {
          html += escapeHtml("<");
        }
        var tagStart = j;
        while (j < n && isNameChar(code[j])) j++;
        html += wrap("tag", code.slice(tagStart, j));

        while (
          j < n &&
          code[j] !== ">" &&
          !(code[j] === "/" && code[j + 1] === ">")
        ) {
          if (/\s/.test(code[j])) {
            html += code[j];
            j++;
            continue;
          }
          var attrStart = j;
          while (j < n && isNameChar(code[j])) j++;
          if (j === attrStart) {
            html += escapeHtml(code[j]);
            j++;
            continue;
          }
          html += wrap("attrName", code.slice(attrStart, j));
          var k = j;
          while (k < n && /\s/.test(code[k])) k++;
          if (code[k] === "=") {
            html += code.slice(j, k) + "=";
            k++;
            while (k < n && /\s/.test(code[k])) k++;
            if (code[k] === '"' || code[k] === "'") {
              var q = code[k],
                vs = k;
              k++;
              while (k < n && code[k] !== q) k++;
              k = Math.min(k + 1, n);
              html += wrap("attrValue", code.slice(vs, k));
            } else {
              var vs2 = k;
              while (
                k < n &&
                !/[\s>]/.test(code[k]) &&
                !(code[k] === "/" && code[k + 1] === ">")
              )
                k++;
              html += wrap("attrValue", code.slice(vs2, k));
            }
            j = k;
          } else {
            j = k;
          }
        }

        if (code[j] === "/" && code[j + 1] === ">") {
          html += escapeHtml("/>");
          j += 2;
        } else if (code[j] === ">") {
          html += escapeHtml(">");
          j++;
        }
        i = j;
        continue;
      }

      var ltIdx = code.indexOf("<", i);
      var end3 = ltIdx === -1 ? n : ltIdx === i ? i + 1 : ltIdx;
      html += escapeHtml(code.slice(i, end3));
      i = end3;
    }
    return html;
  }

  // ---------------- language detection ----------------
  function detectLanguage(code) {
    var scores = { js: 0, py: 0, css: 0, html: 0 };

    ["js", "py"].forEach(function (lang) {
      var def = CODE_DEFS[lang];
      def.keywords.forEach(function (kw) {
        var re = new RegExp("\\b" + kw + "\\b", "g");
        var found = code.match(re);
        if (found) scores[lang] += found.length;
      });
    });
    if (/def\s+\w+\s*\(/.test(code)) scores.py += 3;
    if (/=>|console\.|function\s*\(/.test(code)) scores.js += 2;

    var tagMatches = code.match(/<\/?[a-zA-Z][a-zA-Z0-9-]*(\s[^<>]*)?>/g);
    if (tagMatches) scores.html += tagMatches.length * 2;
    if (/<!DOCTYPE/i.test(code)) scores.html += 5;

    var ruleMatches = code.match(/[.#]?[a-zA-Z][\w-]*\s*\{[^}]*\}/g);
    if (ruleMatches) scores.css += ruleMatches.length * 2;
    if (/@media|@import|@keyframes|:root/.test(code)) scores.css += 3;
    if (!/function|def /.test(code) && /[a-zA-Z-]+\s*:\s*[^;{}]+;/.test(code))
      scores.css += 1;

    var best = "js",
      bestScore = 0;
    for (var lang in scores) {
      if (scores[lang] > bestScore) {
        bestScore = scores[lang];
        best = lang;
      }
    }
    return best;
  }

  // ---------------- public API ----------------
  function highlight(code, lang) {
    if (!lang) lang = detectLanguage(code);
    if (lang === "html") return highlightHTML(code);
    if (lang === "css") return highlightCSS(code);
    var actual = lang === "js" || lang === "py" ? lang : "js";
    return renderTokens(tokenizeCode(code, actual));
  }

  global.LoomSyntax = {
    highlight: highlight,
    detectLanguage: detectLanguage,
    LANGUAGES: LANGUAGES,
  };
})(window);
