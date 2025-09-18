# 🚀 PanSou 一体化部署指南

本指南将帮助您快速部署包含前后端的完整 PanSou 应用。

## 📋 部署前准备

### 系统要求

- Docker 20.0+
- Docker Compose 2.0+ (可选)
- 2GB+ 可用内存
- 10GB+ 可用存储空间

### 端口需求

- `80` - HTTP服务
- `443` - HTTPS服务 (可选)

## 🚀 快速部署

### 方式一：Docker Run (最简单)

```bash
# 1. 运行容器 (使用最新稳定版)
docker run -d \
  --name pansou-app \
  -p 80:80 \
  -v pansou-data:/app/data \
  ghcr.io/fish2018/pansou-web:latest

# 或者更简单 (省略:latest标签)
docker run -d \
  --name pansou-app \
  -p 80:80 \
  -v pansou-data:/app/data \
  ghcr.io/fish2018/pansou-web

# 2. 访问应用
open http://localhost
```

### 方式二：Docker Compose (推荐)

```bash
# 1. 下载配置文件
curl -o docker-compose.yml https://raw.githubusercontent.com/fish2018/pansou-web/main/docker-compose.yml

# 2. 启动服务
docker-compose up -d

# 3. 查看日志
docker-compose logs -f

# 4. 访问应用
open http://localhost
```

### 方式三：自定义配置

```bash
# 1. 创建配置目录
mkdir pansou-deploy && cd pansou-deploy

# 2. 创建 docker-compose.yml
cat > docker-compose.yml << 'EOF'
version: '3.8'
services:
  pansou:
    image: ghcr.io/fish2018/pansou-web:latest
    container_name: pansou-app
    ports:
      - "80:80"
    environment:
      - DOMAIN=yourdomain.com  # 替换为您的域名
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    restart: unless-stopped
EOF

# 3. 启动服务
docker-compose up -d
```

## ⚙️ 配置说明

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `DOMAIN` | `localhost` | 服务域名 |
| `PANSOU_PORT` | `8888` | 后端服务端口 |
| `PANSOU_HOST` | `127.0.0.1` | 后端服务地址 |

### 数据持久化

```bash
# 推荐的目录结构
./
├── docker-compose.yml
├── data/              # 应用数据
│   ├── cache/         # 缓存文件
│   └── ssl/           # SSL证书 (可选)
└── logs/              # 日志文件
    ├── pansou.log     # 后端日志
    └── nginx/         # Nginx日志
```

### SSL证书配置

```bash
# 1. 准备证书文件
mkdir -p data/ssl
cp your_certificate.pem data/ssl/fullchain.pem
cp your_private_key.key data/ssl/privkey.pem

# 2. 修改docker-compose.yml，映射SSL目录
volumes:
  - ./data:/app/data
  - ./logs:/app/logs

# 3. 重启服务
docker-compose restart
```

## 🔧 运维管理

### 常用命令

```bash
# 查看服务状态
docker-compose ps

# 查看实时日志
docker-compose logs -f

# 重启服务
docker-compose restart

# 停止服务
docker-compose stop

# 更新镜像
docker-compose pull && docker-compose up -d

# 清理资源
docker-compose down -v
```

### 健康检查

```bash
# 检查API健康状态
curl http://localhost/api/health

# 预期响应
{
  "status": "ok",
  "plugins_enabled": true,
  "plugin_count": 6,
  "plugins": ["pansearch", "hdr4k", "shandian", "muou", "duoduo", "labi"],
  "channels": ["tgsearchers3", "SharePanBaidu", "yunpanxunlei"]
}
```

### 性能监控

```bash
# 查看资源使用
docker stats pansou-app

# 查看详细信息
docker inspect pansou-app

# 查看端口映射
docker port pansou-app
```

## 🐛 故障排除

### 常见问题

#### 1. 容器无法启动

```bash
# 查看详细错误日志
docker-compose logs pansou

# 检查端口占用
netstat -tulpn | grep :80
```

#### 2. API请求失败

```bash
# 检查后端服务状态
docker-compose exec pansou curl http://127.0.0.1:8888/api/health

# 检查Nginx配置
docker-compose exec pansou nginx -t
```

#### 3. 前端页面无法访问

```bash
# 检查前端文件
docker-compose exec pansou ls -la /app/frontend/dist/

# 检查Nginx状态
docker-compose exec pansou ps aux | grep nginx
```

### 日志查看

```bash
# 后端日志
docker-compose exec pansou tail -f /app/logs/pansou.log

# Nginx访问日志
docker-compose exec pansou tail -f /var/log/nginx/access.log

# Nginx错误日志
docker-compose exec pansou tail -f /var/log/nginx/error.log
```

## 🔄 版本更新

### 自动更新

```bash
# 创建更新脚本
cat > update.sh << 'EOF'
#!/bin/bash
echo "正在更新 PanSou..."
docker-compose pull
docker-compose up -d
docker image prune -f
echo "更新完成！"
EOF

chmod +x update.sh
./update.sh
```

### 手动更新

```bash
# 1. 备份数据 (可选)
cp -r data data_backup_$(date +%Y%m%d)

# 2. 拉取最新镜像
docker pull ghcr.io/fish2018/pansou-web:latest

# 3. 重启服务
docker-compose up -d

# 4. 验证更新
curl http://localhost/api/health
```
