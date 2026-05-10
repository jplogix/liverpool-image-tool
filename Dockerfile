FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json yarn.lock* package-lock.json* ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Expose port (server.mjs uses 3000 by default)
EXPOSE 3000

# Start the Node.js server
CMD ["node", "server.mjs"]
