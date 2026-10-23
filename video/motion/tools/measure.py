#!/usr/bin/env python3
"""Measure the source scene's text geometry in a real browser.

Prints, for every text element of the composition: its box rect, each rendered
line box, and the baseline of each line (computed from the font's
fontBoundingBoxAscent/Descent and the element's line-height).
"""
import json
import subprocess
import sys
import threading
import http.server
import socketserver
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "source"
PORT = 8931

JS = r"""
() => {
  const out = {ascent: {}, lines: [], boxes: []};
  const ctx = document.createElement('canvas').getContext('2d');
  const seen = new Set();
  function metrics(family, size, weight) {
    const key = family + '|' + size + '|' + weight;
    if (seen.has(key)) return out.ascent[key];
    seen.add(key);
    ctx.font = weight + ' ' + size + 'px ' + family;
    const m = ctx.measureText('Hxpg');
    out.ascent[key] = {ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent};
    return out.ascent[key];
  }
  const els = Array.from(document.querySelectorAll('#root *')).filter(e => e.textContent.trim() && e.children.length === 0 && !e.closest('.capwrap'));
  for (const el of els) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = Array.from(range.getClientRects()).filter(x => x.width > 0.5 && x.height > 0.5);
    const size = parseFloat(cs.fontSize);
    const lh = parseFloat(cs.lineHeight) || size * 1.2;
    const m = metrics(cs.fontFamily, size, cs.fontWeight);
    const half = (lh - (m.ascent + m.descent)) / 2;
    const lines = rects.map(rr => ({
      x: +rr.left.toFixed(2), y: +rr.top.toFixed(2), w: +rr.width.toFixed(2), h: +rr.height.toFixed(2),
      baseline: +(rr.top + half + m.ascent).toFixed(2)
    }));
    out.lines.push({
      sel: el.className || el.tagName, text: el.textContent.trim().slice(0, 80),
      font: cs.fontFamily.split(',')[0].replace(/"/g, ''), size, weight: cs.fontWeight,
      lh: +lh.toFixed(2), color: cs.color, letterSpacing: cs.letterSpacing,
      padT: parseFloat(cs.paddingTop) || 0, padL: parseFloat(cs.paddingLeft) || 0,
      box: {x: +r.left.toFixed(2), y: +r.top.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2)},
      lines: lines
    });
  }
  // non-text boxes
  for (const el of Array.from(document.querySelectorAll('#root div, #root span, #root svg, #root rect, #root line, #root polygon'))) {
    if (el.textContent.trim() && el.children.length === 0) continue;
    if (el.closest('.capwrap')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    out.boxes.push({
      sel: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || el.tagName,
      x: +r.left.toFixed(2), y: +r.top.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2),
      bg: cs.backgroundColor, border: cs.borderTopWidth + ' ' + cs.borderTopColor, radius: cs.borderTopLeftRadius,
      tag: el.tagName
    });
  }
  return out;
}
"""


def main():
    handler = partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": 1920, "height": 1080})
        page.goto(f"http://127.0.0.1:{PORT}/measure.html")
        page.wait_for_function("document.documentElement.dataset.ready === '1'", timeout=20000)
        page.wait_for_timeout(400)
        data = page.evaluate(JS)
        # jump the scene timeline to the fully built state so every element has a box
        page.evaluate("window.__timelines['02-problem'].time(13)")
        page.wait_for_timeout(200)
        b.close()
    httpd.shutdown()
    print(json.dumps(data, indent=1))


if __name__ == "__main__":
    main()
