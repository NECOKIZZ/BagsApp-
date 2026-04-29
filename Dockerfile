# syntax=docker/dockerfile:1.6
FROM node:20-alpine

WORKDIR /app

# Install deps first for better layer caching
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# Copy server source (frontend isn't built/served here — frontend is hosted separately)
COPY server ./server
COPY tsconfig.json* ./

# Railway provides PORT at runtime
ENV NODE_ENV=production
EXPOSE 3001

CMD ["npm", "run", "start:server"]
