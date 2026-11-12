FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# The bundle needs Node alone: no node_modules in the image.
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist/index.js ./index.js
USER node
CMD ["node", "index.js"]
