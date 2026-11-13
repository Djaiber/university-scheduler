"""SCRUM-32 · Flujo extremo a extremo y escenarios de falla sobre la pila real."""

import json
import time

import pytest

# Actores (SCRUM-43): el administrador genera, ajusta y publica; el comité táctico evalúa y aprueba
COORD, REVIEWER, APPROVER, PUBLISHER = "ADMINISTRADOR", "COMITE_TACTICO", "COMITE_TACTICO", "ADMINISTRADOR"


def test_importacion_solicitud_solver_edicion_aprobacion_publicacion(seeded):
    s = seeded
    # 1. Solicitud → SQS → worker → alternativas validadas
    req = s.call(
        "POST",
        "/schedule-requests",
        role=COORD,
        actor="ana@unbosque.edu.co",
        json={"period": "2027-1", "alternatives_requested": 3, "time_limit_seconds": 20, "seed": 3},
    )
    assert req.status_code == 202 and req.json()["published"] is True
    rid = req.json()["request_id"]
    detail = s.wait_status(rid, {"PENDING_REVIEW", "FAILED", "INFEASIBLE"})
    assert detail["status"] == "PENDING_REVIEW"
    assert len(detail["alternatives"]) == 3
    assert all(a["hard_violations"] == 0 for a in detail["alternatives"])
    run = detail["runs"][0]
    assert run["diagnostics"]["result_uri"].startswith("s3://e2e-exports/runs/")

    # 2. Comparación
    cmp = s.call("GET", f"/schedule-requests/{rid}/comparison").json()
    assert min(v for row in cmp["pairwise_diversity"] for v in row if v > 0) >= 0.3

    # 3. Ajuste manual válido: mover una sesión a otra aula equivalente libre
    alt_id = cmp["alternatives"][0]["id"]
    alt = s.call("GET", f"/alternatives/{alt_id}").json()
    a = alt["assignments"][0]
    used = {(x["slot"], x["room"]) for x in alt["assignments"]}
    group_size = next(g for g in s.sql("SELECT size FROM groups WHERE code = %s", (a["group"],)))[0]
    target = next(
        r["id"]
        for r in alt["context"]["rooms"]
        if r["id"] != a["room"]
        and r["capacity"] >= group_size
        and (a["slot"], r["id"]) not in used
        and set(r.get("features", []))
        >= set(next(g for g in s.sql("SELECT required_features FROM groups WHERE code = %s", (a["group"],)))[0])
    )
    rev = s.call(
        "POST",
        f"/alternatives/{alt_id}/revisions",
        role=COORD,
        actor="ana@unbosque.edu.co",
        json={
            "base_revision_id": alt["revision"]["id"],
            "reason": "Aula más cercana para el docente",
            "changes": [{"group": a["group"], "session": a["session"], "slot": a["slot"], "room": target}],
        },
    )
    assert rev.status_code == 201, rev.text
    assert rev.json()["validation"]["valid"] is True

    # 4. Revisión → aprobación (otra persona) → publicación
    rev_id = rev.json()["id"]
    assert (
        s.call(
            "POST",
            f"/revisions/{rev_id}/reviews",
            role=REVIEWER,
            actor="sec@unbosque.edu.co",
            json={"decision": "SEND_TO_APPROVAL"},
        ).status_code
        == 201
    )
    ap = s.call("POST", f"/revisions/{rev_id}/approvals", role=APPROVER, actor="dec@unbosque.edu.co", json={})
    assert ap.status_code == 201, ap.text
    pub = s.call("POST", f"/approvals/{ap.json()['id']}/publish", role=PUBLISHER, actor="reg@unbosque.edu.co")
    assert pub.status_code == 201, pub.text
    uri = pub.json()["export_uri"]
    obj = s.s3.get_object(Bucket="e2e-exports", Key=uri.split("e2e-exports/")[1])
    doc = json.loads(obj["Body"].read())
    assert doc["format"] == "horario-publicado.v1" and len(doc["sessions"]) == 16
    assert any(x["room"] == target and x["group"] == a["group"] for x in doc["sessions"])
    assert s.call("GET", f"/schedule-requests/{rid}").json()["status"] == "PUBLISHED"


