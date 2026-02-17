FROM python:3.11-slim

WORKDIR /app

# Install Redis (Valkey compatible)
RUN apt-get update && apt-get install -y redis-server && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run via shell so start.sh works when ./engine is volume-mounted (host may not have +x)
CMD ["sh", "start.sh"]
