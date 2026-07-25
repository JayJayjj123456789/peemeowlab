FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# curl is needed by the compose healthcheck
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && apt-get clean \
    && find /var/lib/apt/lists -type f -delete

# deps first for better layer cache
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts ./scripts

EXPOSE 8000

# must listen on 0.0.0.0:8000 inside the container
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
