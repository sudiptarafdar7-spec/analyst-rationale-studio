"""Runtime for Step 10 — Generate PDF (reportlab).

Ported from the reference premium-blue PDF generator. The reportlab layout
(letterhead, blue stripe, per-stock chart + rationale, disclaimer/disclosure,
footer with channel logo, contact-card grid) is kept faithful to the original.

Changes vs reference:
  * Branding/config is read via SQLAlchemy (jobs/channels/pdf_template/
    uploaded_files) instead of raw psycopg2 + DATABASE_URL.
  * Stored upload paths resolve through utils.path_utils.resolve_uploaded_file_path.
  * Contact cards come from get_effective_config()['contacts'] (admin-tunable),
    with an optional JSON override in pdf_template.company_data.
"""
from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime

import pandas as pd
from PIL import Image as PILImage, ImageDraw
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.platypus import (
    Flowable, Frame, Image, KeepInFrame, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)
from sqlalchemy import select

from db.models import Channel, Job, PdfTemplate, UploadedFile
from db.session import SessionLocal
from tools.step10_generate_pdf.schema import get_effective_config
from utils.path_utils import resolve_uploaded_file_path
from utils.reportlab_html import create_html_flowables


def sanitize_filename(s: str) -> str:
    return str(s).strip().replace(" ", "_").replace(":", "-").replace("/", "-").replace("\\", "-")


def _as_uuid(value):
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


def fetch_pdf_config(job_id, cfg: dict) -> dict:
    """Pull all branding/config for the PDF from the DB via SQLAlchemy."""
    job_uuid = _as_uuid(job_id)
    with SessionLocal() as db:
        job = db.get(Job, job_uuid) if job_uuid else None
        if not job:
            raise ValueError(f"Job {job_id} not found")

        channel = db.get(Channel, job.channel_id) if job.channel_id else None
        channel_name = channel.channel_name if channel else "Platform"
        platform = (channel.platform if channel and channel.platform else "Youtube")
        channel_logo_path = resolve_uploaded_file_path(channel.channel_logo_path) if channel and channel.channel_logo_path else None
        if channel_logo_path and not os.path.exists(channel_logo_path):
            print(f"⚠️ Channel logo not found: {channel_logo_path}")
            channel_logo_path = None

        tpl = db.scalar(select(PdfTemplate).order_by(PdfTemplate.created_at.desc()))
        if tpl:
            company_name = tpl.company_name or cfg["fallback_company_name"]
            registration_details = tpl.registration_details or cfg["fallback_registration"]
            design_cfg = tpl.design or {}
        else:
            company_name = cfg["fallback_company_name"]
            registration_details = cfg["fallback_registration"]
            design_cfg = {}

        company_logo_path = font_regular_path = font_bold_path = None
        from db.enums import UploadedFileType
        files = db.scalars(
            select(UploadedFile)
            .where(UploadedFile.file_type.in_([UploadedFileType.companyLogo, UploadedFileType.customFont]))
            .order_by(UploadedFile.uploaded_at.desc())
        ).all()
        for f in files:
            ftype = f.file_type.value if hasattr(f.file_type, "value") else str(f.file_type)
            if ftype == "companyLogo" and not company_logo_path:
                company_logo_path = resolve_uploaded_file_path(f.file_path)
            elif ftype == "customFont":
                if "bold" in (f.file_name or "").lower() and not font_bold_path:
                    font_bold_path = resolve_uploaded_file_path(f.file_path)
                elif not font_regular_path:
                    font_regular_path = resolve_uploaded_file_path(f.file_path)

        input_date_str = None
        if job.video_date:
            input_date_str = job.video_date.strftime("%Y-%m-%d") if hasattr(job.video_date, "strftime") else str(job.video_date)

    contacts = cfg.get("contacts", [])

    return {
        "channel_name": channel_name,
        "channel_logo_path": channel_logo_path,
        "title": job.title or "Rationale Report",
        "input_date": input_date_str,
        "youtube_url": job.youtube_url or "",
        "platform": platform,
        "company_name": company_name,
        "registration_details": registration_details,
        "disclaimer_text": None,
        "design": design_cfg,
        "disclosure_text": None,
        "company_logo_path": company_logo_path,
        "font_regular_path": font_regular_path,
        "font_bold_path": font_bold_path,
        "contacts": contacts,
    }


def make_round_logo(src_path, diameter_px=360):
    try:
        im = PILImage.open(src_path).convert("RGBA")
        side = min(im.size)
        x0 = (im.width - side) // 2
        y0 = (im.height - side) // 2
        im = im.crop((x0, y0, x0 + side, y0 + side)).resize((diameter_px, diameter_px), PILImage.LANCZOS)
        mask = PILImage.new("L", (diameter_px, diameter_px), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, diameter_px, diameter_px), fill=255)
        out = PILImage.new("RGBA", (diameter_px, diameter_px), (255, 255, 255, 0))
        out.paste(im, (0, 0), mask=mask)
        tmp_path = os.path.join(os.path.dirname(src_path), "_round_platform_logo.png")
        out.save(tmp_path, "PNG")
        return tmp_path
    except Exception as e:
        print(f"⚠️ Could not create round logo: {e}")
        return src_path


