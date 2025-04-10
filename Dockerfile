FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY sync.js ./
COPY firebase-key.json ./

CMD ["node", "sync.js"]