"""Diagrama de la arquitectura AWS desplegada por terraform/modules/platform (entorno dev).

Requiere Graphviz y la librería `diagrams` (https://diagrams.mingrammer.com):

    pip install diagrams
    python docs/diagrams/arquitectura_aws.py      # genera docs/diagrams/arquitectura-aws.png
"""

from pathlib import Path

from diagrams import Cluster, Diagram, Edge
from diagrams.aws.compute import ECR, Fargate
from diagrams.aws.cost import Budgets
from diagrams.aws.database import RDSPostgresqlInstance
from diagrams.aws.devtools import Codebuild
from diagrams.aws.integration import SNS, SQS
from diagrams.aws.management import Cloudwatch
from diagrams.aws.network import CloudFront, ElbApplicationLoadBalancer, Endpoint, NATGateway
from diagrams.aws.security import Cognito, SecretsManager
from diagrams.aws.storage import S3
from diagrams.onprem.ci import GithubActions
from diagrams.onprem.client import Users

OUT = Path(__file__).with_name("arquitectura-aws")  # diagrams añade la extensión .png

GRAPH = {
    "fontname": "Helvetica",
    "fontsize": "22",
    "labelloc": "t",
    "pad": "0.6",
    "nodesep": "0.7",
    "ranksep": "1.1",
    "splines": "spline",
}
NODE = {"fontname": "Helvetica", "fontsize": "12"}
EDGE = {"fontname": "Helvetica", "fontsize": "10", "color": "#46514a", "fontcolor": "#46514a"}

# Colores de clúster con la paleta de El Bosque (verde/marfil) para la VPC
VPC = {"bgcolor": "#f6faf6", "pencolor": "#2f6f3e", "fontcolor": "#24572f", "fontsize": "14", "penwidth": "2"}
PUBLIC = {"bgcolor": "#eef7ef", "pencolor": "#9fd6a3", "fontsize": "12"}
PRIVATE = {"bgcolor": "#e8f4ea", "pencolor": "#9fd6a3", "fontsize": "12"}
ECS = {"bgcolor": "#fff7ee", "pencolor": "#ed7100", "fontsize": "12"}
NEUTRAL = {"bgcolor": "#fafafa", "pencolor": "#b0b0b0", "style": "dashed", "fontsize": "12"}

control = {"style": "dashed"}
monitor = {"style": "dotted", "color": "#e7157b"}

with Diagram(
    "university-scheduler · arquitectura AWS (us-east-1, entorno dev)",
    filename=str(OUT),
    outformat="png",
    show=False,
    direction="LR",
    graph_attr=GRAPH,
    node_attr=NODE,
    edge_attr=EDGE,
):
    users = Users("Personal\nadministrativo")

    with Cluster("Despliegue", graph_attr=NEUTRAL):
        ci = GithubActions("Desarrollador / CI\ndeploy-dev.sh")
        build = Codebuild("CodeBuild\nimágenes ARM64")
        registry = ECR("ECR\napi · worker")

    with Cluster("Borde global", graph_attr=NEUTRAL):
        auth = Cognito("Cognito\nHosted UI · PKCE\n5 actores")
        cdn = CloudFront("CloudFront\n/* → S3 · /v1/* → ALB")
        site = S3("S3 web\npanel React")

    secrets = SecretsManager("Secrets Manager\ncredenciales RDS\nrotación 7 días")

    with Cluster("VPC 10.40.0.0/16 · 2 AZ · flow logs", graph_attr=VPC):
        with Cluster("Subredes públicas", graph_attr=PUBLIC):
            alb = ElbApplicationLoadBalancer("ALB\nsolo desde CloudFront")
            nat = NATGateway("NAT Gateway\n(1 en dev)")

        with Cluster("Subredes privadas", graph_attr=PRIVATE):
            with Cluster("ECS Fargate ARM64", graph_attr=ECS):
                api = Fargate("API NestJS\n:3000")
                worker = Fargate("Worker Python\nCP-SAT + validador\n0–1 tareas")
                migrate = Fargate("Migraciones\n(tarea única)")
            db = RDSPostgresqlInstance("RDS PostgreSQL 16\ncifrado · TLS · privado")

        s3_endpoint = Endpoint("VPC endpoint\nS3")

    with Cluster("Mensajería", graph_attr=NEUTRAL):
        jobs = SQS("SQS\noptimization-jobs")
        dlq = SQS("SQS DLQ\n3 intentos")

    with Cluster("Almacenamiento", graph_attr=NEUTRAL):
        imports = S3("S3 imports\nCSV · 1 año")
        exports = S3("S3 exports")

    with Cluster("Observabilidad y costes", graph_attr=NEUTRAL):
        logs = Cloudwatch("CloudWatch\nlogs · alarmas")
        alerts = SNS("SNS\nalertas")
        budget = Budgets("Budgets\nUSD 50/mes")

    # Petición del usuario
    users >> Edge(label="HTTPS") >> cdn
    users >> Edge(label="login", **control) >> auth
    cdn >> Edge(label="/*") >> site
    cdn >> Edge(label="/v1/*") >> alb >> Edge(label=":3000") >> api

    # Generación de horarios
    api >> Edge(label="TLS") >> db
    api >> Edge(label="encola") >> jobs
    worker << Edge(label="consume", constraint="false") << jobs
    api >> Edge(label="CSV") >> imports
    jobs >> Edge(label="redrive", **control) >> dlq
    worker >> Edge(label="alternativas") >> db
    worker >> exports
    worker >> Edge(label="S3 sin NAT", style="dotted") >> s3_endpoint
    migrate >> Edge(**control) >> db
    api >> Edge(label="JWKS", style="dotted", constraint="false") >> auth
    api >> Edge(style="dotted", label="salida a Internet", constraint="false") >> nat

    # Plano de control
    ci >> Edge(label="fuente", **control) >> build >> Edge(label="push", **control) >> registry
    ci >> Edge(label="build del panel", constraint="false", **control) >> site
    secrets >> Edge(label="credenciales", style="dotted") >> api

    # Observabilidad
    dlq >> Edge(label="alarma", **monitor) >> logs
    logs >> Edge(**monitor) >> alerts
    budget >> Edge(**monitor) >> alerts