def run(job_folder, overrides=None, config_override=None):
    """Generate the professional compliance PDF from stocks_with_charts.csv."""
    print("\n" + "=" * 60)
    print("STEP 10: GENERATE PDF")
    print("=" * 60 + "\n")
    try:
        cfg = get_effective_config(overrides)
        job_id = os.path.basename(job_folder.rstrip("/\\"))
        stocks_csv = os.path.join(job_folder, "analysis", "stocks_with_charts.csv")
        if not os.path.exists(stocks_csv):
            return {"success": False, "error": f"Input file not found: {stocks_csv}"}

        df = pd.read_csv(stocks_csv, encoding="utf-8-sig")
        print(f"✅ Loaded {len(df)} stocks")

        config = config_override if config_override is not None else fetch_pdf_config(job_id, cfg)
        print(f"✅ Platform: {config['channel_name']} | Report: {config['title']}")
        _dbg = config.get("design") or {}
        _path = ("page-builder" if (_dbg.get("stock_pages") or _dbg.get("fixed_pages") or _dbg.get("pages"))
                 else "absolute" if _dbg.get("layout_mode") == "absolute" else "flow")
        print(f"🎨 PDF design: {_path} (pages={len(_dbg.get('pages') or [])}, stock_pages={len(_dbg.get('stock_pages') or [])}, fixed_pages={len(_dbg.get('fixed_pages') or [])})")

        input_date = config.get("input_date", "")
        try:
            date_str = datetime.strptime(input_date, "%Y-%m-%d").strftime("%d-%m-%Y") if input_date else datetime.now().strftime("%d-%m-%Y")
        except ValueError:
            date_str = datetime.now().strftime("%d-%m-%Y")

        pdf_filename = f"{sanitize_filename(config['channel_name'])}-{date_str}.pdf"
        output_pdf = os.path.join(job_folder, "pdf", pdf_filename)
        os.makedirs(os.path.dirname(output_pdf), exist_ok=True)

        BASE_REG, BASE_BLD = "NotoSans", "NotoSans-Bold"
        if config["font_regular_path"] and os.path.exists(config["font_regular_path"]):
            pdfmetrics.registerFont(TTFont(BASE_REG, config["font_regular_path"]))
        else:
            BASE_REG = "Helvetica"
        if config["font_bold_path"] and os.path.exists(config["font_bold_path"]):
            pdfmetrics.registerFont(TTFont(BASE_BLD, config["font_bold_path"]))
        else:
            BASE_BLD = "Helvetica-Bold"
        try:
            from reportlab.pdfbase.pdfmetrics import registerFontFamily
            registerFontFamily(BASE_REG, normal=BASE_REG, bold=BASE_BLD, italic=BASE_REG, boldItalic=BASE_BLD)
        except Exception:
            pass

        DESIGN = config.get("design") or {}
        _ELS = DESIGN.get("elements") or {}

        def _el(key):
            return _ELS.get(key) or {}

        def _hexc(v, default):
            try:
                return colors.HexColor(v) if v else colors.HexColor(default)
            except Exception:
                return colors.HexColor(default)

        _ALIGN = {"left": TA_LEFT, "center": TA_CENTER, "right": TA_RIGHT, "justify": TA_JUSTIFY}

        def _num(v, default):
            try:
                return float(v)
            except (TypeError, ValueError):
                return float(default)

        BLUE = _hexc(DESIGN.get("theme_color"), cfg.get("theme_color", "#6C4CF1"))
        PAGE_W, PAGE_H = A4
        M_L, M_R, M_T, M_B = 44, 44, 96, 52
        styles = getSampleStyleSheet()

        def PS(name, **kw):
            kw.setdefault("fontName", BASE_REG)
            return ParagraphStyle(name, parent=styles["Normal"], **kw)

        _t = _el("title")
        subheading_style = PS("subheading", fontSize=_num(_t.get("size"), 16), leading=_num(_t.get("size"), 16) + 4,
                              textColor=_hexc(_t.get("color"), "#000000"),
                              spaceAfter=10, spaceBefore=6, alignment=_ALIGN.get(_t.get("align"), TA_LEFT),
                              fontName=BASE_REG if _t.get("weight") == "normal" else BASE_BLD)
        small_grey = PS("small_grey", fontSize=9.2, leading=12, textColor=colors.HexColor("#666666"))
        _b = _el("overview_text")
        body_style = PS("body_style", fontSize=_num(_b.get("size"), 10.8), leading=_num(_b.get("size"), 10.8) * 1.44,
                        spaceAfter=10, alignment=_ALIGN.get(_b.get("align"), TA_JUSTIFY),
                        textColor=_hexc(_b.get("color"), "#000000"))
        _ov = _el("overview_label")
        _ov_color = _hexc(_ov.get("color"), None) if _ov.get("color") else BLUE
        _ov_text = _ov.get("text") or "OUR GENERAL VIEW"
        label_style = PS("label_style", fontSize=_num(_ov.get("size"), 11), leading=14.5, spaceAfter=4, alignment=TA_LEFT,
                         textColor=_ov_color, fontName=BASE_BLD)
        date_bold = PS("date_bold", fontSize=11, leading=13.5, alignment=TA_RIGHT,
                       textColor=colors.black, fontName=BASE_BLD)
        indented_body = PS("indented_body", fontSize=10.8, leading=15.6, spaceAfter=10,
                           alignment=TA_JUSTIFY, leftIndent=10, rightIndent=10)

        class RoundedHeading(Flowable):
            def __init__(self, text, fontName=BASE_BLD, fontSize=14.5, pad_x=14, pad_y=11,
                         radius=0, bg=BLUE, fg=colors.white, width=None, align="left"):
                Flowable.__init__(self)
                self.text, self.fontName, self.fontSize = text, fontName, fontSize
                self.pad_x, self.pad_y, self.radius = pad_x, pad_y, radius
                self.bg, self.fg, self.width, self.align = bg, fg, width, align

            def wrap(self, availWidth, availHeight):
                self.eff_width = self.width or availWidth
                self.eff_height = self.fontSize + 2 * self.pad_y
                return self.eff_width, self.eff_height

            def draw(self):
                c = self.canv
                w, h = self.eff_width, self.eff_height
                c.saveState()
                c.setFillColor(self.bg)
                c.setStrokeColor(self.bg)
                c.rect(0, 0, w, h, fill=1, stroke=0)
                c.setFillColor(self.fg)
                c.setFont(self.fontName, self.fontSize)
                c.drawString(self.pad_x, (h - self.fontSize) / 2.0, self.text)
                c.restoreState()

        def heading(text):
            return RoundedHeading(text, width=(PAGE_W - M_L - M_R), align="left")

        ROUND_LOGO = None
        if config["channel_logo_path"] and os.path.exists(config["channel_logo_path"]):
            try:
                lp = make_round_logo(config["channel_logo_path"])
                if lp and os.path.exists(lp):
                    ROUND_LOGO = lp
            except Exception as e:
                print(f"⚠️ Could not create round logo: {e}")

        def draw_letterhead(c):
            header_h = 72
            c.setFillColor(BLUE)
            c.rect(0, PAGE_H - header_h, PAGE_W, header_h, fill=1, stroke=0)
            _cn = _el("company_name")
            c.setFillColor(_hexc(_cn.get("color"), "#FFFFFF"))
            c.setFont(BASE_BLD, _num(_cn.get("size"), 13.5))
            c.drawString(40, PAGE_H - 30, config["company_name"])
            c.setFont(BASE_REG, 7.5)
            reg_text = config["registration_details"] or ""
            if "<" in reg_text and ">" in reg_text:
                reg_text = " ".join(re.sub(r"<[^>]+>", " ", reg_text).split())
            max_width = PAGE_W - 140
            if "\n" in reg_text:
                reg_lines = reg_text.split("\n")
            elif "|" in reg_text:
                parts = [p.strip() for p in reg_text.split("|")]
                reg_lines, current_line = [], ""
                for part in parts:
                    test_line = current_line + (" | " if current_line else "") + part
                    if c.stringWidth(test_line, BASE_REG, 7.5) <= max_width:
                        current_line = test_line
                    else:
                        if current_line:
                            reg_lines.append(current_line)
                        current_line = part
                if current_line:
                    reg_lines.append(current_line)
            else:
                reg_lines = [reg_text]
            y_pos = PAGE_H - 45
            for line in reg_lines:
                c.drawString(40, y_pos, line)
                y_pos -= 10
            if config["company_logo_path"] and os.path.exists(config["company_logo_path"]):
                try:
                    c.drawImage(config["company_logo_path"], PAGE_W - 90, PAGE_H - 55, 48, 24,
                                preserveAspectRatio=True, mask="auto")
                except Exception as e:
                    print(f"⚠️ Could not draw company logo: {e}")

        def draw_blue_stripe_header(c):
            stripe_h = 20
            c.setFillColor(BLUE)
            c.rect(0, PAGE_H - stripe_h, PAGE_W, stripe_h, fill=1, stroke=0)

        def draw_footer(c):
            c.setFont(BASE_REG, 8.5)
            c.setFillColor(colors.black)
            if _el("footer_pageno").get("visible", True):
                c.drawCentredString(PAGE_W / 2.0, 16, f"Page {c.getPageNumber()}")
            left_x, baseline_y, logo_sz = M_L, 34, 24
            cur_x = left_x
            if ROUND_LOGO and os.path.exists(ROUND_LOGO):
                try:
                    c.drawImage(ROUND_LOGO, cur_x, baseline_y - logo_sz / 2 - 2, logo_sz, logo_sz,
                                preserveAspectRatio=True, mask="auto")
                    cur_x += logo_sz + 8
                except Exception:
                    c.setStrokeColor(BLUE)
                    c.circle(cur_x + logo_sz / 2, baseline_y, logo_sz / 2, stroke=1, fill=0)
                    cur_x += logo_sz + 8
            else:
                c.setStrokeColor(BLUE)
                c.circle(cur_x + logo_sz / 2, baseline_y, logo_sz / 2, stroke=1, fill=0)
                cur_x += logo_sz + 8
            c.setFillColor(BLUE)
            c.setFont(BASE_BLD, 9)
            if _el("footer_channel").get("visible", True):
                c.drawString(cur_x, baseline_y + 5, config["channel_name"])
            c.setFont(BASE_REG, 8)
            c.setFillColor(colors.HexColor("#666666"))
            if _el("footer_platform").get("visible", True):
                c.drawString(cur_x, baseline_y - 7, config.get("platform", "Youtube"))
            youtube_url = config.get("youtube_url", "")
            if youtube_url and _el("footer_url").get("visible", True):
                c.setFont(BASE_REG, 7)
                c.setFillColor(colors.HexColor("#444444"))
                display_url = youtube_url
                max_url_width = PAGE_W - M_L - M_R - 150
                if c.stringWidth(display_url, BASE_REG, 7) > max_url_width:
                    display_url = display_url[:55] + "..."
                url_width = c.stringWidth(display_url, BASE_REG, 7)
                c.drawString(PAGE_W - M_R - url_width, baseline_y - 1, display_url)

        def on_first_page(c, d):
            draw_letterhead(c)
            draw_footer(c)

        def on_later_pages(c, d):
            draw_blue_stripe_header(c)
            draw_footer(c)

        # ---- Page-based builder: stock_pages (repeated per stock) + fixed_pages ----
        if DESIGN.get("stock_pages") or DESIGN.get("fixed_pages") or DESIGN.get("pages"):
            import xml.sax.saxutils as _sx
            theme_hex = DESIGN.get("theme_color") or cfg.get("theme_color", "#6C4CF1")
            FLOW_FIELDS = {"analysis", "disclaimer", "disclosure"}

            def _esc(t):
                return _sx.escape(str(t if t is not None else ""))

            def _strip_html(t):
                t = t or ""
                if "<" in t and ">" in t:
                    t = " ".join(re.sub(r"<[^>]+>", " ", t).split())
                return t

            def _box(el):
                x = _num(el.get("x"), 0) / 100.0 * PAGE_W
                w = _num(el.get("w"), 10) / 100.0 * PAGE_W
                h = _num(el.get("h"), 5) / 100.0 * PAGE_H
                y_top = _num(el.get("y"), 0) / 100.0 * PAGE_H
                return x, PAGE_H - y_top - h, w, h

            def _pads(el):
                base = max(0.0, _num(el.get("pad"), 2))
                return (_num(el.get("padL"), base), _num(el.get("padR"), base),
                        _num(el.get("padT"), base), _num(el.get("padB"), base))

            def _frame_remainder(c, x, y, w, h, flowables, pads=(2, 2, 2, 2)):
                """Draw flowables into the box; return whatever did not fit."""
                pl, pr, pt, pb = pads
                rem = list(flowables)
                try:
                    Frame(x, y, w, h, leftPadding=pl, rightPadding=pr, topPadding=pt,
                          bottomPadding=pb, showBoundary=0).addFromList(rem, c)
                except Exception as _e:
                    print(f"  (element draw issue: {_e})")
                return rem

            def _field_text(key, row):
                rv = (lambda col: str(row.get(col, "") or "").strip() if row is not None else "")
                return {
                    "stock_name": rv("LISTED NAME") or rv("INPUT STOCK"),
                    "stock_symbol": rv("STOCK SYMBOL"),
                    "short_name": rv("SHORT NAME"),
                    "date": rv("DATE"),
                    "analysis": rv("ANALYSIS"),
                    "company_name": config.get("company_name", ""),
                    "registration": _strip_html(config.get("registration_details")),
                    "channel": config.get("channel_name", ""),
                    "platform": config.get("platform", ""),
                    "url": config.get("youtube_url", ""),
                }.get(key, "")

            def _field_image(key, row):
                if key == "chart":
                    pth = str(row.get("CHART PATH", "") or "").strip() if row is not None else ""
                    if pth and not os.path.isabs(pth):
                        pth = os.path.join(job_folder, pth)
                    return pth
                if key == "logo":
                    return config.get("company_logo_path")
                if key == "channel_logo":
                    return config.get("channel_logo_path")
                return None

            def _font_pair(el):
                return {"serif": ("Times-Roman", "Times-Bold"),
                        "mono": ("Courier", "Courier-Bold")}.get(el.get("font", "sans"), (BASE_REG, BASE_BLD))

            def _rich_styles(el):
                reg, bld = _font_pair(el)
                sz = _num(el.get("size"), 10)
                col = _hexc(el.get("color"), "#111111")
                al = _ALIGN.get(el.get("align"), TA_LEFT)
                lh = _num(el.get("lh"), 1.34)
                try:
                    from reportlab.pdfbase.pdfmetrics import registerFontFamily
                    registerFontFamily(reg, normal=reg, bold=bld, italic=reg, boldItalic=bld)
                except Exception:
                    pass
                body = PS("rb" + os.urandom(3).hex(), fontName=reg, fontSize=sz, leading=sz * lh,
                          textColor=col, alignment=al, spaceAfter=sz * 0.45)
                head = PS("rh" + os.urandom(3).hex(), fontName=bld, fontSize=sz * 1.4, leading=sz * 1.4 * 1.2,
                          textColor=col, alignment=al, spaceBefore=sz * 0.6, spaceAfter=sz * 0.3)
                return body, head

            def _draw_el(c, el, row, pageno):
                """Draw one element. Returns leftover flowables for overflow fields, else None."""
                if el.get("visible", True) is False:
                    return None
                typ = el.get("type", "text")
                x, y, w, h = _box(el)
                pl, pr, pt, pb = _pads(el)
                opacity = _num(el.get("opacity"), 1)

                # drop shadow (offset translucent rect)
                if el.get("shadow"):
                    c.saveState()
                    c.setFillColor(colors.HexColor("#000000"))
                    c.setFillAlpha(0.18)
                    c.rect(x + 2.5, y - 2.5, w, h, fill=1, stroke=0)
                    c.restoreState()

                # background
                if el.get("bg"):
                    c.saveState()
                    c.setFillAlpha(opacity)
                    c.setFillColor(_hexc(el.get("bg"), "#ffffff"))
                    c.rect(x, y, w, h, fill=1, stroke=0)
                    c.restoreState()

                def _borders():
                    allw = _num(el.get("borderW"), 0)
                    sides = {
                        "L": _num(el.get("bL"), allw), "R": _num(el.get("bR"), allw),
                        "T": _num(el.get("bT"), allw), "B": _num(el.get("bB"), allw),
                    }
                    col = _hexc(el.get("borderColor"), "#cccccc")
                    if not any(v > 0 for v in sides.values()):
                        return
                    c.saveState()
                    c.setStrokeColor(col)
                    c.setStrokeAlpha(opacity)
                    for side, wd in sides.items():
                        if wd <= 0:
                            continue
                        c.setLineWidth(wd)
                        if side == "L":
                            c.line(x, y, x, y + h)
                        elif side == "R":
                            c.line(x + w, y, x + w, y + h)
                        elif side == "T":
                            c.line(x, y + h, x + w, y + h)
                        else:
                            c.line(x, y, x + w, y)
                    c.restoreState()

                if typ == "image":
                    pth = _field_image(el.get("field", "chart"), row)
                    iw = w * _num(el.get("imgW"), 100) / 100.0
                    ih = h * _num(el.get("imgH"), 100) / 100.0
                    ix, iy = x + (w - iw) / 2, y + (h - ih) / 2
                    if pth and os.path.exists(pth):
                        try:
                            c.saveState()
                            c.setFillAlpha(opacity)
                            c.drawImage(pth, ix, iy, iw, ih, preserveAspectRatio=True, anchor="c", mask="auto")
                            c.restoreState()
                        except Exception:
                            pass
                    _borders()
                    return None

                _borders()
                if typ == "box":
                    return None

                key = el.get("field")
                pads = (pl, pr, pt, pb)
                # rich / long content: render HTML or analysis with page overflow
                if typ == "richtext":
                    html = el.get("html") or ""
                    if not html.strip():
                        return None
                    bs, hs = _rich_styles(el)
                    c.saveState(); c.setFillAlpha(opacity)
                    rem = _frame_remainder(c, x, y, w, h, create_html_flowables(html, bs, hs), pads=pads)
                    c.restoreState()
                    return rem or None
                if typ == "field" and key in ("disclaimer", "disclosure"):
                    html = config.get(f"{key}_text")
                    if not html:
                        return None
                    bs, hs = _rich_styles(el)
                    c.saveState(); c.setFillAlpha(opacity)
                    rem = _frame_remainder(c, x, y, w, h, create_html_flowables(html, bs, hs), pads=pads)
                    c.restoreState()
                    return rem or None

                if typ == "field" and key == "page_no":
                    text = f"Page {pageno}"
                elif typ == "field":
                    text = _field_text(key, row)
                else:
                    text = el.get("text", "")
                if not str(text).strip():
                    return None

                dsize = 17 if typ == "heading" else 10.8
                sz = _num(el.get("size"), dsize)
                reg, bld = _font_pair(el)
                is_bold = el.get("weight", "bold" if typ == "heading" else "normal") == "bold"
                style = PS("pg_" + os.urandom(4).hex(), fontSize=sz, leading=sz * _num(el.get("lh"), 1.32),
                           textColor=_hexc(el.get("color"), "#111111"),
                           alignment=_ALIGN.get(el.get("align"), TA_LEFT),
                           fontName=bld if is_bold else reg)
                markup = _esc(text)
                if el.get("italic"):
                    markup = f"<i>{markup}</i>"
                if el.get("underline"):
                    markup = f"<u>{markup}</u>"
                para = Paragraph(markup, style)

                # analysis flows across pages; other single fields fit their box (never vanish)
                if typ == "field" and key in FLOW_FIELDS:
                    c.saveState(); c.setFillAlpha(opacity)
                    rem = _frame_remainder(c, x, y, w, h, [para], pads=pads)
                    c.restoreState()
                    return rem or None

                # inline width: shrink the box to the text width
                bw, bh = w, h
                if el.get("widthMode") == "inline":
                    try:
                        tw = c.stringWidth(re.sub(r"<[^>]+>", "", text), style.fontName, sz) + pl + pr + 2
                        bw = min(max(tw, 6), PAGE_W - x)
                    except Exception:
                        pass
                inner_w = max(2, bw - pl - pr)
                inner_h = max(2, bh - pt - pb)
                c.saveState(); c.setFillAlpha(opacity)
                try:
                    Frame(x, y, bw, bh, leftPadding=pl, rightPadding=pr, topPadding=pt, bottomPadding=pb,
                          showBoundary=0).addFromList([KeepInFrame(inner_w, inner_h, [para], mode="shrink")], c)
                except Exception as _e:
                    try:
                        c.setFillColor(_hexc(el.get("color"), "#111111"))
                        c.setFont(style.fontName, sz)
                        c.drawString(x + pl, y + bh - pt - sz, re.sub(r"<[^>]+>", "", text)[:200])
                    except Exception:
                        pass
                c.restoreState()
                return None

            def _draw_page(c, pg, row, pageno):
                if pg.get("bg"):
                    c.setFillColor(_hexc(pg.get("bg"), "#ffffff"))
                    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
                overflow = []
                for el in pg.get("elements", []):
                    rem = _draw_el(c, el, row, pageno)
                    if rem:
                        overflow.append(rem)
                return overflow

            def _continue(c, remaining):
                """Word-style overflow: keep adding full pages until the content is drawn."""
                MGN = 42
                guard = 0
                while remaining and guard < 60:
                    fid, flen = id(remaining[0]), len(remaining)
                    c.showPage()
                    try:
                        Frame(MGN, MGN, PAGE_W - 2 * MGN, PAGE_H - 2 * MGN, leftPadding=2,
                              rightPadding=2, topPadding=4, bottomPadding=4, showBoundary=0).addFromList(remaining, c)
                    except Exception:
                        pass
                    guard += 1
                    if remaining and id(remaining[0]) == fid and len(remaining) == flen:
                        remaining.pop(0)  # un-splittable item; drop to avoid an infinite loop

            c = pdfcanvas.Canvas(output_pdf, pagesize=A4)
            pageno = 0
            unified = DESIGN.get("pages")
            if unified:
                stock_defs = [pg for pg in unified if pg.get("kind", "stock") == "stock"]
                fixed_defs = [pg for pg in unified if pg.get("kind") == "fixed"]
                for i, (_, row) in enumerate(df.iterrows()):
                    for pg in stock_defs:
                        wh = pg.get("when", "all")
                        if wh == "all" or (wh == "first" and i == 0) or (wh == "rest" and i > 0):
                            pageno += 1
                            for rem in _draw_page(c, pg, row, pageno):
                                _continue(c, rem)
                            c.showPage()
                for pg in fixed_defs:
                    pageno += 1
                    for rem in _draw_page(c, pg, None, pageno):
                        _continue(c, rem)
                    c.showPage()
            else:
                stock_pages = DESIGN.get("stock_pages") or []
                fixed_pages = DESIGN.get("fixed_pages") or []
                for _, row in df.iterrows():
                    for pg in stock_pages:
                        pageno += 1
                        for rem in _draw_page(c, pg, row, pageno):
                            _continue(c, rem)
                        c.showPage()
                for pg in fixed_pages:
                    pageno += 1
                    for rem in _draw_page(c, pg, None, pageno):
                        _continue(c, rem)
                    c.showPage()
            if pageno == 0:
                c.showPage()
            c.save()
            print(f"\u2705 PDF generated (page builder): {output_pdf}")
            return {"success": True, "output_file": output_pdf}

        # ---- Absolute (free-form) layout: builder X/Y/W/H drive the PDF ----
        if DESIGN.get("layout_mode") == "absolute":
            import xml.sax.saxutils as _sx
            theme_hex = DESIGN.get("theme_color") or cfg.get("theme_color", "#6C4CF1")

            def _esc(t):
                return _sx.escape(str(t if t is not None else ""))

            def _strip_html(t):
                t = t or ""
                if "<" in t and ">" in t:
                    t = " ".join(re.sub(r"<[^>]+>", " ", t).split())
                return t

            def _box(el):
                x = _num(el.get("x"), 0) / 100.0 * PAGE_W
                w = _num(el.get("w"), 10) / 100.0 * PAGE_W
                h = _num(el.get("h"), 5) / 100.0 * PAGE_H
                y_top = _num(el.get("y"), 0) / 100.0 * PAGE_H
                return x, PAGE_H - y_top - h, w, h

            def _astyle(el, dsize, dcolor, dalign, dbold):
                sz = _num(el.get("size"), dsize)
                return PS("abs_" + os.urandom(4).hex(), fontSize=sz, leading=sz * 1.3,
                          textColor=_hexc(el.get("color"), dcolor),
                          alignment=_ALIGN.get(el.get("align"), _ALIGN.get(dalign, TA_LEFT)),
                          fontName=BASE_BLD if el.get("weight", "bold" if dbold else "normal") == "bold" else BASE_REG)

            def _frame_draw(c, x, y, w, h, flowables, pad=2):
                try:
                    Frame(x, y, w, h, leftPadding=pad, rightPadding=pad, topPadding=pad,
                          bottomPadding=pad, showBoundary=0).addFromList(list(flowables), c)
                except Exception as _e:
                    print(f"  (skip overflow element: {_e})")

            def _text(c, key, text, dsize, dcolor, dalign="left", dbold=False):
                el = _el(key)
                if el.get("visible", True) is False or not str(text).strip():
                    return
                x, y, w, h = _box(el)
                _frame_draw(c, x, y, w, h, [Paragraph(_esc(text), _astyle(el, dsize, dcolor, dalign, dbold))], pad=1)

            def _flow(c, key, flowables):
                el = _el(key)
                if el.get("visible", True) is False or not flowables:
                    return
                x, y, w, h = _box(el)
                _frame_draw(c, x, y, w, h, flowables)

            def _band(c, key, default_bg):
                el = _el(key)
                if el.get("visible", True) is False:
                    return
                x, y, w, h = _box(el)
                c.setFillColor(_hexc(el.get("bg"), default_bg))
                c.rect(x, y, w, h, fill=1, stroke=0)

            def _img(c, key, path):
                el = _el(key)
                if el.get("visible", True) is False or not path or not os.path.exists(path):
                    return
                x, y, w, h = _box(el)
                try:
                    c.drawImage(path, x, y, w, h, preserveAspectRatio=True, anchor="c", mask="auto")
                except Exception:
                    pass
                bw = _num(el.get("borderW"), 0)
                if bw > 0:
                    c.setStrokeColor(_hexc(el.get("borderColor"), "#cccccc"))
                    c.setLineWidth(bw)
                    c.rect(x, y, w, h, fill=0, stroke=1)

            c = pdfcanvas.Canvas(output_pdf, pagesize=A4)
            reg_text = _strip_html(config.get("registration_details"))
            for idx, (_, row) in enumerate(df.iterrows()):
                _band(c, "header", theme_hex)
                _text(c, "company_name", _el("company_name").get("text") or config["company_name"], 13.5, "#ffffff", "left", True)
                _text(c, "registration", _el("registration").get("text") or reg_text, 7.5, "#ffffff", "left", False)
                _img(c, "logo", config.get("company_logo_path"))
                date_val = str(row.get("DATE", "") or "").strip()
                _text(c, "date", f"Date: {date_val}" if date_val else (_el("date").get("text") or ""), 11, "#111111", "right", True)
                listed = str(row.get("LISTED NAME", row.get("INPUT STOCK", "")) or "").strip()
                symbol = str(row.get("STOCK SYMBOL", "") or "").strip()
                _text(c, "title", f"{listed} ({symbol})" if symbol else listed, 16, "#111111", "left", True)
                ch_path = str(row.get("CHART PATH", "") or "").strip()
                if ch_path and not os.path.isabs(ch_path):
                    ch_path = os.path.join(job_folder, ch_path)
                _img(c, "chart", ch_path)
                _text(c, "overview_label", _el("overview_label").get("text") or "OUR GENERAL VIEW", 11, theme_hex, "left", True)
                _text(c, "overview_text", str(row.get("ANALYSIS", "") or "").strip(), 10.8, "#222222", "justify", False)
                _text(c, "footer_channel", _el("footer_channel").get("text") or config["channel_name"], 9, theme_hex, "left", True)
                _text(c, "footer_platform", _el("footer_platform").get("text") or config.get("platform", ""), 8, "#666666", "left", False)
                if config.get("youtube_url"):
                    _text(c, "footer_url", _el("footer_url").get("text") or config["youtube_url"], 7, "#444444", "right", False)
                _text(c, "footer_pageno", f"Page {idx + 1}", 8.5, "#111111", "center", False)
                c.showPage()

            drew_final = False
            if config.get("disclaimer_text"):
                _flow(c, "disclaimer", create_html_flowables(config["disclaimer_text"], indented_body)); drew_final = True
            if config.get("disclosure_text"):
                _flow(c, "disclosure", create_html_flowables(config["disclosure_text"], indented_body)); drew_final = True
            sg = _el("sign_area")
            if sg.get("visible"):
                x, y, w, h = _box(sg)
                sigp = PS("abs_sig" + os.urandom(3).hex(), fontSize=_num(sg.get("size"), 10), leading=14, textColor=_hexc(sg.get("color"), "#444444"))
                _frame_draw(c, x, y, w, h, [
                    Paragraph(_esc(sg.get("text") or "Authorised Signatory"), sigp),
                    Spacer(1, 24),
                    Paragraph("_______________________________", sigp),
                    Paragraph(_esc(sg.get("subtext") or "Signature & Date"), sigp),
                ]); drew_final = True
            if drew_final:
                c.showPage()
            c.save()
            print(f"\u2705 PDF generated (absolute layout): {output_pdf}")
            return {"success": True, "output_file": output_pdf}

        doc = SimpleDocTemplate(output_pdf, pagesize=A4, leftMargin=M_L, rightMargin=M_R,
                                topMargin=M_T, bottomMargin=M_B, title=config["title"])
        story = []

        def positional_date_header(date_text):
            total_w = PAGE_W - M_L - M_R
            left_w = total_w * 0.40
            right_w = total_w - left_w
            left_chip = RoundedHeading("Positional", fontSize=13.5, pad_x=12, pad_y=10, radius=8,
                                       bg=BLUE, fg=colors.white, width=left_w, align="left")
            right_bits = []
            if date_text:
                right_bits.append(Paragraph(f"<b>Date:</b> {date_text}", date_bold))
            right_stack = Table([[b] for b in right_bits] or [[Spacer(1, 0)]], colWidths=[right_w])
            right_stack.setStyle(TableStyle([
                ("ALIGN", (0, 0), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
            ]))
            tbl = Table([[left_chip, right_stack]], colWidths=[left_w, right_w])
            tbl.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]))
            return tbl

        def full_width_chart(path):
            avail = PAGE_W - M_L - M_R
            _ch = _el("chart")
            frac = min(max(_num(_ch.get("w"), 100) / 100.0, 0.3), 1.0)
            max_w = avail * frac
            h = max(3.2 * inch, min(max_w * 9 / 16, 4.8 * inch))
            img = Image(path, width=max_w, height=h)
            bw = _num(_ch.get("borderW"), 0)
            if bw > 0:
                t = Table([[img]], colWidths=[max_w])
                t.setStyle(TableStyle([
                    ("BOX", (0, 0), (-1, -1), bw, _hexc(_ch.get("borderColor"), "#000000")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ]))
                return t
            return img

        print(f"📝 Generating {len(df)} stock pages...")
        for idx, row in df.iterrows():
            date_val = str(row.get("DATE", "") or "").strip()
            story.append(positional_date_header(date_val))
            story.append(Spacer(1, 10))

            listed = str(row.get("LISTED NAME", row.get("INPUT STOCK", row.get("STOCK NAME", ""))) or "").strip()
            symbol = str(row.get("STOCK SYMBOL", "") or "").strip()
            title_line = f"{listed} ({symbol})" if symbol else listed
            story.append(Paragraph(title_line, subheading_style))
            story.append(Spacer(1, 8))

            chart_path = str(row.get("CHART PATH", "") or "").strip()
            added_chart = False
            if chart_path:
                if not os.path.isabs(chart_path):
                    chart_path = os.path.join(job_folder, chart_path)
                if os.path.exists(chart_path):
                    try:
                        story.append(full_width_chart(chart_path))
                        story.append(Spacer(1, 14))
                        added_chart = True
                    except Exception as e:
                        print(f"⚠️ Could not add chart {chart_path}: {e}")
            if not added_chart:
                story.append(Paragraph("<i>Chart unavailable</i>", small_grey))
                story.append(Spacer(1, 10))

            story.append(heading("Rationale"))
            story.append(Spacer(1, 10))
            analysis_text = str(row.get("ANALYSIS", "") or "—").strip()
            story.append(Paragraph(f"<b>{_ov_text}</b>", label_style))
            story.append(Spacer(1, 4))
            story.append(Paragraph(analysis_text, body_style))
            story.append(PageBreak())

        if config.get("disclaimer_text"):
            story.append(heading("Disclaimer"))
            story.append(Spacer(1, 10))
            list_style = PS("list_style", fontSize=10.8, leading=15.6, spaceAfter=4,
                            alignment=TA_LEFT, leftIndent=25, bulletIndent=15)
            for fl in create_html_flowables(config["disclaimer_text"], indented_body):
                story.append(fl)
            story.append(Spacer(1, 35))

        if config.get("disclosure_text"):
            story.append(heading("Disclosure"))
            story.append(Spacer(1, 10))
            list_style = PS("list_style2", fontSize=10.8, leading=15.6, spaceAfter=4,
                            alignment=TA_LEFT, leftIndent=25, bulletIndent=15)
            for fl in create_html_flowables(config["disclosure_text"], indented_body):
                story.append(fl)
            story.append(Spacer(1, 35))

        _sg = _el("sign_area")
        if _sg.get("visible"):
            story.append(heading(_sg.get("text") or "Authorised Signatory"))
            story.append(Spacer(1, 46))
            _sig_line = PS("sig_line", fontSize=10, leading=14, textColor=colors.HexColor("#444444"))
            story.append(Paragraph("_______________________________", _sig_line))
            story.append(Paragraph(_sg.get("subtext") or "Signature &amp; Date", _sig_line))

        contact_card_heading = PS("contact_card_heading", fontSize=10, leading=13,
                                  textColor=BLUE, fontName=BASE_BLD, spaceAfter=4)
        contact_card_body = PS("contact_card_body", fontSize=9.5, leading=13,
                               textColor=colors.black, fontName=BASE_REG)

        def make_contact_card(title, name, email, phone):
            card_content = [
                Paragraph(f"<b>{title}</b>", contact_card_heading),
                Paragraph(f"<b>Name:</b> {name}", contact_card_body),
                Paragraph(f"<b>Email:</b> {email}", contact_card_body),
                Paragraph(f"<b>Contact:</b> {phone}", contact_card_body),
            ]
            card_table = Table([[c] for c in card_content], colWidths=[(PAGE_W - M_L - M_R - 20) / 2])
            card_table.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (0, 0), 8), ("BOTTOMPADDING", (-1, -1), (-1, -1), 8),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8f9fa")),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#dee2e6")),
            ]))
            return card_table

        story.append(PageBreak())
        story.append(heading("Contact Details"))
        story.append(Spacer(1, 14))

        contacts = config.get("contacts") or []
        cards = [make_contact_card(ct.get("title", ""), ct.get("name", ""),
                                   ct.get("email", ""), ct.get("phone", "")) for ct in contacts]
        col_width = (PAGE_W - M_L - M_R - 10) / 2
        grid_rows = []
        for i in range(0, len(cards), 2):
            pair = cards[i:i + 2]
            if len(pair) == 1:
                pair.append(Spacer(1, 0))
            grid_rows.append(pair)
        if grid_rows:
            contact_grid = Table(grid_rows, colWidths=[col_width, col_width])
            contact_grid.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]))
            story.append(contact_grid)
        story.append(Spacer(1, 35))

        print("🔨 Building PDF...")
        doc.build(story, onFirstPage=on_first_page, onLaterPages=on_later_pages)
        print(f"✅ PDF generated: {output_pdf}")
        return {"success": True, "output_file": output_pdf}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}