def test_mensaje_duplicado_no_genera_resultados_duplicados(seeded):
    s = seeded
    rid = s.call(
        "POST",
        "/schedule-requests",
        role=COORD,
        json={"period": "2027-1", "alternatives_requested": 1, "time_limit_seconds": 10},
    ).json()["request_id"]
    s.wait_status(rid, {"PENDING_REVIEW"})
    # Reenvío manual del mismo mensaje (simula la entrega "al menos una vez" de SQS)
    run_id, key, snap_id, sha = s.sql(
        "SELECT o.id, o.idempotency_key, s.id, trim(s.content_sha256) FROM optimization_runs o JOIN schedule_requests r ON r.id = o.request_id "
        "JOIN input_snapshots s ON s.id = r.snapshot_id WHERE r.id = %s",
        (rid,),
    )[0]
    msg = {
        "schema_version": "1.0",
        "message_id": "8f9d1e2a-3b4c-4d5e-8f60-718293a4b5c6",
        "run_id": str(run_id),
        "request_id": rid,
        "idempotency_key": key,
        "snapshot": {"snapshot_id": str(snap_id), "content_sha256": sha},
        "parameters": {"alternatives_requested": 1, "optimization_profile": "balanced", "time_limit_seconds": 10},
        "enqueued_at": "2026-11-04T15:00:00Z",
    }
    s.sqs.send_message(QueueUrl=s.queue_url, MessageBody=json.dumps(msg))
    time.sleep(6)
    assert s.sql("SELECT count(*) FROM schedule_alternatives WHERE run_id = %s", (run_id,))[0][0] == 1
    assert (
        s.sql("SELECT count(*) FROM audit_logs WHERE entity_id = %s AND action = 'RUN_CLAIMED'", (str(run_id),))[0][0]
        == 1
    )


def test_escenario_inviable_se_explica_y_no_se_reintenta(seeded):
    s = seeded
    # Sobrecarga: un docente concentra todas las sesiones y solo tiene 2 franjas
    s.call(
        "POST",
        "/imports/teacher_availability?period=2027-1",
        role="ADMINISTRADOR",
        files={
            "file": (
                "ta.csv",
                "teacher_code,slot_code,availability\n"
                + "".join(
                    f"T001,{slot},UNAVAILABLE\n" for (slot,) in s.sql("SELECT code FROM time_slots ORDER BY code")[2:]
                ),
                "text/csv",
            )
        },
    )
    for (code,) in s.sql("SELECT code FROM groups"):
        s.sql(
            "UPDATE groups SET teacher_id = (SELECT id FROM teachers WHERE external_code = 'T001') WHERE code = %s RETURNING 1",
            (code,),
        )
    s.consolidate_offer("Toda la oferta con un solo docente (escenario inviable)")
    rid = s.call("POST", "/schedule-requests", role=COORD, json={"period": "2027-1", "time_limit_seconds": 10}).json()[
        "request_id"
    ]
    detail = s.wait_status(rid, {"INFEASIBLE", "FAILED", "PENDING_REVIEW"})
    assert detail["status"] == "INFEASIBLE"
    assert "TEACHER_OVERLOAD" in {f["rule"] for f in detail["runs"][0]["diagnostics"]["precheck"]}
    assert (
        s.sqs.get_queue_attributes(QueueUrl=s.dlq_url, AttributeNames=["ApproximateNumberOfMessages"])["Attributes"][
            "ApproximateNumberOfMessages"
        ]
        == "0"
    )


def test_mensaje_fuera_de_contrato_se_descarta_sin_bloquear_la_cola(seeded):
    s = seeded
    s.sqs.send_message(QueueUrl=s.queue_url, MessageBody='{"schema_version": "9.9"}')
    time.sleep(4)
    attrs = s.sqs.get_queue_attributes(
        QueueUrl=s.queue_url, AttributeNames=["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"]
    )["Attributes"]
    assert attrs["ApproximateNumberOfMessages"] == "0" and attrs["ApproximateNumberOfMessagesNotVisible"] == "0"


@pytest.mark.parametrize("role,expected", [("COMITE_TACTICO", 403), ("DIRECTOR", 403), ("ADMINISTRADOR", 202)])
def test_permisos_en_la_pila_real(seeded, role, expected):
    res = seeded.call("POST", "/schedule-requests", role=role, json={"period": "2027-1", "time_limit_seconds": 5})
    assert res.status_code == expected
