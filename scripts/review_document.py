#!/usr/bin/env python3
"""Extract local document text and produce a deterministic review aid, not an AI summary."""

import argparse
import datetime as dt
import html
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "research-library"


def extract_pdf(path):
    swift = shutil.which("swift")
    if not swift:
        raise RuntimeError("PDF extraction uses Apple's PDFKit via Swift. Install Xcode Command Line Tools or use a text/DOCX source.")
    helper = Path(__file__).with_name("extract_document.swift")
    result = subprocess.run([swift, str(helper), str(path)], capture_output=True, text=True, timeout=300)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "PDFKit could not extract this PDF.")
    pages = re.split(r"\x1ePAGE\s+(\d+)\s*\n", result.stdout)
    page_text = []
    for i in range(1, len(pages), 2):
        page_text.append((int(pages[i]), pages[i + 1].strip()))
    return "\n\n".join(f"[PAGE {number}]\n{text}" for number, text in page_text), len(page_text)


def extract_docx(path):
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs = []
    for paragraph in root.findall(".//w:body/w:p", ns):
        text = "".join(node.text or "" for node in paragraph.findall(".//w:t", ns))
        if text.strip():
            paragraphs.append(text)
    return "\n\n".join(paragraphs), None


def extract(path):
    suffix = path.suffix.casefold()
    if suffix == ".pdf":
        return extract_pdf(path)
    if suffix == ".docx":
        return extract_docx(path)
    if suffix in (".txt", ".md", ".rst", ".csv"):
        return path.read_text(encoding="utf-8", errors="replace"), None
    if suffix in (".html", ".htm"):
        content = path.read_text(encoding="utf-8", errors="replace")
        content = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", content)
        content = re.sub(r"(?s)<[^>]+>", " ", content)
        return re.sub(r"\s+", " ", html.unescape(content)), None
    raise RuntimeError("Supported formats: PDF, DOCX, TXT, Markdown, HTML, CSV.")


def analyze(text):
    clean = re.sub(r"\s+", " ", text)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    headings = []
    for line in lines:
        candidate = line.strip("# \t")
        if len(candidate) <= 110 and (line.startswith("#") or re.match(r"^(abstract|introduction|conclusion|references|bibliography|contents|chapter\s+\w+)\b", candidate, re.I)):
            if candidate.casefold() not in {x.casefold() for x in headings}:
                headings.append(candidate)
    dois = sorted(set(re.findall(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+", text, re.I)))
    years = sorted(set(re.findall(r"\b(?:1[5-9]\d{2}|20\d{2})\b", text)))
    citation_patterns = sorted(set(re.findall(r"\[(?:\d{1,3}(?:\s*[-,;]\s*\d{1,3})*)\]|\([^\n)]{0,80},?\s(?:19|20)\d{2}\)", text)))
    reference_marker = re.search(r"\b(references|bibliography|works cited)\b", text, re.I)
    return {
        "characters": len(text), "words": len(clean.split()), "lines": len(lines),
        "headings": headings[:40], "dois": dois[:100], "years": years[:100],
        "citation_markers": citation_patterns[:100],
        "reference_section_detected": bool(reference_marker),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("document", type=Path, help="Local document; no upload is performed")
    parser.add_argument("--output-dir", type=Path, default=LIBRARY, help="Default is git-ignored research-library/")
    args = parser.parse_args()
    path = args.document.expanduser().resolve()
    if not path.is_file():
        parser.error(f"Not a file: {path}")
    text, pages = extract(path)
    output_dir = args.output_dir.expanduser()
    text_dir, report_dir = output_dir / "extracted", output_dir / "reviews"
    text_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", path.stem).strip("-.")[:100] or "document"
    text_path, report_path = text_dir / f"{stem}.txt", report_dir / f"{stem}.md"
    text_path.write_text(text, encoding="utf-8")
    info = analyze(text)
    lines = [f"# Document review: {path.name}", "", f"- Local file: `{path}`", f"- Extracted: {dt.datetime.now().astimezone().isoformat(timespec='minutes')}", f"- Pages: {pages if pages is not None else 'not available'}", f"- Words: {info['words']}", f"- Extracted text: `{text_path}`", "", "> This report is a deterministic extraction aid. It does not assess the truth, scholarly quality, relevance, or full contents of the document.", "", "## Detected headings"]
    lines.extend([f"- {heading}" for heading in info["headings"]] or ["- None detected"])
    lines += ["", "## DOI candidates"]
    lines.extend([f"- {doi}" for doi in info["dois"]] or ["- None detected"])
    lines += ["", "## Year candidates", ", ".join(info["years"][:50]) or "None detected", "", "## Citation-marker candidates"]
    lines.extend([f"- {marker}" for marker in info["citation_markers"]] or ["- None detected"])
    lines += ["", f"Reference/bibliography heading detected: {info['reference_section_detected']}", "", "## Human review checklist", "", "- Verify author, title, edition, translator, publisher, year, and identifier against a catalog or publisher.", "- Confirm extracted pages and citations against the original file; OCR gaps and layout errors are possible.", "- Record genre, language, tradition, period, method, and scope.", "- Select exact passages and enter source-attributed claims and counterevidence in the project graph.", "- Keep this document and extracted text local unless redistribution rights permit sharing."]
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Review aid: {report_path}")
    print(f"Extracted text: {text_path}")
    print(f"{info['words']} words; {len(info['dois'])} DOI candidate(s); {len(info['headings'])} heading(s)")


if __name__ == "__main__":
    try:
        main()
    except (OSError, zipfile.BadZipFile, RuntimeError, subprocess.TimeoutExpired) as exc:
        print(f"review_document: {exc}", file=sys.stderr)
        raise SystemExit(1)
