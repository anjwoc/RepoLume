# Use Python 3.11 as base image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install Node.js and npm
RUN apt-get update && apt-get install -y \
    nodejs \
    npm \
    git \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Upgrade npm to latest version
RUN npm install -g npm@latest

# Copy Python requirements and install dependencies
COPY api/requirements.txt ./api/
RUN pip install --no-cache-dir -r api/requirements.txt

# Copy package.json and install Node.js dependencies
COPY package.json package-lock.json ./
RUN npm install

# Copy the rest of the application
COPY . .

# Build the Next.js application
RUN npm run build

# Expose the port the app runs on
EXPOSE 8001 3000

# Create a script to run both backend and frontend
RUN echo '#!/bin/bash\n\
# Start the API server in the background\n\
python -m api.main &\n\
# Start the Next.js app\n\
npm run start\n\
' > /app/start.sh && chmod +x /app/start.sh

# Set environment variables
ENV PORT=8001
ENV NODE_ENV=production

# Command to run the application
CMD ["/app/start.sh"]
