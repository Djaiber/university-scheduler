"""Perfiles de objetivo: multiplicadores sobre los pesos base del catálogo de reglas."""

from __future__ import annotations

from .domain import SOFT_RULES, Rules

PROFILES: dict[str, dict[str, int]] = {
    "balanced": {},
    "teacher_friendly": {"S1_TEACHER_PREFERENCE": 3},
    "compact": {"S2_EDGE_SLOT": 3, "S4_COHORT_DAY_LOAD": 2},
    "room_efficient": {"S3_ROOM_WASTE": 4},
}

# Orden en que se rotan los perfiles al generar varias alternativas
ROTATION = ("balanced", "teacher_friendly", "compact", "room_efficient")


def weights_for(rules: Rules, profile: str) -> dict[str, int]:
    if profile not in PROFILES:
        raise ValueError(f"Perfil desconocido '{profile}'. Opciones: {', '.join(PROFILES)}")
    mult = PROFILES[profile]
    return {rule: rules.soft_weights.get(rule, 0) * mult.get(rule, 1) for rule in SOFT_RULES}


def rotation_from(first: str, n: int) -> list[str]:
    """Perfiles para n alternativas empezando por el solicitado."""
    order = [first] + [p for p in ROTATION if p != first]
    return [order[i % len(order)] for i in range(n)]
