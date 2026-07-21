FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Install deps first for layer caching
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public

EXPOSE 3000
CMD ["node", "src/index.js"]
