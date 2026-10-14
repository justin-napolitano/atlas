#!/usr/bin/env python3
"""Export the two sheets in the seed .xlsx with only Python's standard library."""

import csv
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT = ROOT / "sources/original/starting-reading-list.xlsx"
NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "p": "http://schemas.openxmlformats.org/package/2006/relationships",
}


def column_index(reference):
    letters = re.match(r"[A-Z]+", reference).group()
    result = 0
    for letter in letters:
        result = result * 26 + ord(letter) - ord("A") + 1
    return result - 1


def read_cell(cell, shared):
    kind = cell.attrib.get("t")
    if kind == "inlineStr":
        return "".join(node.text or "" for node in cell.findall("m:is//m:t", NS))
    value = cell.findtext("m:v", default="", namespaces=NS)
    if kind == "s" and value:
        return shared[int(value)]
    return value


def read_sheet(archive, path, shared):
    sheet = ET.fromstring(archive.read(path))
    rows = []
    for row in sheet.findall(".//m:sheetData/m:row", NS):
        values = []
        for cell in row.findall("m:c", NS):
            index = column_index(cell.attrib["r"])
            values.extend([""] * (index + 1 - len(values)))
            values[index] = read_cell(cell, shared)
        rows.append(values)
    return rows


def write_csv(path, rows):
    if not rows:
        raise ValueError(f"No rows found for {path}")
    width = max(map(len, rows))
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        for row in rows:
            writer.writerow(row + [""] * (width - len(row)))


def main():
    workbook = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else DEFAULT
    if len(sys.argv) > 2:
        raise SystemExit("Usage: python3 scripts/import_reading_list.py [workbook.xlsx]")
    with zipfile.ZipFile(workbook) as archive:
        book = ET.fromstring(archive.read("xl/workbook.xml"))
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {item.attrib["Id"]: item.attrib["Target"] for item in rels}
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = ["".join(n.text or "" for n in item.findall(".//m:t", NS))
                      for item in strings.findall("m:si", NS)]
        sheets = {}
        for item in book.findall("m:sheets/m:sheet", NS):
            target = targets[item.attrib[f"{{{NS['r']}}}id"]].lstrip("/")
            if not target.startswith("xl/"):
                target = "xl/" + target
            sheets[item.attrib["name"]] = read_sheet(archive, target, shared)

    output = ROOT / "data"
    output.mkdir(exist_ok=True)
    if "Reading List" not in sheets or "Framework" not in sheets:
        raise SystemExit("Expected workbook sheets 'Reading List' and 'Framework'.")
    write_csv(output / "reading-list.csv", sheets["Reading List"])
    framework = sheets["Framework"]
    dimensions = [row[0] for row in framework[1:] if row and row[0]]
    if len(dimensions) != 10:
        raise SystemExit(f"Expected 10 framework dimensions, found {len(dimensions)}; review importer before writing.")
    converted = [["id", "dimension", "working_position", "epistemic_type", "status", "source_id", "notes"]]
    types = {
        "Ontology": "metaphysical", "Metaphysics": "metaphysical",
        "Epistemology": "epistemic and normative", "Revelation": "metaphysical",
        "Prophets": "metaphysical and historical", "Divine intention": "metaphysical and interpretive",
        "Ethics": "normative and metaethical", "Responsibility": "normative",
        "Justice": "normative and metaethical", "Religious belonging": "metaphysical and sociological",
    }
    for row in framework[1:]:
        if not row or not row[0]:
            continue
        dimension = row[0]
        converted.append([f"init:{re.sub(r'[^a-z0-9]+', '-', dimension.lower()).strip('-')}",
                          dimension, row[1] if len(row) > 1 else "", types.get(dimension, "unclassified"),
                          "proposed", "", "Researcher's starting position from the workbook; clarify terms and compare with specific Islamic traditions."])
    write_csv(output / "starting-framework.csv", converted)
    print(f"Imported {len(sheets['Reading List']) - 1} reading-list rows and {len(converted) - 1} framework rows from {workbook}")


if __name__ == "__main__":
    main()
