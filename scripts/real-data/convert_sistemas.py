"""Convierte los horarios reales de Ingeniería de Sistemas (Excel) a las plantillas CSV de importación v1.

Entrada (no versionada, contiene datos personales): data/University-Excels/
  - "<periodo> Horarios Dia IngDeSistema*.xlsx": cuadrícula por semestre; cada celda trae
    código, asignatura y grupos con el docente entre paréntesis, p. ej. "G1,3 (Nombre Apellido)".
  - "Horario Sistemas *.xlsx": tabla con el cupo de cada grupo (se usa como tamaño).

Salida: data/University-Excels/import/*.csv (también ignorada por git) en el orden de carga.

    python scripts/real-data/convert_sistemas.py --max-semester 5

Decisiones (ver docs/pilot/showcase-sistemas.md):
  - El horario real solo aporta la demanda (cursos, grupos, docentes, sesiones); las franjas se
    normalizan a bloques de 2 h para que el optimizador genere alternativas nuevas.
  - Cohorte = plan + semestre + número de grupo: el grupo G1 de un semestre no puede chocar entre sí.
  - Grupos sin docente ("Pendiente", servicio de otra facultad) reciben un docente "Por asignar" propio.
  - Los Excel no traen inventario de aulas: se usan las que aparecen en las celdas y se completan con
    aulas inferidas de los bloques B y F, marcadas como "(inferido)".
"""

from __future__ import annotations

import argparse
import collections
import csv
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "University-Excels"
OUT = SRC / "import"

DAYS = {1: "MON", 2: "TUE", 3: "WED", 4: "THU", 5: "FRI", 6: "SAT"}
# Bloques de 2 h (L–V con pausa de almuerzo 13–14; sábado en la mañana)
WEEKDAY_BLOCKS = [("07:00", "09:00"), ("09:00", "11:00"), ("11:00", "13:00"), ("14:00", "16:00"), ("16:00", "18:00")]
SATURDAY_BLOCKS = WEEKDAY_BLOCKS[:3]
NOT_A_TEACHER = {"pendiente", "usaquen", "virtual", "chia", "por definir", "repitentes"}
ROOM_RE = re.compile(r"\b([A-Z])-?(\d{3})\b")
LAB_RE = re.compile(r"program|bases? de datos|software|desarrollo de sistemas|sistemas operacionales|"
                    r"microprocesador|digitales|redes|computaci", re.I)
GROUP_RE = re.compile(
    r"Gr?\s*(\d+(?:\s*[,\-]\s*(?:Gr?\s*)?\d+)*)\s*(?:\(([^()]*)\))?", re.I)


