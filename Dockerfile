FROM node:18-alpine

# Installation de net-tools qui inclut ether-wake
RUN apk add --no-cache net-tools

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

# Commande de démarrage explicite sans point d'entrée
CMD ["node", "server.js"]