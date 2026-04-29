import os, io, json, uuid, time, traceback
from pathlib import Path
from typing import Optional
import httpx
import fitz
import pdfplumber
from fastapi import FastAPI, Header, HTTPException, BackgroundTasks
from pydantic import BaseModel
from anthropic import Anthropic
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from supabase import create_client
from app.config import settings

app = FastAPI()
anthropic = Anthropic(api_key=settings.anthropic_api_key)
sb = create_client(settings.supabase_url, settings.supabase_service_role)

class JobPayload(BaseModel):
    jobId: str
    userId: str
    filename: str
    pdfUrl: str
    callbackUrl: str
    outputsBucket: str
    prompt: Optional[str] = None
    language: Optional[str] = "auto"

def update_job(job_id, status, progress, message):
    sb.table("jobs").update({
        "status": status,
        "progress": progress,
        "status_message": message,
    }).eq("id", job_id).execute()

def post_callback(callback_url, payload):
    try:
        httpx.post(callback_url, json=payload, timeout=15)
    except Exception:
        pass

def set_rtl(paragraph):
    pPr = paragraph._p.get_or_add_pPr()
    bidi = OxmlElement("w:bidi")
    bidi.set(qn("w:val"), "1")
    pPr.append(bidi)
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT

def add_heading(doc, text, level, underline=False, rtl=False):
    p = doc.add_heading(text, level=level)
    for run in p.runs:
        run.bold = True
        if underline:
            run.underline = True
        run.font.name = "Arial"
        run.font.size = Pt(16 if level == 1 else 14 if level == 2 else 12)
    if rtl:
        set_rtl(p)
    return p

def add_body(doc, text, bold=False, italic=True, rtl=False, color=None):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = bold
    run.italic = italic
    run.font.name = "Arial"
    run.font.size = Pt(11)
    if color:
        run.font.color.rgb = RGBColor(*color)
    if rtl:
        set_rtl(p)
    return p

def add_warning(doc, text, rtl=False):
    p = doc.add_paragraph()
    run = p.add_run("⚠️  " + text)
    run.bold = True
    run.italic = True
    run.font.name = "Arial"
    run.font.size = Pt(11)
    if rtl:
        set_rtl(p)

def add_note(doc, text, rtl=False):
    p = doc.add_paragraph()
    run = p.add_run("📌 " + text)
    run.italic = True
    run.font.name = "Arial"
    run.font.size = Pt(11)
    if rtl:
        set_rtl(p)

def add_bullet(doc, text, bold_part=None, rtl=False):
    p = doc.add_paragraph(style="List Bullet")
    if bold_part and bold_part in text:
        parts = text.split(bold_part, 1)
        r1 = p.add_run(parts[0])
        r1.italic = True
        r1.font.name = "Arial"
        r1.font.size = Pt(11)
        r2 = p.add_run(bold_part)
        r2.bold = True
        r2.italic = True
        r2.font.name = "Arial"
        r2.font.size = Pt(11)
        if parts[1]:
            r3 = p.add_run(parts[1])
            r3.italic = True
            r3.font.name = "Arial"
            r3.font.size = Pt(11)
    else:
        run = p.add_run(text)
        run.italic = True
        run.font.name = "Arial"
        run.font.size = Pt(11)
    if rtl:
        set_rtl(p)

def add_image(doc, img_bytes, width_inches=6.5):
    try:
        buf = io.BytesIO(img_bytes)
        doc.add_picture(buf, width=Inches(width_inches))
    except Exception:
        pass

def add_table(doc, headers, rows, rtl=False):
    if not headers:
        return
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = "Table Grid"
    hdr = table.rows[0]
    for i, h in enumerate(headers):
        cell = hdr.cells[i]
        cell.text = ""
        run = cell.paragraphs[0].add_run(h)
        run.bold = True
        run.italic = True
        run.font.name = "Arial"
        run.font.size = Pt(11)
        shading = OxmlElement("w:shd")
        shading.set(qn("w:fill"), "D5E8F0")
        shading.set(qn("w:val"), "clear")
        cell._tc.get_or_add_tcPr().append(shading)
    for ri, row in enumerate(rows):
        for ci, val in enumerate(row):
            cell = table.rows[ri + 1].cells[ci]
            cell.text = ""
            run = cell.paragraphs[0].add_run(str(val))
            run.italic = True
            run.font.name = "Arial"
            run.font.size = Pt(11)
    doc.add_paragraph()

def call_claude(messages, max_tokens=4000):
    for model in [settings.model_primary, settings.model_fallback]:
        try:
            resp = anthropic.messages.create(
                model=model,
                max_tokens=max_tokens,
                messages=messages,
            )
            return resp.content[0].text
        except Exception as e:
            print("Model " + model + " failed: " + str(e))
            time.sleep(2)
    raise RuntimeError("Both Claude models failed")

