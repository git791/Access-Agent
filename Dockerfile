# The Playwright image ships the matching Chromium binary and all Linux browser
# dependencies, which a regular Node/Vercel serverless image does not provide.
FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . ./
RUN npm run build

EXPOSE 10000
CMD ["sh", "-c", "npm run start -- -p ${PORT:-10000}"]