def plain(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    return re.sub(r"\s+", " ", "".join(c for c in s if not unicodedata.combining(c))).strip().lower()


def lev(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


@dataclass
class Group:
    plan: str
    course: str
    number: int
    semester: int
    tag: str
    sessions: list[tuple[int, int, int]] = field(default_factory=list)  # (día, hora inicio, duración h)
    teachers: collections.Counter = field(default_factory=collections.Counter)
    rooms: set[str] = field(default_factory=set)

    @property
    def code(self) -> str:
        return f"{self.course}-{self.plan}-G{self.number}"

    @property
    def cohort(self) -> str:
        return f"{self.plan}-S{self.semester}{self.tag}-G{self.number}"


def parse_numbers(spec: str) -> list[int]:
    spec = re.sub(r"Gr?\s*", "", spec, flags=re.I)
    out: list[int] = []
    for part in re.split(r"\s*,\s*", spec):
        if "-" in part:
            a, b = (int(x) for x in part.split("-")[:2])
            out.extend(range(a, b + 1) if b >= a else [a, b])
        elif part.strip().isdigit():
            out.append(int(part))
    return out


def parse_grid(path: Path, max_semester: int):
    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    spans = {(r.min_row, r.min_col): r.max_row - r.min_row + 1 for r in ws.merged_cells.ranges}
    plans = {}
    for c in ws[1]:
        if isinstance(c.value, str) and (m := re.search(r"\((\d{3})\)", c.value)):
            plans[c.column] = m.group(1)
    courses: dict[tuple[str, str], tuple[str, int]] = {}
    groups: dict[tuple[str, str, int], Group] = {}
    names: dict[tuple[str, str], collections.Counter] = collections.defaultdict(collections.Counter)

    anchors = [c for row in ws.iter_rows() for c in row
               if isinstance(c.value, str) and c.value.strip().lower().startswith("semestre")]
    for a in anchors:
        sem = int(re.search(r"\d+", a.value).group())
        if sem > max_semester:
            continue
        tag = "R" if "repit" in a.value.lower() else "E" if "equival" in a.value.lower() else ""
        plan = plans[max(col for col in plans if col <= a.column)]
        for r in range(a.row + 2, a.row + 18):
            hour = ws.cell(r, a.column).value
            if not isinstance(hour, str) or not (m := re.match(r"\s*(\d{1,2})", hour)):
                continue
            start = int(m.group(1))
            for day in DAYS:
                cell = ws.cell(r, a.column + day)
                if not isinstance(cell.value, str):
                    continue
                dur = spans.get((cell.row, cell.column), 1)
                for entry in re.split(r"\n\s*-{3,}\s*", cell.value):
                    lines = [x.strip() for x in entry.strip().split("\n") if x.strip()]
                    if len(lines) < 2 or not re.fullmatch(r"\d{3,6}", lines[0]):
                        continue  # electivas "Según elección" y similares
                    code, name = lines[0], re.sub(r"\s+", " ", lines[1])
                    # "Matemáticas 1R" (grupo remedial) o "Idiomas 3 G2": el nombre del curso es la variante base
                    name = re.sub(r"(\d)R$|\s+Gr?\s*\d+$", r"\1", name).strip()
                    names[(plan, code)][name] += 1
                    courses.setdefault((plan, code), (name, sem))
                    body = " ".join(lines[2:])
                    matches = list(GROUP_RE.finditer(body)) or [None]
                    for gm in matches:
                        nums = parse_numbers(gm.group(1)) if gm else [1]
                        who = (gm.group(2) or "").strip() if gm else ""
                        room = None
                        if rm := ROOM_RE.search(who):
                            room, who = f"{rm.group(1)}{rm.group(2)}", ROOM_RE.sub("", who).strip(" ,-")
                        if plain(who) in NOT_A_TEACHER or not re.search(r"[a-záéíóúñ]{2}", who, re.I):
                            who = ""
                        for n in nums or [1]:
                            g = groups.setdefault((plan, code, n), Group(plan, code, n, sem, tag))
                            if (day, start, dur) not in g.sessions:
                                g.sessions.append((day, start, dur))
                            if who:
                                g.teachers[who] += 1
                            if room:
                                g.rooms.add(room)
    courses = {k: (names[k].most_common(1)[0][0], sem) for k, (_, sem) in courses.items()}
    return courses, groups


def capacities(path: Path) -> dict[str, int]:
    ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
    head = [str(c.value).strip().lower() if c.value else "" for c in ws[1]]
    gi, ci = head.index("grupo"), head.index("cupo")
    cupo: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row[gi] and isinstance(row[ci], (int, float)):
            cupo[str(row[gi]).split("-")[0]][int(row[ci])] += 1
    return {k: v.most_common(1)[0][0] for k, v in cupo.items()}


def merge_teachers(names: collections.Counter) -> dict[str, str]:
    """Agrupa variantes del mismo nombre (tildes, espacios, orden, una letra) → nombre canónico."""
    key = lambda n: " ".join(sorted(plain(n).split()))  # noqa: E731
    clusters: list[list[str]] = []
    for n in sorted(names, key=lambda x: -names[x]):
        k = key(n).replace(" ", "")
        for cl in clusters:
            ck = key(cl[0]).replace(" ", "")
            if ck == k or (len(k) > 8 and lev(ck, k) <= 1):
                cl.append(n)
                break
        else:
            clusters.append([n])
    canon = {}
    for cl in clusters:
        best = max(cl, key=lambda x: (names[x], sum(not c.isascii() for c in x), " " in x))
        for n in cl:
            canon[n] = best
    return canon


def teacher_code(name: str, used: set[str]) -> str:
    toks = re.sub(r"[^A-Z ]", "", plain(name).upper()).split()
    base = f"{toks[0]}-{toks[-1]}"[:20] if len(toks) > 1 else toks[0][:20]
    code, i = base, 2
    while code in used:
        code = f"{base[:17]}-{i}"
        i += 1
    used.add(code)
    return code


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-semester", type=int, default=5)
    ap.add_argument("--grid", default=None, help="Excel de cuadrícula (por defecto, el diurno más reciente)")
    args = ap.parse_args()

    grid = Path(args.grid) if args.grid else sorted(SRC.glob("*Horarios Dia*Sistema*.xlsx"))[-1]
    table = sorted(SRC.glob("Horario Sistemas*.xlsx"))[-1]
    courses, groups = parse_grid(grid, args.max_semester)
    cupo = capacities(table)

    all_names = collections.Counter()
    for g in groups.values():
        all_names.update(g.teachers)
    canon = merge_teachers(all_names)

    used: set[str] = set()
    teachers: dict[str, tuple[str, str]] = {}  # código → (nombre, nota)
    by_name: dict[str, str] = {}
    for name in sorted(set(canon.values()), key=plain):
        by_name[name] = teacher_code(name, used)
        teachers[by_name[name]] = (name, "")

    rows_groups, room_codes = [], set()
    for g in sorted(groups.values(), key=lambda x: (x.plan, x.semester, x.course, x.number)):
        if g.teachers:
            t = by_name[canon[g.teachers.most_common(1)[0][0]]]
        else:
            t = f"PA-{g.code}"[:20]
            teachers[t] = (f"Por asignar ({g.code})", "")
        sessions = sum(2 if d >= 4 else 1 for _, _, d in g.sessions)
        lab = bool(LAB_RE.search(courses[(g.plan, g.course)][0]))
        rows_groups.append([g.code, g.course, t, g.cohort, cupo.get(g.course, 35),
                            max(1, min(6, sessions)), "computers" if lab else ""])
        room_codes |= g.rooms

    OUT.mkdir(parents=True, exist_ok=True)

    def write(name: str, header: list[str], rows: list[list]) -> None:
        with open(OUT / f"{name}.csv", "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(header)
            w.writerows(rows)

    slots = []
    for d, prefix in DAYS.items():
        blocks = SATURDAY_BLOCKS if d == 6 else WEEKDAY_BLOCKS
        for i, (s, e) in enumerate(blocks):
            slots.append([f"{prefix}-{i}", d, s, e, str(i in (0, len(blocks) - 1)).lower()])
    write("time_slots", ["code", "day_of_week", "starts_at", "ends_at", "is_edge"], slots)

    write("teachers", ["external_code", "full_name", "email"],
          [[c, n, ""] for c, (n, _) in sorted(teachers.items())])

    # Aulas: las reales de las celdas + inferidas para cubrir la demanda (≈ 70 % de ocupación)
    n_sessions = sum(r[5] for r in rows_groups)
    n_lab = sum(r[5] for r in rows_groups if r[6])
    per_room = len(slots) * 0.7
    need_lab = max(2, round(n_lab / per_room + 0.49))
    need_std = max(2, round((n_sessions - n_lab) / per_room + 0.49))
    rooms = [[c, f"Bloque {c[0]}", 35, "projector"] for c in sorted(room_codes)]
    std_have = len(rooms)
    for i in range(max(0, need_std - std_have)):
        rooms.append([f"B{401 + i}", "Bloque B (inferido)", 35, "projector"])
    for i in range(need_lab):
        rooms.append([f"F{301 + i}", "Bloque F (inferido)", 30, "computers|projector"])
    write("classrooms", ["code", "building", "capacity", "features"], rooms)

    write("courses", ["program_code", "code", "name", "semester"],
          [[f"IS-{p}", c, n, s] for (p, c), (n, s) in sorted(courses.items())
           if any(g.plan == p and g.course == c for g in groups.values())])
    # El curso se referencia por código; si el mismo código existe en dos planes se usa el primero
    write("groups", ["code", "course_code", "teacher_code", "cohort", "size", "sessions_per_week",
                     "required_features"], rows_groups)
    write("teacher_availability", ["teacher_code", "slot_code", "availability"], [])
    write("classroom_availability", ["classroom_code", "slot_code", "available", "reason"], [])

    named = sum(1 for c in teachers if not c.startswith("PA-"))
    print(f"Origen: {grid.name} (semestres 1–{args.max_semester}) · cupos de {table.name}")
    print(f"Programas: {sorted({f'IS-{p}' for p, _ in courses})}")
    print(f"Cursos: {len({c for _, c in courses})} · grupos: {len(rows_groups)} · sesiones/semana: {n_sessions}"
          f" (en sala de cómputo: {n_lab})")
    print(f"Docentes reales: {named} (variantes unificadas: {len(all_names) - named}) · "
          f"por asignar: {len(teachers) - named}")
    print(f"Aulas: {len(rooms)} ({std_have} reales, {len(rooms) - std_have} inferidas) · franjas: {len(slots)}")
    print(f"CSV en {OUT.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
