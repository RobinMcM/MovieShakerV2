FROM python:3.11-slim

WORKDIR /app

# Install Redis (Valkey compatible)
RUN apt-get update && apt-get install -y redis-server && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Make start script executable
RUN chmod +x start.sh

CMD ["./start.sh"]
