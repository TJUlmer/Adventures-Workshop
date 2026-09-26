"""Build the fixed health dial's two-sided skin template.

The replacement dial is not the generated token disc this project used before.
It is one fixed mesh with a portrait atlas: the front face occupies the upper
square, the underside occupies the lower square, and several small UV islands
around their seam paint the health controls and reset button. Authors need to
paint that *whole atlas*, not two squares laid beside one another.

The mesh is the authority for every guide in the document. Parsing its UVs here
keeps the Photoshop template honest if a later copy of the model changes: the
two face layers, the two control layers, and the guide wireframe all come from
the OBJ rather than from hand-measured ellipses.

The production layers deliberately contain no character art and no health
number or arrow glyphs. Tabletop Simulator draws the changing health value and
the ``<`` / ``>`` controls over the model; baking them into the skin would leave
the starting value behind when the dial changes. The guide layer shows their
roles only, and must be hidden before an author saves a finished skin.

Run from the repository root:

    python tools/health-dial-skin.py

This writes the editable source and its flattened guide preview to
``assets/resources/`` and copies the PSD to ``public/assets/templates/`` for
the in-app download link.
"""

from __future__ import annotations

import shutil
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image, ImageDraw

from skins import GUIDE, PLATE, PLATE_RING, blank, centred, font, publish, ring

ROOT = Path(__file__).resolve().parent.parent
MESH = ROOT / "public" / "assets" / "templates" / "health-dial.obj"
PUBLIC_PSD = ROOT / "public" / "assets" / "templates" / "health-dial-skin-two-sided.psd"

# The model's UVs are a 1:2 portrait atlas. A power-of-two canvas keeps each
# face a square while giving the small control islands enough resolution.
WIDTH = 1024
FACE = WIDTH
HEIGHT = FACE * 2
SIZE = (WIDTH, HEIGHT)

RIM = (26, 26, 26)
FRONT = PLATE
BACK = (48, 55, 67)
CONTROL = (43, 53, 61)
RESET = PLATE_RING

Vertex = tuple[float, float, float]
Uv = tuple[float, float]
Normal = tuple[float, float, float]
Corner = tuple[int, int, int]
Face = tuple[Corner, ...]


def _index(raw: str, count: int) -> int:
    """Resolve OBJ's one-based (and occasionally negative) index."""
    value = int(raw)
    return value - 1 if value > 0 else count + value


def read_obj(path: Path) -> tuple[list[Vertex], list[Uv], list[Normal], list[Face]]:
    vertices: list[Vertex] = []
    uvs: list[Uv] = []
    normals: list[Normal] = []
    faces: list[Face] = []

    with path.open("r", encoding="utf-8") as source:
        for line_number, line in enumerate(source, 1):
            parts = line.split()
            if not parts or parts[0].startswith("#"):
                continue
            if parts[0] == "v":
                vertices.append(tuple(map(float, parts[1:4])))
            elif parts[0] == "vt":
                uvs.append(tuple(map(float, parts[1:3])))
            elif parts[0] == "vn":
                normals.append(tuple(map(float, parts[1:4])))
            elif parts[0] == "f":
                corners: list[Corner] = []
                for token in parts[1:]:
                    fields = token.split("/")
                    if len(fields) < 3 or not fields[0] or not fields[1] or not fields[2]:
                        raise ValueError(f"{path}:{line_number}: every face needs v/vt/vn indices")
                    corners.append(
                        (
                            _index(fields[0], len(vertices)),
                            _index(fields[1], len(uvs)),
                            _index(fields[2], len(normals)),
                        )
                    )
                if len(corners) < 3:
                    raise ValueError(f"{path}:{line_number}: face has fewer than three corners")
                faces.append(tuple(corners))

    if not vertices or not uvs or not normals or not faces:
        raise ValueError(f"{path} is not a complete textured OBJ")
    return vertices, uvs, normals, faces


