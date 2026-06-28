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
    Flowable, Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
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
            disclaimer_text = tpl.disclaimer_text
            disclosure_text = tpl.disclosure_text
            company_data = tpl.company_data
            design_cfg = tpl.design or {}
        else:
            company_name = cfg["fallback_company_name"]
            registration_details = cfg["fallback_registration"]
            disclaimer_text = disclosure_text = company_data = None
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

    # Contacts: config defaults, optionally overridden by JSON in company_data.
    contacts = cfg.get("contacts", [])
    if company_data:
        try:
            parsed = json.loads(company_data)
            if isinstance(parsed, dict) and isinstance(parsed.get("contacts"), list) and parsed["contacts"]:
                contacts = parsed["contacts"]
        except (ValueError, TypeError):
            pass

    return {
        "channel_name": channel_name,
        "channel_logo_path": channel_logo_path,
        "title": job.title or "Rationale Report",
        "input_date": input_date_str,
        "youtube_url": job.youtube_url or "",
        "platform": platform,
        "company_name": company_name,
        "registration_details": registration_details,
        "disclaimer_text": disclaimer_text,
        "design": design_cfg,
        "disclosure_text": disclosure_text,
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


def run(job_folder, overrides=None):
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

        config = fetch_pdf_config(job_id, cfg)
        print(f"✅ Platform: {config['channel_name']} | Report: {config['title']}")

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
