# Base image
FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies and TypeScript
RUN npm install
RUN npm install -g typescript

# Copy source code and config files
COPY src ./src
COPY tsconfig.json ./

# Build TypeScript to Javascript
RUN npm run build

# Expose the correct port
# Hugging Face Spaces exposes port 7860 by default
ENV PORT=7860
EXPOSE 7860

# Start command
CMD ["npm", "start"]
