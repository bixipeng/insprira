# syntax=docker/dockerfile:1
FROM node:22-slim

# better-sqlite3 需要编译原生模块；unzip 用于 SKILL 更新
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    gcc \
    ca-certificates \
    git \
    unzip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先复制依赖文件，利用 Docker 层缓存
COPY package*.json ./
RUN npm ci --only=production

# 复制应用代码
COPY . .

# 数据目录：SQLite 数据库和日志建议挂载到此目录
ENV DATA_DIR=/data
RUN mkdir -p /data
VOLUME ["/data"]

# 默认监听端口
EXPOSE 8080

CMD ["node", "server.js"]
