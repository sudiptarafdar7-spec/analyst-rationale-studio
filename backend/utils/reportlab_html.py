"""Convert the PDF-template rich HTML (from TipTap) into reportlab flowables.

Handles the subset TipTap produces: <p>, <h1>-<h3>, <strong>/<b>, <em>/<i>,
<u>, <a href>, <br>, <ul>/<ol>/<li>. Inline formatting maps onto reportlab's
Paragraph mini-markup; block elements become Paragraph / ListFlowable flowables.
"""
from __future__ import annotations

import re
from html.parser import HTMLParser
from html import unescape

from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import ListFlowable, ListItem, Paragraph, Spacer

_INLINE_OPEN = {"strong": "<b>", "b": "<b>", "em": "<i>", "i": "<i>", "u": "<u>"}
_INLINE_CLOSE = {"strong": "</b>", "b": "</b>", "em": "</i>", "i": "</i>", "u": "</u>"}


def extract_html_content(html: str | None) -> str:
    """Strip tags to plain text (for places that can't render markup)."""
    if not html:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", html, flags=re.I)
    text = re.sub(r"</(p|div|li|h[1-6])>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return unescape(text).strip()


class _Builder(HTMLParser):
    """Walks the HTML and produces (kind, inline_markup) block tuples."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[tuple[str, str]] = []
        self._buf: list[str] = []
        self._block_kind = "p"
        self._list_stack: list[str] = []

    # -- helpers --
    def _flush(self) -> None:
        markup = "".join(self._buf).strip()
        if markup:
            self.blocks.append((self._block_kind, markup))
        self._buf = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in _INLINE_OPEN:
            self._buf.append(_INLINE_OPEN[tag])
        elif tag == "a":
            href = dict(attrs).get("href", "")
            self._buf.append(f'<a href="{href}"><font color="#6C4CF1">' if href else "")
        elif tag == "br":
            self._buf.append("<br/>")
        elif tag in ("p", "h1", "h2", "h3"):
            self._flush()
            self._block_kind = tag
        elif tag in ("ul", "ol"):
            self._flush()
            self._list_stack.append(tag)
        elif tag == "li":
            self._flush()
            self._block_kind = "li-" + (self._list_stack[-1] if self._list_stack else "ul")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in _INLINE_CLOSE:
            self._buf.append(_INLINE_CLOSE[tag])
        elif tag == "a":
            if self._buf:
                self._buf.append("</font></a>")
        elif tag in ("p", "h1", "h2", "h3", "li"):
            self._flush()
            self._block_kind = "p"
        elif tag in ("ul", "ol"):
            self._flush()
            if self._list_stack:
                self._list_stack.pop()

    def handle_data(self, data):
        self._buf.append(data)


def _styles():
    base = getSampleStyleSheet()
    body = ParagraphStyle("RteBody", parent=base["BodyText"], fontSize=9, leading=13, spaceAfter=4)
    h = ParagraphStyle("RteH", parent=base["Heading4"], fontSize=11, leading=14, spaceBefore=6, spaceAfter=3)
    return body, h


def create_html_flowables(html: str | None, body_style=None, heading_style=None) -> list:
    """Return a list of reportlab flowables rendering the given HTML."""
    if not html:
        return []
    b = _Builder()
    b.feed(html)
    b._flush()

    body, h = _styles()
    body_style = body_style or body
    heading_style = heading_style or h

    flowables: list = []
    pending_items: list = []
    pending_kind: str | None = None

    def flush_list():
        nonlocal pending_items, pending_kind
        if pending_items:
            bullet = "1" if (pending_kind or "").endswith("ol") else "bullet"
            flowables.append(ListFlowable(pending_items, bulletType=bullet, leftIndent=14))
            pending_items = []
            pending_kind = None

    for kind, markup in b.blocks:
        if kind.startswith("li-"):
            if pending_kind and pending_kind != kind:
                flush_list()
            pending_kind = kind
            pending_items.append(ListItem(Paragraph(markup, body_style)))
            continue
        flush_list()
        if kind in ("h1", "h2", "h3"):
            flowables.append(Paragraph(markup, heading_style))
        else:
            flowables.append(Paragraph(markup, body_style))
    flush_list()
    return flowables
