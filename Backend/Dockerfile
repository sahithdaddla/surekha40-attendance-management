# -------- Backend/Dockerfile --------
FROM node:20-alpine

WORKDIR /app

# Install production deps
COPY package*.json ./
RUN npm ci --production

# Copy source
COPY . .

EXPOSE 3027
ENV NODE_ENV=production

CMD ["node", "server.js"]

