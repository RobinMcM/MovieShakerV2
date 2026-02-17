FROM python:3.11-slim

WORKDIR /app

# Valkey runs as separate container; use VALKEY_URL in env to connect

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run via shell so start.sh works when ./engine is volume-mounted (host may not have +x)
CMD ["sh", "start.sh"]