def extract_images(pdf_path, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    index = {}
    doc = fitz.open(pdf_path)
    for page_num in range(len(doc)):
        page = doc[page_num]
        images = page.get_images(full=True)
        page_imgs = []
        for img_idx, img in enumerate(images):
            xref = img[0]
            base_image = doc.extract_image(xref)
            img_bytes = base_image["image"]
            ext = base_image["ext"]
            img_path = out_dir / ("page_" + str(page_num+1) + "_img_" + str(img_idx+1) + "." + ext)
            img_path.write_bytes(img_bytes)
            page_imgs.append(str(img_path))
        if page_imgs:
            index[page_num + 1] = page_imgs
    return index

def extract_tables(pdf_path, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    index = {}
    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages):
            tables = page.extract_tables()
            if tables:
                page_tables = []
                for t_idx, table in enumerate(tables):
                    if not table:
                        continue
                    headers = [str(c) if c else "" for c in table[0]]
                    rows = [[str(c) if c else "" for c in row] for row in table[1:]]
                    tbl = {"headers": headers, "rows": rows}
                    page_tables.append(tbl)
                index[page_num + 1] = page_tables
    return index

def extract_text_chunks(pdf_path, chunk_size=30):
    doc = fitz.open(pdf_path)
    total = len(doc)
    chunks = []
    for start in range(0, total, chunk_size):
        end = min(start + chunk_size, total)
        text = ""
        for i in range(start, end):
            text += "\n--- Page " + str(i+1) + " ---\n"
            text += doc[i].get_text()
        chunks.append({"start": start + 1, "end": end, "text": text})
    return chunks

DISCOVERY_PROMPT = (
    "You are scanning a document to identify all components it contains.\n"
    "A component can be a service, policy, guide, glossary, regulation, or any other distinct content block.\n\n"
    "Chunk pages: {start} to {end}\n\n"
    "TASK: Return a JSON array of all components found. For each:\n"
    '- "name": exact name as written\n'
    '- "type": "service" | "policy" | "guide" | "glossary" | "intro" | "other"\n'
    '- "start_page": estimated start page\n'
    '- "end_page": estimated end page or "continues"\n'
    '- "language": "en" | "ar" | "bilingual"\n'
    '- "has_sub_components": true/false\n'
    '- "started_before": true if it started in a previous chunk\n\n'
    "Return ONLY valid JSON array. No markdown, no preamble.\n\n"
    "DOCUMENT TEXT:\n{text}"
)

EXTRACTION_PROMPT = (
    "You are extracting COMPLETE, VERBATIM content from a legal government document.\n"
    "This content will be used at an information desk. DO NOT summarize. DO NOT paraphrase. Extract everything word for word.\n\n"
    "Component: {name}\n"
    "Type: {comp_type}\n"
    "Pages: {start} to {end}\n\n"
    "CRITICAL RULES:\n"
    "1. NEVER summarize. Copy text exactly as written.\n"
    "2. Extract EVERY numbered step, EVERY sub-step, EVERY bullet point completely.\n"
    "3. Extract EVERY condition, EVERY exception, EVERY note and warning verbatim.\n"
    "4. If a step has sub-steps extract all of them individually numbered.\n"
    "5. If there are examples in the document extract them fully.\n"
    "6. Tables must be extracted with ALL rows and ALL columns completely.\n"
    "7. Do not skip any paragraph condition or instruction no matter how minor.\n"
    "8. Arabic text must be extracted in Arabic exactly as written.\n"
    "9. Warnings and notes must be extracted verbatim including all their content.\n"
    "10. For application steps each step must have its COMPLETE description ALL bullets ALL conditions.\n\n"
    "For non-service components:\n"
    "- Identify every distinct section and subsection\n"
    "- Extract the COMPLETE content of each not a summary the full text\n"
    "- Every numbered item every bullet every table row must appear in output\n"
    "- Include all examples all definitions all conditions\n\n"
    "Return ONLY valid JSON. Schema:\n"
    "{{\n"
    '  "component_name": "...",\n'
    '  "component_type": "...",\n'
    '  "is_service": true,\n'
    '  "language": "en",\n'
    '  "sections": {{\n'
    '    "service_overview": {{"text": "full text here", "rtl": false}},\n'
    '    "eligibility_criteria": {{\n'
    '      "subsections": [{{"title": "...", "bullets": ["..."], "warnings": ["..."], "rtl": false}}]\n'
    "    }},\n"
    '    "fees": {{"text": "..."}},\n'
    '    "required_documents": [{{"name": "...", "description": "...", "conditional": false}}],\n'
    '    "application_steps": [\n'
    "      {{\n"
    '        "step_number": 1,\n'
    '        "title": "...",\n'
    '        "bullets": ["..."],\n'
    '        "branches": [{{"label": "...", "bullets": ["..."], "image_pages": [1]}}],\n'
    '        "image_pages": [1],\n'
    '        "notes": ["..."],\n'
    '        "warnings": ["..."],\n'
    '        "rtl": false\n'
    "      }}\n"
    "    ],\n"
    '    "follow_up": {{"text": "...", "image_pages": [1]}},\n'
    '    "notifications_statuses": {{\n'
    '      "tables": [{{"table_title": "...", "headers": ["col1"], "rows": [["val1"]]}}]\n'
    "    }},\n"
    '    "free_sections": [\n'
    "      {{\n"
    '        "title": "...",\n'
    '        "content": "COMPLETE verbatim content every word every bullet every sub-point",\n'
    '        "subsections": [{{"title": "...", "content": "complete verbatim content"}}],\n'
    '        "tables": [{{"table_title": "...", "headers": ["..."], "rows": [["..."]]}}],\n'
    '        "warnings": ["..."],\n'
    '        "notes": ["..."],\n'
    '        "rtl": false\n'
    "      }}\n"
    "    ]\n"
    "  }},\n"
    '  "label_mappings": [{{"source": "...", "mapped_to": "..."}}]\n'
    "}}\n\n"
    "DOCUMENT TEXT:\n{text}"
)

def discover_components(chunks):
    all_components = []
    for chunk in chunks:
        prompt = DISCOVERY_PROMPT.format(
            start=chunk["start"], end=chunk["end"], text=chunk["text"][:8000]
        )
        for attempt in range(2):
            try:
                raw = call_claude([{"role": "user", "content": prompt}])
                raw = raw.strip()
                if raw.startswith("```"):
                    raw = raw.split("\n", 1)[1]
                if raw.endswith("```"):
                    raw = raw.rsplit("```", 1)[0]
                raw = raw.strip()
                components = json.loads(raw)
                all_components.extend(components)
                break
            except Exception as e:
                print("Discovery attempt " + str(attempt+1) + " failed: " + str(e))
                time.sleep(settings.chunk_delay_s)
    return all_components

def cross_validate(pass_a, pass_b):
    names_b = {c["name"].lower().strip() for c in pass_b}
    confirmed = []
    for comp in pass_a:
        confirmed.append(comp)
    for comp in pass_b:
        if comp["name"].lower().strip() not in {c["name"].lower().strip() for c in pass_a}:
            confirmed.append(comp)
    return confirmed

def extract_component(comp, chunks):
    start_p = comp.get("start_page", 1)
    end_p = comp.get("end_page", chunks[-1]["end"] if chunks else 1)
    if end_p == "continues":
        end_p = chunks[-1]["end"] if chunks else start_p + 30

    relevant_chunks = [
        c for c in chunks
        if c["end"] >= start_p - 2 and c["start"] <= int(end_p) + 2
    ]

    results = []
    for chunk in relevant_chunks:
        prompt = EXTRACTION_PROMPT.format(
            name=comp["name"],
            comp_type=comp.get("type", "other"),
            start=chunk["start"],
            end=chunk["end"],
            text=chunk["text"][:10000],
        )
        for attempt in range(settings.chunk_retries):
            try:
                raw = call_claude([{"role": "user", "content": prompt}], max_tokens=4000)
                raw = raw.strip()
                if raw.startswith("```"):
                    raw = raw.split("\n", 1)[1]
                if raw.endswith("```"):
                    raw = raw.rsplit("```", 1)[0]
                raw = raw.strip()
                parsed = json.loads(raw)
                results.append(parsed)
                break
            except Exception as e:
                print("Extraction attempt " + str(attempt+1) + " failed: " + str(e))
                time.sleep(settings.chunk_delay_s)

    if not results:
        return {"component_name": comp["name"], "component_type": comp.get("type"), "sections": {}}
    return results[0]

REQUIRED_SECTIONS = ["service_overview", "eligibility_criteria", "fees", "required_documents", "application_steps"]

def assemble_docx(comp_data, image_index, table_index):
    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = "Arial"
    style.font.size = Pt(11)

    name = comp_data.get("component_name", "Document")
    is_service = comp_data.get("is_service", False)
    rtl_doc = comp_data.get("language", "en") == "ar"
    sections = comp_data.get("sections", {})

    add_heading(doc, name, level=1, underline=True, rtl=rtl_doc)

    if is_service:
        add_heading(doc, "Service Overview", level=2, underline=True, rtl=rtl_doc)
        overview = sections.get("service_overview")
        if overview and overview.get("text"):
            add_body(doc, overview["text"], rtl=overview.get("rtl", False))
        else:
            add_body(doc, "[Section not found in source document — requires manual review]", color=(255, 0, 0))

        add_heading(doc, "Eligibility Criteria", level=2, underline=True, rtl=rtl_doc)
        eligibility = sections.get("eligibility_criteria")
        if eligibility and eligibility.get("subsections"):
            for sub in eligibility["subsections"]:
                add_heading(doc, sub.get("title", ""), level=3, rtl=sub.get("rtl", False))
                for bullet in sub.get("bullets", []):
                    add_bullet(doc, bullet, rtl=sub.get("rtl", False))
                for warning in sub.get("warnings", []):
                    add_warning(doc, warning, rtl=sub.get("rtl", False))
        else:
            add_body(doc, "[Section not found in source document — requires manual review]", color=(255, 0, 0))

        add_heading(doc, "Fees", level=2, underline=True, rtl=rtl_doc)
        fees = sections.get("fees")
        if fees and fees.get("text"):
            add_body(doc, fees["text"])
        else:
            add_body(doc, "No fees apply.")

        add_heading(doc, "Required Documents", level=2, underline=True, rtl=rtl_doc)
        docs_list = sections.get("required_documents")
        if docs_list:
            add_body(doc, "You will be asked to upload the following documents:")
            for d in docs_list:
                doc_name = d.get("name", "")
                doc_desc = d.get("description", "")
                conditional = " (if applicable)" if d.get("conditional") else ""
                add_bullet(doc, doc_name + ": " + doc_desc + conditional, bold_part=doc_name)
        else:
            add_body(doc, "[Section not found in source document — requires manual review]", color=(255, 0, 0))

        add_heading(doc, "Application Steps", level=2, underline=True, rtl=rtl_doc)
        steps = sections.get("application_steps")
        if steps:
            for step in steps:
                step_title = "Step " + str(step.get("step_number", "")) + ": " + step.get("title", "")
                add_heading(doc, step_title, level=3, rtl=step.get("rtl", False))
                for bullet in step.get("bullets", []):
                    add_bullet(doc, bullet, rtl=step.get("rtl", False))
                for note in step.get("notes", []):
                    add_note(doc, note, rtl=step.get("rtl", False))
                for warning in step.get("warnings", []):
                    add_warning(doc, warning, rtl=step.get("rtl", False))
                for branch in step.get("branches", []):
                    add_body(doc, branch.get("label", ""), bold=True, italic=True)
                    for b_bullet in branch.get("bullets", []):
                        add_bullet(doc, b_bullet, rtl=step.get("rtl", False))
                    for page_num in branch.get("image_pages", []):
                        imgs = image_index.get(page_num, [])
                        for img_path in imgs[:1]:
                            try:
                                add_image(doc, Path(img_path).read_bytes())
                            except Exception:
                                pass
                if not step.get("branches"):
                    for page_num in step.get("image_pages", []):
                        imgs = image_index.get(page_num, [])
                        for img_path in imgs[:1]:
                            try:
                                add_image(doc, Path(img_path).read_bytes())
                            except Exception:
                                pass
        else:
            add_body(doc, "[Section not found in source document — requires manual review]", color=(255, 0, 0))

        follow_up = sections.get("follow_up")
        if follow_up and follow_up.get("text"):
            add_heading(doc, "How to Follow Up", level=2, underline=True, rtl=rtl_doc)
            add_body(doc, follow_up["text"])
            for page_num in follow_up.get("image_pages", []):
                imgs = image_index.get(page_num, [])
                for img_path in imgs[:1]:
                    try:
                        add_image(doc, Path(img_path).read_bytes())
                    except Exception:
                        pass

        notifs = sections.get("notifications_statuses")
        if notifs and notifs.get("tables"):
            add_heading(doc, "Application Notifications and Statuses", level=2, underline=True, rtl=rtl_doc)
            for tbl in notifs["tables"]:
                if tbl.get("table_title"):
                    add_body(doc, tbl["table_title"], bold=True, italic=True)
                if tbl.get("headers") and tbl.get("rows"):
                    add_table(doc, tbl["headers"], tbl["rows"])

    else:
        free_sections = sections.get("free_sections", [])
        if free_sections:
            for fs in free_sections:
                rtl = fs.get("rtl", False)
                add_heading(doc, fs.get("title", ""), level=2, underline=True, rtl=rtl)
                if fs.get("content"):
                    add_body(doc, fs["content"], rtl=rtl)
                for sub in fs.get("subsections", []):
                    add_heading(doc, sub.get("title", ""), level=3, rtl=rtl)
                    add_body(doc, sub.get("content", ""), rtl=rtl)
                for warning in fs.get("warnings", []):
                    add_warning(doc, warning, rtl=rtl)
                for note in fs.get("notes", []):
                    add_note(doc, note, rtl=rtl)
                for tbl in fs.get("tables", []):
                    if tbl.get("table_title"):
                        add_body(doc, tbl["table_title"], bold=True, italic=True)
                    if tbl.get("headers") and tbl.get("rows"):
                        add_table(doc, tbl["headers"], tbl["rows"])

    return doc