def connected_components(vertices: list[Vertex], faces: list[Face]) -> list[list[Face]]:
    """Group disconnected pieces without trusting exporter-specific OBJ groups."""
    parent = list(range(len(vertices)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    for face in faces:
        anchor = face[0][0]
        for corner in face[1:]:
            union(anchor, corner[0])

    grouped: dict[int, list[Face]] = defaultdict(list)
    for face in faces:
        grouped[find(face[0][0])].append(face)

    # In model space the disc is highest, the health control is below it, and
    # reset is lowest. Sorting by the greatest Z is stable across face order.
    def highest_z(component: list[Face]) -> float:
        return max(vertices[corner[0]][2] for face in component for corner in face)

    return sorted(grouped.values(), key=highest_z, reverse=True)


def normal_y(face: Face, normals: list[Normal]) -> float:
    return sum(normals[corner[2]][1] for corner in face) / len(face)


def uv_point(uv: Uv) -> tuple[float, float]:
    # OBJ V grows from the bottom; Pillow's Y grows from the top.
    return uv[0] * WIDTH, (1 - uv[1]) * HEIGHT


def paint_faces(image: Image.Image, faces: list[Face], uvs: list[Uv], colour) -> None:
    draw = ImageDraw.Draw(image)
    for face in faces:
        draw.polygon([uv_point(uvs[corner[1]]) for corner in face], fill=colour)


def body_layer() -> Image.Image:
    # UV filtering samples just beyond island edges. A dark full-canvas ground
    # gives every bevel a deliberate rim instead of a transparent fringe.
    return Image.new("RGBA", SIZE, (*RIM, 255))


def art_layer(
    faces: list[Face],
    uvs: list[Uv],
    normals: list[Normal],
    front: bool,
) -> Image.Image:
    image = blank(SIZE)
    selected = [
        face
        for face in faces
        if (normal_y(face, normals) > 0.5 if front else normal_y(face, normals) < -0.5)
    ]
    paint_faces(image, selected, uvs, (*(FRONT if front else BACK), 255))

    # A quiet placeholder survives in the flattened guide preview but belongs
    # to the replaceable layer, so replacing the layer removes it completely.
    draw = ImageDraw.Draw(image)
    centre = (WIDTH / 2, FACE / 2 if front else FACE * 1.5)
    centred(
        draw,
        (centre[0], centre[1] - 18),
        "FRONT ARTWORK" if front else "BACK ARTWORK",
        38,
        (*PLATE_RING, 255),
    )
    centred(draw, (centre[0], centre[1] + 30), "REPLACE THIS LAYER", 24, (*PLATE_RING, 255))
    return image


def component_layer(faces: list[Face], uvs: list[Uv], colour) -> Image.Image:
    image = blank(SIZE)
    paint_faces(image, faces, uvs, (*colour, 255))
    return image


def face_circle(
    faces: list[Face],
    uvs: list[Uv],
    normals: list[Normal],
    front: bool,
) -> tuple[tuple[float, float], float]:
    """The flat face's inscribed circle, derived from its UV perimeter."""
    threshold = 0.999 if front else -0.999
    selected = [
        face
        for face in faces
        if (normal_y(face, normals) > threshold if front else normal_y(face, normals) < threshold)
    ]
    points = [uv_point(uvs[corner[1]]) for face in selected for corner in face]
    if not points:
        raise ValueError("The dial mesh has no flat front/back face")
    left = min(point[0] for point in points)
    right = max(point[0] for point in points)
    top = min(point[1] for point in points)
    bottom = max(point[1] for point in points)
    return ((left + right) / 2, (top + bottom) / 2), min(right - left, bottom - top) / 2


def wireframe(
    draw: ImageDraw.ImageDraw,
    faces: list[Face],
    uvs: list[Uv],
    colour,
    width: int,
) -> None:
    for face in faces:
        points = [uv_point(uvs[corner[1]]) for corner in face]
        draw.line(points + [points[0]], fill=colour, width=width)


def guide_layer(
    disc: list[Face],
    controls: list[Face],
    reset: list[Face],
    uvs: list[Uv],
    normals: list[Normal],
) -> Image.Image:
    image = blank(SIZE)
    draw = ImageDraw.Draw(image)
    front_ink = (*GUIDE, 210)
    back_ink = (255, 183, 92, 210)
    control_ink = (255, 112, 112, 220)
    reset_ink = (149, 238, 138, 220)
    faint = (*GUIDE, 80)

    front_faces = [face for face in disc if normal_y(face, normals) > 0.5]
    back_faces = [face for face in disc if normal_y(face, normals) < -0.5]
    rim_faces = [face for face in disc if abs(normal_y(face, normals)) <= 0.5]

    wireframe(draw, front_faces, uvs, front_ink, 2)
    wireframe(draw, back_faces, uvs, back_ink, 2)
    wireframe(draw, rim_faces, uvs, faint, 1)
    wireframe(draw, controls, uvs, control_ink, 2)
    wireframe(draw, reset, uvs, reset_ink, 2)

    for is_front, ink in ((True, front_ink), (False, back_ink)):
        centre, radius = face_circle(disc, uvs, normals, is_front)
        ring(draw, centre, radius, ink, 3, dash=72)
        ring(draw, centre, radius * 0.94, (*ink[:3], 100), 2)
        draw.line((centre[0], centre[1] - radius, centre[0], centre[1] + radius), fill=faint, width=1)
        draw.line((centre[0] - radius, centre[1], centre[0] + radius, centre[1]), fill=faint, width=1)

    draw.line((0, FACE, WIDTH, FACE), fill=front_ink, width=3)
    centred(draw, (WIDTH / 2, FACE - 56), "HEALTH CONTROLS / RESET UV", 24, control_ink)
    centred(draw, (WIDTH / 2, FACE - 25), "keep the neutral control layers visible", 18, control_ink)

    draw.text((22, 18), "FRONT / TOP FACE", font=font(24), fill=front_ink)
    draw.text((22, FACE + 18), "BACK / UNDERSIDE", font=font(24), fill=back_ink)
    draw.multiline_text(
        (22, HEIGHT - 88),
        "Hide this guide before saving. The game adds the changing health value and < > labels;\n"
        "do not paint them into either artwork layer.",
        font=font(19),
        fill=front_ink,
        spacing=5,
    )
    return image


def main() -> None:
    if not MESH.exists():
        raise FileNotFoundError(f"Health dial mesh is missing: {MESH}")

    vertices, uvs, normals, faces = read_obj(MESH)
    components = connected_components(vertices, faces)
    if len(components) != 3:
        raise ValueError(f"Expected disc, health controls, and reset components; found {len(components)}")
    disc, controls, reset = components

    stem = "health_dial_skin_two_sided"
    publish(
        stem,
        [
            (body_layer(), "Unpainted body and rim", True),
            (art_layer(disc, uvs, normals, True), "Front artwork - replace this", True),
            (art_layer(disc, uvs, normals, False), "Back artwork - replace this", True),
            (component_layer(controls, uvs, CONTROL), "Health controls - keep visible", True),
            (component_layer(reset, uvs, RESET), "Reset control - keep visible", True),
            (guide_layer(disc, controls, reset, uvs, normals), "Guides - hide before saving", True),
        ],
        SIZE,
    )

    source_psd = ROOT / "assets" / "resources" / f"{stem}.psd"
    PUBLIC_PSD.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source_psd, PUBLIC_PSD)
    print(f"copied {PUBLIC_PSD}")


if __name__ == "__main__":
    main()
