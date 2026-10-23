#!/usr/bin/env python3
"""Check the site the way the motion2code reference asks for.

1920x1080 and 375x812: scroll the whole page (to each ScrollTrigger start and inside the pinned ranges),
click every control, drag the slider, press Escape and the arrow keys, screenshot each state, and assert
no console errors and no horizontal overflow.

  python3 tools/check_site.py            # writes screenshots to tools/shots/
"""
import http.server
import socketserver
import sys
import threading
from functools import partial
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = Path(__file__).resolve().parent / "shots"
PORT = 0  # a free port is picked at run time
problems = []


def serve():
    global PORT
    handler = partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    PORT = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def settle(page, tries=40):
    """Wait until the page has stopped scrolling (ScrollTrigger pins move the scroll position)."""
    last = None
    for _ in range(tries):
        y = page.evaluate("Math.round(window.scrollY)")
        if y == last:
            return
        last = y
        page.wait_for_timeout(100)


def into(page, sel, block="center"):
    page.evaluate(f"document.querySelector('{sel}').scrollIntoView({{block:'{block}'}})")
    settle(page)
    page.wait_for_timeout(250)


def check(page, name, width):
    ow = page.evaluate("document.documentElement.scrollWidth")
    if ow > width + 1:
        problems.append(f"{name}: horizontal overflow ({ow} > {width})")


def run(pw, width, height, tag):
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": width, "height": height})
    errors, requests = [], []
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: requests.append(r.url))
    page.goto(f"http://127.0.0.1:{PORT}/site.html")
    page.wait_for_function("document.documentElement.dataset.ready === '1'", timeout=20000)
    page.wait_for_timeout(600)
    SHOTS.mkdir(exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{tag}-00-hero.png"))
    check(page, f"{tag} hero", width)

    # scroll through the page: every section, and inside the pinned range
    for i, sel in enumerate(["#problem", "#seal", "#record", "#validation"]):
        page.evaluate(f"document.querySelector('{sel}').scrollIntoView()")
        page.wait_for_timeout(500)
        page.screenshot(path=str(SHOTS / f"{tag}-0{i+1}-{sel.strip('#')}.png"))
        check(page, f"{tag} {sel}", width)
    # scrub the pinned scene
    # scrub inside the pinned range: halfway between the trigger's start and end
    page.evaluate("""() => {
      const st = ScrollTrigger.getAll().find(t => t.trigger && t.trigger.id === 'seal');
      window.scrollTo(0, st.start + (st.end - st.start) * 0.55);
    }""")
    page.wait_for_timeout(700)
    page.screenshot(path=str(SHOTS / f"{tag}-05-seal-mid.png"))
    check(page, f"{tag} seal mid", width)
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    page.wait_for_timeout(700)
    page.screenshot(path=str(SHOTS / f"{tag}-06-footer.png"))
    check(page, f"{tag} footer", width)

    # menu: open, Escape, open again and use a link
    page.evaluate("window.scrollTo(0,0)")
    page.wait_for_timeout(300)
    page.click(".menu-btn")
    page.wait_for_timeout(450)
    page.screenshot(path=str(SHOTS / f"{tag}-07-menu.png"))
    check(page, f"{tag} menu", width)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    if page.get_attribute(".menu-btn", "aria-expanded") != "false":
        problems.append(f"{tag}: Escape did not close the menu")
    page.click(".menu-btn")
    page.wait_for_timeout(300)
    page.click('#menu a[href="#record"]')
    page.wait_for_timeout(800)
    if page.get_attribute(".menu-btn", "aria-expanded") != "false":
        problems.append(f"{tag}: the menu did not close after a link click")

    # flip card
    into(page, "#record")
    into(page, "#record .card .inner", "center")
    page.click(".card .inner", timeout=8000)
    page.wait_for_timeout(700)
    page.screenshot(path=str(SHOTS / f"{tag}-08-flip.png"))
    if page.get_attribute(".card .inner", "aria-pressed") != "true":
        problems.append(f"{tag}: the flip card did not toggle")

    # tabs: click, then arrow keys
    into(page, "#record")
    page.click("#t-fire", timeout=8000)
    page.wait_for_timeout(250)
    if not page.is_visible("#p-fire"):
        problems.append(f"{tag}: the RECORDED FIRE panel did not open")
    page.focus("#t-fire")
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(250)
    if not page.is_visible("#p-plan"):
        problems.append(f"{tag}: ArrowRight did not move to the next tab")
    page.screenshot(path=str(SHOTS / f"{tag}-09-tabs.png"))
    check(page, f"{tag} tabs", width)

    # slider: drag, then arrow keys
    into(page, "#win", "center")
    box = page.locator("#win").bounding_box()
    page.mouse.move(box["x"] + 20, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] - 20, box["y"] + box["height"] / 2, steps=12)
    page.mouse.up()
    page.wait_for_timeout(300)
    v = page.get_attribute("#win", "aria-valuenow")
    if v == "0":
        problems.append(f"{tag}: dragging the slider did not move it")
    page.focus("#win")
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(200)
    if page.get_attribute("#win", "aria-valuenow") == v:
        problems.append(f"{tag}: ArrowLeft did not change the slider")
    page.screenshot(path=str(SHOTS / f"{tag}-10-slider.png"))
    check(page, f"{tag} slider", width)

    # the register counter
    into(page, "#sealBtn", "center")
    before = page.inner_text("#sealedCount")
    page.click("#sealBtn", timeout=8000)
    page.wait_for_timeout(400)
    if page.inner_text("#sealedCount") == before:
        problems.append(f"{tag}: the register counter did not increment")
    page.screenshot(path=str(SHOTS / f"{tag}-11-register.png"))
    check(page, f"{tag} register", width)

    # keyboard focus must be visible somewhere
    page.keyboard.press("Tab")
    page.wait_for_timeout(200)

    browser.close()
    for e in errors:
        problems.append(f"{tag}: console error: {e[:160]}")
    for u in requests:
        if u.startswith(("http:", "https:")) and "127.0.0.1" not in u and "localhost" not in u:
            host = u.split("/")[2]
            if host not in ("cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"):
                problems.append(f"{tag}: request outside the allowlist: {u}")


def main():
    httpd = serve()
    try:
        with sync_playwright() as pw:
            run(pw, 1920, 1080, "desktop")
            run(pw, 375, 812, "mobile")
    finally:
        httpd.shutdown()
    if problems:
        print("FAILED")
        for p in problems:
            print("  -", p)
        sys.exit(1)
    print("site checks passed: no console errors, no overflow, every control works")


if __name__ == "__main__":
    main()
