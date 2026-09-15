"""Build the compact runtime catalogue from the maintained Excel source.

This is development tooling only. It reads the workbook's OOXML with Python's
standard library; the application imports only the generated JSON.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import posixpath
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable, Iterator
from xml.etree import ElementTree
from zipfile import ZipFile


MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
DOCUMENT_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"


CATALOGUE_VERSION = "2026-09-14"
SCHEMA_VERSION = 1

EXPECTED_COUNTS = {
    "characters": 74,
    "fighters": 124,
    "cards": 924,
    "releases": 26,
}

ROSTER_TYPES = {
    "Solo": "solo",
    "Hero + sidekick": "hero-with-sidekick",
    "Hero + multiple sidekicks": "hero-with-multiple-sidekicks",
    "Team": "team",
    "Transforming": "transforming",
}

DATA_STATUSES = {
    "Complete": "complete",
    "Needs review": "needs-review",
    "Partial": "partial",
}

CARD_TYPES = {
    "Attack": "attack",
    "Defence": "defense",
    "Versatile": "versatile",
    "Scheme": "scheme",
}

FIGHTER_ROLES = {
    "Hero": "hero",
    "Sidekick": "sidekick",
    "Companion": "companion",
    "Token": "token",
    "Other": "other",
}

PRODUCT_TYPES = {
    "Adventure box": "adventure-box",
    "Core box": "core-box",
    "Battle box": "battle-box",
    "Promo": "promo",
}

RELEASE_NAME_OVERRIDES = {
    "jurassic-park-ingen-vs-raptors": "Jurassic Park – InGen vs. Raptors",
    "jurassic-park-sattler-vs-t-rex": "Jurassic Park – Sattler vs. T. Rex",
    "the-witcher-realms-fall": "The Witcher – Realms Fall",
    "the-witcher-steel-and-silver": "The Witcher – Steel & Silver",
}

# The source note predates the official announcement and calls this fan-made.
# Normalize the four-hero release with the catalogue's other core boxes:
# https://restorationgames.com/unmatched-slings-and-arrows-announce/
RELEASE_OVERRIDES = {
    "slings-and-arrows": {
        "productType": "core-box",
        "name": "Slings and Arrows",
    }
}

DECK_OVERRIDES = {
    "black-widow": {
        "model": "fixed-with-starting-card",
        "coverage": "complete",
        "selectedCopyCount": 31,
        "shuffledCopyCount": 30,
        "outsideDeckCopyCount": 1,
    },
    "buffy": {
        "model": "choice-pool",
        "coverage": "complete",
        "selectedCopyCount": 30,
        "shuffledCopyCount": 30,
        "outsideDeckCopyCount": 0,
    },
    "geralt-of-rivia": {
        "model": "choice-pool",
        "coverage": "complete",
        "selectedCopyCount": 30,
        "shuffledCopyCount": 30,
        "outsideDeckCopyCount": 0,
    },
    "daredevil": {
        "model": "fixed",
        "coverage": "partial",
        "selectedCopyCount": None,
        "shuffledCopyCount": None,
        "outsideDeckCopyCount": 0,
    },
}

STATUS_PATTERN = re.compile(r"^Data status: ([^.]+)\.\s*")
CARD_COUNT_PATTERN = re.compile(
    r"(?:\d+(?:/(?:\d+|\?))?) unique cards, .*?(?:physical )?copies(?: confirmed)?\.\s*"
)


def column_index(reference: str) -> int:
    letters = "".join(character for character in reference if character.isalpha())
    result = 0
    for letter in letters:
        result = result * 26 + ord(letter.upper()) - ord("A") + 1
    return result - 1


class XlsxReader:
    """Read the small tabular subset this generator needs from OOXML."""

    def __init__(self, path: Path) -> None:
        self.archive = ZipFile(path)
        self.shared_strings = self._shared_strings()
        self.sheet_paths = self._sheet_paths()

    def __enter__(self) -> "XlsxReader":
        return self

    def __exit__(self, *_: object) -> None:
        self.archive.close()

    def _shared_strings(self) -> list[str]:
        path = "xl/sharedStrings.xml"
        if path not in self.archive.namelist():
            return []
        root = ElementTree.fromstring(self.archive.read(path))
        return [
            "".join(node.text or "" for node in item.iter(f"{{{MAIN_NS}}}t"))
            for item in root.findall(f"{{{MAIN_NS}}}si")
        ]

    def _sheet_paths(self) -> dict[str, str]:
        workbook = ElementTree.fromstring(self.archive.read("xl/workbook.xml"))
        relationships = ElementTree.fromstring(
            self.archive.read("xl/_rels/workbook.xml.rels")
        )
        targets = {
            relationship.attrib["Id"]: relationship.attrib["Target"]
            for relationship in relationships.findall(f"{{{PACKAGE_REL_NS}}}Relationship")
        }
        result: dict[str, str] = {}
        for sheet in workbook.findall(f".//{{{MAIN_NS}}}sheet"):
            relationship_id = sheet.attrib[f"{{{DOCUMENT_REL_NS}}}id"]
            target = targets[relationship_id]
            result[sheet.attrib["name"]] = (
                target.lstrip("/")
                if target.startswith("/")
                else posixpath.normpath(posixpath.join("xl", target))
            )
        return result

    def _cell_value(self, cell: ElementTree.Element) -> Any:
        value_type = cell.attrib.get("t")
        if value_type == "inlineStr":
            return "".join(node.text or "" for node in cell.iter(f"{{{MAIN_NS}}}t"))

        value = cell.find(f"{{{MAIN_NS}}}v")
        if value is None or value.text is None:
            return None
        if value_type == "s":
            return self.shared_strings[int(value.text)]
        if value_type == "b":
            return value.text == "1"
        if value_type in {"str", "e"}:
            return value.text
        try:
            numeric = float(value.text)
            return int(numeric) if numeric.is_integer() else numeric
        except ValueError:
            return value.text

    def rows(self, sheet_name: str, minimum_row: int, columns: int) -> Iterator[list[Any]]:
        path = self.sheet_paths.get(sheet_name)
        if path is None:
            raise ValueError(f"Workbook is missing the {sheet_name} sheet")
        root = ElementTree.fromstring(self.archive.read(path))
        for row in root.findall(f".//{{{MAIN_NS}}}sheetData/{{{MAIN_NS}}}row"):
            if int(row.attrib["r"]) < minimum_row:
                continue
            values: list[Any] = [None] * columns
            for cell in row.findall(f"{{{MAIN_NS}}}c"):
                index = column_index(cell.attrib["r"])
                if index < columns:
                    values[index] = self._cell_value(cell)
            yield values

    def records(self, sheet_name: str, columns: int) -> list[dict[str, Any]]:
        rows = self.rows(sheet_name, 5, columns)
        headers = [str(value).removesuffix("*") for value in next(rows)]
        return [dict(zip(headers, row)) for row in rows if row[0] is not None]


def require_unique(rows: Iterable[dict[str, Any]], key: str, label: str) -> None:
    values = [row[key] for row in rows]
    duplicates = sorted({value for value in values if values.count(value) > 1})
    if duplicates:
        raise ValueError(f"Duplicate {label} ids: {duplicates}")


def require_whole_number(
    value: Any,
    label: str,
    *,
    minimum: int = 0,
    allow_none: bool = False,
) -> int | None:
    if value is None and allow_none:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"Invalid {label}: {value!r}")
    return value


def parse_status(note: str) -> str:
    match = STATUS_PATTERN.match(note)
    if not match or match.group(1) not in DATA_STATUSES:
        raise ValueError(f"Missing or unknown data status in note: {note}")
    return DATA_STATUSES[match.group(1)]


def parse_data_note(note: str) -> str | None:
    without_status = STATUS_PATTERN.sub("", note, count=1)
    match = CARD_COUNT_PATTERN.search(without_status)
    if not match:
        raise ValueError(f"Could not locate the expected card-count sentence in note: {note}")
    caveat = without_status[match.end() :].strip()
    return caveat or None


def normalise_attack_type(value: Any) -> str | None:
    if value is None:
        return None
    result = str(value).lower()
    if result not in {"melee", "ranged", "hybrid", "none"}:
        raise ValueError(f"Unknown attack type: {value}")
    return result


def empty_card_summary() -> dict[str, int]:
    return {
        "uniqueCount": 0,
        "copyCount": 0,
        "printedValueKnownCopies": 0,
        "printedValueSum": 0,
        "boostKnownCopies": 0,
        "boostSum": 0,
    }


def validate_roster(
    character_id: str,
    roster_type: str,
    fighters: list[dict[str, Any]],
) -> None:
    if not fighters:
        raise ValueError(f"Character {character_id} has no fighter profiles")
    if roster_type != "hero-with-sidekick":
        return

    heroes = [fighter for fighter in fighters if fighter["role"] == "hero"]
    sidekicks = [fighter for fighter in fighters if fighter["role"] == "sidekick"]
    other_roles = [
        fighter for fighter in fighters if fighter["role"] not in {"hero", "sidekick"}
    ]
    if len(heroes) != 1 or heroes[0]["quantity"] != 1:
        raise ValueError(f"Singular-sidekick roster {character_id} must have one hero")
    if not sidekicks or any(fighter["quantity"] != 1 for fighter in sidekicks):
        raise ValueError(
            f"Singular-sidekick roster {character_id} must have one-figure sidekick profiles"
        )
    if other_roles:
        raise ValueError(f"Singular-sidekick roster {character_id} has an unexpected fighter role")


def build_catalogue(source_path: Path) -> dict[str, Any]:
    with XlsxReader(source_path) as workbook:
        characters = workbook.records("Characters", 14)
        fighters = workbook.records("Fighters", 9)
        cards = workbook.records("Cards", 13)
        releases = workbook.records("Releases", 8)

    actual_counts = {
        "characters": len(characters),
        "fighters": len(fighters),
        "cards": len(cards),
        "releases": len(releases),
    }
    if actual_counts != EXPECTED_COUNTS:
        raise ValueError(f"Unexpected workbook counts: {actual_counts}")

    require_unique(characters, "character_id", "character")
    require_unique(fighters, "fighter_id", "fighter")
    require_unique(cards, "card_id", "card")
    require_unique(releases, "release_id", "release")

    character_ids = {row["character_id"] for row in characters}
    release_ids = {row["release_id"] for row in releases}
    if {row["catalogue_status"] for row in characters} != {"Official"}:
        raise ValueError("The runtime catalogue must contain official characters only")
    if any(row["release_id"] not in release_ids for row in characters):
        raise ValueError("A character points at an unknown release")
    if any(row["character_id"] not in character_ids for row in fighters + cards):
        raise ValueError("A fighter or card points at an unknown character")

    runtime_releases: list[dict[str, Any]] = []
    for row in releases:
        release_id = str(row["release_id"])
        override = RELEASE_OVERRIDES.get(release_id, {})
        product_type = override.get("productType", PRODUCT_TYPES.get(row["product_type"]))
        if product_type is None:
            raise ValueError(f"Unknown product type for {release_id}: {row['product_type']}")
        if not isinstance(row["release_year"], int):
            raise ValueError(f"Missing release year for {release_id}")

        release = {
            "id": release_id,
            "name": RELEASE_NAME_OVERRIDES.get(release_id, str(row["set_name"])),
            "year": row["release_year"],
            "productType": product_type,
        }
        release.update(override)
        runtime_releases.append(release)

    fighters_by_character: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in fighters:
        fighter_id = str(row["fighter_id"])
        role = FIGHTER_ROLES.get(row["role"])
        if role is None:
            raise ValueError(f"Unknown fighter role for {fighter_id}: {row['role']}")
        if row["is_unique"] not in {"Yes", "No"}:
            raise ValueError(f"Invalid is_unique for {fighter_id}: {row['is_unique']!r}")
        fighter = {
            "id": fighter_id,
            "name": str(row["fighter_name"]),
            "role": role,
            "quantity": require_whole_number(
                row["quantity"], f"fighter quantity for {fighter_id}", minimum=1, allow_none=True
            ),
            "attackType": normalise_attack_type(row["attack_type"]),
            "startingHealth": require_whole_number(
                row["starting_health"],
                f"starting health for {fighter_id}",
                minimum=1,
                allow_none=True,
            ),
            "isUnique": row["is_unique"] == "Yes",
        }
        fighters_by_character[str(row["character_id"])].append(fighter)

    cards_by_character: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in cards:
        card_type = CARD_TYPES.get(row["card_type"])
        if card_type is None:
            raise ValueError(f"Unknown card type: {row['card_type']}")
        card_id = str(row["card_id"])
        quantity = require_whole_number(
            row["quantity"], f"card quantity for {card_id}", minimum=1
        )
        printed_value = require_whole_number(
            row["printed_value"],
            f"printed value for {card_id}",
            allow_none=card_type == "scheme",
        )
        if card_type == "scheme" and printed_value is not None:
            raise ValueError(f"Scheme card {card_id} unexpectedly has a printed value")
        boost_value = require_whole_number(
            row["boost_value"], f"boost value for {card_id}", allow_none=True
        )
        cards_by_character[str(row["character_id"])].append(
            {
                "type": card_type,
                "quantity": quantity,
                "printedValue": printed_value,
                "boostValue": boost_value,
                "shared": row["fighter_restriction"] == "All",
            }
        )

    runtime_characters: list[dict[str, Any]] = []
    for row in characters:
        character_id = str(row["character_id"])
        note = str(row["notes"] or "")
        roster_type = ROSTER_TYPES.get(row["roster_type"])
        if roster_type is None:
            raise ValueError(f"Unknown roster type for {character_id}: {row['roster_type']}")
        validate_roster(character_id, roster_type, fighters_by_character[character_id])

        complexity = str(row["complexity"]).lower() if row["complexity"] else None
        if complexity not in {None, "low", "medium", "high"}:
            raise ValueError(f"Unknown complexity for {character_id}: {row['complexity']}")
        move = require_whole_number(row["move"], f"move for {character_id}", minimum=1)

        character_cards = cards_by_character[character_id]
        card_types = {key: empty_card_summary() for key in CARD_TYPES.values()}
        shared_copies = 0
        restricted_copies = 0
        boost_known_copies = 0
        boost_sum = 0

        for card in character_cards:
            quantity = card["quantity"]
            summary = card_types[card["type"]]
            summary["uniqueCount"] += 1
            summary["copyCount"] += quantity
            if card["printedValue"] is not None:
                summary["printedValueKnownCopies"] += quantity
                summary["printedValueSum"] += quantity * card["printedValue"]
            if card["boostValue"] is not None:
                summary["boostKnownCopies"] += quantity
                summary["boostSum"] += quantity * card["boostValue"]
                boost_known_copies += quantity
                boost_sum += quantity * card["boostValue"]
            if card["shared"]:
                shared_copies += quantity
            else:
                restricted_copies += quantity

        source_copy_count = sum(card["quantity"] for card in character_cards)
        deck = {
            "model": "fixed",
            "coverage": "complete",
            "sourceCopyCount": source_copy_count,
            "selectedCopyCount": source_copy_count,
            "shuffledCopyCount": source_copy_count,
            "outsideDeckCopyCount": 0,
            "uniqueCardCount": len(character_cards),
            "cardTypes": card_types,
            "boostKnownCopies": boost_known_copies,
            "boostSum": boost_sum,
            "sharedCopies": shared_copies,
            "restrictedCopies": restricted_copies,
        }
        deck.update(DECK_OVERRIDES.get(character_id, {}))

        runtime_characters.append(
            {
                "id": character_id,
                "name": str(row["canonical_name"]),
                "licence": row["licence"],
                "releaseId": str(row["release_id"]),
                "move": move,
                "rosterType": roster_type,
                "complexity": complexity,
                "dataStatus": parse_status(note),
                "dataNote": parse_data_note(note),
                "fighters": fighters_by_character[character_id],
                "deck": deck,
            }
        )

    runtime_characters.sort(key=lambda item: item["name"].casefold())
    runtime_releases.sort(key=lambda item: (item["year"], item["name"].casefold()))

    return {
        "schemaVersion": SCHEMA_VERSION,
        "catalogueVersion": CATALOGUE_VERSION,
        "source": {
            "file": source_path.name,
            "sha256": hashlib.sha256(source_path.read_bytes()).hexdigest(),
        },
        "releases": runtime_releases,
        "characters": runtime_characters,
    }


def main() -> None:
    repository = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "source",
        nargs="?",
        type=Path,
        default=repository / "outputs" / "unmatched-character-catalogue-74.xlsx",
    )
    parser.add_argument(
        "destination",
        nargs="?",
        type=Path,
        default=repository / "src" / "lib" / "analysis" / "official" / "catalogue.json",
    )
    arguments = parser.parse_args()

    catalogue = build_catalogue(arguments.source.resolve())
    arguments.destination.parent.mkdir(parents=True, exist_ok=True)
    arguments.destination.write_text(
        json.dumps(catalogue, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
