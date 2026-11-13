# syntax=docker/dockerfile:1.7
# Construir desde la raíz del monorepo: docker build -f services/worker/Dockerfile .
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 SCHEMAS_DIR=/repo/data/schemas \
    PGSSLROOTCERT=/etc/ssl/rds-global-bundle.pem
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/rds-global-bundle.pem
WORKDIR /repo
COPY services/validator services/validator
COPY services/optimizer services/optimizer
COPY services/worker services/worker
COPY data/schemas data/schemas
RUN pip install ./services/validator ./services/optimizer ./services/worker \
 && useradd --system --uid 10001 worker
USER worker
CMD ["scheduler-worker"]
